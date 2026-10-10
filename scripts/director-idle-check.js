#!/usr/bin/env node
/**
 * Director idle check for a server restart (see .cursor/rules/director-idle-before-restart.mdc).
 *
 * Busy when any of these is true:
 *   - Xi: a run record in ~/.cache/dreamscape-xi/runs/*.json whose pid is alive
 *     and is a cursor-agent/node process (guards against pid reuse).
 *   - Wren: a bwrap sandbox whose parent is the Dreamscape PM2 process
 *     (cursorDirector spawns every agent turn through bwrap).
 *   - Generation: a file under images/ written in the last N seconds (default 120).
 *
 * It reads /proc and the run records only. It never matches command-line text,
 * and it skips its own pid and every ancestor, so the checker (or the ssh/bash
 * that runs it) can never count as a live turn.
 *
 * Usage: node scripts/director-idle-check.js [--json] [--gen-window=120]
 * Exit: 0 idle, 1 busy, 2 could not decide (e.g. Dreamscape pid unknown).
 */
const fs = require('fs');
const os = require('os');
const path = require('path');

function readText(file) {
    try { return fs.readFileSync(file, 'utf8'); } catch (_) { return null; }
}

function procStat(procRoot, pid) {
    const raw = readText(path.join(procRoot, String(pid), 'stat'));
    if (!raw) return null;
    const close = raw.lastIndexOf(')');
    const comm = raw.slice(raw.indexOf('(') + 1, close);
    const rest = raw.slice(close + 2).split(' ');
    return { pid: Number(pid), comm, ppid: Number(rest[1]) };
}

function listProcs(procRoot) {
    let names = [];
    try { names = fs.readdirSync(procRoot); } catch (_) { return []; }
    return names.filter((n) => /^\d+$/.test(n)).map((n) => procStat(procRoot, n)).filter(Boolean);
}

function selfAndAncestors(procRoot, pid) {
    const out = new Set();
    let cur = Number(pid);
    while (cur > 1 && !out.has(cur)) {
        out.add(cur);
        const st = procStat(procRoot, cur);
        if (!st) break;
        cur = st.ppid;
    }
    return out;
}

const AGENT_COMMS = new Set(['cursor-agent', 'node', 'agent']);

function xiRuns({ procRoot, xiRunsDir, skip }) {
    let names = [];
    try { names = fs.readdirSync(xiRunsDir); } catch (_) { return []; }
    const live = [];
    for (const name of names) {
        if (!name.endsWith('.json')) continue;
        let meta = null;
        try { meta = JSON.parse(readText(path.join(xiRunsDir, name))); } catch (_) { continue; }
        const pid = Number(meta && meta.pid);
        if (!Number.isFinite(pid) || pid <= 1 || skip.has(pid)) continue;
        const st = procStat(procRoot, pid);
        if (!st || !AGENT_COMMS.has(st.comm)) continue;
        live.push({ pid, sessionId: meta.sessionId || null, name: meta.name || null, startedAt: meta.startedAt || null });
    }
    return live;
}

function wrenSandboxes({ procRoot, serverPid, skip }) {
    if (!serverPid) return [];
    return listProcs(procRoot)
        .filter((p) => p.ppid === serverPid && p.comm === 'bwrap' && !skip.has(p.pid))
        .map((p) => ({ pid: p.pid }));
}

function recentImages(dir, sinceMs, limit = 5) {
    const hits = [];
    const walk = (d, depth) => {
        if (hits.length >= limit || depth > 2) return;
        let ents = [];
        try { ents = fs.readdirSync(d, { withFileTypes: true }); } catch (_) { return; }
        for (const e of ents) {
            if (hits.length >= limit) return;
            const p = path.join(d, e.name);
            if (e.isDirectory()) { walk(p, depth + 1); continue; }
            try { if (fs.statSync(p).mtimeMs >= sinceMs) hits.push(p); } catch (_) { /* gone */ }
        }
    };
    walk(dir, 0);
    return hits;
}

function readServerPid(pm2Home) {
    const n = parseInt(String(readText(path.join(pm2Home, 'pids', 'Dreamscape-0.pid')) || '').trim(), 10);
    return Number.isFinite(n) && n > 1 ? n : null;
}

function checkIdle(opts = {}) {
    const home = opts.home || os.homedir();
    const procRoot = opts.procRoot || '/proc';
    const root = opts.root || path.resolve(__dirname, '..');
    const now = opts.now || Date.now();
    const genWindowSec = opts.genWindowSec || 120;
    const serverPid = opts.serverPid !== undefined ? opts.serverPid
        : readServerPid(opts.pm2Home || process.env.PM2_HOME || path.join(home, '.pm2'));
    const skip = selfAndAncestors(procRoot, opts.selfPid || process.pid);
    const xi = xiRuns({ procRoot, xiRunsDir: opts.xiRunsDir || path.join(home, '.cache', 'dreamscape-xi', 'runs'), skip });
    const wren = wrenSandboxes({ procRoot, serverPid, skip });
    const images = recentImages(opts.imagesDir || path.join(root, 'images'), now - genWindowSec * 1000);
    const serverAlive = !!(serverPid && procStat(procRoot, serverPid));
    const busy = xi.length > 0 || wren.length > 0 || images.length > 0;
    return { idle: !busy && serverAlive, decided: serverAlive || busy, serverPid, serverAlive, xi, wren, recentImages: images, genWindowSec };
}

module.exports = { checkIdle, selfAndAncestors, procStat };

if (require.main === module) {
    const json = process.argv.includes('--json');
    const w = process.argv.find((a) => a.startsWith('--gen-window='));
    const r = checkIdle({ genWindowSec: w ? Number(w.split('=')[1]) || 120 : 120 });
    if (json) console.log(JSON.stringify(r));
    else {
        console.log(`[idle-check] server pid=${r.serverPid || '?'} alive=${r.serverAlive}`);
        console.log(`[idle-check] xi live runs=${r.xi.length}${r.xi.map((x) => ` ${x.pid}(${x.name || x.sessionId})`).join('')}`);
        console.log(`[idle-check] wren sandboxes=${r.wren.length}${r.wren.map((x) => ` ${x.pid}`).join('')}`);
        console.log(`[idle-check] images in last ${r.genWindowSec}s=${r.recentImages.length}`);
        console.log(r.idle ? '[idle-check] IDLE' : (r.decided ? '[idle-check] BUSY' : '[idle-check] UNKNOWN (Dreamscape pid not found)'));
    }
    process.exit(r.idle ? 0 : (r.decided ? 1 : 2));
}
