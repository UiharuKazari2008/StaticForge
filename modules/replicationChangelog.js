/**
 * SQLite replication changelog — replication_changelog.db
 */

const path = require('path');
const crypto = require('crypto');
const {
    REPLICATION_TRACKED_SQLITE_DBS,
    REPLICATION_TRACKED_CONFIG_TYPES,
    REPLICATION_CONFIG_JSON_NAMES,
    REPLICATION_CHANGE_ORIGINS,
    normalizeReplicationConfig,
    isReplicationEnabled
} = require('./replication/replicationContracts');
const {
    AsyncSQLiteDatabase,
    registerChangelogHook,
    setChangelogApplyingRemote
} = require('./sqliteAsyncWrapper');

let globalResourcesRef = null;
let db = null;
let initialized = false;
let currentOrigin = REPLICATION_CHANGE_ORIGINS[0]; // user

const MAX_PAYLOAD_BYTES = 256 * 1024;

// Retention: rows are only useful until every replica has pulled them. With no replica
// (standalone, or master without children) they are kept for an age cap only.
const DAY_SECONDS = 24 * 60 * 60;
const DEFAULT_MAX_AGE_DAYS = 7;
const PRUNE_STARTUP_DELAY_MS = 2 * 60 * 1000;
const PRUNE_INTERVAL_MS = 6 * 60 * 60 * 1000;
const PRUNE_BATCH_ROWS = 5000;
// VACUUM only when it reclaims real space: >= 256 MiB free and >= half the file.
const VACUUM_MIN_FREE_BYTES = 256 * 1024 * 1024;
const VACUUM_MIN_FREE_RATIO = 0.5;

let pruneTimer = null;
let pruneInterval = null;
let pruneRunning = false;

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

function getReplicationConfig() {
    const secure = globalResourcesRef && globalResourcesRef.getSecureConfig
        ? globalResourcesRef.getSecureConfig()
        : null;
    return normalizeReplicationConfig(secure && secure.replication ? secure.replication : null);
}

/**
 * Standalone nodes have no replica to ship changes to, so nothing is recorded.
 * REPLICATION_CHANGELOG_RECORD_STANDALONE=1 keeps recording (e.g. while preparing a separation).
 */
function shouldRecordChanges(config) {
    if (process.env.REPLICATION_CHANGELOG_RECORD_STANDALONE === '1') return true;
    return isReplicationEnabled(config);
}

function resolveMaxAgeSeconds() {
    const days = Number(process.env.REPLICATION_CHANGELOG_MAX_AGE_DAYS);
    return (Number.isFinite(days) && days >= 0 ? days : DEFAULT_MAX_AGE_DAYS) * DAY_SECONDS;
}

/**
 * Which rows may be deleted. Returns null when nothing may be trimmed.
 * - standalone / master without children: rows older than the age cap.
 * - master with children: rows every child has pulled (lsn <= min lastSyncLsn) AND older than
 *   the age cap, so recent rows stay available for merge-conflict lookups.
 * - child / ephemeral: untouched (local user rows feed ack upload and user cargo export).
 */
function computePruneCutoff(config, nowSec, maxAgeSec) {
    const createdBefore = nowSec - maxAgeSec;
    const role = config && config.role ? config.role : 'standalone';
    if (role === 'standalone') {
        return { mode: 'standalone-age', createdBefore, maxLsn: null };
    }
    if (role !== 'master') {
        return null;
    }
    const children = Array.isArray(config.children) ? config.children : [];
    if (!children.length) {
        return { mode: 'master-no-children-age', createdBefore, maxLsn: null };
    }
    const minAck = Math.min(...children.map((c) => {
        const lsn = Number(c && c.lastSyncLsn);
        return Number.isFinite(lsn) && lsn > 0 ? lsn : 0;
    }));
    if (minAck <= 0) {
        return null;
    }
    return { mode: 'master-acked', createdBefore, maxLsn: minAck };
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
    if (!shouldRecordChanges(getReplicationConfig())) return null; // no replicas to feed

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
    if (!initialized || !shouldRecordChanges(getReplicationConfig())) return;
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
    // No checkpoints: this is a derived log (not part of checkpoint bundles), and idle-shutdown
    // full-file copies of it were filling .cache/checkpoints/replication_changelog/.
    db = new AsyncSQLiteDatabase(dbPath, { idleTimeoutMinutes: 30, enableCheckpointing: false });
    await db.initialize();
    await ensureSchema();

    wireSqliteChangelogHooks(databasesPath);
    initialized = true;
    schedulePruning();
    console.log('✓ Replication changelog ready');
    return true;
}

async function getFileStats() {
    const pageSize = (await db.get('PRAGMA page_size')).page_size;
    const pageCount = (await db.get('PRAGMA page_count')).page_count;
    const freelist = (await db.get('PRAGMA freelist_count')).freelist_count;
    return {
        pageSize,
        pageCount,
        freelist,
        totalBytes: pageSize * pageCount,
        freeBytes: pageSize * freelist
    };
}

async function vacuumIfBloated() {
    const stats = await getFileStats();
    if (stats.freeBytes < VACUUM_MIN_FREE_BYTES) return false;
    if (stats.freelist / Math.max(1, stats.pageCount) < VACUUM_MIN_FREE_RATIO) return false;
    // Build the temporary copy on disk, not in RAM (the wrapper defaults to temp_store=MEMORY).
    await db.exec('PRAGMA temp_store = FILE');
    try {
        await db.exec('VACUUM');
    } finally {
        await db.exec('PRAGMA temp_store = MEMORY');
    }
    await db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    return true;
}

/**
 * Delete changelog rows no replica still needs, then VACUUM if most of the file is free.
 * Runs 2 min after startup and every 6 h; safe to call manually.
 */
async function pruneChangelog({ nowSec = null, maxAgeSec = null, vacuum = true } = {}) {
    if (!initialized || !db) return { mode: 'not-initialized', deleted: 0, vacuumed: false };
    if (pruneRunning) return { mode: 'busy', deleted: 0, vacuumed: false };
    pruneRunning = true;
    try {
        const now = nowSec != null ? nowSec : Math.floor(Date.now() / 1000);
        const age = maxAgeSec != null ? maxAgeSec : resolveMaxAgeSeconds();
        const cutoff = computePruneCutoff(getReplicationConfig(), now, age);
        let deleted = 0;
        if (cutoff) {
            const where = cutoff.maxLsn != null ? 'created_at < ? AND lsn <= ?' : 'created_at < ?';
            const params = cutoff.maxLsn != null ? [cutoff.createdBefore, cutoff.maxLsn] : [cutoff.createdBefore];
            for (;;) {
                const result = await db.run(
                    `DELETE FROM changes WHERE lsn IN (
                        SELECT lsn FROM changes WHERE ${where} ORDER BY lsn LIMIT ${PRUNE_BATCH_ROWS}
                    )`,
                    params
                );
                deleted += result.changes || 0;
                if (!result.changes || result.changes < PRUNE_BATCH_ROWS) break;
                await new Promise((resolve) => setImmediate(resolve));
            }
        }
        const vacuumed = vacuum ? await vacuumIfBloated() : false;
        if (deleted || vacuumed) {
            console.log(`🧹 Replication changelog pruned ${deleted} row(s)${vacuumed ? ', vacuumed' : ''} (${cutoff ? cutoff.mode : 'retain'})`);
        }
        return { mode: cutoff ? cutoff.mode : 'retain', deleted, vacuumed };
    } finally {
        pruneRunning = false;
    }
}

function schedulePruning() {
    const run = () => {
        pruneChangelog().catch((error) => {
            console.warn('⚠️ Replication changelog prune failed:', error.message);
        });
    };
    pruneTimer = setTimeout(run, PRUNE_STARTUP_DELAY_MS);
    pruneInterval = setInterval(run, PRUNE_INTERVAL_MS);
    if (pruneTimer.unref) pruneTimer.unref();
    if (pruneInterval.unref) pruneInterval.unref();
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
    parseMutationInfo,
    shouldRecordChanges,
    computePruneCutoff,
    pruneChangelog
};
