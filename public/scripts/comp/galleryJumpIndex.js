// Gallery time-jump + Jump Index tool window.
// Extracted from galleryView.js (#23 incremental slice). Same globals.

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
