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

// Persistent results storage for stable autocomplete
let persistentSpellCheckData = null; // Current spell check data
let isAutocompleteVisible = false; // Track if autocomplete is currently visible

// Track last search query to prevent unnecessary clearing
let lastSearchQuery = '';

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

// Initialize WebSocket event handlers for realtime search
function initializeRealtimeSearch() {
    if (window.wsClient) {
        window.wsClient.on('search_status_update', handleSearchStatusUpdate);
        window.wsClient.on('search_results_update', handleSearchResultsUpdate);
        window.wsClient.on('search_results_complete', handleSearchResultsComplete);
    }
}

// Handle search status updates from WebSocket
function handleSearchStatusUpdate(message) {
    if (!message.services || !Array.isArray(message.services)) return;
    
    message.services.forEach(service => {
        if (service.status === 'completed' || service.status === 'error') {
            // Remove completed/error services from the status display
            searchServices.delete(service.name);
        } else {
            // Update status for active services
            searchServices.set(service.name, service.status);
        }
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
    
    // Handle dynamic results (spell check and text replacements) separately
    handleDynamicResultsUpdate(message.service, results);
    
    // Immediately rebuild and display results from all services
    rebuildAndDisplayResults().catch(error => {
        console.error('Error rebuilding display:', error);
    });
}

// Handle search completion
function handleSearchResultsComplete(message) {
    searchCompletionStatus = {
        totalServices: message.totalServices || 0,
        completedServices: message.completedServices || 0,
        isComplete: true
    };
    
    // Clear all search services since they're all done
    searchServices.clear();
    
    // Final rebuild and display
    rebuildAndDisplayResults().catch(error => {
        console.error('Error rebuilding display on completion:', error);
    });
    
    // Set searching to false after a small delay to ensure results are displayed
    setTimeout(() => {
        isSearching = false;
    }, 100);
    
    // Don't clear search state immediately - let it persist for continued searching
    // Only clear if user stops typing for a while
    setTimeout(() => {
        // Only clear if we're still in the same search session and no new search has started
        if (searchCompletionStatus.isComplete && !isSearching && lastSearchQuery === '') {
            searchServices.clear();
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
    
    // Remove existing status display
    const existingStatus = characterAutocompleteList.querySelector('.search-status-display');
    if (existingStatus) {
        existingStatus.remove();
    }
    
    if (searchServices.size === 0) return;
    
    const statusDisplay = document.createElement('div');
    statusDisplay.className = 'search-status-display';
    
    let statusHTML = '<div class="search-status-header"><i class="fas fa-search"></i> Searching...</div>';
    
    // Show service status
    for (const [serviceName, status] of searchServices) {
        const iconClass = getServiceIconClass(serviceName);
        const statusClass = getStatusClass(status);
        statusHTML += `
            <div class="search-service-status ${statusClass}">
                <i class="${iconClass}"></i>
                <span class="service-name">${serviceName}</span>
                <span class="service-status">${status}</span>
            </div>
        `;
    }
    
    // Show dynamic results status if available
    if (hasDynamicResults()) {
        const spellCheckCount = spellCheckResults.size;
        const textReplacementCount = textReplacementResults.size;
        
        statusHTML += '<div class="dynamic-results-status">';
        if (spellCheckCount > 0) {
            statusHTML += `<div class="dynamic-result-type"><i class="fas fa-spell-check"></i> Spell check: ${spellCheckCount} service(s)</div>`;
        }
        if (textReplacementCount > 0) {
            statusHTML += `<div class="dynamic-result-type"><i class="fas fa-exchange-alt"></i> Text replacements: ${textReplacementCount} service(s)</div>`;
        }
        statusHTML += '</div>';
    }
    
    statusDisplay.innerHTML = statusHTML;
    characterAutocompleteList.appendChild(statusDisplay);
}

// Get CSS class for service icon
function getServiceIconClass(serviceName) {
    switch (serviceName) {
        case 'nai-diffusion-4-5-full':
        case 'nai-diffusion-4-5':
        case 'nai-diffusion-4-full':
        case 'nai-diffusion-4-curated-preview':
        case 'nai-diffusion-3':
            return 'nai-sakura';
        case 'nai-diffusion-furry-3':
            return 'nai-paw';
        case 'furry-local':
            return 'nai-paw';
        case 'anime-local':
            return 'nai-sakura';
        case 'dual-match':
            return 'fas fa-link';
        case 'characters':
        case 'cached_characters':
            return 'fas fa-user';
        case 'tags':
        case 'cached_tags':
            return 'fas fa-tag';
        case 'textReplacements':
            return 'fas fa-code';
        case 'spellcheck':
            return 'fas fa-spell-check';
        case 'cached':
            return 'fas fa-database';
        default:
            return 'fas fa-question';
    }
}

// Get CSS class for status
function getStatusClass(status) {
    switch (status) {
        case 'searching':
            return 'status-searching';
        case 'stalled':
            return 'status-searching';
        case 'completed':
            return 'status-completed';
        case 'error':
            return 'status-error';
        default:
            return 'status-unknown';
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
        }, 500);
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
    }, 500);
}

function handleCharacterAutocompleteKeydown(e) {
            // Handle emphasis editing popup (but not when toolbar is in emphasis mode)
        if (window.emphasisEditingActive && !e.target.closest('.prompt-textarea-toolbar.emphasis-mode')) {
            // Handle integer inputs (0-9 keys)
            if (e.key >= '0' && e.key <= '9') {
                e.preventDefault();
                const integerValue = parseInt(e.key);
                window.emphasisEditingValue = integerValue.toFixed(1);
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
                    e.preventDefault();
                
                if (spellCheckNavigationMode) {
                    // Navigate left in spell check suggestions
                    const wordSections = spellCheckSection?.querySelectorAll('.spell-check-word');
                    if (wordSections && selectedSpellCheckWordIndex >= 0 && selectedSpellCheckWordIndex < wordSections.length) {
                        const currentWordSection = wordSections[selectedSpellCheckWordIndex];
                        const suggestionBtns = currentWordSection.querySelectorAll('.suggestion-btn');
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
                break;
                
            case 'ArrowRight':
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
        }
    }
}

async function searchCharacters(query, target) {
    try {
        // Only clear results if this is a completely new search query
        if (lastSearchQuery !== query) {
            searchServices.clear();
            searchResultsByService.clear();
            clearDynamicResults();
            allSearchResults = [];
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
        
        // Set the current target for autocomplete
        currentCharacterAutocompleteTarget = target;
        
        // Show autocomplete dropdown immediately with loading state
        updateAutocompleteDisplay([], target);
        updateSearchStatusDisplay();
        
        // Check if query starts with < - only return text replacements in this case
        const isTextReplacementSearch = query.startsWith('<');
        
        // Check if query starts with "Text:" - only perform spell correction in this case
        const isTextPrefixSearch = query.startsWith('Text:');

        let searchResults = [];
        let spellCheckData = null;

        if (!isTextReplacementSearch && !isTextPrefixSearch) {
            // Use WebSocket for search
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    const responseData = await window.wsClient.searchCharacters(query, manualModel.value);
                    searchResults = responseData.results || [];
                    spellCheckData = responseData.spellCheck || null;
                } catch (wsError) {
                    console.error('WebSocket search failed:', wsError);
                    throw new Error('Search service unavailable');
                }
            } else {
                throw new Error('WebSocket not connected');
            }
        }

        // Handle PICK_ prefix stripping for search but preserve in inserted text
        let searchQuery = query;
        let hasPickPrefix = false;

        if (query.startsWith('PICK_')) {
            searchQuery = query.substring(5); // Remove PICK_ prefix for searching
            hasPickPrefix = true;
        }

        // For text replacement searches, strip the < character from the search query
        if (isTextReplacementSearch) {
            searchQuery = searchQuery.substring(1); // Remove the < character
        }
        
        // For "Text:" searches, extract the text after the prefix for spell checking
        if (isTextPrefixSearch) {
            searchQuery = searchQuery.substring(5).trim(); // Remove "Text:" prefix
            
            // For "Text:" searches, we don't call the backend WebSocket
            // The backend will handle spell checking when it receives the query
            // We just need to send the full query to trigger spell checking
            if (window.wsClient && window.wsClient.isConnected()) {
                try {
                    const responseData = await window.wsClient.searchCharacters(query, manualModel.value);
                    spellCheckData = responseData.spellCheck || null;
                } catch (wsError) {
                    console.error('WebSocket spell check failed:', wsError);
                    // Continue without spell check
                }
            }
        }

        // Search through text replacements (only for non-"Text:" searches)
        if (!isTextPrefixSearch) {
            const textReplacementResults = Object.keys(window.optionsData?.textReplacements || {})
                .filter(key => {
                    const keyToSearch = key.startsWith('PICK_') ? key.substring(5) : key;
                    // If searchQuery is empty (just < was typed), return all items
                    if (searchQuery === '') {
                        return true;
                    }
                    return keyToSearch.toLowerCase().includes(searchQuery.toLowerCase());
                })
                .map((key, index) => ({
                    type: 'textReplacement',
                    name: key,
                    description: window.optionsData?.textReplacements[key],
                    placeholder: key, // The placeholder name like <NAME> or <PICK_NAME>
                    // If we searched with PICK_ prefix, ensure the result preserves it
                    displayName: hasPickPrefix && !key.startsWith('PICK_') ? `PICK_${key}` : key,
                    serviceOrder: index === 0 ? -1 : 10000, // Text replacements come first
                    resultOrder: index,
                    serviceName: 'textReplacements'
                }));

            // Add text replacements to the result collection
            if (textReplacementResults.length > 0) {
                searchResultsByService.set('textReplacements', textReplacementResults);
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
        searchServices.clear();
        searchResultsByService.clear();
        allSearchResults = [];
        searchCompletionStatus = {
            totalServices: 0,
            completedServices: 0,
            isComplete: false
        };
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
    selectedCharacterAutocompleteIndex = -1;

    // Store all results for potential expansion
    window.allAutocompleteResults = results;

    // Filter out spell check results from main display
    const displayResults = results.filter(result => result.type !== 'spellcheck');
    const spellCheckResult = results.find(result => result.type === 'spellcheck');

    // Show all results if expanded, otherwise show only first 5 items
    const limitedResults = autocompleteExpanded ? displayResults : displayResults.slice(0, 5);

    // Populate character autocomplete list
    characterAutocompleteList.innerHTML = '';

    // Show search status if we're currently searching
    if (isSearching && searchServices.size > 0) {
        updateSearchStatusDisplay();
    }

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
                    <span class="character-name">Press ↓ to show all ${displayResults.length} results</span>
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
        selectedCharacterAutocompleteIndex = 0;
        updateCharacterAutocompleteSelection();
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
        selectedCharacterAutocompleteIndex = 0;
        updateCharacterAutocompleteSelection();
    }
}

// New function to rebuild the autocomplete display
function rebuildAutocompleteDisplay(displayResults, limitedResults, spellCheckResult, target) {    
    // Clear the current display
    characterAutocompleteList.innerHTML = '';
    
    // Show search status if we're currently searching
    if (isSearching && searchServices.size > 0) {
        updateSearchStatusDisplay();
    }

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
                    <span class="character-name">Press ↓ to show all ${displayResults.length} results</span>
                </div>
            `;
            characterAutocompleteList.appendChild(moreItem);
        }
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
    
    // Use a more robust word finding approach
    const wordRegex = new RegExp(`\\b${originalWord.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b`, 'gi');
    let match;
    let closestDistance = Infinity;
    let closestMatch = null;
    
    // Find all occurrences and determine the closest one to cursor
    while ((match = wordRegex.exec(currentValue)) !== null) {
        const matchStart = match.index;
        const matchEnd = matchStart + match[0].length;
        
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
        
        target.value = newValue;
        
        // Calculate new cursor position - place it at the end of the replaced word
        const newCursorPos = closestMatch.start + suggestion.length;
        
        // Set cursor position after the replacement
        setTimeout(() => {
            target.setSelectionRange(newCursorPos, newCursorPos);
            target.focus();
        }, 0);
        
        // Trigger search with corrected text
        const event = new Event('input', { bubbles: true });
        target.dispatchEvent(event);
        
        // Hide autocomplete to show new results
        hideCharacterAutocomplete();
    } else {
        // Fallback: if we can't find the word, try the old method
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
            target.value = newValue;
            
            // Calculate new cursor position - place it at the end of the replaced word
            const newCursorPos = wordStartPos + suggestion.length;
            
            // Set cursor position after the replacement
            setTimeout(() => {
                target.setSelectionRange(newCursorPos, newCursorPos);
                target.focus();
            }, 0);
            
            // Trigger search with corrected text
            const event = new Event('input', { bubbles: true });
            target.dispatchEvent(event);
            
            // Hide autocomplete to show new results
            hideCharacterAutocomplete();
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

function updateCharacterAutocompleteSelection() {
    if (!characterAutocompleteList) return;

    const items = characterAutocompleteList.querySelectorAll('.character-autocomplete-item');
    items.forEach((item, index) => {
        item.classList.toggle('selected', index === selectedCharacterAutocompleteIndex);
    });

    // Scroll the selected item into view
    if (selectedCharacterAutocompleteIndex >= 0 && items[selectedCharacterAutocompleteIndex]) {
        const selectedItem = items[selectedCharacterAutocompleteIndex];
        selectedItem.scrollIntoView({
            block: 'nearest',
            behavior: 'smooth'
        });
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

    // Get the text after the cursor
    const textAfterCursor = currentValue.substring(cursorPosition);

    // Build the new prompt
    let newPrompt = '';

    // Keep the text before the current term (trim any trailing delimiters and spaces)
    const textBefore = currentValue.substring(0, startOfCurrentTerm).replace(/[,\s]*$/, '');
    newPrompt = textBefore;

    // Add the placeholder wrapped in angle brackets
    const wrappedPlaceholder = `<${placeholder}>`;
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

    // Set cursor position after the inserted placeholder
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

    // Get the text after the cursor
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

    // Set cursor position after the inserted tag
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

    // Hide character autocomplete
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

        // Hide character autocomplete
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
    }
    currentCharacterAutocompleteTarget = null;
    selectedCharacterAutocompleteIndex = -1;
    characterSearchResults = [];
    autocompleteNavigationMode = false;
    autocompleteExpanded = false;
    lastSearchText = ''; // Clear last search text so retyping works
    window.currentSpellCheckData = null; // Clear spell check data when hiding
    
    // Reset persistent state
    searchResultsByService.clear();
    persistentSpellCheckData = null;
    isAutocompleteVisible = false;
    
    // Clear search state
    lastSearchQuery = '';
    
    updateEmphasisTooltipVisibility();
}

function hideCharacterDetail() {
    // Since we're now replacing the content inside the autocomplete overlay,
    // we need to restore the original autocomplete list content
    const autocompleteList = document.querySelector('.character-autocomplete-list');

    if (autocompleteList && characterSearchResults.length > 0) {
        // Restore the original autocomplete suggestions
        showCharacterAutocompleteSuggestions(characterSearchResults, currentCharacterAutocompleteTarget);
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

    // Use the new display system to show all results
    updateAutocompleteDisplay(window.allAutocompleteResults, currentCharacterAutocompleteTarget);

    // Add all results using unified item creation
    displayResults.forEach((result, index) => {
        const item = createAutocompleteItem(result);
        characterAutocompleteList.appendChild(item);
    });

    // Maintain selection after expanding
    if (selectedCharacterAutocompleteIndex >= 0) {
        updateCharacterAutocompleteSelection();
    }
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
    const textReplacementResults = results.filter(result => result.type === 'textReplacement');
    if (textReplacementResults.length > 0) {
        textReplacementResults.set(serviceName, textReplacementResults);
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

// Check if we have any dynamic results
function hasDynamicResults() {
    return spellCheckResults.size > 0 || textReplacementResults.size > 0;
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
    
    // Log dual matches
    let dualMatchCount = 0;
    for (const result of tagMap.values()) {
        if (result.isDualMatch) {
            dualMatchCount++;
        }
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

