const { SearchService, loadPromptConfig } = require('./textReplacements');
const DatasetTagService = require('./datasetTagService');
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
    addToWorkspaceArray,
    removeFromWorkspaceArray,
    updateWorkspaceColor,
    updateWorkspaceBackgroundColor,
    updateWorkspaceBackgroundImage,
    updateWorkspaceBackgroundOpacity,
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
const { getCachedMetadata, getAllMetadata, removeImageMetadata } = require('./metadataCache');
const { isImageLarge, matchOriginalResolution } = require('./imageTools');
const { readMetadata, updateMetadata, getImageMetadata, extractRelevantFields } = require('./pngMetadata');
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
const vibeOrigCacheDir = path.join(cacheDir, 'vibe_orig');
const imagesDir = path.resolve(__dirname, '../images');
const previewsDir = path.resolve(__dirname, '../.previews');

// WebSocket message handlers
class WebSocketMessageHandlers {
    constructor(context = {}) {
        this.searchService = new SearchService(context);
        this.datasetTagService = new DatasetTagService();
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
                
                case 'search_tags':
                    await this.handleSearchTags(ws, message, clientInfo, wsServer);
                    break;
                
                case 'spellcheck_add_word':
                    await this.handleAddWordToDictionary(ws, message, clientInfo, wsServer);
                    break;
                
                case 'request_gallery':
                    await this.handleGalleryRequest(ws, message, clientInfo, wsServer);
                    break;
                
                case 'request_image_metadata':
                    await this.handleImageMetadataRequest(ws, message, clientInfo, wsServer);
                    break;
                
                // Workspace handlers
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
                
                case 'workspace_update_background_image':
                    await this.handleWorkspaceUpdateBackgroundImage(ws, message, clientInfo, wsServer);
                    break;
                
                case 'workspace_update_background_opacity':
                    await this.handleWorkspaceUpdateBackgroundOpacity(ws, message, clientInfo, wsServer);
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
                
                case 'get_workspace_references':
                    await this.handleGetWorkspaceReferences(ws, message, clientInfo, wsServer);
                    break;
                
                case 'delete_reference':
                    await this.handleDeleteReference(ws, message, clientInfo, wsServer);
                    break;
                
                case 'upload_reference':
                    await this.handleUploadReference(ws, message, clientInfo, wsServer);
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

    // Handle gallery request messages
    async handleGalleryRequest(ws, message, clientInfo, wsServer) {
        const { viewType = 'images', includePinnedStatus = true } = message;
        
        try {
            // Get files based on view type
            let files;
            if (viewType === 'scraps') {
                files = getActiveWorkspaceScraps();
            } else if (viewType === 'pinned') {
                files = getActiveWorkspacePinned();
            } else if (viewType === 'upscaled') {
                const workspaceFiles = getActiveWorkspaceFiles();
                files = workspaceFiles;
                
                // Also include wallpaper and large resolution images from metadata cache
                const allMetadata = getAllMetadata();
                
                // Find large resolution images (area > 1024x1024)
                const specialImages = [];
                for (const [filename, metadata] of Object.entries(allMetadata)) {
                    if (metadata.width && metadata.height) {
                        if (isImageLarge(metadata.width, metadata.height)) {
                            // Check if this image is in the current workspace
                            const workspace = getActiveWorkspace();
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
                files = getActiveWorkspaceFiles();
            }
            
            // Get pinned status if requested
            let pinnedFiles = [];
            if (includePinnedStatus) {
                pinnedFiles = getActiveWorkspacePinned();
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
                
                // Get metadata from cache instead of file system
                const metadata = getCachedMetadata(file);
                if (!metadata) {
                    console.warn(`No metadata found for file: ${file}`);
                    continue;
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
                    isPinned: includePinnedStatus ? pinnedFiles.includes(file) : false
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

    // Workspace handlers
    async handleWorkspaceList(ws, message, clientInfo, wsServer) {
        try {
            const workspaces = getWorkspaces();
            const activeWorkspaceId = getActiveWorkspace();
            
            // Transform to include workspace metadata
            const workspaceList = Object.entries(workspaces).map(([id, workspace]) => ({
                id,
                name: workspace.name,
                color: workspace.color || '#124',
                backgroundColor: workspace.backgroundColor,
                backgroundImage: workspace.backgroundImage,
                backgroundOpacity: workspace.backgroundOpacity || 0.3,
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
            const activeId = getActiveWorkspace();
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
                    backgroundImage: workspace.backgroundImage,
                    backgroundOpacity: workspace.backgroundOpacity || 0.3,
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
            
            this.sendToClient(ws, {
                type: 'workspace_create_response',
                requestId: message.requestId,
                data: { success: true, id: workspaceId, name: name.trim() },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'created', workspaceId, name: name.trim() },
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
            
            deleteWorkspace(id);
            
            this.sendToClient(ws, {
                type: 'workspace_delete_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace deleted and items moved to default' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'deleted', workspaceId: id },
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
            
            setActiveWorkspace(id);
            
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
            
            dumpWorkspace(sourceId, targetId);
            
            this.sendToClient(ws, {
                type: 'workspace_dump_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace dumped successfully' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'dumped', sourceId, targetId },
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
            const { id, filenames, sourceWorkspaceId } = message;
            
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
            
            const movedCount = moveFilesToWorkspace(filenames, id, sourceWorkspaceId);
            
            this.sendToClient(ws, {
                type: 'workspace_move_files_response',
                requestId: message.requestId,
                data: { success: true, message: `Moved ${movedCount} files to workspace`, movedCount },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'files_moved', workspaceId: id, movedCount },
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
            const scraps = getActiveWorkspaceScraps();
            
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
            const pinned = getActiveWorkspacePinned();
            
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

    async handleWorkspaceUpdateBackgroundImage(ws, message, clientInfo, wsServer) {
        try {
            const { id, backgroundImage } = message;
            
            updateWorkspaceBackgroundImage(id, backgroundImage);
            
            this.sendToClient(ws, {
                type: 'workspace_update_background_image_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace background image updated' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'background_image_updated', workspaceId: id, backgroundImage },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update background image error:', error);
            this.sendError(ws, 'Failed to update workspace background image', error.message, message.requestId);
        }
    }

    async handleWorkspaceUpdateBackgroundOpacity(ws, message, clientInfo, wsServer) {
        try {
            const { id, backgroundOpacity } = message;
            
            if (typeof backgroundOpacity !== 'number' || backgroundOpacity < 0 || backgroundOpacity > 1) {
                this.sendError(ws, 'Background opacity must be a number between 0 and 1', 'workspace_update_background_opacity', message.requestId);
                return;
            }
            
            updateWorkspaceBackgroundOpacity(id, backgroundOpacity);
            
            this.sendToClient(ws, {
                type: 'workspace_update_background_opacity_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace background opacity updated' },
                timestamp: new Date().toISOString()
            });
            
            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'background_opacity_updated', workspaceId: id, backgroundOpacity },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace update background opacity error:', error);
            this.sendError(ws, 'Failed to update workspace background opacity', error.message, message.requestId);
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
            const activeWorkspace = getActiveWorkspaceData();
            const workspaces = getWorkspacesData();
            
            // Get cache files for active workspace (includes default + active workspace)
            const workspaceCacheFiles = getActiveWorkspaceCacheFiles();
            const allFiles = fs.readdirSync(uploadCacheDir);
            const files = allFiles.filter(file => workspaceCacheFiles.includes(file));
            
            const cacheFiles = [];
            for (const file of files) {
                const filePath = path.join(uploadCacheDir, file);
                const stats = fs.statSync(filePath);
                const previewPath = path.join(previewCacheDir, `${file}.webp`);
                
                // Determine workspace ownership
                let workspaceId = 'default';
                if (activeWorkspace !== 'default' && workspaces[activeWorkspace] && workspaces[activeWorkspace].cacheFiles.includes(file)) {
                    workspaceId = activeWorkspace;
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
            const currentWorkspace = getWorkspace(activeWorkspace);
            const defaultWorkspace = getWorkspace('default');
            
            if (currentWorkspace) {
                vibeImageDetails = this.collectVibeImageDetails(currentWorkspace.vibeImages || [], activeWorkspace);
            }
            
            // Add default workspace vibes if not already included
            if (activeWorkspace !== 'default' && defaultWorkspace) {
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

    async handleGetWorkspaceReferences(ws, message, clientInfo, wsServer) {
        try {            
            const workspaceId = message.workspaceId;
            
            // Get cache files for specific workspace
            const workspaceCacheFiles = getActiveWorkspaceCacheFiles(workspaceId);
            const allFiles = fs.readdirSync(uploadCacheDir);
            const files = allFiles.filter(file => workspaceCacheFiles.includes(file));
            
            const cacheFiles = [];
            for (const file of files) {
                const filePath = path.join(uploadCacheDir, file);
                const stats = fs.statSync(filePath);
                const previewPath = path.join(previewCacheDir, `${file}.webp`);
                
                cacheFiles.push({
                    hash: file,
                    filename: file,
                    mtime: stats.mtime.valueOf(),
                    size: stats.size,
                    hasPreview: fs.existsSync(previewPath)
                });
            }
            
            // Get vibe images for the workspace
            const workspace = getWorkspace(workspaceId);
            const vibeImageDetails = workspace ? 
                this.collectVibeImageDetails(workspace.vibeImages || [], workspaceId) : [];
            
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
            const { imageData, workspaceId } = message;
            
            // Convert base64 to buffer
            const imageBuffer = Buffer.from(imageData, 'base64');
            
            // Generate hash
            const hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
            
            // Save file
            const filePath = path.join(uploadCacheDir, hash);
            fs.writeFileSync(filePath, imageBuffer);
            
            // Generate and save preview
            const previewPath = path.join(previewCacheDir, `${hash}.webp`);
            await sharp(imageBuffer)
                .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(previewPath);
            console.log(`📸 Generated cached preview: ${hash}.webp`);
            
            // Add to workspace cache files
            addToWorkspaceArray('cacheFiles', hash, workspaceId);
            
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
            const { image, informationExtraction, model, workspace, cacheFile, id } = message;
            
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
                    encodings: {}
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
                addToWorkspaceArray('vibeImages', filename, workspace);
                
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
                    encodings: {}
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
                addToWorkspaceArray('vibeImages', filename, workspace);
                
            } else if (id) {
                // Add new encoding to existing vibe
                const workspaceData = getWorkspace(workspace);
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
                
                // Update file
                fs.writeFileSync(filePath, JSON.stringify(vibeData, null, 2));
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
                
                res.on('end', () => {
                    const buffer = Buffer.concat(data);
                    
                    if (res.statusCode === 200) {
                        // Return the buffer as base64 string (matches original implementation)
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
                        mtime: stats.mtime.valueOf(),
                        size: stats.size,
                        encodings: encodings,
                        type: vibeData.type === 'base64' ? 'base64' : 'cache',
                        source: vibeData.image,
                        workspaceId: workspaceId
                    });
                } catch (parseError) {
                    console.error(`Error parsing vibe file ${filename}:`, parseError);
                    continue;
                }
            }
        }
        return vibeImageDetails;
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