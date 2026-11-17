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
 *   QUIET_WINDOW_MS       30 s   ordinary sockets (desktop tabs, a phone page that is awake)
 *   QUIET_WINDOW_LONG_MS  180 s  the app's native links (the Miniport carrier, ActiveSync's
 *                                background link, light sockets) and the page of a phone the
 *                                server knows is asleep: each server ping wakes the phone's radio
 */

const HEARTBEAT_INTERVAL_MS = 30000;
const MISSED_PONG_LIMIT = 2;
const QUIET_WINDOW_MS = 30000;
const QUIET_WINDOW_LONG_MS = 180000;

function createSocketHeartbeatEntry(now = Date.now()) {
    return { alive: true, misses: 0, heardAt: now };
}

/** The socket sent something (message, pong, ping): it is alive, and its window starts again. */
function noteSocketHeard(entry, now = Date.now()) {
    if (!entry) return;
    entry.alive = true;
    entry.misses = 0;
    entry.heardAt = now;
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
    if (windowMs) {
        const now = opts && Number.isFinite(opts.now) ? opts.now : Date.now();
        if (!Number.isFinite(entry.heardAt)) entry.heardAt = now;
        if (entry.alive && now - entry.heardAt < windowMs) {
            entry.misses = 0;
            return 'skip';
        }
    }
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
        const action = tickSocketHeartbeat(client.heartbeat, missLimit, windowMs ? { windowMs, now } : null);
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
 * The quiet window of a server socket (ws) and its clientInfo (null for the Miniport carrier,
 * which is no client). Infinity: never pinged by the server (a Continuity sub-client: it lives on
 * its carrier's socket, whose own heartbeat ends it).
 */
function quietWindowFor(ws, info) {
    if (ws && ws.virtual) return Infinity;
    if (ws && ws._dsMiniport) return QUIET_WINDOW_LONG_MS;
    if (info) {
        if (info.light) return QUIET_WINDOW_LONG_MS;
        if (info.as && info.as.speaker === 'service') return QUIET_WINDOW_LONG_MS;
        if (info.dormant && info.phone && info.phone.shell === 'mobile') return QUIET_WINDOW_LONG_MS;
    }
    return QUIET_WINDOW_MS;
}

/**
 * Every frame a server-side ws socket receives counts as liveness: wire it once per socket.
 * (Listeners add to the caller's own 'message' handler; they do not replace it.)
 */
function watchSocketFrames(ws, entry) {
    if (!ws || !entry || typeof ws.on !== 'function') return;
    const heard = () => noteSocketHeard(entry);
    ws.on('pong', heard);
    ws.on('ping', heard);
    ws.on('message', heard);
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
    createSocketHeartbeatEntry,
    noteSocketHeard,
    noteHeartbeatPong,
    tickSocketHeartbeat,
    reapSocketHeartbeats,
    quietWindowFor,
    watchSocketFrames,
    formatWsDisconnectLog
};
