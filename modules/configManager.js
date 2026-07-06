const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { JSONCheckpointManager } = require('./jsonCheckpoint');
const { DEFAULT_AUTOFILL_RANKING } = require('./autofillRankingSettings');

/**
 * Fluent API for config modifications
 * Provides type-safe, chainable methods for common config operations
 */
class ConfigModifier {
    constructor(configManager, configType, options = {}) {
        this.configManager = configManager;
        this.configType = configType;
        this.options = options;
        this.operations = [];
    }

    /**
     * Delete a key or array item at path
     * @param {string|string[]} keyPath - Path to delete
     * @returns {Promise<boolean>} Success status
     * 
     * @example
     * // Delete key
     * modifyConfig('promptConfig').delete('preset_group.myGroup');
     * 
     * // Delete array item by predicate
     * modifyConfig('favorites').delete('tags', tag => tag.id === 'tag1');
     */
    delete(keyPath, predicateOrIndex = null) {
        return this.configManager.modifyConfig(this.configType, (cfg) => {
            if (predicateOrIndex !== null) {
                // Array deletion with predicate or index
                const array = this.configManager._getValueByPath(cfg, keyPath);
                if (!Array.isArray(array)) {
                    throw new Error(`Path ${keyPath} does not point to an array`);
                }
                
                if (typeof predicateOrIndex === 'function') {
                    const filtered = array.filter(item => !predicateOrIndex(item));
                    this.configManager._setValueByPath(cfg, keyPath, filtered);
                } else if (Number.isInteger(predicateOrIndex)) {
                    array.splice(predicateOrIndex, 1);
                } else {
                    throw new Error('Second argument must be a predicate function or numeric index');
                }
            } else {
                // Key deletion
                const keys = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
                let current = cfg;
                
                for (let i = 0; i < keys.length - 1; i++) {
                    if (!(keys[i] in current)) return cfg;
                    current = current[keys[i]];
                }
                
                delete current[keys[keys.length - 1]];
            }
            return cfg;
        }, this.options);
    }

    /**
     * Merge object into existing object at path (creates if doesn't exist)
     * @param {string|string[]} keyPath - Path to merge into
     * @param {Object} value - Object to merge
     * @returns {Promise<boolean>} Success status
     * 
     * @example
     * modifyConfig('promptConfig').merge('presets.myPreset', { steps: 28, cfg_scale: 7 });
     */
    merge(keyPath, value) {
        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
            throw new Error('merge() requires an object value');
        }

        return this.configManager.modifyConfig(this.configType, (cfg) => {
            const existing = this.configManager._getValueByPath(cfg, keyPath);
            
            if (existing === undefined) {
                // Create new object
                this.configManager._setValueByPath(cfg, keyPath, value);
            } else if (typeof existing === 'object' && !Array.isArray(existing) && existing !== null) {
                // Merge into existing object
                Object.assign(existing, value);
            } else {
                throw new Error(`Path ${keyPath} exists but is not an object (cannot merge)`);
            }
            
            return cfg;
        }, this.options);
    }

    /**
     * Assign/replace value at path
     * @param {string|string[]} keyPath - Path to assign to
     * @param {*} value - Value to assign
     * @returns {Promise<boolean>} Success status
     * 
     * @example
     * modifyConfig('promptConfig').assign('presets.myPreset.steps', 28);
     */
    assign(keyPath, value) {
        return this.configManager.updateConfigValue(this.configType, keyPath, value, this.options);
    }

    /**
     * Append item(s) to array at path
     * @param {string|string[]} keyPath - Path to array
     * @param {*} value - Item or items to append
     * @returns {Promise<boolean>} Success status
     * 
     * @example
     * modifyConfig('favorites').append('tags', { id: 'tag1', name: 'nature' });
     * modifyConfig('favorites').append('tags', [item1, item2]); // Append multiple
     */
    append(keyPath, value) {
        return this.configManager.modifyConfig(this.configType, (cfg) => {
            const array = this.configManager._getValueByPath(cfg, keyPath);
            
            if (array === undefined) {
                // Create new array
                this.configManager._setValueByPath(cfg, keyPath, Array.isArray(value) ? value : [value]);
            } else if (Array.isArray(array)) {
                if (Array.isArray(value)) {
                    array.push(...value);
                } else {
                    array.push(value);
                }
            } else {
                throw new Error(`Path ${keyPath} exists but is not an array`);
            }
            
            return cfg;
        }, this.options);
    }

    /**
     * Prepend item(s) to array at path
     * @param {string|string[]} keyPath - Path to array
     * @param {*} value - Item or items to prepend
     * @returns {Promise<boolean>} Success status
     * 
     * @example
     * modifyConfig('favorites').prepend('tags', { id: 'tag1', name: 'nature' });
     */
    prepend(keyPath, value) {
        return this.configManager.modifyConfig(this.configType, (cfg) => {
            const array = this.configManager._getValueByPath(cfg, keyPath);
            
            if (array === undefined) {
                // Create new array
                this.configManager._setValueByPath(cfg, keyPath, Array.isArray(value) ? value : [value]);
            } else if (Array.isArray(array)) {
                if (Array.isArray(value)) {
                    array.unshift(...value);
                } else {
                    array.unshift(value);
                }
            } else {
                throw new Error(`Path ${keyPath} exists but is not an array`);
            }
            
            return cfg;
        }, this.options);
    }

    /**
     * Replace array item at index or matching predicate
     * @param {string|string[]} keyPath - Path to array
     * @param {number|Function} indexOrPredicate - Index or predicate function
     * @param {*} value - New value
     * @returns {Promise<boolean>} Success status
     * 
     * @example
     * modifyConfig('favorites').replace('tags', 0, newTag); // By index
     * modifyConfig('favorites').replace('tags', t => t.id === 'tag1', newTag); // By predicate
     */
    replace(keyPath, indexOrPredicate, value) {
        return this.configManager.modifyConfig(this.configType, (cfg) => {
            const array = this.configManager._getValueByPath(cfg, keyPath);
            
            if (!Array.isArray(array)) {
                throw new Error(`Path ${keyPath} does not point to an array`);
            }
            
            if (typeof indexOrPredicate === 'function') {
                const index = array.findIndex(indexOrPredicate);
                if (index !== -1) {
                    array[index] = value;
                }
            } else if (Number.isInteger(indexOrPredicate)) {
                if (indexOrPredicate >= 0 && indexOrPredicate < array.length) {
                    array[indexOrPredicate] = value;
                }
            } else {
                throw new Error('Second argument must be a predicate function or numeric index');
            }
            
            return cfg;
        }, this.options);
    }

    /**
     * Update object at path using callback
     * @param {string|string[]} keyPath - Path to object
     * @param {Function} updateFn - Function that receives object and modifies it
     * @returns {Promise<boolean>} Success status
     * 
     * @example
     * modifyConfig('promptConfig').update('presets.myPreset', preset => {
     *     preset.steps = 28;
     *     preset.cfg_scale = 7;
     * });
     */
    update(keyPath, updateFn) {
        if (typeof updateFn !== 'function') {
            throw new Error('update() requires a function');
        }

        return this.configManager.modifyConfig(this.configType, (cfg) => {
            const value = this.configManager._getValueByPath(cfg, keyPath);
            if (value !== undefined) {
                updateFn(value);
            }
            return cfg;
        }, this.options);
    }
}

/**
 * Global Checkpoint Manager
 * Manages all database and JSON checkpoints with staggered timing to prevent simultaneous snapshots
 */
class GlobalCheckpointManager {
    constructor(globalResources = null) {
        this.checkpointManagers = new Map(); // name -> { manager, type, staggerOffset }
        this.periodicCheckpointInterval = null;
        this.checkpointInterval = 60 * 60 * 1000; // 1 hour default
        this.staggerDelay = 5 * 60 * 1000; // 5 minutes between checkpoints
        this.globalResources = globalResources;
    }
    
    /**
     * Register a checkpoint manager
     * @param {string} name - Unique name for this checkpoint manager
     * @param {Object} manager - Checkpoint manager instance (DatabaseCheckpointManager or JSONCheckpointManager)
     * @param {string} type - Type: 'database' or 'json'
     */
    registerCheckpointManager(name, manager, type) {
        if (!name || !manager || !type) {
            throw new Error('Invalid checkpoint manager registration: name, manager, and type are required');
        }
        
        if (type !== 'database' && type !== 'json') {
            throw new Error('Invalid checkpoint manager type: must be "database" or "json"');
        }
        
        // Calculate stagger offset based on number of registered managers
        const staggerOffset = this.checkpointManagers.size * this.staggerDelay;
        
        this.checkpointManagers.set(name, {
            manager,
            type,
            staggerOffset,
            lastCheckpoint: 0
        });
        
        console.log(`✓ Registered ${type} checkpoint manager: ${name} (stagger: ${(staggerOffset / 1000 / 60).toFixed(1)}min)`);
    }
    
    /**
     * Get a checkpoint manager by name
     * @param {string} name - Checkpoint manager name
     * @returns {Object|null} Checkpoint manager info or null
     */
    getCheckpointManager(name) {
        return this.checkpointManagers.get(name) || null;
    }
    
    /**
     * Get all checkpoint managers
     * @returns {Map} Map of all registered checkpoint managers
     */
    getAllCheckpointManagers() {
        return new Map(this.checkpointManagers);
    }
    
    /**
     * Create checkpoint for a specific manager
     * @param {string} name - Checkpoint manager name
     * @param {boolean} force - Force checkpoint even if recently created
     * @returns {boolean} Success status
     */
    async createCheckpoint(name, force = false) {
        const checkpointInfo = this.checkpointManagers.get(name);
        if (!checkpointInfo) {
            console.error(`❌ Checkpoint manager not found: ${name}`);
            return false;
        }
        
        const { manager, type } = checkpointInfo;
        const now = Date.now();
        
        // Check if checkpoint was recently created (unless forced)
        if (!force && now - checkpointInfo.lastCheckpoint < this.checkpointInterval / 2) {
            return false; // Skip if checkpoint was created recently
        }
        
        try {
            let success = false;
            if (type === 'database') {
                // For database checkpoints, only checkpoint if database is open (not idle)
                // Don't wake up idle databases just for scheduled checkpoints
                const dbWrapper = manager.dbWrapper;
                if (dbWrapper && typeof dbWrapper.isOpenState === 'function') {
                    if (!dbWrapper.isOpenState()) {
                        // Database is idle/closed - skip scheduled checkpoint
                        // It will be checkpointed when it wakes up for actual operations or before idle shutdown
                        return false;
                    }
                }

                const isDirty = dbWrapper && typeof dbWrapper.isDirtyState === 'function'
                    ? dbWrapper.isDirtyState()
                    : false;

                // Skip when no writes have occurred since the last checkpoint
                if (!force && !isDirty) {
                    return false;
                }
                
                // Use backup API for databases (more reliable)
                // Signature check confirms on-disk data actually changed
                if (manager.createCheckpointWithBackup) {
                    success = await manager.createCheckpointWithBackup(isDirty);
                } else {
                    success = manager.createCheckpoint();
                }
            } else {
                // JSON checkpoints
                success = manager.createCheckpoint({ force });
            }
            
            if (success) {
                checkpointInfo.lastCheckpoint = now;
                console.log(`✅ Created checkpoint: ${name}`);
            }
            
            return success;
        } catch (error) {
            console.error(`❌ Error creating checkpoint for ${name}:`, error);
            return false;
        }
    }
    
    /**
     * Create checkpoints for all registered managers (with staggered timing)
     * @param {boolean} force - Force checkpoint even if recently created
     */
    async createAllCheckpoints(force = false) {
        const now = Date.now();
        const promises = [];
        
        for (const [name, checkpointInfo] of this.checkpointManagers.entries()) {
            const { staggerOffset } = checkpointInfo;
            
            // Schedule checkpoint with stagger offset
            const promise = new Promise(async (resolve) => {
                setTimeout(async () => {
                    const success = await this.createCheckpoint(name, force);
                    resolve({ name, success });
                }, staggerOffset);
            });
            
            promises.push(promise);
        }
        
        // Wait for all checkpoints to complete
        const results = await Promise.all(promises);
        const successCount = results.filter(r => r.success).length;
        console.log(`📸 Created ${successCount}/${results.length} checkpoints`);
        
        return results;
    }
    
    /**
     * Start periodic checkpoint creation with staggered timing
     * @param {number} intervalMs - Interval between checkpoint cycles (default: 1 hour)
     */
    startPeriodicCheckpoints(intervalMs = null) {
        if (this.periodicCheckpointInterval) {
            console.log('⚠️ Periodic checkpoints already running');
            return;
        }
        
        if (intervalMs) {
            this.checkpointInterval = intervalMs;
        }
        
        // Schedule periodic checkpoints
        this.periodicCheckpointInterval = setInterval(() => {
            this.createAllCheckpoints(false).catch((error) => {
                console.error('❌ Error creating periodic checkpoints:', error);
            });
        }, this.checkpointInterval);
        
        console.log(`✓ Periodic checkpoints started (interval: ${(this.checkpointInterval / 1000 / 60).toFixed(1)}min)`);
    }
    
    /**
     * Stop periodic checkpoint creation
     */
    stopPeriodicCheckpoints() {
        if (this.periodicCheckpointInterval) {
            clearInterval(this.periodicCheckpointInterval);
            this.periodicCheckpointInterval = null;
            console.log('✓ Periodic checkpoints stopped');
        }
    }
    
    /**
     * Get checkpoint information for all managers
     * @returns {Object} Summary of all checkpoint managers
     */
    getCheckpointInfo() {
        const info = {
            totalManagers: this.checkpointManagers.size,
            managers: []
        };
        
        for (const [name, checkpointInfo] of this.checkpointManagers.entries()) {
            const { manager, type, staggerOffset, lastCheckpoint } = checkpointInfo;
            
            let managerInfo = null;
            if (manager.getCheckpointInfo) {
                managerInfo = manager.getCheckpointInfo();
            }
            
            info.managers.push({
                name,
                type,
                staggerOffset,
                lastCheckpoint,
                managerInfo
            });
        }
        
        return info;
    }
}

/**
 * Config Manager
 * Manages all configuration files with checkpointing, validation, and mitigation
 * 
 * @param {Object} options - Configuration options
 * @param {Object} options.configs - Map of config definitions: { configType: { name, functionName, path } }
 * @param {Object} options.globalResources - Reference to globalResources instance (for getPath, getWebSocketServer, etc)
 */
class ConfigManager {
    constructor(globalResources = null, configs = {}) {        
        if (!globalResources) {
            throw new Error('ConfigManager requires globalResources reference');
        }
        
        this.globalResources = globalResources;
        this._defaultSavePolicy = {
            saveDelayMs: 5 * 1000,          // 5 seconds (was 60s - too long for user-facing operations)
            snapshotMinAgeMs: 5 * 60 * 1000, // 5 minutes (for checkpoints)
            maxWaitMs: 30 * 1000            // 30 seconds max wait (was 15 minutes)
        };
        
        // Initialize configs structure
        this._configs = {};
        for (const [configType, configDef] of Object.entries(configs)) {
            const policy = this._getSavePolicy(configType);
            const mergePolicy = this._getMergePolicy(configType);
            this._configs[configType] = {
                name: configDef.name || configType,
                functionName: configDef.functionName || configType.charAt(0).toUpperCase() + configType.slice(1),
                path: configDef.path || null,
                cache: null,
                lastSaved: 0,
                hash: null,
                checkpointManager: null,
                validator: null,
                defaults: null,
                policy,
                mergePolicy, // How to handle concurrent saves: 'overwrite', 'merge', 'flush'
                pendingSaveTimer: null,
                pendingSaveStartTime: 0,
                pendingSaveData: null,
                pendingSaveOptions: null,
                lastWriteTime: 0
            };
        }
    }
    
    /**
     * Generate UUID v4
     * @private
     * @returns {string} UUID
     */
    _generateUUID() {
        return crypto.randomUUID();
    }
    
    /**
     * Get default config structure for a config type
     * @private
     * @param {string} configType - Config type
     * @returns {Object|null} Default config structure or null if not applicable
     */
    _getDefaultConfig(configType) {
        switch (configType) {
            case 'directorConfig':
                return {
                    version: "1.0.0",
                    description: "Director AI feedback and learning configuration",
                    feedback: {
                        description: "Collection of past generation issues and lessons learned to improve future generations",
                        entries: []
                    },
                    rules: {
                        description: "Global rules and constraints for Director AI behavior",
                        entries: []
                    }
                };
            case 'promptConfig':
                return {
                    text_replacements: {},
                    presets: {},
                    preset_group: {}
                };
            case 'secureConfig':
                return {
                    location: {
                        latitude: 0,
                        longitude: 0
                    }
                };
            case 'config':
                return {
                    port: 9220,
                    userGlobalSettings: {
                        desktop: {
                            autoLaunchWorkspace: true,
                            liveWindowRepositioning: false,
                            exitDesktopOnWorkspaceMaximise: false,
                            notificationBridgeEnabled: true,
                            bypassNotificationBridgeInDesktopMode: false,
                            startMenuButton: {
                                preset: 'start-ja',
                                customText: '',
                                style: 'workspace'
                            }
                        },
                        naxt: {
                            elevatePins: 0
                        }
                    },
                    generationQuips: {
                        autoUpdateCheckHour: 8,
                        autoUpdateCheckMinute: 0,
                        countBasedCheckIntervalHours: 4
                    },
                    autofillRanking: JSON.parse(JSON.stringify(DEFAULT_AUTOFILL_RANKING)),
                    selectedApiKeys: {
                        novelai: 0,
                        grok: 0,
                        openai: 0,
                        google: 0,
                        openweather: 0,
                        exa: 0,
                        runpod: 0
                    },
                    lruCache: {
                        weatherSize: 100,
                        locationSize: 100,
                        weatherDuration: 300000,
                        locationDuration: 300000,
                        weatherFailureDuration: 150000
                    }
                };
            case 'favorites':
                return {
                    tags: [],
                    textReplacements: []
                };
            case 'workspaces':
                return {
                    default: {
                        name: 'Default',
                        color: '#102040',
                        backgroundColor: null,
                        primaryFont: null,
                        textareaFont: null,
                        sort: 0,
                        presets: [],
                        files: [],
                        scraps: [],
                        pinned: [],
                        groups: {}
                    }
                };
            case 'workspaceDesktop':
                return {
                    default: {
                        shortcuts: []
                    },
                    windowPositions: {} // Global window positions (not per-workspace)
                };
            case 'naxGeneration':
                return {
                    galleries: {}
                };
            default:
                return null;
        }
    }

    /**
     * Get persistence policy for a config type
     * @private
     * @param {string} configType
     * @returns {Object} Policy object
     */
    _getSavePolicy(configType) {
        const policy = { ...this._defaultSavePolicy };
        if (configType === 'workspaces') {
            policy.saveDelayMs = 5 * 1000; // 5 seconds (was 10 minutes - too long for critical data)
            policy.maxWaitMs = 30 * 1000; // 30 seconds max wait
            policy.snapshotMinAgeMs = 30 * 60 * 1000; // 30 minutes (for checkpoints)
        }
        if (configType === 'workspaceDesktop') {
            policy.saveDelayMs = 10 * 1000; // 10 seconds debounce (icons + window positions)
            policy.maxWaitMs = 60 * 1000; // 60 seconds max wait
            policy.snapshotMinAgeMs = 30 * 60 * 1000; // 30 minutes (for checkpoints)
        }
        return policy;
    }
    
    /**
     * Get merge policy for concurrent saves
     * @private
     * @param {string} configType
     * @returns {string} Merge policy: 'overwrite', 'merge', or 'flush'
     */
    _getMergePolicy(configType) {
        switch (configType) {
            case 'workspaces':
                return 'flush'; // Always flush pending before new workspace save (maintains array integrity)
            case 'workspaceDesktop':
                return 'overwrite'; // Coalesce rapid icon/window updates into one debounced write
            case 'promptConfig':
                return 'overwrite'; // User edits should overwrite pending (most recent wins)
            case 'config':
                return 'overwrite'; // Settings changes should overwrite
            case 'secureConfig':
                return 'overwrite'; // Security settings should overwrite
            case 'favorites':
                return 'overwrite'; // Favorites should overwrite
            case 'directorConfig':
                return 'overwrite'; // Director feedback should overwrite
            default:
                return 'overwrite'; // Default: most recent save wins
        }
    }
    
    /**
     * Validate config structure (read-only, doesn't modify)
     * @private
     * @param {string} configType - Config type
     * @param {Object} config - Config object to validate
     * @returns {Object} { valid: boolean, errors: string[] }
     */
    _validateConfig(configType, config) {
        const defaultConfig = this._getDefaultConfig(configType);
        if (!defaultConfig) {
            return { valid: true, errors: [] }; // No validation for this type
        }
        
        const errors = [];
        
        // Check required top-level keys
        for (const [key, defaultValue] of Object.entries(defaultConfig)) {
            if (!(key in config)) {
                errors.push(`Missing required top-level key: ${key}`);
            } else if (typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue !== null) {
                // Recursively validate nested objects
                const nestedErrors = this._validateNestedStructure(key, defaultValue, config[key]);
                errors.push(...nestedErrors);
            }
        }
        
        // Config-specific validation
        switch (configType) {
            case 'directorConfig':
                if (!Array.isArray(config.feedback?.entries)) {
                    errors.push('feedback.entries must be an array');
                }
                if (!Array.isArray(config.rules?.entries)) {
                    errors.push('rules.entries must be an array');
                }
                break;
                
            case 'promptConfig':
                if (typeof config.text_replacements !== 'object' || Array.isArray(config.text_replacements) || config.text_replacements === null) {
                    errors.push('text_replacements must be an object');
                }
                if (typeof config.presets !== 'object' || Array.isArray(config.presets) || config.presets === null) {
                    errors.push('presets must be an object');
                }
                if (typeof config.preset_group !== 'object' || Array.isArray(config.preset_group) || config.preset_group === null) {
                    errors.push('preset_group must be an object');
                }
                break;
                
            case 'secureConfig':
                if (!config.location || typeof config.location !== 'object') {
                    errors.push('location must be an object');
                } else {
                    if (typeof config.location.latitude !== 'number') {
                        errors.push('location.latitude must be a number');
                    }
                    if (typeof config.location.longitude !== 'number') {
                        errors.push('location.longitude must be a number');
                    }
                }
                break;
                
            case 'config':
                if (typeof config.selectedApiKeys !== 'object' || Array.isArray(config.selectedApiKeys) || config.selectedApiKeys === null) {
                    errors.push('selectedApiKeys must be an object');
                }
                if (typeof config.lruCache !== 'object' || Array.isArray(config.lruCache) || config.lruCache === null) {
                    errors.push('lruCache must be an object');
                } else {
                    // Check required lruCache keys
                    const requiredLruCacheKeys = ['weatherSize', 'locationSize', 'weatherDuration', 'locationDuration', 'weatherFailureDuration'];
                    for (const key of requiredLruCacheKeys) {
                        if (!(key in config.lruCache)) {
                            errors.push(`lruCache.${key} is missing`);
                        }
                    }
                }
                break;
                
            case 'favorites':
                if (!Array.isArray(config.tags)) {
                    errors.push('tags must be an array');
                }
                if (!Array.isArray(config.textReplacements)) {
                    errors.push('textReplacements must be an array');
                }
                break;
                
            case 'workspaces':
                if (typeof config !== 'object' || Array.isArray(config) || config === null) {
                    errors.push('workspaces must be an object');
                } else {
                    // Ensure default workspace exists
                    if (!config.default || typeof config.default !== 'object') {
                        errors.push('workspaces must have a default workspace');
                    } else {
                        // Validate default workspace structure
                        const defaultWs = config.default;
                        const requiredFields = ['name', 'color', 'sort', 'presets', 'files', 'scraps', 'pinned', 'groups'];
                        for (const field of requiredFields) {
                            if (!(field in defaultWs)) {
                                errors.push(`default workspace missing required field: ${field}`);
                            }
                        }
                        if (!Array.isArray(defaultWs.presets)) errors.push('default.presets must be an array');
                        if (!Array.isArray(defaultWs.files)) errors.push('default.files must be an array');
                        if (!Array.isArray(defaultWs.scraps)) errors.push('default.scraps must be an array');
                        if (!Array.isArray(defaultWs.pinned)) errors.push('default.pinned must be an array');
                        if (typeof defaultWs.groups !== 'object' || Array.isArray(defaultWs.groups) || defaultWs.groups === null) {
                            errors.push('default.groups must be an object');
                        }
                    }
                }
                break;
                
            case 'workspaceDesktop':
                if (typeof config !== 'object' || Array.isArray(config) || config === null) {
                    errors.push('workspaceDesktop must be an object');
                } else {
                    // Validate each workspace entry
                    Object.entries(config).forEach(([key, value]) => {
                        // Skip windowPositions (global, validated separately)
                        if (key === 'windowPositions') {
                            return;
                        }
                        
                        // Validate workspace entries
                        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                            errors.push(`workspaceDesktop.${key} must be an object`);
                            return;
                        }
                        
                        // Validate shortcuts array
                        if (!Array.isArray(value.shortcuts)) {
                            errors.push(`workspaceDesktop.${key}.shortcuts must be an array`);
                        } else {
                            value.shortcuts.forEach((shortcut, idx) => {
                                if (!shortcut || typeof shortcut !== 'object') {
                                    errors.push(`workspaceDesktop.${key}.shortcuts[${idx}] must be an object`);
                                    return;
                                }
                                if (shortcut.folderId !== undefined && shortcut.folderId !== null && typeof shortcut.folderId !== 'string') {
                                    errors.push(`workspaceDesktop.${key}.shortcuts[${idx}].folderId must be a string or null`);
                                }
                                if (shortcut.type === 'folder') {
                                    if (!shortcut.data || typeof shortcut.data.vfsFolderId !== 'string') {
                                        errors.push(`workspaceDesktop.${key}.shortcuts[${idx}] folder type requires data.vfsFolderId`);
                                    }
                                }
                            });
                        }
                    });
                    
                    // Validate global windowPositions object (if present)
                    if (config.windowPositions !== undefined) {
                        if (typeof config.windowPositions !== 'object' || Array.isArray(config.windowPositions) || config.windowPositions === null) {
                            errors.push('workspaceDesktop.windowPositions must be an object');
                        } else {
                            // Validate each window position entry
                            Object.entries(config.windowPositions).forEach(([windowId, position]) => {
                                if (typeof position !== 'object' || position === null || Array.isArray(position)) {
                                    errors.push(`workspaceDesktop.windowPositions.${windowId} must be an object`);
                                } else {
                                    // Validate topLeft quadrant position
                                    if (!position.topLeft || typeof position.topLeft !== 'object') {
                                        errors.push(`workspaceDesktop.windowPositions.${windowId}.topLeft must be an object`);
                                    } else {
                                        if (typeof position.topLeft.index !== 'number' || position.topLeft.index < 1 || position.topLeft.index > 4) {
                                            errors.push(`workspaceDesktop.windowPositions.${windowId}.topLeft.index must be a number between 1 and 4`);
                                        }
                                        if (typeof position.topLeft.x !== 'number' || position.topLeft.x < 0 || position.topLeft.x > 1) {
                                            errors.push(`workspaceDesktop.windowPositions.${windowId}.topLeft.x must be a number between 0 and 1`);
                                        }
                                        if (typeof position.topLeft.y !== 'number' || position.topLeft.y < 0 || position.topLeft.y > 1) {
                                            errors.push(`workspaceDesktop.windowPositions.${windowId}.topLeft.y must be a number between 0 and 1`);
                                        }
                                    }
                                    
                                    // Validate bottomRight quadrant position (optional)
                                    if (position.bottomRight !== undefined) {
                                        if (typeof position.bottomRight !== 'object' || position.bottomRight === null) {
                                            errors.push(`workspaceDesktop.windowPositions.${windowId}.bottomRight must be an object`);
                                        } else {
                                            if (typeof position.bottomRight.index !== 'number' || position.bottomRight.index < 1 || position.bottomRight.index > 4) {
                                                errors.push(`workspaceDesktop.windowPositions.${windowId}.bottomRight.index must be a number between 1 and 4`);
                                            }
                                            if (typeof position.bottomRight.x !== 'number' || position.bottomRight.x < 0 || position.bottomRight.x > 1) {
                                                errors.push(`workspaceDesktop.windowPositions.${windowId}.bottomRight.x must be a number between 0 and 1`);
                                            }
                                            if (typeof position.bottomRight.y !== 'number' || position.bottomRight.y < 0 || position.bottomRight.y > 1) {
                                                errors.push(`workspaceDesktop.windowPositions.${windowId}.bottomRight.y must be a number between 0 and 1`);
                                            }
                                        }
                                    }
                                }
                            });
                        }
                    }
                }
                break;

            case 'naxGeneration':
                if (typeof config.galleries !== 'object' || Array.isArray(config.galleries) || config.galleries === null) {
                    errors.push('galleries must be an object');
                }
                break;
        }
        
        return { valid: errors.length === 0, errors };
    }
    
    /**
     * Validate nested structure recursively
     * @private
     * @param {string} path - Current path in config
     * @param {Object} defaultStruct - Default structure
     * @param {any} actualValue - Actual value in config
     * @returns {string[]} Array of error messages
     */
    _validateNestedStructure(path, defaultStruct, actualValue) {
        const errors = [];
        
        if (typeof actualValue !== 'object' || actualValue === null || Array.isArray(actualValue)) {
            errors.push(`${path} must be an object`);
            return errors;
        }
        
        for (const [key, defaultValue] of Object.entries(defaultStruct)) {
            const fullPath = `${path}.${key}`;
            if (!(key in actualValue)) {
                errors.push(`Missing required key: ${fullPath}`);
            } else if (typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue !== null) {
                // Recursively validate nested objects
                const nestedErrors = this._validateNestedStructure(fullPath, defaultValue, actualValue[key]);
                errors.push(...nestedErrors);
            }
        }
        
        return errors;
    }
    
    /**
     * Mitigate (fix) config structure issues
     * @private
     * @param {string} configType - Config type
     * @param {Object} config - Config object to fix
     * @returns {Object} { config: fixedConfig, modified: boolean }
     */
    _mitigateConfig(configType, config) {
        const defaultConfig = this._getDefaultConfig(configType);
        if (!defaultConfig) {
            return config; // No validation for this type
        }
        
        let modified = false;
        let fixedConfig = { ...config };
        
        // Merge with defaults to ensure all required top-level keys exist
        for (const [key, defaultValue] of Object.entries(defaultConfig)) {
            if (!(key in fixedConfig)) {
                fixedConfig[key] = typeof defaultValue === 'object' && !Array.isArray(defaultValue)
                    ? JSON.parse(JSON.stringify(defaultValue))
                    : defaultValue;
                modified = true;
            } else if (typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue !== null) {
                // Recursively merge nested objects
                const merged = this._mergeConfigStructures(defaultValue, fixedConfig[key]);
                if (JSON.stringify(merged) !== JSON.stringify(fixedConfig[key])) {
                    fixedConfig[key] = merged;
                    modified = true;
                }
            }
        }
        
        // Config-specific validation and structure fixing
        switch (configType) {
            case 'directorConfig':
                // Ensure feedback.entries is an array
                if (!Array.isArray(fixedConfig.feedback?.entries)) {
                    fixedConfig.feedback = fixedConfig.feedback || {};
                    fixedConfig.feedback.entries = [];
                    modified = true;
                }
                // Ensure rules.entries is an array
                if (!Array.isArray(fixedConfig.rules?.entries)) {
                    fixedConfig.rules = fixedConfig.rules || {};
                    fixedConfig.rules.entries = [];
                    modified = true;
                }
                break;
                
            case 'promptConfig':
                // Ensure text_replacements is an object
                if (typeof fixedConfig.text_replacements !== 'object' || Array.isArray(fixedConfig.text_replacements) || fixedConfig.text_replacements === null) {
                    fixedConfig.text_replacements = {};
                    modified = true;
                }
                // Ensure presets is an object
                if (typeof fixedConfig.presets !== 'object' || Array.isArray(fixedConfig.presets) || fixedConfig.presets === null) {
                    fixedConfig.presets = {};
                    modified = true;
                }
                // Ensure all presets have UUIDs
                if (fixedConfig.presets && typeof fixedConfig.presets === 'object') {
                    for (const [presetName, preset] of Object.entries(fixedConfig.presets)) {
                        if (preset && typeof preset === 'object' && !preset.uuid) {
                            preset.uuid = this._generateUUID();
                            modified = true;
                        }
                    }
                }
                // Ensure preset_group is an object
                if (typeof fixedConfig.preset_group !== 'object' || Array.isArray(fixedConfig.preset_group) || fixedConfig.preset_group === null) {
                    fixedConfig.preset_group = {};
                    modified = true;
                }
                // Ensure all preset groups have UUIDs
                if (fixedConfig.preset_group && typeof fixedConfig.preset_group === 'object') {
                    for (const [groupName, group] of Object.entries(fixedConfig.preset_group)) {
                        if (group && typeof group === 'object' && !group.uuid) {
                            group.uuid = this._generateUUID();
                            modified = true;
                        }
                    }
                }
                break;
                
            case 'secureConfig':
                // Ensure location exists and has latitude/longitude
                if (!fixedConfig.location || typeof fixedConfig.location !== 'object') {
                    fixedConfig.location = { latitude: 0, longitude: 0 };
                    modified = true;
                } else {
                    if (typeof fixedConfig.location.latitude !== 'number') {
                        fixedConfig.location.latitude = 0;
                        modified = true;
                    }
                    if (typeof fixedConfig.location.longitude !== 'number') {
                        fixedConfig.location.longitude = 0;
                        modified = true;
                    }
                }
                break;
                
            case 'config':
                // Ensure selectedApiKeys is an object
                if (typeof fixedConfig.selectedApiKeys !== 'object' || Array.isArray(fixedConfig.selectedApiKeys) || fixedConfig.selectedApiKeys === null) {
                    fixedConfig.selectedApiKeys = defaultConfig.selectedApiKeys;
                    modified = true;
                }
                // Ensure lruCache is an object with required keys
                if (typeof fixedConfig.lruCache !== 'object' || Array.isArray(fixedConfig.lruCache) || fixedConfig.lruCache === null) {
                    fixedConfig.lruCache = defaultConfig.lruCache;
                    modified = true;
                } else {
                    // Ensure all lruCache keys exist
                    for (const [key, defaultValue] of Object.entries(defaultConfig.lruCache)) {
                        if (!(key in fixedConfig.lruCache)) {
                            fixedConfig.lruCache[key] = defaultValue;
                            modified = true;
                        }
                    }
                }
                break;
                
            case 'workspaces':
                // Default workspace colors for random assignment
                const DEFAULT_WORKSPACE_COLORS = [
                    '#102040', // Default blue
                    '#614', // Purple
                    '#469', // Blue
                    '#c63', // Orange
                    '#266', // Dark blue
                    '#28a745', // Green
                    '#dc3545', // Red
                    '#ffc107', // Yellow
                    '#17a2b8', // Cyan
                    '#6f42c1'  // Indigo
                ];
                
                // Ensure workspaces is an object
                if (typeof fixedConfig !== 'object' || Array.isArray(fixedConfig) || fixedConfig === null) {
                    fixedConfig = JSON.parse(JSON.stringify(defaultConfig));
                    modified = true;
                } else {
                    // Ensure default workspace exists
                    if (!fixedConfig.default || typeof fixedConfig.default !== 'object') {
                        fixedConfig.default = JSON.parse(JSON.stringify(defaultConfig.default));
                        modified = true;
                    }
                    
                    // Process all workspaces (including default)
                    const workspaceEntries = Object.entries(fixedConfig);
                    workspaceEntries.forEach(([workspaceId, workspace], index) => {
                        if (typeof workspace !== 'object' || workspace === null || Array.isArray(workspace)) {
                            // Invalid workspace, skip it (or could remove it)
                            return;
                        }
                        
                        const defaultWs = defaultConfig.default;
                        
                        // Ensure name exists (use 'Default' for default workspace, otherwise use workspaceId as fallback)
                        if (typeof workspace.name !== 'string' || !workspace.name.trim()) {
                            workspace.name = workspaceId === 'default' ? defaultWs.name : workspaceId;
                            modified = true;
                        }
                        
                        // Ensure color exists - use default color for 'default' workspace, random for others
                        if (!workspace.color || typeof workspace.color !== 'string') {
                            if (workspaceId === 'default') {
                                workspace.color = defaultWs.color;
                            } else {
                                // Use a deterministic color based on index to avoid randomness
                                workspace.color = DEFAULT_WORKSPACE_COLORS[index % DEFAULT_WORKSPACE_COLORS.length];
                            }
                            modified = true;
                        }
                        
                        // Ensure sort exists - use index if missing
                        if (typeof workspace.sort !== 'number') {
                            workspace.sort = index;
                            modified = true;
                        }
                        
                        if (!Array.isArray(workspace.presets)) {
                            workspace.presets = [];
                            modified = true;
                        }
                        if (!Array.isArray(workspace.files)) {
                            workspace.files = [];
                            modified = true;
                        }
                        // Remove cacheFiles and vibeImages if they exist (old system, now database-only)
                        if (workspace.cacheFiles !== undefined) {
                            delete workspace.cacheFiles;
                            modified = true;
                        }
                        if (workspace.vibeImages !== undefined) {
                            delete workspace.vibeImages;
                            modified = true;
                        }
                        if (!Array.isArray(workspace.scraps)) {
                            workspace.scraps = [];
                            modified = true;
                        }
                        if (!Array.isArray(workspace.pinned)) {
                            workspace.pinned = [];
                            modified = true;
                        }
                        
                        // Ensure groups is an object
                        if (typeof workspace.groups !== 'object' || Array.isArray(workspace.groups) || workspace.groups === null) {
                            workspace.groups = {};
                            modified = true;
                        }
                        
                        // Ensure optional fields exist (can be null)
                        if (!('backgroundColor' in workspace)) {
                            workspace.backgroundColor = null;
                            modified = true;
                        }
                        if (!('primaryFont' in workspace)) {
                            workspace.primaryFont = null;
                            modified = true;
                        }
                        if (!('textareaFont' in workspace)) {
                            workspace.textareaFont = null;
                            modified = true;
                        }
                    });
                }
                break;
                
            case 'workspaceDesktop':
                // Ensure workspaceDesktop is an object
                if (typeof fixedConfig !== 'object' || Array.isArray(fixedConfig) || fixedConfig === null) {
                    fixedConfig = JSON.parse(JSON.stringify(defaultConfig));
                    modified = true;
                } else {
                    // Ensure default workspace exists
                    if (!fixedConfig.default || typeof fixedConfig.default !== 'object') {
                        fixedConfig.default = JSON.parse(JSON.stringify(defaultConfig.default));
                        modified = true;
                    }
                    
                    // Process all workspace entries (delete old windowPositions arrays, handled separately)
                    Object.entries(fixedConfig).forEach(([key, value]) => {
                        // Delete old windowPositions arrays from workspace entries (now global, not per-workspace)
                        if (key === 'windowPositions') {
                            // If windowPositions is in a workspace entry (old format), delete it
                            // The global windowPositions is handled separately below
                            delete fixedConfig[key];
                            modified = true;
                            return;
                        }
                        
                        if (typeof value !== 'object' || value === null || Array.isArray(value)) {
                            // Invalid workspace, replace with default structure
                            fixedConfig[key] = { shortcuts: [] };
                            modified = true;
                            return;
                        }
                        
                        // Delete any windowPositions arrays from within workspace entries (old per-workspace format)
                        if (value.windowPositions !== undefined) {
                            delete value.windowPositions;
                            modified = true;
                        }
                        
                        // Ensure shortcuts array exists
                        if (!Array.isArray(value.shortcuts)) {
                            value.shortcuts = [];
                            modified = true;
                        } else {
                            value.shortcuts.forEach((shortcut) => {
                                if (!shortcut || typeof shortcut !== 'object') return;
                                if (shortcut.folderId === undefined) {
                                    shortcut.folderId = null;
                                    modified = true;
                                }
                                if (shortcut.type === 'folder' && (!shortcut.data || typeof shortcut.data.vfsFolderId !== 'string')) {
                                    shortcut.data = { ...(shortcut.data || {}), vfsFolderId: shortcut.data?.vfsFolderId || null };
                                }
                            });
                        }
                    });
                    
                    // Ensure global windowPositions object exists (at root level, not per-workspace)
                    if (fixedConfig.windowPositions === undefined) {
                        fixedConfig.windowPositions = {};
                        modified = true;
                    } else if (typeof fixedConfig.windowPositions !== 'object' || Array.isArray(fixedConfig.windowPositions) || fixedConfig.windowPositions === null) {
                        fixedConfig.windowPositions = {};
                        modified = true;
                    } else {
                        // Clean up invalid window position entries
                        Object.entries(fixedConfig.windowPositions).forEach(([windowId, position]) => {
                            if (typeof position !== 'object' || position === null || Array.isArray(position)) {
                                delete fixedConfig.windowPositions[windowId];
                                modified = true;
                            } else {
                                // Validate and clean up topLeft
                                if (!position.topLeft || typeof position.topLeft !== 'object') {
                                    delete fixedConfig.windowPositions[windowId];
                                    modified = true;
                                } else {
                                    // Clean up invalid topLeft properties
                                    if (typeof position.topLeft.index !== 'number' || position.topLeft.index < 1 || position.topLeft.index > 4) {
                                        delete fixedConfig.windowPositions[windowId];
                                        modified = true;
                                    } else if (typeof position.topLeft.x !== 'number' || position.topLeft.x < 0 || position.topLeft.x > 1) {
                                        position.topLeft.x = Math.max(0, Math.min(1, position.topLeft.x || 0));
                                        modified = true;
                                    } else if (typeof position.topLeft.y !== 'number' || position.topLeft.y < 0 || position.topLeft.y > 1) {
                                        position.topLeft.y = Math.max(0, Math.min(1, position.topLeft.y || 0));
                                        modified = true;
                                    }
                                }
                                
                                // Validate and clean up bottomRight (optional)
                                if (position.bottomRight !== undefined) {
                                    if (typeof position.bottomRight !== 'object' || position.bottomRight === null) {
                                        delete position.bottomRight;
                                        modified = true;
                                    } else {
                                        if (typeof position.bottomRight.index !== 'number' || position.bottomRight.index < 1 || position.bottomRight.index > 4) {
                                            delete position.bottomRight;
                                            modified = true;
                                        } else if (typeof position.bottomRight.x !== 'number' || position.bottomRight.x < 0 || position.bottomRight.x > 1) {
                                            position.bottomRight.x = Math.max(0, Math.min(1, position.bottomRight.x || 0));
                                            modified = true;
                                        } else if (typeof position.bottomRight.y !== 'number' || position.bottomRight.y < 0 || position.bottomRight.y > 1) {
                                            position.bottomRight.y = Math.max(0, Math.min(1, position.bottomRight.y || 0));
                                            modified = true;
                                        }
                                    }
                                }
                            }
                        });
                    }
                }
                break;
        }
        
        return { config: fixedConfig, modified };
    }
    
    /**
     * Merge two config structures recursively
     * @private
     * @param {Object} defaultStruct - Default structure
     * @param {Object} existingStruct - Existing structure
     * @returns {Object} Merged structure
     */
    _mergeConfigStructures(defaultStruct, existingStruct) {
        if (typeof defaultStruct !== 'object' || defaultStruct === null || Array.isArray(defaultStruct)) {
            return existingStruct !== undefined ? existingStruct : defaultStruct;
        }
        
        if (typeof existingStruct !== 'object' || existingStruct === null || Array.isArray(existingStruct)) {
            return JSON.parse(JSON.stringify(defaultStruct));
        }
        
        const merged = { ...existingStruct };
        for (const [key, defaultValue] of Object.entries(defaultStruct)) {
            if (!(key in merged)) {
                merged[key] = typeof defaultValue === 'object' && !Array.isArray(defaultValue)
                    ? JSON.parse(JSON.stringify(defaultValue))
                    : defaultValue;
            } else if (typeof defaultValue === 'object' && !Array.isArray(defaultValue) && defaultValue !== null) {
                merged[key] = this._mergeConfigStructures(defaultValue, merged[key]);
            }
        }
        
        return merged;
    }
    
    /**
     * Get reactive config (auto-reloads if file changed)
     * @param {string} configType - Config type
     * @param {string|string[]} [keyPath] - Optional path to get sub-value
     * @param {boolean} [clone] - Whether to clone the result
     * @returns {Object} Config object or sub-value
     */
    _getReactiveConfig(configType, keyPath = null, clone = false) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }
        
        // Check if file was modified
        if (fs.existsSync(configInfo.path)) {
            const stats = fs.statSync(configInfo.path);
            const lastModified = stats.mtime.getTime();
            
            // Reload if file changed or not cached
            if (!configInfo.lastSaved || lastModified > configInfo.lastSaved) {
                try {
                    const configData = fs.readFileSync(configInfo.path, 'utf8');
                    const config = JSON.parse(configData);
                    
                    // Store in cache
                    configInfo.cache = config;
                    configInfo.lastSaved = lastModified;
                } catch (error) {
                    console.error(`❌ Error loading ${configType}:`, error.message);
                    // Return cached version if available
                    if (configInfo.cache) {
                        if (keyPath) {
                            const value = this._getValueByPath(configInfo.cache, keyPath);
                            return clone && value ? JSON.parse(JSON.stringify(value)) : value;
                        }
                        return clone ? JSON.parse(JSON.stringify(configInfo.cache)) : configInfo.cache;
                    }
                    throw error;
                }
            }
        }
        
        // Return cached config (or load if not cached)
        if (!configInfo.cache) {
            this.refreshConfig(configType);
        }
        
        // Return sub-value if keyPath provided
        if (keyPath) {
            const value = this._getValueByPath(configInfo.cache, keyPath);
            return clone && value ? JSON.parse(JSON.stringify(value)) : value;
        }
        
        return clone ? JSON.parse(JSON.stringify(configInfo.cache)) : configInfo.cache;
    }

    /**
     * Schedule a debounced save for the given config
     * @private
     */
    _queueDebouncedSave(configType, configData, options = {}) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }
        const policy = configInfo.policy || this._defaultSavePolicy;
        if (!policy || policy.saveDelayMs <= 0) {
            return this._writeConfigToDisk(configType, configData, options);
        }

        const now = Date.now();
        if (!configInfo.pendingSaveStartTime) {
            configInfo.pendingSaveStartTime = now;
        }

        // Handle concurrent saves based on merge policy
        if (configInfo.pendingSaveData) {
            const mergePolicy = configInfo.mergePolicy || 'overwrite';
            
            switch (mergePolicy) {
                case 'flush':
                    // Flush existing pending save before accepting new data
                    this._executePendingSave(configType);
                    configInfo.pendingSaveStartTime = now;
                    break;
                    
                case 'overwrite':
                    // Just overwrite - most recent save wins
                    // No action needed, will replace below
                    break;
                    
                case 'merge':
                    // Deep merge pending data with new data
                    configData = this._deepMerge(configInfo.pendingSaveData, configData);
                    break;
            }
        }

        const elapsed = now - configInfo.pendingSaveStartTime;
        if (policy.maxWaitMs > 0 && elapsed >= policy.maxWaitMs) {
            this._executePendingSave(configType);
            configInfo.pendingSaveStartTime = now;
        }

        configInfo.pendingSaveData = configData;
        configInfo.pendingSaveOptions = { ...options };

        const elapsedAfterFlush = Date.now() - configInfo.pendingSaveStartTime;
        if (policy.maxWaitMs > 0 && elapsedAfterFlush >= policy.maxWaitMs) {
            this._executePendingSave(configType);
            return true;
        }

        const delay = policy.saveDelayMs;
        const remainingMax = policy.maxWaitMs > 0 ? Math.max(0, policy.maxWaitMs - elapsedAfterFlush) : delay;
        const effectiveDelay = Math.max(0, Math.min(delay, remainingMax));

        this._clearPendingSaveTimer(configInfo);
        configInfo.pendingSaveTimer = setTimeout(() => {
            this._executePendingSave(configType);
        }, effectiveDelay);
        return true;
    }

    /**
     * Execute pending save immediately
     * @private
     */
    _executePendingSave(configType) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            return;
        }
        const data = configInfo.pendingSaveData;
        const options = configInfo.pendingSaveOptions || {};
        this._resetPendingSaveState(configInfo);
        if (!data) {
            return;
        }
        try {
            this._writeConfigToDisk(configType, data, options);
            console.log(`✓ Successfully saved ${configType}`);
        } catch (error) {
            console.error(`❌ Error saving ${configType} during debounced flush:`, error);
        }
    }

    /**
     * Clear pending timer and data
     * @private
     */
    _resetPendingSaveState(configInfo) {
        this._clearPendingSaveTimer(configInfo);
        configInfo.pendingSaveStartTime = 0;
        configInfo.pendingSaveData = null;
        configInfo.pendingSaveOptions = null;
    }

    /**
     * Clear timer helper
     * @private
     */
    _clearPendingSaveTimer(configInfo) {
        if (configInfo.pendingSaveTimer) {
            clearTimeout(configInfo.pendingSaveTimer);
            configInfo.pendingSaveTimer = null;
        }
    }

    /**
     * Persist config to disk immediately
     * @private
     */
    _writeConfigToDisk(configType, configData, options = {}) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }

        const { skipCheckpoint = false } = options;
        try {
            configInfo.checkpointManager.saveWithCheckpoint(configData, {
                createCheckpoint: !skipCheckpoint,
                validateData: true,
                skipCheckpointIfInvalid: false
            });

            // Update cache metadata from disk to ensure timestamps stay accurate
            configInfo.cache = configData;
            if (fs.existsSync(configInfo.path)) {
                const stats = fs.statSync(configInfo.path);
                configInfo.lastSaved = stats.mtime.getTime();
                configInfo.lastWriteTime = configInfo.lastSaved;
            } else {
                // File might not exist yet if checkpoint manager hasn't written it
                // This shouldn't happen, but handle it gracefully
                console.warn(`⚠️ Config file ${configInfo.path} does not exist after save`);
                configInfo.lastSaved = Date.now();
                configInfo.lastWriteTime = configInfo.lastSaved;
            }
            if (configInfo.checkpointManager) {
                configInfo.lastCheckpointTime = configInfo.checkpointManager.lastCheckpointTime || configInfo.lastCheckpointTime;
            }

            if (configType === 'workspaceDesktop') {
                this._broadcastWorkspaceDesktopPersisted();
            }

            if (configType === 'workspaces') {
                this._scheduleWorkspaceCssRecompile();
            }

            return true;
        } catch (error) {
            console.error(`❌ Error writing ${configType} to disk:`, error);
            throw error;
        }
    }

    /**
     * Notify clients that workspace desktop config was written to disk
     * @private
     */
    _broadcastWorkspaceDesktopPersisted() {
        try {
            const wsServer = this.globalResources?.getWebSocketServer?.();
            if (!wsServer || typeof wsServer.broadcast !== 'function') {
                return;
            }

            wsServer.broadcast({
                type: 'workspace_desktop_persisted',
                data: {},
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.warn('⚠️ Failed to broadcast workspace desktop persisted event:', error.message);
        }
    }

    /**
     * Recompile server-generated workspace theme CSS after workspaces config is saved.
     * modules/workspaceCssService.js
     * @private
     */
    _scheduleWorkspaceCssRecompile() {
        try {
            const workspaceCssService = require('./workspaceCssService');
            const runtimeAssetCompiler = require('./runtimeAssetCompiler');
            const gr = this.globalResources;

            if (!workspaceCssService.isInitialized() && gr && typeof gr.getPath === 'function') {
                workspaceCssService.ensureInitialized({
                    projectRoot: gr.getPath('root'),
                    getWorkspacesConfig: () => gr.getWorkspacesConfig(),
                    compileCssSource: (source, rel, hash, opts) => runtimeAssetCompiler.compileCss(source, rel, hash, opts),
                    hashSource: runtimeAssetCompiler.hashSource,
                    buildHeader: runtimeAssetCompiler.buildHeader,
                    atomicWrite: runtimeAssetCompiler.atomicWrite
                });
            }

            if (!workspaceCssService.isInitialized()) {
                return;
            }

            workspaceCssService.scheduleRecompile();
        } catch (error) {
            console.warn('⚠️ Failed to schedule workspace CSS recompile:', error.message);
        }
    }

    /**
     * Public trigger for workspace theme CSS recompile.
     * Used by user-initiated visual changes (color/wallpaper/fonts) so the theme
     * refreshes immediately instead of waiting for the debounced workspaces disk write.
     * modules/workspaceCssService.js
     */
    scheduleWorkspaceCssRecompile() {
        this._scheduleWorkspaceCssRecompile();
    }
    
    /**
     * Initialize all config structures with paths, defaults, validators, and checkpoint managers
     * Checkpoint managers can exist without the file - they can have checkpoints in storage
     */
    initializeCheckpointManagers() {
        for (const [configType, configInfo] of Object.entries(this._configs)) {
            // Set path if not already set
            if (!configInfo.path) {
                configInfo.path = this.globalResources.getPath(configType);
            }
            
            // Set defaults
            configInfo.defaults = this._getDefaultConfig(configType);
            
            // Create validator function
            configInfo.validator = (data) => {
                const validationResult = this._validateConfig(configType, data);
                return validationResult.valid ? true : { valid: false, error: validationResult.errors.join('; ') };
            };
            
            // Create checkpoint manager directly
            configInfo.checkpointManager = new JSONCheckpointManager(
                this.globalResources,
                configType,
                configInfo.path,
                4,
                configInfo.validator,
                {
                    minCheckpointAgeMs: configInfo.policy?.snapshotMinAgeMs ?? this._defaultSavePolicy.snapshotMinAgeMs
                }
            );
            configInfo.lastCheckpointTime = configInfo.checkpointManager.lastCheckpointTime || 0;
        }
    }
    
    /**
     * Initialize config with mitigation (startup only)
     * Checkpoint managers are already initialized and available
     * Checks for valid checkpoints before mitigation to prevent data loss
     * @param {string} configType - 'config', 'secureConfig', 'promptConfig', 'directorConfig', or 'favorites'
     */
    initializeConfigWithMitigation(configType) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }
        
        const checkpointManager = configInfo.checkpointManager;
        let config = {};
        let wasCreated = false;
        let hadCorruption = false;
        let restoredFromCheckpoint = false;
        
        // Step 1: Load config (or create blank if missing)
        if (fs.existsSync(configInfo.path)) {
            try {
                const parsed = JSON.parse(fs.readFileSync(configInfo.path, 'utf8'));
                config = parsed || {};
            } catch (parseError) {
                // Invalid JSON - try to restore from checkpoint
                console.error(`❌ Error parsing ${configType}: Invalid JSON. Checking for valid checkpoint...`);
                hadCorruption = true;
                
                // Try to restore from a valid checkpoint, saving the corrupted file as a branch
                const validCheckpoint = checkpointManager.getLatestValidCheckpoint();
                if (validCheckpoint) {
                    try {
                        // restoreFromCheckpoint will save the corrupted file as branch before restoring
                        checkpointManager.restoreFromCheckpoint(validCheckpoint.filename, {
                            saveCurrentAsBranch: true, // Save corrupted file as branch before restoring
                            skipSavingCurrent: false
                        });
                        
                        // Load the restored config
                        const restored = JSON.parse(fs.readFileSync(configInfo.path, 'utf8'));
                        config = restored || {};
                        restoredFromCheckpoint = true;
                        console.log(`✓ Restored ${configType} from valid checkpoint: ${validCheckpoint.filename}`);
                    } catch (restoreError) {
                        console.error(`    ❌ Failed to restore from checkpoint: ${restoreError.message}`);
                        config = {}; // Fall back to blank
                    }
                } else {
                    console.warn(`    ⚠️ No valid checkpoint found, will use default structure`);
                    config = {}; // No valid checkpoint, use blank
                }
            }
        } else {
            // File doesn't exist - check for existing checkpoint before using blank
            wasCreated = true;
            
            const validCheckpoint = checkpointManager.getLatestValidCheckpoint();
            if (validCheckpoint) {
                try {
                    // Restore from checkpoint (no current file to save as branch)
                    checkpointManager.restoreFromCheckpoint(validCheckpoint.filename, {
                        saveCurrentAsBranch: false, // No current file to save
                        skipSavingCurrent: true
                    });
                    
                    // Load the restored config
                    const restored = JSON.parse(fs.readFileSync(configInfo.path, 'utf8'));
                    config = restored || {};
                    restoredFromCheckpoint = true;
                    wasCreated = false; // File now exists
                    console.log(`✓ Restored ${configType} from valid checkpoint: ${validCheckpoint.filename}`);
                } catch (restoreError) {
                    console.error(`    ❌ Failed to restore from checkpoint: ${restoreError.message}`);
                    config = {}; // Fall back to blank
                }
            } else {
                config = {}; // No valid checkpoint, use blank
            }
        }
        
        // Step 2: Validate config
        const validationResult = this._validateConfig(configType, config);
        
        // Step 4: Mitigate (fix) issues if validation failed or file was created/corrupted (and not restored from checkpoint)
        let wasModified = false;
        if (!restoredFromCheckpoint && (wasCreated || hadCorruption || !validationResult.valid)) {
            // The checkpoint manager will handle saving branches when we save the fixed config
            // No need to manually save branches here - saveConfig will handle checkpointing
            const mitigationResult = this._mitigateConfig(configType, config);
            config = mitigationResult.config;
            wasModified = mitigationResult.modified || wasCreated || hadCorruption;
        }
        
        // Step 5: Save with checkpointing if modified
        if (wasModified) {
            try {
                // Ensure directory exists
                const dir = path.dirname(configInfo.path);
                if (!fs.existsSync(dir)) {
                    fs.mkdirSync(dir, { recursive: true });
                }
                
                // Checkpoint manager is already initialized and available
                checkpointManager.saveWithCheckpoint(config, {
                    createCheckpoint: true,
                    validateData: true,
                    skipCheckpointIfInvalid: false
                });
                
                if (wasCreated) {
                    console.log(`✓ Created ${configType} with default structure`);
                } else if (hadCorruption) {
                    console.log(`✓ Recovered ${configType} from corruption with default structure`);
                } else {
                    console.log(`✓ Fixed and updated ${configType} structure`);
                }
            } catch (error) {
                console.error(`❌ Error saving ${configType}:`, error.message);
                throw error;
            }
        }
        
        // Step 6: Update cache
        const stats = fs.existsSync(configInfo.path) ? fs.statSync(configInfo.path) : { mtime: { getTime: () => Date.now() } };
        configInfo.cache = config;
        configInfo.lastSaved = stats.mtime.getTime();
    }
    
    /**
     * Refresh a specific config from disk (with mitigation if validation fails)
     * On error, logs and sends toast notification but doesn't throw - existing cached config remains in memory
     * If validation fails, applies mitigation and saves the fixed config
     * @param {string} configType - 'config', 'secureConfig', 'promptConfig', 'directorConfig', 'favorites', or 'workspaces'
     * @param {Object} options - Options for refreshing config
     * @param {boolean} options.skipCheckpoint - If true, skip creating a checkpoint (default: false)
     * @returns {boolean} Success status
     */
    refreshConfig(configType = 'config') {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            this._refreshError(configType, `Unknown config type: ${configType}`);
            return false;
        }
        
        try {
            let config = {};
            
            // Check if file exists
            if (!fs.existsSync(configInfo.path)) {
                this._refreshError(configType, `Configuration ${configType} file missing: ${configInfo.path}`);
                return false;
            }
            
            // Read and parse JSON
            try {
                const parsed = JSON.parse(fs.readFileSync(configInfo.path, 'utf8'));
                config = parsed || {};
            } catch (parseError) {
                this._refreshError(configType, `Invalid ${configType} configuration: ${parseError.message}`);
                return false;
            }
            
            // Validate config structure (read-only, doesn't modify)
            const validationResult = this._validateConfig(configType, config);
            if (!validationResult.valid) {
                this._refreshError(configType, `${configType} failed validation: ${validationResult.errors.join(', ')}`);
                return false;
            }
            
            // Config is valid - update cache and return
            const stats = fs.statSync(configInfo.path);
            configInfo.cache = config;
            configInfo.lastSaved = stats.mtime.getTime();
            return true;
        } catch (error) {
            this._refreshError(configType, `Unexpected error refreshing ${configType}: ${error.message}`);
            return false;
        }
    }
    
    /**
     * Send toast notification for config refresh errors
     * @private
     * @param {string} configType - Config type
     * @param {string} errorMessage - Error message
     */
    _refreshError(configType, errorMessage) {
        console.error(`❌ Config refresh error: ${errorMessage}`);
        try {
            const wsServer = this.globalResources.getWebSocketServer();
            if (wsServer) {
                // Broadcast toast notification to all clients
                wsServer.broadcast({
                    type: 'config_refresh_error',
                    data: {
                        configType: configType,
                        message: `Failed to refresh ${configType}: ${errorMessage}`,
                        error: errorMessage,
                        timestamp: Date.now()
                    },
                    timestamp: new Date().toISOString()
                });
            }
        } catch (error) {
            // Silently fail if WebSocket is not available
            console.warn('⚠️ Could not send config refresh error toast:', error.message);
        }
    }
    
    /**
     * Refresh all configs from disk
     */
    refreshAllConfigs() {
        const results = {};
        for (const configType of Object.keys(this._configs)) {
            results[configType] = this.refreshConfig(configType);
        }
        return results;
    }
    
    /**
     * Save config to disk
     * @param {string} configType - 'config', 'secureConfig', 'promptConfig', 'directorConfig', or 'favorites'
     * @param {Object} configData - Config object to save (optional, uses cached if not provided)
     * @param {Object} options - Save options
     * @param {boolean} options.skipCheckpoint - If true, skip creating a checkpoint (default: false)
     * @param {boolean} options.force - If true, bypass debounce and save immediately
     * @param {boolean} options.flush - Alias for force (bypass debounce)
     */
    saveConfig(configType = 'config', configData = null, options = {}) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }

        // Use provided data or cached data
        const configToSave = configData || configInfo.cache;
        
        if (!configToSave) {
            throw new Error(`No config data to save for ${configType}`);
        }
        
        const normalizedOptions = { ...options };
        const policy = configInfo.policy || this._defaultSavePolicy;
        const bypassDebounce = normalizedOptions.force === true ||
            normalizedOptions.immediate === true ||
            normalizedOptions.flush === true ||
            normalizedOptions.skipDebounce === true ||
            !policy ||
            policy.saveDelayMs <= 0;

        delete normalizedOptions.force;
        delete normalizedOptions.immediate;
        delete normalizedOptions.flush;
        delete normalizedOptions.skipDebounce;

        // Update cache immediately so callers get the freshest data
        configInfo.cache = configToSave;

        try {
            if (bypassDebounce) {
                this._resetPendingSaveState(configInfo);
                return this._writeConfigToDisk(configType, configToSave, normalizedOptions);
            }

            this._queueDebouncedSave(configType, configToSave, normalizedOptions);
            return true;
        } catch (error) {
            console.error(`❌ Error saving ${configType}:`, error);
            throw error;
        }
    }
    
    /**
     * Update a specific value in config by key path (without cloning entire config)
     * @param {string} configType - Config type
     * @param {string|string[]} keyPath - Dot-separated path (e.g., 'selectedApiKeys.novelai') or array of keys
     * @param {*} value - Value to set
     * @param {Object} options - Save options
     * @returns {boolean} Success status
     * 
     * @example
     * // Update nested value
     * configManager.updateConfigValue('config', 'selectedApiKeys.novelai', 2);
     * 
     * // Update array element
     * configManager.updateConfigValue('config', ['lruCache', 'weatherSize'], 200);
     */
    updateConfigValue(configType, keyPath, value, options = {}) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }
        
        // Get current config
        const config = this._getReactiveConfig(configType);
        
        // Clone and update
        const updatedConfig = JSON.parse(JSON.stringify(config));
        this._setValueByPath(updatedConfig, keyPath, value);
        
        // Save
        return this.saveConfig(configType, updatedConfig, options);
    }
    
    /**
     * Add item to an array in config
     * @param {string} configType - Config type
     * @param {string|string[]} keyPath - Path to array
     * @param {*} item - Item to add
     * @param {Object} options - Save options
     * @returns {boolean} Success status
     * 
     * @example
     * // Add tag to favorites
     * configManager.addToConfigArray('favorites', 'tags', { id: 'tag1', name: 'nature' });
     */
    addToConfigArray(configType, keyPath, item, options = {}) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }
        
        const config = this._getReactiveConfig(configType);
        const updatedConfig = JSON.parse(JSON.stringify(config));
        
        const array = this._getValueByPath(updatedConfig, keyPath);
        if (!Array.isArray(array)) {
            throw new Error(`Path ${keyPath} does not point to an array`);
        }
        
        array.push(item);
        
        return this.saveConfig(configType, updatedConfig, options);
    }
    
    /**
     * Remove item(s) from an array in config
     * @param {string} configType - Config type
     * @param {string|string[]} keyPath - Path to array
     * @param {Function|*} predicateOrValue - Predicate function or value to match
     * @param {Object} options - Save options
     * @returns {boolean} Success status
     * 
     * @example
     * // Remove by predicate
     * configManager.removeFromConfigArray('favorites', 'tags', tag => tag.id === 'tag1');
     * 
     * // Remove by value
     * configManager.removeFromConfigArray('favorites', 'tags', 'tag1');
     */
    removeFromConfigArray(configType, keyPath, predicateOrValue, options = {}) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }
        
        const config = this._getReactiveConfig(configType);
        const updatedConfig = JSON.parse(JSON.stringify(config));
        
        const array = this._getValueByPath(updatedConfig, keyPath);
        if (!Array.isArray(array)) {
            throw new Error(`Path ${keyPath} does not point to an array`);
        }
        
        // Determine if predicate or value
        const predicate = typeof predicateOrValue === 'function'
            ? predicateOrValue
            : (item) => item === predicateOrValue;
        
        // Filter array
        const newArray = array.filter(item => !predicate(item));
        this._setValueByPath(updatedConfig, keyPath, newArray);
        
        return this.saveConfig(configType, updatedConfig, options);
    }
    
    /**
     * Modify config using a callback function OR return fluent API
     * @param {string} configType - Config type
     * @param {Function} [modifierFn] - Optional function that modifies config
     * @param {Object} [options] - Save options
     * @returns {boolean|ConfigModifier} Success status or ConfigModifier for fluent API
     * 
     * @example
     * // Callback style (complex modifications)
     * modifyConfig('promptConfig', (config) => {
     *   config.presets['myPreset'].prompt = 'new prompt';
     *   return config;
     * });
     * 
     * // Fluent API style (cleaner for simple operations)
     * modifyConfig('promptConfig').delete('preset_group.myGroup');
     * modifyConfig('promptConfig').merge('presets.myPreset', { steps: 28 });
     * modifyConfig('favorites').append('tags', newTag);
     */
    modifyConfig(configType, modifierFn, options = {}) {
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }
        
        // If no modifierFn provided, return fluent API
        if (modifierFn === undefined) {
            return new ConfigModifier(this, configType, options);
        }
        
        if (typeof modifierFn !== 'function') {
            throw new Error('modifierFn must be a function');
        }
        
        const config = this._getReactiveConfig(configType);
        const clonedConfig = JSON.parse(JSON.stringify(config));
        const modifiedConfig = modifierFn(clonedConfig);
        
        if (!modifiedConfig || typeof modifiedConfig !== 'object') {
            throw new Error('modifierFn must return the modified config object');
        }
        
        return this.saveConfig(configType, modifiedConfig, options);
    }
    
    /**
     * Get value from object by key path
     * @private
     */
    _getValueByPath(obj, keyPath) {
        const keys = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
        let current = obj;
        
        for (const key of keys) {
            if (current === null || current === undefined) {
                return undefined;
            }
            current = current[key];
        }
        
        return current;
    }
    
    /**
     * Set value in object by key path
     * @private
     */
    _setValueByPath(obj, keyPath, value) {
        const keys = Array.isArray(keyPath) ? keyPath : keyPath.split('.');
        let current = obj;
        
        for (let i = 0; i < keys.length - 1; i++) {
            const key = keys[i];
            if (!(key in current) || typeof current[key] !== 'object') {
                current[key] = {};
            }
            current = current[key];
        }
        
        current[keys[keys.length - 1]] = value;
    }
    
    /**
     * Deep merge two objects
     * @private
     */
    _deepMerge(target, source) {
        const result = { ...target };
        
        for (const key in source) {
            if (source.hasOwnProperty(key)) {
                if (source[key] && typeof source[key] === 'object' && !Array.isArray(source[key])) {
                    // Recursively merge objects
                    result[key] = this._deepMerge(result[key] || {}, source[key]);
                } else {
                    // Overwrite with source value (including arrays)
                    result[key] = source[key];
                }
            }
        }
        
        return result;
    }
    
    /**
     * Get checkpoint manager for a config type
     * @param {string} configType - 'config', 'secureConfig', 'promptConfig', 'directorConfig', 'favorites', or 'workspaces'
     * @returns {Object|null} Checkpoint manager instance
     */
    getCheckpointManager(configType) {
        const configInfo = this._configs[configType];
        return configInfo ? configInfo.checkpointManager : null;
    }
    
    /**
     * Get config info for a specific config type
     * @param {string} configType - Config type
     * @returns {Object|null} Config info or null
     */
    getConfigInfo(configType) {
        return this._configs[configType] || null;
    }
    
    /**
     * Get all config types
     * @returns {string[]} Array of config type names
     */
    getConfigTypes() {
        return Object.keys(this._configs);
    }
    
    /**
     * Queue workspace desktop save, merging window positions into any pending debounced payload
     * @param {Object} partialPositions
     */
    queueWorkspaceDesktopWindowPositions(partialPositions) {
        const configType = 'workspaceDesktop';
        const configInfo = this._configs[configType];
        if (!configInfo) {
            throw new Error(`Unknown config type: ${configType}`);
        }

        if (!partialPositions || typeof partialPositions !== 'object') {
            throw new Error('partialPositions must be an object');
        }

        let nextConfig;
        if (configInfo.pendingSaveData) {
            nextConfig = JSON.parse(JSON.stringify(configInfo.pendingSaveData));
        } else {
            nextConfig = JSON.parse(JSON.stringify(this._getReactiveConfig(configType)));
        }

        nextConfig.windowPositions = {
            ...(nextConfig.windowPositions || {}),
            ...partialPositions
        };

        return this.saveConfig(configType, nextConfig);
    }

    /**
     * Flush all pending saves immediately (useful for shutdown)
     * @returns {number} Number of configs that were flushed
     */
    flushAllPendingSaves() {
        let flushedCount = 0;
        for (const [configType, configInfo] of Object.entries(this._configs)) {
            if (configInfo.pendingSaveData) {
                console.log(`💾 Flushing pending save for ${configType}`);
                try {
                    this._executePendingSave(configType);
                    flushedCount++;
                } catch (error) {
                    console.error(`❌ Error flushing ${configType}:`, error);
                }
            }
        }
        if (flushedCount > 0) {
            console.log(`✓ Flushed ${flushedCount} pending config save(s)`);
        }
        return flushedCount;
    }
    
    /**
     * Initialize all configs (checkpoint managers, validation, mitigation)
     * This is the main initialization method that handles everything
     */
    initialize() {
        // Step 1: Initialize checkpoint managers for all configs BEFORE initializing configs
        // Checkpoint managers can exist without the file - they can have checkpoints in storage
        this.initializeCheckpointManagers();
        
        // Step 2: Initialize and mitigate configs (checkpoint managers are now available)
        // Required configs
        this.initializeConfigWithMitigation('config');
        this.initializeConfigWithMitigation('secureConfig');
        
        // Optional configs (don't fail if they don't exist)
        try {
            this.initializeConfigWithMitigation('promptConfig');
        } catch (error) {
            console.warn('⚠️ prompt.config.json initialization failed:', error.message);
        }
        
        try {
            this.initializeConfigWithMitigation('directorConfig');
        } catch (error) {
            console.warn('⚠️ director.config.json initialization failed:', error.message);
        }
        
        try {
            this.initializeConfigWithMitigation('favorites');
        } catch (error) {
            console.warn('⚠️ favorites.json initialization failed:', error.message);
        }
        
        try {
            this.initializeConfigWithMitigation('workspaces');
        } catch (error) {
            console.warn('⚠️ workspace.json initialization failed:', error.message);
        }

        try {
            this.initializeConfigWithMitigation('naxGeneration');
        } catch (error) {
            console.warn('⚠️ nax_generation_config.json initialization failed:', error.message);
        }
    }
    
}

module.exports = {
    GlobalCheckpointManager,
    ConfigManager,
    ConfigModifier
};

