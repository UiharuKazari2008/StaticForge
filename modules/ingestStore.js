/**
 * Ingest Controller storage: .cache/ingest.db (better-sqlite3, WAL).
 *
 *   ingest_accounts  (source, account)  mode 'bypass'|'process', applying 0|1, pipeline (JSON, ordered
 *                    [{ id, enabled, settings }]). source: 'email' (IMAP bridge accounts), 'sms'
 *                    (text accounts), 'exchange' (DS Exchange mailboxes). No row = bypass.
 *   ingest_log       what the pipeline decided (intended when dry, applied when live). Subject and
 *                    sender only, verification codes redacted; never a body, never a code.
 *   ingest_expiry    the expiry module's tags (modules/ingestExpiry.js), one row per Inbox message it tracks:
 *                    key = 'm:<Message-ID>' (survives UID moves / UIDVALIDITY resets) or 'u:<validity>:<uid>'
 *                    (e-mail without a Message-ID) or 'x:<row id>' (Exchange). arrived, rule expiry
 *                    (expires_at / after_read_ms, recomputed from the current rules every sweep), routing-set
 *                    expiry (route_*), first_read_at (the first sweep / sync that saw it read), flagged, due_at,
 *                    state tagged|flagged|due|expired|gone|error. Subject and sender only (codes redacted).
 */
'use strict';

const path = require('path');
const fs = require('fs');

let db = null;
let logWrites = 0;

function open(cacheDir) {
    if (db) return db;
    const Database = require('better-sqlite3');
    const file = cacheDir === ':memory:' ? ':memory:' : path.join(cacheDir || path.join(__dirname, '..', '.cache'), 'ingest.db');
    if (file !== ':memory:') fs.mkdirSync(path.dirname(file), { recursive: true });
    db = new Database(file);
    if (file !== ':memory:') {
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
    }
    db.pragma('busy_timeout = 5000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS ingest_accounts (
            source TEXT NOT NULL, account TEXT NOT NULL,
            mode TEXT NOT NULL DEFAULT 'bypass', applying INTEGER NOT NULL DEFAULT 0,
            pipeline TEXT NOT NULL DEFAULT '[]',
            created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, updated_by TEXT,
            PRIMARY KEY (source, account));
        CREATE TABLE IF NOT EXISTS ingest_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT, ts INTEGER NOT NULL, source TEXT NOT NULL, account TEXT NOT NULL,
            ref TEXT, dry INTEGER NOT NULL DEFAULT 0, sender TEXT, subject TEXT, actions TEXT, stopped_by TEXT);
        CREATE INDEX IF NOT EXISTS ingest_log_by_ts ON ingest_log (ts DESC);
        CREATE TABLE IF NOT EXISTS ingest_expiry (
            source TEXT NOT NULL, account TEXT NOT NULL, key TEXT NOT NULL,
            folder TEXT, uid INTEGER, message_id TEXT, ref TEXT, sender TEXT, subject TEXT,
            arrived INTEGER NOT NULL DEFAULT 0, expires_at INTEGER, after_read_ms INTEGER, rule TEXT,
            route_expires_at INTEGER, route_after_read_ms INTEGER, route_rule TEXT,
            first_read_at INTEGER, flagged INTEGER NOT NULL DEFAULT 0, due_at INTEGER,
            state TEXT NOT NULL DEFAULT 'tagged', dry_logged_at INTEGER, last_seen INTEGER,
            created INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0, done_at INTEGER, error TEXT,
            PRIMARY KEY (source, account, key));
        CREATE INDEX IF NOT EXISTS ingest_expiry_by_due ON ingest_expiry (source, account, state, due_at);
        CREATE INDEX IF NOT EXISTS ingest_expiry_by_uid ON ingest_expiry (source, account, folder, uid);
    `);
    return db;
}

function d() { if (!db) open(); return db; }

function parse(json, fallback) { try { return JSON.parse(json || ''); } catch (_) { return fallback; } }

function rowOut(r) {
    if (!r) return null;
    return {
        source: r.source, account: r.account, mode: r.mode === 'process' ? 'process' : 'bypass', applying: r.applying === 1,
        pipeline: parse(r.pipeline, []), created: r.created || null, updated: r.updated || null, updatedBy: r.updated_by || null
    };
}

function getAccount(source, account) {
    return rowOut(d().prepare('SELECT * FROM ingest_accounts WHERE source = ? AND account = ?').get(source, account));
}

function listAccounts() {
    return d().prepare('SELECT * FROM ingest_accounts ORDER BY source, account').all().map(rowOut);
}

function putAccount(a) {
    const now = Date.now();
    const prev = d().prepare('SELECT created FROM ingest_accounts WHERE source = ? AND account = ?').get(a.source, a.account);
    d().prepare(`
        INSERT INTO ingest_accounts (source, account, mode, applying, pipeline, created, updated, updated_by)
        VALUES (@source, @account, @mode, @applying, @pipeline, @created, @updated, @updated_by)
        ON CONFLICT (source, account) DO UPDATE SET mode = excluded.mode, applying = excluded.applying,
            pipeline = excluded.pipeline, updated = excluded.updated, updated_by = excluded.updated_by`)
        .run({
            source: a.source, account: a.account, mode: a.mode === 'process' ? 'process' : 'bypass', applying: a.applying ? 1 : 0,
            pipeline: JSON.stringify(a.pipeline || []), created: prev ? prev.created : now, updated: now, updated_by: a.updatedBy || null
        });
    return getAccount(a.source, a.account);
}

function addLog(e) {
    d().prepare('INSERT INTO ingest_log (ts, source, account, ref, dry, sender, subject, actions, stopped_by) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)')
        .run(Date.now(), e.source, e.account, e.ref || null, e.dry ? 1 : 0, String(e.sender || '').slice(0, 200), String(e.subject || '').slice(0, 200), JSON.stringify(e.actions || []).slice(0, 4000), e.stoppedBy || null);
    if (++logWrites % 50 === 0) d().prepare('DELETE FROM ingest_log WHERE id < (SELECT MAX(id) FROM ingest_log) - 1000').run();
}

function listLog({ source = null, account = null, limit = 50 } = {}) {
    const where = [];
    const args = [];
    if (source) { where.push('source = ?'); args.push(source); }
    if (account) { where.push('account = ?'); args.push(account); }
    args.push(Math.max(1, Math.min(Number(limit) || 50, 200)));
    return d().prepare(`SELECT * FROM ingest_log ${where.length ? `WHERE ${where.join(' AND ')}` : ''} ORDER BY id DESC LIMIT ?`).all(...args)
        .map((r) => ({ id: r.id, ts: r.ts, source: r.source, account: r.account, ref: r.ref, dry: r.dry === 1, sender: r.sender, subject: r.subject, actions: parse(r.actions, []), stoppedBy: r.stopped_by }));
}

// ---------------------------------------------------------------- expiry tags

const EXPIRY_COLS = ['source', 'account', 'key', 'folder', 'uid', 'message_id', 'ref', 'sender', 'subject', 'arrived', 'expires_at', 'after_read_ms', 'rule',
    'route_expires_at', 'route_after_read_ms', 'route_rule', 'first_read_at', 'flagged', 'due_at', 'state', 'dry_logged_at', 'last_seen', 'created', 'updated', 'done_at', 'error'];
const EXPIRY_CAMEL = {
    message_id: 'messageId', expires_at: 'expiresAt', after_read_ms: 'afterReadMs', route_expires_at: 'routeExpiresAt', route_after_read_ms: 'routeAfterReadMs',
    route_rule: 'routeRule', first_read_at: 'firstReadAt', due_at: 'dueAt', dry_logged_at: 'dryLoggedAt', last_seen: 'lastSeen', done_at: 'doneAt'
};

function expiryOut(r) {
    if (!r) return null;
    const o = {};
    for (const c of EXPIRY_COLS) o[EXPIRY_CAMEL[c] || c] = r[c] == null ? null : r[c];
    o.flagged = r.flagged === 1;
    return o;
}

/** All tracked rows of one account (the sweep loads them once): Map key -> row. */
function expiryMap(source, account) {
    const out = new Map();
    for (const r of d().prepare('SELECT * FROM ingest_expiry WHERE source = ? AND account = ?').all(source, account)) out.set(r.key, expiryOut(r));
    return out;
}

function getExpiry(source, account, key) {
    return expiryOut(d().prepare('SELECT * FROM ingest_expiry WHERE source = ? AND account = ? AND key = ?').get(source, account, key));
}

/** Upsert one row (camelCase fields as expiryOut gives them). */
function putExpiry(e) {
    const now = Date.now();
    const row = {};
    for (const c of EXPIRY_COLS) {
        const v = e[EXPIRY_CAMEL[c] || c];
        row[c] = v === undefined ? null : v;
    }
    row.flagged = e.flagged ? 1 : 0;
    row.state = row.state || 'tagged';
    row.arrived = Number(row.arrived) || now;
    row.sender = String(row.sender || '').slice(0, 200);
    row.subject = String(row.subject || '').slice(0, 200);
    row.created = Number(row.created) || now;
    row.updated = now;
    d().prepare(`INSERT INTO ingest_expiry (${EXPIRY_COLS.join(', ')}) VALUES (${EXPIRY_COLS.map((c) => `@${c}`).join(', ')})
        ON CONFLICT (source, account, key) DO UPDATE SET ${EXPIRY_COLS.filter((c) => !['source', 'account', 'key', 'created'].includes(c)).map((c) => `${c} = excluded.${c}`).join(', ')}`).run(row);
}

/** Many upserts in one transaction. */
function putExpiryMany(list) { d().transaction((l) => { for (const e of l) putExpiry(e); })(list || []); }

function expiryCounts(source, account) {
    const out = {};
    for (const r of d().prepare('SELECT state, COUNT(*) AS n FROM ingest_expiry WHERE source = ? AND account = ? GROUP BY state').all(source, account)) out[r.state] = r.n;
    return out;
}

/** Upcoming (state tagged / due) by due time; dueAt null (waiting to be read) last. */
function listExpiry(source, account, { states = ['due', 'tagged'], limit = 50 } = {}) {
    const st = (Array.isArray(states) && states.length ? states : ['due', 'tagged']).map(String);
    return d().prepare(`SELECT * FROM ingest_expiry WHERE source = ? AND account = ? AND state IN (${st.map(() => '?').join(', ')})
        ORDER BY due_at IS NULL, due_at ASC, arrived ASC LIMIT ?`).all(source, account, ...st, Math.max(1, Math.min(Number(limit) || 50, 500))).map(expiryOut);
}

/** Forget finished rows (expired / gone) older than `olderThanMs`. */
function pruneExpiry(olderThanMs) {
    return d().prepare("DELETE FROM ingest_expiry WHERE state IN ('expired', 'gone') AND updated < ?").run(Date.now() - (Number(olderThanMs) || 0)).changes;
}

function _close() { if (db) { db.close(); db = null; } }

module.exports = { open, getAccount, listAccounts, putAccount, addLog, listLog, expiryMap, getExpiry, putExpiry, putExpiryMany, expiryCounts, listExpiry, pruneExpiry, _close };
