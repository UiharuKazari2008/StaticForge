const wsPacketRegistry = require('../wsPacketRegistry');

const CONFIG_EDITOR_DESTRUCTIVE = { destructive: true };

function requireAdmin(clientInfo, handlersCtx, ws, message) {
    if (clientInfo.userType !== 'admin') {
        handlersCtx.sendError(ws, 'Admin access required', 'FORBIDDEN', message.requestId);
        return false;
    }
    return true;
}

function getCheckpointService(handlersCtx) {
    return handlersCtx.globalResources.getCheckpointManagementService();
}

async function handleConfigEditorList(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const configs = handlersCtx.globalResources.getConfigEditorService().listConfigs();
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_list_response',
            requestId: message.requestId,
            data: { configs },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_list:', error);
        handlersCtx.sendError(ws, 'Failed to list configs', error.message, message.requestId);
    }
}

async function handleConfigEditorGetNode(handlersCtx, ws, message, clientInfo, wsServer) {
    const { configId, path } = message;
    if (!configId) {
        handlersCtx.sendError(ws, 'Missing configId', 'config_editor_get_node', message.requestId);
        return;
    }
    try {
        const data = handlersCtx.globalResources.getConfigEditorService().getNode(configId, path || []);
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_get_node_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_get_node:', error);
        handlersCtx.sendError(ws, 'Failed to load config node', error.message, message.requestId);
    }
}

async function handleConfigEditorRevealSecret(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { configId, path } = message;
    if (!configId) {
        handlersCtx.sendError(ws, 'Missing configId', 'config_editor_reveal_secret', message.requestId);
        return;
    }
    if (!Array.isArray(path) || !path.length) {
        handlersCtx.sendError(ws, 'Missing path', 'config_editor_reveal_secret', message.requestId);
        return;
    }
    try {
        const data = handlersCtx.globalResources.getConfigEditorService().revealSecretValue(configId, path);
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_reveal_secret_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_reveal_secret:', error);
        handlersCtx.sendError(ws, 'Failed to reveal secret', error.message, message.requestId);
    }
}

async function handleConfigEditorSearch(handlersCtx, ws, message, clientInfo, wsServer) {
    const { configId, query, maxResults } = message;
    const q = typeof query === 'string' ? query.trim() : '';
    if (!q) {
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_search_response',
            requestId: message.requestId,
            data: { query: '', results: [], truncated: false },
            timestamp: new Date().toISOString()
        });
        return;
    }
    try {
        const data = handlersCtx.globalResources.getConfigEditorService().search(q, {
            configId: configId || null,
            maxResults
        });
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_search_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_search:', error);
        handlersCtx.sendError(ws, 'Failed to search config', error.message, message.requestId);
    }
}

async function handleConfigEditorSave(handlersCtx, ws, message, clientInfo, wsServer) {
    const { patches, createCheckpoint, partialScope } = message;
    if (!patches || typeof patches !== 'object') {
        handlersCtx.sendError(ws, 'Missing patches', 'config_editor_save', message.requestId);
        return;
    }
    try {
        const result = handlersCtx.globalResources.getConfigEditorService().applyPatches(patches, {
            createCheckpoint: createCheckpoint && typeof createCheckpoint === 'object' ? createCheckpoint : undefined,
            partialScope: partialScope && typeof partialScope === 'object' ? partialScope : undefined
        });
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_save_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_save:', error);
        handlersCtx.sendError(ws, 'Failed to save config', error.message, message.requestId);
    }
}

async function handleConfigEditorCheckpointsList(handlersCtx, ws, message, clientInfo, wsServer) {
    try {
        const { configId } = message;
        const data = getCheckpointService(handlersCtx).listCheckpoints(configId || null);
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_checkpoints_list_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_checkpoints_list:', error);
        handlersCtx.sendError(ws, 'Failed to list checkpoints', error.message, message.requestId);
    }
}

async function handleConfigEditorCheckpointsGet(handlersCtx, ws, message, clientInfo, wsServer) {
    const { checkpointId } = message;
    if (!checkpointId) {
        handlersCtx.sendError(ws, 'Missing checkpointId', 'config_editor_checkpoints_get', message.requestId);
        return;
    }
    try {
        const data = getCheckpointService(handlersCtx).getCheckpointDetail(checkpointId);
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_checkpoints_get_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_checkpoints_get:', error);
        handlersCtx.sendError(ws, 'Failed to load checkpoint', error.message, message.requestId);
    }
}

async function handleConfigEditorCheckpointsCreate(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { label } = message;
    try {
        const data = await getCheckpointService(handlersCtx).createCheckpoint({
            label: label || '',
            reason: 'manual',
            createdBy: clientInfo.userType || 'admin'
        });
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_checkpoints_create_response',
            requestId: message.requestId,
            data: { success: true, checkpoint: data },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_checkpoints_create:', error);
        handlersCtx.sendError(ws, 'Failed to create checkpoint', error.message, message.requestId);
    }
}

async function handleConfigEditorCheckpointsRestore(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { checkpointId, createSafetyCheckpoint } = message;
    if (!checkpointId) {
        handlersCtx.sendError(ws, 'Missing checkpointId', 'config_editor_checkpoints_restore', message.requestId);
        return;
    }
    try {
        const data = await getCheckpointService(handlersCtx).restoreCheckpoint(checkpointId, {
            createSafetyCheckpoint: createSafetyCheckpoint !== false,
            createdBy: clientInfo.userType || 'admin'
        });
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_checkpoints_restore_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_checkpoints_restore:', error);
        handlersCtx.sendError(ws, 'Failed to restore checkpoint', error.message, message.requestId);
    }
}

async function handleConfigEditorCheckpointsDelete(handlersCtx, ws, message, clientInfo, wsServer) {
    if (!requireAdmin(clientInfo, handlersCtx, ws, message)) return;
    const { checkpointId } = message;
    if (!checkpointId) {
        handlersCtx.sendError(ws, 'Missing checkpointId', 'config_editor_checkpoints_delete', message.requestId);
        return;
    }
    try {
        const data = getCheckpointService(handlersCtx).deleteCheckpoint(checkpointId);
        handlersCtx.sendToClient(ws, {
            type: 'config_editor_checkpoints_delete_response',
            requestId: message.requestId,
            data,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('config_editor_checkpoints_delete:', error);
        handlersCtx.sendError(ws, 'Failed to delete checkpoint', error.message, message.requestId);
    }
}

/**
 * Register config_editor_* WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[20-configEditorHandler] registerPackets: missing handlersCtx');
        return;
    }

    const reg = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'configEditor', ...meta });
    };

    reg('config_editor_list', handleConfigEditorList);
    reg('config_editor_get_node', handleConfigEditorGetNode);
    reg('config_editor_reveal_secret', handleConfigEditorRevealSecret);
    reg('config_editor_search', handleConfigEditorSearch);
    reg('config_editor_save', handleConfigEditorSave, CONFIG_EDITOR_DESTRUCTIVE);
    reg('config_editor_checkpoints_list', handleConfigEditorCheckpointsList);
    reg('config_editor_checkpoints_get', handleConfigEditorCheckpointsGet);
    reg('config_editor_checkpoints_create', handleConfigEditorCheckpointsCreate, CONFIG_EDITOR_DESTRUCTIVE);
    reg('config_editor_checkpoints_restore', handleConfigEditorCheckpointsRestore, CONFIG_EDITOR_DESTRUCTIVE);
    reg('config_editor_checkpoints_delete', handleConfigEditorCheckpointsDelete, CONFIG_EDITOR_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
