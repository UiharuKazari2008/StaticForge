'use strict';
// Small CDP client for the #1408 repro: one browser socket, flat sessions. Own headless Chromium only.
const WebSocket = require('/home/kanmi/staticforge/node_modules/ws');
const http = require('http');
const PORT = Number(process.env.CDP_PORT || 9361);

const getJson = (p) => new Promise((resolve, reject) => {
    http.get({ host: '127.0.0.1', port: PORT, path: p }, (res) => {
        let b = '';
        res.on('data', (c) => (b += c));
        res.on('end', () => resolve(JSON.parse(b)));
    }).on('error', reject);
});

async function connect() {
    const ver = await getJson('/json/version');
    const ws = new WebSocket(ver.webSocketDebuggerUrl, { perMessageDeflate: false, maxPayload: 256 * 1024 * 1024 });
    await new Promise((r, j) => { ws.on('open', r); ws.on('error', j); });
    let seq = 0;
    const pending = new Map();
    const handlers = new Set();
    ws.on('message', (m) => {
        const x = JSON.parse(m);
        if (x.id && pending.has(x.id)) { pending.get(x.id)(x); pending.delete(x.id); return; }
        handlers.forEach((h) => h(x));
    });
    const send = (method, params = {}, sessionId, timeoutMs = 60000) => new Promise((resolve, reject) => {
        const id = ++seq;
        const timer = setTimeout(() => { pending.delete(id); reject(new Error(`timeout ${method}`)); }, timeoutMs);
        pending.set(id, (x) => { clearTimeout(timer); if (x.error) reject(new Error(`${method}: ${x.error.message}`)); else resolve(x.result); });
        ws.send(JSON.stringify(sessionId ? { id, method, params, sessionId } : { id, method, params }));
    });
    return { send, on: (h) => handlers.add(h), off: (h) => handlers.delete(h), close: () => ws.close(), version: ver.Browser };
}

async function evaluate(cdp, sessionId, expression, timeoutMs = 60000) {
    const r = await cdp.send('Runtime.evaluate', { expression, returnByValue: true, awaitPromise: true }, sessionId, timeoutMs);
    if (r.exceptionDetails) throw new Error(`eval: ${(r.exceptionDetails.exception && r.exceptionDetails.exception.description) || r.exceptionDetails.text}`);
    return r.result.value;
}

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

async function newPhoneTab(cdp, initSource) {
    const { targetId } = await cdp.send('Target.createTarget', { url: 'about:blank' });
    const { sessionId } = await cdp.send('Target.attachToTarget', { targetId, flatten: true });
    for (const d of ['Page', 'Runtime', 'Network']) await cdp.send(`${d}.enable`, {}, sessionId);
    await cdp.send('Emulation.setDeviceMetricsOverride', { width: 412, height: 915, deviceScaleFactor: 2.625, mobile: true }, sessionId);
    await cdp.send('Emulation.setTouchEmulationEnabled', { enabled: true, maxTouchPoints: 5 }, sessionId);
    await cdp.send('Page.addScriptToEvaluateOnNewDocument', { source: initSource }, sessionId);
    await cdp.send('Target.activateTarget', { targetId });
    return { targetId, sessionId };
}

// The app's bridge, as little of it as the shell needs to count as the installed app, and a guard: a dev-login
// tab is an administrator and would ack the household's notices 'seen' (shared memory #327), so no ack leaves.
const BASE_INIT = `(() => {
    window.AndroidCaption = window.AndroidCaption || {};
    const send = WebSocket.prototype.send;
    WebSocket.prototype.send = function (d) {
        if (typeof d === 'string' && /"type"\\s*:\\s*"inbox_ack"/.test(d)) {
            try { sessionStorage.setItem('r1408AckDropped', String(1 + Number(sessionStorage.getItem('r1408AckDropped') || 0))); } catch (_) {}
            return undefined;
        }
        return send.call(this, d);
    };
})();`;

module.exports = { connect, evaluate, sleep, newPhoneTab, getJson, BASE_INIT, PORT };
