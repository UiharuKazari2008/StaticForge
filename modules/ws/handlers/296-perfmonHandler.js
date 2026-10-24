const wsPacketRegistry = require('../wsPacketRegistry');
const perfmonSnapshot = require('../../perfmonSnapshot');
const reliabilityRecords = require('../../reliabilityRecords');
const { createMelatonPackageStore } = require('../../melatonPackageStore');

// Reliability and Performance Monitor (apps/perfmon): the host's Resource View figures (CPU, disk,
// network, memory per process) and Reliability Monitor's records (modules/reliabilityRecords.js).
// Administrators only, read-only.

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[296-perfmonHandler] registerPackets: missing handlersCtx');
        return;
    }
    wsPacketRegistry.registerWsPacket('perfmon_snapshot', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!clientInfo || clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            const data = await perfmonSnapshot.snapshot();
            handlersCtx.sendToClient(ws, { type: 'perfmon_snapshot_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to read the system', error.message, message.requestId);
        }
    }, { owner: 'perfmon' });

    reliabilityRecords.start();
    let store = null;
    wsPacketRegistry.registerWsPacket('perfmon_reliability', async (ctx) => {
        const { ws, message, clientInfo } = ctx;
        if (!clientInfo || clientInfo.userType !== 'admin') {
            handlersCtx.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
            return;
        }
        try {
            if (!store && handlersCtx.globalResources) store = createMelatonPackageStore(handlersCtx.globalResources);
            const data = reliabilityRecords.records(store);
            handlersCtx.sendToClient(ws, { type: 'perfmon_reliability_response', requestId: message.requestId, data, timestamp: new Date().toISOString() });
        } catch (error) {
            handlersCtx.sendError(ws, 'Failed to read the reliability records', error.message, message.requestId);
        }
    }, { owner: 'perfmon' });
}

module.exports = { registerPackets };
