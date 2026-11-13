/**
 * Text Messaging's own copy of every conversation and message (Yozora #779, Yukimi Nov 13 2026: "have
 * the server cache everything so we are not so reliant on the Google Messages API ... same for
 * BlueBubbles: when you sync with it pull all messages").
 *
 * .cache/textmessaging.db (better-sqlite3; nothing else opens this file). Rows keep the provider's own
 * raw objects (BlueBubbles' message / chat JSON, Google's protojson), so the providers' normalizers
 * read them exactly as they read live answers; the columns beside them are for ordering and search.
 *
 *   chats     (account, guid) raw chat, last_date, synced (1 = every message of it is here)
 *   messages  (account, guid) chat_guid, date, raw message; FTS5 messages_fts over the text
 *   state     (account, key) value: sync cursors, "complete" marks
 */
'use strict';

const path = require('path');
const fs = require('fs');

let db = null;
let dbPath = null;

function open(cacheDir) {
    if (db) return db;
    const Database = require('better-sqlite3');
    dbPath = path.join(cacheDir || path.join(__dirname, '..', '.cache'), 'textmessaging.db');
    fs.mkdirSync(path.dirname(dbPath), { recursive: true });
    db = new Database(dbPath);
    db.pragma('journal_mode = WAL');
    db.pragma('synchronous = NORMAL');
    // the sync worker (its own process) and the server write the same file: wait for each other
    db.pragma('busy_timeout = 10000');
    db.exec(`
        CREATE TABLE IF NOT EXISTS chats (
            account TEXT NOT NULL, guid TEXT NOT NULL, raw TEXT NOT NULL, last_date INTEGER NOT NULL DEFAULT 0,
            synced INTEGER NOT NULL DEFAULT 0, updated INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (account, guid));
        CREATE INDEX IF NOT EXISTS chats_by_date ON chats (account, last_date DESC);
        CREATE TABLE IF NOT EXISTS messages (
            account TEXT NOT NULL, guid TEXT NOT NULL, chat_guid TEXT NOT NULL, date INTEGER NOT NULL DEFAULT 0,
            text TEXT NOT NULL DEFAULT '', raw TEXT NOT NULL,
            PRIMARY KEY (account, guid));
        CREATE INDEX IF NOT EXISTS messages_by_chat ON messages (account, chat_guid, date DESC);
        CREATE INDEX IF NOT EXISTS messages_by_date ON messages (account, date DESC);
        CREATE VIRTUAL TABLE IF NOT EXISTS messages_fts USING fts5(text, account UNINDEXED, guid UNINDEXED, tokenize = 'unicode61 remove_diacritics 2');
        CREATE TABLE IF NOT EXISTS state (account TEXT NOT NULL, key TEXT NOT NULL, value TEXT, PRIMARY KEY (account, key));
    `);
    return db;
}

function d() {
    if (!db) throw new Error('textMessagingStore is not open');
    return db;
}

// ---- state ----

function getState(account, key) {
    const row = d().prepare('SELECT value FROM state WHERE account = ? AND key = ?').get(account, key);
    return row ? row.value : null;
}

function setState(account, key, value) {
    d().prepare('INSERT INTO state (account, key, value) VALUES (?, ?, ?) ON CONFLICT(account, key) DO UPDATE SET value = excluded.value')
        .run(account, key, value == null ? null : String(value));
}

// ---- chats ----

function putChats(account, rows) {
    const st = d().prepare(`INSERT INTO chats (account, guid, raw, last_date, updated) VALUES (@account, @guid, @raw, @last, @now)
        ON CONFLICT(account, guid) DO UPDATE SET raw = excluded.raw, last_date = MAX(chats.last_date, excluded.last_date), updated = excluded.updated`);
    const now = Date.now();
    d().transaction((list) => {
        for (const r of list) if (r && r.guid) st.run({ account, guid: r.guid, raw: JSON.stringify(r.raw), last: Number(r.lastDate) || 0, now });
    })(rows);
}

/** The newest chats first: [{ guid, raw, lastDate, synced }]. */
function listChats(account, { limit = 500, offset = 0 } = {}) {
    return d().prepare('SELECT guid, raw, last_date, synced FROM chats WHERE account = ? ORDER BY last_date DESC LIMIT ? OFFSET ?')
        .all(account, limit, offset)
        .map((r) => ({ guid: r.guid, raw: JSON.parse(r.raw), lastDate: r.last_date, synced: !!r.synced }));
}

function getChat(account, guid) {
    const r = d().prepare('SELECT guid, raw, last_date, synced FROM chats WHERE account = ? AND guid = ?').get(account, guid);
    return r ? { guid: r.guid, raw: JSON.parse(r.raw), lastDate: r.last_date, synced: !!r.synced } : null;
}

function touchChat(account, guid, date) {
    d().prepare('UPDATE chats SET last_date = MAX(last_date, ?) WHERE account = ? AND guid = ?').run(Number(date) || 0, account, guid);
}

function markChatSynced(account, guid, synced) {
    d().prepare('UPDATE chats SET synced = ? WHERE account = ? AND guid = ?').run(synced ? 1 : 0, account, guid);
}

function deleteChat(account, guid) {
    const tx = d().transaction(() => {
        const guids = d().prepare('SELECT guid FROM messages WHERE account = ? AND chat_guid = ?').all(account, guid).map((r) => r.guid);
        const delFts = d().prepare('DELETE FROM messages_fts WHERE account = ? AND guid = ?');
        for (const g of guids) delFts.run(account, g);
        d().prepare('DELETE FROM messages WHERE account = ? AND chat_guid = ?').run(account, guid);
        d().prepare('DELETE FROM chats WHERE account = ? AND guid = ?').run(account, guid);
    });
    tx();
}

function chatCount(account) {
    return d().prepare('SELECT COUNT(*) AS n FROM chats WHERE account = ?').get(account).n;
}

// ---- messages ----

/** rows: [{ guid, chatGuid, date, text, raw }] (insert or replace; the text index follows). */
function putMessages(account, rows) {
    const db0 = d();
    const ins = db0.prepare(`INSERT INTO messages (account, guid, chat_guid, date, text, raw) VALUES (@account, @guid, @chat, @date, @text, @raw)
        ON CONFLICT(account, guid) DO UPDATE SET chat_guid = excluded.chat_guid, date = excluded.date, text = excluded.text, raw = excluded.raw`);
    const delFts = db0.prepare('DELETE FROM messages_fts WHERE account = ? AND guid = ?');
    const insFts = db0.prepare('INSERT INTO messages_fts (text, account, guid) VALUES (?, ?, ?)');
    let n = 0;
    db0.transaction((list) => {
        for (const r of list) {
            if (!r || !r.guid || !r.chatGuid) continue;
            const text = String(r.text || '');
            ins.run({ account, guid: r.guid, chat: r.chatGuid, date: Number(r.date) || 0, text, raw: JSON.stringify(r.raw) });
            delFts.run(account, r.guid);
            if (text) insFts.run(text, account, r.guid);
            n += 1;
        }
    })(rows);
    return n;
}

/** The newest `limit` messages of these chats before `before` (ms), newest first, raw. */
function listMessages(account, chatGuids, { limit = 50, before = null } = {}) {
    const guids = Array.isArray(chatGuids) ? chatGuids : [chatGuids];
    if (!guids.length) return [];
    const marks = guids.map(() => '?').join(',');
    const args = [account, ...guids];
    let sql = `SELECT raw FROM messages WHERE account = ? AND chat_guid IN (${marks})`;
    if (before != null && before !== '') { sql += ' AND date < ?'; args.push(Number(before)); }
    sql += ' ORDER BY date DESC LIMIT ?';
    args.push(limit);
    return d().prepare(sql).all(...args).map((r) => JSON.parse(r.raw));
}

function messageCount(account, chatGuid) {
    if (chatGuid) return d().prepare('SELECT COUNT(*) AS n FROM messages WHERE account = ? AND chat_guid = ?').get(account, chatGuid).n;
    return d().prepare('SELECT COUNT(*) AS n FROM messages WHERE account = ?').get(account).n;
}

function newestDate(account) {
    const r = d().prepare('SELECT MAX(date) AS m FROM messages WHERE account = ?').get(account);
    return (r && r.m) || 0;
}

/** Full-text search: [{ account, guid, chatGuid, date, raw }] newest first. */
function search(term, { account = null, limit = 40 } = {}) {
    const words = String(term || '').toLowerCase().match(/[\p{L}\p{N}]+/gu) || [];
    if (!words.length) return [];
    const q = words.map((w) => `"${w.replace(/"/g, '')}"*`).join(' AND ');
    const args = [q];
    let sql = `SELECT m.account, m.guid, m.chat_guid, m.date, m.raw FROM messages_fts f JOIN messages m ON m.account = f.account AND m.guid = f.guid WHERE messages_fts MATCH ?`;
    if (account) { sql += ' AND f.account = ?'; args.push(account); }
    sql += ' ORDER BY m.date DESC LIMIT ?';
    args.push(limit);
    return d().prepare(sql).all(...args).map((r) => ({ account: r.account, guid: r.guid, chatGuid: r.chat_guid, date: r.date, raw: JSON.parse(r.raw) }));
}

/** The guids the store holds for these chats between two dates (inclusive), for a check against the source. */
function guidsBetween(account, chatGuids, from, to) {
    const guids = Array.isArray(chatGuids) ? chatGuids : [chatGuids];
    if (!guids.length) return [];
    const marks = guids.map(() => '?').join(',');
    return d().prepare(`SELECT guid FROM messages WHERE account = ? AND chat_guid IN (${marks}) AND date >= ? AND date <= ?`)
        .all(account, ...guids, Number(from) || 0, Number(to) || 0).map((r) => r.guid);
}

/** The source no longer has these: out of the store (the source wins). */
function deleteMessages(account, guids) {
    if (!guids || !guids.length) return 0;
    const delM = d().prepare('DELETE FROM messages WHERE account = ? AND guid = ?');
    const delF = d().prepare('DELETE FROM messages_fts WHERE account = ? AND guid = ?');
    let n = 0;
    d().transaction(() => { for (const g of guids) { n += delM.run(account, g).changes; delF.run(account, g); } })();
    return n;
}

/** The raw rows of these messages (to compare with what the source says now). */
function getMessages(account, guids) {
    if (!guids || !guids.length) return new Map();
    const st = d().prepare('SELECT guid, raw FROM messages WHERE account = ? AND guid = ?');
    const out = new Map();
    for (const g of guids) { const r = st.get(account, g); if (r) out.set(g, r.raw); }
    return out;
}

/** The newest stored message of a chat: { guid, date } or null. */
function newestOf(account, chatGuid) {
    const r = d().prepare('SELECT guid, date FROM messages WHERE account = ? AND chat_guid = ? ORDER BY date DESC LIMIT 1').get(account, chatGuid);
    return r ? { guid: r.guid, date: r.date } : null;
}

function chatGuids(account) {
    return d().prepare('SELECT guid FROM chats WHERE account = ?').all(account).map((r) => r.guid);
}

/** Every chat with its sync mark and how many of its messages are here (the bridge console's list). */
function chatSyncRows(account) {
    return d().prepare(`SELECT c.guid, c.raw, c.last_date, c.synced, c.updated, (SELECT COUNT(*) FROM messages m WHERE m.account = c.account AND m.chat_guid = c.guid) AS n
        FROM chats c WHERE c.account = ? ORDER BY c.last_date DESC`).all(account)
        .map((r) => ({ guid: r.guid, raw: JSON.parse(r.raw), lastDate: r.last_date, synced: !!r.synced, updated: r.updated, messages: r.n }));
}

/** The database's size on disk (the file and its write-ahead log). */
function sizeOnDisk() {
    let n = 0;
    for (const f of [dbPath, `${dbPath}-wal`, `${dbPath}-shm`]) { try { n += fs.statSync(f).size; } catch (_) { /* none */ } }
    return n;
}

function forgetAccount(account) {
    d().transaction(() => {
        d().prepare('DELETE FROM messages_fts WHERE account = ?').run(account);
        d().prepare('DELETE FROM messages WHERE account = ?').run(account);
        d().prepare('DELETE FROM chats WHERE account = ?').run(account);
        d().prepare('DELETE FROM state WHERE account = ?').run(account);
    })();
}

function stats(account) {
    return {
        chats: chatCount(account),
        syncedChats: d().prepare('SELECT COUNT(*) AS n FROM chats WHERE account = ? AND synced = 1').get(account).n,
        messages: messageCount(account)
    };
}

function _close() { if (db) { db.close(); db = null; } }

module.exports = {
    open, getState, setState, putChats, listChats, getChat, touchChat, markChatSynced, deleteChat, chatCount,
    putMessages, listMessages, messageCount, newestDate, search, forgetAccount, stats, guidsBetween, deleteMessages,
    getMessages, newestOf, chatGuids, chatSyncRows, sizeOnDisk, _close
};
