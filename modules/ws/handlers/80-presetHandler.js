const wsPacketRegistry = require('../wsPacketRegistry');
const { generateImageWebSocket } = require('../../imageGeneration');
const { broadcastGalleryMutation } = require('./120-galleryHandler');

const PRESET_DESTRUCTIVE = { destructive: true };

async function handlePresetSearch(handlers, ws, message, clientInfo, wsServer) {
    const { query } = message;

    if (!query) {
        handlers.sendError(ws, 'Missing query parameter', 'search_presets');
        return;
    }

    try {
        const result = await handlers.globalResources.getSearchService().searchPresets(query);

        handlers.sendToClient(ws, {
            type: 'search_presets_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Preset search error:', error);
        handlers.sendError(ws, 'Search failed', error.message, message.requestId);
    }
}

async function handleLoadPreset(handlers, ws, message, clientInfo, wsServer) {
    const { presetName, presetUuid } = message;

    if (!presetName && !presetUuid) {
        handlers.sendError(ws, 'Missing presetName or presetUuid parameter', 'load_preset');
        return;
    }

    try {
        const currentPromptConfig = handlers.globalResources.getPromptConfig();
        let preset, actualPresetName;

        if (presetUuid) {
            const resolution = handlers.globalResources.getTextReplacements().resolvePresetOrGroup(presetUuid);
            if (!resolution) {
                handlers.sendError(ws, 'Preset or preset group not found', `Preset or preset group with UUID "${presetUuid}" does not exist`, message.requestId);
                return;
            }
            preset = resolution.preset;
            actualPresetName = resolution.presetName;
        } else {
            preset = currentPromptConfig.presets[presetName];
            if (!preset) {
                handlers.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }
            actualPresetName = presetName;
        }

        const presetData = {
            ...preset,
            preset_name: actualPresetName,
        };

        handlers.sendToClient(ws, {
            type: 'load_preset_response',
            requestId: message.requestId,
            data: presetData,
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Preset load error:', error);
        handlers.sendError(ws, 'Failed to load preset', error.message, message.requestId);
    }
}

async function handleSavePreset(handlers, ws, message, clientInfo, wsServer) {
    const { presetName, config } = message;

    if (!presetName || !config || !config.prompt || !config.model) {
        handlers.sendError(ws, 'Missing required parameters', 'Preset name, prompt, and model are required', message.requestId);
        return;
    }

    try {
        const existingPreset = handlers.globalResources.getPromptConfig({ path: ['presets', presetName] });

        if (!config.uuid) {
            config.uuid = existingPreset?.uuid || handlers.generateUUID();
        }

        if (existingPreset?.target_workspace) {
            config.target_workspace = existingPreset.target_workspace;
        } else if (!config.target_workspace || config.target_workspace === 'default') {
            const activeWorkspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            config.target_workspace = activeWorkspaceId;
        }

        const success = handlers.globalResources.modifyConfig('promptConfig').assign(['presets', presetName], config);
        if (success) {
            console.log(`💾 Saved new preset: ${presetName}`);
        } else {
            throw new Error('Failed to save preset configuration');
        }

        handlers.sendToClient(ws, {
            type: 'save_preset_response',
            requestId: message.requestId,
            data: { success: true, message: `Preset "${presetName}" saved successfully` },
            timestamp: new Date().toISOString()
        });

        wsServer.clients.forEach(client => {
            if (client.readyState === 1) {
                handlers.sendToClient(client, {
                    type: 'preset_updated',
                    data: {
                        action: 'saved',
                        presetName: presetName,
                        message: `Preset "${presetName}" has been updated`
                    },
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error('Preset save error:', error);
        handlers.sendError(ws, 'Failed to save preset', error.message, message.requestId);
    }
}

async function handleGetPresets(handlers, ws, message, clientInfo, wsServer) {
    const { page = 1, itemsPerPage = 15, searchTerm = '' } = message;

    try {
        const presets = handlers.globalResources.getPromptConfig({ path: 'presets' }) || {};

        let filteredPresets = presets;
        if (searchTerm) {
            filteredPresets = {};
            Object.keys(presets).forEach(presetName => {
                const preset = presets[presetName];
                if (presetName.toLowerCase().includes(searchTerm.toLowerCase()) ||
                    (preset.prompt && preset.prompt.toLowerCase().includes(searchTerm.toLowerCase()))) {
                    filteredPresets[presetName] = preset;
                }
            });
        }

        const presetKeys = Object.keys(filteredPresets);
        const totalItems = presetKeys.length;
        const totalPages = Math.ceil(totalItems / itemsPerPage);
        const startIndex = (page - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;
        const pageKeys = presetKeys.slice(startIndex, endIndex);

        const pagePresets = {};
        pageKeys.forEach(key => {
            pagePresets[key] = filteredPresets[key];
        });

        handlers.sendToClient(ws, {
            type: 'get_presets_response',
            requestId: message.requestId,
            data: {
                presets: pagePresets,
                pagination: {
                    currentPage: page,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    itemsPerPage: itemsPerPage,
                    hasNextPage: page < totalPages,
                    hasPrevPage: page > 1
                },
                searchTerm: searchTerm
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Get presets error:', error);
        handlers.sendError(ws, 'Failed to get presets', error.message, message.requestId);
    }
}

async function handleUpdatePreset(handlers, ws, message, clientInfo, wsServer) {
    const { presetName, name, target_workspace, resolution, request_upscale } = message;

    if (!presetName) {
        handlers.sendError(ws, 'Missing required parameters', 'Preset name is required', message.requestId);
        return;
    }

    try {
        const existingPreset = handlers.globalResources.getPromptConfig({ path: ['presets', presetName], clone: true });

        if (!existingPreset) {
            handlers.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
            return;
        }

        const activeWorkspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const updates = {};

        if (name !== undefined) updates.name = name;
        if (target_workspace !== undefined) {
            updates.target_workspace = target_workspace;
        } else if (!existingPreset.target_workspace || existingPreset.target_workspace === 'default') {
            updates.target_workspace = activeWorkspaceId;
        }
        if (resolution !== undefined) updates.resolution = resolution;
        if (request_upscale !== undefined) updates.request_upscale = request_upscale;

        let success;
        if (name && name !== presetName) {
            const newPreset = { ...existingPreset, ...updates };
            success = handlers.globalResources.modifyConfig('promptConfig', (cfg) => {
                delete cfg.presets[presetName];
                cfg.presets[name] = newPreset;
                return cfg;
            });
        } else {
            success = handlers.globalResources.modifyConfig('promptConfig').merge(['presets', presetName], updates);
        }
        if (success) {
            console.log(`💾 Updated preset: ${presetName} -> ${name} with UUID: ${uuid}`);
        } else {
            throw new Error('Failed to update preset configuration');
        }

        handlers.sendToClient(ws, {
            type: 'update_preset_response',
            requestId: message.requestId,
            data: { success: true, message: `Preset "${presetName}" updated successfully`, uuid },
            timestamp: new Date().toISOString()
        });

        wsServer.clients.forEach(client => {
            if (client.readyState === 1) {
                handlers.sendToClient(client, {
                    type: 'preset_updated',
                    data: {
                        action: 'updated',
                        presetName: name,
                        message: `Preset "${presetName}" has been updated to "${name}"`
                    },
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error('Update preset error:', error);
        handlers.sendError(ws, 'Failed to update preset', error.message, message.requestId);
    }
}

async function handleRegeneratePresetUuid(handlers, ws, message, clientInfo, wsServer) {
    const { presetName } = message;

    if (!presetName) {
        handlers.sendError(ws, 'Missing presetName parameter', 'regenerate_preset_uuid');
        return;
    }

    try {
        const currentPromptConfig = handlers.globalResources.getPromptConfig();
        if (!currentPromptConfig.presets[presetName]) {
            handlers.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
            return;
        }

        const newUuid = handlers.generateUUID();

        const success = handlers.globalResources.modifyConfig('promptConfig').assign(['presets', presetName, 'uuid'], newUuid);
        if (success) {
            console.log(`🔄 Regenerated UUID for preset: ${presetName} -> ${newUuid}`);
        } else {
            throw new Error('Failed to save preset configuration');
        }

        handlers.sendToClient(ws, {
            type: 'regenerate_preset_uuid_response',
            requestId: message.requestId,
            data: { success: true, message: `UUID regenerated for preset "${presetName}"`, uuid: newUuid },
            timestamp: new Date().toISOString()
        });

        wsServer.clients.forEach(client => {
            if (client.readyState === 1) {
                handlers.sendToClient(client, {
                    type: 'preset_updated',
                    data: {
                        action: 'uuid_regenerated',
                        presetName: presetName,
                        message: `UUID regenerated for preset "${presetName}"`
                    },
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error('Regenerate preset UUID error:', error);
        handlers.sendError(ws, 'Failed to regenerate preset UUID', error.message, message.requestId);
    }
}

async function handleSavePresetGroup(handlers, ws, message, clientInfo, wsServer) {
    const { groupName, groupData } = message;

    if (!groupName || !groupData) {
        handlers.sendError(ws, 'Missing required parameters', 'Group name and data are required', message.requestId);
        return;
    }

    try {
        const currentPromptConfig = handlers.globalResources.getPromptConfig();

        if (!groupData.uuid) {
            if (currentPromptConfig.preset_group?.[groupName]?.uuid) {
                groupData.uuid = currentPromptConfig.preset_group[groupName].uuid;
            } else {
                groupData.uuid = handlers.generateUUID();
            }
        }

        if (!groupData.name) {
            groupData.name = groupName;
        }

        if (!groupData.presets) {
            groupData.presets = [];
        }

        const validPresets = groupData.presets.filter(presetUuid => {
            const presetExists = Object.values(currentPromptConfig.presets || {}).some(preset => preset.uuid === presetUuid);
            if (!presetExists) {
                console.warn(`⚠️ Preset group "${groupName}" references non-existent preset UUID: ${presetUuid}`);
            }
            return presetExists;
        });

        groupData.presets = validPresets;

        const success = handlers.globalResources.modifyConfig('promptConfig').assign(['preset_group', groupName], groupData);
        if (success) {
            console.log(`💾 Saved preset group: ${groupName}`);
        } else {
            throw new Error('Failed to save preset group configuration');
        }

        handlers.sendToClient(ws, {
            type: 'save_preset_group_response',
            requestId: message.requestId,
            data: { success: true, message: `Preset group "${groupName}" saved successfully` },
            timestamp: new Date().toISOString()
        });

        wsServer.clients.forEach(client => {
            if (client.readyState === 1) {
                handlers.sendToClient(client, {
                    type: 'preset_group_updated',
                    data: {
                        action: 'saved',
                        groupName: groupName,
                        message: `Preset group "${groupName}" has been saved`
                    },
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error('Preset group save error:', error);
        handlers.sendError(ws, 'Failed to save preset group', error.message, message.requestId);
    }
}

async function handleDeletePresetGroup(handlers, ws, message, clientInfo, wsServer) {
    const { groupName } = message;

    if (!groupName) {
        handlers.sendError(ws, 'Missing groupName parameter', 'delete_preset_group');
        return;
    }

    try {
        const presetGroup = handlers.globalResources.getPromptConfig({ path: ['preset_group', groupName] });

        if (!presetGroup) {
            handlers.sendError(ws, 'Preset group not found', `Preset group "${groupName}" does not exist`, message.requestId);
            return;
        }

        const success = handlers.globalResources.modifyConfig('promptConfig').delete(['preset_group', groupName]);
        if (success) {
            console.log(`🗑️ Deleted preset group: ${groupName}`);
        } else {
            throw new Error('Failed to save preset group configuration');
        }

        handlers.sendToClient(ws, {
            type: 'delete_preset_group_response',
            requestId: message.requestId,
            data: { success: true, message: `Preset group "${groupName}" deleted successfully` },
            timestamp: new Date().toISOString()
        });

        wsServer.clients.forEach(client => {
            if (client.readyState === 1) {
                handlers.sendToClient(client, {
                    type: 'preset_group_updated',
                    data: {
                        action: 'deleted',
                        groupName: groupName,
                        message: `Preset group "${groupName}" has been deleted`
                    },
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error('Preset group deletion error:', error);
        handlers.sendError(ws, 'Failed to delete preset group', error.message, message.requestId);
    }
}

async function handleGetPresetGroups(handlers, ws, message, clientInfo, wsServer) {
    try {
        const presetGroups = handlers.globalResources.getPromptConfig({ path: 'preset_group' }) || {};

        const groupsArray = Object.entries(presetGroups).map(([groupName, groupData]) => ({
            name: groupName,
            uuid: groupData.uuid,
            displayName: groupData.name || groupName,
            presetCount: groupData.presets ? groupData.presets.length : 0,
            presets: groupData.presets || []
        }));

        handlers.sendToClient(ws, {
            type: 'get_preset_groups_response',
            requestId: message.requestId,
            data: {
                presetGroups: groupsArray,
                totalCount: groupsArray.length
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Get preset groups error:', error);
        handlers.sendError(ws, 'Failed to get preset groups', error.message, message.requestId);
    }
}

async function handleDeletePreset(handlers, ws, message, clientInfo, wsServer) {
    const { presetName } = message;

    if (!presetName) {
        handlers.sendError(ws, 'Missing presetName parameter', 'delete_preset');
        return;
    }

    try {
        const preset = handlers.globalResources.getPromptConfig({ path: ['presets', presetName] });

        if (!preset) {
            handlers.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
            return;
        }

        const success = handlers.globalResources.modifyConfig('promptConfig').delete(['presets', presetName]);
        if (success) {
            console.log(`🗑️ Deleted preset: ${presetName}`);
        } else {
            throw new Error('Failed to save preset configuration');
        }

        handlers.sendToClient(ws, {
            type: 'delete_preset_response',
            requestId: message.requestId,
            data: { success: true, message: `Preset "${presetName}" deleted successfully` },
            timestamp: new Date().toISOString()
        });

        wsServer.clients.forEach(client => {
            if (client.readyState === 1) {
                handlers.sendToClient(client, {
                    type: 'preset_updated',
                    data: {
                        action: 'deleted',
                        presetName: presetName,
                        message: `Preset "${presetName}" has been deleted`
                    },
                    timestamp: new Date().toISOString()
                });
            }
        });
    } catch (error) {
        console.error('Preset deletion error:', error);
        handlers.sendError(ws, 'Failed to delete preset', error.message, message.requestId);
    }
}

async function handleGeneratePreset(handlers, ws, message, clientInfo, wsServer) {
    const { presetName, allow_paid, workspace, enableStreaming } = message;
    const requestId = message.requestId || 'unknown';

    if (!presetName) {
        handlers.sendError(ws, 'Missing presetName parameter', 'generate_preset');
        return;
    }

    try {
        const preset = handlers.globalResources.getPromptConfig({ path: ['presets', presetName] });

        if (!preset) {
            handlers.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
            return;
        }

        handlers.registerActiveGeneration(ws, requestId);

        const targetWorkspace = workspace || (preset.target_workspace && preset.target_workspace !== 'default' ? preset.target_workspace : handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId));

        let streamingCallback = null;
        if (enableStreaming) {
            console.log('🎬 Starting streaming preset generation...');
            streamingCallback = async (event) => {
                if (event.type === 'intermediate') {
                    /* handlers.sendToClient(ws, {
                        type: 'image_generation_intermediate',
                        requestId: message.requestId,
                        data: {
                            step: event.step,
                            image: event.image.toString('base64'),
                            timestamp: event.timestamp
                        },
                        timestamp: new Date().toISOString()
                    }); */
                }
            };
        }

        const result = await generateImageWebSocket(handlers.globalResources, {
            ...preset,
            workspace: targetWorkspace,
            presetName: presetName,
            allow_paid: allow_paid,
            requestId,
            stepPreviewWidth: message.stepPreviewWidth,
            stepPreviewHeight: message.stepPreviewHeight
        }, clientInfo.userType, clientInfo.sessionId, streamingCallback, ws, handlers, wsServer);

        const contentLength = handlers.resolveGeneratedImageContentLength(result);
        handlers.sendToClient(ws, {
            type: 'generate_preset_response',
            requestId: requestId,
            data: {
                filename: result.filename,
                seed: result.seed,
                saved: result.saved,
                presetName: presetName,
                workspace: targetWorkspace,
                contentLength,
                message: `Generation completed for preset "${presetName}"`
            },
            timestamp: new Date().toISOString()
        });

        if (result && result.filename) {
            await broadcastGalleryMutation(handlers, wsServer, clientInfo, {
                viewType: 'images',
                action: 'append_top',
                filenames: [result.filename],
                workspaceId: targetWorkspace
            });
        }

    } catch (error) {
        console.error('Preset generation error:', error);
        handlers.sendError(ws, 'Failed to generate preset', error.message, message.requestId);
    } finally {
        handlers.unregisterActiveGeneration(ws, requestId);
        handlers.clearGenerationCancelled(requestId);
    }
}

/**
 * Register preset-related WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[80-presetHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(handlersCtx, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'presets', ...meta });
    };

    regFn('search_presets', handlePresetSearch);
    regFn('load_preset', handleLoadPreset);
    regFn('save_preset', handleSavePreset, PRESET_DESTRUCTIVE);
    regFn('generate_preset', handleGeneratePreset, PRESET_DESTRUCTIVE);
    regFn('delete_preset', handleDeletePreset, PRESET_DESTRUCTIVE);
    regFn('get_presets', handleGetPresets);
    regFn('update_preset', handleUpdatePreset, PRESET_DESTRUCTIVE);
    regFn('regenerate_preset_uuid', handleRegeneratePresetUuid, PRESET_DESTRUCTIVE);
    regFn('save_preset_group', handleSavePresetGroup, PRESET_DESTRUCTIVE);
    regFn('delete_preset_group', handleDeletePresetGroup, PRESET_DESTRUCTIVE);
    regFn('get_preset_groups', handleGetPresetGroups);
}

module.exports = {
    registerPackets
};
