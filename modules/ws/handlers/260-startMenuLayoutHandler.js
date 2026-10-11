const wsPacketRegistry = require('../wsPacketRegistry');
const startMenuLayout = require('../../startMenuLayout');

const START_MENU_LAYOUT_DESTRUCTIVE = { destructive: true };

async function handleGetLayout(handlersCtx, ws, message) {
    try {
        const layout = startMenuLayout.getLayout(startMenuLayout.HUMAN_OWNER);
        handlersCtx.sendToClient(ws, {
            type: 'start_menu_get_layout_response',
            requestId: message.requestId,
            data: { layout },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to load start menu layout', error.message, message.requestId);
    }
}

async function handleSaveLayout(handlersCtx, ws, message) {
    try {
        if (!Array.isArray(message.layout)) {
            handlersCtx.sendError(ws, 'Layout array is required', 'start_menu_save_layout', message.requestId);
            return;
        }
        const layout = startMenuLayout.saveLayout(startMenuLayout.HUMAN_OWNER, message.layout);
        handlersCtx.sendToClient(ws, {
            type: 'start_menu_save_layout_response',
            requestId: message.requestId,
            data: { success: true, layout },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        if (error instanceof startMenuLayout.StartMenuLayoutError) {
            handlersCtx.sendError(ws, error.message, error.code, message.requestId);
            return;
        }
        handlersCtx.sendError(ws, 'Failed to save start menu layout', error.message, message.requestId);
    }
}

async function handleResetLayout(handlersCtx, ws, message) {
    try {
        startMenuLayout.resetLayout(startMenuLayout.HUMAN_OWNER);
        handlersCtx.sendToClient(ws, {
            type: 'start_menu_reset_layout_response',
            requestId: message.requestId,
            data: { success: true },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        handlersCtx.sendError(ws, 'Failed to reset start menu layout', error.message, message.requestId);
    }
}

function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[260-startMenuLayoutHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'startMenuLayout', ...meta });
    };

    reg('start_menu_get_layout', handleGetLayout);
    reg('start_menu_save_layout', handleSaveLayout, START_MENU_LAYOUT_DESTRUCTIVE);
    reg('start_menu_reset_layout', handleResetLayout, START_MENU_LAYOUT_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
