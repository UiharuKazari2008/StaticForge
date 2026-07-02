const wsPacketRegistry = require('../wsPacketRegistry');

const USER_SETTINGS_DESTRUCTIVE = { destructive: true };

async function handleGetUserGlobalSettings(handlers, ws, message, clientInfo, wsServer) {
    try {
        const config = handlers.globalResources.getConfig() || {};
        const settings = handlers.normalizeUserGlobalSettings(config.userGlobalSettings);
        handlers.sendToClient(ws, {
            type: 'get_user_global_settings_response',
            requestId: message.requestId,
            data: { settings },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('get_user_global_settings:', error);
        handlers.sendError(ws, 'Failed to load user settings', error.message, message.requestId);
    }
}

async function handleUpdateUserGlobalSettings(handlers, ws, message, clientInfo, wsServer) {
    try {
        const patch = message.settings;
        if (!patch || typeof patch !== 'object') {
            handlers.sendError(ws, 'Missing settings object', 'update_user_global_settings', message.requestId);
            return;
        }
        const config = handlers.globalResources.getConfig() || {};
        const settingsPatch = { ...patch };
        const generationQuipsPatch = settingsPatch.generationQuips;
        if (generationQuipsPatch) {
            delete settingsPatch.generationQuips;
        }

        const merged = handlers.mergeUserGlobalSettingsPatch(config.userGlobalSettings, settingsPatch);
        await handlers.globalResources.modifyConfig('config', (cfg) => {
            cfg.userGlobalSettings = merged;
            return cfg;
        });
        if (clientInfo && merged.autofillSearch) {
            clientInfo.autofillSearch = merged.autofillSearch;
        }

        let generationQuipsSettings = null;
        if (generationQuipsPatch && typeof generationQuipsPatch === 'object') {
            handlers.globalResources.applyGenerationQuipsSettingsPatch(generationQuipsPatch);
            const manager = handlers.globalResources.getGenerationQuipsManager();
            const byWorkspace = {};
            for (const wsId of Object.keys(generationQuipsPatch.byWorkspace || {})) {
                byWorkspace[wsId] = manager.getAutoUpdateStatus(wsId);
            }
            generationQuipsSettings = { byWorkspace };
        }

        handlers.sendToClient(ws, {
            type: 'update_user_global_settings_response',
            requestId: message.requestId,
            data: {
                success: true,
                settings: generationQuipsSettings
                    ? { ...merged, generationQuips: generationQuipsSettings }
                    : merged
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('update_user_global_settings:', error);
        handlers.sendError(ws, 'Failed to save user settings', error.message, message.requestId);
    }
}

/**
 * Register user global settings WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[200-userSettingsHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'userSettings', ...meta });
    };

    regFn('get_user_global_settings', handleGetUserGlobalSettings);
    regFn('update_user_global_settings', handleUpdateUserGlobalSettings, USER_SETTINGS_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
