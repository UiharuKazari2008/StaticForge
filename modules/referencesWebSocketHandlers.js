const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const sharp = require('sharp');
const { generateMobilePreviews } = require('./previewUtils');

const REFERENCES_DESTRUCTIVE = { destructive: true };

class ReferencesWebSocketHandlers {
    constructor(handlers) {
        this.handlers = handlers;
        this.globalResources = handlers.globalResources;
        this.vibeMetadataCache = new Map();
        this.cacheExpiryTime = 5 * 60 * 1000;
    }

    // References WebSocket Handlers
    async handleGetReferences(ws, message, clientInfo, wsServer) {
        try {
            const requestId = message.requestId;
            const activeWorkspaceId = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Start keep-alive for potentially long-running reference loading
            this.handlers.startKeepAliveInterval(ws, requestId, 10000);

            this.handlers.updateKeepAliveProgress(ws, requestId, 10, 'Loading cache files...');

            // Get cache file hashes for active workspace from database
            const workspaceIds = activeWorkspaceId !== 'default' 
                ? [activeWorkspaceId, 'default'] 
                : ['default'];
            const cacheFileHashes = refDb.getMultipleWorkspaceReferences(workspaceIds);

            // Get file cache data from database (much faster than file I/O)
            const fileCacheMap = refDb.getFileCacheForReferences(cacheFileHashes);
            
            // Batch get workspace ownership for all hashes (much faster than N queries)
            const workspaceOwnershipMap = refDb.getReferenceWorkspacesBatch(cacheFileHashes);

            const cacheFiles = [];
            for (const hash of cacheFileHashes) {
                const fileCache = fileCacheMap[hash];
                if (!fileCache) continue; // Skip if not in cache (file might have been deleted)

                // Get workspace ownership (from batch query)
                const workspaces = workspaceOwnershipMap[hash] || [];
                const workspaceId = workspaces.includes(activeWorkspaceId) ? activeWorkspaceId : 
                                   workspaces.includes('default') ? 'default' : 
                                   workspaces[0] || 'default';

                cacheFiles.push({
                    hash: hash,
                    filename: hash,
                    mtime: fileCache.cachedAt * 1000, // Convert seconds to milliseconds for client
                    size: fileCache.size,
                    hasPreview: true, // Cache files always have previews
                    workspaceId: workspaceId,
                    metadata: fileCache.metadata || null // Metadata already included from JOIN
                });
            }

            this.handlers.updateKeepAliveProgress(ws, requestId, 50, 'Loading vibe images...');

            // Get vibe IDs for workspaces from database
            const vibeIds = refDb.getMultipleWorkspaceVibes(workspaceIds);
            
            // Get vibe metadata from database
            const vibeMetadataMap = refDb.getVibeMetadataForVibes(vibeIds);
            
            // Batch get workspace ownership for all vibes (much faster than N queries)
            const vibeWorkspaceOwnershipMap = refDb.getVibeWorkspacesBatch(vibeIds);

            // Format vibe images for client
            const vibeImageDetails = [];
            for (const vibeId of vibeIds) {
                const vibe = vibeMetadataMap[vibeId];
                if (!vibe) continue;

                // Get workspace ownership for vibe (from batch query)
                const vibeWorkspaces = vibeWorkspaceOwnershipMap[vibeId] || [];
                const workspaceId = vibeWorkspaces.includes(activeWorkspaceId) ? activeWorkspaceId :
                                   vibeWorkspaces.includes('default') ? 'default' :
                                   vibeWorkspaces[0] || 'default';

                // Format for client (extract encoding metadata only, not full encoding strings)
                const encodingsMetadata = [];
                if (vibe.encodings && typeof vibe.encodings === 'object') {
                    for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                        if (modelEncodings && typeof modelEncodings === 'object') {
                            for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                                // Parse IE value first and skip if invalid
                                const ieValue = parseFloat(extractionValue);
                                if (isNaN(ieValue)) {
                                    continue;
                                }
                                // Encoding value is the actual encoding string - check if it exists and is valid
                                // Skip only if encoding is null, undefined, or empty string
                                if (encoding === null || encoding === undefined || (typeof encoding === 'string' && encoding.trim() === '')) {
                                    continue;
                                }
                                // Include this encoding in the metadata array
                                encodingsMetadata.push({
                                    model,
                                    informationExtraction: ieValue
                                });
                            }
                        }
                    }
                }

                // Preview existence - assume true if previewHash exists (previews are always generated)
                const hasPreview = !!vibe.previewHash;

                // Convert importedFrom: 1 = 'novelai', anything else = null
                // Handle both number and string types for robustness
                const importedFromValue = parseInt(vibe.importedFrom) || 0;
                const importedFromString = importedFromValue === 1 ? 'novelai' : null;
                
                // Ensure locked is always a boolean
                const isLocked = !!vibe.locked;
                
                // For base64 vibes, only include image property if there's no preview (fallback for client)
                // source already contains the base64 data, so image is only needed as fallback
                const isBase64 = vibe.type === 'base64';
                const base64Image = (isBase64 && !hasPreview && vibe.imageSource) ? vibe.imageSource : null;

                vibeImageDetails.push({
                    filename: `${vibeId}.json`, // For backward compatibility
                    id: vibe.id,
                    preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                    mtime: vibe.mtime,
                    createdAt: vibe.createdAt || vibe.mtime, // Client expects createdAt as alternative to mtime
                    size: 0, // Not needed, but kept for compatibility
                    encodings: encodingsMetadata,
                    type: isBase64 ? 'base64' : 'cache',
                    source: vibe.imageSource, // For base64 vibes, this contains the base64 data
                    ...(base64Image && { image: base64Image }), // Only include if no preview (fallback)
                    workspaceId: workspaceId,
                    comment: vibe.comment || null,
                    importedFrom: importedFromString,
                    locked: isLocked,
                    metadata: vibe.metadata || null // Metadata already included from JOIN
                });
            }

            // Sort by newest first
            cacheFiles.sort((a, b) => b.mtime - a.mtime);
            vibeImageDetails.sort((a, b) => b.mtime - a.mtime);

            this.handlers.updateKeepAliveProgress(ws, requestId, 100, 'Complete');

            this.handlers.sendToClient(ws, {
                type: 'get_references_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    data: {
                        cacheFiles: cacheFiles,
                        vibeImages: vibeImageDetails
                    }
                },
                timestamp: new Date().toISOString()
            });

            this.handlers.stopKeepAliveInterval(requestId);

        } catch (error) {
            console.error('Get references error:', error);
            this.handlers.stopKeepAliveInterval(message.requestId);
            this.handlers.sendError(ws, 'Failed to get references', error.message, message.requestId);
        }
    }

    async handleGetReferencesByIds(ws, message, clientInfo, wsServer) {
        try {
            const { references } = message;

            if (!references || !Array.isArray(references)) {
                this.handlers.sendError(ws, 'Invalid references array', 'References must be an array of objects with type and id', message.requestId);
                return;
            }

            const results = [];

            for (const ref of references) {
                const { type, id } = ref;

                if (!type || !id) {
                    console.warn(`Invalid reference object: ${JSON.stringify(ref)}`);
                    continue;
                }

                try {
                    if (type === 'vibe') {
                        // Get vibe image data
                        const vibeData = await this.getVibeImageData(id);
                        if (vibeData) {
                            results.push({
                                type: 'vibe',
                                id: id,
                                data: vibeData
                            });
                        }
                    } else if (type === 'cache') {
                        // Get cache image data
                        const cacheData = await this.getCacheImageData(id);
                        if (cacheData) {
                            results.push({
                                type: 'cache',
                                id: id,
                                data: cacheData
                            });
                        }
                    } else if (type === 'file') {
                        // Get file image data
                        const fileData = await this.getFileImageData(id);
                        if (fileData) {
                            results.push({
                                type: 'file',
                                id: id,
                                data: fileData
                            });
                        }
                    } else {
                        console.warn(`Unknown reference type: ${type}`);
                    }
                } catch (error) {
                    console.error(`Error getting reference ${type}:${id}:`, error);
                    // Continue with other references
                }
            }

            this.handlers.sendToClient(ws, {
                type: 'get_references_by_ids_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    data: {
                        references: results
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Get references by IDs error:', error);
            this.handlers.sendError(ws, 'Failed to get references by IDs', error.message, message.requestId);
        }
    }

    // Helper method to get vibe image data by ID
    async getVibeImageData(vibeId) {
        try {
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            
            // Get vibe from database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                return null;
            }

            // Get workspace ownership
            const workspaces = refDb.getVibeWorkspaces(vibeId);
            const workspaceId = workspaces[0] || 'default';

            // Format for client (extract encoding metadata only)
            const encodingsMetadata = [];
            if (vibe.encodings && typeof vibe.encodings === 'object') {
                for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                    if (modelEncodings && typeof modelEncodings === 'object') {
                        for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                            // Skip if encoding is empty/null/undefined
                            if (!encoding || (typeof encoding === 'string' && encoding.trim() === '')) {
                                continue;
                            }
                            // Parse IE value and skip if invalid
                            const ieValue = parseFloat(extractionValue);
                            if (isNaN(ieValue)) {
                                continue;
                            }
                            encodingsMetadata.push({
                                model,
                                informationExtraction: ieValue
                            });
                        }
                    }
                }
            }

            // Preview existence - assume true if previewHash exists (previews are always generated)
            const hasPreview = !!vibe.previewHash;

            return {
                filename: `${vibeId}.json`,
                id: vibe.id,
                preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                mtime: vibe.mtime,
                size: 0,
                encodings: encodingsMetadata,
                type: vibe.type === 'base64' ? 'base64' : 'cache',
                source: vibe.imageSource,
                workspaceId: workspaceId,
                comment: vibe.comment || null,
                importedFrom: vibe.importedFrom === 1 ? 'novelai' : null,
                locked: vibe.locked,
                metadata: vibe.metadata || null
            };

        } catch (error) {
            console.error(`Error getting vibe image data for ${vibeId}:`, error);
            return null;
        }
    }

    // Helper method to get cache image data by hash
    async getCacheImageData(cacheHash) {
        try {
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            
            // Get file cache from database with metadata included
            const fileCache = refDb.getFileCache(cacheHash);
            if (!fileCache) {
                // File not in cache - don't access filesystem unless we're actually using the file
                // Log this so sync process can be updated to handle missing cache files
                console.warn(`⚠️ Cache file not found in database: ${cacheHash} (should be added during sync)`);
                return null;
            }

            // Get workspace ownership from database
            const workspaces = refDb.getReferenceWorkspaces(cacheHash);
            const workspaceId = workspaces[0] || 'default';

            return {
                hash: cacheHash,
                filename: cacheHash,
                mtime: fileCache.cachedAt * 1000, // Convert seconds to milliseconds for client
                size: fileCache.size,
                hasPreview: true, // Cache files always have previews
                workspaceId: workspaceId,
                metadata: fileCache.metadata || null
            };
        } catch (error) {
            console.error(`Error getting cache image data for ${cacheHash}:`, error);
            return null;
        }
    }


    async getFileImageData(filename) {
        try {
            const filePath = path.join(this.globalResources.getPath('images'), filename);
            if (!fs.existsSync(filePath)) {
                return null;
            }
            const stats = fs.statSync(filePath);
            return {
                filename,
                mtime: stats.mtimeMs,
                size: stats.size,
                workspaceId: 'default'
            };
        } catch (error) {
            console.error(`Error getting file image data for ${filename}:`, error);
            return null;
        }
    }

    async handleGetWorkspaceReferences(ws, message, clientInfo, wsServer) {
        try {
            const workspaceId = message.workspaceId;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            let cacheFiles = [];
            let vibeImageDetails = [];

            if (workspaceId === 'all') {
                // Get references from all workspaces
                const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
                const allWorkspaceIds = Object.keys(workspaces);

                // Optimized: Get both cache files and vibes with data in a single call (parallel queries)
                const { cacheFiles: cacheFilesMap, vibes: vibesMap } = refDb.getWorkspaceReferencesAndVibesWithData(allWorkspaceIds);

                // Build cache files array
                for (const hash in cacheFilesMap) {
                    const fileData = cacheFilesMap[hash];
                    const primaryWorkspaceId = fileData.workspaces[0] || 'default';

                    cacheFiles.push({
                        hash: hash,
                        filename: hash,
                        mtime: fileData.cachedAt * 1000, // Convert seconds to milliseconds
                        size: fileData.size,
                        hasPreview: true, // Cache files always have previews
                        workspaceId: primaryWorkspaceId,
                        workspaces: fileData.workspaces,
                        metadata: fileData.metadata || null
                    });
                }

                // Format vibe images
                for (const vibeId in vibesMap) {
                    const vibe = vibesMap[vibeId];
                    const primaryWorkspaceId = vibe.workspaces[0] || 'default';

                    // Extract encoding metadata
                    const encodingsMetadata = [];
                    if (vibe.encodings && typeof vibe.encodings === 'object') {
                        for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                            if (modelEncodings && typeof modelEncodings === 'object') {
                                for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                                    // Skip if encoding is empty/null/undefined
                                    if (!encoding || (typeof encoding === 'string' && encoding.trim() === '')) {
                                        continue;
                                    }
                                    // Parse IE value and skip if invalid
                                    const ieValue = parseFloat(extractionValue);
                                    if (isNaN(ieValue)) {
                                        continue;
                                    }
                                    encodingsMetadata.push({
                                        model,
                                        informationExtraction: ieValue
                                    });
                                }
                            }
                        }
                    }

                    // Preview existence - assume true if previewHash exists (previews are always generated)
                    const hasPreview = !!vibe.previewHash;

                    // Convert importedFrom: 1 = 'novelai', anything else = null
                    // Handle both number and string types for robustness
                    const importedFromValue = parseInt(vibe.importedFrom) || 0;
                    const importedFromString = importedFromValue === 1 ? 'novelai' : null;
                    
                    // Ensure locked is always a boolean
                    const isLocked = !!vibe.locked;
                    
                    // For base64 vibes, only include image property if there's no preview (fallback for client)
                    // source already contains the base64 data, so image is only needed as fallback
                    const isBase64 = vibe.type === 'base64';
                    const base64Image = (isBase64 && !hasPreview && vibe.imageSource) ? vibe.imageSource : null;

                    vibeImageDetails.push({
                        filename: `${vibeId}.json`,
                        id: vibe.id,
                        preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                        mtime: vibe.mtime,
                        createdAt: vibe.createdAt || vibe.mtime, // Client expects createdAt as alternative to mtime
                        size: 0,
                        encodings: encodingsMetadata,
                        type: isBase64 ? 'base64' : 'cache',
                        source: vibe.imageSource, // For base64 vibes, this contains the base64 data
                        ...(base64Image && { image: base64Image }), // Only include if no preview (fallback)
                        workspaceId: primaryWorkspaceId,
                        comment: vibe.comment || null,
                        importedFrom: importedFromString,
                        locked: isLocked,
                        metadata: vibe.metadata || null
                    });
                }

            } else {
                // Optimized: Get both cache files and vibes with data in a single call (parallel queries)
                const { cacheFiles: cacheFilesMap, vibes: vibesMap } = refDb.getWorkspaceReferencesAndVibesWithData(workspaceId);

                for (const hash in cacheFilesMap) {
                    const fileData = cacheFilesMap[hash];

                    cacheFiles.push({
                        hash: hash,
                        filename: hash,
                        mtime: fileData.cachedAt * 1000, // Convert seconds to milliseconds for client
                        size: fileData.size,
                        hasPreview: true, // Cache files always have previews
                        workspaceId: workspaceId,
                        metadata: fileData.metadata || null
                    });
                }

                for (const vibeId in vibesMap) {
                    const vibe = vibesMap[vibeId];

                    // Extract encoding metadata
                    const encodingsMetadata = [];
                    if (vibe.encodings && typeof vibe.encodings === 'object') {
                        for (const [model, modelEncodings] of Object.entries(vibe.encodings)) {
                            if (modelEncodings && typeof modelEncodings === 'object') {
                                for (const [extractionValue, encoding] of Object.entries(modelEncodings)) {
                                    // Skip if encoding is empty/null/undefined
                                    if (!encoding || (typeof encoding === 'string' && encoding.trim() === '')) {
                                        continue;
                                    }
                                    // Parse IE value and skip if invalid
                                    const ieValue = parseFloat(extractionValue);
                                    if (isNaN(ieValue)) {
                                        continue;
                                    }
                                    encodingsMetadata.push({
                                        model,
                                        informationExtraction: ieValue
                                    });
                                }
                            }
                        }
                    }

                    // Preview existence - assume true if previewHash exists (previews are always generated)
                    const hasPreview = !!vibe.previewHash;

                    // Convert importedFrom: 1 = 'novelai', anything else = null
                    // Handle both number and string types for robustness
                    const importedFromValue = parseInt(vibe.importedFrom) || 0;
                    const importedFromString = importedFromValue === 1 ? 'novelai' : null;
                    
                    // Ensure locked is always a boolean
                    const isLocked = !!vibe.locked;
                    
                    // For base64 vibes, only include image property if there's no preview (fallback for client)
                    // source already contains the base64 data, so image is only needed as fallback
                    const isBase64 = vibe.type === 'base64';
                    const base64Image = (isBase64 && !hasPreview && vibe.imageSource) ? vibe.imageSource : null;

                    vibeImageDetails.push({
                        filename: `${vibeId}.json`,
                        id: vibe.id,
                        preview: hasPreview ? `${vibe.previewHash}.webp` : null,
                        mtime: vibe.mtime,
                        createdAt: vibe.createdAt || vibe.mtime, // Client expects createdAt as alternative to mtime
                        size: 0,
                        encodings: encodingsMetadata,
                        type: isBase64 ? 'base64' : 'cache',
                        source: vibe.imageSource, // For base64 vibes, this contains the base64 data
                        ...(base64Image && { image: base64Image }), // Only include if no preview (fallback)
                        workspaceId: workspaceId,
                        comment: vibe.comment || null,
                        importedFrom: importedFromString,
                        locked: isLocked,
                        metadata: vibe.metadata || null
                    });
                }
            }

            // Sort by newest first
            cacheFiles.sort((a, b) => b.mtime - a.mtime);
            vibeImageDetails.sort((a, b) => b.mtime - a.mtime);

            this.handlers.sendToClient(ws, {
                type: 'get_workspace_references_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    data: {
                        cacheFiles: cacheFiles,
                        vibeImages: vibeImageDetails
                    }
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Get workspace references error:', error);
            this.handlers.sendError(ws, 'Failed to get workspace references', error.message, message.requestId);
        }
    }

    async handleDeleteReference(ws, message, clientInfo, wsServer) {
        try {
            const { hash, workspaceId } = message;
            const filePath = path.join(this.globalResources.getPath("uploadCache"), hash);
            const previewPath = path.join(this.globalResources.getPath("previewCache"), `${hash}.webp`);

            // Check if file exists
            if (!fs.existsSync(filePath)) {
                this.handlers.sendError(ws, 'Reference not found', 'Cache file not found', message.requestId);
                return;
            }

            // Before deleting, check if any vibes use this cache image and convert them to base64
            await this.convertVibesToBase64(hash, workspaceId);

            // Delete main file
            fs.unlinkSync(filePath);

            // Delete preview if it exists
            if (fs.existsSync(previewPath)) {
                fs.unlinkSync(previewPath);
            }

            // Delete reference metadata (database handles workspace ownership via foreign keys)
            this.globalResources.getReferenceMetadataDatabase().deleteMetadata(hash);

            // Clear cache for affected vibes (they may have been converted)
            this.clearVibeCache();

            this.handlers.sendToClient(ws, {
                type: 'delete_reference_response',
                requestId: message.requestId,
                data: { success: true, message: 'Reference deleted successfully' },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Delete reference error:', error);
            this.handlers.sendError(ws, 'Failed to delete reference', error.message, message.requestId);
        }
    }

    // Helper method to clear vibe metadata cache
    clearVibeCache() {
        this.vibeMetadataCache.clear();
        console.log('Vibe metadata cache cleared');
    }

    // Helper function to convert vibes from cache reference to base64
    async convertVibesToBase64(cacheHash, workspaceId) {
        try {
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            
            // Optimized: Query all vibes with this image_source directly (uses index)
            // This is much faster than iterating through all workspaces
            const vibeIds = refDb.getVibesByImageSource(cacheHash);
            
            if (vibeIds.length === 0) {
                return; // No vibes to convert
            }

            const vibeMetadataMap = refDb.getVibeMetadataForVibes(vibeIds);
            const convertedVibes = [];

            for (const vibeId of vibeIds) {
                const vibe = vibeMetadataMap[vibeId];
                if (!vibe) continue;

                // Vibe uses the cache image we're about to delete (double-check)
                if (vibe.type === 'cache' && vibe.imageSource === cacheHash) {
                    console.log(`🔄 Converting vibe ${vibeId} from cache reference to base64`);

                    // Read the cache image and convert to base64
                    const cachePath = path.join(this.globalResources.getPath("uploadCache"), cacheHash);
                    if (fs.existsSync(cachePath)) {
                        const imageBuffer = fs.readFileSync(cachePath);
                        const imageBase64 = imageBuffer.toString('base64');

                        // Update in database
                        refDb.setVibeMetadata(vibeId, {
                            type: 'base64',
                            imageSource: imageBase64,
                            previewHash: vibe.previewHash,
                            comment: vibe.comment,
                            importedFrom: vibe.importedFrom,
                            encodings: vibe.encodings
                        });

                        convertedVibes.push(vibeId);
                        console.log(`✅ Converted vibe ${vibeId} to base64 format`);
                    } else {
                        console.warn(`Cache file ${cacheHash} not found for vibe conversion`);
                    }
                }
            }

            if (convertedVibes.length > 0) {
                console.log(`🔄 Converted ${convertedVibes.length} vibes to base64 format before deleting cache image ${cacheHash}`);
            }

        } catch (error) {
            console.error('Error converting vibes to base64:', error);
            // Don't throw error - we still want to delete the reference even if conversion fails
        }
    }

    async handleUploadReference(ws, message, clientInfo, wsServer) {
        try {
            const { imageData, workspaceId, tempFile, tags = [] } = message;

            // Validate workspace parameter
            if (!workspaceId) {
                this.handlers.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.handlers.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            let imageBuffer, hash;

            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.handlers.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }

                imageBuffer = fs.readFileSync(tempFilePath);
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');

                console.log(`📥 Using downloaded temp file: ${tempFile} -> ${hash}`);
            } else if (imageData) {
                // Handle base64 image data
                imageBuffer = Buffer.from(imageData, 'base64');
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
            } else {
                this.handlers.sendError(ws, 'Missing image data', 'Either imageData or tempFile must be provided', message.requestId);
                return;
            }

            // Save file
            const filePath = path.join(this.globalResources.getPath("uploadCache"), hash);
            fs.writeFileSync(filePath, imageBuffer);

            // Handle preview - generate single cache preview for references
            const previewPath = path.join(this.globalResources.getPath("previewCache"), `${hash}.webp`);
            const hasPreview = fs.existsSync(previewPath);
            if (!hasPreview) {
                await sharp(imageBuffer)
                    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(previewPath);
                console.log(`📸 Generated cache preview: ${hash}.webp`);
            }

            // Update database with file cache (use size we already have)
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            refDb.setFileCache(hash, {
                size: imageBuffer.length
            });

            // Add to workspace in database
            refDb.addReferenceToWorkspace(hash, workspaceId);

            // Add tags to reference metadata if provided
            if (tags && tags.length > 0) {
                const existingMetadata = refDb.getMetadata(hash) || {};
                const updatedMetadata = {
                    ...existingMetadata,
                    tags: tags
                };
                refDb.setMetadata(hash, updatedMetadata);
            }

            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${hash}.webp`);

                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }

                    // Delete the temp preview
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${hash}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }

            // Clear cache since new reference was added
            this.clearVibeCache();

            this.handlers.sendToClient(ws, {
                type: 'upload_reference_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Reference uploaded successfully',
                    hash: hash
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Upload reference error:', error);
            this.handlers.sendError(ws, 'Failed to upload reference', error.message, message.requestId);
        }
    }

    async handleUploadWallpaper(ws, message, clientInfo, wsServer) {
        try {
            const { imageData, workspaceId } = message;

            // Validate workspace parameter
            if (!workspaceId) {
                this.handlers.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.handlers.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            // Validate image data
            if (!imageData) {
                this.handlers.sendError(ws, 'Missing image data', 'Image data is required', message.requestId);
                return;
            }

            // Convert base64 to buffer
            let imageBuffer;
            try {
                imageBuffer = Buffer.from(imageData, 'base64');
            } catch (error) {
                this.handlers.sendError(ws, 'Invalid image data', 'Failed to decode base64 image data', message.requestId);
                return;
            }

            // Ensure wallpapers directory exists
            const wallpapersDir = path.join(this.globalResources.getPath("cache"), 'wallpapers');
            if (!fs.existsSync(wallpapersDir)) {
                fs.mkdirSync(wallpapersDir, { recursive: true });
            }

            // Convert image to PNG, resize to max 4K (3840x2160) if larger, and save
            const wallpaperPath = path.join(wallpapersDir, `${workspaceId}.png`);
            try {
                // Get image metadata to check dimensions
                const image = sharp(imageBuffer);
                const metadata = await image.metadata();
                const { width, height } = metadata;
                
                // 4K resolution: 3840x2160
                const maxWidth = 3840;
                const maxHeight = 2160;
                
                // Only resize if image is larger than 4K (no downscale if smaller)
                let processedImage = image.png();
                
                if (width > maxWidth || height > maxHeight) {
                    // Resize to fit within 4K while maintaining aspect ratio (no crop, no upscale)
                    // fit: 'inside' automatically maintains aspect ratio and fits within bounds
                    processedImage = processedImage.resize(maxWidth, maxHeight, {
                        fit: 'inside', // Fit inside dimensions, maintain aspect ratio automatically
                        withoutEnlargement: true // Don't upscale if smaller
                    });
                    console.log(`🖼️ Resized wallpaper from ${width}x${height} to fit within 4K (maintaining aspect ratio)`);
                }
                
                await processedImage.toFile(wallpaperPath);
                console.log(`🖼️ Saved custom wallpaper for workspace '${workspaceId}'`);
            } catch (error) {
                // If sharp fails, try writing the buffer directly (might already be PNG)
                console.error('Sharp processing failed, attempting direct write:', error);
                fs.writeFileSync(wallpaperPath, imageBuffer);
                console.log(`🖼️ Saved custom wallpaper for workspace '${workspaceId}' (direct write)`);
            }

            this.handlers.sendToClient(ws, {
                type: 'upload_wallpaper_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Wallpaper uploaded successfully',
                    workspaceId: workspaceId
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Upload wallpaper error:', error);
            this.handlers.sendError(ws, 'Failed to upload wallpaper', error.message, message.requestId);
        }
    }

    async handleReplaceReference(ws, message, clientInfo, wsServer) {
        try {
            const { hash, imageData, workspaceId, tempFile, filename } = message;

            // Validate required parameters
            if (!hash) {
                this.handlers.sendError(ws, 'Missing hash parameter', 'Reference hash is required', message.requestId);
                return;
            }

            if (!workspaceId) {
                this.handlers.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.handlers.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            // Check if the reference exists
            const cacheFiles = this.globalResources.getReferenceMetadataDatabase().getWorkspaceReferences(workspaceId);
            if (!cacheFiles.includes(hash)) {
                this.handlers.sendError(ws, 'Reference not found', `Reference with hash '${hash}' not found in workspace`, message.requestId);
                return;
            }

            let imageBuffer;

            if (filename) {
                // Handle filename - read from images directory
                const imageFilePath = path.join(this.globalResources.getPath("images"), filename);
                if (!fs.existsSync(imageFilePath)) {
                    this.handlers.sendError(ws, 'Image file not found', `Image file '${filename}' not found in images directory`, message.requestId);
                    return;
                }

                imageBuffer = fs.readFileSync(imageFilePath);
            } else if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.handlers.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }

                imageBuffer = fs.readFileSync(tempFilePath);

                // Clean up temp file
                try {
                    fs.unlinkSync(tempFilePath);
                    console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp file: ${cleanupError.message}`);
                }
            } else if (imageData) {
                // Handle base64 image data
                imageBuffer = Buffer.from(imageData, 'base64');
            } else {
                this.handlers.sendError(ws, 'Missing image data', 'Either filename, imageData or tempFile must be provided', message.requestId);
                return;
            }

            // Calculate new hash for the replacement image
            const newHash = crypto.createHash('md5').update(imageBuffer).digest('hex');

            // If the new image is different from the existing one
            if (newHash !== hash) {
                const refDb = this.globalResources.getReferenceMetadataDatabase();

                // Save the new file
                const newFilePath = path.join(this.globalResources.getPath("uploadCache"), newHash);
                fs.writeFileSync(newFilePath, imageBuffer);

                // Generate new preview
                const newPreviewPath = path.join(this.globalResources.getPath("previewCache"), `${newHash}.webp`);
                await sharp(imageBuffer)
                    .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                    .webp({ quality: 80 })
                    .toFile(newPreviewPath);
                console.log(`📸 Generated new preview: ${newHash}.webp`);

                // Update database: remove old, add new
                refDb.removeReferenceFromWorkspace(hash, workspaceId);
                refDb.addReferenceToWorkspace(newHash, workspaceId);

                // Update file cache for new hash (previews always generated)
                const stats = fs.statSync(newFilePath);
                refDb.setFileCache(newHash, {
                    size: stats.size,
                    mtime: stats.mtime.valueOf()
                });

                // Migrate metadata from old hash to new hash if it exists
                const oldMetadata = refDb.getMetadata(hash);
                if (oldMetadata) {
                    refDb.setMetadata(newHash, oldMetadata);
                    refDb.deleteMetadata(hash);
                }

                // Database updated above - no need to update workspace.json

                // Clean up old files
                try {
                    const oldFilePath = path.join(this.globalResources.getPath("uploadCache"), hash);
                    const oldPreviewPath = path.join(this.globalResources.getPath("previewCache"), `${hash}.webp`);

                    if (fs.existsSync(oldFilePath)) {
                        fs.unlinkSync(oldFilePath);
                        console.log(`🗑️ Removed old reference file: ${hash}`);
                    }

                    if (fs.existsSync(oldPreviewPath)) {
                        fs.unlinkSync(oldPreviewPath);
                        console.log(`🗑️ Removed old reference preview: ${hash}.webp`);
                    }

                    // Delete old file cache
                    refDb.deleteFileCache(hash);
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up old files: ${cleanupError.message}`);
                }

                console.log(`🔄 Replaced reference ${hash} with ${newHash}`);
            } else {
                // Same hash - file content is identical, no changes needed
                console.log(`ℹ️ Reference ${hash} is identical to replacement, no changes made`);
            }

            // Clear cache since reference was replaced
            this.clearVibeCache();

            this.handlers.sendToClient(ws, {
                type: 'replace_reference_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Reference replaced successfully',
                    oldHash: hash,
                    newHash: newHash
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Replace reference error:', error);
            this.handlers.sendError(ws, 'Failed to replace reference', error.message, message.requestId);
        }
    }

    resolveAbsoluteNaxUrl(url) {
        if (!url || typeof url !== 'string') return null;
        const trimmed = url.trim();
        if (!trimmed) return null;
        if (trimmed.startsWith('http://') || trimmed.startsWith('https://')) return trimmed;
        if (trimmed.startsWith('//')) return `https:${trimmed}`;
        if (trimmed.startsWith('/')) return `https://nax.moe${trimmed}`;
        return null;
    }

    async fetchRemotePreviewDataUrl(url) {
        const resolved = this.resolveAbsoluteNaxUrl(url);
        if (!resolved) return null;
        try {
            const previewResp = await fetch(resolved, {
                method: 'GET',
                signal: AbortSignal.timeout(20000),
                headers: {
                    'User-Agent': 'StaticForge/1.0',
                    Referer: 'https://nax.moe/',
                    Accept: 'image/*,*/*'
                }
            });
            if (!previewResp.ok) {
                console.warn(`fetchRemotePreviewDataUrl: HTTP ${previewResp.status} for ${resolved}`);
                return null;
            }
            const previewBuf = Buffer.from(await previewResp.arrayBuffer());
            if (!previewBuf.length) return null;
            const ct = (previewResp.headers.get('content-type') || 'image/jpeg').split(';')[0].trim();
            return `data:${ct};base64,${previewBuf.toString('base64')}`;
        } catch (e) {
            console.warn('fetchRemotePreviewDataUrl:', e.message);
            return null;
        }
    }

    parseVibeThumbnailToBuffer(thumbnail) {
        if (!thumbnail || typeof thumbnail !== 'string') return null;
        if (thumbnail.startsWith('data:image/')) {
            const base64 = thumbnail.split(',')[1];
            if (!base64) return null;
            return Buffer.from(base64, 'base64');
        }
        if (thumbnail.startsWith('/9j/') || thumbnail.startsWith('iVBORw0KGgo')) {
            return Buffer.from(thumbnail, 'base64');
        }
        return null;
    }

    async saveVibeThumbnailPreview(thumbnail, overwrite = false) {
        const thumbnailBuffer = this.parseVibeThumbnailToBuffer(thumbnail);
        if (!thumbnailBuffer || !thumbnailBuffer.length) return null;
        const thumbnailHash = crypto.createHash('md5').update(thumbnailBuffer).digest('hex');
        const thumbnailPath = path.join(this.globalResources.getPath('previewCache'), `${thumbnailHash}.webp`);
        if (!overwrite && fs.existsSync(thumbnailPath)) {
            return thumbnailHash;
        }
        await sharp(thumbnailBuffer)
            .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
            .webp({ quality: 80 })
            .toFile(thumbnailPath);
        return thumbnailHash;
    }

    injectVibeJsonPreviewThumbnail(jsonData, dataUrl, force = false) {
        if (!dataUrl || !jsonData) return;
        const vibes = jsonData.vibes && Array.isArray(jsonData.vibes) ? jsonData.vibes : [jsonData];
        vibes.forEach((vibe) => {
            if (force || !vibe.thumbnail || !String(vibe.thumbnail).startsWith('data:image')) {
                vibe.thumbnail = dataUrl;
            }
        });
    }

    injectVibeJsonSourceImage(jsonData, dataUrl, force = false) {
        if (!dataUrl || !jsonData) return;
        const rawBase64 = dataUrl.includes(',') ? dataUrl.split(',')[1] : dataUrl;
        if (!rawBase64) return;
        const vibes = jsonData.vibes && Array.isArray(jsonData.vibes) ? jsonData.vibes : [jsonData];
        vibes.forEach((vibe) => {
            if (force || !vibe.image || String(vibe.image).trim() === '') {
                vibe.image = rawBase64;
                vibe.type = 'base64';
            }
        });
    }

    buildNaxVibeBrowserMeta(vibe, encoding) {
        const lines = ['Imported from NAX.moe community gallery.'];
        if (vibe && vibe.id) lines.push(`NAX vibe ID: ${vibe.id}`);
        if (vibe && vibe.nsfw) lines.push('Content: NSFW');
        if (vibe && (vibe.upvotes != null || vibe.downvotes != null)) {
            lines.push(`Votes: ↑${vibe.upvotes || 0} ↓${vibe.downvotes || 0}`);
        }
        if (encoding) {
            const modelLabel = encoding.forgeKey || encoding.model || '';
            const ie = encoding.infoExtracted != null ? encoding.infoExtracted : '';
            lines.push(`Imported encoding: ${modelLabel} · IE ${ie}`);
        }
        return {
            displayName: (vibe && vibe.name) ? String(vibe.name).trim() : `Vibe ${vibe && vibe.id ? vibe.id : ''}`,
            description: lines.join('\n'),
            forceLocked: true
        };
    }

    downloadUrlToBuffer(url, timeoutMs = 45000) {
        return new Promise((resolve, reject) => {
            const req = https.request(url, {
                method: 'GET',
                headers: { 'User-Agent': 'StaticForge/1.0' }
            }, (res) => {
                if (res.statusCode !== 200) {
                    reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                    return;
                }
                const chunks = [];
                res.on('data', (chunk) => chunks.push(chunk));
                res.on('end', () => {
                    resolve({
                        buffer: Buffer.concat(chunks),
                        headers: res.headers
                    });
                });
            });
            req.on('error', reject);
            req.setTimeout(timeoutMs, () => req.destroy());
            req.end();
        });
    }

    /** Download NAX (or other) vibe JSON from URL, inject preview, import — naxVibesApplet.js */
    async handleImportVibeFromUrl(ws, message, clientInfo, wsServer) {
        try {
            const { downloadUrl, previewUrl, workspaceId, comment, naxBrowserMeta } = message;
            if (!downloadUrl || typeof downloadUrl !== 'string') {
                this.handlers.sendError(ws, 'Invalid URL', 'downloadUrl is required', message.requestId);
                return;
            }

            const maxSize = 100 * 1024 * 1024;
            const { buffer } = await this.downloadUrlToBuffer(downloadUrl);
            if (buffer.length > maxSize) {
                throw new Error(`File too large: ${(buffer.length / 1024 / 1024).toFixed(2)}MB`);
            }

            let bundleData;
            try {
                bundleData = JSON.parse(buffer.toString('utf8'));
            } catch (parseError) {
                this.handlers.sendError(ws, 'Invalid vibe file', 'Downloaded file is not valid JSON', message.requestId);
                return;
            }

            const detectionResult = this.detectAndParseVibeFile(bundleData);
            if (!detectionResult.isValid) {
                this.handlers.sendError(ws, 'Invalid vibe file', detectionResult.error, message.requestId);
                return;
            }

            const processedJsonData = JSON.parse(JSON.stringify(bundleData));
            let resolvedNaxMeta = naxBrowserMeta && typeof naxBrowserMeta === 'object' ? naxBrowserMeta : null;
            if (!resolvedNaxMeta && String(downloadUrl).includes('nax.moe')) {
                const firstVibe = detectionResult.vibes && detectionResult.vibes[0];
                if (firstVibe) {
                    resolvedNaxMeta = this.buildNaxVibeBrowserMeta(firstVibe, null);
                }
            }
            let previewDataUrl = null;
            if (previewUrl) {
                previewDataUrl = await this.fetchRemotePreviewDataUrl(previewUrl);
                if (previewDataUrl) {
                    this.injectVibeJsonPreviewThumbnail(processedJsonData, previewDataUrl, true);
                    this.injectVibeJsonSourceImage(processedJsonData, previewDataUrl, true);
                } else {
                    console.warn('import_vibe_from_url: could not fetch previewUrl', previewUrl);
                }
            }

            await this.handleImportVibeBundle(ws, {
                bundleData: processedJsonData,
                workspaceId,
                comment: comment || '',
                requestId: message.requestId,
                previewUrl,
                forcePreviewOverride: !!previewDataUrl,
                naxBrowserMeta: resolvedNaxMeta
            }, clientInfo, wsServer);
        } catch (error) {
            console.error('import_vibe_from_url:', error);
            this.handlers.sendError(ws, 'Failed to import vibe from URL', error.message, message.requestId);
        }
    }

    async handleDownloadUrlFile(ws, message, clientInfo, wsServer) {
        try {
            const { url, previewUrl } = message;

            // Validate URL
            if (!url || typeof url !== 'string') {
                this.handlers.sendError(ws, 'Invalid URL', 'URL parameter is required and must be a string', message.requestId);
                return;
            }

            try {
                // Create temp download directory if it doesn't exist
                const tempDownloadDir = path.join(this.globalResources.getPath("cache"), 'tempDownload');
                if (!fs.existsSync(tempDownloadDir)) {
                    fs.mkdirSync(tempDownloadDir, { recursive: true });
                }

                // Download the file
                const response = await new Promise((resolve, reject) => {
                    const req = https.request(url, { method: 'GET' }, (res) => {
                        if (res.statusCode !== 200) {
                            reject(new Error(`HTTP ${res.statusCode}: ${res.statusMessage}`));
                            return;
                        }

                        const chunks = [];
                        res.on('data', chunk => chunks.push(chunk));
                        res.on('end', () => {
                            const buffer = Buffer.concat(chunks);
                            resolve({
                                buffer,
                                headers: res.headers,
                                statusCode: res.statusCode
                            });
                        });
                    });

                    req.on('error', reject);
                    req.setTimeout(30000, () => req.destroy()); // 30 second timeout
                    req.end();
                });

                // Validate file size (max 100MB)
                const maxSize = 100 * 1024 * 1024; // 100MB
                if (response.buffer.length > maxSize) {
                    throw new Error(`File too large: ${(response.buffer.length / 1024 / 1024).toFixed(2)}MB. Maximum size is 100MB.`);
                }

                // Generate unique filename
                const timestamp = Date.now();
                const randomSeed = Math.floor(Math.random() * 1000000000);
                const tempFilename = `temp_${timestamp}_${randomSeed}`;
                const tempFilePath = path.join(tempDownloadDir, tempFilename);

                // Determine file type and handle accordingly
                const contentType = response.headers['content-type'] || '';
                // Clean content type by removing parameters (like charset=utf-8)
                const cleanContentType = contentType.split(';')[0].trim();
                let fileInfo = {};

                if (cleanContentType.startsWith('image/')) {
                    // Handle image files
                    const extension = contentType.includes('jpeg') ? '.jpg' :
                        contentType.includes('png') ? '.png' :
                            contentType.includes('webp') ? '.webp' : '.jpg';

                    // Generate hash for the file
                    const hash = crypto.createHash('md5').update(response.buffer).digest('hex');

                    // Extract original filename from URL or use hash
                    let originalFilename = '';
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        const urlFilename = path.basename(pathname);

                        // Clean the filename (remove query params, invalid chars, etc.)
                        if (urlFilename && urlFilename.includes('.') && urlFilename.length > 1) {
                            // Remove query parameters and hash fragments
                            const cleanFilename = urlFilename.split('?')[0].split('#')[0];
                            // Remove invalid characters but keep dots and dashes
                            originalFilename = cleanFilename.replace(/[<>:"/\\|?*]/g, '_');
                        }
                    } catch (urlError) {
                        console.log(`⚠️ Could not parse URL for filename: ${urlError.message}`);
                    }

                    // Store file as hash.dat in tempDownloadDir
                    const finalTempFilename = `${hash}.dat`;
                    const finalTempFilePath = path.join(tempDownloadDir, finalTempFilename);
                    fs.writeFileSync(finalTempFilePath, response.buffer);

                    // Generate and save preview in tempDownloadDir
                    const previewPath = path.join(tempDownloadDir, `${hash}.webp`);
                    await sharp(response.buffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);

                    // Extract metadata for potential blueprints
                    let metadata = null;
                    let isBlueprint = false;

                    if (cleanContentType === 'image/png') {
                        try {
                            // Extract comprehensive metadata in the format the client expects
                            const extractedMetadata = await this.globalResources.getPngMetadata().extractMetadataSummary(response.buffer, originalFilename || finalTempFilename);

                            if (extractedMetadata.success && extractedMetadata.isBlueprint) {
                                isBlueprint = true;
                                metadata = extractedMetadata;
                            }
                        } catch (metadataError) {
                            console.log(`⚠️ Could not extract metadata from PNG: ${metadataError.message}`);
                        }
                    }

                    fileInfo = {
                        type: 'image',
                        tempFilename: finalTempFilename,
                        originalFilename: originalFilename,
                        hash: hash,
                        size: response.buffer.length,
                        contentType: contentType,
                        url: url,
                        hasPreview: true,
                        isBlueprint: isBlueprint,
                        metadata: metadata
                    };

                    console.log(`📥 Downloaded image from URL: ${url} -> ${finalTempFilename} (${hash})${isBlueprint ? ' (NovelAI Generated)' : ''}`);

                } else if (cleanContentType === 'application/json' ||
                    cleanContentType === 'application/octet-stream' ||
                    url.includes('.naiv4vibe') ||
                    url.includes('.naiv4vibebundle') ||
                    url.includes('vibe') ||
                    url.endsWith('.json') ||
                    url.toLowerCase().includes('novelai')) {
                    // Handle JSON files (vibe bundles)
                    console.log(`📄 Processing as JSON/vibe file - Content-Type: ${cleanContentType}, URL: ${url}`);

                    // Generate hash for the file
                    const hash = crypto.createHash('md5').update(response.buffer).digest('hex');

                    // Extract original filename from URL or use hash
                    let originalFilename = '';
                    try {
                        const urlObj = new URL(url);
                        const pathname = urlObj.pathname;
                        const urlFilename = path.basename(pathname);

                        // Clean the filename (remove query params, invalid chars, etc.)
                        if (urlFilename && urlFilename.includes('.') && urlFilename.length > 1) {
                            // Remove query parameters and hash fragments
                            const cleanFilename = urlFilename.split('?')[0].split('#')[0];
                            // Remove invalid characters but keep dots and dashes
                            originalFilename = cleanFilename.replace(/[<>:"/\\|*]/g, '_');
                        }
                    } catch (urlError) {
                        console.log(`⚠️ Could not parse URL for filename: ${urlError.message}`);
                    }

                    // Store file as hash.dat in tempDownloadDir
                    const finalTempFilename = `${hash}.dat`;
                    const finalTempFilePath = path.join(tempDownloadDir, finalTempFilename);
                    fs.writeFileSync(finalTempFilePath, response.buffer);

                    // Parse JSON to extract metadata
                    let jsonData;
                    try {
                        jsonData = JSON.parse(response.buffer.toString());
                    } catch (parseError) {
                        throw new Error('Invalid JSON file');
                    }

                    // Use unified vibe detection system
                    const detectionResult = this.detectAndParseVibeFile(jsonData);
                    if (detectionResult.isValid) {
                        const vibes = detectionResult.vibes;
                        const vibeCount = vibes.length;

                        // Process raw JSON data for client - convert encodings and images to booleans
                        const processedJsonData = JSON.parse(JSON.stringify(jsonData));

                        // Process each vibe in the raw data
                        const vibesArray = processedJsonData.vibes || [processedJsonData];
                        vibesArray.forEach(vibe => {
                            if (vibe.encodings) {
                                // Convert encodings to boolean indicators
                                Object.keys(vibe.encodings).forEach(model => {
                                    Object.keys(vibe.encodings[model]).forEach(ie => {
                                        // Keep the encoding data as-is, just ensure it's properly structured
                                        if (vibe.encodings[model][ie] && typeof vibe.encodings[model][ie] === 'object') {
                                            // Ensure encoding string exists
                                            if (!vibe.encodings[model][ie].encoding) {
                                                vibe.encodings[model][ie].encoding = '';
                                            }
                                        }
                                    });
                                });
                            }

                            // Convert image to boolean (keep base64 data)
                            if (vibe.image && typeof vibe.image === 'string') {
                                // Keep the image data as-is for client processing
                            }

                            // Keep thumbnail as base64 for client display
                            if (vibe.thumbnail && typeof vibe.thumbnail === 'string') {
                                // Keep thumbnail data as-is
                            }
                        });

                        if (previewUrl) {
                            const previewDataUrl = await this.fetchRemotePreviewDataUrl(previewUrl);
                            if (previewDataUrl) {
                                this.injectVibeJsonPreviewThumbnail(processedJsonData, previewDataUrl);
                            }
                        }

                        fileInfo = {
                            type: detectionResult.type === 'bundle' ? 'vibe_bundle' : 'vibe_single',
                            tempFilename: finalTempFilename,
                            originalFilename: originalFilename,
                            hash: hash,
                            size: response.buffer.length,
                            contentType: contentType,
                            url: url,
                            vibeCount: vibeCount,
                            jsonData: processedJsonData, // Raw JSON data for client processing
                            isBundle: detectionResult.type === 'bundle'
                        };

                        console.log(`📥 Downloaded ${detectionResult.type} vibe file from URL: ${url} -> ${finalTempFilename} (${vibeCount} vibe(s))`);
                    } else {
                        // Generic JSON file
                        fileInfo = {
                            type: 'json',
                            tempFilename: finalTempFilename,
                            size: response.buffer.length,
                            contentType: contentType,
                            url: url
                        };

                        console.log(`📥 Downloaded JSON file from URL: ${url} -> ${finalTempFilename}`);
                    }

                } else {
                    // Unsupported file type
                    console.log(`❌ Unsupported file type: ${contentType} for URL: ${url}`);
                    throw new Error(`Unsupported file type: ${contentType}. Only image files, JSON files, and vibe bundles are allowed.`);
                }

                console.log('📤 Sending download response with fileInfo:', JSON.stringify(fileInfo, null, 2));

                this.handlers.sendToClient(ws, {
                    type: 'download_url_file_response',
                    requestId: message.requestId,
                    data: {
                        success: true,
                        message: 'File downloaded successfully',
                        ...fileInfo
                    },
                    timestamp: new Date().toISOString()
                });

            } catch (downloadError) {
                console.error('URL download error:', downloadError);
                this.handlers.sendError(ws, 'Failed to download file from URL', downloadError.message, message.requestId);
            }

        } catch (error) {
            console.error('Download URL file error:', error);
            this.handlers.sendError(ws, 'Failed to process download request', error.message, message.requestId);
        }
    }

    // Universal fetch handler for any HTTP request with configurable response handling
    async handleFetchUrl(ws, message, clientInfo, wsServer) {
        try {
            const { url, options = {}, responseType = 'json' } = message;

            // Validate URL
            if (!url || typeof url !== 'string') {
                this.handlers.sendError(ws, 'Invalid URL', 'URL parameter is required and must be a string', message.requestId);
                return;
            }

            // Set default options
            const fetchOptions = {
                method: 'GET',
                signal: AbortSignal.timeout(30000), // 30 second default timeout
                ...options
            };

            // Override timeout if specified in options
            if (options.timeout) {
                fetchOptions.signal = AbortSignal.timeout(options.timeout);
            }

            try {
                // Make the fetch request
                const response = await fetch(url, fetchOptions);

                if (!response.ok) {
                    throw new Error(`HTTP ${response.status}: ${response.statusText}`);
                }

                // Handle different response types
                let responseData = null;
                let additionalInfo = {};

                switch (responseType) {
                    case 'save_file':
                        // Save file to specified destination
                        const { destination, filename } = options;
                        if (!destination || !filename) {
                            throw new Error('save_file response type requires destination and filename options');
                        }

                        const buffer = await response.arrayBuffer();
                        const filePath = path.join(destination, filename);

                        // Ensure destination directory exists
                        const destDir = path.dirname(filePath);
                        if (!fs.existsSync(destDir)) {
                            fs.mkdirSync(destDir, { recursive: true });
                        }

                        fs.writeFileSync(filePath, Buffer.from(buffer));

                        responseData = {
                            success: true,
                            savedPath: filePath,
                            size: buffer.byteLength,
                            contentType: response.headers.get('content-type') || 'Unknown'
                        };
                        break;

                    case 'base64':
                        // Return base64 encoded binary data
                        const arrayBuffer = await response.arrayBuffer();
                        const base64Data = Buffer.from(arrayBuffer).toString('base64');

                        responseData = {
                            success: true,
                            data: base64Data,
                            size: arrayBuffer.byteLength,
                            contentType: response.headers.get('content-type') || 'Unknown'
                        };
                        break;

                    case 'arraybuffer':
                        // Return array buffer data with optional byte limiting
                        let finalArrayBuffer;
                        if (options.maxBytes && options.maxBytes > 0) {
                            // Limit the number of bytes read by using a ReadableStream reader
                            // This allows us to stop accepting data after maxBytes and cancel the request
                            const reader = response.body.getReader();
                            const chunks = [];
                            let totalBytes = 0;

                            try {
                                while (totalBytes < options.maxBytes) {
                                    const { done, value } = await reader.read();
                                    if (done) break;

                                    chunks.push(value);
                                    totalBytes += value.length;

                                    if (totalBytes >= options.maxBytes) {
                                        // Truncate the last chunk if needed
                                        const remainingBytes = options.maxBytes - (totalBytes - value.length);
                                        if (remainingBytes < value.length) {
                                            chunks[chunks.length - 1] = value.slice(0, remainingBytes);
                                            totalBytes = options.maxBytes;
                                        }
                                        break;
                                    }
                                }

                                // Cancel the reader to stop further data transfer
                                await reader.cancel();

                                // Combine chunks into a single array buffer
                                const totalLength = Math.min(totalBytes, options.maxBytes);
                                finalArrayBuffer = new ArrayBuffer(totalLength);
                                const uint8Array = new Uint8Array(finalArrayBuffer);

                                let offset = 0;
                                for (const chunk of chunks) {
                                    uint8Array.set(chunk, offset);
                                    offset += chunk.length;
                                }

                            } catch (readError) {
                                console.warn('Error reading response body with byte limit:', readError);
                                // Fall back to full response if byte limiting fails
                                finalArrayBuffer = await response.arrayBuffer();
                            }
                        } else {
                            // No byte limit, read the full response
                            finalArrayBuffer = await response.arrayBuffer();
                        }

                        // Handle gzip encoding - if content is gzipped, we need to decompress it
                        // Note: For byte-limited requests, we're getting raw compressed data
                        // This is actually fine for magic byte detection since we're looking at the first bytes
                        // But we should log this for debugging
                        const contentEncoding = response.headers.get('content-encoding');
                        if (contentEncoding === 'gzip') {
                            console.log('⚠️ Response is gzip encoded - magic bytes may not work correctly');
                        }

                        responseData = {
                            success: true,
                            data: Buffer.from(finalArrayBuffer).toString('base64'),
                            size: finalArrayBuffer.byteLength,
                            contentType: response.headers.get('content-type') || 'Unknown'
                        };
                        break;

                    case 'text':
                        // Return plain text
                        const textData = await response.text();

                        responseData = {
                            success: true,
                            data: textData,
                            size: textData.length,
                            contentType: response.headers.get('content-type') || 'text/plain'
                        };
                        break;

                    case 'json':
                    default:
                        // Return JSON data
                        try {
                            const jsonData = await response.json();
                            responseData = {
                                success: true,
                                data: jsonData,
                                contentType: response.headers.get('content-type') || 'application/json'
                            };
                        } catch (jsonError) {
                            // If JSON parsing fails, fall back to text
                            const fallbackText = await response.text();
                            responseData = {
                                success: true,
                                data: fallbackText,
                                contentType: response.headers.get('content-type') || 'text/plain',
                                note: 'JSON parsing failed, returned as text'
                            };
                        }
                        break;
                }

                // Add common response information
                additionalInfo = {
                    status: response.status,
                    statusText: response.statusText,
                    headers: Object.fromEntries(response.headers.entries()),
                    url: response.url,
                    timestamp: new Date().toISOString()
                };

                // Send success response
                this.handlers.sendToClient(ws, {
                    type: 'fetch_url_info_response',
                    requestId: message.requestId,
                    data: {
                        ...responseData,
                        ...additionalInfo
                    },
                    timestamp: new Date().toISOString()
                });

            } catch (fetchError) {
                console.error('URL fetch error:', fetchError);

                // Send error response with fallback information
                let fallbackInfo = {};

                try {
                    const urlObj = new URL(url);
                    fallbackInfo = {
                        domain: urlObj.hostname,
                        protocol: urlObj.protocol,
                        pathname: urlObj.pathname,
                        filename: path.basename(urlObj.pathname) || 'Unknown'
                    };
                } catch (urlError) {
                    fallbackInfo = {
                        domain: 'Unknown',
                        protocol: 'Unknown',
                        pathname: 'Unknown',
                        filename: 'Unknown'
                    };
                }

                this.handlers.sendToClient(ws, {
                    type: 'fetch_url_info_response',
                    requestId: message.requestId,
                    data: {
                        success: false,
                        error: fetchError.message,
                        errorType: fetchError.name,
                        ...fallbackInfo
                    },
                    timestamp: new Date().toISOString()
                });
            }

        } catch (error) {
            console.error('Fetch URL info error:', error);
            this.handlers.sendError(ws, 'Failed to process fetch request', error.message, message.requestId);
        }
    }

    async handleMoveReferences(ws, message, clientInfo, wsServer) {
        try {
            const { hashes, targetWorkspaceId, sourceWorkspaceId } = message;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Move each hash from source to target workspace in database
            for (const hash of hashes) {
                refDb.removeReferenceFromWorkspace(hash, sourceWorkspaceId);
                refDb.addReferenceToWorkspace(hash, targetWorkspaceId);
            }

            // Database updated above - no need to update workspace.json

            this.handlers.sendToClient(ws, {
                type: 'move_references_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `${hashes.length} reference(s) moved successfully`,
                    movedCount: hashes.length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Move references error:', error);
            this.handlers.sendError(ws, 'Failed to move references', error.message, message.requestId);
        }
    }

    async handleGetVibeImage(ws, message, clientInfo, wsServer) {
        try {
            // Extract vibe ID from filename (remove .json extension)
            const vibeId = message.filename.replace('.json', '');
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Get vibe from database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.handlers.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Format for client (full vibe data with encodings)
            const vibeData = {
                version: 1,
                id: vibe.id,
                type: vibe.type,
                image: vibe.imageSource,
                preview: vibe.previewHash,
                mtime: Math.floor(vibe.createdAt),
                encodings: vibe.encodings,
                comment: vibe.comment || null,
                importedFrom: vibe.importedFrom === 1 ? 'novelai' : null,
                locked: vibe.locked
            };

            this.handlers.sendToClient(ws, {
                type: 'get_vibe_image_response',
                requestId: message.requestId,
                data: vibeData,
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Get vibe image error:', error);
            this.handlers.sendError(ws, 'Failed to get vibe image', error.message, message.requestId);
        }
    }

    async handleDeleteVibeImage(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, workspaceId } = message;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Check if vibe exists in database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.handlers.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Remove from workspace in database
            refDb.removeVibeFromWorkspace(vibeId, workspaceId);

            // Delete vibe metadata from database
            refDb.deleteVibeMetadata(vibeId);

            this.handlers.sendToClient(ws, {
                type: 'delete_vibe_image_response',
                requestId: message.requestId,
                data: { success: true, message: 'Vibe image deleted successfully' },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Delete vibe image error:', error);
            this.handlers.sendError(ws, 'Failed to delete vibe image', error.message, message.requestId);
        }
    }

    async handleDeleteVibeEncodings(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, encodings, workspaceId } = message;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Get vibe from database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.handlers.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Delete specified encodings from database (using separate table)
            for (const enc of encodings) {
                refDb.deleteVibeEncoding(vibeId, enc.model, enc.informationExtraction);
            }

            this.handlers.sendToClient(ws, {
                type: 'delete_vibe_encodings_response',
                requestId: message.requestId,
                data: { success: true, message: 'Vibe encodings deleted successfully' },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Delete vibe encodings error:', error);
            this.handlers.sendError(ws, 'Failed to delete vibe encodings', error.message, message.requestId);
        }
    }

    async handleBulkDeleteVibeImages(ws, message, clientInfo, wsServer) {
        try {
            const { vibesToDelete, encodingsToDelete, workspaceId } = message;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            const deletedVibes = [];
            const deletedEncodings = [];

            // Delete entire vibes
            for (const vibeId of vibesToDelete) {
                const vibe = refDb.getVibeMetadata(vibeId);
                if (!vibe) {
                    console.warn(`Vibe ${vibeId} not found in database, skipping`);
                    continue;
                }

                // Remove from workspace in database
                refDb.removeVibeFromWorkspace(vibeId, workspaceId);

                // Delete vibe metadata from database
                refDb.deleteVibeMetadata(vibeId);

                deletedVibes.push(vibeId);
            }

            // Delete specific encodings from database (using separate table)
            for (const encodingData of encodingsToDelete) {
                const deleted = refDb.deleteVibeEncoding(encodingData.vibeId, encodingData.model, encodingData.informationExtraction);
                if (deleted) {
                    deletedEncodings.push(encodingData);
                }
            }

            this.handlers.sendToClient(ws, {
                type: 'bulk_delete_vibe_images_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Bulk delete completed successfully',
                    deletedVibes: deletedVibes.length,
                    deletedEncodings: deletedEncodings.length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Bulk delete vibe images error:', error);
            this.handlers.sendError(ws, 'Failed to bulk delete vibe images', error.message, message.requestId);
        }
    }

    async handleMoveVibeImage(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, targetWorkspaceId, sourceWorkspaceId } = message;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            // Check if vibe exists in database
            const vibe = refDb.getVibeMetadata(vibeId);
            if (!vibe) {
                this.handlers.sendError(ws, 'Vibe image not found', 'Vibe image not found in database', message.requestId);
                return;
            }

            // Move in database
            refDb.removeVibeFromWorkspace(vibeId, sourceWorkspaceId);
            refDb.addVibeToWorkspace(vibeId, targetWorkspaceId);

            // Database updated above - no need to update workspace.json

            this.handlers.sendToClient(ws, {
                type: 'move_vibe_image_response',
                requestId: message.requestId,
                data: { success: true, message: 'Vibe image moved successfully' },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Move vibe image error:', error);
            this.handlers.sendError(ws, 'Failed to move vibe image', error.message, message.requestId);
        }
    }

    async handleBulkMoveVibeImages(ws, message, clientInfo, wsServer) {
        try {
            const { imageIds, targetWorkspaceId, sourceWorkspaceId } = message;
            const refDb = this.globalResources.getReferenceMetadataDatabase();

            const movedImages = [];

            // Move each vibe image in database
            for (const vibeId of imageIds) {
                // Check if vibe exists
                const vibe = refDb.getVibeMetadata(vibeId);
                if (!vibe) {
                    console.warn(`Vibe ${vibeId} not found in database, skipping`);
                    continue;
                }

                // Move in database
                refDb.removeVibeFromWorkspace(vibeId, sourceWorkspaceId);
                refDb.addVibeToWorkspace(vibeId, targetWorkspaceId);
                movedImages.push(vibeId);

                // Database updated above - no need to update workspace.json
            }

            this.handlers.sendToClient(ws, {
                type: 'bulk_move_vibe_images_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `${movedImages.length} vibe image(s) moved successfully`,
                    movedCount: movedImages.length
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Bulk move vibe images error:', error);
            this.handlers.sendError(ws, 'Failed to bulk move vibe images', error.message, message.requestId);
        }
    }

    async handleEncodeVibe(ws, message, clientInfo, wsServer) {
        try {
            const { image, informationExtraction, model, workspace, cacheFile, tempFile, id, comment } = message;

            // Determine which workspace to use
            let targetWorkspace = workspace;
            if (!targetWorkspace) {
                // No specific workspace provided, use the active workspace for this session
                targetWorkspace = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[targetWorkspace]) {
                this.handlers.sendError(ws, 'Invalid workspace', `Workspace '${targetWorkspace}' not found`, message.requestId);
                return;
            }

            let vibeData;

            if (image) {
                // Create new vibe from uploaded image
                const imageBuffer = Buffer.from(image, 'base64');
                const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

                vibeData = {
                    version: 1,
                    id: sha256Hash,
                    type: 'base64',
                    image: image,
                    preview: imageHash,
                    mtime: Date.now(),
                    encodings: {},
                    comment: comment || null
                };

                // Generate preview for base64 image
                const previewPath = path.join(this.globalResources.getPath("previewCache"), `${imageHash}.webp`);
                if (!fs.existsSync(previewPath)) {
                    await sharp(imageBuffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);
                    console.log(`📸 Generated preview for vibe image: ${imageHash}.webp`);
                } else {
                    console.log(`📸 Preview already exists for vibe image: ${imageHash}.webp`);
                }

                // Generate encoding
                const encoding = await this.encodeVibeDirect(image, informationExtraction, model);
                if (!vibeData.encodings[model]) {
                    vibeData.encodings[model] = {};
                }
                vibeData.encodings[model][informationExtraction] = encoding;

                // Save to database
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                refDb.setVibeMetadata(sha256Hash, {
                    type: 'base64',
                    imageSource: image,
                    previewHash: imageHash,
                    comment: comment || null,
                    importedFrom: 0,
                    encodings: vibeData.encodings
                });

                // Add to workspace in database
                refDb.addVibeToWorkspace(sha256Hash, targetWorkspace);

                this.clearVibeCache();

            } else if (cacheFile) {
                // Create vibe from cache file
                const cachePath = path.join(this.globalResources.getPath("uploadCache"), cacheFile);
                const imageBuffer = fs.readFileSync(cachePath);
                const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

                vibeData = {
                    version: 1,
                    id: sha256Hash,
                    type: 'cache',
                    image: cacheFile,
                    preview: imageHash,
                    mtime: Date.now(),
                    encodings: {},
                    comment: comment || null
                };

                // Generate preview for cache file (if not already exists)
                const previewPath = path.join(this.globalResources.getPath("previewCache"), `${imageHash}.webp`);
                if (!fs.existsSync(previewPath)) {
                    await sharp(imageBuffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);
                    console.log(`📸 Generated preview for vibe image: ${imageHash}.webp`);
                }

                // Generate encoding from cache file
                const imageBase64 = imageBuffer.toString('base64');
                const encoding = await this.encodeVibeDirect(imageBase64, informationExtraction, model);
                if (!vibeData.encodings[model]) {
                    vibeData.encodings[model] = {};
                }
                vibeData.encodings[model][informationExtraction] = encoding;

                // Save to database
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                refDb.setVibeMetadata(sha256Hash, {
                    type: 'cache',
                    imageSource: cacheFile,
                    previewHash: imageHash,
                    comment: comment || null,
                    importedFrom: 0,
                    encodings: vibeData.encodings
                });

                // Add to workspace in database
                refDb.addVibeToWorkspace(sha256Hash, targetWorkspace);
                
                // Also ensure the cache file itself is in the database and workspace
                // (since it's both a reference image and a vibe)
                // Always ensure it's in the database (setFileCache uses INSERT OR REPLACE)
                refDb.setFileCache(cacheFile, {
                    size: imageBuffer.length  // Use imageBuffer we already have, no file access needed
                });
                
                // Always ensure cache file is in the workspace (addReferenceToWorkspace uses INSERT OR IGNORE)
                refDb.addReferenceToWorkspace(cacheFile, targetWorkspace);
                
                this.clearVibeCache();
            } else if (tempFile) {
                // Create vibe from temp downloaded file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.handlers.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }

                const imageBuffer = fs.readFileSync(tempFilePath);
                const imageBase64 = imageBuffer.toString('base64');
                const imageHash = crypto.createHash('md5').update(imageBuffer).digest('hex');
                const sha256Hash = crypto.createHash('sha256').update(imageBuffer).digest('hex');

                vibeData = {
                    version: 1,
                    id: sha256Hash,
                    type: 'base64',
                    image: imageBase64,
                    preview: imageHash,
                    mtime: Date.now(),
                    encodings: {},
                    comment: comment || null
                };

                // Handle preview - use existing temp preview if available, otherwise generate new one
                const previewPath = path.join(this.globalResources.getPath("previewCache"), `${imageHash}.webp`);
                const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${imageHash}.webp`);
                if (fs.existsSync(tempPreviewPath)) {
                    // Move temp preview to permanent preview cache
                    fs.copyFileSync(tempPreviewPath, previewPath);
                    console.log(`📸 Moved temp preview to permanent storage: ${imageHash}.webp`);
                } else if (!fs.existsSync(previewPath)) {
                    // Generate new preview if neither temp nor permanent preview exists
                    await sharp(imageBuffer)
                        .resize({ width: 512, height: 512, fit: 'inside', withoutEnlargement: true })
                        .webp({ quality: 80 })
                        .toFile(previewPath);
                    console.log(`📸 Generated new preview for temp vibe image: ${imageHash}.webp`);
                } else {
                    console.log(`📸 Preview already exists for vibe image: ${imageHash}.webp`);
                }

                // Generate encoding from temp file
                const encoding = await this.encodeVibeDirect(imageBase64, informationExtraction, model);
                if (!vibeData.encodings[model]) {
                    vibeData.encodings[model] = {};
                }
                vibeData.encodings[model][informationExtraction] = encoding;

                // Save to database
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                refDb.setVibeMetadata(sha256Hash, {
                    type: 'base64',
                    imageSource: imageBase64,
                    previewHash: imageHash,
                    comment: comment || null,
                    importedFrom: 0,
                    encodings: vibeData.encodings
                });

                // Add to workspace in database
                refDb.addVibeToWorkspace(sha256Hash, targetWorkspace);

                // Clear vibe cache to ensure updated metadata is loaded
                this.clearVibeCache();
            } else if (id) {
                // Add new encoding to existing vibe
                const refDb = this.globalResources.getReferenceMetadataDatabase();
                
                // Get existing vibe from database
                const existingVibe = refDb.getVibeMetadata(id);
                if (!existingVibe) {
                    this.handlers.sendError(ws, 'Vibe not found', 'Vibe not found in database', message.requestId);
                    return;
                }

                // Validate vibe for encoding
                try {
                    // Convert database format to format expected by validator
                    const vibeForValidation = {
                        image: existingVibe.imageSource,
                        type: existingVibe.type,
                        locked: existingVibe.locked
                    };
                    this.validateVibeForEncoding(vibeForValidation, id);
                } catch (validationError) {
                    this.handlers.sendError(ws, 'Vibe validation failed', validationError.message, message.requestId);
                    return;
                }

                // Generate new encoding
                let imageBase64;
                if (existingVibe.type === 'base64') {
                    imageBase64 = existingVibe.imageSource;
                } else if (existingVibe.type === 'cache') {
                    const cachePath = path.join(this.globalResources.getPath("uploadCache"), existingVibe.imageSource);
                    if (!fs.existsSync(cachePath)) {
                        this.handlers.sendError(ws, 'Cache file not found', `Cache file ${existingVibe.imageSource} not found`, message.requestId);
                        return;
                    }
                    const imageBuffer = fs.readFileSync(cachePath);
                    imageBase64 = imageBuffer.toString('base64');
                } else {
                    this.handlers.sendError(ws, 'Invalid vibe type', 'Vibe type must be base64 or cache', message.requestId);
                    return;
                }

                const encoding = await this.encodeVibeDirect(imageBase64, informationExtraction, model);
                
                // Add/update encoding in database (using separate table)
                const extraMetadata = comment !== undefined ? { comment: comment } : null;
                refDb.setVibeEncoding(id, model, informationExtraction, encoding, extraMetadata);

                // Clear vibe cache to ensure updated metadata is loaded
                this.clearVibeCache();
            }

            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${tempFile.replace('.dat', '')}.webp`);

                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }

                    // Delete the temp preview if it exists
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${tempFile.replace('.dat', '')}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }

            this.handlers.sendToClient(ws, {
                type: 'encode_vibe_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Vibe encoding completed successfully',
                    vibeData: vibeData
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Encode vibe error:', error);
            this.handlers.sendError(ws, 'Failed to encode vibe', error.message, message.requestId);
        }
    }

    async handleCheckVibeEncoding(ws, message, clientInfo, wsServer) {
        try {
            const { vibeId, workspaceId } = message;

            if (!workspaceId) {
                this.handlers.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            if (!vibeId) {
                this.handlers.sendError(ws, 'Missing vibe ID', 'Vibe ID is required', message.requestId);
                return;
            }

            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.handlers.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            // Get vibe from database
            const refDb = this.globalResources.getReferenceMetadataDatabase();
            const vibe = refDb.getVibeMetadata(vibeId);
            
            if (!vibe) {
                this.handlers.sendError(ws, 'Vibe not found', 'Vibe not found in database', message.requestId);
                return;
            }
            
            // Check if vibe belongs to this workspace
            const vibeWorkspaces = refDb.getVibeWorkspaces(vibeId);
            if (!vibeWorkspaces.includes(workspaceId)) {
                this.handlers.sendError(ws, 'Vibe not found', 'Vibe not found in workspace', message.requestId);
                return;
            }
            
            // Convert database vibe to format expected by canEncodeVibe
            const vibeData = {
                id: vibe.id,
                type: vibe.type,
                image: vibe.imageSource,
                preview: vibe.previewHash,
                encodings: vibe.encodings || {},
                comment: vibe.comment || null
            };

            // Check if vibe can be encoded
            const encodingStatus = this.canEncodeVibe(vibeData, vibeId);

            this.handlers.sendToClient(ws, {
                type: 'check_vibe_encoding_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    vibeId: vibeId,
                    canEncode: encodingStatus.canEncode,
                    reason: encodingStatus.reason,
                    isLocked: this.shouldLockVibe(vibeData)
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Check vibe encoding error:', error);
            this.handlers.sendError(ws, 'Failed to check vibe encoding', error.message, message.requestId);
        }
    }

    // Helper function to determine if a vibe should be locked
    // Works with both database format (imageSource) and JSON format (image)
    shouldLockVibe(vibe) {
        // Lock if missing original image (check both imageSource and image for compatibility)
        const hasImage = vibe.imageSource || vibe.image;
        if (!hasImage) {
            return true;
        }

        // Lock if explicitly set to locked (for JSON compatibility)
        if (vibe.locked === true) {
            return true;
        }

        // Lock if imported from external source without original image
        const importedFrom = vibe.importedFrom;
        if (importedFrom && importedFrom !== 0 && !hasImage) {
            return true;
        }

        return false;
    }

    // Helper function to validate vibe for encoding
    validateVibeForEncoding(vibe, vibeId) {
        // Check if vibe is locked
        if (this.shouldLockVibe(vibe)) {
            throw new Error(`Cannot encode locked vibe: ${vibeId}`);
        }

        // Check if vibe has valid source image
        if (!vibe.image) {
            throw new Error(`Cannot encode vibe without source image: ${vibeId}`);
        }

        // Check if vibe has valid image data
        if (vibe.type === 'base64' && (!vibe.image || vibe.image.trim() === '')) {
            throw new Error(`Cannot encode vibe with invalid base64 image: ${vibeId}`);
        }

        if (vibe.type === 'cache') {
            const cachePath = path.join(this.globalResources.getPath("uploadCache"), vibe.image);
            if (!fs.existsSync(cachePath)) {
                throw new Error(`Cannot encode vibe with missing cache file: ${vibeId}`);
            }
        }

        return true;
    }

    // Helper function to check if a vibe can be encoded (returns object with status and reason)
    canEncodeVibe(vibe, vibeId) {
        try {
            this.validateVibeForEncoding(vibe, vibeId);
            return { canEncode: true, reason: null };
        } catch (error) {
            return { canEncode: false, reason: error.message };
        }
    }

    // Direct NovelAI vibe encoding function
    async encodeVibeDirect(imageBase64, informationExtracted, model) {
        const body = {
            image: imageBase64,
            model: (this.globalResources.getNekoAiService('Model'))[model.toUpperCase()],
            information_extracted: informationExtracted || 1
        };

        if (!body.model) {
            throw new Error('Invalid model');
        }

        const novelAiKey = this.globalResources.getApiKeyManager().getActiveApiKey('novelai');
        if (!novelAiKey) {
            throw new Error('NovelAI API key is not configured.');
        }

        return new Promise((resolve, reject) => {
            const postData = JSON.stringify(body);
            const options = {
                hostname: 'image.novelai.net',
                port: 443,
                path: '/ai/encode-vibe',
                method: 'POST',
                headers: {
                    "accept": "*/*",
                    "accept-language": "en-US,en;q=0.9,en-GB;q=0.8",
                    "authorization": `Bearer ${novelAiKey}`,
                    "content-type": "application/json",
                    "content-length": Buffer.byteLength(postData),
                    "priority": "u=1, i",
                    "dnt": "1",
                    "sec-ch-ua": "\"Not)A;Brand\";v=\"8\", \"Chromium\";v=\"138\", \"Microsoft Edge\";v=\"138\"",
                    "sec-ch-ua-mobile": "?0",
                    "sec-ch-ua-platform": "\"macOS\"",
                    "sec-fetch-dest": "empty",
                    "sec-fetch-mode": "cors",
                    "sec-fetch-site": "same-site",
                    "x-correlation-id": crypto.randomBytes(3).toString('hex').toUpperCase(),
                    "x-initiated-at": new Date().toISOString(),
                    "referer": "https://novelai.net/",
                    "origin": "https://novelai.net",
                    "sec-gpc": "1",
                    "user-agent": "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/138.0.0.0 Safari/537.36 Edg/138.0.0.0"
                }
            };

            const req = https.request(options, (res) => {
                let data = [];

                res.on('data', chunk => data.push(chunk));
                res.on('end', async () => {
                    // Get new balance and calculate credit usage
                    const vibeCreditUsage = await this.globalResources.calculateCreditUsage();
                    if (vibeCreditUsage.totalUsage > 0) {
                        console.log(`💰 Vibe encoding credits used: ${vibeCreditUsage.totalUsage} ${vibeCreditUsage.usageType === 'paid' ? 'paid' : 'fixed'}`);
                    }
                    // Add unattributed receipt for vibe encoding
                    if (vibeCreditUsage.totalUsage > 0) {
                        await this.globalResources.getMetadataDatabase().addUnattributedReceipt({
                            type: 'vibe_encoding',
                            cost: vibeCreditUsage.totalUsage,
                            creditType: vibeCreditUsage.usageType,
                            date: Date.now().valueOf()
                        });
                    }

                    const buffer = Buffer.concat(data);
                    if (res.statusCode === 200) {
                        resolve(buffer.toString('base64'));
                    } else {
                        try {
                            const errorResponse = JSON.parse(buffer.toString());
                            reject(new Error(`Error encoding vibe: ${errorResponse.statusCode || res.statusCode} ${errorResponse.message || 'Unknown error'}`));
                        } catch (e) {
                            reject(new Error(`Error encoding vibe: HTTP ${res.statusCode}`));
                        }
                    }
                });
            });

            req.on('error', (error) => {
                reject(new Error(`Request error: ${error.message}`));
            });

            req.write(postData);
            req.end();
        });
    }


    // Unified vibe detection and parsing function
    detectAndParseVibeFile(data) {
        const result = {
            isValid: false,
            type: null, // 'bundle' or 'single'
            vibes: [],
            error: null
        };

        try {
            // Validate basic structure
            if (!data || typeof data !== 'object') {
                result.error = 'Invalid data format: expected object';
                return result;
            }

            // Check for required identifier
            if (!data.identifier) {
                result.error = 'Missing identifier: not a valid NovelAI vibe file';
                return result;
            }

            // Handle different vibe file types
            if (data.identifier === 'novelai-vibe-transfer-bundle') {
                // Bundle format - contains multiple vibes
                if (!data.vibes || !Array.isArray(data.vibes)) {
                    result.error = 'Invalid bundle format: missing or invalid vibes array';
                    return result;
                }

                if (data.vibes.length === 0) {
                    result.error = 'Empty bundle: no vibes found';
                    return result;
                }

                // Validate each vibe in the bundle
                const validVibes = [];
                for (const vibe of data.vibes) {
                    if (this.validateVibeStructure(vibe)) {
                        validVibes.push(vibe);
                    } else {
                        console.warn(`Skipping invalid vibe in bundle: ${vibe.name || vibe.id || 'unnamed'}`);
                    }
                }

                if (validVibes.length === 0) {
                    result.error = 'Bundle contains no valid vibes';
                    return result;
                }

                result.isValid = true;
                result.type = 'bundle';
                result.vibes = validVibes;

            } else if (data.identifier === 'novelai-vibe-transfer') {
                // Single vibe format
                if (!this.validateVibeStructure(data)) {
                    result.error = 'Invalid single vibe format';
                    return result;
                }

                result.isValid = true;
                result.type = 'single';
                result.vibes = [data];

            } else {
                result.error = `Unsupported identifier: ${data.identifier}`;
                return result;
            }

            return result;

        } catch (error) {
            result.error = `Parse error: ${error.message}`;
            return result;
        }
    }

    // Helper function to validate individual vibe structure
    validateVibeStructure(vibe) {
        if (!vibe || typeof vibe !== 'object') {
            return false;
        }

        // Check for required fields
        if (!vibe.identifier || vibe.identifier !== 'novelai-vibe-transfer') {
            return false;
        }

        // At minimum, a vibe should have encodings or be a valid structure
        if (!vibe.encodings && !vibe.id && !vibe.name) {
            return false;
        }

        return true;
    }

    async handleImportVibeBundle(ws, message, clientInfo, wsServer) {
        try {
            const { bundleData, workspaceId, comment, tempFile, previewUrl, forcePreviewOverride, naxBrowserMeta } = message;

            // Determine which workspace to use
            let targetWorkspace = workspaceId;
            if (!targetWorkspace) {
                // No specific workspace provided, use the active workspace for this session
                targetWorkspace = this.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
            }
            if (!targetWorkspace) {
                this.handlers.sendError(ws, 'Invalid workspace', 'No workspace provided, and no active workspace found', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[targetWorkspace]) {
                this.handlers.sendError(ws, 'Invalid workspace', `Workspace '${targetWorkspace}' not found`, message.requestId);
                return;
            }

            let bundleDataToProcess = bundleData;

            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.handlers.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }

                try {
                    const fileContent = fs.readFileSync(tempFilePath, 'utf8');
                    bundleDataToProcess = JSON.parse(fileContent);
                    console.log(`📥 Using downloaded temp file: ${tempFile}`);
                } catch (parseError) {
                    this.handlers.sendError(ws, 'Invalid JSON file', 'Downloaded file is not valid JSON', message.requestId);
                    return;
                }
            }

            // Use unified detection system
            const detectionResult = this.detectAndParseVibeFile(bundleDataToProcess);
            if (!detectionResult.isValid) {
                this.handlers.sendError(ws, 'Invalid vibe file', detectionResult.error, message.requestId);
                return;
            }

            const vibes = detectionResult.vibes;
            console.log(`📦 Detected ${detectionResult.type} vibe file with ${vibes.length} vibe(s)`);

            const refDb = this.globalResources.getReferenceMetadataDatabase();

            let sharedPreviewDataUrl = null;
            if (previewUrl) {
                sharedPreviewDataUrl = await this.fetchRemotePreviewDataUrl(previewUrl);
                if (!sharedPreviewDataUrl) {
                    console.warn('import_vibe_bundle: previewUrl fetch failed:', previewUrl);
                }
            }
            const overwritePreviewFile = !!forcePreviewOverride || !!sharedPreviewDataUrl;

            // Process each vibe (validation already done in detectAndParseVibeFile)
            const importedVibes = [];
            const errors = [];
            for (const vibe of vibes) {
                try {

                    if (sharedPreviewDataUrl && (forcePreviewOverride || !vibe.thumbnail || !String(vibe.thumbnail).startsWith('data:image'))) {
                        vibe.thumbnail = sharedPreviewDataUrl;
                    }
                    if (sharedPreviewDataUrl) {
                        this.injectVibeJsonSourceImage(vibe, sharedPreviewDataUrl, !!forcePreviewOverride);
                    }

                    // Generate ID if it's 'unknown'
                    let vibeId = vibe.id;
                    if (vibeId === 'unknown') {
                        // Create a hash based on the vibe's content
                        const hashData = {
                            name: vibe.name || '',
                            encodings: vibe.encodings || {},
                            importInfo: vibe.importInfo || {},
                            createdAt: vibe.createdAt || Date.now()
                        };
                        const hashString = JSON.stringify(hashData);
                        vibeId = crypto.createHash('sha256').update(hashString).digest('hex');
                        console.log(`Generated SHA256 ID for unknown vibe: ${vibeId}`);
                    }

                    // Check if vibe already exists in database, if so generate new UUID
                    const existingVibe = refDb.getVibeMetadata(vibeId);
                    if (existingVibe) {
                        // Generate new UUID to avoid conflict
                        vibeId = crypto.randomUUID();
                        console.log(`Vibe already exists in database, generated new UUID for vibe: ${vibeId}`);
                    }

                    // Map model names
                    const modelMapping = {
                        'v4full': 'v4',
                        'v4-5full': 'v4_5',
                        'v4curated': 'v4_cur',
                        'v4-5curated': 'v4_5_cur'
                    };
                    // Process encodings for each model
                    const processedEncodings = {};

                    for (const [bundleModel, encodings] of Object.entries(vibe.encodings || {})) {
                        const mappedModel = modelMapping[bundleModel] || bundleModel;
                        if (!processedEncodings[mappedModel]) {
                            processedEncodings[mappedModel] = {};
                        }

                        for (const [encodingId, encodingData] of Object.entries(encodings)) {
                            if (encodingId !== 'unknown') {
                                const informationExtraction = encodingData.params?.information_extracted || 1;
                                if (encodingData.encoding && encodingData.encoding.trim() !== '') {
                                    processedEncodings[mappedModel][informationExtraction] = encodingData.encoding;
                                    console.log(`Normal encoding: IE=${informationExtraction}, encoding length=${encodingData.encoding?.length || 0}`);
                                } else {
                                    console.warn(`Warning: Empty encoding found for ${mappedModel} with IE=${informationExtraction}`);
                                }
                            } else {
                                // For 'unknown' encodingId, use importInfo.information_extracted if params.information_extracted is not valid
                                let ie = 1;
                                if (encodingData.params && encodingData.params.information_extracted && typeof encodingData.params.information_extracted === 'number' && encodingData.params.information_extracted > 0) {
                                    ie = encodingData.params.information_extracted;
                                } else if (vibe.importInfo && vibe.importInfo.information_extracted) {
                                    ie = vibe.importInfo.information_extracted;
                                }
                                if (encodingData.encoding && encodingData.encoding.trim() !== '') {
                                    processedEncodings[mappedModel][ie] = encodingData.encoding;
                                    console.log(`Unknown encoding: IE=${ie}, encoding length=${encodingData.encoding?.length || 0}`);
                                } else {
                                    console.warn(`Warning: Empty encoding found for ${mappedModel} with IE=${ie}`);
                                }
                            }
                        }
                    }

                    // Create vibe data structure
                    const vibeData = {
                        version: vibe.version || 1,
                        id: vibeId,
                        type: 'base64',
                        image: vibe.image || null, // Keep original image if present, null if missing
                        preview: vibe.thumbnail ? vibe.thumbnail.split(',')[1] : null,
                        mtime: vibe.createdAt || Date.now(),
                        encodings: processedEncodings,
                        importedFrom: 'novelai',
                        originalName: vibe.name || null,
                        comment: comment || null,
                        locked: false // Will be determined by server-side logic
                    };

                    // Determine locked status using server-side logic
                    vibeData.locked = this.shouldLockVibe(vibeData);
                    
                    let finalPreviewHash = null;
                    if (vibe.thumbnail) {
                        try {
                            finalPreviewHash = await this.saveVibeThumbnailPreview(
                                vibe.thumbnail,
                                overwritePreviewFile
                            );
                        } catch (thumbErr) {
                            console.warn(`import_vibe_bundle: thumbnail save failed for ${vibeId}:`, thumbErr.message);
                        }
                    }

                    const naxMeta = naxBrowserMeta && typeof naxBrowserMeta === 'object' ? naxBrowserMeta : null;
                    const imageSource = (vibe.image && String(vibe.image).trim())
                        ? String(vibe.image).trim()
                        : (vibe.thumbnail && vibe.thumbnail.startsWith('data:image/')
                            ? vibe.thumbnail.split(',')[1]
                            : '');
                    const vibeLocked = naxMeta && naxMeta.forceLocked ? true : this.shouldLockVibe(vibeData);
                    const refComment = naxMeta && naxMeta.description
                        ? naxMeta.description
                        : (comment || null);
                    const refDisplayName = naxMeta && naxMeta.displayName
                        ? naxMeta.displayName
                        : (vibe.name || null);
                    
                    refDb.setVibeMetadata(vibeId, {
                        type: 'base64',
                        imageSource: imageSource || null,
                        previewHash: finalPreviewHash,
                        comment: refComment,
                        displayName: refDisplayName,
                        replaceComment: !!naxMeta,
                        importedFrom: 1,
                        encodings: processedEncodings,
                        locked: vibeLocked ? 1 : 0
                    });

                    // Add to workspace in database
                    refDb.addVibeToWorkspace(vibeId, targetWorkspace);
                    importedVibes.push({
                        id: vibeId,
                        name: refDisplayName || vibe.name || 'Imported Vibe',
                        modelCount: Object.keys(processedEncodings).length,
                        locked: vibeLocked,
                        createdAt: vibe.createdAt || Date.now()
                    });
                    console.log(`✅ Imported vibe: ${refDisplayName || vibe.name || vibeId}${vibeLocked ? ' (locked)' : ''}`);
                } catch (error) {
                    console.error(`❌ Error importing vibe ${vibe.name || vibe.id}:`, error);
                    errors.push(`${vibe.name || vibe.id}: ${error.message}`);
                }
            }

            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${tempFile.replace('.dat', '')}.webp`);

                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }

                    // Delete the temp preview if it exists
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${tempFile.replace('.dat', '')}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }

            this.handlers.sendToClient(ws, {
                type: 'import_vibe_bundle_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: `Successfully imported ${importedVibes.length} vibes`,
                    importedVibes: importedVibes,
                    errors: errors
                },
                timestamp: new Date().toISOString()
            });
        } catch (error) {
            console.error('Import vibe bundle error:', error);
            this.handlers.sendError(ws, 'Failed to import vibe bundle', error.message, message.requestId);
        }
    }

    async handleUploadWorkspaceImage(ws, message, clientInfo, wsServer) {
        try {
            const { imageData, workspaceId, originalFilename, batchInfo, tempFile } = message;

            // Validate workspace parameter
            if (!workspaceId) {
                this.handlers.sendError(ws, 'Missing workspace parameter', 'Workspace parameter is required', message.requestId);
                return;
            }

            // Validate that the workspace exists
            const workspaces = this.globalResources.getWorkspaceManager().getWorkspaces();
            if (!workspaces[workspaceId]) {
                this.handlers.sendError(ws, 'Invalid workspace', `Workspace '${workspaceId}' not found`, message.requestId);
                return;
            }

            let imageBuffer, hash;

            if (tempFile) {
                // Handle downloaded temp file
                const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                if (!fs.existsSync(tempFilePath)) {
                    this.handlers.sendError(ws, 'Temp file not found', 'Downloaded temp file not found', message.requestId);
                    return;
                }

                imageBuffer = fs.readFileSync(tempFilePath);
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');

                console.log(`📥 Using downloaded temp file: ${tempFile} -> ${hash}`);
            } else if (imageData) {
                // Handle base64 image data
                imageBuffer = Buffer.from(imageData, 'base64');
                hash = crypto.createHash('md5').update(imageBuffer).digest('hex');
            } else {
                this.handlers.sendError(ws, 'Missing image data', 'Either imageData or tempFile must be provided', message.requestId);
                return;
            }

            // Generate filename - use original if provided, otherwise generate from hash
            let filename;
            if (originalFilename) {
                // Use original filename, but ensure it has proper extension
                const originalExt = path.extname(originalFilename).toLowerCase();
                if (originalExt === '.png') {
                    // Keep original filename with original case
                    filename = hash + '_' + originalFilename;
                } else {
                    // If original doesn't have valid extension, add one based on image format
                    const tempImg = sharp(imageBuffer);
                    const metadata = await tempImg.metadata();
                    const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format || 'png';
                    const baseName = path.basename(originalFilename, path.extname(originalFilename));
                    filename = `${hash}_${baseName}.${ext}`;
                }
            } else {
                // Generate filename from hash with proper extension
                const tempImg = sharp(imageBuffer);
                const metadata = await tempImg.metadata();
                const ext = metadata.format === 'jpeg' ? 'jpg' : metadata.format || 'png';
                filename = `${hash}.${ext}`;
            }

            // For downloaded files, we need to handle the .dat extension
            if (filename.toLowerCase().endsWith('.dat')) {
                // Convert .dat to .png for downloaded files
                filename = filename.replace(/\.dat$/i, '.png');
            }

            if (!filename.toLowerCase().endsWith('.png')) {
                throw new Error('Invalid image format: Only PNG files are allowed');
            }

            // Handle filename conflicts by appending a counter if needed
            let finalFilename = filename;
            let finalFilePath = path.join(this.globalResources.getPath("images"), finalFilename);
            let counter = 1;

            while (fs.existsSync(finalFilePath)) {
                const ext = path.extname(filename);
                const baseName = path.basename(filename, ext);
                finalFilename = `${baseName}_${counter}${ext}`;
                finalFilePath = path.join(this.globalResources.getPath("images"), finalFilename);
                counter++;
            }

            // Save file to images directory
            fs.writeFileSync(finalFilePath, imageBuffer);

            // Handle preview - use existing temp preview if available, otherwise generate new one
            const baseName = path.basename(finalFilename, path.extname(finalFilename));

            // Generate both main and @2x previews for mobile devices
            await generateMobilePreviews(finalFilePath, baseName);
            console.log(`📸 Generated previews: ${baseName}`);

            // Add to workspace files
            this.globalResources.getWorkspaceManager().addToWorkspaceArray('files', finalFilename, workspaceId);

            // Clean up temp download file if it was used
            if (tempFile) {
                try {
                    const tempFilePath = path.join(this.globalResources.getPath("cache"), 'tempDownload', tempFile);
                    const tempPreviewPath = path.join(this.globalResources.getPath("cache"), 'tempDownload', `${hash}.webp`);

                    // Delete the temp file
                    if (fs.existsSync(tempFilePath)) {
                        fs.unlinkSync(tempFilePath);
                        console.log(`🧹 Cleaned up temp file: ${tempFile}`);
                    }

                    // Delete the temp preview
                    if (fs.existsSync(tempPreviewPath)) {
                        fs.unlinkSync(tempPreviewPath);
                        console.log(`🧹 Cleaned up temp preview: ${hash}.webp`);
                    }
                } catch (cleanupError) {
                    console.warn(`⚠️ Failed to clean up temp files: ${cleanupError.message}`);
                }
            }

            // Check if this is the last image in a batch and trigger metadata rescan
            const isLastInBatch = batchInfo && (batchInfo.currentIndex === batchInfo.totalCount - 1);
            if (isLastInBatch) {
                // Trigger metadata cache rescan asynchronously
                setImmediate(async () => {
                    try {
                        await this.globalResources.getMetadataDatabase().scanAndUpdateMetadata(this.globalResources.getPath("images"));
                        console.log('✅ Metadata cache rescan completed');
                    } catch (error) {
                        console.error('❌ Metadata cache rescan failed:', error);
                    }
                });
            }

            // Broadcast gallery update
            const galleryData = await this.handlers.buildGalleryData('images', clientInfo);
            wsServer.broadcastGalleryUpdate(galleryData, 'images');

            this.handlers.sendToClient(ws, {
                type: 'upload_workspace_image_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    message: 'Image uploaded successfully',
                    filename: finalFilename,
                    hash: hash,
                    originalFilename: originalFilename,
                    batchInfo: batchInfo
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('Upload workspace image error:', error);
            this.handlers.sendError(ws, 'Failed to upload image', error.message, message.requestId);
        }
    }

    // Reference Metadata Handlers

    async handleUpdateReferenceMetadata(ws, message, clientInfo, wsServer) {
        try {
            const { hash, metadata } = message;
            if (!hash) {
                this.handlers.sendError(ws, 'Hash is required', 'MISSING_HASH', message.requestId);
                return;
            }

            if (!metadata) {
                this.handlers.sendError(ws, 'Metadata is required', 'MISSING_METADATA', message.requestId);
                return;
            }

            const result = this.globalResources.getReferenceMetadataDatabase().setMetadata(hash, metadata);

            this.handlers.sendToClient(ws, {
                type: 'update_reference_metadata_response',
                requestId: message.requestId,
                data: {
                    success: true,
                    metadata: result
                },
                timestamp: new Date().toISOString()
            });

        } catch (error) {
            console.error('❌ Error updating reference metadata:', error);
            this.handlers.sendError(ws, 'Failed to update reference metadata', error.message, message.requestId);
        }
    }

}

const REFERENCES_PACKETS = [
    ['get_references', 'handleGetReferences'],
    ['get_references_by_ids', 'handleGetReferencesByIds'],
    ['get_workspace_references', 'handleGetWorkspaceReferences'],
    ['delete_reference', 'handleDeleteReference', REFERENCES_DESTRUCTIVE],
    ['upload_reference', 'handleUploadReference', REFERENCES_DESTRUCTIVE],
    ['upload_wallpaper', 'handleUploadWallpaper', REFERENCES_DESTRUCTIVE],
    ['replace_reference', 'handleReplaceReference', REFERENCES_DESTRUCTIVE],
    ['upload_workspace_image', 'handleUploadWorkspaceImage', REFERENCES_DESTRUCTIVE],
    ['download_url_file', 'handleDownloadUrlFile', REFERENCES_DESTRUCTIVE],
    ['fetch_url_info', 'handleFetchUrl', REFERENCES_DESTRUCTIVE],
    ['move_references', 'handleMoveReferences', REFERENCES_DESTRUCTIVE],
    ['update_reference_metadata', 'handleUpdateReferenceMetadata', REFERENCES_DESTRUCTIVE],
    ['get_vibe_image', 'handleGetVibeImage'],
    ['delete_vibe_image', 'handleDeleteVibeImage', REFERENCES_DESTRUCTIVE],
    ['delete_vibe_encodings', 'handleDeleteVibeEncodings', REFERENCES_DESTRUCTIVE],
    ['bulk_delete_vibe_images', 'handleBulkDeleteVibeImages', REFERENCES_DESTRUCTIVE],
    ['move_vibe_image', 'handleMoveVibeImage', REFERENCES_DESTRUCTIVE],
    ['bulk_move_vibe_images', 'handleBulkMoveVibeImages', REFERENCES_DESTRUCTIVE],
    ['encode_vibe', 'handleEncodeVibe', REFERENCES_DESTRUCTIVE],
    ['import_vibe_bundle', 'handleImportVibeBundle', REFERENCES_DESTRUCTIVE],
    ['import_vibe_from_url', 'handleImportVibeFromUrl', REFERENCES_DESTRUCTIVE],
    ['check_vibe_encoding', 'handleCheckVibeEncoding'],
];

function registerReferencesPackets(handlersCtx) {
    if (!handlersCtx || !handlersCtx.referencesHandlers) {
        console.warn('[referencesWebSocketHandlers] registerReferencesPackets: missing handlersCtx.referencesHandlers');
        return;
    }
    const refs = handlersCtx.referencesHandlers;
    const wsPacketRegistry = require('./ws/wsPacketRegistry');
    for (const entry of REFERENCES_PACKETS) {
        const [type, methodName, meta] = entry;
        wsPacketRegistry.registerWsPacket(type, async (ctx) => {
            await refs[methodName](ctx.ws, ctx.message, ctx.clientInfo, ctx.wsServer);
        }, { owner: 'references', ...(meta || {}) });
    }
}

module.exports = ReferencesWebSocketHandlers;
module.exports.registerReferencesPackets = registerReferencesPackets;
module.exports.REFERENCES_PACKETS = REFERENCES_PACKETS;
