const fs = require('fs');
const path = require('path');
const sharp = require('sharp');
const wsPacketRegistry = require('../wsPacketRegistry');
const { encodeBlurhashFromFile } = require('../../blurhashUtils');
const { isImageLarge, matchOriginalResolution } = require('../../imageTools');
const replicationRemoteFetch = require('../../replicationRemoteFetch');
const { isReplicationGalleryClient, canGalleryUseRemoteMaster } = require('../../replication/replicationContracts');

const GALLERY_DESTRUCTIVE = { destructive: true };

const GALLERY_BLOCK_SIZE = 750;
function buildGalleryReplicationFields({
    file,
    base,
    preview,
    metadataPresent,
    imageOwnership,
    previewOwnership,
    masterReachable,
    remoteOnly = false
}) {
    const hasFullImage = !remoteOnly;
    const hasMetadata = metadataPresent === true;
    let storage = 'local';

    if (remoteOnly) {
        storage = 'remote';
    } else if (imageOwnership && imageOwnership.storage === 'remote') {
        storage = 'remote';
    } else if (previewOwnership && previewOwnership.storage === 'remote') {
        storage = 'remote';
    }

    return {
        filename: file,
        preview: preview || (base ? `${base}.webp` : null),
        storage,
        hasFullImage,
        hasMetadata,
        reachable: masterReachable === true
    };
}

function buildGalleryOwnershipEntries(baseArray) {
    const entries = [];
    const seen = new Set();
    for (const item of baseArray) {
        const file = item.upscaled || item.original;
        if (file) {
            const key = `gallery-image::${file}`;
            if (!seen.has(key)) {
                seen.add(key);
                entries.push({ kind: 'gallery-image', key: file });
            }
        }
        if (item.base) {
            const previewKey = `${item.base}.webp`;
            const key = `gallery-preview::${previewKey}`;
            if (!seen.has(key)) {
                seen.add(key);
                entries.push({ kind: 'gallery-preview', key: previewKey });
            }
        }
    }
    return entries;
}

function mapMaterializedItemToGalleryRow(item) {
    const { base, original, upscaled, mtime, width, height, size, blurhash } = item;
    const file = upscaled || original;
    if (!file) {
        return null;
    }
    const itemWidth = width || null;
    const itemHeight = height || null;
    const isLarge = itemWidth && itemHeight ? isImageLarge(itemWidth, itemHeight) : false;

    return {
        base,
        original,
        upscaled,
        filename: file,
        preview: `${base}.webp`,
        blurhash: blurhash || null,
        mtime: mtime || Date.now(),
        width: itemWidth,
        height: itemHeight,
        size: size || 0,
        isLarge
    };
}

async function buildGalleryRowForFilename(handlers, clientInfo, viewType, filename, workspaceIdHint) {
    if (!filename) {
        return null;
    }

    const workspaceId = workspaceIdHint
        || (clientInfo?.sessionId && handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId))
        || 'default';
    const metadataDb = handlers.globalResources.getMetadataDatabase();
    const index = await metadataDb.findGalleryWorkspaceItemIndex(workspaceId, viewType, filename);
    if (index >= 0) {
        const page = await metadataDb.listWorkspaceGalleryItemsPaginated(workspaceId, viewType, index, 1);
        const item = page.items?.[0];
        const row = item ? mapMaterializedItemToGalleryRow(item) : null;
        if (row && (row.original === filename || row.upscaled === filename || row.filename === filename)) {
            // Ownership can materialize the row before image metadata exists (null w/h).
            // Prefer hot/lightweight dims so PhotoSwipe does not fall back to 1024×1024.
            if (!row.width || !row.height) {
                try {
                    const lightMap = await metadataDb.getLightweightMetadata([filename]);
                    const meta = lightMap?.[filename];
                    if (meta?.width && meta?.height) {
                        row.width = meta.width;
                        row.height = meta.height;
                        row.isLarge = isImageLarge(row.width, row.height);
                    }
                } catch (_err) { /* keep materialized row */ }
            }
            return row;
        }
    }

    // Materialized index can lag hot ownership writes — synthesize from lightweight metadata
    // instead of returning an unrelated head item.
    try {
        const lightMap = await metadataDb.getLightweightMetadata([filename]);
        const meta = lightMap?.[filename];
        if (!meta) {
            return null;
        }
        const base = String(filename).replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/i, '');
        const isUpscaled = Boolean(meta.upscaled) || /_upscaled\./i.test(filename);
        return mapMaterializedItemToGalleryRow({
            base,
            original: isUpscaled ? (meta.parent || null) : filename,
            upscaled: isUpscaled ? filename : null,
            mtime: meta.mtime,
            width: meta.width,
            height: meta.height,
            size: meta.size
        });
    } catch (_err) {
        return null;
    }
}

function clientMatchesGalleryWorkspace(handlers, clientInfo, workspaceId) {
    if (!clientInfo || !clientInfo.sessionId) {
        return false;
    }
    try {
        const active = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        return (active || 'default') === (workspaceId || 'default');
    } catch (_err) {
        return false;
    }
}

async function broadcastGalleryMutation(handlers, wsServer, clientInfo, options = {}) {
    const viewType = options.viewType || 'images';
    const action = options.action || 'invalidate_sync';

    let workspaceId = options.workspaceId || options.workspace || null;
    if (!workspaceId && clientInfo?.sessionId) {
        try {
            workspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        } catch (_err) {
            workspaceId = null;
        }
    }
    workspaceId = workspaceId || 'default';
    const metadataDb = handlers.globalResources.getMetadataDatabase();
    const timestamp = new Date().toISOString();
    const workspaceFilter = (info) => clientMatchesGalleryWorkspace(handlers, info, workspaceId);

    const appendFilenames = [];
    if (Array.isArray(options.filenames)) {
        for (const filename of options.filenames) {
            if (filename && typeof filename === 'string') {
                appendFilenames.push(filename);
            }
        }
    } else if (options.filename && typeof options.filename === 'string') {
        appendFilenames.push(options.filename);
    }

    if (action === 'append_top' && appendFilenames.length > 0) {
        const newItems = [];
        for (const filename of appendFilenames) {
            const newItem = await buildGalleryRowForFilename(handlers, clientInfo, viewType, filename, workspaceId);
            if (newItem) {
                newItems.push(newItem);
            }
        }
        if (newItems.length > 0) {
            wsServer.broadcast({
                type: 'gallery_updated',
                data: {
                    action: 'append_top',
                    newItems,
                    viewType,
                    workspaceId
                },
                timestamp
            }, workspaceFilter);
            return;
        }
    }

    const probeMeta = await metadataDb.getGalleryWorkspaceProbeMeta(workspaceId, viewType);
    wsServer.broadcast({
        type: 'gallery_updated',
        data: {
            action: 'invalidate_sync',
            viewType,
            workspaceId,
            total: Number(probeMeta?.totalItems) || 0
        },
        timestamp
    }, workspaceFilter);
}

function sendGalleryMetaProbeResponse(handlers, ws, requestId, {
    viewType,
    activeWorkspaceId,
    lastGalleryDestructiveAt,
    totalItems,
    pinnedIndexes,
    offset,
    limit
}) {
    handlers.stopKeepAliveInterval(requestId);
    handlers.sendToClient(ws, {
        type: 'request_gallery_response',
        requestId,
        data: {
            gallery: [],
            viewType,
            workspaceId: activeWorkspaceId,
            blockSize: GALLERY_BLOCK_SIZE,
            pinnedIndexes: Array.isArray(pinnedIndexes) ? pinnedIndexes : [],
            lastGalleryDestructiveAt,
            pagination: {
                offset,
                limit,
                hasMore: totalItems > 0,
                totalItems
            }
        },
        timestamp: new Date().toISOString()
    });
}

async function tryFastGalleryMetaProbe(metadataDb, activeWorkspaceId, viewType) {
    const probeMeta = await metadataDb.getGalleryWorkspaceProbeMeta(activeWorkspaceId, viewType);
    if (!probeMeta || probeMeta.totalItems < 0) {
        return null;
    }

    return probeMeta;
}

async function tryServeGalleryFastPaginatedPage(handlers, ws, requestId, {
    metadataDb,
    activeWorkspaceId,
    viewType,
    offset,
    limit,
    light,
    includePinnedStatus,
    lastGalleryDestructiveAt,
    galleryClient,
    masterReachable,
    replicationConfig,
    showSharedRemote,
    shouldFilterReplicationIndex,
    assetRegistry,
    isGalleryBlockFetch,
    afterCursor
}) {
    if (!light) {
        return false;
    }

    const paginationOptions = afterCursor ? { afterCursor } : null;
    const page = await metadataDb.listWorkspaceGalleryItemsPaginated(
        activeWorkspaceId,
        viewType,
        offset,
        limit,
        paginationOptions
    );
    let paginatedItems = page.items || [];
    const totalItems = page.totalItems || 0;
    if (totalItems <= 0 && paginatedItems.length <= 0) {
        return false;
    }

    let pageOwnershipMap = null;
    if (!isGalleryBlockFetch && shouldFilterReplicationIndex && assetRegistry && paginatedItems.length > 0) {
        pageOwnershipMap = await assetRegistry.getOwnershipBatch(buildGalleryOwnershipEntries(paginatedItems));
        const filtered = [];
        for (const item of paginatedItems) {
            const file = item.upscaled || item.original;
            if (!file) {
                continue;
            }
            const imageOwnership = pageOwnershipMap.get(`gallery-image::${file}`);
            const previewOwnership = pageOwnershipMap.get(`gallery-preview::${item.base}.webp`);
            const isRemoteOnly = (imageOwnership && imageOwnership.storage === 'remote')
                || (previewOwnership && previewOwnership.storage === 'remote');
            if (!isRemoteOnly) {
                filtered.push(item);
            }
        }
        paginatedItems = filtered;
    }

    const hasMore = (offset + limit) < totalItems;

    const getPreviewFilename = (baseName) => `${baseName}.webp`;

    let pinnedSet = null;
    let pinnedIndexes = [];
    if (!isGalleryBlockFetch && includePinnedStatus && viewType === 'images' && offset === 0) {
        const pinBases = await metadataDb.listGalleryWorkspacePinBases(activeWorkspaceId);
        if (pinBases.length > 0) {
            const pinBaseSet = new Set(pinBases);
            pinnedSet = new Set();
            for (const item of paginatedItems) {
                if (!pinBaseSet.has(item.base)) {
                    continue;
                }
                if (item.original) {
                    pinnedSet.add(item.original);
                }
                if (item.upscaled) {
                    pinnedSet.add(item.upscaled);
                }
            }
            if (limit >= totalItems) {
                pinnedIndexes = await metadataDb.listGalleryWorkspacePinIndexes(activeWorkspaceId);
            }
        }
    }

    const gallery = [];
    for (const item of paginatedItems) {
        const { base, original, upscaled, mtime, width, height, size } = item;
        const file = upscaled || original;
        if (!file) {
            continue;
        }
        const itemWidth = width || null;
        const itemHeight = height || null;
        const isLarge = itemWidth && itemHeight ? isImageLarge(itemWidth, itemHeight) : false;

        const row = {
            base,
            original,
            upscaled,
            filename: file,
            preview: getPreviewFilename(base),
            mtime: mtime || Date.now(),
            width: itemWidth,
            height: itemHeight,
            size: size || 0,
            isLarge,
            isPinned: pinnedSet ? pinnedSet.has(file) : false
        };

        if (galleryClient && pageOwnershipMap) {
            Object.assign(row, buildGalleryReplicationFields({
                file,
                base,
                preview: getPreviewFilename(base),
                metadataPresent: Boolean(mtime),
                imageOwnership: pageOwnershipMap.get(`gallery-image::${file}`),
                previewOwnership: pageOwnershipMap.get(`gallery-preview::${getPreviewFilename(base)}`),
                masterReachable,
                remoteOnly: false
            }));
        }

        gallery.push(row);
    }

    let replicationContext = null;
    if (galleryClient && !isGalleryBlockFetch) {
        replicationContext = replicationRemoteFetch.buildReplicationContext(
            replicationConfig,
            masterReachable,
            showSharedRemote
        );
    }

    if (!isGalleryBlockFetch) {
        await new Promise((resolve) => { setImmediate(resolve); });
    }

    handlers.stopKeepAliveInterval(requestId);
    handlers.sendToClient(ws, {
        type: 'request_gallery_response',
        requestId,
        data: {
            gallery,
            viewType,
            workspaceId: activeWorkspaceId,
            blockSize: GALLERY_BLOCK_SIZE,
            blockOffset: offset,
            pinnedIndexes,
            lastGalleryDestructiveAt,
            replicationContext,
            pagination: {
                offset,
                limit,
                hasMore,
                totalItems
            }
        },
        timestamp: new Date().toISOString()
    });
    return true;
}

async function handleGalleryRequest(handlers, ws, message, clientInfo, wsServer) {
    const { requestId, viewType = 'images', includePinnedStatus = true, offset = 0, workspaceId: clientWorkspaceId } = message;
    const light = message.light !== false;
    const limit = message.limit !== undefined && message.limit !== null ? Number(message.limit) : 100;
    const isHashProbe = limit === 0;
    const isGalleryBlockFetch = message.galleryBlockFetch === true || limit >= GALLERY_BLOCK_SIZE;
    const afterCursor = message.afterCursor || null;
    const effectiveIncludePinned = isGalleryBlockFetch ? false : includePinnedStatus;

    try {
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

        const metadataDb = handlers.globalResources.getMetadataDatabase();
        const galleryBucket = metadataDb.viewTypeToGalleryBucket(viewType);

        const workspaceRecord = handlers.globalResources.getWorkspaceManager().getWorkspace(activeWorkspaceId);
        const lastGalleryDestructiveAt = Number(workspaceRecord?.lastGalleryDestructiveAt) || 0;

        // Meta probe (limit:0) — O(1) SQL meta only; return before any replication / index work
        if (isHashProbe) {
            const fastProbe = await tryFastGalleryMetaProbe(metadataDb, activeWorkspaceId, viewType);
            sendGalleryMetaProbeResponse(handlers, ws, requestId, {
                viewType,
                activeWorkspaceId,
                lastGalleryDestructiveAt,
                totalItems: fastProbe?.totalItems ?? 0,
                pinnedIndexes: [],
                offset,
                limit
            });
            return;
        }

        handlers.startKeepAliveInterval(ws, requestId, 10000);

        if (isGalleryBlockFetch && light) {
            const servedBlockPage = await tryServeGalleryFastPaginatedPage(handlers, ws, requestId, {
                metadataDb,
                activeWorkspaceId,
                viewType,
                offset,
                limit,
                light,
                includePinnedStatus: false,
                lastGalleryDestructiveAt,
                galleryClient: false,
                masterReachable: false,
                replicationConfig: null,
                showSharedRemote: false,
                shouldFilterReplicationIndex: false,
                assetRegistry: null,
                isGalleryBlockFetch: true,
                afterCursor
            });
            if (servedBlockPage) {
                return;
            }
            handlers.stopKeepAliveInterval(requestId);
            handlers.sendError(ws, 'Gallery page unavailable', 'Fast gallery block path failed', requestId);
            return;
        }

        const replicationConfig = handlers.globalResources.getReplicationService().getReplicationConfig();
        const galleryClient = isReplicationGalleryClient(replicationConfig);
        const canUseRemoteMaster = canGalleryUseRemoteMaster(replicationConfig);

        let masterReachable = false;
        let showSharedRemote = false;
        let assetRegistry = null;
        let needsReplicationBanner = false;

        if (galleryClient) {
            assetRegistry = handlers.globalResources.getReplicationService().getAssetRegistry();
        }

        if (canUseRemoteMaster) {
            const sessionShowShared = await resolveSessionGalleryShowShared(handlers, clientInfo);
            showSharedRemote = replicationRemoteFetch.shouldShowSharedGallery(
                replicationConfig,
                sessionShowShared
            );
            if (showSharedRemote) {
                masterReachable = await replicationRemoteFetch.probeMasterReachable(false, handlers.globalResources);
            }
            needsReplicationBanner = replicationRemoteFetch.shouldShowReplicationBanner(
                replicationConfig,
                masterReachable
            );
        }

        const needsRemoteMerge = canUseRemoteMaster && showSharedRemote && masterReachable;
        const shouldFilterReplicationIndex = galleryClient && assetRegistry
            && !needsRemoteMerge
            && replicationConfig.connectivity !== 'airgapped';

        // Light paginated requests always use SQL LIMIT/OFFSET — never build the full gallery index
        if (light && !needsRemoteMerge) {
            const servedFastPage = await tryServeGalleryFastPaginatedPage(handlers, ws, requestId, {
                metadataDb,
                activeWorkspaceId,
                viewType,
                offset,
                limit,
                light,
                includePinnedStatus: effectiveIncludePinned,
                lastGalleryDestructiveAt,
                galleryClient,
                masterReachable,
                replicationConfig,
                showSharedRemote,
                shouldFilterReplicationIndex,
                assetRegistry,
                isGalleryBlockFetch: false,
                afterCursor
            });
            if (servedFastPage) {
                return;
            }
            handlers.stopKeepAliveInterval(requestId);
            handlers.sendError(ws, 'Gallery page unavailable', 'Fast gallery path failed', requestId);
            return;
        }

        if (light) {
            handlers.stopKeepAliveInterval(requestId);
            handlers.sendError(ws, 'Gallery unavailable', 'Remote gallery merge required', requestId);
            return;
        }

        // Plan: request_gallery never builds a full workspace index (gallery-cache-revision-system.md).
        // Non-light / remote-merge callers must use light paginated LIMIT/OFFSET via tryServeGalleryFastPaginatedPage.
        handlers.stopKeepAliveInterval(requestId);
        handlers.sendError(
            ws,
            'Gallery unavailable',
            'Use light paginated request_gallery (probe limit:0, blocks via LIMIT/OFFSET)',
            requestId
        );
        return;


    } catch (error) {
        // Stop keep-alive on error
        handlers.stopKeepAliveInterval(requestId);

        console.error('Gallery request error:', error);
        handlers.sendError(ws, 'Failed to load gallery', error.message, requestId);
    }
}

async function resolveImageWorkspaceOwnership(handlers, filename) {
    if (!filename) {
        return null;
    }

    const metadataDb = handlers.globalResources.getMetadataDatabase();
    return metadataDb.getGalleryOwnershipForFilename(filename);
}

// Handle image metadata request messages
async function handleImageMetadataRequest(handlers, ws, message, clientInfo, wsServer) {
    const { filename } = message;

    if (!filename) {
        handlers.sendError(ws, 'Missing filename parameter', 'request_image_metadata');
        return;
    }

    try {
        const imagesDir = handlers.globalResources.getPath("images");
        const workspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const metadataDb = handlers.globalResources.getMetadataDatabase();

        // Track client workspace usage
        handlers.metadataCache.trackClientWorkspace(clientInfo.sessionId, workspaceId);

        let cachedMetadata = handlers.metadataCache.get(workspaceId, filename);

        // Hot path: memory → SQL (read-only). Do not touch the filesystem until SQL misses.
        if (!cachedMetadata) {
            cachedMetadata = await metadataDb.getCachedMetadata(filename, false);
            if (cachedMetadata) {
                handlers.metadataCache.set(workspaceId, filename, cachedMetadata);
            }
        }

        if (!cachedMetadata) {
            const filePath = path.join(imagesDir, filename);
            const fileExists = fs.existsSync(filePath);

            if (!fileExists && canGalleryUseRemoteMaster(
                handlers.globalResources.getReplicationService().getReplicationConfig()
            )) {
                try {
                    await replicationRemoteFetch.readAssetBuffer(
                        'gallery-image',
                        filename,
                        handlers.globalResources,
                        { cacheToLocal: true }
                    );
                    cachedMetadata = await metadataDb.getImageMetadata(filename, imagesDir);
                    if (cachedMetadata) {
                        handlers.metadataCache.set(workspaceId, filename, cachedMetadata);
                    }
                } catch (fetchError) {
                    if (fetchError instanceof replicationRemoteFetch.ReplicationAssetError
                        || fetchError.code === 'REPLICATION_ASSET_UNAVAILABLE') {
                        replicationRemoteFetch.sendReplicationAssetError(
                            handlers,
                            ws,
                            fetchError,
                            message.requestId,
                            'request_image_metadata'
                        );
                        return;
                    }
                }
            }

            if (!cachedMetadata && fileExists) {
                console.log(`🔄 Metadata not found in cache for ${filename}, extracting...`);
                cachedMetadata = await metadataDb.getImageMetadata(filename, imagesDir);
                if (!cachedMetadata) {
                    handlers.sendError(ws, 'Failed to extract metadata', 'request_image_metadata', message.requestId);
                    return;
                }
                handlers.metadataCache.set(workspaceId, filename, cachedMetadata);
            }
        }

        if (!cachedMetadata) {
            handlers.sendError(ws, 'Image not found', 'request_image_metadata', message.requestId);
            return;
        }

        // Get the metadata object (PNG embedded metadata)
        let metadata = cachedMetadata.metadata;

        // If this is an upscaled image and has a parent, get the parent's metadata (without receipts)
        if (cachedMetadata.upscaled && cachedMetadata.parent) {
            const parentMetadata = await metadataDb.getCachedMetadata(cachedMetadata.parent, false);
            if (parentMetadata) {
                metadata = parentMetadata.metadata;
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

        // Extract fields and ownership in parallel — ownership is indexed SQL, extract was doing full-file reads
        const [result, ownership] = await Promise.all([
            handlers.globalResources.getPngMetadata().extractRelevantFields(
                metadata,
                filename,
                cachedMetadata.blurhash
            ),
            resolveImageWorkspaceOwnership(handlers, filename)
        ]);
        if (!result) {
            handlers.sendError(ws, 'No NovelAI metadata found', 'request_image_metadata', message.requestId);
            return;
        }
        if (matchedPreset) result.matchedPreset = matchedPreset;

        if (ownership) {
            result.workspaceId = ownership.workspaceId;
            result.workspaceIds = ownership.workspaces.map((entry) => entry.workspaceId);
            result.workspaceBucket = ownership.bucket;
        }

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

// Handle image by index request messages
async function handleImageByIndexRequest(handlers, ws, message, clientInfo, wsServer) {
    const { index, viewType = 'images' } = message;

    if (index === undefined || index === null) {
        handlers.sendError(ws, 'Missing index parameter', 'request_image_by_index');
        return;
    }

    try {
        if (!clientInfo?.sessionId) {
            handlers.sendError(ws, 'Session required', 'request_image_by_index', message.requestId);
            return;
        }

        const workspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const metadataDb = handlers.globalResources.getMetadataDatabase();
        const page = await metadataDb.listWorkspaceGalleryItemsPaginated(workspaceId, viewType, index, 1);
        const totalItems = page.totalItems || 0;

        if (totalItems === 0 || !page.items?.length) {
            handlers.sendError(ws, 'No images found', 'request_image_by_index', message.requestId);
            return;
        }

        if (index < 0 || index >= totalItems) {
            handlers.sendError(ws, 'Index out of bounds', 'request_image_by_index', message.requestId);
            return;
        }

        const image = mapMaterializedItemToGalleryRow(page.items[0]);
        if (!image) {
            handlers.sendError(ws, 'No images found', 'request_image_by_index', message.requestId);
            return;
        }

        // Load full metadata only for the target image (check cache first)
        let metadata = null;
        try {
            const filePath = path.join(handlers.globalResources.getPath("images"), image.original);
            if (fs.existsSync(filePath)) {
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
                    metadata = await handlers.globalResources.getPngMetadata().extractRelevantFields(
                        cachedMetadata.metadata,
                        image.original,
                        image.blurhash || cachedMetadata.blurhash
                    );
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
        if (!clientInfo?.sessionId) {
            handlers.sendError(ws, 'Session required', 'find_image_index', message.requestId);
            return;
        }

        const workspaceId = handlers.globalResources.getWorkspaceManager().getActiveWorkspace(clientInfo.sessionId);
        const metadataDb = handlers.globalResources.getMetadataDatabase();
        const index = await metadataDb.findGalleryWorkspaceItemIndex(workspaceId, viewType, filename);

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
async function resolveSessionGalleryShowShared(handlers, clientInfo) {
    if (!clientInfo) return false;
    if (clientInfo.galleryShowSharedRemote !== undefined) {
        return clientInfo.galleryShowSharedRemote === true;
    }
    if (!clientInfo.sessionId) return false;
    const store = handlers.globalResources.getSessionStore();
    if (!store || typeof store.get !== 'function') return false;
    return Promise.race([
        new Promise((resolve) => {
            store.get(clientInfo.sessionId, (err, sess) => {
                const enabled = sess?.galleryShowSharedRemote === true;
                clientInfo.galleryShowSharedRemote = enabled;
                resolve(enabled);
            });
        }),
        new Promise((resolve) => setTimeout(() => resolve(false), 3000))
    ]);
}

async function handleSetGalleryShowShared(handlers, ws, message, clientInfo, wsServer) {
    if (!clientInfo?.sessionId) {
        handlers.sendError(ws, 'Session required', 'set_gallery_show_shared', message.requestId);
        return;
    }
    const enabled = message.enabled === true;
    clientInfo.galleryShowSharedRemote = enabled;
    const store = handlers.globalResources.getSessionStore();
    if (store && typeof store.get === 'function') {
        await new Promise((resolve) => {
            store.get(clientInfo.sessionId, (err, sess) => {
                if (err || !sess) {
                    resolve();
                    return;
                }
                sess.galleryShowSharedRemote = enabled;
                store.set(clientInfo.sessionId, sess, () => resolve());
            });
        });
    }
    handlers.sendToClient(ws, {
        type: 'set_gallery_show_shared_response',
        requestId: message.requestId,
        data: { enabled },
        timestamp: new Date().toISOString()
    });
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
        const allFilenamesToRemoveFromWorkspaces = new Set();

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

                // Queue workspace + metadata cleanup (batched after all filesystem deletes)
                for (const fn of filenamesToRemoveFromWorkspaces) {
                    allFilenamesToRemoveFromWorkspaces.add(fn);
                }

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

        const filenamesRemoved = [...allFilenamesToRemoveFromWorkspaces];
        if (filenamesRemoved.length > 0) {
            handlers.globalResources.getWorkspaceManager().removeFilesFromWorkspaces(
                filenamesRemoved,
                { skipDestructiveBump: true }
            );
            await handlers.globalResources.getMetadataDatabase().removeImageMetadata(filenamesRemoved);
        }

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
                deletedFilenames: results.map(r => r.filename),
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

async function handleDeleteUnupscaledOriginal(handlers, ws, message, clientInfo, wsServer) {
    try {
        const filename = message.filename;
        if (!filename || typeof filename !== 'string') {
            handlers.sendError(ws, 'Filename is required', 'delete_unupscaled_original', message.requestId);
            return;
        }
        if (filename.includes('_upscaled')) {
            handlers.sendError(ws, 'Filename is not an original (un-upscaled) file', 'delete_unupscaled_original', message.requestId);
            return;
        }

        const imagesDir = handlers.globalResources.getPath('images');
        const originalPath = path.join(imagesDir, filename);
        const upscaledFilename = filename.replace(/\.png$/i, '_upscaled.png');
        const upscaledPath = path.join(imagesDir, upscaledFilename);

        if (!fs.existsSync(originalPath)) {
            handlers.sendError(ws, 'Original file not found', 'delete_unupscaled_original', message.requestId);
            return;
        }
        if (!fs.existsSync(upscaledPath)) {
            handlers.sendError(ws, 'No upscaled version exists; use Incinerate to delete the image', 'delete_unupscaled_original', message.requestId);
            return;
        }

        const filesToDelete = [{ path: originalPath, type: 'original' }];
        try {
            const imageBuffer = fs.readFileSync(originalPath);
            const metadata = handlers.globalResources.getPngMetadata().readMetadata(imageBuffer);
            if (metadata?.tEXt?.Comment) {
                const commentData = JSON.parse(metadata.tEXt.Comment);
                const previewHash = commentData?.forge_data?.dynamic_generation?.compiled_prompt?.preview_image_hash;
                if (previewHash) {
                    const dynGenPreviewPath = path.join(
                        handlers.globalResources.getPath('cache'),
                        'dynGenPreview',
                        `${previewHash}.png`
                    );
                    if (fs.existsSync(dynGenPreviewPath)) {
                        filesToDelete.push({ path: dynGenPreviewPath, type: 'dynGenPreview' });
                    }
                }
            }
        } catch (metadataError) {
            console.debug(`Could not extract metadata for original preview cleanup: ${metadataError.message}`);
        }

        for (const file of filesToDelete) {
            try {
                fs.unlinkSync(file.path);
            } catch (error) {
                console.error(`Failed to delete ${file.type}: ${path.basename(file.path)}`, error.message);
            }
        }

        handlers.globalResources.getWorkspaceManager().removeFilesFromWorkspaces(
            [filename],
            { skipDestructiveBump: true }
        );
        handlers.globalResources.getReferenceMetadataDatabase().deleteMetadata(filename);
        await handlers.globalResources.getMetadataDatabase().removeImageMetadata([filename], { keepPins: true });

        handlers.sendToClient(ws, {
            type: 'delete_unupscaled_original_response',
            requestId: message.requestId,
            data: {
                success: true,
                originalFilename: filename,
                upscaledFilename
            },
            timestamp: new Date().toISOString()
        });

        wsServer.broadcast({
            type: 'gallery_updated',
            data: {
                action: 'unupscaled_removed',
                originalFilename: filename,
                upscaledFilename,
                viewType: 'images'
            },
            timestamp: new Date().toISOString()
        });
    } catch (error) {
        console.error('Delete un-upscaled original error:', error);
        handlers.sendError(ws, 'Failed to delete original file', error.message, message.requestId);
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
                deletedFilenames: results.map(r => r.filename),
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
        const blurhash = pngMetadata?.forge_data?.blurhash
            || await encodeBlurhashFromFile(filePath);
        if (blurhash && pngMetadata) {
            if (!pngMetadata.forge_data) pngMetadata.forge_data = {};
            pngMetadata.forge_data.blurhash = blurhash;
        }
        const result = {
            filename: filename,
            width: imageMetadata.width,
            height: imageMetadata.height,
            blurhash: blurhash || null,
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

    regFn('request_gallery', handleGalleryRequest, { dispatch: 'parallel' });
    regFn('request_image_metadata', handleImageMetadataRequest, { dispatch: 'parallel' });
    regFn('request_url_upload_metadata', handleUrlUploadMetadataRequest);
    regFn('request_image_by_index', handleImageByIndexRequest);
    regFn('find_image_index', handleFindImageIndexRequest);
    regFn('gallery_position_hint', handleGalleryPositionHint);
    regFn('set_gallery_show_shared', handleSetGalleryShowShared);
    regFn('delete_images_bulk', handleDeleteImagesBulk, GALLERY_DESTRUCTIVE);
    regFn('delete_unupscaled_original', handleDeleteUnupscaledOriginal, GALLERY_DESTRUCTIVE);
    regFn('send_to_sequenzia_bulk', handleSendToSequenziaBulk);
    regFn('update_image_preset_bulk', handleUpdateImagePresetBulk, GALLERY_DESTRUCTIVE);
}

module.exports = {
    registerPackets,
    broadcastGalleryMutation,
    clientMatchesGalleryWorkspace
};
