const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');

let dbPath = null;
let db = null;

async function initializeApplicationAuthDatabase(databasesPath) {
    try {
        dbPath = path.join(databasesPath, 'application_auth.db');
        const cacheDir = path.dirname(dbPath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        db = new SQLiteAsyncWrapper(dbPath, 'application_auth', 30);
        await db.initialize();
        await createApplicationAuthTables();
        logger.bootSubStep('Application auth database ready');
        return true;
    } catch (error) {
        logger.error('Error initializing application auth database:', error);
        console.error('Full error stack:', error.stack);
        return false;
    }
}

async function createApplicationAuthTables() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS application_keys (
            id TEXT PRIMARY KEY,
            key_hash TEXT NOT NULL UNIQUE,
            key_prefix TEXT NOT NULL,
            app_name TEXT NOT NULL,
            user_agent TEXT NOT NULL,
            scopes TEXT NOT NULL DEFAULT '["universal"]',
            user_type TEXT NOT NULL DEFAULT 'admin',
            expires_at INTEGER,
            refresh_before_at INTEGER NOT NULL,
            original_expires_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            last_refreshed_at INTEGER,
            last_used_at INTEGER,
            revoked_at INTEGER,
            replaced_by_id TEXT,
            status TEXT NOT NULL DEFAULT 'active'
        )
    `);

        await db.exec(`
        CREATE TABLE IF NOT EXISTS application_auth_requests (
            id TEXT PRIMARY KEY,
            request_code TEXT NOT NULL UNIQUE,
            app_name TEXT NOT NULL,
            user_agent TEXT NOT NULL,
            scopes TEXT NOT NULL,
            user_type TEXT NOT NULL DEFAULT 'admin',
            expires_at INTEGER,
            refresh_interval_days INTEGER NOT NULL DEFAULT 30,
            status TEXT NOT NULL DEFAULT 'pending',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            approved_at INTEGER,
            resulting_key_id TEXT,
            key_claimed_at INTEGER,
            pending_key_plain TEXT
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS temp_access_tokens (
            id TEXT PRIMARY KEY,
            application_key_id TEXT NOT NULL,
            token_hash TEXT NOT NULL UNIQUE,
            token_prefix TEXT NOT NULL,
            scopes TEXT,
            max_uses INTEGER NOT NULL DEFAULT 1,
            uses_remaining INTEGER NOT NULL DEFAULT 1,
            expires_at INTEGER NOT NULL,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (application_key_id) REFERENCES application_keys(id)
        )
    `);

    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_keys_status ON application_keys (status)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_keys_hash ON application_keys (key_hash)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_auth_req_status ON application_auth_requests (status)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_temp_tokens_hash ON temp_access_tokens (token_hash)`);

    try {
        await db.exec(`ALTER TABLE application_auth_requests ADD COLUMN key_claimed_at INTEGER`);
    } catch (error) {
        // Column already exists
    }
    try {
        await db.exec(`ALTER TABLE application_auth_requests ADD COLUMN pending_key_plain TEXT`);
    } catch (error) {
        // Column already exists
    }
}

function getDb() {
    if (!db) {
        throw new Error('Application auth database not initialized');
    }
    return db;
}

function getCheckpointManager() {
    return db ? db.getCheckpointManager() : null;
}

module.exports = {
    initializeApplicationAuthDatabase,
    getDb,
    getCheckpointManager
};
