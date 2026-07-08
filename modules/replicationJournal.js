/**
 * Replication journal — replication_journal.db
 * Tracks user-generated cargo (gallery, references, VFS, notes, workspace filenames).
 */

const path = require('path');
const crypto = require('crypto');
const fs = require('fs');
const { REPLICATION_CHANGE_ORIGINS } = require('./replication/replicationContracts');

const JOURNAL_KINDS = Object.freeze([
    'gallery-image',
    'gallery-preview',
    'reference-upload',
    'reference-preview',
    'vibe',
    'vfs-file',
    'wiki-media',
    'workspace-filename',
    'note'
]);

let globalResourcesRef = null;
let db = null;
let initialized = false;

function getInstanceId() {
    if (!globalResourcesRef) return 'unknown';
    const secure = globalResourcesRef.getSecureConfig ? globalResourcesRef.getSecureConfig() : null;
    const replication = secure && secure.replication ? secure.replication : null;
    return replication && replication.instanceId ? replication.instanceId : 'unknown';
}

async function ensureSchema() {
    await db.exec(`
        CREATE TABLE IF NOT EXISTS journal_entries (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            instance_id TEXT NOT NULL,
            kind TEXT NOT NULL,
            entry_key TEXT NOT NULL,
            operation TEXT NOT NULL,
            checksum TEXT,
            payload_json TEXT,
            synced_at INTEGER,
            created_at INTEGER NOT NULL
        )
    `);
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_journal_unsynced
        ON journal_entries(synced_at)
        WHERE synced_at IS NULL
    `);
    await db.exec(`
        CREATE INDEX IF NOT EXISTS idx_journal_kind_key
        ON journal_entries(kind, entry_key)
    `);
}

async function initialize(globalResources) {
    if (initialized) return true;
    globalResourcesRef = globalResources;

    const databasesPath = globalResources.getPath('databases');
    const dbPath = path.join(databasesPath, 'replication_journal.db');
    const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');
    db = new SQLiteAsyncWrapper(dbPath, 'replication_journal', 30);
    await db.initialize();
    await ensureSchema();
    initialized = true;
    console.log('✓ Replication journal ready');
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

function sha256File(filePath) {
    if (!filePath || !fs.existsSync(filePath)) return null;
    const st = fs.statSync(filePath);
    if (st.size > 64 * 1024 * 1024) {
        const hash = crypto.createHash('sha256');
        return new Promise((resolve, reject) => {
            const stream = fs.createReadStream(filePath);
            stream.on('data', (chunk) => hash.update(chunk));
            stream.on('error', reject);
            stream.on('end', () => resolve(hash.digest('hex')));
        });
    }
    const hash = crypto.createHash('sha256');
    hash.update(fs.readFileSync(filePath));
    return hash.digest('hex');
}

async function recordEntry({
    kind,
    key,
    operation = 'INSERT',
    checksum = null,
    payload = null
}) {
    if (!JOURNAL_KINDS.includes(kind)) {
        throw new Error(`Invalid journal kind: ${kind}`);
    }
    if (!key) return null;
    if (!(await ensureReady())) return null;

    let payloadJson = null;
    if (payload != null) {
        payloadJson = typeof payload === 'string' ? payload : JSON.stringify(payload);
    }

    const createdAt = Math.floor(Date.now() / 1000);
    const result = await db.run(
        `INSERT INTO journal_entries (
            instance_id, kind, entry_key, operation, checksum, payload_json, synced_at, created_at
        ) VALUES (?, ?, ?, ?, ?, ?, NULL, ?)`,
        [
            getInstanceId(),
            kind,
            String(key),
            operation,
            checksum,
            payloadJson,
            createdAt
        ]
    );
    return result.lastID;
}

async function recordGallerySave(filename, { workspaceId = null, imagesDir = null } = {}) {
    if (!filename) return null;
    let checksum = null;
    if (imagesDir) {
        const digest = sha256File(path.join(imagesDir, filename));
        checksum = digest && typeof digest.then === 'function' ? await digest : digest;
    } else if (globalResourcesRef) {
        const digest = sha256File(path.join(globalResourcesRef.getPath('images'), filename));
        checksum = digest && typeof digest.then === 'function' ? await digest : digest;
    }
    return recordEntry({
        kind: 'gallery-image',
        key: filename,
        operation: 'INSERT',
        checksum,
        payload: {
            filename,
            workspaceId,
            origin: REPLICATION_CHANGE_ORIGINS[0]
        }
    });
}

async function recordGalleryPreview(baseName, previewPath = null) {
    if (!baseName) return null;
    let checksum = null;
    if (previewPath && fs.existsSync(previewPath)) {
        checksum = sha256File(previewPath);
    }
    return recordEntry({
        kind: 'gallery-preview',
        key: baseName,
        operation: 'INSERT',
        checksum,
        payload: { baseName }
    });
}

async function recordReferenceUpload(hash, { checksum = null, workspaceId = null } = {}) {
    return recordEntry({
        kind: 'reference-upload',
        key: hash,
        operation: 'INSERT',
        checksum,
        payload: { hash, workspaceId }
    });
}

async function recordVibeEntry(vibeId, { operation = 'INSERT', checksum = null, payload = null } = {}) {
    return recordEntry({
        kind: 'vibe',
        key: vibeId,
        operation,
        checksum,
        payload
    });
}

async function recordVfsFile(fileKey, { operation = 'INSERT', checksum = null, payload = null } = {}) {
    return recordEntry({
        kind: 'vfs-file',
        key: fileKey,
        operation,
        checksum,
        payload
    });
}

async function recordNote(noteId, { operation = 'INSERT', payload = null } = {}) {
    return recordEntry({
        kind: 'note',
        key: String(noteId),
        operation,
        payload
    });
}

async function recordWorkspaceFilename(filename, workspaceId, { operation = 'INSERT' } = {}) {
    return recordEntry({
        kind: 'workspace-filename',
        key: `${workspaceId}:${filename}`,
        operation,
        payload: { filename, workspaceId }
    });
}

async function getUnsyncedEntries({ limit = 5000 } = {}) {
    if (!(await ensureReady())) return [];
    return db.all(
        `SELECT * FROM journal_entries
         WHERE synced_at IS NULL
         ORDER BY id ASC
         LIMIT ?`,
        [limit]
    );
}

async function markSynced(ids) {
    if (!(await ensureReady()) || !Array.isArray(ids) || ids.length === 0) return 0;
    const now = Math.floor(Date.now() / 1000);
    const placeholders = ids.map(() => '?').join(',');
    const result = await db.run(
        `UPDATE journal_entries SET synced_at = ? WHERE id IN (${placeholders})`,
        [now, ...ids]
    );
    return result.changes;
}

async function getEntry(kind, key) {
    if (!(await ensureReady())) return null;
    return db.get(
        `SELECT * FROM journal_entries
         WHERE kind = ? AND entry_key = ?
         ORDER BY id DESC LIMIT 1`,
        [kind, String(key)]
    );
}

function isInitialized() {
    return initialized;
}

function getDb() {
    return db;
}

module.exports = {
    JOURNAL_KINDS,
    initialize,
    ensureReady,
    recordEntry,
    recordGallerySave,
    recordGalleryPreview,
    recordReferenceUpload,
    recordVibeEntry,
    recordVfsFile,
    recordNote,
    recordWorkspaceFilename,
    getUnsyncedEntries,
    markSynced,
    getEntry,
    isInitialized,
    getDb,
    sha256File
};
