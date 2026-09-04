// Gallery images load/sync/probe helpers.
// Extracted from galleryView.js (#23 incremental slice). Same globals.

function markGalleryImagesSyncState(workspaceId, viewType, total, pinnedIndexes, destructiveAt, updatedAt, latestFilename) {
    if (!total) {
        return;
    }
    galleryImagesSyncState = {
        workspaceId: workspaceId || 'default',
        viewType: viewType || 'images',
        total,
        pinnedIndexes: Array.isArray(pinnedIndexes) ? pinnedIndexes.slice() : [],
        destructiveAt: Number(destructiveAt) || 0,
        updatedAt: Number(updatedAt) || 0,
        latestFilename: latestFilename || null
    };
}

function stampGalleryImagesSyncHint(hint) {
    if (!galleryImagesSyncState || !hint) return;
    if (hint.workspaceId && hint.workspaceId !== galleryImagesSyncState.workspaceId) return;
    if (hint.total != null) {
        galleryImagesSyncState.total = Number(hint.total) || galleryImagesSyncState.total;
    }
    if (hint.lastGalleryDestructiveAt != null) {
        galleryImagesSyncState.destructiveAt = Number(hint.lastGalleryDestructiveAt) || galleryImagesSyncState.destructiveAt;
    }
    if (hint.lastGalleryUpdatedAt != null) {
        galleryImagesSyncState.updatedAt = Number(hint.lastGalleryUpdatedAt) || galleryImagesSyncState.updatedAt;
    }
    if (hint.latestFilename) {
        galleryImagesSyncState.latestFilename = hint.latestFilename;
    }
}

function galleryStoredDestructiveAt(stored) {
    return Number(stored?.destructiveAt) || 0;
}

function galleryDestructiveTimestampInvalidatesCache(probeDestructiveAt, ...storedSources) {
    const probeAt = Number(probeDestructiveAt) || 0;
    if (!probeAt) {
        return false;
    }
    for (const stored of storedSources) {
        if (!stored) {
            continue;
        }
        if (probeAt > galleryStoredDestructiveAt(stored)) {
            return true;
        }
    }
    return false;
}

function gallerySessionMatchesProbe(probe) {
    if (!galleryImagesSyncState || !probe) {
        return false;
    }
    const serverTotal = Number(probe.total) || 0;
    if (!serverTotal || galleryImagesSyncState.total !== serverTotal) {
        return false;
    }
    if (galleryDestructiveTimestampInvalidatesCache(probe.lastGalleryDestructiveAt, galleryImagesSyncState)) {
        return false;
    }
    const serverUpdatedAt = Number(probe.lastGalleryUpdatedAt) || 0;
    const storedUpdatedAt = Number(galleryImagesSyncState.updatedAt) || 0;
    if (serverUpdatedAt && storedUpdatedAt && serverUpdatedAt > storedUpdatedAt) {
        return false;
    }
    if (probe.latestFilename && !activeGalleryHasExactFile(probe.latestFilename)) {
        return false;
    }
    return true;
}

function canAppendOnlyGallerySync(storedTotal, probeTotal, probeDestructiveAt, storedDestructiveAt) {
    const cachedTotal = Number(storedTotal) || 0;
    const serverTotal = Number(probeTotal) || 0;
    const totalDelta = serverTotal - cachedTotal;
    if (totalDelta <= 0 || cachedTotal <= 0) {
        return false;
    }
    const probeAt = Number(probeDestructiveAt) || 0;
    const storedAt = Number(storedDestructiveAt) || 0;
    if (probeAt && probeAt > storedAt) {
        return false;
    }
    return true;
}

function invalidateGalleryImagesSyncState() {
    galleryImagesSyncState = null;
}

function driftGalleryImagesSyncState(newTotal) {
    if (!galleryImagesSyncState) {
        return;
    }
    galleryImagesSyncState.total = Number(newTotal) || 0;
}

// Tracks which view/workspace load results are still valid (rapid view switches).
let galleryLoadTokenCounter = 0;
let lastGalleryDisplayKey = '';

function getGalleryLoadWorkspaceId() {
    return (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'default';
}

function getGalleryDisplayKey() {
    return `${getGalleryLoadWorkspaceId()}:${currentGalleryView}`;
}

function markGalleryDisplayed() {
    lastGalleryDisplayKey = getGalleryDisplayKey();
}

function issueGalleryLoadToken(viewType) {
    galleryBlockSyncPartialRevealToken = null;
    return {
        id: ++galleryLoadTokenCounter,
        viewType,
        workspaceId: getGalleryLoadWorkspaceId()
    };
}

function isGalleryLoadTokenCurrent(token) {
    if (!token) {
        return true;
    }
    return token.id === galleryLoadTokenCounter
        && currentGalleryView === token.viewType
        && getGalleryLoadWorkspaceId() === token.workspaceId;
}

function canJoinGalleryImagesLoad() {
    return galleryImagesLoadTask
        && galleryImagesLoadTask.viewType === 'images'
        && galleryImagesLoadTask.workspaceId === getGalleryLoadWorkspaceId()
        && currentGalleryView === 'images';
}

function subscribeGalleryImagesLoadProgress(callback) {
    const task = galleryImagesLoadTask;
    if (!task) {
        return () => {};
    }
    if (task.lastProgress) {
        callback(task.lastProgress);
    }
    task.progressListeners.add(callback);
    return () => task.progressListeners.delete(callback);
}

function publishGalleryImagesLoadProgress(progress) {
    const task = galleryImagesLoadTask;
    if (!task) {
        return;
    }
    task.lastProgress = progress;
    task.progressListeners.forEach((listener) => {
        try {
            listener(progress);
        } catch (e) {
            console.error('Gallery load progress listener error:', e);
        }
    });
}

function shouldShowGalleryLoadProgress(loadOptions) {
    if (isGalleryWindowHidden()) {
        return false;
    }
    const opts = (loadOptions && typeof loadOptions === 'object') ? loadOptions : {};
    if (opts.showProgress === false) {
        return false;
    }
    if (opts.showProgress === true) {
        return true;
    }
    return true;
}

/** Clear gallery progress ownership when the shared confirmation dialog was closed elsewhere. */
function syncGalleryProgressDialogState() {
    if (!galleryProgressModal) {
        return;
    }
    // isConfirmationDialogActive: public/scripts/comp/confirmationDialog.js
    if (typeof isConfirmationDialogActive === 'function' && !isConfirmationDialogActive()) {
        galleryProgressModal = null;
        galleryProgressBarElement = null;
        galleryProgressTextElement = null;
        galleryProgressContainerElement = null;
        galleryProgressModeSwitched = false;
    }
}

function displayGalleryContentIfNeeded() {
    if (isGalleryWindowHidden() || isJumpingToPosition) {
        return;
    }
    const displayKey = getGalleryDisplayKey();
    const hasDisplayedItems = gallery && gallery.children.length > 0;
    if (hasDisplayedItems && lastGalleryDisplayKey === displayKey) {
        return;
    }
    if (!allImages || allImages.length === 0) {
        return;
    }
    clearSelection();
    resetInfiniteScroll();
    displayGalleryInitialPageOrRestored();
    markGalleryDisplayed();
}

async function joinGalleryImagesLoad(progressCallback, opts) {
    const task = galleryImagesLoadTask;
    if (!task) {
        return;
    }

    const loadLog = acquireGalleryLoadLogger('images', getGalleryLoadWorkspaceId());
    loadLog.step('join', 'Joining in-flight gallery load instead of starting a duplicate', {
        workspaceId: task.workspaceId,
        showProgress: shouldShowGalleryLoadProgress(opts)
    });

    const galleryDataReady = typeof isGalleryReady === 'function'
        ? isGalleryReady()
        : (allImages && allImages.length > 0);

    if (galleryDataReady) {
        hideGalleryProgressModal();
        displayGalleryContentIfNeeded();
        return;
    }

    const wantProgress = shouldShowGalleryLoadProgress(opts);
    let galleryLoadingProgressShown = false;
    let unsub = () => {};

    if (wantProgress) {
        galleryLoadingProgressShown = ensureGalleryLoadProgressVisible();
        unsub = subscribeGalleryImagesLoadProgress((p) => {
            updateGalleryLoadingProgress(p);
            if (progressCallback) {
                progressCallback(p);
            }
        });
    } else if (progressCallback) {
        unsub = subscribeGalleryImagesLoadProgress(progressCallback);
    }

    try {
        await task.promise;
        loadLog.done('joined in-flight gallery load');
        if (isGalleryLoadTokenCurrent(task.loadToken)) {
            displayGalleryContentIfNeeded();
        }
    } finally {
        unsub();
        if (galleryLoadingProgressShown) {
            hideGalleryProgressModal();
        }
    }
}

// prepareGalleryWindowContent: public/scripts/comp/modalUtils.js showGalleryWindow
async function prepareGalleryWindowContent() {
    const galleryDataReady = typeof isGalleryReady === 'function'
        ? isGalleryReady()
        : (allImages && allImages.length > 0);

    if (galleryDataReady) {
        hideGalleryProgressModal();
        displayGalleryContentIfNeeded();
        return;
    }

    if (canJoinGalleryImagesLoad()) {
        await joinGalleryImagesLoad(null, { showProgress: true });
        return;
    }

    const savedPosition = savedGalleryPosition || 0;
    if (savedPosition && typeof displayGalleryFromStartIndex === 'function') {
        displayGalleryFromStartIndex(savedPosition);
        return;
    }

    // beginStartupGalleryLoad: public/scripts/appInitSteps.js — loadGallery runs right after openModal
    if (document.body.classList.contains('initializing')) {
        return;
    }

    await loadGallery();
}
window.prepareGalleryWindowContent = prepareGalleryWindowContent;

function extractPinnedIndexesFromGallery(gallery) {
    if (!Array.isArray(gallery)) {
        return [];
    }
    const indexes = [];
    for (let i = 0; i < gallery.length; i++) {
        if (gallery[i] && gallery[i].isPinned) {
            indexes.push(i);
        }
    }
    return indexes;
}

function applyPinnedIndexesOverlay(gallery, pinnedIndexes) {
    if (!Array.isArray(gallery) || gallery.length === 0) {
        return gallery;
    }
    const pins = Array.isArray(pinnedIndexes) ? pinnedIndexes : [];
    if (pins.length === 0) {
        for (let i = 0; i < gallery.length; i++) {
            if (gallery[i]) {
                gallery[i].isPinned = false;
            }
        }
        return gallery;
    }
    const pinnedSet = new Set(pins);
    for (let i = 0; i < gallery.length; i++) {
        if (gallery[i]) {
            gallery[i].isPinned = pinnedSet.has(i);
        }
    }
    return gallery;
}

const GALLERY_CHUNK_SIZE = 750;
const INCREMENTAL_HEAD_SYNC_MAX_DELTA = 500;
const GALLERY_LOAD_LOG_MAX_ENTRIES = 500;
const GALLERY_LOAD_LOG_CLIENT_SOURCE_ID = 'client:gallery-load';

let galleryBlockSyncPartialRevealToken = null;

function galleryChunkAfterCursor(item) {
    if (!item || item.base == null) {
        return null;
    }
    const sortMtime = Number(item.mtime);
    if (!Number.isFinite(sortMtime)) {
        return null;
    }
    return { sortMtime, base: String(item.base) };
}

function maybeRevealGalleryDuringBlockSync(partialItems, probe, totalItems, loadToken, loadLog = galleryLoadLogNoop) {
    if (!partialItems.length || !isGalleryLoadTokenCurrent(loadToken) || partialItems.length >= totalItems) {
        return;
    }
    if (galleryBlockSyncPartialRevealToken === loadToken) {
        return;
    }
    galleryBlockSyncPartialRevealToken = loadToken;
    loadLog.step('partial-reveal', 'Showing gallery after first block while sync continues', {
        loaded: partialItems.length,
        expectedTotal: totalItems
    });
    setActiveGalleryList(slimGalleryList(partialItems.slice()), { preserveSyncState: true });
    if (typeof hideGalleryProgressModal === 'function') {
        hideGalleryProgressModal();
    }
    displayGalleryContentIfNeeded();
}

let galleryLoadLogSession = 0;
let galleryLoadLogRequestCount = 0;
let galleryLoadLogViewerEngaged = false;
const galleryLoadLogBuffer = [];

const galleryLoadLogNoop = {
    step() {},
    done() {}
};

function formatGalleryLoadLogLine(session, decision, reason, details, ts = Date.now()) {
    const time = new Date(ts).toLocaleTimeString();
    const detailSuffix = details !== undefined && details !== null
        ? ` ${JSON.stringify(details)}`
        : '';
    return `[#${session} ${time}] ${decision} — ${reason}${detailSuffix}`;
}

function appendGalleryLoadLogEntry(session, decision, reason, details) {
    const entry = {
        session,
        ts: Date.now(),
        decision,
        reason,
        details
    };
    galleryLoadLogBuffer.push(entry);
    while (galleryLoadLogBuffer.length > GALLERY_LOAD_LOG_MAX_ENTRIES) {
        galleryLoadLogBuffer.shift();
    }
    // logViewerApplet — public/scripts/comp/logViewerApplet.js (on-open via featureLoader)
    if (typeof logViewerApplet !== 'undefined' && logViewerApplet && logViewerApplet.isClientGalleryLogSourceActive()) {
        logViewerApplet.onGalleryLoadLogEntry(entry);
    }
}

function clearGalleryLoadLogBuffer() {
    galleryLoadLogBuffer.length = 0;
    // logViewerApplet — public/scripts/comp/logViewerApplet.js (on-open via featureLoader)
    if (typeof logViewerApplet !== 'undefined' && logViewerApplet && logViewerApplet.isClientGalleryLogSourceActive()) {
        logViewerApplet.renderClientGalleryLogContent();
    }
}

function markGalleryLoadEventViewerEngaged() {
    galleryLoadLogViewerEngaged = true;
}

function shouldLogGalleryLoadForRequest() {
    galleryLoadLogRequestCount += 1;
    if (galleryLoadLogRequestCount === 1) {
        return true;
    }
    if (galleryLoadLogViewerEngaged) {
        return true;
    }
    clearGalleryLoadLogBuffer();
    return false;
}

function getGalleryLoadLogFormattedText() {
    if (!galleryLoadLogBuffer.length) {
        return 'No gallery load events yet.\n\nOpen this source before or during a gallery load to keep capturing decisions.\nLogging is enabled for the first gallery request by default; after that, open Periscope to continue debugging.';
    }
    return galleryLoadLogBuffer
        .map((entry) => formatGalleryLoadLogLine(entry.session, entry.decision, entry.reason, entry.details, entry.ts))
        .join('\n');
}

function acquireGalleryLoadLogger(viewType, workspaceId) {
    if (!shouldLogGalleryLoadForRequest()) {
        return galleryLoadLogNoop;
    }
    return createGalleryLoadLogger(viewType, workspaceId);
}

function createGalleryLoadLogger(viewType, workspaceId) {
    const session = ++galleryLoadLogSession;
    const prefix = `📸 Gallery load [#${session}]`;
    const writeConsole = galleryLoadLogViewerEngaged;
    return {
        session,
        step(decision, reason, details) {
            appendGalleryLoadLogEntry(session, decision, reason, details);
            if (writeConsole) {
                if (details !== undefined) {
                    console.log(`${prefix} ${decision} — ${reason}`, details);
                } else {
                    console.log(`${prefix} ${decision} — ${reason}`);
                }
            }
        },
        done(outcome, details) {
            appendGalleryLoadLogEntry(session, 'complete', outcome, details);
            if (writeConsole) {
                if (details !== undefined) {
                    console.log(`${prefix} complete — ${outcome}`, details);
                } else {
                    console.log(`${prefix} complete — ${outcome}`);
                }
            }
        }
    };
}

window.galleryLoadLogApi = {
    clientSourceId: GALLERY_LOAD_LOG_CLIENT_SOURCE_ID,
    markEventViewerEngaged: markGalleryLoadEventViewerEngaged,
    clearBuffer: clearGalleryLoadLogBuffer,
    getFormattedText: getGalleryLoadLogFormattedText,
    getEntryCount: () => galleryLoadLogBuffer.length,
    isViewerEngaged: () => galleryLoadLogViewerEngaged
};

function galleryLoadProbeSummary(probe) {
    if (!probe) {
        return null;
    }
    return {
        total: probe.total || 0,
        pinCount: Array.isArray(probe.pinnedIndexes) ? probe.pinnedIndexes.length : 0,
        workspaceId: probe.workspaceId || null,
        destructiveAt: probe.lastGalleryDestructiveAt || 0,
        updatedAt: probe.lastGalleryUpdatedAt || 0,
        latestFilename: probe.latestFilename || null
    };
}

function allGalleryBlockOffsets(total) {
    const offsets = [];
    for (let o = 0; o < total; o += GALLERY_CHUNK_SIZE) {
        offsets.push(o);
    }
    return offsets;
}

function planGalleryBlockFetch(total, loadLog = galleryLoadLogNoop) {
    loadLog.step('plan-server-only', 'Fetching all gallery blocks from server', {
        serverTotal: Number(total) || 0
    });
    return { action: 'full', offsets: allGalleryBlockOffsets(total), blockByOffset: new Map() };
}

/** Push progress to in-flight joiners, the load modal/toast, and an optional caller callback. */
function publishGalleryLoadProgress(progress, progressCallback = null) {
    publishGalleryImagesLoadProgress(progress);
    updateGalleryLoadingProgress(progress);
    if (progressCallback) {
        try {
            progressCallback(progress);
        } catch (e) {
            console.error('Gallery load progress callback error:', e);
        }
    }
}

/** Yield so the progress modal/toast can paint between block fetches. */
function yieldGalleryProgressPaint() {
    return new Promise((resolve) => {
        requestAnimationFrame(() => {
            requestAnimationFrame(resolve);
        });
    });
}

function reportGalleryBlockProgress(progressCallback, blockIndex, totalBlocks, totalItems) {
    if (totalBlocks <= 0) {
        return;
    }
    const blocksDone = blockIndex < 0 ? 0 : blockIndex + 1;
    const blocksLeft = Math.max(0, totalBlocks - blocksDone);
    publishGalleryLoadProgress({
        loaded: blocksDone,
        total: totalBlocks,
        totalItems: totalItems || 0,
        offset: blockIndex < 0 ? 0 : blockIndex * GALLERY_CHUNK_SIZE,
        chunkSize: GALLERY_CHUNK_SIZE,
        progress: totalBlocks > 0 ? Math.min(1, blocksDone / totalBlocks) : 0,
        phase: 'block_fetch',
        blocksLeft,
        blockIndex: blockIndex < 0 ? 0 : blockIndex,
        totalBlocks
    }, progressCallback);
}

function emitGalleryCacheValidProgress(progressCallback, total) {
    publishGalleryLoadProgress({
        loaded: total || 0,
        total: total || 0,
        offset: total || 0,
        progress: 1,
        phase: 'cache_valid',
        blocksLeft: 0
    }, progressCallback);
}

function beginGalleryBlockFetchSession() {
    if (window.wsClient) {
        window.wsClient.isGalleryLoadingActive = true;
    }
}

function endGalleryBlockFetchSession() {
    if (window.wsClient && typeof window.wsClient.completeGalleryLoading === 'function') {
        window.wsClient.completeGalleryLoading();
    }
}

async function finalizeGalleryImagesLoad(dataItems, probe, workspaceId, viewType, serverDestructiveAt, loadLog = galleryLoadLogNoop, loadToken = null) {
    if (!isGalleryLoadTokenCurrent(loadToken)) {
        loadLog.step('stale-discard', 'Discarded stale gallery load before apply', { viewType });
        return;
    }
    const pinnedIndexes = Array.isArray(probe.pinnedIndexes) ? probe.pinnedIndexes : [];
    loadLog.step('finalize', 'Applying pinned overlay after gallery data is complete', {
        itemCount: dataItems.length,
        pinCount: pinnedIndexes.length
    });
    applyPinnedIndexesOverlay(dataItems, pinnedIndexes);
    const slimItems = slimGalleryList(dataItems);
    setActiveGalleryList(slimItems, { preserveSyncState: true });
    markGalleryImagesSyncState(
        workspaceId,
        viewType,
        slimItems.length,
        pinnedIndexes,
        serverDestructiveAt,
        probe.lastGalleryUpdatedAt,
        probe.latestFilename || (slimItems[0] && (slimItems[0].original || slimItems[0].filename || slimItems[0].upscaled)) || null
    );
}

async function probeGalleryState(viewType, workspaceId, loadLog = galleryLoadLogNoop) {
    let probe = await loadGalleryChunk(viewType, 0, 0);
    if (probe.workspaceId && probe.workspaceId !== workspaceId) {
        loadLog.step('workspace-sync', 'Server workspace differed from client; re-probing after sync', {
            clientWorkspaceId: workspaceId,
            serverWorkspaceId: probe.workspaceId
        });
        await window.wsClient.setActiveWorkspace(workspaceId);
        probe = await loadGalleryChunk(viewType, 0, 0);
    }
    loadLog.step('probe', 'Gallery meta probe received from server', galleryLoadProbeSummary(probe));
    return probe;
}

function canUseSessionGalleryMemory(workspaceId, viewType = 'images', probe = null) {
    if (!galleryImagesSyncState
        || galleryImagesSyncState.workspaceId !== (workspaceId || 'default')
        || galleryImagesSyncState.viewType !== viewType
        || !allImages
        || allImages.length === 0
        || allImages.length !== galleryImagesSyncState.total) {
        return false;
    }
    if (probe) {
        return gallerySessionMatchesProbe(probe);
    }
    // Same-session reload: trust in-memory gallery when sync state is stamped.
    return galleryImagesSyncState.total > 0;
}

function shouldSkipGallerySortAfterSnapshotLoad() {
    return gallerySortOrder === 'desc' && !isNarrowGallerySearchActive();
}

async function fetchGalleryBlocksInto(viewType, workspaceId, totalItems, probe, dataItems, progressCallback, loadLog = galleryLoadLogNoop, loadToken = null, offsetsToFetch = null) {
    dataItems.length = 0;
    if (!totalItems || !probe) {
        return dataItems;
    }

    const offsets = offsetsToFetch && offsetsToFetch.length
        ? offsetsToFetch.slice()
        : planGalleryBlockFetch(totalItems, loadLog).offsets;
    const totalBlocks = offsets.length;
    const blockByOffset = new Map();

    loadLog.step('block-fetch', 'Fetching gallery blocks from server', {
        viewType,
        totalItems,
        blockCount: totalBlocks
    });

    beginGalleryBlockFetchSession();

    if (totalBlocks > 0) {
        reportGalleryBlockProgress(progressCallback, -1, totalBlocks, totalItems);
    }

    let afterCursor = null;

    try {
        for (let blockIndex = 0; blockIndex < offsets.length; blockIndex++) {
            const offset = offsets[blockIndex];
            await yieldGalleryProgressPaint();
            reportGalleryBlockProgress(progressCallback, blockIndex, totalBlocks, totalItems);

            const limit = Math.min(GALLERY_CHUNK_SIZE, totalItems - offset);
            const chunkOpts = { galleryBlockFetch: true };
            if (afterCursor) {
                chunkOpts.afterCursor = afterCursor;
            }
            const result = await loadGalleryChunk(viewType, offset, limit, chunkOpts);
            const chunk = result.chunk || [];
            if (!chunk.length) {
                loadLog.step('block-fetch-stall', 'Block fetch stopped: empty chunk returned', { offset, blockIndex });
                break;
            }

            const slimChunk = slimGalleryList(chunk);
            afterCursor = galleryChunkAfterCursor(slimChunk[slimChunk.length - 1]);
            if (offset === 0) {
                maybeRevealGalleryDuringBlockSync(slimChunk, probe, totalItems, loadToken, loadLog);
            }
            blockByOffset.set(offset, { offset, items: slimChunk });

            await yieldGalleryProgressPaint();
            reportGalleryBlockProgress(progressCallback, blockIndex, totalBlocks, totalItems);
        }

        for (const offset of allGalleryBlockOffsets(totalItems)) {
            const block = blockByOffset.get(offset);
            if (!block || !Array.isArray(block.items) || !block.items.length) {
                loadLog.step('block-fetch-stall', 'Block assembly stopped: missing block', { offset });
                break;
            }
            dataItems.push(...block.items);
        }
    } finally {
        endGalleryBlockFetchSession();
    }

    loadLog.step('block-fetch-done', 'Block fetch finished', {
        loaded: dataItems.length,
        expectedTotal: totalItems,
        blocksRequested: totalBlocks
    });
    return dataItems;
}

async function fetchAndFinalizeGalleryBlocks(viewType, workspaceId, totalItems, probe, serverDestructiveAt, progressCallback, loadLog, loadToken, offsetsToFetch = null) {
    const dataItems = [];
    await fetchGalleryBlocksInto(viewType, workspaceId, totalItems, probe, dataItems, progressCallback, loadLog, loadToken, offsetsToFetch);
    if (!isGalleryLoadTokenCurrent(loadToken)) {
        return false;
    }
    if (dataItems.length !== totalItems) {
        if (dataItems.length > 0) {
            await finalizeGalleryImagesLoad(
                dataItems,
                probe,
                workspaceId,
                viewType,
                serverDestructiveAt,
                loadLog,
                loadToken
            );
        }
        return false;
    }
    await finalizeGalleryImagesLoad(
        dataItems,
        probe,
        workspaceId,
        viewType,
        serverDestructiveAt,
        loadLog,
        loadToken
    );
    return true;
}

async function tryIncrementalGalleryHeadSync(cachedGallery, probe, viewType, progressCallback, loadLog = galleryLoadLogNoop) {
    const totalItems = probe.total;
    const cachedLen = cachedGallery.length;
    const delta = totalItems - cachedLen;
    if (delta <= 0 || !totalItems) {
        loadLog.step('incremental-skip', 'Skipped incremental head sync', {
            reason: delta <= 0 ? 'cached count is not smaller than server total' : 'server total is zero',
            cachedCount: cachedLen,
            serverTotal: totalItems
        });
        return null;
    }

    loadLog.step('incremental-try', 'Attempting incremental head sync (new items prepend)', {
        cachedCount: cachedLen,
        serverTotal: totalItems,
        newHeadCount: delta
    });

    const headItems = [];
    let offset = 0;
    while (headItems.length < delta) {
        const limit = Math.min(GALLERY_CHUNK_SIZE, delta - headItems.length);
        const result = await loadGalleryChunk(viewType, offset, limit, { galleryBlockFetch: true });
        const chunk = result.chunk || [];
        if (!chunk.length) {
            loadLog.step('incremental-abort', 'Incremental sync aborted: empty head chunk', {
                headLoaded: headItems.length,
                headNeeded: delta
            });
            return null;
        }
        headItems.push(...chunk);
        offset += chunk.length;
    }

    const overlapSize = Math.min(5, cachedLen);
    if (overlapSize > 0) {
        const boundaryResult = await loadGalleryChunk(viewType, delta, overlapSize, { galleryBlockFetch: true });
        const boundaryChunk = boundaryResult.chunk || [];
        if (!verifyGalleryOverlap(cachedGallery, boundaryChunk, Math.min(overlapSize, boundaryChunk.length))) {
            loadLog.step('incremental-abort', 'Incremental sync aborted: cached tail does not overlap server boundary', {
                overlapChecked: Math.min(overlapSize, boundaryChunk.length),
                boundaryOffset: delta
            });
            return null;
        }
        loadLog.step('incremental-overlap', 'Cached tail overlaps server boundary', {
            overlapChecked: Math.min(overlapSize, boundaryChunk.length),
            boundaryOffset: delta
        });
    }

    const dataItems = headItems.concat(cachedGallery);
    if (dataItems.length !== totalItems) {
        loadLog.step('incremental-abort', 'Incremental sync aborted: merged count mismatch', {
            mergedCount: dataItems.length,
            expectedTotal: totalItems
        });
        return null;
    }

    loadLog.step('incremental-ok', 'Incremental head sync succeeded', {
        headFetched: headItems.length,
        cachedReused: cachedLen,
        total: dataItems.length
    });
    return { dataItems, probe };
}

function resolveIncrementalSyncBaseGallery(workspaceId, viewType, totalItems, loadLog = galleryLoadLogNoop) {
    if (viewType === 'images'
        && currentGalleryView === 'images'
        && getGalleryLoadWorkspaceId() === workspaceId
        && allImages
        && allImages.length > 0
        && allImages.length < totalItems) {
        loadLog.step('incremental-memory', 'Using in-memory gallery as incremental sync base', {
            cachedCount: allImages.length,
            serverTotal: totalItems,
            newHeadCount: totalItems - allImages.length
        });
        return allImages;
    }
    return null;
}

function getGalleryPerformanceSnapshot() {
    return {
        allImages: allImages.length,
        visibleItems: visibleItems.size,
        placeholderQueue: placeholderResolutionQueue.length,
        displayedStartIndex,
        displayedEndIndex,
        loadingMore: isLoadingMore
    };
}
