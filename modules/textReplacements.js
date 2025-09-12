const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const SpellChecker = require('./spellChecker');
const FurryTagSearch = require('./furryTagSearch');
const AnimeTagSearch = require('./animeTagSearch');

// Generate UUID for presets
function generateUUID() {
    return crypto.randomUUID();
}

// Load character data for auto-complete
let characterDataArray = [];
try {
    const characterDataPath = path.join(__dirname, '../characters.json');
    if (fs.existsSync(characterDataPath)) {
        const data = JSON.parse(fs.readFileSync(characterDataPath, 'utf8'));
        characterDataArray = data.data || [];
        console.log(`✅ Loaded ${characterDataArray.length} characters for auto-complete`);
    } else {
        console.log('⚠️  Character data file not found, auto-complete disabled');
    }
} catch (error) {
    console.error('❌ Error loading character data:', error.message);
    process.exit(1);
}
// Dynamic prompt config loading
let promptConfig = null;
let promptConfigLastModified = 0;

function loadPromptConfig() {
    const promptConfigPath = './prompt.config.json';
    
    if (!fs.existsSync(promptConfigPath)) {
        console.error('prompt.config.json not found');
        process.exit(1);
    }
    
    const stats = fs.statSync(promptConfigPath);
    if (stats.mtime.getTime() > promptConfigLastModified) {
        try {
            const configData = fs.readFileSync(promptConfigPath, 'utf8');
            promptConfig = JSON.parse(configData);
            promptConfigLastModified = stats.mtime.getTime();
            
            // Ensure all presets have UUIDs and target_workspace
            if (promptConfig.presets) {
                let configChanged = false;
                Object.keys(promptConfig.presets).forEach(presetName => {
                    const preset = promptConfig.presets[presetName];
                    if (!preset.uuid) {
                        preset.uuid = generateUUID();
                        configChanged = true;
                    }
                    if (!preset.target_workspace) {
                        preset.target_workspace = 'default';
                        configChanged = true;
                    }
                });
                
                // Save the updated config if changes were made
                if (configChanged) {
                    savePromptConfig(promptConfig);
                }
            }
        } catch (error) {
            console.error('❌ Error reloading prompt config:', error.message);
            if (!promptConfig) {
                process.exit(1);
            }
        }
    }
    
    return promptConfig;
}

function savePromptConfig(config) {
    const promptConfigPath = './prompt.config.json';
    
    try {
        const configData = JSON.stringify(config, null, 2);
        fs.writeFileSync(promptConfigPath, configData, 'utf8');
        
        // Update our cached config and timestamp
        promptConfig = config;
        const stats = fs.statSync(promptConfigPath);
        promptConfigLastModified = stats.mtime.getTime();
        
        return true;
    } catch (error) {
        console.error('❌ Error saving prompt config:', error.message);
        return false;
    }
}

// Utility function for random selection
const getReplacementValue = value => Array.isArray(value) ? value[Math.floor(Math.random() * value.length)] : value;

// Text replacement functions
const applyTextReplacements = (text, presetName, model = null) => {
    const currentPromptConfig = loadPromptConfig();
    if (!text || !currentPromptConfig.text_replacements) return text;
    
    let result = text.replace(/!PRESET_NAME/g, presetName);
    
    // Handle PICK replacements (using ~ suffix)
    result = result.replace(/!([a-zA-Z0-9_]+)~/g, (match, name) => {
        const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key => 
            key.startsWith(name) && key !== name
        );
        if (matchingKeys.length === 0) throw new Error(`No text replacements found starting with: ${name}`);
        return getReplacementValue(currentPromptConfig.text_replacements[matchingKeys[Math.floor(Math.random() * matchingKeys.length)]]);
    });
    
    // Handle regular replacements with word boundary approach
    const foundKeys = new Set();
    let match;
    const keyPattern = /!([a-zA-Z0-9_]+)(?=[,\s|\[\]{}:]|$)/g;
    while ((match = keyPattern.exec(text)) !== null) {
        foundKeys.add(match[1]);
    }
    
    for (const baseKey of foundKeys) {
        // Use word boundary to ensure we match the exact key
        const pattern = new RegExp(`!${baseKey.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'g');
        if (model && currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`]) {
            result = result.replace(pattern, getReplacementValue(currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`]));
        } else if (currentPromptConfig.text_replacements[baseKey]) {
            result = result.replace(pattern, getReplacementValue(currentPromptConfig.text_replacements[baseKey]));
        }
    }
    
    const remainingReplacements = result.match(/![^~\s]+~/g);
    if (remainingReplacements?.length > 0) {
        throw new Error(`Invalid text replacement: ${remainingReplacements.join(', ')}`);
    }
    
    return result;
};

const getUsedReplacements = (text, model = null) => {
    const currentPromptConfig = loadPromptConfig();
    if (!text || !currentPromptConfig.text_replacements) return [];
    
    const usedKeys = [];
    if (text.includes('!PRESET_NAME')) usedKeys.push('PRESET_NAME');
    
    // PICK replacements (using ~ suffix)
    let pickMatch;
    const pickPattern = /!([a-zA-Z0-9_]+)~/g;
    while ((pickMatch = pickPattern.exec(text)) !== null) {
        const matchingKeys = Object.keys(currentPromptConfig.text_replacements).filter(key => 
            key.startsWith(pickMatch[1]) && key !== pickMatch[1]
        );
        if (matchingKeys.length > 0) usedKeys.push(`${pickMatch[1]}~ (${matchingKeys.length} options)`);
    }
    
    // Regular replacements
    const foundKeys = new Set();
    let match;
    const keyPattern = /!([a-zA-Z0-9_]+)(?=[,\s|\[\]{}:]|$)/g;
    while ((match = keyPattern.exec(text)) !== null) {
        foundKeys.add(match[1]);
    }
    
    for (const baseKey of foundKeys) {
        if (baseKey === 'PRESET_NAME') continue;
        if (model && currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`]) {
            const value = currentPromptConfig.text_replacements[`${baseKey}_${model.toUpperCase()}`];
            usedKeys.push(`${baseKey}${Array.isArray(value) ? ` (${model.toUpperCase()}, random)` : ` (${model.toUpperCase()})`}`);
        } else if (currentPromptConfig.text_replacements[baseKey]) {
            const value = currentPromptConfig.text_replacements[baseKey];
            usedKeys.push(`${baseKey}${Array.isArray(value) ? ' (random)' : ''}`);
        }
    }
    
    return usedKeys;
};
// Search functionality module
class SearchService {
    constructor(context = {}) {
        this.spellChecker = new SpellChecker();
        this.furryTagSearch = new FurryTagSearch();
        this.animeTagSearch = new AnimeTagSearch();
        this.context = context;
        
        // Session-based rate limiting with rolling window
        this.sessionRateLimiters = new Map(); // Track rate limiters by session ID
        this.requestThrottleMs = 1000; // 1000ms between completed requests
        
        // Track active requests for cancellation
        this.activeRequests = new Map(); // Track active requests by requestId
        
        // Latest request tracking for "latest wins" pattern
        this.latestRequests = new Map(); // Track latest request per session+model
        this.isProcessing = new Map(); // Track if processing is active per session+model
        
        // Start cleanup timer for old session rate limiters
        setInterval(() => {
            this.cleanupOldSessionRateLimiters();
        }, 60000); // Clean up every minute
    }

    setContext(context) {
        this.context = context;
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

    // Simple rate limiting: Only process the last request, discard expired ones
    async throttleTagRequest(sessionId, query, model, requestId, ws = null) {
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
        
        // Check if we can process this request immediately
        const timeSinceLastCompleted = now - rateLimiter.lastCompletedRequest;
        const canProcessImmediately = !rateLimiter.isProcessing && timeSinceLastCompleted >= this.requestThrottleMs;
        
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
            const delay = this.requestThrottleMs - timeSinceLastCompleted;
            
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
    async searchCharacters(query, model, ws = null, sessionId = null, abortSignal = null) {
        const key = `${sessionId}_${model}`;
        
        // Store the latest request (overwrites previous)
        this.latestRequests.set(key, {
            query,
            model,
            ws,
            sessionId,
            timestamp: Date.now()
        });
        
        // If already processing, just return (latest request will be processed after current completes)
        if (this.isProcessing.get(key)) {
            return { results: [], spellCheck: null };
        }
        
        // Mark as processing
        this.isProcessing.set(key, true);
        
        // Store the timestamp of the request we're about to process
        const currentRequest = this.latestRequests.get(key);
        const requestTimestamp = currentRequest ? currentRequest.timestamp : Date.now();
        
        try {
            return await this.processLatestRequest(key);
        } finally {
            // Mark as not processing
            this.isProcessing.set(key, false);
            
            // Check if there's a newer request waiting
            const currentLatest = this.latestRequests.get(key);
            if (currentLatest && currentLatest.timestamp > requestTimestamp) {
                // Process the newer request
                this.isProcessing.set(key, true);
                try {
                    await this.processLatestRequest(key);
                } finally {
                    this.isProcessing.set(key, false);
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
        
        const { query, model, ws, sessionId } = latestRequest;
        
        try {
            // Check if query starts with ! - only return text replacements in this case
            const isTextReplacementSearch = query.startsWith('!');
            
            // Check if query starts with "Text:" - only perform spell correction in this case
            const isTextPrefixSearch = query.startsWith('Text:');

            let searchResults = [];
            let spellCheckData = null;

            if (!isTextReplacementSearch && !isTextPrefixSearch) {
                // Start all services independently and send results as they complete
                
                // Start character search as independent service
                const characterPromise = this.performCharacterSearch(query, model, ws).then(results => {
                    // Send character results immediately when ready
                    if (ws && results && results.length > 0) {
                        const message = {
                            type: 'search_results_update',
                            service: 'characters',
                            results: results,
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        };
                        ws.send(JSON.stringify(message));
                    } else if (ws) {
                        // Send empty results to clear previous results
                        const message = {
                            type: 'search_results_update',
                            service: 'characters',
                            results: [],
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        };
                        ws.send(JSON.stringify(message));
                    }
                    return results;
                }).catch(error => {
                    console.error('Character search error:', error);
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'search_results_update',
                            service: 'characters',
                            results: [],
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        }));
                    }
                    return [];
                });
                
                // Start tag search as independent service
                const tagPromise = this.performTagSearch(query, model, ws, sessionId).then(results => {
                    // Send tag results immediately when ready
                    if (ws && results && results.length > 0) {
                        const message = {
                            type: 'search_results_update',
                            service: model, // Use model name as service name for tags
                            results: results,
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        };
                        ws.send(JSON.stringify(message));
                    } else if (ws) {
                        // Send empty results to clear previous results
                        const message = {
                            type: 'search_results_update',
                            service: model,
                            results: [],
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        };
                        ws.send(JSON.stringify(message));
                    }
                    return results;
                }).catch(error => {
                    console.error('Tag search error:', error);
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'search_results_update',
                            service: model,
                            results: [],
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        }));
                    }
                    return [];
                });
                
                // Start spellcheck as independent service
                const spellcheckPromise = this.performSpellCheckAsync(query, ws).then(results => {
                    // Send spellcheck results immediately when ready
                    if (ws && results) {
                        ws.send(JSON.stringify({
                            type: 'search_results_update',
                            service: 'spellcheck',
                            results: [{
                                type: 'spellcheck',
                                data: results,
                                serviceOrder: -2,
                                resultOrder: 0,
                                serviceName: 'spellcheck'
                            }],
                            isComplete: true,
                            timestamp: new Date().toISOString()
                        }));
                    }
                    return results;
                }).catch(error => {
                    console.error('Spellcheck error:', error);
                    return null;
                });
                
                // Wait for all services to complete (they run concurrently)
                const [characterResults, tagResults, spellcheckData] = await Promise.allSettled([
                    characterPromise,
                    tagPromise,
                    spellcheckPromise
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
            }
            
            // Handle "Text:" prefix - only perform spell checking
            if (isTextPrefixSearch) {
                const textAfterPrefix = query.substring(5).trim(); // Remove "Text:" prefix
                
                // Send initial status update for spellcheck service
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'search_status_update',
                        services: [{ name: 'spellcheck', status: 'searching' }]
                    }));
                }
                
                // Only perform spell checking for "Text:" searches
                try {
                    if (this.spellChecker && typeof this.spellChecker.checkText === 'function') {
                        spellCheckData = this.performSpellCheck(textAfterPrefix);
                        
                        // Send spell check results separately if WebSocket is available
                        if (ws && spellCheckData) {
                            ws.send(JSON.stringify({
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
                                isComplete: false
                            }));
                        }
                        
                        // Send completion status for spellcheck service
                        if (ws) {
                            ws.send(JSON.stringify({
                                type: 'search_status_update',
                                services: [{ name: 'spellcheck', status: 'completed' }]
                            }));
                        }
                    }
                } catch (error) {
                    console.error('Spell check failed for Text: search:', error);
                    // Send error status for spellcheck service
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'search_status_update',
                            services: [{ name: 'spellcheck', status: 'error' }]
                        }));
                    }
                    spellCheckData = null;
                }
            }

            // Handle PICK suffix stripping for search but preserve in inserted text
            let searchQuery = query;
            let hasPickSuffix = false;

            if (query.startsWith('!') && query.includes('~')) {
                // Extract the name between ! and ~
                const match = query.match(/^!([^~]+)~/);
                if (match) {
                    searchQuery = match[1]; // Remove ! and ~ for searching
                    hasPickSuffix = true;
                }
            }

            // For text replacement searches, strip the ! character from the search query
            if (isTextReplacementSearch) {
                searchQuery = searchQuery.substring(1); // Remove the ! character
            }

            // Search through text replacements (only for non-"Text:" searches)
            let textReplacementResults = [];
            if (!isTextPrefixSearch) {
                // Send initial status update for textReplacements service
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'search_status_update',
                        services: [{ name: 'textReplacements', status: 'searching' }]
                    }));
                }
                
                textReplacementResults = this.searchTextReplacements(searchQuery, hasPickSuffix);
                
                // Send text replacement results update
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'search_results_update',
                        service: 'textReplacements',
                        results: textReplacementResults,
                        isComplete: true,
                        timestamp: new Date().toISOString()
                    }));
                }
                
                // Send completion status for textReplacements service
                if (ws) {
                    ws.send(JSON.stringify({
                        type: 'search_status_update',
                        services: [{ name: 'textReplacements', status: 'completed' }]
                    }));
                }
            }

            // Combine search results with text replacement results
            let allResults = [];
            if (!isTextPrefixSearch) {
                // Only include search results and text replacements for non-"Text:" searches
                allResults = [...searchResults, ...textReplacementResults];
            }
            // For "Text:" searches, allResults remains empty (only spell check is performed)

            return {
                results: allResults,
                spellCheck: spellCheckData
            };
        } catch (error) {
            console.error('Character and tag search error:', error);
            throw error;
        }
    }

    // Search for presets
    async searchPresets(query) {
        try {
            if (!query || query.trim().length < 2) {
                return [];
            }

            const searchTerm = query.trim().toLowerCase();
            const currentPromptConfig = loadPromptConfig();
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
    async performCharacterSearch(query, model, ws = null) {
        try {
            if (!query || query.trim().length < 2) {
                return [];
            }
            if (!model || model.trim().length < 2) {
                return [];
            }

            // Check if required context is available
            if (!this.context.Model) {
                throw new Error('Model not available in context');
            }
            if (!this.context.config) {
                throw new Error('Config not available in context');
            }
            if (!characterDataArray) {
                throw new Error('Character data array not available in context');
            }

            // Check if model exists
            const Model = this.context.Model;
            if (!Model || !Model[model.toUpperCase()]) {
                return [];
            }

            const searchTerm = query.trim().toLowerCase();
            const queryHash = this.generateQueryHash(searchTerm, model);
            
            // Cache is available as instance property
            if (!characterDataArray) {
                return [];
            }

            // ALWAYS search through character data array first and send results immediately
            const characterResults = [];
            characterDataArray.forEach((character, index) => {
                if (character.name && character.name.toLowerCase().includes(searchTerm)) {
                    // Calculate similarity score
                    const nameSimilarity = this.calculateSimilarity(searchTerm, character.name.toLowerCase());
                    const copyrightSimilarity = character.copyright ? this.calculateSimilarity(searchTerm, character.copyright.toLowerCase()) : 0;
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
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'characters', status: 'searching' }]
                }));
            }
            
            // Send character results immediately if WebSocket is available
            if (ws && characterResults.length > 0) {
                ws.send(JSON.stringify({
                    type: 'search_results_update',
                    service: 'characters',
                    results: characterResults,
                    serviceOrder: 1,
                    isComplete: false
                }));
            }
            
            // Send completion status for characters service
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'characters', status: 'completed' }]
                }));
            }
            
            // Return character results (tags are sent via WebSocket)
            return characterResults;
        } catch (error) {
            console.error('Character search error:', error);
            return [];
        }
    }

    processSearchResults(tagSuggestions, characterDataArray, searchTerm) {
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
        characterDataArray.forEach((character, index) => {
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
                    serviceOrder: 1, // Updated to match the main function
                    resultOrder: index,
                    serviceName: 'characters',
                    similarity: maxSimilarity // Add similarity score
                });
            }
        });
        
        // Sort character results by similarity (highest first)
        characterResults.sort((a, b) => b.similarity - a.similarity);
        
        return [...tagResults, ...characterResults];
    }

    async makeTagRequests(query, model, queryHash, ws = null, sessionId = null) {
        const https = require('https');
        const config = this.context.config;
        
        const makeTagRequest = async (apiModel) => {
            // Check cache first for this specific model
            if (this.context.tagSuggestionsCache.isQueryCached(query, apiModel)) {
                const cachedTags = this.context.tagSuggestionsCache.getCachedQuery(query, apiModel);
                return {
                    tags: cachedTags.map(tag => ({
                        tag: tag.tag,
                        count: tag.count,
                        confidence: tag.confidence || 0.95
                    }))
                };
            }
            
            // Use enhanced rate limiting with rolling window for API calls
            const requestId = `${apiModel}_${Date.now()}`;
            const abortSignal = await this.throttleTagRequest(sessionId, query, apiModel, requestId, ws);
            
            // Check if this request was aborted while waiting
            if (!abortSignal || abortSignal?.aborted) {
                throw new Error('Request was superseded by a newer search');
            }
            
            const url = `https://image.novelai.net/ai/generate-image/suggest-tags?model=${apiModel}&prompt=${encodeURIComponent(query)}`;
            const options = {
                method: 'GET',
                headers: {
                    'accept': '*/*',
                    'accept-language': 'en-US,en;q=0.9',
                    'authorization': `Bearer ${config.apiKey}`,
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
                                resolve(response);
                            } catch (e) {
                                // Clean up pending request
                                this.markRequestCompleted(sessionId, apiModel, requestId);
                                console.log(`❌ Request for ${apiModel} failed: Invalid JSON response`);
                                reject(new Error('Invalid JSON response from NovelAI API'));
                            }
                        } else {
                            // Clean up pending request
                            this.markRequestCompleted(sessionId, apiModel, requestId);
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
            const currentModel = this.context.Model[model.toUpperCase()] || 'nai-diffusion-4-5-full';

            // Get models to query for API calls
            let models = [currentModel];
            if (currentModel !== 'nai-diffusion-furry-3') {
                models.push('nai-diffusion-furry-3');
            }
                        
            // Send initial status update for all services (API + local)
            if (ws) {
                const allServices = [
                    ...models.map(m => ({ name: m, status: 'stalled' })),
                    { name: 'furry-local', status: 'searching' },
                    { name: 'anime-local', status: 'searching' }
                ];
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: allServices
                }));
            }
            
            // Start local services immediately (they're fast and don't need rate limiting)
            const localServices = [
                { name: 'furry-local', method: () => this.makeLocalFurryTagRequests(query, currentModel, queryHash, ws) },
                { name: 'anime-local', method: () => this.makeLocalAnimeTagRequests(query, currentModel, queryHash, ws) }
            ];
            
            // Run local services concurrently
            const localPromises = localServices.map(async (service) => {
                try {
                    const results = await service.method();
                    // Local services handle their own WebSocket communication
                    return results;
                } catch (error) {
                    console.error(`❌ Local ${service.name} search error:`, error);
                    // Send error status for local service
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'search_status_update',
                            services: [{ name: service.name, status: 'error', error: error.message }]
                        }));
                    }
                    return [];
                }
            });
            
            // Start all API calls concurrently - no sequential waiting
            const allTags = [];
            const queryTagObjs = [];
            
            for (let i = 0; i < models.length; i++) {
                const apiModel = models[i];
                
                try {
                    // Send status update for this model
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'search_status_update',
                            services: [{ name: apiModel, status: 'searching' }]
                        }));
                    }
                    
                    const response = await makeTagRequest(apiModel);
                    
                    if (response && response.tags) {
                        const modelTagIds = []; // Collect tag IDs for this model
                        
                        response.tags.forEach(tag => {
                            // Store tag in new cache system
                            // NovelAI API returns confidence where lower = more confident, so we invert it
                            // Store the inverted confidence (0-1 range) in cache
                            const invertedConfidence = 1 - tag.confidence;
                            const tagData = {
                                tag: tag.tag,
                                count: tag.count,
                                confidence: invertedConfidence,
                                model: apiModel
                            };
                            
                            const tagId = this.context.tagSuggestionsCache.addTag(apiModel, tagData);
                            modelTagIds.push(tagId); // Collect the tag ID
                            
                            // Store object with tag data for later processing
                            // Use the inverted confidence (0-100 range) for display
                            queryTagObjs.push({ 
                                tag: tag.tag,
                                count: tag.count,
                                confidence: parseInt((invertedConfidence * 100).toFixed(0)),
                                model: apiModel,
                                searchModel: apiModel
                            });
                            
                            allTags.push({
                                ...tag,
                                model: apiModel,
                                searchModel: apiModel
                            });
                        });
                        
                        // Store query results for this model immediately
                        if (modelTagIds.length > 0) {
                            this.context.tagSuggestionsCache.storeQueryResults(query, apiModel, modelTagIds);
                        }
                    }
                    
                    // Send results for this model immediately with ordering info
                    if (ws) {
                        const modelResults = response?.tags?.map((tag, index) => ({
                            type: 'tag',
                            name: tag.tag,
                            count: tag.count,
                            confidence: parseInt((tag.confidence * 100).toFixed(0)),
                            model: apiModel,
                            searchModel: apiModel,
                            serviceOrder: i, // Order of service (0 = first, 1 = second, etc.)
                            resultOrder: index, // Order within this service's results
                            serviceName: apiModel
                        }));
                        
                        ws.send(JSON.stringify({
                            type: 'search_results_update',
                            service: apiModel,
                            results: modelResults,
                            serviceOrder: i,
                            isComplete: false
                        }));
                    }
                    
                    // Send completion status for this model
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'search_status_update',
                            services: [{ name: apiModel, status: 'completed' }]
                        }));
                    }
                    
                } catch (error) {
                    // Check if this was a cancellation due to being superseded
                    if (error && error.message === 'Request was superseded by a newer search') {
                        continue;
                    }
                    
                    // Handle actual API errors
                    console.error(`❌ Tag suggestion API error for ${apiModel}:`, error.message);
                    
                    // Send error status for this model
                    if (ws) {
                        ws.send(JSON.stringify({
                            type: 'search_status_update',
                            services: [{ name: apiModel, status: 'error', error: error.message }]
                        }));
                    }
                }
            }
            
            // Wait for local services to complete
            const localResults = await Promise.all(localPromises);
            
            // Send final completion signal for all services
            if (ws) {
                const totalServices = models.length + localServices.length;
                ws.send(JSON.stringify({
                    type: 'search_results_complete',
                    totalServices: totalServices,
                    completedServices: totalServices
                }));
            }
            
            // Query results are already stored in cache per model above
            
            // Combine API and local results
            const combinedResults = [...allTags, ...localResults.flat()];
            return combinedResults;
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

    async makeLocalFurryTagRequests(query, model, queryHash, ws = null) {
        try {
            // Send initial status update
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'furry-local', status: 'searching' }]
                }));
            }
            
            // Use local furry tag search
            const furryResults = this.furryTagSearch.searchTags(query);
            const allTags = [];
            
            if (furryResults.length > 0) {
                furryResults.forEach((tag, index) => {
                    allTags.push({
                        tag: tag.tag,
                        count: tag.n_count,
                        confidence: tag.confidence,
                        model: 'furry-local',
                        searchModel: model,
                        category: tag.e_category,
                        e_count: tag.e_count,
                    });
                });
            }
            
            // Send results for furry search immediately
            if (ws && furryResults.length > 0) {
                const furryModelResults = furryResults.map((tag, index) => ({
                    type: 'tag',
                    name: tag.tag,
                    count: tag.n_count,
                    e_count: tag.e_count,
                    confidence: tag.confidence,
                    model: 'furry-local',
                    searchModel: model,
                    category: tag.e_category,
                    serviceOrder: 0,
                    resultOrder: index,
                    serviceName: 'furry-local'
                }));
                
                ws.send(JSON.stringify({
                    type: 'search_results_update',
                    service: 'furry-local',
                    searchModel: model,
                    results: furryModelResults,
                    serviceOrder: 0,
                    isComplete: false
                }));
            }
            
            // Send completion status for furry search
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'furry-local', status: 'completed' }]
                }));
            }
            
            return allTags;
            
        } catch (error) {
            console.error(`❌ Furry tag search error:`, error.message);
            
            // Send error status for furry search
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'furry-local', status: 'error', error: error.message }]
                }));
            }
            
            return [];
        }
    }

    async makeLocalAnimeTagRequests(query, model, queryHash, ws = null) {
        try {
            // Send initial status update
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'anime-local', status: 'searching' }]
                }));
            }
            
            // Use local anime tag search
            const animeResults = this.animeTagSearch.searchTags(query);
            const allTags = [];
            
            if (animeResults.length > 0) {
                animeResults.forEach((tag, index) => {
                    allTags.push({
                        tag: tag.tag,
                        count: tag.n_count,
                        confidence: tag.confidence,
                        model: 'anime-local',
                        searchModel: model,
                        category: tag.d_category,
                        d_count: tag.d_count,
                    });
                });
            }
            
            // Send results for anime search immediately
            if (ws && animeResults.length > 0) {
                const animeModelResults = animeResults.map((tag, index) => ({
                    type: 'tag',
                    name: tag.tag,
                    count: tag.n_count,
                    d_count: tag.d_count,
                    confidence: tag.confidence,
                    model: 'anime-local',
                    searchModel: model,
                    category: tag.d_category,
                    serviceOrder: 0,
                    resultOrder: index,
                    serviceName: 'anime-local'
                }));
                
                ws.send(JSON.stringify({
                    type: 'search_results_update',
                    service: 'anime-local',
                    searchModel: model,
                    results: animeModelResults,
                    serviceOrder: 0,
                    isComplete: false
                }));
            }
            
            // Send completion status for anime search
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'anime-local', status: 'completed' }]
                }));
            }
            
            return allTags;
            
        } catch (error) {
            console.error(`❌ Anime tag search error:`, error.message);
            
            // Send error status for anime search
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'anime-local', status: 'error', error: error.message }]
                }));
            }
            
            return [];
        }
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
        // Access optionsData from context
        const currentPromptConfig = loadPromptConfig();
        const textReplacements = currentPromptConfig.text_replacements;
        
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
        
        return results;
    }

    // New helper method for independent tag search
    async performTagSearch(query, model, ws = null, sessionId = null) {
        try {
            if (!query || query.trim().length < 2) {
                return [];
            }

            // Always make API requests for tags (cache checking happens in each makeTagRequest)
            const queryHash = this.generateQueryHash(query.trim().toLowerCase(), model);            
            const tagResults = await this.makeTagRequests(query, model, queryHash, ws, sessionId);
            return tagResults;
        } catch (error) {
            console.error('Tag search error:', error);
            return [];
        }
    }

    // New helper method for independent spellcheck
    async performSpellCheckAsync(query, ws = null) {
        try {
            if (!this.spellChecker || typeof this.spellChecker.checkText !== 'function') {
                return null;
            }

            // Send initial status update for spellcheck service
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'spellcheck', status: 'searching' }]
                }));
            }

            // Perform spell checking
            const spellCheckData = this.performSpellCheck(query);
            
            // Send spell check results separately if WebSocket is available
            if (ws && spellCheckData && spellCheckData.hasErrors) {
                ws.send(JSON.stringify({
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
                    isComplete: false
                }));
            }
            
            // Send completion status for spellcheck service
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'spellcheck', status: 'completed' }]
                }));
            }

            return spellCheckData;
        } catch (error) {
            console.error('Spell check failed:', error);
            
            // Send error status for spellcheck service
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: [{ name: 'spellcheck', status: 'error' }]
                }));
            }
            
            return null;
        }
    }
}

module.exports = {
    loadPromptConfig,
    savePromptConfig,
    getReplacementValue,
    applyTextReplacements,
    getUsedReplacements,
    generateUUID,
    SearchService
}; 