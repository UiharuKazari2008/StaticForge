/**
 * SSE log streaming for admin log viewer.
 * modules/logger.js (readLogFromOffset, resolveLogSource)
 * modules/pm2Service.js (getProcessStatus)
 */

const fs = require('fs');

const POLL_INTERVAL_MS = 250;
const HEARTBEAT_INTERVAL_MS = 15000;
const PM2_STATUS_INTERVAL_MS = 3000;
const MAX_CHUNK_BYTES = 65536;

function sendSse(res, event, data) {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
}

function streamLogFile(res, logger, source, startOffset, options = {}) {
    const pm2Service = options.pm2Service || null;
    const getHostMetrics = options.getHostMetrics || null;
    const getRuntimeCompileStatus = options.getRuntimeCompileStatus || null;
    const statusIntervalMs = Math.max(1000, Math.min(60000, Number(options.statusIntervalMs) || PM2_STATUS_INTERVAL_MS));
    const isCombined = logger.isCombinedLogSource(source);
    let offset = isCombined
        ? logger.createCombinedStreamState(startOffset)
        : Math.max(0, Number(startOffset) || 0);
    let lastSize = -1;
    let lastInode = null;
    let closed = false;

    const cleanup = () => {
        closed = true;
        if (pollTimer) clearInterval(pollTimer);
        if (heartbeatTimer) clearInterval(heartbeatTimer);
        if (pm2StatusTimer) clearInterval(pm2StatusTimer);
    };

    let pollTimer = null;
    let heartbeatTimer = null;
    let pm2StatusTimer = null;

    const emitPm2Status = () => {
        if (closed || !pm2Service || !pm2Service.isPm2Available()) return;
        pm2Service.getProcessStatus()
            .then((status) => {
                if (!closed && status) {
                    const enriched = {
                        ...status,
                        ...(getHostMetrics ? getHostMetrics() : {}),
                        ...(getRuntimeCompileStatus ? { runtimeCompile: getRuntimeCompileStatus() } : {})
                    };
                    sendSse(res, 'pm2status', { status: enriched });
                }
            })
            .catch(() => { /* ignore */ });
    };

    const fileStat = async (filePath) => {
        try {
            return await fs.promises.stat(filePath);
        } catch (err) {
            if (err && err.code === 'ENOENT') return null;
            throw err;
        }
    };

    const pollCombined = async () => {
        if (closed) return;
        try {
            if (logger.pollCombinedRotation(offset)) {
                sendSse(res, 'rotate', { nextOffset: { out: 0, err: 0 } });
                offset = logger.createCombinedStreamState({ out: 0, err: 0 });
                return;
            }

            const paths = require('./pm2LogPaths').getPm2LogPaths();
            if (!paths) {
                sendSse(res, 'error', { message: 'PM2 not available' });
                cleanup();
                res.end();
                return;
            }

            const fs = require('fs');
            const outStat = await fileStat(paths.out);
            const errStat = await fileStat(paths.err);
            const outSize = outStat ? outStat.size : 0;
            const errSize = errStat ? errStat.size : 0;
            const hasMore = offset.offsets.out < outSize || offset.offsets.err < errSize;
            if (!hasMore) return;

            const chunk = logger.readCombinedLogChunk(offset, MAX_CHUNK_BYTES);
            if (chunk.rotated) {
                sendSse(res, 'rotate', { nextOffset: { out: 0, err: 0 } });
                offset = logger.createCombinedStreamState({ out: 0, err: 0 });
                return;
            }
            if (chunk.content) {
                sendSse(res, 'chunk', {
                    content: chunk.content,
                    nextOffset: chunk.nextOffset,
                    fileSize: chunk.fileSize
                });
            }
        } catch (error) {
            sendSse(res, 'error', { message: error.message });
            cleanup();
            res.end();
        }
    };

    const pollSingle = async () => {
        if (closed) return;
        try {
            const filePath = logger.resolveLogSource(source);
            if (!filePath) {
                sendSse(res, 'error', { message: 'Invalid log source' });
                cleanup();
                res.end();
                return;
            }

            const fs = require('fs');
            const stats = await fileStat(filePath);
            if (!stats) {
                if (offset !== 0) {
                    sendSse(res, 'rotate', { nextOffset: 0 });
                    offset = 0;
                }
                lastSize = 0;
                return;
            }
            const inode = stats.ino;

            if (lastInode !== null && (stats.size < offset || inode !== lastInode)) {
                sendSse(res, 'rotate', { nextOffset: 0 });
                offset = 0;
            }
            lastInode = inode;
            lastSize = stats.size;

            if (offset > stats.size) {
                sendSse(res, 'rotate', { nextOffset: 0 });
                offset = 0;
                return;
            }

            if (offset < stats.size) {
                const chunk = logger.readLogFromOffset(source, offset, MAX_CHUNK_BYTES);
                if (chunk.rotated) {
                    sendSse(res, 'rotate', { nextOffset: 0 });
                    offset = 0;
                    return;
                }
                if (chunk.content) {
                    sendSse(res, 'chunk', {
                        content: chunk.content,
                        nextOffset: chunk.nextOffset,
                        fileSize: chunk.fileSize
                    });
                }
                offset = chunk.nextOffset;
            }
        } catch (error) {
            sendSse(res, 'error', { message: error.message });
            cleanup();
            res.end();
        }
    };

    let polling = false;
    const poll = async () => {
        if (closed || polling) return;
        polling = true;
        try {
            await (isCombined ? pollCombined() : pollSingle());
        } finally {
            polling = false;
        }
    };

    res.on('close', cleanup);

    pollTimer = setInterval(poll, POLL_INTERVAL_MS);
    heartbeatTimer = setInterval(() => {
        if (!closed) sendSse(res, 'heartbeat', {});
    }, HEARTBEAT_INTERVAL_MS);

    if (pm2Service && pm2Service.isPm2Available()) {
        emitPm2Status();
        pm2StatusTimer = setInterval(emitPm2Status, statusIntervalMs);
    }

    poll();
}

module.exports = { streamLogFile, sendSse };
