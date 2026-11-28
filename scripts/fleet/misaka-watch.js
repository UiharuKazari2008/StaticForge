#!/usr/bin/env node
'use strict';

/**
 * Runs on Fat Misaka next to a Fleet session (shipped by modules/misakaSessions.js, started in tmux fleetwatch-<id8>):
 *   node misaka-watch.js <session id> <config dir> [done file] | ssh <gate> ingest <session id>
 * Pushes (fs.watch, no polling by Dreamscape) the session's record, its transcript bytes and a heartbeat as line JSON.
 * Every start sends the whole transcript again from offset 0, so a dropped connection or a Dreamscape restart heals itself.
 * Exits 0 after its claude process ended and said bye.
 */

const fs = require('fs');
const path = require('path');

const sid = process.argv[2];
const cfg = process.argv[3];
const doneFile = process.argv[4] || '';
if (!/^[0-9a-f-]{36}$/.test(String(sid || '')) || !cfg) process.exit(2);
const sessionsDir = path.join(cfg, 'sessions');
const projectsDir = path.join(cfg, 'projects');
const out = (o) => { try { process.stdout.write(`${JSON.stringify(o)}\n`); } catch (_) { /* pipe closed */ } };

let transcript = null;
let offset = 0;
let proj = '';
let recFile = null;
let lastRec = '';
let sawAlive = false;

function findTranscript() {
    if (transcript) return;
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir); } catch (_) { return; }
    for (const d of dirs) {
        const f = path.join(projectsDir, d, `${sid}.jsonl`);
        if (fs.existsSync(f)) { transcript = f; proj = d; out({ t: 'hello', proj }); offset = 0; return; }
    }
}
function pump() {
    findTranscript();
    if (!transcript) return;
    let st;
    try { st = fs.statSync(transcript); } catch (_) { return; }
    if (st.size < offset) offset = 0;
    while (offset < st.size) {
        const n = Math.min(st.size - offset, 512 * 1024);
        const b = Buffer.alloc(n);
        const fd = fs.openSync(transcript, 'r');
        try { fs.readSync(fd, b, 0, n, offset); } finally { fs.closeSync(fd); }
        out({ t: 'tr', off: offset, b64: b.toString('base64') });
        offset += n;
    }
}
function alive(pid) { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } }
function rec() {
    if (!recFile) {
        let names = [];
        try { names = fs.readdirSync(sessionsDir).filter((n) => /^\d+\.json$/.test(n)); } catch (_) { return; }
        for (const n of names) {
            try { const r = JSON.parse(fs.readFileSync(path.join(sessionsDir, n), 'utf8')); if (r.sessionId === sid) { recFile = path.join(sessionsDir, n); break; } } catch (_) { /* next */ }
        }
        if (!recFile) return;
    }
    let r;
    try { r = JSON.parse(fs.readFileSync(recFile, 'utf8')); } catch (_) { r = null; }
    const up = !!(r && Number.isInteger(r.pid) && alive(r.pid));
    if (up) sawAlive = true;
    const s = JSON.stringify([r, up]);
    if (s !== lastRec) { lastRec = s; out({ t: 'rec', rec: r, alive: up }); }
    if (sawAlive && !up) { pump(); out({ t: 'bye' }); if (doneFile) { try { fs.writeFileSync(doneFile, 'ended\n'); } catch (_) { /* the loop retries once */ } } setTimeout(() => process.exit(0), 200); }
}
function tick() { pump(); rec(); }

for (const d of [sessionsDir, projectsDir]) { try { fs.watch(d, { recursive: true }, () => tick()); } catch (_) { /* appears later: the heartbeat finds it */ } }
setInterval(() => { out({ t: 'hb' }); tick(); }, 20000);
tick();
process.stdout.on('error', () => process.exit(0));
