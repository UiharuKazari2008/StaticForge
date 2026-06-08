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
    constructor(globalResources = null, name = null, filePath, maxCheckpoints = 4, validationCallback = null, options = {}) {
        this.filePath = filePath;
        this.maxCheckpoints = maxCheckpoints;
        this.name = name; // Store checkpoint manager name
        this.globalResources = globalResources; // Store globalResources reference
        
        // Get validation callback from globalResources if not provided
        if (!validationCallback && this.globalResources && name) {
            if (typeof this.globalResources.getConfigValidationCallback === 'function') {
                validationCallback = this.globalResources.getConfigValidationCallback(name);
            }
        }
        this.validationCallback = validationCallback; // Store validation callback
        
        // Centralized checkpoint directory: .cache/checkpoints/<set name>/
        // Get cache directory from globalResources if available, otherwise use fallback
        let cacheDir;
        if (this.globalResources && typeof this.globalResources.getPath === 'function') {
            cacheDir = this.globalResources.getPath('cache');
        } else {
            // Fallback to default if globalResources not provided
            cacheDir = path.resolve(__dirname, '..', '.cache');
        }
        
        this.fileName = path.basename(filePath, path.extname(filePath));
        this.fileExt = path.extname(filePath);
        this.checkpointDir = path.join(cacheDir, 'checkpoints', this.fileName);
        
        const {
            minCheckpointAgeMs = 5 * 60 * 1000 // Default 5 minutes between checkpoints
        } = options || {};
        this.minCheckpointAgeMs = Math.max(0, Number(minCheckpointAgeMs) || 0);
        this.lastCheckpointTime = 0;
        this.isDirty = false;
        
        // Cache for file hashes and metadata
        this._cache = {
            currentFile: { hash: null, size: null, mtime: null },
            latestCheckpoint: { path: null, hash: null, size: null, mtime: null }
        };
        
        // Ensure checkpoint directory exists
        this.ensureCheckpointDirectory();
        
        const existingCheckpoints = this.getCheckpointFiles();
        if (existingCheckpoints.length > 0) {
            this.lastCheckpointTime = existingCheckpoints[0].mtime.getTime();
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
     * Format: <year-month-day_HH-mm-sec.ms>.<ext>
     */
    generateCheckpointFilename() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        
        const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}.${milliseconds}`;
        return `${timestamp}${this.fileExt}`;
    }

    /**
     * Get all checkpoint files sorted by modification time (newest first)
     * Checkpoints are in format: <year-month-day_HH-mm-sec.ms>.<ext>
     * Note: This explicitly excludes branch files (which start with 'branch_')
     */
    getCheckpointFiles() {
        try {
            if (!fs.existsSync(this.checkpointDir)) {
                return [];
            }

            // Filter files that match the timestamp format and have the correct extension
            // Format: YYYY-MM-DD_HH-mm-ss.SSS.ext
            // IMPORTANT: Must NOT start with 'branch_' to exclude branch files
            const timestampPattern = /^\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}\./;
            
            const files = fs.readdirSync(this.checkpointDir)
                .filter(file => {
                    // Must match timestamp pattern, have correct extension, and NOT be a branch file
                    return timestampPattern.test(file) && 
                           file.endsWith(this.fileExt) &&
                           !file.startsWith('branch_');
                })
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
     * IMPORTANT: This method only deletes checkpoint files, never branch files
     * Branches are preserved regardless of the max checkpoint count
     */
    cleanupOldCheckpoints() {
        try {
            const checkpointFiles = this.getCheckpointFiles();
            
            if (checkpointFiles.length > this.maxCheckpoints) {
                const filesToDelete = checkpointFiles.slice(this.maxCheckpoints);
                
                filesToDelete.forEach(file => {
                    try {
                        // Safety check: ensure we're not accidentally deleting a branch file
                        if (file.filename.startsWith('branch_')) {
                            return;
                        }
                        
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
     * Mark file as dirty (content changed since last checkpoint)
     */
    markDirty() {
        this.isDirty = true;
    }

    /**
     * Mark file as clean (after checkpoint or verified unchanged)
     */
    markClean() {
        this.isDirty = false;
    }

    /**
     * Check if file has unsaved changes since last checkpoint
     */
    isDirtyState() {
        return this.isDirty;
    }

    /**
     * Compute MD5 hash for JSON-serializable data
     */
    hashData(data) {
        const jsonData = JSON.stringify(data, null, 2);
        return crypto.createHash('md5').update(jsonData).digest('hex');
    }

    /**
     * Get file hash and metadata, using cache if available and file hasn't changed
     */
    getFileHash(filePath, cacheKey) {
        try {
            if (!fs.existsSync(filePath)) {
                return null;
            }

            const stats = fs.statSync(filePath);
            const cache = this._cache[cacheKey];

            // Check if cache is valid (file hasn't changed)
            if (cache.hash && cache.size === stats.size && cache.mtime && cache.mtime.getTime() === stats.mtime.getTime()) {
                return { hash: cache.hash, size: stats.size, mtime: stats.mtime };
            }

            // Compute hash and update cache
            const fileContent = fs.readFileSync(filePath);
            const hash = crypto.createHash('md5').update(fileContent).digest('hex');
            
            // Update cache
            cache.hash = hash;
            cache.size = stats.size;
            cache.mtime = stats.mtime;

            return { hash, size: stats.size, mtime: stats.mtime };
        } catch (error) {
            return null;
        }
    }

    /**
     * Fast comparison of two files using cached size and hash
     * Returns true if files are identical, false otherwise
     */
    filesAreIdentical(filePath1, filePath2) {
        try {
            const file1Info = this.getFileHash(filePath1, 'currentFile');
            const file2Info = this.getFileHash(filePath2, 'latestCheckpoint');

            if (!file1Info || !file2Info) {
                return false;
            }

            // Fast size comparison first
            if (file1Info.size !== file2Info.size) {
                return false; // Different sizes, definitely different
            }

            // Compare hashes
            return file1Info.hash === file2Info.hash;
        } catch (error) {
            // If comparison fails, assume files are different to be safe
            return false;
        }
    }

    /**
     * Get the latest checkpoint file path, with caching
     */
    getLatestCheckpointPath() {
        const checkpointFiles = this.getCheckpointFiles();
        if (checkpointFiles.length === 0) {
            this._cache.latestCheckpoint.path = null;
            this._cache.latestCheckpoint.hash = null;
            this._cache.latestCheckpoint.size = null;
            this._cache.latestCheckpoint.mtime = null;
            return null;
        }
        
        const latestPath = checkpointFiles[0].filePath;
        
        // Update cache if checkpoint path changed
        if (this._cache.latestCheckpoint.path !== latestPath) {
            this._cache.latestCheckpoint.path = latestPath;
            // Invalidate hash cache so it gets recomputed
            this._cache.latestCheckpoint.hash = null;
            this._cache.latestCheckpoint.size = null;
            this._cache.latestCheckpoint.mtime = null;
        }
        
        return latestPath;
    }

    /**
     * Validate checkpoint data (JSON structure)
     * @param {Function} validationCallback - Optional callback to validate the data structure
     * @param {string} checkpointPath - Path to checkpoint file to validate
     * @returns {Object} { valid: boolean, error: string|null }
     */
    validateCheckpoint(checkpointPath, validationCallback = null) {
        try {
            if (!fs.existsSync(checkpointPath)) {
                return { valid: false, error: 'Checkpoint file does not exist' };
            }

            // Basic JSON validation
            let data;
            try {
                const content = fs.readFileSync(checkpointPath, 'utf8');
                data = JSON.parse(content);
            } catch (parseError) {
                return { valid: false, error: `Invalid JSON: ${parseError.message}` };
            }

            // Custom validation if provided
            if (validationCallback && typeof validationCallback === 'function') {
                try {
                    const customValidation = validationCallback(data);
                    if (customValidation && typeof customValidation === 'object') {
                        if (customValidation.valid === false) {
                            return { valid: false, error: customValidation.error || 'Custom validation failed' };
                        }
                    } else if (customValidation === false) {
                        return { valid: false, error: 'Custom validation failed' };
                    }
                } catch (validationError) {
                    return { valid: false, error: `Validation error: ${validationError.message}` };
                }
            }

            return { valid: true, error: null };
        } catch (error) {
            return { valid: false, error: `Validation error: ${error.message}` };
        }
    }

    /**
     * Create a checkpoint of the current file
     * Only creates checkpoint if current file differs from the last checkpoint
     * @param {Object} options - Options for checkpoint creation
     * @param {Function} options.validationCallback - Optional callback to validate data before checkpointing
     * @param {boolean} options.skipIfInvalid - If true, skip checkpoint creation if validation fails
     * @returns {boolean} Success status
     */
    createCheckpoint(options = {}) {
        try {
            const { validationCallback = this.validationCallback, skipIfInvalid = false, force = false } = options;

            if (!fs.existsSync(this.filePath)) {
                console.warn(`⚠️ Source file does not exist: ${this.filePath}`);
                return false;
            }

            if (!force && !this.isDirty) {
                return false;
            }

            // Validate before creating checkpoint if callback provided
            if (validationCallback) {
                const validation = this.validateCheckpoint(this.filePath, validationCallback);
                if (!validation.valid) {
                    if (skipIfInvalid) {
                        console.warn(`⚠️ Skipping checkpoint creation: ${validation.error}`);
                        return false;
                    } else {
                        console.warn(`⚠️ Checkpoint validation warning: ${validation.error} (creating anyway)`);
                    }
                }
            }

            if (this.minCheckpointAgeMs > 0 && !force) {
                const cachedMtime = this._cache.latestCheckpoint.mtime;
                const referenceTime = this.lastCheckpointTime || (cachedMtime ? cachedMtime.getTime() : 0);
                if (referenceTime && Date.now() - referenceTime < this.minCheckpointAgeMs) {
                    return false;
                }
            }

            // Get the latest checkpoint
            const latestCheckpointPath = this.getLatestCheckpointPath();
            
            // If a checkpoint exists, compare it with the current file
            if (latestCheckpointPath && fs.existsSync(latestCheckpointPath)) {
                if (this.filesAreIdentical(this.filePath, latestCheckpointPath)) {
                    // Files are identical, skip checkpoint creation
                    this.markClean();
                    return false;
                }
            }

            // Files are different or no checkpoint exists, create a new checkpoint
            const checkpointFilename = this.generateCheckpointFilename();
            const checkpointPath = path.join(this.checkpointDir, checkpointFilename);

            // Copy the current file to create a checkpoint
            fs.copyFileSync(this.filePath, checkpointPath);

            // Update cache for the new checkpoint
            const checkpointStats = fs.statSync(checkpointPath);
            this._cache.latestCheckpoint.path = checkpointPath;
            this._cache.latestCheckpoint.hash = this._cache.currentFile.hash;
            this._cache.latestCheckpoint.size = this._cache.currentFile.size;
            this._cache.latestCheckpoint.mtime = checkpointStats.mtime;

            this.lastCheckpointTime = checkpointStats.mtime.getTime();
            this.markClean();
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
     * @param {Object} data - Data to save
     * @param {Object} options - Options for saving
     * @param {boolean} options.createCheckpoint - Create checkpoint before saving (default: true)
     * @param {boolean} options.validateData - Validate data structure before saving (default: true)
     * @param {Function} options.validationCallback - Optional callback to validate data structure
     * @param {boolean} options.skipCheckpointIfInvalid - Skip checkpoint if validation fails (default: false)
     * @param {boolean} options.saveCurrentAsBranch - Save current file as branch before overwriting (default: false, only used during restore)
     * @param {boolean} options.skipSavingCurrent - Skip saving current file as branch (default: false)
     * @returns {boolean} Success status
     */
    saveWithCheckpoint(data, options = {}) {
        try {
            const { 
                createCheckpoint = true, 
                validateData = true,
                validationCallback = this.validationCallback,
                skipCheckpointIfInvalid = false,
                saveCurrentAsBranch = false, // Branches are only created during restore, not normal saves
                skipSavingCurrent = false
            } = options;

            // Validate data if requested
            if (validateData && typeof data !== 'object') {
                throw new Error('Data must be an object for JSON checkpointing');
            }

            // Custom validation if provided
            if (validationCallback && typeof validationCallback === 'function') {
                try {
                    const customValidation = validationCallback(data);
                    if (customValidation && typeof customValidation === 'object') {
                        if (customValidation.valid === false) {
                            throw new Error(customValidation.error || 'Data validation failed');
                        }
                    } else if (customValidation === false) {
                        throw new Error('Data validation failed');
                    }
                } catch (validationError) {
                    if (validationError.message) {
                        throw validationError;
                    }
                    throw new Error(`Validation error: ${validationError.message || validationError}`);
                }
            }

            // Ensure directory exists
            const dir = path.dirname(this.filePath);
            if (!fs.existsSync(dir)) {
                fs.mkdirSync(dir, { recursive: true });
            }

            const jsonData = JSON.stringify(data, null, 2);
            const newHash = crypto.createHash('md5').update(jsonData).digest('hex');

            // Skip write and checkpoint when content is unchanged
            if (fs.existsSync(this.filePath)) {
                const currentInfo = this.getFileHash(this.filePath, 'currentFile');
                if (currentInfo && currentInfo.hash === newHash) {
                    this.markClean();
                    return true;
                }
            }

            this.markDirty();

            // Create checkpoint before saving if requested
            if (createCheckpoint && fs.existsSync(this.filePath)) {
                this.createCheckpoint({
                    validationCallback: validationCallback,
                    skipIfInvalid: skipCheckpointIfInvalid
                });
            }

            // Write the new data
            fs.writeFileSync(this.filePath, jsonData, 'utf8');

            // Update cache with new file hash
            const stats = fs.statSync(this.filePath);
            this._cache.currentFile.hash = newHash;
            this._cache.currentFile.size = stats.size;
            this._cache.currentFile.mtime = stats.mtime;
            this.markClean();

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
     * Generate a branch filename (file that existed before restore/overwrite)
     * Format: branch_<year-month-day_HH-mm-sec.ms>.<ext>
     */
    generateBranchFilename() {
        const now = new Date();
        const year = now.getFullYear();
        const month = String(now.getMonth() + 1).padStart(2, '0');
        const day = String(now.getDate()).padStart(2, '0');
        const hours = String(now.getHours()).padStart(2, '0');
        const minutes = String(now.getMinutes()).padStart(2, '0');
        const seconds = String(now.getSeconds()).padStart(2, '0');
        const milliseconds = String(now.getMilliseconds()).padStart(3, '0');
        
        const timestamp = `${year}-${month}-${day}_${hours}-${minutes}-${seconds}.${milliseconds}`;
        return `branch_${timestamp}${this.fileExt}`;
    }
    
    /**
     * Get all branch files sorted by modification time (newest first)
     * Branch files use format: branch_<year-month-day_HH-mm-sec.ms>.<ext>
     */
    getBranchFiles() {
        try {
            if (!fs.existsSync(this.checkpointDir)) {
                return [];
            }

            // Branch files have 'branch_' prefix followed by timestamp format
            const branchPattern = /^branch_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}\.\d{3}\./;
            
            const files = fs.readdirSync(this.checkpointDir)
                .filter(file => {
                    // Must match branch pattern and have correct extension
                    return branchPattern.test(file) && file.endsWith(this.fileExt);
                })
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
            console.error('❌ Error getting branch files:', error);
            return [];
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
     * @param {string} checkpointFilename - Name of checkpoint file to restore from
     * @param {Object} options - Options for restoration
     * @param {Function} options.validationCallback - Optional callback to validate checkpoint before restoring
     * @param {boolean} options.saveCurrentAsBranch - Save current file as branch before restoring (default: true)
     * @param {boolean} options.skipSavingCurrent - Skip saving current file as branch (default: false)
     * @returns {boolean} Success status
     */
    restoreFromCheckpoint(checkpointFilename, options = {}) {
        try {
            const { 
                validationCallback = this.validationCallback,
                saveCurrentAsBranch = true,
                skipSavingCurrent = false
            } = options;

            const checkpointPath = path.join(this.checkpointDir, checkpointFilename);
            
            if (!fs.existsSync(checkpointPath)) {
                throw new Error(`Checkpoint not found: ${checkpointFilename}`);
            }

            // Validate checkpoint before restoring if callback provided
            if (validationCallback) {
                const validation = this.validateCheckpoint(checkpointPath, validationCallback);
                if (!validation.valid) {
                    throw new Error(`Checkpoint validation failed: ${validation.error}`);
                }
            }

            // Save current file as branch before restoring (unless skipped)
            if (saveCurrentAsBranch && !skipSavingCurrent && fs.existsSync(this.filePath)) {
                try {
                    const branchFilename = this.generateBranchFilename();
                    const branchPath = path.join(this.checkpointDir, branchFilename);
                    fs.copyFileSync(this.filePath, branchPath);
                    console.log(`📋 Saved current file as branch before restore: ${branchFilename}`);
                } catch (branchError) {
                    console.warn(`⚠️ Could not save branch before restore: ${branchError.message}`);
                }
            }

            // Restore from checkpoint
            fs.copyFileSync(checkpointPath, this.filePath);
            
            // Update cache after restore
            const stats = fs.statSync(this.filePath);
            const checkpointHash = this.getFileHash(checkpointPath, 'latestCheckpoint');
            if (checkpointHash) {
                this._cache.currentFile.hash = checkpointHash.hash;
                this._cache.currentFile.size = checkpointHash.size;
                this._cache.currentFile.mtime = stats.mtime;
            }
            
            console.log(`✅ Restored from checkpoint: ${checkpointFilename}`);
            
            return true;
        } catch (error) {
            console.error('❌ Error restoring from checkpoint:', error);
            throw error;
        }
    }

    /**
     * Restore from the most recent checkpoint
     * @param {Object} options - Options for restoration (same as restoreFromCheckpoint)
     * @returns {boolean} Success status
     */
    restoreFromLatestCheckpoint(options = {}) {
        try {
            const checkpointFiles = this.getCheckpointFiles();
            
            if (checkpointFiles.length === 0) {
                throw new Error('No checkpoints available to restore from');
            }

            const latestCheckpoint = checkpointFiles[0];
            return this.restoreFromCheckpoint(latestCheckpoint.filename, options);
        } catch (error) {
            console.error('❌ Error restoring from latest checkpoint:', error);
            throw error;
        }
    }
    
    /**
     * Get the latest valid checkpoint (validates each checkpoint until finding a valid one)
     * @param {Function} validationCallback - Optional callback to validate checkpoint data
     * @returns {Object|null} Latest valid checkpoint info or null
     */
    getLatestValidCheckpoint(validationCallback = null) {
        try {
            const callback = validationCallback || this.validationCallback;
            if (!callback) {
                throw new Error('validationCallback is required to find a valid checkpoint');
            }
            
            const checkpointFiles = this.getCheckpointFiles();
            
            for (const checkpoint of checkpointFiles) {
                const validation = this.validateCheckpoint(checkpoint.filePath, callback);
                if (validation.valid) {
                    return checkpoint;
                }
            }
            
            return null;
        } catch (error) {
            console.error('❌ Error getting latest valid checkpoint:', error);
            return null;
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
            
            // Invalidate cache if we deleted the latest checkpoint
            if (this._cache.latestCheckpoint.path === checkpointPath) {
                this._cache.latestCheckpoint.path = null;
                this._cache.latestCheckpoint.hash = null;
                this._cache.latestCheckpoint.size = null;
                this._cache.latestCheckpoint.mtime = null;
            }
            
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

            // Clear checkpoint cache
            this._cache.latestCheckpoint.path = null;
            this._cache.latestCheckpoint.hash = null;
            this._cache.latestCheckpoint.size = null;
            this._cache.latestCheckpoint.mtime = null;
            
            console.log(`✅ Cleared ${checkpointFiles.length} checkpoints`);
            return true;
        } catch (error) {
            console.error('❌ Error clearing checkpoints:', error);
            throw error;
        }
    }
}

module.exports = {
    JSONCheckpointManager
};
