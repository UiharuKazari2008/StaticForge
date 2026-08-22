// Gallery View and Infinite Scroll Module
// Contains all functions and variables related to gallery display and infinite scrolling

// Global variables for gallery and infinite scroll
// Infinite scroll variables
let imagesPerPage = 12;
// Gallery layout variables - will be calculated from actual rendered layout
let realGalleryColumns = 5;
let itemSizePx = 0;
let galleryRows = 5;
let debounceGalleryTimeout = null;
let isLoadingMore = false;
let hasMoreImages = true;
let hasMoreImagesBefore = false; // Track if there are images before current page
let visibleItems = new Set(); // Track visible gallery indices (data-index), not DOM positions
let virtualScrollEnabled = true; // Enable virtual scrolling
let currentImage = null;
let savedGalleryPosition = null;
let galleryClearTimeout = null;
let cachedGalleryWindowEl = null;
let cachedGalleryContainerEl = null;
let galleryScrollRaf = 0;
// Per scroll/rAF pass: strip Y math from one calibration (see measureGalleryStripGeometry)
let galleryStripGeometryPass = null;

// Cached #galleryWindow / .gallery-container; re-query when disconnected
function getGalleryScrollRoots() {
    if (!cachedGalleryWindowEl || !cachedGalleryWindowEl.isConnected) {
        cachedGalleryWindowEl = document.getElementById('galleryWindow');
        cachedGalleryContainerEl = null;
    }
    if (cachedGalleryWindowEl && (!cachedGalleryContainerEl || !cachedGalleryContainerEl.isConnected)) {
        cachedGalleryContainerEl = cachedGalleryWindowEl.querySelector('.gallery-container');
    }
    const galleryWindow = cachedGalleryWindowEl;
    const galleryContainer = cachedGalleryContainerEl;
    return {
        galleryWindow,
        galleryContainer,
        isContainerScroll: !!(galleryContainer && document.body.classList.contains('desktop-mode'))
    };
}

/** Viewport bounds in scroll space + one containerRect for the pass. */
function getGalleryViewportBounds(roots) {
    const { galleryContainer, isContainerScroll } = roots || getGalleryScrollRoots();
    if (isContainerScroll && galleryContainer) {
        const viewportTop = galleryContainer.scrollTop;
        return {
            viewportTop,
            viewportBottom: viewportTop + galleryContainer.clientHeight,
            pageY: 0,
            containerRect: galleryContainer.getBoundingClientRect()
        };
    }
    const trueInsetTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--true-inset-top')) || 0;
    const pageY = window.pageYOffset || document.documentElement.scrollTop;
    const viewportTop = pageY + trueInsetTop;
    return {
        viewportTop,
        viewportBottom: viewportTop + (window.innerHeight - trueInsetTop),
        pageY,
        containerRect: null
    };
}

/**
 * Calibrate strip geometry once (first cell + optional second-row stride).
 * .gallery uses CSS grid with gap:0 — DOM order drives rows, not data-index.
 * Returns null when unsafe; callers fall back to getBoundingClientRect.
 */
function measureGalleryStripGeometry(items, viewport, roots) {
    const columns = realGalleryColumns || 0;
    if (!columns || !items || items.length === 0 || !viewport) return null;

    const firstRect = items[0].getBoundingClientRect();
    let itemHeight = firstRect.height;
    if (!(itemHeight > 0) && itemSizePx > 0) itemHeight = itemSizePx;
    if (!(itemHeight > 0)) return null;

    const { galleryContainer, isContainerScroll } = roots || getGalleryScrollRoots();
    let firstTop;
    if (isContainerScroll && galleryContainer && viewport.containerRect) {
        firstTop = firstRect.top - viewport.containerRect.top + galleryContainer.scrollTop;
    } else {
        firstTop = firstRect.top + viewport.pageY;
    }

    // Refine stride from the first cell of the next row when present
    if (items.length > columns) {
        const secondRect = items[columns].getBoundingClientRect();
        let secondTop;
        if (isContainerScroll && galleryContainer && viewport.containerRect) {
            secondTop = secondRect.top - viewport.containerRect.top + galleryContainer.scrollTop;
        } else {
            secondTop = secondRect.top + viewport.pageY;
        }
        const stride = secondTop - firstTop;
        if (stride > 1) {
            itemHeight = stride;
        }
    }

    return { firstTop, itemHeight, columns };
}

function galleryItemScrollBoundsFromDomIndex(domIndex, geometry) {
    if (!geometry || domIndex < 0) return null;
    const row = Math.floor(domIndex / geometry.columns);
    const itemTop = geometry.firstTop + row * geometry.itemHeight;
    return { itemTop, itemBottom: itemTop + geometry.itemHeight };
}

function galleryItemScrollBoundsFromRect(item, roots, viewport) {
    const rect = item.getBoundingClientRect();
    const { galleryContainer, isContainerScroll } = roots;
    if (isContainerScroll && galleryContainer && viewport.containerRect) {
        return {
            itemTop: rect.top - viewport.containerRect.top + galleryContainer.scrollTop,
            itemBottom: rect.bottom - viewport.containerRect.top + galleryContainer.scrollTop
        };
    }
    return {
        itemTop: rect.top + viewport.pageY,
        itemBottom: rect.bottom + viewport.pageY
    };
}

// Bidirectional infinite scroll tracking
let displayedStartIndex = 0; // First displayed image index in allImages array
let displayedEndIndex = 0;   // Last displayed image index in allImages array
let lastHintIndex = -1; // Track last sent hint index to avoid duplicate sends
let lastHintAnchorFilename = undefined;
let suppressGalleryPositionHintUntilInteraction = false;
let galleryPositionHintThrottle = null; // Throttle for position hints
const GALLERY_TIME_JUMP_THRESHOLD_MS = 30 * 60 * 1000; // 30 minutes default
const GALLERY_TIME_JUMP_MIN_THRESHOLD_MS = 5 * 60 * 1000; // 5 minutes hard floor
const GALLERY_TIME_JUMP_ADAPT_WINDOW_ITEMS = 100;
const GALLERY_TIME_JUMP_READY_WAIT_MS = 2200;
const GALLERY_TIME_JUMP_HIGHLIGHT_WAIT_MS = 3400;
const GALLERY_TIME_JUMP_RELEASE_DEBOUNCE_MS = 120;
const GALLERY_JUMP_INDEX_DEFAULT_MIN_TIME_MS = 30 * 60 * 1000;
const GALLERY_JUMP_INDEX_DEFAULT_MAX_GROUP_IMAGES = 100;
const GALLERY_JUMP_INDEX_MIN_GROUP_IMAGES = 9;
let galleryTimeJumpInFlight = false;
let galleryTimeJumpDebounceUntil = 0;
let galleryJumpIndexToolEl = null;
let galleryJumpIndexListEl = null;
let galleryJumpIndexSummaryEl = null;
let galleryJumpIndexMinTimeSelectedEl = null;
let galleryJumpIndexMaxGroupSelectedEl = null;
let galleryJumpIndexRegenerating = false;
let galleryJumpIndexRegenPending = false;
let galleryJumpIndexEntries = [];
let galleryJumpIndexHoveredBoundaryIndex = null;
let galleryJumpIndexActiveBoundaryIndex = null;
let galleryJumpIndexDropdownsInitialized = false;
let galleryJumpIndexListenersInitialized = false;
let selectedGalleryJumpIndexMinTimeMs = GALLERY_JUMP_INDEX_DEFAULT_MIN_TIME_MS;
let selectedGalleryJumpIndexMaxGroupImages = GALLERY_JUMP_INDEX_DEFAULT_MAX_GROUP_IMAGES;
const GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS = [
    { value: 5 * 60 * 1000, name: '5m' },
    { value: 15 * 60 * 1000, name: '15m' },
    { value: 30 * 60 * 1000, name: '30m' },
    { value: 60 * 60 * 1000, name: '1h' },
    { value: 6 * 60 * 60 * 1000, name: '6h' },
    { value: 12 * 60 * 60 * 1000, name: '12h' },
    { value: 24 * 60 * 60 * 1000, name: '1d' },
    { value: 7 * 24 * 60 * 60 * 1000, name: '7d' },
    { value: 30 * 24 * 60 * 60 * 1000, name: '30d' }
];
const GALLERY_JUMP_INDEX_MAX_GROUP_OPTIONS = [
    { value: 25, name: '25' },
    { value: 50, name: '50' },
    { value: 100, name: '100' },
    { value: 200, name: '200' },
    { value: 400, name: '400' },
    { value: 'none', name: 'No max' }
];

// Improved infinite scroll configuration
let infiniteScrollConfig = {
    // Percentage-based triggers (more responsive to different screen sizes)
    bottomTriggerPercent: 0.15, // 15% from bottom
    topTriggerPercent: 0.15,    // 15% from top
    placeholderTriggerPercent: 0.25, // 25% for placeholder scheduling

    // Dynamic batch sizing based on viewport
    minBatchSize: 6,
    maxBatchSize: 24,

    // Performance optimization
    throttleDelay: 100, // ms between scroll checks
    debounceDelay: 300, // ms after scroll stops

    // Responsive adjustments - improved for mobile
    smallScreenThreshold: 768, // px
    smallScreenMultiplier: 0.8, // Increased from 0.5 to 0.8 for better mobile experience
};

// Selection state
let selectedImages = new Set();
let isAllSelected = false; // Flag to indicate all items are selected (for performance)
let isSelectionMode = false;
let lastSelectedGalleryIndex = null; // Track last selected index for range selection
let galleryBatchEscapePrevTs = 0;
let infiniteScrollLoading = document.getElementById('infiniteScrollLoading');

const galleryToggleGroup = document.getElementById('galleryToggleGroup');

// Gallery view switching progress modal
let galleryProgressModal = null;
let galleryProgressToastId = null;
let galleryProgressBarElement = null;
let galleryProgressTextElement = null;
let galleryProgressContainerElement = null;
let galleryProgressModeSwitched = false; // Track if we've switched from marquee to animate mode
let galleryCatchupBusyLineEl = null;

// In-flight full images gallery load (desktop background startup + open-while-loading)
let galleryImagesLoadTask = null;

// Last successful images sync for this session (avoids stale IndexedDB re-fetch when memory is current)
let galleryImagesSyncState = null;
let galleryRefreshNotificationId = null;

function markGalleryImagesSyncState(workspaceId, viewType, total, pinnedIndexes, destructiveAt) {
    if (!total) {
        return;
    }
    galleryImagesSyncState = {
        workspaceId: workspaceId || 'default',
        viewType: viewType || 'images',
        total,
        pinnedIndexes: Array.isArray(pinnedIndexes) ? pinnedIndexes.slice() : [],
        destructiveAt: Number(destructiveAt) || 0
    };
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
    return !galleryDestructiveTimestampInvalidatesCache(probe.lastGalleryDestructiveAt, galleryImagesSyncState);
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
        destructiveAt: probe.lastGalleryDestructiveAt || 0
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
        serverDestructiveAt
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

// IndexedDB utilities for per-image metadata / thumbnails (not gallery list cache)
class GalleryMetadataCache {
    constructor() {
        this.dbName = 'StaticForgeGallery';
        this.version = 7;
        this.db = null;
        this.snapshotCleanupDone = false;
        this.initPromise = this.initDB();
    }

    _openDatabase() {
        const openAttempt = new Promise((resolve, reject) => {
            if (!('indexedDB' in window)) {
                reject(new Error('IndexedDB not supported'));
                return;
            }

            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                reject(request.error || new Error('IndexedDB open failed'));
            };

            request.onblocked = () => {
                reject(new Error('IndexedDB open blocked'));
            };

            request.onsuccess = (event) => {
                resolve(event.target.result);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;
                // Drop abandoned gallery list cache stores from earlier revisions
                for (const storeName of ['gallerySnapshots', 'galleryMeta', 'galleryBlocks', 'galleryPins']) {
                    if (db.objectStoreNames.contains(storeName)) {
                        db.deleteObjectStore(storeName);
                    }
                }

                let metadataStore;
                if (!db.objectStoreNames.contains('metadata')) {
                    metadataStore = db.createObjectStore('metadata', { keyPath: 'base' });
                    metadataStore.createIndex('mtime', 'mtime', { unique: false });
                } else {
                    metadataStore = event.target.transaction.objectStore('metadata');
                }
                if (!metadataStore.indexNames.contains('cachedAt')) {
                    metadataStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                }

                let thumbnailStore;
                if (!db.objectStoreNames.contains('thumbnails')) {
                    thumbnailStore = db.createObjectStore('thumbnails', { keyPath: 'base' });
                } else {
                    thumbnailStore = event.target.transaction.objectStore('thumbnails');
                }
                if (!thumbnailStore.indexNames.contains('cachedAt')) {
                    thumbnailStore.createIndex('cachedAt', 'cachedAt', { unique: false });
                }
            };
        });

        const timeoutMs = 15000;
        return Promise.race([
            openAttempt,
            new Promise((_, reject) => {
                setTimeout(() => reject(new Error(`IndexedDB open timed out after ${timeoutMs}ms`)), timeoutMs);
            })
        ]);
    }

    async eraseDatabase() {
        if (this.db) {
            try {
                this.db.close();
            } catch (e) { /* ignore */ }
            this.db = null;
        }
        if (!('indexedDB' in window)) {
            return false;
        }

        await new Promise((resolve) => {
            const deleteReq = indexedDB.deleteDatabase(this.dbName);
            const timeout = setTimeout(resolve, 5000);
            const finish = () => {
                clearTimeout(timeout);
                resolve();
            };
            deleteReq.onsuccess = finish;
            deleteReq.onerror = finish;
            deleteReq.onblocked = finish;
        });

        this.snapshotCleanupDone = false;
        return true;
    }

    async initDB(isRetry = false) {
        try {
            const db = await this._openDatabase();
            this.db = db;
            db.onclose = () => {
                if (this.db === db) {
                    this.db = null;
                }
            };

            if (!this.snapshotCleanupDone) {
                this.snapshotCleanupDone = true;
                void Promise.resolve()
                    .then(() => this.runMaintenance())
                    .catch((err) => console.warn('Gallery IndexedDB maintenance failed:', err));
            }

            return this.db;
        } catch (error) {
            console.warn('Gallery IndexedDB failed to open; erasing corrupt database:', error);
            await this.eraseDatabase();
            if (!isRetry) {
                return this.initDB(true);
            }
            console.warn('Gallery IndexedDB unavailable after erase; memory-only metadata cache');
            this.db = null;
            return null;
        }
    }

    async getMetadata(base) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['metadata'], 'readonly');
            const store = transaction.objectStore('metadata');
            const request = store.get(base);

            request.onsuccess = () => resolve(request.result || null);
            request.onerror = () => resolve(null);
        });
    }

    async setMetadata(base, metadata) {
        if (!this.db) return;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const request = store.put({ base, ...metadata, cachedAt: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

    async getThumbnail(base) {
        if (!this.db) return null;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['thumbnails'], 'readonly');
            const store = transaction.objectStore('thumbnails');
            const request = store.get(base);

            request.onsuccess = () => resolve(request.result?.data || null);
            request.onerror = () => resolve(null);
        });
    }

    async setThumbnail(base, thumbnailData) {
        if (!this.db) return;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['thumbnails'], 'readwrite');
            const store = transaction.objectStore('thumbnails');
            const request = store.put({ base, data: thumbnailData, cachedAt: Date.now() });

            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

    async clearOldEntries(maxAge = 7 * 24 * 60 * 60 * 1000) {
        if (!this.db) return;
        const cutoff = Date.now() - maxAge;

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const index = store.index('cachedAt');
            const range = IDBKeyRange.upperBound(cutoff);
            const request = index.openCursor(range);

            let deleted = 0;
            request.onsuccess = (event) => {
                const cursor = event.target.result;
                if (cursor) {
                    cursor.delete();
                    deleted++;
                    cursor.continue();
                } else {
                    if (deleted > 0) {
                        console.log(`🧹 Cleaned up ${deleted} old gallery metadata entries`);
                    }
                    resolve();
                }
            };
            request.onerror = () => resolve();
        });
    }

    async clearOldThumbnails(maxAge = 7 * 24 * 60 * 60 * 1000, maxEntries = 2000) {
        if (!this.db) return;
        const cutoff = Date.now() - maxAge;
        return new Promise((resolve) => {
            const transaction = this.db.transaction(['thumbnails'], 'readwrite');
            const store = transaction.objectStore('thumbnails');
            let remaining = 0;
            let deleted = 0;

            const countRequest = store.count();
            countRequest.onsuccess = () => {
                remaining = countRequest.result || 0;
                const request = store.openCursor();
                request.onsuccess = (event) => {
                    const cursor = event.target.result;
                    if (!cursor) return;
                    const cachedAt = Number(cursor.value?.cachedAt) || 0;
                    if (cachedAt < cutoff || remaining > maxEntries) {
                        cursor.delete();
                        remaining--;
                        deleted++;
                    }
                    cursor.continue();
                };
            };
            transaction.oncomplete = () => {
                if (deleted > 0) {
                    console.log(`🧹 Cleaned up ${deleted} old gallery thumbnail entries`);
                }
                resolve();
            };
            transaction.onerror = () => resolve();
            transaction.onabort = () => resolve();
        });
    }

    async runMaintenance() {
        await this.clearOldEntries();
        await this.clearOldThumbnails();
    }
}

/** Strip embedded metadata blobs from gallery index rows — list fields only. */
function slimGalleryListItem(item) {
    if (!item || typeof item !== 'object') {
        return item;
    }
    const filename = item.filename || item.upscaled || item.original || null;
    const slim = {
        base: item.base,
        original: item.original,
        upscaled: item.upscaled,
        preview: item.preview,
        blurhash: item.blurhash || null,
        mtime: item.mtime,
        width: item.width,
        height: item.height,
        size: item.size,
        isLarge: item.isLarge,
        isPinned: item.isPinned,
        filename,
        storage: item.storage || 'local',
        hasFullImage: item.hasFullImage !== false,
        hasMetadata: item.hasMetadata !== false,
        reachable: item.reachable !== false
    };
    if (slim.preview == null && slim.base) {
        slim.preview = `${slim.base}.webp`;
    }
    return slim;
}

function slimGalleryList(gallery) {
    if (!Array.isArray(gallery)) {
        return [];
    }
    return gallery.map(slimGalleryListItem);
}

// Global gallery metadata cache instance
const galleryMetadataCache = new GalleryMetadataCache();

function getGalleryItemStructureKey(item) {
    if (!item) {
        return '';
    }
    const base = item.base || '';
    const original = item.original || '';
    const upscaled = item.upscaled || '';
    const mtime = item.mtime || 0;
    return `${base}|${original}|${upscaled}|${mtime}`;
}

function verifyGalleryOverlap(cachedGallery, serverChunk, count) {
    if (!cachedGallery || !serverChunk || count <= 0) {
        return true;
    }
    for (let i = 0; i < count; i++) {
        if (getGalleryItemStructureKey(cachedGallery[i]) !== getGalleryItemStructureKey(serverChunk[i])) {
            return false;
        }
    }
    return true;
}

// Gallery view state
let currentGalleryView = 'images'; // 'images', 'scraps', 'pinned', 'upscaled'

// Gallery sort order state
let gallerySortOrder = 'desc'; // 'desc' for newest first, 'asc' for oldest first

// Placeholder management
let deferredPlaceholderTimeout = null;
let pendingPlaceholderAdditions = {
    above: false,
    below: false
};

// Placeholder resolution queue and watcher
let placeholderResolutionQueue = [];
let placeholderWatcherRunning = false;
let placeholderWatcherFrameId = null;
let placeholderQueueSizeHistory = []; // Track queue size over time for rapid detection
let lastQueueCheckTime = Date.now();
let placeholderResolutionDelay = 0; // Adaptive delay between resolutions (in frames)
let placeholderResolutionFrameCount = 0; // Frame counter for adaptive delay

let lastObserverResolutionTime = 0; // Track last observer resolution time for throttling
let observerResolutionThrottleMs = 16; // Throttle observer resolutions to ~60fps

// RTT-based multiplexing control
let lastRttCheckTime = 0; // Timestamp of last RTT measurement
let activeResolutions = 0; // Currently active image loading operations
let currentMultiplexingLevel = 1; // Current multiplexing level for callbacks
let maxTotalConcurrent = 15; // Maximum total concurrent resolutions

// Scroll position preservation for upward scrolling
let scrollPositionPreservationEnabled = false;
let lastScrollTop = 0;
let lastVisibleItemIndex = -1;

// Global images array (shared with main app)
let allImages = [];

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

// Track current visible index for title bar
let currentVisibleIndex = 0;

// Helper function to find the true index of an image in the original array
function findTrueImageIndex(image) {
    const filename = image.filename || image.original || image.upscaled;
    if (!filename) return -1;

    // If we have filtered results, use the original array
    if (window.originalAllImages && window.originalAllImages.length > 0) {
        return window.originalAllImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }

    // Otherwise, use the current allImages array
    return allImages.findIndex(img => {
        const imgFilename = img.filename || img.original || img.upscaled;
        return imgFilename === filename;
    });
}

// Filename-based alias for callers that only have a filename string (extracted from app.js)
function findTrueImageIndexInGallery(filename) {
    if (!filename) return -1;

    if (window.originalAllImages && window.originalAllImages.length > 0) {
        return window.originalAllImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }

    if (allImages && Array.isArray(allImages)) {
        return allImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }

    return -1;
}

// Helper function to find an image object by filename (exposed globally for use by app.js)
function findImageByFilename(filename) {
    if (!filename) return null;

    // If we have filtered results, search in the original array
    if (window.originalAllImages && window.originalAllImages.length > 0) {
        const found = window.originalAllImages.find(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
        if (found) return found;
    }

    // Otherwise, search in the current allImages array
    return allImages.find(img => {
        const imgFilename = img.filename || img.original || img.upscaled;
        return imgFilename === filename;
    });
};

// Preserve scroll position when adding placeholders above
function preserveScrollPosition() {
    if (!scrollPositionPreservationEnabled) return;

    // Find the first visible item to use as an anchor
    const visibleItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    let anchorItem = null;
    let anchorIndex = -1;

    for (const item of visibleItems) {
        const rect = item.getBoundingClientRect();
        if (rect.top >= 0 && rect.bottom <= window.innerHeight) {
            anchorItem = item;
            anchorIndex = parseInt(item.dataset.index || '0');
            break;
        }
    }

    // If no visible item found, use the first item in viewport
    if (!anchorItem) {
        for (const item of visibleItems) {
            const rect = item.getBoundingClientRect();
            if (rect.bottom > 0 && rect.top < window.innerHeight) {
                anchorItem = item;
                anchorIndex = parseInt(item.dataset.index || '0');
                break;
            }
        }
    }

    if (anchorItem && anchorIndex !== -1) {
        lastVisibleItemIndex = anchorIndex;
        lastScrollTop = window.pageYOffset;
    }

    // For iOS, store additional scroll context
    if (isIOS) {
        // Store the current scroll velocity to predict momentum
        const now = Date.now();
        if (lastScrollTime > 0) {
            const timeDelta = now - lastScrollTime;
            const scrollDelta = window.pageYOffset - lastScrollTop;
            scrollVelocity = scrollDelta / timeDelta;
        }
    }
}

// Restore scroll position after adding placeholders above
function restoreScrollPosition() {
    if (!scrollPositionPreservationEnabled || lastVisibleItemIndex === -1) return;

    // Find the anchor item by its index
    const anchorItem = gallery.querySelector(`[data-index="${lastVisibleItemIndex}"]`);
    if (anchorItem) {
        const rect = anchorItem.getBoundingClientRect();
        const targetScrollTop = window.pageYOffset + rect.top - 100; // 100px offset from top

        // For iOS, use instant positioning to prevent momentum issues
        const scrollBehavior = isIOS ? 'instant' : 'auto';

        window.scrollTo({
            top: targetScrollTop,
            behavior: scrollBehavior
        });
    }

    // Reset preservation state
    scrollPositionPreservationEnabled = false;
    lastVisibleItemIndex = -1;
}

// Placeholder resolution watcher - processes queued placeholders with RTT-based multiplexing
function startPlaceholderWatcher() {
    if (placeholderWatcherRunning) return;
    placeholderWatcherRunning = true;

    placeholderWatcherFrameId = setTimeout(processNextPlaceholders, 0);
}

// Process queued placeholders with RTT-based multiplexing
function processNextPlaceholders() {
    try {
    if (placeholderResolutionQueue.length === 0) {
        placeholderWatcherRunning = false;
        placeholderWatcherFrameId = null;
        placeholderResolutionDelay = 0;
        placeholderResolutionFrameCount = 0;
        placeholderQueueSizeHistory = [];
        return;
    }

    // Pause bulk resolution when actively scrolling fast; still resolve a few in-view placeholders
    // so visible rows never stay empty while off-screen rows keep changing.
    if (isScrolling && Math.abs(scrollVelocity) > 1.2) {
        const resolveVisibleNow = () => {
            const { galleryContainer, isContainerScroll } = getGalleryScrollRoots();
            const viewportTop = isContainerScroll && galleryContainer ? galleryContainer.scrollTop : (window.pageYOffset || document.documentElement.scrollTop || 0);
            const viewportBottom = viewportTop + (isContainerScroll && galleryContainer ? galleryContainer.clientHeight : window.innerHeight);
            const maxImmediate = 4;
            let resolved = 0;
            const placeholders = gallery ? gallery.querySelectorAll('.gallery-item.gallery-placeholder') : [];
            const containerRect = isContainerScroll && galleryContainer ? galleryContainer.getBoundingClientRect() : null;
            for (let i = 0; i < placeholders.length && resolved < maxImmediate; i++) {
                const el = placeholders[i];
                const rect = el.getBoundingClientRect();
                let itemTop;
                let itemBottom;
                if (isContainerScroll && galleryContainer && containerRect) {
                    itemTop = rect.top - containerRect.top + galleryContainer.scrollTop;
                    itemBottom = rect.bottom - containerRect.top + galleryContainer.scrollTop;
                } else {
                    itemTop = rect.top + window.pageYOffset;
                    itemBottom = rect.bottom + window.pageYOffset;
                }
                if (itemBottom <= viewportTop || itemTop >= viewportBottom) continue;
                if (el.querySelector('img')) continue;
                const fileIndex = parseInt(el.dataset.fileIndex, 10);
                const image = allImages && Number.isFinite(fileIndex) ? allImages[fileIndex] : null;
                if (!image) continue;
                el.classList.remove('gallery-placeholder');
                addImgToGalleryItemAsync(el, image);
                resolved++;
            }
        };
        resolveVisibleNow();
        placeholderWatcherFrameId = setTimeout(processNextPlaceholders, 100);
        return;
    }

    // Track queue growth for rapid scrolling detection
    const now = Date.now();
    if (now - lastQueueCheckTime > 100) { // Check every 100ms
        placeholderQueueSizeHistory.push({
            size: placeholderResolutionQueue.length,
            time: now
        });
        // Keep only last 5 measurements (500ms window)
        if (placeholderQueueSizeHistory.length > 5) {
            placeholderQueueSizeHistory.shift();
        }
        lastQueueCheckTime = now;
    }

    // Detect rapid placeholder addition (queue growing faster than we can resolve)
    let queueGrowthRate = 0;
    if (placeholderQueueSizeHistory.length >= 2) {
        const oldest = placeholderQueueSizeHistory[0];
        const newest = placeholderQueueSizeHistory[placeholderQueueSizeHistory.length - 1];
        const timeDelta = newest.time - oldest.time;
        const sizeDelta = newest.size - oldest.size;
        if (timeDelta > 0) {
            queueGrowthRate = sizeDelta / timeDelta; // items per ms
        }
    }

    // Get multiplexing level based on RTT
    const multiplexingLevel = calculateMultiplexingLevel();

    // Calculate adaptive resolution delay based on queue size and multiplexing
    const queueSize = placeholderResolutionQueue.length;
    const isRapidScrolling = Math.abs(scrollVelocity) > 3;
    const isVeryFastScrolling = Math.abs(scrollVelocity) > 6;

    // Increase delay when queue is growing rapidly or during fast scrolling (more aggressive)
    if (queueGrowthRate > 0.05 || queueSize > 30) { // Reduced thresholds
        // Queue growing faster than 0.05 items/ms or queue size > 30
        placeholderResolutionDelay = Math.min(3, Math.floor(queueSize / 15)); // Reduced max delay, increased divisor
    } else if (isVeryFastScrolling) {
        placeholderResolutionDelay = 2; // Reduced delay during very fast scrolling
    } else if (isRapidScrolling || queueSize > 10) { // Reduced threshold
        placeholderResolutionDelay = 1; // Reduced delay during rapid scrolling or large queue
    } else {
        placeholderResolutionDelay = 0; // No delay for small queue
    }

    // Apply adaptive delay
    placeholderResolutionFrameCount++;
    if (placeholderResolutionFrameCount <= placeholderResolutionDelay) {
        placeholderWatcherFrameId = setTimeout(processNextPlaceholders, 0);
        return;
    }
    placeholderResolutionFrameCount = 0;

    // Get viewport bounds for visibility checking
    const viewportTop = window.pageYOffset;
    const viewportBottom = viewportTop + window.innerHeight;
    const bufferRows = isVeryFastScrolling ? 3 : (isRapidScrolling ? 5 : 8);

    // Calculate viewport buffer based on actual item dimensions
    // Try to get a sample item height, or use viewport height as fallback
    let itemHeight = window.innerHeight / 5; // Rough estimate: ~5 items visible
    const sampleItem = gallery.querySelector('.gallery-item, .gallery-placeholder');
    if (sampleItem) {
        const sampleRect = sampleItem.getBoundingClientRect();
        if (sampleRect.height > 0) {
            itemHeight = sampleRect.height;
        }
    }
    const viewportBuffer = bufferRows * itemHeight; // Pixel buffer based on buffer rows

    // Start complete batches of image loads based on multiplexing level
    let droppedCount = 0;
    const maxDropsPerCycle = isVeryFastScrolling ? 10 : (isRapidScrolling ? 5 : 3);

    // Check if we can start a new batch (don't exceed total concurrent limit)
    const availableSlots = maxTotalConcurrent - activeResolutions;
    if (availableSlots < currentMultiplexingLevel) {
        // Not enough slots for a full batch, wait for some to complete
        placeholderWatcherFrameId = setTimeout(processNextPlaceholders, 0);
        return;
    }

    const batchSize = currentMultiplexingLevel;
    const itemsToStart = Math.min(batchSize, placeholderResolutionQueue.length);

    if (itemsToStart === 0) {
        // No items to process
        if (activeResolutions > 0) {
            placeholderWatcherFrameId = setTimeout(processNextPlaceholders, 0);
        }
        return;
    }

    // Prioritize placeholders: always resolve in-viewport first, then apply direction preference.
    if (Math.abs(scrollVelocity) > 0.5) {
        const viewportCenter = viewportTop + (window.innerHeight / 2);
        const viewportPad = itemHeight * 0.5;
        const pageY = window.pageYOffset;
        // Precompute geometry once — never call getBoundingClientRect inside the comparator
        const metrics = new Map();
        for (let qi = 0; qi < placeholderResolutionQueue.length; qi++) {
            const entry = placeholderResolutionQueue[qi];
            if (!entry.element) {
                metrics.set(entry, { top: Infinity, center: Infinity, inViewport: false });
                continue;
            }
            const rect = entry.element.getBoundingClientRect();
            const top = rect.top + pageY;
            const bottom = rect.bottom + pageY;
            metrics.set(entry, {
                top,
                center: (top + bottom) * 0.5,
                inViewport: bottom > (viewportTop - viewportPad) && top < (viewportBottom + viewportPad)
            });
        }

        placeholderResolutionQueue.sort((a, b) => {
            const am = metrics.get(a);
            const bm = metrics.get(b);
            if (!am || !bm) return 0;

            if (am.inViewport !== bm.inViewport) return am.inViewport ? -1 : 1;

            const aDist = Math.abs(am.center - viewportCenter);
            const bDist = Math.abs(bm.center - viewportCenter);
            if (aDist !== bDist) return aDist - bDist;

            if (scrollVelocity > 0) {
                const aIsBelow = am.top > viewportCenter;
                const bIsBelow = bm.top > viewportCenter;
                if (aIsBelow && !bIsBelow) return -1;
                if (bIsBelow && !aIsBelow) return 1;
                return 0;
            }
            const aIsAbove = am.top < viewportCenter;
            const bIsAbove = bm.top < viewportCenter;
            if (aIsAbove && !bIsAbove) return -1;
            if (bIsAbove && !aIsAbove) return 1;
            return 0;
        });
    }

    // Start a complete batch simultaneously
    for (let i = 0; i < itemsToStart && droppedCount < maxDropsPerCycle; i++) {
        const placeholderData = placeholderResolutionQueue.shift();

        // Check if element still exists and is still a placeholder
        if (!placeholderData.element || !placeholderData.element?.parentNode || !placeholderData.element?.classList?.contains('gallery-placeholder')) {
            // Element was removed or already resolved (no placeholder class), skip it
            continue;
        }

        // Check if placeholder is near viewport
        const rect = placeholderData.element.getBoundingClientRect();
        const elementTop = rect.top + window.pageYOffset;
        const elementBottom = rect.bottom + window.pageYOffset;

        // Check if element is within viewport buffer
        const isNearViewport = (elementBottom > viewportTop - viewportBuffer) &&
            (elementTop < viewportBottom + viewportBuffer);

        if (!isNearViewport) {
            // Placeholder is far from viewport, drop it (will be re-queued if it comes back into view)
            droppedCount++;
            continue;
        }

        // Increment active resolutions counter
        activeResolutions++;

        // Resolve the placeholder - check bounds first
        if (placeholderData.fileImageIndex < 0 || placeholderData.fileImageIndex >= allImages.length) {
            // Invalid index - array was modified, remove this placeholder from queue and DOM
            if (placeholderData.element && placeholderData.element.parentNode) {
                disposeGalleryItemElement(placeholderData.element);
                placeholderData.element.remove();
            }
            continue;
        }

        const image = allImages[placeholderData.fileImageIndex];
        if (image) {
            // Verify the image matches the placeholder's expected filename
            const filename = image.filename || image.original || image.upscaled;
            const elementFilename = placeholderData.element.dataset.filename;

            // If filename doesn't match, the array was modified and this placeholder is stale
            if (elementFilename && filename !== elementFilename) {
                // Stale placeholder - remove it
                if (placeholderData.element && placeholderData.element.parentNode) {
                    disposeGalleryItemElement(placeholderData.element);
                    placeholderData.element.remove();
                }
                continue;
            }

            // All placeholders should be gallery-items with placeholder class
            // Just remove placeholder class and ensure img element exists
            if (placeholderData.element.classList.contains('gallery-item')) {
                placeholderData.element.classList.remove('gallery-placeholder');
                if (!placeholderData.element.querySelector('img')) {
                    const fileIndex = parseInt(placeholderData.element.dataset.fileIndex);
                    const image = allImages[fileIndex];
                    if (image) {
                        // Start async image loading with completion callback
                        addImgToGalleryItemAsync(placeholderData.element, image, () => {
                            // Decrement active counter when image load completes (success or failure)
                            activeResolutions = Math.max(0, activeResolutions - 1);

                            // Continue processing immediately if we can start another batch
                            const hasAvailableSlots = (maxTotalConcurrent - activeResolutions) >= currentMultiplexingLevel;
                            if (placeholderResolutionQueue.length > 0 && hasAvailableSlots && placeholderWatcherRunning) {
                                // Start next batch immediately (true multiplexing: 123, 123, 123...)
                                setTimeout(() => {
                                    if (placeholderWatcherRunning) {
                                        processNextPlaceholders();
                                    }
                                }, 0);
                            }
                        });
                    } else {
                        // No image data, decrement immediately
                        activeResolutions = Math.max(0, activeResolutions - 1);
                    }
                } else {
                    // Image already exists, decrement immediately
                    activeResolutions = Math.max(0, activeResolutions - 1);
                }
            } else {
                // Not a gallery item, decrement immediately
                activeResolutions = Math.max(0, activeResolutions - 1);
            }
        } else {
            // Image not found at this index - array was modified, remove placeholder
            if (placeholderData.element && placeholderData.element.parentNode) {
                disposeGalleryItemElement(placeholderData.element);
                placeholderData.element.remove();
            }
        }
    }

    // Continue processing complete batches immediately: 123, 123, 123...
    // True multiplexing - start next batch without waiting for current batch items to complete
    const hasAvailableSlots = (maxTotalConcurrent - activeResolutions) >= currentMultiplexingLevel;
    if (placeholderResolutionQueue.length > 0 && hasAvailableSlots && droppedCount < maxDropsPerCycle) {
        // Start next complete batch immediately
        placeholderWatcherFrameId = setTimeout(processNextPlaceholders, 0);
        return;
    }

    // If queue is empty but we have active resolutions, keep checking for completion
    if (activeResolutions > 0) {
        placeholderWatcherFrameId = setTimeout(processNextPlaceholders, 0);
    }
    } finally {
        updateGalleryCatchupBusyLine();
    }
}

// Add placeholder to resolution queue
function queuePlaceholderResolution(element, fileImageIndex, filteredIndex) {
    // Check if this element is already in the queue to prevent duplicates
    const alreadyQueued = placeholderResolutionQueue.some(
        item => item.element === element
    );

    if (alreadyQueued) return;

    // Calculate queue limit: viewport capacity + buffer, adjusted for multiplexing
    const multiplexingLevel = calculateMultiplexingLevel();
    const currentCapacity = galleryRows * realGalleryColumns;
    const queueLimit = currentCapacity + (multiplexingLevel * 12); // Larger buffer so fast scroll does not starve visible rows

    // Don't add to queue if we're already at capacity
    if (placeholderResolutionQueue.length >= queueLimit) return;

    placeholderResolutionQueue.push({ element, fileImageIndex, filteredIndex });
    if (!placeholderWatcherRunning) {
        startPlaceholderWatcher();
    }
    updateGalleryCatchupBusyLine();
}

function updateGalleryCatchupBusyLine() {
    const qLen = placeholderResolutionQueue.length;
    const cap = (galleryRows || 5) * (realGalleryColumns || 6);
    const busy = qLen > Math.max(12, Math.floor(cap * 0.45)) || activeResolutions > 10;
    const gw = document.getElementById('galleryWindow');
    if (!gw || gw.classList.contains('hidden')) {
        if (galleryCatchupBusyLineEl) galleryCatchupBusyLineEl.classList.add('hidden');
        return;
    }
    const wrap = gw.querySelector('.gallery-container-wrapper');
    if (!wrap) return;
    if (!galleryCatchupBusyLineEl) {
        galleryCatchupBusyLineEl = document.createElement('div');
        galleryCatchupBusyLineEl.id = 'galleryCatchupBusyLine';
        galleryCatchupBusyLineEl.setAttribute('aria-busy', 'true');
        galleryCatchupBusyLineEl.setAttribute('aria-label', 'Resolving gallery previews');
        galleryCatchupBusyLineEl.className = 'hidden';
        galleryCatchupBusyLineEl.style.cssText = 'height:3px;width:100%;flex-shrink:0;overflow:hidden;position:relative;z-index:12;background:rgba(0,0,0,0.12);';
        galleryCatchupBusyLineEl.innerHTML = '<div class="marquee animate" role="progressbar" style="height:3px;"><div style="height:3px;background:rgba(120,180,255,0.55);"></div></div>';
        wrap.insertBefore(galleryCatchupBusyLineEl, wrap.firstChild);
    }
    galleryCatchupBusyLineEl.classList.toggle('hidden', !busy);
}

function triggerBuildGalleryNavigationCache() {
    // Build cache from filtered images if in search mode
    if (window.filteredImageIndices && window.filteredImageIndices.length > 0 && window.filteredImageIndices.length < (window.originalAllImages ? window.originalAllImages.length : allImages.length)) {
        // We're in search mode - build cache from filtered array
        const filteredArray = window.filteredImageIndices.map(idx => {
            const sourceArray = window.originalAllImages || allImages;
            return sourceArray[idx];
        }).filter(img => img !== undefined);
        buildGalleryNavigationCache(filteredArray);
    } else {
        buildGalleryNavigationCache(allImages);
    }
}

// Session key for gallery_scroll_state map (server: public/scripts/websocket.js gallery_scroll_state)
function galleryScrollRestoreKey() {
    const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'default';
    return `${ws}:${currentGalleryView}`;
}

function isGallerySearchModeActive() {
    const hasSearchTerm = typeof window.currentSearchTerm === 'string' && window.currentSearchTerm.trim().length > 0;
    const hasNarrowFilter = Array.isArray(window.filteredImageIndices)
        && window.filteredImageIndices.length > 0
        && Array.isArray(window.originalAllImages)
        && window.filteredImageIndices.length < window.originalAllImages.length;
    return hasSearchTerm || hasNarrowFilter;
}

/** Drop duplicate gallery arrays kept for search/filter — active list is allImages only. */
function clearStaleGalleryListCopies() {
    if (window.originalAllImages) {
        delete window.originalAllImages;
    }
    if (window.filteredImageIndices) {
        delete window.filteredImageIndices;
    }
}

/**
 * Replace the active in-memory gallery list and discard previous versions.
 * @param {Array} newGallery - New gallery array (by reference; not copied)
 * @param {{ preserveSearchContext?: boolean, rebuildNavCache?: boolean }} options
 */
function setActiveGalleryList(newGallery, options = {}) {
    const list = slimGalleryList(Array.isArray(newGallery) ? newGallery : []);
    const preserveSearch = options.preserveSearchContext === true && isGallerySearchModeActive();

    if (list.length === 0) {
        invalidateGalleryImagesSyncState();
    } else if (!options.preserveSyncState) {
        driftGalleryImagesSyncState(list.length);
    }

    allImages = list;

    if (preserveSearch) {
        window.originalAllImages = list;
        if (window.filteredImageIndices && window.filteredImageIndices.length > list.length) {
            delete window.filteredImageIndices;
        }
    } else {
        clearStaleGalleryListCopies();
    }

    if (options.rebuildNavCache === true) {
        triggerBuildGalleryNavigationCache();
    } else if (list.length === 0) {
        buildGalleryNavigationCache([]);
    }

    return allImages;
}

/** Display file for a gallery tile (upscaled preferred). */
function galleryListItemDisplayKey(img) {
    if (!img) return null;
    if (typeof img === 'string') return img;
    return img.filename || img.upscaled || img.original || null;
}

function galleryListItemIdentityKeys(itemOrFilename) {
    if (!itemOrFilename) return [];
    if (typeof itemOrFilename === 'string') return [itemOrFilename];
    const keys = [];
    [itemOrFilename.filename, itemOrFilename.upscaled, itemOrFilename.original].forEach((k) => {
        if (k && !keys.includes(k)) keys.push(k);
    });
    return keys;
}

function galleryListItemMatchesIdentity(img, identityKeys) {
    if (!img || !identityKeys || identityKeys.length === 0) return false;
    const imgKeys = [img.filename, img.upscaled, img.original].filter(Boolean);
    return identityKeys.some((k) => imgKeys.includes(k));
}

/** True when this exact file is already on a list row (as filename/original/upscaled). */
function activeGalleryHasExactFile(filename) {
    if (!filename) return false;
    const match = (img) => img.filename === filename || img.original === filename || img.upscaled === filename;
    if (allImages.some(match)) return true;
    if (window.originalAllImages && window.originalAllImages !== allImages) {
        return window.originalAllImages.some(match);
    }
    return false;
}

function findActiveGalleryListIndexForItem(item) {
    if (!item) return -1;
    const displayKey = galleryListItemDisplayKey(item);
    if (displayKey) {
        const exact = allImages.findIndex((img) =>
            img.filename === displayKey || img.upscaled === displayKey || img.original === displayKey
        );
        if (exact >= 0) return exact;
    }
    if (item.upscaled) {
        const byUpscaled = allImages.findIndex((img) =>
            img.upscaled === item.upscaled || img.filename === item.upscaled
        );
        if (byUpscaled >= 0) return byUpscaled;
    }
    if (item.base) {
        const byBase = allImages.findIndex((img) => img.base && img.base === item.base);
        if (byBase >= 0) return byBase;
    }
    if (item.original) {
        const byOriginal = allImages.findIndex((img) =>
            img.original === item.original || img.filename === item.original
        );
        if (byOriginal >= 0) return byOriginal;
    }
    return -1;
}

function mergeSlimGalleryListItems(existing, incoming) {
    const slimIncoming = slimGalleryListItem(incoming);
    const merged = slimGalleryListItem({
        ...(existing || {}),
        ...slimIncoming,
        base: slimIncoming.base || (existing && existing.base) || null,
        original: slimIncoming.original || (existing && existing.original) || null,
        upscaled: slimIncoming.upscaled || (existing && existing.upscaled) || null,
        preview: slimIncoming.preview || (existing && existing.preview) || null,
        blurhash: slimIncoming.blurhash || (existing && existing.blurhash) || null,
        mtime: Math.max(Number(slimIncoming.mtime) || 0, Number(existing && existing.mtime) || 0) || slimIncoming.mtime,
        width: slimIncoming.width != null ? slimIncoming.width : (existing && existing.width),
        height: slimIncoming.height != null ? slimIncoming.height : (existing && existing.height),
        size: slimIncoming.size || (existing && existing.size) || 0
    });
    merged.filename = merged.upscaled || merged.original || merged.filename;
    return merged;
}

function findGalleryDomItemByIdentity(itemOrFilename) {
    if (!gallery) return null;
    const keys = galleryListItemIdentityKeys(itemOrFilename);
    if (keys.length === 0) return null;
    const items = gallery.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]');
    for (let i = 0; i < items.length; i++) {
        const fn = items[i].dataset.filename;
        if (fn && keys.includes(fn)) return items[i];
    }
    return null;
}

/** Update an existing gallery cell after upscale / metadata refresh. */
function updateGalleryItemElementFromData(el, imageData) {
    if (!el || !imageData) return;
    const filename = galleryListItemDisplayKey(imageData);
    if (filename) {
        el.dataset.filename = filename;
        const checkbox = el.querySelector('.gallery-item-checkbox');
        if (checkbox) checkbox.dataset.filename = filename;
    }
    if (imageData.mtime != null) {
        el.dataset.time = imageData.mtime || 0;
    }
    // Refresh preview — display file may have changed (original → upscaled)
    if (el.querySelector('img')) {
        removeImgFromGalleryItem(el);
    }
    if (!el.classList.contains('gallery-placeholder')) {
        addImgToGalleryItemAsync(el, imageData);
    }
}

/**
 * Prepend or upgrade a gallery list row at head.
 * Upscale fills `upscaled` on the same base — merge + move to head instead of skipping.
 * Returns false when the list is already identical at head.
 */
function prependToActiveGalleryList(item) {
    if (!item) return false;
    const slimIncoming = slimGalleryListItem(item);
    const idx = findActiveGalleryListIndexForItem(slimIncoming);

    if (idx >= 0) {
        const merged = mergeSlimGalleryListItems(allImages[idx], slimIncoming);
        const head = allImages[0];
        const unchanged = idx === 0
            && head
            && head.filename === merged.filename
            && head.upscaled === merged.upscaled
            && head.original === merged.original
            && Number(head.mtime) === Number(merged.mtime)
            && head.width === merged.width
            && head.height === merged.height;
        if (unchanged) return false;

        allImages.splice(idx, 1);
        allImages.unshift(merged);
        if (window.originalAllImages && window.originalAllImages !== allImages) {
            const baseIdx = window.originalAllImages.findIndex((img) =>
                galleryListItemMatchesIdentity(img, galleryListItemIdentityKeys(merged))
            );
            if (baseIdx >= 0) {
                window.originalAllImages.splice(baseIdx, 1);
            }
            window.originalAllImages.unshift(merged);
        }
        return true;
    }

    allImages.unshift(slimIncoming);
    if (window.originalAllImages && window.originalAllImages !== allImages) {
        window.originalAllImages.unshift(slimIncoming);
    }
    if (window.filteredImageIndices && Array.isArray(window.filteredImageIndices)) {
        window.filteredImageIndices = window.filteredImageIndices.map((i) => i + 1);
    }
    return true;
}

window.setActiveGalleryList = setActiveGalleryList;
window.clearStaleGalleryListCopies = clearStaleGalleryListCopies;
window.prependToActiveGalleryList = prependToActiveGalleryList;

function getGalleryImageTimestampMs(image) {
    if (!image || typeof image !== 'object') return null;

    const rawCandidates = [
        image.mtime,
        image.timestamp,
        image.createdAt,
        image.metadata && image.metadata.date,
        image.metadata && image.metadata.timestamp,
        Array.isArray(image.receipt) && image.receipt.length > 0 ? image.receipt[0].timestamp : null
    ];

    for (const raw of rawCandidates) {
        if (raw === null || raw === undefined || raw === '') continue;
        const ms = raw instanceof Date ? raw.getTime() : new Date(raw).getTime();
        if (Number.isFinite(ms)) return ms;
    }

    return null;
}

function getVisibleGalleryIndexRange() {
    if (visibleItems.size === 0) return null;
    const indices = Array.from(visibleItems).filter((idx) => Number.isFinite(idx));
    if (indices.length === 0) return null;
    return {
        min: Math.min(...indices),
        max: Math.max(...indices)
    };
}

function getGalleryJumpSearchStartIndex(direction, effectiveLength) {
    const visibleRange = getVisibleGalleryIndexRange();
    const hintAnchor = Number.isFinite(lastHintIndex) && lastHintIndex >= 0
        ? Math.max(0, Math.min(effectiveLength - 1, lastHintIndex))
        : Math.max(0, Math.min(effectiveLength - 1, getFirstVisibleRowIndex()));
    if (direction > 0) {
        if (visibleRange && visibleRange.max < effectiveLength - 1) return Math.max(1, visibleRange.max + 1);
        return Math.max(1, Math.min(effectiveLength - 1, hintAnchor + 1));
    }
    if (visibleRange && visibleRange.min > 0) return Math.min(effectiveLength - 2, visibleRange.min - 1);
    return Math.min(effectiveLength - 2, Math.max(0, hintAnchor - 1));
}

function findNextTimeJumpFilteredIndex(direction, thresholdMs = GALLERY_TIME_JUMP_THRESHOLD_MS, startIndex = null, scanLimit = null) {
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    if (!effectiveLength || effectiveLength < 2) return null;
    let computedStartIndex = Number.isFinite(startIndex) ? Math.floor(startIndex) : getGalleryJumpSearchStartIndex(direction, effectiveLength);
    let scanned = 0;
    if (direction > 0) {
        computedStartIndex = Math.max(1, Math.min(effectiveLength - 1, computedStartIndex)); // Need previous neighbor to compare
        for (let i = computedStartIndex; i < effectiveLength; i++) {
            if (scanLimit !== null && scanned >= scanLimit) break;
            scanned++;
            if (visibleItems.has(i)) continue;
            const prevIndex = i - 1;
            const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined ? window.filteredImageIndices[i] : i;
            const prevFileIndex = window.filteredImageIndices && window.filteredImageIndices[prevIndex] !== undefined ? window.filteredImageIndices[prevIndex] : prevIndex;
            const currTs = getGalleryImageTimestampMs(allImages[fileIndex]);
            const prevTs = getGalleryImageTimestampMs(allImages[prevFileIndex]);
            if (currTs === null || prevTs === null) continue;
            if (Math.abs(currTs - prevTs) >= thresholdMs) return i;
        }
    } else {
        computedStartIndex = Math.max(0, Math.min(effectiveLength - 2, computedStartIndex)); // Need next neighbor to compare
        for (let i = computedStartIndex; i >= 0; i--) {
            if (scanLimit !== null && scanned >= scanLimit) break;
            scanned++;
            if (visibleItems.has(i)) continue;
            const nextIndex = i + 1;
            const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined ? window.filteredImageIndices[i] : i;
            const nextFileIndex = window.filteredImageIndices && window.filteredImageIndices[nextIndex] !== undefined ? window.filteredImageIndices[nextIndex] : nextIndex;
            const currTs = getGalleryImageTimestampMs(allImages[fileIndex]);
            const nextTs = getGalleryImageTimestampMs(allImages[nextFileIndex]);
            if (currTs === null || nextTs === null) continue;
            if (Math.abs(currTs - nextTs) >= thresholdMs) return i;
        }
    }

    return null;
}

function formatGalleryTimeJumpDetails(fromMs, toMs) {
    if (!Number.isFinite(fromMs) || !Number.isFinite(toMs)) return null;
    const deltaMs = toMs - fromMs;
    const absMs = Math.abs(deltaMs);
    const sign = deltaMs < 0 ? '-' : '+';
    const minute = 60 * 1000;
    const hour = 60 * minute;
    const day = 24 * hour;

    if (absMs >= day) {
        const days = Math.round(absMs / day);
        const targetDate = new Date(toMs);
        const month = targetDate.toLocaleString(undefined, { month: 'short' });
        const dayNum = targetDate.getDate();
        return {
            relativeLabel: `${sign}${days} day${days === 1 ? '' : 's'}`,
            absoluteLabel: `${month} ${dayNum}`
        };
    }
    if (absMs >= hour) {
        const hours = Math.round(absMs / hour);
        const targetTime = new Date(toMs).toLocaleTimeString([], {
            hour: 'numeric',
            minute: '2-digit'
        });
        return {
            relativeLabel: `${sign}${hours} hour${hours === 1 ? '' : 's'}`,
            absoluteLabel: targetTime
        };
    }
    const mins = Math.max(1, Math.round(absMs / minute));
    const targetTime = new Date(toMs).toLocaleTimeString([], {
        hour: 'numeric',
        minute: '2-digit'
    });
    return {
        relativeLabel: `${sign}${mins} min`,
        absoluteLabel: targetTime
    };
}

function isGalleryReadyForTimeJump() {
    if (!gallery) return false;
    if (isJumpingToPosition || isGalleryResetting || isLoadingMore) return false;
    return !!gallery.querySelector('.gallery-item:not(.gallery-placeholder)');
}

function triggerGalleryVirtualScrollFromShortcut() {
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');
    const scrollTarget = isContainerScroll ? galleryContainer : window;

    // Route through the same scroll listener pipeline used by user scrolling.
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            scrollTarget.dispatchEvent(new Event('scroll'));
            if (galleryJumpIndexToolEl && !galleryJumpIndexToolEl.classList.contains('hidden')) {
                updateGalleryJumpIndexActiveCard();
                if (!Number.isFinite(galleryJumpIndexHoveredBoundaryIndex)) {
                    updateGalleryJumpIndexSummary();
                }
            }
        });
    });
}

/** Re-run gallery scroll pipeline so Jump Index (and virtual list) stay in sync after jumps. Prefer calling after highlight/layout settles (e.g. time-jump finally block). */
function refreshGalleryJumpIndexUI() {
    triggerGalleryVirtualScrollFromShortcut();
}

function getCurrentGalleryAnchorIndex() {
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    if (!effectiveLength) return 0;
    if (Number.isFinite(lastHintIndex) && lastHintIndex >= 0) {
        return Math.max(0, Math.min(effectiveLength - 1, lastHintIndex));
    }
    return Math.max(0, Math.min(effectiveLength - 1, getFirstVisibleRowIndex()));
}

function getGalleryJumpIndexSelectedThresholdMs() {
    return Number.isFinite(selectedGalleryJumpIndexMinTimeMs) && selectedGalleryJumpIndexMinTimeMs > 0
        ? selectedGalleryJumpIndexMinTimeMs
        : GALLERY_JUMP_INDEX_DEFAULT_MIN_TIME_MS;
}

function getGalleryJumpIndexSelectedMaxGroupImages() {
    if (selectedGalleryJumpIndexMaxGroupImages === Infinity) return Infinity;
    return Number.isFinite(selectedGalleryJumpIndexMaxGroupImages) && selectedGalleryJumpIndexMaxGroupImages > 0
        ? selectedGalleryJumpIndexMaxGroupImages
        : GALLERY_JUMP_INDEX_DEFAULT_MAX_GROUP_IMAGES;
}

function getGalleryImageAtFilteredIndex(filteredIndex) {
    const fileIndex = window.filteredImageIndices && window.filteredImageIndices[filteredIndex] !== undefined
        ? window.filteredImageIndices[filteredIndex]
        : filteredIndex;
    return allImages[fileIndex] || null;
}

function getGalleryImageSrcCandidates(image) {
    if (!image) return [];
    const candidates = [];
    const seen = new Set();
    const add = (src) => {
        if (src && !seen.has(src)) {
            seen.add(src);
            candidates.push(src);
        }
    };

    if (image.preview || image.base) {
        const previewSrc = typeof resolveGalleryPreviewUrl === 'function'
            ? resolveGalleryPreviewUrl(image)
            : null;
        if (previewSrc) {
            add(previewSrc);
        } else if (image.preview) {
            const basePreview = image.preview.replace(/\.(jpg|jpeg|png|webp)$/i, '');
            const preferredPreview = typeof getGalleryPreviewUrl === 'function'
                ? getGalleryPreviewUrl(image.preview)
                : image.preview;
            add(`/previews/${encodeURIComponent(preferredPreview)}`);
            add(`/previews/${encodeURIComponent(`${basePreview}.webp`)}`);
            add(`/previews/${encodeURIComponent(`${basePreview}@2x.webp`)}`);
        }
    }

    const filename = image.upscaled || image.original || image.filename;
    if (filename) {
        const fullSrc = typeof resolveGalleryFullImageUrl === 'function'
            ? resolveGalleryFullImageUrl(image)
            // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
            : localGalleryImageUrl(filename);
        add(fullSrc);
    }
    return candidates;
}

function getGalleryPreviewSrcForImage(image) {
    const candidates = getGalleryImageSrcCandidates(image);
    return candidates[0] || '';
}

// Release decoded pixels held by a gallery thumbnail before DOM teardown or src swap.
function releaseGalleryItemImage(img) {
    if (!img) return;
    img.onload = null;
    img.onerror = null;
    const src = img.currentSrc || img.src || '';
    if (src.startsWith('blob:')) {
        URL.revokeObjectURL(src);
    }
    img.removeAttribute('src');
}

function disposeGalleryItemElement(item) {
    if (!item) return;
    // contextMenu: public/scripts/comp/contextMenu.js
    contextMenu.detachFromElement(item);
    if (intersectionObserver) {
        intersectionObserver.unobserve(item);
    }
    const img = item.querySelector('img');
    if (img) {
        releaseGalleryItemImage(img);
    }
    if (item.style.backgroundImage) {
        item.style.backgroundImage = '';
        item.style.backgroundSize = '';
        item.style.backgroundPosition = '';
        item.style.backgroundRepeat = '';
    }
}

function purgePlaceholderResolutionQueue() {
    if (placeholderWatcherFrameId) {
        clearTimeout(placeholderWatcherFrameId);
        placeholderWatcherFrameId = null;
    }
    placeholderWatcherRunning = false;
    placeholderResolutionDelay = 0;
    placeholderResolutionFrameCount = 0;
    placeholderQueueSizeHistory = [];
    for (const entry of placeholderResolutionQueue) {
        if (entry?.element) {
            disposeGalleryItemElement(entry.element);
        }
    }
    placeholderResolutionQueue = [];
}

function disposeGalleryContents() {
    if (!gallery) return;
    gallery.querySelectorAll('.gallery-item, .gallery-placeholder').forEach(disposeGalleryItemElement);
    purgePlaceholderResolutionQueue();
    placeholderCleanupQueue.length = 0;
    visibleItems.clear();
}

// public/scripts/comp/galleryView.js — gallery item img with preview/full fallbacks and optional retry
function applyGalleryItemImage(img, image, options = {}) {
    const candidates = getGalleryImageSrcCandidates(image);
    if (!candidates.length || !img) {
        if (typeof options.onComplete === 'function') options.onComplete();
        return;
    }

    if (img.src || img.currentSrc) {
        releaseGalleryItemImage(img);
    }

    let candidateIndex = 0;
    let previewRetryCount = 0;
    const maxPreviewRetries = options.maxPreviewRetries != null ? options.maxPreviewRetries : 2;

    img.alt = image.base || '';
    img.loading = options.eager ? 'eager' : 'lazy';
    img.decoding = 'async';
    img.classList.add('loading-image');

    const finish = () => {
        img.classList.remove('loading-image');
        if (typeof options.onComplete === 'function') options.onComplete();
    };

    const loadCandidate = () => {
        if (candidateIndex >= candidates.length) {
            img.onload = null;
            img.onerror = null;
            finish();
            return;
        }
        img.src = candidates[candidateIndex++];
    };

    img.onload = function () {
        img.onload = null;
        img.onerror = null;
        finish();
    };

    img.onerror = function () {
        const failedSrc = img.src || '';
        const isPreview = failedSrc.includes('/previews/');
        if (isPreview && previewRetryCount < maxPreviewRetries) {
            previewRetryCount++;
            const baseSrc = failedSrc.split('?')[0];
            setTimeout(() => {
                if (img.isConnected) {
                    img.src = `${baseSrc}?galleryRetry=${previewRetryCount}`;
                }
            }, 350 * previewRetryCount);
            return;
        }
        loadCandidate();
    };

    loadCandidate();
}

function buildGalleryJumpIndexEntries(minTimeMs, maxGroupImages) {
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    if (!effectiveLength) return [];
    const entries = [];
    let groupStart = 0;
    let groupStartTs = getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(groupStart));
    entries.push({ index: 0, groupCount: 0 });

    for (let i = 1; i < effectiveLength; i++) {
        const prevTs = getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(i - 1));
        const currTs = getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(i));
        const groupSize = i - groupStart;
        const timeFromStart = (groupStartTs !== null && currTs !== null) ? Math.abs(currTs - groupStartTs) : 0;
        const reachedMinGroupSize = groupSize >= GALLERY_JUMP_INDEX_MIN_GROUP_IMAGES;
        const boundaryByTime = reachedMinGroupSize && Number.isFinite(minTimeMs) && minTimeMs > 0 && timeFromStart >= minTimeMs;
        const boundaryBySize = Number.isFinite(maxGroupImages) && maxGroupImages !== Infinity && groupSize >= maxGroupImages;
        const boundaryByNeighborJump = reachedMinGroupSize && (prevTs !== null && currTs !== null) && Math.abs(currTs - prevTs) >= minTimeMs;
        if (boundaryByTime || boundaryBySize || boundaryByNeighborJump) {
            groupStart = i;
            groupStartTs = currTs;
            entries.push({ index: i, groupCount: 0 });
        }
    }

    // Fill each group's item count based on boundary start indices.
    for (let i = 0; i < entries.length; i++) {
        const start = entries[i].index;
        const end = i < entries.length - 1 ? entries[i + 1].index : effectiveLength;
        entries[i].groupCount = Math.max(1, end - start);
    }

    return entries;
}

function updateGalleryJumpIndexSummary(preferredBoundaryIndex = null) {
    if (!galleryJumpIndexSummaryEl) return;
    if (!galleryJumpIndexEntries || galleryJumpIndexEntries.length === 0) {
        galleryJumpIndexSummaryEl.textContent = 'No jump boundaries';
        return;
    }
    const currentIndex = getCurrentGalleryAnchorIndex();
    const hasHover = Number.isFinite(galleryJumpIndexHoveredBoundaryIndex);
    let targetBoundary = null;
    if (Number.isFinite(preferredBoundaryIndex)) {
        targetBoundary = galleryJumpIndexEntries.find((entry) => entry.index === preferredBoundaryIndex) || null;
    } else if (hasHover) {
        targetBoundary = galleryJumpIndexEntries.find((entry) => entry.index === galleryJumpIndexHoveredBoundaryIndex) || null;
    }
    if (!targetBoundary) {
        targetBoundary = galleryJumpIndexEntries.find((entry) => entry.index > currentIndex) || galleryJumpIndexEntries[galleryJumpIndexEntries.length - 1];
    }

    // Default header text (no hover): current boundary information.
    if (!hasHover && !Number.isFinite(preferredBoundaryIndex)) {
        const currentBoundary = galleryJumpIndexEntries.reduce((best, entry) => {
            if (!best || Math.abs(entry.index - currentIndex) < Math.abs(best.index - currentIndex)) return entry;
            return best;
        }, null);
        if (currentBoundary) {
            const boundaryTs = getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(currentBoundary.index));
            if (Number.isFinite(boundaryTs)) {
                const absolute = new Date(boundaryTs).toLocaleString([], {
                    month: 'short',
                    day: 'numeric',
                    hour: 'numeric',
                    minute: '2-digit'
                });
                galleryJumpIndexSummaryEl.textContent = `${absolute} (${currentBoundary.groupCount} images)`;
            } else {
                galleryJumpIndexSummaryEl.textContent = `Boundary #${currentBoundary.index + 1} (${currentBoundary.groupCount} images)`;
            }
            return;
        }
    }

    const rawDistance = targetBoundary.index - currentIndex;
    const sign = rawDistance >= 0 ? '+' : '-';
    const distance = Math.abs(rawDistance);
    const currentTs = getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(currentIndex));
    const targetTs = getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(targetBoundary.index));
    const jumpDetails = formatGalleryTimeJumpDetails(currentTs, targetTs);
    if (jumpDetails) {
        galleryJumpIndexSummaryEl.textContent = `${sign}${distance} images . ${jumpDetails.relativeLabel} (${jumpDetails.absoluteLabel})`;
    } else {
        galleryJumpIndexSummaryEl.textContent = `${sign}${distance} images`;
    }
}

function updateGalleryJumpIndexActiveCard() {
    if (!galleryJumpIndexListEl || !galleryJumpIndexEntries || galleryJumpIndexEntries.length === 0) return;
    const currentIndex = getCurrentGalleryAnchorIndex();
    let activeEntry = null;
    let nearestDistance = Infinity;
    galleryJumpIndexEntries.forEach((entry) => {
        const d = Math.abs(entry.index - currentIndex);
        if (d < nearestDistance) {
            nearestDistance = d;
            activeEntry = entry;
        }
    });
    const cards = galleryJumpIndexListEl.querySelectorAll('.gallery-jump-index-card');
    cards.forEach((card) => {
        const idx = parseInt(card.dataset.index, 10);
        card.classList.toggle('active-boundary', !!activeEntry && idx === activeEntry.index);
    });

    if (activeEntry && galleryJumpIndexActiveBoundaryIndex !== activeEntry.index) {
        galleryJumpIndexActiveBoundaryIndex = activeEntry.index;
        const activeCard = galleryJumpIndexListEl.querySelector(`.gallery-jump-index-card[data-index="${activeEntry.index}"]`);
        if (activeCard && activeCard.scrollIntoView) {
            activeCard.scrollIntoView({ block: 'center', behavior: 'instant' });
        }
    }
}

function getGalleryJumpIndexTargetEntry(preferredEntry) {
    if (preferredEntry) return preferredEntry;
    if (!galleryJumpIndexEntries || galleryJumpIndexEntries.length === 0) return null;
    if (Number.isFinite(galleryJumpIndexHoveredBoundaryIndex)) {
        return galleryJumpIndexEntries.find((entry) => entry.index === galleryJumpIndexHoveredBoundaryIndex) || null;
    }
    const currentIndex = getCurrentGalleryAnchorIndex();
    let nearest = null;
    let nearestDistance = Infinity;
    galleryJumpIndexEntries.forEach((entry) => {
        const d = Math.abs(entry.index - currentIndex);
        if (d < nearestDistance) {
            nearestDistance = d;
            nearest = entry;
        }
    });
    return nearest;
}

async function jumpGalleryJumpIndexTarget(preferredEntry) {
    const entry = getGalleryJumpIndexTargetEntry(preferredEntry);
    if (!entry) return false;
    updateGalleryJumpIndexSummary(entry.index);
    await displayGalleryFromStartIndex(entry.index, true);
    if (!window.isDesktop) {
        // closeModal — public/scripts/comp/modalUtils.js
        closeModal(galleryJumpIndexToolEl);
    } else {
        refreshGalleryJumpIndexUI();
    }
    return true;
}

async function waitForGalleryDataStableForJumpIndex(timeoutMs = 9000) {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
        const stable = !isLoadingMore && !isJumpingToPosition && !isGalleryResetting && Array.isArray(allImages) && allImages.length > 0;
        if (stable) return true;
        await new Promise((resolve) => setTimeout(resolve, 80));
    }
    return !isLoadingMore && !isJumpingToPosition && !isGalleryResetting;
}

async function regenerateGalleryJumpIndex() {
    if (!galleryJumpIndexToolEl || galleryJumpIndexToolEl.classList.contains('hidden')) return;
    if (galleryJumpIndexRegenerating) {
        galleryJumpIndexRegenPending = true;
        return;
    }
    galleryJumpIndexRegenerating = true;
    try {
        const ready = await waitForGalleryDataStableForJumpIndex();
        if (!ready || !galleryJumpIndexListEl) return;
        const minTimeMs = getGalleryJumpIndexSelectedThresholdMs();
        const maxGroupImages = getGalleryJumpIndexSelectedMaxGroupImages();
        galleryJumpIndexEntries = buildGalleryJumpIndexEntries(minTimeMs, maxGroupImages);
        galleryJumpIndexActiveBoundaryIndex = null;
        galleryJumpIndexListEl.innerHTML = '';
        const fragment = document.createDocumentFragment();
        galleryJumpIndexEntries.forEach((entry) => {
            const image = getGalleryImageAtFilteredIndex(entry.index);
            if (!image) return;
            const card = document.createElement('button');
            card.type = 'button';
            card.className = 'gallery-jump-index-card';
            card.dataset.index = String(entry.index);
            const previewSrc = getGalleryPreviewSrcForImage(image);
            card.innerHTML = `
                <img src="${previewSrc}" alt="" loading="lazy" />
                <div class="gallery-jump-index-card-meta">${entry.groupCount} images</div>
            `;
            card.addEventListener('click', () => {
                jumpGalleryJumpIndexTarget(entry);
            });
            card.addEventListener('mouseenter', () => {
                galleryJumpIndexHoveredBoundaryIndex = entry.index;
                updateGalleryJumpIndexSummary(entry.index);
            });
            card.addEventListener('mouseleave', () => {
                galleryJumpIndexHoveredBoundaryIndex = null;
                updateGalleryJumpIndexSummary();
            });
            fragment.appendChild(card);
        });
        galleryJumpIndexListEl.appendChild(fragment);
        updateGalleryJumpIndexActiveCard();
        updateGalleryJumpIndexSummary();

        // Scroll the index list to the nearest boundary for current gallery position.
        const currentIndex = getCurrentGalleryAnchorIndex();
        let nearest = null;
        let nearestDistance = Infinity;
        galleryJumpIndexEntries.forEach((entry) => {
            const d = Math.abs(entry.index - currentIndex);
            if (d < nearestDistance) {
                nearestDistance = d;
                nearest = entry;
            }
        });
        if (nearest) {
            const nearestEl = galleryJumpIndexListEl.querySelector(`.gallery-jump-index-card[data-index="${nearest.index}"]`);
            if (nearestEl && nearestEl.scrollIntoView) {
                nearestEl.scrollIntoView({ block: 'center', behavior: 'instant' });
            }
        }
    } finally {
        galleryJumpIndexRegenerating = false;
        if (galleryJumpIndexRegenPending) {
            galleryJumpIndexRegenPending = false;
            regenerateGalleryJumpIndex();
        }
    }
}

function ensureGalleryJumpIndexToolWindow() {
    if (galleryJumpIndexToolEl) return galleryJumpIndexToolEl;
    const el = document.getElementById('galleryJumpIndexTool');
    if (!el) return null;
    galleryJumpIndexToolEl = el;
    galleryJumpIndexListEl = el.querySelector('#galleryJumpIndexGrid');
    galleryJumpIndexSummaryEl = el.querySelector('#galleryJumpIndexSummary');
    galleryJumpIndexMinTimeSelectedEl = el.querySelector('#galleryJumpIndexMinTimeSelected');
    galleryJumpIndexMaxGroupSelectedEl = el.querySelector('#galleryJumpIndexMaxGroupSelected');

    if (!galleryJumpIndexListenersInitialized) {
        const closeBtn = el.querySelector('.close-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal(el));
        document.addEventListener('galleryUpdated', () => {
            if (galleryJumpIndexToolEl && !galleryJumpIndexToolEl.classList.contains('hidden')) {
                regenerateGalleryJumpIndex();
            }
        });
        galleryJumpIndexListenersInitialized = true;
    }

    if (!galleryJumpIndexDropdownsInitialized
        && typeof setupDropdown === 'function'
        && typeof renderSimpleDropdown === 'function') {
        const minDrop = document.getElementById('galleryJumpIndexMinTimeDropdown');
        const minBtn = document.getElementById('galleryJumpIndexMinTimeDropdownBtn');
        const minMenu = document.getElementById('galleryJumpIndexMinTimeDropdownMenu');
        const maxDrop = document.getElementById('galleryJumpIndexMaxGroupDropdown');
        const maxBtn = document.getElementById('galleryJumpIndexMaxGroupDropdownBtn');
        const maxMenu = document.getElementById('galleryJumpIndexMaxGroupDropdownMenu');

        const closeMin = () => closeDropdown(minMenu, minBtn);
        const closeMax = () => closeDropdown(maxMenu, maxBtn);
        const selectMin = (value) => {
            selectedGalleryJumpIndexMinTimeMs = Number(value);
            if (galleryJumpIndexMinTimeSelectedEl) {
                const selected = GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS.find((o) => String(o.value) === String(value));
                galleryJumpIndexMinTimeSelectedEl.textContent = selected ? selected.name : `${value}`;
            }
            regenerateGalleryJumpIndex();
        };
        const selectMax = (value) => {
            selectedGalleryJumpIndexMaxGroupImages = value === 'none' ? Infinity : Number(value);
            if (galleryJumpIndexMaxGroupSelectedEl) {
                const selected = GALLERY_JUMP_INDEX_MAX_GROUP_OPTIONS.find((o) => String(o.value) === String(value));
                galleryJumpIndexMaxGroupSelectedEl.textContent = selected ? selected.name : `${value}`;
            }
            regenerateGalleryJumpIndex();
        };
        const renderMin = (selectedVal) => renderSimpleDropdown(
            minMenu,
            GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS,
            'value',
            'name',
            selectMin,
            closeMin,
            selectedVal,
            { preventFocusTransfer: true }
        );
        const renderMax = (selectedVal) => renderSimpleDropdown(
            maxMenu,
            GALLERY_JUMP_INDEX_MAX_GROUP_OPTIONS,
            'value',
            'name',
            selectMax,
            closeMax,
            selectedVal,
            { preventFocusTransfer: true }
        );

        setupDropdown(minDrop, minBtn, minMenu, renderMin, () => selectedGalleryJumpIndexMinTimeMs, { preventFocusTransfer: true });
        setupDropdown(maxDrop, maxBtn, maxMenu, renderMax, () => (selectedGalleryJumpIndexMaxGroupImages === Infinity ? 'none' : selectedGalleryJumpIndexMaxGroupImages), { preventFocusTransfer: true });
        galleryJumpIndexDropdownsInitialized = true;
    }

    if (galleryJumpIndexMinTimeSelectedEl) {
        const selected = GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS.find((o) => o.value === selectedGalleryJumpIndexMinTimeMs);
        galleryJumpIndexMinTimeSelectedEl.textContent = selected ? selected.name : '30m';
    }
    if (galleryJumpIndexMaxGroupSelectedEl) {
        if (selectedGalleryJumpIndexMaxGroupImages === Infinity) {
            galleryJumpIndexMaxGroupSelectedEl.textContent = 'No max';
        } else {
            galleryJumpIndexMaxGroupSelectedEl.textContent = String(selectedGalleryJumpIndexMaxGroupImages);
        }
    }
    return el;
}

function positionGalleryJumpIndexToolWindow() {
    if (!galleryJumpIndexToolEl) return;
    const galleryWindow = document.getElementById('galleryWindow');
    if (!galleryWindow || galleryWindow.classList.contains('hidden')) return;

    const gRect = galleryWindow.getBoundingClientRect();
    const viewportWidth = window.innerWidth || document.documentElement.clientWidth || 0;
    const viewportHeight = window.innerHeight || document.documentElement.clientHeight || 0;
    const margin = 12;

    const currentWidth = Math.round(galleryJumpIndexToolEl.getBoundingClientRect().width || 420);
    const targetWidth = Math.max(320, Math.min(560, currentWidth));
    const targetHeight = Math.max(280, Math.min(viewportHeight - (margin * 2), Math.round(gRect.height)));

    // Prefer left side; if insufficient space, use right side.
    const leftSpace = gRect.left - margin;
    const rightSpace = viewportWidth - gRect.right - margin;
    const useLeft = leftSpace >= targetWidth || leftSpace >= rightSpace;
    let left = useLeft ? (gRect.left - targetWidth - margin) : (gRect.right + margin);

    // Clamp to viewport bounds.
    left = Math.max(margin, Math.min(left, viewportWidth - targetWidth - margin));
    const top = Math.max(margin, Math.min(gRect.top, viewportHeight - targetHeight - margin));

    galleryJumpIndexToolEl.style.width = `${targetWidth}px`;
    galleryJumpIndexToolEl.style.height = `${targetHeight}px`;
    galleryJumpIndexToolEl.style.setProperty('--modal-offset-x', `${Math.round((left + (targetWidth / 2)) - (viewportWidth / 2))}px`);
    galleryJumpIndexToolEl.style.setProperty('--modal-offset-y', `${Math.round((top + (targetHeight / 2)) - (viewportHeight / 2))}px`);
}

function enforceGalleryJumpIndexVerticalResizeOnly() {
    if (!galleryJumpIndexToolEl) return;
    const handles = galleryJumpIndexToolEl.querySelectorAll('.resize-handle');
    handles.forEach((handle) => {
        const keep = handle.classList.contains('n') || handle.classList.contains('s');
        if (!keep) handle.remove();
    });
}

function openGalleryJumpIndexToolWindow() {
    const tool = ensureGalleryJumpIndexToolWindow();
    if (!tool) return;
    const galleryWindow = document.getElementById('galleryWindow');
    if (galleryWindow && typeof linkToolWindowToParent === 'function') {
        linkToolWindowToParent(tool, galleryWindow);
    }
    openModal(tool);
    positionGalleryJumpIndexToolWindow();
    enforceGalleryJumpIndexVerticalResizeOnly();
    regenerateGalleryJumpIndex();
}

window.openGalleryJumpIndexToolWindow = openGalleryJumpIndexToolWindow;

async function waitForGalleryReadyForTimeJump(timeoutMs = GALLERY_TIME_JUMP_READY_WAIT_MS) {
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
        if (isGalleryReadyForTimeJump()) return true;
        await new Promise((resolve) => setTimeout(resolve, 45));
    }
    return isGalleryReadyForTimeJump();
}

async function waitForGalleryHighlightComplete(timeoutMs = GALLERY_TIME_JUMP_HIGHLIGHT_WAIT_MS) {
    if (!gallery) return true;
    const startedAt = Date.now();
    while ((Date.now() - startedAt) < timeoutMs) {
        const hasHighlight = gallery.classList.contains('highlighting') || !!gallery.querySelector('.gallery-item.highlighted');
        if (!hasHighlight) return true;
        await new Promise((resolve) => setTimeout(resolve, 45));
    }
    return !gallery.classList.contains('highlighting') && !gallery.querySelector('.gallery-item.highlighted');
}

async function jumpToNextGalleryTimeBoundary(direction, optionsOrThreshold = GALLERY_TIME_JUMP_THRESHOLD_MS) {
    const now = Date.now();
    if (galleryTimeJumpInFlight || now < galleryTimeJumpDebounceUntil) return false;
    if (!isGalleryReadyForTimeJump()) return false;
    galleryTimeJumpInFlight = true;
    let didRunTimeJump = false;

    try {
    const opts = (typeof optionsOrThreshold === 'object' && optionsOrThreshold !== null)
        ? optionsOrThreshold
        : { thresholdMs: optionsOrThreshold };
    const providedThresholdMs = Number.isFinite(opts.thresholdMs) ? Math.floor(opts.thresholdMs) : GALLERY_TIME_JUMP_THRESHOLD_MS;
    const customScanWindow = opts.scanWindow === null
        ? null
        : (Number.isFinite(opts.scanWindow) ? Math.max(1, Math.floor(opts.scanWindow)) : Math.max(1, Math.floor(GALLERY_TIME_JUMP_ADAPT_WINDOW_ITEMS)));
    const dir = direction >= 0 ? 1 : -1;
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    if (!effectiveLength) return false;
    const visibleRange = getVisibleGalleryIndexRange();
    const currentAnchorIndex = Number.isFinite(lastHintIndex) && lastHintIndex >= 0
        ? Math.max(0, Math.min(effectiveLength - 1, lastHintIndex))
        : (visibleRange
            ? (dir > 0 ? visibleRange.max : visibleRange.min)
            : Math.max(0, Math.min(effectiveLength - 1, getFirstVisibleRowIndex())));
    const startIndex = getGalleryJumpSearchStartIndex(dir, effectiveLength);
    const baseThreshold = Math.max(
        GALLERY_TIME_JUMP_MIN_THRESHOLD_MS,
        providedThresholdMs
    );
    const minThreshold = Math.max(1, Math.floor(GALLERY_TIME_JUMP_MIN_THRESHOLD_MS));
    const scanWindow = customScanWindow;
    const reductionSteps = [1, 0.75, 0.5, 0.35, 0.25];
    let jumpIndex = null;
    let chosenThreshold = baseThreshold;

    for (const factor of reductionSteps) {
        chosenThreshold = Math.max(minThreshold, Math.floor(baseThreshold * factor));
        jumpIndex = findNextTimeJumpFilteredIndex(dir, chosenThreshold, startIndex, scanWindow);
        if (jumpIndex !== null) break;
        if (chosenThreshold === minThreshold) break;
    }
    if (jumpIndex === null) {
        jumpIndex = findNextTimeJumpFilteredIndex(dir, minThreshold, startIndex, null);
        chosenThreshold = minThreshold;
    }
    if (jumpIndex === null) return false;

    const fileIndex = window.filteredImageIndices && window.filteredImageIndices[jumpIndex] !== undefined
        ? window.filteredImageIndices[jumpIndex]
        : jumpIndex;
    const targetTs = getGalleryImageTimestampMs(allImages[fileIndex]);
    const anchorCompareIndex = dir > 0 ? Math.max(0, jumpIndex - 1) : Math.min(effectiveLength - 1, jumpIndex + 1);
    const anchorFileIndex = window.filteredImageIndices && window.filteredImageIndices[anchorCompareIndex] !== undefined
        ? window.filteredImageIndices[anchorCompareIndex]
        : anchorCompareIndex;
    const anchorTs = getGalleryImageTimestampMs(allImages[anchorFileIndex]);

    await displayGalleryFromStartIndex(jumpIndex, true);
    didRunTimeJump = true;

    const jumpDetails = formatGalleryTimeJumpDetails(anchorTs, targetTs);
    if (jumpDetails && window.showShortcutActionToast) {
        const galleryWindow = document.querySelector('#galleryWindow');
        const distance = Math.max(1, Math.abs(jumpIndex - currentAnchorIndex));
        const directionLabel = dir > 0 ? 'ahead' : 'back';
        window.showShortcutActionToast(
            `Jumping ${directionLabel} ${distance} images\n${jumpDetails.relativeLabel} (${jumpDetails.absoluteLabel})`,
            { centerOn: galleryWindow }
        );
    }
    return true;
    } finally {
        await waitForGalleryHighlightComplete();
        await waitForGalleryReadyForTimeJump();
        if (didRunTimeJump) refreshGalleryJumpIndexUI();
        galleryTimeJumpDebounceUntil = Date.now() + GALLERY_TIME_JUMP_RELEASE_DEBOUNCE_MS;
        galleryTimeJumpInFlight = false;
    }
}

/** Filtered index of first cell in the same grid row (keeps placeholders / infinite scroll row-aligned). */
function snapGalleryFilteredIndexToRowStart(filteredIndex, cols, effectiveLength) {
    const c = Math.max(1, Math.floor(Number(cols)) || 1);
    const eff = Math.max(0, Math.floor(Number(effectiveLength)) || 0);
    if (eff === 0) return 0;
    let i = Math.max(0, Math.min(eff - 1, Math.floor(Number(filteredIndex)) || 0));
    const lastRowStart = Math.floor((eff - 1) / c) * c;
    return Math.min(Math.floor(i / c) * c, lastRowStart);
}

function resolveRestoredGalleryScrollIndex(entry) {
    if (!entry || typeof entry !== 'object') return null;
    if (!allImages || allImages.length === 0) return null;
    if (isGallerySearchModeActive()) return null;

    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    if (effectiveLength === 0) return null;

    const cols = realGalleryColumns > 0 ? realGalleryColumns : 5;

    if (entry.anchorFilename && typeof entry.anchorFilename === 'string') {
        const af = entry.anchorFilename;
        const fileIdx = allImages.findIndex(img => {
            const f = img.filename || img.original || img.upscaled;
            return f === af;
        });
        if (fileIdx !== -1) {
            if (window.filteredImageIndices && window.filteredImageIndices.length) {
                const fp = window.filteredImageIndices.indexOf(fileIdx);
                if (fp !== -1) return snapGalleryFilteredIndexToRowStart(fp, cols, effectiveLength);
            }
            return snapGalleryFilteredIndexToRowStart(fileIdx, cols, effectiveLength);
        }
    }

    if (typeof entry.index === 'number' && Number.isFinite(entry.index)) {
        const clamped = Math.max(0, Math.min(effectiveLength - 1, Math.floor(entry.index)));
        return snapGalleryFilteredIndexToRowStart(clamped, cols, effectiveLength);
    }
    return null;
}

function peekPendingGalleryScrollIndex() {
    if (isGallerySearchModeActive()) return null;
    const map = window.galleryScrollStateFromSession;
    if (!map || typeof map !== 'object') return null;
    const entry = map[galleryScrollRestoreKey()];
    return resolveRestoredGalleryScrollIndex(entry);
}

function consumePendingGalleryScrollRestore() {
    // Never consume while searching; keep the saved position for post-search restore.
    if (isGallerySearchModeActive()) return null;
    const map = window.galleryScrollStateFromSession;
    if (!map || typeof map !== 'object') return null;
    const key = galleryScrollRestoreKey();
    const entry = map[key];
    if (!entry || typeof entry !== 'object') return null;
    const idx = resolveRestoredGalleryScrollIndex(entry);
    delete map[key];
    return idx;
}

function displayGalleryInitialPageOrRestored() {
    if (isGalleryWindowHidden() || isJumpingToPosition) return;
    const idx = consumePendingGalleryScrollRestore();
    if (idx !== null) {
        displayGalleryFromStartIndex(idx, false);
    } else {
        displayCurrentPageOptimized();
    }
    markGalleryDisplayed();
}

// Late gallery_scroll_state (race with loadGallery): public/scripts/websocket.js
function displayGalleryApplyLateSessionRestore() {
    if (isGalleryWindowHidden() || isJumpingToPosition) return;
    if (!gallery || !allImages || !allImages.length) return;
    if (isGallerySearchModeActive()) return;
    const key = galleryScrollRestoreKey();
    window._galleryScrollLateRestoreDone = window._galleryScrollLateRestoreDone || {};
    if (window._galleryScrollLateRestoreDone[key]) return;
    const idx = peekPendingGalleryScrollIndex();
    if (idx === null) return;
    window._galleryScrollLateRestoreDone[key] = true;
    delete window.galleryScrollStateFromSession[key];
    displayGalleryFromStartIndex(idx, false);
}
window.applyGallerySessionRestoreIfReady = displayGalleryApplyLateSessionRestore;

// Apply a provided image list to the gallery without fetching from server (used by search)
// IMPORTANT: allImages should ALWAYS be the full array, never filtered
// filteredImageIndices maps filtered position -> original file index in allImages
// We NEVER replace allImages with filtered array - we always access allImages[filteredImageIndices[filteredIndex]]
window.applyFilteredImages = function (images, originalIndices = null) {
    try {
        // Store original allImages if we don't have it yet (for filtering)
        // allImages should remain the full array, never be replaced with filtered array
        if (!window.originalAllImages || window.originalAllImages.length === 0) {
            window.originalAllImages = allImages;
        } else {
            allImages = window.originalAllImages;
        }

        // images parameter is the filtered array, but we DON'T replace allImages with it
        // allImages stays as the full array (we just restored it above)
        // originalIndices maps: filteredIndex -> original file index in allImages

        // Store the mapping of filtered images to their original indices in allImages
        if (originalIndices && Array.isArray(originalIndices) && originalIndices.length > 0) {
            window.filteredImageIndices = originalIndices;
        } else {
            // If no mapping provided or empty, clear filtering (no filtering active)
            // Create a default mapping where filteredIndex === fileIndex
            window.filteredImageIndices = allImages.map((_, index) => index);
        }

        resetInfiniteScroll();
        sortGalleryData();

        // Trigger build cache from filtered images if in search mode
        triggerBuildGalleryNavigationCache();

        displayCurrentPageOptimized();
        markGalleryDisplayed();
        updateGalleryTitleBar({ syncTaskbar: true });
        updateGalleryPlaceholders();
    } catch (e) {
        console.error('Error applying filtered images:', e);
    }
};

// Gallery view switching progress functions
function createGalleryWindowCenterEvent() {
    const galleryWindowEl = document.getElementById('galleryWindow');
    if (!galleryWindowEl) {
        return null;
    }

    // Measure even while opening/hidden (public/scripts/comp/modalUtils.js beginModalLayoutMeasure)
    let measureState = null;
    if (typeof beginModalLayoutMeasure === 'function') {
        measureState = beginModalLayoutMeasure(galleryWindowEl);
    } else if (galleryWindowEl.classList.contains('hidden')) {
        return null;
    }

    try {
        const rect = galleryWindowEl.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return null;
        }
        return {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            target: galleryWindowEl
        };
    } finally {
        if (measureState && typeof endModalLayoutMeasure === 'function') {
            endModalLayoutMeasure(galleryWindowEl, measureState);
        }
    }
}

function shouldAutoLaunchWorkspace() {
    try {
        return localStorage.getItem('dontAutoLaunchWorkspace') !== 'true';
    } catch (e) {
        return true;
    }
}
window.shouldAutoLaunchWorkspace = shouldAutoLaunchWorkspace;

function galleryProgressLeftLabel(viewType) {
    if (!viewType || viewType === 'images') {
        return 'Gallery';
    }
    return viewType.charAt(0).toUpperCase() + viewType.slice(1);
}

function showGalleryDataProgressModal(viewType = 'images') {
    syncGalleryProgressDialogState();
    if (isGalleryWindowHidden()) {
        return;
    }

    const viewName = galleryProgressLeftLabel(viewType);

    if (!window.isDesktop) {
        galleryProgressToastId = showGlassToast(
            'info',
            'Loading',
            `Loading ${viewName}...`,
            false,
            false,
            '<img class="loading" src="/static_images/azuspin.gif" alt="Loading" style="width: 34px; height: 34px;">'
        );
        return;
    }

    const progressHtml = `
        <div style="text-align: left; display: flex; flex-direction: column; gap: 8px;">
            <div role="progressbar" class="marquee animate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Gallery loading progress">
                <div id="galleryProgressBar"></div>
            </div>
            <div id="galleryProgressText" style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-accent);">${viewName}</span>
                <span style="color: var(--text-accent-tinted);">Loading...</span>
            </div>
        </div>
    `;

    const syntheticEvent = createGalleryWindowCenterEvent();

    // showConfirmationDialog returns a Promise — track ownership with a flag, not the Promise
    showConfirmationDialog(
        progressHtml,
        [],
        syntheticEvent,
        {
            title: 'Dreamscape Workspace',
            icon: 'fas fa-film-canister',
            showCloseButton: false,
            width: 400,
            manualPosition: true
        }
    );
    galleryProgressModal = true;

    if (!syntheticEvent) {
        requestAnimationFrame(() => {
            const retryEvent = createGalleryWindowCenterEvent();
            if (retryEvent && typeof positionConfirmationDialog === 'function') {
                positionConfirmationDialog(retryEvent);
            }
        });
    }

    setTimeout(() => {
        galleryProgressBarElement = document.getElementById('galleryProgressBar');
        galleryProgressTextElement = document.getElementById('galleryProgressText');
        galleryProgressContainerElement = galleryProgressBarElement ? galleryProgressBarElement.parentElement : null;
    }, 100);
}

function showGalleryProgressModal(viewType) {
    showGalleryDataProgressModal(viewType);
}

function showGalleryLoadingProgressModal() {
    showGalleryDataProgressModal('images');
}

function ensureGalleryLoadProgressVisible() {
    syncGalleryProgressDialogState();
    if (galleryProgressModal || galleryProgressToastId) {
        if (galleryProgressModal && typeof positionConfirmationDialog === 'function') {
            const centerEvent = createGalleryWindowCenterEvent();
            if (centerEvent) {
                positionConfirmationDialog(centerEvent);
            }
        }
        return false;
    }
    showGalleryLoadingProgressModal();
    return true;
}

function updateGalleryDataProgress(progress) {
    syncGalleryProgressDialogState();
    if (!galleryProgressModal && !galleryProgressToastId) {
        if (progress && progress.phase === 'block_fetch') {
            ensureGalleryLoadProgressVisible();
        } else if (isGalleryWindowHidden()) {
            return;
        } else {
            ensureGalleryLoadProgressVisible();
        }
    }
    if (!galleryProgressModal && !galleryProgressToastId) {
        return;
    }

    const modeRef = { value: galleryProgressModeSwitched };

    if (galleryProgressBarElement && galleryProgressTextElement) {
        galleryProgressModeSwitched = applyGalleryProgressBarState(
            galleryProgressContainerElement,
            galleryProgressBarElement,
            progress,
            modeRef
        );

        const statusSpan = galleryProgressTextElement.querySelector('span:last-child');
        if (statusSpan) {
            statusSpan.textContent = formatGalleryProgressStatusText(progress);
        }
    } else {
        const progressBar = document.getElementById('galleryProgressBar');
        const progressText = document.getElementById('galleryProgressText');
        const progressContainer = progressBar ? progressBar.parentElement : null;

        if (progressBar && progressText) {
            galleryProgressModeSwitched = applyGalleryProgressBarState(
                progressContainer,
                progressBar,
                progress,
                modeRef
            );

            const statusSpan = progressText.querySelector('span:last-child');
            if (statusSpan) {
                statusSpan.textContent = formatGalleryProgressStatusText(progress);
            }
        }
    }
}

function updateGalleryProgress(progress) {
    updateGalleryDataProgress(progress);
}

function updateGalleryLoadingProgress(progress) {
    updateGalleryDataProgress(progress);
}

function hideGalleryProgressModal() {
    if (galleryProgressModal) {
        hideConfirmationDialog();
        galleryProgressModal = null;
    }
    if (galleryProgressToastId) {
        removeGlassToast(galleryProgressToastId);
        galleryProgressToastId = null;
    }

    // Clear stored references and reset mode flag
    galleryProgressBarElement = null;
    galleryProgressTextElement = null;
    galleryProgressContainerElement = null;
    galleryProgressModeSwitched = false;
}

// Switch between gallery views
async function switchGalleryView(view, force = false, progressCallback = null) {
    if (currentGalleryView === view && !force) return;

    // Check if we're in the middle of workspace switching to avoid duplicate calls
    if (window.isWorkspaceSwitching && !force) {
        return;
    }

    // Don't switch gallery view if gallery is hidden in desktop mode (unless forced)
    if (!force && isGalleryWindowHidden()) return;

    // Don't switch gallery view if manual modal is open and maximized (unless forced)
    // Allow in windowed mode (desktop mode)
    //if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Clear selection when switching views
    clearSelection();

    // Clear search if active (skip reload since we're jumping)
    if (window.currentSearchTerm) {
        window.fileSearch.clearSearch(false, true); // Don't reload, just clear search
    }
    // clearStaleGalleryListCopies: public/scripts/comp/galleryView.js
    if (typeof clearStaleGalleryListCopies === 'function') {
        clearStaleGalleryListCopies();
    }

    // Clear DOM and in-memory list so the new view cannot reuse stale tiles or skip redraw
    // (displayGalleryContentIfNeeded bails when gallery.children.length > 0).
    clearGallery();
    resetInfiniteScroll();
    setActiveGalleryList([]);
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    if (galleryContainer && document.body.classList.contains('desktop-mode')) {
        galleryContainer.scrollTop = 0;
    }

    currentGalleryView = view;
    const loadToken = issueGalleryLoadToken(view);

    // Update button states
    galleryToggleGroup.querySelectorAll('.gallery-toggle-btn').forEach(btn => {
        btn.classList.remove('active');
    });
    galleryToggleGroup.querySelector(`[data-view="${view}"]`).classList.add('active');

    // Update slider position
    galleryToggleGroup.setAttribute('data-active', view);

    // Show progress indication for gallery view switching (unless we're in workspace switching)
    let galleryProgressShown = false;
    if (!window.isWorkspaceSwitching) {
        showGalleryProgressModal(view);
        galleryProgressShown = true;
    }

    // Handle view-specific logic
    switch (view) {
        case 'scraps':
            document.body.classList.add('scraps-grayscale');
            await loadScraps(progressCallback, loadToken);
            break;
        case 'images':
            document.body.classList.remove('scraps-grayscale');
            await loadGallery(false, progressCallback, {
                loadToken,
                showProgress: false
            });
            break;
        case 'pinned':
            document.body.classList.remove('scraps-grayscale');
            await loadPinned(progressCallback, loadToken);
            break;
        case 'upscaled':
            document.body.classList.remove('scraps-grayscale');
            await loadUpscaled(progressCallback, loadToken);
            break;
    }

    updateGalleryTitleBar({ syncTaskbar: true });

    // Update workspace overlay if modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) {
        if (manualPreviewWorkspaceOverlay.classList.contains('visible')) {
            loadWorkspaceImagesForOverlay();
        }
    }

    // Hide gallery progress if we showed it
    if (galleryProgressShown) {
        hideGalleryProgressModal();
    }

    // Workspace switch modal must clear even if inner load path skipped the callback
    if (typeof window.workspaceLoadingCompleteCallback === 'function') {
        window.workspaceLoadingCompleteCallback();
    }

    // Ensure tiles render when in-memory list was populated during load (IDB hit / sync)
    if (view === 'images' && allImages && allImages.length > 0 && !isGalleryWindowHidden() && !isJumpingToPosition) {
        if (window.isWorkspaceSwitching) {
            displayGalleryInitialPageOrRestored();
        } else {
            displayGalleryContentIfNeeded();
        }
    }
}

// Load scraps for current workspace
async function loadScraps(progressCallback = null, loadToken = null) {
    try {
        // Load complete scraps gallery
        if (window.wsClient && window.wsClient.isConnected()) {
            await loadCompleteGallery('scraps', progressCallback, loadToken);
            if (!isGalleryLoadTokenCurrent(loadToken)) {
                return;
            }

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Only build cache if not in search mode
            if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
                buildGalleryNavigationCache(allImages);
            }

            if (!isJumpingToPosition) {
                displayGalleryInitialPageOrRestored();
            }
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading scraps:', error);
        if (!isGalleryLoadTokenCurrent(loadToken)) {
            return;
        }
        setActiveGalleryList([]);
        if (!isJumpingToPosition) {
            resetInfiniteScroll();
            displayGalleryInitialPageOrRestored();
        }
    }
}

// Load pinned images for current workspace
async function loadPinned(progressCallback = null, loadToken = null) {
    try {
        // Load complete pinned gallery
        if (window.wsClient && window.wsClient.isConnected()) {
            await loadCompleteGallery('pinned', progressCallback, loadToken);
            if (!isGalleryLoadTokenCurrent(loadToken)) {
                return;
            }

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Build navigation cache after sorting
            buildGalleryNavigationCache(allImages);

            if (!isJumpingToPosition) {
                displayGalleryInitialPageOrRestored();
            }
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading pinned images:', error);
        if (!isGalleryLoadTokenCurrent(loadToken)) {
            return;
        }
        setActiveGalleryList([]);
        if (!isJumpingToPosition) {
            resetInfiniteScroll();
            displayGalleryInitialPageOrRestored();
        }
    }
}

// Load upscaled images for current workspace
async function loadUpscaled(progressCallback = null, loadToken = null) {
    try {
        // Load complete upscaled gallery
        if (window.wsClient && window.wsClient.isConnected()) {
            await loadCompleteGallery('upscaled', progressCallback, loadToken);
            if (!isGalleryLoadTokenCurrent(loadToken)) {
                return;
            }

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Build navigation cache after sorting
            buildGalleryNavigationCache(allImages);

            if (!isJumpingToPosition) {
                displayGalleryInitialPageOrRestored();
            }
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading upscaled images:', error);
        if (!isGalleryLoadTokenCurrent(loadToken)) {
            return;
        }
        setActiveGalleryList([]);
        if (!isJumpingToPosition) {
            resetInfiniteScroll();
            displayGalleryInitialPageOrRestored();
        }
    }
}

// Cache for jump points and dates
let cachedJumpPoints = null;
let cachedDateGroups = null;
let cachedJumpPointsLength = 0;

/**
 * Build and cache jump points and date groups from gallery data
 */
function buildGalleryNavigationCache(images) {
    if (!images || images.length === 0) {
        cachedJumpPoints = null;
        cachedDateGroups = null;
        cachedJumpPointsLength = 0;
        return;
    }

    const effectiveLength = images.length;

    // Build jump points cache
    const numPoints = Math.min(15, Math.max(10, Math.ceil(effectiveLength / 100)));
    const step = Math.floor(effectiveLength / numPoints);
    cachedJumpPoints = [];

    for (let i = 0; i < numPoints; i++) {
        const index = i * step;
        if (index >= effectiveLength) break;

        //const percentage = Math.round((index / effectiveLength) * 100);
        const label = i === 0 ? 'Start' : i === numPoints - 1 ? 'End' : `${index + 1}`;

        cachedJumpPoints.push({
            index: index,
            label: label
        });
    }
    cachedJumpPointsLength = effectiveLength;

    // Build date groups cache
    const dateMap = new Map(); // date string -> array of indices

    images.forEach((img, originalIndex) => {
        let date = null;

        // Try to get date from mtime first
        if (img.mtime) {
            date = new Date(img.mtime);
        } else if (img.receipt && img.receipt.length > 0) {
            // Use first receipt timestamp
            const firstReceipt = img.receipt[0];
            if (firstReceipt.timestamp) {
                date = new Date(firstReceipt.timestamp);
            }
        } else if (img.metadata && img.metadata.date) {
            date = new Date(img.metadata.date);
        }

        if (date && !isNaN(date.getTime())) {
            // Get date string (YYYY-MM-DD)
            const dateStr = date.toISOString().split('T')[0];

            if (!dateMap.has(dateStr)) {
                dateMap.set(dateStr, []);
            }
            dateMap.get(dateStr).push(originalIndex);
        }
    });

    if (dateMap.size === 0) {
        cachedDateGroups = null;
        return;
    }

    // Sort dates
    const sortedDates = Array.from(dateMap.keys()).sort().reverse(); // Newest first

    // Group consecutive days into weeks
    const weekGroups = [];
    let currentWeek = null;

    sortedDates.forEach((dateStr, idx) => {
        const date = new Date(dateStr);
        const indices = dateMap.get(dateStr);

        if (!currentWeek) {
            // Start new week
            currentWeek = {
                startDate: date,
                endDate: date,
                indices: [...indices],
                dates: [dateStr]
            };
        } else {
            // Check if this date is consecutive (within 1 day of end date)
            const daysDiff = Math.floor((currentWeek.endDate - date) / (1000 * 60 * 60 * 24));

            if (daysDiff === 1) {
                // Consecutive day, add to current week
                currentWeek.startDate = date;
                currentWeek.indices.push(...indices);
                currentWeek.dates.push(dateStr);
            } else {
                // Not consecutive, save current week and start new one
                weekGroups.push(currentWeek);
                currentWeek = {
                    startDate: date,
                    endDate: date,
                    indices: [...indices],
                    dates: [dateStr]
                };
            }
        }

        // If this is the last date, save the current week
        if (idx === sortedDates.length - 1) {
            weekGroups.push(currentWeek);
        }
    });

    cachedDateGroups = weekGroups;
}

// Load gallery images with optimized rendering to prevent flickering
async function loadGallery(addLatest, progressCallback = null, loadOptions = null) {
    const opts = (loadOptions && typeof loadOptions === 'object') ? loadOptions : {};
    const loadToken = opts.loadToken || null;

    // Check if spinner already exists (added in step 89)
    const spinner = document.getElementById('galleryLoadingSpinner');
    let galleryLoadingProgressShown = false;

    try {
        // Handle addLatest case (add new item without full reload)
        if (addLatest && allImages.length > 0) {
            // Fetch the latest item and add it to the gallery
            const result = await window.wsClient.requestGallery('images', true, {
                offset: 0,
                limit: 1,
                light: true,
                skipGalleryPagination: true
            });
            const payload = result.data || result;
            const { gallery: latestItems } = payload;
            const serverTotal = Number(payload.pagination?.totalItems || payload.total || 0);
            const serverDestructiveAt = Number(payload.lastGalleryDestructiveAt) || 0;
            const serverPinnedIndexes = Array.isArray(payload.pinnedIndexes) ? payload.pinnedIndexes : null;
            const workspaceId = getGalleryLoadWorkspaceId();

            let prependedLatest = false;
            if (latestItems && latestItems.length > 0) {
                // Prefer gallery_updated append_top — no-op when that path already added this row
                prependedLatest = prependToActiveGalleryList(latestItems[0]);

                if (prependedLatest) {
                    sortGalleryData();
                    if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
                        buildGalleryNavigationCache(allImages);
                    }

                    if (serverTotal === allImages.length) {
                        markGalleryImagesSyncState(
                            workspaceId,
                            'images',
                            allImages.length,
                            serverPinnedIndexes,
                            serverDestructiveAt
                        );
                    } else {
                        driftGalleryImagesSyncState(allImages.length);
                    }
                }
            }

            document.dispatchEvent(new CustomEvent('galleryUpdated'));

            const isGalleryHidden = isGalleryWindowHidden();
            if (prependedLatest && !isGalleryHidden && !isJumpingToPosition && !galleryRerollOwnsGalleryDom()) {
                await addNewGalleryItemAfterGeneration(allImages[0]);
            }

            if (window.workspaceLoadingCompleteCallback) {
                window.workspaceLoadingCompleteCallback();
            }

            // Clear stale full-gallery ticker rows when no chunk load is in flight (public/scripts/websocket.js)
            if (window.wsClient) {
                const hasActiveGalleryPagination = window.wsClient.pendingRequests &&
                    [...window.wsClient.pendingRequests.values()].some(
                        (r) => r.isGalleryPaginationRequest || r.isPaginationRequest
                    );
                if (!hasActiveGalleryPagination) {
                    window.wsClient.completeGalleryLoading();
                } else {
                    window.wsClient.updateTickerDisplay();
                }
            }

            spinner.classList.add('hidden');
            return;
        }

        // Load complete gallery by getting all pages
        if (window.wsClient && window.wsClient.isConnected()) {
            if (canJoinGalleryImagesLoad()) {
                return joinGalleryImagesLoad(progressCallback, opts);
            }

            const loadTask = {
                viewType: 'images',
                workspaceId: getGalleryLoadWorkspaceId(),
                loadToken,
                progressListeners: new Set(),
                lastProgress: null,
                promise: null
            };
            galleryImagesLoadTask = loadTask;

            if (shouldShowGalleryLoadProgress(opts)) {
                showGalleryLoadingProgressModal();
                galleryLoadingProgressShown = true;
            }

            loadTask.promise = (async () => {
                await loadCompleteGallery('images', progressCallback, loadToken);
                if (!isGalleryLoadTokenCurrent(loadToken)) {
                    return;
                }

                if (!shouldSkipGallerySortAfterSnapshotLoad()) {
                    sortGalleryData();
                }

                // Dispatch galleryUpdated event so background system can set initial image
                // This ensures the background is set only after gallery is actually loaded
                document.dispatchEvent(new CustomEvent('galleryUpdated'));

                // Check if gallery is hidden in desktop mode
                const isGalleryHidden = isGalleryWindowHidden();

                // Only update gallery display if:
                // - Manual modal is not open or is windowed
                // - Gallery is not hidden in desktop mode
                // - Not currently jumping to a position
                if (!isGalleryHidden && !isJumpingToPosition) {
                    if (addLatest) {
                        await addNewGalleryItemAfterGeneration(allImages[0]);
                    } else if (window.isWorkspaceSwitching) {
                        displayGalleryInitialPageOrRestored();
                    } else {
                        displayGalleryContentIfNeeded();
                    }
                }

                // Jump scrubber / date groups — not needed for first paint
                if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
                    buildGalleryNavigationCache(allImages);
                }

                // Set first gallery image in Android persistent notification when bridge is present
                if (allImages.length > 0 && typeof setAndroidNotificationImageFromImage === 'function') {
                    setAndroidNotificationImageFromImage(allImages[0]);
                }

                // Call workspace completion callback if it exists (for workspace switching)
                if (window.workspaceLoadingCompleteCallback) {
                    window.workspaceLoadingCompleteCallback();
                }
            })();

            try {
                await loadTask.promise;
            } finally {
                if (galleryImagesLoadTask === loadTask) {
                    galleryImagesLoadTask = null;
                }
            }

            // Hide progress modal if it was shown
            if (galleryLoadingProgressShown) {
                hideGalleryProgressModal();
            }

            spinner.classList.add('hidden');
        } else {
            throw new Error('WebSocket not connected');
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        // Don't throw error for gallery loading failure
        setActiveGalleryList([]);

        // Hide progress modal if it was shown
        if (galleryLoadingProgressShown) {
            hideGalleryProgressModal();
        }

        spinner.classList.add('hidden');

        // Check if gallery is hidden in desktop mode
        const isGalleryHidden = isGalleryWindowHidden();

        // Only update gallery display if manual modal is not open and gallery is not hidden
        if (!isGalleryHidden) {
            displayGalleryInitialPageOrRestored();
        }

        // Call workspace completion callback if it exists (for workspace switching)
        if (window.workspaceLoadingCompleteCallback) {
            window.workspaceLoadingCompleteCallback();
        }
    }
}

// Load gallery chunk with metadata
async function loadGalleryChunk(viewType = 'images', offset = 0, limit = 100, extraOpts = null) {
    const requestOpts = {
        offset: offset,
        limit: limit,
        light: true,
        ...(extraOpts && typeof extraOpts === 'object' ? extraOpts : {})
    };
    if (limit === 0) {
        requestOpts.skipGalleryPagination = true;
    }
    if (limit >= GALLERY_CHUNK_SIZE) {
        requestOpts.galleryBlockFetch = true;
        requestOpts.includePinnedStatus = false;
    }
    if (extraOpts && extraOpts.afterCursor) {
        requestOpts.afterCursor = extraOpts.afterCursor;
    }
    const includePinned = requestOpts.includePinnedStatus !== false;
    const result = await window.wsClient.requestGallery(viewType, includePinned, requestOpts);

    const payload = (result && result.data) ? result.data : result;
    const { gallery: chunk, pagination } = payload || {};
    return {
        chunk: chunk || [],
        hasMore: pagination?.hasMore || false,
        total: pagination?.totalItems || 0,
        blockSize: Number(payload.blockSize) || GALLERY_CHUNK_SIZE,
        blockOffset: Number(payload.blockOffset) || offset,
        pinnedIndexes: Array.isArray(payload.pinnedIndexes) ? payload.pinnedIndexes : [],
        lastGalleryDestructiveAt: Number(payload.lastGalleryDestructiveAt) || 0,
        workspaceId: payload.workspaceId || ((typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'default')
    };
}

async function refreshGalleryForReplicationToggle() {
    if (typeof hideReplicationGalleryBanner === 'function') {
        hideReplicationGalleryBanner();
    }
    try {
        await loadGallery(false, null, { showProgress: false });
    } catch (error) {
        console.error('Failed to refresh gallery after replication toggle:', error);
    }
}

// Load complete gallery by getting all pages and building allImages locally
async function loadCompleteGallery(viewType = 'images', progressCallback = null, loadToken = null) {
    const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'default';
    const loadLog = acquireGalleryLoadLogger(viewType, workspaceId);
    loadLog.step('start', 'Beginning gallery load', { viewType, workspaceId });

    const finishGalleryLoadProgress = (loaded, total, phase = 'complete') => {
        publishGalleryLoadProgress({
            loaded,
            total,
            offset: loaded,
            progress: 1,
            phase,
            blocksLeft: 0
        }, progressCallback);
        if (window.wsClient && typeof window.wsClient.completeGalleryLoading === 'function') {
            window.wsClient.completeGalleryLoading();
        }
    };

    try {
        let probe = await probeGalleryState(viewType, workspaceId, loadLog);
        let totalItems = probe.total || 0;
        let serverDestructiveAt = probe.lastGalleryDestructiveAt || 0;

        if (!totalItems) {
            const head = await loadGalleryChunk(viewType, 0, 1);
            totalItems = head.total || (head.chunk && head.chunk.length) || 0;
            serverDestructiveAt = head.lastGalleryDestructiveAt || serverDestructiveAt;
            probe = {
                total: totalItems,
                pinnedIndexes: head.pinnedIndexes || (probe && probe.pinnedIndexes) || [],
                lastGalleryDestructiveAt: head.lastGalleryDestructiveAt || serverDestructiveAt
            };
        }

        if (viewType === 'images' && canUseSessionGalleryMemory(workspaceId, viewType, probe)) {
            applyPinnedIndexesOverlay(allImages, probe.pinnedIndexes);
            if (Array.isArray(probe.pinnedIndexes)) {
                galleryImagesSyncState.pinnedIndexes = probe.pinnedIndexes.slice();
            }
            galleryImagesSyncState.destructiveAt = Number(probe.lastGalleryDestructiveAt) || galleryImagesSyncState.destructiveAt || 0;
            loadLog.done('loaded from session memory');
            emitGalleryCacheValidProgress(progressCallback, totalItems);
            finishGalleryLoadProgress(allImages.length, allImages.length, 'cache_valid');
            return;
        }

        const incrementalBase = resolveIncrementalSyncBaseGallery(workspaceId, viewType, totalItems, loadLog);
        const incrementalDelta = incrementalBase ? (totalItems - incrementalBase.length) : 0;
        if (incrementalBase
            && incrementalDelta > 0
            && incrementalDelta <= INCREMENTAL_HEAD_SYNC_MAX_DELTA
            && canAppendOnlyGallerySync(
                incrementalBase.length,
                totalItems,
                probe.lastGalleryDestructiveAt,
                galleryImagesSyncState?.destructiveAt
            )) {
            const incremental = await tryIncrementalGalleryHeadSync(
                incrementalBase,
                probe,
                viewType,
                progressCallback,
                loadLog
            );
            if (incremental && isGalleryLoadTokenCurrent(loadToken)) {
                await finalizeGalleryImagesLoad(
                    incremental.dataItems,
                    { ...probe, pinnedIndexes: incremental.probe.pinnedIndexes },
                    workspaceId,
                    viewType,
                    serverDestructiveAt,
                    loadLog,
                    loadToken
                );
                loadLog.done('loaded via incremental head sync');
                finishGalleryLoadProgress(totalItems, totalItems);
                return;
            }
        }

        if (totalItems > 0) {
            const fetched = await fetchAndFinalizeGalleryBlocks(
                viewType,
                workspaceId,
                totalItems,
                probe,
                serverDestructiveAt,
                progressCallback,
                loadLog,
                loadToken
            );
            if (fetched && isGalleryLoadTokenCurrent(loadToken)) {
                loadLog.done('loaded via server block fetch');
                finishGalleryLoadProgress(totalItems, totalItems);
                return;
            }
        }

        if (isGalleryLoadTokenCurrent(loadToken)) {
            if (allImages && allImages.length > 0) {
                loadLog.done('gallery load partial — keeping in-memory items');
                finishGalleryLoadProgress(allImages.length, totalItems || allImages.length);
                return;
            }
            setActiveGalleryList([]);
            loadLog.done('gallery load produced no items');
            finishGalleryLoadProgress(0, 0);
        }
    } catch (error) {
        loadLog.step('error', 'Gallery load failed', { message: error && error.message ? error.message : String(error) });
        if (window.wsClient && typeof window.wsClient.completeGalleryLoading === 'function') {
            window.wsClient.completeGalleryLoading();
        }
        console.error('Error loading complete gallery:', error);
        throw error;
    }
}

const GALLERY_DEEP_SCROLL_INDEX = 100;

function getGalleryScrollHeadIndex() {
    // getFirstVisibleRowIndex: public/scripts/comp/galleryView.js
    return typeof getFirstVisibleRowIndex === 'function'
        ? getFirstVisibleRowIndex()
        : (currentVisibleIndex || 0);
}

/** Any scroll away from the true head — use cheap index offset, do not jump to top. */
function isGalleryScrolledFromHead() {
    return getGalleryScrollHeadIndex() > 0;
}

/** Past first ~100 items — reroll uses zoom+overlay instead of inline head placeholder. */
function isGalleryDeepScrolled() {
    return getGalleryScrollHeadIndex() > GALLERY_DEEP_SCROLL_INDEX;
}

/** Cheap +1 index sync after a new head item — avoids full displayGalleryFromStartIndex reflow. */
function offsetGalleryItemIndexes(shiftAmount = 1, options = {}) {
    if (!gallery || !shiftAmount || shiftAmount <= 0) return;
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length === 0) return;

    let firstIndex = Infinity;
    items.forEach((el) => {
        const idx = parseInt(el.dataset.index || '0', 10) + shiftAmount;
        el.dataset.index = String(idx);
        if (idx < firstIndex) firstIndex = idx;

        if (window.filteredImageIndices && window.filteredImageIndices[idx] !== undefined) {
            el.dataset.fileIndex = String(window.filteredImageIndices[idx]);
        } else {
            el.dataset.fileIndex = String(idx);
        }
    });

    if (typeof currentVisibleIndex === 'number') {
        currentVisibleIndex += shiftAmount;
    }

    if (options.insertLeadingPlaceholder !== false && Number.isFinite(firstIndex) && firstIndex > 0) {
        const leadIndex = firstIndex - 1;
        const fileIndex = window.filteredImageIndices && window.filteredImageIndices[leadIndex] !== undefined
            ? window.filteredImageIndices[leadIndex]
            : leadIndex;
        const image = allImages[fileIndex];
        const placeholder = document.createElement('div');
        placeholder.className = 'gallery-item gallery-placeholder';
        placeholder.dataset.index = String(leadIndex);
        placeholder.dataset.fileIndex = String(fileIndex);
        placeholder.dataset.filename = image
            ? (image.filename || image.original || image.upscaled || `__ph_${leadIndex}`)
            : `__ph_${leadIndex}`;
        gallery.insertBefore(placeholder, gallery.firstChild);
    }

    // updateGalleryTitleBar: public/scripts/comp/galleryView.js
    updateGalleryTitleBar({ syncTaskbar: true });
}

/** Snapshot of what the user is looking at before a list replace. */
function captureGalleryViewportAnchor() {
    if (!isGalleryScrolledFromHead()) return null;
    const filteredIndex = getGalleryScrollHeadIndex();
    const fileIndex = window.filteredImageIndices && window.filteredImageIndices[filteredIndex] !== undefined
        ? window.filteredImageIndices[filteredIndex]
        : filteredIndex;
    const image = allImages[fileIndex];
    return {
        filteredIndex,
        filename: image ? (image.filename || image.original || image.upscaled || null) : null
    };
}

function resolveGalleryViewportAnchorIndex(anchor) {
    if (!anchor) return 0;
    const effectiveLength = window.filteredImageIndices && window.filteredImageIndices.length > 0
        ? window.filteredImageIndices.length
        : allImages.length;
    if (effectiveLength <= 0) return 0;

    if (anchor.filename) {
        const fileIdx = allImages.findIndex((img) =>
            img && (img.filename === anchor.filename || img.original === anchor.filename || img.upscaled === anchor.filename)
        );
        if (fileIdx >= 0) {
            if (window.filteredImageIndices && window.filteredImageIndices.length > 0) {
                const filteredIdx = window.filteredImageIndices.indexOf(fileIdx);
                if (filteredIdx >= 0) return filteredIdx;
            } else {
                return fileIdx;
            }
        }
    }

    return Math.max(0, Math.min(anchor.filteredIndex || 0, effectiveLength - 1));
}

/**
 * Replace gallery list and redisplay. When scrolled, keep the same viewport content
 * instead of resetInfiniteScroll + displayCurrentPageOptimized (which jumps to 0).
 */
function applyGalleryListReload(newImages, options = {}) {
    const preserveScroll = options.preserveScroll !== false;
    const anchor = preserveScroll ? captureGalleryViewportAnchor() : null;

    setActiveGalleryList(newImages);
    syncServiceWorkerImageCacheRules();
    // sortGalleryData: public/scripts/comp/galleryView.js
    if (typeof sortGalleryData === 'function') sortGalleryData();
    // triggerBuildGalleryNavigationCache: public/scripts/comp/galleryView.js / workspaceUtils
    if (typeof triggerBuildGalleryNavigationCache === 'function') {
        triggerBuildGalleryNavigationCache();
    } else if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
        buildGalleryNavigationCache(allImages);
    }
    // clearSelection: public/scripts/comp/galleryView.js
    if (typeof clearSelection === 'function') clearSelection();

    if (anchor) {
        const target = resolveGalleryViewportAnchorIndex(anchor);
        // displayGalleryFromStartIndex: public/scripts/comp/galleryView.js
        displayGalleryFromStartIndex(target, false);
        return 'preserved';
    }

    resetInfiniteScroll();
    displayCurrentPageOptimized();
    return 'head';
}

// Add a new gallery item after generation with fade-in and slide-in animations
async function addNewGalleryItemAfterGeneration(newImage) {
    if (galleryRerollOwnsGalleryDom()) return;
    // Don't add new gallery items if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't add new gallery items if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Upscale / re-delivery: upgrade existing base tile instead of skipping
    const existingDom = findGalleryDomItemByIdentity(newImage);
    if (existingDom) {
        updateGalleryItemElementFromData(existingDom, newImage);
        if (!isGalleryScrolledFromHead() && gallery.children[0] !== existingDom) {
            gallery.insertBefore(existingDom, gallery.children[0]);
            reindexGallery();
        }
        return;
    }

    // Scrolled away from head: keep viewport — only offset indexes (no jump-to-top / no insert into view)
    if (isGalleryScrolledFromHead()) {
        offsetGalleryItemIndexes(1);
        return;
    }

    // Skip img until placeholder clears — previews may not exist yet when gallery_updated arrives
    const newItem = createGalleryItem(newImage, 0, true);
    newItem.classList.add('gallery-placeholder', 'fade-in');
    gallery.insertBefore(newItem, gallery.children[0]);
    // Wait for fade-in animation to finish
    await new Promise(resolve => {
        newItem.addEventListener('animationend', function handler() {
            newItem.classList.remove('fade-in');
            newItem.removeEventListener('animationend', handler);
            resolve();
        });
    });
    // Remove placeholder class and show image, slide in
    newItem.classList.remove('gallery-placeholder');
    if (!newItem.querySelector('img')) {
        addImgToGalleryItemAsync(newItem, newImage);
    }
    newItem.classList.add('slide-in');
    newItem.addEventListener('animationend', function handler() {
        newItem.classList.remove('slide-in');
        newItem.removeEventListener('animationend', handler);
    });
    reindexGallery();
}

// Gallery reroll session
let activeGalleryRerollSession = null;
let lastGalleryRerollResolvedFilename = null;
const REROLL_GEN_CAP = 65;
const REROLL_HEAD_LIMIT = 10;

function galleryRerollUsesPlaceholder() {
    return !isGalleryWindowHidden()
        && (manualModal.classList.contains('hidden') || manualModal.classList.contains('windowed'));
}

function isGalleryRerollSessionActive() {
    return !!activeGalleryRerollSession?.requestId;
}

function isGalleryRerollRequest(requestId) {
    const s = activeGalleryRerollSession;
    if (!s?.requestId || s.completed) return false;
    if (s.requestId === requestId) return true;
    return window.wsClient?.pendingRequests?.get(requestId)?.type === 'reroll_image';
}

function galleryRerollOwnsGalleryDom() {
    const s = activeGalleryRerollSession;
    if (!s) return false;
    if (s.mode === 'overlay' && s.ui?.root?.isConnected) return true;
    if (s.mode === 'inline' && s.ui?.root?.isConnected) return true;
    return !!s.ui?.root?.isConnected;
}

async function rerollLoadHead() {
    const s = activeGalleryRerollSession;
    if (s?.head?.total) return s.head;
    if (!window.wsClient?.isConnected()) return null;
    const head = await loadGalleryChunk('images', 0, REROLL_HEAD_LIMIT);
    if (s) s.head = head;
    return head;
}

function paintGalleryRerollPlaceholder(percent, status, previewData) {
    const s = activeGalleryRerollSession;
    const ui = s?.ui;
    if (!ui?.root?.isConnected) return;
    const pct = Math.min(100, Math.max(s.lastProgress || 0, percent));
    s.lastProgress = pct;
    if (ui.bar) ui.bar.style.width = `${pct}%`;
    if (status && ui.status) ui.status.textContent = status;
    if (previewData && ui.preview) {
        const src = previewData.startsWith('data:') ? previewData : `data:image/jpeg;base64,${previewData}`;
        if (ui.preview.src !== src) ui.preview.src = src;
        ui.preview.classList.remove('hidden');
    }
}

function setGalleryRerollLock(locked) {
    const cls = 'gallery-reroll-locked';
    const zoomCls = 'gallery-reroll-zoomed';
    const galleryEl = document.getElementById('gallery');
    const container = document.querySelector('#galleryWindow .gallery-container');
    if (locked) {
        galleryEl?.classList.add(cls);
        container?.classList.add(cls);
    } else {
        galleryEl?.classList.remove(cls, zoomCls);
        container?.classList.remove(cls, zoomCls);
    }
}

function buildGalleryRerollGeneratingInnerHtml() {
    return '<div class="gallery-generating-overlay"><div class="gallery-generating-progress-track"><div class="gallery-generating-progress-bar"></div></div><div class="gallery-generating-status">Starting...</div><img class="gallery-generating-step-preview hidden" alt=""></div>';
}

function beginGalleryRerollOverlaySession(requestId) {
    const galleryEl = document.getElementById('gallery');
    const container = document.querySelector('#galleryWindow .gallery-container') || galleryEl?.parentElement;
    if (!container) return null;

    galleryEl?.classList.add('gallery-reroll-zoomed');
    container.classList.add('gallery-reroll-zoomed');

    const overlay = document.createElement('div');
    overlay.className = 'gallery-reroll-overlay';
    overlay.dataset.rerollRequestId = requestId;
    overlay.innerHTML = [
        '<div class="gallery-reroll-preview-square gallery-item gallery-placeholder gallery-generating">',
        buildGalleryRerollGeneratingInnerHtml(),
        '</div>',
        '<div class="gallery-reroll-overlay-actions round-button-row hidden">',
        '<button type="button" class="round-button btn-secondary" data-reroll-action="jump-top" title="Jump to top"><i class="fas fa-arrow-up"></i></button>',
        '<button type="button" class="round-button btn-secondary" data-reroll-action="open-studio" title="Open in Studio"><i class="fas fa-pen-field"></i></button>',
        '<button type="button" class="round-button btn-secondary" data-reroll-action="reroll-again" title="Reroll again"><i class="fas fa-dice"></i></button>',
        '<button type="button" class="round-button btn-secondary" data-reroll-action="download" title="Download"><i class="fas fa-download"></i></button>',
        '<button type="button" class="round-button btn-secondary" data-reroll-action="copy" title="Copy Image"><i class="fas fa-clipboard"></i></button>',
        '<button type="button" class="round-button btn-secondary" data-reroll-action="return" title="Close overlay and return"><i class="fas fa-xmark"></i></button>',
        '</div>'
    ].join('');

    container.appendChild(overlay);
    const square = overlay.querySelector('.gallery-reroll-preview-square');
    activeGalleryRerollSession.ui = {
        root: overlay,
        square,
        bar: overlay.querySelector('.gallery-generating-progress-bar'),
        status: overlay.querySelector('.gallery-generating-status'),
        preview: overlay.querySelector('.gallery-generating-step-preview'),
        actions: overlay.querySelector('.gallery-reroll-overlay-actions')
    };
    overlay.addEventListener('click', onGalleryRerollOverlayActionClick);
    return overlay;
}

function onGalleryRerollOverlayActionClick(event) {
    const btn = event.target.closest('[data-reroll-action]');
    if (!btn) return;
    event.preventDefault();
    event.stopPropagation();
    const action = btn.dataset.rerollAction;
    const s = activeGalleryRerollSession;
    const image = s?.resolvedImage;
    switch (action) {
        case 'jump-top':
            dismissGalleryRerollOverlay({ jumpToTop: true });
            break;
        case 'open-studio':
            if (image) {
                // openManualModalWithContent: public/scripts/comp/manualModalManager.js
                openManualModalWithContent({ type: 'image', image, metadata: image.metadata || null }, event);
            }
            break;
        case 'reroll-again':
            if (image) {
                const againImage = image;
                dismissGalleryRerollOverlay({ syncIndexes: true });
                // rerollImage: public/scripts/comp/galleryActions.js
                rerollImage(againImage, event);
            }
            break;
        case 'download':
            if (image) downloadImage(image);
            break;
        case 'copy':
            if (image) copyImageToClipboard(image);
            break;
        case 'return':
            dismissGalleryRerollOverlay({ syncIndexes: true });
            break;
    }
}

function showGalleryRerollOverlayActions(image) {
    const s = activeGalleryRerollSession;
    if (!s?.ui?.actions) return;
    s.resolvedImage = image || s.resolvedImage;
    if (s.ui.square) {
        s.ui.square.classList.remove('gallery-placeholder', 'gallery-generating');
        const genOverlay = s.ui.square.querySelector('.gallery-generating-overlay');
        if (genOverlay) genOverlay.remove();
        let img = s.ui.square.querySelector('img.gallery-reroll-result-img');
        if (!img) {
            img = document.createElement('img');
            img.className = 'gallery-reroll-result-img';
            s.ui.square.appendChild(img);
        }
        if (image) applyGalleryItemImage(img, image, { eager: true });
    }
    s.ui.actions.classList.remove('hidden');
}

function dismissGalleryRerollOverlay(options = {}) {
    const s = activeGalleryRerollSession;
    const wasOverlay = s?.mode === 'overlay';
    const resolved = s?.resolvedImage;
    clearGalleryRerollSession(false);
    if (options.jumpToTop) {
        // displayGalleryFromStartIndex: public/scripts/comp/galleryView.js
        displayGalleryFromStartIndex(0, !!resolved);
        return;
    }
    if (options.syncIndexes && wasOverlay) {
        offsetGalleryItemIndexes(1);
    }
}

function beginGalleryRerollSession(requestId) {
    if (!requestId) return null;
    const hidden = !galleryRerollUsesPlaceholder();
    const deep = !hidden && isGalleryDeepScrolled();
    activeGalleryRerollSession = {
        requestId,
        hidden,
        mode: hidden ? 'hidden' : (deep ? 'overlay' : 'inline'),
        lastProgress: 0,
        completed: false,
        ui: null,
        head: null,
        resolvedImage: null
    };
    if (hidden) return null;

    const galleryEl = document.getElementById('gallery');
    if (!galleryEl) return null;

    if (deep) {
        setGalleryRerollLock(true);
        return beginGalleryRerollOverlaySession(requestId);
    }

    // Near top: reflow to index 0 so the new tile is visible
    // displayGalleryFromStartIndex: public/scripts/comp/galleryView.js
    if (getFirstVisibleRowIndex() > 0) {
        displayGalleryFromStartIndex(0, false);
    } else {
        const galleryWindow = document.querySelector('#galleryWindow');
        const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
        if (galleryContainer && document.body.classList.contains('desktop-mode')) {
            galleryContainer.scrollTop = 0;
        } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
        }
    }

    const placeholder = document.createElement('div');
    placeholder.className = 'gallery-item gallery-placeholder gallery-generating fade-in';
    placeholder.dataset.filename = '__generating__';
    placeholder.dataset.rerollRequestId = requestId;
    placeholder.dataset.index = '0';
    placeholder.dataset.fileIndex = '0';
    placeholder.innerHTML = buildGalleryRerollGeneratingInnerHtml();
    galleryEl.insertBefore(placeholder, galleryEl.children[0]);
    activeGalleryRerollSession.ui = {
        root: placeholder,
        bar: placeholder.querySelector('.gallery-generating-progress-bar'),
        status: placeholder.querySelector('.gallery-generating-status'),
        preview: placeholder.querySelector('.gallery-generating-step-preview')
    };
    setGalleryRerollLock(true);
    placeholder.addEventListener('animationend', function handler() {
        placeholder.classList.remove('fade-in');
        placeholder.removeEventListener('animationend', handler);
    });
    return placeholder;
}

function updateGalleryRerollProgress(requestId, progressData) {
    const s = activeGalleryRerollSession;
    if (!isGalleryRerollRequest(requestId) || s.completed || s.hidden || !s.ui?.root?.isConnected) return;
    if (s.requestId !== requestId && window.wsClient?.pendingRequests?.get(requestId)?.type === 'reroll_image') {
        s.requestId = requestId;
        if (s.ui?.root) s.ui.root.dataset.rerollRequestId = requestId;
    }
    let pct = 0;
    // calculateGenerationProgress: public/scripts/comp/generationProgress.js
    if (typeof calculateGenerationProgress === 'function') {
        const raw = calculateGenerationProgress(progressData);
        if (progressData.phase === 'complete') pct = 100;
        else if (progressData.phase === 'previews') pct = Math.min(REROLL_GEN_CAP - 1, raw * REROLL_GEN_CAP / 100);
        else pct = raw * REROLL_GEN_CAP / 100;
    }
    // getGenerationStatusMessage: public/scripts/comp/generationProgress.js
    const status = typeof getGenerationStatusMessage === 'function'
        ? getGenerationStatusMessage(progressData)
        : 'Generating...';
    const previewData = progressData.imageData
        || (Array.isArray(progressData.stepFrames) && progressData.stepFrames.length
            ? progressData.stepFrames[progressData.stepFrames.length - 1].imageData
            : null);
    paintGalleryRerollPlaceholder(pct, status, previewData);
}

async function resolveGalleryRerollResultItem(filename) {
    if (!filename) return null;
    const match = (img) => img.original === filename || img.upscaled === filename || img.filename === filename;
    const inMemory = allImages.find(match);
    if (inMemory?.width != null) return inMemory;

    const upsert = (item) => {
        const slim = slimGalleryListItem(item);
        const name = slim.filename || slim.original || slim.upscaled;
        const idx = allImages.findIndex((img) => img.original === name || img.upscaled === name || img.filename === name);
        if (idx >= 0) {
            allImages[idx] = slim;
        } else {
            prependToActiveGalleryList(slim);
            sortGalleryData();
            if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
                buildGalleryNavigationCache(allImages);
            }
            driftGalleryImagesSyncState(allImages.length);
        }
        return slim;
    };

    try {
        const head = await rerollLoadHead();
        const fromHead = (head?.chunk || []).find(match);
        if (fromHead) return upsert(fromHead);
    } catch (error) {
        console.warn('Gallery reroll: head metadata fetch failed', error);
    }

    if (inMemory) return inMemory;

    const base = filename.replace(/\.(png|jpg|jpeg)$/i, '').replace(/_upscaled$/, '');
    const stub = { filename, base, preview: `${base}.webp`, mtime: Date.now() };
    if (filename.includes('_upscaled')) stub.upscaled = filename;
    else stub.original = filename;
    return upsert(stub);
}

function replaceGalleryRerollPlaceholder(placeholderEl, image) {
    if (!placeholderEl?.parentNode || !image) return null;
    const parent = placeholderEl.parentNode;
    const nextSibling = placeholderEl.nextSibling;
    disposeGalleryItemElement(placeholderEl);
    placeholderEl.remove();
    const newItem = createGalleryItem(image, 0, true);
    const img = document.createElement('img');
    applyGalleryItemImage(img, image, { eager: true });
    const overlay = newItem.querySelector('.gallery-item-overlay');
    if (overlay) newItem.insertBefore(img, overlay);
    else newItem.appendChild(img);
    newItem.classList.add('fade-in');
    parent.insertBefore(newItem, nextSibling);
    newItem.addEventListener('animationend', function handler() {
        newItem.classList.remove('fade-in');
        newItem.removeEventListener('animationend', handler);
    });
    reindexGallery();
    return newItem;
}

function clearGalleryRerollSession(removePlaceholder) {
    const s = activeGalleryRerollSession;
    if (!s) return;
    if (removePlaceholder !== false && s.ui?.root?.parentNode) {
        if (s.mode === 'inline') {
            disposeGalleryItemElement(s.ui.root);
            s.ui.root.remove();
            reindexGallery();
        } else if (s.mode === 'overlay') {
            s.ui.root.removeEventListener('click', onGalleryRerollOverlayActionClick);
            s.ui.root.remove();
        }
    } else if (s.mode === 'overlay' && s.ui?.root?.parentNode) {
        s.ui.root.removeEventListener('click', onGalleryRerollOverlayActionClick);
        s.ui.root.remove();
    }
    setGalleryRerollLock(false);
    activeGalleryRerollSession = null;
}

async function completeGalleryRerollSession(requestId, filename, options = {}) {
    const s = activeGalleryRerollSession;
    if (!isGalleryRerollRequest(requestId) || s.completed) return null;
    s.completed = true;
    if (s.requestId !== requestId && window.wsClient?.pendingRequests?.get(requestId)?.type === 'reroll_image') {
        s.requestId = requestId;
    }
    window.skipNextGalleryRefresh = (window.skipNextGalleryRefresh || 0) + 2;
    paintGalleryRerollPlaceholder(REROLL_GEN_CAP, 'Finalizing...');

    const resolvedImage = await resolveGalleryRerollResultItem(filename);
    s.resolvedImage = resolvedImage;
    lastGalleryRerollResolvedFilename = filename;
    syncServiceWorkerImageCacheRules();

    // Deep-scroll overlay: keep zoom + preview actions; do not jump or open viewer
    if (s.mode === 'overlay' && s.ui?.root?.isConnected) {
        paintGalleryRerollPlaceholder(100, 'Complete');
        showGalleryRerollOverlayActions(resolvedImage);
        return resolvedImage;
    }

    let resolvedElement = null;
    if (!s.hidden && s.mode === 'inline' && s.ui?.root) {
        resolvedElement = replaceGalleryRerollPlaceholder(s.ui.root, resolvedImage);
        s.ui = null;
    }
    clearGalleryRerollSession(false);
    if (options.openPreview !== false && resolvedImage) {
        // openGalleryImageInViewer: public/scripts/comp/imageViewer.js
        openGalleryImageInViewer(resolvedImage);
    }
    return resolvedElement || resolvedImage;
}

function failGalleryRerollSession(requestId) {
    if (isGalleryRerollRequest(requestId) || activeGalleryRerollSession?.requestId === requestId) {
        clearGalleryRerollSession(true);
    }
}

// Helper function to get gallery container dimensions
function getGalleryContainerDimensions() {
    if (!gallery) return { width: 0, height: 0 };

    // Detect scroll container (gallery-container is always used when available)
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');

    let containerWidth, containerHeight;

    if (isContainerScroll && galleryContainer) {
        // Desktop modal mode - use container dimensions
        containerWidth = galleryContainer.clientWidth;
        containerHeight = galleryContainer.clientHeight;
    } else {
        // Mobile/normal mode - use gallery element dimensions
        const galleryRect = gallery.getBoundingClientRect();
        containerWidth = galleryRect.width;
        containerHeight = galleryRect.height;
    }

    return { width: containerWidth, height: containerHeight };
}

// Get item size (width = height since items are square)
function getItemSize() {
    if (!gallery) return 200; // Fallback

    // Calculate item size from actual rendered items if available
    let items = gallery.querySelectorAll('.gallery-item:not(.gallery-placeholder), .gallery-placeholder.gallery-item');

    // If no items exist, create a temporary placeholder to measure actual rendered size
    let tempPlaceholder = null;
    if (items.length === 0) {
        // Create a temporary placeholder item with minimal structure
        // Must be in grid flow (not absolute) to get proper sizing from CSS grid
        tempPlaceholder = document.createElement('div');
        tempPlaceholder.className = 'gallery-item gallery-placeholder';
        tempPlaceholder.style.opacity = '0'; // Make invisible but keep in layout
        tempPlaceholder.style.pointerEvents = 'none'; // Don't interfere with interactions

        // Add minimal content to ensure proper aspect ratio (items are square)
        const img = document.createElement('img');
        img.style.width = '100%';
        img.style.height = '100%';
        img.style.objectFit = 'cover';
        // Use a 1x1 transparent SVG to maintain aspect ratio
        img.src = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 1 1"><rect width="1" height="1" fill="transparent"/></svg>';
        tempPlaceholder.appendChild(img);

        // Append to gallery temporarily (must be in DOM for grid sizing to apply)
        gallery.appendChild(tempPlaceholder);

        // Force a reflow to ensure the item is rendered and measured
        void tempPlaceholder.offsetWidth;
    }

    if (items.length > 0 || tempPlaceholder) {
        // Use actual rendered item width (height = width since items are square)
        const itemToMeasure = tempPlaceholder || items[0];
        const itemRect = itemToMeasure.getBoundingClientRect();
        const itemSize = itemRect.width;

        // Remove temporary placeholder if we created one
        if (tempPlaceholder && tempPlaceholder.parentNode) {
            const tempImg = tempPlaceholder.querySelector('img');
            if (tempImg) {
                releaseGalleryItemImage(tempImg);
            }
            tempPlaceholder.remove();
        }

        return itemSize > 0 ? itemSize : 200; // Fallback if measurement fails
    }
}

// Calculate optimal number of rows based on gallery container height
function calculateGalleryRows() {
    if (!gallery) return 5; // Fallback to 5 if gallery not found

    // Get gallery container dimensions
    const { height: containerHeight } = getGalleryContainerDimensions();
    if (containerHeight <= 0) return 5;

    // Gallery items are square (aspect-ratio: 1), so height equals width
    const itemHeight = itemSizePx > 0 ? itemSizePx : getItemSize();

    // Calculate how many rows can fit in the container
    const calculatedRows = Math.floor(containerHeight / itemHeight);

    // Ensure minimum of 3 rows and maximum of 8 rows for usability
    return Math.max(3, Math.min(8, calculatedRows));
}

function updateGalleryPlaceholders() {
    if (!gallery) return;

    // Don't update gallery if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't update gallery if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Don't remove placeholders here - they are managed by the virtual scrolling system
    // This function is called during initial display and should not interfere with
    // the placeholder management during scrolling

    // Only remove placeholders if we're doing a complete gallery reset
    // (e.g., switching views, applying filters, etc.)
    if (isGalleryResetting) {
        Array.from(gallery.querySelectorAll('.gallery-placeholder')).forEach((el) => {
            disposeGalleryItemElement(el);
            el.remove();
        });
        isGalleryResetting = false;
    }
}

// Optimized display function for infinite scroll using document fragment
function displayCurrentPageOptimized() {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;

    // Initialize gallery minmax value on first display
    initializeGalleryMinmaxValue();

    // Don't update gallery if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't update gallery if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Update infinite scrolling calculations
    updateGalleryGrid();

    // Set flag for complete gallery reset
    isGalleryResetting = true;

    disposeGalleryContents();
    if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
    }

    // Clear gallery
    gallery.innerHTML = '';

    // If no images, show empty state
    if (allImages.length === 0) {
        return;
    }

    displayedStartIndex = 0;
    const itemHeight = getItemSize();
    const { height: containerHeight } = getGalleryContainerDimensions();
    const itemsPerCol = containerHeight > 0 ? Math.floor(containerHeight / itemHeight) : 5;
    const buffer = Math.ceil(itemsPerCol * 0.15);
    // Use filteredImageIndices length if filtering is active, otherwise use allImages length
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    const totalItems = Math.min((itemsPerCol + buffer) * realGalleryColumns, effectiveLength);
    displayedEndIndex = totalItems;

    const fragment = document.createDocumentFragment();
    for (let i = displayedStartIndex; i < displayedEndIndex; i++) {
        // i is filtered position, get file index from filteredImageIndices to access allImages
        const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined
            ? window.filteredImageIndices[i]
            : i;
        const image = allImages[fileIndex];
        if (image) {
            const galleryItem = createGalleryItem(image, i); // i is filtered position for data-index
            galleryItem.classList.add('fade-in');
            fragment.appendChild(galleryItem);
        }
    }
    gallery.appendChild(fragment);

    // Fade in items one by one
    const items = gallery.querySelectorAll('.gallery-item.fade-in');
    items.forEach((el, idx) => {
        setTimeout(() => {
            el.classList.add('fade-in');
            el.addEventListener('animationend', function handler() {
                el.classList.remove('fade-in');
                el.removeEventListener('animationend', handler);
            });
        }, idx * 60);
    });

    // Use filteredImageIndices length if filtering is active, otherwise use allImages length
    const displayEffectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    hasMoreImages = displayedEndIndex < displayEffectiveLength;
    hasMoreImagesBefore = displayedStartIndex > 0;

    // Send gallery position hint for prefetching (throttled)
    sendGalleryPositionHint();

    // Initialize intersection observer for better performance
    initIntersectionObserver();

    // Observe all gallery items for intersection changes
    if (intersectionObserver) {
        items.forEach(item => {
            intersectionObserver.observe(item);
        });
    }

    // Clear resetting flag before virtual scroll so placeholders can be added
    isGalleryResetting = false;

    // Update gallery grid first to ensure calculations are correct
    updateGalleryGrid(true, true); // onlyIfChanged=true, updatePlaceholders=true

    // Add placeholders below initial items
    addPlaceholdersBelow();

    // Update virtual scroll to manage placeholder states
    updateVirtualScroll();
}

function resetInfiniteScroll() {
    // Clean up intersection observer for better performance
    if (intersectionObserver) {
        intersectionObserver.disconnect();
        intersectionObserver = null;
    }

    purgePlaceholderResolutionQueue();

    // Clean up placeholder cleanup queue for iOS
    if (placeholderCleanupQueue.length > 0) {
        placeholderCleanupQueue.length = 0;
    }

    // Clear scroll timeouts
    if (scrollEndTimeout) {
        clearTimeout(scrollEndTimeout);
        scrollEndTimeout = null;
    }

    window.scrollTo({ top: 0, behavior: 'instant' });
    displayedStartIndex = 0;
    displayedEndIndex = 0;
    isLoadingMore = false;
    hasMoreImages = true;
    hasMoreImagesBefore = false;

    updateGalleryGrid();

    if (infiniteScrollLoading) {
        infiniteScrollLoading.classList.add('hidden');
    }
}

// Create gallery item element
// Optimized function that reuses existing elements instead of always creating new ones
function getOrCreateGalleryItem(image, index, skipImgElement = false) {
    // Calculate the filename for this image
    const filename = image.filename || image.original || image.upscaled;

    // Check if an element already exists for this image
    let existingItem = null;

    // First try to find by exact data-index (most reliable)
    existingItem = gallery.querySelector(`[data-index="${index}"]`);

    // If not found, try by filename (fallback)
    if (!existingItem) {
        existingItem = gallery.querySelector(`[data-filename="${filename}"]`);
    }

    if (existingItem) {
        // Update data attributes
        existingItem.dataset.index = index;

        // Calculate file index
        let fileIndex = index;
        if (window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0) {
            if (window.filteredImageIndices[index] !== undefined) {
                fileIndex = window.filteredImageIndices[index];
            }
        }
        existingItem.dataset.fileIndex = fileIndex.toString();

        // Update selection state
        const isSelected = isImageSelected(filename);
        existingItem.dataset.selected = isSelected ? 'true' : 'false';
        if (isSelected) {
            existingItem.classList.add('selected');
        } else {
            existingItem.classList.remove('selected');
        }

        // Handle img element based on skipImgElement parameter
        const hasImg = existingItem.querySelector('img');
        if (skipImgElement && hasImg) {
            // Remove img element if we don't want it (converting to placeholder)
            removeImgFromGalleryItem(existingItem);
        } else if (!skipImgElement && !hasImg) {
            // Add img element if we need it (resolving from placeholder)
            addImgToGalleryItemAsync(existingItem, image);
        }

        return existingItem;
    } else {
        return createGalleryItem(image, index, skipImgElement);
    }
}

function createGalleryItem(image, index, skipImgElement = false) {
    const item = document.createElement('div');
    item.className = 'gallery-item fade-in';
    const filename = image.filename || image.original || image.upscaled;
    item.dataset.filename = filename;
    item.dataset.time = image.mtime || 0;
    item.dataset.index = index;

    // Add data-file-index to track the true position in allImages array (the full array)
    // index is the filtered position, filteredImageIndices maps to original file index in allImages
    let fileIndex = index;
    if (window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0) {
        if (window.filteredImageIndices[index] !== undefined) {
            fileIndex = window.filteredImageIndices[index]; // Get original file index from filtered position
        }
    }
    item.dataset.fileIndex = fileIndex.toString();

    // Use data-selected as single source of truth for selection state
    const isSelected = isImageSelected(filename);
    item.dataset.selected = isSelected ? 'true' : 'false';
    if (isSelected) {
        item.classList.add('selected');
    } else {
        item.classList.remove('selected');
    }

    // Add selection checkbox
    const checkbox = document.createElement('input');
    checkbox.type = 'checkbox';
    checkbox.className = 'gallery-item-checkbox';
    checkbox.dataset.filename = filename;
    checkbox.checked = isSelected;

    // ALT+click range selection on click event
    checkbox.addEventListener('click', (e) => {
        if (e.altKey) {
            e.preventDefault();

            // Find clicked item's index in the array (not DOM order)
            const clickedArrayIndex = findImageArrayIndex(filename);

            if (clickedArrayIndex === -1) return;

            // Find last selected item's index in the array using selectedImages Set
            let lastSelectedArrayIndex = null;
            if (selectedImages.size > 0) {
                // Find the last selected item by checking allImages array
                const sourceArray = window.filteredImageIndices && window.filteredImageIndices.length > 0
                    ? window.filteredImageIndices.map(idx => allImages[idx]).filter(img => img)
                    : allImages;

                // Find both the lowest and highest selected indices
                let lowestSelectedIndex = null;
                let highestSelectedIndex = null;

                for (let i = 0; i < sourceArray.length; i++) {
                    const img = sourceArray[i];
                    const imgFilename = img.filename || img.original || img.upscaled;
                    if (selectedImages.has(imgFilename)) {
                        if (lowestSelectedIndex === null) {
                            lowestSelectedIndex = i;
                        }
                        highestSelectedIndex = i;
                    }
                }

                // Determine which selected index to use based on clicked position
                if (lowestSelectedIndex !== null && highestSelectedIndex !== null) {
                    // If clicking before the lowest, use lowest as range start
                    // If clicking after the highest, use highest as range start
                    // If clicking between, use the closest one
                    if (clickedArrayIndex < lowestSelectedIndex) {
                        lastSelectedArrayIndex = lowestSelectedIndex;
                    } else if (clickedArrayIndex > highestSelectedIndex) {
                        lastSelectedArrayIndex = highestSelectedIndex;
                    } else {
                        // Clicking between - use the closest selected index
                        const distToLowest = Math.abs(clickedArrayIndex - lowestSelectedIndex);
                        const distToHighest = Math.abs(clickedArrayIndex - highestSelectedIndex);
                        lastSelectedArrayIndex = distToLowest <= distToHighest ? lowestSelectedIndex : highestSelectedIndex;
                    }
                } else if (lowestSelectedIndex !== null) {
                    lastSelectedArrayIndex = lowestSelectedIndex;
                } else if (highestSelectedIndex !== null) {
                    lastSelectedArrayIndex = highestSelectedIndex;
                }
            }

            // Fallback to lastSelectedGalleryIndex if no selected items found
            if (lastSelectedArrayIndex === null && lastSelectedGalleryIndex !== null) {
                lastSelectedArrayIndex = lastSelectedGalleryIndex;
            }

            if (lastSelectedArrayIndex !== null && clickedArrayIndex !== -1) {
                const [start, end] = [lastSelectedArrayIndex, clickedArrayIndex].sort((a, b) => a - b);

                // Get the source array (filtered or full)
                const sourceArray = window.filteredImageIndices && window.filteredImageIndices.length > 0
                    ? window.filteredImageIndices.map(idx => allImages[idx]).filter(img => img)
                    : allImages;

                // Select all items in range using array indices
                for (let i = start; i <= end; i++) {
                    if (i >= 0 && i < sourceArray.length) {
                        const img = sourceArray[i];
                        const itemFilename = img.filename || img.original || img.upscaled;

                        // Add to selection
                        selectedImages.add(itemFilename);

                        // Update DOM if item is visible
                        const div = document.querySelector(`[data-filename="${itemFilename}"]`);
                        if (div) {
                            div.dataset.selected = 'true';
                            div.classList.add('selected');
                            const cb = div.querySelector('.gallery-item-checkbox');
                            if (cb) cb.checked = true;
                        }
                    }
                }

                updateBulkActionsBar();
                lastSelectedGalleryIndex = clickedArrayIndex;
                return;
            }
        }
    });

    // Normal selection on change event
    checkbox.addEventListener('change', (e) => {
        if (!e.altKey) {
            e.stopPropagation();
            handleImageSelection(image, e.target.checked, e);
        }
    });


    // Only create img element if not skipping (for placeholders)
    let img = null;
    if (!skipImgElement) {
        // public/scripts/comp/blurhashUtil.js
        applyBlurhashPlaceholder(item, image.blurhash);
        img = document.createElement('img');
        applyGalleryItemImage(img, image);
    }

    const overlay = document.createElement('div');
    overlay.className = 'gallery-item-overlay';

    // Create action buttons
    const actionsDiv = document.createElement('div');
    actionsDiv.className = 'gallery-actions';

    // Download button
    const downloadBtn = document.createElement('button');
    downloadBtn.type = 'button';
    downloadBtn.className = 'btn-primary round-button';
    downloadBtn.innerHTML = '<i class="fas fa-download"></i>';
    downloadBtn.title = 'Download';
    downloadBtn.onclick = (e) => {
        e.stopPropagation();
        downloadImage(image);
    };

    // Copy button
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'btn-primary round-button';
    copyBtn.innerHTML = '<i class="fas fa-clipboard"></i>';
    copyBtn.title = 'Copy to clipboard';
    copyBtn.onclick = (e) => {
        e.stopPropagation();
        copyImageToClipboard(image);
    };

    // Pin button
    const pinBtn = document.createElement('button');
    pinBtn.type = 'button';
    pinBtn.className = 'btn-primary round-button';

    // Set initial pin button state from WebSocket data if available
    if (image.isPinned !== undefined) {
        if (image.isPinned) {
            pinBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
            pinBtn.title = 'Unpin image';
        } else {
            pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
            pinBtn.title = 'Pin image';
        }
    } else {
        // Default to unpinned if not provided (newly generated images can't be pinned)
        pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
        pinBtn.title = 'Pin image';
    }

    pinBtn.onclick = (e) => {
        e.stopPropagation();
        togglePinImage(image, pinBtn);
    };

    actionsDiv.appendChild(pinBtn);
    actionsDiv.appendChild(copyBtn);
    actionsDiv.appendChild(downloadBtn);

    overlay.appendChild(actionsDiv);

    item.appendChild(checkbox);
    if (img) {
        item.appendChild(img);
    }
    item.appendChild(overlay);

    // Add context menu to gallery item
    if (contextMenu) {
        // Create move workspace submenu options function
        const contextMenuConfig = {
            maxHeight: true,
            sections: [
                {
                    type: 'icons',
                    position: 'outer',
                    icons: [
                        {
                            icon: 'fas fa-check',
                            tooltip: 'Select',
                            action: 'toggle-checkbox',
                            loadfn: (menuItem, target) => {
                                // Get gallery item and checkbox
                                const galleryItem = target.closest('.gallery-item');
                                if (galleryItem) {
                                    const checkbox = galleryItem.querySelector('.gallery-item-checkbox');
                                    if (checkbox) {
                                        const isChecked = checkbox.checked;
                                        menuItem.icon = isChecked ? 'fa-solid fa-square-check' : 'fa-regular fa-square-check';
                                        menuItem.tooltip = isChecked ? 'Deselect' : 'Select';
                                    }
                                }
                            }
                        },
                        {
                            icon: 'fas fa-up-to-dotted-line',
                            tooltip: 'Select All Before',
                            action: 'select-all-before-item'
                        },
                        {
                            icon: 'fa-regular fa-star', // Default icon, will be updated by loadfn
                            tooltip: 'Favorite', // Default text, will be updated by loadfn
                            action: 'toggle-favorite',
                            loadfn: (menuItem, target) => {
                                // Get image data from target element
                                const fileIndex = parseInt(target.dataset.fileIndex, 10);
                                const image = allImages && allImages[fileIndex];

                                if (image) {
                                    // Update favorite icon and tooltip based on current pin status
                                    const isPinned = image.isPinned;
                                    menuItem.icon = isPinned ? 'fa-solid fa-star' : 'fa-regular fa-star';
                                    menuItem.tooltip = isPinned ? 'Unfavorite' : 'Favorite';
                                }
                            }
                        },
                        {
                            icon: 'fas fa-dice-three',
                            tooltip: 'Recast Spell',
                            action: 'reroll'
                        },
                        {
                            icon: 'fas fa-download',
                            tooltip: 'Download',
                            action: 'download'
                        },
                        {
                            icon: 'fas fa-clipboard',
                            tooltip: 'Copy',
                            action: 'copy'
                        },
                    ]
                },
                {
                    type: 'list',
                    items: [
                        {
                            icon: 'fas fa-external-link-alt',
                            text: 'Open in Window',
                            action: 'open-in-window',
                            hideOnBreakpoint: "small-mobile"
                        },
                        {
                            icon: 'fas fa-compass-drafting',
                            text: 'Edit in DreamStudio',
                            action: 'modify',
                            hideOnBreakpoint: "small-mobile"
                        },
                        {
                            icon: 'mdi mdi-1-25 mdi-relative-scale',
                            text: 'Expand Canvas',
                            action: 'expand-canvas'
                        },
                        {
                            icon: 'nai-upscale',
                            text: 'Upscale',
                            action: 'upscale',
                            disabled: !!image.upscaled,
                            loadfn: (menuItem, target) => {
                                // Get image data from target element
                                const fileIndex = parseInt(target.dataset.fileIndex, 10);
                                const image = allImages && allImages[fileIndex];

                                if (image) {
                                    // Check if already upscaled
                                    if (image.upscaled) {
                                        menuItem.disabled = true;
                                        return;
                                    }

                                    // Check if dimensions are too large for upscaling
                                    if (image.width && image.height) {
                                        const upscaleInfo = calculateUpscaleInfo(image.width, image.height);
                                        if (!upscaleInfo.available) {
                                            menuItem.disabled = true;
                                            menuItem.subtitle = 'Image too large';
                                        } else {
                                            menuItem.disabled = false;
                                            menuItem.subtitle = null;
                                        }
                                    } else {
                                        // Default to enabled if dimensions unknown
                                        menuItem.disabled = false;
                                    }
                                }
                            }
                        },
                        {
                            icon: 'fas fa-glasses-round',
                            text: 'Properties',
                            action: 'view-image-data',
                            disabled: !image?.filename && !image?.metadata
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-person-to-portal',
                            text: 'Create Chat',
                            action: 'start-chat'
                        },
                        {
                            icon: 'fas fa-globe',
                            text: 'Publish to Explorer',
                            action: 'publish-to-explorer'
                        },
                        {
                            icon: 'fas fa-image',
                            text: 'Set as Wallpaper',
                            action: 'set-wallpaper',
                            hidden: () => !document.body.classList.contains('desktop-mode')
                        },
                        {
                            icon: 'fas fa-arrow-down-left',
                            text: 'Add to Desktop',
                            action: 'create-desktop-shortcut',
                            hidden: () => !document.body.classList.contains('desktop-mode')
                        },
                    ]
                },
                {
                    type: 'list',
                    title: 'Management',
                    items: [
                        {
                            icon: 'fas fa-crosshairs',
                            text: 'Jump to Image',
                            action: 'jump-to-image',
                            hidden: () => {
                                const currentView = currentGalleryView || 'images';
                                const hasSearch = window.currentSearchTerm;
                                // Show when not in default images view OR when in search mode
                                return currentView === 'images' && !hasSearch;
                            }
                        },
                        {
                            icon: 'nai-img2img',
                            text: 'New Reference',
                            action: 'create-reference'
                        },
                        {
                            icon: 'fas fa-folder-arrow-up',
                            text: 'Move to...',
                            optionsfn: getMoveWorkspaceOptions,
                            handlerfn: handleMoveWorkspaceAction,
                            openOnHover: false
                        },
                        {
                            icon: 'fas fa-bin-recycle',
                            text: 'Scrap',
                            action: 'scrap',
                            loadfn: (menuItem, target) => {
                                // Update scrap tooltip based on current view
                                const currentView = currentGalleryView || 'images';
                                if (currentView === 'scraps') {
                                    menuItem.tooltip = 'Restore';
                                    menuItem.icon = 'nai-dot-reset';
                                }
                            }
                        },
                        {
                            icon: 'fas fa-fire',
                            text: 'Incinerate',
                            action: 'delete'
                        }
                    ]
                }
            ]
        };

        contextMenu.attachToElement(item, contextMenuConfig);
    }

    // If we're in selection mode, switch to bulk context menu for this new item
    if (isSelectionMode && contextMenu && !item.dataset.bulkContextMenuActive) {
        // Store original context menu config
        const originalConfigId = item.dataset.contextMenu;
        if (originalConfigId && contextMenu.configs && contextMenu.configs[originalConfigId]) {
            item.dataset.originalContextMenuConfig = originalConfigId;
            item.dataset.originalContextMenuStored = 'true';
        }

        // Attach bulk context menu
        const bulkActionsConfig = getBulkActionsContextMenuConfig();
        contextMenu.attachToElement(item, bulkActionsConfig);
        item.dataset.bulkContextMenuActive = 'true';
    }

    item.addEventListener('click', (e) => {
        // Don't open lightbox if clicking on checkbox
        if (e.target.type === 'checkbox') {
            return;
        }

        if (isSelectionMode) {
            e.preventDefault();
            e.stopPropagation();
            const cb = item.querySelector('.gallery-item-checkbox');
            if (cb) {
                cb.checked = !cb.checked;
                handleImageSelection(image, cb.checked, { target: cb, altKey: false });
            }
            return;
        }

        // Pass the element itself - showLightbox will extract index at click time (not cached)
        showLightbox({ element: item });
    });

    // Remove fade-in class after animation completes
    item.addEventListener('animationend', function handler(e) {
        if (e.animationName === 'galleryFadeIn') {
            item.classList.remove('fade-in');
            item.removeEventListener('animationend', handler);
        }
    });

    return item;
}

// Add img element to a placeholder item when resolving it
function addImgToGalleryItem(item, image) {
    // Don't add if img already exists
    if (item.querySelector('img')) {
        return;
    }

    // Create img element (same logic as in createGalleryItem)
    const img = document.createElement('img');
    const previewUrl = getGalleryPreviewUrl(image.preview);
    img.alt = image.base;
    img.classList.add('loading-image');
    img.loading = 'lazy';

    img.onload = function () {
        // Image loaded successfully - CSS transition will handle showing it
        img.classList.remove('loading-image');
    };

    img.src = `/previews/${encodeURIComponent(previewUrl)}`;

    // BlurHash placeholder behind thumb while loading (public/scripts/comp/blurhashUtil.js)
    applyBlurhashPlaceholder(item, image.blurhash);

    img.onerror = function () {
        // Keep image hidden when it fails to load
        this.onerror = null; // Prevent infinite loop
    };

    // Insert img element before the overlay (same position as in createGalleryItem)
    const overlay = item.querySelector('.gallery-item-overlay');
    if (overlay) {
        item.insertBefore(img, overlay);
    } else {
        // Fallback: append to item
        item.appendChild(img);
    }
}

// Remove img element from a gallery item when converting to placeholder
function removeImgFromGalleryItem(item) {
    const img = item.querySelector('img');
    if (img) {
        releaseGalleryItemImage(img);
        img.remove();
    }
}

// Reindex gallery items and placeholders
function reindexGallery() {
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length === 0) return;

    // Get effective length for bounds checking
    const effectiveLength = window.filteredImageIndices && window.filteredImageIndices.length > 0
        ? window.filteredImageIndices.length
        : allImages.length;

    // First, remove duplicate items by filename (keep the first one found)
    const seenFilenames = new Set();
    const itemsToRemove = [];

    items.forEach((el) => {
        const filename = el.dataset.filename;
        if (filename) {
            if (seenFilenames.has(filename)) {
                // Duplicate found - mark for removal
                itemsToRemove.push(el);
            } else {
                seenFilenames.add(filename);
            }
        }
    });

    // Remove duplicates
    itemsToRemove.forEach(el => {
        if (el && el.parentNode) {
            disposeGalleryItemElement(el);
            el.remove();
        }
    });

    // Re-query items after removing duplicates
    const remainingItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');

    // Check if any item's index doesn't match its position
    let needsReindex = false;
    for (let i = 0; i < remainingItems.length; i++) {
        const currentIndex = parseInt(remainingItems[i].dataset.index || '0');
        if (currentIndex !== i) {
            needsReindex = true;
            break;
        }
    }

    // Reindex if needed
    if (needsReindex) {
        remainingItems.forEach((el, i) => {
            // Only reindex if index is within effective bounds
            if (i < effectiveLength) {
                el.dataset.index = i.toString();
                // Update fileIndex: use filteredImageIndices to get original file index in allImages
                if (window.filteredImageIndices && window.filteredImageIndices[i] !== undefined) {
                    const fileIndex = window.filteredImageIndices[i];
                    if (fileIndex >= 0 && fileIndex < allImages.length) {
                        el.dataset.fileIndex = fileIndex.toString();
                    }
                } else {
                    el.dataset.fileIndex = i.toString();
                }
            } else {
                // Index is out of bounds - this item shouldn't exist, remove it
                if (el && el.parentNode) {
                    disposeGalleryItemElement(el);
                    el.remove();
                }
            }
        });
    } else {
        // Even if indices are correct, ensure fileIndex is accurate
        remainingItems.forEach((el, i) => {
            if (i < effectiveLength) {
                if (window.filteredImageIndices && window.filteredImageIndices[i] !== undefined) {
                    const fileIndex = window.filteredImageIndices[i];
                    if (fileIndex >= 0 && fileIndex < allImages.length) {
                        const currentFileIndex = parseInt(el.dataset.fileIndex || '0');
                        if (currentFileIndex !== fileIndex) {
                            el.dataset.fileIndex = fileIndex.toString();
                        }
                    }
                } else {
                    const currentFileIndex = parseInt(el.dataset.fileIndex || '0');
                    if (currentFileIndex !== i) {
                        el.dataset.fileIndex = i.toString();
                    }
                }
            }
        });
    }
}

function scheduleDeferredPlaceholderAddition(direction) {
    // Don't schedule placeholder additions if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't schedule placeholder additions if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Don't schedule placeholder additions during jump operations
    if (isJumpingToPosition) return;

    pendingPlaceholderAdditions[direction] = true;

    if (deferredPlaceholderTimeout) {
        clearTimeout(deferredPlaceholderTimeout);
    }

    deferredPlaceholderTimeout = setTimeout(() => {
        // Check again in case jump started during the timeout
        if (isJumpingToPosition) return;

        if (pendingPlaceholderAdditions.above) {
            addPlaceholdersAbove();
            pendingPlaceholderAdditions.above = false;
        }
        if (pendingPlaceholderAdditions.below) {
            addPlaceholdersBelow();
            pendingPlaceholderAdditions.below = false;
        }
    }, Math.max(10, 50 - Math.abs(scrollVelocity) * 5)); // Velocity-dependent delay: faster scrolling = shorter delay
}

// Unified placeholder buffer size calculation
function calculatePlaceholderBufferSize(scrollVelocity = 0, rows = galleryRows, isJumpOperation = false) {
    const isMobile = window.innerWidth <= infiniteScrollConfig.smallScreenThreshold;
    // Velocity spikes (logs: ~100+) can explode buffer and trigger tail overfill/reflow; clamp for stable buffer math.
    const absScrollVelocity = Math.min(12, Math.abs(scrollVelocity || 0));
    let placeholderMultiplier = isJumpOperation ? 2.0 : 1.5; // Higher default for jump operations

    if (absScrollVelocity > 0) {
        // Scale multiplier based on scroll velocity
        if (absScrollVelocity >= 6) {
            // Very fast scrolling: scale from 3x to 6x based on velocity
            placeholderMultiplier = 3 + ((absScrollVelocity - 6) / 10) * 3; // 3x to 6x
        } else if (absScrollVelocity >= 3) {
            // Rapid scrolling: scale from 2x to 3x based on velocity
            placeholderMultiplier = 2 + ((absScrollVelocity - 3) / 3) * 1; // 2x to 3x
        } else {
            // Normal scrolling: scale from 1.5x to 2x based on velocity
            placeholderMultiplier = (isJumpOperation ? 2 : 1.5) + (absScrollVelocity / 3) * 0.5;
        }
    }

    const placeholderBufferRows = Math.round(rows * placeholderMultiplier);
    let bufferSize = Math.floor(placeholderBufferRows * realGalleryColumns);

    // Ensure minimum 2 pages worth during fast scrolling (2 * rows * realGalleryColumns)
    const minTwoPagesBuffer = 2 * rows * realGalleryColumns;
    bufferSize = Math.max(bufferSize, minTwoPagesBuffer);
    // Hard cap prevents reflow spikes from giant buffers (e.g. buf 477 in logs).
    const maxRowsCap = isMobile ? 30 : 24;
    const maxBufferSize = Math.max(minTwoPagesBuffer, maxRowsCap * realGalleryColumns);
    bufferSize = Math.min(bufferSize, maxBufferSize);

    // Mobile-specific buffer size adjustment
    const adjustedBufferSize = isMobile ? Math.max(bufferSize, realGalleryColumns * 4) : bufferSize;

    return adjustedBufferSize;
}

// Calculate multiplexing level based on websocket RTT measurements
function calculateMultiplexingLevel() {
    // Only recalculate every 2 seconds to avoid excessive checks
    const now = Date.now();
    if (now - lastRttCheckTime < 2000) {
        return currentMultiplexingLevel;
    }
    lastRttCheckTime = now;

    // Get websocket RTT measurements
    let currentRtt = 100; // Default: 100ms (reasonable baseline)
    let rttVariability = 0;

    // Try to get RTT from websocket client
    if (window.wsClient && window.wsClient.currentRtt) {
        currentRtt = window.wsClient.currentRtt;
        rttVariability = window.wsClient.rttVariability || 0;
    }

    // Calculate multiplexing level based on RTT thresholds
    // Lower RTT = higher multiplexing, Higher RTT = lower multiplexing
    let multiplexingLevel;

    if (currentRtt < 50) {
        // Excellent connection: high multiplexing
        multiplexingLevel = Math.min(6, Math.max(3, 8 - Math.floor(currentRtt / 10)));
    } else if (currentRtt < 100) {
        // Good connection: moderate multiplexing
        multiplexingLevel = Math.min(4, Math.max(2, 6 - Math.floor(currentRtt / 20)));
    } else if (currentRtt < 200) {
        // Fair connection: low multiplexing
        multiplexingLevel = Math.min(3, Math.max(1, 4 - Math.floor(currentRtt / 50)));
    } else if (currentRtt < 500) {
        // Poor connection: minimal multiplexing
        multiplexingLevel = Math.min(2, Math.max(1, 3 - Math.floor(currentRtt / 100)));
    } else {
        // Very poor connection (>= 500ms): disable observer resolution, use queue only
        multiplexingLevel = 0;
    }

    // Reduce multiplexing if RTT variability is high (unstable connection)
    if (rttVariability > currentRtt * 0.3) { // More than 30% variability
        multiplexingLevel = Math.max(1, multiplexingLevel - 1);
    }

    currentMultiplexingLevel = multiplexingLevel; // Update global for callbacks

    return multiplexingLevel;
}

// Async version of addImgToGalleryItem with completion callback for multiplexing
function addImgToGalleryItemAsync(item, image, onComplete) {
    // Don't add if img already exists
    if (item.querySelector('img')) {
        if (typeof onComplete === 'function') {
            onComplete();
        }
        return;
    }

    // public/scripts/comp/blurhashUtil.js — placeholder behind thumb while loading
    applyBlurhashPlaceholder(item, image.blurhash);

    const img = document.createElement('img');
    applyGalleryItemImage(img, image, {
        onComplete: onComplete
    });

    // Insert img element before the overlay (same position as in createGalleryItem)
    const overlay = item.querySelector('.gallery-item-overlay');
    if (overlay) {
        item.insertBefore(img, overlay);
    } else {
        item.appendChild(img);
    }
}

// Extremely fast batch placeholder creation and addition
function batchCreatePlaceholders(indices, position = 'append') {
    if (!gallery || indices.length === 0) return;

    // Pre-calculate all elements in a batch before DOM manipulation
    const fragment = document.createDocumentFragment();
    const itemsToObserve = [];

    for (const idx of indices) {
        const fileIndex = window.filteredImageIndices && window.filteredImageIndices[idx] !== undefined
            ? window.filteredImageIndices[idx]
            : idx;

        const image = allImages[fileIndex];
        if (!image) continue;

        // Check for existing placeholder
        const imageFilename = image.filename || image.original || image.upscaled;
        const existingByIndex = gallery.querySelector(`[data-index="${idx}"].gallery-placeholder`);
        const existingByFilename = gallery.querySelector(`[data-filename="${imageFilename}"]`);

        if (!existingByIndex && !existingByFilename) {
            const item = getOrCreateGalleryItem(image, idx, true); // Skip img element for placeholders
            item.classList.add('gallery-placeholder');
            fragment.appendChild(item);
            itemsToObserve.push(item);
        }
    }

    // Single DOM operation to add all elements
    if (position === 'prepend') {
        gallery.insertBefore(fragment, gallery.firstChild);
    } else {
        gallery.appendChild(fragment);
    }

    // Batch observe all new elements
    if (intersectionObserver && itemsToObserve.length > 0) {
        itemsToObserve.forEach(item => intersectionObserver.observe(item));
    }
}

function addPlaceholdersAbove() {
    if (!gallery || isLoadingMore) return;

    // Don't add placeholders if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't add placeholders if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Don't add placeholders if jump-created items exist (they were just created, wait for user interaction)
    if (isJumpingToPosition) return;

    // Check if there are actually images above the current position
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    let firstRealIndex = -1;

    for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('gallery-placeholder')) {
            continue;
        } else {
            firstRealIndex = parseInt(items[i].dataset.index);
            break;
        }
    }

    // If firstRealIndex is 0 or -1, there are no images above to load
    if (firstRealIndex <= 0) return;

    // Only enable scroll position preservation if user is near the top of the gallery
    const scrollTop = window.pageYOffset;
    const isNearTop = scrollTop < 200; // Only preserve position if within 200px of top

    if (isNearTop && !scrollPositionPreservationEnabled) {
        scrollPositionPreservationEnabled = true;
        preserveScrollPosition();
    }

    // Use unified buffer size calculation
    const adjustedBufferSize = calculatePlaceholderBufferSize(scrollVelocity);

    // Count placeholders above
    let placeholdersAbove = 0;

    for (let i = 0; i < items.length; i++) {
        if (items[i].classList.contains('gallery-placeholder')) {
            placeholdersAbove++;
        } else {
            break;
        }
    }

    // Collect indices for batch creation
    const indicesToAdd = [];
    while (placeholdersAbove < adjustedBufferSize && firstRealIndex > 0) {
        const needed = Math.min(adjustedBufferSize - placeholdersAbove, realGalleryColumns);
        for (let i = 0; i < needed; i++) {
            const idx = firstRealIndex - i - 1;
            if (idx < 0) break;

            // Check if placeholder already exists by both index and filename
            const fileIndex = window.filteredImageIndices && window.filteredImageIndices[idx] !== undefined
                ? window.filteredImageIndices[idx]
                : idx;

            const image = allImages[fileIndex];
            if (!image) continue;

            const imageFilename = image.filename || image.original || image.upscaled;
            const existingByIndex = gallery.querySelector(`[data-index="${idx}"].gallery-placeholder`);
            const existingByFilename = gallery.querySelector(`[data-filename="${imageFilename}"]`);

            // Only add if no placeholder exists at this index AND no item exists with this filename
            if (!existingByIndex && !existingByFilename) {
                indicesToAdd.push(idx);
                placeholdersAbove++;
            }
        }
        firstRealIndex = Math.max(0, firstRealIndex - needed);
    }

    // Batch create all placeholders at once
    if (indicesToAdd.length > 0) {
        batchCreatePlaceholders(indicesToAdd, 'prepend');
    }

    // If we added placeholders and position preservation was enabled, restore it
    if (placeholdersAbove > 0 && scrollPositionPreservationEnabled) {
        // Use a small delay to ensure DOM updates are complete
        setTimeout(() => {
            restoreScrollPosition();
        }, 10);
    }
}

function addPlaceholdersBelow() {
    if (!gallery || isLoadingMore) return;

    // Don't add placeholders if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't add placeholders if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Don't add placeholders if jump-created items exist (they were just created, wait for user interaction)
    if (isJumpingToPosition) return;

    // Check if there are actually images below the current position
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    let lastRealIndex = -1;

    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].classList.contains('gallery-placeholder')) {
            continue;
        } else {
            lastRealIndex = parseInt(items[i].dataset.index);
            break;
        }
    }

    // If lastRealIndex is at or beyond the end, there are no more images below to load
    // lastRealIndex is a filtered index, so compare to filteredImageIndices length
    const addPlaceholdersBelowLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    if (lastRealIndex >= addPlaceholdersBelowLength - 1) return;

    // Use unified buffer size calculation
    const adjustedBufferSize = calculatePlaceholderBufferSize(scrollVelocity);

    // Count placeholders below
    let placeholdersBelow = 0;

    for (let i = items.length - 1; i >= 0; i--) {
        if (items[i].classList.contains('gallery-placeholder')) {
            placeholdersBelow++;
        } else {
            break;
        }
    }

    // Collect indices for batch creation
    const indicesToAdd = [];
    while (placeholdersBelow < adjustedBufferSize && lastRealIndex < addPlaceholdersBelowLength - 1) {
        const needed = Math.min(adjustedBufferSize - placeholdersBelow, realGalleryColumns);
        for (let i = 0; i < needed; i++) {
            const idx = lastRealIndex + i + 1;
            if (idx >= addPlaceholdersBelowLength) break;

            // Check if placeholder already exists by both index and filename
            const fileIndex = window.filteredImageIndices && window.filteredImageIndices[idx] !== undefined
                ? window.filteredImageIndices[idx]
                : idx;

            const image = allImages[fileIndex];
            if (!image) continue;

            const imageFilename = image.filename || image.original || image.upscaled;
            const existingByIndex = gallery.querySelector(`[data-index="${idx}"].gallery-placeholder`);
            const existingByFilename = gallery.querySelector(`[data-filename="${imageFilename}"]`);

            // Only add if no placeholder exists at this index AND no item exists with this filename
            if (!existingByIndex && !existingByFilename) {
                indicesToAdd.push(idx);
                placeholdersBelow++;
            }
        }
        lastRealIndex = Math.min(addPlaceholdersBelowLength - 1, lastRealIndex + needed);
    }

    // Batch create all placeholders at once
    if (indicesToAdd.length > 0) {
        batchCreatePlaceholders(indicesToAdd, 'append');
    }
}

// Improved infinite scroll handler with percentage-based triggers
function handleInfiniteScroll() {
    if (isLoadingMore) return;

    // Don't handle infinite scroll if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't handle infinite scroll if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Post-restore stabilization: virtual scroll / load-more must not mutate the DOM window
    // until explicit user input lifts suppression (otherwise saved position hints drift).
    if (suppressGalleryPositionHintUntilInteraction) return;

    // Detect if we're scrolling in a container or window
    const { galleryContainer, isContainerScroll } = getGalleryScrollRoots();

    let scrollTop, containerHeight, scrollHeight;

    if (isContainerScroll && galleryContainer) {
        // Container scroll mode - use container dimensions
        scrollTop = galleryContainer.scrollTop;
        containerHeight = galleryContainer.clientHeight;
        scrollHeight = galleryContainer.scrollHeight;
    } else {
        // Window scroll mode - use window dimensions
        scrollTop = window.pageYOffset || document.documentElement.scrollTop;
        containerHeight = window.innerHeight;
        scrollHeight = document.documentElement.scrollHeight;
    }

    const windowHeight = containerHeight;
    const documentHeight = scrollHeight;

    // Calculate responsive trigger distances
    const isSmallScreen = window.innerWidth <= infiniteScrollConfig.smallScreenThreshold;
    const multiplier = isSmallScreen ? infiniteScrollConfig.smallScreenMultiplier : 1;

    // Mobile-specific adjustments for better placeholder filling
    let topTriggerPercent = infiniteScrollConfig.topTriggerPercent;
    let placeholderTriggerPercent = infiniteScrollConfig.placeholderTriggerPercent;

    if (isSmallScreen) {
        // On mobile, be more aggressive with placeholder triggers
        topTriggerPercent = Math.max(topTriggerPercent, 0.2); // At least 20% from top
        placeholderTriggerPercent = Math.max(placeholderTriggerPercent, 0.3); // At least 30% for placeholders
    }

    // Use percentage-based triggers that adapt to page height
    const bottomTriggerDistance = Math.max(
        windowHeight * infiniteScrollConfig.bottomTriggerPercent * multiplier,
        windowHeight * 0.1 // Minimum 10% of viewport height
    );

    const topTriggerDistance = Math.max(
        windowHeight * topTriggerPercent * multiplier,
        windowHeight * 0.1 // Minimum 10% of viewport height
    );

    // Increase trigger distance for faster scrolling
    const velocityMultiplier = Math.max(1, Math.min(2, Math.abs(scrollVelocity) / 3));
    const adjustedTriggerPercent = Math.min(0.5, placeholderTriggerPercent * velocityMultiplier); // Max 50%
    const placeholderTriggerDistance = Math.max(
        windowHeight * adjustedTriggerPercent * multiplier,
        windowHeight * 0.15 // Minimum 15% of viewport height
    );

    // Check if we're near the bottom and need to load more images
    const scrollBottom = scrollTop + windowHeight;
    const bottomThreshold = documentHeight - (windowHeight * infiniteScrollConfig.bottomTriggerPercent);

    if (scrollBottom >= bottomThreshold && !isLoadingMore) {
        // Check if there are actually more images to load before proceeding
        const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
        let lastRealIndex = -1;

        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].classList.contains('gallery-placeholder')) {
                continue;
            } else {
                lastRealIndex = parseInt(items[i].dataset.index);
                break;
            }
        }

        // Only load more if there are actually more images available
        if (lastRealIndex < allImages.length - 1) {
            loadMoreImages();
        }
    }

    // Load more when user is near the top (percentage-based)
    if (scrollTop <= topTriggerDistance && hasMoreImagesBefore) {
        loadMoreImagesBefore();
    }

    // Don't schedule placeholder additions during jump operations
    // (placeholders are added manually during jumps)
    if (!isJumpingToPosition) {
        // Schedule deferred placeholder additions for rapid scrolling
        // On mobile, be more aggressive with placeholder scheduling
        if (scrollTop <= placeholderTriggerDistance) {
            scheduleDeferredPlaceholderAddition('above');
            // On mobile, also trigger immediate placeholder addition for better responsiveness
            if (isSmallScreen && hasMoreImagesBefore) {
                addPlaceholdersAbove();
            }
        }
        if (scrollTop + windowHeight >= documentHeight - placeholderTriggerDistance) {
            scheduleDeferredPlaceholderAddition('below');
            // On mobile, also trigger immediate placeholder addition for better responsiveness
            if (isSmallScreen && hasMoreImages) {
                addPlaceholdersBelow();
            }
        }
    }

    // Virtual scrolling: remove items that are too far from viewport
    if (virtualScrollEnabled) {
        updateVirtualScroll();
    }
}

// Load more images for infinite scroll (scroll down) with dynamic batch sizing
async function loadMoreImages() {
    if (isLoadingMore) return;

    // Don't load more images if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    try {
        isLoadingMore = true;
        if (infiniteScrollLoading) infiniteScrollLoading.classList.remove('hidden');

        // Check if there are actually more images to load
        const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
        let lastRealIndex = -1;

        for (let i = items.length - 1; i >= 0; i--) {
            if (items[i].classList.contains('gallery-placeholder')) {
                continue;
            } else {
                lastRealIndex = parseInt(items[i].dataset.index);
                break;
            }
        }

        // If lastRealIndex is at or beyond the end, there are no more images to load
        // lastRealIndex is a filtered index, so compare to filteredImageIndices length
        const loadMoreBeforeLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
        if (lastRealIndex >= loadMoreBeforeLength - 1) {
            return;
        }

        // Determine the starting index for new images
        const startIndex = lastRealIndex + 1;
        const batchSize = calculateDynamicBatchSize();
        // Use filteredImageIndices length if filtering is active, otherwise use allImages length
        const loadMoreEffectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
        const endIndex = Math.min(startIndex + batchSize, loadMoreEffectiveLength);

        // If startIndex is beyond the end, there's nothing to load
        if (startIndex >= loadMoreEffectiveLength) {
            return;
        }

        // Load the images
        for (let i = startIndex; i < endIndex; i++) {
            if (i < loadMoreEffectiveLength) {
                // i is filtered position, get file index from filteredImageIndices to access allImages
                const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined
                    ? window.filteredImageIndices[i]
                    : i;
                const image = allImages[fileIndex];
                const item = createGalleryItem(image, i); // i is filtered position for data-index
                gallery.appendChild(item);

                // Add animation class
                item.classList.add('fade-in');
                item.addEventListener('animationend', function handler() {
                    item.classList.remove('fade-in');
                    item.removeEventListener('animationend', handler);
                });
            }
        }

        // Update displayed range
        displayedEndIndex = endIndex;
        hasMoreImages = endIndex < loadMoreEffectiveLength;

        // Update placeholders after adding real images
        updateGalleryPlaceholders();

    } catch (error) {
        console.error('Error loading more images:', error);
    } finally {
        isLoadingMore = false;
        if (infiniteScrollLoading) infiniteScrollLoading.classList.add('hidden');
    }
}

// Load more images before for infinite scroll (scroll up) with dynamic batch sizing
async function loadMoreImagesBefore() {
    if (isLoadingMore || !hasMoreImagesBefore) return;

    // Don't load more images if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't load more images if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;
    isLoadingMore = true;
    if (infiniteScrollLoading) infiniteScrollLoading.classList.remove('hidden');

    try {
        // Calculate dynamic batch size based on viewport
        const dynamicBatchSize = calculateDynamicBatchSize();

        // Calculate previous batch of images
        const endIndex = displayedStartIndex;
        const startIndex = Math.max(0, endIndex - dynamicBatchSize);
        const prevBatch = allImages.slice(startIndex, endIndex);

        if (prevBatch.length === 0) {
            hasMoreImagesBefore = false;
            return;
        }

        // Add placeholders for new items at the top with responsive height
        for (let i = endIndex - 1; i >= startIndex; i--) {
            // i is filtered index (position), get file index from filteredImageIndices
            const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined
                ? window.filteredImageIndices[i]
                : i;
            // Create as gallery-item with placeholder class
            const image = allImages[fileIndex];
            if (image) {
                const item = getOrCreateGalleryItem(image, i, true); // Skip img element for placeholders
                item.classList.add('gallery-placeholder');
                gallery.insertBefore(item, gallery.firstChild);
            }
        }

        // Update displayed range
        displayedStartIndex = startIndex;
        hasMoreImagesBefore = startIndex > 0;

        // Only restore scroll position if there are actually images above and user is near the top
        if (startIndex > 0) {
            const scrollTop = window.pageYOffset;
            const isNearTop = scrollTop < 200;

            if (isNearTop) {
                // Enable scroll position preservation and restore position
                if (!scrollPositionPreservationEnabled) {
                    scrollPositionPreservationEnabled = true;
                    preserveScrollPosition();
                }
                // Use a small delay to ensure DOM updates are complete
                setTimeout(() => {
                    restoreScrollPosition();
                }, 10);
            }
        }

    } catch (error) {
        console.error('Error loading more images before:', error);
    } finally {
        isLoadingMore = false;
        if (infiniteScrollLoading) infiniteScrollLoading.classList.add('hidden');
    }
}

// Helper functions for improved infinite scroll
function calculateDynamicBatchSize() {
    const { width: containerWidth, height: containerHeight } = getGalleryContainerDimensions();

    if (containerWidth <= 0 || containerHeight <= 0) {
        return infiniteScrollConfig.minBatchSize;
    }

    // Base batch size on container size
    let baseSize = Math.ceil((containerWidth * containerHeight) / (300 * 300)); // Rough calculation

    // Adjust for small screens - ensure minimum batch size for mobile
    if (containerWidth <= infiniteScrollConfig.smallScreenThreshold) {
        // On mobile, ensure we have enough items to fill at least 2-3 rows
        const mobileMinBatch = Math.max(6, Math.ceil(realGalleryColumns * 2.5));
        baseSize = Math.max(baseSize, mobileMinBatch);
    }

    // Ensure batch size is within configured bounds
    return Math.max(
        infiniteScrollConfig.minBatchSize,
        Math.min(infiniteScrollConfig.maxBatchSize, baseSize)
    );
}

function calculateTrueItemsPerRow() {
    if (!gallery) return 5; // Fallback

    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length < 2) return 5; // Need at least 2 items

    const firstItem = items[0];
    const firstRect = firstItem.getBoundingClientRect();
    const firstY = firstRect.top;

    // Find the next item that's at the same Y position (same row)
    let itemsInRow = 1;
    for (let i = 1; i < items.length; i++) {
        const item = items[i];
        const rect = item.getBoundingClientRect();
        // Check if this item is at the same Y position (within 5px tolerance)
        if (Math.abs(rect.top - firstY) < 5) {
            itemsInRow++;
        } else {
            break; // Found the end of the first row
        }
    }

    return Math.max(1, itemsInRow);
}

// Update gallery grid based on actual rendered layout
// onlyIfChanged: if true, only update if columns actually changed (lighter weight)
// updatePlaceholders: if true, also update placeholders (default: true)
function updateGalleryGrid(onlyIfChanged = false, updatePlaceholders = true) {
    if (!gallery) return;

    // Don't update gallery if manual modal is open and maximized (when onlyIfChanged is true)
    if (onlyIfChanged) {
        if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;
        if (isGalleryWindowHidden()) return;
    }

    // Prefer actual rendered items if available, otherwise use theoretical calculation
    let columns;
    const items = gallery.querySelectorAll('.gallery-item:not(.gallery-placeholder), .gallery-placeholder.gallery-item');
    if (items.length >= 2) {
        // Use actual rendered layout
        columns = calculateTrueItemsPerRow();
    } else {
        // Fallback to theoretical calculation when no items rendered yet
        const { width: containerWidth } = getGalleryContainerDimensions();
        if (containerWidth <= 0) {
            columns = 5; // Fallback
        } else {
            // Calculate optimal columns based on container width and minmax value
            const minmaxValue = getGalleryMinmaxValue();
            const borderWidth = 4; // 2px border on each side
            const itemWidthWithBorder = minmaxValue + borderWidth;
            columns = Math.max(1, Math.floor(containerWidth / itemWidthWithBorder));
        }
    }

    // If onlyIfChanged is true, only update if columns actually changed
    if (onlyIfChanged && columns === realGalleryColumns) {
        return; // No change, skip update
    }

    // Update the gallery columns variable for infinite scrolling
    itemSizePx = getItemSize();
    realGalleryColumns = Number(columns);
    galleryRows = calculateGalleryRows();
    imagesPerPage = realGalleryColumns * galleryRows;

    // Update placeholders if requested
    if (updatePlaceholders) {
        updateGalleryPlaceholders();
    }
}

// Update visible items tracking for virtual scrolling
function updateVisibleItems() {
    if (!gallery) return;

    const roots = getGalleryScrollRoots();
    visibleItems.clear();
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const viewport = getGalleryViewportBounds(roots);
    // Prefer same-rAF strip geometry from updateVirtualScrollInternal; else calibrate locally (do not leak across frames)
    const geometry = galleryStripGeometryPass || measureGalleryStripGeometry(items, viewport, roots);

    let firstVisibleIndex = null;
    const total = items.length;
    for (let i = 0; i < total; i++) {
        const item = items[i];
        const bounds = (geometry && galleryItemScrollBoundsFromDomIndex(i, geometry))
            || galleryItemScrollBoundsFromRect(item, roots, viewport);

        if (bounds.itemBottom > viewport.viewportTop && bounds.itemTop < viewport.viewportBottom) {
            const galleryIndex = parseInt(item.dataset.index, 10);
            if (!isNaN(galleryIndex)) {
                visibleItems.add(galleryIndex);
                if (firstVisibleIndex === null) {
                    firstVisibleIndex = galleryIndex;
                }
            }
        }
    }

    // Update current visible index for title bar (row-aligned index, same as position hints / restore)
    if (firstVisibleIndex !== null) {
        const eff = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
        const c = realGalleryColumns || 5;
        currentVisibleIndex = snapGalleryFilteredIndexToRowStart(firstVisibleIndex, c, eff);
        // Scroll-driven title only — do not rebuild taskbar (syncTaskbar on view/search callers)
        updateGalleryTitleBar();
    }

    if (galleryJumpIndexToolEl && !galleryJumpIndexToolEl.classList.contains('hidden')) {
        updateGalleryJumpIndexActiveCard();
        if (!Number.isFinite(galleryJumpIndexHoveredBoundaryIndex)) {
            updateGalleryJumpIndexSummary();
        }
    }
}

/**
 * Update gallery window title bar.
 * @param {{ syncTaskbar?: boolean }} [options] - Pass syncTaskbar:true when view/search/list
 *   structure changes. Scroll-driven calls must omit it (avoids full updateTaskbarWindows).
 */
function updateGalleryTitleBar(options) {
    const { galleryWindow } = getGalleryScrollRoots();
    if (!galleryWindow) return;

    const titleElement = galleryWindow.querySelector('.gallery-window-title .modal-window-title-main span');
    if (!titleElement) return;

    // Get view name
    const viewNames = {
        'images': 'Images',
        'scraps': 'Scraps',
        'pinned': 'Pinned',
        'upscaled': 'Upscaled'
    };
    const viewName = viewNames[currentGalleryView] || 'Images';

    // Get search term (check if we have filtered results)
    const hasSearch = window.filteredImageIndices && window.filteredImageIndices.length > 0;
    const searchTerm = hasSearch && window.currentSearchTerm ? window.currentSearchTerm : null;

    // Get effective length and current position
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    const showPosition = currentVisibleIndex > 100 && effectiveLength > 0;

    // Build title
    let title = `Workspace - ${viewName}`;

    if (searchTerm) {
        title += ` <i class="fas fa-chevron-left"></i> ${searchTerm}`;
    }

    if (showPosition) {
        title += ` (${currentVisibleIndex + 1} of ${effectiveLength})`;
    }

    if (titleElement.innerHTML !== title) {
        titleElement.innerHTML = title;
    }

    // Modal open/close/minimize paths already refresh the taskbar; only sync here on structural gallery changes
    if (options && options.syncTaskbar) {
        // updateTaskbarWindows: public/scripts/comp/modalUtils.js
        updateTaskbarWindows();
    }
}

/**
 * Get the index of the first visible row in the gallery
 * Returns the filtered index (position in current array, not allImages)
 */
function getFirstVisibleRowIndex() {
    if (!gallery) return 0;

    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length === 0) return 0;

    // Detect scroll container (cached roots)
    const roots = getGalleryScrollRoots();
    const { galleryContainer, isContainerScroll } = roots;

    let viewportTop;
    if (isContainerScroll && galleryContainer) {
        viewportTop = galleryContainer.scrollTop;
    } else {
        viewportTop = window.pageYOffset || document.documentElement.scrollTop;
    }

    const viewportHeight = isContainerScroll && galleryContainer ? galleryContainer.clientHeight : window.innerHeight;
    const viewportBottom = viewportTop + viewportHeight;
    const edgeTolerance = 100;
    // Ignore cells only barely peeking into view (typical off-by-one row: previous row's sliver at top).
    const minVisibleHeightFraction = 0.22;

    // One containerRect for this restore/hint pass (behavior unchanged; avoids N container GBCRs)
    const containerRect = isContainerScroll && galleryContainer ? galleryContainer.getBoundingClientRect() : null;
    const pageY = window.pageYOffset;

    const itemScrollBounds = (item) => {
        const rect = item.getBoundingClientRect();
        if (isContainerScroll && galleryContainer && containerRect) {
            return {
                itemTop: rect.top - containerRect.top + galleryContainer.scrollTop,
                itemBottom: rect.bottom - containerRect.top + galleryContainer.scrollTop
            };
        }
        return {
            itemTop: rect.top + pageY,
            itemBottom: rect.bottom + pageY
        };
    };

    const pickFirstRowIndex = (useMinVisibleFraction) => {
        let placeholderFallbackIndex = null;
        for (let i = 0; i < items.length; i++) {
            const item = items[i];
            const { itemTop, itemBottom } = itemScrollBounds(item);

            const intersectsViewport = itemBottom > viewportTop && itemTop < viewportBottom;
            if (!intersectsViewport) continue;

            if (useMinVisibleFraction) {
                const rowH = itemBottom - itemTop;
                if (rowH <= 0) continue;
                const visTop = Math.max(itemTop, viewportTop);
                const visBottom = Math.min(itemBottom, viewportBottom);
                const visH = visBottom - visTop;
                if (visH < rowH * minVisibleHeightFraction) continue;
            } else if (!(itemBottom > (viewportTop - edgeTolerance) && itemTop < viewportBottom)) {
                continue;
            }

            const index = parseInt(item.dataset.index, 10);
            if (isNaN(index)) continue;

            if (!item.classList.contains('gallery-placeholder')) {
                return index;
            }

            if (placeholderFallbackIndex === null) {
                placeholderFallbackIndex = index;
            }
        }
        return placeholderFallbackIndex;
    };

    let chosen = pickFirstRowIndex(true);
    if (chosen != null) {
        return chosen;
    }

    chosen = pickFirstRowIndex(false);
    if (chosen != null) {
        return chosen;
    }

    // Fallback: return index of first item
    const firstItem = items[0];
    if (firstItem) {
        const index = parseInt(firstItem.dataset.index);
        if (!isNaN(index)) {
            return index;
        }
    }

    return 0;
}

// Virtual scroll: replace far-away items with placeholders
let virtualScrollThrottle = null;
let intersectionObserver = null;

// Gallery reset flag for iOS placeholder management
let isGalleryResetting = false;

// Flag to disable virtual scroll during jump operations
let isJumpingToPosition = false;

// iOS-aware placeholder management
let isIOS = /iPad|iPhone|iPod/.test(navigator.userAgent);
let placeholderCleanupQueue = [];
let lastScrollTime = 0;
let scrollVelocity = 0;
let isScrolling = false;
let scrollEndTimeout = null;
let cleanupTimeout = null; // Track cleanup timeout to prevent duplicates

// Fast scrolling pause for placeholder resolution
let isFastScrolling = false;
let fastScrollTimeout = null;
let pendingPlaceholderResolution = false;
let fastScrollDirection = 0; // -1 = up, 0 = none, 1 = down
let fastScrollStartTime = 0;

// iOS-aware placeholder cleanup to prevent layout shifts
function schedulePlaceholderCleanup(placeholdersToRemove) {
    if (placeholdersToRemove.length === 0) return;

    // Queue placeholders for removal (deduplicate on add)
    const newPlaceholders = placeholdersToRemove.filter(p => p && !placeholderCleanupQueue.includes(p));
    if (newPlaceholders.length === 0) return;

    placeholderCleanupQueue.push(...newPlaceholders);

    // Clear any existing cleanup timeout to prevent duplicates
    if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
    }

    // Unified cleanup scheduling for both iOS and desktop
    const scheduleCleanup = (delay, retryDelay = 300) => {
        cleanupTimeout = setTimeout(() => {
            cleanupTimeout = null;

            // Only process if scrolling has completely stopped
            if (!isScrolling && Math.abs(scrollVelocity) < 0.5) {
                processPlaceholderCleanup();
            } else if (retryDelay > 0) {
                // If still scrolling, retry once after delay
                cleanupTimeout = setTimeout(() => {
                    cleanupTimeout = null;
                    if (!isScrolling && Math.abs(scrollVelocity) < 0.5) {
                        processPlaceholderCleanup();
                    }
                }, retryDelay);
            }
        }, delay);
    };

    if (isIOS) {
        // iOS: wait for scroll momentum to stop
        const cleanupDelay = Math.max(100, Math.abs(scrollVelocity) * 10);
        scheduleCleanup(cleanupDelay, 200);
    } else {
        // Desktop: longer initial delay
        scheduleCleanup(200, 300);
    }
}

function processPlaceholderCleanup() {
    if (placeholderCleanupQueue.length === 0) return;

    // Clear cleanup timeout since we're processing now
    if (cleanupTimeout) {
        clearTimeout(cleanupTimeout);
        cleanupTimeout = null;
    }

    // Don't remove items while actively scrolling - this causes scroll position jumps
    if (isScrolling || Math.abs(scrollVelocity) > 0.5) {
        return; // Wait for scrolling to stop
    }

    const gallery = document.getElementById('gallery');
    if (!gallery) {
        placeholderCleanupQueue.length = 0;
        return;
    }

    // Deduplicate queue using Set (faster than array checks)
    const seen = new Set();
    const uniqueQueue = [];
    for (const placeholder of placeholderCleanupQueue) {
        if (placeholder && !seen.has(placeholder)) {
            seen.add(placeholder);
            uniqueQueue.push(placeholder);
        }
    }

    if (uniqueQueue.length === 0) {
        placeholderCleanupQueue.length = 0;
        return;
    }

    // Filter out placeholders that are no longer in the DOM
    const validPlaceholders = uniqueQueue.filter(p => p.parentNode === gallery);

    if (validPlaceholders.length === 0) {
        placeholderCleanupQueue.length = 0;
        return;
    }

    // Calculate current items per row to ensure we remove in full rows
    const currentItemsPerRow = calculateTrueItemsPerRow();
    if (currentItemsPerRow < 1) {
        placeholderCleanupQueue.length = 0;
        return;
    }

    // Get row height from first valid placeholder (single getBoundingClientRect call)
    const firstPlaceholder = validPlaceholders[0];
    const firstRect = firstPlaceholder.getBoundingClientRect();
    const rowHeight = firstRect.height > 0 ? firstRect.height : 100;
    const firstRowTop = firstRect.top;

    // Batch getBoundingClientRect calls - read all positions in one layout pass
    const rects = validPlaceholders.map(p => ({
        element: p,
        rect: p.getBoundingClientRect()
    }));

    // Group placeholders by row in a single pass
    const placeholdersByRow = new Map();
    for (const { element, rect } of rects) {
        const rowKey = Math.round(rect.top / rowHeight);
        if (!placeholdersByRow.has(rowKey)) {
            placeholdersByRow.set(rowKey, []);
        }
        placeholdersByRow.get(rowKey).push(element);
    }

    // Collect only complete rows, but cap per cleanup pass to avoid rapid reflow jumps.
    const maxRowsPerCleanup = isIOS ? 3 : 6;
    const placeholdersToRemove = [];
    let rowsQueuedForRemoval = 0;
    for (const placeholdersInRow of placeholdersByRow.values()) {
        if (placeholdersInRow.length >= currentItemsPerRow) {
            placeholdersToRemove.push(...placeholdersInRow.slice(0, currentItemsPerRow));
            rowsQueuedForRemoval++;
            if (rowsQueuedForRemoval >= maxRowsPerCleanup) break;
        }
    }

    if (placeholdersToRemove.length === 0) {
        placeholderCleanupQueue.length = 0;
        return;
    }

    // Calculate removed height in a single pass (before DOM manipulation)
    let removedHeight = 0;
    for (const placeholder of placeholdersToRemove) {
        removedHeight += placeholder.offsetHeight;
    }

    // Add CSS properties to prevent screen flashing on iOS (only if needed)
    let needsIOSCleanup = false;
    if (isIOS) {
        needsIOSCleanup = true;
        gallery.style.webkitBackfaceVisibility = 'hidden';
        gallery.style.transformStyle = 'preserve-3d';
        gallery.style.willChange = 'scroll-position';
        gallery.style.overscrollBehavior = 'contain';
    }

    // Remove all placeholders in a single batch operation
    for (const placeholder of placeholdersToRemove) {
        disposeGalleryItemElement(placeholder);
        if (placeholder.parentNode) {
            placeholder.parentNode.removeChild(placeholder);
        }
    }

    // iOS scroll compensation (only if needed)
    if (isIOS && needsIOSCleanup) {
        const currentScrollTop = window.pageYOffset;
        const compensation = Math.min(removedHeight, currentScrollTop);

        if (compensation > 0 && compensation < currentScrollTop * 0.3) {
            window.scrollTo({
                top: currentScrollTop - compensation,
                behavior: 'instant'
            });
        }

        // Clean up CSS properties
        requestAnimationFrame(() => {
            gallery.style.webkitBackfaceVisibility = '';
            gallery.style.transformStyle = '';
            gallery.style.willChange = '';
            gallery.style.overscrollBehavior = '';
        });
    }

    // Clear the queue
    placeholderCleanupQueue.length = 0;
}

// Resolve all currently visible placeholders after fast scrolling stops using the existing queue system
function resolveVisiblePlaceholders() {
    if (!gallery) return;

    const placeholders = gallery.querySelectorAll('.gallery-placeholder');
    if (placeholders.length === 0) return;

    // Update visible items first (title bar / tracking); visibility uses same scroll root as updateVisibleItems
    updateVisibleItems();

    const roots = getGalleryScrollRoots();
    const viewport = getGalleryViewportBounds(roots);
    const allStrip = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const geometry = measureGalleryStripGeometry(allStrip, viewport, roots);
    // Map gallery child → DOM index once for strip math (avoid per-placeholder indexOf)
    let domIndexByEl = null;
    if (geometry && allStrip.length) {
        domIndexByEl = new Map();
        for (let di = 0; di < allStrip.length; di++) {
            domIndexByEl.set(allStrip[di], di);
        }
    }

    placeholders.forEach((placeholder) => {
        let bounds = null;
        if (geometry && domIndexByEl) {
            const domIndex = domIndexByEl.get(placeholder);
            if (domIndex !== undefined) {
                bounds = galleryItemScrollBoundsFromDomIndex(domIndex, geometry);
            }
        }
        if (!bounds) {
            bounds = galleryItemScrollBoundsFromRect(placeholder, roots, viewport);
        }

        if (bounds.itemBottom > viewport.viewportTop && bounds.itemTop < viewport.viewportBottom) {
            const fileIndex = parseInt(placeholder.dataset.fileIndex, 10);
            const filteredIndex = parseInt(placeholder.dataset.index || '0', 10);
            queuePlaceholderResolution(placeholder, fileIndex, filteredIndex);
        }
    });
}

// Track scroll velocity for iOS momentum detection and fast scrolling pause
function updateScrollVelocity(scrollTarget = null) {
    const now = Date.now();
    let currentScrollTop;

    // Handle both window and container scrolling
    if (scrollTarget) {
        currentScrollTop = scrollTarget.scrollTop;
    } else {
        currentScrollTop = window.pageYOffset;
    }

    if (lastScrollTime > 0) {
        const timeDeltaMs = now - lastScrollTime;
        const scrollDelta = currentScrollTop - lastScrollTop;
        const safeDeltaMs = Math.max(12, timeDeltaMs);
        const rawVelocity = scrollDelta / safeDeltaMs;
        // Smooth noisy wheel/touch bursts; unstable sign flips were causing buffer/skip churn.
        scrollVelocity = (scrollVelocity * 0.6) + (rawVelocity * 0.4);
        if (Math.abs(scrollDelta) < 2 && safeDeltaMs < 50) {
            scrollVelocity *= 0.5;
        }
    }

    lastScrollTime = now;
    lastScrollTop = currentScrollTop;

    // Jump lifecycle owns layout/positioning; ignore momentum updates here to avoid first-jump drift.
    if (isJumpingToPosition) {
        scrollVelocity = 0;
        isScrolling = false;
        return;
    }

    // Top-edge nudge (container mode): if we're at 0px but gallery still has indices above,
    // nudge down 5% of item height so the next upward gesture can emit a scroll event.
    if (scrollTarget && scrollTarget.scrollTop <= 0) {
        const firstChild = gallery ? gallery.firstChild : null;
        const firstIndex = firstChild && firstChild.dataset && firstChild.dataset.index !== undefined
            ? parseInt(firstChild.dataset.index, 10)
            : 0;
        if (firstIndex > 0) {
            const sample = gallery ? gallery.querySelector('.gallery-item, .gallery-placeholder') : null;
            const sampleRect = sample ? sample.getBoundingClientRect() : null;
            const baseItemHeight = sampleRect && sampleRect.height > 0
                ? sampleRect.height
                : (window.innerHeight / Math.max(3, galleryRows || 5));
            const nudgePx = Math.max(6, Math.round(baseItemHeight * 0.05));
            if (!suppressGalleryPositionHintUntilInteraction) {
                scrollTarget.scrollTop = nudgePx;
                updateVirtualScroll();
            }
        }
    }

    // Track fast scrolling state for placeholder resolution pause
    const currentAbsVelocity = Math.abs(scrollVelocity);
    const wasFastScrolling = isFastScrolling;

    // Determine scroll direction
    let currentDirection = 0;
    if (scrollVelocity > 1) currentDirection = 1; // down
    else if (scrollVelocity < -1) currentDirection = -1; // up

    // Fast scrolling detection: velocity > 4 AND sustained for at least 100ms
    // This prevents false starts from brief velocity spikes
    if (currentAbsVelocity > 4) {
        if (!isFastScrolling) {
            // Just started fast scrolling
            fastScrollStartTime = Date.now();
            fastScrollDirection = currentDirection;
            isFastScrolling = true;
            pendingPlaceholderResolution = true;
        } else {
            // Update direction if it changed significantly
            if (currentDirection !== 0 && currentDirection !== fastScrollDirection) {
                fastScrollDirection = currentDirection;
            }
        }

        // Clear any existing fast scroll timeout
        if (fastScrollTimeout) {
            clearTimeout(fastScrollTimeout);
            fastScrollTimeout = null;
        }
    } else if (isFastScrolling) {
        // Check if fast scrolling has actually stopped
        // Require velocity to stay low for at least 200ms to confirm stop
        const timeSinceFastScroll = Date.now() - fastScrollStartTime;

        if (currentAbsVelocity < 1.0) {
            // Velocity is low, start/stop confirmation timer
            if (fastScrollTimeout) {
                clearTimeout(fastScrollTimeout);
            }

            fastScrollTimeout = setTimeout(() => {
                // Double-check velocity is still low after timeout
                if (Math.abs(scrollVelocity) < 1.0) {
                    isFastScrolling = false;
                    fastScrollTimeout = null;
                    const duration = Date.now() - fastScrollStartTime;

                    // Resolve all currently visible placeholders
                    if (pendingPlaceholderResolution) {
                        pendingPlaceholderResolution = false;
                        resolveVisiblePlaceholders();
                    }
                }
            }, 200); // Wait 200ms to confirm scrolling has stopped
        } else if (fastScrollTimeout) {
            // Velocity went back up, cancel the stop timer
            clearTimeout(fastScrollTimeout);
            fastScrollTimeout = null;
        }
    }

}

// Initialize intersection observer for better performance
function initIntersectionObserver() {
    // Detect scroll container (gallery-container is always used when available)
    const { galleryContainer, isContainerScroll } = getGalleryScrollRoots();

    // If observer exists and root needs to change, disconnect and recreate
    if (intersectionObserver) {
        const currentRoot = intersectionObserver.root;
        const needsNewRoot = (isContainerScroll && currentRoot !== galleryContainer) || (!isContainerScroll && currentRoot !== null);
        if (needsNewRoot) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        } else {
            return; // Observer already exists with correct root
        }
    }

    intersectionObserver = new IntersectionObserver((entries) => {
        // Only trigger virtual scroll updates when items become visible/hidden
        let needsUpdate = false;
        entries.forEach(entry => {
            if (entry.isIntersecting !== entry.target.dataset.wasIntersecting) {
                needsUpdate = true;
                entry.target.dataset.wasIntersecting = entry.isIntersecting;
            }
        });

        if (needsUpdate) {
            updateVirtualScroll();
        }
    }, {
        root: isContainerScroll ? galleryContainer : null, // Use container as root for scrolling
        rootMargin: '300px', // Increased from 100px to 200px to observe items earlier
        threshold: 0.01 // Lower threshold to detect items earlier
    });
}

function updateVirtualScroll() {
    if (!gallery) return;

    // Don't update virtual scroll if gallery is resetting (prevents converting items to placeholders during load)
    if (isGalleryResetting) return;

    // Don't update virtual scroll during jump operations (prevents placeholder creation during jump)
    if (isJumpingToPosition) return;

    // Same as post-restore hint suppression: keep virtual DOM stable until user input.
    if (suppressGalleryPositionHintUntilInteraction) return;

    // Don't update virtual scroll if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't update virtual scroll if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Coalesce to one rAF (same pattern as vfsVirtualGrid._scheduleScrollUpdate)
    if (virtualScrollThrottle) return;
    virtualScrollThrottle = requestAnimationFrame(() => {
        virtualScrollThrottle = null;
        updateVirtualScrollInternal();
    });
}

function updateVirtualScrollInternal() {
    // Cache DOM queries for better performance with many items
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const total = items.length;

    // Early return if no items to process
    if (total === 0) return;

    if (suppressGalleryPositionHintUntilInteraction) return;

    // Hoist scroll roots + strip geometry once for this rAF (shared with updateVisibleItems)
    const rootsVs = getGalleryScrollRoots();
    const { galleryContainer: galleryContainerVs, isContainerScroll: isContainerScrollVs } = rootsVs;
    const viewportVs = getGalleryViewportBounds(rootsVs);
    galleryStripGeometryPass = measureGalleryStripGeometry(items, viewportVs, rootsVs);

    // First, update visible items tracking
    updateVisibleItems();

    // Detect fast scrolling and adjust buffer size accordingly
    const isRapidScrolling = Math.abs(scrollVelocity) > 3; // Increased threshold for rapid scrolling
    const isVeryFastScrolling = Math.abs(scrollVelocity) > 6; // Threshold for very fast scrolling

    const rowsPerPage = galleryRows
    const visibleIndices = Array.from(visibleItems);

    if (visibleIndices.length === 0) {
        galleryStripGeometryPass = null;
        return;
    }

    // Calculate actual rows visible on screen based on viewport
    let rowsOnScreen = rowsPerPage;
    if (rowsOnScreen < 3) rowsOnScreen = 3; // Minimum fallback

    // Prefer calibrated strip height; one sample GBCR only if geometry missing
    let itemHeight = galleryStripGeometryPass
        ? galleryStripGeometryPass.itemHeight
        : (window.innerHeight / rowsOnScreen);
    if (!galleryStripGeometryPass) {
        const sampleItem = items[0];
        if (sampleItem) {
            const sampleRect = sampleItem.getBoundingClientRect();
            if (sampleRect.height > 0) {
                itemHeight = sampleRect.height;
            }
        }
    }
    if (itemHeight > 0) {
        const viewportHeight = isContainerScrollVs && galleryContainerVs
            ? galleryContainerVs.clientHeight
            : window.innerHeight;
        rowsOnScreen = Math.floor(viewportHeight / itemHeight);
        if (rowsOnScreen < 3) rowsOnScreen = 3;
    }

    // Add buffer for upper and lower row that is possibly partially in frame
    rowsOnScreen += 2;

    // Buffer rows for cleanup (removing items far away) - based on screen rows
    let bufferRows = Math.max(2, Math.floor(rowsOnScreen * 0.5)); // Half screen for cleanup
    if (isVeryFastScrolling) {
        bufferRows = Math.max(2, Math.floor(rowsOnScreen * 0.3)); // Very aggressive cleanup
    } else if (isRapidScrolling) {
        bufferRows = Math.max(2, Math.floor(rowsOnScreen * 0.4)); // Moderate cleanup
    }

    const minVisibleGallery = Math.min(...visibleIndices);
    const maxVisibleGallery = Math.max(...visibleIndices);
    const effectiveMaxGalleryIndex = (window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length) - 1;

    // Adjust buffer based on scroll velocity - use larger buffer to prevent flickering
    // Increased buffer: 2-4 rows instead of 0.5-1 rows
    const bufferMultiplier = isRapidScrolling ? 2 : 6;
    const indexPad = Math.floor(realGalleryColumns * bufferMultiplier);
    const minKeep = Math.max(0, minVisibleGallery - indexPad);
    const maxKeep = Math.min(Math.max(0, effectiveMaxGalleryIndex), maxVisibleGallery + indexPad);
    // Viewport band drives placeholder add/remove counts (phAbove/phBelow vs bufferSize). Do not widen minKeep/maxKeep to full DOM — that pins phBelow < bufferSize and causes runaway inserts (post-fix logs: total 48→990, stCont flat).
    let loadMinG = Infinity;
    let loadMaxG = -Infinity;
    if (gallery.firstChild && gallery.firstChild.dataset && gallery.firstChild.dataset.index !== undefined) {
        const fi = parseInt(gallery.firstChild.dataset.index, 10);
        const la = gallery.lastChild && gallery.lastChild.dataset && gallery.lastChild.dataset.index !== undefined
            ? parseInt(gallery.lastChild.dataset.index, 10)
            : NaN;
        if (!isNaN(fi) && !isNaN(la)) {
            loadMinG = Math.min(fi, la);
            loadMaxG = Math.max(fi, la);
        }
    }
    let stripMin = minKeep;
    let stripMax = maxKeep;
    if (loadMinG !== Infinity) {
        stripMin = Math.min(stripMin, Math.max(0, loadMinG - indexPad));
        stripMax = Math.max(stripMax, Math.min(effectiveMaxGalleryIndex, loadMaxG + indexPad));
    }

    // Use unified buffer size calculation
    const bufferSize = calculatePlaceholderBufferSize(scrollVelocity, rowsOnScreen);

    // Track items that need placeholder state - keep as gallery-item elements, just add/remove placeholder class
    // Always prioritize truly visible placeholders with a small per-pass direct-resolve budget.
    let immediateVisibleResolved = 0;
    const immediateVisibleResolveBudget = isRapidScrolling ? 4 : 8;
    // Use data-index instead of DOM position for accurate index tracking after reindexing
    for (let i = 0; i < total; i++) {
        const el = items[i];
        const isGalleryItem = el.classList.contains('gallery-item');
        const hasPlaceholderClass = el.classList.contains('gallery-placeholder');

        if (el.classList.contains('gallery-generating')) {
            continue;
        }

        // Gallery list index (must align minKeep/maxKeep and visibleItems — all gallery-index space)
        const itemIndex = parseInt(el.dataset.index || i.toString(), 10);
        if (isNaN(itemIndex)) {
            continue;
        }

        if (itemIndex < stripMin || itemIndex > stripMax) {
            // Items far from viewport - add placeholder class for tracking, but keep as gallery-item
            // Don't convert items created during jump operations (they should stay as real items)
            if (isGalleryItem && !hasPlaceholderClass) {
                el.classList.add('gallery-placeholder');
                // Remove the img element to save memory (placeholders don't need img elements)
                removeImgFromGalleryItem(el);
            }
        } else {
            // Items near viewport - remove placeholder class and resolve
            const isItemVisible = visibleItems.has(itemIndex);

            // Check for predictive loading: items near viewport but not fully visible
            let isItemNearViewport = isItemVisible;
            if (!isItemNearViewport && hasPlaceholderClass) {
                // Hoisted viewport + strip math (or one GBCR fallback) — no per-item querySelector/getComputedStyle
                const cellHeight = (galleryStripGeometryPass && galleryStripGeometryPass.itemHeight) || itemHeight || (window.innerHeight / 5);
                const predictiveBuffer = cellHeight * 2; // Load items 2 rows away
                const bounds = (galleryStripGeometryPass && galleryItemScrollBoundsFromDomIndex(i, galleryStripGeometryPass))
                    || galleryItemScrollBoundsFromRect(el, rootsVs, viewportVs);
                const isAboveViewport = bounds.itemBottom > viewportVs.viewportTop - predictiveBuffer && bounds.itemTop < viewportVs.viewportTop;
                const isBelowViewport = bounds.itemTop < viewportVs.viewportBottom + predictiveBuffer && bounds.itemBottom > viewportVs.viewportBottom;

                isItemNearViewport = isItemVisible || isAboveViewport || isBelowViewport;
            }

            // Check if observer-based resolution is allowed
            // Only allow observer resolution if:
            // 1. RTT < 500ms (more conservative threshold)
            // 2. Not currently scrolling
            // 3. Not in fast scrolling state
            // 4. Multiplexing level > 0
            const multiplexingLevel = calculateMultiplexingLevel();
            const allowObserverResolution = multiplexingLevel > 0 &&
                !isScrolling &&
                !isFastScrolling &&
                multiplexingLevel >= 2; // Require higher multiplexing for observer resolution

            if (hasPlaceholderClass && isGalleryItem && isItemNearViewport) {
                // Visible placeholder rows should never wait behind background queue work.
                if (isItemVisible && immediateVisibleResolved < immediateVisibleResolveBudget) {
                    const fileIndex = parseInt(el.dataset.fileIndex, 10);
                    const image = allImages[fileIndex];
                    if (image && !el.querySelector('img')) {
                        el.classList.remove('gallery-placeholder');
                        addImgToGalleryItemAsync(el, image);
                        immediateVisibleResolved++;
                        continue;
                    }
                }
                if (allowObserverResolution) {
                    // Fast connection: resolve directly via observer with throttling
                    const now = Date.now();
                    if (now - lastObserverResolutionTime >= observerResolutionThrottleMs) {
                        lastObserverResolutionTime = now;
                        el.classList.remove('gallery-placeholder');
                        // Add img element if it doesn't exist (placeholders don't have img elements)
                        if (!el.querySelector('img')) {
                            const fileIndex = parseInt(el.dataset.fileIndex);
                            const image = allImages[fileIndex];
                            if (image) {
                                addImgToGalleryItemAsync(el, image);
                            }
                        }
                    }
                } else {
                    // Slow connection or scrolling: queue for background resolution to prevent flickering
                    const fileImageIndex = parseInt(el.dataset.fileIndex);
                    const filteredIndex = parseInt(el.dataset.index);
                    queuePlaceholderResolution(el, fileImageIndex, filteredIndex);
                }
            } else if (hasPlaceholderClass && !isGalleryItem && isItemNearViewport) {
                // Standalone placeholder (not a gallery-item) - resolve directly
                if (isItemVisible && immediateVisibleResolved < immediateVisibleResolveBudget) {
                    el.classList.remove('gallery-placeholder');
                    el.classList.add('gallery-item');
                    immediateVisibleResolved++;
                    continue;
                }
                if (allowObserverResolution) {
                    // Fast connection: resolve standalone placeholders directly with throttling
                    const now = Date.now();
                    if (now - lastObserverResolutionTime >= observerResolutionThrottleMs) {
                        lastObserverResolutionTime = now;
                        // Remove placeholder class and replace with gallery-item
                        el.classList.remove('gallery-placeholder');
                        el.classList.add('gallery-item');
                    }
                } else {
                    // Slow connection or scrolling: queue standalone placeholders too
                    const fileImageIndex = parseInt(el.dataset.fileIndex);
                    const filteredIndex = parseInt(el.dataset.index);
                    queuePlaceholderResolution(el, fileImageIndex, filteredIndex);
                }
            }
        }
    }

    // --- Dynamic placeholder management above and below buffer, in full row batches ---
    const allPlaceholders = Array.from(gallery.querySelectorAll('.gallery-placeholder'));

    // Find checked placeholders
    const checkedIndices = allPlaceholders
        .map((el, idx) => el.dataset.selected === 'true' ? idx : -1)
        .filter(idx => idx !== -1);
    const firstChecked = checkedIndices.length > 0 ? checkedIndices[0] : null;
    const lastChecked = checkedIndices.length > 0 ? checkedIndices[checkedIndices.length - 1] : null;

    // Build a set of all indices currently present in the DOM
    const presentIndices = new Set();
    Array.from(gallery.children).forEach(el => {
        if (el.dataset && el.dataset.index !== undefined) {
            presentIndices.add(parseInt(el.dataset.index));
        }
    });

    // Count placeholders above and below buffer
    // Use data-index instead of DOM position for accurate counting after reindexing
    let placeholdersAbove = 0, placeholdersBelow = 0;
    for (let i = 0; i < allPlaceholders.length; i++) {
        const placeholder = allPlaceholders[i];
        const idx = parseInt(placeholder.dataset.index || '0');
        if (idx < minKeep) placeholdersAbove++;
        if (idx > maxKeep) placeholdersBelow++;
    }
    // Smart placeholder cleanup for iOS compatibility
    // Instead of removing placeholders immediately, schedule them for cleanup
    const placeholdersToRemove = [];

    // Use different thresholds based on scroll velocity and platform
    let cleanupThreshold;
    if (isVeryFastScrolling) {
        cleanupThreshold = isIOS ? bufferSize * 0.5 : bufferSize * 1; // Very aggressive during very fast scrolling
    } else if (isRapidScrolling) {
        cleanupThreshold = isIOS ? bufferSize * 1 : bufferSize * 2; // Aggressive during fast scrolling
    } else {
        cleanupThreshold = isIOS ? bufferSize * 2 : bufferSize * 4; // Default conservative approach
    }

    // Check if user is actively scrolling down (which might indicate they want to go further)
    const isScrollingDown = scrollVelocity > 0;
    const isScrollingUp = scrollVelocity < 0;

    // Check if user is near the bottom and might want to scroll further down (match scroll root: window vs gallery container)
    const isNearBottom = isContainerScrollVs && galleryContainerVs
        ? galleryContainerVs.scrollTop + galleryContainerVs.clientHeight > galleryContainerVs.scrollHeight - 200
        : window.pageYOffset + window.innerHeight > document.documentElement.scrollHeight - 200;

    allPlaceholders.forEach(placeholder => {
        // Use data-index instead of DOM position for accurate index tracking after reindexing
        const idx = parseInt(placeholder.dataset.index || '0');
        // When viewport indices desync from the loaded DOM floor/ceiling, protect mounted range from cleanup.
        const desyncTol = Math.max(realGalleryColumns * 2, 8);
        const galleryFloorDesync = loadMinG !== Infinity && loadMinG - minVisibleGallery > desyncTol;
        const galleryCeilingDesync = loadMinG !== Infinity && maxVisibleGallery - loadMaxG > desyncTol;
        if ((galleryFloorDesync || galleryCeilingDesync) && idx >= loadMinG && idx <= loadMaxG) {
            return;
        }

        // iOS: NEVER remove placeholders above the viewport to prevent screen flashing
        // Only remove placeholders below the viewport when safe
        // This follows iOS best practices to maintain scroll position and prevent screen flashing
        if (isIOS) {
            // On iOS, only remove placeholders that are far below the viewport
            // and only when scrolling up (not when scrolling down)
            // This prevents the "bounce" effect and maintains smooth scrolling
            if (idx > maxKeep + cleanupThreshold * 2 && isScrollingUp && !isScrollingDown) {
                if (placeholder.dataset.selected !== 'true') {
                    placeholdersToRemove.push(placeholder);
                }
            }
        } else {
            // Desktop: More aggressive cleanup in scroll direction for better performance
            let effectiveThresholdAbove = cleanupThreshold;
            let effectiveThresholdBelow = cleanupThreshold;

            if (isScrollingDown) {
                // When scrolling down: be more aggressive removing from top, conservative adding to bottom
                effectiveThresholdAbove *= 2.0; // Remove more from above (top)
                effectiveThresholdBelow *= 0.5; // Keep more below (bottom)
            } else if (isScrollingUp) {
                // When scrolling up: be more aggressive removing from bottom, conservative adding to top
                effectiveThresholdBelow *= 2.0; // Remove more from below (bottom)
                effectiveThresholdAbove *= 0.5; // Keep more above (top)
            } else {
                // No active scrolling: balanced approach
                effectiveThresholdAbove *= 1.0;
                effectiveThresholdBelow *= 1.0;
            }

            // Be even more conservative when near the bottom
            if (isNearBottom) {
                effectiveThresholdBelow *= 2; // Double the threshold below when near bottom
            }

            // Check for removal based on directional thresholds
            const shouldRemoveAbove = idx < minKeep - effectiveThresholdAbove;
            const shouldRemoveBelow = idx > maxKeep + effectiveThresholdBelow;

            if (shouldRemoveAbove || shouldRemoveBelow) {
                // Only remove placeholders that are very far from viewport in their respective directions
                if (placeholder.dataset.selected !== 'true') {
                    // Apply directional protection: don't remove in the direction we're scrolling
                    const isAboveAndScrollingUp = shouldRemoveAbove && isScrollingUp;
                    const isBelowAndScrollingDown = shouldRemoveBelow && isScrollingDown;

                    // Don't remove placeholders in scroll direction unless very far away
                    if (!isAboveAndScrollingUp && !isBelowAndScrollingDown) {
                        // Extra protection: don't remove placeholders below when near bottom
                        if (!(isNearBottom && shouldRemoveBelow)) {
                            placeholdersToRemove.push(placeholder);
                        }
                    }
                }
            }
        }
    });

    // Schedule cleanup to prevent layout shifts during iOS scrolling
    // Don't cleanup if user is actively scrolling to prevent interruptions
    // Use the same rapid scrolling detection as above for consistency
    const isCurrentlyRapidScrolling = Math.abs(scrollVelocity) > 3; // Use same threshold as above

    // During very fast scrolling, delay cleanup even more to prevent performance issues
    if (placeholdersToRemove.length > 0 && !isScrolling && !isCurrentlyRapidScrolling) {
        schedulePlaceholderCleanup(placeholdersToRemove);
    }

    // During fast scrolling, only add placeholders in the current direction.
    // Direction lock must follow current velocity; stale fastScrollDirection can block add-above at top.
    let skipAddingAbove = isFastScrolling && fastScrollDirection === 1 && scrollVelocity > 0; // Scrolling down fast = don't add above
    const skipAddingBelow = (isScrolling && scrollVelocity < 0) || (isFastScrolling && fastScrollDirection === -1);

    // Backpressure: don't expand upward while near-viewport placeholders are still unresolved.
    // This prevents "add-above outruns resolve" behavior and row catch-up churn.
    let unresolvedNearViewportCount = 0;
    if (scrollVelocity < 0) {
        const checkTop = minVisibleGallery - (realGalleryColumns * 2);
        const checkBottom = maxVisibleGallery + realGalleryColumns;
        for (let i = 0; i < total; i++) {
            const el = items[i];
            if (!el.classList.contains('gallery-placeholder')) continue;
            const idx = parseInt(el.dataset.index || '-1', 10);
            if (isNaN(idx) || idx < checkTop || idx > checkBottom) continue;
            if (!el.querySelector('img')) unresolvedNearViewportCount++;
        }
    }
    const shouldHoldAboveForResolve = scrollVelocity < 0 && unresolvedNearViewportCount >= Math.max(realGalleryColumns, 6);
    if (shouldHoldAboveForResolve) {
        skipAddingAbove = true;
    }

    // Add missing placeholders above (in full row batches, only for missing indices)
    while (placeholdersAbove < bufferSize && !skipAddingAbove) {
        // Check if there are actually images above the current position
        let firstChild = gallery.firstChild;
        let firstIndex = firstChild && firstChild.dataset && firstChild.dataset.index !== undefined ? parseInt(firstChild.dataset.index) : displayedStartIndex;

        // If firstIndex is 0 or less, there are no images above to load
        if (firstIndex <= 0) break;

        // Only enable scroll position preservation if user is near the top of the gallery
        const scrollTop = window.pageYOffset;
        const isNearTop = scrollTop < 200; // Only preserve position if within 200px of top

        if (isNearTop && !scrollPositionPreservationEnabled) {
            scrollPositionPreservationEnabled = true;
            preserveScrollPosition();
        }

        // Scale batch size based on scroll velocity and direction - faster scrolling in direction = larger batches
        const absScrollVelocity = Math.abs(scrollVelocity);
        const isScrollingUp = scrollVelocity < 0;
        const isScrollingDown = scrollVelocity > 0;

        let baseMultiplier = 1; // Default: 1 row at a time
        if (absScrollVelocity >= 6) {
            // Very fast: scale from 5x to 8x based on velocity
            baseMultiplier = 5 + ((absScrollVelocity - 6) / 10) * 3; // 5x to 8x
            baseMultiplier = Math.min(8, baseMultiplier);
        } else if (absScrollVelocity >= 3) {
            // Rapid: scale from 3x to 5x based on velocity
            baseMultiplier = 3 + ((absScrollVelocity - 3) / 3) * 2; // 3x to 5x
        } else if (absScrollVelocity > 0) {
            // Normal: scale from 1x to 3x based on velocity
            baseMultiplier = 1 + (absScrollVelocity / 3) * 2; // 1x to 3x
        }

        // Apply directional boost: increase multiplier when scrolling in this direction
        let batchMultiplier = baseMultiplier;
        if (isScrollingUp) {
            // When scrolling up, add more above (boost multiplier)
            batchMultiplier *= 1.5; // 50% more when scrolling up
        } else if (isScrollingDown) {
            // When scrolling down, still add some above but less aggressively
            batchMultiplier *= 0.7; // 30% less when scrolling down
        }

        // Ensure minimum of 1 row is always added above for buffer maintenance
        const minRowsAbove = 2; // Always maintain at least 2 rows above viewport

        // Calculate how many rows to add, ensuring we add complete rows
        const maxRowsToAdd = Math.floor((bufferSize - placeholdersAbove) / realGalleryColumns);
        const rowsToAdd = Math.max(minRowsAbove, Math.min(Math.floor(batchMultiplier), maxRowsToAdd));

        if (rowsToAdd < 1) break; // Need at least 1 complete row

        const needed = rowsToAdd * realGalleryColumns; // Always a multiple of realGalleryColumns
        let actuallyAdded = 0;

        // Add items in reverse order (highest index first) to maintain correct order
        // Process row by row to ensure complete rows
        for (let row = 0; row < rowsToAdd; row++) {
            let rowAdded = 0;
            for (let col = 0; col < realGalleryColumns; col++) {
                const itemOffset = row * realGalleryColumns + col;
                const idx = firstIndex - itemOffset - 1;
                if (idx < 0) break;
                if (!presentIndices.has(idx)) {
                    // idx is filtered index (position), get file index from filteredImageIndices
                    // fileIndex is the position in the full allImages array
                    const fileIndex = window.filteredImageIndices && window.filteredImageIndices[idx] !== undefined
                        ? window.filteredImageIndices[idx]
                        : idx;

                    // Create as gallery-item with placeholder class
                    const image = allImages[fileIndex];
                    if (image) {
                        const item = getOrCreateGalleryItem(image, idx, true); // Skip img element for placeholders
                        item.classList.add('gallery-placeholder');
                        gallery.insertBefore(item, gallery.firstChild);
                        presentIndices.add(idx);
                        actuallyAdded++;
                        rowAdded++;

                        // Observe the new placeholder with intersection observer
                        if (intersectionObserver) {
                            intersectionObserver.observe(item);
                        }
                    }
                }
            }
            // If we couldn't add a complete row, stop (don't add partial rows)
            if (rowAdded < realGalleryColumns) break;
        }

        placeholdersAbove += actuallyAdded;
        // Only break if we couldn't add a complete row
        if (actuallyAdded < realGalleryColumns) break;
    }
    // Add missing placeholders below (in full row batches, only for missing indices)
    while (placeholdersBelow < bufferSize && !skipAddingBelow) {
        // Check if there are actually images below the current position
        let lastChild = gallery.lastChild;
        let lastIndex = lastChild && lastChild.dataset && lastChild.dataset.index !== undefined ? parseInt(lastChild.dataset.index) : displayedEndIndex;

        // If lastIndex is at or beyond the end of allImages, there are no more images below to load
        if (lastIndex >= allImages.length - 1) break;

        // Scale batch size based on scroll velocity and direction - faster scrolling in direction = larger batches
        const absScrollVelocity = Math.abs(scrollVelocity);
        const isScrollingUp = scrollVelocity < 0;
        const isScrollingDown = scrollVelocity > 0;

        let baseMultiplier = 1; // Default: 1 row at a time
        if (absScrollVelocity >= 6) {
            // Very fast: scale from 5x to 8x based on velocity
            baseMultiplier = 5 + ((absScrollVelocity - 6) / 10) * 3; // 5x to 8x
            baseMultiplier = Math.min(8, baseMultiplier);
        } else if (absScrollVelocity >= 3) {
            // Rapid: scale from 3x to 5x based on velocity
            baseMultiplier = 3 + ((absScrollVelocity - 3) / 3) * 2; // 3x to 5x
        } else if (absScrollVelocity > 0) {
            // Normal: scale from 1x to 3x based on velocity
            baseMultiplier = 1 + (absScrollVelocity / 3) * 2; // 1x to 3x
        }

        // Apply directional boost: increase multiplier when scrolling in this direction
        let batchMultiplier = baseMultiplier;
        if (isScrollingDown) {
            // When scrolling down, add more below (boost multiplier)
            batchMultiplier *= 1.5; // 50% more when scrolling down
        } else if (isScrollingUp) {
            // When scrolling up, still add some below but less aggressively
            batchMultiplier *= 0.7; // 30% less when scrolling up
        }

        // Ensure minimum of 1 row is always added below for buffer maintenance
        const minRowsBelow = 2; // Always maintain at least 2 rows below viewport

        // Calculate how many rows to add, ensuring we add complete rows
        const maxRowsToAdd = Math.floor((bufferSize - placeholdersBelow) / realGalleryColumns);
        const rowsToAdd = Math.max(minRowsBelow, Math.min(Math.floor(batchMultiplier), maxRowsToAdd));

        if (rowsToAdd < 1) break; // Need at least 1 complete row

        const needed = rowsToAdd * realGalleryColumns; // Always a multiple of realGalleryColumns
        let actuallyAdded = 0;

        // Check bounds using filtered array length (position check)
        const maxFilteredIndex = window.filteredImageIndices ? window.filteredImageIndices.length - 1 : allImages.length - 1;

        // Add items in forward order (lowest index first) to maintain correct order
        // Process row by row to ensure complete rows
        for (let row = 0; row < rowsToAdd; row++) {
            let rowAdded = 0;
            for (let col = 0; col < realGalleryColumns; col++) {
                const itemOffset = row * realGalleryColumns + col;
                const idx = lastIndex + itemOffset + 1; // idx is filtered index
                if (idx > maxFilteredIndex) break;
                if (!presentIndices.has(idx)) {
                    // idx is filtered index (position), get file index from filteredImageIndices
                    // fileIndex is the position in the full allImages array
                    const fileIndex = window.filteredImageIndices && window.filteredImageIndices[idx] !== undefined
                        ? window.filteredImageIndices[idx]
                        : idx;

                    // Create as gallery-item with placeholder class
                    const image = allImages[fileIndex];
                    if (image) {
                        const item = getOrCreateGalleryItem(image, idx, true); // Skip img element for placeholders
                        item.classList.add('gallery-placeholder');
                        gallery.appendChild(item);
                        presentIndices.add(idx);
                        actuallyAdded++;
                        rowAdded++;

                        // Observe the new placeholder with intersection observer
                        if (intersectionObserver) {
                            intersectionObserver.observe(item);
                        }
                    }
                }
            }
            // If we couldn't add a complete row, stop (don't add partial rows)
            if (rowAdded < realGalleryColumns) break;
        }

        placeholdersBelow += actuallyAdded;
        // Only break if we couldn't add a complete row
        if (actuallyAdded < realGalleryColumns) break;
    }
    // After all changes, update displayedStartIndex and displayedEndIndex to match the DOM
    let newFirst = gallery.firstChild && gallery.firstChild.dataset && gallery.firstChild.dataset.index !== undefined ? parseInt(gallery.firstChild.dataset.index) : 0;
    let newLast = gallery.lastChild && gallery.lastChild.dataset && gallery.lastChild.dataset.index !== undefined ? parseInt(gallery.lastChild.dataset.index) : 0;
    displayedStartIndex = Math.max(0, newFirst);
    displayedEndIndex = Math.max(displayedStartIndex, newLast + 1);

    // --- Force resolve all placeholders in the visible/buffered range to real items ---
    // Recompute visible/buffered range after any placeholder changes (re-calibrate; DOM may have grown)
    const updatedItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const updatedTotal = updatedItems.length;
    const viewportAfter = getGalleryViewportBounds(rootsVs);
    const geometryAfter = measureGalleryStripGeometry(updatedItems, viewportAfter, rootsVs);
    let updatedVisible = new Set();
    for (let index = 0; index < updatedTotal; index++) {
        const item = updatedItems[index];
        const bounds = (geometryAfter && galleryItemScrollBoundsFromDomIndex(index, geometryAfter))
            || galleryItemScrollBoundsFromRect(item, rootsVs, viewportAfter);
        if (bounds.itemBottom > viewportAfter.viewportTop && bounds.itemTop < viewportAfter.viewportBottom) {
            updatedVisible.add(index);
        }
    }
    const updatedVisibleIndices = Array.from(updatedVisible);
    if (updatedVisibleIndices.length > 0) {
        const minVisible = Math.min(...updatedVisibleIndices);
        const maxVisible = Math.max(...updatedVisibleIndices);
        const minKeep = Math.max(0, minVisible - realGalleryColumns); // 1 screen above
        const maxKeep = Math.min(updatedTotal - 1, maxVisible + realGalleryColumns); // 1 screen below
        for (let i = minKeep; i <= maxKeep; i++) {
            const el = updatedItems[i];
            if (el && el.classList.contains('gallery-placeholder')) {
                // If it's a gallery-item with placeholder class, just remove the class and ensure img exists
                if (el.classList.contains('gallery-item')) {
                    el.classList.remove('gallery-placeholder');
                    // Add img element if it doesn't exist (placeholders don't have img elements)
                    if (!el.querySelector('img')) {
                        const fileIndex = parseInt(el.dataset.fileIndex);
                        const image = allImages[fileIndex];
                        if (image) {
                            addImgToGalleryItemAsync(el, image);
                        }
                    }
                } else {
                    // Standalone placeholder - needs to be resolved to gallery-item
                    const dataIndex = el.dataset.index;
                    const dataFileIndex = el.dataset.fileIndex;

                    // dataFileIndex is the file index in allImages, dataIndex is the filtered position
                    const fileImageIndex = parseInt(dataFileIndex || dataIndex || i);
                    const filteredIndex = parseInt(dataIndex || i); // This is the filtered position for createGalleryItem

                    // Add to queue instead of processing immediately
                    queuePlaceholderResolution(el, fileImageIndex, filteredIndex);
                }
            }
        }
    }

    // With sentinel-based approach, infinite scroll is handled by Intersection Observer
    // No need for scroll-based detection here

    // Restore scroll position if placeholders were added above
    if (scrollPositionPreservationEnabled) {
        restoreScrollPosition();
    }

    galleryStripGeometryPass = null;
}

// Refresh the entire gallery display to ensure consistency
function refreshGalleryDisplay() {
    if (isGalleryWindowHidden()) return;
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // captureGalleryViewportAnchor: public/scripts/comp/galleryView.js — before wiping DOM
    const anchor = captureGalleryViewportAnchor();

    // Clear current gallery
    if (gallery) {
        disposeGalleryContents();
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }
        gallery.innerHTML = '';
    }

    if (anchor) {
        const target = resolveGalleryViewportAnchorIndex(anchor);
        // displayGalleryFromStartIndex: public/scripts/comp/galleryView.js
        displayGalleryFromStartIndex(target, false);
    } else {
        resetInfiniteScroll();
        displayCurrentPageOptimized();
    }

    // Update UI elements
    updateGalleryPlaceholders();
    updateGalleryTitleBar({ syncTaskbar: true });
}

function removeImageFromGallery(image) {
    // Don't update gallery if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't update gallery if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            console.error('No filename available for image removal');
            return;
        }

        // Find the gallery item to remove
        const galleryItems = document.querySelectorAll('.gallery-item');
        let itemToRemove = null;
        let itemIndex = -1;

        // Try to find by exact filename match first
        for (const item of galleryItems) {
            const itemFilename = item.dataset.filename;
            if (itemFilename === filename) {
                itemToRemove = item;
                itemIndex = parseInt(item.dataset.index);
                break;
            }
        }

        // If not found by exact match, try to find by base name (for variations/upscaled)
        if (!itemToRemove) {
            const baseName = filename.split('_')[0]; // Get the timestamp part
            for (const item of galleryItems) {
                const itemFilename = item.dataset.filename;
                if (itemFilename) {
                    const itemBaseName = itemFilename.split('_')[0];
                    if (itemBaseName === baseName) {
                        itemToRemove = item;
                        itemIndex = parseInt(item.dataset.index);
                        break;
                    }
                }
            }
        }

        if (!itemToRemove) {
            console.warn('Gallery item not found for removal:', filename);
            // Don't return, just log the warning and continue with the operation
            // The image will still be removed from allImages array and workspace
        }

        // Remove the item from the gallery if found
        if (itemToRemove) {
            disposeGalleryItemElement(itemToRemove);
            itemToRemove.remove();
        }

        // Remove from allImages array and update originalAllImages if it exists
        const allImagesIndex = findTrueImageIndex(image);

        if (allImagesIndex !== -1) {
            // Clean up placeholder resolution queue - remove or update entries that reference this index
            placeholderResolutionQueue = placeholderResolutionQueue.filter(item => {
                if (!item || !item.element || !item.element.parentNode) {
                    // Element was removed, remove from queue
                    return false;
                }

                // If this placeholder references the removed index or a higher index, update or remove it
                if (item.fileImageIndex === allImagesIndex) {
                    // This placeholder was for the removed image - remove it from DOM and queue
                    if (item.element && item.element.parentNode) {
                        disposeGalleryItemElement(item.element);
                        item.element.remove();
                    }
                    return false;
                } else if (item.fileImageIndex > allImagesIndex) {
                    // This placeholder's index needs to be decremented
                    item.fileImageIndex--;
                    // Also update the element's data-file-index attribute
                    if (item.element) {
                        item.element.dataset.fileIndex = item.fileImageIndex.toString();
                    }
                }
                return true;
            });

            allImages.splice(allImagesIndex, 1);

            // Sync separate search baseline copy when it is not the same array reference
            if (window.originalAllImages && window.originalAllImages.length > 0 && window.originalAllImages !== allImages) {
                const originalIndex = window.originalAllImages.findIndex(img => {
                    const imgFilename = img.filename || img.original || img.upscaled;
                    const targetFilename = image.filename || image.original || image.upscaled;
                    return imgFilename === targetFilename;
                });
                if (originalIndex !== -1) {
                    window.originalAllImages.splice(originalIndex, 1);
                }
            }

            // Update filteredImageIndices if it exists - remove the index and shift others
            if (window.filteredImageIndices && Array.isArray(window.filteredImageIndices)) {
                // Find the index in filteredImageIndices that points to allImagesIndex
                const filteredIndex = window.filteredImageIndices.findIndex(idx => idx === allImagesIndex);
                if (filteredIndex !== -1) {
                    // Remove the index from filteredImageIndices
                    window.filteredImageIndices.splice(filteredIndex, 1);
                    // Decrement all indices that were greater than the removed index
                    for (let i = 0; i < window.filteredImageIndices.length; i++) {
                        if (window.filteredImageIndices[i] > allImagesIndex) {
                            window.filteredImageIndices[i]--;
                        }
                    }
                } else {
                    // If not found in filtered indices, rebuild the mapping
                    window.filteredImageIndices = allImages.map((_, index) => index);
                }
            }
        }

        // Track the last visible item before removal for scroll restoration
        let lastVisibleItemIndex = -1;
        let lastVisibleItem = null;

        // Find the last visible item that's not being removed
        if (itemToRemove) {
            const allItems = Array.from(gallery.querySelectorAll('.gallery-item, .gallery-placeholder'));
            const viewportTop = gallery.scrollTop;
            const viewportBottom = viewportTop + gallery.clientHeight;

            // Find the last item that's visible and not being removed
            for (let i = allItems.length - 1; i >= 0; i--) {
                const item = allItems[i];
                if (item === itemToRemove || item.classList.contains('gallery-placeholder')) continue;

                const rect = item.getBoundingClientRect();
                const itemTop = rect.top + gallery.scrollTop;
                const itemBottom = itemTop + rect.height;

                // Check if item is visible in viewport
                if (itemBottom >= viewportTop && itemTop <= viewportBottom) {
                    lastVisibleItem = item;
                    lastVisibleItemIndex = parseInt(item.dataset.index || '0');
                    break;
                }
            }

            // If no visible item found, use the item before the removed one
            if (!lastVisibleItem && itemIndex > 0) {
                const itemBefore = allItems[itemIndex - 1];
                if (itemBefore && itemBefore !== itemToRemove) {
                    lastVisibleItem = itemBefore;
                    lastVisibleItemIndex = parseInt(itemBefore.dataset.index || '0');
                }
            }
        }

        // Reindex the entire gallery after array changes using the dedicated function
        // This ensures all items and placeholders have correct indices and removes duplicates
        reindexGallery();

        triggerBuildGalleryNavigationCache();

        // Trigger virtual scroll update to refresh placeholder states after reindexing
        // This ensures the virtual scroll system uses the correct indices
        requestAnimationFrame(() => {
            updateVirtualScroll();
        });

        // DON'T add placeholders here - let the placeholder system handle it naturally
        // The placeholder system will add placeholders in the buffer around the viewport
        // when the user scrolls or when addPlaceholdersBelow/addPlaceholdersAbove is called

        // Restore scroll position to the last visible item
        if (lastVisibleItem && lastVisibleItem.parentNode) {
            // Use requestAnimationFrame to ensure DOM is updated
            requestAnimationFrame(() => {
                // Re-query the item after reindexing (its index may have changed)
                const currentIndex = parseInt(lastVisibleItem.dataset.index || '0');
                const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');

                // Find the item at the target index
                let targetItem = null;
                for (const item of items) {
                    if (parseInt(item.dataset.index || '0') === currentIndex) {
                        targetItem = item;
                        break;
                    }
                }

                // If we can't find by index, try to find the last visible item
                if (!targetItem && lastVisibleItem.parentNode) {
                    targetItem = lastVisibleItem;
                }

                if (targetItem) {
                    const rect = targetItem.getBoundingClientRect();
                    const galleryRect = gallery.getBoundingClientRect();
                    const scrollTop = gallery.scrollTop + (rect.top - galleryRect.top);

                    // Scroll to the item, maintaining some offset for better UX
                    gallery.scrollTop = Math.max(0, scrollTop - 20);
                }
            });
        }

        // Always refresh the gallery display to ensure consistency
        refreshGalleryDisplay();

    } catch (error) {
        console.error('Error removing image from gallery:', error);
    }
}

// Remove multiple images from gallery and add placeholders at the end
function removeMultipleImagesFromGallery(images) {
    // Don't update gallery if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    try {
        if (!Array.isArray(images) || images.length === 0) {
            console.warn('No images provided for bulk removal');
            return;
        }

        const galleryItems = document.querySelectorAll('.gallery-item');
        const itemsToRemove = [];
        const indicesToRemove = [];

        // Find all items to remove
        for (const image of images) {
            const filename = image.filename || image.original || image.upscaled;
            if (!filename) continue;

            for (const item of galleryItems) {
                const img = item.querySelector('img');
                if (img) {
                    const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
                    if (itemFilename === filename) {
                        itemsToRemove.push(item);
                        indicesToRemove.push(parseInt(item.dataset.index));
                        break;
                    }
                }
            }
        }

        // Sort indices in descending order to remove from end to beginning
        indicesToRemove.sort((a, b) => b - a);

        // Remove items from gallery
        itemsToRemove.forEach((item) => {
            disposeGalleryItemElement(item);
            item.remove();
        });

        // Remove from allImages array and clean up placeholder queue
        const removedIndices = [];
        const removedImages = []; // Store image data before removal

        for (const image of images) {
            const allImagesIndex = findTrueImageIndex(image);

            if (allImagesIndex !== -1) {
                removedIndices.push(allImagesIndex);
                removedImages.push({ image, index: allImagesIndex });
            }
        }

        // Sort removed indices in descending order for proper cleanup
        removedIndices.sort((a, b) => b - a);
        removedImages.sort((a, b) => b.index - a.index);

        // Clean up placeholder resolution queue for all removed indices
        for (const removedIndex of removedIndices) {
            placeholderResolutionQueue = placeholderResolutionQueue.filter(item => {
                if (!item || !item.element || !item.element.parentNode) {
                    return false;
                }

                // If this placeholder references the removed index or a higher index, update or remove it
                if (item.fileImageIndex === removedIndex) {
                    // This placeholder was for the removed image - remove it from DOM and queue
                    if (item.element && item.element.parentNode) {
                        disposeGalleryItemElement(item.element);
                        item.element.remove();
                    }
                    return false;
                } else if (item.fileImageIndex > removedIndex) {
                    // This placeholder's index needs to be decremented
                    item.fileImageIndex--;
                    // Also update the element's data-file-index attribute
                    if (item.element) {
                        item.element.dataset.fileIndex = item.fileImageIndex.toString();
                    }
                }
                return true;
            });
        }

        // Now remove from allImages array (in reverse order to maintain correct indices)
        for (let i = 0; i < removedImages.length; i++) {
            const { image, index: removedIndex } = removedImages[i];
            allImages.splice(removedIndex, 1);

            // Update originalAllImages if it exists
            if (window.originalAllImages && window.originalAllImages.length > 0) {
                const originalIndex = window.originalAllImages.findIndex(img => {
                    const imgFilename = img.filename || img.original || img.upscaled;
                    const targetFilename = image.filename || image.original || image.upscaled;
                    return imgFilename === targetFilename;
                });
                if (originalIndex !== -1) {
                    window.originalAllImages.splice(originalIndex, 1);
                }
            }

            // Update filteredImageIndices - decrement indices greater than removed index
            if (window.filteredImageIndices && Array.isArray(window.filteredImageIndices)) {
                for (let j = 0; j < window.filteredImageIndices.length; j++) {
                    if (window.filteredImageIndices[j] > removedIndex) {
                        window.filteredImageIndices[j]--;
                    } else if (window.filteredImageIndices[j] === removedIndex) {
                        // Remove the index that pointed to the removed image
                        window.filteredImageIndices.splice(j, 1);
                        j--; // Adjust index after splice
                    }
                }
            }
        }

        // For multiple removals: track the last selected item (highest index) for scroll restoration
        // Get the filename of the last selected item before removal
        let lastSelectedFilename = null;
        let lastSelectedIndex = -1;

        if (images.length > 1) {
            // Multiple items being removed - find the last selected item (highest index)
            // Get all selected filenames and find the one with the highest index
            const selectedFilenames = Array.from(selectedImages);
            const allItemsBeforeRemoval = Array.from(gallery.querySelectorAll('.gallery-item, .gallery-placeholder'));

            // Find the item with the highest index that's in the selected set
            for (const item of allItemsBeforeRemoval) {
                if (item.classList.contains('gallery-placeholder')) continue;

                const itemFilename = item.dataset.filename;
                if (itemFilename && selectedFilenames.includes(itemFilename)) {
                    const itemIndex = parseInt(item.dataset.index || '0');
                    if (itemIndex > lastSelectedIndex) {
                        lastSelectedIndex = itemIndex;
                        lastSelectedFilename = itemFilename;
                    }
                }
            }
        } else {
            // Single item removal - use the last visible item approach
            let lastVisibleItem = null;

            if (itemsToRemove.length > 0) {
                const allItems = Array.from(gallery.querySelectorAll('.gallery-item, .gallery-placeholder'));
                const viewportTop = gallery.scrollTop;
                const viewportBottom = viewportTop + gallery.clientHeight;
                const itemsToRemoveSet = new Set(itemsToRemove);

                // Find the last item that's visible and not being removed
                for (let i = allItems.length - 1; i >= 0; i--) {
                    const item = allItems[i];
                    if (itemsToRemoveSet.has(item) || item.classList.contains('gallery-placeholder')) continue;

                    const rect = item.getBoundingClientRect();
                    const itemTop = rect.top + gallery.scrollTop;
                    const itemBottom = itemTop + rect.height;

                    // Check if item is visible in viewport
                    if (itemBottom >= viewportTop && itemTop <= viewportBottom) {
                        lastVisibleItem = item;
                        lastSelectedFilename = item.dataset.filename;
                        break;
                    }
                }
            }
        }

        // Reindex the entire gallery after array changes using the dedicated function
        // This ensures all items and placeholders have correct indices and removes duplicates
        reindexGallery();

        triggerBuildGalleryNavigationCache();

        // Trigger virtual scroll update to refresh placeholder states after reindexing
        // This ensures the virtual scroll system uses the correct indices
        requestAnimationFrame(() => {
            updateVirtualScroll();
            scheduleDeferredPlaceholderAddition('below');
        });

        // DON'T add placeholders here - let the placeholder system handle it naturally
        // The placeholder system will add placeholders in the buffer around the viewport

        // Restore scroll position to the last selected item (for multiple removals) or last visible item (for single removal)
        if (lastSelectedFilename) {
            requestAnimationFrame(() => {
                // Find the item by filename after reindexing
                const targetItem = gallery.querySelector(`[data-filename="${lastSelectedFilename}"]`);

                if (targetItem) {
                    // Get the item's new index after reindexing
                    const targetIndex = parseInt(targetItem.dataset.index || '0');

                    // Scroll to the item directly
                    const rect = targetItem.getBoundingClientRect();
                    const galleryRect = gallery.getBoundingClientRect();
                    const scrollTop = gallery.scrollTop + (rect.top - galleryRect.top);
                    gallery.scrollTop = Math.max(0, scrollTop - 20);
                } else {
                    // Item not found in DOM - might be a placeholder or out of view
                    // Find it in the array and use displayGalleryFromStartIndex to load items around it
                    const sourceArray = window.filteredImageIndices && window.filteredImageIndices.length > 0
                        ? window.filteredImageIndices.map(idx => allImages[idx]).filter(img => img)
                        : allImages;

                    const targetImageIndex = sourceArray.findIndex(img => {
                        const imgFilename = img.filename || img.original || img.upscaled;
                        return imgFilename === lastSelectedFilename;
                    });

                    if (targetImageIndex !== -1) {
                        // Use the filtered index for displayGalleryFromStartIndex
                        const filteredIndex = window.filteredImageIndices && window.filteredImageIndices.length > 0
                            ? targetImageIndex // targetImageIndex is already the filtered position
                            : targetImageIndex;

                        displayGalleryFromStartIndex(filteredIndex, true);
                    }
                }
            });
        }

        // Always refresh the gallery display to ensure consistency after bulk removal
        refreshGalleryDisplay();

    } catch (error) {
        console.error('Error removing multiple images from gallery:', error);
    }
}

// Selection handling functions
async function handleImageSelection(image, isSelected, event) {
    const filename = image.filename || image.original || image.upscaled;

    // Skip if no valid filename found
    if (!filename) {
        console.warn('No valid filename found for image:', image);
        return;
    }

    const item = event.target.closest('.gallery-item');

    // Cache DOM query - only query once for both ALT+click and index tracking
    // Find clicked item's index in the array (not DOM order)
    const clickedArrayIndex = findImageArrayIndex(filename);

    // ALT+click range selection
    if (event && event.altKey && clickedArrayIndex !== -1) {
        // Clear "all selected" flag when doing range selection
        isAllSelected = false;

        // Find last selected item's index in the array using selectedImages Set
        let lastSelectedArrayIndex = null;
        if (selectedImages.size > 0) {
            // Find the last selected item by checking allImages array
            const sourceArray = window.filteredImageIndices && window.filteredImageIndices.length > 0
                ? window.filteredImageIndices.map(idx => allImages[idx]).filter(img => img)
                : allImages;

            // Find both the lowest and highest selected indices
            let lowestSelectedIndex = null;
            let highestSelectedIndex = null;

            for (let i = 0; i < sourceArray.length; i++) {
                const img = sourceArray[i];
                const imgFilename = img.filename || img.original || img.upscaled;
                if (selectedImages.has(imgFilename)) {
                    if (lowestSelectedIndex === null) {
                        lowestSelectedIndex = i;
                    }
                    highestSelectedIndex = i;
                }
            }

            // Determine which selected index to use based on clicked position
            if (lowestSelectedIndex !== null && highestSelectedIndex !== null) {
                // If clicking before the lowest, use lowest as range start
                // If clicking after the highest, use highest as range start
                // If clicking between, use the closest one
                if (clickedArrayIndex < lowestSelectedIndex) {
                    lastSelectedArrayIndex = lowestSelectedIndex;
                } else if (clickedArrayIndex > highestSelectedIndex) {
                    lastSelectedArrayIndex = highestSelectedIndex;
                } else {
                    // Clicking between - use the closest selected index
                    const distToLowest = Math.abs(clickedArrayIndex - lowestSelectedIndex);
                    const distToHighest = Math.abs(clickedArrayIndex - highestSelectedIndex);
                    lastSelectedArrayIndex = distToLowest <= distToHighest ? lowestSelectedIndex : highestSelectedIndex;
                }
            } else if (lowestSelectedIndex !== null) {
                lastSelectedArrayIndex = lowestSelectedIndex;
            } else if (highestSelectedIndex !== null) {
                lastSelectedArrayIndex = highestSelectedIndex;
            }
        }

        // Fallback to lastSelectedGalleryIndex if no selected items found
        if (lastSelectedArrayIndex === null && lastSelectedGalleryIndex !== null) {
            lastSelectedArrayIndex = lastSelectedGalleryIndex;
        }

        if (lastSelectedArrayIndex !== null && clickedArrayIndex !== -1) {
            const [start, end] = [lastSelectedArrayIndex, clickedArrayIndex].sort((a, b) => a - b);

            // Get the source array (filtered or full)
            const sourceArray = window.filteredImageIndices && window.filteredImageIndices.length > 0
                ? window.filteredImageIndices.map(idx => allImages[idx]).filter(img => img)
                : allImages;

            // Select all items in range using array indices
            for (let i = start; i <= end; i++) {
                if (i >= 0 && i < sourceArray.length) {
                    const img = sourceArray[i];
                    const itemFilename = img.filename || img.original || img.upscaled;

                    // Add to selection
                    selectedImages.add(itemFilename);

                    // Update DOM if item is visible
                    const div = document.querySelector(`[data-filename="${itemFilename}"]`);
                    if (div) {
                        div.dataset.selected = 'true';
                        div.classList.add('selected');
                        const cb = div.querySelector('.gallery-item-checkbox');
                        if (cb) cb.checked = true;
                    }
                }
            }

            updateBulkActionsBar();
            lastSelectedGalleryIndex = clickedArrayIndex;
            return;
        }
    }

    // Update last selected index for range selection
    if (clickedArrayIndex !== -1) {
        lastSelectedGalleryIndex = clickedArrayIndex;
    }

    // Update selection state using data-selected as single source of truth
    if (isSelected) {
        if (isAllSelected) {
            // If all are selected, selecting this one means ensure it's not excluded
            selectedImages.delete(filename); // Remove from excluded set
        } else {
            // Normal selection mode
            selectedImages.add(filename);
        }
        item.dataset.selected = 'true';
        item.classList.add('selected');
    } else {
        if (isAllSelected) {
            // If all are selected, deselecting this one means excluding it
            selectedImages.add(filename); // Add to excluded set
        } else {
            // Normal deselection
            selectedImages.delete(filename);
        }
        item.dataset.selected = 'false';
        item.classList.remove('selected');
    }

    updateBulkActionsBar();
}

function updateBulkActionsBar() {
    // Update selection mode state
    const selectedCount = getSelectedCount();
    if (selectedCount > 0) {
        gallery.classList.add('selection-mode');
        isSelectionMode = true;

        // Switch to bulk actions context menu when in selection mode
        if (contextMenu && !gallery.dataset.bulkContextMenuActive) {
            switchToBulkContextMenu();
            gallery.dataset.bulkContextMenuActive = 'true';
        }
    } else {
        gallery.classList.remove('selection-mode');
        isSelectionMode = false;

        // Switch back to original context menus when not in selection mode
        if (contextMenu && gallery.dataset.bulkContextMenuActive) {
            switchToOriginalContextMenu();
            gallery.dataset.bulkContextMenuActive = '';
        }
    }
    // notifyKeyboardOverlayContextChanged: public/scripts/comp/modalKeyboardRegistry.js
    notifyKeyboardOverlayContextChanged();
}

// Helper function to find an image's index in the array (filtered or full)
function findImageArrayIndex(filename) {
    if (!filename) return -1;

    // Get the source array (filtered or full)
    const sourceArray = window.filteredImageIndices && window.filteredImageIndices.length > 0
        ? window.filteredImageIndices.map(idx => allImages[idx]).filter(img => img)
        : allImages;

    // Find the index in the source array
    return sourceArray.findIndex(img => {
        const imgFilename = img.filename || img.original || img.upscaled;
        return imgFilename === filename;
    });
}

// Helper function to check if an image is selected
function isImageSelected(filename) {
    if (isAllSelected) {
        // If all are selected, return true unless explicitly excluded
        return !selectedImages.has(filename);
    }
    return selectedImages.has(filename);
}

// Helper function to get all selected filenames (for bulk operations)
function getSelectedFilenames() {
    if (isAllSelected) {
        // Return all filenames (excluding any explicitly deselected)
        const images = window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0
            ? window.filteredImageIndices.map(idx => allImages[idx])
            : allImages;
        return images
            .filter(img => img != null)
            .map(img => img.filename || img.original || img.upscaled)
            .filter(fname => fname && !selectedImages.has(fname)); // Exclude explicitly deselected
    }
    return Array.from(selectedImages);
}

function getSelectedCount() {
    return isAllSelected ? getSelectedFilenames().length : selectedImages.size;
}

// Get selected image objects (not just filenames)
function getSelectedImages() {
    const selectedFilenames = getSelectedFilenames();
    const selectedImagesArray = [];

    selectedFilenames.forEach(filename => {
        // Find image by filename in allImages
        const image = allImages.find(img =>
            img && (img.filename === filename || img.original === filename || img.upscaled === filename)
        );
        if (image) {
            selectedImagesArray.push(image);
        }
    });

    return selectedImagesArray;
}

function clearSelection() {
    selectedImages.clear();
    isAllSelected = false;
    lastSelectedGalleryIndex = null; // Reset range selection tracking

    // Uncheck all checkboxes
    const checkboxes = document.querySelectorAll('.gallery-item-checkbox');
    checkboxes.forEach(checkbox => {
        checkbox.checked = false;
    });

    // Remove selected class and data-selected attribute from all items (both real items and placeholders)
    const allItems = document.querySelectorAll('.gallery-item, .gallery-placeholder');
    allItems.forEach(item => {
        item.classList.remove('selected');
        item.dataset.selected = 'false';
    });

    updateBulkActionsBar();
}

window.wsClient.registerInitStep(30, 'Initializing Gallery System', async () => {
    // With sentinel-based approach, the main infinite scroll is handled by Intersection Observer
    // The scroll event now only handles virtual scrolling and placeholder management
    let lastScrollTime = 0;
    let scrollTimeout;

    function throttledInfiniteScroll() {
        // Mark as scrolling and clear any existing timeout
        isScrolling = true;
        if (scrollEndTimeout) clearTimeout(scrollEndTimeout);

        // Set a timeout to detect when scrolling stops
        const scrollEndDelay = isIOS ? 150 : 50; // Longer delay to ensure scrolling has truly stopped
        scrollEndTimeout = setTimeout(() => {
            isScrolling = false;
            // Process any queued placeholder cleanup when scrolling stops
            // Only if scroll velocity is low (scrolling has actually stopped)
            if (placeholderCleanupQueue.length > 0 && Math.abs(scrollVelocity) < 0.5) {
                processPlaceholderCleanup();
            }
            // Start processing placeholders immediately when scrolling stops
            if (placeholderResolutionQueue.length > 0) {
                processNextPlaceholders();
            }
            sendGalleryPositionHint();
        }, scrollEndDelay);


        const now = Date.now();
        if (now - lastScrollTime > infiniteScrollConfig.throttleDelay) {
            handleInfiniteScroll();
            lastScrollTime = now;
        }

        // Adjust debounce delay based on scroll velocity for more responsive handling
        const currentVelocity = Math.abs(scrollVelocity);
        let adjustedDebounceDelay = infiniteScrollConfig.debounceDelay;
        if (currentVelocity > 6) {
            adjustedDebounceDelay = Math.max(50, adjustedDebounceDelay * 0.3); // Much faster response during very fast scrolling
        } else if (currentVelocity > 3) {
            adjustedDebounceDelay = Math.max(100, adjustedDebounceDelay * 0.6); // Faster response during fast scrolling
        }

        if (scrollTimeout) clearTimeout(scrollTimeout);
        scrollTimeout = setTimeout(() => {
            handleInfiniteScroll();
        }, adjustedDebounceDelay);
    }

    // Velocity every scroll event; coalesce heavy work to one rAF
    function onGalleryScrollEvent(scrollTarget) {
        updateScrollVelocity(scrollTarget || null);
        if (galleryScrollRaf) return;
        galleryScrollRaf = requestAnimationFrame(() => {
            galleryScrollRaf = 0;
            throttledInfiniteScroll();
        });
    }

    window.addEventListener('scroll', () => {
        onGalleryScrollEvent(null);
    }, { passive: true });

    // Also listen to gallery container scroll (for desktop modal mode)
    const { galleryContainer } = getGalleryScrollRoots();
    if (galleryContainer) {
        galleryContainer.addEventListener('scroll', () => {
            onGalleryScrollEvent(galleryContainer);
        }, { passive: true });
    }

    wireGalleryToolbarListeners();
    wireGalleryKeyboardNav();
    wireMainMenuBarColumnWheel();
});

function isGalleryWindowKeyboardContext(e) {
    if (!document.body.classList.contains('desktop-mode')) return false;
    if (e && e.target) {
        const tag = e.target.tagName;
        if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || e.target.isContentEditable) {
            return false;
        }
    }
    const galleryWindow = document.getElementById('galleryWindow');
    if (!galleryWindow || galleryWindow.classList.contains('hidden')) {
        return false;
    }
    if (typeof isModalActive === 'function') {
        if (!isModalActive(galleryWindow)) return false;
    } else {
        const stack = modalStack || [];
        if (stack.length > 0 && stack[stack.length - 1] !== galleryWindow) return false;
    }
    return true;
}

function onGalleryWindowEscapeKeydown(e) {
    if (e.key !== 'Escape') return;
    if (!document.body.classList.contains('desktop-mode')) return;
    const galleryEl = document.getElementById('gallery');
    if (galleryEl && galleryEl.classList.contains('selection-mode')) return;
    const galleryWindow = document.getElementById('galleryWindow');
    if (!galleryWindow || galleryWindow.classList.contains('hidden') || !galleryWindow.classList.contains('windowed')) return;
    if (currentActiveWindowId && currentActiveWindowId !== 'galleryWindow') return;
    e.preventDefault();
    e.stopPropagation();
    // hideGalleryWindow — public/scripts/comp/modalUtils.js
    hideGalleryWindow();
    return true;
}

function onGalleryJumpIndexEscapeKeydown(e) {
    if (e.key !== 'Escape') return;
    if (!galleryJumpIndexToolEl || galleryJumpIndexToolEl.classList.contains('hidden')) return;
    e.preventDefault();
    e.stopPropagation();
    // closeModal — public/scripts/comp/modalUtils.js
    closeModal(galleryJumpIndexToolEl);
    return true;
}

function onGalleryJumpIndexEnterKeydown(e) {
    if (e.key !== 'Enter') return;
    if (!galleryJumpIndexToolEl || galleryJumpIndexToolEl.classList.contains('hidden')) return;
    const tag = e.target && e.target.tagName;
    if (tag === 'TEXTAREA') return;
    if (e.target && e.target.closest && e.target.closest('.custom-dropdown-menu:not(.hidden)')) return;
    e.preventDefault();
    e.stopPropagation();
    jumpGalleryJumpIndexTarget();
    return true;
}

function onGalleryFunctionKeydown(e) {
    if (!/^F\d{1,2}$/i.test(e.key)) return;
    if (!isGalleryWindowKeyboardContext(e)) return;

    let handled = false;
    switch (e.key.toUpperCase()) {
        case 'F1':
            switchGalleryView('images');
            handled = true;
            break;
        case 'F2':
            switchGalleryView('pinned');
            handled = true;
            break;
        case 'F3':
            switchGalleryView('upscaled');
            handled = true;
            break;
        case 'F4':
            switchGalleryView('scraps');
            handled = true;
            break;
        case 'F5':
            displayGalleryFromStartIndex(0, false);
            if (refreshGalleryJumpIndexUI) {
                refreshGalleryJumpIndexUI();
            } else if (triggerGalleryVirtualScrollFromShortcut) {
                triggerGalleryVirtualScrollFromShortcut();
            }
            handled = true;
            break;
        case 'F6':
            toggleGallerySortOrder();
            handled = true;
            break;
        case 'F7':
            openGalleryJumpIndexToolWindow();
            handled = true;
            break;
        case 'F8':
            // toggleSearchContainer: public/scripts/comp/fileSearch.js
            if (typeof toggleSearchContainer === 'function') {
                if (typeof isSearchContainerOpen === 'function' && !isSearchContainerOpen()) {
                    toggleSearchContainer();
                } else if (typeof isSearchContainerOpen !== 'function') {
                    toggleSearchContainer();
                } else {
                    const searchInput = document.getElementById('fileSearchInput');
                    if (searchInput) searchInput.focus();
                }
            }
            handled = true;
            break;
        default:
            break;
    }

    if (handled) {
        e.preventDefault();
        e.stopPropagation();
        return true;
    }
}

function isGalleryBatchOverlayContextActive() {
    const galleryEl = document.getElementById('gallery');
    return !!(galleryEl && galleryEl.classList.contains('selection-mode'));
}

function wireGalleryKeyboardOverlayEntries() {
    if (document.body.dataset.galleryKeyboardOverlayWired === 'true') return;
    document.body.dataset.galleryKeyboardOverlayWired = 'true';
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerModalOverlayEntries('galleryWindow', 'Gallery', [
        { id: 'overlay.galleryWindow.f1', label: 'Main gallery', keys: 'F1', icon: 'mdi mdi-1-25 mdi-image-multiple' },
        { id: 'overlay.galleryWindow.f2', label: 'Favorites', keys: 'F2', icon: 'fa-solid fa-star' },
        { id: 'overlay.galleryWindow.f3', label: 'Upscaled', keys: 'F3', icon: 'fas fa-arrow-up-right-dots' },
        { id: 'overlay.galleryWindow.f4', label: 'Trash', keys: 'F4', icon: 'fas fa-bin-recycle' },
        { id: 'overlay.galleryWindow.f5', label: 'Jump to top', keys: 'F5', icon: 'fas fa-arrow-up' },
        { id: 'overlay.galleryWindow.f6', label: 'Sort flip', keys: 'F6', icon: 'fa-light fa-sort-amount-down' },
        { id: 'overlay.galleryWindow.f7', label: 'Visual index', keys: 'F7', icon: 'fas fa-list-ol' },
        { id: 'overlay.galleryWindow.f8', label: 'Open search', keys: 'F8', icon: 'fas fa-search' },
        { id: 'overlay.galleryWindow.scrollUp', label: 'Scroll up', keys: '↑', icon: 'fas fa-chevron-up' },
        { id: 'overlay.galleryWindow.scrollDown', label: 'Scroll down', keys: '↓', icon: 'fas fa-chevron-down' },
        { id: 'overlay.galleryWindow.home', label: 'First image', keys: 'Home', icon: 'fas fa-angles-up' },
        { id: 'overlay.galleryWindow.end', label: 'Last image', keys: 'End', icon: 'fas fa-angles-down' },
        { id: 'overlay.galleryWindow.batchEscape', label: 'Clear selection', keys: 'Esc ×2', icon: 'fas fa-xmark', overlayValid: () => isGalleryBatchOverlayContextActive() && getSelectedCount() > 0 },
        { id: 'overlay.galleryWindow.batchSelectAll', label: 'Select all', keys: 'Ctrl+A', icon: 'fas fa-check-double', overlayValid: isGalleryBatchOverlayContextActive },
        { id: 'overlay.galleryWindow.batchDelete', label: 'Delete selected', keys: 'Del', icon: 'fas fa-trash', overlayValid: () => isGalleryBatchOverlayContextActive() && getSelectedCount() > 0 },
        { id: 'overlay.galleryWindow.close', label: 'Close gallery', keys: 'Alt+Q', icon: 'fas fa-times' }
    ]);
    registerModalOverlayEntries('galleryJumpIndexTool', 'Gallery', [
        { id: 'overlay.galleryJumpIndexTool.enterJump', label: 'Jump to boundary', keys: 'Enter', icon: 'fas fa-location-arrow' },
        { id: 'overlay.galleryJumpIndexTool.close', label: 'Close visual index', keys: 'Esc', icon: 'fas fa-times' }
    ]);
}

function wireGalleryJumpIndexKeyboardListeners() {
    if (document.body.dataset.galleryJumpIndexKeyboardWired === 'true') return;
    document.body.dataset.galleryJumpIndexKeyboardWired = 'true';
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'galleryJumpIndexTool.escape',
        handler: onGalleryJumpIndexEscapeKeydown,
        type: 'whenFocused',
        modalId: 'galleryJumpIndexTool',
        priority: 80,
        critical: true,
        label: 'Close visual index',
        keys: 'Esc',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Gallery',
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'galleryJumpIndexTool.enterJump',
        handler: onGalleryJumpIndexEnterKeydown,
        type: 'whenFocused',
        modalId: 'galleryJumpIndexTool',
        priority: 75,
        label: 'Jump to boundary',
        keys: 'Enter',
        overlayIcon: 'fas fa-location-arrow',
        overlayGroup: 'Gallery',
        showInOverlay: false
    });
}

function wireGalleryModalListenerScope() {
    const galleryWindow = document.getElementById('galleryWindow');
    if (!galleryWindow || galleryWindow.dataset.galleryModalScopeWired === 'true') return;
    galleryWindow.dataset.galleryModalScopeWired = 'true';
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'galleryWindow.scrollNav',
        handler: onGalleryWindowKeydown,
        type: 'whenFocused',
        modalId: 'galleryWindow',
        priority: 57,
        critical: false,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'galleryWindow.batchSelectionKeydown',
        handler: onGalleryBatchSelectionKeydown,
        type: 'whenFocused',
        modalId: 'galleryWindow',
        priority: 55,
        critical: false,
        showInOverlay: false
    });
    registerKeyboardListener({
        id: 'galleryWindow.functionKeys',
        handler: onGalleryFunctionKeydown,
        type: 'whenFocused',
        modalId: 'galleryWindow',
        priority: 58,
        critical: false,
        showInOverlay: false
    });
    wireGalleryKeyboardOverlayEntries();
    wireGalleryJumpIndexKeyboardListeners();
}

function wireGalleryToolbarListeners() {
    const galleryToggleGroup = document.getElementById('galleryToggleGroup');
    if (!galleryToggleGroup || galleryToggleGroup.dataset.toolbarWired === 'true') return;
    galleryToggleGroup.dataset.toolbarWired = 'true';

    galleryToggleGroup.addEventListener('wheel', (e) => {
        e.preventDefault();
        if (window.innerWidth <= 577) {
            return false;
        }
        const direction = e.deltaY > 0 ? -1 : 1;
        adjustGalleryColumnSize(direction);
    }, { passive: false });

    const decreaseColumnsBtn = document.getElementById('decreaseColumnsBtn');
    const increaseColumnsBtn = document.getElementById('increaseColumnsBtn');

    if (decreaseColumnsBtn && decreaseColumnsBtn.dataset.wired !== 'true') {
        decreaseColumnsBtn.dataset.wired = 'true';
        decreaseColumnsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.innerWidth <= 577) {
                return false;
            }
            adjustGalleryColumnSize(-1);
        });
    }

    if (increaseColumnsBtn && increaseColumnsBtn.dataset.wired !== 'true') {
        increaseColumnsBtn.dataset.wired = 'true';
        increaseColumnsBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (window.innerWidth <= 577) {
                return false;
            }
            adjustGalleryColumnSize(1);
        });
    }

    const sortOrderToggleBtn = document.getElementById('sortOrderToggleBtn');
    if (sortOrderToggleBtn && sortOrderToggleBtn.dataset.wired !== 'true') {
        sortOrderToggleBtn.dataset.wired = 'true';
        sortOrderToggleBtn.addEventListener('click', (e) => {
            e.preventDefault();
            toggleGallerySortOrder();
        });
    }

    const galleryVisualIndexBtn = document.getElementById('galleryVisualIndexBtn');
    if (galleryVisualIndexBtn && galleryVisualIndexBtn.dataset.wired !== 'true') {
        galleryVisualIndexBtn.dataset.wired = 'true';
        galleryVisualIndexBtn.addEventListener('click', (e) => {
            e.preventDefault();
            openGalleryJumpIndexToolWindow();
        });
    }

    galleryToggleGroup.querySelectorAll('.gallery-toggle-btn').forEach(btn => {
        if (btn.dataset.wired === 'true') return;
        btn.dataset.wired = 'true';
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const view = e.currentTarget.getAttribute('data-view');
            switchGalleryView(view);
        });
    });
}

function wireGalleryKeyboardNav() {
    if (document.body.dataset.galleryKeyboardNavWired === 'true') return;
    document.body.dataset.galleryKeyboardNavWired = 'true';
    wireGalleryModalListenerScope();
}

function onGalleryWindowKeydown(e) {
    const handledKeys = new Set(['PageUp', 'PageDown', 'ArrowUp', 'ArrowDown', 'Home', 'End']);
    if (!handledKeys.has(e.key)) return;
    if (!isGalleryWindowKeyboardContext(e)) return;

    const galleryWindow = document.getElementById('galleryWindow');
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : (allImages ? allImages.length : 0);
    if (effectiveLength === 0) return;

    const runLegacyPageJump = (direction) => {
        const currentFirstVisibleIndex = getFirstVisibleRowIndex();
        const cols = realGalleryColumns || 5;
        const currentRow = Math.floor(currentFirstVisibleIndex / cols);
        const targetRow = direction > 0 ? (currentRow + 10) : Math.max(0, currentRow - 10);
        const targetIndex = Math.min(targetRow * cols, effectiveLength - 1);
        const finalTargetIndex = Math.max(0, targetIndex);
        displayGalleryFromStartIndex(finalTargetIndex, false);
    };

    if (e.key === 'PageUp' || e.key === 'PageDown') {
        e.preventDefault();
        e.stopPropagation();
        const direction = e.key === 'PageDown' ? 1 : -1;
        if (typeof jumpToNextGalleryTimeBoundary === 'function') {
            if (e.shiftKey) {
                jumpToNextGalleryTimeBoundary(direction, {
                    thresholdMs: 12 * 60 * 60 * 1000,
                    scanWindow: null
                });
            } else {
                jumpToNextGalleryTimeBoundary(direction);
            }
        }
        return true;
    }

    if (e.key === 'ArrowUp' || e.key === 'ArrowDown') {
        e.preventDefault();
        e.stopPropagation();
        const direction = e.key === 'ArrowDown' ? 1 : -1;
        if (e.shiftKey) {
            runLegacyPageJump(direction);
            if (refreshGalleryJumpIndexUI) {
                refreshGalleryJumpIndexUI();
            } else if (triggerGalleryVirtualScrollFromShortcut) {
                triggerGalleryVirtualScrollFromShortcut();
            }
            return true;
        }

        const galleryContainer = galleryWindow.querySelector('.gallery-container');
        const scrollStep = galleryContainer ? Math.max(64, Math.floor(galleryContainer.clientHeight * 0.82)) : Math.floor(window.innerHeight * 0.82);
        if (galleryContainer) {
            galleryContainer.scrollBy({ top: direction * scrollStep, behavior: 'smooth' });
        } else {
            window.scrollBy({ top: direction * scrollStep, behavior: 'smooth' });
        }
        return true;
    }

    if (e.key === 'Home' || e.key === 'End') {
        e.preventDefault();
        e.stopPropagation();
        const targetIndex = e.key === 'Home' ? 0 : Math.max(0, effectiveLength - 1);
        displayGalleryFromStartIndex(targetIndex, false);
        if (refreshGalleryJumpIndexUI) {
            refreshGalleryJumpIndexUI();
        } else if (triggerGalleryVirtualScrollFromShortcut) {
            triggerGalleryVirtualScrollFromShortcut();
        }
        return true;
    }
}

function wireMainMenuBarColumnWheel() {
    const mainMenuBar = document.getElementById('main-menu-bar');
    if (!mainMenuBar || mainMenuBar.dataset.columnWheelWired === 'true') return;
    if (typeof adjustGalleryColumnSize !== 'function') return;
    mainMenuBar.dataset.columnWheelWired = 'true';

    let lastWheelTime = 0;
    const wheelThrottle = 500;

    mainMenuBar.addEventListener('wheel', function (e) {
        if (Math.abs(e.deltaY) < Math.abs(e.deltaX)) return;

        const now = Date.now();
        if (now - lastWheelTime < wheelThrottle) {
            e.preventDefault();
            return;
        }

        e.preventDefault();
        lastWheelTime = now;

        const direction = e.deltaY > 0 ? -1 : 1;
        adjustGalleryColumnSize(direction);
    }, { passive: false });
}

// Gallery sort order functions
function toggleGallerySortOrder() {
    // Toggle between desc (newest first) and asc (oldest first)
    gallerySortOrder = gallerySortOrder === 'desc' ? 'asc' : 'desc';

    // Update the button state and icon
    const sortOrderBtn = document.getElementById('sortOrderToggleBtn');
    if (sortOrderBtn) {
        sortOrderBtn.dataset.state = gallerySortOrder;
        const icon = sortOrderBtn.querySelector('i');
        if (icon) {
            if (gallerySortOrder === 'desc') {
                icon.className = 'fa-light fa-sort-amount-down';
                sortOrderBtn.title = 'Sort Order: Newest First';
            } else {
                icon.className = 'fa-light fa-sort-amount-up';
                sortOrderBtn.title = 'Sort Order: Oldest First';
            }
        }
    }

    // Flip order in memory — list is already sorted, so reverse is enough
    flipActiveGallerySortOrder();

    resetInfiniteScroll();
    displayCurrentPageOptimized();
}

function compareGalleryItemsByMtime(a, b) {
    const timeA = a.mtime || 0;
    const timeB = b.mtime || 0;
    if (gallerySortOrder === 'desc') {
        return timeB - timeA;
    }
    return timeA - timeB;
}

function isNarrowGallerySearchActive() {
    return window.filteredImageIndices
        && window.filteredImageIndices.length > 0
        && window.filteredImageIndices.length < allImages.length;
}

function sortFilteredGalleryIndices() {
    if (!isNarrowGallerySearchActive()) return;
    window.filteredImageIndices.sort((idxA, idxB) => {
        const timeA = allImages[idxA]?.mtime || 0;
        const timeB = allImages[idxB]?.mtime || 0;
        return gallerySortOrder === 'desc' ? timeB - timeA : timeA - timeB;
    });
}

/** Toggle sort on the active in-memory list (reverse when fully sorted; resort search hits only in narrow filter). */
function flipActiveGallerySortOrder() {
    if (!allImages || allImages.length < 2) return;

    if (isNarrowGallerySearchActive()) {
        sortFilteredGalleryIndices();
        return;
    }

    allImages.reverse();
    if (window.originalAllImages && window.originalAllImages !== allImages) {
        window.originalAllImages.reverse();
    }
}

/** Apply current gallerySortOrder after a fresh load (full sort, not reverse). */
function sortGalleryData() {
    if (!allImages || allImages.length === 0) return;

    if (isNarrowGallerySearchActive()) {
        sortFilteredGalleryIndices();
        return;
    }

    allImages.sort(compareGalleryItemsByMtime);
    if (window.originalAllImages && window.originalAllImages !== allImages) {
        window.originalAllImages.sort(compareGalleryItemsByMtime);
    }
}

window.sortGalleryData = sortGalleryData;
window.toggleGallerySortOrder = toggleGallerySortOrder;
window.galleryMetadataCache = galleryMetadataCache;

// Handle workspace image additions via WebSocket
document.addEventListener('workspaceImageAdded', async (event) => {
    const { workspaceId, imageFilenames } = event.detail;

    // galleryRerollOwnsGalleryDom: public/scripts/comp/galleryView.js
    if (galleryRerollOwnsGalleryDom()) {
        return;
    }

    // Check if the gallery is visible and if we're viewing the images gallery
    if (!gallery || gallery.classList.contains('hidden') || currentGalleryView !== 'images') {
        return;
    }

    // Selection mode: do not mutate the grid under the user — offer an explicit refresh
    if (isSelectionMode) {
        const count = Array.isArray(imageFilenames) ? imageFilenames.length : 1;
        const imageText = count === 1 ? 'image' : 'images';

        if (galleryRefreshNotificationId) {
            removeGlassToast(galleryRefreshNotificationId);
        }

        galleryRefreshNotificationId = showGlassToast(
            'info',
            'New Images Available',
            `${count} new ${imageText} added to workspace`,
            false,
            0,
            '<i class="fas fa-images"></i>',
            [
                {
                    text: 'Refresh Gallery',
                    className: 'btn-primary',
                    callback: async () => {
                        const anchor = captureGalleryViewportAnchor();
                        if (galleryRefreshNotificationId) {
                            removeGlassToast(galleryRefreshNotificationId);
                            galleryRefreshNotificationId = null;
                        }
                        await switchGalleryView(currentGalleryView, true);
                        if (anchor) {
                            const target = resolveGalleryViewportAnchorIndex(anchor);
                            await displayGalleryFromStartIndex(target, false);
                        }
                    }
                },
                {
                    text: 'Dismiss',
                    className: 'btn-secondary',
                    callback: () => {
                        if (galleryRefreshNotificationId) {
                            removeGlassToast(galleryRefreshNotificationId);
                            galleryRefreshNotificationId = null;
                        }
                    }
                }
            ]
        );
        return;
    }

    // Prefer gallery_updated append_top; only fetch when exact files are not on any row yet
    // (activeGalleryHasExactFile: public/scripts/comp/galleryView.js)
    const filenames = Array.isArray(imageFilenames) ? imageFilenames : [];
    if (filenames.length > 0 && filenames.every((fn) => activeGalleryHasExactFile(fn))) {
        return;
    }

    // Fallback when append_top has not landed yet — loadGallery(true) upserts if it races later
    await loadGallery(true);
});

// Display gallery starting from a specific index
function displayGalleryFromStartIndex(startIndex, highlightTargetItem = false) {
    return new Promise((resolve) => {
        let settled = false;
        const finish = () => {
            if (settled) return;
            settled = true;
            resolve();
        };

        if (!gallery) {
            isJumpingToPosition = false;
            isGalleryResetting = false;
            finish();
            return;
        }

        // Don't update gallery if gallery is hidden in desktop mode
        if (isGalleryWindowHidden()) {
            isJumpingToPosition = false;
            isGalleryResetting = false;
            finish();
            return;
        }

        // Get effective length and validate index
        const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
        if (startIndex < 0 || startIndex >= effectiveLength) {
            console.warn(`Invalid index ${startIndex}, using 0 instead`);
            startIndex = 0;
        }

        // Detect scroll container (gallery-container is always used when available)
        const galleryWindow = document.querySelector('#galleryWindow');
        const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
        const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');

        // Set flags to disable virtual scroll and hide gallery during jump operation
        isJumpingToPosition = true;
        suppressGalleryPositionHintUntilInteraction = true;
        isGalleryResetting = true;
        // Reset momentum state so previous scroll bursts cannot distort first jump placement.
        scrollVelocity = 0;
        isScrolling = false;
        isFastScrolling = false;
        pendingPlaceholderResolution = false;
        if (fastScrollTimeout) {
            clearTimeout(fastScrollTimeout);
            fastScrollTimeout = null;
        }

        // Clear any pending placeholder additions to prevent them from executing during/after jump
        if (deferredPlaceholderTimeout) {
            clearTimeout(deferredPlaceholderTimeout);
            deferredPlaceholderTimeout = null;
        }
        pendingPlaceholderAdditions.above = false;
        pendingPlaceholderAdditions.below = false;

        // Hide gallery with visibility hidden (maintains layout) and opacity 0 for fade-in
        gallery.style.visibility = 'hidden';
        gallery.style.opacity = '0';

        // Clear gallery
        clearGallery();

        // Reset scroll to top (use container if in windowed mode, otherwise use window)
        if (isContainerScroll && galleryContainer) {
            galleryContainer.scrollTop = 0;
        } else {
            window.scrollTo({ top: 0, behavior: 'instant' });
        }

        // If no images, show empty state
        if (allImages.length === 0) {
            gallery.style.visibility = '';
            gallery.style.opacity = '';
            isJumpingToPosition = false;
            isGalleryResetting = false;
            finish();
            return;
        }

        // Refresh column count on empty gallery, then snap jump index to row start (grid row alignment).
        updateGalleryGrid(true, true);
        const colsForSnap = realGalleryColumns || 5;
        startIndex = snapGalleryFilteredIndexToRowStart(startIndex, colsForSnap, effectiveLength);

        // Get item height for scroll calculations
        const itemHeight = itemSizePx;
        const cols = realGalleryColumns || 5;
        const targetRow = Math.floor(startIndex / cols);

        // Calculate which row to start displaying from
        // Include the row before as actual gallery items (not placeholders) to show half of it when scrolling
        let displayStartRow = targetRow;
        if (targetRow > 0) {
            displayStartRow = targetRow - 1; // Include row before as actual items
        }
        const displayStartIndex = displayStartRow * cols;

        // Calculate how many items to display
        const buffer = Math.ceil(cols * 0.15);
        const totalItemsToDisplay = (cols + buffer) * cols;
        const displayEndIndex = Math.min(displayStartIndex + totalItemsToDisplay, effectiveLength);

        // IMPORTANT: Add placeholders ABOVE first, before adding target items
        // This ensures target items are positioned correctly from the start

        // Add placeholders above in complete rows only
        // Use unified buffer size calculation
        // Jump rendering must ignore transient scroll velocity spikes from previous interactions.
        const adjustedBufferSize = calculatePlaceholderBufferSize(0, undefined, true);

        // Calculate how many placeholders to add above (in complete rows)
        const placeholdersAboveCount = Math.min(adjustedBufferSize, displayStartIndex);
        const placeholdersAboveStart = Math.max(0, displayStartIndex - placeholdersAboveCount);

        // Add placeholders above in complete row batches (ensures gallery alignment)
        if (placeholdersAboveCount > 0) {
            const fragmentAbove = document.createDocumentFragment();
            // Calculate start row for placeholders
            const startRowForPlaceholders = Math.floor(placeholdersAboveStart / realGalleryColumns);
            const endRowForPlaceholders = Math.floor((displayStartIndex - 1) / realGalleryColumns);

            // Add placeholders row by row to ensure complete rows
            for (let row = startRowForPlaceholders; row <= endRowForPlaceholders; row++) {
                const rowStartIndex = row * realGalleryColumns;
                const rowEndIndex = Math.min((row + 1) * realGalleryColumns, displayStartIndex);

                for (let i = rowStartIndex; i < rowEndIndex; i++) {
                    const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined
                        ? window.filteredImageIndices[i]
                        : i;
                    const image = allImages[fileIndex];
                    if (image) {
                        const item = getOrCreateGalleryItem(image, i, true); // Skip img element for placeholders
                        item.classList.add('gallery-placeholder');
                        fragmentAbove.appendChild(item);
                    }
                }
            }
            gallery.appendChild(fragmentAbove);
        }

        // Now add the actual gallery items (includes row before + target row + visible range)
        // This ensures the row before is resolved (not left as placeholders)
        const fragment = document.createDocumentFragment();
        for (let i = displayStartIndex; i < displayEndIndex; i++) {
            // i is filtered position, get file index from filteredImageIndices to access allImages
            const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined
                ? window.filteredImageIndices[i]
                : i;
            const image = allImages[fileIndex];
            if (image) {
                const galleryItem = createGalleryItem(image, i); // i is filtered position for data-index
                // Only add fade-in to items at or after startIndex (target row)
                if (i >= startIndex) {
                    galleryItem.classList.add('fade-in');
                }
                // Mark items in the visible range (including row before) so they don't get converted to placeholders
                // This prevents flickering when virtual scroll re-enables
                galleryItem.dataset.jumpCreated = 'true';
                fragment.appendChild(galleryItem);
            }
        }
        gallery.appendChild(fragment);

        // Fade in items one by one
        const items = gallery.querySelectorAll('.gallery-item.fade-in');
        items.forEach((el, idx) => {
            setTimeout(() => {
                el.classList.add('fade-in');
                el.addEventListener('animationend', function handler() {
                    el.classList.remove('fade-in');
                    el.removeEventListener('animationend', handler);
                });
            }, idx * 60);
        });

        // Initialize intersection observer
        initIntersectionObserver();

        // Observe all gallery items and placeholders for intersection changes
        if (intersectionObserver) {
            const allItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
            allItems.forEach(item => {
                intersectionObserver.observe(item);
            });
        }

        // Update displayed indices (use actual display range, not just target range)
        displayedStartIndex = displayStartIndex;
        displayedEndIndex = displayEndIndex;
        isLoadingMore = false;
        hasMoreImages = displayedEndIndex < effectiveLength;
        hasMoreImagesBefore = displayedStartIndex > 0;

        // Send gallery position hint for prefetching (throttled)
        sendGalleryPositionHint();

        // Now add placeholders below in complete rows (manually, since addPlaceholdersBelow() returns early during jump)
        // Calculate how many placeholders to add below
        const placeholdersBelowCount = Math.min(adjustedBufferSize, effectiveLength - displayEndIndex);
        const placeholdersBelowEnd = Math.min(displayEndIndex + placeholdersBelowCount, effectiveLength);

        // Add placeholders below in complete row batches (ensures gallery alignment)
        if (placeholdersBelowCount > 0) {
            const fragmentBelow = document.createDocumentFragment();
            // Calculate start/end rows for placeholders
            const startRowForPlaceholders = Math.floor(displayEndIndex / realGalleryColumns);
            const endRowForPlaceholders = Math.floor((placeholdersBelowEnd - 1) / realGalleryColumns);

            // Add placeholders row by row to ensure complete rows
            for (let row = startRowForPlaceholders; row <= endRowForPlaceholders; row++) {
                const rowStartIndex = Math.max(displayEndIndex, row * realGalleryColumns);
                const rowEndIndex = Math.min((row + 1) * realGalleryColumns, placeholdersBelowEnd);

                for (let i = rowStartIndex; i < rowEndIndex; i++) {
                    const fileIndex = window.filteredImageIndices && window.filteredImageIndices[i] !== undefined
                        ? window.filteredImageIndices[i]
                        : i;
                    const image = allImages[fileIndex];
                    if (image) {
                        const item = getOrCreateGalleryItem(image, i, true); // Skip img element for placeholders
                        item.classList.add('gallery-placeholder');
                        fragmentBelow.appendChild(item);
                    }
                }
            }
            gallery.appendChild(fragmentBelow);
        }

        // Clear resetting flag but keep jumping flag active
        isGalleryResetting = false;

        // Scroll to target item position while gallery is still hidden
        // Use requestAnimationFrame to ensure layout is calculated
        let lockedTargetScrollTop = null;
        requestAnimationFrame(() => {
            // Wait for layout recalculation
            requestAnimationFrame(() => {
                // Find target item and calculate scroll position based on its actual DOM position
                const targetItem = gallery.querySelector(`[data-index="${startIndex}"]`);

                if (targetItem) {
                    // Calculate scroll offset: if past first row, show half of the row before
                    let scrollOffset = 0;
                    if (targetRow > 0) {
                        scrollOffset = itemHeight / 2;
                    }

                    if (isContainerScroll && galleryContainer) {
                        // Scroll inside the gallery container — use same content-Y basis as getFirstVisibleRowIndex
                        // (item vs gallery rect omits gallery offset inside the container and skews by ~1 row).
                        const containerRect = galleryContainer.getBoundingClientRect();
                        const itemRect = targetItem.getBoundingClientRect();
                        const targetScrollTop = Math.max(0, galleryContainer.scrollTop + (itemRect.top - containerRect.top) - scrollOffset);
                        lockedTargetScrollTop = targetScrollTop;
                        galleryContainer.scrollTop = lockedTargetScrollTop;
                    } else {
                        // Scroll the window (normal/maximized mode)
                        const targetScrollTop = targetItem.offsetTop - scrollOffset;
                        lockedTargetScrollTop = Math.max(0, targetScrollTop);
                        window.scrollTo({ top: lockedTargetScrollTop, behavior: 'instant' });
                    }

                    // Verify position after layout settles
                    requestAnimationFrame(() => {
                        requestAnimationFrame(() => {
                            const targetItem = gallery.querySelector(`[data-index="${startIndex}"]`);

                            if (targetItem) {
                                // Verify scroll position using getBoundingClientRect now that layout is settled
                                let scrollOffset = 0;
                                if (targetRow > 0) {
                                    scrollOffset = itemHeight / 2;
                                }

                                let needsAdjustment = false;
                                if (isContainerScroll && galleryContainer) {
                                    const containerRect = galleryContainer.getBoundingClientRect();
                                    const itemRect = targetItem.getBoundingClientRect();
                                    const targetScrollTop = Math.max(0, galleryContainer.scrollTop + (itemRect.top - containerRect.top) - scrollOffset);
                                    const currentScrollTop = galleryContainer.scrollTop;

                                    if (Math.abs(currentScrollTop - targetScrollTop) > 10) {
                                        galleryContainer.scrollTop = Math.max(0, targetScrollTop);
                                        needsAdjustment = true;
                                    }
                                    lockedTargetScrollTop = Math.max(0, targetScrollTop);
                                } else {
                                    // Use offsetTop for more reliable positioning
                                    const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
                                    const targetScrollTop = targetItem.offsetTop - scrollOffset;

                                    if (Math.abs(currentScrollTop - targetScrollTop) > 10) {
                                        window.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'instant' });
                                        needsAdjustment = true;
                                    }
                                    lockedTargetScrollTop = Math.max(0, targetScrollTop);
                                }

                                // Wait for target item's image to resolve before fading in
                                const waitForTargetImage = () => {
                                    return new Promise((resolve) => {
                                        const targetItemImg = targetItem.querySelector('img');

                                        if (!targetItemImg) {
                                            // No image element, resolve immediately
                                            resolve();
                                            return;
                                        }

                                        // Check if image is already loaded
                                        if (targetItemImg.complete && targetItemImg.naturalWidth > 0) {
                                            // Image already loaded, resolve immediately
                                            resolve();
                                            return;
                                        }

                                        // Wait for image to load
                                        const onLoad = () => {
                                            targetItemImg.removeEventListener('load', onLoad);
                                            targetItemImg.removeEventListener('error', onError);
                                            resolve();
                                        };

                                        const onError = () => {
                                            // Even if image fails to load, proceed with fade-in
                                            targetItemImg.removeEventListener('load', onLoad);
                                            targetItemImg.removeEventListener('error', onError);
                                            resolve();
                                        };

                                        targetItemImg.addEventListener('load', onLoad);
                                        targetItemImg.addEventListener('error', onError);

                                        // Timeout after 2 seconds to prevent indefinite waiting
                                        setTimeout(() => {
                                            targetItemImg.removeEventListener('load', onLoad);
                                            targetItemImg.removeEventListener('error', onError);
                                            resolve();
                                        }, 5000);
                                    });
                                };

                                // Wait for target image to resolve, then fade in
                                waitForTargetImage().then(() => {
                                    if (lockedTargetScrollTop !== null) {
                                        if (isContainerScroll && galleryContainer) {
                                            galleryContainer.scrollTop = lockedTargetScrollTop;
                                        } else {
                                            window.scrollTo({ top: lockedTargetScrollTop, behavior: 'instant' });
                                        }
                                    }
                                    // Now that target item is resolved, fade in the gallery
                                    gallery.style.visibility = '';
                                    gallery.style.opacity = '';
                                    requestAnimationFrame(() => {
                                        if (highlightTargetItem && targetItem) {
                                            gallery.classList.add('highlighting');
                                            targetItem.classList.add('highlighted');

                                            // Remove highlight effect after 2.5 seconds
                                            setTimeout(() => {
                                                targetItem.classList.remove('highlighted');
                                                gallery.classList.remove('highlighting');
                                            }, 2500);
                                        }
                                    });
                                });

                                // Re-enable virtual scroll only after explicit user input.
                                // Scroll events can be triggered programmatically during restore and must not lift suppression.
                                const reenableVirtualScroll = (event) => {
                                    suppressGalleryPositionHintUntilInteraction = false;

                                    // Delay virtual scroll update to prevent immediate placeholder additions
                                    // This prevents flickering from multiple placeholder additions
                                    setTimeout(() => {
                                        updateVirtualScroll();
                                    }, 200);

                                    // Remove event listeners after first interaction
                                    if (isContainerScroll && galleryContainer) {
                                        galleryContainer.removeEventListener('wheel', reenableVirtualScroll);
                                        galleryContainer.removeEventListener('touchstart', reenableVirtualScroll);
                                        galleryContainer.removeEventListener('pointerdown', reenableVirtualScroll);
                                    } else {
                                        window.removeEventListener('wheel', reenableVirtualScroll);
                                        window.removeEventListener('touchstart', reenableVirtualScroll);
                                        window.removeEventListener('pointerdown', reenableVirtualScroll);
                                    }
                                    gallery.removeEventListener('click', reenableVirtualScroll);
                                };

                                // Wait a short delay before enabling interaction listeners
                                // This prevents immediate re-enabling from the scroll we just did
                                setTimeout(() => {
                                    requestAnimationFrame(() => {
                                        isJumpingToPosition = false;
                                        resolveVisiblePlaceholders();
                                        finish();
                                    });
                                    if (isContainerScroll && galleryContainer) {
                                        galleryContainer.addEventListener('wheel', reenableVirtualScroll, { once: true, passive: true });
                                        galleryContainer.addEventListener('touchstart', reenableVirtualScroll, { once: true, passive: true });
                                        galleryContainer.addEventListener('pointerdown', reenableVirtualScroll, { once: true });
                                    } else {
                                        window.addEventListener('wheel', reenableVirtualScroll, { once: true, passive: true });
                                        window.addEventListener('touchstart', reenableVirtualScroll, { once: true, passive: true });
                                        window.addEventListener('pointerdown', reenableVirtualScroll, { once: true });
                                    }
                                    gallery.addEventListener('click', reenableVirtualScroll, { once: true });
                                }, 100);
                            } else {
                                // Target item not found, re-enable virtual scroll anyway
                                isJumpingToPosition = false;
                                suppressGalleryPositionHintUntilInteraction = false;
                                finish();
                            }
                        });
                    });
                } else {
                    // Target item not found in first RAF, re-enable virtual scroll anyway
                    isJumpingToPosition = false;
                    suppressGalleryPositionHintUntilInteraction = false;
                    finish();
                }
            });
        });
    });
}

// Function to trigger gallery move modal with selected images
function triggerGalleryMoveWithSelection() {
    if (getSelectedCount() === 0) {
        showError('No images selected for move');
        return;
    }

    // Set the selected images in the gallery toolbar module
    if (window.galleryMoveSelectedImages) {
        window.galleryMoveSelectedImages.clear();
        getSelectedFilenames().forEach(filename => {
            window.galleryMoveSelectedImages.add(filename);
        });
    }

    // Show the gallery move modal with null filename to indicate multi-select mode
    showGalleryMoveModal(null);
}

const EXPLORE_PUBLISH_TITLE_MIN = 3;
const EXPLORE_PUBLISH_TITLE_MAX = 40;
const EXPLORE_PUBLISH_REGISTER_URL = 'https://novelai.net/explore/register';
const EXPLORE_PUBLISH_GUIDELINES = [
    'All posts currently undergo manual review and may be approved or rejected at our discretion.',
    'No NSFW.',
    'No Copyright/Character/Artist tags or content.',
    'No advertising or self-promotional content permitted.',
    'Character Reference, Image-to-Image, and Inpainting are not allowed.',
    'Vibe Transfer is allowed, but may be rejected upon review.'
];

function getExplorePublishFilename(image) {
    if (!image) return null;
    return image.upscaled || image.original || image.filename || null;
}

function getExplorePublishPreviewUrl(image) {
    if (!image) return '';
    if (image.preview) {
        // getGalleryPreviewUrl — this file
        const previewName = getGalleryPreviewUrl(image.preview) || image.preview;
        if (previewName) return `/previews/${encodeURIComponent(previewName)}`;
    }
    const filename = getExplorePublishFilename(image);
    // localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
    return localGalleryImageUrl(filename);
}

function escapeExplorePublishHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;');
}

function buildExplorePublishDialogHtml(image) {
    const previewUrl = getExplorePublishPreviewUrl(image);
    const guidelines = EXPLORE_PUBLISH_GUIDELINES
        .map((line) => `<li>${escapeExplorePublishHtml(line)}</li>`)
        .join('');
    return `
<div class="explore-publish-dialog">
  <div class="explore-publish-preview">
    <img src="${escapeExplorePublishHtml(previewUrl)}" alt="Image preview">
  </div>
  <p class="explore-publish-hint">Only raw images generated by NovelAI can be accepted.</p>
  <div class="form-group">
    <label for="explorePublishTitle">Post Title</label>
    <input type="text" id="explorePublishTitle" class="hover-show" maxlength="${EXPLORE_PUBLISH_TITLE_MAX}"
      placeholder="Give your image a creative title" autocomplete="off">
    <div class="explore-publish-title-count is-warning" id="explorePublishTitleCount">0/${EXPLORE_PUBLISH_TITLE_MAX}</div>
  </div>
  <div class="explore-publish-guidelines">
    <div class="explore-publish-guidelines-title">Upload Guidelines</div>
    <ul>${guidelines}</ul>
  </div>
  <div id="explorePublishRestriction" class="explore-publish-restriction hidden" role="alert"></div>
</div>`;
}

function wireExplorePublishDialog(dialog, options = {}) {
    const filename = options.filename;
    const titleInput = dialog.querySelector('#explorePublishTitle');
    const countEl = dialog.querySelector('#explorePublishTitleCount');
    const restrictionEl = dialog.querySelector('#explorePublishRestriction');
    const uploadBtn = dialog.querySelector('[data-dialog-primary="1"]');
    if (!titleInput || !uploadBtn) return;

    let restriction = options.restriction || null;
    let checkFailed = !!options.checkFailed;
    let checkPending = !!filename && !!wsClient;

    const syncUploadEnabled = () => {
        const title = titleInput.value.trim();
        const titleOk = title.length >= EXPLORE_PUBLISH_TITLE_MIN
            && title.length <= EXPLORE_PUBLISH_TITLE_MAX;
        if (countEl) {
            countEl.textContent = `${titleInput.value.length}/${EXPLORE_PUBLISH_TITLE_MAX}`;
            countEl.classList.toggle('is-warning', title.length < EXPLORE_PUBLISH_TITLE_MIN);
        }
        uploadBtn.disabled = checkPending || checkFailed || !!restriction || !titleOk;
    };

    const setRestriction = (next) => {
        restriction = next || null;
        if (!restrictionEl) return;
        if (restriction?.message) {
            restrictionEl.textContent = restriction.message;
            restrictionEl.classList.remove('hidden');
        } else {
            restrictionEl.textContent = '';
            restrictionEl.classList.add('hidden');
        }
        syncUploadEnabled();
    };

    titleInput.addEventListener('input', syncUploadEnabled);
    setRestriction(restriction);
    syncUploadEnabled();
    setTimeout(() => titleInput.focus(), 0);

    if (!filename || !wsClient) return;

    // Preflight: modules/ws/handlers/105-exploreHandler.js check_novelai_explore_upload
    wsClient.sendMessage('check_novelai_explore_upload', { filename }, false)
        .then((data) => {
            checkPending = false;
            if (data?.code === 'EXPLORE_UPLOADS_DISABLED') {
                checkFailed = true;
                setRestriction({
                    message: 'Explore uploads are disabled on this server (config novelaiExplore.uploadsEnabled).'
                });
                return;
            }
            if (data?.code === 'EXPLORE_NOT_REGISTERED' || (data?.error && /not registered/i.test(data.error))) {
                checkFailed = true;
                setRestriction({
                    message: 'Register on NovelAI Explore before publishing. Open Agora → Register, then try again.'
                });
                return;
            }
            if (data?.success === false || data?.code === 'EXPLORE_BANNED' || data?.error) {
                checkFailed = true;
                setRestriction({ message: data.error || 'Unable to verify Explore upload eligibility.' });
                return;
            }
            if (data?.restriction) {
                setRestriction(data.restriction);
            } else {
                setRestriction(null);
            }
        })
        .catch((err) => {
            checkPending = false;
            checkFailed = true;
            setRestriction({
                message: (err && err.message) || String(err) || 'Unable to verify Explore upload eligibility.'
            });
        });
}

async function openPublishToExplorerDialog(image) {
    const filename = getExplorePublishFilename(image);
    if (!filename) {
        showGlassToast('error', 'Explorer', 'No image file to publish', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }
    if (!wsClient) {
        showGlassToast('error', 'Explorer', 'Not connected to server', false, 4000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // showConfirmationDialog — public/scripts/comp/confirmationDialog.js
    const confirmed = await showConfirmationDialog(
        buildExplorePublishDialogHtml(image),
        [
            { text: 'Upload Image', value: true, icon: 'fas fa-globe', className: 'btn-standard primary' },
            { text: 'Cancel', value: false, className: 'btn-standard' }
        ],
        null,
        {
            title: 'Publish to Explorer',
            icon: 'fas fa-globe',
            width: 440,
            onDialogReady: (signal) => {
                const dialog = document.getElementById('confirmationDialog');
                if (!dialog) return;
                dialog.classList.add('explore-publish-dialog-modal');
                const clearClass = () => dialog.classList.remove('explore-publish-dialog-modal');
                if (signal) signal.addEventListener('abort', clearClass, { once: true });
                wireExplorePublishDialog(dialog, { filename });
            },
            resolveValue: (value, dialog) => {
                dialog?.classList.remove('explore-publish-dialog-modal');
                if (!value) return false;
                const title = dialog?.querySelector('#explorePublishTitle')?.value?.trim() || '';
                if (title.length < EXPLORE_PUBLISH_TITLE_MIN || title.length > EXPLORE_PUBLISH_TITLE_MAX) {
                    showGlassToast(
                        'info',
                        'Explorer',
                        `Title must be between ${EXPLORE_PUBLISH_TITLE_MIN} and ${EXPLORE_PUBLISH_TITLE_MAX} characters long.`,
                        false,
                        4000
                    );
                    return false;
                }
                return { title, filename };
            }
        }
    );

    if (!confirmed || confirmed === false) return;

    const toastId = showGlassToast(
        'info',
        'Explorer',
        'Uploading to NovelAI Explore…',
        true,
        false,
        '<i class="fas fa-globe"></i>'
    );
    try {
        const data = await wsClient.sendMessage('upload_novelai_explore_image', {
            filename: confirmed.filename,
            title: confirmed.title
        }, false);

        if (data?.code === 'EXPLORE_UPLOADS_DISABLED') {
            // updateGlassToast — public/scripts/comp/toastManager.js
            updateGlassToast(
                toastId,
                'warning',
                'Explorer',
                'Explore uploads are disabled on this server',
                '<i class="fas fa-ban"></i>'
            );
            return;
        }
        if (data?.code === 'EXPLORE_NOT_REGISTERED') {
            updateGlassToast(toastId, 'warning', 'Explorer', 'Register on NovelAI Explore first', '<i class="fas fa-user-plus"></i>');
            updateGlassToastButtons(toastId, [
                {
                    text: 'Register',
                    onClick: () => {
                        open(data.registerUrl || EXPLORE_PUBLISH_REGISTER_URL, '_blank', 'noopener');
                    }
                }
            ]);
            return;
        }
        if (data?.success === false || data?.error || data?.code) {
            updateGlassToast(
                toastId,
                'error',
                'Explorer',
                data.error || data.restriction?.message || 'Upload failed',
                '<i class="fas fa-exclamation-triangle"></i>'
            );
            return;
        }

        const exploreUrl = data?.exploreUrl || (data?.id ? `https://novelai.net/explore/image/${data.id}` : null);
        updateGlassToast(
            toastId,
            'success',
            'Explorer',
            data?.title ? `Uploaded “${data.title}” — pending review` : 'Uploaded — pending review',
            '<i class="fas fa-globe"></i>'
        );
        if (exploreUrl) {
            updateGlassToastButtons(toastId, [
                {
                    text: 'Open',
                    onClick: () => {
                        open(exploreUrl, '_blank', 'noopener');
                    }
                }
            ]);
        }
    } catch (err) {
        updateGlassToast(
            toastId,
            'error',
            'Explorer',
            (err && err.message) || String(err) || 'Upload failed',
            '<i class="fas fa-exclamation-triangle"></i>'
        );
    }
}

// Context menu action handlers for gallery items
function handleGalleryContextMenuAction(event) {
    const { action, target, item } = event.detail;
    const galleryItem = target.closest('.gallery-item');

    if (!galleryItem) return;

    // Get data from element at click time (not cached)
    const filename = galleryItem.dataset.filename;

    // Get image using findImageByFilename to ensure we get the correct image
    let image = findImageByFilename(filename);

    if (!image) {
        // Fallback: try to get from fileIndex if findImageByFilename not available
        const fileIndex = parseInt(galleryItem.dataset.fileIndex, 10);
        if (!isNaN(fileIndex) && fileIndex >= 0 && fileIndex < allImages.length) {
            image = allImages[fileIndex];
        }
    }

    if (!image) return;

    switch (action) {
        case 'toggle-checkbox':
            // Toggle the checkbox for this gallery item
            const checkboxCheckbox = galleryItem.querySelector('.gallery-item-checkbox');
            if (checkboxCheckbox) {
                checkboxCheckbox.checked = !checkboxCheckbox.checked;
                handleImageSelection(image, checkboxCheckbox.checked, { target: checkboxCheckbox, altKey: false });
            }
            break;

        case 'select-all-before-item': {
            const beforeIdx = findImageArrayIndex(filename);
            if (beforeIdx !== -1) bulkSelectFilteredIndexRange(0, beforeIdx);
            break;
        }

        case 'toggle-favorite':
            // Toggle pin status directly
            togglePinImage(image, null);
            // Update the image's pin status for future context menu loads
            image.isPinned = !image.isPinned;
            break;

        case 'download':
            downloadImage(image);
            break;

        case 'copy':
            // Copy image to clipboard directly
            copyImageToClipboard(image);
            break;

        case 'open-in-window':
            // Open image in a new image viewer window with full image data
            const viewer = openGalleryImageInViewer(image);
            if (viewer && viewer.element) {
                // Store the full image data in the modal's dataset for future features
                viewer.element.dataset.imageData = JSON.stringify(image);
            }
            break;

        case 'move':
            // Select the image and show move modal
            selectedImages.clear();
            selectedImages.add(filename);
            galleryItem.dataset.selected = 'true';
            galleryItem.classList.add('selected');
            const checkbox = galleryItem.querySelector('.gallery-item-checkbox');
            if (checkbox) checkbox.checked = true;
            updateBulkActionsBar();
            showGalleryMoveModal(filename);
            break;

        case 'scrap':
            // Move image to scraps directly
            moveImageToScraps(image);
            break;

        case 'start-chat':
            // Open chat modal for this image
            (async () => {
                try {
                    if (window.featureLoader) {
                        await window.featureLoader.loadFeature('chat');
                    }
                    if (window.chatSystem) {
                        window.chatSystem.openChatModal(filename, image.characterName || null);
                    }
                } catch (err) {
                    console.error('Failed to load chat system:', err);
                }
            })();
            break;

        case 'publish-to-explorer':
            // openPublishToExplorerDialog — this file
            openPublishToExplorerDialog(image);
            break;

        case 'delete':
            // Delete image directly
            deleteImage(image);
            break;

        case 'set-wallpaper':
            // Open desktop settings modal with this image
            openDesktopSettingsModal(`file:${filename}`);
            break;

        case 'reroll':
            rerollImage(image, event);
            break;

        case 'modify':
            openManualModalWithContent({
                type: 'image',
                image: image,
                metadata: image.metadata || null
            }, event);
            break;

        case 'upscale':
            if (!image.upscaled) {
                upscaleImage(image, event);
            }
            break;

        case 'view-image-data':
            // public/scripts/comp/featureLoader.js
            void featureLoader.loadFeature('image_prompt_inspector').then(() => openImagePromptInspector(image));
            break;

        case 'expand-canvas':
            // Open expansion modal for this image
            expandCanvasFromGallery(image);
            break;

        case 'create-reference':
            // Create reference from image
            createReferenceFromImage(image);
            break;

        case 'create-encoding':
            // Create vibe encoding from image
            createVibeEncodingFromImage(image);
            break;

        case 'create-desktop-shortcut':
            // Create desktop shortcut for this image
            createDesktopShortcutFromImage(image);
            break;

        case 'jump-to-image':
            // Switch back to images view, exit search mode, and jump to this image
            (async () => {
                // Set jumping flag early to prevent rendering during view switch and search clear
                isJumpingToPosition = true;
                isGalleryResetting = true;

                const resetJumpFlagsAndGalleryOpacity = () => {
                    isJumpingToPosition = false;
                    isGalleryResetting = false;
                    if (gallery) {
                        gallery.style.visibility = '';
                        gallery.style.opacity = '';
                    }
                };

                try {
                    // Get the filename from the gallery item (more reliable than stored index)
                    const filename = galleryItem.dataset.filename;
                    if (!filename) {
                        console.error('Could not determine filename for jump-to-image');
                        resetJumpFlagsAndGalleryOpacity();
                        return;
                    }

                    // Hide gallery early like displayGalleryFromStartIndex does
                    if (gallery) {
                        gallery.style.opacity = '0';
                    }

                    // Switch to images view if not already there
                    if (currentGalleryView !== 'images') {
                        await switchGalleryView('images');
                    }

                    // Find the true index of this image in the loaded allImages array
                    const trueIndex = allImages.findIndex(img => img.filename === filename || img.original === filename || img.upscaled === filename);
                    if (trueIndex === -1) {
                        console.error('Could not find image in loaded gallery data:', filename);
                        showGlassToast('error', 'Jump Failed', 'Image not found in gallery', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                        resetJumpFlagsAndGalleryOpacity();
                        return;
                    }

                    // displayGalleryFromStartIndex expects filtered list position when a narrow filter is active
                    let displayIndex = trueIndex;
                    if (window.filteredImageIndices && Array.isArray(window.filteredImageIndices)) {
                        const filteredPos = window.filteredImageIndices.indexOf(trueIndex);
                        if (filteredPos !== -1) {
                            displayIndex = filteredPos;
                        }
                    }

                    // Jump to the image at the resolved index with highlight (owns isJumpingToPosition / visibility lifecycle)
                    await displayGalleryFromStartIndex(displayIndex, true);

                    // Verify jump visibility once; if the target is still off-screen, perform one automatic retry.
                    const isTargetVisible = () => {
                        const target = gallery ? gallery.querySelector(`[data-index="${displayIndex}"]`) : null;
                        if (!target) return false;
                        const rect = target.getBoundingClientRect();
                        const galleryWindow = document.querySelector('#galleryWindow');
                        const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
                        const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');
                        if (isContainerScroll && galleryContainer) {
                            const cRect = galleryContainer.getBoundingClientRect();
                            return rect.bottom > cRect.top && rect.top < cRect.bottom;
                        }
                        return rect.bottom > 0 && rect.top < window.innerHeight;
                    };

                    if (!isTargetVisible()) {
                        await displayGalleryFromStartIndex(displayIndex, true);
                    }

                } catch (error) {
                    console.error('Failed to jump to image:', error);
                    showGlassToast('error', 'Jump Failed', 'Could not jump to the selected image', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                    resetJumpFlagsAndGalleryOpacity();
                }
            })();
            break;
    }
}

// Expand canvas from gallery
async function expandCanvasFromGallery(image) {
    try {
        const filename = image.upscaled || image.original;

        // Get metadata to determine dimensions
        let metadata = null;
        metadata = await getImageMetadata(filename);

        const imageDimensions = metadata ? {
            width: metadata.actual_width || metadata.width,
            height: metadata.actual_height || metadata.height,
            resPreset: metadata.actual_resolution || metadata.resolution || metadata.resPreset
        } : null;

        // Open the expansion modal
        openImageExpansionModal(filename, imageDimensions);
    } catch (error) {
        console.error('Failed to expand canvas:', error);
        showGlassToast('error', 'Expansion Failed', error.message, false, undefined, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Create desktop shortcut from image
async function createDesktopShortcutFromImage(image) {
    try {
        if (!desktopShortcuts) {
            showGlassToast('error', 'Error', 'Desktop shortcuts not available', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        // Get filename from various possible properties
        const filename = image.filename || image.original || image.upscaled;

        if (!filename) {
            showGlassToast('error', 'Error', 'Image filename not found', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
            return;
        }

        // Create shortcut object
        const shortcut = {
            name: filename.replace(/\.[^/.]+$/, ''), // Remove extension
            type: 'image',
            data: {
                filename: filename,
                preview: image.preview || image.base // Save preview filename for proper URL construction
            }
        };

        // Add shortcut
        await desktopShortcuts.addShortcut(shortcut);

        showGlassToast('success', null, 'Shortcut added to desktop', false, 3000, '<i class="fas fa-arrow-down-left"></i>');
    } catch (error) {
        console.error('Failed to create desktop shortcut:', error);
        showGlassToast('error', 'Error', 'Failed to create shortcut', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Helper functions for context menu actions
async function fetchGalleryImageBlobForClipboard(image) {
    let imageUrl;
    if (image.url) {
        imageUrl = image.url;
    } else {
        // resolveGalleryFullImageUrl / localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        imageUrl = resolveGalleryFullImageUrl(image)
            || localGalleryImageUrl(image.upscaled || image.original);
    }

    // Prefer server restore of stealth origin Comment (strips forge_data from tEXt)
    // Path is encodeURIComponent'd so literal `?` in filenames is `%3F`; only real query uses `?`.
    const clipboardUrl = imageUrl.includes('?')
        ? `${imageUrl}&clipboardOrigin=true`
        : `${imageUrl}?clipboardOrigin=true`;

    let response = await fetch(clipboardUrl, { cache: 'no-store' });
    if (!response.ok) {
        response = await fetch(imageUrl, { cache: 'no-store' });
    }
    const naiSigValid = response.headers.get('X-NovelAI-Signature-Valid');
    const naiSigInvalid = naiSigValid !== null && naiSigValid.toLowerCase() !== 'true';
    const blob = await response.blob();
    const filename = image.filename || image.original || image.upscaled;
    const name = filename ? String(filename).split('/').pop() : 'image.png';
    // formatClipboardBlobSize: public/scripts/utils/dreamscapeClipboard.js
    return { blob, name, naiSigInvalid, sizeText: formatClipboardBlobSize(blob) };
}

function copyImageToClipboard(image) {
    // copyBlobToClipboard: public/scripts/utils/dreamscapeClipboard.js
    (async () => {
        try {
            const { blob, name, naiSigInvalid, sizeText } = await fetchGalleryImageBlobForClipboard(image);

            await copyBlobToClipboard(blob, { name });

            if (showGlassToast) {
                if (naiSigInvalid) {
                    showGlassToast(
                        'warning',
                        'Image copied to clipboard!',
                        `(${sizeText})<br>NAI Signing Key Invalid`,
                        false,
                        4000,
                        '<i class="fas fa-exclamation-triangle"></i>'
                    );
                } else {
                    // showGlassToast: public/scripts/comp/toastManager.js
                    showGlassToast('success', 'Image copied to clipboard!', `(${sizeText})`, false, 3000, '<i class="fas fa-clipboard-check"></i>');
                }
            }
        } catch (error) {
            console.error('Failed to copy image to clipboard:', error);
            if (showGlassToast) {
                showGlassToast('error', 'Failed to copy image to clipboard', '', false, 3000, '<i class="fas fa-clipboard"></i>');
            }
        }
    })();
}

function moveImageToScraps(image, event = null) {
    const filename = image.filename || image.original || image.upscaled;

    // Call the move to scraps function directly
    moveImageToScrapsDirect(filename, event);
}

// Gallery column size management
const GALLERY_MINMAX_STORAGE_KEY = 'galleryMinmaxValue';
const GALLERY_MINMAX_MIN = 175;
const GALLERY_MINMAX_MAX = 800;
const GALLERY_MINMAX_DEFAULT = 320;

// Get saved gallery minmax value from localStorage
function getGalleryMinmaxValue() {
    const saved = localStorage.getItem(GALLERY_MINMAX_STORAGE_KEY);
    if (saved !== null) {
        const value = parseInt(saved, 10);
        if (!isNaN(value) && value >= GALLERY_MINMAX_MIN && value <= GALLERY_MINMAX_MAX) {
            return value;
        }
    }
    return GALLERY_MINMAX_DEFAULT;
}

// Save gallery minmax value to localStorage
function saveGalleryMinmaxValue(value) {
    localStorage.setItem(GALLERY_MINMAX_STORAGE_KEY, value.toString());
}

// Apply minmax value to gallery CSS
function applyGalleryMinmaxValue(value) {
    void (value); // This is a no-op, but it's here to satisfy the linter
}

// Calculate the step size needed to add/remove a column based on actual element sizes
function calculateGalleryColumnStep(direction) {
    const gallery = document.getElementById('gallery');
    if (!gallery) return 0;

    const { width: containerWidth } = getGalleryContainerDimensions();

    if (containerWidth <= 0) return 0;

    // Get actual rendered element sizes to calculate real column count
    const items = gallery.querySelectorAll('.gallery-item:not(.gallery-placeholder), .gallery-placeholder.gallery-item');
    if (items.length === 0) {
        return 0;
    }

    // Use actual element width to determine current columns
    // getBoundingClientRect().width includes the border (2px on each side = 4px total)
    const firstItem = items[0];
    const firstRect = firstItem.getBoundingClientRect();
    const actualItemWidthWithBorder = firstRect.width;

    if (actualItemWidthWithBorder <= 0) return 0;

    // Use a fixed step size based on container width to ensure smooth, predictable adjustments
    // Step size should be proportional to container width but not too large
    const baseStep = Math.max(2, Math.min(5, containerWidth * 0.01)); // 1% of width, clamped between 2-5px

    if (direction > 0) {
        // Increase: want one more column (smaller items)
        // To get one more column, we need to decrease the minmax value
        // Use a fixed negative step
        return -baseStep;
    } else {
        // Decrease: want one less column (larger items)
        // To get one less column, we need to increase the minmax value
        // Use a fixed positive step
        return baseStep;
    }
}

// Adjust gallery column size
function adjustGalleryColumnSize(direction) {
    const gallery = document.getElementById('gallery');
    if (!gallery) return;

    const currentValue = getGalleryMinmaxValue();
    const { width: containerWidth } = getGalleryContainerDimensions();

    if (containerWidth <= 0) return;

    // Calculate step using actual element sizes
    const step = calculateGalleryColumnStep(direction);

    // If step is effectively zero, don't update
    if (Math.abs(step) < 1) return;

    // Calculate new value
    let newValue = currentValue + step;

    // Round to whole pixels
    newValue = Math.round(newValue);

    // Clamp to min/max
    const clampedValue = Math.min(Math.max(newValue, GALLERY_MINMAX_MIN), GALLERY_MINMAX_MAX);

    // Only update if value actually changed
    if (clampedValue !== currentValue) {
        saveGalleryMinmaxValue(clampedValue);
        applyGalleryMinmaxValue(clampedValue);
    }
}

// Load and apply saved gallery minmax value on initialization
let galleryMinmaxInitialized = false;
function initializeGalleryMinmaxValue() {
    if (galleryMinmaxInitialized) return;
    const value = getGalleryMinmaxValue();
    applyGalleryMinmaxValue(value);
    galleryMinmaxInitialized = true;
}

async function handleMoveToWorkspace(image, workspaceId, workspaceName) {
    const filename = image.filename || image.original || image.upscaled;

    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        `Move image to workspace "${workspaceName}"?`,
        [
            { text: 'Move', value: true, className: 'btn-primary' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ]
    );

    if (confirmed) {
        try {
            // Show loading toast
            const toastId = showGlassToast('info', 'Moving Image', `Moving image to ${workspaceName}...`, true, false, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');

            // Move the image using WebSocket
            if (window.wsClient && window.wsClient.isConnected()) {
                // Determine move type based on current gallery view
                const isScrapsView = currentGalleryView === 'scraps';
                const isPinnedView = currentGalleryView === 'pinned';
                let moveType = 'files';
                if (isScrapsView) {
                    moveType = 'scraps';
                } else if (isPinnedView) {
                    moveType = 'pinned';
                }

                const response = await window.wsClient.moveFilesToWorkspace([filename], workspaceId, activeWorkspace, moveType);

                if (response.success) {
                    // Update loading toast to success
                    updateGlassToastProgress(toastId, 100);
                    updateGlassToastComplete(toastId, {
                        type: 'success',
                        title: 'Image Moved',
                        message: `Image moved to ${workspaceName}`,
                        icon: '<i class="fas fa-folder-open"></i>',
                        showProgress: false,
                        timeout: 5000
                    });

                    // Remove the image from current view
                    removeImageFromGallery(image);
                } else {
                    throw new Error(response.error || 'Failed to move image');
                }
            } else {
                throw new Error('WebSocket not connected');
            }
        } catch (error) {
            console.error('Error moving image to workspace:', error);
            // Update loading toast to error
            updateGlassToastProgress(toastId, 100);
            updateGlassToastComplete(toastId, {
                type: 'error',
                title: 'Move Failed',
                message: `Failed to move image to ${workspaceName}: ${error.message}`,
                icon: '<i class="fas fa-exclamation-triangle"></i>',
                showProgress: false,
                timeout: 5000
            });
        }
    }
}

function createReferenceFromImage(image) {
    // See public/scripts/comp/galleryToolbar.js:addImageAsReference
    void addImageAsReference(image);
}

function createVibeEncodingFromImage(image) {
    // See public/scripts/comp/galleryToolbar.js:addImageAsVibeTransfer
    void addImageAsVibeTransfer(image);
}

// Get move workspace options for submenu (works for both single and bulk operations)
function getMoveWorkspaceOptions(target) {
    const workspaceOptions = [];

    // Get available workspaces and return submenu items
    const workspacesData = workspaces || window.workspaces || {};
    const workspacesFiltered = Object.values(workspacesData).sort((a, b) => (a.sort || 0) - (b.sort || 0))

    // Get current workspace ID - try multiple sources
    let currentWorkspaceId = 'default';
    if (typeof activeWorkspace !== 'undefined') {
        currentWorkspaceId = activeWorkspace;
    } else if (window.activeWorkspace) {
        currentWorkspaceId = window.activeWorkspace;
    } else if (getActiveWorkspace) {
        currentWorkspaceId = getActiveWorkspace();
    }

    // Generate workspace options
    workspacesFiltered
        .filter(workspace => workspace.id !== currentWorkspaceId)
        .forEach((workspace) => {
            const workspaceId = workspace.id;
            const workspaceName = workspace.name;
            const workspaceColor = workspace.color || '#6366f1';

            workspaceOptions.push({
                content: `
                    <div class="workspace-option-content" style="display: flex; align-items: center; gap: 8px;">
                        <div class="workspace-color-indicator" style="width: 12px; height: 12px; border-radius: 50%; background-color: ${workspaceColor};"></div>
                        <span class="context-menu-item-text">${workspaceName}</span>
                    </div>
                `,
                action: 'move-to-workspace',
                workspaceId: workspaceId,
                workspaceName: workspaceName,
                disabled: false
            });
        });

    return workspaceOptions;
}

// Handle move workspace action with confirmation (works for both single and bulk operations)
async function handleMoveWorkspaceAction(subItem, target) {
    const action = subItem.action;
    if (action === 'move-to-workspace') {
        const workspaceId = subItem.workspaceId;
        const workspaceName = subItem.workspaceName;

        if (!workspaceId || !workspaceName) return;

        // Determine if this is a bulk operation by checking for selected items
        const selectedFilenames = getSelectedFilenames();
        const selectedCount = selectedFilenames.length;
        const isBulkOperation = selectedCount > 0;

        let imagesToMove = [];

        if (isBulkOperation) {
            // Bulk operation: use selected images
            imagesToMove = getSelectedImages();
        } else {
            // Check if target is inside an image viewer modal
            const imageViewerModal = target.closest('[id^="imageViewer_"]');
            if (imageViewerModal && typeof imageViewerManager !== 'undefined') {
                // Image viewer context: get viewer instance and use its metadata
                const viewerId = imageViewerModal.id;
                const viewer = imageViewerManager.getViewer(viewerId);
                if (viewer && viewer.metadata) {
                    const filename = viewer.metadata.filename || viewer.metadata.original || viewer.metadata.upscaled;
                    if (filename) {
                        // Find the image object from allImages
                        const imageToMove = allImages.find(img =>
                            img && (img.filename === filename || img.original === filename || img.upscaled === filename)
                        );
                        if (imageToMove) {
                            imagesToMove = [imageToMove];
                        }
                    }
                }
            } else {
                // Check if target is inside spellbook preview
                const spellbookModal = target.closest('#spellbookGenerationModal');
                if (spellbookModal && window.spellbookModalManager && typeof window.spellbookModalManager.getPreviewImageMetadata === 'function') {
                    const imageToMove = window.spellbookModalManager.getPreviewImageMetadata();
                    if (imageToMove) {
                        imagesToMove = [imageToMove];
                    }
                } else {
                    // Single operation: get image from target (gallery item)
                    const galleryItem = target.closest('.gallery-item');
                    if (!galleryItem) return;

                    const fileIndex = parseInt(galleryItem.dataset.fileIndex, 10);
                    const imageToMove = allImages[fileIndex];

                    if (!imageToMove) return;

                    const filename = imageToMove.filename || imageToMove.original || imageToMove.upscaled;
                    if (!filename) return;

                    imagesToMove = [imageToMove];
                }
            }
        }

        if (imagesToMove.length === 0) {
            showError('No images to move');
            return;
        }

        const itemCount = imagesToMove.length;

        // Show confirmation dialog
        const confirmed = (isBulkOperation) ? await showConfirmationDialog(
            `Move ${itemCount} ${itemCount === 1 ? 'image' : 'images'} to workspace "${workspaceName}"?`,
            [
                { text: 'Move', value: true, className: 'btn-primary' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ]
        ) : true;

        if (confirmed) {
            let toastId = null;
            try {
                // Show loading toast
                toastId = showGlassToast('info', 'Moving Images', `Moving ${itemCount} ${itemCount === 1 ? 'image' : 'images'} to ${workspaceName}...`, true, false, '<i class="mdi mdi-1-5 mdi-folder-move"></i>');

                // Move the images using WebSocket
                if (window.wsClient && window.wsClient.isConnected()) {
                    // Determine move type based on current gallery view
                    const isScrapsView = currentGalleryView === 'scraps';
                    const isPinnedView = currentGalleryView === 'pinned';
                    let moveType = 'files';
                    if (isScrapsView) {
                        moveType = 'scraps';
                    } else if (isPinnedView) {
                        moveType = 'pinned';
                    }

                    // Get current workspace
                    let currentWorkspaceId = 'default';
                    if (typeof activeWorkspace !== 'undefined') {
                        currentWorkspaceId = activeWorkspace;
                    } else if (window.activeWorkspace) {
                        currentWorkspaceId = window.activeWorkspace;
                    } else if (getActiveWorkspace) {
                        currentWorkspaceId = getActiveWorkspace();
                    }

                    // Extract filenames from images for WebSocket call
                    const filenamesToMove = imagesToMove.map(img => img.filename || img.original || img.upscaled).filter(f => f);
                    const response = await window.wsClient.moveFilesToWorkspace(filenamesToMove, workspaceId, currentWorkspaceId, moveType);

                    if (response.success) {
                        // Update loading toast to success
                        if (toastId) {
                            updateGlassToastProgress(toastId, 100);
                            updateGlassToastComplete(toastId, {
                                type: 'success',
                                title: itemCount === 1 ? 'Image Moved' : 'Images Moved',
                                message: `${itemCount} ${itemCount === 1 ? 'image' : 'images'} moved to ${workspaceName}`,
                                icon: '<i class="fas fa-folder-open"></i>',
                                showProgress: false,
                                timeout: 5000
                            });
                        }

                        // Remove the images from current view
                        imagesToMove.forEach(image => {
                            if (image) {
                                removeImageFromGallery(image);
                            }
                        });

                        // Clear selection after move (only for bulk operations)
                        if (isBulkOperation) {
                            clearSelection();
                        }

                        // If the manual preview is showing a moved image, resume at the next available item
                        if (!isBulkOperation && window.currentManualPreviewImage) {
                            const previewFilename = window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;
                            const movedFilenames = imagesToMove.map(img => img && (img.filename || img.original || img.upscaled)).filter(Boolean);
                            if (previewFilename && movedFilenames.includes(previewFilename)) {
                                // resumeManualPreviewAfterRemoval: public/scripts/comp/manualPreviewManager.js
                                await resumeManualPreviewAfterRemoval(window.currentManualPreviewIndex ?? 0);
                            }
                        }
                    } else {
                        throw new Error(response.error || 'Failed to move images');
                    }
                } else {
                    throw new Error('WebSocket not connected');
                }
            } catch (error) {
                console.error('Error moving images to workspace:', error);
                // Update loading toast to error
                if (toastId) {
                    updateGlassToastProgress(toastId, 100);
                    updateGlassToastComplete(toastId, {
                        type: 'error',
                        title: 'Move Failed',
                        message: `Failed to move images to ${workspaceName}: ${error.message}`,
                        icon: '<i class="fas fa-exclamation-triangle"></i>',
                        showProgress: false,
                        timeout: 5000
                    });
                } else {
                    showError(`Failed to move images to ${workspaceName}: ${error.message}`);
                }
            }
        }
    }
}

// Select a contiguous index range in the current filtered gallery order (merges with existing selection unless was "all selected")
function bulkSelectFilteredIndexRange(startIndex, endIndex) {
    const imagesToProcess = window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0
        ? window.filteredImageIndices.map(idx => allImages[idx])
        : allImages;
    if (!imagesToProcess.length || startIndex > endIndex) return;

    const cappedStart = Math.max(0, startIndex);
    const cappedEnd = Math.min(endIndex, imagesToProcess.length - 1);
    if (cappedStart > cappedEnd) return;

    if (isAllSelected) {
        selectedImages.clear();
    }
    isAllSelected = false;

    const domItemsMap = new Map();
    document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]').forEach(el => {
        const fn = el.dataset.filename;
        if (fn) domItemsMap.set(fn, el);
    });

    for (let i = cappedStart; i <= cappedEnd; i++) {
        const image = imagesToProcess[i];
        if (!image) continue;
        const fname = image.filename || image.original || image.upscaled;
        if (!fname) continue;
        selectedImages.add(fname);
        const domItem = domItemsMap.get(fname);
        if (domItem) {
            domItem.dataset.selected = 'true';
            domItem.classList.add('selected');
            const checkbox = domItem.querySelector('.gallery-item-checkbox');
            if (checkbox) checkbox.checked = true;
        }
    }
    updateBulkActionsBar();
}

function onGalleryBatchSelectionKeydown(e) {
    const galleryEl = document.getElementById('gallery');
    if (!galleryEl || !galleryEl.classList.contains('selection-mode')) return;

    const tag = e.target && e.target.tagName;
    if (tag === 'INPUT' || tag === 'TEXTAREA' || tag === 'SELECT' || (e.target && e.target.isContentEditable)) return;

    if (e.key === 'Escape') {
        if (contextMenu && contextMenu.isOpen) {
            galleryBatchEscapePrevTs = 0;
            return;
        }
        const now = Date.now();
        if (galleryBatchEscapePrevTs > 0 && now - galleryBatchEscapePrevTs < 420) {
            e.preventDefault();
            e.stopPropagation();
            clearSelection();
            galleryBatchEscapePrevTs = 0;
            return true;
        }
        galleryBatchEscapePrevTs = now;
        return;
    }

    if (e.key === 'Delete') {
        if (getSelectedCount() === 0) return;
        e.preventDefault();
        e.stopPropagation();
        // handleBulkDelete — public/scripts/comp/bulkOperationsManager.js
        handleBulkDelete(e);
        return true;
    }

    const mod = e.ctrlKey || e.metaKey;
    if (e.code === 'KeyA' && mod) {
        e.preventDefault();
        e.stopPropagation();
        document.dispatchEvent(new CustomEvent('contextMenuAction', {
            detail: { action: 'bulk-select-all', target: galleryEl }
        }));
        return true;
    }

    if (e.code === 'KeyX' && mod) {
        if (getSelectedCount() === 0) return;
        e.preventDefault();
        e.stopPropagation();
        // public/scripts/comp/contextMenu.js — openBulkActionsMoveSubmenuCentered
        contextMenu.openBulkActionsMoveSubmenuCentered(galleryEl);
        return true;
    }

    if ((e.code === 'Comma' || e.code === 'Period') && e.ctrlKey && !e.metaKey) {
        let anchor;
        if (lastSelectedGalleryIndex !== null && lastSelectedGalleryIndex >= 0) {
            const n = window.filteredImageIndices && window.filteredImageIndices.length > 0
                ? window.filteredImageIndices.length
                : allImages.length;
            if (lastSelectedGalleryIndex < n) anchor = lastSelectedGalleryIndex;
        }
        if (typeof anchor === 'undefined') {
            if (isAllSelected) {
                anchor = -1;
            } else {
                anchor = -1;
                getSelectedFilenames().forEach((fname) => {
                    const idx = findImageArrayIndex(fname);
                    if (idx > anchor) anchor = idx;
                });
            }
        }
        const last = (window.filteredImageIndices && window.filteredImageIndices.length > 0
            ? window.filteredImageIndices.length
            : allImages.length) - 1;
        if (e.code === 'Comma') {
            if (anchor < 1) return;
            e.preventDefault();
            e.stopPropagation();
            bulkSelectFilteredIndexRange(0, anchor - 1);
            return true;
        }
        if (anchor < 0 || anchor >= last) return;
        e.preventDefault();
        e.stopPropagation();
        bulkSelectFilteredIndexRange(anchor + 1, last);
        return true;
    }
}

// Get bulk actions context menu configuration (shared by both switchToBulkContextMenu and createGalleryItem)
function getBulkActionsContextMenuConfig() {
    return {
        maxHeight: true,
        sections: [
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fa-solid fa-check-double',
                        tooltip: 'Select All',
                        action: 'bulk-select-all',
                        loadfn: (menuItem, target) => {
                            // Disable if all items are already selected
                            const totalCount = window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0
                                ? window.filteredImageIndices.length
                                : allImages.length;
                            menuItem.disabled = getSelectedCount() === totalCount;
                        }
                    },
                    {
                        icon: 'fas fa-up-to-dotted-line',
                        tooltip: 'Select All Before',
                        action: 'bulk-select-all-above'
                    },
                    {
                        icon: 'fas fa-down-to-dotted-line',
                        tooltip: 'Select All Below',
                        action: 'bulk-select-all-after'
                    },
                    {
                        icon: 'fas fa-diamond-half-stroke',
                        tooltip: 'Invert Selection',
                        action: 'bulk-invert-selection'
                    },
                    {
                        icon: 'fa-regular fa-xmark-large',
                        tooltip: 'Clear Selection',
                        action: 'bulk-clear-selection',
                        className: 'text-danger',
                        disabled: false
                    }
                ]
            },
            {
                type: 'list',
                title: 'Bulk Actions',
                items: [
                    {
                        icon: 'fas fa-clipboard',
                        text: 'Copy Image(s)',
                        action: 'bulk-copy',
                        loadfn: (menuItem) => {
                            menuItem.disabled = getSelectedCount() === 0;
                        }
                    },
                    {
                        icon: 'fas fa-download',
                        text: 'Download Image(s)',
                        action: 'bulk-download',
                        loadfn: (menuItem) => {
                            menuItem.disabled = getSelectedCount() === 0;
                        }
                    },
                    {
                        icon: 'fas fa-share',
                        text: 'Share to Sequenzia',
                        action: 'bulk-sequenzia',
                        disabled: false
                    },
                    {
                        icon: 'fas fa-folder-arrow-up',
                        text: 'Move to...',
                        optionsfn: getMoveWorkspaceOptions,
                        handlerfn: handleMoveWorkspaceAction,
                        openOnHover: false
                    },
                    {
                        icon: 'fas fa-bin-recycle',
                        text: 'Move to Scraps',
                        action: 'bulk-move-scraps',
                        disabled: currentGalleryView === 'scraps' || currentGalleryView === 'pinned'
                    },
                    {
                        icon: 'fa-solid fa-star',
                        text: 'Pin',
                        action: 'bulk-pin',
                        hidden: () => currentGalleryView === 'pinned',
                        loadfn: (menuItem, target) => {
                            // Disable if not in images view
                            if (currentGalleryView !== 'images') {
                                menuItem.disabled = true;
                                return;
                            }

                            // Get selected images and check if any are not pinned
                            const selectedImagesArray = getSelectedImages();
                            if (selectedImagesArray.length === 0) {
                                menuItem.disabled = true;
                                return;
                            }

                            // Disable if all selected items are already pinned
                            const hasUnpinnedItems = selectedImagesArray.some(img => !img.isPinned);
                            menuItem.disabled = !hasUnpinnedItems;
                        }
                    },
                    {
                        icon: 'fa-regular fa-star',
                        text: 'Unpin',
                        action: 'bulk-unpin',
                        loadfn: (menuItem, target) => {
                            // Get selected images and check if any are pinned
                            const selectedImagesArray = getSelectedImages();
                            if (selectedImagesArray.length === 0) {
                                menuItem.disabled = true;
                                return;
                            }

                            // Disable if no selected items are pinned
                            const hasPinnedItems = selectedImagesArray.some(img => img.isPinned);
                            menuItem.disabled = !hasPinnedItems;
                        }
                    },
                    {
                        icon: 'fas fa-pen-field',
                        text: 'Change Preset',
                        action: 'bulk-change-preset',
                        disabled: false
                    },
                    {
                        icon: 'nai-trash',
                        text: 'Delete',
                        action: 'bulk-delete',
                        disabled: false,
                        className: 'context-menu-item-danger'
                    }
                ]
            }
        ]
    };
}

// Switch to bulk actions context menu
function switchToBulkContextMenu() {
    if (!contextMenu) return;

    const gallery = document.getElementById('gallery');
    if (!gallery) return;

    const bulkActionsConfig = getBulkActionsContextMenuConfig();

    // Attach bulk context menu to gallery and all gallery items
    contextMenu.attachToElement(gallery, bulkActionsConfig);

    const galleryItems = gallery.querySelectorAll('.gallery-item');
    galleryItems.forEach(item => {
        // Store original context menu config if not already stored
        if (!item.dataset.originalContextMenuStored) {
            const originalConfigId = item.dataset.contextMenu;
            if (originalConfigId && contextMenu.configs && contextMenu.configs[originalConfigId]) {
                item.dataset.originalContextMenuConfig = originalConfigId;
                item.dataset.originalContextMenuStored = 'true';
            }
        }

        // Attach bulk context menu to override individual menu
        contextMenu.attachToElement(item, bulkActionsConfig);
        item.dataset.bulkContextMenuActive = 'true';
    });
}

// Switch back to original context menus
function switchToOriginalContextMenu() {
    if (!contextMenu) return;

    const gallery = document.getElementById('gallery');
    if (!gallery) return;

    // Detach bulk context menu from gallery
    contextMenu.detachFromElement(gallery);

    // Restore original context menus for all gallery items
    const galleryItems = gallery.querySelectorAll('.gallery-item');
    galleryItems.forEach(item => {
        if (item.dataset.bulkContextMenuActive) {
            // Detach bulk context menu
            contextMenu.detachFromElement(item);
            item.dataset.bulkContextMenuActive = '';

            // Restore original context menu if it was stored
            if (item.dataset.originalContextMenuStored && item.dataset.originalContextMenuConfig) {
                const originalConfigId = item.dataset.originalContextMenuConfig;
                if (contextMenu.configs && contextMenu.configs[originalConfigId]) {
                    // Reattach the original context menu
                    contextMenu.attachToElement(item, contextMenu.configs[originalConfigId]);
                }
            }
        }
    });
}

// Handle bulk actions context menu
function handleBulkActionsContextMenu(event) {
    const { action, target } = event.detail;

    // Only handle bulk actions
    if (!action.startsWith('bulk-')) return;

    switch (action) {
        case 'bulk-copy':
            // handleBulkCopy — public/scripts/comp/bulkOperationsManager.js
            handleBulkCopy();
            break;
        case 'bulk-download':
            // handleBulkDownload — public/scripts/comp/bulkOperationsManager.js
            handleBulkDownload();
            break;
        case 'bulk-sequenzia':
            handleBulkSequenzia();
            break;
        case 'bulk-move-workspace':
            handleBulkMoveToWorkspace();
            break;
        case 'bulk-move-scraps':
            handleBulkMoveToScraps();
            break;
        case 'bulk-pin':
            handleBulkPin();
            break;
        case 'bulk-unpin':
            handleBulkUnpin();
            break;
        case 'bulk-change-preset':
            handleBulkChangePreset();
            break;
        case 'bulk-delete':
            handleBulkDelete();
            break;
        case 'bulk-select-all':
            selectedImages.clear();
            isAllSelected = true;

            // Update DOM for existing items
            const allDomItems = document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]');
            allDomItems.forEach(item => {
                const filename = item.dataset.filename;
                if (filename && !selectedImages.has(filename)) {
                    item.dataset.selected = 'true';
                    item.classList.add('selected');
                    const checkbox = item.querySelector('.gallery-item-checkbox');
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                }
            });
            updateBulkActionsBar();
            break;
        case 'bulk-select-all-above':
        case 'bulk-select-all-after': {
            const clickedItem = target.closest('.gallery-item, .gallery-placeholder');
            if (!clickedItem) break;

            const clickedFilename = clickedItem.dataset.filename;
            if (!clickedFilename) break;

            const clickedImageIndex = findImageArrayIndex(clickedFilename);
            if (clickedImageIndex === -1) break;

            if (action === 'bulk-select-all-above') {
                bulkSelectFilteredIndexRange(0, clickedImageIndex);
                break;
            }

            const imagesToProcess = window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0
                ? window.filteredImageIndices.map(idx => allImages[idx])
                : allImages;

            bulkSelectFilteredIndexRange(clickedImageIndex + 1, imagesToProcess.length - 1);
            break;
        }
        case 'bulk-invert-selection': {
            // Clear "all selected" flag
            const wasAllSelected = isAllSelected;
            isAllSelected = false;

            // Get all images
            const imagesToProcess = window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0
                ? window.filteredImageIndices.map(idx => allImages[idx])
                : allImages;

            // Create a new selection set
            const newSelection = new Set();

            imagesToProcess.forEach(image => {
                if (!image) return;
                const filename = image.filename || image.original || image.upscaled;
                if (!filename) return;

                // Determine if this item should be selected after inversion
                let shouldBeSelected;
                if (wasAllSelected) {
                    // If all were selected, select only the excluded ones
                    shouldBeSelected = selectedImages.has(filename);
                } else {
                    // If not all selected, invert the current state
                    shouldBeSelected = !selectedImages.has(filename);
                }

                if (shouldBeSelected) {
                    newSelection.add(filename);
                }
            });

            // Update selection
            selectedImages = newSelection;

            // Update DOM for existing items
            const allDomItems = document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]');
            allDomItems.forEach(item => {
                const filename = item.dataset.filename;
                if (filename) {
                    const isSelected = selectedImages.has(filename);
                    item.dataset.selected = isSelected ? 'true' : 'false';
                    if (isSelected) {
                        item.classList.add('selected');
                    } else {
                        item.classList.remove('selected');
                    }
                    const checkbox = item.querySelector('.gallery-item-checkbox');
                    if (checkbox) {
                        checkbox.checked = isSelected;
                    }
                }
            });

            updateBulkActionsBar();
            break;
        }
        case 'bulk-clear-selection':
            clearSelection();
            break;
    }
}

function clearGallery() {
    if (gallery) {
        disposeGalleryContents();
        if (intersectionObserver) {
            intersectionObserver.disconnect();
            intersectionObserver = null;
        }
        gallery.innerHTML = '';
    }
    lastGalleryDisplayKey = '';
    // Clear selection when clearing gallery
    clearSelection();
}

/** Clear DOM and scroll state before loading a different workspace gallery. */
function resetGalleryForWorkspaceSwitch() {
    scrollPositionPreservationEnabled = false;
    clearGallery();
    resetInfiniteScroll();
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    if (galleryContainer && document.body.classList.contains('desktop-mode')) {
        galleryContainer.scrollTop = 0;
    }
}
window.resetGalleryForWorkspaceSwitch = resetGalleryForWorkspaceSwitch;

// Send first-visible row index + anchor filename to server (session restore + optional prefetch)
function sendGalleryPositionHint() {
    if (galleryPositionHintThrottle) return;

    galleryPositionHintThrottle = setTimeout(() => {
        galleryPositionHintThrottle = null;

        if (!window.wsClient || !window.wsClient.isConnected()) {
            return;
        }

        if (!gallery || isJumpingToPosition) return;
        if (suppressGalleryPositionHintUntilInteraction) {
            return;
        }
        if (isGallerySearchModeActive()) return;

        const effectiveLen = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
        const colsHint = realGalleryColumns || 5;
        const firstIdx = snapGalleryFilteredIndexToRowStart(getFirstVisibleRowIndex(), colsHint, effectiveLen);
        let anchorFilename;
        const elAt = gallery.querySelector(`[data-index="${firstIdx}"]`);
        if (elAt && elAt.dataset.filename) {
            anchorFilename = elAt.dataset.filename;
        }
        if (!anchorFilename) {
            const real = gallery.querySelector('.gallery-item:not(.gallery-placeholder)');
            if (real && real.dataset.filename) anchorFilename = real.dataset.filename;
        }

        if (Math.abs(firstIdx - lastHintIndex) < 5 && anchorFilename === lastHintAnchorFilename) {
            return;
        }

        lastHintIndex = firstIdx;
        lastHintAnchorFilename = anchorFilename;

        const workspaceId = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'default';

        try {
            window.wsClient.sendAcklessMessage('gallery_position_hint', {
                index: firstIdx,
                viewType: currentGalleryView,
                workspaceId,
                anchorFilename,
                prefetchRange: 50
            });
        } catch (error) {
            console.debug('Failed to send gallery position hint:', error);
        }
    }, 500);
}

// ============================================================================
// GALLERY IMAGE OPERATIONS (Phase 2 batch 12)
// ============================================================================

function findTrueImageIndexInGallery(filename) {
    if (!filename) return -1;

    // If we have filtered results, use the original array
    if (window.originalAllImages && window.originalAllImages.length > 0) {
        return window.originalAllImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }

    // Otherwise, use the current allImages array
    if (allImages && Array.isArray(allImages)) {
        return allImages.findIndex(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
    }

    return -1;
}

async function moveToScraps(image) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.addScrap(activeWorkspace, filename);
            } catch (wsError) {
                showError('Failed to move to scraps: ' + wsError.message);
                throw new Error('Failed to move to scraps');
            }
        } else {
            console.error('Move to scraps failed:', error);
            showError(`Failed to move to scraps: ${error.error}`);
            return;
        }

        showGlassToast('success', null, 'Image Scraped', false, 3000, '<i class="fas fa-bin-bottles-recycle"></i>');

        // If currently viewing scraps, reload them
        switchGalleryView(currentGalleryView, true);
    } catch (error) {
        console.error('Error moving to scraps:', error);
        showError('Failed to move image to scraps');
    }
}

// Direct function to move image to scraps by filename (used by gallery context menu)
async function moveImageToScrapsDirect(filename, event = null) {
    try {
        if (!filename) {
            showError('No filename provided for moving to scraps');
            return;
        }

        // Show confirmation dialog
        const confirmed = await showConfirmationDialog(
            'Are you sure you want to move this image to scraps?',
            [
                { text: 'Move to Scraps', value: true, className: 'btn-danger' },
                { text: 'Cancel', value: false, className: 'btn-secondary' }
            ],
            event
        );

        if (!confirmed) {
            return;
        }

        // Use WebSocket API if available, otherwise fall back to HTTP
        if (window.wsClient && window.wsClient.isConnected()) {
            try {
                await window.wsClient.addScrap(activeWorkspace, filename);
            } catch (wsError) {
                showError('Failed to move to scraps: ' + wsError.message);
                throw new Error('Failed to move to scraps');
            }
        } else {
            console.error('WebSocket not connected for moving to scraps');
            showError('Failed to move to scraps: WebSocket not connected');
            return;
        }

        showGlassToast('success', null, 'Image Scraped', false, 3000, '<i class="fas fa-bin-bottles-recycle"></i>');

        // Remove image from current gallery view locally (only if not viewing scraps)
        if (currentGalleryView !== 'scraps' && typeof removeImageFromGallery === 'function') {
            // Find the image object using the helper function from galleryView.js
            const imageToRemove = findImageByFilename(filename);

            if (imageToRemove) {
                removeImageFromGallery(imageToRemove);
            }
        } else if (currentGalleryView === 'scraps') {
            // If viewing scraps, we need to reload to show the new scrap
            switchGalleryView(currentGalleryView, true);
        }
    } catch (error) {
        console.error('Error moving image to scraps:', error);
        showError('Failed to move image to scraps');
    }
}

// Move manual preview image to scraps and advance to next image
async function moveManualPreviewToScraps() {
    if (!window.currentManualPreviewImage) {
        showError('No image to move to scraps');
        return;
    }

    try {
        // Show navigation loading overlay
        showManualPreviewNavigationLoading(true);

        const filename = window.currentManualPreviewImage.filename || window.currentManualPreviewImage.original || window.currentManualPreviewImage.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            showManualPreviewNavigationLoading(false);
            return;
        }

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        await window.wsClient.addScrap(activeWorkspace, filename);

        // Resume the preview at the boundary-correct next available image
        // resumeManualPreviewAfterRemoval: public/scripts/comp/manualPreviewManager.js
        await resumeManualPreviewAfterRemoval(window.currentManualPreviewIndex ?? 0);
        showGlassToast('success', null, 'Image scrapped', undefined, undefined, '<i class="fas fa-bin-bottles-recycle"></i>');

        // Refresh gallery after processing is complete
        loadGallery(true);
    } catch (error) {
        console.error('Error moving to scraps:', error);
        showError('Failed to move image to scraps');
    } finally {
        // Hide navigation loading overlay
        showManualPreviewNavigationLoading(false);
    }
}

// Remove image from scraps
async function removeFromScraps(image) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        // Use WebSocket API
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        await window.wsClient.removeScrap(activeWorkspace, filename);

        showGlassToast('success', null, 'Image removed from scraps', undefined, undefined, '<i class="nai-dot-reset"></i>');

        // Remove image from current gallery view locally (only if viewing scraps)
        if (currentGalleryView === 'scraps' && typeof removeImageFromGallery === 'function') {
            removeImageFromGallery(image);
        } else if (currentGalleryView !== 'scraps') {
            // If not viewing scraps, we might need to reload to show it in the main view
            switchGalleryView(currentGalleryView, true);
        }
    } catch (error) {
        console.error('Error removing from scraps:', error);
        showError('Failed to remove image from scraps');
    }
}

// Toggle pin status of an image
async function togglePinImage(image, pinBtn = null) {
    try {
        const filename = image.filename || image.original || image.upscaled;
        if (!filename) {
            showError('No filename available for this image');
            return;
        }

        // Get pin status from local data, not API
        const imageIndex = findTrueImageIndexInGallery(filename);
        let isPinned = false;
        if (imageIndex !== -1 && allImages[imageIndex].isPinned !== undefined) {
            isPinned = allImages[imageIndex].isPinned;
        }

        if (isPinned) {
            // Remove from pinned
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }

            await window.wsClient.removePinned(activeWorkspace, filename);
            showGlassToast('success', null, 'Image unpinned', undefined, undefined, '<i class="fa-regular fa-star"></i>');
        } else {
            // Add to pinned
            if (!window.wsClient || !window.wsClient.isConnected()) {
                throw new Error('WebSocket not connected');
            }

            await window.wsClient.addPinned(activeWorkspace, filename);
            showGlassToast('success', null, 'Image pinned', undefined, undefined, '<i class="fa-solid fa-star"></i>');
        }

        // Update the local gallery data FIRST before updating UI
        if (imageIndex !== -1) {
            allImages[imageIndex].isPinned = !isPinned;
        }

        // Update UI based on local data (no API calls)
        if (pinBtn) {
            pinBtn.innerHTML = isPinned ? '<i class="fa-regular fa-star"></i>' : '<i class="fa-solid fa-star"></i>';
            pinBtn.title = isPinned ? 'Pin image' : 'Unpin image';
        } else {
            updateSpecificPinButton(filename);
        }

        // Update all pin buttons in the gallery for this image
        updateGalleryPinButtons(filename, !isPinned);
        syncServiceWorkerImageCacheRules();
    } catch (error) {
        console.error('Error toggling pin status:', error);
        showError('Failed to toggle pin status');
    }
}

// Check if an image is pinned (only checks local data, never makes API calls)
function checkIfImageIsPinned(filename) {
    // Only check local gallery data - server should always provide isPinned
    if (allImages && Array.isArray(allImages)) {
        const image = allImages.find(img => {
            const imgFilename = img.filename || img.original || img.upscaled;
            return imgFilename === filename;
        });
        if (image && image.isPinned !== undefined) {
            return image.isPinned;
        }
    }

    // Default to false if not found (newly generated images can't be pinned)
    return false;
}

let imageCacheRulesSyncTimer = null;
function buildPreviewUrlForCache(image) {
    if (!image) return null;

    let previewValue = image.preview || null;
    if (!previewValue) {
        const baseFilename = image.filename || image.original || image.upscaled;
        if (!baseFilename) return null;
        previewValue = baseFilename.replace(/\.(jpg|jpeg|png|webp)$/i, '.webp');
    }

    if (typeof getGalleryPreviewUrl === 'function') {
        previewValue = getGalleryPreviewUrl(previewValue);
    } else if (globalThis.deviceUtils && typeof globalThis.deviceUtils.getGalleryPreviewUrl === 'function') {
        previewValue = globalThis.deviceUtils.getGalleryPreviewUrl(previewValue);
    }

    if (!previewValue) return null;
    return `/previews/${encodeURIComponent(previewValue)}`;
}

function buildImageUrlForCache(image) {
    if (!image) return null;
    // resolveGalleryFullImageUrl / localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
    return resolveGalleryFullImageUrl(image)
        || localGalleryImageUrl(image.filename || image.original || image.upscaled)
        || null;
}

function syncServiceWorkerImageCacheRules() {
    if (imageCacheRulesSyncTimer) {
        clearTimeout(imageCacheRulesSyncTimer);
    }

    imageCacheRulesSyncTimer = setTimeout(async () => {
        try {
            if (!globalThis.serviceWorkerManager || typeof globalThis.serviceWorkerManager.syncImageCacheRules !== 'function') {
                return;
            }

            const images = Array.isArray(allImages) ? allImages : [];
            if (!images.length) {
                await globalThis.serviceWorkerManager.syncImageCacheRules([], []);
                return;
            }

            const favoriteUrls = [];
            const lockedPreviewUrls = [];
            const seenFavorites = new Set();
            const seenLockedPreviews = new Set();

            for (const image of images) {
                if (image && image.isPinned) {
                    const imageUrl = buildImageUrlForCache(image);
                    if (imageUrl && !seenFavorites.has(imageUrl)) {
                        seenFavorites.add(imageUrl);
                        favoriteUrls.push(imageUrl);
                    }
                }
            }

            for (let i = 0; i < images.length && lockedPreviewUrls.length < 500; i++) {
                const previewUrl = buildPreviewUrlForCache(images[i]);
                if (previewUrl && !seenLockedPreviews.has(previewUrl)) {
                    seenLockedPreviews.add(previewUrl);
                    lockedPreviewUrls.push(previewUrl);
                }
            }

            await globalThis.serviceWorkerManager.syncImageCacheRules(
                favoriteUrls,
                lockedPreviewUrls,
                {
                    maxEntries: 5000,
                    maxSizeBytes: 2 * 1024 * 1024 * 1024,
                    maxIdleMs: 7 * 24 * 60 * 60 * 1000
                }
            );
        } catch (error) {
            console.error('Failed to sync service worker image cache rules:', error);
        }
    }, 300);
}

// Get image metadata via WebSocket with optional IndexedDB cache (never block editor on gallery DB init)
async function getImageMetadata(filename) {
    try {
        const previewImage = window.currentManualPreviewImage;
        if (previewImage && previewImage.metadata) {
            const matches = previewImage.filename === filename
                || previewImage.upscaled === filename
                || previewImage.original === filename;
            if (matches) {
                return previewImage.metadata;
            }
        }

        const lastGen = window.lastGeneration;
        if (lastGen) {
            const matches = lastGen.filename === filename
                || lastGen.upscaled === filename
                || lastGen.original === filename;
            if (matches) {
                if (lastGen.metadata) {
                    return lastGen.metadata;
                }
                if (previewImage && previewImage.metadata) {
                    return previewImage.metadata;
                }
            }
        }

        const cacheBase = String(filename || '').replace(/\.(png|jpg|jpeg|webp)$/i, '');
        if (cacheBase && window.galleryMetadataCache) {
            try {
                await Promise.race([
                    window.galleryMetadataCache.initPromise,
                    new Promise((_, reject) => setTimeout(() => reject(new Error('idb-init-timeout')), 500))
                ]);
                if (window.galleryMetadataCache.db) {
                    const cached = await window.galleryMetadataCache.getMetadata(cacheBase);
                    if (cached) {
                        const { base: _base, cachedAt: _cachedAt, ...metadata } = cached;
                        if (Object.keys(metadata).length > 0) {
                            return metadata;
                        }
                    }
                }
            } catch (_idbError) {
                // Fall through to WebSocket — gallery list DB must not block manual editor
            }
        }

        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const metadata = await window.wsClient.requestImageMetadata(filename);

        if (galleryMetadataCache && metadata && cacheBase) {
            void galleryMetadataCache.setMetadata(cacheBase, metadata);
        }

        return metadata;
    } catch (error) {
        console.error('Error getting image metadata:', error);
        showGlassToast('error', 'Image metadata request error', error.message, false);
        throw error;
    }
}

// Update pin button appearance based on pin status (uses local data only)
function updatePinButtonAppearance(pinBtn, filename) {
    // Get pin status from local data only
    const isPinned = checkIfImageIsPinned(filename);
    if (isPinned) {
        pinBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
        pinBtn.title = 'Unpin image';
    } else {
        pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
        pinBtn.title = 'Pin image';
    }
}

// Update specific pin button for an image
function updateSpecificPinButton(filename) {
    const galleryItems = document.querySelectorAll('.gallery-item');
    for (const item of galleryItems) {
        const img = item.querySelector('img');
        const pinBtn = item.querySelector('.btn-secondary[title*="Pin"]');

        if (img && pinBtn) {
            const itemFilename = img.getAttribute('data-filename') || img.src.split('/').pop();
            if (itemFilename === filename) {
                updatePinButtonAppearance(pinBtn, filename);
                break; // Found the specific item, no need to continue
            }
        }
    }
}

// Update all pin buttons in the gallery for a specific image
function updateGalleryPinButtons(filename, isPinned) {
    try {
        // Find all gallery items with this filename (including placeholders)
        const galleryItems = document.querySelectorAll(`.gallery-item[data-filename="${filename}"], .gallery-placeholder[data-filename="${filename}"]`);

        galleryItems.forEach(item => {
            // The pin button has class 'btn-primary round-button', not 'btn-secondary'
            const pinBtn = item.querySelector('.btn-primary.round-button[title*="Pin"], .btn-primary.round-button[title*="Unpin"], button[title*="Pin"], button[title*="Unpin"]');
            if (pinBtn) {
                if (isPinned) {
                    pinBtn.innerHTML = '<i class="fa-solid fa-star"></i>';
                    pinBtn.title = 'Unpin image';
                } else {
                    pinBtn.innerHTML = '<i class="fa-regular fa-star"></i>';
                    pinBtn.title = 'Pin image';
                }
            }
        });
    } catch (error) {
        console.error('Error updating gallery pin buttons:', error);
    }
}

// Flag to track if app data has been loaded

// Download image
function downloadImage(image) {
    let filename, url;

    // Handle different image object structures
    if (image.url) {
        // For newly generated images (lightbox)
        url = image.url;
        filename = image.filename;
    } else if (image.upscaled || image.original) {
        // For gallery images - prefer highest quality version
        if (image.upscaled) {
            filename = image.upscaled;
        } else {
            filename = image.original;
        }
        url = null; // Will use server endpoint
    } else {
        // Fallback - assume it's a filename string
        filename = image;
        url = null;
    }

    if (url) {
        // For newly generated images
        const link = document.createElement('a');
        link.href = url;
        link.download = filename;
        link.click();
    } else {
        // For existing images — localGalleryImageUrl: public/scripts/comp/assetUrlResolver.js
        const link = document.createElement('a');
        link.href = `${localGalleryImageUrl(filename)}?download=true`;
        link.download = filename;
        link.click();
    }
}

// Download image as slim PNG (without blueprint data)
function downloadImageSlim(image) {
    let filename;

    // Handle different image object structures
    if (image.upscaled || image.original) {
        // For gallery images - prefer highest quality version
        if (image.upscaled) {
            filename = image.upscaled;
        } else {
            filename = image.original;
        }
    } else {
        // Fallback - assume it's a filename string
        filename = image;
    }

    // Use the slim endpoint — localGalleryDerivedImageUrl: public/scripts/comp/assetUrlResolver.js
    const link = document.createElement('a');
    link.href = localGalleryDerivedImageUrl('slim', filename);
    link.download = filename;
    link.click();
}

// Download image as optimized JPG
function downloadImageOptimized(image) {
    let filename;

    // Handle different image object structures
    if (image.upscaled || image.original) {
        // For gallery images - prefer highest quality version
        if (image.upscaled) {
            filename = image.upscaled;
        } else {
            filename = image.original;
        }
    } else {
        // Fallback - assume it's a filename string
        filename = image;
    }

    // Use the optimized endpoint — localGalleryDerivedImageUrl: public/scripts/comp/assetUrlResolver.js
    const link = document.createElement('a');
    link.href = localGalleryDerivedImageUrl('opti', filename);
    link.download = filename;
    link.click();
}

// Delete image
async function deleteImage(image, event = null) {
    // Show confirmation dialog
    const confirmed = await showConfirmationDialog(
        'Are you sure you want to delete this image? This will permanently delete both the original and upscaled versions.',
        [
            { text: 'Delete', value: true, className: 'btn-danger' },
            { text: 'Cancel', value: false, className: 'btn-secondary' }
        ],
        event
    );

    if (!confirmed) {
        return;
    }

    try {
        // Determine which filename to use for deletion
        let filenameToDelete = null;

        // For regular images, prioritize original, then upscaled
        if (image.original) {
            filenameToDelete = image.original;
        } else if (image.upscaled) {
            filenameToDelete = image.upscaled;
        }

        if (!filenameToDelete) {
            throw new Error('No filename available for deletion');
        }


        // Use WebSocket bulk delete request
        if (!window.wsClient || !window.wsClient.isConnected()) {
            throw new Error('WebSocket not connected');
        }

        const result = await window.wsClient.deleteImagesBulk([filenameToDelete]);

        if (result.successful > 0) {
            showGlassToast('success', null, 'Image deleted!', false, 5000, '<i class="fas fa-trash"></i>');

            // Close lightbox
            hideLightbox();

            // Remove image from gallery and add placeholder
            removeImageFromGallery(image);

            // Skip the next gallery reload event since we've already updated locally
            window.skipNextGalleryRefresh = (window.skipNextGalleryRefresh || 0) + 1;
        } else {
            throw new Error('Delete failed');
        }

    } catch (error) {
        console.error('Delete error:', error);
        showError('Failed to delete image: ' + error.message);
    }
}

// Add context menu event listener
document.addEventListener('contextMenuAction', handleGalleryContextMenuAction);
document.addEventListener('contextMenuAction', handleBulkActionsContextMenu);
document.addEventListener('contextMenuAction', handleBulkActionsContextMenu);






























