/**
 * Dovecote mail database.
 * Internal mail between Yukimi and the bot/job mailboxes (Rook, Menma,
 * Hoshino, Ivory, Guren, Chiyo, Frost, Sala, Tifa, Pyra, Cursor, Claude).
 *
 * One row per mailbox copy: sending mail writes a 'sent' row for the sender
 * and an 'inbox' row for the recipient, linked by thread_id. Forwarding
 * writes a fresh row (new thread_id) into the target mailbox so the copy
 * never grants access back to the original thread.
 */

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

let dbPath = null;
let db = null;

function initializeDovecoteDatabase(databasesPath) {
    try {
        if (db !== null) return true;
        dbPath = path.join(databasesPath, 'dovecote.db');
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        createDovecoteTables();
        return true;
    } catch (error) {
        console.error('Error initializing dovecote database:', error.message);
        return false;
    }
}

function createDovecoteTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS dovecote_message (
            id TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            folder TEXT NOT NULL,
            archive_subfolder TEXT,
            thread_id TEXT NOT NULL,
            from_owner TEXT NOT NULL,
            to_owner TEXT NOT NULL,
            subject TEXT NOT NULL DEFAULT '',
            body TEXT NOT NULL DEFAULT '',
            format TEXT NOT NULL DEFAULT 'text',
            reply_to_id TEXT,
            fwd_from_owner TEXT,
            fwd_from_message_id TEXT,
            read INTEGER NOT NULL DEFAULT 0,
            flagged INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            deleted_at TEXT
        )
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_dovecote_message_owner_folder ON dovecote_message (owner, folder, created_at);
        CREATE INDEX IF NOT EXISTS idx_dovecote_message_thread ON dovecote_message (thread_id);
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS dovecote_audit_log (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            target_id TEXT,
            detail TEXT,
            success INTEGER NOT NULL
        )
    `);
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_dovecote_audit_actor ON dovecote_audit_log (actor, ts);
    `);
    db.exec(`
        CREATE TABLE IF NOT EXISTS dovecote_image_pref (
            owner TEXT NOT NULL,
            sender TEXT NOT NULL,
            always_load INTEGER NOT NULL DEFAULT 0,
            PRIMARY KEY (owner, sender)
        )
    `);
}

function getDb() {
    if (!db) throw new Error('Dovecote database not initialized');
    return db;
}

function resetForTests(databasesPath) {
    db = null;
    dbPath = null;
    return initializeDovecoteDatabase(databasesPath);
}

module.exports = {
    initializeDovecoteDatabase,
    getDb,
    resetForTests
};
