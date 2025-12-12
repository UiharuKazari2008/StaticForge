const fs = require('fs');
const path = require('path');
const Database = require('better-sqlite3');

/**
 * Database Checkpoint Manager
 * 
 * Provides checkpointing functionality for SQLite databases with automatic backup management.
 * Creates full database backups and provides restore capabilities.
 */
class DatabaseCheckpointManager {
    constructor(dbPath, maxCheckpoints = 5) {
        this.dbPath = dbPath;
        this.maxCheckpoints = maxCheckpoints;
        this.checkpointDir = path.join(path.dirname(dbPath), '.checkpoints');
        this.dbName = path.basename(dbPath, path.extname(dbPath));
        this.dbExt = path.extname(dbPath);
        this.lastCheckpointSignature = null;
        
        // Ensure checkpoint directory exists
        this.ensureCheckpointDirectory();
        this.loadLastCheckpointSignature();
    }

    /**
     * Capture size/mtime signature for the database + WAL/SHM companions
     * @param {string} basePath - Base path (without -wal/-shm) to inspect
     */
    getFileSignature(basePath) {
        const signature = {
            dbSize: 0,
            dbMtimeMs: 0,
            walSize: 0,
            walMtimeMs: 0,
            shmSize: 0,
            shmMtimeMs: 0
        };

        try {
            if (fs.existsSync(basePath)) {
                const stats = fs.statSync(basePath);
                signature.dbSize = stats.size;
                signature.dbMtimeMs = stats.mtimeMs;
            }

            const walPath = `${basePath}-wal`;
            if (fs.existsSync(walPath)) {
                const walStats = fs.statSync(walPath);
                signature.walSize = walStats.size;
                signature.walMtimeMs = walStats.mtimeMs;
            }

            const shmPath = `${basePath}-shm`;
            if (fs.existsSync(shmPath)) {
                const shmStats = fs.statSync(shmPath);
                signature.shmSize = shmStats.size;
                signature.shmMtimeMs = shmStats.mtimeMs;
            }
        } catch (error) {
            console.warn(`⚠️ Unable to read signature for ${basePath}:`, error.message);
        }

        return signature;
    }

    /**
     * Capture signature for the live database files
     */
    getDatabaseSignature() {
        return this.getFileSignature(this.dbPath);
    }

    /**
     * Determine if the on-disk database has changed since the last checkpoint
     * @param {Object} currentSignature
     */
    hasDatabaseChanged(currentSignature) {
        if (!this.lastCheckpointSignature) {
            return true;
        }

        const keys = [
            'dbSize',
            'dbMtimeMs',
            'walSize',
            'walMtimeMs',
            'shmSize',
            'shmMtimeMs'
        ];

        return keys.some(key => this.lastCheckpointSignature[key] !== currentSignature[key]);
    }

    /**
     * Load signature metadata on boot by comparing timestamps with latest checkpoint
     */
    loadLastCheckpointSignature() {
        try {
            const checkpointFiles = this.getCheckpointFiles();
            if (checkpointFiles.length === 0 || !fs.existsSync(this.dbPath)) {
                return;
            }

            const walPath = this.dbPath + '-wal';
            const walStats = fs.existsSync(walPath) ? fs.statSync(walPath) : null;
            if (walStats && walStats.size > 0) {
                // WAL contains unapplied changes - force a checkpoint on startup
                return;
            }

            const latestCheckpoint = checkpointFiles[0];
            const checkpointPath = path.join(this.checkpointDir, latestCheckpoint.filename);

            const dbStats = fs.statSync(this.dbPath);
            const checkpointStats = fs.statSync(checkpointPath);

            if (dbStats.mtimeMs <= checkpointStats.mtimeMs) {
                this.lastCheckpointSignature = this.getDatabaseSignature();
            }
        } catch (error) {
            console.warn(`⚠️ Unable to load checkpoint signature for ${this.dbPath}: ${error.message}`);
        }
    }

    /**
     * Ensure the checkpoint directory exists
     */
    ensureCheckpointDirectory() {
        if (!fs.existsSync(this.checkpointDir)) {
            fs.mkdirSync(this.checkpointDir, { recursive: true });
        }
    }

    /**
     * Generate a checkpoint filename with timestamp
     */
    generateCheckpointFilename() {
        const timestamp = new Date().toISOString().replace(/[:.]/g, '-');
        return `${this.dbName}_checkpoint_${timestamp}${this.dbExt}`;
    }

    /**
     * Get all checkpoint files sorted by modification time (newest first)
     */
    getCheckpointFiles() {
        try {
            if (!fs.existsSync(this.checkpointDir)) {
                return [];
            }

            const files = fs.readdirSync(this.checkpointDir)
                .filter(file => file.startsWith(`${this.dbName}_checkpoint_`) && file.endsWith(this.dbExt))
                .map(file => {
                    const filePath = path.join(this.checkpointDir, file);
                    const stats = fs.statSync(filePath);
                    return {
                        filename: file,
                        filePath: filePath,
                        mtime: stats.mtime,
                        size: stats.size
                    };
                })
                .sort((a, b) => b.mtime - a.mtime); // Sort by modification time, newest first

            return files;
        } catch (error) {
            console.error('❌ Error getting checkpoint files:', error);
            return [];
        }
    }

    /**
     * Clean up old checkpoints, keeping only the most recent ones
     */
    cleanupOldCheckpoints() {
        try {
            const checkpointFiles = this.getCheckpointFiles();
            
            if (checkpointFiles.length > this.maxCheckpoints) {
                const filesToDelete = checkpointFiles.slice(this.maxCheckpoints);
                
                filesToDelete.forEach(file => {
                    try {
                        fs.unlinkSync(file.filePath);
                        console.log(`🗑️ Deleted old database checkpoint: ${file.filename}`);
                    } catch (error) {
                        console.error(`❌ Error deleting checkpoint ${file.filename}:`, error);
                    }
                });
            }
        } catch (error) {
            console.error('❌ Error cleaning up database checkpoints:', error);
        }
    }

    /**
     * Create a checkpoint of the current database
     */
    createCheckpoint() {
        try {
            if (!fs.existsSync(this.dbPath)) {
                console.warn(`⚠️ Database file does not exist: ${this.dbPath}`);
                return false;
            }

            const currentSignature = this.getDatabaseSignature();
            if (!this.hasDatabaseChanged(currentSignature)) {
                console.log(`ℹ️ Database unchanged, skipping checkpoint for ${this.dbName}`);
                return false;
            }

            const checkpointFilename = this.generateCheckpointFilename();
            const checkpointPath = path.join(this.checkpointDir, checkpointFilename);

            // For SQLite databases, we need to ensure the database is not locked
            // We'll use a simple file copy approach
            fs.copyFileSync(this.dbPath, checkpointPath);

            // Also copy WAL and SHM files if they exist (for WAL mode databases)
            const walPath = this.dbPath + '-wal';
            const shmPath = this.dbPath + '-shm';
            
            if (fs.existsSync(walPath)) {
                fs.copyFileSync(walPath, checkpointPath + '-wal');
            }
            
            if (fs.existsSync(shmPath)) {
                fs.copyFileSync(shmPath, checkpointPath + '-shm');
            }

            console.log(`✅ Created database checkpoint: ${checkpointFilename}`);
            
            // Clean up old checkpoints
            this.cleanupOldCheckpoints();

            this.lastCheckpointSignature = currentSignature;
            
            return true;
        } catch (error) {
            console.error('❌ Error creating database checkpoint:', error);
            return false;
        }
    }

    /**
     * Create a checkpoint using SQLite backup API (more reliable for active databases)
     * @param {boolean} forceDirty - Force checkpoint even if signature check suggests no changes (from dirty state tracking)
     */
    async createCheckpointWithBackup(forceDirty = false) {
        try {
            if (!fs.existsSync(this.dbPath)) {
                console.warn(`⚠️ Database file does not exist: ${this.dbPath}`);
                return false;
            }

            const currentSignature = this.getDatabaseSignature();
            // If forceDirty is true, skip signature check (we know writes occurred)
            if (!forceDirty && !this.hasDatabaseChanged(currentSignature)) {
                console.log(`ℹ️ Database unchanged, skipping checkpoint for ${this.dbName}`);
                return false;
            }

            const checkpointFilename = this.generateCheckpointFilename();
            const checkpointPath = path.join(this.checkpointDir, checkpointFilename);

            // Open source database (better-sqlite3 for synchronous backup)
            const sourceDb = new Database(this.dbPath, { readonly: true });
            
            try {
                // Perform backup - backup() returns a promise and must be awaited
                await sourceDb.backup(checkpointPath);
                
                console.log(`✅ Created database checkpoint with backup API: ${checkpointFilename}`);
            } finally {
                // Always close source database, even if backup fails
                sourceDb.close();
            }
            
            // Clean up old checkpoints
            this.cleanupOldCheckpoints();

            this.lastCheckpointSignature = currentSignature;
            
            return true;
        } catch (error) {
            console.error('❌ Error creating database checkpoint with backup:', error);
            return false;
        }
    }

    /**
     * Restore from a specific checkpoint
     */
    restoreFromCheckpoint(checkpointFilename) {
        try {
            const checkpointPath = path.join(this.checkpointDir, checkpointFilename);
            
            if (!fs.existsSync(checkpointPath)) {
                throw new Error(`Checkpoint not found: ${checkpointFilename}`);
            }

            // Create a backup of current database before restoring
            if (fs.existsSync(this.dbPath)) {
                const backupFilename = this.generateCheckpointFilename();
                const backupPath = path.join(this.checkpointDir, backupFilename);
                fs.copyFileSync(this.dbPath, backupPath);
                console.log(`📋 Created backup before restore: ${backupFilename}`);
            }

            // Restore from checkpoint
            fs.copyFileSync(checkpointPath, this.dbPath);

            // Also restore WAL and SHM files if they exist
            const walCheckpointPath = checkpointPath + '-wal';
            const shmCheckpointPath = checkpointPath + '-shm';
            const walPath = this.dbPath + '-wal';
            const shmPath = this.dbPath + '-shm';
            
            if (fs.existsSync(walCheckpointPath)) {
                fs.copyFileSync(walCheckpointPath, walPath);
            }
            
            if (fs.existsSync(shmCheckpointPath)) {
                fs.copyFileSync(shmCheckpointPath, shmPath);
            }

            console.log(`✅ Restored database from checkpoint: ${checkpointFilename}`);
            
            return true;
        } catch (error) {
            console.error('❌ Error restoring from checkpoint:', error);
            throw error;
        }
    }

    /**
     * Restore from the most recent checkpoint
     */
    restoreFromLatestCheckpoint() {
        try {
            const checkpointFiles = this.getCheckpointFiles();
            
            if (checkpointFiles.length === 0) {
                throw new Error('No checkpoints available to restore from');
            }

            const latestCheckpoint = checkpointFiles[0];
            return this.restoreFromCheckpoint(latestCheckpoint.filename);
        } catch (error) {
            console.error('❌ Error restoring from latest checkpoint:', error);
            throw error;
        }
    }

    /**
     * Get checkpoint information
     */
    getCheckpointInfo() {
        try {
            const checkpointFiles = this.getCheckpointFiles();
            
            return {
                dbPath: this.dbPath,
                checkpointDir: this.checkpointDir,
                maxCheckpoints: this.maxCheckpoints,
                currentCheckpoints: checkpointFiles.length,
                checkpoints: checkpointFiles.map(file => ({
                    filename: file.filename,
                    size: file.size,
                    created: file.mtime,
                    age: Date.now() - file.mtime.getTime()
                }))
            };
        } catch (error) {
            console.error('❌ Error getting checkpoint info:', error);
            return null;
        }
    }

    /**
     * Delete a specific checkpoint
     */
    deleteCheckpoint(checkpointFilename) {
        try {
            const checkpointPath = path.join(this.checkpointDir, checkpointFilename);
            
            if (!fs.existsSync(checkpointPath)) {
                throw new Error(`Checkpoint not found: ${checkpointFilename}`);
            }

            // Delete main checkpoint file
            fs.unlinkSync(checkpointPath);
            
            // Delete associated WAL and SHM files if they exist
            const walPath = checkpointPath + '-wal';
            const shmPath = checkpointPath + '-shm';
            
            if (fs.existsSync(walPath)) {
                fs.unlinkSync(walPath);
            }
            
            if (fs.existsSync(shmPath)) {
                fs.unlinkSync(shmPath);
            }

            console.log(`🗑️ Deleted database checkpoint: ${checkpointFilename}`);
            return true;
        } catch (error) {
            console.error('❌ Error deleting checkpoint:', error);
            throw error;
        }
    }

    /**
     * Clear all checkpoints
     */
    clearAllCheckpoints() {
        try {
            const checkpointFiles = this.getCheckpointFiles();
            
            checkpointFiles.forEach(file => {
                try {
                    // Delete main checkpoint file
                    fs.unlinkSync(file.filePath);
                    
                    // Delete associated WAL and SHM files if they exist
                    const walPath = file.filePath + '-wal';
                    const shmPath = file.filePath + '-shm';
                    
                    if (fs.existsSync(walPath)) {
                        fs.unlinkSync(walPath);
                    }
                    
                    if (fs.existsSync(shmPath)) {
                        fs.unlinkSync(shmPath);
                    }
                    
                    console.log(`🗑️ Deleted database checkpoint: ${file.filename}`);
                } catch (error) {
                    console.error(`❌ Error deleting checkpoint ${file.filename}:`, error);
                }
            });

            console.log(`✅ Cleared ${checkpointFiles.length} database checkpoints`);
            return true;
        } catch (error) {
            console.error('❌ Error clearing database checkpoints:', error);
            throw error;
        }
    }

    /**
     * Verify database integrity
     */
    verifyDatabaseIntegrity(dbPath = this.dbPath) {
        try {
            const db = new Database(dbPath, { readonly: true });
            
            // Run integrity check
            const result = db.pragma('integrity_check');
            db.close();
            
            if (result.length === 1 && result[0].integrity_check === 'ok') {
                console.log(`✅ Database integrity check passed: ${dbPath}`);
                return true;
            } else {
                console.error(`❌ Database integrity check failed: ${dbPath}`, result);
                return false;
            }
        } catch (error) {
            console.error('❌ Error verifying database integrity:', error);
            return false;
        }
    }

    /**
     * Get database statistics
     */
    getDatabaseStats(dbPath = this.dbPath) {
        try {
            const db = new Database(dbPath, { readonly: true });
            
            // Get database size
            const stats = fs.statSync(dbPath);
            
            // Get table count
            const tables = db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all();
            
            // Get total record count across all tables
            let totalRecords = 0;
            tables.forEach(table => {
                try {
                    const count = db.prepare(`SELECT COUNT(*) as count FROM ${table.name}`).get();
                    totalRecords += count.count;
                } catch (error) {
                    // Skip tables that can't be counted
                }
            });
            
            db.close();
            
            return {
                size: stats.size,
                tableCount: tables.length,
                totalRecords: totalRecords,
                lastModified: stats.mtime
            };
        } catch (error) {
            console.error('❌ Error getting database stats:', error);
            return null;
        }
    }
}

/**
 * Factory function to create a checkpoint manager for a specific database
 */
function createDatabaseCheckpointManager(dbPath, maxCheckpoints = 5) {
    return new DatabaseCheckpointManager(dbPath, maxCheckpoints);
}

module.exports = {
    DatabaseCheckpointManager,
    createDatabaseCheckpointManager
};
