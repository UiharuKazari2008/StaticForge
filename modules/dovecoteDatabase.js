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
let attachmentsRoot = null;

function initializeDovecoteDatabase(databasesPath) {
    try {
        if (db !== null) return true;
        dbPath = path.join(databasesPath, 'dovecote.db');
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        attachmentsRoot = path.join(databasesPath, 'dovecote', 'attachments');
        createDovecoteTables();
        migrateBlobAttachmentsToFiles();
        return true;
    } catch (error) {
        console.error('Error initializing dovecote database:', error.message);
        return false;
    }
}

// One-time migration for installs that still have bytes sitting in the old
// dovecote_attachment.data BLOB column: write each attachment's bytes out
// into every message folder that references it, then drop the column.
// New installs never create that column, so this is a no-op after one run.
function migrateBlobAttachmentsToFiles() {
    const columns = db.prepare('PRAGMA table_info(dovecote_attachment)').all().map((row) => row.name);
    if (!columns.includes('data')) return;
    const dataById = new Map(
        db.prepare('SELECT id, data FROM dovecote_attachment').all().map((row) => [row.id, row.data])
    );
    const messages = db.prepare('SELECT id, attachments FROM dovecote_message WHERE attachments IS NOT NULL').all();
    for (const message of messages) {
        let ids;
        try {
            ids = JSON.parse(message.attachments);
        } catch (_err) {
            continue;
        }
        if (!Array.isArray(ids)) continue;
        for (const id of ids) {
            const data = dataById.get(id);
            if (!data) continue;
            const dir = path.join(attachmentsRoot, message.id);
            fs.mkdirSync(dir, { recursive: true });
            fs.writeFileSync(path.join(dir, id), data);
        }
    }
    db.exec('ALTER TABLE dovecote_attachment DROP COLUMN data');
}

// ALTER TABLE ... ADD COLUMN against an already-deployed dovecote.db — new
// columns must be added this way rather than folded into the CREATE TABLE,
// or existing installs would keep missing them.
function addColumnIfMissing(table, column, ddl) {
    const existing = db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
    if (!existing.includes(column)) {
        db.exec(`ALTER TABLE ${table} ADD COLUMN ${ddl}`);
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
    // paired_message_id: the id of this message's other mailbox copy (sent <-> inbox)
    // written by sendMail, used to post a read receipt back onto the sent copy without
    // a thread-wide scan. recipient_read_at: set once, the first time the paired inbox
    // copy is read — never cleared by a later "mark unread", same as a real mail client's
    // read receipt. attachments: JSON array of dovecote_attachment ids, or NULL.
    addColumnIfMissing('dovecote_message', 'paired_message_id', 'paired_message_id TEXT');
    addColumnIfMissing('dovecote_message', 'recipient_read_at', 'recipient_read_at TEXT');
    addColumnIfMissing('dovecote_message', 'attachments', 'attachments TEXT');
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
    // Only metadata lives in sqlite — the bytes live on disk under
    // .cache/dovecote/attachments/<message-id>/<attachment-id> (one copy per
    // mailbox-owning message row, so permanently deleting one message's row
    // never touches another message's copy of the same attachment id).
    // Access is enforced by checking the requesting owner holds a
    // dovecote_message row whose attachments[] includes the id
    // (modules/dovecoteMail.js getAttachment).
    db.exec(`
        CREATE TABLE IF NOT EXISTS dovecote_attachment (
            id TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            mime_type TEXT NOT NULL DEFAULT 'application/octet-stream',
            size INTEGER NOT NULL,
            created_at TEXT NOT NULL
        )
    `);
}

function getDb() {
    if (!db) throw new Error('Dovecote database not initialized');
    return db;
}

function getAttachmentsRoot() {
    if (!attachmentsRoot) throw new Error('Dovecote database not initialized');
    return attachmentsRoot;
}

function resetForTests(databasesPath) {
    db = null;
    dbPath = null;
    attachmentsRoot = null;
    return initializeDovecoteDatabase(databasesPath);
}

module.exports = {
    initializeDovecoteDatabase,
    getDb,
    getAttachmentsRoot,
    resetForTests
};
