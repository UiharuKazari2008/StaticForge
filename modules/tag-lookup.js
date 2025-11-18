/**
 * @fileoverview Tag Lookup Module - Node.js compatible tag search and lookup functions
 * @description Extracted from tag-explorer.js for use in Node.js environment
 */

const fs = require('fs');
const path = require('path');
const globalResources = require('./globalResources');

// Load secure config to check for grok collections
let secureConfig = {};
try {
    secureConfig = require('../secure.config.json');
} catch (error) {
    // secure.config.json may not exist, that's okay
}

// ============================================================================
// File Loading
// ============================================================================

/**
 * Loads tag data from JSON file and builds search indexes
 * 
 * @param {string} filePath - Path to tags.json file
 * @returns {Object} Tag database object with indexes
 */
function loadTagData(filePath) {
    try {
        const fullPath = path.resolve(filePath);
        const fileContent = fs.readFileSync(fullPath, 'utf8');
        const data = JSON.parse(fileContent);
        
        // Build indexes for faster searching
        console.log('Building search indexes...');
        const indexes = {
            byTitle: new Map(),           // title.toLowerCase() -> tag
            byOtherName: new Map(),       // otherName.toLowerCase() -> array of tags
            byCategory: new Map(),        // category -> array of tags
            titleLowercase: new Map()     // Original title -> lowercase title
        };
        
        let processed = 0;
        for (const tag of Object.values(data)) {
            processed++;
            
            // Index by title (normalized) - convert underscores to spaces
            const titleLower = tag?.title?.toLowerCase().replace(/_/g, ' ');
            indexes.byTitle.set(titleLower, tag);
            indexes.titleLowercase.set(tag.title, titleLower);
            
            // Index by other names - convert underscores to spaces
            if (tag.other_names && Array.isArray(tag.other_names)) {
                for (const otherName of tag.other_names) {
                    const otherNameLower = otherName?.toLowerCase()?.replace(/_/g, ' ');
                    if (!indexes.byOtherName.has(otherNameLower)) {
                        indexes.byOtherName.set(otherNameLower, []);
                    }
                    indexes.byOtherName.get(otherNameLower).push(tag);
                }
            }
            
            // Index by category
            if (!indexes.byCategory.has(tag.category)) {
                indexes.byCategory.set(tag.category, []);
            }
            indexes.byCategory.get(tag.category).push(tag);
            
            if (processed % 50000 === 0) {
                console.log(`  Indexed ${processed}/${Object.keys(data).length} tags...`);
            }
        }
        
        console.log(`Built indexes for ${processed} tags\n`);
        
        // Extract tag groups for context
        const tagGroups = new Set();
        for (const tag of Object.values(data)) {
            if (tag.title.startsWith('tag_group:')) {
                // Extract clean group name (remove tag_group: prefix)
                const groupName = tag.title.replace('tag_group:', '').trim();
                tagGroups.add(groupName);
            }
        }
        console.log(`Found ${tagGroups.size} tag groups\n`);
        
        // Attach indexes and tag groups to data object
        data._indexes = indexes;
        data._tagGroups = Array.from(tagGroups).sort();
        
        return data;
    } catch (error) {
        throw new Error(`Failed to load tag data: ${error.message}`);
    }
}


// Lazy load tag database - only load when first accessed
const tagDatabaseFilePath = path.join(__dirname, '../danbooru_tagwiki.json');
let tagData = null;
let isLoading = false;
let isLoaded = false;

// Furry tag search instance (lazy-loaded from globalResources)
let furryTagSearch = null;
let furryTagSearchLoading = false;
let furryTagSearchPromise = null; // Shared promise for concurrent calls

/**
 * Ensures furry tag search is loaded before use
 * Only loads once, even if called multiple times
 * Multiple concurrent calls will await the same loading promise
 */
async function ensureFurryTagSearchLoaded() {
    if (furryTagSearch) return furryTagSearch;
    
    // If already loading, return the existing promise
    if (furryTagSearchPromise) {
        return furryTagSearchPromise;
    }

    // Start loading
    furryTagSearchLoading = true;
    furryTagSearchPromise = (async () => {
        try {
            // Check if globalResources is initialized
            if (globalResources.isInitialized && globalResources.isInitialized()) {
                furryTagSearch = await globalResources.getFurryTagSearch();
                console.log('🐾 Furry tag search loaded from global resources');
            }
            return furryTagSearch;
        } catch (error) {
            console.error('❌ Failed to load furry tag search:', error.message);
            furryTagSearch = null;
            return null;
        } finally {
            furryTagSearchLoading = false;
            furryTagSearchPromise = null; // Clear promise after completion
        }
    })();
    
    return furryTagSearchPromise;
}

/**
 * Ensures tag database is loaded before use
 * Only loads once, even if called multiple times
 * Skips loading if grok collections are enabled
 */
function ensureTagDataLoaded() {
    if (isLoaded) return;
    if (isLoading) return; // Prevent multiple simultaneous loads
    
    // Skip loading if grok collections are enabled
    if (secureConfig.grok?.tagWikiCollectionId) {
        console.log('⏭️  Skipping wiki database load (Server-side tag wiki collection enabled)');
        tagData = {};
        isLoaded = true;
        isLoading = false;
        return;
    }
    
    isLoading = true;
    console.log('🔍 Loading Danbooru tag database...');
    try {
        tagData = loadTagData(tagDatabaseFilePath);
        console.log(`✅ Loaded ${Object.keys(tagData).length} tags from ${tagDatabaseFilePath}`);
        isLoaded = true;
        
        // Pre-cache tag groups info immediately after loading
        if (tagData && tagData._tagGroups) {
            console.log('📋 Pre-caching tag groups info...');
            getTagGroupsInfo();
        }

    } catch (error) {
        console.error(`❌ Failed to load tag database:`, error.message);
        tagData = {};
        isLoaded = true;
    }
    isLoading = false;
}

// ============================================================================
// Helper Functions
// ============================================================================

/**
 * Returns human-readable category name for a given category ID
 * 
 * @param {number} categoryId - Numeric category identifier
 * @returns {string} Category name
 */
function getCategoryName(categoryId) {
    // Handle numeric categories (danbooru format)
    if (typeof categoryId === 'number') {
        switch(categoryId) {
            case 0: return 'General';
            case 1: return 'Artist';
            case 3: return 'Copyright';
            case 4: return 'Character';
            case 5: return 'Meta';
            default: return 'Uncategorized';
        }
    }

    // Handle string categories (furry format)
    if (typeof categoryId === 'string') {
        switch(categoryId.toLowerCase()) {
            case 'character': return 'Character';
            case 'species': return 'Species';
            case 'copyright': return 'Copyright';
            case 'general': return 'General';
            case 'artist': return 'Artist';
            case 'meta': return 'Meta';
            default: return categoryId.charAt(0).toUpperCase() + categoryId.slice(1); // Capitalize first letter
        }
    }

    return 'Uncategorized';
}

/**
 * Calculates Levenshtein distance between two strings for fuzzy matching
 * 
 * @param {string} str1 - First string to compare
 * @param {string} str2 - Second string to compare
 * @returns {number} Edit distance (0 = identical, higher = more different)
 */
function levenshteinDistance(str1, str2) {
    const len1 = str1.length;
    const len2 = str2.length;
    const matrix = [];
    
    // Initialize matrix
    for (let i = 0; i <= len1; i++) {
        matrix[i] = [i];
    }
    for (let j = 0; j <= len2; j++) {
        matrix[0][j] = j;
    }
    
    // Fill matrix
    for (let i = 1; i <= len1; i++) {
        for (let j = 1; j <= len2; j++) {
            if (str1[i - 1] === str2[j - 1]) {
                matrix[i][j] = matrix[i - 1][j - 1];
            } else {
                matrix[i][j] = Math.min(
                    matrix[i - 1][j] + 1,     // deletion
                    matrix[i][j - 1] + 1,     // insertion
                    matrix[i - 1][j - 1] + 1  // substitution
                );
            }
        }
    }
    
    return matrix[len1][len2];
}

/**
 * Checks if a search term matches a tag title using fuzzy and pattern matching
 * 
 * Returns a match score indicating how well the search term matches:
 * - 100: Exact match
 * - 90: Exact match in parentheses or with underscores
 * - 80: Starts with search term
 * - 70: Ends with search term
 * - 60: Contains as whole word (separated by underscores)
 * - 50: Contains as substring
 * - 40-10: Fuzzy match based on Levenshtein distance
 * - 0: No match
 * 
 * @param {string} title - Tag title to search in (lowercase)
 * @param {string} searchTerm - Search term to match (lowercase, normalized)
 * @returns {number} Match score (0-100) or 0 if no match
 */
function getTitleMatchScore(title, searchTerm) {
    // Safety check
    if (!title || !searchTerm) return 0;
    
    // Normalize both for comparison: convert spaces/hyphens/parentheses to underscores
    const normalizedTitle = title.replace(/[\s\-\(\)]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    const normalizedSearch = searchTerm.replace(/[\s\-\(\)]+/g, '_').replace(/_+/g, '_').replace(/^_|_$/g, '');
    
    // Exact match (highest priority)
    if (title === searchTerm || normalizedTitle === normalizedSearch) {
        return 100;
    }
    
    // Try with hyphen in title (some tags use hyphens, some use underscores)
    const hyphenTitle = title.replace(/_/g, '-');
    const hyphenSearch = searchTerm.replace(/_/g, '-');
    if (hyphenTitle === searchTerm || hyphenTitle.toLowerCase() === hyphenSearch.toLowerCase()) {
        return 90;
    }
    
    // Check if search term appears in parentheses (e.g., "(nikke)")
    const parenPattern = new RegExp(`\\(${searchTerm.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\)`, 'i');
    if (parenPattern.test(title)) {
        return 90;
    }
    
    // Check if title starts with search term (with underscore separator)
    const startsPattern = new RegExp(`^${normalizedSearch}_`, 'i');
    if (startsPattern.test(title)) {
        return 80;
    }
    
    // Check if title ends with search term (with underscore separator)
    const endsPattern = new RegExp(`_${normalizedSearch}$`, 'i');
    if (endsPattern.test(title)) {
        return 70;
    }
    
    // Check if search term appears as whole word separated by underscores (e.g., "_nikke_")
    const wholeWordPattern = new RegExp(`_${normalizedSearch}_`, 'i');
    if (wholeWordPattern.test(title)) {
        return 60;
    }
    
    // Check if title contains the normalized search term as substring
    if (title.includes(normalizedSearch)) {
        return 50;
    }
    
    // Check if title contains search term as substring (case-insensitive)
    if (title.includes(searchTerm)) {
        return 50;
    }
    
    // Fuzzy matching: check for similar strings
    // Extract words from title (split by underscores)
    const titleWords = title.split('_').filter(w => w.length > 0);
    let bestFuzzyScore = 0;
    
    for (const word of titleWords) {
        // Skip fuzzy matching if words are too different in length
        const lengthDiff = Math.abs(word.length - searchTerm.length);
        if (lengthDiff > Math.max(searchTerm.length * 0.5, 3)) {
            continue;
        }
        
        // Calculate similarity
        const distance = levenshteinDistance(word, searchTerm);
        const maxLen = Math.max(word.length, searchTerm.length);
        const similarity = (1 - distance / maxLen) * 100;
        
        // Only consider matches with >70% similarity
        if (similarity > 70 && similarity > bestFuzzyScore) {
            bestFuzzyScore = Math.round(similarity * 0.4); // Scale fuzzy matches lower
        }
    }
    
    return bestFuzzyScore;
}

// ============================================================================
// Search Functions
// ============================================================================

/**
 * Searches through tag data and returns matching tags with fuzzy matching
 * 
 * @param {Object<string, Object>} data - Tag database object with tags as values
 * @param {string} searchTerm - Search query string to match against tags
 * @param {Object} options - Search options
 * @param {number} options.category - Filter by category ID (optional)
 * @param {boolean} options.exactMatchOnly - Only return exact matches (default: false)
 * @param {boolean} options.allowFuzzy - Allow fuzzy matching (default: true)
 * @param {number} options.minUseCount - Minimum usage count filter (optional)
 * @param {number} options.limit - Max results to return (default: 10)
 * @returns {Array<Object>} Array of matching tag objects, sorted by relevance
 */
function searchTags(searchTerm, options = {}) {
    const {
        category,
        exactMatchOnly = false,
        allowFuzzy = true,
        minUseCount,
        limit = 10
    } = options;

    const searchLower = searchTerm.toLowerCase().trim();
    if (!searchLower) return [];
    
    // Normalize search: lowercase and convert spaces/hyphens to underscores
    const normalizedSearch = searchLower.replace(/[\s\-]+/g, '_');
    
    // Check if this is an "artist:" tag - if so, boost artist category results
    const isArtistTag = searchLower.startsWith('artist:');
    const artistNameOnly = isArtistTag ? searchLower.replace(/^artist:\s*/, '') : null;
    
    const matches = [];
    const indexes = tagData._indexes;
    
    // If we have indexes, use them for much faster searching
    if (indexes) {
        // Get tags to search based on category filter
        let tagsToSearch;
        if (category !== undefined) {
            tagsToSearch = indexes.byCategory.get(category) || [];
        } else {
            tagsToSearch = Object.values(tagData);
        }
        
        // Fast path: exact match in title
        const exactMatch = indexes.byTitle.get(searchLower);
        if (exactMatch && (!category || exactMatch.category === category)) {
            if (!minUseCount || exactMatch.n >= minUseCount) {
                matches.push({ tag: exactMatch, score: 100, matchType: 'title' });
            }
        }
        
        // Fast path: exact match in other names
        if (!exactMatchOnly) {
            const otherNameMatch = indexes.byOtherName.get(searchLower);
            if (otherNameMatch) {
                for (const tag of otherNameMatch) {
                    if ((!category || tag.category === category) && (!minUseCount || tag.n >= minUseCount)) {
                        if (!matches.find(m => m.tag.title === tag.title)) {
                            matches.push({ tag: tag, score: 100, matchType: 'other_name' });
                        }
                    }
                }
            }
        }
        
        // If we have exact matches and exactMatchOnly is set, return early
        if (exactMatchOnly && matches.length > 0) {
            return matches.slice(0, limit).map(m => m.tag);
        }
        
        // If we have exact matches (score 100) and got enough results, skip expensive fuzzy matching
        const exactMatches = matches.filter(m => m.score === 100);
        if (exactMatches.length >= limit) {
            return matches.slice(0, limit).map(m => m.tag);
        }
        
        // Continue with fuzzy matching if needed
        if (!exactMatchOnly && allowFuzzy) {
            // Only search through a subset of tags for fuzzy matching to improve performance
            // Limit to tags that start with the same letter or are in the same category
            const firstChar = searchLower[0];
            const fuzzyCandidates = [];
            let checked = 0;
            const maxFuzzyChecks = 5000; // Limit fuzzy search to first 5000 potential matches
            
            for (const tag of tagsToSearch) {
                if (checked++ > maxFuzzyChecks) break;
                
                // Skip if already in exact matches
                if (exactMatches.some(m => m.tag.title === tag.title)) continue;
                
                // Quick filter: only check tags that share first character or are very short
                const tagLower = tag.title?.toLowerCase();
                if (!tagLower) continue;
                
                // Prioritize tags that start with the same character or are very short (< 3 chars difference in length)
                const lengthDiff = Math.abs(tagLower.length - searchLower.length);
                if (tagLower[0] === firstChar || lengthDiff <= 3) {
                    fuzzyCandidates.push(tag);
                }
            }
            
            for (const tag of fuzzyCandidates) {
                if (minUseCount && tag.n < minUseCount) continue;
                
                // Safety check for tags without titles
                if (!tag || !tag.title) continue;
                
                const title = tag.title.toLowerCase();
                const body = tag.body ? tag.body.toLowerCase() : '';
                const otherNames = tag.other_names || [];
                
                let bestScore = 0;
                let matchType = null;
                
                // Check title match
                const titleScore = getTitleMatchScore(title, searchLower);
                if (titleScore > bestScore) {
                    bestScore = titleScore;
                    matchType = 'title';
                }
                
                // Check other_names array
                if (otherNames && Array.isArray(otherNames) && otherNames.length > 0) {
                    for (const name of otherNames) {
                        if (!name) continue; // Skip null/undefined names
                        const nameLower = name.toLowerCase();
                        const nameScore = getTitleMatchScore(nameLower, searchLower);
                        if (nameScore > bestScore) {
                            bestScore = nameScore;
                            matchType = 'other_name';
                        }
                    }
                }
                
                // Check body text (lower priority, only substring match)
                if (bestScore < 50 && body.includes(searchLower)) {
                    bestScore = 30;
                    matchType = 'body';
                }
                
                // Apply fuzzy filter
                if (!allowFuzzy && bestScore < 50) {
                    continue;
                }
                
                // Only include matches with score > 0
                if (bestScore > 0) {
                    matches.push({
                        tag: tag,
                        score: bestScore,
                        matchType: matchType
                    });
                }
            }
        }
        
        // Sort by score (descending), then by usage count (descending), then boost artist category if applicable
        matches.sort((a, b) => {
            // Boost artist category if searching for an artist tag
            let scoreA = a.score;
            let scoreB = b.score;
            
            if (isArtistTag && a.tag.category === 1) {
                scoreA += 10; // Boost artist category results
            }
            if (isArtistTag && b.tag.category === 1) {
                scoreB += 10; // Boost artist category results
            }
            
            if (scoreB !== scoreA) {
                return scoreB - scoreA;
            }
            return b.tag.n - a.tag.n;
        });
        
        // Apply limit and return just the tag objects
        const results = matches.slice(0, limit).map(m => m.tag);
        if (results.length > 0) {
            console.log(`    [searchTags] Found ${matches.length} total matches, returning top ${results.length} for "${searchTerm}"`);
        }
        return results;
    }
    
    // Fallback to non-indexed search if no indexes available
    return searchTagsFallback(searchTerm, options);
}

// Fallback search function without indexes
function searchTagsFallback(searchTerm, options) {
    const {
        category,
        exactMatchOnly = false,
        allowFuzzy = true,
        minUseCount,
        limit = 10
    } = options;

    const searchLower = searchTerm.toLowerCase().trim();
    if (!searchLower) return [];
    
    const normalizedSearch = searchLower.replace(/[\s\-]+/g, '_');
    const matches = [];
    
    for (const tag of Object.values(tagData)) {
        if (category !== undefined && tag.category !== category) continue;
        if (minUseCount && tag.n < minUseCount) continue;
        
        const title = tag.title.toLowerCase();
        const body = tag.body ? tag.body.toLowerCase() : '';
        const otherNames = tag.other_names || [];
        
        let bestScore = 0;
        let matchType = null;
        
        const titleScore = getTitleMatchScore(title, searchLower);
        if (titleScore > bestScore) {
            bestScore = titleScore;
            matchType = 'title';
        }
        
        if (otherNames && Array.isArray(otherNames) && otherNames.length > 0) {
            for (const name of otherNames) {
                if (!name) continue; // Skip null/undefined names
                const nameLower = name.toLowerCase();
                const nameScore = getTitleMatchScore(nameLower, searchLower);
                if (nameScore > bestScore) {
                    bestScore = nameScore;
                    matchType = 'other_name';
                }
            }
        }
        
        if (allowFuzzy && bestScore < 50 && body.includes(searchLower)) {
            bestScore = 30;
            matchType = 'body';
        }
        
        if (exactMatchOnly && bestScore < 90) continue;
        if (!allowFuzzy && bestScore < 50) continue;
        
        if (bestScore > 0) {
            matches.push({ tag, score: bestScore, matchType });
        }
    }
    
    matches.sort((a, b) => {
        if (b.score !== a.score) return b.score - a.score;
        return b.tag.n - a.tag.n;
    });
    
    return matches.slice(0, limit).map(m => m.tag);
}

/**
 * Finds exact tag match by name (checks title and other_names)
 * 
 * @param {string} tagName - Tag name to find
 * @returns {Object|null} Tag object if found, null otherwise
 */
function findTagExact(tagName) {
    ensureTagDataLoaded();
    if (!tagData) {
        return null;
    }
    
    // Normalize the tag name for comparison
    const normalizedName = tagName.trim().toLowerCase().replace(/[\s\-]+/g, '_');
    const indexes = tagData._indexes;
    
    // Use indexes if available
    if (indexes) {
        // Check title index
        const exactMatch = indexes.byTitle.get(normalizedName);
        if (exactMatch) {
            return exactMatch;
        }
        
        // Check other names index
        const otherNameMatch = indexes.byOtherName.get(normalizedName);
        if (otherNameMatch && otherNameMatch.length > 0) {
            return otherNameMatch[0]; // Return first match
        }
        
        return null;
    }
    
    // Fallback to linear search if no indexes
    for (const tag of Object.values(tagData)) {
        const tagTitle = tag.title.toLowerCase();
        
        if (tagTitle === normalizedName) {
            return tag;
        }
        
        if (tag.other_names && Array.isArray(tag.other_names)) {
            for (const otherName of tag.other_names) {
                const otherNameLower = otherName.toLowerCase().replace(/[\s\-]+/g, '_');
                if (otherNameLower === normalizedName) {
                    return tag;
                }
            }
        }
    }
    
    return null;
}

/**
 * Resolves linked tags with configurable depth
 * 
 * @param {string} tagName - Tag name to resolve links for
 * @param {number} depth - How many levels deep to resolve (default: 1)
 * @param {string} direction - 'both'|'to'|'by' (default: 'both')
 * @returns {Object} Object with linksTo and/or linkedBy arrays
 */
function getLinkedTags(tagName, depth = 1, direction = 'both') {
    const result = {
        linksTo: [],
        linkedBy: []
    };
    
    const tag = findTagExact(tagName);
    if (!tag) {
        return result;
    }
    
    const visited = new Set();
    const queue = [{ tag: tag, currentDepth: 0 }];
    
    while (queue.length > 0 && queue[0].currentDepth < depth) {
        const { tag: currentTag, currentDepth } = queue.shift();
        
        if (visited.has(currentTag.title)) {
            continue;
        }
        visited.add(currentTag.title);
        
        // Process links to
        if (direction === 'both' || direction === 'to') {
            if (currentTag.is_linking_to && Array.isArray(currentTag.is_linking_to)) {
                for (const linkName of currentTag.is_linking_to) {
                    if (currentDepth === 0) {
                        // Direct links - add to result
                        const linkedTag = findTagExact(linkName);
                        if (linkedTag && !result.linksTo.find(t => t.title === linkedTag.title)) {
                            result.linksTo.push(linkedTag);
                        }
                    }
                    // Add to queue for deeper resolution
                    if (currentDepth < depth - 1) {
                        const linkedTag = findTagExact(linkName);
                        if (linkedTag) {
                            queue.push({ tag: linkedTag, currentDepth: currentDepth + 1 });
                        }
                    }
                }
            }
        }
        
        // Process linked by
        if (direction === 'both' || direction === 'by') {
            if (currentTag.is_linked_by && Array.isArray(currentTag.is_linked_by)) {
                for (const linkName of currentTag.is_linked_by) {
                    if (currentDepth === 0) {
                        // Direct links - add to result
                        const linkedTag = findTagExact(linkName);
                        if (linkedTag && !result.linkedBy.find(t => t.title === linkedTag.title)) {
                            result.linkedBy.push(linkedTag);
                        }
                    }
                    // Add to queue for deeper resolution
                    if (currentDepth < depth - 1) {
                        const linkedTag = findTagExact(linkName);
                        if (linkedTag) {
                            queue.push({ tag: linkedTag, currentDepth: currentDepth + 1 });
                        }
                    }
                }
            }
        }
    }
    
    return result;
}

/**
 * Converts furry tag format to danbooru-compatible format
 * @param {Object} furryTag - Furry tag object from FurryTagSearch
 * @returns {Object} Tag object in danbooru format
 */
function convertFurryTagToDanbooruFormat(furryTag) {
    return {
        title: furryTag.tag_name || furryTag.tag,
        n: furryTag.n_count || furryTag.e_count || 0, // Use 'n' property for compatibility with existing processing code
        category: furryTag.e_category || 0,
        categoryName: getCategoryName(furryTag.e_category || 0),
        body: furryTag.e_name || '',
        // Add a marker to identify this as a furry tag
        source: 'furry',
        // Include original furry-specific fields
        e_name: furryTag.e_name,
        e_count: furryTag.e_count,
        n_count: furryTag.n_count,
        e_group: furryTag.e_group
    };
}

/**
 * Formats tag details as compact markdown for token optimization
 * @param {Array<Object>} results - Array of tag detail objects
 * @returns {string} Markdown formatted string
 */
function formatTagDetailsAsMarkdown(results) {
    const lines = [];
    
    for (const tag of results) {
        if (tag.error) {
            lines.push(`## ${tag.searchTerm || 'Unknown'}\n*Error: ${tag.error}*\n`);
            continue;
        }
        
        // Add separator between tags
        if (lines.length > 0) {
            lines.push('\n');
        }
        
        const parts = [];
        parts.push(`**${tag.title || tag.searchTerm}**`);
        
        if (tag.usage !== undefined) {
            parts.push(`(usage: ${tag.usage.toLocaleString()})`);
        }
        
        if (tag.categoryName) {
            parts.push(`[${tag.categoryName}]`);
        } else if (tag.category !== undefined) {
            parts.push(`[cat:${tag.category}]`);
        }
        
        lines.push(`## ${parts.join(' ')}`);
        
        // Body preview - show memory reference if exists, otherwise show preview
        if (tag.bodyMemory) {
            // Memory exists - show memory reference
            lines.push(`\n💾 \`${tag.bodyMemory}\` | \`getBodyChunk("${tag.title}", 0)\``);
        } else if (tag.body && tag.body.trim().length > 0) {
            lines.push(`\n**Description:**\n`);
            if (tag.bodySameAsTitle) {
                lines.push(`  > ${tag.body}`);
            } else if (tag.bodyTruncated || tag.bodyPreview) {
                const bodyLines = tag.body.split('\n');
                bodyLines.forEach(line => {
                    lines.push(`  > ${line}`);
                });
                if (tag.bodyTotalLength) {
                    lines.push(`  > *(${tag.bodyTotalLength}ch)*`);
                }
                lines.push(`\n💡 \`getBodyChunk("${tag.title}", 0)\``);
            } else {
                const bodyLines = tag.body.split('\n');
                bodyLines.forEach(line => {
                    lines.push(`  > ${line}`);
                });
            }
        }
        
        // Links as table
        if (tag.linksTo && tag.linksTo.length > 0) {
            lines.push(`\n**Links To:**`);
            lines.push(`| Tag | Usage |`);
            lines.push(`|-----|-------|`);
            tag.linksTo.slice(0, 10).forEach(link => {
                const linkTitle = typeof link === 'string' ? link : link.title;
                const linkUsage = typeof link === 'object' && link.usage !== undefined ? link.usage.toLocaleString() : '-';
                lines.push(`| ${linkTitle} | ${linkUsage} |`);
            });
            if (tag.linksTo.length > 10) {
                lines.push(`| *... ${tag.linksTo.length - 10} more* | |`);
            }
        }
        
        // Linked by as table
        if (tag.linkedBy && tag.linkedBy.length > 0) {
            lines.push(`\n**Linked By:**`);
            lines.push(`| Tag | Usage |`);
            lines.push(`|-----|-------|`);
            tag.linkedBy.slice(0, 10).forEach(link => {
                const linkTitle = typeof link === 'string' ? link : link.title;
                const linkUsage = typeof link === 'object' && link.usage !== undefined ? link.usage.toLocaleString() : '-';
                lines.push(`| ${linkTitle} | ${linkUsage} |`);
            });
            if (tag.linkedBy.length > 10) {
                lines.push(`| *... ${tag.linkedBy.length - 10} more* | |`);
            }
        }
        
        // Other names as inline list (short, doesn't need table)
        if (tag.otherNames && tag.otherNames.length > 0) {
            const otherNamesList = tag.otherNames.slice(0, 5).join(', ');
            const moreCount = tag.otherNames.length > 5 ? tag.otherNames.length - 5 : 0;
            lines.push(`\n**Also:** ${otherNamesList}${moreCount > 0 ? ` *(+${moreCount})*` : ''}`);
        }
        
        // ID if available
        if (tag.id !== undefined) {
            lines.push(`\n### Metadata\n`);
            lines.push(`**ID:** ${tag.id}`);
        }
        
        lines.push(''); // Empty line between tags
    }
    
    return lines.join('\n');
}

/**
 * Formats search by description results as compact markdown for token optimization
 * @param {Array<Object>} results - Array of tag match objects
 * @param {string} description - The original search description
 * @returns {string} Markdown formatted string
 */
function formatSearchByDescriptionAsMarkdown(results, description) {
    const lines = [];
    lines.push(`## Search Results for: "${description}"`);
    lines.push(`\n*Found ${results.length} match${results.length !== 1 ? 'es' : ''}*\n`);
    
    // Use table for main results
    lines.push(`| # | Tag | Usage | Category | Score | Matched |`);
    lines.push(`|---|-----|-------|----------|-------|---------|`);
    results.forEach((tag, index) => {
        const title = tag.title || '-';
        const usage = tag.usage !== undefined ? tag.usage.toLocaleString() : '-';
        const category = tag.category || '-';
        const score = tag.matchScore !== undefined ? tag.matchScore : '-';
        const matched = tag.matchedWords || '-';
        lines.push(`| ${index + 1} | ${title} | ${usage} | ${category} | ${score} | ${matched} |`);
    });
    
    // Body previews below table (only for first 3 to save tokens)
    results.slice(0, 3).forEach((tag, index) => {
        if (tag.bodyMemory) {
            // Memory exists - show memory reference
            lines.push(`\n### ${tag.title}\n`);
            lines.push(`\n💾 \`${tag.bodyMemory}\` | \`getBodyChunk("${tag.title}", 0)\``);
        } else if (tag.body && tag.body.trim().length > 0) {
            lines.push(`\n### ${tag.title}\n`);
            lines.push(`**Description:**\n`);
            if (tag.bodySameAsTitle) {
                lines.push(`> ${tag.body}`);
            } else if (tag.bodyTruncated || tag.bodyPreview) {
                const bodyLines = tag.body.split('\n');
                bodyLines.forEach(line => {
                    lines.push(`> ${line}`);
                });
                if (tag.bodyTotalLength) {
                    lines.push(`> *(${tag.bodyTotalLength}ch)*`);
                }
                lines.push(`\n💡 \`getBodyChunk("${tag.title}", 0)\``);
            } else {
                const bodyLines = tag.body.split('\n');
                bodyLines.forEach(line => {
                    lines.push(`> ${line}`);
                });
            }
        }
    });
    
    if (results.length > 3) {
        lines.push(`\n*... ${results.length - 3} more (getBodyChunk)*`);
    }
    
    return lines.join('\n');
}

/**
 * Formats tag suggestions as compact markdown for token optimization
 * @param {Array<Object>} suggestions - Array of tag suggestion objects
 * @param {string} originalTag - The original tag that was searched
 * @returns {string} Markdown formatted string
 */
function formatTagSuggestionsAsMarkdown(suggestions, originalTag) {
    const lines = [];
    lines.push(`## Tag Suggestions for "${originalTag.replace(/_/g, ' ')}"`);
    lines.push(`\n*Found ${suggestions.length} suggestion${suggestions.length !== 1 ? 's' : ''}*\n`);
    
    // Use table for main suggestions
    lines.push(`| # | Tag | Usage | Category | Reason |`);
    lines.push(`|---|-----|-------|----------|--------|`);
    suggestions.forEach((tag, index) => {
        const title = tag.title || '-';
        const usage = tag.usage !== undefined ? tag.usage.toLocaleString() : '-';
        const category = tag.category || '-';
        const reason = tag.reason || '-';
        lines.push(`| ${index + 1} | ${title} | ${usage} | ${category} | ${reason} |`);
    });
    
    // Body previews below table (only for first 3 to save tokens)
    suggestions.slice(0, 3).forEach((tag) => {
        if (tag.bodyMemory) {
            // Memory exists - show memory reference
            lines.push(`\n### ${tag.title}\n`);
            lines.push(`\n💾 \`${tag.bodyMemory}\` | \`getBodyChunk("${tag.title}", 0)\``);
        } else if (tag.body && tag.body.trim().length > 0) {
            lines.push(`\n### ${tag.title}\n`);
            lines.push(`**Description:**\n`);
            if (tag.bodySameAsTitle) {
                lines.push(`> ${tag.body}`);
            } else if (tag.bodyTruncated || tag.bodyPreview) {
                const bodyLines = tag.body.split('\n');
                bodyLines.forEach(line => {
                    lines.push(`> ${line}`);
                });
                if (tag.bodyTotalLength) {
                    lines.push(`> *(${tag.bodyTotalLength}ch)*`);
                }
                lines.push(`\n💡 \`getBodyChunk("${tag.title}", 0)\``);
            } else {
                const bodyLines = tag.body.split('\n');
                bodyLines.forEach(line => {
                    lines.push(`> ${line}`);
                });
            }
        }
    });
    
    if (suggestions.length > 3) {
        lines.push(`\n*... ${suggestions.length - 3} more (getBodyChunk)*`);
    }
    
    return lines.join('\n');
}

/**
 * Formats tag search results as compact markdown for token optimization
 * @param {Object} results - Results object mapping tag names to arrays of tag objects
 * @returns {string} Markdown formatted string
 */
function formatSearchTagsBatchAsMarkdown(results) {
    const lines = [];
    
    for (const [searchTerm, tags] of Object.entries(results)) {
        if (tags.length === 0) {
            lines.push(`## ${searchTerm}\n*No results found*\n`);
            continue;
        }
        
        lines.push(`## ${searchTerm} (${tags.length} result${tags.length !== 1 ? 's' : ''})`);
        
        // One-time note about memory creation (token-efficient)
        lines.push(`\n*💡 Create memories (tag_wiki): \`saveKnowledgeMemory\` or \`insight_memory\`*`);
        
        // Use table for tag list
        lines.push(`\n| # | Tag | Usage | Category |`);
        lines.push(`|---|-----|-------|----------|`);
        tags.forEach((tag, index) => {
            const title = tag.title || '-';
            const usage = tag.usage !== undefined ? tag.usage.toLocaleString() : '-';
            const category = tag.categoryName || (tag.category !== undefined ? `cat:${tag.category}` : '-');
            lines.push(`| ${index + 1} | ${title} | ${usage} | ${category} |`);
        });
        
        // Body previews and links below table (only for first 3 to save tokens)
        for (let i = 0; i < Math.min(3, tags.length); i++) {
            const tag = tags[i];
            
            // Add header for each tag's details
            lines.push(`\n### ${tag.title}\n`);
            
            // Show body preview - check for memory first
            if (tag.bodyMemory) {
                // Memory exists - show memory reference
                lines.push(`\n💾 \`${tag.bodyMemory}\` | \`getBodyChunk("${tag.title}", 0)\``);
            } else if (tag.body && tag.body.trim().length > 0) {
                lines.push(`**Description:**\n`);
                if (tag.bodySameAsTitle) {
                    // Body is same as title - show note
                    lines.push(`> ${tag.body}`);
                } else if (tag.bodyTruncated || tag.bodyPreview) {
                    // Body is truncated - show preview (already cleaned and limited to 250 chars)
                    const bodyLines = tag.body.split('\n');
                    bodyLines.forEach(line => {
                        lines.push(`> ${line}`);
                    });
                    if (tag.bodyTotalLength) {
                        lines.push(`> *(${tag.bodyTotalLength}ch)*`);
                    }
                    lines.push(`\n💡 \`getBodyChunk("${tag.title}", 0)\``);
                } else {
                    // Full body fits - show it with proper formatting
                    const bodyLines = tag.body.split('\n');
                    bodyLines.forEach(line => {
                        lines.push(`  > ${line}`);
                    });
                }
            }
            
            // Links as table
            if (tag.linksTo && tag.linksTo.length > 0) {
                lines.push(`\n**Links To:**`);
                lines.push(`| Tag | Usage |`);
                lines.push(`|-----|-------|`);
                tag.linksTo.slice(0, 8).forEach(link => {
                    const linkTitle = typeof link === 'string' ? link : link.title;
                    const linkUsage = typeof link === 'object' && link.usage !== undefined ? link.usage.toLocaleString() : '-';
                    lines.push(`| ${linkTitle} | ${linkUsage} |`);
                });
                if (tag.linksTo.length > 8) {
                    lines.push(`| *... ${tag.linksTo.length - 8} more* | |`);
                }
            }
            
            // Linked by as table
            if (tag.linkedBy && tag.linkedBy.length > 0) {
                lines.push(`\n**Linked By:**`);
                lines.push(`| Tag | Usage |`);
                lines.push(`|-----|-------|`);
                tag.linkedBy.slice(0, 8).forEach(link => {
                    const linkTitle = typeof link === 'string' ? link : link.title;
                    const linkUsage = typeof link === 'object' && link.usage !== undefined ? link.usage.toLocaleString() : '-';
                    lines.push(`| ${linkTitle} | ${linkUsage} |`);
                });
                if (tag.linkedBy.length > 8) {
                    lines.push(`| *... ${tag.linkedBy.length - 8} more* | |`);
                }
            }
            
            // Other names as inline (short, doesn't need table)
            if (tag.otherNames && tag.otherNames.length > 0) {
                const otherNamesList = tag.otherNames.slice(0, 5).join(', ');
                const moreCount = tag.otherNames.length > 5 ? tag.otherNames.length - 5 : 0;
                lines.push(`\n**Also:** ${otherNamesList}${moreCount > 0 ? ` *(+${moreCount})*` : ''}`);
            }
        }
        
        if (tags.length > 3) {
            lines.push(`\n*... ${tags.length - 3} more (getTagDetails)*`);
        }
        
        lines.push(''); // Empty line between search terms
    }
    
    return lines.join('\n');
}

/**
 * Strips wiki formatting from body text for clean preview
 * Removes: [[links]], '''bold''', ''italic'', h4/h5 headers, anchor links, etc.
 * @param {string} text - Text with wiki formatting
 * @returns {string} Plain text without wiki formatting
 */
function stripWikiFormatting(text) {
    if (!text) return '';
    
    let cleaned = text;
    
    // Remove anchor links: [#anchor|text] or [#anchor]
    cleaned = cleaned.replace(/\[#([^\]]+)\|([^\]]+)\]/g, '$2');
    cleaned = cleaned.replace(/\[#([^\]]+)\]/g, '');
    
    // Remove wiki links: [[tag]] or [[display|tag]] - keep display text or tag name
    // Use non-greedy match and handle multiple passes for nested brackets
    let previousLength;
    do {
        previousLength = cleaned.length;
        cleaned = cleaned.replace(/\[\[([^\]]+?)\]\]/g, (match, content) => {
            // Skip if content still contains [[ (nested, will be handled in next pass)
            if (content.includes('[[')) {
                return match; // Keep as-is for next pass
            }
            if (content.includes('|')) {
                const parts = content.split('|');
                return parts[parts.length - 1].trim(); // Return the tag name (last part)
            }
            return content.trim(); // Return the tag name
        });
    } while (cleaned.length !== previousLength && cleaned.includes('[[')); // Repeat until no more changes
    
    // Remove bold: '''text'''
    cleaned = cleaned.replace(/'''([^']+)'''/g, '$1');
    
    // Remove italic: ''text''
    cleaned = cleaned.replace(/''([^']+)''/g, '$1');
    
    // Remove headers: h4. text or h5. text
    cleaned = cleaned.replace(/h[45]\.\s*/g, '');
    
    // Remove code blocks: <code>text</code> or <nowiki>text</nowiki>
    cleaned = cleaned.replace(/<(code|nowiki|pre)>[\s\S]*?<\/\1>/gi, '');
    
    // Remove spoiler tags: [spoiler]text[/spoiler]
    cleaned = cleaned.replace(/\[spoiler\][\s\S]*?\[\/spoiler\]/gi, '');
    
    // Remove external links: "text":http://url or "text":[http://url]
    cleaned = cleaned.replace(/"([^"]+)":\[?https?:\/\/[^\]]+\]?/gi, '$1');
    
    // Remove list markers at start of lines: * text, - text, # text
    cleaned = cleaned.replace(/^[\*\-\#]\s+/gm, '');
    
    // Remove post references: post #12345
    cleaned = cleaned.replace(/post\s+#\d+/gi, '');
    
    // Remove image references: !post #12345
    cleaned = cleaned.replace(/!post\s+#\d+/gi, '');
    
    // Clean up multiple spaces and normalize whitespace
    cleaned = cleaned.replace(/\s+/g, ' ').trim();
    
    return cleaned;
}

/**
 * Gets memory description if memory exists
 * Note: Does NOT increment usage count (passes false to getKnowledgeMemory)
 * This is for display purposes only - actual memory retrieval should use retrieveKnowledgeMemory tool
 * @param {string} memoryName - The memory name
 * @returns {Object|null} Memory object with description, or null if not found
 */
function getMemoryDescription(memoryName) {
    try {
        const globalResources = require('./globalResources');
        const knowledgeMemoryDb = globalResources.getKnowledgeMemoryDb();
        
        if (!knowledgeMemoryDb || !memoryName) {
            return null;
        }
        
        // Pass false to prevent incrementing usage_count - this is just for display
        const memory = knowledgeMemoryDb.getKnowledgeMemory(memoryName, false);
        if (memory) {
            return {
                name: memoryName,
                description: memory.description || '',
                category: memory.category || ''
            };
        }
        return null;
    } catch (error) {
        return null;
    }
}

/**
 * Processes body content with preview and memory creation
 * @param {string} tagTitle - The tag title
 * @param {string} bodyText - The full body text
 * @param {string} searchTerm - The original search term
 * @param {number} previewLength - Maximum preview length (default: 250)
 * @returns {Object} Object with body preview, memory reference, and metadata
 */
function processTagBody(tagTitle, bodyText, searchTerm, previewLength = 250) {
    if (!bodyText || bodyText.trim().length === 0) {
        return null;
    }
    
    const normalizedTitle = tagTitle.toLowerCase();
    const normalizedBody = bodyText.toLowerCase();
    
    // Check if memory already exists for this tag
    let bodyMemory = null;
    try {
        const globalResources = require('./globalResources');
        const knowledgeMemoryDb = globalResources.getKnowledgeMemoryDb();
        if (knowledgeMemoryDb) {
            const memoryName = `tag_body_${tagTitle.toLowerCase().replace(/[^a-z0-9]/g, '_').substring(0, 50)}`;
            const existing = knowledgeMemoryDb.getKnowledgeMemory(memoryName, false);
            if (existing && existing.category === 'tag_wiki') {
                bodyMemory = memoryName;
            }
        }
    } catch (error) {
        // Silently fail - memory check is optional
    }
    
    const result = {
        bodyMemory: bodyMemory || undefined
    };
    
    // Strip wiki formatting for preview
    const cleanedBody = stripWikiFormatting(bodyText);
    const cleanedBodyText = cleanedBody.replace(/_/g, ' ');
    
    if (normalizedBody === normalizedTitle) {
        result.body = `[Same as title. \`getBodyChunk("${tagTitle}", 0)\`]`;
        result.bodySameAsTitle = true;
    } else if (cleanedBodyText.length > previewLength) {
        // Limit to 250 chars and strip formatting
        result.body = cleanedBodyText.substring(0, previewLength);
        result.bodyTruncated = true;
        result.bodyTotalLength = cleanedBodyText.length;
        result.bodyPreview = true;
    } else {
        result.body = cleanedBodyText;
        result.bodyTruncated = false;
    }
    
    return result;
}

/**
 * Handles searchTagsBatch tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @param {Object} toolContext - WebSocket context for progress updates
 * @returns {Object} Results with markdown and json properties for token optimization
 */
async function handleSearchTagsBatch(params, buildOptions = {}, toolContext = {}) {
    try {
        ensureTagDataLoaded();

        // Ensure furry tag search is loaded before processing tags
        // This will await if already loading, or start loading if not
        await ensureFurryTagSearchLoaded();

        const { tags } = params;

        if (!tags || !Array.isArray(tags)) {
            return { error: "Expected 'tags' array parameter" };
        }

        if (!tagData) {
            return { error: "Tag database not available" };
        }

        console.log(`  [handleSearchTagsBatch] Processing ${tags.length} tags...`);
        const results = {};

        const category = undefined; // Always search all categories
        const exactMatchOnly = false;
        const allowFuzzy = true;
        const minUseCount = undefined;

        for (let i = 0; i < tags.length; i++) {
            const tagSpec = tags[i];
            let tagName = tagSpec.name;

            // Sanitize: strip underscores from search terms to ensure we search with spaces as user intended
            // This handles the case where AI incorrectly passes underscores
            tagName = tagName.replace(/_/g, ' ');

            const returnFields = tagSpec.returnFields || ['title', 'usage']; // Default fields if not specified
            const resolveLinks = tagSpec.resolveLinks || false;
            const limit = tagSpec.limit || 10;
            const reason = tagSpec.reason;

            console.log(`  [${i+1}/${tags.length}] Searching for: "${tagName}"`);
            if (reason) {
                console.log(`  [REASON] ${reason}`);
            }
            
            // Send progress update for this specific tag (accumulate in same div)
            if (toolContext.ws && toolContext.handler) {
                const progressReason = reason ? `${tagName}: ${reason}` : `Searching for "${tagName}"`;
                
                // Accumulate all tag reasoning in the same div using the parent tool's ID
                toolContext.handler.sendToClient(toolContext.ws, {
                    type: 'dynamic_generation_progress_update',
                    phase: 'tool_execution',
                    data: {
                        currentKey: toolContext.toolIndex,
                        totalKeys: toolContext.totalTools,
                        toolName: 'searchTagsBatch',
                        toolState: 'executing',
                        toolReasoningId: toolContext.toolReasoningId, // Use parent tool's ID
                        reason: progressReason,
                        appendReason: true // Flag to append instead of replace
                    },
                    timestamp: new Date().toISOString()
                });
            }

            const searchOptions = {
                category,
                exactMatchOnly,
                allowFuzzy,
                minUseCount,
                limit
            };

            // Search both danbooru and furry datasets
            let matches = searchTags(tagName, searchOptions);

            // Also search furry dataset if available
            let furryMatches = [];
            if (furryTagSearch) {
                try {
                    furryMatches = furryTagSearch.searchTags(tagName, limit);
                    // Convert furry tags to danbooru-compatible format
                    furryMatches = furryMatches.map(furryTag => convertFurryTagToDanbooruFormat(furryTag));
                } catch (error) {
                    console.warn(`  [Furry search failed for "${tagName}"] ${error.message}`);
                }
            }

            // Merge results from both datasets, removing duplicates by title
            const allMatches = [...matches];
            const existingTitles = new Set(matches.map(tag => tag.title.toLowerCase()));

            for (const furryTag of furryMatches) {
                const furryTitle = furryTag.title.toLowerCase();
                if (!existingTitles.has(furryTitle)) {
                    allMatches.push(furryTag);
                    existingTitles.add(furryTitle);
                }
            }

            matches = allMatches;

            const processedMatches = matches.map(tag => {
                let result = {};

                // Determine which fields to return
                if (returnFields && returnFields.length > 0) {
                    for (const field of returnFields) {
                        switch(field) {
                            case 'title':
                                result.title = tag.title.replace(/_/g, ' '); // Convert underscores to spaces
                                break;
                            case 'body':
                                // Use processTagBody for consistent memory checking and preview generation
                                const bodyData1 = processTagBody(tag.title.replace(/_/g, ' '), tag.body || '', tagName, 250);
                                if (bodyData1) {
                                    result.body = bodyData1.body;
                                    result.bodyTruncated = bodyData1.bodyTruncated;
                                    result.bodySameAsTitle = bodyData1.bodySameAsTitle;
                                    result.bodyTotalLength = bodyData1.bodyTotalLength;
                                    result.bodyPreview = bodyData1.bodyPreview;
                                    result.bodyMemory = bodyData1.bodyMemory;
                                }
                                break;
                            case 'category':
                                result.category = tag.category;
                                result.categoryName = getCategoryName(tag.category);
                                break;
                            case 'usage':
                                result.usage = tag.n;
                                break;
                            case 'linksTo':
                                if (tag.source === 'furry') {
                                    // Furry tags don't have link relationships
                                    result.linksTo = [];
                                } else if (resolveLinks && tag.is_linking_to) {
                                    const links = tag.is_linking_to.map(linkName => {
                                        const linkedTag = findTagExact(linkName);
                                        return linkedTag ? { title: linkedTag.title.replace(/_/g, ' '), usage: linkedTag.n } : { title: linkName.replace(/_/g, ' ') };
                                    });
                                    // Sort by usage and limit to top 10
                                    result.linksTo = links.sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, 10);
                                } else {
                                    result.linksTo = (tag.is_linking_to || []).map(name => name.replace(/_/g, ' '));
                                }
                                break;
                            case 'linkedBy':
                                if (tag.source === 'furry') {
                                    // Furry tags don't have link relationships
                                    result.linkedBy = [];
                                } else if (resolveLinks && tag.is_linked_by) {
                                    const links = tag.is_linked_by.map(linkName => {
                                        const linkedTag = findTagExact(linkName);
                                        return linkedTag ? { title: linkedTag.title.replace(/_/g, ' '), usage: linkedTag.n } : { title: linkName.replace(/_/g, ' ') };
                                    });
                                    // Sort by usage and limit to top 10
                                    result.linkedBy = links.sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, 10);
                                } else {
                                    result.linkedBy = (tag.is_linked_by || []).map(name => name.replace(/_/g, ' '));
                                }
                                break;
                            case 'otherNames':
                                if (tag.source === 'furry') {
                                    // Furry tags don't have other names
                                    result.otherNames = [];
                                } else {
                                    result.otherNames = (tag.other_names || []).map(name => name.replace(/_/g, ' '));
                                }
                                break;
                            case 'id':
                                if (tag.source === 'furry') {
                                    // Furry tags don't have IDs in the same format
                                    result.id = null;
                                } else {
                                    result.id = tag.id;
                                }
                                break;
                        }
                    }
                } else {
                    // Return all fields if not specified - convert underscores to spaces
                    if (tag.source === 'furry') {
                        // Special handling for furry tags
                        result = {
                            ...tag,
                            title: tag.title.replace(/_/g, ' '),
                            // Furry tags don't have link relationships
                            linksTo: [],
                            linkedBy: [],
                            otherNames: []
                        };
                    } else {
                        // Standard danbooru tag handling
                        result = {
                            ...tag,
                            title: tag.title.replace(/_/g, ' '),
                            is_linking_to: tag.is_linking_to ? tag.is_linking_to.map(name => name.replace(/_/g, ' ')) : undefined,
                            is_linked_by: tag.is_linked_by ? tag.is_linked_by.map(name => name.replace(/_/g, ' ')) : undefined,
                            other_names: tag.other_names ? tag.other_names.map(name => name.replace(/_/g, ' ')) : undefined
                        };

                        // Rename to user-friendly names if needed
                        if (result.is_linking_to) result.linksTo = result.is_linking_to;
                        if (result.is_linked_by) result.linkedBy = result.is_linked_by;
                        if (result.other_names) result.otherNames = result.other_names;

                        if (resolveLinks) {
                            // Resolve links with depth if requested
                            if (tag.is_linking_to) {
                                const links = tag.is_linking_to.map(linkName => {
                                    const linkedTag = findTagExact(linkName);
                                    return linkedTag ? {
                                        title: linkedTag.title.replace(/_/g, ' '),
                                        usage: linkedTag.n,
                                        category: linkedTag.category
                                    } : { title: linkName.replace(/_/g, ' ') };
                                });
                                // Sort by usage and limit to top 10
                                result.linksTo = links.sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, 10);
                            }
                            if (tag.is_linked_by) {
                                const links = tag.is_linked_by.map(linkName => {
                                    const linkedTag = findTagExact(linkName);
                                    return linkedTag ? {
                                        title: linkedTag.title.replace(/_/g, ' '),
                                        usage: linkedTag.n,
                                        category: linkedTag.category
                                    } : { title: linkName.replace(/_/g, ' ') };
                                });
                                // Sort by usage and limit to top 10
                                result.linkedBy = links.sort((a, b) => (b.usage || 0) - (a.usage || 0)).slice(0, 10);
                            }
                        }
                    }
                    
                    // Always return body preview in "all fields" mode (if body exists)
                    if (result.body) {
                        const bodyData4 = processTagBody(result.title, tag.body || result.body, tagName, 250);
                        if (bodyData4) {
                            result.body = bodyData4.body;
                            result.bodyTruncated = bodyData4.bodyTruncated;
                            result.bodySameAsTitle = bodyData4.bodySameAsTitle;
                            result.bodyTotalLength = bodyData4.bodyTotalLength;
                            result.bodyPreview = bodyData4.bodyPreview;
                            result.bodyMemory = bodyData4.bodyMemory;
                        } else {
                            delete result.body; // Remove empty body
                        }
                    }
                }

                return result;
            });

            results[tagName] = processedMatches;
            console.log(`  [${i+1}/${tags.length}] Found ${processedMatches.length} matches for "${tagName}"`);
        }

        console.log(`  [handleSearchTagsBatch] Completed all ${tags.length} searches`);
        
        // Send completion update
        if (toolContext.ws && toolContext.handler) {
            // Calculate total number of results found across all tags
            const totalResults = Object.values(results).reduce((sum, matches) => sum + (matches?.length || 0), 0);
            // Count number of tags that actually had results
            const tagsWithResults = Object.values(results).filter(matches => matches && matches.length > 0).length;
            const completionReason = `✓ Found ${totalResults} result${totalResults !== 1 ? 's' : ''} for ${tagsWithResults} tag${tagsWithResults !== 1 ? 's' : ''}`;
            toolContext.handler.sendToClient(toolContext.ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'tool_execution',
                data: {
                    currentKey: toolContext.toolIndex,
                    totalKeys: toolContext.totalTools,
                    toolName: 'searchTagsBatch',
                    toolState: 'completed',
                    toolReasoningId: toolContext.toolReasoningId,
                    reason: completionReason
                },
                timestamp: new Date().toISOString()
            });
        }
        
        // Format as markdown for token optimization
        const markdown = formatSearchTagsBatchAsMarkdown(results);
        
        // Return both formats: markdown for AI consumption (token efficient), json for backward compatibility
        return {
            markdown: markdown,
            json: results // Keep JSON for logging/debugging
        };
    } catch (error) {
        console.error(`❌ [handleSearchTagsBatch] Error:`, error);
        
        // Send error update
        if (toolContext.ws && toolContext.handler) {
            toolContext.handler.sendToClient(toolContext.ws, {
                type: 'dynamic_generation_progress_update',
                phase: 'tool_execution',
                data: {
                    currentKey: toolContext.toolIndex,
                    totalKeys: toolContext.totalTools,
                    toolName: 'searchTagsBatch',
                    toolState: 'completed',
                    toolReasoningId: toolContext.toolReasoningId,
                    reason: `✗ Search failed`
                },
                timestamp: new Date().toISOString()
            });
        }
        
        return { error: `Failed to search tags: ${error.message}` };
    }
}

/**
 * Handles getTagDetails tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Array<Object>} Array of complete tag objects
 */
function handleGetTagDetails(params, buildOptions = {}) {
    ensureTagDataLoaded();
    const { tags } = params;

    if (!tags || !Array.isArray(tags)) {
        return { error: "Expected 'tags' array parameter" };
    }

    const results = [];

    for (const tagSpec of tags) {
        let tagName = tagSpec.name;

        // Sanitize: strip underscores from search terms
        tagName = tagName.replace(/_/g, ' ');

        const returnFields = tagSpec.returnFields;
        const reason = tagSpec.reason;

        if (reason) {
            console.log(`  [REASON for "${tagName}"] ${reason}`);
        }

        const tag = findTagExact(tagName);
        if (tag) {
            // If returnFields specified, return only those fields
            if (returnFields && returnFields.length > 0) {
                const result = {};
                result.searchTerm = tagName; // Include the searched name
                for (const field of returnFields) {
                    switch(field) {
                        case 'title':
                            result.title = tag.title.replace(/_/g, ' ');
                            break;
                            case 'body':
                                // Use processTagBody for consistent memory checking and preview generation
                                const bodyData2 = processTagBody(tag.title.replace(/_/g, ' '), tag.body || '', tagName, 250);
                                if (bodyData2) {
                                    result.body = bodyData2.body;
                                    result.bodyTruncated = bodyData2.bodyTruncated;
                                    result.bodySameAsTitle = bodyData2.bodySameAsTitle;
                                    result.bodyTotalLength = bodyData2.bodyTotalLength;
                                    result.bodyPreview = bodyData2.bodyPreview;
                                    result.bodyMemory = bodyData2.bodyMemory;
                                }
                                break;
                        case 'category':
                            result.category = tag.category;
                            result.categoryName = getCategoryName(tag.category);
                            break;
                        case 'usage':
                            result.usage = tag.n;
                            break;
                        case 'linksTo':
                            result.linksTo = (tag.is_linking_to || []).map(name => name.replace(/_/g, ' '));
                            break;
                        case 'linkedBy':
                            result.linkedBy = (tag.is_linked_by || []).map(name => name.replace(/_/g, ' '));
                            break;
                        case 'otherNames':
                            result.otherNames = (tag.other_names || []).map(name => name.replace(/_/g, ' '));
                            break;
                        case 'id':
                            result.id = tag.id;
                            break;
                    }
                }
                results.push(result);
            } else {
                // Default: return all fields with underscores converted to spaces
                const allFieldsResult = {
                    searchTerm: tagName,
                    ...tag,
                    title: tag.title.replace(/_/g, ' '),
                    linksTo: (tag.is_linking_to || []).map(name => name.replace(/_/g, ' ')),
                    linkedBy: (tag.is_linked_by || []).map(name => name.replace(/_/g, ' ')),
                    otherNames: (tag.other_names || []).map(name => name.replace(/_/g, ' '))
                };
                
                // Apply body preview optimization even in "all fields" mode
                if (allFieldsResult.body) {
                    const bodyData3 = processTagBody(allFieldsResult.title, tag.body || allFieldsResult.body, tagName, 250);
                    if (bodyData3) {
                        allFieldsResult.body = bodyData3.body;
                        allFieldsResult.bodyTruncated = bodyData3.bodyTruncated;
                        allFieldsResult.bodySameAsTitle = bodyData3.bodySameAsTitle;
                        allFieldsResult.bodyTotalLength = bodyData3.bodyTotalLength;
                        allFieldsResult.bodyPreview = bodyData3.bodyPreview;
                        allFieldsResult.bodyMemory = bodyData3.bodyMemory;
                    } else {
                        delete allFieldsResult.body; // Remove empty body
                    }
                }
                
                results.push(allFieldsResult);
            }
        } else {
            // Tag not found
            results.push({
                searchTerm: tagName,
                error: "Tag not found"
            });
        }
    }

    // Format as markdown for token optimization
    const markdown = formatTagDetailsAsMarkdown(results);
    
    // Return both formats: markdown for AI consumption (token efficient), json for backward compatibility
    return {
        markdown: markdown,
        json: results // Keep JSON for logging/debugging
    };
}

/**
 * Handles resolveTagLinks tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Object} Object with resolved links
 */
function handleResolveTagLinks(params, buildOptions = {}) {
    ensureTagDataLoaded();
    const { tagName, depth = 1, direction = 'both', reason } = params;

    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }

    const links = getLinkedTags(tagName, depth, direction);
    
    // Convert underscores to spaces in all returned titles
    const result = {
        linksTo: links.linksTo.map(tag => ({
            ...tag,
            title: tag.title.replace(/_/g, ' ')
        })),
        linkedBy: links.linkedBy.map(tag => ({
            ...tag,
            title: tag.title.replace(/_/g, ' ')
        }))
    };
    
    // Format as markdown for token optimization
    const lines = [];
    lines.push(`## Tag Links for "${tagName.replace(/_/g, ' ')}"`);
    
    if (result.linksTo.length > 0) {
        lines.push(`\n**Links To (${result.linksTo.length}):**`);
        lines.push(`| Tag | Usage | Category |`);
        lines.push(`|-----|-------|----------|`);
        result.linksTo.slice(0, 15).forEach(link => {
            const title = link.title || '-';
            const usage = link.usage !== undefined ? link.usage.toLocaleString() : '-';
            const category = link.categoryName || (link.category !== undefined ? `cat:${link.category}` : '-');
            lines.push(`| ${title} | ${usage} | ${category} |`);
        });
        if (result.linksTo.length > 15) {
            lines.push(`| *... ${result.linksTo.length - 15} more* | | |`);
        }
    }
    
    if (result.linkedBy.length > 0) {
        lines.push(`\n**Linked By (${result.linkedBy.length}):**`);
        lines.push(`| Tag | Usage | Category |`);
        lines.push(`|-----|-------|----------|`);
        result.linkedBy.slice(0, 15).forEach(link => {
            const title = link.title || '-';
            const usage = link.usage !== undefined ? link.usage.toLocaleString() : '-';
            const category = link.categoryName || (link.category !== undefined ? `cat:${link.category}` : '-');
            lines.push(`| ${title} | ${usage} | ${category} |`);
        });
        if (result.linkedBy.length > 15) {
            lines.push(`| *... ${result.linkedBy.length - 15} more* | | |`);
        }
    }
    
    if (result.linksTo.length === 0 && result.linkedBy.length === 0) {
        lines.push(`\n*No links found*`);
    }
    
    const markdown = lines.join('\n');
    
    return {
        markdown: markdown,
        json: result
    };
}

/**
 * Handles suggestBetterTags tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Array<Object>} Array of suggested tag replacements
 */
function handleSuggestBetterTags(params, buildOptions = {}) {
    ensureTagDataLoaded();
    const { tagName, context, category, reason } = params;

    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }

    // First, try to find the tag
    const tag = findTagExact(tagName);
    if (!tag) {
        // If tag not found, search for similar tags
        const similarTags = searchTags(tagName, {
            category,
            allowFuzzy: true,
            limit: 10
        }).map(t => {
            const result = {
                title: t.title.replace(/_/g, ' '),
                usage: t.n,
                category: getCategoryName(t.category)
            };
            const bodyData = processTagBody(t.title.replace(/_/g, ' '), t.body || '', tagName, 200);
            if (bodyData) {
                Object.assign(result, bodyData);
            }
            return result;
        });
        
        // Format as markdown
        const markdown = formatTagSuggestionsAsMarkdown(similarTags, tagName);
        return {
            markdown: markdown,
            json: similarTags
        };
    }

    // Find related tags through links
    const suggestions = [];

    // Get linked tags
    const links = getLinkedTags(tagName, 1, 'both');

    // Add linked tags as suggestions
    if (links.linksTo) {
        for (const linkedTag of links.linksTo) {
            if (linkedTag.title !== tagName) {
                const suggestion = {
                    title: linkedTag.title.replace(/_/g, ' '),
                    usage: linkedTag.n,
                    category: getCategoryName(linkedTag.category),
                    reason: 'Linked to by searched tag'
                };
                const bodyData = processTagBody(suggestion.title, linkedTag.body || '', tagName, 200);
                if (bodyData) {
                    Object.assign(suggestion, bodyData);
                }
                suggestions.push(suggestion);
            }
        }
    }

    if (links.linkedBy) {
        for (const linkedTag of links.linkedBy) {
            if (linkedTag.title !== tagName && !suggestions.find(s => s.title === linkedTag.title)) {
                const suggestion = {
                    title: linkedTag.title.replace(/_/g, ' '),
                    usage: linkedTag.n,
                    category: getCategoryName(linkedTag.category),
                    reason: 'Links to searched tag'
                };
                const bodyData = processTagBody(suggestion.title, linkedTag.body || '', tagName, 200);
                if (bodyData) {
                    Object.assign(suggestion, bodyData);
                }
                suggestions.push(suggestion);
            }
        }
    }

    // Search for similar tags in same category
    if (category !== undefined || tag.category) {
        const similarTags = searchTags(tag.title.split('_')[0], {
            category: category !== undefined ? category : tag.category,
            allowFuzzy: true,
            limit: 5
        });

        for (const similarTag of similarTags) {
            if (similarTag.title !== tagName && !suggestions.find(s => s.title === similarTag.title)) {
                const suggestion = {
                    title: similarTag.title.replace(/_/g, ' '),
                    usage: similarTag.n,
                    category: getCategoryName(similarTag.category),
                    reason: 'Similar tag in same category'
                };
                const bodyData = processTagBody(suggestion.title, similarTag.body || '', tagName, 200);
                if (bodyData) {
                    Object.assign(suggestion, bodyData);
                }
                suggestions.push(suggestion);
            }
        }
    }

    // Sort by usage count
    suggestions.sort((a, b) => b.usage - a.usage);

    const finalSuggestions = suggestions.slice(0, 10);
    
    // Format as markdown
    const markdown = formatTagSuggestionsAsMarkdown(finalSuggestions, tagName);
    
    return {
        markdown: markdown,
        json: finalSuggestions
    };
}

/**
 * Handles searchByDescription tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Array<Object>} Array of matching tags
 */
function handleSearchByDescription(params, buildOptions = {}) {
    ensureTagDataLoaded();
    const { description, category, minUseCount, limit = 10, reason } = params;

    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }

    // Split description into individual words and filter out stop words
    const stopWords = new Set(['the', 'a', 'an', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'from', 'by', 'as', 'is', 'are', 'was', 'were']);
    const words = description
        .toLowerCase()
        .replace(/[,:;]/g, ' ') // Remove punctuation
        .split(/[\s\-]+/)
        .filter(w => w.length > 2 && !stopWords.has(w));

    console.log(`  [searchByDescription] Searching for: "${description}"`);
    console.log(`    Keywords: ${words.join(', ')}`);

    const matches = [];
    const indexes = tagData._indexes;

    // Get tags to search
    let tagsToSearch;
    if (category !== undefined && indexes && indexes.byCategory) {
        tagsToSearch = indexes.byCategory.get(category) || [];
    } else {
        tagsToSearch = Object.values(tagData);
    }

    // Score each tag based on how many description words appear in title or body
    for (const tag of tagsToSearch) {
        if (minUseCount && tag.n < minUseCount) continue;

        const title = (tag.title || '').toLowerCase();
        const body = (tag.body || '').toLowerCase();

        let score = 0;
        let matchedWords = [];

        // Check how many words match in title (weighted higher)
        for (const word of words) {
            if (title.includes(word)) {
                score += 20;
                matchedWords.push(word);
            }
        }

        // Check how many words match in body (weighted lower)
        for (const word of words) {
            if (!matchedWords.includes(word) && body.includes(word)) {
                score += 5;
                matchedWords.push(word);
            }
        }

        // Bonus for matching all words
        if (matchedWords.length === words.length && words.length > 0) {
            score += 50;
        }

        // Only include if at least one word matched
        if (score > 0) {
            matches.push({
                tag: tag,
                score: score,
                matchCount: matchedWords.length,
                totalWords: words.length
            });
        }
    }

    // Sort by score (descending), then by usage count
    matches.sort((a, b) => {
        if (b.score !== a.score) {
            return b.score - a.score;
        }
        return b.tag.n - a.tag.n;
    });

    const results = matches.slice(0, limit).map(m => {
        const result = {
            title: m.tag.title.replace(/_/g, ' '),
            usage: m.tag.n,
            category: getCategoryName(m.tag.category),
            matchScore: m.score,
            matchedWords: m.matchCount + '/' + m.totalWords
        };
        const bodyData = processTagBody(result.title, m.tag.body || '', description, 300);
        if (bodyData) {
            Object.assign(result, bodyData);
        }
        return result;
    });

    console.log(`  [searchByDescription] Found ${matches.length} total matches, returning top ${results.length}`);

    // Format as markdown
    const markdown = formatSearchByDescriptionAsMarkdown(results, description);
    
    return {
        markdown: markdown,
        json: results
    };
}

/**
 * Formats body chunk as markdown
 * @param {Object} chunkData - Chunk data object
 * @returns {string} Markdown formatted string
 */
function formatBodyChunkAsMarkdown(chunkData) {
    const lines = [];
    
    if (chunkData.error) {
        lines.push(`## Error\n`);
        lines.push(`*${chunkData.error}*`);
        return lines.join('\n');
    }
    
    lines.push(`## ${chunkData.tagName} - Body Chunk ${chunkData.chunkIndex + 1} of ${chunkData.totalChunks}\n`);
    lines.push(`**Progress:** ${chunkData.progress}`);
    if (chunkData.hasMore) {
        lines.push(`=== **Has More:** Yes - use \`getBodyChunk("${chunkData.tagName}", ${chunkData.chunkIndex + 1})\` for next chunk ===`);
    } else {
        lines.push(`**End of body**`);
    }
    lines.push(`\n### Content\n`);
    
    // Format body text with proper line breaks
    const bodyLines = chunkData.chunkText.split('\n');
    bodyLines.forEach(line => {
        lines.push(`> ${line}`);
    });
    
    return lines.join('\n');
}

/**
 * Handles getBodyChunk tool call
 * @param {Object} params - Tool parameters
 * @param {Object} buildOptions - Current build options (read-only)
 * @returns {Object} Body chunk data with markdown and json properties
 */
function handleGetBodyChunk(params, buildOptions = {}) {
    ensureTagDataLoaded();
    const { tagName, chunkIndex = 0, reason } = params;

    if (reason) {
        console.log(`  [REASON] ${reason}`);
    }

    const tag = findTagExact(tagName);
    if (!tag) {
        const errorResult = { error: `Tag "${tagName}" has no body, search the web for more information` };
        return {
            ...errorResult,
            markdown: formatBodyChunkAsMarkdown(errorResult),
            json: errorResult
        };
    }

    const bodyText = tag.body || '';
    const chunkSize = 1000;
    const startIndex = chunkIndex * chunkSize;
    const endIndex = Math.min(startIndex + chunkSize, bodyText.length);

    if (startIndex >= bodyText.length) {
        const errorResult = { error: `Chunk ${chunkIndex} is beyond the body length` };
        return {
            ...errorResult,
            markdown: formatBodyChunkAsMarkdown(errorResult),
            json: errorResult
        };
    }

    const chunk = bodyText.substring(startIndex, endIndex);
    const totalChunks = Math.ceil(bodyText.length / chunkSize);

    const result = {
        tagName: tag.title.replace(/_/g, ' '),
        chunkIndex: chunkIndex,
        totalChunks: totalChunks,
        chunkText: chunk.replace(/_/g, ' '),
        hasMore: endIndex < bodyText.length,
        progress: `Chunk ${chunkIndex + 1} of ${totalChunks}`
    };
    
    // Return both formats: markdown for AI consumption (token efficient), json for backward compatibility
    return {
        markdown: formatBodyChunkAsMarkdown(result),
        json: result
    };
}

/**
 * Get information about tag groups from the database
 * Returns tag groups that can be used in system prompts
 * Cached after first call
 */
let cachedTagGroupsInfo = null;

function getTagGroupsInfo() {
    // Return cached result if available
    if (cachedTagGroupsInfo !== null) {
        return cachedTagGroupsInfo;
    }

    ensureTagDataLoaded();
    if (!tagData || !tagData._tagGroups) {
        cachedTagGroupsInfo = {
            tagGroups: [],
            summary: 'No tag groups available'
        };
        return cachedTagGroupsInfo;
    }

    // Get tag groups with enhanced descriptions from tag wiki
    const tagGroups = tagData._tagGroups.map(groupName => {
        const readableName = groupName.replace(/_/g, ' ').replace(/%23/g, '#');
        
        // Try to find the tag_group entry in the tag database
        const tagGroupKey = `tag_group:${groupName}`;
        const tagGroupEntry = tagData[tagGroupKey];
        
        let description = `Category of related tags for ${readableName}`;
        
        // If we found the tag group entry, extract a better description
        if (tagGroupEntry && tagGroupEntry.body) {
            // Extract the first few tag sections from the body as a preview
            const body = tagGroupEntry.body;
            
            // Try to extract section headers (h4 or h5) which show main categories
            const sectionMatches = body.match(/h[45]\.\s*([^\r\n]+)/g);
            if (sectionMatches && sectionMatches.length > 0) {
                // Get first 3-5 section names as examples
                const sections = sectionMatches
                    .map(m => m.replace(/h[45]\.\s*/, '').trim())
                    .filter(s => !s.startsWith('#dtext-')) // Filter out anchor-only sections
                    .slice(0, 5);
                
                if (sections.length > 0) {
                    description = `Includes: ${sections.join(', ')}${sectionMatches.length > 5 ? ', and more' : ''}`;
                }
            }
        }
        
        return {
            name: readableName,
            description: description
        };
    });

    cachedTagGroupsInfo = {
        tagGroups,
        summary: `Found ${tagGroups.length} tag categories: ${tagGroups.map(g => g.name).join(', ')}`
    };

    return cachedTagGroupsInfo;
}

module.exports = {
    findTagExact,
    searchTags,
    getLinkedTags,
    getCategoryName,
    levenshteinDistance,
    getTitleMatchScore,
    getTagGroupsInfo,
    // Tool handlers
    handleSearchTagsBatch,
    handleGetTagDetails,
    handleResolveTagLinks,
    handleSuggestBetterTags,
    handleSearchByDescription,
    handleGetBodyChunk
};

