#!/usr/bin/env node
'use strict';

/**
 * Dreamscape end of a Misaka session's watcher stream (started by misaka-gate.js `ingest <session id>`; not part of the server).
 * stdin = line JSON from scripts/fleet/misaka-watch.js running next to the session on Fat Misaka:
 *   {t:'hello', proj}                the transcript's project folder name there
 *   {t:'rec', rec, alive}            the session's own record (~/.claude/sessions/<pid>.json there): status, name, link ids
 *   {t:'tr', off, b64}               transcript bytes at an offset: written into the local mirror
 *                                    ~/.claude/projects/<proj>/<id>.jsonl, so Fleet reads it like any local session
 *   {t:'hb'}                         still here (every 20 s)
 *   {t:'bye'}                        its claude process ended
 * The live state goes to <state>/misaka-live/<id>.json (read by modules/misakaSessions.js mirrorLive()). A session that is not
 * in <state>/misaka-sessions.json (the launcher's record) is refused, so the stream cannot invent sessions.
 */

const fs = require('fs');
const os = require('os');
const path = require('path');

const SID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const sid = process.argv[2];
if (!SID_RE.test(String(sid || ''))) { process.stderr.write('bad session id\n'); process.exit(2); }
const state = process.env.DREAMSCAPE_CLAUDE_DESK_STATE || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents');
const claudeHome = process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir();

let known = {};
try { known = JSON.parse(fs.readFileSync(path.join(state, 'misaka-sessions.json'), 'utf8')); } catch (_) { known = {}; }
if (!known[sid]) { process.stderr.write('unknown session\n'); process.exit(3); }

const liveDir = path.join(state, 'misaka-live');
fs.mkdirSync(liveDir, { recursive: true, mode: 0o700 });
const liveFile = path.join(liveDir, `${sid}.json`);
let live = { sessionId: sid, alive: false, rec: null, seenAt: 0, ended: false };
try { live = Object.assign(live, JSON.parse(fs.readFileSync(liveFile, 'utf8'))); } catch (_) { /* first stream */ }
let fd = null;
let proj = '';

function save() {
    live.seenAt = Date.now();
    const tmp = `${liveFile}.${process.pid}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(live), { mode: 0o600 });
    fs.renameSync(tmp, liveFile);
}

function handle(m) {
    if (!m || typeof m !== 'object') return;
    if (m.t === 'hello') {
        if (!/^[A-Za-z0-9._-]{1,200}$/.test(String(m.proj || ''))) return;
        proj = m.proj;
        const dir = path.join(claudeHome, '.claude', 'projects', proj);
        fs.mkdirSync(dir, { recursive: true });
        if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* closed */ } }
        fd = fs.openSync(path.join(dir, `${sid}.jsonl`), 'a+');
        live.proj = proj;
        save();
    } else if (m.t === 'rec') {
        const r = m.rec && typeof m.rec === 'object' ? m.rec : {};
        live.rec = {
            sessionId: sid, status: String(r.status || '').slice(0, 20), name: String(r.name || '').slice(0, 200), nameSource: String(r.nameSource || '').slice(0, 20),
            bridgeSessionId: r.bridgeSessionId ? String(r.bridgeSessionId).slice(0, 120) : '', startedAt: Number(r.startedAt) || 0, updatedAt: Number(r.updatedAt) || 0,
            cwd: String(r.cwd || '').slice(0, 400), pid: Number(r.pid) || 0
        };
        live.alive = m.alive !== false;
        save();
    } else if (m.t === 'tr' && fd !== null) {
        const off = Number(m.off);
        if (!Number.isInteger(off) || off < 0) return;
        const buf = Buffer.from(String(m.b64 || ''), 'base64');
        if (off === 0) fs.ftruncateSync(fd, 0);
        fs.writeSync(fd, buf, 0, buf.length, off);
    } else if (m.t === 'hb') {
        save();
    } else if (m.t === 'bye') {
        live.alive = false;
        live.ended = true;
        save();
    }
}

let buf = '';
process.stdin.setEncoding('utf8');
process.stdin.on('data', (c) => {
    buf += c;
    if (buf.length > 8 * 1024 * 1024) process.exit(4);
    let i;
    while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 1);
        if (!line) continue;
        try { handle(JSON.parse(line)); } catch (_) { /* a bad line is skipped */ }
    }
});
process.stdin.on('end', () => { if (fd !== null) { try { fs.closeSync(fd); } catch (_) { /* closed */ } } process.exit(0); });
