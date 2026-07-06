const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const sharp = require('sharp');
const wsPacketRegistry = require('../wsPacketRegistry');
const { isImageLarge, matchOriginalResolution } = require('../../imageTools');

const GALLERY_DESTRUCTIVE = { destructive: true };

function buildGalleryHash(baseArray, workspaceId, viewType) {
    // Stable identity hash: file membership only (no mtime, no pin state).
    const hashItems = [...baseArray].sort((a, b) => String(a.base || '').localeCompare(String(b.base || '')));
    const hashSource = hashItems.map(item => {
        return `${item.base}|${item.original || ''}|${item.upscaled || ''}`;
    }).join('\n');

    return crypto.createHash('sha256')
        .update(`${workspaceId}::${viewType}::${baseArray.length}::${hashSource}`)
        .digest('hex');
}

function buildPinnedIndexes(baseArray, pinnedFiles, existingFilenamesSet = null) {
    const rawPins = Array.isArray(pinnedFiles) ? pinnedFiles : [];
    const pinsForHash = (existingFilenamesSet && typeof existingFilenamesSet.has === 'function')
        ? rawPins.filter(f => existingFilenamesSet.has(f))
        : rawPins;
    if (!pinsForHash.length || !baseArray.length) {
        return [];
    }

    const fileToIndex = new Map();
    for (let i = 0; i < baseArray.length; i++) {
        const { original, upscaled } = baseArray[i];
        if (original) {
            fileToIndex.set(original, i);
        }
        if (upscaled) {
            fileToIndex.set(upscaled, i);
        }
    }

    const pinnedIndexes = [];
    for (let p = 0; p < pinsForHash.length; p++) {
        const idx = fileToIndex.get(pinsForHash[p]);
        if (idx !== undefined) {
            pinnedIndexes.push(idx);
        }
    }
    if (pinnedIndexes.length > 1) {
        pinnedIndexes.sort((a, b) => a - b);
    }
    return pinnedIndexes;
}

function filterGalleryBaseItems(baseArray, viewType, lightweightMetadata = {}) {
    const items = [];
    for (const item of baseArray) {
        const file = item.upscaled || item.original;
        if (!file) {
            continue;
        }
        if (viewType === 'upscaled') {
            const meta = lightweightMetadata[file] || {};
            const isLarge = meta.width && meta.height
                ? isImageLarge(meta.width, meta.height)
                : false;
            if (!item.upscaled && !isLarge) {
                continue;
            }
        }
        items.push(item);
    }
    return items;
}

async function handleGalleryRequest(handlers, ws, message, clientInfo, wsServer) {
    const { requestId, viewType = 'images', includePinnedStatus = true, light = false, offset = 0, limit = 100, workspaceId: clientWorkspaceId } = message;

    try {
        // Start keep-alive for potentially long gallery requests
        handlers.startKeepAliveInterval(ws, requestId, 10000); // Every 10 seconds for gallery requests

        const wm = handlers.globalResources.getWorkspaceManager();
        const workspaces = handlers.globalResources.getWorkspacesConfig();
        let activeWorkspaceId = wm.getActiveWorkspace(clientInfo.sessionId) || 'default';

        // Honor client workspace so gallery stays in sync after reconnect (session map may still be default)
        if (clientWorkspaceId && workspaces[clientWorkspaceId]) {
            if (clientWorkspaceId !== activeWorkspaceId) {
                wm.setActiveWorkspace(clientWorkspaceId, clientInfo.sessionId);
            }
            activeWorkspaceId = clientWorkspaceId;
        }

        // Get files based on view type
        let files;
        if (viewType === 'scraps') {
            files = wm.getActiveWorkspaceScraps(clientInfo.sessionId);
        } else if (viewType === 'pinned') {
            files = wm.getActiveWorkspacePinned(clientInfo.sessionId);
        } else if (viewType === 'upscaled') {
            const workspaceFiles = wm.getActiveWorkspaceFiles(clientInfo.sessionId);
            files = workspaceFiles;

            // Load metadata only for workspace files to find large resolution images (area > 1024x1024)
            const workspaceMetadata = await handlers.globalResources.getMetadataDatabase().getMultipleMetadata(workspaceFiles);

            // Find large resolution images in the current workspace
            const specialImages = [];
            for (const [filename, metadata] of Object.entries(workspaceMetadata)) {
                if (metadata.width && metadata.height && isImageLarge(metadata.width, metadata.height)) {
                    specialImages.push(filename);
                }
            }

            // Add special images to the files list (they're already in workspace files, so no duplicates)
            files = [...new Set([...files, ...specialImages])];
        } else {
            // Default to regular images
            files = wm.getActiveWorkspaceFiles(clientInfo.sessionId);
        }

        // Get pinned status if requested
        let pinnedFiles = [];
        if (includePinnedStatus) {
            pinnedFiles = wm.getActiveWorkspacePinned(clientInfo.sessionId);
        }

        if (!Array.isArray(files)) {
            console.error('Files is not an array:', files);
            files = [];
        }

        const existingOnDisk = wm.filterFilenamesExistingOnDisk(files, pinnedFiles);
        files = files.filter(f => existingOnDisk.has(f));
        if (includePinnedStatus) {
            pinnedFiles = pinnedFiles.filter(f => existingOnDisk.has(f));
        }

        // Helper function to get base name
        const getBaseName = (filename) => {
            const base = filename.replace(/\.(png|jpg|jpeg)$/i, '');
            return base.replace(/_upscaled$/, '');
        };

        // Helper function to get preview filename
        const getPreviewFilename = (baseName) => {
            return `${baseName}.webp`;
        };

        // Convert files to baseMap for processing
        const baseMap = {};
        for (const file of files) {
            const base = getBaseName(file);
            if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
            if (file.includes('_upscaled')) baseMap[base].upscaled = file;
            else baseMap[base].original = file;
        }

        // Convert to array and sort by newest first
        let baseArray = Object.keys(baseMap).map(base => ({
            base,
            ...baseMap[base]
        }));

        // Get mtime for sorting (lightweight query)
        let sortMetadata = {};
        if (baseArray.length > 0) {
            const allFilesForSort = baseArray.flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
            sortMetadata = await handlers.globalResources.getMetadataDatabase().getLightweightMetadata(allFilesForSort);

            // Add mtime to each item for sorting
            baseArray.forEach(item => {
                const file = item.upscaled || item.original;
                const metadata = sortMetadata[file];
                item.mtime = metadata?.mtime || Date.now();
            });
        }

        // Sort by newest first, then build the view-filtered index used for hash, pins, and pagination
        baseArray.sort((a, b) => b.mtime - a.mtime);
        const galleryIndexBase = filterGalleryBaseItems(baseArray, viewType, sortMetadata);
        const galleryHash = buildGalleryHash(galleryIndexBase, activeWorkspaceId, viewType);
        const pinnedIndexes = (viewType === 'images' && includePinnedStatus)
            ? buildPinnedIndexes(galleryIndexBase, pinnedFiles, existingOnDisk)
            : [];
        const workspaceRecord = handlers.globalResources.getWorkspaceManager().getWorkspace(activeWorkspaceId);
        const lastGalleryDestructiveAt = Number(workspaceRecord?.lastGalleryDestructiveAt) || 0;

        // Apply pagination on the filtered index so offsets, pins, and totals align with the response
        const totalItems = galleryIndexBase.length;
        const paginatedItems = galleryIndexBase.slice(offset, offset + limit);
        const hasMore = (offset + limit) < totalItems;

        let gallery = [];

        if (light) {
            // Light mode: file identity + lightweight DB fields (mtime/dims) — no full metadata blobs
            const pageFiles = paginatedItems.flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
            const lightweightForPage = pageFiles.length > 0
                ? await handlers.globalResources.getMetadataDatabase().getLightweightMetadata(pageFiles)
                : {};

            for (const item of paginatedItems) {
                const { base, original, upscaled, mtime } = item;
                const file = upscaled || original;
                if (!file) continue;

                const meta = lightweightForPage[file] || sortMetadata[file] || {};
                const isLarge = meta.width && meta.height
                    ? isImageLarge(meta.width, meta.height)
                    : false;

                gallery.push({
                    base,
                    original,
                    upscaled,
                    filename: file,
                    preview: getPreviewFilename(base),
                    mtime: mtime || meta.mtime || Date.now(),
                    width: meta.width || null,
                    height: meta.height || null,
                    size: meta.size || 0,
                    isLarge,
                    isPinned: includePinnedStatus ? pinnedFiles.includes(file) : false
                });
            }
        } else {
            // Full mode: load metadata for paginated items
            const filesToLoad = paginatedItems.flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
            const allMetadata = await handlers.globalResources.getMetadataDatabase().getMultipleMetadata(filesToLoad);

            for (const item of paginatedItems) {
                const { base, original, upscaled } = item;

                // Get the file to use (prefer upscaled, then original)
                const file = upscaled || original;
                if (!file) continue;

                // Get metadata from database (already loaded in batch)
                let fileMetadata = allMetadata[file];
                if (!fileMetadata) {
                    // If not in batch, try individual lookup
                    try {
                        fileMetadata = await handlers.globalResources.getMetadataDatabase().getCachedMetadata(file);
                        if (!fileMetadata) {
                            console.log(`🔄 Loading metadata for file: ${file}`);
                            // Try to extract metadata for the missing file
                            fileMetadata = await handlers.globalResources.getMetadataDatabase().getImageMetadata(file, handlers.globalResources.getPath("images"));
                            if (!fileMetadata) {
                                console.warn(`❌ Could not extract metadata for file: ${file}`);
                                continue;
                            }
                        }
                    } catch (error) {
                        console.error(`❌ Error loading metadata for file ${file}:`, error);
                        continue;
                    }
                }

                const preview = getPreviewFilename(base);
                const isLarge = fileMetadata?.width && fileMetadata?.height ?
                    isImageLarge(fileMetadata.width, fileMetadata.height) : false;

                gallery.push({
                    base,
                    original,
                    upscaled,
                    filename: file,
                    preview,
                    mtime: fileMetadata.mtime || Date.now(),
                    size: fileMetadata.size || 0,
                    isLarge: isLarge,
                    isPinned: includePinnedStatus ? pinnedFiles.includes(file) : false,
                    // Include dimensions for PhotoSwipe
                    width: fileMetadata.width || null,
                    height: fileMetadata.height || null
                });
            }
        }

        // Stop keep-alive when complete
        handlers.stopKeepAliveInterval(requestId);

        // Send response — pinnedIndexes are global gallery positions; per-item isPinned is set on each row
        handlers.sendToClient(ws, {
            type: 'request_gallery_response',
            requestId: requestId,
            data: {
                gallery,
                viewType,
                workspaceId: activeWorkspaceId,
                galleryHash,
                pinnedIndexes: (viewType === 'images' && includePinnedStatus) ? pinnedIndexes : [],
                lastGalleryDestructiveAt,
                pagination: {
                    offset,
                    limit,
                    hasMore,
                    totalItems
                }
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        // Stop keep-alive on error
        handlers.stopKeepAliveInterval(requestId);

        console.error('Gallery request error:', error);
        handlers.sendError(ws, 'Failed to load gallery', error.message, requestId);
    }
}

async function resolveImageWorkspaceOwnership(handlers, filename) {
    if (!filename) return null;

    const metadataDb = handlers.globalResources.getMetadataDatabase();
    const fromDb = await metadataDb.getGalleryOwnershipForFilename(filename);
    if (fromDb) return fromDb;

    const workspaces = handlers.globalResources.getWorkspacesConfig();
    const matches = [];
    for (const [workspaceId, workspace] of Object.entries(workspaces || {})) {
        let bucket = null;
        if (workspace.files?.includes(filename)) bucket = 'files';
        else if (workspace.pinned?.includes(filename)) bucket = 'pinned';
        else if (workspace.scraps?.includes(filename)) bucket = 'scraps';
        if (bucket) matches.push({ workspaceId, bucket });
    }
    if (!matches.length) return null;

    return {
        workspaceId: matches[0].workspaceId,
        bucket: matches[0].bucket,
        workspaces: matches
    };
}

// Handle image metadata request messages
async function handleImageMetadataRequest(handlers, ws, message, clientInfo, wsServer) {
    const { filename } = message;

    if (!filename) {
        handlers.sendError(ws, 'Missing filename parameter', 'request_image_metadata');
        return;
    }

    try {
        // Get the images directory
        const filePath = path.join(handlers.globalResources.getPath("images"), filename);

        if (!fs.existsSync(filePath)) {
            handlers.sendError(ws, 'Image not found', 'request_image_metadata', message.requestId);
            return;
        }

        // Check in-memory cache first
        const workspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        
        // Track client workspace usage
        handlers.metadataCache.trackClientWorkspace(clientInfo.sessionId, workspaceId);
        
        let cachedMetadata = handlers.metadataCache.get(workspaceId, filename);

        // If not in cache, get from database
        if (!cachedMetadata) {
            cachedMetadata = await handlers.globalResources.getMetadataDatabase().getCachedMetadata(filename, false);
            
            // If found in database, add to cache
            if (cachedMetadata) {
                handlers.metadataCache.set(workspaceId, filename, cachedMetadata);
            }
        }

        // If still not found, extract and update cache
        if (!cachedMetadata) {
            console.log(`🔄 Metadata not found in cache for ${filename}, extracting...`);
            cachedMetadata = await handlers.globalResources.getMetadataDatabase().getImageMetadata(filename, handlers.globalResources.getPath("images"));
            if (!cachedMetadata) {
                handlers.sendError(ws, 'Failed to extract metadata', 'request_image_metadata', message.requestId);
                return;
            }
            // Add to cache
            handlers.metadataCache.set(workspaceId, filename, cachedMetadata);
        }

        // If not in cache, extract and update cache
        if (!cachedMetadata) {
            console.log(`🔄 Metadata not found in cache for ${filename}, extracting...`);
            cachedMetadata = await handlers.globalResources.getMetadataDatabase().getImageMetadata(filename, handlers.globalResources.getPath("images"));
            if (!cachedMetadata) {
                handlers.sendError(ws, 'Failed to extract metadata', 'request_image_metadata', message.requestId);
                return;
            }
        }

        // Get the metadata object (PNG embedded metadata)
        let metadata = cachedMetadata.metadata;

        // If this is an upscaled image and has a parent, get the parent's metadata (without receipts)
        if (cachedMetadata.upscaled && cachedMetadata.parent) {
            const parentMetadata = await handlers.globalResources.getMetadataDatabase().getCachedMetadata(cachedMetadata.parent, false);
            if (parentMetadata) {
                metadata = parentMetadata.metadata;
                console.log(`📋 Using parent metadata for upscaled image: ${cachedMetadata.parent}`);
            } else {
                console.log(`⚠️ Parent metadata not found for: ${cachedMetadata.parent}`);
            }
        }

        if (!metadata) {
            handlers.sendError(ws, 'No NovelAI metadata found', 'request_image_metadata', message.requestId);
            return;
        }

        // Ensure actual dimensions are available in metadata (for backward compatibility)
        if (!metadata.actual_width) {
            metadata.actual_width = cachedMetadata.width;
        }
        if (!metadata.actual_height) {
            metadata.actual_height = cachedMetadata.height;
        }

        // If upscaled, try to match preset using metadata dimensions
        let matchedPreset = null;
        const isUpscaled = metadata.forge_data?.upscale_ratio !== null && metadata.forge_data?.upscale_ratio !== undefined;
        if (isUpscaled) {
            const currentPromptConfig = handlers.globalResources.getPromptConfig();
            matchedPreset = matchOriginalResolution(metadata, currentPromptConfig.resolutions || {});
        }

        const result = await handlers.globalResources.getPngMetadata().extractRelevantFields(metadata, filename);
        if (matchedPreset) result.matchedPreset = matchedPreset;

        const ownership = await resolveImageWorkspaceOwnership(handlers, filename);
        if (ownership) {
            result.workspaceId = ownership.workspaceId;
            result.workspaceIds = ownership.workspaces.map((entry) => entry.workspaceId);
            result.workspaceBucket = ownership.bucket;
        }

        // Send response
        handlers.sendToClient(ws, {
            type: 'request_image_metadata_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Image metadata request error:', error);
        handlers.sendError(ws, 'Failed to load image metadata', error.message, message.requestId);
    }
}

// Helper function to build gallery data for a given view type
async function buildGalleryData(handlers, viewType = 'images', clientInfo = null) {
    // Helper functions for file processing
    const getBaseName = (filename) => {
        const base = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
        return base.replace(/_upscaled$/, '');
    };

    // Validate that clientInfo is provided since workspace functions now require session IDs
    if (!clientInfo || !clientInfo.sessionId) {
        throw new Error('Client info with session ID is required to build gallery data');
    }

    // Get files based on view type
    let files;
    const sessionId = clientInfo.sessionId;
    switch (viewType) {
        case 'scraps':
            files = handlers.globalResources.getWorkspaceManager().getActiveWorkspaceScraps(sessionId);
            break;
        case 'pinned':
            files = handlers.globalResources.getWorkspaceManager().getActiveWorkspacePinned(sessionId);
            break;
        case 'upscaled':
            // For upscaled view, get all files and filter for upscaled/large images
            const workspaceFiles = handlers.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
            files = workspaceFiles;

            // Load metadata only for workspace files to find large resolution images (area > 1024x1024)
            const workspaceMetadata = await handlers.globalResources.getMetadataDatabase().getMultipleMetadata(workspaceFiles);

            // Find large resolution images in the current workspace
            const specialImages = [];
            for (const [filename, metadata] of Object.entries(workspaceMetadata)) {
                if (metadata.width && metadata.height && isImageLarge(metadata.width, metadata.height)) {
                    specialImages.push(filename);
                }
            }

            // Add special images to the files list
            files = [...new Set([...files, ...specialImages])];
            break;
        case 'images':
        default:
            files = handlers.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
            break;
    }

    if (!Array.isArray(files)) {
        console.error('Files is not an array:', files);
        files = [];
    }

    const wm = handlers.globalResources.getWorkspaceManager();
    const existingOnDisk = wm.filterFilenamesExistingOnDisk(files);
    files = files.filter(f => existingOnDisk.has(f));

    const baseMap = {};
    for (const file of files) {
        const base = getBaseName(file);
        if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
        if (file.includes('_upscaled')) baseMap[base].upscaled = file;
        else baseMap[base].original = file;
    }

    // Get all metadata in batch (without receipts for performance)
    const allFiles = Object.values(baseMap).flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
    const allMetadata = await handlers.globalResources.getMetadataDatabase().getMultipleMetadata(allFiles);
    
    const gallery = [];
    for (const base in baseMap) {
        const { original, upscaled } = baseMap[base];

        // Get the file to use (prefer upscaled, then original)
        const file = upscaled || original;
        if (!file) continue;

        // Get metadata from batch (already loaded)
        let metadata = allMetadata[file];
        if (!metadata) {
            // If not in batch, try individual lookup (without receipts)
            metadata = await handlers.globalResources.getMetadataDatabase().getCachedMetadata(file, false);
            if (!metadata) {
                console.log(`🔄 Loading metadata for file: ${file}`);
                try {
                    // Try to extract metadata for the missing file
                    metadata = await handlers.globalResources.getMetadataDatabase().getImageMetadata(file, handlers.globalResources.getPath("images"));
                    if (!metadata) {
                        console.warn(`❌ Could not extract metadata for file: ${file}`);
                        continue;
                    }
                } catch (error) {
                    console.error(`❌ Error loading metadata for file ${file}:`, error);
                    continue;
                }
            }
        }

        const preview = `${base}.webp`;
        const isLarge = metadata?.width && metadata?.height ?
            isImageLarge(metadata.width, metadata.height) : false;

        if (viewType === 'upscaled') {
            // For upscaled view, include images that have upscaled versions OR are wallpaper/large
            const shouldInclude = upscaled || isLarge;
            if (!shouldInclude) continue;
        }

        gallery.push({
            base,
            original,
            upscaled,
            preview,
            mtime: metadata.mtime || Date.now(),
            size: metadata.size || 0,
            isLarge: isLarge,
            // Include dimensions for PhotoSwipe
            width: metadata.width || null,
            height: metadata.height || null,
            seed: metadata.metadata?.seed || null
        });
    }

    // Sort by newest first
    gallery.sort((a, b) => b.mtime - a.mtime);

    return gallery;
}

// Handle image by index request messages
async function handleImageByIndexRequest(handlers, ws, message, clientInfo, wsServer) {
    const { index, viewType = 'images' } = message;

    if (index === undefined || index === null) {
        handlers.sendError(ws, 'Missing index parameter', 'request_image_by_index');
        return;
    }

    try {
        // Get files based on view type (same logic as buildGalleryData but optimized)
        const sessionId = clientInfo.sessionId;
        let files;
        switch (viewType) {
            case 'scraps':
                files = handlers.globalResources.getWorkspaceManager().getActiveWorkspaceScraps(sessionId);
                break;
            case 'pinned':
                files = handlers.globalResources.getWorkspaceManager().getActiveWorkspacePinned(sessionId);
                break;
            case 'upscaled':
                files = handlers.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
                // Note: For upscaled view, we'd need to filter, but for single image lookup we'll skip this optimization
                break;
            case 'images':
            default:
                files = handlers.globalResources.getWorkspaceManager().getActiveWorkspaceFiles(sessionId);
                break;
        }

        if (!Array.isArray(files) || files.length === 0) {
            handlers.sendError(ws, 'No images found', 'request_image_by_index', message.requestId);
            return;
        }

        // Build base map (same as buildGalleryData)
        const getBaseName = (filename) => {
            const base = filename.replace(/\.(png|jpg|jpeg|webp)$/i, '');
            return base.replace(/_upscaled$/, '');
        };

        const baseMap = {};
        for (const file of files) {
            const base = getBaseName(file);
            if (!baseMap[base]) baseMap[base] = { original: null, upscaled: null };
            if (file.includes('_upscaled')) baseMap[base].upscaled = file;
            else baseMap[base].original = file;
        }

        // Get all files for lightweight metadata lookup (only for sorting)
        const allFiles = Object.values(baseMap).flatMap(({ original, upscaled }) => [original, upscaled].filter(Boolean));
        const lightweightMetadata = await handlers.globalResources.getMetadataDatabase().getLightweightMetadata(allFiles);

        // Build minimal gallery array with just what we need for sorting
        const gallery = [];
        for (const base in baseMap) {
            const { original, upscaled } = baseMap[base];
            const file = upscaled || original;
            if (!file) continue;

            const metadata = lightweightMetadata[file];
            if (!metadata) continue;

            // Filter for upscaled view if needed
            if (viewType === 'upscaled') {
                const isLarge = metadata?.width && metadata?.height ?
                    isImageLarge(metadata.width, metadata.height) : false;
                if (!upscaled && !isLarge) continue;
            }

            gallery.push({
                base,
                original,
                upscaled,
                preview: `${base}.webp`,
                mtime: metadata.mtime || Date.now(),
                size: metadata.size || 0,
                isLarge: metadata?.width && metadata?.height ?
                    isImageLarge(metadata.width, metadata.height) : false,
                width: metadata.width || null,
                height: metadata.height || null
            });
        }

        // Sort by newest first
        gallery.sort((a, b) => b.mtime - a.mtime);

        // Check if index is valid
        if (index < 0 || index >= gallery.length) {
            handlers.sendError(ws, 'Index out of bounds', 'request_image_by_index', message.requestId);
            return;
        }

        const image = gallery[index];

        // Load full metadata only for the target image (check cache first)
        let metadata = null;
        try {
            const filePath = path.join(handlers.globalResources.getPath("images"), image.original);
            if (fs.existsSync(filePath)) {
                const workspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
                
                // Track client workspace usage
                handlers.metadataCache.trackClientWorkspace(clientInfo.sessionId, workspaceId);
                
                // Check in-memory cache first
                let cachedMetadata = handlers.metadataCache.get(workspaceId, image.original);
                
                // If not in cache, get from database
                if (!cachedMetadata) {
                    cachedMetadata = await handlers.globalResources.getMetadataDatabase().getCachedMetadata(image.original, false);
                    
                    // If found, add to cache
                    if (cachedMetadata) {
                        handlers.metadataCache.set(workspaceId, image.original, cachedMetadata);
                    }
                }
                
                if (cachedMetadata && cachedMetadata.metadata) {
                    metadata = await handlers.globalResources.getPngMetadata().extractRelevantFields(cachedMetadata.metadata, image.original);
                }
            }
        } catch (metadataError) {
            console.warn('Failed to load metadata for image by index:', metadataError);
        }

        // Add metadata to image object
        const result = {
            ...image,
            metadata: metadata
        };

        // Send response
        handlers.sendToClient(ws, {
            type: 'request_image_by_index_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Image by index request error:', error);
        handlers.sendError(ws, 'Failed to load image by index', error.message, message.requestId);
    }
}

// Handle find image index request messages
async function handleFindImageIndexRequest(handlers, ws, message, clientInfo, wsServer) {
    const { filename, viewType = 'images' } = message;

    if (!filename) {
        handlers.sendError(ws, 'Missing filename parameter', 'find_image_index');
        return;
    }

    try {
        // Build gallery data using shared helper
        const gallery = await buildGalleryData(handlers, viewType, clientInfo);

        // Find the index of the requested filename
        const index = gallery.findIndex(img =>
            img.original === filename || img.upscaled === filename
        );

        // Send response
        handlers.sendToClient(ws, {
            type: 'find_image_index_response',
            requestId: message.requestId,
            data: { index: index >= 0 ? index : -1 },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Find image index request error:', error);
        handlers.sendError(ws, 'Failed to find image index', error.message, message.requestId);
    }
}
async function handleGalleryPositionHint(handlers, ws, message, clientInfo, wsServer) {
    try {
        if (!clientInfo || !clientInfo.sessionId) return;
        const store = handlers.globalResources.getSessionStore();
        if (!store || typeof store.get !== 'function') return;

        const { index, viewType, workspaceId, anchorFilename } = message;
        if (typeof viewType !== 'string' || viewType.length === 0) return;
        if (typeof index !== 'number' || !Number.isFinite(index) || index < 0) return;

        const wsKey = (workspaceId && typeof workspaceId === 'string') ? workspaceId : 'default';
        const key = `${wsKey}:${viewType}`;

        await new Promise((resolve) => {
            store.get(clientInfo.sessionId, (err, sess) => {
                if (err || !sess) {
                    resolve();
                    return;
                }
                sess.galleryScrollState = sess.galleryScrollState || {};
                sess.galleryScrollState[key] = {
                    index: Math.floor(index),
                    anchorFilename: typeof anchorFilename === 'string' && anchorFilename.length > 0 ? anchorFilename : undefined,
                    updatedAt: Date.now()
                };
                store.set(clientInfo.sessionId, sess, () => resolve());
            });
        });
    } catch (error) {
        console.error('gallery_position_hint error:', error);
    }
}
async function handleDeleteImagesBulk(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { filenames } = message;

        if (!filenames || !Array.isArray(filenames) || filenames.length === 0) {
            handlers.sendError(ws, 'Filenames array is required', 'delete_images_bulk', message.requestId);
            return;
        }

        const results = [];
        const errors = [];

        // Helper functions
        const getBaseName = (filename) => {
            return filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
        };

        const getPreviewFilename = (baseName) => {
            return `${baseName}_preview.png`;
        };

        for (const filename of filenames) {
            try {
                const filePath = path.join(handlers.globalResources.getPath("images"), filename);

                if (!fs.existsSync(filePath)) {
                    errors.push({ filename, error: 'File not found' });
                    continue;
                }

                // Get the base name to find related files
                const baseName = getBaseName(filename);
                const previewFile = getPreviewFilename(baseName);
                const previewPath = path.join(handlers.globalResources.getPath("previews"), previewFile);

                // Define all preview files that may exist
                const previewFiles = [
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}.webp`),
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}@2x.webp`),
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}@lq.webp`),
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}@blur.webp`),
                    previewPath // Legacy preview format
                ];

                // Always delete both the base and upscaled version
                const filesToDelete = [];
                const filenamesToRemoveFromWorkspaces = [];

                // Determine base/original and upscaled filenames
                let originalFilename, upscaledFilename;
                if (filename.includes('_upscaled')) {
                    upscaledFilename = filename;
                    originalFilename = filename.replace('_upscaled.png', '.png');
                } else {
                    originalFilename = filename;
                    upscaledFilename = filename.replace('.png', '_upscaled.png');
                }

                // Add original file if exists
                const originalPath = path.join(handlers.globalResources.getPath("images"), originalFilename);
                if (fs.existsSync(originalPath)) {
                    filesToDelete.push({ path: originalPath, type: 'original' });
                    filenamesToRemoveFromWorkspaces.push(originalFilename);

                    // Try to extract and delete dynGenPreview file from original
                    try {
                        const imageBuffer = fs.readFileSync(originalPath);
                        const metadata = handlers.globalResources.getPngMetadata().readMetadata(imageBuffer);
                        if (metadata?.tEXt?.Comment) {
                            const commentData = JSON.parse(metadata.tEXt.Comment);
                            const previewHash = commentData?.forge_data?.dynamic_generation?.compiled_prompt?.preview_image_hash;

                            if (previewHash) {
                                const dynGenPreviewDir = path.join(handlers.globalResources.getPath("cache"), 'dynGenPreview');
                                const dynGenPreviewPath = path.join(dynGenPreviewDir, `${previewHash}.png`);

                                if (fs.existsSync(dynGenPreviewPath)) {
                                    filesToDelete.push({ path: dynGenPreviewPath, type: 'dynGenPreview' });
                                    console.log(`🗑️ Will delete dynGenPreview: ${previewHash.substring(0, 8)}...`);
                                }
                            }
                        }
                    } catch (metadataError) {
                        // Silently ignore metadata extraction errors
                        console.debug(`Could not extract metadata for preview cleanup: ${metadataError.message}`);
                    }
                }

                // Add upscaled file if exists
                const upscaledPath = path.join(handlers.globalResources.getPath("images"), upscaledFilename);
                if (fs.existsSync(upscaledPath)) {
                    filesToDelete.push({ path: upscaledPath, type: 'upscaled' });
                    filenamesToRemoveFromWorkspaces.push(upscaledFilename);
                }

                // Add all preview files (webp and legacy formats)
                for (const previewFilePath of previewFiles) {
                    if (fs.existsSync(previewFilePath)) {
                        filesToDelete.push({ path: previewFilePath, type: 'preview' });
                    }
                }

                // Remove files from workspaces first
                if (filenamesToRemoveFromWorkspaces.length > 0) {
                    handlers.globalResources.getWorkspaceManager().removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                }

                // Remove metadata from cache
                await handlers.globalResources.getMetadataDatabase().removeImageMetadata(filenamesToRemoveFromWorkspaces);

                // Delete reference metadata for deleted files
                for (const filename of filenamesToRemoveFromWorkspaces) {
                    handlers.globalResources.getReferenceMetadataDatabase().deleteMetadata(filename);
                }

                // Delete all related files
                const deletedFiles = [];
                for (const file of filesToDelete) {
                    try {
                        fs.unlinkSync(file.path);
                        deletedFiles.push(file.type);
                    } catch (error) {
                        console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
                    }
                }

                results.push({ filename, deletedFiles });
                console.log(`🗑️ Bulk deleted: ${filename} (${deletedFiles.join(', ')})`);

            } catch (error) {
                errors.push({ filename, error: error.message });
            }
        }

        // Sync workspace files to remove any remaining references to deleted files
        await handlers.globalResources.getWorkspaceManager().syncWorkspaceFiles();

        console.log(`✅ Bulk delete completed: ${results.length} successful, ${errors.length} failed`);

        handlers.sendToClient(ws, {
            type: 'delete_images_bulk_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Bulk delete completed',
                results: results,
                errors: errors,
                totalProcessed: filenames.length,
                successful: results.length,
                failed: errors.length
            },
            timestamp: new Date().toISOString()
        });

        // Broadcast gallery update to all clients
        wsServer.broadcast({
            type: 'gallery_updated',
            data: {
                action: 'bulk_delete',
                deletedCount: results.length,
                viewType: 'images' // Default to images view for bulk delete
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Delete images bulk error:', error);
        handlers.sendError(ws, 'Failed to bulk delete images', error.message, message.requestId);
    }
}

async function handleSendToSequenziaBulk(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { filenames } = message;

        if (!Array.isArray(filenames) || filenames.length === 0) {
            handlers.sendError(ws, 'Filenames array is required', 'send_to_sequenzia_bulk', message.requestId);
            return;
        }

        // Check if sequenzia folder is configured
        const sequenziaFolder = handlers.globalResources.getConfig({ path: 'sequenziaFolder' });
        if (!sequenziaFolder) {
            handlers.sendError(ws, 'Sequenzia folder not configured in config.json', 'send_to_sequenzia_bulk', message.requestId);
            return;
        }

        // Create sequenzia folder if it doesn't exist
        if (!fs.existsSync(sequenziaFolder)) {
            try {
                fs.mkdirSync(sequenziaFolder, { recursive: true });
                console.log(`📁 Created sequenzia folder: ${sequenziaFolder}`);
            } catch (error) {
                handlers.sendError(ws, `Failed to create sequenzia folder: ${error.message}`, 'send_to_sequenzia_bulk', message.requestId);
                return;
            }
        }

        const results = [];
        const errors = [];

        for (const filename of filenames) {
            try {
                const filePath = path.join(handlers.globalResources.getPath("images"), filename);

                if (!fs.existsSync(filePath)) {
                    errors.push({ filename, error: 'File not found' });
                    continue;
                }

                // Get the base name to find related files
                const baseName = filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
                const previewFile = `${baseName}_preview.png`;
                const previewPath = path.join(handlers.globalResources.getPath('previews'), previewFile);

                // Define all preview files that may exist
                const previewFiles = [
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}.webp`),
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}@2x.webp`),
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}@lq.webp`),
                    path.join(handlers.globalResources.getPath("previews"), `${baseName}@blur.webp`),
                    previewPath // Legacy preview format
                ];

                // Find all related files
                const filesToMove = [];
                const filesToDelete = [];
                const filenamesToRemoveFromWorkspaces = [];

                // Determine base/original and upscaled filenames
                let originalFilename, upscaledFilename;
                if (filename.includes('_upscaled')) {
                    upscaledFilename = filename;
                    originalFilename = filename.replace('_upscaled.png', '.png');
                } else {
                    originalFilename = filename;
                    upscaledFilename = filename.replace('.png', '_upscaled.png');
                }

                // Add original file if exists
                const originalPath = path.join(handlers.globalResources.getPath("images"), originalFilename);
                if (fs.existsSync(originalPath)) {
                    filesToMove.push({ source: originalPath, type: 'original' });
                    filesToDelete.push(originalPath);
                    filenamesToRemoveFromWorkspaces.push(originalFilename);

                    // Try to extract and delete dynGenPreview file from original
                    try {
                        const imageBuffer = fs.readFileSync(originalPath);
                        const metadata = handlers.globalResources.getPngMetadata().readMetadata(imageBuffer);
                        if (metadata?.tEXt?.Comment) {
                            const commentData = JSON.parse(metadata.tEXt.Comment);
                            const previewHash = commentData?.forge_data?.dynamic_generation?.compiled_prompt?.preview_image_hash;

                            if (previewHash) {
                                const dynGenPreviewDir = path.join(handlers.globalResources.getPath("cache"), 'dynGenPreview');
                                const dynGenPreviewPath = path.join(dynGenPreviewDir, `${previewHash}.png`);

                                if (fs.existsSync(dynGenPreviewPath)) {
                                    filesToDelete.push(dynGenPreviewPath);
                                    console.log(`🗑️ Will delete dynGenPreview: ${previewHash.substring(0, 8)}...`);
                                }
                            }
                        }
                    } catch (metadataError) {
                        // Silently ignore metadata extraction errors
                        console.debug(`Could not extract metadata for preview cleanup: ${metadataError.message}`);
                    }
                }

                // Add upscaled file if exists
                const upscaledPath = path.join(handlers.globalResources.getPath("images"), upscaledFilename);
                if (fs.existsSync(upscaledPath)) {
                    filesToMove.push({ source: upscaledPath, type: 'upscaled' });
                    filesToDelete.push(upscaledPath);
                    filenamesToRemoveFromWorkspaces.push(upscaledFilename);
                }

                // Add all preview files (webp and legacy formats)
                for (const previewFilePath of previewFiles) {
                    if (fs.existsSync(previewFilePath)) {
                        filesToDelete.push(previewFilePath);
                    }
                }

                // Move files to sequenzia folder
                const movedFiles = [];
                for (const file of filesToMove) {
                    const destPath = path.join(sequenziaFolder, path.basename(file.source));
                    fs.copyFileSync(file.source, destPath);
                    movedFiles.push(file.type);
                    console.log(`📁 Moved to sequenzia: ${path.basename(file.source)}`);
                }

                // Delete files from original location
                const deletedFiles = [];
                for (const filePath of filesToDelete) {
                    fs.unlinkSync(filePath);
                    deletedFiles.push(path.basename(filePath));
                }

                if (movedFiles.length > 0) {
                    // Remove files from workspaces first
                    if (filenamesToRemoveFromWorkspaces.length > 0) {
                        handlers.globalResources.getWorkspaceManager().removeFilesFromWorkspaces(filenamesToRemoveFromWorkspaces);
                    }

                    // Remove metadata from cache
                    await handlers.globalResources.getMetadataDatabase().removeImageMetadata(filenamesToRemoveFromWorkspaces);

                    // Delete reference metadata for moved files
                    for (const fn of filenamesToRemoveFromWorkspaces) {
                        handlers.globalResources.getReferenceMetadataDatabase().deleteMetadata(fn);
                    }
                }

                results.push({ filename, movedFiles, deletedFiles });
                console.log(`✅ Sent to sequenzia: ${filename} (moved: ${movedFiles.join(', ')}, deleted: ${deletedFiles.join(', ')})`);

            } catch (error) {
                errors.push({ filename, error: error.message });
                console.error(`Failed to send ${filename} to Sequenzia:`, error);
            }
        }

        console.log(`✅ Send to sequenzia completed: ${results.length} successful, ${errors.length} failed`);

        handlers.sendToClient(ws, {
            type: 'send_to_sequenzia_bulk_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Images sent to sequenzia successfully',
                results: results,
                errors: errors,
                totalProcessed: filenames.length,
                successful: results.length,
                failed: errors.length
            },
            timestamp: new Date().toISOString()
        });

        // Broadcast gallery update to all clients
        wsServer.broadcast({
            type: 'gallery_updated',
            data: {
                action: 'bulk_sequenzia',
                movedCount: results.length,
                viewType: 'images'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Send to sequenzia bulk error:', error);
        handlers.sendError(ws, 'Failed to bulk send to sequenzia', error.message, message.requestId);
    }
}

async function handleUpdateImagePresetBulk(handlers, ws, message, clientInfo, wsServer) {
    try {
        const { filenames, presetName } = message;

        if (!Array.isArray(filenames) || filenames.length === 0) {
            handlers.sendError(ws, 'Filenames array is required', 'update_image_preset_bulk', message.requestId);
            return;
        }

        const results = [];
        const errors = [];

        for (const filename of filenames) {
            try {
                const filePath = path.join(handlers.globalResources.getPath("images"), filename);

                if (!fs.existsSync(filePath)) {
                    errors.push({ filename, error: 'File not found' });
                    continue;
                }

                // Read the current image and extract metadata
                const imageBuffer = fs.readFileSync(filePath);
                const metadata = handlers.globalResources.getPngMetadata().readMetadata(imageBuffer);

                if (!metadata) {
                    errors.push({ filename, error: 'Failed to read metadata' });
                    continue;
                }

                // Update the preset name in the metadata
                if (!metadata.forge_data) {
                    metadata.forge_data = {};
                }

                if (presetName === null || presetName === '') {
                    // Remove preset name
                    delete metadata.forge_data.preset_name;
                } else {
                    // Set new preset name
                    metadata.forge_data.preset_name = presetName;
                }

                // Update the image with new metadata
                const updatedImageBuffer = handlers.globalResources.getPngMetadata().updateMetadata(imageBuffer, metadata.forge_data);

                // Write the updated image back to disk
                fs.writeFileSync(filePath, updatedImageBuffer);

                results.push({ filename, presetName: presetName || 'removed' });
                console.log(`✏️ Updated preset name for ${filename}: ${presetName || 'removed'}`);

            } catch (error) {
                errors.push({ filename, error: error.message });
                console.error(`Failed to update preset name for ${filename}:`, error);
            }
        }

        console.log(`✅ Bulk preset update completed: ${results.length} successful, ${errors.length} failed`);

        handlers.sendToClient(ws, {
            type: 'update_image_preset_bulk_response',
            requestId: message.requestId,
            data: {
                success: true,
                message: 'Bulk preset update completed',
                results: results,
                errors: errors,
                totalProcessed: filenames.length,
                updatedCount: results.length,
                failed: errors.length
            },
            timestamp: new Date().toISOString()
        });

        // Broadcast gallery update to all clients
        wsServer.broadcast({
            type: 'gallery_updated',
            data: {
                action: 'bulk_preset_update',
                updatedCount: results.length,
                viewType: 'images'
            },
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('Update image preset bulk error:', error);
        handlers.sendError(ws, 'Failed to bulk update image presets', error.message, message.requestId);
    }
}
async function handleUrlUploadMetadataRequest(handlers, ws, message, clientInfo, wsServer) {
    const { filename } = message;

    if (!filename) {
        handlers.sendError(ws, 'Missing filename parameter', 'request_url_upload_metadata');
        return;
    }

    try {
        // Get the tempdownload directory path
        const tempDownloadDir = path.join(handlers.globalResources.getPath("cache"), 'tempdownload');
        const filePath = path.join(tempDownloadDir, filename);

        if (!fs.existsSync(filePath)) {
            handlers.sendError(ws, 'File not found in tempdownload folder', 'request_url_upload_metadata', message.requestId);
            return;
        }

        // Extract metadata from the file directly (skip cache, don't save to cache)
        const imageMetadata = await sharp(filePath).metadata().then(m => m ? { width: m.width, height: m.height } : null).catch(() => null);
        if (!imageMetadata) {
            handlers.sendError(ws, 'Failed to extract image metadata', 'request_url_upload_metadata', message.requestId);
            return;
        }

        // Extract PNG embedded metadata
        const pngMetadata = await handlers.globalResources.getPngMetadata().extractNovelAIMetadata(filePath);
        if (!pngMetadata) {
            handlers.sendError(ws, 'No NovelAI metadata found', 'request_url_upload_metadata', message.requestId);
            return;
        }

        // Return the raw metadata like handleImageMetadataRequest does
        // Don't transform it with extractRelevantFields - let the frontend handle that
        const result = {
            filename: filename,
            width: imageMetadata.width,
            height: imageMetadata.height,
            metadata: pngMetadata
        };

        // Send response
        handlers.sendToClient(ws, {
            type: 'request_url_upload_metadata_response',
            requestId: message.requestId,
            data: result,
            timestamp: new Date().toISOString()
        });

    } catch (error) {
        console.error('URL upload metadata request error:', error);
        handlers.sendError(ws, 'Failed to load URL upload metadata', error.message, message.requestId);
    }
}

/**
 * Register gallery WebSocket packet handlers on wsPacketRegistry.
 * @param {import('../../websocketHandlers').WebSocketMessageHandlers} handlersCtx
 */
function registerPackets(handlersCtx) {
    if (!handlersCtx) {
        console.warn('[120-galleryHandler] registerPackets: missing handlersCtx');
        return;
    }

    const regFn = (type, fn, meta = {}) => {
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await fn(ctx.handlers, ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'gallery', ...meta });
    };

    regFn('request_gallery', handleGalleryRequest);
    regFn('request_image_metadata', handleImageMetadataRequest);
    regFn('request_url_upload_metadata', handleUrlUploadMetadataRequest);
    regFn('request_image_by_index', handleImageByIndexRequest);
    regFn('find_image_index', handleFindImageIndexRequest);
    regFn('gallery_position_hint', handleGalleryPositionHint);
    regFn('delete_images_bulk', handleDeleteImagesBulk, GALLERY_DESTRUCTIVE);
    regFn('send_to_sequenzia_bulk', handleSendToSequenziaBulk);
    regFn('update_image_preset_bulk', handleUpdateImagePresetBulk, GALLERY_DESTRUCTIVE);
}

module.exports = {
    registerPackets,
    buildGalleryData
};
