/**
 * NovelAI `suggest-tags` API result cache (`search_cache`, `cached_tags`, processed cache tables).
 * Local autofill tag search uses TagLookup via modules/tagAutofillSearch.js, not animeTagSearch/furryTagSearch.
 */
const Database = require('better-sqlite3');
const fs = require('fs');
const path = require('path');
const logger = require('./logger');
const { attachLegacyDatabaseCheckpoint } = require('./legacyDatabaseCheckpoint');

let dbPath = null;
let db = null;
let checkpointHost = null;

function normalizeTagSearchQuery(query) {
    return (query || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

/**
 * Re-open SQLite when the module was reset (e.g. hot reload) but dbPath is known.
 */
function ensureTagSearchDatabase() {
    if (db) {
        return true;
    }
    if (!dbPath || !fs.existsSync(dbPath)) {
        return false;
    }
    try {
        db = new Database(dbPath);
        db.pragma('journal_mode = DELETE');
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 1000');
        db.pragma('temp_store = MEMORY');
        db.pragma('foreign_keys = ON');
        return true;
    } catch (error) {
        console.error('❌ Failed to re-open tag search database:', error.message);
        db = null;
        return false;
    }
}

/**
 * Initialize the SQLite database for tag search caching
 */
function initializeTagSearchDatabase(databasesPath) {
    try {
        dbPath = path.join(databasesPath, 'tag_search.db');
        const cacheDir = path.dirname(dbPath);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        if (fs.existsSync(dbPath)) {
            try {
                // Try to open and run a simple query to test integrity
                const testDb = new Database(dbPath, { readonly: true });
                testDb.prepare('SELECT 1').get();
                testDb.close();
            } catch (corruptionError) {
                console.warn('Database file corrupted, recreating:', corruptionError.message);
                fs.unlinkSync(dbPath);
            }
        }

        // Create fresh database
        db = new Database(dbPath);

        // Set pragmas for reliability
        db.pragma('journal_mode = DELETE'); // Simpler than WAL for single-writer
        db.pragma('synchronous = NORMAL');
        db.pragma('cache_size = 1000'); // Smaller cache
        db.pragma('temp_store = MEMORY');
        db.pragma('foreign_keys = ON');

        checkpointHost = { checkpointManager: null };
        attachLegacyDatabaseCheckpoint(checkpointHost, dbPath, () => db, null);

        // Create tables
        createTables();

        logger.bootSubStep('Tag search database initialized');
        return true;

    } catch (error) {
        console.error('❌ Failed to initialize tag search database:', error.message);
        // Clean up on failure
        if (db) {
            try { db.close(); } catch {}
            db = null;
        }
        return false;
    }
}

/**
 * Create database tables
 */
function createTables() {
    // Search cache table
    db.exec(`
        CREATE TABLE IF NOT EXISTS search_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            input_query TEXT NOT NULL,
            model TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            UNIQUE(input_query, model)
        )
    `);
    
    // Cached tags table
    db.exec(`
        CREATE TABLE IF NOT EXISTS cached_tags (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            search_id INTEGER NOT NULL,
            tag_name TEXT NOT NULL,
            tag_count INTEGER DEFAULT 0,
            confidence REAL DEFAULT 0,
            result_index INTEGER NOT NULL,
            FOREIGN KEY (search_id) REFERENCES search_cache(id) ON DELETE CASCADE
        )
    `);
    
    // Processed search results cache table
    db.exec(`
        CREATE TABLE IF NOT EXISTS processed_search_cache (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            search_query TEXT NOT NULL,
            created_at INTEGER DEFAULT (strftime('%s', 'now')),
            expires_at INTEGER DEFAULT (strftime('%s', 'now', '+24 hours')),
            UNIQUE(search_query)
        )
    `);

    // Processed results table
    db.exec(`
        CREATE TABLE IF NOT EXISTS processed_results (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            cache_id INTEGER NOT NULL,
            result_type TEXT NOT NULL, -- 'api' or 'database'
            tag_name TEXT NOT NULL,
            usage_count INTEGER DEFAULT 0,
            match_percent REAL DEFAULT 0,
            source TEXT NOT NULL,
            result_index INTEGER NOT NULL,
            FOREIGN KEY (cache_id) REFERENCES processed_search_cache(id) ON DELETE CASCADE
        )
    `);

    // Indexes
    db.exec(`
        CREATE INDEX IF NOT EXISTS idx_search_cache_query_model ON search_cache (input_query, model);
        CREATE INDEX IF NOT EXISTS idx_cached_tags_search_id ON cached_tags (search_id);
        CREATE INDEX IF NOT EXISTS idx_processed_search_cache_query ON processed_search_cache (search_query);
        CREATE INDEX IF NOT EXISTS idx_processed_results_cache_id ON processed_results (cache_id);
    `);
}

/**
 * Close database connection
 */
function closeTagSearchDatabase() {
    if (db) {
        db.close();
        db = null;
    }
}

/**
 * Get cached tags for a query and model
 * @param {string} query - The search query
 * @param {string} model - The model name
 * @returns {Array|null} - Array of tag objects or null if not found
 */
function getCachedTags(query, model) {
    if (!ensureTagSearchDatabase()) {
        return null;
    }
    try {
        const normalizedQuery = normalizeTagSearchQuery(query);
        const apiModel = String(model || '').trim();
        if (!normalizedQuery || !apiModel) {
            return null;
        }

        let search = db.prepare('SELECT id FROM search_cache WHERE input_query = ? AND model = ?').get(normalizedQuery, apiModel);
        if (!search) {
            const legacyQuery = (query || '').trim().toLowerCase();
            if (legacyQuery && legacyQuery !== normalizedQuery) {
                search = db.prepare('SELECT id FROM search_cache WHERE input_query = ? AND model = ?').get(legacyQuery, apiModel);
            }
        }
        if (!search) {
            return null;
        }

        const rows = db.prepare(`
            SELECT tag_name, tag_count, confidence
            FROM cached_tags
            WHERE search_id = ?
            ORDER BY result_index ASC
        `).all(search.id);

        if (!rows || rows.length === 0) {
            return null;
        }

        return rows.map((row) => ({
            tag: row.tag_name,
            count: row.tag_count,
            confidence: row.confidence
        }));
    } catch (error) {
        console.error('❌ Error getting cached tags:', error.message);
        return null;
    }
}

/**
 * Save search results to cache
 * @param {string} query - The search query
 * @param {string} model - The model name
 * @param {Array} tags - Array of tag objects { tag, count, confidence }
 */
function saveSearchResults(query, model, tags) {
    if (!ensureTagSearchDatabase()) {
        return false;
    }
    if (!tags || !Array.isArray(tags)) return false;
    
    try {
        const normalizedQuery = normalizeTagSearchQuery(query);
        const apiModel = String(model || '').trim();
        if (!normalizedQuery || !apiModel) {
            return false;
        }
        // Use a transaction for atomicity
        const transaction = db.transaction(() => {
            // Check if entry already exists
            const existing = db.prepare('SELECT id FROM search_cache WHERE input_query = ? AND model = ?').get(normalizedQuery, apiModel);
            
            let searchId;
            if (existing) {
                // If it exists, we could update it, or just return. 
                // For now, let's delete old tags and re-insert to update.
                searchId = existing.id;
                db.prepare('DELETE FROM cached_tags WHERE search_id = ?').run(searchId);
                // Update timestamp
                db.prepare("UPDATE search_cache SET created_at = strftime('%s', 'now') WHERE id = ?").run(searchId);
            } else {
                // Insert new search cache entry
                const result = db.prepare('INSERT INTO search_cache (input_query, model) VALUES (?, ?)').run(normalizedQuery, apiModel);
                searchId = result.lastInsertRowid;
            }
            
            // Insert tags
            const insertTag = db.prepare(`
                INSERT INTO cached_tags (search_id, tag_name, tag_count, confidence, result_index)
                VALUES (?, ?, ?, ?, ?)
            `);
            
            tags.forEach((tag, index) => {
                insertTag.run(
                    searchId,
                    tag.tag || tag.name || '',
                    tag.count || 0,
                    tag.confidence || 0,
                    index
                );
            });
        });
        
        transaction();
        return true;
    } catch (error) {
        console.error('❌ Error saving search results:', error.message);
        return false;
    }
}

/**
 * Get cached processed search results
 * @param {string} query - The search query
 * @returns {Object|null} - Object with api and database arrays, or null if not found/expired
 */
function getCachedProcessedResults(query) {
    try {
        // Check if we have cached results that haven't expired
        const cacheEntry = db.prepare(`
            SELECT id, expires_at FROM processed_search_cache
            WHERE search_query = ? AND expires_at > strftime('%s', 'now')
        `).get(query);

        if (!cacheEntry) {
            return null;
        }

        // Get the results
        const results = db.prepare(`
            SELECT result_type, tag_name, usage_count, match_percent, source
            FROM processed_results
            WHERE cache_id = ?
            ORDER BY result_index
        `).all(cacheEntry.id);

        // Group by result_type
        const api = [];
        const database = [];

        results.forEach(row => {
            const result = {
                tag: row.tag_name,
                usage: row.usage_count || 0,
                matchPercent: isNaN(row.match_percent) ? 0 : Math.round(row.match_percent),
                source: row.source
            };

            if (row.result_type === 'api') {
                api.push(result);
            } else if (row.result_type === 'database') {
                database.push(result);
            }
        });

        return { api, database };
    } catch (error) {
        console.error('❌ Error getting cached processed results:', error.message);
        return null;
    }
}

/**
 * Cache processed search results
 * @param {string} query - The search query
 * @param {Object} results - Object with api and database arrays
 */
function setCachedProcessedResults(query, results) {
    try {
        // Insert or replace cache entry
        const insertCache = db.prepare(`
            INSERT OR REPLACE INTO processed_search_cache (search_query, expires_at)
            VALUES (?, strftime('%s', 'now', '+24 hours'))
        `);

        const result = insertCache.run(query);
        const cacheId = result.lastInsertRowid;

        // Insert results
        const insertResult = db.prepare(`
            INSERT INTO processed_results (cache_id, result_type, tag_name, usage_count, match_percent, source, result_index)
            VALUES (?, ?, ?, ?, ?, ?, ?)
        `);

        // Insert API results
        if (results.api) {
            results.api.forEach((item, index) => {
                // The results come from getsuggestions, which has 'count', not 'usage'
                const cleanUsage = (!isNaN(item.count) && item.count !== null && item.count !== undefined) ? item.count : 0;
                const cleanMatchPercent = (!isNaN(item.similarity) && item.similarity !== null && item.similarity !== undefined) ? Math.round(item.similarity * 100) : 0;
                insertResult.run(cacheId, 'api', item.tag || '', cleanUsage, cleanMatchPercent, item.source || '', index);
            });
        }

        // Insert database results
        if (results.database) {
            results.database.forEach((item, index) => {
                // The results come from getsuggestions, which has 'count', not 'usage'
                const cleanUsage = (!isNaN(item.count) && item.count !== null && item.count !== undefined) ? item.count : 0;
                const cleanMatchPercent = (!isNaN(item.similarity) && item.similarity !== null && item.similarity !== undefined) ? Math.round(item.similarity * 100) : 0;
                insertResult.run(cacheId, 'database', item.tag || '', cleanUsage, cleanMatchPercent, item.source || '', index);
            });
        }

        return true;
    } catch (error) {
        console.error('❌ Error caching processed results:', error.message);
        return false;
    }
}

/**
 * Clean up old processed cache entries
 * @returns {number} - Number of entries cleaned up
 */
function cleanupOldProcessedCache() {
    try {
        const result = db.prepare('DELETE FROM processed_search_cache WHERE expires_at < strftime(\'%s\', \'now\')').run();
        if (result.changes > 0) {
            console.log(`🧹 Cleaned up ${result.changes} expired processed search cache entries`);
        }
        return result.changes;
    } catch (error) {
        console.error('❌ Error cleaning up old processed cache:', error.message);
        return 0;
    }
}

/**
 * Clean up old cache entries
 * @param {number} daysToKeep - Number of days to keep cache entries
 */
function cleanupOldCache(daysToKeep = 30) {
    try {
        const cutoff = Math.floor(Date.now() / 1000) - (daysToKeep * 24 * 60 * 60);
        const result = db.prepare('DELETE FROM search_cache WHERE created_at < ?').run(cutoff);
        if (result.changes > 0) {
            logger.info(`Cleaned up ${result.changes} old tag search cache entries`);
        }
        return result.changes;
    } catch (error) {
        console.error('❌ Error cleaning up old cache:', error.message);
        return 0;
    }
}

/**
 * Clear cached NovelAI suggest-tags results for a specific query (all models).
 * @param {string} query - Search query to clear
 * @returns {number} - Number of search_cache rows deleted
 */
function clearCacheForQuery(query) {
    try {
        const normalizedQuery = (query || '').trim().toLowerCase();
        const result = db.prepare('DELETE FROM search_cache WHERE input_query = ?').run(normalizedQuery);
        if (result.changes > 0) {
            logger.info(`Cleared tag search cache for query "${normalizedQuery}": ${result.changes} entries`);
        }
        return result.changes;
    } catch (error) {
        console.error('❌ Error clearing cache for query:', error.message);
        return 0;
    }
}

/**
 * Clear all search cache entries
 * @returns {Object} - Object with counts of deleted entries
 */
function clearAllCache() {
    try {
        // Delete all entries from all cache tables
        // Foreign key constraints will cascade delete related entries
        const searchCacheResult = db.prepare('DELETE FROM search_cache').run();
        const processedCacheResult = db.prepare('DELETE FROM processed_search_cache').run();
        
        const deletedCount = {
            searchCache: searchCacheResult.changes,
            processedCache: processedCacheResult.changes,
            total: searchCacheResult.changes + processedCacheResult.changes
        };
        
        if (deletedCount.total > 0) {
            logger.info(`Cleared all tag search cache: ${deletedCount.searchCache} search entries, ${deletedCount.processedCache} processed entries`);
        }
        
        return deletedCount;
    } catch (error) {
        console.error('❌ Error clearing all cache:', error.message);
        throw error;
    }
}

// Initialized by globalResources.initializeTagSearchDatabase(databasesPath) at server startup

// Graceful shutdown
process.on('SIGINT', () => {
    closeTagSearchDatabase();
});

process.on('SIGTERM', () => {
    closeTagSearchDatabase();
});

module.exports = {
    initializeTagSearchDatabase,
    ensureTagSearchDatabase,
    getCheckpointManager: () => checkpointHost?.checkpointManager || null,
    normalizeTagSearchQuery,
    closeTagSearchDatabase,
    getCachedTags,
    saveSearchResults,
    cleanupOldCache,
    clearCacheForQuery,
    clearAllCache,
    getCachedProcessedResults,
    setCachedProcessedResults,
    cleanupOldProcessedCache
};

