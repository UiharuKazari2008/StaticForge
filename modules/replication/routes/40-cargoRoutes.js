/**
 * Replication cargo HTTP routes — export/import, upsert, resumable streaming.
 */

const replicationCargoService = require('../../replicationCargoService');
const replicationMaintenance = require('../../replicationMaintenance');
const replicationTarStream = require('../../replicationTarStream');
const { REPLICATION_ERROR_CODES } = require('../replicationContracts');

function sendReplicationError(res, status, err) {
    res.status(status).json({
        success: false,
        error: err.message || 'Replication cargo error',
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

function register(app, globalResources) {
    const authMiddleware = globalResources.getAuthMiddleware();
    const cargo = replicationCargoService.initialize(globalResources);

    app.get('/replication/cargo/transfers', authMiddleware, (req, res) => {
        try {
            res.json({
                success: true,
                data: {
                    transfers: cargo.getActiveTransfers(),
                    peerSessions: require('../../replicationPeerServer').getActiveSessions()
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.post('/replication/cargo/export', authMiddleware, async (req, res) => {
        try {
            const transferMode = parseTransferMode(req);
            const blocksAck = parseBlocksAck(req);
            const operation = req.body?.operation || 'ephemeral-export';
            const transfer = await cargo.createExportTransfer({ operation, transferMode, blocksAck });
            res.json({
                success: true,
                data: {
                    manifestId: transfer.manifestId,
                    manifest: transfer.manifest,
                    transferMode,
                    streamUrl: `/replication/cargo/stream/${transfer.manifestId}`,
                    blocks: transfer.blocks || null
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            const status = error.code === REPLICATION_ERROR_CODES.TRANSFER_ABORTED ? 400 : 500;
            sendReplicationError(res, status, error);
        }
    });

    app.get('/replication/cargo/stream/:manifestId', authMiddleware, (req, res) => {
        try {
            const transfer = cargo.getTransfer(req.params.manifestId);
            if (!transfer || transfer.state !== 'ready') {
                return sendReplicationError(res, 404, new Error('Cargo stream not found'));
            }

            const offset = parseInt(req.headers['x-cargo-offset'] || req.query.offset || '0', 10) || 0;
            const buf = transfer.rawBuffer;
            if (!buf) {
                return sendReplicationError(res, 404, new Error('Cargo buffer not available'));
            }

            const total = buf.length;
            const rangeHeader = req.headers.range;
            let start = offset;
            let end = total - 1;

            if (rangeHeader) {
                const match = /^bytes=(\d+)-(\d+)?$/.exec(rangeHeader);
                if (match) {
                    start = parseInt(match[1], 10);
                    end = match[2] ? parseInt(match[2], 10) : total - 1;
                }
            }

            if (start >= total) {
                res.status(416).set({
                    'Content-Range': `bytes */${total}`
                }).end();
                return;
            }

            const chunk = buf.slice(start, end + 1);
            const contentType = replicationTarStream.getContentTypeForMode(transfer.transferMode);

            if (rangeHeader || offset > 0) {
                res.status(206);
                res.set({
                    'Content-Range': `bytes ${start}-${start + chunk.length - 1}/${total}`,
                    'Accept-Ranges': 'bytes',
                    'Content-Length': chunk.length,
                    'Content-Type': contentType,
                    'X-Cargo-Manifest-Id': transfer.manifestId,
                    'X-Cargo-Offset-Next': String(start + chunk.length)
                });
                res.end(chunk);
                return;
            }

            res.set({
                'Content-Type': contentType,
                'Content-Length': total,
                'Accept-Ranges': 'bytes',
                'X-Cargo-Manifest-Id': transfer.manifestId,
                'X-Cargo-Sha256': transfer.manifest.streamSha256 || ''
            });
            res.end(buf);
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.put('/replication/cargo/stream/:manifestId', authMiddleware, async (req, res) => {
        try {
            if (replicationMaintenance.isWriteBlocked()) {
                const op = replicationMaintenance.getState().operation || '';
                const importOp = op === 'import' || op.endsWith('-import');
                if (!importOp) {
                return sendReplicationError(res, 423, Object.assign(
                    new Error('Replication maintenance blocks this upload'),
                    { code: REPLICATION_ERROR_CODES.MAINTENANCE }
                ));
                }
            }

            let transfer = cargo.getTransfer(req.params.manifestId);
            if (!transfer) {
                const transferMode = parseTransferMode(req);
                transfer = await cargo.beginImport({
                    transferMode,
                    blocksAck: parseBlocksAck(req),
                    operation: req.body?.operation || 'import'
                });
            }

            const offset = parseInt(req.headers['x-cargo-offset'] || req.query.offset || '0', 10) || 0;
            const chunks = [];
            await new Promise((resolve, reject) => {
                req.on('data', (c) => chunks.push(c));
                req.on('end', resolve);
                req.on('error', reject);
            });
            const chunk = Buffer.concat(chunks);
            const result = await cargo.appendImportBytes(transfer.manifestId, chunk, offset);

            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 400, error);
        }
    });

    app.post('/replication/cargo/import/begin', authMiddleware, async (req, res) => {
        try {
            const transferMode = parseTransferMode(req);
            const blocksAck = parseBlocksAck(req);
            const transfer = await cargo.beginImport({
                transferMode,
                blocksAck,
                operation: req.body?.operation || 'import'
            });
            res.json({
                success: true,
                data: {
                    manifestId: transfer.manifestId,
                    manifest: transfer.manifest,
                    transferMode
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            const status = error.code ? 400 : 500;
            sendReplicationError(res, status, error);
        }
    });

    app.post('/replication/cargo/import/complete', authMiddleware, async (req, res) => {
        try {
            const manifestId = req.body?.manifestId;
            const streamSha256 = req.body?.streamSha256 || null;
            if (!manifestId) {
                return sendReplicationError(res, 400, new Error('manifestId required'));
            }
            const response = await cargo.completeImport(manifestId, { streamSha256 });
            res.json({
                success: true,
                data: response,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.post('/replication/cargo/upsert/begin', authMiddleware, async (req, res) => {
        try {
            const transferMode = parseTransferMode(req);
            const blocksAck = parseBlocksAck(req);
            const partnerInstanceId = req.body?.partnerInstanceId || null;
            const result = await cargo.beginUpsert({ partnerInstanceId, transferMode, blocksAck });
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

    app.post('/replication/cargo/upsert/send', authMiddleware, async (req, res) => {
        try {
            const transferMode = parseTransferMode(req);
            const blocksAck = parseBlocksAck(req);
            const result = await cargo.sendUpsertToMaster({ transferMode, blocksAck });
            res.json({
                success: true,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.post('/replication/cargo/upsert/complete', authMiddleware, async (req, res) => {
        try {
            const maint = replicationMaintenance.getState();
            if (maint.active && maint.operation === 'upsert') {
                replicationMaintenance.markLocalWorkComplete({ reason: 'upsert complete' });
            }
            res.json({
                success: true,
                data: { completed: true },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.delete('/replication/cargo/transfer/:manifestId', authMiddleware, (req, res) => {
        try {
            cargo.cancelTransfer(req.params.manifestId);
            res.json({
                success: true,
                data: { cancelled: true },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            sendReplicationError(res, 500, error);
        }
    });

    app.get('/replication/cargo/blocks-warning', authMiddleware, (_req, res) => {
        res.json({
            success: true,
            data: {
                confirmation: replicationTarStream.BLOCKS_SLOW_PATH_CONFIRMATION
            },
            timestamp: new Date().toISOString()
        });
    });
}

module.exports = { register };
