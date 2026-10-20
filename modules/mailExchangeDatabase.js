/**
 * Dreamscape Exchange Server database: mailboxes overlay, aliases,
 * distribution lists, signatures, keys (hash only), toggles, audit.
 *
 * Owners and intake addresses live here (seeded from code defaults).
 * Config maps overlay the DB; they do not replace it wholesale.
 */

'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const addresses = require('./mailGatewayAddresses');

let dbPath = null;
let db = null;

function initializeMailExchangeDatabase(databasesPath) {
    try {
        if (db !== null) return true;
        dbPath = path.join(databasesPath, 'mail_exchange.db');
        const dir = path.dirname(dbPath);
        if (!fs.existsSync(dir)) fs.mkdirSync(dir, { recursive: true });
        db = new Database(dbPath);
        db.pragma('journal_mode = WAL');
        db.pragma('synchronous = NORMAL');
        createTables();
        migrateMailboxKind();
        seedDirectory();
        return true;
    } catch (error) {
        console.error('Error initializing mail exchange database:', error.message);
        return false;
    }
}

function createTables() {
    db.exec(`
        CREATE TABLE IF NOT EXISTS exchange_mailbox (
            owner TEXT PRIMARY KEY,
            local_part TEXT NOT NULL,
            dept TEXT,
            display_name TEXT,
            enabled INTEGER NOT NULL DEFAULT 1,
            deleted_at TEXT,
            inbound_enabled INTEGER NOT NULL DEFAULT 1,
            outbound_enabled INTEGER NOT NULL DEFAULT 1,
            signature_html TEXT,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL,
            kind TEXT NOT NULL DEFAULT 'bot'
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_mailbox_local
            ON exchange_mailbox (local_part);

        CREATE TABLE IF NOT EXISTS exchange_address (
            local_part TEXT PRIMARY KEY,
            owner TEXT NOT NULL,
            is_primary INTEGER NOT NULL DEFAULT 0,
            created_at TEXT NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_exchange_address_owner
            ON exchange_address (owner);

        CREATE TABLE IF NOT EXISTS exchange_alias (
            local_part TEXT PRIMARY KEY,
            target TEXT NOT NULL,
            created_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS exchange_list (
            local_part TEXT PRIMARY KEY,
            name TEXT NOT NULL,
            members TEXT NOT NULL,
            created_at TEXT NOT NULL,
            updated_at TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS exchange_key (
            mailbox TEXT PRIMARY KEY,
            key_hash TEXT NOT NULL,
            created_at TEXT NOT NULL,
            revoked_at TEXT
        );

        CREATE TABLE IF NOT EXISTS exchange_setting (
            key TEXT PRIMARY KEY,
            value TEXT NOT NULL
        );

        CREATE TABLE IF NOT EXISTS exchange_audit (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            ts TEXT NOT NULL,
            actor TEXT NOT NULL,
            action TEXT NOT NULL,
            target TEXT,
            detail TEXT,
            success INTEGER NOT NULL
        );
        CREATE INDEX IF NOT EXISTS idx_exchange_audit_ts ON exchange_audit (ts);
    `);
}

function tableColumns(table) {
    return db.prepare(`PRAGMA table_info(${table})`).all().map((row) => row.name);
}

function migrateMailboxKind() {
    const cols = tableColumns('exchange_mailbox');
    if (!cols.includes('kind')) {
        db.exec(`ALTER TABLE exchange_mailbox ADD COLUMN kind TEXT NOT NULL DEFAULT 'bot'`);
    }
    const now = new Date().toISOString();
    const rows = db.prepare('SELECT owner, local_part, kind FROM exchange_mailbox').all();
    const updateKind = db.prepare('UPDATE exchange_mailbox SET kind = ? WHERE owner = ?');
    const hasAddress = db.prepare('SELECT 1 FROM exchange_address WHERE local_part = ?');
    const insertAddress = db.prepare(
        'INSERT OR IGNORE INTO exchange_address (local_part, owner, is_primary, created_at) VALUES (?, ?, 1, ?)'
    );
    for (const row of rows) {
        const expected = addresses.seedOwnerKind(row.owner);
        if (row.kind !== expected) updateKind.run(expected, row.owner);
        const locals = db.prepare('SELECT local_part FROM exchange_address WHERE owner = ?').all(row.owner);
        if (locals.length) continue;
        const local = String(row.local_part || '').trim().toLowerCase();
        if (!local || local.includes('@')) continue;
        if (!local.includes('.') && !addresses.DEFAULT_MAILBOXES[local]) continue;
        if (hasAddress.get(local)) continue;
        insertAddress.run(local, row.owner, now);
    }
}

function seedDisplayName(owner, kind) {
    if (kind === addresses.OWNER_KIND_MAILROOM) return 'Tsubame (Mailroom)';
    if (owner === 'yukimi') return 'Yukimi';
    return owner;
}

function seedDirectory() {
    const now = new Date().toISOString();
    const insertMailbox = db.prepare(`
        INSERT OR IGNORE INTO exchange_mailbox (
            owner, local_part, dept, display_name, enabled, deleted_at,
            inbound_enabled, outbound_enabled, signature_html, created_at, updated_at, kind
        ) VALUES (?, ?, ?, ?, 1, NULL, 1, 1, NULL, ?, ?, ?)
    `);
    const insertAddress = db.prepare(`
        INSERT OR IGNORE INTO exchange_address (local_part, owner, is_primary, created_at)
        VALUES (?, ?, ?, ?)
    `);
    const owners = new Set(['yukimi', ...addresses.SEED_BOT_OWNERS]);
    for (const owner of owners) {
        const primary = addresses.seedOwnerPrimary(owner);
        // Wren (and any other internal-only bot) stays a Dovecote owner via
        // SEED_BOT_OWNERS but has no public intake address until addAddress.
        if (!primary) continue;
        const kind = addresses.seedOwnerKind(owner);
        const dept = addresses.seedOwnerDept(primary);
        insertMailbox.run(owner, primary, dept, seedDisplayName(owner, kind), now, now, kind);
        insertAddress.run(primary, owner, 1, now);
    }
    for (const [local, owner] of Object.entries(addresses.DEFAULT_MAILBOXES)) {
        const primary = addresses.seedOwnerPrimary(owner);
        insertAddress.run(local, owner, local === primary ? 1 : 0, now);
    }
}

function getDb() {
    if (!db) throw new Error('Mail exchange database not initialized');
    return db;
}

function isReady() {
    return db !== null;
}

function close() {
    if (!db) return false;
    try { db.close(); } catch (_err) { /* already closed */ }
    db = null;
    dbPath = null;
    return true;
}

function resetForTests(databasesPath) {
    close();
    return initializeMailExchangeDatabase(databasesPath);
}

module.exports = {
    initializeMailExchangeDatabase,
    getDb,
    isReady,
    close,
    resetForTests,
    seedDirectory
};
