const wsPacketRegistry = require('../wsPacketRegistry');

const SIMILAR_DESTRUCTIVE = { destructive: true };

function resolveWorkspaceId(handlers, message, clientInfo) {
    const requested = message && typeof message.workspaceId === 'string'
        ? message.workspaceId.trim()
        : '';
    if (requested) return requested;
    try {
        const active = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(
            clientInfo && clientInfo.sessionId
        );
        if (active) return active;
    } catch (_err) {
        // fall through to default
    }
    return 'default';
}

function getMetadataDatabase(handlers) {
    const gr = handlers && handlers.globalResources;
    if (!gr) return null;
    if (typeof gr.getMetadataDatabase === 'function') {
        return gr.getMetadataDatabase();
    }
    return gr.metadataDatabase || null;
}

async function handleGetSimilarImageGroups(handlers, ws, message, clientInfo, _wsServer) {
    try {
        const metadataDb = getMetadataDatabase(handlers);
        if (!metadataDb || typeof metadataDb.listSimilarImageGroupsForWorkspace !== 'function') {
            handlers.sendError(ws, 'Metadata database is not available', 'get_similar_image_groups', message.requestId);
            return;
        }

        const workspaceId = resolveWorkspaceId(handlers, message, clientInfo);
        const payload = await metadataDb.listSimilarImageGroupsForWorkspace(workspaceId, {
            includeRefine: message.includeRefine !== false,
            groupLimit: message.groupLimit,
            itemLimit: message.itemLimit
        });

        handlers.sendToClient(ws, {
            type: 'get_similar_image_groups_response',
            requestId: message.requestId,
            data: {
                success: true,
                ...payload
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_similar_image_groups failed:', error && error.message);
        handlers.sendError(ws, 'Failed to list similar image groups', error.message, message.requestId);
    }
}

async function handleScrapSimilarImages(handlers, ws, message, clientInfo, wsServer) {
    try {
        const metadataDb = getMetadataDatabase(handlers);
        const workspaceId = resolveWorkspaceId(handlers, message, clientInfo);
        const groupId = message && typeof message.groupId === 'string' ? message.groupId.trim() : '';
        const groupKind = message && message.groupKind === 'refine' ? 'refine' : 'consecutive_seed';
        const keepFilenames = Array.isArray(message && message.keepFilenames)
            ? message.keepFilenames.filter((name) => typeof name === 'string' && name)
            : [];
        let filenames = Array.isArray(message && message.filenames)
            ? message.filenames.filter((name) => typeof name === 'string' && name)
            : [];

        if (groupId && keepFilenames.length > 0 && metadataDb
            && typeof metadataDb.listSimilarGroupMemberFilenames === 'function') {
            const members = await metadataDb.listSimilarGroupMemberFilenames(workspaceId, groupId, groupKind);
            const keep = new Set(keepFilenames);
            filenames = members.filter((name) => !keep.has(name));
        }

        if (!filenames.length) {
            handlers.sendError(ws, 'Filenames array is required', 'scrap_similar_images', message.requestId);
            return;
        }

        if (groupId && metadataDb && typeof metadataDb.listSimilarGroupMemberFilenames === 'function') {
            const members = new Set(
                await metadataDb.listSimilarGroupMemberFilenames(workspaceId, groupId, groupKind)
            );
            const outside = filenames.filter((name) => !members.has(name));
            if (outside.length) {
                handlers.sendError(
                    ws,
                    'Some filenames are not in the requested similar group',
                    'scrap_similar_images',
                    message.requestId
                );
                return;
            }
        }

        const deleteHandler = wsPacketRegistry.getWsPacketHandler('delete_images_bulk');
        if (typeof deleteHandler !== 'function') {
            handlers.sendError(ws, 'delete_images_bulk is not registered', 'scrap_similar_images', message.requestId);
            return;
        }

        await deleteHandler({
            handlers,
            ws,
            message: {
                type: 'delete_images_bulk',
                requestId: message.requestId,
                filenames
            },
            clientInfo,
            wsServer
        });
    } catch (error) {
        console.error('scrap_similar_images failed:', error && error.message);
        handlers.sendError(ws, 'Failed to scrap similar images', error.message, message.requestId);
    }
}

/**
 * Register similar-image review WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[125-similarImageHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, owner, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner, ...meta });
    };

    reg('get_similar_image_groups', 'similarImages', handleGetSimilarImageGroups, { dispatch: 'parallel' });
    reg('scrap_similar_images', 'similarImages', handleScrapSimilarImages, SIMILAR_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
