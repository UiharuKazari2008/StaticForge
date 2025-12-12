const crypto = require('crypto');
const logger = require('./logger');

/**
 * Data Plumbing System
 * 
 * A general-purpose system for managing data flow between modules, functions, and async processes.
 * Supports:
 * - Named or UUID-based data storage
 * - Callback/function registration
 * - Live data subscriptions
 * - Transform pipelines
 * - Auto-cleanup of old/unused items
 * 
 * Usage:
 *   const plumbing = require('./dataPlumbing');
 *   
 *   // Store static data
 *   plumbing.set('myData', { value: 123 });
 *   const data = plumbing.get('myData');
 *   
 *   // Store a callback
 *   plumbing.setCallback('onUpdate', (data) => console.log(data));
 *   plumbing.trigger('onUpdate', { value: 456 });
 *   
 *   // Subscribe to live data
 *   plumbing.subscribe('liveData', (data) => console.log('Updated:', data));
 *   plumbing.publish('liveData', { value: 789 });
 *   
 *   // Transform pipeline
 *   plumbing.setTransformer('process', (input) => input * 2);
 *   const result = plumbing.transform('process', 5); // returns 10
 */

class DataPlumbing {
    constructor() {
        // Storage maps
        this.data = new Map(); // name/uuid -> { value, type, createdAt, lastAccessed, options }
        this.callbacks = new Map(); // name/uuid -> { callback, type, createdAt, lastCalled, options }
        this.subscriptions = new Map(); // name -> Set of callbacks
        this.transformers = new Map(); // name/uuid -> { transformer, type, createdAt, lastUsed, options }
        
        // Letter/Mailbox System
        this.letters = new Map(); // letterId -> Letter object
        this.mailboxes = new Map(); // mailboxId -> Mailbox object
        this.letterToMailboxes = new Map(); // letterId -> Set of mailboxIds (reverse lookup)
        
        // Tracking
        this.usageCounts = new Map(); // name/uuid -> count
        this.metadata = new Map(); // name/uuid -> { tags, description, category }
        
        // Auto-cleanup settings
        this.cleanupInterval = null;
        this.cleanupSettings = {
            enabled: true,
            intervalMs: 5 * 60 * 1000, // 5 minutes
            maxAgeMs: 60 * 60 * 1000, // 1 hour for temporary items
            maxUnusedAgeMs: 30 * 60 * 1000, // 30 minutes for unused items
            cleanupTemporaryOnly: true // Only cleanup items marked as temporary
        };
        
        // Start auto-cleanup if enabled
        if (this.cleanupSettings.enabled) {
            this.startAutoCleanup();
        }
    }
    
    /**
     * Generate a UUID for temporary/unnamed items
     */
    generateUUID() {
        return crypto.randomUUID();
    }
    
    /**
     * Detect context from call stack (session, websocket, express request)
     * @private
     */
    _detectContext() {
        const context = {
            session: null,
            websocket: null,
            expressRequest: null,
            functionName: null,
            callStackDepth: null
        };
        
        // Try to detect from Error stack trace
        try {
            const stack = new Error().stack;
            const stackLines = stack.split('\n');
            
            // Detect express request (req parameter in handler)
            // Detect websocket (ws parameter in handler)
            // Detect session (req.session)
            
            // For now, we'll rely on explicit passing in options
            // But we can detect function name and approximate call stack depth
            if (stackLines.length > 3) {
                // Parse function name from stack (this is approximate)
                const callerLine = stackLines[3] || '';
                const match = callerLine.match(/at\s+(\w+)/);
                if (match) {
                    context.functionName = match[1];
                }
                context.callStackDepth = stackLines.length - 3; // Approximate depth
            }
        } catch (e) {
            // Ignore stack trace errors
        }
        
        return context;
    }
    
    /**
     * Get caller information from options or detect automatically
     * @private
     */
    _getOwnerInfo(options = {}) {
        const detected = this._detectContext();
        
        return {
            functionName: options.functionName || detected.functionName || 'unknown',
            parentFnLinked: options.parentFnLinked !== undefined ? options.parentFnLinked : false,
            sessionId: options.sessionId || (options.session?.id) || detected.session?.id || null,
            websocketId: options.websocketId || (options.websocket?.id) || detected.websocket?.id || null,
            requestId: options.requestId || (options.expressRequest?.requestId) || detected.expressRequest?.requestId || null,
            callStackDepth: options.callStackDepth || detected.callStackDepth || null
        };
    }
    
    /**
     * Store data with optional metadata
     * @param {string} name - Name or UUID identifier
     * @param {any} value - Data to store
     * @param {Object} options - Options object
     * @param {boolean} options.temporary - Mark as temporary (will be cleaned up)
     * @param {Array<string>} options.tags - Tags for categorization
     * @param {string} options.description - Human-readable description
     * @param {string} options.category - Category for grouping
     * @param {number} options.maxAgeMs - Max age before cleanup (overrides default)
     * @param {boolean} options.autoRefresh - Auto-refresh if callback provided
     * @param {Function} options.refreshCallback - Function to refresh data
     * @returns {string} The name/uuid used
     */
    set(name, value, options = {}) {
        const uuid = name || this.generateUUID();
        const now = Date.now();
        
        this.data.set(uuid, {
            value,
            type: 'data',
            createdAt: this.data.has(uuid) ? this.data.get(uuid).createdAt : now,
            lastAccessed: now,
            options: {
                temporary: options.temporary || false,
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null,
                maxAgeMs: options.maxAgeMs || this.cleanupSettings.maxAgeMs,
                autoRefresh: options.autoRefresh || false,
                refreshCallback: options.refreshCallback || null,
                refreshIntervalMs: options.refreshIntervalMs || null
            }
        });
        
        // Store metadata separately
        if (options.tags || options.description || options.category) {
            this.metadata.set(uuid, {
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null
            });
        }
        
        // Reset usage count
        this.usageCounts.set(uuid, 0);
        
        // Setup auto-refresh if enabled
        if (options.autoRefresh && options.refreshCallback) {
            this.setupAutoRefresh(uuid, options.refreshCallback, options.refreshIntervalMs);
        }
        
        return uuid;
    }
    
    /**
     * Get stored data
     * @param {string} name - Name or UUID identifier
     * @param {any} defaultValue - Default value if not found
     * @returns {any} Stored value or default
     */
    get(name, defaultValue = null) {
        const item = this.data.get(name);
        if (!item) {
            return defaultValue;
        }
        
        // Update access tracking
        item.lastAccessed = Date.now();
        this.usageCounts.set(name, (this.usageCounts.get(name) || 0) + 1);
        
        // Return value (clone if object/array to prevent mutation)
        if (item.value && typeof item.value === 'object') {
            return JSON.parse(JSON.stringify(item.value));
        }
        
        return item.value;
    }
    
    /**
     * Check if data exists
     * @param {string} name - Name or UUID identifier
     * @returns {boolean}
     */
    has(name) {
        return this.data.has(name);
    }
    
    /**
     * Register a callback function
     * @param {string} name - Name or UUID identifier
     * @param {Function} callback - Callback function
     * @param {Object} options - Options (same as set())
     * @returns {string} The name/uuid used
     */
    setCallback(name, callback, options = {}) {
        const uuid = name || this.generateUUID();
        const now = Date.now();
        
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        
        this.callbacks.set(uuid, {
            callback,
            type: 'callback',
            createdAt: this.callbacks.has(uuid) ? this.callbacks.get(uuid).createdAt : now,
            lastCalled: null,
            options: {
                temporary: options.temporary || false,
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null,
                maxAgeMs: options.maxAgeMs || this.cleanupSettings.maxAgeMs,
                once: options.once || false // Call once then remove
            }
        });
        
        // Store metadata
        if (options.tags || options.description || options.category) {
            this.metadata.set(uuid, {
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null
            });
        }
        
        return uuid;
    }
    
    /**
     * Trigger a callback
     * @param {string} name - Name or UUID identifier
     * @param {...any} args - Arguments to pass to callback
     * @returns {any} Return value from callback
     */
    trigger(name, ...args) {
        const item = this.callbacks.get(name);
        if (!item) {
            console.warn(`⚠️ Callback "${name}" not found`);
            return null;
        }
        
        // Update tracking
        item.lastCalled = Date.now();
        this.usageCounts.set(name, (this.usageCounts.get(name) || 0) + 1);
        
        // Call callback
        try {
            const result = item.callback(...args);
            
            // Remove if "once" option is set
            if (item.options.once) {
                this.removeCallback(name);
            }
            
            return result;
        } catch (error) {
            console.error(`❌ Error in callback "${name}":`, error);
            throw error;
        }
    }
    
    /**
     * Subscribe to data updates (pub/sub pattern)
     * @param {string} name - Subscription name
     * @param {Function} callback - Callback function
     * @param {Object} options - Options
     * @returns {string} Subscription ID (can be used to unsubscribe)
     */
    subscribe(name, callback, options = {}) {
        if (!this.subscriptions.has(name)) {
            this.subscriptions.set(name, new Set());
        }
        
        const subscriptionId = options.id || this.generateUUID();
        
        if (typeof callback !== 'function') {
            throw new Error('Callback must be a function');
        }
        
        const subscription = {
            id: subscriptionId,
            callback,
            createdAt: Date.now(),
            once: options.once || false // Unsubscribe after first call
        };
        
        this.subscriptions.get(name).add(subscription);
        
        return subscriptionId;
    }
    
    /**
     * Unsubscribe from data updates
     * @param {string} name - Subscription name
     * @param {string} subscriptionId - Subscription ID (if not provided, removes all)
     */
    unsubscribe(name, subscriptionId = null) {
        if (!this.subscriptions.has(name)) {
            return;
        }
        
        const subscribers = this.subscriptions.get(name);
        
        if (subscriptionId) {
            // Remove specific subscription
            for (const sub of subscribers) {
                if (sub.id === subscriptionId) {
                    subscribers.delete(sub);
                    break;
                }
            }
        } else {
            // Remove all subscriptions for this name
            subscribers.clear();
        }
        
        // Clean up empty subscription sets
        if (subscribers.size === 0) {
            this.subscriptions.delete(name);
        }
    }
    
    /**
     * Publish data to subscribers
     * @param {string} name - Subscription name
     * @param {any} data - Data to publish
     */
    publish(name, data) {
        if (!this.subscriptions.has(name)) {
            return;
        }
        
        const subscribers = this.subscriptions.get(name);
        const toRemove = [];
        
        for (const subscription of subscribers) {
            try {
                subscription.callback(data);
                
                // Mark for removal if "once" option is set
                if (subscription.once) {
                    toRemove.push(subscription);
                }
            } catch (error) {
                console.error(`❌ Error in subscription "${name}":`, error);
            }
        }
        
        // Remove "once" subscriptions
        for (const sub of toRemove) {
            subscribers.delete(sub);
        }
        
        // Clean up empty subscription sets
        if (subscribers.size === 0) {
            this.subscriptions.delete(name);
        }
    }
    
    /**
     * Set a data transformer function
     * @param {string} name - Name or UUID identifier
     * @param {Function} transformer - Transform function
     * @param {Object} options - Options (same as set())
     * @returns {string} The name/uuid used
     */
    setTransformer(name, transformer, options = {}) {
        const uuid = name || this.generateUUID();
        const now = Date.now();
        
        if (typeof transformer !== 'function') {
            throw new Error('Transformer must be a function');
        }
        
        this.transformers.set(uuid, {
            transformer,
            type: 'transformer',
            createdAt: this.transformers.has(uuid) ? this.transformers.get(uuid).createdAt : now,
            lastUsed: null,
            options: {
                temporary: options.temporary || false,
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null,
                maxAgeMs: options.maxAgeMs || this.cleanupSettings.maxAgeMs
            }
        });
        
        // Store metadata
        if (options.tags || options.description || options.category) {
            this.metadata.set(uuid, {
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null
            });
        }
        
        return uuid;
    }
    
    /**
     * Transform data through a transformer
     * @param {string} name - Transformer name
     * @param {any} input - Input data
     * @returns {any} Transformed data
     */
    transform(name, input) {
        const item = this.transformers.get(name);
        if (!item) {
            throw new Error(`Transformer "${name}" not found`);
        }
        
        // Update tracking
        item.lastUsed = Date.now();
        this.usageCounts.set(name, (this.usageCounts.get(name) || 0) + 1);
        
        try {
            return item.transformer(input);
        } catch (error) {
            console.error(`❌ Error in transformer "${name}":`, error);
            throw error;
        }
    }
    
    /**
     * Remove data item
     * @param {string} name - Name or UUID identifier
     */
    remove(name) {
        this.data.delete(name);
        this.metadata.delete(name);
        this.usageCounts.delete(name);
    }
    
    /**
     * Remove callback
     * @param {string} name - Name or UUID identifier
     */
    removeCallback(name) {
        this.callbacks.delete(name);
        this.metadata.delete(name);
        this.usageCounts.delete(name);
    }
    
    /**
     * Remove transformer
     * @param {string} name - Name or UUID identifier
     */
    removeTransformer(name) {
        this.transformers.delete(name);
        this.metadata.delete(name);
        this.usageCounts.delete(name);
    }
    
    /**
     * Create a Letter (single item) that can be addressed to multiple mailboxes
     * @param {any} data - Data for the letter (can be null/undefined for promise state)
     * @param {string|Array<string>} mailboxIds - Single mailbox ID or array of mailbox IDs to address
     * @param {Object} options - Options
     * @param {number} options.index - Index for ordering (used when added to mailbox)
     * @param {Array<string>} options.tags - Tags for categorization
     * @param {string} options.description - Human-readable description
     * @param {string} options.category - Category for grouping
     * @param {string} options.functionName - Owner function name
     * @param {boolean|number} options.parentFnLinked - Link to parent function (bool or call stack depth)
     * @param {string} options.sessionId - Session ID
     * @param {Object} options.session - Session object
     * @param {string} options.websocketId - WebSocket ID
     * @param {Object} options.websocket - WebSocket object
     * @param {string} options.requestId - Request ID
     * @param {Object} options.expressRequest - Express request object
     * @returns {string} The letterId
     */
    createLetter(data, mailboxIds, options = {}) {
        const letterId = options.letterId || this.generateUUID();
        const now = Date.now();
        const addresses = Array.isArray(mailboxIds) ? mailboxIds : [mailboxIds];
        
        // Get owner information
        const owner = this._getOwnerInfo(options);
        
        // Create or update letter
        const letter = {
            id: letterId,
            data: data, // Can be null/undefined (promise state)
            addresses: [...new Set(addresses)], // Unique addresses
            readFrom: [], // Track which mailboxes have read this letter
            createdAt: now,
            updatedAt: now,
            owner: owner,
            options: {
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null,
                index: options.index !== undefined ? options.index : null
            }
        };
        
        this.letters.set(letterId, letter);
        
        // Add letter to mailboxes (create mailboxes if they don't exist)
        for (const mailboxId of addresses) {
            this._ensureMailbox(mailboxId, options);
            const mailbox = this.mailboxes.get(mailboxId);
            
            // Add letter ID to mailbox (only if not already present)
            if (!mailbox.letterIds.includes(letterId)) {
                mailbox.letterIds.push(letterId);
                // Sort by index if available, otherwise maintain insertion order
                if (options.index !== undefined) {
                    mailbox.letterIds.sort((id1, id2) => {
                        const l1 = this.letters.get(id1);
                        const l2 = this.letters.get(id2);
                        const idx1 = l1?.options.index ?? Infinity;
                        const idx2 = l2?.options.index ?? Infinity;
                        return idx1 - idx2;
                    });
                }
            }
            
            // Update reverse lookup
            if (!this.letterToMailboxes.has(letterId)) {
                this.letterToMailboxes.set(letterId, new Set());
            }
            this.letterToMailboxes.get(letterId).add(mailboxId);
        }
        
        // Notify if data is available (not promise state)
        if (data !== null && data !== undefined) {
            for (const mailboxId of addresses) {
                this.publish(`mailbox:${mailboxId}:received`, data);
            }
        }
        
        return letterId;
    }
    
    /**
     * Update letter data (fulfill promise)
     * @param {string} letterId - Letter ID
     * @param {any} data - Data to set
     */
    updateLetter(letterId, data) {
        const letter = this.letters.get(letterId);
        if (!letter) {
            return false;
        }
        
        const wasPromise = letter.data === null || letter.data === undefined;
        letter.data = data;
        letter.updatedAt = Date.now();
        
        // Notify mailboxes if data was just fulfilled
        if (wasPromise && data !== null && data !== undefined) {
            for (const mailboxId of letter.addresses) {
                this.publish(`mailbox:${mailboxId}:received`, data);
            }
        }
        
        return true;
    }
    
    /**
     * Ensure mailbox exists, create if it doesn't
     * @private
     */
    _ensureMailbox(mailboxId, options = {}) {
        if (this.mailboxes.has(mailboxId)) {
            return; // Already exists
        }
        
        const now = Date.now();
        const owner = this._getOwnerInfo(options);
        
        // Check if this mailbox was previously deleted and we have letters that remember it
        // If letters exist with this address, they "remember" it
        let rememberedLetters = [];
        for (const [letterId, letter] of this.letters.entries()) {
            if (letter.addresses.includes(mailboxId)) {
                rememberedLetters.push(letterId);
            }
        }
        
        const mailbox = {
            id: mailboxId,
            letterIds: [...rememberedLetters], // Restore remembered letters
            directData: [], // Direct data storage (without letters) - array of { data, index, timestamp }
            createdAt: now,
            lastReadAt: null,
            owner: owner,
            options: {
                removeAfterRead: options.removeAfterRead !== false, // Default true
                maxAgeMs: options.maxAgeMs || 60 * 60 * 1000, // 1 hour default
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null
            }
        };
        
        this.mailboxes.set(mailboxId, mailbox);
        
        // Store metadata
        if (options.tags || options.description || options.category) {
            this.metadata.set(mailboxId, {
                tags: options.tags || [],
                description: options.description || null,
                category: options.category || null
            });
        }
    }
    
    /**
     * Create or get a Mailbox (array container)
     * @param {string} mailboxId - Unique mailbox identifier
     * @param {Object} options - Options
     * @returns {string} The mailboxId
     */
    createMailbox(mailboxId, options = {}) {
        this._ensureMailbox(mailboxId, options);
        return mailboxId;
    }
    
    /**
     * Add a Letter to a Mailbox (or create letter if data provided)
     * @param {string} mailboxId - Mailbox ID
     * @param {any} data - Data (creates letter) OR letterId string
     * @param {Object} options - Options
     * @returns {string} The letterId
     */
    addToMailbox(mailboxId, data, options = {}) {
        this._ensureMailbox(mailboxId, options);
        
        // If data is a string and looks like a letterId, treat it as adding existing letter
        if (typeof data === 'string' && this.letters.has(data)) {
            const letter = this.letters.get(data);
            if (!letter.addresses.includes(mailboxId)) {
                letter.addresses.push(mailboxId);
                this.mailboxes.get(mailboxId).letterIds.push(data);
                if (!this.letterToMailboxes.has(data)) {
                    this.letterToMailboxes.set(data, new Set());
                }
                this.letterToMailboxes.get(data).add(mailboxId);
            }
            return data;
        }
        
        // Otherwise create new letter addressed to this mailbox
        return this.createLetter(data, mailboxId, options);
    }
    
    /**
     * Add data directly to a mailbox without creating a letter
     * 
     * IMPORTANT: Direct data is ONLY linked to the specified mailbox and cannot be accessed
     * from other mailboxes. Unlike letters (which can have multiple addresses), direct data
     * is mailbox-specific and is removed when the mailbox is removed.
     * 
     * Use this when you want lightweight, mailbox-specific data storage without the overhead
     * of the letter system (no multi-address support, no promise state tracking).
     * 
     * @param {string} mailboxId - Mailbox ID
     * @param {any} data - Data to add directly (only accessible from this mailbox)
     * @param {Object} options - Options
     * @param {number} options.index - Index for ordering
     * @returns {string} The mailboxId
     */
    addToMailboxDirect(mailboxId, data, options = {}) {
        this._ensureMailbox(mailboxId, options);
        const mailbox = this.mailboxes.get(mailboxId);
        const now = Date.now();
        
        // Add to directData array
        const directItem = {
            data: data,
            index: options.index !== undefined ? options.index : mailbox.directData.length,
            timestamp: now
        };
        
        mailbox.directData.push(directItem);
        
        // Sort by index to maintain order
        mailbox.directData.sort((a, b) => a.index - b.index);
        
        // Notify subscribers
        this.publish(`mailbox:${mailboxId}:received`, data);
        
        return mailboxId;
    }
    
    /**
     * Send data to a mailbox (backward compatibility - creates letter and adds to mailbox)
     * @deprecated Use createLetter() for letters or addToMailboxDirect() for direct data
     * @param {string} mailboxId - Unique mailbox identifier
     * @param {any} data - Data to store
     * @param {Object} options - Options
     * @param {boolean} options.mailstack - If true, uses addToMailboxDirect (direct data), else creates letter
     * @param {number} options.index - Index for ordering
     * @returns {string} The mailboxId used
     */
    setMailbox(mailboxId, data, options = {}) {
        if (options.mailstack === true) {
            // Mailstack mode: use direct data (mailbox-specific, no letter overhead)
            this.addToMailboxDirect(mailboxId, data, { index: options.index });
            return mailboxId;
        } else {
            // Letter mode: create single letter (supports multi-address, promise state, etc.)
            this.createLetter(data, mailboxId, options);
            return mailboxId;
        }
    }
    
    /**
     * Get data from mailbox (returns letters that have data, sorted by index)
     * Mailboxes always return arrays (even if single item)
     * @param {string} mailboxId - Unique mailbox identifier
     * @param {boolean} removeAfterRead - Remove after reading (overrides mailbox option)
     * @returns {Array|null} Array of letter data or null if no letters with data
     */
    getMailbox(mailboxId, removeAfterRead = null) {
        const mailbox = this.mailboxes.get(mailboxId);
        if (!mailbox) {
            return null;
        }
        
        const shouldRemove = removeAfterRead !== null ? removeAfterRead : mailbox.options.removeAfterRead;
        mailbox.lastReadAt = Date.now();
        
        // Get all letters from mailbox that have data (not promise state)
        const letters = mailbox.letterIds
            .map(letterId => this.letters.get(letterId))
            .filter(letter => {
                // Only return letters that have data (not promise state)
                return letter && letter.data !== null && letter.data !== undefined;
            });
        
        // Sort by index if available
        letters.sort((a, b) => {
            const idxA = a.options.index ?? Infinity;
            const idxB = b.options.index ?? Infinity;
            return idxA - idxB;
        });
        
        // Extract data from letters and mark as read
        const letterItems = letters.map(letter => {
            // Mark as read from this mailbox
            if (!letter.readFrom.includes(mailboxId)) {
                letter.readFrom.push(mailboxId);
            }
            
            return {
                data: letter.data,
                index: letter.options.index ?? Infinity
            };
        });
        
        // Get direct data items
        const directItems = mailbox.directData.map(item => ({
            data: item.data,
            index: item.index
        }));
        
        // Combine letter data and direct data, maintaining order by index
        const allItems = [...letterItems, ...directItems];
        
        // Sort all items by index
        allItems.sort((a, b) => a.index - b.index);
        
        // Extract just the data
        const results = allItems.map(item => item.data);
        
        // Remove letters if read from all addresses and removal requested
        if (shouldRemove) {
            const toRemove = letters.filter(letter => 
                letter.readFrom.length === letter.addresses.length
            );
            
            for (const letter of toRemove) {
                this._removeLetter(letter.id);
            }
            
            // Update mailbox letterIds (remove fully read letters)
            mailbox.letterIds = mailbox.letterIds.filter(id => {
                const letter = this.letters.get(id);
                return letter && letter.readFrom.length < letter.addresses.length;
            });
            
            // Clear direct data if removal requested
            mailbox.directData = [];
            
            // If mailbox is empty and should be removed, remove it
            if (mailbox.letterIds.length === 0 && mailbox.directData.length === 0) {
                this.mailboxes.delete(mailboxId);
                this.metadata.delete(mailboxId);
            }
        }
        
        // Return array for mailstack (multiple letters), single value for single letter (backward compatibility)
        // Return null if no letters with data
        if (results.length === 0) {
            return null;
        } else if (results.length === 1) {
            // Single letter: return value directly for backward compatibility
            // Note: For mailstack usage, check length or use getMailboxAll()
            return results[0];
        } else {
            // Multiple letters: return array (mailstack)
            return results;
        }
    }
    
    /**
     * Remove a letter (internal helper)
     * @private
     */
    _removeLetter(letterId) {
        const letter = this.letters.get(letterId);
        if (!letter) return;
        
        // Remove from all mailboxes
        for (const mailboxId of letter.addresses) {
            const mailbox = this.mailboxes.get(mailboxId);
            if (mailbox) {
                mailbox.letterIds = mailbox.letterIds.filter(id => id !== letterId);
            }
        }
        
        // Remove reverse lookup
        this.letterToMailboxes.delete(letterId);
        
        // Remove letter
        this.letters.delete(letterId);
    }
    
    /**
     * Get all addresses (mailbox IDs) that a letter is addressed to
     * @param {string} letterId - Letter ID
     * @returns {Array<string>} Array of mailbox IDs
     */
    getLetterAddresses(letterId) {
        const letter = this.letters.get(letterId);
        return letter ? [...letter.addresses] : [];
    }
    
    /**
     * Get all letters addressed to a mailbox (always returns array)
     * @param {string} mailboxId - Mailbox ID
     * @param {boolean} removeAfterRead - Remove after reading
     * @returns {Array} Array of letter data (always array, even if single item)
     */
    getMailboxAll(mailboxId, removeAfterRead = null) {
        const result = this.getMailbox(mailboxId, removeAfterRead);
        if (result === null) {
            return [];
        }
        // If getMailbox returned single value, wrap in array
        return Array.isArray(result) ? result : [result];
    }
    
    /**
     * Get all letters addressed to a mailbox (metadata)
     * @param {string} mailboxId - Mailbox ID
     * @returns {Array<Object>} Array of letter metadata objects
     */
    getMailboxAddresses(mailboxId) {
        const mailbox = this.mailboxes.get(mailboxId);
        if (!mailbox) return [];
        
        return mailbox.letterIds.map(letterId => {
            const letter = this.letters.get(letterId);
            return {
                letterId: letterId,
                hasData: letter && letter.data !== null && letter.data !== undefined,
                addresses: letter ? [...letter.addresses] : [],
                readFrom: letter ? [...letter.readFrom] : []
            };
        });
    }
    
    /**
     * Check if letter has been read from all addresses
     * @param {string} letterId - Letter ID
     * @returns {boolean}
     */
    isLetterFullyRead(letterId) {
        const letter = this.letters.get(letterId);
        if (!letter) return false;
        
        return letter.readFrom.length === letter.addresses.length;
    }
    
    /**
     * Wait for data to arrive in mailbox (async)
     * @param {string} mailboxId - Unique mailbox identifier
     * @param {number} timeoutMs - Timeout in milliseconds (default: 30000)
     * @returns {Promise<any>} Data from mailbox
     */
    async waitForMail(mailboxId, timeoutMs = 30000) {
        // Check if already exists
        const existing = this.getMailbox(mailboxId, false);
        if (existing !== null) {
            return existing;
        }
        
        return new Promise((resolve, reject) => {
            const subscriptionId = this.subscribe(`mailbox:${mailboxId}:received`, (data) => {
                this.unsubscribe(`mailbox:${mailboxId}:received`, subscriptionId);
                resolve(data);
            }, { once: true });
            
            // Timeout
            setTimeout(() => {
                this.unsubscribe(`mailbox:${mailboxId}:received`, subscriptionId);
                reject(new Error(`Mailbox ${mailboxId} timeout after ${timeoutMs}ms`));
            }, timeoutMs);
        });
    }
    
    /**
     * Check if mailbox has data (non-blocking)
     * @param {string} mailboxId - Unique mailbox identifier
     * @returns {boolean}
     */
    hasMailbox(mailboxId) {
        return this.mailboxes.has(mailboxId);
    }
    
    /**
     * Remove mailbox (letters remember their addresses, so they can be re-added if mailbox recreated)
     * @param {string} mailboxId - Unique mailbox identifier
     */
    removeMailbox(mailboxId) {
        const mailbox = this.mailboxes.get(mailboxId);
        if (mailbox) {
            // Remove mailbox reference from letters (but letters keep address in memory)
            // Letters will re-attach if mailbox is recreated with same ID
            for (const letterId of mailbox.letterIds) {
                const letter = this.letters.get(letterId);
                if (letter) {
                    // Remove from readFrom tracking
                    letter.readFrom = letter.readFrom.filter(id => id !== mailboxId);
                    // Update reverse lookup
                    const mailboxSet = this.letterToMailboxes.get(letterId);
                    if (mailboxSet) {
                        mailboxSet.delete(mailboxId);
                    }
                }
            }
        }
        
        this.mailboxes.delete(mailboxId);
        this.metadata.delete(mailboxId);
    }
    
    /**
     * Setup auto-refresh for a data item
     * @private
     */
    setupAutoRefresh(name, refreshCallback, intervalMs) {
        // Clear existing interval if any
        if (this.data.has(name) && this.data.get(name).refreshInterval) {
            clearInterval(this.data.get(name).refreshInterval);
        }
        
        const interval = setInterval(async () => {
            try {
                const refreshedValue = await refreshCallback();
                if (this.data.has(name)) {
                    this.data.get(name).value = refreshedValue;
                    this.data.get(name).lastAccessed = Date.now();
                    
                    // Notify subscribers if any
                    this.publish(`${name}:refreshed`, refreshedValue);
                }
            } catch (error) {
                console.error(`❌ Error auto-refreshing "${name}":`, error);
            }
        }, intervalMs || 60000); // Default 1 minute
        
        if (this.data.has(name)) {
            this.data.get(name).refreshInterval = interval;
        }
    }
    
    /**
     * Start auto-cleanup interval
     */
    startAutoCleanup() {
        if (this.cleanupInterval) {
            return; // Already running
        }
        
        this.cleanupInterval = setInterval(() => {
            this.cleanup();
        }, this.cleanupSettings.intervalMs);
    }
    
    /**
     * Stop auto-cleanup interval
     */
    stopAutoCleanup() {
        if (this.cleanupInterval) {
            clearInterval(this.cleanupInterval);
            this.cleanupInterval = null;
        }
    }
    
    /**
     * Cleanup old/unused items
     * @param {Object} options - Cleanup options
     * @returns {Object} Cleanup statistics
     */
    cleanup(options = {}) {
        const settings = { ...this.cleanupSettings, ...options };
        const now = Date.now();
        let removed = 0;
        
        // Cleanup data items
        for (const [name, item] of this.data.entries()) {
            const age = now - item.createdAt;
            const unusedAge = now - (item.lastAccessed || item.createdAt);
            const maxAge = item.options.maxAgeMs || settings.maxAgeMs;
            
            // Skip permanent items unless forced
            if (!item.options.temporary && settings.cleanupTemporaryOnly) {
                continue;
            }
            
            // Remove if too old or unused too long
            if (age > maxAge || unusedAge > settings.maxUnusedAgeMs) {
                // Clear refresh interval if exists
                if (item.refreshInterval) {
                    clearInterval(item.refreshInterval);
                }
                
                this.remove(name);
                removed++;
            }
        }
        
        // Cleanup callbacks
        for (const [name, item] of this.callbacks.entries()) {
            const age = now - item.createdAt;
            const unusedAge = now - (item.lastCalled || item.createdAt);
            const maxAge = item.options.maxAgeMs || settings.maxAgeMs;
            
            if (!item.options.temporary && settings.cleanupTemporaryOnly) {
                continue;
            }
            
            if (age > maxAge || unusedAge > settings.maxUnusedAgeMs) {
                this.removeCallback(name);
                removed++;
            }
        }
        
        // Cleanup transformers
        for (const [name, item] of this.transformers.entries()) {
            const age = now - item.createdAt;
            const unusedAge = now - (item.lastUsed || item.createdAt);
            const maxAge = item.options.maxAgeMs || settings.maxAgeMs;
            
            if (!item.options.temporary && settings.cleanupTemporaryOnly) {
                continue;
            }
            
            if (age > maxAge || unusedAge > settings.maxUnusedAgeMs) {
                this.removeTransformer(name);
                removed++;
            }
        }
        
        // Cleanup mailboxes
        for (const [mailboxId, mailbox] of this.mailboxes.entries()) {
            const age = now - mailbox.createdAt;
            const maxAge = mailbox.options.maxAgeMs || settings.maxAgeMs;
            
            // Mailboxes are always temporary (they're for async data passing)
            // Remove if too old
            if (age > maxAge) {
                this.removeMailbox(mailboxId);
                removed++;
            }
        }
        
        // Cleanup letters (orphaned or fully read and old)
        for (const [letterId, letter] of this.letters.entries()) {
            const age = now - letter.createdAt;
            const maxAge = 60 * 60 * 1000; // 1 hour default for letters
            
            // Remove if fully read and old, or if all addresses are gone
            const allAddressesGone = letter.addresses.every(addr => !this.mailboxes.has(addr));
            const fullyReadAndOld = this.isLetterFullyRead(letterId) && age > maxAge;
            
            if (allAddressesGone || fullyReadAndOld) {
                this._removeLetter(letterId);
                removed++;
            }
        }
        
        // Cleanup old subscriptions (if not called recently)
        for (const [name, subscribers] of this.subscriptions.entries()) {
            const toRemove = [];
            
            for (const sub of subscribers) {
                // Remove subscriptions older than max age
                if (now - sub.createdAt > settings.maxAgeMs) {
                    toRemove.push(sub);
                }
            }
            
            for (const sub of toRemove) {
                subscribers.delete(sub);
                removed++;
            }
            
            if (subscribers.size === 0) {
                this.subscriptions.delete(name);
            }
        }
        
        if (removed > 0) {
            logger.debug(`🧹 Data plumbing cleanup: removed ${removed} items`);
        }
        
        return {
            removed,
            dataItems: this.data.size,
            callbacks: this.callbacks.size,
            transformers: this.transformers.size,
            subscriptions: this.subscriptions.size
        };
    }
    
    /**
     * Get statistics about stored items
     * @returns {Object} Statistics
     */
    getStats() {
        return {
            data: this.data.size,
            callbacks: this.callbacks.size,
            transformers: this.transformers.size,
            subscriptions: this.subscriptions.size,
            total: this.data.size + this.callbacks.size + this.transformers.size
        };
    }
    
    /**
     * Get all items by category
     * @param {string} category - Category name
     * @returns {Array} Array of item names
     */
    getByCategory(category) {
        const items = [];
        
        for (const [name, item] of this.data.entries()) {
            const meta = this.metadata.get(name);
            if (meta && meta.category === category) {
                items.push(name);
            }
        }
        
        for (const [name] of this.callbacks.entries()) {
            const meta = this.metadata.get(name);
            if (meta && meta.category === category) {
                items.push(name);
            }
        }
        
        for (const [name] of this.transformers.entries()) {
            const meta = this.metadata.get(name);
            if (meta && meta.category === category) {
                items.push(name);
            }
        }
        
        return items;
    }
    
    /**
     * Get all items by tag
     * @param {string} tag - Tag name
     * @returns {Array} Array of item names
     */
    getByTag(tag) {
        const items = [];
        
        for (const [name, item] of this.data.entries()) {
            const meta = this.metadata.get(name);
            if (meta && meta.tags.includes(tag)) {
                items.push(name);
            }
        }
        
        for (const [name] of this.callbacks.entries()) {
            const meta = this.metadata.get(name);
            if (meta && meta.tags.includes(tag)) {
                items.push(name);
            }
        }
        
        for (const [name] of this.transformers.entries()) {
            const meta = this.metadata.get(name);
            if (meta && meta.tags.includes(tag)) {
                items.push(name);
            }
        }
        
        return items;
    }
    
    /**
     * Clear all items (use with caution!)
     * @param {Object} options - Options
     */
    clearAll(options = {}) {
        const { keepPermanent = true } = options;
        
        if (keepPermanent) {
            // Only remove temporary items
            for (const [name, item] of this.data.entries()) {
                if (item.options.temporary) {
                    this.remove(name);
                }
            }
            
            for (const [name, item] of this.callbacks.entries()) {
                if (item.options.temporary) {
                    this.removeCallback(name);
                }
            }
            
            for (const [name, item] of this.transformers.entries()) {
                if (item.options.temporary) {
                    this.removeTransformer(name);
                }
            }
        } else {
            // Remove everything
            this.data.clear();
            this.callbacks.clear();
            this.transformers.clear();
            this.subscriptions.clear();
            this.metadata.clear();
            this.usageCounts.clear();
        }
    }
}

// Export singleton instance
const dataPlumbing = new DataPlumbing();

module.exports = dataPlumbing;
