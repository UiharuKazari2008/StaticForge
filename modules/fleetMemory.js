'use strict';
/**
 * Host memory guard for Fleet (#1240, Yukimi Nov 25 2026: swap at 16.1 of 16.2 GB froze every WebSocket through
 * Dreamscape's 1-4 s stalls). Three jobs, all event-driven (no timer):
 *   admission()      a new supervised session starts only while MemAvailable and free swap are above a floor; the answer
 *                    carries the text the queue shows ("Waiting for memory: ...").
 *   sweepScratch()   removes the /tmp scratch folders of sessions that ended (tmpfs is RAM/swap backed). Runs when a
 *                    session ends and before a start; never touches a folder a live process still names.
 *   finishedSessions() (#1255) the decision of which rc-* tmux sessions to close: ~46 finished sessions (200-380 MB each) sat in
 *                    their tmux sessions after their work item was done and filled the host. Pure: the Supervisor feeds it the
 *                    rc-* sessions (rcCandidates), the work rows naming each and the in-flight check, then disconnects what it says.
 *   parkedSessions() (#1256) the same for the idle session of a parked item (Sent Back too long, now Input Required): closed after
 *                    it has been parked a while; answering the item or Send Back to Work resumes it.
 * Floors come from measurements on the host (13.9 GB RAM, 16 GB swap, one claude session 200-380 MB): MemAvailable 1.5 GB
 * keeps room for a session plus Dreamscape's major GC; free swap 2 GB keeps it from paging through a full swap. Override
 * with FLEET_MIN_MEM_MB / FLEET_MIN_SWAP_FREE_MB.
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

const MIN_MEM_MB = Number(process.env.FLEET_MIN_MEM_MB) || 1500;
const MIN_SWAP_FREE_MB = Number(process.env.FLEET_MIN_SWAP_FREE_MB) || 2048;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;

/** MemAvailable / SwapFree / SwapTotal in MB from /proc/meminfo (text may be passed for tests). */
function readMem(text) {
    const t = text !== undefined ? text : fs.readFileSync('/proc/meminfo', 'utf8');
    const kb = (k) => { const m = new RegExp(`^${k}:\\s+(\\d+)`, 'm').exec(t); return m ? Math.round(Number(m[1]) / 1024) : 0; };
    return { memAvailMb: kb('MemAvailable'), swapFreeMb: kb('SwapFree'), swapTotalMb: kb('SwapTotal') };
}

/** { ok, reason, ...mem }: ok false while memory or swap is short (a host with no swap only checks memory). */
function admission(mem) {
    const m = mem || readMem();
    const lowMem = m.memAvailMb < MIN_MEM_MB;
    const lowSwap = m.swapTotalMb > 0 && m.swapFreeMb < MIN_SWAP_FREE_MB;
    if (!lowMem && !lowSwap) return { ok: true, reason: '', ...m };
    const parts = [];
    if (lowMem) parts.push(`${m.memAvailMb} MB RAM available (needs ${MIN_MEM_MB})`);
    if (lowSwap) parts.push(`${m.swapFreeMb} MB swap free (needs ${MIN_SWAP_FREE_MB})`);
    return { ok: false, reason: `Waiting for memory: ${parts.join(', ')}`, ...m };
}

/** Session ids named by any live process (command line or the notes dir in its environment). */
function liveSessionIds() {
    const ids = new Set();
    for (const p of fs.readdirSync('/proc')) {
        if (!/^\d+$/.test(p)) continue;
        for (const f of ['cmdline', 'environ']) {
            let s;
            try { s = fs.readFileSync(`/proc/${p}/${f}`, 'latin1'); } catch (_) { continue; }
            const re = /[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/g;
            let m;
            while ((m = re.exec(s))) ids.add(m[0]);
        }
    }
    return ids;
}

const TERMINAL = ['done', 'failed', 'cancelled'];
/**
 * The rc-* sessions to look at (#1255). CLI 2.1.332 no longer writes `tmux` into ~/.claude/sessions/<pid>.json, so a live
 * session's origin says nothing: the candidates are the rc-<id8> tmux sessions on Fleet's own socket (names), plus live
 * sessions whose origin is still 'rc' (older CLIs). Each rc-<id8> is tied to a full session id: a live session whose id starts
 * with id8, else the session_id of work rows that start with it. Several full ids under one id8 -> ambiguous (kept).
 *   names: tmux session names; live: liveSessions() rows; rows: work rows { id, state, session_id } (any whose id starts like a name).
 * Returns { candidates: [{ id|null, tmuxSession, status, ambiguous? }], itemsBySession: Map full id -> rows }.
 */
function rcCandidates({ names, live, rows }) {
    const candidates = [];
    const itemsBySession = new Map();
    for (const r of rows || []) {
        if (!r.session_id) continue;
        if (!itemsBySession.has(r.session_id)) itemsBySession.set(r.session_id, []);
        itemsBySession.get(r.session_id).push(r);
    }
    const lv = live || [];
    const named = new Set();
    for (const name of names || []) {
        if (!/^rc-[A-Za-z0-9_-]+$/.test(name)) continue;
        named.add(name);
        const id8 = name.slice(3);
        const liveIds = [...new Set(lv.filter((x) => x.id.startsWith(id8)).map((x) => x.id))];
        const ids = liveIds.length ? liveIds : [...itemsBySession.keys()].filter((k) => k.startsWith(id8));
        const c = { id: ids.length === 1 ? ids[0] : null, tmuxSession: name, status: '' };
        if (ids.length > 1) c.ambiguous = true;
        const l = lv.find((x) => x.id === c.id);
        if (l) c.status = l.status;
        candidates.push(c);
    }
    for (const l of lv) if (l.origin === 'rc' && /^rc-/.test(l.tmuxSession || '') && !named.has(l.tmuxSession)) candidates.push({ id: l.id, tmuxSession: l.tmuxSession, status: l.status });
    return { candidates, itemsBySession };
}

/**
 * Which rc-* sessions to close (#1255). A session closes only when work items name it, EVERY one of them is done / failed /
 * cancelled, and nothing is in flight for it (status busy, background agents / shells, a review: inFlight(sid)). A tmux session
 * whose claude process exited (the pane holds on `sleep`) closes the same way. Closing loses nothing: a done or failed item that
 * runs again resumes its session (steerResumed).
 * A session no work item names goes in `unowned` and is NEVER closed, only reported: it may be Yukimi's own hand-started Remote
 * Control session, or one whose item moved to another session (a login move), and nothing here can tell which.
 *   candidates: from rcCandidates; itemsBySession: Map full session id -> [{ id, state }]; inFlight(sid): true while anything runs.
 * Returns { close: [{ id, tmuxSession, itemId, state }], keep: [{ id, tmuxSession, why }], unowned: [{ id, tmuxSession }] }.
 */
function finishedSessions({ candidates, itemsBySession, inFlight }) {
    const out = { close: [], keep: [], unowned: [] };
    for (const s of candidates || []) {
        if (!s || !/^rc-/.test(s.tmuxSession || '')) continue;
        if (s.ambiguous) { out.keep.push({ id: s.id, tmuxSession: s.tmuxSession, why: `several sessions under ${s.tmuxSession}` }); continue; }
        const items = (s.id && itemsBySession && itemsBySession.get(s.id)) || [];
        if (!items.length) { out.unowned.push({ id: s.id, tmuxSession: s.tmuxSession }); continue; }
        const open = items.find((i) => !TERMINAL.includes(i.state));
        if (open) { out.keep.push({ id: s.id, tmuxSession: s.tmuxSession, why: `item ${open.id} is ${open.state}` }); continue; }
        if (s.status === 'busy' || (inFlight && inFlight(s.id))) { out.keep.push({ id: s.id, tmuxSession: s.tmuxSession, why: 'work in flight' }); continue; }
        const last = items.reduce((a, b) => (Number(b.id) > Number(a.id) ? b : a));
        out.close.push({ id: s.id, tmuxSession: s.tmuxSession, itemId: last.id, state: last.state });
    }
    return out;
}

/**
 * Which rc-* sessions of PARKED items to close (#1256). A parked item is Input Required because it sat Sent Back too long (state
 * 'input' with parked_at set): nobody is working on it, yet its claude process holds 200-380 MB. A session closes only when work
 * items name it, every one of them is over (done / failed / cancelled) or parked, at least one is parked, the newest park is
 * closeAfterMs old or more, and nothing is in flight for it (status busy, background agents / shells, a review: inFlight(sid)).
 * An item that is Input Required for a real question, running or waiting keeps its session. Closing loses nothing: answering the
 * item or Send Back to Work resumes the session (steerResumed).
 *   candidates: from rcCandidates; itemsBySession: Map full session id -> [{ id, state, parked_at }]; now / closeAfterMs in ms.
 * Returns { close: [{ id, tmuxSession, itemId, parkedAt }], keep: [{ id, tmuxSession, why }] }.
 */
function parkedSessions({ candidates, itemsBySession, inFlight, now, closeAfterMs }) {
    const out = { close: [], keep: [] };
    const at = Number(now) || Date.now();
    const after = Number(closeAfterMs) >= 0 ? Number(closeAfterMs) : 60 * 60000;
    const isParked = (i) => i.state === 'input' && Number(i.parked_at) > 0;
    for (const s of candidates || []) {
        if (!s || !/^rc-/.test(s.tmuxSession || '')) continue;
        const items = (s.id && !s.ambiguous && itemsBySession && itemsBySession.get(s.id)) || [];
        const parked = items.filter(isParked);
        if (!parked.length) continue; // nothing parked here: not this decision's business (finishedSessions handles the finished ones)
        const other = items.find((i) => !isParked(i) && !TERMINAL.includes(i.state));
        if (other) { out.keep.push({ id: s.id, tmuxSession: s.tmuxSession, why: `item ${other.id} is ${other.state}` }); continue; }
        const newest = parked.reduce((a, b) => (Number(b.parked_at) > Number(a.parked_at) ? b : a));
        if (at - Number(newest.parked_at) < after) { out.keep.push({ id: s.id, tmuxSession: s.tmuxSession, why: 'parked less than the limit ago' }); continue; }
        if (s.status === 'busy' || (inFlight && inFlight(s.id))) { out.keep.push({ id: s.id, tmuxSession: s.tmuxSession, why: 'work in flight' }); continue; }
        out.close.push({ id: s.id, tmuxSession: s.tmuxSession, itemId: newest.id, parkedAt: Number(newest.parked_at) });
    }
    return out;
}

const scratchRoot = () => path.join(os.tmpdir(), `claude-${process.getuid ? process.getuid() : 1000}`);

/** Removes per-session scratch folders under /tmp/claude-<uid>/<project>/ whose session has no live process and which
 *  were not touched for graceMin minutes. Returns { removed, freedMb }. root: for tests. */
function sweepScratch(opts = {}) {
    const root = opts.root || scratchRoot();
    const graceMs = (opts.graceMin === undefined ? 60 : opts.graceMin) * 60000;
    const live = opts.live || liveSessionIds();
    let removed = 0; let freedKb = 0;
    let projects = [];
    try { projects = fs.readdirSync(root, { withFileTypes: true }).filter((d) => d.isDirectory() && d.name.startsWith('-')); } catch (_) { return { removed, freedMb: 0 }; }
    for (const pr of projects) {
        const pdir = path.join(root, pr.name);
        let ents = [];
        try { ents = fs.readdirSync(pdir); } catch (_) { continue; }
        for (const id of ents) {
            if (!UUID.test(id) || live.has(id)) continue;
            const dir = path.join(pdir, id);
            try {
                if (Date.now() - fs.statSync(dir).mtimeMs < graceMs) continue;
                freedKb += dirKb(dir);
                fs.rmSync(dir, { recursive: true, force: true });
                removed++;
            } catch (_) { /* busy or gone: next sweep */ }
        }
    }
    return { removed, freedMb: Math.round(freedKb / 1024) };
}

function dirKb(dir) {
    let n = 0;
    try {
        for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
            const p = path.join(dir, e.name);
            n += e.isDirectory() ? dirKb(p) : Math.ceil(fs.lstatSync(p).size / 1024);
        }
    } catch (_) { /* gone */ }
    return n;
}

module.exports = { readMem, admission, sweepScratch, finishedSessions, parkedSessions, rcCandidates, TERMINAL, liveSessionIds, MIN_MEM_MB, MIN_SWAP_FREE_MB };
