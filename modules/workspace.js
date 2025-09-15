const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { getBaseName } = require('./pngMetadata');

// Workspace configuration
const WORKSPACE_FILE = path.resolve(__dirname, '../.cache/workspace.json');
const IMAGES_DIR = path.resolve(__dirname, '../images');
const CACHE_DIR = path.resolve(__dirname, '../.cache');
const UPLOAD_CACHE_DIR = path.join(CACHE_DIR, 'upload');

// Default workspace colors
const DEFAULT_WORKSPACE_COLORS = [
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

// In-memory workspace cache
let workspaces = null;
// Per-session active workspace storage
let sessionActiveWorkspaces = new Map();

// Generate UUID v4
function generateUUID() {
    return crypto.randomUUID();
}

// Get a random color from the default palette
function getRandomWorkspaceColor() {
    return DEFAULT_WORKSPACE_COLORS[Math.floor(Math.random() * DEFAULT_WORKSPACE_COLORS.length)];
}

// Load workspaces from file
function loadWorkspaces() {
    try {
        if (fs.existsSync(WORKSPACE_FILE)) {
            const startTime = Date.now();
            const data = fs.readFileSync(WORKSPACE_FILE, 'utf8');
            workspaces = JSON.parse(data);
            
            // Add color, backgroundColor, and backgroundImage properties to existing workspaces if missing
            let needsSave = false;
            Object.values(workspaces).forEach((workspace, index) => {
                if (!workspace.color) {
                    workspace.color = getRandomWorkspaceColor();
                    needsSave = true;
                }
                if (!workspace.backgroundColor) {
                    workspace.backgroundColor = null; // Will be auto-generated from color
                    needsSave = true;
                }
                // Add font settings if missing
                if (typeof workspace.primaryFont === 'undefined') {
                    workspace.primaryFont = null; // Use global default
                    needsSave = true;
                }
                if (typeof workspace.textareaFont === 'undefined') {
                    workspace.textareaFont = null; // Use global default
                    needsSave = true;
                }
                // Add groups property if missing
                if (!workspace.groups) {
                    workspace.groups = {};
                    needsSave = true;
                }
                // Add pinned property if missing
                if (!workspace.pinned) {
                    workspace.pinned = [];
                    needsSave = true;
                }
                // Add sort property if missing
                if (typeof workspace.sort === 'undefined') {
                    workspace.sort = index;
                    needsSave = true;
                }
            });
            
            if (needsSave) {
                saveWorkspaces();
            }
        } else {
            // Initialize with default workspace
            workspaces = {
                default: {
                    name: 'Default',
                    color: '#102040', // Default blue
                    backgroundColor: null, // Will be auto-generated from color
                    primaryFont: null, // Use global default
                    textareaFont: null, // Use global default
                    sort: 0, // Default sort order
                    presets: [],
                    vibeImages: [],
                    cacheFiles: [],
                    files: [],
                    scraps: [],
                    pinned: [], // Initialize empty pinned array
                    groups: {} // Initialize empty groups object
                }
            };
            saveWorkspaces();
        }
    } catch (error) {
        console.error('Error loading workspaces:', error);
        // Initialize with default workspace on error
        workspaces = {
            default: {
                name: 'Default',
                color: '#102040',
                backgroundColor: null,
                sort: 0,
                presets: [],
                vibeImages: [],
                cacheFiles: [],
                files: [],
                scraps: [],
                pinned: [],
                groups: {}
            }
        };
        saveWorkspaces();
    }
    return workspaces;
}

// Save workspaces to file
function saveWorkspaces() {
    try {
        const cacheDir = path.dirname(WORKSPACE_FILE);
        if (!fs.existsSync(cacheDir)) {
            fs.mkdirSync(cacheDir, { recursive: true });
        }
        
        const workspaceData = JSON.stringify(workspaces, null, 2);
        fs.writeFileSync(WORKSPACE_FILE, workspaceData);

        // Verify the file was written correctly
        const savedData = fs.readFileSync(WORKSPACE_FILE, 'utf8');
        const parsedData = JSON.parse(savedData);
    } catch (error) {
        console.error('❌ Error saving workspaces:', error);
        throw error;
    }
}

// Sync workspace files with actual filesystem
function syncWorkspaceFiles() {
    if (!workspaces) {
        loadWorkspaces();
    }

    try {
        // Get all image files from the images directory
        const imageFiles = fs.readdirSync(IMAGES_DIR)
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
            const sortedMissingFiles = sortFilesByTimestamp(missingFiles);
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
            saveWorkspaces();
        }
        
        // Sync pinned/scrapped files to ensure consistency
        syncWorkspacePinnedScraps();
        
        // Get all files in upload cache dir
        const uploadCacheFiles = fs.readdirSync(UPLOAD_CACHE_DIR);
        // Track all cache files in all workspaces
        const workspaceCacheFiles = new Set();
        Object.values(workspaces).forEach(ws => ws.cacheFiles.forEach(f => workspaceCacheFiles.add(f)));
        // Add missing ones to default workspace
        const missingCacheFiles = uploadCacheFiles.filter(f => !workspaceCacheFiles.has(f));
        if (missingCacheFiles.length > 0) {
            workspaces.default.cacheFiles.push(...missingCacheFiles);
            // Remove duplicates
            workspaces.default.cacheFiles = [...new Set(workspaces.default.cacheFiles)];
            saveWorkspaces();
        }

    } catch (error) {
        console.error('Error syncing workspace files:', error);
    }
}

// Get all workspaces
function getWorkspaces() {
    if (!workspaces) {
        loadWorkspaces();
    }
    return workspaces;
}

// Get a specific workspace
function getWorkspace(id) {
    if (!workspaces) {
        loadWorkspaces();
    }
    return workspaces[id] || null;
}

// Create a new workspace
function createWorkspace(name, color = null, backgroundColor = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const id = generateUUID();
    
    // Find the highest sort value and add 1 for the new workspace
    const maxSort = Math.max(...Object.values(workspaces).map(w => w.sort || 0), -1);
    
    workspaces[id] = {
        name: name,
        color: color || getRandomWorkspaceColor(),
        backgroundColor: backgroundColor, // Can be null for auto-generation
        primaryFont: null,
        textareaFont: null,
        sort: maxSort + 1, // Add to the end of the list
        presets: [],
        vibeImages: [],
        cacheFiles: [],
        files: [],
        scraps: [],
        pinned: [], // Initialize empty pinned array
        groups: {} // Initialize empty groups object
    };

    saveWorkspaces();
    console.log(`✅ Created workspace: ${name} (${id}) with color: ${workspaces[id].color} and sort: ${workspaces[id].sort}`);
    return id;
}

// Rename a workspace
function renameWorkspace(id, newName) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (id === 'default') {
        throw new Error('Cannot rename the default workspace');
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const oldName = workspaces[id].name;
    workspaces[id].name = newName;
    saveWorkspaces();
    console.log(`✅ Renamed workspace: ${oldName} -> ${newName}`);
}

// Update workspace color
function updateWorkspaceColor(id, color) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const oldColor = workspaces[id].color;
    workspaces[id].color = color;
    saveWorkspaces();
}

// Update workspace background color
function updateWorkspaceBackgroundColor(id, backgroundColor) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const oldBackgroundColor = workspaces[id].backgroundColor;
    workspaces[id].backgroundColor = backgroundColor;
    saveWorkspaces();
}

// Update multiple workspace settings at once and save once
function updateWorkspaceSettings(id, settings = {}) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const ws = workspaces[id];
    const prev = { ...ws };

    if (typeof settings.name === 'string' && settings.name.trim()) {
        if (id === 'default') {
            throw new Error('Cannot rename the default workspace');
        }
        ws.name = settings.name.trim();
    }
    if (typeof settings.color === 'string' && settings.color.trim()) {
        ws.color = settings.color.trim();
    }
    if (typeof settings.backgroundColor !== 'undefined') {
        ws.backgroundColor = settings.backgroundColor || null;
    }
    if (typeof settings.primaryFont !== 'undefined') {
        ws.primaryFont = settings.primaryFont || null;
    }
    if (typeof settings.textareaFont !== 'undefined') {
        ws.textareaFont = settings.textareaFont || null;
    }

    saveWorkspaces();
}

// Update workspace primary (UI) font
function updateWorkspacePrimaryFont(id, primaryFont) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const oldFont = workspaces[id].primaryFont;
    workspaces[id].primaryFont = primaryFont || null;
    saveWorkspaces();
    console.log(`🔤 Updated workspace primary font: ${workspaces[id].name} ${oldFont} -> ${primaryFont}`);
}

// Update workspace textarea (mono) font
function updateWorkspaceTextareaFont(id, textareaFont) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const oldFont = workspaces[id].textareaFont;
    workspaces[id].textareaFont = textareaFont || null;
    saveWorkspaces();
    console.log(`🔤 Updated workspace textarea font: ${workspaces[id].name} ${oldFont} -> ${textareaFont}`);
}

// Delete a workspace
function deleteWorkspace(id) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (id === 'default') {
        throw new Error('Cannot delete the default workspace');
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const workspace = workspaces[id];
    const name = workspace.name;

    // Count items being moved
    const movedCount = 
        (workspace.presets?.length || 0) +
        (workspace.vibeImages?.length || 0) +
        (workspace.cacheFiles?.length || 0) +
        (workspace.files?.length || 0) +
        (workspace.scraps?.length || 0) +
        (workspace.pinned?.length || 0);

    // Move all items to default workspace
    workspaces.default.presets.push(...workspace.presets);
    workspaces.default.vibeImages.push(...workspace.vibeImages);
    workspaces.default.cacheFiles.push(...workspace.cacheFiles);
    workspaces.default.files.push(...workspace.files);
    workspaces.default.scraps.push(...workspace.scraps);
    workspaces.default.pinned.push(...workspace.pinned);

    // Remove duplicates
    workspaces.default.presets = [...new Set(workspaces.default.presets)];
    workspaces.default.vibeImages = [...new Set(workspaces.default.vibeImages)];
    workspaces.default.cacheFiles = [...new Set(workspaces.default.cacheFiles)];
    workspaces.default.files = [...new Set(workspaces.default.files)];
    workspaces.default.scraps = [...new Set(workspaces.default.scraps)];
    workspaces.default.pinned = [...new Set(workspaces.default.pinned)];

    delete workspaces[id];
    saveWorkspaces();
    console.log(`✅ Deleted workspace: ${name} and moved ${movedCount} items to default`);
    
    return movedCount;
}

// Dump workspace (merge items into another workspace)
function dumpWorkspace(sourceId, targetId) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (sourceId === 'default') {
        throw new Error('Cannot dump the default workspace');
    }

    if (!workspaces[sourceId] || !workspaces[targetId]) {
        throw new Error('Source or target workspace not found');
    }

    const sourceWorkspace = workspaces[sourceId];
    const targetWorkspace = workspaces[targetId];
    const sourceName = sourceWorkspace.name;
    const targetName = targetWorkspace.name;

    // Count items being moved
    const movedCount = 
        (sourceWorkspace.presets?.length || 0) +
        (sourceWorkspace.vibeImages?.length || 0) +
        (sourceWorkspace.cacheFiles?.length || 0) +
        (sourceWorkspace.files?.length || 0) +
        (sourceWorkspace.scraps?.length || 0) +
        (sourceWorkspace.pinned?.length || 0);

    // Move all items to target workspace
    targetWorkspace.presets.push(...sourceWorkspace.presets);
    targetWorkspace.vibeImages.push(...sourceWorkspace.vibeImages);
    targetWorkspace.cacheFiles.push(...sourceWorkspace.cacheFiles);
    targetWorkspace.files.push(...sourceWorkspace.files);
    targetWorkspace.scraps.push(...sourceWorkspace.scraps);
    targetWorkspace.pinned.push(...sourceWorkspace.pinned);

    // Remove duplicates
    targetWorkspace.presets = [...new Set(targetWorkspace.presets)];
    targetWorkspace.vibeImages = [...new Set(targetWorkspace.vibeImages)];
    targetWorkspace.cacheFiles = [...new Set(targetWorkspace.cacheFiles)];
    targetWorkspace.files = [...new Set(targetWorkspace.files)];
    targetWorkspace.scraps = [...new Set(targetWorkspace.scraps)];
    targetWorkspace.pinned = [...new Set(targetWorkspace.pinned)];

    delete workspaces[sourceId];
    saveWorkspaces();
    console.log(`✅ Dumped workspace: ${sourceName} -> ${targetName} (${movedCount} items moved)`);
    
    return movedCount;
}

// Helper: extract timestamp from filename (first part when splitting by _)
function getTimestampFromFilename(filename) {
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
function getFileCreationDate(filename) {
    try {
        const filePath = path.join(IMAGES_DIR, filename);
        const stats = fs.statSync(filePath);
        return stats.birthtime.getTime() || stats.mtime.getTime();
    } catch (error) {
        console.warn(`Could not get creation date for ${filename}:`, error.message);
        return Date.now(); // Fallback to current time
    }
}

// Helper: sort files by timestamp (newest first)
function sortFilesByTimestamp(files) {
    return files.sort((a, b) => {
        // Try to get timestamp from filename first
        const timestampA = getTimestampFromFilename(a);
        const timestampB = getTimestampFromFilename(b);
        
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
        const dateA = getFileCreationDate(a);
        const dateB = getFileCreationDate(b);
        return dateB - dateA; // Newest first
    });
}

// Helper: find all related files for a given filename
function findRelatedFiles(filename, allFiles) {
    if (!filename || typeof filename !== 'string') {
        return [];
    }
    
    const baseName = getBaseName(filename);
    if (!baseName) {
        return [filename]; // Return just the original filename if base name extraction fails
    }
    
    const relatedFiles = [];
    
    // Find all files that share the same base name
    for (const file of allFiles) {
        if (file && typeof file === 'string' && getBaseName(file) === baseName) {
            relatedFiles.push(file);
        }
    }
    
    return relatedFiles;
}

// Move files between workspaces
function moveFilesToWorkspace(filenames, targetWorkspaceId, sourceWorkspaceId = null) {
    return moveToWorkspaceArray('files', filenames, targetWorkspaceId, sourceWorkspaceId);
}

// Move pinned images to workspace
function movePinnedToWorkspace(filenames, targetWorkspaceId) {
    return moveToWorkspaceArray('pinned', filenames, targetWorkspaceId);
}

// Get active workspace for a specific session
function getActiveWorkspace(sessionId) {
    if (!sessionId) {
        throw new Error('Session ID is required to determine active workspace');
    }
    
    const sessionWorkspace = sessionActiveWorkspaces.get(sessionId);
    return sessionWorkspace || 'default';
}

// Set active workspace for a specific session
function setActiveWorkspace(id, sessionId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    if (sessionId) {
        sessionActiveWorkspaces.set(sessionId, id);
        console.log(`✅ Active workspace set to: ${workspaces[id].name} (${id}) for session: ${sessionId}`);
        
        // Store the workspace preference in the session for persistence
        try {
            const sessionStore = require('express-session').Store;
            if (global.sessionStore && global.sessionStore instanceof sessionStore) {
                global.sessionStore.get(sessionId, (err, session) => {
                    if (!err && session) {
                        session.lastActiveWorkspace = id;
                        session.lastActiveWorkspaceTime = Date.now();
                        global.sessionStore.set(sessionId, session, (setErr) => {
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
function cleanupSessionWorkspace(sessionId) {
    if (sessionId && sessionActiveWorkspaces.has(sessionId)) {
        sessionActiveWorkspaces.delete(sessionId);
        console.log(`🧹 Cleaned up workspace for session: ${sessionId}`);
    }
}

// Restore session workspace from persistent storage
function restoreSessionWorkspace(sessionId) {
    if (!sessionId) return 'default';
    
    try {
        const sessionStore = require('express-session').Store;
        if (global.sessionStore && global.sessionStore instanceof sessionStore) {
            return new Promise((resolve) => {
                global.sessionStore.get(sessionId, (err, session) => {
                    if (err) {
                        console.log(`❌ Error retrieving session ${sessionId}:`, err.message);
                        // Set default workspace on error
                        ensureDefaultWorkspace(sessionId);
                        resolve('default');
                        return;
                    }

                    if (!session) {
                        ensureDefaultWorkspace(sessionId);
                        resolve('default');
                        return;
                    }
                    
                    const lastWorkspace = session.lastActiveWorkspace;
                    const lastWorkspaceTime = session.lastActiveWorkspaceTime;
                    
                    
                    if (lastWorkspace && lastWorkspaceTime) {
                        // Check if the workspace still exists
                        if (workspaces && workspaces[lastWorkspace]) {
                            // Check if the session is not too old (e.g., within 24 hours)
                            const sessionAge = Date.now() - lastWorkspaceTime;
                            const maxAge = 3 * 24 * 60 * 60 * 1000; // 3 days
                            
                            if (sessionAge < maxAge) {
                                sessionActiveWorkspaces.set(sessionId, lastWorkspace);
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
                    ensureDefaultWorkspace(sessionId);
                    resolve('default');
                });
            });
        } else {
            console.log(`⚠️ No valid session store available for session ${sessionId} - using default workspace`);
            // Set default workspace even without session store
            ensureDefaultWorkspace(sessionId);
            return 'default';
        }
    } catch (error) {
        console.error('Error in restoreSessionWorkspace:', error);
        // Set default workspace on error
        ensureDefaultWorkspace(sessionId);
        return 'default';
    }
}

// Helper function to ensure a session has a workspace set
function ensureDefaultWorkspace(sessionId) {
    if (!sessionId) return;

    // Ensure workspaces are loaded
    if (!workspaces) {
        loadWorkspaces();
    }

    // Ensure default workspace exists
    if (!workspaces || !workspaces.default) {
        console.error('❌ Default workspace not found - this should not happen');
        return;
    }

    // Set the session to use default workspace
    sessionActiveWorkspaces.set(sessionId, 'default');

    // Try to persist this in the session store if available
    try {
        const sessionStore = require('express-session').Store;
        if (global.sessionStore && global.sessionStore instanceof sessionStore) {
            global.sessionStore.get(sessionId, (err, session) => {
                if (!err && session) {
                    session.lastActiveWorkspace = 'default';
                    session.lastActiveWorkspaceTime = Date.now();
                    global.sessionStore.set(sessionId, session, (setErr) => {
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
function getActiveWorkspaceFiles(sessionId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!sessionId) {
        throw new Error('Session ID is required to get active workspace files');
    }

    const workspaceId = getActiveWorkspace(sessionId);
    // Include active workspace files if not default
    if (workspaces[workspaceId]) {
        return workspaces[workspaceId].files;
    } 
    return workspaces.default.files;
}

// Get cache files for active workspace (includes default)
function getActiveWorkspaceCacheFiles(workspaceId = null, sessionId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const files = new Set();

    // If a specific workspace ID is provided, get cache files for that workspace
    if (workspaceId) {
        if (workspaces[workspaceId]) {
            workspaces[workspaceId].cacheFiles.forEach(file => files.add(file));
        }
    } else {
        // No specific workspace ID provided, use session ID to get active workspace
        if (!sessionId) {
            throw new Error('Session ID is required to get active workspace cache files');
        }
        
        // Always include default workspace cache files
        if (workspaces.default) {
            workspaces.default.cacheFiles.forEach(file => files.add(file));
        }
        
        // Get cache files from the active workspace for this session
        const currentActiveWorkspace = getActiveWorkspace(sessionId);
        if (currentActiveWorkspace !== 'default' && workspaces[currentActiveWorkspace]) {
            workspaces[currentActiveWorkspace].cacheFiles.forEach(file => files.add(file));
        }
    }

    return Array.from(files);
}

// Sort all workspace files by timestamp
function sortAllWorkspaceFiles() {
    if (!workspaces) {
        loadWorkspaces();
    }
    
    let totalSorted = 0;
    Object.values(workspaces).forEach(workspace => {
        if (workspace.files && workspace.files.length > 0) {
            const originalOrder = [...workspace.files];
            workspace.files = sortFilesByTimestamp(workspace.files);
            
            // Check if order changed
            const orderChanged = originalOrder.some((file, index) => file !== workspace.files[index]);
            if (orderChanged) {
                totalSorted += workspace.files.length;
            }
        }
    });
    
    if (totalSorted > 0) {
        saveWorkspaces();
    }
}

// Organize orphaned upscaled and pinned files to their correct workspaces
function organizeOrphanedFiles() {
    if (!workspaces) {
        loadWorkspaces();
    }
    
    let movedCount = 0;
    
    // Get all files from filesystem to check for orphaned upscaled files
    const IMAGES_DIR = path.join(__dirname, '..', 'images');
    if (!fs.existsSync(IMAGES_DIR)) {
        return movedCount;
    }
    
    const allImageFiles = fs.readdirSync(IMAGES_DIR)
        .filter(f => f.match(/\.(png|jpg|jpeg)$/i))
        .filter(f => !f.startsWith('.'));
    
    // Find upscaled files that are orphaned (original is in a workspace but upscaled is not)
    const upscaledFiles = allImageFiles.filter(f => f.includes('_upscaled'));
    
    for (const upscaledFile of upscaledFiles) {
        // Get the original file name
        const originalFile = upscaledFile.replace('_upscaled.png', '.png').replace('_upscaled.jpg', '.jpg').replace('_upscaled.jpeg', '.jpeg');
        
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
        saveWorkspaces();
        console.log(`✅ Organized ${movedCount} orphaned upscaled files to their correct workspaces`);
    }
    
    return movedCount;
}

// Initialize workspaces on module load
function initializeWorkspaces() {
    console.log('🔧 Initializing workspace system...');
    loadWorkspaces();
    
    // Initialize scraps arrays for all existing workspaces
    Object.values(workspaces).forEach(workspace => {
        if (!workspace.scraps) {
            workspace.scraps = [];
        }
    });
    
    sortAllWorkspaceFiles(); // Sort existing files by timestamp
    syncWorkspaceFiles(); // Sync and add new files (already sorted)
    organizeOrphanedFiles(); // Organize orphaned upscaled files

    console.log(`✅ Workspace system initialized with ${Object.keys(workspaces).length} workspaces`);
}

// Get scraps for active workspace (only that workspace)
function getActiveWorkspaceScraps(sessionId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!sessionId) {
        throw new Error('Session ID is required to get active workspace scraps');
    }

    const workspaceId = getActiveWorkspace(sessionId);
    // Initialize scraps array if it doesn't exist
    if (workspaces[workspaceId] && !workspaces[workspaceId].scraps) {
        workspaces[workspaceId].scraps = [];
    }

    if (workspaces[workspaceId]) {
        return workspaces[workspaceId].scraps;
    }
    return [];
}

// Get pinned images for active workspace (only that workspace)
function getActiveWorkspacePinned(sessionId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!sessionId) {
        throw new Error('Session ID is required to get active workspace pinned images');
    }

    const workspaceId = getActiveWorkspace(sessionId);
    // Initialize pinned array if it doesn't exist
    if (workspaces[workspaceId] && !workspaces[workspaceId].pinned) {
        workspaces[workspaceId].pinned = [];
    }

    if (workspaces[workspaceId]) {
        return workspaces[workspaceId].pinned;
    }
    return [];
}

// Remove files from all workspaces (used when files are deleted)
function removeFilesFromWorkspaces(filenames) {
    // Filter out null/invalid filenames
    const validFilenames = filenames.filter(filename => filename && typeof filename === 'string');    
    if (validFilenames.length === 0) {
        console.log('⚠️ No valid filenames provided for removal from workspaces');
        return 0;
    }

    let totalRemoved = 0;

    // Remove from all workspaces
    Object.keys(workspaces).forEach(workspaceId => {
        totalRemoved += removeFromWorkspaceArray('files', validFilenames, workspaceId);
        totalRemoved += removeFromWorkspaceArray('scraps', validFilenames, workspaceId);
        totalRemoved += removeFromWorkspaceArray('pinned', validFilenames, workspaceId);
    });

    if (totalRemoved > 0) {
    }

    return totalRemoved;
}

// Common function to add items to workspace array
function addToWorkspaceArray(type, items, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

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
    
    switch (type) {
        case 'files':
            validItems.forEach(item => {
                if (!workspaces[targetId].files.includes(item)) {
                    workspaces[targetId].files.push(item);
                    addedCount++;
                }
            });
            break;
            
        case 'scraps':
            // Initialize scraps array if it doesn't exist
            if (!workspaces[targetId].scraps) {
                workspaces[targetId].scraps = [];
            }
            validItems.forEach(item => {
                if (!workspaces[targetId].scraps.includes(item)) {
                    workspaces[targetId].scraps.push(item);
                    // Remove from main files list when adding to scraps
                    workspaces[targetId].files = workspaces[targetId].files.filter(file => file !== item);
                    addedCount++;
                }
            });            
            // Remove from files list of all workspaces (since scraps are shared)
            Object.keys(workspaces).forEach(workspaceId => {
                if (workspaces[workspaceId].files) {
                    workspaces[workspaceId].files = workspaces[workspaceId].files.filter(file => !validItems.includes(file));
                }
            });
            break;
            
        case 'presets':
            validItems.forEach(item => {
                if (!workspaces[targetId].presets.includes(item)) {
                    workspaces[targetId].presets.push(item);
                    addedCount++;
                }
            });
            break;
            
        case 'cacheFiles':
            validItems.forEach(item => {
                if (!workspaces[targetId].cacheFiles.includes(item)) {
                    workspaces[targetId].cacheFiles.push(item);
                    addedCount++;
                }
            });
            break;
            
        case 'vibeImages':
            // Initialize vibeImages array if it doesn't exist
            if (!workspaces[targetId].vibeImages) {
                workspaces[targetId].vibeImages = [];
            }
            validItems.forEach(item => {
                if (!workspaces[targetId].vibeImages.includes(item)) {
                    workspaces[targetId].vibeImages.push(item);
                    addedCount++;
                }
            });
            break;
            
        case 'pinned':
            validItems.forEach(item => {
                if (!workspaces[targetId].pinned.includes(item)) {
                    workspaces[targetId].pinned.push(item);
                    addedCount++;
                }
            });
            break;
            
        default:
            throw new Error(`Invalid type: ${type}. Must be one of: files, scraps, presets, cacheFiles, vibeImages, pinned`);
    }

    if (addedCount > 0) {
        saveWorkspaces();
    }

    return addedCount;
}

// Common function to remove items from workspace array
function removeFromWorkspaceArray(type, items, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

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
    
    switch (type) {
        case 'files':
            const originalFilesLength = workspaces[targetId].files.length;
            workspaces[targetId].files = workspaces[targetId].files.filter(item => !validItems.includes(item));
            removedCount = originalFilesLength - workspaces[targetId].files.length;
            break;
            
        case 'scraps':
            // Initialize scraps array if it doesn't exist
            if (!workspaces[targetId].scraps) {
                workspaces[targetId].scraps = [];
            }
            const originalScrapsLength = workspaces[targetId].scraps.length;
            workspaces[targetId].scraps = workspaces[targetId].scraps.filter(item => !validItems.includes(item));
            removedCount = originalScrapsLength - workspaces[targetId].scraps.length;
            
            // For scraps, move removed items back to files of the target workspace
            validItems.forEach(item => {
                if (!workspaces[targetId].files.includes(item)) {
                    workspaces[targetId].files.push(item);
                }
            });
            
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
            
        case 'cacheFiles':
            const originalCacheFilesLength = workspaces[targetId].cacheFiles.length;
            workspaces[targetId].cacheFiles = workspaces[targetId].cacheFiles.filter(item => !validItems.includes(item));
            removedCount = originalCacheFilesLength - workspaces[targetId].cacheFiles.length;
            break;
            
        case 'vibeImages':
            // Initialize vibeImages array if it doesn't exist
            if (!workspaces[targetId].vibeImages) {
                workspaces[targetId].vibeImages = [];
            }
            const originalVibeImagesLength = workspaces[targetId].vibeImages.length;
            workspaces[targetId].vibeImages = workspaces[targetId].vibeImages.filter(item => !validItems.includes(item));
            removedCount = originalVibeImagesLength - workspaces[targetId].vibeImages.length;
            break;
            
        case 'pinned':
            const originalPinnedLength = workspaces[targetId].pinned.length;
            workspaces[targetId].pinned = workspaces[targetId].pinned.filter(item => !validItems.includes(item));
            removedCount = originalPinnedLength - workspaces[targetId].pinned.length;
            break;
            
        default:
            throw new Error(`Invalid type: ${type}. Must be one of: files, scraps, presets, cacheFiles, vibeImages, pinned`);
    }

    if (removedCount > 0) {
        saveWorkspaces();
    }

    return removedCount;
}

// Common function to move items between workspaces
function moveToWorkspaceArray(type, items, targetWorkspaceId, sourceWorkspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

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

    // Remove items from all workspaces first (if sourceWorkspaceId not specified)
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
                const baseName = getBaseName(filename);
                const extMatch = filename.match(/\.(png|jpg|jpeg)$/i);
                const ext = extMatch ? extMatch[0] : '';
                // Always add the original file
                allFilesToMove.add(filename);
                // Add upscaled variants if present in any workspace
                const upscaled = `${baseName}_upscaled${ext}`;
                if (allWorkspaceFiles.has(upscaled)) allFilesToMove.add(upscaled);
                // Add all other related files (legacy logic)
                const relatedFiles = findRelatedFiles(filename, Array.from(allWorkspaceFiles));
                relatedFiles.forEach(file => allFilesToMove.add(file));
            }
            validItems = Array.from(allFilesToMove);
        }
        
        movedCount = removeFromWorkspaceArray(type, validItems, sourceWorkspaceId);
    } else {
        // Remove from all workspaces
        Object.values(workspaces).forEach(workspace => {
            switch (type) {
                case 'files':
                    // Get all files from all workspaces to find related files
                    const allWorkspaceFiles = new Set();
                    Object.values(workspaces).forEach(workspace => {
                        workspace.files.forEach(file => allWorkspaceFiles.add(file));
                    });

                    // Find all related files for each filename, including explicit upscaled variants
                    const allFilesToMove = new Set();
                    for (const filename of validItems) {
                        const baseName = getBaseName(filename);
                        const extMatch = filename.match(/\.(png|jpg|jpeg)$/i);
                        const ext = extMatch ? extMatch[0] : '';
                        // Always add the original file
                        allFilesToMove.add(filename);
                        // Add upscaled variants if present in any workspace
                        const upscaled = `${baseName}_upscaled${ext}`;
                        if (allWorkspaceFiles.has(upscaled)) allFilesToMove.add(upscaled);
                        // Add all other related files (legacy logic)
                        const relatedFiles = findRelatedFiles(filename, Array.from(allWorkspaceFiles));
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
                    
                case 'cacheFiles':
                    const originalCacheFilesLength = workspace.cacheFiles.length;
                    workspace.cacheFiles = workspace.cacheFiles.filter(item => !validItems.includes(item));
                    movedCount += originalCacheFilesLength - workspace.cacheFiles.length;
                    break;
                    
                case 'vibeImages':
                    const originalVibeImagesLength = workspace.vibeImages.length;
                    workspace.vibeImages = workspace.vibeImages.filter(item => !validItems.includes(item));
                    movedCount += originalVibeImagesLength - workspace.vibeImages.length;
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
    addToWorkspaceArray(type, validItems, targetWorkspaceId);

    // If moving files, also handle pinned/scrapped files
    if (type === 'files' && movedCount > 0) {
        handlePinnedScrappedFilesOnMove(validItems, targetWorkspaceId, sourceWorkspaceId);
    }

    if (movedCount > 0) {
        saveWorkspaces();
        const message = type === 'files' ? 
            `✅ Moved ${movedCount} ${type} (including related and upscaled files) to workspace: ${workspaces[targetWorkspaceId].name}` :
            `✅ Moved ${movedCount} ${type} to workspace: ${workspaces[targetWorkspaceId].name}`;
        console.log(message);
    }

    return movedCount;
}

// Handle pinned/scrapped files when moving files between workspaces
function handlePinnedScrappedFilesOnMove(filenames, targetWorkspaceId, sourceWorkspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[targetWorkspaceId]) {
        console.error(`Target workspace ${targetWorkspaceId} not found for pinned/scrapped file handling`);
        return;
    }

    let pinnedMoved = 0;
    let scrapsMoved = 0;

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
                pinnedMoved++;
            });

            // Add to target workspace (avoid duplicates)
            if (!workspaces[targetWorkspaceId].pinned) {
                workspaces[targetWorkspaceId].pinned = [];
            }
            if (!workspaces[targetWorkspaceId].pinned.includes(filename)) {
                workspaces[targetWorkspaceId].pinned.push(filename);
            }
        }
    });

    if (pinnedMoved > 0 || scrapsMoved > 0) {
        console.log(`📌 Moved ${pinnedMoved} pinned files and ${scrapsMoved} scrapped files to workspace: ${workspaces[targetWorkspaceId].name}`);
    }
}

// Sync pinned/scrapped files across workspaces to ensure consistency
function syncWorkspacePinnedScraps() {
    if (!workspaces) {
        loadWorkspaces();
    }

    console.log('🔄 Syncing pinned files across workspaces...');
    
    let correctionsMade = 0;
    const allFiles = new Set();
    
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
                
                // Find which workspaces actually have these files
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
                        }
                    } else {
                        // File doesn't exist in any workspace, remove it
                        workspace.pinned = workspace.pinned.filter(f => f !== file);
                        console.log(`🗑️ Removed non-existent pinned file ${file} from ${workspace.name}`);
                        correctionsMade++;
                    }
                });
            }
        }
    });

    if (correctionsMade > 0) {
        console.log(`✅ Made ${correctionsMade} corrections to pinned files across workspaces`);
        saveWorkspaces();
    }
}

// Get workspaces data for server use
function getWorkspacesData() {
    if (!workspaces) {
        loadWorkspaces();
    }
    return workspaces;
}

// Get active workspace data for server use
function getActiveWorkspaceData(sessionId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!sessionId) {
        throw new Error('Session ID is required to get active workspace data');
    }

    const workspaceId = getActiveWorkspace(sessionId);
    if (!workspaceId || !workspaces[workspaceId]) {
        console.warn(`⚠️ No active workspace found for session ${sessionId}`);
        return null;
    }

    return workspaces[workspaceId];
}

// Group management functions
function createGroup(workspaceId, name, imageFilenames = []) {
    if (!workspaces || !workspaces[workspaceId]) {
        throw new Error('Workspace not found');
    }
    
    const groupId = generateUUID();
    const workspace = workspaces[workspaceId];
    
    workspace.groups[groupId] = {
        id: groupId,
        name: name,
        images: imageFilenames,
        createdAt: Date.now(),
        updatedAt: Date.now()
    };
    
    saveWorkspaces();
    return groupId;
}

function getGroup(workspaceId, groupId) {
    if (!workspaces || !workspaces[workspaceId]) {
        return null;
    }
    
    return workspaces[workspaceId].groups[groupId] || null;
}

function getWorkspaceGroups(workspaceId) {
    if (!workspaces || !workspaces[workspaceId]) {
        return [];
    }
    
    const groups = Object.values(workspaces[workspaceId].groups || {});
    return groups.sort((a, b) => b.updatedAt - a.updatedAt); // Sort by newest first
}

function addImagesToGroup(workspaceId, groupId, imageFilenames) {
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
    
    saveWorkspaces();
    return newImages.length;
}

function removeImagesFromGroup(workspaceId, groupId, imageFilenames) {
    if (!workspaces || !workspaces[workspaceId]) {
        throw new Error('Workspace not found');
    }
    
    const group = workspaces[workspaceId].groups[groupId];
    if (!group) {
        throw new Error('Group not found');
    }
    
    const originalCount = group.images.length;
    group.images = group.images.filter(filename => !imageFilenames.includes(filename));
    group.updatedAt = Date.now();
    
    saveWorkspaces();
    return originalCount - group.images.length;
}

function renameGroup(workspaceId, groupId, newName) {
    if (!workspaces || !workspaces[workspaceId]) {
        throw new Error('Workspace not found');
    }
    
    const group = workspaces[workspaceId].groups[groupId];
    if (!group) {
        throw new Error('Group not found');
    }
    
    group.name = newName;
    group.updatedAt = Date.now();
    
    saveWorkspaces();
}

function deleteGroup(workspaceId, groupId) {
    if (!workspaces || !workspaces[workspaceId]) {
        throw new Error('Workspace not found');
    }
    
    if (!workspaces[workspaceId].groups[groupId]) {
        throw new Error('Group not found');
    }
    
    delete workspaces[workspaceId].groups[groupId];
    saveWorkspaces();
}

function getGroupsForImage(workspaceId, imageFilename) {
    if (!workspaces || !workspaces[workspaceId]) {
        return [];
    }
    
    const groups = Object.values(workspaces[workspaceId].groups || {});
    return groups.filter(group => group.images.includes(imageFilename));
}

function getActiveWorkspaceGroups(sessionId = null) {
    if (!sessionId) {
        throw new Error('Session ID is required to get active workspace groups');
    }
    
    const workspaceId = getActiveWorkspace(sessionId);
    return getWorkspaceGroups(workspaceId);
}

// Bulk operations for workspace arrays
function bulkAddToWorkspaceArray(type, items, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const targetWorkspaceId = workspaceId || 'default';
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

    saveWorkspaces();
    return { success: true, addedCount };
}

function bulkRemoveFromWorkspaceArray(type, items, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const targetWorkspaceId = workspaceId || 'default';
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

    saveWorkspaces();
    return { success: true, removedCount };
}

// Reorder workspaces based on provided order
function reorderWorkspaces(workspaceOrder) {
    try {
        // Validate input
        if (!Array.isArray(workspaceOrder)) {
            throw new Error('Workspace order must be an array');
        }

        // Check if all workspace IDs exist
        const existingWorkspaceIds = Object.keys(workspaces);
        const invalidIds = workspaceOrder.filter(id => !existingWorkspaceIds.includes(id));
        if (invalidIds.length > 0) {
            throw new Error(`Invalid workspace IDs: ${invalidIds.join(', ')}`);
        }
        
        // Update sort values based on the provided order
        workspaceOrder.forEach((workspaceId, index) => {
            if (workspaces[workspaceId]) {
                const oldSort = workspaces[workspaceId].sort;
                workspaces[workspaceId].sort = index;
            }
        });
        
        // Save the updated workspaces
        saveWorkspaces();
        
        return { success: true, message: 'Workspaces reordered successfully' };
    } catch (error) {
        console.error('❌ Error reordering workspaces:', error);
        throw error;
    }
}

module.exports = {
    initializeWorkspaces,
    organizeOrphanedFiles,
    loadWorkspaces,
    saveWorkspaces,
    syncWorkspaceFiles,
    syncWorkspacePinnedScraps,
    sortAllWorkspaceFiles,
    getWorkspaces,
    getWorkspace,
    createWorkspace,
    renameWorkspace,
    updateWorkspaceColor,
    updateWorkspaceBackgroundColor,
    updateWorkspacePrimaryFont,
    updateWorkspaceTextareaFont,
    updateWorkspaceSettings,
    deleteWorkspace,
    dumpWorkspace,
    addToWorkspaceArray,
    removeFromWorkspaceArray,
    moveToWorkspaceArray,
    handlePinnedScrappedFilesOnMove,
    moveFilesToWorkspace,
    movePinnedToWorkspace,
    getActiveWorkspace,
    setActiveWorkspace,
    getActiveWorkspaceFiles,
    getActiveWorkspaceCacheFiles,
    getActiveWorkspaceScraps,
    getActiveWorkspacePinned,
    removeFilesFromWorkspaces,
    getWorkspacesData,
    getActiveWorkspaceData,
    // Group management functions
    createGroup,
    getGroup,
    getWorkspaceGroups,
    addImagesToGroup,
    removeImagesFromGroup,
    renameGroup,
    deleteGroup,
    getGroupsForImage,
    getActiveWorkspaceGroups,
    reorderWorkspaces,
    // Session management
    cleanupSessionWorkspace,
    restoreSessionWorkspace
};