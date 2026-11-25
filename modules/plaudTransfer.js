'use strict';

/**
 * The Plaud recorder's transfer status for Today's Plaud item (#1193), taken from the Plaud Android app's own
 * notifications on the phone (package ai.plaud.android.plaud), which the server already receives over ActiveSync
 * (notify.posted / notify.removed; fields used: package, key, title, text). Plaud's cloud has no such status.
 *
 *   "Transfer complete"                          -> complete (now), transferring off
 *   "Your note is ready"                         -> noteReadyAt = now
 *   "File transfer in progress" / "Transferring" -> transferring on (its notification key is remembered)
 *   "Transfer failed / interrupted / stopped"    -> transferring off; its notification removed -> off
 * A transferring older than 30 minutes without a newer notice counts as off when read. No timers: a change is pushed
 * to the page through bind(). While Plaud is linked the phone's notification filter keeps this package
 * (wantsKeep), or its progress channel would be dropped on the phone.
 *
 * Kept in .cache/plaud-transfer.json (0600; env PLAUD_TRANSFER_FILE): { linked, transferring, key, at, seen, completedAt, noteReadyAt }.
 */

const fs = require('fs');
const path = require('path');

const FILE = process.env.PLAUD_TRANSFER_FILE || path.join(__dirname, '..', '.cache', 'plaud-transfer.json');
const PACKAGE = 'ai.plaud.android.plaud';
const STALE_MS = 30 * 60 * 1000;
const COMPLETE_MS = 12 * 60 * 60 * 1000;

let deps = {};
let s = null;
let broadcast = null;
let tapped = false;
let last = '';

function load() {
    if (s) return s;
    let f = null;
    try { f = JSON.parse(fs.readFileSync(FILE, 'utf8')); } catch (_) { f = null; }
    const n = (v) => (Number(v) > 0 ? Number(v) : 0);
    s = { linked: !!(f && f.linked), transferring: !!(f && f.transferring), key: (f && typeof f.key === 'string') ? f.key : '', at: n(f && f.at), seen: n(f && f.seen), completedAt: n(f && f.completedAt), noteReadyAt: n(f && f.noteReadyAt) };
    return s;
}

function save() {
    const tmp = `${FILE}.${process.pid}.tmp`;
    try {
        fs.mkdirSync(path.dirname(FILE), { recursive: true });
        fs.writeFileSync(tmp, JSON.stringify(s), { mode: 0o600 });
        fs.renameSync(tmp, FILE);
    } catch (e) {
        console.warn(`[plaud-transfer] not saved: ${e.message}`);
    }
}

const now = () => (deps.now ? deps.now() : Date.now());

function state() {
    const v = load();
    const t = now();
    if (v.transferring && t - (v.seen || v.at) < STALE_MS) return { state: 'transferring', at: v.at, noteReadyAt: v.noteReadyAt };
    if (v.completedAt && t - v.completedAt < COMPLETE_MS) return { state: 'complete', at: v.completedAt, noteReadyAt: v.noteReadyAt };
    return { state: 'none', at: 0, noteReadyAt: v.noteReadyAt };
}

/** Calls the bound function when what state() says changed (not on a repeated progress update). */
function changed() {
    const st = state();
    const sig = `${st.state}|${st.at}|${st.noteReadyAt}`;
    if (sig === last) return;
    last = sig;
    if (broadcast) { try { broadcast(); } catch (_) { /* the page learns on its next read */ } }
}

/** One activeSync device event: only the Plaud app's notices count. */
function take(name, detail) {
    if (!detail || typeof detail !== 'object' || detail.package !== PACKAGE) return;
    const v = load();
    last = last || (() => { const st = state(); return `${st.state}|${st.at}|${st.noteReadyAt}`; })();
    const t = now();
    if (name === 'notify.removed') {
        if (!(v.transferring && v.key && String(detail.key || '') === v.key)) return;
        v.transferring = false;
    } else if (name === 'notify.posted') {
        const words = `${detail.title || ''} ${detail.text || ''}`.toLowerCase();
        if (/transfer complete/.test(words)) { v.completedAt = t; v.transferring = false; }
        else if (/note is ready/.test(words)) v.noteReadyAt = t;
        else if (/transfer (failed|interrupted|stopped)/.test(words)) v.transferring = false;
        else if (/transferr?ing|transfer in progress/.test(words)) {
            // a repeated progress update only refreshes the key and the 30 minute clock
            const again = v.transferring && t - (v.seen || v.at) < STALE_MS;
            if (!again) v.at = t;
            v.transferring = true;
            v.key = String(detail.key || '');
            v.seen = t;
            if (again) return;   // in memory only: the file is written when the state changes
        } else return;
    } else return;
    save();
    changed();
}

/** Whether the phone's notification filter keeps the Plaud package (read from the file, no waiting). */
function wantsKeep() { return load().linked; }

function setLinked(linked) {
    const v = load();
    if (v.linked === !!linked) return;
    v.linked = !!linked;
    save();
}

function bind(fn) { broadcast = typeof fn === 'function' ? fn : null; }

function attach() {
    if (tapped) return;
    tapped = true;
    (deps.activeSync || require('./activeSync')).onDeviceEvent((name, detail) => take(name, detail));
}

module.exports = {
    PACKAGE, take, state, setLinked, wantsKeep, bind, attach,
    _test: {
        setDeps: (d) => { deps = Object.assign(deps, d || {}); },
        reset: () => { s = null; last = ''; broadcast = null; tapped = false; deps = {}; }
    }
};
