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
let galleryJumpIndexDetailEl = null;
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
    { value: 5 * 60 * 1000, name: '5 minutes' },
    { value: 15 * 60 * 1000, name: '15 minutes' },
    { value: 30 * 60 * 1000, name: '30 minutes' },
    { value: 60 * 60 * 1000, name: '1 hour' },
    { value: 6 * 60 * 60 * 1000, name: '6 hours' },
    { value: 12 * 60 * 60 * 1000, name: '12 hours' },
    { value: 24 * 60 * 60 * 1000, name: '1 day' },
    { value: 7 * 24 * 60 * 60 * 1000, name: '7 days' },
    { value: 30 * 24 * 60 * 60 * 1000, name: '30 days' }
];
const GALLERY_JUMP_INDEX_MAX_GROUP_OPTIONS = [
    { value: 25, name: '25' },
    { value: 50, name: '50' },
    { value: 100, name: '100' },
    { value: 200, name: '200' },
    { value: 400, name: '400' },
    { value: 'none', name: 'No limit' }
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

// The first row in view: currentVisibleIndex, which the gallery's scroll pass sets (galleryView.js,
// the title bar's index) just before it calls updateGalleryJumpIndexActiveCard. lastHintIndex is
// only the last position hint sent to the server: hints pause after a programmatic jump until the
// user scrolls, so it went stale and the Visual Index marked (and measured from) the group the
// gallery was at before the jump.
function getCurrentGalleryAnchorIndex() {
    const effectiveLength = window.filteredImageIndices ? window.filteredImageIndices.length : allImages.length;
    if (!effectiveLength) return 0;
    let index = typeof currentVisibleIndex === 'number' && currentVisibleIndex >= 0 ? currentVisibleIndex : null;
    if (index === null) index = Number.isFinite(lastHintIndex) && lastHintIndex >= 0 ? lastHintIndex : getFirstVisibleRowIndex();
    return Math.max(0, Math.min(effectiveLength - 1, index));
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
    const timestamps = new Array(effectiveLength);
    timestamps[0] = groupStartTs;
    entries.push({ index: 0, groupCount: 0 });

    let prevTs = groupStartTs;
    for (let i = 1; i < effectiveLength; i++) {
        const currTs = getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(i));
        timestamps[i] = currTs;
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
        prevTs = currTs;
    }

    // Each group's item count and the earliest / latest time in it (the gallery sorts either way).
    for (let i = 0; i < entries.length; i++) {
        const start = entries[i].index;
        const end = i < entries.length - 1 ? entries[i + 1].index : effectiveLength;
        entries[i].groupCount = Math.max(1, end - start);
        let first = null;
        let last = null;
        for (let k = start; k < end; k++) {
            const ts = timestamps[k];
            if (ts === null || ts === undefined) continue;
            if (first === null || ts < first) first = ts;
            if (last === null || ts > last) last = ts;
        }
        entries[i].firstMs = first;
        entries[i].lastMs = last;
        entries[i].startMs = timestamps[start] ?? null;
    }

    return entries;
}

/** "Oct 13, 3:30 PM" (no year this year), the time only for the second end of a same-day span. */
function formatGalleryJumpIndexTime(ms, { timeOnly = false } = {}) {
    if (!Number.isFinite(ms)) return '';
    const date = new Date(ms);
    if (timeOnly) return date.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const opts = { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' };
    if (date.getFullYear() !== new Date().getFullYear()) opts.year = 'numeric';
    return date.toLocaleString([], opts);
}

/** A tile's caption: the time of the image it shows (the group's first in gallery order). */
function formatGalleryJumpIndexCaption(entry) {
    return formatGalleryJumpIndexTime(Number.isFinite(entry.startMs) ? entry.startMs : entry.firstMs) || `Group at ${entry.index + 1}`;
}

/** "Oct 13, 3:30 PM to 5:10 PM" (or to another day's date). */
function formatGalleryJumpIndexSpan(entry) {
    if (!Number.isFinite(entry.firstMs)) return `Images ${entry.index + 1} to ${entry.index + entry.groupCount}`;
    if (!Number.isFinite(entry.lastMs) || entry.lastMs - entry.firstMs < 60 * 1000) return formatGalleryJumpIndexTime(entry.firstMs);
    const sameDay = new Date(entry.firstMs).toDateString() === new Date(entry.lastMs).toDateString();
    return `${formatGalleryJumpIndexTime(entry.firstMs)} to ${formatGalleryJumpIndexTime(entry.lastMs, { timeOnly: sameDay })}`;
}

function getNearestGalleryJumpIndexEntry(currentIndex = getCurrentGalleryAnchorIndex()) {
    let nearest = null;
    let nearestDistance = Infinity;
    for (const entry of galleryJumpIndexEntries || []) {
        const d = Math.abs(entry.index - currentIndex);
        if (d < nearestDistance) {
            nearestDistance = d;
            nearest = entry;
        }
    }
    return nearest;
}

// The details pane: the group under the pointer (or the one passed in, while jumping), else the
// group in view. First line the group's time span, second its size and how far it is from here.
function updateGalleryJumpIndexSummary(preferredBoundaryIndex = null) {
    if (!galleryJumpIndexSummaryEl) return;
    const setDetail = (text) => { if (galleryJumpIndexDetailEl) galleryJumpIndexDetailEl.textContent = text; };
    if (!galleryJumpIndexEntries || galleryJumpIndexEntries.length === 0) {
        galleryJumpIndexSummaryEl.textContent = 'No groups';
        setDetail('');
        return;
    }
    const currentIndex = getCurrentGalleryAnchorIndex();
    const wanted = Number.isFinite(preferredBoundaryIndex) ? preferredBoundaryIndex : galleryJumpIndexHoveredBoundaryIndex;
    const nearest = getNearestGalleryJumpIndexEntry(currentIndex);
    const target = (Number.isFinite(wanted) && galleryJumpIndexEntries.find((entry) => entry.index === wanted)) || nearest;
    if (!target) return;

    galleryJumpIndexSummaryEl.textContent = formatGalleryJumpIndexSpan(target);
    const size = `${target.groupCount.toLocaleString()} image${target.groupCount === 1 ? '' : 's'}`;
    const distance = target.index - currentIndex;
    if (target === nearest || distance === 0) {
        setDetail(`${size}, in view`);
        return;
    }
    const jump = formatGalleryTimeJumpDetails(
        getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(currentIndex)),
        getGalleryImageTimestampMs(getGalleryImageAtFilteredIndex(target.index)));
    const away = `${Math.abs(distance).toLocaleString()} image${Math.abs(distance) === 1 ? '' : 's'} ${distance > 0 ? 'further down' : 'further up'}`;
    // "-36 days" read as a distance: say earlier / later instead of a sign
    const when = jump ? `, ${jump.relativeLabel.replace(/^[+-]/, '')} ${jump.relativeLabel.startsWith('-') ? 'earlier' : 'later'}` : '';
    setDetail(`${size}, ${away}${when}`);
}

/** Scroll a tile into the middle of the grid's own scroller only (scrollIntoView would also move
 *  the window's ancestors and the desktop). */
function scrollGalleryJumpIndexCardIntoView(card) {
    if (!card) return;
    let scroller = card.parentElement;
    while (scroller && scroller !== galleryJumpIndexToolEl) {
        const style = getComputedStyle(scroller);
        if (/(auto|scroll)/.test(style.overflowY) && scroller.scrollHeight > scroller.clientHeight) break;
        scroller = scroller.parentElement;
    }
    if (!scroller || scroller === galleryJumpIndexToolEl) return;
    const cardRect = card.getBoundingClientRect();
    const boxRect = scroller.getBoundingClientRect();
    scroller.scrollTop += (cardRect.top + cardRect.height / 2) - (boxRect.top + boxRect.height / 2);
}

function updateGalleryJumpIndexActiveCard() {
    if (!galleryJumpIndexListEl || !galleryJumpIndexEntries || galleryJumpIndexEntries.length === 0) return;
    const activeEntry = getNearestGalleryJumpIndexEntry();
    if (!activeEntry || galleryJumpIndexActiveBoundaryIndex === activeEntry.index) return;
    // only the old and the new tile change (was a toggle over every tile on each scroll)
    const old = galleryJumpIndexListEl.querySelector('.gallery-jump-index-card.active-boundary');
    if (old) {
        old.classList.remove('active-boundary');
        old.setAttribute('aria-selected', 'false');
    }
    galleryJumpIndexActiveBoundaryIndex = activeEntry.index;
    const activeCard = galleryJumpIndexListEl.querySelector(`.gallery-jump-index-card[data-index="${activeEntry.index}"]`);
    if (activeCard) {
        activeCard.classList.add('active-boundary');
        activeCard.setAttribute('aria-selected', 'true');
        scrollGalleryJumpIndexCardIntoView(activeCard);
    }
}

function getGalleryJumpIndexTargetEntry(preferredEntry) {
    if (preferredEntry) return preferredEntry;
    if (!galleryJumpIndexEntries || galleryJumpIndexEntries.length === 0) return null;
    if (Number.isFinite(galleryJumpIndexHoveredBoundaryIndex)) {
        return galleryJumpIndexEntries.find((entry) => entry.index === galleryJumpIndexHoveredBoundaryIndex) || null;
    }
    return getNearestGalleryJumpIndexEntry();
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
        galleryJumpIndexHoveredBoundaryIndex = null;
        // one string for the grid (escapeHtml: utilities.js); the tile caption is the group's first
        // time, the count under it as a second line; events are delegated from the grid
        galleryJumpIndexListEl.innerHTML = galleryJumpIndexEntries.map((entry) => {
            const image = getGalleryImageAtFilteredIndex(entry.index);
            if (!image) return '';
            const caption = formatGalleryJumpIndexCaption(entry);
            const count = `${entry.groupCount.toLocaleString()} image${entry.groupCount === 1 ? '' : 's'}`;
            return `<button type="button" class="gallery-jump-index-card" role="option" aria-selected="false" data-index="${entry.index}" title="${escapeHtml(formatGalleryJumpIndexSpan(entry))}">`
                + `<img src="${escapeHtml(getGalleryPreviewSrcForImage(image) || '')}" alt="" loading="lazy" decoding="async" />`
                + `<span class="gallery-jump-index-card-meta">${escapeHtml(caption)}</span>`
                + `<span class="gallery-jump-index-card-count">${count}</span></button>`;
        }).join('');
        updateGalleryJumpIndexActiveCard();
        updateGalleryJumpIndexSummary();
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
    galleryJumpIndexDetailEl = el.querySelector('#galleryJumpIndexDetail');
    galleryJumpIndexMinTimeSelectedEl = el.querySelector('#galleryJumpIndexMinTimeSelected');
    galleryJumpIndexMaxGroupSelectedEl = el.querySelector('#galleryJumpIndexMaxGroupSelected');

    if (!galleryJumpIndexListenersInitialized) {
        const closeBtn = el.querySelector('.close-btn');
        if (closeBtn) closeBtn.addEventListener('click', () => closeModal(el));
        const findEntry = (target) => {
            const card = target && target.closest ? target.closest('.gallery-jump-index-card') : null;
            if (!card) return null;
            const index = Number(card.dataset.index);
            return galleryJumpIndexEntries.find((entry) => entry.index === index) || null;
        };
        if (galleryJumpIndexListEl) {
            galleryJumpIndexListEl.addEventListener('click', (e) => {
                const entry = findEntry(e.target);
                if (entry) jumpGalleryJumpIndexTarget(entry);
            });
            galleryJumpIndexListEl.addEventListener('mouseover', (e) => {
                const entry = findEntry(e.target);
                if (!entry || galleryJumpIndexHoveredBoundaryIndex === entry.index) return;
                galleryJumpIndexHoveredBoundaryIndex = entry.index;
                updateGalleryJumpIndexSummary(entry.index);
            });
            galleryJumpIndexListEl.addEventListener('mouseleave', () => {
                galleryJumpIndexHoveredBoundaryIndex = null;
                updateGalleryJumpIndexSummary();
            });
        }
        document.addEventListener('galleryUpdated', () => {
            if (galleryJumpIndexToolEl && !galleryJumpIndexToolEl.classList.contains('hidden')) {
                regenerateGalleryJumpIndex();
            }
        });
        galleryJumpIndexListenersInitialized = true;
    }

    if (!galleryJumpIndexDropdownsInitialized) {
        const minBtn = document.getElementById('galleryJumpIndexMinTimeDropdownBtn');
        const maxBtn = document.getElementById('galleryJumpIndexMaxGroupDropdownBtn');

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
        const minItems = GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS.map((o) => ({ value: o.value, text: o.name }));
        const maxItems = GALLERY_JUMP_INDEX_MAX_GROUP_OPTIONS.map((o) => ({ value: o.value, text: o.name }));
        // contextMenu.attachPickerMenu: public/scripts/comp/contextMenu.js
        contextMenu.attachPickerMenu(minBtn, {
            anchorAlign: 'start',
            items: () => minItems,
            value: () => selectedGalleryJumpIndexMinTimeMs,
            onSelect: selectMin
        });
        contextMenu.attachPickerMenu(maxBtn, {
            anchorAlign: 'start',
            items: () => maxItems,
            value: () => (selectedGalleryJumpIndexMaxGroupImages === Infinity ? 'none' : selectedGalleryJumpIndexMaxGroupImages),
            onSelect: selectMax
        });
        galleryJumpIndexDropdownsInitialized = true;
    }

    if (galleryJumpIndexMinTimeSelectedEl) {
        const selected = GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS.find((o) => o.value === selectedGalleryJumpIndexMinTimeMs);
        galleryJumpIndexMinTimeSelectedEl.textContent = selected ? selected.name : '30 minutes';
    }
    if (galleryJumpIndexMaxGroupSelectedEl) {
        if (selectedGalleryJumpIndexMaxGroupImages === Infinity) {
            galleryJumpIndexMaxGroupSelectedEl.textContent = 'No limit';
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

    // the window's own limits (data-window-min/max-width; was a fixed 320-560 that let it grow
    // past its 420 px maximum)
    const minWidth = Number(galleryJumpIndexToolEl.dataset.windowMinWidth) || 320;
    const maxWidth = Number(galleryJumpIndexToolEl.dataset.windowMaxWidth) || 560;
    const currentWidth = Math.round(galleryJumpIndexToolEl.getBoundingClientRect().width || maxWidth);
    const targetWidth = Math.max(minWidth, Math.min(maxWidth, currentWidth));
    const targetHeight = Math.max(280, Math.min(viewportHeight - (margin * 2), Math.round(gRect.height)));

    // Prefer left side; if insufficient space, use right side.
    const leftSpace = gRect.left - margin;
    const rightSpace = viewportWidth - gRect.right - margin;
    const useLeft = leftSpace >= targetWidth || leftSpace >= rightSpace;
    let left = useLeft ? (gRect.left - targetWidth - margin) : (gRect.right + margin);

    // Clamp to viewport bounds.
    left = Math.max(margin, Math.min(left, viewportWidth - targetWidth - margin));
    const top = Math.max(margin, Math.min(gRect.top, viewportHeight - targetHeight - margin));

    // setModalPositionFromViewportRect: modalUtils.js (the desktop's top bias, the work area and the
    // window's min / max size; hand-set offsets left the caption ~15 px above the screen's top edge)
    if (typeof setModalPositionFromViewportRect === 'function') {
        setModalPositionFromViewportRect(galleryJumpIndexToolEl, { left, top, width: targetWidth, height: targetHeight });
        return;
    }
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
