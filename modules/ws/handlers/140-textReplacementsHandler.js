const wsPacketRegistry = require('../wsPacketRegistry');
const { collectTextReplacementSeeds } = require('../../imageGeneration');

const TEXT_REPLACEMENTS_DESTRUCTIVE = { destructive: true };

async function handleGetTextReplacements(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { page = 1, itemsPerPage = 10, searchTerm = '' } = message;

        const allTextReplacements = handlers.globalResources.getPromptConfig({ path: 'text_replacements' }) || {};

        let filteredReplacements = {};
        if (searchTerm && searchTerm.trim() !== '') {
            const searchLower = searchTerm.toLowerCase();
            Object.keys(allTextReplacements).forEach(key => {
                const value = allTextReplacements[key];
                const searchableText = `${key} ${Array.isArray(value) ? value.join(' ') : value}`.toLowerCase();
                if (searchableText.includes(searchLower)) {
                    filteredReplacements[key] = value;
                }
            });
        } else {
            filteredReplacements = { ...allTextReplacements };
        }

        const sortedKeys = Object.keys(filteredReplacements).sort((a, b) =>
            a.toLowerCase().localeCompare(b.toLowerCase())
        );

        const totalItems = sortedKeys.length;
        const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
        const currentPage = Math.min(Math.max(1, page), totalPages);
        const startIndex = (currentPage - 1) * itemsPerPage;
        const endIndex = startIndex + itemsPerPage;

        const pageKeys = sortedKeys.slice(startIndex, endIndex);
        const pageItems = {};
        pageKeys.forEach(key => {
            pageItems[key] = filteredReplacements[key];
        });

        handlers.sendToClient(ws, {
            type: 'get_text_replacements_response',
            data: {
                textReplacements: pageItems,
                pagination: {
                    currentPage: currentPage,
                    totalPages: totalPages,
                    totalItems: totalItems,
                    itemsPerPage: itemsPerPage,
                    hasNextPage: currentPage < totalPages,
                    hasPrevPage: currentPage > 1
                },
                searchTerm: searchTerm
            },
            requestId: message.requestId
        });
    } catch (error) {
        console.error('Error getting text replacements:', error);
        handlers.sendError(ws, 'Failed to get text replacements', error.message, message.requestId);
    }
}

async function handleSaveTextReplacements(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { textReplacements } = message;

        if (!textReplacements || typeof textReplacements !== 'object' || Array.isArray(textReplacements)) {
            handlers.sendError(ws, 'Invalid text replacements data', 'textReplacements must be an object', message.requestId);
            return;
        }

        for (const [key, value] of Object.entries(textReplacements)) {
            if (typeof key !== 'string' || !key.trim()) {
                handlers.sendError(ws, 'Invalid key', 'Text replacement keys must be non-empty strings', message.requestId);
                return;
            }

            if (typeof value === 'string') {
                continue;
            } else if (Array.isArray(value)) {
                if (!value.every(v => typeof v === 'string')) {
                    handlers.sendError(ws, 'Invalid value', `Text replacement "${key}" contains non-string array values`, message.requestId);
                    return;
                }
            } else {
                handlers.sendError(ws, 'Invalid value', `Text replacement "${key}" must be a string or array of strings`, message.requestId);
                return;
            }
        }

        const success = handlers.globalResources.modifyConfig('promptConfig').merge('text_replacements', textReplacements);

        if (success) {
            handlers.globalResources.rebuildPresetTokenCounts();

            handlers.sendToClient(ws, {
                type: 'save_text_replacements_response',
                data: {
                    success: true
                },
                requestId: message.requestId
            });

            const savedKeys = Object.keys(textReplacements);
            if (savedKeys.length === 1) {
                console.log(`✅ Text replacement "${savedKeys[0]}" saved successfully`);
            } else {
                console.log(`✅ ${savedKeys.length} text replacements saved successfully`);
            }
        } else {
            handlers.sendToClient(ws, {
                type: 'save_text_replacements_response',
                data: {
                    success: false,
                    error: 'Failed to save configuration file'
                },
                requestId: message.requestId
            });
        }
    } catch (error) {
        console.error('Error saving text replacements:', error);
        handlers.sendToClient(ws, {
            type: 'save_text_replacements_response',
            data: {
                success: false,
                error: error.message
            },
            requestId: message.requestId
        });
    }
}

async function handleDeleteTextReplacement(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { key } = message;

        if (!key || typeof key !== 'string') {
            handlers.sendError(ws, 'Invalid key', 'Text replacement key is required', message.requestId);
            return;
        }

        const textReplacements = handlers.globalResources.getPromptConfig({ path: 'text_replacements' }) || {};

        if (!textReplacements.hasOwnProperty(key)) {
            handlers.sendError(ws, 'Key not found', `Text replacement "${key}" not found`, message.requestId);
            return;
        }

        const success = handlers.globalResources.modifyConfig('promptConfig').delete(['text_replacements', key]);

        if (success) {
            handlers.sendToClient(ws, {
                type: 'delete_text_replacement_response',
                data: {
                    success: true,
                    deletedKey: key
                },
                requestId: message.requestId
            });

            console.log(`🗑️ Text replacement "${key}" deleted successfully`);
        } else {
            handlers.sendToClient(ws, {
                type: 'delete_text_replacement_response',
                data: {
                    success: false,
                    error: 'Failed to save configuration file'
                },
                requestId: message.requestId
            });
        }
    } catch (error) {
        console.error('Error deleting text replacement:', error);
        handlers.sendToClient(ws, {
            type: 'delete_text_replacement_response',
            data: {
                success: false,
                error: error.message
            },
            requestId: message.requestId
        });
    }
}

async function handleCreateTextReplacement(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { key, value, type } = message;

        if (!key || typeof key !== 'string' || key.trim() === '') {
            handlers.sendError(ws, 'Invalid key', 'Text replacement key is required and cannot be empty', message.requestId);
            return;
        }

        if (value === undefined || value === null) {
            handlers.sendError(ws, 'Invalid value', 'Text replacement value is required', message.requestId);
            return;
        }

        if (!type || !['string', 'array'].includes(type)) {
            handlers.sendError(ws, 'Invalid type', 'Type must be either "string" or "array"', message.requestId);
            return;
        }

        const textReplacements = handlers.globalResources.getPromptConfig({ path: 'text_replacements' }) || {};
        if (textReplacements.hasOwnProperty(key)) {
            handlers.sendError(ws, 'Key already exists', `Text replacement "${key}" already exists`, message.requestId);
            return;
        }

        const newValue = type === 'array' ? (Array.isArray(value) ? value : [value]) : value;
        const success = handlers.globalResources.modifyConfig('promptConfig').assign(['text_replacements', key], newValue);

        if (success) {
            handlers.sendToClient(ws, {
                type: 'create_text_replacement_response',
                data: {
                    success: true,
                    key: key,
                    value: newValue,
                    type: type
                },
                requestId: message.requestId
            });

            console.log(`✅ Text replacement "${key}" created successfully`);
        } else {
            handlers.sendToClient(ws, {
                type: 'create_text_replacement_response',
                data: {
                    success: false,
                    error: 'Failed to save configuration file'
                },
                requestId: message.requestId
            });
        }
    } catch (error) {
        console.error('Error creating text replacement:', error);
        handlers.sendToClient(ws, {
            type: 'create_text_replacement_response',
            data: {
                success: false,
                error: error.message
            },
            requestId: message.requestId
        });
    }
}

async function handleScanTextReplacements(handlers, ws, message, clientInfo, wsServer) {
    try {
        const body = message.data || message;
        const currentPromptConfig = handlers.globalResources.getPromptConfig({ clone: true });
        let preset = null;
        if (body.presetName && currentPromptConfig.presets[body.presetName]) {
            preset = currentPromptConfig.presets[body.presetName];
        }

        const text_replacements_seed = collectTextReplacementSeeds(handlers.globalResources, body, preset);

        handlers.sendToClient(ws, {
            type: 'scan_text_replacements_response',
            data: {
                success: true,
                text_replacements_seed
            },
            requestId: message.requestId
        });
    } catch (error) {
        console.error('Error scanning text replacements:', error);
        handlers.sendToClient(ws, {
            type: 'scan_text_replacements_response',
            data: {
                success: false,
                error: error.message
            },
            requestId: message.requestId
        });
    }
}

async function handleGetTextReplacementOptions(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { pattern, presetName, model, periodKey } = message;

        if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
            handlers.sendError(ws, 'Invalid pattern', 'Text replacement pattern is required and cannot be empty', message.requestId);
            return;
        }

        const options = handlers.globalResources.getTextReplacements().getTextReplacementOptions(pattern, presetName, model, periodKey);

        handlers.sendToClient(ws, {
            type: 'get_text_replacement_options_response',
            data: {
                success: true,
                pattern: pattern,
                options: options
            },
            requestId: message.requestId
        });

    } catch (error) {
        console.error('Error getting text replacement options:', error);
        handlers.sendToClient(ws, {
            type: 'get_text_replacement_options_response',
            data: {
                success: false,
                error: error.message
            },
            requestId: message.requestId
        });
    }
}

/**
 * Register text replacement WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[140-textReplacementsHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'textReplacements', ...meta });
    };

    regFn('get_text_replacements', handleGetTextReplacements);
    regFn('save_text_replacements', handleSaveTextReplacements, TEXT_REPLACEMENTS_DESTRUCTIVE);
    regFn('get_text_replacement_options', handleGetTextReplacementOptions, TEXT_REPLACEMENTS_DESTRUCTIVE);
    regFn('scan_text_replacements', handleScanTextReplacements, TEXT_REPLACEMENTS_DESTRUCTIVE);
    regFn('delete_text_replacement', handleDeleteTextReplacement, TEXT_REPLACEMENTS_DESTRUCTIVE);
    regFn('create_text_replacement', handleCreateTextReplacement, TEXT_REPLACEMENTS_DESTRUCTIVE);
}

module.exports = {
    registerPackets
};
