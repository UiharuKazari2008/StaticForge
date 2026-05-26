const fs = require('fs');
const path = require('path');
const logger = require('./logger');

class AnimeTagSearch {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('AnimeTagSearch requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        this.tagData = null;
        this.searchIndex = null;
        this.lastModified = 0;
        this.indexFiles = {
            searchIndex: globalResources.getPath('animeSearchIndex'),
            wordIndex: globalResources.getPath('animeWordIndex'),
            prefixIndex: globalResources.getPath('animePrefixIndex'),
            suffixIndex: globalResources.getPath('animeSuffixIndex'),
            wordsIndex: globalResources.getPath('animeWordsIndex')
        };
        this.datasetTagsPath = globalResources.getPath('datasetTags');
        this.loadTagData();
    }

    loadTagData() {
        const filePath = this.datasetTagsPath;
        
        try {
            const stats = fs.statSync(filePath);
            if (stats.mtime.getTime() <= this.lastModified && this.tagData) {
                return; // Already loaded and up to date
            }

            const data = fs.readFileSync(filePath, 'utf8');
            this.tagData = JSON.parse(data);
            this.lastModified = stats.mtime.getTime();
            
            // Validate data structure
            if (!this.tagData || typeof this.tagData !== 'object') {
                throw new Error('Invalid data structure: expected object');
            }
            
            // Check if we have the expected format
            const firstKey = Object.keys(this.tagData)[0];
            if (firstKey && (!this.tagData[firstKey] || typeof this.tagData[firstKey] !== 'object')) {
                throw new Error('Invalid tag data format: expected object with tag objects');
            }
            
            // Try to load existing indexes, rebuild if needed
            this.loadOrBuildSearchIndex();
            
            logger.bootSubStep(`Loaded ${Object.keys(this.tagData).length} anime tags`);
        } catch (error) {
            logger.error('Error loading anime tag dataset:', error.message);
            this.tagData = {};
            this.searchIndex = {};
        }
    }

    loadOrBuildSearchIndex() {
        // Check if we can load existing indexes
        if (this.canLoadIndexes()) {
            this.loadSearchIndexes();
        } else {
            this.buildSearchIndex();
            this.saveSearchIndexes();
        }
    }

    canLoadIndexes() {
        try {
            // Check if all index files exist
            for (const [name, filePath] of Object.entries(this.indexFiles)) {
                if (!fs.existsSync(filePath)) {
                    return false;
                }
            }

            // Check if index files are newer than the data file
            const dataFilePath = this.datasetTagsPath;
            const dataStats = fs.statSync(dataFilePath);
            
            for (const [name, filePath] of Object.entries(this.indexFiles)) {
                const indexStats = fs.statSync(filePath);
                if (indexStats.mtime.getTime() < dataStats.mtime.getTime()) {
                    return false;
                }
            }

            return true;
        } catch (error) {
            return false;
        }
    }

    loadSearchIndexes() {
        try {
            // Ensure cache directory exists
            const cacheDir = path.dirname(this.indexFiles.searchIndex);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            this.searchIndex = JSON.parse(fs.readFileSync(this.indexFiles.searchIndex, 'utf8'));
            this.wordIndex = JSON.parse(fs.readFileSync(this.indexFiles.wordIndex, 'utf8'));
            this.prefixIndex = JSON.parse(fs.readFileSync(this.indexFiles.prefixIndex, 'utf8'));
            this.suffixIndex = JSON.parse(fs.readFileSync(this.indexFiles.suffixIndex, 'utf8'));
            this.wordsIndex = JSON.parse(fs.readFileSync(this.indexFiles.wordsIndex, 'utf8'));

            logger.bootSubStep(`Anime indexes: ${Object.keys(this.searchIndex).length} terms, ${Object.keys(this.wordIndex).length} words, ${Object.keys(this.prefixIndex).length} prefixes, ${Object.keys(this.suffixIndex).length} suffixes`);
        } catch (error) {
            logger.warn('Error loading anime indexes, rebuilding:', error.message);
            this.buildSearchIndex();
            this.saveSearchIndexes();
        }
    }

    saveSearchIndexes() {
        try {
            // Ensure cache directory exists
            const cacheDir = path.dirname(this.indexFiles.searchIndex);
            if (!fs.existsSync(cacheDir)) {
                fs.mkdirSync(cacheDir, { recursive: true });
            }

            // Save each index to its respective file
            fs.writeFileSync(this.indexFiles.searchIndex, JSON.stringify(this.searchIndex, null, 2));
            fs.writeFileSync(this.indexFiles.wordIndex, JSON.stringify(this.wordIndex, null, 2));
            fs.writeFileSync(this.indexFiles.prefixIndex, JSON.stringify(this.prefixIndex, null, 2));
            fs.writeFileSync(this.indexFiles.suffixIndex, JSON.stringify(this.suffixIndex, null, 2));
            fs.writeFileSync(this.indexFiles.wordsIndex, JSON.stringify(this.wordsIndex, null, 2));

            // Silently saved
        } catch (error) {
            logger.error('Error saving anime indexes:', error.message);
        }
    }

    buildSearchIndex() {
        this.searchIndex = {};
        this.wordIndex = {}; // Index for word-based searching
        this.prefixIndex = {}; // Index for prefix matching
        this.suffixIndex = {}; // Index for suffix matching
        this.wordsIndex = {}; // Index for the "words" array in anime tags
        
        Object.keys(this.tagData).forEach(tagName => {
            const tagInfo = this.tagData[tagName];
            const words = tagName.toLowerCase().split(/\s+/).filter(word => word.length > 0);
            
            // Index by individual words for word-based matching
            words.forEach(word => {
                if (!this.wordIndex[word] || !Array.isArray(this.wordIndex[word])) {
                    this.wordIndex[word] = [];
                }
                if (!this.wordIndex[word].includes(tagName)) {
                    this.wordIndex[word].push(tagName);
                }
                
                // Index word prefixes for better partial matching
                for (let i = 1; i <= word.length; i++) {
                    const prefix = word.substring(0, i);
                    if (!this.prefixIndex[prefix] || !Array.isArray(this.prefixIndex[prefix])) {
                        this.prefixIndex[prefix] = [];
                    }
                    if (!this.prefixIndex[prefix].includes(tagName)) {
                        this.prefixIndex[prefix].push(tagName);
                    }
                }

                // Index word suffixes for better partial matching
                for (let i = 1; i <= word.length; i++) {
                    const suffix = word.substring(word.length - i);
                    if (!this.suffixIndex[suffix] || !Array.isArray(this.suffixIndex[suffix])) {
                        this.suffixIndex[suffix] = [];
                    }
                    if (!this.suffixIndex[suffix].includes(tagName)) {
                        this.suffixIndex[suffix].push(tagName);
                    }
                }
            });
            
            // Index by the "words" array from anime tag data
            if (tagInfo.words && Array.isArray(tagInfo.words)) {
                tagInfo.words.forEach(word => {
                    const wordLower = word.toLowerCase();
                    if (!this.wordsIndex[wordLower] || !Array.isArray(this.wordsIndex[wordLower])) {
                        this.wordsIndex[wordLower] = [];
                    }
                    if (!this.wordsIndex[wordLower].includes(tagName)) {
                        this.wordsIndex[wordLower].push(tagName);
                    }
                });
            }
            
            // Index by full tag name for exact matches
            const fullTagName = tagName.toLowerCase();
            if (!this.searchIndex[fullTagName]) {
                this.searchIndex[fullTagName] = [];
            }
            if (!this.searchIndex[fullTagName].includes(tagName)) {
                this.searchIndex[fullTagName].push(tagName);
            }
        });
        
        // Build complete
    }

    searchTags(query, limit = 10) {
        this.loadTagData(); // Reload if needed
        
        if (!query || query.trim().length < 1) {
            return [];
        }

        const searchTerm = query.trim().toLowerCase();
        const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
        const results = [];
        const seenTags = new Set();
        
        // Check if indexes are properly initialized
        if (!this.searchIndex || typeof this.searchIndex !== 'object') {
            logger.error('Search index not properly initialized');
            return [];
        }
        
        if (!this.wordIndex || typeof this.wordIndex !== 'object') {
            logger.error('Word index not properly initialized');
            return [];
        }
        
        if (!this.prefixIndex || typeof this.prefixIndex !== 'object') {
            logger.error('Prefix index not properly initialized');
            return [];
        }

        // 1. Exact matches (highest priority)
        if (this.searchIndex[searchTerm] && Array.isArray(this.searchIndex[searchTerm])) {
            this.searchIndex[searchTerm].forEach(tagName => {
                if (!seenTags.has(tagName)) {
                    const tagInfo = this.tagData[tagName];
                    results.push({
                        tag: tagName,
                        tag_name: tagInfo.tag_name,
                        d_id: tagInfo.d_id,
                        d_category: tagInfo.d_category,
                        d_count: tagInfo.d_count,
                        n_count: tagInfo.n_count,
                        n_rand: tagInfo.n_rand,
                        words: tagInfo.words || [],
                        z_category: tagInfo.z_category || [],
                        confidence: 100, // Exact match
                        similarity: 100,
                        source: 'anime-local'
                    });
                    seenTags.add(tagName);
                }
            });
        }

        // 1.5. Series name matches for characters (high priority)
        // Extract series name from character tags like "character (series)"
        const seriesMatches = this.findSeriesMatches(searchTerm);
        seriesMatches.forEach(match => {
            if (!seenTags.has(match.tagName)) {
                const tagInfo = this.tagData[match.tagName];
                results.push({
                    tag: match.tagName,
                    tag_name: tagInfo.tag_name,
                    d_id: tagInfo.d_id,
                    d_category: tagInfo.d_category,
                    d_count: tagInfo.d_count,
                    n_count: tagInfo.n_count,
                    n_rand: tagInfo.n_rand,
                    words: tagInfo.words || [],
                    z_category: tagInfo.z_category || [],
                    confidence: Math.min(95, match.similarity * 100),
                    similarity: match.similarity,
                    source: 'anime-local'
                });
                seenTags.add(match.tagName);
            }
        });

        // 2. Words array matches (high priority for anime tags)
        if (searchWords.length > 0) {
            const wordsMatches = this.findWordsArrayMatches(searchWords);
            wordsMatches.forEach(match => {
                if (!seenTags.has(match.tagName)) {
                    const tagInfo = this.tagData[match.tagName];
                    results.push({
                        tag: match.tagName,
                        tag_name: tagInfo.tag_name,
                        d_id: tagInfo.d_id,
                        d_category: tagInfo.d_category,
                        d_count: tagInfo.d_count,
                        n_count: tagInfo.n_count,
                        n_rand: tagInfo.n_rand,
                        words: tagInfo.words || [],
                        z_category: tagInfo.z_category || [],
                        confidence: Math.min(95, match.similarity * 100),
                        similarity: match.similarity,
                        source: 'anime-local'
                    });
                    seenTags.add(match.tagName);
                }
            });
        }

        // 3. Word-based matches (medium priority)
        if (searchWords.length > 0) {
            const wordMatches = this.findWordMatches(searchWords);
            wordMatches.forEach(match => {
                if (!seenTags.has(match.tagName)) {
                    const tagInfo = this.tagData[match.tagName];
                    results.push({
                        tag: match.tagName,
                        tag_name: tagInfo.tag_name,
                        d_id: tagInfo.d_id,
                        d_category: tagInfo.d_category,
                        d_count: tagInfo.d_count,
                        n_count: tagInfo.n_count,
                        n_rand: tagInfo.n_rand,
                        words: tagInfo.words || [],
                        z_category: tagInfo.z_category || [],
                        confidence: Math.min(90, match.similarity * 100),
                        similarity: match.similarity,
                        source: 'anime-local'
                    });
                    seenTags.add(match.tagName);
                }
            });
        }

        // 4. Prefix matches (medium priority)
        const prefixMatches = this.findPrefixMatches(searchTerm);
        prefixMatches.forEach(match => {
            if (!seenTags.has(match.tagName)) {
                const tagInfo = this.tagData[match.tagName];
                results.push({
                    tag: match.tagName,
                    tag_name: tagInfo.tag_name,
                    d_id: tagInfo.d_id,
                    d_category: tagInfo.d_category,
                    d_count: tagInfo.d_count,
                    n_count: tagInfo.n_count,
                    n_rand: tagInfo.n_rand,
                    words: tagInfo.words || [],
                    z_category: tagInfo.z_category || [],
                    confidence: Math.min(85, match.similarity * 100),
                    similarity: match.similarity,
                    source: 'anime-local'
                });
                seenTags.add(match.tagName);
            }
        });

        // 5. Suffix matches (low priority)
        const suffixMatches = this.findSuffixMatches(searchTerm);
        suffixMatches.forEach(match => {
            if (!seenTags.has(match.tagName)) {
                const tagInfo = this.tagData[match.tagName];
                results.push({
                    tag: match.tagName,
                    tag_name: tagInfo.tag_name,
                    d_id: tagInfo.d_id,
                    d_category: tagInfo.d_category,
                    d_count: tagInfo.d_count,
                    n_count: tagInfo.n_count,
                    n_rand: tagInfo.n_rand,
                    words: tagInfo.words || [],
                    z_category: tagInfo.z_category || [],
                    confidence: Math.min(80, match.similarity * 100),
                    similarity: match.similarity,
                    source: 'anime-local'
                });
                seenTags.add(match.tagName);
            }
        });

        // Sort by similarity and count
        results.sort((a, b) => {
            // First by similarity
            if (b.similarity !== a.similarity) {
                return b.similarity - a.similarity;
            }
            // Then by d_count (higher is better)
            return b.d_count - a.d_count;
        });

        const finalResults = results.slice(0, limit);
        return finalResults;
    }

    findWordsArrayMatches(searchWords) {
        const matches = [];
        const tagScores = new Map();

        searchWords.forEach(searchWord => {
            // Find exact word matches in the "words" array
            if (this.wordsIndex[searchWord] && Array.isArray(this.wordsIndex[searchWord])) {
                this.wordsIndex[searchWord].forEach(tagName => {
                    const currentScore = tagScores.get(tagName) || 0;
                    tagScores.set(tagName, currentScore + 1.0);
                });
            }

            // Find fuzzy word matches using Levenshtein distance
            Object.keys(this.wordsIndex).forEach(word => {
                if (this.wordsIndex[word] && Array.isArray(this.wordsIndex[word])) {
                    const distance = this.levenshteinDistance(searchWord, word);
                    const maxLength = Math.max(searchWord.length, word.length);
                    const similarity = 1 - (distance / maxLength);
                    
                    if (similarity >= 0.7) { // 70% similarity threshold
                        this.wordsIndex[word].forEach(tagName => {
                            const currentScore = tagScores.get(tagName) || 0;
                            tagScores.set(tagName, currentScore + similarity);
                        });
                    }
                }
            });
        });

        // Convert scores to matches
        tagScores.forEach((score, tagName) => {
            const normalizedScore = score / searchWords.length;
            if (normalizedScore > 0.3) { // Minimum threshold
                matches.push({
                    tagName,
                    similarity: normalizedScore
                });
            }
        });

        const sortedMatches = matches.sort((a, b) => b.similarity - a.similarity);
        return sortedMatches;
    }

    findSeriesMatches(searchTerm) {
        const matches = [];
        const tagScores = new Map();
        const seriesPattern = /\(([^)]+)\)$/; // Match content in parentheses at the end

        // Iterate through all tags to find character tags with series information
        Object.keys(this.tagData).forEach(tagName => {
            const tagInfo = this.tagData[tagName];
            
            // Only check character tags
            if (tagInfo.d_category === 'character') {
                const match = tagName.match(seriesPattern);
                
                if (match && match[1]) {
                    const seriesName = match[1].toLowerCase().trim();
                    
                    // Check for exact series match
                    if (seriesName === searchTerm) {
                        tagScores.set(tagName, 1.0); // Perfect match
                    } else if (seriesName.includes(searchTerm)) {
                        // Partial match - series name contains search term
                        const similarity = searchTerm.length / seriesName.length;
                        tagScores.set(tagName, Math.max(tagScores.get(tagName) || 0, similarity * 0.9));
                    } else if (searchTerm.includes(seriesName)) {
                        // Search term contains series name
                        const similarity = seriesName.length / searchTerm.length;
                        tagScores.set(tagName, Math.max(tagScores.get(tagName) || 0, similarity * 0.8));
                    } else {
                        // Fuzzy match using Levenshtein distance
                        const distance = this.levenshteinDistance(searchTerm, seriesName);
                        const maxLength = Math.max(searchTerm.length, seriesName.length);
                        const similarity = 1 - (distance / maxLength);
                        
                        if (similarity >= 0.7) { // 70% similarity threshold
                            tagScores.set(tagName, Math.max(tagScores.get(tagName) || 0, similarity * 0.85));
                        }
                    }
                }
            }
        });

        // Convert scores to matches
        tagScores.forEach((similarity, tagName) => {
            if (similarity > 0.5) { // Minimum threshold for series matches
                matches.push({
                    tagName,
                    similarity
                });
            }
        });

        const sortedMatches = matches.sort((a, b) => b.similarity - a.similarity);
        return sortedMatches;
    }

    findWordMatches(searchWords) {
        const matches = [];
        const tagScores = new Map();

        searchWords.forEach(searchWord => {
            // Find exact word matches
            if (this.wordIndex[searchWord] && Array.isArray(this.wordIndex[searchWord])) {
                this.wordIndex[searchWord].forEach(tagName => {
                    const currentScore = tagScores.get(tagName) || 0;
                    tagScores.set(tagName, currentScore + 1.0);
                });
            }

            // Find fuzzy word matches using Levenshtein distance
            Object.keys(this.wordIndex).forEach(word => {
                if (this.wordIndex[word] && Array.isArray(this.wordIndex[word])) {
                    const distance = this.levenshteinDistance(searchWord, word);
                    const maxLength = Math.max(searchWord.length, word.length);
                    const similarity = 1 - (distance / maxLength);
                    
                    if (similarity >= 0.7) { // 70% similarity threshold
                        this.wordIndex[word].forEach(tagName => {
                            const currentScore = tagScores.get(tagName) || 0;
                            tagScores.set(tagName, currentScore + similarity);
                        });
                    }
                }
            });
        });

        // Convert scores to matches
        tagScores.forEach((score, tagName) => {
            const normalizedScore = score / searchWords.length;
            if (normalizedScore > 0.3) { // Minimum threshold
                matches.push({
                    tagName,
                    similarity: normalizedScore
                });
            }
        });

        const sortedMatches = matches.sort((a, b) => b.similarity - a.similarity);
        return sortedMatches;
    }

    findPrefixMatches(searchTerm) {
        const matches = [];
        const seenTags = new Set();

        // Find tags that start with the search term
        if (this.prefixIndex[searchTerm] && Array.isArray(this.prefixIndex[searchTerm])) {
            this.prefixIndex[searchTerm].forEach(tagName => {
                if (!seenTags.has(tagName)) {
                    matches.push({
                        tagName,
                        similarity: 0.8 // High similarity for prefix matches
                    });
                    seenTags.add(tagName);
                }
            });
        }

        // Find word prefixes that match
        const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
        searchWords.forEach(word => {
            if (this.prefixIndex[word] && Array.isArray(this.prefixIndex[word])) {
                this.prefixIndex[word].forEach(tagName => {
                    if (!seenTags.has(tagName)) {
                        matches.push({
                            tagName,
                            similarity: 0.6 // Medium similarity for word prefix matches
                        });
                        seenTags.add(tagName);
                    }
                });
            }
        });

        const sortedMatches = matches.sort((a, b) => b.similarity - a.similarity);
        return sortedMatches;
    }

    findSuffixMatches(searchTerm) {
        const matches = [];
        const seenTags = new Set();

        // Find tags that end with the search term
        if (this.suffixIndex[searchTerm] && Array.isArray(this.suffixIndex[searchTerm])) {
            this.suffixIndex[searchTerm].forEach(tagName => {
                if (!seenTags.has(tagName)) {
                    matches.push({
                        tagName,
                        similarity: 0.8 // High similarity for suffix matches
                    });
                    seenTags.add(tagName);
                }
            });
        }

        // Find word suffixes that match
        const searchWords = searchTerm.split(/\s+/).filter(word => word.length > 0);
        searchWords.forEach(word => {
            if (this.suffixIndex[word] && Array.isArray(this.suffixIndex[word])) {
                this.suffixIndex[word].forEach(tagName => {
                    if (!seenTags.has(tagName)) {
                        matches.push({
                            tagName,
                            similarity: 0.6 // Medium similarity for word suffix matches
                        });
                        seenTags.add(tagName);
                    }
                });
            }
        });

        const sortedMatches = matches.sort((a, b) => b.similarity - a.similarity);
        return sortedMatches;
    }

    levenshteinDistance(str1, str2) {
        const matrix = [];
        
        for (let i = 0; i <= str2.length; i++) {
            matrix[i] = [i];
        }
        
        for (let j = 0; j <= str1.length; j++) {
            matrix[0][j] = j;
        }
        
        for (let i = 1; i <= str2.length; i++) {
            for (let j = 1; j <= str1.length; j++) {
                if (str2.charAt(i - 1) === str1.charAt(j - 1)) {
                    matrix[i][j] = matrix[i - 1][j - 1];
                } else {
                    matrix[i][j] = Math.min(
                        matrix[i - 1][j - 1] + 1, // substitution
                        matrix[i][j - 1] + 1,     // insertion
                        matrix[i - 1][j] + 1      // deletion
                    );
                }
            }
        }
        
        return matrix[str2.length][str1.length];
    }

    calculateSimilarity(searchTerm, tagName) {
        // Exact match
        if (tagName === searchTerm) {
            return 1.0;
        }
        
        // Starts with search term
        if (tagName.startsWith(searchTerm)) {
            return 0.9 - (tagName.length - searchTerm.length) * 0.01;
        }
        
        // Contains search term
        if (tagName.includes(searchTerm)) {
            const index = tagName.indexOf(searchTerm);
            return 0.7 - index * 0.01 - (tagName.length - searchTerm.length) * 0.005;
        }
        
        // Word boundary matches
        const searchWords = searchTerm.split(/\s+/);
        const tagWords = tagName.split(/\s+/);
        
        let wordMatches = 0;
        searchWords.forEach(searchWord => {
            tagWords.forEach(tagWord => {
                if (tagWord.startsWith(searchWord) || searchWord.startsWith(tagWord)) {
                    wordMatches++;
                }
            });
        });
        
        if (wordMatches > 0) {
            return 0.5 * (wordMatches / Math.max(searchWords.length, tagWords.length));
        }
        
        return 0;
    }

    getTagInfo(tagName) {
        this.loadTagData();
        return this.tagData[tagName] || null;
    }

    getCategories() {
        this.loadTagData();
        const categories = new Set();
        Object.values(this.tagData).forEach(tag => {
            if (tag.d_category) {
                categories.add(tag.d_category);
            }
        });
        return Array.from(categories).sort();
    }
}

module.exports = AnimeTagSearch; 