const { SearchService } = require('./textReplacements');
const DatasetTagService = require('./datasetTagService');

// WebSocket message handlers
class WebSocketMessageHandlers {
    constructor(context = {}) {
        this.searchService = new SearchService(context);
        this.datasetTagService = new DatasetTagService();
        this.context = context;
    }

    // Set dependencies
    setSpellChecker(spellChecker) {
        this.searchService.setSpellChecker(spellChecker);
    }

    setContext(context) {
        this.context = context;
        this.searchService.setContext(context);
    }

    // Main message handler
    async handleMessage(ws, message, clientInfo, wsServer) {
        try {
            // Check if client is authenticated
            if (!clientInfo || !clientInfo.authenticated) {
                wsServer.sendToClient(ws, {
                    type: 'auth_error',
                    message: 'Authentication required',
                    code: 'AUTH_REQUIRED',
                    timestamp: new Date().toISOString()
                });
                return;
            }

            switch (message.type) {
                case 'search_characters':
                    await this.handleCharacterSearch(ws, message, clientInfo, wsServer);
                    break;
                
                case 'search_presets':
                    await this.handlePresetSearch(ws, message, clientInfo, wsServer);
                    break;
                
                case 'search_dataset_tags':
                    await this.handleDatasetTagSearch(ws, message, clientInfo, wsServer);
                    break;
                
                case 'get_dataset_tags_for_path':
                    await this.handleGetDatasetTagsForPath(ws, message, clientInfo, wsServer);
                    break;
                
                case 'spellcheck_add_word':
                    await this.handleAddWordToDictionary(ws, message, clientInfo, wsServer);
                    break;
                
                case 'ping':
                    this.handlePing(ws, message, clientInfo, wsServer);
                    break;
                
                case 'subscribe':
                    this.handleSubscribe(ws, message, clientInfo, wsServer);
                    break;
                
                default:
                    this.sendError(ws, 'Unknown message type', message.type);
            }
        } catch (error) {
            console.error('WebSocket message handler error:', error);
            this.sendError(ws, 'Internal server error', error.message);
        }
    }

    // Handle character search requests
    async handleCharacterSearch(ws, message, clientInfo, wsServer) {
        const { query, model } = message;
        
        if (!query) {
            this.sendError(ws, 'Missing query parameter', 'search_characters');
            return;
        }

        try {
            // Send initial response to show autocomplete dropdown
            this.sendToClient(ws, {
                type: 'search_characters_response',
                requestId: message.requestId,
                data: { results: [], spellCheck: null },
                timestamp: new Date().toISOString()
            });
            
            // Perform search with WebSocket for realtime updates
            const result = await this.searchService.searchCharacters(query, model, ws);
            
            // Send final complete response
            this.sendToClient(ws, {
                type: 'search_characters_complete',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Character search error:', error);
            this.sendError(ws, 'Search failed', error.message, message.requestId);
        }
    }

    // Handle preset search requests
    async handlePresetSearch(ws, message, clientInfo, wsServer) {
        const { query } = message;
        
        if (!query) {
            this.sendError(ws, 'Missing query parameter', 'search_presets');
            return;
        }

        try {
            const result = await this.searchService.searchPresets(query);
            
            this.sendToClient(ws, {
                type: 'search_presets_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Preset search error:', error);
            this.sendError(ws, 'Search failed', error.message, message.requestId);
        }
    }

    // Handle dataset tag search requests
    async handleDatasetTagSearch(ws, message, clientInfo, wsServer) {
        const { query, path = [] } = message;
        
        if (!query) {
            this.sendError(ws, 'Missing query parameter', 'search_dataset_tags');
            return;
        }

        try {
            const result = await this.datasetTagService.searchDatasetTags(query, path);
            this.sendToClient(ws, {
                type: 'search_dataset_tags_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Dataset tag search error:', error);
            this.sendError(ws, 'Search failed', error.message, message.requestId);
        }
    }

    // Handle get dataset tags for path requests
    async handleGetDatasetTagsForPath(ws, message, clientInfo, wsServer) {
        const { path = [] } = message;

        try {
            const tags = await this.datasetTagService.getTagsForPath(path);
            this.sendToClient(ws, {
                type: 'get_dataset_tags_for_path_response',
                requestId: message.requestId,
                data: { tags },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Get dataset tags for path error:', error);
            this.sendError(ws, 'Failed to get tags', error.message, message.requestId);
        }
    }

    // Handle adding words to dictionary
    async handleAddWordToDictionary(ws, message, clientInfo, wsServer) {
        const { word } = message;
        
        if (!word) {
            this.sendError(ws, 'Missing word parameter', 'spellcheck_add_word');
            return;
        }

        try {
            const result = await this.searchService.addWordToDictionary(word);
            
            this.sendToClient(ws, {
                type: 'spellcheck_add_word_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Add word to dictionary error:', error);
            this.sendError(ws, 'Failed to add word', error.message, message.requestId);
        }
    }

    // Handle ping messages
    handlePing(ws, message, clientInfo, wsServer) {
        this.sendToClient(ws, {
            type: 'pong',
            timestamp: new Date().toISOString()
        });
    }

    // Handle subscription messages
    handleSubscribe(ws, message, clientInfo, wsServer) {
        this.sendToClient(ws, {
            type: 'subscribed',
            channels: message.channels || [],
            timestamp: new Date().toISOString()
        });
    }

    // Utility methods
    sendToClient(ws, message) {
        if (ws.readyState === 1) { // WebSocket.OPEN
            ws.send(JSON.stringify(message));
        }
    }

    sendError(ws, message, details = null, requestId = null) {
        this.sendToClient(ws, {
            type: 'error',
            message,
            details,
            requestId,
            timestamp: new Date().toISOString()
        });
    }
}

module.exports = { WebSocketMessageHandlers }; 