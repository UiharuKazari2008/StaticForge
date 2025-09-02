// Overlay and list elements
const characterAutocompleteOverlay = document.getElementById('characterAutocompleteOverlay');
const characterAutocompleteList = document.querySelector('.character-autocomplete-list');

// State variables
let characterAutocompleteTimeout = null;
let currentCharacterAutocompleteTarget = null;
let selectedCharacterAutocompleteIndex = -1;
let autocompleteNavigationMode = false;
let autocompleteExpanded = false;
let characterSearchResults = [];
let selectedEnhancerGroupIndex = -1;
let lastSearchText = '';

// Spell check navigation state
let spellCheckNavigationMode = false;
let selectedSpellCheckWordIndex = -1;
let selectedSpellCheckSuggestionIndex = -1;

// Realtime search state
let searchServices = new Map(); // Track service status
let searchResultsByService = new Map(); // Track results by service
let spellCheckResults = new Map(); // Track spell check results by service
let textReplacementResults = new Map(); // Track text replacement results by service
let currentSearchRequestId = null;
let isSearching = false;
let allSearchResults = []; // Combined and ordered results
let searchCompletionStatus = {
    totalServices: 0,
    completedServices: 0,
    isComplete: false
};

// Search request tracking to prevent multiple simultaneous searches
let currentSearchQuery = '';
let currentSearchTimeout = null;

// Persistent results storage for stable autocomplete
let persistentSpellCheckData = null; // Current spell check data
let isAutocompleteVisible = false; // Track if autocomplete is currently visible

// Spellcheck timing variables for frequent checking
let lastSpellCheckQuery = ''; // Track last spellcheck query to avoid duplicates
let spellCheckTimer = null; // Timer for frequent spellcheck
let spellCheckWordCount = 0; // Track word count for spellcheck
let lastSpellCheckTime = 0; // Track last spellcheck time
let spellCheckInputTimer = null; // Timer for input delay spellcheck
let currentSpellCheckRequest = null; // Track current spellcheck request for cancellation

// Track last search query to prevent unnecessary clearing
let lastSearchQuery = '';

// Track whether services have been initialized for the current autofill session
let servicesInitialized = false;

// Selection persistence for tag listings
let lastSelectedItemData = null; // Store data about the last selected item for restoration
let lastSelectedItemType = null; // Store the type of the last selected item

// Map client model names to server model names
const searchModelMapping = {
    'v4_5': 'nai-diffusion-4-5-full',
    'v4_5_cur': 'nai-diffusion-4-5-curated',
    'v4': 'nai-diffusion-4-full',
    'v4_cur': 'nai-diffusion-4-curated',
    'v3': 'nai-diffusion-3',
    'v3_furry': 'nai-diffusion-furry-3'
};

// Function to initialize all autofill services
function initializeAutofillServices() {
    // Initialize ALL services immediately when autofill appears
    // This ensures all services are visible with their icons from the start
    searchServices.set('characters', 'stalled');
    searchServices.set('anime-local', 'stalled');
    
    // Set the current model service dynamically based on the actual model being searched
    // Map client model names to server model names to prevent conflicts
    let currentModel = window.manualModel?.value || 'unknown';
    
    // Use mapped name if available, otherwise use original
    currentModel = searchModelMapping[currentModel] || currentModel;
    
    // Only add if it's a valid model name (starts with nai-diffusion)
    searchServices.set(currentModel, 'stalled');
    
    searchServices.set('furry-local', 'stalled');
    searchServices.set('nai-diffusion-furry-3', 'stalled');
    searchServices.set('dual-match', 'stalled');
    searchServices.set('textReplacements', 'stalled');
    searchServices.set('spellcheck', 'stalled');
    
    // Update the display to show the services
    updateSearchStatusDisplay();
}

const modelKeys = {
    "nai-diffusion-3": { type: "NovelAI", version: "v3 Anime" },
    "nai-diffusion-furry-3": { type: "NovelAI", version: "v3 Furry" },
    "nai-diffusion-4-full": { type: "NovelAI", version: "v4" },
    "nai-diffusion-4-curated-preview": { type: "NovelAI", version: "v4 Curated" },
    "nai-diffusion-4-5-full": { type: "NovelAI", version: "v4.5" },
    "nai-diffusion-4-5-curated": { type: "NovelAI", version: "v4.5 Curated" },
    "furry-local": { type: "Hidden", version: "e621" },
    "anime-local": { type: "Hidden", version: "Danbooru" },
    "dual-match": { type: "Global" }
};

// Predictionary integration for better ranking
let predictionaryInstance = null;

// Initialize predictionary
async function initializePredictionary() {
    try {
        // Import predictionary dynamically
        const { Predictionary } = await import('predictionary');
        
        predictionaryInstance = new Predictionary({
            // Configure for autocomplete use case
            threshold: 0.3,
            maxResults: 100,
            includeScore: true,
            keys: ['name', 'placeholder', 'description']
        });
        
        console.log('✅ Predictionary initialized for enhanced ranking');
    } catch (error) {
        console.warn('⚠️ Predictionary not available, falling back to basic ranking:', error.message);
        predictionaryInstance = null;
    }
}

// Initialize predictionary when module loads
initializePredictionary().catch(error => {
    console.warn('Failed to initialize predictionary:', error.message);
});

// Enhanced similarity calculation using predictionary
async function calculateEnhancedSimilarity(query, text, type = 'general') {
    if (!predictionaryInstance || !query || !text) {
        // Fallback to basic similarity
        return calculateStringSimilarity(query, text);
    }
    
    try {
        // Use predictionary for fuzzy matching
        const results = await predictionaryInstance.search(query, [text]);
        
        if (results.length > 0) {
            const bestMatch = results[0];
            
            // Combine predictionary score with type-specific adjustments
            let enhancedScore = bestMatch.score * 100; // Convert to 0-100 scale
            
            // Type-specific adjustments
            switch (type) {
                case 'character':
                    // Characters get bonus for exact name matches
                    if (text.toLowerCase().includes(query.toLowerCase())) {
                        enhancedScore += 10;
                    }
                    break;
                case 'tag':
                    // Tags get bonus for confidence and popularity
                    enhancedScore += 5;
                    break;
                case 'textReplacement':
                    // Text replacements get bonus for exact placeholder matches
                    if (text.toLowerCase() === query.toLowerCase()) {
                        enhancedScore += 15;
                    }
                    break;
            }
            
            return Math.min(enhancedScore, 100); // Cap at 100
        }
        
        return 0;
    } catch (error) {
        console.warn('Predictionary search failed, using fallback:', error.message);
        return calculateStringSimilarity(query, text);
    }
}

// Enhanced character ranking with predictionary
async function enhanceCharacterResultsWithPredictionary(results, query) {
    if (!results || !Array.isArray(results) || !query) return results;
    
    const enhancedResults = [];
    const characterMap = new Map(); // Track best character by name
    
    for (const result of results) {
        if (result.type === 'character') {
            const predictionaryScore = await calculateEnhancedSimilarity(query, result.name, 'character');
            const existingSimilarity = result.similarity || 0;
            
            // Combine predictionary score with existing similarity
            const enhancedSimilarity = (predictionaryScore * 0.6) + (existingSimilarity * 0.4);
            
            const enhancedResult = {
                ...result,
                stringSimilarity: predictionaryScore,
                enhancedSimilarity: enhancedSimilarity,
                predictionaryScore: predictionaryScore
            };
            
            // Check for duplicates and keep the best one
            if (characterMap.has(result.name)) {
                const existingResult = characterMap.get(result.name);
                const existingScore = existingResult.enhancedSimilarity || 0;
                
                if (enhancedSimilarity > existingScore) {
                    characterMap.set(result.name, enhancedResult);
                }
            } else {
                characterMap.set(result.name, enhancedResult);
            }
        } else {
            enhancedResults.push(result);
        }
    }
    
    // Add all unique characters
    for (const character of characterMap.values()) {
        enhancedResults.push(character);
    }
    
    return enhancedResults;
}

// Enhanced text replacement ranking
async function enhanceTextReplacementResults(textReplacements, query) {
    if (!textReplacements || textReplacements.length === 0 || !query) return textReplacements;
    
    const enhancedReplacements = [];
    
    for (const replacement of textReplacements) {
        const nameScore = await calculateEnhancedSimilarity(query, replacement.name, 'textReplacement');
        const placeholderScore = await calculateEnhancedSimilarity(query, replacement.placeholder, 'textReplacement');
        
        // Use the better score between name and placeholder
        const bestScore = Math.max(nameScore, placeholderScore);
        
        enhancedReplacements.push({
            ...replacement,
            matchScore: bestScore,
            predictionaryScore: bestScore
        });
    }
    
    return enhancedReplacements;
}

// Enhanced tag ranking with deduplication
async function enhanceTagResults(tags, query) {
    if (!tags || tags.length === 0 || !query) return tags;
    
    const enhancedTags = [];
    const tagMap = new Map(); // Track best tag by name
    
    for (const tag of tags) {
        const predictionaryScore = await calculateEnhancedSimilarity(query, tag.name, 'tag');
        const existingConfidence = tag.confidence || 0;
        
        // Combine predictionary score with existing confidence
        const enhancedConfidence = (predictionaryScore * 0.3) + (existingConfidence * 0.7);
        
        const enhancedTag = {
            ...tag,
            predictionaryScore: predictionaryScore,
            enhancedConfidence: enhancedConfidence
        };
        
        // Check for duplicates and merge them intelligently
        if (tagMap.has(tag.name)) {
            const existingTag = tagMap.get(tag.name);
            const mergedTag = mergeTagResults(existingTag, enhancedTag);
            tagMap.set(tag.name, mergedTag);
        } else {
            tagMap.set(tag.name, enhancedTag);
        }
    }
    
    // Add all unique tags
    for (const tag of tagMap.values()) {
        enhancedTags.push(tag);
    }
    
    return enhancedTags;
}

// Handle search status updates from WebSocket
function handleSearchStatusUpdate(message) {
    if (!message.services || !Array.isArray(message.services)) return;
    
    message.services.forEach(service => {
        // Always update service status, don't remove completed/error services
        searchServices.set(service.name, service.status);
    });
    
    // Update the UI to show service status
    updateSearchStatusDisplay();
}

// Handle search results updates from WebSocket
function handleSearchResultsUpdate(message) {
    if (!message.service) return;
    
    // Store results by service
    const results = message.results || [];
    searchResultsByService.set(message.service, results);
    
    // Update service status based on results
    if (results.length === 0) {
        // No results found, mark as completed-none
        searchServices.set(message.service, 'completed-none');
    } else {
        // Results found, mark as completed
        searchServices.set(message.service, 'completed');
    }
    
    // Special handling for spellcheck service
    if (message.service === 'spellcheck' && results.length > 0) {
        const spellCheckResult = results[0];
        if (spellCheckResult.data && spellCheckResult.data.hasErrors && 
            spellCheckResult.data.misspelled && spellCheckResult.data.misspelled.length > 0) {
            // Has spelling errors
            searchServices.set('spellcheck', 'completed');
        } else {
            // No spelling errors found
            searchServices.set('spellcheck', 'completed-noerrors');
        }
    }
    
    // Handle dynamic results (spell check and text replacements) separately
    handleDynamicResultsUpdate(message.service, results);
    
    // Immediately rebuild and display results from all services
    rebuildAndDisplayResults().catch(error => {
        console.error('Error rebuilding display:', error);
    });
    
    // Update the UI to show service status changes
    updateSearchStatusDisplay();
}

// Handle search completion
function handleSearchResultsComplete(message) {
    searchCompletionStatus = {
        totalServices: message.totalServices || 0,
        completedServices: message.completedServices || 0,
        isComplete: true
    };
    
    // Don't clear search services - keep them visible with completed status
    // The services will remain visible until explicitly cleared or new search starts
    
    // Final rebuild and display
    rebuildAndDisplayResults().catch(error => {
        console.error('Error rebuilding display on completion:', error);
    });
    
    // Set searching to false after a small delay to ensure results are displayed
    setTimeout(() => {
        isSearching = false;
        // Reset current search query to allow new searches
        currentSearchQuery = '';
    }, 100);
    
    // Don't clear search state immediately - let it persist for continued searching
    // Only clear if user stops typing for a while
    setTimeout(() => {
        // Only clear if we're still in the same search session and no new search has started
        if (searchCompletionStatus.isComplete && !isSearching && lastSearchQuery === '') {
            // Don't clear searchServices - keep services visible with completed status
            // Only clear results and other state
            searchResultsByService.clear();
            clearDynamicResults();
            allSearchResults = [];
            searchCompletionStatus = {
                totalServices: 0,
                completedServices: 0,
                isComplete: false
            };
            // Don't clear persistent results here - let them persist for stable display
        }
    }, 10000); // Increased delay to 10 seconds
}

// Helper function to get normalized tag count for sorting
function getNormalizedTagCount(tag) {
    // For local tags (furry-local and anime-local), use n_count as primary, e_count as fallback
    if (tag.model === 'furry-local' || tag.model === 'anime-local') {
        // Use n_count if available and significant (> 100)
        if (tag.count && tag.count > 100) {
            return tag.count;
        }
        // Otherwise use e_count scaled to be comparable to API counts
        // Scale: 50000 e_count = 10000 API count
        if (tag.e_count) {
            return (tag.e_count / 50000) * 10000;
        }
        // Fallback to regular count if no local-specific counts
        return tag.count || 0;
    }
    
    // For API tags, use regular count
    return tag.count || 0;
}

// Rebuild and display all results in proper order
async function rebuildAndDisplayResults() {
    // Collect all results from all services
    allSearchResults = [];
    
    for (const [serviceName, results] of searchResultsByService) {
        if (results && Array.isArray(results)) {
            // Enhance character results with predictionary (exclude tags, handled separately)
            const nonTagResults = results.filter(result => result.type !== 'tag');
            const enhancedResults = await enhanceCharacterResultsWithPredictionary(nonTagResults, lastSearchQuery);
            allSearchResults.push(...enhancedResults);
        }
    }
    
    // Extract and enhance tag results separately for better deduplication
    const allTags = [];
    for (const [serviceName, results] of searchResultsByService) {
        if (results && Array.isArray(results)) {
            const tags = results.filter(result => result.type === 'tag');
            allTags.push(...tags);
        }
    }
    
    // Enhance and deduplicate tags
    const enhancedTags = await enhanceTagResults(allTags, lastSearchQuery);
    allSearchResults.push(...enhancedTags);
    
    // Merge spell check results from all services (prioritize the most comprehensive one)
    const bestSpellCheckResult = getBestSpellCheckResult();
    
    // Add the best spell check result to allSearchResults if it exists
    if (bestSpellCheckResult) {
        allSearchResults.push(bestSpellCheckResult);
    }
    
    // Merge text replacement results from all services with predictionary enhancement
    const allTextReplacements = getAllTextReplacementResults();
    const enhancedTextReplacements = await enhanceTextReplacementResults(allTextReplacements, lastSearchQuery);
    
    // Get the best text replacement match for the current query
    const bestTextReplacement = getBestTextReplacementMatch(enhancedTextReplacements, lastSearchQuery);
    
    // Add all enhanced text replacements to results
    allSearchResults.push(...enhancedTextReplacements);
    
    // Apply deduplication to remove duplicate results from different services
    allSearchResults = deduplicateResults(allSearchResults);
    
    // Debug logging for ranking
    logRankingDebug(allSearchResults, lastSearchQuery);
    
    // Sort results by ranking and type
    allSearchResults.sort((a, b) => {
        // Spell check results go to the top
        if (a.type === 'spellcheck' && b.type !== 'spellcheck') {
            return -1;
        }
        if (a.type !== 'spellcheck' && b.type === 'spellcheck') {
            return 1;
        }
        
        // Handle text replacements with special logic
        if (a.type === 'textReplacement' && b.type === 'textReplacement') {
            // If one is the best match, prioritize it
            if (bestTextReplacement && a.name === bestTextReplacement.name && a.placeholder === bestTextReplacement.placeholder) {
                return -1; // Best match goes first
            }
            if (bestTextReplacement && b.name === bestTextReplacement.name && b.placeholder === bestTextReplacement.placeholder) {
                return 1; // Best match goes first
            }
            
            // For non-best matches, sort by predictionary score if available
            const aScore = a.predictionaryScore || a.matchScore || calculateStringSimilarity(lastSearchQuery, a.name);
            const bScore = b.predictionaryScore || b.matchScore || calculateStringSimilarity(lastSearchQuery, b.name);
            
            // Only use score if it's significantly different (>= 10 points)
            if (Math.abs(aScore - bScore) >= 10) {
                return bScore - aScore; // Higher score first
            }
            
            // Otherwise, sort alphabetically
            return a.name.localeCompare(b.name);
        }
        
        // Text replacements go to the bottom (except the best match which is already handled above)
        if (a.type === 'textReplacement' && b.type !== 'textReplacement') {
            return 1;
        }
        if (a.type !== 'textReplacement' && b.type === 'textReplacement') {
            return -1;
        }
        
        // For tags, sort by enhanced confidence (predictionary + existing confidence)
        if (a.type === 'tag' && b.type === 'tag') {
            const aEnhancedConfidence = a.enhancedConfidence || a.confidence || 0;
            const bEnhancedConfidence = b.enhancedConfidence || b.confidence || 0;
            
            if (aEnhancedConfidence !== bEnhancedConfidence) {
                return bEnhancedConfidence - aEnhancedConfidence; // Higher confidence first
            }
            
            // Then sort by count, handling furry tags differently
            const aCount = getNormalizedTagCount(a);
            const bCount = getNormalizedTagCount(b);
            return bCount - aCount; // Higher count first
        }
        
        // For characters, sort by enhanced similarity (predictionary + existing similarity)
        if (a.type === 'character' && b.type === 'character') {
            const aTotalScore = a.enhancedSimilarity || (calculateStringSimilarity(lastSearchQuery, a.name) * 0.5) + ((a.similarity || 0) * 0.5);
            const bTotalScore = b.enhancedSimilarity || (calculateStringSimilarity(lastSearchQuery, b.name) * 0.5) + ((b.similarity || 0) * 0.5);
            
            if (aTotalScore !== bTotalScore) {
                return bTotalScore - aTotalScore; // Higher score first
            }
            
            // Fallback to count
            return b.count - a.count;
        }
        
        // Mixed types: establish proper hierarchy and scoring
        if (a.type === 'tag' && b.type === 'character') {
            const tagScore = a.enhancedConfidence || a.confidence || 0;
            const charScore = a.enhancedSimilarity || (calculateStringSimilarity(lastSearchQuery, b.name) * 0.5) + ((b.similarity || 0) * 0.5);
            
            // Tags generally have higher priority unless character has exceptional similarity
            // Only prioritize character if it has very high similarity (>= 80) AND tag has low confidence (< 30)
            if (charScore >= 80 && tagScore < 30) {
                return 1; // Character comes first (only for exceptional matches)
            }
            
            // Tags come first in all other cases
            return -1;
        }
        if (a.type === 'character' && b.type === 'tag') {
            const charScore = a.enhancedSimilarity || (calculateStringSimilarity(lastSearchQuery, a.name) * 0.5) + ((a.similarity || 0) * 0.5);
            const tagScore = b.enhancedConfidence || b.confidence || 0;
            
            // Tags generally have higher priority unless character has exceptional similarity
            // Only prioritize character if it has very high similarity (>= 80) AND tag has low confidence (< 30)
            if (charScore >= 80 && tagScore < 30) {
                return -1; // Character comes first (only for exceptional matches)
            }
            
            // Tags come first in all other cases
            return 1;
        }
        
        // Fallback to service order
        if (a.serviceOrder !== b.serviceOrder) {
            return a.serviceOrder - b.serviceOrder;
        }
        
        // Final fallback: alphabetical by type
        return a.type.localeCompare(b.type);
    });
    
    // Update the display with the sorted results
    if (currentCharacterAutocompleteTarget) {
        updateAutocompleteDisplay(allSearchResults, currentCharacterAutocompleteTarget);
    }
}

// Update the search status display in the autocomplete
function updateSearchStatusDisplay() {
    if (!characterAutocompleteList) return;
    
    if (!characterAutocompleteList) {
        return;
    }
    
    // Check if status display already exists
    let statusDisplay = characterAutocompleteList.querySelector('.search-status-display');
    
    if (!statusDisplay) {
        // Create new status display if it doesn't exist
        statusDisplay = document.createElement('div');
        statusDisplay.className = 'search-status-display';
        characterAutocompleteList.appendChild(statusDisplay);
    }
    
    if (searchServices.size === 0) {
        return;
    }
    
    // Only update if we actually have services to show
    const visibleServices = Array.from(searchServices.entries()).filter(([name, status]) => status !== undefined);
    if (visibleServices.length === 0) {
        return;
    }
    
    // Check if all services are in a completed state (not stalled or searching)
    const allServicesDone = visibleServices.every(([name, status]) => 
        status === 'completed' || status === 'completed-none' || status === 'error'
    );
    
    // Count results for display
    let tagResultsCount = 0;
    let specialResultsCount = 0;
    
    if (allServicesDone) {
        // Count tag results (API models and local tag services)
        for (const [serviceName, results] of searchResultsByService) {
            if (serviceName !== 'characters' && serviceName !== 'textReplacements' && serviceName !== 'spellcheck') {
                if (results && Array.isArray(results)) {
                    tagResultsCount += results.length;
                }
            }
        }
        
        // Count special results (characters and text replacements)
        const charactersResults = searchResultsByService.get('characters') || [];
        const textReplacementsResults = searchResultsByService.get('textReplacements') || [];
        specialResultsCount = charactersResults.length + textReplacementsResults.length;
    }
    
    // Determine display text
    let displayIcon = 'fas fa-search';
    let displayText = 'Searching...';
    if (allServicesDone) {
        if (tagResultsCount > 0) {
            displayText = `${tagResultsCount} Results`;
            if (specialResultsCount > 0) {
                displayText += ` (+${specialResultsCount} Special)`;
            }
            displayIcon = 'fa-light fa-check';
        } else if (specialResultsCount > 0) {
            displayText = `${specialResultsCount} Special Results`;
            displayIcon = 'fa-light fa-check';
        } else {
            displayText = 'No Results';
            displayIcon = 'fa-light fa-question';
        }
    }
    
    // Handle expanded vs compact state
    if (autocompleteExpanded) {
        // In expanded state, don't show the element if search is done
        if (allServicesDone) {
            statusDisplay.classList.add('hidden');
            return;
        } else {
            statusDisplay.classList.remove('hidden');
        }
    } else {
        if (allServicesDone) {
            statusDisplay.classList.add('search-done');
        } else {
            statusDisplay.classList.remove('search-done');
            statusDisplay.classList.remove('hidden');
        }
    }
        
    let statusHTML = `<div class="search-status-header"><i class="${displayIcon}"></i><span>${displayText}</span></div><div class="search-service-indicators">`;
    
    // Define the order you want services to appear in the status bar
    const serviceOrder = [
        'spellcheck',        // 1st - Spellcheck (most important for user feedback)
        'characters',        // 2nd - Character search
        'anime-local',      // 4th - Anime Local
        // Note: The current model service will be inserted here as 5th
        'furry-local',      // 6th - Furry Local
        'nai-diffusion-furry-3', // 7th - Furry v3
        'dual-match',       // 8th - Dual match corrections
        'textReplacements', // 9th - Text replacements
    ];
    
    // Get the current model for dynamic insertion
    let currentModel = window.manualModel?.value || 'unknown';
    currentModel = searchModelMapping[currentModel] || currentModel;
    
    // Show service status in the defined order, with current model inserted at 5th position
    let serviceCount = 0;
    for (const serviceName of serviceOrder) {
        const status = searchServices.get(serviceName);
        if (status !== undefined) { // Only show services that exist
            const iconClass = getServiceIconClass(serviceName, status);
            const statusClass = getStatusClass(status);
            const displayName = getServiceDisplayName(serviceName);
            statusHTML += `
                <div class="search-service-status ${statusClass}" title="${displayName}: ${status}">
                    <i class="${iconClass}"></i>
                </div>
            `;
            serviceCount++;
            
            // Insert current model as 5th item (after 4th item)
            if (serviceCount === 4 && searchServices.has(currentModel)) {
                const currentModelStatus = searchServices.get(currentModel);
                const currentModelIconClass = getServiceIconClass(currentModel, currentModelStatus);
                const currentModelStatusClass = getStatusClass(currentModelStatus);
                const currentModelDisplayName = getServiceDisplayName(currentModel);
                statusHTML += `
                    <div class="search-service-status ${currentModelStatusClass}" title="${currentModelDisplayName}: ${currentModelStatus}">
                        <i class="${currentModelIconClass}"></i>
                    </div>
                `;
            }
        }
    }
    
    // Show any remaining services that weren't in the order list (fallback)
    for (const [serviceName, status] of searchServices) {
        if (!serviceOrder.includes(serviceName)) {
            const iconClass = getServiceIconClass(serviceName, status);
            const statusClass = getStatusClass(status);
            const displayName = getServiceDisplayName(serviceName);
            statusHTML += `
                <div class="search-service-status ${statusClass}" title="${displayName}: ${status}">
                    <i class="${iconClass}"></i>
                </div>
            `;
        }
    }
    statusHTML += '</div>';
    
    // Update the existing status display instead of recreating it
    statusDisplay.innerHTML = statusHTML;
}

// Get CSS class for service icon
function getServiceIconClass(serviceName, status) {
    switch (serviceName) {
        case 'nai-diffusion-4-5-full':
        case 'nai-diffusion-4-5':
        case 'nai-diffusion-4-full':
        case 'nai-diffusion-4-curated-preview':
        case 'nai-diffusion-3':
        case 'v4':
        case 'v4_cur':
        case 'v4_5':
        case 'v4_5_cur':
        case 'v3':
            return 'nai-sakura';
        case 'nai-diffusion-furry-3':
        case 'v3_furry':
            return 'nai-paw';
        case 'furry-local':
            return 'nai-paw';
        case 'anime-local':
            return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-landmark-magnifying-glass'
        case 'dual-match':
            return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-link';
        case 'characters':
        case 'cached_characters':
            return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-user';
        case 'tags':
        case 'cached_tags':
            return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-tag';
        case 'textReplacements':
            return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-language';
        case 'spellcheck':
            return ((status === 'searching' || status === 'stalled' || status === 'completed-noerrors') ? 'fa-light' : 'fas') + ' fa-spell-check';
        case 'cached':
            return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-database';
        default:
            // Handle dynamic model names (like nai-diffusion-4-5, nai-diffusion-furry-3, etc.)
            if (serviceName.startsWith('nai-diffusion')) {
                if (serviceName.includes('furry')) {
                    return 'nai-paw';
                } else {
                    return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-database';
                }
            }
            return ((status === 'searching' || status === 'stalled' || status === 'completed-none') ? 'fa-light' : 'fas') + ' fa-question';
    }
}

// Get CSS class for status
function getStatusClass(status) {
    switch (status) {
        case 'searching':
            return 'status-searching';
        case 'stalled':
            return 'status-stalled';
        case 'completed':
            return 'status-completed';
        case 'completed-none':
            return 'status-completed-none';
        case 'completed-noerrors':
            return 'status-completed-noerrors';
        case 'error':
            return 'status-error';
        default:
            return 'status-unknown';
    }
}

// Get display name for service
function getServiceDisplayName(serviceName) {
    switch (serviceName) {
        case 'nai-diffusion-4-5-full':
        case 'nai-diffusion-4-5':
        case 'nai-diffusion-4-full':
        case 'nai-diffusion-4-curated-preview':
        case 'nai-diffusion-3':
            return 'NovelAI';
        case 'nai-diffusion-furry-3':
            return 'Furry';
        case 'furry-local':
            return 'Furry Local';
        case 'anime-local':
            return 'Anime Local';
        case 'dual-match':
            return 'Dual Match';
        case 'characters':
        case 'cached_characters':
            return 'Characters';
        case 'tags':
        case 'cached_tags':
            return 'Tags';
        case 'textReplacements':
            return 'Text Replacements';
        case 'spellcheck':
            return 'Spell Check';
        case 'cached':
            return 'Cache';
        default:
            // Handle dynamic model names (like nai-diffusion-4-5, nai-diffusion-furry-3, etc.)
            if (serviceName.startsWith('nai-diffusion')) {
                if (serviceName.includes('furry')) {
                    return 'Furry v3';
                } else if (serviceName.includes('4-5')) {
                    return 'NovelAI 4.5';
                } else if (serviceName.includes('4')) {
                    return 'NovelAI 4';
                } else if (serviceName.includes('3')) {
                    return 'NovelAI 3';
                } else {
                    return 'NovelAI';
                }
            }
            return serviceName;
    }
}

// Global autofill state
let autofillEnabled = true;

// Autofill toggle functions
function toggleAutofill() {
    autofillEnabled = !autofillEnabled;
    return autofillEnabled;
}

function setAutofillEnabled(enabled) {
    autofillEnabled = enabled;
}

function isAutofillEnabled() {
    return autofillEnabled;
}

// Expose functions globally
window.toggleAutofill = toggleAutofill;
window.setAutofillEnabled = setAutofillEnabled;
window.isAutofillEnabled = isAutofillEnabled;

// Character autocomplete functions
function handleCharacterAutocompleteInput(e) {
    // Don't trigger autocomplete if autofill is disabled
    if (!autofillEnabled) {
        return;
    }
    
    // Cancel any pending spellcheck request when user starts typing
    if (currentSpellCheckRequest) {
        currentSpellCheckRequest.cancel();
        currentSpellCheckRequest = null;
    }
    
    // Don't trigger autocomplete if we're in navigation mode and user is actively navigating
    // Don't trigger autocomplete if we're in navigation mode and user is actively navigating
    if (autocompleteNavigationMode && selectedCharacterAutocompleteIndex >= 0) {
        // Only clear navigation mode if user is typing (not just moving cursor)
        if (e.inputType && e.inputType !== 'insertText') {
            autocompleteNavigationMode = false;
        } else {
            // If user is typing, allow the search to continue but don't clear navigation mode
            // This allows real-time updates while keeping navigation state
        }
    }

    const target = e.target;
    const value = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = value.substring(0, cursorPosition);

    // Special handling for "Text:" prefix - check for it first
    const textPrefixIndex = textBeforeCursor.lastIndexOf('Text:');
    if (textPrefixIndex >= 0) {
        // Extract the text after "Text:" for spell checking
        const textAfterPrefix = textBeforeCursor.substring(textPrefixIndex + 5).trim();
        
        // Handle backspace - if actively navigating, start normal search delay
        if (e.inputType === 'deleteContentBackward') {
            // If user is actively navigating or has an item selected, start normal search
            if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
                // Clear existing timeout
                if (characterAutocompleteTimeout) {
                    clearTimeout(characterAutocompleteTimeout);
                }

                // Set timeout to search after user stops typing (normal delay)
                characterAutocompleteTimeout = setTimeout(() => {
                    if (textAfterPrefix.length >= 1) {
                        searchCharacters('Text:' + textAfterPrefix, target);
                    } else {
                        hideCharacterAutocomplete();
                    }
                }, 50);
                
                // Also trigger frequent spellcheck for backspace cases
                if (textAfterPrefix.length >= 3) {
                    requestFrequentSpellCheck(textAfterPrefix, target);
                }
                return;
            } else {
                // Not actively navigating, hide autocomplete
                hideCharacterAutocomplete();
                return;
            }
        }

        // Clear existing timeout
        if (characterAutocompleteTimeout) {
            clearTimeout(characterAutocompleteTimeout);
        }

        // Set timeout to search after user stops typing
        characterAutocompleteTimeout = setTimeout(() => {
            // For "Text:" searches, search immediately even with 1 character after the prefix
            if (textAfterPrefix.length >= 1) {
                lastSearchText = 'Text:' + textAfterPrefix;
                searchCharacters('Text:' + textAfterPrefix, target);
            } else {
                hideCharacterAutocomplete();
            }
        }, 250); // Reduced from 500ms for better responsiveness
        
        // Also trigger frequent spellcheck for Text: searches
        if (textAfterPrefix.length >= 3) {
            requestFrequentSpellCheck(textAfterPrefix, target);
        }
        return;
    }

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    let searchText = lastDelimiterIndex >= 0 ?
        textBeforeCursor.substring(lastDelimiterIndex + 1).trim() :
        textBeforeCursor.trim();

    // Special handling for text replacement searches starting with <
    // If the search text starts with <, we need to preserve it for the search
    if (searchText.startsWith('<')) {
        // Keep the < in the search text
        searchText = searchText;
    } else {
        // Check if there's a < character before the cursor that should be included
        const lastLessThanIndex = textBeforeCursor.lastIndexOf('<');
        if (lastLessThanIndex > lastDelimiterIndex) {
            // There's a < after the last delimiter, include it in the search
            searchText = textBeforeCursor.substring(lastLessThanIndex).trim();
        }
    }

    // Handle backspace - if actively navigating, start normal search delay
    if (e.inputType === 'deleteContentBackward') {
        // If user is actively navigating or has an item selected, start normal search
        if (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0) {
            // Clear existing timeout
            if (characterAutocompleteTimeout) {
                clearTimeout(characterAutocompleteTimeout);
            }

            // Set timeout to search after user stops typing (normal delay)
            characterAutocompleteTimeout = setTimeout(() => {
                if (searchText.startsWith('<') || searchText.length >= 2) {
                    searchCharacters(searchText, target);
                } else {
                    hideCharacterAutocomplete();
                }
            }, 50);
            
            // Also trigger frequent spellcheck for backspace cases
            if (searchText.length >= 2) {
                requestFrequentSpellCheck(searchText, target);
            }
            return;
        } else {
            // Not actively navigating, hide autocomplete
            hideCharacterAutocomplete();
            return;
        }
    }

    // Clear existing timeout
    if (characterAutocompleteTimeout) {
        clearTimeout(characterAutocompleteTimeout);
    }

    // Set timeout to search after user stops typing
    characterAutocompleteTimeout = setTimeout(() => {
        // For text replacement searches (starting with <), search immediately even with 1 character
        if (searchText.startsWith('<') || searchText.length >= 2) {
            lastSearchText = searchText;
            searchCharacters(searchText, target);
        } else {
            hideCharacterAutocomplete();
        }
    }, 250); // Reduced from 500ms for better responsiveness
    
    // Also trigger frequent spellcheck for continuous typing
    if (searchText.length >= 3) {
        requestFrequentSpellCheck(searchText, target);
    }
}

function handleCharacterAutocompleteKeydown(e) {
    // Handle emphasis editing popup (but not when toolbar is in emphasis mode)
    if (window.emphasisEditingActive && !e.target.closest('.prompt-textarea-toolbar.emphasis-mode')) {
        // Handle integer inputs (0-9 keys)
        if (e.key >= '0' && e.key <= '9') {
            e.preventDefault();
            const integerValue = parseInt(e.key);
            
            // Check if there's selected text and apply emphasis directly (only when NOT in emphasis mode)
            if (e.target && e.target.selectionStart !== e.target.selectionEnd && !window.emphasisEditingActive) {
                // Text is selected and NOT in emphasis mode, apply emphasis directly
                if (window.applyEmphasisDirectly) {
                    // Use current emphasis mode (normal, brace, or group)
                    const currentMode = window.emphasisEditingMode || 'normal';
                    const success = window.applyEmphasisDirectly(e.target, integerValue, currentMode);
                    if (success) {
                        // Update the emphasis value for future use
                        window.emphasisEditingValue = parseFloat(integerValue.toString());
                        // Update selection highlight to show the new emphasis value
                        if (window.emphasisEditingTarget && window.emphasisEditingSelection) {
                            window.addEmphasisSelectionHighlight(window.emphasisEditingTarget, window.emphasisEditingSelection);
                        }
                        return;
                    }
                }
            }
            
            // Fall back to normal emphasis editing mode
            // Set as a number, not a string
            window.emphasisEditingValue = parseFloat(integerValue.toString());
            // Update selection highlight to show the new emphasis value
            if (window.emphasisEditingTarget && window.emphasisEditingSelection) {
                window.addEmphasisSelectionHighlight(window.emphasisEditingTarget, window.emphasisEditingSelection);
            }
            return;
        }
        return;
    }

    // Handle autocomplete navigation - only when autocomplete is visible
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
        const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
        const items = characterAutocompleteList ? characterAutocompleteList.querySelectorAll('.character-autocomplete-item') : [];

        switch (e.key) {
            case 'ArrowDown':
                e.preventDefault();
                
                // If not in spell check mode but spell check section exists and we haven't entered main list yet, enter spell check first
                if (!spellCheckNavigationMode && spellCheckSection && selectedCharacterAutocompleteIndex === -1) {
                    spellCheckNavigationMode = true;
                    selectedSpellCheckWordIndex = 0;
                    selectedSpellCheckSuggestionIndex = 0;
                    
                    // Ensure we have a valid suggestion selected
                    const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
                    if (wordSections && wordSections.length > 0) {
                        const firstWordSection = wordSections[0];
                        const suggestionBtns = firstWordSection.querySelectorAll('.suggestion-btn');
                        if (suggestionBtns.length === 0) {
                            // No suggestions available, exit spell check and go to main list
                            spellCheckNavigationMode = false;
                            selectedSpellCheckWordIndex = -1;
                            selectedSpellCheckSuggestionIndex = -1;
                        } else {
                            updateSpellCheckSelection();
                            return;
                        }
                    } else {
                        // No spell check words available, exit spell check and go to main list
                        spellCheckNavigationMode = false;
                        selectedSpellCheckWordIndex = -1;
                        selectedSpellCheckSuggestionIndex = -1;
                    }
                }
                
                // If in spell check navigation, navigate down to next word or exit to main list
                if (spellCheckNavigationMode) {
                    const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                    if (wordSections && selectedSpellCheckWordIndex < wordSections.length - 1) {
                        selectedSpellCheckWordIndex++;
                        selectedSpellCheckSuggestionIndex = 0;
                        updateSpellCheckSelection();
                        return;
                    } else {
                        // Exit spell check and enter main list
                        spellCheckNavigationMode = false;
                        selectedSpellCheckWordIndex = -1;
                        selectedSpellCheckSuggestionIndex = -1;
                        updateSpellCheckSelection();
                        // Continue to main list navigation
                    }
                }
                
                // Normal autocomplete navigation
                autocompleteNavigationMode = true;
                if (!items || items.length === 0) {
                    return;
                }
                
                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteToShowAll();
                    selectedCharacterAutocompleteIndex = 0;
                } else {
                selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 1, items.length - 1);
                }
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
                
            case 'ArrowUp':
                // Only intercept if we're in navigation mode (autocomplete is expanded)
                if (autocompleteNavigationMode || spellCheckNavigationMode) {
                    e.preventDefault();
                    
                    // If in main list and at top, check if we should enter spell check
                    if (!spellCheckNavigationMode && selectedCharacterAutocompleteIndex <= 0 && spellCheckSection) {
                        spellCheckNavigationMode = true;
                        selectedSpellCheckWordIndex = 0;
                        selectedSpellCheckSuggestionIndex = 0;
                        
                        // Ensure we have a valid suggestion selected
                        const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
                        if (wordSections && wordSections.length > 0) {
                            const firstWordSection = wordSections[0];
                            const suggestionBtns = firstWordSection.querySelectorAll('.suggestion-btn');
                            if (suggestionBtns.length === 0) {
                                // No suggestions available, exit spell check
                                spellCheckNavigationMode = false;
                                selectedSpellCheckWordIndex = -1;
                                selectedSpellCheckSuggestionIndex = -1;
                                return;
                            }
                        }
                        
                        updateSpellCheckSelection();
                        return;
                    }
                    
                    // If in spell check navigation, navigate up
                    if (spellCheckNavigationMode) {
                        if (selectedSpellCheckWordIndex > 0) {
                            selectedSpellCheckWordIndex--;
                            selectedSpellCheckSuggestionIndex = 0;
                        } else {
                            // Exit spell check and return to textbox
                            spellCheckNavigationMode = false;
                            selectedSpellCheckWordIndex = -1;
                            selectedSpellCheckSuggestionIndex = -1;
                            updateSpellCheckSelection();
                            hideCharacterAutocomplete();
                            autocompleteNavigationMode = false;
                            autocompleteExpanded = false;
                            return;
                        }
                        updateSpellCheckSelection();
                        return;
                    }
                    
                    // Normal autocomplete navigation
                    autocompleteNavigationMode = true;
                    if (selectedCharacterAutocompleteIndex <= 0) {
                        hideCharacterAutocomplete();
                        autocompleteNavigationMode = false;
                        return;
                    }
                    selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 1, -1);
                    updateCharacterAutocompleteSelection();
                    updateEmphasisTooltipVisibility();
                } else if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden')) {
                    // In preview mode - close autocomplete and allow normal text navigation
                    hideCharacterAutocomplete();
                    autocompleteNavigationMode = false;
                    autocompleteExpanded = false;
                }
                // If not in navigation mode and no autocomplete visible, don't prevent default - allow normal text navigation
                break;
                
            case 'PageDown':
                e.preventDefault();
                
                // If in spell check mode, exit to main list
                if (spellCheckNavigationMode) {
                    spellCheckNavigationMode = false;
                    selectedSpellCheckWordIndex = -1;
                    selectedSpellCheckSuggestionIndex = -1;
                    updateSpellCheckSelection();
                }
                
                // Normal autocomplete navigation
                autocompleteNavigationMode = true;
                if (!items || items.length === 0) {
                    return;
                }
                
                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteToShowAll();
                    selectedCharacterAutocompleteIndex = 0;
                } else {
                    selectedCharacterAutocompleteIndex = Math.min(selectedCharacterAutocompleteIndex + 10, items.length - 1);
                }
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
                
            case 'PageUp':
                e.preventDefault();
                
                // If in spell check mode, exit to main list
                if (spellCheckNavigationMode) {
                    spellCheckNavigationMode = false;
                    selectedSpellCheckWordIndex = -1;
                    selectedSpellCheckSuggestionIndex = -1;
                    updateSpellCheckSelection();
                }
                
                // Normal autocomplete navigation
                autocompleteNavigationMode = true;
                if (!items || items.length === 0) {
                    return;
                }
                
                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteToShowAll();
                    selectedCharacterAutocompleteIndex = 0;
                } else {
                    selectedCharacterAutocompleteIndex = Math.max(selectedCharacterAutocompleteIndex - 10, 0);
                }
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
                
            case 'Home':
                e.preventDefault();
                
                // If in spell check mode, exit to main list
                if (spellCheckNavigationMode) {
                    spellCheckNavigationMode = false;
                    selectedSpellCheckWordIndex = -1;
                    selectedSpellCheckSuggestionIndex = -1;
                    updateSpellCheckSelection();
                }
                
                // Normal autocomplete navigation
                autocompleteNavigationMode = true;
                if (!items || items.length === 0) {
                    return;
                }
                
                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteToShowAll();
                }
                selectedCharacterAutocompleteIndex = 0;
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
                
            case 'End':
                e.preventDefault();
                
                // If in spell check mode, exit to main list
                if (spellCheckNavigationMode) {
                    spellCheckNavigationMode = false;
                    selectedSpellCheckWordIndex = -1;
                    selectedSpellCheckSuggestionIndex = -1;
                    updateSpellCheckSelection();
                }
                
                // Normal autocomplete navigation
                autocompleteNavigationMode = true;
                if (!items || items.length === 0) {
                    return;
                }
                
                if (selectedCharacterAutocompleteIndex === -1) {
                    expandAutocompleteToShowAll();
                }
                selectedCharacterAutocompleteIndex = items.length - 1;
                updateCharacterAutocompleteSelection();
                updateEmphasisTooltipVisibility();
                break;
                
            case 'ArrowLeft':
                if (autocompleteNavigationMode || spellCheckNavigationMode) {
                    e.preventDefault();
                    
                    if (spellCheckNavigationMode) {
                        // Navigate left in spell check suggestions
                        const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                        if (wordSections && selectedSpellCheckWordIndex >= 0 && selectedSpellCheckWordIndex < wordSections.length) {
                            if (selectedSpellCheckSuggestionIndex > 0) {
                                selectedSpellCheckSuggestionIndex--;
                                updateSpellCheckSelection();
                            }
                        }
                        return;
                    }
                    
                    // Normal autocomplete navigation
                    if (selectedCharacterAutocompleteIndex >= 0) {
                        // Allow normal text navigation
                        hideCharacterAutocomplete();
                        autocompleteNavigationMode = false;
                    } else {
                        hideCharacterAutocomplete();
                        autocompleteNavigationMode = false;
                    }
                }
                // If not in navigation mode, don't prevent default - allow normal text navigation
                break;
                
            case 'ArrowRight':
                if (autocompleteNavigationMode || spellCheckNavigationMode) {
                    e.preventDefault();
                    
                    if (spellCheckNavigationMode) {
                        // Navigate right in spell check suggestions
                        const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                        if (wordSections && selectedSpellCheckWordIndex >= 0 && selectedSpellCheckWordIndex < wordSections.length) {
                            const currentWordSection = wordSections[selectedSpellCheckWordIndex];
                            const suggestionBtns = currentWordSection.querySelectorAll('.suggestion-btn');
                            if (selectedSpellCheckSuggestionIndex < suggestionBtns.length - 1) {
                                selectedSpellCheckSuggestionIndex++;
                                updateSpellCheckSelection();
                            }
                        }
                        return;
                    }
                    
                    // Handle text replacement insertion with right arrow
                    if (selectedCharacterAutocompleteIndex >= 0 && items && items.length > 0) {
                        const selectedItem = items[selectedCharacterAutocompleteIndex];
                        if (selectedItem && selectedItem.dataset.type === 'textReplacement') {
                            const replacementValue = selectedItem.dataset.replacementValue;
                            if (replacementValue) {
                                insertTextReplacement(replacementValue);
                                return;
                            }
                        }
                    }
                }
                break;
            case 'Tab':
                // Handle Tab for autocomplete when visible but not in navigation mode (preview mode)
                if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden') && !autocompleteNavigationMode) {
                    e.preventDefault();
                    
                    // Apply the first available result (spell check first, then main list)
                    if (spellCheckSection) {
                        // Check if there are spell check suggestions available
                        const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
                        if (wordSections && wordSections.length > 0) {
                            const firstWordSection = wordSections[0];
                            const suggestionBtns = firstWordSection.querySelectorAll('.suggestion-btn');
                            if (suggestionBtns.length > 0) {
                                // Apply the first spell check suggestion
                                const firstBtn = suggestionBtns[0];
                                const originalWord = firstBtn.dataset.original;
                                const suggestion = firstBtn.dataset.suggestion;
                                applySpellCorrection(currentCharacterAutocompleteTarget, originalWord, suggestion);
                                return;
                            }
                        }
                    }
                    
                    // If no spell check or no spell check suggestions, apply first main list item
                    if (items && items.length > 0) {
                        const firstItem = items[0];
                        if (firstItem) {
                            const type = firstItem.dataset.type;
                            
                            if (type === 'character') {
                                const characterData = JSON.parse(firstItem.dataset.characterData);
                                selectCharacterItem(characterData);
                            } else if (type === 'tag') {
                                selectTag(firstItem.dataset.tagName);
                            } else if (type === 'textReplacement') {
                                selectTextReplacement(firstItem.dataset.placeholder);
                            } else {
                                console.error('Unknown item type:', type);
                            }
                        }
                    }
                }
                break;
            case 'Enter':
                e.preventDefault();
                
                if (spellCheckNavigationMode) {
                    // Apply selected spell check suggestion
                    const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                    if (wordSections && selectedSpellCheckWordIndex >= 0 && selectedSpellCheckWordIndex < wordSections.length) {
                        const currentWordSection = wordSections[selectedSpellCheckWordIndex];
                        const suggestionBtns = currentWordSection.querySelectorAll('.suggestion-btn');
                        if (suggestionBtns && selectedSpellCheckSuggestionIndex >= 0 && selectedSpellCheckSuggestionIndex < suggestionBtns.length) {
                            const selectedBtn = suggestionBtns[selectedSpellCheckSuggestionIndex];
                            const originalWord = selectedBtn.dataset.original;
                            const suggestion = selectedBtn.dataset.suggestion;
                            applySpellCorrection(currentCharacterAutocompleteTarget, originalWord, suggestion);
                            return;
                        }
                    }
                    return;
                }
                
                // Normal autocomplete selection
                if (selectedCharacterAutocompleteIndex >= 0) {
                    const selectedItem = items[selectedCharacterAutocompleteIndex];
                    if (selectedItem) {
                        const type = selectedItem.dataset.type;
                        if (type === 'character') {
                            const characterData = JSON.parse(selectedItem.dataset.characterData);
                            selectCharacterItem(characterData);
                        } else if (type === 'tag') {
                        selectTag(selectedItem.dataset.tagName);
                        } else if (type === 'textReplacement') {
                            selectTextReplacement(selectedItem.dataset.placeholder);
                        }
                    }
                }
                break;
                
            case 'f':
            case 'F':
                if (e.altKey) {
                    e.preventDefault();
                    
                    // Add selected item to favorites
                    if (selectedCharacterAutocompleteIndex >= 0 && items.length > 0) {
                        const selectedItem = items[selectedCharacterAutocompleteIndex];
                        if (selectedItem) {
                            addToFavorites(selectedItem);
                        }
                    }
                    return;
                }
                break;
                
            case 'Escape':
                e.preventDefault();
                if (spellCheckNavigationMode) {
                    spellCheckNavigationMode = false;
                    selectedSpellCheckWordIndex = -1;
                    selectedSpellCheckSuggestionIndex = -1;
                    updateSpellCheckSelection();
                } else {
                hideCharacterAutocomplete();
                autocompleteNavigationMode = false;
                }
                break;
            case 'Backspace':
                if (e.shiftKey && document.activeElement.type === 'textarea' && (document.activeElement.classList.contains('prompt-textarea') || document.activeElement.classList.contains('character-prompt-textarea'))) {
                    e.preventDefault();
                    deleteTagBehindCursor(document.activeElement);
                }
                break;
        }
    } else if (!manualModal.classList.contains('hidden')) {
        switch(e.key) {
            case 'Tab':
                if (document.activeElement.type === 'textarea' && (document.activeElement.classList.contains('prompt-textarea') || document.activeElement.classList.contains('character-prompt-textarea'))) {
                    if (e.metaKey || e.ctrlKey || e.altKey)
                        return;
                    e.preventDefault();
                    handlePromptTabCycling(e);
                }
                break;
            case 'Backspace':
                if (e.shiftKey && document.activeElement.type === 'textarea' && (document.activeElement.classList.contains('prompt-textarea') || document.activeElement.classList.contains('character-prompt-textarea'))) {
                    e.preventDefault();
                    deleteTagBehindCursor(document.activeElement);
                }
                break;
                
            case 'f':
            case 'F':
                if (e.altKey && document.activeElement.type === 'textarea' && 
                    (document.activeElement.classList.contains('prompt-textarea') || 
                     document.activeElement.classList.contains('character-prompt-textarea'))) {
                    
                    const selectedText = getSelectedTextFromTextarea(document.activeElement);
                    if (selectedText && selectedText.trim()) {
                        e.preventDefault();
                        showAddToFavoritesDialog(selectedText.trim());
                    }
                }
                break;
        }
    }
}

// Function to handle frequent spellcheck requests
async function requestFrequentSpellCheck(query, target) {
    // Clear any existing timers
    if (spellCheckTimer) {
        clearTimeout(spellCheckTimer);
    }
    if (spellCheckInputTimer) {
        clearTimeout(spellCheckInputTimer);
    }
    
    // Cancel any pending spellcheck request
    if (currentSpellCheckRequest) {
        currentSpellCheckRequest.cancel();
        currentSpellCheckRequest = null;
    }
    
    // Count words in the query
    const wordCount = query.trim().split(/\s+/).filter(word => word.length > 0).length;
    
    // Check if we should trigger spellcheck based on conditions
    const shouldTriggerSpellCheck = (
        query !== lastSpellCheckQuery && // Different query
        query.length >= 3 && // At least 3 characters
        (
            wordCount >= 3 || // Every 3 words
            (Date.now() - lastSpellCheckTime >= 250) || // Every 250ms
            wordCount > spellCheckWordCount // Word count increased
        )
    );
    
    if (shouldTriggerSpellCheck) {
        // Update tracking variables
        lastSpellCheckQuery = query;
        lastSpellCheckTime = Date.now();
        spellCheckWordCount = wordCount;
        
        // Trigger spellcheck immediately
        await triggerSpellCheck(query, target);
    }
    
    // Set timer for 250ms spellcheck
    spellCheckTimer = setTimeout(async () => {
        if (query === lastSpellCheckQuery && query.length >= 3) {
            await triggerSpellCheck(query, target);
        }
    }, 250);
    
    // Set timer for 800ms final spellcheck after no input
    spellCheckInputTimer = setTimeout(async () => {
        if (query === lastSpellCheckQuery && query.length >= 3) {
            await triggerSpellCheck(query, target);
        }
    }, 500);
}

// Function to trigger spellcheck
async function triggerSpellCheck(query, target) {
    try {
        // Only proceed if we have a valid query and target
        if (!query || !target || query.length < 3) {
            return;
        }
        
        // Check if query starts with "Text:" - if not, add it for spellcheck
        const spellCheckQuery = query.startsWith('Text:') ? query : `Text:${query}`;
        
        // Initialize spellcheck service as searching
        searchServices.set('spellcheck', 'searching');
        updateSearchStatusDisplay();
        
        // Create a cancellable request
        const requestPromise = new Promise(async (resolve, reject) => {
            const cancelToken = { cancelled: false };
            
            // Store the cancellation function
            currentSpellCheckRequest = {
                cancel: () => {
                    cancelToken.cancelled = true;
                    reject(new Error('Request cancelled'));
                }
            };
            
            try {
                // Send spellcheck request via WebSocket
                if (window.wsClient && window.wsClient.isConnected()) {
                    const responseData = await window.wsClient.searchCharacters(spellCheckQuery, manualModel.value);
                    
                    // Check if request was cancelled
                    if (cancelToken.cancelled) {
                        reject(new Error('Request cancelled'));
                        return;
                    }
                    
                    const spellCheckData = responseData.spellCheck || null;
                    
                    if (spellCheckData) {
                        // Update persistent spellcheck data
                        persistentSpellCheckData = spellCheckData;
                        
                        // Store spellcheck results in the unified system instead of sending separate WebSocket messages
                        if (spellCheckData.hasErrors) {
                            const spellCheckResult = {
                                type: 'spellcheck',
                                data: spellCheckData,
                                serviceOrder: -2,
                                resultOrder: 0,
                                serviceName: 'spellcheck'
                            };
                            
                            // Add to the unified results system
                            searchResultsByService.set('spellcheck', [spellCheckResult]);
                        }
                        
                        // Mark spellcheck service as completed or completed-none based on results
                        if (spellCheckData.hasErrors && spellCheckData.misspelled && spellCheckData.misspelled.length > 0) {
                            searchServices.set('spellcheck', 'completed');
                        } else {
                            searchServices.set('spellcheck', 'completed-noerrors');
                        }
                        updateSearchStatusDisplay();
                        
                        // Rebuild and display results to show spellcheck
                        rebuildAndDisplayResults();
                    }
                    
                    resolve(spellCheckData);
                } else {
                    reject(new Error('WebSocket not connected'));
                }
            } catch (wsError) {
                console.error('WebSocket spellcheck failed:', wsError);
                searchServices.set('spellcheck', 'error');
                updateSearchStatusDisplay();
                reject(wsError);
            }
        });
        
        // Wait for the request to complete
        await requestPromise;
        
        // Clear the current request reference
        currentSpellCheckRequest = null;
        
    } catch (error) {
        // Only log errors that aren't cancellation
        if (error.message !== 'Request cancelled') {
            console.error('Spellcheck error:', error);
            searchServices.set('spellcheck', 'error');
            updateSearchStatusDisplay();
        }
        
        // Clear the current request reference
        currentSpellCheckRequest = null;
    }
}

async function searchCharacters(query, target) {
    try {        
        // Prevent duplicate searches for the same query
        if (currentSearchQuery === query && isSearching) {
            console.log(`🔄 Skipping duplicate search for query: "${query}"`);
            return;
        }
        
        // Clear any existing search timeout
        if (currentSearchTimeout) {
            clearTimeout(currentSearchTimeout);
            currentSearchTimeout = null;
        }
        
        // Update current search query
        currentSearchQuery = query;
        
        // Only clear results if this is a completely new search query
        // But don't clear searchServices - we want to preserve service status
        if (lastSearchQuery !== query) {
            // Check if this is a continuation of the same search (just more characters)
            const isContinuation = lastSearchQuery && query.startsWith(lastSearchQuery);
            
            if (!isContinuation) {
                // This is a completely different search, clear results but preserve services
                searchResultsByService.clear();
                clearDynamicResults();
                allSearchResults = [];
                
                // Don't reset services initialization - keep the services visible
                // Only reset if we have no services at all
                if (searchServices.size === 0) {
                    servicesInitialized = false;
                }
            } else {
                // This is a continuation, just clear results but keep services
                searchResultsByService.clear();
                clearDynamicResults();
                allSearchResults = [];
            }
            
            lastSearchQuery = query;
        }
        
        isSearching = true;
        searchCompletionStatus = {
            totalServices: 0,
            completedServices: 0,
            isComplete: false
        };
        
        // Clear persistent state for new search
        persistentSpellCheckData = null;
        isAutocompleteVisible = false;
        
        // Clear any existing spellcheck timers for new search
        if (spellCheckTimer) {
            clearTimeout(spellCheckTimer);
            spellCheckTimer = null;
        }
        if (spellCheckInputTimer) {
            clearTimeout(spellCheckInputTimer);
            spellCheckInputTimer = null;
        }
        
        // Set the current target for autocomplete
        currentCharacterAutocompleteTarget = target;
        
        // Initialize services if this is the first time in this autofill session
        if (!servicesInitialized) {
            initializeAutofillServices();
            servicesInitialized = true;
        }
        
        // Show autocomplete dropdown immediately with loading state
        updateAutocompleteDisplay([], target);
        updateSearchStatusDisplay();
        
        // Check if query starts with ! - only return text replacements in this case
        const isTextReplacementSearch = query.startsWith('!');
        
        // Check if query starts with "Text:" - only perform spell correction in this case
        const isTextPrefixSearch = query.startsWith('Text:');

        let searchResults = [];
        let spellCheckData = null;

        if (!isTextReplacementSearch && !isTextPrefixSearch) {
            // Start frequent spellcheck for this query (separate from main search)
            requestFrequentSpellCheck(query, target);
            
            // Mark services as searching for regular searches
            searchServices.set('characters', 'searching');
            searchServices.set('anime-local', 'searching');
            
            // Mark the current model service as searching
            let currentModel = window.manualModel?.value || 'unknown';
            
            currentModel = searchModelMapping[currentModel] || currentModel;
            
            if (searchServices.has(currentModel)) {
                searchServices.set(currentModel, 'searching');
            }
            
            searchServices.set('furry-local', 'searching');
            searchServices.set('nai-diffusion-furry-3', 'searching');
            searchServices.set('textReplacements', 'searching');
            updateSearchStatusDisplay();
            
            // Use WebSocket for search - this will handle characters, tags, and textReplacements server-side
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    const responseData = await window.wsClient.searchCharacters(query, manualModel.value);
                    searchResults = responseData.results || [];
                    
                    // Note: Spellcheck is now handled separately by frequent requests
                    // The backend will send status updates for characters, tags, and textReplacements
                } catch (wsError) {
                    console.error('WebSocket search failed:', wsError);
                    // Mark services as error if search fails
                    searchServices.set('characters', 'error');
                    searchServices.set('anime-local', 'error');
                    
                    // Mark the current model service as error
                    let currentModel = window.manualModel?.value || 'unknown';
                    
                    currentModel = searchModelMapping[currentModel] || currentModel;
                    
                    if (searchServices.has(currentModel)) {
                        searchServices.set(currentModel, 'error');
                    }
                    
                    searchServices.set('furry-local', 'error');
                    searchServices.set('nai-diffusion-furry-3', 'error');
                    searchServices.set('textReplacements', 'error');
                    throw new Error('Search service unavailable');
                }
            } else {
                throw new Error('WebSocket not connected');
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

        // For text replacement searches, update service status and perform search
        if (isTextReplacementSearch) {
            // Initialize text replacement service for text replacement searches
            searchServices.set('textReplacements', 'stalled');
            searchServices.set('spellcheck', 'stalled');
            updateSearchStatusDisplay();
            
            // Perform text replacement search via WebSocket
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    await window.wsClient.searchCharacters(query, manualModel.value);
                } catch (wsError) {
                    console.error('WebSocket text replacement search failed:', wsError);
                    searchServices.set('textReplacements', 'error');
                    updateSearchStatusDisplay();
                }
            }
        }
        
        // Start frequent spellcheck for all non-Text: searches
        if (!isTextPrefixSearch) {
            requestFrequentSpellCheck(query, target);
        }
        
        // Note: Text replacements are now handled server-side via WebSocket
        // The server will send status updates for the textReplacements service
        // For "Text:" searches, extract the text after the prefix for spell checking
        if (isTextPrefixSearch) {
            searchQuery = searchQuery.substring(5).trim(); // Remove "Text:" prefix
            
            // Initialize spellcheck service as stalled, then mark as searching
            searchServices.set('spellcheck', 'stalled');
            updateSearchStatusDisplay();
            
            setTimeout(() => {
                searchServices.set('spellcheck', 'searching');
                updateSearchStatusDisplay();
            }, 100);
            
            // For "Text:" searches, send the full query to trigger spell checking
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    const responseData = await window.wsClient.searchCharacters(query, manualModel.value);
                    spellCheckData = responseData.spellCheck || null;
                    
                    // Mark spellcheck service as completed or completed-none based on results
                    if (spellCheckData && spellCheckData.hasErrors && spellCheckData.misspelled && spellCheckData.misspelled.length > 0) {
                        searchServices.set('spellcheck', 'completed');
                    } else {
                        searchServices.set('spellcheck', 'completed-noerrors');
                    }
                    updateSearchStatusDisplay();
                    
                    // For "Text:" searches, we only want spell check results
                    // Clear any other search results
                    searchResults = [];
                } catch (wsError) {
                    console.error('WebSocket spell check failed:', wsError);
                    // Mark spellcheck service as error
                    searchServices.set('spellcheck', 'error');
                    updateSearchStatusDisplay();
                    // Continue without spell check
                }
            }
        }

        // Add search results to the collection (only for non-"Text:" searches)
        if (!isTextPrefixSearch && searchResults.length > 0) {
            searchResultsByService.set('searchResults', searchResults);
        }

        // Rebuild and display all results
        rebuildAndDisplayResults();

        // Note: Spell check is now handled by realtime updates from the server
        
    } catch (error) {
        console.error('Character and tag search error:', error);
        hideCharacterAutocomplete();
        
        // Clear search state on error
        isSearching = false;
        currentSearchQuery = ''; // Reset current search query
        searchServices.clear();
        searchResultsByService.clear();
        allSearchResults = [];
        searchCompletionStatus = {
            totalServices: 0,
            completedServices: 0,
            isComplete: false
        };
        
        // Reset services initialization flag for next autofill session
        servicesInitialized = false;
    }
}

// Unified function to create autocomplete items
function createAutocompleteItem(result) {
    const item = document.createElement('div');
    item.className = 'character-autocomplete-item';

    if (result.type === 'textReplacement') {
        // Handle text replacement results
        item.dataset.type = 'textReplacement';
        item.dataset.placeholder = result.placeholder;
        item.dataset.replacementValue = result.replacementValue || result.description;

        // Use displayName if available, otherwise use placeholder
        let displayName = result.displayName || result.placeholder;
        if (result.category && displayName.startsWith(result.category + ':')) {
            displayName = displayName.slice(result.category.length + 1);
        }

        // Get the replacement value to display
        const replacementValue = result.replacementValue || result.description;
        
        // Create match type indicator
        let matchIndicator = '';
        if (result.matchType && result.matchType !== 'all') {
            const matchTypeLabels = {
                'exact_key': 'Exact Key',
                'key_starts_with': 'Key Starts',
                'key_contains': 'Key Contains',
                'exact_content': 'Exact Content',
                'content_starts_with': 'Content Starts',
                'content_contains': 'Content Contains',
                'exact_array_content': 'Exact Array',
                'array_content_starts_with': 'Array Starts',
                'array_content_contains': 'Array Contains'
            };
            const matchLabel = matchTypeLabels[result.matchType] || result.matchType;
            matchIndicator = `<span class="match-type-badge">${matchLabel}</span>`;
        }

        item.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">${displayName}${matchIndicator}</span>
                <span class="character-copyright">Expander</span>
            </div>
            <div class="character-info-row">
                <div class="placeholder-desc">
                    <span class="placeholder-desc-text">${replacementValue}</span>
                </div>
            </div>
        `;

        item.addEventListener('click', (e) => {
            e.preventDefault();
            selectTextReplacement(result.placeholder);
        });
    } else if (result.type === 'tag') {
        // Handle tag results
        item.dataset.type = 'tag';
        item.dataset.tagName = result.name;
        item.dataset.modelType = result.model.toLowerCase().includes('furry') ? 'furry' : 'anime';

        // Calculate opacity for dots based on counts with logarithmic scaling
        const nCountOpacity = result.count ? Math.min(1, Math.log10(result.count + 1) / Math.log10(10001)) : 0;
        const eCountOpacity = result.e_count ? Math.min(1, Math.log10(result.e_count + 1) / Math.log10(100001)) : 0;
        
        // Create category badge if available
        if (result.isDualMatch) {
            item.classList.add('multi-match');
        }
        const categoryBadgeClass = 'tag-category-badge ' + result.category + '-badge';
        const categoryBadge = result.category ? `<span class="${categoryBadgeClass}">${result.category}</span>` : '';
        
        // Create count dots with enhanced tooltip for dual matches
        let tooltipText = `NovelAI: ${result.count || 0}${result.e_count !== undefined ? `\ne621: ${result.e_count}` : ''}`;
        if (result.isDualMatch && result.apiResult && result.localResult) {
            const localNCount = result.localResult.count || 0;
            const localECount = result.localResult.e_count || 0;
            tooltipText = `NovelAI: ${localNCount}${localECount !== undefined ? `\ne621: ${localECount}` : ''}`;
        }
        
        // Calculate lightness with logarithmic scaling - higher opacity = higher lightness
        const nCountLightness = 15 + (nCountOpacity * 75); // Range: 15% to 90%
        const eCountLightness = 15 + (eCountOpacity * 75); // Range: 15% to 90%
        
        const countDots = `
            <div class="tag-count-dots" title="${tooltipText}">
                <div class="count-dot n-count-dot" style="background: hsl(260, 100%, ${nCountLightness}%, ${nCountOpacity});"></div>
                ${result.e_count !== undefined ? `<div class="count-dot e-count-dot" style="background: hsl(35, 100%, ${eCountLightness}%, ${eCountOpacity});"></div>` : ''}
            </div>
        `;

        // Determine display type and version based on match type
        let displayType = 'Search';
        let displayVersion = '';
        let dataType = '';
        
        if (result.isDualMatch && result.mergedModels) {
            const matchInfo = getMatchType(result.mergedModels);
            displayType = matchInfo.type;
            displayVersion = matchInfo.version;
            dataType = matchInfo.dataType;
            
            // Add appropriate CSS class for styling
            if (displayType === 'Global') {
                item.classList.add('global-match');
            } else if (dataType === 'anime') {
                item.classList.add('anime-match');
                item.dataset.modelType = 'anime';
            } else if (dataType === 'furry') {
                item.classList.add('furry-match');
                item.dataset.modelType = 'furry';
            }
        } else {
            // Regular single model
            displayType = modelKeys[result.model]?.type || 'Search';
            displayVersion = modelKeys[result.model]?.version || '';
        }

        item.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">${result.name}${countDots}${categoryBadge}</span>
                <span class="character-copyright">
                    ${displayVersion ? '<span class="badge">' + displayVersion + '</span> ' : ''}${displayType}
                </span>
            </div>
        `;

        item.addEventListener('click', (e) => {
            e.preventDefault();
            selectTag(result.name);
        });
    } else {
        // Handle character results
        item.dataset.type = 'character';
        item.dataset.characterData = JSON.stringify(result.character);

        // Parse name and copyright from character data
        const character = result.character;
        const name = character.name || result.name;
        const copyright = character.copyright || '';

        item.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">${name}</span>
                <span class="character-copyright">${copyright}</span>
            </div>
        `;

        item.addEventListener('click', (e) => {
            e.preventDefault();
            selectCharacterItem(result.character);
        });
    }

    return item;
}

function showCharacterAutocompleteSuggestions(results, target, spellCheckData = null) {
    if (!characterAutocompleteList || !characterAutocompleteOverlay) {
        console.error('Character autocomplete elements not found');
        return;
    }

    currentCharacterAutocompleteTarget = target;
    
    // Store current selection before clearing (if we have an existing selection)
    if (selectedCharacterAutocompleteIndex >= 0) {
        storeCurrentSelection();
    }
    
    selectedCharacterAutocompleteIndex = -1;

    // Store all results for potential expansion
    window.allAutocompleteResults = results;

    // Filter out spell check results from main display
    const displayResults = results.filter(result => result.type !== 'spellcheck');
    const spellCheckResult = results.find(result => result.type === 'spellcheck');

    // Show all results if expanded, otherwise show only first 5 items
    const limitedResults = autocompleteExpanded ? displayResults : displayResults.slice(0, 5);

    // Clear only the results section, not the entire list
    // This preserves the search status display
    const existingResults = characterAutocompleteList.querySelectorAll('.character-autocomplete-item, .spell-check-section, .no-results, .more-indicator, .character-detail-content');
    existingResults.forEach(item => item.remove());

    // Note: Search status will be added at the bottom after results

    // Handle spell check using the new system
    let currentSpellCheckData = null;
    if (spellCheckResult && spellCheckResult.data && spellCheckResult.data.hasErrors) {
        currentSpellCheckData = spellCheckResult.data;
        window.currentSpellCheckData = currentSpellCheckData;
        persistentSpellCheckData = currentSpellCheckData;
    } else if (spellCheckData && spellCheckData.hasErrors) {
        // Legacy support
        currentSpellCheckData = spellCheckData;
        window.currentSpellCheckData = currentSpellCheckData;
        persistentSpellCheckData = currentSpellCheckData;
    } else if (persistentSpellCheckData && persistentSpellCheckData.hasErrors) {
        // Use persistent spell check data
        currentSpellCheckData = persistentSpellCheckData;
        window.currentSpellCheckData = currentSpellCheckData;
    } else {
        window.currentSpellCheckData = null;
    }

    // Show spell check suggestions if we have spell check data
    if (currentSpellCheckData) {
        showSpellCheckSuggestions(currentSpellCheckData, target);
    }

    // If no results and not searching, show a "no results" message
    if (displayResults.length === 0 && !isSearching) {
        const noResultsItem = document.createElement('div');
        noResultsItem.className = 'character-autocomplete-item no-results';
        noResultsItem.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">No results found</span>
                <span class="character-copyright">Try a different search term</span>
            </div>
        `;
        characterAutocompleteList.appendChild(noResultsItem);
    } else if (displayResults.length > 0) {
        limitedResults.forEach((result, index) => {
            const item = createAutocompleteItem(result);
            characterAutocompleteList.appendChild(item);
        });

        // Add "show more" indicator if there are more results and not expanded
        if (displayResults.length > 5 && !autocompleteExpanded) {
            const moreItem = document.createElement('div');
            moreItem.className = 'character-autocomplete-item more-indicator';
            moreItem.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">Press <i class="fas fa-arrow-down" style="margin: 0 4px; font-size: 0.85em;"></i> to show all ${displayResults.length} results</span>
                </div>
            `;
            characterAutocompleteList.appendChild(moreItem);
        }
    }

    // Position overlay relative to viewport
    const rect = target.getBoundingClientRect();
    characterAutocompleteOverlay.style.left = rect.left + 'px';
    characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
    characterAutocompleteOverlay.style.width = rect.width + 'px';

    characterAutocompleteOverlay.classList.remove('hidden');
    isAutocompleteVisible = true;

    // Auto-select first item if there are results and user is in navigation mode
    if (displayResults.length > 0 && (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0)) {
        // Try to restore previous selection first
        if (lastSelectedItemData && lastSelectedItemType) {
            // Selection will be restored by rebuildAutocompleteDisplay, don't do it here
            console.log('showCharacterAutocompleteSuggestions: Selection persistence active, skipping auto-selection');
        } else {
            // Fallback to first item if no previous selection
            selectedCharacterAutocompleteIndex = 0;
            updateCharacterAutocompleteSelection();
        }
    }
}

// New function for stable autocomplete updates
function updateAutocompleteDisplay(results, target) {
    if (!characterAutocompleteList || !characterAutocompleteOverlay) {
        console.error('Character autocomplete elements not found');
        return;
    }

    // Store results for potential expansion
    window.allAutocompleteResults = results;

    // Filter out spell check results from main display
    const displayResults = results.filter(result => result.type !== 'spellcheck');
    const spellCheckResult = results.find(result => result.type === 'spellcheck');

    // Show all results if expanded, otherwise show only first 5 items
    const limitedResults = autocompleteExpanded ? displayResults : displayResults.slice(0, 5);
    
    // Always rebuild the display when we have new results
    // This ensures we show the latest results from all services
    rebuildAutocompleteDisplay(displayResults, limitedResults, spellCheckResult, target);

    // Ensure overlay is positioned and visible
    if (!isAutocompleteVisible) {
        const rect = target.getBoundingClientRect();
        characterAutocompleteOverlay.style.left = rect.left + 'px';
        characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
        characterAutocompleteOverlay.style.width = rect.width + 'px';
        characterAutocompleteOverlay.classList.remove('hidden');
        isAutocompleteVisible = true;
    }

    // Auto-select first item if there are results and user is in navigation mode
    if (displayResults.length > 0 && (autocompleteNavigationMode || selectedCharacterAutocompleteIndex >= 0)) {
        // Try to restore previous selection first
        if (lastSelectedItemData && lastSelectedItemType) {
            // Selection will be restored by rebuildAutocompleteDisplay, don't do it here
            console.log('updateAutocompleteDisplay: Selection persistence active, skipping auto-selection');
        } else {
            // Fallback to first item if no previous selection
            selectedCharacterAutocompleteIndex = 0;
            updateCharacterAutocompleteSelection();
        }
    }
}

// Store current selection for restoration after content updates
function storeCurrentSelection() {
    if (selectedCharacterAutocompleteIndex >= 0 && characterAutocompleteList) {
        const items = characterAutocompleteList.querySelectorAll('.character-autocomplete-item');
        if (items[selectedCharacterAutocompleteIndex]) {
            const selectedItem = items[selectedCharacterAutocompleteIndex];
            const type = selectedItem.dataset.type;
                        
            if (type === 'tag') {
                lastSelectedItemData = {
                    type: 'tag',
                    name: selectedItem.dataset.tagName,
                    model: selectedItem.dataset.modelType
                };
                lastSelectedItemType = 'tag';
            } else if (type === 'character') {
                try {
                    const characterData = JSON.parse(selectedItem.dataset.characterData);
                    lastSelectedItemData = {
                        type: 'character',
                        name: characterData.name,
                        copyright: characterData.copyright
                    };
                    lastSelectedItemType = 'character';
                } catch (e) {
                    console.warn('Failed to parse character data for selection persistence:', e);
                }
            } else if (type === 'textReplacement') {
                lastSelectedItemData = {
                    type: 'textReplacement',
                    placeholder: selectedItem.dataset.placeholder
                };
                lastSelectedItemType = 'textReplacement';
            }
        }
    }
}

// Restore selection after content updates
function restoreSelection(displayResults) {
    if (!lastSelectedItemData || !lastSelectedItemType || !characterAutocompleteList) {
        return;
    }
    
    const items = characterAutocompleteList.querySelectorAll('.character-autocomplete-item');
    
    let foundIndex = -1;
    
    // Find the item that matches our stored selection
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const type = item.dataset.type;
        
        if (type === lastSelectedItemType) {
            let matches = false;
            
            if (type === 'tag' && lastSelectedItemData.name === item.dataset.tagName) {
                matches = true;
            } else if (type === 'character' && lastSelectedItemData.name === JSON.parse(item.dataset.characterData).name) {
                matches = true;
            } else if (type === 'textReplacement' && lastSelectedItemData.placeholder === item.dataset.placeholder) {
                matches = true;
            }
            
            if (matches) {
                foundIndex = i;
                break;
            }
        }
    }
    
    // If we found a match, restore the selection
    if (foundIndex >= 0) {
        selectedCharacterAutocompleteIndex = foundIndex;
        updateCharacterAutocompleteSelection();
    } else {
        // If no match found, try to find a similar item or reset to first
        selectedCharacterAutocompleteIndex = 0;
        updateCharacterAutocompleteSelection();
    }
    
    // Clear stored selection data
    lastSelectedItemData = null;
    lastSelectedItemType = null;
}

// New function to rebuild the autocomplete display
function rebuildAutocompleteDisplay(displayResults, limitedResults, spellCheckResult, target) {    
    // Store current selection before clearing
    storeCurrentSelection();
    
    // Clear only the results section, not the entire list
    // This preserves the search status display
    const existingResults = characterAutocompleteList.querySelectorAll('.character-autocomplete-item, .spell-check-section, .no-results, .more-indicator, .character-detail-content');
    existingResults.forEach(item => item.remove());

    // Note: Search status will be added at the bottom after results

    // Handle spell check from the merged results system
    let currentSpellCheckData = null;
    if (spellCheckResult && spellCheckResult.data && spellCheckResult.data.hasErrors) {
        currentSpellCheckData = spellCheckResult.data;
        window.currentSpellCheckData = currentSpellCheckData;
        persistentSpellCheckData = currentSpellCheckData;
    } else {
        // Fallback to persistent spell check data if no new spell check result
        if (persistentSpellCheckData && persistentSpellCheckData.hasErrors) {
            currentSpellCheckData = persistentSpellCheckData;
            window.currentSpellCheckData = currentSpellCheckData;
        } else {
            window.currentSpellCheckData = null;
            persistentSpellCheckData = null;
        }
    }

    // Show spell check suggestions if we have spell check data
    if (currentSpellCheckData) {
        showSpellCheckSuggestions(currentSpellCheckData, target);
    }

    // If no results and not searching, show a "no results" message
    if (displayResults.length === 0 && !isSearching) {
        const noResultsItem = document.createElement('div');
        noResultsItem.className = 'character-autocomplete-item no-results';
        noResultsItem.innerHTML = `
            <div class="character-info-row">
                <span class="character-name">No results found</span>
                <span class="character-copyright">Try a different search term</span>
            </div>
        `;
        characterAutocompleteList.appendChild(noResultsItem);
    } else if (displayResults.length > 0) {
        limitedResults.forEach((result, index) => {
            const item = createAutocompleteItem(result);
            characterAutocompleteList.appendChild(item);
        });

        // Add "show more" indicator if there are more results and not expanded
        if (displayResults.length > 5 && !autocompleteExpanded) {
            const moreItem = document.createElement('div');
            moreItem.className = 'character-autocomplete-item more-indicator';
            moreItem.innerHTML = `
                <div class="character-info-row">
                    <span class="character-name">Press <i class="fas fa-arrow-down" style="margin: 0 4px; font-size: 0.85em;"></i> to show all ${displayResults.length} results</span>
                </div>
            `;
            characterAutocompleteList.appendChild(moreItem);
        }
        
        // Restore selection after rebuilding the display
        // Use a small delay to ensure DOM elements are fully created
        setTimeout(() => {
            restoreSelection(displayResults);
        }, 10);
    }
    
    // Add search status at the bottom if we're currently searching
    if (isSearching && searchServices.size > 0) {
        updateSearchStatusDisplay();
    }
}

function showSpellCheckSuggestions(spellCheckData, target) {
    if (!spellCheckData.misspelled || spellCheckData.misspelled.length === 0) {
        return;
    }

    // Remove any existing spell check section
    const existingSpellCheckSection = document.querySelector('.spell-check-section');
    if (existingSpellCheckSection) {
        existingSpellCheckSection.remove();
    }

    // Create spell check section
    const spellCheckSection = document.createElement('div');
    spellCheckSection.className = 'spell-check-section';
    spellCheckSection.innerHTML = `
        <div class="spell-check-header">
            <i class="fas fa-spell-check"></i>
            <span>Spell Check</span>
            ${spellCheckData.originalText ? `<div class="original-text">"${spellCheckData.originalText}"</div>` : ''}
        </div>
    `;

    // Add suggestions for each misspelled word
    spellCheckData.misspelled.forEach(word => {
        const suggestions = spellCheckData.suggestions[word] || [];
        
        const wordSection = document.createElement('div');
        wordSection.className = 'spell-check-word';
        wordSection.innerHTML = `
            <div class="misspelled-word">"${word}"</div>
            <div class="suggestions-list">
                ${suggestions.map(suggestion => `
                    <button class="suggestion-btn" data-original="${word}" data-suggestion="${suggestion}">
                        ${suggestion}
                    </button>
                `).join('')}
                <button class="add-word-btn" data-word="${word}">
                    <i class="fas fa-plus"></i> Add
                </button>
            </div>
        `;

        // Add event listeners for suggestions
        wordSection.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.addEventListener('click', (e) => {
                e.preventDefault();
                applySpellCorrection(target, btn.dataset.original, btn.dataset.suggestion);
            });
        });

        // Add event listener for adding word to dictionary
        wordSection.querySelector('.add-word-btn').addEventListener('click', (e) => {
            e.preventDefault();
            addWordToDictionary(word);
        });

        spellCheckSection.appendChild(wordSection);
    });

    // Insert spell check section at the top of the autocomplete list
    characterAutocompleteList.insertBefore(spellCheckSection, characterAutocompleteList.firstChild);
}

function applySpellCorrection(target, originalWord, suggestion) {
    const currentValue = target.value;
    const cursorPos = target.selectionStart;
    
    // Store the original cursor position for restoration
    const originalCursorPos = cursorPos;
    
    // Check if this is a "Text:" prefixed query
    const textPrefixIndex = currentValue.lastIndexOf('Text:');
    const isTextQuery = textPrefixIndex >= 0;
    
    // First, try to find the exact word at or near the cursor position
    // This is more reliable than regex matching for word boundaries
    const textBeforeCursor = currentValue.substring(0, cursorPos);
    const textAfterCursor = currentValue.substring(cursorPos);
    
    // Find word boundaries around cursor
    const beforeMatch = textBeforeCursor.match(/\b\w*$/);
    const afterMatch = textAfterCursor.match(/^\w*\b/);
    
    let wordStart = cursorPos;
    let wordEnd = cursorPos;
    
    if (beforeMatch && beforeMatch[0]) {
        wordStart = cursorPos - beforeMatch[0].length;
    }
    if (afterMatch && afterMatch[0]) {
        wordEnd = cursorPos + afterMatch[0].length;
    }
    
    // Get the word at cursor position
    const wordAtCursor = currentValue.substring(wordStart, wordEnd);
    
    // Check if the word at cursor matches the original word (case-insensitive)
    if (wordAtCursor.toLowerCase() === originalWord.toLowerCase()) {
        // Replace the word at cursor position
        const beforeWord = currentValue.substring(0, wordStart);
        const afterWord = currentValue.substring(wordEnd);
        const newValue = beforeWord + suggestion + afterWord;
        
        // Calculate the length difference for cursor adjustment
        const lengthDifference = suggestion.length - originalWord.length;
        
        target.value = newValue;
        
        // Calculate new cursor position - adjust for the length difference
        const newCursorPos = originalCursorPos + lengthDifference;
        
        // Set cursor position after the replacement
        setTimeout(() => {
            target.setSelectionRange(newCursorPos, newCursorPos);
            target.focus();
        }, 0);
        
        // Trigger search with corrected text
        const event = new Event('input', { bubbles: true });
        target.dispatchEvent(event);
        
        // Hide autocomplete and mark as not expanded to fix keyboard navigation issue
        hideCharacterAutocomplete();
        return;
    }
    
    // If word at cursor doesn't match, try to find the closest occurrence
    // Use a more flexible word finding approach that doesn't require strict word boundaries
    const wordRegex = new RegExp(`\\b${originalWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let match;
    let closestDistance = Infinity;
    let closestMatch = null;
    
    // Find all occurrences and determine the closest one to cursor
    while ((match = wordRegex.exec(currentValue)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        
        // For "Text:" queries, only consider words after the prefix
        if (isTextQuery && matchStart < textPrefixIndex + 5) {
            continue;
        }
        
        // Calculate distance from cursor to word center
        const wordCenter = matchStart + (match[0].length / 2);
        const distance = Math.abs(cursorPos - wordCenter);
        
        if (distance < closestDistance) {
            closestDistance = distance;
            closestMatch = {
                start: matchStart,
                end: matchEnd,
                word: match[0]
            };
        }
    }
    
    if (closestMatch) {
        // Replace the word
        const beforeWord = currentValue.substring(0, closestMatch.start);
        const afterWord = currentValue.substring(closestMatch.end);
        const newValue = beforeWord + suggestion + afterWord;
        
        // Calculate the length difference for cursor adjustment
        const lengthDifference = suggestion.length - closestMatch.word.length;
        
        target.value = newValue;
        
        // Calculate new cursor position - adjust for the length difference
        const newCursorPos = originalCursorPos + lengthDifference;
        
        // Set cursor position after the replacement
        setTimeout(() => {
            target.setSelectionRange(newCursorPos, newCursorPos);
            target.focus();
        }, 0);
        
        // Trigger search with corrected text
        const event = new Event('input', { bubbles: true });
        target.dispatchEvent(event);
        
        // Hide autocomplete and mark as not expanded to fix keyboard navigation issue
        hideCharacterAutocomplete();
    } else {
        // Final fallback: if we can't find the word, try the old method
        const words = currentValue.split(/\b/);
        let currentPos = 0;
        let wordIndex = -1;
        let wordStartPos = 0;
        
        for (let i = 0; i < words.length; i++) {
            const word = words[i];
            if (word.toLowerCase() === originalWord.toLowerCase() && 
                currentPos <= cursorPos && 
                currentPos + word.length >= cursorPos) {
                wordIndex = i;
                wordStartPos = currentPos;
                break;
            }
            currentPos += word.length;
        }
        
        if (wordIndex !== -1) {
            // Replace the word
            words[wordIndex] = suggestion;
            const newValue = words.join('');
            
            // Calculate the length difference for cursor adjustment
            const lengthDifference = suggestion.length - originalWord.length;
            
            target.value = newValue;
            
            // Calculate new cursor position - adjust for the length difference
            const newCursorPos = originalCursorPos + lengthDifference;
            
            // Set cursor position after the replacement
            setTimeout(() => {
                target.setSelectionRange(newCursorPos, newCursorPos);
                target.focus();
            }, 0);
            
            // Trigger search with corrected text
            const event = new Event('input', { bubbles: true });
            target.dispatchEvent(event);
            
            // Hide autocomplete and mark as not expanded to fix keyboard navigation issue
            hideCharacterAutocomplete();
        } else {
            // If all else fails, show an error message
            console.error(`Could not find word "${originalWord}" to replace`);
            if (typeof showGlassToast === 'function') {
                showGlassToast('error', null, `Could not find "${originalWord}" to replace`, false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
            }
        }
    }
}

async function addWordToDictionary(word) {
    try {
        let success = false;
        
        // Use WebSocket for adding words
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                const result = await window.wsClient.addWordToDictionary(word);
                success = result.success;
            } catch (wsError) {
                console.error('WebSocket add word failed:', wsError);
                throw new Error('Failed to add word to dictionary');
            }
        } else {
            throw new Error('WebSocket not connected');
        }

        if (success) {
            // Show success message
            const successMsg = document.createElement('div');
            successMsg.className = 'spell-check-success';
            successMsg.textContent = `Added "${word}" to dictionary`;
            successMsg.style.cssText = `
                position: fixed;
                top: 20px;
                right: 20px;
                background: #4CAF50;
                color: white;
                padding: 10px 15px;
                border-radius: 5px;
                z-index: 10000;
                font-size: 14px;
            `;
            document.body.appendChild(successMsg);
            
            // Remove after 3 seconds
            setTimeout(() => {
                if (successMsg.parentNode) {
                    successMsg.parentNode.removeChild(successMsg);
                }
            }, 3000);
            
            // Refresh search to update spell check
            const target = currentCharacterAutocompleteTarget;
            if (target) {
                const event = new Event('input', { bubbles: true });
                target.dispatchEvent(event);
            }
        } else {
            console.error('Failed to add word to dictionary');
        }
    } catch (error) {
        console.error('Error adding word to dictionary:', error);
    }
}

// Helper function to scroll to an option and center it in the view
function scrollToAutocompleteOption(optionElement) {
    if (!optionElement) return;
    
    // Find the scrollable container - the overlay is the scrollable container
    const menu = optionElement.closest('.character-autocomplete-overlay');
    if (!menu) return;
    
    // Get the menu dimensions
    const menuRect = menu.getBoundingClientRect();
    const optionRect = optionElement.getBoundingClientRect();
    
    // Calculate the scroll position to center the option
    const menuHeight = menuRect.height;
    const optionTop = optionElement.offsetTop;
    const optionHeight = optionElement.offsetHeight;
    
    // Center the option in the menu
    const scrollTop = optionTop - (menuHeight / 2) + (optionHeight / 2);
    
    // Ensure scroll position is within bounds
    const maxScroll = menu.scrollHeight - menuHeight;
    const finalScrollTop = Math.max(0, Math.min(scrollTop, maxScroll));
    
    // Only scroll if the menu has a scrollable height
    if (menu.scrollHeight > menuHeight) {
        menu.scrollTop = finalScrollTop;
    }
}

function updateCharacterAutocompleteSelection() {
    if (!characterAutocompleteList) return;

    const items = characterAutocompleteList.querySelectorAll('.character-autocomplete-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedCharacterAutocompleteIndex);
    });

    // Scroll the selected item into view and center it
    if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
        const selectedItem = items[selectedCharacterAutocompleteIndex];
        scrollToAutocompleteOption(selectedItem);
    }
}

function selectCharacterItem(character) {
    try {
        showCharacterDetail(character);
    } catch (error) {
        console.error('Error displaying character data:', error);
        showError('Failed to display character data');
    }
}

function selectTextReplacement(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text before the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the placeholder wrapped in exclamation mark format
    const wrappedPlaceholder = `!${placeholder}`;
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + wrappedPlaceholder;
        } else {
            newPrompt += wrappedPlaceholder;
        }
    } else {
        newPrompt = wrappedPlaceholder;
    }

    // Check if we're at the end of an emphasis block or brace block
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    const isAtEndOfEmphasis = textAfter.startsWith('::');
    const isAtEndOfBrace = textAfter.startsWith('}') || textAfter.startsWith(']');
    
    // Add comma and space after tag unless at end of emphasis or brace block
    if (textAfter && !isAtEndOfEmphasis && !isAtEndOfBrace) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    } else if (textAfter) {
        // At end of emphasis or brace block, don't add comma
        newPrompt += textAfter;
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted placeholder
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function insertTextReplacement(actualText) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the actual text (not wrapped in angle brackets)
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + actualText;
        } else {
            newPrompt += actualText;
        }
    } else {
        newPrompt = actualText;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaAfter(currentValue, cursorPosition)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTag(tagName) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text before the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the tag name
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + tagName;
        } else {
            newPrompt += tagName;
        }
    } else {
        newPrompt = tagName;
    }

    // Check if we're at the end of an emphasis block or brace block
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    const isAtEndOfEmphasis = textAfter.startsWith('::');
    const isAtEndOfBrace = textAfter.startsWith('}') || textAfter.startsWith(']');
    
    // Add comma and space after tag unless at end of emphasis or brace block
    if (textAfter && !isAtEndOfEmphasis && !isAtEndOfBrace) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaAfter(currentValue, cursorPosition)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    } else if (textAfter) {
        // At end of emphasis or brace block, don't add comma
        newPrompt += textAfter;
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted tag
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectTextReplacementFullText(placeholder) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the full text replacement description
    const fullText = window.optionsData?.textReplacements[placeholder];
    if (newPrompt) {
        // Check if we should add a comma before the text
        if (shouldAddCommaBefore(currentValue, cursorPosition)) {
            newPrompt += ', ' + fullText;
        } else {
            newPrompt += fullText;
        }
    } else {
        newPrompt = fullText;
    }

    // Add the text after the cursor (trim any leading delimiters and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        // Check if we should add a comma after the inserted text
        if (shouldAddCommaAfter(currentValue, cursorPosition)) {
            newPrompt += ', ' + textAfter;
        } else {
            newPrompt += textAfter;
        }
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function selectCharacterWithoutEnhancers(character) {
    try {
        if (!currentCharacterAutocompleteTarget) return;

        const target = currentCharacterAutocompleteTarget;
        const currentValue = target.value;
        const cursorPosition = target.selectionStart;

        // Get the text before the cursor
        const textBeforeCursor = currentValue.substring(0, cursorPosition);

        // Find the last delimiter (:, |, ,) before the cursor, or start from the beginning
        const lastDelimiterIndex = Math.max(
            textBeforeCursor.lastIndexOf('{'),
            textBeforeCursor.lastIndexOf('}'),
            textBeforeCursor.lastIndexOf('['),
            textBeforeCursor.lastIndexOf(']'),
            textBeforeCursor.lastIndexOf(':'),
            textBeforeCursor.lastIndexOf('|'),
            textBeforeCursor.lastIndexOf(',')
        );
        const startOfCurrentTerm = lastDelimiterIndex >= 0 ? lastDelimiterIndex + 1 : 0;

        // Get the text after the cursor
        const textAfterCursor = currentValue.substring(cursorPosition);

        // Build the new prompt
        let newPrompt = '';

        // Keep the text before the current term (trim any trailing delimiters and spaces)
        const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
        newPrompt = textBefore;

        // Add just the character prompt without any enhancers
        if (character.prompt) {
            if (newPrompt) {
                // Check if we should add a comma before the text
                if (shouldAddCommaBefore(currentValue, cursorPosition)) {
                    newPrompt += ', ' + character.prompt;
                } else {
                    newPrompt += character.prompt;
                }
            } else {
                newPrompt = character.prompt;
            }
        }

        // Add the text after the cursor (trim any leading delimiters and spaces)
        const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
        if (textAfter) {
            if (newPrompt) {
                // Check if we should add a comma after the inserted text
                if (shouldAddCommaAfter(currentValue, cursorPosition)) {
                    newPrompt += ', ' + textAfter;
                } else {
                    newPrompt += textAfter;
                }
            } else {
                newPrompt = textAfter;
            }
        }

        // Update the target field
        target.value = newPrompt;

        // Set cursor position after the inserted text
        const newCursorPosition = newPrompt.length - textAfter.length;
        target.setSelectionRange(newCursorPosition, newCursorPosition);

        // Hide character autocomplete and mark as not expanded to fix keyboard navigation issue
        hideCharacterAutocomplete();

        // Focus back on the target field
        if (target) {
            target.focus();
            autoResizeTextarea(target);
            updateEmphasisHighlighting(target);
        }
    } catch (error) {
        console.error('Error loading character data:', error);
        showError('Failed to load character data');
    }
}

function showCharacterDetail(character) {
    try {
        // Reset selected enhancer group index
        selectedEnhancerGroupIndex = -1;

        // Instead of using a separate overlay, replace the content inside the existing autocomplete overlay
        const autocompleteList = document.querySelector('.character-autocomplete-list');

        if (!autocompleteList) {
            console.error('Character autocomplete list not found');
            return;
        }

        // Create enhancers HTML
        let enhancersHTML = '';

        // Add "None" option first
        enhancersHTML += `
            <div class="enhancer-group" 
                 data-enhancer-group="null" 
                 data-character='${JSON.stringify(character)}'
                 onclick="selectEnhancerGroupFromDetail(null, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                <div class="enhancer-group-header">
                    <span class="enhancer-group-name">None</span>
                    <span class="enhancer-group-count">0</span>
                </div>
            </div>
        `;

        // Ensure character.enhancers exists and is an array
        if (character.enhancers && Array.isArray(character.enhancers)) {
            // Add enhancer groups
            character.enhancers.forEach((enhancerGroup, groupIndex) => {
                // Handle mixed structure: convert strings to single-item arrays
                let processedGroup;
                if (typeof enhancerGroup === 'string') {
                    // Convert string to single-item array
                    processedGroup = [enhancerGroup];
                } else if (Array.isArray(enhancerGroup)) {
                    // Already an array, use as-is
                    processedGroup = enhancerGroup;
                } else {
                    console.warn(`Enhancer group ${groupIndex} is neither string nor array:`, enhancerGroup);
                    return; // Skip this group
                }

                enhancersHTML += `
                    <div class="enhancer-group" 
                         data-enhancer-group='${JSON.stringify(processedGroup)}'
                         data-character='${JSON.stringify(character)}'
                         onclick="selectEnhancerGroupFromDetail(${JSON.stringify(processedGroup).replace(/"/g, '&quot;')}, ${JSON.stringify(character).replace(/"/g, '&quot;')})">
                        <div class="enhancer-group-header">
                            <span class="enhancer-group-name">Group ${groupIndex + 1}</span>
                            <span class="enhancer-group-count">${processedGroup.length}</span>
                        </div>
                        <div class="enhancer-items">
                            ${processedGroup.map(item => {
                                // Ensure item is a string
                                if (typeof item !== 'string') {
                                    console.warn(`Enhancer item is not a string:`, item);
                                    return '';
                                }
                                const isNegative = item.startsWith('--');
                                const displayItem = isNegative ? item.substring(2) : item;
                                return `<span class="enhancer-item ${isNegative ? 'negative' : ''}">${displayItem}</span>`;
                            }).join('')}
                        </div>
                    </div>
                `;
            });
        } else {
            enhancersHTML += '<div class="no-enhancers">No enhancers available</div>';
        }

        // Replace the autocomplete content with character detail
        autocompleteList.innerHTML = `
            <div class="character-detail-content">
                <div class="character-detail-header">
                    <div class="character-name-copyright">
                        <span class="character-name">${character.name || 'Unknown Character'}</span>
                        <span class="character-copyright">${character.copyright || ''}</span>
                    </div>
                    <button class="close-character-detail" onclick="hideCharacterDetail()">&times;</button>
                </div>
                <div class="character-detail-body">
                    <div class="character-prompt">
                        <strong>Prompt:</strong> <span>${character.prompt || 'No prompt available'}</span>
                    </div>
                    <div class="character-enhancers">
                        <strong>Enhancers:</strong>
                        <div class="enhancers-list">
                            ${enhancersHTML}
                        </div>
                    </div>
                </div>
            </div>
        `;

        // Ensure the autocomplete overlay maintains its width
        if (characterAutocompleteOverlay) {
            characterAutocompleteOverlay.style.width = characterAutocompleteOverlay.style.width || '400px';
        }

        // The autocomplete overlay is already visible, so no need to show/hide anything
    } catch (error) {
        console.error('Error showing character detail:', error);
        console.error('Character that caused error:', character);
        showError('Failed to display character details');
    }
}

function selectEnhancerGroup(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;

    // Update the target field with character prompt
    if (character.prompt) {
        target.value = character.prompt;
    }

    // Add enhancer items to the prompt if selected
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const currentPrompt = target.value;
        const enhancerText = enhancerGroup.join(', ');
        target.value = currentPrompt + ', ' + enhancerText;
    }

    // Hide character detail overlay and autocomplete
    hideCharacterDetail();
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        updateEmphasisHighlighting(target);
    }
}

function selectEnhancerGroupFromDetail(enhancerGroup, character) {
    if (!currentCharacterAutocompleteTarget) return;

    const target = currentCharacterAutocompleteTarget;
    const currentValue = target.value;
    const cursorPosition = target.selectionStart;

    // Get the text before the cursor
    const textBeforeCursor = currentValue.substring(0, cursorPosition);

    // Find the last comma before the cursor, or start from the beginning
    const lastCommaIndex = textBeforeCursor.lastIndexOf(',');
    const startOfCurrentTerm = lastCommaIndex >= 0 ? lastCommaIndex + 1 : 0;

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing commas and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add character prompt if this is the first item or we're at the beginning
    if (character.prompt) {
        if (startOfCurrentTerm === 0) {
            // This is the first item, use the character prompt
            newPrompt = character.prompt;
        } else {
            // Add character prompt after existing text
            if (newPrompt) {
                // Check if we should add a comma before the text
                if (shouldAddCommaBefore(currentValue, cursorPosition)) {
                    newPrompt += ', ' + character.prompt;
                } else {
                    newPrompt += character.prompt;
                }
            } else {
                newPrompt = character.prompt;
            }
        }
    }

    // Add enhancer items if selected
    if (enhancerGroup && Array.isArray(enhancerGroup) && enhancerGroup.length > 0) {
        const enhancerText = enhancerGroup.join(', ');
        if (newPrompt) {
            // Check if we should add a comma before the text
            if (shouldAddCommaBefore(currentValue, cursorPosition)) {
                newPrompt += ', ' + enhancerText;
            } else {
                newPrompt += enhancerText;
            }
        } else {
            newPrompt = enhancerText;
        }
    }

    // Add the text after the cursor (trim any leading commas and spaces)
    const textAfter = textAfterCursor.replace(/^[,\s]*/, '');
    if (textAfter) {
        if (newPrompt) {
            // Check if we should add a comma after the inserted text
            if (shouldAddCommaAfter(currentValue, cursorPosition)) {
                newPrompt += ', ' + textAfter;
            } else {
                newPrompt += textAfter;
            }
        } else {
            newPrompt = textAfter;
        }
    }

    // Update the target field
    target.value = newPrompt;

    // Set cursor position after the inserted text
    const newCursorPosition = newPrompt.length - textAfter.length;
    target.setSelectionRange(newCursorPosition, newCursorPosition);

    // Hide character autocomplete (which now contains the detail view)
    hideCharacterAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
        autoResizeTextarea(target);
        updateEmphasisHighlighting(target);
    }
}

function applyFormattedText(textarea, lostFocus) {
    // Store cursor position if textarea is in focus
    const cursorPosition = !lostFocus ? textarea.selectionStart : -1;

    let text = textarea.value;

    // Process text based on focus state
    if (lostFocus) {
        // When losing focus, clean up the text
        text = text
            .split('|').map(item => item.trim()).filter(Boolean).join(' | ');

        // Handle comma splitting more carefully to preserve :: groups
        // First, protect :: groups by temporarily replacing them
        const emphasisGroups = [];
        let emphasisCounter = 0;
        text = text.replace(/(-?\d+\.?\d*)::([^:]+)::/g, (match, weight, content) => {
            const placeholder = `__EMPHASIS_${emphasisCounter}__`;
            emphasisGroups.push({ placeholder, match });
            emphasisCounter++;
            return placeholder;
        });

        // Now split by commas, but be careful not to split within protected groups
        const commaParts = text.split(',').map(item => item.trim()).filter(Boolean);
        text = commaParts.join(', ');

        // Restore emphasis groups
        emphasisGroups.forEach(({ placeholder, match }) => {
            text = text.replace(placeholder, match);
        });

        // Remove leading | or , and trim start
        text = text.replace(/^(\||,)+\s*/, '');
    } else {
        // When focused, just clean up basic formatting
        text = text
            .split('|').map(item => item.trim()).join(' | ');

        // Handle comma splitting more carefully to preserve :: groups
        // First, protect :: groups by temporarily replacing them
        const emphasisGroups = [];
        let emphasisCounter = 0;
        text = text.replace(/(-?\d+\.?\d*)::([^:]+)::/g, (match, weight, content) => {
            const placeholder = `__EMPHASIS_${emphasisCounter}__`;
            emphasisGroups.push({ placeholder, match });
            emphasisCounter++;
            return placeholder;
        });

        // Now split by commas, but be careful not to split within protected groups
        const commaParts = text.split(',').map(item => item.trim()).join(', ');
        text = commaParts;

        // Restore emphasis groups
        emphasisGroups.forEach(({ placeholder, match }) => {
            text = text.replace(placeholder, match);
        });
    }

    // Fix curly brace groups: ensure each group has equal number of { and }
    // Only process if there is a "}," to terminate it
    if (text.includes('},')) {
        text = text.replace(/(\{+)([^{}]*)(\}*)/g, (match, openBraces, content, closeBraces, offset, str) => {
            const after = str.slice(offset + match.length, offset + match.length + 1);
            if (closeBraces.length > 0 && after === ',') {
                const openCount = openBraces.length;
                return openBraces + content + '}'.repeat(openCount);
            }
            return match;
        });
    }

    // Fix square bracket groups: ensure each group has equal number of [ and ]
    // Only process if there is "]," to terminate it
    if (text.includes('],')) {
        text = text.replace(/(\[+)([^\[\]]*)(\]*)/g, (match, openBrackets, content, closeBrackets, offset, str) => {
            const after = str.slice(offset + match.length, offset + match.length + 1);
            if (closeBrackets.length > 0 && after === ',') {
                const openCount = openBrackets.length;
                return openBrackets + content + ']'.repeat(openCount);
            }
            return match;
        });
    }

    // If not focused, remove empty tags (consecutive commas with only spaces between)
    if (lostFocus) {
        // Remove any sequence of commas (with any amount of spaces between) that does not have text between them
        // e.g. ",   ,", ", ,", ",,"
        text = text.replace(/(?:^|,)\s*(?=,|$)/g, ''); // Remove empty segments
        // Remove any leading or trailing commas left after cleanup
        text = text.replace(/^,|,$/g, '');
        // Remove extra spaces after cleanup
        text = text.replace(/,\s+/g, ', ');
        text = text.replace(/\s+,/g, ',');
    }

    textarea.value = text;

    // Restore cursor position if textarea was in focus
    if (!lostFocus && cursorPosition >= 0) {
        // Ensure cursor position doesn't exceed the new text length
        const newPosition = Math.min(cursorPosition, text.length);
        textarea.setSelectionRange(newPosition, newPosition);
        textarea.focus();
    }
}

// Helper function to check if cursor is inside a :: emphasis group (between the :: markers)
function isInsideEmphasisGroup(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const textAfterCursor = text.substring(cursorPosition);
    
    // Find the last :: before cursor
    const lastDoubleColonBefore = textBeforeCursor.lastIndexOf('::');
    // Find the first :: after cursor
    const firstDoubleColonAfter = textAfterCursor.indexOf('::');
    
    // If we have :: before and after, we're inside an emphasis group
    // But we need to make sure we're not at the start or end of the group
    if (lastDoubleColonBefore === -1 || firstDoubleColonAfter === -1) {
        return false;
    }
    
    // Check if we're at the start of the group (right after opening ::)
    if (isAtStartOfEmphasisGroup(text, cursorPosition)) {
        return false;
    }
    
    // Check if we're at the end of the group (right before closing ::)
    if (isAtEndOfEmphasisGroupBefore(text, cursorPosition)) {
        return false;
    }
    
    return true;
}

// Helper function to check if cursor is at the start of a :: emphasis group (right after opening ::)
function isAtStartOfEmphasisGroup(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const trimmed = textBeforeCursor.trim();
    
    // Look for the pattern: weight:: at the end of text before cursor
    const emphasisStartPattern = /(-?\d+\.?\d*)::$/;
    const result = emphasisStartPattern.test(trimmed);
    
    // If the pattern doesn't match at the end, check if we're right after a weight:: pattern
    if (!result) {
        // Look for the last occurrence of weight:: in the text before cursor
        const lastWeightPattern = trimmed.match(/(-?\d+\.?\d*)::/g);
        if (lastWeightPattern) {
            const lastMatch = lastWeightPattern[lastWeightPattern.length - 1];
            const lastMatchIndex = trimmed.lastIndexOf(lastMatch);
            
            // Check if the cursor is right after this weight:: pattern
            if (lastMatchIndex + lastMatch.length === trimmed.length) {
                return true;
            } else {
                // Check if we're inside an emphasis group and at the start of its content
                const textAfterWeight = trimmed.substring(lastMatchIndex + lastMatch.length);
                
                // If the text after the weight:: is just whitespace or very short, 
                // we might be at the start of the emphasis group content
                if (textAfterWeight.trim().length <= 10) { // Allow for some short content
                    return true;
                }
            }
        }
    }
    
    return result;
}

// Helper function to check if cursor is at the end of an emphasis group (right before closing ::)
function isAtEndOfEmphasisGroupBefore(text, cursorPosition) {
    const textAfterCursor = text.substring(cursorPosition);
    
    // Look for the pattern: :: right after cursor
    return textAfterCursor.trim().startsWith('::');
}

// Helper function to check if cursor is at the end of a :: emphasis group (right after closing ::)
function isAtEndOfEmphasisGroup(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    
    // Look for the pattern: :: at the end of text before cursor
    return textBeforeCursor.trim().endsWith('::');
}

// Helper function to check if we should add a comma before inserting text
function shouldAddCommaBefore(text, cursorPosition) {
    const textBeforeCursor = text.substring(0, cursorPosition);
    const trimmed = textBeforeCursor.trim();
    
    // Don't add comma if:
    // 1. We're at the start of text
    if (trimmed === '') return false;
    
    // 2. We're at the start of an emphasis group (right after opening ::)
    if (isAtStartOfEmphasisGroup(text, cursorPosition)) return false;
    
    // 3. We're at the end of a line with : or |
    if (trimmed.endsWith(':') && !trimmed.endsWith('::')) return false;
    if (trimmed.endsWith('|')) return false;
    
    // Add comma in all other cases (including inside emphasis groups and at the end of emphasis groups)
    return true;
}

// Helper function to check if we should add a comma after inserting text
function shouldAddCommaAfter(text, cursorPosition) {
    const textAfterCursor = text.substring(cursorPosition);
    const trimmed = textAfterCursor.trim();
    
    // Don't add comma if:
    // 1. We're at the end of text
    if (trimmed === '') return false;
    
    // 2. We're at the end of an emphasis group (right before closing ::)
    if (isAtEndOfEmphasisGroupBefore(text, cursorPosition)) {
        return false;
    }
    
    // Add comma in all other cases (including inside emphasis groups)
    return true;
}

function handleCharacterDetailArrowKeys(key) {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (enhancerGroups.length === 0) return;

    // Remove previous selection
    enhancerGroups.forEach(group => group.classList.remove('selected'));

    if (key === 'ArrowUp') {
        selectedEnhancerGroupIndex = selectedEnhancerGroupIndex <= 0 ? enhancerGroups.length - 1 : selectedEnhancerGroupIndex - 1;
    } else if (key === 'ArrowDown') {
        selectedEnhancerGroupIndex = selectedEnhancerGroupIndex >= enhancerGroups.length - 1 ? 0 : selectedEnhancerGroupIndex + 1;
    }

    // Add selection to current item
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        enhancerGroups[selectedEnhancerGroupIndex].classList.add('selected');

        // Scroll the selected item into view
        enhancerGroups[selectedEnhancerGroupIndex].scrollIntoView({
            behavior: 'smooth',
            block: 'nearest'
        });
    }
}

function handleCharacterDetailEnter() {
    const enhancerGroups = document.querySelectorAll('.character-detail-content .enhancer-group');
    if (selectedEnhancerGroupIndex >= 0 && selectedEnhancerGroupIndex < enhancerGroups.length) {
        const selectedGroup = enhancerGroups[selectedEnhancerGroupIndex];

        // Get the data from data attributes (much more reliable than parsing onclick)
        const enhancerGroupData = selectedGroup.getAttribute('data-enhancer-group');
        const characterData = selectedGroup.getAttribute('data-character');

        if (enhancerGroupData && characterData) {
            try {
                // Parse the data attributes
                const enhancerGroup = enhancerGroupData === 'null' ? null : JSON.parse(enhancerGroupData);
                const character = JSON.parse(characterData);

                selectEnhancerGroupFromDetail(enhancerGroup, character);
            } catch (error) {
                console.error('Error parsing data attributes:', error);
                console.error('enhancerGroupData:', enhancerGroupData);
                console.error('characterData:', characterData);

                // Fallback: try to trigger the click event instead
                selectedGroup.click();
            }
        } else {
            // Fallback: try to trigger the click event instead
            selectedGroup.click();
        }
    }
}

function hideCharacterAutocomplete() {
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('hidden');
        characterAutocompleteOverlay.classList.remove('expanded');
    }
    currentCharacterAutocompleteTarget = null;
    selectedCharacterAutocompleteIndex = -1;
    characterSearchResults = [];
    autocompleteNavigationMode = false;
    autocompleteExpanded = false;
    lastSearchText = ''; // Clear last search text so retyping works
    window.currentSpellCheckData = null; // Clear spell check data when hiding
    
    // Clear spellcheck timers
    if (spellCheckTimer) {
        clearTimeout(spellCheckTimer);
        spellCheckTimer = null;
    }
    if (spellCheckInputTimer) {
        clearTimeout(spellCheckInputTimer);
        spellCheckInputTimer = null;
    }
    
    // Reset persistent state
    searchResultsByService.clear();
    persistentSpellCheckData = null;
    isAutocompleteVisible = false;
    
    // Clear search state
    lastSearchQuery = '';
    currentSearchQuery = ''; // Reset current search query
    isSearching = false; // Reset searching flag
    
    // Reset services initialization flag for next autofill session
    servicesInitialized = false;
    
    // Clear stored selection data
    lastSelectedItemData = null;
    lastSelectedItemType = null;
    
    updateEmphasisTooltipVisibility();
}

function hideCharacterDetail() {
    // Since we're now replacing the content inside the autocomplete overlay,
    // we need to restore the original autocomplete list content
    const autocompleteList = document.querySelector('.character-autocomplete-list');

    if (autocompleteList && window.allAutocompleteResults && window.allAutocompleteResults.length > 0) {
        // Restore the original autocomplete suggestions
        showCharacterAutocompleteSuggestions(window.allAutocompleteResults, currentCharacterAutocompleteTarget);
    } else {
        // If no search results, just hide the overlay
        hideCharacterAutocomplete();
    }
}

function updateAutocompletePositions() {
    // Update character autocomplete position
    if (characterAutocompleteOverlay && !characterAutocompleteOverlay.classList.contains('hidden') && currentCharacterAutocompleteTarget) {
        const rect = currentCharacterAutocompleteTarget.getBoundingClientRect();
        characterAutocompleteOverlay.style.left = rect.left + 'px';
        characterAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
        characterAutocompleteOverlay.style.width = rect.width + 'px';
    }

    // Update preset autocomplete position
    if (presetAutocompleteOverlay && !presetAutocompleteOverlay.classList.contains('hidden') && currentPresetAutocompleteTarget) {
        const rect = currentPresetAutocompleteTarget.getBoundingClientRect();
        const overlayHeight = Math.min(400, window.innerHeight * 0.5);
        const spaceAbove = rect.top;
        const spaceBelow = window.innerHeight - rect.bottom;

        presetAutocompleteOverlay.style.left = rect.left + 'px';
        presetAutocompleteOverlay.style.width = rect.width + 'px';

        // Check if there's enough space above, otherwise show below
        if (spaceAbove >= overlayHeight) {
            // Position above
            presetAutocompleteOverlay.style.top = (rect.top - 5) + 'px';
            presetAutocompleteOverlay.style.transform = 'translateY(-100%)';
            presetAutocompleteOverlay.style.maxHeight = overlayHeight + 'px';
        } else {
            // Position below if not enough space above
            presetAutocompleteOverlay.style.top = (rect.bottom + 5) + 'px';
            presetAutocompleteOverlay.style.transform = 'none';
            presetAutocompleteOverlay.style.maxHeight = Math.min(spaceBelow - 10, overlayHeight) + 'px';
        }
    }
}

function selectPresetItem(presetName) {
    if (!currentPresetAutocompleteTarget) return;

    const target = currentPresetAutocompleteTarget;
    target.value = presetName;

    // Hide preset autocomplete
    hidePresetAutocomplete();

    // Focus back on the target field
    if (target) {
        target.focus();
    }
}

function hidePresetAutocomplete() {
    if (presetAutocompleteOverlay) {
        presetAutocompleteOverlay.classList.add('hidden');
    }
    currentPresetAutocompleteTarget = null;
    selectedPresetAutocompleteIndex = -1;
}

function expandAutocompleteToShowAll() {
    if (!window.allAutocompleteResults || !characterAutocompleteList) return;

    autocompleteExpanded = true;
    
    // Add expanded class to characterAutocompleteOverlay for CSS rules
    if (characterAutocompleteOverlay) {
        characterAutocompleteOverlay.classList.add('expanded');
    }

    // Use the new display system to show all results
    updateAutocompleteDisplay(window.allAutocompleteResults, currentCharacterAutocompleteTarget);

    // Selection will be maintained automatically by the updateAutocompleteDisplay function
    // which calls rebuildAutocompleteDisplay with selection persistence
}

function updateSpellCheckSelection() {
    const spellCheckSection = characterAutocompleteList?.querySelector('.spell-check-section');
    if (!spellCheckSection) return;

    // Clear all previous selections
    spellCheckSection.querySelectorAll('.spell-check-word').forEach(wordSection => {
        wordSection.classList.remove('selected');
        wordSection.querySelectorAll('.suggestion-btn').forEach(btn => {
            btn.classList.remove('selected');
        });
    });

    // Apply current selection
    if (spellCheckNavigationMode && selectedSpellCheckWordIndex >= 0) {
        const wordSections = spellCheckSection.querySelectorAll('.spell-check-word');
        if (wordSections && selectedSpellCheckWordIndex < wordSections.length) {
            const selectedWordSection = wordSections[selectedSpellCheckWordIndex];
            selectedWordSection.classList.add('selected');
            
            // Scroll to center the selected word section
            scrollToAutocompleteOption(selectedWordSection);
            
            if (selectedSpellCheckSuggestionIndex >= 0) {
                const suggestionBtns = selectedWordSection.querySelectorAll('.suggestion-btn');
                if (suggestionBtns && selectedSpellCheckSuggestionIndex < suggestionBtns.length) {
                    suggestionBtns[selectedSpellCheckSuggestionIndex].classList.add('selected');
                }
            }
        }
    }
}

// Helper function to determine if a model is an anime model
function isAnimeModel(model) {
    return model && (
        model.includes('nai-diffusion-3') ||
        model.includes('nai-diffusion-4') ||
        model.includes('nai-diffusion-4-5') ||
        model === 'anime-local'
    );
}

// Helper function to determine if a model is a furry model
function isFurryModel(model) {
    return model && (
        model.includes('furry') ||
        model === 'furry-local'
    );
}

// Helper function to determine match type for dual matches
function getMatchType(mergedModels) {
    if (!mergedModels || mergedModels.length === 0) {
        return { type: 'Search', version: '' };
    }
    
    // Count different types of models
    const apiModels = mergedModels.filter(m => m !== 'furry-local' && m !== 'anime-local');
    const hasFurryLocal = mergedModels.includes('furry-local');
    const hasAnimeLocal = mergedModels.includes('anime-local');
        
    // Global: exists in multiple API models (cross-model compatibility)
    if (apiModels.length >= 2) {
        return { type: 'Global', version: '' };
    }
    
    // Global: exists in both API models and matches a local search result
    if (apiModels.length >= 2 && (hasFurryLocal || hasAnimeLocal)) {
        return { type: 'Global', version: '' };
    }
    
    // Anime: matches current search model and a local search result
    if (apiModels.length === 1 && hasAnimeLocal) {
        const apiModel = apiModels[0];
        if (isAnimeModel(apiModel)) {
            return { 
                type: 'NovelAI',
                dataType: 'anime',
                version: modelKeys[apiModel]?.version || 'Search' 
            };
        }
    }
    
    // Furry: matches v3 furry model search result and a local result
    if (apiModels.length === 1 && hasFurryLocal) {
        const apiModel = apiModels[0];
        if (isFurryModel(apiModel)) {
            return { 
                type: 'NovelAI', 
                dataType: 'furry',
                version: modelKeys[apiModel]?.version || 'Search' 
            };
        }
    }
    
    // Fallback for other combinations
    if (apiModels.length >= 2) {
        return { type: 'Global', version: '' };
    } else if (apiModels.length === 1) {
        const apiModel = apiModels[0];
        return { 
            type: modelKeys[apiModel]?.type || 'Search', 
            version: modelKeys[apiModel]?.version || '' 
        };
    }
    
    // Local-only results
    if (hasFurryLocal && hasAnimeLocal) {
        return { type: 'Global', version: '' };
    } else if (hasFurryLocal) {
        return { type: 'NovelAI', dataType: 'furry', version: 'Local' };
    } else if (hasAnimeLocal) {
        return { type: 'NovelAI', dataType: 'anime', version: 'Local' };
    }
    
    return { type: 'Search', version: '' };
}

// Helper function to get the preferred local result when merging
function getPreferredLocalResult(result1, result2) {
    // If one is furry-local and the other is anime-local, prioritize furry-local
    if (result1.model === 'furry-local' && result2.model === 'anime-local') {
        return result1;
    }
    if (result1.model === 'anime-local' && result2.model === 'furry-local') {
        return result2;
    }
    
    // If both are the same type, return the one with higher confidence
    if (result1.model === result2.model) {
        return (result1.confidence || 0) >= (result2.confidence || 0) ? result1 : result2;
    }
    
    // If neither is local, return the one with higher confidence
    return (result1.confidence || 0) >= (result2.confidence || 0) ? result1 : result2;
}

// Handle dynamic updates of spell check and text replacement results
function handleDynamicResultsUpdate(serviceName, results) {
    if (!results || !Array.isArray(results)) return;
    
    // Update spell check results
    const spellCheckResult = results.find(result => result.type === 'spellcheck');
    if (spellCheckResult) {
        spellCheckResults.set(serviceName, spellCheckResult);
    }
    
    // Update text replacement results
    const textReplacementResultsArray = results.filter(result => result.type === 'textReplacement');
    if (textReplacementResultsArray.length > 0) {
        textReplacementResults.set(serviceName, textReplacementResultsArray);
    }
    
    // Rebuild and display results to show the updated dynamic content
    rebuildAndDisplayResults();
}

// Get the best spell check result from all services
function getBestSpellCheckResult() {
    let bestSpellCheckResult = null;
    let bestScore = 0;
    
    for (const [serviceName, spellCheckResult] of spellCheckResults) {
        if (spellCheckResult && spellCheckResult.data && spellCheckResult.data.hasErrors) {
            // Calculate a score based on the number of misspelled words and suggestions
            const misspelledCount = spellCheckResult.data.misspelled.length;
            const totalSuggestions = Object.values(spellCheckResult.data.suggestions || {})
                .reduce((sum, suggestions) => sum + suggestions.length, 0);
            const score = misspelledCount * 10 + totalSuggestions;
            
            if (score > bestScore) {
                bestScore = score;
                bestSpellCheckResult = spellCheckResult;
            }
        }
    }
    
    return bestSpellCheckResult;
}

// Get all text replacement results from all services
function getAllTextReplacementResults() {
    const allTextReplacements = [];
    
    for (const [serviceName, textReplacements] of textReplacementResults) {
        if (textReplacements && Array.isArray(textReplacements)) {
            allTextReplacements.push(...textReplacements);
        }
    }
    
    // Remove duplicates based on name and placeholder, keeping the best match
    const uniqueTextReplacements = [];
    const seen = new Map(); // Use Map to track best score for each key
    
    for (const replacement of allTextReplacements) {
        const key = `${replacement.name}:${replacement.placeholder}`;
        const currentScore = replacement.matchScore || calculateStringSimilarity(lastSearchQuery, replacement.name);
        
        if (!seen.has(key) || currentScore > seen.get(key).score) {
            // Add match score for sorting
            const replacementWithScore = {
                ...replacement,
                matchScore: currentScore
            };
            
            // Update the seen map with the better score
            seen.set(key, { score: currentScore, replacement: replacementWithScore });
        }
    }
    
    // Extract the best replacements from the seen map
    for (const { replacement } of seen.values()) {
        uniqueTextReplacements.push(replacement);
    }
    
    return uniqueTextReplacements;
}

// Clear dynamic results (spell check and text replacements)
function clearDynamicResults() {
    spellCheckResults.clear();
    textReplacementResults.clear();
    persistentSpellCheckData = null;
}

// Calculate string similarity score for better ranking
function calculateStringSimilarity(query, text) {
    if (!query || !text) return 0;
    
    const queryLower = query.toLowerCase();
    const textLower = text.toLowerCase();
    
    // Exact match gets highest score
    if (textLower === queryLower) return 100;
    
    // Starts with query gets high score
    if (textLower.startsWith(queryLower)) return 85;
    
    // Contains query gets medium score
    if (textLower.includes(queryLower)) return 60;
    
    // Calculate word-by-word matching
    const queryWords = queryLower.split(/\s+/).filter(word => word.length > 0);
    const textWords = textLower.split(/\s+/).filter(word => word.length > 0);
    
    let matchScore = 0;
    let totalWords = queryWords.length;
    
    for (const queryWord of queryWords) {
        let bestWordScore = 0;
        for (const textWord of textWords) {
            if (textWord === queryWord) {
                bestWordScore = 100;
                break;
            } else if (textWord.startsWith(queryWord)) {
                bestWordScore = Math.max(bestWordScore, 70);
            } else if (textWord.includes(queryWord)) {
                bestWordScore = Math.max(bestWordScore, 40);
            }
        }
        matchScore += bestWordScore;
    }
    
    return totalWords > 0 ? matchScore / totalWords : 0;
}

// Get the best text replacement match for the current query
function getBestTextReplacementMatch(textReplacements, query) {
    if (!textReplacements || textReplacements.length === 0 || !query) return null;
    
    let bestMatch = null;
    let bestScore = 0;
    
    for (const replacement of textReplacements) {
        // Use existing match score if available, otherwise calculate it
        const totalScore = replacement.matchScore || calculateStringSimilarity(query, replacement.name);
        
        if (totalScore > bestScore) {
            bestScore = totalScore;
            bestMatch = { ...replacement, matchScore: totalScore };
        }
    }
    
    // Only return a best match if it has a high enough score (>= 70)
    // This prevents mediocre matches from appearing at the top
    return bestMatch && bestMatch.matchScore >= 70 ? bestMatch : null;
}

// Enhance character results with string similarity scores
function enhanceCharacterResultsWithStringSimilarity(results, query) {
    if (!results || !Array.isArray(results) || !query) return results;
    
    return results.map(result => {
        if (result.type === 'character') {
            const stringScore = calculateStringSimilarity(query, result.name);
            return {
                ...result,
                stringSimilarity: stringScore,
                // More balanced weighting: 50% string similarity, 50% existing similarity
                enhancedSimilarity: (stringScore * 0.5) + ((result.similarity || 0) * 0.5)
            };
        }
        return result;
    });
}

// Debug function to log ranking information
function logRankingDebug(results, query) {
    if (!results || results.length === 0) return;
    const typeCounts = {};
    results.forEach(result => {
        typeCounts[result.type] = (typeCounts[result.type] || 0) + 1;
    });
    
    // Log top 5 results with their scores
    const topResults = results.slice(0, 5);
    topResults.forEach((result, index) => {
        let score = 'N/A';
        if (result.type === 'tag') {
            const enhancedConfidence = result.enhancedConfidence || result.confidence || 0;
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `enhanced: ${enhancedConfidence.toFixed(1)}, confidence: ${result.confidence || 0}, predictionary: ${predictionaryScore}`;
        } else if (result.type === 'character') {
            const stringScore = result.stringSimilarity || calculateStringSimilarity(query, result.name);
            const enhancedScore = result.enhancedSimilarity || (stringScore * 0.5) + ((result.similarity || 0) * 0.5);
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `enhanced: ${enhancedScore.toFixed(1)}, string: ${stringScore.toFixed(1)}, similarity: ${result.similarity || 0}, predictionary: ${predictionaryScore}`;
        } else if (result.type === 'textReplacement') {
            const predictionaryScore = result.predictionaryScore || 'N/A';
            score = `matchScore: ${result.matchScore || 0}, predictionary: ${predictionaryScore}`;
        }
    });
}

// Deduplicate results from different services
function deduplicateResults(results) {
    if (!results || results.length === 0) return results;
    
    const tagMap = new Map(); // Map of tag name to best result
    const characterMap = new Map(); // Map of character name to best result
    const textReplacementMap = new Map(); // Map of text replacement key to best result
    const finalResults = [];
    
    for (const result of results) {
        if (result.type === 'tag') {
            const tagName = result.name;
            
            if (tagMap.has(tagName)) {
                // We have a duplicate tag - merge them intelligently
                const existingResult = tagMap.get(tagName);
                const mergedResult = mergeTagResults(existingResult, result);
                tagMap.set(tagName, mergedResult);
            } else {
                // First occurrence of this tag
                tagMap.set(tagName, result);
            }
        } else if (result.type === 'character') {
            const characterName = result.name;
            
            if (characterMap.has(characterName)) {
                // We have a duplicate character - keep the one with better similarity
                const existingResult = characterMap.get(characterName);
                const existingScore = existingResult.enhancedSimilarity || existingResult.similarity || 0;
                const currentScore = result.enhancedSimilarity || result.similarity || 0;
                
                if (currentScore > existingScore) {
                    characterMap.set(characterName, result);
                }
            } else {
                // First occurrence of this character
                characterMap.set(characterName, result);
            }
        } else if (result.type === 'textReplacement') {
            const replacementKey = `${result.name}:${result.placeholder}`;
            
            if (textReplacementMap.has(replacementKey)) {
                // We have a duplicate text replacement - keep the one with better match score
                const existingResult = textReplacementMap.get(replacementKey);
                const existingScore = existingResult.matchScore || 0;
                const currentScore = result.matchScore || 0;
                
                if (currentScore > existingScore) {
                    textReplacementMap.set(replacementKey, result);
                }
            } else {
                // First occurrence of this text replacement
                textReplacementMap.set(replacementKey, result);
            }
        } else {
            // Non-duplicatable results (spellcheck, etc.) - add directly
            finalResults.push(result);
        }
    }
    
    // Add all deduplicated results to final results
    for (const result of tagMap.values()) {
        finalResults.push(result);
    }
    for (const result of characterMap.values()) {
        finalResults.push(result);
    }
    for (const result of textReplacementMap.values()) {
        finalResults.push(result);
    }
    
    // Log dual matches and add dual-match service status
    let dualMatchCount = 0;
    for (const result of tagMap.values()) {
        if (result.isDualMatch) {
            dualMatchCount++;
        }
    }
    
    // Add dual-match service status if we have dual matches
    if (dualMatchCount > 0 && searchServices.has('dual-match') === false) {
        searchServices.set('dual-match', 'completed');
    } else {
        searchServices.set('dual-match', 'completed-none');
    }
    
    return finalResults;
}

// Merge two tag results intelligently
function mergeTagResults(result1, result2) {
    // Check if one is API and one is local
    const isResult1API = result1.model !== 'furry-local' && result1.model !== 'anime-local';
    const isResult2API = result2.model !== 'furry-local' && result2.model !== 'anime-local';
    
    if (isResult1API !== isResult2API) {
        // Create dual match - prioritize API result
        const apiResult = isResult1API ? result1 : result2;
        const localResult = isResult1API ? result2 : result1;
        
        // Track which models were merged
        const mergedModels = new Set();
        mergedModels.add(apiResult.model);
        mergedModels.add(localResult.model);
        
        // Create combined result with API priority
        const dualMatch = {
            ...apiResult, // Use API result as base
            model: 'dual-match',
            serviceName: 'dual-match',
            // Combine counts - use API count as primary, local counts as additional info
            count: localResult.count || apiResult.count,
            e_count: localResult.e_count || apiResult.e_count,
            // Use higher confidence
            confidence: Math.max(apiResult.confidence || 0, localResult.confidence || 0),
            // Combine enhanced confidence if available
            enhancedConfidence: Math.max(
                apiResult.enhancedConfidence || apiResult.confidence || 0,
                localResult.enhancedConfidence || localResult.confidence || 0
            ),
            // Combine categories if different
            category: apiResult.category || localResult.category,
            // Track merged models for badge display
            mergedModels: Array.from(mergedModels),
            // Mark as dual match
            isDualMatch: true,
            apiResult: apiResult,
            localResult: localResult
        };
        
        return dualMatch;
    } else {
        // Both are same type - keep the one with higher confidence
        const result1Confidence = result1.enhancedConfidence || result1.confidence || 0;
        const result2Confidence = result2.enhancedConfidence || result2.confidence || 0;
        
        if (result2Confidence > result1Confidence) {
            return result2;
        } else {
            return result1;
        }
    }
}

// Handle Tab cycling between main prompt and character prompts
function handlePromptTabCycling(e) {
    const manualPrompt = document.getElementById('manualPrompt');
    const manualUc = document.getElementById('manualUc');
    const characterPromptsContainer = document.getElementById('characterPromptsContainer');
    const promptTabs = document.querySelector('.prompt-tabs');
    
    if (!manualPrompt || !characterPromptsContainer) return;
    
    const isShowingBoth = promptTabs && promptTabs.classList.contains('show-both');
    const characterItems = characterPromptsContainer.querySelectorAll('.character-prompt-item');
    const characterItemsArray = Array.from(characterItems); // Convert NodeList to Array
    const currentlyFocused = document.activeElement;
    
    // Define the cycling order based on show-both mode
    let cycleOrder = [];
    
    if (isShowingBoth) {
        // Show both mode: prompt → uc → character prompt → character uc → next character prompt → next character uc...
        cycleOrder = [manualPrompt, manualUc];
        
        // Add each character's prompt and UC textareas
        characterItemsArray.forEach(characterItem => {
            const promptTextarea = characterItem.querySelector(`#${characterItem.id}_prompt`);
            const ucTextarea = characterItem.querySelector(`#${characterItem.id}_uc`);
            
            if (promptTextarea) cycleOrder.push(promptTextarea);
            if (ucTextarea) cycleOrder.push(ucTextarea);
        });
    } else {
        // Single mode: determine which tab is active and include main prompts
        const mainToggleGroup = document.querySelector('#manualModal .prompt-tabs .gallery-toggle-group');
        const mainActiveTab = mainToggleGroup ? mainToggleGroup.getAttribute('data-active') : 'prompt';
        
        if (mainActiveTab === 'prompt') {
            // Prompt tab is active - cycle through prompt and character prompt textareas
            cycleOrder = [manualPrompt];
            characterItemsArray.forEach(characterItem => {
                const promptTextarea = characterItem.querySelector(`#${characterItem.id}_prompt`);
                if (promptTextarea) cycleOrder.push(promptTextarea);
            });
        } else if (mainActiveTab === 'uc') {
            // UC tab is active - cycle through UC and character UC textareas
            cycleOrder = [manualUc];
            characterItemsArray.forEach(characterItem => {
                const ucTextarea = characterItem.querySelector(`#${characterItem.id}_uc`);
                if (ucTextarea) cycleOrder.push(ucTextarea);
            });
        } else {
            // Fallback - include both main prompts
            cycleOrder = [manualPrompt, manualUc];
            characterItemsArray.forEach(characterItem => {
                const promptTextarea = characterItem.querySelector(`#${characterItem.id}_prompt`);
                const ucTextarea = characterItem.querySelector(`#${characterItem.id}_uc`);
                
                if (promptTextarea) cycleOrder.push(promptTextarea);
                if (ucTextarea) cycleOrder.push(ucTextarea);
            });
        }
    }
    
    // Find current position in cycle
    let currentIndex = -1;
    if (currentlyFocused === manualPrompt || currentlyFocused === manualUc) {
        currentIndex = cycleOrder.indexOf(currentlyFocused);
    } else {
        // In a character textarea
        currentIndex = cycleOrder.indexOf(currentlyFocused);
    }
    if (currentIndex === -1) return;
    
    // Calculate next/previous index
    let targetIndex;
    if (e.shiftKey) {
        // Shift+Tab: Move backwards
        targetIndex = currentIndex > 0 ? currentIndex - 1 : cycleOrder.length - 1;
    } else {
        // Tab: Move forwards
        targetIndex = currentIndex < cycleOrder.length - 1 ? currentIndex + 1 : 0;
    }
    
    const targetElement = cycleOrder[targetIndex];
    
    // Helper function to scroll element into center view
    function scrollToCenter(element) {
        if (!element) return;
                
        // Use scrollIntoView with smooth behavior and center alignment
        element.scrollIntoView({
            behavior: 'smooth',
            block: 'center',
            inline: 'center'
        });
    }
    
    // Handle navigation to target element
    if (targetElement === manualPrompt) {
        // Close current character prompt if we're in one
        if (currentlyFocused.closest('.character-prompt-item')) {
            const currentCharacterItem = currentlyFocused.closest('.character-prompt-item');
            if (!currentCharacterItem.classList.contains('collapsed')) {
                currentCharacterItem.classList.add('collapsed');
                // Update the collapse button icon
                updateCharacterPromptCollapseButton(currentCharacterItem.id, true);
            }
        }
        manualPrompt.focus();
        scrollToCenter(manualPrompt);
    } else if (targetElement === manualUc) {
        // Close current character prompt if we're in one
        if (currentlyFocused.closest('.character-prompt-item')) {
            const currentCharacterItem = currentlyFocused.closest('.character-prompt-item');
            if (!currentCharacterItem.classList.contains('collapsed')) {
                currentCharacterItem.classList.add('collapsed');
                // Update the collapse button icon
                updateCharacterPromptCollapseButton(currentCharacterItem.id, true);
            }
        }
        manualUc.focus();
        scrollToCenter(manualUc);
    } else if (targetElement.classList.contains('character-prompt-textarea')) {
        // Moving to a character textarea
        const targetCharacterItem = targetElement.closest('.character-prompt-item');
        
        if (targetCharacterItem) {
            // Only close current character prompt if we're moving from one character to another
            if (currentlyFocused.closest('.character-prompt-item')) {
                const currentCharacterItem = currentlyFocused.closest('.character-prompt-item');
                if (currentCharacterItem !== targetCharacterItem && !currentCharacterItem.classList.contains('collapsed')) {
                    currentCharacterItem.classList.add('collapsed');
                    // Update the collapse button icon
                    updateCharacterPromptCollapseButton(currentCharacterItem.id, true);
                }
            }
            
            // Switch to the correct tab if needed (only when not in show-both mode)
            if (!isShowingBoth) {
                const isUcTextarea = targetElement.id && targetElement.id.includes('_uc');
                const targetTab = isUcTextarea ? 'uc' : 'prompt';
                const targetTabPane = targetCharacterItem.querySelector(`#${targetCharacterItem.id}_${targetTab}-tab`);
                const currentTabPane = targetCharacterItem.querySelector('.tab-pane.active');
                
                if (targetTabPane && currentTabPane !== targetTabPane) {
                    currentTabPane.classList.remove('active');
                    targetTabPane.classList.add('active');
                }
            }
            
            // Expand target character prompt
            const wasCollapsed = targetCharacterItem.classList.contains('collapsed');
            if (wasCollapsed) {
                targetCharacterItem.classList.remove('collapsed');
                // Update the collapse button icon
                updateCharacterPromptCollapseButton(targetCharacterItem.id, false);
            }
            
            targetElement.focus();
            
            // If the element was collapsed, wait for animation to complete before scrolling
            if (wasCollapsed) {
                setTimeout(() => {
                    scrollToCenter(targetCharacterItem);
                }, 300); // Wait for collapse/expand animation to complete
            } else {
                scrollToCenter(targetCharacterItem);
            }
        }
    }
}

// Function to delete the tag behind the cursor
function deleteTagBehindCursor(target) {
    const currentValue = target.value;
    const cursorPos = target.selectionStart;
    
    if (cursorPos === 0) return; // Nothing to delete if at the beginning
    
    const textBeforeCursor = currentValue.substring(0, cursorPos);
    
    // Use the same logic as emphasis manager to find the current tag
    // Find the last delimiter before the cursor
    const lastDelimiterIndex = Math.max(
        textBeforeCursor.lastIndexOf('{'),
        textBeforeCursor.lastIndexOf('}'),
        textBeforeCursor.lastIndexOf('['),
        textBeforeCursor.lastIndexOf(']'),
        textBeforeCursor.lastIndexOf(':'),
        textBeforeCursor.lastIndexOf('|'),
        textBeforeCursor.lastIndexOf(',')
    );
    
    // Find the start of the current tag
    let tagStart;
    if (lastDelimiterIndex >= 0) {
        // Start after the last delimiter
        tagStart = lastDelimiterIndex + 1;
    } else {
        // No delimiter found, start from beginning
        tagStart = 0;
    }
    
    // Find the end of the current tag by looking for the next delimiter or end of text
    const textAfterCursor = currentValue.substring(cursorPos);
    const nextDelimiterIndex = Math.min(
        textAfterCursor.indexOf(',') >= 0 ? textAfterCursor.indexOf(',') : Infinity,
        textAfterCursor.indexOf('|') >= 0 ? textAfterCursor.indexOf('|') : Infinity,
        textAfterCursor.indexOf(':') >= 0 ? textAfterCursor.indexOf(':') : Infinity,
        textAfterCursor.indexOf('{') >= 0 ? textAfterCursor.indexOf('{') : Infinity,
        textAfterCursor.indexOf('}') >= 0 ? textAfterCursor.indexOf('}') : Infinity,
        textAfterCursor.indexOf('[') >= 0 ? textAfterCursor.indexOf('[') : Infinity,
        textAfterCursor.indexOf(']') >= 0 ? textAfterCursor.indexOf(']') : Infinity
    );
    
    let tagEnd;
    if (nextDelimiterIndex !== Infinity) {
        tagEnd = cursorPos + nextDelimiterIndex;
    } else {
        tagEnd = currentValue.length;
    }
    
    // Get the tag text (trim whitespace)
    const tagText = currentValue.substring(tagStart, tagEnd).trim();
    
    // Check if we have a valid tag to delete (at least 2 characters)
    if (tagText.length < 2) return;
    
    // Handle special cases for emphasis blocks and brace blocks
    const emphasisPattern = /(-?\d+\.\d+)::([^:]+)::/;
    const bracePattern = /\{+([^{}]*)\}+|\[+([^\[\]]*)\]+/;
    
    if (emphasisPattern.test(tagText)) {
        // Delete the entire emphasis block
        const emphasisMatch = tagText.match(emphasisPattern);
        if (emphasisMatch) {
            // Extract the text content from the emphasis block
            const emphasizedText = emphasisMatch[2];
            
            // Replace the emphasis block with just the text content
            const beforeTag = currentValue.substring(0, tagStart);
            const afterTag = currentValue.substring(tagEnd);
            const newValue = beforeTag + emphasizedText + afterTag;
            
            target.value = newValue;
            
            // Set cursor position after the cleaned text
            const newCursorPos = tagStart + emphasizedText.length;
            setTimeout(() => {
                target.setSelectionRange(newCursorPos, newCursorPos);
                target.focus();
            }, 0);
        }
    } else if (bracePattern.test(tagText)) {
        // Delete the entire brace block
        const braceMatch = tagText.match(bracePattern);
        if (braceMatch) {
            // Extract the text content from the brace block
            const braceContent = braceMatch[1] || braceMatch[2];
            
            // Replace the brace block with just the text content
            const beforeTag = currentValue.substring(0, tagStart);
            const afterTag = currentValue.substring(tagEnd);
            const newValue = beforeTag + braceContent + afterTag;
            
            target.value = newValue;
            
            // Set cursor position after the cleaned text
            const newCursorPos = tagStart + braceContent.length;
            setTimeout(() => {
                target.setSelectionRange(newCursorPos, newCursorPos);
                target.focus();
            }, 0);
        }
    } else {
        // Regular tag deletion
        // Remove the tag and any trailing comma/space
        const beforeTag = currentValue.substring(0, tagStart);
        let afterTag = currentValue.substring(tagEnd);
        
        // Remove leading comma and space if present
        afterTag = afterTag.replace(/^,\s*/, '');
        
        // Remove trailing comma and space from beforeTag if present
        const cleanedBeforeTag = beforeTag.replace(/,\s*$/, '');
        
        const newValue = cleanedBeforeTag + afterTag;
        
        target.value = newValue;
        
        // Set cursor position to where the tag was
        const newCursorPos = cleanedBeforeTag.length;
        
        setTimeout(() => {
            target.setSelectionRange(newCursorPos, newCursorPos);
            target.focus();
        }, 0);
    }
    
    // Trigger input event to update any dependent functionality
    const event = new Event('input', { bubbles: true });
    target.dispatchEvent(event);
}

// Favorites functionality
function getSelectedTextFromTextarea(textarea) {
    const start = textarea.selectionStart;
    const end = textarea.selectionEnd;
    return textarea.value.substring(start, end);
}

function addToFavorites(selectedItem) {
    if (!selectedItem) return;
    
    const type = selectedItem.dataset.type;
    let itemData;
    
    if (type === 'tag') {
        itemData = {
            type: 'tag',
            name: selectedItem.dataset.tagName,
            count: selectedItem.dataset.count,
            model: selectedItem.dataset.model,
            confidence: selectedItem.dataset.confidence
        };
    } else if (type === 'textReplacement') {
        itemData = {
            type: 'textReplacement',
            name: selectedItem.dataset.placeholder,
            placeholder: selectedItem.dataset.placeholder,
            description: selectedItem.textContent
        };
    } else if (type === 'character') {
        const characterData = JSON.parse(selectedItem.dataset.characterData);
        itemData = {
            type: 'character',
            name: characterData.name,
            description: characterData.description || ''
        };
    } else {
        console.error('Unknown item type for favorites:', type);
        return;
    }
    
    // Send to server via WebSocket
    if (window.wsClient && window.wsClient.isConnected()) {
        const favoriteType = type === 'character' ? 'tags' : type + 's'; // characters go in tags, textReplacement becomes textReplacements
        
        window.wsClient.send({
            type: 'favorites_add',
            favoriteType: favoriteType,
            item: itemData,
            requestId: `favorite_add_${Date.now()}`
        });
        
        // Show success notification
        if (typeof showGlassToast === 'function') {
            showGlassToast('success', null, `Added "${itemData.name}" to favorites`, false, 3000, '<i class="fas fa-star"></i>');
        }
    } else {
        if (typeof showGlassToast === 'function') {
            showGlassToast('error', null, 'Unable to add to favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
}

// Auto-detect if text is a tag and show appropriate dialog
async function showAddToFavoritesDialog(selectedText) {
    const isTag = await detectIfTag(selectedText);
    
    if (isTag) {
        await showTagConfirmationDialog(selectedText);
    } else {
        await showTextReplacementDialog(selectedText);
    }
}

// Detect if selected text is likely a tag
async function detectIfTag(text) {
    // Clean the text
    const cleanText = text.trim();
    
    // Basic heuristics for tag detection
    const tagPatterns = [
        // Single words without spaces (most tags)
        /^[a-zA-Z0-9_-]+$/,
        // Character names (typically 1-3 words)
        /^[a-zA-Z0-9_\s-]{1,50}$/,
        // Common tag formats
        /^\d+(boy|girl|man|woman)s?$/i,
        /^(very\s+)?(short|long|medium)\s+(hair|skirt|dress|pants)$/i,
        /^(red|blue|green|black|white|brown|blonde|pink|purple|yellow|orange)\s+(hair|eyes)$/i
    ];
    
    // If it's very short (1-2 words), likely a tag
    const wordCount = cleanText.split(/\s+/).length;
    if (wordCount <= 2 && cleanText.length <= 30) {
        return true;
    }
    
    // Check against tag patterns
    for (const pattern of tagPatterns) {
        if (pattern.test(cleanText)) {
            return true;
        }
    }
    
    // If it contains common text replacement indicators, it's not a tag
    const textReplacementIndicators = [
        ',', // Lists like "forest, nature, outdoors"
        ':', // Ratios or descriptions
        '!', // Existing replacement references
        '\n', // Multi-line content
        '(', ')', // Parenthetical content
        '"', "'", // Quoted content
    ];
    
    for (const indicator of textReplacementIndicators) {
        if (cleanText.includes(indicator)) {
            return false;
        }
    }
    
    // If it's longer than typical tag length, likely text replacement
    if (cleanText.length > 50) {
        return false;
    }
    
    // Default to tag for ambiguous cases
    return true;
}

// Show simple confirmation dialog for tags
async function showTagConfirmationDialog(tagText) {
    const confirmed = await showConfirmationDialog(
        `Add "${tagText}" to favorites as a tag?`,
        [
            { text: 'Cancel', value: false, className: 'btn-secondary' },
            { text: 'Add to Favorites', value: true, className: 'btn-primary' }
        ]
    );
    
    if (confirmed) {
        const itemData = {
            type: 'tag',
            name: tagText,
            originalName: tagText,
            description: tagText
        };
        
        // Send to server via WebSocket
        if (window.wsClient && window.wsClient.isConnected()) {
            window.wsClient.send({
                type: 'favorites_add',
                favoriteType: 'tags',
                item: itemData,
                requestId: `favorite_add_${Date.now()}`
            });
            
            // Show success notification
            showGlassToast('success', null, `Added "${tagText}" to favorites`, false, 3000, '<i class="fas fa-star"></i>');
        } else {
            showGlassToast('error', null, 'Unable to add to favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
        }
    }
}

// Position custom dialog similar to confirmationDialog
function positionCustomDialog(dialog, event = null) {
    if (!dialog) return;

    let x, y;
    
    if (event) {
        // Use mouse position or button position
        if (event.clientX && event.clientY) {
            x = event.clientX;
            y = event.clientY;
        } else if (event.target) {
            const rect = event.target.getBoundingClientRect();
            x = rect.left + rect.width / 2;
            y = rect.top + rect.height / 2;
        }
    } else {
        // Center on screen if no event
        x = window.innerWidth / 2;
        y = window.innerHeight / 2;
    }

    // Get dialog dimensions
    const dialogRect = dialog.getBoundingClientRect();
    const dialogWidth = dialogRect.width || 400; // Default width
    const dialogHeight = dialogRect.height || 200; // Default height

    // Calculate position to center on cursor/button
    let left = x - dialogWidth / 2;
    let top = y - dialogHeight / 2;

    // Ensure dialog doesn't go off screen
    const margin = 20;
    
    // Check horizontal bounds
    if (left < margin) {
        left = margin;
    } else if (left + dialogWidth > window.innerWidth - margin) {
        left = window.innerWidth - dialogWidth - margin;
    }

    // Check vertical bounds
    if (top < margin) {
        top = margin;
    } else if (top + dialogHeight > window.innerHeight - margin) {
        top = window.innerHeight - dialogHeight - margin;
    }

    // Apply position
    dialog.style.left = `${left}px`;
    dialog.style.top = `${top}px`;
    dialog.style.position = 'fixed';
}

// Extract first tag from text for use as placeholder name
function extractFirstTag(text) {
    const cleanText = text.trim();
    
    // Split by common delimiters
    const delimiters = [',', '\n', ';', '|', '(', ')', '[', ']', '{', '}'];
    let parts = [cleanText];
    
    // Split by each delimiter
    for (const delimiter of delimiters) {
        const newParts = [];
        for (const part of parts) {
            newParts.push(...part.split(delimiter));
        }
        parts = newParts;
    }
    
    // Find the first part that looks like a tag
    for (const part of parts) {
        const trimmed = part.trim();
        if (trimmed.length > 0 && trimmed.length <= 50) {
            // Convert to valid placeholder name
            const placeholder = trimmed
                .replace(/[^\w\s-]/g, '') // Remove special chars except word chars, spaces, hyphens
                .replace(/\s+/g, '_') // Replace spaces with underscores
                .toLowerCase()
                .replace(/^_+|_+$/g, '') // Remove leading/trailing underscores
                .replace(/_+/g, '_'); // Collapse multiple underscores
            
            if (placeholder.length > 0) {
                return placeholder;
            }
        }
    }
    
    // Fallback: use first few words
    const words = cleanText.split(/\s+/).slice(0, 3);
    return words.join('_').replace(/[^\w]/g, '').toLowerCase() || 'text_replacement';
}

// Show redesigned dialog for text replacements using popup system
async function showTextReplacementDialog(selectedText) {
    const defaultName = extractFirstTag(selectedText);
    
    // Create custom dialog using confirmation dialog system
    return new Promise((resolve) => {
        // Remove any existing dialog
        const existingDialog = document.querySelector('.favorites-dialog, .favorites-text-replacement-dialog');
        if (existingDialog) {
            existingDialog.remove();
        }
        
        const dialog = document.createElement('div');
        dialog.className = 'confirmation-dialog favorites-text-replacement-dialog';
        dialog.innerHTML = `
            <div class="confirmation-dialog-content">
                <div class="confirmation-message">
                    <strong>Add Text Replacement</strong>
                    <div class="selected-text-preview">Selected: "${selectedText}"</div>
                </div>
                <div class="text-replacement-form">
                    <div class="form-row">
                        <label for="replacementName">Name:</label>
                        <input type="text" id="replacementName" class="form-control" value="${defaultName}" placeholder="replacement_name">
                    </div>
                    <div class="form-hint">
                        <i class="fas fa-info-circle"></i> Will be available as !<span id="namePreview">${defaultName}</span>
                    </div>
                </div>
                <div class="confirmation-controls">
                    <button class="btn btn-secondary" id="cancelTextReplacement">Cancel</button>
                    <button class="btn btn-primary" id="saveTextReplacement">Add to Favorites</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(dialog);
        
        // Position and show dialog
        positionCustomDialog(dialog);
        dialog.classList.remove('hidden');
        
        // Get elements
        const nameInput = dialog.querySelector('#replacementName');
        const namePreview = dialog.querySelector('#namePreview');
        const cancelBtn = dialog.querySelector('#cancelTextReplacement');
        const saveBtn = dialog.querySelector('#saveTextReplacement');
        
        // Focus and select name input
        nameInput.focus();
        nameInput.select();
        
        // Update preview as user types
        nameInput.addEventListener('input', (e) => {
            let value = e.target.value.replace(/\s+/g, '_');
            e.target.value = value;
            namePreview.textContent = value || 'replacement_name';
        });
        
        // Handle cancel
        cancelBtn.addEventListener('click', () => {
            dialog.remove();
            resolve(false);
        });
        
        // Handle save
        const handleSave = async () => {
            const name = nameInput.value.trim();
            if (!name) {
                showGlassToast('error', null, 'Please enter a name for the replacement', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                nameInput.focus();
                return;
            }
            
            const itemData = {
                type: 'textReplacement',
                name: name,
                originalName: selectedText,
                description: selectedText,
                placeholder: name,
                replacementValue: selectedText
            };
            
            // Send to server via WebSocket
            if (window.wsClient && window.wsClient.isConnected()) {
                window.wsClient.send({
                    type: 'favorites_add',
                    favoriteType: 'textReplacements',
                    item: itemData,
                    requestId: `favorite_add_${Date.now()}`
                });
                
                showGlassToast('success', null, `Added text replacement "!${name}" to config`, false, 3000, '<i class="fas fa-language"></i>');
            } else {
                showGlassToast('error', null, 'Unable to add to favorites: not connected to server', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            }
            
            dialog.remove();
            resolve(true);
        };
        
        saveBtn.addEventListener('click', handleSave);
        
        // Handle Enter key
        nameInput.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') {
                e.preventDefault();
                handleSave();
            } else if (e.key === 'Escape') {
                dialog.remove();
                resolve(false);
            }
        });
    });
}

if (window.wsClient) {
    window.wsClient.registerInitStep(20, 'Setting up autocomplete', async () => {
        window.wsClient.on('search_status_update', handleSearchStatusUpdate);
        window.wsClient.on('search_results_update', handleSearchResultsUpdate);
        window.wsClient.on('search_results_complete', handleSearchResultsComplete);
    });
}