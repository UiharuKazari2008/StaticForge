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

    await db.exec(`
        CREATE TABLE IF NOT EXISTS application_user_agents_seen (
            user_agent TEXT NOT NULL,
            application_key_id TEXT NOT NULL,
            source TEXT NOT NULL DEFAULT 'mcp',
            matched INTEGER NOT NULL DEFAULT 0,
            first_seen_at INTEGER NOT NULL,
            last_seen_at INTEGER NOT NULL,
            seen_count INTEGER NOT NULL DEFAULT 1,
            PRIMARY KEY (user_agent, application_key_id, source)
        )
    `);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_ua_seen_key ON application_user_agents_seen (application_key_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_app_ua_seen_matched ON application_user_agents_seen (matched)`);

    // OAuth 2.1 tables for MCP PKCE flow.
    // application_key_id is nullable: RFC 7591 DCR binds the sfapp_ key at consent.
    await db.exec(`
        CREATE TABLE IF NOT EXISTS oauth_clients (
            client_id TEXT PRIMARY KEY,
            application_key_id TEXT,
            client_name TEXT NOT NULL,
            redirect_uris TEXT NOT NULL DEFAULT '[]',
            grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
            response_types TEXT NOT NULL DEFAULT '["code"]',
            token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (application_key_id) REFERENCES application_keys(id)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS oauth_authorization_codes (
            code_hash TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            application_key_id TEXT NOT NULL,
            redirect_uri TEXT NOT NULL,
            scopes TEXT NOT NULL DEFAULT '[]',
            code_challenge TEXT NOT NULL,
            code_challenge_method TEXT NOT NULL DEFAULT 'S256',
            resource TEXT,
            expires_at INTEGER NOT NULL,
            used_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id),
            FOREIGN KEY (application_key_id) REFERENCES application_keys(id)
        )
    `);

    await db.exec(`
        CREATE TABLE IF NOT EXISTS oauth_access_tokens (
            token_hash TEXT PRIMARY KEY,
            client_id TEXT NOT NULL,
            application_key_id TEXT NOT NULL,
            scopes TEXT NOT NULL DEFAULT '[]',
            resource TEXT,
            expires_at INTEGER NOT NULL,
            refresh_token_hash TEXT,
            revoked_at INTEGER,
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
            FOREIGN KEY (client_id) REFERENCES oauth_clients(client_id),
            FOREIGN KEY (application_key_id) REFERENCES application_keys(id)
        )
    `);

    await db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_clients_key ON oauth_clients (application_key_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_codes_client ON oauth_authorization_codes (client_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_codes_expires ON oauth_authorization_codes (expires_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_client ON oauth_access_tokens (client_id)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_expires ON oauth_access_tokens (expires_at)`);
    await db.exec(`CREATE INDEX IF NOT EXISTS idx_oauth_tokens_refresh ON oauth_access_tokens (refresh_token_hash)`);

    await ensureOAuthClientsApplicationKeyIdNullable(db);
}

async function ensureOAuthClientsApplicationKeyIdNullable(database) {
    const cols = await database.all('PRAGMA table_info(oauth_clients)');
    if (!Array.isArray(cols) || cols.length === 0) return false;
    const appKeyCol = cols.find((col) => col.name === 'application_key_id');
    if (!appKeyCol || appKeyCol.notnull !== 1) return false;

    await database.exec('PRAGMA foreign_keys = OFF');
    try {
        await database.exec('BEGIN');
        await database.exec(`
            CREATE TABLE oauth_clients_new (
                client_id TEXT PRIMARY KEY,
                application_key_id TEXT,
                client_name TEXT NOT NULL,
                redirect_uris TEXT NOT NULL DEFAULT '[]',
                grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
                response_types TEXT NOT NULL DEFAULT '["code"]',
                token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
                created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (application_key_id) REFERENCES application_keys(id)
            )
        `);
        await database.exec(`
            INSERT INTO oauth_clients_new
                (client_id, application_key_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at)
            SELECT client_id, application_key_id, client_name, redirect_uris, grant_types, response_types, token_endpoint_auth_method, created_at
            FROM oauth_clients
        `);
        await database.exec('DROP TABLE oauth_clients');
        await database.exec('ALTER TABLE oauth_clients_new RENAME TO oauth_clients');
        await database.exec('CREATE INDEX IF NOT EXISTS idx_oauth_clients_key ON oauth_clients (application_key_id)');
        await database.exec('COMMIT');
    } catch (error) {
        try {
            await database.exec('ROLLBACK');
        } catch (_) {
            // already rolled back or no transaction
        }
        throw error;
    } finally {
        await database.exec('PRAGMA foreign_keys = ON');
    }
    return true;
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
    getCheckpointManager,
    ensureOAuthClientsApplicationKeyIdNullable
};
