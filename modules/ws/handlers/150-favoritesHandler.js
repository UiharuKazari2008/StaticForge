const wsPacketRegistry = require('../wsPacketRegistry');

const FAVORITES_DESTRUCTIVE = { destructive: true };

async function handleAddFavorite(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { favoriteType, item, customName } = message;

        if (!favoriteType || !item) {
            handlers.sendError(ws, 'Missing required parameters: favoriteType and item');
            return;
        }

        const favoriteItem = handlers.globalResources.getFavoritesManager().createFavoriteFromResult(item, customName);
        const result = handlers.globalResources.getFavoritesManager().addFavorite(favoriteType, favoriteItem);

        if (result.success) {
            handlers.sendToClient(ws, {
                type: 'favorites_add_response',
                success: true,
                item: result.item,
                requestId: message.requestId
            });
        } else {
            handlers.sendError(ws, result.error, null, message.requestId);
        }
    } catch (error) {
        console.error('Error adding favorite:', error);
        handlers.sendError(ws, 'Failed to add favorite', error.message, message.requestId);
    }
}

async function handleRemoveFavorite(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { favoriteType, itemId } = message;

        if (!favoriteType || !itemId) {
            handlers.sendError(ws, 'Missing required parameters: favoriteType and itemId');
            return;
        }

        const result = handlers.globalResources.getFavoritesManager().removeFavorite(favoriteType, itemId);

        if (result.success) {
            handlers.sendToClient(ws, {
                type: 'favorites_remove_response',
                success: true,
                requestId: message.requestId
            });
        } else {
            handlers.sendError(ws, result.error, null, message.requestId);
        }
    } catch (error) {
        console.error('Error removing favorite:', error);
        handlers.sendError(ws, 'Failed to remove favorite', error.message, message.requestId);
    }
}

async function handleGetFavorites(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { favoriteType } = message;
        const favorites = handlers.globalResources.getFavoritesManager().getFavorites(favoriteType);

        handlers.sendToClient(ws, {
            type: 'favorites_get_response',
            data: {
                favorites: favorites
            },
            requestId: message.requestId
        });
    } catch (error) {
        console.error('Error getting favorites:', error);
        handlers.sendError(ws, 'Failed to get favorites', error.message, message.requestId);
    }
}

/**
 * Register favorites WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[150-favoritesHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'favorites', ...meta });
    };

    regFn('favorites_add', handleAddFavorite, FAVORITES_DESTRUCTIVE);
    regFn('favorites_remove', handleRemoveFavorite, FAVORITES_DESTRUCTIVE);
    regFn('favorites_get', handleGetFavorites);
}

module.exports = {
    registerPackets
};
