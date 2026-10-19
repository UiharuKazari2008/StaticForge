/**
 * Dreamscape Exchange Server database: mailboxes overlay, aliases,
 * distribution lists, signatures, keys (hash only), toggles, audit.
 */

'use strict';

const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');

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
            updated_at TEXT NOT NULL
        );
        CREATE UNIQUE INDEX IF NOT EXISTS idx_exchange_mailbox_local
            ON exchange_mailbox (local_part);

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
    resetForTests
};
