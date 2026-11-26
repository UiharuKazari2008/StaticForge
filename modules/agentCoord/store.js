'use strict';

/**
 * Agent coordination store (Claude Accounts on the desktop + the agent-coord MCP server, Nov 19): so
 * agents working at the same time on the same trees do not step on each other.
 *
 *   agents     who is working: id, kind (claude | cursor | other), name, session, account, task,
 *              folder, repo, branch, tmux pane, pid, last seen
 *   claims     a path (or glob) in a repo an agent is editing, with a lease: exclusive (default) or
 *              shared; a claim lapses when its lease runs out, when it is released, or when its agent's
 *              process is gone
 *   messages   notes, questions and steering between agents (to one agent or to all); each agent has an
 *              inbox cursor (the last message id it has read)
 *
 * One SQLite file (WAL) for the whole host, shared by every MCP server process and the Dreamscape
 * server: ~/.local/state/dreamscape-agents/coord.db (AGENT_COORD_DB overrides; tests use a temp dir).
 * better-sqlite3 only (the one the Dreamscape server uses for its own files), never another SQLite copy
 * on the same file in one process. Everything is small and indexed; no call takes long.
 *
 * Paths are kept relative to their repo, so worktrees of one repo (~/staticforge, ~/wt/x) share
 * claims: repoOf(dir) names the repo by its git common dir.
 *
 * v2 (#1154, Yukimi Nov 24 2026: "see the other agents that are working, inspect their session so they
 * can see what files they have edited ... prevent agents from stepping on each others work or starting a
 * build without checking if every agent is ready to build. we want full cooperation"):
 *   locks      the agent-busy-lock rule's .agent-<id> file, planted in a repo's root on an agent's first
 *              claim there and removed when it releases everything there, is done, or its process is
 *              gone (only locks this store planted are ever removed); .agent-* files of agents that do
 *              not use agent-coord are listed by lockFiles() with their age
 *   edits      files a Claude session changed (Edit / Write / MultiEdit / NotebookEdit in its transcript and
 *              its subagents'), from an incremental scan: scans keeps each transcript's byte offset, so a
 *              transcript is read once, never again from the start (inspect())
 *   builds     build gates: a build of a target in a repo is requested, every live agent in the repo answers
 *              ready or not (an agent that is not busy and holds no claim there counts as ready by itself),
 *              and it begins only when nobody is pending or not ready and no other build of the target runs
 */

const fs = require('fs');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const DEFAULT_LEASE_MIN = 45;
const MAX_LEASE_MIN = 8 * 60;
const GONE_NOPID_MS = 2 * 60 * 60 * 1000;
const GONE_AFTER_MS = 6 * 60 * 60 * 1000; // an agent nobody has heard from in 6 h is listed as gone
const BODY_CAP = 8000;

function dbPath() {
    return process.env.AGENT_COORD_DB || path.join(os.homedir(), '.local', 'state', 'dreamscape-agents', 'coord.db');
}

let db = null;
let dbFile = null;

function open() {
    const file = dbPath();
    if (db && dbFile === file) return db;
    if (db) { try { db.close(); } catch (_) { /* closed */ } }
    const Database = require('better-sqlite3');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    db = new Database(file);
    dbFile = file;
    db.pragma('journal_mode = WAL');
    db.pragma('busy_timeout = 4000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS agents (
            id TEXT PRIMARY KEY, kind TEXT NOT NULL DEFAULT 'other', name TEXT NOT NULL DEFAULT '',
            session_id TEXT, account TEXT, task TEXT NOT NULL DEFAULT '', status TEXT NOT NULL DEFAULT 'active',
            cwd TEXT, repo TEXT, branch TEXT, tmux TEXT, pid INTEGER, host TEXT,
            started_at INTEGER NOT NULL, seen_at INTEGER NOT NULL, inbox_cursor INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS claims (
            id INTEGER PRIMARY KEY AUTOINCREMENT, agent_id TEXT NOT NULL, repo TEXT NOT NULL, path TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'exclusive', note TEXT NOT NULL DEFAULT '',
            created_at INTEGER NOT NULL, expires_at INTEGER NOT NULL, released_at INTEGER
        );
        CREATE INDEX IF NOT EXISTS claims_live ON claims (released_at, expires_at);
        CREATE INDEX IF NOT EXISTS claims_agent ON claims (agent_id);
        CREATE TABLE IF NOT EXISTS messages (
            id INTEGER PRIMARY KEY AUTOINCREMENT, from_agent TEXT NOT NULL, to_agent TEXT,
            kind TEXT NOT NULL DEFAULT 'note', body TEXT NOT NULL, created_at INTEGER NOT NULL,
            delivered TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS messages_to ON messages (to_agent, id);
        CREATE TABLE IF NOT EXISTS locks (
            agent_id TEXT NOT NULL, root TEXT NOT NULL, file TEXT NOT NULL, created_at INTEGER NOT NULL,
            PRIMARY KEY (agent_id, root)
        );
        CREATE TABLE IF NOT EXISTS scans (
            key TEXT PRIMARY KEY, session_id TEXT NOT NULL, file TEXT NOT NULL, offset INTEGER NOT NULL DEFAULT 0,
            commands TEXT NOT NULL DEFAULT '[]', last_text TEXT NOT NULL DEFAULT '', last_at INTEGER, tools INTEGER NOT NULL DEFAULT 0
        );
        CREATE TABLE IF NOT EXISTS edits (
            session_id TEXT NOT NULL, path TEXT NOT NULL, tool TEXT NOT NULL DEFAULT '', n INTEGER NOT NULL DEFAULT 0,
            first_at INTEGER, last_at INTEGER, PRIMARY KEY (session_id, path)
        );
        CREATE TABLE IF NOT EXISTS builds (
            id INTEGER PRIMARY KEY AUTOINCREMENT, target TEXT NOT NULL, repo TEXT NOT NULL, requested_by TEXT NOT NULL,
            note TEXT NOT NULL DEFAULT '', state TEXT NOT NULL DEFAULT 'open', created_at INTEGER NOT NULL,
            expires_at INTEGER NOT NULL, started_at INTEGER, ended_at INTEGER, result TEXT NOT NULL DEFAULT '', forced TEXT NOT NULL DEFAULT ''
        );
        CREATE INDEX IF NOT EXISTS builds_open ON builds (state, repo, target);
        CREATE TABLE IF NOT EXISTS artifacts (
            id INTEGER PRIMARY KEY AUTOINCREMENT, session_id TEXT NOT NULL, path TEXT NOT NULL, kind TEXT NOT NULL,
            created_at INTEGER NOT NULL, cmd TEXT NOT NULL DEFAULT '', cwd TEXT NOT NULL DEFAULT '',
            exists_now INTEGER, size_bytes INTEGER, checked_at INTEGER, forgotten INTEGER NOT NULL DEFAULT 0,
            UNIQUE (session_id, path)
        );
        CREATE TABLE IF NOT EXISTS lock_owners (
            session_id TEXT NOT NULL, name TEXT NOT NULL, seen_at INTEGER NOT NULL, PRIMARY KEY (session_id, name)
        );
        CREATE TABLE IF NOT EXISTS build_votes (
            build_id INTEGER NOT NULL, agent_id TEXT NOT NULL, ready INTEGER NOT NULL, note TEXT NOT NULL DEFAULT '',
            at INTEGER NOT NULL, PRIMARY KEY (build_id, agent_id)
        );
    `);
    const cols = new Set(db.prepare('PRAGMA table_info(agents)').all().map((c) => c.name));
    [['model', 'TEXT'], ['effort', 'TEXT'], ['dispatched_by', 'TEXT'], ['config_dir', 'TEXT']].forEach(([c, t]) => {
        if (!cols.has(c)) db.exec(`ALTER TABLE agents ADD COLUMN ${c} ${t}`);
    });
    const lockCols = new Set(db.prepare('PRAGMA table_info(locks)').all().map((c) => c.name));
    if (!lockCols.has('planted_by')) db.exec("ALTER TABLE locks ADD COLUMN planted_by TEXT NOT NULL DEFAULT 'agent'");
    const artCols = new Set(db.prepare('PRAGMA table_info(artifacts)').all().map((c) => c.name));
    [['decision', "TEXT NOT NULL DEFAULT ''"], ['decision_reason', "TEXT NOT NULL DEFAULT ''"], ['decided_at', 'INTEGER'], ['trash_path', "TEXT NOT NULL DEFAULT ''"]].forEach(([c, t]) => {
        if (!artCols.has(c)) db.exec(`ALTER TABLE artifacts ADD COLUMN ${c} ${t}`);
    });
    try { fs.chmodSync(file, 0o600); } catch (_) { /* kept */ }
    return db;
}

function close() {
    if (db) { try { db.close(); } catch (_) { /* closed */ } }
    db = null;
    dbFile = null;
}

// ---------------------------------------------------------------- helpers

const now = () => Date.now();
const text = (s, n) => String(s == null ? '' : s).replace(/[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/g, '').slice(0, n || 400);

const realAlive = (pid) => { try { process.kill(pid, 0); return true; } catch (e) { return e.code === 'EPERM'; } };
let pidAlive = realAlive;
function _setPidAlive(fn) { pidAlive = typeof fn === 'function' ? fn : realAlive; }

const repoCache = new Map();
/** { repo, root } for a folder: the repo is named by its git common dir (worktrees share it). */
function repoOf(dir) {
    const d = String(dir || '');
    if (!d) return { repo: '', root: '' };
    if (repoCache.has(d)) return repoCache.get(d);
    let out = { repo: '', root: '' };
    try {
        const r = execFileSync('git', ['-C', d, 'rev-parse', '--show-toplevel', '--git-common-dir'], { encoding: 'utf8', timeout: 4000, stdio: ['ignore', 'pipe', 'ignore'] }).trim().split('\n');
        const root = r[0];
        let common = r[1] || '';
        if (common && !path.isAbsolute(common)) common = path.resolve(root, common);
        const main = path.basename(common) === '.git' ? path.dirname(common) : common;
        out = { repo: path.basename(main), root };
    } catch (_) { out = { repo: '', root: '' }; }
    repoCache.set(d, out);
    return out;
}

/** A path as a claim keeps it: relative to its repo, forward slashes, no ./, no trailing slash. */
function normPath(p, root) {
    let s = String(p || '').trim().replace(/\\/g, '/');
    if (!s) return '';
    if (root && path.isAbsolute(s)) {
        const rel = path.relative(root, s).replace(/\\/g, '/');
        if (!rel.startsWith('..')) s = rel;
    }
    s = s.replace(/^\.\/+/, '').replace(/\/+$/, '').replace(/\/{2,}/g, '/');
    return s || '.';
}

function globRe(g) {
    const re = g.split('**').map((part) => part.split('*').map((x) => x.replace(/[.+?^${}()|[\]\\]/g, '\\$&')).join('[^/]*')).join('.*');
    return new RegExp(`^${re}$`);
}
const isGlob = (p) => /\*/.test(p);
const fixedPrefix = (p) => p.split('*')[0].replace(/\/[^/]*$/, '');

/** Two claimed paths overlap: the same, one inside the other, or a glob matching the other. */
function overlaps(a, b) {
    if (a === '.' || b === '.') return true;
    if (a === b) return true;
    if (!isGlob(a) && !isGlob(b)) return a.startsWith(`${b}/`) || b.startsWith(`${a}/`);
    if (isGlob(a) && !isGlob(b)) {
        // the glob matches the path, or the path is a folder the glob reaches into
        const pre = fixedPrefix(a);
        return globRe(a).test(b) || pre === b || pre.startsWith(`${b}/`);
    }
    if (!isGlob(a) && isGlob(b)) return overlaps(b, a);
    // two globs: compare their fixed parts
    const pa = fixedPrefix(a);
    const pb = fixedPrefix(b);
    return !pa || !pb || pa === pb || pa.startsWith(`${pb}/`) || pb.startsWith(`${pa}/`);
}

// ---------------------------------------------------------------- agents

function rowAgent(r) {
    if (!r) return null;
    const alive = r.pid ? pidAlive(r.pid) : null;
    let status = r.status;
    // no pid to check (a session Fleet or the Supervisor registered for it): gone after 2 h without a word, not 6
    // (Nov 24 2026: 52 ended sessions still counted as "55 agents active")
    if (status !== 'gone' && (alive === false || now() - r.seen_at > (r.pid ? GONE_AFTER_MS : GONE_NOPID_MS))) status = 'gone';
    return {
        id: r.id, kind: r.kind, name: r.name, sessionId: r.session_id || '', account: r.account || '', task: r.task,
        status, cwd: r.cwd || '', repo: r.repo || '', branch: r.branch || '', tmux: r.tmux || '', pid: r.pid || null,
        host: r.host || '', startedAt: r.started_at, seenAt: r.seen_at,
        model: r.model || '', effort: r.effort || '', dispatchedBy: r.dispatched_by || '', configDir: r.config_dir || ''
    };
}

/**
 * Registers or updates an agent (every MCP call does, so seen_at is its heartbeat). Fields left out
 * keep their value.
 */
function upsertAgent(a) {
    const d = open();
    const id = text(a.id, 120);
    if (!id) throw new Error('An agent needs an id');
    const t = now();
    const cur = d.prepare('SELECT * FROM agents WHERE id = ?').get(id);
    const v = {
        id,
        kind: text(a.kind || (cur && cur.kind) || 'other', 20),
        name: text(a.name !== undefined ? a.name : (cur ? cur.name : ''), 120),
        session_id: a.sessionId !== undefined ? text(a.sessionId, 80) : (cur ? cur.session_id : null),
        account: a.account !== undefined ? text(a.account, 120) : (cur ? cur.account : null),
        task: a.task !== undefined ? text(a.task, 600) : (cur ? cur.task : ''),
        status: text(a.status || (cur && cur.status !== 'gone' ? cur.status : 'active'), 20),
        cwd: a.cwd !== undefined ? text(a.cwd, 400) : (cur ? cur.cwd : null),
        repo: a.repo !== undefined ? text(a.repo, 120) : (cur ? cur.repo : null),
        branch: a.branch !== undefined ? text(a.branch, 200) : (cur ? cur.branch : null),
        tmux: a.tmux !== undefined ? text(a.tmux, 120) : (cur ? cur.tmux : null),
        pid: a.pid !== undefined ? (Number.isInteger(a.pid) ? a.pid : null) : (cur ? cur.pid : null),
        model: a.model !== undefined ? text(a.model, 80) : (cur ? cur.model : null),
        effort: a.effort !== undefined ? text(a.effort, 20) : (cur ? cur.effort : null),
        dispatched_by: a.dispatchedBy !== undefined ? text(a.dispatchedBy, 120) : (cur ? cur.dispatched_by : null),
        config_dir: a.configDir !== undefined ? text(a.configDir, 400) : (cur ? cur.config_dir : null),
        host: text(a.host || (cur && cur.host) || os.hostname(), 120),
        started_at: cur ? cur.started_at : t,
        seen_at: t,
        inbox_cursor: cur ? cur.inbox_cursor : (d.prepare('SELECT COALESCE(MAX(id), 0) m FROM messages').get().m)
    };
    d.prepare(`INSERT INTO agents (id, kind, name, session_id, account, task, status, cwd, repo, branch, tmux, pid, host, started_at, seen_at, inbox_cursor, model, effort, dispatched_by, config_dir)
        VALUES (@id, @kind, @name, @session_id, @account, @task, @status, @cwd, @repo, @branch, @tmux, @pid, @host, @started_at, @seen_at, @inbox_cursor, @model, @effort, @dispatched_by, @config_dir)
        ON CONFLICT(id) DO UPDATE SET kind=@kind, name=@name, session_id=@session_id, account=@account, task=@task, status=@status, cwd=@cwd,
        repo=@repo, branch=@branch, tmux=@tmux, pid=@pid, host=@host, seen_at=@seen_at, model=@model, effort=@effort, dispatched_by=@dispatched_by, config_dir=@config_dir`).run(v);
    return getAgent(id);
}

function getAgent(id) {
    return rowAgent(open().prepare('SELECT * FROM agents WHERE id = ?').get(String(id || '')));
}

/** An agent by id, or by name / session id / id prefix when that is unique. */
function resolveAgent(ref) {
    const r = String(ref || '').trim();
    if (!r) return null;
    const d = open();
    const exact = d.prepare('SELECT * FROM agents WHERE id = ?').get(r);
    if (exact) return rowAgent(exact);
    const rows = d.prepare('SELECT * FROM agents WHERE name = ? COLLATE NOCASE OR session_id = ? OR id LIKE ? ORDER BY seen_at DESC').all(r, r, `${r.replace(/[%_]/g, '')}%`);
    const live = rows.map(rowAgent).filter((a) => a.status !== 'gone');
    if (live.length === 1) return live[0];
    if (rows.length === 1) return rowAgent(rows[0]);
    return null;
}

// only the columns rowAgent reads (not inbox_cursor and the rest), the statement prepared once per database
let listStmtDb = null;
let listStmtVal = null;
function listStmt(d) {
    if (listStmtDb !== d) {
        listStmtVal = d.prepare('SELECT id, kind, name, session_id, account, task, status, cwd, repo, branch, tmux, pid, host, started_at, seen_at, model, effort, dispatched_by, config_dir FROM agents ORDER BY seen_at DESC LIMIT 200');
        listStmtDb = d;
    }
    return listStmtVal;
}

function listAgents(opts = {}) {
    const d = open();
    const rows = listStmt(d).all().map(rowAgent);
    const out = opts.all ? rows : rows.filter((a) => a.status !== 'gone');
    const claimCount = new Map();
    liveClaimRows().forEach((c) => claimCount.set(c.agent_id, (claimCount.get(c.agent_id) || 0) + 1));
    return out.map((a) => Object.assign(a, { claims: claimCount.get(a.id) || 0 }));
}

function setStatus(id, status, task) {
    const d = open();
    const fields = { id: String(id), status: text(status || 'active', 20), seen: now() };
    if (task !== undefined) d.prepare('UPDATE agents SET status=@status, task=@task, seen_at=@seen WHERE id=@id').run(Object.assign(fields, { task: text(task, 600) }));
    else d.prepare('UPDATE agents SET status=@status, seen_at=@seen WHERE id=@id').run(fields);
    if (fields.status === 'gone' || fields.status === 'done') releaseAll(id);
    return getAgent(id);
}

// ---------------------------------------------------------------- claims

function rowClaim(r) {
    return { id: r.id, agentId: r.agent_id, repo: r.repo, path: r.path, mode: r.mode, note: r.note, createdAt: r.created_at, expiresAt: r.expires_at };
}

/** Claims still in force: unreleased, unexpired, and held by an agent that is not gone. */
function liveClaims(filter = {}) { return liveClaimRows(filter).map(rowClaim); }

/** The raw rows of liveClaims (a caller that only counts skips building claim objects). */
function liveClaimRows(filter = {}) {
    const d = open();
    const rows = d.prepare('SELECT c.*, a.pid AS apid, a.status AS astatus, a.seen_at AS aseen FROM claims c LEFT JOIN agents a ON a.id = c.agent_id WHERE c.released_at IS NULL AND c.expires_at > ?').all(now());
    const out = [];
    const lapsed = [];
    rows.forEach((r) => {
        const gone = r.astatus === 'gone' || r.astatus === 'done' || (r.apid && !pidAlive(r.apid));
        if (gone) { lapsed.push(r.id); return; }
        if (filter.repo && r.repo !== filter.repo) return;
        if (filter.agentId && r.agent_id !== filter.agentId) return;
        out.push(r);
    });
    if (lapsed.length) {
        const st = d.prepare('UPDATE claims SET released_at = ? WHERE id = ?');
        const t = now();
        d.transaction(() => lapsed.forEach((id) => st.run(t, id)))();
        const goneAgents = new Set(rows.filter((r) => lapsed.includes(r.id)).map((r) => r.agent_id));
        goneAgents.forEach((a) => removeLocks(a));
    }
    return out;
}

/**
 * Claims paths for an agent. A path that overlaps another agent's live claim (unless both are shared)
 * is not granted: answers { granted: [...], conflicts: [{ path, heldBy, agent, ... }] }. Claiming a path
 * the agent holds already renews its lease.
 */
function claim(agentId, repo, paths, opts = {}) {
    const d = open();
    const agent = getAgent(agentId);
    if (!agent) throw new Error('Unknown agent: call coord_hello first');
    const mode = opts.mode === 'shared' ? 'shared' : 'exclusive';
    const leaseMin = Math.max(1, Math.min(MAX_LEASE_MIN, Number(opts.leaseMinutes) || DEFAULT_LEASE_MIN));
    const r = text(repo || agent.repo || '', 120);
    if (!r) throw new Error('Which repo? Pass repo (the git repo name, e.g. staticforge) or work from inside one');
    const list = (Array.isArray(paths) ? paths : [paths]).map((p) => normPath(p, opts.root)).filter(Boolean).slice(0, 64);
    if (!list.length) throw new Error('No paths to claim');
    const t = now();
    const others = liveClaims({ repo: r }).filter((c) => c.agentId !== agentId);
    const mine = liveClaims({ repo: r, agentId });
    const granted = [];
    const conflicts = [];
    d.transaction(() => {
        list.forEach((p) => {
            const clash = others.filter((c) => overlaps(p, c.path) && !(mode === 'shared' && c.mode === 'shared'));
            if (clash.length) {
                clash.forEach((c) => {
                    const h = getAgent(c.agentId);
                    conflicts.push({ path: p, heldPath: c.path, heldBy: c.agentId, holder: h ? (h.name || h.id) : c.agentId, task: h ? h.task : '', mode: c.mode, expiresAt: c.expiresAt, note: c.note });
                });
                return;
            }
            const have = mine.find((c) => c.path === p);
            if (have) {
                d.prepare('UPDATE claims SET expires_at = ?, mode = ?, note = ? WHERE id = ?').run(t + leaseMin * 60000, mode, text(opts.note || have.note, 300), have.id);
                granted.push({ path: p, renewed: true, expiresAt: t + leaseMin * 60000 });
            } else {
                d.prepare('INSERT INTO claims (agent_id, repo, path, mode, note, created_at, expires_at) VALUES (?, ?, ?, ?, ?, ?, ?)').run(agentId, r, p, mode, text(opts.note, 300), t, t + leaseMin * 60000);
                granted.push({ path: p, expiresAt: t + leaseMin * 60000 });
            }
        });
    })();
    upsertAgent({ id: agentId });
    let lock = '';
    if (granted.length && opts.root) { try { lock = plantLock(agentId, opts.root, agent.task || opts.note || ''); } catch (e) { lock = ''; } }
    return { repo: r, mode, leaseMinutes: leaseMin, granted, conflicts, lock };
}

function release(agentId, repo, paths, opts = {}) {
    const d = open();
    const t = now();
    if (!paths || (Array.isArray(paths) && !paths.length)) return { released: releaseAll(agentId, repo) };
    const list = (Array.isArray(paths) ? paths : [paths]).map((p) => normPath(p, opts.root)).filter(Boolean);
    let n = 0;
    const st = repo ? d.prepare('UPDATE claims SET released_at = ? WHERE agent_id = ? AND repo = ? AND path = ? AND released_at IS NULL')
        : d.prepare('UPDATE claims SET released_at = ? WHERE agent_id = ? AND path = ? AND released_at IS NULL');
    list.forEach((p) => { n += (repo ? st.run(t, agentId, repo, p) : st.run(t, agentId, p)).changes; });
    if (repo && !liveClaims({ repo, agentId }).length) removeLocks(agentId, repo);
    return { released: n };
}

function releaseAll(agentId, repo) {
    const d = open();
    const r = repo ? d.prepare('UPDATE claims SET released_at = ? WHERE agent_id = ? AND repo = ? AND released_at IS NULL').run(now(), agentId, repo)
        : d.prepare('UPDATE claims SET released_at = ? WHERE agent_id = ? AND released_at IS NULL').run(now(), agentId);
    removeLocks(agentId, repo || null);
    return r.changes;
}

/** Who holds what overlaps these paths (all agents, the asker included). */
function check(repo, paths, opts = {}) {
    const list = (Array.isArray(paths) ? paths : [paths]).map((p) => normPath(p, opts.root)).filter(Boolean);
    const claims = liveClaims({ repo });
    return list.map((p) => ({
        path: p,
        heldBy: claims.filter((c) => overlaps(p, c.path)).map((c) => {
            const h = getAgent(c.agentId);
            return Object.assign({}, c, { holder: h ? (h.name || h.id) : c.agentId, task: h ? h.task : '' });
        })
    }));
}

// ---------------------------------------------------------------- messages

function rowMsg(r) {
    return { id: r.id, from: r.from_agent, to: r.to_agent || 'all', kind: r.kind, body: r.body, createdAt: r.created_at, delivered: r.delivered || '' };
}

/** Posts a message: to an agent id, or to everyone (to = 'all' / empty). */
function post(fromId, to, body, opts = {}) {
    const d = open();
    const b = text(body, BODY_CAP).trim();
    if (!b) throw new Error('An empty message');
    let toId = null;
    if (to && to !== 'all' && to !== '*') {
        const a = resolveAgent(to);
        if (!a) throw new Error(`No agent ${to} (coord_agents lists them; pass its id)`);
        toId = a.id;
    }
    const kind = ['note', 'steer', 'question', 'reply', 'done'].includes(opts.kind) ? opts.kind : 'note';
    const r = d.prepare('INSERT INTO messages (from_agent, to_agent, kind, body, created_at) VALUES (?, ?, ?, ?, ?)').run(String(fromId), toId, kind, b, now());
    return rowMsg(d.prepare('SELECT * FROM messages WHERE id = ?').get(r.lastInsertRowid));
}

function markDelivered(id, how) {
    open().prepare('UPDATE messages SET delivered = ? WHERE id = ?').run(text(how, 40), Number(id));
}

function unreadCount(agentId) {
    const a = open().prepare('SELECT inbox_cursor FROM agents WHERE id = ?').get(String(agentId));
    if (!a) return 0;
    return open().prepare('SELECT COUNT(*) n FROM messages WHERE id > ? AND (to_agent = ? OR to_agent IS NULL) AND from_agent != ?').get(a.inbox_cursor, String(agentId), String(agentId)).n;
}

/** The agent's unread messages (to it or to all), oldest first; read moves its cursor past them. */
function inbox(agentId, opts = {}) {
    const d = open();
    const a = d.prepare('SELECT inbox_cursor FROM agents WHERE id = ?').get(String(agentId));
    if (!a) return [];
    const rows = d.prepare('SELECT * FROM messages WHERE id > ? AND (to_agent = ? OR to_agent IS NULL) AND from_agent != ? ORDER BY id LIMIT ?').all(a.inbox_cursor, String(agentId), String(agentId), Math.max(1, Math.min(100, Number(opts.limit) || 50)));
    if (!opts.peek && rows.length) d.prepare('UPDATE agents SET inbox_cursor = ? WHERE id = ?').run(rows[rows.length - 1].id, String(agentId));
    return rows.map(rowMsg);
}

/** Recent messages for the console (everyone's), newest last. */
function recentMessages(opts = {}) {
    const d = open();
    const lim = Math.max(1, Math.min(500, Number(opts.limit) || 100));
    const rows = opts.agentId
        ? d.prepare('SELECT * FROM messages WHERE from_agent = ? OR to_agent = ? OR to_agent IS NULL ORDER BY id DESC LIMIT ?').all(opts.agentId, opts.agentId, lim)
        : d.prepare('SELECT * FROM messages ORDER BY id DESC LIMIT ?').all(lim);
    return rows.reverse().map(rowMsg);
}

/** Old rows go: released / expired claims after a day, messages after two weeks, gone agents after a week. */
function prune() {
    const d = open();
    const t = now();
    d.prepare('DELETE FROM claims WHERE (released_at IS NOT NULL AND released_at < ?) OR expires_at < ?').run(t - 86400000, t - 86400000);
    d.prepare('DELETE FROM messages WHERE created_at < ?').run(t - 14 * 86400000);
    d.prepare('DELETE FROM agents WHERE seen_at < ?').run(t - 7 * 86400000);
    d.prepare("DELETE FROM build_votes WHERE build_id IN (SELECT id FROM builds WHERE state NOT IN ('open', 'running') AND COALESCE(ended_at, expires_at) < ?)").run(t - 14 * 86400000);
    d.prepare("DELETE FROM builds WHERE state NOT IN ('open', 'running') AND COALESCE(ended_at, expires_at) < ?").run(t - 14 * 86400000);
    d.prepare('DELETE FROM edits WHERE session_id NOT IN (SELECT session_id FROM agents WHERE session_id IS NOT NULL) AND last_at < ?').run(t - 14 * 86400000);
    d.prepare('DELETE FROM scans WHERE session_id NOT IN (SELECT session_id FROM agents WHERE session_id IS NOT NULL) AND COALESCE(last_at, 0) < ?').run(t - 14 * 86400000);
}

Object.assign(module.exports, require('./storeV2')({
    open, now, text, getAgent, resolveAgent, listAgents, liveClaims, post, repoOf, pidAlive: (pid) => pidAlive(pid)
}));
module.exports = Object.assign(module.exports, {
    dbPath, open, close, repoOf, normPath, overlaps,
    upsertAgent, getAgent, resolveAgent, listAgents, setStatus,
    liveClaims, claim, release, releaseAll, check,
    post, markDelivered, inbox, unreadCount, recentMessages, prune,
    DEFAULT_LEASE_MIN, MAX_LEASE_MIN, _setPidAlive
});
const { plantLock, removeLocks } = module.exports;
