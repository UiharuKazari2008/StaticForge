const Database = require('better-sqlite3');
const path = require('path');
const fs = require('fs');
const logger = require('./logger');

class ReferenceMetadataDatabase {
    constructor() {
        this.db = null;
        this.dbPath = path.join(__dirname, '..', '.cache', 'reference_metadata.db');
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
     * Delete metadata for a reference
     * @param {string} hash - Reference hash
     * @returns {boolean} True if deleted, false if not found
     */
    deleteMetadata(hash) {
        try {
            const stmt = this.db.prepare(`
                DELETE FROM reference_metadata 
                WHERE hash = ?
            `);
            
            const result = stmt.run(hash);
            return result.changes > 0;
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

    /**
     * Close the database connection
     */
    close() {
        if (this.db) {
            this.db.close();
            this.db = null;
        }
    }
}

module.exports = ReferenceMetadataDatabase;
