/**
 * Replication sync HTTP + WebSocket routes — changelog pull/apply and full sync.
 */

const wsPacketRegistry = require('../../ws/wsPacketRegistry');
const replicationSync = require('../../replicationSync');
const replicationMaintenance = require('../../replicationMaintenance');
const replicationTarStream = require('../../replicationTarStream');
const replicationTokenAuth = require('../../replicationTokenAuth');
const { REPLICATION_ERROR_CODES, REPLICATION_TOKEN_SCOPES } = require('../replicationContracts');

const WS_OWNER = { owner: 'replication-sync', destructive: true };

function sendReplicationError(res, status, err) {
    res.status(status).json({
        success: false,
        error: err.message || 'Replication sync error',
        code: err.code || REPLICATION_ERROR_CODES.TRANSFER_ABORTED,
        confirmationRequired: err.confirmationRequired || null,
        timestamp: new Date().toISOString()
    });
}

function parseTransferMode(req) {
    return req.body?.transferMode || req.query?.transferMode || 'tape-stream-compressed';
}

function parseBlocksAck(req) {
    return req.body?.blocksAck || req.query?.blocksAck || null;
}

function getReplicationToken(req) {
    return req.headers['x-replication-token']
        || req.body?.replicationToken
        || req.query?.replicationToken
        || null;
}

function requireReplicationToken(req, res) {
    const token = getReplicationToken(req);
    const config = require('../../replicationService').getReplicationConfig();
    if (!replicationTokenAuth.validateReplicationToken(config, token, {
        scope: REPLICATION_TOKEN_SCOPES.CARGO_WRITE
    })) {
        sendReplicationError(res, 401, Object.assign(new Error('Invalid replication token'), {
            code: REPLICATION_ERROR_CODES.TOKEN_INVALID
        }));
        return false;
    }
    return true;
}

function assertSyncNotBlockedByMaintenance() {
    if (!replicationMaintenance.isActive()) return;
    const op = replicationMaintenance.getState().operation;
    if (op !== 'sync') {
        throw Object.assign(new Error('Replication maintenance already active'), {
            code: REPLICATION_ERROR_CODES.MAINTENANCE
        });
    }
}

function registerHttpRoutes(app, globalResources) {
    const authMiddleware = globalResources.getAuthMiddleware();
    const sync = replicationSync.initialize(globalResources);

    app.get('/replication/sync/status', authMiddleware, (req, res) => {
        try {
            res.json({
                success: true,
                data: sync.getSyncState(),
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.post('/replication/sync/begin', authMiddleware, async (req, res) => {
        try {
            assertSyncNotBlockedByMaintenance();
            const transferMode = parseTransferMode(req);
            const blocksAck = parseBlocksAck(req);
            const result = await sync.beginFullSync({ transferMode, blocksAck });
            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            const status = error.code ? 400 : 500;
            sendReplicationError(res, status, error);
        }
    });

    app.post('/replication/sync/export', async (req, res) => {
        if (!requireReplicationToken(req, res)) return;
        try {
            const body = req.body || {};
            const childInstanceId = body.childInstanceId;
            if (!childInstanceId) {
                return sendReplicationError(res, 400, new Error('childInstanceId required'));
            }
            const data = await sync.masterExportForChild({
                childInstanceId,
                sinceLsn: body.sinceLsn
            });
            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            const status = error.code ? 400 : 500;
            sendReplicationError(res, status, error);
        }
    });

    app.post('/replication/sync/ack', async (req, res) => {
        if (!requireReplicationToken(req, res)) return;
        try {
            const body = req.body || {};
            const childInstanceId = body.childInstanceId;
            if (!childInstanceId) {
                return sendReplicationError(res, 400, new Error('childInstanceId required'));
            }
            const result = await sync.masterApplyAck({
                childInstanceId,
                changes: body.changes || [],
                token: getReplicationToken(req)
            });
            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            const status = error.code ? 400 : 500;
            sendReplicationError(res, status, error);
        }
    });

    app.post('/replication/sync/partner/begin', async (req, res) => {
        if (!requireReplicationToken(req, res)) return;
        try {
            const childInstanceId = req.body?.childInstanceId;
            if (!childInstanceId) {
                return sendReplicationError(res, 400, new Error('childInstanceId required'));
            }
            const data = await sync.beginPartnerMaintenance(childInstanceId, getReplicationToken(req));
            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.post('/replication/sync/partner/complete', async (req, res) => {
        if (!requireReplicationToken(req, res)) return;
        try {
            const body = req.body || {};
            const childInstanceId = body.childInstanceId;
            if (!childInstanceId) {
                return sendReplicationError(res, 400, new Error('childInstanceId required'));
            }
            const data = await sync.completePartnerSync({
                childInstanceId,
                maxLsn: body.maxLsn,
                maintenanceSessionId: body.maintenanceSessionId || null
            });
            res.json({
                success: true,
                data,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.get('/replication/sync/blocks-warning', authMiddleware, (_req, res) => {
        res.json({
            success: true,
            data: {
                confirmation: replicationTarStream.BLOCKS_SLOW_PATH_CONFIRMATION
            },
            timestamp: new Date().toISOString()
        });
    });
}

function registerWsPackets(globalResources) {
    const sync = replicationSync.initialize(globalResources);

    wsPacketRegistry.registerWsPacket('replication_sync_begin', async (ctx) => {
        const handlers = ctx.handlers;
        const message = ctx.message;
        if (ctx.clientInfo.userType !== 'admin') {
            handlers.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            assertSyncNotBlockedByMaintenance();
        } catch (error) {
            handlers.sendError(
                ctx.ws,
                error.message || 'Replication maintenance already active',
                error.code || REPLICATION_ERROR_CODES.MAINTENANCE,
                message.requestId
            );
            return;
        }
        try {
            const data = message.data || message;
            const transferMode = data.transferMode || 'tape-stream-compressed';
            const blocksAck = data.blocksAck || null;
            const result = await sync.beginFullSync({ transferMode, blocksAck });
            handlers.sendToClient(ctx.ws, {
                type: 'replication_sync_begin_response',
                requestId: message.requestId,
                data: { success: true, ...result },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            handlers.sendError(ctx.ws, 'Sync begin failed', error.message, message.requestId);
        }
    }, WS_OWNER);

    wsPacketRegistry.registerWsPacket('replication_sync_status', async (ctx) => {
        const handlers = ctx.handlers;
        const message = ctx.message;
        handlers.sendToClient(ctx.ws, {
            type: 'replication_sync_status_response',
            requestId: message.requestId,
            data: {
                success: true,
                ...sync.getSyncState(),
                maintenance: replicationMaintenance.getState()
            },
            timestamp: new Date().toISOString()
        });
    }, { owner: 'replication-sync' });

    wsPacketRegistry.registerWsPacket('replication_sync_apply', async (ctx) => {
        const handlers = ctx.handlers;
        const message = ctx.message;
        try {
            const data = message.data || message;
            const config = require('../../replicationService').getReplicationConfig();
            const result = await sync.applyChanges(data.changes || [], {
                localInstanceId: config.instanceId,
                partnerInstanceId: data.partnerInstanceId || null
            });
            handlers.sendToClient(ctx.ws, {
                type: 'replication_sync_apply_response',
                requestId: message.requestId,
                data: { success: true, ...result },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            handlers.sendError(ctx.ws, 'Sync apply failed', error.message, message.requestId);
        }
    }, WS_OWNER);
}

function register(app, globalResources) {
    registerHttpRoutes(app, globalResources);
    registerWsPackets(globalResources);
}

module.exports = { register, registerHttpRoutes, registerWsPackets };
