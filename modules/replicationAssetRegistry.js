/**
 * Blob ownership registry — local / remote / pending-fetch per addressable asset.
 */

const path = require('path');
const { DEFAULT_CLONE_PROFILE } = require('./replication/replicationContracts');

const REGISTRY_KINDS = Object.freeze([
    'gallery-image',
    'gallery-preview',
    'reference-upload',
    'reference-preview',
    'vibe',
    'vfs-file',
    'wiki-media'
]);

const STORAGE_VALUES = Object.freeze(['local', 'remote', 'pending-fetch']);

let globalResourcesRef = null;
let db = null;
let initialized = false;

async function ensureSchema() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS asset_registry (
            kind TEXT NOT NULL,
            entry_key TEXT NOT NULL,
            storage TEXT NOT NULL,
            origin_instance_id TEXT,
            checksum TEXT,
            updated_at INTEGER NOT NULL,
            PRIMARY KEY (kind, entry_key)
        )
    `);
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_asset_registry_storage
        ON asset_registry(storage)
    `);
}

async function initialize(globalResources) {
    if (initialized) return true;
    globalResourcesRef = globalResources;

    const databasesPath = globalResources.getPath('databases');
    const dbPath = path.join(databasesPath, 'replication_asset_registry.db');
    const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');
    db = new SQLiteAsyncWrapper(dbPath, 'replication_asset_registry', 30);
    await db.initialize();
    await ensureSchema();
    initialized = true;
    console.log('✓ Replication asset registry ready');
    return true;
}

async function ensureReady() {
    if (initialized) return true;
    try {
        const globalResources = require('./globalResources');
        if (!globalResources.initialized) return false;
        await initialize(globalResources);
        return true;
    } catch (_err) {
        return false;
    }
}

function normalizeStorage(value) {
    return STORAGE_VALUES.includes(value) ? value : 'local';
}

async function setOwnership({
    kind,
    key,
    storage = 'local',
    originInstanceId = null,
    checksum = null
}) {
    if (!REGISTRY_KINDS.includes(kind) || !key) return null;
    if (!(await ensureReady())) return null;

    const updatedAt = Math.floor(Date.now() / 1000);
    await db.run(
        `INSERT INTO asset_registry (kind, entry_key, storage, origin_instance_id, checksum, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         ON CONFLICT(kind, entry_key) DO UPDATE SET
            storage = excluded.storage,
            origin_instance_id = excluded.origin_instance_id,
            checksum = excluded.checksum,
            updated_at = excluded.updated_at`,
        [
            kind,
            String(key),
            normalizeStorage(storage),
            originInstanceId,
            checksum,
            updatedAt
        ]
    );
    return { kind, key: String(key), storage: normalizeStorage(storage), originInstanceId, checksum };
}

async function getOwnership(kind, key) {
    if (!(await ensureReady())) return null;
    const row = await db.get(
        'SELECT * FROM asset_registry WHERE kind = ? AND entry_key = ?',
        [kind, String(key)]
    );
    if (!row) return null;
    return {
        key: row.entry_key,
        kind: row.kind,
        storage: row.storage,
        originInstanceId: row.origin_instance_id,
        checksum: row.checksum,
        updatedAt: row.updated_at
    };
}

function mapOwnershipRow(row) {
    return {
        key: row.entry_key,
        kind: row.kind,
        storage: row.storage,
        originInstanceId: row.origin_instance_id,
        checksum: row.checksum,
        updatedAt: row.updated_at
    };
}

async function getOwnershipBatch(entries) {
    const result = new Map();
    if (!Array.isArray(entries) || entries.length === 0 || !(await ensureReady())) {
        return result;
    }

    const keysByKind = new Map();
    for (const entry of entries) {
        if (!entry || !REGISTRY_KINDS.includes(entry.kind) || !entry.key) {
            continue;
        }
        if (!keysByKind.has(entry.kind)) {
            keysByKind.set(entry.kind, new Set());
        }
        keysByKind.get(entry.kind).add(String(entry.key));
    }

    const chunkSize = 500;
    for (const [kind, keySet] of keysByKind.entries()) {
        const keys = [...keySet];
        for (let offset = 0; offset < keys.length; offset += chunkSize) {
            const chunk = keys.slice(offset, offset + chunkSize);
            const placeholders = chunk.map(() => '?').join(', ');
            const rows = await db.all(
                `SELECT * FROM asset_registry WHERE kind = ? AND entry_key IN (${placeholders})`,
                [kind, ...chunk]
            );
            for (const row of rows) {
                result.set(`${row.kind}::${row.entry_key}`, mapOwnershipRow(row));
            }
        }
    }

    return result;
}

async function markPendingFetch(kind, key) {
    return setOwnership({ kind, key, storage: 'pending-fetch' });
}

async function promoteToLocal(kind, key, checksum = null) {
    const existing = await getOwnership(kind, key);
    return setOwnership({
        kind,
        key,
        storage: 'local',
        originInstanceId: existing ? existing.originInstanceId : null,
        checksum: checksum || (existing ? existing.checksum : null)
    });
}

function resolveRemoteKindFromPath(relPath) {
    const normalized = relPath.replace(/\\/g, '/');
    if (normalized.startsWith('images/')) return { kind: 'gallery-image', key: path.basename(normalized) };
    if (normalized.startsWith('.previews/') || normalized.includes('/.previews/')) {
        return { kind: 'gallery-preview', key: path.basename(normalized, path.extname(normalized)) };
    }
    if (normalized.includes('.cache/upload/')) {
        return { kind: 'reference-upload', key: path.basename(normalized) };
    }
    if (normalized.includes('.cache/vibe/')) {
        return { kind: 'vibe', key: path.basename(normalized, path.extname(normalized)) };
    }
    if (normalized.includes('.cache/userFiles/')) {
        return { kind: 'vfs-file', key: normalized.replace(/^.*\.cache\/userFiles\//, '') };
    }
    if (normalized.includes('/wiki/') || normalized.includes('tag_wiki')) {
        return { kind: 'wiki-media', key: normalized };
    }
    return null;
}

async function seedFromManifest(manifest) {
    if (!manifest || typeof manifest !== 'object') return { seeded: 0 };
    if (!(await ensureReady())) return { seeded: 0 };

    const cloneProfile = {
        ...DEFAULT_CLONE_PROFILE,
        ...(manifest.cloneProfile && typeof manifest.cloneProfile === 'object' ? manifest.cloneProfile : {})
    };
    const originInstanceId = manifest.masterInstanceId || manifest.instanceId || null;
    let seeded = 0;

    const entries = Array.isArray(manifest.entries) ? manifest.entries : [];
    for (const entry of entries) {
        const relPath = entry.path || entry.relPath;
        if (!relPath) continue;

        const mapped = resolveRemoteKindFromPath(relPath);
        if (!mapped) continue;

        let storage = 'local';
        if (mapped.kind === 'gallery-image' && !cloneProfile.workspaceImages) storage = 'remote';
        else if (mapped.kind === 'gallery-preview' && !cloneProfile.previewCache) storage = 'remote';
        else if (mapped.kind === 'reference-upload' && !cloneProfile.referenceBlobs) storage = 'remote';
        else if (mapped.kind === 'vibe' && !cloneProfile.referenceBlobs) storage = 'remote';
        else if (mapped.kind === 'vfs-file' && !cloneProfile.vfsUserFiles) storage = 'remote';
        else if (mapped.kind === 'wiki-media' && !cloneProfile.wikiMedia) storage = 'remote';

        await setOwnership({
            kind: mapped.kind,
            key: mapped.key,
            storage,
            originInstanceId,
            checksum: entry.sha256 || entry.checksum || null
        });
        seeded++;
    }

    return { seeded, cloneProfile };
}

async function listByStorage(storage, { limit = 5000 } = {}) {
    if (!(await ensureReady())) return [];
    return db.all(
        'SELECT * FROM asset_registry WHERE storage = ? ORDER BY updated_at DESC LIMIT ?',
        [normalizeStorage(storage), limit]
    );
}

function isInitialized() {
    return initialized;
}

function getDb() {
    return db;
}

module.exports = {
    REGISTRY_KINDS,
    STORAGE_VALUES,
    initialize,
    ensureReady,
    setOwnership,
    getOwnership,
    getOwnershipBatch,
    markPendingFetch,
    promoteToLocal,
    seedFromManifest,
    listByStorage,
    resolveRemoteKindFromPath,
    isInitialized,
    getDb
};
