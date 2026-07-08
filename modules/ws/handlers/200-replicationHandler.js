const wsPacketRegistry = require('../wsPacketRegistry');
const { REPLICATION_WS_REQUESTS, REPLICATION_WS_RESPONSES } = require('../../replication/replicationContracts');
const replicationGalleryProxy = require('../../replicationGalleryProxy');
const replicationRemoteFetch = require('../../replicationRemoteFetch');

const REPLICATION_OWNER = { owner: 'replication' };

async function handleReplicationRemoteGallery(handlers, ws, message, clientInfo, wsServer) {
    try {
        const replicationService = handlers.globalResources.getReplicationService();
        const config = replicationService.getReplicationConfig();
        if (!config.masterAccessUrl) {
            handlers.sendError(ws, 'masterAccessUrl not configured', 'REPLICATION_CONFIG', message.requestId);
            return;
        }
        if (config.connectivity === 'airgapped') {
            handlers.sendError(ws, 'Remote gallery blocked in airgapped mode', 'REPLICATION_CONNECTIVITY_BLOCKED', message.requestId);
            return;
        }
        const reachable = await replicationRemoteFetch.probeMasterReachable(false, handlers.globalResources);
        if (!reachable) {
            handlers.sendError(ws, 'Master is not reachable', 'REPLICATION_ASSET_UNAVAILABLE', message.requestId);
            return;
        }
        const workspaceId = message.workspaceId || 'default';
        const viewType = message.viewType || 'images';
        const files = await replicationGalleryProxy.fetchRemoteGalleryFilenames(
            handlers.globalResources,
            { workspaceId, viewType }
        );
        wsServer.sendToClient(ws, {
            type: REPLICATION_WS_RESPONSES.REMOTE_GALLERY,
            requestId: message.requestId,
            data: {
                success: true,
                workspaceId,
                viewType,
                files
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error handling replication_request_remote_gallery:', error);
        handlers.sendError(ws, 'Failed to fetch remote gallery', error.message, message.requestId);
    }
}

async function handleReplicationStatus(handlers, ws, message, clientInfo, wsServer) {
    try {
        const replicationService = handlers.globalResources.getReplicationService();
        wsServer.sendToClient(ws, replicationService.buildStatusResponse(message.requestId));
    } catch (error) {
        console.error('❌ Error handling replication_status:', error);
        handlers.sendError(ws, 'Failed to get replication status', error.message, message.requestId);
    }
}

/**
 * Register replication WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[200-replicationHandler] registerPackets: missing handlersCtx');
        return;
    }

    wsPacketRegistry.registerWsPacket(
        REPLICATION_WS_REQUESTS.STATUS,
        async (ctx) => {
            await handleReplicationStatus(
                ctx.handlers,
                ctx.ws,
                ctx.message,
                ctx.clientInfo,
                ctx.wsServer
            );
        },
        REPLICATION_OWNER
    );

    wsPacketRegistry.registerWsPacket(
        REPLICATION_WS_REQUESTS.REMOTE_GALLERY,
        async (ctx) => {
            await handleReplicationRemoteGallery(
                ctx.handlers,
                ctx.ws,
                ctx.message,
                ctx.clientInfo,
                ctx.wsServer
            );
        },
        REPLICATION_OWNER
    );
}

module.exports = {
    registerPackets
};
