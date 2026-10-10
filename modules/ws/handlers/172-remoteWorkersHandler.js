'use strict';

const wsPacketRegistry = require('../wsPacketRegistry');
const { collectRemoteWorkerStatuses, DEFAULT_TIMEOUT_MS } = require('../../remoteWorkersStatus');

const OWNER = { owner: 'infrastructure' };

function send(handlers, ws, message, wsServer, payload) {
    const packet = {
        type: 'remote_workers_status_response',
        requestId: message && message.requestId,
        data: payload,
        timestamp: new Date().toISOString()
    };
    if (wsServer && typeof wsServer.sendToClient === 'function') {
        wsServer.sendToClient(ws, packet);
        return;
    }
    handlers.sendToClient(ws, packet);
}

async function handleRemoteWorkersStatus(handlers, ws, message, clientInfo, wsServer) {
    const workerId = message && (message.workerId || (message.data && message.data.workerId)) || null;
    try {
        const result = await collectRemoteWorkerStatuses(handlers.globalResources, {
            workerId: workerId || null,
            timeoutMs: DEFAULT_TIMEOUT_MS
        });
        send(handlers, ws, message, wsServer, {
            workers: result.workers,
            checkedAt: result.checkedAt,
            error: result.error || null
        });
    } catch (_) {
        console.error('remote_workers_status failed');
        send(handlers, ws, message, wsServer, {
            workers: [],
            checkedAt: new Date().toISOString(),
            error: 'Remote worker status failed'
        });
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[172-remoteWorkersHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('remote_workers_status', async (ctx) => {
        await handleRemoteWorkersStatus(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
    }, OWNER);
}

module.exports = {
    registerPackets,
    handleRemoteWorkersStatus
};
