const wsPacketRegistry = require('../wsPacketRegistry');
const startMenuLayout = require('../../startMenuLayout');

const START_MENU_LAYOUT_DESTRUCTIVE = { destructive: true };

async function handleGetLayout(handlersCtx, ws, message) {
    try {
        const layout = startMenuLayout.getLayout(startMenuLayout.HUMAN_OWNER);
        const updatedAt = startMenuLayout.getUpdatedAt(startMenuLayout.HUMAN_OWNER);
        handlersCtx.sendToClient(ws, {
            type: 'start_menu_get_layout_response',
            requestId: message.requestId,
            data: { layout, updatedAt },
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
        // A whole-layout write names the revision it was edited from (startMenuOrganizer.js reads it first): a client
        // that never read the saved layout (an offline boot showed the default one) or read an older one cannot
        // replace it. Clients from before the guard send no baseUpdatedAt and are let through (#910, Nov 20 2026).
        if (Object.prototype.hasOwnProperty.call(message, 'baseUpdatedAt')) {
            const current = startMenuLayout.getUpdatedAt(startMenuLayout.HUMAN_OWNER);
            if ((message.baseUpdatedAt || null) !== current) {
                handlersCtx.sendError(ws, 'The Start menu layout changed since it was read, or was never read', 'STALE_LAYOUT', message.requestId);
                return;
            }
        }
        const layout = startMenuLayout.saveLayout(startMenuLayout.HUMAN_OWNER, message.layout);
        const updatedAt = startMenuLayout.getUpdatedAt(startMenuLayout.HUMAN_OWNER);
        handlersCtx.sendToClient(ws, {
            type: 'start_menu_save_layout_response',
            requestId: message.requestId,
            data: { success: true, layout, updatedAt },
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
    registerPackets,
    handleGetLayout,
    handleSaveLayout
};
