const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');

class WorkspaceManager {
    constructor(globalResources) {
        if (!globalResources) {
            throw new Error('WebSocketServer requires globalResources instance and shoudl only be instantiated by globalResources.js');
        }
        // Store globalResources reference
        this.globalResources = globalResources;

        // Workspace configuration
        this.WORKSPACE_FILE = globalResources.getPath('workspaceFile');
        this.IMAGES_DIR = globalResources.getPath('images');
        this.CACHE_DIR = globalResources.getPath('cache');
        this.UPLOAD_CACHE_DIR = globalResources.getPath('uploadCache');

        // Default workspace colors
        this.DEFAULT_WORKSPACE_COLORS = [
            '#102040', // Default blue
            '#614', // Purple
            '#469', // Blue
            '#c63', // Orange
            '#266', // Dark blue
            '#28a745', // Green
            '#dc3545', // Red
            '#ffc107', // Yellow
            '#17a2b8', // Cyan
            '#6f42c1'  // Indigo
        ];

        // Per-session active workspace storage
        this.sessionActiveWorkspaces = new Map();
    }

    // Generate UUID v4
    generateUUID() {
        return crypto.randomUUID();
    }

    // Get a random color from the default palette
    getRandomWorkspaceColor() {
        return this.DEFAULT_WORKSPACE_COLORS[Math.floor(Math.random() * this.DEFAULT_WORKSPACE_COLORS.length)];
    }

    // Normalize wallpaper path to 2-part format (type:id) or url:
    // Used during config migration to convert legacy formats
    normalizeWallpaperPath(wallpaper) {
        if (!wallpaper || typeof wallpaper !== 'string') {
            return null;
        }
        
        // Check if it's already in the correct format (type:id or url:...)
        const correctFormatPattern = /^(file|cache|cache-preview|vibe|wallpaper|url):.+$/;
        if (correctFormatPattern.test(wallpaper)) {
            return wallpaper;
        }
        
        // Check if it's a full URL (http:// or https://)
        if (wallpaper.startsWith('http://') || wallpaper.startsWith('https://')) {
            return `url:${wallpaper}`;
        }
        
        // Convert from legacy URL/path format
        if (wallpaper.startsWith('/cache/upload/')) {
            return `cache:${wallpaper.replace('/cache/upload/', '')}`;
        } else if (wallpaper.startsWith('/cache/preview/')) {
            return `cache-preview:${wallpaper.replace('/cache/preview/', '')}`;
        } else if (wallpaper.startsWith('/cache/vibe/')) {
            return `vibe:${wallpaper.replace('/cache/vibe/', '')}`;
        } else if (wallpaper.startsWith('/cache/wallpapers/')) {
            const workspaceId = wallpaper.replace('/cache/wallpapers/', '').replace('.png', '');
            return `wallpaper:${workspaceId}`;
        } else if (wallpaper.startsWith('/images/')) {
            return `file:${wallpaper.replace('/images/', '')}`;
        } else if (!wallpaper.includes(':') && !wallpaper.includes('/')) {
            return `file:${wallpaper}`;
        }
        
        // Return as-is if we can't parse it (might be a custom format)
        return wallpaper;
    }

    /**
     * Validate that a file is a valid image file
     * @param {string} filePath - Path to the file to validate
     * @returns {Promise<boolean>} - True if file is a valid image, false otherwise
     */
    async validateImageFile(filePath) {
        try {
            // Check if file exists
            if (!fs.existsSync(filePath)) {
                return false;
            }

            // Try to read metadata using sharp - this will fail if not a valid image
            await sharp(filePath).metadata();
            return true;
        } catch (err) {
            // File is not a valid image or can't be read
            return false;
        }
    }

    /**
     * Validate that a hash is a valid hash (MD5, SHA1, SHA256, etc.) with no extension
     * @param {string} hash - The hash to validate
     * @returns {boolean} - True if valid, false otherwise
     */
    isValidHash(hash) {
        if (!hash || typeof hash !== 'string') return false;
        
        // Remove any file extension if present (common hash lengths: MD5=32, SHA1=40, SHA256=64)
        // But we want to detect if the hash itself contains an extension
        const trimmedHash = hash.trim();
        
        // Check if it ends with a file extension (this would be invalid)
        if (/\.(png|jpg|jpeg|webp|gif|bmp|svg)$/i.test(trimmedHash)) {
            return false; // Hash contains file extension - invalid
        }
        
        // Accept common hash lengths: MD5 (32), SHA1 (40), SHA256 (64), SHA512 (128)
        // Also accept other reasonable hash lengths (16-128 hex characters)
        const hashLength = trimmedHash.length;
        if (hashLength < 16 || hashLength > 128) {
            return false; // Too short or too long to be a valid hash
        }
        
        // Must be all hexadecimal characters
        return /^[a-f0-9]+$/i.test(trimmedHash);
    }

    /**
     * Generate preview image for a cache file
     * @param {string} hash - The cache file hash
     * @param {string} imagePath - Path to the source image file
     * @returns {Promise<boolean>} - True if preview was generated, false if it already existed
     */
    async generateCachePreview(hash, imagePath) {
        try {
            const previewCacheDir = this.globalResources.getPath('previewCache');
            const previewPath = path.join(previewCacheDir, `${hash}.webp`);
            
            // Check if preview already exists
            if (fs.existsSync(previewPath)) {
                return false; // Preview already exists
            }
            
            // Ensure preview cache directory exists
            if (!fs.existsSync(previewCacheDir)) {
                fs.mkdirSync(previewCacheDir, { recursive: true });
            }
            
            // Read the image file
            const imageBuffer = fs.readFileSync(imagePath);
            
            // Generate preview using sharp
            await sharp(imageBuffer)
                .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                .webp({ quality: 80 })
                .toFile(previewPath);
            
            return true; // Preview was generated
        } catch (err) {
            console.warn(`Failed to generate preview for cache file ${hash.substring(0, 16)}...: ${err.message}`);
            return false;
        }
    }

    /**
     * Find a cache file by hash, checking multiple locations and extensions
     * @param {string} hash - The hash to search for
     * @returns {Object|null} - Object with path and stats, or null if not found
     */
    findCacheFile(hash) {
        // Cache files should NOT have extensions - try without extension first
        const cacheFilePath = path.join(this.UPLOAD_CACHE_DIR, hash);
        try {
            const stats = fs.statSync(cacheFilePath);
            return { path: cacheFilePath, stats };
        } catch (err) {
            // If not found without extension, try with extensions (legacy files that might have extensions)
            for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
                try {
                    const pathWithExt = cacheFilePath + ext;
                    const stats = fs.statSync(pathWithExt);
                    return { path: pathWithExt, stats };
                } catch (e) {
                    // Continue to next extension
                }
            }
        }

        // If not found in cache, try images directory without extension first
        const imagesFilePath = path.join(this.IMAGES_DIR, hash);
        try {
            const stats = fs.statSync(imagesFilePath);
            return { path: imagesFilePath, stats };
        } catch (err2) {
            // Try with extensions in images directory (legacy)
            for (const ext of ['.png', '.jpg', '.jpeg', '.webp']) {
                try {
                    const pathWithExt = imagesFilePath + ext;
                    const stats = fs.statSync(pathWithExt);
                    return { path: pathWithExt, stats };
                } catch (e) {
                    // Continue to next extension
                }
            }
        }

        return null;
    }

    // Sync workspace files with actual filesystem
    async syncWorkspaceFiles() {
        try {
            // Get clone for modification
            const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });

            // Get all image files from the images directory
            const imageFiles = fs.readdirSync(this.IMAGES_DIR)
                .filter(f => f.match(/\.(png|jpg|jpeg)$/i))
                .filter(f => !f.startsWith('.'));

            // Track all files that exist in workspaces (both files and scraps)
            const workspaceFiles = new Set();
            Object.values(workspaces).forEach(workspace => {
                // Add files from the files array
                workspace.files.forEach(file => workspaceFiles.add(file));
                // Add files from the scraps array
                if (workspace.scraps) {
                    workspace.scraps.forEach(file => workspaceFiles.add(file));
                }
            });

            // Add missing files to default workspace
            const missingFiles = imageFiles.filter(file => !workspaceFiles.has(file));
            if (missingFiles.length > 0) {
                // Sort missing files by timestamp before adding
                const sortedMissingFiles = this.sortFilesByTimestamp(missingFiles);
                workspaces.default.files.push(...sortedMissingFiles);
            }

            // Remove non-existent files from all workspaces (both files and scraps)
            let removedCount = 0;
            Object.values(workspaces).forEach(workspace => {
                // Remove from files array
                const originalFilesLength = workspace.files.length;
                workspace.files = workspace.files.filter(file => imageFiles.includes(file));
                removedCount += originalFilesLength - workspace.files.length;

                // Remove from scraps array
                if (workspace.scraps) {
                    const originalScrapsLength = workspace.scraps.length;
                    workspace.scraps = workspace.scraps.filter(file => imageFiles.includes(file));
                    removedCount += originalScrapsLength - workspace.scraps.length;
                }

                // Remove from pinned array
                if (workspace.pinned) {
                    const originalPinnedLength = workspace.pinned.length;
                    workspace.pinned = workspace.pinned.filter(file => imageFiles.includes(file));
                    removedCount += originalPinnedLength - workspace.pinned.length;
                }
            });

            if (removedCount > 0) {
            }

            // Save changes if any were made
            if (missingFiles.length > 0 || removedCount > 0) {
                this.globalResources.saveConfig('workspaces', workspaces);
                this.bumpAllGalleryDestructiveTimestamps();
            }

            // Sync pinned/scrapped files to ensure consistency
            this.syncWorkspacePinnedScraps();
            
        } catch (error) {
            console.error('Error syncing workspace files:', error.message || error);
        }
    }

    // Get all workspaces
    getWorkspaces() {
        return this.globalResources.getWorkspacesConfig();
    }

    // Get a specific workspace
    getWorkspace(id) {
        const workspaces = this.globalResources.getWorkspacesConfig();
        return workspaces[id] || null;
    }

    // Create a new workspace
    createWorkspace(name, color = null, backgroundColor = null) {

        // Get clone for modification
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        const id = this.generateUUID();

        // Find the highest sort value and add 1 for the new workspace
        const maxSort = Math.max(...Object.values(workspaces).map(w => w.sort || 0), -1);

        workspaces[id] = {
            name: name,
            color: color || this.getRandomWorkspaceColor(),
            backgroundColor: backgroundColor, // Can be null for auto-generation
            primaryFont: null,
            textareaFont: null,
            trashDesktopShortcut: false,
            sort: maxSort + 1, // Add to the end of the list
            presets: [],
            files: [],
            scraps: [],
            pinned: [], // Initialize empty pinned array
            groups: {}, // Initialize empty groups object
            lastGalleryDestructiveAt: 0
        };

        // Save using config manager
        this.globalResources.saveConfig('workspaces', workspaces);
        console.log(`✅ Created workspace: ${name} (${id}) with color: ${workspaces[id].color} and sort: ${workspaces[id].sort}`);
        return id;
    }

    // Rename a workspace
    renameWorkspace(id, newName) {

        if (id === 'default') {
            throw new Error('Cannot rename the default workspace');
        }

        const workspace = this.globalResources.getWorkspacesConfig({ path: id });
        if (!workspace) {
            throw new Error(`Workspace ${id} not found`);
        }

        const oldName = workspace.name;
        this.globalResources.modifyConfig('workspaces').assign([id, 'name'], newName);
        console.log(`✅ Renamed workspace: ${oldName} -> ${newName}`);
    }

    // Update workspace color
    updateWorkspaceColor(id, color) {
        // Check workspace exists
        const workspace = this.globalResources.getWorkspacesConfig({ path: id });
        if (!workspace) {
            throw new Error(`Workspace ${id} not found`);
        }

        // Update color (fluent API)
        this.globalResources.modifyConfig('workspaces').assign([id, 'color'], color);
        // Recompile theme CSS now (cache is already updated) instead of waiting for debounced disk write
        this.globalResources.scheduleWorkspaceCssRecompile();
    }

    // Update workspace background color
    updateWorkspaceBackgroundColor(id, backgroundColor) {
        // Check workspace exists
        const workspace = this.globalResources.getWorkspacesConfig({ path: id });
        if (!workspace) {
            throw new Error(`Workspace ${id} not found`);
        }

        this.globalResources.modifyConfig('workspaces').assign([id, 'backgroundColor'], backgroundColor);
        // Recompile theme CSS now (cache is already updated) instead of waiting for debounced disk write
        this.globalResources.scheduleWorkspaceCssRecompile();
    }

    // Update multiple workspace settings at once and save once
    updateWorkspaceSettings(id, settings = {}) {
        const workspace = this.globalResources.getWorkspacesConfig({ path: id });
        if (!workspace) {
            throw new Error(`Workspace ${id} not found`);
        }

        // Build updates object
        const updates = {};
        if (typeof settings.name === 'string' && settings.name.trim() && id !== 'default') {
            updates.name = settings.name.trim();
        }
        if (typeof settings.color === 'string' && settings.color.trim()) {
            updates.color = settings.color.trim();
        }
        if (typeof settings.backgroundColor !== 'undefined') {
            updates.backgroundColor = settings.backgroundColor || null;
        }
        if (typeof settings.primaryFont !== 'undefined') {
            updates.primaryFont = settings.primaryFont || null;
        }
        if (typeof settings.textareaFont !== 'undefined') {
            updates.textareaFont = settings.textareaFont || null;
        }
        if (typeof settings.wallpaper !== 'undefined') {
            updates.wallpaper = settings.wallpaper || null;
        }
        if (typeof settings.wallpaperPosition !== 'undefined') {
            updates.wallpaperPosition = settings.wallpaperPosition || null;
        }
        if (typeof settings.trashDesktopShortcut !== 'undefined') {
            updates.trashDesktopShortcut = settings.trashDesktopShortcut === true;
        }

        // Merge all updates at once (fluent API - use array notation for workspace ID)
        this.globalResources.modifyConfig('workspaces').merge([id], updates);
        // Recompile theme CSS now (cache is already updated) instead of waiting for debounced disk write
        this.globalResources.scheduleWorkspaceCssRecompile();
    }

    // Update workspace primary (UI) font
    updateWorkspacePrimaryFont(id, primaryFont) {
        const workspace = this.globalResources.getWorkspacesConfig({ path: id });
        if (!workspace) {
            throw new Error(`Workspace ${id} not found`);
        }

        const oldFont = workspace.primaryFont;
        this.globalResources.modifyConfig('workspaces').assign([id, 'primaryFont'], primaryFont || null);
        // Recompile theme CSS now (cache is already updated) instead of waiting for debounced disk write
        this.globalResources.scheduleWorkspaceCssRecompile();
        console.log(`🔤 Updated workspace primary font: ${workspace.name} ${oldFont} -> ${primaryFont}`);
    }

    // Update workspace textarea (mono) font
    updateWorkspaceTextareaFont(id, textareaFont) {
        const workspace = this.globalResources.getWorkspacesConfig({ path: id });
        if (!workspace) {
            throw new Error(`Workspace ${id} not found`);
        }

        const oldFont = workspace.textareaFont;
        this.globalResources.modifyConfig('workspaces').assign([id, 'textareaFont'], textareaFont || null);
        // Recompile theme CSS now (cache is already updated) instead of waiting for debounced disk write
        this.globalResources.scheduleWorkspaceCssRecompile();
        console.log(`🔤 Updated workspace textarea font: ${workspace.name} ${oldFont} -> ${textareaFont}`);
    }

    // Delete a workspace
    async deleteWorkspace(id) {

        if (id === 'default') {
            throw new Error('Cannot delete the default workspace');
        }

        // Get clone for modification
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces[id]) {
            throw new Error(`Workspace ${id} not found`);
        }

        const workspace = workspaces[id];
        const name = workspace.name;

        // Move references and vibes to default workspace in database
        const refDb = this.globalResources.getReferenceMetadataDatabase();
        const movedRefs = refDb.moveAllReferencesBetweenWorkspaces(id, 'default');
        const movedVibes = refDb.moveAllVibesBetweenWorkspaces(id, 'default');

        // Count items being moved (use database counts for references/vibes)
        const movedCount =
            (workspace.presets?.length || 0) +
            movedVibes + // Use database count
            movedRefs + // Use database count
            (workspace.files?.length || 0) +
            (workspace.scraps?.length || 0) +
            (workspace.pinned?.length || 0);

        workspaces.default.presets.push(...workspace.presets);
        workspaces.default.files.push(...workspace.files);
        workspaces.default.scraps.push(...workspace.scraps);
        workspaces.default.pinned.push(...workspace.pinned);

        // Remove duplicates
        workspaces.default.presets = [...new Set(workspaces.default.presets)];
        workspaces.default.files = [...new Set(workspaces.default.files)];
        workspaces.default.scraps = [...new Set(workspaces.default.scraps)];
        workspaces.default.pinned = [...new Set(workspaces.default.pinned)];

        delete workspaces[id];
        this.globalResources.saveConfig('workspaces', workspaces);
        this.bumpGalleryDestructiveTimestamp(['default']);

        // Delete notes associated with this workspace
        if (this.globalResources.getNotesDatabase()) {
            await this.globalResources.getNotesDatabase().deleteNotesByWorkspace(id);
            console.log(`✅ Deleted notes for workspace: ${name}`);
        }

        console.log(`✅ Deleted workspace: ${name} - moved ${movedRefs} references and ${movedVibes} vibes to default workspace (${movedCount} total items)`);

        return movedCount;
    }

    // Dump workspace (merge items into another workspace)
    async dumpWorkspace(sourceId, targetId) {

        if (sourceId === 'default') {
            throw new Error('Cannot dump the default workspace');
        }

        // Get clone for modification
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces[sourceId] || !workspaces[targetId]) {
            throw new Error('Source or target workspace not found');
        }

        const sourceWorkspace = workspaces[sourceId];
        const targetWorkspace = workspaces[targetId];
        const sourceName = sourceWorkspace.name;
        const targetName = targetWorkspace.name;

        // Move references and vibes to target workspace in database
        const refDb = this.globalResources.getReferenceMetadataDatabase();
        const movedRefs = refDb.moveAllReferencesBetweenWorkspaces(sourceId, targetId);
        const movedVibes = refDb.moveAllVibesBetweenWorkspaces(sourceId, targetId);

        // Count items being moved (use database counts for references/vibes)
        const movedCount =
            (sourceWorkspace.presets?.length || 0) +
            movedVibes + // Use database count
            movedRefs + // Use database count
            (sourceWorkspace.files?.length || 0) +
            (sourceWorkspace.scraps?.length || 0) +
            (sourceWorkspace.pinned?.length || 0);

        targetWorkspace.presets.push(...sourceWorkspace.presets);
        targetWorkspace.files.push(...sourceWorkspace.files);
        targetWorkspace.scraps.push(...sourceWorkspace.scraps);
        targetWorkspace.pinned.push(...sourceWorkspace.pinned);

        // Remove duplicates
        targetWorkspace.presets = [...new Set(targetWorkspace.presets)];
        targetWorkspace.files = [...new Set(targetWorkspace.files)];
        targetWorkspace.scraps = [...new Set(targetWorkspace.scraps)];
        targetWorkspace.pinned = [...new Set(targetWorkspace.pinned)];

        delete workspaces[sourceId];
        this.globalResources.saveConfig('workspaces', workspaces);
        this.bumpGalleryDestructiveTimestamp([targetId]);

        // Move notes to target workspace
        if (this.globalResources.getNotesDatabase()) {
            await this.globalResources.getNotesDatabase().moveNotesToWorkspace(sourceId, targetId);
            console.log(`✅ Moved notes from ${sourceName} to ${targetName}`);
        }

        console.log(`✅ Dumped workspace: ${sourceName} -> ${targetName} - moved ${movedRefs} references and ${movedVibes} vibes (${movedCount} total items)`);

        return movedCount;
    }

    // Helper: extract timestamp from filename (first part when splitting by _)
    getTimestampFromFilename(filename) {
        if (!filename || typeof filename !== 'string') {
            return null;
        }

        const parts = filename.split('_');
        if (parts.length > 0) {
            const timestamp = parseInt(parts[0]);
            if (!isNaN(timestamp)) {
                return timestamp;
            }
        }
        return null;
    }

    // Helper: get file creation date from filesystem
    getFileCreationDate(filename) {
        try {
            const filePath = path.join(this.IMAGES_DIR, filename);
            const stats = fs.statSync(filePath);
            return stats.birthtime.getTime() || stats.mtime.getTime();
        } catch (error) {
            console.warn(`Could not get creation date for ${filename}:`, error.message);
            return Date.now(); // Fallback to current time
        }
    }

    // Helper: sort files by timestamp (newest first)
    sortFilesByTimestamp(files) {
        return files.sort((a, b) => {
            // Try to get timestamp from filename first
            const timestampA = this.getTimestampFromFilename(a);
            const timestampB = this.getTimestampFromFilename(b);

            // If both have timestamps, compare them
            if (timestampA && timestampB) {
                return timestampB - timestampA; // Newest first
            }

            // If only one has timestamp, prioritize the one with timestamp
            if (timestampA && !timestampB) {
                return -1; // A comes first
            }
            if (!timestampA && timestampB) {
                return 1; // B comes first
            }

            // If neither has timestamp, use filesystem creation date
            const dateA = this.getFileCreationDate(a);
            const dateB = this.getFileCreationDate(b);
            return dateB - dateA; // Newest first
        });
    }

    // Helper: find all related files for a given filename
    findRelatedFiles(filename, allFiles) {
        if (!filename || typeof filename !== 'string') {
            return [];
        }

        // Use this.globalResources instead
        const baseName = this.globalResources.getPngMetadata().getBaseName(filename);
        if (!baseName) {
            return [filename]; // Return just the original filename if base name extraction fails
        }

        const relatedFiles = [];

        // Find all files that share the same base name
        for (const file of allFiles) {
            if (file && typeof file === 'string' && this.globalResources.getPngMetadata().getBaseName(file) === baseName) {
                relatedFiles.push(file);
            }
        }

        return relatedFiles;
    }

    bumpGalleryDestructiveTimestamp(workspaceIds = []) {
        const ids = [...new Set((workspaceIds || []).filter(id => id && typeof id === 'string'))];
        if (ids.length === 0) {
            return;
        }
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        const now = Date.now();
        let changed = false;
        for (const id of ids) {
            if (!workspaces[id]) {
                continue;
            }
            workspaces[id].lastGalleryDestructiveAt = now;
            changed = true;
        }
        if (changed) {
            this.globalResources.saveConfig('workspaces', workspaces);
        }
    }

    bumpAllGalleryDestructiveTimestamps() {
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        const now = Date.now();
        for (const id of Object.keys(workspaces)) {
            if (workspaces[id]) {
                workspaces[id].lastGalleryDestructiveAt = now;
            }
        }
        this.globalResources.saveConfig('workspaces', workspaces);
    }

    // Move files between this.workspaces
    moveFilesToWorkspace(filenames, targetWorkspaceId, sourceWorkspaceId = null) {
        return this.moveToWorkspaceArray('files', filenames, targetWorkspaceId, sourceWorkspaceId);
    }

    // Move pinned images to workspace
    movePinnedToWorkspace(filenames, targetWorkspaceId) {
        return this.moveToWorkspaceArray('pinned', filenames, targetWorkspaceId);
    }

    // Get active workspace for a specific session
    getActiveWorkspace(sessionId) {
        if (!sessionId) {
            throw new Error('Session ID is required to determine active workspace');
        }

        const sessionWorkspace = this.sessionActiveWorkspaces.get(sessionId);
        return sessionWorkspace || 'default';
    }

    // Set active workspace for a specific session
    setActiveWorkspace(id, sessionId = null) {

        const workspaces = this.globalResources.getWorkspacesConfig();
        if (!workspaces[id]) {
            throw new Error(`Workspace ${id} not found`);
        }

        if (sessionId) {
            this.sessionActiveWorkspaces.set(sessionId, id);
            const workspaces = this.globalResources.getWorkspacesConfig();
            console.log(`✅ Active workspace set to: ${workspaces[id].name} (${id}) for session: ${sessionId}`);

            // Store the workspace preference in the session for persistence
            try {
                // Use this.globalResources instead
                if (!!this.globalResources.getSessionStore()) {
                    this.globalResources.getSessionStore().get(sessionId, (err, session) => {
                        if (!err && session) {
                            session.lastActiveWorkspace = id;
                            session.lastActiveWorkspaceTime = Date.now();
                            this.globalResources.getSessionStore().set(sessionId, session, (setErr) => {
                                if (setErr) {
                                    console.warn(`⚠️ Failed to persist workspace preference for session ${sessionId}:`, setErr.message);
                                } else {
                                    console.log(`💾 Persisted workspace preference for session ${sessionId}: ${id}`);
                                }
                            });
                        }
                    });
                }
            } catch (error) {
                console.warn(`⚠️ Could not persist workspace preference for session ${sessionId}:`, error.message);
            }
        }
    }

    // Clean up session workspace when session ends
    cleanupSessionWorkspace(sessionId) {
        if (sessionId && this.sessionActiveWorkspaces.has(sessionId)) {
            this.sessionActiveWorkspaces.delete(sessionId);
            console.log(`🧹 Cleaned up workspace for session: ${sessionId}`);
        }
    }

    // Restore session workspace from persistent storage
    restoreSessionWorkspace(sessionId) {
        if (!sessionId) return 'default';

        try {
            // Use this.globalResources instead
            if (!!this.globalResources.getSessionStore()) {
                return new Promise((resolve) => {
                    this.globalResources.getSessionStore().get(sessionId, (err, session) => {
                        if (err) {
                            console.log(`❌ Error retrieving session ${sessionId}:`, err.message);
                            // Set default workspace on error
                            this.ensureDefaultWorkspace(sessionId);
                            resolve('default');
                            return;
                        }

                        if (!session) {
                            this.ensureDefaultWorkspace(sessionId);
                            resolve('default');
                            return;
                        }

                        const lastWorkspace = session.lastActiveWorkspace;
                        const lastWorkspaceTime = session.lastActiveWorkspaceTime;


                        if (lastWorkspace && lastWorkspaceTime) {
                            // Check if the workspace still exists
                            const workspaces = this.globalResources.getWorkspacesConfig();
                            if (workspaces && workspaces[lastWorkspace]) {
                                // Check if the session is not too old (e.g., within 24 hours)
                                const sessionAge = Date.now() - lastWorkspaceTime;
                                const maxAge = 3 * 24 * 60 * 60 * 1000; // 3 days

                                if (sessionAge < maxAge) {
                                    this.sessionActiveWorkspaces.set(sessionId, lastWorkspace);
                                    resolve(lastWorkspace);
                                    return;
                                } else {
                                    console.log(`⏰ Session workspace too old for ${sessionId}: ${Math.round(sessionAge / 1000 / 60 / 60)} hours`);
                                }
                            } else {
                                console.log(`⚠️ Previously active workspace ${lastWorkspace} no longer exists for session ${sessionId}`);
                            }
                        }

                        // Always ensure a workspace is set (default if no saved workspace)
                        this.ensureDefaultWorkspace(sessionId);
                        resolve('default');
                    });
                });
            } else {
                console.log(`⚠️ No valid session store available for session ${sessionId} - using default workspace`);
                // Set default workspace even without session store
                this.ensureDefaultWorkspace(sessionId);
                return 'default';
            }
        } catch (error) {
            console.error('Error in restoreSessionWorkspace:', error);
            // Set default workspace on error
            this.ensureDefaultWorkspace(sessionId);
            return 'default';
        }
    }

    // Helper function to ensure a session has a workspace set
    ensureDefaultWorkspace(sessionId) {
        if (!sessionId) return;

        // Ensure default workspace exists
        const workspaces = this.globalResources.getWorkspacesConfig();
        if (!workspaces || !workspaces.default) {
            console.error('❌ Default workspace not found - this should not happen');
            return;
        }

        // Set the session to use default workspace
        this.sessionActiveWorkspaces.set(sessionId, 'default');

        // Try to persist this in the session store if available
        try {
            // Use this.globalResources instead
            if (!!this.globalResources.getSessionStore()) {
                this.globalResources.getSessionStore().get(sessionId, (err, session) => {
                    if (!err && session) {
                        session.lastActiveWorkspace = 'default';
                        session.lastActiveWorkspaceTime = Date.now();
                        this.globalResources.getSessionStore().set(sessionId, session, (setErr) => {
                            if (setErr) {
                                console.warn(`⚠️ Could not persist default workspace for session ${sessionId}:`, setErr.message);
                            }
                        });
                    }
                });
            }
        } catch (error) {
            console.warn('⚠️ Could not persist default workspace in session store:', error.message);
        }
    }

    // Get files for active workspace (includes default)
    getActiveWorkspaceFiles(sessionId = null) {

        if (!sessionId) {
            throw new Error('Session ID is required to get active workspace files');
        }

        const workspaceId = this.getActiveWorkspace(sessionId);
        // Include active workspace files if not default
        const workspaces = this.globalResources.getWorkspacesConfig();
        if (workspaces[workspaceId]) {
            return workspaces[workspaceId].files;
        }
        return workspaces.default.files;
    }

    // Get cache files for active workspace (includes default) - uses database as source of truth
    getActiveWorkspaceCacheFiles(workspaceId = null, sessionId = null) {
        const refDb = this.globalResources.getReferenceMetadataDatabase();
        const files = new Set();

        if (workspaceId) {
            // Get cache files for specific workspace from database
            const workspaceRefs = refDb.getWorkspaceReferences(workspaceId);
            workspaceRefs.forEach(hash => files.add(hash));
        } else {
            // No specific workspace ID provided, use session ID to get active workspace
            if (!sessionId) {
                throw new Error('Session ID is required to get active workspace cache files');
            }

            // Always include default workspace cache files from database
            const defaultRefs = refDb.getWorkspaceReferences('default');
            defaultRefs.forEach(hash => files.add(hash));

            // Get cache files from the active workspace for this session from database
            const currentActiveWorkspace = this.getActiveWorkspace(sessionId);
            if (currentActiveWorkspace && currentActiveWorkspace !== 'default') {
                const activeRefs = refDb.getWorkspaceReferences(currentActiveWorkspace);
                activeRefs.forEach(hash => files.add(hash));
            }
        }

        return Array.from(files);
    }

    // Sort all workspace files by timestamp
    sortAllWorkspaceFiles() {

        let totalSorted = 0;
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        Object.values(workspaces).forEach(workspace => {
            if (workspace.files && workspace.files.length > 0) {
                const originalOrder = [...workspace.files];
                workspace.files = this.sortFilesByTimestamp(workspace.files);

                // Check if order changed
                const orderChanged = originalOrder.some((file, index) => file !== workspace.files[index]);
                if (orderChanged) {
                    totalSorted += workspace.files.length;
                }
            }
        });

        if (totalSorted > 0) {
            this.globalResources.saveConfig('workspaces', workspaces);
        }
    }

    // Organize orphaned upscaled and pinned files to their correct this.workspaces
    organizeOrphanedFiles() {

        let movedCount = 0;

        // Get all files from filesystem to check for orphaned upscaled files
        if (!fs.existsSync(this.IMAGES_DIR)) {
            return movedCount;
        }

        const allImageFiles = fs.readdirSync(this.IMAGES_DIR)
            .filter(f => f.match(/\.(png|jpg|jpeg)$/i))
            .filter(f => !f.startsWith('.'));

        // Find upscaled files that are orphaned (original is in a workspace but upscaled is not)
        const upscaledFiles = allImageFiles.filter(f => f.includes('_upscaled'));
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });

        for (const upscaledFile of upscaledFiles) {
            // Get the original file name
            const originalFile = upscaledFile.replace('_upscaled.', '.');

            // Find which workspace contains the original file
            let originalWorkspaceId = null;
            for (const [workspaceId, workspace] of Object.entries(workspaces)) {
                if (workspace.files && workspace.files.includes(originalFile)) {
                    originalWorkspaceId = workspaceId;
                    break;
                }
                if (workspace.scraps && workspace.scraps.includes(originalFile)) {
                    originalWorkspaceId = workspaceId;
                    break;
                }
                if (workspace.pinned && workspace.pinned.includes(originalFile)) {
                    originalWorkspaceId = workspaceId;
                    break;
                }
            }

            // If original is in a workspace but upscaled is not, move upscaled to same workspace
            if (originalWorkspaceId) {
                let upscaledIsOrphaned = true;
                for (const workspace of Object.values(workspaces)) {
                    if ((workspace.files && workspace.files.includes(upscaledFile)) ||
                        (workspace.scraps && workspace.scraps.includes(upscaledFile)) ||
                        (workspace.pinned && workspace.pinned.includes(upscaledFile))) {
                        upscaledIsOrphaned = false;
                        break;
                    }
                }

                if (upscaledIsOrphaned) {
                    // Add upscaled file to the same workspace as original
                    const targetWorkspace = workspaces[originalWorkspaceId];
                    if (targetWorkspace.files && targetWorkspace.files.includes(originalFile)) {
                        targetWorkspace.files.push(upscaledFile);
                        movedCount++;
                        console.log(`📁 Moved orphaned upscaled file ${upscaledFile} to workspace ${targetWorkspace.name}`);
                    } else if (targetWorkspace.scraps && targetWorkspace.scraps.includes(originalFile)) {
                        targetWorkspace.scraps.push(upscaledFile);
                        movedCount++;
                        console.log(`📁 Moved orphaned upscaled file ${upscaledFile} to scraps in workspace ${targetWorkspace.name}`);
                    } else if (targetWorkspace.pinned && targetWorkspace.pinned.includes(originalFile)) {
                        targetWorkspace.pinned.push(upscaledFile);
                        movedCount++;
                        console.log(`📁 Moved orphaned upscaled file ${upscaledFile} to pinned in workspace ${targetWorkspace.name}`);
                    }
                }
            }
        }

        if (movedCount > 0) {
            this.globalResources.saveConfig('workspaces', workspaces);
            console.log(`✅ Organized ${movedCount} orphaned upscaled files to their correct this.workspaces`);
        }

        return movedCount;
    }

    // Initialize workspaces on module load
    initializeWorkspaces() {

        // Migrate and normalize workspace data
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        let needsSave = false;
        
        Object.values(workspaces).forEach(workspace => {
            // Ensure scraps arrays exist
            if (!workspace.scraps) {
                workspace.scraps = [];
                needsSave = true;
            }
            
            // Normalize wallpaper format to 2-part format (type:id) or url:
            if (workspace.wallpaper && typeof workspace.wallpaper === 'string') {
                const normalized = this.normalizeWallpaperPath(workspace.wallpaper);
                if (normalized !== workspace.wallpaper) {
                    workspace.wallpaper = normalized;
                    needsSave = true;
                }
            }
        });

        if (needsSave) {
            this.globalResources.saveConfig('workspaces', workspaces);
        }

        this.sortAllWorkspaceFiles(); // Sort existing files by timestamp
        this.organizeOrphanedFiles(); // Organize orphaned upscaled files
        this.pruneAllAbsentImageFilenamesOnBoot();

        if (this.globalResources && this.globalResources.getLogger) {
            const finalWorkspaces = this.globalResources.getWorkspacesConfig();
            this.globalResources.getLogger().bootSubStep(`Workspace system loaded (${Object.keys(finalWorkspaces).length} workspaces)`);
        }
    }

    // Get scraps for active workspace (only that workspace)
    getActiveWorkspaceScraps(sessionId = null) {

        if (!sessionId) {
            throw new Error('Session ID is required to get active workspace scraps');
        }

        const workspaceId = this.getActiveWorkspace(sessionId);
        const scraps = this.globalResources.getWorkspacesConfig({ path: [workspaceId, 'scraps'] });
        return scraps || [];
    }

    // Get pinned images for active workspace (only that workspace)
    getActiveWorkspacePinned(sessionId = null) {

        if (!sessionId) {
            throw new Error('Session ID is required to get active workspace pinned images');
        }

        const workspaceId = this.getActiveWorkspace(sessionId);
        const pinned = this.globalResources.getWorkspacesConfig({ path: [workspaceId, 'pinned'] });
        return pinned || [];
    }

    /**
     * Collect every files/scraps/pinned basename from all workspaces and prune missing images once at boot.
     */
    pruneAllAbsentImageFilenamesOnBoot() {
        const workspaces = this.globalResources.getWorkspacesConfig();
        const allFilenames = [];
        Object.values(workspaces).forEach(workspace => {
            if (!workspace) {
                return;
            }
            allFilenames.push(...(workspace.files || []));
            allFilenames.push(...(workspace.scraps || []));
            allFilenames.push(...(workspace.pinned || []));
        });
        this.pruneAbsentImageFilenamesFromWorkspaces(allFilenames);
    }

    /**
     * Read-only: return filenames from the given lists that still exist under IMAGES_DIR.
     * @param {...string[]} filenameLists One or more arrays of image basenames
     */
    filterFilenamesExistingOnDisk(...filenameLists) {
        const dir = this.IMAGES_DIR;
        const merged = [...new Set(
            filenameLists.flat().filter(f => typeof f === 'string' && f.length > 0)
        )];
        return new Set(merged.filter(f => fs.existsSync(path.join(dir, f))));
    }

    /**
     * Remove filenames that no longer exist on disk from files/scraps/pinned everywhere.
     * Returns a Set of filenames that still exist under IMAGES_DIR (from the merged candidate lists).
     * @param {...string[]} filenameLists One or more arrays of image basenames (e.g. workspace files + pinned)
     */
    pruneAbsentImageFilenamesFromWorkspaces(...filenameLists) {
        const dir = this.IMAGES_DIR;
        const merged = [...new Set(
            filenameLists.flat().filter(f => typeof f === 'string' && f.length > 0)
        )];
        if (merged.length === 0) {
            return new Set();
        }
        const missing = merged.filter(f => !fs.existsSync(path.join(dir, f)));
        if (missing.length > 0) {
            const totalRemoved = this.removeFilesFromWorkspaces(missing);
            if (totalRemoved > 0) {
                console.log(`🧹 Dropped ${missing.length} missing image(s) from workspaces (${totalRemoved} reference(s) removed)`);
            }
        }
        return new Set(merged.filter(f => fs.existsSync(path.join(dir, f))));
    }

    // Remove files from all this.workspaces (used when files are deleted)
    removeFilesFromWorkspaces(filenames) {
        // Filter out null/invalid filenames
        const validFilenames = filenames.filter(filename => filename && typeof filename === 'string');
        if (validFilenames.length === 0) {
            console.log('⚠️ No valid filenames provided for removal from this.workspaces');
            return 0;
        }

        let totalRemoved = 0;

        // Remove from all workspaces
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        let needsSave = false;
        Object.keys(workspaces).forEach(workspaceId => {
            const removed = this.removeFromWorkspaceArray('files', validFilenames, workspaceId, workspaces);
            if (removed > 0) {
                totalRemoved += removed;
                needsSave = true;
            }
            const removedScraps = this.removeFromWorkspaceArray('scraps', validFilenames, workspaceId, workspaces);
            if (removedScraps > 0) {
                totalRemoved += removedScraps;
                needsSave = true;
            }
            const removedPinned = this.removeFromWorkspaceArray('pinned', validFilenames, workspaceId, workspaces);
            if (removedPinned > 0) {
                totalRemoved += removedPinned;
                needsSave = true;
            }
        });

        if (needsSave) {
            this.globalResources.saveConfig('workspaces', workspaces);
            this.bumpAllGalleryDestructiveTimestamps();
        }

        if (totalRemoved > 0) {
        }

        return totalRemoved;
    }

    _galleryBucketForType(type) {
        if (type === 'files' || type === 'scraps' || type === 'pinned') return type;
        return null;
    }

    _queueGalleryOwnershipSync(changes) {
        if (!changes || changes.length === 0) return;
        if (!this.globalResources.isInitialized()) return;
        const metadataDb = this.globalResources.getMetadataDatabase();
        Promise.all(changes.map(({ op, filename, workspaceId, bucket }) => (
            op === 'upsert'
                ? metadataDb.upsertGalleryOwnership(filename, workspaceId, bucket)
                : metadataDb.removeGalleryOwnership(filename, workspaceId, bucket)
        ))).catch(err => {
            console.error('Gallery ownership sync failed:', err.message || err);
        });
    }

    // Common function to add items to workspace array
    addToWorkspaceArray(type, items, workspaceId = null, workspacesOverride = null) {
        const workspaces = workspacesOverride || this.globalResources.getWorkspacesConfig({ clone: true });

        const targetId = workspaceId || 'default';

        if (!workspaces[targetId]) {
            throw new Error(`Workspace ${targetId} not found`);
        }

        // Ensure items is an array
        const itemArray = Array.isArray(items) ? items : [items];

        // Filter out null/invalid items
        const validItems = itemArray.filter(item => item && typeof item === 'string');

        if (validItems.length === 0) {
            console.log(`⚠️ No valid ${type} provided for adding`);
            return 0;
        }

        let addedCount = 0;
        const actuallyAdded = [];

        switch (type) {
            case 'files': {
                const existingFilesSet = new Set(workspaces[targetId].files);
                validItems.forEach(item => {
                    if (!existingFilesSet.has(item)) {
                        workspaces[targetId].files.push(item);
                        existingFilesSet.add(item);
                        actuallyAdded.push(item);
                        addedCount++;
                    }
                });
                break;
            }

            case 'scraps': {
                // Initialize scraps array if it doesn't exist
                if (!workspaces[targetId].scraps) {
                    workspaces[targetId].scraps = [];
                }
                const existingScrapsSet = new Set(workspaces[targetId].scraps);
                validItems.forEach(item => {
                    if (!existingScrapsSet.has(item)) {
                        workspaces[targetId].scraps.push(item);
                        existingScrapsSet.add(item);
                        actuallyAdded.push(item);
                        // Remove from main files list when adding to scraps
                        workspaces[targetId].files = workspaces[targetId].files.filter(file => file !== item);
                        addedCount++;
                    }
                });
                const validItemsSet = new Set(validItems);
                // Remove from files list of all workspaces (since scraps are shared)
                Object.keys(workspaces).forEach(workspaceId => {
                    if (workspaces[workspaceId].files) {
                        workspaces[workspaceId].files = workspaces[workspaceId].files.filter(file => !validItemsSet.has(file));
                    }
                });
                break;
            }

            case 'presets': {
                const existingPresetsSet = new Set(workspaces[targetId].presets);
                validItems.forEach(item => {
                    if (!existingPresetsSet.has(item)) {
                        workspaces[targetId].presets.push(item);
                        existingPresetsSet.add(item);
                        addedCount++;
                    }
                });
                break;
            }

            case 'pinned': {
                const existingPinnedSet = new Set(workspaces[targetId].pinned);
                validItems.forEach(item => {
                    if (!existingPinnedSet.has(item)) {
                        workspaces[targetId].pinned.push(item);
                        existingPinnedSet.add(item);
                        actuallyAdded.push(item);
                        addedCount++;
                    }
                });
                break;
            }

            default:
                throw new Error(`Invalid type: ${type}. Must be one of: files, scraps, presets, pinned`);
        }

        if (addedCount > 0) {
            const bucket = this._galleryBucketForType(type);
            if (bucket && actuallyAdded.length > 0) {
                const ownershipChanges = actuallyAdded.map(filename => ({
                    op: 'upsert', filename, workspaceId: targetId, bucket
                }));
                if (type === 'scraps') {
                    Object.keys(workspaces).forEach(workspaceId => {
                        actuallyAdded.forEach(filename => {
                            ownershipChanges.push({
                                op: 'remove', filename, workspaceId, bucket: 'files'
                            });
                        });
                    });
                }
                this._queueGalleryOwnershipSync(ownershipChanges);
            }

            this.globalResources.saveConfig('workspaces', workspaces);
            if (type === 'scraps') {
                this.bumpAllGalleryDestructiveTimestamps();
            }

            // Broadcast image addition via WebSocket if type is 'files' (images)
            if (type === 'files') {
                // Broadcast workspace image addition via plumbing system
                // Use this.globalResources instead
                const plumbing = this.globalResources.getDataPlumbing();
                plumbing.publish('ws:broadcast:workspaceImageAdded', {
                    workspaceId: targetId,
                    imageFilenames: validItems
                });
            }
        }

        return addedCount;
    }

    // Common function to remove items from workspace array
    removeFromWorkspaceArray(type, items, workspaceId = null, workspacesOverride = null) {
        const workspaces = workspacesOverride || this.globalResources.getWorkspacesConfig({ clone: true });

        const targetId = workspaceId || 'default';

        if (!workspaces[targetId]) {
            throw new Error(`Workspace ${targetId} not found`);
        }

        // Ensure items is an array
        const itemArray = Array.isArray(items) ? items : [items];

        // Filter out null/invalid items
        const validItems = itemArray.filter(item => item && typeof item === 'string');

        if (validItems.length === 0) {
            console.log(`⚠️ No valid ${type} provided for removal`);
            return 0;
        }

        let removedCount = 0;
        const actuallyRemoved = [];

        switch (type) {
            case 'files': {
                const originalFilesLength = workspaces[targetId].files.length;
                actuallyRemoved.push(...workspaces[targetId].files.filter(item => validItems.includes(item)));
                workspaces[targetId].files = workspaces[targetId].files.filter(item => !validItems.includes(item));
                removedCount = originalFilesLength - workspaces[targetId].files.length;
                break;
            }

            case 'scraps':
                // Initialize scraps array if it doesn't exist
                if (!workspaces[targetId].scraps) {
                    workspaces[targetId].scraps = [];
                }
                const scrapsBefore = workspaces[targetId].scraps;
                actuallyRemoved.push(...scrapsBefore.filter(item => validItems.includes(item)));
                workspaces[targetId].scraps = scrapsBefore.filter(item => !validItems.includes(item));
                removedCount = scrapsBefore.length - workspaces[targetId].scraps.length;

                // For scraps, move removed items back to files of the target workspace
                if (removedCount > 0) {
                    const removedFromScraps = scrapsBefore.filter(item => validItems.includes(item));
                    removedFromScraps.forEach(item => {
                        if (!workspaces[targetId].files.includes(item)) {
                            workspaces[targetId].files.push(item);
                        }
                    });
                }

                // Also remove from default workspace scraps if not the default workspace (scraps are shared)
                if (targetId !== 'default' && workspaces.default && workspaces.default.scraps) {
                    workspaces.default.scraps = workspaces.default.scraps.filter(item => !validItems.includes(item));
                }
                break;

            case 'presets':
                const originalPresetsLength = workspaces[targetId].presets.length;
                workspaces[targetId].presets = workspaces[targetId].presets.filter(item => !validItems.includes(item));
                removedCount = originalPresetsLength - workspaces[targetId].presets.length;
                break;

            case 'pinned': {
                const originalPinnedLength = workspaces[targetId].pinned.length;
                actuallyRemoved.push(...workspaces[targetId].pinned.filter(item => validItems.includes(item)));
                workspaces[targetId].pinned = workspaces[targetId].pinned.filter(item => !validItems.includes(item));
                removedCount = originalPinnedLength - workspaces[targetId].pinned.length;
                break;
            }

            default:
                throw new Error(`Invalid type: ${type}. Must be one of: files, scraps, presets, pinned`);
        }

        if (removedCount > 0) {
            const bucket = this._galleryBucketForType(type);
            if (bucket && actuallyRemoved.length > 0) {
                const ownershipChanges = actuallyRemoved.map(filename => ({
                    op: 'remove', filename, workspaceId: targetId, bucket
                }));
                if (type === 'scraps') {
                    actuallyRemoved.forEach(filename => {
                        ownershipChanges.push({
                            op: 'upsert', filename, workspaceId: targetId, bucket: 'files'
                        });
                    });
                }
                this._queueGalleryOwnershipSync(ownershipChanges);
            }

            if (!workspacesOverride) {
                // If workspaces wasn't passed in, we need to save the clone we created
                this.globalResources.saveConfig('workspaces', workspaces);
                if (type === 'files') {
                    this.bumpGalleryDestructiveTimestamp([targetId]);
                }
            }
        }

        return removedCount;
    }

    // Common function to move items between workspaces
    moveToWorkspaceArray(type, items, targetWorkspaceId, sourceWorkspaceId = null) {
        // Get clone for modification
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });

        if (!workspaces[targetWorkspaceId]) {
            throw new Error(`Target workspace ${targetWorkspaceId} not found`);
        }

        // Ensure items is an array
        const itemArray = Array.isArray(items) ? items : [items];

        // Filter out null/invalid items
        let validItems = itemArray.filter(item => item && typeof item === 'string');

        if (validItems.length === 0) {
            console.log(`⚠️ No valid ${type} provided for moving`);
            return 0;
        }
        let movedCount = 0;

        // Handle database-only types (cacheFiles/vibeImages) directly - don't touch JSON arrays
        if (type === 'cacheFiles' || type === 'vibeImages') {
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const sourceId = sourceWorkspaceId || 'default';
            
            if (type === 'cacheFiles') {
                for (const hash of validItems) {
                    refDb.removeReferenceFromWorkspace(hash, sourceId);
                    refDb.addReferenceToWorkspace(hash, targetWorkspaceId);
                    movedCount++;
                }
            } else if (type === 'vibeImages') {
                // Move vibe images between workspaces in database
                // For vibeImages, validItems could be:
                // - Filenames like "vibeId.json" (from workspace.json arrays)
                // - Vibe IDs directly (from direct calls)
                for (const item of validItems) {
                    // Extract vibe ID - handle both "vibeId.json" format and direct vibe ID
                    const vibeId = item.endsWith('.json') ? item.replace('.json', '') : item;
                    
                    // Verify vibe exists before moving
                    const vibe = refDb.getVibeMetadata(vibeId);
                    if (vibe) {
                        refDb.removeVibeFromWorkspace(vibeId, sourceId);
                        refDb.addVibeToWorkspace(vibeId, targetWorkspaceId);
                        movedCount++;
                    } else {
                        console.warn(`⚠️ Vibe ${vibeId} not found in database, skipping move`);
                    }
                }
            }
            
            if (movedCount > 0) {
                const message = `✅ Moved ${movedCount} ${type} to workspace: ${workspaces[targetWorkspaceId].name}`;
                console.log(message);
            }
            
            return movedCount;
        }

        // Remove items from all this.workspaces first (if sourceWorkspaceId not specified)
        if (sourceWorkspaceId) {
            // Remove from specific source workspace
            if (!workspaces[sourceWorkspaceId]) {
                throw new Error(`Source workspace ${sourceWorkspaceId} not found`);
            }

            // For files, expand to include related/upscaled files before removing
            if (type === 'files') {
                // Get all files from all workspaces to find related files
                const allWorkspaceFiles = new Set();
                Object.values(workspaces).forEach(workspace => {
                    workspace.files.forEach(file => allWorkspaceFiles.add(file));
                });

                // Find all related files for each filename, including explicit upscaled variants
                const allFilesToMove = new Set();
                for (const filename of validItems) {
                    const baseName = this.globalResources.getPngMetadata().getBaseName(filename);
                    const extMatch = filename.match(/\.(png|jpg|jpeg)$/i);
                    const ext = extMatch ? extMatch[0] : '';
                    // Always add the original file
                    allFilesToMove.add(filename);
                    // Add upscaled variants if present in any workspace
                    const upscaled = `${baseName}_upscaled${ext}`;
                    if (allWorkspaceFiles.has(upscaled)) allFilesToMove.add(upscaled);
                    // Add all other related files (legacy logic)
                    const relatedFiles = this.findRelatedFiles(filename, Array.from(allWorkspaceFiles));
                    relatedFiles.forEach(file => allFilesToMove.add(file));
                }
                validItems = Array.from(allFilesToMove);
            }

            movedCount = this.removeFromWorkspaceArray(type, validItems, sourceWorkspaceId, workspaces);
        } else {
            // Remove from all workspaces
            Object.values(workspaces).forEach(workspace => {
                switch (type) {
                    case 'files':
                        // Get all files from all workspaces to find related files
                        const allWorkspaceFiles = new Set();
                        Object.values(workspaces).forEach(ws => {
                            ws.files.forEach(file => allWorkspaceFiles.add(file));
                        });

                        // Find all related files for each filename, including explicit upscaled variants
                        const allFilesToMove = new Set();
                        for (const filename of validItems) {
                            const baseName = this.globalResources.getPngMetadata().getBaseName(filename);
                            const extMatch = filename.match(/\.(png|jpg|jpeg)$/i);
                            const ext = extMatch ? extMatch[0] : '';
                            // Always add the original file
                            allFilesToMove.add(filename);
                            // Add upscaled variants if present in any workspace
                            const upscaled = `${baseName}_upscaled${ext}`;
                            if (allWorkspaceFiles.has(upscaled)) allFilesToMove.add(upscaled);
                            // Add all other related files (legacy logic)
                            const relatedFiles = this.findRelatedFiles(filename, Array.from(allWorkspaceFiles));
                            relatedFiles.forEach(file => allFilesToMove.add(file));
                        }
                        validItems = Array.from(allFilesToMove);

                        const originalFilesLength = workspace.files.length;
                        workspace.files = workspace.files.filter(item => !validItems.includes(item));
                        movedCount += originalFilesLength - workspace.files.length;
                        break;

                    case 'scraps':
                        if (workspace.scraps) {
                            const originalScrapsLength = workspace.scraps.length;
                            workspace.scraps = workspace.scraps.filter(item => !validItems.includes(item));
                            movedCount += originalScrapsLength - workspace.scraps.length;
                        }
                        break;

                    case 'presets':
                        const originalPresetsLength = workspace.presets.length;
                        workspace.presets = workspace.presets.filter(item => !validItems.includes(item));
                        movedCount += originalPresetsLength - workspace.presets.length;
                        break;

                    case 'pinned':
                        const originalPinnedLength = workspace.pinned.length;
                        workspace.pinned = workspace.pinned.filter(item => !validItems.includes(item));
                        movedCount += originalPinnedLength - workspace.pinned.length;
                        break;
                }
            });
        }

        // Add items to target workspace (avoiding duplicates)
        this.addToWorkspaceArray(type, validItems, targetWorkspaceId, workspaces);

        // If moving files, also handle pinned/scrapped files
        if (type === 'files' && movedCount > 0) {
            this.handlePinnedScrappedFilesOnMove(validItems, targetWorkspaceId, sourceWorkspaceId, workspaces);
        }

        if (movedCount > 0) {
            this.globalResources.saveConfig('workspaces', workspaces);
            if (type === 'files') {
                if (sourceWorkspaceId) {
                    this.bumpGalleryDestructiveTimestamp([sourceWorkspaceId, targetWorkspaceId]);
                } else {
                    this.bumpAllGalleryDestructiveTimestamps();
                }
            }
            const message = type === 'files' ?
                `✅ Moved ${movedCount} ${type} (including related and upscaled files) to workspace: ${workspaces[targetWorkspaceId].name}` :
                `✅ Moved ${movedCount} ${type} to workspace: ${workspaces[targetWorkspaceId].name}`;
            console.log(message);
        }

        return movedCount;
    }

    // Handle pinned/scrapped files when moving files between workspaces
    handlePinnedScrappedFilesOnMove(filenames, targetWorkspaceId, sourceWorkspaceId = null, workspaces = null) {
        // Get clone if not provided
        if (!workspaces) {
            workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        }

        if (!workspaces[targetWorkspaceId]) {
            console.error(`Target workspace ${targetWorkspaceId} not found for pinned/scrapped file handling`);
            return;
        }

        let pinnedMoved = 0;
        let scrapsMoved = 0;
        const ownershipChanges = [];

        // Check each file to see if it's pinned or scrapped in any workspace
        filenames.forEach(filename => {
            // Find which workspaces have this file pinned or scrapped
            const pinnedInWorkspaces = [];
            const scrappedInWorkspaces = [];

            Object.entries(workspaces).forEach(([workspaceId, workspace]) => {
                // Check if file is pinned in this workspace
                if (workspace.pinned && workspace.pinned.includes(filename)) {
                    pinnedInWorkspaces.push(workspaceId);
                }
                // Check if file is scrapped in this workspace
                if (workspace.scraps && workspace.scraps.includes(filename)) {
                    scrappedInWorkspaces.push(workspaceId);
                }
            });

            // Move pinned files to target workspace
            if (pinnedInWorkspaces.length > 0) {
                pinnedInWorkspaces.forEach(workspaceId => {
                    // Remove from source workspace
                    if (workspaces[workspaceId].pinned) {
                        workspaces[workspaceId].pinned = workspaces[workspaceId].pinned.filter(f => f !== filename);
                    }
                    ownershipChanges.push({
                        op: 'remove', filename, workspaceId, bucket: 'pinned'
                    });
                    pinnedMoved++;
                });

                // Add to target workspace (avoid duplicates)
                if (!workspaces[targetWorkspaceId].pinned) {
                    workspaces[targetWorkspaceId].pinned = [];
                }
                if (!workspaces[targetWorkspaceId].pinned.includes(filename)) {
                    workspaces[targetWorkspaceId].pinned.push(filename);
                    ownershipChanges.push({
                        op: 'upsert', filename, workspaceId: targetWorkspaceId, bucket: 'pinned'
                    });
                }
            }

            // Move scrapped files to target workspace
            if (scrappedInWorkspaces.length > 0) {
                scrappedInWorkspaces.forEach(workspaceId => {
                    if (workspaces[workspaceId].scraps) {
                        workspaces[workspaceId].scraps = workspaces[workspaceId].scraps.filter(f => f !== filename);
                    }
                    ownershipChanges.push({
                        op: 'remove', filename, workspaceId, bucket: 'scraps'
                    });
                    scrapsMoved++;
                });

                if (!workspaces[targetWorkspaceId].scraps) {
                    workspaces[targetWorkspaceId].scraps = [];
                }
                if (!workspaces[targetWorkspaceId].scraps.includes(filename)) {
                    workspaces[targetWorkspaceId].scraps.push(filename);
                    ownershipChanges.push({
                        op: 'upsert', filename, workspaceId: targetWorkspaceId, bucket: 'scraps'
                    });
                }
            }
        });

        if (pinnedMoved > 0 || scrapsMoved > 0) {
            this._queueGalleryOwnershipSync(ownershipChanges);
            this.globalResources.saveConfig('workspaces', workspaces);
            console.log(`📌 Moved ${pinnedMoved} pinned files and ${scrapsMoved} scrapped files to workspace: ${workspaces[targetWorkspaceId].name}`);
        }
    }

    // Sync pinned/scrapped files across this.workspaces to ensure consistency
    syncWorkspacePinnedScraps() {

        let correctionsMade = 0;
        const allFiles = new Set();

        // Get clone for modification
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        let needsSave = false;

        // Collect all files from all workspaces
        Object.values(workspaces).forEach(workspace => {
            workspace.files.forEach(file => allFiles.add(file));
        });

        // Check each workspace for pinned/scrapped files that don't exist in that workspace's files
        Object.entries(workspaces).forEach(([workspaceId, workspace]) => {
            const workspaceFiles = new Set(workspace.files);

            // Check pinned files
            if (workspace.pinned) {
                const invalidPinned = workspace.pinned.filter(file => !workspaceFiles.has(file));
                if (invalidPinned.length > 0) {
                    console.log(`🔧 Found ${invalidPinned.length} pinned files in workspace ${workspace.name} that are not in its files list`);

                    // Find which this.workspaces actually have these files
                    invalidPinned.forEach(file => {
                        const fileInWorkspaces = [];
                        Object.entries(workspaces).forEach(([wsId, ws]) => {
                            if (ws.files.includes(file)) {
                                fileInWorkspaces.push(wsId);
                            }
                        });

                        if (fileInWorkspaces.length > 0) {
                            // Move pinned file to the first workspace that has the file
                            const targetWorkspaceId = fileInWorkspaces[0];
                            if (targetWorkspaceId !== workspaceId) {
                                // Remove from current workspace
                                workspace.pinned = workspace.pinned.filter(f => f !== file);

                                // Add to target workspace
                                if (!workspaces[targetWorkspaceId].pinned) {
                                    workspaces[targetWorkspaceId].pinned = [];
                                }
                                if (!workspaces[targetWorkspaceId].pinned.includes(file)) {
                                    workspaces[targetWorkspaceId].pinned.push(file);
                                }

                                console.log(`📌 Moved pinned file ${file} from ${workspace.name} to ${workspaces[targetWorkspaceId].name}`);
                                correctionsMade++;
                                needsSave = true;
                            }
                        } else {
                            // File doesn't exist in any workspace, remove it
                            workspace.pinned = workspace.pinned.filter(f => f !== file);
                            console.log(`🗑️ Removed non-existent pinned file ${file} from ${workspace.name}`);
                            correctionsMade++;
                            needsSave = true;
                        }
                    });
                }
            }
        });

        if (needsSave) {
            console.log(`✅ Made ${correctionsMade} corrections to pinned files across this.workspaces`);
            this.globalResources.saveConfig('workspaces', workspaces);
        }
    }

    // Get this.workspaces data for server use
    getWorkspacesData() {
        return this.globalResources.getWorkspacesConfig();
    }

    // Get active workspace data for server use
    getActiveWorkspaceData(sessionId = null) {

        if (!sessionId) {
            throw new Error('Session ID is required to get active workspace data');
        }

        const workspaceId = this.getActiveWorkspace(sessionId);
        const workspaces = this.globalResources.getWorkspacesConfig();
        if (!workspaceId || !workspaces[workspaceId]) {
            console.warn(`⚠️ No active workspace found for session ${sessionId}`);
            return null;
        }

        return workspaces[workspaceId];
    }

    // Group management functions
    createGroup(workspaceId, name, imageFilenames = []) {
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces || !workspaces[workspaceId]) {
            throw new Error('Workspace not found');
        }

        const groupId = this.generateUUID();
        const workspace = workspaces[workspaceId];

        const newGroup = {
            id: groupId,
            name: name,
            images: imageFilenames,
            createdAt: Date.now(),
            updatedAt: Date.now()
        };

        this.globalResources.modifyConfig('workspaces').assign([workspaceId, 'groups', groupId], newGroup);
        return groupId;
    }

    getGroup(workspaceId, groupId) {
        const workspaces = this.globalResources.getWorkspacesConfig();
        if (!workspaces || !workspaces[workspaceId]) {
            return null;
        }

        return workspaces[workspaceId].groups[groupId] || null;
    }

    getWorkspaceGroups(workspaceId) {
        const workspaces = this.globalResources.getWorkspacesConfig();
        if (!workspaces || !workspaces[workspaceId]) {
            return [];
        }

        const groups = Object.values(workspaces[workspaceId].groups || {});
        return groups.sort((a, b) => b.updatedAt - a.updatedAt); // Sort by newest first
    }

    addImagesToGroup(workspaceId, groupId, imageFilenames) {
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces || !workspaces[workspaceId]) {
            throw new Error('Workspace not found');
        }
        const group = workspaces[workspaceId].groups[groupId];
        if (!group) {
            throw new Error('Group not found');
        }

        // Add new images (avoid duplicates)
        const newImages = imageFilenames.filter(filename => !group.images.includes(filename));
        group.images.push(...newImages);
        group.updatedAt = Date.now();

        this.globalResources.saveConfig('workspaces', workspaces);
        return newImages.length;
    }

    removeImagesFromGroup(workspaceId, groupId, imageFilenames) {
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces || !workspaces[workspaceId]) {
            throw new Error('Workspace not found');
        }
        const group = workspaces[workspaceId].groups[groupId];
        if (!group) {
            throw new Error('Group not found');
        }

        const originalCount = group.images.length;
        const updatedImages = group.images.filter(filename => !imageFilenames.includes(filename));

        this.globalResources.modifyConfig('workspaces').merge([workspaceId, 'groups', groupId], {
            images: updatedImages,
            updatedAt: Date.now()
        });

        return originalCount - updatedImages.length;
    }

    renameGroup(workspaceId, groupId, newName) {
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces || !workspaces[workspaceId]) {
            throw new Error('Workspace not found');
        }
        const group = workspaces[workspaceId].groups[groupId];
        if (!group) {
            throw new Error('Group not found');
        }

        this.globalResources.modifyConfig('workspaces').merge([workspaceId, 'groups', groupId], {
            name: newName,
            updatedAt: Date.now()
        });
    }

    deleteGroup(workspaceId, groupId) {
        const workspace = this.globalResources.getWorkspacesConfig({ path: workspaceId });
        if (!workspace) {
            throw new Error('Workspace not found');
        }
        if (!workspace.groups || !workspace.groups[groupId]) {
            throw new Error('Group not found');
        }

        this.globalResources.modifyConfig('workspaces').delete([workspaceId, 'groups', groupId]);
    }

    getGroupsForImage(workspaceId, imageFilename) {
        const workspaces = this.globalResources.getWorkspacesConfig();
        if (!workspaces || !workspaces[workspaceId]) {
            return [];
        }

        const groups = Object.values(workspaces[workspaceId].groups || {});
        return groups.filter(group => group.images.includes(imageFilename));
    }

    getActiveWorkspaceGroups(sessionId = null) {
        if (!sessionId) {
            throw new Error('Session ID is required to get active workspace groups');
        }

        const workspaceId = this.getActiveWorkspace(sessionId);
        return this.getWorkspaceGroups(workspaceId);
    }

    // Bulk operations for workspace arrays
    bulkAddToWorkspaceArray(type, items, workspaceId = null) {

        const targetWorkspaceId = workspaceId || 'default';
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces[targetWorkspaceId]) {
            throw new Error(`Workspace ${targetWorkspaceId} not found`);
        }

        // Ensure items is an array
        const itemArray = Array.isArray(items) ? items : [items];

        // Filter out null/invalid items
        const validItems = itemArray.filter(item => item && typeof item === 'string');

        if (validItems.length === 0) {
            console.log(`⚠️ No valid ${type} provided for bulk add`);
            return { success: true, addedCount: 0 };
        }

        let addedCount = 0;
        const workspace = workspaces[targetWorkspaceId];

        switch (type) {
            case 'pinned':
                if (!workspace.pinned) {
                    workspace.pinned = [];
                }
                for (const item of validItems) {
                    if (!workspace.pinned.includes(item)) {
                        workspace.pinned.push(item);
                        addedCount++;
                    }
                }
                break;
            case 'scraps':
                if (!workspace.scraps) {
                    workspace.scraps = [];
                }
                for (const item of validItems) {
                    if (!workspace.scraps.includes(item)) {
                        workspace.scraps.push(item);
                        addedCount++;
                    }
                }
                break;
            default:
                throw new Error(`Unsupported type for bulk add: ${type}`);
        }

        this.globalResources.saveConfig('workspaces', workspaces);
        return { success: true, addedCount };
    }

    bulkRemoveFromWorkspaceArray(type, items, workspaceId = null) {

        const targetWorkspaceId = workspaceId || 'default';
        const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });
        if (!workspaces[targetWorkspaceId]) {
            throw new Error(`Workspace ${targetWorkspaceId} not found`);
        }

        // Ensure items is an array
        const itemArray = Array.isArray(items) ? items : [items];

        // Filter out null/invalid items
        const validItems = itemArray.filter(item => item && typeof item === 'string');

        if (validItems.length === 0) {
            console.log(`⚠️ No valid ${type} provided for bulk remove`);
            return { success: true, removedCount: 0 };
        }

        let removedCount = 0;
        const workspace = workspaces[targetWorkspaceId];

        switch (type) {
            case 'pinned':
                if (workspace.pinned) {
                    const originalLength = workspace.pinned.length;
                    workspace.pinned = workspace.pinned.filter(item => !validItems.includes(item));
                    removedCount = originalLength - workspace.pinned.length;
                }
                break;
            case 'scraps':
                if (workspace.scraps) {
                    const originalLength = workspace.scraps.length;
                    workspace.scraps = workspace.scraps.filter(item => !validItems.includes(item));
                    removedCount = originalLength - workspace.scraps.length;
                }
                break;
            default:
                throw new Error(`Unsupported type for bulk remove: ${type}`);
        }

        this.globalResources.saveConfig('workspaces', workspaces);
        return { success: true, removedCount };
    }

    // Reorder this.workspaces based on provided order
    reorderWorkspaces(workspaceOrder) {
        try {
            // Validate input
            if (!Array.isArray(workspaceOrder)) {
                throw new Error('Workspace order must be an array');
            }

            // Get clone for modification
            const workspaces = this.globalResources.getWorkspacesConfig({ clone: true });

            // Check if all workspace IDs exist
            const existingWorkspaceIds = Object.keys(workspaces);
            const invalidIds = workspaceOrder.filter(id => !existingWorkspaceIds.includes(id));
            if (invalidIds.length > 0) {
                throw new Error(`Invalid workspace IDs: ${invalidIds.join(', ')}`);
            }

            // Update sort values based on the provided order
            workspaceOrder.forEach((workspaceId, index) => {
                if (workspaces[workspaceId]) {
                    workspaces[workspaceId].sort = index;
                }
            });

            // Save the updated workspaces
            this.globalResources.saveConfig('workspaces', workspaces);

            return { success: true, message: 'Workspaces reordered successfully' };
        } catch (error) {
            console.error('❌ Error reordering this.workspaces:', error);
            throw error;
        }
    }

    // ============================================================================
    // Desktop Shortcuts Management
    // ============================================================================

    static get TRASH_DESKTOP_SHORTCUT_KEY() {
        return 'trash';
    }

    getTrashDesktopNavPath(workspaceId) {
        return `/Workspaces/${workspaceId}/Trash`;
    }

    findTrashDesktopShortcut(workspaceId) {
        const { shortcuts } = this.getDesktopShortcuts(workspaceId);
        return (shortcuts || []).find((shortcut) =>
            shortcut?.type === 'system-folder'
            && shortcut?.data?.systemKey === WorkspaceManager.TRASH_DESKTOP_SHORTCUT_KEY
        ) || null;
    }

    syncTrashDesktopShortcut(workspaceId) {
        const workspace = this.getWorkspace(workspaceId);
        if (!workspace) {
            return { changed: false };
        }

        const enabled = workspace.trashDesktopShortcut === true;
        const existing = this.findTrashDesktopShortcut(workspaceId);
        const expectedNavPath = this.getTrashDesktopNavPath(workspaceId);

        if (enabled && !existing) {
            const result = this.addDesktopShortcut(workspaceId, {
                name: 'Trash',
                type: 'system-folder',
                folderId: null,
                system: true,
                protected: true,
                data: {
                    navPath: expectedNavPath,
                    systemKey: WorkspaceManager.TRASH_DESKTOP_SHORTCUT_KEY
                },
                position: { index: 0, pos: 0 }
            });
            return { changed: true, action: 'added', shortcut: result.shortcut };
        }

        if (!enabled && existing) {
            this.removeDesktopShortcut(workspaceId, existing.id, { allowProtectedSystem: true });
            return { changed: true, action: 'removed', shortcutId: existing.id };
        }

        if (enabled && existing && existing.data?.navPath !== expectedNavPath) {
            const result = this.updateDesktopShortcut(workspaceId, existing.id, {
                data: {
                    ...(existing.data || {}),
                    navPath: expectedNavPath,
                    systemKey: WorkspaceManager.TRASH_DESKTOP_SHORTCUT_KEY
                }
            });
            return {
                changed: true,
                action: 'updated',
                shortcutId: existing.id,
                updates: { data: result.shortcut.data },
                shortcut: result.shortcut
            };
        }

        return { changed: false };
    }

    // Get desktop shortcuts for a workspace (also returns global window positions from same file)
    getDesktopShortcuts(workspaceId) {
        try {
            // Get the full config once (more efficient than calling twice)
            const desktopConfig = this.globalResources.getWorkspaceDesktopConfig();
            // Extract workspace-specific shortcuts and global window positions from the same config
            const workspace = desktopConfig?.[workspaceId];
            return {
                shortcuts: workspace?.shortcuts || [],
                windowPositions: desktopConfig?.windowPositions || {} // Global, not per-workspace
            };
        } catch (error) {
            console.error('❌ Error getting desktop shortcuts:', error);
            return { shortcuts: [], windowPositions: {} };
        }
    }

    // Add a desktop shortcut
    addDesktopShortcut(workspaceId, shortcut) {
        try {
            // Generate unique ID for shortcut
            shortcut.id = this.generateUUID();
            shortcut.createdAt = new Date().toISOString();

            // Use fluent API to append to shortcuts array
            this.globalResources.modifyConfig('workspaceDesktop').append([workspaceId, 'shortcuts'], shortcut);

            return { success: true, shortcut };
        } catch (error) {
            console.error('❌ Error adding desktop shortcut:', error);
            throw error;
        }
    }

    // Update a desktop shortcut
    updateDesktopShortcut(workspaceId, shortcutId, updates) {
        try {
            // Access the workspace config directly to get the shortcuts array
            const workspace = this.globalResources.getWorkspaceDesktopConfig({ path: workspaceId });
            const shortcuts = workspace?.shortcuts || [];
            
            const shortcutIndex = shortcuts.findIndex(s => s.id === shortcutId);

            if (shortcutIndex === -1) {
                throw new Error('Shortcut not found');
            }

            // Merge updates with timestamp
            const updatedShortcut = {
                ...shortcuts[shortcutIndex],
                ...updates,
                updatedAt: new Date().toISOString()
            };

            // Use fluent API to replace the shortcut at the given index
            this.globalResources.modifyConfig('workspaceDesktop').replace([workspaceId, 'shortcuts'], shortcutIndex, updatedShortcut);

            return { success: true, shortcut: updatedShortcut };
        } catch (error) {
            console.error('❌ Error updating desktop shortcut:', error);
            throw error;
        }
    }

    // Remove a desktop shortcut
    removeDesktopShortcut(workspaceId, shortcutId, options = {}) {
        try {
            const workspace = this.globalResources.getWorkspaceDesktopConfig({ path: workspaceId });
            const shortcut = (workspace?.shortcuts || []).find((entry) => entry.id === shortcutId);
            if (
                !options.allowProtectedSystem
                && shortcut?.protected
                && shortcut?.type === 'system-folder'
                && shortcut?.data?.systemKey === WorkspaceManager.TRASH_DESKTOP_SHORTCUT_KEY
            ) {
                throw new Error('Trash desktop shortcut is managed in Desktop Settings');
            }

            // Use fluent API to delete from array with predicate
            this.globalResources.modifyConfig('workspaceDesktop').delete([workspaceId, 'shortcuts'], (s) => s.id === shortcutId);

            return { success: true };
        } catch (error) {
            console.error('❌ Error removing desktop shortcut:', error);
            throw error;
        }
    }

    // Update shortcut positions (for drag and drop)
    updateShortcutPositions(workspaceId, positions) {
        try {
            // Use callback-based modifyConfig for batch updates
            this.globalResources.modifyConfig('workspaceDesktop', (config) => {
                if (!config[workspaceId] || !config[workspaceId].shortcuts) {
                    throw new Error('Workspace not found');
                }

                // Update positions for each shortcut
                positions.forEach(({ id, position }) => {
                    const shortcut = config[workspaceId].shortcuts.find(s => s.id === id);
                    if (shortcut) {
                        shortcut.position = position;
                    }
                });

                return config;
            });

            return { success: true };
        } catch (error) {
            console.error('❌ Error updating shortcut positions:', error);
            throw error;
        }
    }
}

module.exports = WorkspaceManager;