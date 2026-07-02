const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');
const { attachLegacyDatabaseCheckpoint } = require('./legacyDatabaseCheckpoint');

class ReferenceMetadataDatabase {
    constructor(globalResources = null) {
        if (!globalResources) {
            throw new Error('ReferenceMetadataDatabase requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        this.globalResources = globalResources;
        this.db = null;
        this.dbPath = path.join(globalResources.getPath('databases'), 'reference_metadata.db');
        this.init();
    }

    init() {
        try {
            // Ensure data directory exists
            const dataDir = path.dirname(this.dbPath);
            if (!fs.existsSync(dataDir)) {
                fs.mkdirSync(dataDir, { recursive: true });
            }

            // Initialize database
            this.db = new Database(this.dbPath);
            this.db.pragma('journal_mode = WAL');
            this.db.pragma('foreign_keys = ON');

            attachLegacyDatabaseCheckpoint(this, this.dbPath, () => this.db, this.globalResources);

            // Create tables
            this.createTables();
            
            logger.bootSubStep('Reference metadata database initialized');
        } catch (error) {
            logger.error('Error initializing reference metadata database:', error);
            throw error;
        }
    }

    createTables() {
        // Reference metadata table
        const createReferenceMetadataTable = `
            CREATE TABLE IF NOT EXISTS reference_metadata (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                hash TEXT UNIQUE NOT NULL,
                display_name TEXT,
                tags TEXT, -- JSON array of tags
                comment TEXT,
                vibe_append_prompt TEXT,
                vibe_append_uc TEXT,
                vibe_prepend_prompt BOOLEAN DEFAULT 0,
                vibe_prepend_uc BOOLEAN DEFAULT 0,
                created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
                updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
            )
        `;

        this.db.exec(createReferenceMetadataTable);

        // Migrate existing databases to add vibe_prepend column if it doesn't exist
        try {
            this.db.exec(`ALTER TABLE reference_metadata ADD COLUMN vibe_prepend_prompt BOOLEAN DEFAULT 0`);
        } catch (error) {
            // Column already exists or table doesn't exist, ignore
        }
        try {
            this.db.exec(`ALTER TABLE reference_metadata ADD COLUMN vibe_prepend_uc BOOLEAN DEFAULT 0`);
        } catch (error) {
            // Column already exists or table doesn't exist, ignore
        }

        // Create indexes for better performance
        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_reference_metadata_hash 
            ON reference_metadata(hash)
        `);

        this.db.exec(`
            CREATE INDEX IF NOT EXISTS idx_reference_metadata_tags 
            ON reference_metadata(tags)
        `);

        // Reference file cache table - stores metadata for uploaded reference images (cache files)
        // This is separate from vibes - these are the actual uploaded reference image files
        // Previews are always generated for cache files on upload and synced on startup
        // Uses cached_at for sorting (when file was added) instead of file system mtime
        const createFileCacheTable = `
            CREATE TABLE IF NOT EXISTS reference_file_cache (
                hash TEXT PRIMARY KEY NOT NULL,
                size INTEGER NOT NULL,
                cached_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `;

        this.db.exec(createFileCacheTable);

        // Reference workspace ownership table - replaces cacheFiles arrays in workspace.json
        // Links references (cache files) to workspaces
        const createWorkspaceOwnershipTable = `
            CREATE TABLE IF NOT EXISTS reference_workspace_ownership (
                hash TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (hash, workspace_id)
            )
        `;

        this.db.exec(createWorkspaceOwnershipTable);

        // Reference vibe metadata table - replaces vibe JSON files (encodings stored separately)
        // image_source can be NULL for locked vibes (imported without image) or base64 string for base64 vibes
        // When type='cache', image_source references reference_file_cache(hash) to link vibe to reference image
        // Comments are stored in reference_metadata table (hash = vibe.id), joined when needed
        const createVibeMetadataTable = `
            CREATE TABLE IF NOT EXISTS reference_vibe_metadata (
                id TEXT PRIMARY KEY NOT NULL,
                type TEXT NOT NULL,
                image_source TEXT,
                preview_hash TEXT,
                imported_from INTEGER DEFAULT 0,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now'))
            )
        `;

        this.db.exec(createVibeMetadataTable);

        try {
            this.db.exec(`ALTER TABLE reference_vibe_metadata ADD COLUMN locked INTEGER DEFAULT 0`);
        } catch (error) {
            // Column already exists
        }

        // Vibe encodings table - stores individual encodings linked to vibes
        const createVibeEncodingsTable = `
            CREATE TABLE IF NOT EXISTS reference_vibe_encodings (
                id INTEGER PRIMARY KEY AUTOINCREMENT,
                vibe_id TEXT NOT NULL,
                model TEXT NOT NULL,
                information_extraction REAL NOT NULL,
                encoding TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                updated_at INTEGER DEFAULT (strftime('%s', 'now')),
                FOREIGN KEY (vibe_id) REFERENCES reference_vibe_metadata(id) ON DELETE CASCADE,
                UNIQUE(vibe_id, model, information_extraction)
            )
        `;

        this.db.exec(createVibeEncodingsTable);

        // Vibe workspace ownership table - replaces vibeImages arrays in workspace.json
        const createVibeWorkspaceOwnershipTable = `
            CREATE TABLE IF NOT EXISTS reference_vibe_workspace_ownership (
                vibe_id TEXT NOT NULL,
                workspace_id TEXT NOT NULL,
                created_at INTEGER DEFAULT (strftime('%s', 'now')),
                PRIMARY KEY (vibe_id, workspace_id),
                FOREIGN KEY (vibe_id) REFERENCES reference_vibe_metadata(id) ON DELETE CASCADE
            )
        `;

        this.db.exec(createVibeWorkspaceOwnershipTable);

        // Create indexes for new tables
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_file_cache_hash ON reference_file_cache(hash)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_file_cache_cached_at ON reference_file_cache(cached_at DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_workspace_ownership_hash ON reference_workspace_ownership(hash)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_workspace_ownership_workspace ON reference_workspace_ownership(workspace_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_workspace_ownership_workspace_created ON reference_workspace_ownership(workspace_id, created_at DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_metadata_id ON reference_vibe_metadata(id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_metadata_created_at ON reference_vibe_metadata(created_at DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_encodings_vibe ON reference_vibe_encodings(vibe_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_encodings_model_ie ON reference_vibe_encodings(model, information_extraction)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_workspace_ownership_vibe ON reference_vibe_workspace_ownership(vibe_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_workspace_ownership_workspace ON reference_vibe_workspace_ownership(workspace_id)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_workspace_ownership_workspace_created ON reference_vibe_workspace_ownership(workspace_id, created_at DESC)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_metadata_image_source ON reference_vibe_metadata(image_source)`);
        this.db.exec(`CREATE INDEX IF NOT EXISTS idx_reference_vibe_metadata_type_image_source ON reference_vibe_metadata(type, image_source)`);
    }

    // CRUD Operations

    /**
     * Get metadata for a reference by hash
     * @param {string} hash - Reference hash
     * @returns {Object|null} Metadata object or null if not found
     */
    getMetadata(hash) {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM reference_metadata 
                WHERE hash = ?
            `);
            
            const result = stmt.get(hash);
            
            if (result) {
                // Parse tags JSON
                result.tags = result.tags ? JSON.parse(result.tags) : [];
                // Convert vibe_prepend to boolean
                result.vibe_prepend_prompt = !!result.vibe_prepend_prompt;
                result.vibe_prepend_uc = !!result.vibe_prepend_uc;
                return result;
            }
            
            return null;
        } catch (error) {
            console.error('Error getting reference metadata:', error);
            throw error;
        }
    }

    /**
     * Create or update metadata for a reference
     * @param {string} hash - Reference hash
     * @param {Object} metadata - Metadata object
     * @param {string} [metadata.displayName] - Display name
     * @param {Array} [metadata.tags] - Array of tags
     * @param {string} [metadata.comment] - Comment
     * @param {string} [metadata.vibeAppendPrompt] - Vibe append prompt
     * @param {string} [metadata.vibeAppendUc] - Vibe append UC
     * @param {boolean} [metadata.vibePrependPrompt] - Whether to prepend vibe text instead of append
     * @param {boolean} [metadata.vibePrependUc] - Whether to prepend vibe text instead of append
     * @returns {Object} Created/updated metadata
     */
    setMetadata(hash, metadata) {
        try {
            const now = new Date().toISOString();
            
            // Prepare tags as JSON string
            const tagsJson = metadata.tags ? JSON.stringify(metadata.tags) : JSON.stringify([]);
            
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO reference_metadata (
                    hash, display_name, tags, comment,
                    vibe_append_prompt, vibe_append_uc, vibe_prepend_prompt, vibe_prepend_uc,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
            `);

            const result = stmt.run(
                hash,
                metadata.displayName || null,
                tagsJson,
                metadata.comment || null,
                metadata.vibeAppendPrompt || null,
                metadata.vibeAppendUc || null,
                metadata.vibePrependPrompt ? 1 : 0,
                metadata.vibePrependUc ? 1 : 0,
                now,
                now
            );

            // Return the created/updated metadata
            return this.getMetadata(hash);
        } catch (error) {
            console.error('Error setting reference metadata:', error);
            throw error;
        }
    }

    /**
     * Delete metadata for a reference (also deletes file cache and workspace ownership)
     * @param {string} hash - Reference hash
     * @returns {boolean} True if deleted, false if not found
     */
    deleteMetadata(hash) {
        try {
            // Delete from all related tables
            const metadataStmt = this.db.prepare(`DELETE FROM reference_metadata WHERE hash = ?`);
            const fileCacheStmt = this.db.prepare(`DELETE FROM reference_file_cache WHERE hash = ?`);
            const workspaceOwnershipStmt = this.db.prepare(`DELETE FROM reference_workspace_ownership WHERE hash = ?`);

            const metadataResult = metadataStmt.run(hash);
            const fileCacheResult = fileCacheStmt.run(hash);
            const workspaceOwnershipResult = workspaceOwnershipStmt.run(hash);
            
            return metadataResult.changes > 0 || fileCacheResult.changes > 0 || workspaceOwnershipResult.changes > 0;
        } catch (error) {
            console.error('Error deleting reference metadata:', error);
            throw error;
        }
    }

    /**
     * Get all metadata entries
     * @returns {Array} Array of metadata objects
     */
    getAllMetadata() {
        try {
            const stmt = this.db.prepare(`
                SELECT * FROM reference_metadata 
                ORDER BY updated_at DESC
            `);
            
            const results = stmt.all();
            
            // Parse tags JSON for each result
            return results.map(result => ({
                ...result,
                tags: result.tags ? JSON.parse(result.tags) : []
            }));
        } catch (error) {
            console.error('Error getting all reference metadata:', error);
            throw error;
        }
    }

    /**
     * Search metadata by tags
     * @param {Array} tags - Array of tags to search for
     * @returns {Array} Array of matching metadata objects
     */
    searchByTags(tags) {
        try {
            if (!tags || tags.length === 0) {
                return this.getAllMetadata();
            }

            // Create placeholders for the IN clause
            const placeholders = tags.map(() => '?').join(',');
            
            const stmt = this.db.prepare(`
                SELECT * FROM reference_metadata 
                WHERE tags LIKE ?
                ORDER BY updated_at DESC
            `);
            
            // Search for each tag
            const results = [];
            for (const tag of tags) {
                const tagResults = stmt.all(`%"${tag}"%`);
                results.push(...tagResults);
            }
            
            // Remove duplicates and parse tags
            const uniqueResults = results.filter((result, index, self) => 
                index === self.findIndex(r => r.hash === result.hash)
            );
            
            return uniqueResults.map(result => ({
                ...result,
                tags: result.tags ? JSON.parse(result.tags) : []
            }));
        } catch (error) {
            console.error('Error searching reference metadata by tags:', error);
            throw error;
        }
    }

    /**
     * Check if a reference has a specific tag
     * @param {string} hash - Reference hash
     * @param {string} tag - Tag to check for
     * @returns {boolean} True if reference has the tag
     */
    hasTag(hash, tag) {
        try {
            const metadata = this.getMetadata(hash);
            return metadata && metadata.tags && metadata.tags.includes(tag);
        } catch (error) {
            console.error('Error checking tag:', error);
            return false;
        }
    }

    /**
     * Add a tag to a reference
     * @param {string} hash - Reference hash
     * @param {string} tag - Tag to add
     * @returns {Object} Updated metadata
     */
    addTag(hash, tag) {
        try {
            const metadata = this.getMetadata(hash);
            const tags = metadata ? metadata.tags : [];
            
            if (!tags.includes(tag)) {
                tags.push(tag);
                return this.setMetadata(hash, { ...metadata, tags });
            }
            
            return metadata;
        } catch (error) {
            console.error('Error adding tag:', error);
            throw error;
        }
    }

    /**
     * Remove a tag from a reference
     * @param {string} hash - Reference hash
     * @param {string} tag - Tag to remove
     * @returns {Object} Updated metadata
     */
    removeTag(hash, tag) {
        try {
            const metadata = this.getMetadata(hash);
            if (!metadata) return null;
            
            const tags = metadata.tags.filter(t => t !== tag);
            return this.setMetadata(hash, { ...metadata, tags });
        } catch (error) {
            console.error('Error removing tag:', error);
            throw error;
        }
    }

    /**
     * Get metadata for multiple references by their hashes
     * @param {Array} hashes - Array of reference hashes
     * @returns {Object} Object with hash as key and metadata as value
     */
    getMetadataForReferences(hashes) {
        try {
            if (!hashes || hashes.length === 0) {
                return {};
            }

            const placeholders = hashes.map(() => '?').join(',');
            const stmt = this.db.prepare(`
                SELECT * FROM reference_metadata 
                WHERE hash IN (${placeholders})
            `);
            
            const results = stmt.all(hashes);
            
            // Convert to object with hash as key
            const metadataMap = {};
            results.forEach(result => {
                metadataMap[result.hash] = {
                    ...result,
                    tags: result.tags ? JSON.parse(result.tags) : [],
                    vibe_prepend_prompt: !!result.vibe_prepend_prompt,
                    vibe_prepend_uc: !!result.vibe_prepend_uc
                };
            });
            
            return metadataMap;
        } catch (error) {
            console.error('Error getting metadata for references:', error);
            return {};
        }
    }

    // ============================================
    // FILE CACHE METHODS
    // ============================================

    /**
     * Get file cache entry for a reference
     * @param {string} hash - Reference hash
     * @returns {Object|null} File cache object or null if not found
     */
    getFileCache(hash, includeMetadata = false) {
        try {
            if (includeMetadata) {
                // JOIN with reference_metadata to get all metadata in one query (matching getFileCacheForReferences)
                const stmt = this.db.prepare(`
                    SELECT 
                        fc.*,
                        rm.display_name,
                        rm.tags,
                        rm.comment,
                        rm.vibe_append_prompt,
                        rm.vibe_append_uc,
                        rm.vibe_prepend_prompt,
                        rm.vibe_prepend_uc
                    FROM reference_file_cache fc
                    LEFT JOIN reference_metadata rm ON rm.hash = fc.hash
                    WHERE fc.hash = ?
                `);
                const result = stmt.get(hash);
                
                if (result) {
                    return {
                        hash: result.hash,
                        size: result.size,
                        cachedAt: result.cached_at,
                        updatedAt: result.updated_at,
                        // Include metadata if it exists
                        metadata: result.display_name || result.tags || result.comment || 
                                 result.vibe_append_prompt || result.vibe_append_uc ||
                                 result.vibe_prepend_prompt || result.vibe_prepend_uc ? {
                            displayName: result.display_name || null,
                            tags: result.tags ? JSON.parse(result.tags) : [],
                            comment: result.comment || null,
                            vibeAppendPrompt: result.vibe_append_prompt || null,
                            vibeAppendUc: result.vibe_append_uc || null,
                            vibePrependPrompt: !!result.vibe_prepend_prompt,
                            vibePrependUc: !!result.vibe_prepend_uc
                        } : null
                    };
                }
            } else {
                // Simple query without metadata JOIN (for backward compatibility)
                const stmt = this.db.prepare(`SELECT * FROM reference_file_cache WHERE hash = ?`);
                const result = stmt.get(hash);
                
                if (result) {
                    return {
                        hash: result.hash,
                        size: result.size,
                        cachedAt: result.cached_at,
                        updatedAt: result.updated_at
                    };
                }
            }
            return null;
        } catch (error) {
            console.error('Error getting file cache:', error);
            throw error;
        }
    }

    /**
     * Set or update file cache entry for a reference
     * @param {string} hash - Reference hash
     * @param {Object} fileData - File data object
     * @returns {Object} Cached file data
     */
    setFileCache(hash, fileData) {
        try {
            const now = Math.floor(Date.now() / 1000);
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO reference_file_cache (
                    hash, size, cached_at, updated_at
                ) VALUES (?, ?, 
                    COALESCE((SELECT cached_at FROM reference_file_cache WHERE hash = ?), ?),
                    ?
                )
            `);
            
            stmt.run(
                hash,
                fileData.size || 0,
                hash,
                now,
                now
            );
            
            return this.getFileCache(hash);
        } catch (error) {
            console.error('Error setting file cache:', error);
            throw error;
        }
    }

    /**
     * Get file cache for multiple references by their hashes
     * @param {Array} hashes - Array of reference hashes
     * @returns {Object} Object with hash as key and file cache as value
     */
    getFileCacheForReferences(hashes) {
        try {
            if (!hashes || hashes.length === 0) return {};

            const placeholders = hashes.map(() => '?').join(',');
            // JOIN with reference_metadata to get all metadata in one query
            const stmt = this.db.prepare(`
                SELECT 
                    fc.*,
                    rm.display_name,
                    rm.tags,
                    rm.comment,
                    rm.vibe_append_prompt,
                    rm.vibe_append_uc,
                    rm.vibe_prepend_prompt,
                    rm.vibe_prepend_uc
                FROM reference_file_cache fc
                LEFT JOIN reference_metadata rm ON rm.hash = fc.hash
                WHERE fc.hash IN (${placeholders})
            `);
            const results = stmt.all(hashes);
            
            const cacheMap = {};
            results.forEach(result => {
                cacheMap[result.hash] = {
                    hash: result.hash,
                    size: result.size,
                    cachedAt: result.cached_at,
                    updatedAt: result.updated_at,
                    // Include metadata if it exists
                    metadata: result.display_name || result.tags || result.comment || 
                             result.vibe_append_prompt || result.vibe_append_uc ||
                             result.vibe_prepend_prompt || result.vibe_prepend_uc ? {
                        displayName: result.display_name || null,
                        tags: result.tags ? JSON.parse(result.tags) : [],
                        comment: result.comment || null,
                        vibeAppendPrompt: result.vibe_append_prompt || null,
                        vibeAppendUc: result.vibe_append_uc || null,
                        vibePrependPrompt: !!result.vibe_prepend_prompt,
                        vibePrependUc: !!result.vibe_prepend_uc
                    } : null
                };
            });
            
            return cacheMap;
        } catch (error) {
            console.error('Error getting file cache for references:', error);
            return {};
        }
    }

    /**
     * Bulk update file cache entries
     * @param {Array} fileDataArray - Array of file data objects
     * @returns {number} Number of entries updated
     */
    bulkSetFileCache(fileDataArray) {
        try {
            if (!fileDataArray || fileDataArray.length === 0) return 0;

            const now = Math.floor(Date.now() / 1000);
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO reference_file_cache (
                    hash, size, cached_at, updated_at
                ) VALUES (?, ?, 
                    COALESCE((SELECT cached_at FROM reference_file_cache WHERE hash = ?), ?),
                    ?
                )
            `);

            const transaction = this.db.transaction((files) => {
                let count = 0;
                for (const fileData of files) {
                    stmt.run(
                        fileData.hash,
                        fileData.size || 0,
                        fileData.hash,
                        now,
                        now
                    );
                    count++;
                }
                return count;
            });

            return transaction(fileDataArray);
        } catch (error) {
            console.error('Error bulk setting file cache:', error);
            throw error;
        }
    }

    /**
     * Delete file cache entry
     * @param {string} hash - Reference hash
     * @returns {boolean} True if deleted
     */
    deleteFileCache(hash) {
        try {
            const stmt = this.db.prepare(`DELETE FROM reference_file_cache WHERE hash = ?`);
            const result = stmt.run(hash);
            return result.changes > 0;
        } catch (error) {
            console.error('Error deleting file cache:', error);
            throw error;
        }
    }

    // ============================================
    // WORKSPACE OWNERSHIP METHODS
    // ============================================

    /**
     * Add reference to workspace
     * @param {string} hash - Reference hash
     * @param {string} workspaceId - Workspace ID
     * @returns {boolean} True if added
     */
    addReferenceToWorkspace(hash, workspaceId) {
        try {
            // Use INSERT OR REPLACE to ensure the record always exists
            // This updates created_at if record already exists (keeps original if new)
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO reference_workspace_ownership (hash, workspace_id, created_at)
                VALUES (?, ?, COALESCE((SELECT created_at FROM reference_workspace_ownership WHERE hash = ? AND workspace_id = ?), strftime('%s', 'now')))
            `);
            const result = stmt.run(hash, workspaceId, hash, workspaceId);
            return result.changes > 0;
        } catch (error) {
            console.error('Error adding reference to workspace:', error);
            throw error;
        }
    }

    /**
     * Remove reference from workspace
     * @param {string} hash - Reference hash
     * @param {string} workspaceId - Workspace ID
     * @returns {boolean} True if removed
     */
    removeReferenceFromWorkspace(hash, workspaceId) {
        try {
            const stmt = this.db.prepare(`DELETE FROM reference_workspace_ownership WHERE hash = ? AND workspace_id = ?`);
            const result = stmt.run(hash, workspaceId);
            return result.changes > 0;
        } catch (error) {
            console.error('Error removing reference from workspace:', error);
            throw error;
        }
    }

    /**
     * Get all workspace IDs that own a reference
     * @param {string} hash - Reference hash
     * @returns {Array} Array of workspace IDs
     */
    getReferenceWorkspaces(hash) {
        try {
            const stmt = this.db.prepare(`SELECT workspace_id FROM reference_workspace_ownership WHERE hash = ?`);
            const results = stmt.all(hash);
            return results.map(r => r.workspace_id);
        } catch (error) {
            console.error('Error getting reference workspaces:', error);
            return [];
        }
    }

    /**
     * Get workspace ownership for multiple references (batch query for performance)
     * @param {Array} hashes - Array of reference hashes
     * @returns {Object} Object with hash as key and array of workspace IDs as value
     */
    getReferenceWorkspacesBatch(hashes) {
        try {
            if (!hashes || hashes.length === 0) return {};
            
            const placeholders = hashes.map(() => '?').join(',');
            const stmt = this.db.prepare(`SELECT hash, workspace_id FROM reference_workspace_ownership WHERE hash IN (${placeholders})`);
            const results = stmt.all(hashes);
            
            const workspaceMap = {};
            results.forEach(result => {
                if (!workspaceMap[result.hash]) {
                    workspaceMap[result.hash] = [];
                }
                workspaceMap[result.hash].push(result.workspace_id);
            });
            
            return workspaceMap;
        } catch (error) {
            console.error('Error getting reference workspaces batch:', error);
            return {};
        }
    }

    /**
     * Get all references for a workspace
     * @param {string} workspaceId - Workspace ID
     * @returns {Array} Array of reference hashes
     */
    getWorkspaceReferences(workspaceId) {
        try {
            const stmt = this.db.prepare(`SELECT hash FROM reference_workspace_ownership WHERE workspace_id = ? ORDER BY created_at DESC`);
            const results = stmt.all(workspaceId);
            return results.map(r => r.hash);
        } catch (error) {
            console.error('Error getting workspace references:', error);
            return [];
        }
    }

    /**
     * Get all references for multiple workspaces
     * @param {Array} workspaceIds - Array of workspace IDs
     * @returns {Array} Array of reference hashes
     */
    getMultipleWorkspaceReferences(workspaceIds) {
        try {
            if (!workspaceIds || workspaceIds.length === 0) return [];

            const placeholders = workspaceIds.map(() => '?').join(',');
            const stmt = this.db.prepare(`SELECT DISTINCT hash FROM reference_workspace_ownership WHERE workspace_id IN (${placeholders}) ORDER BY created_at DESC`);
            const results = stmt.all(workspaceIds);
            return results.map(r => r.hash);
        } catch (error) {
            console.error('Error getting multiple workspace references:', error);
            return [];
        }
    }

    /**
     * Get reference counts for multiple workspaces (batch query for performance)
     * @param {Array} workspaceIds - Array of workspace IDs
     * @returns {Object} Object with workspace ID as key and count as value
     */
    getWorkspaceReferenceCounts(workspaceIds) {
        try {
            if (!workspaceIds || workspaceIds.length === 0) return {};

            const placeholders = workspaceIds.map(() => '?').join(',');
            const stmt = this.db.prepare(`
                SELECT workspace_id, COUNT(*) as count 
                FROM reference_workspace_ownership 
                WHERE workspace_id IN (${placeholders})
                GROUP BY workspace_id
            `);
            const results = stmt.all(workspaceIds);
            
            const counts = {};
            workspaceIds.forEach(id => counts[id] = 0); // Initialize all to 0
            results.forEach(result => {
                counts[result.workspace_id] = result.count;
            });
            
            return counts;
        } catch (error) {
            console.error('Error getting workspace reference counts:', error);
            return {};
        }
    }

    /**
     * Bulk add references to workspace
     * @param {Array} hashes - Array of reference hashes
     * @param {string} workspaceId - Workspace ID
     * @returns {number} Number of references added
     */
    bulkAddReferencesToWorkspace(hashes, workspaceId) {
        try {
            if (!hashes || hashes.length === 0) return 0;

            const stmt = this.db.prepare(`INSERT OR IGNORE INTO reference_workspace_ownership (hash, workspace_id) VALUES (?, ?)`);
            const transaction = this.db.transaction((hashList) => {
                let count = 0;
                for (const hash of hashList) {
                    if (stmt.run(hash, workspaceId).changes > 0) count++;
                }
                return count;
            });

            return transaction(hashes);
        } catch (error) {
            console.error('Error bulk adding references to workspace:', error);
            throw error;
        }
    }

    // ============================================
    // VIBE METADATA METHODS
    // ============================================

    computeVibeLocked(row) {
        if (!row) return true;
        if (row.locked === 1 || row.locked === true) return true;
        const hasImage = row.image_source && String(row.image_source).trim() !== '';
        return !hasImage;
    }

    /**
     * Get vibe metadata by ID (includes encodings reconstructed from separate table)
     * @param {string} vibeId - Vibe ID (sha256 hash)
     * @returns {Object|null} Vibe metadata or null if not found
     */
    getVibeMetadata(vibeId) {
        try {
            // JOIN with reference_metadata to get all metadata fields (matching getVibeMetadataForVibes)
            const stmt = this.db.prepare(`
                SELECT 
                    vm.*,
                    rm.display_name,
                    rm.tags,
                    rm.comment,
                    rm.vibe_append_prompt,
                    rm.vibe_append_uc,
                    rm.vibe_prepend_prompt,
                    rm.vibe_prepend_uc
                FROM reference_vibe_metadata vm
                LEFT JOIN reference_metadata rm ON rm.hash = vm.id
                WHERE vm.id = ?
            `);
            const result = stmt.get(vibeId);
            
            if (result) {
                // Get encodings from separate table and reconstruct object
                const encodingsStmt = this.db.prepare(`SELECT model, information_extraction, encoding FROM reference_vibe_encodings WHERE vibe_id = ?`);
                const encodingsRows = encodingsStmt.all(vibeId);
                
                // Reconstruct encodings object: { model: { ie: encoding, ... }, ... }
                const encodings = {};
                for (const row of encodingsRows) {
                    if (!encodings[row.model]) {
                        encodings[row.model] = {};
                    }
                    // Store encoding - it can be a string or an object with .encoding property
                    const encodingValue = row.encoding;
                    encodings[row.model][row.information_extraction.toString()] = encodingValue;
                }
                
                const vibe = {
                    id: result.id,
                    type: result.type,
                    imageSource: result.image_source,
                    previewHash: result.preview_hash,
                    comment: result.comment || null, // From joined reference_metadata
                    importedFrom: result.imported_from || 0,
                    encodings: encodings,
                    createdAt: result.created_at,
                    updatedAt: result.updated_at,
                    // Include full metadata if it exists (matching getVibeMetadataForVibes)
                    metadata: result.display_name || result.tags || result.comment || 
                             result.vibe_append_prompt || result.vibe_append_uc ||
                             result.vibe_prepend_prompt || result.vibe_prepend_uc ? {
                        displayName: result.display_name || null,
                        tags: result.tags ? JSON.parse(result.tags) : [],
                        comment: result.comment || null,
                        vibeAppendPrompt: result.vibe_append_prompt || null,
                        vibeAppendUc: result.vibe_append_uc || null,
                        vibePrependPrompt: !!result.vibe_prepend_prompt,
                        vibePrependUc: !!result.vibe_prepend_uc
                    } : null
                };
                
                vibe.locked = this.computeVibeLocked(result);
                
                // For client compatibility, add mtime (use created_at for sorting)
                vibe.mtime = result.created_at * 1000;
                
                return vibe;
            }
            
            return null;
        } catch (error) {
            console.error('Error getting vibe metadata:', error);
            throw error;
        }
    }

    /**
     * Set or update vibe metadata (encodings stored in separate table)
     * @param {string} vibeId - Vibe ID (sha256 hash)
     * @param {Object} vibeData - Vibe data object
     * @param {Object} vibeData.encodings - Encodings object { model: { ie: encoding, ... }, ... }
     * @returns {Object} Saved vibe metadata
     */
    setVibeMetadata(vibeId, vibeData) {
        try {
            const now = Math.floor(Date.now() / 1000);
            
            // Auto-derive preview hash if not provided
            let previewHash = vibeData.previewHash;
            if (!previewHash && vibeData.type === 'cache' && vibeData.imageSource) {
                previewHash = vibeData.imageSource;
            }
            
            let lockedVal;
            if (vibeData.locked === true || vibeData.locked === 1) {
                lockedVal = 1;
            } else if (vibeData.locked === false || vibeData.locked === 0) {
                lockedVal = 0;
            } else {
                const existingRow = this.db.prepare(
                    'SELECT locked, image_source FROM reference_vibe_metadata WHERE id = ?'
                ).get(vibeId);
                if (existingRow) {
                    lockedVal = this.computeVibeLocked(existingRow) ? 1 : 0;
                } else {
                    const hasImage = vibeData.imageSource && String(vibeData.imageSource).trim() !== '';
                    lockedVal = hasImage ? 0 : 1;
                }
            }

            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO reference_vibe_metadata (
                    id, type, image_source, preview_hash, imported_from, locked,
                    created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?,
                    COALESCE((SELECT created_at FROM reference_vibe_metadata WHERE id = ?), ?),
                    ?
                )
            `);
            
            stmt.run(
                vibeId,
                vibeData.type || 'base64',
                vibeData.imageSource || null,
                previewHash,
                vibeData.importedFrom || 0,
                lockedVal,
                vibeId,
                now,
                now
            );
            
            if (vibeData.displayName !== undefined || vibeData.comment !== undefined) {
                const existingMetadata = this.getMetadata(vibeId);
                const metaPatch = {};
                if (vibeData.displayName !== undefined && vibeData.displayName !== null) {
                    const trimmedName = String(vibeData.displayName).trim();
                    if (trimmedName || vibeData.replaceComment) {
                        metaPatch.displayName = trimmedName || null;
                    }
                }
                if (vibeData.comment !== undefined && vibeData.comment !== null && String(vibeData.comment).trim()) {
                    if (!existingMetadata || !existingMetadata.comment || vibeData.replaceComment) {
                        metaPatch.comment = String(vibeData.comment).trim();
                    }
                } else if (vibeData.replaceComment && vibeData.comment === '') {
                    metaPatch.comment = null;
                }
                if (Object.keys(metaPatch).length) {
                    const mergeBase = existingMetadata ? {
                        displayName: existingMetadata.display_name || null,
                        tags: existingMetadata.tags || [],
                        comment: existingMetadata.comment || null,
                        vibeAppendPrompt: existingMetadata.vibe_append_prompt || null,
                        vibeAppendUc: existingMetadata.vibe_append_uc || null,
                        vibePrependPrompt: !!existingMetadata.vibe_prepend_prompt,
                        vibePrependUc: !!existingMetadata.vibe_prepend_uc
                    } : { tags: [] };
                    this.setMetadata(vibeId, { ...mergeBase, ...metaPatch });
                }
            } else if (vibeData.comment !== undefined && vibeData.comment !== null && String(vibeData.comment).trim()) {
                const existingMetadata = this.getMetadata(vibeId);
                if (!existingMetadata || !existingMetadata.comment) {
                    this.setMetadata(vibeId, {
                        comment: vibeData.comment
                    });
                }
            }
            
            // Store encodings in separate table if provided
            if (vibeData.encodings && typeof vibeData.encodings === 'object') {
                this.setVibeEncodings(vibeId, vibeData.encodings);
            }
            
            return this.getVibeMetadata(vibeId);
        } catch (error) {
            console.error('Error setting vibe metadata:', error);
            throw error;
        }
    }

    /**
     * Delete vibe metadata
     * @param {string} vibeId - Vibe ID
     * @returns {boolean} True if deleted
     */
    deleteVibeMetadata(vibeId) {
        try {
            const stmt = this.db.prepare(`DELETE FROM reference_vibe_metadata WHERE id = ?`);
            const result = stmt.run(vibeId);
            return result.changes > 0;
        } catch (error) {
            console.error('Error deleting vibe metadata:', error);
            throw error;
        }
    }

    /**
     * Get vibe metadata for multiple vibes (reconstructs encodings from separate table)
     * @param {Array} vibeIds - Array of vibe IDs
     * @returns {Object} Object with vibe ID as key and metadata as value
     */
    getVibeMetadataForVibes(vibeIds) {
        try {
            if (!vibeIds || vibeIds.length === 0) return {};

            const placeholders = vibeIds.map(() => '?').join(',');
            // JOIN with reference_metadata to get all metadata fields in one query
            const stmt = this.db.prepare(`
                SELECT 
                    vm.*,
                    rm.display_name,
                    rm.tags,
                    rm.comment,
                    rm.vibe_append_prompt,
                    rm.vibe_append_uc,
                    rm.vibe_prepend_prompt,
                    rm.vibe_prepend_uc
                FROM reference_vibe_metadata vm
                LEFT JOIN reference_metadata rm ON rm.hash = vm.id
                WHERE vm.id IN (${placeholders})
            `);
            const results = stmt.all(vibeIds);

            // Load all encodings for these vibes in one query
            const encodingsStmt = this.db.prepare(`
                SELECT vibe_id, model, information_extraction, encoding 
                FROM reference_vibe_encodings 
                WHERE vibe_id IN (${placeholders})
            `);
            const allEncodings = encodingsStmt.all(vibeIds);

            // Build encodings map: { vibeId: { model: { ie: encoding, ... }, ... }, ... }
            const encodingsMap = {};
            for (const enc of allEncodings) {
                if (!encodingsMap[enc.vibe_id]) {
                    encodingsMap[enc.vibe_id] = {};
                }
                if (!encodingsMap[enc.vibe_id][enc.model]) {
                    encodingsMap[enc.vibe_id][enc.model] = {};
                }
                encodingsMap[enc.vibe_id][enc.model][enc.information_extraction.toString()] = enc.encoding;
            }

            const vibeMap = {};
            results.forEach(result => {
                const vibe = {
                    id: result.id,
                    type: result.type,
                    imageSource: result.image_source,
                    previewHash: result.preview_hash,
                    comment: result.comment || null, // From joined reference_metadata
                    importedFrom: result.imported_from || 0,
                    encodings: encodingsMap[result.id] || {},
                    createdAt: result.created_at,
                    updatedAt: result.updated_at,
                    locked: this.computeVibeLocked(result),
                    mtime: result.created_at * 1000,
                    // Include full metadata if it exists
                    metadata: result.display_name || result.tags || result.comment || 
                             result.vibe_append_prompt || result.vibe_append_uc ||
                             result.vibe_prepend_prompt || result.vibe_prepend_uc ? {
                        displayName: result.display_name || null,
                        tags: result.tags ? JSON.parse(result.tags) : [],
                        comment: result.comment || null,
                        vibeAppendPrompt: result.vibe_append_prompt || null,
                        vibeAppendUc: result.vibe_append_uc || null,
                        vibePrependPrompt: !!result.vibe_prepend_prompt,
                        vibePrependUc: !!result.vibe_prepend_uc
                    } : null
                };
                vibeMap[result.id] = vibe;
            });

            return vibeMap;
        } catch (error) {
            console.error('Error getting vibe metadata for vibes:', error.message || String(error));
            return {};
        }
    }

    /**
     * Get vibe metadata for display (with computed fields for client compatibility)
     * @param {string} vibeId - Vibe ID
     * @returns {Object|null} Formatted vibe metadata
     */
    getVibeMetadataForDisplay(vibeId) {
        const vibe = this.getVibeMetadata(vibeId);
        if (!vibe) return null;
        
        // Format for client - extract encoding metadata (model/IE pairs only, no encoding strings)
        const encodingsMetadata = [];
        if (vibe.encodings && typeof vibe.encodings === 'object') {
            for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                if (modelEncodings && typeof modelEncodings === 'object') {
                    for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                        encodingsMetadata.push({
                            model,
                            informationExtraction: parseFloat(extractionValue)
                        });
                    }
                }
            }
        }
        
        return {
            id: vibe.id,
            type: vibe.type,
            source: vibe.imageSource,
            preview: vibe.previewHash ? `${vibe.previewHash}.webp` : null,
            mtime: vibe.mtime,
            encodings: encodingsMetadata,
            comment: vibe.comment,
            importedFrom: vibe.importedFrom === 1 ? 'novelai' : null,
            locked: vibe.locked
        };
    }

    /**
     * Get encoding for specific model and IE (used during image generation)
     * Queries the encodings table directly for better performance
     * @param {string} vibeId - Vibe ID
     * @param {string} model - Model name (case-insensitive)
     * @param {number|string} informationExtraction - IE value (number) or "default" (string) to get first available
     * @returns {string|null} Encoding string or null if not found
     */
    getVibeEncoding(vibeId, model, informationExtraction) {
        try {
            // Handle "default" IE - get first available encoding for this model
            if (informationExtraction === 'default' || informationExtraction === null || informationExtraction === undefined) {
                const defaultStmt = this.db.prepare(`
                    SELECT encoding, information_extraction 
                    FROM reference_vibe_encodings 
                    WHERE vibe_id = ? AND UPPER(model) = UPPER(?)
                    ORDER BY information_extraction ASC
                    LIMIT 1
                `);
                
                const defaultResult = defaultStmt.get(vibeId, model);
                
                if (defaultResult && defaultResult.encoding) {
                    return defaultResult.encoding;
                }
                
                return null;
            }
            
            // Convert to number if it's a string representation of a number
            const ieValue = typeof informationExtraction === 'string' ? parseFloat(informationExtraction) : informationExtraction;
            
            if (isNaN(ieValue)) {
                console.warn(`Invalid IE value: ${informationExtraction}, trying default`);
                // Fall back to default behavior
                return this.getVibeEncoding(vibeId, model, 'default');
            }
            
            // Query specific encoding for this vibe with case-insensitive model matching
            const stmt = this.db.prepare(`
                SELECT encoding FROM reference_vibe_encodings 
                WHERE vibe_id = ? AND UPPER(model) = UPPER(?) AND information_extraction = ?
            `);
            
            const result = stmt.get(vibeId, model, ieValue);
            
            if (result && result.encoding) {
                // Encoding is stored as text, return directly
                return result.encoding;
            }
            
            return null;
        } catch (error) {
            console.error('Error getting vibe encoding:', error);
            return null;
        }
    }

    /**
     * Set encodings for a vibe (replaces all existing encodings)
     * @param {string} vibeId - Vibe ID
     * @param {Object} encodingsObject - Encodings object { model: { ie: encoding, ... }, ... }
     */
    setVibeEncodings(vibeId, encodingsObject) {
        try {
            const now = Math.floor(Date.now() / 1000);
            
            // Delete existing encodings for this vibe
            const deleteStmt = this.db.prepare(`DELETE FROM reference_vibe_encodings WHERE vibe_id = ?`);
            deleteStmt.run(vibeId);
            
            if (!encodingsObject || typeof encodingsObject !== 'object') {
                return; // No encodings to store
            }
            
            // Insert new encodings
            const insertStmt = this.db.prepare(`
                INSERT INTO reference_vibe_encodings (
                    vibe_id, model, information_extraction, encoding, created_at, updated_at
                ) VALUES (?, ?, ?, ?, ?, ?)
            `);
            
            const transaction = this.db.transaction((encodings) => {
                for (const [model, modelEncodings] of Object.entries(encodings)) {
                    if (modelEncodings && typeof modelEncodings === 'object') {
                        for (const [ieStr, encoding] of Object.entries(modelEncodings)) {
                            const ie = parseFloat(ieStr);
                            if (isNaN(ie)) continue;
                            
                            // Extract encoding string (can be a string or object with .encoding property)
                            let encodingString = encoding;
                            if (encoding && typeof encoding === 'object' && encoding.encoding) {
                                encodingString = encoding.encoding;
                            } else if (typeof encoding !== 'string') {
                                // Skip if not a valid encoding
                                continue;
                            }
                            
                            if (encodingString && encodingString.trim()) {
                                insertStmt.run(vibeId, model, ie, encodingString, now, now);
                            }
                        }
                    }
                }
            });
            
            transaction(encodingsObject);
        } catch (error) {
            console.error('Error setting vibe encodings:', error);
            throw error;
        }
    }

    /**
     * Add or update a single encoding for a vibe
     * @param {string} vibeId - Vibe ID
     * @param {string} model - Model name
     * @param {number} informationExtraction - IE value
     * @param {string} encoding - Encoding string
     * @param {Object} [extraMetadata] - Optional extra metadata to update on the vibe (e.g., { comment: '...' })
     */
    setVibeEncoding(vibeId, model, informationExtraction, encoding, extraMetadata = null) {
        try {
            const now = Math.floor(Date.now() / 1000);
            
            // Extract encoding string if it's an object
            let encodingString = encoding;
            if (encoding && typeof encoding === 'object' && encoding.encoding) {
                encodingString = encoding.encoding;
            }
            
            if (!encodingString || typeof encodingString !== 'string' || !encodingString.trim()) {
                throw new Error('Invalid encoding: must be a non-empty string');
            }
            
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO reference_vibe_encodings (
                    vibe_id, model, information_extraction, encoding, created_at, updated_at
                ) VALUES (?, ?, ?, ?, 
                    COALESCE((SELECT created_at FROM reference_vibe_encodings 
                              WHERE vibe_id = ? AND model = ? AND information_extraction = ?), ?),
                    ?
                )
            `);
            
            stmt.run(vibeId, model, informationExtraction, encodingString, vibeId, model, informationExtraction, now, now);
            
            // Update extra metadata if provided (optimized: update directly without fetching full vibe)
            if (extraMetadata && typeof extraMetadata === 'object') {
                // Update comment in reference_metadata if provided
                if (extraMetadata.comment !== undefined && extraMetadata.comment !== null && extraMetadata.comment.trim()) {
                    const existingMetadata = this.getMetadata(vibeId);
                    // Only create metadata entry if one doesn't exist, or if existing one has no comment
                    if (!existingMetadata || !existingMetadata.comment) {
                        this.setMetadata(vibeId, {
                            comment: extraMetadata.comment
                        });
                    }
                }
                // Note: Other metadata fields would need to be handled here if needed
            }
        } catch (error) {
            console.error('Error setting vibe encoding:', error);
            throw error;
        }
    }

    /**
     * Delete a specific encoding for a vibe
     * @param {string} vibeId - Vibe ID
     * @param {string} model - Model name
     * @param {number} informationExtraction - IE value
     * @returns {boolean} True if deleted
     */
    deleteVibeEncoding(vibeId, model, informationExtraction) {
        try {
            const stmt = this.db.prepare(`
                DELETE FROM reference_vibe_encodings 
                WHERE vibe_id = ? AND model = ? AND information_extraction = ?
            `);
            const result = stmt.run(vibeId, model, informationExtraction);
            return result.changes > 0;
        } catch (error) {
            console.error('Error deleting vibe encoding:', error);
            throw error;
        }
    }

    /**
     * Delete all encodings for a vibe
     * @param {string} vibeId - Vibe ID
     * @returns {number} Number of encodings deleted
     */
    deleteAllVibeEncodings(vibeId) {
        try {
            const stmt = this.db.prepare(`DELETE FROM reference_vibe_encodings WHERE vibe_id = ?`);
            const result = stmt.run(vibeId);
            return result.changes;
        } catch (error) {
            console.error('Error deleting all vibe encodings:', error);
            throw error;
        }
    }

    /**
     * Get all vibes sorted by created_at (newest first)
     * @param {number} [limit] - Optional limit
     * @param {number} [offset] - Optional offset
     * @returns {Array} Array of vibe metadata objects
     */
    /**
     * Get all vibe IDs from the database (lightweight - no encodings loaded)
     * @returns {Array} Array of vibe IDs
     */
    getAllVibeIds() {
        try {
            const stmt = this.db.prepare(`SELECT id FROM reference_vibe_metadata`);
            const results = stmt.all();
            return results.map(r => r.id);
        } catch (error) {
            console.error('Error getting all vibe IDs:', error.message || String(error));
            return [];
        }
    }

    getAllVibesSorted(limit = null, offset = 0) {
        try {
            let query = `SELECT * FROM reference_vibe_metadata ORDER BY created_at DESC`;
            
            if (limit !== null) {
                query += ` LIMIT ? OFFSET ?`;
                const stmt = this.db.prepare(query);
                const results = stmt.all(limit, offset);
                return this._formatVibeResults(results);
            } else {
                const stmt = this.db.prepare(query);
                const results = stmt.all();
                return this._formatVibeResults(results);
            }
        } catch (error) {
            console.error('Error getting sorted vibes:', error.message || String(error));
            return [];
        }
    }

    /**
     * Helper to format vibe results (reconstructs encodings from separate table)
     * @private
     */
    _formatVibeResults(results) {
        if (!results || results.length === 0) return [];
        
        // Get all vibe IDs
        const vibeIds = results.map(r => r.id);
        
        // Load all encodings for these vibes in one query
        const placeholders = vibeIds.map(() => '?').join(',');
        const encodingsStmt = this.db.prepare(`
            SELECT vibe_id, model, information_extraction, encoding 
            FROM reference_vibe_encodings 
            WHERE vibe_id IN (${placeholders})
        `);
        const allEncodings = encodingsStmt.all(vibeIds);
        
        // Build encodings map: { vibeId: { model: { ie: encoding, ... }, ... }, ... }
        const encodingsMap = {};
        for (const enc of allEncodings) {
            if (!encodingsMap[enc.vibe_id]) {
                encodingsMap[enc.vibe_id] = {};
            }
            if (!encodingsMap[enc.vibe_id][enc.model]) {
                encodingsMap[enc.vibe_id][enc.model] = {};
            }
            encodingsMap[enc.vibe_id][enc.model][enc.information_extraction.toString()] = enc.encoding;
        }
        
        return results.map(result => {
            const vibe = {
                id: result.id,
                type: result.type,
                imageSource: result.image_source,
                previewHash: result.preview_hash,
                comment: result.comment,
                importedFrom: result.imported_from || 0,
                encodings: encodingsMap[result.id] || {},
                createdAt: result.created_at,
                updatedAt: result.updated_at,
                locked: this.computeVibeLocked(result),
                mtime: result.created_at * 1000
            };
            return vibe;
        });
    }

    // ============================================
    // VIBE WORKSPACE OWNERSHIP METHODS
    // ============================================

    /**
     * Add vibe to workspace
     * @param {string} vibeId - Vibe ID
     * @param {string} workspaceId - Workspace ID
     * @returns {boolean} True if added
     */
    addVibeToWorkspace(vibeId, workspaceId) {
        try {
            // Use INSERT OR REPLACE to ensure the record always exists
            // This updates created_at if record already exists (keeps original if new)
            const stmt = this.db.prepare(`
                INSERT OR REPLACE INTO reference_vibe_workspace_ownership (vibe_id, workspace_id, created_at)
                VALUES (?, ?, COALESCE((SELECT created_at FROM reference_vibe_workspace_ownership WHERE vibe_id = ? AND workspace_id = ?), strftime('%s', 'now')))
            `);
            const result = stmt.run(vibeId, workspaceId, vibeId, workspaceId);
            return result.changes > 0;
        } catch (error) {
            console.error('Error adding vibe to workspace:', error);
            throw error;
        }
    }

    /**
     * Remove vibe from workspace
     * @param {string} vibeId - Vibe ID
     * @param {string} workspaceId - Workspace ID
     * @returns {boolean} True if removed
     */
    removeVibeFromWorkspace(vibeId, workspaceId) {
        try {
            const stmt = this.db.prepare(`DELETE FROM reference_vibe_workspace_ownership WHERE vibe_id = ? AND workspace_id = ?`);
            const result = stmt.run(vibeId, workspaceId);
            return result.changes > 0;
        } catch (error) {
            console.error('Error removing vibe from workspace:', error);
            throw error;
        }
    }

    /**
     * Get all workspace IDs that own a vibe
     * @param {string} vibeId - Vibe ID
     * @returns {Array} Array of workspace IDs
     */
    getVibeWorkspaces(vibeId) {
        try {
            const stmt = this.db.prepare(`SELECT workspace_id FROM reference_vibe_workspace_ownership WHERE vibe_id = ?`);
            const results = stmt.all(vibeId);
            return results.map(r => r.workspace_id);
        } catch (error) {
            console.error('Error getting vibe workspaces:', error);
            return [];
        }
    }

    /**
     * Get workspace ownership for multiple vibes (batch query for performance)
     * @param {Array} vibeIds - Array of vibe IDs
     * @returns {Object} Object with vibe ID as key and array of workspace IDs as value
     */
    getVibeWorkspacesBatch(vibeIds) {
        try {
            if (!vibeIds || vibeIds.length === 0) return {};
            
            const placeholders = vibeIds.map(() => '?').join(',');
            const stmt = this.db.prepare(`SELECT vibe_id, workspace_id FROM reference_vibe_workspace_ownership WHERE vibe_id IN (${placeholders})`);
            const results = stmt.all(vibeIds);
            
            const workspaceMap = {};
            results.forEach(result => {
                if (!workspaceMap[result.vibe_id]) {
                    workspaceMap[result.vibe_id] = [];
                }
                workspaceMap[result.vibe_id].push(result.workspace_id);
            });
            
            return workspaceMap;
        } catch (error) {
            console.error('Error getting vibe workspaces batch:', error);
            return {};
        }
    }

    /**
     * Get all vibes for a workspace
     * @param {string} workspaceId - Workspace ID
     * @returns {Array} Array of vibe IDs
     */
    getWorkspaceVibes(workspaceId) {
        try {
            const stmt = this.db.prepare(`SELECT vibe_id FROM reference_vibe_workspace_ownership WHERE workspace_id = ? ORDER BY created_at DESC`);
            const results = stmt.all(workspaceId);
            return results.map(r => r.vibe_id);
        } catch (error) {
            console.error('Error getting workspace vibes:', error);
            return [];
        }
    }

    /**
     * Get all vibes for multiple workspaces
     * @param {Array} workspaceIds - Array of workspace IDs
     * @returns {Array} Array of vibe IDs
     */
    getMultipleWorkspaceVibes(workspaceIds) {
        try {
            if (!workspaceIds || workspaceIds.length === 0) return [];

            const placeholders = workspaceIds.map(() => '?').join(',');
            const stmt = this.db.prepare(`SELECT DISTINCT vibe_id FROM reference_vibe_workspace_ownership WHERE workspace_id IN (${placeholders}) ORDER BY created_at DESC`);
            const results = stmt.all(workspaceIds);
            return results.map(r => r.vibe_id);
        } catch (error) {
            console.error('Error getting multiple workspace vibes:', error);
            return [];
        }
    }

    /**
     * Lightweight vibe rows for directory listings (no encodings payload).
     * @param {string} workspaceId
     * @returns {Array}
     */
    getWorkspaceVibesListLight(workspaceId) {
        try {
            const stmt = this.db.prepare(`
                SELECT
                    vm.id AS vibe_id,
                    vm.preview_hash,
                    vm.type,
                    vm.updated_at,
                    vm.created_at,
                    rm.display_name
                FROM reference_vibe_workspace_ownership vwo
                INNER JOIN reference_vibe_metadata vm ON vm.id = vwo.vibe_id
                LEFT JOIN reference_metadata rm ON rm.hash = vm.id
                WHERE vwo.workspace_id = ?
                ORDER BY vwo.created_at DESC
            `);
            return stmt.all(workspaceId);
        } catch (error) {
            console.error('Error getting workspace vibes list:', error);
            return [];
        }
    }

    /**
     * Get all vibe IDs that use a specific cache hash as their image source
     * Used for converting vibes to base64 before deleting cache files
     * @param {string} cacheHash - Cache file hash
     * @returns {Array} Array of vibe IDs
     */
    getVibesByImageSource(cacheHash) {
        try {
            const stmt = this.db.prepare(`
                SELECT id FROM reference_vibe_metadata 
                WHERE type = 'cache' AND image_source = ?
            `);
            const results = stmt.all(cacheHash);
            return results.map(r => r.id);
        } catch (error) {
            console.error('Error getting vibes by image source:', error);
            return [];
        }
    }

    /**
     * Get workspace references with cache data and workspace ownership in one optimized query
     * This combines getWorkspaceReferences, getFileCacheForReferences, and getReferenceWorkspacesBatch
     * @param {string|Array} workspaceIdOrIds - Single workspace ID or array of workspace IDs
     * @returns {Object} Object with hash as key and object containing cache data and workspaces array
     */
    getWorkspaceReferencesWithData(workspaceIdOrIds) {
        try {
            const isArray = Array.isArray(workspaceIdOrIds);
            const workspaceIds = isArray ? workspaceIdOrIds : [workspaceIdOrIds];
            
            if (workspaceIds.length === 0) return {};

            const placeholders = workspaceIds.map(() => '?').join(',');
            
            // Single JOIN query to get cache data, metadata, and workspace ownership
            const stmt = this.db.prepare(`
                SELECT 
                    wo.hash,
                    wo.workspace_id,
                    wo.created_at as ownership_created_at,
                    fc.size,
                    fc.cached_at,
                    fc.updated_at,
                    rm.display_name,
                    rm.tags,
                    rm.comment,
                    rm.vibe_append_prompt,
                    rm.vibe_append_uc,
                    rm.vibe_prepend_prompt,
                    rm.vibe_prepend_uc
                FROM reference_workspace_ownership wo
                INNER JOIN reference_file_cache fc ON fc.hash = wo.hash
                LEFT JOIN reference_metadata rm ON rm.hash = wo.hash
                WHERE wo.workspace_id IN (${placeholders})
                ORDER BY wo.created_at DESC
            `);
            
            const results = stmt.all(workspaceIds);
            
            // Group by hash and build result structure
            const resultMap = {};
            results.forEach(row => {
                if (!resultMap[row.hash]) {
                    resultMap[row.hash] = {
                        hash: row.hash,
                        size: row.size,
                        cachedAt: row.cached_at,
                        updatedAt: row.updated_at,
                        workspaces: [],
                        metadata: row.display_name || row.tags || row.comment || 
                                 row.vibe_append_prompt || row.vibe_append_uc ||
                                 row.vibe_prepend_prompt || row.vibe_prepend_uc ? {
                            displayName: row.display_name || null,
                            tags: row.tags ? JSON.parse(row.tags) : [],
                            comment: row.comment || null,
                            vibeAppendPrompt: row.vibe_append_prompt || null,
                            vibeAppendUc: row.vibe_append_uc || null,
                            vibePrependPrompt: !!row.vibe_prepend_prompt,
                            vibePrependUc: !!row.vibe_prepend_uc
                        } : null
                    };
                }
                resultMap[row.hash].workspaces.push(row.workspace_id);
            });
            
            return resultMap;
        } catch (error) {
            console.error('Error getting workspace references with data:', error);
            return {};
        }
    }

    /**
     * Get workspace vibes with metadata and workspace ownership in one optimized query
     * This combines getWorkspaceVibes, getVibeMetadataForVibes, and getVibeWorkspacesBatch
     * @param {string|Array} workspaceIdOrIds - Single workspace ID or array of workspace IDs
     * @returns {Object} Object with vibe ID as key and object containing vibe data and workspaces array
     */
    getWorkspaceVibesWithData(workspaceIdOrIds) {
        try {
            const isArray = Array.isArray(workspaceIdOrIds);
            const workspaceIds = isArray ? workspaceIdOrIds : [workspaceIdOrIds];
            
            if (workspaceIds.length === 0) return {};

            const placeholders = workspaceIds.map(() => '?').join(',');
            
            // Single JOIN query to get vibe metadata and workspace ownership
            const stmt = this.db.prepare(`
                SELECT 
                    vwo.vibe_id,
                    vwo.workspace_id,
                    vwo.created_at as ownership_created_at,
                    vm.type,
                    vm.image_source,
                    vm.preview_hash,
                    vm.imported_from,
                    vm.created_at,
                    vm.updated_at,
                    rm.display_name,
                    rm.tags,
                    rm.comment,
                    rm.vibe_append_prompt,
                    rm.vibe_append_uc,
                    rm.vibe_prepend_prompt,
                    rm.vibe_prepend_uc
                FROM reference_vibe_workspace_ownership vwo
                INNER JOIN reference_vibe_metadata vm ON vm.id = vwo.vibe_id
                LEFT JOIN reference_metadata rm ON rm.hash = vm.id
                WHERE vwo.workspace_id IN (${placeholders})
                ORDER BY vwo.created_at DESC
            `);
            
            const results = stmt.all(workspaceIds);
            
            // Get all unique vibe IDs to load encodings in one batch
            const uniqueVibeIds = [...new Set(results.map(r => r.vibe_id))];
            const encodingsMap = {};
            if (uniqueVibeIds.length > 0) {
                const encPlaceholders = uniqueVibeIds.map(() => '?').join(',');
                const encStmt = this.db.prepare(`
                    SELECT vibe_id, model, information_extraction, encoding 
                    FROM reference_vibe_encodings 
                    WHERE vibe_id IN (${encPlaceholders})
                `);
                const encodings = encStmt.all(uniqueVibeIds);
                
                encodings.forEach(enc => {
                    if (!encodingsMap[enc.vibe_id]) {
                        encodingsMap[enc.vibe_id] = {};
                    }
                    if (!encodingsMap[enc.vibe_id][enc.model]) {
                        encodingsMap[enc.vibe_id][enc.model] = {};
                    }
                    encodingsMap[enc.vibe_id][enc.model][enc.information_extraction.toString()] = enc.encoding;
                });
            }
            
            // Group by vibe_id and build result structure
            const resultMap = {};
            results.forEach(row => {
                if (!resultMap[row.vibe_id]) {
                    resultMap[row.vibe_id] = {
                        id: row.vibe_id,
                        type: row.type,
                        imageSource: row.image_source,
                        previewHash: row.preview_hash,
                        comment: row.comment || null,
                        importedFrom: row.imported_from || 0, // Keep as number, will be converted in handler
                        encodings: encodingsMap[row.vibe_id] || {},
                        createdAt: row.created_at,
                        updatedAt: row.updated_at,
                        locked: this.computeVibeLocked(row),
                        mtime: row.created_at * 1000,
                        workspaces: [],
                        metadata: row.display_name || row.tags || row.comment || 
                                 row.vibe_append_prompt || row.vibe_append_uc ||
                                 row.vibe_prepend_prompt || row.vibe_prepend_uc ? {
                            displayName: row.display_name || null,
                            tags: row.tags ? JSON.parse(row.tags) : [],
                            comment: row.comment || null,
                            vibeAppendPrompt: row.vibe_append_prompt || null,
                            vibeAppendUc: row.vibe_append_uc || null,
                            vibePrependPrompt: !!row.vibe_prepend_prompt,
                            vibePrependUc: !!row.vibe_prepend_uc
                        } : null
                    };
                }
                resultMap[row.vibe_id].workspaces.push(row.workspace_id);
            });
            
            return resultMap;
        } catch (error) {
            console.error('Error getting workspace vibes with data:', error);
            return {};
        }
    }

    /**
     * Get both workspace references (cache files) and vibes with metadata in parallel
     * This combines getWorkspaceReferencesWithData and getWorkspaceVibesWithData into a single call
     * @param {string|Array} workspaceIdOrIds - Single workspace ID or array of workspace IDs
     * @returns {Object} Object with 'cacheFiles' and 'vibes' keys, each containing the respective result maps
     */
    getWorkspaceReferencesAndVibesWithData(workspaceIdOrIds) {
        try {
            // Execute both queries in parallel (they're independent)
            const cacheFiles = this.getWorkspaceReferencesWithData(workspaceIdOrIds);
            const vibes = this.getWorkspaceVibesWithData(workspaceIdOrIds);
            
            return {
                cacheFiles,
                vibes
            };
        } catch (error) {
            console.error('Error getting workspace references and vibes with data:', error);
            return {
                cacheFiles: {},
                vibes: {}
            };
        }
    }

    /**
     * Bulk add vibes to workspace
     * @param {Array} vibeIds - Array of vibe IDs
     * @param {string} workspaceId - Workspace ID
     * @returns {number} Number of vibes added
     */
    bulkAddVibesToWorkspace(vibeIds, workspaceId) {
        try {
            if (!vibeIds || vibeIds.length === 0) return 0;

            const stmt = this.db.prepare(`INSERT OR IGNORE INTO reference_vibe_workspace_ownership (vibe_id, workspace_id) VALUES (?, ?)`);
            const transaction = this.db.transaction((vibeList) => {
                let count = 0;
                for (const vibeId of vibeList) {
                    if (stmt.run(vibeId, workspaceId).changes > 0) count++;
                }
                return count;
            });

            return transaction(vibeIds);
        } catch (error) {
            console.error('Error bulk adding vibes to workspace:', error);
            throw error;
        }
    }

    /**
     * Move all references from one workspace to another
     * @param {string} sourceWorkspaceId - Source workspace ID
     * @param {string} targetWorkspaceId - Target workspace ID
     * @returns {number} Number of references moved
     */
    moveAllReferencesBetweenWorkspaces(sourceWorkspaceId, targetWorkspaceId) {
        try {
            // Get all references in source workspace
            const references = this.getWorkspaceReferences(sourceWorkspaceId);
            if (references.length === 0) return 0;

            // Remove from source and add to target in a transaction
            const removeStmt = this.db.prepare(`DELETE FROM reference_workspace_ownership WHERE hash = ? AND workspace_id = ?`);
            const addStmt = this.db.prepare(`INSERT OR IGNORE INTO reference_workspace_ownership (hash, workspace_id) VALUES (?, ?)`);
            
            const transaction = this.db.transaction((refList) => {
                let moved = 0;
                for (const hash of refList) {
                    // Remove from source
                    removeStmt.run(hash, sourceWorkspaceId);
                    // Add to target (will ignore if already exists)
                    if (addStmt.run(hash, targetWorkspaceId).changes > 0) {
                        moved++;
                    }
                }
                return moved;
            });

            return transaction(references);
        } catch (error) {
            console.error('Error moving references between workspaces:', error);
            throw error;
        }
    }

    /**
     * Move all vibes from one workspace to another
     * @param {string} sourceWorkspaceId - Source workspace ID
     * @param {string} targetWorkspaceId - Target workspace ID
     * @returns {number} Number of vibes moved
     */
    moveAllVibesBetweenWorkspaces(sourceWorkspaceId, targetWorkspaceId) {
        try {
            // Get all vibes in source workspace
            const vibes = this.getWorkspaceVibes(sourceWorkspaceId);
            if (vibes.length === 0) return 0;

            // Remove from source and add to target in a transaction
            const removeStmt = this.db.prepare(`DELETE FROM reference_vibe_workspace_ownership WHERE vibe_id = ? AND workspace_id = ?`);
            const addStmt = this.db.prepare(`INSERT OR IGNORE INTO reference_vibe_workspace_ownership (vibe_id, workspace_id) VALUES (?, ?)`);
            
            const transaction = this.db.transaction((vibeList) => {
                let moved = 0;
                for (const vibeId of vibeList) {
                    // Remove from source
                    removeStmt.run(vibeId, sourceWorkspaceId);
                    // Add to target (will ignore if already exists)
                    if (addStmt.run(vibeId, targetWorkspaceId).changes > 0) {
                        moved++;
                    }
                }
                return moved;
            });

            return transaction(vibes);
        } catch (error) {
            console.error('Error moving vibes between workspaces:', error);
            throw error;
        }
    }

    /**
     * Close the database connection
     */
    getCheckpointManager() {
        return this.checkpointManager || null;
    }

    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = ReferenceMetadataDatabase;
