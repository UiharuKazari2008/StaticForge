/**
 * Global Resource Manager
 * Centralized initialization and access to large datasets and services
 * Loads once at server startup and provides global access
 */

const path = require('path');
const crypto = require('crypto');
const nekoaijs = require('nekoai-js');
const OpenAI = require('openai');
const SpellChecker = require('./spellChecker');
const WordLookupService = require('./wordLookupService');
const t5TokenizerService = require('./t5-tokenizer-service');
const { buildPresetTokenCountCache } = require('./presetTokenCountCache');
const apiKeyManager = require('./apiKeyManager');
const applicationAuthDatabase = require('./applicationAuthDatabase');
const telemetryDatabase = require('./telemetryDatabase');
const { GenerationQuipsManager } = require('./generationQuipsManager');
const NovelHandlers = require('./novelHandlers');
const DatasetTagService = require('./datasetTagService');
const FavoritesManager = require('./favorites');
const MemoryManager = require('./memoryManager');
const PromptManager = require('./promptManager');
const AIServiceManager = require('./aiServiceManager');
const GrokService = require('./aiServices/grokService');
const XaiNativeService = require('./aiServices/xaiNativeService');
const PromptLogitAnalyzer = require('./promptLogitAnalyzer');
const WorkspaceManager = require('./workspace');
const Queue = require('./queue');
const { normalizeNovelAiSubscription } = require('./novelAiSubscription');
const { NovelAiStatusMonitor } = require('./novelAiStatusMonitor');
const {
    evaluateAccountDataHealth,
    getAccountHealthPublicFields,
    evaluateAccountHealthAfterBalanceSync,
} = require('./accountDataHealth');
const {
    recordSubscriptionRefresh,
    getAccountSubscriptionNoticeFields,
} = require('./accountSubscriptionSnapshot');
const notesDatabase = require('./notesDatabase');
const vfsDatabase = require('./vfsDatabase');
const TagAutofillSearch = require('./tagAutofillSearch');
const logger = require('./logger');
const { WebSocketServer } = require('./websocket');
const dataPlumbing = require('./dataPlumbing');
const { ConfigManager, GlobalCheckpointManager } = require('./configManager');
const { LRUCache } = require('./lruCache');
const imageCounter = require('./imageCounter');
const tracing = require('./tracing');
const ParallelPreviewGenerator = require('./parallelPreviewGenerator');
const PngMetadata = require('./pngMetadata');
const { ensureForgeSigningKeys } = require('./forgeSigning');
const TextReplacements = require('./textReplacements');
const LocalPromptOptimizer = require('./localPromptOptimizer');
const ConfigEditorService = require('./configEditorService');
const CheckpointManagementService = require('./checkpointManagementService');
const staticWiki = require('./staticWiki');
const fandomWiki = require('./fandomWiki');
const grimoireDomainRegistry = require('./grimoireDomainRegistry');
const { TagSuggestionsCache } = require('./cache');
const { createAuthMiddleware, createDevAuthMiddleware } = require('./auth');
const polymoduleManager = require('./polymoduleManager');
const { NodeHtmlMarkdown } = require('node-html-markdown');
const { INIT_STEPS, databases: bootstrapDatabases } = require('./bootstrap/initSteps');

class GlobalResources {
    constructor() {
        this.initialized = false;
        this.initStartTime = null;
        this.initEndTime = null;

        // Unified paths map - single source of truth for all directory paths
        this.paths = this.initializePaths();

        // Tag search services
        this.animeTagSearch = null;
        this.furryTagSearch = null;
        this.fastTagSearch = null;

        // Other services
        this.spellChecker = null;
        this.t5Tokenizer = null;
        this.presetTokenCounts = null;
        this.modelFeatures = null;
        this.searchService = null; // Lazy-loaded to avoid circular dependency
        this.textReplacements = null; // Will be initialized after configs are loaded
        this.staticWiki = null;
        this.fandomWiki = null;
        this.grimoireDomainRegistry = null;
        this.localPromptOptimizer = null;
        this.configEditorService = null;
        this.tagSuggestionsCache = null;
        this.authMiddleware = null;
        this.devAuthMiddleware = null;
        this.knowledgeMemoryDb = null;
        this.tagSearchDatabase = null;
        this.naxTagsDatabase = null;
        this.naxTagGeneration = null;
        this.naxVibesGallery = null;
        this.novelaiExploreGallery = null;
        this.referenceMetadataDatabase = null;
        this.generationQuipsDatabase = null;
        this.generationQuipsManager = null;
        this.novelAiStatusMonitor = null;
        this.replicationService = null;
        this.replicationMaintenance = null;
        this.replicationChangelog = null;
        this.bootCycleId = crypto.randomUUID();
        this.datasetTagService = null;

        // Singleton managers (already instantiated as singletons)
        this.memoryManager = null;
        this.promptManager = null;
        this.aiServiceManager = null;
        this.grokService = null;
        this.xaiNativeService = null;
        this.promptLogitAnalyzer = null;

        // Workspace module (exports functions)
        this.workspace = null;

        // Queue module (exports functions)
        this.queue = null;

        // SQLite databases
        this.metadataDatabase = null;
        this.chatDatabase = null;
        this.directorDatabase = null;
        this.notesDatabase = null;
        this.tagDatabase = null;
        this.tagAutofillSearch = null;

        // Async SQLite manager
        this.asyncSQLiteManager = null;

        // Logger (singleton)
        this.logger = null;

        // Server instances
        this.expressApp = null;
        this.httpServer = null;
        this.webSocketServer = null;
        this.wsMessageHandlers = null;
        this.sessionStore = null;

        // Character data for auto-complete
        this.characterDataArray = null;

        // Client registry (shared services like API clients)
        this.clients = new Map();
        this.novelAiClient = null;
        this.grokClient = null;
        this.apiKeyManager = null; // Will be initialized after configs are loaded
        this.applicationAuthManager = null;
        this.applicationAuthEarlyMiddleware = null;
        this.restartHandlers = new Map();

        // Account data management - balance is stored at accountData.subscription.trainingStepsLeft
        this.accountData = {
            ok: false,
            subscription: {
                trainingStepsLeft: {
                    fixedTrainingStepsLeft: 0,
                    purchasedTrainingSteps: 0
                }
            }
        };
        this.lastBalanceCheck = 0;
        this.lastAccountDataCheck = 0;
        // Task 1 account health — see modules/accountDataHealth.js (Tasks 2/3 consume via get_app_options / ping)
        this.accountDataHealth = evaluateAccountDataHealth({ ok: false, reason: 'not_initialized' });
        this.refreshBalanceCallback = null; // Callback function to refresh balance (set from web_server.js)
        this.getBalanceCallback = null; // Callback function to get balance (set from web_server.js)
        this.getUserDataCallback = null; // Callback function to get user data (set from web_server.js)

        // Favorites manager (singleton)
        this.favoritesManager = null;

        // Search service (lazy-loaded to avoid circular dependencies)
        this.searchService = null;
        this.runpodPodManager = null;

        // Security and IP blocking system
        this.blockedIPs = new Map(); // IP -> { blockedAt, reason, attempts }
        this.suspiciousIPs = new Map(); // IP -> { attempts, lastSeen, patterns }
        this.invalidURLAttempts = new Map(); // IP -> { count, lastAttempt }
        this.knownBadPaths = new Map(); // normalized path -> { firstSeen, lastSeen, hits }
        this._knownBadPathsLoaded = false;
        this._knownBadPathsSaveTimer = null;

        // Cache data management
        this.globalCacheData = [];
        this.lastCacheCheck = 0;

        // Timer management system - centralized timer tracking
        this.timers = new Map(); // timerId -> { type: 'interval'|'timeout', id: timerId, name: string, interval: number, callback: function, createdAt: number, lastRun: number }

        // Data plumbing system - for managing data flow between modules, functions, and async processes
        this.dataPlumbing = dataPlumbing;

        // Custom resolutions storage
        this.customResolutions = new Map(); // Map of resolution name -> { width, height }
        this._expandedResolutionCache = null; // Cached expanded Resolution object
        this._customResolutionsDirty = false; // Flag to track if cache needs regeneration
        this._resolutionDimensionsMap = null; // Cached map of all resolution names -> { width, height } for O(1) lookups

        // Utility modules (store references for centralized access)
        this.imageCounter = imageCounter;
        this.tracing = tracing;
        this.parallelPreviewGenerator = new ParallelPreviewGenerator(this, {});

        // Initialize pngMetadata with reference to this (avoid circular dependency)
        this.pngMetadata = new PngMetadata(this);

        // Polymorphic module manager (for modules not written in Node.js)
        this.polymoduleManager = polymoduleManager;

        // HTML to Markdown converter
        this.nhm = null

        // Config management - unified structure for all configs
        // ConfigManager will be initialized in initializeConfigs()
        this.configManager = null;
        this.globalCheckpointManager = null;

        // LRU caches for weather and location data
        this.weatherCache = null;
        this.locationCache = null;

        // System information cache (refreshed hourly)
        this.systemInfoCache = null;
        this.systemInfoCacheTimestamp = 0;
        this.systemInfoRefreshInterval = null;

        // Initialization status
        this.initializationProgress = {
            animeTagSearch: false,
            furryTagSearch: false,
            fastTagSearch: false,
            spellChecker: false,
            t5Tokenizer: false,
            searchService: false,
            favoritesManager: false,
            characterData: false,
            knowledgeMemoryDb: false,
            tagSearchDatabase: false,
            naxTagsDatabase: false,
            naxTagGeneration: false,
            referenceMetadataDatabase: false,
            generationQuipsDatabase: false,
            charactersDatabase: false,
            generationQuipsManager: false,
            generationQuipsAutoUpdate: false,
            datasetTagService: false,
            memoryManager: false,
            promptManager: false,
            aiServiceManager: false,
            grokService: false,
            xaiNativeService: false,
            novelAiClient: false,
            grokClient: false,
            workspace: false,
            queue: false,
            metadataDatabase: false,
            chatDatabase: false,
            directorDatabase: false,
            logger: false,
            expressApp: false,
            httpServer: false,
            webSocketServer: false
        };
    }

    /**
     * Initialize unified paths map - single source of truth for all directory paths
     * Update paths here and they're available everywhere via globalResources.getPath()
     */
    initializePaths() {
        const rootDir = path.resolve(__dirname, '..');
        return {
            // Root directories
            root: rootDir,
            modules: path.join(rootDir, 'modules'),

            // Main directories
            images: path.resolve(rootDir, 'images'),
            cache: path.resolve(rootDir, '.cache'),
            previews: path.resolve(rootDir, '.previews'),
            logs: path.resolve(rootDir, 'logs'),
            securePrompts: path.resolve(rootDir, 'securePrompts'),

            // Cache subdirectories
            uploadCache: path.join(rootDir, '.cache', 'upload'),
            previewCache: path.join(rootDir, '.cache', 'preview'),
            vibeCache: path.join(rootDir, '.cache', 'vibe'),
            tempDownload: path.join(rootDir, '.cache', 'tempDownload'),
            presetSourceCache: path.join(rootDir, '.cache', 'preset_source'),
            userFiles: path.join(rootDir, '.cache', 'userFiles'),
            sessions: path.join(rootDir, '.cache', 'sessions'),

            // Database files (directory path, not file path)
            databases: path.join(rootDir, '.cache'),

            // Config files
            config: path.resolve(rootDir, 'config.json'),
            secureConfig: path.resolve(rootDir, 'secure.config.json'),
            promptConfig: path.resolve(rootDir, 'prompt.config.json'),
            directorConfig: path.resolve(rootDir, 'director.config.json'),
            modelFeatures: path.resolve(rootDir, 'config', 'model-features.json'),
            favorites: path.join(rootDir, '.cache', 'favorites.json'),
            characters: path.resolve(rootDir, 'characters.json'),

            // Workspace files
            workspaceFile: path.join(rootDir, '.cache', 'workspace.json'),
            workspaceDesktopFile: path.join(rootDir, '.cache', 'workspace-desktop.json'),

            // Dataset files
            datasetTagGroups: path.resolve(rootDir, 'dataset_tag_groups.json'),
            tagToPathIndex: path.join(rootDir, '.cache', 'tag_to_path_index.json'),

            // NAXT tag galleries SQLite (scripts/import-nax-tags.js)
            naxTagsDb: path.join(rootDir, '.cache', 'nax_tags.db'),
            naxImages: path.join(rootDir, '.cache', 'nax_images'),
            naxGenerationConfig: path.resolve(rootDir, 'nax_generation_config.json'),

            // Tag wiki database (scripts/create-tag-database.js)
            wiki: path.join(rootDir, '.cache', 'wiki'),

            // Cache files
            tagCacheFile: path.join(rootDir, '.cache', 'tag_cache.json'),
            systemMessageCacheFile: path.join(rootDir, '.cache', 'system_message_cache.json'),

            // Config file maps
            configMaps: path.resolve(rootDir, 'config-maps'),

            // IP exports (scripts/ip-export.js)
            ipExports: path.join(rootDir, '.cache', 'ip_exports'),
            knownBadPathsFile: path.join(rootDir, '.cache', 'known_bad_paths.json'),

            // Dataset tags (scripts/create-tag-database.js)
            datasetTags: path.resolve(rootDir, 'dataset_tags.json'),
            datasetTagsFurry: path.resolve(rootDir, 'dataset_tags_furry.json'),

            // Custom words (scripts/create-custom-words.js)
            customWords: path.join(rootDir, '.cache', 'customWords.json'),

            // T5 tokenizer config (public/protected/t5_tokenizer.json)
            t5TokenizerConfig: path.resolve(rootDir, 'public/protected/t5_tokenizer.json'),

            // T5 vocabulary (securePrompts/t5-vocabulary.json)
            t5Vocabulary: path.resolve(rootDir, 'securePrompts/t5-vocabulary.json'),

            // Anime search index (scripts/create-anime-search-index.js)
            animeSearchIndex: path.join(rootDir, '.cache', 'anime_search_index.json'),
            animeWordIndex: path.join(rootDir, '.cache', 'anime_word_index.json'),
            animePrefixIndex: path.join(rootDir, '.cache', 'anime_prefix_index.json'),
            animeSuffixIndex: path.join(rootDir, '.cache', 'anime_suffix_index.json'),
            animeWordsIndex: path.join(rootDir, '.cache', 'anime_words_index.json'),
            furrySearchIndex: path.join(rootDir, '.cache', 'furry_search_index.json'),
            furryWordIndex: path.join(rootDir, '.cache', 'furry_word_index.json'),
            furryPrefixIndex: path.join(rootDir, '.cache', 'furry_prefix_index.json'),
            furrySuffixIndex: path.join(rootDir, '.cache', 'furry_suffix_index.json'),

            // Image counter (scripts/image-counter.js)
            imageCounterFile: path.join(rootDir, '.cache', 'image_counter.json'),
            accountSubscriptionSnapshot: path.join(rootDir, '.cache', 'account_subscription_snapshot.json'),
        };
    }

    /**
     * Get a unified path by key
     * @param {string} key - Path key (e.g., 'images', 'cache', 'uploadCache')
     * @returns {string} Resolved path
     */
    getPath(key) {
        if (!this.paths[key]) {
            throw new Error(`Unknown path key: ${key}. Available keys: ${Object.keys(this.paths).join(', ')}`);
        }
        return this.paths[key];
    }

    /**
     * Get all paths as a read-only object
     * @returns {Object} Copy of paths map
     */
    getAllPaths() {
        return { ...this.paths };
    }

    /**
     * Get config
     * @param {Object} options - Options
     * @param {boolean} options.clone - If true, returns a deep clone of the config
     * @param {string|string[]} options.path - Optional path to get sub-value (auto-cloned)
     * @returns {Object} Config object or sub-value
     * 
     * @example
     * // Get entire config
     * const config = getConfig();
     * 
     * // Get cloned sub-value (safe to modify)
     * const apiKeys = getConfig({ path: 'selectedApiKeys', clone: true });
     */
    getConfig(options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const { path: keyPath, clone } = options;

        if (keyPath) {
            return this.configManager._getReactiveConfig('config', keyPath, clone === true);
        }

        return this.configManager._getReactiveConfig('config', null, clone === true);
    }

    /**
     * Get secure config
     * @param {Object} options - Options
     * @param {boolean} options.clone - If true, returns a deep clone of the config
     * @param {string|string[]} options.path - Optional path to get sub-value (auto-cloned)
     * @returns {Object} Secure config object or sub-value
     */
    getSecureConfig(options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const { path: keyPath, clone } = options;

        if (keyPath) {
            return this.configManager._getReactiveConfig('secureConfig', keyPath, clone === true);
        }

        return this.configManager._getReactiveConfig('secureConfig', null, clone === true);
    }

    /**
     * Get prompt config
     * @param {Object} options - Options
     * @param {boolean} options.clone - If true, returns a deep clone of the config
     * @param {string|string[]} options.path - Optional path to get sub-value (auto-cloned)
     * @returns {Object} Prompt config object or sub-value
     * 
     * @example
     * // Get entire config
     * const config = getPromptConfig();
     * 
     * // Get cloned preset (safe to modify)
     * const preset = getPromptConfig({ path: 'presets.myPreset' });
     */
    getPromptConfig(options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const { path: keyPath, clone } = options;

        if (keyPath) {
            return this.configManager._getReactiveConfig('promptConfig', keyPath, clone === true);
        }

        return this.configManager._getReactiveConfig('promptConfig', null, clone === true);
    }

    /**
     * Get director config
     * @param {Object} options - Options
     * @param {boolean} options.clone - If true, returns a deep clone of the config
     * @returns {Object} Director config object
     */
    getDirectorConfig(options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const { path: keyPath, clone } = options;

        if (keyPath) {
            return this.configManager._getReactiveConfig('directorConfig', keyPath, clone === true);
        }

        return this.configManager._getReactiveConfig('directorConfig', null, clone === true);
    }

    /**
     * Get favorites
     * @param {Object} options - Options
     * @param {boolean} options.clone - If true, returns a deep clone of the config
     * @param {string|string[]} options.path - Optional path to get sub-value (auto-cloned)
     * @returns {Object} Favorites object or sub-value
     */
    getFavorites(options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const { path: keyPath, clone } = options;

        if (keyPath) {
            return this.configManager._getReactiveConfig('favorites', keyPath, clone === true);
        }

        return this.configManager._getReactiveConfig('favorites', null, clone === true);
    }

    /**
     * Get workspaces
     * @param {Object} options - Options
     * @param {boolean} options.clone - If true, returns a deep clone of the config
     * @param {string|string[]} options.path - Optional path to get sub-value (auto-cloned)
     * @returns {Object} Workspaces object or sub-value
     */
    getWorkspacesConfig(options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const { path: keyPath, clone } = options;

        if (keyPath) {
            return this.configManager._getReactiveConfig('workspaces', keyPath, clone === true);
        }

        return this.configManager._getReactiveConfig('workspaces', null, clone === true);
    }

    /**
     * Update workspaces in-memory cache without persisting gallery membership arrays to disk.
     * SQL gallery_workspace_ownership is the source of truth for files/scraps/pins.
     */
    setWorkspacesConfigCache(workspaces) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const configInfo = this.configManager._configs?.workspaces;
        if (!configInfo) {
            throw new Error('Workspaces config not loaded');
        }
        configInfo.cache = workspaces;
    }

    /**
     * Get workspace desktop config
     * @param {Object} options - Options
     * @param {boolean} options.clone - If true, returns a deep clone of the config
     * @param {string|string[]} options.path - Optional path to get sub-value (auto-cloned)
     * @returns {Object} Workspace desktop object or sub-value
     */
    getWorkspaceDesktopConfig(options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        const { path: keyPath, clone } = options;

        if (keyPath) {
            return this.configManager._getReactiveConfig('workspaceDesktop', keyPath, clone === true);
        }

        return this.configManager._getReactiveConfig('workspaceDesktop', null, clone === true);
    }

    /**
     * Save config to disk
     * @param {string} configType - 'config', 'secureConfig', 'promptConfig', 'directorConfig', 'favorites', 'workspaces', or 'workspaceDesktop'
     * @param {Object} configData - Config object to save (optional, uses cached if not provided)
     * @param {Object} options - Save options
     * @param {boolean} options.skipCheckpoint - If true, skip creating a checkpoint (default: false)
     */
    saveConfig(configType = 'config', configData = null, options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        return this.configManager.saveConfig(configType, configData, options);
    }

    /**
     * Update a specific value in config by key path (avoids cloning entire config)
     * @param {string} configType - Config type
     * @param {string|string[]} keyPath - Dot-separated path or array of keys
     * @param {*} value - Value to set
     * @param {Object} options - Save options
     * @returns {boolean} Success status
     */
    updateConfigValue(configType, keyPath, value, options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        return this.configManager.updateConfigValue(configType, keyPath, value, options);
    }

    /**
     * Add item to an array in config
     * @param {string} configType - Config type
     * @param {string|string[]} keyPath - Path to array
     * @param {*} item - Item to add
     * @param {Object} options - Save options
     * @returns {boolean} Success status
     */
    addToConfigArray(configType, keyPath, item, options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        return this.configManager.addToConfigArray(configType, keyPath, item, options);
    }

    /**
     * Remove item(s) from an array in config
     * @param {string} configType - Config type
     * @param {string|string[]} keyPath - Path to array
     * @param {Function|*} predicateOrValue - Predicate function or value to match
     * @param {Object} options - Save options
     * @returns {boolean} Success status
     */
    removeFromConfigArray(configType, keyPath, predicateOrValue, options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        return this.configManager.removeFromConfigArray(configType, keyPath, predicateOrValue, options);
    }

    /**
     * Modify config using a callback function OR return fluent API
     * @param {string} configType - Config type
     * @param {Function} [modifierFn] - Optional function that modifies config
     * @param {Object} [options] - Save options
     * @returns {boolean|ConfigModifier} Success status or ConfigModifier for fluent API
     * 
     * @example
     * // Callback style
     * modifyConfig('promptConfig', (cfg) => { cfg.presets.x.steps = 28; return cfg; });
     * 
     * // Fluent API style
     * modifyConfig('promptConfig').delete('preset_group.myGroup');
     * modifyConfig('promptConfig').assign('presets.myPreset.steps', 28);
     * modifyConfig('favorites').append('tags', newTag);
     */
    modifyConfig(configType, modifierFn, options = {}) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        return this.configManager.modifyConfig(configType, modifierFn, options);
    }

    /**
     * Immediately schedule a workspace theme CSS recompile + client broadcast.
     * The workspaces config cache is updated synchronously on save, so this reads the
     * latest theme values without waiting for the debounced disk write.
     * modules/configManager.js scheduleWorkspaceCssRecompile
     */
    scheduleWorkspaceCssRecompile() {
        if (!this.configManager) {
            return;
        }
        this.configManager.scheduleWorkspaceCssRecompile();
    }

    /**
     * Queue a debounced workspaceDesktop save merging window position updates into any pending write
     * @param {Object} partialPositions
     */
    queueWorkspaceDesktopWindowPositions(partialPositions) {
        if (!this.configManager) {
            throw new Error('ConfigManager not initialized');
        }
        return this.configManager.queueWorkspaceDesktopWindowPositions(partialPositions);
    }

    /**
     * Flush all pending config saves immediately (useful for shutdown)
     * @returns {number} Number of configs that were flushed
     */
    flushAllPendingConfigSaves() {
        if (!this.configManager) {
            return 0;
        }
        return this.configManager.flushAllPendingSaves();
    }

    /**
     * Initialize configs during startup (with validation and mitigation)
     * @private
     */
    initializeConfigs() {
        try {
            // Initialize ConfigManager with config definitions
            const configDefinitions = {
                config: {
                    name: 'config',
                    path: this.getPath('config')
                },
                secureConfig: {
                    name: 'secureConfig',
                    path: this.getPath('secureConfig')
                },
                promptConfig: {
                    name: 'promptConfig',
                    path: this.getPath('promptConfig')
                },
                directorConfig: {
                    name: 'directorConfig',
                    path: this.getPath('directorConfig')
                },
                favorites: {
                    name: 'favorites',
                    path: this.getPath('favorites')
                },
                workspaces: {
                    name: 'workspaces',
                    path: this.getPath('workspaceFile')
                },
                workspaceDesktop: {
                    name: 'workspaceDesktop',
                    path: this.getPath('workspaceDesktopFile')
                },
                naxGeneration: {
                    name: 'naxGeneration',
                    path: this.getPath('naxGenerationConfig')
                }
            };

            this.configManager = new ConfigManager(this, configDefinitions);

            // Initialize all configs (handles checkpoint managers, validation, mitigation internally)
            this.configManager.initialize();

            // Set globalResources in modules that need it but have circular dependencies
            if (logger.setGlobalResources) {
                logger.setGlobalResources(this);
            }
            // Initialize TextReplacements instance
            this.textReplacements = new TextReplacements(this);
            this.staticWiki = staticWiki;
            this.fandomWiki = fandomWiki;
            this.grimoireDomainRegistry = grimoireDomainRegistry;
            this.configEditorService = new ConfigEditorService(this);
            this.checkpointManagementService = new CheckpointManagementService(this);
            this.initializeAuthMiddleware();

            console.log('[init] Configs loaded and validated');
        } catch (error) {
            console.error('[init] Error initializing configs:', error.message);
        }
    }

    async prepare(options = {}) {
        if (this.initialized) {
            console.log('⚠️ Global resources already initialized');
            return true;
        }
        try {
            // STEP 0: Initialize configs FIRST (needed by logger and other services)
            this.initializeConfigs();

            // STEP 0: Initialize logger FIRST (no dependencies, needed by everything else)
            this.initializeLogger();

            // Log viewer path UUID (secure config, needed before route registration)
            this.ensureLogViewerPathUuid();
            this.ensureVfsPathUuid();
            this.ensureMcpPathUuid();
            // Image attestation keys (Ed25519) — auto-create if missing
            // ensureForgeSigningKeys: modules/forgeSigning.js
            this.ensureForgeSigningKeys();
        } catch (error) {
            console.error('[init] Error preparing global resources:', error.message);
            return false;
        }
    }

    ensureForgeSigningKeys() {
        // ensureForgeSigningKeys: modules/forgeSigning.js
        return ensureForgeSigningKeys(this);
    }

    async _runInitStep(stepId, label, fn) {
        const reporter = this._startupReporter;
        const start = Date.now();
        if (reporter) {
            reporter({ stepId, label, phase: 'start' });
        }
        try {
            const result = await fn();
            const elapsedMs = Date.now() - start;
            if (this.logger?.bootSubStep) {
                this.logger.bootSubStep(`${label} (${elapsedMs}ms)`);
            }
            if (reporter) {
                reporter({ stepId, label, phase: 'done', elapsedMs });
            }
            return result;
        } catch (error) {
            const elapsedMs = Date.now() - start;
            if (reporter) {
                reporter({ stepId, label, phase: 'done', elapsedMs, error: error.message });
            }
            throw error;
        }
    }

    _runInitStepSync(stepId, label, fn) {
        const reporter = this._startupReporter;
        const start = Date.now();
        if (reporter) {
            reporter({ stepId, label, phase: 'start' });
        }
        try {
            const result = fn();
            const elapsedMs = Date.now() - start;
            if (this.logger?.bootSubStep) {
                this.logger.bootSubStep(`${label} (${elapsedMs}ms)`);
            }
            if (reporter) {
                reporter({ stepId, label, phase: 'done', elapsedMs });
            }
            return result;
        } catch (error) {
            const elapsedMs = Date.now() - start;
            if (reporter) {
                reporter({ stepId, label, phase: 'done', elapsedMs, error: error.message });
            }
            throw error;
        }
    }

    /**
     * Initialize all global resources at server startup.
     * Pipeline: modules/bootstrap/initSteps.js (INIT_STEPS).
     * DB/tag bodies: modules/bootstrap/databases.js.
     *
     * @param {Object} options - Initialization options
     * @returns {Promise<boolean>} - Success status
     */
    async initialize(options = {}) {
        if (this.initialized) {
            console.log('[init] Global resources already initialized');
            return true;
        }

        this.initStartTime = Date.now();
        this._startupReporter = typeof options.reportStartup === 'function' ? options.reportStartup : null;

        try {
            for (const step of INIT_STEPS) {
                if (step.afterReady) {
                    continue;
                }
                if (step.when && !step.when(this, options)) {
                    if (step.skipMessage && this.logger?.bootSubStep) {
                        this.logger.bootSubStep(step.skipMessage);
                    }
                    continue;
                }
                if (step.sync) {
                    this._runInitStepSync(step.id, step.label, () => step.run(this, options));
                } else {
                    await this._runInitStep(step.id, step.label, () => step.run(this, options));
                }
            }

            // Mark ready before workspace SQL/filesystem reconcile — sync uses getMetadataDatabase().
            this.initialized = true;

            for (const step of INIT_STEPS) {
                if (!step.afterReady) {
                    continue;
                }
                if (step.when && !step.when(this, options)) {
                    continue;
                }
                if (step.sync) {
                    this._runInitStepSync(step.id, step.label, () => step.run(this, options));
                } else {
                    await this._runInitStep(step.id, step.label, () => step.run(this, options));
                }
            }

            this.initEndTime = Date.now();
            this._startupReporter = null;

            const initTime = ((this.initEndTime - this.initStartTime) / 1000).toFixed(2);
            if (this.logger?.bootSubStep) {
                this.logger.bootSubStep(`Global resources ready in ${initTime}s`);
            }

            return true;
        } catch (error) {
            this._startupReporter = null;
            console.error('[init] Failed to initialize global resources:', error);
            return false;
        }
    }

    /**
     * Initialize T5 tokenizer (shared by all services)
     */
    async initializeT5Tokenizer() {
        try {
            if (!t5TokenizerService.initialized) {
                await t5TokenizerService.initialize();
            }
            this.t5Tokenizer = t5TokenizerService;
            this.rebuildPresetTokenCounts();
            this.initializationProgress.t5Tokenizer = true;
            console.log('✓ T5 Tokenizer ready');
        } catch (error) {
            console.error('  ❌ Failed to load T5 tokenizer:', error);
            throw error;
        }
    }

    /**
     * Initialize legacy JSON tag indexes (AnimeTagSearch, FurryTagSearch, FastTagSearch).
     * Prompt autofill local tags use TagLookup via tagAutofillSearch (not these modules).
     * Still required by fastTagSearch.js and promptLogitAnalyzer.js until migrated.
     * Body: modules/bootstrap/databases.js
     */
    async initializeTagSearchServices() {
        return bootstrapDatabases.initializeTagSearchServices(this);
    }

    /**
     * Initialize polymorphic modules (modules not written in Node.js)
     */
    initializePolymodules() {
        try {
            // Register DText parser (Ruby-based)
            this.polymoduleManager.registerModule('dtext_parser', {
                command: 'ruby',
                args: ['{script}'],
                scriptPath: 'polymodules/dtext_parser.rb',
                maxQueueSize: 100,
                restartDelay: 5000,
                timeout: 30000,
                sleepTimeout: 120000, // Sleep after 120 seconds of inactivity
                startAsleep: true // Start in sleep state (will wake on first request)
            });

            if (this.logger?.bootSubStep) {
                this.logger.bootSubStep('DText to HTML Parser (Ruby Module) registered');
            }
        } catch (error) {
            console.error('[init] Failed to initialize polymorphic modules:', error);
            // Don't throw - allow server to continue without polymorphic modules
        }
    }

    /**
     * Get DText parser function (uses polymorphic module)
     * @param {string} dtext - DText content to parse
     * @param {string} source - Source of the wiki ('danbooru' or 'e621')
     * @param {string} baseUrl - Base URL for converting internal links (e.g., 'https://danbooru.donmai.us')
     * @returns {Promise<string|null>} - HTML output, or null if parser is not available (triggers fallback)
     */
    async parseDText(dtext, source = 'danbooru', baseUrl = null) {
        // Log and reject invalid input - this indicates a bug upstream
        if (dtext == null || dtext === undefined) {
            const error = new Error(`parseDText called with null/undefined dtext. This indicates a bug upstream. Source: ${source}, baseUrl: ${baseUrl}`);
            console.error('❌ parseDText invalid input:', error.message);
            console.trace('Call stack:');
            throw error;
        }

        // Ensure dtext is a string
        if (typeof dtext !== 'string') {
            console.warn(`⚠️ parseDText called with non-string dtext (type: ${typeof dtext}). Converting to string.`, dtext);
            dtext = String(dtext);
        }

        // Empty string is also suspicious - log it
        if (dtext.trim() === '') {
            console.warn(`⚠️ parseDText called with empty string. This may indicate a bug upstream. Source: ${source}`);
        }

        // Determine base URL if not provided
        if (!baseUrl) {
            baseUrl = source === 'e621' ? 'https://e621.net' : 'https://danbooru.donmai.us';
        }

        try {
            const response = await this.polymoduleManager.sendRequest('dtext_parser', {
                dtext: dtext,
                source: source || 'danbooru',
                base_url: baseUrl || (source === 'e621' ? 'https://e621.net' : 'https://danbooru.donmai.us')
            });

            if (response.success && typeof response.html === 'string' && response.html) {
                return response.html;
            } else {
                // Parser returned an error - log it for debugging
                const errorMsg = response.error || 'Unknown parser error';
                const backtrace = response.backtrace || [];
                console.error('DText parser error:', errorMsg);
                if (backtrace.length > 0) {
                    console.error('Parser backtrace:', backtrace.join('\n'));
                }
                // Return null to trigger fallback in websocketHandlers
                return null;
            }
        } catch (error) {
            // Communication error with parser (crash recovery handled by polymoduleManager)
            console.error('DText parser communication error:', error.message);
            console.error('Error stack:', error.stack);
            // Return null to trigger fallback in websocketHandlers
            return null;
        }
    }

    async initializeHtmlMarkdown() {
        this.nhm = new NodeHtmlMarkdown({
            // Preserve wiki links (span.tag-wiki-link) as plain text with tag name
            customTransformers: [
                {
                    filter: (node) => node.nodeName === 'SPAN' && node.classList && node.classList.contains('tag-wiki-link'),
                    replacement: (content, node) => {
                        const tagName = node.getAttribute('data-tag-name') || content;
                        return tagName;
                    }
                }
            ],
            // Preserve code blocks
            codeBlockStyle: 'fenced',
            // Preserve tables
            tables: true,
            // Preserve links
            useLinkReferenceDefinitions: false
        });
        console.log('✓ HTML to Markdown converter initialized');
    }

    getHtmlMarkdown() {
        if (!this.nhm) {
            throw new Error('HTML to Markdown converter not initialized');
        }
        return this.nhm;
    }

    /**
     * Initialize spell checker
     */
    async initializeSpellChecker() {
        try {
            this.spellChecker = new SpellChecker(this);
            this.initializationProgress.spellChecker = true;
            console.log('✓ SpellChecker loaded');
        } catch (error) {
            console.error('  ❌ Failed to load spell checker:', error);
            throw error;
        }
    }

    /**
     * Initialize dictionary / thesaurus lookup service
     */
    async initializeWordLookupService() {
        try {
            this.wordLookupService = new WordLookupService(this);
            this.initializationProgress.wordLookupService = true;
            console.log('✓ WordLookupService loaded');
        } catch (error) {
            console.error('  ❌ Failed to load word lookup service:', error);
            throw error;
        }
    }

    /**
     * Auth middleware factories (after configs loaded in initializeConfigs)
     */
    initializeAuthMiddleware() {
        this.authMiddleware = createAuthMiddleware(this);
        this.devAuthMiddleware = createDevAuthMiddleware(this);
    }

    /**
     * Local prompt optimizer and tag suggestions cache
     */
    async initializeAuxiliaryServices() {
        try {
            this.localPromptOptimizer = new LocalPromptOptimizer(this);
            await this.localPromptOptimizer.initialize();
            console.log('✓ LocalPromptOptimizer loaded');

            this.tagSuggestionsCache = new TagSuggestionsCache(this);
            imageCounter.initializeImageCounter(this);
            this.registerTimer('tagSuggestionsCacheCleanup', 'interval', () => {
                if (this.tagSuggestionsCache) {
                    this.tagSuggestionsCache.cleanupOldEntries();
                }
            }, 60 * 60 * 1000);
            console.log('✓ TagSuggestionsCache loaded');
        } catch (error) {
            console.error('  ❌ Failed to initialize auxiliary services:', error);
            throw error;
        }
    }

    /**
     * Load character data for auto-complete from SQLite (.cache/characters.db).
     * Auto-imports characters.json once when the DB is empty.
     */
    async loadCharacterData() {
        try {
            const fs = require('fs');
            const db = this.charactersDatabase;
            if (!db) {
                console.log('    ⚠️  Characters database not initialized');
                this.characterDataArray = [];
                this.initializationProgress.characterData = true;
                return;
            }

            if (db.countCharacters() === 0) {
                const characterDataPath = this.getPath('characters');
                if (fs.existsSync(characterDataPath)) {
                    const data = JSON.parse(fs.readFileSync(characterDataPath, 'utf8'));
                    const stats = db.importFromJsonData(data, { replace: true });
                    console.log(
                        `✓ Characters JSON imported into DB (${stats.characters} characters, ${stats.copyrights} copyrights)`
                    );
                }
            }

            this.refreshCharacterDataCache();
            this.initializationProgress.characterData = true;
            console.log(`✓ Character Data Loaded (${this.characterDataArray.length} characters)`);
        } catch (error) {
            console.error('  ❌ Failed to load character data:', error);
            this.characterDataArray = [];
            this.initializationProgress.characterData = true;
        }
    }

    /**
     * Rebuild in-memory character array from SQLite (autofill + applet).
     */
    refreshCharacterDataCache() {
        if (this.charactersDatabase) {
            this.characterDataArray = this.charactersDatabase.listAllAsArray();
        } else {
            this.characterDataArray = [];
        }
        return this.characterDataArray;
    }

    getCharactersDatabase() {
        if (!this.initialized || !this.charactersDatabase) {
            throw new Error('Characters database not initialized - call initialize() first');
        }
        return this.charactersDatabase;
    }

    /**
     * Initialize knowledge memory database
     */
    // modules/bootstrap/databases.js
    initializeKnowledgeMemoryDb() {
        return bootstrapDatabases.initializeKnowledgeMemoryDb(this);
    }

    // modules/bootstrap/databases.js
    initializeTagSearchDatabase() {
        return bootstrapDatabases.initializeTagSearchDatabase(this);
    }

    // modules/bootstrap/databases.js
    initializeNaxVibesGallery() {
        return bootstrapDatabases.initializeNaxVibesGallery(this);
    }

    // modules/bootstrap/databases.js
    initializeNaxTagsDatabase() {
        return bootstrapDatabases.initializeNaxTagsDatabase(this);
    }

    // modules/bootstrap/databases.js
    initializeNaxTagGeneration() {
        return bootstrapDatabases.initializeNaxTagGeneration(this);
    }

    // modules/bootstrap/databases.js
    initializeReferenceMetadataDatabase() {
        return bootstrapDatabases.initializeReferenceMetadataDatabase(this);
    }

    // modules/bootstrap/databases.js
    initializeGenerationQuipsDatabase() {
        return bootstrapDatabases.initializeGenerationQuipsDatabase(this);
    }

    initializeGenerationQuipsManager() {
        try {
            this.generationQuipsManager = new GenerationQuipsManager(this);
            this.initializationProgress.generationQuipsManager = true;
            console.log('✓ Generation quips manager ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize generation quips manager:', error);
            throw error;
        }
    }

    initializeNovelHandlers() {
        try {
            this.novelHandlers = new NovelHandlers(this);
            this.initializationProgress.novelHandlers = true;
            console.log('✓ Novel handlers ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize novel handlers:', error);
            throw error;
        }
    }

    /**
     * Start generation quips auto-update scheduler (requires WebSocket server).
     */
    initializeGenerationQuipsAutoUpdate() {
        if (this.initializationProgress.generationQuipsAutoUpdate) {
            return;
        }
        if (!this.generationQuipsManager) {
            throw new Error('Generation quips manager must be initialized before auto-update scheduler');
        }
        if (!this.webSocketServer) {
            throw new Error('WebSocket server must be initialized before generation quips auto-update scheduler');
        }

        try {
            this.generationQuipsManager.startAutoUpdateScheduler();
            this.initializationProgress.generationQuipsAutoUpdate = true;
            console.log('✓ Generation quips auto-update scheduler started');
        } catch (error) {
            console.error('  ❌ Failed to start generation quips auto-update scheduler:', error);
            throw error;
        }
    }

    stopGenerationQuipsAutoUpdate() {
        if (!this.generationQuipsManager) return;
        this.generationQuipsManager.stopAutoUpdateScheduler();
        this.initializationProgress.generationQuipsAutoUpdate = false;
    }

    applyGenerationQuipsSettingsPatch(patch) {
        if (!patch || typeof patch !== 'object') return;
        this.getGenerationQuipsManager().applyWorkspaceQuipSettingsPatch(patch);
    }

    /**
     * Initialize favorites manager (singleton, no dependencies)
     */
    initializeFavoritesManager() {
        try {
            // FavoritesManager is a singleton class - create one instance
            this.favoritesManager = new FavoritesManager(this);
            this.initializationProgress.favoritesManager = true;
            console.log('✓ Favorite Tags and Groups Database ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize favorites manager:', error);
            throw error;
        }
    }

    /**
     * Initialize dataset tag service
     */
    async initializeDatasetTagService() {
        try {
            this.datasetTagService = new DatasetTagService(this);
            await this.datasetTagService.initialize();
            this.initializationProgress.datasetTagService = true;
            console.log('✓ Master Tag Database (Danbooru + e621 + NovelAI + Wiki) service ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize dataset tag service:', error);
            throw error;
        }
    }

    /**
     * Initialize singleton managers (already instantiated as singletons)
     * These must be initialized AFTER databases since they depend on them
     * 
     * Evaluation: These singletons don't have their own databases - they use:
     * - memoryManager: uses chatDatabase (already in globalResources)
     * - promptManager: uses metadataDatabase, chatDatabase (already in globalResources)
     * - aiServiceManager: uses chatDatabase (already in globalResources)
     * 
     * So no additional databases need to be extracted from these.
     */
    initializeSingletonManagers() {
        try {
            // Initialize in dependency order:
            // 1. memoryManager (depends on logger + chatDatabase)
            // 2. promptManager (depends on logger + metadataDatabase + chatDatabase + memoryManager)
            // 3. aiServiceManager (depends on logger + chatDatabase + promptManager + memoryManager)

            // Memory manager (instantiate with globalResources to prevent recursion)
            this.memoryManager = new MemoryManager(this);
            this.initializationProgress.memoryManager = true;
            console.log('✓ Memory manager ready');

            // Prompt manager (depends on memoryManager, metadataDatabase, chatDatabase)
            // Pass globalResources to prevent recursion
            this.promptManager = new PromptManager(this);
            this.initializationProgress.promptManager = true;
            console.log('✓ Prompt manager ready');

            // AI service manager (depends on promptManager and memoryManager)
            // Pass globalResources to prevent recursion
            this.aiServiceManager = new AIServiceManager(this);
            this.initializationProgress.aiServiceManager = true;
            console.log('✓ LLM / AI service manager ready');

            // Setup cleanup handlers for AI service manager
            process.on('SIGINT', () => {
                this.aiServiceManager.cleanupAllServices();
            });
            process.on('SIGTERM', () => {
                this.aiServiceManager.cleanupAllServices();
            });

            // Grok service (instantiate class with globalResources)
            this.grokService = new GrokService(this);
            this.initializationProgress.grokService = true;
            console.log('✓ Grok service ready');

            // Native xAI service (for smaller tasks, using @ai-sdk/xai directly)
            // Separate from the main GrokService so we can use native streaming + web search tools
            // without disturbing the Responses API flows used for persona chat + Director.
            this.xaiNativeService = new XaiNativeService(this);
            this.initializationProgress.xaiNativeService = true;
            console.log('✓ xAI Native service ready (for small tasks / quips / streaming + web search)');

            // Prompt logit analyzer (instantiate class with globalResources)
            this.promptLogitAnalyzer = new PromptLogitAnalyzer(this);
            this.initializationProgress.promptLogitAnalyzer = true;
            console.log('✓ psudo-Logit analyzer ready');
        } catch (error) {
            console.error('  ❌ Failed to load singleton managers:', error);
            throw error;
        }
    }

    /**
     * Initialize workspace module
     */
    initializeWorkspace() {
        if (this.workspace) {
            console.warn('⚠️ Workspace module already initialized');
            return;
        }
        try {
            this.workspace = new WorkspaceManager(this);
            this.workspace.initializeWorkspaces();
            if (this.metadataDatabase?.ensureGalleryOwnershipFromWorkspaces) {
                const workspaces = this.getWorkspacesConfig();
                this.metadataDatabase.ensureGalleryOwnershipFromWorkspaces(workspaces).then(() => {
                    this.workspace?.stripGalleryArraysFromWorkspacesCache?.();
                }).catch((err) => {
                    console.warn('Gallery ownership reconcile skipped:', err.message || err);
                });
            }
            this.initializationProgress.workspace = true;
            console.log('✓ SolarSystem (Workspaces) module ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize SolarSystem (Workspaces) module:', error);
            throw error;
        }
    }

    /**
     * Initialize queue module
     */
    initializeQueue() {
        try {
            this.queue = new Queue(this);
            this.initializationProgress.queue = true;
            console.log('✓ Queue module ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize queue module:', error);
            throw error;
        }
    }

    // modules/bootstrap/databases.js
    initializeAsyncSQLiteManager() {
        return bootstrapDatabases.initializeAsyncSQLiteManager(this);
    }

    /**
     * Initialize replication foundation (changelog, maintenance gate, service facade).
     */
    async initializeReplicationStack() {
        try {
            const replicationChangelog = require('./replicationChangelog');
            const replicationMaintenance = require('./replicationMaintenance');
            const replicationService = require('./replicationService');

            await replicationService.initialize(this);

            this.replicationChangelog = replicationChangelog;
            this.replicationMaintenance = replicationMaintenance;
            this.replicationService = replicationService;
            this.initializationProgress.replication = true;
            console.log('✓ Replication foundation ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize replication stack:', error);
            throw error;
        }
    }

    // modules/bootstrap/databases.js
    async initializeDatabases() {
        return bootstrapDatabases.initializeDatabases(this);
    }


    /**
     * Initialize global checkpoint manager
     * Manages all database and JSON checkpoints with staggered timing
     */
    initializeGlobalCheckpointManager() {
        try {
            const { setGlobalResourcesRef } = require('./checkpointGrandfathering');
            setGlobalResourcesRef(this);

            // sqlite databases only do not place JSON checkpoints unless they do not get saveed
            this.globalCheckpointManager = new GlobalCheckpointManager(this);

            // Register checkpoint managers from async SQLite databases
            // These are automatically connected when databases are initialized
            if (this.asyncSQLiteManager) {
                const allDatabases = this.asyncSQLiteManager.getAllDatabases();

                for (const [dbPath, db] of allDatabases.entries()) {
                    const checkpointManager = db.getCheckpointManager();
                    if (checkpointManager) {
                        // Extract database name from path for registration
                        const dbName = path.basename(dbPath, path.extname(dbPath));
                        this.globalCheckpointManager.registerCheckpointManager(dbName, checkpointManager, 'database');
                    }
                }
            }

            // Legacy checkpoint manager support (for databases not yet migrated to async wrapper)
            // These will be removed once all databases are migrated
            // Metadata database checkpoint manager
            if (this.metadataDatabase && this.metadataDatabase.getCheckpointManager) {
                const metadataCheckpointManager = this.metadataDatabase.getCheckpointManager();
                if (metadataCheckpointManager) {
                    this.globalCheckpointManager.registerCheckpointManager('metadata', metadataCheckpointManager, 'database');
                }
            }

            // Director database checkpoint manager
            if (this.directorDatabase && this.directorDatabase.getCheckpointManager) {
                const directorCheckpointManager = this.directorDatabase.getCheckpointManager();
                if (directorCheckpointManager) {
                    this.globalCheckpointManager.registerCheckpointManager('director', directorCheckpointManager, 'database');
                }
            }

            const registerDb = (name, getManager) => {
                const manager = getManager?.();
                if (manager) {
                    this.globalCheckpointManager.registerCheckpointManager(name, manager, 'database');
                }
            };

            registerDb('application_auth', () => applicationAuthDatabase.getCheckpointManager?.());
            registerDb('telemetry', () => telemetryDatabase.getCheckpointManager?.());
            registerDb('generation_quips', () => this.generationQuipsDatabase?.getCheckpointManager?.());
            registerDb('knowledge_memory', () => {
                const knowledgeMemoryDatabase = require('./knowledgeMemoryDatabase');
                return knowledgeMemoryDatabase.getCheckpointManager?.();
            });
            registerDb('reference_metadata', () => this.referenceMetadataDatabase?.getCheckpointManager?.());
            registerDb('tag_wiki', () => this.tagDatabase?.getCheckpointManager?.());
            registerDb('tag_search', () => {
                const tagSearchDatabase = require('./tagSearchDatabase');
                return tagSearchDatabase.getCheckpointManager?.();
            });
            registerDb('notes', () => notesDatabase.getCheckpointManager?.());
            registerDb('vfs', () => vfsDatabase.getCheckpointManager?.());

            // Start staggered periodic checkpoints (only for databases)
            this.globalCheckpointManager.startPeriodicCheckpoints();

            const { reconcileAllCheckpointRetention } = require('./checkpointGrandfathering');
            const retentionResult = reconcileAllCheckpointRetention(this);
            if (retentionResult.dirs > 0) {
                console.log(`✓ Checkpoint retention reconciled (${retentionResult.dirs} resource${retentionResult.dirs === 1 ? '' : 's'})`);
            }

            console.log('✓ Checkpoint manager ready');
        } catch (error) {
            console.error('  ❌ Failed to initialize global checkpoint manager:', error);
            throw error;
        }
    }

    /**
     * Initialize LRU caches for weather and location data
     * Must be called after configs are initialized since it needs to read config
     */
    initializeLRUCaches() {
        if (this.weatherCache && this.locationCache) {
            console.warn('⚠️ LRU caches already initialized');
            return;
        }

        try {
            const lruConfig = this.getConfig({ path: 'lruCache' }) || {};

            // Initialize caches with config values or defaults
            this.weatherCache = new LRUCache(lruConfig.weatherSize || 500);
            this.locationCache = new LRUCache(lruConfig.locationSize || 50);

            // Set up periodic cache cleanup
            setInterval(() => {
                try {
                    this.weatherCache.cleanupExpired(lruConfig.weatherFailureDuration || 15 * 60 * 1000);
                    this.locationCache.cleanupExpired(lruConfig.locationDuration || 24 * 60 * 60 * 1000);
                    console.log(`🧹 Periodic cache cleanup: weather=${this.weatherCache.size()}, location=${this.locationCache.size()}`);
                } catch (error) {
                    console.warn('⚠️ Cache cleanup error:', error.message);
                }
            }, 30 * 60 * 1000); // Run every 30 minutes

            if (this.logger?.bootSubStep) {
                this.logger.bootSubStep('LRU caches initialized');
            }
        } catch (error) {
            console.error('[init] Failed to initialize LRU caches:', error);
            throw error;
        }
    }

    /**
     * Get weather cache instance
     * @returns {LRUCache} Weather cache
     */
    getWeatherCache() {
        if (!this.weatherCache) {
            throw new Error('Weather cache not initialized - call initializeLRUCaches() first');
        }
        return this.weatherCache;
    }

    /**
     * Get location cache instance
     * @returns {LRUCache} Location cache
     */
    getLocationCache() {
        if (!this.locationCache) {
            throw new Error('Location cache not initialized - call initializeLRUCaches() first');
        }
        return this.locationCache;
    }

    /**
     * Initialize system information cache and start hourly refresh
     */
    initializeNovelAiStatusMonitor() {
        try {
            this.novelAiStatusMonitor = new NovelAiStatusMonitor(this);
            this.novelAiStatusMonitor.initializePolling();
            this.initializationProgress.novelAiStatusMonitor = true;
        } catch (error) {
            console.error('  ❌ Failed to initialize NovelAI status monitor:', error);
        }
    }

    getNovelAiStatusMonitor() {
        return this.novelAiStatusMonitor || null;
    }

    initializeSystemInfoCache() {
        // Initial cache load (async, don't wait)
        this.refreshSystemInfoCache().catch(error => {
            console.warn('⚠️ Initial system info cache refresh failed:', error.message);
        });

        // Set up hourly refresh interval
        if (this.systemInfoRefreshInterval) {
            clearInterval(this.systemInfoRefreshInterval);
        }

        this.systemInfoRefreshInterval = setInterval(() => {
            this.refreshSystemInfoCache().catch(error => {
                console.warn('⚠️ System info cache refresh failed:', error.message);
            });
        }, 60 * 60 * 1000); // 1 hour

        console.log('✓ System info cache initialized (refreshes hourly)');
    }

    /**
     * Refresh system information cache
     */
    async refreshSystemInfoCache() {
        const os = require('os');
        const fs = require('fs');
        const path = require('path');

        try {
            // Get git hash (try reading from .git/HEAD)
            let gitHash = 'Unknown';
            try {
                const gitHeadPath = path.join(process.cwd(), '.git', 'HEAD');
                if (fs.existsSync(gitHeadPath)) {
                    let headContent = fs.readFileSync(gitHeadPath, 'utf8').trim();
                    if (headContent.startsWith('ref: ')) {
                        const refPath = headContent.substring(5);
                        const refFile = path.join(process.cwd(), '.git', refPath);
                        if (fs.existsSync(refFile)) {
                            gitHash = fs.readFileSync(refFile, 'utf8').trim().substring(0, 7);
                        }
                    } else {
                        gitHash = headContent.substring(0, 7);
                    }
                }
            } catch (gitError) {
                // Git hash unavailable, use Unknown
            }

            // Get CPU information
            const cpus = os.cpus();
            const cpuInfo = cpus.length > 0 ? `${cpus[0].model} (${cpus.length} cores)` : 'Unknown';
            
            // Get RAM information
            const totalMem = os.totalmem();
            const ramInfo = `${(totalMem / 1024 / 1024 / 1024).toFixed(2)} GB`;

            // Get disk space information for the filesystem where the project resides
            const diskInfo = {
                total: 'N/A',
                used: 'N/A',
                free: 'N/A'
            };
            
            try {
                const { execSync } = require('child_process');
                const projectRoot = path.resolve(__dirname, '..');
                
                // Use df command to get filesystem stats for the project root
                // df -B1 shows sizes in 1-byte blocks (direct byte values)
                const dfOutput = execSync(`df -B1 "${projectRoot}"`, { encoding: 'utf8' });
                const lines = dfOutput.trim().split('\n');
                
                if (lines.length >= 2) {
                    // Parse the header and data line
                    const header = lines[0].split(/\s+/);
                    const data = lines[1].split(/\s+/);
                    
                    // Find column indices (they may vary)
                    let totalIndex = -1;
                    let usedIndex = -1;
                    let availIndex = -1;
                    
                    header.forEach((col, idx) => {
                        if (col === '1B-blocks' || col === '1K-blocks' || col === 'Size' || col.toUpperCase() === 'SIZE') {
                            totalIndex = idx;
                        }
                        if (col === 'Used' || col.toUpperCase() === 'USED') {
                            usedIndex = idx;
                        }
                        if (col === 'Avail' || col === 'Available' || col.toUpperCase() === 'AVAIL' || col.toUpperCase() === 'AVAILABLE') {
                            availIndex = idx;
                        }
                    });
                    
                    // Alternative: if columns aren't found by name, use standard positions
                    // Standard df output: Filesystem, 1B-blocks (or 1K-blocks), Used, Available, Use%, Mounted on
                    if (totalIndex === -1) totalIndex = 1;
                    if (usedIndex === -1) usedIndex = 2;
                    if (availIndex === -1) availIndex = 3;
                    
                    // With df -B1, values are already in bytes (1-byte blocks)
                    const totalBytes = parseInt(data[totalIndex]);
                    const usedBytes = parseInt(data[usedIndex]);
                    const freeBytes = parseInt(data[availIndex]);
                    
                    // Format sizes
                    const formatBytes = (bytes) => {
                        if (bytes >= 1024 * 1024 * 1024 * 1024) {
                            return `${(bytes / (1024 * 1024 * 1024 * 1024)).toFixed(2)} TB`;
                        } else if (bytes >= 1024 * 1024 * 1024) {
                            return `${(bytes / (1024 * 1024 * 1024)).toFixed(2)} GB`;
                        } else if (bytes >= 1024 * 1024) {
                            return `${(bytes / (1024 * 1024)).toFixed(2)} MB`;
                        } else if (bytes >= 1024) {
                            return `${(bytes / 1024).toFixed(2)} KB`;
                        }
                        return `${bytes} B`;
                    };
                    
                    diskInfo.total = formatBytes(totalBytes);
                    diskInfo.used = formatBytes(usedBytes);
                    diskInfo.free = formatBytes(freeBytes);
                }
            } catch (diskError) {
                // Disk space calculation failed, keep N/A values
                console.warn('Failed to get disk space information:', diskError.message);
            }

            // Get workspace information
            const workspaceManager = this.getWorkspaceManager();
            const workspaces = workspaceManager.getWorkspaces();
            const workspaceIds = Object.keys(workspaces);
            const workspaceList = [];

            let galleryStats = new Map();
            try {
                const metadataDb = this.metadataDatabase;
                if (metadataDb) {
                    // modules/metadataDatabase.js — gallery membership lives in SQL after workspace.files strip
                    galleryStats = await metadataDb.getGalleryWorkspaceStatsById(workspaceIds, 'images');
                }
            } catch (galleryError) {
                console.warn('Failed to get gallery workspace stats:', galleryError);
            }
            
            // Get reference counts for all workspaces at once (batch query)
            let referenceCounts = {};
            try {
                const refDb = this.getReferenceMetadataDatabase();
                if (refDb && typeof refDb.getWorkspaceReferenceCounts === 'function') {
                    referenceCounts = refDb.getWorkspaceReferenceCounts(workspaceIds);
                }
            } catch (refError) {
                console.warn('Failed to get reference counts:', refError);
            }

            // Get notes counts for all workspaces
            let notesCounts = {};
            try {
                const notesDb = this.getNotesDatabase();
                if (notesDb) {
                    // Get notes for each workspace and count them
                    for (const workspaceId of workspaceIds) {
                        try {
                            const notes = await notesDb.getNotesByWorkspace(workspaceId);
                            notesCounts[workspaceId] = notes ? notes.length : 0;
                        } catch (notesError) {
                            notesCounts[workspaceId] = 0;
                        }
                    }
                }
            } catch (notesError) {
                console.warn('Failed to get notes counts:', notesError);
            }
            
            let totalWorkspaceImagesSize = 0; // Track total for all workspaces
            
            for (const [workspaceId, workspace] of Object.entries(workspaces)) {
                const galleryStat = galleryStats.get(workspaceId);
                const imageCount = galleryStat
                    ? galleryStat.items
                    : (workspace.files ? workspace.files.length : 0);
                
                // Get references count from batch query
                const referenceCount = referenceCounts[workspaceId] || 0;

                // Get notes count from batch query
                const notesCount = notesCounts[workspaceId] || 0;

                // Calculate disk usage
                let diskUsage = '0 MB';
                let diskUsageBytes = 0;
                try {
                    if (galleryStat) {
                        diskUsageBytes = galleryStat.bytes || 0;
                    } else {
                        const imagesPath = this.getPath('images');
                        let totalSize = 0;
                        if (workspace.files && Array.isArray(workspace.files)) {
                            for (const file of workspace.files) {
                                try {
                                    const filePath = path.join(imagesPath, file);
                                    if (fs.existsSync(filePath)) {
                                        const stats = fs.statSync(filePath);
                                        totalSize += stats.size;
                                    }
                                } catch (fileError) {
                                    // Skip file if can't read
                                }
                            }
                        }
                        diskUsageBytes = totalSize;
                    }
                    if (diskUsageBytes > 1024 * 1024 * 1024) {
                        diskUsage = `${(diskUsageBytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
                    } else {
                        diskUsage = `${(diskUsageBytes / 1024 / 1024).toFixed(2)} MB`;
                    }
                } catch (diskUsageError) {
                    // Disk usage calculation failed
                }

                totalWorkspaceImagesSize += diskUsageBytes;

                workspaceList.push({
                    workspaceId,
                    name: workspace.name || workspaceId,
                    color: workspace.color || '#000000',
                    images: imageCount,
                    references: referenceCount,
                    notes: notesCount,
                    diskUsage,
                    diskUsageBytes
                });
            }

            // Sort workspaces by image count (descending)
            workspaceList.sort((a, b) => b.images - a.images);

            // Helper function to recursively calculate folder size
            const calculateFolderSize = (dirPath) => {
                let totalSize = 0;
                try {
                    if (!fs.existsSync(dirPath)) return 0;
                    const items = fs.readdirSync(dirPath);
                    for (const item of items) {
                        const itemPath = path.join(dirPath, item);
                        try {
                            const stats = fs.statSync(itemPath);
                            if (stats.isDirectory()) {
                                totalSize += calculateFolderSize(itemPath);
                            } else {
                                totalSize += stats.size;
                            }
                        } catch (e) {
                            // Skip items we can't access
                        }
                    }
                } catch (e) {
                    // Directory doesn't exist or can't be read
                }
                return totalSize;
            };

            // Helper function to format size
            const formatSize = (bytes) => {
                if (bytes > 1024 * 1024 * 1024) {
                    return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
                } else {
                    return `${(bytes / 1024 / 1024).toFixed(2)} MB`;
                }
            };

            // Get usage statistics
            const usageStats = {
                previewImages: '0 MB',
                referenceItems: '0 MB',
                databases: '0 MB',
                wikiFiles: '0 MB',
                workspaceImages: '0 MB'
            };

            try {
                // Calculate preview images size from .previews/ folder
                const previewPath = this.getPath('previews');
                if (fs.existsSync(previewPath)) {
                    const previewSize = calculateFolderSize(previewPath);
                    usageStats.previewImages = formatSize(previewSize);
                }

                // Calculate reference items size from .cache/preview and .cache/upload
                let referenceItemsSize = 0;
                try {
                    const previewCachePath = this.getPath('previewCache');
                    if (fs.existsSync(previewCachePath)) {
                        referenceItemsSize += calculateFolderSize(previewCachePath);
                    }
                    const uploadCachePath = this.getPath('uploadCache');
                    if (fs.existsSync(uploadCachePath)) {
                        referenceItemsSize += calculateFolderSize(uploadCachePath);
                    }
                    usageStats.referenceItems = formatSize(referenceItemsSize);
                } catch (refError) {
                    // Reference items size unavailable
                }

                // Calculate databases size - all db and config files in .cache/
                let databasesSize = 0;
                try {
                    const cachePath = this.getPath('cache');
                    if (fs.existsSync(cachePath)) {
                        const items = fs.readdirSync(cachePath);
                        for (const item of items) {
                            const itemPath = path.join(cachePath, item);
                            try {
                                const stats = fs.statSync(itemPath);
                                if (stats.isFile() && (
                                    item.endsWith('.db') || 
                                    item.endsWith('.db-wal') || 
                                    item.endsWith('.db-shm') || 
                                    item.endsWith('.json') ||
                                    item.endsWith('.config.json')
                                )) {
                                    databasesSize += stats.size;
                                }
                            } catch (e) {
                                // Skip
                            }
                        }
                    }
                    usageStats.databases = formatSize(databasesSize);
                } catch (dbError) {
                    // Databases size unavailable
                }

                // Calculate wiki files size (tag wiki database)
                try {
                    const wikiDbPath = path.join(this.getPath('cache'), 'tag_wiki.db');
                    if (fs.existsSync(wikiDbPath)) {
                        const stats = fs.statSync(wikiDbPath);
                        const wikiSize = stats.size;
                        usageStats.wikiFiles = formatSize(wikiSize);
                    }
                } catch (wikiError) {
                    // Wiki files size unavailable
                }

                // Use the total workspace images size we already calculated
                usageStats.workspaceImages = formatSize(totalWorkspaceImagesSize);
            } catch (usageError) {
                console.warn('Failed to calculate usage statistics:', usageError);
            }

            // Update cache
            this.systemInfoCache = {
                gitHash: gitHash,
                cpu: cpuInfo,
                ram: ramInfo,
                disk: diskInfo,
                workspaces: workspaceList,
                usage: usageStats
            };
            this.systemInfoCacheTimestamp = Date.now();

            console.log(`✓ System info cache refreshed at ${new Date().toISOString()}`);
        } catch (error) {
            console.error('❌ Failed to refresh system info cache:', error);
        }
    }

    /**
     * Get cached system information
     * @returns {Object|null} Cached system info or null if not available
     */
    getSystemInfoCache() {
        return this.systemInfoCache;
    }

    /**
     * Initialize API key manager
     * Must be called after configs are initialized since it needs to read config
     */
    initializeApiKeyManager() {
        if (this.apiKeyManager) {
            console.warn('⚠️ API key manager already initialized');
            return;
        }

        try {
            this.apiKeyManager = new apiKeyManager(this);
            // Broadcast + log tripwire lock changes so admins are notified in real time.
            this.apiKeyManager.setLockChangeHandler((service, lock) => this._onApiServiceLockChange(service, lock));
            console.log('✓ API key manager initialized');
        } catch (error) {
            console.error('  ❌ Failed to initialize API key manager:', error);
            throw error;
        }
    }

    // modules/bootstrap/databases.js
    initializeApplicationAuthManager() {
        return bootstrapDatabases.initializeApplicationAuthManager(this);
    }

    /**
     * Initialize logger (singleton)
     * This is called FIRST since logger has no dependencies and is needed by everything else
     */
    initializeLogger() {
        try {
            // Logger is already instantiated as singleton, just store reference
            this.logger = logger;
            this.initializationProgress.logger = true;
            if (this.initStartTime) {
                console.log('✓ NeKomata (Logger) ready');
            }
        } catch (error) {
            if (this.initStartTime) {
                console.error('  ❌ Failed to initialize logger:', error);
            }
            throw error;
        }
    }

    /**
     * Set Express app instance (called from web_server.js after app creation)
     */
    setExpressApp(app) {
        if (app) {
            this.expressApp = app;
            this.initializationProgress.expressApp = true;
        }
    }

    /**
     * Set HTTP server instance (called from web_server.js after server creation)
     */
    setHttpServer(server) {
        if (server) {
            this.httpServer = server;
            this.initializationProgress.httpServer = true;
        }
    }

    /**
     * Set WebSocket server instance (called from web_server.js after WebSocketServer creation)
     */
    setWebSocketServer(wsServer) {
        if (wsServer) {
            this.webSocketServer = wsServer;
            this.initializationProgress.webSocketServer = true;
        }
    }

    /**
     * Legacy JSON tag index (dataset_tags.json). Not used for prompt autofill — see getTagAutofillSearch().
     * @deprecated Migrate callers to TagLookup; remove after fastTagSearch and promptLogitAnalyzer are migrated.
     */
    async getAnimeTagSearch() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }

        if (!this.animeTagSearch) {
            console.log('⚡ Initializing Danbooru Anime Tag Search (legacy JSON)...');
            await this.initializeTagSearchServices();
        }

        return this.animeTagSearch;
    }

    /**
     * Legacy JSON tag index (dataset_tags_furry.json). Not used for prompt autofill — see getTagAutofillSearch().
     * @deprecated Migrate callers to TagLookup; remove after fastTagSearch and promptLogitAnalyzer are migrated.
     */
    async getFurryTagSearch() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }

        if (!this.furryTagSearch) {
            console.log('⚡ Initializing e621 Furry Tag Search (Sleeping)...');
            await this.initializeTagSearchServices();
        }

        return this.furryTagSearch;
    }

    /**
     * @deprecated Legacy JSON wrapper. Migrate to TagLookup before removing animeTagSearch/furryTagSearch.
     */
    async getFastTagSearch() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }

        if (!this.fastTagSearch) {
            console.log('⚡ Lazy-loading FastTagSearch (first use)...');
            await this.initializeTagSearchServices();
        }

        return this.fastTagSearch;
    }

    /**
     * Get SpellChecker instance
     */
    getSpellChecker() {
        if (!this.spellChecker) {
            throw new Error('SpellChecker not initialized - call initializeSpellChecker() first');
        }
        return this.spellChecker;
    }

    /**
     * Get WordLookupService instance
     */
    getWordLookupService() {
        if (!this.wordLookupService) {
            throw new Error('WordLookupService not initialized - call initializeWordLookupService() first');
        }
        return this.wordLookupService;
    }

    /**
     * Get T5 Tokenizer instance
     */
    getT5Tokenizer() {
        if (!this.t5Tokenizer) {
            throw new Error('T5 tokenizer not initialized - call initializeT5Tokenizer() first');
        }
        return this.t5Tokenizer;
    }

    /**
     * Cached preset/expander token counts for client token bar (built from full prompt.config).
     */
    getPresetTokenCounts() {
        if (!this.presetTokenCounts) {
            this.rebuildPresetTokenCounts();
        }
        return this.presetTokenCounts || { datasets: [], quality: {}, uc: {}, nsfw: {}, expanders: {} };
    }

    rebuildPresetTokenCounts() {
        try {
            if (!this.t5Tokenizer) {
                return null;
            }
            const promptConfig = this.getPromptConfig({ clone: true });
            this.presetTokenCounts = buildPresetTokenCountCache(promptConfig, this.t5Tokenizer);
            return this.presetTokenCounts;
        } catch (error) {
            console.error('Failed to rebuild preset token count cache:', error);
            this.presetTokenCounts = { datasets: [], quality: {}, uc: {}, nsfw: {}, expanders: {} };
            return this.presetTokenCounts;
        }
    }

    /**
     * Get character data array for auto-complete
     */
    getCharacterData() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.characterDataArray || [];
    }

    /**
     * Get Knowledge Memory Database instance
     */
    getKnowledgeMemoryDb() {
        if (!this.initialized || !this.knowledgeMemoryDb) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.knowledgeMemoryDb;
    }

    /**
     * Get Tag Search Database instance
     */
    getTagSearchDatabase() {
        if (!this.initialized || !this.tagSearchDatabase) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        if (typeof this.tagSearchDatabase.ensureTagSearchDatabase === 'function') {
            this.tagSearchDatabase.ensureTagSearchDatabase();
        }
        return this.tagSearchDatabase;
    }

    /**
     * Get NAX tags database module (galleries, tag query, favorites; optional DB file on disk)
     */
    getNaxTagsDatabase() {
        if (!this.initialized || !this.naxTagsDatabase) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.naxTagsDatabase;
    }

    /**
     * NAX custom tag preview generation (nax_generation_config.json)
     */
    getNaxTagGeneration() {
        if (!this.initialized || !this.naxTagGeneration) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.naxTagGeneration;
    }

    /**
     * NAX.moe community vibes gallery (HTML proxy + 2h cache)
     */
    getNaxVibesGallery() {
        if (!this.naxVibesGallery) {
            throw new Error('NAX vibes gallery not initialized');
        }
        return this.naxVibesGallery;
    }

    /**
     * NovelAI Explore / Agora gallery (search proxy + image cache)
     */
    getNovelaiExploreGallery() {
        if (!this.novelaiExploreGallery) {
            throw new Error('NovelAI Explore gallery not initialized');
        }
        return this.novelaiExploreGallery;
    }

    /**
     * Get Reference Metadata Database instance
     */
    getReferenceMetadataDatabase() {
        // Check if database exists (it's initialized in step 8, before workspace in step 10)
        if (!this.referenceMetadataDatabase) {
            throw new Error('Reference metadata database not initialized - ensure initializeReferenceMetadataDatabase() was called');
        }
        return this.referenceMetadataDatabase;
    }

    getGenerationQuipsDatabase() {
        if (!this.generationQuipsDatabase) {
            throw new Error('Generation quips database not initialized');
        }
        return this.generationQuipsDatabase;
    }

    getGenerationQuipsManager() {
        if (!this.generationQuipsManager) {
            throw new Error('Generation quips manager not initialized');
        }
        return this.generationQuipsManager;
    }

    getNovelHandlers() {
        if (!this.novelHandlers) {
            throw new Error('Novel handlers not initialized');
        }
        return this.novelHandlers;
    }

    /**
     * Get Notes Database module (functions)
     */
    getNotesDatabase() {
        if (!this.notesDatabase) {
            throw new Error('Notes database not initialized - ensure initializeNotesDatabase() was called');
        }
        return this.notesDatabase;
    }

    getVfsDatabase() {
        if (!this.vfsDatabase) {
            throw new Error('VFS database not initialized');
        }
        return this.vfsDatabase;
    }

    getVfsManager() {
        if (!this.vfsManager) {
            throw new Error('VFS manager not initialized');
        }
        return this.vfsManager;
    }

    ensureVfsPathUuid() {
        let uuid = this.getSecureConfig({ path: 'vfsPathUuid' });
        if (!uuid || typeof uuid !== 'string') {
            uuid = crypto.randomUUID();
            this.modifyConfig('secureConfig').assign('vfsPathUuid', uuid);
        }
        return uuid;
    }

    getVfsPathUuid() {
        const uuid = this.getSecureConfig({ path: 'vfsPathUuid' });
        if (!uuid || typeof uuid !== 'string') {
            return this.ensureVfsPathUuid();
        }
        return uuid;
    }

    /**
     * Get Dataset Tag Service instance
     */
    getDatasetTagService() {
        if (!this.initialized || !this.datasetTagService) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.datasetTagService;
    }

    /**
     * Get Favorites Manager instance
     */
    getFavoritesManager() {
        if (!this.initialized || !this.favoritesManager) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.favoritesManager;
    }

    /**
     * Get Memory Manager instance
     */
    getMemoryManager() {
        if (!this.initialized || !this.memoryManager) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.memoryManager;
    }

    /**
     * Get Prompt Manager instance
     */
    getPromptManager() {
        if (!this.initialized || !this.promptManager) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.promptManager;
    }

    /**
     * Get AI Service Manager instance
     */
    getAiServiceManager() {
        if (!this.initialized || !this.aiServiceManager) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.aiServiceManager;
    }

    /**
     * Get Workspace module instance
     */
    getWorkspaceManager() {
        if (!this.workspace) {
            throw new Error('Workspace Manager not initialized - call initializeWorkspace() first');
        }
        return this.workspace;
    }

    /**
     * Get Queue module instance
     */
    getQueue() {
        if (!this.initialized || !this.queue) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.queue;
    }

    /**
     * Global generation FIFO (Studio + MCP). modules/generationJobQueue.js
     */
    getGenerationJobQueue() {
        if (!this.generationJobQueue) {
            const { getSharedGenerationJobQueue } = require('./generationJobQueue');
            this.generationJobQueue = getSharedGenerationJobQueue();
        }
        return this.generationJobQueue;
    }

    /**
     * Get Metadata Database instance
     */
    getMetadataDatabase() {
        if (!this.metadataDatabase) {
            throw new Error('Metadata database not initialized');
        }
        return this.metadataDatabase;
    }

    /**
     * Get Chat Database instance
     */
    getChatDatabase() {
        if (!this.initialized || !this.chatDatabase) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.chatDatabase;
    }

    /**
     * Get Director Database instance
     */
    getDirectorDatabase() {
        if (!this.initialized || !this.directorDatabase) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.directorDatabase;
    }

    /**
     * Get Tag Database instance (tag-lookup)
     */
    getTagDatabase() {
        if (!this.initialized || !this.tagDatabase) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.tagDatabase;
    }

    /**
     * Autofill tag search (unified tag wiki database; modules/tagAutofillSearch.js)
     */
    getTagAutofillSearch() {
        if (!this.initialized || !this.tagDatabase) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        if (!this.tagAutofillSearch) {
            this.tagAutofillSearch = new TagAutofillSearch(this);
        }
        return this.tagAutofillSearch;
    }

    /**
     * Get TextReplacements instance
     */
    getTextReplacements() {
        if (!this.textReplacements) {
            throw new Error('TextReplacements not initialized - call initializeConfigs() first');
        }
        return this.textReplacements;
    }

    /**
     * Get static wiki module (function exports)
     */
    getStaticWiki() {
        if (!this.staticWiki) {
            throw new Error('StaticWiki not initialized - call initializeConfigs() first');
        }
        return this.staticWiki;
    }

    getFandomWiki() {
        if (!this.fandomWiki) {
            throw new Error('FandomWiki not initialized - call initializeConfigs() first');
        }
        return this.fandomWiki;
    }

    getGrimoireDomainRegistry() {
        if (!this.grimoireDomainRegistry) {
            throw new Error('GrimoireDomainRegistry not initialized - call initializeConfigs() first');
        }
        return this.grimoireDomainRegistry;
    }

    /**
     * Get LocalPromptOptimizer instance
     */
    getLocalPromptOptimizer() {
        if (!this.localPromptOptimizer) {
            throw new Error('LocalPromptOptimizer not initialized - call initialize() first');
        }
        return this.localPromptOptimizer;
    }

    /**
     * Get ConfigEditorService instance
     */
    getConfigEditorService() {
        if (!this.configEditorService) {
            throw new Error('ConfigEditorService not initialized - call initializeConfigs() first');
        }
        return this.configEditorService;
    }

    /**
     * Get CheckpointManagementService instance
     */
    getCheckpointManagementService() {
        if (!this.checkpointManagementService) {
            throw new Error('CheckpointManagementService not initialized - call initializeConfigs() first');
        }
        return this.checkpointManagementService;
    }

    /**
     * Get TagSuggestionsCache instance
     */
    getTagSuggestionsCache() {
        if (!this.tagSuggestionsCache) {
            throw new Error('TagSuggestionsCache not initialized - call initialize() first');
        }
        return this.tagSuggestionsCache;
    }

    /**
     * Get auth middleware (available after initializeConfigs / prepare)
     */
    getAuthMiddleware() {
        if (!this.authMiddleware) {
            throw new Error('Auth middleware not initialized - call initializeConfigs() first');
        }
        return this.authMiddleware;
    }

    /**
     * Get dev auth middleware (available after initializeConfigs / prepare)
     */
    getDevAuthMiddleware() {
        if (!this.devAuthMiddleware) {
            throw new Error('Dev auth middleware not initialized - call initializeConfigs() first');
        }
        return this.devAuthMiddleware;
    }

    /**
     * Get Logger instance
     * Logger can be accessed early (before full initialization) since it has no dependencies
     */
    getLogger() {
        // Logger is always available once initialized (first step)
        if (!this.logger) {
            // Try to initialize logger if not already done
            try {
                this.initializeLogger();
            } catch (error) {
                throw new Error('Logger not available - initialization failed: ' + error.message);
            }
        }
        return this.logger;
    }

    /**
     * Ensure logViewerPathUuid exists in secure config (auto-generated on first boot).
     */
    ensureLogViewerPathUuid() {
        let uuid = this.getSecureConfig({ path: 'logViewerPathUuid' });
        if (!uuid || typeof uuid !== 'string') {
            uuid = crypto.randomUUID();
            this.modifyConfig('secureConfig').assign('logViewerPathUuid', uuid);
        }
        return uuid;
    }

    /**
     * Get persisted UUID base path for admin log viewer HTTP routes.
     */
    getLogViewerPathUuid() {
        const uuid = this.getSecureConfig({ path: 'logViewerPathUuid' });
        if (!uuid || typeof uuid !== 'string') {
            return this.ensureLogViewerPathUuid();
        }
        return uuid;
    }

    ensureMcpPathUuid() {
        let uuid = this.getSecureConfig({ path: 'mcpPathUuid' });
        if (!uuid || typeof uuid !== 'string') {
            uuid = crypto.randomUUID();
            this.modifyConfig('secureConfig').assign('mcpPathUuid', uuid);
        }
        return uuid;
    }

    getMcpPathUuid() {
        const uuid = this.getSecureConfig({ path: 'mcpPathUuid' });
        if (!uuid || typeof uuid !== 'string') {
            return this.ensureMcpPathUuid();
        }
        return uuid;
    }

    /**
     * Get Express app instance
     */
    getExpressApp() {
        if (!this.expressApp) {
            throw new Error('Express app not set - call setExpressApp() first');
        }
        return this.expressApp;
    }

    /**
     * Get HTTP server instance
     */
    getHttpServer() {
        if (!this.httpServer) {
            throw new Error('HTTP server not set - call setHttpServer() first');
        }
        return this.httpServer;
    }

    /**
     * Get WebSocket server instance
     */
    getWebSocketServer() {
        if (!this.webSocketServer) {
            throw new Error('WebSocket server not set - call setWebSocketServer() first');
        }
        return this.webSocketServer;
    }

    getReplicationService() {
        if (!this.replicationService) {
            throw new Error('Replication service not initialized - call initializeReplicationStack() first');
        }
        return this.replicationService;
    }

    getReplicationMaintenance() {
        if (!this.replicationMaintenance) {
            throw new Error('Replication maintenance not initialized - call initializeReplicationStack() first');
        }
        return this.replicationMaintenance;
    }

    getReplicationChangelog() {
        if (!this.replicationChangelog) {
            throw new Error('Replication changelog not initialized - call initializeReplicationStack() first');
        }
        return this.replicationChangelog;
    }

    /**
     * Store a shared client instance (e.g., NovelAI, Grok)
     * @param {string} name
     * @param {any} client
     */
    setClient(name, client) {
        if (!name) {
            return;
        }
        if (client) {
            this.clients.set(name, client);
        } else {
            this.clients.delete(name);
        }
    }

    /**
     * Retrieve a shared client instance
     * @param {string} name
     * @returns {any}
     */
    getClient(name) {
        if (!name) {
            return undefined;
        }
        return this.clients.get(name);
    }

    /**
     * Remove a client instance from the registry
     * @param {string} name
     * @returns {any} removed client
     */
    deleteClient(name) {
        if (!name) {
            return undefined;
        }
        const existing = this.clients.get(name);
        this.clients.delete(name);
        return existing;
    }

    /**
     * Get SearchService instance (lazy-loaded to avoid circular dependency)
     */
    getSearchService() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }

        // Lazy-load SearchService to avoid circular dependency with textReplacements.js
        if (!this.searchService) {
            console.log('  🔍 Lazy-loading SearchService...');
            const { SearchService, setGlobalResources } = require('./searchService');
            setGlobalResources(this);
            // Context pattern removed - SearchService now gets everything from globalResources directly
            this.searchService = new SearchService(this);

            // Register cleanup timer for old session rate limiters (every minute)
            const timerId = this.registerTimer('searchServiceCleanup', 'interval', () => {
                if (this.searchService && typeof this.searchService.cleanupOldSessionRateLimiters === 'function') {
                    this.searchService.cleanupOldSessionRateLimiters();
                }
            }, 60000); // 60 seconds
            this.searchService._cleanupTimerId = timerId;

            this.initializationProgress.searchService = true;
            console.log('✓ SearchService loaded (lazy)');
        }

        return this.searchService;
    }

    /**
     * Managed RunPod GPU pod start/stop + idle auto-shutdown.
     * runpodPodManager: modules/runpodPodManager.js
     */
    getRunpodPodManager() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        if (!this.runpodPodManager) {
            const { RunpodPodManager } = require('./runpodPodManager');
            this.runpodPodManager = new RunpodPodManager(this);
        }
        return this.runpodPodManager;
    }

    /**
     * Get apiKeyManager reference
     */
    getApiKeyManager() {
        if (!this.apiKeyManager) {
            throw new Error('API key manager not initialized - call initializeApiKeyManager() first');
        }
        return this.apiKeyManager;
    }

    /**
     * Whether an external service is currently tripwire-locked.
     * @param {string} service - e.g. 'novelai', 'grok'
     */
    isServiceLocked(service) {
        return !!(this.apiKeyManager && this.apiKeyManager.isServiceLocked(service));
    }

    /**
     * Run an external API call behind the tripwire. Fast-fails when the service is
     * locked, records success/failure outcomes, and re-throws the original error.
     * @param {string} service - e.g. 'novelai', 'grok'
     * @param {Function} fn - async function that performs the API call
     */
    async guardServiceCall(service, fn) {
        const akm = this.getApiKeyManager();
        if (akm.isServiceLocked(service)) {
            const lock = akm.getServiceLock(service);
            const label = this.apiKeyManager.SERVICE_METADATA[service]?.label || service;
            const err = new Error(`${label} is temporarily locked after ${lock?.failureCount || 0} API error(s) (last HTTP ${lock?.lastStatus || '??'}). An admin must review the Service Key in the Security Center to unlock it.`);
            err.code = 'SERVICE_LOCKED';
            err.service = service;
            throw err;
        }
        try {
            const result = await fn();
            akm.recordApiSuccess(service);
            return result;
        } catch (error) {
            const status = akm.deriveStatusCode(error);
            if (status !== null) {
                akm.recordApiFailure(service, status, error.message);
            }
            throw error;
        }
    }

    /**
     * React to tripwire lock changes: log and broadcast to connected admin clients.
     * @private
     */
    _onApiServiceLockChange(service, lock) {
        const label = this.apiKeyManager?.SERVICE_METADATA?.[service]?.label || service;
        try {
            if (lock.locked) {
                this.logger.error(`🔒 API service locked: ${label} after ${lock.failureCount} error(s) (last HTTP ${lock.lastStatus}). Admin action required.`);
            } else {
                this.logger.normal(`🔓 API service unlocked: ${label}`);
            }
        } catch (error) {
            console.error(`API service lock log error: ${error.message}`);
        }
        try {
            const wsServer = this.webSocketServer;
            if (wsServer && typeof wsServer.broadcastToAll === 'function') {
                wsServer.broadcastToAll({
                    type: 'api_service_lock_changed',
                    data: { service, label, lock },
                    timestamp: new Date().toISOString()
                }, (clientInfo) => clientInfo && clientInfo.userType === 'admin');
            }
        } catch (error) {
            console.error(`API service lock broadcast error: ${error.message}`);
        }
    }

    getApplicationAuthManager() {
        if (!this.applicationAuthManager) {
            throw new Error('Application auth manager not initialized - call initializeApplicationAuthManager() first');
        }
        return this.applicationAuthManager;
    }

    getTelemetryDatabase() {
        return this.telemetryDatabase || null;
    }

    getApplicationAuthEarlyMiddleware() {
        if (!this.applicationAuthEarlyMiddleware) {
            throw new Error('Application auth early middleware not initialized');
        }
        return this.applicationAuthEarlyMiddleware;
    }

    /**
     * Get Data Plumbing system instance
     * Used for managing data flow between modules, functions, and async processes
     */
    getDataPlumbing() {
        return this.dataPlumbing;
    }

    /**
     * Get NekoAI Module Component
     */
    getNekoAiService(module) {
        // Check if module is a valid NekoAI module and return the module component
        if (module && nekoaijs[module] && Object.prototype.hasOwnProperty.call(nekoaijs, module)) {
            // If module is 'NovelAI', return the NovelAI client
            if (module === 'NovelAI') {
                // Return the Master NovelAI client
                return this.getNovelAiClient();
            } else if (module === 'Resolution') {
                // Return expanded Resolution module with custom resolutions
                return this.getExpandedResolution();
            } else {
                // Return the module component
                return nekoaijs[module];
            }
        }
        return undefined;
    }

    /**
     * Boot-load NovelAI model feature caps (config/model-features.json).
     * @returns {Record<string, object>}
     */
    getModelFeaturesMap() {
        if (!this.modelFeatures) {
            // modules/modelFeatures.js
            const { loadModelFeatures } = require('./modelFeatures');
            this.modelFeatures = loadModelFeatures(this.getPath('modelFeatures'));
        }
        return this.modelFeatures;
    }

    /**
     * Feature caps for a Dreamscape forge model key (v5, v4_5, …).
     * @param {string} forgeModel
     * @returns {object|null}
     */
    getModelFeatures(forgeModel) {
        // modules/modelFeatures.js
        const { getModelFeatures } = require('./modelFeatures');
        return getModelFeatures(forgeModel, this.getModelFeaturesMap());
    }

    /**
     * Get expanded Resolution module with custom resolutions included
     * Generates a merged object with all resolutions for fast O(1) lookups
     * @returns {Object} Resolution object with original enum values + custom resolutions
     */
    getExpandedResolution() {
        const baseResolution = nekoaijs.Resolution;
        if (!baseResolution) {
            return undefined;
        }

        // Regenerate cache if custom resolutions changed or cache doesn't exist
        if (!this._expandedResolutionCache || this._customResolutionsDirty) {
            // Create a simple merged object - copy all original Resolution properties
            const expanded = Object.assign({}, baseResolution);

            // Add custom resolutions as enum-style keys
            // Names are already stored in uppercase, use directly
            this.customResolutions.forEach((dims, name) => {
                // Use the name as the value (matches how Resolution enum works)
                expanded[name] = name;
            });

            this._expandedResolutionCache = expanded;
            this._customResolutionsDirty = false;
        }

        return this._expandedResolutionCache;
    }

    /**
     * Add or update a custom resolution
     * @param {string} name - Resolution name (e.g., 'XLARGE_PORTRAIT', 'CUSTOM_2048x1536')
     * @param {number} width - Width in pixels
     * @param {number} height - Height in pixels
     */
    addCustomResolution(name, width, height) {
        if (!name || typeof name !== 'string' || !width || !height || width <= 0 || height <= 0) {
            throw new Error('Invalid resolution: name, width, and height must be positive values');
        }

        // Normalize to uppercase and clean up
        const normalizedName = name.toUpperCase().trim().replace(/[^A-Z0-9_]/g, '_');
        this.customResolutions.set(normalizedName, { width, height });
        // Mark caches as dirty so they get regenerated on next access
        this._customResolutionsDirty = true;
        this._expandedResolutionCache = null;
        this._resolutionDimensionsMap = null;
        console.log(`✓ Added custom resolution: ${normalizedName} (${width}x${height})`);
    }

    /**
     * Remove a custom resolution
     * @param {string} name - Resolution name to remove (should be UPPERCASE)
     */
    removeCustomResolution(name) {
        if (!name) return false;
        // Normalize to uppercase
        const normalizedName = name.toUpperCase().trim().replace(/[^A-Z0-9_]/g, '_');
        const removed = this.customResolutions.delete(normalizedName);
        if (removed) {
            // Mark caches as dirty so they get regenerated on next access
            this._customResolutionsDirty = true;
            this._expandedResolutionCache = null;
            this._resolutionDimensionsMap = null;
            console.log(`✗ Removed custom resolution: ${normalizedName}`);
        }
        return removed;
    }

    /**
     * Get all custom resolutions
     * @returns {Map} Map of resolution names to { width, height } objects
     */
    getCustomResolutions() {
        return new Map(this.customResolutions);
    }

    /**
     * Get all resolutions as a map for fast O(1) lookups
     * Generates a complete map of all resolution names (standard + custom) -> { width, height }
     * Standard resolutions are extracted from nekoai-js RESOLUTION_DIMENSIONS to stay in sync with package updates
     * All keys are stored in UPPERCASE - callers must use uppercase
     * @returns {Map<string, {width: number, height: number}>} Map of resolution names to dimensions (keys in UPPERCASE)
     */
    getAllResolutions() {
        // Regenerate map if custom resolutions changed or map doesn't exist
        if (!this._resolutionDimensionsMap || this._customResolutionsDirty) {
            const map = new Map();

            // Add standard resolutions from nekoai-js RESOLUTION_DIMENSIONS
            // This keeps us in sync with package updates automatically
            const standardResolutions = nekoaijs.RESOLUTION_DIMENSIONS;
            if (standardResolutions && typeof standardResolutions === 'object') {
                Object.entries(standardResolutions).forEach(([name, dims]) => {
                    // dims is an array [width, height] from nekoai-js
                    if (Array.isArray(dims) && dims.length >= 2) {
                        // Store with uppercase key (nekoai-js uses lowercase keys, we normalize to uppercase)
                        map.set(name.toUpperCase(), { width: dims[0], height: dims[1] });
                    }
                });
            }

            // Add custom resolutions to map (already stored in uppercase)
            this.customResolutions.forEach((dims, name) => {
                map.set(name, dims);
            });

            this._resolutionDimensionsMap = map;
            this._customResolutionsDirty = false;
        }

        return this._resolutionDimensionsMap;
    }

    /**
     * Get dimensions for a resolution (fast O(1) lookup)
     * @param {string} resolution - Resolution name (must be UPPERCASE)
     * @returns {Object|null} { width, height } or null if not found
     */
    getResolutionDimensions(resolution) {
        if (!resolution) return null;

        const normalized = resolution.trim();
        const allResolutions = this.getAllResolutions();

        // Fast O(1) lookup from pre-generated map (expects uppercase)
        if (allResolutions.has(normalized)) {
            return allResolutions.get(normalized);
        }

        // Handle dynamic custom_ prefix (e.g., 'CUSTOM_2048x1536')
        // These aren't pre-registered, so parse on-the-fly
        if (normalized.startsWith('CUSTOM_')) {
            const dimensions = normalized.replace('CUSTOM_', '');
            const [width, height] = dimensions.split('x').map(Number);
            if (width && height && width > 0 && height > 0) {
                return { width, height };
            }
        }

        return null;
    }

    /**
     * Get NovelAI client
     */
    getNovelAiClient() {
        if (this.novelAiClient) {
            return this.novelAiClient;
        }
        return this.createNovelAiClient();
    }

    refreshNovelAiClient() {
        this.novelAiClient = null;
        this.clients.delete('novelai');
        return this.createNovelAiClient();
    }

    createNovelAiClient() {
        try {
            const apiKey = this.apiKeyManager.getActiveApiKey('novelai');
            if (!apiKey) {
                console.warn('⚠️ NovelAI Service key not found. Add one to secure.config.json or set NOVELAI_API_KEY.');
                return null;
            }
            const client = new nekoaijs.NovelAI({
                token: apiKey,
                timeout: 100000,
                verbose: !!this.getConfig()?.debugNovelAI
            });
            this.novelAiClient = client;
            this.setClient('novelai', client);
            return client;
        } catch (error) {
            console.error('❌ Failed to create NovelAI client:', error.message);
            this.novelAiClient = null;
            this.clients.delete('novelai');
            return null;
        }
    }

    getGrokClient() {
        if (this.grokClient) {
            return this.grokClient;
        }
        return this.createGrokClient();
    }

    getGrokService() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.grokService;
    }

    /**
     * Get the native @ai-sdk/xai service (for smaller utility tasks).
     * Supports streaming and native xAI web_search / x_search tools.
     * This is intentionally separate from the main GrokService (OpenAI SDK + Responses API).
     */
    getXaiNativeService() {
        if (!this.initialized) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.xaiNativeService;
    }

    /**
     * Get Prompt Logit Analyzer instance
     */
    getPromptLogitAnalyzer() {
        if (!this.initialized || !this.promptLogitAnalyzer) {
            throw new Error('Global resources not initialized - call initialize() first');
        }
        return this.promptLogitAnalyzer;
    }

    refreshGrokClient() {
        this.grokClient = null;
        this.clients.delete('grok');
        return this.createGrokClient();
    }

    createGrokClient() {
        try {
            const apiKey = this.apiKeyManager.getActiveApiKey('grok');
            if (!apiKey) {
                console.warn('⚠️ Grok API key not found. Add one to secure.config.json or set GROK_API_KEY.');
                return null;
            }
            const client = new OpenAI({
                apiKey,
                baseURL: 'https://api.x.ai/v1'
            });
            this.grokClient = client;
            this.setClient('grok', client);
            return client;
        } catch (error) {
            console.error('❌ Failed to create Grok client:', error.message);
            this.grokClient = null;
            this.clients.delete('grok');
            return null;
        }
    }

    /**
     * Check if resources are initialized
     */
    isInitialized() {
        return this.initialized;
    }

    /**
     * Initialize custom resolutions (xlarge and other custom resolutions)
     */
    initializeCustomResolutions() {
        // Register xlarge resolutions (these are custom resolutions beyond the standard Resolution enum)
        // Names will be normalized to uppercase by addCustomResolution
        const xlargeResolutions = [
            { name: 'XLARGE_PORTRAIT', width: 1408, height: 2112 },
            { name: 'XLARGE_LANDSCAPE', width: 2112, height: 1408 },
            { name: 'XLARGE_SQUARE', width: 1728, height: 1728 }
        ];

        xlargeResolutions.forEach(res => {
            try {
                this.addCustomResolution(res.name, res.width, res.height);
            } catch (error) {
                console.warn(`    ⚠️ Failed to register DreamScene custom resolution ${res.name}:`, error.message);
            }
        });

        console.log(`✓ Registered ${this.customResolutions.size} DreamScene custom resolution(s)`);
    }

    /**
     * Initialize master API clients (NovelAI, Grok, etc.)
     */
    async initializeMasterClients() {
        const missingKeys = [];

        // Initialize NovelAI client
        try {
            const novelAiKey = this.apiKeyManager.getActiveApiKey('novelai');
            if (novelAiKey) {
                this.novelAiClient = this.createNovelAiClient();
                if (this.novelAiClient) {
                    console.log('✓ NovelAI Image Generation Client ready');
                    this.initializationProgress.novelAiClient = true;
                    // Register restart handler
                    // No need to update anything - imageGeneration gets client directly from globalResources
                    this.registerClientRestartHandler('novelai', async (client) => {
                        console.log('🔄 NovelAI client reinitialized with selected API key.');
                        return !!client;
                    });
                } else {
                    missingKeys.push('NovelAI');
                }
            } else {
                missingKeys.push('NovelAI');
            }
        } catch (error) {
            console.error('    ❌ Failed to initialize NovelAI client:', error.message);
            missingKeys.push('NovelAI');
        }

        // Initialize Grok client
        try {
            const grokKey = this.apiKeyManager.getActiveApiKey('grok');
            if (grokKey) {
                this.grokClient = this.createGrokClient();
                if (this.grokClient) {
                    console.log('✓ xAI Grok client ready');
                    this.initializationProgress.grokClient = true;
                    // Register restart handler
                    // No need to update anything - grokService uses getGrokClient() which always returns current client
                    this.registerClientRestartHandler('grok', async (client) => {
                        console.log('🔄 Grok client reinitialized with selected API key.');
                        return !!client;
                    });
                } else {
                    missingKeys.push('Grok');
                }
            } else {
                missingKeys.push('Grok');
            }
        } catch (error) {
            console.error('    ❌ Failed to initialize Grok client:', error.message);
            missingKeys.push('Grok');
        }

        // Report missing keys
        if (missingKeys.length > 0) {
            console.log(`    ⚠️  Missing API keys for: ${missingKeys.join(', ')}`);
            console.log('       Add keys to secure.config.json to enable these services');
        }
    }

    /**
     * Register a restart handler for a client
     * @param {string} serviceId - Service identifier (e.g., 'novelai', 'grok')
     * @param {Function} handler - Async function that receives the new client instance
     */
    registerClientRestartHandler(serviceId, handler) {
        if (!serviceId || typeof handler !== 'function') {
            return;
        }
        this.restartHandlers.set(serviceId, handler);
        // Also register with apiKeyManager for compatibility
        // apiKeyManager calls handlers with (service, index), but we need to get the client
        this.apiKeyManager.registerRestartHandler(serviceId, async (service, index) => {
            // Refresh the client first
            let client;
            if (serviceId === 'novelai') {
                client = this.refreshNovelAiClient();
            } else if (serviceId === 'grok') {
                client = this.refreshGrokClient();
            } else {
                client = this.getClient(serviceId);
            }

            // Then call the handler with the client
            if (client && handler) {
                return await handler(client);
            }
            return false;
        });
    }

    /**
     * Get initialization progress
     */
    getInitializationProgress() {
        return {
            initialized: this.initialized,
            progress: this.initializationProgress,
            initTime: this.initEndTime && this.initStartTime
                ? ((this.initEndTime - this.initStartTime) / 1000).toFixed(2) + 's'
                : null
        };
    }

    /**
     * Account Data Management
     * Balance is stored at accountData.subscription.trainingStepsLeft
     */

    /**
     * Set account data (full account data object)
     * @param {Object} data - Account data object
     */
    setAccountData(data) {
        this.accountData = { ...data };
        // Ensure subscription.trainingStepsLeft structure exists
        if (!this.accountData.subscription) {
            this.accountData.subscription = {};
        }
        if (!this.accountData.subscription.trainingStepsLeft) {
            this.accountData.subscription.trainingStepsLeft = {
                fixedTrainingStepsLeft: 0,
                purchasedTrainingSteps: 0
            };
        }
        this.accountData.subscription = normalizeNovelAiSubscription(this.accountData.subscription);
    }

    /**
     * Get account data
     * @returns {Object} Current account data
     */
    getAccountData() {
        return { ...this.accountData };
    }

    /**
     * Account entitlement health for clients (Task 1 — Tasks 2/3 read same fields).
     * @returns {{ userDataValid: boolean, userDataError: string|null, accountStanding: string, banMessage: string|null, upstreamUnavailable: boolean }}
     */
    getAccountDataHealth() {
        return getAccountHealthPublicFields(this.accountDataHealth || evaluateAccountDataHealth({ ok: false }));
    }

    /**
     * Account health + persisted subscription renewal notice for clients.
     * @returns {ReturnType<typeof getAccountDataHealth> & ReturnType<typeof getAccountSubscriptionNoticeFields>}
     */
    getAccountClientFields() {
        return {
            ...this.getAccountDataHealth(),
            ...getAccountSubscriptionNoticeFields(),
        };
    }

    /**
     * @returns {{ subscriptionRenewalFailed: boolean, accountSubscriptionLastRefreshAt: string|null }}
     */
    getAccountSubscriptionNoticeFields() {
        return getAccountSubscriptionNoticeFields();
    }

    /**
     * Persist subscription snapshot; detect renewal failure; broadcast when notice becomes pending.
     * @param {object|null|undefined} subscription
     * @private
     */
    _recordAccountSubscriptionRefresh(subscription) {
        if (!subscription || typeof subscription !== 'object') {
            return null;
        }
        const result = recordSubscriptionRefresh(subscription);
        if (result.noticeChanged && result.renewalFailedPendingNotice) {
            this._broadcastAccountHealthUpdated(this.accountDataHealth?.userDataValid === true);
        }
        return result;
    }

    /**
     * Broadcast account health + balance to connected clients when health changes.
     * @param {boolean} wasValid - userDataValid before the update
     * @private
     */
    _broadcastAccountHealthUpdated(wasValid) {
        try {
            const wsServer = this.getWebSocketServer();
            if (wsServer && typeof wsServer.broadcast === 'function') {
                wsServer.broadcast({
                    type: 'account_data_health_updated',
                    data: {
                        ...this.getAccountClientFields(),
                        balance: this.getAccountBalance(),
                    },
                    timestamp: new Date().toISOString(),
                });
            }
        } catch (_) {
            // WebSocket server may not be ready during early boot
        }
    }

    /**
     * Apply health evaluation after balance/subscription sync; broadcast when fields change.
     * @param {{ ok?: boolean, reason?: string, error?: string|null, subscription?: object|null }} balanceResult
     * @private
     */
    _applyAccountHealthAfterBalanceSync(balanceResult) {
        const wasValid = this.accountDataHealth?.userDataValid === true;
        const prevSnapshot = JSON.stringify(this.getAccountDataHealth());
        this.accountDataHealth = evaluateAccountHealthAfterBalanceSync(this.accountData, balanceResult);
        if (this.accountDataHealth.userDataValid && this.accountData) {
            this.accountData.ok = true;
        } else if (this.accountData) {
            this.accountData.ok = false;
        }
        if (JSON.stringify(this.getAccountDataHealth()) !== prevSnapshot) {
            this._broadcastAccountHealthUpdated(wasValid);
        }
    }

    /**
     * Get account balance (extracted from accountData.subscription.trainingStepsLeft)
     * @returns {Object} Balance object with fixedTrainingStepsLeft, purchasedTrainingSteps, totalCredits
     */
    getAccountBalance() {
        const trainingStepsLeft = this.accountData?.subscription?.trainingStepsLeft || {
            fixedTrainingStepsLeft: 0,
            purchasedTrainingSteps: 0
        };
        const fixedTrainingStepsLeft = trainingStepsLeft.fixedTrainingStepsLeft || 0;
        const purchasedTrainingSteps = trainingStepsLeft.purchasedTrainingSteps || 0;
        const totalCredits = fixedTrainingStepsLeft + purchasedTrainingSteps;

        return {
            fixedTrainingStepsLeft,
            purchasedTrainingSteps,
            totalCredits
        };
    }

    /**
     * Set account balance (updates accountData.subscription.trainingStepsLeft)
     * @param {Object} balance - Balance object with fixedTrainingStepsLeft, purchasedTrainingSteps
     */
    setAccountBalance(balance) {
        // Ensure accountData structure exists
        if (!this.accountData) {
            this.accountData = { ok: false };
        }
        if (!this.accountData.subscription) {
            this.accountData.subscription = {};
        }
        this.accountData.subscription.trainingStepsLeft = {
            fixedTrainingStepsLeft: balance.fixedTrainingStepsLeft || 0,
            purchasedTrainingSteps: balance.purchasedTrainingSteps || 0
        };
    }

    /**
     * Set refresh balance callback (called from web_server.js)
     * Uses data plumbing system for callback management
     * @param {Function} callback - Async function to refresh balance
     */
    setRefreshBalanceCallback(callback) {
        // Store in both places for backward compatibility during migration
        this.refreshBalanceCallback = callback;
        // Also store in plumbing system
        this.dataPlumbing.setCallback('refreshBalance', callback, {
            temporary: false,
            category: 'account',
            tags: ['balance', 'refresh'],
            description: 'Callback to refresh account balance from API'
        });
    }

    /**
     * Set get balance callback (called from web_server.js)
     * Uses data plumbing system for callback management
     * @param {Function} callback - Async function to get balance
     */
    setGetBalanceCallback(callback) {
        // Store in both places for backward compatibility during migration
        this.getBalanceCallback = callback;
        // Also store in plumbing system
        this.dataPlumbing.setCallback('getBalance', callback, {
            temporary: false,
            category: 'account',
            tags: ['balance', 'api'],
            description: 'Callback to get account balance from API'
        });
    }

    /**
     * Set get user data callback (called from web_server.js)
     * Uses data plumbing system for callback management
     * @param {Function} callback - Async function to get user data
     */
    setGetUserDataCallback(callback) {
        // Store in both places for backward compatibility during migration
        this.getUserDataCallback = callback;
        // Also store in plumbing system
        this.dataPlumbing.setCallback('getUserData', callback, {
            temporary: false,
            category: 'account',
            tags: ['user', 'api'],
            description: 'Callback to get user data from API'
        });
    }

    /**
     * Initialize account data (refresh from API)
     * @param {boolean} force - Force refresh even if recently checked
     * @returns {Promise<void>}
     */
    async initializeAccountData(force = false) {
        const ACCOUNT_DATA_REFRESH_INTERVAL = 4 * 60 * 60 * 1000; // 4 hours
        const now = Date.now();

        if (now - this.lastAccountDataCheck < ACCOUNT_DATA_REFRESH_INTERVAL && !force) {
            return this.getAccountDataHealth();
        }

        const wasValid = this.accountDataHealth?.userDataValid === true;
        const prevSnapshot = JSON.stringify(this.getAccountDataHealth());

        let getUserDataFn = this.dataPlumbing.callbacks.has('getUserData')
            ? this.dataPlumbing.callbacks.get('getUserData').callback
            : (this.getUserDataCallback && typeof this.getUserDataCallback === 'function' ? this.getUserDataCallback : null);

        if (!getUserDataFn) {
            this.accountDataHealth = evaluateAccountDataHealth({ ok: false, reason: 'no_callback' });
            this.lastAccountDataCheck = now;
            if (JSON.stringify(this.getAccountDataHealth()) !== prevSnapshot) {
                this._broadcastAccountHealthUpdated(wasValid);
            }
            return this.getAccountDataHealth();
        }

        const userData = await getUserDataFn();
        const health = evaluateAccountDataHealth(userData);
        this.accountDataHealth = health;

        if (health.userDataValid) {
            this.setAccountData({ ...userData, ok: true });
            this.dataPlumbing.publish('accountData:updated', { ...userData, ...getAccountHealthPublicFields(health) });
        } else {
            const partial = userData && typeof userData === 'object' ? userData : {};
            this.setAccountData({
                ...partial,
                ok: false,
                error: health.userDataError || partial.error,
                reason: partial.reason || health.userDataError,
            });
            const logPrefix = health.upstreamUnavailable ? 'Account data unavailable (upstream)' : 'Account data invalid';
            console.warn(`⚠️ ${logPrefix}: ${health.userDataError || 'unknown error'}`);
        }

        if (this.accountData?.subscription) {
            this._recordAccountSubscriptionRefresh(this.accountData.subscription);
        }

        this.lastAccountDataCheck = now;

        if (JSON.stringify(this.getAccountDataHealth()) !== prevSnapshot) {
            this._broadcastAccountHealthUpdated(wasValid);
        }

        return this.getAccountDataHealth();
    }

    /**
     * Refresh account balance (refresh from API - faster/lower rate limit than full account data)
     * Updates accountData.subscription.trainingStepsLeft and accountData.subscription
     * @param {boolean} force - Force refresh even if recently checked
     * @returns {Promise<void>}
     */
    async refreshBalance(force = false) {
        const BALANCE_REFRESH_INTERVAL = 15 * 60 * 1000; // 15 minutes
        const now = Date.now();

        if (now - this.lastBalanceCheck >= (BALANCE_REFRESH_INTERVAL / 2) || force) {
            if (!force) {
                // Check if there are active WebSocket clients connected
                try {
                    const wsServer = this.getWebSocketServer();
                    if (wsServer && wsServer.getConnectionCount() === 0) {
                        return;
                    }
                } catch (error) {
                    // WebSocket server not initialized yet, skip check
                }
            }

            // Try plumbing first, fall back to direct callback for backward compatibility
            let getBalanceFn = this.dataPlumbing.callbacks.has('getBalance')
                ? this.dataPlumbing.callbacks.get('getBalance').callback
                : (this.getBalanceCallback && typeof this.getBalanceCallback === 'function' ? this.getBalanceCallback : null);

            if (getBalanceFn) {
                const newBalanceData = await getBalanceFn();

                if (newBalanceData && newBalanceData.ok) {
                    // Get old balance for deposit detection
                    const oldBalance = this.getAccountBalance();
                    const oldTotalBalance = oldBalance.totalCredits;
                    const newTotalBalance = newBalanceData.totalCredits;

                    // Check for deposits (balance increase)
                    if (newTotalBalance > oldTotalBalance) {
                        const depositAmount = newTotalBalance - oldTotalBalance;
                        console.log(`💰 Deposit detected: +${depositAmount} credits`);

                        // Determine which type of credits were deposited
                        const oldFixed = oldBalance.fixedTrainingStepsLeft;
                        const newFixed = newBalanceData.fixedTrainingStepsLeft;
                        const oldPurchased = oldBalance.purchasedTrainingSteps;
                        const newPurchased = newBalanceData.purchasedTrainingSteps;

                        if (newPurchased > oldPurchased) {
                            // Add deposit receipt
                            await this.getMetadataDatabase().addUnattributedReceipt({
                                type: 'deposit',
                                cost: newPurchased - oldPurchased,
                                creditType: 'paid',
                                date: now.valueOf()
                            });
                        }
                        if (newFixed > oldFixed) {
                            // Add deposit receipt
                            await this.getMetadataDatabase().addUnattributedReceipt({
                                type: 'deposit',
                                cost: newFixed - oldFixed,
                                creditType: 'fixed',
                                date: now.valueOf()
                            });
                        }
                    }

                    // Ensure accountData structure exists (even if we never got full account data)
                    if (!this.accountData) {
                        this.accountData = { ok: false };
                    }
                    if (!this.accountData.subscription) {
                        this.accountData.subscription = {};
                    }

                    // Update balance in accountData.subscription.trainingStepsLeft
                    this.accountData.subscription.trainingStepsLeft = {
                        fixedTrainingStepsLeft: newBalanceData.fixedTrainingStepsLeft || 0,
                        purchasedTrainingSteps: newBalanceData.purchasedTrainingSteps || 0
                    };

                    // Update account data subscription info with fresh balance data
                    // Merge subscription data if it exists in balanceData
                    if (newBalanceData.subscription) {
                        this.accountData.subscription = {
                            ...this.accountData.subscription,
                            ...newBalanceData.subscription,
                            trainingStepsLeft: this.accountData.subscription.trainingStepsLeft
                        };
                        this.accountData.subscription = normalizeNovelAiSubscription(this.accountData.subscription);
                        this._recordAccountSubscriptionRefresh(this.accountData.subscription);
                    }

                    this._applyAccountHealthAfterBalanceSync(newBalanceData);
                    this.lastBalanceCheck = now;
                } else if (newBalanceData) {
                    this._applyAccountHealthAfterBalanceSync(newBalanceData);
                }
            }
        }
    }

    /**
     * Calculate credit usage based on balance changes
     * @param {Object} oldBalance - Previous balance (optional, defaults to current balance)
     * @returns {Promise<Object>} Usage information with totalUsage, freeUsage, paidUsage, usageType
     */
    async calculateCreditUsage(oldBalance = null) {
        const previousBalance = oldBalance || this.getAccountBalance();

        // Refresh balance if callback is available
        await this.refreshBalance(true);

        const currentBalance = this.getAccountBalance();
        const totalUsage = Math.max(0, previousBalance.totalCredits - currentBalance.totalCredits);
        const freeUsage = Math.max(0, previousBalance.fixedTrainingStepsLeft - currentBalance.fixedTrainingStepsLeft);
        const paidUsage = Math.max(0, previousBalance.purchasedTrainingSteps - currentBalance.purchasedTrainingSteps);
        const usageType = totalUsage > 0 ? (paidUsage > 0 ? 'paid' : 'fixed') : 'free';

        return { totalUsage, freeUsage, paidUsage, usageType };
    }

    /**
     * Security and IP Blocking System
     */

    /**
     * Get blocked IPs map
     * @returns {Map} Map of blocked IPs
     */
    getBlockedIPs() {
        return this.blockedIPs;
    }

    /**
     * Get suspicious IPs map
     * @returns {Map} Map of suspicious IPs
     */
    getSuspiciousIPs() {
        return this.suspiciousIPs;
    }

    /**
     * Get invalid URL attempts map
     * @returns {Map} Map of invalid URL attempts
     */
    getInvalidURLAttempts() {
        return this.invalidURLAttempts;
    }

    /**
     * Get known bad paths map (probe URLs learned from blocked bots)
     * @returns {Map} Map of normalized path -> { firstSeen, lastSeen, hits }
     */
    getKnownBadPaths() {
        this.loadKnownBadPaths();
        return this.knownBadPaths;
    }

    /**
     * Load persisted known bad paths from disk (once)
     */
    loadKnownBadPaths() {
        if (this._knownBadPathsLoaded) return;
        this._knownBadPathsLoaded = true;

        const fs = require('fs');
        const filePath = this.getPath('knownBadPathsFile');

        if (fs.existsSync(filePath)) {
            try {
                const data = JSON.parse(fs.readFileSync(filePath, 'utf-8'));
                const entries = data.paths || data;
                if (Array.isArray(entries)) {
                    const now = Date.now();
                    for (const pathKey of entries) {
                        if (typeof pathKey === 'string' && pathKey && pathKey !== '/') {
                            this.knownBadPaths.set(pathKey, { firstSeen: now, lastSeen: now, hits: 1 });
                        }
                    }
                } else if (entries && typeof entries === 'object') {
                    for (const [pathKey, meta] of Object.entries(entries)) {
                        if (pathKey && pathKey !== '/') {
                            this.knownBadPaths.set(pathKey, {
                                firstSeen: meta.firstSeen || Date.now(),
                                lastSeen: meta.lastSeen || Date.now(),
                                hits: meta.hits || 1
                            });
                        }
                    }
                }
                if (this.logger) {
                    this.logger.info(`Loaded ${this.knownBadPaths.size} known bad path(s) from cache`);
                }
            } catch (err) {
                console.error('Failed to load known bad paths:', err.message);
            }
        } else {
            this._seedKnownBadPaths();
        }
    }

    _seedKnownBadPaths() {
        const seeds = [
            '/.env', '/.env.local', '/.env.production', '/.env.staging', '/.env.development',
            '/.git/config', '/.git/HEAD', '/wp-admin', '/wp-login.php', '/phpinfo.php',
            '/.aws/credentials', '/server-status', '/.DS_Store'
        ];
        const now = Date.now();
        for (const pathKey of seeds) {
            this.knownBadPaths.set(pathKey, { firstSeen: now, lastSeen: now, hits: 0 });
        }
    }

    /**
     * Record a URL path observed during bot/scraper activity
     * @param {string} urlPath - Normalized request path
     */
    recordKnownBadPath(urlPath) {
        if (!urlPath || urlPath === '/') return;

        this.loadKnownBadPaths();
        const now = Date.now();
        const existing = this.knownBadPaths.get(urlPath);

        if (existing) {
            existing.lastSeen = now;
            existing.hits++;
        } else {
            this.knownBadPaths.set(urlPath, { firstSeen: now, lastSeen: now, hits: 1 });
        }

        this._scheduleKnownBadPathsSave();
    }

    /**
     * Check if a path is a known bad probe URL
     * @param {string} urlPath - Normalized request path
     * @returns {boolean}
     */
    isKnownBadPath(urlPath) {
        if (!urlPath || urlPath === '/') return false;
        this.loadKnownBadPaths();
        return this.knownBadPaths.has(urlPath);
    }

    _scheduleKnownBadPathsSave() {
        if (this._knownBadPathsSaveTimer) {
            clearTimeout(this._knownBadPathsSaveTimer);
        }
        this._knownBadPathsSaveTimer = setTimeout(() => {
            this._knownBadPathsSaveTimer = null;
            this.saveKnownBadPaths();
        }, 5000);
    }

    /**
     * Persist known bad paths to disk
     * @param {number} maxPaths - Maximum paths to retain
     */
    saveKnownBadPaths(maxPaths = 50000) {
        const fs = require('fs');
        const filePath = this.getPath('knownBadPathsFile');

        try {
            let entries = Array.from(this.knownBadPaths.entries());

            if (entries.length > maxPaths) {
                entries.sort((a, b) => b[1].lastSeen - a[1].lastSeen);
                entries = entries.slice(0, maxPaths);
                this.knownBadPaths = new Map(entries);
            }

            const paths = Object.fromEntries(entries);
            const dir = path.dirname(filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            fs.writeFileSync(filePath, JSON.stringify({ paths, savedAt: Date.now() }), 'utf-8');
        } catch (err) {
            console.error('Failed to save known bad paths:', err.message);
        }
    }

    /**
     * Remove a single known bad path and persist
     * @param {string} urlPath
     * @returns {boolean} true if removed
     */
    deleteKnownBadPath(urlPath) {
        if (!urlPath || urlPath === '/') return false;
        this.loadKnownBadPaths();
        const removed = this.knownBadPaths.delete(urlPath);
        if (removed) {
            this.saveKnownBadPaths();
        }
        return removed;
    }

    /**
     * Clear all known bad paths and persist
     * @returns {number} count removed
     */
    clearKnownBadPaths() {
        this.loadKnownBadPaths();
        const count = this.knownBadPaths.size;
        this.knownBadPaths.clear();
        this.saveKnownBadPaths();
        return count;
    }

    /**
     * Check if IP address is in a private range
     * @param {string} ip - IP address to check
     * @returns {boolean} True if IP is in a private range
     */
    isPrivateIP(ip) {
        if (!ip || ip === 'unknown') return false;

        // IPv4 private ranges
        // 10.0.0.0/8
        if (ip.startsWith('10.')) return true;

        // 172.16.0.0/12 (172.16.0.0 to 172.31.255.255)
        if (ip.startsWith('172.')) {
            const parts = ip.split('.');
            if (parts.length >= 2) {
                const secondOctet = parseInt(parts[1], 10);
                if (secondOctet >= 16 && secondOctet <= 31) {
                    return true;
                }
            }
        }

        // 192.168.0.0/16
        if (ip.startsWith('192.168.')) return true;

        // 127.0.0.0/8 (loopback)
        if (ip.startsWith('127.')) return true;

        // IPv6 private ranges
        // ::1 (loopback)
        if (ip === '::1') return true;

        // fc00::/7 (unique local address)
        if (ip.startsWith('fc00:') || ip.startsWith('fd00:')) return true;

        // fe80::/10 (link-local)
        if (ip.startsWith('fe80:') || ip.startsWith('fe90:') ||
            ip.startsWith('fea0:') || ip.startsWith('feb0:')) return true;

        // IPv4-mapped IPv6 addresses (::ffff:10.0.0.1 format)
        if (ip.startsWith('::ffff:')) {
            const ipv4Part = ip.substring(7);
            return this.isPrivateIP(ipv4Part);
        }

        return false;
    }

    /**
     * Check if IP is blocked
     * @param {string} ip - IP address to check
     * @param {number} blockDurationMs - Block duration in milliseconds (default: 24 hours)
     * @returns {boolean} True if IP is blocked
     */
    isIPBlocked(ip, blockDurationMs = 24 * 60 * 60 * 1000) {
        // Never block private IP addresses
        if (this.isPrivateIP(ip)) {
            return false;
        }

        const blocked = this.blockedIPs.get(ip);
        if (!blocked) return false;

        // Check if block has expired
        if (Date.now() - blocked.blockedAt > blockDurationMs) {
            this.blockedIPs.delete(ip);
            return false;
        }

        return true;
    }

    /**
     * Block an IP address
     * @param {string} ip - IP address to block
     * @param {string} reason - Reason for blocking
     * @param {number} attempts - Number of attempts that triggered the block
     */
    blockIP(ip, reason, attempts) {
        // Never block private IP addresses
        if (this.isPrivateIP(ip)) {
            return;
        }

        this.blockedIPs.set(ip, {
            blockedAt: Date.now(),
            reason,
            attempts
        });
    }

    /**
     * Unblock an IP address
     * @param {string} ip - IP address to unblock
     * @returns {boolean} True if IP was blocked and is now unblocked
     */
    unblockIP(ip) {
        const wasBlocked = this.blockedIPs.has(ip);
        this.blockedIPs.delete(ip);
        this.suspiciousIPs.delete(ip);
        this.invalidURLAttempts.delete(ip);
        return wasBlocked;
    }

    /**
     * Cleanup old security data entries
     * @param {number} cleanupAgeMs - Age in milliseconds for cleanup (default: 24 hours)
     * @param {Object} config - Security config with max sizes
     */
    cleanupSecurityData(cleanupAgeMs = 24 * 60 * 60 * 1000, config = {}) {
        const now = Date.now();
        const MAX_SUSPICIOUS_IPS = this.getConfig()?.MAX_SUSPICIOUS_IPS || 5000;

        // Cleanup blocked IPs
        for (const [ip, data] of this.blockedIPs.entries()) {
            if (now - data.blockedAt > cleanupAgeMs) {
                this.blockedIPs.delete(ip);
            }
        }

        // Cleanup suspicious IPs
        for (const [ip, data] of this.suspiciousIPs.entries()) {
            if (now - data.lastSeen > cleanupAgeMs) {
                this.suspiciousIPs.delete(ip);
            }
        }

        // Cleanup invalid URL attempts
        for (const [ip, data] of this.invalidURLAttempts.entries()) {
            if (now - data.lastAttempt > cleanupAgeMs) {
                this.invalidURLAttempts.delete(ip);
            }
        }

        // Limit suspicious IPs size
        if (this.suspiciousIPs.size > MAX_SUSPICIOUS_IPS) {
            const entries = Array.from(this.suspiciousIPs.entries())
                .sort((a, b) => a[1].lastSeen - b[1].lastSeen)
                .slice(0, Math.floor(MAX_SUSPICIOUS_IPS * 0.1));

            entries.forEach(([ip]) => this.suspiciousIPs.delete(ip));
        }

        // Prune stale known bad paths (90 days without a hit)
        const MAX_KNOWN_BAD_PATHS = config.MAX_KNOWN_BAD_PATHS || 50000;
        const badPathMaxAgeMs = 90 * 24 * 60 * 60 * 1000;
        for (const [urlPath, data] of this.knownBadPaths.entries()) {
            if (now - data.lastSeen > badPathMaxAgeMs) {
                this.knownBadPaths.delete(urlPath);
            }
        }
        if (this.knownBadPaths.size > MAX_KNOWN_BAD_PATHS) {
            const entries = Array.from(this.knownBadPaths.entries())
                .sort((a, b) => b[1].lastSeen - a[1].lastSeen)
                .slice(0, MAX_KNOWN_BAD_PATHS);
            this.knownBadPaths = new Map(entries);
            this.saveKnownBadPaths(MAX_KNOWN_BAD_PATHS);
        }
    }

    /**
     * Cache Data Management
     */

    /**
     * Set global cache data
     * @param {Array} cacheData - Array of cache data entries
     */
    setGlobalCacheData(cacheData) {
        this.globalCacheData = cacheData;
        this.lastCacheCheck = Date.now();
    }

    /**
     * Get global cache data
     * @returns {Array} Current cache data
     */
    getGlobalCacheData() {
        return this.globalCacheData;
    }

    /**
     * Initialize cache data (refresh from filesystem)
     * @param {Function} generateCacheDataCallback - Callback function to generate cache data
     * @param {boolean} force - Force refresh even if recently checked
     * @returns {Promise<void>}
     */
    async initializeCacheData(generateCacheDataCallback, force = false) {
        const CACHE_REFRESH_INTERVAL = 30 * 60 * 1000; // 30 minutes
        const now = Date.now();

        if (now - this.lastCacheCheck >= CACHE_REFRESH_INTERVAL || force) {
            if (generateCacheDataCallback && typeof generateCacheDataCallback === 'function') {
                const cacheData = await generateCacheDataCallback();
                this.globalCacheData = cacheData;
                this.lastCacheCheck = now;
            }
        }
    }

    /**
     * Timer Management System
     */

    /**
     * Register a timer (interval or timeout)
     * @param {string} name - Human-readable name for the timer
     * @param {string} type - 'interval' or 'timeout'
     * @param {Function} callback - Function to call
     * @param {number} interval - Interval or delay in milliseconds
     * @returns {string} Timer ID
     */
    registerTimer(name, type, callback, interval) {
        const timerId = `${name}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
        let id;

        if (type === 'interval') {
            id = setInterval(() => {
                const timer = this.timers.get(timerId);
                if (timer) {
                    timer.lastRun = Date.now();
                    callback();
                }
            }, interval);
        } else if (type === 'timeout') {
            id = setTimeout(() => {
                callback();
                this.timers.delete(timerId);
            }, interval);
        } else {
            throw new Error(`Invalid timer type: ${type}. Must be 'interval' or 'timeout'`);
        }

        this.timers.set(timerId, {
            type,
            id,
            name,
            interval,
            callback,
            createdAt: Date.now(),
            lastRun: null
        });

        return timerId;
    }

    /**
     * Clear a timer by ID
     * @param {string} timerId - Timer ID to clear
     * @returns {boolean} True if timer was found and cleared
     */
    clearTimer(timerId) {
        const timer = this.timers.get(timerId);
        if (!timer) return false;

        if (timer.type === 'interval') {
            clearInterval(timer.id);
        } else if (timer.type === 'timeout') {
            clearTimeout(timer.id);
        }

        this.timers.delete(timerId);
        return true;
    }

    /**
     * Clear all timers
     */
    clearAllTimers() {
        for (const [timerId, timer] of this.timers.entries()) {
            if (timer.type === 'interval') {
                clearInterval(timer.id);
            } else if (timer.type === 'timeout') {
                clearTimeout(timer.id);
            }
        }
        this.timers.clear();
    }

    /**
     * Get all active timers
     * @returns {Array} Array of timer information
     */
    getAllTimers() {
        return Array.from(this.timers.entries()).map(([id, timer]) => ({
            id,
            name: timer.name,
            type: timer.type,
            interval: timer.interval,
            createdAt: timer.createdAt,
            lastRun: timer.lastRun,
            age: Date.now() - timer.createdAt,
            nextRun: timer.type === 'interval' ? (timer.lastRun ? timer.lastRun + timer.interval : timer.createdAt + timer.interval) : null
        }));
    }

    /**
     * Get timer by name (returns first match)
     * @param {string} name - Timer name to find
     * @returns {Object|null} Timer information or null
     */
    getTimerByName(name) {
        for (const [id, timer] of this.timers.entries()) {
            if (timer.name === name) {
                return { id, ...timer };
            }
        }
        return null;
    }

    /**
     * Clear timer by name (clears first match)
     * @param {string} name - Timer name to clear
     * @returns {boolean} True if timer was found and cleared
     */
    clearTimerByName(name) {
        for (const [id, timer] of this.timers.entries()) {
            if (timer.name === name) {
                return this.clearTimer(id);
            }
        }
        return false;
    }

    /**
     * Get ImageCounter module instance
     */
    getImageCounter() {
        return this.imageCounter;
    }

    /**
     * Get Tracing module instance
     */
    getTracing() {
        return this.tracing;
    }

    /**
     * Get ParallelPreviewGenerator class
     */
    getParallelPreviewGenerator() {
        return this.parallelPreviewGenerator;
    }

    /**
     * Get PngMetadata instance
     */
    getPngMetadata() {
        return this.pngMetadata;
    }


    /**
     * Sync previews - ensure all images have preview files
     * Moved from web_server.js to centralize initialization
     */
    async syncPreviews() {
        const fs = require('fs');
        const path = require('path');
        const imagesDir = this.getPath('images');
        const previewsDir = this.getPath('previews');
        const metadataDb = this.getMetadataDatabase();

        const files = fs.readdirSync(imagesDir).filter(f => f.match(/\.(png|jpg|jpeg)$/i));
        const previews = fs.readdirSync(previewsDir).filter(f => f.endsWith('.webp'));
        const baseMap = {};

        this.logger.bootSubStep(`Found ${files.length} images and ${previews.length} existing previews`);
        
        // Verify database entries exist for all files
        const dbFilenames = await metadataDb.getAllFilenames();
        const dbFilenameSet = new Set(dbFilenames);
        let missingDbEntries = 0;
        
        for (const file of files) {
            if (!dbFilenameSet.has(file)) {
                missingDbEntries++;
                this.logger.warn(`⚠️ File exists but no database entry: ${file}`);
            }
        }
        
        if (missingDbEntries > 0) {
            this.logger.bootSubStep(`⚠️ Found ${missingDbEntries} files without database entries`);
        }

        // Build baseMap - each unique base name gets its own entry
        for (const file of files) {
            const base = this.pngMetadata.getBaseName(file);
            if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
            if (file.includes('_upscaled')) baseMap[base].upscaled = file;
            else baseMap[base].original = file;
        }

        // Count how many previews need to be generated
        let missingPreviews = 0;
        const previewTypes = ['.webp', '@2x.webp', '@lq.webp'];

        for (const base in baseMap) {
            const imgFile = baseMap[base].original || baseMap[base].upscaled;
            if (imgFile) {
                for (const type of previewTypes) {
                    const previewPath = path.join(previewsDir, `${base}${type}`);
                    if (!fs.existsSync(previewPath)) {
                        missingPreviews++;
                        break; // Only count once per base image
                    }
                }
            }
        }

        if (missingPreviews > 0) {
            this.logger.bootSubStep(`Generating ${missingPreviews} missing preview sets`);

            // Prepare images that need preview generation
            const imagesToProcess = [];
            for (const base in baseMap) {
                const imgFile = baseMap[base].original || baseMap[base].upscaled;
                if (imgFile) {
                    const imgPath = path.join(imagesDir, imgFile);
                    let needsGeneration = false;

                    // Check if any preview type is missing
                    for (const type of previewTypes) {
                        const previewPath = path.join(previewsDir, `${base}${type}`);
                        if (!fs.existsSync(previewPath)) {
                            needsGeneration = true;
                            break;
                        }
                    }

                    if (needsGeneration) {
                        imagesToProcess.push({
                            imagePath: imgPath,
                            basename: base,
                            imageFile: imgFile
                        });
                    }
                }
            }

            // Use parallel preview generator
            const generator = new ParallelPreviewGenerator(this, {
                batchSize: Math.min(require('os').cpus().length, 6), // Max 6 workers
                skipExisting: false,
                forceRegenerate: false,
                onProgress: (processed, total, progress) => {
                    // Silent during boot
                },
                onComplete: (results) => {
                    this.logger.bootSubStep(`Generated ${results.processed} preview sets`);
                    if (results.errors > 0) {
                        this.logger.bootSubStep(`${results.errors} images failed to process`);
                    }
                },
                onError: (basename, error) => {
                    this.logger.error(`Failed to generate previews for ${basename}:`, error);
                }
            });

            // Generate previews for the images that need them
            await generator.generatePreviewsForImages(
                imagesToProcess.map(item => item.imageFile),
                imagesDir,
                previewsDir
            );
        } else {
            this.logger.bootSubStep('All previews are up to date');
        }

        // Remove orphan previews
        let orphanCount = 0;
        for (const preview of previews) {
            // Handle regular previews (.webp), @2x, @lq. Legacy @blur.webp is always removed (replaced by BlurHash).
            let base;
            if (preview.endsWith('@blur.webp')) {
                try {
                    fs.unlinkSync(path.join(previewsDir, preview));
                    orphanCount++;
                } catch (_e) { /* ignore */ }
                continue;
            }
            if (preview.endsWith('@lq.webp')) {
                base = preview.replace(/@lq\.webp$/, '');
            } else if (preview.endsWith('@2x.webp')) {
                base = preview.replace(/@2x\.webp$/, '');
            } else if (preview.endsWith('.webp')) {
                base = preview.replace(/\.webp$/, '');
            } else {
                continue;
            }

            // Check if base image exists
            const originalFile = baseMap[base]?.original || baseMap[base]?.upscaled;
            if (!originalFile) {
                const previewPath = path.join(previewsDir, preview);
                try {
                    fs.unlinkSync(previewPath);
                    orphanCount++;
                } catch (error) {
                    // Ignore errors deleting orphan previews
                }
            }
        }

        if (orphanCount > 0) {
            this.logger.bootSubStep(`Removed ${orphanCount} orphan preview files`);
        }

        // Fill missing BlurHash rows via the live DB connections (never open a second writer).
        try {
            const blurhashLog = (msg) => {
                if (String(msg).startsWith('  …')) {
                    console.log(msg);
                    return;
                }
                this.logger.bootSubStep(msg);
            };
            const imageStats = await metadataDb.backfillMissingBlurhashes({
                imagesDir,
                previewsDir,
                log: blurhashLog
            });
            if (imageStats.total > 0 || imageStats.updated > 0) {
                this.logger.bootSubStep(
                    `BlurHash gallery: updated ${imageStats.updated}/${imageStats.total}` +
                    ` (gallery sync ${imageStats.gallerySynced}, failed ${imageStats.failed})`
                );
            } else {
                this.logger.bootSubStep('BlurHash gallery: up to date');
            }

            const refDb = this.referenceMetadataDatabase;
            if (refDb) {
                // modules/referenceMetadataDatabase.js — backfillMissingBlurhashes
                const refStats = await refDb.backfillMissingBlurhashes({
                    previewCacheDir: this.getPath('previewCache'),
                    uploadCacheDir: this.getPath('uploadCache'),
                    log: blurhashLog
                });
                const refWork = (refStats.refsTotal || 0) + (refStats.vibesTotal || 0);
                if (refWork > 0 || refStats.refsUpdated || refStats.vibesUpdated) {
                    this.logger.bootSubStep(
                        `BlurHash refs: files ${refStats.refsUpdated}/${refStats.refsTotal},` +
                        ` vibes ${refStats.vibesUpdated}/${refStats.vibesTotal}`
                    );
                } else {
                    this.logger.bootSubStep('BlurHash refs: up to date');
                }
            }
        } catch (blurhashError) {
            this.logger.error('BlurHash backfill during preview sync failed:', blurhashError);
            this.logger.bootSubStep(`⚠️ BlurHash backfill failed: ${blurhashError.message}`);
        }

        // Also check cache previews
        const cacheDir = this.getPath('previewCache');
        if (fs.existsSync(cacheDir)) {
            const cacheFiles = fs.readdirSync(cacheDir).filter(f => f.endsWith('.webp'));
            this.logger.bootSubStep(`Found ${cacheFiles.length} cache files`);

            // Check cache previews are up to date (simplified check)
            this.logger.bootSubStep('All cache previews are up to date');
        }
        
    }

    /**
     * Clear temp downloads directory
     * Moved from web_server.js to centralize initialization
     */
    clearTempDownloads() {
        const fs = require('fs');
        const tempDownloadDir = this.getPath('tempDownload');

        try {
            if (fs.existsSync(tempDownloadDir)) {
                const files = fs.readdirSync(tempDownloadDir);
                let deletedCount = 0;

                for (const file of files) {
                    try {
                        const filePath = path.join(tempDownloadDir, file);
                        fs.unlinkSync(filePath);
                        deletedCount++;
                    } catch (error) {
                        // Ignore errors deleting individual files
                    }
                }

                if (deletedCount > 0) {
                    console.log(`🗑️ Cleared ${deletedCount} temp download files`);
                }
            }
        } catch (error) {
            console.warn('⚠️ Error clearing temp downloads:', error.message);
        }
    }

    /**
     * Generate login sprite sheet
     * Moved from web_server.js to centralize initialization
     */
    async generateLoginSpriteSheet() {
        const fs = require('fs');
        const cacheDir = this.getPath('cache');
        const spritePath = path.join(cacheDir, 'login_array.jpg');

        try {
            // Check if sprite sheet exists and is less than 1 hour old
            if (fs.existsSync(spritePath)) {
                const stats = fs.statSync(spritePath);
                const ageInHours = (Date.now() - stats.mtime.getTime()) / (1000 * 60 * 60);
                if (ageInHours < 1) {
                    console.log(`✓ Sprite sheet is still valid (${ageInHours.toFixed(2)} hours old), skipping regeneration`);
                    return;
                }
            }

            // Get pinned and random images (helper functions moved to globalResources)
            const pinnedImages = await this.getPinnedImages();
            const randomImages = await this.getRandomWorkspaceImages();

            console.log(`✓ Image selection: ${pinnedImages.length} pinned + ${randomImages.length} random available`);

            // Ensure we have at least some images to work with
            if (pinnedImages.length === 0 && randomImages.length === 0) {
                console.log('⚠️ No images found for sprite sheet, skipping generation');
                return;
            }

            // If no pinned images, use more random images to fill the quota
            let selectedImages;
            if (pinnedImages.length === 0) {
                selectedImages = randomImages.slice(0, 20);
            } else if (pinnedImages.length < 20) {
                const remainingSlots = 20 - pinnedImages.length;
                selectedImages = [...pinnedImages, ...randomImages.slice(0, remainingSlots)];
            } else {
                selectedImages = pinnedImages.slice(0, 20);
            }

            if (selectedImages.length === 0) {
                console.log('⚠️ No valid images found for sprite sheet');
                return;
            }

            // Create vertical sprite sheet: 1 column, N rows (images)
            const width = 1024;
            const height = 1024;
            await this.generateCombinedSpriteSheet(selectedImages, spritePath, width, height);

            console.log('✓ Login sprite sheet generated successfully');

        } catch (error) {
            console.error('    ⚠️ Error generating login sprite sheet:', error);
            // Don't throw the error, just log it so the server can continue
        }
    }

    /**
     * Get pinned images from workspaces
     * Helper for sprite sheet generation
     */
    async getPinnedImages() {
        const fs = require('fs');
        const imagesDir = this.getPath('images');
        const workspaces = this.getWorkspaceManager().getWorkspaces();

        if (!workspaces || typeof workspaces !== 'object') {
            console.warn('⚠️ Workspaces is not a valid object:', typeof workspaces);
            return [];
        }

        // Validate workspace structure
        if (Object.keys(workspaces).length === 0) {
            console.warn('⚠️ No workspaces found');
            return [];
        }

        const pinnedImages = [];

        // workspaces is an object with workspace IDs as keys, so we need to iterate over its values
        Object.entries(workspaces).forEach(([workspaceId, workspace]) => {
            if (!workspace || typeof workspace !== 'object') {
                console.warn(`⚠️ Invalid workspace object for ID: ${workspaceId}`);
                return;
            }

            if (workspace.pinned && Array.isArray(workspace.pinned) && workspace.pinned.length > 0) {
                // Select only 1 pinned image from this workspace for variety
                const randomPinnedIndex = Math.floor(Math.random() * workspace.pinned.length);
                const pinnedFile = workspace.pinned[randomPinnedIndex];

                if (!pinnedFile || typeof pinnedFile !== 'string') {
                    console.warn(`  ⚠️ Invalid pinned file entry:`, pinnedFile);
                    return;
                }

                const imagePath = path.join(imagesDir, pinnedFile);
                if (fs.existsSync(imagePath) && pinnedFile.match(/\.(png|jpg|jpeg)$/i)) {
                    pinnedImages.push({
                        filename: pinnedFile,
                        path: imagePath,
                        workspace: workspace.name || workspaceId
                    });
                } else {
                    console.log(`  ⚠️ Skipped pinned image (not found or invalid): ${pinnedFile}`);
                }
            }
        });

        return pinnedImages;
    }

    /**
     * Get random workspace images
     * Helper for sprite sheet generation
     */
    async getRandomWorkspaceImages() {
        const fs = require('fs');
        const imagesDir = this.getPath('images');

        try {
            // Check if images directory exists
            if (!fs.existsSync(imagesDir)) {
                console.warn('⚠️ Images directory does not exist:', imagesDir);
                return [];
            }

            const imageFiles = fs.readdirSync(imagesDir)
                .filter(file => file.match(/\.(png|jpg|jpeg)$/i))
                .map(file => ({
                    filename: file,
                    path: path.join(imagesDir, file)
                }));

            if (imageFiles.length === 0) {
                console.warn('⚠️ No image files found in images directory');
                return [];
            }

            // Shuffle and return random images
            return imageFiles.sort(() => 0.5 - Math.random());
        } catch (error) {
            console.error('❌ Error getting random workspace images:', error);
            return [];
        }
    }

    /**
     * Generate combined sprite sheet (single column, vertical stack)
     * Helper for sprite sheet generation
     */
    async generateCombinedSpriteSheet(images, outputPath, width, height) {
        const sharp = require('sharp');
        const imagesDir = this.getPath('images');

        const imageBuffers = [];

        for (const img of images) {
            try {
                const imagePath = typeof img === 'string' ? path.join(imagesDir, img) : img.path;

                // Load and resize normal image
                const normalBuffer = await sharp(imagePath)
                    .resize(width, height, { fit: 'cover', position: 'center' })
                    .jpeg({ quality: 85 })
                    .toBuffer();
                imageBuffers.push(normalBuffer);
            } catch (error) {
                console.warn(`⚠️ Failed to process image ${img.filename || img}:`, error.message);
                // Add placeholder buffers if image fails
                const placeholder = Buffer.alloc(width * height * 3, 0);
                imageBuffers.push(placeholder);
            }
        }

        // Create sprite sheet: 1 column, N rows (images)
        const totalHeight = height * images.length;
        const totalWidth = width;

        const spriteCanvas = sharp({
            create: {
                width: totalWidth,
                height: totalHeight,
                channels: 3,
                background: { r: 0, g: 0, b: 0 }
            }
        });

        // Composite all images vertically
        const composites = [];
        for (let i = 0; i < images.length; i++) {
            const y = i * height;
            composites.push({
                input: imageBuffers[i],
                left: 0,
                top: y
            });
        }

        await spriteCanvas
            .composite(composites)
            .jpeg({ quality: 90 })
            .toFile(outputPath);

        console.log(`✓ Generated Login Sprite Sheet (${images.length} images)`);
    }

    /**
     * Initialize Express app and HTTP server
     * @param {Function} setupMiddleware - Callback to set up middleware (rate limiting, compression, etc.)
     * @param {Function} setupRoutes - Callback to set up routes
     * @returns {Object} { app, server }
     */
    initializeExpressApp(setupMiddleware = null, setupRoutes = null) {
        if (this.expressApp) {
            console.warn('⚠️ Express app already initialized');
            return { app: this.expressApp, server: this.httpServer };
        }

        const express = require('express');
        const http = require('http');

        const app = express();
        const server = http.createServer(app);
        console.log('✓ HTTP Server ready');

        this.expressApp = app;
        this.httpServer = server;
        this.initializationProgress.expressApp = true;
        this.initializationProgress.httpServer = true;

        // Call setup callbacks if provided
        if (setupMiddleware && typeof setupMiddleware === 'function') {
            setupMiddleware(app);
            console.log('✓ Middleware loaded');
        }

        if (setupRoutes && typeof setupRoutes === 'function') {
            setupRoutes(app);
            console.log('✓ Routes loaded');
        }

        return { app, server };
    }

    /**
     * Initialize session store (SQLite or Memory)
     * @returns {Object} Session store instance
     */
    initializeSessionStore() {
        if (this.sessionStore) {
            console.warn('⚠️ Session store already initialized');
            return this.sessionStore;
        }

        const session = require('express-session');
        const path = require('path');
        const fs = require('fs');

        let SQLiteStore = null;
        try {
            SQLiteStore = require('connect-sqlite3')(session);
        } catch (e) {
            console.warn('⚠️ connect-sqlite3 is not installed. Falling back to MemoryStore. Run "npm i connect-sqlite3" to enable SQLite-backed sessions.');
        }

        if (SQLiteStore) {
            try {
                const sessionsDir = this.getPath('sessions');
                if (!fs.existsSync(sessionsDir)) {
                    fs.mkdirSync(sessionsDir, { recursive: true });
                }
                this.sessionStore = new SQLiteStore({
                    dir: sessionsDir,
                    db: 'sessions.sqlite',
                    table: 'sessions',
                    concurrentDB: true
                });
                console.log('✓ SQLite Session Store ready');
            } catch (err) {
                console.error('❌ Failed to initialize SQLite session store, falling back to MemoryStore:', err.message);
                this.sessionStore = new session.MemoryStore();
                console.log('✓ Failed to initialize SQLite session store, Memory Session Store ready (fallback)');
            }
        } else {
            this.sessionStore = new session.MemoryStore();
            console.log('✓ Memory Session Store ready (fallback)');
        }

        return this.sessionStore;
    }

    /**
     * Initialize WebSocket server and message handlers
     * @returns {Object} { wsServer, wsMessageHandlers }
     */
    initializeWebSocketServer() {
        if (this.webSocketServer) {
            console.warn('⚠️ WebSocket server already initialized');
            return { wsServer: this.webSocketServer, wsMessageHandlers: this.wsMessageHandlers };
        }

        if (!this.httpServer) {
            throw new Error('HTTP server must be initialized before WebSocket server');
        }

        // Ensure session store is initialized
        if (!this.sessionStore) {
            this.initializeSessionStore();
        }

        const { WebSocketServer } = require('./websocket');
        const { WebSocketMessageHandlers } = require('./websocketHandlers');

        // Create message handlers
        this.wsMessageHandlers = new WebSocketMessageHandlers(this);

        // Create WebSocket server (server and sessionStore accessed via globalResources)
        const wsServer = new WebSocketServer(this);

        this.webSocketServer = wsServer;
        this.initializationProgress.webSocketServer = true;
        return { wsServer, wsMessageHandlers: this.wsMessageHandlers };
    }

    /**
     * Get WebSocket message handlers
     */
    getWebSocketMessageHandlers() {
        if (!this.wsMessageHandlers) {
            throw new Error('WebSocket message handlers not initialized - call initializeWebSocketServer() first');
        }
        return this.wsMessageHandlers;
    }

    /**
     * Get session store (initializes if not already initialized)
     */
    getSessionStore() {
        if (!this.sessionStore) {
            this.initializeSessionStore();
        }
        return this.sessionStore;
    }

    /**
     * Start the HTTP server
     * @param {number} port - Port to listen on (optional, uses config if not provided)
     * @returns {Promise<void>}
     */
    async startWebServer(port = null) {
        if (!this.httpServer) {
            throw new Error('HTTP server not initialized - call initializeExpressApp() first');
        }

        const listenPort = port || this.getConfig({ path: 'port' });

        return new Promise((resolve, reject) => {
            this.httpServer.listen(listenPort, (error) => {
                if (error) {
                    reject(error);
                } else {
                    console.log(`✓ HTTP server listening on port ${listenPort}`);
                    resolve();
                }
            });
        });
    }

    /**
     * Flush pending work, checkpoint, and close databases before restart/shutdown.
     * Safe to call more than once; subsequent calls await the first run.
     */
    async prepareForRestart() {
        if (this._prepareForRestartPromise) {
            return this._prepareForRestartPromise;
        }

        this._prepareForRestartPromise = this._runPrepareForRestart();
        return this._prepareForRestartPromise;
    }

    async _runPrepareForRestart() {
        const log = (msg) => {
            if (this.logger) {
                this.logger.info(msg);
            } else {
                console.log(msg);
            }
        };

        log('Preparing server for restart…');

        if (this.globalCheckpointManager) {
            this.globalCheckpointManager.stopPeriodicCheckpoints();
        }

        try {
            const wsServer = this.getWebSocketServer();
            if (wsServer) {
                wsServer.stopPingInterval();
                wsServer.stopQueueStatusInterval();
                if (wsServer.isIndexing && typeof wsServer.setIndexingPaused === 'function') {
                    wsServer.setIndexingPaused(true);
                }
            }
        } catch (_) { /* WebSocket server may not be initialized */ }

        this.stopGenerationQuipsAutoUpdate();

        try {
            const handlers = this.getWebSocketMessageHandlers();
            handlers?.stopAllKeepAliveIntervals?.();
        } catch (_) { /* handlers may not be initialized */ }

        try {
            const tagCache = this.getTagSuggestionsCache();
            if (tagCache?.isDirty) {
                log('Saving tag cache before restart');
                tagCache.saveCache();
            }
        } catch (_) { /* tag cache optional */ }

        const flushedCount = this.flushAllPendingConfigSaves();
        if (flushedCount > 0) {
            log(`Flushed ${flushedCount} pending config save(s) before restart`);
        }

        if (this._knownBadPathsSaveTimer) {
            clearTimeout(this._knownBadPathsSaveTimer);
            this._knownBadPathsSaveTimer = null;
        }
        if (this.knownBadPaths.size > 0) {
            this.saveKnownBadPaths();
            log(`Saved ${this.knownBadPaths.size} known bad path(s) before restart`);
        }

        if (this.asyncSQLiteManager) {
            await this.asyncSQLiteManager.checkpointAllDirty();
        }

        if (this.globalCheckpointManager) {
            for (const name of this.globalCheckpointManager.getAllCheckpointManagers().keys()) {
                await this.globalCheckpointManager.createCheckpoint(name, true);
            }
        }

        if (this.polymoduleManager) {
            this.polymoduleManager.stopAll();
            await new Promise((resolve) => setTimeout(resolve, 500));
        }

        await this._closeAllDatabasesForShutdown();

        log('Server prepared for restart');
    }

    async _closeAllDatabasesForShutdown() {
        const closeSafely = async (label, fn) => {
            if (!fn) return;
            try {
                await fn();
            } catch (error) {
                console.warn(`⚠️ ${label} database close:`, error.message);
            }
        };

        if (this.referenceMetadataDatabase?.close) {
            try {
                this.referenceMetadataDatabase.close();
            } catch (error) {
                console.warn('⚠️ Reference metadata database close:', error.message);
            }
            this.referenceMetadataDatabase = null;
        }

        await closeSafely('metadata', () => this.metadataDatabase?.closeDatabase?.());
        await closeSafely('chat', () => this.chatDatabase?.closeChatDatabase?.());
        await closeSafely('director', () => this.directorDatabase?.closeDirectorDatabase?.());
        await closeSafely('notes', () => this.notesDatabase?.closeNotesDatabase?.());
        await closeSafely('vfs', () => this.vfsDatabase?.closeVfsDatabase?.());

        if (this.tagSearchDatabase?.closeTagSearchDatabase) {
            try {
                this.tagSearchDatabase.closeTagSearchDatabase();
            } catch (error) {
                console.warn('⚠️ Tag search database close:', error.message);
            }
        }

        if (this.knowledgeMemoryDb?.closeKnowledgeMemoryDatabase) {
            try {
                this.knowledgeMemoryDb.closeKnowledgeMemoryDatabase();
            } catch (error) {
                console.warn('⚠️ Knowledge memory database close:', error.message);
            }
        }

        if (this.naxTagsDatabase?.shutdownNaxTagsDatabase) {
            try {
                this.naxTagsDatabase.shutdownNaxTagsDatabase();
            } catch (error) {
                console.warn('⚠️ NAX tags database shutdown:', error.message);
            }
            this.naxTagsDatabase = null;
        }

        if (this.asyncSQLiteManager) {
            try {
                await this.asyncSQLiteManager.closeAll();
            } catch (error) {
                console.warn('⚠️ Async SQLite manager close:', error.message);
            }
        }
    }

    /**
     * Cleanup and shutdown all resources
     * Called on server shutdown
     */
    async shutdown() {
        console.log('🔄 Shutting down global resources...');
        await this.prepareForRestart();
        console.log('✓ Global resources shutdown complete');
    }

    /**
     * Restart the web server
     * @returns {Promise<void>}
     */
    async restartWebServer() {
        console.log('🔄 Restarting web server...');

        // Stop WebSocket server if running
        if (this.webSocketServer) {
            try {
                this.webSocketServer.stopPingInterval();
                this.webSocketServer.stopQueueStatusInterval();
            } catch (error) {
                console.warn('⚠️ Error stopping WebSocket intervals:', error.message);
            }
        }

        // Close HTTP server
        if (this.httpServer) {
            return new Promise((resolve, reject) => {
                this.httpServer.close((error) => {
                    if (error) {
                        reject(error);
                        return;
                    }

                    // Reset server instances
                    this.httpServer = null;
                    this.webSocketServer = null;
                    this.wsMessageHandlers = null;
                    this.initializationProgress.httpServer = false;
                    this.initializationProgress.webSocketServer = false;
                    this.initializationProgress.generationQuipsAutoUpdate = false;

                    // Reinitialize
                    this.initializeExpressApp().then(() => {
                        this.startWebServer().then(resolve).catch(reject);
                    }).catch(reject);
                });
            });
        }

        // If no server was running, just initialize and start
        this.initializeExpressApp();
        await this.startWebServer();
    }
}

// Export singleton instance
const globalResources = new GlobalResources();

module.exports = globalResources;