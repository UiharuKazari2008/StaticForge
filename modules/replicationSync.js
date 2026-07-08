/**
 * Replication changelog sync — deterministic merge apply between master and child.
 */

const fs = require('fs');
const path = require('path');
const replicationService = require('./replicationService');
const replicationMaintenance = require('./replicationMaintenance');
const replicationChangelog = require('./replicationChangelog');
const replicationPeerServer = require('./replicationPeerServer');
const SQLiteAsyncWrapper = require('./sqliteAsyncWrapper');
const replicationTokenAuth = require('./replicationTokenAuth');
const {
    REPLICATION_WS_PUSH,
    REPLICATION_ERROR_CODES,
    REPLICATION_CHANGE_ORIGINS,
    REPLICATION_TOKEN_SCOPES,
    REPLICATION_TRACKED_SQLITE_DBS,
    REPLICATION_CONFIG_JSON_NAMES,
    REPLICATION_TAR_ENTRIES,
    isReplicationTransferMode,
    canRunReplicationAutoSync,
    canRunReplicationBulkTransfer
} = require('./replication/replicationContracts');

let globalResourcesRef = null;
let initialized = false;
const applyDbCache = new Map();

const CONFIG_DB_TO_TYPE = Object.freeze(
    Object.fromEntries(
        Object.entries(REPLICATION_CONFIG_JSON_NAMES).map(([configType, dbName]) => [dbName, configType])
    )
);

let syncState = {
    active: false,
    phase: 'idle',
    partnerInstanceId: null,
    childInstanceId: null,
    appliedCount: 0,
    skippedCount: 0,
    maxLsn: 0,
    error: null,
    startedAt: null,
    completedAt: null
};

function getReplicationConfig() {
    return replicationService.getReplicationConfig();
}

function getCargoService() {
    const registered = replicationService.getCargoService();
    if (registered) return registered;
    const cargo = require('./replicationCargoService');
    if (globalResourcesRef) {
        cargo.initialize(globalResourcesRef);
    }
    return cargo;
}

function resetSyncState() {
    syncState = {
        active: false,
        phase: 'idle',
        partnerInstanceId: null,
        childInstanceId: null,
        appliedCount: 0,
        skippedCount: 0,
        maxLsn: 0,
        error: null,
        startedAt: null,
        completedAt: null
    };
}

function getSyncState() {
    return { ...syncState };
}

function setSyncPhase(phase, patch = {}) {
    syncState.phase = phase;
    Object.assign(syncState, patch);
    broadcastSyncStatus();
}

function broadcastSyncStatus(extra = {}) {
    if (!globalResourcesRef) return;
    let wsServer;
    try {
        wsServer = globalResourcesRef.getWebSocketServer();
    } catch (_e) {
        return;
    }
    if (!wsServer || typeof wsServer.broadcastToAll !== 'function') return;
    wsServer.broadcastToAll({
        type: 'replication_sync_status',
        data: {
            ...getSyncState(),
            ...extra
        },
        timestamp: new Date().toISOString()
    });
}

function broadcastSyncComplete(result) {
    if (!globalResourcesRef) return;
    let wsServer;
    try {
        wsServer = globalResourcesRef.getWebSocketServer();
    } catch (_e) {
        return;
    }
    if (!wsServer || typeof wsServer.broadcastToAll !== 'function') return;
    wsServer.broadcastToAll({
        type: 'replication_sync_complete',
        data: result,
        timestamp: new Date().toISOString()
    });
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

function assertBulkTransferAllowed() {
    const config = getReplicationConfig();
    if (!canRunReplicationBulkTransfer(config)) {
        const msg = config.connectivity === 'delegated-only'
            ? 'Sync blocked in delegated-only mode — delegation reads only'
            : 'Sync blocked in airgapped mode — use Export cargo';
        throw Object.assign(new Error(msg), {
            code: REPLICATION_ERROR_CODES.CONNECTIVITY_BLOCKED
        });
    }
}

function validateReplicationToken(token, { scope = REPLICATION_TOKEN_SCOPES.CARGO_WRITE } = {}) {
    return replicationTokenAuth.validateReplicationToken(getReplicationConfig(), token, { scope });
}

async function postMaintenanceAckToMaster(ackPayload) {
    return masterFetch('/replication/maintenance/ack', {
        method: 'POST',
        body: ackPayload
    });
}

function resolveMasterPeerKey(config) {
    return config.masterInstanceId || 'master';
}

function getLastSyncLsnForChild(childInstanceId) {
    const config = getReplicationConfig();
    const children = Array.isArray(config.children) ? config.children : [];
    const child = children.find((c) => c.instanceId === childInstanceId);
    return child && Number.isFinite(Number(child.lastSyncLsn)) ? Number(child.lastSyncLsn) : 0;
}

function getLastAppliedRemoteLsn(peerKey) {
    const config = getReplicationConfig();
    const map = config.lastAppliedRemoteLsn && typeof config.lastAppliedRemoteLsn === 'object'
        ? config.lastAppliedRemoteLsn
        : {};
    const value = map[peerKey];
    return Number.isFinite(Number(value)) ? Number(value) : 0;
}

function getLastUserAckLsn() {
    const config = getReplicationConfig();
    return Number.isFinite(Number(config.lastUserAckLsn)) ? Number(config.lastUserAckLsn) : 0;
}

function persistReplicationPatch(mutator) {
    const secure = globalResourcesRef.getSecureConfig();
    if (!secure.replication || typeof secure.replication !== 'object') {
        secure.replication = getReplicationConfig();
    }
    mutator(secure.replication);
    globalResourcesRef.configManager.saveConfig('secureConfig', secure, {
        skipCheckpoint: true,
        force: true
    });
}

function updateLastSyncLsn({ childInstanceId, masterInstanceId, lsn }) {
    const maxLsn = Number(lsn) || 0;
    const config = getReplicationConfig();

    if (config.role === 'master') {
        persistReplicationPatch((replication) => {
            const children = Array.isArray(replication.children) ? [...replication.children] : [];
            const idx = children.findIndex((c) => c.instanceId === childInstanceId);
            if (idx >= 0) {
                children[idx] = { ...children[idx], lastSyncLsn: maxLsn };
            } else {
                children.push({
                    instanceId: childInstanceId,
                    displayName: '',
                    lastUpsertAt: null,
                    lastSyncLsn: maxLsn
                });
            }
            replication.children = children;
        });
        return;
    }

    if (config.role === 'child') {
        const peerKey = masterInstanceId || resolveMasterPeerKey(config);
        persistReplicationPatch((replication) => {
            const map = replication.lastAppliedRemoteLsn && typeof replication.lastAppliedRemoteLsn === 'object'
                ? { ...replication.lastAppliedRemoteLsn }
                : {};
            map[peerKey] = maxLsn;
            replication.lastAppliedRemoteLsn = map;
        });
    }
}

function updateLastUserAckLsn(lsn) {
    persistReplicationPatch((replication) => {
        replication.lastUserAckLsn = Number(lsn) || 0;
    });
}

async function exportChangesSince(sinceLsn = 0, { peerInstanceId = null } = {}) {
    if (!replicationChangelog.isInitialized()) {
        return [];
    }
    const db = replicationChangelog.getDb();
    const params = [sinceLsn, REPLICATION_CHANGE_ORIGINS[0]];
    let sql = `
        SELECT lsn, instance_id, database_name, table_name, row_key, operation,
               payload_json, origin, created_at, synced_lsn
        FROM changes
        WHERE lsn > ?
          AND NOT (origin = ? AND instance_id = ?)
        ORDER BY lsn ASC
    `;
    params.push(peerInstanceId || '');
    if (!peerInstanceId) {
        sql = `
            SELECT lsn, instance_id, database_name, table_name, row_key, operation,
                   payload_json, origin, created_at, synced_lsn
            FROM changes
            WHERE lsn > ?
            ORDER BY lsn ASC
        `;
        params.length = 1;
    }

    const rows = await db.all(sql, params);
    return rows.map(normalizeChangeRow);
}

async function exportUserAckSince(sinceLsn = 0, instanceId = null) {
    if (!replicationChangelog.isInitialized() || !instanceId) {
        return [];
    }
    const db = replicationChangelog.getDb();
    const rows = await db.all(
        `SELECT lsn, instance_id, database_name, table_name, row_key, operation,
                payload_json, origin, created_at, synced_lsn
         FROM changes
         WHERE lsn > ? AND origin = ? AND instance_id = ?
         ORDER BY lsn ASC`,
        [sinceLsn, REPLICATION_CHANGE_ORIGINS[0], instanceId]
    );
    return rows.map(normalizeChangeRow);
}

function normalizeChangeRow(row) {
    return {
        lsn: row.lsn,
        instanceId: row.instance_id,
        databaseName: row.database_name,
        tableName: row.table_name,
        rowKey: row.row_key,
        operation: row.operation,
        payloadJson: row.payload_json,
        origin: row.origin,
        createdAt: row.created_at,
        syncedLsn: row.synced_lsn
    };
}

async function getApplyDb(databaseName) {
    if (!REPLICATION_TRACKED_SQLITE_DBS.includes(databaseName)) {
        return null;
    }
    if (!applyDbCache.has(databaseName)) {
        const dbPath = path.join(globalResourcesRef.getPath('databases'), databaseName);
        const wrapper = new SQLiteAsyncWrapper(dbPath, `repl-sync-${databaseName}`, 5);
        await wrapper.initialize();
        applyDbCache.set(databaseName, wrapper);
    }
    return applyDbCache.get(databaseName);
}

async function findLocalUserChange(databaseName, rowKey, localInstanceId) {
    if (!replicationChangelog.isInitialized()) return null;
    const db = replicationChangelog.getDb();
    return db.get(
        `SELECT lsn, origin, instance_id FROM changes
         WHERE database_name = ? AND row_key = ? AND origin = ? AND instance_id = ?
         ORDER BY lsn DESC LIMIT 1`,
        [databaseName, rowKey, REPLICATION_CHANGE_ORIGINS[0], localInstanceId]
    );
}

async function findLocalSystemChange(databaseName, rowKey, localInstanceId) {
    if (!replicationChangelog.isInitialized()) return null;
    const db = replicationChangelog.getDb();
    return db.get(
        `SELECT lsn, origin, instance_id FROM changes
         WHERE database_name = ? AND row_key = ? AND origin = ?
         ORDER BY lsn DESC LIMIT 1`,
        [databaseName, rowKey, REPLICATION_CHANGE_ORIGINS[1]]
    );
}

function resolveMergeAction(change, localInstanceId, localUserChange, localSystemChange) {
    if (change.origin === REPLICATION_CHANGE_ORIGINS[1]) {
        return { action: 'apply', reason: 'master-wins-system' };
    }
    if (change.origin === REPLICATION_CHANGE_ORIGINS[0]) {
        if (change.instanceId === localInstanceId) {
            return { action: 'skip', reason: 'already-upserted' };
        }
        if (localUserChange) {
            return { action: 'skip', reason: 'child-wins-user' };
        }
        return { action: 'apply' };
    }
    if (change.origin === REPLICATION_CHANGE_ORIGINS[2]) {
        if (localSystemChange && localSystemChange.lsn > (change.lsn || 0)) {
            return { action: 'skip', reason: 'local-system-newer' };
        }
        return { action: 'apply' };
    }
    return { action: 'apply' };
}

function shouldSkipMerge(change, localInstanceId, localUserChange) {
    const decision = resolveMergeAction(change, localInstanceId, localUserChange, null);
    return decision.action === 'skip';
}

async function applyConfigChange(databaseName, payload) {
    const configType = CONFIG_DB_TO_TYPE[databaseName];
    if (!configType || !globalResourcesRef.configManager) {
        return false;
    }
    const info = globalResourcesRef.configManager.getConfigInfo(configType);
    if (!info || !info.path) {
        return false;
    }
    const data = typeof payload === 'string' ? JSON.parse(payload) : payload;
    await fs.promises.writeFile(info.path, `${JSON.stringify(data, null, 2)}\n`, 'utf8');
    info.cache = data;
    info.lastSaved = Date.now();
    return true;
}

async function applySqliteChange(change) {
    const db = await getApplyDb(change.databaseName);
    if (!db) return false;

    let payload = change.payloadJson;
    if (typeof payload === 'string') {
        try {
            payload = JSON.parse(payload);
        } catch (_e) {
            return false;
        }
    }
    if (!payload || !payload.sql) {
        return false;
    }

    const params = Array.isArray(payload.params) ? payload.params : [];
    await db.run(payload.sql, params);
    return true;
}

async function applyOneChange(change, localInstanceId) {
    const localUserChange = await findLocalUserChange(
        change.databaseName,
        change.rowKey,
        localInstanceId
    );
    const localSystemChange = await findLocalSystemChange(
        change.databaseName,
        change.rowKey,
        localInstanceId
    );
    const mergeDecision = resolveMergeAction(change, localInstanceId, localUserChange, localSystemChange);
    if (mergeDecision.action === 'skip') {
        return { skipped: true, reason: mergeDecision.reason };
    }

    const configType = CONFIG_DB_TO_TYPE[change.databaseName];
    if (configType) {
        let payload = change.payloadJson;
        if (typeof payload === 'string') {
            payload = JSON.parse(payload);
        }
        const ok = await applyConfigChange(change.databaseName, payload);
        return ok ? { applied: true } : { skipped: true, reason: 'config-apply-failed' };
    }

    if (REPLICATION_TRACKED_SQLITE_DBS.includes(change.databaseName)) {
        const ok = await applySqliteChange(change);
        return ok ? { applied: true } : { skipped: true, reason: 'sqlite-apply-failed' };
    }

    return { skipped: true, reason: 'unsupported-database' };
}

async function applyChanges(changes, { localInstanceId, partnerInstanceId = null } = {}) {
    if (!Array.isArray(changes) || !changes.length) {
        return { applied: 0, skipped: 0, maxLsn: 0 };
    }

    let applied = 0;
    let skipped = 0;
    let maxLsn = 0;

    await replicationChangelog.withReplicationApply(async () => {
        const changelogDb = replicationChangelog.getDb();
        await changelogDb.run('BEGIN IMMEDIATE');
        try {
            for (const change of changes) {
                maxLsn = Math.max(maxLsn, change.lsn || 0);
                const result = await applyOneChange(change, localInstanceId);
                if (result.applied) {
                    applied++;
                    if (partnerInstanceId) {
                        await changelogDb.run(
                            'UPDATE changes SET synced_lsn = ? WHERE lsn = ?',
                            [maxLsn, change.lsn]
                        );
                    }
                } else {
                    skipped++;
                }
                broadcastProgress({
                    phase: 'sync-apply',
                    current: applied + skipped,
                    total: changes.length,
                    path: change.databaseName
                });
            }
            await changelogDb.run('COMMIT');
        } catch (error) {
            await changelogDb.run('ROLLBACK');
            throw error;
        }
    });

    return { applied, skipped, maxLsn };
}

async function runPostSyncHooks() {
    if (!globalResourcesRef) return;
    if (typeof globalResourcesRef.syncPreviews === 'function') {
        await globalResourcesRef.syncPreviews();
    }
    const metadataDb = globalResourcesRef.getMetadataDatabase
        ? globalResourcesRef.getMetadataDatabase()
        : null;
    if (metadataDb && typeof metadataDb.syncSearchIndexes === 'function') {
        await metadataDb.syncSearchIndexes();
    }
}

function buildMasterUrl(pathSuffix) {
    const config = getReplicationConfig();
    const base = (config.masterAccessUrl || '').replace(/\/$/, '');
    if (!base) {
        throw new Error('masterAccessUrl not configured');
    }
    return `${base}${pathSuffix}`;
}

async function masterFetch(pathSuffix, { method = 'GET', body = null, token = null } = {}) {
    const config = getReplicationConfig();
    const url = buildMasterUrl(pathSuffix);
    const headers = {
        'Content-Type': 'application/json',
        'X-Replication-Token': token || config.replicationToken || ''
    };
    const res = await fetch(url, {
        method,
        headers,
        body: body != null ? JSON.stringify(body) : undefined
    });
    const json = await res.json();
    if (!res.ok || json.success === false) {
        const err = new Error(json.error || `Master HTTP ${res.status}`);
        err.code = json.code;
        throw err;
    }
    return json.data;
}

async function sendUpsertPhase(transferMode, blocksAck) {
    const cargo = getCargoService();
    const config = getReplicationConfig();
    const upsert = await cargo.beginUpsert({
        partnerInstanceId: config.instanceId,
        transferMode,
        blocksAck
    });
    const transfer = cargo.getTransfer(upsert.manifestId);
    const host = config.masterPeerHost;
    const port = config.masterPeerPort || replicationPeerServer.DEFAULT_PEER_PORT;
    if (!host) {
        throw new Error('masterPeerHost not configured');
    }

    setSyncPhase('upsert');
    await replicationPeerServer.sendTarStream({
        host,
        port,
        beginFrame: {
            manifestId: upsert.manifestId,
            transferMode,
            totalBytes: transfer.rawBuffer ? transfer.rawBuffer.length : null,
            token: config.replicationToken,
            maintenanceSessionId: replicationMaintenance.getMaintenanceSessionId(),
            instanceId: config.instanceId
        },
        stream: transfer.stream,
        token: config.replicationToken,
        rawForHash: transfer.rawBuffer
    });

    if (!replicationMaintenance.isActive()) {
        replicationMaintenance.enterMaintenance({
            operation: 'sync',
            partnerInstanceId: config.masterInstanceId || null,
            reason: 'Replication Sync — writes disabled'
        });
    }

    return upsert;
}

async function beginPartnerMaintenance(childInstanceId, token) {
    replicationMaintenance.enterMaintenance({
        operation: 'sync',
        partnerInstanceId: childInstanceId,
        reason: 'Replication Sync — writes disabled'
    });
    return { active: true, childInstanceId };
}

async function masterExportForChild({ childInstanceId, sinceLsn = null } = {}) {
    const config = getReplicationConfig();
    if (config.role !== 'master') {
        throw Object.assign(new Error('Changelog export requires master role'), {
            code: REPLICATION_ERROR_CODES.ROLE_MISMATCH
        });
    }
    const effectiveSince = sinceLsn != null
        ? Number(sinceLsn)
        : getLastSyncLsnForChild(childInstanceId);
    const changes = await exportChangesSince(effectiveSince, { peerInstanceId: childInstanceId });
    const maxLsn = changes.reduce((max, row) => Math.max(max, row.lsn || 0), effectiveSince);
    return {
        childInstanceId,
        sinceLsn: effectiveSince,
        changes,
        maxLsn,
        count: changes.length
    };
}

async function masterApplyAck({ childInstanceId, changes = [], token } = {}) {
    const config = getReplicationConfig();
    if (config.role !== 'master') {
        throw Object.assign(new Error('Ack apply requires master role'), {
            code: REPLICATION_ERROR_CODES.ROLE_MISMATCH
        });
    }
    if (token && !validateReplicationToken(token)) {
        throw Object.assign(new Error('Invalid replication token'), {
            code: REPLICATION_ERROR_CODES.TOKEN_INVALID
        });
    }

    return applyChanges(changes, {
        localInstanceId: config.instanceId,
        partnerInstanceId: childInstanceId
    });
}

async function beginFullSync({ transferMode = 'tape-stream-compressed', blocksAck = null } = {}) {
    assertBulkTransferAllowed();
    const config = getReplicationConfig();
    if (!canRunReplicationAutoSync(config)) {
        const role = config.role || 'standalone';
        throw Object.assign(new Error(
            role === 'ephemeral'
                ? 'Full sync is not available for ephemeral role — use Export cargo'
                : 'Full sync requires child role'
        ), {
            code: REPLICATION_ERROR_CODES.ROLE_MISMATCH
        });
    }
    if (!isReplicationTransferMode(transferMode)) {
        throw Object.assign(new Error('Invalid transfer mode'), {
            code: REPLICATION_ERROR_CODES.TRANSFER_ABORTED
        });
    }
    const cargo = getCargoService();
    if (transferMode === 'blocks' && blocksAck !== cargo.BLOCKS_SLOW_PATH_CONFIRMATION) {
        throw Object.assign(new Error('Blocks mode requires slow-path confirmation'), {
            code: REPLICATION_ERROR_CODES.TRANSFER_ABORTED,
            confirmationRequired: cargo.BLOCKS_SLOW_PATH_CONFIRMATION
        });
    }

    if (syncState.active) {
        throw Object.assign(new Error('Sync already in progress'), {
            code: REPLICATION_ERROR_CODES.TRANSFER_ABORTED
        });
    }

    syncState = {
        active: true,
        phase: 'begin',
        partnerInstanceId: config.masterInstanceId || resolveMasterPeerKey(config),
        childInstanceId: config.instanceId,
        appliedCount: 0,
        skippedCount: 0,
        maxLsn: 0,
        error: null,
        startedAt: new Date().toISOString(),
        completedAt: null
    };
    broadcastSyncStatus();

    replicationMaintenance.enterMaintenance({
        operation: 'sync',
        partnerInstanceId: config.masterInstanceId || null,
        transferMode,
        reason: 'Replication Sync — writes disabled'
    });

    try {
        await masterFetch('/replication/sync/partner/begin', {
            method: 'POST',
            body: { childInstanceId: config.instanceId }
        });

        await sendUpsertPhase(transferMode, blocksAck);

        const peerKey = resolveMasterPeerKey(config);
        const sinceLsn = getLastAppliedRemoteLsn(peerKey);
        setSyncPhase('pull');

        const exportData = await masterFetch('/replication/sync/export', {
            method: 'POST',
            body: {
                childInstanceId: config.instanceId,
                sinceLsn
            }
        });

        setSyncPhase('apply');
        const applyResult = await applyChanges(exportData.changes || [], {
            localInstanceId: config.instanceId,
            partnerInstanceId: config.masterInstanceId || peerKey
        });

        syncState.appliedCount = applyResult.applied;
        syncState.skippedCount = applyResult.skipped;
        syncState.maxLsn = Math.max(applyResult.maxLsn, exportData.maxLsn || 0);

        setSyncPhase('ack');
        const ackSince = getLastUserAckLsn();
        const ackChanges = await exportUserAckSince(ackSince, config.instanceId);
        const ackResult = await masterFetch('/replication/sync/ack', {
            method: 'POST',
            body: {
                childInstanceId: config.instanceId,
                changes: ackChanges
            }
        });

        const finalLsn = Math.max(syncState.maxLsn, ackResult.maxLsn || 0);
        updateLastSyncLsn({
            childInstanceId: config.instanceId,
            masterInstanceId: config.masterInstanceId || peerKey,
            lsn: finalLsn
        });

        if (ackChanges.length) {
            const ackMax = ackChanges.reduce((max, row) => Math.max(max, row.lsn || 0), ackSince);
            updateLastUserAckLsn(ackMax);
        }

        await masterFetch('/replication/maintenance/ack', {
            method: 'POST',
            body: replicationMaintenance.buildMaintenanceAckPayload({
                childInstanceId: config.instanceId,
                maxLsn: finalLsn
            })
        });

        const completeData = await masterFetch('/replication/sync/partner/complete', {
            method: 'POST',
            body: {
                childInstanceId: config.instanceId,
                maxLsn: finalLsn,
                maintenanceSessionId: replicationMaintenance.getMaintenanceSessionId()
            }
        });

        if (completeData && completeData.maintenance) {
            replicationMaintenance.receivePartnerMaintenanceAck({
                sessionId: completeData.maintenance.maintenanceSessionId,
                partnerInstanceId: config.masterInstanceId || peerKey
            });
        }

        setSyncPhase('complete');
        syncState.completedAt = new Date().toISOString();
        syncState.active = false;

        await replicationMaintenance.exitMaintenanceAfterPartnerAck({
            reason: 'sync complete',
            waitForAck: false
        });
        await runPostSyncHooks();

        const result = {
            success: true,
            applied: syncState.appliedCount,
            skipped: syncState.skippedCount,
            maxLsn: finalLsn,
            ackApplied: ackResult.applied || 0
        };
        broadcastSyncComplete(result);
        return result;
    } catch (error) {
        syncState.error = error.message;
        syncState.active = false;
        syncState.completedAt = new Date().toISOString();
        replicationMaintenance.exitMaintenance({ reason: `sync failed: ${error.message}` });
        broadcastSyncStatus({ error: error.message });
        throw error;
    }
}

async function completePartnerSync({ childInstanceId, maxLsn = 0, maintenanceSessionId = null } = {}) {
    if (maintenanceSessionId) {
        replicationMaintenance.receivePartnerMaintenanceAck({
            sessionId: maintenanceSessionId,
            partnerInstanceId: childInstanceId
        });
    }
    if (maxLsn > 0) {
        updateLastSyncLsn({
            childInstanceId,
            masterInstanceId: getReplicationConfig().instanceId,
            lsn: maxLsn
        });
    }
    await replicationMaintenance.exitMaintenanceAfterPartnerAck({
        reason: 'sync complete',
        waitForAck: false
    });
    await runPostSyncHooks();
    return {
        completed: true,
        childInstanceId,
        maxLsn,
        maintenance: replicationMaintenance.buildMaintenanceAckPayload()
    };
}

function initialize(globalResources) {
    if (initialized) return getApi();
    globalResourcesRef = globalResources;
    replicationService.registerSyncService(getApi());
    initialized = true;
    return getApi();
}

const api = {
    initialize,
    getSyncState,
    exportChangesSince,
    exportUserAckSince,
    applyChanges,
    getLastSyncLsnForChild,
    getLastAppliedRemoteLsn,
    updateLastSyncLsn,
    beginFullSync,
    beginPartnerMaintenance,
    masterExportForChild,
    masterApplyAck,
    completePartnerSync,
    validateReplicationToken,
    runPostSyncHooks
};

function getApi() {
    return api;
}

module.exports = api;
