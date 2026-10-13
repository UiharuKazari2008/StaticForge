const wsPacketRegistry = require('../wsPacketRegistry');
const wallpaperHistory = require('../../wallpaperHistory');

// Uploaded wallpaper history for Control Panel's Desktop Background (modules/wallpaperHistory.js).

async function handleList(handlersCtx, ws, message) {
    try {
        const cacheDir = handlersCtx.globalResources.getPath('cache');
        handlersCtx.sendToClient(ws, {
            type: 'wallpaper_history_list_response',
            requestId: message.requestId,
            data: { success: true, items: wallpaperHistory.list(cacheDir) },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load the wallpaper history', error.message, message.requestId);
    }
}

async function handleDelete(handlersCtx, ws, message) {
    try {
        const cacheDir = handlersCtx.globalResources.getPath('cache');
        const removed = wallpaperHistory.remove(cacheDir, String(message.id || ''));
        handlersCtx.sendToClient(ws, {
            type: 'wallpaper_history_delete_response',
            requestId: message.requestId,
            data: { success: true, removed, items: wallpaperHistory.list(cacheDir) },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to remove the wallpaper', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[280-wallpaperHistoryHandler] registerPackets: missing handlersCtx');
        return;
    }
    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'wallpaperHistory', ...meta });
    };
    reg('wallpaper_history_list', handleList);
    reg('wallpaper_history_delete', handleDelete, { destructive: true });
}

module.exports = {
    registerPackets
};
