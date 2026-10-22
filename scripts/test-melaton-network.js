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

// ---- Dreamscape Mainframe Server only while the server really boots (Yukimi: it popped twice at a
//      normal logon with the server already up) ----
const stageProgress = liftMethod(wsSrc, '_updatePreStartupStageProgress')(FakeClient);
const winCalls = [];
const hadWindow = 'window' in global;
global.window = global.window || {};
global.window.isDesktop = true;
global.window.mainframeServerWindow = { update: (p) => winCalls.push(`update:${p}`), hide: () => winCalls.push('hide') };
const sp = (state, pct) => stageProgress.call(Object.assign({ _shouldUsePreStartupDialog: () => true }, state), pct, 'Starting Dreamscape…');
sp({ lastServerStartupStatus: { isReady: true, progressPercent: 100 } }, 100);
assert.deepStrictEqual(winCalls.splice(0), ['hide'], 'an up server never opens it');
sp({ lastServerStartupStatus: { isReady: false, progressPercent: 40 } }, 40);
assert.deepStrictEqual(winCalls.splice(0), ['update:40'], 'a booting server does');
sp({ lastServerStartupStatus: null }, 0);
assert.deepStrictEqual(winCalls.splice(0), ['hide'], 'no status yet: nothing to show');
delete global.window.mainframeServerWindow;
if (!hadWindow) delete global.window;

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
assert.strictEqual(logon({ connectionPhase: 'failed', vistaLogon: true }), false, 'Vista Welcome screen keeps the failure on its own message view');
assert.strictEqual(logon({ vistaLogon: true }), false, 'Vista dialing stays on Please wait, with no VPN dialog');
assert.ok(wsSrc.includes('There are currently no logon servers available to service the logon request.'), 'ntdll no-logon-servers line');
assert.ok(fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8').includes('id="desktopPreStartupRetryBtn"'), 'Retry on the Welcome screen');
assert.ok(fs.readFileSync(path.join(__dirname, '../public/app.html'), 'utf8').includes('id="desktopPreStartupLogonCancelBtn"'), 'Cancel on the Welcome screen');
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

// Classic logon dialog: top at one third of the leftover height (modalUtils.js windowsLogonDialogOffsetY)
const modalUtilsSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/modalUtils.js'), 'utf8');
const offsetFnMatch = modalUtilsSrc.match(/function windowsLogonDialogOffsetY\([\s\S]*?\n\}/);
assert.ok(offsetFnMatch, 'windowsLogonDialogOffsetY is in modalUtils.js');
const windowsLogonDialogOffsetY = new Function(`return ${offsetFnMatch[0]}`)();
function logonTop(viewport, dialog, inset, bias) {
    const y = windowsLogonDialogOffsetY(viewport, dialog, inset, bias);
    return viewport / 2 + y - bias - dialog / 2;
}
const near = (a, b) => Math.abs(a - b) < 1e-6;
assert.ok(near(logonTop(1080, 240, 0, 18), (1080 - 240) / 3), '1080p logon top is the leftover third, bias cancelled');
assert.ok(near(logonTop(768, 220, 0, 0), (768 - 220) / 3));
assert.ok(logonTop(1080, 240, 0, 18) < (1080 - 240) / 2, 'that top sits above a vertical center');
assert.ok(near(logonTop(480, 600, 0, 18), 0), 'a dialog taller than the screen pins to the top');

// ---- Desktop: the Connecting dialog sits bottom-right of the work area, clear of desktop icons ----
const iconRect = (left, top) => ({ left, top, right: left + 92, bottom: top + 112, width: 92, height: 112 });
const grid = [14, 130, 246, 362, 478, 594, 710, 826, 942].map((t) => iconRect(14, t)).concat([iconRect(110, 14), iconRect(110, 594)]);
const area = { left: 0, top: 0, right: 1920, bottom: 1117 };
const vp1920 = { vw: 1920, vh: 1152 };
const toRect = (o, w, h) => ({ left: o.x + 960 - w / 2, top: o.y + 576 - h / 2 });
const corner = toRect(ui.desktopWindowOffset({ w: 380, h: 130 }, area, grid, vp1920), 380, 130);
assert.strictEqual(corner.left + 380, 1920 - 35, 'bottom-right, padded from the right edge (1.8% of the width)');
assert.strictEqual(corner.top + 130, 1117 - 35, 'padded above the taskbar');
const rightIcons = [iconRect(1814, 942), iconRect(1718, 942)];
assert.strictEqual(toRect(ui.desktopWindowOffset({ w: 380, h: 130 }, area, rightIcons, vp1920), 380, 130).left + 380, 1718 - 35,
    'stepped left of icons in its band');
const aboveBand = [iconRect(1814, 422)];
assert.strictEqual(toRect(ui.desktopWindowOffset({ w: 380, h: 130 }, area, aboveBand, vp1920), 380, 130).left + 380, 1920 - 35,
    'icons higher up do not move it');
// side 'left' mirrors it: beside the left icon column
const leftSide = toRect(ui.desktopWindowOffset({ w: 380, h: 130 }, area, grid, vp1920, 'left'), 380, 130);
assert.strictEqual(leftSide.left, 106 + 35, 'left variant steps right of the icon column');
const tinyOffset = ui.desktopWindowOffset({ w: 380, h: 130 }, { left: 0, top: 0, right: 400, bottom: 300 }, [], { vw: 400, vh: 300 });
const tinyLeft = tinyOffset.x + 200 - 190;
assert.ok(tinyLeft >= 16 && tinyLeft + 380 <= 400, 'kept on a small screen');

// ---- Melaton Framework exception dialog: server errors in Windows language ----
const exceptions = require('../public/scripts/comp/mainframeExceptionDialog.js');
const tr = (packet) => exceptions.translateServerError(packet);
assert.deepStrictEqual(tr({ message: 'Unknown message type', details: 'foo' }), { exception: 'IllegalPacketOperationException', text: 'Illegal Operation in Packet' });
assert.strictEqual(tr({ message: 'Invalid message format' }).text, 'Malformed Packet');
assert.strictEqual(tr({ message: 'Packet handler failed', details: 'x is undefined' }).text, 'Packet Handler Fault');
assert.strictEqual(tr({ message: 'Authentication required', code: 'AUTH_REQUIRED' }).text, 'Access Denied');
assert.strictEqual(tr({ message: 'Non-Administrator Login: This operation is not allowed', code: 'READONLY_RESTRICTED' }).text, 'Operation Not Permitted');
assert.strictEqual(tr({ message: 'Workspace not found' }).text, 'Object Not Found');
assert.strictEqual(tr({ message: 'Request timed out' }).text, 'Operation Timed Out');
assert.strictEqual(tr({ message: 'Missing required parameter: id' }).text, 'Invalid Argument in Packet');
assert.strictEqual(tr({ message: 'Something odd', code: 'INTERNAL_ERROR' }).text, 'Internal Error');
const report = exceptions.buildReport([{
    packet: { message: 'Unknown message type', details: 'workspace_x', requestId: 'r1', requestType: 'workspace_x' },
    translated: tr({ message: 'Unknown message type' }), at: new Date(2026, 9, 12, 6, 5, 9), repeats: 3
}]);
assert.ok(report.includes('Dreamscape.Mainframe.IllegalPacketOperationException: Illegal Operation in Packet'));
assert.ok(report.includes('Type: workspace_x') && report.includes('Request ID: r1'));
assert.ok(report.includes('Received: 2026-10-12 06:05:09 (3 times)'));
assert.ok(report.includes('Connection: Home VPN (Ethernet Miniport (L-PPoP))'), 'connection facts from melatonNetworkDialogs');

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
