/**
 * Async SQLite Wrapper
 * 
 * Provides async, non-blocking SQLite database operations with:
 * - Dirty state tracking (marks database as dirty on writes)
 * - Idle timeout (unloads database after X minutes of inactivity)
 * - Automatic checkpoint manager integration
 * - Connection pooling and management
 */

const sqlite3 = require('sqlite3');
const { open } = require('sqlite');
const path = require('path');
const fs = require('fs');
const { createDatabaseCheckpointManager } = require('./databaseCheckpoint');

/**
 * Async SQLite Database Wrapper
 */
class AsyncSQLiteDatabase {
    /**
     * @param {string} dbPath - Path to database file
     * @param {Object} options - Configuration options
     * @param {number} options.idleTimeoutMinutes - Minutes of inactivity before unloading (default: 30)
     * @param {number} options.maxCheckpoints - Maximum checkpoints to keep (default: 5)
     * @param {boolean} options.enableCheckpointing - Enable checkpoint manager (default: true)
     * @param {Object} options.pragma - SQLite PRAGMA settings
     */
    constructor(dbPath, options = {}) {
        this.dbPath = dbPath;
        this.idleTimeoutMinutes = options.idleTimeoutMinutes || 30;
        this.maxCheckpoints = options.maxCheckpoints || 5;
        this.enableCheckpointing = options.enableCheckpointing !== false;
        this.pragma = options.pragma || {};
        
        // State management
        this.db = null;
        this.isOpen = false;
        this.isDirty = false;
        this.lastAccessTime = null;
        this.idleTimer = null;
        this.checkpointManager = null;
        this.isCheckpointing = false; // Lock to prevent concurrent checkpoints
        this.checkpointQueue = []; // Queue of promises waiting for checkpoint to complete
        this.wasUnloaded = false; // Track if database was unloaded due to idle timeout
        this.activeOperations = 0; // Track number of active database operations
        
        // Ensure directory exists
        const dbDir = path.dirname(dbPath);
        if (!fs.existsSync(dbDir)) {
            fs.mkdirSync(dbDir, { recursive: true });
        }
        
        // Initialize checkpoint manager if enabled
        if (this.enableCheckpointing) {
            this.checkpointManager = createDatabaseCheckpointManager(dbPath, this.maxCheckpoints);
            // Link wrapper to checkpoint manager so it can check if database is open
            this.checkpointManager.dbWrapper = this;
        }
    }
    
    /**
     * Open database connection (lazy loading)
     * Waits if checkpoint is in progress
     * @returns {Promise<void>}
     */
    async open() {
        // Wait for any in-progress checkpoint to complete
        if (this.isCheckpointing) {
            await this.waitForCheckpoint();
        }
        
        if (this.isOpen && this.db) {
            this.updateAccessTime();
            return;
        }
        
        try {
            // Open database with sqlite3 driver
            this.db = await open({
                filename: this.dbPath,
                driver: sqlite3.Database
            });
            
            // Apply PRAGMA settings
            await this.applyPragmaSettings();
            
            this.isOpen = true;
            this.updateAccessTime();
            this.startIdleTimer();
            
            // Log if we're reopening a database that was previously unloaded due to idle timeout
            if (this.wasUnloaded) {
                console.log(`🔓 Reopening database: ${path.basename(this.dbPath)}`);
                this.wasUnloaded = false; // Reset flag
            }
            
            return this.db;
        } catch (error) {
            this.isOpen = false;
            this.db = null;
            throw new Error(`Failed to open database ${this.dbPath}: ${error.message}`);
        }
    }
    
    /**
     * Wait for checkpoint to complete
     * @private
     */
    async waitForCheckpoint() {
        return new Promise((resolve) => {
            this.checkpointQueue.push(resolve);
        });
    }
    
    /**
     * Notify waiting operations that checkpoint is complete
     * @private
     */
    notifyCheckpointComplete() {
        const queue = [...this.checkpointQueue];
        this.checkpointQueue = [];
        queue.forEach(resolve => resolve());
    }
    
    /**
     * Apply SQLite PRAGMA settings
     * @private
     */
    async applyPragmaSettings() {
        const defaultPragma = {
            journal_mode: 'WAL',
            synchronous: 'NORMAL',
            cache_size: 10000,
            temp_store: 'MEMORY'
        };
        
        const pragma = { ...defaultPragma, ...this.pragma };
        
        for (const [key, value] of Object.entries(pragma)) {
            try {
                await this.db.exec(`PRAGMA ${key} = ${value}`);
            } catch (error) {
                console.warn(`⚠️ Failed to set PRAGMA ${key} = ${value}:`, error.message);
            }
        }
    }
    
    /**
     * Initialize database (alias for open() for compatibility)
     * @returns {Promise<void>}
     */
    async initialize() {
        return await this.open();
    }
    
    /**
     * Close database connection
     * Handles SQLITE_BUSY errors gracefully by retrying with a short delay
     * @returns {Promise<void>}
     */
    async close() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
            this.idleTimer = null;
        }
        
        if (this.db) {
            try {
                await this.db.close();
            } catch (error) {
                // If we get SQLITE_BUSY, wait a bit and retry once
                if (error.code === 'SQLITE_BUSY' || error.message?.includes('SQLITE_BUSY')) {
                    console.warn(`⚠️ Database busy during close, retrying: ${path.basename(this.dbPath)}`);
                    // Wait 100ms and try once more
                    await new Promise(resolve => setTimeout(resolve, 100));
                    try {
                        await this.db.close();
                    } catch (retryError) {
                        console.warn(`⚠️ Error closing database ${path.basename(this.dbPath)} after retry:`, retryError.message);
                    }
                } else {
                    console.warn(`⚠️ Error closing database ${path.basename(this.dbPath)}:`, error.message);
                }
            }
            this.db = null;
        }
        
        this.isOpen = false;
        this.lastAccessTime = null;
    }
    
    /**
     * Update last access time and restart idle timer
     * @private
     */
    updateAccessTime() {
        this.lastAccessTime = Date.now();
        this.startIdleTimer();
    }
    
    /**
     * Start idle timeout timer
     * @private
     */
    startIdleTimer() {
        if (this.idleTimer) {
            clearTimeout(this.idleTimer);
        }
        
        if (this.idleTimeoutMinutes > 0) {
            this.idleTimer = setTimeout(async () => {
                await this.handleIdleTimeout();
            }, this.idleTimeoutMinutes * 60 * 1000);
        }
    }
    
    /**
     * Handle idle timeout - checkpoint if dirty, then unload
     * @private
     */
    async handleIdleTimeout() {
        if (!this.isOpen || !this.db) {
            return;
        }
        
        // Don't close if there are active operations
        if (this.activeOperations > 0) {
            console.log(`⏸️ Skipping idle timeout, ${this.activeOperations} active operations: ${path.basename(this.dbPath)}`);
            // Restart the timer to check again later
            this.startIdleTimer();
            return;
        }
        
        // If database is dirty, create checkpoint before unloading
        if (this.isDirty && this.checkpointManager) {
            console.log(`💾 Creating checkpoint before idle shutdown: ${path.basename(this.dbPath)}`);
            try {
                await this.createCheckpointIfDirty();
            } catch (error) {
                console.error(`❌ Error creating checkpoint before idle shutdown: ${error.message}`);
                // Continue with shutdown anyway - checkpoint will be created later
            }
        }
        
        // Database is now clean (or checkpoint failed) - safe to unload
        console.log(`💤 Unloading idle database: ${path.basename(this.dbPath)}`);
        this.wasUnloaded = true; // Mark that we're unloading due to idle timeout
        await this.close();
    }
    
    /**
     * Mark database as dirty (write occurred)
     * @private
     */
    markDirty() {
        this.isDirty = true;
        this.updateAccessTime();
    }
    
    /**
     * Mark database as clean (after checkpoint)
     * @private
     */
    markClean() {
        this.isDirty = false;
    }
    
    /**
     * Get checkpoint manager
     * @returns {DatabaseCheckpointManager|null}
     */
    getCheckpointManager() {
        return this.checkpointManager;
    }
    
    /**
     * Check if database is dirty
     * @returns {boolean}
     */
    isDirtyState() {
        return this.isDirty;
    }
    
    /**
     * Check if database is open (not idle/closed)
     * @returns {boolean}
     */
    isOpenState() {
        return this.isOpen && this.db !== null;
    }
    
    /**
     * Execute SQL statement (non-query)
     * @param {string} sql - SQL statement
     * @param {Array} params - Parameters
     * @returns {Promise<{lastID: number, changes: number}>}
     */
    async run(sql, params = []) {
        await this.open();
        this.activeOperations++;
        
        try {
            const result = await this.db.run(sql, params);
            if (result.changes > 0) {
                this.markDirty();
            }
            return {
                lastID: result.lastID,
                changes: result.changes
            };
        } catch (error) {
            // Handle SQLITE_MISUSE (database handle is closed) by reopening and retrying
            // This is a safety net - activeOperations should prevent this, but handle it just in case
            if (error.message?.includes('SQLITE_MISUSE') || error.message?.includes('Database handle is closed')) {
                console.warn(`⚠️ Database handle closed during execution, reopening: ${path.basename(this.dbPath)}`);
                // Reset state and reopen
                this.isOpen = false;
                this.db = null;
                await this.open();
                // Retry the execution
                const result = await this.db.run(sql, params);
                if (result.changes > 0) {
                    this.markDirty();
                }
                return {
                    lastID: result.lastID,
                    changes: result.changes
                };
            }
            throw new Error(`SQL execution failed: ${error.message}`);
        } finally {
            this.activeOperations--;
        }
    }
    
    /**
     * Execute SQL and return first row
     * @param {string} sql - SQL statement
     * @param {Array} params - Parameters
     * @returns {Promise<Object|null>}
     */
    async get(sql, params = []) {
        await this.open();
        this.updateAccessTime();
        this.activeOperations++;
        
        try {
            return await this.db.get(sql, params);
        } catch (error) {
            // Handle SQLITE_MISUSE (database handle is closed) by reopening and retrying
            // This is a safety net - activeOperations should prevent this, but handle it just in case
            if (error.message?.includes('SQLITE_MISUSE') || error.message?.includes('Database handle is closed')) {
                console.warn(`⚠️ Database handle closed during query, reopening: ${path.basename(this.dbPath)}`);
                // Reset state and reopen
                this.isOpen = false;
                this.db = null;
                await this.open();
                // Retry the query
                return await this.db.get(sql, params);
            }
            throw new Error(`SQL query failed: ${error.message}`);
        } finally {
            this.activeOperations--;
        }
    }
    
    /**
     * Execute SQL and return all rows
     * @param {string} sql - SQL statement
     * @param {Array} params - Parameters
     * @returns {Promise<Array>}
     */
    async all(sql, params = []) {
        await this.open();
        this.updateAccessTime();
        this.activeOperations++;
        
        try {
            return await this.db.all(sql, params);
        } catch (error) {
            // Handle SQLITE_MISUSE (database handle is closed) by reopening and retrying
            // This is a safety net - activeOperations should prevent this, but handle it just in case
            if (error.message?.includes('SQLITE_MISUSE') || error.message?.includes('Database handle is closed')) {
                console.warn(`⚠️ Database handle closed during query, reopening: ${path.basename(this.dbPath)}`);
                // Reset state and reopen
                this.isOpen = false;
                this.db = null;
                await this.open();
                // Retry the query
                return await this.db.all(sql, params);
            }
            throw new Error(`SQL query failed: ${error.message}`);
        } finally {
            this.activeOperations--;
        }
    }
    
    /**
     * Execute multiple SQL statements
     * @param {string} sql - SQL statements (semicolon-separated)
     * @returns {Promise<void>}
     */
    async exec(sql) {
        await this.open();
        const signatureBefore = this.checkpointManager
            ? this.checkpointManager.getDatabaseSignature()
            : null;
        this.activeOperations++;
        
        try {
            await this.db.exec(sql);
            if (this.checkpointManager && signatureBefore) {
                const signatureAfter = this.checkpointManager.getDatabaseSignature();
                if (!this.checkpointManager.signaturesEqual(signatureBefore, signatureAfter)) {
                    this.markDirty();
                }
            }
        } catch (error) {
            // Handle SQLITE_MISUSE (database handle is closed) by reopening and retrying
            // This is a safety net - activeOperations should prevent this, but handle it just in case
            if (error.message?.includes('SQLITE_MISUSE') || error.message?.includes('Database handle is closed')) {
                console.warn(`⚠️ Database handle closed during exec, reopening: ${path.basename(this.dbPath)}`);
                // Reset state and reopen
                this.isOpen = false;
                this.db = null;
                await this.open();
                const retrySignatureBefore = this.checkpointManager
                    ? this.checkpointManager.getDatabaseSignature()
                    : null;
                // Retry the execution
                await this.db.exec(sql);
                if (this.checkpointManager && retrySignatureBefore) {
                    const signatureAfter = this.checkpointManager.getDatabaseSignature();
                    if (!this.checkpointManager.signaturesEqual(retrySignatureBefore, signatureAfter)) {
                        this.markDirty();
                    }
                }
                return;
            }
            throw new Error(`SQL execution failed: ${error.message}`);
        } finally {
            this.activeOperations--;
        }
    }
    
    /**
     * Prepare a statement for reuse
     * @param {string} sql - SQL statement
     * @returns {Promise<PreparedStatement>}
     */
    async prepare(sql) {
        await this.open();
        this.updateAccessTime();
        this.activeOperations++;
        
        try {
            return await this.db.prepare(sql);
        } catch (error) {
            // Handle SQLITE_MISUSE (database handle is closed) by reopening and retrying
            // This is a safety net - activeOperations should prevent this, but handle it just in case
            if (error.message?.includes('SQLITE_MISUSE') || error.message?.includes('Database handle is closed')) {
                console.warn(`⚠️ Database handle closed during prepare, reopening: ${path.basename(this.dbPath)}`);
                // Reset state and reopen
                this.isOpen = false;
                this.db = null;
                await this.open();
                this.updateAccessTime();
                // Retry the prepare
                return await this.db.prepare(sql);
            }
            throw new Error(`SQL prepare failed: ${error.message}`);
        } finally {
            this.activeOperations--;
        }
    }
    
    /**
     * Get PRAGMA value
     * @param {string} pragmaName - PRAGMA name
     * @returns {Promise<any>}
     */
    async pragma(pragmaName) {
        await this.open();
        this.updateAccessTime();
        this.activeOperations++;
        
        try {
            const result = await this.db.get(`PRAGMA ${pragmaName}`);
            // PRAGMA results can be objects or single values
            if (result && typeof result === 'object') {
                const keys = Object.keys(result);
                if (keys.length === 1) {
                    return result[keys[0]];
                }
                return result;
            }
            return result;
        } catch (error) {
            // Handle SQLITE_MISUSE (database handle is closed) by reopening and retrying
            // This is a safety net - activeOperations should prevent this, but handle it just in case
            if (error.message?.includes('SQLITE_MISUSE') || error.message?.includes('Database handle is closed')) {
                console.warn(`⚠️ Database handle closed during pragma, reopening: ${path.basename(this.dbPath)}`);
                // Reset state and reopen
                this.isOpen = false;
                this.db = null;
                await this.open();
                this.updateAccessTime();
                // Retry the pragma query
                const result = await this.db.get(`PRAGMA ${pragmaName}`);
                // PRAGMA results can be objects or single values
                if (result && typeof result === 'object') {
                    const keys = Object.keys(result);
                    if (keys.length === 1) {
                        return result[keys[0]];
                    }
                    return result;
                }
                return result;
            }
            throw new Error(`PRAGMA query failed: ${error.message}`);
        } finally {
            this.activeOperations--;
        }
    }
    
    /**
     * Set PRAGMA value
     * @param {string} pragmaName - PRAGMA name
     * @param {any} value - PRAGMA value
     * @returns {Promise<void>}
     */
    async setPragma(pragmaName, value) {
        await this.open();
        this.updateAccessTime();
        this.activeOperations++;
        
        try {
            await this.db.exec(`PRAGMA ${pragmaName} = ${value}`);
        } catch (error) {
            // Handle SQLITE_MISUSE (database handle is closed) by reopening and retrying
            // This is a safety net - activeOperations should prevent this, but handle it just in case
            if (error.message?.includes('SQLITE_MISUSE') || error.message?.includes('Database handle is closed')) {
                console.warn(`⚠️ Database handle closed during setPragma, reopening: ${path.basename(this.dbPath)}`);
                // Reset state and reopen
                this.isOpen = false;
                this.db = null;
                await this.open();
                this.updateAccessTime();
                // Retry the pragma set
                await this.db.exec(`PRAGMA ${pragmaName} = ${value}`);
                return;
            }
            throw new Error(`PRAGMA set failed: ${error.message}`);
        } finally {
            this.activeOperations--;
        }
    }
    
    /**
     * Create checkpoint if database is dirty
     * Blocks other operations while checkpointing
     * @returns {Promise<boolean>} True if checkpoint was created
     */
    async createCheckpointIfDirty() {
        if (!this.checkpointManager || !this.isDirty) {
            return false;
        }

        if (!this.checkpointManager.needsCheckpoint({ dirty: true, force: false })) {
            this.markClean();
            return false;
        }
        
        // Prevent concurrent checkpoints
        if (this.isCheckpointing) {
            await this.waitForCheckpoint();
            return false; // Another checkpoint already in progress
        }
        
        this.isCheckpointing = true;
        
        try {
            // Ensure database is open for backup
            if (!this.isOpen || !this.db) {
                await this.open();
            }
            
            // First, checkpoint WAL to ensure all changes are in main database
            // This merges WAL changes into the main database file, making it safe to copy
            try {
                await this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
            } catch (walError) {
                // WAL checkpoint may fail if not in WAL mode, that's okay
                console.warn(`⚠️ WAL checkpoint warning: ${walError.message}`);
            }
            
            // Generate checkpoint filename and path (same dir as DatabaseCheckpointManager)
            const checkpointFilename = this.checkpointManager.generateCheckpointFilename();
            const checkpointDir = this.checkpointManager.checkpointDir;
            const checkpointPath = path.join(checkpointDir, checkpointFilename);

            if (!fs.existsSync(checkpointDir)) {
                fs.mkdirSync(checkpointDir, { recursive: true });
            }

            // After WAL checkpoint, the database is in a consistent state
            // We can safely copy the database file directly without needing the backup API
            // This avoids connection management issues entirely
            if (!fs.existsSync(this.dbPath)) {
                throw new Error(`Database file does not exist: ${this.dbPath}`);
            }

            // Copy the main database file
            fs.copyFileSync(this.dbPath, checkpointPath);

            // Also copy WAL and SHM files if they exist (though they should be empty after checkpoint)
            const walPath = this.dbPath + '-wal';
            const shmPath = this.dbPath + '-shm';
            const checkpointWalPath = checkpointPath + '-wal';
            const checkpointShmPath = checkpointPath + '-shm';

            if (fs.existsSync(walPath)) {
                try {
                    fs.copyFileSync(walPath, checkpointWalPath);
                } catch (walCopyError) {
                    // WAL file might be locked, that's okay since we checkpointed
                    console.warn(`⚠️ Could not copy WAL file: ${walCopyError.message}`);
                }
            }

            if (fs.existsSync(shmPath)) {
                try {
                    fs.copyFileSync(shmPath, checkpointShmPath);
                } catch (shmCopyError) {
                    // SHM file might be locked, that's okay
                    console.warn(`⚠️ Could not copy SHM file: ${shmCopyError.message}`);
                }
            }

            // Update checkpoint manager signature
            const currentSignature = this.checkpointManager.getDatabaseSignature();
            this.checkpointManager.lastCheckpointSignature = currentSignature;
            this.checkpointManager.cleanupOldCheckpoints();

            this.markClean();
            console.log(`✅ Created database checkpoint: ${checkpointFilename}`);
            return true;
        } catch (error) {
            console.error(`❌ Error creating checkpoint for ${path.basename(this.dbPath)}:`, error);
            return false;
        } finally {
            this.isCheckpointing = false;
            this.notifyCheckpointComplete();
        }
    }

    /**
     * Force checkpoint creation (even if not dirty)
     * Blocks other operations while checkpointing
     * @returns {Promise<boolean>} True if checkpoint was created
     */
    async createCheckpoint() {
        if (!this.checkpointManager) {
            return false;
        }
        
        // Prevent concurrent checkpoints
        if (this.isCheckpointing) {
            await this.waitForCheckpoint();
            return false; // Another checkpoint already in progress
        }
        
        this.isCheckpointing = true;
        
        try {
            await this.open();
            
            // First, checkpoint WAL to ensure all changes are in main database
            // This merges WAL changes into the main database file, making it safe to copy
            try {
                await this.db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
            } catch (walError) {
                // WAL checkpoint may fail if not in WAL mode, that's okay
                console.warn(`⚠️ WAL checkpoint warning: ${walError.message}`);
            }
            
            // Generate checkpoint filename and path (same dir as DatabaseCheckpointManager)
            const checkpointFilename = this.checkpointManager.generateCheckpointFilename();
            const checkpointDir = this.checkpointManager.checkpointDir;
            const checkpointPath = path.join(checkpointDir, checkpointFilename);

            if (!fs.existsSync(checkpointDir)) {
                fs.mkdirSync(checkpointDir, { recursive: true });
            }

            // After WAL checkpoint, the database is in a consistent state
            // We can safely copy the database file directly without needing the backup API
            // This avoids connection management issues entirely
            if (!fs.existsSync(this.dbPath)) {
                throw new Error(`Database file does not exist: ${this.dbPath}`);
            }

            // Copy the main database file
            fs.copyFileSync(this.dbPath, checkpointPath);

            // Also copy WAL and SHM files if they exist (though they should be empty after checkpoint)
            const walPath = this.dbPath + '-wal';
            const shmPath = this.dbPath + '-shm';
            const checkpointWalPath = checkpointPath + '-wal';
            const checkpointShmPath = checkpointPath + '-shm';

            if (fs.existsSync(walPath)) {
                try {
                    fs.copyFileSync(walPath, checkpointWalPath);
                } catch (walCopyError) {
                    // WAL file might be locked, that's okay since we checkpointed
                    console.warn(`⚠️ Could not copy WAL file: ${walCopyError.message}`);
                }
            }

            if (fs.existsSync(shmPath)) {
                try {
                    fs.copyFileSync(shmPath, checkpointShmPath);
                } catch (shmCopyError) {
                    // SHM file might be locked, that's okay
                    console.warn(`⚠️ Could not copy SHM file: ${shmCopyError.message}`);
                }
            }

            // Update checkpoint manager signature
            const currentSignature = this.checkpointManager.getDatabaseSignature();
            this.checkpointManager.lastCheckpointSignature = currentSignature;
            this.checkpointManager.cleanupOldCheckpoints();

            this.markClean();
            console.log(`✅ Created database checkpoint: ${checkpointFilename}`);
            return true;
        } catch (error) {
            console.error(`❌ Error creating checkpoint for ${path.basename(this.dbPath)}:`, error);
            return false;
        } finally {
            this.isCheckpointing = false;
            this.notifyCheckpointComplete();
        }
    }

    /**
     * Get database statistics
     * @returns {Promise<Object>}
     */
    async getStats() {
        await this.open();
        this.updateAccessTime();
        
        try {
            const stats = fs.statSync(this.dbPath);
            const tables = await this.all("SELECT name FROM sqlite_master WHERE type='table'");
            
            let totalRecords = 0;
            for (const table of tables) {
                try {
                    const count = await this.get(`SELECT COUNT(*) as count FROM ${table.name}`);
                    totalRecords += count?.count || 0;
                } catch (error) {
                    // Skip tables that can't be counted
                }
            }
            
            return {
                size: stats.size,
                tableCount: tables.length,
                totalRecords: totalRecords,
                lastModified: stats.mtime,
                isOpen: this.isOpen,
                isDirty: this.isDirty,
                lastAccess: this.lastAccessTime
            };
        } catch (error) {
            throw new Error(`Failed to get database stats: ${error.message}`);
        }
    }
}

/**
 * Async SQLite Database Manager
 * Manages multiple database instances and provides centralized initialization
 */
class AsyncSQLiteManager {
    constructor() {
        this.databases = new Map(); // dbPath -> AsyncSQLiteDatabase
        this.initialized = false;
    }
    
    /**
     * Initialize the manager
     */
    initialize() {
        if (this.initialized) {
            return;
        }
        this.initialized = true;
    }
    
    /**
     * Create or get a database instance
     * @param {string} dbPath - Path to database file
     * @param {Object} options - Database options
     * @returns {AsyncSQLiteDatabase}
     */
    getDatabase(dbPath, options = {}) {
        const normalizedPath = path.resolve(dbPath);
        
        if (!this.databases.has(normalizedPath)) {
            const db = new AsyncSQLiteDatabase(normalizedPath, options);
            this.databases.set(normalizedPath, db);
        }
        
        return this.databases.get(normalizedPath);
    }
    
    /**
     * Get all database instances
     * @returns {Map<string, AsyncSQLiteDatabase>}
     */
    getAllDatabases() {
        return this.databases;
    }
    
    /**
     * Close all databases
     * @returns {Promise<void>}
     */
    async closeAll() {
        const closePromises = Array.from(this.databases.values()).map(db => db.close());
        await Promise.all(closePromises);
        this.databases.clear();
    }
    
    /**
     * Create checkpoints for all dirty databases
     * @returns {Promise<Array>} Array of checkpoint results
     */
    async checkpointAllDirty() {
        const results = [];
        
        for (const [dbPath, db] of this.databases.entries()) {
            if (db.isDirtyState()) {
                const success = await db.createCheckpointIfDirty();
                results.push({ dbPath, success });
            }
        }
        
        return results;
    }
}

// Export singleton instance
const asyncSQLiteManager = new AsyncSQLiteManager();

/**
 * Compatibility wrapper class that matches the signature used by database modules
 * (dbPath, dbName, idleTimeoutMinutes) -> (dbPath, options)
 * This extends AsyncSQLiteDatabase but accepts a different constructor signature
 */
class SQLiteAsyncWrapper extends AsyncSQLiteDatabase {
    constructor(dbPath, dbName, idleTimeoutMinutes = 30) {
        // Convert to options object format and call parent constructor
        super(dbPath, {
            idleTimeoutMinutes: idleTimeoutMinutes,
            maxCheckpoints: 5,
            enableCheckpointing: true
        });
    }
}

// Export classes and singleton
module.exports = SQLiteAsyncWrapper; // Default export for convenience
module.exports.AsyncSQLiteDatabase = AsyncSQLiteDatabase;
module.exports.AsyncSQLiteManager = AsyncSQLiteManager;
module.exports.asyncSQLiteManager = asyncSQLiteManager;
module.exports.SQLiteAsyncWrapper = SQLiteAsyncWrapper;

