/**
 * DCR register must succeed without application_key (Grok discovery+DCR).
 * Also migrates existing oauth_clients rows that still have NOT NULL.
 */

const assert = require('assert');
const fs = require('fs');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');
const { open } = require('sqlite');

const {
    initializeApplicationAuthDatabase,
    getDb,
    ensureOAuthClientsApplicationKeyIdNullable
} = require('../modules/applicationAuthDatabase');
const { McpOAuthProvider } = require('../modules/mcpOAuthProvider');

async function testRegisterWithoutAppKey() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-oauth-dcr-'));
    const ok = await initializeApplicationAuthDatabase(tmp);
    assert.ok(ok, 'application auth db should initialize');

    const cols = await getDb().all('PRAGMA table_info(oauth_clients)');
    const appKeyCol = cols.find((col) => col.name === 'application_key_id');
    assert.ok(appKeyCol, 'application_key_id column exists');
    assert.strictEqual(appKeyCol.notnull, 0, 'application_key_id must be nullable');

    const provider = new McpOAuthProvider({
        getMcpPathUuid: () => 'test-uuid',
        getConfig: () => null,
        getApplicationAuthManager: () => ({
            validateApplicationKey: async () => ({ valid: false, message: 'unused' })
        })
    });

    const result = await provider.registerClient({
        applicationKey: null,
        clientName: 'Grok Connector',
        redirectUris: ['https://grok.com/oauth/callback']
    });
    assert.strictEqual(result.success, true);
    assert.ok(String(result.client_id).startsWith('mcp_'));

    const row = await getDb().get(
        'SELECT application_key_id, client_name FROM oauth_clients WHERE client_id = ?',
        [result.client_id]
    );
    assert.strictEqual(row.application_key_id, null);
    assert.strictEqual(row.client_name, 'Grok Connector');

    const bound = await provider.bindClientApplicationKey(result.client_id, 'key-from-consent');
    assert.strictEqual(bound, true);
    const after = await getDb().get(
        'SELECT application_key_id FROM oauth_clients WHERE client_id = ?',
        [result.client_id]
    );
    assert.strictEqual(after.application_key_id, 'key-from-consent');

    const rebound = await provider.bindClientApplicationKey(result.client_id, 'other-key');
    assert.strictEqual(rebound, false);
    const still = await getDb().get(
        'SELECT application_key_id FROM oauth_clients WHERE client_id = ?',
        [result.client_id]
    );
    assert.strictEqual(still.application_key_id, 'key-from-consent');
}

async function testMigrateOldNotNullSchema() {
    const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'sf-oauth-old-'));
    const dbPath = path.join(tmp, 'old-oauth.db');
    const raw = await open({ filename: dbPath, driver: sqlite3.Database });
    await raw.exec(`
        CREATE TABLE application_keys (
            id TEXT PRIMARY KEY
        )
    `);
    await raw.run(`INSERT INTO application_keys (id) VALUES (?)`, ['key-1']);
    await raw.exec(`
        CREATE TABLE oauth_clients (
            client_id TEXT PRIMARY KEY,
            application_key_id TEXT NOT NULL,
            client_name TEXT NOT NULL,
            redirect_uris TEXT NOT NULL DEFAULT '[]',
            grant_types TEXT NOT NULL DEFAULT '["authorization_code","refresh_token"]',
            response_types TEXT NOT NULL DEFAULT '["code"]',
            token_endpoint_auth_method TEXT NOT NULL DEFAULT 'none',
            created_at INTEGER NOT NULL DEFAULT (strftime('%s', 'now'))
        )
    `);
    await raw.run(
        `INSERT INTO oauth_clients (client_id, application_key_id, client_name, redirect_uris, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['mcp_existing', 'key-1', 'Existing', '["https://grok.com/cb"]', 1]
    );

    const migrated = await ensureOAuthClientsApplicationKeyIdNullable(raw);
    assert.strictEqual(migrated, true);

    const cols = await raw.all('PRAGMA table_info(oauth_clients)');
    const appKeyCol = cols.find((col) => col.name === 'application_key_id');
    assert.strictEqual(appKeyCol.notnull, 0);

    const existing = await raw.get('SELECT * FROM oauth_clients WHERE client_id = ?', ['mcp_existing']);
    assert.strictEqual(existing.application_key_id, 'key-1');

    await raw.run(
        `INSERT INTO oauth_clients (client_id, application_key_id, client_name, redirect_uris, created_at)
         VALUES (?, ?, ?, ?, ?)`,
        ['mcp_unbound', null, 'Unbound', '["https://grok.com/cb"]', 2]
    );
    const unbound = await raw.get('SELECT application_key_id FROM oauth_clients WHERE client_id = ?', ['mcp_unbound']);
    assert.strictEqual(unbound.application_key_id, null);

    const again = await ensureOAuthClientsApplicationKeyIdNullable(raw);
    assert.strictEqual(again, false);
    await raw.close();
}

async function main() {
    console.log('Testing OAuth DCR register without application_key...');
    await testRegisterWithoutAppKey();
    console.log('Testing oauth_clients NOT NULL migration...');
    await testMigrateOldNotNullSchema();
    try {
        await getDb().close();
    } catch (_) {
        // test-only shutdown
    }
    console.log('test-mcp-oauth-register: ok');
    process.exit(0);
}

main().catch((error) => {
    console.error(error);
    process.exit(1);
});
