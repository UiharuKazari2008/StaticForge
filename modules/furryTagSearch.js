const fs = require('fs');
const path = require('path');

class FurryTagSearch {
    constructor() {
        this.tagData = null;
        this.searchIndex = null;
        this.lastModified = 0;
        this.indexFiles = {
            searchIndex: path.join(__dirname, '../.cache/furry_search_index.json'),
            wordIndex: path.join(__dirname, '../.cache/furry_word_index.json'),
            prefixIndex: path.join(__dirname, '../.cache/furry_prefix_index.json'),
            suffixIndex: path.join(__dirname, '../.cache/furry_suffix_index.json')
        };
        this.loadTagData();
    }

    loadTagData() {
        const filePath = path.join(__dirname, '../dataset_tags_furry.json');
        
        try {
            const stats = fs.statSync(filePath);
            if (stats.mtime.getTime() <= this.lastModified && this.tagData) {
                return; // Already loaded and up to date
            }

            console.log('🔄 Loading furry tag dataset...');
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
            
            console.log(`✅ Loaded ${Object.keys(this.tagData).length} furry tags`);
        } catch (error) {
            console.error('❌ Error loading furry tag dataset:', error.message);
            this.tagData = {};
            this.searchIndex = {};
        }
    }

    loadOrBuildSearchIndex() {
        // Check if we can load existing indexes
        if (this.canLoadIndexes()) {
            console.log('📂 Loading existing furry tag indexes...');
            this.loadSearchIndexes();
        } else {
            console.log('🔨 Building furry tag search indexes...');
            this.buildSearchIndex();
            this.saveSearchIndexes();
        }
    }

    canLoadIndexes() {
        try {
            // Check if all index files exist
            for (const [name, filePath] of Object.entries(this.indexFiles)) {
                if (!fs.existsSync(filePath)) {
                    console.log(`📂 Missing index file: ${name}`);
                    return false;
                }
            }

            // Check if index files are newer than the data file
            const dataFilePath = path.join(__dirname, '../dataset_tags_furry.json');
            const dataStats = fs.statSync(dataFilePath);
            
            for (const [name, filePath] of Object.entries(this.indexFiles)) {
                const indexStats = fs.statSync(filePath);
                if (indexStats.mtime.getTime() < dataStats.mtime.getTime()) {
                    console.log(`📂 Index file ${name} is older than data file`);
                    return false;
                }
            }

            return true;
        } catch (error) {
            console.log(`📂 Error checking index files: ${error.message}`);
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

            console.log(`📂 Loaded furry indexes: ${Object.keys(this.searchIndex).length} exact terms, ${Object.keys(this.wordIndex).length} words, ${Object.keys(this.prefixIndex).length} prefixes, ${Object.keys(this.suffixIndex).length} suffixes`);
        } catch (error) {
            console.error('❌ Error loading furry indexes:', error.message);
            console.log('🔨 Falling back to building indexes...');
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

            console.log('💾 Saved furry tag indexes to cache');
        } catch (error) {
            console.error('❌ Error saving furry indexes:', error.message);
        }
    }

    buildSearchIndex() {
        this.searchIndex = {};
        this.wordIndex = {}; // Index for word-based searching
        this.prefixIndex = {}; // Index for prefix matching
        this.suffixIndex = {}; // Index for suffix matching
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
            
            // Index by full tag name for exact matches
            const fullTagName = tagName.toLowerCase();
            if (!this.searchIndex[fullTagName]) {
                this.searchIndex[fullTagName] = [];
            }
            if (!this.searchIndex[fullTagName].includes(tagName)) {
                this.searchIndex[fullTagName].push(tagName);
            }
        });
        
        console.log(`🔍 Built search index with ${Object.keys(this.searchIndex).length} exact terms`);
        console.log(`🔍 Built word index with ${Object.keys(this.wordIndex).length} words`);
        console.log(`🔍 Built prefix index with ${Object.keys(this.prefixIndex).length} prefixes`);
        console.log(`🔍 Built suffix index with ${Object.keys(this.suffixIndex).length} suffixes`);
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
        
        // Debug: Check if search index is properly initialized
        if (!this.searchIndex || typeof this.searchIndex !== 'object') {
            console.error('❌ Search index not properly initialized');
            return [];
        }
        
        // Debug: Check if word index is properly initialized
        if (!this.wordIndex || typeof this.wordIndex !== 'object') {
            console.error('❌ Word index not properly initialized');
            return [];
        }
        
        // Debug: Check if prefix index is properly initialized
        if (!this.prefixIndex || typeof this.prefixIndex !== 'object') {
            console.error('❌ Prefix index not properly initialized');
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
                        e_name: tagInfo.e_name,
                        e_category: tagInfo.e_category,
                        e_count: tagInfo.e_count,
                        n_count: tagInfo.n_count,
                        e_group: tagInfo.e_group,
                        confidence: 100, // Exact match
                        similarity: 100
                    });
                    seenTags.add(tagName);
                }
            });
        }

        // 2. Word-based matches (high priority) disabled for now
        if (false && searchWords.length > 0) {
            const wordMatches = this.findWordMatches(searchWords);
            wordMatches.forEach(match => {
                if (!seenTags.has(match.tagName)) {
                    const tagInfo = this.tagData[match.tagName];
                    results.push({
                        tag: match.tagName,
                        tag_name: tagInfo.tag_name,
                        e_name: tagInfo.e_name,
                        e_category: tagInfo.e_category,
                        e_count: tagInfo.e_count,
                        n_count: tagInfo.n_count,
                        e_group: tagInfo.e_group,
                        confidence: Math.min(95, match.similarity * 100),
                        similarity: match.similarity
                    });
                    seenTags.add(match.tagName);
                }
            });
        }

        // 3. Prefix matches (medium priority)
        const prefixMatches = this.findPrefixMatches(searchTerm);
        prefixMatches.forEach(match => {
            if (!seenTags.has(match.tagName)) {
                const tagInfo = this.tagData[match.tagName];
                results.push({
                    tag: match.tagName,
                    tag_name: tagInfo.tag_name,
                    e_name: tagInfo.e_name,
                    e_category: tagInfo.e_category,
                    e_count: tagInfo.e_count,
                    n_count: tagInfo.n_count,
                    e_group: tagInfo.e_group,
                    confidence: Math.min(90, match.similarity * 100),
                    similarity: match.similarity
                });
                seenTags.add(match.tagName);
            }
        });

        // 4. Suffix matches (low priority)
        const suffixMatches = this.findSuffixMatches(searchTerm);
        suffixMatches.forEach(match => {
            if (!seenTags.has(match.tagName)) {
                const tagInfo = this.tagData[match.tagName];
                results.push({
                    tag: match.tagName,
                    tag_name: tagInfo.tag_name,
                    e_name: tagInfo.e_name,
                    e_category: tagInfo.e_category,
                    e_count: tagInfo.e_count,
                    n_count: tagInfo.n_count,
                    e_group: tagInfo.e_group,
                    confidence: Math.min(85, match.similarity * 100),
                    similarity: match.similarity
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
            // Then by e_count (higher is better)
            return b.e_count - a.e_count;
        });

        const finalResults = results.slice(0, limit);
        return finalResults;
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
            if (tag.e_category) {
                categories.add(tag.e_category);
            }
        });
        return Array.from(categories).sort();
    }
}

module.exports = FurryTagSearch; 