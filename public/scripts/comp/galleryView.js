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
let visibleItems = new Set(); // Track visible items
let virtualScrollEnabled = true; // Enable virtual scrolling
let currentImage = null;
let savedGalleryPosition = null;
let galleryClearTimeout = null;

// Bidirectional infinite scroll tracking
let displayedStartIndex = 0; // First displayed image index in allImages array
let displayedEndIndex = 0;   // Last displayed image index in allImages array
let lastHintIndex = -1; // Track last sent hint index to avoid duplicate sends
let galleryPositionHintThrottle = null; // Throttle for position hints

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
let infiniteScrollLoading = document.getElementById('infiniteScrollLoading');

const galleryToggleGroup = document.getElementById('galleryToggleGroup');

// Gallery view switching progress modal
let galleryProgressModal = null;
let galleryProgressToastId = null;
let galleryProgressBarElement = null;
let galleryProgressTextElement = null;
let galleryProgressContainerElement = null;
let galleryProgressModeSwitched = false; // Track if we've switched from marquee to animate mode

// IndexedDB utilities for gallery metadata caching
class GalleryMetadataCache {
    constructor() {
        this.dbName = 'StaticForgeGallery';
        this.version = 1;
        this.db = null;
        this.initPromise = this.initDB();
    }

    async initDB() {
        return new Promise((resolve, reject) => {
            const request = indexedDB.open(this.dbName, this.version);

            request.onerror = () => {
                console.warn('IndexedDB not available, falling back to memory-only caching');
                resolve(null);
            };

            request.onsuccess = (event) => {
                this.db = event.target.result;
                resolve(this.db);
            };

            request.onupgradeneeded = (event) => {
                const db = event.target.result;

                // Create object store for metadata by base filename
                if (!db.objectStoreNames.contains('metadata')) {
                    const metadataStore = db.createObjectStore('metadata', { keyPath: 'base' });
                    metadataStore.createIndex('mtime', 'mtime', { unique: false });
                }

                // Create object store for thumbnails
                if (!db.objectStoreNames.contains('thumbnails')) {
                    db.createObjectStore('thumbnails', { keyPath: 'base' });
                }
            };
        });
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
            const request = store.put({ base, data: thumbnailData });

            request.onsuccess = () => resolve();
            request.onerror = () => resolve();
        });
    }

    async clearOldEntries(maxAge = 7 * 24 * 60 * 60 * 1000) { // 7 days
        if (!this.db) return;
        const cutoff = Date.now() - maxAge;

        return new Promise((resolve) => {
            const transaction = this.db.transaction(['metadata'], 'readwrite');
            const store = transaction.objectStore('metadata');
            const index = store.index('mtime');
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
                    console.log(`🧹 Cleaned up ${deleted} old gallery metadata entries`);
                    resolve();
                }
            };
            request.onerror = () => resolve();
        });
    }
}

// Global gallery metadata cache instance
const galleryMetadataCache = new GalleryMetadataCache();


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
    if (placeholderResolutionQueue.length === 0) {
        placeholderWatcherRunning = false;
        placeholderWatcherFrameId = null;
        placeholderResolutionDelay = 0;
        placeholderResolutionFrameCount = 0;
        placeholderQueueSizeHistory = [];
        return;
    }

    // Pause resolution when actively scrolling
    if (isScrolling) {
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

    // Prioritize placeholders based on scroll direction when scrolling recently stopped
    if (Math.abs(scrollVelocity) > 0.5) {
        // Sort queue to prioritize based on scroll direction
        const viewportCenter = viewportTop + (window.innerHeight / 2);

        placeholderResolutionQueue.sort((a, b) => {
            if (!a.element || !b.element) return 0;

            const aRect = a.element.getBoundingClientRect();
            const bRect = b.element.getBoundingClientRect();
            const aTop = aRect.top + window.pageYOffset;
            const bTop = bRect.top + window.pageYOffset;

            if (scrollVelocity > 0) {
                // Scrolling down - prioritize items below viewport center
                const aIsBelow = aTop > viewportCenter;
                const bIsBelow = bTop > viewportCenter;

                if (aIsBelow && !bIsBelow) return -1; // a comes first
                if (bIsBelow && !aIsBelow) return 1;  // b comes first
                return 0; // same priority
            } else {
                // Scrolling up - prioritize items above viewport center
                const aIsAbove = aTop < viewportCenter;
                const bIsAbove = bTop < viewportCenter;

                if (aIsAbove && !bIsAbove) return -1; // a comes first
                if (bIsAbove && !aIsAbove) return 1;  // b comes first
                return 0; // same priority
            }
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
    const queueLimit = currentCapacity + (multiplexingLevel * 5); // Base capacity + multiplexing buffer

    // Don't add to queue if we're already at capacity
    if (placeholderResolutionQueue.length >= queueLimit) {
        return;
    }

    placeholderResolutionQueue.push({ element, fileImageIndex, filteredIndex });
    if (!placeholderWatcherRunning) {
        startPlaceholderWatcher();
    }
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

// Apply a provided image list to the gallery without fetching from server (used by search)
// IMPORTANT: allImages should ALWAYS be the full array, never filtered
// filteredImageIndices maps filtered position -> original file index in allImages
// We NEVER replace allImages with filtered array - we always access allImages[filteredImageIndices[filteredIndex]]
window.applyFilteredImages = function (images, originalIndices = null) {
    try {
        // Store original allImages if we don't have it yet (for filtering)
        // allImages should remain the full array, never be replaced with filtered array
        if (!window.originalAllImages || window.originalAllImages.length === 0) {
            window.originalAllImages = [...allImages]; // Preserve the full array
        } else {
            // Restore allImages to the full array if it was previously filtered
            // This ensures allImages is always the full array
            allImages = [...window.originalAllImages];
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
        updateGalleryTitleBar();
        updateGalleryPlaceholders();
    } catch (e) {
        console.error('Error applying filtered images:', e);
    }
};

// Gallery view switching progress functions
function showGalleryProgressModal(viewType) {
    const viewName = viewType.charAt(0).toUpperCase() + viewType.slice(1);

    if (!window.isDesktop) {
        // Fall back to toast for non-desktop mode
        galleryProgressToastId = showGlassToast('info', 'Loading', `Loading ${viewName} gallery...`, false, false, '<img class="loading" src="/static_images/azuspin.gif" alt="Loading" style="width: 34px; height: 34px;">');
        return;
    }

    // Create progress modal using confirmation dialog
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

    // Create synthetic event to center modal over gallery window
    const galleryWindow = document.getElementById('galleryWindow');
    let syntheticEvent = null;
    if (galleryWindow) {
        const rect = galleryWindow.getBoundingClientRect();
        syntheticEvent = {
            clientX: rect.left + rect.width / 2,
            clientY: rect.top + rect.height / 2,
            target: galleryWindow
        };
    }

    galleryProgressModal = showConfirmationDialog(
        progressHtml,
        [], // No buttons - this is a progress modal
        syntheticEvent, // Synthetic event to center over gallery
        {
            title: `Dreamscape Workspace`,
            icon: 'fas fa-film-canister',
            showCloseButton: false,
            width: '375px'
        }
    );

    // Store references to progress elements after modal is created
    setTimeout(() => {
        galleryProgressBarElement = document.getElementById('galleryProgressBar');
        galleryProgressTextElement = document.getElementById('galleryProgressText');
        galleryProgressContainerElement = galleryProgressBarElement ? galleryProgressBarElement.parentElement : null;
    }, 100);
}

// Show gallery loading progress modal (for general gallery loading, not view switching)
function showGalleryLoadingProgressModal() {
    if (!window.isDesktop) {
        // Fall back to toast for non-desktop mode
        galleryProgressToastId = showGlassToast('info', 'Loading', 'Loading gallery...', false, false, '<img class="loading" src="/static_images/azuspin.gif" alt="Loading" style="width: 34px; height: 34px;">');
        return;
    }

    // Create progress modal using confirmation dialog
    const progressHtml = `
        <div style="text-align: left; display: flex; flex-direction: column; gap: 8px;">
            <div role="progressbar" class="marquee animate" aria-valuemin="0" aria-valuemax="100" aria-valuenow="0" aria-label="Gallery loading progress">
                <div id="galleryLoadingProgressBar"></div>
            </div>
            <div id="galleryLoadingProgressText" style="display: flex; justify-content: space-between; align-items: center;">
                <span style="color: var(--text-accent);">Gallery</span>
                <span style="color: var(--text-accent-tinted);">Loading...</span>
            </div>
        </div>
    `;

    galleryProgressModal = showConfirmationDialog(
        progressHtml,
        [], // No buttons - this is a progress modal
        null, // No event - will use bottom-right positioning
        {
            title: 'Dreamscape Workspace',
            icon: 'fas fa-film-canister',
            showCloseButton: false,
            width: '375px',
            position: 'bottom-right',
            leftPadding: 20,
            bottomPadding: 20
        }
    );

    // Store references to progress elements after modal is created
    setTimeout(() => {
        galleryProgressBarElement = document.getElementById('galleryLoadingProgressBar');
        galleryProgressTextElement = document.getElementById('galleryLoadingProgressText');
        galleryProgressContainerElement = galleryProgressBarElement ? galleryProgressBarElement.parentElement : null;
    }, 100);
}

function updateGalleryProgress(progress) {
    if (!galleryProgressModal && !galleryProgressToastId) return;

    // Switch from marquee mode to determinate progress mode on first progress update
    if (!galleryProgressModeSwitched && galleryProgressContainerElement) {
        galleryProgressContainerElement.classList.remove('marquee');
        galleryProgressModeSwitched = true;
    }

    if (galleryProgressBarElement && galleryProgressTextElement) {
        const percent = Math.round(progress.progress * 100);
        galleryProgressBarElement.style.width = `${percent}%`;

        // Update ARIA attributes for accessibility
        if (galleryProgressContainerElement && galleryProgressContainerElement.hasAttribute('role') && galleryProgressContainerElement.getAttribute('role') === 'progressbar') {
            galleryProgressContainerElement.setAttribute('aria-valuenow', percent);
        }

        const statusSpan = galleryProgressTextElement.querySelector('span:last-child');
        if (statusSpan) {
            if (progress.phase === 'initial') {
                statusSpan.textContent = `Loading Gallery (${progress.loaded}/${progress.total || 'unknown'})`;
            } else {
                statusSpan.textContent = `Please Wait (${progress.loaded}/${progress.total || 'unknown'})`;
            }
        }
    } else {
        // Fallback: try to find elements if not stored yet
        const progressBar = document.getElementById('galleryProgressBar');
        const progressText = document.getElementById('galleryProgressText');
        const progressContainer = progressBar ? progressBar.parentElement : null;

        // Switch from marquee mode to determinate progress mode on first progress update
        if (!galleryProgressModeSwitched && progressContainer) {
            progressContainer.classList.remove('marquee');
            galleryProgressModeSwitched = true;
        }

        if (progressBar && progressText) {
            const percent = Math.round(progress.progress * 100);
            progressBar.style.width = `${percent}%`;

            if (progressContainer && progressContainer.hasAttribute('role') && progressContainer.getAttribute('role') === 'progressbar') {
                progressContainer.setAttribute('aria-valuenow', percent);
            }

            const statusSpan = progressText.querySelector('span:last-child');
            if (statusSpan) {
                if (progress.phase === 'initial') {
                    statusSpan.textContent = `Loading Gallery (${progress.loaded}/${progress.total || 'unknown'})`;
                } else {
                    statusSpan.textContent = `Please Wait (${progress.loaded}/${progress.total || 'unknown'})`;
                }
            }
        }
    }
}

// Update gallery loading progress (for general gallery loading, not view switching)
function updateGalleryLoadingProgress(progress) {
    if (!galleryProgressModal && !galleryProgressToastId) return;

    // Switch from marquee mode to determinate progress mode on first progress update
    if (!galleryProgressModeSwitched && galleryProgressContainerElement) {
        galleryProgressContainerElement.classList.remove('marquee');
        galleryProgressModeSwitched = true;
    }

    if (galleryProgressBarElement && galleryProgressTextElement) {
        const percent = Math.round(progress.progress * 100);
        galleryProgressBarElement.style.width = `${percent}%`;

        // Update ARIA attributes for accessibility
        if (galleryProgressContainerElement && galleryProgressContainerElement.hasAttribute('role') && galleryProgressContainerElement.getAttribute('role') === 'progressbar') {
            galleryProgressContainerElement.setAttribute('aria-valuenow', percent);
        }

        const statusSpan = galleryProgressTextElement.querySelector('span:last-child');
        if (statusSpan) {
            statusSpan.textContent = `Loading (${progress.loaded}/${progress.total || 'unknown'})`;
        }
    } else {
        // Fallback: try to find elements if not stored yet
        const progressBar = document.getElementById('galleryLoadingProgressBar');
        const progressText = document.getElementById('galleryLoadingProgressText');
        const progressContainer = progressBar ? progressBar.parentElement : null;

        // Switch from marquee mode to determinate progress mode on first progress update
        if (!galleryProgressModeSwitched && progressContainer) {
            progressContainer.classList.remove('marquee');
            galleryProgressModeSwitched = true;
        }

        if (progressBar && progressText) {
            const percent = Math.round(progress.progress * 100);
            progressBar.style.width = `${percent}%`;

            if (progressContainer && progressContainer.hasAttribute('role') && progressContainer.getAttribute('role') === 'progressbar') {
                progressContainer.setAttribute('aria-valuenow', percent);
            }

            const statusSpan = progressText.querySelector('span:last-child');
            if (statusSpan) {
                statusSpan.textContent = `Loading (${progress.loaded}/${progress.total || 'unknown'})`;
            }
        }
    }
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
    // Clear filtered indices when reloading
    if (window.filteredImageIndices) {
        delete window.filteredImageIndices;
    }

    currentGalleryView = view;

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

    // Create combined progress callback
    const combinedProgressCallback = progressCallback ? (progress) => {
        // Call workspace progress callback if provided
        if (progressCallback) {
            progressCallback(progress);
        }
        // Call gallery progress if we're showing gallery progress
        if (galleryProgressShown) {
            updateGalleryProgress(progress);
        }
    } : galleryProgressShown ? updateGalleryProgress : null;

    // Handle view-specific logic
    switch (view) {
        case 'scraps':
            document.body.classList.add('scraps-grayscale');
            await loadScraps(combinedProgressCallback);
            break;
        case 'images':
            document.body.classList.remove('scraps-grayscale');
            await loadGallery(false, combinedProgressCallback);
            break;
        case 'pinned':
            document.body.classList.remove('scraps-grayscale');
            await loadPinned(combinedProgressCallback);
            break;
        case 'upscaled':
            document.body.classList.remove('scraps-grayscale');
            await loadUpscaled(combinedProgressCallback);
            break;
    }

    updateGalleryTitleBar();

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
}

// Load scraps for current workspace
async function loadScraps(progressCallback = null) {
    try {
        // Load complete scraps gallery
        if (window.wsClient && window.wsClient.isConnected()) {
            await loadCompleteGallery('scraps', progressCallback);

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Only build cache if not in search mode
            if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
                buildGalleryNavigationCache(allImages);
            }

            if (!isJumpingToPosition) {
                displayCurrentPageOptimized();
            }
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading scraps:', error);
        allImages = [];
        if (!isJumpingToPosition) {
            resetInfiniteScroll();
            displayCurrentPageOptimized();
        }
    }
}

// Load pinned images for current workspace
async function loadPinned(progressCallback = null) {
    try {
        // Load complete pinned gallery
        if (window.wsClient && window.wsClient.isConnected()) {
            await loadCompleteGallery('pinned', progressCallback);

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Build navigation cache after sorting
            buildGalleryNavigationCache(allImages);

            if (!isJumpingToPosition) {
                displayCurrentPageOptimized();
            }
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading pinned images:', error);
        allImages = [];
        if (!isJumpingToPosition) {
            resetInfiniteScroll();
            displayCurrentPageOptimized();
        }
    }
}

// Load upscaled images for current workspace
async function loadUpscaled(progressCallback = null) {
    try {
        // Load complete upscaled gallery
        if (window.wsClient && window.wsClient.isConnected()) {
            await loadCompleteGallery('upscaled', progressCallback);

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Build navigation cache after sorting
            buildGalleryNavigationCache(allImages);

            if (!isJumpingToPosition) {
                displayCurrentPageOptimized();
            }
        } else {
            throw new Error('WebSocket not connected');
        }
        updateGalleryPlaceholders();
    } catch (error) {
        console.error('Error loading upscaled images:', error);
        allImages = [];
        if (!isJumpingToPosition) {
            resetInfiniteScroll();
            displayCurrentPageOptimized();
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
async function loadGallery(addLatest, progressCallback = null) {
    // Check if spinner already exists (added in step 89)
    const spinner = document.getElementById('galleryLoadingSpinner');

    try {
        // Handle addLatest case (add new item without full reload)
        if (addLatest && allImages.length > 0) {
            // Fetch the latest item and add it to the gallery
            const result = await window.wsClient.requestGallery('images', true, {
                offset: 0,
                limit: 1,
                light: false
            });
            const { gallery: latestItems } = result.data || result;

            if (latestItems && latestItems.length > 0) {
                allImages.unshift(latestItems[0]);

                // Sort and update caches
                sortGalleryData();
                if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
                    buildGalleryNavigationCache(allImages);
                }
            }

            document.dispatchEvent(new CustomEvent('galleryUpdated'));

            const isGalleryHidden = isGalleryWindowHidden();
            if (!isGalleryHidden && !isJumpingToPosition) {
                await addNewGalleryItemAfterGeneration(allImages[0]);
            }

            if (window.workspaceLoadingCompleteCallback) {
                window.workspaceLoadingCompleteCallback();
            }

            spinner.classList.add('hidden');
            return;
        }

        // Load complete gallery by getting all pages
        if (window.wsClient && window.wsClient.isConnected()) {
            // Show progress modal in desktop mode for full gallery loads
            if (window.isDesktop && !progressCallback) {
                showGalleryLoadingProgressModal();
                progressCallback = updateGalleryLoadingProgress;
            }

            await loadCompleteGallery('images', progressCallback);

            // Apply current sort order to the loaded data
            sortGalleryData();

            // Only build cache if not in search mode (search mode will build cache after Enter is pressed)
            if (!window.filteredImageIndices || window.filteredImageIndices.length === allImages.length) {
                buildGalleryNavigationCache(allImages);
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
                } else {
                    // Reset infinite scroll state and display initial batch
                    clearSelection(); // Clear selection when reloading gallery
                    resetInfiniteScroll();
                    displayCurrentPageOptimized();
                }
            }

            // Hide progress modal if it was shown
            if (window.isDesktop && !progressCallback) {
                hideGalleryProgressModal();
            }

            spinner.classList.add('hidden');

            // Set first gallery image in Android persistent notification when bridge is present
            if (allImages.length > 0 && typeof setAndroidNotificationImageFromImage === 'function') {
                setAndroidNotificationImageFromImage(allImages[0]);
            }

            // Call workspace completion callback if it exists (for workspace switching)
            if (window.workspaceLoadingCompleteCallback) {
                window.workspaceLoadingCompleteCallback();
            }
        } else {
            throw new Error('WebSocket not connected');
        }
    } catch (error) {
        console.error('Error loading gallery:', error);
        // Don't throw error for gallery loading failure
        allImages = [];

        // Hide progress modal if it was shown
        if (window.isDesktop && !progressCallback) {
            hideGalleryProgressModal();
        }

        spinner.classList.add('hidden');

        // Check if gallery is hidden in desktop mode
        const isGalleryHidden = isGalleryWindowHidden();

        // Only update gallery display if manual modal is not open and gallery is not hidden
        if (!isGalleryHidden) {
            displayCurrentPageOptimized();
        }

        // Call workspace completion callback if it exists (for workspace switching)
        if (window.workspaceLoadingCompleteCallback) {
            window.workspaceLoadingCompleteCallback();
        }
    }
}

// Load gallery chunk with metadata
async function loadGalleryChunk(viewType = 'images', offset = 0, limit = 100) {
    const result = await window.wsClient.requestGallery(viewType, true, {
        offset: offset, limit: limit, light: false
    });

    const { gallery: chunk, pagination } = result.data || result;
    return {
        chunk: chunk || [],
        hasMore: pagination?.hasMore || false,
        total: pagination?.totalItems || 0
    };
}

// Load complete gallery by getting all pages and building allImages locally
async function loadCompleteGallery(viewType = 'images', progressCallback = null) {
    const spinner = document.getElementById('galleryLoadingSpinner');

    try {

        let dataItems = [];
        let offset = 0;
        const chunkSize = 750; // Larger chunks for efficiency
        let chunkCount = 0;
        let totalItems = 0;

        // First pass: determine total items count for progress calculation
        if (progressCallback) {
            const firstChunk = await loadGalleryChunk(viewType, 0, 1);
            if (firstChunk.total > 0) {
                totalItems = firstChunk.total;
            } else if (firstChunk.chunk && firstChunk.chunk.length > 0) {
                // Fallback to estimating from chunk size if total not provided
                totalItems = firstChunk.chunk.length;
            }
        }

        // Load all chunks - progress system handles when to stop/switch phases
        let loadedItems = 0;

        // Load chunks until no more data or progress system indicates to stop
        while (true) {
            chunkCount++;

            const { chunk, hasMore, total } = await loadGalleryChunk(viewType, offset, chunkSize);

            // Update total if we got it from this chunk
            if (total > 0 && totalItems === 0) {
                totalItems = total;
            }

            if (!chunk || chunk.length === 0) {
                break;
            }

            dataItems.push(...chunk);
            loadedItems += chunk.length;
            offset += chunkSize;

            // Update total estimate as we load
            if (progressCallback && loadedItems > totalItems) {
                totalItems = loadedItems;
            }

            // Report progress if callback provided
            if (progressCallback && totalItems > 0) {
                const progressRatio = loadedItems / totalItems;
                progressCallback({
                    loaded: loadedItems,
                    total: totalItems,
                    offset: offset,
                    progress: progressRatio,
                    phase: progressRatio < 0.75 ? 'initial' : 'remaining'
                });
            }

            if (!hasMore) {
                break;
            }

            // Small delay to avoid overwhelming server
            await new Promise(resolve => setTimeout(resolve, 10));
        }

        // Set up gallery state with loaded data
        allImages = dataItems;

    } catch (error) {
        console.error('Error loading complete gallery:', error);
        throw error;
    }
}

// Add a new gallery item after generation with fade-in and slide-in animations
async function addNewGalleryItemAfterGeneration(newImage) {
    // Don't add new gallery items if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't add new gallery items if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Create gallery item with placeholder class and fade-in
    const newItem = createGalleryItem(newImage, 0);
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
    newItem.classList.add('slide-in');
    newItem.addEventListener('animationend', function handler() {
        newItem.classList.remove('slide-in');
        newItem.removeEventListener('animationend', handler);
    });
    reindexGallery();
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
        Array.from(gallery.querySelectorAll('.gallery-placeholder')).forEach(el => el.remove());
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
        // Use preview image - encode the preview name to handle spaces and special characters
        img = document.createElement('img');
        const previewUrl = getGalleryPreviewUrl(image.preview);
        img.alt = image.base;
        img.loading = 'lazy';
        img.classList.add('loading-image');

        img.onload = function () {
            // Image loaded successfully - will be shown via CSS transition when placeholder class is removed
            img.classList.remove('loading-image');
        };

        // Check if image is already cached/loaded (complete property)
        // If so, set src immediately, otherwise wait for onload
        img.src = `/previews/${encodeURIComponent(previewUrl)}`;

        // If image fails to load, keep it hidden
        img.onerror = function () {
            // Keep image hidden when it fails to load
            this.onerror = null; // Prevent infinite loop
            img.src = '';
        };
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
    copyBtn.onclick = async (e) => {
        e.stopPropagation();
        try {
            // Determine the correct URL for the image
            let imageUrl;
            if (image.url) {
                // For newly generated images
                imageUrl = image.url;
            } else {
                // For gallery images - prefer highest quality version
                const filename = image.upscaled || image.original;
                imageUrl = `/images/${filename}`;
            }

            // Fetch the image as a blob
            const response = await fetch(imageUrl);
            const blob = await response.blob();

            // Copy to clipboard
            await navigator.clipboard.write([
                new ClipboardItem({
                    [blob.type]: blob
                })
            ]);

            // Calculate and format file size
            const sizeInBytes = blob.size;
            let sizeText;
            if (sizeInBytes < 1024 * 1024) {
                sizeText = `${(sizeInBytes / 1024).toFixed(1)} KB`;
            } else {
                sizeText = `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
            }

            // Show success notification with size
            if (window.showGlassToast) {
                window.showGlassToast('success', 'Image copied to clipboard!', `(${sizeText})`, false, 3000, '<i class="fas fa-clipboard-check"></i>');
            }
        } catch (error) {
            console.error('Failed to copy image to clipboard:', error);
            if (window.showGlassToast) {
                window.showGlassToast('error', 'Failed to copy image to clipboard', '', false, 3000, '<i class="fas fa-clipboard"></i>');
            }
        }
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
                            disabled: true
                        },
                        { separator: true },
                        {
                            icon: 'fas fa-person-to-portal',
                            text: 'Create Chat',
                            action: 'start-chat'
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
    const absScrollVelocity = Math.abs(scrollVelocity || 0);
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

    // Create img element (same logic as in createGalleryItem)
    const img = document.createElement('img');
    const previewUrl = getGalleryPreviewUrl(image.preview);
    img.alt = image.base;
    img.classList.add('loading-image');
    img.loading = 'lazy';

    img.onload = function () {
        img.onload = null;
        img.classList.remove('loading-image');
        if (typeof onComplete === 'function') {
            onComplete();
        }
    };
    img.onerror = function () {
        img.onerror = null; // Prevent infinite loop
        if (typeof onComplete === 'function') {
            onComplete();
        }
    };

    img.src = `/previews/${encodeURIComponent(previewUrl)}`;

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

    // Detect if we're scrolling in a container or window
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');

    let scrollTop, containerHeight, scrollHeight;

    if (isContainerScroll) {
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

    // Detect scroll container (gallery-container is always used when available)
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');

    visibleItems.clear();
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');

    let viewportTop, viewportBottom;
    if (isContainerScroll && galleryContainer) {
        // Desktop modal mode - use container dimensions
        viewportTop = galleryContainer.scrollTop;
        viewportBottom = viewportTop + galleryContainer.clientHeight;
    } else {
        // Mobile/normal mode - use window dimensions, accounting for --true-inset-top
        const trueInsetTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--true-inset-top')) || 0;
        viewportTop = (window.pageYOffset || document.documentElement.scrollTop) + trueInsetTop;
        viewportBottom = viewportTop + (window.innerHeight - trueInsetTop);
    }

    let firstVisibleIndex = null;
    items.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        let isVisible = false;

        if (isContainerScroll && galleryContainer) {
            // For container scroll, check if item is within container bounds
            const containerRect = galleryContainer.getBoundingClientRect();
            const itemTopRelativeToContainer = rect.top - containerRect.top + galleryContainer.scrollTop;
            const itemBottomRelativeToContainer = rect.bottom - containerRect.top + galleryContainer.scrollTop;

            // Check if item is visible in container viewport
            if (itemBottomRelativeToContainer > viewportTop && itemTopRelativeToContainer < viewportBottom) {
                isVisible = true;
            }
        } else {
            // For window scroll, use window coordinates
            const itemTop = rect.top + window.pageYOffset;
            const itemBottom = rect.bottom + window.pageYOffset;

            // Check if item is visible in viewport
            if (itemBottom > viewportTop && itemTop < viewportBottom) {
                isVisible = true;
            }
        }

        if (isVisible) {
            visibleItems.add(index);
            // Track first visible index
            if (firstVisibleIndex === null) {
                firstVisibleIndex = index;
            }
        }
    });

    // Update current visible index for title bar
    if (firstVisibleIndex !== null) {
        currentVisibleIndex = firstVisibleIndex;
        updateGalleryTitleBar();
    }
}

/**
 * Update gallery window title bar
 */
function updateGalleryTitleBar() {
    const galleryWindow = document.querySelector('#galleryWindow');
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

    titleElement.innerHTML = title;
    updateTaskbarWindows()
}

/**
 * Get the index of the first visible row in the gallery
 * Returns the filtered index (position in current array, not allImages)
 */
function getFirstVisibleRowIndex() {
    if (!gallery) return 0;

    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    if (items.length === 0) return 0;

    // Detect scroll container
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');

    let viewportTop;
    if (isContainerScroll && galleryContainer) {
        viewportTop = galleryContainer.scrollTop;
    } else {
        viewportTop = window.pageYOffset || document.documentElement.scrollTop;
    }

    // Find the first item that's visible (at least partially)
    for (let i = 0; i < items.length; i++) {
        const item = items[i];
        const rect = item.getBoundingClientRect();

        let itemTop;
        if (isContainerScroll && galleryContainer) {
            const containerRect = galleryContainer.getBoundingClientRect();
            itemTop = rect.top - containerRect.top + galleryContainer.scrollTop;
        } else {
            itemTop = rect.top + window.pageYOffset;
        }

        // Check if item is at least partially visible
        if (itemTop < viewportTop + 100) { // 100px tolerance
            const index = parseInt(item.dataset.index);
            if (!isNaN(index)) {
                return index;
            }
        }
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

    // Collect only complete rows in a single pass
    const placeholdersToRemove = [];
    for (const placeholdersInRow of placeholdersByRow.values()) {
        if (placeholdersInRow.length >= currentItemsPerRow) {
            placeholdersToRemove.push(...placeholdersInRow);
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

    // Update visible items first to get current state
    updateVisibleItems();

    // Get viewport bounds for prioritization
    const viewportTop = window.pageYOffset;
    const viewportBottom = viewportTop + window.innerHeight;

    let queuedCount = 0;
    placeholders.forEach(placeholder => {
        const itemIndex = parseInt(placeholder.dataset.index || '0');

        // Only queue placeholders that are actually visible in the viewport
        if (visibleItems.has(itemIndex)) {
            const rect = placeholder.getBoundingClientRect();
            const elementTop = viewportTop + rect.top;
            const elementBottom = viewportTop + rect.bottom;

            // Prioritize placeholders that are actually in viewport
            const isInViewport = elementTop < viewportBottom && elementBottom > viewportTop;

            if (isInViewport) {
                const fileIndex = parseInt(placeholder.dataset.fileIndex);
                const filteredIndex = itemIndex; // Use the display index

                // Add to the existing placeholder resolution queue
                queuePlaceholderResolution(placeholder, fileIndex, filteredIndex);
                queuedCount++;
            }
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
        const timeDelta = now - lastScrollTime;
        const scrollDelta = currentScrollTop - lastScrollTop;
        scrollVelocity = scrollDelta / timeDelta;
    }

    lastScrollTime = now;
    lastScrollTop = currentScrollTop;

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
    const galleryWindow = document.querySelector('#galleryWindow');
    const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
    const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');

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

    // Don't update virtual scroll if manual modal is open and maximized
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Don't update virtual scroll if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

    // Throttle virtual scroll updates for better performance with many items
    if (virtualScrollThrottle) {
        clearTimeout(virtualScrollThrottle);
        virtualScrollThrottle = null;
    }
    virtualScrollThrottle = setTimeout(() => {
        updateVirtualScrollInternal();
    }, 16);
}

function updateVirtualScrollInternal() {
    // Cache DOM queries for better performance with many items
    const items = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const total = items.length;

    // Early return if no items to process
    if (total === 0) return;

    // First, update visible items tracking
    updateVisibleItems();

    // Detect fast scrolling and adjust buffer size accordingly
    const isRapidScrolling = Math.abs(scrollVelocity) > 3; // Increased threshold for rapid scrolling
    const isVeryFastScrolling = Math.abs(scrollVelocity) > 6; // Threshold for very fast scrolling

    const rowsPerPage = galleryRows
    const visibleIndices = Array.from(visibleItems);

    if (visibleIndices.length === 0) return;

    // Calculate actual rows visible on screen based on viewport
    let rowsOnScreen = rowsPerPage;
    if (rowsOnScreen < 3) rowsOnScreen = 3; // Minimum fallback

    // Calculate actual item height for accurate row calculations
    let itemHeight = window.innerHeight / rowsOnScreen; // Rough estimate
    const sampleItem = gallery.querySelector('.gallery-item, .gallery-placeholder');
    if (sampleItem) {
        const sampleRect = sampleItem.getBoundingClientRect();
        if (sampleRect.height > 0) {
            itemHeight = sampleRect.height;
            // Recalculate rows based on actual item height
            const viewportHeight = window.innerHeight;
            rowsOnScreen = Math.floor(viewportHeight / itemHeight);
            if (rowsOnScreen < 3) rowsOnScreen = 3;
        }
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

    const minVisible = Math.min(...visibleIndices);
    const maxVisible = Math.max(...visibleIndices);

    // Adjust buffer based on scroll velocity - use larger buffer to prevent flickering
    // Increased buffer: 2-4 rows instead of 0.5-1 rows
    const bufferMultiplier = isRapidScrolling ? 2 : 6;
    const minKeep = Math.max(0, minVisible - Math.floor(realGalleryColumns * bufferMultiplier));
    const maxKeep = Math.min(total - 1, maxVisible + Math.floor(realGalleryColumns * bufferMultiplier));

    // Use unified buffer size calculation
    const bufferSize = calculatePlaceholderBufferSize(scrollVelocity, rowsOnScreen);

    // Track items that need placeholder state - keep as gallery-item elements, just add/remove placeholder class
    // Use data-index instead of DOM position for accurate index tracking after reindexing
    for (let i = 0; i < total; i++) {
        const el = items[i];
        const isGalleryItem = el.classList.contains('gallery-item');
        const hasPlaceholderClass = el.classList.contains('gallery-placeholder');

        // Get the actual index from data-index attribute (not DOM position)
        const itemIndex = parseInt(el.dataset.index || i.toString());

        if (i < minKeep || i > maxKeep) {
            // Items far from viewport - add placeholder class for tracking, but keep as gallery-item
            // Don't convert items created during jump operations (they should stay as real items)
            if (isGalleryItem && !hasPlaceholderClass) {
                el.classList.add('gallery-placeholder');
                // Remove the img element to save memory (placeholders don't need img elements)
                removeImgFromGalleryItem(el);
            }
        } else {
            // Items near viewport - remove placeholder class and resolve
            const isItemVisible = visibleItems.has(i);

            // Check for predictive loading: items near viewport but not fully visible
            let isItemNearViewport = isItemVisible;
            if (!isItemNearViewport && hasPlaceholderClass) {
                // Calculate predictive buffer based on item height and scroll direction
                const itemRect = el.getBoundingClientRect();
                const itemHeight = itemRect.height || window.innerHeight / 5; // fallback estimate
                const predictiveBuffer = itemHeight * 2; // Load items 2 rows away

                // Get viewport bounds
                const galleryWindow = document.querySelector('#galleryWindow');
                const galleryContainer = galleryWindow ? galleryWindow.querySelector('.gallery-container') : null;
                const isContainerScroll = galleryContainer && document.body.classList.contains('desktop-mode');

                let viewportTop, viewportBottom;
                if (isContainerScroll && galleryContainer) {
                    viewportTop = galleryContainer.scrollTop;
                    viewportBottom = viewportTop + galleryContainer.clientHeight;
                } else {
                    const trueInsetTop = parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--true-inset-top')) || 0;
                    viewportTop = (window.pageYOffset || document.documentElement.scrollTop) + trueInsetTop;
                    viewportBottom = viewportTop + (window.innerHeight - trueInsetTop);
                }

                // Calculate item position
                let itemTop, itemBottom;
                if (isContainerScroll && galleryContainer) {
                    const containerRect = galleryContainer.getBoundingClientRect();
                    itemTop = itemRect.top - containerRect.top + galleryContainer.scrollTop;
                    itemBottom = itemRect.bottom - containerRect.top + galleryContainer.scrollTop;
                } else {
                    itemTop = itemRect.top + window.pageYOffset;
                    itemBottom = itemRect.bottom + window.pageYOffset;
                }

                // Check if item is within predictive buffer
                const isAboveViewport = itemBottom > viewportTop - predictiveBuffer && itemTop < viewportTop;
                const isBelowViewport = itemTop < viewportBottom + predictiveBuffer && itemBottom > viewportBottom;

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

    // Check if user is near the bottom and might want to scroll further down
    const isNearBottom = window.pageYOffset + window.innerHeight > document.documentElement.scrollHeight - 200;

    allPlaceholders.forEach(placeholder => {
        // Use data-index instead of DOM position for accurate index tracking after reindexing
        const idx = parseInt(placeholder.dataset.index || '0');

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

    // During fast scrolling, only add placeholders in the scroll direction
    const skipAddingAbove = isFastScrolling && fastScrollDirection === 1; // Scrolling down = don't add above
    const skipAddingBelow = isFastScrolling && fastScrollDirection === -1; // Scrolling up = don't add below

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
    // Recompute visible/buffered range after any placeholder changes
    const updatedItems = gallery.querySelectorAll('.gallery-item, .gallery-placeholder');
    const updatedTotal = updatedItems.length;
    // Recompute visible indices
    const viewportTop = window.pageYOffset;
    const viewportBottom = viewportTop + window.innerHeight;
    let updatedVisible = new Set();
    updatedItems.forEach((item, index) => {
        const rect = item.getBoundingClientRect();
        const itemTop = rect.top + window.pageYOffset;
        const itemBottom = rect.bottom + window.pageYOffset;
        if (itemBottom > viewportTop && itemTop < viewportBottom) {
            updatedVisible.add(index);
        }
    });
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
}

// Remove image from gallery and add placeholder at the end
// Refresh the entire gallery display to ensure consistency
function refreshGalleryDisplay() {
    if (isGalleryWindowHidden()) return;
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return;

    // Clear current gallery
    if (gallery) {
        gallery.innerHTML = '';
    }

    // Reset scroll and display state
    resetInfiniteScroll();

    // Redisplay all items
    displayCurrentPageOptimized();

    // Update UI elements
    updateGalleryPlaceholders();
    updateGalleryTitleBar();
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

            // Also update originalAllImages if it exists
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
        itemsToRemove.forEach(item => item.remove());

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

    window.addEventListener('scroll', () => {
        updateScrollVelocity();
        throttledInfiniteScroll();
    });

    // Also listen to gallery container scroll (for desktop modal mode)
    const galleryContainer = document.querySelector('#galleryWindow .gallery-container');
    if (galleryContainer) {
        galleryContainer.addEventListener('scroll', () => {
            updateScrollVelocity(galleryContainer);
            throttledInfiniteScroll();
        });
    }
});

// Gallery sort order functions
function toggleGallerySortOrder() {
    // Toggle between desc (newest first) and asc (oldest first)
    gallerySortOrder = gallerySortOrder === 'desc' ? 'asc' : 'desc';
    gallerySortOrder = gallerySortOrder;

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

    // Sort the current gallery data
    sortGalleryData();

    // Re-render the gallery with new sort order
    resetInfiniteScroll();
    displayCurrentPageOptimized();
}

function sortGalleryData() {
    if (!allImages || allImages.length === 0) return;

    // Sort by modification time (mtime)
    allImages.sort((a, b) => {
        const timeA = a.mtime || 0;
        const timeB = b.mtime || 0;

        if (gallerySortOrder === 'desc') {
            return timeB - timeA; // Newest first
        } else {
            return timeA - timeB; // Oldest first
        }
    });
}

// Track current gallery refresh notification
let galleryRefreshNotificationId = null;

// Handle workspace image additions via WebSocket
document.addEventListener('workspaceImageAdded', async (event) => {
    const { workspaceId, imageFilenames } = event.detail;

    // Check if the gallery is visible and if we're viewing the images gallery
    if (!gallery || gallery.classList.contains('hidden') || currentGalleryView !== 'images') {
        return;
    }

    // Determine if we should auto-refresh or show a notification
    const shouldShowNotification = isSelectionMode || displayedStartIndex > 0;

    if (shouldShowNotification) {
        // Gallery is scrolled or in multi-select mode - show persistent notification
        const count = imageFilenames.length;
        const imageText = count === 1 ? 'image' : 'images';

        // Remove existing notification if present
        if (galleryRefreshNotificationId) {
            removeGlassToast(galleryRefreshNotificationId);
        }

        // Show persistent notification with refresh button
        galleryRefreshNotificationId = showGlassToast(
            'info',
            'New Images Available',
            `${count} new ${imageText} added to workspace`,
            false,
            0, // No timeout - persistent
            '<i class="fas fa-images"></i>',
            [
                {
                    text: 'Refresh Gallery',
                    className: 'btn-primary',
                    callback: () => {
                        // Refresh the gallery
                        switchGalleryView(currentGalleryView, true);
                        // Remove the notification
                        if (galleryRefreshNotificationId) {
                            removeGlassToast(galleryRefreshNotificationId);
                            galleryRefreshNotificationId = null;
                        }
                    }
                },
                {
                    text: 'Dismiss',
                    className: 'btn-secondary',
                    callback: () => {
                        // Just dismiss the notification
                        if (galleryRefreshNotificationId) {
                            removeGlassToast(galleryRefreshNotificationId);
                            galleryRefreshNotificationId = null;
                        }
                    }
                }
            ]
        );
    } else {
        scrollPositionPreservationEnabled = true;
        preserveScrollPosition();
        await loadGallery(true);
        restoreScrollPosition();
    }
});

// Display gallery starting from a specific index
function displayGalleryFromStartIndex(startIndex, highlightTargetItem = false) {
    if (!gallery) return;

    // Don't update gallery if gallery is hidden in desktop mode
    if (isGalleryWindowHidden()) return;

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
    isGalleryResetting = true;

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
        return;
    }

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

    // Update gallery grid first to ensure calculations are correct
    updateGalleryGrid(true, true); // onlyIfChanged=true, updatePlaceholders=true

    // IMPORTANT: Add placeholders ABOVE first, before adding target items
    // This ensures target items are positioned correctly from the start

    // Add placeholders above in complete rows only
    // Use unified buffer size calculation
    const adjustedBufferSize = calculatePlaceholderBufferSize(scrollVelocity, undefined, true);

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
                    // Scroll inside the gallery container (windowed mode)
                    const galleryRect = gallery.getBoundingClientRect();
                    const itemRect = targetItem.getBoundingClientRect();
                    const itemTopRelativeToGallery = itemRect.top - galleryRect.top;
                    const targetScrollTop = itemTopRelativeToGallery - scrollOffset;
                    galleryContainer.scrollTop = Math.max(0, targetScrollTop);
                } else {
                    // Scroll the window (normal/maximized mode)
                    const targetScrollTop = targetItem.offsetTop - scrollOffset;
                    window.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'instant' });
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
                                const galleryRect = gallery.getBoundingClientRect();
                                const itemRect = targetItem.getBoundingClientRect();
                                const itemTopRelativeToGallery = itemRect.top - galleryRect.top;
                                const targetScrollTop = itemTopRelativeToGallery - scrollOffset;
                                const currentScrollTop = galleryContainer.scrollTop;

                                if (Math.abs(currentScrollTop - targetScrollTop) > 10) {
                                    galleryContainer.scrollTop = Math.max(0, targetScrollTop);
                                    needsAdjustment = true;
                                }
                            } else {
                                // Use offsetTop for more reliable positioning
                                const currentScrollTop = window.pageYOffset || document.documentElement.scrollTop;
                                const targetScrollTop = targetItem.offsetTop - scrollOffset;

                                if (Math.abs(currentScrollTop - targetScrollTop) > 10) {
                                    window.scrollTo({ top: Math.max(0, targetScrollTop), behavior: 'instant' });
                                    needsAdjustment = true;
                                }
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

                            // Re-enable virtual scroll after user interaction (scroll, click, touch, etc.)
                            // This ensures virtual scroll doesn't interfere until user starts interacting
                            const reenableVirtualScroll = () => {

                                // Delay virtual scroll update to prevent immediate placeholder additions
                                // This prevents flickering from multiple placeholder additions
                                setTimeout(() => {
                                    updateVirtualScroll();
                                }, 200);

                                // Remove event listeners after first interaction
                                if (isContainerScroll && galleryContainer) {
                                    galleryContainer.removeEventListener('scroll', reenableVirtualScroll, { once: true });
                                } else {
                                    window.removeEventListener('scroll', reenableVirtualScroll, { once: true });
                                }
                                gallery.removeEventListener('click', reenableVirtualScroll, { once: true });
                                gallery.removeEventListener('touchstart', reenableVirtualScroll, { once: true });
                            };

                            // Wait a short delay before enabling interaction listeners
                            // This prevents immediate re-enabling from the scroll we just did
                            setTimeout(() => {
                                requestAnimationFrame(() => {
                                    isJumpingToPosition = false;
                                    resolveVisiblePlaceholders();
                                });
                                if (isContainerScroll && galleryContainer) {
                                    galleryContainer.addEventListener('scroll', reenableVirtualScroll, { once: true });
                                } else {
                                    window.addEventListener('scroll', reenableVirtualScroll, { once: true });
                                }
                                gallery.addEventListener('click', reenableVirtualScroll, { once: true });
                                gallery.addEventListener('touchstart', reenableVirtualScroll, { once: true });
                            }, 100);
                        } else {
                            // Target item not found, re-enable virtual scroll anyway
                            isJumpingToPosition = false;
                        }
                    });
                });
            } else {
                // Target item not found in first RAF, re-enable virtual scroll anyway
                isJumpingToPosition = false;
            }
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
            if (window.chatSystem) {
                window.chatSystem.openChatModal(filename, image.characterName || null);
            }
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
            // Open image data viewer window
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

                try {
                    // Get the filename from the gallery item (more reliable than stored index)
                    const filename = galleryItem.dataset.filename;
                    if (!filename) {
                        console.error('Could not determine filename for jump-to-image');
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
                        return;
                    }

                    // Jump to the image at the true index with highlight
                    displayGalleryFromStartIndex(trueIndex, true);

                } catch (error) {
                    console.error('Failed to jump to image:', error);
                    showGlassToast('error', 'Jump Failed', 'Could not jump to the selected image', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                } finally {
                    // Always reset flags
                    isJumpingToPosition = false;
                    isGalleryResetting = false;
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
function copyImageToClipboard(image) {
    // Copy image to clipboard directly
    (async () => {
        try {
            // Determine the correct URL for the image
            let imageUrl;
            if (image.url) {
                // For newly generated images
                imageUrl = image.url;
            } else {
                // For gallery images - prefer highest quality version
                const filename = image.upscaled || image.original;
                imageUrl = `/images/${filename}`;
            }

            // Fetch the image as a blob
            const response = await fetch(imageUrl);
            const blob = await response.blob();

            // Copy to clipboard
            await navigator.clipboard.write([
                new ClipboardItem({
                    [blob.type]: blob
                })
            ]);

            // Calculate and format file size
            const sizeInBytes = blob.size;
            let sizeText;
            if (sizeInBytes < 1024 * 1024) {
                sizeText = `${(sizeInBytes / 1024).toFixed(1)} KB`;
            } else {
                sizeText = `${(sizeInBytes / (1024 * 1024)).toFixed(1)} MB`;
            }

            // Show success notification with size
            if (window.showGlassToast) {
                window.showGlassToast('success', 'Image copied to clipboard!', `(${sizeText})`, false, 3000, '<i class="fas fa-clipboard-check"></i>');
            }
        } catch (error) {
            console.error('Failed to copy image to clipboard:', error);
            if (window.showGlassToast) {
                window.showGlassToast('error', 'Failed to copy image to clipboard', '', false, 3000, '<i class="fas fa-clipboard"></i>');
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
    // Get the image URL
    const filename = image.upscaled || image.original;
    const imageUrl = `/images/${filename}`;

    // Show unified upload modal in reference mode
    // Set the image URL in the modal
    const urlInput = document.getElementById('unifiedUploadUrlInput');
    if (urlInput) {
        urlInput.value = imageUrl;
    }

    // Trigger the modal to open in reference mode
    showUnifiedUploadModal();

    // Set the mode to reference
    unifiedUploadCurrentMode = 'reference';
    updateUnifiedUploadMode();
}

function createVibeEncodingFromImage(image) {
    // Get the image URL
    const filename = image.upscaled || image.original;
    const imageUrl = `/images/${filename}`;

    // Show unified upload modal in vibe mode
    // Set the image URL in the modal
    const urlInput = document.getElementById('unifiedUploadUrlInput');
    if (urlInput) {
        urlInput.value = imageUrl;
    }

    // Trigger the modal to open in vibe mode
    showUnifiedUploadModal();

    // Set the mode to vibe
    unifiedUploadCurrentMode = 'vibe';
    updateUnifiedUploadMode();
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
            // Get the clicked gallery item
            const clickedItem = target.closest('.gallery-item, .gallery-placeholder');
            if (!clickedItem) break;

            // Get the clicked item's filename and find its index in the actual image array
            const clickedFilename = clickedItem.dataset.filename;
            if (!clickedFilename) break;

            // Get all images (respecting filters)
            const imagesToProcess = window.filteredImageIndices && Array.isArray(window.filteredImageIndices) && window.filteredImageIndices.length > 0
                ? window.filteredImageIndices.map(idx => allImages[idx])
                : allImages;

            // Find the clicked image's index
            const clickedImageIndex = imagesToProcess.findIndex(img => {
                if (!img) return false;
                const filename = img.filename || img.original || img.upscaled;
                return filename === clickedFilename;
            });

            if (clickedImageIndex === -1) break;

            // Clear "all selected" flag
            isAllSelected = false;

            // Determine range based on action
            let startIndex, endIndex;
            if (action === 'bulk-select-all-above') {
                startIndex = 0;
                endIndex = clickedImageIndex - 1; // Exclude the clicked item itself
            } else {
                startIndex = clickedImageIndex + 1; // Exclude the clicked item itself
                endIndex = imagesToProcess.length - 1;
            }

            // Cache DOM items for efficient lookup
            const domItemsMap = new Map();
            const allDomItems = document.querySelectorAll('.gallery-item[data-filename], .gallery-placeholder[data-filename]');
            allDomItems.forEach(item => {
                const filename = item.dataset.filename;
                if (filename) {
                    domItemsMap.set(filename, item);
                }
            });

            // Ensure clicked item is not selected (explicitly select it)
            if (isImageSelected(clickedFilename)) {
                selectedImages.delete(clickedFilename);
                const clickedDomItem = domItemsMap.get(clickedFilename);
                if (clickedDomItem) {
                    clickedDomItem.dataset.selected = 'true';
                    clickedDomItem.classList.remove('selected');
                    const clickedCheckbox = clickedDomItem.querySelector('.gallery-item-checkbox');
                    if (clickedCheckbox) {
                        clickedCheckbox.checked = true;
                    }
                }
            }

            // Select items in range (including those not yet rendered)
            for (let i = startIndex; i <= endIndex; i++) {
                const image = imagesToProcess[i];
                if (!image) continue;
                const filename = image.filename || image.original || image.upscaled;
                if (!filename) continue;

                selectedImages.add(filename);

                // Update DOM if item exists
                const domItem = domItemsMap.get(filename);
                if (domItem) {
                    domItem.dataset.selected = 'true';
                    domItem.classList.add('selected');
                    const checkbox = domItem.querySelector('.gallery-item-checkbox');
                    if (checkbox) {
                        checkbox.checked = true;
                    }
                }
            }

            updateBulkActionsBar();
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
        gallery.innerHTML = '';
    }
    // Clear selection when clearing gallery
    clearSelection();
}

// Send gallery position hint to server for metadata prefetching
function sendGalleryPositionHint() {
    // Throttle hints to avoid sending too frequently
    if (galleryPositionHintThrottle) return;

    galleryPositionHintThrottle = setTimeout(() => {
        galleryPositionHintThrottle = null;

        // Only send if WebSocket is connected
        if (!window.wsClient || !window.wsClient.isConnected()) {
            return;
        }

        // Calculate current center index (approximate)
        const centerIndex = Math.floor((displayedStartIndex + displayedEndIndex) / 2);

        // Only send if index changed significantly (avoid duplicate sends)
        if (Math.abs(centerIndex - lastHintIndex) < 10) {
            return;
        }

        lastHintIndex = centerIndex;

        // Send non-ack message for prefetching
        try {
            window.wsClient.sendAcklessMessage('gallery_position_hint', {
                index: centerIndex,
                viewType: currentGalleryView,
                prefetchRange: 50 // Prefetch 50 images before and after
            });
        } catch (error) {
            // Silently ignore errors (non-critical)
            console.debug('Failed to send gallery position hint:', error);
        }
    }, 500); // Throttle to max once per 500ms
}

// Add context menu event listener
document.addEventListener('contextMenuAction', handleGalleryContextMenuAction);
document.addEventListener('contextMenuAction', handleBulkActionsContextMenu);
document.addEventListener('contextMenuAction', handleBulkActionsContextMenu);