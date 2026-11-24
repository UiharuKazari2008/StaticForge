/**
 * Call filter (Yozora #1107, Yukimi Nov 23 2026: "no noise from spam, but nothing important lost").
 *
 * Calls reach the server only as the phone's own call notifications (ActiveSync notify.posted: category call /
 * missed_call, the dialer's package). This module vets each one:
 *
 *   known     the caller is a saved contact (the phone shows the name, or the number is on a card) or a number the
 *             phone dialed before (an outgoing call is remembered): passes untouched.
 *   spam      the dialer / carrier flagged it (Suspected spam, Scam likely ...): only noted.
 *   unknown   a bare number that is neither: only noted.
 *
 * Noted calls are never sent to the computers with a balloon, never raise an inbox notice, and are kept in
 * .cache/call-filter.json as quiet entries. The phone's filter carries cf: 1 (activeSyncNotifyFilter) so the app can
 * drop the same ones before they sound. Texts from unknown senders are already Unknown Senders (textMessaging).
 *
 * Summary: when a phone's link says hello after being away (default 30 min: it was off, locked for long, or out of
 * reach), ONE notice (callsummary) says how many calls / texts were held back or missed meanwhile; it is silent when
 * there is nothing and never lists items one by one. A notice older than the away time is not replayed by the hello
 * catch-up (notificationInbox.catchUpPhone) - it would arrive as a flood - it is counted in the same summary.
 * Both switches live in the inbox prefs (key callFilter): { on, summary, awayMin }.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const FILE = path.join(__dirname, '..', '.cache', 'call-filter.json');
const MAX_ENTRIES = 200;
const MAX_DIALED = 500;
const DEFAULTS = { on: true, summary: true, awayMin: 30 };
const CALL_CATEGORIES = new Set(['call', 'missed_call', 'incoming_call']);
const CALL_CHANNEL_RE = /missed[_ ]?call|incoming[_ ]?call|\bcalls?\b/i;
const DIALER_RE = /(^|\.)(dialer|incallui|telecom|phone)(\.|$)/i;
const SPAM_RE = /\b(spam|scam|fraud|telemarketer|robocall|suspected)\b/i;
const NUMBERISH_RE = /^[+\d\s()\-.#*]{4,}$/;
const OUTGOING_RE = /\b(outgoing|dialing|calling)\b/i;

let store = null;
let nowFn = () => Date.now();
let lastHello = new Map();

function load() {
    if (store) return store;
    try { store = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_e) { store = null; }
    if (!store || typeof store !== 'object') store = {};
    if (!Array.isArray(store.entries)) store.entries = [];
    if (!Array.isArray(store.dialed)) store.dialed = [];
    if (!Number.isFinite(store.summarizedAt)) store.summarizedAt = 0;
    return store;
}
let saveTimer = null;
function save() {
    if (saveTimer) return;
    saveTimer = setTimeout(() => {
        saveTimer = null;
        try { fs.mkdirSync(path.dirname(FILE), { recursive: true }); fs.writeFileSync(FILE, JSON.stringify(store)); } catch (_e) { /* best effort */ }
    }, 1000);
    if (saveTimer.unref) saveTimer.unref();
}

function keyOf(s) {
    const d = String(s || '').replace(/\D/g, '');
    return d.length > 10 ? d.slice(-10) : d;
}

function settings() {
    let raw = null;
    try { raw = JSON.parse(require('./notificationInbox').getPref('admin', 'callFilter') || 'null'); } catch (_e) { raw = null; }
    const r = raw && typeof raw === 'object' ? raw : {};
    return {
        on: r.on !== false,
        summary: r.summary !== false,
        awayMin: Number.isFinite(Number(r.awayMin)) && Number(r.awayMin) >= 1 ? Math.min(Number(r.awayMin), 24 * 60) : DEFAULTS.awayMin
    };
}
function setSettings(patch) {
    const cur = settings();
    const next = Object.assign({}, cur, patch && typeof patch === 'object' ? patch : {});
    require('./notificationInbox').setPref('admin', 'callFilter', JSON.stringify({ on: next.on !== false, summary: next.summary !== false, awayMin: next.awayMin }));
    return settings();
}

/** Is this phone notification a call? */
function isCall(detail) {
    if (!detail || typeof detail !== 'object') return false;
    const cat = String(detail.category || '');
    if (CALL_CATEGORIES.has(cat)) return true;
    if (detail.channel && CALL_CHANNEL_RE.test(String(detail.channel)) && DIALER_RE.test(String(detail.package || ''))) return true;
    return false;
}

/** 'known' | 'spam' | 'unknown' for a call notification. */
function classify(detail) {
    const title = String(detail.title || '').trim();
    const text = String(detail.text || '').trim();
    if (SPAM_RE.test(title) || SPAM_RE.test(text)) return 'spam';
    // the phone resolved a name: a saved contact
    if (title && !NUMBERISH_RE.test(title)) return 'known';
    const num = keyOf(title) || keyOf(text);
    if (!num) return 'unknown';
    let tm = null;
    try { tm = require('./textMessaging'); } catch (_e) { tm = null; }
    if (tm && tm.isContactNumberSync(num)) return 'known';
    if (load().dialed.includes(num)) return 'known';
    // the contact map not built yet: let it through rather than hush a real caller (it is built within seconds)
    if (tm && !tm.contactsReady()) return 'known';
    return 'unknown';
}

function noteDialed(detail) {
    const num = keyOf(detail.title) || keyOf(detail.text);
    if (!num || num.length < 4) return;
    const s = load();
    if (s.dialed.includes(num)) return;
    s.dialed.push(num);
    if (s.dialed.length > MAX_DIALED) s.dialed.splice(0, s.dialed.length - MAX_DIALED);
    save();
}

function record(kind, who, source, id) {
    const s = load();
    if (id && s.entries.some((e) => e.id === id)) return; // the same notice met again on the next hello
    s.entries.push({ t: Math.max(nowFn(), s.summarizedAt + 1), kind, who: String(who || '').slice(0, 40), source: source || 'call', id: id || undefined });
    if (s.entries.length > MAX_ENTRIES) s.entries.splice(0, s.entries.length - MAX_ENTRIES);
    save();
}

/**
 * What the relay does with a phone notification: { pass: true } for everything but vetted-out calls;
 * { pass: false, kind } for a spam / unknown call, which is only noted.
 */
function vet(detail) {
    if (!isCall(detail) || !settings().on) return { pass: true };
    if (OUTGOING_RE.test(String(detail.text || '')) || OUTGOING_RE.test(String(detail.title || ''))) { noteDialed(detail); return { pass: true }; }
    const kind = classify(detail);
    if (kind === 'known') return { pass: true };
    record(kind, detail.title || detail.text, 'call');
    return { pass: false, kind };
}

/** A text / notice that was not replayed after a long absence: counted in the summary. */
function noteSkipped(n) {
    record('missed', (n && n.title) || '', n && n.cls === 'sms' ? 'sms' : 'notice', n && n.id);
}

function counts(since) {
    const c = { spam: 0, unknown: 0, missed: 0 };
    for (const e of load().entries) if (e.t > since && c[e.kind] != null) c[e.kind] += 1;
    return c;
}

/** One quiet notice for what was held back / not replayed since the last summary; null when nothing. */
function summarize() {
    const s = load();
    const set = settings();
    if (!set.summary) return null;
    const c = counts(s.summarizedAt);
    const total = c.spam + c.unknown + c.missed;
    s.summarizedAt = nowFn();
    save();
    if (!total) return null;
    const parts = [];
    if (c.missed) parts.push(`${c.missed} missed ${c.missed === 1 ? 'notification' : 'notifications'}`);
    if (c.unknown) parts.push(`${c.unknown} ${c.unknown === 1 ? 'call' : 'calls'} from unknown numbers`);
    if (c.spam) parts.push(`${c.spam} spam ${c.spam === 1 ? 'call' : 'calls'}`);
    const notice = { app: 'phone', id: 'callsummary', cls: 'notification', alert: false, title: 'While you were away', text: parts.join(', '), ttlMs: 24 * 60 * 60 * 1000, data: { app: 'phone', kind: 'callsummary', counts: c } };
    try { return require('./notificationInbox').publish(Object.assign({ user: 'admin' }, notice)); } catch (_e) { return null; }
}

/** The phone's background link said hello: after a long absence, the one summary. */
function onHello(deviceId) {
    const now = nowFn();
    const was = lastHello.get(deviceId) || 0;
    lastHello.set(deviceId, now);
    if (!was || now - was < settings().awayMin * 60 * 1000) return null;
    return summarize();
}

/** A catch-up resend of a text / call notice this old is a flood, not news. */
function staleMs() { return settings().awayMin * 60 * 1000; }

function tap() {
    try { require('./activeSync').onDeviceHello((d) => { if (d && d.id && d.speaker === 'service') { try { onHello(d.id); } catch (_e) { /* best effort */ } } }); } catch (_e) { /* no link */ }
}

module.exports = { tap, vet, isCall, classify, settings, setSettings, summarize, onHello, noteSkipped, staleMs, _reset: () => { store = null; lastHello = new Map(); }, _now: (f) => { nowFn = f || Date.now; }, _store: () => load() };
