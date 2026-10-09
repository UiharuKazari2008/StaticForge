'use strict';

/**
 * Protocol ping/pong heartbeat for Dreamscape WebSockets.
 * Dead sockets (WireGuard / cellular blackholes) never receive a pong, so the
 * server terminates them after MISSED_PONG_LIMIT unanswered pings.
 */

const HEARTBEAT_INTERVAL_MS = 30000;
const MISSED_PONG_LIMIT = 2;

function createSocketHeartbeatEntry() {
    return { alive: true, misses: 0 };
}

function noteHeartbeatPong(entry) {
    if (!entry) return;
    entry.alive = true;
    entry.misses = 0;
}

/**
 * One interval tick for a socket that was pinged last round.
 * Returns 'terminate' after missLimit missed pongs, otherwise 'ping'.
 */
function tickSocketHeartbeat(entry, missLimit = MISSED_PONG_LIMIT) {
    const limit = Number.isInteger(missLimit) && missLimit > 0 ? missLimit : MISSED_PONG_LIMIT;
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

function reapSocketHeartbeats(clients, hooks) {
    const ping = hooks && hooks.ping;
    const terminate = hooks && hooks.terminate;
    const isOpen = hooks && hooks.isOpen;
    const missLimit = hooks && hooks.missLimit;
    const terminated = [];
    for (const client of clients) {
        if (typeof isOpen === 'function' && !isOpen(client)) continue;
        if (!client.heartbeat) {
            client.heartbeat = createSocketHeartbeatEntry();
            if (client.info) client.info.heartbeat = client.heartbeat;
        }
        const action = tickSocketHeartbeat(client.heartbeat, missLimit);
        if (action === 'terminate') {
            terminated.push(client);
            if (typeof terminate === 'function') terminate(client);
        } else if (typeof ping === 'function') {
            ping(client);
        }
    }
    return terminated;
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
    createSocketHeartbeatEntry,
    noteHeartbeatPong,
    tickSocketHeartbeat,
    reapSocketHeartbeats,
    formatWsDisconnectLog
};
