/**
 * The server's copy of IMAP e-mail accounts (Yozora #789): .cache/mailaccounts.db (better-sqlite3;
 * the sync worker process and the server both open it, WAL + busy timeout). The mail server always
 * wins: the sync replaces what differs and removes what the server no longer has.
 *
 *   folders   (account, path) name, special use, uidvalidity, counts
 *   messages  (account, folder, uid) envelope, flags, snippet, bodies (text / html), attachment list
 *   messages_fts  subject, sender, recipients, body
 *   state     (account, key) value
 */
'use strict';

const path = require('path');
const fs = require('fs');

let db = null;
let dbPath = null;

function open(cacheDir) {
    if (db) return db;
    const Database = require('better-sqlite3');
    dbPath = path.join(cacheDir || path.join(__dirname, '..', '.cache'), 'mailaccounts.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    db.pragma('busy_timeout = 10000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS folders (
            account TEXT NOT NULL, path TEXT NOT NULL, name TEXT NOT NULL, delimiter TEXT, special TEXT,
            uidvalidity TEXT, total INTEGER NOT NULL DEFAULT 0, unseen INTEGER NOT NULL DEFAULT 0,
            synced INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (account, path));
        CREATE TABLE IF NOT EXISTS messages (
            account TEXT NOT NULL, folder TEXT NOT NULL, uid INTEGER NOT NULL,
            msgid TEXT, date INTEGER NOT NULL DEFAULT 0, sender TEXT, recipients TEXT, subject TEXT,
            flags TEXT NOT NULL DEFAULT '[]', seen INTEGER NOT NULL DEFAULT 0, flagged INTEGER NOT NULL DEFAULT 0,
            size INTEGER NOT NULL DEFAULT 0, snippet TEXT, has_att INTEGER NOT NULL DEFAULT 0,
            env TEXT NOT NULL DEFAULT '{}', att TEXT NOT NULL DEFAULT '[]', text TEXT, html TEXT, body INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (account, folder, uid));
        CREATE INDEX IF NOT EXISTS messages_by_date ON messages (account, folder, date DESC);
        CREATE INDEX IF NOT EXISTS messages_unseen ON messages (account, folder, seen);
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(subject, sender, recipients, body,
            account UNINDEXED, folder UNINDEXED, uid UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
        CREATE TABLE IF NOT EXISTS state (account TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (account, key));
    `);
    return db;
}

function d() {
    if (!db) throw new Error('mailAccountsStore is not open');
    return db;
}

function getState(account, key) {
    const r = d().prepare('SELECT value FROM state WHERE account = ? AND key = ?').get(account, key);
    return r ? r.value : null;
}

function setState(account, key, value) {
    d().prepare('INSERT INTO state (account, key, value) VALUES (?, ?, ?) ON CONFLICT(account, key) DO UPDATE SET value = excluded.value')
        .run(account, key, value == null ? null : String(value));
}

// ---- folders ----

function putFolder(account, f) {
    d().prepare(`INSERT INTO folders (account, path, name, delimiter, special, uidvalidity, total, unseen, updated)
        VALUES (@account, @path, @name, @delimiter, @special, @uidvalidity, @total, @unseen, @now)
        ON CONFLICT(account, path) DO UPDATE SET name = excluded.name, delimiter = excluded.delimiter, special = excluded.special,
        uidvalidity = COALESCE(excluded.uidvalidity, folders.uidvalidity), total = excluded.total, unseen = excluded.unseen, updated = excluded.updated`)
        .run({ account, path: f.path, name: f.name || f.path, delimiter: f.delimiter || '/', special: f.special || null,
            uidvalidity: f.uidvalidity != null ? String(f.uidvalidity) : null, total: Number(f.total) || 0, unseen: Number(f.unseen) || 0, now: Date.now() });
}

function listFolders(account) {
    return d().prepare('SELECT path, name, delimiter, special, uidvalidity, total, unseen, synced, updated FROM folders WHERE account = ? ORDER BY path').all(account);
}

function getFolder(account, p) {
    return d().prepare('SELECT * FROM folders WHERE account = ? AND path = ?').get(account, p) || null;
}

function setFolderSynced(account, p, synced) {
    d().prepare('UPDATE folders SET synced = ? WHERE account = ? AND path = ?').run(synced ? 1 : 0, account, p);
}

/** Local unread / total counts of a folder from the copy (the list's numbers between syncs). */
function recount(account, p) {
    const r = d().prepare('SELECT COUNT(*) AS total, SUM(CASE WHEN seen = 0 THEN 1 ELSE 0 END) AS unseen FROM messages WHERE account = ? AND folder = ?').get(account, p);
    d().prepare('UPDATE folders SET total = ?, unseen = ? WHERE account = ? AND path = ?').run(r.total || 0, r.unseen || 0, account, p);
    return { total: r.total || 0, unseen: r.unseen || 0 };
}

function removeFolder(account, p) {
    d().transaction(() => {
        d().prepare('DELETE FROM messages_fts WHERE account = ? AND folder = ?').run(account, p);
        d().prepare('DELETE FROM messages WHERE account = ? AND folder = ?').run(account, p);
        d().prepare('DELETE FROM folders WHERE account = ? AND path = ?').run(account, p);
    })();
}

/** UIDVALIDITY changed at the server: the folder's copy is void. */
function clearFolder(account, p) {
    d().transaction(() => {
        d().prepare('DELETE FROM messages_fts WHERE account = ? AND folder = ?').run(account, p);
        d().prepare('DELETE FROM messages WHERE account = ? AND folder = ?').run(account, p);
    })();
}

// ---- messages ----

/** rows: [{ uid, msgid, date, sender, recipients, subject, flags[], size, snippet, att[], env{}, text, html, body }] */
function putMessages(account, folder, rows) {
    const ins = d().prepare(`INSERT INTO messages (account, folder, uid, msgid, date, sender, recipients, subject, flags, seen, flagged, size, snippet, has_att, env, att, text, html, body)
        VALUES (@account, @folder, @uid, @msgid, @date, @sender, @recipients, @subject, @flags, @seen, @flagged, @size, @snippet, @has_att, @env, @att, @text, @html, @body)
        ON CONFLICT(account, folder, uid) DO UPDATE SET msgid = excluded.msgid, date = excluded.date, sender = excluded.sender, recipients = excluded.recipients,
        subject = excluded.subject, flags = excluded.flags, seen = excluded.seen, flagged = excluded.flagged, size = excluded.size, snippet = excluded.snippet,
        has_att = excluded.has_att, env = excluded.env, att = excluded.att, text = excluded.text, html = excluded.html, body = excluded.body`);
    const delF = d().prepare('DELETE FROM messages_fts WHERE account = ? AND folder = ? AND uid = ?');
    const insF = d().prepare('INSERT INTO messages_fts (subject, sender, recipients, body, account, folder, uid) VALUES (?, ?, ?, ?, ?, ?, ?)');
    d().transaction((list) => {
        for (const r of list) {
            const flags = Array.isArray(r.flags) ? r.flags : [];
            ins.run({ account, folder, uid: r.uid, msgid: r.msgid || null, date: Number(r.date) || 0, sender: r.sender || '', recipients: r.recipients || '',
                subject: r.subject || '', flags: JSON.stringify(flags), seen: flags.includes('\\Seen') ? 1 : 0, flagged: flags.includes('\\Flagged') ? 1 : 0,
                size: Number(r.size) || 0, snippet: r.snippet || '', has_att: (r.att || []).some((a) => !a.inline) ? 1 : 0, env: JSON.stringify(r.env || {}),
                att: JSON.stringify(r.att || []), text: r.text || null, html: r.html || null, body: r.body ? 1 : 0 });
            delF.run(account, folder, r.uid);
            insF.run(r.subject || '', r.sender || '', r.recipients || '', (r.text || r.snippet || '').slice(0, 200000), account, folder, r.uid);
        }
    })(rows);
}

/** Flags only (the sync's sweep and live changes): -> how many rows changed. */
function setFlags(account, folder, uid, flags) {
    const f = Array.isArray(flags) ? flags : [];
    return d().prepare('UPDATE messages SET flags = ?, seen = ?, flagged = ? WHERE account = ? AND folder = ? AND uid = ? AND flags != ?')
        .run(JSON.stringify(f), f.includes('\\Seen') ? 1 : 0, f.includes('\\Flagged') ? 1 : 0, account, folder, uid, JSON.stringify(f)).changes;
}

function uids(account, folder) {
    return d().prepare('SELECT uid FROM messages WHERE account = ? AND folder = ?').all(account, folder).map((r) => r.uid);
}

function flagMap(account, folder) {
    const out = new Map();
    for (const r of d().prepare('SELECT uid, flags FROM messages WHERE account = ? AND folder = ?').all(account, folder)) out.set(r.uid, r.flags);
    return out;
}

function deleteMessages(account, folder, list) {
    if (!list || !list.length) return 0;
    const delM = d().prepare('DELETE FROM messages WHERE account = ? AND folder = ? AND uid = ?');
    const delF = d().prepare('DELETE FROM messages_fts WHERE account = ? AND folder = ? AND uid = ?');
    let n = 0;
    d().transaction(() => { for (const u of list) { n += delM.run(account, folder, u).changes; delF.run(account, folder, u); } })();
    return n;
}

const LIST_COLS = 'uid, msgid, date, sender, recipients, subject, flags, seen, flagged, size, snippet, has_att, env';

function listMessages(account, folder, { limit = 50, before = null, unseenOnly = false } = {}) {
    const args = [account, folder];
    let sql = `SELECT ${LIST_COLS} FROM messages WHERE account = ? AND folder = ?`;
    if (before != null && before !== '') { sql += ' AND date < ?'; args.push(Number(before)); }
    if (unseenOnly) sql += ' AND seen = 0';
    sql += ' ORDER BY date DESC LIMIT ?';
    args.push(limit);
    return d().prepare(sql).all(...args);
}

function getMessage(account, folder, uid) {
    return d().prepare('SELECT * FROM messages WHERE account = ? AND folder = ? AND uid = ?').get(account, folder, uid) || null;
}

function maxUid(account, folder) {
    const r = d().prepare('SELECT MAX(uid) AS m FROM messages WHERE account = ? AND folder = ?').get(account, folder);
    return (r && r.m) || 0;
}

function search(term, { account = null, limit = 40 } = {}) {
    const words = String(term || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!words.length) return [];
    const q = words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' AND ');
    const args = [q];
    let sql = `SELECT m.account, m.folder, ${LIST_COLS.split(', ').map((c) => `m.${c}`).join(', ')} FROM messages_fts f
        JOIN messages m ON m.account = f.account AND m.folder = f.folder AND m.uid = f.uid WHERE messages_fts MATCH ?`;
    if (account) { sql += ' AND f.account = ?'; args.push(account); }
    sql += ' ORDER BY m.date DESC LIMIT ?';
    args.push(limit);
    return d().prepare(sql).all(...args);
}

function stats(account) {
    const m = d().prepare('SELECT COUNT(*) AS n, SUM(CASE WHEN body = 1 THEN 1 ELSE 0 END) AS b FROM messages WHERE account = ?').get(account);
    const f = d().prepare('SELECT COUNT(*) AS n, SUM(synced) AS s FROM folders WHERE account = ?').get(account);
    return { messages: m.n || 0, bodies: m.b || 0, folders: f.n || 0, syncedFolders: f.s || 0 };
}

function forgetAccount(account) {
    d().transaction(() => {
        for (const t of ['messages_fts', 'messages', 'folders', 'state']) d().prepare(`DELETE FROM ${t} WHERE account = ?`).run(account);
    })();
}

function sizeOnDisk() {
    let n = 0;
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { n += fs.statSync(f).size; } catch (_) { /* none */ } }
    return n;
}

function _close() { if (db) { db.close(); db = null; } }

module.exports = {
    open, getState, setState, putFolder, listFolders, getFolder, setFolderSynced, recount, removeFolder, clearFolder,
    putMessages, setFlags, uids, flagMap, deleteMessages, listMessages, getMessage, maxUid, search, stats, forgetAccount, sizeOnDisk, _close
};
