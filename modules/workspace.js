const fs = require('fs');
const path = require('path');
const crypto = require('crypto');

// Workspace configuration
const WORKSPACE_FILE = path.resolve(__dirname, '../.cache/workspace.json');
const IMAGES_DIR = path.resolve(__dirname, '../images');
const CACHE_DIR = path.resolve(__dirname, '../.cache');
const UPLOAD_CACHE_DIR = path.join(CACHE_DIR, 'upload');

// Default workspace colors
const DEFAULT_WORKSPACE_COLORS = [
    '#124', // Default blue
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
let activeWorkspace = 'default';

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
            const data = fs.readFileSync(WORKSPACE_FILE, 'utf8');
            workspaces = JSON.parse(data);
            
            // Add color, backgroundColor, and backgroundImage properties to existing workspaces if missing
            let needsSave = false;
            Object.values(workspaces).forEach(workspace => {
                if (!workspace.color) {
                    workspace.color = getRandomWorkspaceColor();
                    needsSave = true;
                }
                if (!workspace.backgroundColor) {
                    workspace.backgroundColor = null; // Will be auto-generated from color
                    needsSave = true;
                }
                if (!workspace.backgroundImage) {
                    workspace.backgroundImage = null; // No background image by default
                    needsSave = true;
                }
                if (!workspace.backgroundOpacity) {
                    workspace.backgroundOpacity = 0.3; // Default opacity
                    needsSave = true;
                }
            });
            
            if (needsSave) {
                saveWorkspaces();
                console.log('🎨 Added colors to existing workspaces');
            }
        } else {
            // Initialize with default workspace
            workspaces = {
                default: {
                    name: 'Default',
                    color: '#124', // Default blue
                    backgroundColor: null, // Will be auto-generated from color
                    backgroundImage: null, // No background image by default
                    backgroundOpacity: 0.3, // Default opacity
                    presets: [],
                    vibeImages: [],
                    cacheFiles: [],
                    pipelines: [],
                    files: [],
                    scraps: []
                }
            };
            saveWorkspaces();
        }
    } catch (error) {
        console.error('Error loading workspaces:', error);
        // Fallback to default workspace
        workspaces = {
            default: {
                name: 'Default',
                color: '#124', // Default blue
                backgroundColor: null, // Will be auto-generated from color
                backgroundImage: null, // No background image by default
                backgroundOpacity: 0.3, // Default opacity
                presets: [],
                vibeImages: [],
                cacheFiles: [],
                pipelines: [],
                files: [],
                scraps: []
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
        fs.writeFileSync(WORKSPACE_FILE, JSON.stringify(workspaces, null, 2));
    } catch (error) {
        console.error('Error saving workspaces:', error);
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
        
        // Track all files that exist in workspaces
        const workspaceFiles = new Set();
        Object.values(workspaces).forEach(workspace => {
            workspace.files.forEach(file => workspaceFiles.add(file));
        });

        // Add missing files to default workspace
        const missingFiles = imageFiles.filter(file => !workspaceFiles.has(file));
        if (missingFiles.length > 0) {
            // Sort missing files by timestamp before adding
            const sortedMissingFiles = sortFilesByTimestamp(missingFiles);
            workspaces.default.files.push(...sortedMissingFiles);
            console.log(`📁 Added ${missingFiles.length} new files to default workspace (sorted by timestamp)`);
        }

        // Remove non-existent files from all workspaces
        let removedCount = 0;
        Object.values(workspaces).forEach(workspace => {
            const originalLength = workspace.files.length;
            workspace.files = workspace.files.filter(file => imageFiles.includes(file));
            removedCount += originalLength - workspace.files.length;
        });

        if (removedCount > 0) {
            console.log(`📁 Removed ${removedCount} non-existent files from workspaces`);
        }

        // Save changes if any were made
        if (missingFiles.length > 0 || removedCount > 0) {
            saveWorkspaces();
        }
        
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
            console.log(`📦 Added ${missingCacheFiles.length} upload cache files to default workspace`);
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
function createWorkspace(name, color = null, backgroundColor = null, backgroundImage = null, backgroundOpacity = 0.3) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const id = generateUUID();
    workspaces[id] = {
        name: name,
        color: color || getRandomWorkspaceColor(),
        backgroundColor: backgroundColor, // Can be null for auto-generation
        backgroundImage: backgroundImage, // Can be null for no background image
        backgroundOpacity: backgroundOpacity, // Default opacity
        presets: [],
        vibeImages: [],
        cacheFiles: [],
        pipelines: [],
        files: [],
        scraps: []
    };

    saveWorkspaces();
    console.log(`✅ Created workspace: ${name} (${id}) with color: ${workspaces[id].color}`);
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
    console.log(`🎨 Updated workspace color: ${workspaces[id].name} ${oldColor} -> ${color}`);
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
    console.log(`🎨 Updated workspace background color: ${workspaces[id].name} ${oldBackgroundColor} -> ${backgroundColor}`);
}

// Update workspace background image
function updateWorkspaceBackgroundImage(id, backgroundImage) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const oldBackgroundImage = workspaces[id].backgroundImage;
    workspaces[id].backgroundImage = backgroundImage;
    saveWorkspaces();
    console.log(`🖼️ Updated workspace background image: ${workspaces[id].name} ${oldBackgroundImage} -> ${backgroundImage}`);
}

// Update workspace background opacity
function updateWorkspaceBackgroundOpacity(id, backgroundOpacity) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    const oldBackgroundOpacity = workspaces[id].backgroundOpacity;
    workspaces[id].backgroundOpacity = backgroundOpacity;
    saveWorkspaces();
    console.log(`🎚️ Updated workspace background opacity: ${workspaces[id].name} ${oldBackgroundOpacity} -> ${backgroundOpacity}`);
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

    // Move all items to default workspace
    workspaces.default.presets.push(...workspace.presets);
    workspaces.default.vibeImages.push(...workspace.vibeImages);
    workspaces.default.cacheFiles.push(...workspace.cacheFiles);
    workspaces.default.pipelines.push(...workspace.pipelines);
    workspaces.default.files.push(...workspace.files);
    workspaces.default.scraps.push(...workspace.scraps);

    // Remove duplicates
    workspaces.default.presets = [...new Set(workspaces.default.presets)];
    workspaces.default.vibeImages = [...new Set(workspaces.default.vibeImages)];
    workspaces.default.cacheFiles = [...new Set(workspaces.default.cacheFiles)];
    workspaces.default.pipelines = [...new Set(workspaces.default.pipelines)];
    workspaces.default.files = [...new Set(workspaces.default.files)];
    workspaces.default.scraps = [...new Set(workspaces.default.scraps)];

    delete workspaces[id];
    saveWorkspaces();
    console.log(`✅ Deleted workspace: ${name} and moved all items to default`);
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

    // Move all items to target workspace
    targetWorkspace.presets.push(...sourceWorkspace.presets);
    targetWorkspace.vibeImages.push(...sourceWorkspace.vibeImages);
    targetWorkspace.cacheFiles.push(...sourceWorkspace.cacheFiles);
    targetWorkspace.pipelines.push(...sourceWorkspace.pipelines);
    targetWorkspace.files.push(...sourceWorkspace.files);
    targetWorkspace.scraps.push(...sourceWorkspace.scraps);

    // Remove duplicates
    targetWorkspace.presets = [...new Set(targetWorkspace.presets)];
    targetWorkspace.vibeImages = [...new Set(targetWorkspace.vibeImages)];
    targetWorkspace.cacheFiles = [...new Set(targetWorkspace.cacheFiles)];
    targetWorkspace.pipelines = [...new Set(targetWorkspace.pipelines)];
    targetWorkspace.files = [...new Set(targetWorkspace.files)];
    targetWorkspace.scraps = [...new Set(targetWorkspace.scraps)];

    delete workspaces[sourceId];
    saveWorkspaces();
    console.log(`✅ Dumped workspace: ${sourceName} -> ${targetName}`);
}

// Helper: get base name for pairing (copied from web_server.js)
function getBaseName(filename) {
    if (!filename || typeof filename !== 'string') {
        return null;
    }
    return filename
        .replace(/_upscaled(?=\.)/, '')  // Remove _upscaled suffix
        .replace(/_pipeline(?=\.)/, '')  // Remove _pipeline suffix
        .replace(/_pipeline_upscaled(?=\.)/, '')  // Remove _pipeline_upscaled suffix
        .replace(/\.(png|jpg|jpeg)$/i, '');  // Remove file extension
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
function moveFilesToWorkspace(filenames, targetWorkspaceId) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[targetWorkspaceId]) {
        throw new Error(`Target workspace ${targetWorkspaceId} not found`);
    }

    // Filter out null/invalid filenames
    const validFilenames = filenames.filter(filename => filename && typeof filename === 'string');
    
    if (validFilenames.length === 0) {
        console.log('⚠️ No valid filenames provided for moving');
        return 0;
    }

    // Get all files from all workspaces to find related files
    const allWorkspaceFiles = new Set();
    Object.values(workspaces).forEach(workspace => {
        workspace.files.forEach(file => allWorkspaceFiles.add(file));
    });

    // Find all related files for each filename
    const allFilesToMove = new Set();
    for (const filename of validFilenames) {
        const relatedFiles = findRelatedFiles(filename, Array.from(allWorkspaceFiles));
        relatedFiles.forEach(file => allFilesToMove.add(file));
    }

    const filesToMoveArray = Array.from(allFilesToMove);
    let movedCount = 0;

    // Remove files from all workspaces first
    Object.values(workspaces).forEach(workspace => {
        const originalLength = workspace.files.length;
        workspace.files = workspace.files.filter(file => !filesToMoveArray.includes(file));
        if (workspace.files.length < originalLength) {
            movedCount += originalLength - workspace.files.length;
        }
    });

    // Add files to target workspace (avoiding duplicates)
    const existingFiles = new Set(workspaces[targetWorkspaceId].files);
    const newFiles = filesToMoveArray.filter(file => !existingFiles.has(file));
    workspaces[targetWorkspaceId].files.push(...newFiles);

    saveWorkspaces();
    console.log(`✅ Moved ${movedCount} files (including related files) to workspace: ${workspaces[targetWorkspaceId].name}`);
    return movedCount;
}

// Get active workspace
function getActiveWorkspace() {
    return activeWorkspace;
}

// Set active workspace
function setActiveWorkspace(id) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[id]) {
        throw new Error(`Workspace ${id} not found`);
    }

    activeWorkspace = id;
    console.log(`✅ Active workspace set to: ${workspaces[id].name} (${id})`);
}

// Get files for active workspace (includes default)
function getActiveWorkspaceFiles() {
    if (!workspaces) {
        loadWorkspaces();
    }

    // Include active workspace files if not default
    if (workspaces[activeWorkspace]) {
        return workspaces[activeWorkspace].files;
    } 
    return workspaces.default.files;
}

// Add file to workspace
function addFileToWorkspace(filename, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const targetId = workspaceId || activeWorkspace;
    
    if (!workspaces[targetId]) {
        throw new Error(`Workspace ${targetId} not found`);
    }

    if (!workspaces[targetId].files.includes(filename)) {
        workspaces[targetId].files.push(filename);
        saveWorkspaces();
        console.log(`✅ Added file ${filename} to workspace: ${workspaces[targetId].name}`);
    }
}

// Add cache file to workspace
function addCacheFileToWorkspace(hash, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const targetId = workspaceId || activeWorkspace;
    
    if (!workspaces[targetId]) {
        throw new Error(`Workspace ${targetId} not found`);
    }

    if (!workspaces[targetId].cacheFiles.includes(hash)) {
        workspaces[targetId].cacheFiles.push(hash);
        saveWorkspaces();
        console.log(`✅ Added cache file ${hash} to workspace: ${workspaces[targetId].name}`);
    }
}

// Get cache files for active workspace (includes default)
function getActiveWorkspaceCacheFiles() {
    if (!workspaces) {
        loadWorkspaces();
    }

    const files = new Set();
    
    // Always include default workspace cache files
    if (workspaces.default) {
        workspaces.default.cacheFiles.forEach(file => files.add(file));
    }

    // Include active workspace cache files if not default
    if (activeWorkspace !== 'default' && workspaces[activeWorkspace]) {
        workspaces[activeWorkspace].cacheFiles.forEach(file => files.add(file));
    }

    return Array.from(files);
}

// Move cache files between workspaces
function moveCacheFilesToWorkspace(hashes, targetWorkspaceId) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[targetWorkspaceId]) {
        throw new Error(`Target workspace ${targetWorkspaceId} not found`);
    }

    let movedCount = 0;

    // Remove cache files from all workspaces first
    Object.values(workspaces).forEach(workspace => {
        const originalLength = workspace.cacheFiles.length;
        workspace.cacheFiles = workspace.cacheFiles.filter(hash => !hashes.includes(hash));
        if (workspace.cacheFiles.length < originalLength) {
            movedCount += originalLength - workspace.cacheFiles.length;
        }
    });

    // Add cache files to target workspace (avoiding duplicates)
    const existingFiles = new Set(workspaces[targetWorkspaceId].cacheFiles);
    const newFiles = hashes.filter(hash => !existingFiles.has(hash));
    workspaces[targetWorkspaceId].cacheFiles.push(...newFiles);

    saveWorkspaces();
    console.log(`✅ Moved ${movedCount} cache files to workspace: ${workspaces[targetWorkspaceId].name}`);
    return movedCount;
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
        console.log(`📁 Sorted ${totalSorted} files across all workspaces by timestamp`);
    }
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

    console.log(`✅ Workspace system initialized with ${Object.keys(workspaces).length} workspaces`);
}

// Add file to scraps
function addFileToScraps(filename, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const targetId = workspaceId || activeWorkspace;
    
    if (!workspaces[targetId]) {
        throw new Error(`Workspace ${targetId} not found`);
    }

    // Initialize scraps array if it doesn't exist
    if (!workspaces[targetId].scraps) {
        workspaces[targetId].scraps = [];
    }

    if (!workspaces[targetId].scraps.includes(filename)) {
        // Add to scraps
        workspaces[targetId].scraps.push(filename);
        
        // Remove from main files list
        workspaces[targetId].files = workspaces[targetId].files.filter(file => file !== filename);
        
        saveWorkspaces();
        console.log(`✅ Added file ${filename} to scraps and removed from images in workspace: ${workspaces[targetId].name}`);
    }
}

// Remove file from scraps and move back to images
function removeFileFromScraps(filename, workspaceId = null) {
    if (!workspaces) {
        loadWorkspaces();
    }

    const targetId = workspaceId || activeWorkspace;
    
    if (!workspaces[targetId]) {
        throw new Error(`Workspace ${targetId} not found`);
    }

    // Initialize scraps array if it doesn't exist
    if (!workspaces[targetId].scraps) {
        workspaces[targetId].scraps = [];
    }

    const originalLength = workspaces[targetId].scraps.length;
    workspaces[targetId].scraps = workspaces[targetId].scraps.filter(file => file !== filename);
    
    if (workspaces[targetId].scraps.length < originalLength) {
        // Move the file back to the images list
        if (!workspaces[targetId].files.includes(filename)) {
            workspaces[targetId].files.push(filename);
        }
        
        saveWorkspaces();
        console.log(`✅ Removed file ${filename} from scraps and moved back to images in workspace: ${workspaces[targetId].name}`);
    }
}

// Get scraps for active workspace (includes default)
function getActiveWorkspaceScraps() {
    if (!workspaces) {
        loadWorkspaces();
    }

    // Initialize scraps arrays if they don't exist
    if (workspaces.default && !workspaces.default.scraps) {
        workspaces.default.scraps = [];
    }
    if (workspaces[activeWorkspace] && !workspaces[activeWorkspace].scraps) {
        workspaces[activeWorkspace].scraps = [];
    }

    // Include active workspace scraps if not default
    if (workspaces[activeWorkspace]) {
        return workspaces[activeWorkspace].scraps;
    } 
    return workspaces.default.scraps;
}

// Move files to scraps
function moveFilesToScraps(filenames, targetWorkspaceId) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[targetWorkspaceId]) {
        throw new Error(`Target workspace ${targetWorkspaceId} not found`);
    }

    // Initialize scraps array if it doesn't exist
    if (!workspaces[targetWorkspaceId].scraps) {
        workspaces[targetWorkspaceId].scraps = [];
    }

    let movedCount = 0;

    // Remove files from all workspaces first
    Object.values(workspaces).forEach(workspace => {
        const originalLength = workspace.files.length;
        workspace.files = workspace.files.filter(file => !filenames.includes(file));
        if (workspace.files.length < originalLength) {
            movedCount += originalLength - workspace.files.length;
        }
    });

    // Add files to target workspace scraps (avoiding duplicates)
    const existingScraps = new Set(workspaces[targetWorkspaceId].scraps);
    const newScraps = filenames.filter(file => !existingScraps.has(file));
    workspaces[targetWorkspaceId].scraps.push(...newScraps);

    saveWorkspaces();
    console.log(`✅ Moved ${movedCount} files to scraps in workspace: ${workspaces[targetWorkspaceId].name}`);
    return movedCount;
}

// Move scraps between workspaces
function moveScrapsToWorkspace(filenames, targetWorkspaceId) {
    if (!workspaces) {
        loadWorkspaces();
    }

    if (!workspaces[targetWorkspaceId]) {
        throw new Error(`Target workspace ${targetWorkspaceId} not found`);
    }

    // Initialize scraps array if it doesn't exist
    if (!workspaces[targetWorkspaceId].scraps) {
        workspaces[targetWorkspaceId].scraps = [];
    }

    // Filter out null/invalid filenames
    const validFilenames = filenames.filter(filename => filename && typeof filename === 'string');
    
    if (validFilenames.length === 0) {
        console.log('⚠️ No valid filenames provided for moving scraps');
        return 0;
    }

    let movedCount = 0;

    // Remove scraps from all workspaces first
    Object.values(workspaces).forEach(workspace => {
        // Initialize scraps array if it doesn't exist
        if (!workspace.scraps) {
            workspace.scraps = [];
        }
        
        const originalLength = workspace.scraps.length;
        workspace.scraps = workspace.scraps.filter(file => !validFilenames.includes(file));
        if (workspace.scraps.length < originalLength) {
            movedCount += originalLength - workspace.scraps.length;
        }
    });

    // Add scraps to target workspace (avoiding duplicates)
    const existingScraps = new Set(workspaces[targetWorkspaceId].scraps);
    const newScraps = validFilenames.filter(file => !existingScraps.has(file));
    workspaces[targetWorkspaceId].scraps.push(...newScraps);

    saveWorkspaces();
    console.log(`✅ Moved ${movedCount} scraps to workspace: ${workspaces[targetWorkspaceId].name}`);
    return movedCount;
}

// Remove files from all workspaces (used when files are deleted)
function removeFilesFromWorkspaces(filenames) {
    if (!workspaces) {
        loadWorkspaces();
    }

    // Filter out null/invalid filenames
    const validFilenames = filenames.filter(filename => filename && typeof filename === 'string');
    
    if (validFilenames.length === 0) {
        console.log('⚠️ No valid filenames provided for removal from workspaces');
        return 0;
    }

    let removedCount = 0;

    // Remove files from all workspaces
    Object.values(workspaces).forEach(workspace => {
        const originalLength = workspace.files.length;
        workspace.files = workspace.files.filter(file => !validFilenames.includes(file));
        removedCount += originalLength - workspace.files.length;
        
        // Also remove from scraps if present
        if (workspace.scraps) {
            const originalScrapsLength = workspace.scraps.length;
            workspace.scraps = workspace.scraps.filter(file => !validFilenames.includes(file));
            removedCount += originalScrapsLength - workspace.scraps.length;
        }
    });

    if (removedCount > 0) {
        saveWorkspaces();
        console.log(`🗑️ Removed ${removedCount} files from all workspaces`);
    }

    return removedCount;
}

module.exports = {
    initializeWorkspaces,
    loadWorkspaces,
    saveWorkspaces,
    syncWorkspaceFiles,
    sortAllWorkspaceFiles,
    getWorkspaces,
    getWorkspace,
    createWorkspace,
    renameWorkspace,
    updateWorkspaceColor,
    updateWorkspaceBackgroundColor,
    updateWorkspaceBackgroundImage, // Added updateWorkspaceBackgroundImage to exports
    updateWorkspaceBackgroundOpacity, // Added updateWorkspaceBackgroundOpacity to exports
    deleteWorkspace,
    dumpWorkspace,
    moveFilesToWorkspace,
    getActiveWorkspace,
    setActiveWorkspace,
    getActiveWorkspaceFiles,
    addFileToWorkspace,
    addCacheFileToWorkspace,
    getActiveWorkspaceCacheFiles,
    moveCacheFilesToWorkspace,
    addFileToScraps,
    removeFileFromScraps,
    getActiveWorkspaceScraps,
    moveFilesToScraps,
    moveScrapsToWorkspace,
    removeFilesFromWorkspaces
};