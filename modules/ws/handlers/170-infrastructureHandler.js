const wsPacketRegistry = require('../wsPacketRegistry');

const INFRA_OWNER = { owner: 'infrastructure' };

function handlePing(handlers, ws, message, clientInfo, wsServer) {
    if (typeof message.clientRttMs === 'number' && Number.isFinite(message.clientRttMs) && message.clientRttMs >= 0 && message.clientRttMs <= 120000) {
        clientInfo.lastClientRttMs = message.clientRttMs;
    }
    wsServer.sendToClient(ws, {
        type: 'pong',
        requestId: message.requestId,
        timestamp: new Date().toISOString(),
        serverReady: true
    });
}

async function handleServerStatus(handlers, ws, message, clientInfo, wsServer) {
    try {
        const globalResources = handlers.globalResources;
        const isReady = globalResources.isReady && globalResources.isInitialized();
        const stage = globalResources.getServerStage ? globalResources.getServerStage() : 'unknown';

        wsServer.sendToClient(ws, {
            type: 'server_status_response',
            requestId: message.requestId,
            data: {
                success: true,
                isReady: isReady,
                stage: stage,
                timestamp: new Date().toISOString()
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error handling server status:', error);
        wsServer.sendToClient(ws, {
            type: 'server_status_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleCheckUpdates(handlers, ws, message, clientInfo, wsServer) {
    try {
        wsServer.sendToClient(ws, {
            type: 'check_updates_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Update check should be performed via HTTP OPTIONS request to /'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error handling check updates:', error);
        wsServer.sendToClient(ws, {
            type: 'check_updates_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleVersionCheck(handlers, ws, message, clientInfo, wsServer) {
    try {
        const packageJson = require('../../../package.json');
        const serverVersion = packageJson.version || 'unknown';

        wsServer.sendToClient(ws, {
            type: 'version_check_response',
            requestId: message.requestId,
            data: {
                success: true,
                serverVersion: serverVersion,
                clientVersion: message.data?.clientVersion || 'unknown',
                compatible: true
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error handling version check:', error);
        wsServer.sendToClient(ws, {
            type: 'version_check_response',
            requestId: message.requestId,
            data: {
                success: false,
                error: error.message
            },
            timestamp: new Date().toISOString()
        });
    }
}

async function handleGetSystemInfo(handlers, ws, message, clientInfo, wsServer) {
    const startTime = Date.now();

    try {
        const systemInfo = handlers.globalResources.getSystemInfoCache();

        if (!systemInfo) {
            handlers.sendError(ws, 'System information not available', 'System info cache not initialized', message.requestId);
            return;
        }

        handlers.sendToClient(ws, {
            type: 'get_system_info_response',
            requestId: message.requestId,
            data: systemInfo,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ System info request error after ${totalTime}ms:`, error);
        handlers.sendError(ws, 'Failed to get system information', error.message, message.requestId);
    }
}

/**
 * Register infrastructure WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[170-infrastructureHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { ...INFRA_OWNER, ...meta });
    };

    regFn('ping', handlePing);
    wsPacketRegistry.registerWsPacket('pong', async (ctx) => {
        ctx.wsServer.sendToClient(ctx.ws, {
            type: 'pong',
            requestId: ctx.message.requestId,
            timestamp: new Date().toISOString()
        });
    }, INFRA_OWNER);
    regFn('server_status', handleServerStatus);
    regFn('check_updates', handleCheckUpdates);
    regFn('version_check', handleVersionCheck);
    regFn('get_system_info', handleGetSystemInfo);
}

module.exports = {
    registerPackets
};
