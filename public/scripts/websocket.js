// Banner Manager for WebSocket Status and Updates
class BannerManager {
    constructor() {
        this.websocketToastId = null;
        this.init();
    }

    init() {
        // No initialization needed for glass toasts
    }

    showWebSocketToast(status, message, icon, autoHide = false, hideDelay = WebSocketClient.TIMEOUT_UI_DEFAULT) {
        // If we already have a toast, update it instead of creating a new one
        if (this.websocketToastId && typeof updateGlassToastComplete === 'function') {
            this.updateWebSocketToast(status, message, icon);
            return;
        }

        // Create new toast only if we don't have one
        if (typeof showGlassToast === 'function') {
            this.websocketToastId = showGlassToast(
                status === 'connected' ? 'success' :
                    status === 'error' ? 'error' :
                        status === 'warning' ? 'warning' : 'info',
                status === 'connected' ? 'Connected' :
                    status === 'error' ? 'Connection Error' :
                        status === 'warning' ? 'Connection Warning' : 'Connecting',
                message,
                false, // No progress bar
                autoHide ? hideDelay : false, // Only auto-hide if specified
                icon
            );
        }
    }

    updateWebSocketToast(status, message, icon) {
        if (!this.websocketToastId || typeof updateGlassToastComplete !== 'function') {
            return;
        }

        // Update the existing toast
        updateGlassToastComplete(this.websocketToastId, {
            type: status === 'connected' ? 'success' :
                status === 'error' ? 'error' :
                    status === 'warning' ? 'warning' : 'info',
            title: status === 'connected' ? 'Connected' :
                status === 'error' ? 'Connection Error' :
                    status === 'warning' ? 'Connection Warning' : 'Connecting',
            message: message,
            customIcon: icon
        });
    }

    hideWebSocketToast() {
        if (this.websocketToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.websocketToastId);
            this.websocketToastId = null;
        }
    }

    // Legacy method names for compatibility
    showWebSocketBanner(status, message, icon, autoHide = false, hideDelay = WebSocketClient.TIMEOUT_UI_DEFAULT) {
        this.showWebSocketToast(status, message, icon, autoHide, hideDelay);
    }

    hideWebSocketBanner() {
        this.hideWebSocketToast();
    }

    // Ticker methods for status display
    showWebSocketTicker(status, message, iconClass = 'fas fa-info-circle', autoHide = true, hideDelay = WebSocketClient.TIMEOUT_UI_DEFAULT) {
        const tickers = document.querySelectorAll('.websocket-ticker');
        const tickerIcons = document.querySelectorAll('.websocket-ticker-icon');
        const tickerTexts = document.querySelectorAll('.websocket-ticker-text');

        if (tickers.length === 0 || tickerIcons.length === 0 || tickerTexts.length === 0) {
            console.warn('WebSocket ticker elements not found');
            return;
        }

        // Clear any existing hide timeout
        if (this.tickerHideTimeout) {
            clearTimeout(this.tickerHideTimeout);
        }

        // Update all ticker elements
        tickers.forEach(ticker => {
            ticker.className = `websocket-ticker expanded ${status}`;
        });
        tickerIcons.forEach(icon => {
            icon.className = `fas websocket-ticker-icon ${iconClass}`;
        });
        tickerTexts.forEach(text => {
            text.textContent = message;
        });

        // Auto-hide if requested
        if (autoHide) {
            this.tickerHideTimeout = setTimeout(() => {
                this.hideWebSocketTicker();
                // After hiding connection status, check if we should show pending requests
                if (window.wsClient && window.wsClient.pendingRequestsCount > 0) {
                    setTimeout(() => window.wsClient.updateTickerDisplay(), 50);
                }
            }, hideDelay);
        }
    }

    updateWebSocketTicker(status, message, iconClass = 'fas fa-info-circle') {
        const tickers = document.querySelectorAll('.websocket-ticker');
        const tickerIcons = document.querySelectorAll('.websocket-ticker-icon');
        const tickerTexts = document.querySelectorAll('.websocket-ticker-text');

        if (tickers.length === 0 || tickerIcons.length === 0 || tickerTexts.length === 0) {
            return;
        }

        // Update all ticker elements
        tickers.forEach(ticker => {
            ticker.className = `websocket-ticker expanded ${status}`;
        });
        tickerIcons.forEach(icon => {
            icon.className = `fas websocket-ticker-icon ${iconClass}`;
        });
        tickerTexts.forEach(text => {
            text.textContent = message;
        });
    }

    hideWebSocketTicker() {
        const tickers = document.querySelectorAll('.websocket-ticker');

        if (tickers.length === 0) {
            return;
        }

        // Clear any existing hide timeout
        if (this.tickerHideTimeout) {
            clearTimeout(this.tickerHideTimeout);
            this.tickerHideTimeout = null;
        }

        // Hide all ticker elements
        tickers.forEach(ticker => {
            ticker.classList.remove('expanded');
        });
    }

    // Format request type for user-friendly display
    formatRequestType(requestType) {
        const typeMap = {
            // Core image operations
            'generate_image': 'Generate Image',
            'upscale_image': 'Upscale Image',
            'reroll_image': 'Recast Spell',
            'expand_image': 'Expand Image',
            'reroll_expanded_image': 'Recast Spell',

            // Preset operations
            'search_presets': 'Find Presets',
            'load_preset': 'Load Preset',
            'save_preset': 'Save Preset',
            'delete_preset': 'Delete Preset',
            'get_presets': 'Get Presets',
            'update_preset': 'Update Preset',
            'generate_preset': 'Generate Preset',
            'regenerate_preset_uuid': 'Regenerate Preset',

            // Dataset and tag operations
            'search_dataset_tags': 'Find Dataset Tags',
            'get_dataset_tags_for_path': 'Get Dataset Tags',
            'search_tags': 'Find Tags',
            'search_tag_wiki': 'Search Encyclopedia',
            'get_tag_wiki_page': 'Get Encyclopedia Page',
            'refresh_tag_wiki_page': 'Update Encyclopedia',
            'search_files': 'Find Images',
            'search_characters': 'Find Characters',
            'lookup_city': 'Lookup Location',
            'search_index_prepare_cache': 'Prepare Search Cache',
            'search_index_clear_cache': 'Clear Search Cache',
            'search_index_toggle_pause': 'Set Indexing State',
            'search_index_trigger': 'Request Indexing',
            'search_index_rebuild_all': 'Rebuild Search Indexes',

            // Workspace operations
            'workspace_list': 'Get Workspaces',
            'workspace_get': 'Get Workspace',
            'desktop_get_settings': 'Get Desktop Settings',
            'workspace_create': 'Create Workspace',
            'workspace_rename': 'Rename Workspace',
            'workspace_delete': 'Delete Workspace',
            'workspace_activate': 'Activate Workspace',
            'workspace_dump': 'Dump Workspace',
            'workspace_get_files': 'Get Workspace Files',
            'workspace_move_files': 'Move Files',
            'workspace_get_scraps': 'Get Scraps',
            'workspace_get_pinned': 'Get Pinned',
            'workspace_add_scrap': 'Add Scrap',
            'workspace_remove_scrap': 'Remove Scrap',
            'workspace_add_pinned': 'Add Pinned',
            'workspace_remove_pinned': 'Remove Pinned',
            'workspace_bulk_pinned': 'Bulk Pin',
            'workspace_bulk_remove_pinned': 'Bulk Remove Pinned',
            'workspace_get_groups': 'Get Groups',
            'workspace_create_group': 'Create Group',
            'workspace_get_group': 'Get Group',
            'workspace_rename_group': 'Rename Group',
            'workspace_add_images_to_group': 'Add to Group',
            'workspace_remove_images_from_group': 'Remove from Group',
            'workspace_delete_group': 'Delete Group',
            'workspace_get_image_groups': 'Get Image Groups',
            'workspace_update_color': 'Update Color',
            'workspace_update_background_color': 'Update Background',
            'workspace_update_background_image': 'Update Background Image',
            'workspace_update_background_opacity': 'Update Background Opacity',
            'workspace_update_settings': 'Upload Settings',
            'workspace_update_window_positions': 'Upload Settings',
            'workspace_update_primary_font': 'Update Font',
            'workspace_update_textarea_font': 'Update Text Font',
            'workspace_reorder': 'Reorder Workspaces',
            'workspace_bulk_add_scrap': 'Bulk Add Scraps',
            'workspace_bulk_add_pinned': 'Bulk Add Pinned',

            // Desktop shortcuts
            'desktop_get_shortcuts': 'Get Desktop Shortcuts',
            'desktop_add_shortcut': 'Add Desktop Shortcut',
            'desktop_update_shortcut': 'Update Desktop Shortcut',
            'desktop_remove_shortcut': 'Remove Desktop Shortcut',
            'desktop_update_positions': 'Update Desktop Positions',

            'get_text_replacement_options': 'Resolve Placeholder',
            'resolve_dynamic_context': 'Resolve Context',

            // Bulk operations
            'delete_images_bulk': 'Delete Images',
            'send_to_sequenzia_bulk': 'Send to Sequenzia',
            'update_image_preset_bulk': 'Update Image Presets',

            // Reference operations
            'get_references': 'Get References',
            'get_references_by_ids': 'Get References',
            'get_workspace_references': 'Get Workspace References',
            'delete_reference': 'Delete Reference',
            'upload_reference': 'Upload Reference',
            'upload_wallpaper': 'Upload Wallpaper',
            'replace_reference': 'Replace Reference',
            'update_reference_metadata': 'Update Reference',
            'upload_workspace_image': 'Upload Image',
            'download_url_file': 'Download File',
            'fetch_url_info': 'Fetch URL Info',
            'move_references': 'Move References',

            // Vibe operations
            'get_vibe_image': 'Get Vibe Image',
            'delete_vibe_image': 'Delete Vibe Image',
            'delete_vibe_encodings': 'Delete Encodings',
            'bulk_delete_vibe_images': 'Bulk Delete Vibe Images',
            'move_vibe_image': 'Move Vibe Image',
            'bulk_move_vibe_images': 'Bulk Move Vibe Images',
            'encode_vibe': 'Encode Vibe',
            'import_vibe_bundle': 'Import Vibe Bundle',
            'check_vibe_encoding': 'Check Vibe Encoding',

            // Cache and system operations
            'get_cache_manifest': 'Get Cache Manifest',
            'refresh_server_cache': 'Refresh Cache',
            'rebuild_metadata_cache': 'Rebuild Metadata Cache',
            'clear_search_cache': 'Clear Search Cache',
            'broadcast_resource_update': 'Update Resources',
            'ping': 'Ping Server',

            // App and settings operations
            'get_app_options': 'Get Settings',
            'get_rate_limiting_stats': 'Get Rate Stats',
            'get_session_rate_limiting_stats': 'Get Session Stats',
            'cancel_pending_requests': 'Cancel Requests',
            'cancel_session_pending_requests': 'Cancel Session Requests',
            'get_system_info': 'Get System Info',

            // Favorites operations
            'favorites_add': 'Add Favorite',
            'favorites_remove': 'Remove Favorite',
            'favorites_get': 'Get Favorites',

            // Genso operations
            'get_text_replacements': 'Get Genso Expanders',
            'save_text_replacements': 'Save Genso Expanders',
            'delete_text_replacement': 'Delete Genso Expander',
            'create_text_replacement': 'Create Genso Expander',

            // Knowledge memory operations
            'list_knowledge_memories': 'Get Memories',
            'get_knowledge_memory': 'Get Memory',
            'update_knowledge_memory': 'Update Memory',
            'delete_knowledge_memory': 'Delete Memory',
            'delete_knowledge_memories_bulk': 'Delete Memories',
            'count_knowledge_memories_by_filter': 'Count Memories',
            'delete_knowledge_memories_by_filter': 'Delete Memories',

            // Preset group operations
            'save_preset_group': 'Save Preset',
            'delete_preset_group': 'Delete Preset',
            'get_preset_groups': 'Get Presets',

            // Notes operations
            'notes_create': 'Save Notebook Page',
            'notes_get': 'Load Notebook Page',
            'notes_get_by_workspace': 'Get Notebook',
            'notes_get_all': 'Get Notebook Pages',
            'notes_get_all_metadata': 'Get Notes Info',
            'notes_update': 'Save Notebook Page',
            'notes_delete': 'Delete Notebook Page',
            'notes_save_content': 'Save Notebook Page',

            // Gallery operations
            'request_gallery': 'Get Gallery',
            'request_image_metadata': 'Get Image Metadata',
            'request_url_upload_metadata': 'Get Upload Metadata',
            'request_image_by_index': 'Get Image',
            'find_image_index': 'Find Image',

            // Persona operations
            'get_persona_settings': 'Get Persona Settings',
            'save_persona_settings': 'Save Persona Settings',

            // Chat operations
            'create_chat_session': 'Create Chat Session',
            'get_chat_sessions': 'Get Chat Sessions',
            'get_chat_session': 'Get Chat Session',
            'delete_chat_session': 'Delete Chat Session',
            'restart_chat_session': 'Restart Chat Session',
            'send_chat_message': 'Send Chat Message',
            'update_chat_context': 'Update Chat Context',
            'get_chat_messages': 'Get Chat Messages',
            'delete_chat_message': 'Delete Chat Message',

            // AI operations
            'cancel_generation': 'Cancel Generation',
            'dynamic_generation_progress': 'Enshutsuka Progress',
            'dynamic_generation_progress_update': 'Enshutsuka Progress Update',
            'dynamic_generation_completed': 'Enshutsuka Completed',
            'dynamic_generation_failed': 'Enshutsuka Failed',



            // Director operations
            'director_get_sessions': 'Get Director Sessions',
            'director_create_session': 'Create Director Session',
            'director_get_session': 'Get Director Session',
            'director_delete_session': 'Delete Director Session',
            'director_send_message': 'Send Director Message',
            'director_get_messages': 'Get Director Messages',
            'director_rollback_message': 'Rollback Message',
            'director_save_feedback': 'Save Feedback',
            'director_load_rules': 'Load Rules',
            'director_save_rules': 'Save Rules',
            'director_load_feedback': 'Load Feedback',
            'director_delete_feedback': 'Delete Feedback',

            // Security operations
            'get_blocked_ips': 'Get Blocked IPs',
            'unblock_ip': 'Unblock IP',
            'export_ip_to_gateway': 'Export IP',
            'get_ip_blocking_reasons': 'Get Block Reasons',
            'get_api_key_services': 'Get Keychain',
            'update_api_key_selections': 'Update Keychain',
            'add_api_key': 'Add to Keychain',
            'delete_api_key': 'Delete from Keychain',

            // Utility operations
            'spellcheck_add_word': 'Add Word'
        };

        return typeMap[requestType] || requestType;
    }

    updateWebSocketBanner(status, message, icon) {
        this.updateWebSocketToast(status, message, icon);
    }
}

/**
 * WebSocket Client with Auto-Reconnection and Glass Toast notifications
 *
 * Features:
 * - Automatic reconnection with exponential backoff
 * - Request/response correlation with unique IDs
 * - Circuit breaker pattern to prevent infinite retries
 * - Connection health monitoring
 * - Comprehensive error handling and logging
 * - Progress tracking for initialization steps
 */
class WebSocketClient {
    // Constants for timeouts, delays, and limits
    static TIMEOUT_UI_DEFAULT = 3000; // Default UI timeout (3 seconds)
    static TIMEOUT_PING = 5000; // Ping timeout (5 seconds)
    static TIMEOUT_CONNECTION_STABILITY = 2000; // Connection stability check timeout
    static TIMEOUT_HOST_AVAILABILITY = 3000; // Host availability check timeout
    static TIMEOUT_VERSION_CHECK = 2000; // Version compatibility check timeout
    static TIMEOUT_GET_APP_OPTIONS = 3000; // Critical app options timeout (3 seconds)

    static DELAY_RECONNECT_INITIAL = 1000; // Initial reconnect delay (1 second)
    static DELAY_RECONNECT_MAX = 30000; // Maximum reconnect delay (30 seconds)
    static DELAY_CONNECTION_COOLDOWN = 60000; // Circuit breaker cooldown (1 minute)
    static DELAY_PING_INTERVAL = 30000; // Ping interval (30 seconds)
    static DELAY_PING_HOST = 2000; // Host ping interval (2 seconds)
    static DELAY_HEALTH_MONITORING = 5000; // Health monitoring start delay (5 seconds)

    static ATTEMPTS_MAX_RECONNECT = 5; // Maximum reconnect attempts
    static ATTEMPTS_MAX_PING = 3; // Maximum ping attempts

    static PROGRESS_INIT_BASE = 25; // Base progress percentage for initialization
    static PROGRESS_INIT_STEPS = 75; // Progress percentage allocated to init steps

    /**
     * Creates a new WebSocket client instance
     *
     * Initializes all connection management, request tracking, and UI notification systems.
     * The client will automatically attempt to connect on initialization and handle
     * reconnections transparently.
     */
    constructor() {
        // Client version for compatibility checking
        this.clientVersion = '1.0.1'; // Update this when making breaking changes to client

        this.ws = null;
        this.reconnectAttempts = 0;
        this.maxReconnectAttempts = WebSocketClient.ATTEMPTS_MAX_RECONNECT;
        this.reconnectDelay = WebSocketClient.DELAY_RECONNECT_INITIAL;
        this.maxReconnectDelay = WebSocketClient.DELAY_RECONNECT_MAX;
        this.isConnecting = false;
        this.isManualClose = false;
        this.circuitBreaker = false; // New: circuit breaker to prevent infinite retries
        this.lastConnectionAttempt = 0;
        this.connectionCooldown = WebSocketClient.DELAY_CONNECTION_COOLDOWN;
        this.connectionLock = false; // Prevent concurrent connection attempts
        this.pingInterval = null;
        this.pingTimeout = null;
        this.healthCheckInterval = null;
        this.progressToastId = null;
        this.serverNotRespondingToastId = null;
        this.messageHandlers = new Map();

        this.initSteps = [];
        this.currentInitStep = 0;
        this.totalInitSteps = 0;
        this.initializationCompleted = false; // Track if initialization has been completed
        this.initializationLock = false; // Prevent concurrent initialization
        this.stepByStepMode = false; // Step-by-step mode (Shift key on startup)
        this.stepByStepPaused = false; // Whether we're waiting for user to advance step

        // Pending requests tracking
        this.pendingRequestsCount = 0;
        this.completionTimer = null;

        // WebSocket indicator elements (dynamically populated array)
        this.websocketIndicators = [];

        // Banner manager for status updates
        this.bannerManager = new BannerManager();

        // Bind methods
        this.connect = this.connect.bind(this);
        this.disconnect = this.disconnect.bind(this);
        this.reconnect = this.reconnect.bind(this);
        this.clearTimeoutSafely = this.clearTimeoutSafely.bind(this);
        this.logError = this.logError.bind(this);
        this.logWarning = this.logWarning.bind(this);
        this.logInfo = this.logInfo.bind(this);
        this.initWebSocketIndicators = this.initWebSocketIndicators.bind(this);
        this.refreshWebSocketIndicators = this.refreshWebSocketIndicators.bind(this);
        this.updateWebSocketStatus = this.updateWebSocketStatus.bind(this);
        this.flashWebSocketArrow = this.flashWebSocketArrow.bind(this);
        this.send = this.send.bind(this);

        // Initialize
        this.init();
    }

    // Helper method to safely clear timeouts
    clearTimeoutSafely(timeoutId) {
        if (timeoutId) {
            clearTimeout(timeoutId);
            return null; // Return null to allow assignment
        }
        return timeoutId;
    }

    // Helper method for standardized error logging
    logError(context, error, additionalData = {}) {
        const errorInfo = {
            context,
            message: error?.message || error,
            type: error?.constructor?.name || 'UnknownError',
            timestamp: Date.now(),
            ...additionalData
        };

        console.error(`❌ ${context}:`, errorInfo);

        // Return the error info for further processing if needed
        return errorInfo;
    }

    // Helper method for standardized warning logging
    logWarning(context, message, additionalData = {}) {
        const warningInfo = {
            context,
            message,
            timestamp: Date.now(),
            ...additionalData
        };

        console.warn(`⚠️ ${context}:`, warningInfo);

        // Return the warning info for further processing if needed
        return warningInfo;
    }

    // Helper method for standardized info logging
    logInfo(context, message, additionalData = {}) {
        const infoData = {
            context,
            message,
            timestamp: Date.now(),
            ...additionalData
        };

        console.log(`ℹ️ ${context}:`, infoData);

        return infoData;
    }

    // Ping host over HTTP before attempting WebSocket connection
    async pingHost() {
        const maxPingAttempts = WebSocketClient.ATTEMPTS_MAX_PING;
        const pingInterval = WebSocketClient.DELAY_PING_HOST;

        for (let attempt = 1; attempt <= maxPingAttempts; attempt++) {
            try {
                this.updateProgressNotification(`Dialing Server... (${attempt}/${maxPingAttempts})`, 5 + (attempt * 5));

                // Try to fetch a simple endpoint to ping the host
                const response = await fetch('/', {
                    method: 'HEAD',
                    cache: 'no-cache',
                    signal: AbortSignal.timeout(WebSocketClient.TIMEOUT_HOST_AVAILABILITY)
                });

                if (response.ok) {
                    // Server is responding, now check if it's ready
                    try {
                        const statusResponse = await fetch('/status', {
                            method: 'OPTIONS',
                            cache: 'no-cache',
                            signal: AbortSignal.timeout(WebSocketClient.TIMEOUT_VERSION_CHECK)
                        });

                        if (statusResponse.ok) {
                            const data = await statusResponse.json();

                            if (data.isReady) {
                                // Server is ready, now check version compatibility
                                try {
                                    const appOptionsResponse = await fetch('/app', {
                                        method: 'OPTIONS',
                                        cache: 'no-cache',
                                        signal: AbortSignal.timeout(WebSocketClient.TIMEOUT_VERSION_CHECK)
                                    });

                                    if (appOptionsResponse.ok) {
                                        const appData = await appOptionsResponse.json();

                                        // Check version compatibility
                                        if (appData.serverVersion && appData.serverVersion !== this.clientVersion) {
                                            console.warn(`⚠️ Version mismatch detected! Client: ${this.clientVersion}, Server: ${appData.serverVersion}`);

                                            // Trigger service worker update check
                                            if (window.serviceWorkerManager) {
                                                console.log('🔄 Triggering service worker update check due to version mismatch...');
                                                await window.serviceWorkerManager.checkStaticFileUpdates(true);
                                            }

                                            // Show version mismatch warning
                                            if (typeof showGlassToast === 'function') {
                                                showGlassToast('warning', 'Version Mismatch',
                                                    appData.versionMessage || 'A new version is available. Some features may not work correctly.',
                                                    false, 10000, '<i class="fas fa-exclamation-triangle"></i>');
                                            }

                                            // Continue connection but warn user
                                            return true;
                                        }
                                    }
                                } catch (versionError) {
                                    console.warn('⚠️ Could not check server version:', versionError.message);
                                    // Continue anyway - don't fail the connection for version check issues
                                }

                                return true;
                            } else {
                                // Server is initializing, show current stage
                                this.updateProgressNotification(`${data.stageMessage}...`, 5 + (attempt * 5));

                                if (attempt < maxPingAttempts) {
                                    // Wait before next attempt
                                    await new Promise(resolve => setTimeout(resolve, pingInterval));
                                }
                            }
                        } else {
                            // Status endpoint not available, but server is responding
                            return true;
                        }
                    } catch (statusError) {
                        // Status endpoint failed, but server is responding to HEAD
                        return true;
                    }
                }
            } catch (error) {
                console.warn(`⚠️ Ping attempt ${attempt} failed:`, error.message);

                if (attempt < maxPingAttempts) {
                    // Wait before next attempt
                    await new Promise(resolve => setTimeout(resolve, pingInterval));
                }
            }
        }

        // If all ping attempts failed, throw an error
        throw new Error(`Server not responding after ${maxPingAttempts} attempts. Server may be down or unreachable.`);
    }

    // Progress notification methods
    showProgressNotification(message = 'Connecting...', progress = 0) {
        if (window.isDesktop) {
            // Desktop mode: use Windows startup modal
            this.showWindowsStartupModal(message, progress);
        } else {
            // Non-desktop: use toast
            if (!this.progressToastId) {
                // Create a new progress toast
                if (typeof showGlassToast === 'function') {
                    this.progressToastId = showGlassToast(
                        'info',
                        'Dreamscape',
                        message,
                        true, // showProgress
                        false, // no timeout - keep until manually hidden
                        '<i class="fa-duotone fa-star-christmas"></i>'
                    );
                }
            }
            document.body.classList.add('initializing');
            this.updateProgressNotification(message, progress);
        }
    }

    hideProgressNotification() {
        if (window.isDesktop) {
            this.hideWindowsStartupModal();
        } else {
            if (this.progressToastId && typeof removeGlassToast === 'function') {
                removeGlassToast(this.progressToastId);
                this.progressToastId = null;
            }
        }
        document.body.classList.remove('initializing');
    }

    updateProgressNotification(message, progress) {
        if (window.isDesktop) {
            this.updateWindowsStartupModal(message, progress);
        } else {
            if (!this.progressToastId) return;

            // Update toast message if updateGlassToastComplete is available
            if (typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.progressToastId, {
                    type: 'info',
                    title: 'Dreamscape',
                    message: message,
                    customIcon: '<i class="fa-duotone fa-star-christmas"></i>'
                });
            }

            // Update progress bar
            if (typeof updateGlassToastProgress === 'function') {
                updateGlassToastProgress(this.progressToastId, progress);
            }
        }
    }

    // Windows Startup Modal Methods (Desktop Mode Only)
    showWindowsStartupModal(message = 'Initializing...', progress = 0) {
        if (!window.isDesktop) return;
        
        const modal = document.getElementById('windowsStartupModal');
        const statusElement = document.getElementById('windowsStartupStatus');
        const progressBar = document.getElementById('windowsStartupProgressBar');
        const advanceBtn = document.getElementById('windowsStartupAdvanceStepBtn');
        
        if (!modal || !statusElement || !progressBar) return;
        
        // Apply Windows Classic theme initially
        if (!document.body.classList.contains('windows-classic-theme')) {
            document.body.classList.add('windows-classic-theme');
        }
        
        openModal(modal);
        
        // Explicitly set startup modal as active (openModal doesn't do this for new modals)
        // Keep it active until gallery window opens
        if (typeof setActiveWindow === 'function') {
            setActiveWindow(modal.id);
        } else {
            modal.classList.add('active-window');
        }
        
        statusElement.textContent = message;
        progressBar.style.width = `${progress}%`;
        
        // Setup advance step button handler if not already set up
        if (advanceBtn && !this.advanceStepHandlerSetup) {
            advanceBtn.addEventListener('click', () => {
                this.advanceStep();
            });
            this.advanceStepHandlerSetup = true;
        }
        
        // Update button visibility
        this.updateStepByStepButton();
    }

    updateWindowsStartupModal(message, progress) {
        if (!window.isDesktop) return;
        
        const statusElement = document.getElementById('windowsStartupStatus');
        const progressBar = document.getElementById('windowsStartupProgressBar');
        
        if (statusElement) {
            statusElement.textContent = message;
        }
        if (progressBar) {
            progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        }
        
        // Update button visibility when progress updates
        this.updateStepByStepButton();
    }

    hideWindowsStartupModal() {
        if (!window.isDesktop) return;
        
        const modal = document.getElementById('windowsStartupModal');
        if (modal) {
            // Use normal modal closing process
            if (typeof closeModal === 'function') {
                closeModal(modal);
            } else {
                modal.classList.add('hidden');
            }
        }
        
        // Remove startup background
        document.body.classList.remove('windows-startup');
        // Keep windows-classic-theme until workspace theme is loaded (handled in workspace loading step)
    }

    // Windows Update Modal Methods (Desktop Mode Only)
    showWindowsUpdateModal(message = 'Preparing to install updates...', progress = 0) {
        if (!window.isDesktop) return;
        
        const modal = document.getElementById('windowsUpdateModal');
        const statusElement = document.getElementById('windowsUpdateStatus');
        const progressBar = document.getElementById('windowsUpdateProgressBar');
        const skipBtn = document.getElementById('windowsUpdateSkipBtn');
        const restartActions = document.getElementById('windowsUpdateRestartActions');
        const progressContainer = modal?.querySelector('.windows-update-progress-container');
        
        if (!modal || !statusElement || !progressBar) return;
        
        // Show progress container, hide restart actions
        if (progressContainer) progressContainer.classList.remove('hidden');
        if (restartActions) restartActions.classList.add('hidden');
        if (skipBtn) skipBtn.style.display = '';
        
        // Use normal modal opening process
        if (typeof openModal === 'function') {
            openModal(modal);
        } else {
            modal.classList.remove('hidden');
        }
        
        statusElement.textContent = message;
        progressBar.style.width = `${progress}%`;
        
        // Setup button handlers if not already set up
        this.setupUpdateModalHandlers();
    }
    
    setupUpdateModalHandlers() {
        if (this.updateModalHandlersSetup) return;
        this.updateModalHandlersSetup = true;
        
        const skipBtn = document.getElementById('windowsUpdateSkipBtn');
        const restartBtn = document.getElementById('windowsUpdateRestartBtn');
        const laterBtn = document.getElementById('windowsUpdateLaterBtn');
        
        if (skipBtn) {
            skipBtn.addEventListener('click', () => {
                if (this.onUpdateSkip) {
                    this.onUpdateSkip();
                }
            });
        }
        
        if (restartBtn) {
            restartBtn.addEventListener('click', () => {
                if (this.onUpdateRestart) {
                    this.onUpdateRestart();
                }
            });
        }
        
        if (laterBtn) {
            laterBtn.addEventListener('click', () => {
                if (this.onUpdateLater) {
                    this.onUpdateLater();
                }
            });
        }
    }
    
    setUpdateModalCallbacks(onSkip, onRestart, onLater) {
        this.onUpdateSkip = onSkip;
        this.onUpdateRestart = onRestart;
        this.onUpdateLater = onLater;
    }

    updateWindowsUpdateModal(message, progress) {
        if (!window.isDesktop) return;
        
        const statusElement = document.getElementById('windowsUpdateStatus');
        const progressBar = document.getElementById('windowsUpdateProgressBar');
        
        if (statusElement) {
            statusElement.textContent = message;
        }
        if (progressBar) {
            progressBar.style.width = `${Math.min(100, Math.max(0, progress))}%`;
        }
    }

    showWindowsUpdateRestartPrompt(message = 'Updates have been installed. Restart is required.') {
        if (!window.isDesktop) return;
        
        const modal = document.getElementById('windowsUpdateModal');
        const statusElement = document.getElementById('windowsUpdateStatus');
        const progressBar = document.getElementById('windowsUpdateProgressBar');
        const skipBtn = document.getElementById('windowsUpdateSkipBtn');
        const restartActions = document.getElementById('windowsUpdateRestartActions');
        const progressContainer = modal?.querySelector('.windows-update-progress-container');
        
        if (!modal || !statusElement || !restartActions) return;
        
        // Hide progress container, show restart actions
        if (progressContainer) progressContainer.classList.add('hidden');
        if (restartActions) restartActions.classList.remove('hidden');
        if (skipBtn) skipBtn.style.display = 'none';
        if (progressBar) progressBar.style.width = '100%';
        
        statusElement.textContent = message;
    }

    hideWindowsUpdateModal() {
        if (!window.isDesktop) return;
        
        const modal = document.getElementById('windowsUpdateModal');
        if (modal) {
            // Use normal modal closing process
            if (typeof closeModal === 'function') {
                closeModal(modal);
            } else {
                modal.classList.add('hidden');
            }
        }
    }

    registerInitStep(priority, message, stepFunction, runOnReconnect = false) {
        // Check if step with same message already exists
        const existingStepIndex = this.initSteps.findIndex(step => step.message === message);
        if (existingStepIndex !== -1) {
            this.initSteps[existingStepIndex] = { priority, message, stepFunction, runOnReconnect };
        } else {
            this.initSteps.push({ priority, message, stepFunction, runOnReconnect });
        }

        // Sort by priority
        this.initSteps.sort((a, b) => a.priority - b.priority);
        this.totalInitSteps = this.initSteps.length;
    }

    // Method to remove a specific initialization step
    removeInitStep(message) {
        const index = this.initSteps.findIndex(step => step.message === message);
        if (index !== -1) {
            this.initSteps.splice(index, 1);
            this.totalInitSteps = this.initSteps.length;
            return true;
        }
        return false;
    }

    // Method to clear all initialization steps
    clearInitSteps() {
        this.initSteps = [];
        this.totalInitSteps = 0;
        this.initializationCompleted = false;
    }

    // Method to clear pending requests by type
    clearPendingRequestsByType(requestType) {
        if (!this.pendingRequests) return 0;

        let clearedCount = 0;
        const requestsToClear = [];

        // First pass: collect requests to clear (avoid mutation during iteration)
        for (const [requestId, request] of this.pendingRequests) {
            if (request.type === requestType) {
                requestsToClear.push({ requestId, request });
            }
        }

        // Second pass: clear the collected requests
        for (const { requestId, request } of requestsToClear) {
            // Clear timeout safely
            request.timeoutId = this.clearTimeoutSafely(request.timeoutId);
            this.pendingRequests.delete(requestId);
            clearedCount++;
            this.decrementPendingRequests();
        }

        if (clearedCount > 0) {
            console.log(`🧹 Cleared ${clearedCount} pending ${requestType} requests`);
        }

        return clearedCount;
    }

    // Method to get pending requests by type
    getPendingRequestsByType(requestType) {
        if (!this.pendingRequests) return 0;

        let count = 0;
        for (const [requestId, request] of this.pendingRequests) {
            if (request.type === requestType) {
                count++;
            }
        }
        return count;
    }

    // Method to get current WebSocket client status
    getStatus() {
        return {
            connectionState: this.getConnectionState(),
            isConnected: this.isConnected(),
            isConnecting: this.isConnecting,
            reconnectAttempts: this.reconnectAttempts,
            maxReconnectAttempts: this.maxReconnectAttempts,
            initializationCompleted: this.initializationCompleted,
            totalInitSteps: this.totalInitSteps,
            currentInitStep: this.currentInitStep,
            pendingRequestsCount: this.pendingRequestsCount,
            pendingPingRequests: this.getPendingRequestsByType('ping'),
            isManualClose: this.isManualClose,
            circuitBreaker: this.circuitBreaker,
            lastConnectionAttempt: this.lastConnectionAttempt,
            connectionCooldown: this.connectionCooldown
        };
    }

    // Method to manually trigger initialization (useful for testing or manual refresh)
    async manualInit() {
        if (this.initializationCompleted) {
            this.initializationCompleted = false;
        }
        return this.executeInitSteps();
    }

    // Get cache manifest from server
    async getCacheManifest() {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        // Use the existing sendMessage pattern that the client already uses
        return this.sendMessage('get_cache_manifest', {}, false); // Background operation
    }

    async executeInitSteps() {
        // Prevent duplicate initialization on reconnection
        if (this.initializationCompleted) {
            this.hideProgressNotification();
            this.initializationLock = false; // Ensure lock is released even for early return
            return;
        }

        // Prevent concurrent initialization
        if (this.initializationLock) {
            console.log('🔒 Initialization already in progress, skipping duplicate call');
            return;
        }

        this.initializationLock = true;

        // Safety check for empty init steps
        if (!this.initSteps || this.initSteps.length === 0) {
            this.initializationCompleted = true;
            this.initializationLock = false; // Release initialization lock
            this.hideProgressNotification();
            return;
        }

        this.currentInitStep = 0;
        this.totalInitSteps = this.initSteps.length;

        try {
            for (const step of this.initSteps) {
                this.currentInitStep++;
                // Calculate progress: base percentage + steps percentage
                const stepProgress = WebSocketClient.PROGRESS_INIT_BASE +
                    ((this.currentInitStep / this.totalInitSteps) * WebSocketClient.PROGRESS_INIT_STEPS);
                this.updateProgressNotification(step.message, stepProgress);

                // On reconnection, only run steps flagged as runOnReconnect
                if (this.initializationCompleted && !step.runOnReconnect) {
                    continue;
                }

                // Step-by-step mode: wait for user to advance
                if (this.stepByStepMode && window.isDesktop) {
                    this.stepByStepPaused = true;
                    this.updateStepByStepButton();
                    // Wait for user to click the advance button
                    await new Promise((resolve) => {
                        this.stepByStepResolve = resolve;
                    });
                    this.stepByStepPaused = false;
                    this.updateStepByStepButton();
                }

                try {
                    await step.stepFunction();   // run the step
                } catch (error) {
                    console.error(`❌ Error in init step "${step.message}":`, error);
                }
            }

            // Mark initialization as completed
            this.initializationCompleted = true;
            this.initializationLock = false; // Release initialization lock

            // Hide overlay after all steps complete
            setTimeout(() => {
                this.hideProgressNotification();
            }, 500);
        } catch (error) {
            console.error('❌ Error during initialization:', error);
            this.updateProgressNotification('Initialization failed', 100);
            this.initializationLock = false; // Release initialization lock on error
            setTimeout(() => {
                this.hideProgressNotification();
            }, 2000);
        }
    }

    // Advance to next step in step-by-step mode
    advanceStep() {
        if (this.stepByStepMode && this.stepByStepPaused && this.stepByStepResolve) {
            this.stepByStepResolve();
            this.stepByStepResolve = null;
            this.updateStepByStepButton();
        }
    }

    // Update step-by-step button visibility
    updateStepByStepButton() {
        if (!window.isDesktop) return;
        
        const button = document.getElementById('windowsStartupAdvanceStepBtn');
        if (button) {
            if (this.stepByStepMode && this.stepByStepPaused) {
                button.classList.remove('hidden');
            } else {
                button.classList.add('hidden');
            }
        }
    }

    // Initialize the websocket client with proper sequence
    async init() {
        // Check for Shift key to enable step-by-step mode (desktop mode only)
        if (window.isDesktop && window.shiftKeyOnStartup) {
            this.stepByStepMode = true;
            console.log('🔍 Step-by-step mode enabled (Shift key detected on startup)');
        }
        
        // Show progress notification immediately
        this.showProgressNotification('Initializing...', 0);

        // Initialize pending requests spinner
        this.updatePendingRequestsSpinner();

        // Initialize WebSocket indicators after DOM is ready
        if (document.readyState === 'loading') {
            document.addEventListener('DOMContentLoaded', this.connect);
        } else {
            this.connect();
        }

        // Handle page visibility changes
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible' && !this.ws) {
                this.connect();
            }
        });

        // Handle beforeunload
        window.addEventListener('beforeunload', () => {
            this.isManualClose = true;
            this.disconnect();
        });

        // Handle page focus events
        window.addEventListener('focus', () => {
            if (!this.isConnected() && !this.isConnecting) {
                this.connect();
            }
        });

        // Listen for service worker network activity events
        navigator.serviceWorker.addEventListener('message', (event) => {
            this.handleServiceWorkerMessage(event);
        });
    }

    /**
     * Establishes a WebSocket connection to the server
     *
     * Performs pre-connection health checks, then creates a WebSocket connection
     * with automatic event handler setup. Uses connection locking to prevent
     * concurrent connection attempts.
     *
     * @returns {Promise<void>} Resolves when connection is established or rejects on failure
     * @throws {Error} If connection cannot be established after retries
     */
    async connect() {
        this.initWebSocketIndicators();
        
        // Dismiss the server not responding toast when attempting to connect
        if (this.serverNotRespondingToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.serverNotRespondingToastId);
            this.serverNotRespondingToastId = null;
        }

        // Use connection lock to prevent concurrent connection attempts
        if (this.connectionLock) {
            console.log('🔒 Connection already in progress, skipping duplicate attempt');
            return;
        }

        if (this.isConnecting || this.ws?.readyState === WebSocket.OPEN) {
            return;
        }

        this.connectionLock = true;
        this.isConnecting = true;
        this.updateProgressNotification('Dialing Server...', 0);

        // Show connecting ticker (don't auto-hide until connected)
        this.bannerManager.showWebSocketTicker('connecting', 'Dialing Server...', 'fa-phone-arrow-up-right', false);
        this.updateWebSocketStatus('connecting');

        try {
            // Step 1: First ping the host over HTTP to ensure it's responsive
            try {
                await this.pingHost();
                this.updateProgressNotification('Initializing components...', 15);
            } catch (pingError) {
                console.error('❌ Host availability check failed:', pingError.message);
                this.isConnecting = false;
                this.connectionLock = false; // Release connection lock on ping failure

                // If we're already in circuit breaker mode, don't retry immediately
                if (this.circuitBreaker) {
                    this.bannerManager.showWebSocketTicker('error', pingError.message, 'fa-exclamation-triangle', false);
                    return;
                }

                // Show persistent toast with Connect button instead of just banner ticker
                this.bannerManager.showWebSocketTicker('error', 'Server Not Responding', 'fa-phone-missed', false);
                if (typeof showGlassToast === 'function') {
                    this.serverNotRespondingToastId = showGlassToast(
                        'error',
                        'Disconnected',
                        'Unable to reach the server.',
                        false, // no progress bar
                        false, // no auto-hide
                        '<i class="fas fa-fade fa-phone-missed"></i>',
                        [
                            {
                                text: 'Connect',
                                onClick: () => {
                                    // Dismiss the toast and attempt reconnection
                                    if (this.serverNotRespondingToastId) {
                                        removeGlassToast(this.serverNotRespondingToastId);
                                        this.serverNotRespondingToastId = null;
                                    }
                                    this.manualReconnect();
                                }
                            }
                        ]
                    );
                }

                // Retry connection after a delay (only if toast wasn't shown)
                if (!this.serverNotRespondingToastId) {
                    setTimeout(() => {
                        this.reconnect();
                    }, 3000);
                }
                this.connectionLock = false; // Release lock before returning
                return;
            }

            // Step 3: Now attempt WebSocket connection
            this.updateProgressNotification('Establishing Session...', 25);

            // Determine WebSocket URL
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = () => {
                this.isConnecting = false;
                this.connectionLock = false; // Release connection lock on success
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                this.circuitBreaker = false; // Reset circuit breaker on successful connection

                // Show connected ticker and auto-hide after 3 seconds
                this.bannerManager.showWebSocketTicker('connected', 'Connected to Server', 'fa-phone', true, 3000);
                this.updateWebSocketStatus('connected');

                // Trigger connection event
                this.triggerEvent('connected');

                // Complete any remaining initialization steps
                if (!this.initializationCompleted) {
                    this.executeInitSteps();
                } else {
                    this.hideProgressNotification();
                    // ON CONNECT CHECK IN WITH SERVICE WORKER TO SEE IF IT HAS UPDATES
                }

                // Sync current workspace with server (only on reconnection, not initial connection)
                if (this.reconnectAttempts > 0 && window.currentWorkspace) {
                    try {
                        // Use setActiveWorkspace to ensure server has the correct workspace
                        this.setActiveWorkspace(window.currentWorkspace).catch(error => {
                            console.warn('⚠️ Failed to sync workspace on reconnect:', error.message);
                        });
                    } catch (error) {
                        console.warn('⚠️ Error syncing workspace on reconnect:', error.message);
                    }
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    // Flash down arrow to indicate inbound traffic
                    this.flashWebSocketArrow('down');
                    this.handleMessage(message);
                } catch (error) {
                    console.error('❌ Failed to parse WebSocket message:', error);
                }
            };

            this.ws.onclose = (event) => {
                console.log('🔌 WebSocket disconnected:', event.code, event.reason);
                this.isConnecting = false;

                // Reset generation button state if generation was interrupted
                if (typeof updateManualGenerateBtnState === 'function') {
                    updateManualGenerateBtnState();
                }

                // Update WebSocket status indicator
                this.updateWebSocketStatus('disconnected');

                // Clear any pending indicator timeouts
                this.clearWebSocketIndicatorTimeouts();

                // Handle authentication failure
                if (event.code === 1008 && event.reason === 'Authentication required') {
                    console.error('❌ WebSocket authentication failed');
                    this.handleAuthError({
                        type: 'auth_error',
                        message: 'Authentication required',
                        code: 'AUTH_REQUIRED'
                    });
                    return;
                }

                if (!this.isManualClose) {
                    // Clear and fail all pending requests when connection is lost
                    this.clearPendingRequests();

                    let disconnectMessage = 'Connection lost';

                    // Provide specific messaging based on close code
                    switch (event.code) {
                        case 1000:
                            disconnectMessage = 'Connection closed normally';
                            break;
                        case 1001:
                            disconnectMessage = 'Server is shutting down';
                            break;
                        case 1006:
                            disconnectMessage = 'Connection lost unexpectedly';
                            break;
                        case 1008:
                            disconnectMessage = 'Connection rejected by server';
                            break;
                        case 1011:
                            disconnectMessage = 'Server encountered an error';
                            break;
                        default:
                            if (event.code >= 1000 && event.code < 2000) {
                                disconnectMessage = `Connection closed (code: ${event.code})`;
                            }
                    }

                    if (event.reason) {
                        disconnectMessage += `: ${event.reason}`;
                    }

                    // Only show reconnecting message if we're not in circuit breaker mode
                    if (!this.circuitBreaker) {
                        disconnectMessage += '. Reconnecting...';
                        this.bannerManager.showWebSocketTicker('warning', disconnectMessage, 'fa-sync-alt', false);
                        this.reconnect();
                    } else {
                        disconnectMessage += '. Server may be unavailable.';
                        this.bannerManager.showWebSocketTicker('error', disconnectMessage, 'fa-exclamation-triangle', false);
                    }
                }

                // Trigger disconnect event
                this.triggerEvent('disconnected', event);
            };

            this.ws.onerror = (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnecting = false;
                this.connectionLock = false; // Release connection lock on error

                // Reset generation button state if generation was interrupted
                if (typeof updateManualGenerateBtnState === 'function') {
                    updateManualGenerateBtnState();
                }

                if (!this.isManualClose) {
                    let errorMessage = '';
                    let shouldRetry = true;

                    // Categorize the error for better user messaging
                    if (error.target && error.target.readyState === WebSocket.CLOSED) {
                        errorMessage = 'Connection Closed Unexpectedly';
                    } else if (error.target && error.target.readyState === WebSocket.CONNECTING) {
                        errorMessage = 'Connection Failed';
                    } else {
                        errorMessage = 'Network Connection Error';
                    }

                    // If we're in circuit breaker mode, don't show retry message
                    if (this.circuitBreaker) {
                        errorMessage += '. Server Unavailable';
                        shouldRetry = false;
                    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        errorMessage += '. Max Retry Attempts Reached';
                        shouldRetry = false;
                    }

                    this.bannerManager.showWebSocketTicker(
                        'error',
                        errorMessage,
                        'fa-exclamation-triangle',
                        false // Don't auto-hide
                    );
                }
            };

        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            this.isConnecting = false;
            this.connectionLock = false; // Release connection lock on exception
            this.bannerManager.showWebSocketTicker('error', 'Connection Failure', 'fa-times-circle', false);
        }
    }

    // Clear all pending requests and fail them with connection error
    clearPendingRequests() {
        if (!this.pendingRequests) return;

        const connectionError = new Error('Connection lost - request cancelled');

        // Collect all pending requests first to avoid mutation during iteration
        const pendingRequestsSnapshot = Array.from(this.pendingRequests.entries());

        // Clear the map immediately to prevent new requests during cleanup
        this.pendingRequests.clear();
        this.pendingRequestsCount = 0;
        this.updatePendingRequestsSpinner();

        // Now fail all collected requests
        for (const [requestId, request] of pendingRequestsSnapshot) {
            try {
                // Clear timeout safely
                request.timeoutId = this.clearTimeoutSafely(request.timeoutId);

                // Reject the promise with connection error
                if (request.reject) {
                    request.reject(connectionError);
                }

                console.warn(`❌ Failed pending request ${requestId} (${request.type}): Connection lost`);
            } catch (error) {
                console.error(`❌ Error failing request ${requestId}:`, error);
            }
        }
    }

    /**
     * Gracefully disconnects from the WebSocket server
     *
     * Closes the WebSocket connection, clears all pending requests,
     * releases connection locks, and cleans up all timeouts and intervals.
     * This method is safe to call multiple times.
     */
    disconnect() {
        this.isManualClose = true;
        this.connectionLock = false; // Release connection lock
        this.initializationLock = false; // Release initialization lock

        // Clear and fail all pending requests
        this.clearPendingRequests();

        // Clear any completion timer
        if (this.completionTimer) {
            clearTimeout(this.completionTimer);
            this.completionTimer = null;
        }

        // Clear WebSocket indicator timeouts
        this.clearWebSocketIndicatorTimeouts();

        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        } else {
        }
    }

    reconnect() {
        // Check if we're in circuit breaker mode
        if (this.circuitBreaker) {
            const timeSinceLastAttempt = Date.now() - this.lastConnectionAttempt;
            if (timeSinceLastAttempt < this.connectionCooldown) {
                // Schedule another check after cooldown
                setTimeout(() => {
                    if (!this.isManualClose && this.circuitBreaker) {
                        this.circuitBreaker = false; // Reset circuit breaker
                        this.reconnectAttempts = 0; // Reset attempts
                        this.reconnect();
                    }
                }, this.connectionCooldown - timeSinceLastAttempt);
                return;
            } else {
                this.circuitBreaker = false; // Reset circuit breaker after cooldown
            }
        }

        if (this.isManualClose) {
            return;
        }

        this.reconnectAttempts++;
        this.lastConnectionAttempt = Date.now();

        // Check if we've exceeded max attempts
        if (this.reconnectAttempts > this.maxReconnectAttempts) {
            this.circuitBreaker = true;
            this.bannerManager.updateWebSocketToast(
                'error',
                'Connection failed. Click to retry or restart the app.',
                '<i class="fas fa-exclamation-triangle"></i>',
                true, // Don't auto-hide
                0,
                '<button onclick="window.wsClient.manualReconnect()" class="retry-btn" style="margin-left: 10px; padding: 5px 10px; background: #007bff; color: white; border: none; border-radius: 3px; cursor: pointer;">Retry Now</button>'
            );
            this.bannerManager.showWebSocketTicker(
                'error',
                'Connection Failed',
                'fa-exclamation-triangle',
                false // Don't auto-hide
            );
            return;
        }

        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
        console.log(`🔌 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        setTimeout(() => {
            if (!this.isManualClose && !this.circuitBreaker) {
                this.connect();
            }
        }, delay);
    }

    // Method to force reconnect (used after authentication)
    forceReconnect() {
        this.isManualClose = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.circuitBreaker = false; // Reset circuit breaker
        // Don't reset initializationCompleted - we only want to run steps flagged as runOnReconnect
        this.disconnect();
        setTimeout(() => {
            this.connect();
        }, 100);
    }

    // Manual reconnect method for user-initiated reconnection
    manualReconnect() {
        this.isManualClose = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.circuitBreaker = false;
        this.lastConnectionAttempt = 0;

        // Show connecting ticker (don't auto-hide until connected)
        this.bannerManager.showWebSocketTicker('connecting', 'Reconnecting...', 'fa-signal', false);

        // Attempt connection
        this.connect();
    }

    // Method to reset initialization flag (useful for manual page refresh scenarios)
    resetInitialization() {
        this.initializationCompleted = false;
        this.initializationLock = false; // Also reset the lock
    }

    /**
     * Completely destroys the WebSocket client and releases all resources
     *
     * This method should be called when the client is no longer needed,
     * such as when the page is being unloaded or the client is being replaced.
     * It ensures all connections, timeouts, intervals, and UI elements are cleaned up.
     */
    destroy() {
        console.log('🗑️ Destroying WebSocket client...');

        // Disconnect and cleanup connection
        this.disconnect();

        // Clear all timeouts and intervals
        if (this.tickerHideTimeout) {
            clearTimeout(this.tickerHideTimeout);
            this.tickerHideTimeout = null;
        }

        // Clear all WebSocket indicator timeouts
        this.clearWebSocketIndicatorTimeouts();

        // Clear progress notification
        this.hideProgressNotification();

        // Clear any pending initialization
        this.initializationCompleted = false;
        this.initializationLock = false;
        this.initSteps = [];

        // Clear banner manager resources
        if (this.bannerManager) {
            this.bannerManager.hideWebSocketToast();
            this.bannerManager.hideWebSocketTicker();
        }

        console.log('✅ WebSocket client destroyed');
    }

    // Method to check if initialization has been completed
    isInitialized() {
        return this.initializationCompleted;
    }

    // Method to check if manual reconnection is available
    canManualReconnect() {
        return this.circuitBreaker || (!this.isConnected() && !this.isConnecting);
    }

    // Method to get user-friendly status message
    getUserStatusMessage() {
        if (this.isConnected()) {
            return 'Connected to server';
        }

        if (this.isConnecting) {
            return 'Connecting to server...';
        }

        if (this.circuitBreaker) {
            const timeSinceLastAttempt = Date.now() - this.lastConnectionAttempt;
            const remainingCooldown = Math.max(0, this.connectionCooldown - timeSinceLastAttempt);
            if (remainingCooldown > 0) {
                const seconds = Math.ceil(remainingCooldown / 1000);
                return `Connection failed. Waiting ${seconds}s before next attempt.`;
            } else {
                return 'Connection failed. Click retry to attempt reconnection.';
            }
        }

        if (this.reconnectAttempts > 0) {
            return `Reconnecting... (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`;
        }

        return 'Disconnected from server';
    }

    // Method to execute a specific initialization step by name
    async executeSpecificStep(stepName) {
        const step = this.initSteps.find(s => s.message === stepName);
        if (step) {
            try {
                await step.stepFunction();
                return true;
            } catch (error) {
                console.error(`Error executing specific init step "${stepName}":`, error);
                return false;
            }
        } else {
            console.warn(`⚠️ Init step not found: ${stepName}`);
            return false;
        }
    }

    // Method to get list of available initialization steps
    getInitSteps() {
        return this.initSteps.map(step => ({
            message: step.message,
            priority: step.priority,
            runOnReconnect: step.runOnReconnect,
            completed: this.initializationCompleted
        }));
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.ws.send(JSON.stringify(message));
            this.flashWebSocketArrow('up');
        } else {
            console.warn('⚠️ WebSocket not connected, message not sent:', message);
        }
    }

    handleMessage(message) {
        // Handle pong responses with requestId for authentication checking
        if (message.type === 'pong') {
            if (message.requestId) {
                this.resolveRequest(message.requestId, { success: true }, null);
            }
            return;
        }

        // Handle authentication errors
        if (message.type === 'auth_error') {
            console.error('❌ WebSocket authentication error:', message.message);
            this.handleAuthError(message);
            return;
        }

        // Handle general error messages
        if (message.type === 'error') {
            console.error('❌ WebSocket error:', message.message, message.details);
            // If this error has a requestId, resolve the pending request with the error
            if (message.requestId && this.pendingRequests && this.pendingRequests.has(message.requestId)) {
                const error = new Error(message.message || 'Server error');
                error.details = message.details;
                error.requestId = message.requestId;
                this.resolveRequest(message.requestId, null, error);
            }
            return;
        }

        // Handle search responses (ack-less)
        if (message.type.startsWith('search_status_update') ||
            message.type.startsWith('search_results_update') ||
            message.type.startsWith('search_results_complete') ||
            message.type.startsWith('search_characters_response') ||
            message.type.startsWith('search_characters_complete')) {
            // Search responses are ack-less, handle them directly
            if (typeof window.handleSearchResponse === 'function') {
                window.handleSearchResponse(message);
            }
            return;
        }

        // Handle all chat-related messages
        if (message.type.startsWith('chat_')) {
            if (window.chatSystem) {
                switch (message.type) {
                    case 'chat_message_response':
                        window.chatSystem.handleChatMessageResponse(message);
                        // Resolve the pending request for non-streaming responses
                        if (message.requestId) {
                            this.resolveRequest(message.requestId, message.data, message.error);
                        }
                        break;
                    case 'chat_streaming_start':
                        window.chatSystem.handleStreamingStart(message);
                        break;
                    case 'chat_streaming_update':
                        window.chatSystem.handleStreamingUpdate(message);
                        break;
                    case 'chat_streaming_complete':
                        window.chatSystem.handleStreamingComplete(message);
                        if (message.requestId) {
                            this.resolveRequest(message.requestId, { success: true }, null);
                        }
                        break;
                    default:
                }
            }
            return;
        }

        // Handle all Director-related messages
        if (message.type.startsWith('director_') || message.type === 'dynamic_generation_response' || message.type === 'dynamic_generation_error') {
            // For response messages, also resolve the pending request
            if (message.type.endsWith('_response') && message.requestId) {
                this.resolveRequest(message.requestId, message, null);
            }

            // Trigger custom events for Director messages
            this.triggerEvent(message.type, message);
            return;
        }

        // Handle Rentan progress updates
        if (message.type === 'dynamic_generation_progress_update') {
            this.handleDynamicGenerationProgressUpdate(message);
            return;
        }

        // Handle unified image generation progress updates
        if (message.type === 'image_generation_progress') {
            this.handleImageGenerationProgress(message);
            return;
        }

        // image_generation_intermediate messages are now deprecated - intermediate images come through image_generation_progress

        // Handle workspace image additions
        if (message.type === 'workspace_image_added') {
            this.handleWorkspaceImageAdded(message);
            return;
        }

        // Handle search indexing status updates
        if (message.type === 'search_indexing_status') {
            this.handleSearchIndexingStatus(message);
            return;
        }

        // Handle image generation errors
        if (message.type === 'image_generation_error') {
            console.error('❌ Image generation error:', message.error);
            console.error('❌ Full error details:', message);

            if (message.requestId) {
                // Build detailed error message
                let errorMsg = message.error || 'Image generation failed';

                // Include additional details if available
                if (message.details) {
                    errorMsg += `\nDetails: ${message.details}`;
                }
                if (message.stack) {
                    console.error('❌ Error stack:', message.stack);
                }

                this.resolveRequest(message.requestId, null, new Error(errorMsg));
            }

            // Reset global generation state when error occurs
            if (typeof isGenerating !== 'undefined') {
                isGenerating = false;
            }

            // Reset generation button state when error occurs
            if (typeof updateManualGenerateBtnState === 'function') {
                updateManualGenerateBtnState();
            }

            return;
        }

        // Handle all other response messages that should trigger resolveRequest
        if (message.type.endsWith('_response')) {
            if (message.requestId) {
                const hasPendingRequest = this.pendingRequests && this.pendingRequests.has(message.requestId);
                if (!hasPendingRequest) {
                    this.logWarning('Response for unknown request', `Received response for unknown request ID: ${message.requestId}`, {
                        messageType: message.type,
                        hasPendingRequests: !!this.pendingRequests,
                        pendingRequestsCount: this.pendingRequests?.size || 0
                    });
                    // Still attempt to resolve in case of timing issues
                }
                this.resolveRequest(message.requestId, message.data, message.error);
            } else {
                console.warn(`⚠️ Received response without requestId:`, {
                    messageType: message.type,
                    hasData: !!message.data,
                    hasError: !!message.error
                });
            }

            // Special handling for gallery responses
            if (message.type === 'request_gallery_response') {
                this.handleGalleryResponse(message.data, message.requestId);
            }

            // Special handling for workspace activation responses
            if (message.type === 'workspace_activate_response') {
                this.handleWorkspaceActivationResponse(message.data);
            }

            return;
        }

        // Handle all error messages that should trigger resolveRequest with error
        if (message.type.endsWith('_error')) {
            if (message.requestId) {
                const error = new Error(message.error || 'Operation failed');
                error.details = message.data;
                this.resolveRequest(message.requestId, null, error);
            } else {
                console.warn(`⚠️ Received error without requestId:`, {
                    messageType: message.type,
                    error: message.error
                });
            }
            return;
        }

        // Handle cache refresh response
        if (message.type === 'refresh_server_cache_response') {
            if (message.requestId) {
                this.resolveRequest(message.requestId, message.data, message.error);
            }

            // Show success/error message
            if (message.success) {
                const successMessage = `Server cache refreshed successfully. ${message.data?.assetsCount || 0} assets updated.`;
                
                // Desktop mode: use Windows Update Modal
                if (window.isDesktop && this.showWindowsUpdateModal) {
                    this.showWindowsUpdateModal('Cache Refreshed', 100);
                    this.updateWindowsUpdateModal(successMessage, 100);
                    this.setUpdateModalCallbacks(
                        () => this.hideWindowsUpdateModal(),
                        null,
                        () => this.hideWindowsUpdateModal()
                    );
                    // Auto-hide after 3 seconds
                    setTimeout(() => {
                        this.hideWindowsUpdateModal();
                    }, 3000);
                } else {
                    // Non-desktop mode: use toast
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('success', 'Cache Refreshed', successMessage, false, 5000, '<i class="fas fa-sync"></i>');
                    }
                }
            } else {
                const errorMessage = message.error || 'Failed to refresh server cache';
                
                // Desktop mode: use Windows Update Modal
                if (window.isDesktop && this.showWindowsUpdateModal) {
                    this.showWindowsUpdateModal('Cache Refresh Failed', 0);
                    this.updateWindowsUpdateModal(errorMessage, 0);
                    this.setUpdateModalCallbacks(
                        () => this.hideWindowsUpdateModal(),
                        null,
                        () => this.hideWindowsUpdateModal()
                    );
                } else {
                    // Non-desktop mode: use toast
                    if (typeof showGlassToast === 'function') {
                        showGlassToast('error', 'Cache Refresh Failed', errorMessage, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
                    }
                }
                console.error('❌ Server cache refresh failed:', message.error);
            }

            return;
        }

        // Handle metadata cache rebuild progress
        if (message.type === 'rebuild_metadata_cache_progress') {
            this.triggerEvent('message', message);
            this.triggerEvent(message.type, message);
            return;
        }

        // Handle metadata cache rebuild response
        if (message.type === 'rebuild_metadata_cache_response') {
            this.triggerEvent('message', message);
            this.triggerEvent(message.type, message);
            if (message.requestId) {
                this.resolveRequest(message.requestId, message.data, message.error);
            }
            return;
        }

        // Handle resource update notifications
        if (message.type === 'resource_update_available') {
            const updateMessage = message.data.message || 'Resource updates are available for download';
            
            // Desktop mode: use Windows Update Modal
            if (window.isDesktop && this.showWindowsUpdateModal) {
                this.showWindowsUpdateModal('Updates Available', 0);
                this.updateWindowsUpdateModal(updateMessage, 0);
                
                // Setup callbacks for update modal buttons
                this.setUpdateModalCallbacks(
                    // Skip callback (maps to "Later" button behavior)
                    () => {
                        console.log('User chose to download updates later');
                        this.hideWindowsUpdateModal();
                    },
                    // Restart callback (not used for resource updates)
                    null,
                    // Later callback (maps to "Later" button)
                    () => {
                        console.log('User chose to download updates later');
                        this.hideWindowsUpdateModal();
                    }
                );
                
                // Override skip button to trigger download
                const skipBtn = document.getElementById('windowsUpdateSkipBtn');
                if (skipBtn) {
                    // Remove existing listeners by cloning
                    const newSkipBtn = skipBtn.cloneNode(true);
                    skipBtn.parentNode.replaceChild(newSkipBtn, skipBtn);
                    
                    newSkipBtn.addEventListener('click', () => {
                        console.log('User chose to download updates now');
                        // Trigger the service worker update check
                        if (window.serviceWorkerManager) {
                            window.serviceWorkerManager.checkStaticFileUpdates();
                        }
                        this.hideWindowsUpdateModal();
                    });
                    
                    // Change button text to "Download Now"
                    newSkipBtn.textContent = 'Download Now';
                    newSkipBtn.classList.remove('btn-secondary');
                    newSkipBtn.classList.add('btn-primary');
                }
            } else {
                // Non-desktop mode: use toast notification
                if (typeof showGlassToast === 'function') {
                    const downloadButton = {
                        text: 'Download Now',
                        type: 'primary',
                        onClick: () => {
                            console.log('User chose to download updates now');
                            // Trigger the service worker update check
                            if (window.serviceWorkerManager) {
                                window.serviceWorkerManager.checkStaticFileUpdates();
                            }
                        },
                        closeOnClick: true
                    };

                    const laterButton = {
                        text: 'Later',
                        type: 'default',
                        onClick: () => {
                            console.log('User chose to download updates later');
                        },
                        closeOnClick: true
                    };

                    showGlassToast(
                        'warning',
                        'Updates Available',
                        updateMessage,
                        false,
                        false,
                        '<i class="fas fa-download"></i>',
                        [downloadButton, laterButton]
                    );
                }
            }

            return;
        }

        // Handle config refresh errors
        if (message.type === 'config_refresh_error') {
            if (typeof showGlassToast === 'function') {
                showGlassToast(
                    'error',
                    'Config Refresh Failed',
                    message.data.message || `Failed to refresh ${message.data.configType || 'config'}`,
                    false,
                    8000, // Auto-hide after 8 seconds
                    '<i class="fas fa-exclamation-triangle"></i>'
                );
            }
            return;
        }

        // Handle any message with requestId for custom callbacks
        if (message.requestId && this.requestCallbacks && this.requestCallbacks.has(message.requestId)) {
            const callback = this.requestCallbacks.get(message.requestId);
            this.requestCallbacks.delete(message.requestId);
            try {
                callback(message.data, message.error);
            } catch (callbackError) {
                console.error(`❌ Error in custom callback for ${message.requestId}:`, callbackError);
            }
            return;
        }

        // Handle realtime search updates
        if (message.type === 'search_results_update' || message.type === 'search_status_update' || message.type === 'search_results_complete') {
            this.triggerEvent(message.type, message);
            return;
        }

        // Handle search indexing status updates
        if (message.type === 'search_indexing_status') {
            this.handleSearchIndexingStatus(message);
            return;
        }

        // Trigger message event
        this.triggerEvent('message', message);

        // Handle specific message types
        switch (message.type) {
            case 'connection':
                break;

            case 'error':
                this.bannerManager.showWebSocketBanner('error', 'WebSocket server error: ' + message.message, '<i class="fas fa-exclamation-triangle"></i>');
                break;

            case 'image_generated':
                this.handleGeneratedImage(message.data);
                break;

            case 'gallery_updated':
                this.handleGalleryUpdate(message.data);
                break;

            case 'workspace_updated':
                this.handleWorkspaceUpdate(message.data);
                break;

            case 'workspace_activated':
                this.handleWorkspaceActivation(message.data);
                break;

            case 'preset_updated':
                this.handlePresetUpdate(message.data);
                break;

            case 'queue_update':
                this.handleQueueUpdate(message.data);
                break;

            case 'request_keep_alive':
                this.handleKeepAlive(message);
                break;

            default:
                // Handle custom message types
                this.triggerEvent(message.type, message);
        }
    }

    handleAuthError(message) {
        // Show authentication error ticker (won't auto-hide)
        this.bannerManager.showWebSocketTicker('error', 'Authentication Required', 'fa-lock', false);

        // Trigger authentication event for other parts of the app to handle
        this.triggerEvent('authentication_required', message);

        // Show PIN modal for authentication
        if (typeof window.showPinModal === 'function') {
            window.showPinModal().then(() => {
                this.forceReconnect();
            }).catch((error) => {
                console.error('❌ PIN modal error:', error);
            });
        } else {
            // Fallback: redirect to login page
            window.location.href = '/';
        }
    }

    handleKeepAlive(message) {
        const { requestId, status, progress, message: statusMessage } = message;

        // Reset the timeout for this request
        this.resetRequestTimeout(requestId);

        // Trigger event for other parts of the app to handle progress updates
        this.triggerEvent('request_keep_alive', {
            requestId,
            status,
            progress,
            message: statusMessage
        });

        // Show progress toast for long-running operations
        if (progress !== null && progress !== undefined) {
            this.showProgressToast(requestId, progress, statusMessage);
        }
    }

    // Reset timeout for a specific request
    resetRequestTimeout(requestId) {
        if (this.pendingRequests && this.pendingRequests.has(requestId)) {
            const request = this.pendingRequests.get(requestId);

            // Clear existing timeout safely
            request.timeoutId = this.clearTimeoutSafely(request.timeoutId);

            // Set new timeout
            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    const request = this.pendingRequests.get(requestId);
                    this.pendingRequests.delete(requestId);
                    this.decrementPendingRequests();

                    console.warn(`⚠️ Request timeout after keep-alive reset for ${requestId}`);

                    const timeoutError = new Error(`Request timeout after 2 minutes (with keep-alive)`);
                    timeoutError.code = 'REQUEST_TIMEOUT';
                    timeoutError.requestId = requestId;
                    request.reject(timeoutError);
                }
            }, 120000); // 2 minute timeout (matches server-side keep-alive for image generation) TODO: This should be based on if Rentan is running 30 minutes for image gen and 2 min for Rentan

            // Update timeout ID
            request.timeoutId = timeoutId;
        }
    }

    // Reset timeouts for all pending requests of a specific type
    resetTimeoutsForRequestType(requestType) {
        if (!this.pendingRequests) return;

        let resetCount = 0;
        for (const [requestId, request] of this.pendingRequests) {
            if (request.type === requestType) {
                this.resetRequestTimeout(requestId);
                resetCount++;
            }
        }

        if (resetCount > 0) {
            console.log(`🔄 Reset timeout for ${resetCount} pending ${requestType} request(s)`);
        }
    }

    // Show progress toast for long-running operations
    showProgressToast(requestId, progress, message = null) {
        const progressText = message ? `${message} (${progress}%)` : `Processing... ${progress}%`;

        // Update existing progress toast or create new one
        if (!this.progressToastId) {
            if (typeof showGlassToast === 'function') {
                this.progressToastId = showGlassToast(
                    'info',
                    'Processing Request',
                    progressText,
                    true, // Show progress bar
                    false, // Don't auto-hide
                    '<i class="fas fa-cog fa-spin"></i>',
                    null,
                    progress / 100 // Progress value (0-1)
                );
            }
        } else {
            if (typeof updateGlassToastComplete === 'function') {
                updateGlassToastComplete(this.progressToastId, {
                    type: 'info',
                    title: 'Processing Request',
                    message: progressText,
                    progress: progress / 100
                });
            }
        }

        // Hide progress toast when complete
        if (progress >= 100) {
            setTimeout(() => {
                if (this.progressToastId && typeof removeGlassToast === 'function') {
                    removeGlassToast(this.progressToastId);
                    this.progressToastId = null;
                }
            }, 2000);
        }
    }

    handleGeneratedImage(data) {
        this.triggerEvent('imageGenerated', data);
    }

    handleGalleryUpdate(data) {
        this.triggerEvent('galleryUpdated', data);
    }

    handleGalleryResponse(data, requestId) {
        this.triggerEvent('galleryResponse', { data, requestId });
    }

    handleWorkspaceUpdate(data) {
        // Update local workspace object if settings were updated
        if (data.action === 'settings_updated' && data.settings && typeof workspaces !== 'undefined') {
            const workspaceId = data.workspaceId;
            if (workspaces && workspaces[workspaceId]) {
                // Update local workspace settings
                Object.assign(workspaces[workspaceId], data.settings);
            }
        }
        
        // Update global window positions if window positions were updated
        // Window positions are stored in the same file as shortcuts (workspaceDesktop config) as global object
        if (data.action === 'window_positions_updated' && data.windowPositions) {
            // Update global window positions directly
            Object.assign(globalWindowPositions, data.windowPositions);
        }
        
        // Dispatch custom event for workspace updates
        const event = new CustomEvent('workspaceUpdated', {
            detail: data
        });
        document.dispatchEvent(event);
    }

    handleWorkspaceActivation(data) {
        // Dispatch custom event for workspace activation
        const event = new CustomEvent('workspaceActivated', {
            detail: data
        });
        document.dispatchEvent(event);
    }

    handleWorkspaceActivationResponse(data) {
        // Handle workspace activation response from server
        // Dispatch the same event as broadcast activation for consistency
        const event = new CustomEvent('workspaceActivated', {
            detail: { workspaceId: data.activeWorkspace }
        });
        document.dispatchEvent(event);
    }

    handleWorkspaceImageAdded(message) {
        // Dispatch custom event for workspace image addition
        const event = new CustomEvent('workspaceImageAdded', {
            detail: {
                workspaceId: message.data.workspaceId,
                imageFilenames: message.data.imageFilenames,
                timestamp: message.timestamp
            }
        });
        document.dispatchEvent(event);
    }

    // Queue a streaming step with 250ms minimum display time
    queueStreamingStep(modalType, data) {
        // Initialize queue for this modal type if it doesn't exist
        if (!this.streamingStepQueues) {
            this.streamingStepQueues = {};
        }

        if (!this.streamingStepQueues[modalType]) {
            this.streamingStepQueues[modalType] = {
                queue: [],
                isProcessing: false,
                lastDisplayTime: 0
            };
        }

        const queueData = this.streamingStepQueues[modalType];

        // Add step to queue
        queueData.queue.push(data);

        // Start processing if not already processing
        this.processStreamingStepQueue(modalType);
    }

    // Process the streaming step queue with 250ms minimum display time
    async processStreamingStepQueue(modalType) {
        const queueData = this.streamingStepQueues[modalType];

        if (!queueData || queueData.isProcessing || queueData.queue.length === 0) {
            return;
        }

        queueData.isProcessing = true;

        while (queueData.queue.length > 0) {
            const data = queueData.queue.shift();
            const now = Date.now();

            // Calculate time since last step was displayed
            const timeSinceLastStep = now - queueData.lastDisplayTime;

            // If not enough time has passed, wait before showing next step
            if (timeSinceLastStep < 250) {
                const waitTime = 250 - timeSinceLastStep;
                await new Promise(resolve => setTimeout(resolve, waitTime));
            }

            // Display the step
            this.displayStreamingStep(modalType, data);
            queueData.lastDisplayTime = Date.now();
        }

        queueData.isProcessing = false;
    }

    // Display a streaming step on the appropriate modal
    displayStreamingStep(modalType, data) {
        if (modalType === 'manual') {
            const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
            if (manualPreviewImage) {
                // Convert base64 to data URL
                const imageDataUrl = `data:image/png;base64,${data.imageData}`;
                manualPreviewImage.src = imageDataUrl;
                manualPreviewImage.classList.remove('hidden');
                previewPlaceholder.classList.add('hidden');

                // Show that we're in streaming mode
                manualForm.classList.add('streaming');

                // Show the manual preview section with resolution dimensions
                if (typeof showManualPreview === 'function') {
                    showManualPreview(true); // true = set resolution dimensions
                }

                // Optional: Add a visual indicator that this is an intermediate image
                manualPreviewImage.title = `Generating... Step ${data.step}`;
            } else {
                console.warn('⚠️ manualPreviewImage element not found');
            }
        } else if (modalType === 'spellbook') {
            const spellbookPreviewImage = window.spellbookModalManager.previewImage;
            if (spellbookPreviewImage) {
                // Convert base64 to data URL
                const imageDataUrl = `data:image/png;base64,${data.imageData}`;
                spellbookPreviewImage.src = imageDataUrl;
                spellbookPreviewImage.classList.remove('hidden');

                // Optional: Add a visual indicator that this is an intermediate image
                spellbookPreviewImage.title = `Generating... Step ${data.step}`;
            } else {
                console.warn('⚠️ spellbookPreviewImage element not found');
            }
        }
    }

    // Clear streaming step queues (call when generation completes or is cancelled)
    clearStreamingStepQueues(modalType = null) {
        if (!this.streamingStepQueues) return;

        if (modalType) {
            // Clear specific modal queue
            if (this.streamingStepQueues[modalType]) {
                this.streamingStepQueues[modalType].queue = [];
            }
        } else {
            // Clear all queues
            Object.keys(this.streamingStepQueues).forEach(key => {
                this.streamingStepQueues[key].queue = [];
            });
        }
    }

    // Wait for all streaming steps to be displayed
    async waitForStreamingStepsComplete(modalType) {
        if (!this.streamingStepQueues || !this.streamingStepQueues[modalType]) {
            return; // No queue exists, nothing to wait for
        }

        const queueData = this.streamingStepQueues[modalType];

        // Wait while there are steps in queue or queue is being processed
        while (queueData.queue.length > 0 || queueData.isProcessing) {
            await new Promise(resolve => setTimeout(resolve, 50));
        }
    }

    // Handle Rentan progress updates
    handleDynamicGenerationProgressUpdate(message) {
        const { phase, data } = message;

        // Reset timeout for any pending dynamic context resolution requests
        // This prevents timeouts during long-running Rentan processes
        this.resetTimeoutsForRequestType('resolve_dynamic_context');

        // Update carousel with context data when available
        if (phase === 'context' && data?.carousel && typeof updateDynamicCarousel === 'function') {
            // Update current context during generation
            updateDynamicCarousel(data.carousel, 'current');
        }

        // Update compiled prompt context when preview data is updated
        if (data?.compiled_prompt?.context && typeof updateDynamicCarousel === 'function') {
            // Update compiled context and switch to compiled mode
            updateDynamicCarousel(data.compiled_prompt.context, 'compiled');
        }

        // Import the progress overlay manager functions for both modals
        if (!spellbookModalManager?.modal?.classList?.contains('hidden')) {
            updateSpellbookDynamicGenerationProgressOverlay(phase, data);
        }

        // Update overlay if dynamic generation is active, even if modal is hidden (modal hides during generation)
        const isDynamicGenerationActive = window.dynamicGenerationData || (document.getElementById('dynamicGenerationToggleBtn')?.getAttribute('data-state') === 'on');
        
        if (isDynamicGenerationActive) {
            updateDynamicGenerationProgressOverlay(phase, data);
        }
    }

    handleImageGenerationProgress(message) {
        const { data, requestId } = message;

        // Reset timeout for this request to prevent timeouts during long generations
        // This is critical for multi-stage generations (especially enhance) that can take longer than the default timeout
        this.resetRequestTimeout(requestId);

        // Store progress state for this request
        if (!this.progressStates) {
            this.progressStates = new Map();
        }

        let progressState = this.progressStates.get(requestId);
        if (!progressState) {
            progressState = { phase: data.phase, progress: 0, timer: null };
            this.progressStates.set(requestId, progressState);
        }

        // Clear existing timers if phase changed
        if (progressState.timer && progressState.phase !== data.phase) {
            clearInterval(progressState.timer);
            progressState.timer = null;
        }
        if (progressState.delayTimer && progressState.phase !== data.phase) {
            clearInterval(progressState.delayTimer);
            progressState.delayTimer = null;
        }

        progressState.phase = data.phase;

        // Calculate progress percentage using the client-side function
        if (typeof calculateGenerationProgress === 'function') {
            let progressPercent = calculateGenerationProgress(data);

            // Handle timer-based progress for certain phases
            if (data.phase === 'initializing' && !progressState.timer) {
                // Start timer for 0-15% progress (1% per second)
                progressState.progress = 0;
                progressState.timer = setInterval(() => {
                    progressState.progress = Math.min(progressState.progress + 1, 15);
                    if (typeof updateGlassToastProgress === 'function' && progressToastId) {
                        updateGlassToastProgress(progressToastId, progressState.progress);
                    }
                }, 1000);
            } else if (data.phase === 'upscaling' && !progressState.timer) {
                // Start timer for 76-95% progress (1% per second)
                progressState.progress = 76;
                progressState.timer = setInterval(() => {
                    progressState.progress = Math.min(progressState.progress + 1, 95);
                    if (typeof updateGlassToastProgress === 'function' && progressToastId) {
                        updateGlassToastProgress(progressToastId, progressState.progress);
                    }
                }, 1000);
            } else if (data.phase !== 'initializing' && data.phase !== 'upscaling') {
                // Clear timer for non-timer phases
                if (progressState.timer) {
                    clearInterval(progressState.timer);
                    progressState.timer = null;
                }
            }

            // Update progress toast if it exists (skip for timer phases that are self-updating)
            if (typeof updateGlassToastProgress === 'function' && progressToastId &&
                data.phase !== 'initializing' && data.phase !== 'upscaling') {
                updateGlassToastProgress(progressToastId, progressPercent);
            }

            // Update main message line with progress status (line 2)
            if (typeof updateGlassToastMessage === 'function' && progressToastId) {
                let statusMessage = '';
                switch (data.phase) {
                    case 'initializing':
                        statusMessage = 'Analyzing request...';
                        break;
                    case 'tool_execution':
                        if (data.currentKey && data.totalKeys) {
                            statusMessage = `Executing tools (${data.currentKey}/${data.totalKeys})...`;
                        } else {
                            statusMessage = 'Executing tools...';
                        }
                        break;
                    case 'ai_streaming':
                        statusMessage = 'Processing AI response...';
                        break;
                    case 'ai_complete':
                        statusMessage = 'AI processing complete, starting generation...';
                        break;
                    case 'generating':
                        if (data.totalStages && data.currentStage !== undefined) {
                            // Staged generation
                            const stageType = data.stageType || 'stage';
                            statusMessage = `Stage ${data.currentStage}/${data.totalStages}: ${stageType}`;
                        } else {
                            statusMessage = 'Generating image...';
                        }
                        break;
                    case 'stage_delay':
                        if (data.delayMs) {
                            const delaySeconds = Math.ceil(data.delayMs / 1000);
                            statusMessage = `Stage delay: ${delaySeconds}s remaining`;

                            // Start countdown timer for stage delay
                            if (!progressState.delayTimer) {
                                let remainingSeconds = delaySeconds;
                                progressState.delayTimer = setInterval(() => {
                                    remainingSeconds--;
                                    if (remainingSeconds > 0) {
                                        if (typeof updateGlassToastMessage === 'function' && progressToastId) {
                                            updateGlassToastMessage(progressToastId, `Stage delay: ${remainingSeconds}s remaining`);
                                        }
                                    } else {
                                        // Clear timer when countdown reaches 0
                                        if (progressState.delayTimer) {
                                            clearInterval(progressState.delayTimer);
                                            progressState.delayTimer = null;
                                        }
                                    }
                                }, 1000);
                            }
                        } else {
                            statusMessage = 'Stage delay...';
                        }
                        break;
                    case 'upscaling':
                        statusMessage = 'Upscaling image...';
                        break;
                    case 'previews':
                        statusMessage = 'Generating previews...';
                        break;
                    default:
                        statusMessage = 'Processing...';
                }
                updateGlassToastMessage(progressToastId, statusMessage);
            }

            // Update stage indicators for manual modal
            if (data.totalStages && data.currentStage !== undefined) {
                const manualModal = document.getElementById('manualModal');
                if (manualModal && !manualModal.classList.contains('hidden')) {
                    // Initialize indicators on first progress update with stages
                    if (typeof initializeStageIndicators === 'function') {
                        const container = document.getElementById('manualStageIndicators');
                        if (container && (container.children.length === 0 || container.classList.contains('hidden'))) {
                            initializeStageIndicators(data.totalStages);
                        }
                    }

                    // Update indicators with current progress
                    if (typeof updateStageIndicators === 'function') {
                        updateStageIndicators(data);
                    }
                }
            }

            // Handle reasoning display in 3rd line (only for actual reasoning)
            if (data.reasoning && typeof updateGlassToastReasoning === 'function') {
                // Store toolState globally for toast manager to access
                if (data.toolState) {
                    window._lastToolState = data.toolState;
                }
                updateGlassToastReasoning(progressToastId, data.reasoning, data.toolName, data.phase);
            }

            // Handle image preview updates
            if (data.imageData && typeof updateGlassToastImagePreview === 'function') {
                updateGlassToastImagePreview(progressToastId, data.imageData);

                // Also handle modal streaming updates for intermediate images
                if (data.phase === 'generating' && data.currentStep !== undefined) {
                    // Add step to the appropriate queue
                    if (!manualModal.classList.contains('hidden')) {
                        this.queueStreamingStep('manual', data);
                    }

                    if (window.spellbookModalManager && !window.spellbookModalManager.modal.classList.contains('hidden') && window.spellbookModalManager.isGenerating) {
                        this.queueStreamingStep('spellbook', data);
                    }
                }
            }

            // Handle completion
            if (data.phase === 'complete') {
                // Clear any running timers
                if (progressState.timer) {
                    clearInterval(progressState.timer);
                    progressState.timer = null;
                }

                if (typeof updateGlassToastComplete === 'function') {
                    updateGlassToastComplete(progressToastId, {
                        type: 'success',
                        title: 'Generation Complete',
                        message: 'Image generated successfully!',
                        customIcon: '<i class="nai-check"></i>',
                        showProgress: false
                    });
                }

                // Clear reasoning when complete
                if (typeof updateGlassToastReasoning === 'function') {
                    updateGlassToastReasoning(progressToastId, '');
                }

                // Hide stage indicators when complete
                if (typeof hideStageIndicators === 'function') {
                    hideStageIndicators();
                }

                progressToastId = null; // Clear the toast ID
                this.progressStates.delete(requestId); // Clean up state
            }
        }
    }

    handlePresetUpdate(data) {
        // Dispatch custom event for preset updates
        const event = new CustomEvent('presetUpdated', {
            detail: data
        });
        document.dispatchEvent(event);
    }

    handleQueueUpdate(data) {
        // Trigger queue update event
        this.triggerEvent('queue_update', data);

        // Update global queue status for the app
        if (window.optionsData) {
            window.optionsData.queue_status = data.value;
        }

        // Update generation button state if the function exists
        if (typeof updateManualGenerateBtnState === 'function') {
            updateManualGenerateBtnState();
        }
    }

    handleSearchIndexingStatus(message) {
        const indicator = document.getElementById('searchIndexingIndicator');
        if (!indicator) return;

        const icon = indicator.querySelector('i');
        if (!icon) return;

        const status = message.status || 'idle';
        const statusMessage = message.message || 'Search index up to date';

        // Update tooltip
        indicator.title = statusMessage;

        // Remove all status classes
        indicator.classList.remove('indexing', 'up_to_date', 'error', 'paused', 'cache_init', 'cache_ready', 'idle');

        // Update icon and add appropriate class based on status
        switch (status) {
            case 'starting':
            case 'indexing':
            case 'cache_init':
                indicator.classList.add('indexing');
                icon.className = 'fas fa-sync fa-spin';
                break;
            case 'complete':
            case 'up_to_date':
            case 'cache_ready':
                indicator.classList.add('up_to_date');
                icon.className = 'fas fa-sync';
                break;
            case 'paused':
                indicator.classList.add('paused');
                icon.className = 'fas fa-sync';
                icon.classList.remove('fa-spin');
                break;
            case 'resumed':
            case 'idle':
                indicator.classList.add('up_to_date');
                icon.className = 'fas fa-sync';
                break;
            case 'error':
                indicator.classList.add('error');
                icon.className = 'fas fa-rotate-exclamation';
                // Remove spin animation on error
                icon.classList.remove('fa-spin');
                break;
            default:
                icon.className = 'fas fa-sync';
                break;
        }

        // Update paused state in indicator data attribute for context menu
        if (status === 'paused') {
            indicator.dataset.indexingPaused = 'true';
        } else if (status === 'resumed' || status === 'idle' || status === 'up_to_date' || status === 'complete') {
            indicator.dataset.indexingPaused = 'false';
        }

        // Re-attach context menu if it exists to update dynamic items
        if (indicator._menuConfigFn && window.contextMenu) {
            window.contextMenu.attachToElement(indicator, indicator._menuConfigFn());
        }

        // Trigger event for other parts of the app that might want to listen
        this.triggerEvent('search_indexing_status', message);
    }


    // Method to request image upscaling via WebSocket
    async upscaleImage(upscaleParams, requestId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('upscale_image', upscaleParams);
            return result;
        } catch (error) {
            console.error('Upscale image error:', error);
            throw error;
        }
    }

    // Method to request image expansion via WebSocket
    async expandImage(expansionParams, requestId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('expand_image', expansionParams);
            return result;
        } catch (error) {
            console.error('Expand image error:', error);
            throw error;
        }
    }

    // Method to reroll expanded image via WebSocket
    async rerollExpandedImage(params, requestId = null) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('reroll_expanded_image', params);
            return result;
        } catch (error) {
            console.error('Reroll expanded image error:', error);
            throw error;
        }
    }

    // Method to request image generation via WebSocket
    async generateImage(generationParams, requestId = null, enableStreaming = false) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('generate_image', { ...generationParams, enableStreaming });
            return result;
        } catch (error) {
            console.error('Generate image error:', error);
            throw error;
        }
    }

    // Method to request image reroll via WebSocket
    async rerollImage(filename, workspace = null, requestId = null, allowPaid = false) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('reroll_image', { filename, workspace, allow_paid: allowPaid });
            return result;
        } catch (error) {
            console.error('Reroll image error:', error);
            throw error;
        }
    }

    // Method to request gallery data via WebSocket
    async requestGallery(viewType = 'images', includePinnedStatus = true) {
        try {
            const result = await this.sendMessageWithCallback('request_gallery', {
                viewType,
                includePinnedStatus
            }, (response, error) => {
                if (error) {
                    console.error('Gallery request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            console.error('Gallery request error:', error);
            throw error;
        }
    }

    // Method to request specific gallery view (scraps, pinned, upscaled)
    async requestGalleryView(viewType) {
        return this.requestGallery(viewType, true);
    }

    // Method to request all images with pinned status
    async requestAllImages() {
        return this.requestGallery('images', true);
    }

    // Method to request image metadata via WebSocket
    async requestImageMetadata(filename) {
        try {
            const result = await this.sendMessageWithCallback('request_image_metadata', { filename }, (response, error) => {
                if (error) {
                    console.error('Image metadata request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'Image metadata request error', error.message, false);
            throw error;
        }
    }

    // Method to request URL upload metadata via WebSocket
    async requestUrlUploadMetadata(filename) {
        try {
            const result = await this.sendMessageWithCallback('request_url_upload_metadata', { filename }, (response, error) => {
                if (error) {
                    console.error('URL upload metadata request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'URL upload metadata request error', error.message, false);
            throw error;
        }
    }

    // Method to request image by index via WebSocket
    async requestImageByIndex(index, viewType = 'images') {
        try {
            const result = await this.sendMessageWithCallback('request_image_by_index', { index, viewType }, (response, error) => {
                if (error) {
                    console.error('Image by index request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'Image by index request error', error.message, false);
            throw error;
        }
    }

    // Method to find image index by filename via WebSocket
    async findImageIndex(filename, viewType = 'images') {
        try {
            const result = await this.sendMessageWithCallback('find_image_index', { filename, viewType }, (response, error) => {
                if (error) {
                    console.error('Find image index callback error:', error);
                }
            });
            return result;
        } catch (error) {
            showGlassToast('error', 'Find image index error', error.message, false);
            throw error;
        }
    }

    // Search methods
    async searchCharacters(query, model, options = {}) {
        try {
            // Send ack-less search request (no response expected)
            this.sendAcklessMessage('search_characters', { query, model, requestId: options.requestId });
            return { success: true };
        } catch (error) {
            showGlassToast('error', 'Character search error', error.message, false);
            throw error;
        }
    }

    async searchPresets(query) {
        return this.sendMessageWithRequestId('search_presets', this.generateRequestId(), { query });
    }

    async loadPreset(presetReq) {
        return this.sendMessageWithRequestId('load_preset', this.generateRequestId(), presetReq);
    }

    async savePreset(presetName, config) {
        return this.sendMessageWithRequestId('save_preset', this.generateRequestId(), { presetName, config });
    }

    async resolveDynamicContext(dynamicConfig) {
        return this.sendMessageWithRequestId('resolve_dynamic_context', this.generateRequestId(), { dynamicConfig });
    }

    async deletePreset(presetName) {
        return this.sendMessageWithRequestId('delete_preset', this.generateRequestId(), { presetName });
    }

    async generatePreset(presetName, workspace = null, allowPaid = false, enableStreaming = false) {
        return this.sendMessageWithRequestId('generate_preset', this.generateRequestId(), { presetName, allow_paid: allowPaid, workspace, enableStreaming });
    }

    async getPresets(page = 1, itemsPerPage = 15, searchTerm = '') {
        return this.sendMessageWithRequestId('get_presets', this.generateRequestId(), { page, itemsPerPage, searchTerm });
    }

    async updatePreset(presetName, presetData) {
        return this.sendMessageWithRequestId('update_preset', this.generateRequestId(), { presetName, ...presetData });
    }

    async regeneratePresetUuid(presetName) {
        return this.sendMessageWithRequestId('regenerate_preset_uuid', this.generateRequestId(), { presetName });
    }

    async lookupCity(cityName) {
        return this.sendMessageWithRequestId('lookup_city', this.generateRequestId(), { cityName });
    }

    async searchDatasetTags(query, path = []) {
        try {
            const result = await this.sendMessage('search_dataset_tags', { query, path });
            return result;
        } catch (error) {
            showGlassToast('error', 'Dataset tag search error', error.message, false);
            throw error;
        }
    }

    async getTagsForPath(path = []) {
        try {
            const result = await this.sendMessage('get_dataset_tags_for_path', { path });
            return result;
        } catch (error) {
            showGlassToast('error', 'Get Tags For Path', error.message, false);
            throw error;
        }
    }

    async searchTags(query, singleMatch = false) {
        try {
            const result = await this.sendMessage('search_tags', { query, single_match: singleMatch });
            return result;
        } catch (error) {
            showGlassToast('error', 'Search tags error', error.message, false);
            throw error;
        }
    }

    async addWordToDictionary(word) {
        try {
            const result = await this.sendMessage('spellcheck_add_word', { word });
            return result;
        } catch (error) {
            showGlassToast('error', 'Add word to dictionary error', error.message, false);
            throw error;
        }
    }

    // Search files by metadata (prompts, characters, etc.)
    async searchFiles(query, viewType = 'images') {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('search_files', {
                query,
                viewType,
                action: 'search'
            });
            return result;
        } catch (error) {
            console.error('Search files error:', error);
            throw error;
        }
    }

    // Get tag suggestions without performing full search
    async getTagSuggestions(query, viewType = 'images', contextTags = []) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('search_files', {
                query,
                viewType,
                action: 'suggestions',
                contextTags: contextTags
            });
            return result;
        } catch (error) {
            console.error('Tag suggestions error:', error);
            throw error;
        }
    }

    // Initialize search cache for a view type
    async initializeSearchCache(viewType = 'images') {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('search_files', {
                action: 'start',
                viewType: viewType
            });
            return result;
        } catch (error) {
            console.error('Cache initialization error:', error);
            throw error;
        }
    }

    // Clean up search cache
    async cleanupSearchCache() {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('search_files', {
                action: 'stop'
            });
            return result;
        } catch (error) {
            console.error('Cache cleanup error:', error);
            throw error;
        }
    }

    // Request fresh gallery data for search filtering
    async requestGalleryData(viewType = 'images') {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('request_gallery', {
                viewType: viewType,
                includeMetadata: false // We only need the image list for filtering
            });
            return result;
        } catch (error) {
            console.error('Gallery data request error:', error);
            throw error;
        }
    }

    // Workspace methods
    async getWorkspaces() {
        return this.sendMessage('workspace_list');
    }

    async getWorkspace() {
        return this.sendMessage('workspace_get');
    }

    async getDesktopSettings() {
        return this.sendMessage('desktop_get_settings');
    }

    async createWorkspace(name, color = null) {
        return this.sendMessage('workspace_create', { name, color });
    }

    async renameWorkspace(id, name) {
        return this.sendMessage('workspace_rename', { id, name });
    }

    async deleteWorkspace(id) {
        return this.sendMessage('workspace_delete', { id });
    }

    async setActiveWorkspace(id) {
        return this.sendMessage('workspace_activate', { id });
    }

    async dumpWorkspace(sourceId, targetId) {
        return this.sendMessage('workspace_dump', { sourceId, targetId });
    }

    async getWorkspaceFiles(id) {
        return this.sendMessage('workspace_get_files', { id });
    }

    async moveFilesToWorkspace(filenames, targetWorkspaceId, sourceWorkspaceId = null, moveType = 'files') {
        return this.sendMessage('workspace_move_files', { id: targetWorkspaceId, filenames, sourceWorkspaceId, moveType });
    }

    async getWorkspaceScraps(id) {
        return this.sendMessage('workspace_get_scraps', { id });
    }

    async getWorkspacePinned(id) {
        return this.sendMessage('workspace_get_pinned', { id });
    }

    async addScrap(id, filename) {
        return this.sendMessage('workspace_add_scrap', { id, filename });
    }

    async removeScrap(id, filename) {
        return this.sendMessage('workspace_remove_scrap', { id, filename });
    }

    async addPinned(id, filename) {
        return this.sendMessage('workspace_add_pinned', { id, filename });
    }

    async removePinned(id, filename) {
        return this.sendMessage('workspace_remove_pinned', { id, filename });
    }

    async bulkAddPinned(id, filenames) {
        return this.sendMessage('workspace_bulk_add_pinned', { id, filenames });
    }

    async bulkRemovePinned(id, filenames) {
        return this.sendMessage('workspace_bulk_remove_pinned', { id, filenames });
    }

    async getWorkspaceGroups(id) {
        return this.sendMessage('workspace_get_groups', { id });
    }

    async createGroup(id, name) {
        return this.sendMessage('workspace_create_group', { id, name });
    }

    async getGroup(id, groupId) {
        return this.sendMessage('workspace_get_group', { id, groupId });
    }

    async renameGroup(id, groupId, name) {
        return this.sendMessage('workspace_rename_group', { id, groupId, name });
    }

    async addImagesToGroup(id, groupId, filenames) {
        return this.sendMessage('workspace_add_images_to_group', { id, groupId, filenames });
    }

    async removeImagesFromGroup(id, groupId, filenames) {
        return this.sendMessage('workspace_remove_images_from_group', { id, groupId, filenames });
    }

    async deleteGroup(id, groupId) {
        return this.sendMessage('workspace_delete_group', { id, groupId });
    }

    async getImageGroups(id, filename) {
        return this.sendMessage('workspace_get_image_groups', { id, filename });
    }

    async updateWorkspaceColor(id, color) {
        return this.sendMessage('workspace_update_color', { id, color });
    }

    async updateWorkspaceBackgroundColor(id, backgroundColor) {
        return this.sendMessage('workspace_update_background_color', { id, backgroundColor });
    }

    async updateWorkspacePrimaryFont(id, primaryFont) {
        return this.sendMessage('workspace_update_primary_font', { id, primaryFont });
    }

    async updateWorkspaceTextareaFont(id, textareaFont) {
        return this.sendMessage('workspace_update_textarea_font', { id, textareaFont });
    }

    async updateWorkspaceSettings(id, settings) {
        return this.sendMessage('workspace_update_settings', { id, settings });
    }

    // Save window positions without triggering ticket system (uses ackless message)
    // Window positions are now global (not per-workspace), so workspaceId is ignored
    async saveWindowPositions(workspaceId, windowPositions) {
        if (!this.isConnected()) {
            return;
        }
        
        // Use sendAcklessMessage to avoid triggering the ticket system
        // workspaceId is ignored - positions are stored globally
        this.sendAcklessMessage('workspace_update_window_positions', {
            windowPositions: windowPositions
        });
    }

    async reorderWorkspaces(workspaceIds) {
        return this.sendMessage('workspace_reorder', { workspaceIds });
    }

    async addScrapBulk(id, filenames) {
        return this.sendMessage('workspace_bulk_add_scrap', { id, filenames });
    }

    async removePinnedBulk(id, filenames) {
        return this.sendMessage('workspace_bulk_remove_pinned', { id, filenames });
    }

    async addPinnedBulk(id, filenames) {
        return this.sendMessage('workspace_bulk_add_pinned', { id, filenames });
    }

    async deleteImagesBulk(filenames) {
        return this.sendMessage('delete_images_bulk', { filenames });
    }

    async sendToSequenziaBulk(filenames) {
        return this.sendMessage('send_to_sequenzia_bulk', { filenames });
    }

    async updateImagePresetBulk(filenames, presetName) {
        return this.sendMessage('update_image_preset_bulk', { filenames, presetName });
    }

    // Desktop shortcuts methods
    async getDesktopShortcuts(workspaceId) {
        return this.sendMessage('desktop_get_shortcuts', { workspaceId });
    }

    async addDesktopShortcut(workspaceId, shortcut) {
        return this.sendMessage('desktop_add_shortcut', { workspaceId, shortcut });
    }

    async updateDesktopShortcut(workspaceId, shortcutId, updates) {
        return this.sendMessage('desktop_update_shortcut', { workspaceId, shortcutId, updates });
    }

    async removeDesktopShortcut(workspaceId, shortcutId) {
        return this.sendMessage('desktop_remove_shortcut', { workspaceId, shortcutId });
    }

    async updateDesktopPositions(workspaceId, positions) {
        return this.sendMessage('desktop_update_positions', { workspaceId, positions });
    }

    async getReferences() {
        return this.sendMessage('get_references');
    }

    async getReferencesByIds(references) {
        return this.sendMessage('get_references_by_ids', { references });
    }

    async getWorkspaceReferences(workspaceId) {
        return this.sendMessage('get_workspace_references', { workspaceId });
    }

    async deleteReference(hash, workspaceId) {
        return this.sendMessage('delete_reference', { hash, workspaceId });
    }

    async uploadReference(imageData, workspaceId, tempFile = null, comment = null, filename = null, description = null, tags = []) {
        return this.sendMessage('upload_reference', { imageData, workspaceId, tempFile, comment, filename, description, tags });
    }

    async uploadWallpaper(imageData, workspaceId) {
        return this.sendMessage('upload_wallpaper', { imageData, workspaceId });
    }

    async replaceReference(hash, imageData, workspaceId, tempFile = null, filename = null) {
        return this.sendMessage('replace_reference', { hash, imageData, workspaceId, tempFile, filename });
    }

    async updateReferenceMetadata(hash, metadata) {
        return this.sendMessage('update_reference_metadata', { hash, metadata });
    }

    async downloadUrlFile(url) {
        try {
            // Add a timeout to prevent hanging
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Download timeout - server took too long to respond')), 10000); // 10 second timeout
            });

            const downloadPromise = this.sendMessage('download_url_file', { url });

            return await Promise.race([downloadPromise, timeoutPromise]);
        } catch (error) {
            console.error('❌ WebSocket downloadUrlFile error:', error);
            throw error;
        }
    }

    async fetchUrlInfo(url, options = {}, responseType = 'json') {
        return this.sendMessage('fetch_url_info', { url, options, responseType });
    }

    async uploadWorkspaceImage(imageData, workspaceId, originalFilename = null, batchInfo = null, tempFile = null) {
        return this.sendMessage('upload_workspace_image', { imageData, workspaceId, originalFilename, batchInfo, tempFile });
    }

    async moveReferences(hashes, targetWorkspaceId, sourceWorkspaceId) {
        return this.sendMessage('move_references', { hashes, targetWorkspaceId, sourceWorkspaceId });
    }

    async getVibeImage(filename) {
        return this.sendMessage('get_vibe_image', { filename });
    }

    async deleteVibeImage(vibeId, workspaceId) {
        return this.sendMessage('delete_vibe_image', { vibeId, workspaceId });
    }

    async deleteVibeEncodings(vibeId, encodings, workspaceId) {
        return this.sendMessage('delete_vibe_encodings', { vibeId, encodings, workspaceId });
    }

    async bulkDeleteVibeImages(vibesToDelete, encodingsToDelete, workspaceId) {
        return this.sendMessage('bulk_delete_vibe_images', { vibesToDelete, encodingsToDelete, workspaceId });
    }

    async moveVibeImage(vibeId, targetWorkspaceId, sourceWorkspaceId) {
        return this.sendMessage('move_vibe_image', { vibeId, targetWorkspaceId, sourceWorkspaceId });
    }

    async bulkMoveVibeImages(imageIds, targetWorkspaceId, sourceWorkspaceId) {
        return this.sendMessage('bulk_move_vibe_images', { imageIds, targetWorkspaceId, sourceWorkspaceId });
    }

    async encodeVibe(params) {
        return this.sendMessage('encode_vibe', params);
    }

    async importVibeBundle(bundleData, workspaceId, comment = '', tempFile = null) {
        return this.sendMessage('import_vibe_bundle', { bundleData, workspaceId, comment, tempFile });
    }

    async checkVibeEncoding(vibeId, workspaceId) {
        return this.sendMessage('check_vibe_encoding', { vibeId, workspaceId });
    }

    async getAppOptions() {
        return this.sendMessage('get_app_options');
    }

    async pingWithAuth() {
        return new Promise((resolve, reject) => {
            // Basic connection validation - don't be too strict
            if (!this.isConnected()) {
                const error = new Error('WebSocket not connected');
                error.code = 'NOT_CONNECTED';
                reject(error);
                return;
            }

            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const message = {
                type: 'ping',
                requestId
            };

            // Store pending request with timestamp
            this.pendingRequests = this.pendingRequests || new Map();
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                type: 'ping',
                showBanner: false,
                timestamp: Date.now()
            });

            // Increment pending requests count
            this.incrementPendingRequests();

            try {
                this.send(message);

                // Set timeout for ping requests
                const timeoutMs = 5000; // 5 seconds for ping requests
                const timeoutId = setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        const request = this.pendingRequests.get(requestId);
                        this.pendingRequests.delete(requestId);
                        this.decrementPendingRequests();

                        console.warn(`⚠️ Ping request timeout (ID: ${requestId}) after 5000ms`);
                        const timeoutError = new Error('Ping request timeout after 5000ms');
                        timeoutError.code = 'PING_TIMEOUT';
                        timeoutError.requestId = requestId;
                        reject(timeoutError);
                    }
                }, timeoutMs);

                // Store timeout ID for cleanup
                this.pendingRequests.get(requestId).timeoutId = timeoutId;

            } catch (error) {
                this.pendingRequests.delete(requestId);
                this.decrementPendingRequests();
                reject(error);
            }
        });
    }

    async refreshServerCache() {
        return this.sendMessage('refresh_server_cache', {}, false); // Background operation
    }

    async broadcastResourceUpdate(updateType, message, files = []) {
        return this.sendMessage('broadcast_resource_update', { updateType, message, files });
    }

    // Chat system methods
    async getPersonaSettings() {
        return this.sendMessage('get_persona_settings', {}, false); // Background operation
    }

    async savePersonaSettings(settings) {
        return this.sendMessage('save_persona_settings', { settings });
    }

    async createChatSession(sessionData) {
        return this.sendMessage('create_chat_session', sessionData);
    }

    async getChatSessions(filename = null) {
        return this.sendMessage('get_chat_sessions', { filename });
    }

    async getChatSession(chatId) {
        return this.sendMessage('get_chat_session', { chatId });
    }

    async deleteChatSession(chatId) {
        return this.sendMessage('delete_chat_session', { chatId });
    }

    async restartChatSession(chatId) {
        return this.sendMessage('restart_chat_session', { chatId });
    }

    async sendChatMessage(chatId, message) {
        return this.sendMessage('send_chat_message', { chatId, message });
    }

    async getChatMessages(chatId, limit = 50, offset = 0) {
        return this.sendMessage('get_chat_messages', { chatId, limit, offset });
    }

    async deleteChatMessage(messageId) {
        return this.sendMessage('delete_chat_message', { messageId });
    }

    // Cancel generation method
    async cancelGeneration() {
        return this.sendMessage('cancel_generation', {});
    }

    // IP Management methods
    async getBlockedIPs(page = 1, limit = 15) {
        return this.sendMessage('get_blocked_ips', { page, limit });
    }

    async unblockIP(ip) {
        return this.sendMessage('unblock_ip', { ip });
    }

    async exportIPToGateway(ip) {
        return this.sendMessage('export_ip_to_gateway', { ip });
    }

    async getIPBlockingReasons(ip) {
        return this.sendMessage('get_ip_blocking_reasons', { ip }, false); // Background operation
    }

    // Wait for connection to be established with better validation
    async waitForConnection(timeout = 10000) {
        return new Promise((resolve, reject) => {
            const timeoutId = setTimeout(() => {
                reject(new Error('WebSocket connection timeout'));
            }, timeout);

            const checkConnection = () => {
                // Check if WebSocket is connected and in a stable state
                if (this.isConnected() && this.getConnectionState() === 'connected') {
                    // Additional validation: ensure the connection has been established for at least 500ms
                    // This helps prevent race conditions where the connection appears ready but isn't fully established
                    setTimeout(() => {
                        if (this.isConnected() && this.getConnectionState() === 'connected') {
                            clearTimeout(timeoutId);
                            resolve(true);
                        } else {
                            // Connection was lost during the stability check
                            reject(new Error('WebSocket connection unstable'));
                        }
                    }, 500);
                } else {
                    setTimeout(checkConnection, 100);
                }
            };

            checkConnection();
        });
    }

    // Send ack-less message (no response expected)
    sendAcklessMessage(type, data = {}) {
        // Enhanced connection validation
        if (!this.isConnectionHealthy()) {
            throw new Error('WebSocket connection not healthy');
        }

        const message = {
            type,
            ...data
        };

        try {
            this.send(message);
        } catch (error) {
            console.error('Failed to send ack-less message:', error);
            throw error;
        }
    }

    /**
     * Sends a message to the server and waits for a response
     *
     * Creates a unique request ID, stores the request in the pending queue,
     * and returns a Promise that resolves when the server responds with
     * a matching request ID.
     *
     * @param {string} type - The message type/command to send
     * @param {Object} [data={}] - Additional data to send with the message
     * @param {boolean} [showBanner=true] - Whether to show UI banner for this request
     * @returns {Promise<Object>} Response data from the server
     * @throws {Error} If WebSocket is not connected or request times out
     */
    sendMessage(type, data = {}, showBanner = true) {
        return new Promise((resolve, reject) => {
            // Enhanced connection validation
            if (!this.isConnectionHealthy()) {
                const error = new Error('WebSocket connection not healthy');
                error.code = 'CONNECTION_UNHEALTHY';
                reject(error);
                return;
            }

            // Ensure message listener is properly set up before sending
            if (!this.ws || typeof this.ws.onmessage !== 'function') {
                const error = new Error('WebSocket message listener not initialized');
                error.code = 'LISTENER_NOT_READY';
                console.error('❌ Attempted to send message before listener was ready:', {
                    type,
                    hasWebSocket: !!this.ws,
                    hasOnMessage: !!(this.ws && typeof this.ws.onmessage === 'function'),
                    connectionState: this.getConnectionState()
                });
                reject(error);
                return;
            }

            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const message = {
                type,
                requestId,
                ...data
            };

            // Ensure pendingRequests map is properly initialized
            if (!this.pendingRequests) {
                this.pendingRequests = new Map();
                console.log('🔄 Initialized pendingRequests map');
            }

            // Validate that the map is working properly
            if (!(this.pendingRequests instanceof Map)) {
                const error = new Error('pendingRequests is not a valid Map instance');
                error.code = 'INVALID_PENDING_REQUESTS';
                console.error('❌ pendingRequests corruption detected:', {
                    type: typeof this.pendingRequests,
                    constructor: this.pendingRequests?.constructor?.name,
                    hasSet: typeof this.pendingRequests?.set === 'function'
                });
                reject(error);
                return;
            }

            // Store pending request with timestamp
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                type,
                showBanner,
                timestamp: Date.now()
            });

            // Increment pending requests count
            this.incrementPendingRequests();

            // Set timeout based on request type BEFORE sending - critical requests should fail fast
            let timeoutMs = 60000; // Default 60 seconds

            // Critical initialization requests should fail fast if server is not ready
            if (message.type === 'get_app_options') {
                timeoutMs = WebSocketClient.TIMEOUT_GET_APP_OPTIONS;
            }

            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    const request = this.pendingRequests.get(requestId);
                    const requestAge = Date.now() - request.timestamp;

                    this.pendingRequests.delete(requestId);
                    this.decrementPendingRequests();

                    console.warn(`⚠️ Request timeout for ${message.type} (ID: ${requestId}) after ${requestAge}ms`);

                    // Log additional debugging information
                    console.warn(`🔍 Timeout details:`, {
                        requestType: message.type,
                        requestId: requestId,
                        connectionState: this.getConnectionState(),
                        pendingRequestsCount: this.pendingRequests.size,
                        totalPendingRequests: this.pendingRequestsCount,
                        messageSize: JSON.stringify(message).length,
                        expectedTimeout: timeoutMs
                    });

                    const timeoutError = new Error(`Request timeout after ${Math.round(requestAge / 1000)} seconds (${timeoutMs}ms expected)`);
                    timeoutError.code = 'REQUEST_TIMEOUT';
                    timeoutError.requestId = requestId;
                    timeoutError.requestType = message.type;
                    timeoutError.requestAge = requestAge;
                    reject(timeoutError);
                }
            }, timeoutMs);

            // Store timeout ID for cleanup
            this.pendingRequests.get(requestId).timeoutId = timeoutId;

            try {
                // Defer sending until next event loop tick to ensure request is fully registered
                // before any response can possibly arrive
                setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        this.send(message);
                    }
                }, 0);

                if (message.type === 'ping') {
                    return;
                }
            } catch (error) {
                this.pendingRequests.delete(requestId);
                this.decrementPendingRequests();
                reject(error);
            }
        });
    }

    // Send message with custom request ID and callback
    sendMessageWithCallback(type, data = {}, callback = null, showBanner = true) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                console.error('❌ WebSocket not connected - rejecting request:', {
                    type,
                    connectionState: this.getConnectionState(),
                    readyState: this.ws?.readyState,
                    pendingRequests: this.pendingRequests.size
                });
                reject(new Error('WebSocket not connected'));
                return;
            }

            const requestId = `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
            const message = {
                type,
                requestId,
                ...data
            };

            // Store pending request with callback
            this.pendingRequests = this.pendingRequests || new Map();
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                callback: callback || null,
                type,
                showBanner
            });

            // Increment pending requests count
            this.incrementPendingRequests();

            try {
                this.send(message);
            } catch (error) {
                this.pendingRequests.delete(requestId);
                this.decrementPendingRequests();
                reject(error);
            }
        });
    }

    // Send message with existing request ID (for responses to specific requests)
    sendMessageWithRequestId(type, requestId, data = {}, showBanner = true) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        return new Promise((resolve, reject) => {
            // Store the promise for later resolution
            if (!this.pendingRequests) {
                this.pendingRequests = new Map();
            }

            this.pendingRequests.set(requestId, { resolve, reject, type, showBanner });

            // Increment pending requests count
            this.incrementPendingRequests();

            const message = {
                type,
                requestId,
                ...data
            };

            this.send(message);
        });
    }

    // Set callback for a specific request ID
    setRequestCallback(requestId, callback) {
        this.requestCallbacks = this.requestCallbacks || new Map();
        this.requestCallbacks.set(requestId, callback);
    }

    // Remove callback for a specific request ID
    removeRequestCallback(requestId) {
        if (this.requestCallbacks) {
            this.requestCallbacks.delete(requestId);
        }
    }

    // Generate a unique request ID for custom use
    generateRequestId() {
        return `req_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
    }

    // 🎯 SINGLE SOURCE OF TRUTH for ALL ticker display logic
    updateTickerDisplay() {
        // Update ticker badge
        this.updateTickerBadge();

        if (this.pendingRequestsCount === 0) {
            // No pending requests - show check mark for 2 seconds then close
            const tickers = document.querySelectorAll('.websocket-ticker');
            const tickerIcons = document.querySelectorAll('.websocket-ticker-icon');

            if (tickers.length > 0 && tickerIcons.length > 0 && tickers[0].classList.contains('expanded')) {
                // Clear any existing completion timer
                if (this.completionTimer) {
                    clearTimeout(this.completionTimer);
                }

                // Just update the icon to check mark (keep existing text)
                tickerIcons.forEach(icon => {
                    icon.className = 'fas websocket-ticker-icon fa-check';
                });
                // Update status class for green color
                tickers.forEach(ticker => {
                    ticker.className = 'websocket-ticker expanded success';
                });

                // Set timer to hide after 2 seconds
                this.completionTimer = setTimeout(() => {
                    // Only hide if there are still no pending requests
                    if (this.pendingRequestsCount === 0) {
                        this.bannerManager.hideWebSocketTicker();
                        this.completionTimer = null;
                    }
                }, 2000);
            }
        } else {
            // Have pending requests - cancel any completion timer and show oldest request
            if (this.completionTimer) {
                clearTimeout(this.completionTimer);
                this.completionTimer = null;
            }
            this.showOldestPendingRequest();
        }
    }


    updatePendingRequestsSpinner() {
        this.updateTickerDisplay();
    }

    // Increment pending requests count
    incrementPendingRequests() {
        this.pendingRequestsCount++;
        this.updatePendingRequestsSpinner();
    }

    // Update ticker badge with current pending count
    updateTickerBadge() {
        const badges = document.querySelectorAll('.websocket-ticker-badge');
        badges.forEach(badge => {
            const count = this.pendingRequestsCount;
            badge.textContent = count > 0 ? count : '';
            badge.setAttribute('data-count', count);
        });
    }

    // Initialize WebSocket indicator elements
    initWebSocketIndicators() {
        // Clear existing indicators
        this.websocketIndicators = [];
        
        // Find all websocket indicator containers on the page
        const containers = document.querySelectorAll('.websocket-indicator');
        
        // Populate indicator array with elements from each container
        containers.forEach(container => {
            this.websocketIndicators.push({
                container: container,
                status: container.querySelector('.websocket-status'),
                upArrow: container.querySelector('.websocket-arrow-up'),
                downArrow: container.querySelector('.websocket-arrow-down'),
                upTimeout: null,
                downTimeout: null
            });
        });

        // Set initial status
        this.updateWebSocketStatus('disconnected');
    }

    // Refresh websocket indicators (useful if new indicators are added to DOM dynamically)
    refreshWebSocketIndicators() {
        // Clear any existing timeouts before refreshing
        this.clearWebSocketIndicatorTimeouts();
        
        // Determine current connection status
        const currentStatus = this.ws && this.ws.readyState === WebSocket.OPEN 
            ? 'connected' 
            : this.isConnecting 
            ? 'connecting' 
            : 'disconnected';
        
        // Clear existing indicators
        this.websocketIndicators = [];
        
        // Find all websocket indicator containers on the page
        const containers = document.querySelectorAll('.websocket-indicator');
        
        // Populate indicator array with elements from each container
        containers.forEach(container => {
            this.websocketIndicators.push({
                container: container,
                status: container.querySelector('.websocket-status'),
                upArrow: container.querySelector('.websocket-arrow-up'),
                downArrow: container.querySelector('.websocket-arrow-down'),
                upTimeout: null,
                downTimeout: null
            });
        });

        // Restore current status to all indicators
        this.updateWebSocketStatus(currentStatus);
        
        this.logInfo(`WebSocket indicators refreshed. Found ${this.websocketIndicators.length} indicator(s).`);
    }

    // Update WebSocket connection status for all indicators
    updateWebSocketStatus(status) {
        const statusClasses = {
            'connected': 'connected',
            'connecting': 'connecting',
            'disconnected': ''
        };

        const statusClass = statusClasses[status] || '';

        // Update all indicators
        this.websocketIndicators.forEach(indicator => {
            if (indicator.status) {
                indicator.status.className = `websocket-status ${statusClass}`;
            }
        });
    }

    // Flash WebSocket arrow for traffic indication with rapid activity support
    flashWebSocketArrow(direction, duration = 500) {
        const arrowType = direction === 'up' ? 'upArrow' : 'downArrow';
        const timeoutType = direction === 'up' ? 'upTimeout' : 'downTimeout';

        // Handle all indicators
        this.websocketIndicators.forEach(indicator => {
            const arrow = indicator[arrowType];
            if (!arrow) return;

            // Clear existing timeout if one is running (rapid activity handling)
            if (indicator[timeoutType]) {
                clearTimeout(indicator[timeoutType]);
            }

            // Force animation restart by removing and re-adding the class
            arrow.classList.remove('active');
            // Force reflow to ensure animation reset
            void arrow.offsetHeight;
            arrow.classList.add('active');

            // Set new timeout to remove active class after duration
            indicator[timeoutType] = setTimeout(() => {
                arrow.classList.remove('active');
                indicator[timeoutType] = null;
            }, duration);
        });
    }

    // Clear all WebSocket indicator timeouts (for cleanup)
    clearWebSocketIndicatorTimeouts() {
        // Clear all indicator timeouts and active classes
        this.websocketIndicators.forEach(indicator => {
            // Clear timeouts
            ['upTimeout', 'downTimeout'].forEach(timeoutType => {
                if (indicator[timeoutType]) {
                    clearTimeout(indicator[timeoutType]);
                    indicator[timeoutType] = null;
                }
            });

            // Remove active classes
            if (indicator.upArrow) {
                indicator.upArrow.classList.remove('active');
            }
            if (indicator.downArrow) {
                indicator.downArrow.classList.remove('active');
            }
        });
    }

    // Handle service worker messages
    handleServiceWorkerMessage(event) {
        if (event.data && event.data.type === 'NETWORK_ACTIVITY') {
            const { activityType, requestData } = event.data;

            // Flash the appropriate arrow based on activity type
            if (activityType === 'transmit') {
                this.flashWebSocketArrow('up', 300); // Shorter duration for service worker activity
            } else if (activityType === 'receive') {
                this.flashWebSocketArrow('down', 300); // Shorter duration for service worker activity
            }
        }
    }

    // Decrement pending requests count
    decrementPendingRequests() {
        if (this.pendingRequestsCount > 0) {
            this.pendingRequestsCount--;
            this.updatePendingRequestsSpinner();
        }
    }


    // Show the oldest pending request in the ticker (prioritizing showBanner requests)
    showOldestPendingRequest() {
        if (!this.pendingRequests || this.pendingRequests.size === 0) {
            return;
        }

        // Find the highest priority request (only showBanner: true requests)
        let selectedRequest = null;
        let selectedRequestId = null;

        for (const [requestId, request] of this.pendingRequests) {
            // Skip requests with showBanner: false
            if (request.showBanner === false) {
                continue;
            }

            if (!selectedRequest) {
                // First request with showBanner: true we find
                selectedRequest = request;
                selectedRequestId = requestId;
            } else if (request.showBanner && !selectedRequest.showBanner) {
                // This request has banner priority (showBanner: true) and current selected doesn't
                selectedRequest = request;
                selectedRequestId = requestId;
            }
            // If both have same priority, keep the first one (oldest)
        }

        if (!selectedRequest || !selectedRequest.type) {
            return;
        }

        // Format the request type for display
        const displayName = this.bannerManager.formatRequestType(selectedRequest.type);

        // Show in ticker with spinner
        this.bannerManager.showWebSocketTicker('info', displayName, 'fa-spinner fa-spin', false);
    }

    // Resolve pending request
    resolveRequest(requestId, data, error = null) {
        if (!this.pendingRequests) {
            console.warn(`⚠️ resolveRequest called but pendingRequests not initialized for ID: ${requestId}`);
            return;
        }

        if (this.pendingRequests.has(requestId)) {
            const request = this.pendingRequests.get(requestId);
            this.pendingRequests.delete(requestId);

            // Clear timeout safely
            request.timeoutId = this.clearTimeoutSafely(request.timeoutId);

            // Check if this was the currently displayed request BEFORE decrementing
            const oldestRequestId = this.pendingRequests.size > 0 ?
                this.pendingRequests.keys().next().value : null;
            const wasDisplayedRequest = requestId === oldestRequestId;

            // Decrement pending requests count
            this.decrementPendingRequests();

            // Handle completion display if this was the currently displayed request
            if (wasDisplayedRequest && request.type && request.showBanner !== false) {
                // Show completion with check mark for 2 seconds (only if showBanner is true)
                const displayName = this.bannerManager.formatRequestType(request.type);
                this.bannerManager.showWebSocketTicker('success', displayName, 'fa-check', true, 2000);

                // After completion display, update ticker to show next request or close
                setTimeout(() => {
                    this.updateTickerDisplay();
                }, 2100);
            } else {
                // For non-displayed requests or requests with showBanner=false, just update the ticker display
                this.updateTickerDisplay();
            }

            // Execute callback if provided
            if (request.callback && typeof request.callback === 'function') {
                try {
                    request.callback(data, error);
                } catch (callbackError) {
                    console.error(`❌ Error in request callback for ${requestId}:`, callbackError);
                }
            }

            // Also check for registered callbacks
            if (this.requestCallbacks && this.requestCallbacks.has(requestId)) {
                const callback = this.requestCallbacks.get(requestId);
                this.requestCallbacks.delete(requestId);
                try {
                    callback(data, error);
                } catch (callbackError) {
                    console.error(`❌ Error in registered callback for ${requestId}:`, callbackError);
                }
            }

            if (error) {
                request.reject(error);
            } else {
                request.resolve(data);
            }
        } else {
            console.warn(`⚠️ resolveRequest called for unknown request ID: ${requestId}`, {
                hasPendingRequests: !!this.pendingRequests,
                pendingRequestsCount: this.pendingRequests?.size || 0,
                data: !!data,
                error: !!error,
                timestamp: Date.now()
            });
        }
    }

    // Event listener registration
    on(event, handler) {
        if (!this.messageHandlers.has(event)) {
            this.messageHandlers.set(event, []);
        }
        this.messageHandlers.get(event).push(handler);
    }

    // Event listener removal
    off(event, handler) {
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
            const index = handlers.indexOf(handler);
            if (index > -1) {
                handlers.splice(index, 1);
            }
        }
    }

    triggerEvent(event, data) {
        const handlers = this.messageHandlers.get(event);
        if (handlers) {
            handlers.forEach(handler => {
                try {
                    handler(data);
                } catch (error) {
                    console.error(`❌ Error in event handler for ${event}:`, error);
                }
            });
        }
    }

    // Utility methods
    isConnected() {
        return this.ws && this.ws.readyState === WebSocket.OPEN;
    }

    // Check if the connection is healthy and ready for requests
    isConnectionHealthy() {
        return this.isConnected() &&
            this.getConnectionState() === 'connected' &&
            !this.isConnecting &&
            this.ws.readyState === WebSocket.OPEN;
    }

    getConnectionState() {
        if (!this.ws) return 'disconnected';
        switch (this.ws.readyState) {
            case WebSocket.CONNECTING: return 'connecting';
            case WebSocket.OPEN: return 'connected';
            case WebSocket.CLOSING: return 'closing';
            case WebSocket.CLOSED: return 'disconnected';
            default: return 'unknown';
        }
    }

    // Preset Group Management Methods

    // Save a preset group
    async savePresetGroup(groupName, groupData) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('save_preset_group', {
                groupName,
                groupData
            });
            return result;
        } catch (error) {
            console.error('Save preset group error:', error);
            throw error;
        }
    }

    // Delete a preset group
    async deletePresetGroup(groupName) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('delete_preset_group', {
                groupName
            });
            return result;
        } catch (error) {
            console.error('Delete preset group error:', error);
            throw error;
        }
    }

    // Get all preset groups
    async getPresetGroups() {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('get_preset_groups', {});
            return result;
        } catch (error) {
            console.error('Get preset groups error:', error);
            throw error;
        }
    }

    // Notes Management Methods

    // Create a new note
    async createNote(noteData) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_create', noteData);
            return result;
        } catch (error) {
            console.error('Create note error:', error);
            throw error;
        }
    }

    // Get a note by ID
    async getNote(noteId) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_get', { noteId });
            return result;
        } catch (error) {
            console.error('Get note error:', error);
            throw error;
        }
    }

    // Get notes by workspace
    async getNotesByWorkspace(workspaceId) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_get_by_workspace', { workspaceId });
            return result;
        } catch (error) {
            console.error('Get notes by workspace error:', error);
            throw error;
        }
    }

    // Get all notes
    async getAllNotes() {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_get_all', {});
            return result;
        } catch (error) {
            console.error('Get all notes error:', error);
            throw error;
        }
    }

    // Get all notes metadata (without content for performance)
    async getAllNotesMetadata() {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_get_all_metadata', {});
            return result;
        } catch (error) {
            console.error('Get all notes metadata error:', error);
            throw error;
        }
    }

    // Update a note
    async updateNote(noteId, updates) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_update', { noteId, updates });
            return result;
        } catch (error) {
            console.error('Update note error:', error);
            throw error;
        }
    }

    // Delete a note
    async deleteNote(noteId) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_delete', { noteId });
            return result;
        } catch (error) {
            console.error('Delete note error:', error);
            throw error;
        }
    }

    // Save note content
    async saveNoteContent(noteId, content) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            const result = await this.sendMessage('notes_save_content', { noteId, content });
            return result;
        } catch (error) {
            console.error('Save note content error:', error);
            throw error;
        }
    }
}

// Create global WebSocket instance
window.wsClient = new WebSocketClient();

// Export for module use
if (typeof module !== 'undefined' && module.exports) {
    module.exports = WebSocketClient;
} 