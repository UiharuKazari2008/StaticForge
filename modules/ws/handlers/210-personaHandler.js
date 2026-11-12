const wsPacketRegistry = require('../wsPacketRegistry');

const customModelProviders = require('../../customModelProviders');

const PERSONA_DESTRUCTIVE = { destructive: true };

// Chat engine (Yozora #763): provider / model / effort for chat personas, shared by the desktop
// Control Panel "Chat" page and the phone's Messaging Options. Stored on the persona row.
function chatEngineReply(handlers) {
    const gr = handlers.globalResources;
    const chatDb = gr.getChatDatabase();
    const service = gr.getAiServiceManager().getChatService();
    const saved = chatDb.getChatEngineSettings();
    const providerId = service.getProviderId();
    const effort = service.getEffort();
    const providers = customModelProviders.publicList(gr).map((row) => {
        const full = customModelProviders.lookup(gr, row.id);
        return {
            id: row.id,
            name: row.name,
            kind: row.kind,
            logo: row.logo || '',
            hasKey: customModelProviders.hasKey(gr, row.id),
            defaultModel: (row.id === service.configProviderId() && String(service.readConfig('chatModel') || '').trim()) ||
                customModelProviders.preferredModel(full) || ''
        };
    });
    return {
        success: true,
        settings: saved,
        effective: {
            provider: providerId,
            providerName: customModelProviders.displayName(gr, providerId),
            model: service.getDefaultModel(),
            effort: effort || 'default'
        },
        // what provider '' means: config chatProvider
        serverDefault: {
            provider: service.configProviderId(),
            providerName: customModelProviders.displayName(gr, service.configProviderId())
        },
        providers,
        efforts: chatDb.CHAT_EFFORTS
    };
}

async function handleGetChatEngineSettings(handlers, ws, message) {
    try {
        handlers.sendToClient(ws, {
            type: 'get_chat_engine_settings_response',
            requestId: message.requestId,
            data: chatEngineReply(handlers),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error getting chat engine settings:', error);
        handlers.sendError(ws, 'Failed to get chat engine settings', error.message, message.requestId);
    }
}

async function handleSaveChatEngineSettings(handlers, ws, message) {
    try {
        const data = message.data || message;
        const input = data.settings && typeof data.settings === 'object' ? data.settings : data;
        const gr = handlers.globalResources;
        const patch = {};
        if (input.provider !== undefined) {
            const id = String(input.provider || '').trim().toLowerCase();
            if (id) {
                const row = customModelProviders.lookup(gr, id);
                if (!row) throw new Error(`Unknown chat engine "${id}"`);
                if (!row.apiKey) throw new Error(`${row.name} has no API key. Add one in Security Center first.`);
                patch.provider = row.id;
            } else {
                patch.provider = '';
            }
        }
        if (input.model !== undefined) {
            const model = String(input.model || '').trim();
            if (model.length > 300 || /[\s<>]/.test(model)) throw new Error('That model id is not valid');
            patch.model = model;
        }
        if (input.effort !== undefined) {
            const effort = String(input.effort || 'default').trim().toLowerCase();
            if (!gr.getChatDatabase().CHAT_EFFORTS.includes(effort)) throw new Error(`Unknown effort "${effort}"`);
            patch.effort = effort;
        }
        const saved = await gr.getChatDatabase().saveChatEngineSettings(patch);
        if (!saved) throw new Error('Could not save the chat engine');
        handlers.sendToClient(ws, {
            type: 'save_chat_engine_settings_response',
            requestId: message.requestId,
            data: chatEngineReply(handlers),
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Error saving chat engine settings:', error.message);
        handlers.sendError(ws, error.message || 'Failed to save chat engine settings', 'CHAT_ENGINE_SAVE_FAILED', message.requestId);
    }
}

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

        // Merges: keys left out keep their stored value (chat engine columns included, #763).
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
    regFn('get_chat_engine_settings', handleGetChatEngineSettings);
    regFn('save_chat_engine_settings', handleSaveChatEngineSettings, PERSONA_DESTRUCTIVE);
}

module.exports = {
    registerPackets,
    _test: { chatEngineReply, handleGetChatEngineSettings, handleSaveChatEngineSettings }
};
