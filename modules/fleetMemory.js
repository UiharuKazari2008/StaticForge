'use strict';
/**
 * Host memory guard for Fleet (#1240, Yukimi Nov 25 2026: swap at 16.1 of 16.2 GB froze every WebSocket through
 * Dreamscape's 1-4 s stalls). Two jobs, both event-driven (no timer):
 *   admission()      a new supervised session starts only while MemAvailable and free swap are above a floor; the answer
 *                    carries the text the queue shows ("Waiting for memory: ...").
 *   sweepScratch()   removes the /tmp scratch folders of sessions that ended (tmpfs is RAM/swap backed). Runs when a
 *                    session ends and before a start; never touches a folder a live process still names.
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

module.exports = { readMem, admission, sweepScratch, liveSessionIds, MIN_MEM_MB, MIN_SWAP_FREE_MB };
