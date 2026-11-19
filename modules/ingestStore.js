/**
 * Ingest Controller storage: .cache/ingest.db (better-sqlite3, WAL).
 *
 *   ingest_accounts  (source, account)  mode 'bypass'|'process', applying 0|1, pipeline (JSON, ordered
 *                    [{ id, enabled, settings }]). source: 'email' (IMAP bridge accounts), 'sms'
 *                    (text accounts), 'exchange' (DS Exchange mailboxes). No row = bypass.
 *   ingest_log       what the pipeline decided (intended when dry, applied when live). Subject and
 *                    sender only, verification codes redacted; never a body, never a code.
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

function _close() { if (db) { db.close(); db = null; } }

module.exports = { open, getAccount, listAccounts, putAccount, addLog, listLog, _close };
