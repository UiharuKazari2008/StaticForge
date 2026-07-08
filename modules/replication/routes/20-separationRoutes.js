/**
 * Replication separation HTTP + WebSocket routes.
 */

const fs = require('fs');
const path = require('path');
const wsPacketRegistry = require('../../ws/wsPacketRegistry');
const replicationSeparation = require('../../replicationSeparation');
const replicationMaintenance = require('../../replicationMaintenance');
const { REPLICATION_ERROR_CODES } = require('../replicationContracts');

const WS_OWNER = { owner: 'replication-separation', destructive: true };

function sendJson(res, status, body) {
    res.status(status).json(body);
}

function requireAdmin(req, res) {
    if (req.userType !== 'admin') {
        sendJson(res, 403, { success: false, error: 'Admin access required' });
        return false;
    }
    return true;
}

function registerHttpRoutes(app, globalResources) {
    const authMiddleware = globalResources.getAuthMiddleware();
    replicationSeparation.initialize(globalResources);

    app.post('/replication/separation/prepare', authMiddleware, (req, res) => {
        if (!requireAdmin(req, res)) return;
        if (replicationMaintenance.isActive()) {
            return sendJson(res, 409, {
                success: false,
                code: REPLICATION_ERROR_CODES.MAINTENANCE,
                error: 'Replication maintenance already active'
            });
        }

        try {
            const body = req.body || {};
            const jobId = replicationSeparation.startSeparationJob({
                cloneProfile: body.cloneProfile,
                transferMode: body.transferMode,
                childDisplayName: body.childDisplayName,
                childInstanceId: body.childInstanceId,
                masterAccessUrl: body.masterAccessUrl,
                masterWsUrl: body.masterWsUrl,
                masterPeerHost: body.masterPeerHost,
                masterPeerPort: body.masterPeerPort,
                connectivity: body.connectivity,
                outputDir: body.outputDir
            });
            sendJson(res, 202, {
                success: true,
                data: { jobId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendJson(res, 500, { success: false, error: error.message || 'Failed to start separation' });
        }
    });

    app.get('/replication/separation/status/:jobId', authMiddleware, (req, res) => {
        try {
            const job = replicationSeparation.getSeparationJob(req.params.jobId);
            if (!job) {
                return sendJson(res, 404, { success: false, error: 'Job not found' });
            }
            sendJson(res, 200, {
                success: true,
                data: job,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendJson(res, 500, { success: false, error: error.message || 'Failed to get job status' });
        }
    });

    app.get('/replication/separation/manifest/:manifestId', authMiddleware, (req, res) => {
        try {
            const paths = replicationSeparation.getBundlePathsForManifest(req.params.manifestId);
            if (!paths.manifestPath || !fs.existsSync(paths.manifestPath)) {
                return sendJson(res, 404, { success: false, error: 'Manifest not found' });
            }
            const manifest = JSON.parse(fs.readFileSync(paths.manifestPath, 'utf8'));
            sendJson(res, 200, {
                success: true,
                data: manifest,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendJson(res, 500, { success: false, error: error.message || 'Failed to read manifest' });
        }
    });

    app.get('/replication/separation/download/:manifestId', authMiddleware, (req, res) => {
        if (!requireAdmin(req, res)) return;
        try {
            const paths = replicationSeparation.getBundlePathsForManifest(req.params.manifestId);
            const job = [...paths.archiveCandidates]
                .map((name) => path.join(globalResources.getPath('root'), name))
                .find((full) => fs.existsSync(full));

            if (!job) {
                return sendJson(res, 404, { success: false, error: 'Archive not found' });
            }

            const fileName = path.basename(job);
            res.setHeader('Content-Type', fileName.endsWith('.zst')
                ? 'application/zstd'
                : 'application/x-tar');
            res.setHeader('Content-Disposition', `attachment; filename="${fileName}"`);
            fs.createReadStream(job).pipe(res);
        } catch (error) {
            sendJson(res, 500, { success: false, error: error.message || 'Download failed' });
        }
    });

    app.post('/replication/separation/bootstrap/preview', authMiddleware, (req, res) => {
        if (!requireAdmin(req, res)) return;
        try {
            const { manifestPath, archivePath } = req.body || {};
            if (!manifestPath) {
                return sendJson(res, 400, { success: false, error: 'manifestPath required' });
            }
            replicationSeparation.previewBootstrap({ manifestPath, archivePath })
                .then((preview) => {
                    sendJson(res, 200, {
                        success: true,
                        data: preview,
                        timestamp: new Date().toISOString()
                    });
                })
                .catch((error) => {
                    sendJson(res, 500, { success: false, error: error.message || 'Preview failed' });
                });
        } catch (error) {
            sendJson(res, 500, { success: false, error: error.message || 'Preview failed' });
        }
    });

    app.post('/replication/separation/bootstrap/apply', authMiddleware, async (req, res) => {
        if (!requireAdmin(req, res)) return;
        if (replicationMaintenance.isActive()) {
            return sendJson(res, 409, {
                success: false,
                code: REPLICATION_ERROR_CODES.MAINTENANCE,
                error: 'Replication maintenance already active'
            });
        }

        try {
            const { manifestPath, archivePath, confirmToken } = req.body || {};
            if (!manifestPath || !archivePath || !confirmToken) {
                return sendJson(res, 400, {
                    success: false,
                    error: 'manifestPath, archivePath, and confirmToken required'
                });
            }
            const result = await replicationSeparation.applySeparationBundle({
                manifestPath,
                archivePath,
                confirmToken
            });
            sendJson(res, 200, {
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendJson(res, 500, { success: false, error: error.message || 'Bootstrap failed' });
        }
    });
}

function registerWsPackets(globalResources) {
    replicationSeparation.initialize(globalResources);

        wsPacketRegistry.registerWsPacket('replication_separation_prepare', async (ctx) => {
        const handlers = ctx.handlers;
        const message = ctx.message;
        if (ctx.clientInfo.userType !== 'admin') {
            handlers.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        if (replicationMaintenance.isActive()) {
            handlers.sendError(
                ctx.ws,
                'Replication maintenance active',
                REPLICATION_ERROR_CODES.MAINTENANCE,
                message.requestId
            );
            return;
        }

        try {
            const jobId = replicationSeparation.startSeparationJob(message.data || {});
            handlers.sendToClient(ctx.ws, {
                type: 'replication_separation_prepare_response',
                requestId: message.requestId,
                data: { success: true, jobId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            handlers.sendError(ctx.ws, 'Separation prepare failed', error.message, message.requestId);
        }
    }, WS_OWNER);

    wsPacketRegistry.registerWsPacket('replication_separation_status', async (ctx) => {
        const handlers = ctx.handlers;
        const message = ctx.message;
        const jobId = message.jobId || (message.data && message.data.jobId);
        const job = jobId ? replicationSeparation.getSeparationJob(jobId) : null;
        if (!job) {
            handlers.sendError(ctx.ws, 'Job not found', 'NOT_FOUND', message.requestId);
            return;
        }
        handlers.sendToClient(ctx.ws, {
            type: 'replication_separation_status_response',
            requestId: message.requestId,
            data: { success: true, job },
            timestamp: new Date().toISOString()
        });
    }, { owner: 'replication-separation' });

    wsPacketRegistry.registerWsPacket('replication_separation_bootstrap_preview', async (ctx) => {
        const handlers = ctx.handlers;
        const message = ctx.message;
        if (ctx.clientInfo.userType !== 'admin') {
            handlers.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            const preview = await replicationSeparation.previewBootstrap(message.data || {});
            handlers.sendToClient(ctx.ws, {
                type: 'replication_separation_bootstrap_preview_response',
                requestId: message.requestId,
                data: { success: true, preview },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            handlers.sendError(ctx.ws, 'Bootstrap preview failed', error.message, message.requestId);
        }
    }, WS_OWNER);

    wsPacketRegistry.registerWsPacket('replication_separation_bootstrap_apply', async (ctx) => {
        const handlers = ctx.handlers;
        const message = ctx.message;
        if (ctx.clientInfo.userType !== 'admin') {
            handlers.sendError(ctx.ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        if (replicationMaintenance.isActive()) {
            handlers.sendError(
                ctx.ws,
                'Replication maintenance active',
                REPLICATION_ERROR_CODES.MAINTENANCE,
                message.requestId
            );
            return;
        }
        try {
            const data = message.data || message;
            let archiveBuffer = null;
            if (data.archiveBase64) {
                archiveBuffer = Buffer.from(data.archiveBase64, 'base64');
            }
            const result = await replicationSeparation.applySeparationBundle({
                manifestPath: data.manifestPath,
                archivePath: data.archivePath,
                manifestObject: data.manifest,
                archiveBuffer,
                archiveName: data.archiveName,
                confirmToken: data.confirmToken
            });
            handlers.sendToClient(ctx.ws, {
                type: 'replication_separation_bootstrap_apply_response',
                requestId: message.requestId,
                data: { success: true, result },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            handlers.sendError(ctx.ws, 'Bootstrap apply failed', error.message, message.requestId);
        }
    }, WS_OWNER);
}

function register(app, globalResources) {
    registerHttpRoutes(app, globalResources);
    registerWsPackets(globalResources);
}

module.exports = { register, registerHttpRoutes, registerWsPackets };
