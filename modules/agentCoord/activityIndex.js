'use strict';

/**
 * Global activity index (#1154, Fleet): every shell command, tool call and file edit of every Claude Code
 * session on this host, newest first, paged. Lives in the agent-coord database (store.open()).
 *
 *   activity         one row per tool_use: where it is (file_key + at_offset + part), when, what (tool,
 *                    kind shell | edit | tool, one-line summary, target, the input's description) and where
 *                    its tool_result is (result_offset, result_error, result_size)
 *   activity_scans   per transcript file, the byte offset the scanner stopped at (never re-read from the
 *                    start; only complete lines), plus the session's cwd / title seen so far
 *
 * Costs: scanFile reads from the stored offset, at most CAP bytes a call, and only parses lines that hold
 * a tool_use / tool_result / title; refresh() walks the transcripts touched in the last 14 days (newest
 * first, subagents too) inside a time budget and resumes where it stopped next call. Rows older than 30
 * days are pruned. detail() reads only the lines it needs, by byte offset. Nothing polls.
 * Everything returned is masked (claudeTranscript.mask).
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const store = require('./store');
const { mask } = require('../claudeTranscript');

const CAP = 32 * 1024 * 1024;
const STEP = 8 * 1024 * 1024;              // refresh scans in steps of this size, yielding between them
const RECENT_MS = 14 * 24 * 3600 * 1000;
const KEEP_MS = 30 * 24 * 3600 * 1000;
const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const EDIT_TOOLS = new Set(['Edit', 'Write', 'MultiEdit', 'NotebookEdit']);
const INPUT_CAP = 20 * 1024;
const OUTPUT_CAP = 40 * 1024;
const WHY_CAP = 2048;

const claudeHome = () => process.env.DREAMSCAPE_CLAUDE_HOME || os.homedir();
const projectsDir = () => path.join(claudeHome(), '.claude', 'projects');

let ready = null;
function db() {
    const d = store.open();
    if (ready !== d) {
        d.exec(`
            CREATE TABLE IF NOT EXISTS activity (
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, agent_id TEXT NOT NULL DEFAULT '',
                file_key TEXT NOT NULL, at_offset INTEGER NOT NULL, part INTEGER NOT NULL DEFAULT 0, ts INTEGER NOT NULL,
                tool TEXT NOT NULL, kind TEXT NOT NULL, summary TEXT NOT NULL DEFAULT '', target TEXT NOT NULL DEFAULT '',
                description TEXT NOT NULL DEFAULT '', tool_use_id TEXT NOT NULL DEFAULT '',
                result_offset INTEGER, result_error INTEGER NOT NULL DEFAULT 0, result_size INTEGER
            );
            CREATE INDEX IF NOT EXISTS activity_ts ON activity (ts);
            CREATE INDEX IF NOT EXISTS activity_kind_ts ON activity (kind, ts);
            CREATE INDEX IF NOT EXISTS activity_session_ts ON activity (session_id, ts);
            CREATE INDEX IF NOT EXISTS activity_tu ON activity (file_key, tool_use_id);
            CREATE TABLE IF NOT EXISTS activity_scans (
                file_key TEXT PRIMARY KEY, file TEXT NOT NULL, offset INTEGER NOT NULL DEFAULT 0,
                session_id TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '', title TEXT NOT NULL DEFAULT ''
            );
        `);
        ready = d;
    }
    return d;
}

const clip = (s, n) => { const t = String(s == null ? '' : s); return t.length > n ? `${t.slice(0, n - 1)}…` : t; };
const firstLine = (s) => String(s || '').split('\n').find((l) => l.trim()) || '';

function targetOf(name, inp) {
    const i = inp && typeof inp === 'object' ? inp : {};
    if (name === 'Bash') return clip(firstLine(i.command), 300);
    const p = i.file_path || i.notebook_path || i.path || i.pattern || i.url || i.query || i.skill || i.subject || i.description || '';
    if (typeof p === 'string' && p) return clip(p, 300);
    const first = Object.values(i).find((v) => typeof v === 'string' && v);
    return first ? clip(firstLine(first), 300) : '';
}

/** A tool_use block as an index row (masked, one line). */
function rowOf(c) {
    const inp = c.input && typeof c.input === 'object' ? c.input : {};
    const name = String(c.name || 'tool');
    const target = targetOf(name, inp);
    const description = clip(typeof inp.description === 'string' ? inp.description : '', 300);
    let kind = 'tool';
    let summary;
    if (name === 'Bash') { kind = 'shell'; summary = description || target; }
    else if (EDIT_TOOLS.has(name)) { kind = 'edit'; summary = `${name === 'Write' ? 'Wrote' : name === 'NotebookEdit' ? 'Edited notebook' : 'Edited'} ${path.basename(target) || 'a file'}`; }
    else summary = target ? `${name} ${target}` : name;
    return { name, kind, summary: mask(clip(firstLine(summary), 300)), target: mask(target), description: mask(description), toolUseId: String(c.id || '') };
}

function resultSize(content) {
    if (typeof content === 'string') return content.length;
    if (!Array.isArray(content)) return 0;
    return content.reduce((n, b) => n + (b && typeof b.text === 'string' ? b.text.length : b && b.type === 'image' ? 1000 : 0), 0);
}

function scanFile(file, sessionId, agentId, opts = {}) {
    const d = db();
    const key = agentId ? `${sessionId}/${path.basename(file)}` : sessionId;
    let st;
    try { st = fs.statSync(file); } catch (_) { return { rows: 0, done: true, bytes: 0 }; }
    let row = d.prepare('SELECT * FROM activity_scans WHERE file_key = ?').get(key);
    if (row && row.file !== file) row = null;
    let offset = row ? row.offset : 0;
    if (offset > st.size) { d.prepare('DELETE FROM activity WHERE file_key = ?').run(key); offset = 0; } // rewritten
    if (offset === st.size) return { rows: 0, done: true, bytes: 0 };
    const len = Math.min(st.size - offset, Math.max(64 * 1024, Number(opts.cap) || CAP));
    const buf = Buffer.alloc(len);
    const fd = fs.openSync(file, 'r');
    try { fs.readSync(fd, buf, 0, len, offset); } finally { fs.closeSync(fd); }
    let lastNl = buf.lastIndexOf(10);
    if (lastNl < 0) {
        if (len < CAP && offset + len >= st.size) return { rows: 0, done: true, bytes: 0 }; // half a line: next time
        lastNl = len - 1; // a line longer than the cap: skip it
    }
    const minTs = Date.now() - KEEP_MS;
    let cwd = row ? row.cwd : '';
    let title = row ? row.title : '';
    const insert = d.prepare(`INSERT INTO activity (session_id, agent_id, file_key, at_offset, part, ts, tool, kind, summary, target, description, tool_use_id)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`);
    const setResult = d.prepare('UPDATE activity SET result_offset = ?, result_error = ?, result_size = ? WHERE file_key = ? AND tool_use_id = ? AND result_offset IS NULL');
    let rows = 0;
    d.transaction(() => {
        let s = 0;
        while (s <= lastNl) {
            let e = buf.indexOf(10, s);
            if (e < 0 || e > lastNl) e = lastNl;
            const at = offset + s;
            const next = e + 1;
            const slice = buf.subarray(s, e);
            s = next;
            if (slice.length < 8) continue;
            const hasUse = slice.includes('"tool_use"');
            const hasRes = slice.includes('"tool_result"');
            const hasTitle = !agentId && (slice.includes('"custom-title"') || slice.includes('"ai-title"'));
            if (!cwd && !agentId && slice.length < 4000) { const cm = /"cwd":"((?:[^"\\]|\\.)*)"/.exec(slice.toString('utf8')); if (cm) { try { cwd = JSON.parse(`"${cm[1]}"`); } catch (_) { /* none */ } } }
            if (!hasUse && !hasRes && !hasTitle) continue;
            let o;
            try { o = JSON.parse(slice.toString('utf8')); } catch (_) { continue; }
            if (!o || typeof o !== 'object') continue;
            if (hasTitle && (o.type === 'custom-title' || o.type === 'ai-title')) {
                const t = o.type === 'custom-title' ? o.customTitle : (o.aiTitle || o.title);
                if (t && (o.type === 'custom-title' || !title.startsWith('\u0001'))) title = (o.type === 'custom-title' ? '\u0001' : '') + clip(String(t), 200);
                continue;
            }
            const content = o.message && o.message.content;
            if (!Array.isArray(content)) continue;
            const ts = Date.parse(o.timestamp || '') || st.mtimeMs;
            if (o.type === 'assistant') {
                if (ts < minTs) continue;
                content.forEach((c, part) => {
                    if (!c || c.type !== 'tool_use') return;
                    const r = rowOf(c);
                    insert.run(sessionId, agentId || '', key, at, part, ts, r.name, r.kind, r.summary, r.target, r.description, r.toolUseId);
                    rows += 1;
                });
            } else if (o.type === 'user') {
                content.forEach((c) => {
                    if (!c || c.type !== 'tool_result' || !c.tool_use_id) return;
                    setResult.run(at, c.is_error === true ? 1 : 0, resultSize(c.content), key, String(c.tool_use_id));
                });
            }
        }
        d.prepare(`INSERT INTO activity_scans (file_key, file, offset, session_id, cwd, title) VALUES (?, ?, ?, ?, ?, ?)
            ON CONFLICT(file_key) DO UPDATE SET file = excluded.file, offset = excluded.offset, session_id = excluded.session_id, cwd = excluded.cwd, title = excluded.title`)
            .run(key, file, offset + lastNl + 1, sessionId, cwd, title);
    })();
    return { rows, done: offset + lastNl + 1 >= st.size, bytes: lastNl + 1 };
}

/** Transcripts touched in the last 14 days, newest first: { file, sessionId, agentId, mtimeMs, size }. */
function recentFiles() {
    const out = [];
    const since = Date.now() - RECENT_MS;
    let dirs = [];
    try { dirs = fs.readdirSync(projectsDir(), { withFileTypes: true }).filter((x) => x.isDirectory()); } catch (_) { return out; }
    for (const dir of dirs) {
        const base = path.join(projectsDir(), dir.name);
        let names = [];
        try { names = fs.readdirSync(base, { withFileTypes: true }); } catch (_) { continue; }
        for (const n of names) {
            if (n.isFile() && n.name.endsWith('.jsonl')) {
                const id = n.name.slice(0, -6);
                if (!SESSION_ID_RE.test(id)) continue;
                try { const st = fs.statSync(path.join(base, n.name)); if (st.mtimeMs >= since) out.push({ file: path.join(base, n.name), sessionId: id, agentId: '', mtimeMs: st.mtimeMs, size: st.size }); } catch (_) { /* gone */ }
            } else if (n.isDirectory() && SESSION_ID_RE.test(n.name)) {
                const sub = path.join(base, n.name, 'subagents');
                let st0;
                try { st0 = fs.statSync(sub); } catch (_) { continue; }
                if (st0.mtimeMs < since) continue;
                let subs = [];
                try { subs = fs.readdirSync(sub); } catch (_) { continue; }
                subs.filter((f) => f.endsWith('.jsonl')).forEach((f) => {
                    try { const st = fs.statSync(path.join(sub, f)); if (st.mtimeMs >= since) out.push({ file: path.join(sub, f), sessionId: n.name, agentId: f.replace(/^agent-/, '').replace(/\.jsonl$/, ''), mtimeMs: st.mtimeMs, size: st.size }); } catch (_) { /* gone */ }
                });
            }
        }
    }
    return out.sort((a, b) => b.mtimeMs - a.mtimeMs);
}

let running = null;
const yieldLoop = () => new Promise((r) => setImmediate(r));

/** Scans what is new within budgetMs (default 3000); the next call resumes. { rows, files, done, ms } */
function refresh(opts = {}) {
    if (running) return running;
    running = (async () => {
        const t0 = Date.now();
        const budget = Math.max(100, Number(opts.budgetMs) || 3000);
        const d = db();
        d.prepare('DELETE FROM activity WHERE ts < ?').run(Date.now() - KEEP_MS);
        const scanned = new Map(d.prepare('SELECT file_key, file, offset FROM activity_scans').all().map((r) => [r.file_key, r]));
        let rows = 0;
        let files = 0;
        let done = true;
        for (const f of recentFiles()) {
            const key = f.agentId ? `${f.sessionId}/${path.basename(f.file)}` : f.sessionId;
            const prev = scanned.get(key);
            if (prev && prev.file === f.file && prev.offset === f.size) continue;
            for (;;) {
                if (Date.now() - t0 >= budget) { done = false; break; }
                let r;
                try { r = scanFile(f.file, f.sessionId, f.agentId, { cap: STEP }); } catch (e) { process.stderr.write(`activityIndex: scan ${key}: ${e.message}\n`); break; }
                rows += r.rows;
                files += 1;
                await yieldLoop();
                if (r.done || !r.bytes) break;
            }
            if (!done) break;
        }
        return { rows, files, done, ms: Date.now() - t0 };
    })().finally(() => { running = null; });
    return running;
}

// ---------------------------------------------------------------- query

let metaCache = { at: 0, sessions: new Map() };
function sessionMeta(sessionId) {
    const nowMs = Date.now();
    if (nowMs - metaCache.at > 30000) {
        const sessions = new Map();
        try {
            db().prepare('SELECT session_id, account FROM agents WHERE session_id IS NOT NULL AND account IS NOT NULL ORDER BY seen_at').all()
                .forEach((a) => sessions.set(a.session_id, { account: a.account }));
        } catch (_) { /* no table yet */ }
        try {
            require('../claudeSessions').liveSessions().forEach((s) => {
                const prev = sessions.get(s.id) || {};
                sessions.set(s.id, Object.assign(prev, { givenName: s.givenName || '', link: s.link || '', cwd: s.cwd || '' }));
            });
        } catch (_) { /* no live info */ }
        metaCache = { at: nowMs, sessions };
    }
    const m = metaCache.sessions.get(sessionId) || {};
    const sc = db().prepare('SELECT cwd, title FROM activity_scans WHERE file_key = ?').get(sessionId) || {};
    const scTitle = String(sc.title || '').replace(/^\u0001/, '');
    return { title: m.givenName || scTitle || sessionId.slice(0, 8), account: m.account || '', cwd: m.cwd || sc.cwd || '', link: m.link || '' };
}

const agentDescCache = new Map();
function agentDescription(sessionId, agentId) {
    if (!agentId) return '';
    const k = `${sessionId}/${agentId}`;
    if (agentDescCache.has(k)) return agentDescCache.get(k);
    let desc = '';
    const sc = db().prepare('SELECT file FROM activity_scans WHERE file_key = ?').get(`${sessionId}/agent-${agentId}.jsonl`);
    if (sc) {
        try { desc = clip(String(JSON.parse(fs.readFileSync(sc.file.replace(/\.jsonl$/, '.meta.json'), 'utf8')).description || ''), 200); } catch (_) { desc = ''; }
    }
    if (agentDescCache.size > 500) agentDescCache.clear();
    agentDescCache.set(k, desc);
    return desc;
}

const KINDS = new Set(['shell', 'edit', 'tool']);
const likeEsc = (s) => String(s).replace(/[\\%_]/g, (m) => `\\${m}`);

function whereOf(opts) {
    const w = [];
    const p = [];
    if (opts.kind && KINDS.has(opts.kind)) { w.push('kind = ?'); p.push(opts.kind); }
    if (opts.sessionId && SESSION_ID_RE.test(String(opts.sessionId))) { w.push('session_id = ?'); p.push(String(opts.sessionId)); }
    const q = String(opts.q || '').trim().slice(0, 200);
    if (q) {
        const l = `%${likeEsc(q)}%`;
        w.push("(summary LIKE ? ESCAPE '\\' OR target LIKE ? ESCAPE '\\' OR description LIKE ? ESCAPE '\\')");
        p.push(l, l, l);
    }
    return { w, p };
}

function query(opts = {}) {
    const d = db();
    const limit = Math.max(1, Math.min(200, Number(opts.limit) || 50));
    const { w, p } = whereOf(opts);
    const before = Number(opts.before);
    // ts and id are not the same order (a transcript scanned later holds older calls): the cursor is the last
    // row's id and the next page is what is ordered after that row by (ts, id)
    const wc = w.slice();
    const pc = p.slice();
    if (Number.isFinite(before) && before > 0) {
        const ref = d.prepare('SELECT ts, id FROM activity WHERE id = ?').get(before);
        if (ref) { wc.push('(ts < ? OR (ts = ? AND id < ?))'); pc.push(ref.ts, ref.ts, ref.id); }
    }
    const list = d.prepare(`SELECT * FROM activity ${wc.length ? `WHERE ${wc.join(' AND ')}` : ''} ORDER BY ts DESC, id DESC LIMIT ?`).all(...pc, limit + 1);
    const more = list.length > limit;
    if (more) list.pop();
    const total = d.prepare(`SELECT COUNT(*) n FROM activity ${w.length ? `WHERE ${w.join(' AND ')}` : ''}`).get(...p).n;
    const out = list.map((r) => {
        const meta = sessionMeta(r.session_id);
        return {
            id: r.id, ts: new Date(r.ts).toISOString(), kind: r.kind, tool: r.tool, summary: r.summary, target: r.target, description: r.description,
            sessionId: r.session_id, sessionTitle: meta.title, account: meta.account, agentId: r.agent_id, agentDescription: agentDescription(r.session_id, r.agent_id),
            error: !!r.result_error, resultSize: r.result_size
        };
    });
    return { rows: out, next: more && out.length ? out[out.length - 1].id : null, total };
}

// ---------------------------------------------------------------- detail

function readLineAt(file, pos) {
    const st = fs.statSync(file);
    if (pos >= st.size) return null;
    const fd = fs.openSync(file, 'r');
    try {
        let len = 256 * 1024;
        for (;;) {
            const buf = Buffer.alloc(Math.min(len, st.size - pos));
            fs.readSync(fd, buf, 0, buf.length, pos);
            const nl = buf.indexOf(10);
            if (nl >= 0 || pos + buf.length >= st.size) return buf.subarray(0, nl >= 0 ? nl : buf.length).toString('utf8');
            if (len > 64 * 1024 * 1024) return null;
            len *= 4;
        }
    } finally { fs.closeSync(fd); }
}

function capInput(v, depth = 0) {
    if (typeof v === 'string') return v.length > INPUT_CAP ? `${v.slice(0, INPUT_CAP)}\n… (${v.length - INPUT_CAP} more characters)` : v;
    if (Array.isArray(v)) return depth > 6 ? [] : v.slice(0, 200).map((x) => capInput(x, depth + 1));
    if (v && typeof v === 'object') {
        if (depth > 6) return {};
        const o = {};
        Object.keys(v).slice(0, 100).forEach((k) => { o[k] = capInput(v[k], depth + 1); });
        return o;
    }
    return v;
}

function textOf(content) {
    if (typeof content === 'string') return content;
    if (!Array.isArray(content)) return '';
    return content.map((b) => (b && b.type === 'text' ? b.text || '' : b && b.type === 'image' ? '[picture]' : '')).filter(Boolean).join('\n');
}

const NOISE_RE = /^\s*<(command-|local-command|system-reminder|user-prompt-submit-hook|bash-|task-notification)/i;
function userText(o) {
    if (!o || o.type !== 'user' || o.isMeta || !o.message) return '';
    const c = o.message.content;
    if (Array.isArray(c) && c.some((b) => b && b.type === 'tool_result')) return '';
    const t = textOf(c).trim();
    return t && !NOISE_RE.test(t) ? t : '';
}

/** The user text and the assistant text that lead to the call at byte `at` (reads a window before it). */
function whyOf(file, at, toolUseId) {
    const from = Math.max(0, at - 2 * 1024 * 1024);
    const st = fs.statSync(file);
    const fd = fs.openSync(file, 'r');
    let text;
    try {
        const len = Math.min(st.size - from, at - from);
        const buf = Buffer.alloc(len);
        fs.readSync(fd, buf, 0, len, from);
        text = buf.toString('utf8');
    } finally { fs.closeSync(fd); }
    let lines = text.split('\n');
    if (from > 0) lines = lines.slice(1); // the first line may be cut
    let request = '';
    let assistantText = '';
    // the call's own message first: text blocks before the tool_use
    const own = readLineAt(file, at);
    try {
        const o = JSON.parse(own);
        const c = (o.message && o.message.content) || [];
        const idx = c.findIndex((b) => b && b.type === 'tool_use' && b.id === toolUseId);
        const before = c.slice(0, idx < 0 ? c.length : idx).filter((b) => b && b.type === 'text' && b.text && b.text.trim());
        if (before.length) assistantText = before[before.length - 1].text;
    } catch (_) { /* unreadable */ }
    for (let i = lines.length - 1; i >= 0 && !request; i -= 1) {
        const l = lines[i];
        if (!l || l.length < 8) continue;
        if (l.length > 400000 && !l.includes('"type":"user"')) continue;
        let o;
        try { o = JSON.parse(l); } catch (_) { continue; }
        const u = userText(o);
        if (u) { request = u; break; }
        if (!assistantText && o.type === 'assistant' && o.message && Array.isArray(o.message.content)) {
            const t = o.message.content.filter((b) => b && b.type === 'text' && b.text && b.text.trim()).map((b) => b.text);
            if (t.length) assistantText = t[t.length - 1];
        }
    }
    return { request: clip(mask(request), WHY_CAP), assistantText: clip(mask(assistantText), WHY_CAP) };
}

function detail(id) {
    const d = db();
    const r = d.prepare('SELECT * FROM activity WHERE id = ?').get(Number(id));
    if (!r) throw new Error('No such activity');
    const sc = d.prepare('SELECT file FROM activity_scans WHERE file_key = ?').get(r.file_key);
    if (!sc) throw new Error('The transcript is gone');
    const meta = sessionMeta(r.session_id);
    const row = {
        id: r.id, ts: new Date(r.ts).toISOString(), kind: r.kind, tool: r.tool, summary: r.summary, target: r.target, description: r.description,
        sessionId: r.session_id, sessionTitle: meta.title, account: meta.account, agentId: r.agent_id, agentDescription: agentDescription(r.session_id, r.agent_id),
        error: !!r.result_error, resultSize: r.result_size
    };
    let input = null;
    try {
        const o = JSON.parse(readLineAt(sc.file, r.at_offset));
        const b = (o.message.content || []).find((x) => x && x.type === 'tool_use' && x.id === r.tool_use_id) || o.message.content[r.part];
        input = b ? JSON.parse(mask(JSON.stringify(capInput(b.input)))) : null;
    } catch (_) { input = null; }
    let output = null;
    if (r.result_offset != null) {
        try {
            const o = JSON.parse(readLineAt(sc.file, r.result_offset));
            const b = (o.message.content || []).find((x) => x && x.type === 'tool_result' && x.tool_use_id === r.tool_use_id);
            if (b) { const t = mask(textOf(b.content)); output = t.length > OUTPUT_CAP ? `${t.slice(0, OUTPUT_CAP)}\n… (${t.length - OUTPUT_CAP} more characters)` : t; }
        } catch (_) { output = null; }
    }
    let why = { request: '', assistantText: '' };
    try { why = whyOf(sc.file, r.at_offset, r.tool_use_id); } catch (_) { /* none */ }
    return { row, input, output, why, session: { id: r.session_id, title: meta.title, account: meta.account, cwd: meta.cwd, link: meta.link } };
}

// ---------------------------------------------------------------- which files a shell command really writes
//
// Nov 25 2026: collision holds were made from guessed shell "edits" (origin/main..HEAD, Mozilla/5.0, st.js). A file counts as
// written by a command only when the command clearly writes that exact path: sed -i / perl -i, a > or >> redirect, tee, mv / cp
// onto it, git checkout -- / restore of it, apply_patch headers, python / node writing a literal path. Read-only commands (cat,
// grep, git diff / log / add / commit, node --check, curl args, URLs, user-agent strings, a..b ranges) never count.

/** A shell-ish tokenizer: [{ words: [string], writes: [string] }] one entry per simple command (redirect targets in writes). */
function shellSegments(cmd) {
    const src = String(cmd || '');
    const segs = [];
    let words = [];
    let writes = [];
    let cur = '';
    let has = false;
    let pendingRedirect = false;
    const endWord = () => {
        if (!has) return;
        if (pendingRedirect) { writes.push(cur); pendingRedirect = false; } else words.push(cur);
        cur = ''; has = false;
    };
    const endSeg = () => { endWord(); pendingRedirect = false; if (words.length || writes.length) segs.push({ words, writes }); words = []; writes = []; };
    for (let i = 0; i < src.length; i += 1) {
        const ch = src[i];
        if (ch === "'") { const j = src.indexOf("'", i + 1); const e = j < 0 ? src.length : j; cur += src.slice(i + 1, e); has = true; i = e; continue; }
        if (ch === '"') {
            let j = i + 1;
            for (; j < src.length && src[j] !== '"'; j += 1) { if (src[j] === '\\' && j + 1 < src.length) { j += 1; cur += src[j]; } else cur += src[j]; }
            has = true; i = j; continue;
        }
        if (ch === '\\' && i + 1 < src.length) { cur += src[i + 1]; has = true; i += 1; continue; }
        if (ch === '$' && src[i + 1] === '(') {
            let depth = 0; let j = i + 1;
            for (; j < src.length; j += 1) { if (src[j] === '(') depth += 1; else if (src[j] === ')') { depth -= 1; if (!depth) break; } }
            cur += src.slice(i, j + 1); has = true; i = j; continue;
        }
        if (ch === '`') { const j = src.indexOf('`', i + 1); const e = j < 0 ? src.length : j; cur += src.slice(i, e + 1); has = true; i = e; continue; }
        if (ch === '\n' || ch === ';' || ch === '|' || (ch === '&' && src[i + 1] === '&')) { endSeg(); if ((ch === '|' || ch === '&') && src[i + 1] === ch) i += 1; continue; }
        if (ch === '&' && src[i + 1] === '>') { endWord(); pendingRedirect = true; i += src[i + 2] === '>' ? 2 : 1; continue; }
        if (ch === '&') { endSeg(); continue; }
        if (ch === ' ' || ch === '\t') { endWord(); continue; }
        if (ch === '<') { endWord(); if (src[i + 1] === '<') i += src[i + 2] === '<' ? 2 : 1; pendingRedirect = false; /* the next word is an input / heredoc tag */ words.push('\u0000in'); continue; }
        if (ch === '>') {
            // "2>file" and "1>file": the digits just read are the fd, not a word
            if (has && /^\d+$/.test(cur)) { cur = ''; has = false; } else endWord();
            if (src[i + 1] === '&') { // >&2 / 2>&1: not a file
                let j = i + 2; while (j < src.length && /[\w-]/.test(src[j])) j += 1; i = j - 1; continue;
            }
            if (src[i + 1] === '>') i += 1;
            pendingRedirect = true; continue;
        }
        cur += ch; has = true;
    }
    endSeg();
    // drop the word after "<" / "<<" (its input file or heredoc tag)
    segs.forEach((sg) => { const out = []; for (let k = 0; k < sg.words.length; k += 1) { if (sg.words[k] === '\u0000in') { k += 1; continue; } out.push(sg.words[k]); } sg.words = out; });
    return segs;
}

function stripHeredocs(cmd) {
    return String(cmd || '').replace(/<<-?\s*(['"]?)([A-Za-z_][\w]*)\1([^\n]*)\n[\s\S]*?(?:\n[ \t]*\2[ \t]*(?=\n|$)|$)/g, (m, q, tag, rest) => `<<${tag}${rest}`);
}

function cleanWritePath(p) {
    let v = String(p || '').trim();
    if (!v || v.length > 300 || v.startsWith('-') || /[\s*?$`{}()<>|;&\0]/.test(v) || /^[a-z][a-z0-9+.-]*:\/\//i.test(v)) return '';
    v = v.replace(/^\.\//, '');
    if (!v || v === '.' || v === '..' || v.endsWith('/') || /(^|\/)\.\.(\/|$)/.test(v) && v.startsWith('..')) return '';
    if (/^(?:\/tmp|\/var\/tmp|\/dev|\/proc|\/sys)(?:\/|$)/.test(v) || /(^|\/)node_modules\//.test(v)) return '';
    if (!/[\w]/.test(v) || /\.\.\.?$/.test(v) || /\.\.\w/.test(v) && !/\.\.\//.test(v) && v.includes('..')) return '';
    return v;
}

const SHELL_HEADS = new Set(['bash', 'sh', 'zsh', 'dash']);
const WRAPPERS = new Set(['sudo', 'env', 'time', 'nice', 'nohup', 'command', 'builtin', 'exec', 'stdbuf']);

/** The paths a shell command clearly writes (repo-relative where it was relative, else as given). */
function shellWritePaths(cmd, depth = 0) {
    const full = String(cmd || '');
    const out = new Set();
    const add = (p) => { const v = cleanWritePath(p); if (v) out.add(v); };
    // apply_patch headers
    full.replace(/^\*\*\* (?:Update|Add|Delete) File:\s*(.+)$/gm, (m, p) => { add(p.trim()); return m; });
    const flat = stripHeredocs(full);
    shellSegments(flat).forEach((sg) => {
        sg.writes.forEach(add);
        let w = sg.words.slice();
        // leading VAR=value, wrappers
        while (w.length && (/^[A-Za-z_][A-Za-z0-9_]*=/.test(w[0]) || WRAPPERS.has(path.basename(w[0])))) w.shift();
        if (!w.length) return;
        const head = path.basename(w[0]);
        const args = w.slice(1);
        const opts = (a) => a.filter((x) => x.startsWith('-'));
        const rest = (a) => a.filter((x) => !x.startsWith('-'));
        if (SHELL_HEADS.has(head)) {
            const ci = args.findIndex((x) => /^-[a-z]*c$/.test(x));
            if (ci >= 0 && args[ci + 1] && depth < 2) shellWritePaths(args[ci + 1], depth + 1).forEach((p) => out.add(p));
            return;
        }
        if (head === 'sed') {
            if (!args.some((x) => /^-[A-Za-z]*i/.test(x) || x === '--in-place' || x.startsWith('--in-place='))) return;
            const hasScriptOpt = args.some((x) => x === '-e' || x === '-f' || /^-[A-Za-z]*[ef]$/.test(x) || x.startsWith('--expression') || x.startsWith('--file'));
            // values of -e / -f are scripts, not files
            const files = []; let skip = false; let first = !hasScriptOpt;
            for (const x of args) {
                if (skip) { skip = false; continue; }
                if (x === '-e' || x === '-f' || x === '--expression' || x === '--file') { skip = true; continue; }
                if (x.startsWith('-')) continue;
                if (first) { first = false; continue; }
                files.push(x);
            }
            files.forEach(add); return;
        }
        if (head === 'perl') {
            if (!args.some((x) => /^-[A-Za-z]*i/.test(x))) return;
            const files = []; let skip = false;
            for (const x of args) { if (skip) { skip = false; continue; } if (/^-[A-Za-z]*[eE]$/.test(x)) { skip = true; continue; } if (x.startsWith('-')) continue; files.push(x); }
            files.forEach(add); return;
        }
        if (head === 'tee') { rest(args).forEach(add); return; }
        if (head === 'mv' || head === 'cp' || head === 'install') {
            const t = args.findIndex((x) => x === '-t' || x === '--target-directory');
            if (t >= 0) return; // a folder: the files it receives are unknown here
            const r = rest(args); if (r.length >= 2) add(r[r.length - 1]); return;
        }
        if (head === 'git') {
            let a = args.slice();
            while (a.length && (a[0] === '-C' || a[0] === '-c')) a = a.slice(2);
            const sub = a[0]; a = a.slice(1);
            if (sub === 'checkout') { const i = a.indexOf('--'); if (i >= 0) a.slice(i + 1).forEach(add); return; }
            if (sub === 'restore') {
                let skipNext = false;
                for (const x of a) { if (skipNext) { skipNext = false; continue; } if (x === '-s' || x === '--source') { skipNext = true; continue; } if (x === '--') continue; if (x.startsWith('-')) continue; add(x); }
            }
            return;
        }
        if (/^python[0-9.]*$|^node$|^nodejs$|^ruby$|^php$/.test(head)) {
            if (args.includes('--check') || args.includes('-c') && /^node/.test(head)) { /* syntax check only */ return; }
            const re = [/open\(\s*['"]([^'"]+)['"]\s*,\s*['"][wa]\+?b?['"]/g, /\b(?:writeFileSync|appendFileSync|writeFile|appendFile)\(\s*['"]([^'"]+)['"]/g, /Path\(\s*['"]([^'"]+)['"]\s*\)\.write_(?:text|bytes)\(/g];
            re.forEach((r) => { let m; while ((m = r.exec(full))) add(m[1]); });
            // the usual heredoc edit: p = 'modules/x.js'; s = open(p).read(); ...; open(p, 'w').write(s) - a write through a
            // variable counts the repo-file paths the script assigns to variables
            if (/open\(\s*[A-Za-z_]\w*\s*,\s*['"][wa]\+?b?['"]|\b(?:writeFileSync|appendFileSync|writeFile|appendFile)\(\s*[A-Za-z_]\w*\s*[,)]|\b[A-Za-z_]\w*\.write_(?:text|bytes)\(/.test(full)) {
                const av = /\b[A-Za-z_]\w*\s*=\s*(?:Path\()?['"]([^'"\s]+\/[^'"\s]+\.[A-Za-z0-9]{1,8})['"]/g;
                let m; while ((m = av.exec(full))) add(m[1]);
            }
        }
    });
    return [...out].slice(0, 40);
}

/**
 * The files a session really wrote with shell commands since `sinceMs`: Map path -> { first, last } (ms), from the activity index
 * (the session's transcript is scanned from where it stopped first, a small step). A command's first line is what the index keeps.
 */
function sessionShellWrites(sessionId, sinceMs = 0) {
    const out = new Map();
    if (!SESSION_ID_RE.test(String(sessionId || ''))) return out;
    try {
        const d = db();
        let sc = d.prepare('SELECT file FROM activity_scans WHERE file_key = ?').get(sessionId);
        let file = sc && sc.file;
        if (!file) {
            try { for (const dir of fs.readdirSync(projectsDir())) { const f = path.join(projectsDir(), dir, `${sessionId}.jsonl`); if (fs.existsSync(f)) { file = f; break; } } } catch (_) { file = ''; }
        }
        if (file) { try { scanFile(file, sessionId, '', { cap: STEP }); } catch (_) { /* the stored rows stand */ } }
        d.prepare("SELECT ts, target FROM activity WHERE session_id = ? AND kind = 'shell' AND ts >= ? ORDER BY ts").all(sessionId, Math.max(0, Number(sinceMs) || 0)).forEach((r) => {
            shellWritePaths(r.target).forEach((p) => { const e = out.get(p); if (e) e.last = r.ts; else out.set(p, { first: r.ts, last: r.ts }); });
        });
    } catch (_) { /* no index */ }
    return out;
}

module.exports = { scanFile, refresh, query, detail, recentFiles, shellWritePaths, sessionShellWrites, _db: db };
