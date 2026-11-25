'use strict';

/**
 * The Plaud app account (second sign-in, #1193): Plaud's private web API, used only to read the recorder
 * (name, model, battery, last sync) for Today's Plaud item. The developer account (plaudClient.js) has no device endpoint.
 * Unofficial API: https://api.plaud.ai (regional bases answer status -302 with data.domains.api), email code sign-in
 * (POST /auth/otp-send-code { username } -> { token }; POST /auth/otp-login { code, token } -> { access_token }, form
 * body, JSON when Plaud answers 422 with a detail list), GET /device/list with the bearer token.
 * The access token is a JWT with an exp claim; there is no refresh token: when it ends she signs in again.
 *
 * Stored in .cache/plaud-device.json (0600; env PLAUD_DEVICE_FILE): { token, base, email, since, exp, asked }.
 * Never a token, code or code token in a reply or a log. No timers: the recorder is read only when Today asks, at
 * most once per 10 minutes.
 */

const fs = require('fs');
const path = require('path');

const FILE = process.env.PLAUD_DEVICE_FILE || path.join(__dirname, '..', '.cache', 'plaud-device.json');
const DEFAULT_BASE = 'https://api.plaud.ai';
const TIMEOUT_MS = 15000;
const CODE_MS = 10 * 60 * 1000;
const READ_MS = 10 * 60 * 1000;
const MIN_TIME = Date.UTC(2020, 0, 1);
const NOTICE_ID = 'plaud:device-login';
const UA = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0.0.0 Safari/537.36';

let deps = { fetch: (...a) => fetch(...a) };
let state = null;       // { token, base, email, since, exp, asked } from the file
let pending = null;     // { token, email, until }: a sent email code
let recorders = [];     // from the last read
let fields = [];        // key names of the first device object (names only)
let readAt = 0;
let reading = null;
let lastError = '';
let broadcast = null;
let resources = null;

class PlaudError extends Error {
    constructor(message, code) { super(message); this.code = code || 'PLAUD_DEVICE_ERROR'; }
}

function load() {
    if (state) return state;
    let s = null;
    try { s = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { s = null; }
    state = {
        token: (s && s.token) || '', base: (s && s.base) || DEFAULT_BASE, email: (s && s.email) || '',
        since: (s && s.since) || 0, exp: (s && s.exp) || 0, asked: (s && s.asked) || '', dead: !!(s && s.dead)
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

function jwtExp(token) {
    try {
        const p = JSON.parse(Buffer.from(String(token).split('.')[1], 'base64url').toString('utf8'));
        return Number(p.exp) > 0 ? Number(p.exp) * 1000 : 0;
    } catch (_) { return 0; }
}

function isExpired(s) { return !!s.token && ((s.exp > 0 && s.exp <= Date.now()) || s.dead === true); }

function stateName() {
    const s = load();
    if (!s.token) return 'missing';
    return isExpired(s) ? 'expired' : 'ok';
}

// ------------------------------------------------------------------------------------------ Plaud calls

async function once(base, method, p, { token, fields: f, json } = {}) {
    const headers = {
        Accept: 'application/json', 'User-Agent': UA, Origin: 'https://web.plaud.ai', Referer: 'https://web.plaud.ai/',
        'app-platform': 'web', 'edit-from': 'web'
    };
    if (token) headers.Authorization = `bearer ${token}`;
    let body;
    if (f) {
        if (json) { headers['Content-Type'] = 'application/json'; body = JSON.stringify(f); }
        else { headers['Content-Type'] = 'application/x-www-form-urlencoded'; body = new URLSearchParams(f).toString(); }
    }
    let res;
    try {
        res = await deps.fetch(`${base}${p}`, { method, headers, body, signal: AbortSignal.timeout(TIMEOUT_MS) });
    } catch (_) {
        throw new PlaudError('Plaud could not be reached', 'PLAUD_DEVICE_NETWORK');
    }
    const text = await res.text().catch(() => '');
    let parsed = null;
    try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = null; }
    return { status: res.status, body: parsed };
}

/** One call; a -302 answer switches to the regional base (stored) and repeats once; a 422 with a detail list repeats as JSON. */
async function request(method, p, opts = {}) {
    const s = load();
    let r = await once(s.base, method, p, opts);
    const dom = r.body && r.body.status === -302 && r.body.data && r.body.data.domains && r.body.data.domains.api;
    if (dom && /^https:\/\/[a-z0-9.-]+\.plaud\.ai\/?$/i.test(String(dom))) {
        s.base = String(dom).replace(/\/$/, '');
        save();
        r = await once(s.base, method, p, opts);
    }
    if (opts.fields && !opts.json && r.status === 422 && r.body && Array.isArray(r.body.detail)) r = await once(s.base, method, p, Object.assign({}, opts, { json: true }));
    return r;
}

const failMsg = (r, fallback) => (r.body && typeof r.body.msg === 'string' && r.body.msg ? `${fallback} (${r.body.msg.slice(0, 120)})` : fallback);

// ------------------------------------------------------------------------------------------ sign in and out

async function sendCode(email) {
    const to = String(email || '').trim();
    if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(to)) throw new PlaudError('Enter the email address of the Plaud app account', 'PLAUD_DEVICE_BAD_EMAIL');
    let r;
    try { r = await request('POST', '/auth/otp-send-code', { fields: { username: to } }); } catch (e) { lastError = e.message; throw e; }
    const token = r.body && (r.body.token || (r.body.data && r.body.data.token));
    if (!(r.status < 300 && r.body && r.body.status === 0 && token)) {
        lastError = failMsg(r, 'Plaud did not send a code');
        throw new PlaudError(lastError, 'PLAUD_DEVICE_CODE_SEND');
    }
    pending = { token: String(token), email: to, until: Date.now() + CODE_MS };
    lastError = '';
}

async function signIn(code) {
    const c = String(code || '').trim();
    if (!c) throw new PlaudError('Enter the code from the email', 'PLAUD_DEVICE_NO_CODE');
    if (!pending || pending.until <= Date.now()) { pending = null; throw new PlaudError('Ask for a new code first', 'PLAUD_DEVICE_NO_CODE'); }
    let r;
    try { r = await request('POST', '/auth/otp-login', { fields: { code: c, token: pending.token } }); } catch (e) { lastError = e.message; throw e; }
    const access = r.body && (r.body.access_token || (r.body.data && r.body.data.access_token));
    if (!(r.status < 300 && access)) {
        lastError = failMsg(r, 'Plaud did not accept that code');
        throw new PlaudError(lastError, 'PLAUD_DEVICE_BAD_CODE');
    }
    const s = load();
    Object.assign(s, { token: String(access), email: pending.email, since: Date.now(), exp: jwtExp(access), asked: '', dead: false });
    pending = null;
    lastError = '';
    recorders = []; readAt = 0;
    save();
    clearAsk();
    try { await readNow(); } catch (_) { /* the card shows the recorder on Today's next read */ }
    notify();
}

function signOut() {
    const s = load();
    Object.assign(s, { token: '', email: '', since: 0, exp: 0, asked: '', dead: false });
    pending = null; recorders = []; fields = []; readAt = 0; lastError = '';
    try { fs.unlinkSync(FILE); } catch (_) { /* no file */ }
    clearAsk();
    notify();
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

/** Only values the object really carries: never invented. */
function mapDevice(d) {
    const o = d && typeof d === 'object' ? d : {};
    let battery = null;
    let lastSync = null;
    for (const k of Object.keys(o)) {
        if (battery === null && /batter|electric|power_level/i.test(k) && !/low|warn|stat|flag|type/i.test(k) && typeof o[k] === 'number' && o[k] >= 0 && o[k] <= 100) battery = o[k];
        if (lastSync === null && /sync|connect|online|active/i.test(k)) lastSync = timeOf(o[k]);
    }
    const str = (v) => (typeof v === 'string' ? v : '');
    return { name: str(o.name), model: str(o.model), serial: str(o.sn), firmware: typeof o.version_number === 'number' ? String(o.version_number) : str(o.version_number), battery, lastSync };
}

async function readNow() {
    const s = load();
    let r;
    try { r = await request('GET', '/device/list', { token: s.token }); } catch (e) { lastError = e.message; return recorder_cached(); }
    if (r.status === 401 || (r.body && r.body.status === 401)) {
        s.dead = true;
        recorders = [];
        lastError = 'The Plaud sign-in has expired';
        save();
        notify();
        return null;
    }
    const list = r.status < 300 && r.body && Array.isArray(r.body.data_devices) ? r.body.data_devices : null;
    if (!list) { lastError = failMsg(r, 'Plaud did not list the recorder'); return recorder_cached(); }
    lastError = '';
    const keys = list[0] && typeof list[0] === 'object' ? Object.keys(list[0]).sort() : [];
    // key names only (never values): what Plaud really sends, since no public source lists a battery or sync field
    if (keys.join() !== fields.join()) console.log(`[plaud-device] recorder fields: ${keys.join(', ') || '(none)'}`);
    fields = keys;
    recorders = list.map(mapDevice);
    readAt = Date.now();
    return recorder_cached();
}

function recorder_cached() {
    const f = recorders[0];
    return f ? { name: f.name, model: f.model, battery: f.battery, lastSync: f.lastSync, readAt } : null;
}

/** The first recorder, cached 10 minutes; a network error keeps the cached one; expired or no login -> null. */
async function recorder() {
    if (stateName() !== 'ok') return null;
    if (readAt && Date.now() - readAt < READ_MS) return recorder_cached();
    if (!reading) reading = readNow().finally(() => { reading = null; });
    return reading;
}

function status() {
    const s = load();
    const name = stateName();
    return {
        signedIn: name === 'ok',
        expired: name === 'expired',
        email: s.token ? s.email : '',
        since: s.token ? s.since : 0,
        expiresAt: s.token ? s.exp : 0,
        codeSent: !!(pending && pending.until > Date.now()),
        lastError,
        recorders: name === 'missing' ? [] : recorders.map((d) => ({
            name: d.name, model: d.model, serial: d.serial ? `...${d.serial.slice(-4)}` : '', firmware: d.firmware, battery: d.battery, lastSync: d.lastSync
        }))
    };
}

// ------------------------------------------------------------------------------------------ the ask

function inbox() {
    if (deps.inbox) return deps.inbox;
    return resources ? require('./notificationInbox').bind(resources) : null;
}

function clearAsk() {
    try { const ib = inbox(); if (ib && ib.clear) ib.clear(undefined, NOTICE_ID, 'open'); } catch (_) { /* nothing to clear */ }
}

/** One notice per state (missing / expired) while the developer account is linked; remembered in the file. */
function ask(gr, linked) {
    if (gr) resources = gr;
    const s = load();
    const name = stateName();
    if (!linked || name === 'ok' || s.asked === name) return;
    const ib = inbox();
    if (!ib) return;
    const text = name === 'expired'
        ? 'Your Plaud recorder sign-in has expired. Sign in again in Control Panel > Authentication > Plaud.'
        : 'Sign in to Plaud once more to show your recorder\'s name and battery on Today. Control Panel > Authentication > Plaud.';
    try {
        ib.publish({ app: 'plaud', id: NOTICE_ID, cls: 'notification', title: 'Plaud', text, actions: [], data: { app: 'plaud' } });
        s.asked = name;
        save();
    } catch (e) { console.warn(`[plaud-device] notice: ${e.message}`); }
}

module.exports = {
    PlaudError,
    status, sendCode, signIn, signOut, recorder, ask,
    state: stateName,
    attach: (gr) => { if (gr) resources = gr; },
    bind: (fn) => { broadcast = typeof fn === 'function' ? fn : null; },
    _test: {
        setDeps: (d) => { deps = Object.assign(deps, d || {}); },
        reset: () => { state = null; pending = null; recorders = []; fields = []; readAt = 0; reading = null; lastError = ''; resources = null; },
        fields: () => fields.slice()
    }
};
