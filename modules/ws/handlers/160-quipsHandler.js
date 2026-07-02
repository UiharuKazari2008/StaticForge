const wsPacketRegistry = require('../wsPacketRegistry');

const QUIPS_DESTRUCTIVE = { destructive: true };

async function handleGetAppOptions(handlersCtx, ws, message, clientInfo, wsServer) {
    const startTime = Date.now();

    try {
        const currentPromptConfig = handlersCtx.globalResources.getPromptConfig();

        const modelEntries = Object.keys((handlersCtx.globalResources.getNekoAiService('Model')))
            .filter(key => !key.endsWith('_INP'))
            .map(key => [key, handlersCtx.globalResources.getPngMetadata().getModelDisplayName(key)]);
        const modelEntriesShort = Object.keys((handlersCtx.globalResources.getNekoAiService('Model')))
            .filter(key => !key.endsWith('_INP'))
            .map(key => [key, handlersCtx.globalResources.getPngMetadata().getModelDisplayName(key, true)]);
        const imageCount = handlersCtx.globalResources.getImageCounter().getCount();

        const extractPresetInfo = (name, preset) => ({
            name,
            model: preset.model || 'V4_5',
            upscale: preset.upscale || preset.request_upscale || false,
            allow_paid: preset.allow_paid || false,
            variety: preset.variety || false,
            character_prompts: preset.characterPrompts ? preset.characterPrompts.length : 0,
            base_image: preset.base_image || false,
            resolution: preset.resolution || null,
            steps: preset.steps || 25,
            guidance: preset.guidance || 5.0,
            rescale: preset.rescale || 0.0,
            sampler: preset.sampler || null,
            noiseScheduler: preset.noiseScheduler || null,
            image: !!(preset.image || preset.image_source || null),
            strength: preset.strength || 0.0,
            noise: preset.noise || 0.0,
            image_bias: preset.image_bias || null,
            mask_compressed: !!(preset.mask_compressed || null),
            dataset_config: preset.dataset_config || null,
            append_quality: preset.append_quality || false,
            append_uc: preset.append_uc !== undefined && preset.append_uc !== null ? preset.append_uc : null,
            vibe_transfer: preset.vibe_transfer ? preset.vibe_transfer.length : 0,
            request_upscale: preset.request_upscale || false,
            target_workspace: preset.target_workspace || null,
        });

        const detailedPresets = Object.entries(currentPromptConfig.presets || {}).map(
            ([name, preset]) => extractPresetInfo(name, preset)
        );

        const accountData = handlersCtx.globalResources.getAccountData();
        const accountBalance = handlersCtx.globalResources.getAccountBalance();

        const activeWorkspaceId = handlersCtx.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const activeWorkspaceData = handlersCtx.globalResources.getWorkspaceManager().getActiveWorkspaceData(clientInfo.sessionId);

        const options = {
            ok: true,
            user: accountData,
            balance: accountBalance,
            presets: detailedPresets,
            queue_status: handlersCtx.globalResources.getQueue().getStatus(),
            image_count: imageCount,
            models: Object.fromEntries(modelEntries),
            modelsShort: Object.fromEntries(modelEntriesShort),
            actions: Object.fromEntries(Object.keys((handlersCtx.globalResources.getNekoAiService('Action'))).map(key => [key, (handlersCtx.globalResources.getNekoAiService('Action'))[key]])),
            samplers: Object.fromEntries(Object.keys(handlersCtx.globalResources.getNekoAiService('Sampler')).map(key => [key, handlersCtx.globalResources.getNekoAiService('Sampler')[key]])),
            noiseSchedulers: Object.fromEntries(Object.keys(handlersCtx.globalResources.getNekoAiService('Noise')).map(key => [key, handlersCtx.globalResources.getNekoAiService('Noise')[key]])),
            resolutions: Object.fromEntries(Object.keys(handlersCtx.globalResources.getNekoAiService('Resolution')).map(key => [key, handlersCtx.globalResources.getNekoAiService('Resolution')[key]])),
            textReplacements: currentPromptConfig.text_replacements || {},
            text_tags: currentPromptConfig.text_tags || {},
            datasets: currentPromptConfig.datasets || [],
            quality_presets: currentPromptConfig.quality_presets || {},
            uc_presets: currentPromptConfig.uc_presets || {},
            nsfw_presets: currentPromptConfig.nsfw_presets || {},
            preset_token_counts: handlersCtx.globalResources.getPresetTokenCounts(),
            activeWorkspace: activeWorkspaceData ? {
                id: activeWorkspaceId,
                data: activeWorkspaceData
            } : null
        };
        options.defaultGrokModel = handlersCtx.globalResources.getGrokService().getDefaultGrokModel();

        handlersCtx.sendToClient(ws, {
            type: 'get_app_options_response',
            requestId: message.requestId,
            data: options,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        const totalTime = Date.now() - startTime;
        console.error(`❌ App options request error after ${totalTime}ms:`, error);
        handlersCtx.sendError(ws, 'Failed to load app options', error.message, message.requestId);
    }
}

async function handleGetGenerationQuips(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const payload = handlersCtx.globalResources.getGenerationQuipsManager().getClientPayload();
        handlersCtx.sendToClient(ws, {
            type: 'get_generation_quips_response',
            requestId: message.requestId,
            data: payload,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Generation quips request error:', error);
        handlersCtx.sendError(ws, 'Failed to load generation quips', error.message, message.requestId);
    }
}

async function handleGetGenerationQuipsStatus(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const activeWorkspaceId = handlersCtx.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const status = handlersCtx.globalResources.getGenerationQuipsManager().getStatus(activeWorkspaceId);
        handlersCtx.sendToClient(ws, {
            type: 'get_generation_quips_status_response',
            requestId: message.requestId,
            data: status,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Generation quips status error:', error);
        handlersCtx.sendError(ws, 'Failed to load generation quips status', error.message, message.requestId);
    }
}

async function handleGenerationQuipsRun(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const manager = handlersCtx.globalResources.getGenerationQuipsManager();
        const scopeAll = message.scope === 'all' || message.allWorkspaces === true;
        const activeWorkspaceId = handlersCtx.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const workspaceFilter = scopeAll ? null : (message.workspaceId || activeWorkspaceId);
        const autoSettings = manager.getAutoUpdateUserSettings(workspaceFilter || activeWorkspaceId);

        const result = manager.startPipelineInBackground({
            workspaceFilter,
            extractOnly: message.extractOnly === true,
            generateOnly: message.generateOnly === true,
            limit: message.termLimit != null ? message.termLimit : autoSettings.termLimit,
            grokBatchSize: message.grokBatchSize != null ? message.grokBatchSize : autoSettings.grokBatchSize,
            phrasesPerTerm: message.phrasesPerTerm != null ? message.phrasesPerTerm : autoSettings.phrasesPerTerm
        }, wsServer);

        handlersCtx.sendToClient(ws, {
            type: 'generation_quips_run_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Generation quips run error:', error);
        handlersCtx.sendError(ws, 'Failed to start quip scan', error.message, message.requestId);
    }
}

async function handleGenerationQuipsClear(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const manager = handlersCtx.globalResources.getGenerationQuipsManager();
        const activeWorkspaceId = handlersCtx.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const workspaceId = message.workspaceId || activeWorkspaceId;
        const result = manager.clearWorkspaceQuips(workspaceId, wsServer);

        handlersCtx.sendToClient(ws, {
            type: 'generation_quips_clear_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Generation quips clear error:', error);
        handlersCtx.sendError(ws, 'Failed to clear workspace quips', error.message, message.requestId);
    }
}

async function handleGetGenerationQuipsWiki(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const manager = handlersCtx.globalResources.getGenerationQuipsManager();
        const activeWorkspaceId = message.workspaceId
            || handlersCtx.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const viewAll = !!message.viewAll;
        const targetWorkspaceId = message.workspaceId || activeWorkspaceId;
        const html = manager.buildWikiHtml({
            workspaceId: viewAll ? null : targetWorkspaceId,
            viewAll
        });
        const workspaces = handlersCtx.globalResources.getWorkspaceManager().getWorkspaces();
        const title = viewAll
            ? 'Generation Quips — All Workspaces'
            : `Generation Quips — ${workspaces[targetWorkspaceId]?.name || targetWorkspaceId}`;

        handlersCtx.sendToClient(ws, {
            type: 'get_generation_quips_wiki_response',
            requestId: message.requestId,
            data: { html, title, workspaceId: targetWorkspaceId, viewAll },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('❌ Generation quips wiki error:', error);
        handlersCtx.sendError(ws, 'Failed to load generation quips wiki', error.message, message.requestId);
    }
}

/**
 * Register app options and generation quips WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[160-quipsHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, owner, handlerFn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await handlerFn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner, ...meta });
    };

    reg('get_app_options', 'app', handleGetAppOptions);

    reg('get_generation_quips', 'quips', handleGetGenerationQuips);
    reg('get_generation_quips_status', 'quips', handleGetGenerationQuipsStatus);
    reg('get_generation_quips_wiki', 'quips', handleGetGenerationQuipsWiki);
    reg('generation_quips_run', 'quips', handleGenerationQuipsRun, QUIPS_DESTRUCTIVE);
    reg('generation_quips_clear', 'quips', handleGenerationQuipsClear, QUIPS_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
