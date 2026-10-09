'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    createSocketHeartbeatEntry,
    noteHeartbeatPong,
    tickSocketHeartbeat,
    reapSocketHeartbeats,
    formatWsDisconnectLog,
    MISSED_PONG_LIMIT
} = require('../modules/wsSocketHeartbeat');

assert.strictEqual(MISSED_PONG_LIMIT, 2);

console.log('heartbeat reaps a socket after two missed pongs');
const dead = { ws: { id: 'dead' }, heartbeat: createSocketHeartbeatEntry() };
const live = { ws: { id: 'live' }, heartbeat: createSocketHeartbeatEntry() };
const pings = [];
const terminated = [];
function reap(clients) {
    return reapSocketHeartbeats(clients, {
        isOpen: () => true,
        ping: (client) => pings.push(client.ws.id),
        terminate: (client) => terminated.push(client.ws.id)
    });
}

let first = reap([dead, live]);
assert.deepStrictEqual(terminated, []);
assert.deepStrictEqual(pings, ['dead', 'live']);
noteHeartbeatPong(live.heartbeat);

pings.length = 0;
first = reap([dead, live]);
assert.strictEqual(first.length, 0);
assert.deepStrictEqual(terminated, []);
assert.ok(pings.includes('dead'));
assert.ok(pings.includes('live'));

pings.length = 0;
const secondMiss = reap([dead, live]);
assert.deepStrictEqual(secondMiss.map((client) => client.ws.id), ['dead']);
assert.deepStrictEqual(terminated, ['dead']);
assert.deepStrictEqual(pings, ['live']);

console.log('one missed pong does not terminate');
const once = createSocketHeartbeatEntry();
assert.strictEqual(tickSocketHeartbeat(once), 'ping');
assert.strictEqual(tickSocketHeartbeat(once), 'ping');
noteHeartbeatPong(once);
assert.strictEqual(tickSocketHeartbeat(once), 'ping');
assert.strictEqual(tickSocketHeartbeat(once), 'ping');
assert.strictEqual(tickSocketHeartbeat(once), 'terminate');

console.log('disconnect log includes close code, reason, and client IP');
const line = formatWsDisconnectLog({
    clientIP: '203.0.113.5',
    code: 1006,
    reason: Buffer.from('heartbeat-timeout'),
    sessionId: 'sess-1'
});
assert.ok(line.includes('ip=203.0.113.5'));
assert.ok(line.includes('code=1006'));
assert.ok(line.includes('reason=heartbeat-timeout'));
assert.ok(line.includes('session=sess-1'));

const clientSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
const timeoutMatch = clientSrc.match(/static TIMEOUT_PING = (\d+)/);
const missMatch = clientSrc.match(/static PING_LIVENESS_MISSES = (\d+)/);
assert.ok(timeoutMatch, 'TIMEOUT_PING missing');
assert.ok(missMatch, 'PING_LIVENESS_MISSES missing');
const timeoutPing = Number(timeoutMatch[1]);
const missLimit = Number(missMatch[1]);
assert.ok(timeoutPing >= 15000 && timeoutPing <= 20000, `TIMEOUT_PING ${timeoutPing} should be 15-20s`);
assert.ok(missLimit >= 2, 'client reconnect requires 2 missed pongs');

function extractClassMethod(src, methodName) {
    const needle = `\n    ${methodName}(`;
    const idx = src.indexOf(needle);
    if (idx < 0) throw new Error(`missing ${methodName}`);
    const start = idx + 1;
    const open = src.indexOf('{', start);
    let depth = 0;
    let inStr = null;
    let escape = false;
    for (let i = open; i < src.length; i++) {
        const ch = src[i];
        if (inStr) {
            if (escape) {
                escape = false;
                continue;
            }
            if (ch === '\\') {
                escape = true;
                continue;
            }
            if (ch === inStr) inStr = null;
            continue;
        }
        if (ch === '"' || ch === "'" || ch === '`') {
            inStr = ch;
            continue;
        }
        if (ch === '{') depth += 1;
        else if (ch === '}') {
            depth -= 1;
            if (depth === 0) return src.slice(start, i + 1);
        }
    }
    throw new Error(`unbalanced ${methodName}`);
}

const body = extractClassMethod(clientSrc, '_registerMissedPong').replace(/^\s+/, '');
const registerMissedPong = new Function('WebSocketClient', `return function ${body}`)({
    PING_LIVENESS_MISSES: missLimit
});
const replaced = [];
const client = {
    _missedPingCount: 0,
    _replaceStaleSocket(source) { replaced.push(source); }
};
assert.strictEqual(registerMissedPong.call(client), false);
assert.deepStrictEqual(replaced, []);
assert.strictEqual(registerMissedPong.call(client), true);
assert.deepStrictEqual(replaced, ['ping-liveness']);

console.log('test-ws-heartbeat: ok');
