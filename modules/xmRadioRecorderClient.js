'use strict';

/**
 * Dreamscape's side of the XM Radio recorder service (services/xmradio-recorder/server.js, pm2 `xmradio-recorder`):
 * the recording runs there, so a Dreamscape restart never stops it (Yukimi, Nov 21 2026). This module has the API the
 * WebSocket handler, the status feeds and the routes used from modules/xmRadioRecorder.js:
 *   deck()                      the service's last pushed deck (sync; { offline: true } with the service away)
 *   start / stop / recordCut / recordChannel / recordRange / queueRemove / queueClear / setDeck / setTimers /
 *   addAlert / removeAlert / setTerms                                                            over the socket
 *   playlist(rid) (async), segPath(rid, f)   a recording in progress, for /api/xmradio/rec/<rid>/<file>
 *   tapes / tapesInfo / tracks / trackPath / trackRename / trackDelete / trackMove / tapeNew / tapeRename / tapeDelete
 *                               the tapes in the file store (here: Dreamscape owns it)
 * and it files what the service finished (the spool) onto the tapes, at once and whenever the link comes back.
 * Connects to the service's Unix socket; reconnects with a backoff (2 s doubling to 30 s) while it is away.
 */

const fs = require('fs');
const net = require('net');
const path = require('path');
const engine = require('./xmRadioRecorder');

const RPC_MS = 60000;

let xm = null;
let onChange = () => {};
let sock = null;
let up = false;
let seq = 0;
const pending = new Map(); // id -> { resolve, reject, timer }
let cached = null; // the service's deck
let backoff = 2000;
let retryTimer = null;
let importing = Promise.resolve();

function sockPath() { return path.join(path.dirname(xm.accountFilePath()), 'xmradio-recorder.sock'); }

function fail(message, code) { return Object.assign(new Error(message), { code }); }

function connect() {
    clearTimeout(retryTimer);
    retryTimer = null;
    const s = net.createConnection(sockPath());
    sock = s;
    s.setEncoding('utf8');
    let buf = '';
    s.on('connect', () => {
        up = true;
        backoff = 2000;
        console.log('[xmRadio rec] connected to the recorder service');
        // the service may hold a token (its own file) for a slot that was signed out while it was away: the first push drops it
        for (let n = 2; n <= 8; n++) pushedSlots.add(n);
        void pushAuth();
        void importAll();
    });
    s.on('data', (d) => {
        buf += d;
        let i;
        while ((i = buf.indexOf('\n')) >= 0) {
            const line = buf.slice(0, i);
            buf = buf.slice(i + 1);
            if (line) onMessage(line);
        }
    });
    const gone = () => {
        if (sock !== s) return;
        sock = null;
        if (up) console.warn('[xmRadio rec] the recorder service went away; reconnecting');
        up = false;
        for (const [id, p] of pending) { clearTimeout(p.timer); p.reject(fail('The recorder service is not running.', 'XMREC_DOWN')); pending.delete(id); }
        if (cached) { cached = Object.assign({}, cached, { offline: true }); changedNow(); }
        retryTimer = setTimeout(connect, backoff);
        if (retryTimer.unref) retryTimer.unref();
        backoff = Math.min(30000, backoff * 2);
    };
    s.on('error', gone);
    s.on('close', gone);
}

function onMessage(line) {
    let m;
    try { m = JSON.parse(line); } catch (_) { return; }
    if (m.ev === 'deck') { cached = m.deck || null; changedNow(); return; }
    if (m.ev === 'spool') { void importAll(); return; }
    const p = m.id != null && pending.get(m.id);
    if (!p) return;
    pending.delete(m.id);
    clearTimeout(p.timer);
    if (m.ok) p.resolve(m.result);
    else p.reject(fail((m.error && m.error.message) || 'The recorder failed.', (m.error && m.error.code) || ''));
}

function changedNow() {
    try { onChange(); } catch (_) { /* optional */ }
    try { require('./phoneStatus').touch('xmrec'); } catch (_) { /* no phone status */ }
}

/**
 * The service answers a deck change with the new deck (or the new list), and the answer is put into the deck kept
 * here at once. Its own `ev: deck` push is debounced 150 ms, so the read a save's own screen makes right after it
 * used to return the deck from before the save: a search term (or timer, alert, tape setting) that had just been
 * added read as if it had not saved at all (Yukimi, Nov 26 2026).
 */
function applyDeck(key, result) {
    if (!cached) return result;
    const patch = key === 'deck'
        ? Object.assign({}, result || {})
        : { [key]: Array.isArray(result) ? result : [] };
    delete patch.offline;
    if (Object.keys(patch).length) { cached = Object.assign({}, cached, patch); changedNow(); }
    return result;
}

/** A deck change: send it, and let its own answer stand in for the deck until the service pushes one. */
function deckRpc(key, op, shape) {
    return async (arg) => applyDeck(key, await rpc(op, shape ? shape(arg) : (arg || {})));
}

function rpc(op, args) {
    if (!sock || !up) return Promise.reject(fail('The recorder service is not running.', 'XMREC_DOWN'));
    const id = ++seq;
    return new Promise((resolve, reject) => {
        const timer = setTimeout(() => { pending.delete(id); reject(fail('The recorder service did not answer.', 'XMREC_TIMEOUT')); }, RPC_MS);
        pending.set(id, { resolve, reject, timer });
        sock.write(`${JSON.stringify({ id, op, args: args || {} })}\n`);
    });
}

/**
 * Dreamscape's SiriusXM access tokens to the service, one per signed-in slot (it never signs in itself: a second session
 * is refused), at connect, before each recording starts, and again ten minutes before the soonest one expires: one timer
 * for all the slots, not one per slot. A slot that was pushed and is no longer signed in (signed out, or beyond the
 * slot count) is told to drop its token. Slot 1 is the radio's account and is pushed as before.
 */
let authTimer = null;
const pushedSlots = new Set();
async function pushAuth() {
    clearTimeout(authTimer);
    authTimer = null;
    let list = [];
    try { list = await xm.accessTokens(); } catch (_) { list = []; }
    if (up) {
        const live = new Set(list.map((a) => a.slot));
        for (const a of list) { try { await rpc('auth', a); pushedSlots.add(a.slot); } catch (_) { /* the next connect sends it */ } }
        for (const n of [...pushedSlots]) {
            if (live.has(n) || n === 1) continue;
            try { await rpc('auth', { slot: n, clear: true }); pushedSlots.delete(n); } catch (_) { /* the next push tries again */ }
        }
    }
    const soonest = list.length ? Math.min(...list.map((a) => a.exp)) : 0;
    const next = soonest ? Math.max(60000, soonest - Date.now() - 10 * 60000) : 5 * 60000;
    authTimer = setTimeout(() => { void pushAuth(); }, Math.min(next, 2 ** 31 - 1));
    if (authTimer.unref) authTimer.unref();
}
const withAuth = (op) => async (args) => { await pushAuth(); return rpc(op, args); };

/** The spool onto the tapes, one at a time (each entry once; a failure stays for the next try). */
function importAll() {
    importing = importing.then(async () => {
        for (const id of await engine.spoolList()) {
            try { await engine.importSpool(id); } catch (err) { console.warn(`[xmRadio rec] spool ${id}: ${err.message}`); }
        }
    });
    return importing;
}

/** The deck as the service last said; with the service away, the saved deck and nothing recording. */
function deck() {
    if (cached) return cached;
    let s = {};
    try { s = JSON.parse(fs.readFileSync(path.join(path.dirname(xm.accountFilePath()), 'xmradio-recorder.json'), 'utf8')) || {}; } catch (_) { s = {}; }
    const d = Object.assign({ workspaceId: 'default', tape: 'Tape 1', mode: 'song' }, s.deck || {});
    return { tape: d.tape, workspaceId: d.workspaceId, mode: d.mode, recordings: [], timers: s.timers || [], alerts: s.alerts || [], terms: s.terms || [], queue: s.queue || [], offline: true };
}

function segPath(rid, f) {
    if (!/^[0-9a-f]{24}$/.test(String(rid)) || !/^s\d+\.aac$/.test(String(f))) return null;
    const root = path.join(engine.recRoot(), String(rid));
    return fs.existsSync(path.join(root, f)) ? { root, f } : null;
}

function init(xmRadio, globalResources, { changed } = {}) {
    if (xm) return module.exports;
    xm = xmRadio;
    if (changed) onChange = changed;
    engine.library(xmRadio, globalResources);
    connect();
    return module.exports;
}

module.exports = {
    init,
    deck,
    online: () => up,
    start: (opts) => withAuth('start')(opts),
    stop: (rid) => rpc('stop', { rid }),
    recordCut: (channelId, o = {}) => withAuth('recordCut')({ channelId, fromStart: !!o.fromStart }),
    recordChannel: (channelId, o = {}) => withAuth('recordChannel')({ channelId, fromStart: !!o.fromStart }),
    recordRange: (channelId, o = {}) => withAuth('recordRange')({
        channelId, from: Number(o.from) || 0, to: Number(o.to) || 0,
        a: String(o.a || ''), t: String(o.t || ''), s: String(o.s || ''), ik: String(o.ik || '')
    }),
    queueRemove: deckRpc('queue', 'queueRemove', (id) => ({ id })),
    queueClear: deckRpc('queue', 'queueClear'),
    setDeck: deckRpc('deck', 'setDeck'),
    setTimers: deckRpc('timers', 'setTimers', (timers) => ({ timers })),
    addAlert: deckRpc('alerts', 'addAlert'),
    removeAlert: deckRpc('alerts', 'removeAlert', (id) => ({ id })),
    setTerms: deckRpc('terms', 'setTerms', (terms) => ({ terms })),
    pushAuth,
    playlist: (rid) => rpc('playlist', { rid }),
    // the service's cut store (modules/xmRadioMeta.js): the records over a time, and its totals
    meta: (channelId, from, to) => rpc('meta', { channelId, from: Number(from) || 0, to: Number(to) || 0 }),
    metaStats: () => rpc('metaStats', {}),
    segPath,
    // the tapes (the file store is Dreamscape's)
    tapes: (ws) => engine.tapes(ws),
    tapesInfo: (ws) => engine.tapesInfo(ws),
    tracks: (ws, tape) => engine.tracks(ws, tape),
    trackPath: (id) => engine.trackPath(id),
    trackRename: (id, name) => engine.trackRename(id, name),
    trackDelete: (id) => engine.trackDelete(id),
    trackMove: (id, tape) => engine.trackMove(id, tape),
    tapeNew: (ws, name) => engine.tapeNew(ws, name),
    async tapeRename(ws, from, to) {
        const r = await engine.tapeRename(ws, from, to);
        await rpc('tapeRenamed', { workspaceId: ws, from, to: r.tape }).catch(() => null);
        return r;
    },
    tapeDelete(ws, name) {
        if ((deck().recordings || []).some((r) => r.workspaceId === ws && r.tape === name)) return Promise.reject(new Error('That tape is being recorded on.'));
        return engine.tapeDelete(ws, name);
    }
};
