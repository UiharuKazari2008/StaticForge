const { computeTagSuggestionRankScore } = require('./metadataDatabase');
const geo2city = require('geo2city');
const { WebSocketServer } = require('./websocket');
const {
    handleDirectorGetSessions,
    handleDirectorCreateSession,
    handleDirectorGetSession,
    handleDirectorDeleteSession,
    handleDirectorSendMessage,
    handleDirectorGetMessages,
    handleDirectorRollbackMessage
} = require('./directorHandlers');
const { isImageLarge, matchOriginalResolution } = require('./imageTools');
const { generateImageWebSocket, handleRerollGeneration, expandImage, rerollExpandedImage } = require('./imageGeneration');
const { upscaleImageWebSocket } = require('./imageUpscaling');
const { generateMobilePreviews } = require('./previewUtils');
const { getTimezoneByCoordinates } = require('./dynamicGenerationHandlers');
const path = require('path');
const fs = require('fs');
const crypto = require('crypto');
const sharp = require('sharp');
const https = require('https');

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

// LRU Cache for metadata (per workspace)
class MetadataCache {
    constructor(maxSize = 1000) {
        this.maxSize = maxSize;
        this.workspaceCaches = new Map(); // workspaceId -> Map of filenames
        this.workspaceLastUsed = new Map(); // workspaceId -> last access timestamp
        this.clientWorkspaces = new Map(); // sessionId -> Set of workspaceIds
        this.cleanupInterval = null;
        this.cleanupTimeout = 30 * 60 * 1000; // 30 minutes of inactivity before cleanup
    }

    // Start periodic cleanup of unused workspace caches
    startCleanup() {
        if (this.cleanupInterval) return; // Already started
        
        // Run cleanup every 5 minutes
        this.cleanupInterval = setInterval(() => {
            this.cleanupUnusedWorkspaces();
        }, 5 * 60 * 1000);
    }

    // Stop periodic cleanup
    stopCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }

    // Clean up workspace caches that haven't been used recently
    cleanupUnusedWorkspaces() {
        const now = Date.now();
        const workspacesToRemove = [];

        for (const [workspaceId, lastUsed] of this.workspaceLastUsed.entries()) {
            // Check if any clients are still using this workspace
            let isInUse = false;
            for (const [sessionId, workspaceSet] of this.clientWorkspaces.entries()) {
                if (workspaceSet.has(workspaceId)) {
                    isInUse = true;
                    break;
                }
            }

            // Remove if not in use and hasn't been accessed in cleanupTimeout
            if (!isInUse && (now - lastUsed) > this.cleanupTimeout) {
                workspacesToRemove.push(workspaceId);
            }
        }

        // Remove unused workspace caches
        for (const workspaceId of workspacesToRemove) {
            this.workspaceCaches.delete(workspaceId);
            this.workspaceLastUsed.delete(workspaceId);
            console.log(`🧹 Cleaned up unused metadata cache for workspace: ${workspaceId}`);
        }
    }

    // Track client workspace usage
    trackClientWorkspace(sessionId, workspaceId) {
        if (!this.clientWorkspaces.has(sessionId)) {
            this.clientWorkspaces.set(sessionId, new Set());
        }
        this.clientWorkspaces.get(sessionId).add(workspaceId);
        this.workspaceLastUsed.set(workspaceId, Date.now());
    }

    // Remove client tracking (when client disconnects)
    removeClient(sessionId) {
        const workspaceSet = this.clientWorkspaces.get(sessionId);
        if (workspaceSet) {
            // Note: We don't immediately clear the cache, just remove tracking
            // The periodic cleanup will handle actual cache removal
            this.clientWorkspaces.delete(sessionId);
            console.log(`🧹 Removed client tracking for session: ${sessionId}`);
        }
    }

    // Get cache for a specific workspace
    getWorkspaceCache(workspaceId) {
        if (!this.workspaceCaches.has(workspaceId)) {
            this.workspaceCaches.set(workspaceId, new Map());
        }
        this.workspaceLastUsed.set(workspaceId, Date.now());
        return this.workspaceCaches.get(workspaceId);
    }

    // Get metadata from cache
    get(workspaceId, filename) {
        const workspaceCache = this.getWorkspaceCache(workspaceId);
        if (workspaceCache.has(filename)) {
            const entry = workspaceCache.get(filename);
            entry.lastAccessed = Date.now();
            return entry.metadata;
        }
        return null;
    }

    // Set metadata in cache
    set(workspaceId, filename, metadata) {
        const workspaceCache = this.getWorkspaceCache(workspaceId);
        
        // If cache is full, remove least recently used
        if (workspaceCache.size >= this.maxSize && !workspaceCache.has(filename)) {
            // Find least recently used
            let lruKey = null;
            let lruTime = Infinity;
            for (const [key, entry] of workspaceCache.entries()) {
                if (entry.lastAccessed < lruTime) {
                    lruTime = entry.lastAccessed;
                    lruKey = key;
                }
            }
            if (lruKey) {
                workspaceCache.delete(lruKey);
            }
        }

        workspaceCache.set(filename, {
            metadata: metadata,
            lastAccessed: Date.now()
        });
    }

    // Prefetch multiple files
    async prefetch(workspaceId, filenames, metadataDatabase) {
        const workspaceCache = this.getWorkspaceCache(workspaceId);
        const toFetch = [];
        
        // Check which files need to be fetched
        for (const filename of filenames) {
            if (!workspaceCache.has(filename)) {
                toFetch.push(filename);
            }
        }

        if (toFetch.length === 0) return;

        // Batch fetch metadata
        try {
            const metadata = await metadataDatabase.getMultipleMetadata(toFetch);
            for (const [filename, meta] of Object.entries(metadata)) {
                this.set(workspaceId, filename, meta);
            }
        } catch (error) {
            console.error('Error prefetching metadata:', error);
        }
    }

    // Clear cache for a workspace (when workspace changes or is deleted)
    clearWorkspace(workspaceId) {
        this.workspaceCaches.delete(workspaceId);
        this.workspaceLastUsed.delete(workspaceId);
        
        // Remove from all client tracking
        for (const [sessionId, workspaceSet] of this.clientWorkspaces.entries()) {
            workspaceSet.delete(workspaceId);
        }
        
        console.log(`🧹 Cleared metadata cache for workspace: ${workspaceId}`);
    }
}

// WebSocket message handlers
class WebSocketMessageHandlers {
    constructor(globalResources) {
        this.globalResources = globalResources;
        if (!globalResources) {
            throw new Error('WebSocketMessageHandlers requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.keepAliveIntervals = new Map(); // Store keep-alive intervals by requestId
        this.metadataCache = new MetadataCache(1000); // LRU cache with 1000 items
        this.metadataCache.startCleanup(); // Start periodic cleanup
    }

    // Clean up metadata cache when client disconnects
    cleanupClientCache(sessionId) {
        if (this.metadataCache) {
            this.metadataCache.removeClient(sessionId);
        }
    }

    // Generate UUID for presets
    generateUUID() {
        return crypto.randomUUID();
    }

    // Main message handler
    async handleMessage(ws, message, clientInfo, wsServer) {
        const startTime = Date.now();
        const requestId = message.requestId || 'unknown';

        try {
            // Allow critical messages without authentication
            const isCriticalMessage = message.type && 
                WebSocketServer.CRITICAL_MESSAGE_TYPES.includes(message.type);

            // Check if client is authenticated (unless it's a critical message)
            if ((!clientInfo || !clientInfo.authenticated) && !isCriticalMessage) {
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

            // Log successful completion with timing
            const processingTime = Date.now() - startTime;
        } catch (error) {
            // Log error with timing
            const processingTime = Date.now() - startTime;
            console.error(`❌ WebSocket message failed: ${message.type} (ID: ${requestId}) - ${processingTime}ms - Error:`, error.message);
            wsServer.sendToClient(ws, {
                type: 'error',
                message: 'Internal server error',
                code: 'INTERNAL_ERROR',
                timestamp: new Date().toISOString()
            });
        }
    }

    // IMPORTANT: Add new destructive or security-sensitive operations to this list (Everytime you add a websocket handeler think about security!)
    // This function checks if an operation is destructive (not allowed for read-only users)
    isDestructiveOperation(messageType) {
        const destructiveOperations = [
            'workspace_create',
            'workspace_delete',
            'workspace_rename',
            'workspace_move_files',
            'workspace_add_scrap',
            'workspace_remove_scrap',
            'workspace_bulk_add_scrap',
            'workspace_add_pinned',
            'workspace_remove_pinned',
            'workspace_bulk_add_pinned',
            'workspace_bulk_pinned',
            'workspace_bulk_remove_pinned',
            'workspace_create_group',
            'workspace_rename_group',
            'workspace_delete_group',
            'workspace_add_images_to_group',
            'workspace_remove_images_from_group',
            'workspace_update_color',
            'workspace_update_background_color',
            'workspace_update_background_image',
            'workspace_update_background_opacity',
            'workspace_update_primary_font',
            'workspace_update_textarea_font',
            'workspace_update_settings',
            'workspace_reorder',
            'delete_images_bulk',
            'delete_reference',
            'upload_reference',
            'upload_wallpaper',
            'replace_reference',
            'update_reference_metadata',
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
            'update_preset',
            'delete_preset',
            'regenerate_preset_uuid',
            'save_preset_group',
            'delete_preset_group',
            'save_text_replacements',
            'create_text_replacement',
            'delete_text_replacement',
            'get_text_replacement_options',
            'spellcheck_add_word',
            'generate_image',
            'upscale_image',
            'reroll_image',
            'expand_image',
            'reroll_expanded_image',
            'update_image_preset_bulk',
            'director_create_session',
            'director_delete_session',
            'director_send_message',
            'director_rollback_message',
            'director_save_feedback',
            'director_save_rules',
            'director_delete_feedback',
            'notes_create',
            'notes_update',
            'notes_delete',
            'notes_save_content',
            'rebuild_metadata_cache',
            'delete_knowledge_memory',
            'delete_knowledge_memories_bulk',
            'delete_knowledge_memories_by_filter',
            'update_knowledge_memory',
            'get_api_key_services',
            'update_api_key_selections',
            'add_api_key',
            'delete_api_key',
            'clear_search_cache',
            'desktop_add_shortcut',
            'desktop_update_shortcut',
            'desktop_remove_shortcut',
            'desktop_update_positions',
            'save_persona_settings',
            'create_chat_session',
            'delete_chat_session',
            'restart_chat_session',
            'send_chat_message',
            'update_chat_context',
            'delete_chat_message',
            'unblock_ip',
            'export_ip_to_gateway',
        ];
        return destructiveOperations.includes(messageType);
    }

    // Route messages to appropriate handlers
    async routeMessage(ws, message, clientInfo, wsServer) {
        switch (message.type) {
            case 'lookup_city':
                await this.handleCityLookup(ws, message, clientInfo, wsServer);
                break;

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

            case 'save_preset_group':
                await this.handleSavePresetGroup(ws, message, clientInfo, wsServer);
                break;

            case 'delete_preset_group':
                await this.handleDeletePresetGroup(ws, message, clientInfo, wsServer);
                break;

            case 'get_preset_groups':
                await this.handleGetPresetGroups(ws, message, clientInfo, wsServer);
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

            case 'search_tag_wiki':
                await this.handleSearchTagWiki(ws, message, clientInfo, wsServer);
                break;

            case 'get_tag_wiki_page':
                await this.handleGetTagWikiPage(ws, message, clientInfo, wsServer);
                break;

            case 'refresh_tag_wiki_page':
                await this.handleRefreshTagWikiPage(ws, message, clientInfo, wsServer);
                break;

            case 'search_files':
                await this.handleFileSearch(ws, message, clientInfo, wsServer);
                break;

            case 'search_index_prepare_cache':
                await this.handlePrepareSearchCache(ws, message, clientInfo, wsServer);
                break;

            case 'search_index_clear_cache':
                await this.handleClearSearchCache(ws, message, clientInfo, wsServer);
                break;

            case 'search_index_toggle_pause':
                await this.handleToggleIndexingPause(ws, message, clientInfo, wsServer);
                break;

            case 'search_index_trigger':
                await this.handleTriggerIndexing(ws, message, clientInfo, wsServer);
                break;

            case 'search_index_rebuild_all':
                await this.handleRebuildAllIndexes(ws, message, clientInfo, wsServer);
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

            // Reference metadata handlers
            case 'update_reference_metadata':
                await this.handleUpdateReferenceMetadata(ws, message, clientInfo, wsServer);
                break;

            // Text replacement management handlers
            case 'get_text_replacements':
                await this.handleGetTextReplacements(ws, message, clientInfo, wsServer);
                break;

            case 'save_text_replacements':
                await this.handleSaveTextReplacements(ws, message, clientInfo, wsServer);
                break;

            case 'get_text_replacement_options':
                await this.handleGetTextReplacementOptions(ws, message, clientInfo, wsServer);
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

            case 'get_system_info':
                await this.handleGetSystemInfo(ws, message, clientInfo, wsServer);
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

            case 'desktop_get_settings':
                await this.handleDesktopGetSettings(ws, message, clientInfo, wsServer);
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

            case 'workspace_update_window_positions':
                await this.handleWorkspaceUpdateWindowPositions(ws, message, clientInfo, wsServer);
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

            // Desktop shortcuts
            case 'desktop_get_shortcuts':
                await this.handleDesktopGetShortcuts(ws, message, clientInfo, wsServer);
                break;

            case 'desktop_add_shortcut':
                await this.handleDesktopAddShortcut(ws, message, clientInfo, wsServer);
                break;

            case 'desktop_update_shortcut':
                await this.handleDesktopUpdateShortcut(ws, message, clientInfo, wsServer);
                break;

            case 'desktop_remove_shortcut':
                await this.handleDesktopRemoveShortcut(ws, message, clientInfo, wsServer);
                break;

            case 'desktop_update_positions':
                await this.handleDesktopUpdatePositions(ws, message, clientInfo, wsServer);
                break;

            // Notes operations
            case 'notes_create':
                await this.handleNotesCreate(ws, message, clientInfo, wsServer);
                break;

            case 'notes_get':
                await this.handleNotesGet(ws, message, clientInfo, wsServer);
                break;

            case 'notes_get_by_workspace':
                await this.handleNotesGetByWorkspace(ws, message, clientInfo, wsServer);
                break;

            case 'notes_get_all':
                await this.handleNotesGetAll(ws, message, clientInfo, wsServer);
                break;

            case 'notes_get_all_metadata':
                await this.handleNotesGetAllMetadata(ws, message, clientInfo, wsServer);
                break;

            case 'notes_update':
                await this.handleNotesUpdate(ws, message, clientInfo, wsServer);
                break;

            case 'notes_delete':
                await this.handleNotesDelete(ws, message, clientInfo, wsServer);
                break;

            case 'notes_save_content':
                await this.handleNotesSaveContent(ws, message, clientInfo, wsServer);
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

            case 'upload_wallpaper':
                await this.handleUploadWallpaper(ws, message, clientInfo, wsServer);
                break;

            case 'replace_reference':
                await this.handleReplaceReference(ws, message, clientInfo, wsServer);
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

            case 'pong':
                // Pong is handled automatically by the client, but we can acknowledge it
                wsServer.sendToClient(ws, {
                    type: 'pong',
                    requestId: message.requestId,
                    timestamp: new Date().toISOString()
                });
                break;

            case 'server_status':
                await this.handleServerStatus(ws, message, clientInfo, wsServer);
                break;

            case 'check_updates':
                await this.handleCheckUpdates(ws, message, clientInfo, wsServer);
                break;

            case 'version_check':
                await this.handleVersionCheck(ws, message, clientInfo, wsServer);
                break;

            case 'generate_image':
                await this.handleImageGeneration(ws, message, clientInfo, wsServer);
                break;

            case 'reroll_image':
                await this.handleImageReroll(ws, message, clientInfo, wsServer);
                break;

            case 'upscale_image':
                await this.handleImageUpscaling(ws, message, clientInfo, wsServer);
                break;

            case 'expand_image':
                await this.handleImageExpansion(ws, message, clientInfo, wsServer);
                break;

            case 'reroll_expanded_image':
                await this.handleImageExpansionReroll(ws, message, clientInfo, wsServer);
                break;

            case 'get_cache_manifest':
                await this.handleGetCacheManifest(ws, message, clientInfo, wsServer);
                break;

            case 'refresh_server_cache':
                await this.handleRefreshServerCache(ws, message, clientInfo, wsServer);
                break;

            case 'rebuild_metadata_cache':
                await this.handleRebuildMetadataCache(ws, message, clientInfo, wsServer);
                break;

            case 'clear_search_cache':
                await this.handleClearSearchCache(ws, message, clientInfo, wsServer);
                break;

            case 'broadcast_resource_update':
                await this.handleBroadcastResourceUpdate(ws, message, clientInfo, wsServer);
                break;

            // Chat system handlers
            case 'get_persona_settings':
                await this.handleGetPersonaSettings(ws, message, clientInfo, wsServer);
                break;

            case 'save_persona_settings':
                await this.handleSavePersonaSettings(ws, message, clientInfo, wsServer);
                break;

            case 'create_chat_session':
                await this.handleCreateChatSession(ws, message, clientInfo, wsServer);
                break;

            case 'get_chat_sessions':
                await this.handleGetChatSessions(ws, message, clientInfo, wsServer);
                break;

            case 'get_chat_session':
                await this.handleGetChatSession(ws, message, clientInfo, wsServer);
                break;

            case 'delete_chat_session':
                await this.handleDeleteChatSession(ws, message, clientInfo, wsServer);
                break;

            case 'restart_chat_session':
                await this.handleRestartChatSession(ws, message, clientInfo, wsServer);
                break;

            case 'send_chat_message':
                await this.handleSendChatMessage(ws, message, clientInfo, wsServer);
                break;

            case 'update_chat_context':
                await this.handleUpdateChatContext(ws, message, clientInfo, wsServer);
                break;

            case 'get_chat_messages':
                await this.handleGetChatMessages(ws, message, clientInfo, wsServer);
                break;
            case 'delete_chat_message':
                await this.handleDeleteChatMessage(ws, message, clientInfo, wsServer);
                break;

            case 'cancel_generation':
                await this.handleCancelGeneration(ws, message, clientInfo, wsServer);
                break;

            // Director handlers
            case 'director_get_sessions':
                await handleDirectorGetSessions(this, ws, message, clientInfo, wsServer);
                break;

            case 'director_create_session':
                await handleDirectorCreateSession(this, ws, message, clientInfo, wsServer);
                break;

            case 'director_get_session':
                await handleDirectorGetSession(this, ws, message, clientInfo, wsServer);
                break;

            case 'director_delete_session':
                await handleDirectorDeleteSession(this, ws, message, clientInfo, wsServer);
                break;

            case 'director_send_message':
                await handleDirectorSendMessage(this, ws, message, clientInfo, wsServer);
                break;

            case 'director_get_messages':
                await handleDirectorGetMessages(this, ws, message, clientInfo, wsServer);
                break;

            case 'director_rollback_message':
                await handleDirectorRollbackMessage(this, ws, message, clientInfo, wsServer);
                break;

            case 'director_save_feedback':
                await this.handleDirectorSaveFeedback(ws, message, clientInfo, wsServer);
                break;

            case 'director_load_rules':
                await this.handleDirectorLoadRules(ws, message, clientInfo, wsServer);
                break;

            case 'director_save_rules':
                await this.handleDirectorSaveRules(ws, message, clientInfo, wsServer);
                break;

            case 'director_load_feedback':
                await this.handleDirectorLoadFeedback(ws, message, clientInfo, wsServer);
                break;

            case 'director_delete_feedback':
                await this.handleDirectorDeleteFeedback(ws, message, clientInfo, wsServer);
                break;

            // Dynamic Generation Progress handlers
            case 'dynamic_generation_progress':
                await this.handleDynamicGenerationProgress(ws, message, clientInfo, wsServer);
                break;

            case 'resolve_dynamic_context':
                await this.handleResolveDynamicContext(ws, message, clientInfo, wsServer);
                break;

            // IP Management handlers
            case 'get_blocked_ips':
                await this.handleGetBlockedIPs(ws, message, clientInfo, wsServer);
                break;

            case 'unblock_ip':
                await this.handleUnblockIP(ws, message, clientInfo, wsServer);
                break;

            case 'export_ip_to_gateway':
                await this.handleExportIPToGateway(ws, message, clientInfo, wsServer);
                break;

            case 'get_ip_blocking_reasons':
                await this.handleGetIPBlockingReasons(ws, message, clientInfo, wsServer);
                break;

            // API Key management
            case 'get_api_key_services':
                await this.handleGetApiKeyServices(ws, message, clientInfo, wsServer);
                break;

            case 'update_api_key_selections':
                await this.handleUpdateApiKeySelections(ws, message, clientInfo, wsServer);
                break;
            case 'add_api_key':
                await this.handleAddApiKey(ws, message, clientInfo, wsServer);
                break;

            // Knowledge Memory handlers
            case 'list_knowledge_memories':
                await this.handleListKnowledgeMemories(ws, message, clientInfo, wsServer);
                break;

            case 'get_knowledge_memory':
                await this.handleGetKnowledgeMemory(ws, message, clientInfo, wsServer);
                break;

            case 'delete_knowledge_memory':
                await this.handleDeleteKnowledgeMemory(ws, message, clientInfo, wsServer);
                break;

            case 'delete_knowledge_memories_bulk':
                await this.handleDeleteKnowledgeMemoriesBulk(ws, message, clientInfo, wsServer);
                break;

            case 'count_knowledge_memories_by_filter':
                await this.handleCountKnowledgeMemoriesByFilter(ws, message, clientInfo, wsServer);
                break;

            case 'delete_knowledge_memories_by_filter':
                await this.handleDeleteKnowledgeMemoriesByFilter(ws, message, clientInfo, wsServer);
                break;

            case 'update_knowledge_memory':
                await this.handleUpdateKnowledgeMemory(ws, message, clientInfo, wsServer);
                break;

            default:
                this.sendError(ws, 'Unknown message type', message.type);
        }
    }

    // CITY LOOKUP HANDLER
    async handleCityLookup(ws, message, clientInfo, wsServer) {
        const { cityName, requestId } = message;

        if (!cityName || typeof cityName !== 'string') {
            this.sendError(ws, 'Missing or invalid cityName parameter', 'lookup_city', requestId);
            return;
        }

        const trimmedCityName = cityName.trim();
        if (!trimmedCityName) {
            this.sendError(ws, 'City name cannot be empty', 'lookup_city', requestId);
            return;
        }

        try {
            // Search for the city coordinates
            const coordinates = await geo2city.search(trimmedCityName);

            if (coordinates && coordinates.length === 2) {
                const [latitude, longitude] = coordinates;

                // Try to get additional location data by reverse geocoding
                let locationData = {};
                try {
                    const reverseResult = await geo2city.reverse([latitude, longitude]);
                    if (reverseResult) {
                        locationData = {
                            city: reverseResult.city || trimmedCityName,
                            state: reverseResult.city ? '' : '', // State info might not be available
                            country: reverseResult.country || '',
                            latitude: reverseResult.latitude,
                            longitude: reverseResult.longitude,
                            timezone: getTimezoneByCoordinates(latitude, longitude)
                        };
                    } else {
                        // Reverse geocoding returned null/undefined
                        locationData = {
                            city: trimmedCityName,
                            state: '',
                            country: '',
                            latitude: latitude,
                            longitude: longitude,
                            timezone: getTimezoneByCoordinates(latitude, longitude)
                        };
                    }
                } catch (reverseError) {
                    console.warn('Reverse geocoding failed, using basic coordinates:', reverseError.message);
                    locationData = {
                        city: trimmedCityName,
                        state: '',
                        country: '',
                        latitude: latitude,
                        longitude: longitude,
                        timezone: getTimezoneByCoordinates(latitude, longitude)
                    };
                }

                // Send success response
                this.sendToClient(ws, {
                    type: 'lookup_city_response',
                    data: locationData,
                    timestamp: new Date().toISOString(),
                    requestId: requestId
                });
            } else {
                // City not found
                this.sendError(ws, 'City not found', 'lookup_city', requestId);
            }
        } catch (error) {
            console.error('City lookup error:', error);
            this.sendError(ws, 'Failed to lookup city: ' + error.message, 'lookup_city', requestId);
        }
    }

    // Handle character search requests - Ack-less Latest Request Wins Pattern
    async handleCharacterSearch(ws, message, clientInfo, wsServer) {
        const { query, model, requestId } = message;

        if (!query) {
            this.sendError(ws, 'Missing query parameter', 'search_characters');
            return;
        }

        try {
            // Send initial response to show autocomplete dropdown (ack-less)
            this.sendToClient(ws, {
                type: 'search_characters_response',
                data: { results: [], spellCheck: null },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

            // Perform search with latest-request-wins pattern
            const result = await this.globalResources.getSearchService().searchCharacters(query, model, ws, clientInfo.sessionId, null, requestId);

            // Send final complete response (ack-less)
            this.sendToClient(ws, {
                type: 'search_characters_complete',
                data: result,
                timestamp: new Date().toISOString(),
                requestId: requestId
            });
        } catch (error) {
            // Only log errors that aren't cancellation
            if (error.name !== 'AbortError' && !error.message.includes('superseded')) {
                console.error('Character search error:', error);
                this.sendError(ws, 'Search failed', error.message);
            }
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
            const result = await this.globalResources.getSearchService().searchPresets(query);

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
        const { presetName, presetUuid } = message;

        if (!presetName && !presetUuid) {
            this.sendError(ws, 'Missing presetName or presetUuid parameter', 'load_preset');
            return;
        }

        try {
            const currentPromptConfig = this.globalResources.getPromptConfig();
            let preset, actualPresetName;

            if (presetUuid) {
                // Try to resolve by UUID (supports both presets and chapters)
                const resolution = this.globalResources.textReplacements.resolvePresetOrGroup(presetUuid);
                if (!resolution) {
                    this.sendError(ws, 'Preset or preset group not found', `Preset or preset group with UUID "${presetUuid}" does not exist`, message.requestId);
                    return;
                }
                preset = resolution.preset;
                actualPresetName = resolution.presetName;
            } else {
                // Legacy behavior - load by name
                preset = currentPromptConfig.presets[presetName];
                if (!preset) {
                    this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                    return;
                }
                actualPresetName = presetName;
            }

            // Return the raw preset data without processing text replacements
            const presetData = {
                ...preset,
                preset_name: actualPresetName,
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
            const existingPreset = this.globalResources.getPromptConfig({ path: ['presets', presetName] });

            // Preserve existing UUID if preset exists, otherwise generate new one
            if (!config.uuid) {
                config.uuid = existingPreset?.uuid || this.generateUUID();
            }

            // Preserve existing target_workspace if present, otherwise set to current active workspace
            if (existingPreset?.target_workspace) {
                config.target_workspace = existingPreset.target_workspace;
            } else if (!config.target_workspace || config.target_workspace === 'default') {
                // Set target workspace to current active workspace if not set or is default
                const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
                config.target_workspace = activeWorkspaceId;
            }

            const success = this.globalResources.modifyConfig('promptConfig').assign(['presets', presetName], config);
            if (success) {
                console.log(`💾 Saved new preset: ${presetName}`);
            } else {
                throw new Error('Failed to save preset configuration');
            }

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
            const presets = this.globalResources.getPromptConfig({ path: 'presets' }) || {};

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
            const existingPreset = this.globalResources.getPromptConfig({ path: ['presets', presetName], clone: true });

            if (!existingPreset) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }

            // Build update fields
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            const updates = {};

            if (name !== undefined) updates.name = name;
            if (target_workspace !== undefined) {
                updates.target_workspace = target_workspace;
            } else if (!existingPreset.target_workspace || existingPreset.target_workspace === 'default') {
                updates.target_workspace = activeWorkspaceId;
            }
            if (resolution !== undefined) updates.resolution = resolution;
            if (request_upscale !== undefined) updates.request_upscale = request_upscale;

            // Update preset
            let success;
            if (name && name !== presetName) {
                const newPreset = { ...existingPreset, ...updates };
                success = this.globalResources.modifyConfig('promptConfig', (cfg) => {
                    delete cfg.presets[presetName];
                    cfg.presets[name] = newPreset;
                    return cfg;
                });
            } else {
                // Just merge updates
                success = this.globalResources.modifyConfig('promptConfig').merge(['presets', presetName], updates);
            }
            if (success) {
                console.log(`💾 Updated preset: ${presetName} -> ${name} with UUID: ${uuid}`);
            } else {
                throw new Error('Failed to update preset configuration');
            }

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
            const currentPromptConfig = this.globalResources.getPromptConfig();
            if (!currentPromptConfig.presets[presetName]) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }

            // Generate new UUID
            const newUuid = this.generateUUID();

            const success = this.globalResources.modifyConfig('promptConfig').assign(['presets', presetName, 'uuid'], newUuid);
            if (success) {
                console.log(`🔄 Regenerated UUID for preset: ${presetName} -> ${newUuid}`);
            } else {
                throw new Error('Failed to save preset configuration');
            }

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

    // Handle save preset group requests
    async handleSavePresetGroup(ws, message, clientInfo, wsServer) {
        const { groupName, groupData } = message;

        if (!groupName || !groupData) {
            this.sendError(ws, 'Missing required parameters', 'Group name and data are required', message.requestId);
            return;
        }

        try {
            const currentPromptConfig = this.globalResources.getPromptConfig();

            // Preserve existing UUID if group exists, otherwise generate new one
            if (!groupData.uuid) {
                if (currentPromptConfig.preset_group?.[groupName]?.uuid) {
                    groupData.uuid = currentPromptConfig.preset_group[groupName].uuid;
                } else {
                    groupData.uuid = this.generateUUID();
                }
            }

            // Ensure name is set
            if (!groupData.name) {
                groupData.name = groupName;
            }

            // Ensure presets array exists
            if (!groupData.presets) {
                groupData.presets = [];
            }

            // Validate that all referenced presets exist
            const validPresets = groupData.presets.filter(presetUuid => {
                const presetExists = Object.values(currentPromptConfig.presets || {}).some(preset => preset.uuid === presetUuid);
                if (!presetExists) {
                    console.warn(`⚠️ Preset group "${groupName}" references non-existent preset UUID: ${presetUuid}`);
                }
                return presetExists;
            });

            groupData.presets = validPresets;

            const success = this.globalResources.modifyConfig('promptConfig').assign(['preset_group', groupName], groupData);
            if (success) {
                console.log(`💾 Saved preset group: ${groupName}`);
            } else {
                throw new Error('Failed to save preset group configuration');
            }

            this.sendToClient(ws, {
                type: 'save_preset_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Preset group "${groupName}" saved successfully` },
                timestamp: new Date().toISOString()
            });

            // Broadcast preset group update to all connected clients
            wsServer.clients.forEach(client => {
                if (client.readyState === 1) {
                    this.sendToClient(client, {
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
            this.sendError(ws, 'Failed to save preset group', error.message, message.requestId);
        }
    }

    // Handle delete preset group requests
    async handleDeletePresetGroup(ws, message, clientInfo, wsServer) {
        const { groupName } = message;

        if (!groupName) {
            this.sendError(ws, 'Missing groupName parameter', 'delete_preset_group');
            return;
        }

        try {
            const presetGroup = this.globalResources.getPromptConfig({ path: ['preset_group', groupName] });

            if (!presetGroup) {
                this.sendError(ws, 'Preset group not found', `Preset group "${groupName}" does not exist`, message.requestId);
                return;
            }

            const success = this.globalResources.modifyConfig('promptConfig').delete(['preset_group', groupName]);
            if (success) {
                console.log(`🗑️ Deleted preset group: ${groupName}`);
            } else {
                throw new Error('Failed to save preset group configuration');
            }

            this.sendToClient(ws, {
                type: 'delete_preset_group_response',
                requestId: message.requestId,
                data: { success: true, message: `Preset group "${groupName}" deleted successfully` },
                timestamp: new Date().toISOString()
            });

            // Broadcast preset group deletion to all connected clients
            wsServer.clients.forEach(client => {
                if (client.readyState === 1) {
                    this.sendToClient(client, {
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
            this.sendError(ws, 'Failed to delete preset group', error.message, message.requestId);
        }
    }

    // Handle get preset groups requests
    async handleGetPresetGroups(ws, message, clientInfo, wsServer) {
        try {
            const presetGroups = this.globalResources.getPromptConfig({ path: 'preset_group' }) || {};

            // Convert to array format with preset counts
            const groupsArray = Object.entries(presetGroups).map(([groupName, groupData]) => ({
                name: groupName,
                uuid: groupData.uuid,
                displayName: groupData.name || groupName,
                presetCount: groupData.presets ? groupData.presets.length : 0,
                presets: groupData.presets || []
            }));

            this.sendToClient(ws, {
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
            this.sendError(ws, 'Failed to get preset groups', error.message, message.requestId);
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
            const preset = this.globalResources.getPromptConfig({ path: ['presets', presetName] });

            if (!preset) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }

            const success = this.globalResources.modifyConfig('promptConfig').delete(['presets', presetName]);
            if (success) {
                console.log(`🗑️ Deleted preset: ${presetName}`);
            } else {
                throw new Error('Failed to save preset configuration');
            }

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
        const { presetName, allow_paid, workspace, enableStreaming } = message;

        if (!presetName) {
            this.sendError(ws, 'Missing presetName parameter', 'generate_preset');
            return;
        }

        try {
            const preset = this.globalResources.getPromptConfig({ path: ['presets', presetName] });

            if (!preset) {
                this.sendError(ws, 'Preset not found', `Preset "${presetName}" does not exist`, message.requestId);
                return;
            }

            // Use target_workspace from preset if no workspace specified (for REST API calls)
            const targetWorkspace = workspace || (preset.target_workspace && preset.target_workspace !== 'default' ? preset.target_workspace : this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId));

            let streamingCallback = null;
            if (enableStreaming) {
                console.log('🎬 Starting streaming preset generation...');
                // Create callback to send intermediate images via websocket
                streamingCallback = async (event) => {
                    if (event.type === 'intermediate') {
                        // Send intermediate image update
                        /* this.sendToClient(ws, {
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

            // Generate image using the preset
            const result = await generateImageWebSocket({
                ...preset,
                workspace: targetWorkspace,
                presetName: presetName,
                allow_paid: allow_paid
            }, clientInfo.userType, clientInfo.sessionId, streamingCallback, ws, this, wsServer);

            // Send generation response
            this.sendToClient(ws, {
                type: 'generate_preset_response',
                requestId: message.requestId,
                data: {
                    filename: result.filename,
                    seed: result.seed,
                    saved: result.saved,
                    presetName: presetName,
                    workspace: targetWorkspace,
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
            const result = await this.globalResources.getDatasetTagService().searchDatasetTags(query, path);
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
            const tags = await this.globalResources.getDatasetTagService().getTagsForPath(path);
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
            const results = await this.globalResources.getDatasetTagService().searchTags(query, single_match);
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

    // Handle tag wiki search requests
    async handleSearchTagWiki(ws, message, clientInfo, wsServer) {
        const { query, category, searchType = 'name', source = 'both', includeNonTag = false, limit = 50 } = message;

        if (!query) {
            this.sendError(ws, 'Missing query parameter', 'search_tag_wiki', message.requestId);
            return;
        }

        try {
            const tagLookup = this.globalResources.getTagDatabase();
            if (!tagLookup) {
                throw new Error('Tag lookup service not available');
            }

            let results = [];

            if (searchType === 'description') {
                // Search by description
                const searchResults = await tagLookup.handleSearchByDescription({
                    description: query,
                    category: category !== undefined ? category : undefined,
                    limit: limit
                }, {});

                results = searchResults.json || [];
            } else {
                // Search by name
                const searchOptions = {
                    category: category !== undefined ? category : undefined,
                    limit: limit
                };

                const searchResults = await tagLookup.searchTags(query, searchOptions);
                results = searchResults || [];
            }

            // Filter by source if needed
            if (source !== 'both') {
                results = results.filter(tag => {
                    const wikiSources = tag.wikiSources || [];
                    return wikiSources.includes(source);
                });
            }

            // Include non-tag results if requested
            if (includeNonTag) {
                // Note: Non-tag results would require direct database access
                // This feature can be implemented later if needed
            }

            // Project results to include only needed fields
            const projectedResults = results.map(tag => ({
                id: tag.id,
                title: tag.title || tag.name,
                name: tag.name || tag.title,
                category: tag.category,
                categoryName: tag.categoryName || 'Uncategorized',
                source: tag.wikiSources || [],
                hasWiki: tag.hasWiki || false
            }));

            this.sendToClient(ws, {
                type: 'search_tag_wiki_response',
                requestId: message.requestId,
                data: { results: projectedResults },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Search tag wiki error:', error);
            this.sendError(ws, 'Failed to search tag wiki', error.message, message.requestId);
        }
    }

    // Handle get tag wiki page requests
    async handleGetTagWikiPage(ws, message, clientInfo, wsServer) {
        console.log(`[Wiki Handler] handleGetTagWikiPage called with tagName="${message.tagName}", source="${message.source}"`);
        
        const { tagName, source, format = 'html' } = message;

        if (!tagName) {
            this.sendError(ws, 'Missing tagName parameter', 'get_tag_wiki_page', message.requestId);
            return;
        }

        try {
            const tagLookup = this.globalResources.getTagDatabase();
            if (!tagLookup) {
                throw new Error('Tag lookup service not available');
            }

            // Get tag directly
            let tag = await tagLookup.findTagExact(tagName);

            const SOURCE_DANBOORU = 1;
            const SOURCE_E621 = 2;

            // If source is 'both' or not specified, get all bodies
            if (source === 'both' || !source) {
                let danbooruBody = null;
                let e621Body = null;
                let danbooruFetchedOnline = false;
                let e621FetchedOnline = false;
                let danbooruWikiId = null;
                let e621WikiId = null;
                
                // Try to get from database
                if (tag) {
                    // Tag exists - query by tag ID
                    const danbooruResult = await tagLookup.getTagWikiBody(tag.id, SOURCE_DANBOORU);
                    const e621Result = await tagLookup.getTagWikiBody(tag.id, SOURCE_E621);
                    
                    if (danbooruResult) {
                        danbooruBody = danbooruResult.body || danbooruResult;
                        danbooruFetchedOnline = danbooruResult.fetchedOnline || false;
                    }
                    if (e621Result) {
                        e621Body = e621Result.body || e621Result;
                        e621FetchedOnline = e621Result.fetchedOnline || false;
                    }
                } else {
                    // Tag doesn't exist - query wikis directly by title
                    const normalizedTitle = tagName.replace(/_/g, ' ').toLowerCase();
                    const danbooruResult = await tagLookup.getWikiByTitleAndSource(normalizedTitle, SOURCE_DANBOORU);
                    const e621Result = await tagLookup.getWikiByTitleAndSource(normalizedTitle, SOURCE_E621);
                    
                    if (danbooruResult) {
                        danbooruBody = danbooruResult.body;
                        danbooruFetchedOnline = danbooruResult.fetchedOnline || false;
                        danbooruWikiId = danbooruResult.wikiId;
                    }
                    if (e621Result) {
                        e621Body = e621Result.body;
                        e621FetchedOnline = e621Result.fetchedOnline || false;
                        e621WikiId = e621Result.wikiId;
                    }
                }

                // Fetch from API if not found in database (or if tag doesn't exist)
                if (!danbooruBody) {
                    const fetched = await tagLookup.fetchAndSaveWikiForTag(tag ? tag.id : null, tag ? (tag.title || tagName) : tagName, SOURCE_DANBOORU);
                    if (fetched.body) {
                        danbooruBody = fetched.body;
                        danbooruFetchedOnline = fetched.fetchedOnline || false;
                    }
                }
                if (!e621Body) {
                    const fetched = await tagLookup.fetchAndSaveWikiForTag(tag ? tag.id : null, tag ? (tag.title || tagName) : tagName, SOURCE_E621);
                    if (fetched.body) {
                        e621Body = fetched.body;
                        e621FetchedOnline = fetched.fetchedOnline || false;
                    }
                }

                const bodies = [];
                // Get wikiIds for content links lookup
                if (tag) {
                    // Tag exists - get wiki IDs from tag-wiki links
                    if (!danbooruWikiId) {
                        const danbooruWikiIdResult = await tagLookup.getWikiIdForTag(tag.id, SOURCE_DANBOORU);
                        if (danbooruWikiIdResult) {
                            danbooruWikiId = danbooruWikiIdResult.id || danbooruWikiIdResult;
                            if (!danbooruFetchedOnline) {
                                danbooruFetchedOnline = danbooruWikiIdResult.fetchedOnline || false;
                            }
                        }
                    }
                    if (!e621WikiId) {
                        const e621WikiIdResult = await tagLookup.getWikiIdForTag(tag.id, SOURCE_E621);
                        if (e621WikiIdResult) {
                            e621WikiId = e621WikiIdResult.id || e621WikiIdResult;
                            if (!e621FetchedOnline) {
                                e621FetchedOnline = e621WikiIdResult.fetchedOnline || false;
                            }
                        }
                    }

                    // If we just fetched, get the wiki ID
                    if (danbooruBody && !danbooruWikiId) {
                        const result = await tagLookup.getWikiIdForTag(tag.id, SOURCE_DANBOORU);
                        if (result) {
                            danbooruWikiId = result.id || result;
                            danbooruFetchedOnline = result.fetchedOnline || false;
                        }
                    }
                    if (e621Body && !e621WikiId) {
                        const result = await tagLookup.getWikiIdForTag(tag.id, SOURCE_E621);
                        if (result) {
                            e621WikiId = result.id || result;
                            e621FetchedOnline = result.fetchedOnline || false;
                        }
                    }
                } else {
                    // Tag doesn't exist - wiki IDs should already be set from getWikiByTitleAndSource
                    // If we just fetched, get the wiki ID from the fetched result
                    if (danbooruBody && !danbooruWikiId) {
                        const normalizedTitle = tagName.replace(/_/g, ' ').toLowerCase();
                        const result = await tagLookup.getWikiByTitleAndSource(normalizedTitle, SOURCE_DANBOORU);
                        if (result) {
                            danbooruWikiId = result.wikiId;
                        }
                    }
                    if (e621Body && !e621WikiId) {
                        const normalizedTitle = tagName.replace(/_/g, ' ').toLowerCase();
                        const result = await tagLookup.getWikiByTitleAndSource(normalizedTitle, SOURCE_E621);
                        if (result) {
                            e621WikiId = result.wikiId;
                        }
                    }
                }

                if (danbooruBody) {
                    bodies.push({
                        source: 'danbooru',
                        html: format === 'html' ? await this.convertWikiMarkupToHtml(danbooruBody, danbooruWikiId, SOURCE_DANBOORU) : tagLookup.convertWikiMarkupToMarkdown(danbooruBody),
                        fetchedOnline: danbooruFetchedOnline
                    });
                }
                if (e621Body) {
                    bodies.push({
                        source: 'e621',
                        html: format === 'html' ? await this.convertWikiMarkupToHtml(e621Body, e621WikiId, SOURCE_E621) : tagLookup.convertWikiMarkupToMarkdown(e621Body),
                        fetchedOnline: e621FetchedOnline
                    });
                }

                if (bodies.length === 0) {
                    this.sendToClient(ws, {
                        type: 'get_tag_wiki_page_response',
                        requestId: message.requestId,
                        data: { error: `Tag "${tagName}" has no wiki body` },
                        timestamp: new Date().toISOString()
                    });
                    return;
                }

                this.sendToClient(ws, {
                    type: 'get_tag_wiki_page_response',
                    requestId: message.requestId,
                    data: {
                        tagName: tag ? (tag.title || tagName) : tagName,
                        bodies: bodies,
                        bodySource: 'both',
                        fetchedOnline: danbooruFetchedOnline || e621FetchedOnline
                    },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Single source requested
            let sourceId = SOURCE_DANBOORU;
            if (source === 'e621') {
                sourceId = SOURCE_E621;
            }

            let bodyText = null;
            let fetchedOnline = false;
            // Only try to get from database if tag exists
            if (tag) {
                const bodyResult = await tagLookup.getTagWikiBody(tag.id, sourceId);
                if (bodyResult) {
                    bodyText = bodyResult.body || bodyResult;
                    fetchedOnline = bodyResult.fetchedOnline || false;
                }
            }
                        
            // Fetch from API if not found in database (or if tag doesn't exist)
            if (!bodyText) {
                const fetched = await tagLookup.fetchAndSaveWikiForTag(tag ? tag.id : null, tag ? (tag.title || tagName) : tagName, sourceId);
                if (fetched.body) {
                    bodyText = fetched.body;
                    fetchedOnline = fetched.fetchedOnline || false;
                }
            }
            
            if (!bodyText) {
                this.sendToClient(ws, {
                    type: 'get_tag_wiki_page_response',
                    requestId: message.requestId,
                    data: { error: `Tag "${tagName}" has no wiki body for source "${source}"` },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Get wikiId for content links lookup (only if tag exists)
            let wikiId = null;
            if (tag) {
                const wikiIdResult = await tagLookup.getWikiIdForTag(tag.id, sourceId);
                if (wikiIdResult) {
                    wikiId = wikiIdResult.id || wikiIdResult;
                    if (!fetchedOnline) {
                        fetchedOnline = wikiIdResult.fetchedOnline || false;
                    }
                }
                
                // If we just fetched, get the wiki ID
                if (bodyText && !wikiId) {
                    const result = await tagLookup.getWikiIdForTag(tag.id, sourceId);
                    if (result) {
                        wikiId = result.id || result;
                        fetchedOnline = result.fetchedOnline || false;
                    }
                }
            }

            // Convert wiki markup directly to HTML
            const html = format === 'html'
                ? await this.convertWikiMarkupToHtml(bodyText, wikiId, sourceId)
                : tagLookup.convertWikiMarkupToMarkdown(bodyText);

            this.sendToClient(ws, {
                type: 'get_tag_wiki_page_response',
                requestId: message.requestId,
                data: {
                    tagName: tag ? (tag.title || tagName) : tagName,
                    html: html,
                    bodySource: source,
                    fetchedOnline: fetchedOnline
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('[Wiki Handler] Get tag wiki page error:', error);
            console.error('[Wiki Handler] Error stack:', error.stack);
            this.sendError(ws, 'Failed to get tag wiki page', error.message, message.requestId);
        }
    }

    async handleRefreshTagWikiPage(ws, message, clientInfo, wsServer) {
        const { tagName, source, format = 'html', force = false } = message;

        if (!tagName) {
            this.sendError(ws, 'Missing tagName parameter', 'refresh_tag_wiki_page', message.requestId);
            return;
        }

        try {
            const tagLookup = this.globalResources.getTagDatabase();
            if (!tagLookup) {
                throw new Error('Tag lookup service not available');
            }

            // Clear failed fetch cache if forcing refresh
            if (force) {
                const SOURCE_DANBOORU = 1;
                const SOURCE_E621 = 2;
                let sourceId = source === 'e621' ? SOURCE_E621 : SOURCE_DANBOORU;
                if (source === 'both' || !source) {
                    // Clear both
                    await tagLookup.clearFailedFetchCache(`${tagName}|${SOURCE_DANBOORU}`);
                    await tagLookup.clearFailedFetchCache(`${tagName}|${SOURCE_E621}`);
                } else {
                    await tagLookup.clearFailedFetchCache(`${tagName}|${sourceId}`);
                }
            }

            // Use the same handler as get_tag_wiki_page
            await this.handleGetTagWikiPage(ws, message, clientInfo, wsServer);
        } catch (error) {
            console.error('[Wiki Handler] Refresh tag wiki page error:', error);
            this.sendError(ws, 'Failed to refresh tag wiki page', error.message, message.requestId);
        }
    }

    // Convert wiki markup directly to HTML
    async convertWikiMarkupToHtml(wikiText, wikiId = null, sourceId = null) {
        if (!wikiText) return '';

        // Try to use polymorphic module (Ruby dtext_rb parser) via globalResources
        // This ensures 100% compatibility with Danbooru's DText implementation
        if (this.globalResources && this.globalResources.parseDText) {
            try {
                // Determine source string and base URL from sourceId
                let source = 'danbooru'; // default
                let baseUrl = 'https://danbooru.donmai.us';
                const SOURCE_DANBOORU = 1;
                const SOURCE_E621 = 2;
                if (sourceId === SOURCE_E621) {
                    source = 'e621';
                    baseUrl = 'https://e621.net';
                } else if (sourceId === SOURCE_DANBOORU) {
                    source = 'danbooru';
                    baseUrl = 'https://danbooru.donmai.us';
                }

                const rubyResult = await this.globalResources.parseDText(wikiText, source, baseUrl);
                if (rubyResult) {
                    // Post-process the HTML to add our custom classes and attributes
                    return this.postProcessWikiHtml(rubyResult);
                }
            } catch (error) {
                // Log error details for debugging
                console.error('Polymorphic dtext parser failed:', error.message);
                console.error('Error stack:', error.stack);
                console.error('Wiki text length:', wikiText ? wikiText.length : 0);
                console.error('Source ID:', sourceId);
                // Silently fall through to JavaScript implementation
                console.warn('Using JavaScript fallback for wiki markup');
            }
        }
        return wikiText;
    }

    // Post-process HTML from dtext parser to add custom classes and attributes
    // Most processing is now done in Ruby, but we keep this for any edge cases
    postProcessWikiHtml(html) {
        if (!html || typeof html !== 'string') return html;

        // Ruby parser now handles most link processing, but we can add any final touches here if needed
        // All links should already have proper classes and attributes from Ruby

        return html;
    }

    // Helper to escape HTML (for data attributes)
    escapeHtml(text) {
        if (!text) return '';
        const map = {
            '&': '&amp;',
            '<': '&lt;',
            '>': '&gt;',
            '"': '&quot;',
            "'": '&#039;'
        };
        return String(text).replace(/[&<>"']/g, m => map[m]);
    }

    // Handle adding words to dictionary
    async handleAddWordToDictionary(ws, message, clientInfo, wsServer) {
        const { word } = message;

        if (!word) {
            this.sendError(ws, 'Missing word parameter', 'spellcheck_add_word');
            return;
        }

        try {
            const result = await this.globalResources.getSearchService().addWordToDictionary(word);

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
        if (typeof message.clientRttMs === 'number' && Number.isFinite(message.clientRttMs) && message.clientRttMs >= 0 && message.clientRttMs <= 120000) {
            clientInfo.lastClientRttMs = message.clientRttMs;
        }
        // Server should always respond if initialized
        // No need to check context anymore - config is directly imported
        wsServer.sendToClient(ws, {
            type: 'pong',
            requestId: message.requestId,
            timestamp: new Date().toISOString(),
            serverReady: true
        });
    }

    // Handle rate limiting stats request
    async handleGetRateLimitingStats(ws, message, clientInfo, wsServer) {
        try {
            if (this.globalResources.initializationProgress.searchService && typeof this.globalResources.getSearchService().getRateLimitingStats === 'function') {
                const stats = this.globalResources.getSearchService().getRateLimitingStats();
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
            if (this.globalResources.initializationProgress.searchService && typeof this.globalResources.getSearchService().cancelAllPendingRequests === 'function') {
                const cancelledCount = this.globalResources.getSearchService().cancelAllPendingRequests();
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

            if (this.globalResources.initializationProgress.searchService && typeof this.globalResources.getSearchService().getSessionRateLimitingStats === 'function') {
                const stats = this.globalResources.getSearchService().getSessionRateLimitingStats(clientInfo.sessionId, model);
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

            if (this.globalResources.initializationProgress.searchService && typeof this.globalResources.getSearchService().cancelSessionPendingRequests === 'function') {
                const cancelledCount = this.globalResources.getSearchService().cancelSessionPendingRequests(clientInfo.sessionId, model);
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

    // Handle gallery request messages
    async handleGalleryRequest(ws, message, clientInfo, wsServer) {
        const { requestId, viewType = 'images', includePinnedStatus = true, light = false, offset = 0, limit = 100 } = message;

        try {
            // Start keep-alive for potentially long gallery requests
            this.startKeepAliveInterval(ws, requestId, 10000); // Every 10 seconds for gallery requests

            // Get files based on view type
            let files;
            if (viewType === 'scraps') {
                files = this.globalResources.getWorkspaceManager().getActiveWorkspaceScraps(clientInfo.sessionId);
            } else if (viewType === 'pinned') {
                files = this.globalResources.getWorkspaceManager().getActiveWorkspacePinned(clientInfo.sessionId);
            } else if (viewType === 'upscaled') {
                const workspaceFiles = this.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(clientInfo.sessionId);
                files = workspaceFiles;

                // Load metadata only for workspace files to find large resolution images (area > 1024x1024)
                const workspaceMetadata = await this.globalResources.getMetadataDatabase().getMultipleMetadata(workspaceFiles);

                // Find large resolution images in the current workspace
                const specialImages = [];
                for (const [filename, metadata] of Object.entries(workspaceMetadata)) {
                    if (metadata.width && metadata.height && isImageLarge(metadata.width, metadata.height)) {
                        specialImages.push(filename);
                    }
                }

                // Add special images to the files list (they're already in workspace files, so no duplicates)
                files = [...new Set([...files, ...specialImages])];
            } else {
                // Default to regular images
                files = this.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(clientInfo.sessionId);
            }

            // Get pinned status if requested
            let pinnedFiles = [];
            if (includePinnedStatus) {
                pinnedFiles = this.globalResources.getWorkspaceManager().getActiveWorkspacePinned(clientInfo.sessionId);
            }

            // Helper function to get base name
            const getBaseName = (filename) => {
                const base = filename.replace(/\.(png|jpg|jpeg)$/i, '');
                return base.replace(/_upscaled$/, '');
            };

            // Helper function to get preview filename
            const getPreviewFilename = (baseName) => {
                return `${baseName}.webp`;
            };

            // Build gallery data
            if (!Array.isArray(files)) {
                console.error('Files is not an array:', files);
                files = [];
            }

            // Convert files to baseMap for processing
            const baseMap = {};
            for (const file of files) {
                const base = getBaseName(file);
                if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
                if (file.includes('_upscaled')) baseMap[base].upscaled = file;
                else baseMap[base].original = file;
            }

            // Convert to array and sort by newest first
            let baseArray = Object.keys(baseMap).map(base => ({
                base,
                ...baseMap[base]
            }));

            // Get mtime for sorting (lightweight query)
            if (baseArray.length > 0) {
                const allFilesForSort = baseArray.flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
                const sortMetadata = await this.globalResources.getMetadataDatabase().getLightweightMetadata(allFilesForSort);

                // Add mtime to each item for sorting
                baseArray.forEach(item => {
                    const file = item.upscaled || item.original;
                    const metadata = sortMetadata[file];
                    item.mtime = metadata?.mtime || Date.now();
                });
            }

            // Sort by newest first
            baseArray.sort((a, b) => b.mtime - a.mtime);

            // Apply pagination
            const totalItems = baseArray.length;
            const paginatedItems = baseArray.slice(offset, offset + limit);
            const hasMore = (offset + limit) < totalItems;

            let gallery = [];

            if (light) {
                // Light mode: return basic file info without metadata
                gallery = paginatedItems.map(({ base, original, upscaled }) => {
                    const file = upscaled || original;
                    return {
                        base,
                        original,
                        upscaled,
                        preview: getPreviewFilename(base),
                        // Basic info only, no metadata
                        isPinned: includePinnedStatus ? pinnedFiles.includes(file) : false
                    };
                });
            } else {
                // Full mode: load metadata for paginated items
                const filesToLoad = paginatedItems.flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
                const allMetadata = await this.globalResources.getMetadataDatabase().getMultipleMetadata(filesToLoad);

                for (const item of paginatedItems) {
                    const { base, original, upscaled } = item;

                    // Get the file to use (prefer upscaled, then original)
                    const file = upscaled || original;
                    if (!file) continue;

                    // Get metadata from database (already loaded in batch)
                    let fileMetadata = allMetadata[file];
                    if (!fileMetadata) {
                        // If not in batch, try individual lookup
                        try {
                            fileMetadata = await this.globalResources.getMetadataDatabase().getCachedMetadata(file);
                            if (!fileMetadata) {
                                console.log(`🔄 Loading metadata for file: ${file}`);
                                // Try to extract metadata for the missing file
                                fileMetadata = await this.globalResources.getMetadataDatabase().getImageMetadata(file, this.globalResources.getPath("images"));
                                if (!fileMetadata) {
                                    console.warn(`❌ Could not extract metadata for file: ${file}`);
                                    continue;
                                }
                            }
                        } catch (error) {
                            console.error(`❌ Error loading metadata for file ${file}:`, error);
                            continue;
                        }
                    }

                    const preview = getPreviewFilename(base);
                    const isLarge = fileMetadata?.width && fileMetadata?.height ?
                        isImageLarge(fileMetadata.width, fileMetadata.height) : false;

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
                        mtime: fileMetadata.mtime || Date.now(),
                        size: fileMetadata.size || 0,
                        isLarge: isLarge,
                        isPinned: includePinnedStatus ? pinnedFiles.includes(file) : false,
                        // Include dimensions for PhotoSwipe
                        width: fileMetadata.width || null,
                        height: fileMetadata.height || null
                    });
                }
            }

            // Stop keep-alive when complete
            this.stopKeepAliveInterval(requestId);

            // Send response
            this.sendToClient(ws, {
                type: 'request_gallery_response',
                requestId: requestId,
                data: {
                    gallery,
                    viewType,
                    pagination: {
                        offset,
                        limit,
                        hasMore,
                        totalItems
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            // Stop keep-alive on error
            this.stopKeepAliveInterval(requestId);

            console.error('Gallery request error:', error);
            this.sendError(ws, 'Failed to load gallery', error.message, requestId);
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
            const filePath = path.join(this.globalResources.getPath("images"), filename);

            if (!fs.existsSync(filePath)) {
                this.sendError(ws, 'Image not found', 'request_image_metadata', message.requestId);
                return;
            }

            // Check in-memory cache first
            const workspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            
            // Track client workspace usage
            this.metadataCache.trackClientWorkspace(clientInfo.sessionId, workspaceId);
            
            let cachedMetadata = this.metadataCache.get(workspaceId, filename);

            // If not in cache, get from database
            if (!cachedMetadata) {
                cachedMetadata = await this.globalResources.getMetadataDatabase().getCachedMetadata(filename, false);
                
                // If found in database, add to cache
                if (cachedMetadata) {
                    this.metadataCache.set(workspaceId, filename, cachedMetadata);
                }
            }

            // If still not found, extract and update cache
            if (!cachedMetadata) {
                console.log(`🔄 Metadata not found in cache for ${filename}, extracting...`);
                cachedMetadata = await this.globalResources.getMetadataDatabase().getImageMetadata(filename, this.globalResources.getPath("images"));
                if (!cachedMetadata) {
                    this.sendError(ws, 'Failed to extract metadata', 'request_image_metadata', message.requestId);
                    return;
                }
                // Add to cache
                this.metadataCache.set(workspaceId, filename, cachedMetadata);
            }

            // If not in cache, extract and update cache
            if (!cachedMetadata) {
                console.log(`🔄 Metadata not found in cache for ${filename}, extracting...`);
                cachedMetadata = await this.globalResources.getMetadataDatabase().getImageMetadata(filename, this.globalResources.getPath("images"));
                if (!cachedMetadata) {
                    this.sendError(ws, 'Failed to extract metadata', 'request_image_metadata', message.requestId);
                    return;
                }
            }

            // Get the metadata object (PNG embedded metadata)
            let metadata = cachedMetadata.metadata;

            // If this is an upscaled image and has a parent, get the parent's metadata (without receipts)
            if (cachedMetadata.upscaled && cachedMetadata.parent) {
                const parentMetadata = await this.globalResources.getMetadataDatabase().getCachedMetadata(cachedMetadata.parent, false);
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

            // Ensure actual dimensions are available in metadata (for backward compatibility)
            if (!metadata.actual_width) {
                metadata.actual_width = cachedMetadata.width;
            }
            if (!metadata.actual_height) {
                metadata.actual_height = cachedMetadata.height;
            }

            // If upscaled, try to match preset using metadata dimensions
            let matchedPreset = null;
            const isUpscaled = metadata.forge_data?.upscale_ratio !== null && metadata.forge_data?.upscale_ratio !== undefined;
            if (isUpscaled) {
                const currentPromptConfig = this.globalResources.getPromptConfig();
                matchedPreset = matchOriginalResolution(metadata, currentPromptConfig.resolutions || {});
            }

            const result = await this.globalResources.getPngMetadata().extractRelevantFields(metadata, filename);
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
                files = this.globalResources.getWorkspaceManager().getActiveWorkspaceScraps(sessionId);
                break;
            case 'pinned':
                files = this.globalResources.getWorkspaceManager().getActiveWorkspacePinned(sessionId);
                break;
            case 'upscaled':
                // For upscaled view, get all files and filter for upscaled/large images
                const workspaceFiles = this.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
                files = workspaceFiles;

                // Load metadata only for workspace files to find large resolution images (area > 1024x1024)
                const workspaceMetadata = await this.globalResources.getMetadataDatabase().getMultipleMetadata(workspaceFiles);

                // Find large resolution images in the current workspace
                const specialImages = [];
                for (const [filename, metadata] of Object.entries(workspaceMetadata)) {
                    if (metadata.width && metadata.height && isImageLarge(metadata.width, metadata.height)) {
                        specialImages.push(filename);
                    }
                }

                // Add special images to the files list
                files = [...new Set([...files, ...specialImages])];
                break;
            case 'images':
            default:
                files = this.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
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

        // Get all metadata in batch (without receipts for performance)
        const allFiles = Object.values(baseMap).flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
        const allMetadata = await this.globalResources.getMetadataDatabase().getMultipleMetadata(allFiles);
        
        const gallery = [];
        for (const base in baseMap) {
            const { original, upscaled } = baseMap[base];

            // Get the file to use (prefer upscaled, then original)
            const file = upscaled || original;
            if (!file) continue;

            // Get metadata from batch (already loaded)
            let metadata = allMetadata[file];
            if (!metadata) {
                // If not in batch, try individual lookup (without receipts)
                metadata = await this.globalResources.getMetadataDatabase().getCachedMetadata(file, false);
                if (!metadata) {
                    console.log(`🔄 Loading metadata for file: ${file}`);
                    try {
                        // Try to extract metadata for the missing file
                        metadata = await this.globalResources.getMetadataDatabase().getImageMetadata(file, this.globalResources.getPath("images"));
                        if (!metadata) {
                            console.warn(`❌ Could not extract metadata for file: ${file}`);
                            continue;
                        }
                    } catch (error) {
                        console.error(`❌ Error loading metadata for file ${file}:`, error);
                        continue;
                    }
                }
            }

            const preview = `${base}.webp`;
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
                height: metadata.height || null,
                seed: metadata.metadata?.seed || null
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
            // Get files based on view type (same logic as buildGalleryData but optimized)
            const sessionId = clientInfo.sessionId;
            let files;
            switch (viewType) {
                case 'scraps':
                    files = this.globalResources.getWorkspaceManager().getActiveWorkspaceScraps(sessionId);
                    break;
                case 'pinned':
                    files = this.globalResources.getWorkspaceManager().getActiveWorkspacePinned(sessionId);
                    break;
                case 'upscaled':
                    files = this.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
                    // Note: For upscaled view, we'd need to filter, but for single image lookup we'll skip this optimization
                    break;
                case 'images':
                default:
                    files = this.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
                    break;
            }

            if (!Array.isArray(files) || files.length === 0) {
                this.sendError(ws, 'No images found', 'request_image_by_index', message.requestId);
                return;
            }

            // Build base map (same as buildGalleryData)
            const getBaseName = (filename) => {
                const base = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
                return base.replace(/_upscaled$/, '');
            };

            const baseMap = {};
            for (const file of files) {
                const base = getBaseName(file);
                if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
                if (file.includes('_upscaled')) baseMap[base].upscaled = file;
                else baseMap[base].original = file;
            }

            // Get all files for lightweight metadata lookup (only for sorting)
            const allFiles = Object.values(baseMap).flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
            const lightweightMetadata = await this.globalResources.getMetadataDatabase().getLightweightMetadata(allFiles);

            // Build minimal gallery array with just what we need for sorting
            const gallery = [];
            for (const base in baseMap) {
                const { original, upscaled } = baseMap[base];
                const file = upscaled || original;
                if (!file) continue;

                const metadata = lightweightMetadata[file];
                if (!metadata) continue;

                // Filter for upscaled view if needed
                if (viewType === 'upscaled') {
                    const isLarge = metadata?.width && metadata?.height ?
                        isImageLarge(metadata.width, metadata.height) : false;
                    if (!upscaled && !isLarge) continue;
                }

                gallery.push({
                    base,
                    original,
                    upscaled,
                    preview: `${base}.webp`,
                    mtime: metadata.mtime || Date.now(),
                    size: metadata.size || 0,
                    isLarge: metadata?.width && metadata?.height ?
                        isImageLarge(metadata.width, metadata.height) : false,
                    width: metadata.width || null,
                    height: metadata.height || null
                });
            }

            // Sort by newest first
            gallery.sort((a, b) => b.mtime - a.mtime);

            // Check if index is valid
            if (index < 0 || index >= gallery.length) {
                this.sendError(ws, 'Index out of bounds', 'request_image_by_index', message.requestId);
                return;
            }

            const image = gallery[index];

            // Load full metadata only for the target image (check cache first)
            let metadata = null;
            try {
                const filePath = path.join(this.globalResources.getPath("images"), image.original);
                if (fs.existsSync(filePath)) {
                    const workspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
                    
                    // Track client workspace usage
                    this.metadataCache.trackClientWorkspace(clientInfo.sessionId, workspaceId);
                    
                    // Check in-memory cache first
                    let cachedMetadata = this.metadataCache.get(workspaceId, image.original);
                    
                    // If not in cache, get from database
                    if (!cachedMetadata) {
                        cachedMetadata = await this.globalResources.getMetadataDatabase().getCachedMetadata(image.original, false);
                        
                        // If found, add to cache
                        if (cachedMetadata) {
                            this.metadataCache.set(workspaceId, image.original, cachedMetadata);
                        }
                    }
                    
                    if (cachedMetadata && cachedMetadata.metadata) {
                        metadata = await this.globalResources.getPngMetadata().extractRelevantFields(cachedMetadata.metadata, image.original);
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
        const startTime = Date.now();

        // Config is directly imported - no need to check context

        try {
            const currentPromptConfig = this.globalResources.getPromptConfig();

            // Filter out _INP models and use pretty names
            const modelEntries = Object.keys((this.globalResources.getNekoAiService('Model')))
                .filter(key => !key.endsWith('_INP'))
                .map(key => [key, this.globalResources.getPngMetadata().getModelDisplayName(key)]);
            const modelEntriesShort = Object.keys((this.globalResources.getNekoAiService('Model')))
                .filter(key => !key.endsWith('_INP'))
                .map(key => [key, this.globalResources.getPngMetadata().getModelDisplayName(key, true)]);
            const imageCount = this.globalResources.getImageCounter().getCount();

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

            // Build detailed preset info
            const detailedPresets = Object.entries(currentPromptConfig.presets || {}).map(
                ([name, preset]) => extractPresetInfo(name, preset)
            );

            // Get account data and balance from globalResources
            const accountData = this.globalResources.getAccountData();
            const accountBalance = this.globalResources.getAccountBalance();

            // Session workspace restoration is handled during WebSocket connection establishment
            // No need to restore it again here as it causes unnecessary delays
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            const activeWorkspaceData = this.globalResources.getWorkspaceManager().getActiveWorkspaceData(clientInfo.sessionId);

            const options = {
                ok: true,
                user: accountData,
                balance: accountBalance,
                presets: detailedPresets,
                queue_status: this.globalResources.getQueue().getStatus(),
                image_count: imageCount,
                models: Object.fromEntries(modelEntries),
                modelsShort: Object.fromEntries(modelEntriesShort),
                actions: Object.fromEntries(Object.keys((this.globalResources.getNekoAiService('Action'))).map(key => [key, (this.globalResources.getNekoAiService('Action'))[key]])),
                samplers: Object.fromEntries(Object.keys(this.globalResources.getNekoAiService('Sampler')).map(key => [key, this.globalResources.getNekoAiService('Sampler')[key]])),
                noiseSchedulers: Object.fromEntries(Object.keys(this.globalResources.getNekoAiService('Noise')).map(key => [key, this.globalResources.getNekoAiService('Noise')[key]])),
                resolutions: Object.fromEntries(Object.keys(this.globalResources.getNekoAiService('Resolution')).map(key => [key, this.globalResources.getNekoAiService('Resolution')[key]])),
                textReplacements: currentPromptConfig.text_replacements || {},
                datasets: currentPromptConfig.datasets || [],
                quality_presets: currentPromptConfig.quality_presets || {},
                uc_presets: currentPromptConfig.uc_presets || {},
                activeWorkspace: activeWorkspaceData ? {
                    id: activeWorkspaceId,
                    data: activeWorkspaceData
                } : null
            };
            const config = this.globalResources.getConfig();
            options.defaultGrokModel = this.globalResources.getGrokService().getDefaultGrokModel();
            if (config.enable_dev) {
                options.devPort = config.devPort || 65202;
                options.devHost = config.devHost || 'localhost';
            }

            // Send response
            this.sendToClient(ws, {
                type: 'get_app_options_response',
                requestId: message.requestId,
                data: options,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const totalTime = Date.now() - startTime;
            console.error(`❌ App options request error after ${totalTime}ms:`, error);
            this.sendError(ws, 'Failed to load app options', error.message, message.requestId);
        }
    }

    // Handle system information request
    async handleGetSystemInfo(ws, message, clientInfo, wsServer) {
        const startTime = Date.now();

        try {
            // Get cached system information from globalResources
            const systemInfo = this.globalResources.getSystemInfoCache();

            if (!systemInfo) {
                // Cache not yet initialized, return error
                this.sendError(ws, 'System information not available', 'System info cache not initialized', message.requestId);
                return;
            }

            // Send cached data (instant response)
            this.sendToClient(ws, {
                type: 'get_system_info_response',
                requestId: message.requestId,
                data: systemInfo,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            const totalTime = Date.now() - startTime;
            console.error(`❌ System info request error after ${totalTime}ms:`, error);
            this.sendError(ws, 'Failed to get system information', error.message, message.requestId);
        }
    }

    // Workspace handlers
    async handleWorkspaceList(ws, message, clientInfo, wsServer) {
        try {
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);

            // Get cache file counts from database for all workspaces in one batch query
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const workspaceIds = Object.keys(workspaces);
            const workspaceCacheCounts = refDb.getWorkspaceReferenceCounts(workspaceIds);
            
            // Transform to include workspace metadata
            const workspaceList = Object.entries(workspaces).map(([id, workspace]) => ({
                id,
                name: workspace.name,
                color: workspace.color || '#102040',
                backgroundColor: workspace.backgroundColor,
                primaryFont: typeof workspace.primaryFont !== 'undefined' ? workspace.primaryFont : null,
                textareaFont: typeof workspace.textareaFont !== 'undefined' ? workspace.textareaFont : null,
                wallpaper: workspace.wallpaper || null,
                wallpaperPosition: workspace.wallpaperPosition || null,
                sort: workspace.sort || 0, // Include sort field
                fileCount: workspace.files.length,
                presetCount: workspace.presets.length,
                cacheFileCount: workspaceCacheCounts[id] || 0, // Use database count
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
            const activeId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(activeId);

            if (!workspace) {
                this.sendError(ws, 'Active workspace not found', 'workspace_get', message.requestId);
                return;
            }

            // Get cache file count from database
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const cacheFileCount = refDb.getWorkspaceReferences(activeId).length;
            
            this.sendToClient(ws, {
                type: 'workspace_get_response',
                requestId: message.requestId,
                data: {
                    id: activeId,
                    name: workspace.name,
                    color: workspace.color || '#102040',
                    backgroundColor: workspace.backgroundColor,
                    primaryFont: typeof workspace.primaryFont !== 'undefined' ? workspace.primaryFont : null,
                    textareaFont: typeof workspace.textareaFont !== 'undefined' ? workspace.textareaFont : null,
                    sort: workspace.sort || 0, // Include sort field
                    fileCount: workspace.files.length,
                    presetCount: workspace.presets.length,
                    cacheFileCount: cacheFileCount // Use database count
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Workspace get error:', error);
            this.sendError(ws, 'Failed to get workspace', error.message, message.requestId);
        }
    }

    async handleDesktopGetSettings(ws, message, clientInfo, wsServer) {
        try {
            // Get last session workspace like restore process does, but don't apply or emit events
            let workspaceId = 'default';
            
            if (clientInfo && clientInfo.sessionId) {
                const sessionStore = this.globalResources.getSessionStore();
                if (sessionStore) {
                    // Get session using callback pattern like restoreSessionWorkspace
                    const session = await new Promise((resolve) => {
                        sessionStore.get(clientInfo.sessionId, (err, session) => {
                            if (err) {
                                console.log(`❌ Error retrieving session ${clientInfo.sessionId}:`, err.message);
                                resolve(null);
                                return;
                            }
                            resolve(session);
                        });
                    });
                    
                    if (session && session.lastActiveWorkspace && session.lastActiveWorkspaceTime) {
                        // Check if the workspace still exists
                        const workspaces = this.globalResources.getWorkspacesConfig();
                        if (workspaces && workspaces[session.lastActiveWorkspace]) {
                            // Check if the session is not too old (e.g., within 3 days)
                            const sessionAge = Date.now() - session.lastActiveWorkspaceTime;
                            const maxAge = 3 * 24 * 60 * 60 * 1000; // 3 days
                            
                            if (sessionAge < maxAge) {
                                workspaceId = session.lastActiveWorkspace;
                            }
                        }
                    }
                }
            }
            
            // Get wallpaper, position, and colors from workspace config (main config)
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(workspaceId);
            const wallpaper = workspace?.wallpaper || null;
            const wallpaperPosition = workspace?.wallpaperPosition || null;
            const color = workspace?.color || '#102040';
            const backgroundColor = workspace?.backgroundColor || null;
            
            // Get shortcuts from desktop config
            const desktopConfig = this.globalResources.getWorkspaceDesktopConfig();
            const workspaceDesktop = desktopConfig?.[workspaceId] || {};
            const shortcuts = workspaceDesktop.shortcuts || [];
            
            // Return wallpaper/position/colors from workspace config and shortcuts from desktop config
            this.sendToClient(ws, {
                type: 'desktop_get_settings_response',
                requestId: message.requestId,
                data: {
                    wallpaper: wallpaper,
                    wallpaperPosition: wallpaperPosition,
                    color: color,
                    backgroundColor: backgroundColor,
                    shortcuts: shortcuts
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Desktop get settings error:', error);
            // Return default on error
            this.sendToClient(ws, {
                type: 'desktop_get_settings_response',
                requestId: message.requestId,
                data: {
                    wallpaper: null,
                    wallpaperPosition: null,
                    color: '#102040',
                    backgroundColor: null,
                    shortcuts: []
                },
                timestamp: new Date().toISOString()
            });
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

            const workspaceId = this.globalResources.getWorkspaceManager().createWorkspace(name.trim(), color ? color.trim() : null);

            // Get the complete workspace object to return to client
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(workspaceId);

            const responseData = {
                success: true,
                id: workspaceId,
                name: name.trim(),
                workspace: workspace // Include complete workspace object
            };
            console.log('Sending workspace_create_response:', responseData);

            this.sendToClient(ws, {
                type: 'workspace_create_response',
                requestId: message.requestId,
                data: responseData,
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

            this.globalResources.getWorkspaceManager().renameWorkspace(id, name.trim());

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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);
            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_delete', message.requestId);
                return;
            }

            const movedCount = this.globalResources.getWorkspaceManager().deleteWorkspace(id);

            // Clear metadata cache for deleted workspace
            this.metadataCache.clearWorkspace(id);

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
            const oldWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);

            this.globalResources.getWorkspaceManager().setActiveWorkspace(id, clientInfo.sessionId);

            // Track new workspace usage
            this.metadataCache.trackClientWorkspace(clientInfo.sessionId, id);
            
            // Note: We don't clear the old workspace cache immediately - it may be used by other clients
            // The periodic cleanup will handle unused workspace caches

            this.sendToClient(ws, {
                type: 'workspace_activate_response',
                requestId: message.requestId,
                data: { success: true, activeWorkspace: id },
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
            const sourceWorkspace = this.globalResources.getWorkspaceManager().getWorkspace(sourceId);
            const targetWorkspace = this.globalResources.getWorkspaceManager().getWorkspace(targetId);

            if (!sourceWorkspace || !targetWorkspace) {
                this.sendError(ws, 'Source or target workspace not found', 'workspace_dump', message.requestId);
                return;
            }

            const result = this.globalResources.getWorkspaceManager().dumpWorkspace(sourceId, targetId);

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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_files', message.requestId);
                return;
            }

            // Get workspace files (including default workspace files)
            const workspaceFiles = new Set();

            // Always include default workspace files
            const defaultWorkspace = this.globalResources.getWorkspaceManager().getWorkspace('default');
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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);
            if (!workspace) {
                this.sendError(ws, `Target workspace ${id} not found`, 'workspace_move_files', message.requestId);
                return;
            }

            // Get source workspace info if provided
            let sourceWorkspace = null;
            if (sourceWorkspaceId) {
                sourceWorkspace = this.globalResources.getWorkspaceManager().getWorkspace(sourceWorkspaceId);
                if (!sourceWorkspace) {
                    this.sendError(ws, `Source workspace ${sourceWorkspaceId} not found`, 'workspace_move_files', message.requestId);
                    return;
                }
            }

            // Use the appropriate move function based on moveType
            let movedCount;
            switch (moveType) {
                case 'scraps':
                    movedCount = this.globalResources.getWorkspaceManager().moveToWorkspaceArray('scraps', filenames, id, sourceWorkspaceId);
                    break;
                case 'pinned':
                    movedCount = this.globalResources.getWorkspaceManager().moveToWorkspaceArray('pinned', filenames, id, sourceWorkspaceId);
                    break;
                case 'files':
                default:
                    movedCount = this.globalResources.getWorkspaceManager().moveFilesToWorkspace(filenames, id, sourceWorkspaceId);
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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_scraps', message.requestId);
                return;
            }

            // Get scraps for the requested workspace (scraps are shared across workspaces)
            const scraps = this.globalResources.getWorkspaceManager().getActiveWorkspaceScraps(clientInfo.sessionId);

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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_pinned', message.requestId);
                return;
            }

            // Get pinned images for the requested workspace
            const pinned = this.globalResources.getWorkspaceManager().getActiveWorkspacePinned(clientInfo.sessionId);

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

            this.globalResources.getWorkspaceManager().addToWorkspaceArray('scraps', filename, id);

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

            this.globalResources.getWorkspaceManager().removeFromWorkspaceArray('scraps', filename, id);

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

            this.globalResources.getWorkspaceManager().addToWorkspaceArray('pinned', filename, id);

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

            this.globalResources.getWorkspaceManager().removeFromWorkspaceArray('pinned', filename, id);

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
                this.globalResources.getWorkspaceManager().addToWorkspaceArray('pinned', filename, id);
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
                    this.globalResources.getWorkspaceManager().removeFromWorkspaceArray('pinned', filename, id);
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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_groups', message.requestId);
                return;
            }

            const groups = this.globalResources.getWorkspaceManager().getWorkspaceGroups(id);

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

            const groupId = this.globalResources.getWorkspaceManager().createGroup(id, name.trim());

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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_group', message.requestId);
                return;
            }

            const group = this.globalResources.getWorkspaceManager().getGroup(id, groupId);

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

            this.globalResources.getWorkspaceManager().renameGroup(id, groupId, name.trim());

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

            this.globalResources.getWorkspaceManager().addImagesToGroup(id, groupId, filenames);

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

            this.globalResources.getWorkspaceManager().removeImagesFromGroup(id, groupId, filenames);

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

            this.globalResources.getWorkspaceManager().deleteGroup(id, groupId);

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
            const workspace = this.globalResources.getWorkspaceManager().getWorkspace(id);

            if (!workspace) {
                this.sendError(ws, 'Workspace not found', 'workspace_get_image_groups', message.requestId);
                return;
            }

            const groups = this.globalResources.getWorkspaceManager().getGroupsForImage(id, filename);

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

            this.globalResources.getWorkspaceManager().updateWorkspaceColor(id, color.trim());

            this.sendToClient(ws, {
                type: 'workspace_update_color_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace color updated' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'color_updated', workspaceId: id, settings: { color: color.trim() } },
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

            this.globalResources.getWorkspaceManager().updateWorkspaceBackgroundColor(id, backgroundColor);

            this.sendToClient(ws, {
                type: 'workspace_update_background_color_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace background color updated' },
                timestamp: new Date().toISOString()
            });

            // Broadcast workspace update to all clients
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'background_color_updated', workspaceId: id, settings: { backgroundColor } },
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
            this.globalResources.getWorkspaceManager().updateWorkspacePrimaryFont(id, primaryFont || null);

            this.sendToClient(ws, {
                type: 'workspace_update_primary_font_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace primary font updated' },
                timestamp: new Date().toISOString()
            });

            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'primary_font_updated', workspaceId: id, settings: { primaryFont: primaryFont || null } },
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
            this.globalResources.getWorkspaceManager().updateWorkspaceTextareaFont(id, textareaFont || null);

            this.sendToClient(ws, {
                type: 'workspace_update_textarea_font_response',
                requestId: message.requestId,
                data: { success: true, message: 'Workspace textarea font updated' },
                timestamp: new Date().toISOString()
            });

            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'textarea_font_updated', workspaceId: id, settings: { textareaFont: textareaFont || null } },
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

            // Validate wallpaper format if provided (client should already normalize)
            if (settings.wallpaper !== undefined && settings.wallpaper !== null) {
                if (typeof settings.wallpaper !== 'string') {
                    this.sendError(ws, 'Wallpaper must be a string in format "type:id"', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                // Validate that wallpaper is in correct 2-part format (type:id)
                const correctFormatPattern = /^(file|cache|cache-preview|vibe|wallpaper|url):.+$/;
                if (!correctFormatPattern.test(settings.wallpaper)) {
                    this.sendError(ws, 'Invalid wallpaper format. Use "type:id" (e.g., "file:image.png", "cache:hash123", "url:https://example.com/bg.jpg")', 'workspace_update_settings', message.requestId);
                    return;
                }
            }

            // Validate wallpaper position if provided
            if (settings.wallpaperPosition !== undefined && settings.wallpaperPosition !== null) {
                if (typeof settings.wallpaperPosition !== 'string') {
                    this.sendError(ws, 'Wallpaper position must be a string', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                // Position format: "horizontal vertical" where each can be a keyword or percentage
                // Keywords: center, top, bottom, left, right
                // Percentages: 0% to 100%
                // Examples: "center center", "50% 75%", "left 25%", "80% top"
                const parts = settings.wallpaperPosition.trim().split(/\s+/);
                if (parts.length !== 2) {
                    this.sendError(ws, 'Invalid wallpaper position format. Use "horizontal vertical" (e.g., "center center", "50% 75%", "left 25%")', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                const [horizontal, vertical] = parts;
                const keywordPattern = /^(center|top|bottom|left|right)$/;
                const percentagePattern = /^(100|[1-9]?\d)%$/;
                
                // Validate horizontal (can be left, center, right, or percentage)
                const validHorizontalKeyword = ['left', 'center', 'right'].includes(horizontal);
                const validHorizontalPercentage = percentagePattern.test(horizontal);
                if (!validHorizontalKeyword && !validHorizontalPercentage) {
                    this.sendError(ws, 'Invalid horizontal position. Use "left", "center", "right", or a percentage (0%-100%)', 'workspace_update_settings', message.requestId);
                    return;
                }
                
                // Validate vertical (can be top, center, bottom, or percentage)
                const validVerticalKeyword = ['top', 'center', 'bottom'].includes(vertical);
                const validVerticalPercentage = percentagePattern.test(vertical);
                if (!validVerticalKeyword && !validVerticalPercentage) {
                    this.sendError(ws, 'Invalid vertical position. Use "top", "center", "bottom", or a percentage (0%-100%)', 'workspace_update_settings', message.requestId);
                    return;
                }
            }

            this.globalResources.getWorkspaceManager().updateWorkspaceSettings(id, settings);

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

            this.globalResources.getWorkspaceManager().reorderWorkspaces(workspaceIds);

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

    // Handle window position updates (ackless message, no response expected)
    // Saves to the same file as desktop shortcuts (workspaceDesktop config) as global object
    async handleWorkspaceUpdateWindowPositions(ws, message, clientInfo, wsServer) {
        try {
            const { id, windowPositions } = message;
            
            if (!windowPositions || typeof windowPositions !== 'object') {
                // This is an ackless message, so we don't send errors back
                console.warn('Invalid window positions update:', { id, windowPositions });
                return;
            }

            // Save window positions to workspaceDesktop config as global object (not per-workspace)
            // id is ignored now since positions are global
            this.globalResources.modifyConfig('workspaceDesktop').assign(['windowPositions'], windowPositions);

            // Broadcast to all clients (no response since this is ackless)
            wsServer.broadcast({
                type: 'workspace_updated',
                data: { action: 'window_positions_updated', windowPositions }, // No workspaceId, positions are global
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            // Log error but don't send response (ackless message)
            console.error('Workspace update window positions error:', error);
        }
    }

    // Desktop shortcuts handlers
    async handleDesktopGetShortcuts(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceId } = message;

            if (!workspaceId) {
                this.sendError(ws, 'Workspace ID is required', 'desktop_get_shortcuts', message.requestId);
                return;
            }

            const desktopData = this.globalResources.getWorkspaceManager().getDesktopShortcuts(workspaceId);

            this.sendToClient(ws, {
                type: 'desktop_get_shortcuts_response',
                requestId: message.requestId,
                data: {
                    shortcuts: desktopData.shortcuts,
                    windowPositions: desktopData.windowPositions
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Desktop get shortcuts error:', error);
            this.sendError(ws, 'Failed to get desktop shortcuts', error.message, message.requestId);
        }
    }

    async handleDesktopAddShortcut(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceId, shortcut } = message;

            if (!workspaceId || !shortcut) {
                this.sendError(ws, 'Workspace ID and shortcut data are required', 'desktop_add_shortcut', message.requestId);
                return;
            }

            // Validate shortcut structure
            if (!shortcut.name || !shortcut.type) {
                this.sendError(ws, 'Shortcut must have name and type', 'desktop_add_shortcut', message.requestId);
                return;
            }

            const result = this.globalResources.getWorkspaceManager().addDesktopShortcut(workspaceId, shortcut);

            this.sendToClient(ws, {
                type: 'desktop_add_shortcut_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients
            wsServer.broadcast({
                type: 'desktop_shortcut_added',
                data: { workspaceId, shortcut: result.shortcut },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Desktop add shortcut error:', error);
            this.sendError(ws, 'Failed to add desktop shortcut', error.message, message.requestId);
        }
    }

    async handleDesktopUpdateShortcut(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceId, shortcutId, updates } = message;

            if (!workspaceId || !shortcutId || !updates) {
                this.sendError(ws, 'Workspace ID, shortcut ID, and updates are required', 'desktop_update_shortcut', message.requestId);
                return;
            }

            const result = this.globalResources.getWorkspaceManager().updateDesktopShortcut(workspaceId, shortcutId, updates);

            this.sendToClient(ws, {
                type: 'desktop_update_shortcut_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients
            wsServer.broadcast({
                type: 'desktop_shortcut_updated',
                data: { workspaceId, shortcutId, updates },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Desktop update shortcut error:', error);
            this.sendError(ws, 'Failed to update desktop shortcut', error.message, message.requestId);
        }
    }

    async handleDesktopRemoveShortcut(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceId, shortcutId } = message;

            if (!workspaceId || !shortcutId) {
                this.sendError(ws, 'Workspace ID and shortcut ID are required', 'desktop_remove_shortcut', message.requestId);
                return;
            }

            const result = this.globalResources.getWorkspaceManager().removeDesktopShortcut(workspaceId, shortcutId);

            this.sendToClient(ws, {
                type: 'desktop_remove_shortcut_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients
            wsServer.broadcast({
                type: 'desktop_shortcut_removed',
                data: { workspaceId, shortcutId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Desktop remove shortcut error:', error);
            this.sendError(ws, 'Failed to remove desktop shortcut', error.message, message.requestId);
        }
    }

    async handleDesktopUpdatePositions(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceId, positions } = message;

            if (!workspaceId || !Array.isArray(positions)) {
                this.sendError(ws, 'Workspace ID and positions array are required', 'desktop_update_positions', message.requestId);
                return;
            }

            const result = this.globalResources.getWorkspaceManager().updateShortcutPositions(workspaceId, positions);

            this.sendToClient(ws, {
                type: 'desktop_update_positions_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients
            wsServer.broadcast({
                type: 'desktop_positions_updated',
                data: { workspaceId, positions },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Desktop update positions error:', error);
            this.sendError(ws, 'Failed to update desktop positions', error.message, message.requestId);
        }
    }

    // Notes operation handlers
    async handleNotesCreate(ws, message, clientInfo, wsServer) {
        try {
            const { id, name, workspaceId, content, icon, color } = message;

            if (!id || !name || !workspaceId) {
                this.sendError(ws, 'Note ID, name, and workspace ID are required', 'notes_create', message.requestId);
                return;
            }

            const note = await this.globalResources.notesDatabase.createNote({
                id,
                name,
                workspaceId,
                content,
                icon,
                color
            });

            this.sendToClient(ws, {
                type: 'notes_create_response',
                requestId: message.requestId,
                data: { success: true, note },
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients
            wsServer.broadcast({
                type: 'note_created',
                data: { note },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes create error:', error);
            this.sendError(ws, 'Failed to create note', error.message, message.requestId);
        }
    }

    async handleNotesGet(ws, message, clientInfo, wsServer) {
        try {
            const { noteId } = message;

            if (!noteId) {
                this.sendError(ws, 'Note ID is required', 'notes_get', message.requestId);
                return;
            }

            const note = await this.globalResources.notesDatabase.getNote(noteId);

            this.sendToClient(ws, {
                type: 'notes_get_response',
                requestId: message.requestId,
                data: { note },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes get error:', error);
            this.sendError(ws, 'Failed to get note', error.message, message.requestId);
        }
    }

    async handleNotesGetByWorkspace(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceId } = message;

            if (!workspaceId) {
                this.sendError(ws, 'Workspace ID is required', 'notes_get_by_workspace', message.requestId);
                return;
            }

            const notes = await this.globalResources.notesDatabase.getNotesByWorkspace(workspaceId);

            this.sendToClient(ws, {
                type: 'notes_get_by_workspace_response',
                requestId: message.requestId,
                data: { notes },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes get by workspace error:', error);
            this.sendError(ws, 'Failed to get notes by workspace', error.message, message.requestId);
        }
    }

    async handleNotesGetAll(ws, message, clientInfo, wsServer) {
        try {
            const notes = await this.globalResources.notesDatabase.getAllNotes();

            this.sendToClient(ws, {
                type: 'notes_get_all_response',
                requestId: message.requestId,
                data: { notes },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes get all error:', error);
            this.sendError(ws, 'Failed to get all notes', error.message, message.requestId);
        }
    }

    async handleNotesGetAllMetadata(ws, message, clientInfo, wsServer) {
        try {
            const notes = await this.globalResources.notesDatabase.getAllNotesMetadata();

            this.sendToClient(ws, {
                type: 'notes_get_all_metadata_response',
                requestId: message.requestId,
                data: { notes },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes get all metadata error:', error);
            this.sendError(ws, 'Failed to get all notes metadata', error.message, message.requestId);
        }
    }

    async handleNotesUpdate(ws, message, clientInfo, wsServer) {
        try {
            const { noteId, updates } = message;

            if (!noteId || !updates) {
                this.sendError(ws, 'Note ID and updates are required', 'notes_update', message.requestId);
                return;
            }

            const note = await this.globalResources.notesDatabase.updateNote(noteId, updates);

            this.sendToClient(ws, {
                type: 'notes_update_response',
                requestId: message.requestId,
                data: { success: true, note },
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients
            wsServer.broadcast({
                type: 'note_updated',
                data: { noteId, updates, note },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes update error:', error);
            this.sendError(ws, 'Failed to update note', error.message, message.requestId);
        }
    }

    async handleNotesDelete(ws, message, clientInfo, wsServer) {
        try {
            const { noteId } = message;

            if (!noteId) {
                this.sendError(ws, 'Note ID is required', 'notes_delete', message.requestId);
                return;
            }

            const result = await this.globalResources.notesDatabase.deleteNote(noteId);

            this.sendToClient(ws, {
                type: 'notes_delete_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients
            wsServer.broadcast({
                type: 'note_deleted',
                data: { noteId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes delete error:', error);
            this.sendError(ws, 'Failed to delete note', error.message, message.requestId);
        }
    }

    async handleNotesSaveContent(ws, message, clientInfo, wsServer) {
        try {
            const { noteId, content } = message;

            if (!noteId || content === undefined) {
                this.sendError(ws, 'Note ID and content are required', 'notes_save_content', message.requestId);
                return;
            }

            await this.globalResources.notesDatabase.saveNoteContent(noteId, content);

            this.sendToClient(ws, {
                type: 'notes_save_content_response',
                requestId: message.requestId,
                data: { success: true },
                timestamp: new Date().toISOString()
            });

            // Broadcast to all clients (but don't send full content to reduce traffic)
            wsServer.broadcast({
                type: 'note_content_updated',
                data: { noteId },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Notes save content error:', error);
            this.sendError(ws, 'Failed to save note content', error.message, message.requestId);
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
                    this.globalResources.getWorkspaceManager().addToWorkspaceArray('scraps', filename, id);
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
                    this.globalResources.getWorkspaceManager().removeFromWorkspaceArray('pinned', filename, id);
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
                    this.globalResources.getWorkspaceManager().addToWorkspaceArray('pinned', filename, id);
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
                    const filePath = path.join(this.globalResources.getPath("images"), filename);

                    if (!fs.existsSync(filePath)) {
                        errors.push({ filename, error: 'File not found' });
                        continue;
                    }

                    // Get the base name to find related files
                    const baseName = getBaseName(filename);
                    const previewFile = getPreviewFilename(baseName);
                    const previewPath = path.join(this.globalResources.getPath("previews"), previewFile);

                    // Define all preview files that may exist
                    const previewFiles = [
                        path.join(this.globalResources.getPath("previews"), `${baseName}.webp`),
                        path.join(this.globalResources.getPath("previews"), `${baseName}@2x.webp`),
                        path.join(this.globalResources.getPath("previews"), `${baseName}@lq.webp`),
                        path.join(this.globalResources.getPath("previews"), `${baseName}@blur.webp`),
                        previewPath // Legacy preview format
                    ];

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
                    const originalPath = path.join(this.globalResources.getPath("images"), originalFilename);
                    if (fs.existsSync(originalPath)) {
                        filesToDelete.push({ path: originalPath, type: 'original' });
                        filenamesToRemoveFromWorkspaces.push(originalFilename);

                        // Try to extract and delete dynGenPreview file from original
                        try {
                            const imageBuffer = fs.readFileSync(originalPath);
                            const metadata = this.globalResources.getPngMetadata().readMetadata(imageBuffer);
                            if (metadata?.tEXt?.Comment) {
                                const commentData = JSON.parse(metadata.tEXt.Comment);
                                const previewHash = commentData?.forge_data?.dynamic_generation?.compiled_prompt?.preview_image_hash;

                                if (previewHash) {
                                    const dynGenPreviewDir = path.join(this.globalResources.getPath("cache"), 'dynGenPreview');
                                    const dynGenPreviewPath = path.join(dynGenPreviewDir, `${previewHash}.png`);

                                    if (fs.existsSync(dynGenPreviewPath)) {
                                        filesToDelete.push({ path: dynGenPreviewPath, type: 'dynGenPreview' });
                                        console.log(`🗑️ Will delete dynGenPreview: ${previewHash.substring(0, 8)}...`);
                                    }
                                }
                            }
                        } catch (metadataError) {
                            // Silently ignore metadata extraction errors
                            console.debug(`Could not extract metadata for preview cleanup: ${metadataError.message}`);
                        }
                    }

                    // Add upscaled file if exists
                    const upscaledPath = path.join(this.globalResources.getPath("images"), upscaledFilename);
                    if (fs.existsSync(upscaledPath)) {
                        filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
                        filenamesToRemoveFromWorkspaces.push(upscaledFilename);
                    }

                    // Add all preview files (webp and legacy formats)
                    for (const previewFilePath of previewFiles) {
                        if (fs.existsSync(previewFilePath)) {
                            filesToDelete.push({ path: previewFilePath, type: 'preview' });
                        }
                    }

                    // Remove files from workspaces first
                    if (filenamesToRemoveFromWorkspaces.length > 0) {
                        this.globalResources.getWorkspaceManager().removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                    }

                    // Remove metadata from cache
                    await this.globalResources.getMetadataDatabase().removeImageMetadata(filenamesToRemoveFromWorkspaces);

                    // Delete reference metadata for deleted files
                    for (const filename of filenamesToRemoveFromWorkspaces) {
                        this.globalResources.getReferenceMetadataDatabase().deleteMetadata(filename);
                    }

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
            await this.globalResources.getWorkspaceManager().syncWorkspaceFiles();

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
            const sequenziaFolder = this.globalResources.getConfig({ path: 'sequenziaFolder' });
            if (!sequenziaFolder) {
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
                    const filePath = path.join(this.globalResources.getPath("images"), filename);

                    if (!fs.existsSync(filePath)) {
                        errors.push({ filename, error: 'File not found' });
                        continue;
                    }

                    // Get the base name to find related files
                    const baseName = filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
                    const previewFile = `${baseName}_preview.png`;
                    const previewPath = path.join(__dirname, '..', 'previews', previewFile);

                    // Define all preview files that may exist
                    const previewFiles = [
                        path.join(this.globalResources.getPath("previews"), `${baseName}.webp`),
                        path.join(this.globalResources.getPath("previews"), `${baseName}@2x.webp`),
                        path.join(this.globalResources.getPath("previews"), `${baseName}@lq.webp`),
                        path.join(this.globalResources.getPath("previews"), `${baseName}@blur.webp`),
                        previewPath // Legacy preview format
                    ];

                    // Find all related files
                    const filesToMove = [];
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
                    const originalPath = path.join(this.globalResources.getPath("images"), originalFilename);
                    if (fs.existsSync(originalPath)) {
                        filesToMove.push({ source: originalPath, type: 'original' });
                        filesToDelete.push(originalPath);
                        filenamesToRemoveFromWorkspaces.push(originalFilename);

                        // Try to extract and delete dynGenPreview file from original
                        try {
                            const imageBuffer = fs.readFileSync(originalPath);
                            const metadata = this.globalResources.getPngMetadata().readMetadata(imageBuffer);
                            if (metadata?.tEXt?.Comment) {
                                const commentData = JSON.parse(metadata.tEXt.Comment);
                                const previewHash = commentData?.forge_data?.dynamic_generation?.compiled_prompt?.preview_image_hash;

                                if (previewHash) {
                                    const dynGenPreviewDir = path.join(this.globalResources.getPath("cache"), 'dynGenPreview');
                                    const dynGenPreviewPath = path.join(dynGenPreviewDir, `${previewHash}.png`);

                                    if (fs.existsSync(dynGenPreviewPath)) {
                                        filesToDelete.push(dynGenPreviewPath);
                                        console.log(`🗑️ Will delete dynGenPreview: ${previewHash.substring(0, 8)}...`);
                                    }
                                }
                            }
                        } catch (metadataError) {
                            // Silently ignore metadata extraction errors
                            console.debug(`Could not extract metadata for preview cleanup: ${metadataError.message}`);
                        }
                    }

                    // Add upscaled file if exists
                    const upscaledPath = path.join(this.globalResources.getPath("images"), upscaledFilename);
                    if (fs.existsSync(upscaledPath)) {
                        filesToMove.push({ source: upscaledPath, type: 'upscaled' });
                        filesToDelete.push(upscaledPath);
                        filenamesToRemoveFromWorkspaces.push(upscaledFilename);
                    }

                    // Add all preview files (webp and legacy formats)
                    for (const previewFilePath of previewFiles) {
                        if (fs.existsSync(previewFilePath)) {
                            filesToDelete.push(previewFilePath);
                        }
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
                            this.globalResources.getWorkspaceManager().removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                        }

                        // Remove metadata from cache
                        await this.globalResources.getMetadataDatabase().removeImageMetadata(filenamesToRemoveFromWorkspaces);

                        // Delete reference metadata for moved files
                        for (const fn of filenamesToRemoveFromWorkspaces) {
                            this.globalResources.getReferenceMetadataDatabase().deleteMetadata(fn);
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
                    const filePath = path.join(this.globalResources.getPath("images"), filename);

                    if (!fs.existsSync(filePath)) {
                        errors.push({ filename, error: 'File not found' });
                        continue;
                    }

                    // Read the current image and extract metadata
                    const imageBuffer = fs.readFileSync(filePath);
                    const metadata = this.globalResources.getPngMetadata().readMetadata(imageBuffer);

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
                    const updatedImageBuffer = this.globalResources.getPngMetadata().updateMetadata(imageBuffer, metadata.forge_data);

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
            const requestId = message.requestId;
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Start keep-alive for potentially long-running reference loading
            this.startKeepAliveInterval(ws, requestId, 10000);

            this.updateKeepAliveProgress(ws, requestId, 10, 'Loading cache files...');

            // Get cache file hashes for active workspace from database
            const workspaceIds = activeWorkspaceId !== 'default' 
                ? [activeWorkspaceId, 'default'] 
                : ['default'];
            const cacheFileHashes = refDb.getMultipleWorkspaceReferences(workspaceIds);

            // Get file cache data from database (much faster than file I/O)
            const fileCacheMap = refDb.getFileCacheForReferences(cacheFileHashes);
            
            // Batch get workspace ownership for all hashes (much faster than N queries)
            const workspaceOwnershipMap = refDb.getReferenceWorkspacesBatch(cacheFileHashes);

            const cacheFiles = [];
            for (const hash of cacheFileHashes) {
                const fileCache = fileCacheMap[hash];
                if (!fileCache) continue; // Skip if not in cache (file might have been deleted)

                // Get workspace ownership (from batch query)
                const workspaces = workspaceOwnershipMap[hash] || [];
                const workspaceId = workspaces.includes(activeWorkspaceId) ? activeWorkspaceId : 
                                   workspaces.includes('default') ? 'default' : 
                                   workspaces[0] || 'default';

                cacheFiles.push({
                    hash: hash,
                    filename: hash,
                    mtime: fileCache.cachedAt * 1000, // Convert seconds to milliseconds for client
                    size: fileCache.size,
                    hasPreview: true, // Cache files always have previews
                    workspaceId: workspaceId,
                    metadata: fileCache.metadata || null // Metadata already included from JOIN
                });
            }

            this.updateKeepAliveProgress(ws, requestId, 50, 'Loading vibe images...');

            // Get vibe IDs for workspaces from database
            const vibeIds = refDb.getMultipleWorkspaceVibes(workspaceIds);
            
            // Get vibe metadata from database
            const vibeMetadataMap = refDb.getVibeMetadataForVibes(vibeIds);
            
            // Batch get workspace ownership for all vibes (much faster than N queries)
            const vibeWorkspaceOwnershipMap = refDb.getVibeWorkspacesBatch(vibeIds);

            // Format vibe images for client
            const vibeImageDetails = [];
            for (const vibeId of vibeIds) {
                const vibe = vibeMetadataMap[vibeId];
                if (!vibe) continue;

                // Get workspace ownership for vibe (from batch query)
                const vibeWorkspaces = vibeWorkspaceOwnershipMap[vibeId] || [];
                const workspaceId = vibeWorkspaces.includes(activeWorkspaceId) ? activeWorkspaceId :
                                   vibeWorkspaces.includes('default') ? 'default' :
                                   vibeWorkspaces[0] || 'default';

                // Format for client (extract encoding metadata only, not full encoding strings)
                const encodingsMetadata = [];
                if (vibe.encodings && typeof vibe.encodings === 'object') {
                    for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                        if (modelEncodings && typeof modelEncodings === 'object') {
                            for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                                // Parse IE value first and skip if invalid
                                const ieValue = parseFloat(extractionValue);
                                if (isNaN(ieValue)) {
                                    continue;
                                }
                                // Encoding value is the actual encoding string - check if it exists and is valid
                                // Skip only if encoding is null, undefined, or empty string
                                if (encoding === null || encoding === undefined || (typeof encoding === 'string' && encoding.trim() === '')) {
                                    continue;
                                }
                                // Include this encoding in the metadata array
                                encodingsMetadata.push({
                                    model,
                                    informationExtraction: ieValue
                                });
                            }
                        }
                    }
                }

                // Preview existence - assume true if previewHash exists (previews are always generated)
                const hasPreview = !!vibe.previewHash;

                // Convert importedFrom: 1 = 'novelai', anything else = null
                // Handle both number and string types for robustness
                const importedFromValue = parseInt(vibe.importedFrom) || 0;
                const importedFromString = importedFromValue === 1 ? 'novelai' : null;
                
                // Ensure locked is always a boolean
                const isLocked = !!vibe.locked;
                
                // For base64 vibes, only include image property if there's no preview (fallback for client)
                // source already contains the base64 data, so image is only needed as fallback
                const isBase64 = vibe.type === 'base64';
                const base64Image = (isBase64 && !hasPreview && vibe.imageSource) ? vibe.imageSource : null;

                vibeImageDetails.push({
                    filename: `${vibeId}.json`, // For backward compatibility
                    id: vibe.id,
                    preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                    mtime: vibe.mtime,
                    createdAt: vibe.createdAt || vibe.mtime, // Client expects createdAt as alternative to mtime
                    size: 0, // Not needed, but kept for compatibility
                    encodings: encodingsMetadata,
                    type: isBase64 ? 'base64' : 'cache',
                    source: vibe.imageSource, // For base64 vibes, this contains the base64 data
                    ...(base64Image && { image: base64Image }), // Only include if no preview (fallback)
                    workspaceId: workspaceId,
                    comment: vibe.comment || null,
                    importedFrom: importedFromString,
                    locked: isLocked,
                    metadata: vibe.metadata || null // Metadata already included from JOIN
                });
            }

            // Sort by newest first
            cacheFiles.sort((a, b) => b.mtime - a.mtime);
            vibeImageDetails.sort((a, b) => b.mtime - a.mtime);

            this.updateKeepAliveProgress(ws, requestId, 100, 'Complete');

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

            this.stopKeepAliveInterval(requestId);

        } catch (error) {
            console.error('Get references error:', error);
            this.stopKeepAliveInterval(message.requestId);
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
                    } else if (type === 'file') {
                        // Get file image data
                        const fileData = await this.getFileImageData(id);
                        if (fileData) {
                            results.push({
                                type: 'file',
                                id: id,
                                data: fileData
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
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            
            // Get vibe from database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                return null;
            }

            // Get workspace ownership
            const workspaces = refDb.getVibeWorkspaces(vibeId);
            const workspaceId = workspaces[0] || 'default';

            // Format for client (extract encoding metadata only)
            const encodingsMetadata = [];
            if (vibe.encodings && typeof vibe.encodings === 'object') {
                for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                    if (modelEncodings && typeof modelEncodings === 'object') {
                        for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                            // Skip if encoding is empty/null/undefined
                            if (!encoding || (typeof encoding === 'string' && encoding.trim() === '')) {
                                continue;
                            }
                            // Parse IE value and skip if invalid
                            const ieValue = parseFloat(extractionValue);
                            if (isNaN(ieValue)) {
                                continue;
                            }
                            encodingsMetadata.push({
                                model,
                                informationExtraction: ieValue
                            });
                        }
                    }
                }
            }

            // Preview existence - assume true if previewHash exists (previews are always generated)
            const hasPreview = !!vibe.previewHash;

            return {
                filename: `${vibeId}.json`,
                id: vibe.id,
                preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                mtime: vibe.mtime,
                size: 0,
                encodings: encodingsMetadata,
                type: vibe.type === 'base64' ? 'base64' : 'cache',
                source: vibe.imageSource,
                workspaceId: workspaceId,
                comment: vibe.comment || null,
                importedFrom: vibe.importedFrom === 1 ? 'novelai' : null,
                locked: vibe.locked,
                metadata: vibe.metadata || null
            };

        } catch (error) {
            console.error(`Error getting vibe image data for ${vibeId}:`, error);
            return null;
        }
    }

    // Helper method to get cache image data by hash
    async getCacheImageData(cacheHash) {
        try {
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            
            // Get file cache from database with metadata included
            const fileCache = refDb.getFileCache(cacheHash);
            if (!fileCache) {
                // File not in cache - don't access filesystem unless we're actually using the file
                // Log this so sync process can be updated to handle missing cache files
                console.warn(`⚠️ Cache file not found in database: ${cacheHash} (should be added during sync)`);
                return null;
            }

            // Get workspace ownership from database
            const workspaces = refDb.getReferenceWorkspaces(cacheHash);
            const workspaceId = workspaces[0] || 'default';

            return {
                hash: cacheHash,
                filename: cacheHash,
                mtime: fileCache.cachedAt * 1000, // Convert seconds to milliseconds for client
                size: fileCache.size,
                hasPreview: true, // Cache files always have previews
                workspaceId: workspaceId,
                metadata: fileCache.metadata || null
            };
        } catch (error) {
            console.error(`Error getting cache image data for ${cacheHash}:`, error);
            return null;
        }
    }

    async handleGetWorkspaceReferences(ws, message, clientInfo, wsServer) {
        try {
            const workspaceId = message.workspaceId;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            let cacheFiles = [];
            let vibeImageDetails = [];

            if (workspaceId === 'all') {
                // Get references from all workspaces
                const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
                const allWorkspaceIds = Object.keys(workspaces);

                // Optimized: Get both cache files and vibes with data in a single call (parallel queries)
                const { cacheFiles: cacheFilesMap, vibes: vibesMap } = refDb.getWorkspaceReferencesAndVibesWithData(allWorkspaceIds);

                // Build cache files array
                for (const hash in cacheFilesMap) {
                    const fileData = cacheFilesMap[hash];
                    const primaryWorkspaceId = fileData.workspaces[0] || 'default';

                    cacheFiles.push({
                        hash: hash,
                        filename: hash,
                        mtime: fileData.cachedAt * 1000, // Convert seconds to milliseconds
                        size: fileData.size,
                        hasPreview: true, // Cache files always have previews
                        workspaceId: primaryWorkspaceId,
                        workspaces: fileData.workspaces,
                        metadata: fileData.metadata || null
                    });
                }

                // Format vibe images
                for (const vibeId in vibesMap) {
                    const vibe = vibesMap[vibeId];
                    const primaryWorkspaceId = vibe.workspaces[0] || 'default';

                    // Extract encoding metadata
                    const encodingsMetadata = [];
                    if (vibe.encodings && typeof vibe.encodings === 'object') {
                        for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                            if (modelEncodings && typeof modelEncodings === 'object') {
                                for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                                    // Skip if encoding is empty/null/undefined
                                    if (!encoding || (typeof encoding === 'string' && encoding.trim() === '')) {
                                        continue;
                                    }
                                    // Parse IE value and skip if invalid
                                    const ieValue = parseFloat(extractionValue);
                                    if (isNaN(ieValue)) {
                                        continue;
                                    }
                                    encodingsMetadata.push({
                                        model,
                                        informationExtraction: ieValue
                                    });
                                }
                            }
                        }
                    }

                    // Preview existence - assume true if previewHash exists (previews are always generated)
                    const hasPreview = !!vibe.previewHash;

                    // Convert importedFrom: 1 = 'novelai', anything else = null
                    // Handle both number and string types for robustness
                    const importedFromValue = parseInt(vibe.importedFrom) || 0;
                    const importedFromString = importedFromValue === 1 ? 'novelai' : null;
                    
                    // Ensure locked is always a boolean
                    const isLocked = !!vibe.locked;
                    
                    // For base64 vibes, only include image property if there's no preview (fallback for client)
                    // source already contains the base64 data, so image is only needed as fallback
                    const isBase64 = vibe.type === 'base64';
                    const base64Image = (isBase64 && !hasPreview && vibe.imageSource) ? vibe.imageSource : null;

                    vibeImageDetails.push({
                        filename: `${vibeId}.json`,
                        id: vibe.id,
                        preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                        mtime: vibe.mtime,
                        createdAt: vibe.createdAt || vibe.mtime, // Client expects createdAt as alternative to mtime
                        size: 0,
                        encodings: encodingsMetadata,
                        type: isBase64 ? 'base64' : 'cache',
                        source: vibe.imageSource, // For base64 vibes, this contains the base64 data
                        ...(base64Image && { image: base64Image }), // Only include if no preview (fallback)
                        workspaceId: primaryWorkspaceId,
                        comment: vibe.comment || null,
                        importedFrom: importedFromString,
                        locked: isLocked,
                        metadata: vibe.metadata || null
                    });
                }

            } else {
                // Optimized: Get both cache files and vibes with data in a single call (parallel queries)
                const { cacheFiles: cacheFilesMap, vibes: vibesMap } = refDb.getWorkspaceReferencesAndVibesWithData(workspaceId);

                for (const hash in cacheFilesMap) {
                    const fileData = cacheFilesMap[hash];

                    cacheFiles.push({
                        hash: hash,
                        filename: hash,
                        mtime: fileData.cachedAt * 1000, // Convert seconds to milliseconds for client
                        size: fileData.size,
                        hasPreview: true, // Cache files always have previews
                        workspaceId: workspaceId,
                        metadata: fileData.metadata || null
                    });
                }

                for (const vibeId in vibesMap) {
                    const vibe = vibesMap[vibeId];

                    // Extract encoding metadata
                    const encodingsMetadata = [];
                    if (vibe.encodings && typeof vibe.encodings === 'object') {
                        for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                            if (modelEncodings && typeof modelEncodings === 'object') {
                                for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                                    // Skip if encoding is empty/null/undefined
                                    if (!encoding || (typeof encoding === 'string' && encoding.trim() === '')) {
                                        continue;
                                    }
                                    // Parse IE value and skip if invalid
                                    const ieValue = parseFloat(extractionValue);
                                    if (isNaN(ieValue)) {
                                        continue;
                                    }
                                    encodingsMetadata.push({
                                        model,
                                        informationExtraction: ieValue
                                    });
                                }
                            }
                        }
                    }

                    // Preview existence - assume true if previewHash exists (previews are always generated)
                    const hasPreview = !!vibe.previewHash;

                    // Convert importedFrom: 1 = 'novelai', anything else = null
                    // Handle both number and string types for robustness
                    const importedFromValue = parseInt(vibe.importedFrom) || 0;
                    const importedFromString = importedFromValue === 1 ? 'novelai' : null;
                    
                    // Ensure locked is always a boolean
                    const isLocked = !!vibe.locked;
                    
                    // For base64 vibes, only include image property if there's no preview (fallback for client)
                    // source already contains the base64 data, so image is only needed as fallback
                    const isBase64 = vibe.type === 'base64';
                    const base64Image = (isBase64 && !hasPreview && vibe.imageSource) ? vibe.imageSource : null;

                    vibeImageDetails.push({
                        filename: `${vibeId}.json`,
                        id: vibe.id,
                        preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                        mtime: vibe.mtime,
                        createdAt: vibe.createdAt || vibe.mtime, // Client expects createdAt as alternative to mtime
                        size: 0,
                        encodings: encodingsMetadata,
                        type: isBase64 ? 'base64' : 'cache',
                        source: vibe.imageSource, // For base64 vibes, this contains the base64 data
                        ...(base64Image && { image: base64Image }), // Only include if no preview (fallback)
                        workspaceId: workspaceId,
                        comment: vibe.comment || null,
                        importedFrom: importedFromString,
                        locked: isLocked,
                        metadata: vibe.metadata || null
                    });
                }
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
            const filePath = path.join(this.globalResources.getPath("uploadCache"), hash);
            const previewPath = path.join(this.globalResources.getPath("previewCache"), `${hash}.webp`);

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

            // Delete reference metadata (database handles workspace ownership via foreign keys)
            this.globalResources.getReferenceMetadataDatabase().deleteMetadata(hash);

            // Clear cache for affected vibes (they may have been converted)
            this.clearVibeCache();

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

    // Helper method to clear vibe metadata cache
    clearVibeCache() {
        this.vibeMetadataCache.clear();
        console.log('Vibe metadata cache cleared');
    }

    // Helper function to convert vibes from cache reference to base64
    async convertVibesToBase64(cacheHash, workspaceId) {
        try {
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            
            // Optimized: Query all vibes with this image_source directly (uses index)
            // This is much faster than iterating through all workspaces
            const vibeIds = refDb.getVibesByImageSource(cacheHash);
            
            if (vibeIds.length === 0) {
                return; // No vibes to convert
            }

            const vibeMetadataMap = refDb.getVibeMetadataForVibes(vibeIds);
            const convertedVibes = [];

            for (const vibeId of vibeIds) {
                const vibe = vibeMetadataMap[vibeId];
                if (!vibe) continue;

                // Vibe uses the cache image we're about to delete (double-check)
                if (vibe.type === 'cache' && vibe.imageSource === cacheHash) {
                    console.log(`🔄 Converting vibe ${vibeId} from cache reference to base64`);

                    // Read the cache image and convert to base64
                    const cachePath = path.join(this.globalResources.getPath("uploadCache"), cacheHash);
                    if (fs.existsSync(cachePath)) {
                        const imageBuffer = fs.readFileSync(cachePath);
                        const imageBase64 = imageBuffer.toString('base64');

                        // Update in database
                        refDb.setVibeMetadata(vibeId, {
                            type: 'base64',
                            imageSource: imageBase64,
                            previewHash: vibe.previewHash,
                            comment: vibe.comment,
                            importedFrom: vibe.importedFrom,
                            encodings: vibe.encodings
                        });

                        convertedVibes.push(vibeId);
                        console.log(`✅ Converted vibe ${vibeId} to base64 format`);
                    } else {
                        console.warn(`Cache file ${cacheHash} not found for vibe conversion`);
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
            const { imageData, workspaceId, tempFile, tags = [] } = message;

            // Validate workspace parameter
            if (!workspaceId) {
                this.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            let imageBuffer, hash;

            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
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
            const filePath = path.join(this.globalResources.getPath("uploadCache"), hash);
            fs.writeFileSync(filePath, imageBuffer);

            // Handle preview - generate single cache preview for references
            const previewPath = path.join(this.globalResources.getPath("previewCache"), `${hash}.webp`);
            const hasPreview = fs.existsSync(previewPath);
            if (!hasPreview) {
                await sharp(imageBuffer)
                    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(previewPath);
                console.log(`📸 Generated cache preview: ${hash}.webp`);
            }

            // Update database with file cache (use size we already have)
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            refDb.setFileCache(hash, {
                size: imageBuffer.length
            });

            // Add to workspace in database
            refDb.addReferenceToWorkspace(hash, workspaceId);

            // Add tags to reference metadata if provided
            if (tags && tags.length > 0) {
                const existingMetadata = refDb.getMetadata(hash) || {};
                const updatedMetadata = {
                    ...existingMetadata,
                    tags: tags
                };
                refDb.setMetadata(hash, updatedMetadata);
            }

            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${hash}.webp`);

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

            // Clear cache since new reference was added
            this.clearVibeCache();

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

    async handleUploadWallpaper(ws, message, clientInfo, wsServer) {
        try {
            const { imageData, workspaceId } = message;

            // Validate workspace parameter
            if (!workspaceId) {
                this.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            // Validate image data
            if (!imageData) {
                this.sendError(ws, 'Missing image data', 'Image data is required', message.requestId);
                return;
            }

            // Convert base64 to buffer
            let imageBuffer;
            try {
                imageBuffer = Buffer.from(imageData, 'base64');
            } catch (error) {
                this.sendError(ws, 'Invalid image data', 'Failed to decode base64 image data', message.requestId);
                return;
            }

            // Ensure wallpapers directory exists
            const wallpapersDir = path.join(this.globalResources.getPath("cache"), 'wallpapers');
            if (!fs.existsSync(wallpapersDir)) {
                fs.mkdirSync(wallpapersDir, { recursive: true });
            }

            // Convert image to PNG, resize to max 4K (3840x2160) if larger, and save
            const wallpaperPath = path.join(wallpapersDir, `${workspaceId}.png`);
            try {
                // Get image metadata to check dimensions
                const image = sharp(imageBuffer);
                const metadata = await image.metadata();
                const { width, height } = metadata;
                
                // 4K resolution: 3840x2160
                const maxWidth = 3840;
                const maxHeight = 2160;
                
                // Only resize if image is larger than 4K (no downscale if smaller)
                let processedImage = image.png();
                
                if (width > maxWidth || height > maxHeight) {
                    // Resize to fit within 4K while maintaining aspect ratio (no crop, no upscale)
                    // fit: 'inside' automatically maintains aspect ratio and fits within bounds
                    processedImage = processedImage.resize(maxWidth, maxHeight, {
                        fit: 'inside', // Fit inside dimensions, maintain aspect ratio automatically
                        withoutEnlargement: true // Don't upscale if smaller
                    });
                    console.log(`🖼️ Resized wallpaper from ${width}x${height} to fit within 4K (maintaining aspect ratio)`);
                }
                
                await processedImage.toFile(wallpaperPath);
                console.log(`🖼️ Saved custom wallpaper for workspace '${workspaceId}'`);
            } catch (error) {
                // If sharp fails, try writing the buffer directly (might already be PNG)
                console.error('Sharp processing failed, attempting direct write:', error);
                fs.writeFileSync(wallpaperPath, imageBuffer);
                console.log(`🖼️ Saved custom wallpaper for workspace '${workspaceId}' (direct write)`);
            }

            this.sendToClient(ws, {
                type: 'upload_wallpaper_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Wallpaper uploaded successfully',
                    workspaceId: workspaceId
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Upload wallpaper error:', error);
            this.sendError(ws, 'Failed to upload wallpaper', error.message, message.requestId);
        }
    }

    async handleReplaceReference(ws, message, clientInfo, wsServer) {
        try {
            const { hash, imageData, workspaceId, tempFile, filename } = message;

            // Validate required parameters
            if (!hash) {
                this.sendError(ws, 'Missing hash parameter', 'Reference hash is required', message.requestId);
                return;
            }

            if (!workspaceId) {
                this.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            // Check if the reference exists
            const cacheFiles = getWorkspaceArray('cacheFiles', workspaceId);
            if (!cacheFiles.includes(hash)) {
                this.sendError(ws, 'Reference not found', `Reference with hash '${hash}' not found in workspace`, message.requestId);
                return;
            }

            let imageBuffer;

            if (filename) {
                // Handle filename - read from images directory
                const imageFilePath = path.join(this.globalResources.getPath("images"), filename);
                if (!fs.existsSync(imageFilePath)) {
                    this.sendError(ws, 'Image file not found', `Image file '${filename}' not found in images directory`, message.requestId);
                    return;
                }

                imageBuffer = fs.readFileSync(imageFilePath);
            } else if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }

                imageBuffer = fs.readFileSync(tempFilePath);

                // Clean up temp file
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp file: ${cleanupError.message}`);
                }
            } else if (imageData) {
                // Handle base64 image data
                imageBuffer = Buffer.from(imageData, 'base64');
            } else {
                this.sendError(ws, 'Missing image data', 'Either filename, imageData or tempFile must be provided', message.requestId);
                return;
            }

            // Calculate new hash for the replacement image
            const newHash = crypto.createHash('md5').update(imageBuffer).digest('hex');

            // If the new image is different from the existing one
            if (newHash !== hash) {
                const refDb = this.globalResources.getReferenceMetadataDatabase();

                // Save the new file
                const newFilePath = path.join(this.globalResources.getPath("uploadCache"), newHash);
                fs.writeFileSync(newFilePath, imageBuffer);

                // Generate new preview
                const newPreviewPath = path.join(this.globalResources.getPath("previewCache"), `${newHash}.webp`);
                await sharp(imageBuffer)
                    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(newPreviewPath);
                console.log(`📸 Generated new preview: ${newHash}.webp`);

                // Update database: remove old, add new
                refDb.removeReferenceFromWorkspace(hash, workspaceId);
                refDb.addReferenceToWorkspace(newHash, workspaceId);

                // Update file cache for new hash (previews always generated)
                const stats = fs.statSync(newFilePath);
                refDb.setFileCache(newHash, {
                    size: stats.size,
                    mtime: stats.mtime.valueOf()
                });

                // Migrate metadata from old hash to new hash if it exists
                const oldMetadata = refDb.getMetadata(hash);
                if (oldMetadata) {
                    refDb.setMetadata(newHash, oldMetadata);
                    refDb.deleteMetadata(hash);
                }

                // Database updated above - no need to update workspace.json

                // Clean up old files
                try {
                    const oldFilePath = path.join(this.globalResources.getPath("uploadCache"), hash);
                    const oldPreviewPath = path.join(this.globalResources.getPath("previewCache"), `${hash}.webp`);

                    if (fs.existsSync(oldFilePath)) {
                        fs.unlinkSync(oldFilePath);
                        console.log(`🗑️ Removed old reference file: ${hash}`);
                    }

                    if (fs.existsSync(oldPreviewPath)) {
                        fs.unlinkSync(oldPreviewPath);
                        console.log(`🗑️ Removed old reference preview: ${hash}.webp`);
                    }

                    // Delete old file cache
                    refDb.deleteFileCache(hash);
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up old files: ${cleanupError.message}`);
                }

                console.log(`🔄 Replaced reference ${hash} with ${newHash}`);
            } else {
                // Same hash - file content is identical, no changes needed
                console.log(`ℹ️ Reference ${hash} is identical to replacement, no changes made`);
            }

            // Clear cache since reference was replaced
            this.clearVibeCache();

            this.sendToClient(ws, {
                type: 'replace_reference_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Reference replaced successfully',
                    oldHash: hash,
                    newHash: newHash
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Replace reference error:', error);
            this.sendError(ws, 'Failed to replace reference', error.message, message.requestId);
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
                const tempDownloadDir = path.join(this.globalResources.getPath("cache"), 'tempDownload');
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
                            const extractedMetadata = await this.globalResources.getPngMetadata().extractMetadataSummary(response.buffer, originalFilename || finalTempFilename);

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

                } else if (cleanContentType === 'application/json' ||
                    cleanContentType === 'application/octet-stream' ||
                    url.includes('.naiv4vibe') ||
                    url.includes('.naiv4vibebundle') ||
                    url.includes('vibe') ||
                    url.endsWith('.json') ||
                    url.toLowerCase().includes('novelai')) {
                    // Handle JSON files (vibe bundles)
                    console.log(`📄 Processing as JSON/vibe file - Content-Type: ${cleanContentType}, URL: ${url}`);

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

                    // Use unified vibe detection system
                    const detectionResult = this.detectAndParseVibeFile(jsonData);
                    if (detectionResult.isValid) {
                        const vibes = detectionResult.vibes;
                        const vibeCount = vibes.length;

                        // Process raw JSON data for client - convert encodings and images to booleans
                        const processedJsonData = JSON.parse(JSON.stringify(jsonData));

                        // Process each vibe in the raw data
                        const vibesArray = processedJsonData.vibes || [processedJsonData];
                        vibesArray.forEach(vibe => {
                            if (vibe.encodings) {
                                // Convert encodings to boolean indicators
                                Object.keys(vibe.encodings).forEach(model => {
                                    Object.keys(vibe.encodings[model]).forEach(ie => {
                                        // Keep the encoding data as-is, just ensure it's properly structured
                                        if (vibe.encodings[model][ie] && typeof vibe.encodings[model][ie] === 'object') {
                                            // Ensure encoding string exists
                                            if (!vibe.encodings[model][ie].encoding) {
                                                vibe.encodings[model][ie].encoding = '';
                                            }
                                        }
                                    });
                                });
                            }

                            // Convert image to boolean (keep base64 data)
                            if (vibe.image && typeof vibe.image === 'string') {
                                // Keep the image data as-is for client processing
                            }

                            // Keep thumbnail as base64 for client display
                            if (vibe.thumbnail && typeof vibe.thumbnail === 'string') {
                                // Keep thumbnail data as-is
                            }
                        });

                        fileInfo = {
                            type: detectionResult.type === 'bundle' ? 'vibe_bundle' : 'vibe_single',
                            tempFilename: finalTempFilename,
                            originalFilename: originalFilename,
                            hash: hash,
                            size: response.buffer.length,
                            contentType: contentType,
                            url: url,
                            vibeCount: vibeCount,
                            jsonData: processedJsonData, // Raw JSON data for client processing
                            isBundle: detectionResult.type === 'bundle'
                        };

                        console.log(`📥 Downloaded ${detectionResult.type} vibe file from URL: ${url} -> ${finalTempFilename} (${vibeCount} vibe(s))`);
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
                    console.log(`❌ Unsupported file type: ${contentType} for URL: ${url}`);
                    throw new Error(`Unsupported file type: ${contentType}. Only image files, JSON files, and vibe bundles are allowed.`);
                }

                console.log('📤 Sending download response with fileInfo:', JSON.stringify(fileInfo, null, 2));

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
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Move each hash from source to target workspace in database
            for (const hash of hashes) {
                refDb.removeReferenceFromWorkspace(hash, sourceWorkspaceId);
                refDb.addReferenceToWorkspace(hash, targetWorkspaceId);
            }

            // Database updated above - no need to update workspace.json

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
            // Extract vibe ID from filename (remove .json extension)
            const vibeId = message.filename.replace('.json', '');
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Get vibe from database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Format for client (full vibe data with encodings)
            const vibeData = {
                version: 1,
                id: vibe.id,
                type: vibe.type,
                image: vibe.imageSource,
                preview: vibe.previewHash,
                mtime: Math.floor(vibe.createdAt),
                encodings: vibe.encodings,
                comment: vibe.comment || null,
                importedFrom: vibe.importedFrom === 1 ? 'novelai' : null,
                locked: vibe.locked
            };

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
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Check if vibe exists in database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Remove from workspace in database
            refDb.removeVibeFromWorkspace(vibeId, workspaceId);

            // Delete vibe metadata from database
            refDb.deleteVibeMetadata(vibeId);

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
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Get vibe from database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Delete specified encodings from database (using separate table)
            for (const enc of encodings) {
                refDb.deleteVibeEncoding(vibeId, enc.model, enc.informationExtraction);
            }

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
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            const deletedVibes = [];
            const deletedEncodings = [];

            // Delete entire vibes
            for (const vibeId of vibesToDelete) {
                const vibe = refDb.getVibeMetadata(vibeId);
                if (!vibe) {
                    console.warn(`Vibe ${vibeId} not found in database, skipping`);
                    continue;
                }

                // Remove from workspace in database
                refDb.removeVibeFromWorkspace(vibeId, workspaceId);

                // Delete vibe metadata from database
                refDb.deleteVibeMetadata(vibeId);

                deletedVibes.push(vibeId);
            }

            // Delete specific encodings from database (using separate table)
            for (const encodingData of encodingsToDelete) {
                const deleted = refDb.deleteVibeEncoding(encodingData.vibeId, encodingData.model, encodingData.informationExtraction);
                if (deleted) {
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
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Check if vibe exists in database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Move in database
            refDb.removeVibeFromWorkspace(vibeId, sourceWorkspaceId);
            refDb.addVibeToWorkspace(vibeId, targetWorkspaceId);

            // Database updated above - no need to update workspace.json

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
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            const movedImages = [];

            // Move each vibe image in database
            for (const vibeId of imageIds) {
                // Check if vibe exists
                const vibe = refDb.getVibeMetadata(vibeId);
                if (!vibe) {
                    console.warn(`Vibe ${vibeId} not found in database, skipping`);
                    continue;
                }

                // Move in database
                refDb.removeVibeFromWorkspace(vibeId, sourceWorkspaceId);
                refDb.addVibeToWorkspace(vibeId, targetWorkspaceId);
                movedImages.push(vibeId);

                // Database updated above - no need to update workspace.json
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
                targetWorkspace = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
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
                const previewPath = path.join(this.globalResources.getPath("previewCache"), `${imageHash}.webp`);
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

                // Save to database
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                refDb.setVibeMetadata(sha256Hash, {
                    type: 'base64',
                    imageSource: image,
                    previewHash: imageHash,
                    comment: comment || null,
                    importedFrom: 0,
                    encodings: vibeData.encodings
                });

                // Add to workspace in database
                refDb.addVibeToWorkspace(sha256Hash, targetWorkspace);

                this.clearVibeCache();

            } else if (cacheFile) {
                // Create vibe from cache file
                const cachePath = path.join(this.globalResources.getPath("uploadCache"), cacheFile);
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
                const previewPath = path.join(this.globalResources.getPath("previewCache"), `${imageHash}.webp`);
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

                // Save to database
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                refDb.setVibeMetadata(sha256Hash, {
                    type: 'cache',
                    imageSource: cacheFile,
                    previewHash: imageHash,
                    comment: comment || null,
                    importedFrom: 0,
                    encodings: vibeData.encodings
                });

                // Add to workspace in database
                refDb.addVibeToWorkspace(sha256Hash, targetWorkspace);
                
                // Also ensure the cache file itself is in the database and workspace
                // (since it's both a reference image and a vibe)
                // Always ensure it's in the database (setFileCache uses INSERT OR REPLACE)
                refDb.setFileCache(cacheFile, {
                    size: imageBuffer.length  // Use imageBuffer we already have, no file access needed
                });
                
                // Always ensure cache file is in the workspace (addReferenceToWorkspace uses INSERT OR IGNORE)
                refDb.addReferenceToWorkspace(cacheFile, targetWorkspace);
                
                this.clearVibeCache();
            } else if (tempFile) {
                // Create vibe from temp downloaded file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
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
                const previewPath = path.join(this.globalResources.getPath("previewCache"), `${imageHash}.webp`);
                const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${imageHash}.webp`);
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

                // Save to database
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                refDb.setVibeMetadata(sha256Hash, {
                    type: 'base64',
                    imageSource: imageBase64,
                    previewHash: imageHash,
                    comment: comment || null,
                    importedFrom: 0,
                    encodings: vibeData.encodings
                });

                // Add to workspace in database
                refDb.addVibeToWorkspace(sha256Hash, targetWorkspace);

                // Clear vibe cache to ensure updated metadata is loaded
                this.clearVibeCache();
            } else if (id) {
                // Add new encoding to existing vibe
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                
                // Get existing vibe from database
                const existingVibe = refDb.getVibeMetadata(id);
                if (!existingVibe) {
                    this.sendError(ws, 'Vibe not found', 'Vibe not found in database', message.requestId);
                    return;
                }

                // Validate vibe for encoding
                try {
                    // Convert database format to format expected by validator
                    const vibeForValidation = {
                        image: existingVibe.imageSource,
                        type: existingVibe.type,
                        locked: existingVibe.locked
                    };
                    this.validateVibeForEncoding(vibeForValidation, id);
                } catch (validationError) {
                    this.sendError(ws, 'Vibe validation failed', validationError.message, message.requestId);
                    return;
                }

                // Generate new encoding
                let imageBase64;
                if (existingVibe.type === 'base64') {
                    imageBase64 = existingVibe.imageSource;
                } else if (existingVibe.type === 'cache') {
                    const cachePath = path.join(this.globalResources.getPath("uploadCache"), existingVibe.imageSource);
                    if (!fs.existsSync(cachePath)) {
                        this.sendError(ws, 'Cache file not found', `Cache file ${existingVibe.imageSource} not found`, message.requestId);
                        return;
                    }
                    const imageBuffer = fs.readFileSync(cachePath);
                    imageBase64 = imageBuffer.toString('base64');
                } else {
                    this.sendError(ws, 'Invalid vibe type', 'Vibe type must be base64 or cache', message.requestId);
                    return;
                }

                const encoding = await this.encodeVibeDirect(imageBase64, informationExtraction, model);
                
                // Add/update encoding in database (using separate table)
                const extraMetadata = comment !== undefined ? { comment: comment } : null;
                refDb.setVibeEncoding(id, model, informationExtraction, encoding, extraMetadata);

                // Clear vibe cache to ensure updated metadata is loaded
                this.clearVibeCache();
            }

            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${tempFile.replace('.dat', '')}.webp`);

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

            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            // Get vibe from database
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const vibe = refDb.getVibeMetadata(vibeId);
            
            if (!vibe) {
                this.sendError(ws, 'Vibe not found', 'Vibe not found in database', message.requestId);
                return;
            }
            
            // Check if vibe belongs to this workspace
            const vibeWorkspaces = refDb.getVibeWorkspaces(vibeId);
            if (!vibeWorkspaces.includes(workspaceId)) {
                this.sendError(ws, 'Vibe not found', 'Vibe not found in workspace', message.requestId);
                return;
            }
            
            // Convert database vibe to format expected by canEncodeVibe
            const vibeData = {
                id: vibe.id,
                type: vibe.type,
                image: vibe.imageSource,
                preview: vibe.previewHash,
                encodings: vibe.encodings || {},
                comment: vibe.comment || null
            };

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
    // Works with both database format (imageSource) and JSON format (image)
    shouldLockVibe(vibe) {
        // Lock if missing original image (check both imageSource and image for compatibility)
        const hasImage = vibe.imageSource || vibe.image;
        if (!hasImage) {
            return true;
        }

        // Lock if explicitly set to locked (for JSON compatibility)
        if (vibe.locked === true) {
            return true;
        }

        // Lock if imported from external source without original image
        const importedFrom = vibe.importedFrom;
        if (importedFrom && importedFrom !== 0 && !hasImage) {
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
            const cachePath = path.join(this.globalResources.getPath("uploadCache"), vibe.image);
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
            model: (this.globalResources.getNekoAiService('Model'))[model.toUpperCase()],
            information_extracted: informationExtracted || 1
        };

        if (!body.model) {
            throw new Error('Invalid model');
        }

        const novelAiKey = this.globalResources.getApiKeyManager().getActiveApiKey('novelai');
        if (!novelAiKey) {
            throw new Error('NovelAI API key is not configured.');
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
                    "authorization": `Bearer ${novelAiKey}`,
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
                    const vibeCreditUsage = await this.globalResources.calculateCreditUsage();
                    if (vibeCreditUsage.totalUsage > 0) {
                        console.log(`💰 Vibe encoding credits used: ${vibeCreditUsage.totalUsage} ${vibeCreditUsage.usageType === 'paid' ? 'paid' : 'fixed'}`);
                    }
                    // Add unattributed receipt for vibe encoding
                    if (vibeCreditUsage.totalUsage > 0) {
                        await this.globalResources.getMetadataDatabase().addUnattributedReceipt({
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

    // Cache for vibe metadata to avoid repeated file I/O
    vibeMetadataCache = new Map();
    cacheExpiryTime = 5 * 60 * 1000; // 5 minutes

    // Favorites handlers
    async handleAddFavorite(ws, message, clientInfo, wsServer) {
        try {
            const { favoriteType, item, customName } = message;

            if (!favoriteType || !item) {
                this.sendError(ws, 'Missing required parameters: favoriteType and item');
                return;
            }

            // Create favorite item from the provided data
            const favoriteItem = this.globalResources.getFavoritesManager().createFavoriteFromResult(item, customName);
            const result = this.globalResources.getFavoritesManager().addFavorite(favoriteType, favoriteItem);

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

            const result = this.globalResources.getFavoritesManager().removeFavorite(favoriteType, itemId);

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
            const favorites = this.globalResources.getFavoritesManager().getFavorites(favoriteType);

            this.sendToClient(ws, {
                type: 'favorites_get_response',
                data: {
                    favorites: favorites
                },
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

            const allTextReplacements = this.globalResources.getPromptConfig({ path: 'text_replacements' }) || {};

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

            // Validate input structure
            if (!textReplacements || typeof textReplacements !== 'object' || Array.isArray(textReplacements)) {
                this.sendError(ws, 'Invalid text replacements data', 'textReplacements must be an object', message.requestId);
                return;
            }

            // Validate each entry
            for (const [key, value] of Object.entries(textReplacements)) {
                if (typeof key !== 'string' || !key.trim()) {
                    this.sendError(ws, 'Invalid key', 'Text replacement keys must be non-empty strings', message.requestId);
                    return;
                }

                // Value must be string or array of strings
                if (typeof value === 'string') {
                    continue; // Valid
                } else if (Array.isArray(value)) {
                    if (!value.every(v => typeof v === 'string')) {
                        this.sendError(ws, 'Invalid value', `Text replacement "${key}" contains non-string array values`, message.requestId);
                        return;
                    }
                } else {
                    this.sendError(ws, 'Invalid value', `Text replacement "${key}" must be a string or array of strings`, message.requestId);
                    return;
                }
            }

            const success = this.globalResources.modifyConfig('promptConfig').merge('text_replacements', textReplacements);

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

            const textReplacements = this.globalResources.getPromptConfig({ path: 'text_replacements' }) || {};

            if (!textReplacements.hasOwnProperty(key)) {
                this.sendError(ws, 'Key not found', `Text replacement "${key}" not found`, message.requestId);
                return;
            }

            const success = this.globalResources.modifyConfig('promptConfig').delete(['text_replacements', key]);

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
            // Check if key already exists
            const textReplacements = this.globalResources.getPromptConfig({ path: 'text_replacements' }) || {};
            if (textReplacements.hasOwnProperty(key)) {
                this.sendError(ws, 'Key already exists', `Text replacement "${key}" already exists`, message.requestId);
                return;
            }

            const newValue = type === 'array' ? (Array.isArray(value) ? value : [value]) : value;
            const success = this.globalResources.modifyConfig('promptConfig').assign(['text_replacements', key], newValue);

            if (success) {
                this.sendToClient(ws, {
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

    async handleGetTextReplacementOptions(ws, message, clientInfo, wsServer) {
        try {
            const { pattern, presetName, model, periodKey } = message;

            if (!pattern || typeof pattern !== 'string' || pattern.trim() === '') {
                this.sendError(ws, 'Invalid pattern', 'Text replacement pattern is required and cannot be empty', message.requestId);
                return;
            }

            // Use the TextReplacements module to get all options for the pattern
            const options = this.globalResources.textReplacements.getTextReplacementOptions(pattern, presetName, model, periodKey);

            this.sendToClient(ws, {
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
            this.sendToClient(ws, {
                type: 'get_text_replacement_options_response',
                data: {
                    success: false,
                    error: error.message
                },
                requestId: message.requestId
            });
        }
    }

    // Unified vibe detection and parsing function
    detectAndParseVibeFile(data) {
        const result = {
            isValid: false,
            type: null, // 'bundle' or 'single'
            vibes: [],
            error: null
        };

        try {
            // Validate basic structure
            if (!data || typeof data !== 'object') {
                result.error = 'Invalid data format: expected object';
                return result;
            }

            // Check for required identifier
            if (!data.identifier) {
                result.error = 'Missing identifier: not a valid NovelAI vibe file';
                return result;
            }

            // Handle different vibe file types
            if (data.identifier === 'novelai-vibe-transfer-bundle') {
                // Bundle format - contains multiple vibes
                if (!data.vibes || !Array.isArray(data.vibes)) {
                    result.error = 'Invalid bundle format: missing or invalid vibes array';
                    return result;
                }

                if (data.vibes.length === 0) {
                    result.error = 'Empty bundle: no vibes found';
                    return result;
                }

                // Validate each vibe in the bundle
                const validVibes = [];
                for (const vibe of data.vibes) {
                    if (this.validateVibeStructure(vibe)) {
                        validVibes.push(vibe);
                    } else {
                        console.warn(`Skipping invalid vibe in bundle: ${vibe.name || vibe.id || 'unnamed'}`);
                    }
                }

                if (validVibes.length === 0) {
                    result.error = 'Bundle contains no valid vibes';
                    return result;
                }

                result.isValid = true;
                result.type = 'bundle';
                result.vibes = validVibes;

            } else if (data.identifier === 'novelai-vibe-transfer') {
                // Single vibe format
                if (!this.validateVibeStructure(data)) {
                    result.error = 'Invalid single vibe format';
                    return result;
                }

                result.isValid = true;
                result.type = 'single';
                result.vibes = [data];

            } else {
                result.error = `Unsupported identifier: ${data.identifier}`;
                return result;
            }

            return result;

        } catch (error) {
            result.error = `Parse error: ${error.message}`;
            return result;
        }
    }

    // Helper function to validate individual vibe structure
    validateVibeStructure(vibe) {
        if (!vibe || typeof vibe !== 'object') {
            return false;
        }

        // Check for required fields
        if (!vibe.identifier || vibe.identifier !== 'novelai-vibe-transfer') {
            return false;
        }

        // At minimum, a vibe should have encodings or be a valid structure
        if (!vibe.encodings && !vibe.id && !vibe.name) {
            return false;
        }

        return true;
    }

    async handleImportVibeBundle(ws, message, clientInfo, wsServer) {
        try {
            const { bundleData, workspaceId, comment, tempFile } = message;

            // Determine which workspace to use
            let targetWorkspace = workspaceId;
            if (!targetWorkspace) {
                // No specific workspace provided, use the active workspace for this session
                targetWorkspace = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            }
            if (!targetWorkspace) {
                this.sendError(ws, 'Invalid workspace', 'No workspace provided, and no active workspace found', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[targetWorkspace]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${targetWorkspace}' not found`, message.requestId);
                return;
            }

            let bundleDataToProcess = bundleData;

            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
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

            // Use unified detection system
            const detectionResult = this.detectAndParseVibeFile(bundleDataToProcess);
            if (!detectionResult.isValid) {
                this.sendError(ws, 'Invalid vibe file', detectionResult.error, message.requestId);
                return;
            }

            const vibes = detectionResult.vibes;
            console.log(`📦 Detected ${detectionResult.type} vibe file with ${vibes.length} vibe(s)`);

            // Process each vibe (validation already done in detectAndParseVibeFile)
            const importedVibes = [];
            const errors = [];
            for (const vibe of vibes) {
                try {

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

                    // Check if vibe already exists in database, if so generate new UUID
                    const existingVibe = refDb.getVibeMetadata(vibeId);
                    if (existingVibe) {
                        // Generate new UUID to avoid conflict
                        vibeId = crypto.randomUUID();
                        console.log(`Vibe already exists in database, generated new UUID for vibe: ${vibeId}`);
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
                    
                    // Save to database
                    const refDb = this.globalResources.getReferenceMetadataDatabase();
                    const previewHash = vibe.thumbnail ? crypto.createHash('md5').update(Buffer.from(vibe.thumbnail.split(',')[1], 'base64')).digest('hex') : null;
                    
                    // Save thumbnail if provided (before setting metadata so we can include previewHash)
                    let finalPreviewHash = previewHash;
                    if (vibe.thumbnail && vibe.thumbnail.startsWith('data:image/')) {
                        const thumbnailBase64 = vibe.thumbnail.split(',')[1];
                        const thumbnailBuffer = Buffer.from(thumbnailBase64, 'base64');
                        const thumbnailHash = crypto.createHash('md5').update(thumbnailBuffer).digest('hex');
                        const thumbnailPath = path.join(this.globalResources.getPath("previewCache"), `${thumbnailHash}.webp`);
                        if (!fs.existsSync(thumbnailPath)) {
                            await sharp(thumbnailBuffer)
                                .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                                .webp({ quality: 80 })
                                .toFile(thumbnailPath);
                        }
                        finalPreviewHash = thumbnailHash;
                    }
                    
                    refDb.setVibeMetadata(vibeId, {
                        type: 'base64',
                        imageSource: vibe.image || '',
                        previewHash: finalPreviewHash,
                        comment: comment || null,
                        importedFrom: 1, // novelai
                        encodings: processedEncodings
                    });

                    // Add to workspace in database
                    refDb.addVibeToWorkspace(vibeId, targetWorkspace);
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
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${tempFile.replace('.dat', '')}.webp`);

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
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            let imageBuffer, hash;

            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
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
            let finalFilePath = path.join(this.globalResources.getPath("images"), finalFilename);
            let counter = 1;

            while (fs.existsSync(finalFilePath)) {
                const ext = path.extname(filename);
                const baseName = path.basename(filename, ext);
                finalFilename = `${baseName}_${counter}${ext}`;
                finalFilePath = path.join(this.globalResources.getPath("images"), finalFilename);
                counter++;
            }

            // Save file to images directory
            fs.writeFileSync(finalFilePath, imageBuffer);

            // Handle preview - use existing temp preview if available, otherwise generate new one
            const baseName = path.basename(finalFilename, path.extname(finalFilename));

            // Generate both main and @2x previews for mobile devices
            await generateMobilePreviews(finalFilePath, baseName);
            console.log(`📸 Generated previews: ${baseName}`);

            // Add to workspace files
            this.globalResources.getWorkspaceManager().addToWorkspaceArray('files', finalFilename, workspaceId);

            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${hash}.webp`);

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
                        await this.globalResources.getMetadataDatabase().scanAndUpdateMetadata(this.globalResources.getPath("images"));
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

    // Send keep-alive message for long-running requests
    sendKeepAlive(ws, requestId, status = 'processing', progress = null, message = null) {
        this.sendToClient(ws, {
            type: 'request_keep_alive',
            requestId: requestId,
            status: status, // 'processing', 'progress', 'completed'
            progress: progress, // Optional progress percentage (0-100)
            message: message, // Optional status message
            timestamp: new Date().toISOString()
        });
    }

    // Step preview frames are large; skip them when the link is backed up or high-latency (align RTT with public/scripts/websocket.js pingWarningThreshold).
    STEP_PREVIEW_RTT_MS_THRESHOLD = 500;
    STEP_PREVIEW_BUFFERED_BYTES_THRESHOLD = 512 * 1024;

    shouldSendStepPreviewImages(ws) {
        try {
            if (ws.bufferedAmount > this.STEP_PREVIEW_BUFFERED_BYTES_THRESHOLD) {
                return false;
            }
            const wsServer = this.globalResources.getWebSocketServer();
            const clientInfo = wsServer && wsServer.clients && wsServer.clients.get(ws);
            if (clientInfo && typeof clientInfo.lastClientRttMs === 'number' && Number.isFinite(clientInfo.lastClientRttMs)) {
                if (clientInfo.lastClientRttMs > this.STEP_PREVIEW_RTT_MS_THRESHOLD) {
                    return false;
                }
            }
            return true;
        } catch {
            return true;
        }
    }

    // Send unified image generation progress updates
    sendGenerationProgress(ws, requestId, progressData) {
        let imageData = progressData.imageData || null;
        if (imageData && !this.shouldSendStepPreviewImages(ws)) {
            imageData = null;
        }

        this.sendToClient(ws, {
            type: 'image_generation_progress',
            requestId: requestId,
            data: {
                phase: progressData.phase, // 'initializing|ai_streaming|ai_complete|generating|upscaling|previews|complete|stage_delay'
                currentStep: progressData.currentStep || 0,
                totalSteps: progressData.totalSteps || 0,
                currentKey: progressData.currentKey || 0,
                totalKeys: progressData.totalKeys || 0,
                hasDynamicGen: progressData.hasDynamicGen || false,
                isUpscaling: progressData.isUpscaling || false,
                reasoning: progressData.reasoning || null, // for 3rd line display
                toolName: progressData.toolName || null, // tool name for icon/styling
                toolReason: progressData.toolReason || null, // tool-specific reason
                imageData, // base64 image data for preview (omitted when connection is slow or high-latency)
                // Staged generation fields
                totalStages: progressData.totalStages || null,
                currentStage: progressData.currentStage || null,
                stageType: progressData.stageType || null,
                delayMs: progressData.delayMs || null
            },
            timestamp: new Date().toISOString()
        });
    }

    // Start keep-alive interval for long-running operations (starts after 10 seconds)
    startKeepAliveInterval(ws, requestId, intervalMs = 15000) {
        // Clear any existing keep-alive for this request
        this.stopKeepAliveInterval(requestId);

        // Start keep-alive after 10 seconds initial delay
        const startDelay = setTimeout(() => {
            console.log(`🔄 Starting keep-alive for request ${requestId} (every ${intervalMs}ms)`);

            const keepAliveId = setInterval(() => {
                try {
                    this.sendKeepAlive(ws, requestId, 'processing');
                } catch (error) {
                    console.warn(`⚠️ Failed to send keep-alive for request ${requestId}:`, error.message);
                    this.stopKeepAliveInterval(requestId);
                }
            }, intervalMs);

            // Store the keep-alive interval
            this.keepAliveIntervals.set(requestId, {
                intervalId: keepAliveId,
                startTime: Date.now(),
                lastKeepAlive: Date.now()
            });

        }, 10000); // 10 second initial delay

        // Store the start delay timeout
        this.keepAliveIntervals.set(requestId, {
            startDelayId: startDelay,
            startTime: Date.now(),
            lastKeepAlive: null
        });
    }

    // Stop keep-alive interval for a specific request
    stopKeepAliveInterval(requestId) {
        if (this.keepAliveIntervals && this.keepAliveIntervals.has(requestId)) {
            const keepAliveData = this.keepAliveIntervals.get(requestId);

            // Clear start delay if it exists
            if (keepAliveData.startDelayId) {
                clearTimeout(keepAliveData.startDelayId);
            }

            // Clear interval if it exists
            if (keepAliveData.intervalId) {
                clearInterval(keepAliveData.intervalId);
            }

            this.keepAliveIntervals.delete(requestId);
            console.log(`🛑 Stopped keep-alive for request ${requestId}`);
        }
    }

    // Update keep-alive with progress information
    updateKeepAliveProgress(ws, requestId, progress, message = null) {
        if (this.keepAliveIntervals && this.keepAliveIntervals.has(requestId)) {
            const keepAliveData = this.keepAliveIntervals.get(requestId);
            keepAliveData.lastKeepAlive = Date.now();

            this.sendKeepAlive(ws, requestId, 'progress', progress, message);
        }
    }

    async handleUrlUploadMetadataRequest(ws, message, clientInfo, wsServer) {
        const { filename } = message;

        if (!filename) {
            this.sendError(ws, 'Missing filename parameter', 'request_url_upload_metadata');
            return;
        }

        try {
            // Get the tempdownload directory path
            const tempDownloadDir = path.join(this.globalResources.getPath("cache"), 'tempdownload');
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
                // Broadcast that cache initialization is starting
                wsServer.broadcast({
                    type: 'search_indexing_status',
                    status: 'cache_init',
                    message: `Preparing search cache for ${viewType} view...`,
                    viewType: viewType,
                    timestamp: new Date().toISOString()
                });
                
                // Initialize search cache for the session
                await this.initializeSearchCache(clientInfo.sessionId, viewType);
                
                // Broadcast that cache initialization is complete
                wsServer.broadcast({
                    type: 'search_indexing_status',
                    status: 'cache_ready',
                    message: 'Search cache ready',
                    viewType: viewType,
                    timestamp: new Date().toISOString()
                });
                
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

                // Ensure cache is initialized
                if (!this.searchCache.has(clientInfo.sessionId)) {
                    await this.initializeSearchCache(clientInfo.sessionId, viewType);
                }

                // For context-aware suggestions or regular suggestions, use the new database method
                const tagSuggestions = await this.getTagSuggestions(query || '', viewType, clientInfo.sessionId, 20, contextTags);

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
            // Now we only store the workspace file list, not all metadata

            // Get the active workspace for this session
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(sessionId);
            const activeWorkspace = this.globalResources.getWorkspaceManager().getWorkspace(activeWorkspaceId);

            if (!activeWorkspace) {
                throw new Error(`Active workspace not found for session ${sessionId}`);
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
                    // For upscaled, query database for upscaled files
                    // We'll filter in the database query
                    const metadataDb = this.globalResources.getMetadataDatabase();
                    const allFilenames = await metadataDb.getAllFilenames();
                    // Get metadata for all files to check upscaled status
                    // Actually, we can query the database for upscaled files directly
                    workspaceFiles = allFilenames; // Will be filtered by database query
                    break;
                default: // 'images'
                    workspaceFiles = activeWorkspace.files || [];
                    break;
            }

            // Store in cache - only file list, not metadata
            this.searchCache.set(sessionId, {
                viewType,
                files: workspaceFiles,
                timestamp: Date.now(),
                workspaceId: activeWorkspaceId
            });

            console.log(`✅ Search cache initialized for session ${sessionId}: ${workspaceFiles.length} files, view: ${viewType}`);

        } catch (error) {
            console.error('❌ Error initializing search cache:', error);
            throw error;
        }
    }

    // Clean up search cache for a session
    cleanupSearchCache(sessionId) {
        if (this.searchCache.has(sessionId)) {
            const cacheInfo = this.searchCache.get(sessionId);
            console.log(`🧹 Cleaning up search cache for session ${sessionId}`);
            this.searchCache.delete(sessionId);
        }
    }

    // Handle prepare search cache request
    async handlePrepareSearchCache(ws, message, clientInfo, wsServer) {
        try {
            const { viewType = 'images' } = message;
            
            // Broadcast that cache initialization is starting
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'cache_init',
                message: `Preparing search cache for ${viewType} view...`,
                viewType: viewType,
                timestamp: new Date().toISOString()
            });

            // Initialize search cache
            await this.initializeSearchCache(clientInfo.sessionId, viewType);
            
            // Broadcast that cache initialization is complete
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'cache_ready',
                message: 'Search cache ready',
                viewType: viewType,
                timestamp: new Date().toISOString()
            });

            wsServer.sendToClient(ws, {
                type: 'search_index_prepare_cache_response',
                data: {
                    status: 'success',
                    viewType: viewType,
                    message: 'Search cache prepared successfully'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error preparing search cache:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_prepare_cache_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle clear search cache request
    async handleClearSearchCache(ws, message, clientInfo, wsServer) {
        try {
            this.cleanupSearchCache(clientInfo.sessionId);

            wsServer.sendToClient(ws, {
                type: 'search_index_clear_cache_response',
                data: {
                    status: 'success',
                    message: 'Search cache cleared'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error clearing search cache:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_clear_cache_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle toggle indexing pause request
    async handleToggleIndexingPause(ws, message, clientInfo, wsServer) {
        try {
            // Use the wsServer parameter which is the WebSocketServer instance
            const currentlyPaused = wsServer.isIndexingPaused();
            wsServer.setIndexingPaused(!currentlyPaused);

            wsServer.sendToClient(ws, {
                type: 'search_index_toggle_pause_response',
                data: {
                    status: 'success',
                    paused: !currentlyPaused,
                    message: !currentlyPaused ? 'Indexing paused' : 'Indexing resumed'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error toggling indexing pause:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_toggle_pause_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle trigger indexing request
    async handleTriggerIndexing(ws, message, clientInfo, wsServer) {
        try {
            // Use the wsServer parameter which is the WebSocketServer instance
            // Trigger indexing sync
            await wsServer.triggerIndexingSync();

            wsServer.sendToClient(ws, {
                type: 'search_index_trigger_response',
                data: {
                    status: 'success',
                    message: 'Indexing triggered successfully'
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Error triggering indexing:', error);
            wsServer.sendToClient(ws, {
                type: 'search_index_trigger_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle rebuild all indexes request
    async handleRebuildAllIndexes(ws, message, clientInfo, wsServer) {
        try {
            const metadataDb = this.globalResources.getMetadataDatabase();
            
            // Check if indexing is paused
            if (wsServer.isIndexingPaused()) {
                wsServer.sendToClient(ws, {
                    type: 'search_index_rebuild_all_response',
                    data: {
                        status: 'error',
                        error: 'Cannot rebuild indexes while indexing is paused'
                    },
                    requestId: message.requestId,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Note: We check isIndexing but don't prevent rebuild if it's running sync,
            // because rebuild is a deliberate full rebuild operation
            // However, we should still prevent concurrent rebuilds
            // The isIndexing flag will be set by this handler
            
            // Set indexing flag to prevent concurrent operations
            if (wsServer.isIndexing) {
                wsServer.sendToClient(ws, {
                    type: 'search_index_rebuild_all_response',
                    data: {
                        status: 'error',
                        error: 'Indexing operation is already in progress'
                    },
                    requestId: message.requestId,
                    timestamp: new Date().toISOString()
                });
                return;
            }

            // Set indexing flag
            wsServer.isIndexing = true;

            // Broadcast that rebuild is starting
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'starting',
                message: 'Starting full search index rebuild...',
                timestamp: new Date().toISOString()
            });

            // Throttled progress callback setup (same as runIndexingSync)
            let lastProgressSent = null;
            let lastProgressTime = 0;
            const MIN_PROGRESS_INTERVAL_MS = 2000;
            const DEFAULT_ITEMS_INTERVAL = 100;
            let progressUpdateInterval = DEFAULT_ITEMS_INTERVAL;
            let firstProgress = true;

            // Rebuild all indexes with progress callback
            const result = await metadataDb.rebuildSearchIndexes(null, (progress) => {
                const now = Date.now();
                const timeSinceLastUpdate = now - lastProgressTime;
                const itemsSinceLastUpdate = lastProgressSent ? (progress.current - lastProgressSent.current) : progress.current;
                
                const shouldSend = 
                    firstProgress ||
                    itemsSinceLastUpdate >= progressUpdateInterval ||
                    timeSinceLastUpdate >= MIN_PROGRESS_INTERVAL_MS;

                if (shouldSend) {
                    if (!firstProgress && lastProgressTime > 0 && lastProgressSent && progress.current > 0) {
                        const actualProcessingRate = itemsSinceLastUpdate / (timeSinceLastUpdate / 1000);
                        if (actualProcessingRate > 0) {
                            const targetInterval = Math.round(actualProcessingRate * (MIN_PROGRESS_INTERVAL_MS / 1000));
                            progressUpdateInterval = Math.max(10, Math.min(500, targetInterval));
                        }
                    }

                    firstProgress = false;
                    lastProgressTime = now;
                    lastProgressSent = progress;

                    const percentage = progress.total > 0 
                        ? Math.round((progress.current / progress.total) * 100) 
                        : 0;
                    
                    wsServer.broadcast({
                        type: 'search_indexing_status',
                        status: 'indexing',
                        message: `Rebuilding: ${progress.current}/${progress.total} files (${percentage}%)`,
                        current: progress.current,
                        total: progress.total,
                        percentage: percentage,
                        filename: progress.filename,
                        updatedCount: progress.updatedCount,
                        errorCount: progress.errorCount,
                        timestamp: new Date().toISOString()
                    });
                }
            });

            // Broadcast completion
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'complete',
                message: `Search index rebuild complete: ${result.updatedCount} files indexed`,
                updatedCount: result.updatedCount,
                errorCount: result.errorCount,
                totalFiles: result.totalFiles,
                timestamp: new Date().toISOString()
            });

            wsServer.sendToClient(ws, {
                type: 'search_index_rebuild_all_response',
                data: {
                    status: 'success',
                    message: `Rebuild complete: ${result.updatedCount} files indexed, ${result.errorCount} errors`,
                    updatedCount: result.updatedCount,
                    errorCount: result.errorCount,
                    totalFiles: result.totalFiles
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error rebuilding all indexes:', error);
            wsServer.broadcast({
                type: 'search_indexing_status',
                status: 'error',
                message: `Search index rebuild error: ${error.message}`,
                error: error.message,
                timestamp: new Date().toISOString()
            });
            wsServer.sendToClient(ws, {
                type: 'search_index_rebuild_all_response',
                data: {
                    status: 'error',
                    error: error.message
                },
                requestId: message.requestId,
                timestamp: new Date().toISOString()
            });
        } finally {
            wsServer.isIndexing = false;
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

    // Get tag suggestions based on query using database
    async getTagSuggestions(query, viewType, sessionId, limit = 20, contextTags = []) {
        try {
            // Get cached data for this session
            const cacheData = this.searchCache.get(sessionId);
            if (!cacheData) {
                throw new Error('Search cache not initialized. Call search_files with action="start" first.');
            }

            // Get workspace files for filtering
            let workspaceFiles = cacheData.files || [];
            
            // For upscaled view, we need to filter by upscaled status later
            const metadataDb = this.globalResources.getMetadataDatabase();
            
            // Get suggestions from database
            let suggestions = await metadataDb.getTagSuggestionsFromDatabase(query, workspaceFiles, limit * 2); // Get more for context filtering
            
            // Filter by upscaled status if needed
            if (viewType === 'upscaled') {
                const filteredSuggestions = [];
                for (const suggestion of suggestions) {
                    // Check if any file in this suggestion is upscaled
                    // For now, we'll include all suggestions and filter at search time
                    filteredSuggestions.push(suggestion);
                }
                suggestions = filteredSuggestions;
            }

            // Apply context-aware ranking if context tags are provided
            if (contextTags && contextTags.length > 0) {
                console.log('🔍 Backend: Applying context-aware ranking with tags:', contextTags);
                
                // For each suggestion, find files that match both the suggestion and context tags
                for (const suggestion of suggestions) {
                    let contextScore = 0;
                    
                    // Query database for files that match both this suggestion and context tags
                    const contextQuery = [...contextTags, suggestion.originalTag || suggestion.tag].join(',');
                    const contextMatchingFiles = await metadataDb.searchFilesInDatabase(contextQuery, workspaceFiles, viewType);
                    contextScore = contextMatchingFiles.length;

                    // Boost score for context-relevant suggestions (base rank matches non-context suggestions)
                    suggestion.contextScore = contextScore;
                    suggestion.boostedScore = computeTagSuggestionRankScore(suggestion, workspaceFiles.length) + (contextScore * 10);
                }

                console.log('🔍 Backend: Context scores applied, sorting by boosted scores');

                // Sort by boosted score (context relevance + diversity-aware base rank)
                suggestions.sort((a, b) => {
                    const scoreA = a.boostedScore != null ? a.boostedScore : computeTagSuggestionRankScore(a, workspaceFiles.length);
                    const scoreB = b.boostedScore != null ? b.boostedScore : computeTagSuggestionRankScore(b, workspaceFiles.length);
                    if (scoreA !== scoreB) return scoreB - scoreA;
                    return (a.originalTag || a.tag).localeCompare(b.originalTag || b.tag);
                });
            }

            return suggestions.slice(0, limit);

        } catch (error) {
            console.error('Error getting tag suggestions:', error);
            // Fallback to empty array on error
            return [];
        }
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
    async getFileMetadata(filename) {
        try {            // Use getCachedMetadata instead of loading all metadata to prevent OOM
            return await this.globalResources.getMetadataDatabase().getCachedMetadata(filename, true);
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

    // Search files by tags using database
    async searchFilesByTags(query, viewType, sessionId) {
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

            // Get workspace files for filtering
            let workspaceFiles = cacheData.files || [];
            
            // For upscaled view, we need to filter by upscaled status
            // We'll do this after getting search results from database
            const metadataDb = this.globalResources.getMetadataDatabase();
            
            // Use database query for search
            const searchResults = await metadataDb.searchFilesInDatabase(query, workspaceFiles, viewType);
            
            // Filter by upscaled status if needed
            let filteredResults = searchResults;
            if (viewType === 'upscaled') {
                // Get metadata for results to check upscaled status
                const resultsWithMetadata = [];
                for (const result of searchResults) {
                    const metadata = await metadataDb.getCachedMetadata(result.filename);
                    if (metadata && metadata.upscaled) {
                        result.metadata = {
                            width: metadata.width,
                            height: metadata.height,
                            upscaled: metadata.upscaled,
                            size: metadata.size,
                            mtime: metadata.mtime
                        };
                        resultsWithMetadata.push(result);
                    }
                }
                filteredResults = resultsWithMetadata;
            } else {
                // Get metadata for all results
                for (const result of filteredResults) {
                    const metadata = await metadataDb.getCachedMetadata(result.filename);
                    if (metadata) {
                        result.metadata = {
                            width: metadata.width,
                            height: metadata.height,
                            upscaled: metadata.upscaled,
                            size: metadata.size,
                            mtime: metadata.mtime
                        };
                    }
                }
            }

            // Get tag suggestions for the first term (for display purposes)
            const tagSuggestions = searchTerms.length > 0 
                ? await this.getTagSuggestions(searchTerms[0], viewType, sessionId, 20) 
                : [];

            console.log(`🔍 Search: Final results: ${filteredResults.length} files match ALL terms (AND condition)`);

            return {
                results: filteredResults,
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
        // Extract requestId before try block to ensure it's available in catch block
        const requestId = message.requestId || 'unknown';

        try {
            const { requestId: _, enableStreaming, ...data } = message;

            // Initialize generation log for this request
            this.globalResources.getLogger().initGenerationLog(requestId);

            // Summarized console output
            console.log(`🚀 Processing image generation: ${requestId} | Model: ${data.model || 'unknown'} | Resolution: ${data.resolution || 'unknown'} | ${enableStreaming ? 'streaming' : 'batch'}`);

            // Detailed file logging
            this.globalResources.getLogger().logGeneration('REQUEST_DATA', {
                requestId,
                enableStreaming,
                model: data.model,
                resolution: data.resolution,
                steps: data.steps,
                guidance: data.guidance,
                sampler: data.sampler,
                workspace: data.workspace,
                hasDynamicGen: !!data.dynamic_generation,
                fullData: data
            }, requestId);

            // Verbose console output (only if verbosity is VERBOSE)
            if (this.globalResources.getLogger().shouldLog(this.globalResources.getLogger().VERBOSITY_LEVELS.VERBOSE)) {
                console.log('📋 Generation data:', JSON.stringify(data, null, 2));
            }

            // Start keep-alive for long-running image generation
            this.startKeepAliveInterval(ws, requestId, 15000); // Every 15 seconds for image generation

            if (enableStreaming) {
                // Handle streaming generation
                this.globalResources.getLogger().detailed('🎬 Starting streaming image generation...');

                // Create callback to send intermediate images via websocket
                const streamingCallback = async (event) => {
                    if (event.type === 'intermediate') {
                        // Send intermediate image update
                        /* this.sendToClient(ws, {
                            type: 'image_generation_intermediate',
                            requestId: requestId,
                            data: {
                                step: event.step,
                                image: event.image.toString('base64'),
                                timestamp: event.timestamp
                            },
                            timestamp: new Date().toISOString()
                        }); */
                    }
                };

                // Call generateImageWebSocket with streaming callback
                const result = await generateImageWebSocket(
                    data,
                    clientInfo.userType,
                    clientInfo.sessionId,
                    streamingCallback, // streamingCallback
                    ws,
                    this,
                    wsServer
                );

                // Send final result (generateImageWebSocket now includes metadata)
                const responseData = {
                    image: result.buffer.toString('base64'),
                    filename: result.filename,
                    seed: result.seed || null,
                    metadata: result.metadata
                };

                // Include compiled prompt if it was processed
                if (result.compiled_prompt) {
                    responseData.compiled_prompt = result.compiled_prompt;
                }

                // Include text replacement seeds if available
                if (result.text_replacements_seed) {
                    responseData.text_replacements_seed = result.text_replacements_seed;
                }

                // Include pipeline data if this was a staged generation
                if (result.stage_seeds) {
                    responseData.stage_seeds = result.stage_seeds;
                }
                if (result.total_stages) {
                    responseData.total_stages = result.total_stages;
                }

                this.sendToClient(ws, {
                    type: 'image_generation_response',
                    requestId: requestId,
                    data: responseData,
                    timestamp: new Date().toISOString()
                });

            } else {
                // Handle regular (non-streaming) generation
                const result = await generateImageWebSocket(
                    data,
                    clientInfo.userType,
                    clientInfo.sessionId,
                    null, // no streaming callback
                    ws,
                    this,
                    wsServer
                );

                // Send success response with image data using _response pattern
                const responseData = {
                    image: result.buffer.toString('base64'),
                    filename: result.filename,
                    seed: result.seed || null,
                    metadata: result.metadata
                };

                // Include compiled prompt if it was processed
                if (result.compiled_prompt) {
                    responseData.compiled_prompt = result.compiled_prompt;
                }

                // Include text replacement seeds if available
                if (result.text_replacements_seed) {
                    responseData.text_replacements_seed = result.text_replacements_seed;
                }

                // Include pipeline data if this was a staged generation
                if (result.stage_seeds) {
                    responseData.stage_seeds = result.stage_seeds;
                }
                if (result.total_stages) {
                    responseData.total_stages = result.total_stages;
                }

                this.sendToClient(ws, {
                    type: 'image_generation_response',
                    requestId: requestId,
                    data: responseData,
                    timestamp: new Date().toISOString()
                });
            }

            // Broadcast gallery update to all clients since a new image was generated
            const galleryData = await this.buildGalleryData('images', clientInfo);
            wsServer.broadcastGalleryUpdate(galleryData, 'images');

            // Stop keep-alive when complete
            this.stopKeepAliveInterval(requestId);

        } catch (error) {
            // Stop keep-alive on error
            this.stopKeepAliveInterval(requestId);

            console.error('❌ Image generation error:', error);

            // Provide better error messages for common issues
            const userFriendlyError = this.getImageGenerationErrorMessage(error);

            this.sendToClient(ws, {
                type: 'image_generation_error',
                requestId: requestId,
                data: null,
                error: userFriendlyError,
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle image reroll requests
    async handleImageReroll(ws, message, clientInfo, wsServer) {
        try {
            const { requestId, filename, workspace, allow_paid } = message;
            console.log(`🎲 Processing image reroll request: ${requestId} for filename: ${filename}, allow_paid: ${allow_paid}`);

            // Get image metadata
            const metadata = await this.globalResources.getMetadataDatabase().getImageMetadata(filename, this.globalResources.getPath("images"));
            if (!metadata) {
                throw new Error(`No metadata found for image: ${filename}`);
            }

            console.log('🎲 Retrieved metadata for reroll:', metadata);

            // Call the reroll generation function with allow_paid flag
            const result = await handleRerollGeneration(
                metadata,
                clientInfo.sessionId,
                workspace || null,
                allow_paid || false
            );

            // Send success response with image data using _response pattern
            this.sendToClient(ws, {
                type: 'image_reroll_response',
                requestId: requestId,
                data: {
                    image: result.buffer.toString('base64'),
                    filename: result.filename,
                    seed: result.seed || null,
                    originalFilename: filename
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Image reroll error:', error);
            this.sendToClient(ws, {
                type: 'image_reroll_error',
                requestId: message.requestId,
                data: null,
                error: error.message || 'Image reroll failed',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle image upscaling requests
    async handleImageUpscaling(ws, message, clientInfo, wsServer) {
        const requestId = message.requestId || 'unknown';

        try {
            const { requestId: _, ...data } = message;
            console.log(`📏 Processing image upscaling request: ${requestId}`);
            console.log('📋 Upscaling data:', data);

            // Start keep-alive for long-running upscaling (especially for ESRGAN)
            this.startKeepAliveInterval(ws, requestId, 15000); // Every 15 seconds

            // Call the WebSocket-native upscaling function directly
            const result = await upscaleImageWebSocket(
                data.filename,
                data.workspace,
                clientInfo.userType,
                clientInfo.sessionId,
                data.upscaler || 'novelai',
                data.scale || 4,
                ws,
                this,
                requestId
            );

            // Stop keep-alive on success
            this.stopKeepAliveInterval(requestId);

            // Send success response with upscaled image data using _response pattern
            this.sendToClient(ws, {
                type: 'image_upscaling_response',
                requestId: requestId,
                data: {
                    image: result.buffer.toString('base64'),
                    filename: result.filename,
                    metadata: result.metadata
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast gallery update to all clients since upscaling creates/modifies gallery images
            const galleryData = await this.buildGalleryData('images', clientInfo);
            wsServer.broadcastGalleryUpdate(galleryData, 'images');

        } catch (error) {
            console.error('❌ Image upscaling error:', error);

            // Stop keep-alive on error
            this.stopKeepAliveInterval(requestId);

            this.sendToClient(ws, {
                type: 'image_upscaling_error',
                requestId: requestId,
                data: null,
                error: error.message || 'Image upscaling failed',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle image expansion requests
    async handleImageExpansion(ws, message, clientInfo, wsServer) {
        const requestId = message.requestId || 'unknown';

        try {
            const { requestId: _, enableStreaming, ...data } = message;
            console.log(`🔍 Processing image expansion request: ${requestId}`);
            console.log('📋 Expansion data:', data);

            // Validate required parameters
            if (!data.filename) {
                throw new Error('Filename is required');
            }
            if (!data.resolution) {
                throw new Error('Resolution is required');
            }
            if (data.imageBias === undefined || data.imageBias === null) {
                throw new Error('Image bias is required');
            }

            // Start keep-alive for long-running expansion
            this.startKeepAliveInterval(ws, requestId, 15000);

            // Setup streaming callback if enabled
            let streamingCallback = null;
            if (enableStreaming) {
                console.log('🎬 Starting streaming image expansion...');
                streamingCallback = async (event) => {
                    if (event.type === 'intermediate') {
                        // Send intermediate image update
                        /* this.sendToClient(ws, {
                            type: 'image_generation_intermediate',
                            requestId: requestId,
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

            // Call the expansion function
            const result = await expandImage(
                data.filename, // The image to actually expand (target)
                data.resolution,
                data.imageBias,
                data.upscaleAfterComplete || false,
                data.overrideParams || {},
                clientInfo.sessionId,
                data.workspace,
                streamingCallback,
                ws,
                this,
                requestId, // Pass the requestId for consistent progress tracking
                data.sourceFilename, // The original source image for metadata tracking
                data.enableAI || false // Enable/disable AI processing
            );

            // Stop keep-alive
            this.stopKeepAliveInterval(ws, requestId);

            // Send success response with metadata included
            this.sendToClient(ws, {
                type: 'image_expansion_response',
                requestId: requestId,
                data: {
                    image: result.image,
                    filename: result.filename,
                    seed: result.seed,
                    expansionPrompt: result.expansionPrompt,
                    expansionReason: result.expansionReason,
                    metadata: result.metadata
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast gallery update to all clients since expansion creates/modifies gallery images
            const galleryData = await this.buildGalleryData('images', clientInfo);
            wsServer.broadcastGalleryUpdate(galleryData, 'images');

        } catch (error) {
            console.error('❌ Image expansion error:', error);

            // Stop keep-alive on error
            this.stopKeepAliveInterval(ws, requestId);

            this.sendToClient(ws, {
                type: 'image_expansion_error',
                requestId: requestId,
                data: null,
                error: error.message || 'Image expansion failed',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle image expansion reroll requests
    async handleImageExpansionReroll(ws, message, clientInfo, wsServer) {
        const requestId = message.requestId || 'unknown';

        try {
            const { requestId: _, enableStreaming, ...data } = message;
            console.log(`🔄 Processing image expansion reroll: ${requestId}`);

            if (!data.filename) {
                throw new Error('Filename is required');
            }

            // Start keep-alive for long-running reroll
            this.startKeepAliveInterval(ws, requestId, 15000);

            // Setup streaming callback if enabled
            let streamingCallback = null;
            if (enableStreaming) {
                console.log('🎬 Starting streaming image expansion reroll...');
                streamingCallback = async (event) => {
                };
            }

            // Call the reroll function
            const result = await rerollExpandedImage(
                data.filename,
                data.overrideParams || {},
                clientInfo.sessionId,
                data.workspace,
                streamingCallback,
                ws,
                this,
                requestId
            );

            // Stop keep-alive
            this.stopKeepAliveInterval(ws, requestId);

            // Send success response with metadata included
            this.sendToClient(ws, {
                type: 'image_expansion_reroll_response',
                requestId: requestId,
                data: {
                    image: result.image,
                    filename: result.filename,
                    seed: result.seed,
                    expansionPrompt: result.expansionPrompt,
                    expansionReason: result.expansionReason,
                    metadata: result.metadata
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Image expansion reroll error:', error);

            // Stop keep-alive on error
            this.stopKeepAliveInterval(ws, requestId);

            this.sendToClient(ws, {
                type: 'image_expansion_reroll_error',
                requestId: requestId,
                data: null,
                error: error.message || 'Image expansion reroll failed',
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle cache manifest requests
    async handleGetCacheManifest(ws, message, clientInfo, wsServer) {
        try {
            const globalCacheData = this.globalResources.getGlobalCacheData();

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

    // Handle server cache refresh requests
    async handleRefreshServerCache(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin (not readonly)
            if (clientInfo.userType !== 'admin') {
                wsServer.sendToClient(ws, {
                    type: 'refresh_server_cache_response',
                    requestId: message.requestId,
                    data: {
                        success: false,
                        error: 'Admin access required to refresh server cache'
                    },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            console.log('🔄 Admin requested server cache refresh via WebSocket...');

            // Start keep-alive for cache refresh operation
            this.startKeepAliveInterval(ws, message.requestId, 5000); // Every 5 seconds for cache refresh

            // Use plumbing system to trigger cache refresh
            const plumbing = this.globalResources.getDataPlumbing();
            if (plumbing.callbacks.has('refreshCache')) {
                await plumbing.trigger('refreshCache');
            } else {
                console.warn('⚠️ Cache refresh callback not registered in plumbing system');
            }

            // Stop keep-alive when complete
            this.stopKeepAliveInterval(message.requestId);

            // Get updated cache data from globalResources
            const globalCacheData = this.globalResources.getGlobalCacheData();

            console.log(`✅ Server cache refreshed successfully via WebSocket: ${globalCacheData.length} assets`);

            wsServer.sendToClient(ws, {
                type: 'refresh_server_cache_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Server cache refreshed successfully',
                    assetsCount: globalCacheData.length,
                    timestamp: Date.now().valueOf(),
                    assets: globalCacheData
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            // Stop keep-alive on error
            this.stopKeepAliveInterval(message.requestId);

            console.error('❌ Server cache refresh error:', error);
            wsServer.sendToClient(ws, {
                type: 'refresh_server_cache_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Failed to refresh server cache',
                    details: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle rebuilding metadata cache
    async handleRebuildMetadataCache(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin (not readonly)
            if (clientInfo.userType !== 'admin') {
                wsServer.sendToClient(ws, {
                    type: 'rebuild_metadata_cache_response',
                    requestId: message.requestId,
                    data: {
                        success: false,
                        error: 'Admin access required to rebuild metadata cache'
                    },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            console.log('🔄 Admin requested metadata cache rebuild via WebSocket...');

            // Start keep-alive for metadata rebuild operation (every 10 seconds)
            this.startKeepAliveInterval(ws, message.requestId, 10000);

            // Track last sent percentage to throttle updates to every 1%
            let lastSentPercentage = -1;

            // Rebuild metadata cache with progress callback
            const progressCallback = (progress) => {
                const currentPercentage = parseInt((Math.floor((progress.current / progress.total) * 100)).toFixed(0));

                // Only send update if percentage increased by at least 1%
                if (currentPercentage > lastSentPercentage) {
                    wsServer.sendToClient(ws, {
                        type: 'rebuild_metadata_cache_progress',
                        requestId: message.requestId,
                        data: {
                            current: progress.current,
                            total: progress.total,
                            filename: progress.filename,
                            updatedCount: progress.updatedCount,
                            errorCount: progress.errorCount,
                            percentage: currentPercentage
                        },
                        timestamp: new Date().toISOString()
                    });
                    lastSentPercentage = currentPercentage;
                }
            };

            const result = await this.globalResources.getMetadataDatabase().rebuildMetadataCache(this.globalResources.getPath("images"), progressCallback);

            // Stop keep-alive when complete
            this.stopKeepAliveInterval(message.requestId);

            console.log(`✅ Metadata cache rebuilt successfully: ${result.updatedCount} files updated, ${result.errorCount} errors`);

            wsServer.sendToClient(ws, {
                type: 'rebuild_metadata_cache_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Metadata cache rebuilt successfully',
                    updatedCount: result.updatedCount,
                    errorCount: result.errorCount,
                    totalFiles: result.totalFiles,
                    timestamp: Date.now().valueOf()
                },
                timestamp: new Date().toISOString()
            });

            // Broadcast gallery update to all clients to refresh the UI
            const galleryData = await this.buildGalleryData('images', clientInfo);
            wsServer.broadcastGalleryUpdate(galleryData, 'images');

        } catch (error) {
            // Stop keep-alive on error
            this.stopKeepAliveInterval(message.requestId);

            console.error('❌ Metadata cache rebuild error:', error);
            wsServer.sendToClient(ws, {
                type: 'rebuild_metadata_cache_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Failed to rebuild metadata cache',
                    details: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle clearing search cache (auto complete cache)
    async handleClearSearchCache(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin (not readonly)
            if (clientInfo.userType !== 'admin') {
                wsServer.sendToClient(ws, {
                    type: 'clear_search_cache_response',
                    requestId: message.requestId,
                    data: {
                        success: false,
                        error: 'Admin access required to clear search cache'
                    },
                    timestamp: new Date().toISOString()
                });
                return;
            }

            console.log('🔄 Admin requested search cache clear via WebSocket...');

            // Get tag search database and clear all cache
            const tagSearchDatabase = this.globalResources.getTagSearchDatabase();
            const result = tagSearchDatabase.clearAllCache();

            console.log(`✅ Search cache cleared successfully: ${result.total} entries removed`);

            wsServer.sendToClient(ws, {
                type: 'clear_search_cache_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Search cache cleared successfully',
                    deletedCount: result,
                    timestamp: Date.now().valueOf()
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Search cache clear error:', error);
            wsServer.sendToClient(ws, {
                type: 'clear_search_cache_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Failed to clear search cache',
                    details: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle broadcasting resource updates to all clients
    async handleBroadcastResourceUpdate(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin (not readonly)
            if (clientInfo.userType !== 'admin') {
                wsServer.sendToClient(ws, {
                    type: 'error',
                    message: 'Admin access required to broadcast resource updates',
                    timestamp: new Date().toISOString()
                });
                return;
            }

            const { updateType, message: updateMessage, files } = message;

            console.log('🔄 Admin broadcasting resource update:', updateType, updateMessage);

            // Broadcast to all connected clients
            wsServer.broadcastToAll({
                type: 'resource_update_available',
                data: {
                    updateType: updateType || 'general',
                    message: updateMessage || 'Resource updates are available',
                    files: files || [],
                    timestamp: Date.now().valueOf(),
                    requiresRestart: true
                },
                timestamp: new Date().toISOString()
            });

            // Send confirmation to admin
            wsServer.sendToClient(ws, {
                type: 'broadcast_resource_update_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Resource update broadcast sent to all clients',
                    clientsNotified: wsServer.getConnectionCount()
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error broadcasting resource update:', error);
            wsServer.sendToClient(ws, {
                type: 'broadcast_resource_update_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: 'Failed to broadcast resource update',
                    details: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Helper function to load conversation history for AI services
    async loadConversationHistoryForAI(chatId, maxMessages = 20) {
        try {
            const messages = await this.globalResources.getChatDatabase().getChatMessages(chatId, maxMessages, 0);
            return messages.reverse().map(msg => ({
                message_type: msg.message_type,
                content: msg.content,
                created_at: msg.created_at
            }));
        } catch (error) {
            console.error('Error loading conversation history:', error);
            return [];
        }
    }

    // Chat system handlers
    async handleGetPersonaSettings(ws, message, clientInfo, wsServer) {
        try {
            const settings = await this.globalResources.getChatDatabase().getPersonaSettings();
            this.sendToClient(ws, {
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
            this.sendError(ws, 'Failed to get persona settings', error.message, message.requestId);
        }
    }

    async handleSavePersonaSettings(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { settings } = data;

            const success = await this.globalResources.getChatDatabase().savePersonaSettings(settings);

            this.sendToClient(ws, {
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
            this.sendError(ws, 'Failed to save persona settings', error.message, message.requestId);
        }
    }

    async handleCreateChatSession(ws, message, clientInfo, wsServer) {
        try {
            // Handle both message.data and direct message properties
            const data = message.data || message;
            console.log('📝 Creating chat session with data:', JSON.stringify(data, null, 2));
            const { filename, characterName, textContextInfo, textViewerInfo, storyContext, verbosityLevel, model: clientModel } = data;

            if (!filename) {
                this.sendError(ws, 'Filename is required', null, message.requestId);
                return;
            }

            // Get persona settings for defaults
            const personaSettings = await this.globalResources.getChatDatabase().getPersonaSettings();
            const sessionData = {
                chat_name: characterName || null,
                filename: filename,
                provider: 'grok',
                model: clientModel || this.globalResources.getGrokService().getDefaultGrokModel(),
                character_name: characterName || null,
                text_context_info: textContextInfo || null,
                text_viewer_info: textViewerInfo || null,
                story_context: storyContext || null,
                verbosity_level: verbosityLevel || personaSettings.default_verbosity || 3
            };

            const chatId = await this.globalResources.getChatDatabase().createChatSession(sessionData);

            if (!chatId) {
                this.sendError(ws, 'Failed to create chat session', null, message.requestId);
                return;
            }

            // Send initial response
            this.sendToClient(ws, {
                type: 'create_chat_session_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    chatId: chatId,
                    message: 'Chat session created successfully'
                },
                timestamp: new Date().toISOString()
            });

            // Automatically start the first generation to establish persona
            try {
                console.log('🎭 Starting initial persona establishment for chat session:', chatId);

                // Get persona settings
                const personaSettings = await this.globalResources.getChatDatabase().getPersonaSettings();

                // Get the character image for this chat session
                const imagePath = path.join(this.globalResources.getPath("images"), data.filename);
                let personaImage = null;
                let userPrompt = '';

                console.log('🖼️ Looking for image at:', imagePath);
                console.log('📁 Images directory:', this.globalResources.getPath("images"));
                console.log('📄 Filename:', data.filename);

                if (fs.existsSync(imagePath)) {
                    console.log('✅ Image file exists, loading...');
                    const imageBuffer = fs.readFileSync(imagePath);
                    const base64Image = imageBuffer.toString('base64');
                    const mimeType = path.extname(data.filename).toLowerCase() === '.png' ? 'image/png' : 'image/jpeg';

                    personaImage = {
                        base64: base64Image,
                        mimeType: mimeType
                    };

                    console.log('🖼️ Image loaded, size:', imageBuffer.length, 'bytes');

                    // Get the prompt data for this image
                    const metadata = await this.globalResources.getMetadataDatabase().getImageMetadata(data.filename, this.globalResources.getPath("images"));
                    console.log('📋 Metadata retrieved:', metadata ? 'Yes' : 'No');
                    if (metadata) {
                        // Check if metadata is a string that needs parsing
                        if (typeof metadata.metadata === 'string') {
                            try {
                                const parsedMetadata = JSON.parse(metadata.metadata);
                            } catch (e) {
                                console.log('📋 Failed to parse metadata.metadata as JSON:', e.message);
                            }
                        }
                    }

                    // The prompt data is always in metadata.metadata (from extractNovelAIMetadata)
                    if (metadata && metadata.metadata && metadata.metadata.input_prompt) {
                        userPrompt = metadata.metadata.input_prompt;
                        console.log('📝 Using metadata.metadata.input_prompt');
                    } else if (metadata && metadata.metadata && metadata.metadata.prompt) {
                        userPrompt = metadata.metadata.prompt;
                        console.log('📝 Using metadata.metadata.prompt');
                    }

                    // Add character prompts if available (they're in metadata.metadata)
                    if (metadata && metadata.metadata && metadata.metadata.characterPrompts && Array.isArray(metadata.metadata.characterPrompts) && metadata.metadata.characterPrompts.length > 0) {
                        userPrompt += ', ' + metadata.metadata.characterPrompts.join(', ');
                        console.log('👥 Added metadata.metadata.characterPrompts:', metadata.metadata.characterPrompts.length, 'items');
                    } else if (metadata && metadata.metadata && metadata.metadata.allCharacterPrompts && Array.isArray(metadata.metadata.allCharacterPrompts) && metadata.metadata.allCharacterPrompts.length > 0) {
                        userPrompt += ', ' + metadata.metadata.allCharacterPrompts.join(', ');
                        console.log('👥 Added metadata.metadata.allCharacterPrompts:', metadata.metadata.allCharacterPrompts.length, 'items');
                    }
                    console.log('🔍 Final user prompt:', userPrompt);
                } else {
                    console.log('❌ Image file does not exist at:', imagePath);
                    // Try to get metadata anyway in case the image is in a different location
                    const metadata = await this.globalResources.getMetadataDatabase().getImageMetadata(data.filename, this.globalResources.getPath("images"));
                    if (metadata) {
                        console.log('📋 Found metadata despite missing image file');

                        // The prompt data is always in metadata.metadata
                        if (metadata.metadata && metadata.metadata.input_prompt) {
                            userPrompt = metadata.metadata.input_prompt;
                        } else if (metadata.metadata && metadata.metadata.prompt) {
                            userPrompt = metadata.metadata.prompt;
                        }

                        // Character prompts are also in metadata.metadata
                        if (metadata.metadata && metadata.metadata.characterPrompts && Array.isArray(metadata.metadata.characterPrompts) && metadata.metadata.characterPrompts.length > 0) {
                            userPrompt += ', ' + metadata.metadata.characterPrompts.join(', ');
                        } else if (metadata.metadata && metadata.metadata.allCharacterPrompts && Array.isArray(metadata.metadata.allCharacterPrompts) && metadata.metadata.allCharacterPrompts.length > 0) {
                            userPrompt += ', ' + metadata.metadata.allCharacterPrompts.join(', ');
                        }
                        console.log('🔍 User prompt from metadata only:', userPrompt);
                    }
                }

                // Get viewer avatar if available
                let viewerAvatar = null;
                if (personaSettings.profile_photo_base64) {
                    viewerAvatar = {
                        base64: personaSettings.profile_photo_base64,
                        mimeType: 'image/jpeg'
                    };
                }

                // Ensure we have some prompt data
                if (!userPrompt) {
                    userPrompt = 'A character from an AI-generated image';
                    console.log('⚠️ No prompt data found, using fallback prompt');
                }

                // Load system prompt with story context and dynamic context
                const session = await this.globalResources.getChatDatabase().getChatSession(chatId);
                const systemPrompt = await this.globalResources.getPromptManager().getCompleteSystemPrompt(
                    'characterChat',
                    session,
                    personaSettings,
                    data.filename
                );

                let aiResponse;
                console.log('🤖 Using Grok service for initial persona establishment');
                const sessionData = {
                    id: chatId,
                    provider: 'grok',
                    model: (session && session.model) || this.globalResources.getGrokService().getDefaultGrokModel(),
                    verbosity_level: verbosityLevel || 3
                };
                const chat = await this.globalResources.getGrokService().createPersonaChatSession(sessionData, personaSettings, systemPrompt);

                // Establish persona with image
                if (personaImage) {
                    console.log('🎭 Establishing Grok persona with image');
                    console.log('🖼️ Persona image size:', personaImage.base64.length, 'characters');
                    console.log('📝 User prompt length:', userPrompt.length);
                    console.log('👤 Viewer avatar:', viewerAvatar ? 'Yes' : 'No');

                    // Establish persona using streaming if enabled
                    if (config.chat_streaming_enabled) {
                        console.log('📡 Streaming enabled for Grok persona establishment');
                        // Send initial streaming message (no requestId for streaming events)
                        this.sendToClient(ws, {
                            type: 'chat_streaming_start',
                            chatId: chatId,
                            message: 'Establishing persona...'
                        });

                        aiResponse = await this.globalResources.getGrokService().establishPersonaStreaming(chat, personaImage, userPrompt, viewerAvatar, (chunk, fullResponse, extractedEvents) => {
                            // Send streaming update with extracted events (no requestId for streaming events)
                            this.sendToClient(ws, {
                                type: 'chat_streaming_update',
                                chatId: chatId,
                                events: extractedEvents || [], // Send structured events, not raw JSON
                                fullResponse: fullResponse // Keep for final parsing if needed
                            });
                        });
                    } else {
                        console.log('📡 Streaming disabled for Grok persona establishment');
                        aiResponse = await this.globalResources.getGrokService().establishPersona(chat, personaImage, userPrompt, viewerAvatar);
                    }

                    // Persona establishment creates an initial character introduction response
                    // Parse and send it to the client instead of a generic greeting
                    console.log('✅ Persona established, parsing initial response');
                    console.log(`🧵 Persona establishment response_id: ${chat.lastResponseId || 'not set'}`);

                    // Use the persona establishment response as the initial message
                    // Don't send "> START SEQUENCE" - the persona response IS the initial greeting
                } else {
                    console.log('❌ No persona image available, skipping persona establishment');
                    // Only send greeting if persona establishment was skipped
                    if (config.chat_streaming_enabled) {
                        console.log('📡 Streaming enabled for Grok initial response');
                        // Send streaming start for initial message
                        this.sendToClient(ws, {
                            type: 'chat_streaming_start',
                            requestId: message.requestId,
                            chatId: chatId,
                            message: 'Generating initial response...'
                        });

                        aiResponse = await this.globalResources.getGrokService().continueConversationStreaming(chat, '> START SEQUENCE', (chunk, fullResponse) => {
                            // Send streaming update
                            this.sendToClient(ws, {
                                type: 'chat_streaming_update',
                                requestId: message.requestId,
                                chatId: chatId,
                                chunk: chunk,
                                fullResponse: fullResponse
                            });
                        });
                    } else {
                        aiResponse = await this.globalResources.getGrokService().continueConversation(chat, '> START SEQUENCE');
                    }
                }

                // Extract usage data and content from response
                const usageData = aiResponse?.usage || null;
                const responseContent = aiResponse?.content || aiResponse || '';

                console.log('📝 Initial AI response received, length:', responseContent.length);

                // Send streaming complete message only if streaming was enabled
                // Don't include requestId here - create_chat_session request was already resolved
                if (config.chat_streaming_enabled) {
                    this.sendToClient(ws, {
                        type: 'chat_streaming_complete',
                        chatId: chatId,
                        finalResponse: responseContent,
                        usage: usageData || null
                    });
                }

                // Parse the AI response - now expecting event-based format
                let parsedResponse;
                try {
                    // Clean the response - remove markdown code blocks if present
                    let cleanResponse = (typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent)).trim();
                    if (cleanResponse.startsWith('```json')) {
                        cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                    } else if (cleanResponse.startsWith('```')) {
                        cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
                    }

                    // Try to extract JSON from mixed responses
                    let jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
                    if (jsonMatch) {
                        cleanResponse = jsonMatch[0];
                    } else {
                        // Check if it's multiple comma-separated objects (malformed JSON)
                        // Pattern: { ... }, { ... }, { ... } (no array brackets)
                        const commaSeparatedObjects = cleanResponse.match(/\{[\s\S]*?\}(?=\s*,|\s*$)/g);
                        if (commaSeparatedObjects && commaSeparatedObjects.length > 1) {
                            // Wrap in array brackets and fix trailing commas
                            cleanResponse = '[' + commaSeparatedObjects.join(',') + ']';
                            // Remove any trailing commas before closing bracket
                            cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                        } else {
                            // If no array found, try to extract a single object
                            jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
                            if (jsonMatch) {
                                cleanResponse = jsonMatch[0];
                            }
                        }
                    }

                    // Remove trailing commas before closing brackets/braces
                    cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');

                    let parsed;
                    try {
                        parsed = JSON.parse(cleanResponse);
                    } catch (parseErr) {
                        // If parsing fails, try to fix common issues
                        // Remove any remaining trailing commas
                        cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');
                        // Try wrapping multiple objects in array if still failing
                        if (!cleanResponse.startsWith('[') && cleanResponse.includes('},')) {
                            cleanResponse = '[' + cleanResponse + ']';
                            cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                        }
                        parsed = JSON.parse(cleanResponse);
                    }

                    // Convert to array if it's a single object
                    const events = Array.isArray(parsed) ? parsed : [parsed];

                    // Validate that it's an array of events
                    if (!Array.isArray(events)) {
                        throw new Error('Invalid response structure: expected array of events');
                    }

                    // Convert events to old format for compatibility
                    const environmentEvents = events.filter(e => e.type === 'environment').map(e => e.content);
                    const locationEvents = events.filter(e => e.type === 'location').map(e => e.content);

                    // Extract scene data from environment and location events
                    let sceneData = 'A cozy, intimate setting'; // Default fallback
                    if (environmentEvents.length > 0) {
                        sceneData = environmentEvents.join(' ');
                    } else if (locationEvents.length > 0) {
                        sceneData = locationEvents.join(' ');
                    }

                    parsedResponse = {
                        actions: events.filter(e => e.type === 'actions').map(e => e.content),
                        sfx: events.filter(e => e.type === 'sfx').map(e => e.content),
                        speechdirect: events.filter(e => e.type === 'speechdirect').map(e => e.content),
                        speech: events.filter(e => e.type === 'speech').map(e => e.content),
                        reply: events.filter(e => e.type === 'speechdirect' || e.type === 'reply').map(e => e.content),
                        innerspeech: events.filter(e => e.type === 'innerspeech').map(e => e.content),
                        emotion: events.filter(e => e.type === 'emotion').map(e => e.content),
                        environment: environmentEvents,
                        memory: events.filter(e => e.type === 'memory').map(e => e.content),
                        currplan: events.filter(e => e.type === 'currplan').map(e => e.content),
                        futureplans: events.filter(e => e.type === 'futureplans').map(e => e.content),
                        trustlevel: events.filter(e => e.type === 'trustlevel').map(e => e.content),
                        inventory: events.filter(e => e.type === 'inventory').map(e => e.content),
                        sensory: events.filter(e => e.type === 'sensory').map(e => e.content),
                        offlinemessage: events.filter(e => e.type === 'offlinemessage').map(e => e.content),
                        timeofday: events.filter(e => e.type === 'timeofday').map(e => e.content),
                        location: locationEvents,
                        myname: events.filter(e => e.type === 'myname').map(e => e.content),
                        appendMemory: [],
                        scene: sceneData,
                        appendMind: []
                    };

                } catch (parseError) {
                    console.warn('⚠️ Failed to parse AI response as JSON, using fallback:', parseError.message);
                    // Fallback response structure
                    parsedResponse = {
                        actions: [],
                        sfx: [],
                        reply: [responseContent || 'Hello! I\'m here and ready to chat with you.'],
                        speech: [],
                        innerspeech: [],
                        emotion: [],
                        environment: [],
                        memory: [],
                        currplan: [],
                        futureplans: [],
                        trustlevel: [],
                        inventory: [],
                        sensory: [],
                        offlinemessage: [],
                        timeofday: [],
                        location: [],
                        myname: [],
                        appendMemory: [],
                        scene: 'A cozy, intimate setting',
                        appendMind: []
                    };
                }

                // Note: establishPersona already stores the message in the database
                // Only store again if this is NOT from persona establishment (e.g., if no persona was established)
                // The parsed response is already stored by establishPersona, we just need to send it to the client

                // Extract usage data if not already extracted
                const responseUsageData = usageData || aiResponse?.usage || null;

                // Send the AI response to the client
                this.sendToClient(ws, {
                    type: 'chat_message_response',
                    data: {
                        success: true,
                        chatId: chatId,
                        response: parsedResponse,
                        rawResponse: responseContent,
                        streaming: config.chat_streaming_enabled,
                        usage: responseUsageData || null
                    },
                    timestamp: new Date().toISOString()
                });

                console.log('✅ Initial persona establishment completed for chat session:', chatId);

            } catch (initialGenError) {
                console.error('❌ Error during initial persona establishment:', initialGenError);
                // Don't fail the chat creation, just log the error
                // The user can still send messages manually
            }
        } catch (error) {
            console.error('❌ Error creating chat session:', error);
            this.sendError(ws, 'Failed to create chat session', error.message, message.requestId);
        }
    }

    async handleGetChatSessions(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { filename } = data;
            let sessions;

            if (filename) {
                sessions = await this.globalResources.getChatDatabase().getChatSessionsByFilename(filename);
            } else {
                sessions = await this.globalResources.getChatDatabase().getAllChatSessions();
            }

            this.sendToClient(ws, {
                type: 'get_chat_sessions_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    sessions: sessions
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error getting chat sessions:', error);
            this.sendError(ws, 'Failed to get chat sessions', error.message, message.requestId);
        }
    }

    async handleGetChatSession(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { chatId } = data;

            if (!chatId) {
                this.sendError(ws, 'Chat ID is required', null, message.requestId);
                return;
            }

            const session = await this.globalResources.getChatDatabase().getChatSession(chatId);

            if (!session) {
                this.sendError(ws, 'Chat session not found', null, message.requestId);
                return;
            }

            this.sendToClient(ws, {
                type: 'get_chat_session_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    session: session
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error getting chat session:', error);
            this.sendError(ws, 'Failed to get chat session', error.message, message.requestId);
        }
    }

    async handleDeleteChatSession(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { chatId } = data;

            if (!chatId) {
                this.sendError(ws, 'Chat ID is required', null, message.requestId);
                return;
            }

            const success = await this.globalResources.getChatDatabase().deleteChatSession(chatId);

            // Clean up AI service cache for this chat
            if (success) {
                this.globalResources.getAiServiceManager().forceCleanupService(chatId);
            }

            this.sendToClient(ws, {
                type: 'delete_chat_session_response',
                requestId: message.requestId,
                data: {
                    success: success,
                    message: success ? 'Chat session deleted successfully' : 'Failed to delete chat session'
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error deleting chat session:', error);
            this.sendError(ws, 'Failed to delete chat session', error.message, message.requestId);
        }
    }

    async handleRestartChatSession(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { chatId } = data;

            if (!chatId) {
                this.sendError(ws, 'Chat ID is required', null, message.requestId);
                return;
            }

            const success = await this.globalResources.getChatDatabase().restartChatSession(chatId);

            // Clean up AI service cache for this chat
            if (success) {
                this.globalResources.getAiServiceManager().forceCleanupService(chatId);
            }

            this.sendToClient(ws, {
                type: 'restart_chat_session_response',
                requestId: message.requestId,
                data: {
                    success: success,
                    message: success ? 'Chat session restarted successfully' : 'Failed to restart chat session'
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error restarting chat session:', error);
            this.sendError(ws, 'Failed to restart chat session', error.message, message.requestId);
        }
    }

    async handleSendChatMessage(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { chatId, message: userMessage } = data;

            if (!chatId || !userMessage) {
                this.sendError(ws, 'Chat ID and message are required', null, message.requestId);
                return;
            }

            // Get chat session from database
            const session = await this.globalResources.getChatDatabase().getChatSession(chatId);
            if (!session) {
                this.sendError(ws, 'Chat session not found', null, message.requestId);
                return;
            }

            // Start keep-alive for long-running chat requests
            this.startKeepAliveInterval(ws, message.requestId, 15000); // Every 15 seconds for chat

            // Prepare persona data using prompt manager
            const personaData = await this.globalResources.getPromptManager().preparePersonaData(chatId, session.filename);

            // Use unified AI service manager
            let aiResponse;
            try {
                // Establish persona if needed (only for first message)
                if (await this.globalResources.getPromptManager().needsPersonaEstablishment(chatId)) {
                    await this.globalResources.getAiServiceManager().establishPersonaIfNeeded(
                        chatId,
                        personaData.personaImage,
                        personaData.userPrompt,
                        personaData.viewerAvatar
                    );
                }

                if (config.chat_streaming_enabled) {
                    console.log(`📡 Streaming enabled for ${session.provider}`);
                    // Send initial streaming message
                    this.sendToClient(ws, {
                        type: 'chat_streaming_start',
                        requestId: message.requestId,
                        chatId: chatId,
                        message: 'Generating response...'
                    });

                    // Use streaming for conversation
                    aiResponse = await this.globalResources.getAiServiceManager().continueConversation(chatId, userMessage, (chunk, fullResponse, extractedEvents) => {
                        // Send streaming update with extracted events (not raw JSON)
                        this.sendToClient(ws, {
                            type: 'chat_streaming_update',
                            requestId: message.requestId,
                            chatId: chatId,
                            events: extractedEvents || [], // Send structured events, not raw JSON
                            fullResponse: fullResponse // Keep for final parsing if needed
                        });
                    });
                } else {
                    console.log(`📡 Streaming disabled for ${session.provider}`);
                    // Use regular non-streaming approach
                    aiResponse = await this.globalResources.getAiServiceManager().continueConversation(chatId, userMessage);
                }

                // Extract usage data and content from response
                const usageData = aiResponse?.usage || null;
                const responseContent = aiResponse?.content || aiResponse || '';

                console.log('📝 AI response received, length:', responseContent.length);

                // Send streaming complete message only if streaming was enabled
                if (config.chat_streaming_enabled) {
                    this.sendToClient(ws, {
                        type: 'chat_streaming_complete',
                        requestId: message.requestId,
                        chatId: chatId,
                        finalResponse: responseContent,
                        usage: usageData || null
                    });
                } else {
                    // Parse AI response for non-streaming mode
                    let parsedResponse;
                    try {
                        // Clean the response - remove markdown code blocks if present
                        let cleanResponse = (typeof responseContent === 'string' ? responseContent : JSON.stringify(responseContent)).trim();
                        if (cleanResponse.startsWith('```json')) {
                            cleanResponse = cleanResponse.replace(/^```json\s*/, '').replace(/\s*```$/, '');
                        } else if (cleanResponse.startsWith('```')) {
                            cleanResponse = cleanResponse.replace(/^```\s*/, '').replace(/\s*```$/, '');
                        }

                        // Try to extract JSON from mixed responses
                        let jsonMatch = cleanResponse.match(/\[[\s\S]*\]/);
                        if (jsonMatch) {
                            cleanResponse = jsonMatch[0];
                        } else {
                            // Check if it's multiple comma-separated objects (malformed JSON)
                            const commaSeparatedObjects = cleanResponse.match(/\{[\s\S]*?\}(?=\s*,|\s*$)/g);
                            if (commaSeparatedObjects && commaSeparatedObjects.length > 1) {
                                cleanResponse = '[' + commaSeparatedObjects.join(',') + ']';
                                cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                            } else {
                                jsonMatch = cleanResponse.match(/\{[\s\S]*\}/);
                                if (jsonMatch) {
                                    cleanResponse = jsonMatch[0];
                                }
                            }
                        }

                        // Remove trailing commas before closing brackets/braces
                        cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');

                        let parsed;
                        try {
                            parsed = JSON.parse(cleanResponse);
                        } catch (parseErr) {
                            cleanResponse = cleanResponse.replace(/,(\s*[}\]])/g, '$1');
                            if (!cleanResponse.startsWith('[') && cleanResponse.includes('},')) {
                                cleanResponse = '[' + cleanResponse + ']';
                                cleanResponse = cleanResponse.replace(/,(\s*\])/g, '$1');
                            }
                            parsed = JSON.parse(cleanResponse);
                        }

                        // Convert to array if it's a single object
                        const events = Array.isArray(parsed) ? parsed : [parsed];

                        // Extract environment and location events
                        const environmentEvents = events.filter(e => e.type === 'environment').map(e => e.content);
                        const locationEvents = events.filter(e => e.type === 'location').map(e => e.content);

                        // Extract scene data
                        let sceneData = 'A cozy, intimate setting';
                        if (environmentEvents.length > 0) {
                            sceneData = environmentEvents.join(' ');
                        } else if (locationEvents.length > 0) {
                            sceneData = locationEvents.join(' ');
                        }

                        parsedResponse = {
                            actions: events.filter(e => e.type === 'actions').map(e => e.content),
                            sfx: events.filter(e => e.type === 'sfx').map(e => e.content),
                            speechdirect: events.filter(e => e.type === 'speechdirect').map(e => e.content),
                            speech: events.filter(e => e.type === 'speech').map(e => e.content),
                            reply: events.filter(e => e.type === 'speechdirect' || e.type === 'reply').map(e => e.content),
                            innerspeech: events.filter(e => e.type === 'innerspeech').map(e => e.content),
                            emotion: events.filter(e => e.type === 'emotion').map(e => e.content),
                            environment: environmentEvents,
                            memory: events.filter(e => e.type === 'memory').map(e => e.content),
                            currplan: events.filter(e => e.type === 'currplan').map(e => e.content),
                            futureplans: events.filter(e => e.type === 'futureplans').map(e => e.content),
                            trustlevel: events.filter(e => e.type === 'trustlevel').map(e => e.content),
                            inventory: events.filter(e => e.type === 'inventory').map(e => e.content),
                            sensory: events.filter(e => e.type === 'sensory').map(e => e.content),
                            offlinemessage: events.filter(e => e.type === 'offlinemessage').map(e => e.content),
                            timeofday: events.filter(e => e.type === 'timeofday').map(e => e.content),
                            location: locationEvents,
                            myname: events.filter(e => e.type === 'myname').map(e => e.content),
                            appendMemory: [],
                            scene: sceneData,
                            appendMind: []
                        };

                    } catch (parseError) {
                        console.warn('⚠️ Failed to parse AI response as JSON, using fallback:', parseError.message);
                        parsedResponse = {
                            actions: [],
                            sfx: [],
                            speechdirect: [],
                            speech: [],
                            reply: [responseContent || 'I apologize, but I could not generate a response.'],
                            innerspeech: [],
                            emotion: [],
                            environment: [],
                            memory: [],
                            currplan: [],
                            futureplans: [],
                            trustlevel: [],
                            inventory: [],
                            sensory: [],
                            offlinemessage: [],
                            timeofday: [],
                            location: [],
                            myname: [],
                            appendMemory: [],
                            scene: 'A cozy, intimate setting',
                            appendMind: []
                        };
                    }

                    // Send the AI response to the client (non-streaming mode sends immediately)
                    this.sendToClient(ws, {
                        type: 'chat_message_response',
                        requestId: message.requestId,
                        data: {
                            success: true,
                            chatId: chatId,
                            response: parsedResponse,
                            rawResponse: responseContent,
                            streaming: false,
                            usage: usageData || null
                        },
                        timestamp: new Date().toISOString()
                    });
                }

                // Stop keep-alive when complete
                this.stopKeepAliveInterval(message.requestId);

            } catch (aiError) {
                console.error('❌ AI service error:', aiError);

                // Stop keep-alive on error
                this.stopKeepAliveInterval(message.requestId);

                // Add error message to database
                const errorResponse = {
                    actions: [],
                    sfx: [],
                    reply: ['I apologize, but I encountered an error processing your message.'],
                    appendMemory: [],
                    scene: '',
                    appendMind: []
                };

                await this.globalResources.getChatDatabase().addChatMessage(chatId, 'assistant', 'Error: ' + aiError.message, JSON.stringify(errorResponse));

                this.sendToClient(ws, {
                    type: 'chat_message_response',
                    requestId: message.requestId,
                    data: {
                        success: false,
                        chatId: chatId,
                        error: aiError.message,
                        response: errorResponse
                    },
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            // Stop keep-alive on error
            this.stopKeepAliveInterval(message.requestId);

            console.error('❌ Error sending chat message:', error);
            this.sendError(ws, 'Failed to send chat message', error.message, message.requestId);
        }
    }

    async handleGetChatMessages(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { chatId, limit = 50, offset = 0 } = data;

            if (!chatId) {
                this.sendError(ws, 'Chat ID is required', null, message.requestId);
                return;
            }

            const rawMessages = await this.globalResources.getChatDatabase().getChatMessages(chatId, limit, offset);
            const totalCount = await this.globalResources.getChatDatabase().getChatMessageCount(chatId);

            // Messages are already stored as individual event objects, no transformation needed
            const messages = rawMessages;

            this.sendToClient(ws, {
                type: 'get_chat_messages_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    messages: messages,
                    totalCount: totalCount,
                    hasMore: (offset + limit) < totalCount
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error getting chat messages:', error);
            this.sendError(ws, 'Failed to get chat messages', error.message, message.requestId);
        }
    }

    async handleDeleteChatMessage(ws, message, clientInfo, wsServer) {
        try {
            const data = message.data || message;
            const { messageId } = data;

            if (!messageId) {
                this.sendError(ws, 'Message ID is required', null, message.requestId);
                return;
            }

            const success = await this.globalResources.getChatDatabase().deleteChatMessage(messageId);

            if (success) {
                this.sendToClient(ws, {
                    type: 'delete_chat_message_response',
                    requestId: message.requestId,
                    data: {
                        success: true,
                        message: 'Message deleted successfully'
                    },
                    timestamp: new Date().toISOString()
                });
            } else {
                this.sendError(ws, 'Failed to delete message', null, message.requestId);
            }
        } catch (error) {
            console.error('❌ Error deleting chat message:', error);
            this.sendError(ws, 'Failed to delete chat message', error.message, message.requestId);
        }
    }

    async handleCancelGeneration(ws, message, clientInfo, wsServer) {
        try {
            // TODO: Implement actual generation cancellation
            // For now, we'll return a placeholder response
            console.log('🛑 Cancel generation requested');

            // This would need to be implemented to actually cancel ongoing generations
            // For now, we'll just return success
            const success = true; // Placeholder - actual implementation needed

            this.sendToClient(ws, {
                type: 'cancel_generation_response',
                requestId: message.requestId,
                data: {
                    success: success,
                    message: success ? 'Generation cancellation requested' : 'No active generation to cancel'
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error cancelling generation:', error);
            this.sendError(ws, 'Failed to cancel generation', error.message, message.requestId);
        }
    }

    // IP Management Handlers
    async handleGetBlockedIPs(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin
            if (clientInfo.userType !== 'admin') {
                this.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }

            const { page = 1, limit = 15 } = message;
            const offset = (page - 1) * limit;

            // Get blocked IPs from the global security system
            const blockedIPs = this.globalResources.getBlockedIPs();
            const suspiciousIPs = this.globalResources.getSuspiciousIPs();
            const invalidURLAttempts = this.globalResources.getInvalidURLAttempts();

            const now = Date.now();
            const blockedIPsArray = Array.from(blockedIPs.entries())
                .map(([ip, data]) => ({
                    ip,
                    blockedAt: data.blockedAt,
                    reason: data.reason,
                    attempts: data.attempts,
                    ageMinutes: Math.round((now - data.blockedAt) / (1000 * 60)),
                    ageHours: Math.round((now - data.blockedAt) / (1000 * 60 * 60))
                }))
                .sort((a, b) => b.blockedAt - a.blockedAt); // Most recent first

            const totalCount = blockedIPsArray.length;
            const paginatedIPs = blockedIPsArray.slice(offset, offset + limit);
            const totalPages = Math.ceil(totalCount / limit);

            this.sendToClient(ws, {
                type: 'get_blocked_ips_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    blockedIPs: paginatedIPs,
                    pagination: {
                        currentPage: page,
                        totalPages: totalPages,
                        totalCount: totalCount,
                        limit: limit
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error fetching blocked IPs:', error);
            this.sendError(ws, 'Failed to fetch blocked IPs', error.message, message.requestId);
        }
    }

    async handleUnblockIP(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin
            if (clientInfo.userType !== 'admin') {
                this.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }

            const { ip } = message;
            if (!ip) {
                this.sendError(ws, 'IP address is required', 'MISSING_IP', message.requestId);
                return;
            }

            // Get references to the global security maps
            const blockedIPs = this.globalResources.getBlockedIPs();
            const suspiciousIPs = this.globalResources.getSuspiciousIPs();
            const invalidURLAttempts = this.globalResources.getInvalidURLAttempts();

            const wasBlocked = blockedIPs.has(ip);
            const wasSuspicious = suspiciousIPs.has(ip);
            const hadInvalidAttempts = invalidURLAttempts.has(ip);

            // Remove from all tracking maps
            blockedIPs.delete(ip);
            suspiciousIPs.delete(ip);
            invalidURLAttempts.delete(ip);

            console.log(`🔓 Admin unblocked IP via WebSocket: ${ip} (was blocked: ${wasBlocked}, was suspicious: ${wasSuspicious}, had invalid attempts: ${hadInvalidAttempts})`);

            this.sendToClient(ws, {
                type: 'unblock_ip_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `IP ${ip} has been unblocked`,
                    wasBlocked,
                    wasSuspicious,
                    hadInvalidAttempts
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error unblocking IP:', error);
            this.sendError(ws, 'Failed to unblock IP', error.message, message.requestId);
        }
    }

    async handleExportIPToGateway(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin
            if (clientInfo.userType !== 'admin') {
                this.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }

            const { ip } = message;
            if (!ip) {
                this.sendError(ws, 'IP address is required', 'MISSING_IP', message.requestId);
                return;
            }

            // Create export directory if it doesn't exist
            const exportDir = path.join(__dirname, '../.cache', 'ip_exports');
            if (!fs.existsSync(exportDir)) {
                fs.mkdirSync(exportDir, { recursive: true });
            }

            // Create export file with timestamp
            const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
            const exportFile = path.join(exportDir, `ip_export_${timestamp}.txt`);

            // Write IP to file
            const exportData = {
                ip: ip,
                exportedAt: new Date().toISOString(),
                exportedBy: clientInfo.sessionId,
                action: 'block',
                reason: 'Exported from StaticForge IP Management'
            };

            fs.writeFileSync(exportFile, JSON.stringify(exportData, null, 2));

            // Remove IP from blocked list after 1 hour
            setTimeout(() => {
                const blockedIPs = global.blockedIPs || new Map();
                if (blockedIPs.has(ip)) {
                    blockedIPs.delete(ip);
                    console.log(`🕐 Auto-removed exported IP from block list: ${ip}`);
                }
            }, 60 * 60 * 1000); // 1 hour

            console.log(`📤 IP exported to gateway: ${ip} (file: ${exportFile})`);

            this.sendToClient(ws, {
                type: 'export_ip_to_gateway_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `IP ${ip} exported to gateway and will be removed from block list in 1 hour`,
                    exportFile: exportFile,
                    exportedAt: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error exporting IP to gateway:', error);
            this.sendError(ws, 'Failed to export IP to gateway', error.message, message.requestId);
        }
    }

    async handleGetIPBlockingReasons(ws, message, clientInfo, wsServer) {
        try {
            // Check if user is admin
            if (clientInfo.userType !== 'admin') {
                this.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }

            const { ip } = message;
            if (!ip) {
                this.sendError(ws, 'IP address is required', 'MISSING_IP', message.requestId);
                return;
            }

            // Get references to the global security maps
            const blockedIPs = this.globalResources.getBlockedIPs();
            const suspiciousIPs = this.globalResources.getSuspiciousIPs();
            const invalidURLAttempts = this.globalResources.getInvalidURLAttempts();

            const blockedData = blockedIPs.get(ip);
            const suspiciousData = suspiciousIPs.get(ip);
            const invalidData = invalidURLAttempts.get(ip);

            const reasons = {
                isBlocked: !!blockedData,
                blockedReason: blockedData?.reason || null,
                blockedAt: blockedData?.blockedAt || null,
                blockedAttempts: blockedData?.attempts || 0,
                isSuspicious: !!suspiciousData,
                suspiciousAttempts: suspiciousData?.attempts || 0,
                suspiciousPatterns: suspiciousData?.patterns || [],
                hasInvalidAttempts: !!invalidData,
                invalidAttempts: invalidData?.count || 0,
                lastInvalidAttempt: invalidData?.lastAttempt || null
            };

            this.sendToClient(ws, {
                type: 'get_ip_blocking_reasons_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    ip: ip,
                    reasons: reasons
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error fetching IP blocking reasons:', error);
            this.sendError(ws, 'Failed to fetch IP blocking reasons', error.message, message.requestId);
        }
    }

    async handleGetApiKeyServices(ws, message, clientInfo, wsServer) {
        try {
            if (clientInfo.userType !== 'admin') {
                this.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }

            const services = this.globalResources.getApiKeyManager().listServiceSummaries().map(service => ({
                ...service,
                keys: Array.isArray(service.keys) ? service.keys.map(key => ({ ...key })) : []
            }));

            this.sendToClient(ws, {
                type: 'get_api_key_services_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    services
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error fetching Service Key services:', error);
            this.sendError(ws, 'Failed to load Service Key configuration', error.message, message.requestId);
        }
    }

    async handleUpdateApiKeySelections(ws, message, clientInfo, wsServer) {
        try {
            if (clientInfo.userType !== 'admin') {
                this.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }

            const updates = Array.isArray(message.updates) ? message.updates : [];
            const normalized = updates
                .map(update => ({
                    service: update?.service || update?.serviceId || update?.id,
                    index: Number(update?.index)
                }))
                .filter(update => typeof update.service === 'string' && Number.isInteger(update.index));

            if (normalized.length === 0) {
                this.sendError(ws, 'No valid Service Key updates provided', 'INVALID_UPDATES', message.requestId);
                return;
            }

            const result = await this.globalResources.getApiKeyManager().applySelectionUpdates(normalized);

            this.sendToClient(ws, {
                type: 'update_api_key_selections_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    updated: result.updated || [],
                    restartedServices: result.restartedServices || []
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error updating Service Key selections:', error);
            this.sendError(ws, 'Failed to update Service Key selections', error.message, message.requestId);
        }
    }

    async handleAddApiKey(ws, message, clientInfo, wsServer) {
        try {
            if (clientInfo.userType !== 'admin') {
                this.sendError(ws, 'Admin access required', 'INSUFFICIENT_PERMISSIONS', message.requestId);
                return;
            }

            const { service, name, apiKey } = message;
            if (!service || typeof service !== 'string') {
                this.sendError(ws, 'Service ID is required', 'MISSING_SERVICE', message.requestId);
                return;
            }
            if (!name || typeof name !== 'string' || name.trim().length === 0) {
                this.sendError(ws, 'Service Key Name is required', 'MISSING_NAME', message.requestId);
                return;
            }
            if (!apiKey || typeof apiKey !== 'string' || apiKey.trim().length === 0) {
                this.sendError(ws, 'Service Key or Contract ID is required', 'MISSING_API_KEY', message.requestId);
                return;
            }

            const result = this.globalResources.getApiKeyManager().addApiKey(service, name.trim(), apiKey.trim());

            console.log(`✅ Added new Service Key "${name}" for service "${service}"`);

            this.sendToClient(ws, {
                type: 'add_api_key_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    service: service,
                    key: result.key
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error adding Service Key:', error);
            this.sendError(ws, 'Failed to add Service Key', error.message, message.requestId);
        }
    }

    // Reference Metadata Handlers

    async handleUpdateReferenceMetadata(ws, message, clientInfo, wsServer) {
        try {
            const { hash, metadata } = message;
            if (!hash) {
                this.sendError(ws, 'Hash is required', 'MISSING_HASH', message.requestId);
                return;
            }

            if (!metadata) {
                this.sendError(ws, 'Metadata is required', 'MISSING_METADATA', message.requestId);
                return;
            }

            const result = this.globalResources.getReferenceMetadataDatabase().setMetadata(hash, metadata);

            this.sendToClient(ws, {
                type: 'update_reference_metadata_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    metadata: result
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error updating reference metadata:', error);
            this.sendError(ws, 'Failed to update reference metadata', error.message, message.requestId);
        }
    }

    // Handle dynamic generation progress updates
    async handleDynamicGenerationProgress(ws, message, clientInfo, wsServer) {
        try {
            const { phase, data } = message;

            // Broadcast the progress update to all connected clients
            wsServer.broadcast({
                type: 'dynamic_generation_progress_update',
                phase: phase,
                data: data,
                timestamp: new Date().toISOString(),
                sessionId: clientInfo.sessionId
            });

        } catch (error) {
            console.error('❌ Error handling dynamic generation progress:', error);
            this.sendError(ws, 'Failed to handle dynamic generation progress', error.message, message.requestId);
        }
    }

    // Handle director feedback submission
    async handleDirectorSaveFeedback(ws, message, clientInfo, wsServer) {
        try {
            const { select_text, replace_text, action, ai_reason, user_feedback, timestamp } = message;

            // Validate required fields
            if (!user_feedback || user_feedback.trim() === '') {
                this.sendError(ws, 'User feedback description is required', 'VALIDATION_ERROR', message.requestId);
                return;
            }

            // Create feedback entry
            const feedbackEntry = {
                id: `feedback_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
                select_text: select_text || '',
                replace_text: replace_text || '',
                action: action || 'replace',
                ai_reason: ai_reason || '',
                user_feedback: user_feedback.trim(),
                timestamp: timestamp || new Date().toISOString(),
                resolved: false
            };

            this.globalResources.modifyConfig('directorConfig').append('feedback.entries', feedbackEntry);

            console.log(`📝 Director feedback saved: ${feedbackEntry.id}`);
            console.log(`   Issue: ${user_feedback.substring(0, 100)}${user_feedback.length > 100 ? '...' : ''}`);

            const feedbackEntries = this.globalResources.getDirectorConfig({ path: 'feedback.entries' }) || [];

            // Send success response
            this.sendToClient(ws, {
                type: 'director_save_feedback_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Feedback saved successfully',
                    feedbackId: feedbackEntry.id,
                    totalEntries: feedbackEntries.length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error saving director feedback:', error);
            this.sendError(ws, 'Failed to save feedback', error.message, message.requestId);
        }
    }

    // Handle director rules loading
    async handleDirectorLoadRules(ws, message, clientInfo, wsServer) {
        try {
            // Load current director config
            const directorConfig = this.globalResources.getDirectorConfig();

            if (!Array.isArray(directorConfig.rules.entries)) {
                directorConfig.rules.entries = [];
            }

            console.log(`📚 Loaded ${directorConfig.rules.entries.length} director rules`);

            // Send response
            this.sendToClient(ws, {
                type: 'director_load_rules_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    rules: directorConfig.rules.entries
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error loading director rules:', error);
            this.sendError(ws, 'Failed to load rules', error.message, message.requestId);
        }
    }

    // Handle director rules saving
    async handleDirectorSaveRules(ws, message, clientInfo, wsServer) {
        try {
            const { rules } = message;

            if (!Array.isArray(rules)) {
                this.sendError(ws, 'Rules must be an array', 'VALIDATION_ERROR', message.requestId);
                return;
            }

            this.globalResources.modifyConfig('directorConfig').assign('rules.entries', rules);

            console.log(`📝 Director rules saved: ${rules.length} rule(s)`);

            // Send success response
            this.sendToClient(ws, {
                type: 'director_save_rules_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Rules saved successfully',
                    totalRules: rules.length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error saving director rules:', error);
            this.sendError(ws, 'Failed to save rules', error.message, message.requestId);
        }
    }

    // Handle director feedback loading
    async handleDirectorLoadFeedback(ws, message, clientInfo, wsServer) {
        try {
            // Load current director config
            const directorConfig = this.globalResources.getDirectorConfig();

            if (!Array.isArray(directorConfig.feedback.entries)) {
                directorConfig.feedback.entries = [];
            }

            console.log(`📚 Loaded ${directorConfig.feedback.entries.length} director feedback entries`);

            // Send response
            this.sendToClient(ws, {
                type: 'director_load_feedback_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    feedback: directorConfig.feedback.entries
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error loading director feedback:', error);
            this.sendError(ws, 'Failed to load feedback', error.message, message.requestId);
        }
    }

    // Handle director feedback deletion
    async handleDirectorDeleteFeedback(ws, message, clientInfo, wsServer) {
        try {
            const { feedbackId } = message;

            if (!feedbackId) {
                this.sendError(ws, 'Feedback ID is required', 'VALIDATION_ERROR', message.requestId);
                return;
            }

            const feedbackEntries = this.globalResources.getDirectorConfig({ path: 'feedback.entries' }) || [];
            if (!feedbackEntries.some(entry => entry.id === feedbackId)) {
                this.sendError(ws, 'Feedback entry not found', 'NOT_FOUND', message.requestId);
                return;
            }

            this.globalResources.modifyConfig('directorConfig').delete('feedback.entries', entry => entry.id === feedbackId);

            console.log(`🗑️ Director feedback deleted: ${feedbackId}`);

            const updatedEntries = this.globalResources.getDirectorConfig({ path: 'feedback.entries' }) || [];

            // Send success response
            this.sendToClient(ws, {
                type: 'director_delete_feedback_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Feedback deleted successfully',
                    totalEntries: updatedEntries.length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Error deleting director feedback:', error);
            this.sendError(ws, 'Failed to delete feedback', error.message, message.requestId);
        }
    }

    async handleResolveDynamicContext(ws, message, clientInfo, wsServer) {
        try {
            const { dynamicConfig, requestId } = message;

            if (!dynamicConfig) {
                this.sendError(ws, 'Dynamic config is required', 'MISSING_CONFIG', requestId);
                return;
            }

            const { resolveDynamicContext } = require('./dynamicGenerationHandlers');

            // Resolve the dynamic context
            const resolvedContext = await resolveDynamicContext(dynamicConfig, clientInfo.ip);

            // Send response back to client
            this.sendToClient(ws, {
                type: 'resolve_dynamic_context_response',
                requestId: requestId,
                data: resolvedContext,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error resolving dynamic context:', error);
            this.sendError(ws, 'Failed to resolve dynamic context', error.message, message.requestId);
        }
    }

    // KNOWLEDGE MEMORY HANDLERS
    async handleListKnowledgeMemories(ws, message, clientInfo, wsServer) {
        try {
            const { requestId } = message;

            const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();

            if (!knowledgeMemoryDb) {
                this.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
                return;
            }

            // Get list of memories
            const memories = knowledgeMemoryDb.listKnowledgeMemories();

            // Get stats
            const stats = knowledgeMemoryDb.getKnowledgeMemoryStats();

            console.log(`📚 Listed ${memories.length} knowledge memories`);

            // Send response
            this.sendToClient(ws, {
                type: 'list_knowledge_memories_response',
                data: {
                    success: true,
                    memories: memories,
                    stats: stats
                },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

        } catch (error) {
            console.error('❌ Error listing knowledge memories:', error);
            this.sendError(ws, 'Failed to list knowledge memories', error.message, message.requestId);
        }
    }

    async handleGetKnowledgeMemory(ws, message, clientInfo, wsServer) {
        try {
            const { name, requestId } = message;

            if (!name) {
                this.sendError(ws, 'Memory name is required', 'MISSING_NAME', requestId);
                return;
            }

            const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();

            if (!knowledgeMemoryDb) {
                this.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
                return;
            }

            // Get memory details without incrementing usage (UI viewing)
            // Pass false to prevent incrementing usage count - only AI access should increment
            const memory = knowledgeMemoryDb.getKnowledgeMemory(name, false);

            if (!memory) {
                this.sendError(ws, `Memory "${name}" not found`, 'MEMORY_NOT_FOUND', requestId);
                return;
            }

            console.log(`👁️ Viewed knowledge memory (no usage increment): ${name}`);

            // Send response
            this.sendToClient(ws, {
                type: 'get_knowledge_memory_response',
                data: {
                    success: true,
                    memory: memory
                },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

        } catch (error) {
            console.error('❌ Error getting knowledge memory:', error);
            this.sendError(ws, 'Failed to get knowledge memory', error.message, message.requestId);
        }
    }

    async handleDeleteKnowledgeMemory(ws, message, clientInfo, wsServer) {
        try {
            const { name, requestId } = message;

            if (!name) {
                this.sendError(ws, 'Memory name is required', 'MISSING_NAME', requestId);
                return;
            }

            const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();

            if (!knowledgeMemoryDb) {
                this.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
                return;
            }

            // Delete memory
            const success = knowledgeMemoryDb.deleteKnowledgeMemory(name);

            if (!success) {
                this.sendError(ws, `Memory "${name}" not found`, 'MEMORY_NOT_FOUND', requestId);
                return;
            }

            console.log(`🗑️ Deleted knowledge memory: ${name}`);

            // Send response
            this.sendToClient(ws, {
                type: 'delete_knowledge_memory_response',
                data: {
                    success: true,
                    message: `Memory "${name}" deleted successfully`
                },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

        } catch (error) {
            console.error('❌ Error deleting knowledge memory:', error);
            this.sendError(ws, 'Failed to delete knowledge memory', error.message, message.requestId);
        }
    }

    async handleDeleteKnowledgeMemoriesBulk(ws, message, clientInfo, wsServer) {
        try {
            const { names, requestId } = message;

            if (!Array.isArray(names) || names.length === 0) {
                this.sendError(ws, 'Memory names array is required and must not be empty', 'MISSING_NAMES', requestId);
                return;
            }

            const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();

            if (!knowledgeMemoryDb) {
                this.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
                return;
            }

            // Bulk delete memories
            const result = knowledgeMemoryDb.deleteKnowledgeMemoriesBulk(names);

            console.log(`🗑️ Bulk deleted ${result.deletedCount} knowledge memor${result.deletedCount === 1 ? 'y' : 'ies'}`);
            if (result.failedNames.length > 0) {
                console.log(`⚠️ Failed to delete ${result.failedNames.length} memor${result.failedNames.length === 1 ? 'y' : 'ies'}: ${result.failedNames.join(', ')}`);
            }

            // Send response
            this.sendToClient(ws, {
                type: 'delete_knowledge_memories_bulk_response',
                data: {
                    success: true,
                    deletedCount: result.deletedCount,
                    failedNames: result.failedNames,
                    message: `Deleted ${result.deletedCount} memor${result.deletedCount === 1 ? 'y' : 'ies'}${result.failedNames.length > 0 ? `, ${result.failedNames.length} failed` : ''}`
                },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

        } catch (error) {
            console.error('❌ Error bulk deleting knowledge memories:', error);
            this.sendError(ws, 'Failed to bulk delete knowledge memories', error.message, message.requestId);
        }
    }

    async handleCountKnowledgeMemoriesByFilter(ws, message, clientInfo, wsServer) {
        try {
            const { filterType, requestId } = message;

            if (!filterType) {
                this.sendError(ws, 'Filter type is required', 'MISSING_FILTER_TYPE', requestId);
                return;
            }

            const validFilters = ['low_confidence', 'old_usage', 'never_used', 'everything'];
            if (!validFilters.includes(filterType)) {
                this.sendError(ws, `Invalid filter type. Must be one of: ${validFilters.join(', ')}`, 'INVALID_FILTER_TYPE', requestId);
                return;
            }

            const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();

            if (!knowledgeMemoryDb) {
                this.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
                return;
            }

            // Count memories by filter
            const count = knowledgeMemoryDb.countKnowledgeMemoriesByFilter(filterType);

            const filterDescriptions = {
                'low_confidence': 'Low Confidence (< 30%)',
                'old_usage': '>30 Days Usage',
                'never_used': 'Never Used',
                'everything': 'Everything'
            };

            // Send response
            this.sendToClient(ws, {
                type: 'count_knowledge_memories_by_filter_response',
                data: {
                    success: true,
                    count: count,
                    filterType: filterType,
                    description: filterDescriptions[filterType]
                },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

        } catch (error) {
            console.error('❌ Error counting knowledge memories by filter:', error);
            this.sendError(ws, 'Failed to count knowledge memories by filter', error.message, message.requestId);
        }
    }

    async handleDeleteKnowledgeMemoriesByFilter(ws, message, clientInfo, wsServer) {
        try {
            const { filterType, requestId } = message;

            if (!filterType) {
                this.sendError(ws, 'Filter type is required', 'MISSING_FILTER_TYPE', requestId);
                return;
            }

            const validFilters = ['low_confidence', 'old_usage', 'never_used', 'everything'];
            if (!validFilters.includes(filterType)) {
                this.sendError(ws, `Invalid filter type. Must be one of: ${validFilters.join(', ')}`, 'INVALID_FILTER_TYPE', requestId);
                return;
            }

            const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();

            if (!knowledgeMemoryDb) {
                this.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
                return;
            }

            // Delete memories by filter
            const result = knowledgeMemoryDb.deleteKnowledgeMemoriesByFilter(filterType);

            const filterDescriptions = {
                'low_confidence': 'Low Confidence (< 30%)',
                'old_usage': '>30 Days Usage',
                'never_used': 'Never Used',
                'everything': 'Everything'
            };

            console.log(`🗑️ Deleted ${result.deletedCount} knowledge memor${result.deletedCount === 1 ? 'y' : 'ies'} matching "${filterDescriptions[filterType]}"`);

            // Send response
            this.sendToClient(ws, {
                type: 'delete_knowledge_memories_by_filter_response',
                data: {
                    success: true,
                    deletedCount: result.deletedCount,
                    matchedCount: result.matchedCount,
                    filterType: filterType,
                    message: `Deleted ${result.deletedCount} memor${result.deletedCount === 1 ? 'y' : 'ies'} matching "${filterDescriptions[filterType]}"`
                },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

        } catch (error) {
            console.error('❌ Error deleting knowledge memories by filter:', error);
            this.sendError(ws, 'Failed to delete knowledge memories by filter', error.message, message.requestId);
        }
    }

    async handleUpdateKnowledgeMemory(ws, message, clientInfo, wsServer) {
        try {
            const { name, updates, requestId } = message;

            if (!name) {
                this.sendError(ws, 'Memory name is required', 'MISSING_NAME', requestId);
                return;
            }

            if (!updates || typeof updates !== 'object') {
                this.sendError(ws, 'Updates object is required', 'MISSING_UPDATES', requestId);
                return;
            }

            const knowledgeMemoryDb = this.globalResources.getKnowledgeMemoryDb();

            if (!knowledgeMemoryDb) {
                this.sendError(ws, 'Knowledge memory database not available', 'DB_NOT_AVAILABLE', requestId);
                return;
            }

            // Get existing memory to merge updates
            const existingMemory = knowledgeMemoryDb.getKnowledgeMemory(name, false);
            if (!existingMemory) {
                this.sendError(ws, `Memory "${name}" not found`, 'MEMORY_NOT_FOUND', requestId);
                return;
            }

            // Prepare updated values (merge with existing)
            const updatedName = updates.name || existingMemory.name;
            const updatedDescription = updates.description !== undefined ? updates.description : existingMemory.description;
            const updatedCategory = updates.category !== undefined ? updates.category : existingMemory.category;
            const updatedConfidence = updates.confidence !== undefined ? updates.confidence : existingMemory.confidence;
            const updatedEntities = updates.entities !== undefined ? updates.entities : existingMemory.entities;
            const updatedRelations = updates.relations !== undefined ? updates.relations : existingMemory.relations;
            const updatedObservations = updates.observations !== undefined ? updates.observations : existingMemory.observations;

            // If name changed, we need to handle it specially
            let finalName = updatedName;
            if (updates.name && updates.name !== name) {
                // Check if new name already exists
                const existingWithNewName = knowledgeMemoryDb.getKnowledgeMemory(updates.name, false);
                if (existingWithNewName) {
                    this.sendError(ws, `Memory with name "${updates.name}" already exists`, 'NAME_EXISTS', requestId);
                    return;
                }
                // Update will be handled by saveKnowledgeMemory which can handle name changes
                finalName = updates.name;
            }

            // Convert entities format if needed (ensure they have id field)
            // Use name as id if id not provided, or generate one
            const formattedEntities = updatedEntities.map((entity, index) => ({
                id: entity.id || entity.name || `entity_${Date.now()}_${index}`,
                type: entity.type || '',
                name: entity.name || '',
                attributes: entity.attributes || {}
            }));

            // Convert observations format (ensure they have entity_id)
            // Observations don't need entity_id to be set, can be empty string
            const formattedObservations = updatedObservations.map((obs) => ({
                entity_id: obs.entity_id || '',
                content: obs.content || '',
                importance: obs.importance !== undefined ? obs.importance : 0.5
            }));

            // Use saveKnowledgeMemory which handles both create and update
            // But we need to delete the old one first if name changed
            if (updates.name && updates.name !== name) {
                knowledgeMemoryDb.deleteKnowledgeMemory(name);
            }

            // Save the updated memory
            const result = knowledgeMemoryDb.saveKnowledgeMemory(
                finalName,
                updatedDescription,
                updatedCategory,
                formattedEntities,
                updatedRelations,
                formattedObservations,
                updatedConfidence
            );

            console.log(`✏️ Updated knowledge memory: ${name}${updates.name && updates.name !== name ? ` (renamed to ${finalName})` : ''}`);

            // Send response
            this.sendToClient(ws, {
                type: 'update_knowledge_memory_response',
                data: {
                    success: true,
                    memory: result,
                    message: `Memory updated successfully${updates.name && updates.name !== name ? ` and renamed to "${finalName}"` : ''}`
                },
                timestamp: new Date().toISOString(),
                requestId: requestId
            });

        } catch (error) {
            console.error('❌ Error updating knowledge memory:', error);
            this.sendError(ws, 'Failed to update knowledge memory', error.message, message.requestId);
        }
    }

    // Helper method to provide user-friendly error messages for image generation failures
    getImageGenerationErrorMessage(error) {
        if (!error) {
            return 'Image generation failed for an unknown reason';
        }

        const errorMessage = error.message || error.toString();

        // Handle specific error types with user-friendly messages
        if (error.name === 'AbortError' || errorMessage.includes('aborted')) {
            return 'Image generation timed out. The request took too long to complete. Please try again.';
        }

        if (errorMessage.includes('fetch failed') || errorMessage.includes('TypeError: fetch failed')) {
            return 'Failed to contact NovelAI Image Generation API. Please check your internet connection and try again. If the problem persists, the image generation service may be temporarily unavailable.';
        }

        if (errorMessage.includes('ECONNREFUSED') || errorMessage.includes('connection refused')) {
            return 'Unable to connect to the image generation service. The service may be temporarily down. Please try again in a few minutes.';
        }

        if (errorMessage.includes('ENOTFOUND') || errorMessage.includes('DNS')) {
            return 'DNS resolution failed. Please check your internet connection and try again.';
        }

        if (errorMessage.includes('timeout') || errorMessage.includes('ETIMEDOUT')) {
            return 'Request timed out. The image generation service is taking longer than expected. Please try again.';
        }

        if (errorMessage.includes('429') || errorMessage.includes('rate limit') || errorMessage.includes('quota')) {
            return 'Rate limit exceeded. Too many requests have been made. Please wait a moment before trying again.';
        }

        if (errorMessage.includes('403') || errorMessage.includes('forbidden') || errorMessage.includes('unauthorized')) {
            return 'Access denied. Please check your authentication and try again.';
        }

        if (errorMessage.includes('500') || errorMessage.includes('internal server error')) {
            return 'Server error occurred. The image generation service encountered an internal problem. Please try again later.';
        }

        if (errorMessage.includes('503') || errorMessage.includes('service unavailable')) {
            return 'Service temporarily unavailable. The image generation service is currently overloaded. Please try again in a few minutes.';
        }

        if (errorMessage.includes('insufficient') && errorMessage.includes('credit')) {
            return 'Insufficient credits. You do not have enough credits to generate this image. Please top up your account.';
        }

        if (errorMessage.includes('invalid') && errorMessage.includes('prompt')) {
            return 'Invalid prompt. Please check your prompt and try again.';
        }

        // For any other error, provide a generic but helpful message
        if (errorMessage.length > 100) {
            return `Image generation failed: ${errorMessage.substring(0, 100)}...`;
        }

        return `Image generation failed: ${errorMessage}`;
    }

    // Handle server status request (critical - no auth required)
    async handleServerStatus(ws, message, clientInfo, wsServer) {
        try {
            const globalResources = this.globalResources;
            const isReady = globalResources.isReady && globalResources.isInitialized();
            const stage = globalResources.getServerStage ? globalResources.getServerStage() : 'unknown';
            
            wsServer.sendToClient(ws, {
                type: 'server_status_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    isReady: isReady,
                    stage: stage,
                    timestamp: new Date().toISOString()
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error handling server status:', error);
            wsServer.sendToClient(ws, {
                type: 'server_status_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle check updates request (critical - no auth required)
    async handleCheckUpdates(ws, message, clientInfo, wsServer) {
        try {
            // This is a placeholder - actual update checking is done via HTTP
            // But we can acknowledge the request
            wsServer.sendToClient(ws, {
                type: 'check_updates_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Update check should be performed via HTTP OPTIONS request to /'
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error handling check updates:', error);
            wsServer.sendToClient(ws, {
                type: 'check_updates_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }

    // Handle version check request (critical - no auth required)
    async handleVersionCheck(ws, message, clientInfo, wsServer) {
        try {
            const packageJson = require('../package.json');
            const serverVersion = packageJson.version || 'unknown';
            
            wsServer.sendToClient(ws, {
                type: 'version_check_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    serverVersion: serverVersion,
                    clientVersion: message.data?.clientVersion || 'unknown',
                    compatible: true // Add version compatibility logic if needed
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('❌ Error handling version check:', error);
            wsServer.sendToClient(ws, {
                type: 'version_check_response',
                requestId: message.requestId,
                data: {
                    success: false,
                    error: error.message
                },
                timestamp: new Date().toISOString()
            });
        }
    }
}
module.exports = { WebSocketMessageHandlers };
