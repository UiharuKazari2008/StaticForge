/**
 * Fast Tag Search Module
 * Optimized left-to-right greedy search for NovelAI tags
 */

const fs = require('fs');
const path = require('path');

class FastTagSearch {
    constructor(animeTagSearch, furryTagSearch) {
        this.animeTagSearch = animeTagSearch;
        this.furryTagSearch = furryTagSearch;
        this.cache = new Map(); // Cache exact matches
        this.tagGroups = null; // Curated tag groups
        this.loadTagGroups();
    }

    /**
     * Load curated tag groups and build index (more organized than raw tags)
     */
    loadTagGroups() {
        try {
            const tagGroupsPath = path.join(__dirname, '..', 'dataset_tag_groups.json');
            if (fs.existsSync(tagGroupsPath)) {
                this.tagGroups = JSON.parse(fs.readFileSync(tagGroupsPath, 'utf8'));
                this.buildTagToPathIndex();
                console.log('✅ Loaded curated tag groups with index');
            }
        } catch (error) {
            console.error('Failed to load tag groups:', error);
        }
    }

    /**
     * Build tag-to-path index for fast lookups
     * Maps tag names to their category paths
     */
    buildTagToPathIndex() {
        this.tagToPathIndex = {};
        
        const buildIndexRecursive = (currentLevel, currentPath) => {
            if (typeof currentLevel === 'object' && !Array.isArray(currentLevel)) {
                // Check if this level has a "main" key with tags
                if (currentLevel.main && Array.isArray(currentLevel.main)) {
                    for (const tag of currentLevel.main) {
                        const tagLower = tag.toLowerCase();
                        if (!this.tagToPathIndex[tagLower]) {
                            this.tagToPathIndex[tagLower] = [];
                        }
                        this.tagToPathIndex[tagLower].push({
                            path: [...currentPath, 'main'],
                            tag: tag
                        });
                    }
                }
                
                // Recursively process all other keys
                for (const [key, value] of Object.entries(currentLevel)) {
                    if (key !== '_metadata' && key !== 'main') {
                        if (Array.isArray(value)) {
                            // This is an array of tags
                            for (const tag of value) {
                                const tagLower = tag.toLowerCase();
                                if (!this.tagToPathIndex[tagLower]) {
                                    this.tagToPathIndex[tagLower] = [];
                                }
                                this.tagToPathIndex[tagLower].push({
                                    path: [...currentPath, key],
                                    tag: tag
                                });
                            }
                        } else {
                            // This is a nested object, recurse into it
                            buildIndexRecursive(value, [...currentPath, key]);
                        }
                    }
                }
            }
        };

        buildIndexRecursive(this.tagGroups, []);
    }

    /**
     * Search curated tag groups using index (PRIORITY 1)
     * Fast O(1) lookup using pre-built index
     * @param {string} query - Text to search
     * @returns {Object|null} Group info if found
     */
    searchTagGroups(query) {
        if (!this.tagToPathIndex) return null;

        const normalized = query.toLowerCase().trim();
        const found = {
            exactMatches: [],
            containingGroups: []
        };

        // EXACT MATCH: O(1) lookup in index
        if (this.tagToPathIndex[normalized]) {
            const matches = this.tagToPathIndex[normalized];
            for (const match of matches) {
                found.exactMatches.push({
                    tag: match.tag,
                    groupPath: match.path.join('/'),
                    category: match.path[0],
                    subcategory: match.path[1],
                    source: 'curated_group'
                });
            }
        }

        // CONTAINS SEARCH: Check all tags in index
        // Only do this if we need to find alternatives for weak tags
        for (const tagLower in this.tagToPathIndex) {
            if (tagLower !== normalized && tagLower.includes(normalized)) {
                const matches = this.tagToPathIndex[tagLower];
                for (const match of matches) {
                    found.containingGroups.push({
                        tag: match.tag,
                        groupPath: match.path.join('/'),
                        category: match.path[0]
                    });
                }
            }
        }

        if (found.exactMatches.length > 0 || found.containingGroups.length > 0) {
            return found;
        }

        return null;
    }

    /**
     * Fast exact-match-only lookup (no fuzzy search)
     * Checks curated groups FIRST, then raw tag database
     * @param {string} query - Text to search
     * @param {string} dataset - 'anime' or 'furry'
     * @returns {Object|null} Tag data or null
     */
    exactMatch(query, dataset = 'anime') {
        const cacheKey = `${dataset}:${query.toLowerCase()}`;
        
        if (this.cache.has(cacheKey)) {
            return this.cache.get(cacheKey);
        }

        const tagSearch = dataset === 'furry' ? this.furryTagSearch : this.animeTagSearch;
        const normalized = query.trim().toLowerCase();
        
        // PRIORITY 1: Check curated tag groups (more organized)
        const groupMatch = this.searchTagGroups(normalized);
        if (groupMatch && groupMatch.exactMatches.length > 0) {
            const curatedTag = groupMatch.exactMatches[0];
            // Still need to get n_count from main database
            const tagInfo = tagSearch.tagData[curatedTag.tag];
            
            if (tagInfo) {
                const result = {
                    tag: curatedTag.tag,
                    tag_name: tagInfo.tag_name || curatedTag.tag,
                    n_count: tagInfo.n_count || 0,
                    d_count: tagInfo.d_count || 0,
                    d_group: tagInfo.d_group || [],
                    curated: true,
                    curatedPath: curatedTag.groupPath,
                    curatedCategory: curatedTag.category,
                    confidence: 100
                };
                
                this.cache.set(cacheKey, result);
                return result;
            }
        }
        
        // PRIORITY 2: Check raw tag database
        if (tagSearch.searchIndex && tagSearch.searchIndex[normalized]) {
            const tagNames = tagSearch.searchIndex[normalized];
            if (tagNames && tagNames.length > 0) {
                const tagName = tagNames[0]; // Take first match
                const tagInfo = tagSearch.tagData[tagName];
                
                if (tagInfo) {
                    const result = {
                        tag: tagName,
                        tag_name: tagInfo.tag_name,
                        n_count: tagInfo.n_count || 0,
                        d_count: tagInfo.d_count || 0,
                        d_group: tagInfo.d_group || [],
                        curated: false,
                        confidence: 100
                    };
                    
                    this.cache.set(cacheKey, result);
                    return result;
                }
            }
        }
        
        this.cache.set(cacheKey, null);
        return null;
    }

    /**
     * Greedy left-to-right tag search with semantic aggregation
     * Continues building right even after finding matches
     * This finds both "cowboy" AND "cowboy shot" to understand composition
     * 
     * @param {string} text - Text to search (can include commas)
     * @param {string} dataset - 'anime' or 'furry'
     * @returns {Array} Array of found tags with positions and semantic data
     */
    greedySearch(text, dataset = 'anime') {
        // Split by comma but preserve spaces within segments
        const words = text.toLowerCase().split(/[\s,]+/).filter(w => w.length > 0);
        const foundTags = [];
        
        // Start at each word position
        for (let startIdx = 0; startIdx < words.length; startIdx++) {
            // ALWAYS try building phrases from this position (up to 6 words)
            // Don't stop when we find a match - keep building right!
            const maxLength = Math.min(startIdx + 6, words.length);
            
            for (let endIdx = startIdx + 1; endIdx <= maxLength; endIdx++) {
                const phrase = words.slice(startIdx, endIdx).join(' ');
                const match = this.exactMatch(phrase, dataset);
                
                if (match) {
                    foundTags.push({
                        ...match,
                        matchedPhrase: phrase,
                        startPos: startIdx,
                        endPos: endIdx - 1,
                        wordCount: endIdx - startIdx
                    });
                    // KEEP GOING - don't break!
                    // This way we find "cowboy" AND "cowboy shot"
                }
            }
        }
        
        return foundTags;
    }

    /**
     * Build semantic understanding from tag groups
     * Aggregates categories to understand what a phrase means
     * 
     * Example: "standing on sidewalk"
     *   - standing (posture/verb)
     *   - sidewalk (outdoor/manmade location)
     *   = "posture action at outdoor location"
     * 
     * @param {Array} tags - Tags from greedySearch
     * @returns {Object} Semantic understanding
     */
    buildSemanticContext(tags) {
        const categories = new Set();
        const meanings = [];
        
        // Aggregate all groups
        tags.forEach(tag => {
            if (tag.d_group && Array.isArray(tag.d_group)) {
                tag.d_group.forEach(group => {
                    categories.add(group);
                    
                    // Extract meaning from group path
                    if (group.includes('/composition/')) {
                        meanings.push('compositional choice');
                    }
                    if (group.includes('/posture/')) {
                        meanings.push('body posture');
                    }
                    if (group.includes('/locations/')) {
                        meanings.push('location/setting');
                    }
                    if (group.includes('/bygender')) {
                        meanings.push('character gender');
                    }
                    if (group.includes('verbs')) {
                        meanings.push('action/verb');
                    }
                    if (group.includes('/bodyparts/')) {
                        meanings.push('anatomical focus');
                    }
                    if (group.includes('/styles')) {
                        meanings.push('art style');
                    }
                });
            }
        });
        
        return {
            categories: Array.from(categories),
            meanings: [...new Set(meanings)], // Deduplicate
            description: meanings.length > 0 
                ? meanings.join(' + ') 
                : 'general tag'
        };
    }

    /**
     * Analyze a phrase segment and build full understanding
     * Returns tags + semantic context
     * 
     * @param {string} segment - Text segment to analyze
     * @param {string} dataset - 'anime' or 'furry'
     * @param {Object} t5TokenizerService - T5 tokenizer for vocabulary check
     * @returns {Object} Analysis results
     */
    analyzeSegment(segment, dataset = 'anime', t5TokenizerService = null) {
        const allTags = this.greedySearch(segment, dataset);
        
        // FILTER: Only keep longest match at each start position
        // If we have "deep" (1 word) and "deep skin" (2 words) at position 0,
        // only keep "deep skin"
        const tagsByPosition = {};
        allTags.forEach(tag => {
            if (!tagsByPosition[tag.startPos]) {
                tagsByPosition[tag.startPos] = [];
            }
            tagsByPosition[tag.startPos].push(tag);
        });
        
        const filteredTags = [];
        Object.keys(tagsByPosition).forEach(pos => {
            const tagsAtPos = tagsByPosition[pos];
            // Keep only the longest (most specific) tag at this position
            const longest = tagsAtPos.reduce((best, tag) => 
                tag.wordCount > best.wordCount ? tag : best
            );
            filteredTags.push(longest);
        });
        
        const semantic = this.buildSemanticContext(filteredTags);
        
        return {
            text: segment,
            tags: filteredTags,  // Only longest matches
            allTags: allTags,     // Keep all for debugging
            semantic: semantic,
            hasExactMatch: filteredTags.length > 0,
            longestMatch: filteredTags.length > 0 
                ? filteredTags.reduce((longest, tag) => 
                    tag.wordCount > longest.wordCount ? tag : longest
                  )
                : null,
            t5Vocabulary: t5TokenizerService ? this.checkT5Vocabulary(segment, t5TokenizerService) : null
        };
    }

    /**
     * Check if words in segment are in T5 vocabulary (lowercase only)
     * @param {string} segment - Text to check
     * @param {Object} t5TokenizerService - T5 tokenizer service
     * @returns {Object} Vocabulary check results
     */
    checkT5Vocabulary(segment, t5TokenizerService) {
        const words = segment.toLowerCase().split(/\s+/);
        const results = {};
        
        for (const word of words) {
            // Only check lowercase
            const tokenData = t5TokenizerService.getTokenData(word);
            if (tokenData && tokenData.length > 0) {
                const maxStrength = Math.max(...tokenData.map(t => t.strength || 0));
                results[word] = {
                    inVocab: true,
                    strength: maxStrength,
                    tokenCount: tokenData.length,
                    breakdown: tokenData.map(t => t.text).join('|')
                };
            } else {
                results[word] = {
                    inVocab: false,
                    strength: 0,
                    tokenCount: 0
                };
            }
        }
        
        return results;
    }

    /**
     * When a word has n_count=0, find tags that CONTAIN this word
     * Example: "detailed" → find "detailed background", "highly detailed", etc.
     * 
     * @param {string} word - The word to search for
     * @param {string} dataset - 'anime' or 'furry'
     * @returns {Array} Tags containing this word, sorted by n_count
     */
    findTagsContaining(word, dataset = 'anime') {
        const tagSearch = dataset === 'furry' ? this.furryTagSearch : this.animeTagSearch;
        const normalized = word.toLowerCase().trim();
        const matches = [];
        
        // Search through all tags
        if (tagSearch.tagData) {
            for (const tagName in tagSearch.tagData) {
                const tagInfo = tagSearch.tagData[tagName];
                const tagLower = tagName.toLowerCase();
                
                // Check if tag contains this word
                if (tagLower.includes(normalized)) {
                    matches.push({
                        tag: tagName,
                        tag_name: tagInfo.tag_name,
                        n_count: tagInfo.n_count || 0,
                        d_count: tagInfo.d_count || 0,
                        d_group: tagInfo.d_group || [],
                        containsWord: normalized,
                        confidence: tagLower === normalized ? 100 : 90 // Exact or contains
                    });
                }
            }
        }
        
        // Sort by n_count DESC (most trained first)
        return matches
            .sort((a, b) => (b.n_count || 0) - (a.n_count || 0))
            .slice(0, 10); // Top 10
    }

    /**
     * Get fuzzy matches when no exact match found
     * Returns top 5 sorted by similarity and n_count
     * @param {string} query - Text to search
     * @param {string} dataset - 'anime' or 'furry'
     * @returns {Array} Top fuzzy matches
     */
    fuzzyMatches(query, dataset = 'anime') {
        const tagSearch = dataset === 'furry' ? this.furryTagSearch : this.animeTagSearch;
        
        // Call the full search (which does fuzzy) but limit results
        const results = tagSearch.searchTags(query, 5);
        
        // Filter out 100% confidence (those are exact, we already checked)
        return results
            .filter(r => r.confidence < 100)
            .sort((a, b) => {
                // Sort by confidence DESC, then n_count DESC
                if (Math.abs(b.confidence - a.confidence) > 1) {
                    return b.confidence - a.confidence;
                }
                return (b.n_count || 0) - (a.n_count || 0);
            })
            .slice(0, 5);
    }

    /**
     * Categorize segment by its semantic groups
     * Groups segments by what part of the image they relate to
     * 
     * @param {Object} semantic - Semantic context from buildSemanticContext
     * @returns {string} Category name
     */
    categorizeSegment(semantic) {
        const categories = semantic.categories || [];
        
        // Priority-based categorization
        if (categories.some(c => c.includes('/composition/framing'))) {
            return 'composition_framing';
        }
        if (categories.some(c => c.includes('/composition/camera'))) {
            return 'composition_camera';
        }
        if (categories.some(c => c.includes('/composition/perspective'))) {
            return 'composition_perspective';
        }
        if (categories.some(c => c.includes('/composition/styles'))) {
            return 'art_style';
        }
        if (categories.some(c => c.includes('/bygender'))) {
            return 'character_gender';
        }
        if (categories.some(c => c.includes('/posture/'))) {
            return 'character_posture';
        }
        if (categories.some(c => c.includes('/bodyparts/'))) {
            return 'anatomical_focus';
        }
        if (categories.some(c => c.includes('/attire/'))) {
            return 'clothing';
        }
        if (categories.some(c => c.includes('/locations/'))) {
            return 'location_setting';
        }
        if (categories.some(c => c.includes('verbs'))) {
            return 'action';
        }
        
        return 'general';
    }


    /**
     * Clear cache
     */
    clearCache() {
        this.cache.clear();
    }
}

module.exports = FastTagSearch;

