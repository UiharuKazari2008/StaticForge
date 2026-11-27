#!/usr/bin/env node
// Signs the emulator's DSApp WebView in to the live server without a password (aemu.sh signin):
//   - the site gate's dsk cookie = the access hash from secure.config.json (SiteAccess.check takes a dsk the WebView
//     holds, and syncFromWebView keeps it in the app's Keystore-protected prefs);
//   - a fresh dev-login session (loopback /agent with the dev-login key, Yukimi-approved for test clients), so the
//     emulator has a session of its own that the test-device fence can own.
// Values are never printed. Usage: node signin.js <cdpPort> [--register] [--device <32 hex id>]   (lane.sh <id> cdp must have forwarded the app's DevTools)
'use strict';
const fs = require('fs');
const http = require('http');
const os = require('os');
const WebSocket = require('ws');

const CDP = Number(process.argv[2] || 9340);
const di = process.argv.indexOf('--device');
const DEVICE_ID = di > 0 ? String(process.argv[di + 1] || '').trim() : '';
const REGISTER_ONLY = process.argv.includes('--register');   // only tell the server which session the WebView holds
const ORIGIN = 'https://staticforge.737.jp.net';
const secure = JSON.parse(fs.readFileSync('/home/kanmi/staticforge/secure.config.json', 'utf8'));
const dsk = String((secure.siteAccess && secure.siteAccess.hash) || '').trim();
const devKey = fs.readFileSync(`${os.homedir()}/.secrets/dreamscape-dev-login.key`, 'utf8').trim();

function get(url, headers) {
    return new Promise((resolve, reject) => {
        http.get(url, { headers }, (res) => { res.resume(); res.on('end', () => resolve(res)); }).on('error', reject);
    });
}
function getJson(url) {
    return new Promise((resolve, reject) => {
        http.get(url, (res) => { let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } }); }).on('error', reject);
    });
}

function api(method, path, body) {
    const key = fs.readFileSync(`${os.homedir()}/.secrets/dreamscape-claude.key`, 'utf8').trim();
    return new Promise((resolve, reject) => {
        const data = JSON.stringify(body || {});
        const req = http.request({ host: '127.0.0.1', port: 9220, path, method, headers: { Authorization: `Bearer ${key}`, 'X-StaticForge-App-Key': key, 'User-Agent': 'claude-code', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) } }, (res) => {
            let b = ''; res.on('data', (d) => { b += d; }); res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_e) { resolve({ raw: b.slice(0, 200) }); } });
        });
        req.on('error', reject); req.end(data);
    });
}

(async () => {
    if (!dsk) throw new Error('no site access hash in secure.config.json');
    if (REGISTER_ONLY) return register();
    const res = await get('http://127.0.0.1:9220/agent', { Authorization: `Bearer ${devKey}`, 'X-Forwarded-Proto': 'https', 'User-Agent': 'claude-code lane' });
    const sc = [].concat(res.headers['set-cookie'] || []).find((c) => c.startsWith('connect.sid='));
    if (!sc) throw new Error(`no session from /agent (HTTP ${res.statusCode})`);
    const sid = sc.split(';')[0].slice('connect.sid='.length);

    return register(sid);
})().catch((e) => { console.error(`signin: ${e.message}`); process.exit(1); });

async function register(sid) {
    const pages = await getJson(`http://127.0.0.1:${CDP}/json/list`);
    const page = pages.find((p) => p.type === 'page') || pages[0];
    if (!page) throw new Error('no WebView page on the DevTools port');
    const ws = new WebSocket(page.webSocketDebuggerUrl);
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    let n = 0;
    const call = (method, params = {}) => new Promise((resolve) => {
        const id = ++n;
        const on = (m) => { const d = JSON.parse(m); if (d.id === id) { ws.off('message', on); resolve(d.result || d.error); } };
        ws.on('message', on);
        ws.send(JSON.stringify({ id, method, params }));
    });
    await call('Network.enable');
    if (sid) await setCookies(call, sid);
    const have = await call('Network.getCookies', { urls: [ORIGIN] });
    const cs = (have.cookies || []).find((c) => c.name === 'connect.sid');
    // the session id is the part of the signed cookie between "s:" and the signature
    const held = cs ? decodeURIComponent(cs.value).replace(/^s:/, '').replace(/\.[^.]*$/, '') : '';
    let fenced = false;
    try {
        const dev = DEVICE_ID;
        if (dev && held) fenced = !!(await api('PUT', `/api/test-devices/${dev}`, { sessionId: held })).success;
    } catch (_e) { /* no device id yet: lane.sh marks it after the app made one */ }
    console.log(JSON.stringify({ cookies: (have.cookies || []).map((c) => c.name), sessionFenced: fenced }));
    ws.close();
    process.exit(0);
}

async function setCookies(call, sid) {
    const exp = Math.floor(Date.now() / 1000);
    const a = await call('Network.setCookie', { name: 'dsk', value: dsk, url: ORIGIN, path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: exp + 400 * 86400 });
    const b = await call('Network.setCookie', { name: 'connect.sid', value: sid, url: ORIGIN, path: '/', secure: true, httpOnly: true, sameSite: 'Strict', expires: exp + 7 * 86400 });
    if (!(a && a.success) || !(b && b.success)) throw new Error('a cookie was not set');
}
