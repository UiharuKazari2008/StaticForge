'use strict';

const assert = require('assert');
const fs = require('fs');
const path = require('path');
const {
    resolveRequestClientIp,
    realClientIp,
    trustedProxiesForClientIp,
    KUROKO_TRUSTED_PROXY
} = require('../modules/clientAddress');

const trusted = trustedProxiesForClientIp(['127.0.0.0/8', '::1']);
assert.ok(trusted.includes(KUROKO_TRUSTED_PROXY));
assert.strictEqual(KUROKO_TRUSTED_PROXY, '192.168.200.121');

function req(peer, xff) {
    const headers = {};
    if (xff != null) headers['x-forwarded-for'] = xff;
    return { headers, socket: { remoteAddress: peer } };
}

console.log('spoofed XFF from an untrusted peer is ignored');
const spoofed = resolveRequestClientIp(req('203.0.113.50', '127.0.0.1'), trusted);
assert.strictEqual(spoofed.ip, '203.0.113.50');
assert.strictEqual(spoofed.keylessIp, '203.0.113.50');
assert.notStrictEqual(spoofed.ip, '127.0.0.1');

console.log('Kuroko walks XFF from the right and skips trusted proxies');
const viaKuroko = resolveRequestClientIp(
    req('192.168.200.121', '127.0.0.1, 203.0.113.77'),
    trusted
);
assert.strictEqual(viaKuroko.ip, '203.0.113.77');
assert.strictEqual(viaKuroko.keylessIp, '203.0.113.77');
assert.notStrictEqual(viaKuroko.ip, '192.168.200.121');
assert.notStrictEqual(viaKuroko.ip, '127.0.0.1');

const mapped = resolveRequestClientIp(
    req('::ffff:192.168.200.121', '198.51.100.8, 203.0.113.10'),
    trusted
);
assert.strictEqual(mapped.ip, '203.0.113.10');

console.log('untrusted proxy without XFF is the socket peer');
const bare = resolveRequestClientIp(req('10.9.8.7', null), trusted);
assert.strictEqual(bare.ip, '10.9.8.7');
assert.strictEqual(bare.keylessIp, '10.9.8.7');
assert.strictEqual(bare.trustedPeer, false);

const bareSpoof = resolveRequestClientIp(req('10.9.8.7', '127.0.0.1'), trusted);
assert.strictEqual(bareSpoof.ip, '10.9.8.7');
assert.notStrictEqual(bareSpoof.keylessIp, '127.0.0.1');

console.log('trusted proxy with no XFF does not invent a client');
const missing = resolveRequestClientIp(req('192.168.200.121', null), trusted);
assert.strictEqual(missing.ip, '192.168.200.121');
assert.strictEqual(missing.keylessIp, null);

console.log('realClientIp never returns the leftmost spoof');
assert.strictEqual(
    realClientIp(req('203.0.113.50', '127.0.0.1, 198.51.100.1'), ['127.0.0.0/8', '::1']),
    '203.0.113.50'
);
assert.strictEqual(
    realClientIp(req('192.168.200.121', '127.0.0.1, 198.51.100.1'), null),
    '198.51.100.1'
);

function sliceFn(src, startMark, endMark) {
    const start = src.indexOf(startMark);
    const end = src.indexOf(endMark, start + startMark.length);
    assert.ok(start >= 0 && end > start, `missing ${startMark}`);
    return src.slice(start, end);
}

const webServer = fs.readFileSync(path.join(__dirname, '../web_server.js'), 'utf8');
const getRealIP = sliceFn(webServer, 'function getRealIP', 'function isPrivateIP');
assert.ok(getRealIP.includes('realClientIp'), 'getRealIP must use clientAddress');
assert.ok(!getRealIP.includes("split(',')[0]"), 'getRealIP must not trust the leftmost XFF hop');
assert.ok(!getRealIP.includes('x-real-ip'), 'getRealIP must not trust X-Real-IP');

const websocket = fs.readFileSync(path.join(__dirname, '../modules/websocket.js'), 'utf8');
const handshake = sliceFn(websocket, 'const resolvedIp = realClientIp', 'clientInfo = {');
assert.ok(handshake.includes('realClientIp'));
assert.ok(!handshake.includes("split(',')[0]"));
assert.ok(websocket.includes('formatWsDisconnectLog'));
assert.ok(websocket.includes('reapSocketHeartbeats'));

console.log('test-real-client-ip: ok');
