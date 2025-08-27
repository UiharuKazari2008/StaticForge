const { SearchService, loadPromptConfig, savePromptConfig } = require('./textReplacements');
const DatasetTagService = require('./datasetTagService');
const FavoritesManager = require('./favorites');
const { 
    getActiveWorkspaceScraps, 
    getActiveWorkspacePinned, 
    getActiveWorkspaceFiles, 
    getActiveWorkspace, 
    getWorkspace,
    getWorkspaces,
    createWorkspace,
    renameWorkspace,
    deleteWorkspace,
    setActiveWorkspace,
    dumpWorkspace,
    moveFilesToWorkspace,
    moveToWorkspaceArray,
    addToWorkspaceArray,
    removeFromWorkspaceArray,
    updateWorkspaceColor,
    updateWorkspaceBackgroundColor,
    updateWorkspaceSettings,
    updateWorkspacePrimaryFont,
    updateWorkspaceTextareaFont,
    createGroup,
    getGroup,
    getWorkspaceGroups,
    addImagesToGroup,
    removeImagesFromGroup,
    renameGroup,
    deleteGroup,
    getGroupsForImage,
    removeFilesFromWorkspaces,
    syncWorkspaceFiles,
    getActiveWorkspaceGroups,
    reorderWorkspaces,
    getActiveWorkspaceCacheFiles, 
    getWorkspacesData, 
    getActiveWorkspaceData
} = require('./workspace');
const { getCachedMetadata, getAllMetadata, getImagesMetadata, scanAndUpdateMetadata, removeImageMetadata, addUnattributedReceipt, getImageMetadata: getImageMetadataFromCache } = require('./metadataCache');
const { isImageLarge, matchOriginalResolution } = require('./imageTools');
const { readMetadata, updateMetadata, getImageMetadata, extractRelevantFields, getModelDisplayName, extractMetadataSummary } = require('./pngMetadata');
const { getStatus } = require('./queue');
const imageCounter = require('./imageCounter');
const { generateImageWebSocket } = require('./imageGeneration');
const { upscaleImageWebSocket } = require('./imageUpscaling');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const https = require('https');
const sharp = require('sharp');
const { Model, Action, Sampler, Noise, Resolution } = require('nekoai-js');
const config = require('../config.json');

const cacheDir = path.resolve(__dirname, '../.cache');
const uploadCacheDir = path.join(cacheDir, 'upload');
const previewCacheDir = path.join(cacheDir, 'preview');
const vibeCacheDir = path.join(cacheDir, 'vibe');
const imagesDir = path.resolve(__dirname, '../images');
const previewsDir = path.resolve(__dirname, '../.previews');

/*
 * WebSocket Response Format Standards for Workspace Operations:
 * 
 * All workspace operations should return responses with:
 * - type: 'operation_response' (e.g., 'workspace_create_response')
 * - requestId: matching the client's request
 * - data: {
 *     success: true/false,
 *     message: descriptive text,
 *     ...operation-specific data
 *   }
 * - timestamp: ISO timestamp
 * 
 * Broadcast messages should include:
 * - type: 'workspace_updated'
 * - data: {
 *     action: 'operation_type' (e.g., 'created', 'deleted', 'dumped'),
 *     ...relevant data for efficient client updates
 *   }
 * - timestamp: ISO timestamp
 * 
 * This ensures clients can efficiently update local state without full reloads.
 */

// WebSocket message handlers
class WebSocketMessageHandlers {
    constructor(context = {}) {
        this.searchService = new SearchService(context);
        this.datasetTagService = new DatasetTagService();
        this.favoritesManager = new FavoritesManager();
        this.context = context;
        // Initialize the service at startup
        this.initializeDatasetTagService();
    }

    async initializeDatasetTagService() {
        try {
            await this.datasetTagService.initialize();
        } catch (error) {
            console.error('Failed to initialize DatasetTagService:', error);
        }
    }

    // Generate UUID for presets
    generateUUID() {
        return crypto.randomUUID();
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

            // Check if user is read-only and trying to perform destructive operations
            if (clientInfo.userType === 'readonly' && this.isDestructiveOperation(message.type)) {
                wsServer.sendToClient(ws, {
                    type: 'error',
                    message: 'Non-Administrator Login: This operation is not allowed for read-only users',
                    code: 'READONLY_RESTRICTED',
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Continue with normal message handling
            await this.routeMessage(ws, message, clientInfo, wsServer);
        } catch (error) {
            console.error('❌ WebSocket message handling error:', error);
            wsServer.sendToClient(ws, {
                type: 'error',
                message: 'Internal server error',
                code: 'INTERNAL_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Check if an operation is destructive (not allowed for read-only users)
    isDestructiveOperation(messageType) {
        const destructiveOperations = [
            'workspace_create',
            'workspace_delete',
            'workspace_rename',
            'workspace_move_files',
            'workspace_remove_scrap',
            'workspace_remove_pinned',
            'workspace_bulk_remove_pinned',
            'workspace_create_group',
            'workspace_rename_group',
            'workspace_delete_group',
            'workspace_remove_images_from_group',
            'workspace_update_color',
            'workspace_update_background_color',
            'workspace_update_background_image',
            'workspace_update_background_opacity',
            'workspace_update_primary_font',
            'workspace_update_textarea_font',
            'workspace_update_settings',
            'delete_images_bulk',
            'delete_reference',
            'upload_reference',
            'upload_workspace_image',
            'download_url_file',
            'fetch_url_info',
            'move_references',
            'delete_vibe_image',
            'delete_vibe_encodings',
            'bulk_delete_vibe_images',
            'import_vibe_bundle',
            'encode_vibe',
            'move_vibe_image',
            'bulk_move_vibe_images',
            'favorites_remove',
            'favorites_add',
            'save_preset',
            'generate_preset',
            'delete_preset',
            'save_text_replacements',
            'spellcheck_add_word',
            'generate_image',
            'upscale_image'
        ];
        return destructiveOperations.includes(messageType);
    }

    // Route messages to appropriate handlers
    async routeMessage(ws, message, clientInfo, wsServer) {
        switch (message.type) {
            case 'search_characters':
                await this.handleCharacterSearch(ws, message, clientInfo, wsServer);
                break;
                
            case 'search_presets':
                await this.handlePresetSearch(ws, message, clientInfo, wsServer);
                break;
                
            case 'load_preset':
                await this.handleLoadPreset(ws, message, clientInfo, wsServer);
                break;
                
            case 'save_preset':
                await this.handleSavePreset(ws, message, clientInfo, wsServer);
                break;
                
            case 'generate_preset':
                await this.handleGeneratePreset(ws, message, clientInfo, wsServer);
                break;
                
            case 'delete_preset':
                await this.handleDeletePreset(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_presets':
                await this.handleGetPresets(ws, message, clientInfo, wsServer);
                break;
                
            case 'update_preset':
                await this.handleUpdatePreset(ws, message, clientInfo, wsServer);
                break;
                
            case 'regenerate_preset_uuid':
                await this.handleRegeneratePresetUuid(ws, message, clientInfo, wsServer);
                break;
                
            case 'search_dataset_tags':
                await this.handleDatasetTagSearch(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_dataset_tags_for_path':
                await this.handleGetDatasetTagsForPath(ws, message, clientInfo, wsServer);
                break;
                
            case 'search_tags':
                await this.handleSearchTags(ws, message, clientInfo, wsServer);
                break;
                
            case 'search_files':
                await this.handleFileSearch(ws, message, clientInfo, wsServer);
                break;
                
            case 'spellcheck_add_word':
                await this.handleAddWordToDictionary(ws, message, clientInfo, wsServer);
                break;
                
            // Favorites handlers
            case 'favorites_add':
                await this.handleAddFavorite(ws, message, clientInfo, wsServer);
                break;
                
            case 'favorites_remove':
                await this.handleRemoveFavorite(ws, message, clientInfo, wsServer);
                break;
                
            case 'favorites_get':
                await this.handleGetFavorites(ws, message, clientInfo, wsServer);
                break;
                
            // Text replacement management handlers
            case 'get_text_replacements':
                await this.handleGetTextReplacements(ws, message, clientInfo, wsServer);
                break;
                
            case 'save_text_replacements':
                await this.handleSaveTextReplacements(ws, message, clientInfo, wsServer);
                break;
                
            case 'delete_text_replacement':
                await this.handleDeleteTextReplacement(ws, message, clientInfo, wsServer);
                break;
                
            case 'create_text_replacement':
                await this.handleCreateTextReplacement(ws, message, clientInfo, wsServer);
                break;
                
            case 'request_gallery':
                await this.handleGalleryRequest(ws, message, clientInfo, wsServer);
                break;
                
            case 'request_image_metadata':
                await this.handleImageMetadataRequest(ws, message, clientInfo, wsServer);
                break;
                
            case 'request_url_upload_metadata':
                await this.handleUrlUploadMetadataRequest(ws, message, clientInfo, wsServer);
                break;
                
            case 'request_image_by_index':
                await this.handleImageByIndexRequest(ws, message, clientInfo, wsServer);
                break;
                
            case 'find_image_index':
                await this.handleFindImageIndexRequest(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_app_options':
                await this.handleGetAppOptions(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_rate_limiting_stats':
                await this.handleGetRateLimitingStats(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_session_rate_limiting_stats':
                await this.handleGetSessionRateLimitingStats(ws, message, clientInfo, wsServer);
                break;
                
            case 'cancel_pending_requests':
                await this.handleCancelPendingRequests(ws, message, clientInfo, wsServer);
                break;
                
            case 'cancel_session_pending_requests':
                await this.handleCancelSessionPendingRequests(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_list':
                await this.handleWorkspaceList(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_get':
                await this.handleWorkspaceGet(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_create':
                await this.handleWorkspaceCreate(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_rename':
                await this.handleWorkspaceRename(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_delete':
                await this.handleWorkspaceDelete(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_activate':
                await this.handleWorkspaceActivate(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_dump':
                await this.handleWorkspaceDump(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_get_files':
                await this.handleWorkspaceGetFiles(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_move_files':
                await this.handleWorkspaceMoveFiles(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_get_scraps':
                await this.handleWorkspaceGetScraps(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_get_pinned':
                await this.handleWorkspaceGetPinned(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_add_scrap':
                await this.handleWorkspaceAddScrap(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_remove_scrap':
                await this.handleWorkspaceRemoveScrap(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_add_pinned':
                await this.handleWorkspaceAddPinned(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_remove_pinned':
                await this.handleWorkspaceRemovePinned(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_bulk_pinned':
                await this.handleWorkspaceBulkPinned(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_bulk_remove_pinned':
                await this.handleWorkspaceBulkRemovePinned(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_get_groups':
                await this.handleWorkspaceGetGroups(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_create_group':
                await this.handleWorkspaceCreateGroup(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_get_group':
                await this.handleWorkspaceGetGroup(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_rename_group':
                await this.handleWorkspaceRenameGroup(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_add_images_to_group':
                await this.handleWorkspaceAddImagesToGroup(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_remove_images_from_group':
                await this.handleWorkspaceRemoveImagesFromGroup(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_delete_group':
                await this.handleWorkspaceDeleteGroup(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_get_image_groups':
                await this.handleWorkspaceGetImageGroups(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_update_color':
                await this.handleWorkspaceUpdateColor(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_update_background_color':
                await this.handleWorkspaceUpdateBackgroundColor(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_update_settings':
                await this.handleWorkspaceUpdateSettings(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_update_primary_font':
                await this.handleWorkspaceUpdatePrimaryFont(ws, message, clientInfo, wsServer);
                break;

            case 'workspace_update_textarea_font':
                await this.handleWorkspaceUpdateTextareaFont(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_reorder':
                await this.handleWorkspaceReorder(ws, message, clientInfo, wsServer);
                break;
                
            // Bulk operations
            case 'workspace_bulk_add_scrap':
                await this.handleWorkspaceBulkAddScrap(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_bulk_remove_pinned':
                await this.handleWorkspaceBulkRemovePinned(ws, message, clientInfo, wsServer);
                break;
                
            case 'workspace_bulk_add_pinned':
                await this.handleWorkspaceBulkAddPinned(ws, message, clientInfo, wsServer);
                break;
                
            case 'delete_images_bulk':
                await this.handleDeleteImagesBulk(ws, message, clientInfo, wsServer);
                break;
                
            case 'send_to_sequenzia_bulk':
                await this.handleSendToSequenziaBulk(ws, message, clientInfo, wsServer);
                break;
                
            case 'update_image_preset_bulk':
                await this.handleUpdateImagePresetBulk(ws, message, clientInfo, wsServer);
                break;
                
            // References and Vibes WebSocket handlers
            case 'get_references':
                await this.handleGetReferences(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_references_by_ids':
                await this.handleGetReferencesByIds(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_workspace_references':
                await this.handleGetWorkspaceReferences(ws, message, clientInfo, wsServer);
                break;
                
            case 'delete_reference':
                await this.handleDeleteReference(ws, message, clientInfo, wsServer);
                break;
                
            case 'upload_reference':
                await this.handleUploadReference(ws, message, clientInfo, wsServer);
                break;
                
            case 'upload_workspace_image':
                await this.handleUploadWorkspaceImage(ws, message, clientInfo, wsServer);
                break;
                
            case 'download_url_file':
                await this.handleDownloadUrlFile(ws, message, clientInfo, wsServer);
                break;
                
            case 'fetch_url_info':
                await this.handleFetchUrl(ws, message, clientInfo, wsServer);
                break;
                
            case 'move_references':
                await this.handleMoveReferences(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_vibe_image':
                await this.handleGetVibeImage(ws, message, clientInfo, wsServer);
                break;
                
            case 'delete_vibe_image':
                await this.handleDeleteVibeImage(ws, message, clientInfo, wsServer);
                break;
                
            case 'delete_vibe_encodings':
                await this.handleDeleteVibeEncodings(ws, message, clientInfo, wsServer);
                break;
                
            case 'bulk_delete_vibe_images':
                await this.handleBulkDeleteVibeImages(ws, message, clientInfo, wsServer);
                break;
                
            case 'move_vibe_image':
                await this.handleMoveVibeImage(ws, message, clientInfo, wsServer);
                break;
                
            case 'bulk_move_vibe_images':
                await this.handleBulkMoveVibeImages(ws, message, clientInfo, wsServer);
                break;
                
            case 'encode_vibe':
                await this.handleEncodeVibe(ws, message, clientInfo, wsServer);
                break;
                
            case 'import_vibe_bundle':
                await this.handleImportVibeBundle(ws, message, clientInfo, wsServer);
                break;
                
            case 'check_vibe_encoding':
                await this.handleCheckVibeEncoding(ws, message, clientInfo, wsServer);
                break;
                
            case 'ping':
                this.handlePing(ws, message, clientInfo, wsServer);
                break;
                
            case 'subscribe':
                this.handleSubscribe(ws, message, clientInfo, wsServer);
                break;
                
            case 'generate_image':
                await this.handleImageGeneration(ws, message, clientInfo, wsServer);
                break;
                
            case 'upscale_image':
                await this.handleImageUpscaling(ws, message, clientInfo, wsServer);
                break;
                
            case 'get_cache_manifest':
                await this.handleGetCacheManifest(ws, message, clientInfo, wsServer);
                break;
                
            case 'reload_cache_data':
                await this.handleReloadCacheData(ws, message, clientInfo, wsServer);
                break;
                
            default:
                this.sendError(ws, 'Unknown message type', message.type);
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
            const result = await this.searchService.searchCharacters(query, model, ws, clientInfo.sessionId);
            
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

    // Handle preset load requests
    async handleLoadPreset(ws, message, clientInfo, wsServer) {
        const { presetName } = message;
        
        if (!presetName) {
            this.sendError(ws, 'Missing presetName parameter', 'load_preset');
            return;
        }

        try {
            const currentPromptConfig = loadPromptConfig();
            const preset = currentPromptConfig.presets[presetName];
            
            if (!preset) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }

            // Return the raw preset data without processing text replacements
            const presetData = {
                ...preset,
                preset_name: presetName,
            };
            
            this.sendToClient(ws, {
                type: 'load_preset_response',
                requestId: message.requestId,
                data: presetData,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Preset load error:', error);
            this.sendError(ws, 'Failed to load preset', error.message, message.requestId);
        }
    }

    // Handle preset save requests
    async handleSavePreset(ws, message, clientInfo, wsServer) {
        const { presetName, config } = message;
        
        if (!presetName || !config || !config.prompt || !config.model) {
            this.sendError(ws, 'Missing required parameters', 'Preset name, prompt, and model are required', message.requestId);
            return;
        }

        try {
            const currentPromptConfig = loadPromptConfig();
            
            // Generate UUID if not present
            if (!config.uuid) {
                config.uuid = this.generateUUID();
            }
            
            // Preserve existing target_workspace if present, otherwise set to current active workspace
            if (currentPromptConfig.presets[presetName] && currentPromptConfig.presets[presetName].target_workspace) {
                config.target_workspace = currentPromptConfig.presets[presetName].target_workspace;
            } else if (!config.target_workspace || config.target_workspace === 'default') {
                // Set target workspace to current active workspace if not set or is default
                const activeWorkspaceId = getActiveWorkspace(clientInfo.sessionId);
                config.target_workspace = activeWorkspaceId;
            }
            
            currentPromptConfig.presets[presetName] = config;

            fs.writeFileSync('./prompt.config.json', JSON.stringify(currentPromptConfig, null, 2));

            console.log(`💾 Saved new preset: ${presetName}`);

            this.sendToClient(ws, {
                type: 'save_preset_response',
                requestId: message.requestId,
                data: { success: true, message: `Preset "${presetName}" saved successfully` },
                timestamp: new Date().toISOString()
            });

            // Broadcast preset update to all connected clients
            wsServer.clients.forEach(client => {
                if (client.readyState === 1) {
                    this.sendToClient(client, {
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
            this.sendError(ws, 'Failed to save preset', error.message, message.requestId);
        }
    }

    // Handle get presets requests
    async handleGetPresets(ws, message, clientInfo, wsServer) {
        const { page = 1, itemsPerPage = 15, searchTerm = '' } = message;
        
        try {
            const currentPromptConfig = loadPromptConfig();
            const presets = currentPromptConfig.presets || {};
            
            // Filter presets by search term if provided
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
            
            // Calculate pagination
            const presetKeys = Object.keys(filteredPresets);
            const totalItems = presetKeys.length;
            const totalPages = Math.ceil(totalItems / itemsPerPage);
            const startIndex = (page - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            const pageKeys = presetKeys.slice(startIndex, endIndex);
            
            // Create page data
            const pagePresets = {};
            pageKeys.forEach(key => {
                pagePresets[key] = filteredPresets[key];
            });
            
            this.sendToClient(ws, {
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
            this.sendError(ws, 'Failed to get presets', error.message, message.requestId);
        }
    }

    // Handle update preset requests - supports partial updates for name, target_workspace, resolution, and scale
    async handleUpdatePreset(ws, message, clientInfo, wsServer) {
        const { presetName, name, target_workspace, resolution, request_upscale } = message;
        
        if (!presetName) {
            this.sendError(ws, 'Missing required parameters', 'Preset name is required', message.requestId);
            return;
        }

        try {
            const currentPromptConfig = loadPromptConfig();
            
            if (!currentPromptConfig.presets[presetName]) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }
            
            // Get existing preset data
            const existingPreset = currentPromptConfig.presets[presetName];
            
            // Preserve existing UUID
            const uuid = existingPreset.uuid || this.generateUUID();
            
            // If the name is changing, we need to handle the key change
            if (name && name !== presetName) {
                // Create new preset with new name
                currentPromptConfig.presets[name] = {
                    ...existingPreset,
                    name: name,
                    target_workspace: target_workspace !== undefined ? target_workspace : (existingPreset.target_workspace && existingPreset.target_workspace !== 'default' ? existingPreset.target_workspace : getActiveWorkspace(clientInfo.sessionId)),
                    resolution: resolution !== undefined ? resolution : existingPreset.resolution || '',
                    request_upscale: request_upscale !== undefined ? request_upscale : existingPreset.request_upscale || false,
                    uuid: uuid
                };
                
                // Delete the old preset
                delete currentPromptConfig.presets[presetName];
            } else {
                // Update existing preset in place
                currentPromptConfig.presets[presetName] = {
                    ...existingPreset,
                    name: name !== undefined ? name : existingPreset.name,
                    target_workspace: target_workspace !== undefined ? target_workspace : (existingPreset.target_workspace && existingPreset.target_workspace !== 'default' ? existingPreset.target_workspace : getActiveWorkspace(clientInfo.sessionId)),
                    resolution: resolution !== undefined ? resolution : existingPreset.resolution || '',
                    request_upscale: request_upscale !== undefined ? request_upscale : existingPreset.request_upscale || false,
                    uuid: uuid
                };
            }

            fs.writeFileSync('./prompt.config.json', JSON.stringify(currentPromptConfig, null, 2));

            console.log(`💾 Updated preset: ${presetName} -> ${name} with UUID: ${uuid}`);

            this.sendToClient(ws, {
                type: 'update_preset_response',
                requestId: message.requestId,
                data: { success: true, message: `Preset "${presetName}" updated successfully`, uuid },
                timestamp: new Date().toISOString()
            });

            // Broadcast preset update to all connected clients
            wsServer.clients.forEach(client => {
                if (client.readyState === 1) {
                    this.sendToClient(client, {
                        type: 'preset_updated',
                        data: { 
                            action: 'updated',
                            presetName: name, // Use new name for broadcast
                            message: `Preset "${presetName}" has been updated to "${name}"`
                        },
                        timestamp: new Date().toISOString()
                    });
                }
            });
        } catch (error) {
            console.error('Update preset error:', error);
            this.sendError(ws, 'Failed to update preset', error.message, message.requestId);
        }
    }

    // Handle preset UUID regeneration requests
    async handleRegeneratePresetUuid(ws, message, clientInfo, wsServer) {
        const { presetName } = message;
        
        if (!presetName) {
            this.sendError(ws, 'Missing presetName parameter', 'regenerate_preset_uuid');
            return;
        }

        try {
            const currentPromptConfig = loadPromptConfig();
            
            if (!currentPromptConfig.presets[presetName]) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }
            
            // Generate new UUID
            const newUuid = this.generateUUID();
            
            // Update the preset with new UUID
            currentPromptConfig.presets[presetName].uuid = newUuid;
            
            // Save the updated config
            fs.writeFileSync('./prompt.config.json', JSON.stringify(currentPromptConfig, null, 2));

            console.log(`🔄 Regenerated UUID for preset: ${presetName} -> ${newUuid}`);

            this.sendToClient(ws, {
                type: 'regenerate_preset_uuid_response',
                requestId: message.requestId,
                data: { success: true, message: `UUID regenerated for preset "${presetName}"`, uuid: newUuid },
                timestamp: new Date().toISOString()
            });

            // Broadcast preset update to all connected clients
            wsServer.clients.forEach(client => {
                if (client.readyState === 1) {
                    this.sendToClient(client, {
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
            this.sendError(ws, 'Failed to regenerate preset UUID', error.message, message.requestId);
        }
    }

    // Handle preset deletion requests
    async handleDeletePreset(ws, message, clientInfo, wsServer) {
        const { presetName } = message;
        
        if (!presetName) {
            this.sendError(ws, 'Missing presetName parameter', 'delete_preset');
            return;
        }

        try {
            const currentPromptConfig = loadPromptConfig();
            
            if (!currentPromptConfig.presets[presetName]) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }

            // Delete the preset
            delete currentPromptConfig.presets[presetName];
            fs.writeFileSync('./prompt.config.json', JSON.stringify(currentPromptConfig, null, 2));

            console.log(`🗑️ Deleted preset: ${presetName}`);

            this.sendToClient(ws, {
                type: 'delete_preset_response',
                requestId: message.requestId,
                data: { success: true, message: `Preset "${presetName}" deleted successfully` },
                timestamp: new Date().toISOString()
            });

            // Broadcast preset deletion to all connected clients
            wsServer.clients.forEach(client => {
                if (client.readyState === 1) {
                    this.sendToClient(client, {
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
            this.sendError(ws, 'Failed to delete preset', error.message, message.requestId);
        }
    }

    // Handle preset generation requests
    async handleGeneratePreset(ws, message, clientInfo, wsServer) {
        const { presetName, workspace } = message;
        
        if (!presetName) {
            this.sendError(ws, 'Missing presetName parameter', 'generate_preset');
            return;
        }

        try {
            const currentPromptConfig = loadPromptConfig();
            const preset = currentPromptConfig.presets[presetName];
            
            if (!preset) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }

            // Use target_workspace from preset if no workspace specified (for REST API calls)
            const targetWorkspace = workspace || (preset.target_workspace && preset.target_workspace !== 'default' ? preset.target_workspace : getActiveWorkspace(clientInfo.sessionId));
            
            // Generate image using the preset
            const result = await generateImageWebSocket({
                ...preset,
                workspace: targetWorkspace,
                presetName: presetName
            }, clientInfo.userType, clientInfo.sessionId);
            
            // Send generation response
            this.sendToClient(ws, {
                type: 'generate_preset_response',
                requestId: message.requestId,
                data: {
                    filename: result.filename,
                    seed: result.seed,
                    saved: result.saved,
                    presetName: presetName,
                    message: `Generation completed for preset "${presetName}"`
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Preset generation error:', error);
            this.sendError(ws, 'Failed to generate preset', error.message, message.requestId);
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

    // Handle search tags requests
    async handleSearchTags(ws, message, clientInfo, wsServer) {
        const { query, single_match = false } = message;
        
        if (!query) {
            this.sendError(ws, 'Missing query parameter', 'search_tags');
            return;
        }

        try {
            const results = await this.datasetTagService.searchTags(query, single_match);
            this.sendToClient(ws, {
                type: 'search_tags_response',
                requestId: message.requestId,
                data: { results },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Search tags error:', error);
            this.sendError(ws, 'Failed to search tags', error.message, message.requestId);
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
            requestId: message.requestId,
            timestamp: new Date().toISOString()
        });
    }
    
    // Handle rate limiting stats request
    async handleGetRateLimitingStats(ws, message, clientInfo, wsServer) {
        try {
            if (this.searchService && typeof this.searchService.getRateLimitingStats === 'function') {
                const stats = this.searchService.getRateLimitingStats();
                this.sendToClient(ws, {
                    type: 'rate_limiting_stats_response',
                    requestId: message.requestId,
                    data: stats,
                    timestamp: new Date().toISOString()
                });
            } else {
                this.sendError(ws, 'Rate limiting stats not available', 'get_rate_limiting_stats');
            }
        } catch (error) {
            console.error('Rate limiting stats error:', error);
            this.sendError(ws, 'Failed to get rate limiting stats', error.message, message.requestId);
        }
    }
    
    // Handle cancel pending requests
    async handleCancelPendingRequests(ws, message, clientInfo, wsServer) {
        try {
            if (this.searchService && typeof this.searchService.cancelAllPendingRequests === 'function') {
                const cancelledCount = this.searchService.cancelAllPendingRequests();
                this.sendToClient(ws, {
                    type: 'cancel_pending_requests_response',
                    requestId: message.requestId,
                    data: { cancelledCount },
                    timestamp: new Date().toISOString()
                });
            } else {
                this.sendError(ws, 'Cancel pending requests not available', 'cancel_pending_requests');
            }
        } catch (error) {
            console.error('Cancel pending requests error:', error);
            this.sendError(ws, 'Failed to cancel pending requests', error.message, message.requestId);
        }
    }
    
    // Handle get session rate limiting stats
    async handleGetSessionRateLimitingStats(ws, message, clientInfo, wsServer) {
        try {
            const { model } = message;
            if (!model) {
                this.sendError(ws, 'Missing model parameter', 'get_session_rate_limiting_stats');
                return;
            }
            
            if (this.searchService && typeof this.searchService.getSessionRateLimitingStats === 'function') {
                const stats = this.searchService.getSessionRateLimitingStats(clientInfo.sessionId, model);
                this.sendToClient(ws, {
                    type: 'session_rate_limiting_stats_response',
                    requestId: message.requestId,
                    data: stats,
                    timestamp: new Date().toISOString()
                });
            } else {
                this.sendError(ws, 'Session rate limiting stats not available', 'get_session_rate_limiting_stats');
            }
        } catch (error) {
            console.error('Session rate limiting stats error:', error);
            this.sendError(ws, 'Failed to get session rate limiting stats', error.message, message.requestId);
        }
    }
    
    // Handle cancel session pending requests
    async handleCancelSessionPendingRequests(ws, message, clientInfo, wsServer) {
        try {
            const { model } = message;
            if (!model) {
                this.sendError(ws, 'Missing model parameter', 'cancel_session_pending_requests');
                return;
            }
            
            if (this.searchService && typeof this.searchService.cancelSessionPendingRequests === 'function') {
                const cancelledCount = this.searchService.cancelSessionPendingRequests(clientInfo.sessionId, model);
                this.sendToClient(ws, {
                    type: 'cancel_session_pending_requests_response',
                    requestId: message.requestId,
                    data: { cancelledCount },
                    timestamp: new Date().toISOString()
                });
            } else {
                this.sendError(ws, 'Cancel session pending requests not available', 'cancel_session_pending_requests');
            }
        } catch (error) {
            console.error('Cancel session pending requests error:', error);
            this.sendError(ws, 'Failed to cancel session pending requests', error.message, message.requestId);
        }
    }

    // Handle subscription messages
    handleSubscribe(ws, message, clientInfo, wsServer) {
        this.sendToClient(ws, {
            type: 'subscribed',
            channels: message.channels || [],
            timestamp: new Date().toISOString()
        });
    }

    // Handle gallery request messages
    async handleGalleryRequest(ws, message, clientInfo, wsServer) {
        const { viewType = 'images', includePinnedStatus = true } = message;
        
        try {
            // Get files based on view type
            let files;
            if (viewType === 'scraps') {
                files = getActiveWorkspaceScraps(clientInfo.sessionId);
            } else if (viewType === 'pinned') {
                files = getActiveWorkspacePinned(clientInfo.sessionId);
            } else if (viewType === 'upscaled') {
                const workspaceFiles = getActiveWorkspaceFiles(clientInfo.sessionId);
                files = workspaceFiles;
                
                // Also include wallpaper and large resolution images from metadata cache
                const allMetadata = getAllMetadata();
                
                // Find large resolution images (area > 1024x1024)
                const specialImages = [];
                for (const [filename, metadata] of Object.entries(allMetadata)) {
                    if (metadata.width && metadata.height) {
                        if (isImageLarge(metadata.width, metadata.height)) {
                            // Check if this image is in the current workspace
                            const workspace = getActiveWorkspace(clientInfo.sessionId);
                            const workspaceData = getWorkspace(workspace);
                            if (workspaceData && workspaceData.files && workspaceData.files.includes(filename)) {
                                specialImages.push(filename);
                            }
                        }
                    }
                }
                
                // Add special images to the files list
                files = [...new Set([...files, ...specialImages])];
            } else {
                // Default to regular images
                files = getActiveWorkspaceFiles(clientInfo.sessionId);
            }
            
            // Get pinned status if requested
            let pinnedFiles = [];
            if (includePinnedStatus) {
                pinnedFiles = getActiveWorkspacePinned(clientInfo.sessionId);
            }
            
            // Helper function to get base name
            const getBaseName = (filename) => {
                const base = filename.replace(/\.(png|jpg|jpeg)$/i, '');
                return base.replace(/_upscaled$/, '');
            };
            
            // Helper function to get preview filename
            const getPreviewFilename = (baseName) => {
                return `${baseName}.jpg`;
            };
            
            // Build gallery data
            if (!Array.isArray(files)) {
                console.error('Files is not an array:', files);
                files = [];
            }
            const baseMap = {};
            for (const file of files) {
                const base = getBaseName(file);
                if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
                if (file.includes('_upscaled')) baseMap[base].upscaled = file;
                else baseMap[base].original = file;
            }
            
            const gallery = [];
            for (const base in baseMap) {
                const { original, upscaled } = baseMap[base];
                
                // Get the file to use (prefer upscaled, then original)
                const file = upscaled || original;
                if (!file) continue;
                
                // Get metadata from cache, or load it if missing
                let metadata = getCachedMetadata(file);
                if (!metadata) {
                    console.log(`🔄 Loading metadata for file: ${file}`);
                    try {
                        // Try to extract metadata for the missing file
                        const imagesDir = path.join(process.cwd(), 'images');
                        metadata = await getImageMetadataFromCache(file, imagesDir);
                        if (!metadata) {
                            console.warn(`❌ Could not extract metadata for file: ${file}`);
                            continue;
                        }
                    } catch (error) {
                        console.error(`❌ Error loading metadata for file ${file}:`, error);
                        continue;
                    }
                }
                
                const preview = getPreviewFilename(base);
                const isLarge = metadata?.width && metadata?.height ? 
                    isImageLarge(metadata.width, metadata.height) : false;
                
                if (viewType === 'upscaled') {
                    // For upscaled view, include images that have upscaled versions OR are wallpaper/large
                    const shouldInclude = upscaled || isLarge;
                    if (!shouldInclude) continue;
                }
                
                gallery.push({
                    base,
                    original,
                    upscaled,
                    preview,
                    mtime: metadata.mtime || Date.now(),
                    size: metadata.size || 0,
                    isLarge: isLarge,
                    isPinned: includePinnedStatus ? pinnedFiles.includes(file) : false,
                    // Include dimensions for PhotoSwipe
                    width: metadata.width || null,
                    height: metadata.height || null
                });
            }
            
            // Sort by newest first
            gallery.sort((a, b) => b.mtime - a.mtime);
            
            // Send response
            this.sendToClient(ws, {
                type: 'request_gallery_response',
                requestId: message.requestId,
                data: { gallery, viewType },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Gallery request error:', error);
            this.sendError(ws, 'Failed to load gallery', error.message, message.requestId);
        }
    }

    // Handle image metadata request messages
    async handleImageMetadataRequest(ws, message, clientInfo, wsServer) {
        const { filename } = message;
        
        if (!filename) {
            this.sendError(ws, 'Missing filename parameter', 'request_image_metadata');
            return;
        }
        
        try {
            // Get the images directory
            const filePath = path.join(imagesDir, filename);
            
            if (!fs.existsSync(filePath)) {
                this.sendError(ws, 'Image not found', 'request_image_metadata', message.requestId);
                return;
            }
            
            // Get metadata from cache first
            let cachedMetadata = getCachedMetadata(filename);
            
            // If not in cache, extract and update cache
            if (!cachedMetadata) {
                console.log(`🔄 Metadata not found in cache for ${filename}, extracting...`);
                cachedMetadata = await getImageMetadata(filename, imagesDir);
                if (!cachedMetadata) {
                    this.sendError(ws, 'Failed to extract metadata', 'request_image_metadata', message.requestId);
                    return;
                }
            }
            
            // Get the metadata object (PNG embedded metadata)
            let metadata = cachedMetadata.metadata;
            
            // If this is an upscaled image and has a parent, get the parent's metadata
            if (cachedMetadata.upscaled && cachedMetadata.parent) {
                const parentMetadata = getCachedMetadata(cachedMetadata.parent);
                if (parentMetadata) {
                    metadata = parentMetadata.metadata;
                    console.log(`📋 Using parent metadata for upscaled image: ${cachedMetadata.parent}`);
                } else {
                    console.log(`⚠️ Parent metadata not found for: ${cachedMetadata.parent}`);
                }
            }
            
            if (!metadata) {
                this.sendError(ws, 'No NovelAI metadata found', 'request_image_metadata', message.requestId);
                return;
            }
            
            // If upscaled, try to match preset using metadata dimensions
            let matchedPreset = null;
            const isUpscaled = metadata.forge_data?.upscale_ratio !== null && metadata.forge_data?.upscale_ratio !== undefined;
            if (isUpscaled) {
                const currentPromptConfig = loadPromptConfig();
                matchedPreset = matchOriginalResolution(metadata, currentPromptConfig.resolutions || {});
            }
            
            const result = await extractRelevantFields(metadata, filename);
            if (matchedPreset) result.matchedPreset = matchedPreset;
            
            // Send response
            this.sendToClient(ws, {
                type: 'request_image_metadata_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Image metadata request error:', error);
            this.sendError(ws, 'Failed to load image metadata', error.message, message.requestId);
        }
    }

    // Helper function to build gallery data for a given view type
    async buildGalleryData(viewType = 'images', clientInfo = null) {
        // Helper functions for file processing
        const getBaseName = (filename) => {
            const base = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
            return base.replace(/_upscaled$/, '');
        };
        
        // Validate that clientInfo is provided since workspace functions now require session IDs
        if (!clientInfo || !clientInfo.sessionId) {
            throw new Error('Client info with session ID is required to build gallery data');
        }
        
        // Get files based on view type
        let files;
        const sessionId = clientInfo.sessionId;
        switch (viewType) {
            case 'scraps':
                files = getActiveWorkspaceScraps(sessionId);
                break;
            case 'pinned':
                files = getActiveWorkspacePinned(sessionId);
                break;
            case 'upscaled':
                // For upscaled view, get all files and filter for upscaled/large images
                const workspaceFiles = getActiveWorkspaceFiles(sessionId);
                files = workspaceFiles;
                
                // Also include wallpaper and large resolution images from metadata cache
                const allMetadata = getAllMetadata();
                
                // Find large resolution images (area > 1024x1024)
                const specialImages = [];
                for (const [filename, metadata] of Object.entries(allMetadata)) {
                    if (metadata.width && metadata.height) {
                        if (isImageLarge(metadata.width, metadata.height)) {
                            // Check if this image is in the current workspace
                            const workspace = getActiveWorkspace(sessionId);
                            const workspaceData = getWorkspace(workspace);
                            if (workspaceData && workspaceData.files && workspaceData.files.includes(filename)) {
                                specialImages.push(filename);
                            }
                        }
                    }
                }
                
                // Add special images to the files list
                files = [...new Set([...files, ...specialImages])];
                break;
            case 'images':
            default:
                files = getActiveWorkspaceFiles(sessionId);
                break;
        }
        
        // Build gallery data (same logic as handleGalleryRequest)
        if (!Array.isArray(files)) {
            console.error('Files is not an array:', files);
            files = [];
        }
        
        const baseMap = {};
        for (const file of files) {
            const base = getBaseName(file);
            if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
            if (file.includes('_upscaled')) baseMap[base].upscaled = file;
            else baseMap[base].original = file;
        }
        
        const gallery = [];
        for (const base in baseMap) {
            const { original, upscaled } = baseMap[base];
            
            // Get the file to use (prefer upscaled, then original)
            const file = upscaled || original;
            if (!file) continue;
            
            // Get metadata from cache, or load it if missing
            let metadata = getCachedMetadata(file);
            if (!metadata) {
                console.log(`🔄 Loading metadata for file: ${file}`);
                try {
                    // Try to extract metadata for the missing file
                    const imagesDir = path.join(process.cwd(), 'images');
                    metadata = await getImageMetadataFromCache(file, imagesDir);
                    if (!metadata) {
                        console.warn(`❌ Could not extract metadata for file: ${file}`);
                        continue;
                    }
                } catch (error) {
                    console.error(`❌ Error loading metadata for file ${file}:`, error);
                    continue;
                }
            }
            
            const preview = `${base}.jpg`;
            const isLarge = metadata?.width && metadata?.height ? 
                isImageLarge(metadata.width, metadata.height) : false;
            
            if (viewType === 'upscaled') {
                // For upscaled view, include images that have upscaled versions OR are wallpaper/large
                const shouldInclude = upscaled || isLarge;
                if (!shouldInclude) continue;
            }
            
            gallery.push({
                base,
                original,
                upscaled,
                preview,
                mtime: metadata.mtime || Date.now(),
                size: metadata.size || 0,
                isLarge: isLarge,
                // Include dimensions for PhotoSwipe
                width: metadata.width || null,
                height: metadata.height || null
            });
        }
        
        // Sort by newest first
        gallery.sort((a, b) => b.mtime - a.mtime);
        
        return gallery;
    }

    // Handle image by index request messages
    async handleImageByIndexRequest(ws, message, clientInfo, wsServer) {
        const { index, viewType = 'images' } = message;
        
        if (index === undefined || index === null) {
            this.sendError(ws, 'Missing index parameter', 'request_image_by_index');
            return;
        }
        
        try {
            // Build gallery data using shared helper
            const images = await this.buildGalleryData(viewType, clientInfo);
            
            // Check if index is valid
            if (index < 0 || index >= images.length) {
                this.sendError(ws, 'Index out of bounds', 'request_image_by_index', message.requestId);
                return;
            }
            
            const image = images[index];
            
            // Get metadata for the image
            let metadata = null;
            try {
                const filePath = path.join(imagesDir, image.original);
                if (fs.existsSync(filePath)) {
                    let cachedMetadata = getCachedMetadata(image.original);
                    
                    if (!cachedMetadata) {
                        cachedMetadata = await getImageMetadata(image.original, imagesDir);
                    }
                    
                    if (cachedMetadata && cachedMetadata.metadata) {
                        metadata = await extractRelevantFields(cachedMetadata.metadata, image.original);
                    }
                }
            } catch (metadataError) {
                console.warn('Failed to load metadata for image by index:', metadataError);
            }
            
            // Add metadata to image object
            const result = {
                ...image,
                metadata: metadata
            };
            
            // Send response
            this.sendToClient(ws, {
                type: 'request_image_by_index_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Image by index request error:', error);
            this.sendError(ws, 'Failed to load image by index', error.message, message.requestId);
        }
    }

    // Handle find image index request messages
    async handleFindImageIndexRequest(ws, message, clientInfo, wsServer) {
        const { filename, viewType = 'images' } = message;
        
        if (!filename) {
            this.sendError(ws, 'Missing filename parameter', 'find_image_index');
            return;
        }
        
        try {
            // Build gallery data using shared helper
            const gallery = await this.buildGalleryData(viewType, clientInfo);
            
            // Find the index of the requested filename
            const index = gallery.findIndex(img => 
                img.original === filename || img.upscaled === filename
            );
            
            // Send response
            this.sendToClient(ws, {
                type: 'find_image_index_response',
                requestId: message.requestId,
                data: { index: index >= 0 ? index : -1 },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Find image index request error:', error);
            this.sendError(ws, 'Failed to find image index', error.message, message.requestId);
        }
    }

    // Handle app options request messages
    async handleGetAppOptions(ws, message, clientInfo, wsServer) {
        try {
            const currentPromptConfig = loadPromptConfig();
            
            // Filter out _INP models and use pretty names
            const modelEntries = Object.keys(Model)
                .filter(key => !key.endsWith('_INP'))
                .map(key => [key, getModelDisplayName(key)]);
            const modelEntriesShort = Object.keys(Model)
                .filter(key => !key.endsWith('_INP'))
                .map(key => [key, getModelDisplayName(key,true)]);
            const imageCount = imageCounter.getCount();

            // Helper to extract relevant preset info
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
                image: !!(preset.image || preset.image_source|| null),
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

            // Build detailed preset info
            const detailedPresets = Object.entries(currentPromptConfig.presets || {}).map(
                ([name, preset]) => extractPresetInfo(name, preset)
            );

            // Get account data and balance from the context
            const accountData = this.context.accountData ? this.context.accountData() : { ok: false };
            const accountBalance = this.context.accountBalance ? this.context.accountBalance() : { fixedTrainingStepsLeft: -1, purchasedTrainingSteps: -1, totalCredits: -1 };
            
            const options = {
                ok: true,
                user: accountData,
                balance: accountBalance,
                presets: detailedPresets,
                queue_status: getStatus(),
                image_count: imageCount,
                models: Object.fromEntries(modelEntries),
                modelsShort: Object.fromEntries(modelEntriesShort),
                actions: Object.fromEntries(Object.keys(Action).map(key => [key, Action[key]])),
                samplers: Object.fromEntries(Object.keys(Sampler).map(key => [key, Sampler[key]])),
                noiseSchedulers: Object.fromEntries(Object.keys(Noise).map(key => [key, Noise[key]])),
                resolutions: Object.fromEntries(Object.keys(Resolution).map(key => [key, Resolution[key]])),
                textReplacements: currentPromptConfig.text_replacements || {},
                datasets: currentPromptConfig.datasets || [],
                quality_presets: currentPromptConfig.quality_presets || {},
                uc_presets: currentPromptConfig.uc_presets || {}
            };

            // Send response
            this.sendToClient(ws, {
                type: 'get_app_options_response',
                requestId: message.requestId,
                data: options,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('App options request error:', error);
            this.sendError(ws, 'Failed to load app options', error.message, message.requestId);
        }
    }

    // Workspace handlers
    async handleWorkspaceList(ws, message, clientInfo, wsServer) {
        try {
            const workspaces = getWorkspaces();
            const activeWorkspaceId = getActiveWorkspace(clientInfo.sessionId);
            
            // Transform to include workspace metadata
            const workspaceList = Object.entries(workspaces).map(([id, workspace]) => ({
                id,
                name: workspace.name,
                color: workspace.color || '#124',
                backgroundColor: workspace.backgroundColor,
                primaryFont: typeof workspace.primaryFont !== 'undefined' ? workspace.primaryFont : null,
                textareaFont: typeof workspace.textareaFont !== 'undefined' ? workspace.textareaFont : null,
                sort: workspace.sort || 0, // Include sort field
                fileCount: workspace.files.length,
                presetCount: workspace.presets.length,
                cacheFileCount: workspace.cacheFiles.length,
                isActive: id === activeWorkspaceId,
                isDefault: id === 'default'
            }));
            
            this.sendToClient(ws, {
                type: 'workspace_list_response',
                requestId: message.requestId,
                data: {
                    workspaces: workspaceList,
                    activeWorkspace: activeWorkspaceId
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace list error:', error);
            this.sendError(ws, 'Failed to get workspace list', error.message, message.requestId);
        }
    }

    async handleWorkspaceGet(ws, message, clientInfo, wsServer) {
        try {
            const activeId = getActiveWorkspace(clientInfo.sessionId);
            const workspace = getWorkspace(activeId);
            
            if (!workspace) {
                this.sendError(ws, 'Active workspace not found', 'workspace_get', message.requestId);
                return;
            }
            
            this.sendToClient(ws, {
                type: 'workspace_get_response',
                requestId: message.requestId,
                data: {
                    id: activeId,
                    name: workspace.name,
                    color: workspace.color || '#124',
                    backgroundColor: workspace.backgroundColor,
                    primaryFont: typeof workspace.primaryFont !== 'undefined' ? workspace.primaryFont : null,
                    textareaFont: typeof workspace.textareaFont !== 'undefined' ? workspace.textareaFont : null,
                    sort: workspace.sort || 0, // Include sort field
                    fileCount: workspace.files.length,
                    presetCount: workspace.presets.length,
                    cacheFileCount: workspace.cacheFiles.length
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get error:', error);
            this.sendError(ws, 'Failed to get workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceCreate(ws, message, clientInfo, wsServer) {
        try {
            const { name, color } = message;
            
            if (!name || !name.trim()) {
                this.sendError(ws, 'Workspace name is required', 'workspace_create', message.requestId);
                return;
            }
            
            // Validate color format if provided
            if (color && color.trim()) {
                const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
                if (!colorRegex.test(color.trim())) {
                    this.sendError(ws, 'Invalid color format. Use hex format (e.g., #ff4500)', 'workspace_create', message.requestId);
                    return;
                }
            }
            
            const workspaceId = createWorkspace(name.trim(), color ? color.trim() : null);
            
            // Get the complete workspace object to return to client
            const workspace = getWorkspace(workspaceId);
            
            this.sendToClient(ws, {
                type: 'workspace_create_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    id: workspaceId, 
                    name: name.trim(),
                    workspace: workspace // Include complete workspace object
                },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients with complete data
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { 
                    action: 'created', 
                    workspaceId, 
                    name: name.trim(),
                    workspace: workspace // Include complete workspace object
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace create error:', error);
            this.sendError(ws, 'Failed to create workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceRename(ws, message, clientInfo, wsServer) {
        try {
            const { id, name } = message;
            
            if (!name || !name.trim()) {
                this.sendError(ws, 'New name is required', 'workspace_rename', message.requestId);
                return;
            }
            
            renameWorkspace(id, name.trim());
            
            this.sendToClient(ws, {
                type: 'workspace_rename_response',
                requestId: message.requestId,
                data: { success: true, message: `Workspace renamed to "${name.trim()}"` },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'renamed', workspaceId: id, name: name.trim() },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace rename error:', error);
            this.sendError(ws, 'Failed to rename workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceDelete(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            
            // Get workspace info before deletion for broadcast
            const workspace = getWorkspace(id);
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_delete', message.requestId);
                return;
            }
            
            const movedCount = deleteWorkspace(id);
            
            this.sendToClient(ws, {
                type: 'workspace_delete_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: `Workspace deleted and ${movedCount} items moved to default`,
                    deletedWorkspaceId: id,
                    deletedWorkspaceName: workspace.name,
                    movedCount: movedCount
                },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients with complete data
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { 
                    action: 'deleted', 
                    workspaceId: id,
                    deletedWorkspaceName: workspace.name,
                    movedCount: movedCount
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace delete error:', error);
            this.sendError(ws, 'Failed to delete workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceActivate(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            
            setActiveWorkspace(id, clientInfo.sessionId);
            
            this.sendToClient(ws, {
                type: 'workspace_activate_response',
                requestId: message.requestId,
                data: { success: true, activeWorkspace: id },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace activation to all clients
            wsServer.broadcast({
                type: 'workspace_activated',
                data: { workspaceId: id },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace activate error:', error);
            this.sendError(ws, 'Failed to activate workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceDump(ws, message, clientInfo, wsServer) {
        try {
            const { sourceId, targetId } = message;
            
            if (!targetId) {
                this.sendError(ws, 'Target workspace ID is required', 'workspace_dump', message.requestId);
                return;
            }
            
            // Get workspace info before dump for broadcast
            const sourceWorkspace = getWorkspace(sourceId);
            const targetWorkspace = getWorkspace(targetId);
            
            if (!sourceWorkspace || !targetWorkspace) {
                this.sendError(ws, 'Source or target workspace not found', 'workspace_dump', message.requestId);
                return;
            }
            
            const result = dumpWorkspace(sourceId, targetId);
            
            this.sendToClient(ws, {
                type: 'workspace_dump_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Workspace dumped successfully',
                    sourceWorkspaceId: sourceId,
                    sourceWorkspaceName: sourceWorkspace.name,
                    targetWorkspaceId: targetId,
                    targetWorkspaceName: targetWorkspace.name,
                    movedCount: result || 0
                },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients with complete data
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { 
                    action: 'dumped', 
                    sourceId, 
                    targetId,
                    sourceWorkspaceName: sourceWorkspace.name,
                    targetWorkspaceName: targetWorkspace.name,
                    movedCount: result || 0
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace dump error:', error);
            this.sendError(ws, 'Failed to dump workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetFiles(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = getWorkspace(id);
            
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_files', message.requestId);
                return;
            }
            
            // Get workspace files (including default workspace files)
            const workspaceFiles = new Set();
            
            // Always include default workspace files
            const defaultWorkspace = getWorkspace('default');
            if (defaultWorkspace && defaultWorkspace.files) {
                defaultWorkspace.files.forEach(file => workspaceFiles.add(file));
            }
            
            // Include current workspace files if not default
            if (id !== 'default' && workspace.files) {
                workspace.files.forEach(file => workspaceFiles.add(file));
            }
            
            this.sendToClient(ws, {
                type: 'workspace_get_files_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    files: Array.from(workspaceFiles)
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get files error:', error);
            this.sendError(ws, 'Failed to get workspace files', error.message, message.requestId);
        }
    }

    async handleWorkspaceMoveFiles(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames, sourceWorkspaceId, moveType = 'files' } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_move_files', message.requestId);
                return;
            }
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_move_files', message.requestId);
                return;
            }
            
            // Validate that the target workspace exists
            const workspace = getWorkspace(id);
            if (!workspace) {
                this.sendError(ws, `Target workspace ${id} not found`, 'workspace_move_files', message.requestId);
                return;
            }
            
            // Get source workspace info if provided
            let sourceWorkspace = null;
            if (sourceWorkspaceId) {
                sourceWorkspace = getWorkspace(sourceWorkspaceId);
                if (!sourceWorkspace) {
                    this.sendError(ws, `Source workspace ${sourceWorkspaceId} not found`, 'workspace_move_files', message.requestId);
                    return;
                }
            }
            
            // Use the appropriate move function based on moveType
            let movedCount;
            switch (moveType) {
                case 'scraps':
                    movedCount = moveToWorkspaceArray('scraps', filenames, id, sourceWorkspaceId);
                    break;
                case 'pinned':
                    movedCount = moveToWorkspaceArray('pinned', filenames, id, sourceWorkspaceId);
                    break;
                case 'files':
                default:
                    movedCount = moveFilesToWorkspace(filenames, id, sourceWorkspaceId);
                    break;
            }
            
            this.sendToClient(ws, {
                type: 'workspace_move_files_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: `Moved ${movedCount} files to workspace`, 
                    movedCount,
                    targetWorkspaceId: id,
                    targetWorkspaceName: workspace.name,
                    sourceWorkspaceId: sourceWorkspaceId || null,
                    sourceWorkspaceName: sourceWorkspace ? sourceWorkspace.name : null,
                    moveType: moveType
                },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients with complete data
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { 
                    action: 'files_moved', 
                    workspaceId: id, 
                    movedCount,
                    targetWorkspaceName: workspace.name,
                    sourceWorkspaceId: sourceWorkspaceId || null,
                    sourceWorkspaceName: sourceWorkspace ? sourceWorkspace.name : null,
                    moveType: moveType
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace move files error:', error);
            this.sendError(ws, 'Failed to move files to workspace', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetScraps(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = getWorkspace(id);
            
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_scraps', message.requestId);
                return;
            }
            
            // Get scraps for the requested workspace (scraps are shared across workspaces)
            const scraps = getActiveWorkspaceScraps(clientInfo.sessionId);
            
            this.sendToClient(ws, {
                type: 'workspace_get_scraps_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    scraps: scraps
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get scraps error:', error);
            this.sendError(ws, 'Failed to get workspace scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = getWorkspace(id);
            
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_pinned', message.requestId);
                return;
            }
            
            // Get pinned images for the requested workspace
            const pinned = getActiveWorkspacePinned(clientInfo.sessionId);
            
            this.sendToClient(ws, {
                type: 'workspace_get_pinned_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    pinned: pinned
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get pinned error:', error);
            this.sendError(ws, 'Failed to get workspace pinned images', error.message, message.requestId);
        }
    }

    async handleWorkspaceAddScrap(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_add_scrap', message.requestId);
                return;
            }
            
            if (!filename) {
                this.sendError(ws, 'Filename is required', 'workspace_add_scrap', message.requestId);
                return;
            }
            
            addToWorkspaceArray('scraps', filename, id);
            
            this.sendToClient(ws, {
                type: 'workspace_add_scrap_response',
                requestId: message.requestId,
                data: { success: true, message: 'File added to scraps' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'scrap_added', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace add scrap error:', error);
            this.sendError(ws, 'Failed to add file to scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceRemoveScrap(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_remove_scrap', message.requestId);
                return;
            }
            
            if (!filename) {
                this.sendError(ws, 'Filename is required', 'workspace_remove_scrap', message.requestId);
                return;
            }
            
            removeFromWorkspaceArray('scraps', filename, id);
            
            this.sendToClient(ws, {
                type: 'workspace_remove_scrap_response',
                requestId: message.requestId,
                data: { success: true, message: 'File removed from scraps' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'scrap_removed', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace remove scrap error:', error);
            this.sendError(ws, 'Failed to remove file from scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceAddPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_add_pinned', message.requestId);
                return;
            }
            
            if (!filename) {
                this.sendError(ws, 'Filename is required', 'workspace_add_pinned', message.requestId);
                return;
            }
            
            addToWorkspaceArray('pinned', filename, id);
            
            this.sendToClient(ws, {
                type: 'workspace_add_pinned_response',
                requestId: message.requestId,
                data: { success: true, message: 'File added to pinned' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'pinned_added', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace add pinned error:', error);
            this.sendError(ws, 'Failed to add file to pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceRemovePinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_remove_pinned', message.requestId);
                return;
            }
            
            if (!filename) {
                this.sendError(ws, 'Filename is required', 'workspace_remove_pinned', message.requestId);
                return;
            }
            
            removeFromWorkspaceArray('pinned', filename, id);
            
            this.sendToClient(ws, {
                type: 'workspace_remove_pinned_response',
                requestId: message.requestId,
                data: { success: true, message: 'File removed from pinned' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'pinned_removed', workspaceId: id, filename },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace remove pinned error:', error);
            this.sendError(ws, 'Failed to remove file from pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceBulkPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_bulk_pinned', message.requestId);
                return;
            }
            
            let addedCount = 0;
            for (const filename of filenames) {
                addToWorkspaceArray('pinned', filename, id);
                addedCount++;
            }
            
            this.sendToClient(ws, {
                type: 'workspace_bulk_pinned_response',
                requestId: message.requestId,
                data: { success: true, message: `Added ${addedCount} files to pinned`, addedCount },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'bulk_pinned_added', workspaceId: id, addedCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk pinned error:', error);
            this.sendError(ws, 'Failed to add files to pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceBulkRemovePinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_bulk_remove_pinned', message.requestId);
                return;
            }
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_bulk_remove_pinned', message.requestId);
                return;
            }
            
            let successCount = 0;
            
            for (const filename of filenames) {
                try {
                    removeFromWorkspaceArray('pinned', filename, id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to remove ${filename} from pinned:`, error);
                }
            }
            
            this.sendToClient(ws, {
                type: 'workspace_bulk_remove_pinned_response',
                requestId: message.requestId,
                data: { success: true, removedCount: successCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'bulk_remove_pinned', workspaceId: id, removedCount: successCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk remove pinned error:', error);
            this.sendError(ws, 'Failed to bulk remove from pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetGroups(ws, message, clientInfo, wsServer) {
        try {
            const { id } = message;
            const workspace = getWorkspace(id);
            
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_groups', message.requestId);
                return;
            }
            
            const groups = getWorkspaceGroups(id);
            
            this.sendToClient(ws, {
                type: 'workspace_get_groups_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    groups: groups
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get groups error:', error);
            this.sendError(ws, 'Failed to get workspace groups', error.message, message.requestId);
        }
    }

    async handleWorkspaceCreateGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, name } = message;
            
            if (!name || !name.trim()) {
                this.sendError(ws, 'Group name is required', 'workspace_create_group', message.requestId);
                return;
            }
            
            const groupId = createGroup(id, name.trim());
            
            this.sendToClient(ws, {
                type: 'workspace_create_group_response',
                requestId: message.requestId,
                data: { success: true, groupId, name: name.trim() },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'group_created', workspaceId: id, groupId, name: name.trim() },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace create group error:', error);
            this.sendError(ws, 'Failed to create group', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId } = message;
            const workspace = getWorkspace(id);
            
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_group', message.requestId);
                return;
            }
            
            const group = getGroup(id, groupId);
            
            if (!group) {
                this.sendError(ws, 'Group not found', 'workspace_get_group', message.requestId);
                return;
            }
            
            this.sendToClient(ws, {
                type: 'workspace_get_group_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    group: group
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get group error:', error);
            this.sendError(ws, 'Failed to get group', error.message, message.requestId);
        }
    }

    async handleWorkspaceRenameGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId, name } = message;
            
            if (!name || !name.trim()) {
                this.sendError(ws, 'New group name is required', 'workspace_rename_group', message.requestId);
                return;
            }
            
            renameGroup(id, groupId, name.trim());
            
            this.sendToClient(ws, {
                type: 'workspace_rename_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Group renamed to "${name.trim()}"` },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'group_renamed', workspaceId: id, groupId, name: name.trim() },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace rename group error:', error);
            this.sendError(ws, 'Failed to rename group', error.message, message.requestId);
        }
    }

    async handleWorkspaceAddImagesToGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId, filenames } = message;
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_add_images_to_group', message.requestId);
                return;
            }
            
            addImagesToGroup(id, groupId, filenames);
            
            this.sendToClient(ws, {
                type: 'workspace_add_images_to_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Added ${filenames.length} images to group` },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'images_added_to_group', workspaceId: id, groupId, count: filenames.length },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace add images to group error:', error);
            this.sendError(ws, 'Failed to add images to group', error.message, message.requestId);
        }
    }

    async handleWorkspaceRemoveImagesFromGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId, filenames } = message;
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_remove_images_from_group', message.requestId);
                return;
            }
            
            removeImagesFromGroup(id, groupId, filenames);
            
            this.sendToClient(ws, {
                type: 'workspace_remove_images_from_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Removed ${filenames.length} images from group` },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'images_removed_from_group', workspaceId: id, groupId, count: filenames.length },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace remove images from group error:', error);
            this.sendError(ws, 'Failed to remove images from group', error.message, message.requestId);
        }
    }

    async handleWorkspaceDeleteGroup(ws, message, clientInfo, wsServer) {
        try {
            const { id, groupId } = message;
            
            deleteGroup(id, groupId);
            
            this.sendToClient(ws, {
                type: 'workspace_delete_group_response',
                requestId: message.requestId,
                data: { success: true, message: 'Group deleted' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'group_deleted', workspaceId: id, groupId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace delete group error:', error);
            this.sendError(ws, 'Failed to delete group', error.message, message.requestId);
        }
    }

    async handleWorkspaceGetImageGroups(ws, message, clientInfo, wsServer) {
        try {
            const { id, filename } = message;
            const workspace = getWorkspace(id);
            
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_image_groups', message.requestId);
                return;
            }
            
            const groups = getGroupsForImage(id, filename);
            
            this.sendToClient(ws, {
                type: 'workspace_get_image_groups_response',
                requestId: message.requestId,
                data: {
                    workspaceId: id,
                    workspaceName: workspace.name,
                    filename: filename,
                    groups: groups
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get image groups error:', error);
            this.sendError(ws, 'Failed to get image groups', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateColor(ws, message, clientInfo, wsServer) {
        try {
            const { id, color } = message;
            
            if (!color || !color.trim()) {
                this.sendError(ws, 'Color is required', 'workspace_update_color', message.requestId);
                return;
            }
            
            // Validate color format
            const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
            if (!colorRegex.test(color.trim())) {
                this.sendError(ws, 'Invalid color format. Use hex format (e.g., #ff4500)', 'workspace_update_color', message.requestId);
                return;
            }
            
            updateWorkspaceColor(id, color.trim());
            
            this.sendToClient(ws, {
                type: 'workspace_update_color_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace color updated' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'color_updated', workspaceId: id, color: color.trim() },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update color error:', error);
            this.sendError(ws, 'Failed to update workspace color', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateBackgroundColor(ws, message, clientInfo, wsServer) {
        try {
            const { id, backgroundColor } = message;
            
            updateWorkspaceBackgroundColor(id, backgroundColor);
            
            this.sendToClient(ws, {
                type: 'workspace_update_background_color_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace background color updated' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'background_color_updated', workspaceId: id, backgroundColor },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update background color error:', error);
            this.sendError(ws, 'Failed to update workspace background color', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdatePrimaryFont(ws, message, clientInfo, wsServer) {
        try {
            const { id, primaryFont } = message;
            // Allow null to reset
            updateWorkspacePrimaryFont(id, primaryFont || null);

            this.sendToClient(ws, {
                type: 'workspace_update_primary_font_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace primary font updated' },
                timestamp: new Date().toISOString()
            });

            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'primary_font_updated', workspaceId: id, primaryFont: primaryFont || null },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update primary font error:', error);
            this.sendError(ws, 'Failed to update workspace primary font', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateTextareaFont(ws, message, clientInfo, wsServer) {
        try {
            const { id, textareaFont } = message;
            // Allow null to reset
            updateWorkspaceTextareaFont(id, textareaFont || null);

            this.sendToClient(ws, {
                type: 'workspace_update_textarea_font_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace textarea font updated' },
                timestamp: new Date().toISOString()
            });

            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'textarea_font_updated', workspaceId: id, textareaFont: textareaFont || null },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update textarea font error:', error);
            this.sendError(ws, 'Failed to update workspace textarea font', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateSettings(ws, message, clientInfo, wsServer) {
        try {
            const { id, settings } = message;
            if (!id || !settings || typeof settings !== 'object') {
                this.sendError(ws, 'Workspace ID and settings object are required', 'workspace_update_settings', message.requestId);
                return;
            }

            // Validate color if provided
            if (settings.color) {
                const colorRegex = /^#([A-Fa-f0-9]{6}|[A-Fa-f0-9]{3})$/;
                if (!colorRegex.test(settings.color.trim())) {
                    this.sendError(ws, 'Invalid color format. Use hex format (e.g., #ff4500)', 'workspace_update_settings', message.requestId);
                    return;
                }
            }

            updateWorkspaceSettings(id, settings);

            this.sendToClient(ws, {
                type: 'workspace_update_settings_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace settings updated' },
                timestamp: new Date().toISOString()
            });

            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'settings_updated', workspaceId: id, settings },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update settings error:', error);
            this.sendError(ws, 'Failed to update workspace settings', error.message, message.requestId);
        }
    }

    async handleWorkspaceReorder(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceIds } = message;

            if (!Array.isArray(workspaceIds) || workspaceIds.length === 0) {
                this.sendError(ws, 'Workspace IDs array is required for reordering', 'workspace_reorder', message.requestId);
                return;
            }

            reorderWorkspaces(workspaceIds);

            this.sendToClient(ws, {
                type: 'workspace_reorder_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace order updated' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'reordered', workspaceIds },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace reorder error:', error);
            this.sendError(ws, 'Failed to reorder workspaces', error.message, message.requestId);
        }
    }

    // Bulk operation handlers
    async handleWorkspaceBulkAddScrap(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_bulk_add_scrap', message.requestId);
                return;
            }
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_bulk_add_scrap', message.requestId);
                return;
            }
            
            let successCount = 0;
            
            for (const filename of filenames) {
                try {
                    addToWorkspaceArray('scraps', filename, id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to add ${filename} to scraps:`, error);
                }
            }
            
            this.sendToClient(ws, {
                type: 'workspace_bulk_add_scrap_response',
                requestId: message.requestId,
                data: { success: true, addedCount: successCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'bulk_add_scrap', workspaceId: id, addedCount: successCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk add scrap error:', error);
            this.sendError(ws, 'Failed to bulk add to scraps', error.message, message.requestId);
        }
    }

    async handleWorkspaceBulkRemovePinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_bulk_remove_pinned', message.requestId);
                return;
            }
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_bulk_remove_pinned', message.requestId);
                return;
            }
            
            let successCount = 0;
            
            for (const filename of filenames) {
                try {
                    removeFromWorkspaceArray('pinned', filename, id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to remove ${filename} from pinned:`, error);
                }
            }
            
            this.sendToClient(ws, {
                type: 'workspace_bulk_remove_pinned_response',
                requestId: message.requestId,
                data: { success: true, removedCount: successCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'bulk_remove_pinned', workspaceId: id, removedCount: successCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk remove pinned error:', error);
            this.sendError(ws, 'Failed to bulk remove from pinned', error.message, message.requestId);
        }
    }

    async handleWorkspaceBulkAddPinned(ws, message, clientInfo, wsServer) {
        try {
            const { id, filenames } = message;
            
            if (!id) {
                this.sendError(ws, 'Workspace ID is required', 'workspace_bulk_add_pinned', message.requestId);
                return;
            }
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'workspace_bulk_add_pinned', message.requestId);
                return;
            }
            
            let successCount = 0;
            
            for (const filename of filenames) {
                try {
                    addToWorkspaceArray('pinned', filename, id);
                    successCount++;
                } catch (error) {
                    console.error(`Failed to add ${filename} to pinned:`, error);
                }
            }
            
            this.sendToClient(ws, {
                type: 'workspace_bulk_add_pinned_response',
                requestId: message.requestId,
                data: { success: true, addedCount: successCount },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'bulk_add_pinned', workspaceId: id, addedCount: successCount },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace bulk add pinned error:', error);
            this.sendError(ws, 'Failed to bulk add to pinned', error.message, message.requestId);
        }
    }

    async handleDeleteImagesBulk(ws, message, clientInfo, wsServer) {
        try {
            const { filenames } = message;
            
            if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'delete_images_bulk', message.requestId);
                return;
            }

            const results = [];
            const errors = [];

            // Helper functions
            const getBaseName = (filename) => {
                return filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
            };

            const getPreviewFilename = (baseName) => {
                return `${baseName}_preview.png`;
            };

            for (const filename of filenames) {
                try {
                    const filePath = path.join(imagesDir, filename);

                    if (!fs.existsSync(filePath)) {
                        errors.push({ filename, error: 'File not found' });
                        continue;
                    }

                    // Get the base name to find related files
                    const baseName = getBaseName(filename);
                    const previewFile = getPreviewFilename(baseName);
                    const previewPath = path.join(previewsDir, previewFile);

                    // Always delete both the base and upscaled version
                    const filesToDelete = [];
                    const filenamesToRemoveFromWorkspaces = [];

                    // Determine base/original and upscaled filenames
                    let originalFilename, upscaledFilename;
                    if (filename.includes('_upscaled')) {
                        upscaledFilename = filename;
                        originalFilename = filename.replace('_upscaled.png', '.png');
                    } else {
                        originalFilename = filename;
                        upscaledFilename = filename.replace('.png', '_upscaled.png');
                    }

                    // Add original file if exists
                    const originalPath = path.join(imagesDir, originalFilename);
                    if (fs.existsSync(originalPath)) {
                        filesToDelete.push({ path: originalPath, type: 'original' });
                        filenamesToRemoveFromWorkspaces.push(originalFilename);
                    }

                    // Add upscaled file if exists
                    const upscaledPath = path.join(imagesDir, upscaledFilename);
                    if (fs.existsSync(upscaledPath)) {
                        filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
                        filenamesToRemoveFromWorkspaces.push(upscaledFilename);
                    }

                    // Add the preview file
                    if (fs.existsSync(previewPath)) {
                        filesToDelete.push({ path: previewPath, type: 'preview' });
                    }

                    // Remove files from workspaces first
                    if (filenamesToRemoveFromWorkspaces.length > 0) {
                        removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                    }

                    // Remove metadata from cache
                    removeImageMetadata(filenamesToRemoveFromWorkspaces);

                    // Delete all related files
                    const deletedFiles = [];
                    for (const file of filesToDelete) {
                        try {
                            fs.unlinkSync(file.path);
                            deletedFiles.push(file.type);
                        } catch (error) {
                            console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
                        }
                    }

                    results.push({ filename, deletedFiles });
                    console.log(`🗑️ Bulk deleted: ${filename} (${deletedFiles.join(', ')})`);

                } catch (error) {
                    errors.push({ filename, error: error.message });
                }
            }

            // Sync workspace files to remove any remaining references to deleted files
            syncWorkspaceFiles();

            console.log(`✅ Bulk delete completed: ${results.length} successful, ${errors.length} failed`);
            
            this.sendToClient(ws, {
                type: 'delete_images_bulk_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Bulk delete completed',
                    results: results,
                    errors: errors,
                    totalProcessed: filenames.length,
                    successful: results.length,
                    failed: errors.length
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast gallery update to all clients
            wsServer.broadcast({
                type: 'gallery_updated',
                data: { 
                    action: 'bulk_delete', 
                    deletedCount: results.length,
                    viewType: 'images' // Default to images view for bulk delete
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Delete images bulk error:', error);
            this.sendError(ws, 'Failed to bulk delete images', error.message, message.requestId);
        }
    }

    async handleSendToSequenziaBulk(ws, message, clientInfo, wsServer) {
        try {
            const { filenames } = message;
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'send_to_sequenzia_bulk', message.requestId);
                return;
            }

            // Check if sequenzia folder is configured
            if (!config.sequenziaFolder) {
                this.sendError(ws, 'Sequenzia folder not configured in config.json', 'send_to_sequenzia_bulk', message.requestId);
                return;
            }

            // Create sequenzia folder if it doesn't exist
            if (!fs.existsSync(config.sequenziaFolder)) {
                try {
                    fs.mkdirSync(config.sequenziaFolder, { recursive: true });
                    console.log(`📁 Created sequenzia folder: ${config.sequenziaFolder}`);
                } catch (error) {
                    this.sendError(ws, `Failed to create sequenzia folder: ${error.message}`, 'send_to_sequenzia_bulk', message.requestId);
                    return;
                }
            }

            const results = [];
            const errors = [];

            for (const filename of filenames) {
                try {
                    const filePath = path.join(imagesDir, filename);

                    if (!fs.existsSync(filePath)) {
                        errors.push({ filename, error: 'File not found' });
                        continue;
                    }

                    // Get the base name to find related files
                    const baseName = filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
                    const previewFile = `${baseName}_preview.png`;
                    const previewPath = path.join(__dirname, '..', 'previews', previewFile);

                    // Find all related files
                    const filesToMove = [];
                    const filesToDelete = [];

                    // Determine base/original and upscaled filenames
                    let originalFilename, upscaledFilename;
                    if (filename.includes('_upscaled')) {
                        upscaledFilename = filename;
                        originalFilename = filename.replace('_upscaled.png', '.png');
                    } else {
                        originalFilename = filename;
                        upscaledFilename = filename.replace('.png', '_upscaled.png');
                    }

                    // Add original file if exists
                    const originalPath = path.join(imagesDir, originalFilename);
                    if (fs.existsSync(originalPath)) {
                        filesToMove.push({ source: originalPath, type: 'original' });
                        filesToDelete.push(originalPath);
                    }

                    // Add upscaled file if exists
                    const upscaledPath = path.join(imagesDir, upscaledFilename);
                    if (fs.existsSync(upscaledPath)) {
                        filesToMove.push({ source: upscaledPath, type: 'upscaled' });
                        filesToDelete.push(upscaledPath);
                    }

                    // Add preview file if exists
                    if (fs.existsSync(previewPath)) {
                        filesToDelete.push(previewPath);
                    }

                    // Move files to sequenzia folder
                    const movedFiles = [];
                    for (const file of filesToMove) {
                        const destPath = path.join(config.sequenziaFolder, path.basename(file.source));
                        fs.copyFileSync(file.source, destPath);
                        movedFiles.push(file.type);
                        console.log(`📁 Moved to sequenzia: ${path.basename(file.source)}`);
                    }

                    // Delete files from original location
                    const deletedFiles = [];
                    for (const filePath of filesToDelete) {
                        fs.unlinkSync(filePath);
                        deletedFiles.push(path.basename(filePath));
                    }

                    if (movedFiles.length > 0) {
                        // Remove files from workspaces first
                        if (filenamesToRemoveFromWorkspaces.length > 0) {
                            removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                        }
                    }

                    results.push({ filename, movedFiles, deletedFiles });
                    console.log(`✅ Sent to sequenzia: ${filename} (moved: ${movedFiles.join(', ')}, deleted: ${deletedFiles.join(', ')})`);

                } catch (error) {
                    errors.push({ filename, error: error.message });
                    console.error(`Failed to send ${filename} to Sequenzia:`, error);
                }
            }

            console.log(`✅ Send to sequenzia completed: ${results.length} successful, ${errors.length} failed`);
            
            this.sendToClient(ws, {
                type: 'send_to_sequenzia_bulk_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Images sent to sequenzia successfully',
                    results: results,
                    errors: errors,
                    totalProcessed: filenames.length,
                    successful: results.length,
                    failed: errors.length
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast gallery update to all clients
            wsServer.broadcast({
                type: 'gallery_updated',
                data: { 
                    action: 'bulk_sequenzia', 
                    movedCount: results.length,
                    viewType: 'images'
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Send to sequenzia bulk error:', error);
            this.sendError(ws, 'Failed to bulk send to sequenzia', error.message, message.requestId);
        }
    }

    async handleUpdateImagePresetBulk(ws, message, clientInfo, wsServer) {
        try {
            const { filenames, presetName } = message;
            
            if (!Array.isArray(filenames) || filenames.length === 0) {
                this.sendError(ws, 'Filenames array is required', 'update_image_preset_bulk', message.requestId);
                return;
            }

            const results = [];
            const errors = [];

            for (const filename of filenames) {
                try {
                    const filePath = path.join(imagesDir, filename);

                    if (!fs.existsSync(filePath)) {
                        errors.push({ filename, error: 'File not found' });
                        continue;
                    }

                    // Read the current image and extract metadata
                    const imageBuffer = fs.readFileSync(filePath);
                    const metadata = readMetadata(imageBuffer);

                    if (!metadata) {
                        errors.push({ filename, error: 'Failed to read metadata' });
                        continue;
                    }

                    // Update the preset name in the metadata
                    if (!metadata.forge_data) {
                        metadata.forge_data = {};
                    }

                    if (presetName === null || presetName === '') {
                        // Remove preset name
                        delete metadata.forge_data.preset_name;
                    } else {
                        // Set new preset name
                        metadata.forge_data.preset_name = presetName;
                    }

                    // Update the image with new metadata
                    const updatedImageBuffer = updateMetadata(imageBuffer, metadata.forge_data);

                    // Write the updated image back to disk
                    fs.writeFileSync(filePath, updatedImageBuffer);

                    results.push({ filename, presetName: presetName || 'removed' });
                    console.log(`✏️ Updated preset name for ${filename}: ${presetName || 'removed'}`);

                } catch (error) {
                    errors.push({ filename, error: error.message });
                    console.error(`Failed to update preset name for ${filename}:`, error);
                }
            }

            console.log(`✅ Bulk preset update completed: ${results.length} successful, ${errors.length} failed`);
            
            this.sendToClient(ws, {
                type: 'update_image_preset_bulk_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Bulk preset update completed',
                    results: results,
                    errors: errors,
                    totalProcessed: filenames.length,
                    updatedCount: results.length,
                    failed: errors.length
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast gallery update to all clients
            wsServer.broadcast({
                type: 'gallery_updated',
                data: { 
                    action: 'bulk_preset_update', 
                    updatedCount: results.length,
                    viewType: 'images'
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Update image preset bulk error:', error);
            this.sendError(ws, 'Failed to bulk update image presets', error.message, message.requestId);
        }
    }

    // References WebSocket Handlers
    async handleGetReferences(ws, message, clientInfo, wsServer) {
        try {
            const activeWorkspaceId = getActiveWorkspace(clientInfo.sessionId);
            const workspaces = getWorkspacesData();
            
            // Get cache files for active workspace (includes default + active workspace)
            const workspaceCacheFiles = getActiveWorkspaceCacheFiles(null, clientInfo.sessionId);
            const allFiles = fs.readdirSync(uploadCacheDir);
            const files = allFiles.filter(file => workspaceCacheFiles.includes(file));
            
            const cacheFiles = [];
            for (const file of files) {
                const filePath = path.join(uploadCacheDir, file);
                const stats = fs.statSync(filePath);
                const previewPath = path.join(previewCacheDir, `${file}.webp`);
                
                // Determine workspace ownership
                let workspaceId = 'default';
                if (activeWorkspaceId !== 'default' && workspaces[activeWorkspaceId] && workspaces[activeWorkspaceId].cacheFiles.includes(file)) {
                    workspaceId = activeWorkspaceId;
                }
                
                cacheFiles.push({
                    hash: file,
                    filename: file,
                    mtime: stats.mtime.valueOf(),
                    size: stats.size,
                    hasPreview: fs.existsSync(previewPath),
                    workspaceId: workspaceId
                });
            }
            
            // Get vibe images for current and default workspaces
            let vibeImageDetails = [];
            const currentWorkspace = getWorkspace(activeWorkspaceId);
            const defaultWorkspace = getWorkspace('default');
            
            if (currentWorkspace) {
                vibeImageDetails = this.collectVibeImageDetails(currentWorkspace.vibeImages || [], activeWorkspaceId);
            }
            
            // Add default workspace vibes if not already included
            if (activeWorkspaceId !== 'default' && defaultWorkspace) {
                vibeImageDetails = vibeImageDetails.concat(
                    this.collectVibeImageDetails(defaultWorkspace.vibeImages || [], 'default')
                );
            }
            
            // Sort by newest first
            cacheFiles.sort((a, b) => b.mtime - a.mtime);
            vibeImageDetails.sort((a, b) => b.mtime - a.mtime);
            
            this.sendToClient(ws, {
                type: 'get_references_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    data: {
                        cacheFiles: cacheFiles,
                        vibeImages: vibeImageDetails
                    }
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Get references error:', error);
            this.sendError(ws, 'Failed to get references', error.message, message.requestId);
        }
    }

    async handleGetReferencesByIds(ws, message, clientInfo, wsServer) {
        try {
            const { references } = message;
            
            if (!references || !Array.isArray(references)) {
                this.sendError(ws, 'Invalid references array', 'References must be an array of objects with type and id', message.requestId);
                return;
            }

            const results = [];
            
            for (const ref of references) {
                const { type, id } = ref;
                
                if (!type || !id) {
                    console.warn(`Invalid reference object: ${JSON.stringify(ref)}`);
                    continue;
                }

                try {
                    if (type === 'vibe') {
                        // Get vibe image data
                        const vibeData = await this.getVibeImageData(id);
                        if (vibeData) {
                            results.push({
                                type: 'vibe',
                                id: id,
                                data: vibeData
                            });
                        }
                    } else if (type === 'cache') {
                        // Get cache image data
                        const cacheData = await this.getCacheImageData(id);
                        if (cacheData) {
                            results.push({
                                type: 'cache',
                                id: id,
                                data: cacheData
                            });
                        }
                    } else {
                        console.warn(`Unknown reference type: ${type}`);
                    }
                } catch (error) {
                    console.error(`Error getting reference ${type}:${id}:`, error);
                    // Continue with other references
                }
            }

            this.sendToClient(ws, {
                type: 'get_references_by_ids_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    data: {
                        references: results
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Get references by IDs error:', error);
            this.sendError(ws, 'Failed to get references by IDs', error.message, message.requestId);
        }
    }

    // Helper method to get vibe image data by ID
    async getVibeImageData(vibeId) {
        try {
            // Search through all workspaces to find the vibe
            const workspaces = getWorkspaces();
            
            for (const [workspaceId, workspace] of Object.entries(workspaces)) {
                const vibeFiles = workspace.vibeImages || [];
                
                for (const filename of vibeFiles) {
                    const filePath = path.join(vibeCacheDir, filename);
                    if (fs.existsSync(filePath)) {
                        try {
                            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            if (vibeData.id === vibeId) {
                                // Transform encodings from object format to array format
                                if (vibeData.encodings && typeof vibeData.encodings === 'object') {
                                    const transformedEncodings = [];
                                    
                                    for (const [model, ieValues] of Object.entries(vibeData.encodings)) {
                                        for (const [ie, encoding] of Object.entries(ieValues)) {
                                            transformedEncodings.push({
                                                model: model,
                                                informationExtraction: parseFloat(ie),
                                                encoding: encoding
                                            });
                                        }
                                    }
                                    
                                    vibeData.encodings = transformedEncodings;
                                }
                                
                                // Process preview field to add .webp extension if it exists
                                if (vibeData.preview) {
                                    const previewPath = path.join(previewCacheDir, `${vibeData.preview}.webp`);
                                    vibeData.preview = fs.existsSync(previewPath) ? `${vibeData.preview}.webp` : null;
                                }
                                
                                // Add workspace info to the vibe data
                                return {
                                    ...vibeData,
                                    workspaceId: workspaceId
                                };
                            }
                        } catch (parseError) {
                            console.error(`Error parsing vibe file ${filename}:`, parseError);
                            continue;
                        }
                    }
                }
            }
            
            return null; // Vibe not found
        } catch (error) {
            console.error(`Error getting vibe image data for ${vibeId}:`, error);
            return null;
        }
    }

    // Helper method to get cache image data by hash
    async getCacheImageData(cacheHash) {
        try {
            const filePath = path.join(uploadCacheDir, cacheHash);
            const previewPath = path.join(previewCacheDir, `${cacheHash}.webp`);
            
            if (!fs.existsSync(filePath)) {
                return null; // Cache file not found
            }
            
            const stats = fs.statSync(filePath);
            
            // Find which workspace owns this cache file
            const workspaces = getWorkspaces();
            let workspaceId = 'default';
            
            for (const [wsId, workspace] of Object.entries(workspaces)) {
                if (workspace.cacheFiles && workspace.cacheFiles.includes(cacheHash)) {
                    workspaceId = wsId;
                    break;
                }
            }
            
            return {
                hash: cacheHash,
                filename: cacheHash,
                mtime: stats.mtime.valueOf(),
                size: stats.size,
                hasPreview: fs.existsSync(previewPath),
                workspaceId: workspaceId
            };
        } catch (error) {
            console.error(`Error getting cache image data for ${cacheHash}:`, error);
            return null;
        }
    }

    async handleGetWorkspaceReferences(ws, message, clientInfo, wsServer) {
        try {            
            const workspaceId = message.workspaceId;
            
            let cacheFiles = [];
            let vibeImageDetails = [];
            
            if (workspaceId === 'all') {
                // Get references from all workspaces
                const workspaces = getWorkspaces();
                const allWorkspaces = Object.entries(workspaces);

                // Collect all unique cache files across all workspaces
                const allCacheFileHashes = new Set();
                
                // First pass: collect all unique cache file hashes
                for (const [currentWorkspaceId, workspace] of allWorkspaces) {
                    const workspaceCacheFiles = getActiveWorkspaceCacheFiles(currentWorkspaceId);
                    workspaceCacheFiles.forEach(file => allCacheFileHashes.add(file));
                }
                
                // Second pass: process each unique cache file
                const allFiles = fs.readdirSync(uploadCacheDir);
                for (const file of allCacheFileHashes) {
                    if (!allFiles.includes(file)) continue; // Skip if file doesn't exist on disk
                    
                    // Find which workspaces contain this file
                    const workspacesWithFile = [];
                    for (const [currentWorkspaceId, workspace] of allWorkspaces) {
                        const workspaceCacheFiles = getActiveWorkspaceCacheFiles(currentWorkspaceId);
                        if (workspaceCacheFiles.includes(file)) {
                            workspacesWithFile.push(currentWorkspaceId);
                        }
                    }
                    
                    // Use the first workspace that contains the file (or primary workspace)
                    const primaryWorkspaceId = workspacesWithFile[0] || 'default';
                    
                    const filePath = path.join(uploadCacheDir, file);
                    const stats = fs.statSync(filePath);
                    const previewPath = path.join(previewCacheDir, `${file}.webp`);
                    
                    cacheFiles.push({
                        hash: file,
                        filename: file,
                        mtime: stats.mtime.valueOf(),
                        size: stats.size,
                        hasPreview: fs.existsSync(previewPath),
                        workspaceId: primaryWorkspaceId,
                        workspaces: workspacesWithFile // Include all workspaces that have this file
                    });
                }
                
                // Process vibe images for each workspace
                for (const [currentWorkspaceId, workspace] of allWorkspaces) {
                    // Get vibe images for this workspace
                    const workspaceVibeDetails = this.collectVibeImageDetails(workspace.vibeImages || [], currentWorkspaceId);
                    vibeImageDetails.push(...workspaceVibeDetails);
                }
                
            } else {
                // Get cache files for specific workspace
                const workspaceCacheFiles = getActiveWorkspaceCacheFiles(workspaceId);
                const allFiles = fs.readdirSync(uploadCacheDir);
                const files = allFiles.filter(file => workspaceCacheFiles.includes(file));
                
                for (const file of files) {
                    const filePath = path.join(uploadCacheDir, file);
                    const stats = fs.statSync(filePath);
                    const previewPath = path.join(previewCacheDir, `${file}.webp`);
                    
                    cacheFiles.push({
                        hash: file,
                        filename: file,
                        mtime: stats.mtime.valueOf(),
                        size: stats.size,
                        hasPreview: fs.existsSync(previewPath),
                        workspaceId: workspaceId
                    });
                }
                
                // Get vibe images for the workspace
                const workspace = getWorkspace(workspaceId);
                vibeImageDetails = workspace ? 
                    this.collectVibeImageDetails(workspace.vibeImages || [], workspaceId) : [];
            }
            
            // Sort by newest first
            cacheFiles.sort((a, b) => b.mtime - a.mtime);
            vibeImageDetails.sort((a, b) => b.mtime - a.mtime);
            
            this.sendToClient(ws, {
                type: 'get_workspace_references_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    data: {
                        cacheFiles: cacheFiles,
                        vibeImages: vibeImageDetails
                    }
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Get workspace references error:', error);
            this.sendError(ws, 'Failed to get workspace references', error.message, message.requestId);
        }
    }

    async handleDeleteReference(ws, message, clientInfo, wsServer) {
        try {
            const { hash, workspaceId } = message;
            const filePath = path.join(uploadCacheDir, hash);
            const previewPath = path.join(previewCacheDir, `${hash}.webp`);
            
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                this.sendError(ws, 'Reference not found', 'Cache file not found', message.requestId);
                return;
            }
            
            // Before deleting, check if any vibes use this cache image and convert them to base64
            await this.convertVibesToBase64(hash, workspaceId);
            
            // Delete main file
            fs.unlinkSync(filePath);
            
            // Delete preview if it exists
            if (fs.existsSync(previewPath)) {
                fs.unlinkSync(previewPath);
            }
            
            // Remove from workspace cache files
            removeFromWorkspaceArray('cacheFiles', hash, workspaceId);
            
            this.sendToClient(ws, {
                type: 'delete_reference_response',
                requestId: message.requestId,
                data: { success: true, message: 'Reference deleted successfully' },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Delete reference error:', error);
            this.sendError(ws, 'Failed to delete reference', error.message, message.requestId);
        }
    }

    // Helper function to convert vibes from cache reference to base64
    async convertVibesToBase64(cacheHash, workspaceId) {
        try {
            const workspace = getWorkspace(workspaceId);
            if (!workspace) {
                console.warn(`Workspace ${workspaceId} not found for vibe conversion`);
                return;
            }
            
            const vibeFiles = workspace.vibeImages || [];
            const convertedVibes = [];
            
            // Find all vibes that use this cache image
            for (const filename of vibeFiles) {
                const filePath = path.join(vibeCacheDir, filename);
                if (fs.existsSync(filePath)) {
                    try {
                        const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        
                        // Check if this vibe uses the cache image we're about to delete
                        if (vibeData.type === 'cache' && vibeData.image === cacheHash) {
                            console.log(`🔄 Converting vibe ${vibeData.id} from cache reference to base64`);
                            
                            // Read the cache image and convert to base64
                            const cachePath = path.join(uploadCacheDir, cacheHash);
                            if (fs.existsSync(cachePath)) {
                                const imageBuffer = fs.readFileSync(cachePath);
                                const imageBase64 = imageBuffer.toString('base64');
                                
                                // Update the vibe data to use base64 instead of cache reference
                                vibeData.type = 'base64';
                                vibeData.image = imageBase64;
                                
                                // Write the updated vibe data back to file
                                fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                                
                                convertedVibes.push(vibeData.id);
                                console.log(`✅ Converted vibe ${vibeData.id} to base64 format`);
                            } else {
                                console.warn(`Cache file ${cacheHash} not found for vibe conversion`);
                            }
                        }
                    } catch (parseError) {
                        console.error(`Error parsing vibe file ${filename}:`, parseError);
                        continue;
                    }
                }
            }
            
            if (convertedVibes.length > 0) {
                console.log(`🔄 Converted ${convertedVibes.length} vibes to base64 format before deleting cache image ${cacheHash}`);
            }
            
        } catch (error) {
            console.error('Error converting vibes to base64:', error);
            // Don't throw error - we still want to delete the reference even if conversion fails
        }
    }

    async handleUploadReference(ws, message, clientInfo, wsServer) {
        try {
            const { imageData, workspaceId, tempFile } = message;
            
            // Validate workspace parameter
            if (!workspaceId) {
                this.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }
            
            // Validate that the workspace exists
            const workspaces = getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }
            
            let imageBuffer, hash;
            
            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }
                
                imageBuffer = fs.readFileSync(tempFilePath);
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                
                console.log(`📥 Using downloaded temp file: ${tempFile} -> ${hash}`);
            } else if (imageData) {
                // Handle base64 image data
                imageBuffer = Buffer.from(imageData, 'base64');
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
            } else {
                this.sendError(ws, 'Missing image data', 'Either imageData or tempFile must be provided', message.requestId);
                return;
            }
            
            // Save file
            const filePath = path.join(uploadCacheDir, hash);
            fs.writeFileSync(filePath, imageBuffer);
            
            // Handle preview - use existing temp preview if available, otherwise generate new one
            const previewPath = path.join(previewCacheDir, `${hash}.webp`);
            let generatePreview = true;
            if (tempFile) {
                // Check if temp preview exists from download process
                const tempPreviewPath = path.join(cacheDir, 'tempDownload', `${hash}.webp`);
                if (fs.existsSync(tempPreviewPath)) {
                    // Move temp preview to permanent preview cache
                    fs.copyFileSync(tempPreviewPath, previewPath);
                    console.log(`📸 Moved temp preview to permanent storage: ${hash}.webp`);
                    generatePreview = false;
                }
            }
            if (generatePreview) {
                // Generate new preview for non-downloaded files
                await sharp(imageBuffer)
                    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(previewPath);
                console.log(`📸 Generated new preview: ${hash}.webp`);
            }
            
            // Add to workspace cache files
            addToWorkspaceArray('cacheFiles', hash, workspaceId);
            
            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(cacheDir, 'tempDownload', `${hash}.webp`);
                    
                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }
                    
                    // Delete the temp preview
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${hash}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }
            
            this.sendToClient(ws, {
                type: 'upload_reference_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Reference uploaded successfully',
                    hash: hash
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Upload reference error:', error);
            this.sendError(ws, 'Failed to upload reference', error.message, message.requestId);
        }
    }

    async handleDownloadUrlFile(ws, message, clientInfo, wsServer) {
        try {
            const { url } = message;
            
            // Validate URL
            if (!url || typeof url !== 'string') {
                this.sendError(ws, 'Invalid URL', 'URL parameter is required and must be a string', message.requestId);
                return;
            }
            
            try {
                // Create temp download directory if it doesn't exist
                const tempDownloadDir = path.join(cacheDir, 'tempDownload');
                if (!fs.existsSync(tempDownloadDir)) {
                    fs.mkdirSync(tempDownloadDir, { recursive: true });
                }
                
                // Download the file
                const response = await new Promise((resolve, reject) => {
                    const req = https.request(url, { method: 'GET' }, (res) => {
                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                            return;
                        }
                        
                        const chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => {
                            const buffer = Buffer.concat(chunks);
                            resolve({
                                buffer,
                                headers: res.headers,
                                statusCode: res.statusCode
                            });
                        });
                    });
                    
                    req.on('error', reject);
                    req.setTimeout(30000, () => req.destroy()); // 30 second timeout
                    req.end();
                });
                
                // Validate file size (max 100MB)
                const maxSize = 100 * 1024 * 1024; // 100MB
                if (response.buffer.length > maxSize) {
                    throw new Error(`File too large: ${(response.buffer.length / 1024 / 1024).toFixed(2)}MB. Maximum size is 100MB.`);
                }
                
                // Generate unique filename
                const timestamp = Date.now();
                const randomSeed = Math.floor(Math.random() * 1000000000);
                const tempFilename = `temp_${timestamp}_${randomSeed}`;
                const tempFilePath = path.join(tempDownloadDir, tempFilename);
                
                // Determine file type and handle accordingly
                const contentType = response.headers['content-type'] || '';
                // Clean content type by removing parameters (like charset=utf-8)
                const cleanContentType = contentType.split(';')[0].trim();
                let fileInfo = {};
                
                if (cleanContentType.startsWith('image/')) {
                    // Handle image files
                    const extension = contentType.includes('jpeg') ? '.jpg' : 
                                     contentType.includes('png') ? '.png' : 
                                     contentType.includes('webp') ? '.webp' : '.jpg';
                    
                    // Generate hash for the file
                    const hash = crypto.createHash('md5').update(response.buffer).digest('hex');
                    
                    // Extract original filename from URL or use hash
                    let originalFilename = '';
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        const urlFilename = path.basename(pathname);
                        
                        // Clean the filename (remove query params, invalid chars, etc.)
                        if (urlFilename && urlFilename.includes('.') && urlFilename.length > 1) {
                            // Remove query parameters and hash fragments
                            const cleanFilename = urlFilename.split('?')[0].split('#')[0];
                            // Remove invalid characters but keep dots and dashes
                            originalFilename = cleanFilename.replace(/[<>:"/\\|?*]/g, '_');
                        }
                    } catch (urlError) {
                        console.log(`⚠️ Could not parse URL for filename: ${urlError.message}`);
                    }
                    
                    // Store file as hash.dat in tempDownloadDir
                    const finalTempFilename = `${hash}.dat`;
                    const finalTempFilePath = path.join(tempDownloadDir, finalTempFilename);
                    fs.writeFileSync(finalTempFilePath, response.buffer);
                    
                    // Generate and save preview in tempDownloadDir
                    const previewPath = path.join(tempDownloadDir, `${hash}.webp`);
                    await sharp(response.buffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);
                    
                    // Extract metadata for potential blueprints
                    let metadata = null;
                    let isBlueprint = false;
                    
                    if (cleanContentType === 'image/png') {
                                        try {
                    // Extract comprehensive metadata in the format the client expects
                    const extractedMetadata = await extractMetadataSummary(response.buffer, originalFilename || finalTempFilename);
                    
                    if (extractedMetadata.success && extractedMetadata.isBlueprint) {
                        isBlueprint = true;
                        metadata = extractedMetadata;
                    }
                } catch (metadataError) {
                    console.log(`⚠️ Could not extract metadata from PNG: ${metadataError.message}`);
                }
                    }
                    
                    fileInfo = {
                        type: 'image',
                        tempFilename: finalTempFilename,
                        originalFilename: originalFilename,
                        hash: hash,
                        size: response.buffer.length,
                        contentType: contentType,
                        url: url,
                        hasPreview: true,
                        isBlueprint: isBlueprint,
                        metadata: metadata
                    };
                    
                    console.log(`📥 Downloaded image from URL: ${url} -> ${finalTempFilename} (${hash})${isBlueprint ? ' (NovelAI Generated)' : ''}`);
                    
                } else if (cleanContentType === 'application/json' || url.endsWith('.json')) {
                    // Handle JSON files (vibe bundles)
                    
                    // Generate hash for the file
                    const hash = crypto.createHash('md5').update(response.buffer).digest('hex');
                    
                    // Extract original filename from URL or use hash
                    let originalFilename = '';
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        const urlFilename = path.basename(pathname);
                        
                        // Clean the filename (remove query params, invalid chars, etc.)
                        if (urlFilename && urlFilename.includes('.') && urlFilename.length > 1) {
                            // Remove query parameters and hash fragments
                            const cleanFilename = urlFilename.split('?')[0].split('#')[0];
                            // Remove invalid characters but keep dots and dashes
                            originalFilename = cleanFilename.replace(/[<>:"/\\|*]/g, '_');
                        }
                    } catch (urlError) {
                        console.log(`⚠️ Could not parse URL for filename: ${urlError.message}`);
                    }
                    
                    // Store file as hash.dat in tempDownloadDir
                    const finalTempFilename = `${hash}.dat`;
                    const finalTempFilePath = path.join(tempDownloadDir, finalTempFilename);
                    fs.writeFileSync(finalTempFilePath, response.buffer);
                    
                    // Parse JSON to extract metadata
                    let jsonData;
                    try {
                        jsonData = JSON.parse(response.buffer.toString());
                    } catch (parseError) {
                        throw new Error('Invalid JSON file');
                    }
                    
                    // Check if it's a vibe bundle
                    if (jsonData.identifier === 'novelai-vibe-transfer' || jsonData.vibes) {
                        const vibes = jsonData.vibes ? jsonData.vibes : [jsonData];
                        const vibeCount = vibes.length;
                        
                        // Extract detailed metadata for each vibe
                        const vibeMetadata = [];
                        
                        for (const vibe of vibes) {
                            try {
                                // Extract thumbnail if available
                                let thumbnail = null;
                                if (vibe.thumbnail && vibe.thumbnail.startsWith('data:image/')) {
                                    // Save thumbnail to preview cache
                                    const thumbnailBase64 = vibe.thumbnail.split(',')[1];
                                    const thumbnailBuffer = Buffer.from(thumbnailBase64, 'base64');
                                    const thumbnailHash = crypto.createHash('md5').update(thumbnailBuffer).digest('hex');
                                    const thumbnailPath = path.join(previewCacheDir, `${thumbnailHash}.webp`);
                                    
                                    if (!fs.existsSync(thumbnailPath)) {
                                        await sharp(thumbnailBuffer)
                                            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                                            .webp({ quality: 80 })
                                            .toFile(thumbnailPath);
                                    }
                                    
                                    thumbnail = thumbnailHash;
                                }
                                
                                // Extract encoding information
                                const encodings = {};
                                if (vibe.encodings) {
                                    Object.entries(vibe.encodings).forEach(([bundleModel, modelEncodings]) => {
                                        if (!encodings[bundleModel]) {
                                            encodings[bundleModel] = {};
                                        }
                                        
                                        Object.entries(modelEncodings).forEach(([encodingId, encodingData]) => {
                                            let ie = 1;
                                            if (encodingId !== 'unknown') {
                                                ie = encodingData.params?.information_extracted || 1;
                                            } else if (vibe.importInfo && vibe.importInfo.information_extracted) {
                                                ie = vibe.importInfo.information_extracted;
                                            }
                                            
                                            if (encodingData.encoding && encodingData.encoding.trim() !== '') {
                                                encodings[bundleModel][ie] = encodingData.encoding;
                                            }
                                        });
                                    });
                                }
                                
                                vibeMetadata.push({
                                    id: vibe.id || 'unknown',
                                    name: vibe.name || 'Unnamed Vibe',
                                    thumbnail: thumbnail,
                                    encodings: encodings,
                                    model: vibe.model || 'Unknown',
                                    createdAt: vibe.createdAt || Date.now(),
                                    importInfo: vibe.importInfo || {}
                                });
                            } catch (vibeError) {
                                console.warn(`⚠️ Error processing vibe ${vibe.id || vibe.name}: ${vibeError.message}`);
                                // Add basic info for failed vibes
                                vibeMetadata.push({
                                    id: vibe.id || 'unknown',
                                    name: vibe.name || 'Unnamed Vibe',
                                    thumbnail: null,
                                    encodings: {},
                                    model: vibe.model || 'Unknown',
                                    createdAt: vibe.createdAt || Date.now(),
                                    importInfo: {},
                                    error: vibeError.message
                                });
                            }
                        }
                        
                        fileInfo = {
                            type: 'vibe_bundle',
                            tempFilename: finalTempFilename,
                            originalFilename: originalFilename,
                            hash: hash,
                            size: response.buffer.length,
                            contentType: contentType,
                            url: url,
                            vibeCount: vibeCount,
                            model: jsonData.model || 'Unknown',
                            identifier: jsonData.identifier || 'novelai-vibe-transfer',
                            vibes: vibeMetadata
                        };
                        
                        console.log(`📥 Downloaded vibe bundle from URL: ${url} -> ${finalTempFilename} (${vibeCount} vibes)`);
                    } else {
                        // Generic JSON file
                        fileInfo = {
                            type: 'json',
                            tempFilename: finalTempFilename,
                            size: response.buffer.length,
                            contentType: contentType,
                            url: url
                        };
                        
                        console.log(`📥 Downloaded JSON file from URL: ${url} -> ${finalTempFilename}`);
                    }
                    
                } else {
                    // Unsupported file type
                    throw new Error(`Unsupported file type: ${contentType}. Only image files and JSON files are allowed.`);
                }
                
                this.sendToClient(ws, {
                    type: 'download_url_file_response',
                    requestId: message.requestId,
                    data: { 
                        success: true, 
                        message: 'File downloaded successfully',
                        ...fileInfo
                    },
                    timestamp: new Date().toISOString()
                });
                
            } catch (downloadError) {
                console.error('URL download error:', downloadError);
                this.sendError(ws, 'Failed to download file from URL', downloadError.message, message.requestId);
            }
            
        } catch (error) {
            console.error('Download URL file error:', error);
            this.sendError(ws, 'Failed to process download request', error.message, message.requestId);
        }
    }

    // Universal fetch handler for any HTTP request with configurable response handling
    async handleFetchUrl(ws, message, clientInfo, wsServer) {
        try {
            const { url, options = {}, responseType = 'json' } = message;
            
            // Validate URL
            if (!url || typeof url !== 'string') {
                this.sendError(ws, 'Invalid URL', 'URL parameter is required and must be a string', message.requestId);
                return;
            }
            
            // Set default options
            const fetchOptions = {
                method: 'GET',
                signal: AbortSignal.timeout(30000), // 30 second default timeout
                ...options
            };
            
            // Override timeout if specified in options
            if (options.timeout) {
                fetchOptions.signal = AbortSignal.timeout(options.timeout);
            }
            
            try {
                // Make the fetch request
                const response = await fetch(url, fetchOptions);
                
                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }
                
                // Handle different response types
                let responseData = null;
                let additionalInfo = {};
                
                switch (responseType) {
                    case 'save_file':
                        // Save file to specified destination
                        const { destination, filename } = options;
                        if (!destination || !filename) {
                            throw new Error('save_file response type requires destination and filename options');
                        }
                        
                        const buffer = await response.arrayBuffer();
                        const filePath = path.join(destination, filename);
                        
                        // Ensure destination directory exists
                        const destDir = path.dirname(filePath);
                        if (!fs.existsSync(destDir)) {
                            fs.mkdirSync(destDir, { recursive: true });
                        }
                        
                        fs.writeFileSync(filePath, Buffer.from(buffer));
                        
                        responseData = {
                            success: true,
                            savedPath: filePath,
                            size: buffer.byteLength,
                            contentType: response.headers.get('content-type') || 'Unknown'
                        };
                        break;
                        
                    case 'base64':
                        // Return base64 encoded binary data
                        const arrayBuffer = await response.arrayBuffer();
                        const base64Data = Buffer.from(arrayBuffer).toString('base64');
                        
                        responseData = {
                            success: true,
                            data: base64Data,
                            size: arrayBuffer.byteLength,
                            contentType: response.headers.get('content-type') || 'Unknown'
                        };
                        break;
                        
                    case 'arraybuffer':
                        // Return array buffer data with optional byte limiting
                        let finalArrayBuffer;
                        if (options.maxBytes && options.maxBytes > 0) {
                            // Limit the number of bytes read by using a ReadableStream reader
                            // This allows us to stop accepting data after maxBytes and cancel the request
                            const reader = response.body.getReader();
                            const chunks = [];
                            let totalBytes = 0;
                            
                            try {
                                while (totalBytes < options.maxBytes) {
                                    const { done, value } = await reader.read();
                                    if (done) break;
                                    
                                    chunks.push(value);
                                    totalBytes += value.length;
                                    
                                    if (totalBytes >= options.maxBytes) {
                                        // Truncate the last chunk if needed
                                        const remainingBytes = options.maxBytes - (totalBytes - value.length);
                                        if (remainingBytes < value.length) {
                                            chunks[chunks.length - 1] = value.slice(0, remainingBytes);
                                            totalBytes = options.maxBytes;
                                        }
                                        break;
                                    }
                                }
                                
                                // Cancel the reader to stop further data transfer
                                await reader.cancel();
                                
                                // Combine chunks into a single array buffer
                                const totalLength = Math.min(totalBytes, options.maxBytes);
                                finalArrayBuffer = new ArrayBuffer(totalLength);
                                const uint8Array = new Uint8Array(finalArrayBuffer);
                                
                                let offset = 0;
                                for (const chunk of chunks) {
                                    uint8Array.set(chunk, offset);
                                    offset += chunk.length;
                                }
                                
                            } catch (readError) {
                                console.warn('Error reading response body with byte limit:', readError);
                                // Fall back to full response if byte limiting fails
                                finalArrayBuffer = await response.arrayBuffer();
                            }
                        } else {
                            // No byte limit, read the full response
                            finalArrayBuffer = await response.arrayBuffer();
                        }
                        
                        // Handle gzip encoding - if content is gzipped, we need to decompress it
                        // Note: For byte-limited requests, we're getting raw compressed data
                        // This is actually fine for magic byte detection since we're looking at the first bytes
                        // But we should log this for debugging
                        const contentEncoding = response.headers.get('content-encoding');
                        if (contentEncoding === 'gzip') {
                            console.log('⚠️ Response is gzip encoded - magic bytes may not work correctly');
                        }
                        
                        responseData = {
                            success: true,
                            data: Buffer.from(finalArrayBuffer).toString('base64'),
                            size: finalArrayBuffer.byteLength,
                            contentType: response.headers.get('content-type') || 'Unknown'
                        };
                        break;
                        
                    case 'text':
                        // Return plain text
                        const textData = await response.text();
                        
                        responseData = {
                            success: true,
                            data: textData,
                            size: textData.length,
                            contentType: response.headers.get('content-type') || 'text/plain'
                        };
                        break;
                        
                    case 'json':
                    default:
                        // Return JSON data
                        try {
                            const jsonData = await response.json();
                            responseData = {
                                success: true,
                                data: jsonData,
                                contentType: response.headers.get('content-type') || 'application/json'
                            };
                        } catch (jsonError) {
                            // If JSON parsing fails, fall back to text
                            const fallbackText = await response.text();
                            responseData = {
                                success: true,
                                data: fallbackText,
                                contentType: response.headers.get('content-type') || 'text/plain',
                                note: 'JSON parsing failed, returned as text'
                            };
                        }
                        break;
                }
                
                // Add common response information
                additionalInfo = {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    url: response.url,
                    timestamp: new Date().toISOString()
                };
                
                // Send success response
                this.sendToClient(ws, {
                    type: 'fetch_url_info_response',
                    requestId: message.requestId,
                    data: {
                        ...responseData,
                        ...additionalInfo
                    },
                    timestamp: new Date().toISOString()
                });
                
            } catch (fetchError) {
                console.error('URL fetch error:', fetchError);
                
                // Send error response with fallback information
                let fallbackInfo = {};
                
                try {
                    const urlObj = new URL(url);
                    fallbackInfo = {
                        domain: urlObj.hostname,
                        protocol: urlObj.protocol,
                        pathname: urlObj.pathname,
                        filename: path.basename(urlObj.pathname) || 'Unknown'
                    };
                } catch (urlError) {
                    fallbackInfo = {
                        domain: 'Unknown',
                        protocol: 'Unknown',
                        pathname: 'Unknown',
                        filename: 'Unknown'
                    };
                }
                
                this.sendToClient(ws, {
                    type: 'fetch_url_info_response',
                    requestId: message.requestId,
                    data: {
                        success: false,
                        error: fetchError.message,
                        errorType: fetchError.name,
                        ...fallbackInfo
                    },
                    timestamp: new Date().toISOString()
                });
            }
            
        } catch (error) {
            console.error('Fetch URL info error:', error);
            this.sendError(ws, 'Failed to process fetch request', error.message, message.requestId);
        }
    }

    async handleMoveReferences(ws, message, clientInfo, wsServer) {
        try {
            const { hashes, targetWorkspaceId, sourceWorkspaceId } = message;
            
            // Move each hash from source to target workspace
            for (const hash of hashes) {
                removeFromWorkspaceArray('cacheFiles', hash, sourceWorkspaceId);
                addToWorkspaceArray('cacheFiles', hash, targetWorkspaceId);
            }
            
            this.sendToClient(ws, {
                type: 'move_references_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: `${hashes.length} reference(s) moved successfully`,
                    movedCount: hashes.length
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Move references error:', error);
            this.sendError(ws, 'Failed to move references', error.message, message.requestId);
        }
    }

    async handleGetVibeImage(ws, message, clientInfo, wsServer) {
        try {
            const filename = message.filename + '.json';
            const filePath = path.join(vibeCacheDir, filename);
            
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found', message.requestId);
                return;
            }
            
            // Parse and return JSON data
            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            this.sendToClient(ws, {
                type: 'get_vibe_image_response',
                requestId: message.requestId,
                data: vibeData,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Get vibe image error:', error);
            this.sendError(ws, 'Failed to get vibe image', error.message, message.requestId);
        }
    }

    async handleDeleteVibeImage(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, workspaceId } = message;
            
            // Find the vibe file by ID
            const workspace = getWorkspace(workspaceId);
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'Workspace not found', message.requestId);
                return;
            }
            
            const vibeFiles = workspace.vibeImages || [];
            let foundFilename = null;
            
            // Find the filename that contains this vibe ID
            for (const filename of vibeFiles) {
                const filePath = path.join(vibeCacheDir, filename);
                if (fs.existsSync(filePath)) {
                    try {
                        const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (vibeData.id === vibeId) {
                            foundFilename = filename;
                            break;
                        }
                    } catch (parseError) {
                        console.error(`Error parsing vibe file ${filename}:`, parseError);
                        continue;
                    }
                }
            }
            
            if (!foundFilename) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found', message.requestId);
                return;
            }
            
            // Delete the file
            const filePath = path.join(vibeCacheDir, foundFilename);
            fs.unlinkSync(filePath);
            
            // Remove from workspace
            removeFromWorkspaceArray('vibeImages', foundFilename, workspaceId);
            
            this.sendToClient(ws, {
                type: 'delete_vibe_image_response',
                requestId: message.requestId,
                data: { success: true, message: 'Vibe image deleted successfully' },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Delete vibe image error:', error);
            this.sendError(ws, 'Failed to delete vibe image', error.message, message.requestId);
        }
    }

    async handleDeleteVibeEncodings(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, encodings, workspaceId } = message;
            
            // Find the vibe file by ID
            const workspace = getWorkspace(workspaceId);
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'Workspace not found', message.requestId);
                return;
            }
            
            const vibeFiles = workspace.vibeImages || [];
            let foundFilename = null;
            
            // Find the filename that contains this vibe ID
            for (const filename of vibeFiles) {
                const filePath = path.join(vibeCacheDir, filename);
                if (fs.existsSync(filePath)) {
                    try {
                        const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (vibeData.id === vibeId) {
                            foundFilename = filename;
                            break;
                        }
                    } catch (parseError) {
                        console.error(`Error parsing vibe file ${filename}:`, parseError);
                        continue;
                    }
                }
            }
            
            if (!foundFilename) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found', message.requestId);
                return;
            }
            
            // Read and update the vibe data
            const filePath = path.join(vibeCacheDir, foundFilename);
            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
            
            // Remove specified encodings
            if (vibeData.encodings) {
                vibeData.encodings = vibeData.encodings.filter(encoding => {
                    return !encodings.some(enc => 
                        enc.model === encoding.model && 
                        enc.informationExtraction === encoding.informationExtraction
                    );
                });
            }
            
            // Write updated data back
            fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
            
            this.sendToClient(ws, {
                type: 'delete_vibe_encodings_response',
                requestId: message.requestId,
                data: { success: true, message: 'Vibe encodings deleted successfully' },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Delete vibe encodings error:', error);
            this.sendError(ws, 'Failed to delete vibe encodings', error.message, message.requestId);
        }
    }

    async handleBulkDeleteVibeImages(ws, message, clientInfo, wsServer) {
        try {
            const { vibesToDelete, encodingsToDelete, workspaceId } = message;
            
            const workspace = getWorkspace(workspaceId);
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'Workspace not found', message.requestId);
                return;
            }
            
            const vibeFiles = workspace.vibeImages || [];
            const deletedVibes = [];
            const deletedEncodings = [];
            
            // Delete entire vibes
            for (const vibeId of vibesToDelete) {
                let foundFilename = null;
                
                // Find the filename that contains this vibe ID
                for (const filename of vibeFiles) {
                    const filePath = path.join(vibeCacheDir, filename);
                    if (fs.existsSync(filePath)) {
                        try {
                            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            if (vibeData.id === vibeId) {
                                foundFilename = filename;
                                break;
                            }
                        } catch (parseError) {
                            continue;
                        }
                    }
                }
                
                if (foundFilename) {
                    const filePath = path.join(vibeCacheDir, foundFilename);
                    fs.unlinkSync(filePath);
                    removeFromWorkspaceArray('vibeImages', foundFilename, workspaceId);
                    deletedVibes.push(vibeId);
                }
            }
            
            // Delete specific encodings
            for (const encodingData of encodingsToDelete) {
                let foundFilename = null;
                
                // Find the filename that contains this vibe ID
                for (const filename of vibeFiles) {
                    const filePath = path.join(vibeCacheDir, filename);
                    if (fs.existsSync(filePath)) {
                        try {
                            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            if (vibeData.id === encodingData.vibeId) {
                                foundFilename = filename;
                                break;
                            }
                        } catch (parseError) {
                            continue;
                        }
                    }
                }
                
                if (foundFilename) {
                    const filePath = path.join(vibeCacheDir, foundFilename);
                    const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    
                    // Remove specified encoding
                    if (vibeData.encodings) {
                        vibeData.encodings = vibeData.encodings.filter(encoding =>
                            !(encoding.model === encodingData.model && 
                              encoding.informationExtraction === encodingData.informationExtraction)
                        );
                    }
                    
                    // Write updated data back
                    fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                    deletedEncodings.push(encodingData);
                }
            }
            
            this.sendToClient(ws, {
                type: 'bulk_delete_vibe_images_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Bulk delete completed successfully',
                    deletedVibes: deletedVibes.length,
                    deletedEncodings: deletedEncodings.length
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Bulk delete vibe images error:', error);
            this.sendError(ws, 'Failed to bulk delete vibe images', error.message, message.requestId);
        }
    }

    async handleMoveVibeImage(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, targetWorkspaceId, sourceWorkspaceId } = message;
            
            const sourceWorkspace = getWorkspace(sourceWorkspaceId);
            const targetWorkspace = getWorkspace(targetWorkspaceId);
            
            if (!sourceWorkspace || !targetWorkspace) {
                this.sendError(ws, 'Workspace not found', 'Source or target workspace not found', message.requestId);
                return;
            }
            
            const vibeFiles = sourceWorkspace.vibeImages || [];
            let foundFilename = null;
            
            // Find the filename that contains this vibe ID
            for (const filename of vibeFiles) {
                const filePath = path.join(vibeCacheDir, filename);
                if (fs.existsSync(filePath)) {
                    try {
                        const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (vibeData.id === vibeId) {
                            foundFilename = filename;
                            break;
                        }
                    } catch (parseError) {
                        continue;
                    }
                }
            }
            
            if (!foundFilename) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found', message.requestId);
                return;
            }
            
            // Move from source to target workspace
            removeFromWorkspaceArray('vibeImages', foundFilename, sourceWorkspaceId);
            addToWorkspaceArray('vibeImages', foundFilename, targetWorkspaceId);
            
            this.sendToClient(ws, {
                type: 'move_vibe_image_response',
                requestId: message.requestId,
                data: { success: true, message: 'Vibe image moved successfully' },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Move vibe image error:', error);
            this.sendError(ws, 'Failed to move vibe image', error.message, message.requestId);
        }
    }

    async handleBulkMoveVibeImages(ws, message, clientInfo, wsServer) {
        try {
            const { imageIds, targetWorkspaceId, sourceWorkspaceId } = message;
            
            const sourceWorkspace = getWorkspace(sourceWorkspaceId);
            const targetWorkspace = getWorkspace(targetWorkspaceId);
            
            if (!sourceWorkspace || !targetWorkspace) {
                this.sendError(ws, 'Workspace not found', 'Source or target workspace not found', message.requestId);
                return;
            }
            
            const vibeFiles = sourceWorkspace.vibeImages || [];
            const movedImages = [];
            
            // Move each vibe image
            for (const vibeId of imageIds) {
                let foundFilename = null;
                
                // Find the filename that contains this vibe ID
                for (const filename of vibeFiles) {
                    const filePath = path.join(vibeCacheDir, filename);
                    if (fs.existsSync(filePath)) {
                        try {
                            const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            if (vibeData.id === vibeId) {
                                foundFilename = filename;
                                break;
                            }
                        } catch (parseError) {
                            continue;
                        }
                    }
                }
                
                if (foundFilename) {
                    removeFromWorkspaceArray('vibeImages', foundFilename, sourceWorkspaceId);
                    addToWorkspaceArray('vibeImages', foundFilename, targetWorkspaceId);
                    movedImages.push(vibeId);
                }
            }
            
            this.sendToClient(ws, {
                type: 'bulk_move_vibe_images_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: `${movedImages.length} vibe image(s) moved successfully`,
                    movedCount: movedImages.length
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Bulk move vibe images error:', error);
            this.sendError(ws, 'Failed to bulk move vibe images', error.message, message.requestId);
        }
    }

    async handleEncodeVibe(ws, message, clientInfo, wsServer) {
        try {
            const { image, informationExtraction, model, workspace, cacheFile, tempFile, id, comment } = message;
            
            // Determine which workspace to use
            let targetWorkspace = workspace;
            if (!targetWorkspace) {
                // No specific workspace provided, use the active workspace for this session
                targetWorkspace = getActiveWorkspace(clientInfo.sessionId);
            }
            
            // Validate that the workspace exists
            const workspaces = getWorkspaces();
            if (!workspaces[targetWorkspace]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${targetWorkspace}' not found`, message.requestId);
                return;
            }
            
            let vibeData;
            
            if (image) {
                // Create new vibe from uploaded image
                const imageBuffer = Buffer.from(image, 'base64');
                const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
                
                vibeData = {
                    version: 1,
                    id: sha256Hash,
                    type: 'base64',
                    image: image,
                    preview: imageHash,
                    mtime: Date.now(),
                    encodings: {},
                    comment: comment || null
                };
                
                // Generate preview for base64 image
                const previewPath = path.join(previewCacheDir, `${imageHash}.webp`);
                if (!fs.existsSync(previewPath)) {
                    await sharp(imageBuffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);
                    console.log(`📸 Generated preview for vibe image: ${imageHash}.webp`);
                } else {
                    console.log(`📸 Preview already exists for vibe image: ${imageHash}.webp`);
                }
                
                // Generate encoding
                const encoding = await this.encodeVibeDirect(image, informationExtraction, model);
                if (!vibeData.encodings[model]) {
                    vibeData.encodings[model] = {};
                }
                vibeData.encodings[model][informationExtraction] = encoding;
                
                // Save vibe file
                const filename = `${sha256Hash}.json`;
                const filePath = path.join(vibeCacheDir, filename);
                fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                
                // Add to workspace
                addToWorkspaceArray('vibeImages', filename, targetWorkspace);
                
            } else if (cacheFile) {
                // Create vibe from cache file
                const cachePath = path.join(uploadCacheDir, cacheFile);
                const imageBuffer = fs.readFileSync(cachePath);
                const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
                
                vibeData = {
                    version: 1,
                    id: sha256Hash,
                    type: 'cache',
                    image: cacheFile,
                    preview: imageHash,
                    mtime: Date.now(),
                    encodings: {},
                    comment: comment || null
                };
                
                // Generate preview for cache file (if not already exists)
                const previewPath = path.join(previewCacheDir, `${imageHash}.webp`);
                if (!fs.existsSync(previewPath)) {
                    await sharp(imageBuffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);
                    console.log(`📸 Generated preview for vibe image: ${imageHash}.webp`);
                }
                
                // Generate encoding from cache file
                const imageBase64 = imageBuffer.toString('base64');
                const encoding = await this.encodeVibeDirect(imageBase64, informationExtraction, model);
                if (!vibeData.encodings[model]) {
                    vibeData.encodings[model] = {};
                }
                vibeData.encodings[model][informationExtraction] = encoding;
                
                // Save vibe file
                const filename = `${sha256Hash}.json`;
                const filePath = path.join(vibeCacheDir, filename);
                fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                
                // Add to workspace
                addToWorkspaceArray('vibeImages', filename, targetWorkspace);
            } else if (tempFile) {
                // Create vibe from temp downloaded file
                const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }
                
                const imageBuffer = fs.readFileSync(tempFilePath);
                const imageBase64 = imageBuffer.toString('base64');
                const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');
                
                vibeData = {
                    version: 1,
                    id: sha256Hash,
                    type: 'base64',
                    image: imageBase64,
                    preview: imageHash,
                    mtime: Date.now(),
                    encodings: {},
                    comment: comment || null
                };
                
                // Handle preview - use existing temp preview if available, otherwise generate new one
                const previewPath = path.join(previewCacheDir, `${imageHash}.webp`);
                const tempPreviewPath = path.join(cacheDir, 'tempDownload', `${imageHash}.webp`);
                if (fs.existsSync(tempPreviewPath)) {
                    // Move temp preview to permanent preview cache
                    fs.copyFileSync(tempPreviewPath, previewPath);
                    console.log(`📸 Moved temp preview to permanent storage: ${imageHash}.webp`);
                } else if (!fs.existsSync(previewPath)) {
                    // Generate new preview if neither temp nor permanent preview exists
                    await sharp(imageBuffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);
                    console.log(`📸 Generated new preview for temp vibe image: ${imageHash}.webp`);
                } else {
                    console.log(`📸 Preview already exists for vibe image: ${imageHash}.webp`);
                }
                
                // Generate encoding from temp file
                const encoding = await this.encodeVibeDirect(imageBase64, informationExtraction, model);
                if (!vibeData.encodings[model]) {
                    vibeData.encodings[model] = {};
                }
                vibeData.encodings[model][informationExtraction] = encoding;
                
                // Save vibe file
                const filename = `${sha256Hash}.json`;
                const filePath = path.join(vibeCacheDir, filename);
                fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                
                // Add to workspace
                addToWorkspaceArray('vibeImages', filename, targetWorkspace);
            } else if (id) {
                // Add new encoding to existing vibe
                const workspaceData = getWorkspace(targetWorkspace);
                const vibeFiles = workspaceData.vibeImages || [];
                
                // Find the vibe file
                let foundFilename = null;
                for (const filename of vibeFiles) {
                    const filePath = path.join(vibeCacheDir, filename);
                    if (fs.existsSync(filePath)) {
                        try {
                            const existingVibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                            if (existingVibeData.id === id) {
                                foundFilename = filename;
                                break;
                            }
                        } catch (parseError) {
                            continue;
                        }
                    }
                }
                
                if (!foundFilename) {
                    this.sendError(ws, 'Vibe not found', 'Vibe not found', message.requestId);
                    return;
                }
                
                // Read existing vibe data
                const filePath = path.join(vibeCacheDir, foundFilename);
                vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                
                // Validate vibe for encoding
                try {
                    this.validateVibeForEncoding(vibeData, id);
                } catch (validationError) {
                    this.sendError(ws, 'Vibe validation failed', validationError.message, message.requestId);
                    return;
                }
                
                // Generate new encoding
                let imageBase64;
                if (vibeData.type === 'base64') {
                    imageBase64 = vibeData.image;
                } else if (vibeData.type === 'cache') {
                    const cachePath = path.join(uploadCacheDir, vibeData.image);
                    const imageBuffer = fs.readFileSync(cachePath);
                    imageBase64 = imageBuffer.toString('base64');
                }
                
                const encoding = await this.encodeVibeDirect(imageBase64, informationExtraction, model);
                if (!vibeData.encodings[model]) {
                    vibeData.encodings[model] = {};
                }
                vibeData.encodings[model][informationExtraction] = encoding;
                
                // Update comment if provided
                if (comment !== undefined) {
                    vibeData.comment = comment;
                }
                
                // Update file
                fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
            }
            
            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(cacheDir, 'tempDownload', `${tempFile.replace('.dat', '')}.webp`);
                    
                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }
                    
                    // Delete the temp preview if it exists
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${tempFile.replace('.dat', '')}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }
            
            this.sendToClient(ws, {
                type: 'encode_vibe_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Vibe encoding completed successfully',
                    vibeData: vibeData
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Encode vibe error:', error);
            this.sendError(ws, 'Failed to encode vibe', error.message, message.requestId);
        }
    }

    async handleCheckVibeEncoding(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, workspaceId } = message;
            
            if (!workspaceId) {
                this.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }
            
            if (!vibeId) {
                this.sendError(ws, 'Missing vibe ID', 'Vibe ID is required', message.requestId);
                return;
            }
            
            const workspaces = getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }
            
            // Find the vibe file
            const workspaceData = getWorkspace(workspaceId);
            const vibeFiles = workspaceData.vibeImages || [];
            
            let foundFilename = null;
            let vibeData = null;
            
            for (const filename of vibeFiles) {
                const filePath = path.join(vibeCacheDir, filename);
                if (fs.existsSync(filePath)) {
                    try {
                        const existingVibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                        if (existingVibeData.id === vibeId) {
                            foundFilename = filename;
                            vibeData = existingVibeData;
                            break;
                        }
                    } catch (parseError) {
                        continue;
                    }
                }
            }
            
            if (!foundFilename || !vibeData) {
                this.sendError(ws, 'Vibe not found', 'Vibe not found in workspace', message.requestId);
                return;
            }
            
            // Check if vibe can be encoded
            const encodingStatus = this.canEncodeVibe(vibeData, vibeId);
            
            this.sendToClient(ws, {
                type: 'check_vibe_encoding_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    vibeId: vibeId,
                    canEncode: encodingStatus.canEncode,
                    reason: encodingStatus.reason,
                    isLocked: this.shouldLockVibe(vibeData)
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Check vibe encoding error:', error);
            this.sendError(ws, 'Failed to check vibe encoding', error.message, message.requestId);
        }
    }

    // Helper function to determine if a vibe should be locked
    shouldLockVibe(vibe) {
        // Lock if missing original image
        if (!vibe.image) {
            return true;
        }
        
        // Lock if explicitly set to locked
        if (vibe.locked === true) {
            return true;
        }
        
        // Lock if imported from external source without original image
        if (vibe.importedFrom && !vibe.image) {
            return true;
        }
        
        return false;
    }

    // Helper function to validate vibe for encoding
    validateVibeForEncoding(vibe, vibeId) {
        // Check if vibe is locked
        if (this.shouldLockVibe(vibe)) {
            throw new Error(`Cannot encode locked vibe: ${vibeId}`);
        }
        
        // Check if vibe has valid source image
        if (!vibe.image) {
            throw new Error(`Cannot encode vibe without source image: ${vibeId}`);
        }
        
        // Check if vibe has valid image data
        if (vibe.type === 'base64' && (!vibe.image || vibe.image.trim() === '')) {
            throw new Error(`Cannot encode vibe with invalid base64 image: ${vibeId}`);
        }
        
        if (vibe.type === 'cache') {
            const cachePath = path.join(uploadCacheDir, vibe.image);
            if (!fs.existsSync(cachePath)) {
                throw new Error(`Cannot encode vibe with missing cache file: ${vibeId}`);
            }
        }
        
        return true;
    }

    // Helper function to check if a vibe can be encoded (returns object with status and reason)
    canEncodeVibe(vibe, vibeId) {
        try {
            this.validateVibeForEncoding(vibe, vibeId);
            return { canEncode: true, reason: null };
        } catch (error) {
            return { canEncode: false, reason: error.message };
        }
    }

    // Direct NovelAI vibe encoding function
    async encodeVibeDirect(imageBase64, informationExtracted, model) {
        const body = {
            image: imageBase64,
            model: Model[model.toUpperCase()],
            information_extracted: informationExtracted || 1
        };

        if (!body.model) {
            throw new Error('Invalid model');
        }
        
        return new Promise((resolve, reject) => {
            const postData = JSON.stringify(body);
            const options = {
                hostname: 'image.novelai.net',
                port: 443,
                path: '/ai/encode-vibe',
                method: 'POST',
                headers: {
                    "accept": "*/*",
                    "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
                    "authorization": `Bearer ${config.apiKey}`,
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(postData),
                    "priority": "u=1, i",
                    "dnt": "1",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"macOS\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-site",
                    "x-correlation-id": crypto.randomBytes(3).toString('hex').toUpperCase(),
                    "x-initiated-at": new Date().toISOString(),
                    "referer": "https://novelai.net/",
                    "origin": "https://novelai.net",
                    "sec-gpc": "1",
                    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
                }
            };
            
            const req = https.request(options, (res) => {
                let data = [];
                
                res.on('data', chunk => data.push(chunk));
                res.on('end', async () => {
                    // Get new balance and calculate credit usage
                    const vibeCreditUsage = await this.context.calculateCreditUsage();
                    if (vibeCreditUsage.totalUsage > 0) {
                        console.log(`💰 Vibe encoding credits used: ${vibeCreditUsage.totalUsage} ${vibeCreditUsage.usageType === 'paid' ? 'paid' : 'fixed'}`);
                    }
                    // Add unattributed receipt for vibe encoding
                    if (vibeCreditUsage.totalUsage > 0) {
                        addUnattributedReceipt({
                            type: 'vibe_encoding',
                            cost: vibeCreditUsage.totalUsage,
                            creditType: vibeCreditUsage.usageType,
                            date: Date.now().valueOf()
                        });
                    }

                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200) {
                        resolve(buffer.toString('base64'));
                    } else {
                        try {
                            const errorResponse = JSON.parse(buffer.toString());
                            reject(new Error(`Error encoding vibe: ${errorResponse.statusCode || res.statusCode} ${errorResponse.message || 'Unknown error'}`));
                        } catch (e) {
                            reject(new Error(`Error encoding vibe: HTTP ${res.statusCode}`));
                        }
                    }
                });
            });
            
            req.on('error', (error) => {
                reject(new Error(`Request error: ${error.message}`));
            });
            
            req.write(postData);
            req.end();
        });
    }

    // Helper to collect vibe image details from a list of filenames and workspaceId
    collectVibeImageDetails(filenames, workspaceId) {
        const vibeImageDetails = [];
        for (const filename of filenames) {
            const filePath = path.join(vibeCacheDir, filename);
            if (fs.existsSync(filePath)) {
                const stats = fs.statSync(filePath);
                try {
                    const vibeData = JSON.parse(fs.readFileSync(filePath, 'utf8'));
                    const previewPath = path.join(previewCacheDir, `${vibeData.preview}.webp`);
                    // Get all encodings for this file
                    const encodings = [];
                    for (const [model, modelEncodings] of Object.entries(vibeData.encodings || {})) {
                        for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                            encodings.push({
                                model,
                                informationExtraction: parseFloat(extractionValue),
                                encoding: encoding
                            });
                        }
                    }
                    vibeImageDetails.push({
                        filename,
                        id: vibeData.id,
                        preview: fs.existsSync(previewPath) ? `${vibeData.preview}.webp` : null,
                        mtime: vibeData.mtime || stats.mtime.valueOf(), // Use vibe's mtime if available, otherwise file mtime
                        size: stats.size,
                        encodings: encodings,
                        type: vibeData.type === 'base64' ? 'base64' : 'cache',
                        source: vibeData.image,
                        workspaceId: workspaceId,
                        comment: vibeData.comment || null,
                        importedFrom: vibeData.importedFrom || null,
                        originalName: vibeData.originalName || null,
                        locked: vibeData.locked || false
                    });
                } catch (parseError) {
                    console.error(`Error parsing vibe file ${filename}:`, parseError);
                    continue;
                }
            }
        }
        return vibeImageDetails;
    }

    // Favorites handlers
    async handleAddFavorite(ws, message, clientInfo, wsServer) {
        try {
            const { favoriteType, item, customName } = message;
            
            if (!favoriteType || !item) {
                this.sendError(ws, 'Missing required parameters: favoriteType and item');
                return;
            }

            // Create favorite item from the provided data
            const favoriteItem = this.favoritesManager.createFavoriteFromResult(item, customName);
            const result = this.favoritesManager.addFavorite(favoriteType, favoriteItem);
            
            if (result.success) {
                this.sendToClient(ws, {
                    type: 'favorites_add_response',
                    success: true,
                    item: result.item,
                    requestId: message.requestId
                });
            } else {
                this.sendError(ws, result.error, null, message.requestId);
            }
        } catch (error) {
            console.error('Error adding favorite:', error);
            this.sendError(ws, 'Failed to add favorite', error.message, message.requestId);
        }
    }

    async handleRemoveFavorite(ws, message, clientInfo, wsServer) {
        try {
            const { favoriteType, itemId } = message;
            
            if (!favoriteType || !itemId) {
                this.sendError(ws, 'Missing required parameters: favoriteType and itemId');
                return;
            }

            const result = this.favoritesManager.removeFavorite(favoriteType, itemId);
            
            if (result.success) {
                this.sendToClient(ws, {
                    type: 'favorites_remove_response',
                    success: true,
                    requestId: message.requestId
                });
            } else {
                this.sendError(ws, result.error, null, message.requestId);
            }
        } catch (error) {
            console.error('Error removing favorite:', error);
            this.sendError(ws, 'Failed to remove favorite', error.message, message.requestId);
        }
    }

    async handleGetFavorites(ws, message, clientInfo, wsServer) {
        try {
            const { favoriteType } = message;
            const favorites = this.favoritesManager.getFavorites(favoriteType);
            
            this.sendToClient(ws, {
                type: 'favorites_get_response',
                favorites: favorites,
                requestId: message.requestId
            });
        } catch (error) {
            console.error('Error getting favorites:', error);
            this.sendError(ws, 'Failed to get favorites', error.message, message.requestId);
        }
    }

    // Text replacement management handlers
    async handleGetTextReplacements(ws, message, clientInfo, wsServer) {
        try {
            const { page = 1, itemsPerPage = 10, searchTerm = '' } = message;
            
            const config = loadPromptConfig();
            const allTextReplacements = config.text_replacements || {};
            
            // Filter by search term if provided
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
            
            // Sort keys alphabetically (case insensitive)
            const sortedKeys = Object.keys(filteredReplacements).sort((a, b) => 
                a.toLowerCase().localeCompare(b.toLowerCase())
            );
            
            // Calculate pagination
            const totalItems = sortedKeys.length;
            const totalPages = Math.max(1, Math.ceil(totalItems / itemsPerPage));
            const currentPage = Math.min(Math.max(1, page), totalPages);
            const startIndex = (currentPage - 1) * itemsPerPage;
            const endIndex = startIndex + itemsPerPage;
            
            // Get items for current page
            const pageKeys = sortedKeys.slice(startIndex, endIndex);
            const pageItems = {};
            pageKeys.forEach(key => {
                pageItems[key] = filteredReplacements[key];
            });
            
            this.sendToClient(ws, {
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
            this.sendError(ws, 'Failed to get text replacements', error.message, message.requestId);
        }
    }

    async handleSaveTextReplacements(ws, message, clientInfo, wsServer) {
        try {
            const { textReplacements } = message;
            
            if (!textReplacements || typeof textReplacements !== 'object') {
                this.sendError(ws, 'Invalid text replacements data', null, message.requestId);
                return;
            }

            // Load current config
            const config = loadPromptConfig();
            
            // Initialize text_replacements if it doesn't exist
            if (!config.text_replacements) {
                config.text_replacements = {};
            }
            
            // Merge new text replacements with existing ones
            // This allows both single item saves and bulk saves
            Object.assign(config.text_replacements, textReplacements);
            
            // Save config
            const success = savePromptConfig(config);
            
            if (success) {
                this.sendToClient(ws, {
                    type: 'save_text_replacements_response',
                    data: {
                        success: true
                    },
                    requestId: message.requestId
                });
                
                // Log what was saved
                const savedKeys = Object.keys(textReplacements);
                if (savedKeys.length === 1) {
                    console.log(`✅ Text replacement "${savedKeys[0]}" saved successfully`);
                } else {
                    console.log(`✅ ${savedKeys.length} text replacements saved successfully`);
                }
            } else {
                this.sendToClient(ws, {
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
            this.sendToClient(ws, {
                type: 'save_text_replacements_response',
                data: {
                    success: false,
                    error: error.message
                },
                requestId: message.requestId
            });
        }
    }

    async handleDeleteTextReplacement(ws, message, clientInfo, wsServer) {
        try {
            const { key } = message;
            
            if (!key || typeof key !== 'string') {
                this.sendError(ws, 'Invalid key', 'Text replacement key is required', message.requestId);
                return;
            }

            // Load current config
            const config = loadPromptConfig();
            
            // Check if text_replacements exists and contains the key
            if (!config.text_replacements || !config.text_replacements.hasOwnProperty(key)) {
                this.sendError(ws, 'Key not found', `Text replacement "${key}" not found`, message.requestId);
                return;
            }
            
            // Delete the text replacement
            delete config.text_replacements[key];
            
            // Save config
            const success = savePromptConfig(config);
            
            if (success) {
                this.sendToClient(ws, {
                    type: 'delete_text_replacement_response',
                    data: {
                        success: true,
                        deletedKey: key
                    },
                    requestId: message.requestId
                });
                
                console.log(`🗑️ Text replacement "${key}" deleted successfully`);
            } else {
                this.sendToClient(ws, {
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
            this.sendToClient(ws, {
                type: 'delete_text_replacement_response',
                data: {
                    success: false,
                    error: error.message
                },
                requestId: message.requestId
            });
        }
    }

    async handleCreateTextReplacement(ws, message, clientInfo, wsServer) {
        try {
            const { key, value, type } = message;
            
            if (!key || typeof key !== 'string' || key.trim() === '') {
                this.sendError(ws, 'Invalid key', 'Text replacement key is required and cannot be empty', message.requestId);
                return;
            }
            
            if (value === undefined || value === null) {
                this.sendError(ws, 'Invalid value', 'Text replacement value is required', message.requestId);
                return;
            }
            
            if (!type || !['string', 'array'].includes(type)) {
                this.sendError(ws, 'Invalid type', 'Type must be either "string" or "array"', message.requestId);
                return;
            }

            // Load current config
            const config = loadPromptConfig();
            
            // Initialize text_replacements if it doesn't exist
            if (!config.text_replacements) {
                config.text_replacements = {};
            }
            
            // Check if key already exists
            if (config.text_replacements.hasOwnProperty(key)) {
                this.sendError(ws, 'Key already exists', `Text replacement "${key}" already exists`, message.requestId);
                return;
            }
            
            // Create the text replacement
            if (type === 'array') {
                config.text_replacements[key] = Array.isArray(value) ? value : [value];
            } else {
                config.text_replacements[key] = value;
            }
            
            // Save config
            const success = savePromptConfig(config);
            
            if (success) {
                this.sendToClient(ws, {
                    type: 'create_text_replacement_response',
                    data: {
                        success: true,
                        key: key,
                        value: config.text_replacements[key],
                        type: type
                    },
                    requestId: message.requestId
                });
                
                console.log(`✅ Text replacement "${key}" created successfully`);
            } else {
                this.sendToClient(ws, {
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
            this.sendToClient(ws, {
                type: 'create_text_replacement_response',
                data: {
                    success: false,
                    error: error.message
                },
                requestId: message.requestId
            });
        }
    }

    async handleImportVibeBundle(ws, message, clientInfo, wsServer) {
        try {
            const { bundleData, workspaceId, comment, tempFile } = message;
            
            // Determine which workspace to use
            let targetWorkspace = workspaceId;
            if (!targetWorkspace) {
                // No specific workspace provided, use the active workspace for this session
                targetWorkspace = getActiveWorkspace(clientInfo.sessionId);
            }
            if (!targetWorkspace) {
                this.sendError(ws, 'Invalid workspace', 'No workspace provided, and no active workspace found', message.requestId);
                return;
            }
            
            // Validate that the workspace exists
            const workspaces = getWorkspaces();
            if (!workspaces[targetWorkspace]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${targetWorkspace}' not found`, message.requestId);
                return;
            }
            
            let bundleDataToProcess = bundleData;
            
            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }
                
                try {
                    const fileContent = fs.readFileSync(tempFilePath, 'utf8');
                    bundleDataToProcess = JSON.parse(fileContent);
                    console.log(`📥 Using downloaded temp file: ${tempFile}`);
                } catch (parseError) {
                    this.sendError(ws, 'Invalid JSON file', 'Downloaded file is not valid JSON', message.requestId);
                    return;
                }
            }
            
            if (!bundleDataToProcess || !bundleDataToProcess.identifier) {
                this.sendError(ws, 'Invalid bundle format', 'Not a valid NovelAI vibe transfer or bundle file', message.requestId);
                return;
            }

            // Handle both bundle format and single vibe format
            let vibes = [];
            if (bundleData.identifier === 'novelai-vibe-transfer-bundle') {
                if (!bundleData.vibes || !Array.isArray(bundleData.vibes)) {
                    this.sendError(ws, 'Invalid bundle format', 'Bundle does not contain valid vibes array', message.requestId);
                    return;
                }
                vibes = bundleData.vibes;
            } else if (bundleData.identifier === 'novelai-vibe-transfer') {
                // Single vibe format
                vibes = [bundleData];
            } else {
                this.sendError(ws, 'Invalid bundle format', 'Not a valid NovelAI vibe transfer or bundle file', message.requestId);
                return;
            }

            if (vibes.length === 0) {
                this.sendError(ws, 'Empty bundle', 'No vibes found in bundle', message.requestId);
                return;
            }

            // Process each vibe
            const importedVibes = [];
            const errors = [];
            for (const vibe of vibes) {
                try {
                    // Validate structure (allow missing image/thumbnail, but mark as locked)
                    if (!vibe.identifier || vibe.identifier !== 'novelai-vibe-transfer') {
                        console.warn(`Skipping invalid vibe: ${vibe.name || 'unnamed'}`);
                        continue;
                    }

                    // Generate ID if it's 'unknown'
                    let vibeId = vibe.id;
                    if (vibeId === 'unknown') {
                        // Create a hash based on the vibe's content
                        const hashData = {
                            name: vibe.name || '',
                            encodings: vibe.encodings || {},
                            importInfo: vibe.importInfo || {},
                            createdAt: vibe.createdAt || Date.now()
                        };
                        const hashString = JSON.stringify(hashData);
                        vibeId = crypto.createHash('sha256').update(hashString).digest('hex');
                        console.log(`Generated SHA256 ID for unknown vibe: ${vibeId}`);
                    }

                    // Map model names
                    const modelMapping = {
                        'v4full': 'v4',
                        'v4-5full': 'v4_5',
                        'v4curated': 'v4_cur',
                        'v4-5curated': 'v4_5_cur'
                    };
                    // Process encodings for each model
                    const processedEncodings = {};
                    
                    for (const [bundleModel, encodings] of Object.entries(vibe.encodings || {})) {
                        const mappedModel = modelMapping[bundleModel] || bundleModel;                        
                        if (!processedEncodings[mappedModel]) {
                            processedEncodings[mappedModel] = {};
                        }
                        
                        for (const [encodingId, encodingData] of Object.entries(encodings)) {                            
                            if (encodingId !== 'unknown') {
                                const informationExtraction = encodingData.params?.information_extracted || 1;
                                if (encodingData.encoding && encodingData.encoding.trim() !== '') {
                                    processedEncodings[mappedModel][informationExtraction] = encodingData.encoding;
                                    console.log(`Normal encoding: IE=${informationExtraction}, encoding length=${encodingData.encoding?.length || 0}`);
                                } else {
                                    console.warn(`Warning: Empty encoding found for ${mappedModel} with IE=${informationExtraction}`);
                                }
                            } else {
                                // For 'unknown' encodingId, use importInfo.information_extracted if params.information_extracted is not valid
                                let ie = 1;
                                if (encodingData.params && encodingData.params.information_extracted && typeof encodingData.params.information_extracted === 'number' && encodingData.params.information_extracted > 0) {
                                    ie = encodingData.params.information_extracted;
                                } else if (vibe.importInfo && vibe.importInfo.information_extracted) {
                                    ie = vibe.importInfo.information_extracted;
                                }
                                if (encodingData.encoding && encodingData.encoding.trim() !== '') {
                                    processedEncodings[mappedModel][ie] = encodingData.encoding;
                                    console.log(`Unknown encoding: IE=${ie}, encoding length=${encodingData.encoding?.length || 0}`);
                                } else {
                                    console.warn(`Warning: Empty encoding found for ${mappedModel} with IE=${ie}`);
                                }
                            }
                        }
                    }
                                        
                    // Create vibe data structure
                    const vibeData = {
                        version: vibe.version || 1,
                        id: vibeId,
                        type: 'base64',
                        image: vibe.image || null, // Keep original image if present, null if missing
                        preview: vibe.thumbnail ? vibe.thumbnail.split(',')[1] : null,
                        mtime: vibe.createdAt || Date.now(),
                        encodings: processedEncodings,
                        importedFrom: 'novelai',
                        originalName: vibe.name || null,
                        comment: comment || null,
                        locked: false // Will be determined by server-side logic
                    };
                    
                    // Determine locked status using server-side logic
                    vibeData.locked = this.shouldLockVibe(vibeData);
                    // Save vibe file
                    const filename = `${vibeId}.json`;
                    const filePath = path.join(vibeCacheDir, filename);
                    fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                    
                    // Add to workspace
                    addToWorkspaceArray('vibeImages', filename, targetWorkspace);

                    // Save thumbnail if provided
                    if (vibe.thumbnail && vibe.thumbnail.startsWith('data:image/')) {
                        const thumbnailBase64 = vibe.thumbnail.split(',')[1];
                        const thumbnailBuffer = Buffer.from(thumbnailBase64, 'base64');
                        const thumbnailHash = crypto.createHash('md5').update(thumbnailBuffer).digest('hex');
                        const thumbnailPath = path.join(previewCacheDir, `${thumbnailHash}.webp`);
                        if (!fs.existsSync(thumbnailPath)) {
                            await sharp(thumbnailBuffer)
                                .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                                .webp({ quality: 80 })
                                .toFile(thumbnailPath);
                        }
                        // Update vibe data with thumbnail hash
                        vibeData.preview = thumbnailHash;
                        fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
                    }
                    importedVibes.push({
                        id: vibeId,
                        name: vibe.name || 'Imported Vibe',
                        modelCount: Object.keys(processedEncodings).length,
                        locked: vibeData.locked,
                        createdAt: vibe.createdAt || Date.now()
                    });
                    console.log(`✅ Imported vibe: ${vibe.name || vibeId}${vibeData.locked ? ' (locked)' : ''}`);
                } catch (error) {
                    console.error(`❌ Error importing vibe ${vibe.name || vibe.id}:`, error);
                    errors.push(`${vibe.name || vibe.id}: ${error.message}`);
                }
            }
            
            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(cacheDir, 'tempDownload', `${tempFile.replace('.dat', '')}.webp`);
                    
                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }
                    
                    // Delete the temp preview if it exists
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${tempFile.replace('.dat', '')}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }
            
            this.sendToClient(ws, {
                type: 'import_vibe_bundle_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `Successfully imported ${importedVibes.length} vibes`,
                    importedVibes: importedVibes,
                    errors: errors
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Import vibe bundle error:', error);
            this.sendError(ws, 'Failed to import vibe bundle', error.message, message.requestId);
        }
    }

    async handleUploadWorkspaceImage(ws, message, clientInfo, wsServer) {
        try {
            const { imageData, workspaceId, originalFilename, batchInfo, tempFile } = message;
            
            // Validate workspace parameter
            if (!workspaceId) {
                this.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }
            
            // Validate that the workspace exists
            const workspaces = getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }
            
            let imageBuffer, hash;
            
            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }
                
                imageBuffer = fs.readFileSync(tempFilePath);
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                
                console.log(`📥 Using downloaded temp file: ${tempFile} -> ${hash}`);
            } else if (imageData) {
                // Handle base64 image data
                imageBuffer = Buffer.from(imageData, 'base64');
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
            } else {
                this.sendError(ws, 'Missing image data', 'Either imageData or tempFile must be provided', message.requestId);
                return;
            }
            
            // Generate filename - use original if provided, otherwise generate from hash
            let filename;
            if (originalFilename) {
                // Use original filename, but ensure it has proper extension
                const originalExt = path.extname(originalFilename).toLowerCase();
                if (originalExt === '.png') {
                    // Keep original filename with original case
                    filename = hash + '_' + originalFilename;
                } else {
                    // If original doesn't have valid extension, add one based on image format
                    const tempImg = sharp(imageBuffer);
                    const metadata = await tempImg.metadata();
                    const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format || 'png';
                    const baseName = path.basename(originalFilename, path.extname(originalFilename));
                    filename = `${hash}_${baseName}.${ext}`;
                }
            } else {
                // Generate filename from hash with proper extension
                const tempImg = sharp(imageBuffer);
                const metadata = await tempImg.metadata();
                const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format || 'png';
                filename = `${hash}.${ext}`;
            }
            
            // For downloaded files, we need to handle the .dat extension
            if (filename.toLowerCase().endsWith('.dat')) {
                // Convert .dat to .png for downloaded files
                filename = filename.replace(/\.dat$/i, '.png');
            }
            
            if (!filename.toLowerCase().endsWith('.png')) {
                throw new Error('Invalid image format: Only PNG files are allowed');
            }
            
            // Handle filename conflicts by appending a counter if needed
            let finalFilename = filename;
            let finalFilePath = path.join(imagesDir, finalFilename);
            let counter = 1;
            
            while (fs.existsSync(finalFilePath)) {
                const ext = path.extname(filename);
                const baseName = path.basename(filename, ext);
                finalFilename = `${baseName}_${counter}${ext}`;
                finalFilePath = path.join(imagesDir, finalFilename);
                counter++;
            }
            
            // Save file to images directory
            fs.writeFileSync(finalFilePath, imageBuffer);
            
            // Handle preview - use existing temp preview if available, otherwise generate new one
            const previewPath = path.join(previewsDir, `${filename.split('.').slice(0, -1).join('.')}.jpg`);
            let generatePreview = true;
            if (tempFile) {
                // Check if temp preview exists from download process
                const tempPreviewPath = path.join(cacheDir, 'tempDownload', `${hash}.webp`);
                if (fs.existsSync(tempPreviewPath)) {
                    // Convert temp WebP preview to permanent JPG preview
                    await sharp(tempPreviewPath)
                        .jpeg({ quality: 70 })
                        .toFile(previewPath);
                    console.log(`📸 Moved temp preview to permanent storage: ${hash}`);
                    generatePreview = false;
                }
            }
            if (generatePreview) {
                // Generate new preview for non-downloaded files
                await sharp(imageBuffer)
                    .resize(256, 256, { fit: 'cover' })
                    .jpeg({ quality: 70 })
                    .toFile(previewPath);
                console.log(`📸 Generated preview: ${hash}`);
            }
            
            // Generate blurred background preview
            const blurPreviewPath = path.join(previewsDir, `${filename.split('.').slice(0, -1).join('.')}_blur.jpg`);
            await sharp(imageBuffer)
                .resize(128, 128, { fit: 'cover' })
                .blur(20) // Heavy blur effect
                .jpeg({ quality: 60 })
                .toFile(blurPreviewPath);
            console.log(`📸 Generated blurred preview: ${hash}`);
            
            // Add to workspace files
            addToWorkspaceArray('files', finalFilename, workspaceId);
            
            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(cacheDir, 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(cacheDir, 'tempDownload', `${hash}.webp`);
                    
                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }
                    
                    // Delete the temp preview
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${hash}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }
            
            // Check if this is the last image in a batch and trigger metadata rescan
            const isLastInBatch = batchInfo && (batchInfo.currentIndex === batchInfo.totalCount - 1);
            if (isLastInBatch) {
                // Trigger metadata cache rescan asynchronously
                setImmediate(async () => {
                    try {
                        await scanAndUpdateMetadata(imagesDir);
                        console.log('✅ Metadata cache rescan completed');
                    } catch (error) {
                        console.error('❌ Metadata cache rescan failed:', error);
                    }
                });
            }
            
            // Broadcast gallery update
            const galleryData = await this.buildGalleryData('images', clientInfo);
            wsServer.broadcastGalleryUpdate(galleryData, 'images');
            
            this.sendToClient(ws, {
                type: 'upload_workspace_image_response',
                requestId: message.requestId,
                data: { 
                    success: true, 
                    message: 'Image uploaded successfully',
                    filename: finalFilename,
                    hash: hash,
                    originalFilename: originalFilename,
                    batchInfo: batchInfo
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('Upload workspace image error:', error);
            this.sendError(ws, 'Failed to upload image', error.message, message.requestId);
        }
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

    async handleUrlUploadMetadataRequest(ws, message, clientInfo, wsServer) {
        const { filename } = message;
        
        if (!filename) {
            this.sendError(ws, 'Missing filename parameter', 'request_url_upload_metadata');
            return;
        }
        
        try {
            // Get the tempdownload directory path
            const tempDownloadDir = path.join(cacheDir, 'tempdownload');
            const filePath = path.join(tempDownloadDir, filename);
            
            if (!fs.existsSync(filePath)) {
                this.sendError(ws, 'File not found in tempdownload folder', 'request_url_upload_metadata', message.requestId);
                return;
            }
            
            // Extract metadata from the file directly (skip cache, don't save to cache)
            const imageMetadata = await extractImageMetadata(filePath);
            if (!imageMetadata) {
                this.sendError(ws, 'Failed to extract image metadata', 'request_url_upload_metadata', message.requestId);
                return;
            }
            
            // Extract PNG embedded metadata
            const pngMetadata = extractNovelAIMetadata(filePath);
            if (!pngMetadata) {
                this.sendError(ws, 'No NovelAI metadata found', 'request_url_upload_metadata', message.requestId);
                return;
            }
            
            // Return the raw metadata like handleImageMetadataRequest does
            // Don't transform it with extractRelevantFields - let the frontend handle that
            const result = {
                filename: filename,
                width: imageMetadata.width,
                height: imageMetadata.height,
                metadata: pngMetadata
            };
            
            // Send response
            this.sendToClient(ws, {
                type: 'request_url_upload_metadata_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('URL upload metadata request error:', error);
            this.sendError(ws, 'Failed to load URL upload metadata', error.message, message.requestId);
        }
    }

    // Handle file search requests
    async handleFileSearch(ws, message, clientInfo, wsServer) {
        try {
            const { query, viewType = 'images', action = 'search' } = message;
            
            if (action === 'start') {
                // Initialize search cache for the session
                await this.initializeSearchCache(clientInfo.sessionId, viewType);
                wsServer.sendToClient(ws, {
                    type: 'search_files_response',
                    data: {
                        status: 'cache_ready',
                        viewType: viewType,
                        timestamp: new Date().toISOString()
                    },
                    requestId: message.requestId
                });
                return;
            }
            
            if (action === 'stop') {
                // Clean up search cache for the session
                this.cleanupSearchCache(clientInfo.sessionId);
                wsServer.sendToClient(ws, {
                    type: 'search_files_response',
                    data: {
                        status: 'cache_cleared',
                        timestamp: new Date().toISOString()
                    },
                    requestId: message.requestId
                });
                return;
            }
            
            if (action === 'suggestions') {
                // Get tag suggestions without performing full search
                const contextTags = message.contextTags || [];
                
                let tagSuggestions;
                if (contextTags.length > 0) {
                    // For context-aware suggestions, get tags only from files that match the context
                    tagSuggestions = this.getContextAwareSuggestions(query || '', 20, contextTags);
                } else {
                    // For regular suggestions, use the normal method
                    tagSuggestions = this.getTagSuggestions(query || '', 20);
                }
                                
                wsServer.sendToClient(ws, {
                    type: 'search_files_response',
                    data: {
                        status: 'suggestions',
                        query: query || '',
                        viewType: viewType,
                        tagSuggestions: tagSuggestions,
                        timestamp: new Date().toISOString()
                    },
                    requestId: message.requestId
                });
                return;
            }
            
            if (!query || query.trim() === '') {
                this.sendError(ws, 'Missing query parameter', 'search_files');
                return;
            }
            
            // File search request received
            
            // Perform the tag-based search using cached data
            const searchResults = await this.searchFilesByTags(query, viewType, clientInfo.sessionId);
            
            // Search complete
            
            // Send search results (only one response)
            wsServer.sendToClient(ws, {
                type: 'search_files_response',
                data: {
                    status: 'complete',
                    query: query,
                    viewType: viewType,
                    results: searchResults.results,
                    count: searchResults.results.length,
                    tagSuggestions: searchResults.tagSuggestions,
                    timestamp: new Date().toISOString()
                },
                requestId: message.requestId
            });
            
        } catch (error) {
            console.error('File search error:', error);
            this.sendError(ws, 'Search failed', error.message, message.requestId);
        }
    }
    
    // Search cache storage
    searchCache = new Map();
    
    // Initialize search cache for a session
    async initializeSearchCache(sessionId, viewType) {
        try {
            // Initialize search cache for this session and view
            
            // Get the active workspace for this session
            const { getActiveWorkspace, getWorkspace } = require('./workspace');
            const activeWorkspaceId = getActiveWorkspace(sessionId);
            const activeWorkspace = getWorkspace(activeWorkspaceId);
            
            if (!activeWorkspace) {
                throw new Error(`Active workspace not found for session ${sessionId}`);
            }
            
            // Get all metadata from cache
            const allMetadata = getImagesMetadata();
            if (!allMetadata || Object.keys(allMetadata).length === 0) {
                console.log('⚠️ No metadata available for search');
                return;
            }
            
            // Get files for the current view type from the active workspace
            let workspaceFiles = [];
            switch (viewType) {
                case 'scraps':
                    workspaceFiles = activeWorkspace.scraps || [];
                    break;
                case 'pinned':
                    workspaceFiles = activeWorkspace.pinned || [];
                    break;
                case 'upscaled':
                    // For upscaled, get all files and filter by upscaled status
                    workspaceFiles = Object.keys(allMetadata).filter(filename => {
                        const metadata = allMetadata[filename];
                        return metadata && metadata.upscaled;
                    });
                    break;
                default: // 'images'
                    workspaceFiles = activeWorkspace.files || [];
                    break;
            }
            
            // Filter metadata to only include files from the current workspace view
            const filteredMetadata = {};
            workspaceFiles.forEach(filename => {
                if (allMetadata[filename]) {
                    filteredMetadata[filename] = allMetadata[filename];
                }
            });
            
            // Build tag index from the filtered metadata
            this.buildTagIndex(filteredMetadata);
            
            // Store in cache
            this.searchCache.set(sessionId, {
                viewType,
                metadata: filteredMetadata,
                files: workspaceFiles,
                timestamp: Date.now(),
                workspaceId: activeWorkspaceId
            });
            
            console.log(`✅ Search cache initialized for session ${sessionId}: ${Object.keys(filteredMetadata).length} files, view: ${viewType}, ${this.tagIndex.size} tags indexed`);
            
        } catch (error) {
            console.error('❌ Error initializing search cache:', error);
            throw error;
        }
    }
    
    // Clean up search cache for a session
    cleanupSearchCache(sessionId) {
        if (this.searchCache.has(sessionId)) {
            const cacheInfo = this.searchCache.get(sessionId);
            console.log(`🧹 Cleaning up search cache for session ${sessionId}: ${Object.keys(cacheInfo.metadata).length} files`);
            this.searchCache.delete(sessionId);
        }
    }
    
    // Perform the actual file search using cached data
    async performFileSearch(query, viewType, sessionId) {
        const searchTerm = query.toLowerCase().trim();
        const results = [];
        
        try {
            // Get cached data for this session
            const cacheData = this.searchCache.get(sessionId);
            if (!cacheData) {
                throw new Error('Search cache not initialized. Call search_files with action="start" first.');
            }
            
            if (cacheData.viewType !== viewType) {
                throw new Error(`View type mismatch. Cache initialized for ${cacheData.viewType}, but searching in ${viewType}`);
            }
            
            const filteredMetadata = cacheData.metadata;
            const imageFiles = Object.keys(filteredMetadata);
            
            // Searching cached data
            
            // Search through each file's metadata
            for (const filename of imageFiles) {
                const metadata = filteredMetadata[filename];
                if (!metadata) continue;
                
                let matchScore = 0;
                let matchDetails = [];
                
                // Search in PNG metadata (prompts, character prompts, etc.)
                if (metadata.metadata) {
                    const pngMeta = metadata.metadata;
                    
                    // Search in main prompt
                    if (pngMeta.prompt && pngMeta.prompt.toLowerCase().includes(searchTerm)) {
                        matchScore += 10;
                        matchDetails.push({
                            field: 'prompt',
                            value: pngMeta.prompt,
                            highlight: this.highlightSearchTerm(pngMeta.prompt, searchTerm)
                        });
                    }
                    
                    // Search in character prompts from forge_data
                    if (pngMeta.forge_data) {
                        const forgeData = pngMeta.forge_data;
                        
                        // Search in allCharacters (enabled characters)
                        if (forgeData.allCharacters && Array.isArray(forgeData.allCharacters)) {
                            for (const charPrompt of forgeData.allCharacters) {
                                if (charPrompt.chara_name && charPrompt.chara_name.toLowerCase().includes(searchTerm)) {
                                    matchScore += 15;
                                    matchDetails.push({
                                        field: 'character_name',
                                        value: charPrompt.chara_name,
                                        highlight: this.highlightSearchTerm(charPrompt.chara_name, searchTerm)
                                    });
                                }
                            }
                        }
                        
                        // Search in disabledCharacters
                        if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
                            for (const charPrompt of forgeData.disabledCharacters) {
                                if (charPrompt.prompt && charPrompt.prompt.toLowerCase().includes(searchTerm)) {
                                    matchScore += 12;
                                    matchDetails.push({
                                        field: 'character_prompt',
                                        value: charPrompt.prompt,
                                        highlight: this.highlightSearchTerm(charPrompt.prompt, searchTerm),
                                        character: charPrompt.chara_name || 'Unnamed'
                                    });
                                }
                                
                                if (charPrompt.chara_name && charPrompt.chara_name.toLowerCase().includes(searchTerm)) {
                                    matchScore += 15;
                                    matchDetails.push({
                                        field: 'character_name',
                                        value: charPrompt.chara_name,
                                        highlight: this.highlightSearchTerm(charPrompt.chara_name, searchTerm)
                                    });
                                }
                            }
                        }
                        
                        // Search in characterNames array
                        if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
                            for (const charName of forgeData.characterNames) {
                                if (charName && charName.toLowerCase().includes(searchTerm)) {
                                    matchScore += 15;
                                    matchDetails.push({
                                        field: 'character_name',
                                        value: charName,
                                        highlight: this.highlightSearchTerm(charName, searchTerm)
                                    });
                                }
                            }
                        }
                    }
                    
                    // Search in v4_prompt character captions (fully compiled values)
                    if (pngMeta.v4_prompt && pngMeta.v4_prompt.caption && pngMeta.v4_prompt.caption.char_captions) {
                        const charCaptions = pngMeta.v4_prompt.caption.char_captions;
                        
                        for (const caption of charCaptions) {
                            if (caption.char_caption && caption.char_caption.toLowerCase().includes(searchTerm)) {
                                matchScore += 14; // Higher score for compiled prompts
                                matchDetails.push({
                                    field: 'v4_character_caption',
                                    value: caption.char_caption,
                                    highlight: this.highlightSearchTerm(caption.char_caption, searchTerm),
                                    character: 'v4_character',
                                    center: caption.centers ? caption.centers[0] : null
                                });
                            }
                        }
                    }
                    
                    // Search in preset name
                    if (pngMeta.preset_name && pngMeta.preset_name.toLowerCase().includes(searchTerm)) {
                        matchScore += 7;
                        matchDetails.push({
                            field: 'preset',
                            value: pngMeta.preset_name,
                            highlight: this.highlightSearchTerm(pngMeta.preset_name, searchTerm)
                        });
                    }
                }
                
                // If we found matches, add to results
                if (matchScore > 0) {
                    results.push({
                        filename: filename,
                        matchScore: matchScore,
                        matchDetails: matchDetails,
                        metadata: {
                            width: metadata.width,
                            height: metadata.height,
                            upscaled: metadata.upscaled,
                            size: metadata.size,
                            mtime: metadata.mtime
                        }
                    });
                }
            }
            
            // Sort results by match score (highest first)
            results.sort((a, b) => b.matchScore - a.matchScore);
            
            return results;
            
        } catch (error) {
            console.error('Error performing file search:', error);
            throw error;
        }
    }
    
    // Helper method to highlight search terms in text
    highlightSearchTerm(text, searchTerm) {
        if (!text || !searchTerm) return text;
        
        const regex = new RegExp(`(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')})`, 'gi');
        return text.replace(regex, '<span class="search-highlight">$1</span>');
    }

    // Search cache storage
    searchCache = new Map();
    
    // Tag index for fast tag-based searching
    tagIndex = new Map();
    
    // Extract tags from text with their weights
    extractTagsFromText(text) {
        if (!text || typeof text !== 'string') return [];
        
        const tags = [];
        const fullTextEntries = [];
        const lines = text.split('\n');
        
        for (const line of lines) {
            // Split by | to handle group separators
            const groups = line.split('|');
            
            for (const group of groups) {
                const trimmedGroup = group.trim();
                if (!trimmedGroup) continue;
                
                // Check if this group starts with a weight prefix and ends with ::
                let groupWeight = 1.0;
                let groupContent = trimmedGroup;
                
                const weightMatch = trimmedGroup.match(/^(-?\d+(?:\.\d+)?)::(.+)::$/);
                if (weightMatch) {
                    groupWeight = parseFloat(weightMatch[1]);
                    groupContent = weightMatch[2].trim();
                }
                
                // Process the group content (which may contain nested groups)
                this.processTagGroup(groupContent, groupWeight, tags, fullTextEntries);
            }
        }
        
        return { tags, fullTextEntries };
    }
    
    processTagGroup(content, baseWeight, tags, fullTextEntries) {
        if (!content || content.length < 2) return;
        
        // Split by comma to get individual tags
        const tagParts = content.split(',');
        
        for (const tagPart of tagParts) {
            const trimmedTag = tagPart.trim();
            if (!trimmedTag || trimmedTag.length < 2) continue;
            
            let tag = trimmedTag;
            let weight = baseWeight;
            let tagType = 'normal';
            
            // Check for nested brace emphasis {tag} - positive weight multiplier
            if (trimmedTag.startsWith('{') && trimmedTag.endsWith('}')) {
                const braceLevel = (trimmedTag.match(/\{/g) || []).length;
                weight = baseWeight * (1.0 + (braceLevel * 0.1));
                tag = trimmedTag.replace(/^\{+/, '').replace(/\}+$/, '').trim();
                tagType = 'brace';
            }
            // Check for nested bracket emphasis [tag] - negative weight multiplier
            else if (trimmedTag.startsWith('[') && trimmedTag.endsWith(']')) {
                const bracketLevel = (trimmedTag.match(/\[/g) || []).length;
                weight = baseWeight * (1.0 - (bracketLevel * 0.1));
                tag = trimmedTag.replace(/^\[+/, '').replace(/\]+$/, '').trim();
                tagType = 'bracket';
            }
            // Check for nested weight groups (e.g., 2::{tag}::)
            else if (trimmedTag.includes('::')) {
                const nestedWeightMatch = trimmedTag.match(/^(-?\d+(?:\.\d+)?)::(.+)::$/);
                if (nestedWeightMatch) {
                    const nestedWeight = parseFloat(nestedWeightMatch[1]);
                    const nestedContent = nestedWeightMatch[2].trim();
                    // Recursively process nested group with combined weight
                    this.processTagGroup(nestedContent, baseWeight * nestedWeight, tags, fullTextEntries);
                    continue;
                }
            }
            
            // Skip if tag is too short or contains invalid characters
            if (tag.length < 2 || /[<>]/.test(tag)) continue;
            
            // Clean up the tag (remove extra spaces, etc.)
            tag = tag.replace(/\s+/g, ' ').trim();
            
            if (tag.length >= 2) {
                // Check if this is display text (starts with "Text:")
                if (tag.startsWith('Text:')) {
                    const displayText = tag.substring(5).trim();
                    if (displayText.length > 0) {
                        fullTextEntries.push({
                            text: displayText.toLowerCase(),
                            originalText: displayText,
                            weight: weight,
                            type: 'display_text'
                        });
                    }
                    continue;
                }
                
                // Check if tag is longer than 5 words - treat as full text
                const wordCount = tag.split(/\s+/).length;
                if (wordCount > 5) {
                    fullTextEntries.push({
                        text: tag.toLowerCase(),
                        originalText: tag,
                        weight: weight,
                        type: 'long_tag'
                    });
                    continue;
                }
                
                // Regular tag
                tags.push({
                    tag: tag.toLowerCase(),
                    originalTag: tag,
                    weight: weight,
                    type: tagType
                });
            }
        }
    }
    
    // Build tag index from metadata
    buildTagIndex(metadata) {
        this.tagIndex.clear();
        this.fullTextIndex = new Map();
        this.presetIndex = new Map();
        this.characterIndex = new Map();
        this.modelIndex = new Map();
        
        for (const [filename, fileData] of Object.entries(metadata)) {
            if (!fileData.metadata) continue;
            
            const pngMeta = fileData.metadata;
            const fileTags = [];
            const fileFullText = [];
            
            // Extract tags and full text from main prompt
            if (pngMeta.prompt) {
                const promptData = this.extractTagsFromText(pngMeta.prompt);
                fileTags.push(...promptData.tags.map(t => ({ ...t, source: 'prompt' })));
                fileFullText.push(...promptData.fullTextEntries.map(t => ({ ...t, source: 'prompt' })));
            }
            
            // Extract tags and full text from character prompts
            if (pngMeta.forge_data) {
                const forgeData = pngMeta.forge_data;
                
                if (forgeData.disabledCharacters && Array.isArray(forgeData.disabledCharacters)) {
                    for (const charPrompt of forgeData.disabledCharacters) {
                        if (charPrompt.prompt) {
                            const charData = this.extractTagsFromText(charPrompt.prompt);
                            fileTags.push(...charData.tags.map(t => ({ ...t, source: 'character_prompt', character: charPrompt.chara_name })));
                            fileFullText.push(...charData.fullTextEntries.map(t => ({ ...t, source: 'character_prompt', character: charPrompt.chara_name })));
                        }
                    }
                }
            }
            
            // Extract tags and full text from v4 prompts
            if (pngMeta.v4_prompt && pngMeta.v4_prompt.caption && pngMeta.v4_prompt.caption.char_captions) {
                for (const caption of pngMeta.v4_prompt.caption.char_captions) {
                    if (caption.char_caption) {
                        const v4Data = this.extractTagsFromText(caption.char_caption);
                        fileTags.push(...v4Data.tags.map(t => ({ ...t, source: 'v4_character_caption', character: 'v4_character' })));
                        fileFullText.push(...v4Data.fullTextEntries.map(t => ({ ...t, source: 'v4_character_caption', character: 'v4_character' })));
                    }
                }
            }
            
            // Index preset names
            if (pngMeta.preset_name) {
                const presetKey = pngMeta.preset_name.toLowerCase();
                if (!this.presetIndex.has(presetKey)) {
                    this.presetIndex.set(presetKey, {
                        name: pngMeta.preset_name,
                        files: new Map(),
                        occurrenceCount: 0
                    });
                }
                this.presetIndex.get(presetKey).files.set(filename, {
                    filename: filename,
                    source: 'preset',
                    metadata: {
                        width: fileData.width,
                        height: fileData.height,
                        upscaled: fileData.upscaled,
                        size: fileData.size,
                        mtime: fileData.mtime
                    }
                });
                this.presetIndex.get(presetKey).occurrenceCount++;
            }
            
            // Index character names
            if (pngMeta.forge_data) {
                const forgeData = pngMeta.forge_data;
                
                if (forgeData.characterNames && Array.isArray(forgeData.characterNames)) {
                    for (const charName of forgeData.characterNames) {
                        if (charName && charName.trim()) {
                            const charKey = charName.toLowerCase().trim();
                            if (!this.characterIndex.has(charKey)) {
                                this.characterIndex.set(charKey, {
                                    name: charName.trim(),
                                    files: new Map(),
                                    occurrenceCount: 0
                                });
                            }
                            this.characterIndex.get(charKey).files.set(filename, {
                                filename: filename,
                                source: 'character_name',
                                metadata: {
                                    width: fileData.width,
                                    height: fileData.height,
                                    upscaled: fileData.upscaled,
                                    size: fileData.size,
                                    mtime: fileData.mtime
                                }
                            });
                            this.characterIndex.get(charKey).occurrenceCount++;
                        }
                    }
                }
            }
            
            // Index each tag
            for (const tagData of fileTags) {
                const tagKey = tagData.tag;
                
                if (!this.tagIndex.has(tagKey)) {
                    this.tagIndex.set(tagKey, {
                        tag: tagKey,
                        originalTag: tagData.originalTag,
                        files: new Map(),
                        totalWeight: 0,
                        occurrenceCount: 0
                    });
                }
                
                const tagInfo = this.tagIndex.get(tagKey);
                
                // Add file to tag index
                if (!tagInfo.files.has(filename)) {
                    tagInfo.files.set(filename, {
                        filename: filename,
                        weight: tagData.weight,
                        source: tagData.source,
                        character: tagData.character,
                        metadata: {
                            width: fileData.width,
                            height: fileData.height,
                            upscaled: fileData.upscaled,
                            size: fileData.size,
                            mtime: fileData.mtime
                        }
                    });
                    
                    tagInfo.totalWeight += tagData.weight;
                    tagInfo.occurrenceCount++;
                }
            }
            
            // Index full text entries
            for (const textData of fileFullText) {
                const textKey = textData.text;
                
                if (!this.fullTextIndex.has(textKey)) {
                    this.fullTextIndex.set(textKey, {
                        text: textKey,
                        originalText: textData.originalText,
                        files: new Map(),
                        totalWeight: 0,
                        occurrenceCount: 0,
                        type: textData.type
                    });
                }
                
                const textInfo = this.fullTextIndex.get(textKey);
                
                // Add file to full text index
                if (!textInfo.files.has(filename)) {
                    textInfo.files.set(filename, {
                        filename: filename,
                        weight: textData.weight,
                        source: textData.source,
                        character: textData.character,
                        metadata: {
                            width: fileData.width,
                            height: fileData.height,
                            upscaled: fileData.upscaled,
                            size: fileData.size,
                            mtime: fileData.mtime
                        }
                    });
                    
                    textInfo.totalWeight += textData.weight;
                    textInfo.occurrenceCount++;
                }
            }
        }
        
        console.log(`✅ Tag index built: ${this.tagIndex.size} unique tags, ${this.fullTextIndex.size} full text entries, ${this.presetIndex.size} presets, ${this.characterIndex.size} characters, ${this.modelIndex.size} models indexed`);
    }
    
    // Get tag suggestions based on query
    getTagSuggestions(query, limit = 20, contextTags = []) {
        const suggestions = [];
        const pushDedup = (arr, item, keyFn) => {
            const key = keyFn(item);
            if (!arr._set) arr._set = new Set();
            if (arr._set.has(key)) return;
            arr._set.add(key);
            arr.push(item);
        };

        const cleanLabel = (str) => {
            if (!str) return '';
            let s = String(str).trim();
            // Remove weight prefixes like "2::tag" or "3.0::tag"
            s = s.replace(/^(-?\d+(?:\.\d+)?)::/, '');
            // Remove orphan trailing ::
            s = s.replace(/::+$/, '');
            return s.trim();
        };

        // Empty query: return top results
        if (!query || query.length === 0) {
            // Top tags by occurrence + weight
            for (const [tagKey, tagInfo] of this.tagIndex) {
                const original = cleanLabel(tagInfo.originalTag || tagKey);
                
                if (original && original.length > 0) {
                    const suggestion = {
                        type: 'tag',
                        tag: tagKey,
                        originalTag: original,
                        occurrenceCount: tagInfo.occurrenceCount,
                        totalWeight: tagInfo.totalWeight,
                        files: Array.from(tagInfo.files.values())
                    };
                    
                    pushDedup(suggestions, suggestion, (it) => `tag:${it.originalTag.toLowerCase()}`);
                }
            }

            // Include some top full text entries as TEXT suggestions
            for (const [textKey, textInfo] of this.fullTextIndex) {
                const original = cleanLabel(textInfo.originalText || textKey);
                if (original && original.length > 0) {
                    pushDedup(suggestions, {
                        type: 'full_text',
                        tag: textKey,
                        originalTag: original,
                        fullText: textInfo.originalText,
                        occurrenceCount: textInfo.occurrenceCount,
                        totalWeight: textInfo.totalWeight,
                        files: Array.from(textInfo.files.values())
                    }, (it) => `text:${(it.originalTag || '').toLowerCase()}`);
                }
            }

            // Sort and return top N
            suggestions.sort((a, b) => {
                const scoreA = a.occurrenceCount + Math.abs(a.totalWeight || 0);
                const scoreB = b.occurrenceCount + Math.abs(b.totalWeight || 0);
                if (scoreA !== scoreB) return scoreB - scoreA;
                return (a.originalTag || a.tag).localeCompare(b.originalTag || b.tag);
            });
            
            return suggestions.slice(0, limit);
        }

        const queryLower = query.toLowerCase();

        // Search in tags
        for (const [tagKey, tagInfo] of this.tagIndex) {
            if (tagKey.includes(queryLower)) {
                pushDedup(suggestions, {
                    type: 'tag',
                    tag: tagKey,
                    originalTag: cleanLabel(tagInfo.originalTag || tagKey),
                    occurrenceCount: tagInfo.occurrenceCount,
                    totalWeight: tagInfo.totalWeight,
                    files: Array.from(tagInfo.files.values())
                }, (it) => `tag:${it.originalTag.toLowerCase()}`);
            }
        }

        // Search in full text entries
        for (const [textKey, textInfo] of this.fullTextIndex) {
            if (textKey.includes(queryLower)) {
                // Find a specific word/phrase that matches
                const words = (textInfo.originalText || '').split(/\s+/);
                const matchingWord = words.find(word => word.toLowerCase().includes(queryLower)) || textKey;
                pushDedup(suggestions, {
                    type: 'full_text',
                    tag: matchingWord.toLowerCase(),
                    originalTag: matchingWord,
                    fullText: textInfo.originalText,
                    occurrenceCount: textInfo.occurrenceCount,
                    totalWeight: textInfo.totalWeight,
                    files: Array.from(textInfo.files.values())
                }, (it) => `text:${it.originalTag.toLowerCase()}`);
            }
        }

        // Search in presets
        for (const [presetKey, presetInfo] of this.presetIndex) {
            if (presetKey.includes(queryLower)) {
                pushDedup(suggestions, {
                    type: 'preset',
                    tag: presetKey,
                    originalTag: presetInfo.name,
                    occurrenceCount: presetInfo.occurrenceCount,
                    totalWeight: 0,
                    files: Array.from(presetInfo.files.values())
                }, (it) => `preset:${it.originalTag.toLowerCase()}`);
            }
        }

        // Search in character names
        for (const [charKey, charInfo] of this.characterIndex) {
            if (charKey.includes(queryLower)) {
                pushDedup(suggestions, {
                    type: 'character',
                    tag: charKey,
                    originalTag: charInfo.name,
                    occurrenceCount: charInfo.occurrenceCount,
                    totalWeight: 0,
                    files: Array.from(charInfo.files.values())
                }, (it) => `character:${it.originalTag.toLowerCase()}`);
            }
        }

        // Apply context-aware ranking if context tags are provided
        if (contextTags && contextTags.length > 0) {
            console.log('🔍 Backend: Applying context-aware ranking with tags:', contextTags);
            suggestions.forEach(suggestion => {
                let contextScore = 0;
                
                // Check if this suggestion appears in the same prompts as context tags
                for (const contextTag of contextTags) {
                    const contextTagLower = contextTag.toLowerCase();
                    
                    // Look for files that contain both the context tag and this suggestion
                    if (suggestion.files && Array.isArray(suggestion.files)) {
                        for (const fileInfo of suggestion.files) {
                            // Check if this file also contains context tags
                            const fileMetadata = this.getFileMetadata(fileInfo.filename || fileInfo.original || fileInfo.upscaled);
                            if (fileMetadata) {
                                const fileText = this.extractSearchableText(fileMetadata).toLowerCase();
                                if (fileText.includes(contextTagLower)) {
                                    contextScore += 1;
                                }
                            }
                        }
                    }
                }
                
                // Boost score for context-relevant suggestions
                suggestion.contextScore = contextScore;
                suggestion.boostedScore = (suggestion.occurrenceCount + Math.abs(suggestion.totalWeight || 0)) + (contextScore * 10);
            });
            
            console.log('🔍 Backend: Context scores applied, sorting by boosted scores');
            
            // Sort by boosted score (context relevance + original score)
            suggestions.sort((a, b) => {
                const scoreA = a.boostedScore || (a.occurrenceCount + Math.abs(a.totalWeight || 0));
                const scoreB = b.boostedScore || (b.occurrenceCount + Math.abs(b.totalWeight || 0));
                if (scoreA !== scoreB) return scoreB - scoreA;
                return (a.originalTag || a.tag).localeCompare(b.originalTag || b.tag);
            });
        } else {
            console.log('🔍 Backend: No context tags, using original sorting');
            // Original sorting for non-context queries
            suggestions.sort((a, b) => {
                const scoreA = a.occurrenceCount + Math.abs(a.totalWeight || 0);
                const scoreB = b.occurrenceCount + Math.abs(b.totalWeight || 0);
                if (scoreA !== scoreB) return scoreB - scoreA;
                return (a.originalTag || a.tag).localeCompare(b.originalTag || b.tag);
            });
        }

        return suggestions.slice(0, limit);
    }
    
    // Get context-aware suggestions - only tags from files that contain the context tags
    getContextAwareSuggestions(query, limit = 20, contextTags = []) {
        if (!contextTags || contextTags.length === 0) {
            return this.getTagSuggestions(query, limit);
        }
        
        console.log('🔍 Backend: Getting context-aware suggestions for tags:', contextTags);
        
        // First, find all files that contain ALL context tags
        const contextMatchingFiles = new Set();
        let firstContextTerm = true;
        
        for (const contextTag of contextTags) {
            const contextTagLower = contextTag.toLowerCase();
            const termSuggestions = this.getTagSuggestions(contextTagLower, 100);
            const termFiles = new Set();
            
            // Collect files that match this context tag
            for (const suggestion of termSuggestions) {
                for (const fileInfo of suggestion.files) {
                    const filename = fileInfo.filename || fileInfo.original || fileInfo.upscaled;
                    if (filename) {
                        termFiles.add(filename);
                    }
                }
            }
            
            if (firstContextTerm) {
                // Initialize with first term's files
                contextMatchingFiles.add(...termFiles);
                firstContextTerm = false;
            } else {
                // Keep only files that match ALL context tags (AND condition)
                const currentFiles = new Set(contextMatchingFiles);
                for (const filename of currentFiles) {
                    if (!termFiles.has(filename)) {
                        contextMatchingFiles.delete(filename);
                    }
                }
            }
        }
        
        console.log(`🔍 Backend: Found ${contextMatchingFiles.size} files matching all context tags`);
        
        // Now get suggestions, but only include tags from files that match the context
        const suggestions = [];
        const pushDedup = (arr, item, keyFn) => {
            const key = keyFn(item);
            if (!arr._set) arr._set = new Set();
            if (arr._set.has(key)) return;
            arr._set.add(key);
            arr.push(item);
        };

        const cleanLabel = (str) => {
            if (!str) return '';
            let s = String(str).trim();
            s = s.replace(/^(-?\d+(?:\.\d+)?)::/, '');
            s = s.replace(/::+$/, '');
            return s.trim();
        };

        if (!query || query.length === 0) {
            // Get all tags from context-matching files
            for (const [tagKey, tagInfo] of this.tagIndex) {
                const original = cleanLabel(tagInfo.originalTag || tagKey);
                
                if (original && original.length > 0) {
                    // Only include tags that appear in context-matching files
                    const contextRelevantFiles = [];
                    for (const fileInfo of tagInfo.files.values()) {
                        const filename = fileInfo.filename || fileInfo.original || fileInfo.upscaled;
                        if (filename && contextMatchingFiles.has(filename)) {
                            contextRelevantFiles.push(fileInfo);
                        }
                    }
                    
                    if (contextRelevantFiles.length > 0) {
                        const suggestion = {
                            type: 'tag',
                            tag: tagKey,
                            originalTag: original,
                            occurrenceCount: contextRelevantFiles.length,
                            totalWeight: contextRelevantFiles.reduce((sum, fi) => sum + (fi.weight || 0), 0),
                            files: contextRelevantFiles
                        };
                        pushDedup(suggestions, suggestion, (it) => `tag:${it.originalTag.toLowerCase()}`);
                    }
                }
            }
        } else {
            // Search for specific query within context-matching files
            const queryLower = query.toLowerCase();
            
            for (const [tagKey, tagInfo] of this.tagIndex) {
                if (tagKey.includes(queryLower)) {
                    const original = cleanLabel(tagInfo.originalTag || tagKey);
                    
                    // Only include tags that appear in context-matching files
                    const contextRelevantFiles = [];
                    for (const fileInfo of tagInfo.files.values()) {
                        const filename = fileInfo.filename || fileInfo.original || fileInfo.upscaled;
                        if (filename && contextMatchingFiles.has(filename)) {
                            contextRelevantFiles.push(fileInfo);
                        }
                    }
                    
                    if (contextRelevantFiles.length > 0) {
                        pushDedup(suggestions, {
                            type: 'tag',
                            tag: tagKey,
                            originalTag: original,
                            occurrenceCount: contextRelevantFiles.length,
                            totalWeight: contextRelevantFiles.reduce((sum, fi) => sum + (fi.weight || 0), 0),
                            files: contextRelevantFiles
                        }, (it) => `tag:${it.originalTag.toLowerCase()}`);
                    }
                }
            }
        }
        
        // Sort by occurrence count and weight
        suggestions.sort((a, b) => {
            const scoreA = a.occurrenceCount + Math.abs(a.totalWeight || 0);
            const scoreB = b.occurrenceCount + Math.abs(b.totalWeight || 0);
            if (scoreA !== scoreB) return scoreB - scoreA;
            return (a.originalTag || a.tag).localeCompare(b.originalTag || b.tag);
        });
        
        console.log(`🔍 Backend: Generated ${suggestions.length} context-aware suggestions`);
        return suggestions.slice(0, limit);
    }
    
    // Helper method to get file metadata
    getFileMetadata(filename) {
        try {
            const { getImagesMetadata } = require('./metadataCache');
            const allMetadata = getImagesMetadata();
            return allMetadata[filename] || null;
        } catch (error) {
            console.error('Error getting file metadata:', error);
            return null;
        }
    }
    
    // Helper method to extract searchable text from metadata
    extractSearchableText(metadata) {
        if (!metadata) return '';
        
        const textParts = [];
        
        // Extract from various metadata fields
        if (metadata.prompt) textParts.push(metadata.prompt);
        if (metadata.uc) textParts.push(metadata.uc);
        if (metadata.characterPrompts) textParts.push(metadata.characterPrompts);
        if (metadata.v4_prompt && metadata.v4_prompt.caption) {
            if (metadata.v4_prompt.caption.char_captions) {
                textParts.push(metadata.v4_prompt.caption.char_captions);
            }
            if (metadata.v4_prompt.caption.text) {
                textParts.push(metadata.v4_prompt.caption.text);
            }
        }
        if (metadata.v4_negative_prompt && metadata.v4_negative_prompt.caption) {
            if (metadata.v4_negative_prompt.caption.char_captions) {
                textParts.push(metadata.v4_negative_prompt.caption.char_captions);
            }
            if (metadata.v4_negative_prompt.caption.text) {
                textParts.push(metadata.v4_negative_prompt.caption.text);
            }
        }
        if (metadata.forge_data) {
            if (metadata.forge_data.allCharacters) textParts.push(metadata.forge_data.allCharacters);
            if (metadata.forge_data.disabledCharacters) textParts.push(metadata.forge_data.disabledCharacters);
            if (metadata.forge_data.characterNames) textParts.push(metadata.forge_data.characterNames);
        }
        if (metadata.preset_name) textParts.push(metadata.preset_name);
        if (metadata.model) textParts.push(metadata.model);
        
        return textParts.join(' ').toLowerCase();
    }
    
    // Search files by tags
    searchFilesByTags(query, viewType, sessionId) {
        const searchTerms = query.toLowerCase().trim().split(',').map(term => term.trim()).filter(term => term.length > 0);
        console.log('🔍 Search: Processing search terms:', searchTerms);
        
        try {
            // Get cached data for this session
            const cacheData = this.searchCache.get(sessionId);
            if (!cacheData) {
                throw new Error('Search cache not initialized. Call search_files with action="start" first.');
            }
            
            if (cacheData.viewType !== viewType) {
                throw new Error(`View type mismatch. Cache initialized for ${cacheData.viewType}, but searching in ${viewType}`);
            }
            
            // Get tag suggestions for the first term (for display purposes)
            const tagSuggestions = searchTerms.length > 0 ? this.getTagSuggestions(searchTerms[0], 20) : [];
            
            // Find files that contain ALL search terms (AND condition)
            const matchingFiles = new Map();
            
            // Process each search term
            for (const searchTerm of searchTerms) {
                console.log(`🔍 Search: Processing term "${searchTerm}"`);
                const termSuggestions = this.getTagSuggestions(searchTerm, 100); // Get more suggestions for comprehensive search
                const termFiles = new Set();
                
                // Collect all files that match this term
                for (const suggestion of termSuggestions) {
                    for (const fileInfo of suggestion.files) {
                        // Handle different file info structures
                        const filename = fileInfo.filename || fileInfo.original || fileInfo.upscaled;
                        if (filename) {
                            termFiles.add(filename);
                        }
                    }
                }
                
                console.log(`🔍 Search: Term "${searchTerm}" matches ${termFiles.size} files`);
                
                // If this is the first term, initialize matching files
                if (searchTerms.indexOf(searchTerm) === 0) {
                    for (const filename of termFiles) {
                        matchingFiles.set(filename, {
                            filename: filename,
                            matchScore: 0,
                            matchDetails: [],
                            matchedTags: [],
                            metadata: null
                        });
                    }
                    console.log(`🔍 Search: Initialized with ${matchingFiles.size} files from first term`);
                } else {
                    // For subsequent terms, only keep files that match ALL terms (AND condition)
                    const currentMatchingFiles = new Set(matchingFiles.keys());
                    let removedCount = 0;
                    for (const filename of currentMatchingFiles) {
                        if (!termFiles.has(filename)) {
                            matchingFiles.delete(filename);
                            removedCount++;
                        }
                    }
                    console.log(`🔍 Search: After AND filter for term "${searchTerm}": ${matchingFiles.size} files remain (removed ${removedCount})`);
                }
            }
            
            // Now calculate scores for remaining files (those that match ALL terms)
            for (const [filename, fileResult] of matchingFiles) {
                // Get metadata for the file
                const fileData = cacheData.metadata[filename];
                if (fileData) {
                    fileResult.metadata = {
                        width: fileData.width,
                        height: fileData.height,
                        upscaled: fileData.upscaled,
                        size: fileData.size,
                        mtime: fileData.mtime
                    };
                }
                
                // Calculate score based on how well each term matches
                for (const searchTerm of searchTerms) {
                    const termSuggestions = this.getTagSuggestions(searchTerm, 100);
                    
                    for (const suggestion of termSuggestions) {
                        for (const fileInfo of suggestion.files) {
                            // Handle different file info structures
                            const fileInfoFilename = fileInfo.filename || fileInfo.original || fileInfo.upscaled;
                            if (fileInfoFilename === filename) {
                                const tagScore = Math.abs(fileInfo.weight || 0) * 10; // Base score from weight
                                const occurrenceBonus = suggestion.occurrenceCount * 2; // Bonus for popular tags
                                const termMatchBonus = 5; // Bonus for matching each term
                                
                                fileResult.matchScore += tagScore + occurrenceBonus + termMatchBonus;
                                fileResult.matchedTags.push({
                                    tag: suggestion.originalTag,
                                    weight: fileInfo.weight || 0,
                                    source: fileInfo.source || 'unknown',
                                    character: fileInfo.character || null
                                });
                                
                                fileResult.matchDetails.push({
                                    field: fileInfo.source || 'unknown',
                                    value: suggestion.originalTag,
                                    highlight: this.highlightSearchTerm(suggestion.originalTag, searchTerm),
                                    weight: fileInfo.weight || 0,
                                    character: fileInfo.character || null
                                });
                            }
                        }
                    }
                }
            }
            
            // Convert to array and sort by score
            const results = Array.from(matchingFiles.values());
            results.sort((a, b) => b.matchScore - a.matchScore);
            
            console.log(`🔍 Search: Final results: ${results.length} files match ALL terms (AND condition)`);
            
            return {
                results: results,
                tagSuggestions: tagSuggestions,
                query: query
            };
            
        } catch (error) {
            console.error('Error performing tag-based file search:', error);
            throw error;
        }
    }

    // Handle image generation requests
    async handleImageGeneration(ws, message, clientInfo, wsServer) {
        try {
            const { requestId, ...data } = message;
            console.log(`🚀 Processing image generation request: ${requestId}`);
            console.log('📋 Generation data:', data);
            
            // Call the WebSocket-native image generation function directly
            const result = await generateImageWebSocket(
                data, 
                clientInfo.userType, 
                clientInfo.sessionId
            );
            
            // Send success response with image data using _response pattern
            this.sendToClient(ws, {
                type: 'image_generation_response',
                requestId: requestId,
                data: {
                    image: result.buffer.toString('base64'),
                    filename: result.filename,
                    seed: result.seed || null
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Image generation error:', error);
            this.sendToClient(ws, {
                type: 'image_generation_error',
                requestId: message.requestId,
                data: null,
                error: error.message || 'Image generation failed',
                timestamp: new Date().toISOString()
            });
        }
    }

        // Handle image upscaling requests
    async handleImageUpscaling(ws, message, clientInfo, wsServer) {
        try {
            const { requestId, ...data } = message;
            console.log(`📏 Processing image upscaling request: ${requestId}`);
            console.log('📋 Upscaling data:', data);

            // Call the WebSocket-native upscaling function directly
            const result = await upscaleImageWebSocket(
                data.filename, 
                data.workspace, 
                clientInfo.userType, 
                clientInfo.sessionId
            );
            
            // Send success response with upscaled image data using _response pattern
            this.sendToClient(ws, {
                type: 'image_upscaling_response',
                requestId: requestId,
                data: {
                    image: result.buffer.toString('base64'),
                    filename: result.filename
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Image upscaling error:', error);
            this.sendToClient(ws, {
                type: 'image_upscaling_error',
                requestId: message.requestId,
                data: null,
                error: error.message || 'Image upscaling failed',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle cache manifest requests
    async handleGetCacheManifest(ws, message, clientInfo, wsServer) {
        try {
            const globalCacheData = this.context.getGlobalCacheData ? this.context.getGlobalCacheData() : [];
            
            const response = {
                type: 'cache_manifest_response',
                requestId: message.requestId,
                data: {
                    assets: globalCacheData || [],
                    timestamp: Date.now().valueOf()
                },
                timestamp: new Date().toISOString()
            };
            
            wsServer.sendToClient(ws, response);            
        } catch (error) {
            console.error('❌ Cache manifest error:', error);
            wsServer.sendToClient(ws, {
                type: 'error',
                message: 'Failed to get cache manifest',
                details: error.message,
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle cache data reload requests
    async handleReloadCacheData(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin (not readonly)
            if (clientInfo.userType !== 'admin') {
                wsServer.sendToClient(ws, {
                    type: 'cache_reload_response',
                    requestId: message.requestId,
                    data: {
                        success: false,
                        error: 'Admin access required to reload cache data'
                    },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            console.log('🔄 Admin requested cache data reload via WebSocket...');
            
            // Get the reload function from context
            const reloadCacheData = this.context.reloadCacheData;
            if (!reloadCacheData) {
                throw new Error('Cache reload function not available in context');
            }
            
            // Force reload of cache data
            await reloadCacheData();
            
            // Get updated cache data
            const globalCacheData = this.context.getGlobalCacheData ? this.context.getGlobalCacheData() : [];
            
            console.log(`✅ Cache data reloaded successfully via WebSocket: ${globalCacheData.length} assets`);
            
            wsServer.sendToClient(ws, {
                type: 'cache_reload_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Cache data reloaded successfully',
                    assetsCount: globalCacheData.length,
                    timestamp: Date.now().valueOf(),
                    assets: globalCacheData
                },
                timestamp: new Date().toISOString()
            });
            
        } catch (error) {
            console.error('❌ Cache reload error:', error);
            wsServer.sendToClient(ws, {
                type: 'cache_reload_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Failed to reload cache data',
                    details: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }
}

module.exports = { WebSocketMessageHandlers }; 