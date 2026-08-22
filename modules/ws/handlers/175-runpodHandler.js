const wsPacketRegistry = require('../wsPacketRegistry');

const RUNPOD_OWNER = { owner: 'runpod' };
const RUNPOD_DESTRUCTIVE = { owner: 'runpod', destructive: true };

function sendSnapshot(handlers, ws, message, wsServer, extra = {}) {
    const manager = handlers.globalResources.getRunpodPodManager();
    const snapshot = manager.getCachedSnapshot();
    wsServer.sendToClient(ws, {
        type: `${message.type}_response`,
        requestId: message.requestId,
        data: {
            success: true,
            ...snapshot,
            ...extra
        },
        timestamp: new Date().toISOString()
    });
}

async function handleRunpodPodsStatus(handlers, ws, message, clientInfo, wsServer) {
    try {
        const manager = handlers.globalResources.getRunpodPodManager();
        await manager.getSnapshot({ refresh: true });
        sendSnapshot(handlers, ws, message, wsServer);
    } catch (error) {
        handlers.sendError(ws, 'Failed to get RunPod status', error.message, message.requestId);
    }
}

async function handleRunpodPodStart(handlers, ws, message, clientInfo, wsServer) {
    const { podId } = message;
    if (!podId) {
        handlers.sendError(ws, 'podId is required', 'runpod_pod_start', message.requestId);
        return;
    }
    try {
        const manager = handlers.globalResources.getRunpodPodManager();
        await manager.startPod(podId);
        sendSnapshot(handlers, ws, message, wsServer);
    } catch (error) {
        handlers.sendError(ws, 'Failed to start RunPod', error.message, message.requestId);
    }
}

async function handleRunpodPodStop(handlers, ws, message, clientInfo, wsServer) {
    const { podId } = message;
    if (!podId) {
        handlers.sendError(ws, 'podId is required', 'runpod_pod_stop', message.requestId);
        return;
    }
    try {
        const manager = handlers.globalResources.getRunpodPodManager();
        await manager.stopPod(podId, 'tray');
        sendSnapshot(handlers, ws, message, wsServer);
    } catch (error) {
        handlers.sendError(ws, 'Failed to stop RunPod', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[175-runpodHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { ...RUNPOD_OWNER, ...meta });
    };

    regFn('runpod_pods_status', handleRunpodPodsStatus);
    regFn('runpod_pod_start', handleRunpodPodStart, RUNPOD_DESTRUCTIVE);
    regFn('runpod_pod_stop', handleRunpodPodStop, RUNPOD_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
