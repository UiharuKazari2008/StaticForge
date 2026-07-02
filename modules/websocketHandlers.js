const { WebSocketServer } = require('./websocket');
const VfsWebSocketHandlers = require('./vfsWebSocketHandlers');
const {
    normalizeAutofillSearchSettings,
    mergeAutofillSearchSettingsPatch
} = require('./autofillSearchSettings');
const grimoireDomainRegistry = require('./grimoireDomainRegistry');
const wsPacketRegistry = require('./ws/wsPacketRegistry');
const registerAllWsHandlers = require('./ws/registerAllWsHandlers');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

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
        this.cancelledGenerationRequestIds = new Set(); // Client-cancelled image generation request IDs
        this.activeGenerationByClient = new WeakMap(); // ws -> Set<requestId>
        this.metadataCache = new MetadataCache(1000); // LRU cache with 1000 items
        this.metadataCache.startCleanup(); // Start periodic cleanup
        this.vfsHandlers = new VfsWebSocketHandlers(this);
        const { buildGalleryData } = require('./ws/handlers/120-galleryHandler');
        this.buildGalleryData = (viewType, clientInfo) => buildGalleryData(this, viewType, clientInfo);
        registerAllWsHandlers(this);

        // Bind any Grimoire domain/applet declared WS packets so they can own their messages
        // without every new applet editing this giant central switch.
        try {
            const reg = this.globalResources.getGrimoireDomainRegistry?.();
            if (reg && typeof reg.bindAllDomainPackets === 'function') {
                reg.bindAllDomainPackets(this);
            }
        } catch (e) {
            console.warn('[WS] Failed to bind grimoire domain packets:', e.message);
        }
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

            // Application key scope enforcement
            if (clientInfo.authMethod === 'application_key' && Array.isArray(clientInfo.applicationScopes)) {
                const appAuthManager = this.globalResources.getApplicationAuthManager();
                if (!appAuthManager.canAccessWsPacket(clientInfo.applicationScopes, message.type, clientInfo.userType)) {
                    wsServer.sendToClient(ws, {
                        type: 'error',
                        message: 'Application key does not have scope for this operation',
                        code: 'INSUFFICIENT_SCOPE',
                        requestId: message.requestId || null,
                        timestamp: new Date().toISOString()
                    });
                    return;
                }
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
                message: error.message || 'Internal server error',
                details: message.type,
                requestId: message.requestId || null,
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
            'import_vibe_from_url',
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
            'scan_text_replacements',
            'compile_dynamic_generation',
            'apply_tendai_preview',
            'resolve_text_replacements',
            'spellcheck_add_word',
            'generate_image',
            'upscale_image',
            'reroll_image',
            'expand_image',
            'preview_expand_image_prompt',
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
            'cancel_pending_requests',
            'cancel_session_pending_requests',
            'get_api_key_services',
            'update_api_key_selections',
            'add_api_key',
            'update_api_key',
            'clear_search_cache',
            'refresh_server_cache',
            'recompile_runtime_assets',
            'set_runtime_assets_auto_recompile',
            'config_editor_save',
            'config_editor_checkpoints_create',
            'config_editor_checkpoints_restore',
            'config_editor_checkpoints_delete',
            'generate_nax_custom_tag',
            'delete_nax_custom_tag',
            'novel_update',
            'novel_generate',
            'novel_undo',
            'desktop_add_shortcut',
            'desktop_update_shortcut',
            'desktop_remove_shortcut',
            'desktop_update_positions',
            'vfs_create_folder',
            'vfs_rename_folder',
            'vfs_rename_file',
            'vfs_delete_folder',
            'vfs_move_items',
            'vfs_copy_items',
            'vfs_delete_entry',
            'vfs_rename_shortcut_entry',
            'vfs_rename_entry',
            'vfs_upload_file',
            'vfs_replace_file',
            'vfs_delete_file',
            'vfs_move_to_trash',
            'vfs_restore_from_trash',
            'vfs_empty_trash',
            'vfs_permanently_delete',
            'vfs_convert_reference_to_file',
            'vfs_convert_file_to_reference',
            'desktop_create_empty_folder',
            'desktop_update_shortcut_folders',
            'desktop_create_folder_from_selection',
            'save_persona_settings',
            'create_chat_session',
            'delete_chat_session',
            'restart_chat_session',
            'send_chat_message',
            'update_chat_context',
            'delete_chat_message',
            'unblock_ip',
            'export_ip_to_gateway',
            'delete_known_bad_path',
            'clear_known_bad_paths',
            'set_admin_pin',
            'set_user_pin',
            'set_user_pin_login_enabled',
            'update_user_global_settings',
            'generation_quips_run',
            'generation_quips_clear',
        ];
        return destructiveOperations.includes(messageType);
    }

    normalizeStartMenuPinnedSetting(desktop) {
        if (!desktop || !Array.isArray(desktop.startMenuPinned)) return undefined;
        return desktop.startMenuPinned
            .filter((id) => typeof id === 'string' && id.trim())
            .map((id) => id.trim())
            .slice(0, 48);
    }

    normalizeStartMenuButtonSetting(desktop) {
        const raw = desktop && desktop.startMenuButton && typeof desktop.startMenuButton === 'object'
            ? desktop.startMenuButton
            : {};
        const validPresets = new Set([
            'start-ja', 'start-ko', 'start-en', 'start-fr', 'start-ru',
            'dream-ja', 'dream-ko', 'dream-en', 'dream-de', 'dream-fr', 'dream-ru',
            'custom'
        ]);
        let preset = validPresets.has(raw.preset) ? raw.preset : 'start-ja';
        if (preset === 'start-de') {
            preset = 'start-en';
        }
        const customText = typeof raw.customText === 'string'
            ? raw.customText.trim().slice(0, 24)
            : '';
        const validStyles = new Set(['luna', 'workspace', 'orb']);
        const style = validStyles.has(raw.style) ? raw.style : 'workspace';
        return { preset, customText, style };
    }

    normalizeUserGlobalSettings(raw) {
        const base = raw && typeof raw === 'object' ? raw : {};
        const naxt = base.naxt && typeof base.naxt === 'object' ? base.naxt : {};
        const desktop = base.desktop && typeof base.desktop === 'object' ? base.desktop : {};
        const pinned = this.normalizeStartMenuPinnedSetting(desktop);
        const desktopOut = {
            autoLaunchWorkspace: desktop.autoLaunchWorkspace !== false,
            liveWindowRepositioning: desktop.liveWindowRepositioning === true,
            exitDesktopOnWorkspaceMaximise: desktop.exitDesktopOnWorkspaceMaximise === true,
            notificationBridgeEnabled: desktop.notificationBridgeEnabled !== false,
            bypassNotificationBridgeInDesktopMode: desktop.bypassNotificationBridgeInDesktopMode === true,
            startMenuButton: this.normalizeStartMenuButtonSetting(desktop)
        };
        if (pinned !== undefined) {
            desktopOut.startMenuPinned = pinned;
        }
        return {
            desktop: desktopOut,
            naxt: {
                elevatePins: this.normalizeNaxtElevatePinsSetting(naxt)
            },
            autofillSearch: normalizeAutofillSearchSettings(base.autofillSearch)
        };
    }

    mergeUserGlobalSettingsPatch(existing, patch) {
        const out = this.normalizeUserGlobalSettings(existing);
        if (!patch || typeof patch !== 'object') {
            return out;
        }
        if (patch.desktop && typeof patch.desktop === 'object') {
            if (typeof patch.desktop.autoLaunchWorkspace === 'boolean') {
                out.desktop.autoLaunchWorkspace = patch.desktop.autoLaunchWorkspace;
            }
            if (typeof patch.desktop.liveWindowRepositioning === 'boolean') {
                out.desktop.liveWindowRepositioning = patch.desktop.liveWindowRepositioning;
            }
            if (typeof patch.desktop.exitDesktopOnWorkspaceMaximise === 'boolean') {
                out.desktop.exitDesktopOnWorkspaceMaximise = patch.desktop.exitDesktopOnWorkspaceMaximise;
            }
            if (typeof patch.desktop.notificationBridgeEnabled === 'boolean') {
                out.desktop.notificationBridgeEnabled = patch.desktop.notificationBridgeEnabled;
            }
            if (typeof patch.desktop.bypassNotificationBridgeInDesktopMode === 'boolean') {
                out.desktop.bypassNotificationBridgeInDesktopMode = patch.desktop.bypassNotificationBridgeInDesktopMode;
            }
            if (patch.desktop.startMenuButton && typeof patch.desktop.startMenuButton === 'object') {
                out.desktop.startMenuButton = this.normalizeStartMenuButtonSetting({
                    ...out.desktop,
                    startMenuButton: {
                        ...out.desktop.startMenuButton,
                        ...patch.desktop.startMenuButton
                    }
                });
            }
            if (Array.isArray(patch.desktop.startMenuPinned)) {
                out.desktop.startMenuPinned = this.normalizeStartMenuPinnedSetting({
                    startMenuPinned: patch.desktop.startMenuPinned
                });
            }
        }
        if (patch.naxt && typeof patch.naxt === 'object') {
            if (typeof patch.naxt.elevatePins === 'number' || typeof patch.naxt.elevatePins === 'string') {
                out.naxt.elevatePins = this.normalizeNaxtElevatePinsSetting(patch.naxt);
            } else if (typeof patch.naxt.elevateFavorites === 'boolean') {
                out.naxt.elevatePins = patch.naxt.elevateFavorites ? 1 : 0;
            }
        }
        if (patch.autofillSearch && typeof patch.autofillSearch === 'object') {
            out.autofillSearch = mergeAutofillSearchSettingsPatch(out.autofillSearch, patch.autofillSearch);
        }
        return out;
    }

    normalizeNaxtElevatePinsSetting(naxt) {
        const naxTagsDatabase = this.globalResources && this.globalResources.getNaxTagsDatabase
            ? this.globalResources.getNaxTagsDatabase()
            : null;
        const normalize = naxTagsDatabase && typeof naxTagsDatabase.normalizeElevatePins === 'function'
            ? naxTagsDatabase.normalizeElevatePins.bind(naxTagsDatabase)
            : null;
        if (normalize) {
            if (naxt && typeof naxt.elevatePins !== 'undefined') {
                return normalize(naxt.elevatePins);
            }
            if (naxt && naxt.elevateFavorites === true) return 1;
            return 0;
        }
        if (naxt && typeof naxt.elevatePins === 'number' && naxt.elevatePins >= 0 && naxt.elevatePins <= 3) {
            return Math.floor(naxt.elevatePins);
        }
        return naxt && naxt.elevateFavorites === true ? 1 : 0;
    }

    // Route messages to appropriate handlers
    async routeMessage(ws, message, clientInfo, wsServer) {
        // First, allow Grimoire domains / applets to own specific packets.
        // Registered via grimoireDomainRegistry.registerPacketHandler or via domain.packets in registration.
        const direct = grimoireDomainRegistry.getPacketHandler && grimoireDomainRegistry.getPacketHandler(message.type);
        if (direct) {
            try {
                await direct({ ws, message, clientInfo, wsServer, handlers: this });
            } catch (err) {
                console.error('[WS] Domain packet handler error for', message.type, err);
                this.sendError(ws, 'Packet handler failed', err.message, message.requestId);
            }
            return;
        }

        const registeredPacket = wsPacketRegistry.getWsPacketHandler(message.type);
        if (registeredPacket) {
            try {
                await registeredPacket({ ws, message, clientInfo, wsServer, handlers: this });
            } catch (err) {
                console.error('[WS] Registered packet handler error for', message.type, err);
                this.sendError(ws, 'Packet handler failed', err.message, message.requestId);
            }
            return;
        }

        this.sendError(ws, 'Unknown message type', message.type);
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
    async handleDesktopGetShortcuts(ws, message, clientInfo, wsServer) {
        try {
            const { workspaceId } = message;

            if (!workspaceId) {
                this.sendError(ws, 'Workspace ID is required', 'desktop_get_shortcuts', message.requestId);
                return;
            }

            const workspaceManager = this.globalResources.getWorkspaceManager();
            const syncResult = workspaceManager.syncTrashDesktopShortcut(workspaceId);
            if (syncResult.changed) {
                const timestamp = new Date().toISOString();
                if (syncResult.action === 'added') {
                    wsServer.broadcast({
                        type: 'desktop_shortcut_added',
                        data: { workspaceId, shortcut: syncResult.shortcut },
                        timestamp
                    });
                } else if (syncResult.action === 'removed') {
                    wsServer.broadcast({
                        type: 'desktop_shortcut_removed',
                        data: { workspaceId, shortcutId: syncResult.shortcutId },
                        timestamp
                    });
                } else if (syncResult.action === 'updated') {
                    wsServer.broadcast({
                        type: 'desktop_shortcut_updated',
                        data: {
                            workspaceId,
                            shortcutId: syncResult.shortcutId,
                            updates: syncResult.updates || {}
                        },
                        timestamp
                    });
                }
            }

            const desktopData = workspaceManager.getDesktopShortcuts(workspaceId);

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

            const wm = this.globalResources.getWorkspaceManager();
            const { shortcuts } = wm.getDesktopShortcuts(workspaceId);
            const shortcut = (shortcuts || []).find(s => s.id === shortcutId);

            const result = wm.removeDesktopShortcut(workspaceId, shortcutId);

            if (shortcut?.type === 'note' && shortcut.data?.noteId) {
                const vfs = this.globalResources.getVfsManager();
                await vfs.restoreNoteIfLastSurfaceReference(shortcut.data.noteId, {
                    excludeShortcutId: shortcutId
                });
            }

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
    async handleNovelList(ws, message, clientInfo, wsServer) {
        try {
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            const workspaceId = message.workspaceId || activeWorkspaceId;
            const novels = await this.globalResources.getNovelHandlers().listNovels(workspaceId);
            this.sendToClient(ws, {
                type: 'novel_list_response',
                requestId: message.requestId,
                data: { novels },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Novel list error:', error);
            this.sendError(ws, 'Failed to list novels', error.message, message.requestId);
        }
    }

    async handleNovelGet(ws, message, clientInfo, wsServer) {
        try {
            const { noteId } = message;
            if (!noteId) {
                this.sendError(ws, 'Note ID is required', 'novel_get', message.requestId);
                return;
            }
            const note = await this.globalResources.notesDatabase.getNote(noteId);
            if (!note || note.note_kind !== 'novel') {
                this.sendError(ws, 'Novel note not found', 'novel_get', message.requestId);
                return;
            }
            this.sendToClient(ws, {
                type: 'novel_get_response',
                requestId: message.requestId,
                data: { note },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Novel get error:', error);
            this.sendError(ws, 'Failed to get novel', error.message, message.requestId);
        }
    }

    async handleNovelUpdate(ws, message, clientInfo, wsServer) {
        try {
            const { noteId, updates } = message;
            if (!noteId || !updates) {
                this.sendError(ws, 'Note ID and updates are required', 'novel_update', message.requestId);
                return;
            }
            const note = await this.globalResources.notesDatabase.updateNote(noteId, updates);
            this.sendToClient(ws, {
                type: 'novel_update_response',
                requestId: message.requestId,
                data: { success: true, note },
                timestamp: new Date().toISOString()
            });
            wsServer.broadcast({
                type: 'note_updated',
                data: { noteId, updates, note },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Novel update error:', error);
            this.sendError(ws, 'Failed to update novel', error.message, message.requestId);
        }
    }

    async handleNovelGenerate(ws, message, clientInfo, wsServer) {
        try {
            const { noteId } = message;
            if (!noteId) {
                this.sendError(ws, 'Note ID is required', 'novel_generate', message.requestId);
                return;
            }
            const novelHandlers = this.globalResources.getNovelHandlers();
            this.sendToClient(ws, {
                type: 'novel_generate_response',
                requestId: message.requestId,
                data: { success: true, started: true, noteId },
                timestamp: new Date().toISOString()
            });
            setImmediate(async () => {
                try {
                    const result = await novelHandlers.runGenerate(ws, wsServer, message);
                    this.sendToClient(ws, {
                        type: 'novel_generate_complete',
                        requestId: message.requestId,
                        data: result,
                        timestamp: new Date().toISOString()
                    });
                    wsServer.broadcast({
                        type: 'novel_updated',
                        data: { noteId, note: result.note },
                        timestamp: new Date().toISOString()
                    });
                } catch (error) {
                    console.error('Novel generate error:', error);
                    novelHandlers.publishProgress(wsServer, {
                        phase: 'error',
                        noteId,
                        requestId: message.requestId,
                        reason: error.message
                    });
                    this.sendToClient(ws, {
                        type: 'novel_generate_complete',
                        requestId: message.requestId,
                        data: { success: false, error: error.message },
                        timestamp: new Date().toISOString()
                    });
                }
            });
        } catch (error) {
            console.error('Novel generate start error:', error);
            this.sendError(ws, 'Failed to start novel generation', error.message, message.requestId);
        }
    }

    async handleNovelUndo(ws, message, clientInfo, wsServer) {
        try {
            const { noteId } = message;
            if (!noteId) {
                this.sendError(ws, 'Note ID is required', 'novel_undo', message.requestId);
                return;
            }
            const result = await this.globalResources.getNovelHandlers().runUndo(noteId);
            this.sendToClient(ws, {
                type: 'novel_undo_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
            wsServer.broadcast({
                type: 'novel_updated',
                data: { noteId, note: result.note },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Novel undo error:', error);
            this.sendError(ws, 'Failed to undo novel generation', error.message, message.requestId);
        }
    }

    async handleNovelResolveImage(ws, message, clientInfo, wsServer) {
        try {
            const { noteId } = message;
            if (!noteId) {
                this.sendError(ws, 'Note ID is required', 'novel_resolve_image', message.requestId);
                return;
            }
            const result = await this.globalResources.getNovelHandlers().resolveImage(noteId, message.filename || null);
            this.sendToClient(ws, {
                type: 'novel_resolve_image_response',
                requestId: message.requestId,
                data: result,
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Novel resolve image error:', error);
            this.sendError(ws, 'Failed to resolve novel image', error.message, message.requestId);
        }
    }
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

    // Step preview frames are batched to reduce WebSocket message overhead on high-latency links.
    STEP_PREVIEW_BATCH_FLUSH_MS = 120;
    STEP_PREVIEW_BATCH_MAX_FRAMES = 8;
    STEP_PREVIEW_BUFFERED_BYTES_THRESHOLD = 512 * 1024;
    STEP_PREVIEW_INITIAL_MIN_FRAMES = 5;
    STEP_PREVIEW_INITIAL_MAX_WAIT_MS = 1000;

    createStepPreviewBatcher(ws, requestId, progressBase = {}) {
        const pendingFrames = [];
        let flushTimer = null;
        let initialWaitTimer = null;
        let initialPhaseComplete = false;
        const maxFrames = this.STEP_PREVIEW_BATCH_MAX_FRAMES;
        const flushMs = this.STEP_PREVIEW_BATCH_FLUSH_MS;
        const bufferedThreshold = this.STEP_PREVIEW_BUFFERED_BYTES_THRESHOLD;
        const initialMinFrames = this.STEP_PREVIEW_INITIAL_MIN_FRAMES;
        const initialMaxWaitMs = this.STEP_PREVIEW_INITIAL_MAX_WAIT_MS;

        const isSendBufferHigh = () => {
            return ws && typeof ws.bufferedAmount === 'number'
                && ws.bufferedAmount >= bufferedThreshold;
        };

        const clearInitialWaitTimer = () => {
            if (initialWaitTimer) {
                clearTimeout(initialWaitTimer);
                initialWaitTimer = null;
            }
        };

        const flushNow = () => {
            if (flushTimer) {
                clearTimeout(flushTimer);
                flushTimer = null;
            }
            clearInitialWaitTimer();
            if (pendingFrames.length === 0) return;
            initialPhaseComplete = true;
            const stepFrames = pendingFrames.splice(0, pendingFrames.length);
            const lastFrame = stepFrames[stepFrames.length - 1];
            this.sendGenerationProgress(ws, requestId, {
                ...progressBase,
                phase: 'generating',
                stepFrames,
                currentStep: lastFrame.currentStep,
                totalSteps: lastFrame.totalSteps,
                imageData: lastFrame.imageData,
                imageFormat: lastFrame.imageFormat || 'jpeg'
            });
        };

        const scheduleFlush = () => {
            if (flushTimer) return;
            flushTimer = setTimeout(flushNow, flushMs);
        };

        const scheduleInitialWaitFlush = () => {
            if (initialWaitTimer || initialPhaseComplete) return;
            initialWaitTimer = setTimeout(flushNow, initialMaxWaitMs);
        };

        return {
            add(frame) {
                pendingFrames.push(frame);
                if (!initialPhaseComplete) {
                    if (pendingFrames.length >= initialMinFrames) {
                        flushNow();
                    } else {
                        scheduleInitialWaitFlush();
                    }
                    return;
                }
                if (pendingFrames.length >= maxFrames || isSendBufferHigh()) {
                    flushNow();
                } else {
                    scheduleFlush();
                }
            },
            flush() {
                flushNow();
            },
            dispose() {
                if (flushTimer) {
                    clearTimeout(flushTimer);
                    flushTimer = null;
                }
                clearInitialWaitTimer();
                pendingFrames.length = 0;
            }
        };
    }

    // Resolve byte length for a generated image (buffer or saved file on disk).
    resolveGeneratedImageContentLength(result) {
        if (!result) return null;
        if (result.buffer) {
            return result.buffer.length;
        }
        if (result.image && typeof result.image === 'string') {
            return Buffer.from(result.image, 'base64').length;
        }
        const filename = result.filename || null;
        if (!filename) return null;
        try {
            const filePath = path.join(this.globalResources.getPath('images'), filename);
            if (fs.existsSync(filePath)) {
                return fs.statSync(filePath).size;
            }
        } catch (_) { /* ignore */ }
        return null;
    }

    // Send unified image generation progress updates
    sendGenerationProgress(ws, requestId, progressData) {
        let imageData = progressData.imageData || null;
        let stepFrames = progressData.stepFrames || null;
        if (stepFrames && Array.isArray(stepFrames) && stepFrames.length > 0) {
            const lastFrame = stepFrames[stepFrames.length - 1];
            if (!imageData && lastFrame && lastFrame.imageData) {
                imageData = lastFrame.imageData;
            }
        }

        this.sendToClient(ws, {
            type: 'image_generation_progress',
            requestId: requestId,
            data: {
                phase: progressData.phase, // 'starting|streaming|completion|generating|tool_execution|upscaling|previews|complete|stage_delay'
                currentStep: progressData.currentStep || 0,
                totalSteps: progressData.totalSteps || 0,
                currentKey: progressData.currentKey || 0,
                totalKeys: progressData.totalKeys || 0,
                hasDynamicGen: progressData.hasDynamicGen || false,
                isUpscaling: progressData.isUpscaling || false,
                reasoning: progressData.reasoning || null, // for 3rd line display
                toolName: progressData.toolName || null, // tool name for icon/styling
                toolReason: progressData.toolReason || null, // tool-specific reason
                imageData,
                imageFormat: progressData.imageFormat || (stepFrames && stepFrames[0] ? stepFrames[0].imageFormat : null) || null,
                stepFrames,
                // Staged generation fields
                totalStages: progressData.totalStages || null,
                currentStage: progressData.currentStage || null,
                stageType: progressData.stageType || null,
                delayMs: progressData.delayMs || null,
                contentLength: progressData.contentLength || null,
                filename: progressData.filename || null
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

    markGenerationCancelled(requestId) {
        if (typeof requestId === 'string' && requestId) {
            this.cancelledGenerationRequestIds.add(requestId);
        }
    }

    isGenerationCancelled(requestId) {
        return !!(requestId && this.cancelledGenerationRequestIds.has(requestId));
    }

    clearGenerationCancelled(requestId) {
        if (requestId) {
            this.cancelledGenerationRequestIds.delete(requestId);
        }
    }

    registerActiveGeneration(ws, requestId) {
        if (!ws || typeof requestId !== 'string' || !requestId) return;
        let activeIds = this.activeGenerationByClient.get(ws);
        if (!activeIds) {
            activeIds = new Set();
            this.activeGenerationByClient.set(ws, activeIds);
        }
        activeIds.add(requestId);
    }

    unregisterActiveGeneration(ws, requestId) {
        if (!ws || typeof requestId !== 'string' || !requestId) return;
        const activeIds = this.activeGenerationByClient.get(ws);
        if (!activeIds) return;
        activeIds.delete(requestId);
        if (activeIds.size === 0) {
            this.activeGenerationByClient.delete(ws);
        }
    }

    detachClientActiveGenerations(ws) {
        const activeIds = this.activeGenerationByClient.get(ws);
        if (!activeIds || activeIds.size === 0) return;
        for (const requestId of [...activeIds]) {
            this.stopKeepAliveInterval(requestId);
        }
        this.activeGenerationByClient.delete(ws);
    }

    stopAllKeepAliveIntervals() {
        if (!this.keepAliveIntervals || this.keepAliveIntervals.size === 0) return;
        for (const requestId of [...this.keepAliveIntervals.keys()]) {
            this.stopKeepAliveInterval(requestId);
        }
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
}

module.exports = { WebSocketMessageHandlers };
