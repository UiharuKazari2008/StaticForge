/**
 * Replication cargo service — Upsert, ephemeral export/import, HTTPS + peer transfers.
 */

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const replicationService = require('./replicationService');
const replicationMaintenance = require('./replicationMaintenance');
const replicationChangelog = require('./replicationChangelog');
const replicationTarStream = require('./replicationTarStream');
const replicationPeerServer = require('./replicationPeerServer');
const {
    REPLICATION_TAR_ENTRIES,
    REPLICATION_ERROR_CODES,
    REPLICATION_WS_PUSH,
    REPLICATION_CHANGE_ORIGINS,
    isReplicationTransferMode,
    canRunReplicationBulkTransfer
} = require('./replication/replicationContracts');

let globalResourcesRef = null;
let initialized = false;
const activeTransfers = new Map();

function initialize(globalResources) {
    if (initialized) return getApi();
    globalResourcesRef = globalResources;
    replicationPeerServer.initialize(globalResources);
    replicationPeerServer.startPeerServer(api);
    replicationService.registerCargoService(api);
    initialized = true;
    return getApi();
}

function getReplicationConfig() {
    return replicationService.getReplicationConfig();
}

function broadcastProgress(payload) {
    if (!globalResourcesRef) return;
    let wsServer;
    try {
        wsServer = globalResourcesRef.getWebSocketServer();
    } catch (_e) {
        return;
    }
    if (!wsServer || typeof wsServer.broadcastToAll !== 'function') return;
    wsServer.broadcastToAll({
        type: REPLICATION_WS_PUSH.PROGRESS,
        data: payload,
        timestamp: new Date().toISOString()
    });
}

function requireTransferMode(transferMode, blocksAck) {
    if (!isReplicationTransferMode(transferMode)) {
        throw Object.assign(new Error('Invalid transfer mode'), {
            code: REPLICATION_ERROR_CODES.TRANSFER_ABORTED
        });
    }
    if (transferMode === 'blocks' && blocksAck !== replicationTarStream.BLOCKS_SLOW_PATH_CONFIRMATION) {
        throw Object.assign(new Error('Blocks mode requires slow-path confirmation'), {
            code: REPLICATION_ERROR_CODES.TRANSFER_ABORTED,
            confirmationRequired: replicationTarStream.BLOCKS_SLOW_PATH_CONFIRMATION
        });
    }
}

function assertReplicationBulkTransferAllowed() {
    const config = getReplicationConfig();
    if (!canRunReplicationBulkTransfer(config)) {
        const msg = config.connectivity === 'delegated-only'
            ? 'Bulk cargo to master blocked in delegated-only mode'
            : 'Network cargo blocked in airgapped mode';
        throw Object.assign(new Error(msg), {
            code: REPLICATION_ERROR_CODES.CONNECTIVITY_BLOCKED
        });
    }
}

async function exportChangelogSql({ sinceLsn = 0, instanceId = null } = {}) {
    if (!replicationChangelog.isInitialized()) {
        return '-- replication changelog not initialized\n';
    }
    const db = replicationChangelog.getDb();
    const params = [sinceLsn];
    let sql = `SELECT * FROM changes WHERE lsn > ?`;
    if (instanceId) {
        sql += ` AND instance_id = ?`;
        params.push(instanceId);
    }
    sql += ` ORDER BY lsn ASC`;
    const rows = await db.all(sql, params);
    if (!rows.length) {
        return '-- no changelog rows\n';
    }
    const lines = ['BEGIN TRANSACTION;'];
    for (const row of rows) {
        const payload = row.payload_json ? row.payload_json.replace(/'/g, "''") : null;
        lines.push(
            `INSERT INTO changes (lsn, instance_id, database_name, table_name, row_key, operation, payload_json, origin, created_at, synced_lsn) VALUES (` +
            `${row.lsn}, '${row.instance_id}', '${row.database_name}', ` +
            `${row.table_name ? `'${row.table_name}'` : 'NULL'}, '${row.row_key}', '${row.operation}', ` +
            `${payload ? `'${payload}'` : 'NULL'}, '${row.origin}', ${row.created_at}, ` +
            `${row.synced_lsn != null ? row.synced_lsn : 'NULL'});`
        );
    }
    lines.push('COMMIT;');
    return `${lines.join('\n')}\n`;
}

async function collectUserCargoFileEntries() {
    const config = getReplicationConfig();
    const rootDir = globalResourcesRef.getPath('root');
    const entries = [];
    const seen = new Set();

    const pushEntry = (relPath, tarPath) => {
        const key = tarPath || relPath;
        if (seen.has(key)) return;
        seen.add(key);
        entries.push({ path: relPath, tarPath: tarPath || `/${relPath.replace(/\\/g, '/')}` });
    };

    if (replicationChangelog.isInitialized()) {
        const db = replicationChangelog.getDb();
        const rows = await db.all(
            `SELECT * FROM changes WHERE origin = ? AND instance_id = ? ORDER BY lsn ASC`,
            [REPLICATION_CHANGE_ORIGINS[0], config.instanceId]
        );
        for (const row of rows) {
            if (row.database_name === 'metadata.db' && row.row_key) {
                pushEntry(path.join('images', row.row_key), `/images/${row.row_key}`);
                const previewName = row.row_key.replace(/\.png$/i, '.jpg');
                pushEntry(path.join('.previews', previewName), `/.previews/${previewName}`);
            }
            if (row.database_name === 'reference_metadata.db' && row.payload_json) {
                try {
                    const payload = JSON.parse(row.payload_json);
                    if (payload && payload.hash) {
                        pushEntry(path.join('.cache', 'upload', payload.hash), `/.cache/upload/${payload.hash}`);
                    }
                } catch (_e) {}
            }
            if (row.database_name === 'vfs.db' && row.table_name === 'user_files' && row.row_key) {
                let fileKey = row.row_key;
                if (row.payload_json) {
                    try {
                        const payload = JSON.parse(row.payload_json);
                        const params = payload && Array.isArray(payload.params) ? payload.params : null;
                        if (params && params[1]) {
                            fileKey = String(params[1]);
                        }
                    } catch (_e) {}
                }
                pushEntry(path.join('.cache', 'userFiles', fileKey), `/.cache/userFiles/${fileKey}`);
            }
        }
    }

    // modules/replicationJournal.js
    const replicationJournal = require('./replicationJournal');
    if (replicationJournal.isInitialized()) {
        const journalDb = replicationJournal.getDb();
        const journalRows = await journalDb.all(
            `SELECT * FROM journal_entries WHERE instance_id = ? ORDER BY id ASC`,
            [config.instanceId]
        );
        for (const row of journalRows) {
            const key = row.entry_key;
            if (!key) continue;
            if (row.kind === 'gallery-image') {
                pushEntry(path.join('images', key), `/images/${key}`);
                const previewName = key.replace(/\.png$/i, '.jpg');
                pushEntry(path.join('.previews', previewName), `/.previews/${previewName}`);
            } else if (row.kind === 'gallery-preview') {
                pushEntry(path.join('.previews', `${key}.webp`), `/.previews/${key}.webp`);
            } else if (row.kind === 'reference-upload') {
                pushEntry(path.join('.cache', 'upload', key), `/.cache/upload/${key}`);
            } else if (row.kind === 'vfs-file') {
                pushEntry(path.join('.cache', 'userFiles', key), `/.cache/userFiles/${key}`);
            } else if (row.kind === 'vibe' && row.payload_json) {
                try {
                    const payload = JSON.parse(row.payload_json);
                    if (payload && payload.previewHash) {
                        pushEntry(
                            path.join('.cache', 'preview', `${payload.previewHash}.webp`),
                            `/.cache/preview/${payload.previewHash}.webp`
                        );
                    }
                    if (payload && payload.imageHash) {
                        pushEntry(path.join('.cache', 'upload', payload.imageHash), `/.cache/upload/${payload.imageHash}`);
                    }
                } catch (_e) {}
            }
        }
    }

    return { rootDir, entries };
}

function buildBaseManifest({ operation, transferMode, partnerInstanceId = null }) {
    const config = getReplicationConfig();
    return {
        format: 1,
        manifestId: crypto.randomUUID(),
        operation,
        transferMode,
        instanceId: config.instanceId,
        displayName: config.displayName || '',
        partnerInstanceId,
        createdAt: new Date().toISOString(),
        entries: [],
        totalBytes: 0,
        bytesReceived: 0,
        streamSha256: null
    };
}

async function createExportTransfer({ operation = 'ephemeral-export', transferMode, blocksAck, sinceLsn = 0 } = {}) {
    requireTransferMode(transferMode, blocksAck);
    const { rootDir, entries } = await collectUserCargoFileEntries();
    const manifest = buildBaseManifest({ operation, transferMode });
    const changelogSql = await exportChangelogSql({ sinceLsn, instanceId: manifest.instanceId });

    if (transferMode === 'blocks') {
        const packed = await replicationTarStream.packBlocksCargo({
            rootDir,
            manifest,
            changelogSql,
            fileEntries: entries,
            onProgress: (p) => broadcastProgress(p)
        });
        const transfer = {
            manifestId: manifest.manifestId,
            manifest: packed.manifest,
            transferMode,
            blocks: packed.blocks,
            endFrame: packed.endFrame,
            operation,
            state: 'ready',
            createdAt: Date.now()
        };
        activeTransfers.set(manifest.manifestId, transfer);
        return transfer;
    }

    const packed = await replicationTarStream.packCargoEntries({
        rootDir,
        manifest,
        changelogSql,
        fileEntries: entries,
        onProgress: (p) => broadcastProgress(p)
    });

    const tarBuffer = await new Promise((resolve, reject) => {
        const chunks = [];
        packed.tarReadable.on('data', (c) => chunks.push(c));
        packed.tarReadable.on('end', () => resolve(Buffer.concat(chunks)));
        packed.tarReadable.on('error', reject);
    });

    let outBuffer = tarBuffer;
    if (transferMode === 'tape-stream-compressed') {
        outBuffer = await new Promise((resolve, reject) => {
            const compress = replicationTarStream.createCompressTransform(transferMode);
            const chunks = [];
            compress.readable.on('data', (c) => chunks.push(c));
            compress.readable.on('end', () => resolve(Buffer.concat(chunks)));
            compress.readable.on('error', reject);
            compress.writable.end(tarBuffer);
        });
    }

    packed.manifest.streamBytes = outBuffer.length;
    const streamSha256 = await replicationTarStream.sha256Buffer(outBuffer);
    packed.manifest.streamSha256 = streamSha256;

    const { Readable } = require('stream');
    const transfer = {
        manifestId: packed.manifest.manifestId,
        manifest: packed.manifest,
        transferMode,
        stream: Readable.from(outBuffer),
        rawBuffer: outBuffer,
        tarBuffer,
        operation,
        state: 'ready',
        bytesSent: 0,
        createdAt: Date.now()
    };
    activeTransfers.set(manifest.manifestId, transfer);
    return transfer;
}

function getTransfer(manifestId) {
    return activeTransfers.get(manifestId) || null;
}

function createStreamReader(transfer, offset = 0) {
    if (!transfer) {
        throw new Error('Transfer not available');
    }
    const buf = transfer.rawBuffer;
    if (buf) {
        return Readable.from(buf.slice(offset));
    }
    if (!transfer.stream) {
        throw new Error('Transfer stream not available');
    }
    return transfer.stream;
}

async function beginUpsert({ partnerInstanceId, transferMode, blocksAck } = {}) {
    assertReplicationBulkTransferAllowed();
    const config = getReplicationConfig();
    if (config.role !== 'child' && config.role !== 'ephemeral') {
        throw Object.assign(new Error('Upsert requires child or ephemeral role'), {
            code: REPLICATION_ERROR_CODES.ROLE_MISMATCH
        });
    }
    requireTransferMode(transferMode, blocksAck);
    const maintenanceState = replicationMaintenance.enterMaintenance({
        operation: 'upsert',
        partnerInstanceId,
        transferMode,
        reason: 'Replication Upsert — writes disabled'
    });
    const transfer = await createExportTransfer({
        operation: 'upsert',
        transferMode,
        blocksAck
    });
    return {
        manifestId: transfer.manifestId,
        manifest: transfer.manifest,
        transferMode,
        maintenanceOwned: maintenanceState && !maintenanceState.alreadyActive
    };
}

async function beginImport({ transferMode, blocksAck, operation = 'import', manifestId = null } = {}) {
    const config = getReplicationConfig();
    if (config.role !== 'master' && operation !== 'ephemeral-import' && operation !== 'peer-import') {
        throw Object.assign(new Error('Import cargo requires master role'), {
            code: REPLICATION_ERROR_CODES.ROLE_MISMATCH
        });
    }
    requireTransferMode(transferMode, blocksAck);
    const maintenanceState = replicationMaintenance.enterMaintenance({
        operation,
        transferMode,
        reason: 'Replication cargo import — writes disabled'
    });
    const manifest = buildBaseManifest({ operation, transferMode });
    if (manifestId) {
        manifest.manifestId = manifestId;
    }
    const transfer = {
        manifestId: manifest.manifestId,
        manifest,
        transferMode,
        operation,
        state: 'receiving',
        bytesReceived: 0,
        chunks: [],
        createdAt: Date.now(),
        maintenanceOwned: maintenanceState && !maintenanceState.alreadyActive
    };
    activeTransfers.set(manifest.manifestId, transfer);
    return transfer;
}

async function appendImportBytes(manifestId, chunk, offset = null) {
    const transfer = activeTransfers.get(manifestId);
    if (!transfer || transfer.state !== 'receiving') {
        throw new Error('No active import transfer');
    }
    if (offset != null && offset !== transfer.bytesReceived) {
        throw Object.assign(new Error('Resume offset mismatch'), {
            code: REPLICATION_ERROR_CODES.TRANSFER_ABORTED,
            expectedOffset: transfer.bytesReceived,
            receivedOffset: offset
        });
    }
    transfer.chunks.push(chunk);
    transfer.bytesReceived += chunk.length;
    transfer.manifest.bytesReceived = transfer.bytesReceived;
    broadcastProgress({
        phase: 'transfer',
        current: transfer.bytesReceived,
        total: transfer.manifest.totalBytes || 0,
        path: manifestId
    });
    return { bytesReceived: transfer.bytesReceived };
}

async function applyChangelogSql(changelogSql) {
    if (!changelogSql || !changelogSql.trim() || changelogSql.trim() === '-- no changelog rows') {
        return { applied: 0 };
    }
    if (!replicationChangelog.isInitialized()) {
        return { applied: 0, skipped: true };
    }
    const db = replicationChangelog.getDb();
    return replicationChangelog.withReplicationApply(async () => {
        const statements = changelogSql
            .split(';')
            .map((s) => s.trim())
            .filter((s) => s && !s.startsWith('--'));
        let applied = 0;
        for (const stmt of statements) {
            if (/^(BEGIN|COMMIT|ROLLBACK)/i.test(stmt)) continue;
            await db.run(stmt);
            applied++;
        }
        return { applied };
    });
}

async function applyExtractedCargo({ manifest, changelogSql, destRoot }) {
    const config = getReplicationConfig();
    const rootDir = globalResourcesRef.getPath('root');
    const response = {
        manifestId: manifest.manifestId,
        accepted: [],
        skipped: [],
        conflicts: []
    };

    broadcastProgress({ phase: 'apply', current: 0, total: manifest.entries?.length || 0, path: '' });

    for (const entry of manifest.entries || []) {
        const rel = (entry.sourcePath || entry.path || '').replace(/^\//, '');
        const src = path.join(destRoot || rootDir, (entry.path || '').replace(/^\//, ''));
        const dest = path.join(rootDir, rel);
        if (!fs.existsSync(src)) {
            response.skipped.push({ path: rel, reason: 'missing' });
            continue;
        }
        await fs.promises.mkdir(path.dirname(dest), { recursive: true });
        await fs.promises.copyFile(src, dest);
        response.accepted.push({ path: rel, bytes: entry.bytes || 0 });
    }

    const changelogResult = await applyChangelogSql(changelogSql);
    response.changelog = changelogResult;

    if (manifest.operation === 'upsert' && manifest.partnerInstanceId) {
        const children = Array.isArray(config.children) ? [...config.children] : [];
        const idx = children.findIndex((c) => c.instanceId === manifest.instanceId);
        if (idx >= 0) {
            children[idx] = { ...children[idx], lastUpsertAt: new Date().toISOString() };
        }
        const secure = globalResourcesRef.getSecureConfig();
        secure.replication.children = children;
        globalResourcesRef.configManager.saveConfig('secureConfig', secure, { skipCheckpoint: true, force: true });
    }

    broadcastProgress({
        phase: 'apply',
        current: manifest.entries?.length || 0,
        total: manifest.entries?.length || 0,
        path: 'complete'
    });

    return response;
}

function exitImportMaintenanceIfOwned(transfer, reason) {
    if (transfer && transfer.maintenanceOwned) {
        replicationMaintenance.markLocalWorkComplete({ reason });
    }
}

async function completeImport(manifestId, { streamSha256 = null } = {}) {
    const transfer = activeTransfers.get(manifestId);
    if (!transfer) {
        throw new Error('Transfer not found');
    }

    const raw = Buffer.concat(transfer.chunks || []);
    if (streamSha256) {
        const actual = await replicationTarStream.sha256Buffer(raw);
        if (actual !== streamSha256) {
            exitImportMaintenanceIfOwned(transfer, 'checksum mismatch');
            activeTransfers.delete(manifestId);
            throw Object.assign(new Error('Cargo stream checksum mismatch'), {
                code: REPLICATION_ERROR_CODES.TRANSFER_ABORTED
            });
        }
    }

    const tempDir = path.join(globalResourcesRef.getPath('tempDownload'), `cargo-${manifestId}`);
    await fs.promises.mkdir(tempDir, { recursive: true });

    let manifest;
    let changelogSql;
    try {
        if (transfer.transferMode === 'blocks') {
            let payload;
            try {
                payload = JSON.parse(raw.toString('utf8'));
            } catch (_e) {
                payload = { manifest: transfer.manifest, blocks: transfer.blocks || [] };
            }
            manifest = payload.manifest || transfer.manifest;
            changelogSql = '-- no changelog\n';
            const manifestEntry = payload.manifest;
            if (manifestEntry && !manifest) manifest = manifestEntry;
            if (payload.blocks && Array.isArray(payload.blocks)) {
                for (const block of payload.blocks) {
                    if (block.type !== replicationTarStream.PEER_FRAME.BLOCK_FILE || !block.dataBase64) continue;
                    const rel = (block.path || '').replace(/^\//, '');
                    const outPath = path.join(tempDir, rel);
                    await fs.promises.mkdir(path.dirname(outPath), { recursive: true });
                    await fs.promises.writeFile(outPath, Buffer.from(block.dataBase64, 'base64'));
                }
            }
            const manifestJsonBlock = payload.blocks?.find((b) => b.path === REPLICATION_TAR_ENTRIES.MANIFEST);
            if (manifestJsonBlock?.dataBase64) {
                try {
                    manifest = JSON.parse(Buffer.from(manifestJsonBlock.dataBase64, 'base64').toString('utf8'));
                } catch (_e) {}
            }
            const changelogBlock = payload.blocks?.find((b) => b.path === REPLICATION_TAR_ENTRIES.CHANGELOG_SQL);
            if (changelogBlock?.dataBase64) {
                changelogSql = Buffer.from(changelogBlock.dataBase64, 'base64').toString('utf8');
            }
        } else {
            const { Readable } = require('stream');
            const result = await replicationTarStream.extractCargoFromStream(
                Readable.from(raw),
                {
                    transferMode: transfer.transferMode,
                    destRoot: tempDir,
                    onProgress: (p) => broadcastProgress(p)
                }
            );
            manifest = result.manifest || transfer.manifest;
            changelogSql = result.changelogSql;
        }

        const response = await applyExtractedCargo({ manifest, changelogSql, destRoot: tempDir });
        response.streamSha256 = streamSha256;
        transfer.state = 'complete';
        transfer.response = response;
        exitImportMaintenanceIfOwned(transfer, 'import complete');
        return response;
    } finally {
        activeTransfers.delete(manifestId);
        fs.promises.rm(tempDir, { recursive: true, force: true }).catch(() => {});
    }
}

async function handlePeerReceiveComplete({ manifestId, transferMode, raw, expectedSha256 }) {
    const rawBuffer = Buffer.isBuffer(raw) ? raw : Buffer.concat([]);
    if (expectedSha256) {
        const actual = await replicationTarStream.sha256Buffer(rawBuffer);
        if (actual !== expectedSha256) {
            throw new Error('Peer cargo checksum mismatch');
        }
    }

    const transfer = await beginImport({
        transferMode,
        operation: 'peer-import',
        manifestId
    });
    transfer.chunks = [rawBuffer];
    transfer.bytesReceived = rawBuffer.length;
    activeTransfers.set(manifestId, transfer);
    return completeImport(manifestId, { streamSha256: expectedSha256 });
}

async function exportToFile({ outPath, transferMode, blocksAck, operation = 'ephemeral-export' } = {}) {
    const transfer = await createExportTransfer({ operation, transferMode, blocksAck });
    if (transferMode === 'blocks') {
        const payload = {
            manifest: transfer.manifest,
            blocks: transfer.blocks,
            endFrame: transfer.endFrame
        };
        await fs.promises.writeFile(outPath, JSON.stringify(payload, null, 2));
        return { manifestId: transfer.manifestId, outPath, manifest: transfer.manifest };
    }

    const chunks = [];
    await new Promise((resolve, reject) => {
        transfer.stream.on('data', (c) => chunks.push(c));
        transfer.stream.on('end', resolve);
        transfer.stream.on('error', reject);
    });
    await fs.promises.writeFile(outPath, Buffer.concat(chunks));
    const sha256 = await replicationTarStream.sha256Buffer(Buffer.concat(chunks));
    const manifestPath = outPath.replace(/\.(tar|zst|tar\.zst)$/i, '.manifest.json');
    transfer.manifest.streamSha256 = sha256;
    await fs.promises.writeFile(manifestPath, JSON.stringify(transfer.manifest, null, 2));
    return { manifestId: transfer.manifestId, outPath, manifestPath, manifest: transfer.manifest, sha256 };
}

async function importFromFile({ filePath, transferMode, blocksAck } = {}) {
    const transfer = await beginImport({ transferMode, blocksAck, operation: 'ephemeral-import' });
    const st = await fs.promises.stat(filePath);

    if (transferMode === 'blocks') {
        const raw = await fs.promises.readFile(filePath);
        transfer.chunks = [raw];
        transfer.bytesReceived = st.size;
        transfer.transferMode = transferMode;
        activeTransfers.set(transfer.manifestId, transfer);
        return completeImport(transfer.manifestId);
    }

    const raw = await fs.promises.readFile(filePath);
    transfer.chunks = [raw];
    transfer.bytesReceived = st.size;
    transfer.transferMode = transferMode;
    activeTransfers.set(transfer.manifestId, transfer);
    return completeImport(transfer.manifestId);
}

async function sendUpsertToMaster({ transferMode, blocksAck } = {}) {
    assertReplicationBulkTransferAllowed();
    const config = getReplicationConfig();
    const upsert = await beginUpsert({
        partnerInstanceId: config.instanceId,
        transferMode,
        blocksAck
    });
    const transfer = getTransfer(upsert.manifestId);
    const host = config.masterPeerHost;
    const port = config.masterPeerPort || replicationPeerServer.DEFAULT_PEER_PORT;
    if (!host) {
        throw new Error('masterPeerHost not configured');
    }

    await replicationPeerServer.sendTarStream({
        host,
        port,
        beginFrame: {
            manifestId: upsert.manifestId,
            transferMode,
            totalBytes: transfer.rawBuffer ? transfer.rawBuffer.length : null,
            maintenanceSessionId: replicationMaintenance.getMaintenanceSessionId(),
            instanceId: config.instanceId
        },
        stream: transfer.stream,
        token: config.replicationToken,
        rawForHash: transfer.rawBuffer
    });

    if (upsert.maintenanceOwned) {
        replicationMaintenance.markLocalWorkComplete({ reason: 'upsert sent' });
        await replicationMaintenance.exitMaintenanceAfterPartnerAck({
            reason: 'upsert complete',
            waitForAck: false
        });
    }
    return upsert;
}

function cancelTransfer(manifestId) {
    const transfer = activeTransfers.get(manifestId);
    activeTransfers.delete(manifestId);
    if (transfer && transfer.maintenanceOwned) {
        replicationMaintenance.exitMaintenance({ reason: 'transfer cancelled' });
    } else if (replicationMaintenance.isActive()) {
        const op = replicationMaintenance.getState().operation;
        if (op === 'upsert' || op === 'import' || op === 'peer-import' || op === 'ephemeral-import') {
            replicationMaintenance.exitMaintenance({ reason: 'transfer cancelled' });
        }
    }
}

const api = {
    initialize,
    BLOCKS_SLOW_PATH_CONFIRMATION: replicationTarStream.BLOCKS_SLOW_PATH_CONFIRMATION,
    createExportTransfer,
    getTransfer,
    createStreamReader,
    beginUpsert,
    beginImport,
    appendImportBytes,
    completeImport,
    handlePeerReceiveComplete,
    exportToFile,
    importFromFile,
    sendUpsertToMaster,
    cancelTransfer,
    exportChangelogSql,
    collectUserCargoFileEntries,
    getActiveTransfers: () => Array.from(activeTransfers.values()).map((t) => ({
        manifestId: t.manifestId,
        operation: t.operation,
        transferMode: t.transferMode,
        state: t.state,
        bytesReceived: t.bytesReceived || 0
    }))
};

function getApi() {
    return api;
}

module.exports = api;
