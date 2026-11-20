'use strict';

// DreamOS machines in ActiveSync (#910, modules/cafeReadyHost.js): a CaféReady hello is taken only from a Miniport
// sub-client signed in as an administrator, for the device id its carrier connected with; the machine is partnered
// with platform cafeready; its status keeps `host`; the server refuses what the machine does not allow and relays what
// it does (host.shell, host.config) to the host socket; a blob posted for a token answers the waiting call; the agent
// helpers pick a computer only when it is named. Fake sockets, no network.

const assert = require('assert');
const os = require('os');
const path = require('path');
const fs = require('fs');
const zlib = require('zlib');
const WebSocket = require('ws');

const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'cafeready-host-'));
const as = require('../modules/activeSync');
const host = require('../modules/cafeReadyHost');
as.resetForTests(tmpDir);

const server = {
    clients: new Map(),
    sendToClient(ws, msg) { ws.inbox.push(msg); if (ws.onMessage) ws.onMessage(msg); },
    broadcast() {}
};
const gr = { getPath: () => tmpDir, getWebSocketServer: () => server };
const keepAlive = setInterval(() => {}, 1000);

function connect({ userType = 'admin', miniport = true, device = null } = {}) {
    const carrier = { _dsMiniport: miniport, _dsDevice: device, readyState: WebSocket.OPEN };
    const ws = { readyState: WebSocket.OPEN, inbox: [], onMessage: null, virtual: true, carrier, sub: 'activesync' };
    const info = { authenticated: true, userType, sessionId: 'sess-1', clientIP: '203.0.113.7', clientId: Math.random().toString(16).slice(2, 14) };
    server.clients.set(ws, info);
    return { ws, info };
}

async function rejects(p, code) {
    try { await p; } catch (err) { assert.strictEqual(err.code, code, `expected ${code}, got ${err.code}: ${err.message}`); return; }
    assert.fail(`expected ${code}`);
}

const ID = '0123456789abcdef0123456789abcdef';
const OPS = ['status.get', 'host.shell', 'host.screenshot', 'host.diagnostics', 'host.config', 'host.packages', 'storage.stat', 'storage.list', 'stream.send', 'stream.receive'];
const status = (allow) => ({ battery: { level: 81, charging: false }, wifi: { connected: true, ssid: 'Hotel', level: 3 }, active: 'wifi',
    host: { base: '0.2.44', slot: 'A', cafeready: '0.1.0+abc', power: 'battery', addresses: ['10.0.0.5'], allow, junk: 'x'.repeat(5000) } });
const hello = (allow) => ({ kind: 'device', speaker: 'host', platform: 'cafeready', id: ID, name: 'yukimi-mac', nameSet: true, model: 'MacBookPro11,4', os: 'DreamOS 0.2.44 (slot A)', app: 'CaféReady 0.1.0', ops: OPS, status: status(allow) });

async function main() {
    // refused: not an administrator, not a Miniport, another device id
    assert.throws(() => as.hello(gr, server, connect({ userType: 'user' }).info, hello({})), (e) => e.code === 'NOT_PERMITTED');
    assert.throws(() => as.hello(gr, server, connect({ miniport: false }).info, hello({})), (e) => e.code === 'NOT_PERMITTED');
    assert.throws(() => as.hello(gr, server, connect({ device: 'ffffffffffffffffffffffffffffffff' }).info, hello({})), (e) => e.code === 'BAD_ID');
    server.clients.clear();

    // registered and partnered by the sign-in
    const mac = connect({ device: ID });
    const r = as.hello(gr, server, mac.info, hello({ commands: false, screenshots: true, killSwitch: false }));
    assert.strictEqual(r.session, 'partner');
    assert.deepStrictEqual(r.permissions.sort(), ['control', 'files']);
    const d = as.list(gr, server).devices.find((x) => x.deviceId === ID);
    assert.strictEqual(d.platform, 'cafeready');
    assert.strictEqual(d.adb, null);
    assert.strictEqual(d.status.host.base, '0.2.44');
    assert.strictEqual(d.status.host.junk, undefined, 'unknown host fields are dropped');
    assert.deepStrictEqual(d.status.host.allow, { commands: false, screenshots: true, killSwitch: false });
    assert.throws(() => as.setPrimary(gr, server, ID), (e) => e.code === 'NOT_PHONE');

    // the machine answers requests
    const seen = [];
    mac.ws.onMessage = (msg) => {
        if (msg.type !== 'as_request') return;
        const { callId, op, args, from } = msg.data;
        seen.push({ op, args, from });
        if (op === 'host.shell') as.reply(mac.info, { callId, ok: true, result: { output: 'hello\n', error: '', exitCode: 0, user: args.root ? 'root' : 'dream' } });
        else if (op === 'host.config') as.reply(mac.info, { callId, ok: true, result: { updateChannel: args.updateChannel || 'dev' } });
        else if (op === 'host.diagnostics') {
            as.reply(mac.info, { callId, ok: true, result: { bytes: 10 } });
            host.takeBlob(gr, ID, args.token, 'text', 'gzip', {}, zlib.gzipSync(Buffer.from('== diag ==\nok')));
        } else as.reply(mac.info, { callId, ok: false, error: { code: 'UNSUPPORTED', message: op } });
    };

    // not allowed on the machine: refused here, nothing sent
    await rejects(host.shell(gr, ID, { command: 'id' }, 'test'), 'NOT_ALLOWED');
    assert.strictEqual(seen.length, 0);

    // the machine allows it (its status says so)
    as.status(gr, server, mac.info, { status: status({ commands: true, screenshots: true, killSwitch: false }) });
    const out = await host.shell(gr, ID, { command: 'id -u', root: true }, 'test');
    assert.strictEqual(out.output, 'hello\n');
    assert.strictEqual(seen[0].op, 'host.shell');
    assert.strictEqual(seen[0].args.root, true);
    assert.strictEqual(seen[0].from.kind, 'computer');
    const cfg = await host.config(gr, ID, { updateChannel: 'https://staticforge.737.jp.net/macint' }, 'test');
    assert.strictEqual(cfg.updateChannel, 'https://staticforge.737.jp.net/macint');
    assert.strictEqual(await host.diagnostics(gr, ID, {}, 'test'), '== diag ==\nok');
    // the summary never carries the command's words
    assert.ok(!host.commandSummary('curl -u user:secret http://x', false).includes('secret'));

    // the kill switch on the machine wins
    as.status(gr, server, mac.info, { status: status({ commands: true, screenshots: true, killSwitch: true }) });
    await rejects(host.shell(gr, ID, { command: 'id' }, 'test'), 'REMOTE_COMMANDS_OFF');

    // agents: a computer is picked only when named; with one phone online and the computer, omitting picks the phone
    const deviceAdb = require('../modules/deviceAdb');
    let a = await deviceAdb.agentShell(gr, { command: 'id' });
    assert.strictEqual(a.code, 'CHOOSE_DEVICE');
    assert.ok(a.devices.some((x) => x.platform === 'cafeready'));
    as.status(gr, server, mac.info, { status: status({ commands: true, screenshots: true, killSwitch: false }) });
    a = await deviceAdb.agentShell(gr, { device: 'yukimi-mac', command: 'id', root: true, timeout: 5 });
    assert.strictEqual(a.success, true);
    assert.strictEqual(a.platform, 'cafeready');
    assert.strictEqual(seen[seen.length - 1].args.timeoutMs, 5000);

    // a blob for a token nobody waits for, or another device, is not taken
    assert.strictEqual(await host.takeBlob(gr, ID, 'f'.repeat(32), 'text', '', {}, Buffer.from('x')), false);

    // offline: the row stays, commands fail at once
    as.onSocketClosed(gr, server, mac.info);
    server.clients.delete(mac.ws);
    await rejects(host.shell(gr, ID, { command: 'id' }, 'test'), 'NOT_ONLINE');
    const off = as.list(gr, server).devices.find((x) => x.deviceId === ID);
    assert.strictEqual(off.online, false);
    assert.strictEqual(off.platform, 'cafeready');

    console.log('cafeready host: all checks passed');
}

main().then(() => { clearInterval(keepAlive); host.resetForTests(); process.exit(0); }, (err) => { console.error(err); process.exit(1); });
