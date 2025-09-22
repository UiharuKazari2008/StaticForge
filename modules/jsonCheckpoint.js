const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

/**
 * JSON Checkpoint Manager
 * 
 * Provides checkpointing functionality for JSON files with automatic backup management.
 * Maintains the last 4 saves as checkpoints and provides rollback capabilities.
 */
class JSONCheckpointManager {
    constructor(filePath, maxCheckpoints = 4) {
        this.filePath = filePath;
        this.maxCheckpoints = maxCheckpoints;
        this.checkpointDir = path.join(path.dirname(filePath), '.checkpoints');
        this.fileName = path.basename(filePath, path.extname(filePath));
        this.fileExt = path.extname(filePath);
        
        // Ensure checkpoint directory exists
        this.ensureCheckpointDirectory();
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
        return `${this.fileName}_checkpoint_${timestamp}${this.fileExt}`;
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
                .filter(file => file.startsWith(`${this.fileName}_checkpoint_`) && file.endsWith(this.fileExt))
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
                        console.log(`🗑️ Deleted old checkpoint: ${file.filename}`);
                    } catch (error) {
                        console.error(`❌ Error deleting checkpoint ${file.filename}:`, error);
                    }
                });
            }
        } catch (error) {
            console.error('❌ Error cleaning up checkpoints:', error);
        }
    }

    /**
     * Create a checkpoint of the current file
     */
    createCheckpoint() {
        try {
            if (!fs.existsSync(this.filePath)) {
                console.warn(`⚠️ Source file does not exist: ${this.filePath}`);
                return false;
            }

            const checkpointFilename = this.generateCheckpointFilename();
            const checkpointPath = path.join(this.checkpointDir, checkpointFilename);

            // Copy the current file to create a checkpoint
            fs.copyFileSync(this.filePath, checkpointPath);

            console.log(`✅ Created checkpoint: ${checkpointFilename}`);
            
            // Clean up old checkpoints
            this.cleanupOldCheckpoints();
            
            return true;
        } catch (error) {
            console.error('❌ Error creating checkpoint:', error);
            return false;
        }
    }

    /**
     * Save data to file with automatic checkpointing
     */
    saveWithCheckpoint(data, options = {}) {
        try {
            const { createCheckpoint = true, validateData = true } = options;

            // Validate data if requested
            if (validateData && typeof data !== 'object') {
                throw new Error('Data must be an object for JSON checkpointing');
            }

            // Ensure directory exists
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            // Create checkpoint before saving if requested
            if (createCheckpoint && fs.existsSync(this.filePath)) {
                this.createCheckpoint();
            }

            // Write the new data
            const jsonData = JSON.stringify(data, null, 2);
            fs.writeFileSync(this.filePath, jsonData, 'utf8');

            // Verify the file was written correctly
            const savedData = fs.readFileSync(this.filePath, 'utf8');
            const parsedData = JSON.parse(savedData);

            console.log(`✅ Data saved successfully to ${this.filePath}`);
            return true;
        } catch (error) {
            console.error('❌ Error saving data with checkpoint:', error);
            throw error;
        }
    }

    /**
     * Load data from file
     */
    loadData() {
        try {
            if (!fs.existsSync(this.filePath)) {
                console.warn(`⚠️ File does not exist: ${this.filePath}`);
                return null;
            }

            const data = fs.readFileSync(this.filePath, 'utf8');
            return JSON.parse(data);
        } catch (error) {
            console.error('❌ Error loading data:', error);
            throw error;
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

            // Create a backup of current file before restoring
            if (fs.existsSync(this.filePath)) {
                const backupFilename = this.generateCheckpointFilename();
                const backupPath = path.join(this.checkpointDir, backupFilename);
                fs.copyFileSync(this.filePath, backupPath);
                console.log(`📋 Created backup before restore: ${backupFilename}`);
            }

            // Restore from checkpoint
            fs.copyFileSync(checkpointPath, this.filePath);
            console.log(`✅ Restored from checkpoint: ${checkpointFilename}`);
            
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
                filePath: this.filePath,
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

            fs.unlinkSync(checkpointPath);
            console.log(`🗑️ Deleted checkpoint: ${checkpointFilename}`);
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
                    fs.unlinkSync(file.filePath);
                    console.log(`🗑️ Deleted checkpoint: ${file.filename}`);
                } catch (error) {
                    console.error(`❌ Error deleting checkpoint ${file.filename}:`, error);
                }
            });

            console.log(`✅ Cleared ${checkpointFiles.length} checkpoints`);
            return true;
        } catch (error) {
            console.error('❌ Error clearing checkpoints:', error);
            throw error;
        }
    }
}

/**
 * Factory function to create a checkpoint manager for a specific file
 */
function createJSONCheckpointManager(filePath, maxCheckpoints = 4) {
    return new JSONCheckpointManager(filePath, maxCheckpoints);
}

module.exports = {
    JSONCheckpointManager,
    createJSONCheckpointManager
};
