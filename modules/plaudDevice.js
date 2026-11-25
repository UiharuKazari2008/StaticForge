'use strict';

/**
 * The Plaud recorder itself (name, model, firmware) for Today's Plaud item (#1193). The developer account
 * (plaudClient.js) has no device endpoint, so it is read from Plaud's web app in the server's Alchemy browser, where
 * Yukimi is signed in to Plaud (with Google) already: a hidden tab is opened at web.plaud.ai, the page itself asks
 * Plaud for GET /device/list with its own session, and only the recorder's fields come back. The Plaud session never
 * leaves the browser: no token is read out, stored or logged here.
 *
 * Seen live Nov 25 2026: { data_devices: [{ sn, name, model, version_number, workspace_id, owner_member_id,
 * info { auth_mode_*, timezone_iana }, prot_version }] }. Plaud's cloud has NO battery and NO last sync (tried
 * /device/status, info, detail, battery, state, setting, config, ota, latest, sync: none exists; /device/<x> is the
 * bind check). battery and lastSync are still taken if a field named like one ever appears, never made up.
 * An emailed code (auth/otp-login) is no way in: for a Google account it makes a second, empty Plaud account.
 *
 * The battery: Plaud's cloud has none and the percentage is inside the Plaud app's encrypted Bluetooth session, but the
 * recorder carries Apple's Find My accessory information in the clear, with a four-step battery state (0 full,
 * 1 medium, 2 low, 3 critical; it read 0 while the Plaud app showed 77 %). The Dreamscape app on the phone the recorder
 * is connected to reads it on request (device op status.plaudBattery, DSApp PlaudBattery.kt): battery() asks an
 * online phone at most every 30 minutes, in the background, and the word is shown for 12 hours.
 *
 * Kept in .cache/plaud-device.json (0600; env PLAUD_DEVICE_FILE): { recorders, readAt, signedIn, asked, battery, batteryAt }. No timers:
 * read only when Today (or the card) asks, at most once a day; the card's Read again forces it.
 */

const fs = require('fs');
const http = require('http');
const path = require('path');

const FILE = process.env.PLAUD_DEVICE_FILE || path.join(__dirname, '..', '.cache', 'plaud-device.json');
const WEB_URL = 'https://web.plaud.ai/';
const CDP_HOST = '127.0.0.1';
const CDP_PORT = Math.max(0, Number(process.env.ALCHEMY_CDP_PORT || 9339) || 0);
const QUIET_URL = 'about:blank#alchemy-quiet';   // the Alchemy service never shows a tab with this mark
const READ_MS = 24 * 60 * 60 * 1000;
const RETRY_MS = 10 * 60 * 1000;
const PAGE_TIMEOUT_MS = 25000;
const NOTICE_ID = 'plaud:device-login';
const BATTERY_OP = 'status.plaudBattery';
const BATTERY_WORDS = ['full', 'medium', 'low', 'critical'];
const BATTERY_MS = 30 * 60 * 1000;
const BATTERY_RETRY_MS = 2 * 60 * 1000;   // no phone answered (after a restart the phones are away for some seconds)
const BATTERY_KEEP_MS = 12 * 60 * 60 * 1000;
const MIN_TIME = Date.UTC(2020, 0, 1);

let deps = {};
let state = null;       // { recorders, readAt, signedIn, asked } from the file
let fields = [];        // key names of the first device object (names only)
let triedAt = 0;
let reading = null;
let lastError = '';
let broadcast = null;
let resources = null;
let batteryTried = 0;
let batteryReading = null;
let onBatteryChange = null;

class PlaudError extends Error {
    constructor(message, code) { super(message); this.code = code || 'PLAUD_DEVICE_ERROR'; }
}

function load() {
    if (state) return state;
    let s = null;
    try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { s = null; }
    state = {
        recorders: s && Array.isArray(s.recorders) ? s.recorders : [], readAt: (s && s.readAt) || 0,
        signedIn: s && typeof s.signedIn === 'boolean' ? s.signedIn : null, asked: (s && s.asked) || '',
        battery: s && BATTERY_WORDS.includes(s.battery) ? s.battery : '', batteryAt: (s && Number(s.batteryAt)) || 0
    };
    return state;
}

function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(state), { mode: 0o600 });
        fs.renameSync(tmp, FILE);
    } catch (e) {
        console.warn(`[plaud-device] not saved: ${e.message}`);
    }
}

function notify() { if (broadcast) { try { broadcast(); } catch (_) { /* the page learns on its next read */ } } }

/** 'ok' the recorder is known | 'missing' the browser is not signed in to Plaud | 'unknown' not read yet / browser off. */
function stateName() {
    const s = load();
    if (s.signedIn === false) return 'missing';
    return s.readAt ? 'ok' : 'unknown';
}

// ------------------------------------------------------------------------------------------ the page

// Runs inside web.plaud.ai: the page's own session asks Plaud; the token stays in the page. Returns null while the page is still loading.
const IN_PAGE = `(async () => {
    if (location.host !== 'web.plaud.ai' || document.readyState === 'loading') return null;
    let tok = null; let ws = null;
    try { tok = JSON.parse(localStorage.getItem('pld_session.tokens')); ws = JSON.parse(localStorage.getItem('pld_session.workspace')); } catch (_) { /* below */ }
    const by = tok && tok.byWsId;
    const t = by && ((ws && by[ws.currentId]) || Object.values(by)[0]);
    if (!t || !t.token) return document.readyState === 'complete' ? { signedIn: false } : null;
    const r = await fetch('https://api.plaud.ai/device/list', { headers: { Authorization: (t.tokenType || 'Bearer') + ' ' + t.token, 'app-platform': 'web', 'edit-from': 'web' } });
    if (r.status === 401) return { retry: true };
    let b = null; try { b = await r.json(); } catch (_) { /* below */ }
    if (!b || !Array.isArray(b.data_devices)) return { signedIn: true, failed: (b && b.msg) || ('HTTP ' + r.status) };
    return { signedIn: true, devices: b.data_devices };
})()`;

function offline(message) {
    return new PlaudError(message || 'The server\'s browser (Alchemy) is not running', 'PLAUD_DEVICE_BROWSER');
}

function browserSocketUrl() {
    if (!CDP_PORT) return Promise.reject(offline());
    return new Promise((resolve, reject) => {
        const req = http.get({ host: CDP_HOST, port: CDP_PORT, path: '/json/version', timeout: 5000 }, (res) => {
            let body = '';
            res.on('data', (c) => { body += c; });
            res.on('end', () => {
                try { const url = JSON.parse(body).webSocketDebuggerUrl; if (url) { resolve(url); return; } } catch (_) { /* below */ }
                reject(offline());
            });
        });
        req.on('timeout', () => req.destroy(new Error('timeout')));
        req.on('error', () => reject(offline()));
    });
}

/** A hidden tab at web.plaud.ai, its device list, the tab closed again (the way youtubeAlchemy.js reads YouTube). */
async function browserRead() {
    const WebSocket = require('ws');
    const ws = new WebSocket(await browserSocketUrl(), { perMessageDeflate: false });
    await new Promise((resolve, reject) => { ws.once('open', resolve); ws.once('error', () => reject(offline())); });
    let nextId = 1;
    const waiting = new Map();
    ws.on('message', (raw) => {
        let m;
        try { m = JSON.parse(raw); } catch (_) { return; }
        const w = m.id != null && waiting.get(m.id);
        if (!w) return;
        waiting.delete(m.id);
        if (m.error) w.fail(new Error(m.error.message || 'browser error')); else w.ok(m.result || {});
    });
    ws.on('close', () => { for (const w of waiting.values()) w.fail(offline()); waiting.clear(); });
    const send = (method, params, sessionId) => new Promise((ok, fail) => {
        const id = nextId++;
        waiting.set(id, { ok, fail });
        ws.send(JSON.stringify(Object.assign({ id, method, params: params || {} }, sessionId ? { sessionId } : {})));
    });
    let targetId = null;
    try {
        let target;
        try { target = await send('Target.createTarget', { url: QUIET_URL, background: true, hidden: true }); } catch (_) { target = await send('Target.createTarget', { url: QUIET_URL, background: true }); }
        targetId = target.targetId;
        const { sessionId } = await send('Target.attachToTarget', { targetId, flatten: true });
        await send('Page.enable', {}, sessionId);
        await send('Page.navigate', { url: WEB_URL }, sessionId);
        const started = Date.now();
        while (Date.now() - started < PAGE_TIMEOUT_MS) {
            await new Promise((r) => setTimeout(r, 700));
            const r = await send('Runtime.evaluate', { expression: IN_PAGE, returnByValue: true, awaitPromise: true }, sessionId).catch(() => null);
            const value = r && r.result && r.result.value;
            // retry: the page's token was a day old; its own scripts renew it in a moment
            if (value && typeof value === 'object' && !value.retry) return value;
        }
        throw new PlaudError('Plaud\'s page did not finish loading in the server\'s browser', 'PLAUD_DEVICE_TIMEOUT');
    } finally {
        if (targetId) await send('Target.closeTarget', { targetId }).catch(() => {});
        try { ws.close(); } catch (_) { /* gone */ }
    }
}

// ------------------------------------------------------------------------------------------ the recorder

function timeOf(v) {
    if (typeof v === 'number' && Number.isFinite(v) && v > 0) {
        const ms = v < 1e11 ? Math.round(v * 1000) : Math.round(v);
        return ms > MIN_TIME && ms < Date.now() + 86400000 ? ms : null;   // a count or a flag is not a time
    }
    if (typeof v === 'string' && v.trim()) {
        if (/^\d+(\.\d+)?$/.test(v.trim())) return timeOf(Number(v));
        const t = Date.parse(v);
        return Number.isFinite(t) && t > MIN_TIME ? t : null;
    }
    return null;
}

/** Only values the object really carries (its own keys and those of its info part): never invented. */
function mapDevice(d) {
    const o = d && typeof d === 'object' ? d : {};
    const all = Object.assign({}, o.info && typeof o.info === 'object' ? o.info : {}, o);
    let battery = null;
    let lastSync = null;
    for (const k of Object.keys(all)) {
        if (battery === null && /batter|electric|power_level/i.test(k) && !/low|warn|stat|flag|type/i.test(k) && typeof all[k] === 'number' && all[k] >= 0 && all[k] <= 100) battery = all[k];
        if (lastSync === null && /sync|connect|online|active/i.test(k)) lastSync = timeOf(all[k]);
    }
    const str = (v) => (typeof v === 'string' ? v : '');
    const serial = str(o.sn);
    // the serial is kept cut: nothing here needs the whole one
    return { name: str(o.name), model: str(o.model), serial: serial ? `...${serial.slice(-4)}` : '', firmware: typeof o.version_number === 'number' ? String(o.version_number) : str(o.version_number), battery, lastSync };
}

async function readNow() {
    const s = load();
    const before = stateName();
    triedAt = Date.now();
    let r;
    try {
        r = await (deps.browserRead || browserRead)();
    } catch (e) {
        lastError = e.message;
        return first();
    }
    if (!r.signedIn) {
        s.signedIn = false;
        lastError = 'The server\'s browser is not signed in to Plaud';
    } else if (!Array.isArray(r.devices)) {
        s.signedIn = true;
        lastError = `Plaud did not list the recorder${r.failed ? ` (${String(r.failed).slice(0, 120)})` : ''}`;
    } else {
        const keys = r.devices[0] && typeof r.devices[0] === 'object' ? Object.keys(r.devices[0]).sort() : [];
        // key names only (never values): what Plaud really sends
        if (keys.join() !== fields.join()) console.log(`[plaud-device] recorder fields: ${keys.join(', ') || '(none)'}`);
        fields = keys;
        Object.assign(s, { signedIn: true, recorders: r.devices.map(mapDevice), readAt: Date.now(), asked: '' });
        lastError = '';
        clearAsk();
    }
    save();
    if (stateName() !== before) notify();
    return first();
}

/** The battery word while it is fresh, else what Plaud's device list carried (it never has one so far). */
function batteryNow(f) {
    const s = load();
    if (s.battery && Date.now() - s.batteryAt < BATTERY_KEEP_MS) return s.battery;
    return f ? f.battery : null;
}

function first() {
    const s = load();
    const f = s.signedIn === false ? null : s.recorders[0];
    return f ? { name: f.name, model: f.model, battery: batteryNow(f), lastSync: f.lastSync, readAt: s.readAt } : null;
}

// ------------------------------------------------------------------------------------------ the battery (from the phone)

/** Ask the phones that are online (not test devices) until one has the recorder connected: { state, model } or null. */
async function phoneBattery(gr) {
    if (deps.phoneBattery) return deps.phoneBattery();
    const as = require('./activeSync');
    let ws = null;
    try { ws = gr && typeof gr.getWebSocketServer === 'function' ? gr.getWebSocketServer() : null; } catch (_) { ws = null; }
    if (!ws) return null;
    let test = () => false;
    try { test = require('./testDevices').isTestDevice; } catch (_) { /* no test devices */ }
    const phones = as.list(gr, ws).devices.filter((d) => d.online && d.platform === 'android' && !test(d.deviceId));
    for (const d of phones) {
        try {
            const r = await as.serverCall(gr, ws, d.deviceId, BATTERY_OP, {}, { timeoutMs: 25000, fromName: 'Plaud' });
            if (r && r.found && Number.isInteger(r.batteryState)) return { state: r.batteryState, model: typeof r.model === 'string' ? r.model : '' };
        } catch (_) { /* an older app, not allowed, or busy: the next phone */ }
    }
    return null;
}

/** Reads the battery in the background when the last reading is 30 minutes old (2 minutes after a try no phone answered); the caller never waits for a phone. */
function battery(gr) {
    if (gr) resources = gr;
    if (batteryReading || Date.now() - batteryTried < BATTERY_MS) return;
    batteryTried = Date.now();
    batteryReading = phoneBattery(resources).then((r) => {
        const s = load();
        const word = r && BATTERY_WORDS[r.state] ? BATTERY_WORDS[r.state] : '';
        if (!word) { batteryTried = Date.now() - BATTERY_MS + BATTERY_RETRY_MS; return; }
        const was = batteryNow(null);
        Object.assign(s, { battery: word, batteryAt: Date.now() });
        save();
        if (was !== word) { notify(); if (onBatteryChange) { try { onBatteryChange(); } catch (_) { /* the page learns on its next read */ } } }
    }).catch(() => {}).finally(() => { batteryReading = null; });
}

function read() {
    if (!reading) reading = readNow().finally(() => { reading = null; });
    return reading;
}

/**
 * The first recorder, from the file; read again when it is a day old (a failed read is not repeated for 10 minutes).
 * A stale read happens in the background: the caller gets what is known now. Not signed in -> null.
 */
async function recorder() {
    const s = load();
    const due = Date.now() - s.readAt >= READ_MS && Date.now() - triedAt >= RETRY_MS;
    if (!due) return first();
    if (s.readAt) { read().catch(() => {}); return first(); }
    return read();
}

/** The card's Read again (and after a sign-in at Plaud in the browser): a read now. */
async function refresh() {
    await read();
    notify();
}

function status() {
    const s = load();
    const name = stateName();
    const list = name === 'missing' ? [] : s.recorders.map((r, i) => (i === 0 ? Object.assign({}, r, { battery: batteryNow(r) }) : r));
    return { state: name, signedIn: s.signedIn === true, recorders: list, readAt: s.readAt, lastError, url: WEB_URL };
}

// ------------------------------------------------------------------------------------------ the ask

function inbox() {
    if (deps.inbox) return deps.inbox;
    return resources ? require('./notificationInbox').bind(resources) : null;
}

function clearAsk() {
    try { const ib = inbox(); if (ib && ib.clear) ib.clear(undefined, NOTICE_ID, 'open'); } catch (_) { /* nothing to clear */ }
}

/** One notice while the developer account is linked and the browser is not signed in to Plaud; remembered in the file. */
function ask(gr, linked) {
    if (gr) resources = gr;
    const s = load();
    if (!linked || stateName() !== 'missing' || s.asked === 'missing') return;
    const ib = inbox();
    if (!ib) return;
    try {
        ib.publish({
            app: 'plaud', id: NOTICE_ID, cls: 'notification', title: 'Plaud',
            text: 'Sign in at Plaud in the server\'s browser to show your recorder\'s name on Today: Control Panel > Authentication > Plaud > Sign in at Plaud.',
            actions: [], data: { app: 'plaud' }
        });
        s.asked = 'missing';
        save();
    } catch (e) { console.warn(`[plaud-device] notice: ${e.message}`); }
}

module.exports = {
    PlaudError, WEB_URL,
    status, recorder, refresh, ask, battery,
    onBattery: (fn) => { onBatteryChange = typeof fn === 'function' ? fn : null; },
    state: stateName,
    attach: (gr) => { if (gr) resources = gr; },
    bind: (fn) => { broadcast = typeof fn === 'function' ? fn : null; },
    _test: {
        setDeps: (d) => { deps = Object.assign(deps, d || {}); },
        reset: () => { state = null; fields = []; triedAt = 0; reading = null; lastError = ''; resources = null; batteryTried = 0; batteryReading = null; onBatteryChange = null; },
        batteryDone: () => batteryReading || Promise.resolve(),
        fields: () => fields.slice(),
        mapDevice
    }
};
