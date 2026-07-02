const wsPacketRegistry = require('../wsPacketRegistry');

const PERSONA_DESTRUCTIVE = { destructive: true };

async function handleGetPersonaSettings(handlers, ws, message, clientInfo, wsServer) {
    try {
        const settings = await handlers.globalResources.getChatDatabase().getPersonaSettings();
        handlers.sendToClient(ws, {
            type: 'get_persona_settings_response',
            requestId: message.requestId,
            data: {
                success: true,
                settings: settings
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error getting persona settings:', error);
        handlers.sendError(ws, 'Failed to get persona settings', error.message, message.requestId);
    }
}

async function handleSavePersonaSettings(handlers, ws, message, clientInfo, wsServer) {
    try {
        const data = message.data || message;
        const { settings } = data;

        const success = await handlers.globalResources.getChatDatabase().savePersonaSettings(settings);

        handlers.sendToClient(ws, {
            type: 'save_persona_settings_response',
            requestId: message.requestId,
            data: {
                success: success,
                message: success ? 'Persona settings saved successfully' : 'Failed to save persona settings'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error saving persona settings:', error);
        handlers.sendError(ws, 'Failed to save persona settings', error.message, message.requestId);
    }
}

/**
 * Register persona settings WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[210-personaHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'persona', ...meta });
    };

    regFn('get_persona_settings', handleGetPersonaSettings);
    regFn('save_persona_settings', handleSavePersonaSettings, PERSONA_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
