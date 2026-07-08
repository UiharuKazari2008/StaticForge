/**
 * SQLite replication changelog — replication_changelog.db
 */

const path = require('path');
const crypto = require('crypto');
const {
    REPLICATION_TRACKED_SQLITE_DBS,
    REPLICATION_TRACKED_CONFIG_TYPES,
    REPLICATION_CONFIG_JSON_NAMES,
    REPLICATION_CHANGE_ORIGINS
} = require('./replication/replicationContracts');
const {
    registerChangelogHook,
    setChangelogApplyingRemote
} = require('./sqliteAsyncWrapper');

let globalResourcesRef = null;
let db = null;
let initialized = false;
let currentOrigin = REPLICATION_CHANGE_ORIGINS[0]; // user

const MAX_PAYLOAD_BYTES = 256 * 1024;

function isMutatingSql(sql) {
    if (!sql || typeof sql !== 'string') return false;
    const trimmed = sql.trim().toUpperCase();
    return trimmed.startsWith('INSERT')
        || trimmed.startsWith('UPDATE')
        || trimmed.startsWith('DELETE')
        || trimmed.startsWith('REPLACE');
}

function parseMutationInfo(sql, params) {
    const normalized = sql.trim().replace(/\s+/g, ' ');
    const upper = normalized.toUpperCase();
    let tableName = null;
    let rowKey = `mutation:${crypto.randomUUID()}`;

    if (upper.startsWith('INSERT')) {
        const match = /INSERT\s+(?:OR\s+\w+\s+)?INTO\s+[`"]?(\w+)[`"]?/i.exec(normalized);
        tableName = match ? match[1] : null;
        if (params && params.length > 0 && params[0] != null) {
            rowKey = String(params[0]);
        }
    } else if (upper.startsWith('UPDATE')) {
        const match = /UPDATE\s+[`"]?(\w+)[`"]?/i.exec(normalized);
        tableName = match ? match[1] : null;
        if (params && params.length > 0) {
            rowKey = String(params[params.length - 1]);
        }
    } else if (upper.startsWith('DELETE')) {
        const match = /(?:DELETE\s+FROM|FROM)\s+[`"]?(\w+)[`"]?/i.exec(normalized);
        tableName = match ? match[1] : null;
        if (params && params.length > 0 && params[0] != null) {
            rowKey = String(params[0]);
        }
    } else if (upper.startsWith('REPLACE')) {
        const match = /REPLACE\s+INTO\s+[`"]?(\w+)[`"]?/i.exec(normalized);
        tableName = match ? match[1] : null;
        if (params && params.length > 0 && params[0] != null) {
            rowKey = String(params[0]);
        }
    }

    return { tableName, rowKey };
}

function getInstanceId() {
    if (!globalResourcesRef) return 'unknown';
    const secure = globalResourcesRef.getSecureConfig ? globalResourcesRef.getSecureConfig() : null;
    const replication = secure && secure.replication ? secure.replication : null;
    return replication && replication.instanceId ? replication.instanceId : 'unknown';
}

async function ensureSchema() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS changes (
            lsn INTEGER PRIMARY KEY AUTOINCREMENT,
            instance_id TEXT NOT NULL,
            database_name TEXT NOT NULL,
            table_name TEXT,
            row_key TEXT NOT NULL,
            operation TEXT NOT NULL,
            payload_json TEXT,
            origin TEXT NOT NULL,
            created_at INTEGER NOT NULL,
            synced_lsn INTEGER
        )
    `);
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_replication_changes_instance
        ON changes(instance_id, lsn)
    `);
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_replication_changes_db_row
        ON changes(database_name, row_key)
    `);
}

async function recordChange({
    databaseName,
    tableName = null,
    rowKey,
    operation,
    payload = null,
    origin = null
}) {
    if (!initialized || !db) return null;
    if (origin === REPLICATION_CHANGE_ORIGINS[2]) return null; // replication — no echo

    const effectiveOrigin = origin || currentOrigin;
    if (effectiveOrigin === REPLICATION_CHANGE_ORIGINS[2]) return null;

    let payloadJson = null;
    if (payload != null) {
        payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
        if (payloadJson.length > MAX_PAYLOAD_BYTES) {
            payloadJson = JSON.stringify({
                truncated: true,
                preview: payloadJson.slice(0, 4096)
            });
        }
    }

    const createdAt = Math.floor(Date.now() / 1000);
    const result = await db.run(
        `INSERT INTO changes (
            instance_id, database_name, table_name, row_key, operation,
            payload_json, origin, created_at, synced_lsn
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, NULL)`,
        [
            getInstanceId(),
            databaseName,
            tableName,
            rowKey,
            operation,
            payloadJson,
            effectiveOrigin,
            createdAt
        ]
    );
    return result.lastID;
}

async function handleSqliteWrite(databaseName, { sql, params }) {
    if (!isMutatingSql(sql)) return;
    const { tableName, rowKey } = parseMutationInfo(sql, params);
    if (databaseName === 'vfs.db' && tableName !== 'user_files') return;

    const upper = sql.trim().toUpperCase();
    let operation = 'UPDATE';
    if (upper.startsWith('INSERT') || upper.startsWith('REPLACE')) operation = 'INSERT';
    else if (upper.startsWith('DELETE')) operation = 'DELETE';

    await recordChange({
        databaseName,
        tableName,
        rowKey,
        operation,
        payload: { sql, params: Array.isArray(params) ? params.slice(0, 32) : params },
        origin: currentOrigin
    });
}

function wireSqliteChangelogHooks(databasesPath) {
    for (const dbFile of REPLICATION_TRACKED_SQLITE_DBS) {
        const fullPath = path.join(databasesPath, dbFile);
        registerChangelogHook(fullPath, {
            databaseName: dbFile,
            // Fire-and-forget — do not block the primary SQLite write path
            onWrite: (ctx) => {
                handleSqliteWrite(dbFile, ctx).catch((error) => {
                    console.warn(`⚠️ Replication changelog hook failed for ${dbFile}:`, error.message);
                });
            }
        });
    }
}

async function recordConfigChange(configType, configData) {
    if (!REPLICATION_TRACKED_CONFIG_TYPES.includes(configType)) return null;
    const databaseName = REPLICATION_CONFIG_JSON_NAMES[configType] || `${configType}.json`;
    return recordChange({
        databaseName,
        tableName: null,
        rowKey: configType,
        operation: 'UPDATE',
        payload: configData,
        origin: currentOrigin
    });
}

async function initialize(globalResources) {
    if (initialized) return true;
    globalResourcesRef = globalResources;

    const databasesPath = globalResources.getPath('databases');
    const dbPath = path.join(databasesPath, 'replication_changelog.db');
    const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');
    db = new SQLiteAsyncWrapper(dbPath, 'replication_changelog', 30);
    await db.initialize();
    await ensureSchema();

    wireSqliteChangelogHooks(databasesPath);
    initialized = true;
    console.log('✓ Replication changelog ready');
    return true;
}

function setWriteOrigin(origin) {
    if (REPLICATION_CHANGE_ORIGINS.includes(origin)) {
        currentOrigin = origin;
    }
}

function withReplicationApply(fn) {
    const prevOrigin = currentOrigin;
    currentOrigin = REPLICATION_CHANGE_ORIGINS[2];
    setChangelogApplyingRemote(true);
    return Promise.resolve()
        .then(fn)
        .finally(() => {
            currentOrigin = prevOrigin;
            setChangelogApplyingRemote(false);
        });
}

function isInitialized() {
    return initialized;
}

function getDb() {
    return db;
}

module.exports = {
    initialize,
    recordChange,
    recordConfigChange,
    setWriteOrigin,
    withReplicationApply,
    isInitialized,
    getDb,
    isMutatingSql,
    parseMutationInfo
};
