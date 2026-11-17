'use strict';

/**
 * Protocol ping/pong heartbeat for Dreamscape WebSockets.
 * Dead sockets (WireGuard / cellular blackholes) never receive a pong, so the
 * server terminates them after MISSED_PONG_LIMIT unanswered pings.
 *
 * Any frame the socket sends (a message, a pong, or its own protocol ping) proves it alive
 * (noteSocketHeard). A socket heard from within its quiet window is not pinged at all (#890): a
 * page sends its own ping every 30 s, and the Android app's native sockets ping the server
 * themselves, so a server ping only goes out to a socket that has been silent a whole window.
 * Once it has had to ping, the missed-pong rule is the same as before: the pong is due by the
 * next tick, and MISSED_PONG_LIMIT unanswered pings in a row end the socket.
 *
 *   QUIET_WINDOW_MS       30 s   ordinary sockets (desktop tabs, a phone page that is awake, the
 *                                app's light sockets: widgets and the screen saver run only with
 *                                the screen on or on the charger, and a Frame's online state in
 *                                Control Panel follows its socket)
 *   QUIET_WINDOW_LONG_MS  180 s  the app's native links (the Miniport carrier, ActiveSync's
 *                                background link) and the page of a phone the server knows is
 *                                asleep: each server ping wakes the phone's radio
 *
 * A long window must not leave a silently dropped link standing for minutes once its peer is back:
 * when a phone reconnects (a new Miniport carrier, a new ActiveSync hello), its older links are
 * probed (probeSocketLink), and until one answers its page's last word on being on screen or
 * connected is not relied on (socketLinkUnanswered).
 */

// 15 s ticks (#890): the keep-alive below needs a ping before 60 s of server silence. Two missed
// pongs (30 s) still end a socket: a protocol pong comes back in a second or two, radio wake included.
const HEARTBEAT_INTERVAL_MS = 15000;
const MISSED_PONG_LIMIT = 2;
const QUIET_WINDOW_MS = 30000;
const QUIET_WINDOW_LONG_MS = 180000;
// a probe (probeSocketLink) is not counted as missed before this: the radio of a phone that just
// reconnected elsewhere may take a moment to answer on its older link
const PROBE_GRACE_MS = 10000;
// The reverse proxy in front of the server (737.jp.net) cuts a connection after ~60 s with nothing
// sent towards the client (Nov 17: with only the long window, every idle Miniport carrier was cut and
// re-dialled every ~62 s). So, apart from the liveness window, the server never stays silent towards a
// socket for longer than this: a quiet link gets one ping every ~35-50 s (it was one every 30 s).
const KEEPALIVE_MS = 35000;

function createSocketHeartbeatEntry(now = Date.now()) {
    return { alive: true, misses: 0, heardAt: now, sentAt: now };
}

/** The socket sent something (message, pong, ping): it is alive, and its window starts again. */
function noteSocketHeard(entry, now = Date.now()) {
    if (!entry) return;
    entry.alive = true;
    entry.misses = 0;
    entry.heardAt = now;
    entry.probedAt = 0;
}

// the old name: a pong is one of the frames that count
const noteHeartbeatPong = noteSocketHeard;

/**
 * One interval tick for a socket.
 * opts.windowMs (optional): the socket's quiet window. While it was heard from within it, the
 * tick returns 'skip' (no ping). Without a window every tick pings, as before.
 * Returns 'terminate' after missLimit missed pongs, otherwise 'ping' (or 'skip').
 */
function tickSocketHeartbeat(entry, missLimit = MISSED_PONG_LIMIT, opts = null) {
    const limit = Number.isInteger(missLimit) && missLimit > 0 ? missLimit : MISSED_PONG_LIMIT;
    const windowMs = opts && Number(opts.windowMs) > 0 ? Number(opts.windowMs) : 0;
    const now = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
    const keepaliveMs = opts && Number(opts.keepaliveMs) > 0 ? Number(opts.keepaliveMs) : 0;
    if (windowMs) {
        if (!Number.isFinite(entry.heardAt)) entry.heardAt = now;
        // the proxy keep-alive: something must go towards the client before the proxy's idle cut
        const sentLately = !keepaliveMs || !Number.isFinite(entry.sentAt) || now - entry.sentAt < keepaliveMs;
        if (entry.alive && now - entry.heardAt < windowMs && sentLately) {
            entry.misses = 0;
            return 'skip';
        }
    }
    // probed a moment ago (probeSocketLink): its ping is out, and this tick is too soon to count it
    if (!entry.alive && entry.probedAt && now - entry.probedAt < PROBE_GRACE_MS) return 'skip';
    if (!entry.alive) {
        entry.misses += 1;
        if (entry.misses >= limit) {
            return 'terminate';
        }
    } else {
        entry.misses = 0;
    }
    entry.alive = false;
    return 'ping';
}

/**
 * hooks: { ping(client), terminate(client), isOpen(client), missLimit, windowFor(client) -> ms, now }
 * windowFor is optional; without it every open socket is pinged each tick (the old behaviour).
 */
function reapSocketHeartbeats(clients, hooks) {
    const ping = hooks && hooks.ping;
    const terminate = hooks && hooks.terminate;
    const isOpen = hooks && hooks.isOpen;
    const missLimit = hooks && hooks.missLimit;
    const windowFor = hooks && hooks.windowFor;
    const keepaliveMs = hooks && Number(hooks.keepaliveMs) >= 0 && hooks.keepaliveMs !== undefined ? Number(hooks.keepaliveMs) : KEEPALIVE_MS;
    const now = hooks && Number.isFinite(hooks.now) ? hooks.now : Date.now();
    const terminated = [];
    for (const client of clients) {
        if (typeof isOpen === 'function' && !isOpen(client)) continue;
        if (!client.heartbeat) {
            client.heartbeat = createSocketHeartbeatEntry(now);
            if (client.info) client.info.heartbeat = client.heartbeat;
        }
        const windowMs = typeof windowFor === 'function' ? windowFor(client) : 0;
        if (windowMs === Infinity) continue; // never pinged (its carrier's heartbeat covers it)
        const action = tickSocketHeartbeat(client.heartbeat, missLimit, windowMs ? { windowMs, keepaliveMs, now } : null);
        if (action === 'terminate') {
            terminated.push(client);
            if (typeof terminate === 'function') terminate(client);
        } else if (action === 'ping' && typeof ping === 'function') {
            ping(client);
        }
    }
    return terminated;
}

/**
 * A page on a phone that said it sleeps (client_dormant): a Melaton Mobile page (clientInfo.phone),
 * or a phone's DeX window (client_dormant dex: 1 marks clientInfo.dexWindow, #890 P18). Its status
 * pushes are held (websocket.js DORMANT_HOLD), it gets no Director stream, and its own socket (a DeX
 * window that has one) keeps the long quiet window: a server ping wakes the phone's radio either way.
 */
function isDormantPage(info) {
    return !!(info && info.dormant && ((info.phone && info.phone.shell === 'mobile') || info.dexWindow === true));
}

/**
 * The quiet window of a server socket (ws) and its clientInfo (null for the Miniport carrier,
 * which is no client). Infinity: never pinged by the server (a Continuity sub-client: it lives on
 * its carrier's socket, whose own heartbeat ends it).
 */
function quietWindowFor(ws, info) {
    if (ws && ws.virtual) return Infinity;
    if (ws && ws._dsMiniport) return QUIET_WINDOW_LONG_MS;
    if (info) {
        if (info.as && info.as.speaker === 'service') return QUIET_WINDOW_LONG_MS;
        if (isDormantPage(info)) return QUIET_WINDOW_LONG_MS;
    }
    return QUIET_WINDOW_MS;
}

/**
 * The physical link a server socket travels on, and its heartbeat entry: a Continuity or Miniport
 * sub-client (#798 / #815) lives on its carrier's socket; a Miniport carrier keeps its own entry
 * (ws._dsHeartbeat). clients: the server's Map(ws -> clientInfo), for a Continuity carrier's entry.
 */
function socketLink(ws, info, clients) {
    if (ws && ws.virtual && ws.carrier) {
        const c = ws.carrier;
        if (c._dsHeartbeat) return { ws: c, entry: c._dsHeartbeat };
        const ci = clients && typeof clients.get === 'function' ? clients.get(c) : null;
        return { ws: c, entry: ci && ci.heartbeat ? ci.heartbeat : null };
    }
    if (ws && ws._dsHeartbeat) return { ws, entry: ws._dsHeartbeat };
    return { ws: ws || null, entry: info && info.heartbeat ? info.heartbeat : null };
}

/**
 * The socket's link was pinged and has not answered yet: it may have dropped without a word (a
 * Wi-Fi / cellular handover leaves the old connection open on the server until the heartbeat ends it).
 * What such a socket last reported (on screen, in front, connected) is not to be relied on.
 */
function socketLinkUnanswered(ws, info, clients) {
    const { entry } = socketLink(ws, info, clients);
    return !!(entry && entry.alive === false);
}

/**
 * A peer came back on another link (#890): its older link proves it is still there. Its quiet
 * window ends now and it is pinged; until a frame comes socketLinkUnanswered says so, and if none
 * comes the usual missed-pong rule ends it within a tick or two after PROBE_GRACE_MS (instead of up
 * to QUIET_WINDOW_LONG_MS later). A link that is already waiting on a ping is left to that one.
 * Returns true when a ping went out.
 */
function probeSocketLink(ws, info, clients, now = Date.now()) {
    const { ws: link, entry } = socketLink(ws, info, clients);
    if (!link || !entry || link.readyState !== 1 || typeof link.ping !== 'function') return false;
    if (!entry.alive) return false;
    entry.alive = false;
    entry.probedAt = now;
    try { link.ping(); } catch (_) { /* closing: the next tick counts it */ }
    return true;
}

/**
 * Every frame a server-side ws socket receives counts as liveness: wire it once per socket.
 * (Listeners add to the caller's own 'message' handler; they do not replace it.)
 */
function watchSocketFrames(ws, entry) {
    if (!ws || !entry || typeof ws.on !== 'function') return;
    const heard = () => noteSocketHeard(entry);
    ws.on('pong', heard);
    // a client ping is answered with a pong at once (ws autoPong): heard, and something went back
    ws.on('ping', () => { heard(); entry.sentAt = Date.now(); });
    ws.on('message', heard);
    // what the server sends towards the client keeps the proxy's idle timer from cutting the link
    for (const m of ['send', 'ping']) {
        const orig = ws[m];
        if (typeof orig !== 'function') continue;
        ws[m] = function sentThrough(...args) { entry.sentAt = Date.now(); return orig.apply(this, args); };
    }
}

function formatWsDisconnectLog(info) {
    const src = info && typeof info === 'object' ? info : {};
    let reason = '';
    if (Buffer.isBuffer(src.reason)) {
        reason = src.reason.toString('utf8');
    } else if (src.reason != null) {
        reason = String(src.reason);
    }
    const ip = src.clientIP || '-';
    const code = src.code == null || src.code === '' ? '-' : src.code;
    const session = src.sessionId || '-';
    return `🔌 WebSocket disconnected: ip=${ip} code=${code} reason=${reason} session=${session}`;
}

module.exports = {
    HEARTBEAT_INTERVAL_MS,
    MISSED_PONG_LIMIT,
    QUIET_WINDOW_MS,
    QUIET_WINDOW_LONG_MS,
    PROBE_GRACE_MS,
    KEEPALIVE_MS,
    createSocketHeartbeatEntry,
    noteSocketHeard,
    noteHeartbeatPong,
    tickSocketHeartbeat,
    reapSocketHeartbeats,
    quietWindowFor,
    isDormantPage,
    socketLink,
    socketLinkUnanswered,
    probeSocketLink,
    watchSocketFrames,
    formatWsDisconnectLog
};
