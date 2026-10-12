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
    { domain: 'CONTOSO', connectionType: 'Ethernet', device: 'L-PPoP' }
);
assert.deepStrictEqual(
    net.describeConnection('198.51.100.7', {}),
    { domain: 'DREAMSCAPE', connectionType: 'WAN', device: 'L-PPoP' }
);

// ---- client wording (melatonNetworkDialogs.js) ----
global.location = { hostname: 'staticforge.737.jp.net', protocol: 'https:' };
global.wsClient = { melatonConnection: { domain: 'CONTOSO', connectionType: 'WAN', device: 'L-PPoP' } };
const ui = require('../public/scripts/comp/melatonNetworkDialogs.js');

const info = ui.connectionInfo();
assert.deepStrictEqual(info, { domain: 'CONTOSO', fqdn: 'staticforge.737.jp.net', connectionType: 'WAN', device: 'L-PPoP' });
assert.strictEqual(ui.miniportLabel(info), 'WAN Miniport (L-PPoP)');
assert.strictEqual(ui.connectingTitle(info), 'Connecting to CONTOSO...');
assert.strictEqual(ui.connectingText('initializing', info), "Connecting to staticforge.737.jp.net using 'WAN Miniport (L-PPoP)'...");
assert.strictEqual(ui.connectingText('dialing', info), "Connecting to staticforge.737.jp.net using 'WAN Miniport (L-PPoP)'...");
assert.strictEqual(ui.connectingText('negotiation', info), 'Verifying user name and password...');
assert.strictEqual(ui.connectingText('establishing', info), 'Registering your computer on the network...');
assert.strictEqual(ui.connectingText('connected', info), 'Connected to CONTOSO.');
assert.strictEqual(ui.attemptText({ attempt: 0, maxAttempts: 10 }), '');
assert.strictEqual(ui.attemptText({ attempt: 2, maxAttempts: 10 }), 'Redial attempt 2 of 10.');
assert.strictEqual(ui.errorTitle(info), 'Error Connecting to CONTOSO');

// RAS errors for websocket.js failure messages
const code = (msg, opts) => ui.errorFor(msg, opts).code;
assert.strictEqual(code('NO CARRIER — Server not responding'), 800);
assert.strictEqual(code('Server status unavailable after 30 attempts'), 800);
assert.strictEqual(code('NO CARRIER — Connection failed after several attempts. Use Redial to reconnect.'), 800);
assert.strictEqual(code('NO CARRIER — Network connection error. Max retry attempts reached.'), 800);
assert.strictEqual(code('NO CARRIER — Connection closed unexpectedly'), 629);
assert.strictEqual(code('NO CARRIER — Connection failed'), 619);
assert.strictEqual(code('NO CARRIER — Network connection error'), 619);
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
assert.deepStrictEqual(ui.connectionInfo(), { domain: 'DREAMSCAPE', fqdn: '10.0.0.4', connectionType: 'Ethernet', device: 'L-PPoP' });
global.melatonDomainName = () => 'KANMI';
assert.strictEqual(ui.connectionInfo().domain, 'KANMI');

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
            return new Function('WebSocketClient', `return function ${src.slice(at + 1, i + 1).trim()}`);
        }
    }
    throw new Error(`unbalanced ${name}`);
}
const wsSrc = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');
const FakeClient = { CONNECTION_BEATS: { dialing: { message: 'Dialing…' }, negotiation: { message: 'Negotiation…' } } };
const proto = {};
['_setConnectionBeat', 'cancelConnectionFromUser', 'manualReconnect'].forEach((name) => {
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

console.log('melaton network: ok');
