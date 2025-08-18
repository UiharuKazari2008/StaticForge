const fs = require('fs');
const path = require('path');
const { getPresetCacheKey, getCachedPreset } = require('./cache');
const SpellChecker = require('./spellChecker');
const FurryTagSearch = require('./furryTagSearch');
const AnimeTagSearch = require('./animeTagSearch');

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
        this.lastRequestTime = 0;
        this.requestQueue = [];
        this.isProcessingQueue = false;
    }

    setContext(context) {
        this.context = context;
    }

    // Search for characters and tags
    async searchCharacters(query, model, ws = null) {
        try {
            // Check if query starts with ! - only return text replacements in this case
            const isTextReplacementSearch = query.startsWith('!');
            
            // Check if query starts with "Text:" - only perform spell correction in this case
            const isTextPrefixSearch = query.startsWith('Text:');

            let searchResults = [];
            let spellCheckData = null;

            if (!isTextReplacementSearch && !isTextPrefixSearch) {
                // Start all services independently - no waiting for each other
                
                // Start character search as independent service
                const characterPromise = this.performCharacterSearch(query, model, ws);
                
                // Start tag search as independent service
                const tagPromise = this.performTagSearch(query, model, ws);
                
                // Start spellcheck as independent service
                const spellcheckPromise = this.performSpellCheckAsync(query, ws);
                
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
                if (ws && textReplacementResults.length > 0) {
                    ws.send(JSON.stringify({
                        type: 'search_results_update',
                        service: 'textReplacements',
                        results: textReplacementResults
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
            if (!this.context.tagSuggestionsCache) {
                throw new Error('Tag suggestions cache not available in context');
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
            
            // Get caches from context
            const tagSuggestionsCache = this.context.tagSuggestionsCache;
            
            if (!tagSuggestionsCache || !characterDataArray) {
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

            // Initialize model in cache if not exists
            if (!tagSuggestionsCache.queries[model]) {
                tagSuggestionsCache.queries[model] = {};
            }
            
            // Check cache for this query
            let tagSuggestions = [];
            let cacheHit = false;
            
            if (tagSuggestionsCache.queries[model][queryHash]) {
                // Get tags from cache using stored objects (key, model, confidence)
                const tagObjs = tagSuggestionsCache.queries[model][queryHash];
                tagSuggestions = tagObjs.map(obj => {
                    const tag = tagSuggestionsCache.tags[obj.key];
                    if (tag) {
                        return {
                            ...tag,
                            model: obj.model,
                            searchModel: obj.searchModel,
                            confidence: obj.confidence
                        };
                    }
                    return null;
                }).filter(Boolean);
                cacheHit = true;
                
                // Send cached tag results as individual model services (not as a single cached_tags service)
                if (ws && tagSuggestions.length > 0) {
                    // Group results by model
                    const resultsByModel = {};
                    tagSuggestions.forEach(tag => {
                        if (!resultsByModel[tag.model]) {
                            resultsByModel[tag.model] = [];
                        }
                        resultsByModel[tag.model].push(tag);
                    });
                    
                    // Send each model's results separately
                    Object.entries(resultsByModel).forEach(([modelName, modelResults], modelIndex) => {
                        const tagResults = modelResults.map((tag, index) => ({
                            type: 'tag',
                            name: tag.tag,
                            count: tag.count,
                            confidence: tag.confidence,
                            model: tag.model,
                            searchModel: tag.searchModel,
                            serviceOrder: modelIndex,
                            resultOrder: index,
                            serviceName: tag.model
                        }));
                        
                        ws.send(JSON.stringify({
                            type: 'search_results_update',
                            service: modelName,
                            results: tagResults,
                            serviceOrder: modelIndex,
                            isComplete: false
                        }));
                    });
                }
            }
            
            // Only make API requests if no cache hit
            let apiResults = [];
            if (!cacheHit) {
                apiResults = await this.makeTagRequests(query, model, tagSuggestionsCache, queryHash, ws);
                tagSuggestions = apiResults;
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
            confidence: parseInt(((1 - tag.confidence) * 100).toFixed(0)),
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

    async makeTagRequests(query, model, tagSuggestionsCache, queryHash, ws = null) {
        const https = require('https');
        const config = this.context.config;
        
        const makeTagRequest = async (apiModel) => {
            // Rate limiting: only allow one request every 500ms
            const now = Date.now();
            const timeSinceLastRequest = now - this.lastRequestTime;
            
            if (timeSinceLastRequest < 500) {
                const delay = 500 - timeSinceLastRequest;
                await new Promise(resolve => setTimeout(resolve, delay));
            }
            
            this.lastRequestTime = Date.now();
            
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
                const urlObj = new URL(url);
                const req = https.request({
                    hostname: urlObj.hostname,
                    port: 443,
                    path: urlObj.pathname + urlObj.search,
                    method: 'GET',
                    headers: options.headers
                }, (res) => {
                    let data = [];
                    res.on('data', chunk => data.push(chunk));
                    res.on('end', () => {
                        const buffer = Buffer.concat(data);
                        if (res.statusCode === 200) {
                            try {
                                const response = JSON.parse(buffer.toString());
                                resolve(response);
                            } catch (e) {
                                reject(new Error('Invalid JSON response from NovelAI API'));
                            }
                        } else {
                            reject(new Error(`Tag suggestion API error: HTTP ${res.statusCode}`));
                        }
                    });
                });

                // Timeout after 5 seconds
                const timeout = setTimeout(() => {
                    req.destroy();
                    reject(new Error('Tag suggestion API request timed out after 5 seconds'));
                }, 5000);

                req.on('error', error => {
                    clearTimeout(timeout);
                    reject(error);
                });

                req.on('close', () => {
                    clearTimeout(timeout);
                });

                req.end();
            });
        };
        
        try {
            // Determine models to query
            const currentModel = this.context.Model[model.toUpperCase()] || 'nai-diffusion-4-5-full';

            // Always start furry local search as a separate service (no caching)
            this.makeLocalFurryTagRequests(query, currentModel, tagSuggestionsCache, queryHash, ws);

            // Always start anime local search as a separate service (no caching)
            this.makeLocalAnimeTagRequests(query, currentModel, tagSuggestionsCache, queryHash, ws);

            // Get models to query
            let models = [currentModel];
            if (currentModel !== 'nai-diffusion-furry-3') {
                models.push('nai-diffusion-furry-3');
            }
                        
            // Send initial status update for API models
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_status_update',
                    services: models.map(m => ({ name: m, status: 'stalled' }))
                }));
            }
            
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
                        response.tags.forEach(tag => {
                            const tagKey = this.generateTagKey(tag.tag);
                            
                            // Update or create tag in cache
                            if (!tagSuggestionsCache.tags[tagKey]) {
                                tagSuggestionsCache.tags[tagKey] = {
                                    tag: tag.tag,
                                    models: [],
                                    count: tag.count
                                };
                            }
                            
                            // Add model if not already present
                            if (!tagSuggestionsCache.tags[tagKey].models.some(m => m.model === apiModel)) {
                                tagSuggestionsCache.tags[tagKey].models.push({
                                    model: apiModel,
                                    count: tag.count,
                                    confidence: parseInt(((1 - tag.confidence) * 100).toFixed(0))
                                });
                            }
                            
                            // Update count to highest
                            tagSuggestionsCache.tags[tagKey].count = Math.max(tagSuggestionsCache.tags[tagKey].count, tag.count);
                            
                            // Store object with key, model, and confidence
                            queryTagObjs.push({ key: tagKey, model: apiModel, searchModel: apiModel, confidence: parseInt(((1 - tag.confidence) * 100).toFixed(0)) });
                            allTags.push({
                                ...tag,
                                model: apiModel,
                                searchModel: apiModel,
                                tagKey: tagKey
                            });
                        });
                    }
                    
                    // Send results for this model immediately with ordering info
                    if (ws && response && response.tags) {
                        const modelResults = response.tags.map((tag, index) => ({
                            type: 'tag',
                            name: tag.tag,
                            count: tag.count,
                            confidence: parseInt(((1 - tag.confidence) * 100).toFixed(0)),
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
            
            // Send final completion signal for API services
            if (ws) {
                ws.send(JSON.stringify({
                    type: 'search_results_complete',
                    totalServices: models.length,
                    completedServices: models.length
                }));
            }
            
            // Store query in cache as array of objects (API results only)
            tagSuggestionsCache.queries[model][queryHash] = [...queryTagObjs];
            
            // Mark cache as dirty and schedule save
            if (this.context.cacheDirty !== undefined) {
                this.context.cacheDirty = true;
                if (this.context.scheduleCacheSave) {
                    this.context.scheduleCacheSave();
                }
            }
            
            return allTags;
        } catch (error) {
            console.error('❌ Tag suggestion API error:', error.message);
            return [];
        }
    }

    generateTagKey(tagName) {
        return tagName.toLowerCase().replace(/[^a-z0-9]/g, '');
    }

    generateQueryHash(query, model) {
        const crypto = require('crypto');
        return crypto.createHash('md5').update(`${query.toLowerCase()}_${model.toLowerCase()}`).digest('hex');
    }

    async makeLocalFurryTagRequests(query, model, tagSuggestionsCache, queryHash, ws = null) {
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
            const queryTagObjs = [];
            
            if (furryResults.length > 0) {
                furryResults.forEach((tag, index) => {
                    const tagKey = this.generateTagKey(tag.tag);
                    
                    // Update or create tag in cache
                    if (!tagSuggestionsCache.tags[tagKey]) {
                        tagSuggestionsCache.tags[tagKey] = {
                            tag: tag.tag,
                            searchModel: 'nai-diffusion-furry-3',
                            models: ['nai-diffusion-furry-3'],
                            count: tag.n_count,
                            category: tag.e_category,
                            e_count: tag.e_count,
                        };
                    }
                    
                    // Add model if not already present
                    if (!tagSuggestionsCache.tags[tagKey].models.some(m => m.model === 'furry-local')) {
                        tagSuggestionsCache.tags[tagKey].models.push({
                            model: 'furry-local',
                            searchModel: 'nai-diffusion-furry-3',
                            count: tag.n_count,
                            confidence: tag.confidence,
                            category: tag.e_category,
                            e_count: tag.e_count,
                        });
                    }
                    
                    // Update count to highest
                    tagSuggestionsCache.tags[tagKey].count = Math.max(tagSuggestionsCache.tags[tagKey].count, tag.e_count);
                    
                    // Store object with key, model, and confidence
                    queryTagObjs.push({ 
                        key: tagKey, 
                        model: 'furry-local', 
                        searchModel: model,
                        confidence: tag.confidence,
                        category: tag.e_category,
                        n_count: tag.n_count,
                        e_count: tag.e_count,
                    });
                    allTags.push({
                        tag: tag.tag,
                        count: tag.n_count,
                        confidence: tag.confidence,
                        model: 'furry-local',
                        tagKey: tagKey,
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
                
                // Send final completion signal for furry service
                ws.send(JSON.stringify({
                    type: 'search_results_complete',
                    totalServices: 1,
                    completedServices: 1
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

    async makeLocalAnimeTagRequests(query, model, tagSuggestionsCache, queryHash, ws = null) {
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
            const queryTagObjs = [];
            
            if (animeResults.length > 0) {
                animeResults.forEach((tag, index) => {
                    const tagKey = this.generateTagKey(tag.tag);
                    
                    // Update or create tag in cache
                    if (!tagSuggestionsCache.tags[tagKey]) {
                        tagSuggestionsCache.tags[tagKey] = {
                            tag: tag.tag,
                            searchModel: 'nai-diffusion-3',
                            models: ['nai-diffusion-3'],
                            count: tag.n_count,
                            category: tag.d_category,
                            d_count: tag.d_count,
                        };
                    }
                    
                    // Add model if not already present
                    if (!tagSuggestionsCache.tags[tagKey].models.some(m => m.model === 'anime-local')) {
                        tagSuggestionsCache.tags[tagKey].models.push({
                            model: 'anime-local',
                            searchModel: 'nai-diffusion-3',
                            count: tag.n_count,
                            confidence: tag.confidence,
                            category: tag.d_category,
                            d_count: tag.d_count,
                        });
                    }
                    
                    // Update count to highest
                    tagSuggestionsCache.tags[tagKey].count = Math.max(tagSuggestionsCache.tags[tagKey].count, tag.d_count);
                    
                    // Store object with key, model, and confidence
                    queryTagObjs.push({ 
                        key: tagKey, 
                        model: 'anime-local', 
                        searchModel: model,
                        confidence: tag.confidence,
                        category: tag.d_category,
                        n_count: tag.n_count,
                        d_count: tag.d_count,
                    });
                    allTags.push({
                        tag: tag.tag,
                        count: tag.n_count,
                        confidence: tag.confidence,
                        model: 'anime-local',
                        tagKey: tagKey,
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
                
                // Send final completion signal for anime service
                ws.send(JSON.stringify({
                    type: 'search_results_complete',
                    totalServices: 1,
                    completedServices: 1
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
    async performTagSearch(query, model, ws = null) {
        try {
            if (!query || query.trim().length < 2) {
                return [];
            }

            // Get tag results from the tag suggestions cache or API calls
            let tagResults = [];
            const queryHash = this.generateQueryHash(query.trim().toLowerCase(), model);
            const tagSuggestionsCache = this.context.tagSuggestionsCache;
            
            if (tagSuggestionsCache.queries[model] && tagSuggestionsCache.queries[model][queryHash]) {
                // Use cached tag results
                const tagObjs = tagSuggestionsCache.queries[model][queryHash];
                tagResults = tagObjs.map(obj => {
                    const tag = tagSuggestionsCache.tags[obj.key];
                    if (tag) {
                        return {
                            type: 'tag',
                            name: tag.tag,
                            count: tag.count,
                            confidence: obj.confidence,
                            model: obj.model,
                            serviceOrder: 0,
                            resultOrder: 0,
                            serviceName: obj.model
                        };
                    }
                    return null;
                }).filter(Boolean);
            } else {
                // Make API requests for tags
                tagResults = await this.makeTagRequests(query, model, tagSuggestionsCache, queryHash, ws);
            }
            
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
    SearchService
}; 