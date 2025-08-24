const fs = require('fs');
const path = require('path');

// Tag suggestions cache system with new format
class TagSuggestionsCache {
    constructor() {
        this.cache = {
            query_idx: {},      // query_idx: { "MODEL_query": [tag_id...] }
            tags: {},           // tags: { "MODEL": { tag_id: { data... } } }
            tag_idx: {},        // tag_idx: { "MODEL": { "tag_text": tag_id } }
            n_idx: {},          // n_idx: { "MODEL": next_tag_id }
        };
        
        this.cachePath = path.join(__dirname, '..', '.cache', 'tag_cache.json');
        this.isDirty = false;
        this.saveTimer = null;
        this.lastSaveTime = 0;
        
        // Load existing cache if it exists
        this.loadCache();
        
        // Start periodic save timer
        this.startSaveTimer();
    }
    
    // Load cache from file
    loadCache() {
        try {
            if (fs.existsSync(this.cachePath)) {
                const data = fs.readFileSync(this.cachePath, 'utf8');
                const loaded = JSON.parse(data);
                
                // Validate and merge with existing cache
                if (loaded.query_idx) this.cache.query_idx = { ...this.cache.query_idx, ...loaded.query_idx };
                if (loaded.tags) this.cache.tags = { ...this.cache.tags, ...loaded.tags };
                if (loaded.n_idx) this.cache.n_idx = { ...this.cache.n_idx, ...loaded.n_idx };
                if (loaded.tag_idx) this.cache.tag_idx = { ...this.cache.tag_idx, ...loaded.tag_idx };
                
                console.log(`📋 Loaded tag suggestions cache: ${Object.keys(this.cache.query_idx).length} queries, ${this.getTotalTags()} tags`);
            }
        } catch (error) {
            console.error('Failed to load tag suggestions cache:', error);
        }
    }
    
    // Save cache to file
    saveCache() {
        try {
            // Ensure directory exists
            const dir = path.dirname(this.cachePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }
            
            // Save cache
            fs.writeFileSync(this.cachePath, JSON.stringify(this.cache, null, 2));
            this.isDirty = false;
            this.lastSaveTime = Date.now();
            
            console.log(`💾 Saved tag suggestions cache: ${Object.keys(this.cache.query_idx).length} queries, ${this.getTotalTags()} tags`);
        } catch (error) {
            console.error('Failed to save tag suggestions cache:', error);
        }
    }
    
    // Get next tag ID for a model
    getNextTagId(model) {
        if (!this.cache.n_idx[model]) {
            this.cache.n_idx[model] = 1;
        }
        return this.cache.n_idx[model]++;
    }
    
    // Check if tag already exists for a model
    tagExists(model, tagText) {
        if (!this.cache.tag_idx[model]) {
            return false;
        }
        return this.cache.tag_idx[model].hasOwnProperty(tagText);
    }
    
    // Get existing tag ID by text
    getTagIdByText(model, tagText) {
        if (!this.cache.tag_idx[model]) {
            return null;
        }
        return this.cache.tag_idx[model][tagText] || null;
    }
    
    // Add tag to cache (prevents duplicates)
    addTag(model, tagData) {
        if (!this.cache.tags[model]) {
            this.cache.tags[model] = {};
        }
        if (!this.cache.tag_idx[model]) {
            this.cache.tag_idx[model] = {};
        }
        
        // Check if tag already exists
        const tagText = tagData.text || tagData.name || tagData.tag;
        if (tagText && this.tagExists(model, tagText)) {
            // Return existing tag ID instead of creating duplicate
            const existingId = this.getTagIdByText(model, tagText);
            return existingId;
        }
        
        const tagId = this.getNextTagId(model);
        this.cache.tags[model][tagId] = {
            ...tagData,
            id: tagId,
            model: model,
            timestamp: Date.now()
        };
        
        // Add to tag index if we have text
        if (tagText) {
            this.cache.tag_idx[model][tagText] = tagId;
        }
        
        this.markDirty();
        return tagId;
    }
    
    // Get tag by ID
    getTag(model, tagId) {
        return this.cache.tags[model]?.[tagId] || null;
    }
    
    // Get tag by text
    getTagByText(model, tagText) {
        const tagId = this.getTagIdByText(model, tagText);
        if (tagId) {
            return this.getTag(model, tagId);
        }
        return null;
    }
    
    // Store query results
    storeQueryResults(query, model, tagIds) {
        const queryKey = `${model}_${query}`;
        this.cache.query_idx[queryKey] = tagIds;
        this.markDirty();
    }
    
    // Get cached query results
    getCachedQuery(query, model) {
        const queryKey = `${model}_${query}`;
        const tagIds = this.cache.query_idx[queryKey];
        
        if (!tagIds) return null;
        
        // Return tags in order they were received
        return tagIds.map(tagId => this.getTag(model, tagId)).filter(Boolean);
    }
    
    // Check if query is cached
    isQueryCached(query, model) {
        const queryKey = `${model}_${query}`;
        return this.cache.query_idx.hasOwnProperty(queryKey);
    }
    
    // Get total number of tags across all models
    getTotalTags() {
        let total = 0;
        for (const model in this.cache.tags) {
            total += Object.keys(this.cache.tags[model]).length;
        }
        return total;
    }
    
    // Get unique tags count (excluding duplicates)
    getUniqueTagsCount() {
        let total = 0;
        for (const model in this.cache.tag_idx) {
            total += Object.keys(this.cache.tag_idx[model]).length;
        }
        return total;
    }
    
    // Mark cache as dirty and schedule save
    markDirty() {
        this.isDirty = true;
        this.scheduleSave();
    }
    
    // Schedule cache save with debouncing
    scheduleSave() {
        // Clear existing timer
        if (this.saveTimer) {
            clearTimeout(this.saveTimer);
        }
        
        // Set new timer (15 minutes)
        this.saveTimer = setTimeout(() => {
            this.saveCache();
        }, 15 * 60 * 1000); // 15 minutes
    }
    
    // Start periodic save timer (30 minutes max)
    startSaveTimer() {
        setInterval(() => {
            const now = Date.now();
            const timeSinceLastSave = now - this.lastSaveTime;
            
            // Save if dirty and it's been more than 30 minutes since last save
            if (this.isDirty && timeSinceLastSave >= 30 * 60 * 1000) {
                this.saveCache();
            }
        }, 30 * 60 * 1000); // Check every 30 minutes
    }
    
    // Get cache statistics
    getStats() {
        const now = Date.now();
        const stats = {
            queries: Object.keys(this.cache.query_idx).length,
            totalTags: this.getTotalTags(),
            uniqueTags: this.getUniqueTagsCount(),
            models: Object.keys(this.cache.tags),
            isDirty: this.isDirty,
            lastSaveTime: this.lastSaveTime,
            timeSinceLastSave: now - this.lastSaveTime
        };
        
        // Add per-model stats
        stats.modelStats = {};
        for (const model in this.cache.tags) {
            const modelTags = Object.keys(this.cache.tags[model]).length;
            const modelUniqueTags = this.cache.tag_idx[model] ? Object.keys(this.cache.tag_idx[model]).length : 0;
            const modelQueries = Object.keys(this.cache.query_idx).filter(key => key.startsWith(model + '_')).length;
            stats.modelStats[model] = {
                tags: modelTags,
                uniqueTags: modelUniqueTags,
                queries: modelQueries,
                nextTagId: this.cache.n_idx[model] || 1
            };
        }
        
        return stats;
    }
    
    // Clear cache
    clearCache() {
        this.cache = {
            query_idx: {},
            tags: {},
            n_idx: {},
            tag_idx: {},
        };
        this.isDirty = true;
        this.saveCache();
    }
    
    // Clean up old entries (older than 24 hours)
    cleanupOldEntries() {
        const now = Date.now();
        const maxAge = 24 * 60 * 60 * 1000; // 24 hours
        let cleanedQueries = 0;
        let cleanedTags = 0;
        
        // Clean up old tags
        for (const model in this.cache.tags) {
            for (const tagId in this.cache.tags[model]) {
                const tag = this.cache.tags[model][tagId];
                if (now - tag.timestamp > maxAge) {
                    // Remove from tag index if it exists
                    if (this.cache.tag_idx[model]) {
                        for (const tagText in this.cache.tag_idx[model]) {
                            if (this.cache.tag_idx[model][tagText] === parseInt(tagId)) {
                                delete this.cache.tag_idx[model][tagText];
                                break;
                            }
                        }
                    }
                    
                    delete this.cache.tags[model][tagId];
                    cleanedTags++;
                }
            }
        }
        
        // Clean up orphaned queries (queries that reference non-existent tags)
        for (const queryKey in this.cache.query_idx) {
            const [model, query] = queryKey.split('_', 2);
            const tagIds = this.cache.query_idx[queryKey];
            
            // Check if all referenced tags still exist
            const validTagIds = tagIds.filter(tagId => this.getTag(model, tagId));
            
            if (validTagIds.length === 0) {
                delete this.cache.query_idx[queryKey];
                cleanedQueries++;
            } else if (validTagIds.length !== tagIds.length) {
                // Update query with only valid tag IDs
                this.cache.query_idx[queryKey] = validTagIds;
                this.markDirty();
            }
        }
        
        if (cleanedQueries > 0 || cleanedTags > 0) {
            console.log(`🧹 Cleaned up ${cleanedQueries} orphaned queries and ${cleanedTags} old tags`);
            this.markDirty();
        }
    }
    
    // Rebuild tag index from tags (useful for migration)
    rebuildTagIndex() {
        console.log('🔄 Rebuilding tag index...');
        
        // Clear existing index
        this.cache.tag_idx = {};
        
        // Rebuild from tags
        for (const model in this.cache.tags) {
            this.cache.tag_idx[model] = {};
            for (const tagId in this.cache.tags[model]) {
                const tag = this.cache.tags[model][tagId];
                const tagText = tag.text || tag.name || tag.tag;
                if (tagText) {
                    this.cache.tag_idx[model][tagText] = parseInt(tagId);
                }
            }
        }
        
        this.markDirty();
        console.log(`✅ Tag index rebuilt: ${this.getUniqueTagsCount()} unique tags indexed`);
    }
}

// Create and export cache instance
const tagSuggestionsCache = new TagSuggestionsCache();

// Start cleanup timer (every hour)
setInterval(() => {
    tagSuggestionsCache.cleanupOldEntries();
}, 60 * 60 * 1000);

// Handle graceful shutdown
process.on('SIGINT', () => {
    console.log('🛑 SIGINT received, saving tag cache...');
    tagSuggestionsCache.saveCache();
    process.exit(0);
});

process.on('SIGTERM', () => {
    console.log('🛑 SIGTERM received, saving tag cache...');
    tagSuggestionsCache.saveCache();
    process.exit(0);
});

process.on('exit', () => {
    if (tagSuggestionsCache.isDirty) {
        console.log('💾 Tag cache dirty on exit, attempting to save...');
        try {
            tagSuggestionsCache.saveCache();
        } catch (error) {
            console.error('Failed to save tag cache on exit:', error);
        }
    }
});

module.exports = {
    tagSuggestionsCache
}; 