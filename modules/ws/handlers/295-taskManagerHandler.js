const wsPacketRegistry = require('../wsPacketRegistry');
const taskManagerSnapshot = require('../../taskManagerSnapshot');
const { createSnapshotStream } = require('../snapshotStream');

// Task Manager (apps/taskmgr): the host's processes, performance, network and pm2 services.
// Administrators only (the process list shows the machine), read-only: no packet ends anything.

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[295-taskManagerHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('taskmgr_snapshot', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!clientInfo || clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            const data = await taskManagerSnapshot.snapshot({ services: message.services !== false });
            handlersCtx.sendToClient(ws, { type: 'taskmgr_snapshot_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to read the system', error.message, message.requestId);
        }
    }, { owner: 'taskmgr' });

    // the live view, pushed (snapshotStream.js): one sampler for every open window, each at its own rate
    const feed = createSnapshotStream({
        name: 'taskmgr',
        pushType: 'taskmgr_snapshot_push',
        sample: (wants) => taskManagerSnapshot.snapshot({ services: !!wants.services }),
        sendToClient: (ws, msg) => handlersCtx.sendToClient(ws, msg)
    });
    wsPacketRegistry.registerWsPacket('taskmgr_subscribe', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!clientInfo || clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            const data = await feed.subscribe(ws, { intervalMs: message.intervalMs, wants: { services: message.services === true } });
            handlersCtx.sendToClient(ws, { type: 'taskmgr_subscribe_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to read the system', error.message, message.requestId);
        }
    }, { owner: 'taskmgr' });
    wsPacketRegistry.registerWsPacket('taskmgr_unsubscribe', async (ctx) => {
        feed.unsubscribe(ctx.ws);
        handlersCtx.sendToClient(ctx.ws, { type: 'taskmgr_unsubscribe_response', requestId: ctx.message.requestId, data: { ok: true }, timestamp: new Date().toISOString() });
    }, { owner: 'taskmgr' });
}

module.exports = { registerPackets };
