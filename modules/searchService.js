const fs = require('fs');
const path = require('path');
const { normalizeAutofillSearchSettings } = require('./autofillSearchSettings');

// Search functionality module
class SearchService {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('SearchService requires globalResources instance and should only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        // Tag search services will be lazy-loaded when needed
        // This prevents loading 380MB+ of data at server startup
        this.spellChecker = null;
        this.wordLookupService = null;
        this.tagAutofillSearch = null;
        this._servicesInitialized = false;

        // Session-based rate limiting with rolling window
        this.sessionRateLimiters = new Map(); // Track rate limiters by session ID
        this.requestThrottleMs = 1000; // 1000ms between completed NovelAI tag API requests
        this.continuationThrottleMs = 120; // shorter gap when the user extends the same query
        this.tagSearchMaxWords = 8;

        // Track active requests for cancellation
        this.activeRequests = new Map(); // Track active requests by requestId

        // Latest request tracking for "latest wins" pattern
        this.latestRequests = new Map(); // Track latest request per session+model
        this.isProcessing = new Map(); // Track if processing is active per session+model

        // Timer will be registered by globalResources when SearchService is initialized
        this._cleanupTimerId = null;

        // Active search packet context (requestId + autofillSessionId) for WS responses
        this._searchPacketContext = null;

        // In-process NovelAI suggest-tags cache (SQLite is L2)
        this.novelAiTagL1Cache = new Map();
        this.novelAiTagL1CacheMax = 400;
    }

    _getTagSearchDatabaseModule() {
        try {
            return this.globalResources.getTagSearchDatabase();
        } catch (e) {
            return null;
        }
    }

    _getNovelAiTagCacheKey(normalizedQuery, apiModel) {
        return `${normalizedQuery}\x00${apiModel}`;
    }

    _storeNovelAiTagL1Cache(normalizedQuery, apiModel, tags) {
        const key = this._getNovelAiTagCacheKey(normalizedQuery, apiModel);
        this.novelAiTagL1Cache.set(key, tags);
        if (this.novelAiTagL1Cache.size > this.novelAiTagL1CacheMax) {
            const oldestKey = this.novelAiTagL1Cache.keys().next().value;
            if (oldestKey !== undefined) {
                this.novelAiTagL1Cache.delete(oldestKey);
            }
        }
    }

    _lookupNovelAiTagPrefixCache(normalizedQuery, apiModel) {
        const direct = this._lookupNovelAiTagCache(normalizedQuery, apiModel);
        if (direct && direct.tags && direct.tags.length > 0) {
            return direct;
        }
        const words = (normalizedQuery || '').split(/\s+/).filter(Boolean);
        for (let len = words.length - 1; len >= 1; len--) {
            const prefix = words.slice(0, len).join(' ');
            const hit = this._lookupNovelAiTagCache(prefix, apiModel);
            if (hit && hit.tags && hit.tags.length >= 3) {
                return hit;
            }
        }
        return null;
    }

    _lookupNovelAiTagCache(normalizedQuery, apiModel) {
        const key = this._getNovelAiTagCacheKey(normalizedQuery, apiModel);
        if (this.novelAiTagL1Cache.has(key)) {
            return { fromCache: true, tags: this.novelAiTagL1Cache.get(key) };
        }

        const tagSearchDatabase = this._getTagSearchDatabaseModule();
        if (!tagSearchDatabase) {
            return null;
        }

        let sqliteTags = null;
        try {
            sqliteTags = tagSearchDatabase.getCachedTags(normalizedQuery, apiModel);
        } catch (e) {
            console.warn('Failed to get cached tags:', e.message);
        }

        if (!sqliteTags || sqliteTags.length === 0) {
            return null;
        }

        const tags = sqliteTags.map((tag) => ({
            tag: tag.tag,
            count: tag.count,
            confidence: tag.confidence ?? 0.95
        }));
        this._storeNovelAiTagL1Cache(normalizedQuery, apiModel, tags);
        return { fromCache: true, tags };
    }

    _persistNovelAiTagCache(normalizedQuery, apiModel, tags) {
        if (!tags || tags.length === 0) {
            return;
        }
        this._storeNovelAiTagL1Cache(normalizedQuery, apiModel, tags);
        const tagSearchDatabase = this._getTagSearchDatabaseModule();
        if (!tagSearchDatabase) {
            return;
        }
        try {
            tagSearchDatabase.saveSearchResults(normalizedQuery, apiModel, tags);
        } catch (e) {
            console.warn('Failed to save cached tags:', e.message);
        }
    }

    sendSearchWs(ws, payload) {
        if (!ws) return;
        const ctx = this._searchPacketContext || {};
        const message = {
            ...payload,
            requestId: payload.requestId ?? ctx.requestId ?? null,
            ...(ctx.autofillSessionId ? { autofillSessionId: ctx.autofillSessionId } : {})
        };
        ws.send(JSON.stringify(message));
    }

    /**
     * Lazy-initialize spell checker and database autofill search
     */
    async ensureServicesInitialized() {
        if (this._servicesInitialized) return;

        if (this.globalResources.isInitialized()) {
            this.spellChecker = this.globalResources.getSpellChecker();
            this.wordLookupService = this.globalResources.getWordLookupService();
            this.tagAutofillSearch = this.globalResources.getTagAutofillSearch();
        } else {
            console.log('⚠️  SearchService running without global resources (spell check only)');
            const SpellChecker = require('./spellChecker');
            this.spellChecker = new SpellChecker();
        }

        this._servicesInitialized = true;
    }

    // Session+Model-based rate limiting with rolling window
    getOrCreateSessionModelRateLimiter(sessionId, model) {
        const key = `${sessionId}_${model}`;
        if (!this.sessionRateLimiters.has(key)) {
            this.sessionRateLimiters.set(key, {
                sessionId,
                model,
                lastCompletedRequest: 0,
                isProcessing: false,
                latestQuery: null,
                pendingRequest: null // Only track the latest pending request
            });
        }
        return this.sessionRateLimiters.get(key);
    }

    truncateTagSearchQuery(query, maxWords = null) {
        const limit = maxWords != null ? maxWords : this.tagSearchMaxWords;
        const words = (query || '').trim().split(/\s+/).filter(Boolean);
        if (words.length <= limit) {
            return (query || '').trim();
        }
        return words.slice(-limit).join(' ');
    }

    // Simple rate limiting: Only process the last request, discard expired ones
    async throttleTagRequest(sessionId, query, model, requestId, ws = null, options = {}) {
        // Validate sessionId
        if (!sessionId || sessionId === 'null' || sessionId === 'undefined' || !ws) {
            console.error(`❌ Invalid sessionId: ${sessionId} for query "${query}" on model ${model}`);
            throw new Error('Invalid session ID provided');
        }

        const rateLimiter = this.getOrCreateSessionModelRateLimiter(sessionId, model);
        const now = Date.now();

        rateLimiter.latestQuery = query;

        // Cancel any existing pending request for this session+model combination
        if (rateLimiter.pendingRequest) {
            rateLimiter.pendingRequest.abortController.abort();
            rateLimiter.pendingRequest = null;
        }

        // Cancel any existing stalled request for this session+model combination
        if (rateLimiter.stalledAbortController) {
            rateLimiter.stalledAbortController.abort();
            if (rateLimiter.pendingReject) {
                rateLimiter.pendingReject(new Error('Request was superseded by a newer search'));
            }
            // Clean up stalled request info
            rateLimiter.stalledAbortController = null;
            rateLimiter.pendingResolve = null;
            rateLimiter.pendingReject = null;
            rateLimiter.pendingQuery = null;
            rateLimiter.pendingWs = null;
            rateLimiter.pendingRequestId = null;
        }

        const throttleMs = options.isContinuation ? this.continuationThrottleMs : this.requestThrottleMs;

        // Check if we can process this request immediately
        const timeSinceLastCompleted = now - rateLimiter.lastCompletedRequest;
        const canProcessImmediately = !rateLimiter.isProcessing && timeSinceLastCompleted >= throttleMs;

        if (canProcessImmediately) {
            // Can process immediately
            rateLimiter.isProcessing = true;
            rateLimiter.pendingRequest = {
                requestId,
                query,
                model,
                timestamp: now,
                abortController: new AbortController()
            };

            return rateLimiter.pendingRequest.abortController.signal;
        } else {
            // Cannot process immediately - wait for the required delay
            // This ensures we only process the last request after the delay
            const delay = throttleMs - timeSinceLastCompleted;

            // Create an AbortController for this request
            const abortController = new AbortController();

            // Wait for the delay, then check if this is still the latest request
            await new Promise((resolve, reject) => {
                const timeout = setTimeout(() => {
                    // Check if this request is still the latest one
                    if (rateLimiter.latestQuery === query) {
                        resolve();
                    } else {
                        reject(new Error('Request was superseded by a newer search'));
                    }
                }, delay);

                // Listen for abort signal
                abortController.signal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    reject(new Error('Request was superseded by a newer search'));
                });
            });

            // Now create the actual pending request
            rateLimiter.isProcessing = true;
            rateLimiter.pendingRequest = {
                requestId,
                query,
                model,
                timestamp: Date.now(),
                abortController: new AbortController()
            };

            return rateLimiter.pendingRequest.abortController.signal;
        }
    }

    // Mark a request as completed and check if there's a pending stalled request
    markRequestCompleted(sessionId, model, requestId) {
        const key = `${sessionId}_${model}`;
        const rateLimiter = this.sessionRateLimiters.get(key);
        if (!rateLimiter) return;

        // Remove completed request
        if (rateLimiter.pendingRequest && rateLimiter.pendingRequest.requestId === requestId) {
            rateLimiter.pendingRequest = null;
        }

        // Mark as not processing
        rateLimiter.isProcessing = false;
        rateLimiter.lastCompletedRequest = Date.now();
    }

    // Clean up old session+model rate limiters
    cleanupOldSessionRateLimiters() {
        let hasOldRequests = false;
        const now = Date.now();
        const maxAge = 300000; // 5 minutes

        for (const [key, rateLimiter] of this.sessionRateLimiters.entries()) {
            // Clean up old pending requests
            if (rateLimiter.pendingRequest && (now - rateLimiter.pendingRequest.timestamp > maxAge)) {
                if (rateLimiter.pendingRequest.abortController) {
                    rateLimiter.pendingRequest.abortController.abort();
                }
                rateLimiter.pendingRequest = null;
                hasOldRequests = true;
            }

            // Remove session+model if no active requests
            if (!rateLimiter.pendingRequest) {
                this.sessionRateLimiters.delete(key);
            }
        }
    }

    // Get rate limiting statistics for a specific session+model
    getSessionRateLimitingStats(sessionId, model) {
        const key = `${sessionId}_${model}`;
        const rateLimiter = this.sessionRateLimiters.get(key);
        if (!rateLimiter) {
            return {
                sessionId,
                model,
                hasRateLimiter: false,
                message: 'No rate limiter found for this session+model combination'
            };
        }

        const now = Date.now();
        return {
            sessionId,
            model,
            hasRateLimiter: true,
            lastCompletedRequest: rateLimiter.lastCompletedRequest,
            timeSinceLastCompleted: now - rateLimiter.lastCompletedRequest,
            isProcessing: rateLimiter.isProcessing,
            latestQuery: rateLimiter.latestQuery,
            pendingRequestCount: rateLimiter.pendingRequest ? 1 : 0,
            requestThrottleMs: this.requestThrottleMs,
            canProcessNext: (now - rateLimiter.lastCompletedRequest) >= this.requestThrottleMs
        };
    }

    // Get rate limiting statistics
    getRateLimitingStats() {
        const now = Date.now();
        const sessionModelStats = {};

        for (const [key, rateLimiter] of this.sessionRateLimiters.entries()) {
            sessionModelStats[key] = this.getSessionRateLimitingStats(rateLimiter.sessionId, rateLimiter.model);
        }

        return {
            totalSessionModels: this.sessionRateLimiters.size,
            requestThrottleMs: this.requestThrottleMs,
            sessionModelStats
        };
    }

    // Cancel pending requests for a specific session+model combination
    cancelSessionPendingRequests(sessionId, model) {
        const key = `${sessionId}_${model}`;
        const rateLimiter = this.sessionRateLimiters.get(key);
        if (!rateLimiter) return 0;

        let cancelledCount = 0;

        // Cancel pending request
        if (rateLimiter.pendingRequest) {
            if (rateLimiter.pendingRequest.abortController) {
                rateLimiter.pendingRequest.abortController.abort();
            }
            rateLimiter.pendingRequest = null;
            cancelledCount++;
        }

        // Mark as not processing
        rateLimiter.isProcessing = false;

        return cancelledCount;
    }

    // Cancel all pending requests across all session+model combinations
    cancelAllPendingRequests() {
        let totalCancelled = 0;

        for (const [key, rateLimiter] of this.sessionRateLimiters.entries()) {
            totalCancelled += this.cancelSessionPendingRequests(rateLimiter.sessionId, rateLimiter.model);
        }

        return totalCancelled;
    }

    // Cancel all active requests for a specific session
    cancelActiveRequestsForSession(sessionId) {
        let totalCancelled = 0;

        for (const [requestId, abortController] of this.activeRequests) {
            if (requestId && typeof requestId === 'string' && requestId.includes(sessionId)) {
                abortController.abort();
                this.activeRequests.delete(requestId);
                totalCancelled++;
            }
        }

        return totalCancelled;
    }

    // Cancel a specific active request
    cancelActiveRequest(requestId) {
        if (this.activeRequests.has(requestId)) {
            const abortController = this.activeRequests.get(requestId);
            abortController.abort();
            this.activeRequests.delete(requestId);
            return true;
        }
        return false;
    }

    // Search for characters and tags - Latest Request Wins Pattern
    async searchCharacters(query, model, ws = null, sessionId = null, abortSignal = null, requestId = null, autofillSessionId = null, options = {}) {
        const key = `${sessionId}_${model}`;
        const searchOptions = options || {};
        const previous = this.latestRequests.get(key);

        // Store the latest request (overwrites previous)
        this.latestRequests.set(key, {
            query,
            model,
            ws,
            sessionId,
            requestId,
            autofillSessionId: autofillSessionId || null,
            spellCheckText: searchOptions.spellCheckText || query,
            isContinuation: searchOptions.isContinuation === true,
            priorQuery: previous && previous.query ? previous.query : '',
            autofillSettings: normalizeAutofillSearchSettings(searchOptions.autofillSettings),
            timestamp: Date.now()
        });

        return await this.waitForSearchTurn(key, requestId);
    }

    async waitForSearchTurn(key, requestId) {
        while (true) {
            while (this.isProcessing.get(key)) {
                await new Promise(resolve => setTimeout(resolve, 15));
            }

            const latest = this.latestRequests.get(key);
            if (!latest) {
                return { results: [], spellCheck: null, processed: false, superseded: true };
            }

            // A newer search replaced this request before it could run
            if (latest.requestId !== requestId) {
                return { results: [], spellCheck: null, processed: false, superseded: true };
            }

            this.isProcessing.set(key, true);
            const capturedTimestamp = latest.timestamp;

            try {
                const result = await this.processLatestRequest(key);
                return { ...result, processed: true, superseded: false };
            } finally {
                this.isProcessing.set(key, false);

                const currentLatest = this.latestRequests.get(key);
                if (currentLatest && currentLatest.timestamp > capturedTimestamp) {
                    // A newer request arrived during processing; its caller will wait and run it
                }
            }
        }
    }

    // Process the latest request for a given key
    async processLatestRequest(key) {
        const latestRequest = this.latestRequests.get(key);
        if (!latestRequest) {
            return { results: [], spellCheck: null };
        }

        const { query, model, ws, sessionId, requestId, autofillSessionId, spellCheckText, isContinuation, priorQuery, autofillSettings } = latestRequest;
        const settings = normalizeAutofillSearchSettings(autofillSettings);
        const tagSearchQuery = this.truncateTagSearchQuery(query);
        const spellCheckInput = (spellCheckText || query || '').trim();

        this._searchPacketContext = {
            requestId: requestId || null,
            autofillSessionId: autofillSessionId || null
        };

        if (ws) {
            this.sendSearchWs(ws, {
                type: 'search_characters_response',
                data: { results: [], spellCheck: null },
                timestamp: new Date().toISOString()
            });
        }

        try {
            // Check if query starts with ! - only return text replacements in this case
            const isTextReplacementSearch = query.startsWith('!');

            // Check if query starts with "Text:" - only perform spell correction in this case
            const isTextPrefixSearch = query.startsWith('Text:');

            // Handle PICK suffix stripping for search but preserve in inserted text
            let searchQuery = query;
            let hasPickSuffix = false;

            if (query.startsWith('!')) {
                if (query.includes('~') || query.includes('~+')) {
                    // Extract the name between ! and ~ or ~+
                    const match = query.match(/^!([^~+]+)[~+]/);
                    if (match) {
                        searchQuery = match[1]; // Remove ! and suffix for searching
                        hasPickSuffix = true;
                    }
                } else {
                    // Just remove the ! prefix for searching
                    searchQuery = query.substring(1);
                }
            }

            let searchResults = [];
            let spellCheckData = null;

            if (!isTextReplacementSearch && !isTextPrefixSearch) {
                if (!settings.enabled) {
                    return { results: [], spellCheck: null };
                }

                const tagOptions = {
                    isContinuation: isContinuation,
                    priorQuery: priorQuery || '',
                    autofillSettings: settings
                };

                const runCharacters = this.performCharacterSearch(tagSearchQuery, model, ws, requestId).then(results => {
                    return results;
                }).catch(error => {
                    console.error('Character search error:', error);
                    if (ws) {
                        this.sendSearchWs(ws,{
                            type: 'search_results_update',
                            service: 'characters',
                            results: [],
                            isComplete: true,
                            timestamp: new Date().toISOString(),
                            requestId: requestId
                        });
                    }
                    return [];
                });

                const runTags = (settings.naiAnimeTags || settings.naiFurryTags || settings.dbAnimeTags || settings.dbFurryTags)
                    ? this.performTagSearch(tagSearchQuery, model, ws, sessionId, requestId, tagOptions).catch(error => {
                        console.error('Tag search error:', error);
                        return [];
                    })
                    : Promise.resolve([]);

                const runSpellcheck = settings.spellcheck
                    ? this.performSpellCheckAsync(spellCheckInput, ws, requestId).catch(error => {
                        console.error('Spellcheck error:', error);
                        return null;
                    })
                    : Promise.resolve(null);

                const runWordLookup = settings.thesaurus
                    ? runSpellcheck.then(spellCheckData =>
                        this.performWordLookupAsync(spellCheckInput, ws, requestId, spellCheckData)
                    ).catch(error => {
                        console.error('Word lookup error:', error);
                        return null;
                    })
                    : Promise.resolve(null);

                const runTextReplacements = this.performTextReplacementSearch(searchQuery, ws, hasPickSuffix, requestId).catch(error => {
                    console.error('Text replacement search error:', error);
                    if (ws) {
                        this.sendSearchWs(ws, {
                            type: 'search_results_update',
                            service: 'textReplacements',
                            results: [],
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        });
                    }
                    return [];
                });

                const [characterResults, tagResults, spellcheckData, wordLookupData, textReplacementResults] = await Promise.allSettled([
                    runCharacters,
                    runTags,
                    runSpellcheck,
                    runWordLookup,
                    runTextReplacements
                ]);

                // Extract results (handle any failures gracefully)
                if (characterResults.status === 'fulfilled') {
                    searchResults = [...searchResults, ...characterResults.value];
                }

                if (tagResults.status === 'fulfilled') {
                    searchResults = [...searchResults, ...tagResults.value];
                }

                if (spellcheckData.status === 'fulfilled') {
                    spellCheckData = spellcheckData.value;
                }

                if (textReplacementResults.status === 'fulfilled') {
                    searchResults = [...searchResults, ...textReplacementResults.value];
                }
            } else if (isTextReplacementSearch) {
                // Only perform text replacement search when query starts with !
                const textReplacementResults = await this.performTextReplacementSearch(searchQuery, ws, hasPickSuffix, requestId);

                // Add text replacement results to search results
                if (textReplacementResults && textReplacementResults.length > 0) {
                    searchResults = [...searchResults, ...textReplacementResults];
                }
            }

            // Handle "Text:" prefix - only perform spell checking
            if (isTextPrefixSearch) {
                const textAfterPrefix = query.substring(5).trim(); // Remove "Text:" prefix

                // Send initial status update for spellcheck service
                if (ws) {
                    this.sendSearchWs(ws,{
                        type: 'search_status_update',
                        services: [{ name: 'spellcheck', status: 'searching' }],
                        requestId: requestId
                    });
                }

                // Only perform spell checking for "Text:" searches
                try {
                    if (this.spellChecker && typeof this.spellChecker.checkText === 'function') {
                        spellCheckData = this.performSpellCheck(textAfterPrefix);

                        // Send spell check results separately if WebSocket is available
                        if (ws && spellCheckData) {
                            this.sendSearchWs(ws,{
                                type: 'search_results_update',
                                service: 'spellcheck',
                                results: [{
                                    type: 'spellcheck',
                                    data: spellCheckData,
                                    serviceOrder: -2, // Spell check comes before text replacements
                                    resultOrder: 0,
                                    serviceName: 'spellcheck'
                                }],
                                serviceOrder: -2,
                                isComplete: false,
                                requestId: requestId
                            });
                        }

                        // Send completion status for spellcheck service
                        if (ws) {
                            this.sendSearchWs(ws,{
                                type: 'search_status_update',
                                services: [{ name: 'spellcheck', status: 'completed' }],
                                requestId: requestId
                            });
                        }
                    }
                } catch (error) {
                    console.error('Spell check failed for Text: search:', error);
                    // Send error status for spellcheck service
                    if (ws) {
                        this.sendSearchWs(ws,{
                            type: 'search_status_update',
                            services: [{ name: 'spellcheck', status: 'error' }],
                            requestId: requestId
                        });
                    }
                    spellCheckData = null;
                }
            }


            // For text replacement searches, strip the ! character from the search query
            if (isTextReplacementSearch) {
                searchQuery = searchQuery.substring(1); // Remove the ! character
            }

            // Text replacements are now handled as an independent service above

            // Combine search results (text replacements are now included in searchResults)
            let allResults = [];
            if (!isTextPrefixSearch) {
                // Only include search results for non-"Text:" searches
                allResults = [...searchResults];
            }
            // For "Text:" searches, allResults remains empty (only spell check is performed)

            return {
                results: allResults,
                spellCheck: spellCheckData
            };
        } catch (error) {
            console.error('Character and tag search error:', error);
            throw error;
        } finally {
            this._searchPacketContext = null;
        }
    }

    // Search for presets
    async searchPresets(query) {
        try {
            if (!query || query.trim().length < 2) {
                return [];
            }

            const searchTerm = query.trim().toLowerCase();
            if (!globalResourcesInstance) return [];
            const presets = globalResourcesInstance.getPromptConfig({ path: 'presets' });
            if (!presets) return [];
            const results = [];

            // Search through presets
            Object.keys(currentPromptConfig.presets).forEach(presetName => {
                if (presetName.toLowerCase().includes(searchTerm)) {
                    const preset = currentPromptConfig.presets[presetName];
                    results.push({
                        name: presetName,
                        model: preset.model || 'v4_5',
                        resolution: preset.resolution || '',
                        upscale: preset.upscale || false,
                        allow_paid: preset.allow_paid || false,
                        variety: preset.variety || false,
                        character_prompts: preset.characterPrompts && preset.characterPrompts.length > 0,
                        base_image: !!(preset.image || preset.image_source)
                    });
                }
            });

            // Limit results to 10 items
            return results.slice(0, 10);
        } catch (error) {
            console.error('Preset search error:', error);
            throw error;
        }
    }

    // Add word to spell checker dictionary
    async addWordToDictionary(word) {
        try {
            if (!word || typeof word !== 'string') {
                throw new Error('Invalid word provided');
            }

            if (!this.spellChecker) {
                throw new Error('Spell checker not available');
            }

            const success = this.spellChecker.addCustomWord(word);

            if (success) {
                return { success: true, message: `Added "${word}" to custom words` };
            } else {
                throw new Error('Invalid word');
            }
        } catch (error) {
            console.error('Add custom word error:', error);
            throw error;
        }
    }

    // Private methods
    async performCharacterSearch(query, model, ws = null, requestId = null) {
        try {
            if (!query || query.trim().length < 2) {
                return [];
            }
            const characterDataArray = this.globalResources.getCharacterData();
            if (!characterDataArray || characterDataArray.length === 0) {
                throw new Error('Character data array not available');
            }


            const searchTerm = query.trim().toLowerCase();
            
            // ALWAYS search through character data array first and send results immediately
            // Split search term into words for flexible matching
            const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
            
            const characterResults = [];
            characterDataArray.forEach((character, index) => {
                if (!character.name) return;
                
                const characterNameLower = character.name.toLowerCase();
                const characterCopyrightLower = character.copyright ? character.copyright.toLowerCase() : '';
                
                // Check if all search words appear in name or copyright (in any order)
                const nameMatches = searchWords.every(word => characterNameLower.includes(word));
                const copyrightMatches = characterCopyrightLower ? searchWords.every(word => characterCopyrightLower.includes(word)) : false;
                
                // Also check if full search term appears as substring (for exact matches)
                const nameContains = characterNameLower.includes(searchTerm);
                const copyrightContains = characterCopyrightLower ? characterCopyrightLower.includes(searchTerm) : false;
                
                if (nameMatches || copyrightMatches || nameContains || copyrightContains) {
                    // Calculate similarity score
                    const nameSimilarity = this.calculateSimilarity(searchTerm, characterNameLower);
                    const copyrightSimilarity = characterCopyrightLower ? this.calculateSimilarity(searchTerm, characterCopyrightLower) : 0;
                    const maxSimilarity = Math.max(nameSimilarity, copyrightSimilarity);

                    characterResults.push({
                        type: 'character',
                        name: character.name,
                        character: character, // Include full character data
                        count: 5000, // Characters get medium priority
                        serviceOrder: 1, // Characters come before text replacements but after tags
                        resultOrder: index,
                        serviceName: 'characters',
                        similarity: maxSimilarity // Add similarity score for sorting
                    });
                }
            });

            // Sort character results by similarity (highest first)
            characterResults.sort((a, b) => b.similarity - a.similarity);

            // Send initial status update for characters service
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'characters', status: 'searching' }],
                    requestId: requestId
                });
            }

            // Send character results immediately if WebSocket is available
            // Always send results (even if empty) to ensure client receives them
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_results_update',
                    service: 'characters',
                    results: characterResults,
                    serviceOrder: 1,
                    isComplete: true,
                    timestamp: new Date().toISOString(),
                    requestId: requestId
                });
            }

            // Send completion status for characters service
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'characters', status: 'completed' }],
                    requestId: requestId
                });
            }

            // Return character results (tags are sent via WebSocket)
            return characterResults;
        } catch (error) {
            console.error('Character search error:', error);
            return [];
        }
    }

    processSearchResults(tagSuggestions, searchTerm) {
        // Convert tag suggestions to consistent format
        const tagResults = tagSuggestions.map((tag, index) => ({
            type: 'tag',
            name: tag.tag,
            count: tag.count,
            confidence: parseInt((tag.confidence * 100).toFixed(0)),
            model: tag.model,
            serviceOrder: 0,
            resultOrder: index,
            serviceName: tag.model
        }));

        // Search through character data array directly
        const characterResults = [];
        const characters = this.globalResources.getCharacterData();
        characters.forEach((character, index) => {
            if (character.name && character.name.toLowerCase().includes(searchTerm)) {
                // Calculate similarity score
                const nameSimilarity = this.calculateSimilarity(searchTerm, character.name.toLowerCase());
                const copyrightSimilarity = character.copyright ? this.calculateSimilarity(searchTerm, character.copyright.toLowerCase()) : 0;
                const maxSimilarity = Math.max(nameSimilarity, copyrightSimilarity);

                characterResults.push({
                    type: 'character',
                    name: character.name,
                    character: character,
                    count: 5000,
                    serviceOrder: 1,
                    resultOrder: index,
                    serviceName: 'characters',
                    similarity: maxSimilarity
                });
            }
        });

        // Sort character results by similarity (highest first)
        characterResults.sort((a, b) => b.similarity - a.similarity);

        return [...tagResults, ...characterResults];
    }

    normalizeNovelAiSuggestTagsResponse(raw) {
        if (!raw) {
            return { fromCache: false, tags: [] };
        }
        if (raw.fromCache === true && Array.isArray(raw.tags)) {
            return raw;
        }

        let tags = raw.tags;
        if (!Array.isArray(tags)) {
            if (Array.isArray(raw.results)) {
                tags = raw.results;
            } else if (Array.isArray(raw)) {
                tags = raw;
            } else {
                tags = [];
            }
        }

        const normalized = tags.map((t) => ({
            tag: String(t?.tag ?? t?.name ?? t?.tag_name ?? '').trim(),
            count: Number(t?.count ?? t?.n ?? t?.tag_count ?? 0) || 0,
            confidence: Number(t?.confidence ?? t?.c ?? 0) || 0
        })).filter((t) => t.tag);

        return { fromCache: false, tags: normalized };
    }

    async makeTagRequests(query, model, queryHash, ws = null, sessionId = null, requestId = null, options = {}) {
        const isContinuation = options.isContinuation === true;
        const priorQuery = options.priorQuery || '';
        const https = require('https');
        const tagSearchDatabase = this._getTagSearchDatabaseModule();
        const normalizedQuery = tagSearchDatabase && typeof tagSearchDatabase.normalizeTagSearchQuery === 'function'
            ? tagSearchDatabase.normalizeTagSearchQuery(query)
            : (query || '').trim().toLowerCase().replace(/\s+/g, ' ');

        const makeTagRequest = async (apiModel) => {
            let cachedResponse = this._lookupNovelAiTagCache(normalizedQuery, apiModel);
            if (isContinuation && (!cachedResponse || !cachedResponse.tags || cachedResponse.tags.length === 0)) {
                const prefixHit = this._lookupNovelAiTagPrefixCache(normalizedQuery, apiModel);
                if (prefixHit && prefixHit.tags && prefixHit.tags.length > 0) {
                    const grewBy = normalizedQuery.length - (priorQuery || '').trim().length;
                    if (grewBy >= 0 && grewBy <= 4) {
                        cachedResponse = prefixHit;
                    }
                }
            }
            if (cachedResponse && cachedResponse.tags && cachedResponse.tags.length > 0) {
                return cachedResponse;
            }

            // Use enhanced rate limiting with rolling window for API calls (only if sessionId and ws are provided)
            const localRequestId = `${apiModel}_${Date.now()}`;
            let abortSignal;

            if (sessionId && ws) {
                // Use rate limiting for WebSocket-based requests
                abortSignal = await this.throttleTagRequest(sessionId, normalizedQuery, apiModel, localRequestId, ws, { isContinuation });

                // Check if this request was aborted while waiting
                if (!abortSignal || abortSignal?.aborted) {
                    throw new Error('Request was superseded by a newer search');
                }
            } else {
                // For tool calls without WebSocket, create a simple abort signal that's never aborted
                const abortController = new AbortController();
                abortSignal = abortController.signal;
            }

            // Tripwire: block the outbound call while the service is locked.
            if (this.globalResources.getApiKeyManager().isServiceLocked('novelai')) {
                throw new Error('NovelAI is temporarily locked after repeated API errors. An admin must review the Service Key in the Security Center to unlock it.');
            }

            const url = `https://image.novelai.net/ai/generate-image/suggest-tags?model=${apiModel}&prompt=${encodeURIComponent(normalizedQuery)}`;
            const options = {
                method: 'GET',
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-US,en;q=0.9',
                    'authorization': `Bearer ${this._getNovelAiApiKey()}`,
                    'cache-control': 'no-cache',
                    'content-type': 'application/json',
                    'dnt': '1',
                    'sec-gpc': '1',
                    'user-agent': 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0',
                    'referer': 'https://novelai.net/',
                    'origin': 'https://novelai.net',
                    'pragma': 'no-cache',
                    'priority': 'u=1, i',
                    'sec-ch-ua': '"Not)A;Brand";v="8", "Chromium";v="138", "Google Chrome";v="138"',
                    'sec-ch-ua-mobile': '?0',
                    'sec-ch-ua-platform': '"Windows"',
                    'sec-fetch-dest': 'empty',
                    'sec-fetch-mode': 'cors',
                    'sec-fetch-site': 'same-site'
                }
            };

            return new Promise((resolve, reject) => {
                // Check if request was aborted before starting
                if (!abortSignal || abortSignal?.aborted) {
                    reject(new Error('Request was superseded by a newer search'));
                    return;
                }

                // Double-check abort signal is still valid
                if (abortSignal.aborted) {
                    reject(new Error('Request was superseded by a newer search'));
                    return;
                }

                const urlObj = new URL(url);
                const req = https.request({
                    hostname: urlObj.hostname,
                    port: 443,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: options.headers
                }, (res) => {
                    let data = [];
                    res.on('data', chunk => {
                        // Check if request was aborted before processing data
                        if (abortSignal.aborted) {
                            // Request was aborted, no need to process data
                            return;
                        }
                        data.push(chunk);
                    });

                    res.on('error', (error) => {
                        // Check if request was aborted before handling response error
                        if (abortSignal.aborted) {
                            // Request was aborted, no need to handle response error
                            return;
                        }
                        // Clean up pending request
                        this.markRequestCompleted(sessionId, apiModel, requestId);
                        reject(new Error(`Response error: ${error.message}`));
                    });

                    res.on('end', () => {
                        // Check if request was aborted before processing response
                        if (abortSignal.aborted) {
                            // Request was aborted, no need to process response
                            return;
                        }

                        const buffer = Buffer.concat(data);
                        if (res.statusCode === 200) {
                            try {
                                const response = JSON.parse(buffer.toString());
                                // Clean up pending request
                                this.markRequestCompleted(sessionId, apiModel, requestId);
                                this.globalResources.getApiKeyManager().recordApiSuccess('novelai');
                                resolve(this.normalizeNovelAiSuggestTagsResponse(response));
                            } catch (e) {
                                // Clean up pending request
                                this.markRequestCompleted(sessionId, apiModel, requestId);
                                console.log(`❌ Request for ${apiModel} failed: Invalid JSON response`);
                                reject(new Error('Invalid JSON response from NovelAI API'));
                            }
                        } else {
                            // Clean up pending request
                            this.markRequestCompleted(sessionId, apiModel, requestId);
                            this.globalResources.getApiKeyManager().recordApiFailure('novelai', res.statusCode, `HTTP ${res.statusCode}`);
                            console.log(`❌ Request for ${apiModel} failed: HTTP ${res.statusCode}`);
                            reject(new Error(`Tag suggestion API error: HTTP ${res.statusCode}`));
                        }
                    });
                });

                // Timeout after 5 seconds
                const timeout = setTimeout(() => {
                    // Check if request was aborted before destroying
                    if (abortSignal.aborted) {
                        // Request was already aborted, no need to destroy or reject
                        return;
                    }
                    req.destroy();
                    // Clean up pending request
                    this.markRequestCompleted(sessionId, apiModel, requestId);
                    reject(new Error('Tag suggestion API request timed out after 5 seconds'));
                }, 5000);

                req.on('error', error => {
                    clearTimeout(timeout);
                    // Check if this was an abort error
                    if (abortSignal.aborted) {
                        // Request was aborted, no need to reject or clean up
                        return;
                    }
                    // Clean up pending request
                    this.markRequestCompleted(sessionId, apiModel, requestId);
                    reject(error);
                });

                req.on('close', () => {
                    clearTimeout(timeout);
                    // Check if this was an abort close
                    if (abortSignal.aborted) {
                        // Request was aborted, no need to clean up
                        return;
                    }
                    // Request closed normally, no action needed
                });

                // Listen for abort signal
                abortSignal.addEventListener('abort', () => {
                    clearTimeout(timeout);
                    req.destroy();
                    // Clean up pending request
                    this.markRequestCompleted(sessionId, apiModel, requestId);
                    reject(new Error('Request was superseded by a newer search'));
                });

                req.end();
            });
        };

        try {
            // Determine models to query
            // Map model string (e.g., 'v4_5') to API model name (e.g., 'nai-diffusion-4-5-full')
            const currentModel = this.globalResources.getNekoAiService('Model')[model.toUpperCase()] || 'nai-diffusion-4-5-full';

            // Get models to query for API calls
            let models = [currentModel];
            if (currentModel !== 'nai-diffusion-furry-3') {
                models.push('nai-diffusion-furry-3');
            }

            const settings = options.autofillSettings || null;
            if (settings) {
                models = models.filter((apiModel) => {
                    if (apiModel === 'nai-diffusion-furry-3') {
                        return settings.naiFurryTags !== false;
                    }
                    return settings.naiAnimeTags !== false;
                });
            }

            const animeLocalService = this.tagAutofillSearch?.getAnimeLocalServiceName?.() || 'anime-local';
            const furryLocalService = this.tagAutofillSearch?.getFurryLocalServiceName?.() || 'furry-local';
            const includeDbAnime = !settings || settings.dbAnimeTags !== false;
            const includeDbFurry = !settings || settings.dbFurryTags !== false;

            // Send initial status update for all services (API + local)
            if (ws) {
                const allServices = [
                    ...models.map(m => ({ name: m, status: 'stalled' })),
                ];
                if (includeDbAnime) {
                    allServices.push({ name: animeLocalService, status: 'searching' });
                }
                if (includeDbFurry) {
                    allServices.push({ name: furryLocalService, status: 'searching' });
                }
                if (allServices.length > 0) {
                    this.sendSearchWs(ws,{
                        type: 'search_status_update',
                        services: allServices,
                        requestId: requestId
                    });
                }
            }

            // Local search runs immediately; do not wait for NovelAI API before streaming local results
            const localTagsPromise = (includeDbAnime || includeDbFurry)
                ? this.makeLocalDatasetTagRequests(normalizedQuery, currentModel, queryHash, ws, requestId, {
                    ...options,
                    includeDbAnime,
                    includeDbFurry
                }).catch(error => {
                    console.error('❌ Local dataset tag search error:', error.message);
                    return [];
                })
                : Promise.resolve([]);

            const processApiModel = async (apiModel, serviceOrder) => {
                try {
                    const cacheHit = !!this._lookupNovelAiTagCache(normalizedQuery, apiModel);

                    if (ws) {
                        this.sendSearchWs(ws, {
                            type: 'search_status_update',
                            services: [{ name: apiModel, status: cacheHit ? 'completed' : 'searching' }],
                            requestId: requestId
                        });
                    }

                    const response = await makeTagRequest(apiModel);
                    const fromCache = !!response?.fromCache;
                    const processedTags = [];

                    if (response && response.tags) {
                        const tagsToCache = [];

                        response.tags.forEach(tag => {
                            const invertedConfidence = fromCache
                                ? (tag.confidence ?? 0.95)
                                : (1 - (tag.confidence ?? 0));
                            const displayConfidence = parseInt((invertedConfidence * 100).toFixed(0));

                            if (!fromCache) {
                                tagsToCache.push({
                                    tag: tag.tag,
                                    count: tag.count,
                                    confidence: invertedConfidence
                                });
                            }

                            processedTags.push({
                                tag: tag.tag,
                                count: tag.count,
                                confidence: displayConfidence,
                                model: apiModel,
                                searchModel: apiModel
                            });
                        });

                        if (!fromCache && tagsToCache.length > 0) {
                            this._persistNovelAiTagCache(normalizedQuery, apiModel, tagsToCache);
                        }
                    }

                    if (ws) {
                        const modelResults = processedTags.map((tag, index) => ({
                            type: 'tag',
                            name: tag.tag,
                            count: tag.count,
                            confidence: tag.confidence,
                            model: apiModel,
                            searchModel: apiModel,
                            serviceOrder,
                            resultOrder: index,
                            serviceName: apiModel
                        }));

                        this.sendSearchWs(ws, {
                            type: 'search_results_update',
                            service: apiModel,
                            results: modelResults,
                            serviceOrder,
                            isComplete: false,
                            requestId: requestId
                        });

                        this.sendSearchWs(ws, {
                            type: 'search_status_update',
                            services: [{ name: apiModel, status: 'completed' }],
                            requestId: requestId
                        });
                    }

                    return processedTags;
                } catch (error) {
                    if (error && error.message === 'Request was superseded by a newer search') {
                        return [];
                    }
                    console.error(`❌ Tag suggestion API error for ${apiModel}:`, error.message);
                    if (ws) {
                        this.sendSearchWs(ws, {
                            type: 'search_status_update',
                            services: [{ name: apiModel, status: 'error', error: error.message }],
                            requestId: requestId
                        });
                    }
                    return [];
                }
            };

            const apiTagBatches = await Promise.all(
                models.map((apiModel, i) => processApiModel(apiModel, i))
            );
            const allTags = apiTagBatches.flat();

            // Local results stream on their own schedule; do not block completion on local DB work
            if (ws) {
                const localServiceCount = (includeDbAnime ? 1 : 0) + (includeDbFurry ? 1 : 0);
                const totalServices = models.length + localServiceCount;
                if (totalServices > 0) {
                    this.sendSearchWs(ws, {
                        type: 'search_results_complete',
                        totalServices: totalServices,
                        completedServices: totalServices,
                        requestId: requestId
                    });
                }
            }

            const localTags = await localTagsPromise;
            return [...allTags, ...localTags];
        } catch (error) {
            // Check if this was a cancellation due to being superseded
            if (error && error.message === 'Request was superseded by a newer search') {
                return [];
            }

            // Handle actual API errors
            console.error('❌ Tag suggestion API error:', error.message);
            return [];
        }
    }

    generateQueryHash(query, model) {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(`${query.toLowerCase()}_${model.toLowerCase()}`).digest('hex');
    }

    async makeLocalDatasetTagRequests(query, model, queryHash, ws = null, requestId = null, options = {}) {
        const animeLocalService = this.tagAutofillSearch?.getAnimeLocalServiceName?.() || 'anime-local';
        const furryLocalService = this.tagAutofillSearch?.getFurryLocalServiceName?.() || 'furry-local';
        const settings = options.autofillSettings || null;
        const maxResults = settings?.maxResults || 35;
        const includeDbAnime = options.includeDbAnime !== false && (!settings || settings.dbAnimeTags !== false);
        const includeDbFurry = options.includeDbFurry !== false && (!settings || settings.dbFurryTags !== false);

        const markLocalServiceComplete = (serviceName, status) => {
            if (!ws) return;
            this.sendSearchWs(ws, {
                type: 'search_status_update',
                services: [{ name: serviceName, status: status || 'completed-none' }],
                requestId: requestId
            });
        };

        if (!includeDbAnime && !includeDbFurry) {
            return [];
        }

        const sendLocalStream = (serviceName, tags, isComplete, mergeBodyPreviews = false) => {
            if (!ws || !this.tagAutofillSearch) return;
            const wsResults = tags.map((tag, index) =>
                this.tagAutofillSearch.formatWebSocketResult(tag, index, model)
            );
            this.sendSearchWs(ws,{
                type: 'search_results_update',
                service: serviceName,
                searchModel: model,
                results: wsResults,
                serviceOrder: 0,
                isComplete: isComplete,
                mergeBodyPreviews: mergeBodyPreviews,
                requestId: requestId
            });
            if (isComplete && !mergeBodyPreviews) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: serviceName, status: 'completed' }],
                    requestId: requestId
                });
            }
        };

        try {
            if (!this.tagAutofillSearch) {
                throw new Error('Tag autofill search not available');
            }

            const tags = await this.tagAutofillSearch.searchTags(query, { limit: maxResults });
            const { anime, furry } = this.tagAutofillSearch.splitLocalServices(tags);

            if (includeDbAnime) {
                sendLocalStream(animeLocalService, anime, true);
            } else {
                markLocalServiceComplete(animeLocalService, 'completed-none');
            }
            if (includeDbFurry) {
                sendLocalStream(furryLocalService, furry, true);
            } else {
                markLocalServiceComplete(furryLocalService, 'completed-none');
            }

            return [
                ...(includeDbAnime ? anime : []),
                ...(includeDbFurry ? furry : [])
            ];
        } catch (error) {
            console.error('❌ Local tag search error:', error.message);

            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [
                        { name: animeLocalService, status: 'error', error: error.message },
                        { name: furryLocalService, status: 'error', error: error.message }
                    ],
                    requestId: requestId
                });
            }

            return [];
        }
    }

    async sendLocalTagBodyPreviews(anime, furry, animeLocalService, furryLocalService, model, ws, requestId, autofillSessionId = null, options = {}) {
        if (!ws || !this.tagAutofillSearch) {
            return;
        }

        const sessionId = autofillSessionId || this._searchPacketContext?.autofillSessionId || null;
        const skipAttach = options.skipAttach === true;

        const seen = new Set();
        const toEnrich = [];
        for (const tag of [...anime, ...furry]) {
            if (!tag || !tag.id || seen.has(tag.id) || !tag.hasWiki) {
                continue;
            }
            seen.add(tag.id);
            toEnrich.push(tag);
        }

        if (toEnrich.length === 0) {
            return;
        }

        if (!skipAttach) {
            await this.tagAutofillSearch.attachBodyPreviewsToTags(toEnrich);
        }

        const bodyById = new Map();
        for (const tag of toEnrich) {
            if (tag.id != null && tag.primaryBody) {
                bodyById.set(tag.id, tag.primaryBody);
            }
        }
        for (const tag of [...anime, ...furry]) {
            if (tag.id != null && bodyById.has(tag.id)) {
                tag.primaryBody = bodyById.get(tag.id);
            }
        }

        const sendLocalStream = (serviceName, tags) => {
            const wsResults = tags.map((tag, index) =>
                this.tagAutofillSearch.formatWebSocketResult(tag, index, model)
            );
            this.sendSearchWs(ws, {
                type: 'search_results_update',
                service: serviceName,
                searchModel: model,
                results: wsResults,
                serviceOrder: 0,
                isComplete: true,
                mergeBodyPreviews: true,
                requestId: requestId,
                autofillSessionId: sessionId
            });
        };

        sendLocalStream(animeLocalService, anime);
        sendLocalStream(furryLocalService, furry);
    }

    async fetchAutofillWikiPreviews(tagIds, model, ws, requestId, autofillSessionId, settings) {
        if (!ws || !this.tagAutofillSearch) {
            return;
        }
        await this.ensureServicesInitialized();
        const resolved = normalizeAutofillSearchSettings(settings);
        if (!resolved.wikiPreviews) {
            return;
        }

        const tags = this.tagAutofillSearch.getTagsByIdsForAutofill(tagIds, { limit: resolved.maxResults });
        if (!tags.length) {
            return;
        }

        await this.tagAutofillSearch.attachBodyPreviewsToTags(tags);
        const { anime, furry } = this.tagAutofillSearch.splitLocalServices(tags);
        const animeLocalService = this.tagAutofillSearch.getAnimeLocalServiceName();
        const furryLocalService = this.tagAutofillSearch.getFurryLocalServiceName();
        const mappedModel = this.globalResources.getNekoAiService('Model')[(model || '').toUpperCase()] || model || 'nai-diffusion-4-5-full';

        const sendMergedPreviews = async (animeTags, furryTags) => {
            const bodyById = new Map();
            for (const tag of [...animeTags, ...furryTags]) {
                if (tag && tag.id != null && tag.primaryBody) {
                    bodyById.set(tag.id, tag.primaryBody);
                }
            }
            if (bodyById.size === 0) {
                return;
            }
            const withBodies = (list) => list.filter(tag => tag && tag.id != null && bodyById.has(tag.id));
            if (resolved.dbAnimeTags !== false && animeTags.length > 0) {
                const batch = withBodies(animeTags);
                if (batch.length > 0) {
                    await this.sendLocalTagBodyPreviews(batch, [], animeLocalService, furryLocalService, mappedModel, ws, requestId, autofillSessionId, { skipAttach: true });
                }
            }
            if (resolved.dbFurryTags !== false && furryTags.length > 0) {
                const batch = withBodies(furryTags);
                if (batch.length > 0) {
                    await this.sendLocalTagBodyPreviews([], batch, animeLocalService, furryLocalService, mappedModel, ws, requestId, autofillSessionId, { skipAttach: true });
                }
            }
        };

        await sendMergedPreviews(anime, furry);
    }

    calculateSimilarity(searchTerm, text) {
        // Simple similarity calculation based on:
        // 1. Exact match at start (highest priority)
        // 2. Contains the search term
        // 3. Length difference (shorter is better)

        if (text.startsWith(searchTerm)) {
            return 100 - (text.length - searchTerm.length); // Exact start match
        }

        if (text.includes(searchTerm)) {
            const index = text.indexOf(searchTerm);
            return 50 - index - (text.length - searchTerm.length); // Contains match, closer to start is better
        }

        return 0; // No match
    }

    performSpellCheck(query) {
        if (!this.spellChecker) {
            return null;
        }

        // Ensure the spell checker has the required method
        if (typeof this.spellChecker.checkText !== 'function') {
            console.error('Spell checker checkText method not available');
            return null;
        }

        try {
            // Use the spell checker's checkText method which returns the format we need
            const spellCheckResult = this.spellChecker.checkText(query);

            return {
                hasErrors: spellCheckResult.hasErrors,
                misspelled: spellCheckResult.misspelled,
                suggestions: spellCheckResult.suggestions,
                originalText: spellCheckResult.originalText,
                wordPositions: spellCheckResult.wordPositions
            };
        } catch (error) {
            console.error('Error performing spell check:', error);
            return null;
        }
    }

    searchTextReplacements(searchQuery, hasPickSuffix) {
        // Access text replacements from globalResources instance
        if (!this.globalResources) return [];
        const textReplacements = this.globalResources.getPromptConfig({ path: 'text_replacements' });
        if (!textReplacements) return [];

        const results = [];

        for (const [key, value] of Object.entries(textReplacements)) {
            const keyToSearch = key;
            let matchScore = 0;
            let matchType = 'none';

            // If searchQuery is empty (just ! was typed), return all items
            if (searchQuery === '') {
                matchScore = 50; // Default score for empty query
                matchType = 'all';
            } else {
                const searchLower = searchQuery.toLowerCase();
                const keyLower = keyToSearch.toLowerCase();

                // Search in key name
                if (keyLower === searchLower) {
                    matchScore = 100;
                    matchType = 'exact_key';
                } else if (keyLower.startsWith(searchLower)) {
                    matchScore = 90;
                    matchType = 'key_starts_with';
                } else if (keyLower.includes(searchLower)) {
                    matchScore = 70;
                    matchType = 'key_contains';
                }

                // Search in replacement content
                if (typeof value === 'string') {
                    const valueLower = value.toLowerCase();
                    if (valueLower === searchLower) {
                        matchScore = Math.max(matchScore, 95);
                        matchType = 'exact_content';
                    } else if (valueLower.startsWith(searchLower)) {
                        matchScore = Math.max(matchScore, 85);
                        matchType = 'content_starts_with';
                    } else if (valueLower.includes(searchLower)) {
                        matchScore = Math.max(matchScore, 65);
                        matchType = 'content_contains';
                    }
                } else if (Array.isArray(value)) {
                    // Search in array values
                    for (const item of value) {
                        if (typeof item === 'string') {
                            const itemLower = item.toLowerCase();
                            if (itemLower === searchLower) {
                                matchScore = Math.max(matchScore, 95);
                                matchType = 'exact_array_content';
                                break;
                            } else if (itemLower.startsWith(searchLower)) {
                                matchScore = Math.max(matchScore, 85);
                                matchType = 'array_content_starts_with';
                            } else if (itemLower.includes(searchLower)) {
                                matchScore = Math.max(matchScore, 65);
                                matchType = 'array_content_contains';
                            }
                        }
                    }
                }
            }

            // Only include results that have a match
            if (matchScore > 0) {
                results.push({
                    type: 'textReplacement',
                    name: key,
                    description: value,
                    placeholder: key, // The placeholder name like !NAME or !NAME~
                    // If we searched with ~ suffix, ensure the result preserves it
                    displayName: hasPickSuffix ? `${key}~` : key,
                    matchScore: matchScore,
                    matchType: matchType,
                    // Include the actual replacement value for display
                    replacementValue: typeof value === 'string' ? value : (Array.isArray(value) ? value.join(', ') : String(value))
                });
            }
        }

        // Sort by match score (highest first)
        results.sort((a, b) => b.matchScore - a.matchScore);

        // Internal NAX expanders (!NAX_FAV_* / !NAX_TRY_* per dataset)
        if (this.globalResources && this.globalResources.getNaxTagsDatabase) {
            const naxDb = this.globalResources.getNaxTagsDatabase();
            const internal = naxDb.getInternalNaxTextReplacements();
            const searchLower = searchQuery === '' ? '' : searchQuery.toLowerCase();

            for (const entry of internal) {
                let matchScore = 0;
                let matchType = 'none';
                const keyLower = entry.key.toLowerCase();
                const labelLower = String(entry.label || '').toLowerCase();
                const descLower = String(entry.description || '').toLowerCase();
                const kindLabel = entry.type === 'TRY' ? 'try mark' : entry.type === 'ANY' ? 'any tag' : 'favorite';

                if (searchQuery === '') {
                    matchScore = 45;
                    matchType = 'nax_all';
                } else if (keyLower === searchLower) {
                    matchScore = 100;
                    matchType = 'exact_key';
                } else if (keyLower.startsWith(searchLower)) {
                    matchScore = 92;
                    matchType = 'key_starts_with';
                } else if (keyLower.includes(searchLower)) {
                    matchScore = 72;
                    matchType = 'key_contains';
                } else if (labelLower.includes(searchLower) || descLower.includes(searchLower)) {
                    matchScore = 60;
                    matchType = 'label_contains';
                }

                if (matchScore > 0) {
                    results.push({
                        type: 'textReplacement',
                        name: entry.key,
                        description: entry.description || `Random ${kindLabel} from ${entry.label}`,
                        placeholder: entry.key,
                        displayName: hasPickSuffix ? `${entry.key}~` : entry.key,
                        matchScore,
                        matchType,
                        replacementValue: entry.description || `Random ${kindLabel} (${entry.label})`,
                        naxInternal: true
                    });
                }
            }

            results.sort((a, b) => b.matchScore - a.matchScore);
        }

        return results;
    }

    // New helper method for independent text replacement search
    async performTextReplacementSearch(query, ws = null, hasPickSuffix = false, requestId = null) {
        try {
            if (!query || query.trim().length < 1) {
                return [];
            }

            // Send initial status update for textReplacements service
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'textReplacements', status: 'searching' }],
                    requestId: requestId
                });
            }

            const results = this.searchTextReplacements(query, hasPickSuffix);

            // Send results immediately for real-time display (like other services)
            if (ws) {
                const message = {
                    type: 'search_results_update',
                    service: 'textReplacements',
                    results: results,
                    isComplete: true,
                    timestamp: new Date().toISOString(),
                    requestId: requestId
                };
                this.sendSearchWs(ws, message);

                // Send completion status for textReplacements service
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'textReplacements', status: 'completed' }],
                    requestId: requestId
                });
            }

            return results;
        } catch (error) {
            console.error('Text replacement search error:', error);

            // Send error status for textReplacements service
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'textReplacements', status: 'error' }],
                    requestId: requestId
                });
            }

            return [];
        }
    }

    // New helper method for independent tag search
    async performTagSearch(query, model, ws = null, sessionId = null, requestId = null, options = {}) {
        const tagOptions = options || {};
        // Lazy-load tag search services if not already loaded
        await this.ensureServicesInitialized();

        try {
            if (!query || query.trim().length < 2) {
                return [];
            }

            const tagDb = this._getTagSearchDatabaseModule();
            const normalizedQuery = tagDb && typeof tagDb.normalizeTagSearchQuery === 'function'
                ? tagDb.normalizeTagSearchQuery(query)
                : (query || '').trim().toLowerCase().replace(/\s+/g, ' ');
            const queryHash = this.generateQueryHash(normalizedQuery, model);
            const tagResults = await this.makeTagRequests(normalizedQuery, model, queryHash, ws, sessionId, requestId, options);
            return tagResults;
        } catch (error) {
            console.error('Tag search error:', error);
            return [];
        }
    }

    // New helper method for independent spellcheck
    async performSpellCheckAsync(query, ws = null, requestId = null) {
        try {
            if (!this.spellChecker || typeof this.spellChecker.checkText !== 'function') {
                return null;
            }

            // Send initial status update for spellcheck service
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'spellcheck', status: 'searching' }],
                    requestId: requestId
                });
            }

            const spellCheckData = this.performSpellCheck(query);

            if (ws) {
                if (spellCheckData && spellCheckData.hasErrors) {
                    this.sendSearchWs(ws,{
                        type: 'search_results_update',
                        service: 'spellcheck',
                        results: [{
                            type: 'spellcheck',
                            data: spellCheckData,
                            serviceOrder: -2,
                            resultOrder: 0,
                            serviceName: 'spellcheck'
                        }],
                        serviceOrder: -2,
                        isComplete: true,
                        timestamp: new Date().toISOString(),
                        requestId: requestId
                    });
                } else {
                    this.sendSearchWs(ws,{
                        type: 'search_results_update',
                        service: 'spellcheck',
                        results: [],
                        isComplete: true,
                        timestamp: new Date().toISOString(),
                        requestId: requestId
                    });
                }
            }

            // Send completion status for spellcheck service
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{
                        name: 'spellcheck',
                        status: spellCheckData && spellCheckData.hasErrors ? 'completed' : 'completed-noerrors'
                    }],
                    requestId: requestId
                });
            }

            return spellCheckData;
        } catch (error) {
            console.error('Spell check failed:', error);

            // Send error status for spellcheck service
            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'spellcheck', status: 'error' }],
                    requestId: requestId
                });
            }

            return null;
        }
    }

    async performWordLookupAsync(query, ws = null, requestId = null, spellCheckData = null) {
        try {
            await this.ensureServicesInitialized();

            if (!this.wordLookupService || typeof this.wordLookupService.lookupQuery !== 'function') {
                if (ws) {
                    this.sendSearchWs(ws,{
                        type: 'search_status_update',
                        services: [{ name: 'wordLookup', status: 'completed-none' }],
                        requestId: requestId
                    });
                }
                return null;
            }

            const parsed = this.wordLookupService.parseWordLookupQuery(query);
            if (!parsed) {
                if (ws) {
                    this.sendSearchWs(ws,{
                        type: 'search_results_update',
                        service: 'wordLookup',
                        results: [],
                        isComplete: true,
                        timestamp: new Date().toISOString(),
                        requestId: requestId
                    });
                    this.sendSearchWs(ws,{
                        type: 'search_status_update',
                        services: [{ name: 'wordLookup', status: 'completed-none' }],
                        requestId: requestId
                    });
                }
                return null;
            }

            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'wordLookup', status: 'searching' }],
                    requestId: requestId
                });
            }

            const lookupData = await this.wordLookupService.lookupQuery(query, spellCheckData);

            if (ws && lookupData && lookupData.hasData) {
                this.sendSearchWs(ws,{
                    type: 'search_results_update',
                    service: 'wordLookup',
                    results: [{
                        type: 'wordLookup',
                        data: lookupData,
                        serviceOrder: -1,
                        resultOrder: 0,
                        serviceName: 'wordLookup'
                    }],
                    serviceOrder: -1,
                    isComplete: true,
                    timestamp: new Date().toISOString(),
                    requestId: requestId
                });
            } else if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_results_update',
                    service: 'wordLookup',
                    results: [],
                    isComplete: true,
                    timestamp: new Date().toISOString(),
                    requestId: requestId
                });
            }

            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{
                        name: 'wordLookup',
                        status: lookupData && lookupData.hasData ? 'completed' : 'completed-none'
                    }],
                    requestId: requestId
                });
            }

            return lookupData;
        } catch (error) {
            console.error('Word lookup failed:', error);

            if (ws) {
                this.sendSearchWs(ws,{
                    type: 'search_status_update',
                    services: [{ name: 'wordLookup', status: 'error' }],
                    requestId: requestId
                });
            }

            return null;
        }
    }

    _getNovelAiApiKey() {
        try {
            const apiKeyManager = this.globalResources.getApiKeyManager();
            const managedKey = apiKeyManager && typeof apiKeyManager.getActiveApiKey === 'function'
                ? apiKeyManager.getActiveApiKey('novelai')
                : null;
            if (managedKey) {
                return managedKey;
            }
        } catch (e) {
            // fall through to config.json
        }

        if (globalResourcesInstance) {
            const config = globalResourcesInstance.getConfig({ path: 'apiKey' });
            if (config) {
                return config;
            }
        }

        return require('../config.json').apiKey;
    }
}

// Helper function to get config for API calls (used by SearchService)
function getConfig(options) {
    if (globalResourcesInstance) {
        return globalResourcesInstance.getConfig(options);
    }
    const config = require('../config.json');
    if (options && options.path) {
        return config[options.path];
    }
    return config;
}

// NOTE: This module requires globalResources to be set before SearchService can be instantiated
// TODO: Consider migrating this module to a class that takes globalResources in constructor
let globalResourcesInstance = null;

function setGlobalResources(gr) {
    globalResourcesInstance = gr;
}

module.exports = {
    SearchService,
    // For circular dependency resolution
    setGlobalResources
};
