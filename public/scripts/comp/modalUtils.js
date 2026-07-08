// Modal utility functions
const backdrop = document.querySelector('.modal-backdrop');

// Modal z-index management
const MODAL_Z_BASE = 1002; // Base z-index for modal stacking (above --z-modal = 1100)
const MODAL_Z_ON_TOP_BASE = 2800; // Base z-index for on-top modals (matches --z-modal-top CSS variable)
const MODAL_Z_INCREMENT = 10; // Increment between modal layers
let modalStack = []; // Array to track modal stack order

// Bootstrap / connection overlays — never shown as taskbar window buttons
const TASKBAR_SYSTEM_MODAL_IDS = new Set([
    'windowsStartupModal',
    'windowsUpdateModal',
    'connectionDialModal',
    'desktopPreStartupModal',
    'dreamscapeOsInstallWizardModal',
    'confirmationDialog',
    'creditCostDialog'
]);

function shouldShowInTaskbar(modal) {
    if (!modal || !modal.id) return false;
    if (TASKBAR_SYSTEM_MODAL_IDS.has(modal.id)) return false;
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) return false;
    if (modal.classList.contains('closing')) return false;
    if (!modal.querySelector('.modal-window-title')) return false;
    // Small alert overlays — not taskbar windows
    if (modal.classList.contains('alert-theme')) return false;
    return true;
}

function getOpenTaskbarModals() {
    return Array.from(document.querySelectorAll('.modal:not(.hidden)')).filter(shouldShowInTaskbar);
}

// Window position caching
let windowPositionSaveTimer = null;
let windowPositionSaveMaxTimer = null;
const WINDOW_POSITION_SAVE_DEBOUNCE = 10000; // Shared with desktopShortcuts.saveDebounceDelay
const WINDOW_POSITION_SAVE_MAX_WAIT = 60000; // 60 seconds max wait (aligned with server maxWaitMs)
const VIEWPORT_RESIZE_POSITION_DELAY_MS = 500; // Wait for resize to settle before clamp/save

// Global window positions (not per-workspace) — var so desktopShortcuts.js / websocket.js share one binding
var globalWindowPositions = {}; // windowId -> { topLeft: { index, x, y }, bottomRight: { index, x, y } }
let lastSentWindowPositionsHash = null;
let lastCommittedWindowPositions = null;
let viewportResizePositionTimer = null;

// Track which transient windows should restore positions
const transientWindowsWithPositions = new Set(['photoSwipeShell', 'virtualKeyboard', 'emphasis-groups-tool', 'novel-editor-tool', 'novel-progress-tool']); // Set of window IDs that are transient but should restore positions

// Active window management
let currentActiveWindowId = null; // ID of the currently active window (null if no window is active)
let mainActiveWindowId = null; // ID of the main (non-tool) active window (null if no main window is active)

// Window usage stack - tracks activation order (most recent at the end)
let windowUsageStack = []; // Array of modal elements in order of activation

// Track when browser window regains focus to prevent accidental active window changes
let windowFocusRegainedTime = 0; // Timestamp when window regained focus
const FOCUS_GRACE_PERIOD = 200; // Don't change active window for 200ms after regaining focus

// Listen to window focus events to track when browser window regains focus
window.addEventListener('focus', () => {
    windowFocusRegainedTime = Date.now();
});

// Also track visibility changes (tab switching)
document.addEventListener('visibilitychange', () => {
    if (!document.hidden) {
        windowFocusRegainedTime = Date.now();
    }
});

// Integer desktop title-band bias (CSS uses 18px; was calc(0.5 * 35px) = 17.5px)
const MODAL_DESKTOP_TOP_BIAS_PX = 18;
// Minimum on-screen strip when dragging partially off-screen (matches title bar band)
const MODAL_MIN_VISIBLE_PX = 27;
// On restore/layout sync: snap up only when more than this fraction hangs below the work area
const MODAL_RESTORE_MAX_BOTTOM_OVERFLOW_RATIO = 0.1;
// Inset from work-area edges when opening/restoring/clamping window position
const MODAL_EDGE_MARGIN_PX = 0;
// WCO / Android: nudge maximized bounds up slightly so the window meets the caption (few px gap).
const MODAL_MAXIMIZE_CAPTION_NUDGE_PX = 3;

function getDesktopModalTopBias() {
    return window.isDesktop ? MODAL_DESKTOP_TOP_BIAS_PX : 0;
}

function getModalWorkAreaBounds() {
    const trueInsetTop = getModalTrueInsetTop();
    let bottom = window.innerHeight;
    if (window.isDesktop && document.body.classList.contains('desktop-mode')) {
        const taskbar = document.getElementById('desktopTaskbar');
        if (taskbar) {
            bottom -= taskbar.offsetHeight || 35;
        }
    }
    return {
        left: 0,
        top: trueInsetTop,
        right: window.innerWidth,
        bottom,
        width: window.innerWidth,
        height: Math.max(0, bottom - trueInsetTop)
    };
}

function getModalDragMaxTopEdge(minVisible = MODAL_MIN_VISIBLE_PX) {
    return getModalWorkAreaBounds().bottom - minVisible;
}

function getModalWorkAreaInnerBounds() {
    const workArea = getModalWorkAreaBounds();
    return {
        left: workArea.left + MODAL_EDGE_MARGIN_PX,
        top: workArea.top + MODAL_EDGE_MARGIN_PX,
        right: workArea.right - MODAL_EDGE_MARGIN_PX,
        bottom: workArea.bottom - MODAL_EDGE_MARGIN_PX,
        width: Math.max(0, workArea.width - (2 * MODAL_EDGE_MARGIN_PX)),
        height: Math.max(0, workArea.height - (2 * MODAL_EDGE_MARGIN_PX))
    };
}

function clampModalViewportRect(left, top, width, height, edgeMarginPx, options = {}) {
    const workArea = getModalWorkAreaBounds();
    const margin = edgeMarginPx != null ? edgeMarginPx : MODAL_EDGE_MARGIN_PX;
    const bounds = {
        left: workArea.left + margin,
        top: workArea.top + margin,
        right: workArea.right - margin,
        bottom: workArea.bottom - margin,
        width: Math.max(0, workArea.width - (2 * margin)),
        height: Math.max(0, workArea.height - (2 * margin))
    };
    let newLeft = left;
    let newTop = top;

    if (width > bounds.width) {
        newLeft = bounds.left;
    } else {
        if (newLeft < bounds.left) {
            newLeft = bounds.left;
        }
        if (newLeft + width > bounds.right) {
            newLeft = bounds.right - width;
        }
    }

    if (height > bounds.height) {
        newTop = bounds.top;
    } else {
        if (newTop < bounds.top) {
            newTop = bounds.top;
        }
        if (options.allowPartialBottomOverflow) {
            const overflowBelow = (newTop + height) - bounds.bottom;
            const maxOverflow = height * MODAL_RESTORE_MAX_BOTTOM_OVERFLOW_RATIO;
            if (overflowBelow > maxOverflow) {
                newTop = bounds.bottom - height;
            }
        } else if (newTop + height > bounds.bottom) {
            newTop = bounds.bottom - height;
        }
    }

    return {
        left: roundToDevicePixel(newLeft),
        top: roundToDevicePixel(newTop)
    };
}

function isModalMaximized(modal) {
    return !!(modal && modal.classList.contains('modal-maximized'));
}

function getModalMaximizeCaptionNudgePx() {
    if (document.documentElement.classList.contains('titlebar-android')
        || document.documentElement.classList.contains('window-controls-overlay')) {
        return MODAL_MAXIMIZE_CAPTION_NUDGE_PX;
    }
    return 0;
}

function captureModalLayoutState(modal) {
    if (!modal) {
        return null;
    }
    const rect = modal.getBoundingClientRect();
    const computedStyle = getComputedStyle(modal);
    return {
        left: rect.left,
        top: rect.top,
        width: rect.width,
        height: rect.height,
        offsetX: modal.style.getPropertyValue('--modal-offset-x') || computedStyle.getPropertyValue('--modal-offset-x') || '0px',
        offsetY: modal.style.getPropertyValue('--modal-offset-y') || computedStyle.getPropertyValue('--modal-offset-y') || '0px'
    };
}

function updateModalMaximizeButtonIcon(modal) {
    if (!modal) {
        return;
    }
    const btn = modal.querySelector('.modal-window-controls .modal-work-area-maximize');
    if (!btn) {
        return;
    }
    const icon = btn.querySelector('i');
    if (!icon) {
        return;
    }
    if (isModalMaximized(modal)) {
        icon.className = 'fa-regular fa-window-restore';
        btn.title = 'Restore window';
    } else {
        icon.className = 'fa-regular fa-window-maximize';
        btn.title = 'Maximize';
    }
}

function maximizeModalToWorkArea(modal) {
    if (!modal || isModalMaximized(modal)) {
        return;
    }

    modal._preMaximizeLayout = captureModalLayoutState(modal);
    modal.classList.add('modal-maximized');

    clearModalPixelAnchor(modal);

    const workArea = getModalWorkAreaInnerBounds();
    const nudge = getModalMaximizeCaptionNudgePx();
    modal.style.width = `${roundCssPixel(workArea.width)}px`;
    modal.style.height = `${roundCssPixel(workArea.height + nudge)}px`;
    void modal.offsetHeight;
    setModalOffsetsFromViewportTopLeft(modal, workArea.left, workArea.top - nudge);

    modal.setAttribute('data-modal-moved', 'true');
    updateModalMaximizeButtonIcon(modal);
    modal.dispatchEvent(new CustomEvent('modalMaximized', {
        bubbles: false,
        detail: { modal }
    }));
}

function restoreModalFromMaximize(modal) {
    if (!modal || !isModalMaximized(modal)) {
        return;
    }

    const layout = modal._preMaximizeLayout;
    modal.classList.remove('modal-maximized');
    delete modal._preMaximizeLayout;

    if (layout) {
        setModalPositionFromViewportRect(modal, {
            left: layout.left,
            top: layout.top,
            width: layout.width,
            height: layout.height
        });
        ensureModalEdgesWithinWorkArea(modal);
    }

    updateModalMaximizeButtonIcon(modal);
    modal.dispatchEvent(new CustomEvent('modalRestored', {
        bubbles: false,
        detail: { modal }
    }));
    debouncedSaveWindowPositions();
}

function toggleModalMaximize(modal) {
    if (!modal) {
        return;
    }
    if (isModalMaximized(modal)) {
        restoreModalFromMaximize(modal);
    } else {
        maximizeModalToWorkArea(modal);
    }
}

function wireModalMaximizeButton(modal) {
    if (!modal) {
        return;
    }
    const maxBtn = modal.querySelector('.modal-window-controls .modal-work-area-maximize');
    if (!maxBtn || maxBtn.dataset.modalMaximizeWired === 'true') {
        return;
    }
    maxBtn.dataset.modalMaximizeWired = 'true';
    maxBtn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        toggleModalMaximize(modal);
    });
    updateModalMaximizeButtonIcon(modal);
}

/** Taskbar / programmatic maximize — .modal-work-area-maximize (Lumen) vs custom handlers (Glancewell fullscreen, gallery mode, etc.) */
function handleWindowMaximizeAction(modal) {
    if (!modal) {
        return;
    }
    if (modal.querySelector('.modal-window-controls .modal-work-area-maximize')) {
        toggleModalMaximize(modal);
        return;
    }
    if (modal.id === 'galleryWindow') {
        maximizeGalleryWindow();
        return;
    }
    // Glancewell (PhotoSwipe shell) — fullscreen via togglePhotoSwipeShellWindowed, not work-area maximize
    if (modal.id === 'photoSwipeWindow' && typeof togglePhotoSwipeShellWindowed === 'function') {
        togglePhotoSwipeShellWindowed();
    }
}

function windowRestoresPosition(modal) {
    return !!(modal && modal.dataset.windowRestorePosition !== 'false');
}

function windowRestoresSize(modal) {
    return !!(modal && modal.dataset.windowRestoreSize !== 'false');
}

function shouldPersistWindowPosition(modal) {
    if (!modal || !window.isDesktop) {
        return false;
    }
    if (!windowRestoresPosition(modal) && !windowRestoresSize(modal)) {
        return false;
    }
    if (modal.id === 'galleryWindow' && modal.classList.contains('windowed')) {
        return true;
    }
    // Glancewell shell — only persist layout while windowed (public/scripts/comp/lightbox.js)
    if (modal.dataset.windowIdentifier === 'photoSwipeShell') {
        return modal.classList.contains('windowed');
    }
    if (modal.dataset.windowIdentifier && transientWindowsWithPositions.has(modal.dataset.windowIdentifier)) {
        return true;
    }
    if (!modal.classList.contains('transient') && modal.querySelector('.modal-window-title') && modal.hasAttribute('data-modal-moved')) {
        return true;
    }
    return false;
}

function shouldSaveShellBoundsFromRect(modal) {
    if (!modal || !windowRestoresSize(modal)) {
        return false;
    }
    if (modal.id === 'galleryWindow' && modal.classList.contains('windowed')) {
        return true;
    }
    if (modal.dataset.windowIdentifier === 'photoSwipeShell' && modal.classList.contains('windowed')) {
        return true;
    }
    return false;
}

function flushSaveWindowPositions() {
    if (windowPositionSaveTimer) {
        clearTimeout(windowPositionSaveTimer);
        windowPositionSaveTimer = null;
    }
    if (windowPositionSaveMaxTimer) {
        clearTimeout(windowPositionSaveMaxTimer);
        windowPositionSaveMaxTimer = null;
    }
    return saveWindowPositions({ force: true });
}

function commitWindowPositionsSnapshot() {
    lastCommittedWindowPositions = JSON.parse(JSON.stringify(globalWindowPositions || {}));
}

function replaceGlobalWindowPositions(next) {
    const source = next || {};
    Object.keys(globalWindowPositions).forEach((key) => {
        delete globalWindowPositions[key];
    });
    Object.assign(globalWindowPositions, source);
}

function clearGlobalWindowPositions() {
    Object.keys(globalWindowPositions).forEach((key) => {
        delete globalWindowPositions[key];
    });
}

function cancelPendingWindowPositionUpdates(options = {}) {
    const { revert = true } = options;

    if (windowPositionSaveTimer) {
        clearTimeout(windowPositionSaveTimer);
        windowPositionSaveTimer = null;
    }
    if (windowPositionSaveMaxTimer) {
        clearTimeout(windowPositionSaveMaxTimer);
        windowPositionSaveMaxTimer = null;
    }
    if (viewportResizePositionTimer) {
        clearTimeout(viewportResizePositionTimer);
        viewportResizePositionTimer = null;
    }

    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts) {
        if (desktopShortcuts.pendingWindowPositionSave) {
            desktopShortcuts.pendingWindowPositionSave = false;
            if (desktopShortcuts.saveDebounceTimer && !desktopShortcuts.pendingChanges) {
                clearTimeout(desktopShortcuts.saveDebounceTimer);
                desktopShortcuts.saveDebounceTimer = null;
            }
        }
        if (typeof desktopShortcuts.refreshSaveTrayIndicator === 'function') {
            desktopShortcuts.refreshSaveTrayIndicator();
        }
    }

    if (revert && lastCommittedWindowPositions) {
        replaceGlobalWindowPositions(lastCommittedWindowPositions);
    }
}

function clampModalEdgesWithinWorkAreaSync(modal, edgeMarginPx) {
    if (!modal || modal.classList.contains('hidden') || modal.classList.contains('hidden-alt') || isModalMaximized(modal)) {
        return false;
    }

    const rect = modal.getBoundingClientRect();
    if (!rect.width || !rect.height) {
        return false;
    }

    const restoreClamp = { allowPartialBottomOverflow: true };
    const clamped = clampModalViewportRect(rect.left, rect.top, rect.width, rect.height, edgeMarginPx, restoreClamp);
    if (Math.abs(clamped.left - rect.left) > 0.5 || Math.abs(clamped.top - rect.top) > 0.5) {
        setModalOffsetsFromViewportTopLeft(modal, clamped.left, clamped.top, restoreClamp);
        modal.setAttribute('data-modal-moved', 'true');
        return true;
    }

    settleModalPixelAnchor(modal);
    return false;
}

function handleDesktopViewportResizePositionSync() {
    if (!window.isDesktop || !document.body.classList.contains('desktop-mode')) {
        return;
    }

    let positionChanged = false;
    document.querySelectorAll('.modal:not(.hidden):not(.hidden-alt)').forEach(modal => {
        if (modal.classList.contains('minimised') || modal.classList.contains('minimising')) {
            return;
        }
        if (!modal.querySelector('.modal-window-title')) {
            return;
        }
        if (clampModalEdgesWithinWorkAreaSync(modal)) {
            positionChanged = true;
        }
    });

    if (positionChanged) {
        debouncedSaveWindowPositions();
    }
}

function scheduleDesktopViewportResizePositionSync() {
    if (!window.isDesktop || !document.body.classList.contains('desktop-mode')) {
        return;
    }

    cancelPendingWindowPositionUpdates({ revert: false });

    if (viewportResizePositionTimer) {
        clearTimeout(viewportResizePositionTimer);
    }

    viewportResizePositionTimer = setTimeout(() => {
        viewportResizePositionTimer = null;
        handleDesktopViewportResizePositionSync();
    }, VIEWPORT_RESIZE_POSITION_DELAY_MS);
}

function isStudioModalOpen() {
    const manualModal = document.getElementById('manualModal');
    // hidden-alt counts as open in desktop (studio visible without taking the modal stack)
    return !!(manualModal && !manualModal.classList.contains('hidden'));
}

function syncStudioForAppMode() {
    const manualModal = document.getElementById('manualModal');
    if (!manualModal || manualModal.classList.contains('hidden')) {
        return;
    }

    manualModal.classList.remove('minimised', 'minimising', 'unminimising', 'hidden-alt');

    if (manualModal.classList.contains('windowed') || manualModal.classList.contains('modal-maximized')) {
        if (isModalMaximized(manualModal)) {
            restoreModalFromMaximize(manualModal);
        }

        manualModal.classList.remove('windowed');
        manualModal.style.removeProperty('width');
        manualModal.style.removeProperty('height');
        manualModal.style.removeProperty('z-index');
        manualModal.style.removeProperty('--modal-offset-x');
        manualModal.style.removeProperty('--modal-offset-y');
        manualModal.removeAttribute('data-modal-moved');
        clearModalPixelAnchor(manualModal);
    }

    document.body.classList.add('editor-open');

    if (typeof modalStack !== 'undefined') {
        const modalIndex = modalStack.indexOf(manualModal);
        if (modalIndex !== -1) {
            modalStack.splice(modalIndex, 1);
            updateModalStackZIndexes();
        }
    }

    openModal(manualModal);

    // updateAndroidCaptionControlsOverlay: public/scripts/app.js
    if (typeof updateAndroidCaptionControlsOverlay === 'function') {
        updateAndroidCaptionControlsOverlay();
    }
}

function minimizeModalProgrammatically(modal) {
    if (!modal
        || modal.classList.contains('hidden')
        || modal.classList.contains('hidden-alt')
        || modal.classList.contains('minimised')
        || modal.classList.contains('minimising')) {
        return;
    }
    if (!document.body.classList.contains('desktop-mode')) {
        return;
    }

    const taskbarItem = getOrCreateTaskbarItem(modal);
    if (taskbarItem) {
        setMinimizeTargetVariables(modal, taskbarItem);
    }

    modal.classList.add('minimising');
    const minimisingAnimationHandler = (e) => {
        if (e.target === modal && e.animationName === 'modalMinimize' && modal.classList.contains('minimising')) {
            modal.removeEventListener('animationend', minimisingAnimationHandler);
            modal.classList.add('minimised');
            modal.classList.remove('minimising');
            debouncedUpdateTaskbarWindows();
            updateBackdropVisibility();
        }
    };
    modal.addEventListener('animationend', minimisingAnimationHandler);
}

function ensureGalleryReadyForAppMode(isStudioOpen) {
    if (!galleryWindow) {
        return;
    }

    galleryWindow.classList.remove('hidden', 'minimised', 'minimising');
    if (isModalMaximized(galleryWindow)) {
        restoreModalFromMaximize(galleryWindow);
    }

    if (isStudioOpen) {
        return;
    }

    // prepareGalleryWindowContent: public/scripts/comp/galleryView.js
    if (typeof prepareGalleryWindowContent === 'function') {
        prepareGalleryWindowContent().catch((err) => {
            console.error('Gallery prepare failed:', err);
        });
    } else {
        const savedPosition = window.savedGalleryPosition || 0;
        if (savedPosition && typeof displayGalleryFromStartIndex === 'function') {
            displayGalleryFromStartIndex(savedPosition);
        } else if (typeof loadGallery === 'function') {
            loadGallery();
        }
    }
}

function prepareAppModeWindowLayout() {
    if (!document.body.classList.contains('desktop-mode')) {
        return;
    }

    const isStudioOpen = isStudioModalOpen();
    ensureGalleryReadyForAppMode(isStudioOpen);

    document.querySelectorAll('.modal:not(.hidden):not(.hidden-alt)').forEach(modal => {
        if (modal.id === 'galleryWindow') {
            return;
        }
        if (isStudioOpen && modal.id === 'manualModal') {
            return;
        }
        if (!modal.querySelector('.modal-window-title')) {
            return;
        }

        if (isModalMaximized(modal)) {
            restoreModalFromMaximize(modal);
        }
        resetModalToViewportCenter(modal);
        minimizeModalProgrammatically(modal);
    });

    debouncedUpdateTaskbarWindows();
    updateBackdropVisibility();
}

function applyDesktopWindowPositionsAfterLoad() {
    ensureGalleryVisibleForDesktopEntry();
    restoreOpenDesktopWindowPositions();
    requestAnimationFrame(() => {
        requestAnimationFrame(() => {
            if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts) {
                desktopShortcuts._layoutHydrationComplete = true;
                desktopShortcuts.pendingChanges = false;
                desktopShortcuts.pendingWindowPositionSave = false;
                if (typeof desktopShortcuts.hideSaveTrayIndicator === 'function') {
                    desktopShortcuts.hideSaveTrayIndicator();
                }
            }
        });
    });
}

function ensureGalleryVisibleForDesktopEntry() {
    if (!galleryWindow || !galleryWindow.classList.contains('windowed')) {
        return;
    }
    if (Object.keys(globalWindowPositions).length === 0) {
        return;
    }

    let autoLaunchGallery = true;
    try {
        autoLaunchGallery = localStorage.getItem('dontAutoLaunchWorkspace') !== 'true';
    } catch (e) { /* ignore */ }
    if (autoLaunchGallery) {
        galleryWindow.classList.remove('hidden');
    }
}

function restoreOpenDesktopWindowPositions() {
    if (!window.isDesktop || Object.keys(globalWindowPositions).length === 0) {
        return;
    }

    const candidates = new Set();
    document.querySelectorAll('.modal').forEach((modal) => candidates.add(modal));
    const gallery = document.getElementById('galleryWindow');
    if (gallery) {
        candidates.add(gallery);
    }

    candidates.forEach((modal) => {
        if (TASKBAR_SYSTEM_MODAL_IDS.has(modal.id)) {
            return;
        }
        if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) {
            return;
        }
        if (modal.classList.contains('minimised') || modal.classList.contains('minimising')) {
            return;
        }

        const hasTitleBar = modal.querySelector('.modal-window-title');
        const isGalleryShell = modal.id === 'galleryWindow' && modal.classList.contains('windowed');
        if (!hasTitleBar && !isGalleryShell) {
            return;
        }

        if (!windowRestoresPosition(modal) && !windowRestoresSize(modal)) {
            return;
        }

        const isTransient = modal.classList.contains('transient');
        if (isTransient
            && (!modal.dataset.windowIdentifier
                || !transientWindowsWithPositions.has(modal.dataset.windowIdentifier))) {
            return;
        }

        restoreWindowPosition(modal);
        ensureModalEdgesWithinWorkArea(modal);
    });
}

async function ensureDesktopPositionsAfterEntry() {
    if (!window.isDesktop || !document.body.classList.contains('desktop-mode')) {
        return;
    }

    const workspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null)
        || window.currentWorkspace
        || 'default';

    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts && workspaceId) {
        const needsLoad = Object.keys(globalWindowPositions).length === 0
            || desktopShortcuts.currentWorkspace !== workspaceId
            || desktopShortcuts.shortcuts.length === 0;

        if (needsLoad) {
            desktopShortcuts.currentWorkspace = workspaceId;
            await desktopShortcuts.loadShortcuts(workspaceId);
        }

        if (desktopShortcuts.gridContainer && desktopShortcuts.freeformContainer) {
            desktopShortcuts.renderShortcuts();
        }
    }

    if (Object.keys(globalWindowPositions).length === 0) {
        return;
    }

    ensureGalleryVisibleForDesktopEntry();
    restoreOpenDesktopWindowPositions();
    debouncedUpdateTaskbarWindows();
}

function clearModalPixelAnchor(modal) {
    if (!modal) {
        return;
    }
    modal.classList.remove('modal-pixel-settled');
    modal.style.removeProperty('--modal-pixel-left');
    modal.style.removeProperty('--modal-pixel-top');
}

/** Layout rect for offset revert; falls back to stored pixel anchor when display:none (e.g. minimised). */
function getModalAnchorRect(modal) {
    const rect = modal.getBoundingClientRect();
    if (rect.width > 0 || rect.height > 0) {
        return rect;
    }

    const pixelLeft = parseFloat(modal.style.getPropertyValue('--modal-pixel-left'));
    const pixelTop = parseFloat(modal.style.getPropertyValue('--modal-pixel-top'));
    if (!Number.isFinite(pixelLeft) || !Number.isFinite(pixelTop)) {
        return rect;
    }

    let width = parseFloat(modal.style.width);
    let height = parseFloat(modal.style.height);
    if (!Number.isFinite(width) || width <= 0) {
        width = modal.offsetWidth;
    }
    if (!Number.isFinite(height) || height <= 0) {
        height = modal.offsetHeight;
    }

    return {
        left: pixelLeft,
        top: pixelTop,
        width: width || 0,
        height: height || 0
    };
}

/** Drop pixel-settled positioning back to offset mode without moving the window on screen. */
function revertModalToOffsetAnchor(modal) {
    if (!modal || !modal.classList.contains('modal-pixel-settled')) {
        return;
    }
    const rect = getModalAnchorRect(modal);
    clearModalPixelAnchor(modal);

    const trueInsetTop = getModalTrueInsetTop();
    if (isModalTopAnchored(modal)) {
        const offsetX = (rect.left + rect.width / 2) - (window.innerWidth / 2);
        const offsetY = rect.top - trueInsetTop;
        setModalOffsetPx(modal, offsetX, offsetY, { snap: false, settle: false });
        return;
    }

    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const offsetX = centerX - (window.innerWidth / 2);
    const offsetY = centerY - (window.innerHeight / 2) - (0.5 * trueInsetTop) + getDesktopModalTopBias();
    setModalOffsetPx(modal, offsetX, offsetY, { snap: false, settle: false });
}

function prepareModalForDragOrResize(modal) {
    if (!modal) {
        return;
    }
    if (isModalMaximized(modal)) {
        restoreModalFromMaximize(modal);
    }
    if (modal.classList.contains('modal-pixel-settled')) {
        revertModalToOffsetAnchor(modal);
        return;
    }
    clearModalPixelAnchor(modal);
}

/** Re-sync pixel anchor after programmatic width/height changes (e.g. Lumen image load, maximize). */
function refreshModalLayoutAfterSizeChange(modal) {
    if (!modal || modal.classList.contains('hidden')) {
        return;
    }
    if (modal.hasAttribute('data-dragging') || modal.hasAttribute('data-resizing')) {
        return;
    }

    const applyRefresh = () => {
        if (!modal || modal.classList.contains('hidden')) {
            return;
        }
        if (modal.hasAttribute('data-dragging') || modal.hasAttribute('data-resizing')) {
            return;
        }
        if (modal.classList.contains('opening') || modal.classList.contains('closing') ||
            modal.classList.contains('minimising') || modal.classList.contains('unminimising')) {
            return;
        }

        if (modal.classList.contains('modal-pixel-settled')) {
            revertModalToOffsetAnchor(modal);
        } else {
            clearModalPixelAnchor(modal);
        }
        void modal.offsetHeight;

        requestAnimationFrame(() => {
            if (modal.hasAttribute('data-dragging') || modal.hasAttribute('data-resizing')) {
                return;
            }
            if (!isModalWithinViewportBounds(modal)) {
                ensureModalWithinViewport(modal);
            } else {
                settleModalPixelAnchor(modal);
            }
        });
    };

    if (modal.classList.contains('opening') || modal.classList.contains('closing') ||
        modal.classList.contains('minimising') || modal.classList.contains('unminimising')) {
        const waitForAnimation = (e) => {
            if (e.target !== modal) return;
            if (e.animationName !== 'modalSlideIn' && e.animationName !== 'modalSlideInTopAnchor' &&
                e.animationName !== 'modalSlideOut' && e.animationName !== 'modalSlideOutTopAnchor' &&
                e.animationName !== 'modalMinimize' && e.animationName !== 'modalUnminimize') {
                return;
            }
            modal.removeEventListener('animationend', waitForAnimation);
            requestAnimationFrame(applyRefresh);
        };
        modal.addEventListener('animationend', waitForAnimation);
        return;
    }

    applyRefresh();
}

function snapModalOffsetsToDevicePixels(modal) {
    if (!modal || modal.classList.contains('modal-pixel-settled')) {
        return;
    }

    const rect = modal.getBoundingClientRect();
    const targetLeft = roundToDevicePixel(rect.left);
    const targetTop = roundToDevicePixel(rect.top);
    const deltaX = targetLeft - rect.left;
    const deltaY = targetTop - rect.top;

    if (Math.abs(deltaX) < 0.0005 && Math.abs(deltaY) < 0.0005) {
        return;
    }

    const computedStyle = getComputedStyle(modal);
    const offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');

    modal.style.setProperty('--modal-offset-x', `${roundCssPixel(offsetX + deltaX)}px`);
    modal.style.setProperty('--modal-offset-y', `${roundCssPixel(offsetY + deltaY)}px`);
}

function setModalOffsetPx(modal, offsetX, offsetY, options) {
    if (!modal) {
        return;
    }

    const opts = options || {};

    modal.style.setProperty('--modal-offset-x', `${roundCssPixel(offsetX)}px`);
    modal.style.setProperty('--modal-offset-y', `${roundCssPixel(offsetY)}px`);

    if (opts.snap !== false) {
        void modal.offsetHeight;
        snapModalOffsetsToDevicePixels(modal);
    }

    if (opts.settle) {
        settleModalPixelAnchor(modal);
    }
}

function settleModalPixelAnchor(modal) {
    if (!modal) {
        return;
    }

    if (modal.classList.contains('hidden') ||
        modal.classList.contains('opening') ||
        modal.classList.contains('closing') ||
        modal.classList.contains('minimising') ||
        modal.classList.contains('unminimising')) {
        return;
    }

    snapModalOffsetsToDevicePixels(modal);
    void modal.offsetHeight;

    const rect = modal.getBoundingClientRect();
    modal.style.setProperty('--modal-pixel-left', `${roundToDevicePixel(rect.left)}px`);
    modal.style.setProperty('--modal-pixel-top', `${roundToDevicePixel(rect.top)}px`);
    modal.classList.add('modal-pixel-settled');
}

// Debounced updateTaskbarWindows - only called max every 250ms
let updateTaskbarWindowsTimer = null;
const UPDATE_TASKBAR_DEBOUNCE = 250; // 250ms debounce

function debouncedUpdateTaskbarWindows() {
    if (updateTaskbarWindowsTimer) {
        clearTimeout(updateTaskbarWindowsTimer);
    }
    updateTaskbarWindowsTimer = setTimeout(() => {
        updateTaskbarWindows();
        updateTaskbarWindowsTimer = null;
    }, UPDATE_TASKBAR_DEBOUNCE);
}

// Check if a modal is a tool window (doesn't remove active class from main window)
function isToolWindow(modal) {
    if (!modal) return false;
    const modalElement = typeof modal === 'string' ? document.getElementById(modal) : modal;
    return modalElement && modalElement.classList.contains('tool-window');
}

// Full windows close with Alt+Q; Esc is reserved for confirmations and small pickers.
const ESCAPE_CLOSE_MODAL_IDS = new Set([
    'confirmationDialog',
    'creditCostDialog',
    'pinModal',
    'positionDialog',
    'datasetTagToolbar',
    'galleryJumpIndexTool',
    'metadataDialog',
    'textReplacementManualSelectionModal',
    'textReplacementLockModal',
    'createTextReplacementModal',
    'createRequestBodyReplacementModal',
    'updatePresetModal',
    'workspaceEditModal',
    'workspaceDumpModal',
    'cacheMetadataModal',
    'configEditorValueModal',
    'configEditorCheckpointsModal',
    'timeDateModal',
    'weatherLocationModal',
    'connectionDialModal',
    'naxVibesEncodingPickerModal',
    'naxtCustomTagModal',
    'vibeManagerDeleteModal',
    'vibeManagerMoveModal',
    'bulkChangePresetModal',
    'vfsImportChoiceModal',
    'openNoteModal',
    'updateNoteModal',
    'tokenDisplayModal',
    'virtualKeyboardModal',
    'runModal'
]);

function modalClosesWithEscape(modal) {
    if (!modal) return false;
    const el = typeof modal === 'string' ? document.getElementById(modal) : modal;
    if (!el) return false;
    if (el.classList.contains('alert-theme')) return true;
    return ESCAPE_CLOSE_MODAL_IDS.has(el.id);
}

// Link a tool window to a parent modal so it closes when the parent closes
function linkToolWindowToParent(toolWindow, parentModal) {
    if (!toolWindow || !parentModal) return;
    const toolElement = typeof toolWindow === 'string' ? document.getElementById(toolWindow) : toolWindow;
    const parentElement = typeof parentModal === 'string' ? document.getElementById(parentModal) : parentModal;
    if (!toolElement || !parentElement) return;

    // Set the parent modal ID on the tool window
    toolElement.setAttribute('data-parent-modal-id', parentElement.id);
}

// Get all tool windows linked to a parent modal
function getLinkedToolWindows(parentModal) {
    if (!parentModal) return [];
    const parentElement = typeof parentModal === 'string' ? document.getElementById(parentModal) : parentModal;
    if (!parentElement || !parentElement.id) return [];

    // Find all tool windows with this parent's ID
    return Array.from(document.querySelectorAll('.modal.tool-window')).filter(modal =>
        modal.getAttribute('data-parent-modal-id') === parentElement.id &&
        !modal.classList.contains('hidden')
    );
}

/** Bring a linked tool window to the foreground for keyboard/mouse interaction (does not move DOM focus). */
function activateToolWindowInteraction(toolWindow) {
    const toolEl = typeof toolWindow === 'string' ? document.getElementById(toolWindow) : toolWindow;
    if (!toolEl || !isToolWindow(toolEl) || toolEl.classList.contains('hidden') || toolEl.classList.contains('closing')) {
        return false;
    }
    if (isModalActive(toolEl)) {
        return true;
    }
    bringModalToFront(toolEl);
    return true;
}

/** Return active-window state to the tool window's linked parent (does not move DOM focus). */
function restoreLinkedToolWindowParent(toolWindow) {
    const toolEl = typeof toolWindow === 'string' ? document.getElementById(toolWindow) : toolWindow;
    if (!toolEl || !isToolWindow(toolEl)) return false;
    const parentId = toolEl.getAttribute('data-parent-modal-id');
    if (!parentId) return false;
    const parentEl = document.getElementById(parentId);
    if (!parentEl || parentEl.classList.contains('hidden')) return false;
    setActiveWindow(parentId);
    return true;
}

function getModalTrueInsetTop() {
    const tempEl = document.createElement('div');
    tempEl.style.position = 'absolute';
    tempEl.style.top = 'var(--true-inset-top, 0px)';
    tempEl.style.visibility = 'hidden';
    tempEl.style.pointerEvents = 'none';
    document.body.appendChild(tempEl);
    const trueInsetTop = tempEl.offsetTop || 0;
    document.body.removeChild(tempEl);
    return trueInsetTop;
}

function getModalMinDimensions(modal) {
    return {
        minWidth: modal.dataset.windowMinWidth ? parseInt(modal.dataset.windowMinWidth, 10) : 200,
        minHeight: modal.dataset.windowMinHeight ? parseInt(modal.dataset.windowMinHeight, 10) : 150
    };
}

function applyModalDefaultWindowSize(modal) {
    if (!modal) {
        return;
    }
    if (!modal.dataset.windowDefaultWidth && !modal.dataset.windowDefaultHeight) {
        return;
    }
    if (modal.hasAttribute('data-window-position-restored')) {
        const inlineW = parseFloat(modal.style.width);
        const inlineH = parseFloat(modal.style.height);
        if (inlineW > 0 && inlineH > 0) {
            return;
        }
    }

    const { minWidth, minHeight } = getModalMinDimensions(modal);
    const maxWidth = modal.dataset.windowMaxWidth ? parseInt(modal.dataset.windowMaxWidth, 10) : Infinity;
    const maxHeight = modal.dataset.windowMaxHeight ? parseInt(modal.dataset.windowMaxHeight, 10) : Infinity;

    let width = parseInt(modal.dataset.windowDefaultWidth, 10) || minWidth;
    let height = parseInt(modal.dataset.windowDefaultHeight, 10) || minHeight;
    width = Math.max(minWidth, Math.min(width, maxWidth));
    height = Math.max(minHeight, Math.min(height, maxHeight));

    modal.style.width = `${width}px`;
    modal.style.height = `${height}px`;
}

function parseCssPixelLength(value, containerPx) {
    if (!value || value === 'auto' || value === 'none') {
        return 0;
    }
    if (value.includes('px')) {
        return parseFloat(value);
    }
    if (value.includes('%')) {
        return (parseFloat(value) / 100) * containerPx;
    }
    const num = parseFloat(value);
    return Number.isFinite(num) ? num : 0;
}

function beginModalLayoutMeasure(modal) {
    const state = {
        wasHidden: modal.classList.contains('hidden'),
        wasHiddenAlt: modal.classList.contains('hidden-alt'),
        visibility: modal.style.visibility,
        pointerEvents: modal.style.pointerEvents
    };

    if (state.wasHidden || state.wasHiddenAlt) {
        modal.style.visibility = 'hidden';
        modal.style.pointerEvents = 'none';
        if (state.wasHidden) {
            modal.classList.remove('hidden');
        }
        if (state.wasHiddenAlt) {
            modal.classList.remove('hidden-alt');
        }
        void modal.offsetHeight;
    }

    return state;
}

function endModalLayoutMeasure(modal, state) {
    if (!state || (!state.wasHidden && !state.wasHiddenAlt)) {
        return;
    }

    modal.style.visibility = state.visibility;
    modal.style.pointerEvents = state.pointerEvents;
    if (state.wasHidden) {
        modal.classList.add('hidden');
    }
    if (state.wasHiddenAlt) {
        modal.classList.add('hidden-alt');
    }
}

function getModalLayoutDimensions(modal) {
    const { minWidth, minHeight } = getModalMinDimensions(modal);
    const measureState = beginModalLayoutMeasure(modal);

    try {
        void modal.offsetHeight;
        const rect = modal.getBoundingClientRect();
        const computed = getComputedStyle(modal);
        let width = rect.width;
        let height = rect.height;

        if (!width || width < 1) {
            width = parseCssPixelLength(modal.style.width, window.innerWidth)
                || parseCssPixelLength(computed.width, window.innerWidth);
        }
        if (!height || height < 1) {
            height = parseCssPixelLength(modal.style.height, window.innerHeight)
                || parseCssPixelLength(computed.height, window.innerHeight);
        }

        const content = modal.querySelector('.modal-content');
        if (content) {
            const contentRect = content.getBoundingClientRect();
            const contentStyle = getComputedStyle(content);
            const contentWidth = contentRect.width || parseCssPixelLength(contentStyle.width, window.innerWidth);
            const contentHeight = contentRect.height || parseCssPixelLength(contentStyle.height, window.innerHeight);
            if (contentWidth > width) {
                width = contentWidth;
            }
            if (contentHeight > height) {
                height = contentHeight;
            }
        }

        return {
            width: Math.max(minWidth, Math.round(width) || minWidth),
            height: Math.max(minHeight, Math.round(height) || minHeight)
        };
    } finally {
        endModalLayoutMeasure(modal, measureState);
    }
}

function clampModalOffsetsForRect(offsetX, offsetY, width, height, options = {}) {
    const allowOffscreen = options.allowOffscreen === true;
    const minVisible = options.minVisible != null ? options.minVisible : MODAL_MIN_VISIBLE_PX;
    const edgeMargin = options.edgeMargin != null ? options.edgeMargin : MODAL_EDGE_MARGIN_PX;
    const workArea = getModalWorkAreaBounds();
    const containerWidth = window.innerWidth;
    const containerHeight = window.innerHeight;
    const trueInsetTop = getModalTrueInsetTop();

    const centerYFromOffset = (oy) =>
        containerHeight / 2 + (0.5 * trueInsetTop) + oy - getDesktopModalTopBias();

    let constrainedX = offsetX;
    let constrainedY = offsetY;
    let centerX = containerWidth / 2 + offsetX;
    let centerY = centerYFromOffset(offsetY);
    let leftEdge = centerX - width / 2;
    let rightEdge = centerX + width / 2;

    if (allowOffscreen) {
        const minLeft = -width + minVisible;
        const maxLeft = containerWidth - minVisible;
        if (leftEdge < minLeft) {
            leftEdge = minLeft;
        } else if (leftEdge > maxLeft) {
            leftEdge = maxLeft;
        }
    } else if (width <= workArea.width) {
        if (leftEdge < workArea.left + edgeMargin) {
            leftEdge = workArea.left + edgeMargin;
        } else if (rightEdge > workArea.right - edgeMargin) {
            leftEdge = workArea.right - edgeMargin - width;
        }
    } else {
        leftEdge = workArea.left + edgeMargin;
    }
    constrainedX = (leftEdge + width / 2) - (containerWidth / 2);

    centerY = centerYFromOffset(constrainedY);
    let topEdge = centerY - height / 2;
    let bottomEdge = centerY + height / 2;

    if (allowOffscreen) {
        const minTop = -height + minVisible;
        if (topEdge < minTop) {
            topEdge = minTop;
        }
        const maxTop = getModalDragMaxTopEdge(minVisible);
        if (topEdge > maxTop) {
            topEdge = maxTop;
        }
        bottomEdge = topEdge + height;
        if (topEdge < workArea.top && bottomEdge > workArea.top) {
            topEdge = workArea.top;
        }
    } else if (height <= workArea.height) {
        if (topEdge < workArea.top + edgeMargin) {
            topEdge = workArea.top + edgeMargin;
        } else if (bottomEdge > workArea.bottom - edgeMargin) {
            topEdge = workArea.bottom - edgeMargin - height;
        }
    } else {
        topEdge = workArea.top + edgeMargin;
    }

    centerY = topEdge + height / 2;
    constrainedY = centerY - (containerHeight / 2) - (0.5 * trueInsetTop) + getDesktopModalTopBias();

    return { offsetX: constrainedX, offsetY: constrainedY };
}

function isModalTopAnchored(modal) {
    return modal && modal.dataset.windowContentAnchor === 'top';
}

function isModalResizeTopAnchored(modal) {
    return modal && (modal.dataset.windowResizeAnchor === 'top' || isModalTopAnchored(modal));
}

function clampModalOffsetsForTopAnchor(offsetX, offsetY, width, height, options = {}) {
    const allowOffscreen = options.allowOffscreen === true;
    const minVisible = options.minVisible != null ? options.minVisible : MODAL_MIN_VISIBLE_PX;
    const workArea = getModalWorkAreaBounds();
    const containerWidth = window.innerWidth;
    const trueInsetTop = getModalTrueInsetTop();

    let constrainedX = offsetX;
    let constrainedY = offsetY;

    let centerX = containerWidth / 2 + offsetX;
    let leftEdge = centerX - width / 2;
    let rightEdge = centerX + width / 2;

    if (allowOffscreen) {
        const minLeft = -width + minVisible;
        const maxLeft = containerWidth - minVisible;
        if (leftEdge < minLeft) {
            leftEdge = minLeft;
        } else if (leftEdge > maxLeft) {
            leftEdge = maxLeft;
        }
    } else if (width <= workArea.width) {
        if (leftEdge < workArea.left + MODAL_EDGE_MARGIN_PX) {
            leftEdge = workArea.left + MODAL_EDGE_MARGIN_PX;
        } else if (rightEdge > workArea.right - MODAL_EDGE_MARGIN_PX) {
            leftEdge = workArea.right - MODAL_EDGE_MARGIN_PX - width;
        }
    } else {
        leftEdge = workArea.left + MODAL_EDGE_MARGIN_PX;
    }
    constrainedX = (leftEdge + width / 2) - (containerWidth / 2);

    let topEdge = trueInsetTop + offsetY;
    let bottomEdge = topEdge + height;

    if (allowOffscreen) {
        if (topEdge < 0) {
            constrainedY = -trueInsetTop;
        } else {
            const maxTopEdge = getModalDragMaxTopEdge(minVisible);
            if (topEdge > maxTopEdge) {
                constrainedY = maxTopEdge - trueInsetTop;
            }
        }
    } else if (height <= workArea.height) {
        if (topEdge < workArea.top + MODAL_EDGE_MARGIN_PX) {
            constrainedY = workArea.top + MODAL_EDGE_MARGIN_PX - trueInsetTop;
        } else if (bottomEdge > workArea.bottom - MODAL_EDGE_MARGIN_PX) {
            constrainedY = workArea.bottom - MODAL_EDGE_MARGIN_PX - height - trueInsetTop;
        }
    } else {
        constrainedY = workArea.top + MODAL_EDGE_MARGIN_PX - trueInsetTop;
    }

    return { offsetX: constrainedX, offsetY: constrainedY };
}

function setModalPositionFromViewportRect(modal, rect, options = {}) {
    if (!modal || !rect) {
        return;
    }

    clearModalPixelAnchor(modal);

    const { minWidth, minHeight } = getModalMinDimensions(modal);
    const maxWidth = modal.dataset.windowMaxWidth ? parseInt(modal.dataset.windowMaxWidth, 10) : Infinity;
    const maxHeight = modal.dataset.windowMaxHeight ? parseInt(modal.dataset.windowMaxHeight, 10) : Infinity;
    const width = roundCssPixel(Math.max(minWidth, Math.min(rect.width, maxWidth)));
    const height = roundCssPixel(Math.max(minHeight, Math.min(rect.height, maxHeight)));
    const restoreClamp = options.allowPartialBottomOverflow ? { allowPartialBottomOverflow: true } : {};
    const clamped = clampModalViewportRect(rect.left, rect.top, width, height, null, restoreClamp);
    const left = roundToDevicePixel(clamped.left);
    const top = roundToDevicePixel(clamped.top);

    modal.style.width = `${width}px`;
    modal.style.height = `${height}px`;

    if (isModalTopAnchored(modal)) {
        setModalOffsetsFromViewportTopLeft(modal, left, top, options);
        return;
    }

    const centerX = left + width / 2;
    const centerY = top + height / 2;
    const trueInsetTop = getModalTrueInsetTop();

    let offsetX = centerX - window.innerWidth / 2;
    let offsetY = centerY - window.innerHeight / 2 - (0.5 * trueInsetTop) + getDesktopModalTopBias();

    if (options.allowPartialBottomOverflow) {
        setModalOffsetPx(modal, offsetX, offsetY, { snap: true, settle: true });
    } else {
        const offsetClamped = clampModalOffsetsForRect(offsetX, offsetY, width, height);
        setModalOffsetPx(modal, offsetClamped.offsetX, offsetClamped.offsetY, { snap: true, settle: true });
    }
    modal.setAttribute('data-modal-moved', 'true');
}

function setModalOffsetsFromViewportTopLeft(modal, left, top, options = {}) {
    if (!modal) {
        return;
    }

    clearModalPixelAnchor(modal);

    const layout = getModalLayoutDimensions(modal);
    const width = layout.width;
    const height = layout.height;
    const restoreClamp = options.allowPartialBottomOverflow ? { allowPartialBottomOverflow: true } : {};
    const clamped = clampModalViewportRect(left, top, width, height, null, restoreClamp);
    left = clamped.left;
    top = clamped.top;
    const trueInsetTop = getModalTrueInsetTop();

    if (isModalTopAnchored(modal)) {
        const centerX = left + width / 2;
        let offsetX = centerX - window.innerWidth / 2;
        let offsetY = top - trueInsetTop;
        if (options.allowPartialBottomOverflow) {
            setModalOffsetPx(modal, offsetX, offsetY, { snap: true, settle: true });
        } else {
            const offsetClamped = clampModalOffsetsForTopAnchor(offsetX, offsetY, width, height);
            setModalOffsetPx(modal, offsetClamped.offsetX, offsetClamped.offsetY, { snap: true, settle: true });
        }
        modal.setAttribute('data-modal-moved', 'true');
        return;
    }

    const centerX = left + width / 2;
    const centerY = top + height / 2;
    let offsetX = centerX - window.innerWidth / 2;
    let offsetY = centerY - window.innerHeight / 2 - (0.5 * trueInsetTop) + getDesktopModalTopBias();

    if (options.allowPartialBottomOverflow) {
        setModalOffsetPx(modal, offsetX, offsetY, { snap: true, settle: true });
    } else {
        const offsetClamped = clampModalOffsetsForRect(offsetX, offsetY, width, height);
        setModalOffsetPx(modal, offsetClamped.offsetX, offsetClamped.offsetY, { snap: true, settle: true });
    }
    modal.setAttribute('data-modal-moved', 'true');
}

// Position a child modal offset from its parent (cascade), keeping the child on-screen.
function positionModalCascadeFromParent(childModal, parentModal, options = {}) {
    if (!childModal || !parentModal || parentModal.classList.contains('hidden')) {
        return;
    }

    const cascadeX = options.offsetX != null ? options.offsetX : 28;
    const cascadeY = options.offsetY != null ? options.offsetY : 28;
    const cascadeMode = options.cascadeMode || 'beside';

    const parentRect = parentModal.getBoundingClientRect();
    const childLayout = getModalLayoutDimensions(childModal);
    let childWidth = childLayout.width;
    let childHeight = childLayout.height;
    const workArea = getModalWorkAreaBounds();

    let left;
    let top;
    if (cascadeMode === 'overlap') {
        left = parentRect.left + cascadeX;
        top = parentRect.top + cascadeY;
    } else {
        left = parentRect.right + cascadeX;
        top = parentRect.top;
        if (left + childWidth > workArea.right - MODAL_MIN_VISIBLE_PX) {
            left = parentRect.left + cascadeX;
            top = parentRect.top + cascadeY;
        }
    }

    const minVisible = MODAL_MIN_VISIBLE_PX;
    if (left + childWidth > workArea.right - minVisible) {
        left = Math.max(-childWidth + minVisible, workArea.right - minVisible - childWidth);
    }
    if (left < -childWidth + minVisible) {
        left = -childWidth + minVisible;
    }
    if (top + childHeight > workArea.bottom - minVisible) {
        top = Math.max(workArea.top, workArea.bottom - minVisible - childHeight);
    }
    if (top < workArea.top) {
        top = workArea.top;
    }

    if (options.lockSize === false) {
        setModalOffsetsFromViewportTopLeft(childModal, left, top);
    } else {
        setModalPositionFromViewportRect(childModal, {
            left,
            top,
            width: childWidth,
            height: childHeight
        });
    }
}

/** Resize a window while keeping its visual center fixed (or top edge for top-anchored modals). */
function setModalSizePreservingCenter(modal, newWidth, newHeight, options = {}) {
    if (!modal) {
        return;
    }

    const rect = modal.getBoundingClientRect();
    const centerX = rect.left + rect.width / 2;
    const centerY = rect.top + rect.height / 2;
    const roundedWidth = roundCssPixel(newWidth);
    const roundedHeight = roundCssPixel(newHeight);

    clearModalPixelAnchor(modal);
    modal.style.width = `${roundedWidth}px`;
    modal.style.height = `${roundedHeight}px`;

    if (isModalTopAnchored(modal)) {
        setModalPositionFromViewportRect(modal, {
            left: centerX - roundedWidth / 2,
            top: rect.top,
            width: roundedWidth,
            height: roundedHeight
        });
        return;
    }

    setModalOffsetsFromViewportTopLeft(modal, centerX - roundedWidth / 2, centerY - roundedHeight / 2);

    if (options.settle === false) {
        return;
    }

    ensureModalEdgesWithinWorkArea(modal);
}

function cascadeModalFromParentIfConfigured(modal) {
    if (!modal || modal.dataset.windowPositionMode !== 'cascade-parent') {
        return;
    }

    const parentId = modal.getAttribute('data-parent-modal-id');
    const parentModal = parentId ? document.getElementById(parentId) : null;
    if (!parentModal || parentModal.classList.contains('hidden')) {
        return;
    }

    if (!isModalWithinViewportBounds(parentModal)) {
        resetModalToViewportCenter(parentModal);
    }

    const alignAttr = (modal.dataset.windowCascadeAlign || '').toLowerCase();
    let cascadeMode = 'beside';
    if (alignAttr === 'overlap' || alignAttr === 'stack' || alignAttr === 'top' || alignAttr === 'center') {
        cascadeMode = 'overlap';
    }
    positionModalCascadeFromParent(modal, parentModal, { cascadeMode, lockSize: false });
    ensureModalWithinViewport(modal);
}

function isModalWithinViewportBounds(modal, minVisible = MODAL_MIN_VISIBLE_PX) {
    if (!modal || modal.classList.contains('hidden')) {
        return true;
    }

    const rect = modal.getBoundingClientRect();
    const width = rect.width;
    const height = rect.height;
    if (!width || !height) {
        return false;
    }

    const workArea = getModalWorkAreaBounds();
    const visibleLeft = Math.max(workArea.left, rect.left);
    const visibleRight = Math.min(workArea.right, rect.right);
    const visibleTop = Math.max(workArea.top, rect.top);
    const visibleBottom = Math.min(workArea.bottom, rect.bottom);
    const visibleWidth = Math.max(0, visibleRight - visibleLeft);
    const visibleHeight = Math.max(0, visibleBottom - visibleTop);

    return visibleWidth >= minVisible && visibleHeight >= minVisible;
}

function getWindowPositionKey(modal) {
    if (!modal) {
        return null;
    }

    const isTransient = modal.classList.contains('transient');
    if (isTransient && modal.dataset.windowIdentifier) {
        return modal.dataset.windowIdentifier;
    }
    if (!isTransient) {
        const modalType = getModalType(modal);
        return modal.id || modalType;
    }
    return null;
}

function resetModalToViewportCenter(modal) {
    if (!modal) {
        return;
    }

    clearModalPixelAnchor(modal);
    modal.style.removeProperty('width');
    modal.style.removeProperty('height');

    applyModalDefaultWindowSize(modal);

    const layout = getModalLayoutDimensions(modal);
    const width = layout.width;
    const height = layout.height;
    const workArea = getModalWorkAreaBounds();
    const left = workArea.left + Math.max(0, (workArea.width - width) / 2);
    const top = workArea.top + Math.max(0, (workArea.height - height) / 2);

    if (isModalTopAnchored(modal)) {
        setModalOffsetsFromViewportTopLeft(modal, left, top);
        return;
    }

    setModalOffsetPx(modal, 0, 0, { snap: true, settle: true });
    modal.removeAttribute('data-modal-moved');
}

function resetModalWindowLayout(modal) {
    if (!modal) {
        return;
    }

    const windowKey = getWindowPositionKey(modal);
    if (windowKey && globalWindowPositions[windowKey]) {
        delete globalWindowPositions[windowKey];
    }

    if (isModalMaximized(modal)) {
        restoreModalFromMaximize(modal);
    }

    clearModalPixelAnchor(modal);
    modal.style.removeProperty('width');
    modal.style.removeProperty('height');
    modal.removeAttribute('data-window-position-restored');

    resetModalToViewportCenter(modal);
    ensureModalEdgesWithinWorkArea(modal);
    debouncedSaveWindowPositions();
}

function ensureModalEdgesWithinWorkArea(modal, edgeMarginPx) {
    if (!modal || modal.classList.contains('hidden') || isModalMaximized(modal)) {
        return;
    }

    const applyClamp = () => {
        if (!modal || modal.classList.contains('hidden') || isModalMaximized(modal)) {
            return;
        }

        const rect = modal.getBoundingClientRect();
        if (!rect.width || !rect.height) {
            return;
        }

        const restoreClamp = { allowPartialBottomOverflow: true };
        const clamped = clampModalViewportRect(rect.left, rect.top, rect.width, rect.height, edgeMarginPx, restoreClamp);
        if (Math.abs(clamped.left - rect.left) > 0.5 || Math.abs(clamped.top - rect.top) > 0.5) {
            setModalOffsetsFromViewportTopLeft(modal, clamped.left, clamped.top, restoreClamp);
        } else {
            settleModalPixelAnchor(modal);
        }
    };

    requestAnimationFrame(() => {
        requestAnimationFrame(applyClamp);
    });
}

function ensureModalWithinViewport(modal) {
    ensureModalEdgesWithinWorkArea(modal);
}

// Update window usage stack - add modal to top of stack (most recent at end)
function updateWindowUsageStack(modal) {
    if (!modal || !modal.classList.contains('modal')) return;

    // Only track moveable windows (those with title bars) in the usage stack
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    if (!hasTitleBar) return;

    // Skip on-top modals from usage stack (they're always active)
    if (modal.classList.contains('on-top')) return;

    // Remove modal from stack if it's already there
    const existingIndex = windowUsageStack.indexOf(modal);
    if (existingIndex !== -1) {
        windowUsageStack.splice(existingIndex, 1);
    }

    // Add to end of stack (most recent at end)
    windowUsageStack.push(modal);
}

// Get window usage stack (for window switcher - returns in reverse order, most recent first)
function getWindowUsageStack() {
    // Return copy in reverse order (most recent first)
    return [...windowUsageStack].reverse();
}


// Set the active window by adding/removing active-window class
function setActiveWindow(modalId) {
    if (modalId) {
        const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
        if (!modal || !modal.classList.contains('modal')) {
            currentActiveWindowId = null;
            debouncedUpdateTaskbarWindows();
            return;
        }

        // Check if this is a tool window
        if (isToolWindow(modal)) {
            // Tool windows don't remove active class from main window
            // Just add active class to this tool window
            modal.classList.add('active-window');
            currentActiveWindowId = modal.id;
            // Don't update mainActiveWindowId - preserve the main window's active state
        } else {
            // Regular window - remove active-window class from all modals (including tool windows)
            // But preserve active-window class on on-top modals
            document.querySelectorAll('.modal').forEach(m => {
                if (m.id === 'windowsStartupModal' || m.id === 'windowsUpdateModal' || m.id === 'connectionDialModal') return;
                // Don't remove active-window from on-top modals
                if (!m.classList.contains('on-top')) {
                    m.classList.remove('active-window');
                }
            });

            // Set new active window
            modal.classList.add('active-window');
            currentActiveWindowId = modal.id;
            mainActiveWindowId = modal.id; // Update main active window

            // Linked tool windows (e.g. Jump Index) share focus with the parent so overlays stay pass-through and both stay scrollable.
            getLinkedToolWindows(modal).forEach((tw) => {
                tw.classList.add('active-window');
            });

            // Update usage stack for main windows
            updateWindowUsageStack(modal);
        }

        // Ensure all on-top modals have active-window class (doesn't affect taskbar)
        document.querySelectorAll('.modal.on-top').forEach(onTopModal => {
            onTopModal.classList.add('active-window');
        });
    } else {
        // Clear active window - remove from all modals except on-top modals
        document.querySelectorAll('.modal').forEach(modal => {
            if (!modal.classList.contains('on-top')) {
                modal.classList.remove('active-window');
            }
        });
        // Ensure on-top modals still have active-window class
        document.querySelectorAll('.modal.on-top').forEach(onTopModal => {
            onTopModal.classList.add('active-window');
        });
        currentActiveWindowId = null;
        mainActiveWindowId = null;
    }
    updateTaskbarActiveStates();
}

function getTopOpenModal() {
    if (modalStack.length === 0) return null;
    return modalStack[modalStack.length - 1];
}

function initializeModalDragging() {
    // Tier A permanent globals (modal-listener-refactor-plan.md) — keep on document/window; gate in handlers:
    // focus, visibilitychange — focus grace period (top of modalUtils.js)
    // mousedown/mousemove/mouseup, touchstart/touchmove/touchend — drag/resize (below)
    // click — minimize button, desktop empty-space clear-active (below)
    // contextMenuAction — taskbar context menu (initializeDesktopTaskbar)
    // DOMContentLoaded — bootstrap dragging, taskbar, start menu (bottom of modalUtils.js)
    // Gallery window resize — attachModalListeners(galleryWindow) in activateGalleryResizeListener
    // Start menu outside-click — AbortController in openStartMenu/closeStartMenu

    // Add drag functionality to all modal title bars
    document.addEventListener('mousedown', handleModalInteraction);
    document.addEventListener('mousemove', handleModalInteraction);
    document.addEventListener('mouseup', handleModalInteractionEnd);

    // Add touch support for dragging and resizing
    document.addEventListener('touchstart', handleModalInteraction, { passive: false });
    document.addEventListener('touchmove', handleModalInteraction, { passive: false });
    document.addEventListener('touchend', handleModalInteractionEnd, { passive: false });

    // Add global minimize button handler
    document.addEventListener('click', (e) => {
        const minimizeBtn = e.target.closest('.minimize-btn');
        if (!minimizeBtn) return;

        const modal = minimizeBtn.closest('.modal');
        if (modal) {
            e.preventDefault();
            e.stopPropagation();

            // Studio cannot be minimised in app mode (non-desktop)
            if (modal.id === 'manualModal' && !document.body.classList.contains('desktop-mode')) {
                return;
            }

            // Get or create the taskbar item to minimize to
            const taskbarItem = getOrCreateTaskbarItem(modal);
            if (taskbarItem) {
                setMinimizeTargetVariables(modal, taskbarItem);
            }

            // Add minimising animation class
            modal.classList.add('minimising');

            // After animation completes, add minimised class and remove animation class
            const minimisingAnimationHandler = (e) => {
                // Only handle animations on this modal while it has the minimising class
                if (e.target === modal && e.animationName === 'modalMinimize' && modal.classList.contains('minimising')) {
                    modal.removeEventListener('animationend', minimisingAnimationHandler);
                    modal.classList.add('minimised');
                    modal.classList.remove('minimising');
                    debouncedUpdateTaskbarWindows();
                    updateBackdropVisibility();
                }
            };
            modal.addEventListener('animationend', minimisingAnimationHandler);
        }
    });

    // Add desktop click handler to clear active window when clicking empty desktop space
    // This handler checks if the click is on desktop area (not on windows, icons, or other interactive elements)
    document.addEventListener('click', (e) => {
        // Only handle in desktop mode
        if (!document.body.classList.contains('desktop-mode')) return;

        // Don't handle if clicking on a modal or its children
        if (e.target.closest('.modal')) return;

        // Don't handle if clicking on desktop icons/shortcuts or their children
        if (e.target.closest('.desktop-icon, .desktop-shortcut')) return;

        // Don't handle if clicking on taskbar
        if (e.target.closest('#desktopTaskbar')) return;

        // Don't handle if clicking on start menu
        if (e.target.closest('#startMenu')) return;

        // Check if click is on desktop area (empty desktop space)
        const desktopFreeformContainer = document.getElementById('desktopFreeformContainer');
        const desktopGridContainer = document.getElementById('desktopGridContainer');
        const desktopIcons = document.getElementById('desktopIcons');

        // Click is on desktop if:
        // 1. Directly on the freeform container (empty space)
        // 2. Directly on the grid container (empty space)
        // 3. Directly on the desktop-icons container (empty space)
        const clickedOnDesktop =
            e.target === desktopFreeformContainer ||
            e.target === desktopGridContainer ||
            e.target === desktopIcons;

        if (clickedOnDesktop) {
            // Don't clear active window if clicking right after browser window regained focus
            const timeSinceFocus = Date.now() - windowFocusRegainedTime;
            if (timeSinceFocus < FOCUS_GRACE_PERIOD) {
                return; // User is just trying to regain browser window focus
            }

            // Clear active window (make no window active)
            setActiveWindow(null);
        }
    });
}

function handleModalInteraction(e) {
    if (e.type === 'mousedown' || e.type === 'touchstart') {
        handleModalDragStart(e) || handleModalResizeStart(e);
    } else if (e.type === 'mousemove' || e.type === 'touchmove') {
        // Find any modal that's currently being dragged or resized
        const draggedModal = document.querySelector('.modal[data-dragging="true"]');
        const resizedModal = document.querySelector('.modal[data-resizing="true"]');

        if (draggedModal) {
            handleModalDrag(e, draggedModal);
        } else if (resizedModal) {
            handleModalResize(e, resizedModal);
        }
    }
}

function handleModalInteractionEnd(e) {
    // Find any modal that's currently being dragged or resized
    const draggedModal = document.querySelector('.modal[data-dragging="true"]');
    const resizedModal = document.querySelector('.modal[data-resizing="true"]');

    if (draggedModal) {
        handleModalDragEnd(e, draggedModal);
    } else if (resizedModal) {
        handleModalResizeEnd(e, resizedModal);
    }
}

function handleModalDragStart(e) {
    // Check if clicked element is a modal title bar
    const titleBar = e.target.closest('.modal-window-title');
    if (!titleBar) return;

    if (e.target.closest('.modal-window-title-toolbar')) return;
    if (e.target.closest('button, input, select, textarea, a, [role="button"]')) return;

    const toolbar = titleBar.querySelector('.modal-window-title-toolbar');
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    const bandBottom = toolbar
        ? toolbar.getBoundingClientRect().top
        : titleBar.getBoundingClientRect().bottom;

    if (clientY >= bandBottom) return;

    const modal = titleBar.closest('.modal');
    if (!modal) return;

    // Prevent dragging if modal is hidden or animating
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt') || modal.classList.contains('opening') || modal.classList.contains('closing')) {
        return;
    }

    e.preventDefault();

    prepareModalForDragOrResize(modal);

    // Get coordinates from touch or mouse event
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;

    // Store drag state as data attributes on the modal
    modal.setAttribute('data-dragging', 'true');
    modal.setAttribute('data-drag-start-x', clientX);
    modal.setAttribute('data-drag-start-y', clientY);

    // Get current offset values and store them
    const computedStyle = getComputedStyle(modal);
    const modalStartOffsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const modalStartOffsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');

    modal.setAttribute('data-modal-start-offset-x', modalStartOffsetX);
    modal.setAttribute('data-modal-start-offset-y', modalStartOffsetY);

    // Add dragging class to title bar
    titleBar.classList.add('dragging');

    if (isLiveWindowRepositioningEnabled()) {
        showWindowFrameForModal(modal);
    }

    // Bring modal to front when dragging starts (only for moveable modals)
    // Manual modal participates in stacking when windowed
    const isBlocked = modal.id === 'manualModal' && !modal.classList.contains('windowed');
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isBlocked;

    if (isMoveable) {
        bringModalToFront(modal);
    }

    // Check backdrop when starting drag (in case this was the only non-transient modal)
    updateBackdropVisibility();

    return true;
}

function handleModalDrag(e, draggedModal) {
    if (!draggedModal) return;

    e.preventDefault();

    const dragStartX = parseFloat(draggedModal.getAttribute('data-drag-start-x'));
    const dragStartY = parseFloat(draggedModal.getAttribute('data-drag-start-y'));
    const modalStartOffsetX = parseFloat(draggedModal.getAttribute('data-modal-start-offset-x'));
    const modalStartOffsetY = parseFloat(draggedModal.getAttribute('data-modal-start-offset-y'));

    // Get coordinates from touch or mouse event
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - dragStartX;
    const deltaY = clientY - dragStartY;

    let newOffsetX = modalStartOffsetX + deltaX;
    let newOffsetY = modalStartOffsetY + deltaY;

    // Mark modal as moved if it hasn't been moved before
    if (!draggedModal.hasAttribute('data-modal-moved')) {
        draggedModal.setAttribute('data-modal-moved', 'true');
        // Since modal was just moved, update backdrop state
        updateBackdropVisibility();
    }

    // Get modal dimensions
    const modalRect = draggedModal.getBoundingClientRect();

    const clamped = isModalTopAnchored(draggedModal)
        ? clampModalOffsetsForTopAnchor(newOffsetX, newOffsetY, modalRect.width, modalRect.height, { allowOffscreen: true })
        : clampModalOffsetsForRect(newOffsetX, newOffsetY, modalRect.width, modalRect.height, { allowOffscreen: true });
    newOffsetX = clamped.offsetX;
    newOffsetY = clamped.offsetY;

    if (isLiveWindowRepositioningEnabled()) {
        draggedModal.setAttribute('data-preview-offset-x', String(newOffsetX));
        draggedModal.setAttribute('data-preview-offset-y', String(newOffsetY));
        const width = modalRect.width;
        const height = modalRect.height;
        const trueInsetTop = getModalTrueInsetTop();
        const left = (window.innerWidth / 2) + newOffsetX - (width / 2);
        const top = isModalTopAnchored(draggedModal)
            ? trueInsetTop + newOffsetY
            : (window.innerHeight / 2) + newOffsetY + (0.5 * trueInsetTop) - getDesktopModalTopBias() - (height / 2);
        updateWindowFrameRect({ left, top, width, height });
        return;
    }

    setModalOffsetPx(draggedModal, newOffsetX, newOffsetY, { snap: false, settle: false });
}

function handleModalDragEnd(e, draggedModal) {
    if (!draggedModal) return;

    const titleBar = draggedModal.querySelector('.modal-window-title');
    if (titleBar) {
        titleBar.classList.remove('dragging');
    }

    // Clear drag state data attributes
    draggedModal.removeAttribute('data-dragging');
    draggedModal.removeAttribute('data-drag-start-x');
    draggedModal.removeAttribute('data-drag-start-y');
    draggedModal.removeAttribute('data-modal-start-offset-x');
    draggedModal.removeAttribute('data-modal-start-offset-y');

    let offsetX;
    let offsetY;
    if (isLiveWindowRepositioningEnabled()) {
        offsetX = parseFloat(draggedModal.getAttribute('data-preview-offset-x'));
        offsetY = parseFloat(draggedModal.getAttribute('data-preview-offset-y'));
        if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
            const computedStyle = getComputedStyle(draggedModal);
            offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
            offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');
        }
        hideWindowFrame();
        draggedModal.removeAttribute('data-preview-offset-x');
        draggedModal.removeAttribute('data-preview-offset-y');
    } else {
        const computedStyle = getComputedStyle(draggedModal);
        offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
        offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');
    }
    setModalOffsetPx(draggedModal, offsetX, offsetY, { snap: true, settle: true });

    // Check backdrop when stopping drag
    updateBackdropVisibility();

    // Save window position if this is a non-transient window, or transient window with dataset identifier
    const isTransient = draggedModal.classList.contains('transient');
    if (windowRestoresPosition(draggedModal)
        && (!isTransient || (draggedModal.dataset.windowIdentifier && transientWindowsWithPositions.has(draggedModal.dataset.windowIdentifier)))
        && !draggedModal.classList.contains('modal-maximized')) {
        debouncedSaveWindowPositions();
    }
}

function handleModalResizeStart(e) {
    // Check if clicked element is a resize handle
    const resizeHandle = e.target.closest('.resize-handle');
    if (!resizeHandle) return false;

    const modal = resizeHandle.closest('.modal');
    if (!modal) return false;

    // Prevent resizing if modal is hidden or animating
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt') || modal.classList.contains('opening') || modal.classList.contains('closing')) {
        return false;
    }

    e.preventDefault();

    prepareModalForDragOrResize(modal);

    // Get coordinates from touch or mouse event
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    // Store resize state as data attributes on the modal
    modal.setAttribute('data-resizing', 'true');
    modal.setAttribute('data-resize-start-x', clientX);
    modal.setAttribute('data-resize-start-y', clientY);

    // Get modal current dimensions and position and store them
    const modalRect = modal.getBoundingClientRect();
    modal.setAttribute('data-resize-start-width', modalRect.width);
    modal.setAttribute('data-resize-start-height', modalRect.height);
    modal.setAttribute('data-resize-start-left', modalRect.left);
    modal.setAttribute('data-resize-start-top', modalRect.top);

    // Determine resize direction from handle classes and store it
    let resizeDirection = '';
    if (resizeHandle.classList.contains('nw')) resizeDirection = 'nw';
    else if (resizeHandle.classList.contains('ne')) resizeDirection = 'ne';
    else if (resizeHandle.classList.contains('sw')) resizeDirection = 'sw';
    else if (resizeHandle.classList.contains('se')) resizeDirection = 'se';
    else if (resizeHandle.classList.contains('n')) resizeDirection = 'n';
    else if (resizeHandle.classList.contains('s')) resizeDirection = 's';
    else if (resizeHandle.classList.contains('w')) resizeDirection = 'w';
    else if (resizeHandle.classList.contains('e')) resizeDirection = 'e';

    modal.setAttribute('data-resize-direction', resizeDirection);

    if (isLiveWindowRepositioningEnabled()) {
        showWindowFrameForModal(modal);
    }

    // Bring modal to front when resizing starts (only for moveable modals)
    const isBlocked = modal.id === 'manualModal' && !modal.classList.contains('windowed');
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isBlocked;

    if (isMoveable) {
        bringModalToFront(modal);
    }

    // Check backdrop when starting resize
    updateBackdropVisibility();

    return true;
}

function handleModalResize(e, resizedModal) {
    if (!resizedModal) return;

    e.preventDefault();

    const resizeStartX = parseFloat(resizedModal.getAttribute('data-resize-start-x'));
    const resizeStartY = parseFloat(resizedModal.getAttribute('data-resize-start-y'));
    const resizeStartWidth = parseFloat(resizedModal.getAttribute('data-resize-start-width'));
    const resizeStartHeight = parseFloat(resizedModal.getAttribute('data-resize-start-height'));
    const resizeStartLeft = parseFloat(resizedModal.getAttribute('data-resize-start-left'));
    const resizeStartTop = parseFloat(resizedModal.getAttribute('data-resize-start-top'));
    const resizeDirection = resizedModal.getAttribute('data-resize-direction');

    // Get coordinates from touch or mouse event
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - resizeStartX;
    const deltaY = clientY - resizeStartY;

    let newWidth = resizeStartWidth;
    let newHeight = resizeStartHeight;
    let newLeft = resizeStartLeft;
    let newTop = resizeStartTop;
    let shouldUpdatePosition = false;

    // Calculate new dimensions and position based on resize direction
    // This implements OS-like window resizing where the opposite edge/corner stays fixed

    // Handle horizontal resizing
    if (resizeDirection.includes('w')) {
        // Left edge: width changes AND left position moves (right edge stays anchored)
        const widthChange = -deltaX; // Negative because we're moving left edge left/right
        newWidth = Math.max(200, resizeStartWidth + widthChange);
        newLeft = resizeStartLeft + (resizeStartWidth - newWidth);
        shouldUpdatePosition = true;
    } else if (resizeDirection.includes('e')) {
        // Right edge: width changes, left edge stays anchored
        newWidth = Math.max(200, resizeStartWidth + deltaX);
        newLeft = resizeStartLeft; // Keep left position fixed
        shouldUpdatePosition = true;
    }

    // Handle vertical resizing
    if (resizeDirection.includes('n')) {
        // Top edge: height changes AND top position moves (bottom edge stays anchored)
        const heightChange = -deltaY; // Negative because we're moving top edge up/down
        newHeight = Math.max(150, resizeStartHeight + heightChange);
        newTop = resizeStartTop + (resizeStartHeight - newHeight);
        shouldUpdatePosition = true;
    } else if (resizeDirection.includes('s')) {
        // Bottom edge: height changes, top edge stays anchored
        newHeight = Math.max(150, resizeStartHeight + deltaY);
        newTop = resizeStartTop; // Keep top position fixed
        shouldUpdatePosition = true;
    }

    // Apply constraints based on dataset values
    const maxWidth = resizedModal.dataset.windowMaxWidth ?
        parseInt(resizedModal.dataset.windowMaxWidth) : Infinity;
    const maxHeight = resizedModal.dataset.windowMaxHeight ?
        parseInt(resizedModal.dataset.windowMaxHeight) : Infinity;
    const minWidth = resizedModal.dataset.windowMinWidth ?
        parseInt(resizedModal.dataset.windowMinWidth) : 200; // Reasonable minimum
    const minHeight = resizedModal.dataset.windowMinHeight ?
        parseInt(resizedModal.dataset.windowMinHeight) : 150; // Reasonable minimum

    newWidth = Math.max(minWidth, Math.min(newWidth, maxWidth));
    newHeight = Math.max(minHeight, Math.min(newHeight, maxHeight));

    const workArea = getModalWorkAreaBounds();
    if (resizeDirection.includes('e') && !resizeDirection.includes('w')) {
        newWidth = Math.min(newWidth, workArea.right - resizeStartLeft);
    }
    if (resizeDirection.includes('w') && !resizeDirection.includes('e')) {
        const maxWidthFromWorkArea = resizeStartLeft + resizeStartWidth - workArea.left;
        newWidth = Math.min(newWidth, maxWidthFromWorkArea);
        newLeft = resizeStartLeft + resizeStartWidth - newWidth;
    }
    if (resizeDirection.includes('s') && !resizeDirection.includes('n')) {
        newHeight = Math.min(newHeight, workArea.bottom - resizeStartTop);
    }
    if (resizeDirection.includes('n') && !resizeDirection.includes('s')) {
        const maxHeightFromWorkArea = resizeStartTop + resizeStartHeight - workArea.top;
        newHeight = Math.min(newHeight, maxHeightFromWorkArea);
        newTop = resizeStartTop + resizeStartHeight - newHeight;
    }

    newWidth = Math.max(minWidth, roundCssPixel(newWidth));
    newHeight = Math.max(minHeight, roundCssPixel(newHeight));

    const topAnchoredResize = isModalResizeTopAnchored(resizedModal);
    if (isLiveWindowRepositioningEnabled()) {
        let previewLeft = newLeft;
        let previewTop = newTop;
        if (topAnchoredResize) {
            previewTop = resizeStartTop;
            previewLeft = resizeDirection.includes('w')
                ? resizeStartLeft + resizeStartWidth - newWidth
                : resizeStartLeft;
        }
        updateWindowFrameRect({
            left: previewLeft,
            top: previewTop,
            width: newWidth,
            height: newHeight
        });
        resizedModal.setAttribute('data-preview-width', String(newWidth));
        resizedModal.setAttribute('data-preview-height', String(newHeight));
        resizedModal.setAttribute('data-preview-left', String(previewLeft));
        resizedModal.setAttribute('data-preview-top', String(previewTop));
        return;
    }

    resizedModal.style.width = `${newWidth}px`;
    resizedModal.style.height = `${newHeight}px`;

    if (topAnchoredResize) {
        let anchorLeft = resizeStartLeft;
        if (resizeDirection.includes('w')) {
            anchorLeft = resizeStartLeft + resizeStartWidth - newWidth;
        }
        setModalPositionFromViewportRect(resizedModal, {
            left: anchorLeft,
            top: resizeStartTop,
            width: newWidth,
            height: newHeight
        });
        return;
    }

    // Update position so the anchored edge/corner stays fixed while resizing
    if (shouldUpdatePosition) {
        const trueInsetTop = getModalTrueInsetTop();
        let offsetX = (newLeft + newWidth / 2) - (window.innerWidth / 2);
        let offsetY = (newTop + newHeight / 2) - (window.innerHeight / 2) - (0.5 * trueInsetTop) + getDesktopModalTopBias();
        const clamped = clampModalOffsetsForRect(offsetX, offsetY, newWidth, newHeight);
        setModalOffsetPx(resizedModal, clamped.offsetX, clamped.offsetY, { snap: false, settle: false });
    }
}

function handleModalResizeEnd(e, resizedModal) {
    if (!resizedModal) return;

    if (isLiveWindowRepositioningEnabled()) {
        const previewWidth = parseFloat(resizedModal.getAttribute('data-preview-width'));
        const previewHeight = parseFloat(resizedModal.getAttribute('data-preview-height'));
        const previewLeft = parseFloat(resizedModal.getAttribute('data-preview-left'));
        const previewTop = parseFloat(resizedModal.getAttribute('data-preview-top'));
        const topAnchoredResize = isModalResizeTopAnchored(resizedModal);

        if (Number.isFinite(previewWidth) && Number.isFinite(previewHeight) && Number.isFinite(previewLeft) && Number.isFinite(previewTop)) {
            resizedModal.style.width = `${previewWidth}px`;
            resizedModal.style.height = `${previewHeight}px`;
            if (topAnchoredResize) {
                setModalPositionFromViewportRect(resizedModal, {
                    left: previewLeft,
                    top: previewTop,
                    width: previewWidth,
                    height: previewHeight
                });
            } else {
                const trueInsetTop = getModalTrueInsetTop();
                const offsetX = (previewLeft + previewWidth / 2) - (window.innerWidth / 2);
                const offsetY = (previewTop + previewHeight / 2) - (window.innerHeight / 2) - (0.5 * trueInsetTop) + getDesktopModalTopBias();
                const clamped = clampModalOffsetsForRect(offsetX, offsetY, previewWidth, previewHeight);
                setModalOffsetPx(resizedModal, clamped.offsetX, clamped.offsetY, { snap: false, settle: false });
            }
        }

        resizedModal.removeAttribute('data-preview-width');
        resizedModal.removeAttribute('data-preview-height');
        resizedModal.removeAttribute('data-preview-left');
        resizedModal.removeAttribute('data-preview-top');
        hideWindowFrame();
    }

    const computedStyle = getComputedStyle(resizedModal);
    const offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');
    setModalOffsetPx(resizedModal, offsetX, offsetY, { snap: true, settle: true });

    // Check backdrop when stopping resize
    updateBackdropVisibility();

    // Clear resize state data attributes
    resizedModal.removeAttribute('data-resizing');
    resizedModal.removeAttribute('data-resize-start-x');
    resizedModal.removeAttribute('data-resize-start-y');
    resizedModal.removeAttribute('data-resize-start-width');
    resizedModal.removeAttribute('data-resize-start-height');
    resizedModal.removeAttribute('data-resize-start-left');
    resizedModal.removeAttribute('data-resize-start-top');
    resizedModal.removeAttribute('data-resize-direction');
    resizedModal.dispatchEvent(new CustomEvent('modalResized', {
        bubbles: false,
        detail: { modal: resizedModal }
    }));

    // Save window position if this is a non-transient window, or transient window with dataset identifier
    const isTransient = resizedModal.classList.contains('transient');
    if ((windowRestoresPosition(resizedModal) || windowRestoresSize(resizedModal))
        && (!isTransient || (resizedModal.dataset.windowIdentifier && transientWindowsWithPositions.has(resizedModal.dataset.windowIdentifier)))
        && !resizedModal.classList.contains('modal-maximized')) {
        debouncedSaveWindowPositions();
    }
}

function openModal(modal) {
    if (!modal) return;

    // Check if modal is already open (not hidden and not hidden-alt)
    const isAlreadyOpen = !modal.classList.contains('hidden') && !modal.classList.contains('hidden-alt');
    // Manual modal is blocked from stacking only when not windowed AND not in desktop-mode
    // In desktop-mode, it should be part of the window stack even when maximized
    const isBlocked = modal.id === 'manualModal' && !modal.classList.contains('windowed') && !window.isDesktop;
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isBlocked;

    if (isAlreadyOpen) {
        // Modal is already open, bring it to front if it's moveable
        if (isMoveable) {
            bringModalToFront(modal);
        }
        return;
    }

    // Check if modal is soft-opened (has hidden-alt class)
    // If so, remove hidden-alt and proceed with normal opening animation
    const isSoftOpened = modal.classList.contains('hidden-alt');

    // Restore window position BEFORE opening and animating
    // This ensures the position is set before the opening animation starts
    // Restore for non-transient windows, or transient windows with dataset identifier
    if (isMoveable && window.isDesktop) {
        const skipRestore = modal.dataset.windowPositionMode === 'cascade-parent'
            || modal.dataset.windowPositionMode === 'run-open'
            || modal.dataset.windowPositionMode === 'manual-only';
        const isTransient = modal.classList.contains('transient');
        const isLumenViewer = modal.classList.contains('image-viewer-modal');
        if (!skipRestore && !isLumenViewer && windowRestoresPosition(modal)
            && (!isTransient || (modal.dataset.windowIdentifier && transientWindowsWithPositions.has(modal.dataset.windowIdentifier)))) {
            restoreWindowPosition(modal);
        }
        if (!modal.hasAttribute('data-window-position-restored')) {
            applyModalDefaultWindowSize(modal);
        }
    }

    // Check if this modal should trigger backdrop display
    // Modals that are transient OR have been moved don't trigger backdrop
    const shouldTriggerBackdrop = !modal.classList.contains('transient') && !modal.hasAttribute('data-modal-moved');

    if (shouldTriggerBackdrop) {
        // Check if this is the first non-transient, non-moved modal opening
        const draggedModal = document.querySelector('.modal[data-dragging="true"]');
        const otherOpenNonTransientModals = Array.from(document.querySelectorAll('.modal')).filter(m =>
            m !== modal &&
            !m.classList.contains('hidden') &&
            !m.classList.contains('minimised') &&
            (!m.classList.contains('transient') && !m.hasAttribute('data-modal-moved')) &&
            m !== draggedModal
        );
        const isFirstNonTransientModal = otherOpenNonTransientModals.length === 0;

        // If this is the first non-transient, non-moved modal, animate the backdrop in
        if (isFirstNonTransientModal && backdrop) {
            backdrop.classList.remove('fade-out');
            backdrop.classList.add('fade-in');
        }
    }

    // If this is an on-top tool window and doesn't already have a parent link, link it to the main active window
    if (isToolWindow(modal) && modal.classList.contains('on-top') && !modal.hasAttribute('data-parent-modal-id')) {
        // Link to main active window if available
        if (mainActiveWindowId) {
            const mainWindow = document.getElementById(mainActiveWindowId);
            if (mainWindow && !mainWindow.classList.contains('hidden')) {
                linkToolWindowToParent(modal, mainWindow);
            }
        }
    }

    // Assign z-index to modal (newly opened modals go on top) - but only for moveable modals
    if (isMoveable) {
        assignModalZIndex(modal);
    }

    // Add resize handles for resizable windows
    if (modal.classList.contains('resizeable-window')) {
        addResizeHandles(modal);
    }

    // Wire work-area maximize only for .modal-work-area-maximize (Lumen image viewer)
    wireModalMaximizeButton(modal);

    // Lumen restores after visible — openModal skips .image-viewer-modal (public/scripts/comp/imageViewer.js)

    // Reveal before animating — hidden-alt pauses CSS animations while display:none
    if (isSoftOpened) {
        modal.classList.remove('hidden-alt');
    }
    modal.classList.remove('hidden');

    modal.classList.remove('opening');
    void modal.offsetWidth;
    modal.classList.add('opening');

    // body.initializing.no-animation disables CSS animations — animationend never fires; clear opening immediately
    if (document.body.classList.contains('initializing') && document.body.classList.contains('no-animation')) {
        modal.classList.remove('opening');
    }

    // Update taskbar (debounced for performance)
    debouncedUpdateTaskbarWindows();

    // Only add modal-open class for non-transient, non-moved modals
    if (!modal.classList.contains('transient') && !modal.hasAttribute('data-modal-moved')) {
        document.body.classList.add('modal-open');
    }

    // Per-modal listener scope — modalListenerScope.js
    onModalOpened(modal);
    const modalListenerSignal = getModalListenerSignal(modal);

    // Add click handler to bring modal to front when clicking anywhere inside it
    const clickHandler = (e) => {
        // Verify the click is actually inside this modal (prevent activation when clicking in other windows)
        if (!modal.contains(e.target)) {
            return;
        }
        // Only skip if clicking on resize handles (title bar dragging is handled separately)
        // Allow clicks on all other elements (buttons, inputs, etc.) to activate the window
        if (!e.target.closest('.resize-handle')) {
            handleModalClick(modal);
        }
    };
    const clickHandlerOptions = modalListenerSignal ? { signal: modalListenerSignal } : undefined;
    modal.addEventListener('mousedown', clickHandler, clickHandlerOptions);

    // Store the click handler for cleanup (legacy path during migration)
    modal._modalClickHandler = clickHandler;

    // Remove opening class after animation completes
    const openingAnimationHandler = (e) => {
        // Only handle animations on this modal while it has the opening class
        if (e.target === modal && (e.animationName === 'modalSlideIn' || e.animationName === 'modalSlideInTopAnchor' || e.animationName === 'modalFadeIn') && modal.classList.contains('opening')) {
            modal.removeEventListener('animationend', openingAnimationHandler);
            modal.classList.remove('opening');
            if (isMoveable && !modal.classList.contains('hidden')) {
                if (modal.dataset.windowPositionMode === 'manual-only') {
                    // #windowsStartupModal uses top-left offsets, not center + pixel-settle
                    if (modal.id === 'windowsStartupModal') {
                        return;
                    }
                    if (modal.id === 'confirmationDialog') {
                        if (modal.dataset.confirmationPreplaced === '1') {
                            settleModalPixelAnchor(modal);
                        } else {
                            ensureModalEdgesWithinWorkArea(modal, 20);
                        }
                        return;
                    }
                    settleModalPixelAnchor(modal);
                } else if (modal.hasAttribute('data-window-position-restored')) {
                    settleModalPixelAnchor(modal);
                } else {
                    ensureModalEdgesWithinWorkArea(modal);
                }
            }
        }
    };
    modal.addEventListener('animationend', openingAnimationHandler);

    if (modal.dataset.windowPositionMode === 'cascade-parent') {
        requestAnimationFrame(() => requestAnimationFrame(() => cascadeModalFromParentIfConfigured(modal)));
    } else if (isMoveable && modal.dataset.windowPositionMode !== 'manual-only' && !modal.hasAttribute('data-window-position-restored')) {
        ensureModalWithinViewport(modal);
    }

    // prepareGalleryWindowContent: public/scripts/comp/galleryView.js
    if (modal.id === 'galleryWindow' && modal.classList.contains('windowed')
        && typeof prepareGalleryWindowContent === 'function') {
        prepareGalleryWindowContent().catch((err) => {
            console.error('Gallery prepare failed:', err);
        });
    }
}

async function closeModal(modal) {
    if (!modal) return;

    // If this is a main modal (not a tool window), close linked tool windows first
    if (!isToolWindow(modal)) {
        const linkedToolWindows = getLinkedToolWindows(modal);
        if (linkedToolWindows.length > 0) {
            // Close all tool windows in the background (don't wait for them)
            linkedToolWindows.forEach(toolWindow => {
                // Check if tool window is already closing or hidden
                if (!toolWindow.classList.contains('closing') && !toolWindow.classList.contains('hidden')) {
                    // Start closing the tool window (runs in background)
                    closeModal(toolWindow);
                }
            });

            // Close the main modal and wait for it
            await closeMainModal(modal);
            return;
        }
    }

    // If no tool windows to wait for, proceed with normal close and wait for it
    await closeMainModal(modal);
}

function closeMainModal(modal) {
    if (!modal) return Promise.resolve();

    if (shouldPersistWindowPosition(modal)) {
        debouncedSaveWindowPositions();
    }

    // Check if this modal should trigger backdrop changes
    // Modals that are transient OR have been moved don't trigger backdrop
    const shouldTriggerBackdrop = !modal.classList.contains('transient') && !modal.hasAttribute('data-modal-moved');

    let isLastNonTransientModal = false;
    if (shouldTriggerBackdrop) {
        // Check if this is the last non-transient, non-moved modal closing
        const draggedModal = document.querySelector('.modal[data-dragging="true"]');
        const otherOpenNonTransientModals = Array.from(document.querySelectorAll('.modal')).filter(m =>
            m !== modal &&
            !m.classList.contains('hidden') &&
            !m.classList.contains('minimised') &&
            (!m.classList.contains('transient') && !m.hasAttribute('data-modal-moved')) &&
            m !== draggedModal
        );
        isLastNonTransientModal = otherOpenNonTransientModals.length === 0;
    }

    // Add closing class to trigger animation
    modal.classList.add('closing');

    // Update taskbar (debounced for performance)
    debouncedUpdateTaskbarWindows();

    // If this is the last non-transient, non-moved modal, animate the backdrop out
    if (isLastNonTransientModal && backdrop) {
        backdrop.classList.add('fade-out');
        // Remove fade-in class after a short delay to let fade-out animation start
        setTimeout(() => {
            backdrop.classList.remove('fade-in');
        }, 50);
    }

    // Function to clean up after animation completes
    const cleanup = () => {
        // Reset modal position offsets (persistable windows restore size/position from saved data on reopen)
        if (!shouldPersistWindowPosition(modal)) {
            clearModalPixelAnchor(modal);
            modal.style.removeProperty('--modal-offset-x');
            modal.style.removeProperty('--modal-offset-y');
            modal.style.removeProperty('width');
            modal.style.removeProperty('height');
        } else {
            // Drop pixel-settled so reopen applies saved offsets/rect instead of stale pixel vars
            clearModalPixelAnchor(modal);
        }
        modal.removeAttribute('data-resizing');
        modal.removeAttribute('data-resize-start-x');
        modal.removeAttribute('data-resize-start-y');
        modal.removeAttribute('data-resize-start-width');
        modal.removeAttribute('data-resize-start-height');
        modal.removeAttribute('data-resize-start-left');
        modal.removeAttribute('data-resize-start-top');
        modal.removeAttribute('data-resize-direction');
        modal.removeAttribute('data-dragging');
        modal.removeAttribute('data-drag-start-x');
        modal.removeAttribute('data-drag-start-y');
        modal.removeAttribute('data-modal-start-offset-x');
        modal.removeAttribute('data-modal-start-offset-y');
        const dragTitleBar = modal.querySelector('.modal-window-title.dragging');
        if (dragTitleBar) {
            dragTitleBar.classList.remove('dragging');
        }

        // Remove modal from stack and update z-indexes
        const modalIndex = modalStack.indexOf(modal);
        if (modalIndex !== -1) {
            modalStack.splice(modalIndex, 1);
            updateModalStackZIndexes();
        }

        // Remove modal from usage stack
        const usageIndex = windowUsageStack.indexOf(modal);
        if (usageIndex !== -1) {
            windowUsageStack.splice(usageIndex, 1);
        }

        // Reset z-index state (but keep moved state)
        modal.removeAttribute('data-modal-z-index');
        modal.removeAttribute('data-modal-stack-position');

        // Abort per-modal listener scope — modalListenerScope.js
        onModalClosed(modal);

        // Clean up click handler (legacy path during migration)
        if (modal._modalClickHandler) {
            modal.removeEventListener('mousedown', modal._modalClickHandler);
            delete modal._modalClickHandler;
        }

        // Remove resize handles
        const resizeHandles = modal.querySelectorAll('.resize-handle');
        resizeHandles.forEach(handle => handle.remove());

        // Add hidden class first to ensure element is hidden
        modal.classList.add('hidden');
        // Then remove closing class after a brief delay to prevent flicker
        requestAnimationFrame(() => {
            modal.classList.remove('closing');
        });

        // If closing a tool window, restore the main active window
        if (isToolWindow(modal)) {
            // Remove active class from the tool window
            modal.classList.remove('active-window');

            // Clean up the parent link
            modal.removeAttribute('data-parent-modal-id');

            // Restore main active window if it exists and is still visible
            if (mainActiveWindowId) {
                const mainActiveModal = document.getElementById(mainActiveWindowId);
                if (mainActiveModal && !mainActiveModal.classList.contains('hidden')) {
                    mainActiveModal.classList.add('active-window');
                    currentActiveWindowId = mainActiveWindowId;
                } else {
                    // Main window no longer exists or is hidden, clear it
                    mainActiveWindowId = null;
                    currentActiveWindowId = null;
                }
            }
        } else {
            // Closing a main modal - tool windows should already be closed at this point
            if (modal.id === mainActiveWindowId) {
                // Closing the main active window - activate the last window from usage stack
                mainActiveWindowId = null;
                // Remove active class (already removed by setActiveWindow if called)
                modal.classList.remove('active-window');
                currentActiveWindowId = null;

                // Find the last active window from usage stack that's still open
                // Usage stack is in order (oldest to newest), so we iterate backwards
                let lastActiveWindow = null;
                for (let i = windowUsageStack.length - 1; i >= 0; i--) {
                    const candidateModal = windowUsageStack[i];
                    // Check if modal is still open and not hidden
                    if (candidateModal &&
                        !candidateModal.classList.contains('hidden') &&
                        !candidateModal.classList.contains('closing') &&
                        candidateModal.querySelector('.modal-window-title')) {
                        lastActiveWindow = candidateModal;
                        break;
                    }
                }

                // Activate the last active window if found
                if (lastActiveWindow) {
                    setActiveWindow(lastActiveWindow);
                }
            }
        }

        // Only remove modal-open if this was a non-transient, non-moved modal and it's the last one
        if (shouldTriggerBackdrop && isLastNonTransientModal) {
            document.body.classList.remove('modal-open');
            // Reset backdrop after modal is hidden
            if (backdrop) {
                setTimeout(() => {
                    backdrop.classList.remove('fade-out');
                }, 500);
            }
        }

        // Update taskbar after cleanup
        debouncedUpdateTaskbarWindows();
    };

    // Return a Promise that resolves when the animation completes
    return new Promise((resolve) => {
        // Wait for animation to complete using animationend event
        const animationEndHandler = (e) => {
            // Only handle closing animations on this modal
            if (e.target === modal && (e.animationName === 'modalSlideOut' || e.animationName === 'modalSlideOutTopAnchor' || e.animationName === 'modalFadeOut') && modal.classList.contains('closing')) {
                modal.removeEventListener('animationend', animationEndHandler);
                cleanup();
                resolve();
            }
        };
        modal.addEventListener('animationend', animationEndHandler);
        setTimeout(() => {
            if (modal.classList.contains('closing')) {
                modal.removeEventListener('animationend', animationEndHandler);
                cleanup();
                resolve();
            }
        }, 600);
    });
}

// Modal z-index management functions
function assignModalZIndex(modal) {
    // Add modal to the top of the stack if not already there
    const modalIndex = modalStack.indexOf(modal);
    if (modalIndex !== -1) {
        // Modal already in stack, remove it first
        modalStack.splice(modalIndex, 1);
    }
    // Add to top of stack (end of array)
    modalStack.push(modal);

    // Reassign z-indexes to all modals in the stack
    updateModalStackZIndexes();

    setActiveWindow(modal);
}

function bringModalToFront(modal) {
    if (!modal) return;

    // Move modal to the top of the stack
    const modalIndex = modalStack.indexOf(modal);
    if (modalIndex !== -1) {
        // Remove from current position
        modalStack.splice(modalIndex, 1);
    }
    // Add to top of stack
    modalStack.push(modal);

    // Reassign z-indexes to all modals in the stack
    updateModalStackZIndexes();

    setActiveWindow(modal);

    // Update taskbar active states only (lightweight, no DOM recreation)
    updateTaskbarActiveStates();
}

function updateModalStackZIndexes() {
    // Separate modals into regular and on-top groups
    const regularModals = [];
    const onTopModals = [];

    modalStack.forEach((modal) => {
        if (modal.classList.contains('on-top')) {
            onTopModals.push(modal);
        } else {
            regularModals.push(modal);
        }
    });

    // Assign z-indexes to regular modals first (bottom to top)
    regularModals.forEach((modal, index) => {
        const zIndex = MODAL_Z_BASE + (index * MODAL_Z_INCREMENT);
        modal.setAttribute('data-modal-z-index', zIndex);
        modal.setAttribute('data-modal-stack-position', index + 1);
        modal.style.zIndex = zIndex;
    });

    // Assign z-indexes to on-top modals
    // Most recent modals (at end of array) get higher z-indexes
    onTopModals.forEach((modal, index) => {
        const zIndex = MODAL_Z_ON_TOP_BASE + (index * MODAL_Z_INCREMENT);
        modal.setAttribute('data-modal-z-index', zIndex);
        modal.setAttribute('data-modal-stack-position', regularModals.length + index + 1);
        modal.style.zIndex = zIndex;
    });

    // Ensure all on-top modals have active-window class (doesn't affect taskbar)
    document.querySelectorAll('.modal.on-top').forEach(onTopModal => {
        onTopModal.classList.add('active-window');
    });

    // When z-indexes change, the top window (last in stack) should be active
    // But don't override main active window if the top modal is a tool window
    // Also don't change active state for on-top modals (they always stay active)
    if (modalStack.length > 0) {
        const topModal = modalStack[modalStack.length - 1];
        // Skip setting active window if it's an on-top modal (they're always active)
        if (!topModal.classList.contains('on-top')) {
            // Only update if it's a moveable window with a title bar
            const hasTitleBar = topModal.querySelector('.modal-window-title') !== null;
            // Manual modal is blocked from being active only when not windowed AND not in desktop-mode
            // In desktop-mode, it should be active even when maximized
            const isBlocked = topModal.id === 'manualModal' && !topModal.classList.contains('windowed') && !document.body.classList.contains('desktop-mode');
            if (hasTitleBar && !isBlocked) {
                // If it's a tool window, it won't remove the main window's active class
                setActiveWindow(topModal);
            }
        }
    }
}

function handleModalClick(modal) {
    // Don't activate if document doesn't have focus (user is clicking in another window)
    if (!document.hasFocus()) {
        return;
    }

    // Don't change active window if clicking right after browser window regained focus
    const timeSinceFocus = Date.now() - windowFocusRegainedTime;
    if (timeSinceFocus < FOCUS_GRACE_PERIOD) {
        return; // User is just trying to regain browser window focus
    }

    // Bring modal to front when clicked (unless it's currently being dragged) - only for moveable modals
    // Manual modal participates in stacking when windowed OR when in desktop-mode (even if maximized)
    // Manual modal is blocked from stacking only when not windowed AND not in desktop-mode
    const isBlocked = modal.id === 'manualModal' && !modal.classList.contains('windowed') && !document.body.classList.contains('desktop-mode');
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isBlocked;

    if (isMoveable && !modal.hasAttribute('data-dragging')) {
        bringModalToFront(modal);
    }
}

// Add resize handles to a modal
function addResizeHandles(modal) {
    // Check if handles already exist
    if (modal.querySelector('.resize-handle')) return;

    // Create resize handles (top-anchored windows omit north handles)
    const handles = isModalResizeTopAnchored(modal)
        ? ['w', 'e', 'sw', 's', 'se']
        : ['nw', 'n', 'ne', 'w', 'e', 'sw', 's', 'se'];
    handles.forEach(direction => {
        const handle = document.createElement('div');
        handle.className = `resize-handle ${direction}`;
        modal.appendChild(handle);
    });
}

// Update backdrop and scroll blocking based on current modal state
function updateBackdropVisibility() {
    if (!backdrop) return;

    // Disable backdrop completely in desktop mode (when gallery is windowed)
    const galleryWindow = document.getElementById('galleryWindow');

    if (window.isDesktop) {
        // In desktop mode, never show backdrop
        if (backdrop.classList.contains('fade-in') || !backdrop.classList.contains('fade-out')) {
            backdrop.classList.add('fade-out');
            backdrop.classList.remove('fade-in');
        }
        // Remove modal-open class (allow body scrolling)
        if (document.body.classList.contains('modal-open')) {
            document.body.classList.remove('modal-open');
        }
        return;
    }

    // Count visible non-transient, non-moved modals that are not being dragged or resized
    const draggedModal = document.querySelector('.modal[data-dragging="true"]');
    const resizedModal = document.querySelector('.modal[data-resizing="true"]');
    const visibleNonTransientModals = Array.from(document.querySelectorAll('.modal')).filter(m =>
        !m.classList.contains('hidden') &&
        !m.classList.contains('minimised') &&
        (!m.classList.contains('transient') && !m.hasAttribute('data-modal-moved')) &&
        m !== draggedModal &&
        m !== resizedModal
    );

    const shouldShowBackdrop = visibleNonTransientModals.length > 0;

    if (shouldShowBackdrop && !backdrop.classList.contains('fade-in')) {
        // Show backdrop
        backdrop.classList.remove('fade-out');
        backdrop.classList.add('fade-in');
    } else if (!shouldShowBackdrop && !backdrop.classList.contains('fade-out')) {
        // Hide backdrop
        backdrop.classList.add('fade-out');
        setTimeout(() => {
            backdrop.classList.remove('fade-in');
        }, 50);
    }

    // Also manage scroll blocking (modal-open class on body)
    if (shouldShowBackdrop && !document.body.classList.contains('modal-open')) {
        document.body.classList.add('modal-open');
    } else if (!shouldShowBackdrop && document.body.classList.contains('modal-open')) {
        document.body.classList.remove('modal-open');
    }
}

// Gallery Window Management - Windowed Mode
let galleryWindow = null;

function initializeGalleryWindow() {
    galleryWindow = document.getElementById('galleryWindow');

    if (!galleryWindow) {
        console.error('Gallery window element not found');
        return;
    }

    // Load preference from localStorage
    galleryWindowPreference = localStorage.getItem('galleryWindowMode');

    // Check if we're in desktop mode (wide screen)
    const isWideScreen = window.innerWidth >= 1200;
    const willBeDesktopMode = isWideScreen && (galleryWindowPreference !== 'maximized');

    // If not in desktop mode, show gallery immediately (it's hidden by default in HTML)
    if (!willBeDesktopMode) {
        galleryWindow.classList.remove('hidden');
    }

    // Check and update gallery window mode based on viewport and preference
    updateGalleryWindowMode();
    updateGalleryMaximizeButtonIcon();

    galleryWindow.addEventListener('modalResized', () => { updateGalleryGrid(true, true); }); // onlyIfChanged=true, updatePlaceholders=true

    // Add maximize button handler (windowed ↔ fullscreen gallery mode)
    const maximizeBtn = document.getElementById('maximizeGalleryBtn');
    if (maximizeBtn && maximizeBtn.dataset.modalMaximizeWired !== 'true') {
        maximizeBtn.dataset.modalMaximizeWired = 'true';
        maximizeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            maximizeGalleryWindow();
        });
    }

    // Add close button handler for desktop mode
    const closeBtn = galleryWindow.querySelector('.close-btn');
    if (closeBtn) {
        closeBtn.addEventListener('click', (e) => {
            e.preventDefault();
            if (galleryWindow.classList.contains('windowed')) {
                hideGalleryWindow();
            }
        });
    }
}

function updateGalleryWindowMode() {
    if (!galleryWindow) return;

    const wasDesktopMode = document.body.classList.contains('desktop-mode');
    const isWideScreen = window.innerWidth >= 1200;
    const isWindowed = galleryWindow.classList.contains('windowed');

    // Determine if windowed mode should be active
    let shouldBeWindowed = false;

    if (galleryWindowPreference === 'windowed') {
        // User explicitly wants windowed mode
        shouldBeWindowed = isWideScreen; // Only on wide screens
    } else if (galleryWindowPreference === 'maximized') {
        // User explicitly wants maximized mode
        shouldBeWindowed = false;
    } else {
        // Auto mode: enable windowed by default on wide screens
        shouldBeWindowed = isWideScreen;
    }

    if (shouldBeWindowed && !isWindowed) {
        // Switch to windowed mode (desktop mode)
        galleryWindow.classList.add('windowed');
        galleryWindow.classList.add('modal'); // Add modal class for windowed mode

        // Update desktop-mode class on body (class is set initially in inline script after body tag)
        if (!document.body.classList.contains('desktop-mode')) {
            document.body.classList.add('desktop-mode');

            // Update window.isDesktop to stay in sync
            window.isDesktop = true;

            // Show taskbar when entering desktop mode
            const taskbar = document.getElementById('desktopTaskbar');
            if (taskbar) {
                taskbar.classList.remove('hidden');
            }

            // Initialize and load desktop shortcuts if not already done
            if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts) {
                // Initialize if not already initialized
                if (!desktopShortcuts.desktopContainer) {
                    desktopShortcuts.init();
                }

                // Load and render shortcuts for current workspace if not already loaded
                if (typeof activeWorkspace !== 'undefined' && activeWorkspace) {
                    desktopShortcuts.currentWorkspace = activeWorkspace;
                }
            }

            // Rebuild start menu when entering desktop mode
            // Ensure startMenuItems is set (in case initializeStartMenu hasn't run yet)
            if (!startMenuItems) {
                startMenuItems = document.getElementById('startMenuItems');
            }
            if (startMenuItems) {
                buildStartMenu();
            }
        }

        // Initialize modal functionality if not already done
        if (!galleryWindow.hasAttribute('data-modal-initialized')) {
            // Add resize handles for this resizeable window
            if (galleryWindow.classList.contains('resizeable-window')) {
                addResizeHandles(galleryWindow);
            }
            galleryWindow.setAttribute('data-modal-initialized', 'true');
        }

        // Add gallery window to modal stack for z-index management
        if (modalStack.indexOf(galleryWindow) === -1) {
            assignModalZIndex(galleryWindow);
        }

        // Add click handler to bring gallery to front when clicking anywhere inside it
        if (!galleryWindow._modalClickHandler) {
            const clickHandler = (e) => {
                // Verify the click is actually inside the gallery window (prevent activation when clicking in other windows)
                if (!galleryWindow.contains(e.target)) {
                    return;
                }
                // Only skip if clicking on resize handles (title bar dragging is handled separately)
                // Allow clicks on all other elements (buttons, inputs, etc.) to activate the window
                if (!e.target.closest('.resize-handle')) {
                    // Use handleModalClick for consistency with other modals
                    handleModalClick(galleryWindow);
                }
            };
            galleryWindow.addEventListener('mousedown', clickHandler);
            galleryWindow._modalClickHandler = clickHandler;
        }

        // Enable close button in windowed mode
        const closeBtn = galleryWindow.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.disabled = false;
        }

        // Update taskbar to show gallery
        debouncedUpdateTaskbarWindows();

        updateGalleryGrid(true, true); // onlyIfChanged=true, updatePlaceholders=true

    } else if (!shouldBeWindowed && isWindowed) {
        prepareAppModeWindowLayout();
        // flushSaveWindowPositions: persist layout before tearing down desktop mode
        if (typeof flushSaveWindowPositions === 'function') {
            flushSaveWindowPositions();
        }
        cancelPendingWindowPositionUpdates({ revert: false });

        // Switch to maximized mode (exit desktop mode)
        galleryWindow.classList.remove('windowed');
        galleryWindow.classList.remove('modal'); // Remove modal class for maximized mode

        // Always unhide gallery when leaving desktop mode
        galleryWindow.classList.remove('hidden');

        // Update desktop-mode class on body (class is set initially in inline script after body tag)
        document.body.classList.remove('desktop-mode');

        // Update window.isDesktop to stay in sync
        window.isDesktop = false;

        // Hide taskbar when exiting desktop mode
        const taskbar = document.getElementById('desktopTaskbar');
        if (taskbar) {
            taskbar.classList.add('hidden');
        }

        // Unload desktop shortcuts and other desktop-only elements to free memory
        if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts) {
            // Clear desktop shortcuts DOM
            if (desktopShortcuts.gridContainer) {
                desktopShortcuts.gridContainer.innerHTML = '';
            }
            if (desktopShortcuts.freeformContainer) {
                desktopShortcuts.freeformContainer.innerHTML = '';
            }
            // Clear collision offsets
            if (desktopShortcuts.collisionOffsets) {
                desktopShortcuts.collisionOffsets.clear();
            }
            // Clear shortcuts data array
            desktopShortcuts.shortcuts = [];
            // Reset manager state
            desktopShortcuts.currentWorkspace = null;
            desktopShortcuts.draggedShortcut = null;
            desktopShortcuts.dragOffset = { x: 0, y: 0 };
            desktopShortcuts.dragStartPos = { x: 0, y: 0 };
            desktopShortcuts.isDragging = false;
            desktopShortcuts.clearSelection();
            desktopShortcuts.notesMetadataCache = null;
            // Clear any pending save timers (window position revert handled above)
            if (desktopShortcuts.saveDebounceTimer && !desktopShortcuts.pendingChanges) {
                clearTimeout(desktopShortcuts.saveDebounceTimer);
                desktopShortcuts.saveDebounceTimer = null;
            }
            desktopShortcuts.pendingChanges = false;
            desktopShortcuts.pendingWindowPositionSave = false;
            if (typeof desktopShortcuts.hideSaveTrayIndicator === 'function') {
                desktopShortcuts.hideSaveTrayIndicator();
            }
        }

        // Clear in-memory window positions (server copy retained)
        clearGlobalWindowPositions();

        // Clear start menu content
        const startMenuItems = document.getElementById('startMenuItems');
        if (startMenuItems) {
            startMenuItems.innerHTML = '';
        }

        // Hide start menu if open
        if (!startMenu) {
            startMenu = document.getElementById('startMenu');
        }
        closeStartMenu({ immediate: true });

        // Remove from modal stack
        const modalIndex = modalStack.indexOf(galleryWindow);
        if (modalIndex !== -1) {
            modalStack.splice(modalIndex, 1);
            updateModalStackZIndexes();
        }

        // Reset container z-index
        const container = galleryWindow.parentElement;
        if (container) {
            container.style.removeProperty('z-index');
        }

        // Remove click handler
        if (galleryWindow._modalClickHandler) {
            galleryWindow.removeEventListener('mousedown', galleryWindow._modalClickHandler);
            delete galleryWindow._modalClickHandler;
        }

        // Remove scroll handler
        if (galleryWindow._modalScrollHandler && galleryWindow._modalScrollHandlerTarget) {
            galleryWindow._modalScrollHandlerTarget.removeEventListener('scroll', galleryWindow._modalScrollHandler);
            if (galleryWindow._modalScrollThrottleTimer) {
                clearTimeout(galleryWindow._modalScrollThrottleTimer);
            }
            delete galleryWindow._modalScrollHandler;
            delete galleryWindow._modalScrollHandlerTarget;
            delete galleryWindow._modalScrollThrottleTimer;
        }

        // Disable close button in maximized mode
        const closeBtn = galleryWindow.querySelector('.close-btn');
        if (closeBtn) {
            closeBtn.disabled = true;
        }

        // Reload gallery when leaving desktop mode (skip when Studio is open — gallery is not loaded then)
        if (!isStudioModalOpen()) {
            const savedPosition = window.savedGalleryPosition || 0;
            if (displayGalleryFromStartIndex) {
                displayGalleryFromStartIndex(savedPosition);
            } else {
                loadGallery();
            }
        }

        // Update taskbar
        debouncedUpdateTaskbarWindows();
    }

    // Ensure desktop-mode class and window.isDesktop are always in sync with shouldBeWindowed state
    // (class is set initially in inline script after body tag, but we need to keep it in sync)
    if (shouldBeWindowed && !document.body.classList.contains('desktop-mode')) {
        document.body.classList.add('desktop-mode');
        window.isDesktop = true;
    } else if (!shouldBeWindowed && document.body.classList.contains('desktop-mode')) {
        document.body.classList.remove('desktop-mode');
        window.isDesktop = false;
    }

    if (wasDesktopMode && !document.body.classList.contains('desktop-mode')) {
        syncStudioForAppMode();
    }

    if (!wasDesktopMode && document.body.classList.contains('desktop-mode')) {
        ensureDesktopPositionsAfterEntry();
    }

    // syncVirtualKeyboardPresentation: public/scripts/comp/virtualKeyboard.js
    if (typeof syncVirtualKeyboardPresentation === 'function') {
        syncVirtualKeyboardPresentation();
    }
}

function maximizeGalleryWindow() {
    if (!galleryWindow) return;

    if (galleryWindow.classList.contains('windowed') && !shouldExitDesktopOnWorkspaceMaximise()) {
        if (isModalMaximized(galleryWindow)) {
            restoreModalFromMaximize(galleryWindow);
        } else {
            maximizeModalToWorkArea(galleryWindow);
        }
        updateGalleryMaximizeButtonIcon();
        updateGalleryGrid(true, true);
        return;
    }

    // Toggle between windowed and maximized (exit desktop)
    if (galleryWindow.classList.contains('windowed')) {
        // Switch to maximized mode
        galleryWindowPreference = 'maximized';
        localStorage.setItem('galleryWindowMode', 'maximized');
        updateGalleryWindowMode();
    } else {
        // Switch to windowed mode (only if screen is wide enough)
        if (window.innerWidth >= 1200) {
            galleryWindowPreference = 'windowed';
            localStorage.setItem('galleryWindowMode', 'windowed');
            updateGalleryWindowMode();
        }
    }
    updateGalleryMaximizeButtonIcon();
}

function toggleGalleryWindowMode() {
    // Toggle between windowed and maximized modes
    maximizeGalleryWindow();
}

// Hide gallery window in desktop mode
// - Adds 'hidden' class to remove from DOM/taskbar
// - Clears gallery content to free memory (like manual modal does when opening)
// - All gallery update functions check this state and skip updates when hidden
async function hideGalleryWindow() {
    if (!galleryWindow || !galleryWindow.classList.contains('windowed')) {
        return;
    }

    galleryWindow.setAttribute('data-modal-moved', 'true');
    debouncedSaveWindowPositions();

    await closeModal(galleryWindow);

    // Clear gallery content like manual modal does
    clearGallery();

    // Update taskbar (will remove gallery from taskbar)
    debouncedUpdateTaskbarWindows();

    console.log('Gallery hidden in desktop mode');
}

// Show/reopen gallery window in desktop mode
// - Removes 'hidden' class to show window
// - Reloads gallery content (like manual modal close does when reopening gallery)
// - Brings window to front
// - Can be called from start menu "Gallery" option or taskbar click
function showGalleryWindow() {
    if (!galleryWindow || !galleryWindow.classList.contains('windowed')) {
        return;
    }

    // Mark gallery as visible (openModal restores saved size/position and prepares content)
    openModal(galleryWindow);
    ensureModalEdgesWithinWorkArea(galleryWindow);

    console.log('Gallery shown in desktop mode');
}

// Check if gallery is hidden in desktop mode (for function inhibition)
// Gallery update functions use this to skip updates when gallery is hidden
// Similar to how they check for manual modal open state
function isGalleryWindowHidden() {
    return galleryWindow && galleryWindow.classList.contains('hidden') && galleryWindow.classList.contains('windowed');
}

/**
 * Activates all deferred resize listeners after application has fully loaded.
 */
function activateAllResizeListeners() {
    console.log('🚀 Activating all deferred resize listeners');

    // 1. Activate gallery specific listeners
    activateGalleryResizeListener();

    // 2. Activate main application layout listeners (in app.js)
    if (typeof activateMainResizeListeners === 'function') {
        activateMainResizeListeners();
    }

    // 3. Activate titlebar/WCO listeners (in app.js)
    if (typeof activateTitlebarResizeListeners === 'function') {
        activateTitlebarResizeListeners();
    }
}

/**
 * Activates the gallery resize listener.
 * Listeners attach via attachModalListeners(galleryWindow) and detach when the gallery window closes.
 */
function activateGalleryResizeListener() {
    if (!galleryWindow) {
        galleryWindow = document.getElementById('galleryWindow');
    }
    if (galleryWindow) {
        attachModalListeners(galleryWindow, (signal) => {
            const debouncedGalleryModeUpdate = debounceGalleryResize(updateGalleryWindowMode, 150);
            window.addEventListener('resize', debouncedGalleryModeUpdate, { signal });
            window.addEventListener('resize', scheduleDesktopViewportResizePositionSync, { signal });
            modalListenerDevLog('gallery resize listeners attached', { id: galleryWindow.id });
        });
    }
    // Perform one check in case the window was resized during loading
    updateGalleryWindowMode();
}

// Utility function for debouncing (specifically for gallery resize)
function debounceGalleryResize(func, wait) {
    let timeout;
    return function executedFunction(...args) {
        const later = () => {
            clearTimeout(timeout);
            func(...args);
        };
        clearTimeout(timeout);
        timeout = setTimeout(later, wait);
    };
}

// Desktop Taskbar Management
let taskbarWindows = null;
let taskbarClock = null;

function initializeDesktopTaskbar() {
    taskbarWindows = document.getElementById('taskbarWindows');
    taskbarClock = document.getElementById('taskbarClock');

    if (!taskbarWindows || !taskbarClock) {
        console.warn('Taskbar elements not found');
        return;
    }

    // Update clock every second
    updateTaskbarClock();
    setInterval(updateTaskbarClock, 1000);

    // Set up modal observation
    observeModals();

    // Initial update
    setTimeout(() => {
        debouncedUpdateTaskbarWindows();
    }, 100);
}

// Desktop icons configuration
const desktopIconsConfig = [
    {
        id: 'editor',
        icon: 'fa-duotone fa-compass-drafting',
        imageIcon: 'studio.png',
        label: 'Studio',
        action: () => {
            openManualModalWithContent();
        }
    },
    {
        id: 'spellbook',
        icon: 'fa-duotone fa-book-spells',
        imageIcon: 'caster.png',
        label: 'Spellcaster',
        action: () => {
            if (window.spellbookModalManager) window.spellbookModalManager.openModal();
        }
    },
    {
        id: 'chat',
        icon: 'fa-duotone fa-messages',
        label: 'Chat',
        action: () => {
            if (window.chatSystem) window.chatSystem.showAllChats();
        }
    },
    {
        id: 'wiki',
        icon: 'fa-duotone fa-book',
        label: 'Wiki',
        action: () => {
            if (window.tagWikiSearchModal) {
                window.tagWikiSearchModal.open();
            } else {
                const modal = document.getElementById('tagWikiSearchModal');
                if (modal) openModal(modal);
            }
        }
    },
    {
        id: 'references',
        icon: 'fa-duotone fa-swatchbook',
        label: 'References',
        action: () => {
            showCacheManagerModal();
        }
    }
];

function updateTaskbarClock() {
    if (!taskbarClock) return;

    const now = new Date();
    const timeStr = now.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', hour12: false });
    const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;

    const timeEl = taskbarClock.querySelector('.taskbar-time');
    const dateEl = taskbarClock.querySelector('.taskbar-date');

    if (timeEl) timeEl.textContent = timeStr;
    if (dateEl) dateEl.textContent = dateStr;
}

function observeModals() {
    // Track previous state of modals to only trigger on meaningful changes
    const modalStates = new Map();

    const getModalState = (element) => {
        return {
            hidden: element.classList.contains('hidden'),
            minimised: element.classList.contains('minimised')
        };
    };

    // Observe when modals open/close/minimize
    const observer = new MutationObserver((mutations) => {
        let hasRelevantChange = false;

        mutations.forEach(mutation => {
            const element = mutation.target;
            const modalId = element.id;

            if (!modalId) return;

            const previousState = modalStates.get(modalId);
            const currentState = getModalState(element);

            // Only trigger update if hidden or minimised state changed
            if (previousState) {
                if (previousState.hidden !== currentState.hidden ||
                    previousState.minimised !== currentState.minimised) {
                    hasRelevantChange = true;
                    modalStates.set(modalId, currentState);
                }
            } else {
                // First time seeing this modal
                modalStates.set(modalId, currentState);
                hasRelevantChange = true;
            }
        });

        // Only update taskbar if there was a meaningful state change
        if (hasRelevantChange) {
            debouncedUpdateTaskbarWindows();
        }
    });

    // Observe all modals for class changes (including gallery window which gets modal class later)
    const observeElement = (element) => {
        if (element.id) {
            modalStates.set(element.id, getModalState(element));
        }
        observer.observe(element, {
            attributes: true,
            attributeFilter: ['class']
        });
    };

    document.querySelectorAll('.modal').forEach(observeElement);

    // Also observe gallery window even if it doesn't have modal class yet
    const galleryWin = document.getElementById('galleryWindow');
    if (galleryWin) {
        observeElement(galleryWin);
    }
}

// Wire click/context handlers on an individual (non-group) taskbar item
function wireIndividualTaskbarItemHandlers(item, modal) {
    item.onclick = () => {
        restoreMinimizedModal(modal, item);
        if (modal.classList.contains('hidden')) {
            if (modal.id === 'galleryWindow') {
                showGalleryWindow();
            } else {
                modal.classList.remove('hidden');
            }
        }
        bringModalToFront(modal);
    };
    item.oncontextmenu = (e) => {
        e.preventDefault();
        showTaskbarItemContextMenu(e, modal, item);
    };
}

// Toggle active/minimised on a taskbar item without disturbing entering/leaving animations
function syncTaskbarItemStateClasses(item, isActive, isMinimised) {
    item.classList.toggle('active', isActive && !isMinimised);
    item.classList.toggle('minimised', !!isMinimised);
}

const TASKBAR_ITEM_SHRINK_MS = 280;
const taskbarItemRemovalTimers = new WeakMap();

function clearTaskbarItemRemovalTimer(item) {
    const timer = taskbarItemRemovalTimers.get(item);
    if (timer) {
        clearTimeout(timer);
        taskbarItemRemovalTimers.delete(item);
    }
}

function removeTaskbarItemNow(item) {
    if (!item) return;
    clearTaskbarItemRemovalTimer(item);
    if (item.isConnected) item.remove();
}

function scheduleTaskbarItemRemoval(item) {
    if (!item || item.classList.contains('leaving')) return;

    syncTaskbarItemStateClasses(item, false, false);
    item.classList.add('leaving');

    const finishRemoval = () => removeTaskbarItemNow(item);

    item.addEventListener('animationend', (e) => {
        if (e.target !== item || e.animationName !== 'taskbar-item-shrink') return;
        finishRemoval();
    }, { once: true });

    taskbarItemRemovalTimers.set(item, setTimeout(finishRemoval, TASKBAR_ITEM_SHRINK_MS));
}

function cancelTaskbarItemRemoval(item) {
    if (!item) return;
    clearTaskbarItemRemovalTimer(item);
    item.classList.remove('leaving');
}

function taskbarItemShouldExist(item, itemsThatShouldExist) {
    const modalId = item.dataset.modalId;
    const groupType = item.dataset.groupType;

    if (modalId) {
        return itemsThatShouldExist.has(modalId) &&
            itemsThatShouldExist.get(modalId).type === 'individual';
    }
    if (groupType) {
        return itemsThatShouldExist.has(`group:${groupType}`) &&
            itemsThatShouldExist.get(`group:${groupType}`).type === 'group';
    }
    return false;
}

function dedupeTaskbarWindowItems() {
    if (!taskbarWindows) return;

    const byModalId = new Map();
    taskbarWindows.querySelectorAll('.taskbar-window-item[data-modal-id]:not(.taskbar-window-group)').forEach(item => {
        const id = item.dataset.modalId;
        if (!id) return;
        if (!byModalId.has(id)) byModalId.set(id, []);
        byModalId.get(id).push(item);
    });

    byModalId.forEach(items => {
        if (items.length < 2) return;
        const keeper = items.find(i => !i.classList.contains('leaving')) || items[items.length - 1];
        items.forEach(item => {
            if (item !== keeper) removeTaskbarItemNow(item);
        });
    });

    const byGroupType = new Map();
    taskbarWindows.querySelectorAll('.taskbar-window-group[data-group-type]').forEach(item => {
        const type = item.dataset.groupType;
        if (!type) return;
        if (!byGroupType.has(type)) byGroupType.set(type, []);
        byGroupType.get(type).push(item);
    });

    byGroupType.forEach(items => {
        if (items.length < 2) return;
        const keeper = items.find(i => !i.classList.contains('leaving')) || items[items.length - 1];
        items.forEach(item => {
            if (item !== keeper) removeTaskbarItemNow(item);
        });
    });
}

// Lightweight function to update active states and content without recreating DOM elements or triggering animations
function updateTaskbarActiveStates() {
    if (!taskbarWindows) return;

    // Get all open modals (not hidden and not closing) - includes minimised windows
    const openModals = getOpenTaskbarModals();

    // Group modals by type to check grouping state
    const modalGroups = new Map();
    openModals.forEach(modal => {
        const type = getModalType(modal);
        if (!modalGroups.has(type)) {
            modalGroups.set(type, []);
        }
        modalGroups.get(type).push(modal);
    });

    // Get existing taskbar items (both individual and grouped)
    const existingItems = Array.from(taskbarWindows.querySelectorAll('.taskbar-window-item, .taskbar-window-group'));

    // Update active/minimised states and content (no DOM recreation, no animations)
    existingItems.forEach(item => {
        if (item.classList.contains('leaving') || item.classList.contains('entering')) return;

        const modalId = item.dataset.modalId;
        const groupType = item.dataset.groupType;

        if (modalId) {
            // Individual item
            const modal = openModals.find(m => m.id === modalId);

            if (modal) {
                const isActive = isModalActiveForTaskbar(modal);
                const isMinimised = modal.classList.contains('minimised');
                const title = getModalTitle(modal);
                const { icon, imageIcon } = getModalIcons(modal);

                // Toggle state classes in place — never reset className (re-adding entering restarts CSS animations)
                syncTaskbarItemStateClasses(item, isActive, isMinimised);

                // Update icon and text content without recreating elements (preserves event listeners)
                // Only update if elements already exist - don't add/remove elements here (that's handled by updateTaskbarWindows)
                const iconEl = item.querySelector('i');
                const imageIconEl = item.querySelector('img.icon-image');
                const textEl = item.querySelector('span');

                // Update font icon if it exists and changed
                if (iconEl && icon && !isImageIcon(icon)) {
                    const expectedClass = imageIcon ? `${icon} icon-fa` : icon;
                    if (iconEl.className !== expectedClass) {
                        iconEl.className = expectedClass;
                    }
                }

                // Update image icon src if it exists and changed
                if (imageIconEl && imageIcon) {
                    const imagePath = imageIcon.startsWith('/') ? imageIcon : `/static_images/app_icons/${imageIcon}`;
                    const expectedSrc = new URL(imagePath, window.location.origin).href;
                    if (imageIconEl.src !== expectedSrc) {
                        imageIconEl.src = expectedSrc;
                    }
                }

                if (textEl && textEl.textContent !== title) {
                    textEl.textContent = title;
                }
            }
        } else if (groupType) {
            // Group item - update based on modals in the group
            const modals = modalGroups.get(groupType) || [];
            const shouldGroup = modals.length > 3;

            if (shouldGroup && modals.length > 0) {
                // Recalculate active state for the group
                const hasActive = modals.some(m => isModalActiveForTaskbar(m) && !m.classList.contains('minimised'));
                const allMinimised = modals.every(m => m.classList.contains('minimised'));

                syncTaskbarItemStateClasses(item, hasActive && !allMinimised, allMinimised);

                // Update count badge if it exists
                const countBadge = item.querySelector('.taskbar-group-count');
                if (countBadge && countBadge.textContent !== String(modals.length)) {
                    countBadge.textContent = modals.length;
                }
            }
        }
    });
}

function updateTaskbarWindows() {
    if (!taskbarWindows) return;

    // Close any open group menu when updating (to prevent stale menus)
    closeTaskbarGroupMenu();

    // STEP 1: EVALUATE - Determine what SHOULD exist
    const openModals = getOpenTaskbarModals();

    // Group modals by type
    const modalGroups = new Map();
    openModals.forEach(modal => {
        const type = getModalType(modal);
        if (!modalGroups.has(type)) {
            modalGroups.set(type, []);
        }
        modalGroups.get(type).push(modal);
    });

    // Determine what taskbar items should exist
    const itemsThatShouldExist = new Map(); // modalId or groupType -> { type: 'individual'|'group', data: {...} }

    modalGroups.forEach((modals, type) => {
        const shouldGroup = modals.length > 3;

        if (shouldGroup) {
            // Should have a group item
            const modalIds = modals.map(m => m.id);
            const hasActive = modals.some(m => isModalActiveForTaskbar(m) && !m.classList.contains('minimised'));
            const allMinimised = modals.every(m => m.classList.contains('minimised'));

            itemsThatShouldExist.set(`group:${type}`, {
                type: 'group',
                groupType: type,
                modalIds: modalIds,
                modals: modals,
                hasActive: hasActive,
                allMinimised: allMinimised
            });
        } else {
            // Should have individual items
            modals.forEach(modal => {
                const isActive = isModalActiveForTaskbar(modal);
                const isMinimised = modal.classList.contains('minimised');

                itemsThatShouldExist.set(modal.id, {
                    type: 'individual',
                    modal: modal,
                    isActive: isActive,
                    isMinimised: isMinimised
                });
            });
        }
    });

    dedupeTaskbarWindowItems();

    // STEP 2: REMOVE - Remove items that shouldn't exist
    const existingItems = Array.from(taskbarWindows.querySelectorAll('.taskbar-window-item, .taskbar-window-group'));

    existingItems.forEach(item => {
        const shouldExist = taskbarItemShouldExist(item, itemsThatShouldExist);

        if (item.classList.contains('leaving')) {
            // Stale ghost from a missed animationend — purge on the next sync pass
            if (!shouldExist) removeTaskbarItemNow(item);
            return;
        }

        if (!shouldExist) {
            scheduleTaskbarItemRemoval(item);
        }
    });

    // STEP 3: CREATE/UPDATE - Create or update items that should exist
    itemsThatShouldExist.forEach((itemData, key) => {
        if (itemData.type === 'group') {
            // Handle group item
            const { groupType, modalIds, modals, hasActive, allMinimised } = itemData;

            // Check if group item exists - query ALL group items first, then filter
            const allGroupItems = Array.from(taskbarWindows.querySelectorAll('.taskbar-window-group'));
            let groupItem = allGroupItems.find(item =>
                item.dataset.groupType === groupType && !item.classList.contains('leaving')
            );

            if (!groupItem) {
                const leavingGroup = allGroupItems.find(item =>
                    item.dataset.groupType === groupType && item.classList.contains('leaving')
                );
                if (leavingGroup) {
                    cancelTaskbarItemRemoval(leavingGroup);
                    leavingGroup.classList.add('entering');
                    leavingGroup.addEventListener('animationend', (e) => {
                        if (e.target !== leavingGroup || e.animationName !== 'taskbar-item-grow') return;
                        leavingGroup.classList.remove('entering');
                    }, { once: true });
                    groupItem = leavingGroup;
                }
            }

            if (groupItem) {
                // Update existing group item - FORCE update everything
                groupItem.dataset.groupedModals = JSON.stringify(modalIds);

                // Toggle state in place — preserve entering/leaving animation classes
                syncTaskbarItemStateClasses(groupItem, hasActive && !allMinimised, allMinimised);

                // ALWAYS update count badge - don't check if it exists, just update it
                let countBadge = groupItem.querySelector('.taskbar-group-count');
                if (!countBadge) {
                    // If badge doesn't exist, create it
                    const content = groupItem.querySelector('.taskbar-window-item-content');
                    if (content) {
                        countBadge = document.createElement('span');
                        countBadge.className = 'taskbar-group-count';
                        content.appendChild(countBadge);
                    }
                }
                if (countBadge) {
                    countBadge.textContent = modals.length;
                }
            } else {
                // Create new group item
                const { icon, imageIcon } = getModalIcons(modals[0]);
                const typeName = groupType === 'imageViewer' ? 'Lumen' :
                    groupType === 'notepad' ? 'Notepad' : groupType;

                groupItem = document.createElement('div');
                let className = 'taskbar-window-item taskbar-window-group entering';
                if (hasActive && !allMinimised) className += ' active';
                if (allMinimised) className += ' minimised';
                groupItem.className = className;
                groupItem.dataset.groupType = groupType;
                groupItem.dataset.groupedModals = JSON.stringify(modalIds);

                groupItem.innerHTML = `
                    <div class="taskbar-window-item-content">
                        ${getIconHTML(icon, imageIcon)}
                        <span>${typeName}</span>
                        <span class="taskbar-group-count">${modals.length}</span>
                    </div>
                `;

                // Click handler
                groupItem.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const currentModals = Array.from(document.querySelectorAll('.modal:not(.hidden)'))
                        .filter(modal => getModalType(modal) === groupType);
                    toggleTaskbarGroupMenu(groupItem, currentModals);
                });

                // Right click handler - show group context menu
                groupItem.addEventListener('contextmenu', (e) => {
                    e.preventDefault();
                    e.stopPropagation();
                    if (modals.length > 0) {
                        showTaskbarGroupContextMenu(e, groupItem, modals);
                    }
                });

                // Remove entering class after shell grow animation completes
                groupItem.addEventListener('animationend', (e) => {
                    if (e.target !== groupItem || e.animationName !== 'taskbar-item-grow') return;
                    groupItem.classList.remove('entering');
                }, { once: true });

                taskbarWindows.appendChild(groupItem);
            }
        } else {
            // Handle individual item
            const { modal, isActive, isMinimised } = itemData;
            const modalId = modal.id;

            // Check if individual item exists (revive a leaving item if the window reopened)
            let existingItem = taskbarWindows.querySelector(
                `.taskbar-window-item[data-modal-id="${modalId}"]:not(.taskbar-window-group):not(.leaving)`
            );

            if (!existingItem) {
                const leavingItem = taskbarWindows.querySelector(
                    `.taskbar-window-item[data-modal-id="${modalId}"]:not(.taskbar-window-group).leaving`
                );
                if (leavingItem) {
                    cancelTaskbarItemRemoval(leavingItem);
                    leavingItem.classList.add('entering');
                    leavingItem.addEventListener('animationend', (e) => {
                        if (e.target !== leavingItem || e.animationName !== 'taskbar-item-grow') return;
                        leavingItem.classList.remove('entering');
                    }, { once: true });
                    existingItem = leavingItem;
                }
            }

            if (existingItem) {
                // Update existing item
                const title = getModalTitle(modal);
                const { icon, imageIcon } = getModalIcons(modal);

                // Promote temporary minimize placeholder to a visible item with reveal animation
                const wasHiddenTemp = existingItem.style.opacity === '0';
                if (wasHiddenTemp) {
                    existingItem.style.opacity = '';
                    existingItem.classList.add('entering');
                    existingItem.addEventListener('animationend', (e) => {
                        if (e.target !== existingItem || e.animationName !== 'taskbar-item-grow') return;
                        existingItem.classList.remove('entering');
                    }, { once: true });
                }

                syncTaskbarItemStateClasses(existingItem, isActive, isMinimised);

                // Update content if changed - check both font icon and image icon
                const currentTitle = existingItem.querySelector('span')?.textContent;
                const currentIconEl = existingItem.querySelector('i');
                const currentImageIconEl = existingItem.querySelector('img.icon-image');
                const currentIcon = currentIconEl?.className || '';

                // Extract current image icon filename for comparison
                let currentImageIcon = null;
                if (currentImageIconEl) {
                    try {
                        const url = new URL(currentImageIconEl.src);
                        const pathParts = url.pathname.split('/');
                        const filename = pathParts[pathParts.length - 1];
                        if (pathParts.includes('app_icons') && filename) {
                            currentImageIcon = filename;
                        }
                    } catch (e) {
                        // If URL parsing fails, try simple string extraction
                        if (currentImageIconEl.src.includes('/static_images/app_icons/')) {
                            const parts = currentImageIconEl.src.split('/static_images/app_icons/');
                            if (parts.length > 1) {
                                currentImageIcon = parts[1].split('?')[0]; // Remove query params
                            }
                        }
                    }
                }

                // Check if icons actually changed
                const expectedIconClass = (icon && !isImageIcon(icon)) ?
                    (imageIcon ? `${icon} icon-fa` : icon) : '';
                const iconChanged = expectedIconClass && (currentIcon !== expectedIconClass);

                // Check if image icon changed
                const expectedImageIcon = imageIcon || null;
                const imageIconChanged = (expectedImageIcon !== currentImageIcon);

                if (currentTitle !== title || iconChanged || imageIconChanged) {
                    existingItem.innerHTML = `
                        <div class="taskbar-window-item-content">
                            ${getIconHTML(icon, imageIcon)}
                            <span>${title}</span>
                        </div>
                    `;
                    wireIndividualTaskbarItemHandlers(existingItem, modal);
                }
            } else {
                // Create new individual item
                const title = getModalTitle(modal);
                const { icon, imageIcon } = getModalIcons(modal);

                const item = document.createElement('div');
                let className = 'taskbar-window-item entering';
                if (isActive && !isMinimised) className += ' active';
                if (isMinimised) className += ' minimised';
                item.className = className;
                item.dataset.modalId = modalId;

                item.innerHTML = `
                    <div class="taskbar-window-item-content">
                        ${getIconHTML(icon, imageIcon)}
                        <span>${title}</span>
                    </div>
                `;

                wireIndividualTaskbarItemHandlers(item, modal);

                // Remove entering class after shell grow animation completes
                item.addEventListener('animationend', (e) => {
                    if (e.target !== item || e.animationName !== 'taskbar-item-grow') return;
                    item.classList.remove('entering');
                }, { once: true });

                taskbarWindows.appendChild(item);
            }
        }
    });

    // Broadcast taskbar/window state changes so other UI controls can stay in sync.
    document.dispatchEvent(new CustomEvent('taskbarWindowsUpdated'));
}

function getModalTitle(modal) {
    // Try to get title from modal-window-title
    const titleEl = modal.querySelector('.modal-window-title-main span');
    if (titleEl) return titleEl.textContent;

    // Check if this is a gallery-move-modal-content modal (no titlebar)
    const galleryMoveContent = modal.querySelector('.gallery-move-modal-content');
    if (galleryMoveContent) {
        const leftHeader = modal.querySelector('.gallery-move-left-header');
        if (leftHeader) {
            // The header might be the h3 itself or contain an h3
            const h3 = leftHeader.tagName === 'H3' ? leftHeader : leftHeader.querySelector('h3');
            if (h3) {
                // Clone the element to get text without the icon
                const clone = h3.cloneNode(true);
                const iconEl = clone.querySelector('i');
                if (iconEl) {
                    iconEl.remove();
                }
                const title = clone.textContent.trim();
                if (title) return title;
            }
        }
    }

    // Fallback to modal header
    const headerEl = modal.querySelector('.modal-header span');
    if (headerEl) return headerEl.textContent;

    // Fallback to modal ID
    return modal.id || 'Window';
}

// Helper function to check if an icon is an image path
function isImageIcon(icon) {
    if (typeof icon !== 'string') return false;
    // Check if it's a full path starting with /
    if (icon.startsWith('/')) return true;
    // Check if it contains image file extensions
    return /\.(png|jpg|jpeg|svg|gif|webp)$/i.test(icon);
}

// Helper function to render an icon (Font Awesome class or image)
function renderIcon(icon, className = '') {
    if (!icon) return '';

    // If it's an image icon, render as img tag
    if (isImageIcon(icon)) {
        const imagePath = resolveAppIconPath(icon);
        const classAttr = className ? ` class="icon-image ${className}"` : ' class="icon-image"';
        return `<img src="${imagePath}" alt=""${classAttr} />`;
    }

    // Otherwise, it's a Font Awesome icon class
    const classAttr = className ? ` class="${icon} ${className}"` : ` class="${icon}"`;
    return `<i${classAttr}></i>`;
}

// Helper function to render both icon and imageIcon (for CSS-based switching)
function resolveAppIconPath(imageIcon) {
    const val = String(imageIcon || '').trim();
    if (!val) return '';
    if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//')) return val;
    if (val.startsWith('/')) return val;
    if (val.startsWith('static_images/')) return `/${val}`;
    return `/static_images/app_icons/${val}`;
}

function renderDualIcon(icon, imageIcon, className = '') {
    let html = '';

    // Render Font Awesome icon
    // Only add icon-fa class if there's an imageIcon (so it can be hidden in desktop mode)
    // If no imageIcon, don't add icon-fa class so the icon always shows
    if (icon && !isImageIcon(icon)) {
        if (imageIcon) {
            // Has imageIcon, so add icon-fa class to allow CSS hiding in desktop mode
            const classAttr = className ? ` class="${icon} ${className} icon-fa"` : ` class="${icon} icon-fa"`;
            html += `<i${classAttr}></i>`;
        } else {
            // No imageIcon, so don't add icon-fa class - icon will always show
            const classAttr = className ? ` class="${icon} ${className}"` : ` class="${icon}"`;
            html += `<i${classAttr}></i>`;
        }
    }

    // Render image icon (shown in desktop mode)
    if (imageIcon) {
        const imagePath = resolveAppIconPath(imageIcon);
        const classAttr = className ? ` class="icon-image ${className}"` : ' class="icon-image"';
        html += `<img src="${imagePath}" alt=""${classAttr} />`;
    } else if (icon && isImageIcon(icon)) {
        const imagePath = resolveAppIconPath(icon);
        const classAttr = className ? ` class="icon-image ${className}"` : ' class="icon-image"';
        html += `<img src="${imagePath}" alt=""${classAttr} />`;
    }

    return html;
}

// Helper function to get icon HTML string for use in innerHTML
// Supports both single icon and dual icon (icon + imageIcon) modes
function getIconHTML(icon, imageIcon = null, className = '') {
    // If imageIcon is provided, render both (for CSS switching)
    if (imageIcon !== null) {
        return renderDualIcon(icon, imageIcon, className);
    }

    // Otherwise, use single icon mode (backward compatible)
    return renderIcon(icon, className);
}

function getModalIcon(modal) {
    // Try to get icon from modal-window-title (prefer imageIcon for desktop mode, but taskbar is desktop-only)
    // For taskbar (desktop mode only), prefer image icon if available
    const imgEl = modal.querySelector('.modal-window-title-main img.icon-image');
    if (imgEl) {
        // Extract path from src (handle both relative and absolute URLs)
        const src = imgEl.src;
        const url = new URL(src, window.location.origin);
        return url.pathname; // Return just the path part (e.g., "/static_images/app_icons/studio.png")
    }

    // Fallback to Font Awesome icon
    const iconEl = modal.querySelector('.modal-window-title-main i');
    if (iconEl) {
        const iconClass = iconEl.className;
        if (iconClass) return iconClass;
    }

    // Check if this is a gallery-move-modal-content modal (no titlebar)
    const galleryMoveContent = modal.querySelector('.gallery-move-modal-content');
    if (galleryMoveContent) {
        const leftHeader = modal.querySelector('.gallery-move-left-header');
        if (leftHeader) {
            // The header might be the h3 itself or contain an h3
            const h3 = leftHeader.tagName === 'H3' ? leftHeader : leftHeader.querySelector('h3');
            if (h3) {
                // Prefer image icon for desktop mode (taskbar)
                const imgEl = h3.querySelector('img.icon-image');
                if (imgEl) {
                    const src = imgEl.src;
                    const url = new URL(src, window.location.origin);
                    return url.pathname;
                }
                // Fallback to Font Awesome icon
                const iconEl = h3.querySelector('i');
                if (iconEl) {
                    const iconClass = iconEl.className;
                    if (iconClass) return iconClass;
                }
            }
        }
    }

    // Fallback to default icon
    return 'fas fa-window';
}

// Get both Font Awesome icon and image icon from modal (for dual icon rendering)
function getModalIcons(modal) {
    let icon = null;
    let imageIcon = null;

    // Get Font Awesome icon
    const iconEl = modal.querySelector('.modal-window-title-main i');
    if (iconEl) {
        const iconClass = iconEl.className;
        // Remove icon-fa class if present to get just the icon classes
        icon = iconClass.replace(/\bicon-fa\b/g, '').trim();
    }

    // Get image icon
    const imgEl = modal.querySelector('.modal-window-title-main img.icon-image');
    if (imgEl) {
        const src = imgEl.src;
        const url = new URL(src, window.location.origin);
        // Extract just the filename from the path
        const pathParts = url.pathname.split('/');
        imageIcon = pathParts[pathParts.length - 1]; // Get filename (e.g., "studio.png")
    }

    // Check if this is a gallery-move-modal-content modal (no titlebar)
    if (!icon && !imageIcon) {
        const galleryMoveContent = modal.querySelector('.gallery-move-modal-content');
        if (galleryMoveContent) {
            const leftHeader = modal.querySelector('.gallery-move-left-header');
            if (leftHeader) {
                const h3 = leftHeader.tagName === 'H3' ? leftHeader : leftHeader.querySelector('h3');
                if (h3) {
                    if (!icon) {
                        const iconEl = h3.querySelector('i');
                        if (iconEl) {
                            const iconClass = iconEl.className;
                            icon = iconClass.replace(/\bicon-fa\b/g, '').trim();
                        }
                    }
                    if (!imageIcon) {
                        const imgEl = h3.querySelector('img.icon-image');
                        if (imgEl) {
                            const src = imgEl.src;
                            const url = new URL(src, window.location.origin);
                            const pathParts = url.pathname.split('/');
                            imageIcon = pathParts[pathParts.length - 1];
                        }
                    }
                }
            }
        }
    }

    // Fallback to default icon if nothing found
    if (!icon && !imageIcon) {
        icon = 'fas fa-window';
    }

    return { icon, imageIcon };
}

// Get modal type/group identifier for taskbar grouping
function getModalType(modal) {
    // Check for image viewer modals (multiple instances)
    if (modal.id && modal.id.startsWith('imageViewer_')) {
        return 'imageViewer';
    }

    // Check for notepad modals (if they follow similar pattern)
    if (modal.id && modal.id.startsWith('notepad_')) {
        return 'notepad';
    }

    if (modal.id && modal.id.startsWith('emphasisGroupsTool_')) {
        return modal.id;
    }

    // Check for specific modal classes
    if (modal.classList.contains('image-viewer-modal')) {
        return 'imageViewer';
    }

    if (modal.classList.contains('emphasis-groups-tool')) {
        return 'emphasisGroupsTool';
    }

    // For other modals, use their ID as the type (they won't group)
    // This allows unique modals to remain ungrouped
    return modal.id || 'unknown';
}

function isModalActive(modal) {
    if (!currentActiveWindowId) return false;
    if (!modal || !modal.id) return false;
    if (modal.id === currentActiveWindowId) return true;
    const activeEl = document.getElementById(currentActiveWindowId);
    if (activeEl && isToolWindow(activeEl)) {
        const parentId = activeEl.getAttribute('data-parent-modal-id');
        if (parentId && modal.id === parentId) {
            return true;
        }
    }
    return false;
}

/** Taskbar highlight only: parent-linked tool windows never get their own "active" taskbar button (parent shows active instead). */
function isModalActiveForTaskbar(modal) {
    if (!modal) return false;
    if (isToolWindow(modal)) {
        if (modal.getAttribute('data-parent-modal-id')) return false;
        if (modal.classList.contains('novel-editor-tool') || modal.classList.contains('novel-progress-tool')) {
            return false;
        }
    }
    return isModalActive(modal);
}

function getNonRootTaskbarWindowEntries() {
    const rootWindowIds = new Set(['galleryWindow', 'manualModal', 'windowsStartupModal', 'windowsUpdateModal', 'connectionDialModal']);
    const openModals = getOpenTaskbarModals()
        .filter((modal) => !rootWindowIds.has(modal.id));

    return openModals.map((modal) => {
        const title = getModalTitle(modal);
        const { icon } = getModalIcons(modal);
        const nonImageIcon = icon && !isImageIcon(icon) ? icon : 'fas fa-window';

        return {
            modalId: modal.id,
            title,
            icon: nonImageIcon,
            isMinimised: modal.classList.contains('minimised'),
            isActive: isModalActiveForTaskbar(modal)
        };
    });
}

function activateTaskbarWindowEntry(modalId) {
    if (!modalId) return false;

    const modal = document.getElementById(modalId);
    if (!modal || modal.classList.contains('hidden') || modal.classList.contains('closing')) {
        return false;
    }

    restoreMinimizedModal(modal, getOrCreateTaskbarItem(modal));

    bringModalToFront(modal);
    return true;
}

// Get or temporarily create taskbar item for minimize animation
function getOrCreateTaskbarItem(modal) {
    if (!taskbarWindows) return null;

    // Prefer a live item; a leaving ghost may still be animating out
    let taskbarItem = taskbarWindows.querySelector(
        `.taskbar-window-item[data-modal-id="${modal.id}"]:not(.leaving)`
    ) || taskbarWindows.querySelector(`.taskbar-window-item[data-modal-id="${modal.id}"]`);

    // If it doesn't exist yet (minimize before taskbar updates), create a temporary one
    if (!taskbarItem) {
        const title = getModalTitle(modal);
        const icon = getModalIcon(modal);

        taskbarItem = document.createElement('div');
        taskbarItem.className = 'taskbar-window-item minimised';
        taskbarItem.dataset.modalId = modal.id;
        taskbarItem.style.opacity = '0'; // Hidden until properly created

        // Get both icons for dual rendering
        const { icon: faIcon, imageIcon } = getModalIcons(modal);
        const iconToUse = icon || faIcon; // Use provided icon or fallback to modal icon

        taskbarItem.innerHTML = `
            <div class="taskbar-window-item-content">
                ${getIconHTML(iconToUse, imageIcon)}
                <span>${title}</span>
            </div>
        `;

        taskbarWindows.appendChild(taskbarItem);

        // Remove temporary flag after a short delay (will be replaced by real item)
        setTimeout(() => {
            if (taskbarItem.style.opacity === '0') {
                taskbarItem.style.opacity = '';
            }
        }, 100);
    }

    return taskbarItem;
}

function getModalMinimizeAnchorCenter(modal) {
    const offsetX = parseFloat(modal.style.getPropertyValue('--modal-offset-x')) || 0;
    const offsetY = parseFloat(modal.style.getPropertyValue('--modal-offset-y')) || 0;
    const trueInsetTop = getModalTrueInsetTop();
    return {
        centerX: (window.innerWidth / 2) + offsetX,
        centerY: (window.innerHeight / 2) + (0.5 * trueInsetTop) + offsetY - getDesktopModalTopBias()
    };
}

// Set CSS variables for minimize / unminimize animation target
function setMinimizeTargetVariables(modal, taskbarItem) {
    const modalRect = modal.getBoundingClientRect();
    const taskbarRect = taskbarItem.getBoundingClientRect();
    const anchor = getModalMinimizeAnchorCenter(modal);

    const taskbarCenterX = taskbarRect.left + (taskbarRect.width / 2);
    const taskbarCenterY = taskbarRect.top + (taskbarRect.height / 2);

    const offsetX = taskbarCenterX - anchor.centerX;
    const offsetY = taskbarCenterY - anchor.centerY;

    const modalWidth = modalRect.width > 0 ? modalRect.width : modal.offsetWidth;
    const scale = modalWidth > 0 ? Math.min(taskbarRect.width / modalWidth, 0.3) : 0.3;

    modal.style.setProperty('--minimize-target-x', `${offsetX}px`);
    modal.style.setProperty('--minimize-target-y', `${offsetY}px`);
    modal.style.setProperty('--minimize-target-scale', scale);
    modal.style.setProperty('--minimize-target-width', `${taskbarRect.width}px`);
}

function restoreMinimizedModal(modal, taskbarItem) {
    if (!modal || !modal.classList.contains('minimised')) {
        return;
    }

    const wasPixelSettled = modal.classList.contains('modal-pixel-settled');

    // Must be visible before reverting pixel anchor — getBoundingClientRect is all zeros while minimised.
    modal.classList.remove('minimised');
    void modal.offsetHeight;

    if (wasPixelSettled) {
        revertModalToOffsetAnchor(modal);
    }

    if (taskbarItem) {
        setMinimizeTargetVariables(modal, taskbarItem);
    }

    updateBackdropVisibility();
    modal.classList.add('unminimising');

    const unminimisingHandler = (e) => {
        if (e.target === modal && e.animationName === 'modalUnminimize' && modal.classList.contains('unminimising')) {
            modal.removeEventListener('animationend', unminimisingHandler);
            modal.classList.remove('unminimising');
            if (wasPixelSettled) {
                settleModalPixelAnchor(modal);
            }
        }
    };
    modal.addEventListener('animationend', unminimisingHandler);
}

// Toggle taskbar group menu (dropdown/dropup)
let activeGroupMenu = null;

function toggleTaskbarGroupMenu(groupItem, modals) {
    // Close any existing group menu
    if (activeGroupMenu && activeGroupMenu !== groupItem) {
        closeTaskbarGroupMenu();
    }

    // Check if this menu is already open
    const existingMenu = document.querySelector('.taskbar-group-menu');
    if (existingMenu && existingMenu.dataset.groupId === groupItem.dataset.groupType) {
        // Menu is open, close it
        closeTaskbarGroupMenu();
        return;
    }

    // Create menu
    const menu = document.createElement('div');
    menu.className = 'taskbar-group-menu';
    menu.dataset.groupId = groupItem.dataset.groupType;

    // Determine if menu should be dropup (if taskbar is at bottom)
    const taskbarRect = taskbarWindows.getBoundingClientRect();
    const isBottom = taskbarRect.bottom > window.innerHeight / 2;
    if (isBottom) {
        menu.classList.add('dropup');
    }

    // Create menu items for each modal
    const menuItems = modals.map(modal => {
        const title = getModalTitle(modal);
        const icon = getModalIcon(modal);
        const isActive = isModalActiveForTaskbar(modal) && !modal.classList.contains('minimised');
        const isMinimised = modal.classList.contains('minimised');

        const item = document.createElement('div');
        item.className = 'taskbar-group-menu-item';
        if (isActive) item.classList.add('active');
        if (isMinimised) item.classList.add('minimised');
        item.dataset.modalId = modal.id;

        item.innerHTML = `
            <i class="${icon}"></i>
            <span>${title}</span>
        `;

        // Click handler
        item.addEventListener('click', (e) => {
            e.stopPropagation();

            restoreMinimizedModal(modal, groupItem);
            if (modal.classList.contains('hidden')) {
                modal.classList.remove('hidden');
            }
            bringModalToFront(modal);

            // Close menu
            closeTaskbarGroupMenu();
        });

        // Right click handler - show context menu for the actual window
        item.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            e.stopPropagation();

            // Create a temporary taskbar item reference for the context menu
            const tempTaskbarItem = document.createElement('div');
            tempTaskbarItem.dataset.taskbarModal = modal.id;
            showTaskbarItemContextMenu(e, modal, tempTaskbarItem);
        });

        return item;
    });

    menu.append(...menuItems);
    document.body.appendChild(menu);

    // Position menu above or below the taskbar item
    const itemRect = groupItem.getBoundingClientRect();
    if (isBottom) {
        // Dropup - position above taskbar
        menu.style.bottom = `${window.innerHeight - itemRect.top + 4}px`;
        menu.style.left = `${itemRect.left}px`;
    } else {
        // Dropdown - position below taskbar
        menu.style.top = `${itemRect.bottom + 4}px`;
        menu.style.left = `${itemRect.left}px`;
    }

    // Mark as active
    activeGroupMenu = groupItem;
    groupItem.classList.add('group-menu-open');

    // Close menu when clicking outside
    const closeHandler = (e) => {
        if (!menu.contains(e.target) && !groupItem.contains(e.target)) {
            closeTaskbarGroupMenu();
            document.removeEventListener('click', closeHandler);
        }
    };

    // Use setTimeout to avoid immediate close
    setTimeout(() => {
        document.addEventListener('click', closeHandler);
    }, 10);
}

function closeTaskbarGroupMenu() {
    const menu = document.querySelector('.taskbar-group-menu');
    if (menu) {
        menu.remove();
    }

    if (activeGroupMenu) {
        activeGroupMenu.classList.remove('group-menu-open');
        activeGroupMenu = null;
    }
}

// Taskbar item context menu
function showTaskbarItemContextMenu(e, modal, taskbarItem) {
    e.preventDefault();
    e.stopPropagation();

    if (!contextMenu) {
        console.warn('Context menu not available');
        return;
    }

    // Store modal reference on taskbar item for action handling
    taskbarItem.dataset.taskbarModal = modal.id;

    // Register context menu config if not already done
    if (!contextMenu.configs) {
        contextMenu.configs = {};
    }

    // Build context menu dynamically from modal-window-controls
    const menuItems = [];
    const bottomItems = []; // For Center, Minimize, Maximize, Close

    const windowControls = modal.querySelector('.modal-window-controls');
    if (windowControls) {
        // Get all buttons and dropdowns in the window controls
        const controls = Array.from(windowControls.children);

        controls.forEach(control => {
            // Skip if hidden
            const computedStyle = window.getComputedStyle(control);
            if (computedStyle.display === 'none' || control.classList.contains('hidden')) {
                return;
            }

            // Handle dropdown menus
            if (control.classList.contains('custom-dropdown')) {
                const button = control.querySelector('button');
                if (!button) return;

                // Get icon and current value
                const icon = button.querySelector('i:not(.fa-chevron-down)')?.className || 'fas fa-chevron-down';
                const selectedSpan = button.querySelector('span');
                const currentValue = selectedSpan ? selectedSpan.textContent.trim() : '';
                const title = button.getAttribute('title') || false;

                // Add as disabled item showing current value
                menuItems.push({
                    icon: icon,
                    text: title ? `${title}: ${currentValue}` : currentValue,
                    disabled: true
                });
                return;
            }

            // Handle regular buttons
            if (control.tagName === 'BUTTON') {
                const iconEl = control.querySelector('i');
                const icon = iconEl ? iconEl.className : 'fas fa-circle';
                const title = control.getAttribute('title') || control.textContent.trim();
                const isDisabled = control.disabled;

                // Determine action based on button class or ID
                let action = null;
                let itemData = { icon, text: title, disabled: isDisabled };

                // Check for special buttons that should go to bottom
                if (control.classList.contains('minimize-btn')) {
                    itemData.action = 'taskbar-window-minimize';
                    bottomItems.push(itemData);
                    return;
                } else if (control.classList.contains('close-btn')) {
                    itemData.action = 'taskbar-window-close';
                    bottomItems.push(itemData);
                    return;
                } else if (control.classList.contains('modal-work-area-maximize')
                    || control.id === 'maximizeGalleryBtn'
                    || control.id === 'maximizePhotoSwipeBtn'
                    || control.id === 'restoreManualBtn') {
                    itemData.action = 'taskbar-window-maximize';
                    itemData.hidden = modal.id === 'galleryWindow';
                    bottomItems.push(itemData);
                    return;
                }

                // Regular button - add as-is with a generic action based on button ID
                if (control.id) {
                    itemData.action = `taskbar-window-button-${control.id}`;
                    itemData.buttonId = control.id;
                }

                menuItems.push(itemData);
            }
        });
    }

    // Add window layout actions to bottom items
    bottomItems.unshift({
        icon: 'fa-regular fa-compress-arrows-alt',
        text: 'Center',
        action: 'taskbar-window-center'
    });
    bottomItems.unshift({
        icon: 'fas fa-undo',
        text: 'Reset',
        action: 'taskbar-window-reset'
    });

    // Reorder bottom items: Center, Reset, Minimize, Maximize, Close
    const orderedBottomItems = [];
    const centerItem = bottomItems.find(item => item.action === 'taskbar-window-center');
    const resetItem = bottomItems.find(item => item.action === 'taskbar-window-reset');
    const minimizeItem = bottomItems.find(item => item.action === 'taskbar-window-minimize');
    const maximizeItem = bottomItems.find(item => item.action === 'taskbar-window-maximize');
    const closeItem = bottomItems.find(item => item.action === 'taskbar-window-close');

    if (centerItem) orderedBottomItems.push(centerItem);
    if (resetItem) orderedBottomItems.push(resetItem);
    if (minimizeItem) orderedBottomItems.push(minimizeItem);
    if (maximizeItem && !maximizeItem.hidden) orderedBottomItems.push(maximizeItem);

    // Add separator before close
    if (closeItem) {
        orderedBottomItems.push({ separator: true });
        orderedBottomItems.push(closeItem);
    }

    // Combine regular items with bottom items
    const allItems = [...menuItems, ...orderedBottomItems];

    const menuConfigId = `taskbar-window-controls-${modal.id}`;
    taskbarItem.dataset.contextMenu = menuConfigId;

    contextMenu.configs[menuConfigId] = {
        sections: [
            {
                type: 'list',
                items: allItems
            }
        ]
    };

    // Show context menu
    contextMenu.showMenu(e, taskbarItem);
}

// Show context menu for group taskbar item
function showTaskbarGroupContextMenu(e, groupItem, modals) {
    e.preventDefault();
    e.stopPropagation();

    if (!contextMenu) {
        console.warn('Context menu not available');
        return;
    }

    if (modals.length === 0) return;

    // Check if the currently active window is in this group
    const currentlyActiveModal = modalStack.length > 0 ? modalStack[modalStack.length - 1] : null;
    const activeModalInGroup = currentlyActiveModal && modals.includes(currentlyActiveModal)
        ? currentlyActiveModal
        : modals.find(m => isModalActiveForTaskbar(m) && !m.classList.contains('minimised'));

    // Build context menu - only include active modal's menu if it's in the group
    const menuItems = [];
    const bottomItems = [];

    // Only build window controls menu if active modal is in the group
    if (activeModalInGroup) {
        const windowControls = activeModalInGroup.querySelector('.modal-window-controls');
        if (windowControls) {
            const controls = Array.from(windowControls.children);

            controls.forEach(control => {
                const computedStyle = window.getComputedStyle(control);
                if (computedStyle.display === 'none' || control.classList.contains('hidden')) {
                    return;
                }

                if (control.classList.contains('custom-dropdown')) {
                    const button = control.querySelector('button');
                    if (!button) return;

                    const icon = button.querySelector('i:not(.fa-chevron-down)')?.className || 'fas fa-chevron-down';
                    const selectedSpan = button.querySelector('span');
                    const currentValue = selectedSpan ? selectedSpan.textContent.trim() : '';
                    const title = button.getAttribute('title') || false;

                    menuItems.push({
                        icon: icon,
                        text: title ? `${title}: ${currentValue}` : currentValue,
                        disabled: true
                    });
                    return;
                }

                if (control.tagName === 'BUTTON') {
                    const iconEl = control.querySelector('i');
                    const icon = iconEl ? iconEl.className : 'fas fa-circle';
                    const title = control.getAttribute('title') || control.textContent.trim();
                    const isDisabled = control.disabled;

                    let action = null;
                    let itemData = { icon, text: title, disabled: isDisabled };

                    if (control.classList.contains('minimize-btn')) {
                        itemData.action = 'taskbar-window-minimize';
                        bottomItems.push(itemData);
                        return;
                    } else if (control.classList.contains('close-btn')) {
                        itemData.action = 'taskbar-window-close';
                        bottomItems.push(itemData);
                        return;
                    } else if (control.classList.contains('modal-work-area-maximize')
                    || control.id === 'maximizeGalleryBtn'
                    || control.id === 'maximizePhotoSwipeBtn'
                    || control.id === 'restoreManualBtn') {
                        itemData.action = 'taskbar-window-maximize';
                        itemData.hidden = activeModalInGroup.id === 'galleryWindow';
                        bottomItems.push(itemData);
                        return;
                    }

                    if (control.id) {
                        itemData.action = `taskbar-window-button-${control.id}`;
                        itemData.buttonId = control.id;
                    }

                    menuItems.push(itemData);
                }
            });

            // Add window layout actions to bottom items
            bottomItems.unshift({
                icon: 'fa-regular fa-compress-arrows-alt',
                text: 'Center',
                action: 'taskbar-window-center'
            });
            bottomItems.unshift({
                icon: 'fas fa-undo',
                text: 'Reset',
                action: 'taskbar-window-reset'
            });

            // Reorder bottom items: Center, Reset, Minimize, Maximize, Close
            const orderedBottomItems = [];
            const centerItem = bottomItems.find(item => item.action === 'taskbar-window-center');
            const resetItem = bottomItems.find(item => item.action === 'taskbar-window-reset');
            const minimizeItem = bottomItems.find(item => item.action === 'taskbar-window-minimize');
            const maximizeItem = bottomItems.find(item => item.action === 'taskbar-window-maximize');
            const closeItem = bottomItems.find(item => item.action === 'taskbar-window-close');

            if (centerItem) orderedBottomItems.push(centerItem);
            if (resetItem) orderedBottomItems.push(resetItem);
            if (minimizeItem) orderedBottomItems.push(minimizeItem);
            if (maximizeItem && !maximizeItem.hidden) orderedBottomItems.push(maximizeItem);

            // Add separator before close
            if (closeItem) {
                orderedBottomItems.push({ separator: true });
                orderedBottomItems.push(closeItem);
            }

            // Combine regular items with bottom items
            menuItems.push(...orderedBottomItems);
        }
    }

    // Add group-specific actions
    const groupActions = [
        ...(activeModalInGroup && menuItems.length > 0 ? [{ separator: true }] : []), // Only add separator if we have items above
        {
            icon: 'fas fa-arrow-up',
            text: 'Pull Top',
            action: 'taskbar-group-pull-top'
        },
        {
            icon: 'fas fa-window-minimize',
            text: 'Minimize All',
            action: 'taskbar-group-minimize-all'
        },
        {
            icon: 'fas fa-times',
            text: 'Close All',
            action: 'taskbar-group-close-all'
        }
    ];

    const finalItems = [...menuItems, ...groupActions];

    // Store group info on the taskbar item for action handling
    groupItem.dataset.taskbarGroupModals = JSON.stringify(modals.map(m => m.id));
    // Also store the active modal for individual actions (only if it's in the group)
    if (activeModalInGroup) {
        groupItem.dataset.taskbarModal = activeModalInGroup.id;
    } else {
        // Remove it if it was set before
        delete groupItem.dataset.taskbarModal;
    }

    const menuConfigId = `taskbar-group-controls-${groupItem.dataset.groupType}`;
    groupItem.dataset.contextMenu = menuConfigId;

    contextMenu.configs[menuConfigId] = {
        sections: [
            {
                type: 'list',
                items: finalItems
            }
        ]
    };

    // Show context menu
    contextMenu.showMenu(e, groupItem);
}

// Handle taskbar context menu actions
document.addEventListener('contextMenuAction', (e) => {
    const action = e.detail.action;
    const target = e.detail.target;

    // Handle open desktop settings action
    if (action === 'open-desktop-settings') {
        openDesktopSettingsModal();
        return;
    }

    if (action === 'desktop-new-folder') {
        if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts) {
            const pos = desktopShortcuts.getContextMenuPosition(e.detail?.event);
            desktopShortcuts.createEmptyFolder({ position: pos });
        }
        return;
    }

    if (action === 'desktop-paste') {
        if (localStorage.getItem('userType') === 'readonly') {
            showGlassToast('warning', 'Desktop', 'Paste is not available in read-only mode', false, 4000);
            return;
        }
        const explorer = typeof initializeExplorerApplet === 'function'
            ? initializeExplorerApplet()
            : explorerApplet;
        if (explorer?.clipboard) {
            void explorer.pasteToDesktopSurface();
        }
        return;
    }

    // Handle exit desktop action
    if (action === 'exit-desktop') {
        maximizeGalleryWindow();
        return;
    }

    // Handle about Melaton action
    if (action === 'open-about-melatonin') {
        openAboutMelatoninModal();
        return;
    }

    // Handle group actions
    if (action.startsWith('taskbar-group-')) {
        const groupModalsJson = target.dataset.taskbarGroupModals;
        if (!groupModalsJson) return;

        const modalIds = JSON.parse(groupModalsJson);
        const modals = modalIds.map(id => document.getElementById(id)).filter(m => m);

        switch (action) {
            case 'taskbar-group-pull-top':
                // Bring all group modals to front by moving them to top of stack
                if (modals.length === 0) return;

                // Remove all group modals from stack first (in reverse order to maintain indices)
                modals.forEach(modal => {
                    const index = modalStack.indexOf(modal);
                    if (index !== -1) {
                        modalStack.splice(index, 1);
                    }
                });

                // Add all group modals to top of stack (they'll get highest z-indexes)
                modals.forEach(modal => {
                    modalStack.push(modal);
                });

                // Update z-indexes for all modals - group modals will now have highest z-indexes
                // This will also update the active window (top modal in stack)
                updateModalStackZIndexes();

                // Update taskbar to reflect new active state
                updateTaskbarActiveStates();
                break;

            case 'taskbar-group-minimize-all':
                modals.forEach(modal => {
                    if (!modal.classList.contains('minimised') && !modal.classList.contains('minimising')) {
                        const taskbarItem = getOrCreateTaskbarItem(modal);
                        if (taskbarItem) {
                            setMinimizeTargetVariables(modal, taskbarItem);
                        }

                        modal.classList.add('minimising');
                        setTimeout(() => {
                            modal.classList.add('minimised');
                            modal.classList.remove('minimising');
                            debouncedUpdateTaskbarWindows();
                            updateBackdropVisibility();
                        }, 250);
                    }
                });
                break;

            case 'taskbar-group-close-all':
                modals.forEach(modal => {
                    closeModal(modal);
                });
                break;
        }
        return;
    }

    if (!action.startsWith('taskbar-window-')) return;

    const modalId = target.dataset.taskbarModal;
    if (!modalId) return;

    const modal = document.getElementById(modalId);
    if (!modal) return;

    switch (action) {
        case 'taskbar-window-maximize':
            handleWindowMaximizeAction(modal);
            break;

        case 'taskbar-window-center':
            clearModalPixelAnchor(modal);
            setModalOffsetPx(modal, 0, 0, { snap: true, settle: true });
            modal.removeAttribute('data-modal-moved');
            break;

        case 'taskbar-window-reset':
            resetModalWindowLayout(modal);
            break;

        case 'taskbar-window-minimize':
            // Get or create the taskbar item to minimize to
            const taskbarItem = getOrCreateTaskbarItem(modal);
            if (taskbarItem) {
                setMinimizeTargetVariables(modal, taskbarItem);
            }

            // Add minimising animation class
            modal.classList.add('minimising');

            // After animation completes, add minimised class and remove animation class
            const minimisingAnimationHandler = (e) => {
                // Only handle animations on this modal while it has the minimising class
                if (e.target === modal && e.animationName === 'modalMinimize' && modal.classList.contains('minimising')) {
                    modal.removeEventListener('animationend', minimisingAnimationHandler);
                    modal.classList.add('minimised');
                    modal.classList.remove('minimising');
                    debouncedUpdateTaskbarWindows();
                    updateBackdropVisibility();
                }
            };
            modal.addEventListener('animationend', minimisingAnimationHandler);
            break;

        case 'taskbar-window-close':
            const closeBtn = modal.querySelector('.close-btn');
            if (closeBtn) closeBtn.click();
            break;

        default:
            // Handle generic button clicks (taskbar-window-button-{buttonId})
            if (action.startsWith('taskbar-window-button-')) {
                const buttonId = action.replace('taskbar-window-button-', '');
                const button = document.getElementById(buttonId);
                if (button && !button.disabled) {
                    button.click();
                }
            }
            break;
    }
});

// Start Menu Management
let startMenu = null;
let startMenuItems = null;

const START_MENU_DEFAULT_PINNED = ['workspace', 'studio'];

/** Launchable apps (pinned + All Apps). Not shown on the root shell unless pinned. */
const startMenuLaunchables = [
    {
        launchId: 'workspace',
        icon: 'fas fa-film-canister',
        imageIcon: 'art.png',
        text: 'Workspace',
        desktopOnly: true,
        appMenu: true,
        action: () => {
            if (isGalleryWindowHidden()) {
                showGalleryWindow();
            } else {
                bringModalToFront(galleryWindow);
            }
        }
    },
    {
        launchId: 'studio',
        icon: 'fas fa-compass-drafting',
        imageIcon: 'studio.png',
        text: 'Studio',
        fullName: 'DreamStudio 2025',
        desktopOnly: true,
        appMenu: true,
        action: () => { openManualModalWithContent(); }
    },
    { launchId: 'spellbook', icon: 'fas fa-hat-wizard', imageIcon: 'caster.png', text: 'Spellcaster', appMenu: true, action: () => { window.spellbookModalManager.openModal(); } },
    { launchId: 'reference', icon: 'fas fa-swatchbook', imageIcon: 'ref.png', text: 'Reference', appMenu: true, action: () => { showCacheManagerModal(); } },
    { launchId: 'bracket-generation', icon: 'fas fa-layer-group', imageIcon: 'stack.png', text: 'Phasewalker', desktopOnly: true, appMenu: true, action: () => { if (window.bracketGenerationApplet) { window.bracketGenerationApplet.open(); } else { const modal = document.getElementById('bracketGenerationModal'); if (modal) openModal(modal); } } },
    { launchId: 'encyclopedia', icon: 'fas fa-book', imageIcon: 'books.png', text: 'Grimoire', appMenu: true, action: () => { if (window.tagWikiSearchModal) { window.tagWikiSearchModal.open(); } else { const modal = document.getElementById('tagWikiSearchModal'); if (modal) openModal(modal); } } },
    { launchId: 'naxt', icon: 'fas fa-flask', imageIcon: 'test_tube.png', text: 'Atelier', appMenu: true, action: () => { if (window.naxtApplet) { window.naxtApplet.open(); } else { const modal = document.getElementById('naxtModal'); if (modal) openModal(modal); } } },
    { launchId: 'notebook', icon: 'fas fa-notebook', imageIcon: 'notebook.png', text: 'Notion', appMenu: true, action: () => { window.notepadManager.openNotebook(); }, rightAction: { icon: 'fas fa-sticky-note', tooltip: 'New Note', action: () => { window.notepadManager.handleNewNote(); } } },
    { launchId: 'chat', icon: 'fas fa-messages', imageIcon: 'chat.png', text: 'Chat', appMenu: true, action: () => { if (window.chatSystem) window.chatSystem.showAllChats(); } },
    { launchId: 'explorer', icon: 'fas fa-folder-open', imageIcon: 'explorer.png', text: 'Cartograph', appMenu: true, action: () => { openExplorerApplet(); } },
];

/** Root start menu shell rows (folders + run). */
const startMenuShellConfig = [
    { icon: 'fas fa-grid-2', imageIcon: 'atom.png', text: 'All Apps', hasSubmenu: true, submenu: 'all-apps', appMenu: false },
    { separator: true },
    {
        icon: 'fas fa-planet-ringed',
        imageIcon: 'planet.png',
        text: 'Planets',
        desktopOnly: true,
        hasSubmenu: true,
        submenu: 'planets',
        appMenu: false
    },
    { icon: 'fas fa-toolbox', imageIcon: 'toolbox.png', text: 'Toolbox', hasSubmenu: true, submenu: 'tools', appMenu: false },
    { launchId: 'run', icon: 'fas fa-magnifying-glass', imageIcon: 'search.png', text: 'Run', appMenu: false, action: () => { if (window.runApplet) { window.runApplet.open(); } } },
];

/** @deprecated Use startMenuLaunchables + startMenuShellConfig */
const startMenuConfig = startMenuLaunchables.concat(startMenuShellConfig);

function sortMenuItemsByIndex(items, indexKey = 'index') {
    return items
        .map((item, seq) => ({
            item,
            index: typeof item[indexKey] === 'number'
                ? item[indexKey]
                : (typeof item.index === 'number' ? item.index : seq),
            seq
        }))
        .sort((a, b) => (a.index - b.index) || (a.seq - b.seq))
        .map((entry) => entry.item);
}

function isStartMenuEntryEnabled(item) {
    if (!item || item.startMenu === false) return false;
    if (item.startMenuLocation === 'none') return false;
    return true;
}

function isAppMenuEntryEnabled(item) {
    if (!item || item.appMenu === false) return false;
    const loc = item.appMenuLocation;
    if (loc && loc !== 'all-apps') return false;
    return true;
}

function isAppMenuToolsEntryEnabled(item) {
    if (!item || item.appMenu === false) return false;
    const loc = item.appMenuLocation;
    if (loc === 'none' || loc === 'all-apps') return false;
    if (loc && loc !== 'tools' && loc !== 'toolbox') return false;
    return true;
}

function buildToolsSubmenuItems() {
    const staticItems = [
        { launchId: 'import', icon: 'nai-import', imageIcon: 'export.png', text: 'Import', appMenuLocation: 'tools', action: () => { unifiedUploadModalManager.show(); } },
        { launchId: 'presets', icon: 'fas fa-book-spells', imageIcon: 'presetbook.png', text: 'Spellbook', appMenuLocation: 'tools', action: () => { showPresetManager(); } },
        { launchId: 'expanders', icon: 'fas fa-book-font', imageIcon: 'expanders.png', text: 'Expanders', appMenuLocation: 'tools', action: () => { showTextReplacementManager(); } },
        { launchId: 'memories', icon: 'fas fa-box-open-full', imageIcon: 'dna.png', text: 'Enshutsuka', appMenuLocation: 'tools', action: () => { openKnowledgeMemoriesModal(); } },
        { launchId: 'config-editor', icon: 'fas fa-binary', imageIcon: 'slider.png', text: 'Runes', desktopOnly: true, appMenuLocation: 'tools', action: () => { if (window.configEditorApplet) { window.configEditorApplet.open(); } else { const modal = document.getElementById('configEditorModal'); if (modal) openModal(modal); } } },
        { launchId: 'event-viewer', icon: 'fas fa-wave-square', imageIcon: 'event_viewer.png', text: 'Periscope', desktopOnly: true, appMenuLocation: 'tools', action: () => { if (logViewerApplet) { logViewerApplet.open(); } else { const modal = document.getElementById('logViewerModal'); if (modal) openModal(modal); } } },
    ].filter(isStartMenuEntryEnabled);
    // getDsapStartMenuEntriesAtLocation: public/scripts/comp/dsapRegistry.js
    const dsapAtTools = typeof getDsapStartMenuEntriesAtLocation === 'function'
        ? getDsapStartMenuEntriesAtLocation('tools')
        : (typeof getDsapMenuEntriesAtLocation === 'function' ? getDsapMenuEntriesAtLocation('tools') : []);
    const staticCount = staticItems.length;

    const merged = staticItems
        .map((item, seq) => ({ ...item, startMenuIndex: seq, index: seq }))
        .concat(dsapAtTools.map((item, seq) => ({
            ...item,
            startMenuIndex: typeof item.startMenuIndex === 'number' ? item.startMenuIndex : staticCount + seq,
            index: typeof item.startMenuIndex === 'number' ? item.startMenuIndex : staticCount + seq
        })));

    return sortMenuItemsByIndex(merged, 'startMenuIndex');
}

function getAppMenuToolsItems() {
    const desktop = isDesktopStartMenuEnvironment();
    const candidates = [];

    buildToolsSubmenuItems().forEach((item, seq) => {
        if (!item || item.separator || item.hasSubmenu) return;
        if (!isAppMenuToolsEntryEnabled(item)) return;
        if (item.desktopOnly && !desktop) return;
        if (typeof item.action !== 'function') return;
        const appMenuIndex = typeof item.appMenuIndex === 'number'
            ? item.appMenuIndex
            : (typeof item.index === 'number' ? item.index : seq);
        candidates.push({ ...item, appMenuIndex, index: appMenuIndex });
    });

    return sortMenuItemsByIndex(candidates, 'appMenuIndex');
}

function getAllAppsMenuItems() {
    const desktop = isDesktopStartMenuEnvironment();
    const candidates = [];
    const seen = new Set();

    const tryAdd = (item, fallbackIndex) => {
        if (!item || item.separator || item.hasSubmenu) return;
        if (!isAppMenuEntryEnabled(item)) return;
        if (item.desktopOnly && !desktop) return;
        if (typeof item.action !== 'function') return;
        const launchId = item.launchId || item.text;
        if (seen.has(launchId)) return;
        seen.add(launchId);
        const appMenuIndex = typeof item.appMenuIndex === 'number'
            ? item.appMenuIndex
            : (typeof item.index === 'number' ? item.index : fallbackIndex);
        candidates.push({ ...item, appMenuIndex, index: appMenuIndex });
    };

    startMenuLaunchables.forEach((item, seq) => {
        tryAdd(item, seq);
    });

    const launchableCount = startMenuLaunchables.filter(isAppMenuEntryEnabled).length;
    // getDsapAppMenuEntries: public/scripts/comp/dsapRegistry.js
    const dsapAppItems = typeof getDsapAppMenuEntries === 'function'
        ? getDsapAppMenuEntries()
        : (typeof getDsapMenuEntries === 'function'
            ? getDsapMenuEntries().filter(isAppMenuEntryEnabled)
            : []);
    dsapAppItems.forEach((item, seq) => {
        tryAdd(item, launchableCount + seq);
    });

    return sortMenuItemsByIndex(candidates, 'appMenuIndex');
}

function startMenuPlanetLaunchId(workspaceId) {
    return `planet-${workspaceId}`;
}

function isStartMenuPlanetLaunchId(launchId) {
    return typeof launchId === 'string' && launchId.startsWith('planet-');
}

function buildPlanetsSubmenuItems() {
    const workspacesData = workspaces || window.workspaces || {};
    const workspacesList = Object.values(workspacesData).sort((a, b) => (a.sort || 0) - (b.sort || 0));

    if (workspacesList.length === 0) {
        return [{ icon: 'fas fa-planet-ringed', text: 'No workspaces', action: null }];
    }

    return workspacesList.map((ws) => ({
        launchId: startMenuPlanetLaunchId(ws.id),
        text: ws.name,
        color: ws.color,
        icon: 'fas fa-planet-ringed',
        appMenu: false,
        desktopOnly: true,
        action: () => {
            setActiveWorkspace(ws.id);
        }
    }));
}

function buildPlanetMenuItemFromLaunchId(launchId) {
    if (!isStartMenuPlanetLaunchId(launchId)) return null;
    const wsId = launchId.slice('planet-'.length);
    const workspacesData = workspaces || window.workspaces || {};
    const ws = workspacesData[wsId];
    if (!ws) return null;
    return {
        launchId,
        text: ws.name,
        color: ws.color,
        icon: 'fas fa-planet-ringed',
        appMenu: false,
        desktopOnly: true,
        action: () => {
            setActiveWorkspace(ws.id);
        }
    };
}

const startMenuSubmenus = {
    planets: () => buildPlanetsSubmenuItems(),
    tools: () => buildToolsSubmenuItems(),
    toolbox: () => buildToolsSubmenuItems(),
    'all-apps': () => getAllAppsMenuItems()
};

let startMenuPinnedLaunchIds = null;

function readStartMenuPinnedFromStorage() {
    try {
        if (!localStorage.getItem('startMenuPinned')) return null;
        const parsed = JSON.parse(localStorage.getItem('startMenuPinned'));
        if (!Array.isArray(parsed)) return null;
        return parsed.filter((id) => typeof id === 'string' && id.trim()).map((id) => id.trim());
    } catch (e) {
        return null;
    }
}

function getStartMenuPinnedLaunchIds() {
    if (startMenuPinnedLaunchIds === null) {
        return START_MENU_DEFAULT_PINNED.slice();
    }
    return startMenuPinnedLaunchIds.slice();
}

function isStartMenuItemPinned(launchId) {
    if (!launchId) return false;
    return getStartMenuPinnedLaunchIds().includes(launchId);
}

function applyStartMenuPinnedLaunchIds(ids) {
    if (ids === null) {
        startMenuPinnedLaunchIds = null;
        try {
            localStorage.removeItem('startMenuPinned');
        } catch (e) {
            /* */
        }
        return;
    }
    startMenuPinnedLaunchIds = ids
        .filter((id) => typeof id === 'string' && id.trim())
        .map((id) => id.trim())
        .slice(0, 48);
    try {
        localStorage.setItem('startMenuPinned', JSON.stringify(startMenuPinnedLaunchIds));
    } catch (e) {
        /* */
    }
}

async function persistStartMenuPinned() {
    const patch = {
        desktop: {
            startMenuPinned: startMenuPinnedLaunchIds === null
                ? START_MENU_DEFAULT_PINNED.slice()
                : startMenuPinnedLaunchIds.slice()
        }
    };
    if (typeof persistUserGlobalSettingsPatch === 'function') {
        await persistUserGlobalSettingsPatch(patch);
    }
}

async function setStartMenuItemPinned(launchId, pinned) {
    if (!launchId) return;
    const descriptor = findStartMenuLaunchableById(launchId);
    if (pinned && descriptor && !isStartMenuEntryEnabled(descriptor)) return;
    const ids = getStartMenuPinnedLaunchIds();
    const idx = ids.indexOf(launchId);
    if (pinned && idx < 0) {
        ids.push(launchId);
    } else if (!pinned && idx >= 0) {
        ids.splice(idx, 1);
    } else {
        return;
    }
    applyStartMenuPinnedLaunchIds(ids);
    await persistStartMenuPinned();
    buildStartMenu();
}

async function moveStartMenuPinnedItem(launchId, direction) {
    if (!launchId) return;
    const ids = getStartMenuPinnedLaunchIds();
    const idx = ids.indexOf(launchId);
    if (idx < 0) return;
    const target = direction === 'up' ? idx - 1 : idx + 1;
    if (target < 0 || target >= ids.length) return;
    const tmp = ids[target];
    ids[target] = ids[idx];
    ids[idx] = tmp;
    applyStartMenuPinnedLaunchIds(ids);
    await persistStartMenuPinned();
    buildStartMenu();
}

function flattenToolsSubmenuItems(items) {
    const out = [];
    if (!Array.isArray(items)) return out;
    items.forEach((item) => {
        if (!item) return;
        if (item.hasSubmenu && typeof item.submenu === 'function') {
            flattenToolsSubmenuItems(item.submenu()).forEach((nested) => out.push(nested));
            return;
        }
        out.push(item);
    });
    return out;
}

function collectStartMenuLaunchableDescriptors() {
    const out = [];
    const desktop = isDesktopStartMenuEnvironment();
    const seen = new Set();

    const pushItem = (item) => {
        if (!item || item.separator || item.hasSubmenu) return;
        if (!isStartMenuEntryEnabled(item)) return;
        if (item.desktopOnly && !desktop) return;
        if (!item.launchId || typeof item.action !== 'function') return;
        if (seen.has(item.launchId)) return;
        seen.add(item.launchId);
        out.push(item);
    };

    startMenuLaunchables.forEach(pushItem);
    flattenToolsSubmenuItems(buildToolsSubmenuItems()).forEach(pushItem);

    // getDsapMenuEntries: public/scripts/comp/dsapRegistry.js
    if (typeof getDsapMenuEntries === 'function') {
        getDsapMenuEntries().forEach(pushItem);
    }

    return out;
}

function findStartMenuLaunchableById(launchId) {
    if (!launchId) return null;
    const planetItem = buildPlanetMenuItemFromLaunchId(launchId);
    if (planetItem) return planetItem;
    return collectStartMenuLaunchableDescriptors().find((item) => item.launchId === launchId) || null;
}

function getStartMenuPinnedItems() {
    const pinnedSet = new Set();
    const items = [];
    const desktop = isDesktopStartMenuEnvironment();
    getStartMenuPinnedLaunchIds().forEach((launchId) => {
        if (pinnedSet.has(launchId)) return;
        const item = findStartMenuLaunchableById(launchId);
        if (!item) return;
        if (!isStartMenuEntryEnabled(item)) return;
        if (item.desktopOnly && !desktop) return;
        pinnedSet.add(launchId);
        items.push({ ...item, pinned: true });
    });
    return items;
}

function isDesktopStartMenuEnvironment() {
    return Boolean(document.body.classList.contains('desktop-mode') || window.isDesktop);
}

/**
 * Main start menu rows: drops desktopOnly off-desktop; optionally drops appRootOnly in desktop start menu.
 * @param {{ excludeAppRootOnly?: boolean }} [options] If excludeAppRootOnly is true, omit items with appRootOnly (desktop taskbar start menu).
 */
function getFilteredStartMenuConfig(options) {
    const opts = options && typeof options === 'object' ? options : {};
    const excludeAppRootOnly = opts.excludeAppRootOnly === true;
    const desktop = isDesktopStartMenuEnvironment();
    const stage = [];
    for (const item of startMenuShellConfig) {
        if (!item) continue;
        if (item.separator) {
            stage.push({ separator: true });
            continue;
        }
        if (item.desktopOnly && !desktop) continue;
        if (excludeAppRootOnly && item.appRootOnly) continue;
        stage.push(item);
    }
    const out = [];
    let prevSep = true;
    for (const item of stage) {
        if (item.separator) {
            if (!prevSep && out.length) {
                out.push(item);
                prevSep = true;
            }
        } else {
            out.push(item);
            prevSep = false;
        }
    }
    while (out.length && out[0].separator) out.shift();
    while (out.length && out[out.length - 1].separator) out.pop();
    return out;
}

/**
 * Flat list of start-menu launchables for Run applet search.
 * collectStartMenuLaunchables: public/scripts/comp/modalUtils.js
 */
function collectStartMenuLaunchables() {
    const out = [];
    const items = collectStartMenuLaunchableDescriptors();
    items.forEach((item) => {
        if (!item || typeof item.action !== 'function') return;
        const label = item.fullName || item.text || 'Application';
        out.push({
            launchId: item.launchId || label,
            label,
            subtitle: item.pinned ? 'Pinned' : 'Application',
            icon: item.icon,
            imageIcon: item.imageIcon,
            keywords: [item.text, item.fullName, item.launchId].filter(Boolean),
            execute: () => item.action()
        });
    });
    return out;
}

function fadeClientShutdownOverlay(run) {
    fadeClientShutdownOverlayAsync(run);
}

function fadeClientShutdownOverlayAsync(run) {
    return new Promise((resolve) => {
        let overlay = document.getElementById('clientShutdownOverlay');
        if (!overlay) {
            overlay = document.createElement('div');
            overlay.id = 'clientShutdownOverlay';
            overlay.className = 'client-shutdown-overlay';
            document.body.appendChild(overlay);
        }

        let finished = false;
        const finish = () => {
            if (finished) return;
            finished = true;
            overlay.removeEventListener('transitionend', onTransition);
            if (typeof bypassConfirmation !== 'undefined') {
                bypassConfirmation = true;
            }
            if (run) run();
            resolve();
        };

        const onTransition = (e) => {
            if (e.target === overlay && e.propertyName === 'opacity') {
                setTimeout(finish, 80);
            }
        };

        overlay.classList.remove('show');
        void overlay.offsetWidth;
        overlay.classList.add('show');
        overlay.addEventListener('transitionend', onTransition);
        setTimeout(finish, 700);
    });
}

function delayForClientShutdown(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function suppressWebSocketReconnectForReload() {
    const ws = window.wsClient;
    if (!ws) return;
    // suppressAutoReconnect — public/scripts/websocket.js
    ws.suppressAutoReconnect();
}

async function fetchServerStatusForRestart() {
    try {
        const response = await fetch('/status', { method: 'OPTIONS', cache: 'no-cache' });
        if (!response.ok) return null;
        return await response.json();
    } catch (_) {
        return null;
    }
}

async function waitForServerDisconnect(options = {}) {
    suppressWebSocketReconnectForReload();

    const timeoutMs = options.timeoutMs || 120000;
    const pollMs = options.pollMs || 500;
    const start = Date.now();

    return new Promise((resolve) => {
        let settled = false;
        let pollTimer = null;
        const ws = window.wsClient;
        let onDisconnect = null;

        const finish = (ok) => {
            if (settled) return;
            settled = true;
            if (pollTimer) clearInterval(pollTimer);
            if (ws && onDisconnect) ws.off('disconnected', onDisconnect);
            resolve(ok);
        };

        onDisconnect = () => finish(true);

        if (ws) {
            if (!ws.isConnected()) {
                finish(true);
                return;
            }
            ws.on('disconnected', onDisconnect);
        }

        pollTimer = setInterval(async () => {
            if (Date.now() - start > timeoutMs) {
                finish(false);
                return;
            }
            const status = await fetchServerStatusForRestart();
            if (!status || !status.isReady) {
                finish(true);
            }
        }, pollMs);
    });
}

function dismissTransientUIForShutdown() {
    closeAllStartMenuPopouts();
    if (startMenu && !startMenu.classList.contains('hidden')) {
        closeStartMenu({ immediate: true });
    }
    // contextMenu — public/scripts/comp/contextMenu.js
    if (typeof contextMenu !== 'undefined' && contextMenu?.hideMenu) {
        contextMenu.hideMenu();
    }
    // logViewerApplet — public/scripts/comp/logViewerApplet.js
    if (typeof logViewerApplet !== 'undefined' && logViewerApplet?.hideAllGlassPopovers) {
        logViewerApplet.hideAllGlassPopovers();
    }
    try {
        if (typeof lightbox !== 'undefined' && lightbox?.pswp?.isOpen) {
            lightbox.pswp.close();
        }
    } catch (_) { /* lightbox optional */ }
    if (typeof isConfirmationDialogActive === 'function' && isConfirmationDialogActive()
        && typeof hideConfirmationDialog === 'function') {
        hideConfirmationDialog();
    }
    closeStartMenuPowerDropdown();
}

function getModalsForShutdownClose() {
    const open = Array.from(document.querySelectorAll('.modal:not(.hidden)'))
        .filter((modal) => !modal.classList.contains('closing'));
    const remaining = new Set(open);
    const ordered = [];

    for (let i = modalStack.length - 1; i >= 0; i--) {
        const modal = modalStack[i];
        if (remaining.has(modal)) {
            ordered.push(modal);
            remaining.delete(modal);
        }
    }

    for (const modal of remaining) {
        ordered.push(modal);
    }

    return ordered;
}

async function closeAllModalsForShutdown() {
    let modals = getModalsForShutdownClose();
    let safety = 0;

    while (modals.length > 0 && safety < 64) {
        safety += 1;
        await closeModal(modals[0]);
        await delayForClientShutdown(120);
        modals = getModalsForShutdownClose();
    }
}

let clientShutdownSequenceRunning = false;

async function runClientShutdownSequence(finalAction) {
    if (clientShutdownSequenceRunning) return;
    clientShutdownSequenceRunning = true;

    try {
        suppressWebSocketReconnectForReload();
        dismissTransientUIForShutdown();
        await closeAllModalsForShutdown();
        await delayForClientShutdown(150);
        await fadeClientShutdownOverlayAsync(finalAction);
    } catch (error) {
        clientShutdownSequenceRunning = false;
        throw error;
    }
}

async function runClientRestartDirect() {
    closeStartMenuAfterPowerAction();
    await runClientShutdownSequence(() => location.reload());
}

async function runRestartDssDirect() {
    closeStartMenuAfterPowerAction();
    if (!serverManagement.isAdminSession()) {
        showGlassToast('error', 'Access Denied', 'Admin access required to restart DreamScape Server', false, 5000, '<i class="fas fa-lock"></i>');
        return;
    }
    if (!(await serverManagement.ensureAdminApiPath())) {
        showGlassToast('error', 'Restart DSS', 'Admin API path unavailable — please log in again as admin', false, 5000, '<i class="fas fa-scroll"></i>');
        return;
    }
    await serverManagement.requestRestartServer();
}

async function runClientShutdownDirect() {
    closeStartMenuAfterPowerAction();
    await runClientShutdownSequence(() => window.close());
}

function runLeaveDesktopModeDirect() {
    closeStartMenuAfterPowerAction();
    maximizeGalleryWindow();
}

function runLogoutDirect() {
    closeStartMenuAfterPowerAction();
    // handleLogout — public/scripts/app.js
    if (typeof handleLogout === 'function') {
        handleLogout();
    }
}

let startMenuPowerDropdown = null;
let startMenuPowerMenu = null;
let startMenuPowerToggle = null;

function getStartMenuPowerMenuItems() {
    const isAdmin = localStorage.getItem('userType') === 'admin';
    const items = [
        { id: 'shutdown', icon: 'fas fa-power-off', text: 'Shutdown', danger: true, action: () => runClientShutdownDirect() },
        { id: 'restart', icon: 'fas fa-rotate-right', text: 'Restart', action: () => runClientRestartDirect() },
        { id: 'leave-desktop', icon: 'fas fa-window-maximize', text: 'Leave Desktop Mode', desktopOnly: true, action: () => runLeaveDesktopModeDirect() },
        { id: 'logout', icon: 'fas fa-right-from-bracket', text: 'Sign Out', action: () => runLogoutDirect() },
        { id: 'restart-dss', icon: 'fas fa-rotate-right', text: 'Restart (Remote)', danger: true, adminOnly: true, action: () => runRestartDssDirect() },
    ];
    return items.filter((item) => {
        if (item.desktopOnly && !isDesktopStartMenuEnvironment()) return false;
        if (item.adminOnly && !isAdmin) return false;
        return true;
    });
}

function renderStartMenuPowerDropdown(menu) {
    menu.innerHTML = '';
    getStartMenuPowerMenuItems().forEach((item) => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (item.danger ? ' start-menu-power-option-danger' : '');
        option.tabIndex = 0;
        option.dataset.value = item.id;
        option.innerHTML = `<i class="${item.icon}"></i><span>${item.text}</span>`;
        const action = () => {
            item.action();
        };
        option.addEventListener('mousedown', (e) => {
            e.preventDefault();
        });
        option.addEventListener('click', (e) => {
            e.preventDefault();
            e.stopPropagation();
            closeDropdown(menu, startMenuPowerToggle);
            action();
        });
        touchSlopUtils.registerTouchSlopTracking(option);
        option.addEventListener('touchend', (e) => {
            const maxDelta = touchSlopUtils.finalizeTouchSlop(option, e);
            if (!touchSlopUtils.isTouchSlopTap(maxDelta)) return;
            e.preventDefault();
            closeDropdown(menu, startMenuPowerToggle);
            action();
        }, { passive: false });
        menu.appendChild(option);
    });
}

function setupStartMenuPowerDropdown() {
    if (!startMenuPowerDropdown || !startMenuPowerToggle || !startMenuPowerMenu) return;
    // setupDropdown — public/scripts/comp/dropdown.js
    setupDropdown(
        startMenuPowerDropdown,
        startMenuPowerToggle,
        startMenuPowerMenu,
        () => renderStartMenuPowerDropdown(startMenuPowerMenu),
        () => null,
        { preventFocusTransfer: true }
    );
}

function closeStartMenuPowerDropdown() {
    if (startMenuPowerMenu && startMenuPowerToggle) {
        closeDropdown(startMenuPowerMenu, startMenuPowerToggle);
    }
}

function closeStartMenuAfterPowerAction() {
    closeAllStartMenuSubmenus();
    closeStartMenuPowerDropdown();
    closeStartMenu();
}

let startMenuOutsideClickController = null;

function handleStartMenuOutsideClick(e) {
    if (!startMenu || startMenu.classList.contains('hidden')) return;
    if (startMenu.contains(e.target)) return;
    if (e.target.closest('#taskbarStartBtn')) return;
    if (e.target.closest('.start-menu-popout')) return;
    closeStartMenu();
}

function wireStartMenuOutsideClick() {
    if (startMenuOutsideClickController) {
        startMenuOutsideClickController.abort();
    }
    startMenuOutsideClickController = new AbortController();
    document.addEventListener('click', handleStartMenuOutsideClick, { signal: startMenuOutsideClickController.signal });
}

function unwireStartMenuOutsideClick() {
    if (startMenuOutsideClickController) {
        startMenuOutsideClickController.abort();
        startMenuOutsideClickController = null;
    }
}

function initializeStartMenu() {
    startMenu = document.getElementById('startMenu');
    startMenuItems = document.getElementById('startMenuItems');

    if (!startMenu || !startMenuItems) return;

    const storedPins = readStartMenuPinnedFromStorage();
    if (storedPins !== null) {
        applyStartMenuPinnedLaunchIds(storedPins);
    }

    // Build start menu
    buildStartMenu();

    // Toggle start menu on button click (once — initializeStartMenu may run more than once)
    const startBtn = document.getElementById('taskbarStartBtn');
    if (startBtn && startBtn.dataset.startMenuToggleWired !== 'true') {
        startBtn.dataset.startMenuToggleWired = 'true';
        startBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStartMenu();
        });
    }
}

let startMenuPopoutStack = [];
let startMenuPopoutTimers = { open: null, close: null };
const START_MENU_POPOUT_OPEN_DELAY = 120;
const START_MENU_POPOUT_CLOSE_DELAY = 220;

function isStartMenuPopoutHoverEnabled() {
    if (!window.matchMedia) return true;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function clearStartMenuPopoutTimers() {
    if (startMenuPopoutTimers.open) {
        clearTimeout(startMenuPopoutTimers.open);
        startMenuPopoutTimers.open = null;
    }
    if (startMenuPopoutTimers.close) {
        clearTimeout(startMenuPopoutTimers.close);
        startMenuPopoutTimers.close = null;
    }
}

function closeAllStartMenuPopouts() {
    clearStartMenuPopoutTimers();
    if (startMenu) {
        startMenu.querySelectorAll('.start-menu-item.popout-open').forEach((el) => el.classList.remove('popout-open'));
    }
    while (startMenuPopoutStack.length) {
        const el = startMenuPopoutStack.pop();
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }
}

function positionStartMenuPopout(popout, anchorEl) {
    const anchorRect = anchorEl.getBoundingClientRect();
    const menuEl = startMenu || document.getElementById('startMenu');
    const menuRight = menuEl ? menuEl.getBoundingClientRect().right : anchorRect.right;

    popout.style.position = 'fixed';
    popout.style.left = `${Math.round(menuRight)}px`;
    popout.style.top = `${Math.round(anchorRect.top)}px`;
    popout.style.maxHeight = `${Math.min(Math.round(window.innerHeight * 0.72), window.innerHeight - 16)}px`;

    requestAnimationFrame(() => {
        const popRect = popout.getBoundingClientRect();
        if (popRect.bottom > window.innerHeight - 8) {
            const adjust = popRect.bottom - (window.innerHeight - 8);
            popout.style.top = `${Math.max(8, anchorRect.top - adjust)}px`;
        }
        if (popRect.right > window.innerWidth - 8) {
            popout.style.left = `${Math.max(8, anchorRect.left - popRect.width)}px`;
        }
    });
}

function resolveStartMenuSubmenuItems(item) {
    if (!item) return [];
    if (typeof item.submenu === 'function') {
        return item.submenu() || [];
    }
    if (item.submenu && startMenuSubmenus[item.submenu]) {
        const submenuData = startMenuSubmenus[item.submenu];
        return typeof submenuData === 'function' ? submenuData() : submenuData;
    }
    return [];
}

function createStartMenuPopoutRow(item, level) {
    const row = document.createElement('div');
    row.className = 'start-menu-popout-item' + (item.hasSubmenu ? ' has-submenu' : '');

    const label = item.fullName ? item.fullName : item.text;
    if (item.color) {
        row.innerHTML = `
            <div class="workspace-color-indicator" style="background-color: ${item.color}"></div>
            <span>${label}</span>
        `;
    } else {
        row.innerHTML = `
            ${getIconHTML(item.icon, item.imageIcon)}
            <span>${label}</span>
        `;
    }

    if (item.hasSubmenu) {
        const openNestedPopout = () => {
            showStartMenuPopout(row, () => resolveStartMenuSubmenuItems(item), level + 1);
        };

        if (isStartMenuPopoutHoverEnabled()) {
            row.addEventListener('mouseenter', () => {
                clearStartMenuPopoutTimers();
                startMenuPopoutTimers.open = setTimeout(openNestedPopout, START_MENU_POPOUT_OPEN_DELAY);
            });
            row.addEventListener('mouseleave', (e) => {
                const nextPopout = startMenuPopoutStack[level + 1];
                if (nextPopout && e.relatedTarget && nextPopout.contains(e.relatedTarget)) return;
                clearStartMenuPopoutTimers();
                startMenuPopoutTimers.close = setTimeout(() => {
                    while (startMenuPopoutStack.length > level + 1) {
                        const el = startMenuPopoutStack.pop();
                        if (el && el.parentNode) el.parentNode.removeChild(el);
                    }
                    row.classList.remove('popout-open');
                }, START_MENU_POPOUT_CLOSE_DELAY);
            });
        }

        row.addEventListener('click', (e) => {
            e.stopPropagation();
            openNestedPopout();
        });
    } else {
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            if (item.action) item.action();
            closeStartMenu();
        });
        if (item.launchId) {
            attachStartMenuItemContextMenu(row, item);
        }
    }

    return row;
}

function showStartMenuPopout(anchorEl, itemsSource, level = 0) {
    while (startMenuPopoutStack.length > level) {
        const el = startMenuPopoutStack.pop();
        if (el && el.parentNode) el.parentNode.removeChild(el);
    }

    const items = typeof itemsSource === 'function' ? itemsSource() : itemsSource;
    if (!Array.isArray(items) || items.length === 0) return;

    const popout = document.createElement('div');
    popout.className = 'start-menu-popout';
    popout.dataset.level = String(level);

    const desktop = isDesktopStartMenuEnvironment();
    items.forEach((item) => {
        if (!item) return;
        if (item.separator) {
            const separator = document.createElement('div');
            separator.className = 'start-menu-popout-separator';
            popout.appendChild(separator);
            return;
        }
        if (item.desktopOnly && !desktop) return;
        popout.appendChild(createStartMenuPopoutRow(item, level));
    });

    if (!popout.childElementCount) return;

    document.body.appendChild(popout);
    positionStartMenuPopout(popout, anchorEl);
    startMenuPopoutStack.push(popout);
    anchorEl.classList.add('popout-open');

    if (isStartMenuPopoutHoverEnabled()) {
        popout.addEventListener('mouseenter', () => clearStartMenuPopoutTimers());
        popout.addEventListener('mouseleave', () => {
            clearStartMenuPopoutTimers();
            startMenuPopoutTimers.close = setTimeout(() => {
                while (startMenuPopoutStack.length > level) {
                    const el = startMenuPopoutStack.pop();
                    if (el && el.parentNode) el.parentNode.removeChild(el);
                }
                anchorEl.classList.remove('popout-open');
            }, START_MENU_POPOUT_CLOSE_DELAY);
        });
    }
}

function wireStartMenuFolderItem(menuItemEl, item) {
    const openPopout = () => {
        showStartMenuPopout(menuItemEl, () => resolveStartMenuSubmenuItems(item), 0);
    };

    if (isStartMenuPopoutHoverEnabled()) {
        menuItemEl.addEventListener('mouseenter', () => {
            clearStartMenuPopoutTimers();
            startMenuPopoutTimers.open = setTimeout(openPopout, START_MENU_POPOUT_OPEN_DELAY);
        });
        menuItemEl.addEventListener('mouseleave', (e) => {
            const popout = startMenuPopoutStack[0];
            if (popout && e.relatedTarget && popout.contains(e.relatedTarget)) return;
            clearStartMenuPopoutTimers();
            startMenuPopoutTimers.close = setTimeout(() => {
                closeAllStartMenuPopouts();
            }, START_MENU_POPOUT_CLOSE_DELAY);
        });
    }

    menuItemEl.addEventListener('click', (e) => {
        e.stopPropagation();
        if (menuItemEl.classList.contains('popout-open')) {
            closeAllStartMenuPopouts();
        } else {
            openPopout();
        }
    });
}

function createStartMenuRowElement(item, options = {}) {
    const menuItem = document.createElement('div');
    menuItem.className = 'start-menu-item'
        + (item.hasSubmenu ? ' has-submenu' : '')
        + (item.rightAction ? ' has-right-action' : '')
        + (options.pinned ? ' is-pinned' : '');

    const label = item.fullName ? item.fullName : item.text;
    if (item.color) {
        menuItem.innerHTML = `
            <div class="workspace-color-indicator" style="background-color: ${item.color}"></div>
            <span>${label}</span>
            ${item.rightAction ? `<button class="start-menu-right-btn" title="${item.rightAction.tooltip || ''}">${getIconHTML(item.rightAction.icon, item.rightAction.imageIcon)}</button>` : ''}
        `;
    } else {
        menuItem.innerHTML = `
            ${getIconHTML(item.icon, item.imageIcon)}
            <span>${label}</span>
            ${item.rightAction ? `<button class="start-menu-right-btn" title="${item.rightAction.tooltip || ''}">${getIconHTML(item.rightAction.icon, item.rightAction.imageIcon)}</button>` : ''}
        `;
    }

    if (item.hasSubmenu) {
        wireStartMenuFolderItem(menuItem, item);
    } else {
        if (item.rightAction) {
            const rightBtn = menuItem.querySelector('.start-menu-right-btn');
            if (rightBtn) {
                rightBtn.addEventListener('click', (e) => {
                    e.stopPropagation();
                    if (item.rightAction.action) item.rightAction.action();
                    closeStartMenu();
                });
            }
        }

        menuItem.addEventListener('click', () => {
            if (item.action) item.action();
            closeStartMenu();
        });

        if (item.launchId) {
            attachStartMenuItemContextMenu(menuItem, item);
        }
    }

    return menuItem;
}

function buildStartMenu() {
    if (!startMenuItems) return;

    closeAllStartMenuPopouts();
    startMenuItems.innerHTML = '';

    const desktop = isDesktopStartMenuEnvironment();
    const pinnedItems = getStartMenuPinnedItems();

    if (pinnedItems.length > 0) {
        pinnedItems.forEach((item) => {
            startMenuItems.appendChild(createStartMenuRowElement(item, { pinned: true }));
        });
    }

    getFilteredStartMenuConfig({ excludeAppRootOnly: desktop }).forEach(item => {
        if (item.separator) {
            const separator = document.createElement('div');
            separator.className = 'start-menu-separator';
            startMenuItems.appendChild(separator);
        } else {
            startMenuItems.appendChild(createStartMenuRowElement(item));
        }
    });

    const iconRow = document.createElement('div');
    iconRow.className = 'start-menu-icons-row';

    const powerGroup = document.createElement('div');
    powerGroup.className = 'start-menu-power-group btn-group';

    const shutdownMainBtn = document.createElement('button');
    shutdownMainBtn.type = 'button';
    shutdownMainBtn.className = 'start-menu-action-btn start-menu-action-danger';
    shutdownMainBtn.innerHTML = '<i class="fas fa-power-off"></i><span>Shutdown</span>';
    shutdownMainBtn.title = 'Shut down and close this tab';
    shutdownMainBtn.addEventListener('click', () => {
        runClientShutdownDirect();
    });

    startMenuPowerDropdown = document.createElement('div');
    startMenuPowerDropdown.id = 'startMenuPowerDropdown';
    startMenuPowerDropdown.className = 'custom-dropdown dropup dark dropright start-menu-power-dropdown';

    startMenuPowerToggle = document.createElement('button');
    startMenuPowerToggle.type = 'button';
    startMenuPowerToggle.id = 'startMenuPowerDropdownBtn';
    startMenuPowerToggle.className = 'start-menu-action-btn start-menu-action-danger start-menu-power-toggle';
    startMenuPowerToggle.innerHTML = '<i class="fas fa-chevron-up"></i>';
    startMenuPowerToggle.title = 'More power options';

    startMenuPowerMenu = document.createElement('div');
    startMenuPowerMenu.id = 'startMenuPowerDropdownMenu';
    startMenuPowerMenu.className = 'custom-dropdown-menu hidden';

    startMenuPowerDropdown.appendChild(startMenuPowerToggle);
    startMenuPowerDropdown.appendChild(startMenuPowerMenu);

    powerGroup.appendChild(shutdownMainBtn);
    powerGroup.appendChild(startMenuPowerDropdown);
    iconRow.appendChild(powerGroup);
    startMenuItems.appendChild(iconRow);

    setupStartMenuPowerDropdown();
}

function closeAllStartMenuSubmenus() {
    closeStartMenuPowerDropdown();
    closeAllStartMenuPopouts();
}

const START_MENU_FADE_OUT_MS = 320;

function openStartMenu() {
    if (!startMenu) return;
    if (!startMenu.classList.contains('hidden') && !startMenu.classList.contains('start-menu-closing')) {
        return;
    }

    startMenu.classList.remove('hidden', 'start-menu-closing');
    const startBtn = document.getElementById('taskbarStartBtn');
    if (startBtn) startBtn.classList.add('active');

    startMenu.classList.remove('start-menu-opening');
    void startMenu.offsetWidth;
    startMenu.classList.add('start-menu-opening');

    let cleared = false;
    const clearOpening = () => {
        if (cleared) return;
        cleared = true;
        startMenu.classList.remove('start-menu-opening');
        startMenu.removeEventListener('animationend', onOpenEnd);
    };

    const onOpenEnd = (e) => {
        if (e.target !== startMenu || e.animationName !== 'startMenuFadeIn') return;
        clearOpening();
    };

    startMenu.addEventListener('animationend', onOpenEnd);
    setTimeout(clearOpening, 280);
    wireStartMenuOutsideClick();
}

function closeStartMenu(options = {}) {
    if (!startMenu) return;

    const startBtn = document.getElementById('taskbarStartBtn');
    const immediate = options.immediate === true;

    if (startMenu.classList.contains('hidden') && !startMenu.classList.contains('start-menu-closing')) {
        if (startBtn) startBtn.classList.remove('active');
        unwireStartMenuOutsideClick();
        return;
    }

    unwireStartMenuOutsideClick();
    closeAllStartMenuSubmenus();
    if (startBtn) startBtn.classList.remove('active');

    if (immediate) {
        startMenu.classList.remove('start-menu-opening', 'start-menu-closing');
        startMenu.classList.add('hidden');
        return;
    }

    if (startMenu.classList.contains('start-menu-closing')) {
        return;
    }

    startMenu.classList.remove('start-menu-opening');
    startMenu.classList.add('start-menu-closing');

    let finished = false;
    const finish = () => {
        if (finished) return;
        finished = true;
        startMenu.classList.remove('start-menu-closing');
        startMenu.classList.add('hidden');
    };

    const onCloseEnd = (e) => {
        if (e.target !== startMenu || e.animationName !== 'startMenuFadeOut') return;
        startMenu.removeEventListener('animationend', onCloseEnd);
        finish();
    };

    startMenu.addEventListener('animationend', onCloseEnd);
    setTimeout(finish, START_MENU_FADE_OUT_MS);
}

function toggleStartMenu() {
    if (!startMenu) return;

    if (startMenu.classList.contains('hidden') && !startMenu.classList.contains('start-menu-closing')) {
        openStartMenu();
    } else {
        closeStartMenu();
    }
}

// Attach context menu to start menu items
function attachStartMenuItemContextMenu(element, item) {
    if (!contextMenu || !item.launchId) return;

    const contextMenuConfig = {
        sections: [
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-thumbtack',
                        text: 'Show in Start Menu',
                        action: 'toggle-start-menu-pin',
                        hidden: () => !isStartMenuEntryEnabled(item),
                        loadfn: (ctxItem) => {
                            const pinned = isStartMenuItemPinned(item.launchId);
                            ctxItem.text = pinned ? 'Unpin from Start Menu' : 'Show in Start Menu';
                        }
                    },
                    {
                        icon: 'fas fa-arrow-up',
                        text: 'Move Up',
                        action: 'pin-move-up',
                        hidden: () => !isStartMenuEntryEnabled(item) || !isStartMenuItemPinned(item.launchId),
                        loadfn: (ctxItem) => {
                            const idx = getStartMenuPinnedLaunchIds().indexOf(item.launchId);
                            ctxItem.disabled = idx <= 0;
                        }
                    },
                    {
                        icon: 'fas fa-arrow-down',
                        text: 'Move Down',
                        action: 'pin-move-down',
                        hidden: () => !isStartMenuEntryEnabled(item) || !isStartMenuItemPinned(item.launchId),
                        loadfn: (ctxItem) => {
                            const ids = getStartMenuPinnedLaunchIds();
                            const idx = ids.indexOf(item.launchId);
                            ctxItem.disabled = idx < 0 || idx >= ids.length - 1;
                        }
                    },
                    { separator: true, hidden: () => !isStartMenuEntryEnabled(item) },
                    {
                        icon: 'fas fa-arrow-down-left',
                        text: 'Add to Desktop...',
                        action: 'add-to-desktop',
                        hidden: () => isStartMenuPlanetLaunchId(item.launchId),
                        loadfn: (ctxItem) => {
                            if (desktopShortcuts && desktopShortcuts.hasAppletShortcut(item.launchId)) {
                                ctxItem.disabled = true;
                                ctxItem.text = 'Already on Desktop';
                            }
                        }
                    }
                ]
            }
        ],
        onAction: async (action) => {
            if (action === 'toggle-start-menu-pin') {
                await setStartMenuItemPinned(item.launchId, !isStartMenuItemPinned(item.launchId));
                return;
            }
            if (action === 'pin-move-up') {
                await moveStartMenuPinnedItem(item.launchId, 'up');
                return;
            }
            if (action === 'pin-move-down') {
                await moveStartMenuPinnedItem(item.launchId, 'down');
                return;
            }
            if (action === 'add-to-desktop') {
                await addAppletToDesktop(item);
            }
        }
    };

    contextMenu.attachToElement(element, contextMenuConfig);
}

// Add applet shortcut to desktop
async function addAppletToDesktop(appletItem) {
    if (!desktopShortcuts) {
        console.error('Desktop shortcuts manager not available');
        return;
    }

    // Check if already exists
    if (desktopShortcuts.hasAppletShortcut(appletItem.launchId)) {
        showGlassToast('info', null, 'Shortcut already exists', false, 3000, '<i class="fas fa-info-circle"></i>');
        return;
    }

    try {
        await desktopShortcuts.addShortcut({
            name: appletItem.text,
            type: 'applet',
            data: {
                launchId: appletItem.launchId,
                icon: appletItem.icon
            }
        });

        showGlassToast('success', null, 'Added to desktop', false, 3000, '<i class="fas fa-check"></i>');
    } catch (error) {
        console.error('Failed to add applet to desktop:', error);
        showGlassToast('error', 'Error', 'Failed to add shortcut', false, 5000, '<i class="fas fa-exclamation-triangle"></i>');
    }
}

// Desktop Wallpaper Management
function initializeDesktopWallpaper() {
    setupDesktopContextMenu();
}

// Save wallpaper to workspace (server will broadcast update)
async function setDesktopWallpaper(wallpaperPath, wallpaperPosition = 'center') {
    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';

    if (!workspaces || !workspaces[currentWorkspace]) {
        console.warn('Current workspace not found');
        return;
    }

    // Update local workspace object first
    if (wallpaperPath) {
        workspaces[currentWorkspace].wallpaper = wallpaperPath;
        workspaces[currentWorkspace].wallpaperPosition = wallpaperPosition || 'center';
    } else {
        delete workspaces[currentWorkspace].wallpaper;
        delete workspaces[currentWorkspace].wallpaperPosition;
    }

    // Regenerate styles for immediate visual update
    generateWorkspaceStyles(currentWorkspace);

    // Save via WebSocket (server will broadcast to other clients)
    if (wsClient && wsClient.isConnected()) {
        const settings = {
            wallpaper: wallpaperPath,
            wallpaperPosition: wallpaperPath ? (wallpaperPosition || 'center') : null
        };
        await wsClient.updateWorkspaceSettings(currentWorkspace, settings);
    }
}

// Clear wallpaper from workspace
async function clearDesktopWallpaper() {
    await setDesktopWallpaper(null);
}

// Precache wallpaper: delete old cache entry and load new one
async function precacheWallpaper(wallpaperUrl) {
    try {
        // Use service worker manager to delete old cache and precache new file
        if (window.serviceWorkerManager) {
            await window.serviceWorkerManager.deleteAndPrecache(wallpaperUrl);
        } else {
            // Fallback if service worker manager is not available
            const img = new Image();
            await new Promise((resolve, reject) => {
                img.onload = resolve;
                img.onerror = reject;
                img.src = `${wallpaperUrl}?t=${Date.now()}`;
            });
        }
    } catch (error) {
        console.warn('Error precaching wallpaper:', error);
        // Continue anyway - the image will still load, just might be slower
    }
}

// Upload custom wallpaper
async function uploadCustomWallpaper(file) {
    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';

    if (!workspaces || !workspaces[currentWorkspace]) {
        showGlassToast('error', 'Error', 'Current workspace not found', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    // Check if fileToBase64 is available
    if (typeof fileToBase64 !== 'function') {
        showGlassToast('error', 'Error', 'File upload utility not available', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
        return;
    }

    let toastId = showGlassToast('info', 'Uploading Wallpaper', 'Uploading custom wallpaper...', true, false, '<i class="fas fa-upload"></i>');

    try {
        // Convert file to base64
        const base64 = await fileToBase64(file);

        // Upload via WebSocket
        if (wsClient && wsClient.isConnected()) {
            const response = await wsClient.uploadWallpaper(base64, currentWorkspace);

            if (response.success) {
                // Precache the new wallpaper: delete old cache entry, then load and cache the new one
                const wallpaperUrl = `/cache/wallpapers/${currentWorkspace}.png`;
                await precacheWallpaper(wallpaperUrl);

                // Update the wallpaper state to use the custom wallpaper
                desktopSettingsState.wallpaperUrl = wallpaperUrl;

                // Update preview after precaching so user can position it before saving
                updateDesktopSettingsPreview();

                updateGlassToastComplete(toastId, {
                    type: 'success',
                    title: 'Wallpaper Uploaded',
                    message: 'Custom wallpaper uploaded successfully',
                    customIcon: '<i class="fas fa-check-circle"></i>',
                    showProgress: false,
                    timeout: 3000
                });
            } else {
                throw new Error(response.message || 'Upload failed');
            }
        } else {
            throw new Error('WebSocket not connected');
        }
    } catch (error) {
        console.error('Error uploading wallpaper:', error);
        updateGlassToastComplete(toastId, {
            type: 'error',
            title: 'Upload Failed',
            message: error.message || 'Failed to upload wallpaper',
            customIcon: '<i class="fas fa-exclamation-triangle"></i>',
            showProgress: false,
            timeout: 10000
        });
    }
}

// Desktop Settings Modal State
let desktopSettingsState = {
    // Workspace settings (temporary, only saved on "Save")
    name: '',
    color: '#102040',
    backgroundColor: '#0a1a2a',
    primaryFont: null,
    textareaFont: null,
    // Wallpaper settings
    wallpaperUrl: null,
    horizontalAlign: 'center',
    verticalAlign: 'center',
    customHorizontal: 50,
    customVertical: 50
};

let desktopSettingsGlobalState = {
    autoLaunchWorkspace: true,
    liveWindowRepositioning: (() => {
        try {
            return localStorage.getItem('liveWindowRepositioning') === 'true';
        } catch (e) {
            return false;
        }
    })(),
    exitDesktopOnWorkspaceMaximise: (() => {
        try {
            return localStorage.getItem('exitDesktopOnWorkspaceMaximise') === 'true';
        } catch (e) {
            return false;
        }
    })(),
    virtualKeyboardEnabled: (() => {
        try {
            return localStorage.getItem('virtualKeyboardEnabled') === 'true';
        } catch (e) {
            return false;
        }
    })(),
    notificationBridgeEnabled: (() => {
        // readNotificationBridgeEnabledPreference — public/scripts/comp/toastManager.js
        if (typeof readNotificationBridgeEnabledPreference === 'function') {
            return readNotificationBridgeEnabledPreference();
        }
        return true;
    })(),
    bypassNotificationBridgeInDesktopMode: (() => {
        // readBypassNotificationBridgeInDesktopPreference — public/scripts/comp/toastManager.js
        if (typeof readBypassNotificationBridgeInDesktopPreference === 'function') {
            return readBypassNotificationBridgeInDesktopPreference();
        }
        return false;
    })(),
    startMenuButtonPreset: 'start-ja',
    startMenuButtonCustomText: '',
    startMenuButtonStyle: 'workspace'
};

// Authentic Windows XP Luna start-button strings per locale (explorer.exe string 578).
const START_MENU_BUTTON_PRESET_META = {
    'start-ja': { group: 'Start', label: 'Japanese', text: 'スタート' },
    'start-ko': { group: 'Start', label: 'Korean', text: '시작' },
    'start-en': { group: 'Start', label: 'English', text: 'start' },
    'start-fr': { group: 'Start', label: 'French', text: 'démarrer' },
    'start-ru': { group: 'Start', label: 'Russian', text: 'Пуск' },
    'dream-ja': { group: 'Dream', label: 'Japanese', text: 'ドリーム' },
    'dream-ko': { group: 'Dream', label: 'Korean', text: '드림' },
    'dream-en': { group: 'Dream', label: 'English', text: 'dream' },
    'dream-fr': { group: 'Dream', label: 'French', text: 'Rêve' },
    'dream-ru': { group: 'Dream', label: 'Russian', text: 'Дрим' },
    custom: { group: 'Other', label: 'Custom Text', text: null }
};

const START_MENU_BUTTON_PRESET_ORDER = [
    'start-ja', 'start-ko', 'start-en', 'start-fr', 'start-ru',
    'dream-ja', 'dream-ko', 'dream-en', 'dream-fr', 'dream-ru',
    'custom'
];

function normalizeStartMenuButtonPresetClient(preset) {
    if (preset === 'start-de') {
        return 'start-en';
    }
    return START_MENU_BUTTON_PRESET_ORDER.includes(preset) ? preset : 'start-ja';
}

function getStartMenuButtonPresetGroups() {
    const groups = [];
    const groupNames = ['Start', 'Dream', 'Other'];
    groupNames.forEach((groupName) => {
        const options = START_MENU_BUTTON_PRESET_ORDER
            .filter((preset) => START_MENU_BUTTON_PRESET_META[preset].group === groupName)
            .map((preset) => {
                const meta = START_MENU_BUTTON_PRESET_META[preset];
                if (preset === 'custom') {
                    return { value: preset, label: 'Custom Text' };
                }
                return {
                    value: preset,
                    label: `"${meta.group}" — ${meta.label} (${meta.text})`
                };
            });
        if (options.length) {
            groups.push({ group: groupName, options });
        }
    });
    return groups;
}

function getStartMenuButtonPresetLabel(preset, customText = '') {
    const normalized = normalizeStartMenuButtonPresetClient(preset);
    if (normalized === 'custom') {
        const trimmed = typeof customText === 'string' ? customText.trim() : '';
        return trimmed ? `Custom Text (${trimmed})` : 'Custom Text';
    }
    const meta = START_MENU_BUTTON_PRESET_META[normalized];
    return `"${meta.group}" — ${meta.label} (${meta.text})`;
}

function resolveStartMenuButtonDisplayText(preset, customText = '') {
    const normalized = normalizeStartMenuButtonPresetClient(preset);
    if (normalized === 'custom') {
        const trimmed = typeof customText === 'string' ? customText.trim() : '';
        return trimmed || START_MENU_BUTTON_PRESET_META['start-ja'].text;
    }
    return START_MENU_BUTTON_PRESET_META[normalized].text;
}

function normalizeStartMenuButtonStyleClient(style) {
    return ['luna', 'workspace', 'orb'].includes(style) ? style : 'workspace';
}

function readDesktopSettingsStartMenuButtonPreference() {
    return {
        preset: normalizeStartMenuButtonPresetClient(desktopSettingsGlobalState.startMenuButtonPreset),
        customText: typeof desktopSettingsGlobalState.startMenuButtonCustomText === 'string'
            ? desktopSettingsGlobalState.startMenuButtonCustomText.trim().slice(0, 24)
            : '',
        style: normalizeStartMenuButtonStyleClient(desktopSettingsGlobalState.startMenuButtonStyle)
    };
}

function applyStartMenuButtonStyleToElement(btn, style) {
    if (!btn) return;
    const normalized = normalizeStartMenuButtonStyleClient(style);
    const orbFrame = btn.querySelector('.taskbar-start-button-orb-frame');
    const logo = btn.querySelector('.taskbar-start-button-logo');
    btn.classList.remove('luna', 'orb');
    if (normalized === 'luna') {
        btn.classList.add('luna');
    } else if (normalized === 'orb') {
        btn.classList.add('orb');
    }
    const isOrb = normalized === 'orb';
    if (orbFrame) {
        orbFrame.classList.toggle('hidden', !isOrb);
    }
    if (logo) {
        logo.classList.toggle('hidden', isOrb);
    }
}

function syncStartMenuButtonTextElement(textEl, preset, customText) {
    if (!textEl) return;
    const displayText = resolveStartMenuButtonDisplayText(preset, customText);
    textEl.textContent = displayText;
    return displayText;
}

function applyStartMenuButtonAppearanceToTaskbar(preset, customText, style) {
    const btn = document.getElementById('taskbarStartBtn');
    const textEl = btn ? btn.querySelector('.taskbar-start-button-text') : null;
    if (textEl) {
        const displayText = syncStartMenuButtonTextElement(textEl, preset, customText);
        if (btn) {
            btn.title = displayText;
        }
    }
    applyStartMenuButtonStyleToElement(btn, style);
}

function resolveWorkspaceWallpaperUrl(wallpaperPath) {
    if (!wallpaperPath || typeof wallpaperPath !== 'string') {
        return null;
    }
    const [type, ...idParts] = wallpaperPath.split(':');
    const id = idParts.join(':');
    switch (type) {
        case 'file':
            return `/images/${id}`;
        case 'cache':
            return `/cache/upload/${id}`;
        case 'cache-preview':
            return `/cache/preview/${id}`;
        case 'vibe':
            return `/cache/vibe/${id}`;
        case 'wallpaper':
            return `/cache/wallpapers/${id}.png`;
        case 'url':
            return id;
        default:
            return null;
    }
}

function getStartMenuButtonPreviewWallpaperStyle() {
    const wallpaperEl = document.getElementById('desktopWallpaper');
    if (wallpaperEl) {
        const computed = getComputedStyle(wallpaperEl);
        if (computed.backgroundImage && computed.backgroundImage !== 'none') {
            return {
                backgroundImage: computed.backgroundImage,
                backgroundPosition: computed.backgroundPosition || 'center center',
                backgroundSize: computed.backgroundSize || 'cover',
                backgroundColor: computed.backgroundColor || '#0a1a2a'
            };
        }
    }

    const bodyStyle = getComputedStyle(document.body);
    let backgroundImage = bodyStyle.getPropertyValue('--desktop-wallpaper').trim();
    let backgroundPosition = bodyStyle.getPropertyValue('--desktop-wallpaper-position').trim() || 'center center';
    const backgroundColor = bodyStyle.getPropertyValue('--workspace-background-color').trim() || '#0a1a2a';

    if ((!backgroundImage || backgroundImage === 'none') && typeof workspaces === 'object' && workspaces) {
        const workspaceId = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null)
            || document.body.getAttribute('data-workspace')
            || 'default';
        const workspace = workspaces[workspaceId];
        const wallpaperUrl = workspace && resolveWorkspaceWallpaperUrl(workspace.wallpaper);
        if (wallpaperUrl) {
            backgroundImage = `url("${wallpaperUrl}")`;
            backgroundPosition = workspace.wallpaperPosition || 'center';
        }
    }

    return {
        backgroundImage: backgroundImage || 'none',
        backgroundPosition,
        backgroundSize: 'cover',
        backgroundColor
    };
}

function getDesktopSettingsStartMenuPreviewDisplayText() {
    const pref = readDesktopSettingsStartMenuButtonPreference();
    return resolveStartMenuButtonDisplayText(pref.preset, pref.customText);
}

function updateDesktopSettingsStartMenuTextPreview() {
    const wallpaper = document.getElementById('desktopSettingsStartMenuPreviewWallpaper');
    const previewText = document.getElementById('desktopSettingsStartMenuPreviewText');
    const previewBtn = document.getElementById('desktopSettingsStartMenuPreviewBtn');
    const pref = readDesktopSettingsStartMenuButtonPreference();
    if (wallpaper) {
        const wallpaperStyle = getStartMenuButtonPreviewWallpaperStyle();
        wallpaper.style.backgroundImage = wallpaperStyle.backgroundImage;
        wallpaper.style.backgroundPosition = wallpaperStyle.backgroundPosition;
        wallpaper.style.backgroundSize = wallpaperStyle.backgroundSize || 'cover';
        wallpaper.style.backgroundColor = wallpaperStyle.backgroundColor;
    }
    if (previewText) {
        syncStartMenuButtonTextElement(previewText, pref.preset, pref.customText);
    }
    applyStartMenuButtonStyleToElement(previewBtn, pref.style);
}

function syncDesktopSettingsStartMenuCustomTextVisibility() {
    const group = document.getElementById('desktopSettingsStartMenuCustomTextGroup');
    const input = document.getElementById('desktopSettingsStartMenuCustomTextInput');
    const pref = readDesktopSettingsStartMenuButtonPreference();
    const isCustom = pref.preset === 'custom';
    if (group) {
        group.classList.toggle('hidden', !isCustom);
    }
    if (input && document.activeElement !== input) {
        input.value = pref.customText || '';
    }
}

function syncDesktopSettingsStartMenuTextUI() {
    const selectedEl = document.getElementById('desktopSettingsStartMenuTextSelected');
    const hidden = document.getElementById('desktopSettingsStartMenuTextHidden');
    const pref = readDesktopSettingsStartMenuButtonPreference();
    if (selectedEl) {
        selectedEl.textContent = getStartMenuButtonPresetLabel(pref.preset, pref.customText);
    }
    if (hidden) {
        hidden.value = pref.preset;
    }
    syncDesktopSettingsStartMenuCustomTextVisibility();
    syncDesktopSettingsStartMenuStyleUI();
    updateDesktopSettingsStartMenuTextPreview();
}

function syncDesktopSettingsStartMenuStyleUI() {
    const toggle = document.getElementById('desktopSettingsStartMenuStyleToggle');
    const pref = readDesktopSettingsStartMenuButtonPreference();
    if (!toggle) return;
    toggle.setAttribute('data-active', pref.style);
    toggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
        btn.classList.toggle('active', btn.dataset.style === pref.style);
    });
}

function setupDesktopSettingsStartMenuStyleToggle() {
    if (desktopSettingsStartMenuStyleWired) {
        return;
    }

    const toggle = document.getElementById('desktopSettingsStartMenuStyleToggle');
    if (!toggle) return;

    toggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const style = btn.dataset.style;
            if (!style) return;
            desktopSettingsGlobalState.startMenuButtonStyle = normalizeStartMenuButtonStyleClient(style);
            syncDesktopSettingsStartMenuStyleUI();
            updateDesktopSettingsStartMenuTextPreview();
        });
    });

    desktopSettingsStartMenuStyleWired = true;
}

function setupDesktopSettingsStartMenuTextDropdown() {
    if (desktopSettingsStartMenuTextWired) {
        return;
    }

    const container = document.getElementById('desktopSettingsStartMenuTextDropdown');
    const btn = document.getElementById('desktopSettingsStartMenuTextBtn');
    const menu = document.getElementById('desktopSettingsStartMenuTextMenu');
    const selectedEl = document.getElementById('desktopSettingsStartMenuTextSelected');
    const hidden = document.getElementById('desktopSettingsStartMenuTextHidden');
    const customInput = document.getElementById('desktopSettingsStartMenuCustomTextInput');
    if (!container || !btn || !menu || !selectedEl || !hidden) return;

    const groups = getStartMenuButtonPresetGroups();

    const applyPresetSelection = (preset, customText) => {
        const normalized = normalizeStartMenuButtonPresetClient(preset);
        desktopSettingsGlobalState.startMenuButtonPreset = normalized;
        desktopSettingsGlobalState.startMenuButtonCustomText = typeof customText === 'string'
            ? customText.trim().slice(0, 24)
            : '';
        hidden.value = normalized;
        selectedEl.textContent = getStartMenuButtonPresetLabel(
            normalized,
            desktopSettingsGlobalState.startMenuButtonCustomText
        );
        syncDesktopSettingsStartMenuCustomTextVisibility();
        updateDesktopSettingsStartMenuTextPreview();
    };

    const renderMenu = (selectedVal) => {
        // renderGroupedDropdown, closeDropdown: public/scripts/comp/dropdown.js
        renderGroupedDropdown(
            menu,
            groups,
            (value) => {
                if (value === 'custom') {
                    applyPresetSelection('custom', desktopSettingsGlobalState.startMenuButtonCustomText || '');
                    if (customInput) {
                        customInput.focus();
                        customInput.select();
                    }
                    return;
                }
                applyPresetSelection(value, '');
            },
            () => closeDropdown(menu, btn),
            selectedVal,
            (opt) => opt.label
        );
    };

    // setupDropdown: public/scripts/comp/dropdown.js
    setupDropdown(
        container,
        btn,
        menu,
        renderMenu,
        () => readDesktopSettingsStartMenuButtonPreference().preset,
        { preventFocusTransfer: true }
    );

    if (customInput) {
        customInput.addEventListener('input', () => {
            desktopSettingsGlobalState.startMenuButtonCustomText = customInput.value.slice(0, 24);
            selectedEl.textContent = getStartMenuButtonPresetLabel(
                'custom',
                desktopSettingsGlobalState.startMenuButtonCustomText
            );
            updateDesktopSettingsStartMenuTextPreview();
        });
    }

    desktopSettingsStartMenuTextWired = true;
}

let desktopSettingsActiveScope = 'workspace';
let desktopSettingsScopeHandlersWired = false;
let desktopSettingsDropdownsWired = false;
let desktopSettingsStartMenuTextWired = false;
let desktopSettingsStartMenuStyleWired = false;
let desktopSettingsModalScopeWired = false;
let desktopSettingsPersistedStartMenuButton = { preset: 'start-ja', customText: '', style: 'workspace' };

// Alignment options for dropdowns
const ALIGNMENT_OPTIONS = {
    horizontal: [
        { value: 'left', label: 'Left' },
        { value: 'center', label: 'Center' },
        { value: 'right', label: 'Right' },
        { value: 'custom', label: 'Manual' }
    ],
    vertical: [
        { value: 'top', label: 'Top' },
        { value: 'center', label: 'Center' },
        { value: 'bottom', label: 'Bottom' },
        { value: 'custom', label: 'Manual' }
    ]
};

function setupDesktopContextMenu() {
    const desktopIcons = document.getElementById('desktopIcons');
    const freeformContainer = document.getElementById('desktopFreeformContainer');
    if ((!desktopIcons && !freeformContainer) || !contextMenu) return;

    const desktopContextMenuConfig = {
        beforeShow: () => {
            if (explorerApplet) explorerApplet._contextMenuTarget = null;
        },
        sections: [
            {
                type: 'list',
                items: [
                    {
                        icon: 'fa-light fa-folder-plus',
                        text: 'New Folder',
                        action: 'desktop-new-folder'
                    },
                    {
                        icon: 'fas fa-paste',
                        text: 'Paste',
                        action: 'desktop-paste',
                        hidden: () => {
                            if (localStorage.getItem('userType') === 'readonly') return true;
                            const explorer = typeof initializeExplorerApplet === 'function'
                                ? initializeExplorerApplet()
                                : explorerApplet;
                            return !(explorer && explorer.clipboard);
                        }
                    },
                    {
                        icon: 'fa-light fa-paint-roller',
                        text: 'Personalize',
                        action: 'open-desktop-settings'
                    },
                    {
                        icon: 'fa-light fa-info-circle',
                        text: 'About Melaton',
                        action: 'open-about-melatonin'
                    }
                ]
            },
            {
                type: 'icons',
                icons: [
                    {
                        icon: 'fa-light fa-droplet',
                        tooltip: 'Liquid Glass',
                        action: 'toggle-glass',
                        keepMenuOpen: true,
                        showIndicator: true,
                        loadfn: (icon, target) => {
                            const isOn = document.documentElement.classList.contains('disable-blur');
                            icon.dataState = !isOn ? 'on' : 'off';
                        }
                    },
                    {
                        icon: 'fa-light fa-blinds',
                        tooltip: 'Focus Cover',
                        action: 'toggle-privacy-mode',
                        keepMenuOpen: true,
                        showIndicator: true,
                        loadfn: (icon, target) => {
                            icon.dataState = focusCoverEnabled ? 'on' : 'off';
                        }
                    },
                    {
                        icon: 'fa-light fa-sync',
                        tooltip: 'Update',
                        action: 'refresh-cache'
                    },
                    {
                        icon: 'fa-light fa-laptop-arrow-down',
                        tooltip: 'Reinstall',
                        action: 'clear-cache'
                    }
                ]
            }
        ]
    };

    // Attach context menu to desktop (empty space on grid or freeform)
    if (desktopIcons) {
        contextMenu.attachToElement(desktopIcons, desktopContextMenuConfig);
    } else if (freeformContainer) {
        contextMenu.attachToElement(freeformContainer, desktopContextMenuConfig);
    }
}

function getDesktopSettingsActiveScope() {
    return desktopSettingsActiveScope === 'global' ? 'global' : 'workspace';
}

function setDesktopSettingsScope(scope) {
    const nextScope = scope === 'global' ? 'global' : 'workspace';
    desktopSettingsActiveScope = nextScope;

    const modal = document.getElementById('desktopSettingsModal');
    if (!modal) return;

    const toggle = document.getElementById('desktopSettingsScopeToggle');
    if (toggle) {
        toggle.setAttribute('data-active', nextScope);
        toggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
            btn.classList.toggle('active', btn.dataset.scope === nextScope);
        });
    }

    modal.querySelectorAll('[data-desktop-settings-scope]').forEach((section) => {
        if (section.id === 'desktopSettingsNotificationBridgeSection') {
            const bridgeVisible = typeof isAndroidNotificationBridgeDetected === 'function'
                && isAndroidNotificationBridgeDetected();
            section.classList.toggle('hidden', nextScope !== 'global' || !bridgeVisible);
            return;
        }
        section.classList.toggle('hidden', section.dataset.desktopSettingsScope !== nextScope);
    });
}

function readDesktopSettingsAutoLaunchPreference() {
    // shouldAutoLaunchWorkspace — public/scripts/comp/galleryView.js
    if (typeof shouldAutoLaunchWorkspace === 'function') {
        return shouldAutoLaunchWorkspace();
    }
    try {
        return localStorage.getItem('dontAutoLaunchWorkspace') !== 'true';
    } catch (e) {
        return true;
    }
}

function updateDesktopSettingsGlobalToggleUI(btn, on) {
    if (!btn) return;
    btn.dataset.state = on ? 'on' : 'off';
}

function updateDesktopSettingsAutoLaunchToggleUI(autoLaunch) {
    const btn = document.getElementById('desktopSettingsAutoLaunchWorkspaceBtn');
    if (!btn) return;
    updateDesktopSettingsGlobalToggleUI(btn, autoLaunch !== false);
}

function readDesktopSettingsLiveWindowRepositioningPreference() {
    try {
        return localStorage.getItem('liveWindowRepositioning') === 'true';
    } catch (e) {
        return false;
    }
}

function readDesktopSettingsExitDesktopOnWorkspaceMaximisePreference() {
    try {
        return localStorage.getItem('exitDesktopOnWorkspaceMaximise') === 'true';
    } catch (e) {
        return false;
    }
}

function readDesktopSettingsVirtualKeyboardPreference() {
    try {
        return localStorage.getItem('virtualKeyboardEnabled') === 'true';
    } catch (e) {
        return false;
    }
}

function updateDesktopSettingsVirtualKeyboardToggleUI(enabled) {
    const btn = document.getElementById('desktopSettingsVirtualKeyboardBtn');
    if (!btn) return;
    updateDesktopSettingsGlobalToggleUI(btn, enabled === true);
}

function readDesktopSettingsNotificationBridgeEnabledPreference() {
    // readNotificationBridgeEnabledPreference — public/scripts/comp/toastManager.js
    if (typeof readNotificationBridgeEnabledPreference === 'function') {
        return readNotificationBridgeEnabledPreference();
    }
    return true;
}

function readDesktopSettingsBypassNotificationBridgeDesktopPreference() {
    // readBypassNotificationBridgeInDesktopPreference — public/scripts/comp/toastManager.js
    if (typeof readBypassNotificationBridgeInDesktopPreference === 'function') {
        return readBypassNotificationBridgeInDesktopPreference();
    }
    return false;
}

function updateDesktopSettingsNotificationBridgeEnabledToggleUI(enabled) {
    const btn = document.getElementById('desktopSettingsNotificationBridgeEnabledBtn');
    if (!btn) return;
    updateDesktopSettingsGlobalToggleUI(btn, enabled !== false);
}

function updateDesktopSettingsBypassNotificationBridgeDesktopToggleUI(bypass) {
    const btn = document.getElementById('desktopSettingsBypassNotificationBridgeDesktopBtn');
    if (!btn) return;
    updateDesktopSettingsGlobalToggleUI(btn, bypass === true);
}

function syncDesktopSettingsNotificationBridgeToggleUI() {
    updateDesktopSettingsNotificationBridgeEnabledToggleUI(desktopSettingsGlobalState.notificationBridgeEnabled);
    updateDesktopSettingsBypassNotificationBridgeDesktopToggleUI(
        desktopSettingsGlobalState.bypassNotificationBridgeInDesktopMode
    );
}

function shouldExitDesktopOnWorkspaceMaximise() {
    return desktopSettingsGlobalState.exitDesktopOnWorkspaceMaximise === true;
}

function updateDesktopSettingsExitDesktopOnWorkspaceMaximiseToggleUI(enabled) {
    const btn = document.getElementById('desktopSettingsExitDesktopOnWorkspaceMaximiseBtn');
    if (!btn) return;
    updateDesktopSettingsGlobalToggleUI(btn, enabled === true);
}

function updateGalleryMaximizeButtonIcon() {
    if (!galleryWindow) return;
    const btn = document.getElementById('maximizeGalleryBtn');
    if (!btn) return;
    const icon = btn.querySelector('i');
    if (!icon) return;
    const workAreaMax = galleryWindow.classList.contains('windowed')
        && !shouldExitDesktopOnWorkspaceMaximise()
        && isModalMaximized(galleryWindow);
    const fullscreenMax = !galleryWindow.classList.contains('windowed');
    if (workAreaMax || fullscreenMax) {
        icon.className = 'fa-regular fa-window-restore';
        btn.title = 'Restore window';
    } else {
        icon.className = 'fa-regular fa-window-maximize';
        btn.title = 'Maximize';
    }
}

function updateDesktopSettingsLiveWindowRepositioningToggleUI(previewModeEnabled) {
    const btn = document.getElementById('desktopSettingsLiveWindowRepositioningBtn');
    if (!btn) return;
    // Stored value is preview mode; toggle ON means live repositioning (direct drag).
    updateDesktopSettingsGlobalToggleUI(btn, previewModeEnabled !== true);
}

function setLiveWindowRepositioningEnabled(enabled) {
    document.documentElement.classList.toggle('live-window-repositioning-enabled', enabled === true);
}

function getWindowFrameElement() {
    let frame = document.getElementById('modalDragResizeFrame');
    if (frame) {
        return frame;
    }
    frame = document.createElement('div');
    frame.id = 'modalDragResizeFrame';
    frame.className = 'modal-drag-resize-frame hidden';
    document.body.appendChild(frame);
    return frame;
}

function updateWindowFrameRect(rect) {
    const frame = getWindowFrameElement();
    frame.style.left = `${roundCssPixel(rect.left)}px`;
    frame.style.top = `${roundCssPixel(rect.top)}px`;
    frame.style.width = `${Math.max(1, roundCssPixel(rect.width))}px`;
    frame.style.height = `${Math.max(1, roundCssPixel(rect.height))}px`;
}

function showWindowFrameForModal(modal) {
    if (!modal) return;
    const rect = modal.getBoundingClientRect();
    updateWindowFrameRect(rect);
    getWindowFrameElement().classList.remove('hidden');
}

function hideWindowFrame() {
    const frame = document.getElementById('modalDragResizeFrame');
    if (frame) {
        frame.classList.add('hidden');
    }
}

function isLiveWindowRepositioningEnabled() {
    return desktopSettingsGlobalState.liveWindowRepositioning === true;
}

function setupDesktopSettingsScopeToggle() {
    if (desktopSettingsScopeHandlersWired) {
        return;
    }

    const toggle = document.getElementById('desktopSettingsScopeToggle');
    if (!toggle) return;

    toggle.querySelectorAll('.gallery-toggle-btn').forEach((btn) => {
        btn.addEventListener('click', (e) => {
            e.preventDefault();
            const scope = btn.dataset.scope;
            if (scope) {
                setDesktopSettingsScope(scope);
            }
        });
    });

    const autoLaunchBtn = document.getElementById('desktopSettingsAutoLaunchWorkspaceBtn');
    if (autoLaunchBtn) {
        autoLaunchBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const nextOn = autoLaunchBtn.dataset.state !== 'on';
            desktopSettingsGlobalState.autoLaunchWorkspace = nextOn;
            updateDesktopSettingsAutoLaunchToggleUI(nextOn);
        });
    }

    const liveWindowRepositioningBtn = document.getElementById('desktopSettingsLiveWindowRepositioningBtn');
    if (liveWindowRepositioningBtn) {
        liveWindowRepositioningBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const nextLiveOn = liveWindowRepositioningBtn.dataset.state !== 'on';
            desktopSettingsGlobalState.liveWindowRepositioning = !nextLiveOn;
            updateDesktopSettingsLiveWindowRepositioningToggleUI(desktopSettingsGlobalState.liveWindowRepositioning);
        });
    }

    const exitDesktopOnWorkspaceMaximiseBtn = document.getElementById('desktopSettingsExitDesktopOnWorkspaceMaximiseBtn');
    if (exitDesktopOnWorkspaceMaximiseBtn) {
        exitDesktopOnWorkspaceMaximiseBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const nextOn = exitDesktopOnWorkspaceMaximiseBtn.dataset.state !== 'on';
            desktopSettingsGlobalState.exitDesktopOnWorkspaceMaximise = nextOn;
            updateDesktopSettingsExitDesktopOnWorkspaceMaximiseToggleUI(nextOn);
        });
    }

    const virtualKeyboardBtn = document.getElementById('desktopSettingsVirtualKeyboardBtn');
    if (virtualKeyboardBtn) {
        virtualKeyboardBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const nextOn = virtualKeyboardBtn.dataset.state !== 'on';
            desktopSettingsGlobalState.virtualKeyboardEnabled = nextOn;
            updateDesktopSettingsVirtualKeyboardToggleUI(nextOn);
            try {
                localStorage.setItem('virtualKeyboardEnabled', nextOn ? 'true' : 'false');
            } catch (err) {
                /* */
            }
            // setVirtualKeyboardEnabled: public/scripts/comp/virtualKeyboard.js
            if (typeof setVirtualKeyboardEnabled === 'function') {
                setVirtualKeyboardEnabled(nextOn);
            }
        });
    }

    const notificationBridgeEnabledBtn = document.getElementById('desktopSettingsNotificationBridgeEnabledBtn');
    if (notificationBridgeEnabledBtn) {
        notificationBridgeEnabledBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const nextOn = notificationBridgeEnabledBtn.dataset.state !== 'on';
            desktopSettingsGlobalState.notificationBridgeEnabled = nextOn;
            updateDesktopSettingsNotificationBridgeEnabledToggleUI(nextOn);
        });
    }

    const bypassNotificationBridgeDesktopBtn = document.getElementById('desktopSettingsBypassNotificationBridgeDesktopBtn');
    if (bypassNotificationBridgeDesktopBtn) {
        bypassNotificationBridgeDesktopBtn.addEventListener('click', (e) => {
            e.preventDefault();
            const nextOn = bypassNotificationBridgeDesktopBtn.dataset.state !== 'on';
            desktopSettingsGlobalState.bypassNotificationBridgeInDesktopMode = nextOn;
            updateDesktopSettingsBypassNotificationBridgeDesktopToggleUI(nextOn);
        });
    }

    desktopSettingsScopeHandlersWired = true;
}

// Open Desktop Settings Modal with optional wallpaper path (format: "type:id")
async function openDesktopSettingsModal(wallpaperPath = null) {
    const modal = document.getElementById('desktopSettingsModal');
    if (!modal) {
        console.error('Desktop settings modal not found');
        return;
    }

    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';
    const workspace = workspaces[currentWorkspace];

    // Copy workspace settings to temp state
    if (workspace) {
        desktopSettingsState.name = workspace.name || '';
        desktopSettingsState.color = workspace.color || '#102040';
        desktopSettingsState.backgroundColor = workspace.backgroundColor || '#0a1a2a';
        desktopSettingsState.primaryFont = workspace.primaryFont || null;
        desktopSettingsState.textareaFont = workspace.textareaFont || null;
    }

    // Populate form from temp state
    const nameInput = document.getElementById('desktopSettingsWorkspaceName');
    const colorInput = document.getElementById('desktopSettingsWorkspaceColor');
    const bgColorInput = document.getElementById('desktopSettingsWorkspaceBackground');

    if (nameInput) nameInput.value = desktopSettingsState.name;
    if (colorInput) colorInput.value = desktopSettingsState.color;
    if (bgColorInput) bgColorInput.value = desktopSettingsState.backgroundColor;

    // Set font dropdown labels from temp state
    const primaryFontSelected = document.getElementById('desktopSettingsPrimaryFontSelected');
    const textareaFontSelected = document.getElementById('desktopSettingsTextareaFontSelected');
    if (primaryFontSelected) {
        if (typeof AVAILABLE_PRIMARY_FONTS !== 'undefined') {
            const font = AVAILABLE_PRIMARY_FONTS.find(f => f.value === desktopSettingsState.primaryFont) || AVAILABLE_PRIMARY_FONTS[0];
            primaryFontSelected.textContent = font.label;
            primaryFontSelected.style.fontFamily = font.value ? `'${font.value}', sans-serif` : (font.fontFamily || 'var(--font-primary)');
        } else {
            primaryFontSelected.textContent = desktopSettingsState.primaryFont || 'Default';
        }
    }
    if (textareaFontSelected) {
        if (typeof AVAILABLE_TEXTAREA_FONTS !== 'undefined') {
            const font = AVAILABLE_TEXTAREA_FONTS.find(f => f.value === desktopSettingsState.textareaFont) || AVAILABLE_TEXTAREA_FONTS[0];
            textareaFontSelected.textContent = font.label;
            textareaFontSelected.style.fontFamily = font.value ? `'${font.value}', monospace` : (font.fontFamily || 'var(--font-mono)');
        } else {
            textareaFontSelected.textContent = desktopSettingsState.textareaFont || 'Default';
        }
    }

    // Initialize state
    let pathToUse = wallpaperPath;
    if (!pathToUse && workspace && workspace.wallpaper) {
        // Editing existing wallpaper
        pathToUse = workspace.wallpaper;
    }

    // Convert path to URL
    if (pathToUse) {
        const [type, ...idParts] = pathToUse.split(':');
        const id = idParts.join(':'); // Rejoin in case the ID contains colons (e.g., URLs)
        switch (type) {
            case 'file':
                desktopSettingsState.wallpaperUrl = `/images/${id}`;
                break;
            case 'cache':
                desktopSettingsState.wallpaperUrl = `/cache/upload/${id}`;
                break;
            case 'cache-preview':
                desktopSettingsState.wallpaperUrl = `/cache/preview/${id}`;
                break;
            case 'vibe':
                desktopSettingsState.wallpaperUrl = `/cache/vibe/${id}`;
                break;
            case 'wallpaper':
                desktopSettingsState.wallpaperUrl = `/cache/wallpapers/${id}.png`;
                break;
            case 'url':
                desktopSettingsState.wallpaperUrl = id; // Use the custom URL directly
                break;
            default:
                desktopSettingsState.wallpaperUrl = null;
        }
    } else {
        // No wallpaper set
        desktopSettingsState.wallpaperUrl = null;
    }

    // Parse existing position
    if (workspace.wallpaperPosition) {
        const position = workspace.wallpaperPosition || 'center center';
        parseWallpaperPosition(position);
    } else {
        // Default position
        desktopSettingsState.horizontalAlign = 'center';
        desktopSettingsState.verticalAlign = 'center';
        desktopSettingsState.customHorizontal = 50;
        desktopSettingsState.customVertical = 50;
    }

    desktopSettingsGlobalState.autoLaunchWorkspace = readDesktopSettingsAutoLaunchPreference();
    updateDesktopSettingsAutoLaunchToggleUI(desktopSettingsGlobalState.autoLaunchWorkspace);
    desktopSettingsGlobalState.liveWindowRepositioning = readDesktopSettingsLiveWindowRepositioningPreference();
    updateDesktopSettingsLiveWindowRepositioningToggleUI(desktopSettingsGlobalState.liveWindowRepositioning);
    setLiveWindowRepositioningEnabled(desktopSettingsGlobalState.liveWindowRepositioning);
    desktopSettingsGlobalState.exitDesktopOnWorkspaceMaximise = readDesktopSettingsExitDesktopOnWorkspaceMaximisePreference();
    updateDesktopSettingsExitDesktopOnWorkspaceMaximiseToggleUI(desktopSettingsGlobalState.exitDesktopOnWorkspaceMaximise);
    desktopSettingsGlobalState.virtualKeyboardEnabled = readDesktopSettingsVirtualKeyboardPreference();
    updateDesktopSettingsVirtualKeyboardToggleUI(desktopSettingsGlobalState.virtualKeyboardEnabled);
    if (typeof isAndroidNotificationBridgeDetected === 'function' && isAndroidNotificationBridgeDetected()) {
        desktopSettingsGlobalState.notificationBridgeEnabled = readDesktopSettingsNotificationBridgeEnabledPreference();
        desktopSettingsGlobalState.bypassNotificationBridgeInDesktopMode =
            readDesktopSettingsBypassNotificationBridgeDesktopPreference();
        syncDesktopSettingsNotificationBridgeToggleUI();
    }
    const startMenuPref = readDesktopSettingsStartMenuButtonPreference();
    desktopSettingsPersistedStartMenuButton = {
        preset: startMenuPref.preset,
        customText: startMenuPref.customText,
        style: startMenuPref.style
    };
    desktopSettingsGlobalState.startMenuButtonPreset = startMenuPref.preset;
    desktopSettingsGlobalState.startMenuButtonCustomText = startMenuPref.customText;
    desktopSettingsGlobalState.startMenuButtonStyle = startMenuPref.style;
    syncDesktopSettingsStartMenuTextUI();
    setDesktopSettingsScope('workspace');

    // Initialize dropdowns and button handlers
    initializeDesktopSettingsModal();

    // Update preview
    updateDesktopSettingsPreview();

    // Open the modal
    openModal(modal);
}

// Parse wallpaper position string into state
function parseWallpaperPosition(position) {
    const parts = position.split(' ');
    const horizontal = parts[0] || 'center';
    const vertical = parts[1] || 'center';

    // Check if horizontal is a percentage
    if (horizontal.endsWith('%')) {
        desktopSettingsState.horizontalAlign = 'custom';
        desktopSettingsState.customHorizontal = parseInt(horizontal);
    } else {
        desktopSettingsState.horizontalAlign = horizontal;
    }

    // Check if vertical is a percentage
    if (vertical.endsWith('%')) {
        desktopSettingsState.verticalAlign = 'custom';
        desktopSettingsState.customVertical = parseInt(vertical);
    } else {
        desktopSettingsState.verticalAlign = vertical;
    }
}

// Get CSS background-position value from current state
function getBackgroundPositionValue() {
    const horizontal = desktopSettingsState.horizontalAlign === 'custom'
        ? `${desktopSettingsState.customHorizontal}%`
        : desktopSettingsState.horizontalAlign;

    const vertical = desktopSettingsState.verticalAlign === 'custom'
        ? `${desktopSettingsState.customVertical}%`
        : desktopSettingsState.verticalAlign;

    return `${horizontal} ${vertical}`;
}

// Update the preview
function updateDesktopSettingsPreview() {
    const preview = document.getElementById('desktopSettingsPreview');
    if (!preview) {
        console.warn('Desktop settings preview element not found');
        return;
    }

    const position = getBackgroundPositionValue();

    if (desktopSettingsState.wallpaperUrl) {
        preview.style.backgroundImage = `url('${desktopSettingsState.wallpaperUrl}')`;
        preview.style.backgroundPosition = position;
    } else {
        preview.style.backgroundImage = 'none';
        preview.style.backgroundPosition = 'center center';
    }
}

// Initialize modal (dropdowns and button handlers)
function wireDesktopSettingsModalListenerScope() {
    if (desktopSettingsModalScopeWired) return;
    const modal = document.getElementById('desktopSettingsModal');
    if (!modal) return;
    desktopSettingsModalScopeWired = true;
    // attachModalListeners, closeAllDropdownsInRoot — modalListenerScope.js, dropdown.js
    attachModalListeners(modal, (signal) => {
        signal.addEventListener('abort', () => {
            closeAllDropdownsInRoot(modal);
        }, { once: true });
    });
}

function handleDesktopSettingsModalKeydown(e) {
    const modal = document.getElementById('desktopSettingsModal');
    if (!modal || modal.classList.contains('hidden')) return;

    if ((e.ctrlKey || e.metaKey) && (e.key === 's' || e.key === 'S')) {
        e.preventDefault();
        e.stopPropagation();
        saveDesktopSettings();
        return true;
    }
}

let desktopSettingsKeyboardWired = false;

function wireDesktopSettingsKeyboard() {
    if (desktopSettingsKeyboardWired) return;
    desktopSettingsKeyboardWired = true;
    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'desktopSettingsModal.keydown',
        handler: handleDesktopSettingsModalKeydown,
        type: 'whenFocused',
        modalId: 'desktopSettingsModal',
        priority: 78,
        critical: true,
        showInOverlay: false
    });
    registerModalOverlayEntries('desktopSettingsModal', 'Settings', [
        { id: 'overlay.desktopSettings.save', label: 'Save settings', keys: 'Ctrl+S', icon: 'fas fa-save' },
        { id: 'overlay.desktopSettings.close', label: 'Close', keys: 'Alt+Q', icon: 'fas fa-times' }
    ]);
}

function initializeDesktopSettingsModal() {
    wireDesktopSettingsModalListenerScope();
    wireDesktopSettingsKeyboard();
    setupDesktopSettingsScopeToggle();

    // Setup dropdowns
    setupDesktopSettingsDropdowns();
    setupDesktopSettingsStartMenuTextDropdown();
    setupDesktopSettingsStartMenuStyleToggle();

    // Setup button handlers
    setupDesktopSettingsButtonHandlers();
}

// Initialize dropdowns
function setupDesktopSettingsDropdowns() {
    if (desktopSettingsDropdownsWired) {
        return;
    }

    // Horizontal dropdown
    const horizDropdown = document.getElementById('desktopSettingsHorizontalDropdown');
    const horizBtn = document.getElementById('desktopSettingsHorizontalBtn');
    const horizMenu = document.getElementById('desktopSettingsHorizontalMenu');
    const horizSlider = document.getElementById('desktopSettingsHorizontalSlider');
    const horizValue = document.getElementById('desktopSettingsHorizontalValue');

    if (horizDropdown && horizBtn && horizMenu) {
        setupDropdown(
            horizDropdown,
            horizBtn,
            horizMenu,
            (selectedValue) => renderAlignmentDropdown(horizMenu, 'horizontal', selectedValue),
            () => desktopSettingsState.horizontalAlign
        );
    }

    // Vertical dropdown
    const vertDropdown = document.getElementById('desktopSettingsVerticalDropdown');
    const vertBtn = document.getElementById('desktopSettingsVerticalBtn');
    const vertMenu = document.getElementById('desktopSettingsVerticalMenu');
    const vertSlider = document.getElementById('desktopSettingsVerticalSlider');
    const vertValue = document.getElementById('desktopSettingsVerticalValue');

    if (vertDropdown && vertBtn && vertMenu) {
        setupDropdown(
            vertDropdown,
            vertBtn,
            vertMenu,
            (selectedValue) => renderAlignmentDropdown(vertMenu, 'vertical', selectedValue),
            () => desktopSettingsState.verticalAlign
        );
    }

    // Horizontal slider events
    if (horizSlider) {
        horizSlider.value = desktopSettingsState.customHorizontal;
        if (horizValue) {
            horizValue.textContent = `${desktopSettingsState.customHorizontal}%`;
        }

        // Remove old listeners by cloning
        const newHorizSlider = horizSlider.cloneNode(true);
        horizSlider.parentNode.replaceChild(newHorizSlider, horizSlider);

        newHorizSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            desktopSettingsState.customHorizontal = value;
            const valueSpan = document.getElementById('desktopSettingsHorizontalValue');
            if (valueSpan) {
                valueSpan.textContent = `${value}%`;
            }
            updateDesktopSettingsPreview();
        });
    }

    // Vertical slider events
    if (vertSlider) {
        vertSlider.value = desktopSettingsState.customVertical;
        if (vertValue) {
            vertValue.textContent = `${desktopSettingsState.customVertical}%`;
        }

        // Remove old listeners by cloning
        const newVertSlider = vertSlider.cloneNode(true);
        vertSlider.parentNode.replaceChild(newVertSlider, vertSlider);

        newVertSlider.addEventListener('input', (e) => {
            const value = parseInt(e.target.value);
            desktopSettingsState.customVertical = value;
            const valueSpan = document.getElementById('desktopSettingsVerticalValue');
            if (valueSpan) {
                valueSpan.textContent = `${value}%`;
            }
            updateDesktopSettingsPreview();
        });
    }

    // Update UI based on current state
    updateAlignmentUI('horizontal');
    updateAlignmentUI('vertical');

    // Primary font dropdown
    const primaryFontContainer = document.getElementById('desktopSettingsPrimaryFontDropdown');
    const primaryFontBtn = document.getElementById('desktopSettingsPrimaryFontBtn');
    const primaryFontMenu = document.getElementById('desktopSettingsPrimaryFontMenu');
    const primaryFontSelected = document.getElementById('desktopSettingsPrimaryFontSelected');

    if (primaryFontContainer && primaryFontBtn && primaryFontMenu && primaryFontSelected) {
        const renderPrimaryFontMenu = (selectedVal = '') => {
            primaryFontMenu.innerHTML = '';

            if (typeof AVAILABLE_PRIMARY_FONTS !== 'undefined') {
                AVAILABLE_PRIMARY_FONTS.forEach(font => {
                    const option = document.createElement('div');
                    option.className = 'custom-dropdown-item';
                    option.textContent = font.label;
                    option.dataset.value = font.value;
                    option.style.fontFamily = font.value ? `'${font.value}', sans-serif` : (font.fontFamily || 'var(--font-primary)');

                    if (font.value === selectedVal) {
                        option.classList.add('selected');
                    }

                    option.addEventListener('click', () => {
                        // Update temp state, not workspace directly
                        desktopSettingsState.primaryFont = font.value || null;
                        primaryFontSelected.textContent = font.label;
                        primaryFontSelected.style.fontFamily = font.value ? `'${font.value}', sans-serif` : (font.fontFamily || 'var(--font-primary)');
                        closeDropdown(primaryFontMenu, primaryFontBtn);
                    });

                    primaryFontMenu.appendChild(option);
                });
            }
        };

        setupDropdown(
            primaryFontContainer,
            primaryFontBtn,
            primaryFontMenu,
            () => {
                // Use temp state
                const selected = desktopSettingsState.primaryFont || '';
                renderPrimaryFontMenu(selected);
            },
            () => {
                // Use temp state
                return desktopSettingsState.primaryFont || '';
            }
        );
    }

    // Textarea font dropdown
    const textareaFontContainer = document.getElementById('desktopSettingsTextareaFontDropdown');
    const textareaFontBtn = document.getElementById('desktopSettingsTextareaFontBtn');
    const textareaFontMenu = document.getElementById('desktopSettingsTextareaFontMenu');
    const textareaFontSelected = document.getElementById('desktopSettingsTextareaFontSelected');

    if (textareaFontContainer && textareaFontBtn && textareaFontMenu && textareaFontSelected) {
        const renderTextareaFontMenu = (selectedVal = '') => {
            textareaFontMenu.innerHTML = '';

            if (typeof AVAILABLE_TEXTAREA_FONTS !== 'undefined') {
                AVAILABLE_TEXTAREA_FONTS.forEach(font => {
                    const option = document.createElement('div');
                    option.className = 'custom-dropdown-item';
                    option.textContent = font.label;
                    option.dataset.value = font.value;
                    option.style.fontFamily = font.value ? `'${font.value}', monospace` : (font.fontFamily || 'var(--font-mono)');

                    if (font.value === selectedVal) {
                        option.classList.add('selected');
                    }

                    option.addEventListener('click', () => {
                        // Update temp state, not workspace directly
                        desktopSettingsState.textareaFont = font.value || null;
                        textareaFontSelected.textContent = font.label;
                        textareaFontSelected.style.fontFamily = font.value ? `'${font.value}', monospace` : (font.fontFamily || 'var(--font-mono)');
                        closeDropdown(textareaFontMenu, textareaFontBtn);
                    });

                    textareaFontMenu.appendChild(option);
                });
            }
        };

        setupDropdown(
            textareaFontContainer,
            textareaFontBtn,
            textareaFontMenu,
            () => {
                // Use temp state
                const selected = desktopSettingsState.textareaFont || '';
                renderTextareaFontMenu(selected);
            },
            () => {
                // Use temp state
                return desktopSettingsState.textareaFont || '';
            }
        );
    }

    desktopSettingsDropdownsWired = true;
}

// Render alignment dropdown options
function renderAlignmentDropdown(menu, axis, selectedValue) {
    menu.innerHTML = '';
    const options = ALIGNMENT_OPTIONS[axis];

    options.forEach(opt => {
        const option = document.createElement('div');
        option.className = 'custom-dropdown-option' + (selectedValue === opt.value ? ' selected' : '');
        option.dataset.value = opt.value;
        option.textContent = opt.label;

        option.addEventListener('click', () => {
            if (axis === 'horizontal') {
                desktopSettingsState.horizontalAlign = opt.value;
            } else {
                desktopSettingsState.verticalAlign = opt.value;
            }

            updateAlignmentUI(axis);
            updateDesktopSettingsPreview();
            closeDropdown(menu, menu.previousElementSibling);
        });

        menu.appendChild(option);
    });
}

// Update alignment UI (selected text and slider visibility)
function updateAlignmentUI(axis) {
    if (axis === 'horizontal') {
        const selectedSpan = document.getElementById('desktopSettingsHorizontalSelected');
        const sliderContainer = document.getElementById('desktopSettingsHorizontalSliderContainer');
        const value = desktopSettingsState.horizontalAlign;

        const option = ALIGNMENT_OPTIONS.horizontal.find(opt => opt.value === value);
        if (selectedSpan && option) {
            selectedSpan.textContent = option.label;
        }

        if (sliderContainer) {
            if (value === 'custom') {
                sliderContainer.classList.remove('hidden');
            } else {
                sliderContainer.classList.add('hidden');
            }
        }
    } else {
        const selectedSpan = document.getElementById('desktopSettingsVerticalSelected');
        const sliderContainer = document.getElementById('desktopSettingsVerticalSliderContainer');
        const value = desktopSettingsState.verticalAlign;

        const option = ALIGNMENT_OPTIONS.vertical.find(opt => opt.value === value);
        if (selectedSpan && option) {
            selectedSpan.textContent = option.label;
        }

        if (sliderContainer) {
            if (value === 'custom') {
                sliderContainer.classList.remove('hidden');
            } else {
                sliderContainer.classList.add('hidden');
            }
        }
    }
}

// Setup button event handlers (direct handlers, not context menu)
function setupDesktopSettingsButtonHandlers() {
    // Reset button
    const resetBtn = document.getElementById('desktopSettingsResetBtn');
    if (resetBtn) {
        // Remove existing listeners by cloning
        const newResetBtn = resetBtn.cloneNode(true);
        resetBtn.parentNode.replaceChild(newResetBtn, resetBtn);

        newResetBtn.addEventListener('click', () => {
            desktopSettingsState.horizontalAlign = 'center';
            desktopSettingsState.verticalAlign = 'center';
            desktopSettingsState.customHorizontal = 50;
            desktopSettingsState.customVertical = 50;

            // Update sliders
            const horizSlider = document.getElementById('desktopSettingsHorizontalSlider');
            const vertSlider = document.getElementById('desktopSettingsVerticalSlider');
            const horizValue = document.getElementById('desktopSettingsHorizontalValue');
            const vertValue = document.getElementById('desktopSettingsVerticalValue');

            if (horizSlider) horizSlider.value = 50;
            if (vertSlider) vertSlider.value = 50;
            if (horizValue) horizValue.textContent = '50%';
            if (vertValue) vertValue.textContent = '50%';

            updateAlignmentUI('horizontal');
            updateAlignmentUI('vertical');
            updateDesktopSettingsPreview();
        });
    }

    // Remove button
    const removeBtn = document.getElementById('desktopSettingsRemoveBtn');
    if (removeBtn) {
        // Remove existing listeners by cloning
        const newRemoveBtn = removeBtn.cloneNode(true);
        removeBtn.parentNode.replaceChild(newRemoveBtn, removeBtn);

        newRemoveBtn.addEventListener('click', async () => {
            await clearDesktopWallpaper();
            const modal = document.getElementById('desktopSettingsModal');
            closeModal(modal);
        });
    }

    // Save button
    const saveBtn = document.getElementById('desktopSettingsSaveBtn');
    if (saveBtn) {
        // Remove existing listeners by cloning
        const newSaveBtn = saveBtn.cloneNode(true);
        saveBtn.parentNode.replaceChild(newSaveBtn, saveBtn);

        newSaveBtn.addEventListener('click', async () => {
            await saveDesktopSettings();
        });
    }

    // Close button
    const closeBtn = document.getElementById('closeDesktopSettingsBtn');
    if (closeBtn) {
        // Remove existing listeners by cloning
        const newCloseBtn = closeBtn.cloneNode(true);
        closeBtn.parentNode.replaceChild(newCloseBtn, closeBtn);

        newCloseBtn.addEventListener('click', () => {
            const modal = document.getElementById('desktopSettingsModal');
            closeModal(modal);
        });
    }

    // Wallpaper upload button and file input
    const uploadBtn = document.getElementById('desktopSettingsWallpaperUploadBtn');
    const uploadInput = document.getElementById('desktopSettingsWallpaperUpload');

    if (uploadBtn && uploadInput) {
        // Remove existing listeners by cloning
        const newUploadBtn = uploadBtn.cloneNode(true);
        uploadBtn.parentNode.replaceChild(newUploadBtn, uploadBtn);

        const newUploadInput = uploadInput.cloneNode(true);
        uploadInput.parentNode.replaceChild(newUploadInput, uploadInput);

        newUploadBtn.addEventListener('click', () => {
            newUploadInput.click();
        });

        newUploadInput.addEventListener('change', async (e) => {
            const file = e.target.files[0];
            if (!file) return;

            if (!file.type.startsWith('image/')) {
                showGlassToast('error', 'Invalid File', 'Please select an image file', false, 3000, '<i class="fas fa-exclamation-triangle"></i>');
                return;
            }

            await uploadCustomWallpaper(file);
        });
    }
}

// Save desktop settings (workspace or global scope)
async function saveDesktopSettings() {
    if (getDesktopSettingsActiveScope() === 'global') {
        await saveDesktopGlobalSettings();
        return;
    }
    await saveDesktopWorkspaceSettings();
}

function normalizeNaxtElevatePinsClient(value) {
    if (value === true || value === 'true') return 1;
    const n = Number(value);
    if (n === 1 || n === 2 || n === 3) return n;
    return 0;
}

function buildUserGlobalSettingsSnapshotFromClient() {
    let elevatePins = 0;
    try {
        const raw = localStorage.getItem('naxtElevatePins');
        if (raw !== null && raw !== '') {
            elevatePins = normalizeNaxtElevatePinsClient(raw);
        } else if (localStorage.getItem('naxtElevateFavorites') === 'true') {
            elevatePins = 1;
        }
    } catch (e) {
        elevatePins = 0;
    }
    if (window.naxtApplet && typeof window.naxtApplet.elevatePins !== 'undefined') {
        elevatePins = normalizeNaxtElevatePinsClient(window.naxtApplet.elevatePins);
    }
    const startMenuButton = readDesktopSettingsStartMenuButtonPreference();
    return {
        desktop: {
            autoLaunchWorkspace: readDesktopSettingsAutoLaunchPreference(),
            liveWindowRepositioning: readDesktopSettingsLiveWindowRepositioningPreference(),
            exitDesktopOnWorkspaceMaximise: readDesktopSettingsExitDesktopOnWorkspaceMaximisePreference(),
            notificationBridgeEnabled: readDesktopSettingsNotificationBridgeEnabledPreference(),
            bypassNotificationBridgeInDesktopMode: readDesktopSettingsBypassNotificationBridgeDesktopPreference(),
            startMenuButton,
            ...(startMenuPinnedLaunchIds === null
                ? {}
                : { startMenuPinned: startMenuPinnedLaunchIds.slice() })
        },
        naxt: {
            elevatePins
        }
    };
}

function applyUserGlobalSettingsToClient(settings) {
    if (!settings || typeof settings !== 'object') {
        return;
    }

    if (settings.desktop && typeof settings.desktop === 'object') {
        const desktop = settings.desktop;
        if (typeof desktop.autoLaunchWorkspace === 'boolean') {
            desktopSettingsGlobalState.autoLaunchWorkspace = desktop.autoLaunchWorkspace;
            try {
                localStorage.setItem('dontAutoLaunchWorkspace', desktop.autoLaunchWorkspace ? 'false' : 'true');
            } catch (e) {
                /* */
            }
        }
        if (typeof desktop.liveWindowRepositioning === 'boolean') {
            desktopSettingsGlobalState.liveWindowRepositioning = desktop.liveWindowRepositioning;
            try {
                localStorage.setItem('liveWindowRepositioning', desktop.liveWindowRepositioning ? 'true' : 'false');
            } catch (e) {
                /* */
            }
            setLiveWindowRepositioningEnabled(desktop.liveWindowRepositioning);
        }
        if (typeof desktop.exitDesktopOnWorkspaceMaximise === 'boolean') {
            desktopSettingsGlobalState.exitDesktopOnWorkspaceMaximise = desktop.exitDesktopOnWorkspaceMaximise;
            try {
                localStorage.setItem('exitDesktopOnWorkspaceMaximise', desktop.exitDesktopOnWorkspaceMaximise ? 'true' : 'false');
            } catch (e) {
                /* */
            }
            updateGalleryMaximizeButtonIcon();
        }
        if (typeof desktop.notificationBridgeEnabled === 'boolean') {
            desktopSettingsGlobalState.notificationBridgeEnabled = desktop.notificationBridgeEnabled;
        }
        if (typeof desktop.bypassNotificationBridgeInDesktopMode === 'boolean') {
            desktopSettingsGlobalState.bypassNotificationBridgeInDesktopMode = desktop.bypassNotificationBridgeInDesktopMode;
        }
        if (typeof applyNotificationBridgePreferences === 'function') {
            applyNotificationBridgePreferences(
                desktopSettingsGlobalState.notificationBridgeEnabled !== false,
                desktopSettingsGlobalState.bypassNotificationBridgeInDesktopMode === true
            );
        }
        if (desktop.startMenuButton && typeof desktop.startMenuButton === 'object') {
            const preset = normalizeStartMenuButtonPresetClient(desktop.startMenuButton.preset);
            const customText = typeof desktop.startMenuButton.customText === 'string'
                ? desktop.startMenuButton.customText.trim().slice(0, 24)
                : '';
            const style = normalizeStartMenuButtonStyleClient(desktop.startMenuButton.style);
            desktopSettingsGlobalState.startMenuButtonPreset = preset;
            desktopSettingsGlobalState.startMenuButtonCustomText = customText;
            desktopSettingsGlobalState.startMenuButtonStyle = style;
            applyStartMenuButtonAppearanceToTaskbar(preset, customText, style);
        }
        if (Array.isArray(desktop.startMenuPinned)) {
            applyStartMenuPinnedLaunchIds(desktop.startMenuPinned);
            if (startMenuItems) {
                buildStartMenu();
            }
        }
    }

    if (settings.naxt && typeof settings.naxt === 'object') {
        let elevatePins = 0;
        if (typeof settings.naxt.elevatePins !== 'undefined') {
            elevatePins = normalizeNaxtElevatePinsClient(settings.naxt.elevatePins);
        } else if (settings.naxt.elevateFavorites === true) {
            elevatePins = 1;
        }
        try {
            localStorage.setItem('naxtElevatePins', String(elevatePins));
        } catch (e) {
            /* */
        }
        if (window.naxtApplet) {
            window.naxtApplet.elevatePins = elevatePins;
            if (typeof window.naxtApplet.updateElevatePinsButton === 'function') {
                window.naxtApplet.updateElevatePinsButton();
            }
        }
    }
}

async function loadUserGlobalSettingsFromServer() {
    if (!window.wsClient || !window.wsClient.isConnected()) {
        return null;
    }
    try {
        const data = await window.wsClient.sendMessage('get_user_global_settings', {}, false);
        const settings = data && data.settings;
        if (settings) {
            applyUserGlobalSettingsToClient(settings);
            window.userGlobalSettingsHydrated = true;
        }
        return settings || null;
    } catch (e) {
        console.error('get_user_global_settings', e);
        return null;
    }
}

async function persistUserGlobalSettingsPatch(patch) {
    if (!patch || typeof patch !== 'object') {
        return;
    }
    const snap = buildUserGlobalSettingsSnapshotFromClient();
    if (patch.desktop && typeof patch.desktop === 'object') {
        Object.assign(snap.desktop, patch.desktop);
    }
    if (patch.naxt && typeof patch.naxt === 'object') {
        Object.assign(snap.naxt, patch.naxt);
    }
    applyUserGlobalSettingsToClient(snap);

    if (!window.wsClient || !window.wsClient.isConnected()) {
        return;
    }
    try {
        await window.wsClient.sendMessage('update_user_global_settings', { settings: patch }, false);
        window.userGlobalSettingsHydrated = true;
    } catch (e) {
        console.error('update_user_global_settings', e);
        throw e;
    }
}

async function saveDesktopGlobalSettings() {
    const autoLaunch = desktopSettingsGlobalState.autoLaunchWorkspace !== false;
    const liveWindowRepositioning = desktopSettingsGlobalState.liveWindowRepositioning === true;
    const exitDesktopOnWorkspaceMaximise = desktopSettingsGlobalState.exitDesktopOnWorkspaceMaximise === true;
    const notificationBridgeEnabled = desktopSettingsGlobalState.notificationBridgeEnabled !== false;
    const bypassNotificationBridgeInDesktopMode =
        desktopSettingsGlobalState.bypassNotificationBridgeInDesktopMode === true;
    const previousAutoLaunch = readDesktopSettingsAutoLaunchPreference();
    const previousLiveWindowRepositioning = readDesktopSettingsLiveWindowRepositioningPreference();
    const previousExitDesktopOnWorkspaceMaximise = readDesktopSettingsExitDesktopOnWorkspaceMaximisePreference();
    const previousNotificationBridgeEnabled = readDesktopSettingsNotificationBridgeEnabledPreference();
    const previousBypassNotificationBridgeInDesktopMode =
        readDesktopSettingsBypassNotificationBridgeDesktopPreference();
    const startMenuButton = readDesktopSettingsStartMenuButtonPreference();
    const previousStartMenuButton = desktopSettingsPersistedStartMenuButton;
    const bridgeDetected = typeof isAndroidNotificationBridgeDetected === 'function'
        && isAndroidNotificationBridgeDetected();

    if (startMenuButton.preset === 'custom' && !startMenuButton.customText) {
        showGlassToast('warning', null, 'Enter custom start button text before saving', false, 3000, '<i class="fa-light fa-exclamation-triangle"></i>');
        const customInput = document.getElementById('desktopSettingsStartMenuCustomTextInput');
        if (customInput) {
            customInput.focus();
        }
        return;
    }

    if (autoLaunch === previousAutoLaunch
        && liveWindowRepositioning === previousLiveWindowRepositioning
        && exitDesktopOnWorkspaceMaximise === previousExitDesktopOnWorkspaceMaximise
        && startMenuButton.preset === previousStartMenuButton.preset
        && startMenuButton.customText === previousStartMenuButton.customText
        && startMenuButton.style === previousStartMenuButton.style
        && (!bridgeDetected
            || (notificationBridgeEnabled === previousNotificationBridgeEnabled
                && bypassNotificationBridgeInDesktopMode === previousBypassNotificationBridgeInDesktopMode))) {
        const modal = document.getElementById('desktopSettingsModal');
        closeModal(modal);
        showGlassToast('info', null, 'No changes to save', false, 2000, '<i class="fa-light fa-info-circle"></i>');
        return;
    }

    const desktopPatch = {
        autoLaunchWorkspace: autoLaunch,
        liveWindowRepositioning,
        exitDesktopOnWorkspaceMaximise,
        startMenuButton
    };
    if (bridgeDetected) {
        desktopPatch.notificationBridgeEnabled = notificationBridgeEnabled;
        desktopPatch.bypassNotificationBridgeInDesktopMode = bypassNotificationBridgeInDesktopMode;
    }

    try {
        await persistUserGlobalSettingsPatch({ desktop: desktopPatch });
        desktopSettingsPersistedStartMenuButton = {
            preset: startMenuButton.preset,
            customText: startMenuButton.customText,
            style: startMenuButton.style
        };
        applyStartMenuButtonAppearanceToTaskbar(
            startMenuButton.preset,
            startMenuButton.customText,
            startMenuButton.style
        );
        if (bridgeDetected && typeof applyNotificationBridgePreferences === 'function') {
            applyNotificationBridgePreferences(notificationBridgeEnabled, bypassNotificationBridgeInDesktopMode);
        }
    } catch (e) {
        console.error('Failed to save desktop global settings:', e);
        showGlassToast('error', 'Save Failed', 'Could not save startup settings', false, 4000, '<i class="fa-light fa-exclamation-triangle"></i>');
        return;
    }

    const modal = document.getElementById('desktopSettingsModal');
    closeModal(modal);
    showGlassToast('success', null, 'Global Settings Saved', false, 3000, '<i class="fa-light fa-check"></i>');
}

async function saveDesktopWorkspaceSettings() {
    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';
    const workspace = workspaces[currentWorkspace];

    if (!workspace) {
        console.error('Current workspace not found');
        return;
    }

    // Get workspace settings from form and temp state
    const nameInput = document.getElementById('desktopSettingsWorkspaceName');
    const colorInput = document.getElementById('desktopSettingsWorkspaceColor');
    const bgColorInput = document.getElementById('desktopSettingsWorkspaceBackground');

    const newName = nameInput ? nameInput.value.trim() : desktopSettingsState.name;
    const newColor = colorInput ? colorInput.value : desktopSettingsState.color;
    const newBgColor = bgColorInput ? bgColorInput.value : desktopSettingsState.backgroundColor;
    const newPrimaryFont = desktopSettingsState.primaryFont; // From temp state
    const newTextareaFont = desktopSettingsState.textareaFont; // From temp state

    // Get the current wallpaper path from workspace
    const currentWallpaperPath = workspace.wallpaper || null;
    const currentPosition = workspace.wallpaperPosition || 'center center';

    // Get the new wallpaper path in the correct format (type:id)
    let newWallpaperPath = null;

    // Convert URL to wallpaper path format if wallpaper is set
    if (desktopSettingsState.wallpaperUrl) {
        const url = desktopSettingsState.wallpaperUrl;
        if (url.startsWith('/cache/upload/')) {
            newWallpaperPath = `cache:${url.replace('/cache/upload/', '')}`;
        } else if (url.startsWith('/cache/preview/')) {
            newWallpaperPath = `cache-preview:${url.replace('/cache/preview/', '')}`;
        } else if (url.startsWith('/cache/vibe/')) {
            newWallpaperPath = `vibe:${url.replace('/cache/vibe/', '')}`;
        } else if (url.startsWith('/cache/wallpapers/')) {
            const workspaceId = url.replace('/cache/wallpapers/', '').replace('.png', '');
            newWallpaperPath = `wallpaper:${workspaceId}`;
        } else if (url.startsWith('/images/')) {
            newWallpaperPath = `file:${url.replace('/images/', '')}`;
        } else if (url.startsWith('http://') || url.startsWith('https://') || url.startsWith('//')) {
            // Custom URL (external or protocol-relative)
            newWallpaperPath = `url:${url}`;
        } else {
            // Unknown format, treat as custom URL
            newWallpaperPath = `url:${url}`;
        }
    }

    const newPosition = getBackgroundPositionValue();

    // Determine what changed
    const nameChanged = newName !== workspace.name;
    const colorChanged = newColor !== workspace.color;
    const bgColorChanged = newBgColor !== workspace.backgroundColor;
    const primaryFontChanged = newPrimaryFont !== (workspace.primaryFont || null);
    const textareaFontChanged = newTextareaFont !== (workspace.textareaFont || null);
    const wallpaperChanged = currentWallpaperPath !== newWallpaperPath;
    const positionChanged = currentPosition !== newPosition;

    // Only update if something changed
    if (!nameChanged && !colorChanged && !bgColorChanged && !primaryFontChanged && !textareaFontChanged && !wallpaperChanged && !positionChanged) {
        const modal = document.getElementById('desktopSettingsModal');
        closeModal(modal);
        showGlassToast('info', null, 'No changes to save', false, 2000, '<i class="fa-light fa-info-circle"></i>');
        return;
    }

    // Build settings object with only changed values
    const settings = {};

    if (nameChanged) {
        settings.name = newName;
    }
    if (colorChanged) {
        settings.color = newColor;
    }
    if (bgColorChanged) {
        settings.backgroundColor = newBgColor;
    }
    if (primaryFontChanged) {
        settings.primaryFont = newPrimaryFont;
    }
    if (textareaFontChanged) {
        settings.textareaFont = newTextareaFont;
    }

    if (wallpaperChanged) {
        settings.wallpaper = newWallpaperPath;
        // If wallpaper is being cleared, also clear position
        if (!newWallpaperPath) {
            settings.wallpaperPosition = null;
        } else if (positionChanged) {
            settings.wallpaperPosition = newPosition;
        }
    } else if (positionChanged) {
        settings.wallpaperPosition = newPosition;
    }

    // Save via WebSocket (server will broadcast workspace_updated to all clients including this one)
    try {
        if (wsClient && wsClient.isConnected()) {
            await wsClient.updateWorkspaceSettings(currentWorkspace, settings);
        }

        const modal = document.getElementById('desktopSettingsModal');
        closeModal(modal);

        // Show appropriate message based on what changed
        const changes = [];
        if (nameChanged) changes.push('name');
        if (colorChanged || bgColorChanged) changes.push('colors');
        if (primaryFontChanged || textareaFontChanged) changes.push('fonts');
        if (wallpaperChanged) changes.push('wallpaper');
        if (positionChanged) changes.push('position');

        let message = 'Settings Saved';
        if (changes.length === 1) {
            if (changes[0] === 'wallpaper' && !newWallpaperPath) {
                message = 'Wallpaper Cleared';
            } else {
                message = `${changes[0].charAt(0).toUpperCase() + changes[0].slice(1)} Updated`;
            }
        } else if (changes.length > 1) {
            message = `${changes.length} Settings Updated`;
        }

        showGlassToast('success', null, message, false, 3000, '<i class="fa-light fa-check"></i>');
    } catch (error) {
        console.error('Error saving workspace settings:', error);
        // Server will not broadcast workspace_updated on error, so workspace object remains unchanged
        // Show error message and keep modal open
        showGlassToast('error', 'Save Failed', error.message || 'Failed to save settings', false, 4000, '<i class="fa-light fa-exclamation-triangle"></i>');
    }
}


async function updateWallpaperPosition(position) {
    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';

    if (!workspaces || !workspaces[currentWorkspace]) return;

    // Update local workspace object first
    workspaces[currentWorkspace].wallpaperPosition = position;

    // Regenerate styles for immediate visual update
    generateWorkspaceStyles(currentWorkspace);

    // Save via WebSocket (server will broadcast to other clients)
    if (wsClient && wsClient.isConnected()) {
        const settings = { wallpaperPosition: position };
        await wsClient.updateWorkspaceSettings(currentWorkspace, settings);
    }
}

// Window position caching functions
function debouncedSaveWindowPositions() {
    // Coalesce with desktop icon saves when the shortcuts manager is available
    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts && typeof desktopShortcuts.debouncedSave === 'function') {
        desktopShortcuts.debouncedSave({ includeWindowPositions: true });
        return;
    }

    // Fallback before desktopShortcuts initializes
    if (windowPositionSaveTimer) {
        clearTimeout(windowPositionSaveTimer);
    }

    windowPositionSaveTimer = setTimeout(() => {
        saveWindowPositions();
        if (windowPositionSaveMaxTimer) {
            clearTimeout(windowPositionSaveMaxTimer);
            windowPositionSaveMaxTimer = null;
        }
    }, WINDOW_POSITION_SAVE_DEBOUNCE);

    if (!windowPositionSaveMaxTimer) {
        windowPositionSaveMaxTimer = setTimeout(() => {
            if (windowPositionSaveTimer) {
                clearTimeout(windowPositionSaveTimer);
                windowPositionSaveTimer = null;
            }
            saveWindowPositions();
            windowPositionSaveMaxTimer = null;
        }, WINDOW_POSITION_SAVE_MAX_WAIT);
    }
}

// Convert pixel position to quadrant position (like shortcuts use)
function pixelToQuadrantPosition(pixelX, pixelY, containerWidth, containerHeight) {
    const halfWidth = containerWidth / 2;
    const halfHeight = containerHeight / 2;

    let index, baseX, baseY, rangeX, rangeY;

    if (pixelX < halfWidth && pixelY < halfHeight) {
        // Top-left (1)
        index = 1;
        baseX = 0;
        baseY = 0;
        rangeX = halfWidth;
        rangeY = halfHeight;
    } else if (pixelX >= halfWidth && pixelY < halfHeight) {
        // Top-right (2)
        index = 2;
        baseX = halfWidth;
        baseY = 0;
        rangeX = halfWidth;
        rangeY = halfHeight;
    } else if (pixelX < halfWidth && pixelY >= halfHeight) {
        // Bottom-left (3)
        index = 3;
        baseX = 0;
        baseY = halfHeight;
        rangeX = halfWidth;
        rangeY = halfHeight;
    } else {
        // Bottom-right (4)
        index = 4;
        baseX = halfWidth;
        baseY = halfHeight;
        rangeX = halfWidth;
        rangeY = halfHeight;
    }

    // Convert to percentage within quadrant (0.0 to 1.0)
    const xPercent = Math.max(0, Math.min(1, (pixelX - baseX) / rangeX));
    const yPercent = Math.max(0, Math.min(1, (pixelY - baseY) / rangeY));

    return { index, x: xPercent, y: yPercent };
}

// Convert quadrant position to pixel position
function quadrantToPixelPosition(quadrantPos, containerWidth, containerHeight) {
    const { index, x: xPercent, y: yPercent } = quadrantPos;
    const halfWidth = containerWidth / 2;
    const halfHeight = containerHeight / 2;

    let baseX, baseY, rangeX, rangeY;

    switch (index) {
        case 1: // Top-left
            baseX = 0;
            baseY = 0;
            rangeX = halfWidth;
            rangeY = halfHeight;
            break;
        case 2: // Top-right
            baseX = halfWidth;
            baseY = 0;
            rangeX = halfWidth;
            rangeY = halfHeight;
            break;
        case 3: // Bottom-left
            baseX = 0;
            baseY = halfHeight;
            rangeX = halfWidth;
            rangeY = halfHeight;
            break;
        case 4: // Bottom-right
            baseX = halfWidth;
            baseY = halfHeight;
            rangeX = halfWidth;
            rangeY = halfHeight;
            break;
        default:
            return { x: 0, y: 0 };
    }

    const x = baseX + rangeX * xPercent;
    const y = baseY + rangeY * yPercent;

    return { x, y };
}

function hashWindowPositionsSnapshot(positions) {
    return JSON.stringify(positions);
}

function saveWindowPositions(options = {}) {
    const { force = false } = options;
    // Collect positions of all windows (non-transient, or transient that are marked for restoration)
    if (!window.isDesktop) return Promise.resolve();

    const windowPositions = {};
    const containerWidth = window.innerWidth;
    const containerHeight = window.innerHeight;

    // Get all modals that should have positions saved
    const allModals = document.querySelectorAll('.modal, #galleryWindow.windowed');

    allModals.forEach(modal => {
        // Skip if modal is hidden or doesn't have a title bar (not a window)
        if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt') || !modal.querySelector('.modal-window-title')) {
            return;
        }

        // Maximize is a temporary layout override — never persist work-area bounds
        if (modal.classList.contains('modal-maximized')) {
            return;
        }

        // Skip transient windows unless they're marked for position restoration
        const isTransient = modal.classList.contains('transient');

        // For transient windows, use dataset identifier instead of ID (IDs change on recreation)
        let windowKey = null;
        if (isTransient && modal.dataset.windowIdentifier) {
            // Use the stable dataset identifier for transient windows
            windowKey = modal.dataset.windowIdentifier;
            // Check if this transient window should restore positions
            if (!transientWindowsWithPositions.has(windowKey)) {
                return;
            }
        } else if (isTransient) {
            // Transient window without identifier - skip it
            return;
        } else {
            // Non-transient window - use ID or type
            const modalType = getModalType(modal);
            windowKey = modal.id || modalType;
        }

        if (!windowRestoresPosition(modal) && !windowRestoresSize(modal)) {
            return;
        }

        // Get current position and size in pixels
        const modalRect = modal.getBoundingClientRect();

        // Use actual rendered top-left corner position from getBoundingClientRect
        // This accounts for all CSS adjustments (true-inset-top, desktop mode, etc.)
        // Round to whole numbers for consistency
        const topLeftX = Math.round(modalRect.left);
        const topLeftY = Math.round(modalRect.top);

        // Convert top-left to quadrant position
        const topLeftQuadrant = pixelToQuadrantPosition(topLeftX, topLeftY, containerWidth, containerHeight);

        // Get bottom-right corner for size from rendered rect (resizeable / desktop shells)
        let bottomRightQuadrant = null;
        if (windowRestoresSize(modal) && (shouldSaveShellBoundsFromRect(modal) || modal.classList.contains('resizeable-window'))) {
            bottomRightQuadrant = pixelToQuadrantPosition(
                Math.round(modalRect.right),
                Math.round(modalRect.bottom),
                containerWidth,
                containerHeight
            );
        }

        // Only save if window has been moved or resized, or is a persistable desktop shell
        const shouldForceSave = shouldSaveShellBoundsFromRect(modal)
            || (modal.dataset.windowIdentifier
                && modal.dataset.windowIdentifier !== 'photoSwipeShell'
                && transientWindowsWithPositions.has(modal.dataset.windowIdentifier));

        if (shouldForceSave) {
            modal.setAttribute('data-modal-moved', 'true');
        }

        if (shouldForceSave || modal.hasAttribute('data-modal-moved') || bottomRightQuadrant) {
            const position = {};

            if (windowRestoresPosition(modal)) {
                position.topLeft = topLeftQuadrant;
            }

            // Add bottom-right corner if window has custom size
            if (bottomRightQuadrant) {
                position.bottomRight = bottomRightQuadrant;
            }

            if (position.topLeft || position.bottomRight) {
                windowPositions[windowKey] = position;
            }
        }
    });

    Object.assign(globalWindowPositions, windowPositions);

    const saveHash = hashWindowPositionsSnapshot(globalWindowPositions);
    if (!force && saveHash === lastSentWindowPositionsHash) {
        return Promise.resolve();
    }

    // Save via WebSocket — full merged map; partial saves wiped other windows
    if (wsClient && wsClient.isConnected() && Object.keys(globalWindowPositions).length > 0) {
        return wsClient.saveWindowPositions(null, globalWindowPositions).then(() => {
            lastSentWindowPositionsHash = saveHash;
            commitWindowPositionsSnapshot();
        }).catch((error) => {
            console.warn('Failed to save window positions:', error);
        });
    }

    return Promise.resolve();
}

// Restore position for a single window (only called when opening, if not already open)
function restoreWindowPosition(modal) {
    if (!windowRestoresPosition(modal) || Object.keys(globalWindowPositions).length === 0) {
        return;
    }

    // For transient windows, use dataset identifier instead of ID (IDs change on recreation)
    const windowKey = getWindowPositionKey(modal);
    if (!windowKey) {
        return;
    }

    // Try to find saved position for this window
    let savedPosition = globalWindowPositions[windowKey];

    if (savedPosition && savedPosition.topLeft) {
        const containerWidth = window.innerWidth;
        const containerHeight = window.innerHeight;

        // Convert top-left quadrant position to pixel position
        const topLeftPixel = quadrantToPixelPosition(savedPosition.topLeft, containerWidth, containerHeight);

        clearModalPixelAnchor(modal);

        const measureState = beginModalLayoutMeasure(modal);

        try {
            if (savedPosition.bottomRight && windowRestoresSize(modal) && modal.classList.contains('resizeable-window')) {
                const bottomRightPixel = quadrantToPixelPosition(savedPosition.bottomRight, containerWidth, containerHeight);
                const { minWidth, minHeight } = getModalMinDimensions(modal);
                let targetWidth = Math.max(minWidth, bottomRightPixel.x - topLeftPixel.x);
                let targetHeight = Math.max(minHeight, bottomRightPixel.y - topLeftPixel.y);

                const maxWidth = modal.dataset.windowMaxWidth ? parseInt(modal.dataset.windowMaxWidth, 10) : Infinity;
                const maxHeight = modal.dataset.windowMaxHeight ? parseInt(modal.dataset.windowMaxHeight, 10) : Infinity;

                targetWidth = Math.min(targetWidth, maxWidth);
                targetHeight = Math.min(targetHeight, maxHeight);

                const restoreClamp = { allowPartialBottomOverflow: true };
                setModalPositionFromViewportRect(modal, {
                    left: topLeftPixel.x,
                    top: topLeftPixel.y,
                    width: targetWidth,
                    height: targetHeight
                }, restoreClamp);
            } else {
                setModalOffsetsFromViewportTopLeft(modal, topLeftPixel.x, topLeftPixel.y, { allowPartialBottomOverflow: true });
            }

            modal.setAttribute('data-modal-moved', 'true');
            modal.setAttribute('data-window-position-restored', 'true');
        } finally {
            endModalLayoutMeasure(modal, measureState);
        }

        ensureModalEdgesWithinWorkArea(modal);
    }
}

// Note: restoreWindowPositions() is no longer used - positions are restored only when opening windows
// This function is kept for potential future use but is not called automatically
function restoreWindowPositions() {
    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';

    if (!workspaces || !workspaces[currentWorkspace]) {
        return;
    }
}

// About Melaton Modal
let aboutMelatoninSystemInfo = null;

async function openAboutMelatoninModal() {
    const modal = document.getElementById('aboutMelatoninModal');
    if (!modal) {
        console.error('About Melaton modal not found');
        return;
    }

    // Version will be loaded with system info

    // Load system information (from server cache - instant response)
    await loadAboutMelatoninSystemInfo();

    // Setup close button
    const closeBtn = document.getElementById('closeAboutMelatoninBtn');

    const closeModalHandler = () => {
        closeModal(modal);
    };

    if (closeBtn) {
        closeBtn.onclick = closeModalHandler;
    }

    // Open modal
    openModal(modal);
}

async function loadAboutMelatoninSystemInfo() {
    const systemInfoElement = document.getElementById('aboutMelatoninSystemInfo');
    if (!systemInfoElement) return;

    // Check if websocket is connected
    if (!window.wsClient || !window.wsClient.isConnected()) {
        systemInfoElement.innerHTML = '<p class="text-danger">System information unavailable (WebSocket not connected)</p>';
        return;
    }

    try {
        systemInfoElement.innerHTML = '<p class="text-muted">Loading system information...</p>';

        const response = await window.wsClient.sendMessage('get_system_info', {});

        if (response) {
            aboutMelatoninSystemInfo = response;

            // Update version display
            const versionElement = document.getElementById('aboutMelatoninVersion');
            if (versionElement && response.gitHash) {
                versionElement.textContent = response.gitHash;
            }

            renderAboutMelatoninSystemInfo(response);
        } else {
            systemInfoElement.innerHTML = '<p class="text-danger">Failed to load system information</p>';
        }
    } catch (error) {
        console.error('Failed to load system information:', error);
        systemInfoElement.innerHTML = '<p class="text-danger">Error loading system information</p>';
    }
}

function renderAboutMelatoninSystemInfo(data) {
    const systemInfoElement = document.getElementById('aboutMelatoninSystemInfo');
    if (!systemInfoElement || !data) return;

    // Helper function to format numbers with thousands separators
    const formatNumber = (num) => {
        if (num === null || num === undefined || isNaN(num)) return '0';
        return Number(num).toLocaleString('en-US');
    };

    // Helper function to format size strings (e.g., "1234.56 MB" -> "1,234.56 MB")
    const formatSizeString = (sizeStr) => {
        if (!sizeStr || typeof sizeStr !== 'string') return sizeStr;
        // Don't format if it's "Unknown" or "N/A"
        if (sizeStr === 'Unknown' || sizeStr === 'N/A') return sizeStr;
        // Match pattern: number(s) followed by optional decimal, then unit (MB, GB, TB, KB, B)
        return sizeStr.replace(/(\d+\.?\d*)\s*(MB|GB|TB|KB|B)/gi, (match, number, unit) => {
            const num = parseFloat(number);
            if (isNaN(num)) return match;
            return `${num.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 2 })} ${unit}`;
        });
    };

    let html = '';

    // CPU and RAM
    if (data.cpu || data.ram) {
        html += '<div class="form-row">';
        html += `<span class="text-secondary">${data.cpu || 'Unknown'}`;
        if (data.ram) {
            html += ` (${formatSizeString(data.ram)})`;
        }
        html += '</span></div>';
    }

    // Disk Space
    if (data.disk) {
        html += '<div class="form-row">';
        html += '<span class="about-info-label">Disk Space:</span> ';
        html += `<span class="text-secondary">`;
        html += `Total: ${formatSizeString(data.disk.total || 'Unknown')}, `;
        html += `Used: ${formatSizeString(data.disk.used || 'Unknown')}, `;
        html += `Free: ${formatSizeString(data.disk.free || 'Unknown')}`;
        html += '</span></div>';
    }

    systemInfoElement.innerHTML = html || '<p class="text-danger">No system information available</p>';
}

function isKeyboardEditableTarget(el) {
    if (!el || el === document.body || el === document.documentElement) return false;
    if (el.matches?.('input, textarea, select')) return true;
    if (el.isContentEditable) return true;
    return !!el.closest?.('input, textarea, select, [contenteditable="true"], [contenteditable=""]');
}

function resolveWindowToCloseWithAltQ() {
    if (currentActiveWindowId) {
        const active = document.getElementById(currentActiveWindowId);
        if (active && !active.classList.contains('hidden') && !active.classList.contains('closing')) {
            return active;
        }
    }
    const top = getTopOpenModal();
    if (!top || top.classList.contains('hidden') || top.classList.contains('closing')) {
        return null;
    }
    return top;
}

function canCloseWindowWithAltQ() {
    const modal = resolveWindowToCloseWithAltQ();
    if (!modal) return false;
    if (document.body.classList.contains('desktop-mode')) {
        return !!(currentActiveWindowId || modalStack.length > 0);
    }
    return modalStack.length > 0;
}

function handleAltQCloseWindowKeydown(e) {
    if (!e.altKey || e.ctrlKey || e.metaKey || e.shiftKey) return false;
    if ((e.key || '').toLowerCase() !== 'q') return false;
    if (isKeyboardEditableTarget(e.target) || isKeyboardEditableTarget(document.activeElement)) return false;
    if (!canCloseWindowWithAltQ()) return false;

    const modal = resolveWindowToCloseWithAltQ();
    if (!modal) return false;

    const closeBtn = modal.querySelector('.close-btn');
    if (closeBtn && !closeBtn.disabled) {
        e.preventDefault();
        e.stopPropagation();
        closeBtn.click();
        return true;
    }

    e.preventDefault();
    e.stopPropagation();
    closeModal(modal);
    return true;
}

function initializeUniversalModalKeyboardShortcuts() {
    if (document.body.dataset.universalModalKeyboardWired === 'true') return;
    document.body.dataset.universalModalKeyboardWired = 'true';

    // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
    registerKeyboardListener({
        id: 'universal.closeWindow.altQ',
        handler: handleAltQCloseWindowKeydown,
        type: 'global',
        priority: 75,
        critical: true,
        label: 'Close window',
        keys: 'Alt+Q',
        overlayIcon: 'fas fa-times',
        overlayGroup: 'Window'
    });
}

// Initialize modal dragging when DOM is ready
if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', () => {
        initializeModalDragging();
        initializeUniversalModalKeyboardShortcuts();
        if (window.isEditorStandaloneWindow) {
            return;
        }
        initializeGalleryWindow();
        initializeDesktopTaskbar();
        initializeStartMenu();
        initializeDesktopWallpaper();
    });
} else {
    initializeModalDragging();
    initializeUniversalModalKeyboardShortcuts();
    if (!window.isEditorStandaloneWindow) {
        initializeGalleryWindow();
        initializeDesktopTaskbar();
        initializeStartMenu();
        initializeDesktopWallpaper();
    }
}