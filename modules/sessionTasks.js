'use strict';

/**
 * Task lists and titles of Claude Code sessions (Fleet's session view; Yukimi, Nov 24 2026: "a task list with check marks,
 * one for the user and one for you, as I keep adding steering messages", "session titles should be dynamically updated").
 *
 *   user list    the concrete asks of every new human message / steering message in the transcript (not [Supervisor]
 *                notes, not tool results). The Supervisor's engine (askJson) turns a batch of new messages into items, one
 *                call per batch; without an engine the message's first line is the item. Ticked by the agent (task_done),
 *                by a Supervisor review that names the item, or by Yukimi.
 *   agent list   the session's own working list: Claude Code's TodoWrite / TaskCreate / TaskUpdate calls mirrored from the
 *                transcript, plus what the agent adds with agent-coord task_add.
 *   titles       a short title the Supervisor writes from the recent asks when the first message arrives and after every 5
 *                more human messages (unless the session has a custom title); a Fleet-side name (custom) beats everything.
 *
 * Store: agent-coord's coord.db (session_tasks, session_task_state, session_titles). Incremental: one byte offset per
 * session; a sync reads only what was appended. Nothing polls: Supervisor scans, the open transcript watch and the agent
 * tools poke a session; every change is announced to onChange listeners (Fleet pushes it to the watching window).
 */

const fs = require('fs');

const SESSION_ID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
const STEER_PREFIX = '[Supervisor]';
const READ_MAX = 1024 * 1024;       // bytes read per pass; a first look reads only the last of them
const MAX_PASSES = 6;
const FIRST_ASKS = 3;               // a session seen for the first time: the asks of its last 3 human messages
const BATCH_ASKS = 8;
const TITLE_EVERY = 5;
const TITLE_MAX = 60;
const POKE_MS = 2500;
const TOOLS = new Set(['TodoWrite', 'TaskCreate', 'TaskUpdate']);

const deps = { askJson: null, findFile: null, enabled: () => true, customTitle: () => false };
/** { askJson(system, user, kind, opts), findFile(sessionId), enabled(), customTitle(sessionId) }: set by the Supervisor. */
function configure(o) { Object.assign(deps, o || {}); }

const listeners = new Set();
function onChange(fn) { listeners.add(fn); return () => listeners.delete(fn); }
function emit(sessionId) { listeners.forEach((fn) => { try { fn(sessionId); } catch (_) { /* a listener */ } }); }

// ---------------------------------------------------------------- store

let titleCache = null; // session id -> { title, custom, hum }

function db() {
    const d = require('./agentCoord/store').open();
    if (db.ready !== d) {
        d.exec(`
            CREATE TABLE IF NOT EXISTS session_tasks (
                id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, owner TEXT NOT NULL, text TEXT NOT NULL,
                done INTEGER NOT NULL DEFAULT 0, done_by TEXT NOT NULL DEFAULT '', evidence TEXT NOT NULL DEFAULT '',
                source_at INTEGER, ext TEXT NOT NULL DEFAULT '', created_at INTEGER NOT NULL, updated_at INTEGER NOT NULL,
                removed INTEGER NOT NULL DEFAULT 0
            );
            CREATE INDEX IF NOT EXISTS session_tasks_session ON session_tasks (session_id, removed);
            CREATE TABLE IF NOT EXISTS session_task_state (
                session_id TEXT PRIMARY KEY, file TEXT, offset INTEGER NOT NULL DEFAULT 0, hum INTEGER NOT NULL DEFAULT 0,
                task_seq INTEGER NOT NULL DEFAULT 0, recent TEXT NOT NULL DEFAULT '[]', updated_at INTEGER
            );
            CREATE TABLE IF NOT EXISTS session_titles (
                session_id TEXT PRIMARY KEY, title TEXT NOT NULL, custom INTEGER NOT NULL DEFAULT 0, hum INTEGER NOT NULL DEFAULT 0, at INTEGER NOT NULL
            );
        `);
        db.ready = d;
        titleCache = null;
    }
    return d;
}

const rowOf = (r) => (r ? {
    id: r.id, sessionId: r.session_id, owner: r.owner, text: r.text, done: !!r.done, doneBy: r.done_by || '', evidence: r.evidence || '',
    sourceAt: r.source_at == null ? null : r.source_at, createdAt: r.created_at, updatedAt: r.updated_at
} : null);
const clean = (t, n) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, n);
const get = (id) => rowOf(db().prepare('SELECT * FROM session_tasks WHERE id = ? AND removed = 0').get(Number(id)));

/** { asks, tasks, counts, title }: both lists of a session, oldest first. */
function list(sessionId) {
    const all = db().prepare('SELECT * FROM session_tasks WHERE session_id = ? AND removed = 0 ORDER BY id').all(String(sessionId)).map(rowOf);
    const asks = all.filter((x) => x.owner === 'user');
    const tasks = all.filter((x) => x.owner === 'agent');
    const n = (a) => a.filter((x) => x.done).length;
    return { sessionId, asks, tasks, counts: { asksDone: n(asks), asksTotal: asks.length, tasksDone: n(tasks), tasksTotal: tasks.length }, title: titleFor(sessionId) };
}

function insert(sessionId, owner, text, o = {}) {
    const t = clean(text, 300);
    if (!t) return null;
    const now = Date.now();
    const r = db().prepare('INSERT INTO session_tasks (session_id, owner, text, done, done_by, evidence, source_at, ext, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(sessionId, owner, t, o.done ? 1 : 0, o.done ? (o.by || '') : '', clean(o.evidence, 600), o.sourceAt == null ? null : o.sourceAt, o.ext || '', now, now);
    return get(r.lastInsertRowid);
}

function add(sessionId, owner, text, o = {}) {
    if (!SESSION_ID_RE.test(String(sessionId || ''))) throw new Error('A session id');
    if (owner !== 'user' && owner !== 'agent') throw new Error('owner is user or agent');
    const row = insert(sessionId, owner, text, o);
    if (!row) throw new Error('The item needs text');
    emit(sessionId);
    return row;
}

/** Ticks or unticks, edits the text. by: user | agent | supervisor. */
function update(id, patch, by) {
    const cur = get(id);
    if (!cur) throw new Error(`No task ${id}`);
    const p = patch || {};
    const sets = [];
    const vals = [];
    if (p.text !== undefined) { const t = clean(p.text, 300); if (!t) throw new Error('The item needs text'); sets.push('text = ?'); vals.push(t); }
    if (p.done !== undefined) {
        sets.push('done = ?', 'done_by = ?'); vals.push(p.done ? 1 : 0, p.done ? String(by || 'user') : '');
        if (!p.done && p.evidence === undefined) { sets.push('evidence = ?'); vals.push(''); }
    }
    if (p.evidence !== undefined) { sets.push('evidence = ?'); vals.push(clean(p.evidence, 600)); }
    if (!sets.length) return cur;
    sets.push('updated_at = ?'); vals.push(Date.now());
    db().prepare(`UPDATE session_tasks SET ${sets.join(', ')} WHERE id = ?`).run(...vals, cur.id);
    emit(cur.sessionId);
    return get(cur.id);
}

function remove(id) {
    const cur = get(id);
    if (!cur) return null;
    db().prepare('UPDATE session_tasks SET removed = 1, updated_at = ? WHERE id = ?').run(Date.now(), cur.id);
    emit(cur.sessionId);
    return cur;
}

// ---------------------------------------------------------------- the tools of an agent (agent-coord task_*)

/** One op from the agent-coord MCP (over the Supervisor's socket): { op: task_list | task_add | task_done | task_update, sessionId, ... }. */
function agentOp(req) {
    const sid = String(req.sessionId || '');
    if (!SESSION_ID_RE.test(sid)) throw new Error('The task tools need a Claude Code session (this agent has no session id)');
    const brief = (x) => ({ id: x.id, text: x.text, done: x.done, evidence: x.evidence || undefined });
    const mine = (id) => { const r = get(id); if (!r || r.sessionId !== sid) throw new Error(`No task ${id} in your session (task_list shows them)`); return r; };
    if (req.op === 'task_list') { const l = list(sid); return { asks: l.asks.map(brief), tasks: l.tasks.map(brief), counts: l.counts }; }
    if (req.op === 'task_add') return brief(add(sid, 'agent', req.text, { by: 'agent' }));
    if (req.op === 'task_done') { const r = mine(req.id); return brief(update(r.id, { done: true, evidence: req.evidence || '' }, 'agent')); }
    if (req.op === 'task_update') {
        const r = mine(req.id);
        const p = {};
        if (req.text !== undefined) { if (r.owner === 'user') throw new Error('The text of one of the user\'s asks is theirs; tick it with task_done'); p.text = req.text; }
        if (req.done !== undefined) p.done = req.done === true;
        return brief(update(r.id, p, 'agent'));
    }
    throw new Error('Not a task op');
}

// ---------------------------------------------------------------- the Supervisor's review

/** The user's list as the review prompt shows it ('' when there is none). */
function promptSection(sessionId) {
    const asks = list(sessionId).asks;
    if (!asks.length) return '';
    return ['## The user\'s list (what the user asked over the whole session; [x] = ticked, with its evidence)',
        asks.slice(-40).map((a) => `#${a.id} [${a.done ? 'x' : ' '}] ${a.text}${a.done && a.evidence ? ` -- ${a.evidence}` : (a.done ? ` -- ticked by ${a.doneBy || 'someone'}` : '')}`).join('\n')].join('\n');
}

/** A review named items done: [{ id, evidence }] (ids of this session's user items only). Returns the ticked rows. */
function applyDone(sessionId, done) {
    const out = [];
    (Array.isArray(done) ? done : []).slice(0, 40).forEach((x) => {
        const id = Number(x && typeof x === 'object' ? x.id : x);
        const r = Number.isInteger(id) ? get(id) : null;
        if (!r || r.sessionId !== sessionId || r.owner !== 'user' || r.done) return;
        out.push(update(r.id, { done: true, evidence: x && typeof x === 'object' ? x.evidence || '' : '' }, 'supervisor'));
    });
    return out;
}

// ---------------------------------------------------------------- titles

function titles() {
    const d = db();
    if (!titleCache) {
        titleCache = new Map();
        d.prepare('SELECT * FROM session_titles').all().forEach((r) => titleCache.set(r.session_id, { title: r.title, custom: !!r.custom, hum: r.hum }));
    }
    return titleCache;
}
/** The stored title of a session ('' when none): a Fleet-side name or the Supervisor's. */
function titleFor(sessionId) { const t = titles().get(String(sessionId)); return t ? t.title : ''; }
/** True when the stored title is a Fleet-side name Yukimi gave (it beats the session's own custom title and the Supervisor's). */
function isNamed(sessionId) { const t = titles().get(String(sessionId)); return !!(t && t.custom); }

function putTitle(sessionId, title, custom, hum) {
    db().prepare(`INSERT INTO session_titles (session_id, title, custom, hum, at) VALUES (?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET title = excluded.title, custom = excluded.custom, hum = excluded.hum, at = excluded.at`).run(sessionId, title, custom ? 1 : 0, hum || 0, Date.now());
    titles().set(sessionId, { title, custom: !!custom, hum: hum || 0 });
    emit(sessionId);
}

/** Fleet > session > Rename: a Fleet-side name that stays; an empty name hands the title back to the Supervisor. */
function setName(sessionId, name) {
    if (!SESSION_ID_RE.test(String(sessionId || ''))) throw new Error('A session id');
    const t = clean(name, 100);
    if (!t) {
        db().prepare('DELETE FROM session_titles WHERE session_id = ?').run(sessionId);
        titles().delete(sessionId);
        emit(sessionId);
        return '';
    }
    const cur = titles().get(sessionId);
    putTitle(sessionId, t, true, cur ? cur.hum : 0);
    return t;
}

const TITLE_SYSTEM = 'You name a coding session for a list. From the user\'s recent asks (oldest first, the last one is the newest) write ONE short title: what this session is about now, max 60 characters, plain words, no quotes, no trailing period, in the user\'s language. Answer ONLY {"title":"..."}.';

function cleanTitleText(t) {
    let s = clean(t, 200).replace(/^["'`]+|["'`]+$/g, '').replace(/[.\s]+$/, '');
    if (s.length > TITLE_MAX) { s = s.slice(0, TITLE_MAX + 1); const i = s.lastIndexOf(' '); s = (i > 30 ? s.slice(0, i) : s.slice(0, TITLE_MAX)).replace(/[\s,;:-]+$/, ''); }
    return s;
}

/** Writes the Supervisor's title when it is due: the first human message, then every 5 more. Returns the new title or ''. */
// a title attempt at most every 2 minutes per session, 10 after an empty answer, 30 after a failure (Nov 24 2026: a failing title call was retried on
// every transcript push - 5,000 calls in 30 minutes - and TokenRouter's rate limit starved Yozora)
const titleTried = new Map();
async function maybeTitle(sessionId, hum, recent) {
    const cur = titles().get(sessionId);
    if ((cur && cur.custom) || hum < 1 || !recent.length) return '';
    if (cur && hum - cur.hum < TITLE_EVERY) return '';
    if (!deps.enabled() || !deps.askJson) return '';
    const last = titleTried.get(sessionId);
    if (last && Date.now() < last) return '';
    titleTried.set(sessionId, Date.now() + 2 * 60000); // in flight / just tried
    try { if (deps.customTitle(sessionId)) return ''; } catch (_) { /* unknown: go on */ }
    let o = null;
    try { o = await deps.askJson(TITLE_SYSTEM, recent.map((t, i) => `${i + 1}. ${t}`).join('\n'), 'title', { maxTokens: 200 }); } catch (e) { titleTried.set(sessionId, Date.now() + 30 * 60000); console.warn(`[sessionTasks] title ${sessionId.slice(0, 8)}: ${e.message}`); return ''; }
    const t = cleanTitleText(o && o.title);
    if (!t) { titleTried.set(sessionId, Date.now() + 10 * 60000); putTitle(sessionId, cur ? cur.title : '', false, hum); return ''; }
    titleTried.delete(sessionId);
    putTitle(sessionId, t, false, hum);
    return t;
}

// ---------------------------------------------------------------- reading the transcript

function readLines(file, from, skipFirst) {
    return new Promise((resolve) => {
        fs.open(file, 'r', (e, fd) => {
            if (e) { resolve({ lines: [], end: from }); return; }
            const buf = Buffer.alloc(READ_MAX);
            fs.read(fd, buf, 0, READ_MAX, from, (err, n) => {
                fs.close(fd, () => {});
                if (err || !n) { resolve({ lines: [], end: from }); return; }
                const last = buf.lastIndexOf(0x0a, n - 1);
                if (last < 0) { resolve({ lines: [], end: from }); return; }
                const lines = [];
                let off = from;
                buf.toString('utf8', 0, last + 1).split('\n').forEach((l, i) => {
                    const at = off;
                    off += Buffer.byteLength(l, 'utf8') + 1;
                    if (i === 0 && skipFirst) return;
                    if (l) lines.push({ line: l, at });
                });
                resolve({ lines, end: from + last + 1 });
            });
        });
    });
}

/** The text of a message a human typed (a user text or a steering message), else ''. */
function humanText(m) {
    if (!m || m.role !== 'user' || m.kind !== 'text' || m.sidechain) return '';
    if (m.origin && m.origin !== 'steering' && m.origin !== 'human') return '';
    const t = String(m.text || '').replace(/<\/?pasted_content[^>]*>/gi, ' ').trim();
    if (!t || t.startsWith(STEER_PREFIX) || /^(This session is being continued|Caveat:|\[Request interrupted)/i.test(t)) return '';
    return t;
}

// ---------------------------------------------------------------- mirroring the agent's own task tools

function mirror(sessionId, name, input, st) {
    const d = db();
    const inp = input && typeof input === 'object' ? input : {};
    const now = Date.now();
    if (name === 'TodoWrite') {
        const todos = (Array.isArray(inp.todos) ? inp.todos : []).map((t) => ({ text: clean(t && (t.content || t.activeForm || t.subject), 300), done: !!t && t.status === 'completed' })).filter((t) => t.text);
        const have = d.prepare("SELECT * FROM session_tasks WHERE session_id = ? AND owner = 'agent' AND ext = 'todo' AND removed = 0 ORDER BY id").all(sessionId);
        const used = new Set();
        todos.forEach((t) => {
            const hit = have.find((r) => !used.has(r.id) && r.text === t.text);
            if (hit) {
                used.add(hit.id);
                if (!!hit.done !== t.done) d.prepare('UPDATE session_tasks SET done = ?, done_by = ?, updated_at = ? WHERE id = ?').run(t.done ? 1 : 0, t.done ? 'agent' : '', now, hit.id);
            } else insert(sessionId, 'agent', t.text, { ext: 'todo', done: t.done, by: 'agent' });
        });
        have.forEach((r) => { if (!used.has(r.id)) d.prepare('UPDATE session_tasks SET removed = 1, updated_at = ? WHERE id = ?').run(now, r.id); });
        return;
    }
    if (name === 'TaskCreate') {
        st.task_seq += 1;
        insert(sessionId, 'agent', inp.subject || inp.description || inp.title, { ext: `task:${st.task_seq}` });
        return;
    }
    if (name === 'TaskUpdate') {
        const key = `task:${String(inp.taskId == null ? inp.id : inp.taskId).replace(/^#/, '')}`;
        const r = d.prepare("SELECT * FROM session_tasks WHERE session_id = ? AND owner = 'agent' AND ext = ? AND removed = 0").get(sessionId, key);
        if (!r) return;
        if (inp.status === 'deleted') { d.prepare('UPDATE session_tasks SET removed = 1, updated_at = ? WHERE id = ?').run(now, r.id); return; }
        const text = clean(inp.subject || inp.title, 300) || r.text;
        const done = inp.status === 'completed' ? 1 : (inp.status ? 0 : r.done);
        d.prepare('UPDATE session_tasks SET text = ?, done = ?, done_by = ?, updated_at = ? WHERE id = ?').run(text, done, done ? 'agent' : '', now, r.id);
    }
}

// ---------------------------------------------------------------- the user's asks

const ASKS_SYSTEM = [
    'You keep a checklist of what the user asked a coding agent. From the NEW message(s) list each concrete ask (something to do, check, change, answer or show, including "also ..." asides and changes of direction) as a short imperative item of at most 140 characters, in the user\'s language, naming the thing (files, features) the message names.',
    'Skip thanks, greetings and chatter. Do not repeat an item the current list already covers. If a new message cancels or replaces an item of the current list, put that item\'s id in "drop".',
    'Answer ONLY {"items":[{"text":"...","msg":1}],"drop":[ids]} where msg is the number of the new message the item comes from.'
].join('\n');

async function extract(sessionId, humans) {
    const d = db();
    const cur = list(sessionId).asks.slice(-40);
    let res = null;
    if (deps.enabled() && deps.askJson) {
        const user = [`## Current list (${cur.length})`, cur.length ? cur.map((a) => `#${a.id} [${a.done ? 'x' : ' '}] ${a.text}`).join('\n') : '(empty)', '', `## New message(s) (${humans.length})`,
            humans.map((h, i) => `${i + 1}. ${h.text.slice(0, 2500)}`).join('\n\n')].join('\n');
        try { res = await deps.askJson(ASKS_SYSTEM, user, 'tasks', { maxTokens: 700 }); } catch (e) { console.warn(`[sessionTasks] asks ${sessionId.slice(0, 8)}: ${e.message}`); res = null; }
    }
    let items = res && Array.isArray(res.items) ? res.items.map((x) => ({ text: clean(x && (x.text || x), 300), msg: Number(x && x.msg) || humans.length })).filter((x) => x.text) : null;
    // no engine, or its answer was unusable: the first line of each message is the item
    if (!items) items = humans.map((h, i) => ({ text: clean(h.text.split('\n').find((l) => l.trim()) || h.text, 140), msg: i + 1 })).filter((x) => x.text);
    if (res && Array.isArray(res.drop)) {
        res.drop.slice(0, 20).forEach((id) => {
            const r = get(id);
            if (r && r.sessionId === sessionId && r.owner === 'user') d.prepare('UPDATE session_tasks SET removed = 1, updated_at = ? WHERE id = ?').run(Date.now(), r.id);
        });
    }
    const seen = new Set(list(sessionId).asks.map((a) => a.text.toLowerCase()));
    items.slice(0, 12).forEach((x) => {
        if (seen.has(x.text.toLowerCase())) return;
        seen.add(x.text.toLowerCase());
        const h = humans[Math.min(humans.length, Math.max(1, x.msg)) - 1];
        insert(sessionId, 'user', x.text, { sourceAt: h ? h.at : null });
    });
}

// ---------------------------------------------------------------- sync (one transcript, incrementally)

const chains = new Map();
const timers = new Map();

/** Reads what was appended to the session's transcript since the last sync: asks, mirrored tools, title. */
function sync(sessionId) {
    if (!SESSION_ID_RE.test(String(sessionId || ''))) return Promise.resolve(null);
    const prev = chains.get(sessionId) || Promise.resolve();
    const next = prev.catch(() => {}).then(() => run(sessionId));
    chains.set(sessionId, next);
    const done = () => { if (chains.get(sessionId) === next) chains.delete(sessionId); };
    next.then(done, done);
    return next;
}

/** A session's transcript grew (or may have): sync it shortly. One timer per session. */
function poke(sessionId, delay) {
    if (!SESSION_ID_RE.test(String(sessionId || '')) || timers.has(sessionId)) return;
    const t = setTimeout(() => { timers.delete(sessionId); sync(sessionId).catch((e) => console.warn(`[sessionTasks] ${sessionId.slice(0, 8)}: ${e.message}`)); }, delay == null ? POKE_MS : delay);
    if (t.unref) t.unref();
    timers.set(sessionId, t);
}

async function run(sessionId) {
    if (!deps.findFile) return null;
    const file = await deps.findFile(sessionId);
    if (!file) return null;
    let size = 0;
    try { size = fs.statSync(file).size; } catch (_) { return null; }
    const d = db();
    let st = d.prepare('SELECT * FROM session_task_state WHERE session_id = ?').get(sessionId);
    const first = !st || st.file !== file || st.offset > size;
    if (first) st = { session_id: sessionId, file, offset: Math.max(0, size - READ_MAX), hum: 0, task_seq: 0, recent: '[]' };
    else if (st.offset >= size) return null;
    let recent = [];
    try { recent = JSON.parse(st.recent) || []; } catch (_) { recent = []; }
    let from = st.offset;
    let skipFirst = first && from > 0;
    const humans = [];
    let changed = false;
    const transcript = require('./claudeTranscript');
    for (let pass = 0; pass < MAX_PASSES && from < size; pass += 1) {
        const r = await readLines(file, from, skipFirst);
        skipFirst = false;
        if (r.end <= from) break;
        r.lines.forEach(({ line, at }) => {
            if (!line.includes('"user"') && !line.includes('"attachment"') && !line.includes('"assistant"')) return;
            let o = null;
            try { o = JSON.parse(line); } catch (_) { return; }
            if (!o || typeof o !== 'object') return;
            transcript.messagesOf(o, at).forEach((m) => { const t = humanText(m); if (t) humans.push({ at: m.at, text: t }); });
            if (o.type === 'assistant' && !o.isSidechain && o.message && Array.isArray(o.message.content) && line.includes('"tool_use"')) {
                o.message.content.forEach((b) => { if (b && b.type === 'tool_use' && TOOLS.has(b.name)) { mirror(sessionId, b.name, b.input, st); changed = true; } });
            }
        });
        from = r.end;
    }
    st.offset = from;
    st.hum += humans.length;
    humans.forEach((h) => recent.push(h.text.slice(0, 500)));
    recent = recent.slice(-6);
    const targets = humans.slice(first ? -FIRST_ASKS : -BATCH_ASKS);
    if (targets.length) { await extract(sessionId, targets); changed = true; }
    d.prepare(`INSERT INTO session_task_state (session_id, file, offset, hum, task_seq, recent, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(session_id) DO UPDATE SET file = excluded.file, offset = excluded.offset, hum = excluded.hum, task_seq = excluded.task_seq, recent = excluded.recent, updated_at = excluded.updated_at`)
        .run(sessionId, file, st.offset, st.hum, st.task_seq, JSON.stringify(recent), Date.now());
    if (changed) emit(sessionId);
    await maybeTitle(sessionId, st.hum, recent);
    if (st.offset < size) poke(sessionId, 200); // a long backlog: the rest next
    return list(sessionId);
}

module.exports = { configure, onChange, list, add, update, remove, agentOp, promptSection, applyDone, titleFor, isNamed, titles, setName, sync, poke, cleanTitleText, humanText, TITLE_EVERY };
