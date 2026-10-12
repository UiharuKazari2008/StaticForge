#!/usr/bin/env node
// Melaton domain connection facts (Yozora #427): modules/melatonNetwork.js decides the domain
// name (config personalisation, default DREAMSCAPE) and whether the client came over the LAN
// ("Ethernet", the local nginx) or the Internet ("WAN") for the VPN-style connection dialogs.
// The client half (public/scripts/comp/melatonNetworkDialogs.js) turns that into the Vista VPN
// dialog wording: "Connecting to <fqdn> using '<type> Miniport (L-PPoP)'...", RAS errors.
// Run: node scripts/test-melaton-network.js
const assert = require('assert');
const fs = require('fs');
const path = require('path');
const net = require('../modules/melatonNetwork');

// domain name
assert.strictEqual(net.domainName(null), 'DREAMSCAPE');
assert.strictEqual(net.domainName({}), 'DREAMSCAPE');
assert.strictEqual(net.domainName({ userGlobalSettings: { desktop: { domainName: '   ' } } }), 'DREAMSCAPE');
assert.strictEqual(net.domainName({ userGlobalSettings: { desktop: { domainName: 42 } } }), 'DREAMSCAPE');
assert.strictEqual(net.domainName({ userGlobalSettings: { desktop: { domainName: ' KANMI ' } } }), 'KANMI');
assert.strictEqual(net.domainName({ userGlobalSettings: { desktop: { domainName: 'x'.repeat(80) } } }).length, 64);

// private ranges
for (const ip of ['10.0.0.5', '127.0.0.1', '172.16.0.1', '172.31.255.254', '192.168.1.20',
    '169.254.3.4', '100.64.0.1', '100.127.1.1', '::1', '::ffff:192.168.0.9', 'fd12:3456::1', 'fe80::1', 'localhost']) {
    assert.strictEqual(net.isPrivateAddress(ip), true, `${ip} should be private`);
}
for (const ip of ['', null, '8.8.8.8', '172.32.0.1', '172.15.255.1', '192.169.0.1', '100.128.0.1',
    '::ffff:1.1.1.1', '2001:4860::8888', '256.1.1.1', 'not-an-ip']) {
    assert.strictEqual(net.isPrivateAddress(ip), false, `${ip} should be public`);
}

// what /status serves
const config = { userGlobalSettings: { desktop: { domainName: 'CONTOSO' } } };
assert.deepStrictEqual(
    net.describeConnection('192.168.1.30', config),
    { domain: 'CONTOSO', connectionName: 'VPN Connection', connectionType: 'Ethernet', device: 'L-PPoP' }
);
assert.deepStrictEqual(
    net.describeConnection('198.51.100.7', {}),
    { domain: 'DREAMSCAPE', connectionName: 'VPN Connection', connectionType: 'WAN', device: 'L-PPoP' }
);
// the connection (interface) name is its own setting
assert.strictEqual(net.connectionName({ userGlobalSettings: { desktop: { connectionName: ' Office VPN ' } } }), 'Office VPN');
assert.strictEqual(net.connectionName({ userGlobalSettings: { desktop: { domainName: 'KANMI' } } }), 'VPN Connection');

// ---- client wording (melatonNetworkDialogs.js) ----
global.location = { hostname: 'staticforge.737.jp.net', protocol: 'https:' };
global.wsClient = { melatonConnection: { domain: 'CONTOSO', connectionName: 'Office VPN', connectionType: 'WAN', device: 'L-PPoP' } };
const ui = require('../public/scripts/comp/melatonNetworkDialogs.js');

const info = ui.connectionInfo();
assert.deepStrictEqual(info, { domain: 'CONTOSO', connectionName: 'Office VPN', fqdn: 'staticforge.737.jp.net', connectionType: 'WAN', device: 'L-PPoP' });
assert.strictEqual(ui.miniportLabel(info), 'WAN Miniport (L-PPoP)');
assert.strictEqual(ui.connectingTitle(info), 'Connecting to Office VPN...');
assert.strictEqual(ui.connectingText('initializing', info), "Connecting to staticforge.737.jp.net using 'WAN Miniport (L-PPoP)'...");
assert.strictEqual(ui.connectingText('dialing', info), "Connecting to staticforge.737.jp.net using 'WAN Miniport (L-PPoP)'...");
assert.strictEqual(ui.connectingText('negotiation', info), 'Verifying user name and password...');
assert.strictEqual(ui.connectingText('establishing', info), 'Registering your computer on the network...');
assert.strictEqual(ui.connectingText('connected', info), 'Connected.');
assert.strictEqual(ui.attemptText({ attempt: 0, maxAttempts: 10 }), '');
assert.strictEqual(ui.attemptText({ attempt: 2, maxAttempts: 10 }), 'Reconnect attempt 2 of 10.');
assert.strictEqual(ui.errorTitle(info), 'Error Connecting to domain controller');
assert.strictEqual(ui.domainUnavailableText(info), 'The system cannot log you on now because the domain CONTOSO is not available.');

// RAS errors for websocket.js failure messages
const code = (msg, opts) => ui.errorFor(msg, opts).code;
assert.strictEqual(code('Server not responding'), 800);
assert.strictEqual(code('Server status unavailable after 30 attempts'), 800);
assert.strictEqual(code('Connection failed after several attempts. Use Reconnect to try again.'), 800);
assert.strictEqual(code('Network connection error. Max retry attempts reached.'), 800);
assert.strictEqual(code('Connection closed unexpectedly'), 629);
assert.strictEqual(code('Connection closed (code 1006). Server may be unavailable.'), 629);
assert.strictEqual(code('Connection failed'), 619);
assert.strictEqual(code('Network connection error'), 619);
assert.strictEqual(code('anything', { online: false }), 868);
assert.ok(ui.errorFor('x').text.startsWith('Error 800: The remote connection was not made'));

// Before /status answers: WAN / Ethernet from the host name
assert.strictEqual(ui.guessConnectionType('staticforge.737.jp.net'), 'WAN');
assert.strictEqual(ui.guessConnectionType('192.168.1.10'), 'Ethernet');
assert.strictEqual(ui.guessConnectionType('localhost'), 'Ethernet');
assert.strictEqual(ui.guessConnectionType('dreamscape.lan'), 'Ethernet');
assert.strictEqual(ui.guessConnectionType('8.8.8.8'), 'WAN');
global.wsClient = { melatonConnection: null };
global.location = { hostname: '10.0.0.4', protocol: 'http:' };
assert.deepStrictEqual(ui.connectionInfo(), { domain: 'DREAMSCAPE', connectionName: 'VPN Connection', fqdn: '10.0.0.4', connectionType: 'Ethernet', device: 'L-PPoP' });
global.melatonDomainName = () => 'KANMI';
global.melatonConnectionName = () => 'Home VPN';
assert.strictEqual(ui.connectionInfo().domain, 'KANMI');
assert.strictEqual(ui.connectionInfo().connectionName, 'Home VPN');
assert.strictEqual(ui.connectingTitle(), 'Connecting to Home VPN...');

// ---- Cancel in "Connecting to <domain>..." stays cancelled (websocket.js) ----
// Lift class methods out of websocket.js (the body brace comes after the parameter list).
function liftMethod(src, name) {
    const at = [`\n    async ${name}(`, `\n    ${name}(`].map((n) => src.indexOf(n)).find((i) => i >= 0);
    assert.ok(at >= 0, `websocket.js has ${name}`);
    let depth = 0;
    let quote = null;
    for (let i = src.indexOf(') {', at) + 2; i < src.length; i++) {
        const ch = src[i];
        if (quote) {
            if (ch === '\\') i++;
            else if (ch === quote) quote = null;
            continue;
        }
        if (ch === '/' && src[i + 1] === '/') { i = src.indexOf('\n', i); continue; }
        if (ch === '/' && src[i + 1] === '*') { i = src.indexOf('*/', i + 2) + 1; continue; }
        if (ch === '"' || ch === "'" || ch === '`') { quote = ch; continue; }
        if (ch === '{') depth++;
        if (ch === '}' && --depth === 0) {
            const text = src.slice(at + 1, i + 1).trim();
            return new Function('WebSocketClient', text.startsWith('async ')
                ? `return async function ${text.slice(6)}`
                : `return function ${text}`);
        }
    }
    throw new Error(`unbalanced ${name}`);
}
const wsSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
const FakeClient = { CONNECTION_BEATS: { dialing: { message: 'Connecting…' }, negotiation: { message: 'Verifying user name and password…' } } };
const proto = {};
['_setConnectionBeat', 'cancelConnectionFromUser', 'manualReconnect', '_shouldShowLogonConnectingDialog'].forEach((name) => {
    proto[name] = liftMethod(wsSrc, name)(FakeClient);
});
const phases = [];
const c = Object.assign(Object.create(proto), {
    connectionPhase: 'dialing',
    connectionUi: { beat: 'dialing', attempt: 0, maxAttempts: 10 },
    _setConnectionPhase(phase, patch) { this.connectionPhase = phase; phases.push([phase, patch && patch.beat]); },
    suppressAutoReconnect() { this.isManualClose = true; },
    _releaseConnectLock() {},
    disconnect(manual) { this.disconnected = manual; },
    updateWebSocketStatus() {},
    bannerManager: { showWebSocketTicker() {} },
    _isStartupHaltedForInstall: () => false,
    _shouldUsePreStartupDialog: () => false,
    connect() { this.connectCalls = (this.connectCalls || 0) + 1; }
});
c.cancelConnectionFromUser();
assert.strictEqual(c.connectionPhase, 'idle');
assert.strictEqual(c.isManualClose, true);
assert.strictEqual(c.disconnected, true);
c._setConnectionBeat('negotiation'); // the in-flight attempt's next beat
c._setConnectionBeat('establishing');
assert.strictEqual(c.connectionPhase, 'idle', 'a cancelled attempt must not reopen the dialog');
assert.deepStrictEqual(phases, [['idle', undefined]]);
c.manualReconnect(); // Redial / Connect to <domain>
assert.strictEqual(c._userCancelledConnect, false);
assert.strictEqual(c.isManualClose, false);
assert.strictEqual(c.connectionPhase, 'dialing');

// ---- Logon screen: the small Connecting dialog during the connection test + WebSocket connect ----
const logon = (state) => Object.assign(Object.create(proto), {
    connectionPhase: 'dialing',
    lastServerStartupStatus: null,
    serverStartupReady: false,
    connectionStats: { connectedAt: null },
    isConnected: () => false
}, state)._shouldShowLogonConnectingDialog();
assert.strictEqual(logon({}), true, 'connection test before /status answers');
assert.strictEqual(logon({ lastServerStartupStatus: { isReady: true }, serverStartupReady: true }), true, 'ready server, socket connecting');
assert.strictEqual(logon({ lastServerStartupStatus: { isReady: false }, serverStartupReady: false }), false, 'a starting server keeps its progress in the logon dialog');
assert.strictEqual(logon({ connectionStats: { connectedAt: 1 }, isConnected: () => true }), false, 'socket up: the logon dialog takes over');
assert.strictEqual(logon({ _logonInitStatus: { message: 'Loading Application Data...' } }), false, 'logon steps stay in the logon dialog');
assert.strictEqual(logon({ connectionPhase: 'auth' }), false, 'the password prompt is the logon dialog');
assert.strictEqual(logon({ connectionPhase: 'idle' }), false);
assert.strictEqual(logon({ connectionPhase: 'failed' }), true, 'failures show Error Connecting to domain controller');
assert.strictEqual(logon({ preStartupAuthBusy: true }), false);

// ---- Logon-screen placement: bottom-right quadrant, off the grid, under the logon dialog ----
const vp = { vw: 1920, vh: 1080 };
const conn = ui.logonWindowOffset('connecting', { w: 380, h: 130 }, vp, null);
assert.deepStrictEqual(conn, { x: Math.round(1920 * 0.69 + 13 - 960), y: Math.round(1080 * 0.70 + 7 - 540) });
const main = ui.logonWindowOffset('mainframe', { w: 360, h: 120 }, vp, null);
assert.ok(main.x !== conn.x && main.y !== conn.y, 'the two windows get different spots');
assert.ok(conn.x > 0 && conn.y > 0 && main.x > 0 && main.y > 0, 'both in the bottom-right quadrant');
const below = ui.logonWindowOffset('connecting', { w: 380, h: 130 }, vp, { bottom: 800, height: 230 });
assert.strictEqual(below.y + 540 - 65, 800 + 18, 'pushed below the logon dialog');
const small = ui.logonWindowOffset('connecting', { w: 380, h: 130 }, { vw: 640, vh: 480 }, { bottom: 460, height: 230 });
assert.strictEqual(small.y + 240 + 65, 480 - 16, 'clamped inside a small screen');
assert.strictEqual(small.x + 320 + 190, 640 - 16);

// ---- Dreamscape Mainframe Server: the building-blocks tiling always fills the well exactly ----
const mainframe = require('../public/scripts/comp/mainframeServerWindow.js');
for (let run = 0; run < 200; run++) {
    const pieces = mainframe.tileWell(8, 8);
    const grid = Array.from({ length: 8 }, () => new Array(8).fill(-1));
    pieces.forEach((p, n) => p.cells.forEach(([cx, cy]) => {
        const x = p.x + cx;
        const y = p.y + cy;
        assert.ok(x >= 0 && x < 8 && y >= 0 && y < 8, 'no block past the rim');
        assert.strictEqual(grid[y][x], -1, 'no overlap');
        assert.ok(y === 0 || (grid[y - 1][x] >= 0 && grid[y - 1][x] <= n), 'rests on the floor or blocks below');
        grid[y][x] = n;
    }));
    assert.ok(grid.every((row) => row.every((c) => c >= 0)), 'the well ends exactly full');
}
assert.strictEqual(mainframe.tileWell(3, 3), null, 'sizes that cannot be tiled are refused');

// ---- /status/stream reader (websocket.js _followServerBootStream) ----
(async () => {
    const follow = liftMethod(wsSrc, '_followServerBootStream')({ TIMEOUT_BOOT_STREAM_IDLE: 2000 });
    const enc = new TextEncoder();
    const streamOf = (chunks) => new ReadableStream({
        start(controller) {
            chunks.forEach((chunk) => controller.enqueue(enc.encode(chunk)));
            controller.close();
        }
    });
    const reader = (chunks, status = 200) => async () => new Response(status === 200 ? streamOf(chunks) : 'nope', { status });
    const applied = [];
    const ws = { _applyServerStartupStatus: (d) => applied.push(`${d.type}:${d.progressPercent}`) };
    global.fetch = reader(['{"type":"status","progressPercent":10}\n{"type":"sta', 'tus","progressPercent":50}\n\n', '{"type":"done","progressPercent":100}\n']);
    assert.strictEqual(await follow.call(ws), 'done');
    assert.deepStrictEqual(applied, ['status:10', 'status:50', 'done:100'], 'lines split across chunks are joined');
    global.fetch = reader(['{"type":"status","progressPercent":5}\n']);
    assert.strictEqual(await follow.call(ws), 'ended', 'closed without done (the server went down again)');
    global.fetch = reader([], 404);
    assert.strictEqual(await follow.call(ws), 'unsupported');
    global.fetch = async () => { throw new TypeError('Failed to fetch'); };
    assert.strictEqual(await follow.call(ws), 'failed');
    console.log('melaton network: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
