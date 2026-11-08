/**
 * PayPass Operator (Yozora #721): the server side of apps/paypass, the operator interface for
 * openCreditIC (github.com/UiharuKazari2008/openCreditIC), the arcade's IC card / credit system. It ports
 * the Sequenzia interface ("payPass Manager": web/views/home-seqapp.pug + web/static/js/sideloader.js).
 *
 * openCreditIC's API is all GET with the web key as ?key=. The key and the server's address live in
 * .cache/packages/.data/paypass/config.json ({ url, key, currencyRate?, currencySymbol? }) and never
 * reach the browser. The client names an operation and its fields; this module validates them and
 * builds the path, so the console can only do what the Sequenzia interface does.
 *
 * The API has no JSON route for machines or arcade settings, so the dashboard reads them from the
 * server's own pages: the POS terminals and arcade name from / and each machine's name and free-play
 * state from /get/free_play. credit_to_currency_rate is not exposed at all: config.currencyRate.
 *
 * Fixed from the original client: free play by customer ID or card serial sent "enabled", which the
 * server reads as off (it wants "enable"); the update routes delete every field left out, so updates
 * always send every field.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const DATA_DIR = process.env.PAYPASS_DATA_DIR || path.join(__dirname, '..', '.cache', 'packages', '.data', 'paypass');
const TIMEOUT_MS = 15000;
const WAIT_MS = 45000; // under the client request timeout (60 s); openCreditIC drops a scan after 30 s
const DAY_MS = 864e5;
const SESSION_GAP_MS = 60 * 60 * 1000;

let cfgCache = null;

function config() {
    const file = path.join(DATA_DIR, 'config.json');
    let st;
    try { st = fs.statSync(file); } catch (_) {
        throw Object.assign(new Error('PayPass is not configured (config.json with url and key)'), { code: 'PAYPASS_NO_CONFIG' });
    }
    if (!cfgCache || cfgCache.mtimeMs !== st.mtimeMs) {
        const data = JSON.parse(fs.readFileSync(file, 'utf8'));
        if (!data || !/^https?:\/\//i.test(String(data.url || ''))) throw Object.assign(new Error('config.json needs a url'), { code: 'PAYPASS_NO_CONFIG' });
        cfgCache = { mtimeMs: st.mtimeMs, data };
    }
    return cfgCache.data;
}

// ---- parameter checks (everything goes into a URL path)

function bad(what) {
    return Object.assign(new Error(`Invalid ${what}`), { code: 'PAYPASS_BAD_INPUT' });
}
const ID_RE = /^[A-Za-z0-9._@+-]{1,64}$/;
const SERIAL_RE = /^[0-9A-Fa-f]{4,32}$/;
const MAC_RE = /^[0-9A-Fa-f]{2}(:[0-9A-Fa-f]{2}){5}$/;
function userId(v) { const s = String(v == null ? '' : v).trim(); if (!ID_RE.test(s)) throw bad('customer ID'); return s; }
function serial(v) { const s = String(v == null ? '' : v).trim().toUpperCase(); if (!SERIAL_RE.test(s)) throw bad('card serial'); return s; }
function mac(v) { const s = String(v == null ? '' : v).trim().toUpperCase(); if (!MAC_RE.test(s)) throw bad('terminal'); return s; }
function credits(v) { const n = Number(v); if (!Number.isFinite(n) || n <= 0 || n > 100000) throw bad('credit amount'); return String(Math.round(n * 100) / 100); }
function hours(v) {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    if (!Number.isFinite(n) || n <= 0 || n > 24 * 365) throw bad('time limit');
    return String(n);
}
function text(v, max = 200) { return String(v == null ? '' : v).replace(/[\u0000-\u001f]/g, ' ').trim().slice(0, max); }

// ---- HTTP

function urlFor(p, query) {
    const c = config();
    const u = new URL(p, c.url.replace(/\/+$/, '') + '/');
    if (c.key) u.searchParams.set('key', c.key);
    Object.entries(query || {}).forEach(([k, v]) => { if (v !== undefined && v !== null) u.searchParams.set(k, String(v)); });
    return u;
}

const enc = (s) => encodeURIComponent(s);

/** GET a path on openCreditIC: { ok, code, text, json, ms }. Never throws for HTTP errors. */
async function call(p, query, opts) {
    const o = opts || {};
    const u = urlFor(p, query);
    const t0 = Date.now();
    try {
        const res = await fetch(u, { signal: o.signal || AbortSignal.timeout(o.timeout || TIMEOUT_MS), headers: { 'User-Agent': 'PayPass-Operator/2024' } });
        const body = await res.text();
        let json;
        if (/json/i.test(res.headers.get('content-type') || '')) { try { json = JSON.parse(body); } catch (_) { /* text */ } }
        return { ok: res.status >= 200 && res.status < 300, code: res.status, text: json === undefined ? body : '', json, ms: Date.now() - t0 };
    } catch (err) {
        const timedOut = err && (err.name === 'TimeoutError' || err.name === 'AbortError');
        return { ok: false, code: 0, text: timedOut ? 'Timed out' : ((err && err.cause && err.cause.code) || (err && err.message) || 'Request failed'), ms: Date.now() - t0 };
    }
}

async function getJson(p) {
    const r = await call(p);
    if (!r.ok || r.json === undefined) throw Object.assign(new Error(r.code === 401 ? 'The PayPass server refused the key' : `PayPass server: ${r.code || ''} ${r.text}`.trim()), { code: 'PAYPASS_HTTP' });
    return r.json;
}

async function getText(p) {
    const r = await call(p);
    if (!r.ok) throw Object.assign(new Error(r.code === 401 ? 'The PayPass server refused the key' : `PayPass server: ${r.code || ''} ${r.text}`.trim()), { code: 'PAYPASS_HTTP' });
    return r.text;
}

// ---- the dashboard

const unhtml = (s) => String(s || '').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&').trim();

function parseHome(html) {
    const h1 = /<h1[^>]*>([^<]*)<\/h1>/i.exec(html);
    const sel = /<select[^>]*id="posTerminal"[^>]*>([\s\S]*?)<\/select>/i.exec(html);
    const pos = [];
    if (sel) {
        const re = /<option[^>]*value="([^"]*)"[^>]*>([^<]*)/gi;
        let m;
        while ((m = re.exec(sel[1]))) pos.push({ mac: m[1].toUpperCase(), name: unhtml(m[2]) });
    }
    return { arcade: h1 ? unhtml(h1[1]) : 'PayPass', pos, yen: /fa-yen-sign/.test(html) };
}

function parseFreePlay(html) {
    const out = { global: false, machines: [] };
    const re = /<label for="showFreePlay([^"]*)">([^<]*):<\/label>[\s\S]*?<input([^>]*)>/gi;
    let m;
    while ((m = re.exec(html))) {
        const on = /\bchecked\b/i.test(m[3]);
        if (m[1] === 'Global') out.global = on;
        else out.machines.push({ mac: m[1].toUpperCase(), name: unhtml(m[2]), freePlay: on });
    }
    return out;
}

/** Back-to-back plays (each within an hour of the next), as the Sequenzia machine card counts them. */
function lastSession(list) {
    let i = list.length - 1;
    if (i < 0) return null;
    const user = list[i].user;
    let n = 0;
    let total = 0;
    const end = list[i].time;
    let start = end;
    while (i >= 0 && list[i].user === user && start - list[i].time <= SESSION_GAP_MS) {
        if (list[i].status !== false) { n++; total += Number(list[i].cost) || 0; }
        start = list[i].time;
        i--;
    }
    return { count: n, start, end, total };
}

/** Dashboard: arcade, POS terminals, machines (with their last play), customers, global free play. */
async function overview() {
    const c = config();
    const [home, fpHtml, users, dispense, pending] = await Promise.all([
        getText('/'), getText('/get/free_play'), getJson('/get/user'), getJson('/get/dispense/machine'), getJson('/get_pending').catch(() => ({}))
    ]);
    const h = parseHome(home);
    const fp = parseFreePlay(fpHtml);
    const names = new Map();
    const userList = (Array.isArray(users) ? users : []).map((u) => {
        const id = (u.cards && u.cards[0] && u.cards[0].user) || null;
        if (id) names.set(id, u.name || id);
        const hist = Array.isArray(u.history) ? u.history : [];
        const top = Array.isArray(u.topup_history) ? u.topup_history : [];
        return {
            id,
            name: u.name || '',
            contact: u.contact || '',
            credits: Number(u.credits) || 0,
            locked: !!u.locked,
            freePlay: !!u.free_play,
            freePlayUntil: u.free_play_time_limit || null,
            created: u.date_created || null,
            cards: (u.cards || []).map((k) => ({ serial: k.serial, name: k.name || '', locked: !!k.locked })),
            plays: hist.filter((e) => e.status !== false).length,
            lastPlay: hist.length ? hist[hist.length - 1].time : null,
            lastTopup: top.length ? top[top.length - 1].time : null
        };
    });
    const now = Date.now();
    const macs = new Set([...fp.machines.map((m) => m.mac), ...Object.keys(dispense || {}).map((k) => k.toUpperCase())]);
    const machines = [...macs].filter((m) => !h.pos.some((p) => p.mac === m)).map((m) => {
        const info = fp.machines.find((x) => x.mac === m) || { name: m, freePlay: false };
        const list = (dispense && (dispense[m] || dispense[m.toLowerCase()])) || [];
        const last = list.length ? list[list.length - 1] : null;
        const day = list.filter((e) => now - e.time <= DAY_MS && e.status !== false);
        return {
            mac: m,
            name: info.name,
            freePlay: info.freePlay,
            plays: list.length,
            last: last ? { user: last.user, userName: names.get(last.user) || last.user, cost: Number(last.cost) || 0, freePlay: !!last.free_play, discount: !!last.discount, ok: last.status !== false, time: last.time } : null,
            session: lastSession(list),
            day: { users: new Set(day.map((e) => e.user)).size, plays: day.length, earned: day.reduce((s, e) => s + (Number(e.cost) || 0), 0) },
            active: !!(last && now - last.time < 3600e3)
        };
    });
    return {
        arcade: h.arcade,
        pos: h.pos,
        freePlay: fp.global,
        machines,
        users: userList,
        pending: Object.keys(pending || {}),
        currency: h.yen ? { symbol: c.currencySymbol || '¥', rate: Number(c.currencyRate) || 100 } : null,
        at: now
    };
}

/** One customer, by ID or card serial, with history (newest first, at most 200 each). */
async function customer(q) {
    const r = q || {};
    const u = r.card ? await getJson(`/get/card/${enc(serial(r.card))}`) : await getJson(`/get/user/${enc(userId(r.id))}`);
    return shapeCustomer(u);
}

function shapeCustomer(u) {
    if (!u || typeof u !== 'object') throw Object.assign(new Error('Customer not found'), { code: 'PAYPASS_NOT_FOUND' });
    const hist = Array.isArray(u.history) ? u.history.slice(-200).reverse() : [];
    const top = Array.isArray(u.topup_history) ? u.topup_history.slice(-200).reverse() : [];
    return {
        id: u.id || (u.cards && u.cards[0] && u.cards[0].user) || null,
        name: u.name || '',
        contact: u.contact || '',
        notes: u.notes || '',
        credits: Number(u.credits) || 0,
        locked: !!u.locked,
        freePlay: !!u.free_play,
        freePlayUntil: u.free_play_time_limit || null,
        created: u.date_created || null,
        cards: (u.cards || []).map((k) => ({ serial: k.serial, name: k.name || '', contact: k.contact || '', locked: !!k.locked })),
        history: hist.map((e) => ({ machine: e.machine, card: e.card, cost: Number(e.cost) || 0, freePlay: !!e.free_play, discount: !!e.discount, ok: e.status !== false, time: e.time })),
        topups: top.map((e) => ({ card: e.card || null, credits: Number(e.cost) || 0, time: e.time }))
    };
}

// ---- operations

/**
 * The operation table: op -> (fields) => { path, query?, scan? }. scan ops arm the POS reader; the
 * client then waits on it (wait()).
 */
const OPS = {
    deposit(d) {
        const c = credits(d.credits);
        if (d.target === 'user') return { path: `/deposit/user/${enc(userId(d.id))}/${c}` };
        if (d.target === 'card') return { path: `/deposit/card/${enc(serial(d.card))}/${c}` };
        return { path: `/deposit/scan/${enc(mac(d.pos))}/${c}`, scan: true };
    },
    freeplay(d) {
        const q = { timeLimit: hours(d.hours) || undefined };
        const v = d.enable === false ? 'disable' : 'enable';
        if (d.target === 'user') return { path: `/set/user/freeplay/${enc(userId(d.id))}/${v}`, query: q };
        if (d.target === 'card') return { path: `/set/card/freeplay/${enc(serial(d.card))}/${v}`, query: q };
        return { path: `/scan/freeplay/${enc(mac(d.pos))}`, query: q, scan: true };
    },
    register(d) {
        const query = {
            credits: d.credits ? credits(d.credits) : undefined,
            user_name: text(d.name) || undefined,
            user_contact: text(d.contact) || undefined,
            user_notes: text(d.notes, 1000) || undefined,
            card_name: text(d.cardName) || undefined,
            card_contact: text(d.cardContact) || undefined
        };
        const id = d.id ? userId(d.id) : null;
        if (d.card) return { path: `/register/new/${id ? enc(id) : 'NULL'}/${enc(serial(d.card))}`, query };
        return { path: `/register/scan/${enc(mac(d.pos))}${id ? `/${enc(id)}` : ''}`, query, scan: true };
    },
    addcard(d) { return { path: `/register/scan/${enc(mac(d.pos))}/${enc(userId(d.id))}`, scan: true }; },
    transfer(d) { return { path: `/reassign/scan/${enc(mac(d.pos))}`, scan: true }; },
    lookup(d) { return { path: `/get/scan/${enc(mac(d.pos))}`, scan: true, lookup: true }; },
    updateuser(d) {
        // every field is sent: the server deletes the ones a request leaves out
        return { path: `/update/user/${enc(userId(d.id))}`, query: { free_play: d.freePlay ? 'true' : 'false', user_name: text(d.name), user_contact: text(d.contact), user_notes: text(d.notes, 1000) } };
    },
    updatecard(d) { return { path: `/update/card/${enc(serial(d.card))}`, query: { card_name: text(d.name), card_contact: text(d.contact) } }; },
    lockuser(d) { return { path: `/set/user/lock/${enc(userId(d.id))}/${d.lock ? 'enable' : 'disable'}` }; },
    lockcard(d) { return { path: `/set/card/lock/${enc(serial(d.card))}/${d.lock ? 'enable' : 'disable'}` }; },
    deleteuser(d) { return { path: `/delete/user/${enc(userId(d.id))}` }; },
    deletecard(d) { return { path: `/delete/card/${enc(serial(d.card))}` }; },
    arcadefreeplay(d) { return { path: `/set/arcade/freeplay/${d.enable ? 'enable' : 'disable'}`, query: { timeLimit: hours(d.hours) || undefined } }; },
    machinefreeplay(d) { return { path: `/set/machine/freeplay/${enc(mac(d.mac))}/${d.enable ? 'enable' : 'disable'}`, query: { timeLimit: hours(d.hours) || undefined } }; },
    revokefreeplay() { return { path: '/disable_freeplay/user' }; },
    cancel(d) { return { path: `/cancel_pending/${enc(mac(d.pos))}` }; }
};

/** Run an operation: { op, ...fields } -> { ok, code, text, scan?, lookup? }. */
async function action(req) {
    const r = req || {};
    const op = OPS[String(r.op || '')];
    if (!op) throw Object.assign(new Error('Unknown operation'), { code: 'PAYPASS_BAD_OP' });
    const plan = op(r);
    const res = await call(plan.path, plan.query);
    return {
        ok: res.ok,
        code: res.code,
        message: res.json !== undefined ? '' : String(res.text || '').trim().slice(0, 500),
        scan: !!plan.scan && res.ok,
        lookup: !!plan.lookup && res.ok
    };
}

/**
 * Wait for the card a scan op asked for: { pos, lookup } -> { done, customer? }. A lookup waits for
 * the scanned card's data (/wait_data); other scans wait until the reader's command is gone.
 */
async function wait(req) {
    const r = req || {};
    const pos = mac(r.pos);
    if (r.lookup) {
        const res = await call(`/wait_data/${enc(pos)}`, null, { timeout: WAIT_MS });
        if (res.ok && res.json) return { done: true, customer: shapeCustomer(res.json) };
        return { done: false, message: res.code === 500 ? 'No card was scanned' : String(res.text || 'No card was scanned').slice(0, 300) };
    }
    const res = await call(`/wait_pending/${enc(pos)}`, null, { timeout: WAIT_MS });
    if (res.ok) return { done: true };
    await call(`/cancel_pending/${enc(pos)}`);
    return { done: false, message: 'No card was scanned' };
}

function info() {
    let configured = false;
    let url = '';
    try { const c = config(); configured = true; url = new URL(c.url).host; } catch (_) { /* not set up */ }
    return { configured, server: url };
}

module.exports = { DATA_DIR, overview, customer, action, wait, info, _parseHome: parseHome, _parseFreePlay: parseFreePlay, _ops: OPS, _lastSession: lastSession };
