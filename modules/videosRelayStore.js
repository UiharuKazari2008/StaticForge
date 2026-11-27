/**
 * Melaton Videos: what a live relay session was, kept on disk (StaticForge #1365), and how often one may be started again.
 *
 * The relays (modules/videosKickRelay.js, modules/videosYoutubeRelay.js) keep their running sessions in memory only. The phone's
 * player holds a session's address with the screen off and asks for it for ever, so a restart or a pause past the idle end
 * must not kill the stream: the relay writes a small record per session here, and starts the session again under the same
 * address when its playlist is asked for and the record is still there. Only the viewer ends a stream for good (the record
 * is removed then).
 *
 *   store   open(file, { max, ttlMs, touchWriteMs }) -> put / get / touch / remove / all / flush / close.
 *           A record is a small plain object ({ slug, mode, startedAt, lastHit, ... }). Ids are 24 hex characters.
 *           put / remove are written on the next tick (one write for any number of calls). touch (the request path:
 *           lastHit) is written at most once every touchWriteMs, by a one-shot timer that exists only while something
 *           waits to be written. Never an interval. Writes go to <file>.tmp and are renamed over the file (mode 0600).
 *           A disk error never reaches the caller: one warning, then the store carries on in memory.
 *   budget  ReviveBudget: the server side twin of the app's retune budget. An id may be started again at most every
 *           minGapMs, the gap doubling for every start that never came to play (up to maxGapMs), and at most
 *           maxInWindow times in windowMs. In memory; nothing runs on a timer.
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ID = /^[a-f0-9]{24}$/;
const opened = new Map(); // absolute file -> store: a module reload of a relay gets the same writer back

const plain = (v) => !!v && typeof v === 'object' && !Array.isArray(v);
const copy = (v) => JSON.parse(JSON.stringify(v));

function open(file, opts = {}) {
    const abs = path.resolve(String(file));
    const held = opened.get(abs);
    if (held) return held;
    const store = create(abs, opts || {});
    opened.set(abs, store);
    return store;
}

function create(file, opts) {
    const max = Math.max(1, Number(opts.max) || 16);
    const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : 12 * 3600000;
    const touchWriteMs = Number(opts.touchWriteMs) > 0 ? Number(opts.touchWriteMs) : 20000;
    const records = new Map(); // id -> record (always carries lastHit)
    let dirty = false;
    let soon = null; // the next-tick write
    let touchTimer = null; // the debounced write after touches
    let closed = false;
    let warned = false;

    const expired = (r) => Date.now() - r.lastHit > ttlMs;

    function load() {
        let text = '';
        try { text = fs.readFileSync(file, 'utf8'); } catch (_) { return; }
        let j = null;
        try { j = JSON.parse(text); } catch (_) { return; }
        if (!plain(j) || !plain(j.sessions)) return;
        for (const [id, r] of Object.entries(j.sessions)) {
            if (!ID.test(id) || !plain(r)) continue;
            records.set(id, Object.assign(copy(r), { lastHit: Number(r.lastHit) || 0 }));
        }
        trim();
    }

    function trim() {
        while (records.size > max) {
            let oldest = null;
            for (const [id, r] of records) if (oldest === null || r.lastHit < records.get(oldest).lastHit) oldest = id;
            records.delete(oldest);
        }
    }

    function writeNow() {
        const sessions = {};
        for (const [id, r] of records) sessions[id] = r;
        const tmp = `${file}.tmp`;
        try {
            fs.mkdirSync(path.dirname(file), { recursive: true });
            fs.writeFileSync(tmp, JSON.stringify({ v: 1, sessions }), { mode: 0o600 });
            fs.renameSync(tmp, file);
            dirty = false;
        } catch (e) {
            try { fs.unlinkSync(tmp); } catch (_) { /* never written */ }
            if (!warned) { warned = true; console.warn(`[videos] session records could not be written: ${e.message}`); }
        }
    }

    function cancel() {
        if (soon) { clearImmediate(soon); soon = null; }
        if (touchTimer) { clearTimeout(touchTimer); touchTimer = null; }
    }

    // put / remove: one write on the next tick for any number of calls
    function writeSoon() {
        dirty = true;
        if (soon || closed) return;
        soon = setImmediate(() => { soon = null; if (dirty) writeNow(); });
    }

    // touch: at most one write per touchWriteMs; the timer is armed only by a change and only when none is armed
    function writeLater() {
        dirty = true;
        if (touchTimer || closed) return;
        touchTimer = setTimeout(() => { touchTimer = null; if (dirty) writeNow(); }, touchWriteMs);
        if (touchTimer.unref) touchTimer.unref();
    }

    function live(id) {
        const r = ID.test(String(id)) ? records.get(String(id)) : null;
        if (!r) return null;
        if (expired(r)) { records.delete(String(id)); writeSoon(); return null; }
        return r;
    }

    load();

    const api = {
        put(id, record) {
            if (!ID.test(String(id)) || !plain(record)) return false;
            let r;
            try { r = copy(record); } catch (_) { return false; }
            r.lastHit = Number(record.lastHit) || Date.now();
            records.set(String(id), r);
            trim();
            writeSoon();
            return true;
        },
        get(id) {
            const r = live(id);
            return r ? copy(r) : null;
        },
        touch(id, patch) {
            const r = live(id);
            if (!r || !plain(patch)) return false;
            let changed = false;
            for (const [k, v] of Object.entries(patch)) {
                if (v === r[k] || (v && typeof v === 'object' && JSON.stringify(v) === JSON.stringify(r[k]))) continue;
                r[k] = v && typeof v === 'object' ? copy(v) : v;
                changed = true;
            }
            if (changed) writeLater();
            return true;
        },
        remove(id) {
            if (!ID.test(String(id))) return false;
            const had = records.delete(String(id));
            if (had) writeSoon();
            return had;
        },
        all() {
            const out = [];
            for (const id of [...records.keys()]) {
                const r = live(id);
                if (r) out.push(Object.assign(copy(r), { id }));
            }
            return out.sort((a, b) => b.lastHit - a.lastHit);
        },
        flush() {
            cancel();
            if (dirty) writeNow();
        },
        // flush, drop the timers and let the next open() of this file read it afresh (a closed store arms no timers)
        close() {
            api.flush();
            closed = true;
            if (opened.get(file) === api) opened.delete(file);
        }
    };
    return api;
}

/** How often a session may be started again: per id, in memory, the answer for the route's Retry-After as well. */
class ReviveBudget {
    constructor(opts = {}) {
        const o = opts || {};
        this.minGapMs = Number(o.minGapMs) > 0 ? Number(o.minGapMs) : 20000;
        this.maxGapMs = Number(o.maxGapMs) > 0 ? Number(o.maxGapMs) : 300000;
        this.windowMs = Number(o.windowMs) > 0 ? Number(o.windowMs) : 600000;
        this.maxInWindow = Number(o.maxInWindow) > 0 ? Number(o.maxInWindow) : 5;
        this.entries = new Map(); // id -> { takes: [at...], unproven }
    }

    _gap(e) { return e.unproven <= 1 ? this.minGapMs : Math.min(this.maxGapMs, this.minGapMs * 2 ** (e.unproven - 1)); }

    _inWindow(e, now) { return e.takes.filter((t) => now - t < this.windowMs); }

    take(id, now = Date.now()) {
        // ids not taken within the window are forgotten here, not by a timer
        for (const [k, e] of this.entries) if (now - e.takes[e.takes.length - 1] >= this.windowMs) this.entries.delete(k);
        const key = String(id);
        let e = this.entries.get(key);
        if (e) {
            if (now - e.takes[e.takes.length - 1] < this._gap(e)) return false;
            e.takes = this._inWindow(e, now);
            if (e.takes.length >= this.maxInWindow) return false;
        } else {
            e = { takes: [], unproven: 0 };
            this.entries.set(key, e);
        }
        e.takes.push(now);
        e.unproven += 1;
        return true;
    }

    waitMs(id, now = Date.now()) {
        const e = this.entries.get(String(id));
        if (!e || !e.takes.length || now - e.takes[e.takes.length - 1] >= this.windowMs) return 0;
        let wait = Math.max(0, e.takes[e.takes.length - 1] + this._gap(e) - now);
        const inWindow = this._inWindow(e, now);
        if (inWindow.length >= this.maxInWindow) wait = Math.max(wait, inWindow[inWindow.length - this.maxInWindow] + this.windowMs - now);
        return Math.max(0, wait);
    }

    proven(id) {
        const e = this.entries.get(String(id));
        if (e) e.unproven = 0;
    }

    forget(id) { this.entries.delete(String(id)); }
}

module.exports = { open, ReviveBudget, _test: { forgetOpen() { opened.clear(); } } };
