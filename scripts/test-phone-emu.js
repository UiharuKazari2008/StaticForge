#!/usr/bin/env node
'use strict';
/**
 * test-phone-emu.js - phone behaviour checks against the Fold7 test emulator on Ruiko (scripts/fold7-emu.sh), so
 * Yukimi's phone is not the test harness (Nov 18 2026). Prints PASS / FAIL with numbers.
 *
 *   node scripts/test-phone-emu.js setup        sign the app's WebView in (site cookie + a fresh dev-login session) and
 *                                               mark the emulator a test device (its notices run in the test lane)
 *   node scripts/test-phone-emu.js partner      propose the ActiveSync partnership (accepted on the emulator by tap)
 *   node scripts/test-phone-emu.js eval '<js>'   evaluate in the app's page (JSON out)
 *   node scripts/test-phone-emu.js run [--only a,b,c,d] [--out DIR]
 *        a  cold start: no network (the reference), then online, HTTPS black-holed (requests hang), slow (netem 2 s,
 *           64 kbit/s), flaky (netem 40 % loss): launch -> Today drawn within the reference + 1.5 s; also the requests
 *           to the server before Today and the app's native server check / boot cover times (logcat)
 *        b  status bar: every visible title-bar icon inside the screen and clear of the camera cutout (Android's own
 *           cutout, from dumpsys), the close corner visible when shown; inner, cover, after a fold and an unfold
 *        c  the notification icon: hidden while the test lane is empty, shown with a waiting notice, a tap opens it
 *        d  a test-lane notice with another program in front shows as the app's WM box, not Android's heads-up
 *
 * Needs: the emulator up (fold7-emu.sh up), the app installed (fold7-emu.sh install <apk>); secrets read at run time
 * (never printed): ~/.secrets/dreamscape-claude.key (admin API on loopback), ~/.secrets/dreamscape-dev-login.key and
 * secure.config.json siteAccess.hash (setup only). State in ~/.config/fold7-test/ (device-id, computer-id).
 * Rules: never loops an install, never touches any device but its own emulator serial, test notices only through
 * /api/test-devices (they reach test devices alone).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');
const http = require('http');
const crypto = require('crypto');
const { execFileSync } = require('child_process');
const WebSocket = require('ws');

const ROOT = path.join(__dirname, '..');
const EMU = path.join(__dirname, 'fold7-emu.sh');
const CDP_PORT = Number(process.env.FOLD7_CDP || 9352);
const STATE = path.join(os.homedir(), '.config', 'fold7-test');
const ORIGIN = 'https://staticforge.737.jp.net';
const PKG = 'jp.net.seventhreeseven.dreamscape';
const SERVER_RE = /^https?:\/\/(staticforge\.737\.jp\.net|127\.0\.0\.1:9220)\//;
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const secret = (f) => fs.readFileSync(path.join(os.homedir(), '.secrets', f), 'utf8').trim();
fs.mkdirSync(STATE, { recursive: true });

// ---- device / server helpers -----------------------------------------------------------------------------------

function emu(...args) {
    try {
        return execFileSync(EMU, args, { encoding: 'utf8', timeout: 120000, stdio: ['ignore', 'pipe', 'pipe'] });
    } catch (e) {
        return String((e.stdout || '') + (e.stderr || ''));
    }
}
const dev = (cmd) => emu('sh', cmd);

function api(method, p, body) {
    const key = secret('dreamscape-claude.key');
    return new Promise((resolve, reject) => {
        const data = body === undefined ? '' : JSON.stringify(body);
        const req = http.request({
            host: '127.0.0.1', port: 9220, path: p, method,
            headers: { Authorization: `Bearer ${key}`, 'X-StaticForge-App-Key': key, 'User-Agent': 'claude-code', 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(data) }
        }, (res) => {
            let b = '';
            res.on('data', (d) => { b += d; });
            res.on('end', () => { try { resolve(JSON.parse(b)); } catch (_e) { resolve({ success: false, status: res.statusCode, raw: b.slice(0, 200) }); } });
        });
        req.on('error', reject);
        req.end(data);
    });
}

function getJson(url, ms = 3000) {
    return new Promise((resolve, reject) => {
        const r = http.get(url, { timeout: ms }, (res) => {
            let b = '';
            res.on('data', (d) => { b += d; });
            res.on('end', () => { try { resolve(JSON.parse(b)); } catch (e) { reject(e); } });
        });
        r.on('timeout', () => r.destroy(new Error('timeout')));
        r.on('error', reject);
    });
}

const deviceIdFile = path.join(STATE, 'device-id');
const deviceId = () => { try { return fs.readFileSync(deviceIdFile, 'utf8').trim(); } catch (_e) { return ''; } };

/** The app's ActiveSync device id on the emulator (root read of its prefs). */
function readDeviceId() {
    const out = dev(`cat /data/data/${PKG}/shared_prefs/activesync.xml 2>/dev/null`);
    const m = out.match(/name="device_id">([0-9a-f]{32})</);
    return m ? m[1] : '';
}

// ---- CDP ---------------------------------------------------------------------------------------------------------

/** Forward the app's DevTools (new pid after every start) and open a session on its page. */
async function cdp({ waitMs = 15000 } = {}) {
    const t0 = Date.now();
    let page = null;
    while (Date.now() - t0 < waitMs) {
        const pid = dev(`pidof ${PKG}`).trim().split(/\s+/)[0];
        if (pid) {
            emu('adb', 'forward', `tcp:${CDP_PORT}`, `localabstract:webview_devtools_remote_${pid}`);
            try {
                const list = await getJson(`http://127.0.0.1:${CDP_PORT}/json/list`, 1500);
                page = list.find((p) => p.type === 'page');
                if (page) break;
            } catch (_e) { /* not up yet */ }
        }
        await sleep(150);
    }
    if (!page) throw new Error('no WebView page on the DevTools port');
    const ws = new WebSocket(page.webSocketDebuggerUrl.replace('localhost', '127.0.0.1'), { perMessageDeflate: false });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    let n = 0;
    const pending = new Map();
    const listeners = [];
    ws.on('message', (m) => {
        const d = JSON.parse(m);
        if (d.id && pending.has(d.id)) { const { resolve, reject } = pending.get(d.id); pending.delete(d.id); if (d.error) reject(new Error(JSON.stringify(d.error))); else resolve(d.result); return; }
        if (d.method) for (const l of listeners) l(d.method, d.params);
    });
    const send = (method, params = {}, ms = 10000) => new Promise((resolve, reject) => {
        const id = ++n;
        pending.set(id, { resolve, reject });
        ws.send(JSON.stringify({ id, method, params }));
        setTimeout(() => { if (pending.delete(id)) reject(new Error(`${method}: timeout`)); }, ms);
    });
    const evaluate = async (expr, ms = 10000) => {
        const r = await send('Runtime.evaluate', { expression: expr, returnByValue: true, awaitPromise: true }, ms);
        if (r.exceptionDetails) throw new Error(`page: ${r.exceptionDetails.exception && r.exceptionDetails.exception.description || r.exceptionDetails.text}`);
        return r.result.value;
    };
    return { send, evaluate, on: (fn) => listeners.push(fn), close: () => ws.close(), page };
}

// ---- setup ---------------------------------------------------------------------------------------------------------

async function setup() {
    const secure = JSON.parse(fs.readFileSync(path.join(ROOT, 'secure.config.json'), 'utf8'));
    const dsk = String((secure.siteAccess && secure.siteAccess.hash) || '').trim();
    if (!dsk) throw new Error('no site access hash in secure.config.json');
    const c = await cdp();
    await c.send('Network.enable');
    const have = await c.send('Network.getCookies', { urls: [ORIGIN] });
    let sid = ((have.cookies || []).find((x) => x.name === 'connect.sid') || {}).value || '';
    if (!sid || !(have.cookies || []).some((x) => x.name === 'dsk')) {
        // a fresh dev-login session of its own (loopback /agent; X-Forwarded-Proto so the secure cookie is set)
        const res = await new Promise((resolve, reject) => {
            http.get('http://127.0.0.1:9220/agent', { headers: { Authorization: `Bearer ${secret('dreamscape-dev-login.key')}`, 'X-Forwarded-Proto': 'https', 'User-Agent': 'claude-code fold7-test' } }, (r) => { r.resume(); r.on('end', () => resolve(r)); }).on('error', reject);
        });
        const sc = [].concat(res.headers['set-cookie'] || []).find((x) => x.startsWith('connect.sid='));
        if (!sc) throw new Error(`no session from /agent (HTTP ${res.statusCode})`);
        sid = sc.split(';')[0].slice('connect.sid='.length);
        const exp = Math.floor(Date.now() / 1000);
        const a = await c.send('Network.setCookie', { name: 'dsk', value: dsk, url: ORIGIN, path: '/', secure: true, httpOnly: true, sameSite: 'Lax', expires: exp + 400 * 86400 });
        const b = await c.send('Network.setCookie', { name: 'connect.sid', value: sid, url: ORIGIN, path: '/', secure: true, httpOnly: true, sameSite: 'Strict', expires: exp + 7 * 86400 });
        if (!(a && a.success) || !(b && b.success)) throw new Error('a cookie was not set');
        console.log('signed in: cookies set (tap Restart on the Recovery screen if it shows)');
    } else {
        console.log('already signed in: kept the session');
    }
    c.close();
    const held = decodeURIComponent(sid).replace(/^s:/, '').replace(/\.[^.]*$/, '');
    const id = readDeviceId() || deviceId();
    if (id) {
        fs.writeFileSync(deviceIdFile, id);
        const m = await api('PUT', `/api/test-devices/${id}`, { name: 'Fold7 test emulator (fold7-test)', sessionId: held });
        console.log(`test device ${id.slice(0, 8)}: ${m.success ? 'marked, session fenced' : `NOT marked ${JSON.stringify(m).slice(0, 120)}`}`);
    } else {
        console.log('no device id yet (the app makes one on its first start): run setup again once the page is up');
    }
    // once the page is up: the bars on (the Fold's settings: camera extends the bar, #913)
    try {
        const p = await cdp();
        const on = await p.evaluate(`(() => { try { localStorage.setItem('wmCameraExtendBar', '1'); } catch (_) {}
            if (window.AndroidBars && AndroidBars.setConfig) { AndroidBars.setConfig(JSON.stringify({ enabled: true })); return 'bars on'; } return 'no AndroidBars bridge (installer page?)'; })()`);
        p.close();
        console.log(on);
    } catch (e) { console.log(`page settings not set: ${e.message}`); }
    console.log(emu('appsetup').trim());
}

// ---- partner -------------------------------------------------------------------------------------------------------

async function partner() {
    const id = deviceId();
    if (!id) throw new Error('no device id: run setup first');
    const t = await api('GET', '/api/test-devices');
    if (!(t.devices || []).some((d) => d.id === id)) throw new Error(`${id} is not marked a test device: refusing to partner it`);
    const idFile = path.join(STATE, 'computer-id');
    if (!fs.existsSync(idFile)) fs.writeFileSync(idFile, crypto.randomBytes(16).toString('hex'));
    const computer = fs.readFileSync(idFile, 'utf8').trim();
    const a = await new Promise((resolve, reject) => {
        http.get('http://127.0.0.1:9220/agent', { headers: { Authorization: `Bearer ${secret('dreamscape-dev-login.key')}`, 'X-Forwarded-Proto': 'https', 'User-Agent': 'claude-code fold7-test' } }, (r) => { r.resume(); r.on('end', () => resolve(r)); }).on('error', reject);
    });
    const sc = [].concat(a.headers['set-cookie'] || []).find((x) => x.startsWith('connect.sid='));
    if (!sc) throw new Error('no harness session');
    const ws = new WebSocket('ws://127.0.0.1:9220/', { headers: { Cookie: sc.split(';')[0], 'X-Forwarded-Proto': 'https', 'User-Agent': 'claude-code fold7-test' } });
    let n = 0;
    const pending = new Map();
    ws.on('message', (m) => {
        let d; try { d = JSON.parse(m); } catch (_e) { return; }
        if (d.requestId && pending.has(d.requestId)) { pending.get(d.requestId)(d); pending.delete(d.requestId); }
    });
    const send = (type, data, ms = 15000) => new Promise((resolve, reject) => {
        const requestId = `fold7-${++n}`;
        pending.set(requestId, resolve);
        ws.send(JSON.stringify({ type, data, requestId }));
        setTimeout(() => { if (pending.delete(requestId)) reject(new Error(`${type}: no answer`)); }, ms);
    });
    await new Promise((r, j) => { ws.once('open', r); ws.once('error', j); });
    await sleep(1500);
    const h = await send('as_hello', { kind: 'computer', id: computer, name: 'fold7-test harness', ops: [] });
    if (!h.data || !h.data.success) throw new Error(`hello refused: ${JSON.stringify(h.data || h).slice(0, 200)}`);
    console.log(`proposing the partnership to ${id.slice(0, 8)} - accept it on the emulator (screen shot: fold7-emu.sh shot)`);
    const p = await send('as_partnership', { action: 'propose', deviceId: id, mode: 'partner', name: 'Fold7 test emulator', syncItems: [] }, 200000);
    console.log(JSON.stringify({ success: p.data && p.data.success, accepted: p.data && p.data.accepted, code: p.data && p.data.code, error: p.data && p.data.error }));
    ws.close();
    return p.data && p.data.accepted;
}

// ---- run: the checks -----------------------------------------------------------------------------------------------

const results = [];
function report(check, name, pass, detail) {
    results.push({ check, name, pass, detail });
    console.log(`${pass === null ? 'SKIP' : pass ? 'PASS' : 'FAIL'}  ${check} ${name}${detail ? `  ${detail}` : ''}`);
}

/** Display 0 now: size in px (after a fold override) and Android's top camera cutout. */
function screenNow() {
    const size = dev('wm size');
    const ov = size.match(/Override size: (\d+)x(\d+)/);
    const ph = size.match(/Physical size: (\d+)x(\d+)/);
    const [w, h] = (ov || ph).slice(1).map(Number);
    const rot = Number(dev("dumpsys window displays | grep -m1 -oE 'mCurrentRotation=ROTATION_[0-9]+'").replace(/\D/g, '') || 0) / 90;
    const cut = dev("dumpsys window displays | grep -A300 '^  Display: mDisplayId=0' | grep -m1 'mDisplayCutout='");
    const rects = [...cut.replace(/.*boundingRect=\{Bounds=\[/, '').replace(/\]\}.*/s, '').matchAll(/Rect\((-?\d+), (-?\d+) - (-?\d+), (-?\d+)\)/g)]
        .map((m) => m.slice(1).map(Number)).filter(([l, t, r, b]) => r > l && b > t);
    const bar = dev("dumpsys window displays | grep -A300 '^  Display: mDisplayId=0' | grep -m1 -oE 'type=statusBars frame=\\[[0-9,]+\\]\\[[0-9,]+\\]'");
    const bm = bar.match(/\]\[\d+,(\d+)\]/);
    const sideways = rot === 1 || rot === 3;
    return { w: sideways ? h : w, h: sideways ? w : h, rot, cutouts: rects, statusBar: bm ? Number(bm[1]) : null };
}

/**
 * Clear the test lane one notice at a time (DELETE /api/test-devices/notices is shadowed by DELETE /:id on the server,
 * Nov 18): this harness's own notices, and any older than 10 minutes (the other test emulator's live tests are spared).
 */
async function clearLane() {
    const r = await api('GET', '/api/test-devices');
    const open = (r.notices || []).filter((n) => n.state !== 'cleared' && (String(n.id).startsWith('fold7:') || Date.now() - n.createdAt > 600000));
    for (const n of open) await api('POST', `/api/test-devices/notice/${encodeURIComponent(n.id)}/clear`);
    return open.length;
}
const noticeId = () => `fold7:${Date.now().toString(36)}`;

const PAGE_TODAY = `(() => { const r = document.documentElement; const t = document.querySelector('#wmShell .wm-page.wm-today');
    return !!(r.dataset.wmBoot === 'done' && t && !t.hidden && t.getClientRects().length); })()`;

const PAGE_BOOTED = `(() => { const b = document.querySelector('#wmShell .wm-titlebar');
    return !!(document.documentElement.dataset.wmBoot === 'done' && b && b.getClientRects().length); })()`;

async function waitToday(c, ms, anyScreen) {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) {
        try { if (await c.evaluate(anyScreen ? PAGE_BOOTED : PAGE_TODAY, 3000)) return Date.now(); } catch (_e) { /* navigating */ }
        await sleep(100);
    }
    return 0;
}

/** a: cold start with the given network; launch -> Today, and the requests to the server before Today. */
async function coldStart(mode, baseline, opts = {}) {
    emu('stop-app');
    emu('net', mode);
    await sleep(1500);
    const mark = dev("date '+%m-%d %H:%M:%S.000'").trim();
    const t0 = Date.now();
    dev(`am start --display 0 -a android.intent.action.MAIN -c android.intent.category.LAUNCHER -n ${PKG}/.MainActivity`);
    let c;
    const net = [];
    try {
        c = await cdp({ waitMs: 20000 });
        c.on((m, p) => {
            if (m === 'Network.requestWillBeSent' && SERVER_RE.test(p.request.url)) net.push({ id: p.requestId, url: p.request.url, at: Date.now(), state: 'pending' });
            const r = net.find((x) => x.id === p.requestId);
            if (!r) return;
            if (m === 'Network.responseReceived') { r.state = p.response.fromServiceWorker ? 'sw' : p.response.fromDiskCache ? 'cache' : `net ${p.response.status}`; r.end = Date.now(); }
            if (m === 'Network.loadingFailed') { if (r.state === 'pending') r.state = `failed ${p.errorText}`; r.end = Date.now(); }
        });
        await c.send('Network.enable');
    } catch (e) {
        report('a', `cold start, network ${mode}`, false, `no page: ${e.message}`);
        emu('net', 'on');
        return null;
    }
    const attachMs = Date.now() - t0;
    const at = await waitToday(c, 40000);
    const ms = at ? at - t0 : null;
    // what the page fetched before Today (also before DevTools attached): resource timing, nav served by the SW?
    let perf = {};
    try {
        perf = await c.evaluate(`(() => { const nav = performance.getEntriesByType('navigation')[0] || {};
            const today = performance.now();
            const res = performance.getEntriesByType('resource').filter((e) => /staticforge\\.737\\.jp\\.net/.test(e.name));
            return { path: location.pathname, navSW: nav.workerStart > 0, navTransfer: nav.transferSize, navEnd: Math.round(nav.responseEnd || 0),
                pageMs: Math.round(today), resources: res.length,
                network: res.filter((e) => e.transferSize > 0 && !(e.workerStart > 0)).map((e) => e.name.replace(/^https:\\/\\/[^/]+/, '')).slice(0, 8) }; })()`);
    } catch (_e) { /* page gone */ }
    let stuck = '';
    if (!at) {
        try {
            stuck = await c.evaluate(`location.href.replace(/^https:\\/\\/[^/]+/, '') + ' boot=' + document.documentElement.dataset.wmBoot + ' "' + ((document.body && document.body.innerText) || '').replace(/\\s+/g, ' ').slice(0, 90) + '"'`, 4000);
        } catch (e) { stuck = `page not answering (${e.message})`; }
        if (opts.out) emu('shot', path.join(opts.out, `a-${mode}-stuck.png`));
    }
    // the native side (DSApp): its startup server check and the boot cover, from logcat (device times)
    const lc = dev(`logcat -d -v time -T '${mark}' | grep -E 'ActivityTaskManager.*START u0.*${PKG}|SiteAccess.*startup check|BootCover.*(cover removed|out of reach)' | grep -v adbd`);
    const tms = (re) => { const m = lc.split('\n').find((l) => re.test(l)); const t = m && m.match(/(\d\d):(\d\d):(\d\d)\.(\d\d\d)/); return t ? ((+t[1] * 60 + +t[2]) * 60 + +t[3]) * 1000 + +t[4] : null; };
    const tStart = tms(/START u0/);
    const tCheck = tms(/SiteAccess/);
    const tCover = tms(/cover removed/);
    const checkLine = (lc.split('\n').find((l) => /SiteAccess/.test(l)) || '').replace(/.*startup check: /, '').slice(0, 60);
    const native = tStart !== null ? `native: server check ${tCheck !== null ? `${tCheck - tStart} ms (${checkLine})` : 'not logged'}, boot cover removed ${tCover !== null ? `${tCover - tStart} ms` : 'not logged'}` : 'native: launch not in logcat';
    const before = net.filter((r) => !at || r.at <= at);
    const toNet = before.filter((r) => !/^(sw|cache)$/.test(r.state));
    const pendingAtToday = toNet.filter((r) => !r.end || r.end > at);
    c.close();
    emu('net', 'on');
    // pass: Today shows, and the start takes no longer than the online start plus 1.5 s (a wait on the server would
    // show as the timeout of a black-holed request, or a 2 s+ round trip on the slow link)
    const limit = baseline ? baseline + 1500 : 15000; // the reference run itself: 15 s at most
    const pass = !!ms && ms <= limit;
    report('a', `cold start, network ${mode}`, pass,
        `launch->Today ${ms === null ? 'NOT REACHED in 40 s' : `${ms} ms`} (limit ${limit} ms; ${native}; DevTools attached at ${attachMs} ms; page ${perf.path || '?'}, nav from SW ${perf.navSW}, ` +
        `requests to the server before Today seen: ${before.length}, to the network ${toNet.length}, still open at Today ${pendingAtToday.length}` +
        `${pendingAtToday.length ? `: ${pendingAtToday.slice(0, 5).map((r) => `${r.url.replace(/^https?:\/\/[^/]+/, '')} [${r.state}]`).join(', ')}` : ''})${stuck ? ` | stuck at ${stuck}` : ''}`);
    await sleep(2000);
    return ms;
}

async function checkA(out) {
    // the reference is the start with no network at all (nothing to wait for): every other start, online included,
    // must match it (installed-boot-zero-wait: network down, slow or flaky looks exactly like a fast start)
    const base = await coldStart('off', null, { out });
    for (const m of ['on', 'hang', 'slow', 'flaky']) await coldStart(m, base, { out });
}

/** b: the title bar's icons inside the screen and clear of the camera. */
async function statusBarCheck(label, out) {
    try { return await statusBarMeasure(label, out); } catch (e) {
        const alive = /booted: yes/.test(emu('status'));
        report('b', `status bar ${label}`, false, `${e.message}${alive ? '' : ' - the emulator is gone (qemu crash? Ruiko %TEMP%\\AndroidEmulator\\emu-crash-37.2.13.db)'}`);
        if (!alive) throw new Error('emulator gone');
        return null;
    }
}

async function statusBarMeasure(label, out) {
    await sleep(3000);
    const c = await cdp();
    const settled = await waitToday(c, 30000, true);
    await sleep(1500); // the bar fits again 300 / 1000 ms after the screen settles (fitStatusSettled)
    const scr = screenNow();
    const pg = await c.evaluate(`(() => {
        const dpr = devicePixelRatio, cs = getComputedStyle(document.documentElement);
        const vis = (el) => el && !el.hidden && el.getClientRects().length && getComputedStyle(el).visibility !== 'hidden' && +getComputedStyle(el).opacity > 0;
        const box = (el) => { const r = el.getBoundingClientRect(); return [r.left, r.top, r.right, r.bottom].map((v) => Math.round(v * dpr)); };
        const icons = [...document.querySelectorAll('#wmShell .wm-titlebar .wm-status-icon')].filter(vis).map((el) => ({ role: el.dataset.role, px: box(el) }));
        const x = document.querySelector('#wmShell .wm-titlebar .wm-title-action');
        const bar = document.querySelector('#wmShell .wm-titlebar');
        const hole = ['left', 'top', 'width', 'height'].map((k) => parseFloat(cs.getPropertyValue('--camera-hole-' + k)) || 0);
        return { dpr, css: [innerWidth, innerHeight], icons, close: vis(x) ? box(x) : null, bar: bar ? box(bar) : null,
            hole: hole[2] ? [hole[0], hole[1], hole[0] + hole[2], hole[1] + hole[3]].map((v) => Math.round(v * dpr)) : null,
            title: (document.querySelector('#wmShell .wm-title') || {}).textContent };
    })()`);
    c.close();
    if (out) emu('shot', path.join(out, `b-${label.replace(/\W+/g, '-')}.png`));
    const cam = scr.cutouts[0] || null;
    const hit = (a, b) => a[0] < b[2] && b[0] < a[2] && a[1] < b[3] && b[1] < a[3];
    const bad = [];
    for (const i of pg.icons) {
        if (i.px[0] < 0 || i.px[1] < 0 || i.px[2] > scr.w || i.px[3] > scr.h) bad.push(`${i.role} off screen ${i.px}`);
        if (cam && hit(i.px, cam)) bad.push(`${i.role} on the camera ${i.px}`);
    }
    if (pg.close) {
        if (pg.close[0] < 0 || pg.close[2] > scr.w) bad.push(`close off screen ${pg.close}`);
        if (cam && hit(pg.close, cam)) bad.push(`close on the camera ${pg.close}`);
    }
    const page = pg.css.map((v) => Math.round(v * pg.dpr));
    if (!settled) bad.push('page not booted after 30 s');
    report('b', `status bar ${label}`, bad.length === 0,
        `screen ${scr.w}x${scr.h} rot ${scr.rot}, page ${page.join('x')} @${pg.dpr}, camera ${cam ? `[${cam}]` : 'none'} (page's hole ${pg.hole ? `[${pg.hole}]` : 'none'}), Android bar ${scr.statusBar} px, page bar ${pg.bar ? pg.bar[3] - pg.bar[1] : '?'} px, ` +
        `${pg.icons.length} icons [${pg.icons.map((i) => `${i.role} ${i.px[0]}-${i.px[2]}`).join(', ')}], close ${pg.close ? `${pg.close[0]}-${pg.close[2]}` : 'not shown'}${bad.length ? ` | ${bad.join('; ')}` : ''}`);
    return pg;
}

async function checkB(out) {
    emu('unfold');
    emu('rotate', '0');
    emu('start-app');
    await clearLane();
    await statusBarCheck('inner (Today)', out);
    // with the "..." up (one more icon left of the camera): a test notice, its box dismissed
    await api('POST', '/api/test-devices/notice', { mode: 'push', id: noticeId(), title: 'fold7 test b', text: 'status bar check' });
    await sleep(2500);
    try { const c = await cdp(); await c.evaluate("(() => { const k = document.querySelector('#wmShell .wm-softkey[data-side=\"left\"]'); if (k && document.querySelector('#wmShell .wm-notify:not([hidden])')) k.click(); })()"); c.close(); } catch (_e) { /* no box */ }
    await statusBarCheck('inner (Today, notice waiting)', out);
    emu('fold');
    await statusBarCheck('cover (notice waiting)', out);
    emu('unfold');
    await clearLane();
    // a program open: the close corner shows
    try { const c = await cdp(); await c.evaluate("window.wmShell && wmShell.open && wmShell.open('settings')"); c.close(); } catch (_e) { /* no such app */ }
    await statusBarCheck('inner (program open)', out);
    emu('fold');
    await statusBarCheck('cover after fold', out);
    emu('rotate', '1');
    await statusBarCheck('cover turned', out);
    emu('rotate', '0');
    emu('unfold');
    await statusBarCheck('inner after unfold', out);
    emu('rotate', '1');
    await statusBarCheck('inner turned', out);
    emu('rotate', '0');
    try { const c = await cdp(); await c.evaluate("window.wmShell && wmShell.back && wmShell.back()"); c.close(); } catch (_e) { /* fine */ }
}

const NOTIFY = `(() => { const i = document.querySelector('#wmShell .wm-titlebar .wm-status-icon[data-role="notify"]');
    const r = i && i.getBoundingClientRect();
    return i ? { hidden: i.hidden || !i.getClientRects().length, label: i.getAttribute('aria-label'), dpr: devicePixelRatio,
        center: r ? [Math.round((r.left + r.width / 2) * devicePixelRatio), Math.round((r.top + r.height / 2) * devicePixelRatio)] : null,
        tray: !!document.querySelector('#wmShell .wm-notify-tray:not([hidden])'), bubble: !!document.querySelector('#wmShell .wm-bubble:not([hidden])'),
        box: !!document.querySelector('#wmShell .wm-notify:not([hidden])'),
        text: ((document.querySelector('#wmShell .wm-notify-tray:not([hidden]), #wmShell .wm-bubble:not([hidden]), #wmShell .wm-notify:not([hidden])') || {}).innerText || '').replace(/\s+/g, ' ').slice(0, 80) } : null; })()`;

async function pollNotify(c, want, ms) {
    const t0 = Date.now();
    let s = null;
    while (Date.now() - t0 < ms) {
        s = await c.evaluate(NOTIFY);
        if (s && want(s)) return { s, ms: Date.now() - t0 };
        await sleep(250);
    }
    return { s, ms: null };
}

/** c: the notification icon. */
async function checkC(out) {
    emu('unfold');
    emu('start-app');
    const cleared = await clearLane();
    let c = await cdp();
    await waitToday(c, 30000, true);
    const empty = await pollNotify(c, (s) => s.hidden, 15000);
    report('c', 'icon hidden with an empty test lane', empty.ms !== null, empty.s ? `${cleared} old notices cleared first; hidden=${empty.s.hidden} label="${empty.s.label}"${empty.ms !== null ? ` (${empty.ms} ms)` : ' after 15 s'}` : 'no icon element');
    const title = `fold7 test c ${new Date().toISOString().slice(11, 19)}`;
    const n = await api('POST', '/api/test-devices/notice', { mode: 'push', id: noticeId(), title, text: 'notification icon check' });
    if (!n.success) { report('c', 'test notice sent', false, JSON.stringify(n).slice(0, 160)); c.close(); return; }
    // a page in front shows the notice's box first; the icon stands for it (alone: its title; with others: a count)
    const mine = (s) => !s.hidden && (String(s.label).includes(title) || /^\d+ notifications/.test(String(s.label)));
    const shown = await pollNotify(c, (s) => mine(s) || s.box, 15000);
    let s0 = shown.s;
    if (s0 && s0.box) {
        if (out) emu('shot', path.join(out, 'c-box.png'));
        // put the box away the way a user does (Back: Hide, the notice stays waiting; Dismiss would clear it), then
        // the icon must hold the notice
        await c.evaluate("document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true })), 1");
        await sleep(800);
        s0 = (await pollNotify(c, mine, 8000)).s;
    }
    report('c', 'icon shown with a waiting notice', !!(s0 && mine(s0)), s0 ? `label="${s0.label}" (box shown first: ${!!(shown.s && shown.s.box)}, ${shown.ms} ms)` : '');
    if (s0 && mine(s0) && s0.center) {
        emu('tap', String(s0.center[0]), String(s0.center[1]));
        await sleep(1500);
        const s1 = await c.evaluate(NOTIFY);
        if (out) emu('shot', path.join(out, 'c-icon-tap.png'));
        const opened = s1.tray || s1.bubble || s1.box;
        report('c', 'tap on the icon opens it', opened, `tap at ${s0.center} -> tray=${s1.tray} bubble=${s1.bubble} box=${s1.box}; shows "${s1.text}"`);
        await c.evaluate("(() => { const k = document.querySelector('#wmShell .wm-softkey[data-side=\"left\"]'); if (k && (document.querySelector('#wmShell .wm-notify:not([hidden])'))) k.click(); })()");
    } else {
        report('c', 'tap on the icon opens it', null, 'icon not shown for the notice');
    }
    await clearLane();
    const gone = await pollNotify(c, (s) => s.hidden, 15000);
    report('c', 'icon hidden again after the server cleared the notice', gone.ms !== null, gone.ms !== null ? `${gone.ms} ms` : `still shown after 15 s: "${gone.s && gone.s.label}"`);
    c.close();
}

/** d: a notice with another program in front = the app's WM box, not Android's heads-up. */
async function checkD(out) {
    const id = deviceId();
    const t = await api('GET', '/api/test-devices');
    const me = (t.devices || []).find((d) => d.id === id);
    if (!me || !me.partner) { report('d', 'WM box over another program', null, `not partnered (device ${id.slice(0, 8) || 'none'}: ${me ? JSON.stringify({ online: me.online, partner: me.partner }) : 'not marked'}) - run partner`); return; }
    await clearLane();
    emu('start-app');
    await sleep(2000);
    emu('other');
    await sleep(2500);
    const mark = dev('date +%m-%d\\ %H:%M:%S.000').trim();
    const title = `fold7 test d ${new Date().toISOString().slice(11, 19)}`;
    const n = await api('POST', '/api/test-devices/notice', { mode: 'push', id: noticeId(), title, text: 'WM box check' });
    if (!n.success) { report('d', 'test notice sent', false, JSON.stringify(n).slice(0, 160)); return; }
    let box = '';
    let heads = '';
    let ms = null;
    let shot = false;
    const t0 = Date.now();
    // watch 12 s: the box must come, and Android's heads-up must not come at any time in it
    while (Date.now() - t0 < 12000) {
        if (!box) {
            box = dev(`logcat -d -T '${mark}' | grep -E 'MelatonBars.*(note |noteBox|bubble)|AppNotePopup' | grep -v adbd | tail -1`).trim();
            if (box) ms = Date.now() - t0;
        }
        if (box && !shot && out) { emu('shot', path.join(out, 'd-other-program.png')); shot = true; }
        const h = dev("dumpsys activity service com.android.systemui/.SystemUIService 2>/dev/null | grep -cE 'isHeadsUpState\\(\\)=true|isPinned\\(\\)=true'").trim();
        if (Number(h) > 0 && !heads) heads = `${h} heads-up rows at ${Date.now() - t0} ms`;
        await sleep(600);
    }
    const posted = dev('dumpsys notification --noredact').includes(title);
    report('d', 'WM box over another program', !!box, box ? `${ms} ms: ${box.slice(0, 150)}` : 'no WM box logged in 12 s');
    report('d', 'no Android heads-up', !heads, heads || `none in 12 s (the app's Android copy posted: ${posted})`);
    await clearLane();
    emu('home');
}

/**
 * e: Home outranks everything (HARD rule home-closes-everything, Nov 18): a notice's box over another program and
 * the page's own box on Today both go on Home; the notice stays waiting (the icon holds it).
 */
async function checkE(out) {
    await clearLane();
    emu('start-app');
    await sleep(2000);
    emu('other');
    await sleep(2500);
    const popupUp = () => /MelatonPopup/.test(dev("dumpsys window windows | grep -E 'Window\\{.*MelatonPopup' | head -1"));
    const title = `fold7 test e ${new Date().toISOString().slice(11, 19)}`;
    const n = await api('POST', '/api/test-devices/notice', { mode: 'push', id: noticeId(), title, text: 'Home check' });
    if (!n.success) { report('e', 'test notice sent', false, JSON.stringify(n).slice(0, 160)); return; }
    let up = false;
    const t0 = Date.now();
    while (!up && Date.now() - t0 < 12000) { up = popupUp(); if (!up) await sleep(500); }
    if (out && up) emu('shot', path.join(out, 'e-box-before-home.png'));
    report('e', 'notice box up over another program', up, up ? `${Date.now() - t0} ms` : 'no MelatonPopup window in 12 s');
    emu('home');
    await sleep(1500);
    const still = popupUp();
    if (out) emu('shot', path.join(out, 'e-after-home.png'));
    report('e', 'Home closes the native box', up ? !still : null, still ? 'MelatonPopup still up 1.5 s after Home' : 'gone');
    const c = await cdp();
    try {
        await waitToday(c, 15000, true);
        const s = (await pollNotify(c, (x) => !x.box, 4000)).s;
        report('e', 'no box on the page after Home', !!(s && !s.box), s ? `box=${s.box} tray=${s.tray} bubble=${s.bubble}` : 'no status');
        report('e', 'the notice waits in its icon', !!(s && !s.hidden), s ? `icon hidden=${s.hidden} label="${s.label}"` : '');
    } finally { c.close(); }
    await clearLane();
}

async function runChecks() {
    const args = process.argv.slice(3);
    const only = (args.includes('--only') ? args[args.indexOf('--only') + 1] : 'a,b,c,d,e').split(',');
    const out = args.includes('--out') ? args[args.indexOf('--out') + 1] : path.join(os.homedir(), '.cache', 'fold7-test', new Date().toISOString().replace(/[:.]/g, '-'));
    fs.mkdirSync(out, { recursive: true });
    console.log(`fold7-test run ${new Date().toISOString()} (shots in ${out})`);
    dev('settings put global stay_on_while_plugged_in 15');
    if (only.includes('a')) await checkA(out);
    if (only.includes('b')) await checkB(out);
    if (only.includes('c')) await checkC(out);
    if (only.includes('d')) await checkD(out);
    if (only.includes('e')) await checkE(out);
    emu('net', 'on');
    fs.writeFileSync(path.join(out, 'results.json'), JSON.stringify(results, null, 1));
    const fails = results.filter((r) => r.pass === false).length;
    console.log(`\n${results.filter((r) => r.pass).length} passed, ${fails} failed, ${results.filter((r) => r.pass === null).length} skipped`);
    return fails === 0;
}

module.exports = { emu, dev, api, cdp, sleep };

if (require.main === module) {
    const [cmd] = process.argv.slice(2);
    const pageEval = async () => { const c = await cdp(); try { console.log(JSON.stringify(await c.evaluate(process.argv[3] || 'location.href'), null, 1)); } finally { c.close(); } };
    const run = { setup, partner, eval: pageEval, run: runChecks }[cmd];
    if (!run) { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(2, 24).join('\n')); process.exit(2); }
    run().then((ok) => process.exit(ok === false ? 1 : 0)).catch((e) => { console.error(`${cmd}: ${e.message}`); process.exit(1); });
}
