const wsPacketRegistry = require('../wsPacketRegistry');
const taskManagerSnapshot = require('../../taskManagerSnapshot');

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
}

module.exports = { registerPackets };
