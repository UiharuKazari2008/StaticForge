#!/usr/bin/env node
// lib/cdp.js - evaluate JavaScript in the app's WebView page over its DevTools port (lane.sh <id> eval / cdp).
//   node cdp.js <port> list                 -> the pages (JSON)
//   node cdp.js <port> eval '<js>'          -> the result value as JSON ({ok, value|error}); promises are awaited
// Needs the `ws` package (NODE_PATH=<staticforge>/node_modules, set by lane.sh).
'use strict';
const http = require('http');
const WebSocket = require('ws');

const port = Number(process.argv[2]);
const op = process.argv[3];
const js = process.argv.slice(4).join(' ');

function getJson(url) {
    return new Promise((resolve, reject) => {
        const r = http.get(url, { timeout: 8000 }, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); });
        r.on('error', reject);
        r.on('timeout', () => { r.destroy(new Error('DevTools port did not answer')); });
    });
}

(async () => {
    const pages = (await getJson(`http://127.0.0.1:${port}/json/list`)).filter((p) => p.type === 'page');
    if (op === 'list') { console.log(JSON.stringify(pages.map((p) => ({ id: p.id, title: p.title, url: p.url })))); return; }
    if (op !== 'eval') throw new Error('usage: cdp.js <port> list|eval <js>');
    if (!pages.length) throw new Error('no WebView page (is the app running? lane.sh <id> cdp)');
    const ws = new WebSocket(pages[0].webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    const res = await new Promise((resolve) => {
        const timer = setTimeout(() => resolve({ error: 'timeout (30 s)' }), 30000);
        ws.on('message', (m) => { const d = JSON.parse(m); if (d.id === 1) { clearTimeout(timer); resolve(d.result ? d.result : { error: d.error }); } });
        ws.send(JSON.stringify({ id: 1, method: 'Runtime.evaluate', params: { expression: js, awaitPromise: true, returnByValue: true } }));
    });
    ws.close();
    if (res.exceptionDetails) { console.log(JSON.stringify({ ok: false, error: (res.exceptionDetails.exception && res.exceptionDetails.exception.description) || res.exceptionDetails.text })); process.exit(1); }
    if (res.error) { console.log(JSON.stringify({ ok: false, error: res.error })); process.exit(1); }
    console.log(JSON.stringify({ ok: true, value: res.result ? res.result.value : null }));
    process.exit(0);
})().catch((e) => { console.log(JSON.stringify({ ok: false, error: e.message })); process.exit(1); });
