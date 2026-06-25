// Banner Manager for WebSocket Status and Updates
class BannerManager {
    constructor() {
        this.websocketToastId = null;
        this.init();
    }

    init() {
        // No initialization needed for glass toasts
    }

    showWebSocketToast(status, message, icon, autoHide = false, hideDelay = WebSocketClient.TIMEOUT_UI_DEFAULT, showProgress = false, progress = 0) {
        // If we already have a toast, update it instead of creating a new one
        if (this.websocketToastId && typeof updateGlassToastComplete === 'function') {
            this.updateWebSocketToast(status, message, icon, showProgress, progress);
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
                showProgress,
                autoHide ? hideDelay : false, // Only auto-hide if specified
                icon
            );
            if (showProgress && typeof updateGlassToastProgress === 'function') {
                updateGlassToastProgress(this.websocketToastId, progress);
            }
        }
    }

    updateWebSocketToast(status, message, icon, showProgress = false, progress = 0) {
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

        if (showProgress && typeof updateGlassToastProgress === 'function') {
            updateGlassToastProgress(this.websocketToastId, progress);
        }
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
            'expand_image': 'Expand Canvas',
            'preview_expand_image_prompt': 'Preview Expand Prompt',
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
            'search_tag_wiki': 'Search Grimoire',
            'get_tag_wiki_page': 'Get Grimoire Page',
            'refresh_tag_wiki_page': 'Update Grimoire',
            'get_wiki_home': 'Get Wiki Home',
            'get_static_wiki_site_index': 'Get Static Wiki Index',
            'get_static_wiki_page': 'Get Static Wiki Page',
            'get_nax_galleries': 'Get Datasets (NAX)',
            'get_nax_tags': 'Get Tags (NAX)',
            'get_nax_marked_tags': 'Get Marked Tags (NAX)',
            'get_nax_expander_presets': 'Get Expander Presets (NAX)',
            'set_nax_favorite': 'Set Favorite (NAX)',
            'set_nax_try': 'Set Try (NAX)',
            'set_nax_hidden': 'Hide Tag (NAX)',
            'get_user_global_settings': 'Get User Settings',
            'update_user_global_settings': 'Save User Settings',
            'get_nax_vibes_gallery': 'Browse Vibes',
            'clear_nax_vibes_gallery_cache': 'Refresh Browse Vibes Cache',
            'generate_nax_custom_tag': 'Create Custom Tag (NAX)',
            'delete_nax_custom_tag': 'Delete Custom Tag (NAX)',
            'fetch_autofill_wiki_previews': 'Fetch Wiki',
            'resolve_grimoire_url': 'Fetch GrURL',
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
            'gallery_position_hint': 'Gallery Position Hint',
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
            'desktop_create_empty_folder': 'Create Desktop Folder',
            'desktop_update_shortcut_folders': 'Move to Folder',
            'desktop_create_folder_from_selection': 'Create Folder',

            // VFS operations
            'vfs_list_directory': 'List Directory',
            'vfs_get_path_stats': 'Path Stats',
            'vfs_resolve_path': 'Resolve Path',
            'vfs_create_folder': 'Create Folder',
            'vfs_rename_folder': 'Rename Folder',
            'vfs_rename_file': 'Rename File',
            'vfs_rename_entry': 'Rename File',
            'vfs_rename_shortcut_entry': 'Rename File',
            'vfs_delete_folder': 'Delete Folder',
            'vfs_move_items': 'Move Items',
            'vfs_copy_items': 'Copy Items',
            'vfs_delete_entry': 'Delete Entry',
            'vfs_upload_file': 'Upload File',
            'vfs_replace_file': 'Replace File',
            'vfs_download_file': 'Download File',
            'vfs_delete_file': 'Delete File',
            'vfs_convert_reference_to_file': 'Convert Reference',
            'vfs_convert_file_to_reference': 'Convert to Reference',

            'get_text_replacement_options': 'Resolve Placeholder',
            'scan_text_replacements': 'Scan Expanders',
            'resolve_dynamic_context': 'Resolve Context',
            'resolve_text_replacements': 'Resolve Expanders',
            'compile_dynamic_generation': 'Compile to Prompts',
            'apply_tendai_preview': 'Apply Tendai',

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
            'import_vibe_from_url': 'Import Vibe from URL',
            'check_vibe_encoding': 'Check Vibe Encoding',

            // Cache and system operations
            'get_cache_manifest': 'Get Cache Manifest',
            'refresh_server_cache': 'Refresh Cache',
            'recompile_runtime_assets': 'Compile Application',
            'set_runtime_assets_auto_recompile': 'Set Auto-Recompile',
            'rebuild_metadata_cache': 'Rebuild Metadata Cache',
            'clear_search_cache': 'Clear Search Cache',
            'broadcast_resource_update': 'Update Resources',
            'ping': 'Ping Server',

            // App and settings operations
            'get_app_options': 'Get Settings',
            'get_generation_quips': 'Load Generation Quips',
            'get_generation_quips_status': 'Quips Status',
            'get_generation_quips_wiki': 'Quips Phrase Book',
            'generation_quips_run': 'Scan Generation Quips',
            'generation_quips_clear': 'Clear Workspace Quips',
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

            // Config editor operations
            'config_editor_list': 'List Config Keys',
            'config_editor_get_node': 'Get Config Node',
            'config_editor_save': 'Save Config',

            // Novel operations
            'novel_list': 'List Novels',
            'novel_get': 'Get Novel',
            'novel_update': 'Update Novel',
            'novel_generate': 'Generate Novel',
            'novel_undo': 'Undo Novel Edit',
            'novel_resolve_image': 'Resolve Novel Image',

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
            'request_gallery_paginated': 'Get Gallery',
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

    /** Outbound types excluded from ticker badge/cycle (like ping). */
    static SILENT_TICKER_REQUEST_TYPES = new Set([
        'ping',
        'get_generation_quips',
        'get_generation_quips_status',
        'get_generation_quips_wiki',
        'workspace_update_settings',
        'workspace_update_window_positions'
    ]);

    static GENERATION_QUIPS_MESSAGE_TYPES = new Set([
        'get_generation_quips',
        'get_generation_quips_status',
        'get_generation_quips_wiki',
        'generation_quips_run',
        'generation_quips_clear',
        'get_generation_quips_response',
        'get_generation_quips_status_response',
        'get_generation_quips_wiki_response',
        'generation_quips_run_response',
        'generation_quips_clear_response',
        'generation_quips_updated',
        'generation_quips_progress',
        'generation_quips_status'
    ]);

    static PROGRESS_INIT_BASE = 25; // Base progress percentage for initialization
    static PROGRESS_INIT_STEPS = 75; // Progress percentage allocated to init steps

    static CONNECTION_BEATS = {
        initializing: {
            message: 'Initializing…',
            minMs: 800,
            progress: 12
        },
        dialing: {
            message: 'Dialing…',
            minMs: 1000,
            progress: 32
        },
        negotiation: {
            message: 'Negotiation…',
            minMs: 500,
            progress: 52
        },
        establishing: {
            message: 'Establishing Session…',
            minMs: 500,
            progress: 72
        },
        connected: {
            message: 'Connected to server',
            minMs: 750,
            progress: 100
        }
    };

    /** Deterministic dial number from server hostname (FQDN). */
    static fqdnToDialNumber(fqdn) {
        const host = String(fqdn || window.location.hostname || 'localhost')
            .toLowerCase()
            .replace(/^www\./, '')
            .split(':')[0];
        let hash = 0;
        for (let i = 0; i < host.length; i++) {
            hash = ((hash << 5) - hash + host.charCodeAt(i)) | 0;
        }
        hash = Math.abs(hash);
        const area = 200 + (hash % 800);
        const prefix = 100 + ((hash >> 10) % 900);
        const line = hash % 10000;
        const pad = (n, w) => String(n).padStart(w, '0');
        return `1-${area}-${pad(prefix, 3)}-${pad(line, 4)}`;
    }

    /**
     * Creates a new WebSocket client instance
     *
     * Initializes all connection management, request tracking, and UI notification systems.
     * The client will automatically attempt to connect on initialization and handle
     * reconnections transparently.
     */
    constructor() {
        // Client version for compatibility checking
        this.clientVersion = '1.0.2'; // Update this when making breaking changes to client

        this.ws = null;
        this.reconnectAttempts = 0;
        this.updateCheckAttempted = false; // Track if update check has been attempted
        this.maxReconnectAttempts = WebSocketClient.ATTEMPTS_MAX_RECONNECT;
        this.reconnectDelay = WebSocketClient.DELAY_RECONNECT_INITIAL;
        this.maxReconnectDelay = WebSocketClient.DELAY_RECONNECT_MAX;
        this.isConnecting = false;
        this.isManualClose = false;
        this._reconnectTimer = null;
        this.circuitBreaker = false; // New: circuit breaker to prevent infinite retries
        this.lastConnectionAttempt = 0;
        this.connectionCooldown = WebSocketClient.DELAY_CONNECTION_COOLDOWN;
        this.connectionLock = false; // Prevent concurrent connection attempts
        this.pingInterval = null;
        this.pingTimeout = null;
        this.healthCheckInterval = null;

        // RTT (Round-Trip Time) tracking for dynamic timeout adjustment
        this.rttMeasurements = []; // Array of recent RTT measurements
        this.currentRtt = null; // Current average RTT
        this.minRtt = null; // Minimum observed RTT
        this.maxRtt = null; // Maximum observed RTT
        this.rttHistorySize = 10; // Number of recent measurements to keep
        this.pendingPings = new Map(); // Track ping requests with timestamps for RTT calculation
        this.rttVariability = null; // Standard deviation of recent RTT measurements
        this.pingWarningThreshold = 500; // Show warning if ping exceeds this (ms)
        this.pingVariabilityThreshold = 0.3; // Show warning if variability exceeds 30% of average

        this.progressToastId = null;
        /** After gallery handoff hideProgressNotification(); do not reopen startup modal or classic theme. */
        this.initStartupUiDismissed = false;
        /** Connection dial UI — single source of truth for connect/reconnect/failure dialog. */
        this.connectionPhase = 'idle'; // idle | dialing | failed | connected | auth
        this.connectionDialView = 'transient'; // transient | status
        this.preStartupHandoffCompleted = false;
        this.preStartupAuthBusy = false;
        this.preStartupAuthHandlersSetup = false;
        this.preStartupMarqueeManualPause = false;
        this.connectionUi = {
            beat: 'initializing',
            message: '',
            attempt: 0,
            maxAttempts: WebSocketClient.ATTEMPTS_MAX_RECONNECT
        };
        this.connectionStats = {
            messagesIn: 0,
            messagesOut: 0,
            connectedAt: null,
            dialNumber: WebSocketClient.fqdnToDialNumber(window.location.hostname)
        };
        this._wasPingWarning = false;
        this._latencyPopupDisplayed = false;
        this._initializingBeatComplete = false;
        this._connectionStatsTimer = null;
        this._melatonTrafficUp = null;
        this._melatonTrafficDown = null;
        this.messageHandlers = new Map();

        this.initSteps = [];
        this.currentInitStep = 0;
        this.totalInitSteps = 0;
        this.initializationCompleted = false; // Track if initialization has been completed
        this.initializationStarted = false; // Track if initialization has been started
        this.initializationLock = false; // Prevent concurrent initialization
        this.stepByStepMode = false; // Step-by-step mode (Shift key on startup)
        this.stepByStepPaused = false; // Whether we're waiting for user to advance step

        // Pending requests tracking
        this.pendingRequestsCount = 0;
        this.completionTimer = null;
        this.tickerCycleTimer = null;
        this.tickerCycleIndex = 0;

        // Completed requests tracking (last 10, excluding ping)
        this.completedRequests = [];
        this.maxCompletedRequests = 10;

        // Store handler reference for cleanup
        this.openRequestsModalHandler = () => this.openRequestsModal();

        // WebSocket indicator elements (dynamically populated array)
        this.websocketIndicators = [];
        /** Cached visible arrow elements for traffic flash (see _refreshWsFlashTargets). */
        this._wsFlashTargets = [];
        this._wsFlashPendingUp = null;
        this._wsFlashPendingDown = null;
        this._wsFlashRafId = null;
        this._wsFlashLastApply = 0;
        this._wsFlashMinInterval = 80;
        this._wsFlashVisibilityInterval = null;
        this._wsFlashVisibilityObserver = null;
        this._wsFlashVisibilityRefreshRaf = null;
        /** Server app ping overdue while socket still OPEN — flash green dot (see setPingResponseWaitingFlash). */
        this._pingResponseWaitingFlash = false;

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

        // Boot is triggered from serviceWorkerManager after SW registration — public/scripts/comp/serviceWorkerManager.js
    }

    async beginApplicationBoot() {
        // ensureBootComplete: public/scripts/comp/serviceWorkerManager.js
        if (window.serviceWorkerManager && typeof window.serviceWorkerManager.ensureBootComplete === 'function') {
            await window.serviceWorkerManager.ensureBootComplete();
        }
        return this.init();
    }

    _setConnectionPhase(phase, patch = {}) {
        this.connectionPhase = phase;
        if (patch.beat !== undefined) this.connectionUi.beat = patch.beat;
        if (patch.message !== undefined) this.connectionUi.message = patch.message;
        if (patch.attempt !== undefined) this.connectionUi.attempt = patch.attempt;
        if (patch.maxAttempts !== undefined) this.connectionUi.maxAttempts = patch.maxAttempts;
        this._renderConnectionDial();
        this._updateModemTrayIcon();
    }

    _setConnectionBeat(beat, patch = {}) {
        const beatDef = WebSocketClient.CONNECTION_BEATS[beat] || {};
        const merged = {
            beat,
            message: patch.message != null ? patch.message : beatDef.message,
            attempt: patch.attempt !== undefined ? patch.attempt : this.connectionUi.attempt,
            maxAttempts: patch.maxAttempts !== undefined ? patch.maxAttempts : this.connectionUi.maxAttempts
        };
        const phase = beat === 'connected' ? 'connected' : (this.connectionPhase === 'failed' ? 'failed' : 'dialing');
        this._setConnectionPhase(phase, merged);
    }

    async _runConnectionBeat(beat, patch = {}) {
        this._setConnectionBeat(beat, patch);
        const minMs = WebSocketClient.CONNECTION_BEATS[beat]?.minMs || 0;
        if (minMs > 0) {
            await new Promise(resolve => setTimeout(resolve, minMs));
        }
    }

    async _ensureBeatMinDuration(beat, startedAt) {
        const minMs = WebSocketClient.CONNECTION_BEATS[beat]?.minMs || 0;
        if (minMs <= 0) return;
        const elapsed = Date.now() - startedAt;
        if (elapsed < minMs) {
            await new Promise(resolve => setTimeout(resolve, minMs - elapsed));
        }
    }

    _resetConnectionStatsSession() {
        this.connectionStats.messagesIn = 0;
        this.connectionStats.messagesOut = 0;
        this.connectionStats.connectedAt = null;
    }

    isSilentTickerRequest(type) {
        return WebSocketClient.SILENT_TICKER_REQUEST_TYPES.has(type);
    }

    isSilentTickerMessage(type) {
        if (!type) return false;
        if (type === 'ping' || type === 'pong') return true;
        if (type === 'get_generation_quips_status' || type === 'get_generation_quips_status_response') {
            return true;
        }
        return false;
    }

    isGenerationQuipsMessage(message) {
        if (!message || !message.type) return false;
        return WebSocketClient.GENERATION_QUIPS_MESSAGE_TYPES.has(message.type)
            || message.type.includes('generation_quips');
    }

    logGenerationQuipsWs(direction, message, detail) {
        if (!this.isGenerationQuipsMessage(message)) return;
        const prefix = direction === 'out' ? '📤 [Quips]' : '📥 [Quips]';
        const payload = detail !== undefined ? detail : message.data;
        if (payload !== undefined) {
            console.log(`${prefix} ${message.type}`, payload);
        } else {
            console.log(`${prefix} ${message.type}`);
        }
    }

    _recordWsMessage(direction, message) {
        if (message && this.isSilentTickerMessage(message.type)) {
            return;
        }
        if (direction === 'out') {
            this.connectionStats.messagesOut++;
        } else {
            this.connectionStats.messagesIn++;
        }
        this._updateConnectionStatsDisplay();
    }

    formatConnectionUptime(ms) {
        const s = Math.floor(ms / 1000);
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const sec = s % 60;
        if (h > 0) {
            return `${h}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
        }
        return `${m}:${String(sec).padStart(2, '0')}`;
    }

    _isDesktopTrayMode() {
        return !!(window.isDesktop || document.body.classList.contains('desktop-mode'));
    }

    _shouldShowConnectionStats() {
        return this.connectionDialView === 'status' && this.isConnected();
    }

    _updateConnectionStatsDisplay() {
        const statsEl = document.getElementById('connectionDialStats');
        if (!statsEl) return;
        if (!this._shouldShowConnectionStats()) {
            statsEl.classList.add('hidden');
            return;
        }
        statsEl.classList.remove('hidden');
        const uptimeEl = document.getElementById('connectionDialStatUptime');
        const outEl = document.getElementById('connectionDialStatOut');
        const inEl = document.getElementById('connectionDialStatIn');
        const pingEl = document.getElementById('connectionDialStatPing');
        const varEl = document.getElementById('connectionDialStatVariability');
        const uptimeMs = this.connectionStats.connectedAt && this.isConnected()
            ? Date.now() - this.connectionStats.connectedAt
            : 0;
        if (uptimeEl) {
            uptimeEl.textContent = uptimeMs > 0 ? this.formatConnectionUptime(uptimeMs) : '—';
        }
        if (outEl) outEl.textContent = String(this.connectionStats.messagesOut);
        if (inEl) inEl.textContent = String(this.connectionStats.messagesIn);
        if (pingEl) {
            if (this.isConnected() && this.currentRtt !== null) {
                const roundedRtt = Math.round(this.currentRtt / 10) * 10;
                pingEl.textContent = `${roundedRtt}ms`;
            } else {
                pingEl.textContent = '—';
            }
        }
        if (varEl) {
            if (this.isConnected() && this.rttVariability !== null && this.currentRtt > 0) {
                const variabilityPercent = Math.round((this.rttVariability / this.currentRtt) * 100);
                varEl.textContent = `${variabilityPercent}%`;
            } else {
                varEl.textContent = '—';
            }
        }
    }

    _startConnectionStatsTimer() {
        this._stopConnectionStatsTimer();
        this._connectionStatsTimer = setInterval(() => {
            this._updateConnectionStatsDisplay();
            this._updateConnectionDialDetails();
            this._updateServiceWorkerTrayIcon();
            this._updateModemTrayIcon();
        }, 1000);
    }

    _stopConnectionStatsTimer() {
        if (this._connectionStatsTimer) {
            clearInterval(this._connectionStatsTimer);
            this._connectionStatsTimer = null;
        }
    }

    openConnectionDialStatus() {
        this.connectionDialView = 'status';
        if (this.connectionPhase === 'failed') {
            this._renderConnectionDial();
        } else if (this.isConnected()) {
            this._setConnectionBeat('connected');
        } else if (this.connectionPhase === 'idle') {
            this._setConnectionPhase('failed', {
                message: 'NO CARRIER — Not connected to server.'
            });
        } else {
            this._setConnectionBeat(this.connectionUi.beat || 'dialing');
        }
        this._updateConnectionDialDetails();
        this._updateServiceWorkerTrayIcon();
        this._startConnectionStatsTimer();
    }

    /**
     * User-initiated disconnect from the network status dialog.
     * Keeps the dial modal open, shows reconnect UI, and auto-redials.
     */
    _userDisconnectFromDialog() {
        this.connectionDialView = 'transient';
        this._stopConnectionStatsTimer();
        this.isManualClose = false;
        this.reconnectAttempts = 0;
        this.reconnectDelay = 1000;
        this.circuitBreaker = false;
        this.lastConnectionAttempt = 0;
        this.isConnecting = false;
        this.connectionLock = false;

        this.disconnect(false);

        this._setConnectionPhase('failed', {
            message: 'NO CARRIER — Disconnected from server.'
        });

        this.reconnect();
    }

    closeConnectionDialStatus() {
        this.connectionDialView = 'transient';
        this._stopConnectionStatsTimer();
        const modal = document.getElementById('connectionDialModal');
        if (modal && !modal.classList.contains('hidden') && typeof closeModal === 'function') {
            closeModal(modal);
        } else if (modal) {
            modal.classList.add('hidden');
        }
        if (!this.isConnected() && this.connectionPhase !== 'failed') {
            this._setConnectionPhase('idle');
        }
    }

    async _completeConnectionDialHandoff() {
        if (this.connectionDialView === 'status') {
            this._setConnectionBeat('connected');
            this._updateConnectionDialDetails();
            this._updateServiceWorkerTrayIcon();
            return;
        }
        if (window.isDesktop && this.preStartupHandoffCompleted && !this.initializationCompleted) {
            this.bannerManager.showWebSocketTicker('connected', 'Connected to Server', 'fa-phone', true, 3000);
            this.updateWebSocketStatus('connected');
            this._setConnectionPhase('idle');
            return;
        }
        await this._runConnectionBeat('connected');
        this.bannerManager.showWebSocketTicker('connected', 'Connected to Server', 'fa-phone', true, 3000);
        this.updateWebSocketStatus('connected');
        this._setConnectionPhase('idle');
    }

    _getConnectionUsername() {
        try {
            const raw = localStorage.getItem('userData');
            if (raw) {
                const data = JSON.parse(raw);
                if (data?.name) return data.name;
                if (data?.username) return data.username;
            }
        } catch (e) { /* ignore */ }
        const userType = localStorage.getItem('userType');
        if (userType === 'admin') return 'Administrator';
        if (userType === 'readonly') return 'Read-only';
        if (userType) return userType;
        return '—';
    }

    _getConnectionEncryptionLabel() {
        if (window.location.protocol === 'https:') {
            return 'TLS (HTTPS)';
        }
        return 'None (HTTP)';
    }

    _updateConnectionDialDetails() {
        const phoneEl = document.getElementById('connectionDialDetailPhone');
        const serverEl = document.getElementById('connectionDialDetailServer');
        const encryptionEl = document.getElementById('connectionDialDetailEncryption');
        const usernameEl = document.getElementById('connectionDialDetailUsername');
        if (!phoneEl || !serverEl || !encryptionEl || !usernameEl) return;

        phoneEl.textContent = this.connectionStats.dialNumber || '—';
        serverEl.textContent = window.location.hostname || '—';
        encryptionEl.textContent = this._getConnectionEncryptionLabel();
        usernameEl.textContent = this._getConnectionUsername();
    }

    _updateConnectionDialProgress(beat, phase) {
        const wrapEl = document.getElementById('connectionDialProgressWrap');
        const barEl = document.getElementById('connectionDialProgressBar');
        const fillEl = document.getElementById('connectionDialProgressFill');
        if (!wrapEl || !barEl || !fillEl) return;

        const progressBeats = new Set(['initializing', 'dialing', 'negotiation', 'establishing']);
        const isTasking = progressBeats.has(beat) && phase !== 'failed' && phase !== 'idle' && phase !== 'auth';

        if (!isTasking) {
            barEl.classList.add('hidden');
            return;
        }

        const beatDef = WebSocketClient.CONNECTION_BEATS[beat] || {};
        const progress = beatDef.progress != null ? beatDef.progress : 0;
        barEl.classList.remove('hidden');
        fillEl.style.width = `${progress}%`;
        barEl.setAttribute('aria-valuenow', String(progress));
    }

    _updateServiceWorkerTrayIcon() {
        const trayIcon = document.getElementById('serviceWorkerTrayIcon');
        const glyph = document.getElementById('serviceWorkerTrayIconGlyph');
        if (!trayIcon || !glyph) return;

        let swStatus = {
            available: false,
            isResponding: false,
            heartbeatMissed: false,
            timeSinceLastPingResponse: null,
            isUpdating: false,
            updateProgress: 0,
            updateAvailable: false
        };
        if (window.serviceWorkerManager) {
            swStatus = window.serviceWorkerManager.getServiceWorkerHeartbeatStatus();
            swStatus.isUpdating = Boolean(window.serviceWorkerManager.isUpdating);
            swStatus.updateProgress = Number.isFinite(window.serviceWorkerManager.updateProgress) ? window.serviceWorkerManager.updateProgress : 0;
            swStatus.updateAvailable = Boolean(
                window.serviceWorkerManager.hasPendingUpdates() || window.serviceWorkerManager.updateAvailable
            );
        }

        let iconClass = 'fas fa-hard-drive';
        let title = 'Service Worker: Active';
        trayIcon.classList.remove(
            'sw-unavailable',
            'sw-heartbeat-missed',
            'sw-update-downloading',
            'sw-update-complete'
        );

        if (!swStatus.available) {
            iconClass = 'fas fa-times-circle';
            title = 'Service Worker: Unavailable';
            trayIcon.classList.add('sw-unavailable');
        } else if (!swStatus.isResponding || swStatus.heartbeatMissed) {
            iconClass = 'fas fa-exclamation-triangle';
            title = 'Service Worker: Not Responding';
            trayIcon.classList.add('sw-heartbeat-missed');
        } else if (swStatus.isUpdating) {
            iconClass = 'fa-regular fa-laptop-arrow-down';
            trayIcon.classList.add('sw-update-downloading');
            const pct = Math.round(Math.max(0, Math.min(100, swStatus.updateProgress || 0)));
            title = `Service Worker: Updating (${pct}%)`;
        } else if (swStatus.updateAvailable) {
            // Updates are downloaded and pending restart.
            iconClass = 'fa-regular fa-laptop-arrow-down';
            trayIcon.classList.add('sw-update-complete');
            title = 'Service Worker: Update ready (restart to apply)';
        }

        glyph.className = iconClass;
        trayIcon.setAttribute('title', title);
    }

    _updateModemTrayIcon() {
        const icon = document.getElementById('modemTrayIcon');
        const glyph = document.getElementById('modemTrayIconGlyph');
        if (!icon || !glyph) return;

        let title = 'Melaton Network Connection';

        if (this.isConnected()) {
            glyph.className = 'fa-regular fa-globe';
            const uptimeMs = this.connectionStats.connectedAt
                ? Date.now() - this.connectionStats.connectedAt
                : 0;
            title = uptimeMs > 0
                ? `Melaton Network: Connected (${this.formatConnectionUptime(uptimeMs)})`
                : 'Melaton Network: Connected';
        } else {
            glyph.className = 'fas fa-phone-slash';
            if (this.connectionPhase === 'failed') {
                title = 'Melaton Network: NO CARRIER';
            } else if (this.connectionPhase === 'dialing' || this.isConnecting) {
                title = `Melaton Network: ${this.connectionUi.message || 'Dialing…'}`;
            } else {
                title = 'Melaton Network: Not connected';
            }
        }

        icon.setAttribute('title', title);
    }

    _showLatencyTrayPopup(reason) {
        const message = reason || 'High latency detected on the network link.';
        if (typeof showGlassToast !== 'function') return;

        if (this._isDesktopTrayMode()) {
            const bootPending = typeof window.isDesktopTrayBootPending === 'function' && window.isDesktopTrayBootPending();
            if (!bootPending) {
                showGlassToast(
                    'warning',
                    'High Latency Detected',
                    message,
                    false,
                    8000,
                    '<i class="fas fa-satellite"></i>'
                );
            }
            return;
        }

        showGlassToast(
            'warning',
            'High Latency Detected',
            message,
            false,
            8000,
            '<i class="fas fa-satellite"></i>',
            [{
                text: 'View Connection',
                onClick: () => {
                    this.openConnectionDialStatus();
                }
            }]
        );
    }

    _updateMelatonLinkIndicators() {
        this._updateServiceWorkerTrayIcon();
    }

    _setupConnectionDialModalHandlers() {
        if (this.connectionDialHandlersSetup) return;
        this.connectionDialHandlersSetup = true;

        const redialBtn = document.getElementById('connectionDialRedialBtn');
        const reloadBtn = document.getElementById('connectionDialReloadBtn');
        const forceBtn = document.getElementById('connectionDialDisconnectBtn');
        const closeBtn = document.querySelector('.connection-dial-close-btn');

        if (redialBtn) {
            redialBtn.addEventListener('click', () => {
                this.manualReconnect();
            });
        }
        if (reloadBtn) {
            reloadBtn.addEventListener('click', () => {
                location.reload();
            });
        }
        if (forceBtn) {
            forceBtn.addEventListener('click', () => {
                this._userDisconnectFromDialog();
            });
        }
        if (closeBtn) {
            closeBtn.addEventListener('click', () => {
                this.closeConnectionDialStatus();
            });
        }

        const modemTray = document.getElementById('modemTrayIcon');
        if (modemTray) {
            modemTray.addEventListener('click', () => {
                this.openConnectionDialStatus();
            });
        }
    }

    _shouldUsePreStartupDialog() {
        return Boolean(window.isDesktop && !this.preStartupHandoffCompleted && this.connectionDialView !== 'status');
    }

    _shouldUseConnectivityErrorInsteadOfConnectionDial() {
        if (!window.isDesktop) return false;
        if (this.connectionPhase !== 'failed') return false;
        if (this.connectionDialView === 'status') return false;
        if (!this.circuitBreaker) return false;
        if (this._shouldUsePreStartupDialog()) return true;
        return Boolean(this.preStartupHandoffCompleted);
    }

    _presentConnectivityFailure() {
        const message = this.connectionUi.message || 'NO CARRIER — Connection failed';
        const headline = this.preStartupHandoffCompleted && this.initializationCompleted
            ? 'Connection lost'
            : 'Could not connect';
        const summary = this.preStartupHandoffCompleted && this.initializationCompleted
            ? 'Dreamscape lost its connection to the server. Check your network and try again.'
            : 'Dreamscape could not reach the server. Check your connection and try again.';
        // presentDreamscapeConnectivityError: public/scripts/comp/fatalErrorBootstrap.js
        if (typeof presentDreamscapeConnectivityError === 'function') {
            const recoveryMode = this.initializationCompleted ? 'retry' : 'reload';
            presentDreamscapeConnectivityError(headline, summary, message, '', { recoveryMode: recoveryMode });
        }
    }

    _applyFailedConnectionSideEffects() {
        const ui = this.connectionUi;
        this.bannerManager.showWebSocketTicker(
            'error',
            ui.message || 'Server Not Responding',
            'fa-phone-missed',
            false
        );
        this.updateWebSocketStatus('disconnected');
        this._updateServiceWorkerTrayIcon();
    }

    _setupPreStartupModalHandlers() {
        if (this.preStartupAuthHandlersSetup) return;
        this.preStartupAuthHandlersSetup = true;

        const loginBtn = document.getElementById('desktopPreStartupLoginBtn');
        const passwordInput = document.getElementById('desktopPreStartupPassword');
        const usernameInput = document.getElementById('desktopPreStartupUsername');

        if (loginBtn) {
            loginBtn.addEventListener('click', () => {
                this._submitPreStartupCredentials();
            });
        }

        if (passwordInput) {
            passwordInput.addEventListener('keydown', (event) => {
                if (event.key === 'Enter') {
                    event.preventDefault();
                    this._submitPreStartupCredentials();
                }
            });
        }

        if (usernameInput) {
            usernameInput.addEventListener('focus', () => {
                usernameInput.select();
            });
        }

    }

    _updatePreStartupAuthError(message = '') {
        const errorEl = document.getElementById('desktopPreStartupAuthError');
        if (!errorEl) return;
        if (message) {
            errorEl.textContent = message;
            errorEl.classList.remove('hidden');
        } else {
            errorEl.textContent = '';
            errorEl.classList.add('hidden');
        }
    }

    _renderPreStartupDialog() {
        const modal = document.getElementById('desktopPreStartupModal');
        const statusEl = document.getElementById('desktopPreStartupStatus');
        const progressWrap = modal?.querySelector('.desktop-prestartup-progress');
        const authSection = document.getElementById('desktopPreStartupAuth');
        const usernameInput = document.getElementById('desktopPreStartupUsername');
        const passwordInput = document.getElementById('desktopPreStartupPassword');
        const loginBtn = document.getElementById('desktopPreStartupLoginBtn');

        if (!modal || !statusEl || !progressWrap) {
            console.warn('Pre-startup modal elements not found');
            return;
        }

        this._setupPreStartupModalHandlers();

        if (typeof openModal === 'function') {
            openModal(modal);
        } else {
            modal.classList.remove('hidden');
        }
        if (!modal.dataset.prestartupOpened) {
            this.preStartupMarqueeManualPause = false;
            modal.dataset.prestartupOpened = 'true';
        }

        const phase = this.connectionPhase;
        const beat = this.connectionUi.beat || 'initializing';
        const beatDef = WebSocketClient.CONNECTION_BEATS[beat] || {};
        const statusMessage = this.connectionUi.message || beatDef.message || 'Connecting...';
        const authVisible = phase === 'auth';
        const isTasking = phase !== 'failed'
            && phase !== 'auth'
            && phase !== 'idle'
            && (!this.preStartupHandoffCompleted || beat !== 'connected' || statusMessage === 'Preparing Melaton...')
            && !this.preStartupAuthBusy;
        const shouldPauseMarquee = !isTasking;

        statusEl.textContent = statusMessage;
        progressWrap.classList.toggle('paused', shouldPauseMarquee);
        modal.classList.toggle('auth-active', authVisible);

        if (authSection) {
            authSection.classList.toggle('hidden', !authVisible);
        }
        if (authVisible) {
            if (usernameInput && !usernameInput.value) {
                usernameInput.value = 'Administrator';
            }
            if (passwordInput && !this.preStartupAuthBusy && document.activeElement !== passwordInput) {
                passwordInput.focus();
            }
        } else {
            this._updatePreStartupAuthError('');
            if (passwordInput && !this.preStartupAuthBusy) {
                passwordInput.value = '';
            }
        }

        if (usernameInput) {
            usernameInput.readOnly = true;
            usernameInput.value = 'Administrator';
        }
        if (passwordInput) {
            passwordInput.disabled = !authVisible || this.preStartupAuthBusy;
        }
        if (loginBtn) {
            loginBtn.disabled = !authVisible || this.preStartupAuthBusy;
            loginBtn.textContent = this.preStartupAuthBusy ? 'Please wait...' : 'OK';
        }
    }

    async _hidePreStartupDialog() {
        const modal = document.getElementById('desktopPreStartupModal');
        if (!modal || modal.classList.contains('hidden')) return;
        delete modal.dataset.prestartupOpened;
        if (typeof closeModal === 'function') {
            await closeModal(modal);
        } else {
            modal.classList.add('hidden');
        }
    }

    async _submitPreStartupCredentials() {
        if (this.preStartupAuthBusy) return;

        const usernameInput = document.getElementById('desktopPreStartupUsername');
        const passwordInput = document.getElementById('desktopPreStartupPassword');
        const username = usernameInput ? String(usernameInput.value || '').trim() : '';
        const password = passwordInput ? String(passwordInput.value || '') : '';

        if (username.toLowerCase() !== 'administrator') {
            this._updatePreStartupAuthError('Only the Administrator account can sign in during startup.');
            if (usernameInput) {
                usernameInput.value = 'Administrator';
                usernameInput.focus();
                usernameInput.select();
            }
            return;
        }
        if (!password) {
            this._updatePreStartupAuthError('Password is required.');
            if (passwordInput) {
                passwordInput.focus();
            }
            return;
        }

        this.preStartupAuthBusy = true;
        this._updatePreStartupAuthError('');
        this._setConnectionPhase('auth', {
            beat: 'establishing',
            message: 'Verifying credentials...'
        });

        try {
            const response = await fetch('/', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({
                    action: 'login',
                    data: { pin: password }
                })
            });
            const payload = await response.json();

            if (!response.ok) {
                throw new Error(payload?.error || 'Authentication failed.');
            }
            if (payload?.userType && payload.userType !== 'admin') {
                throw new Error('Administrator credentials are required.');
            }
            // syncAuthLocalStorageFromServer: public/scripts/comp/connectionManager.js
            syncAuthLocalStorageFromServer(payload);

            this._updatePreStartupAuthError('');
            if (passwordInput) {
                passwordInput.value = '';
            }
            this.preStartupAuthBusy = false;
            this.forceReconnect();
        } catch (error) {
            this.preStartupAuthBusy = false;
            this._updatePreStartupAuthError(error.message || 'Authentication failed.');
            this._setConnectionPhase('auth', {
                beat: 'establishing',
                message: 'Authentication required. Enter your password.'
            });
            if (passwordInput) {
                passwordInput.value = '';
                passwordInput.focus();
            }
        }
    }

    async _completePreStartupHandoff() {
        if (!this._shouldUsePreStartupDialog()) return;

        this.connectionUi.message = 'Preparing Melaton...';
        this._setConnectionPhase('connected', {
            beat: 'connected',
            message: 'Preparing Melaton...'
        });
        await new Promise((resolve) => setTimeout(resolve, 1000));
        await this._hidePreStartupDialog();
        await new Promise((resolve) => setTimeout(resolve, 750));
        this.preStartupHandoffCompleted = true;
    }

    _hideConnectionDialModal() {
        const modal = document.getElementById('connectionDialModal');
        if (!modal || modal.classList.contains('hidden')) {
            return;
        }
        if (typeof closeModal === 'function') {
            closeModal(modal);
        } else {
            modal.classList.add('hidden');
        }
    }

    _renderConnectionDialToast() {
        const phase = this.connectionPhase;
        const ui = this.connectionUi;
        const beat = ui.beat || 'initializing';
        const beatDef = WebSocketClient.CONNECTION_BEATS[beat] || {};
        const progress = beatDef.progress != null ? beatDef.progress : 0;

        this._hideConnectionDialModal();

        if (phase === 'idle') {
            this.bannerManager.hideWebSocketTicker();
            if (this.isConnected()) {
                this.updateWebSocketStatus('connected');
                if (!this.initializationCompleted) {
                    this._adoptConnectionToastForInitProgress();
                } else {
                    this.bannerManager.hideWebSocketToast();
                }
            } else {
                this.bannerManager.hideWebSocketToast();
                this.updateWebSocketStatus('disconnected');
            }
            return;
        }

        if (phase === 'auth') {
            this.bannerManager.hideWebSocketToast();
            this.bannerManager.showWebSocketToast(
                'error',
                ui.message || 'Authentication required',
                '<i class="fas fa-lock"></i>',
                false
            );
            this.updateWebSocketStatus('disconnected');
            return;
        }

        if (phase === 'failed') {
            this.bannerManager.hideWebSocketToast();
            this.bannerManager.showWebSocketToast(
                'error',
                ui.message || 'Server Not Responding',
                '<i class="fas fa-phone-missed"></i>',
                false
            );
            this.updateWebSocketStatus('disconnected');
            return;
        }

        let message = ui.message || beatDef.message || 'Connecting…';
        if (ui.attempt > 0) {
            message = `${message} (attempt ${ui.attempt} of ${ui.maxAttempts})`;
        }

        if (phase === 'connected') {
            const handoffToInit = !this.initializationCompleted;
            this.bannerManager.showWebSocketToast(
                handoffToInit ? 'connecting' : 'connected',
                message,
                handoffToInit
                    ? '<i class="fa-duotone fa-star-christmas"></i>'
                    : '<i class="fas fa-phone"></i>',
                !handoffToInit,
                WebSocketClient.TIMEOUT_UI_DEFAULT,
                true,
                handoffToInit ? 72 : 100
            );
            this.updateWebSocketStatus('connected');
            if (handoffToInit) {
                this._adoptConnectionToastForInitProgress();
            }
            return;
        }

        const icon = ui.attempt > 0
            ? '<i class="fas fa-sync-alt"></i>'
            : '<i class="fas fa-phone-arrow-up-right"></i>';
        this.bannerManager.showWebSocketToast(
            'connecting',
            message,
            icon,
            false,
            WebSocketClient.TIMEOUT_UI_DEFAULT,
            true,
            progress
        );
        this.updateWebSocketStatus('connecting');
    }

    _renderConnectionDial() {
        const phase = this.connectionPhase;

        if (phase !== 'failed' && typeof dismissDreamscapeConnectivityError === 'function') {
            // dismissDreamscapeConnectivityError: public/scripts/comp/fatalErrorBootstrap.js
            dismissDreamscapeConnectivityError();
        }

        if (this._shouldUsePreStartupDialog()) {
            if (phase === 'failed' && this._shouldUseConnectivityErrorInsteadOfConnectionDial()) {
                this._presentConnectivityFailure();
                this._applyFailedConnectionSideEffects();
                return;
            }
            this._renderPreStartupDialog();
            return;
        }

        if (!window.isDesktop && this.connectionDialView !== 'status') {
            this._renderConnectionDialToast();
            return;
        }

        const modal = document.getElementById('connectionDialModal');
        const statusEl = document.getElementById('connectionDialStatus');
        const attemptEl = document.getElementById('connectionDialAttempt');
        const actionsEl = document.getElementById('connectionDialActions');
        const statusActionsEl = document.getElementById('connectionDialStatusActions');
        const statsEl = document.getElementById('connectionDialStats');
        const closeBtn = modal?.querySelector('.connection-dial-close-btn');

        if (!modal || !statusEl) {
            console.warn('Connection dial modal elements not found');
            return;
        }

        this._setupConnectionDialModalHandlers();

        const ui = this.connectionUi;
        const beat = ui.beat || 'initializing';
        const beatDef = WebSocketClient.CONNECTION_BEATS[beat] || {};

        modal.classList.remove('dialing', 'failed', 'connected-beat', 'status-view');
        if (this.connectionDialView === 'status') {
            modal.classList.add('status-view');
        }

        const hideModal = async () => {
            if (modal.classList.contains('hidden')) return;
            this._stopConnectionStatsTimer();
            if (typeof closeModal === 'function') {
                await closeModal(modal);
            } else {
                modal.classList.add('hidden');
            }
        };

        if (phase === 'idle' || phase === 'auth') {
            if (this.connectionDialView !== 'status') {
                hideModal();
            }
            if (phase === 'auth') {
                this.bannerManager.showWebSocketTicker('error', 'Authentication Required', 'fa-lock', false);
                this.updateWebSocketStatus('disconnected');
            }
            return;
        }

        if (phase === 'failed' && this._shouldUseConnectivityErrorInsteadOfConnectionDial()) {
            hideModal();
            this._presentConnectivityFailure();
            this._applyFailedConnectionSideEffects();
            return;
        }

        if (typeof openModal === 'function') {
            openModal(modal);
        } else {
            modal.classList.remove('hidden');
        }

        this._updateConnectionDialDetails();

        statusEl.textContent = ui.message || beatDef.message || 'Connecting…';
        this._updateConnectionDialProgress(beat, phase);

        if (phase === 'failed') {
            modal.classList.add('failed');
            if (attemptEl) attemptEl.classList.add('hidden');
            if (actionsEl) actionsEl.classList.remove('hidden');
            if (statusActionsEl) statusActionsEl.classList.add('hidden');
            if (statsEl) statsEl.classList.add('hidden');
            if (closeBtn) closeBtn.disabled = false;
            this._updateConnectionDialProgress(beat, phase);
            this._applyFailedConnectionSideEffects();
            return;
        }

        if (phase === 'connected') {
            modal.classList.add('connected-beat');
        } else {
            modal.classList.add('dialing');
        }

        if (attemptEl) {
            if (ui.attempt > 0) {
                attemptEl.textContent = `Redial attempt ${ui.attempt} of ${ui.maxAttempts}`;
                attemptEl.classList.remove('hidden');
            } else {
                attemptEl.textContent = '';
                attemptEl.classList.add('hidden');
            }
        }

        if (this.connectionDialView === 'status') {
            if (actionsEl) actionsEl.classList.add('hidden');
            if (statusActionsEl) statusActionsEl.classList.remove('hidden');
            if (this._shouldShowConnectionStats()) {
                if (statsEl) statsEl.classList.remove('hidden');
                this._updateConnectionStatsDisplay();
            } else if (statsEl) {
                statsEl.classList.add('hidden');
            }
            if (closeBtn) closeBtn.disabled = false;
        } else {
            if (actionsEl) actionsEl.classList.add('hidden');
            if (statusActionsEl) statusActionsEl.classList.add('hidden');
            if (statsEl) statsEl.classList.add('hidden');
            if (closeBtn) closeBtn.disabled = true;
        }

        const tickerMessage = ui.message || beatDef.message || 'Dialing…';
        this.bannerManager.showWebSocketTicker(
            phase === 'connected' ? 'connected' : 'connecting',
            tickerMessage,
            ui.attempt > 0 ? 'fa-sync-alt' : 'fa-phone-arrow-up-right',
            phase === 'connected',
            phase === 'connected' ? 3000 : false
        );
        this.updateWebSocketStatus(phase === 'connected' ? 'connected' : 'connecting');
        this._updateServiceWorkerTrayIcon();
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

    /**
     * Records a new RTT measurement and updates statistics
     * @param {number} rtt - Round-trip time in milliseconds
     */
    recordRtt(rtt) {
        if (rtt <= 0 || !isFinite(rtt)) {
            return; // Ignore invalid measurements
        }

        this.rttMeasurements.push(rtt);

        // Keep only recent measurements
        if (this.rttMeasurements.length > this.rttHistorySize) {
            this.rttMeasurements.shift();
        }

        // Update statistics
        const sum = this.rttMeasurements.reduce((a, b) => a + b, 0);
        this.currentRtt = sum / this.rttMeasurements.length;

        if (this.minRtt === null || rtt < this.minRtt) {
            this.minRtt = rtt;
        }
        if (this.maxRtt === null || rtt > this.maxRtt) {
            this.maxRtt = rtt;
        }

        // Calculate variability (standard deviation)
        if (this.rttMeasurements.length >= 3) {
            const variance = this.rttMeasurements.reduce((acc, val) => {
                return acc + Math.pow(val - this.currentRtt, 2);
            }, 0) / this.rttMeasurements.length;
            this.rttVariability = Math.sqrt(variance);
        } else {
            this.rttVariability = null;
        }

        // Update UI with ping information
        this.updatePingDisplay();
    }

    /**
     * Updates ping display in UI (tooltips and warning icon)
     */
    updatePingDisplay() {
        // Update tooltips on websocket indicators
        const pingText = this.getPingDisplayText();

        // Update all websocket status tooltips
        this.websocketIndicators.forEach(indicator => {
            if (indicator.status) {
                indicator.status.setAttribute('title', pingText);
            }
        });

        // Update ping warning tray icon
        this.updatePingWarningIcon();
        this._updateMelatonLinkIndicators();
        this._updateConnectionStatsDisplay();
    }

    /**
     * Gets formatted ping display text for tooltips
     * @returns {string} Formatted ping information
     */
    getPingDisplayText() {
        if (this.currentRtt === null) {
            return 'WebSocket Status\nPing: Measuring...';
        }

        const pingMs = Math.round(this.currentRtt);
        let text = `WebSocket Status\nPing: ${pingMs}ms`;

        if (this.minRtt !== null && this.maxRtt !== null) {
            text += `\nRange: ${Math.round(this.minRtt)}ms - ${Math.round(this.maxRtt)}ms`;
        }

        if (this.rttVariability !== null) {
            const variabilityPercent = Math.round((this.rttVariability / this.currentRtt) * 100);
            text += `\nVariability: ${variabilityPercent}%`;
        }

        return text;
    }

    /**
     * Updates the ping warning tray icon visibility and tooltip
     */
    updatePingWarningIcon(options = {}) {
        const warningIcon = document.getElementById('pingWarningIndicator');
        if (!warningIcon) return;

        const reveal = options.reveal !== false
            && !(window.isDesktop && typeof window.isDesktopTrayBootPending === 'function' && window.isDesktopTrayBootPending());
        const shouldShow = this.shouldShowPingWarning();

        if (shouldShow && reveal) {
            warningIcon.classList.remove('hidden');

            // Add appropriate classes based on warning type
            const isHighPing = this.currentRtt !== null && this.currentRtt > this.pingWarningThreshold;
            // Only consider variability warning if ping is above 250ms
            const isVariablePing = this.rttVariability !== null && this.currentRtt > 0 && this.currentRtt >= 250 &&
                (this.rttVariability / this.currentRtt) > this.pingVariabilityThreshold;

            // Remove existing state classes
            warningIcon.classList.remove('high-ping', 'variable-ping');

            // Add appropriate class
            if (isHighPing && isVariablePing) {
                warningIcon.classList.add('high-ping'); // High ping takes priority
            } else if (isHighPing) {
                warningIcon.classList.add('high-ping');
            } else if (isVariablePing) {
                warningIcon.classList.add('variable-ping');
            }

            const reason = this.getPingWarningReason();
            warningIcon.setAttribute('title', reason);
        } else {
            warningIcon.classList.add('hidden');
            warningIcon.classList.remove('high-ping', 'variable-ping');
        }

        if (shouldShow && !this._wasPingWarning) {
            const bootPending = window.isDesktop
                && typeof window.isDesktopTrayBootPending === 'function'
                && window.isDesktopTrayBootPending();
            if (!bootPending) {
                this._showLatencyTrayPopup(this.getPingWarningReason());
                this._latencyPopupDisplayed = true;
            }
        }
        this._wasPingWarning = shouldShow;
    }

    flushDeferredPingTrayNotification() {
        if (this._latencyPopupDisplayed || !this.shouldShowPingWarning()) return;
        this._showLatencyTrayPopup(this.getPingWarningReason());
        this._latencyPopupDisplayed = true;
    }

    /**
     * Determines if ping warning should be shown
     * @returns {boolean} True if warning should be shown
     */
    shouldShowPingWarning() {
        if (this.currentRtt === null || this.rttMeasurements.length < 3) {
            return false; // Not enough data yet
        }

        // Check for high ping
        if (this.currentRtt > this.pingWarningThreshold) {
            return true;
        }

        // Check for high variability (if variability is > 30% of average)
        // Only show variability warning if ping is above 250ms (variability is less concerning at low ping)
        if (this.rttVariability !== null && this.currentRtt > 0 && this.currentRtt >= 250) {
            const variabilityPercent = (this.rttVariability / this.currentRtt);
            if (variabilityPercent > this.pingVariabilityThreshold) {
                return true;
            }
        }

        return false;
    }

    /**
     * Gets the reason for ping warning
     * @returns {string} Warning message
     */
    getPingWarningReason() {
        if (this.currentRtt === null) {
            return 'Ping: Measuring...';
        }

        const reasons = [];

        if (this.currentRtt > this.pingWarningThreshold) {
            reasons.push(`High ping: ${Math.round(this.currentRtt)}ms`);
        }

        // Only show variability warning if ping is above 250ms
        if (this.rttVariability !== null && this.currentRtt > 0 && this.currentRtt >= 250) {
            const variabilityPercent = Math.round((this.rttVariability / this.currentRtt) * 100);
            if (variabilityPercent > this.pingVariabilityThreshold * 100) {
                reasons.push(`Variable ping: ${variabilityPercent}% variation`);
            }
        }

        if (reasons.length === 0) {
            return `Ping: ${Math.round(this.currentRtt)}ms`;
        }

        return reasons.join('\n');
    }

    /**
     * Calculates a dynamic timeout based on current RTT
     * Uses a multiplier to ensure timeouts are liberal enough for slow connections
     * @param {number} baseTimeout - Base timeout in milliseconds
     * @param {number} minMultiplier - Minimum multiplier (default: 3)
     * @param {number} maxMultiplier - Maximum multiplier (default: 10)
     * @returns {number} Adjusted timeout in milliseconds
     */
    calculateDynamicTimeout(baseTimeout, minMultiplier = 3, maxMultiplier = 10) {
        // If we don't have RTT data yet, use a conservative multiplier
        if (this.currentRtt === null || this.rttMeasurements.length === 0) {
            return baseTimeout * 5; // Use 5x multiplier until we have RTT data
        }

        // Calculate multiplier based on RTT
        // For slow connections (high RTT), use higher multiplier
        // For fast connections (low RTT), use lower multiplier
        const rttMultiplier = Math.max(
            minMultiplier,
            Math.min(maxMultiplier, this.currentRtt / 100) // Scale multiplier based on RTT (100ms = 1x, 500ms = 5x, etc.)
        );

        // Calculate timeout using RTT-based multiplier
        const dynamicTimeout = baseTimeout * rttMultiplier;

        // Ensure timeout is at least 30 seconds
        const minTimeout = 30000; // 30 seconds minimum
        const adjustedTimeout = Math.max(dynamicTimeout, minTimeout);

        // Cap at reasonable maximum (5 minutes)
        const maxTimeout = 300000;
        return Math.min(adjustedTimeout, maxTimeout);
    }

    /**
     * Gets the current effective timeout for a given base timeout
     * @param {number} baseTimeout - Base timeout in milliseconds
     * @returns {number} Effective timeout in milliseconds
     */
    getEffectiveTimeout(baseTimeout) {
        return this.calculateDynamicTimeout(baseTimeout);
    }

    // Ping host over HTTP before attempting WebSocket connection
    async pingHost() {
        const maxPingAttempts = WebSocketClient.ATTEMPTS_MAX_PING;
        const pingInterval = WebSocketClient.DELAY_PING_HOST;

        for (let attempt = 1; attempt <= maxPingAttempts; attempt++) {
            try {
                this._setConnectionBeat('dialing', {
                    message: `Dialing… (${attempt}/${maxPingAttempts})`
                });

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

                                            // Show version mismatch warning (boot gate owns update checks)
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
                                this._setConnectionBeat('dialing', {
                                    message: `${data.stageMessage}…`
                                });

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
    _adoptConnectionToastForInitProgress() {
        if (window.isDesktop || this.progressToastId) {
            return false;
        }
        if (!this.bannerManager.websocketToastId) {
            return false;
        }
        this.progressToastId = this.bannerManager.websocketToastId;
        return true;
    }

    async showProgressNotification(message = 'Connecting...', progress = 0) {
        if (typeof dismissLaunchHandoffIfNeeded === 'function') {
            await dismissLaunchHandoffIfNeeded();
        }
        if (window.isDesktop) {
            // Desktop mode: use Windows startup modal (clear any toast from before isDesktop flipped, e.g. auto layout)
            if (this.progressToastId && typeof removeGlassToast === 'function') {
                removeGlassToast(this.progressToastId);
                this.progressToastId = null;
            }
            this.showWindowsStartupModal(message, progress);
        } else {
            this._adoptConnectionToastForInitProgress();
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

    async hideProgressNotification() {
        if (this.progressToastId && typeof removeGlassToast === 'function') {
            removeGlassToast(this.progressToastId);
            if (this.bannerManager.websocketToastId === this.progressToastId) {
                this.bannerManager.websocketToastId = null;
            }
            this.progressToastId = null;
        }
        if (window.isDesktop) {
            await this.hideWindowsStartupModal();
        }
        document.body.classList.remove('initializing');
        this.initStartupUiDismissed = true;

        // Activate all deferred resize listeners after initialization is hidden
        if (typeof activateAllResizeListeners === 'function') {
            activateAllResizeListeners();
        }
    }

    _updateInitProgressToast(message, progress, addInitializingClass = false) {
        this._adoptConnectionToastForInitProgress();
        if (!this.progressToastId) {
            if (typeof showGlassToast === 'function') {
                this.progressToastId = showGlassToast(
                    'info',
                    'Dreamscape',
                    message,
                    true,
                    false,
                    '<i class="fa-duotone fa-star-christmas"></i>'
                );
                if (addInitializingClass) {
                    document.body.classList.add('initializing');
                }
            }
        }
        if (!this.progressToastId) return;

        if (typeof updateGlassToastComplete === 'function') {
            updateGlassToastComplete(this.progressToastId, {
                type: 'info',
                title: 'Dreamscape',
                message: message,
                customIcon: '<i class="fa-duotone fa-star-christmas"></i>'
            });
        }

        if (typeof updateGlassToastProgress === 'function') {
            updateGlassToastProgress(this.progressToastId, progress);
        }

        if (addInitializingClass) {
            document.body.classList.add('initializing');
        }
    }

    updateProgressNotification(message, progress) {
        // Post–gallery-handoff: use toast only — never reopen startup modal
        if (window.isDesktop && this.initStartupUiDismissed) {
            this._updateInitProgressToast(message, progress, false);
            return;
        }

        if (window.isDesktop) {
            const startupModal = document.getElementById('windowsStartupModal');
            const startupHidden = !startupModal || startupModal.classList.contains('hidden');
            if (this.progressToastId) {
                if (typeof removeGlassToast === 'function') {
                    removeGlassToast(this.progressToastId);
                }
                this.progressToastId = null;
                this.showWindowsStartupModal(message, progress);
            } else if (startupHidden) {
                this.showWindowsStartupModal(message, progress);
            } else {
                this.updateWindowsStartupModal(message, progress);
            }
        } else {
            this._updateInitProgressToast(message, progress, true);
        }
    }

    // Allow initialization steps to update their progress dynamically
    updateCurrentInitStepProgress(subProgress = 0) {
        if (this.currentInitStep > 0 && this.totalInitSteps > 0) {
            // Calculate base progress for current step
            const baseProgressForStep = WebSocketClient.PROGRESS_INIT_BASE +
                (((this.currentInitStep - 1) / this.totalInitSteps) * WebSocketClient.PROGRESS_INIT_STEPS);

            // Add sub-progress within this step (0-1 range expected)
            const stepRange = WebSocketClient.PROGRESS_INIT_STEPS / this.totalInitSteps;
            const totalProgress = baseProgressForStep + (subProgress * stepRange);

            // Get current step message
            const currentStep = this.initSteps[this.currentInitStep - 1];
            if (currentStep) {
                this.updateProgressNotification(currentStep.message, Math.min(totalProgress, 100));
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

        // Top-left corner layout (#windowsStartupModal CSS); skip center clamp / pixel-settle — modalUtils.js
        modal.dataset.windowPositionMode = 'manual-only';
        modal.dataset.windowRestorePosition = 'false';
        clearModalPixelAnchor(modal);
        modal.style.setProperty('--modal-offset-x', '20px');
        modal.style.setProperty('--modal-offset-y', '20px');

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

        if (document.body.classList.contains('windows-startup') && typeof setActiveWindow === 'function') {
            setActiveWindow('windowsStartupModal');
        }

        // Update button visibility when progress updates
        this.updateStepByStepButton();
    }

    async hideWindowsStartupModal() {
        if (!window.isDesktop) return;

        const modal = document.getElementById('windowsStartupModal');
        if (modal) {
            // clearModalPixelAnchor — modalUtils.js (corner modal; do not use center-based revert)
            clearModalPixelAnchor(modal);
            // Use normal modal closing process; wait so body background stays in sync with close animation
            if (typeof closeModal === 'function') {
                await closeModal(modal);
            } else {
                modal.classList.add('hidden');
            }
        }

        // Remove startup background when boot splash is done (Aero already applied in loadWorkspaces)
        document.body.classList.remove('windows-startup');
        document.body.classList.remove('boot-from-launch');
        document.body.classList.remove('no-animation');
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

    showWindowsUpdateRestartPrompt(message = 'Updates have been installed. Restart is required.', mode = 'restart') {
        if (!window.isDesktop) return;

        const modal = document.getElementById('windowsUpdateModal');
        const statusElement = document.getElementById('windowsUpdateStatus');
        const progressBar = document.getElementById('windowsUpdateProgressBar');
        const skipBtn = document.getElementById('windowsUpdateSkipBtn');
        const restartActions = document.getElementById('windowsUpdateRestartActions');
        const restartBtn = document.getElementById('windowsUpdateRestartBtn');
        const progressContainer = modal?.querySelector('.windows-update-progress-container');

        if (!modal || !statusElement || !restartActions) return;

        if (modal.classList.contains('hidden')) {
            if (typeof openModal === 'function') {
                openModal(modal);
            } else {
                modal.classList.remove('hidden');
            }
        }

        // Hide progress container, show restart actions
        if (progressContainer) progressContainer.classList.add('hidden');
        if (restartActions) restartActions.classList.remove('hidden');
        if (skipBtn) skipBtn.style.display = 'none';
        if (progressBar) progressBar.style.width = '100%';
        if (restartBtn) {
            restartBtn.textContent = mode === 'apply' ? 'Apply Now' : 'Restart Now';
        }

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

    registerInitStep(priority, message, stepFunction, runOnReconnect = false, options = {}) {
        const nonBlocking = options && options.nonBlocking === true;
        // Check if step with same message already exists
        const existingStepIndex = this.initSteps.findIndex(step => step.message === message);
        if (existingStepIndex !== -1) {
            this.initSteps[existingStepIndex] = { priority, message, stepFunction, runOnReconnect, nonBlocking };
        } else {
            this.initSteps.push({ priority, message, stepFunction, runOnReconnect, nonBlocking });
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
            await this.hideProgressNotification();
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
            await this.hideProgressNotification();
            return;
        }

        this.currentInitStep = 0;
        this.totalInitSteps = this.initSteps.length;
        this.initStartupUiDismissed = false;

        try {
            for (const step of this.initSteps) {
                this.currentInitStep++;
                const stepSkipped = this.initializationCompleted && !step.runOnReconnect;
                // Calculate progress: base percentage + steps percentage
                const stepProgress = WebSocketClient.PROGRESS_INIT_BASE +
                    ((this.currentInitStep / this.totalInitSteps) * WebSocketClient.PROGRESS_INIT_STEPS);
                if (!step.nonBlocking) {
                    this.updateProgressNotification(step.message, stepProgress);
                }

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
                    // scripts/comp/fatalErrorBootstrap.js — presentDreamscapeApplicationError
                    presentDreamscapeApplicationError(
                        'Init step failed: ' + step.message,
                        error && error.message ? error.message : String(error),
                        error && error.stack ? error.stack : ''
                    );
                }
            }

            // Mark initialization as completed
            this.initializationCompleted = true;
            this.initializationLock = false; // Release initialization lock

            // Hide overlay after all steps complete
            setTimeout(async () => {
                await this.hideProgressNotification();
            }, 500);
        } catch (error) {
            console.error('❌ Error during initialization:', error);
            // scripts/comp/fatalErrorBootstrap.js — presentDreamscapeApplicationError
            presentDreamscapeApplicationError(
                'Initialization failed',
                error && error.message ? error.message : String(error),
                error && error.stack ? error.stack : ''
            );
            this.updateProgressNotification('Initialization failed', 100);
            this.initializationLock = false; // Release initialization lock on error
            setTimeout(async () => {
                await this.hideProgressNotification();
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
        // Prevent multiple initializations
        if (this.initializationStarted) {
            console.log('⚠️ WebSocket initialization already started, skipping');
            return;
        }
        this.initializationStarted = true;

        // Check for Shift key to enable step-by-step mode (desktop mode only)
        if (window.isDesktop && window.shiftKeyOnStartup) {
            this.stepByStepMode = true;
            console.log('🔍 Step-by-step mode enabled (Shift key detected on startup)');
        }

        // Connection dial UI (not the top-left startup loader)
        if (typeof dismissLaunchHandoffIfNeeded === 'function') {
            await dismissLaunchHandoffIfNeeded();
        }

        this._setupConnectionDialModalHandlers();
        this._updateServiceWorkerTrayIcon();

        if (document.readyState === 'loading') {
            await new Promise(resolve => document.addEventListener('DOMContentLoaded', resolve, { once: true }));
        }

        // Initialize pending requests spinner
        this.updatePendingRequestsSpinner();

        this.connect();

        // Handle page visibility changes (covers tab switching, app minimise, screen lock)
        document.addEventListener('visibilitychange', () => {
            if (document.visibilityState === 'visible') {
                this._refreshWsFlashTargets();
                this._reconnectOnFocusRegain('visibilitychange');
            } else {
                this._wsFlashPendingUp = null;
                this._wsFlashPendingDown = null;
                if (this._wsFlashRafId) {
                    cancelAnimationFrame(this._wsFlashRafId);
                    this._wsFlashRafId = null;
                }
            }
        });

        // Intentionally do nothing on beforeunload.
        // The event fires even when the browser leave/refresh prompt is cancelled.
        // Disconnecting here can leave the app offline until a manual reconnect.
        window.addEventListener('beforeunload', () => {});

        // Mark true manual close only when the page is actually leaving.
        window.addEventListener('pagehide', () => {
            this.isManualClose = true;
            this.disconnect();
        });

        // Handle window focus (covers alt-tab, clicking back into the window)
        window.addEventListener('focus', () => {
            this._reconnectOnFocusRegain('window-focus');
        });

        // Handle mobile browser lifecycle freeze/resume (Android Chrome, iOS Safari)
        window.addEventListener('resume', () => {
            this._reconnectOnFocusRegain('resume');
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
        if (this.isManualClose) {
            return;
        }

        // ensureBootComplete: public/scripts/comp/serviceWorkerManager.js
        if (window.serviceWorkerManager && typeof window.serviceWorkerManager.ensureBootComplete === 'function') {
            await window.serviceWorkerManager.ensureBootComplete();
        }

        this.initWebSocketIndicators();
        this.setupRequestsModalHandlers();

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
        this._resetConnectionStatsSession();

        if (!this._initializingBeatComplete) {
            await this._runConnectionBeat('initializing');
            this._initializingBeatComplete = true;
        }

        const dialingStart = Date.now();
        this._setConnectionBeat('dialing', {
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts
        });

        try {
            // Step 1: First ping the host over HTTP to ensure it's responsive
            try {
                await this.pingHost();
                await this._ensureBeatMinDuration('dialing', dialingStart);
                await this._runConnectionBeat('negotiation', {
                    attempt: this.reconnectAttempts,
                    maxAttempts: this.maxReconnectAttempts
                });
            } catch (pingError) {
                console.error('❌ Host availability check failed:', pingError.message);
                this.isConnecting = false;
                this.connectionLock = false; // Release connection lock on ping failure

                const failureMessage = this.circuitBreaker
                    ? (pingError.message || 'NO CARRIER — Server may be unavailable.')
                    : 'NO CARRIER — Server not responding';

                this._setConnectionPhase('failed', { message: failureMessage });

                if (!this.circuitBreaker && !this.isManualClose) {
                    setTimeout(() => {
                        this.reconnect();
                    }, 3000);
                }
                return;
            }

            // Step 3: Now attempt WebSocket connection
            const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
            const wsUrl = `${protocol}//${window.location.host}`;

            this.ws = new WebSocket(wsUrl);

            this.ws.onopen = async () => {
                this.isConnecting = false;
                this.connectionLock = false; // Release connection lock on success
                const isReconnection = this.initializationCompleted;
                this.reconnectAttempts = 0;
                this.reconnectDelay = 1000;
                this.circuitBreaker = false; // Reset circuit breaker on successful connection

                await this._runConnectionBeat('establishing', {
                    attempt: 0,
                    maxAttempts: this.maxReconnectAttempts
                });

                this.connectionStats.connectedAt = Date.now();

                // Trigger connection event
                this.triggerEvent('connected');

                // Start periodic pings to measure RTT and keep connection alive
                this.startPeriodicPings();

                // Sync workspace before refresh callbacks so gallery requests use the correct workspace
                if (isReconnection) {
                    const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace)
                        ? activeWorkspace
                        : (window.currentWorkspace || 'default');
                    try {
                        await this.setActiveWorkspace(workspaceId);
                    } catch (error) {
                        console.warn('⚠️ Failed to sync workspace on reconnect:', error.message);
                    }
                }

                // Trigger refresh callbacks on reconnection (not initial connection)
                if (isReconnection) {
                    try {
                        await this.executeRefreshCallbacks();
                        console.log('✅ Refresh callbacks triggered successfully');
                    } catch (error) {
                        console.error('❌ Error triggering refresh callbacks:', error);
                    }
                }

                // Boot gate owns update checks — proceed to init steps after handoff
                await this._completePreStartupHandoff();
                await this._completeConnectionDialHandoff();

                if (!this.initializationCompleted) {
                    // Complete any remaining initialization steps (includes authentication)
                    // Now with RTT data available for dynamic timeout adjustment
                    this.executeInitSteps();
                }
            };

            this.ws.onmessage = (event) => {
                try {
                    const message = JSON.parse(event.data);
                    this._recordWsMessage('in', message);
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
                this.connectionLock = false;
                this.connectionStats.connectedAt = null;

                // Stop periodic pings when connection is closed
                this.stopPeriodicPings();

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
                    // Intentional recycle (forceReconnect / manualReconnect): connect() is scheduled; no user-facing disconnect UI or auto-reconnect from this close.
                    if (event.code === 1000 && String(event.reason || '') === 'Manual disconnect') {
                        this.triggerEvent('disconnected', event);
                        return;
                    }

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

                    if (!this.circuitBreaker) {
                        this._setConnectionBeat('dialing', {
                            message: `${disconnectMessage}. Reconnecting…`,
                            attempt: this.reconnectAttempts,
                            maxAttempts: this.maxReconnectAttempts
                        });
                        this.reconnect();
                    } else {
                        this._setConnectionPhase('failed', {
                            message: `NO CARRIER — ${disconnectMessage}. Server may be unavailable.`
                        });
                    }
                }

                // Trigger disconnect event
                this.triggerEvent('disconnected', event);
            };

            this.ws.onerror = async (error) => {
                console.error('❌ WebSocket error:', error);
                this.isConnecting = false;
                this.connectionLock = false; // Release connection lock on error

                // Reset generation button state if generation was interrupted
                if (typeof updateManualGenerateBtnState === 'function') {
                    updateManualGenerateBtnState();
                }

                if (!this.isManualClose) {
                    let errorMessage = '';

                    if (error.target && error.target.readyState === WebSocket.CLOSED) {
                        errorMessage = 'Connection closed unexpectedly';
                    } else if (error.target && error.target.readyState === WebSocket.CONNECTING) {
                        errorMessage = 'Connection failed';
                    } else {
                        errorMessage = 'Network connection error';
                    }

                    if (this.circuitBreaker) {
                        errorMessage = `NO CARRIER — ${errorMessage}. Server unavailable.`;
                        this._setConnectionPhase('failed', { message: errorMessage });
                    } else if (this.reconnectAttempts >= this.maxReconnectAttempts) {
                        errorMessage = `NO CARRIER — ${errorMessage}. Max retry attempts reached.`;
                        this._setConnectionPhase('failed', { message: errorMessage });
                    } else {
                        this._setConnectionPhase('failed', {
                            message: `NO CARRIER — ${errorMessage}`
                        });
                    }
                }
            };

        } catch (error) {
            console.error('❌ Failed to create WebSocket connection:', error);
            this.isConnecting = false;
            this.connectionLock = false; // Release connection lock on exception
            this._setConnectionPhase('failed', {
                message: 'NO CARRIER — Connection failure'
            });
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
     *
     * @param {boolean} [markManualClose=true] - When false, the socket is torn down but automatic
     *   reconnection stays enabled (used when recycling the connection, e.g. after PIN auth).
     */
    disconnect(markManualClose = true) {
        if (markManualClose) {
            this.isManualClose = true;
        }
        this.connectionLock = false; // Release connection lock
        this.initializationLock = false; // Release initialization lock

        // Stop periodic pings
        this.stopPeriodicPings();

        // Reset RTT statistics on disconnect
        this.rttMeasurements = [];
        this.currentRtt = null;
        this.minRtt = null;
        this.maxRtt = null;
        this.pendingPings.clear();
        this.connectionStats.connectedAt = null;

        // Clear and fail all pending requests
        this.clearPendingRequests();

        // Clear any completion timer
        if (this.completionTimer) {
            clearTimeout(this.completionTimer);
            this.completionTimer = null;
        }

        // Clear WebSocket indicator timeouts
        this.clearWebSocketIndicatorTimeouts();

        this._stopWsFlashVisibilityWatcher();

        this._teardownGenerationUiState();

        if (this.ws) {
            this.ws.close(1000, 'Manual disconnect');
            this.ws = null;
        } else {
        }
    }

    /**
     * Stops automatic reconnection — used when the page will reload or close (DSS restart, client shutdown).
     */
    suppressAutoReconnect() {
        this.isManualClose = true;
        this.reconnectAttempts = 0;
        this.circuitBreaker = false;
        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
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
            this._setConnectionPhase('failed', {
                message: 'NO CARRIER — Connection failed after several attempts. Use Redial to reconnect.'
            });
            return;
        }

        const delay = Math.min(this.reconnectDelay * Math.pow(2, this.reconnectAttempts - 1), this.maxReconnectDelay);
        console.log(`🔌 Reconnecting in ${delay}ms (attempt ${this.reconnectAttempts}/${this.maxReconnectAttempts})`);

        this._setConnectionBeat('dialing', {
            message: `Redialing in ${Math.ceil(delay / 1000)}s…`,
            attempt: this.reconnectAttempts,
            maxAttempts: this.maxReconnectAttempts
        });

        if (this._reconnectTimer) {
            clearTimeout(this._reconnectTimer);
            this._reconnectTimer = null;
        }

        this._reconnectTimer = setTimeout(() => {
            this._reconnectTimer = null;
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
        this.disconnect(false);
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

        this._setConnectionBeat('dialing', {
            message: 'Redialing…',
            attempt: 0,
            maxAttempts: this.maxReconnectAttempts
        });

        // Full socket teardown before connect so the next session is clean (same as forceReconnect).
        this.disconnect(false);
        setTimeout(() => {
            this.connect();
        }, 100);
    }

    /**
     * Reconnects the WebSocket when the app regains focus/visibility.
     *
     * Resets the circuit breaker and reconnect counter so the user is never stuck
     * in a cooldown simply because they switched away from the app and back.
     * No-ops if the connection is already open or a connect attempt is in progress.
     *
     * @param {string} source - The event that triggered this call (for logging)
     */
    _reconnectOnFocusRegain(source) {
        // Already connected or actively connecting — nothing to do
        if (this.isConnected() || this.isConnecting || this.connectionLock) {
            return;
        }

        console.log(`👁️ App regained focus (${source}) — checking WebSocket...`);

        // If the page is actually being closed/navigated away, don't reconnect
        if (this.isManualClose) {
            return;
        }

        // Reset circuit breaker and retry counter: losing focus is not a failure on the
        // user's part, so we should reconnect eagerly when they return.
        if (this.circuitBreaker || this.reconnectAttempts > 0) {
            console.log('🔄 Resetting circuit breaker / reconnect attempts due to focus regain');
            this.circuitBreaker = false;
            this.reconnectAttempts = 0;
            this.lastConnectionAttempt = 0;
        }

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
        this.hideProgressNotification().catch(() => {});

        // Clear any pending initialization
        this.initializationCompleted = false;
        this.initializationLock = false;
        this.initSteps = [];

        // Clear banner manager resources
        if (this.bannerManager) {
            this.bannerManager.hideWebSocketToast();
            this.bannerManager.hideWebSocketTicker();
        }

        this._stopConnectionStatsTimer();
        this._setConnectionPhase('idle');

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
            nonBlocking: !!step.nonBlocking,
            completed: this.initializationCompleted
        }));
    }

    send(message) {
        if (this.ws && this.ws.readyState === WebSocket.OPEN) {
            this.logGenerationQuipsWs('out', message);
            this._recordWsMessage('out', message);
            this.ws.send(JSON.stringify(message));
            this.flashWebSocketArrow('up');
        } else {
            console.warn('⚠️ WebSocket not connected, message not sent:', message);
        }
    }

    handleMessage(message) {
        this.logGenerationQuipsWs('in', message);

        if (message.type === 'connection') {
            // syncAuthLocalStorageFromServer: public/scripts/comp/connectionManager.js
            syncAuthLocalStorageFromServer(message);
            return;
        }

        // Handle pong responses with requestId for authentication checking
        if (message.type === 'pong') {
            if (message.vfsPathUuid && typeof bootstrapVfsPathUuidFromOptions === 'function') {
                bootstrapVfsPathUuidFromOptions(message);
            }
            if (message.requestId) {
                // Calculate RTT if we have the ping timestamp
                if (this.pendingPings.has(message.requestId)) {
                    const pingTimestamp = this.pendingPings.get(message.requestId);
                    const rtt = Date.now() - pingTimestamp;
                    this.recordRtt(rtt);
                    this.pendingPings.delete(message.requestId);
                }

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

            this.clearStreamingStepQueues(null, true);
            if (this.progressStates && message.requestId) {
                this.cleanupGenerationProgressState(message.requestId);
            }
            if (typeof progressToastId !== 'undefined' && progressToastId && typeof clearGlassToastImagePreview === 'function') {
                clearGlassToastImagePreview(progressToastId);
            }

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

            if (typeof setGenerationPreviewForegroundLinesActive === 'function') {
                setGenerationPreviewForegroundLinesActive(false);
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
            if (message.data?.success) {
                const successMessage = message.data.message || `Server cache refreshed successfully. ${message.data.assetsCount || 0} assets updated.`;

                if (typeof showGlassToast === 'function') {
                    showGlassToast('success', 'Cache Refreshed', successMessage, false, 5000, '<i class="fas fa-sync"></i>');
                }
            } else {
                const errorMessage = message.data?.error || message.data?.message || message.error || 'Failed to refresh server cache';

                if (typeof showGlassToast === 'function') {
                    showGlassToast('error', 'Cache Refresh Failed', errorMessage, false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
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

        // Handle service worker cache manifest push (same data as OPTIONS / update check)
        if (message.type === 'service_worker_cache_update') {
            const files = message.data && Array.isArray(message.data.files) ? message.data.files : [];
            const silent = message.data && message.data.silent === true;
            const cacheOptions = {
                runtimeAssetsRecompiled: message.data && message.data.runtimeAssetsRecompiled === true
            };

            // Queue until boot gate completes — public/scripts/comp/serviceWorkerManager.js
            if (window.serviceWorkerManager && !window.serviceWorkerManager.isBootComplete()) {
                window.serviceWorkerManager.queueCacheUpdateUntilBoot(files, silent, cacheOptions);
                return;
            }

            if (files.length > 0 && window.serviceWorkerManager && typeof window.serviceWorkerManager.updateStaticCache === 'function') {
                window.serviceWorkerManager.updateStaticCache(files, silent, cacheOptions);
            } else if (!silent && window.serviceWorkerManager && typeof window.serviceWorkerManager.checkStaticFileUpdates === 'function') {
                window.serviceWorkerManager.checkStaticFileUpdates(silent);
            }
            return;
        }

        if (message.type === 'workspace_css_updated') {
            const data = message.data || {};
            const webPath = data.webPath || '/css/workspaces.css';
            const hash = data.hash || data.sourceHash;
            if (!hash) {
                return;
            }
            if (window.serviceWorkerManager) {
                window.serviceWorkerManager.cacheStaticFilesSilent([{ url: webPath, hash }]).then(() => {
                    // applyWorkspaceCssFromServer: public/scripts/comp/workspaceUtils.js
                    applyWorkspaceCssFromServer(hash, webPath);
                }).catch(() => {
                    applyWorkspaceCssFromServer(hash, webPath);
                });
            }
            return;
        }

        if (message.type === 'runtime_compile_error') {
            const errors = message.data && Array.isArray(message.data.errors) ? message.data.errors : [];
            if (errors.length > 0 && typeof showRuntimeCompileErrors === 'function') {
                showRuntimeCompileErrors(errors);
            }
            return;
        }

        if (message.type === 'runtime_compile_progress') {
            if (typeof handleRuntimeCompileProgressBroadcast === 'function') {
                handleRuntimeCompileProgressBroadcast(message.data);
            }
            return;
        }

        if (message.type === 'runtime_compile_complete') {
            if (typeof handleRuntimeCompileCompleteBroadcast === 'function') {
                handleRuntimeCompileCompleteBroadcast(message.data);
            }
            return;
        }

        if (message.type === 'runtime_compile_logs') {
            this.triggerEvent('runtime_compile_logs', message);
            return;
        }

        if (message.type === 'workspace_css_updated') {
            const data = message.data || {};
            if (typeof applyWorkspaceCssFromServer === 'function') {
                applyWorkspaceCssFromServer(data.hash || data.sourceHash, data.webPath);
            }
            return;
        }

        // Handle resource update notifications
        if (message.type === 'resource_update_available') {
            const updateMessage = message.data.message || 'Resource updates are available for download';

            if (window.serviceWorkerManager && typeof window.serviceWorkerManager.showUpdateAvailableTrayPrompt === 'function') {
                window.serviceWorkerManager.showUpdateAvailableTrayPrompt(updateMessage);
            } else if (typeof showGlassToast === 'function') {
                const downloadButton = {
                    text: 'Download Now',
                    type: 'primary',
                    onClick: () => {
                        if (window.serviceWorkerManager) {
                            window.serviceWorkerManager.checkStaticFileUpdates();
                        }
                    },
                    closeOnClick: true
                };

                const laterButton = {
                    text: 'Later',
                    type: 'default',
                    onClick: () => {},
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

        if (message.type === 'generation_quips_updated') {
            this.handleGenerationQuipsUpdated(message);
            return;
        }

        if (message.type === 'generation_quips_progress') {
            this.handleGenerationQuipsProgress(message);
            return;
        }

        if (message.type === 'generation_quips_status') {
            this.handleGenerationQuipsStatus(message);
            return;
        }

        if (message.type === 'novel_progress') {
            this.handleNovelProgress(message);
            return;
        }

        if (message.type === 'novel_updated') {
            this.handleNovelUpdated(message);
            return;
        }

        if (message.type === 'novel_generate_complete') {
            this.handleNovelGenerateComplete(message);
            return;
        }

        // Trigger message event
        this.triggerEvent('message', message);

        // Handle specific message types
        switch (message.type) {
            case 'error':
                this.bannerManager.showWebSocketBanner('error', 'WebSocket server error: ' + message.message, '<i class="fas fa-exclamation-triangle"></i>');
                break;

            case 'image_generation_response':
                this.handleGeneratedImage(message.data);
                break;

            case 'image_upscaling_response':
                this.handleUpscalingResponse(message.data);
                break;

            case 'image_upscaling_error':
                this.handleUpscalingError(message.data);
                break;

            case 'image_expansion_response':
                this.handleExpansionResponse(message.data);
                break;

            case 'image_expansion_error':
                this.handleExpansionError(message.data);
                break;

            case 'image_expansion_reroll_response':
                this.handleExpansionRerollResponse(message.data);
                break;

            case 'image_expansion_reroll_error':
                this.handleExpansionRerollError(message.data);
                break;

            case 'gallery_updated':
                this.handleGalleryUpdate(message.data);
                break;

            case 'gallery_scroll_state': {
                const incoming = message.data && typeof message.data === 'object' ? message.data : {};
                window.galleryScrollStateFromSession = { ...(window.galleryScrollStateFromSession || {}), ...incoming };
                if (typeof window.applyGallerySessionRestoreIfReady === 'function') {
                    window.applyGallerySessionRestoreIfReady();
                }
                break;
            }

            case 'workspace_updated':
                this.handleWorkspaceUpdate(message.data);
                break;

            case 'workspace_desktop_persisted':
                if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts &&
                    typeof desktopShortcuts.handleWorkspaceDesktopPersisted === 'function') {
                    desktopShortcuts.handleWorkspaceDesktopPersisted();
                }
                break;

            case 'vfs_updated':
            case 'desktop_shortcut_added':
            case 'desktop_shortcut_removed':
            case 'desktop_shortcut_updated':
                if (typeof explorerApplet !== 'undefined' && explorerApplet &&
                    explorerApplet.modal && !explorerApplet.modal.classList.contains('hidden')) {
                    explorerApplet.softRefresh();
                }
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

            case 'note_created':
                // Add new note to cache
                if (notepadManager && message.data && message.data.note) {
                    notepadManager.addNoteToCache(message.data.note);
                }

                // Refresh notebook list if open
                if (notepadManager && notepadManager.notebookModal &&
                    !notepadManager.notebookModal.classList.contains('hidden')) {
                    notepadManager.notebookRefreshNotesList();
                }
                break;

            case 'note_updated':
                // Update the notes cache with the new data
                if (notepadManager && message.data && message.data.noteId && message.data.note) {
                    notepadManager.updateNoteInCache(message.data.note);
                }

                // Route to specific notepad instance if open
                if (notepadManager && message.data && message.data.noteId) {
                    const notepad = notepadManager.getNotepadByNoteId(message.data.noteId);
                    if (notepad) {
                        notepad.handleNoteUpdated(message.data);
                    }

                    // Also update notebook if showing this note
                    if (notepadManager.notebookCurrentNote &&
                        notepadManager.notebookCurrentNote.id === message.data.noteId) {
                        notepadManager.notebookLoadNote(message.data.noteId, false);
                    }

                    // Refresh notebook list if open
                    if (notepadManager.notebookModal &&
                        !notepadManager.notebookModal.classList.contains('hidden')) {
                        notepadManager.notebookRefreshNotesList();
                    }
                }
                // Invalidate cache for the affected workspace
                if (notepadManager && message.data && message.data.workspaceId) {
                    notepadManager.invalidateWorkspaceNotesCache(message.data.workspaceId);
                }
                break;

            case 'note_deleted':
                // Remove note from cache
                if (notepadManager && message.data && message.data.noteId) {
                    notepadManager.removeNoteFromCache(message.data.noteId);
                }

                // Close notepad if it's open
                if (notepadManager && message.data && message.data.noteId) {
                    const notepad = notepadManager.getNotepadByNoteId(message.data.noteId);
                    if (notepad) {
                        notepad.handleNoteDeleted();
                    }

                    // Clear notebook if showing this note
                    if (notepadManager.notebookCurrentNote &&
                        notepadManager.notebookCurrentNote.id === message.data.noteId) {
                        notepadManager.notebookCurrentNote = null;
                        if (notepadManager.notebookTextarea) {
                            notepadManager.notebookTextarea.value = '';
                        }
                        notepadManager.notebookUpdateTitle();
                    }

                    // Refresh notebook list if open
                    if (notepadManager.notebookModal &&
                        !notepadManager.notebookModal.classList.contains('hidden')) {
                        notepadManager.notebookRefreshNotesList();
                    }
                }
                break;

            case 'note_content_updated':
                // Update notepad content if open
                if (notepadManager && message.data && message.data.noteId) {
                    const notepad = notepadManager.getNotepadByNoteId(message.data.noteId);
                    if (notepad) {
                        notepad.handleNoteContentUpdated(message.data);
                    }
                }
                // Invalidate cache for the affected workspace
                if (notepadManager && message.data && message.data.workspaceId) {
                    notepadManager.invalidateWorkspaceNotesCache(message.data.workspaceId);
                }
                break;

            case 'workspace_deleted':
                // Clear cache for deleted workspace
                if (notepadManager && message.data && message.data.workspaceId) {
                    notepadManager.clearWorkspaceNotesCache(message.data.workspaceId);
                }
                break;

            default:
                // Handle custom message types
                this.triggerEvent(message.type, message);
        }
    }

    /**
     * Register a refresh callback for websocket reconnection
     * @param {string} callbackId - Unique identifier for the callback
     * @param {number} priority - Priority (lower numbers run first)
     * @param {Function} callback - Async function to call on reconnection
     */
    registerRefreshCallback(callbackId, priority, callback) {
        if (!this.refreshCallbacks) {
            this.refreshCallbacks = new Map();
        }

        if (typeof callback !== 'function') {
            console.error('❌ Refresh callback must be a function');
            return false;
        }

        this.refreshCallbacks.set(callbackId, {
            callback,
            priority
        });

        // Sort callbacks by priority
        this.refreshCallbacks = new Map(
            Array.from(this.refreshCallbacks.entries()).sort((a, b) => a[1].priority - b[1].priority)
        );

        return true;
    }

    /**
     * Remove a refresh callback
     * @param {string} callbackId - The callback ID to remove
     * @returns {boolean} True if callback was removed
     */
    removeRefreshCallback(callbackId) {
        if (!this.refreshCallbacks) return false;
        return this.refreshCallbacks.delete(callbackId);
    }

    /**
     * Execute all refresh callbacks (called on websocket reconnection)
     * @returns {Promise<void>}
     */
    async executeRefreshCallbacks() {
        if (!this.refreshCallbacks || this.refreshCallbacks.size === 0) return;

        const promises = Array.from(this.refreshCallbacks.values()).map(async ({ callback }) => {
            try {
                await callback();
            } catch (error) {
                console.error('❌ Error in refresh callback:', error);
            }
        });

        await Promise.allSettled(promises);
    }

    handleAuthError(message) {
        this._setConnectionPhase('auth');

        // Trigger authentication event for other parts of the app to handle
        this.triggerEvent('authentication_required', message);

        if (this._shouldUsePreStartupDialog()) {
            this.preStartupAuthBusy = false;
            this._setConnectionPhase('auth', {
                beat: 'establishing',
                message: 'Authentication required. Enter your password.'
            });
            return;
        }

        // Show PIN modal for authentication
        if (typeof showPinModal === 'function') {
            showPinModal().then(() => {
                this.forceReconnect();
            }).catch((error) => {
                console.error('❌ PIN modal error:', error);
            });
        } else {
            // Fallback: redirect to login page
            location.href = '/';
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

            // Base timeout of 2 minutes (matches server-side keep-alive for image generation)
            // TODO: This should be based on if Rentan is running 30 minutes for image gen and 2 min for Rentan
            const baseTimeout = 120000;
            const timeoutMs = this.getEffectiveTimeout(baseTimeout);

            // Set new timeout
            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    const request = this.pendingRequests.get(requestId);
                    this.pendingRequests.delete(requestId);
                    this.decrementPendingRequests();

                    console.warn(`⚠️ Request timeout after keep-alive reset for ${requestId} (${Math.round(timeoutMs / 1000)}s)`);

                    const timeoutError = new Error(`Request timeout after ${Math.round(timeoutMs / 1000)} seconds (with keep-alive)`);
                    timeoutError.code = 'REQUEST_TIMEOUT';
                    timeoutError.requestId = requestId;
                    request.reject(timeoutError);
                }
            }, timeoutMs);

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

    handleUpscalingResponse(data) {
        this.triggerEvent('imageUpscalingResponse', data);
    }

    handleUpscalingError(data) {
        this.triggerEvent('imageUpscalingError', data);
    }

    handleExpansionResponse(data) {
        this.triggerEvent('imageExpansionResponse', data);
    }

    handleExpansionError(data) {
        this.triggerEvent('imageExpansionError', data);
    }

    handleExpansionRerollResponse(data) {
        this.triggerEvent('imageExpansionRerollResponse', data);
    }

    handleExpansionRerollError(data) {
        this.triggerEvent('imageExpansionRerollError', data);
    }

    handleGalleryUpdate(data) {
        this.triggerEvent('galleryUpdated', data);
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
            if (typeof desktopShortcuts !== 'undefined'
                && desktopShortcuts
                && !desktopShortcuts.pendingWindowPositionSave
                && typeof commitWindowPositionsSnapshot === 'function') {
                commitWindowPositionsSnapshot();
            }
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

    // Drop large base64 payloads from streaming preview elements so decoded pixels can be GC'd.
    releaseDataImageSrc(img) {
        if (!img || !img.src || !img.src.startsWith('data:')) return;
        img.onload = null;
        img.onerror = null;
        img.removeAttribute('src');
    }

    discardStreamingStepImageData(queueData) {
        if (!queueData || !Array.isArray(queueData.queue)) return;
        for (const item of queueData.queue) {
            if (item && item.imageData) {
                delete item.imageData;
            }
        }
        queueData.queue.length = 0;
    }

    cleanupGenerationProgressState(requestId) {
        if (!this.progressStates || !requestId) return;
        const progressState = this.progressStates.get(requestId);
        if (!progressState) return;
        if (progressState.timer) {
            clearInterval(progressState.timer);
            progressState.timer = null;
        }
        if (progressState.delayTimer) {
            clearInterval(progressState.delayTimer);
            progressState.delayTimer = null;
        }
        this.progressStates.delete(requestId);
        delete window._lastToolState;
    }

    releaseStreamingPreviewDataUrls(modalType = null) {
        if (!modalType || modalType === 'manual') {
            this.releaseDataImageSrc(document.getElementById('manualPreviewImage'));
        }
        if (!modalType || modalType === 'spellbook') {
            const spellbookImg = window.spellbookModalManager?.previewImage;
            this.releaseDataImageSrc(spellbookImg);
        }
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

        // Coalesce intermediate frames — only the latest step matters for preview.
        if (data.imageData) {
            this.discardStreamingStepImageData(queueData);
        }

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
            if (data && data.imageData) {
                delete data.imageData;
            }
            queueData.lastDisplayTime = Date.now();
        }

        queueData.isProcessing = false;
    }

    // Display a streaming step on the appropriate modal
    displayStreamingStep(modalType, data) {
        if (!data?.imageData) return;

        const imageDataUrl = `data:image/png;base64,${data.imageData}`;
        delete data.imageData;

        if (modalType === 'manual') {
            const previewPlaceholder = document.getElementById('manualPreviewPlaceholder');
            if (manualPreviewImage) {
                this.releaseDataImageSrc(manualPreviewImage);
                manualPreviewImage.src = imageDataUrl;
                manualPreviewImage.classList.remove('hidden');
                previewPlaceholder.classList.add('hidden');

                // Show that we're in streaming mode
                manualForm.classList.add('streaming');

                // lockGenerationQuips: public/scripts/comp/generationQuips.js
                lockGenerationQuips();

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
                this.releaseDataImageSrc(spellbookPreviewImage);
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
    clearStreamingStepQueues(modalType = null, releasePreview = false) {
        if (!this.streamingStepQueues) return;

        if (modalType) {
            if (this.streamingStepQueues[modalType]) {
                this.discardStreamingStepImageData(this.streamingStepQueues[modalType]);
                delete this.streamingStepQueues[modalType];
            }
        } else {
            Object.keys(this.streamingStepQueues).forEach(key => {
                this.discardStreamingStepImageData(this.streamingStepQueues[key]);
                delete this.streamingStepQueues[key];
            });
        }

        if (releasePreview) {
            this.releaseStreamingPreviewDataUrls(modalType);
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

    /**
     * Spellbook preset generation owns Rentan/streaming UI — do not touch the manual editor.
     * spellbookModalManager: public/scripts/comp/spellbookModal.js
     */
    isSpellbookGenerationActive() {
        return Boolean(window.spellbookModalManager?.isGenerating);
    }

    /**
     * Carousel updates only from dynamic_generation_progress_update payloads (context / compiled_prompt).
     */
    applyRentanCarouselFromDynamicProgress(phase, data) {
        if (this.isSpellbookGenerationActive()) return;

        if (phase === 'context' && data?.carousel && typeof updateDynamicCarousel === 'function') {
            updateDynamicCarousel(data.carousel, 'current');
        }
        if (data?.compiled_prompt?.context && typeof updateDynamicCarousel === 'function') {
            updateDynamicCarousel(data.compiled_prompt.context, 'compiled');
        }
        if (phase === 'context' && data && typeof updateRentanContextOverlay === 'function') {
            updateRentanContextOverlay(data);
        }
        if (data?.compiled_prompt?.context && typeof updateRentanContextOverlay === 'function') {
            updateRentanContextOverlay(data.compiled_prompt.context);
        }
    }

    /**
     * Manual + spellbook Rentan overlays (same phase strings as sendGenerationProgress / dynamic_generation_progress_update).
     */
    applyRentanGenerationProgressUi(phase, data = {}) {
        if (this.isSpellbookGenerationActive()) {
            if (window.spellbookModalManager?.modal && !window.spellbookModalManager.modal.classList.contains('hidden')) {
                updateSpellbookDynamicGenerationProgressOverlay(phase, data);
            }
            return;
        }

        const manualFormGenerating = document.getElementById('manualForm')?.classList.contains('generating');
        const isDynamicGenerationActive = window.dynamicGenerationData
            || isDynamicGenerationEnabled()
            || manualFormGenerating;
        if (isDynamicGenerationActive) {
            updateDynamicGenerationProgressOverlay(phase, data);
        }
    }

    // Handle Rentan progress updates
    handleDynamicGenerationProgressUpdate(message) {
        const { phase, data } = message;

        // Reset timeout for any pending dynamic context resolution requests
        // This prevents timeouts during long-running Rentan processes
        this.resetTimeoutsForRequestType('resolve_dynamic_context');

        this.applyRentanCarouselFromDynamicProgress(phase, data || {});
        this.applyRentanGenerationProgressUi(phase, data || {});
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

        if (data.hasDynamicGen) {
            this.applyRentanGenerationProgressUi(data.phase, data);
        }

        if (data.phase === 'generating' && typeof setGenerationPreviewForegroundLinesActive === 'function') {
            setGenerationPreviewForegroundLinesActive(true);
        }
        // Keep foreground lines moving until preview teardown (stopPreviewAnimation / forceStop), same as background — do not clear on complete.
        if (data.phase === 'starting' && typeof setGenerationPreviewForegroundLinesActive === 'function') {
            setGenerationPreviewForegroundLinesActive(false);
        }

        // Calculate progress percentage using the client-side function
        if (typeof calculateGenerationProgress === 'function') {
            let progressPercent = calculateGenerationProgress(data);

            // Handle timer-based progress for certain phases
            if (data.phase === 'starting' && !progressState.timer) {
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
            } else if (data.phase !== 'starting' && data.phase !== 'upscaling') {
                // Clear timer for non-timer phases
                if (progressState.timer) {
                    clearInterval(progressState.timer);
                    progressState.timer = null;
                }
            }

            // Update progress toast if it exists (skip for timer phases that are self-updating)
            if (typeof updateGlassToastProgress === 'function' && progressToastId &&
                data.phase !== 'starting' && data.phase !== 'upscaling') {
                updateGlassToastProgress(progressToastId, progressPercent);
            }

            // Update main message line with progress status (line 2)
            if (typeof updateGlassToastMessage === 'function' && progressToastId) {
                let statusMessage = '';
                switch (data.phase) {
                    case 'starting':
                        statusMessage = 'Analyzing request...';
                        break;
                    case 'tool_execution':
                        if (data.currentKey && data.totalKeys) {
                            statusMessage = `Executing tools (${data.currentKey}/${data.totalKeys})...`;
                        } else {
                            statusMessage = 'Executing tools...';
                        }
                        break;
                    case 'streaming':
                        statusMessage = 'Processing AI response...';
                        break;
                    case 'completion':
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
                const manualModalEl = document.getElementById('manualModal');
                const skipToastPreview = data.phase === 'generating'
                    && manualModalEl
                    && !manualModalEl.classList.contains('hidden')
                    && !this.isSpellbookGenerationActive();

                if (!skipToastPreview) {
                    updateGlassToastImagePreview(progressToastId, data.imageData);
                }

                // Also handle modal streaming updates for intermediate images
                if (data.phase === 'generating' && data.currentStep !== undefined) {
                    if (this.isSpellbookGenerationActive()) {
                        this.queueStreamingStep('spellbook', data);
                    } else if (manualModal && !manualModal.classList.contains('hidden')) {
                        this.queueStreamingStep('manual', data);
                    }
                }
            }

            // Handle completion
            if (data.phase === 'complete') {
                if (data.contentLength && Number(data.contentLength) > 0) {
                    this.pendingGenerationDownloadBytes = Number(data.contentLength);
                    this.pendingGenerationDownloadFilename = data.filename || null;
                }

                const manualModalEl = document.getElementById('manualModal');
                const manualFormEl = document.getElementById('manualForm');
                const spellbookActive = this.isSpellbookGenerationActive();
                const retainPreviewForFinalize = spellbookActive
                    || (manualModalEl
                        && !manualModalEl.classList.contains('hidden')
                        && manualFormEl?.classList.contains('generating'));
                if (retainPreviewForFinalize && typeof showManualPreviewNavigationLoading === 'function') {
                    const dlBytes = data.contentLength && Number(data.contentLength) > 0
                        ? Number(data.contentLength)
                        : null;
                    showManualPreviewNavigationLoading(
                        true,
                        dlBytes ? 'Downloading…' : 'Preparing download…',
                        dlBytes ? 0 : 'indeterminate'
                    );
                }

                // Final /images/ load swaps the preview — do not clear streaming frame early.
                this.clearStreamingStepQueues(null, !retainPreviewForFinalize);

                if (progressToastId && typeof clearGlassToastImagePreview === 'function') {
                    clearGlassToastImagePreview(progressToastId);
                }

                const manualModal = document.getElementById('manualModal');
                if (manualModal && !manualModal.classList.contains('hidden')) {
                    // lockGenerationQuips: public/scripts/comp/generationQuips.js
                    lockGenerationQuips();
                }

                // Clear any running timers
                this.cleanupGenerationProgressState(requestId);

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
                icon.className = 'fas fa-magnifying-glass-arrows-rotate';
                break;
            case 'complete':
            case 'up_to_date':
            case 'cache_ready':
                indicator.classList.add('up_to_date');
                icon.className = 'fas fa-file-magnifying-glass';
                break;
            case 'paused':
                indicator.classList.add('paused');
                icon.className = 'fas fa-magnifying-glass-minus';
                break;
            case 'resumed':
            case 'idle':
                indicator.classList.add('up_to_date');
                icon.className = 'fas fa-magnifying-glass';
                break;
            case 'error':
                indicator.classList.add('error');
                icon.className = 'fas fa-rotate-exclamation';
                break;
            default:
                icon.className = 'fas fa-magnifying-glass';
                break;
        }

        // Update paused state in indicator data attribute for context menu
        if (status === 'paused') {
            indicator.dataset.indexingPaused = 'true';
        } else if (status === 'resumed' || status === 'idle' || status === 'up_to_date' || status === 'complete') {
            indicator.dataset.indexingPaused = 'false';
        }

        // Re-attach context menu if it exists to update dynamic items
        if (indicator._menuConfigFn && contextMenu) {
            contextMenu.attachToElement(indicator, indicator._menuConfigFn());
        }

        // Trigger event for other parts of the app that might want to listen
        this.triggerEvent('search_indexing_status', message);
    }

    handleGenerationQuipsUpdated(message) {
        const data = message.data || {};
        // handleGenerationQuipsClientUpdate: public/scripts/comp/generationQuipsTray.js
        if (typeof handleGenerationQuipsClientUpdate === 'function') {
            handleGenerationQuipsClientUpdate(data);
        }
        this.triggerEvent('generation_quips_updated', message);
    }

    handleGenerationQuipsProgress(message) {
        const data = message.data || {};
        // handleGenerationQuipsProgress: public/scripts/comp/generationQuipsTray.js
        if (typeof handleGenerationQuipsProgress === 'function') {
            handleGenerationQuipsProgress(data);
        }
        this.triggerEvent('generation_quips_progress', message);
    }

    handleGenerationQuipsStatus(message) {
        const data = message.data || {};
        // handleGenerationQuipsStatusBroadcast: public/scripts/comp/generationQuipsTray.js
        if (typeof handleGenerationQuipsStatusBroadcast === 'function') {
            handleGenerationQuipsStatusBroadcast(data);
        }
        this.triggerEvent('generation_quips_status', message);
    }

    handleNovelProgress(message) {
        const data = message.data || {};
        // handleNovelProgressUpdate: public/scripts/comp/novelManager.js
        if (typeof handleNovelProgressUpdate === 'function') {
            handleNovelProgressUpdate(data);
        }
        this.triggerEvent('novel_progress', message);
    }

    handleNovelUpdated(message) {
        const data = message.data || {};
        // handleNovelClientUpdate: public/scripts/comp/novelManager.js
        if (typeof handleNovelClientUpdate === 'function') {
            handleNovelClientUpdate(data);
        }
        this.triggerEvent('novel_updated', message);
    }

    handleNovelGenerateComplete(message) {
        const data = message.data || {};
        // handleNovelGenerateComplete: public/scripts/comp/novelManager.js
        if (typeof handleNovelGenerateComplete === 'function') {
            handleNovelGenerateComplete(data, message.requestId);
        }
        this.triggerEvent('novel_generate_complete', message);
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

    async previewExpandImagePrompt(params) {
        if (!this.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        try {
            return await this.sendMessage('preview_expand_image_prompt', params);
        } catch (error) {
            console.error('Preview expand prompt error:', error);
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

    // Partial fetches (probe, add-latest) must not join the full-gallery pagination group.
    isPartialGalleryRequest(options = {}) {
        if (options && options.skipGalleryPagination) return true;
        const limit = Number(options.limit);
        if (limit === 0) return true;
        return limit > 0 && limit < 750;
    }

    // Method to request gallery data via WebSocket
    async requestGallery(viewType = 'images', includePinnedStatus = true, options = {}) {
        try {
            const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace)
                ? activeWorkspace
                : (window.currentWorkspace || 'default');
            const requestData = {
                viewType,
                includePinnedStatus,
                workspaceId,
                ...options // Support light, offset, limit parameters
            };

            // All gallery requests during active pagination loading should use pagination tracking
            let result;
            const isPartial = this.isPartialGalleryRequest(options);
            if (this.isGalleryLoadingActive && !isPartial) {
                // Use pagination tracking for all gallery requests during active loading
                if (!this.activeGalleryPaginationGroupId) {
                    this.activeGalleryPaginationGroupId = `gallery_load_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
                }

                result = await this.sendGalleryPaginationRequest('request_gallery', requestData, (response, error) => {
                    if (error) {
                        console.error('Gallery pagination request callback error:', error);
                    }
                }, true, this.activeGalleryPaginationGroupId);
            } else {
                // Regular request - could potentially start pagination
                result = await this.sendMessageWithCallback('request_gallery', requestData, (response, error) => {
                    if (error) {
                        console.error('Gallery request callback error:', error);
                    }
                });
            }

            return result;
        } catch (error) {
            console.error('Gallery request error:', error);
            throw error;
        }
    }

    // Mark gallery loading as complete
    completeGalleryLoading() {
        this.isGalleryLoadingActive = false;
        const previousGalleryGroupId = this.activeGalleryPaginationGroupId;
        this.activeGalleryPaginationGroupId = null;

        if (this.paginationGroups && this.paginationGroups.size > 0) {
            for (const [groupId, groupInfo] of this.paginationGroups.entries()) {
                const isActiveGroup = previousGalleryGroupId && groupId === previousGalleryGroupId;
                const isGalleryGroup = groupInfo && groupInfo.tickerBaseLabel === 'Loading Gallery';
                if (isActiveGroup || isGalleryGroup) {
                    this.paginationGroups.delete(groupId);
                }
            }
        }

        // If no pending requests remain, force-reset the counter so stale gallery groups
        // cannot keep the ticker alive after local IndexedDB fast-path loads.
        if (!this.pendingRequests || this.pendingRequests.size === 0) {
            this.pendingRequestsCount = 0;
            this.updatePendingRequestsSpinner();
        }

        this.updateTickerDisplay();
    }

    // Method to request specific gallery view (scraps, pinned, upscaled)
    async requestGalleryView(viewType) {
        return this.requestGallery(viewType, true);
    }

    // Method to request all images with pinned status
    async requestAllImages() {
        return this.requestGallery('images', true);
    }

    // Method to request gallery data with pagination info
    async requestGalleryData(viewType = 'images', offset = 0, limit = 100) {
        try {
            const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace)
                ? activeWorkspace
                : (window.currentWorkspace || 'default');
            const result = await this.sendMessageWithCallback('request_gallery', {
                viewType,
                includePinnedStatus: true,
                workspaceId,
                offset,
                limit,
                light: false
            }, (response, error) => {
                if (error) {
                    console.error('Gallery data request callback error:', error);
                }
            });
            return result;
        } catch (error) {
            console.error('Gallery data request error:', error);
            throw error;
        }
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
            this.sendAcklessMessage('search_characters', {
                query,
                model,
                requestId: options.requestId,
                autofillSessionId: options.autofillSessionId || null,
                spellCheckText: options.spellCheckText || query,
                isContinuation: options.isContinuation === true,
                autofillSettings: options.autofillSettings || null
            });
            return { success: true };
        } catch (error) {
            showGlassToast('error', 'Character search error', error.message, false);
            throw error;
        }
    }

    async fetchAutofillWikiPreviews(tagIds, options = {}) {
        if (!Array.isArray(tagIds) || tagIds.length === 0) {
            return { success: true };
        }
        try {
            this.sendAcklessMessage('fetch_autofill_wiki_previews', {
                tagIds,
                requestId: options.requestId || null,
                autofillSessionId: options.autofillSessionId || null,
                model: options.model || null
            });
            return { success: true };
        } catch (error) {
            console.error('fetchAutofillWikiPreviews:', error);
            return { success: false };
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

    async compileDynamicGeneration(requestBody) {
        const requestId = this.generateRequestId();
        requestBody.requestId = requestId;
        return this.sendMessageWithRequestId('compile_dynamic_generation', requestId, requestBody);
    }

    async applyTendaiPreview(requestBody) {
        const requestId = this.generateRequestId();
        requestBody.requestId = requestId;
        return this.sendMessageWithRequestId('apply_tendai_preview', requestId, requestBody);
    }

    async recompileRuntimeAssets(options = {}) {
        return this.sendMessageWithRequestId('recompile_runtime_assets', this.generateRequestId(), options);
    }

    async setRuntimeAssetsAutoRecompile(enabled) {
        return this.sendMessageWithRequestId('set_runtime_assets_auto_recompile', this.generateRequestId(), { enabled: !!enabled });
    }

    async resolveTextReplacements(text, presetName = null, model = null, periodKey = null) {
        return this.sendMessageWithRequestId('resolve_text_replacements', this.generateRequestId(), { text, presetName, model, periodKey });
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

    // Save window positions (global, not per-workspace). Uses sendMessage so callers can await server receipt.
    async saveWindowPositions(workspaceId, windowPositions) {
        if (!this.isConnected()) {
            return;
        }

        return this.sendMessage('workspace_update_window_positions', {
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

    async downloadUrlFile(url, previewUrl = null) {
        try {
            // Add a timeout to prevent hanging
            const timeoutMs = previewUrl ? 45000 : 10000;
            const timeoutPromise = new Promise((_, reject) => {
                setTimeout(() => reject(new Error('Download timeout - server took too long to respond')), timeoutMs);
            });

            const payload = { url };
            if (previewUrl) payload.previewUrl = previewUrl;
            const downloadPromise = this.sendMessage('download_url_file', payload);

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

    async importVibeBundle(bundleData, workspaceId, comment = '', tempFile = null, previewUrl = null) {
        return this.sendMessage('import_vibe_bundle', { bundleData, workspaceId, comment, tempFile, previewUrl });
    }

    async importVibeFromUrl(downloadUrl, previewUrl, workspaceId, comment = '', naxBrowserMeta = null) {
        return this.sendMessage('import_vibe_from_url', { downloadUrl, previewUrl, workspaceId, comment, naxBrowserMeta });
    }

    async checkVibeEncoding(vibeId, workspaceId) {
        return this.sendMessage('check_vibe_encoding', { vibeId, workspaceId });
    }

    async getAppOptions() {
        return this.sendMessage('get_app_options');
    }

    async getGenerationQuips() {
        return this.sendMessage('get_generation_quips', {}, false);
    }

    async getGenerationQuipsStatus() {
        return this.sendMessage('get_generation_quips_status', {}, false);
    }

    async getGenerationQuipsWiki(options = {}) {
        return this.sendMessage('get_generation_quips_wiki', options, false);
    }

    async runGenerationQuips(options = {}) {
        return this.sendMessage('generation_quips_run', options);
    }

    async clearGenerationQuips(options = {}) {
        return this.sendMessage('generation_quips_clear', options);
    }

    async novelList(workspaceId) {
        return this.sendMessage('novel_list', { workspaceId }, false);
    }

    async novelGet(noteId) {
        return this.sendMessage('novel_get', { noteId }, false);
    }

    async novelUpdate(noteId, updates) {
        return this.sendMessage('novel_update', { noteId, updates });
    }

    async novelGenerate(params) {
        return this.sendMessage('novel_generate', params);
    }

    async novelUndo(noteId) {
        return this.sendMessage('novel_undo', { noteId });
    }

    async novelResolveImage(noteId, filename = null) {
        return this.sendMessage('novel_resolve_image', { noteId, filename }, false);
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
            const pingTimestamp = Date.now(); // Record when ping is sent
            const message = {
                type: 'ping',
                requestId
            };
            if (this.currentRtt !== null) {
                message.clientRttMs = Math.round(this.currentRtt);
            }

            // Store pending request with timestamp
            this.pendingRequests = this.pendingRequests || new Map();
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                type: 'ping',
                showBanner: false,
                timestamp: pingTimestamp
            });

            // Store ping timestamp for RTT calculation
            this.pendingPings.set(requestId, pingTimestamp);

            // Increment pending requests count
            this.incrementPendingRequests();

            try {
                this.send(message);

                // Calculate dynamic timeout based on RTT
                const baseTimeout = WebSocketClient.TIMEOUT_PING;
                const timeoutMs = this.getEffectiveTimeout(baseTimeout);

                const timeoutId = setTimeout(() => {
                    if (this.pendingRequests.has(requestId)) {
                        const request = this.pendingRequests.get(requestId);
                        this.pendingRequests.delete(requestId);
                        this.pendingPings.delete(requestId);
                        this.decrementPendingRequests();

                        console.warn(`⚠️ Ping request timeout (ID: ${requestId}) after ${timeoutMs}ms`);
                        const timeoutError = new Error(`Ping request timeout after ${timeoutMs}ms`);
                        timeoutError.code = 'PING_TIMEOUT';
                        timeoutError.requestId = requestId;
                        reject(timeoutError);
                    }
                }, timeoutMs);

                // Store timeout ID for cleanup
                this.pendingRequests.get(requestId).timeoutId = timeoutId;

            } catch (error) {
                this.pendingRequests.delete(requestId);
                this.pendingPings.delete(requestId);
                this.decrementPendingRequests();
                reject(error);
            }
        });
    }

    /**
     * Starts periodic ping sending to measure RTT and keep connection alive
     */
    startPeriodicPings() {
        // Clear any existing ping interval
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
        }

        // Don't start if not connected
        if (!this.isConnected()) {
            return;
        }

        // Start periodic pings
        this.pingInterval = setInterval(() => {
            if (this.isConnected()) {
                // Send ping and measure RTT (don't wait for response)
                this.pingWithAuth().catch(error => {
                    // Only log if it's not a timeout (timeouts are expected on slow connections)
                    if (error.code !== 'PING_TIMEOUT') {
                        console.warn('⚠️ Periodic ping failed:', error.message);
                    }
                });
            } else {
                // Stop pinging if connection is lost
                this.stopPeriodicPings();
            }
        }, WebSocketClient.DELAY_PING_INTERVAL);

        console.log('🔄 Started periodic ping interval');
    }

    /**
     * Stops periodic ping sending
     */
    stopPeriodicPings() {
        if (this.pingInterval) {
            clearInterval(this.pingInterval);
            this.pingInterval = null;
            console.log('🛑 Stopped periodic ping interval');
        }
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

    async getUserGlobalSettings() {
        return this.sendMessage('get_user_global_settings', {}, false);
    }

    async updateUserGlobalSettings(settings) {
        return this.sendMessage('update_user_global_settings', { settings });
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

    /**
     * Reject pending generate_image / generate_preset / expand_image / reroll_expanded_image promises (unblocks UI), clear streaming queues,
     * and notify the server to stop keep-alive timers for those request IDs. Server work may continue until completed.
     */
    cancelClientImageGeneration(reason = 'Generation cancelled') {
        if (!this.pendingRequests || this.pendingRequests.size === 0) {
            return [];
        }
        const types = new Set(['generate_image', 'generate_preset', 'expand_image', 'reroll_expanded_image']);
        const cancelledIds = [];
        for (const [requestId, req] of [...this.pendingRequests.entries()]) {
            if (!types.has(req.type)) continue;
            const err = new Error(reason);
            err.code = 'CLIENT_CANCELLED';
            cancelledIds.push(requestId);
            this.resolveRequest(requestId, null, err);
        }
        if (cancelledIds.length > 0) {
            this.clearStreamingStepQueues(null, true);
            try {
                this.sendAcklessMessage('cancel_generation', { cancelledRequestIds: cancelledIds });
            } catch (e) {
                console.warn('cancel_generation notify failed:', e && e.message);
            }
        }
        return cancelledIds;
    }

    // Abort a single pending request from the connection status UI (public/scripts/websocket.js)
    abortPendingRequest(requestId, reason = 'Request aborted') {
        if (!this.pendingRequests || !this.pendingRequests.has(requestId)) {
            return false;
        }
        const request = this.pendingRequests.get(requestId);
        const generationTypes = new Set(['generate_image', 'generate_preset', 'expand_image', 'reroll_expanded_image']);
        const err = new Error(reason);
        err.code = generationTypes.has(request.type) ? 'CLIENT_CANCELLED' : 'REQUEST_ABORTED';
        err.requestId = requestId;

        if (generationTypes.has(request.type)) {
            this.clearStreamingStepQueues(null, true);
            try {
                this.sendAcklessMessage('cancel_generation', { cancelledRequestIds: [requestId] });
            } catch (e) {
                console.warn('cancel_generation notify failed:', e && e.message);
            }
        }

        if (request.type === 'request_gallery' && this.isGalleryLoadingActive) {
            this.completeGalleryLoading();
        }

        this.resolveRequest(requestId, null, err);
        return true;
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
        const silentTicker = this.isSilentTickerRequest(type);
        const effectiveShowBanner = silentTicker ? false : showBanner;

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
                showBanner: effectiveShowBanner,
                silentTicker,
                timestamp: Date.now()
            });

            if (!silentTicker) {
                this.incrementPendingRequests();
            }

            // Set timeout based on request type BEFORE sending - critical requests should fail fast
            let baseTimeout = 60000; // Default 60 seconds

            // Critical initialization requests should fail fast if server is not ready
            if (message.type === 'get_app_options') {
                baseTimeout = WebSocketClient.TIMEOUT_GET_APP_OPTIONS;
            }

            // Calculate dynamic timeout based on RTT
            const timeoutMs = this.getEffectiveTimeout(baseTimeout);

            const timeoutId = setTimeout(() => {
                if (this.pendingRequests.has(requestId)) {
                    const request = this.pendingRequests.get(requestId);
                    const requestAge = Date.now() - request.timestamp;

                    this.pendingRequests.delete(requestId);
                    if (!silentTicker) {
                        this.decrementPendingRequests();
                    }

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
                if (!silentTicker) {
                    this.decrementPendingRequests();
                }
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
                showBanner,
                offset: data.offset || 0,
                limit: data.limit || 0
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

    // Send paginated gallery request with special tracking
    sendGalleryPaginationRequest(type, data = {}, callback = null, showBanner = true, paginationGroupId = null) {
        return new Promise((resolve, reject) => {
            if (!this.isConnected()) {
                console.error('❌ WebSocket not connected - rejecting paginated gallery request:', {
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

            // Initialize pagination groups if not exists
            this.paginationGroups = this.paginationGroups || new Map();

            // Create or get pagination group
            if (paginationGroupId) {
                if (!this.paginationGroups.has(paginationGroupId)) {
                    this.paginationGroups.set(paginationGroupId, {
                        totalRequests: 0,
                        completedRequests: 0,
                        currentPage: 0,
                        totalPages: 0,
                        hasMore: true,
                        currentOffset: 0,
                        lastUpdated: Date.now(),
                        tickerBaseLabel: this.paginationTickerBaseLabelForType(type, data),
                        paginationChunkSize: (data && data.limit) > 0 ? data.limit : 750
                    });
                }
                const group = this.paginationGroups.get(paginationGroupId);
                group.totalRequests++;
                group.currentPage = data.offset ? Math.floor(data.offset / data.limit) + 1 : 1;
                group.lastUpdated = Date.now();
            }

            // Store pending request with callback and pagination info
            this.pendingRequests = this.pendingRequests || new Map();
            this.pendingRequests.set(requestId, {
                resolve,
                reject,
                callback: callback || null,
                type,
                showBanner,
                paginationGroupId,
                isGalleryPaginationRequest: true,
                isPaginationRequest: true,
                offset: data.offset || 0
            });

            // Only increment pending requests count if not part of pagination group or first request in group
            if (!paginationGroupId || this.paginationGroups.get(paginationGroupId).totalRequests === 1) {
                this.incrementPendingRequests();
            }

            try {
                this.send(message);
            } catch (error) {
                this.pendingRequests.delete(requestId);
                if (paginationGroupId) {
                    const group = this.paginationGroups.get(paginationGroupId);
                    if (group) {
                        group.totalRequests--;
                        if (group.totalRequests <= 0) {
                            this.paginationGroups.delete(paginationGroupId);
                        }
                    }
                }
                // Only decrement if we incremented above
                if (!paginationGroupId || this.paginationGroups.get(paginationGroupId)?.totalRequests === 0) {
                    this.decrementPendingRequests();
                }
                reject(error);
            }
        });
    }

    // Update pagination group progress
    updatePaginationProgress(paginationGroupId, pagination, currentOffset = 0) {
        if (!this.paginationGroups || !this.paginationGroups.has(paginationGroupId)) {
            return;
        }

        const group = this.paginationGroups.get(paginationGroupId);
        group.hasMore = pagination?.hasMore || false;
        group.totalItems = pagination?.totalItems || group.totalItems;
        group.currentOffset = currentOffset;
        group.lastUpdated = Date.now();

        // Defer ticker refresh: resolveRequest deletes the completed row before this runs, and the next chunk is
        // only queued after request.resolve() microtasks — sync updateTickerDisplay would see an empty map and
        // clear the cycle without redrawing (public/scripts/websocket.js resolveRequest / sendGalleryPaginationRequest).
        setTimeout(() => this.updateTickerDisplay(), 0);
    }

    // Check if pagination group is complete
    isPaginationGroupComplete(paginationGroupId) {
        if (!this.paginationGroups || !this.paginationGroups.has(paginationGroupId)) {
            return true;
        }
        const group = this.paginationGroups.get(paginationGroupId);
        return !group.hasMore && group.completedRequests >= group.totalRequests;
    }

    // Get pagination group info for ticker display
    getPaginationGroupInfo(paginationGroupId) {
        if (!this.paginationGroups || !this.paginationGroups.has(paginationGroupId)) {
            return null;
        }
        return this.paginationGroups.get(paginationGroupId);
    }

    // Check if all pagination groups are complete
    areAllPaginationGroupsComplete() {
        if (!this.paginationGroups || this.paginationGroups.size === 0) {
            return true;
        }

        for (const [groupId, group] of this.paginationGroups) {
            if (!this.isPaginationGroupComplete(groupId)) {
                return false;
            }
        }
        return true;
    }

    /**
     * Remove pagination group entries that no longer have any pending gallery request in the map.
     * Without this, a stuck group (e.g. hasMore never cleared) blocks the ticker from ever
     * dismissing after unrelated work like image generation completes with zero pending requests.
     */
    pruneOrphanPaginationGroups() {
        if (!this.paginationGroups || this.paginationGroups.size === 0) {
            return;
        }
        if (!this.pendingRequests || this.pendingRequests.size === 0) {
            this.paginationGroups.clear();
            if (this.pendingRequestsCount > 0) {
                this.pendingRequestsCount = 0;
            }
            return;
        }
        const activeGroupIds = new Set();
        for (const [, req] of this.pendingRequests) {
            if (this.requestUsesPaginationGroup(req) && req.paginationGroupId) {
                activeGroupIds.add(req.paginationGroupId);
            }
        }
        for (const groupId of this.paginationGroups.keys()) {
            if (!activeGroupIds.has(groupId)) {
                const group = this.paginationGroups.get(groupId);
                if (!group) continue;

                // Keep incomplete groups only for a brief grace window between resolve and next send.
                if (!this.isPaginationGroupComplete(groupId)) {
                    if (!group.orphanedAt) {
                        group.orphanedAt = Date.now();
                    }
                    if (Date.now() - group.orphanedAt < 3000) {
                        continue;
                    }
                } else {
                    group.orphanedAt = 0;
                }

                this.paginationGroups.delete(groupId);
            } else {
                const group = this.paginationGroups.get(groupId);
                if (group) {
                    group.orphanedAt = 0;
                }
            }
        }
    }

    requestUsesPaginationGroup(request) {
        return !!(request && (request.isGalleryPaginationRequest || request.isPaginationRequest));
    }

    paginationTickerBaseLabelForType(type, data = {}) {
        if (type === 'request_gallery') return 'Loading Gallery';
        return (data && data.tickerLabel) || 'Loading';
    }

    /**
     * Build ticker label for any pagination group (blocks left vs totalItems / chunk size).
     * public/scripts/comp/workspaceUtils.js formatGalleryBlocksProgressLabel
     */
    formatPaginationGroupTickerText(groupInfo) {
        if (!groupInfo) {
            return { displayName: 'Loading', iconClass: 'fa-download' };
        }
        const chunk = groupInfo.paginationChunkSize || 750;
        const base = groupInfo.tickerBaseLabel || 'Loading';
        // Do not show block suffix until at least one real chunk has completed.
        if (groupInfo.totalItems && typeof groupInfo.currentOffset === 'number' && groupInfo.currentOffset > 0) {
            const totalBlocks = Math.ceil(groupInfo.totalItems / chunk);
            const chunksCompleted = Math.min(totalBlocks, Math.ceil(groupInfo.currentOffset / chunk));
            const blocksLeft = Math.max(0, totalBlocks - chunksCompleted);
            if (blocksLeft > 0) {
                return {
                    displayName: `${base} [${formatGalleryBlocksProgressLabel({ blocksLeft })}]`,
                    iconClass: 'fa-download'
                };
            }
        }
        return { displayName: base, iconClass: 'fa-download' };
    }

    // 🎯 SINGLE SOURCE OF TRUTH for ALL ticker display logic
    updateTickerDisplay() {
        // Update ticker badge
        this.updateTickerBadge();

        if (this.pendingRequestsCount === 0) {
            this.pruneOrphanPaginationGroups();
        }

        if (this.pendingRequestsCount === 0 && this.areAllPaginationGroupsComplete()) {
            // No pending requests and all pagination groups complete - clear cycle timer and show check mark for 2 seconds then close
            if (this.tickerCycleTimer) {
                clearTimeout(this.tickerCycleTimer);
                this.tickerCycleTimer = null;
                this.tickerCycleIndex = 0;
            }

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
                    if (this.pendingRequestsCount === 0) {
                        this.pruneOrphanPaginationGroups();
                    }
                    // Only hide if there are still no pending requests and pagination groups are complete
                    if (this.pendingRequestsCount === 0 && this.areAllPaginationGroupsComplete()) {
                        this.bannerManager.hideWebSocketTicker();
                        this.completionTimer = null;
                    }
                }, 2000);
            }
        } else {
            // Have pending requests - cancel any completion timer and start cycling through requests
            if (this.completionTimer) {
                clearTimeout(this.completionTimer);
                this.completionTimer = null;
            }
            // Always ensure ticker cycle is running when there are pending requests
            // If cycle is not running, start it (reset to beginning)
            // If cycle is running, check if we need to restart due to request changes
            const tickerRequests = this.getPendingRequestsForTicker();
            const needsRestart = !this.tickerCycleTimer || tickerRequests.length === 0;
            // Reset index when starting/restarting cycle (e.g., when requests change or cycle stopped)
            this.startTickerCycle(needsRestart);
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

    // Update ticker badge with current pending count (pagination group = one ticker row; see getPendingRequestsForTicker)
    updateTickerBadge() {
        if (!this.pendingRequests || this.pendingRequests.size === 0) {
            this.pruneOrphanPaginationGroups();
        }

        const tickerLen = this.getPendingRequestsForTicker().length;
        const mapSize = this.pendingRequests?.size || 0;

        if (mapSize === 0 && tickerLen === 0 && this.pendingRequestsCount > 0) {
            this.pendingRequestsCount = 0;
        }

        let displayCount = this.pendingRequestsCount;
        displayCount = Math.max(displayCount, tickerLen);

        if (displayCount > 0 && mapSize === 0 && tickerLen === 0) {
            this.pendingRequestsCount = 0;
            displayCount = 0;
        }

        const badges = document.querySelectorAll('.websocket-ticker-badge');
        badges.forEach(badge => {
            badge.textContent = displayCount > 0 ? String(displayCount) : '';
            badge.setAttribute('data-count', displayCount);
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

        // Set initial status from live connection state (connect() may already be in progress)
        const initialStatus = this.ws && this.ws.readyState === WebSocket.OPEN
            ? 'connected'
            : (this.isConnecting ? 'connecting' : 'disconnected');
        this.updateWebSocketStatus(initialStatus);
        this._refreshWsFlashTargets();
        this._startWsFlashVisibilityWatcher();
    }

    // Setup click handlers for ticker and indicators to open requests modal
    setupRequestsModalHandlers() {
        // Add click handler to all tickers
        const tickers = document.querySelectorAll('.websocket-ticker');
        tickers.forEach(ticker => {
            // Remove existing handler if any
            ticker.removeEventListener('click', this.openRequestsModalHandler);
            // Add click handler
            ticker.addEventListener('click', this.openRequestsModalHandler);
        });

        // Add click handler to all indicators
        this.websocketIndicators.forEach(indicator => {
            if (indicator.container) {
                // Remove existing handler if any
                indicator.container.removeEventListener('click', this.openRequestsModalHandler);
                // Add click handler
                indicator.container.addEventListener('click', this.openRequestsModalHandler);
            }
        });
    }

    // Open Event Viewer tasks sidebar (replaces legacy Task Manager modal)
    openRequestsModal() {
        if (typeof logViewerApplet !== 'undefined' && logViewerApplet) {
            logViewerApplet.open({ showTasksSidebar: true });
            return;
        }
        console.warn('Event Viewer not initialized');
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
        if (this._pingResponseWaitingFlash) {
            this.setPingResponseWaitingFlash(true);
        }

        // Re-setup click handlers for new indicators
        this.setupRequestsModalHandlers();
        this._refreshWsFlashTargets();

        this.logInfo(`WebSocket indicators refreshed. Found ${this.websocketIndicators.length} indicator(s).`);
    }

    /**
     * Slow server ping response while WebSocket still connected: flash status dot (CSS .ping-response-wait).
     * No-op if not connected — class only applies with .connected.
     */
    setPingResponseWaitingFlash(active) {
        this._pingResponseWaitingFlash = !!active;
        this.websocketIndicators.forEach(indicator => {
            if (!indicator.status) return;
            indicator.status.classList.toggle('ping-response-wait', !!(active && indicator.status.classList.contains('connected')));
        });
    }

    // Update WebSocket connection status for all indicators
    updateWebSocketStatus(status) {
        const statusClasses = {
            'connected': 'connected',
            'connecting': 'connecting',
            'disconnected': ''
        };

        const statusClass = statusClasses[status] || '';

        if (status !== 'connected') {
            this._pingResponseWaitingFlash = false;
        }

        // Update all indicators
        this.websocketIndicators.forEach(indicator => {
            if (indicator.status) {
                indicator.status.className = `websocket-status ${statusClass}`;
                if (status === 'connected' && this._pingResponseWaitingFlash) {
                    indicator.status.classList.add('ping-response-wait');
                }
            }
        });

        // Update ping display (tooltips and warning icon)
        // Only update if connected (ping data only available when connected)
        if (status === 'connected') {
            this.updatePingDisplay();
        } else {
            // Reset tooltips when disconnected/connecting
            this.websocketIndicators.forEach(indicator => {
                if (indicator.status) {
                    const statusText = status === 'connecting' ? 'Connecting...' : 'Disconnected';
                    indicator.status.setAttribute('title', `WebSocket Status\n${statusText}`);
                }
            });
            // Hide ping warning when not connected
            const warningIcon = document.getElementById('pingWarningIndicator');
            if (warningIcon) {
                warningIcon.classList.add('hidden');
            }
        }
    }

    // True when an element is actually shown (no layout reads — safe for deferred refresh).
    _isWsFlashElementVisible(el) {
        if (!el || document.hidden) return false;

        const modal = el.closest('.modal');
        if (modal && (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt'))) {
            return false;
        }

        let node = el;
        while (node && node !== document.documentElement) {
            if (node.classList?.contains('hidden') || node.classList?.contains('hidden-alt')) {
                return false;
            }
            const style = getComputedStyle(node);
            if (style.display === 'none' || style.visibility === 'hidden' || parseFloat(style.opacity) === 0) {
                return false;
            }
            node = node.parentElement;
        }

        if (typeof el.checkVisibility === 'function') {
            return el.checkVisibility({ checkOpacity: true, checkVisibilityCSS: true });
        }
        return true;
    }

    _isWsFlashVisibilityMutationTarget(node) {
        if (!node || node.nodeType !== 1) return false;
        if (node === document.body) return true;
        if (node.classList?.contains('modal')) return true;
        if (node.classList?.contains('websocket-indicator')) return true;
        if (node.id === 'connectionDialModal' || node.id === 'connectionDialStats') return true;
        return !!node.closest?.('.websocket-indicator, #connectionDialModal, #connectionDialStats');
    }

    // Rebuild cached list of visible traffic arrows (called on interval and when indicators refresh).
    _refreshWsFlashTargets() {
        const targets = [];

        this.websocketIndicators.forEach(indicator => {
            if (indicator.upArrow && this._isWsFlashElementVisible(indicator.upArrow)) {
                targets.push({ arrow: indicator.upArrow, timeoutKey: 'upTimeout', timeoutStore: indicator });
            }
            if (indicator.downArrow && this._isWsFlashElementVisible(indicator.downArrow)) {
                targets.push({ arrow: indicator.downArrow, timeoutKey: 'downTimeout', timeoutStore: indicator });
            }
        });

        if (!this._melatonTrafficUp) {
            this._melatonTrafficUp = document.getElementById('connectionTrafficUp');
        }
        if (!this._melatonTrafficDown) {
            this._melatonTrafficDown = document.getElementById('connectionTrafficDown');
        }
        if (!this._melatonTrafficTimeouts) {
            this._melatonTrafficTimeouts = { upTimeout: null, downTimeout: null };
        }
        if (this._melatonTrafficUp && this._isWsFlashElementVisible(this._melatonTrafficUp)) {
            targets.push({ arrow: this._melatonTrafficUp, timeoutKey: 'upTimeout', timeoutStore: this._melatonTrafficTimeouts });
        }
        if (this._melatonTrafficDown && this._isWsFlashElementVisible(this._melatonTrafficDown)) {
            targets.push({ arrow: this._melatonTrafficDown, timeoutKey: 'downTimeout', timeoutStore: this._melatonTrafficTimeouts });
        }

        this._wsFlashTargets = targets;
    }

    _scheduleWsFlashVisibilityRefresh() {
        if (this._wsFlashVisibilityRefreshRaf) return;
        this._wsFlashVisibilityRefreshRaf = requestAnimationFrame(() => {
            this._wsFlashVisibilityRefreshRaf = null;
            this._refreshWsFlashTargets();
        });
    }

    _startWsFlashVisibilityWatcher() {
        if (!this._wsFlashVisibilityObserver) {
            this._wsFlashVisibilityObserver = new MutationObserver((mutations) => {
                for (let i = 0; i < mutations.length; i++) {
                    if (this._isWsFlashVisibilityMutationTarget(mutations[i].target)) {
                        this._scheduleWsFlashVisibilityRefresh();
                        return;
                    }
                }
            });
            this._wsFlashVisibilityObserver.observe(document.body, {
                subtree: true,
                attributes: true,
                attributeFilter: ['class']
            });
        }

        if (!this._wsFlashVisibilityInterval) {
            this._wsFlashVisibilityInterval = setInterval(() => {
                this._refreshWsFlashTargets();
            }, 5000);
        }
    }

    _stopWsFlashVisibilityWatcher() {
        if (this._wsFlashVisibilityObserver) {
            this._wsFlashVisibilityObserver.disconnect();
            this._wsFlashVisibilityObserver = null;
        }
        if (this._wsFlashVisibilityInterval) {
            clearInterval(this._wsFlashVisibilityInterval);
            this._wsFlashVisibilityInterval = null;
        }
        if (this._wsFlashVisibilityRefreshRaf) {
            cancelAnimationFrame(this._wsFlashVisibilityRefreshRaf);
            this._wsFlashVisibilityRefreshRaf = null;
        }
        if (this._wsFlashRafId) {
            cancelAnimationFrame(this._wsFlashRafId);
            this._wsFlashRafId = null;
        }
        this._wsFlashPendingUp = null;
        this._wsFlashPendingDown = null;
    }

    _teardownGenerationUiState() {
        if (this.progressStates) {
            for (const requestId of [...this.progressStates.keys()]) {
                this.cleanupGenerationProgressState(requestId);
            }
        }
        this.clearStreamingStepQueues(null, true);
    }

    // Queue DOM flash work off the WebSocket message path (rAF runs after current task).
    _queueWsFlashApply() {
        if (this._wsFlashRafId) return;
        this._wsFlashRafId = requestAnimationFrame(() => {
            this._wsFlashRafId = null;
            if (document.hidden) {
                this._wsFlashPendingUp = null;
                this._wsFlashPendingDown = null;
                return;
            }

            const now = performance.now();
            if (now - this._wsFlashLastApply < this._wsFlashMinInterval) {
                this._queueWsFlashApply();
                return;
            }

            const upDuration = this._wsFlashPendingUp;
            const downDuration = this._wsFlashPendingDown;
            if (upDuration == null && downDuration == null) return;

            this._wsFlashPendingUp = null;
            this._wsFlashPendingDown = null;
            this._wsFlashLastApply = now;
            this._refreshWsFlashTargets();

            if (upDuration != null) {
                this._applyWebSocketArrowFlash('up', upDuration);
            }
            if (downDuration != null) {
                this._applyWebSocketArrowFlash('down', downDuration);
            }
        });
    }

    _applyWebSocketArrowFlash(direction, duration = 500) {
        if (document.hidden || !this._wsFlashTargets.length) return;

        const timeoutType = direction === 'up' ? 'upTimeout' : 'downTimeout';

        const flashArrow = (arrow, timeoutKey, timeoutStore) => {
            if (!arrow) return;
            if (timeoutStore[timeoutKey]) {
                clearTimeout(timeoutStore[timeoutKey]);
            } else {
                arrow.classList.add('active');
            }
            timeoutStore[timeoutKey] = setTimeout(() => {
                arrow.classList.remove('active');
                timeoutStore[timeoutKey] = null;
            }, duration);
        };

        this._wsFlashTargets.forEach(target => {
            if (target.timeoutKey !== timeoutType) return;
            flashArrow(target.arrow, target.timeoutKey, target.timeoutStore);
        });
    }

    // Record traffic for a deferred flash — no DOM work on the WebSocket message path.
    flashWebSocketArrow(direction, duration = 500) {
        if (document.hidden) return;
        if (direction === 'up') {
            this._wsFlashPendingUp = duration;
        } else {
            this._wsFlashPendingDown = duration;
        }
        this._queueWsFlashApply();
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

        if (this._melatonTrafficTimeouts) {
            ['upTimeout', 'downTimeout'].forEach(timeoutType => {
                if (this._melatonTrafficTimeouts[timeoutType]) {
                    clearTimeout(this._melatonTrafficTimeouts[timeoutType]);
                    this._melatonTrafficTimeouts[timeoutType] = null;
                }
            });
        }
        if (this._melatonTrafficUp) {
            this._melatonTrafficUp.classList.remove('active');
        }
        if (this._melatonTrafficDown) {
            this._melatonTrafficDown.classList.remove('active');
        }
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


    // Get all pending requests that should be shown in the ticker
    getPendingRequestsForTicker() {
        const tickerRequests = [];
        const paginationGroupsSeen = new Set();

        if (this.pendingRequests && this.pendingRequests.size > 0) {
            for (const [requestId, request] of this.pendingRequests) {
                if (this.requestUsesPaginationGroup(request) && request.paginationGroupId) {
                    const gid = request.paginationGroupId;
                    if (!paginationGroupsSeen.has(gid)) {
                        const groupInfo = this.getPaginationGroupInfo(gid);
                        if (groupInfo) {
                            tickerRequests.push({
                                requestId: `pagination_${gid}`,
                                request: {
                                    ...request,
                                    type: 'request_gallery_paginated',
                                    paginationGroupId: gid,
                                    paginationInfo: groupInfo,
                                    showBanner: true
                                }
                            });
                            paginationGroupsSeen.add(gid);
                        }
                    }
                    continue;
                }
                if (request.showBanner !== false && request.type) {
                    tickerRequests.push({ requestId, request });
                }
            }
        }

        // Placeholder rows: pending map can be empty between chunk resolve and next send; group still has hasMore
        if (this.paginationGroups && this.paginationGroups.size > 0) {
            for (const groupId of this.paginationGroups.keys()) {
                if (paginationGroupsSeen.has(groupId)) continue;
                if (this.isPaginationGroupComplete(groupId)) continue;
                const groupInfo = this.getPaginationGroupInfo(groupId);
                if (!groupInfo) continue;
                tickerRequests.push({
                    requestId: `pagination_placeholder_${groupId}`,
                    request: {
                        type: 'request_gallery_paginated',
                        paginationGroupId: groupId,
                        paginationInfo: groupInfo,
                        showBanner: true,
                        paginationPlaceholder: true
                    }
                });
            }
        }

        return tickerRequests;
    }

    // Start cycling through pending requests in the ticker
    startTickerCycle(resetIndex = false) {
        const tickerRequests = this.getPendingRequestsForTicker();
        const hasTickerWork =
            this.pendingRequestsCount > 0 ||
            tickerRequests.length > 0;

        if (!hasTickerWork) {
            if (this.tickerCycleTimer) {
                clearTimeout(this.tickerCycleTimer);
                this.tickerCycleTimer = null;
            }
            this.tickerCycleIndex = 0;
            return;
        }

        const wasRunning = !!this.tickerCycleTimer;
        if (this.tickerCycleTimer) {
            clearTimeout(this.tickerCycleTimer);
            this.tickerCycleTimer = null;
        }

        if (tickerRequests.length === 0) {
            this.tickerCycleIndex = 0;
            return;
        }

        // Reset index if requested (e.g., when restarting due to new requests) or if out of bounds
        if (resetIndex || !wasRunning || this.tickerCycleIndex >= tickerRequests.length) {
            this.tickerCycleIndex = 0;
        }

        // Ensure index is valid
        if (this.tickerCycleIndex < 0 || this.tickerCycleIndex >= tickerRequests.length) {
            this.tickerCycleIndex = 0;
        }

        // Show current request - this will also expand the ticker if it's hidden
        const current = tickerRequests[this.tickerCycleIndex];
        let displayName = this.bannerManager.formatRequestType(current.request.type);
        let iconClass = 'fa-spinner-third fa-spin';

        if (current.request.paginationInfo) {
            const tick = this.formatPaginationGroupTickerText(current.request.paginationInfo);
            displayName = tick.displayName;
            iconClass = tick.iconClass;
        }

        this.bannerManager.showWebSocketTicker('info', displayName, iconClass, false);

        // Move to next request after 2 seconds
        this.tickerCycleTimer = setTimeout(() => {
            const nextRequests = this.getPendingRequestsForTicker();
            if (this.pendingRequestsCount > 0 || nextRequests.length > 0) {
                this.tickerCycleIndex++;
                this.startTickerCycle(false);
            } else {
                this.tickerCycleTimer = null;
                this.tickerCycleIndex = 0;
            }
        }, 2000);
    }

    // Show the oldest pending request in the ticker (prioritizing showBanner requests)
    // Kept for backward compatibility, but now redirects to cycle
    showOldestPendingRequest() {
        this.startTickerCycle();
    }

    // Resolve pending request
    resolveRequest(requestId, data, error = null) {
        if (!this.pendingRequests) {
            console.warn(`⚠️ resolveRequest called but pendingRequests not initialized for ID: ${requestId}`);
            return;
        }

        if (this.pendingRequests.has(requestId)) {
            const request = this.pendingRequests.get(requestId);
            // Oldest pending = first Map entry; must read before delete (was incorrectly using first remaining key after delete)
            const wasDisplayedRequest = request.showBanner !== false && !!request.type &&
                requestId === this.pendingRequests.keys().next().value;

            this.pendingRequests.delete(requestId);

            const generationRequestTypes = new Set(['generate_image', 'generate_preset', 'expand_image', 'reroll_expanded_image']);
            if (generationRequestTypes.has(request.type)) {
                this.cleanupGenerationProgressState(requestId);
            }

            // Clear timeout safely
            request.timeoutId = this.clearTimeoutSafely(request.timeoutId);

            // Handle pagination group completion
            let shouldDecrementCounter = true;
            if (this.requestUsesPaginationGroup(request) && request.paginationGroupId) {
                // Update pagination group progress
                if (this.paginationGroups && this.paginationGroups.has(request.paginationGroupId)) {
                    const group = this.paginationGroups.get(request.paginationGroupId);
                    group.completedRequests++;

                    // Update pagination info if available in response data
                    if (data && data.pagination) {
                        const responseChunkLength = Array.isArray(data.gallery) ? data.gallery.length : 0;
                        const completedOffset = Math.max(0, Number(request.offset) || 0) + responseChunkLength;
                        this.updatePaginationProgress(request.paginationGroupId, data.pagination, completedOffset);
                    }

                    // Only decrement counter if this is the last request in the group or no more pages
                    shouldDecrementCounter = this.isPaginationGroupComplete(request.paginationGroupId);
                }
            }

            const silentTicker = request.silentTicker || this.isSilentTickerRequest(request.type);

            // Track completed request (only if not ping / silent ticker poll)
            if (request.type && request.type !== 'ping' && !silentTicker) {
                const completedAt = Date.now();
                const duration = request.timestamp ? completedAt - request.timestamp : null;

                const completedRequest = {
                    id: requestId,
                    type: request.type,
                    timestamp: request.timestamp,
                    completedAt: completedAt,
                    duration: duration,
                    error: error ? (error.message || error) : null,
                    paginationGroupId: request.paginationGroupId,
                    isGalleryPaginationRequest: request.isGalleryPaginationRequest
                };

                // Add to completed requests array
                this.completedRequests = this.completedRequests || [];
                this.completedRequests.push(completedRequest);

                // Keep only last maxCompletedRequests
                if (this.completedRequests.length > this.maxCompletedRequests) {
                    this.completedRequests.shift();
                }
            }

            // Decrement pending requests count only if not part of incomplete pagination group
            if (shouldDecrementCounter && !silentTicker) {
                this.decrementPendingRequests();
            }

            const paginationHasMoreData =
                (request.isGalleryPaginationRequest || request.isPaginationRequest) &&
                data &&
                data.pagination &&
                data.pagination.hasMore === true;

            // Handle completion display if this was the oldest pending request (matches ticker "primary" slot when not cycling)
            // Omit per-chunk success while pagination continues so the ticker stays on loading until the last block.
            if (wasDisplayedRequest && !paginationHasMoreData) {
                // Show completion with check mark for 2 seconds (only if showBanner is true)
                const displayName = this.bannerManager.formatRequestType(request.type);
                this.bannerManager.showWebSocketTicker('success', displayName, 'fa-check', true, 2000);

                // After completion display, update ticker to show next request or close
                setTimeout(() => {
                    this.updateTickerDisplay();
                }, 2100);
            } else if (!paginationHasMoreData) {
                // Mid-pagination chunks: updatePaginationProgress schedules updateTickerDisplay(0); pending map can be
                // empty until the next send — do not sync refresh or we clear the cycle with no rows to show.
                this.updateTickerDisplay();
            }

            // Handle gallery pagination state changes
            if (request.type === 'request_gallery' && data && data.pagination) {
                const requestLimit = Number(request.limit) || 0;
                const isPartialGalleryRequest = requestLimit > 0 && requestLimit < 750;
                const shouldEnableGalleryPagination = data.pagination.hasMore && requestLimit > 0 && !isPartialGalleryRequest;
                if (shouldEnableGalleryPagination && !this.isGalleryLoadingActive) {
                    // This response indicates pagination has started - set the flag for future requests
                    this.isGalleryLoadingActive = true;
                    // Don't create pagination group yet - wait for the next request
                } else if (!data.pagination.hasMore && this.isGalleryLoadingActive) {
                    // This was the final pagination chunk
                    this.completeGalleryLoading();
                }
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