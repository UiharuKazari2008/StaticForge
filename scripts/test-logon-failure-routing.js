#!/usr/bin/env node
/**
 * Logon failures (Yozora #515): a connect that fails while /status says the server boots goes
 * back to the logon dialog with the Mainframe Server window and retries (no Error 800); a ready
 * server that fails shows one error (the app-data message box is dismissed); the boot message
 * box uses Vista push buttons.
 * public/scripts/websocket.js, public/scripts/comp/bootMessageBox.js, public/css/desktop-boot.css
 */
const assert = require('assert');
const fs = require('fs');
const path = require('path');

const src = fs.readFileSync(path.join(__dirname, '../public/scripts/websocket.js'), 'utf8');

function liftMethod(name) {
    const at = [`\n    async ${name}(`, `\n    ${name}(`].map((n) => src.indexOf(n)).find((i) => i >= 0);
    assert.ok(at >= 0, `websocket.js has ${name}`);
    const start = at + 1;
    let depth = 0;
    let quote = null;
    for (let i = src.indexOf('{', start); i < src.length; i++) {
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
            const text = src.slice(start, i + 1).trim();
            return new Function('WebSocketClient', `return function ${text}`);
        }
    }
    throw new Error(`unbalanced ${name}`);
}

const WSC = { DELAY_PING_HOST: 5 };
const proto = {};
['_serverReportsBooting', '_scheduleBootWaitReconnect', '_dismissLogonInitError'].forEach((name) => {
    proto[name] = liftMethod(name)(WSC);
});

(async () => {
    // _serverReportsBooting: only an explicit isReady:false
    const c = Object.create(proto);
    c.lastServerStartupStatus = null;
    assert.strictEqual(c._serverReportsBooting(), false);
    c.lastServerStartupStatus = { isReady: true, stageMessage: 'Starting Dreamscape…' };
    assert.strictEqual(c._serverReportsBooting(), false, 'a ready server with its leftover stage is not booting');
    c.lastServerStartupStatus = { isReady: false, stageMessage: 'Loading models', progressPercent: 40 };
    assert.strictEqual(c._serverReportsBooting(), true);

    // _scheduleBootWaitReconnect: one retry, only while still failed
    let reconnects = 0;
    c.connectionPhase = 'failed';
    c._isStartupHaltedForInstall = () => false;
    c.manualReconnect = () => { reconnects++; };
    c._scheduleBootWaitReconnect();
    c._scheduleBootWaitReconnect();
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(reconnects, 1, 'one pending retry at a time');
    c.connectionPhase = 'dialing';
    c._scheduleBootWaitReconnect();
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(reconnects, 1, 'no retry once the phase moved on');
    c.connectionPhase = 'failed';
    c._userCancelledConnect = true;
    c._scheduleBootWaitReconnect();
    await new Promise((r) => setTimeout(r, 30));
    assert.strictEqual(reconnects, 1, 'no retry after the user cancelled');

    // _dismissLogonInitError: closes our message box and drops the error
    let dismissed = 0;
    global.window = { bootMessageBox: { dismiss: () => { dismissed++; } } };
    const d = Object.create(proto);
    d._logonInitError = null;
    d._dismissLogonInitError();
    assert.strictEqual(dismissed, 0, 'nothing to dismiss');
    d._logonInitError = { message: 'Melaton could not load your application data.' };
    d._logonInitBoxOpen = true;
    d._dismissLogonInitError();
    assert.strictEqual(dismissed, 1);
    assert.strictEqual(d._logonInitError, null);
    assert.strictEqual(d._logonInitBoxOpen, false);

    // Routing in _renderConnectionDial and the waiting line in pingHost
    assert.ok(/if \(phase === 'failed'\) this\._dismissLogonInitError\(\);/.test(src), 'failure dismisses the app-data box');
    assert.ok(/phase === 'failed' && window\.isDesktop && this\._serverReportsBooting\(\)/.test(src), 'booting failure stays in the logon dialog');
    assert.ok(/this\._serverReportsBooting\(\) && this\.lastServerStartupStatus\.stageMessage/.test(src), 'stage line only while booting');
    assert.ok(/if \(value == null\) return;/.test(src), 'a dismissed box does not retry or restart');

    // Message box: Vista push buttons and face, Classic kept
    const box = fs.readFileSync(path.join(__dirname, '../public/scripts/comp/bootMessageBox.js'), 'utf8');
    assert.ok(/btn\.className = 'btn-standard'/.test(box), 'message box buttons are btn-standard');
    assert.ok(/dismiss/.test(box), 'message box has dismiss()');
    const css = fs.readFileSync(path.join(__dirname, '../public/css/desktop-boot.css'), 'utf8');
    assert.ok(/#bootMessageBox \.boot-message-box-content \{[^}]*background: #f0f0f0/.test(css), 'Vista light face');
    assert.ok(/body\.windows-classic-theme #bootMessageBox \.boot-message-box-content \{[^}]*ButtonFace/.test(css), 'Classic keeps ButtonFace');

    console.log('test-logon-failure-routing: ok');
})().catch((error) => {
    console.error(error);
    process.exit(1);
});
