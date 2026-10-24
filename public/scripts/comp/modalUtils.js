// Modal utility functions
const backdrop = document.querySelector('.modal-backdrop');

// Modal z-index management
const MODAL_Z_BASE = 1002; // Base z-index for modal stacking (above --z-modal = 1100)
const MODAL_Z_ON_TOP_BASE = 2800; // Base z-index for on-top modals (matches --z-modal-top CSS variable)
const MODAL_Z_INCREMENT = 10; // Increment between modal layers
/** After this many bump layers in a tier, compact with a full stack rewrite */
const MODAL_Z_COMPACT_LAYER_LIMIT = 250;
let modalStack = []; // Array to track modal stack order
// MCP launches (open_application, apply that opens Studio, viewers) nest under the
// window that was already on top so the user's focus stays put.
let mcpKeepTopDepth = 0;

function pushMcpKeepTopWindow() {
    mcpKeepTopDepth += 1;
}

function popMcpKeepTopWindow() {
    mcpKeepTopDepth = Math.max(0, mcpKeepTopDepth - 1);
}

function mcpLaunchKeepsTopWindow() {
    return mcpKeepTopDepth > 0;
}

// Dialogs the user has to answer stay in front of an MCP launch.
function mcpLaunchShouldLeaveOnTop(modal) {
    if (!modal) return false;
    if (modal.classList.contains('on-top') || modal.classList.contains('alert-theme')) return true;
    return TASKBAR_SYSTEM_MODAL_IDS.has(modal.id);
}

// Bootstrap / connection overlays — never shown as taskbar window buttons
const TASKBAR_SYSTEM_MODAL_IDS = new Set([
    'windowsStartupModal',
    'connectionDialModal',
    'domainConnectModal',
    'desktopPreStartupModal',
    'confirmationDialog',
    'creditCostDialog',
    'agentClientUpdateDialog',
    'dovecoteNewMailModal'
]);

function shouldShowInTaskbar(modal) {
    if (!modal || !modal.id) return false;
    if (TASKBAR_SYSTEM_MODAL_IDS.has(modal.id)) return false;
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) return false;
    if (modal.classList.contains('closing')) return false;
    if (!modal.querySelector('.modal-window-title')) return false;
    // Small alert overlays — not taskbar windows
    if (modal.classList.contains('alert-theme')) return false;
    // Owned dialogs (a game's Options, Statistics...) have no taskbar button, as in Windows
    if (modal.dataset.windowOwned === 'true') return false;
    return true;
}

function getOpenTaskbarModals() {
    return Array.from(document.querySelectorAll('.modal:not(.hidden)')).filter(shouldShowInTaskbar);
}

/** type -> Map(modalId -> modal). Rebuilt from the DOM on every taskbar update:
 * some windows (galleryWindow, manualModal desktop path) are unhidden without openModal. */
let taskbarModalGroupsCache = new Map();

function rebuildTaskbarModalGroupsCache() {
    taskbarModalGroupsCache = new Map();
    getOpenTaskbarModals().forEach((modal) => {
        const type = getModalType(modal);
        let group = taskbarModalGroupsCache.get(type);
        if (!group) {
            group = new Map();
            taskbarModalGroupsCache.set(type, group);
        }
        group.set(modal.id, modal);
    });
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

// Cached --true-inset-top resolution (env() calc cannot be parseFloat'd from the custom property)
let modalTrueInsetProbeEl = null;
let cachedModalTrueInsetTop = null;
let modalTrueInsetCacheValid = false;
let modalTrueInsetInvalidateScheduled = false;

/** Active drag/resize session — avoids per-mousemove querySelector + DOM attribute parsing */
let activeModalInteraction = null;
let cachedWindowFrameEl = null;
/** True while document move/end listeners are bound for an active drag/resize */
let modalInteractionMoveListenersAttached = false;

/** Desktop-mode pointer gesture: down ≠ focus; up decides focus. Match desktopShortcuts.dragThreshold. */
const DESKTOP_POINTER_CLICK_SLOP_PX = 10;
const DESKTOP_POINTER_TOUCH_MOUSE_GUARD_MS = 700;
let desktopPointerGesture = null;
let desktopPointerFocusBlocked = false;
let desktopPointerGestureListenersAttached = false;
let desktopPointerTouchGuardUntil = 0;

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

window.addEventListener('resize', () => {
    modalTrueInsetCacheValid = false;
    ['desktopPreStartupModal', 'workstationLockModal'].forEach((id) => {
        const logonModal = document.getElementById(id);
        if (!logonModal) return;
        delete logonModal.dataset.logonPlaceKey;
        placeWindowsLogonDialog(logonModal);
    });
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
// Vista: a maximized window stays put until the caption drag passes a few px, then restores under the pointer
const MAXIMIZED_DRAG_RESTORE_THRESHOLD_PX = 4;

function getDesktopModalTopBias() {
    return window.isDesktop ? MODAL_DESKTOP_TOP_BIAS_PX : 0;
}

/**
 * Classic logon dialog (msgina "Log On to Windows" / Computer Locked).
 * Horizontally centered. The top edge is one third of the leftover vertical space:
 *   top = (viewportHeight - dialogHeight) / 3
 * Measured on a full-frame XP classic logon: the gap above the dialog was that third.
 * desktopTopBias is the 18px the desktop modal CSS subtracts, so the returned
 * offset cancels it and the dialog lands on the full screen (the taskbar is hidden here).
 */
function windowsLogonDialogOffsetY(viewportHeight, dialogHeight, trueInsetTop, desktopTopBias) {
    const H = viewportHeight;
    const h = dialogHeight;
    const inset = trueInsetTop || 0;
    const bias = desktopTopBias || 0;
    const free = Math.max(0, H - h);
    const desiredCenter = free / 3 + h / 2;
    return desiredCenter - (H / 2) - (0.5 * inset) + bias;
}

/** #desktopPreStartupModal and #workstationLockModal. Skip a window the user has dragged. */
function placeWindowsLogonDialog(modal) {
    if (!modal || modal.classList.contains('hidden') || modal.hasAttribute('data-modal-moved') || modal.hasAttribute('data-dragging')) {
        return;
    }
    const h = modal.offsetHeight;
    if (!h) return;
    const inset = getModalTrueInsetTop();
    const key = `${window.innerHeight}:${h}:${inset}`;
    const y = windowsLogonDialogOffsetY(window.innerHeight, h, inset, getDesktopModalTopBias());
    const raw = modal.style.getPropertyValue('--modal-offset-y');
    const current = parseFloat(raw);
    if (modal.dataset.logonPlaceKey === key && raw && Number.isFinite(current) && Math.abs(current - y) < 1.5) {
        return;
    }
    modal.dataset.logonPlaceKey = key;
    const opening = modal.classList.contains('opening');
    clearModalPixelAnchor(modal);
    setModalOffsetPx(modal, 0, y, { snap: !opening, settle: !opening });
}

function computeModalWorkAreaBounds(trueInsetTop) {
    let bottom = window.innerHeight;
    if (window.isDesktop && document.body.classList.contains('desktop-mode')) {
        const taskbar = document.getElementById('desktopTaskbar');
        // Auto-hide the taskbar: windows get the whole screen (taskbarSettings.js)
        if (taskbar && !taskbar.classList.contains('taskbar-autohide')) {
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

function getModalWorkAreaBounds() {
    if (activeModalInteraction && activeModalInteraction.workArea) {
        return activeModalInteraction.workArea;
    }
    return computeModalWorkAreaBounds(getModalTrueInsetTop());
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
        left: roundCssPixel(newLeft),
        top: roundCssPixel(newTop)
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

/** Build persisted quadrant position/size from a layout rect (live or _preMaximizeLayout). */
function buildWindowPositionEntryFromLayout(modal, layout, containerWidth, containerHeight) {
    if (!modal || !layout) {
        return null;
    }
    if (!windowRestoresPosition(modal) && !windowRestoresSize(modal)) {
        return null;
    }

    const left = Number(layout.left);
    const top = Number(layout.top);
    const width = Number(layout.width);
    const height = Number(layout.height);
    if (![left, top, width, height].every(Number.isFinite)) {
        return null;
    }

    const position = {};
    if (windowRestoresPosition(modal)) {
        position.topLeft = pixelToQuadrantPosition(
            Math.round(left),
            Math.round(top),
            containerWidth,
            containerHeight
        );
    }

    if (windowRestoresSize(modal) && (shouldSaveShellBoundsFromRect(modal) || modal.classList.contains('resizeable-window'))) {
        position.bottomRight = pixelToQuadrantPosition(
            Math.round(left + width),
            Math.round(top + height),
            containerWidth,
            containerHeight
        );
    }

    if (!position.topLeft && !position.bottomRight) {
        return null;
    }
    // Work-area fractions are what restore and viewport re-layout use; the quadrant pair above
    // stays for older readers and the server validator (public/scripts/comp/windowGeometry.js)
    if (typeof windowGeometry !== 'undefined' && windowGeometry) {
        const edges = windowGeometry.computeWindowEdges({ left, top, width, height }, getModalWorkAreaBounds());
        if (edges) {
            position.edges = edges;
        }
    }
    return position;
}

/** Persist last normal geometry into the in-memory map (maximize must not leave work-area bounds). */
function commitModalLayoutToWindowPositions(modal, layout) {
    const windowKey = getWindowPositionKey(modal);
    if (!windowKey || !layout) {
        return false;
    }
    if (modal.classList.contains('transient') && !transientWindowsWithPositions.has(windowKey)) {
        return false;
    }

    const entry = buildWindowPositionEntryFromLayout(
        modal,
        layout,
        window.innerWidth,
        window.innerHeight
    );
    if (!entry) {
        return false;
    }

    globalWindowPositions[windowKey] = entry;
    return true;
}

function maximizeModalToWorkArea(modal) {
    if (!modal || isModalMaximized(modal)) {
        return;
    }

    // Capture and commit last normal geometry before work-area override
    modal._preMaximizeLayout = captureModalLayoutState(modal);
    commitModalLayoutToWindowPositions(modal, modal._preMaximizeLayout);
    modal.classList.add('modal-maximized');
    window.syncRootStateFlags?.();

    clearModalPixelAnchor(modal);

    const workArea = getModalWorkAreaInnerBounds();
    const nudge = getModalMaximizeCaptionNudgePx();
    modal.style.width = `${roundCssPixel(workArea.width)}px`;
    modal.style.height = `${roundCssPixel(workArea.height + nudge)}px`;
    void modal.offsetHeight;
    // skipClamp: the nudge lifts the frame under the caption band on purpose. Clamping to the
    // work area used to push it back down, so the extra height ended under the taskbar (#400).
    setModalOffsetsFromViewportTopLeft(modal, workArea.left, workArea.top - nudge, { skipClamp: true });

    modal.setAttribute('data-modal-moved', 'true');
    updateModalMaximizeButtonIcon(modal);
    modal.dispatchEvent(new CustomEvent('modalMaximized', {
        bubbles: false,
        detail: { modal }
    }));
    // Flush last normal state (save path uses _preMaximizeLayout while maximized)
    debouncedSaveWindowPositions();
}

/** Maximised windows follow a change of the work area without a viewport resize (taskbarSettings.js
 *  auto-hide). Minimised ones are left as the resize sync leaves them. */
function refitMaximizedModals() {
    let changed = false;
    document.querySelectorAll('.modal.modal-maximized:not(.hidden):not(.hidden-alt)').forEach((modal) => {
        if (modal.classList.contains('minimised') || modal.classList.contains('minimising')) {
            return;
        }
        finishModalRectMorph(modal);
        restoreModalFromMaximize(modal);
        maximizeModalToWorkArea(modal);
        changed = true;
    });
    return changed;
}

function restoreModalFromMaximize(modal) {
    if (!modal || !isModalMaximized(modal)) {
        return;
    }

    const layout = modal._preMaximizeLayout;
    modal.classList.remove('modal-maximized');
    window.syncRootStateFlags?.();
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
    // Start from what is on screen, but measure and save from the settled box
    const fromRect = modal.getBoundingClientRect();
    finishModalRectMorph(modal);
    if (isModalMaximized(modal)) {
        restoreModalFromMaximize(modal);
    } else {
        maximizeModalToWorkArea(modal);
    }
    playModalRectMorph(modal, fromRect);
}

/** Jump a running maximize / restore morph to its end so getBoundingClientRect is the real box. */
function finishModalRectMorph(modal) {
    if (modal && modal._rectMorph) {
        modal._rectMorph.finish();
        modal._rectMorph = null;
    }
}

/** CSS time token ("180ms", ".18s" after minification) in ms. */
function parseCssTimeMs(value) {
    const text = String(value || '').trim();
    const n = parseFloat(text);
    if (!Number.isFinite(n)) return 0;
    return /ms$/.test(text) ? n : (/s$/.test(text) ? n * 1000 : n);
}

/**
 * Aero maximize / restore (#441): the frame morphs from its old rect to the new one. FLIP on
 * the individual `translate` / `scale` properties, so the window's own `transform` (centre
 * anchor or pixel-settled translateZ) is left alone. Compositor only; skipped when the
 * window's transform is more than a translation (open / minimize animation running).
 */
function playModalRectMorph(modal, fromRect) {
    if (!modal || !fromRect || typeof modal.animate !== 'function' || typeof DOMMatrixReadOnly === 'undefined') {
        return null;
    }
    const duration = parseCssTimeMs(getComputedStyle(document.documentElement).getPropertyValue('--window-morph-duration'));
    if (!(duration > 0)) {
        return null;
    }
    const toRect = modal.getBoundingClientRect();
    const morph = computeModalRectMorph(fromRect, toRect, getComputedStyle(modal));
    if (!morph) {
        return null;
    }
    if (modal._rectMorph) {
        modal._rectMorph.cancel();
    }
    const animation = modal.animate([
        { translate: `${morph.dx}px ${morph.dy}px`, scale: `${morph.sx} ${morph.sy}` },
        { translate: '0px 0px', scale: '1 1' }
    ], { duration, easing: 'cubic-bezier(0.2, 0, 0, 1)' });
    modal._rectMorph = animation;
    animation.onfinish = animation.oncancel = () => {
        if (modal._rectMorph === animation) {
            modal._rectMorph = null;
        }
    };
    return animation;
}

/** translate / scale that put a box laid out at toRect back onto fromRect (null when not a plain move). */
function computeModalRectMorph(fromRect, toRect, computedStyle) {
    if (!fromRect.width || !fromRect.height || !toRect.width || !toRect.height) {
        return null;
    }
    const transform = computedStyle.transform;
    const m = new DOMMatrixReadOnly(transform && transform !== 'none' ? transform : undefined);
    if (Math.abs(m.a - 1) > 1e-3 || Math.abs(m.d - 1) > 1e-3 || Math.abs(m.b) > 1e-3 || Math.abs(m.c) > 1e-3) {
        return null;
    }
    const sx = fromRect.width / toRect.width;
    const sy = fromRect.height / toRect.height;
    if (Math.abs(sx - 1) < 0.01 && Math.abs(sy - 1) < 0.01
        && Math.abs(fromRect.left - toRect.left) < 1 && Math.abs(fromRect.top - toRect.top) < 1) {
        return null;
    }
    // Origin in viewport space: the layout box (toRect minus the transform's translation) + transform-origin
    const origin = String(computedStyle.transformOrigin || '').split(' ').map(parseFloat);
    const ox = Number.isFinite(origin[0]) ? origin[0] : toRect.width / 2;
    const oy = Number.isFinite(origin[1]) ? origin[1] : toRect.height / 2;
    const originX = toRect.left - m.e + ox;
    const originY = toRect.top - m.f + oy;
    // Scale about the origin, then translate, so the new box's centre lands on the old centre
    const fromCx = fromRect.left + fromRect.width / 2;
    const fromCy = fromRect.top + fromRect.height / 2;
    const toCx = toRect.left + toRect.width / 2;
    const toCy = toRect.top + toRect.height / 2;
    return {
        dx: fromCx - originX - sx * (toCx - originX),
        dy: fromCy - originY - sy * (toCy - originY),
        sx,
        sy
    };
}

// Windows whose caption already carries their own maximize (gallery mode, Glancewell fullscreen, Studio editor)
const MODAL_CUSTOM_MAXIMIZE_SELECTOR = '#maximizeGalleryBtn, #maximizePhotoSwipeBtn, #restoreManualBtn';

/**
 * Slice 3 (#440): every resizable window with a minimize box gets a work-area maximize box
 * between minimize and close. Opt out with data-window-no-maximize="true".
 */
function ensureModalMaximizeButton(modal) {
    if (!modal || !modal.classList.contains('modal') || !modal.classList.contains('resizeable-window')) {
        return null;
    }
    if (modal.dataset.windowNoMaximize === 'true' || modal.dataset.windowFixedSize === 'true') {
        return null;
    }
    const controls = modal.querySelector('.modal-window-controls');
    if (!controls || !modal.querySelector('.modal-window-title')) {
        return null;
    }
    const existing = controls.querySelector('.modal-work-area-maximize');
    if (existing) {
        return existing;
    }
    if (controls.querySelector(MODAL_CUSTOM_MAXIMIZE_SELECTOR)) {
        return null;
    }
    const minimizeBtn = Array.from(controls.children).find((el) => el.classList.contains('minimize-btn'));
    if (!minimizeBtn) {
        return null;
    }
    const maxBtn = document.createElement('button');
    maxBtn.type = 'button';
    maxBtn.className = 'btn-secondary btn-small modal-work-area-maximize modal-maximize-auto';
    maxBtn.title = 'Maximize';
    maxBtn.innerHTML = '<i class="fa-regular fa-window-maximize"></i>';
    minimizeBtn.after(maxBtn);
    return maxBtn;
}

function wireModalMaximizeButton(modal) {
    if (!modal) {
        return;
    }
    ensureModalMaximizeButton(modal);
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
    if (modal.dataset.windowIdentifier === 'desktopGuacSession') {
        // toggleDesktopGuacCover: public/scripts/comp/desktop-apps/guacRemote.js
        toggleDesktopGuacCover(modal);
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

/**
 * The draggable caption band: inside .modal-window-title, above its title toolbar, not on a control.
 * Shared by drag start and caption double-click.
 */
function getModalCaptionBandTitleBar(e) {
    const titleBar = e.target.closest('.modal-window-title');
    if (!titleBar) return null;
    if (e.target.closest('.modal-window-title-toolbar')) return null;
    if (e.target.closest('button, input, select, textarea, a, [role="button"]')) return null;

    const toolbar = titleBar.querySelector('.modal-window-title-toolbar');
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;
    // A hidden toolbar (Calculator's mode bar on the Vista desktop) has a 0 rect.
    // Using that top rejects every caption click.
    const toolbarShown = toolbar && getComputedStyle(toolbar).display !== 'none';
    const bandBottom = toolbarShown
        ? toolbar.getBoundingClientRect().top
        : titleBar.getBoundingClientRect().bottom;
    return clientY < bandBottom ? titleBar : null;
}

function isModalCaptionControlUsable(btn) {
    return !!(btn && !btn.disabled && !btn.classList.contains('hidden') && getComputedStyle(btn).display !== 'none');
}

/** Caption double-click (#440): maximize / restore; a window without a maximize box minimizes. */
function handleModalCaptionDoubleClick(e) {
    if (!document.body.classList.contains('desktop-mode')) return;
    const titleBar = getModalCaptionBandTitleBar(e);
    if (!titleBar) return;
    const modal = titleBar.closest('.modal');
    if (!modal || modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')
        || modal.classList.contains('minimised') || modal.classList.contains('minimising')
        || modal.classList.contains('opening') || modal.classList.contains('closing')) {
        return;
    }
    // Fullscreen Studio editor is not a window
    if (modal.id === 'manualModal' && !modal.classList.contains('windowed')) return;

    const controls = modal.querySelector('.modal-window-controls');
    if (!controls) return;
    if (modal.dataset.windowIdentifier === 'desktopGuacSession') {
        e.preventDefault();
        // toggleDesktopGuacCover: public/scripts/comp/desktop-apps/guacRemote.js
        toggleDesktopGuacCover(modal);
        return;
    }
    const maxBtn = controls.querySelector('.modal-work-area-maximize');
    const customMaxBtn = controls.querySelector(MODAL_CUSTOM_MAXIMIZE_SELECTOR);
    if (isModalCaptionControlUsable(maxBtn)) {
        e.preventDefault();
        toggleModalMaximize(modal);
        return;
    }
    if (isModalCaptionControlUsable(customMaxBtn)) {
        e.preventDefault();
        customMaxBtn.click();
        return;
    }
    const minimizeBtn = controls.querySelector('.minimize-btn');
    if (isModalCaptionControlUsable(minimizeBtn)) {
        e.preventDefault();
        minimizeModalProgrammatically(modal);
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

/**
 * Re-apply a window's saved work-area fractions (public/scripts/comp/windowGeometry.js).
 * Resizable windows take the scaled rect; data-window-fixed-size windows keep their pixel
 * size and move to the saved centre. A remnant (maximized / fullscreen rect) is ignored.
 */
function applyWindowGeometryEdges(modal, edges) {
    if (!modal || typeof windowGeometry === 'undefined' || !windowGeometry || !windowGeometry.isEdges(edges)) {
        return false;
    }
    if (windowGeometry.isRemnantGeometry(edges)) {
        return false;
    }
    const workArea = getModalWorkAreaBounds();
    const fixedSize = modal.dataset.windowFixedSize === 'true'
        || !windowRestoresSize(modal)
        || !modal.classList.contains('resizeable-window');

    clearModalPixelAnchor(modal);
    const measureState = beginModalLayoutMeasure(modal);
    try {
        const restoreClamp = { allowPartialBottomOverflow: true };
        if (fixedSize) {
            const layout = getModalLayoutDimensions(modal);
            const rect = windowGeometry.edgesToRect(edges, workArea, { fixedSize: { width: layout.width, height: layout.height } });
            if (!rect) return false;
            // whole pixels: a fractional edge blends the client's last row with the frame (Yukimi 2026-10-13)
            setModalOffsetsFromViewportTopLeft(modal, Math.round(rect.left), Math.round(rect.top), restoreClamp);
        } else {
            const rect = windowGeometry.edgesToRect(edges, workArea);
            if (!rect) return false;
            const { minWidth, minHeight } = getModalMinDimensions(modal);
            const maxWidth = modal.dataset.windowMaxWidth ? parseInt(modal.dataset.windowMaxWidth, 10) : Infinity;
            const maxHeight = modal.dataset.windowMaxHeight ? parseInt(modal.dataset.windowMaxHeight, 10) : Infinity;
            setModalPositionFromViewportRect(modal, {
                left: Math.round(rect.left),
                top: Math.round(rect.top),
                width: Math.round(Math.min(maxWidth, Math.max(minWidth, rect.width))),
                height: Math.round(Math.min(maxHeight, Math.max(minHeight, rect.height)))
            }, restoreClamp);
        }
        modal.setAttribute('data-modal-moved', 'true');
        modal.setAttribute('data-window-position-restored', 'true');
    } finally {
        endModalLayoutMeasure(modal, measureState);
    }
    return true;
}

function handleDesktopViewportResizePositionSync() {
    if (!window.isDesktop || !document.body.classList.contains('desktop-mode')) {
        return;
    }
    // A hidden tab, a minimised browser or a collapsed viewport is not a layout to adopt
    if (typeof windowGeometry !== 'undefined' && windowGeometry && !windowGeometry.shouldRelayoutViewport({
        hidden: document.hidden,
        innerWidth: window.innerWidth,
        innerHeight: window.innerHeight,
        outerWidth: window.outerWidth,
        outerHeight: window.outerHeight
    })) {
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
        // Fullscreen Studio editor is not a window
        if (modal.id === 'manualModal' && !modal.classList.contains('windowed')) {
            return;
        }
        if (isModalMaximized(modal)) {
            // Re-fit to the new work area
            restoreModalFromMaximize(modal);
            maximizeModalToWorkArea(modal);
            positionChanged = true;
            return;
        }
        const windowKey = getWindowPositionKey(modal);
        const savedEntry = windowKey ? globalWindowPositions[windowKey] : null;
        const edges = modal._geometryEdges || (savedEntry && savedEntry.edges) || null;
        if (edges && applyWindowGeometryEdges(modal, edges)) {
            positionChanged = true;
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
        // Fullscreen Studio editor: windowed geometry must not be pushed onto it
        if (modal.id === 'manualModal' && !modal.classList.contains('windowed')) {
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

        let shortcutsReady = !needsLoad;
        if (needsLoad) {
            desktopShortcuts.currentWorkspace = workspaceId;
            shortcutsReady = await desktopShortcuts.loadShortcuts(workspaceId);
        }

        if (shortcutsReady && desktopShortcuts.gridContainer && desktopShortcuts.freeformContainer) {
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

/** Nudge the offsets so the window's left/top land on whole CSS pixels (never a subpixel). */
function snapModalOffsetsToDevicePixels(modal) {
    if (!modal || modal.classList.contains('modal-pixel-settled')) {
        return;
    }

    const rect = modal.getBoundingClientRect();
    const targetLeft = roundCssPixel(rect.left);
    const targetTop = roundCssPixel(rect.top);
    const deltaX = targetLeft - rect.left;
    const deltaY = targetTop - rect.top;

    if (Math.abs(deltaX) < 0.0005 && Math.abs(deltaY) < 0.0005) {
        return;
    }

    const computedStyle = getComputedStyle(modal);
    const offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');

    // roundCssOffset keeps the half pixel an odd-sized window needs (public/scripts/utils/deviceUtils.js)
    modal.style.setProperty('--modal-offset-x', `${roundCssOffset(offsetX + deltaX)}px`);
    modal.style.setProperty('--modal-offset-y', `${roundCssOffset(offsetY + deltaY)}px`);
}

function setModalOffsetPx(modal, offsetX, offsetY, options) {
    if (!modal) {
        return;
    }

    const opts = options || {};

    modal.style.setProperty('--modal-offset-x', `${roundCssOffset(offsetX)}px`);
    modal.style.setProperty('--modal-offset-y', `${roundCssOffset(offsetY)}px`);

    if (opts.snap !== false) {
        void modal.offsetHeight;
        snapModalOffsetsToDevicePixels(modal);
    }

    if (opts.settle) {
        settleModalPixelAnchor(modal);
    } else if (window.aeroGlass) {
        // Frosted frames track the window origin (public/scripts/comp/aeroGlass.js); settle syncs itself
        window.aeroGlass.syncModal(modal);
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
    modal.style.setProperty('--modal-pixel-left', `${roundCssPixel(rect.left)}px`);
    modal.style.setProperty('--modal-pixel-top', `${roundCssPixel(rect.top)}px`);
    modal.classList.add('modal-pixel-settled');
    // Fresh work-area fractions for the viewport re-layout (a maximized rect is never a normal geometry)
    if (!isModalMaximized(modal) && typeof windowGeometry !== 'undefined' && windowGeometry) {
        const edges = windowGeometry.computeWindowEdges(rect, getModalWorkAreaBounds());
        if (edges) {
            modal._geometryEdges = edges;
        }
    }
    if (window.aeroGlass) {
        window.aeroGlass.syncModal(modal);
    }
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
    'naxtCustomTagModal',
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
    // A tool window without an icon of its own shows its parent's (openModal links on-top tools late)
    ensureModalApplicationIcon(toolElement);
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

function getModalTrueInsetProbe() {
    if (!modalTrueInsetProbeEl || !modalTrueInsetProbeEl.isConnected) {
        modalTrueInsetProbeEl = document.createElement('div');
        modalTrueInsetProbeEl.setAttribute('aria-hidden', 'true');
        modalTrueInsetProbeEl.style.cssText = 'position:absolute;top:var(--true-inset-top,0px);left:0;width:0;height:0;margin:0;padding:0;border:0;visibility:hidden;pointer-events:none;';
        document.body.appendChild(modalTrueInsetProbeEl);
    }
    return modalTrueInsetProbeEl;
}

function getModalTrueInsetTop() {
    if (activeModalInteraction && Number.isFinite(activeModalInteraction.trueInsetTop)) {
        return activeModalInteraction.trueInsetTop;
    }
    if (modalTrueInsetCacheValid && cachedModalTrueInsetTop != null) {
        return cachedModalTrueInsetTop;
    }
    const trueInsetTop = getModalTrueInsetProbe().offsetTop || 0;
    cachedModalTrueInsetTop = trueInsetTop;
    modalTrueInsetCacheValid = true;
    if (!modalTrueInsetInvalidateScheduled) {
        modalTrueInsetInvalidateScheduled = true;
        requestAnimationFrame(() => {
            modalTrueInsetInvalidateScheduled = false;
            modalTrueInsetCacheValid = false;
        });
    }
    return trueInsetTop;
}

function scheduleModalInteractionVisual(applyFn) {
    const session = activeModalInteraction;
    if (!session) {
        applyFn();
        return;
    }
    session.pendingVisual = applyFn;
    if (session.rafId) {
        return;
    }
    session.rafId = requestAnimationFrame(() => {
        session.rafId = 0;
        const fn = session.pendingVisual;
        session.pendingVisual = null;
        if (fn) {
            fn();
        }
    });
}

function flushModalInteractionVisual() {
    const session = activeModalInteraction;
    if (!session) {
        return;
    }
    if (session.rafId) {
        cancelAnimationFrame(session.rafId);
        session.rafId = 0;
    }
    const fn = session.pendingVisual;
    session.pendingVisual = null;
    if (fn) {
        fn();
    }
}

/**
 * Window drag frame: the pixel-settled window sits on whole-pixel left/top and moves by a
 * whole-pixel translate (app.css), so it is never painted on a subpixel. Runs once per frame
 * and writes only when the whole-pixel delta changed.
 */
function applyModalDragFrame() {
    const s = activeModalInteraction;
    if (!s || s.type !== 'drag') return;
    s.rafId = 0;
    const dx = s.dragX;
    const dy = s.dragY;
    if (dx === s.appliedDragX && dy === s.appliedDragY) return;
    s.appliedDragX = dx;
    s.appliedDragY = dy;
    if (s.livePreview) {
        updateWindowFrameRect({ left: s.startLeft + dx, top: s.startTop + dy, width: s.width, height: s.height });
        return;
    }
    s.modal.style.setProperty('--modal-drag-x', `${dx}px`);
    s.modal.style.setProperty('--modal-drag-y', `${dy}px`);
}

/**
 * Put a window on the pixel-settled anchor for a drag: whole-pixel left/top. Returns false
 * when it cannot be settled (the corner-anchored boot splash); that window keeps offset mode.
 */
function anchorModalForPixelDrag(modal) {
    if (isModalMaximized(modal)) {
        restoreModalFromMaximize(modal);
    }
    if (modal.id !== 'windowsStartupModal' && !modal.classList.contains('modal-pixel-settled')) {
        clearModalPixelAnchor(modal);
        settleModalPixelAnchor(modal);
    }
    if (modal.id === 'windowsStartupModal' || !modal.classList.contains('modal-pixel-settled')) {
        prepareModalForDragOrResize(modal);
        return false;
    }
    return true;
}

/** Whole-pixel drag origin; rewrites a settled anchor stored on a fraction (older device-pixel snaps). */
function readModalPixelDragOrigin(modal, rect) {
    const left = roundCssPixel(rect.left);
    const top = roundCssPixel(rect.top);
    if (left !== rect.left || top !== rect.top) {
        modal.style.setProperty('--modal-pixel-left', `${left}px`);
        modal.style.setProperty('--modal-pixel-top', `${top}px`);
    }
    return { left, top };
}

function clearModalDragTransform(modal) {
    if (!modal) {
        return;
    }
    modal.style.removeProperty('--modal-drag-x');
    modal.style.removeProperty('--modal-drag-y');
}

function attachModalInteractionMoveListeners() {
    if (modalInteractionMoveListenersAttached) {
        return;
    }
    document.addEventListener('mousemove', handleModalInteraction);
    document.addEventListener('mouseup', handleModalInteractionEnd);
    document.addEventListener('touchmove', handleModalInteraction, { passive: false });
    document.addEventListener('touchend', handleModalInteractionEnd, { passive: false });
    document.addEventListener('touchcancel', handleModalInteractionEnd, { passive: false });
    modalInteractionMoveListenersAttached = true;
}

function detachModalInteractionMoveListeners() {
    if (!modalInteractionMoveListenersAttached) {
        return;
    }
    document.removeEventListener('mousemove', handleModalInteraction);
    document.removeEventListener('mouseup', handleModalInteractionEnd);
    document.removeEventListener('touchmove', handleModalInteraction);
    document.removeEventListener('touchend', handleModalInteractionEnd);
    document.removeEventListener('touchcancel', handleModalInteractionEnd);
    modalInteractionMoveListenersAttached = false;
}

function isDesktopPointerMode() {
    return !!(window.isDesktop || document.body.classList.contains('desktop-mode'));
}

function getDesktopPointerClientPoint(e) {
    if (e.touches && e.touches[0]) return { x: e.touches[0].clientX, y: e.touches[0].clientY };
    if (e.changedTouches && e.changedTouches[0]) return { x: e.changedTouches[0].clientX, y: e.changedTouches[0].clientY };
    return { x: e.clientX, y: e.clientY };
}

function getDesktopPointerClickSlopPx() {
    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts && desktopShortcuts.dragThreshold) {
        return desktopShortcuts.dragThreshold;
    }
    return DESKTOP_POINTER_CLICK_SLOP_PX;
}

function noteDesktopPointerSelection() {
    if (!desktopPointerGesture) return;
    desktopPointerGesture.selection = true;
}

function noteDesktopPointerContentDrag() {
    if (!desktopPointerGesture) return;
    desktopPointerGesture.contentDrag = true;
}

function wasDesktopPointerFocusBlocked() {
    return desktopPointerFocusBlocked;
}

function attachDesktopPointerGestureListeners() {
    if (desktopPointerGestureListenersAttached) return;
    document.addEventListener('mousemove', updateDesktopPointerGesture);
    document.addEventListener('touchmove', updateDesktopPointerGesture, { passive: true });
    document.addEventListener('mouseup', finishDesktopPointerGesture);
    document.addEventListener('touchend', finishDesktopPointerGesture);
    document.addEventListener('touchcancel', finishDesktopPointerGesture);
    desktopPointerGestureListenersAttached = true;
}

function detachDesktopPointerGestureListeners() {
    if (!desktopPointerGestureListenersAttached) return;
    document.removeEventListener('mousemove', updateDesktopPointerGesture);
    document.removeEventListener('touchmove', updateDesktopPointerGesture);
    document.removeEventListener('mouseup', finishDesktopPointerGesture);
    document.removeEventListener('touchend', finishDesktopPointerGesture);
    document.removeEventListener('touchcancel', finishDesktopPointerGesture);
    desktopPointerGestureListenersAttached = false;
}

function beginDesktopPointerGesture(e) {
    // CURSOR: macOS down≠focus — record only; activation waits for up
    if (e.type === 'mousedown') {
        if (e.button !== 0) return;
        if (e.sourceCapabilities && e.sourceCapabilities.firesTouchEvents) return;
        if (Date.now() < desktopPointerTouchGuardUntil) return;
    }
    const pt = getDesktopPointerClientPoint(e);
    const modal = e.target?.closest?.('.modal');
    desktopPointerFocusBlocked = false;
    desktopPointerGesture = {
        startX: pt.x,
        startY: pt.y,
        maxDist: 0,
        modal: modal && !e.target.closest('.resize-handle') ? modal : null,
        selection: false,
        contentDrag: false
    };
    attachDesktopPointerGestureListeners();
}

function updateDesktopPointerGesture(e) {
    if (!desktopPointerGesture) return;
    const pt = getDesktopPointerClientPoint(e);
    if (pt.x == null || pt.y == null) return;
    const dist = Math.hypot(pt.x - desktopPointerGesture.startX, pt.y - desktopPointerGesture.startY);
    if (dist > desktopPointerGesture.maxDist) desktopPointerGesture.maxDist = dist;
    if (typeof desktopShortcuts !== 'undefined' && desktopShortcuts?.isDragging) {
        desktopPointerGesture.contentDrag = true;
    }
    if (document.querySelector('.explorer-item-drag-active')) {
        desktopPointerGesture.contentDrag = true;
    }
}

function finishDesktopPointerGesture(e) {
    if (!desktopPointerGesture) return;
    if (e.type === 'touchend' || e.type === 'touchcancel') {
        desktopPointerTouchGuardUntil = Date.now() + DESKTOP_POINTER_TOUCH_MOUSE_GUARD_MS;
    }
    if (e.type === 'touchcancel') {
        desktopPointerFocusBlocked = true;
        desktopPointerGesture = null;
        detachDesktopPointerGestureListeners();
        return;
    }
    updateDesktopPointerGesture(e);
    const moved = desktopPointerGesture.maxDist >= getDesktopPointerClickSlopPx();
    const selection = !!desktopPointerGesture.selection;
    const contentDrag = !!desktopPointerGesture.contentDrag
        || !!(typeof desktopShortcuts !== 'undefined' && desktopShortcuts?.isDragging);
    // CURSOR: macOS down≠focus / up=focus — activate only for a no-move / no-selection / no-content-drag click
    desktopPointerFocusBlocked = moved || selection || contentDrag;
    const modal = desktopPointerGesture.modal;
    desktopPointerGesture = null;
    detachDesktopPointerGestureListeners();
    if (desktopPointerFocusBlocked) return;
    if (!modal || !modal.isConnected || modal.classList.contains('hidden')) return;
    if (!modal.contains(e.target)) return;
    handleModalClick(modal);
}

function handleModalActivatePointer(e, modal) {
    if (!modal.contains(e.target)) return;
    if (e.target.closest('.resize-handle')) return;
    // CURSOR: macOS down≠focus — desktop mode activates on pointer up via finishDesktopPointerGesture
    if (isDesktopPointerMode()) return;
    handleModalClick(modal);
}

let galleryDragScrollPin = null;

function pinGalleryScrollForWindowDrag() {
    if (galleryDragScrollPin) return;
    const galleryEl = document.getElementById('gallery');
    if (!galleryEl) return;
    const blockSize = galleryEl.getBoundingClientRect().height;
    if (!(blockSize > 0)) return;
    // getGalleryScrollRoots: public/scripts/comp/galleryView.js
    const { galleryContainer, isContainerScroll } = getGalleryScrollRoots();
    const scrollEl = (isContainerScroll && galleryContainer)
        ? galleryContainer
        : (document.scrollingElement || document.documentElement);
    galleryEl.style.setProperty('--gallery-drag-block-size', Math.ceil(blockSize) + 'px');
    galleryDragScrollPin = {
        galleryEl,
        scrollEl,
        scrollTop: scrollEl.scrollTop,
        prevOverflowAnchor: scrollEl.style.overflowAnchor
    };
    scrollEl.style.overflowAnchor = 'none';
}

function applyPinnedGalleryScroll(pin) {
    if (!pin || !pin.scrollEl || !pin.scrollEl.isConnected) return;
    if (pin.scrollEl.scrollTop !== pin.scrollTop) {
        pin.scrollEl.scrollTop = pin.scrollTop;
    }
}

function releaseGalleryScrollAfterWindowDrag() {
    const pin = galleryDragScrollPin;
    galleryDragScrollPin = null;
    if (!pin) return;
    applyPinnedGalleryScroll(pin);
    if (pin.galleryEl) {
        pin.galleryEl.style.removeProperty('--gallery-drag-block-size');
    }
    if (!pin.scrollEl || !pin.scrollEl.isConnected) return;
    pin.scrollEl.style.overflowAnchor = pin.prevOverflowAnchor || '';
    applyPinnedGalleryScroll(pin);
}

function setWindowInteractionPaintLock(on) {
    if (on) {
        pinGalleryScrollForWindowDrag();
    } else {
        applyPinnedGalleryScroll(galleryDragScrollPin);
    }
    document.body.classList.toggle('is-window-dragging', !!on);
    if (!on) {
        releaseGalleryScrollAfterWindowDrag();
        // updateVirtualScroll: public/scripts/comp/galleryView.js
        updateVirtualScroll();
    }
}

function endModalInteractionSession() {
    const session = activeModalInteraction;
    flushModalInteractionVisual();
    if (session && session.modal) {
        clearModalDragTransform(session.modal);
    }
    activeModalInteraction = null;
    setWindowInteractionPaintLock(false);
    detachModalInteractionMoveListeners();
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
    const left = roundCssPixel(clamped.left);
    const top = roundCssPixel(clamped.top);

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
    const unclamped = options.skipClamp === true;
    const clamped = unclamped ? { left, top } : clampModalViewportRect(left, top, width, height, null, restoreClamp);
    left = clamped.left;
    top = clamped.top;
    const trueInsetTop = getModalTrueInsetTop();

    if (isModalTopAnchored(modal)) {
        const centerX = left + width / 2;
        let offsetX = centerX - window.innerWidth / 2;
        let offsetY = top - trueInsetTop;
        if (options.allowPartialBottomOverflow || unclamped) {
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

    if (options.allowPartialBottomOverflow || unclamped) {
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
        // every id-less window maps to 'unknown': one shared rect would size them all
        if (!modal.id && modalType === 'unknown') return null;
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
        // A drag that restored a maximized window owns the position until it ends (#440)
        if (modal.hasAttribute('data-dragging') || modal.hasAttribute('data-resizing')) {
            return;
        }
        // The maximize / restore morph scales the box; measure once it has landed (#441).
        // Only while it is still running: `finished` resolves before onfinish clears
        // _rectMorph, and re-chaining on a resolved promise spins the microtask queue forever.
        const morph = modal._rectMorph;
        if (morph && morph.playState === 'running') {
            morph.finished.then(() => {
                if (modal._rectMorph === morph) modal._rectMorph = null;
                applyClamp();
            }, () => {});
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
/**
 * Vista taskbar alert (#443): a window that wants attention flashes its taskbar button amber,
 * then stays amber until it is brought to the front. No-op for a hidden window or the
 * window already in front of a focused page.
 */
function requestWindowAttention(modalId) {
    const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (!modal || !modal.classList.contains('modal') || modal.classList.contains('hidden')) return false;
    const inFront = modal.classList.contains('active-window') && !modal.classList.contains('minimised');
    if (inFront && document.hasFocus()) return false;
    if (modal.dataset.windowAttention === 'true') return true;
    modal.dataset.windowAttention = 'true';
    debouncedUpdateTaskbarWindows();
    return true;
}

function clearWindowAttention(modalId) {
    const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
    if (!modal || modal.dataset.windowAttention !== 'true') return;
    delete modal.dataset.windowAttention;
    debouncedUpdateTaskbarWindows();
}

window.requestWindowAttention = requestWindowAttention;
window.clearWindowAttention = clearWindowAttention;

function setActiveWindow(modalId) {
    if (modalId) {
        const modal = typeof modalId === 'string' ? document.getElementById(modalId) : modalId;
        // Bringing a window to the front answers its taskbar alert
        if (modal && modal.dataset && modal.dataset.windowAttention === 'true') {
            clearWindowAttention(modal);
        }
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
                if (m.id === 'windowsStartupModal' || m.id === 'connectionDialModal') return;
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
    // mousedown/touchstart — drag/resize start (below); desktop-mode gesture (down≠focus)
    // click — minimize button, desktop empty-space clear-active (below)
    // dblclick — caption band maximize / restore / minimize (handleModalCaptionDoubleClick)
    // contextMenuAction — taskbar context menu (initializeDesktopTaskbar)
    // DOMContentLoaded — bootstrap dragging, taskbar, start menu (bottom of modalUtils.js)
    // Gallery window resize — attachModalListeners(galleryWindow) in activateGalleryResizeListener
    // Start menu outside-click — AbortController in openStartMenu/closeStartMenu

    // Start only — move/end listeners attach for the active drag/resize session
    // Desktop-mode pointer: down starts the shared gesture (no focus); up may activate
    document.addEventListener('mousedown', handleModalInteraction);
    document.addEventListener('touchstart', handleModalInteraction, { passive: false });

    // Caption double-click: maximize / restore, or minimize without a maximize box (#440)
    document.addEventListener('dblclick', handleModalCaptionDoubleClick);

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

            // CURSOR: macOS down≠focus / up=focus — skip empty-desktop defocus after select/drag/move
            if (wasDesktopPointerFocusBlocked()) return;

            // Clear active window (make no window active)
            setActiveWindow(null);
        }
    });
}

function handleModalInteraction(e) {
    if (e.type === 'mousedown' || e.type === 'touchstart') {
        // CURSOR: macOS down≠focus — begin gesture only; do not setActiveWindow here
        if (isDesktopPointerMode()) {
            beginDesktopPointerGesture(e);
        }
        if (handleModalDragStart(e) || handleModalResizeStart(e)) {
            attachModalInteractionMoveListeners();
        }
        return;
    }
    if (e.type === 'mousemove' || e.type === 'touchmove') {
        const session = activeModalInteraction;
        if (!session) return;
        if (session.type === 'drag') {
            handleModalDrag(e, session.modal);
        } else if (session.type === 'resize') {
            handleModalResize(e, session.modal);
        }
    }
}

function handleModalInteractionEnd(e) {
    const session = activeModalInteraction;
    if (!session) {
        detachModalInteractionMoveListeners();
        return;
    }
    if (session.type === 'drag') {
        handleModalDragEnd(e, session.modal);
    } else if (session.type === 'resize') {
        handleModalResizeEnd(e, session.modal);
    }
    detachModalInteractionMoveListeners();
}

function handleModalDragStart(e) {
    // Check if clicked element is the caption band of a modal title bar
    const titleBar = getModalCaptionBandTitleBar(e);
    if (!titleBar) return;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const modal = titleBar.closest('.modal');
    if (!modal) return;

    // Do not allow dragging manual modal if not windowed (i.e. not in desktop mode)
    if (modal.id === 'manualModal' && !modal.classList.contains('windowed')) {
        return;
    }

    // Prevent dragging if modal is hidden or animating
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt') || modal.classList.contains('opening') || modal.classList.contains('closing')) {
        return;
    }

    e.preventDefault();
    finishModalRectMorph(modal);

    if (activeModalInteraction) {
        endModalInteractionSession();
    }

    // A maximized window stays maximized until the pointer moves (a double-click must not restore it twice)
    const pendingMaximizeRestore = isModalMaximized(modal);
    const pixelAnchored = !pendingMaximizeRestore && anchorModalForPixelDrag(modal);

    // Get coordinates from touch or mouse event
    const clientX = e.touches ? e.touches[0].clientX : e.clientX;

    // Keep attributes for non-hot-path readers (backdrop, layout refresh, virtual keyboard)
    modal.setAttribute('data-dragging', 'true');
    setWindowInteractionPaintLock(true);
    modal.setAttribute('data-drag-start-x', clientX);
    modal.setAttribute('data-drag-start-y', clientY);

    const computedStyle = getComputedStyle(modal);
    const modalStartOffsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const modalStartOffsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');

    modal.setAttribute('data-modal-start-offset-x', modalStartOffsetX);
    modal.setAttribute('data-modal-start-offset-y', modalStartOffsetY);

    const modalRect = modal.getBoundingClientRect();
    const origin = pixelAnchored
        ? readModalPixelDragOrigin(modal, modalRect)
        : { left: roundCssPixel(modalRect.left), top: roundCssPixel(modalRect.top) };
    modalTrueInsetCacheValid = false;
    const trueInsetTop = getModalTrueInsetTop();
    const livePreview = isLiveWindowRepositioningEnabled();

    activeModalInteraction = {
        type: 'drag',
        modal,
        livePreview,
        pixelAnchored,
        startLeft: origin.left,
        startTop: origin.top,
        dragX: 0,
        dragY: 0,
        appliedDragX: 0,
        appliedDragY: 0,
        trueInsetTop,
        workArea: computeModalWorkAreaBounds(trueInsetTop),
        desktopTopBias: getDesktopModalTopBias(),
        containerWidth: window.innerWidth,
        containerHeight: window.innerHeight,
        topAnchored: isModalTopAnchored(modal),
        startX: clientX,
        startY: clientY,
        startOffsetX: modalStartOffsetX,
        startOffsetY: modalStartOffsetY,
        width: modalRect.width,
        height: modalRect.height,
        previewOffsetX: modalStartOffsetX,
        previewOffsetY: modalStartOffsetY,
        moved: modal.hasAttribute('data-modal-moved'),
        pendingMaximizeRestore,
        rafId: 0,
        pendingVisual: null
    };

    titleBar.classList.add('dragging');

    if (livePreview && !pendingMaximizeRestore) {
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

/**
 * Vista: dragging a maximized caption restores the window under the pointer, keeping the
 * pointer at the same fraction of the caption width, then the drag carries on from there.
 */
function restoreMaximizedModalUnderPointer(session, clientX, clientY) {
    const modal = session.modal;
    session.pendingMaximizeRestore = false;
    const maxRect = modal.getBoundingClientRect();
    const relX = maxRect.width > 0 ? Math.min(1, Math.max(0, (session.startX - maxRect.left) / maxRect.width)) : 0.5;
    const grabY = Math.max(0, session.startY - maxRect.top);

    restoreModalFromMaximize(modal);
    const restored = modal.getBoundingClientRect();
    setModalPositionFromViewportRect(modal, {
        left: clientX - relX * restored.width,
        top: clientY - grabY,
        width: restored.width,
        height: restored.height
    }, { allowPartialBottomOverflow: true });
    session.pixelAnchored = anchorModalForPixelDrag(modal);

    const computedStyle = getComputedStyle(modal);
    const offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');
    const rect = modal.getBoundingClientRect();
    const origin = session.pixelAnchored
        ? readModalPixelDragOrigin(modal, rect)
        : { left: roundCssPixel(rect.left), top: roundCssPixel(rect.top) };
    session.startLeft = origin.left;
    session.startTop = origin.top;
    session.dragX = 0;
    session.dragY = 0;
    session.appliedDragX = 0;
    session.appliedDragY = 0;
    session.startX = clientX;
    session.startY = clientY;
    session.startOffsetX = offsetX;
    session.startOffsetY = offsetY;
    session.previewOffsetX = offsetX;
    session.previewOffsetY = offsetY;
    session.width = rect.width;
    session.height = rect.height;
    session.topAnchored = isModalTopAnchored(modal);
    modal.setAttribute('data-drag-start-x', clientX);
    modal.setAttribute('data-drag-start-y', clientY);
    modal.setAttribute('data-modal-start-offset-x', offsetX);
    modal.setAttribute('data-modal-start-offset-y', offsetY);
    if (session.livePreview) {
        showWindowFrameForModal(modal);
    }
}

function handleModalDrag(e, draggedModal) {
    const session = activeModalInteraction;
    if (!session || session.type !== 'drag' || session.modal !== draggedModal) return;

    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    if (session.pendingMaximizeRestore) {
        if (Math.hypot(clientX - session.startX, clientY - session.startY) < MAXIMIZED_DRAG_RESTORE_THRESHOLD_PX) {
            return;
        }
        restoreMaximizedModalUnderPointer(session, clientX, clientY);
    }

    let newOffsetX = session.startOffsetX + (clientX - session.startX);
    let newOffsetY = session.startOffsetY + (clientY - session.startY);

    if (!session.moved) {
        session.moved = true;
        draggedModal.setAttribute('data-modal-moved', 'true');
        updateBackdropVisibility();
    }

    const clamped = session.topAnchored
        ? clampModalOffsetsForTopAnchor(newOffsetX, newOffsetY, session.width, session.height, { allowOffscreen: true })
        : clampModalOffsetsForRect(newOffsetX, newOffsetY, session.width, session.height, { allowOffscreen: true });
    session.previewOffsetX = clamped.offsetX;
    session.previewOffsetY = clamped.offsetY;

    // Whole-pixel move only; offsets commit on mouseup. Subpixel pointer moves that round to
    // the same pixel (high-DPI, high-poll mice, a clamped edge) schedule nothing.
    const dragX = roundCssPixel(clamped.offsetX - session.startOffsetX);
    const dragY = roundCssPixel(clamped.offsetY - session.startOffsetY);
    session.dragX = dragX;
    session.dragY = dragY;
    if (!session.rafId && (dragX !== session.appliedDragX || dragY !== session.appliedDragY)) {
        session.rafId = requestAnimationFrame(applyModalDragFrame);
    }
}

/**
 * Drag release on the pixel anchor: the window stays on the whole pixel the last frame put it
 * on, and the offsets are rebuilt from that rect (revertModalToOffsetAnchor maths).
 */
function commitPixelAnchoredModalDrag(session) {
    const modal = session.modal;
    const left = session.startLeft + session.dragX;
    const top = session.startTop + session.dragY;
    const offsetX = (left + session.width / 2) - (session.containerWidth / 2);
    const offsetY = session.topAnchored
        ? top - session.trueInsetTop
        : (top + session.height / 2) - (session.containerHeight / 2) - (0.5 * session.trueInsetTop) + session.desktopTopBias;

    if (session.livePreview) {
        hideWindowFrame();
        modal.removeAttribute('data-preview-offset-x');
        modal.removeAttribute('data-preview-offset-y');
    }

    activeModalInteraction = null;
    modal.style.setProperty('--modal-offset-x', `${roundCssOffset(offsetX)}px`);
    modal.style.setProperty('--modal-offset-y', `${roundCssOffset(offsetY)}px`);
    modal.style.setProperty('--modal-pixel-left', `${left}px`);
    modal.style.setProperty('--modal-pixel-top', `${top}px`);
    clearModalDragTransform(modal);
    modal.removeAttribute('data-dragging');
    setWindowInteractionPaintLock(false);
    modal.removeAttribute('data-drag-start-x');
    modal.removeAttribute('data-drag-start-y');
    modal.removeAttribute('data-modal-start-offset-x');
    modal.removeAttribute('data-modal-start-offset-y');
    // Geometry edges + frosted origin for the new spot
    settleModalPixelAnchor(modal);

    updateBackdropVisibility();
    saveModalPositionAfterDrag(modal);
}

function saveModalPositionAfterDrag(modal) {
    const isTransient = modal.classList.contains('transient');
    if (windowRestoresPosition(modal)
        && (!isTransient || (modal.dataset.windowIdentifier && transientWindowsWithPositions.has(modal.dataset.windowIdentifier)))
        && !modal.classList.contains('modal-maximized')) {
        debouncedSaveWindowPositions();
    }
}

function handleModalDragEnd(e, draggedModal) {
    if (!draggedModal) return;

    const session = (activeModalInteraction && activeModalInteraction.modal === draggedModal)
        ? activeModalInteraction
        : null;

    flushModalInteractionVisual();

    const titleBar = draggedModal.querySelector('.modal-window-title');
    if (titleBar) {
        titleBar.classList.remove('dragging');
    }

    // Press and release on a maximized caption without moving: nothing to commit
    if (session && session.pendingMaximizeRestore) {
        activeModalInteraction = null;
        clearModalDragTransform(draggedModal);
        draggedModal.removeAttribute('data-dragging');
        setWindowInteractionPaintLock(false);
        draggedModal.removeAttribute('data-drag-start-x');
        draggedModal.removeAttribute('data-drag-start-y');
        draggedModal.removeAttribute('data-modal-start-offset-x');
        draggedModal.removeAttribute('data-modal-start-offset-y');
        updateBackdropVisibility();
        return;
    }

    if (session && session.pixelAnchored) {
        commitPixelAnchoredModalDrag(session);
        return;
    }

    let offsetX;
    let offsetY;
    const livePreview = session ? session.livePreview : isLiveWindowRepositioningEnabled();
    if (livePreview) {
        offsetX = session ? session.previewOffsetX : NaN;
        offsetY = session ? session.previewOffsetY : NaN;
        if (!Number.isFinite(offsetX) || !Number.isFinite(offsetY)) {
            const computedStyle = getComputedStyle(draggedModal);
            offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
            offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');
        }
        hideWindowFrame();
        draggedModal.removeAttribute('data-preview-offset-x');
        draggedModal.removeAttribute('data-preview-offset-y');
    } else if (session && Number.isFinite(session.previewOffsetX) && Number.isFinite(session.previewOffsetY)) {
        offsetX = session.previewOffsetX;
        offsetY = session.previewOffsetY;
    } else {
        const computedStyle = getComputedStyle(draggedModal);
        offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
        offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');
    }

    // Commit offsets while drag transform is still applied, then drop the translate
    // so the window does not jump back to the pre-drag position for a frame.
    activeModalInteraction = null;
    setModalOffsetPx(draggedModal, offsetX, offsetY, { snap: false, settle: false });
    clearModalDragTransform(draggedModal);
    draggedModal.removeAttribute('data-dragging');
    setWindowInteractionPaintLock(false);
    draggedModal.removeAttribute('data-drag-start-x');
    draggedModal.removeAttribute('data-drag-start-y');
    draggedModal.removeAttribute('data-modal-start-offset-x');
    draggedModal.removeAttribute('data-modal-start-offset-y');
    setModalOffsetPx(draggedModal, offsetX, offsetY, { snap: true, settle: true });

    updateBackdropVisibility();
    saveModalPositionAfterDrag(draggedModal);
}

function handleModalResizeStart(e) {
    // Check if clicked element is a resize handle
    const resizeHandle = e.target.closest('.resize-handle');
    if (!resizeHandle) return false;

    const modal = resizeHandle.closest('.modal');
    if (!modal) return false;

    // Do not allow resizing manual modal if not windowed (i.e. not in desktop mode)
    if (modal.id === 'manualModal' && !modal.classList.contains('windowed')) {
        return false;
    }

    // Prevent resizing if modal is hidden or animating
    if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt') || modal.classList.contains('opening') || modal.classList.contains('closing')) {
        return false;
    }

    e.preventDefault();
    finishModalRectMorph(modal);

    if (activeModalInteraction) {
        endModalInteractionSession();
    }

    prepareModalForDragOrResize(modal);

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    modal.setAttribute('data-resizing', 'true');
    setWindowInteractionPaintLock(true);
    modal.setAttribute('data-resize-start-x', clientX);
    modal.setAttribute('data-resize-start-y', clientY);

    const modalRect = modal.getBoundingClientRect();
    modal.setAttribute('data-resize-start-width', modalRect.width);
    modal.setAttribute('data-resize-start-height', modalRect.height);
    modal.setAttribute('data-resize-start-left', modalRect.left);
    modal.setAttribute('data-resize-start-top', modalRect.top);

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

    const livePreview = isLiveWindowRepositioningEnabled();
    modalTrueInsetCacheValid = false;
    const trueInsetTop = getModalTrueInsetTop();
    const maxWidth = modal.dataset.windowMaxWidth ? parseInt(modal.dataset.windowMaxWidth, 10) : Infinity;
    const maxHeight = modal.dataset.windowMaxHeight ? parseInt(modal.dataset.windowMaxHeight, 10) : Infinity;
    const minWidth = modal.dataset.windowMinWidth ? parseInt(modal.dataset.windowMinWidth, 10) : 200;
    const minHeight = modal.dataset.windowMinHeight ? parseInt(modal.dataset.windowMinHeight, 10) : 150;

    activeModalInteraction = {
        type: 'resize',
        modal,
        livePreview,
        trueInsetTop,
        workArea: computeModalWorkAreaBounds(trueInsetTop),
        desktopTopBias: getDesktopModalTopBias(),
        containerWidth: window.innerWidth,
        containerHeight: window.innerHeight,
        topAnchoredResize: isModalResizeTopAnchored(modal),
        startX: clientX,
        startY: clientY,
        startWidth: modalRect.width,
        startHeight: modalRect.height,
        startLeft: modalRect.left,
        startTop: modalRect.top,
        direction: resizeDirection,
        minWidth,
        minHeight,
        maxWidth,
        maxHeight,
        previewWidth: modalRect.width,
        previewHeight: modalRect.height,
        previewLeft: modalRect.left,
        previewTop: modalRect.top,
        shouldUpdatePosition: false,
        rafId: 0,
        pendingVisual: null
    };

    if (livePreview) {
        showWindowFrameForModal(modal);
    }

    const isBlocked = modal.id === 'manualModal' && !modal.classList.contains('windowed');
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isBlocked;

    if (isMoveable) {
        bringModalToFront(modal);
    }

    updateBackdropVisibility();

    return true;
}

function handleModalResize(e, resizedModal) {
    const session = activeModalInteraction;
    if (!session || session.type !== 'resize' || session.modal !== resizedModal) return;

    e.preventDefault();

    const clientX = e.touches ? e.touches[0].clientX : e.clientX;
    const clientY = e.touches ? e.touches[0].clientY : e.clientY;

    const deltaX = clientX - session.startX;
    const deltaY = clientY - session.startY;
    const resizeDirection = session.direction;

    let newWidth = session.startWidth;
    let newHeight = session.startHeight;
    let newLeft = session.startLeft;
    let newTop = session.startTop;
    let shouldUpdatePosition = false;

    // OS-like resizing: opposite edge/corner stays fixed
    if (resizeDirection.includes('w')) {
        const widthChange = -deltaX;
        newWidth = Math.max(session.minWidth, session.startWidth + widthChange);
        newLeft = session.startLeft + (session.startWidth - newWidth);
        shouldUpdatePosition = true;
    } else if (resizeDirection.includes('e')) {
        newWidth = Math.max(session.minWidth, session.startWidth + deltaX);
        newLeft = session.startLeft;
        shouldUpdatePosition = true;
    }

    if (resizeDirection.includes('n')) {
        const heightChange = -deltaY;
        newHeight = Math.max(session.minHeight, session.startHeight + heightChange);
        newTop = session.startTop + (session.startHeight - newHeight);
        shouldUpdatePosition = true;
    } else if (resizeDirection.includes('s')) {
        newHeight = Math.max(session.minHeight, session.startHeight + deltaY);
        newTop = session.startTop;
        shouldUpdatePosition = true;
    }

    newWidth = Math.max(session.minWidth, Math.min(newWidth, session.maxWidth));
    newHeight = Math.max(session.minHeight, Math.min(newHeight, session.maxHeight));

    const workArea = session.workArea;
    if (resizeDirection.includes('e') && !resizeDirection.includes('w')) {
        newWidth = Math.min(newWidth, workArea.right - session.startLeft);
    }
    if (resizeDirection.includes('w') && !resizeDirection.includes('e')) {
        const maxWidthFromWorkArea = session.startLeft + session.startWidth - workArea.left;
        newWidth = Math.min(newWidth, maxWidthFromWorkArea);
        newLeft = session.startLeft + session.startWidth - newWidth;
    }
    if (resizeDirection.includes('s') && !resizeDirection.includes('n')) {
        newHeight = Math.min(newHeight, workArea.bottom - session.startTop);
    }
    if (resizeDirection.includes('n') && !resizeDirection.includes('s')) {
        const maxHeightFromWorkArea = session.startTop + session.startHeight - workArea.top;
        newHeight = Math.min(newHeight, maxHeightFromWorkArea);
        newTop = session.startTop + session.startHeight - newHeight;
    }

    // Aspect-locked windows (the Vista games: VistaGames.constrainResize,
    // public/scripts/comp/desktop-apps/vista-games/vistaGameEngine.js) fit the box inside the work area
    if (typeof resizedModal.windowResizeConstrain === 'function') {
        const fixed = resizedModal.windowResizeConstrain(newWidth, newHeight, resizeDirection, {
            width: resizeDirection.includes('w') ? session.startLeft + session.startWidth - workArea.left : workArea.right - session.startLeft,
            height: resizeDirection.includes('n') ? session.startTop + session.startHeight - workArea.top : workArea.bottom - session.startTop
        });
        newWidth = fixed.width;
        newHeight = fixed.height;
        if (resizeDirection.includes('w')) newLeft = session.startLeft + session.startWidth - newWidth;
        if (resizeDirection.includes('n')) newTop = session.startTop + session.startHeight - newHeight;
        shouldUpdatePosition = true;
    }

    newWidth = Math.max(session.minWidth, roundCssPixel(newWidth));
    newHeight = Math.max(session.minHeight, roundCssPixel(newHeight));

    let previewLeft = newLeft;
    let previewTop = newTop;
    if (session.topAnchoredResize) {
        previewTop = session.startTop;
        previewLeft = resizeDirection.includes('w')
            ? session.startLeft + session.startWidth - newWidth
            : session.startLeft;
    }

    session.previewWidth = newWidth;
    session.previewHeight = newHeight;
    session.previewLeft = previewLeft;
    session.previewTop = previewTop;
    session.shouldUpdatePosition = shouldUpdatePosition;

    if (session.livePreview) {
        scheduleModalInteractionVisual(() => {
            const s = activeModalInteraction;
            if (!s || s.type !== 'resize') return;
            updateWindowFrameRect({
                left: s.previewLeft,
                top: s.previewTop,
                width: s.previewWidth,
                height: s.previewHeight
            });
        });
        return;
    }

    scheduleModalInteractionVisual(() => {
        const s = activeModalInteraction;
        if (!s || s.type !== 'resize') return;
        s.modal.style.width = `${s.previewWidth}px`;
        s.modal.style.height = `${s.previewHeight}px`;

        if (s.topAnchoredResize) {
            const offsetX = (s.previewLeft + s.previewWidth / 2) - (s.containerWidth / 2);
            const offsetY = s.previewTop - s.trueInsetTop;
            const clamped = clampModalOffsetsForTopAnchor(offsetX, offsetY, s.previewWidth, s.previewHeight);
            setModalOffsetPx(s.modal, clamped.offsetX, clamped.offsetY, { snap: false, settle: false });
            return;
        }

        if (s.shouldUpdatePosition) {
            const offsetX = (s.previewLeft + s.previewWidth / 2) - (s.containerWidth / 2);
            const offsetY = (s.previewTop + s.previewHeight / 2) - (s.containerHeight / 2) - (0.5 * s.trueInsetTop) + s.desktopTopBias;
            const clamped = clampModalOffsetsForRect(offsetX, offsetY, s.previewWidth, s.previewHeight);
            setModalOffsetPx(s.modal, clamped.offsetX, clamped.offsetY, { snap: false, settle: false });
        }
    });
}

function handleModalResizeEnd(e, resizedModal) {
    if (!resizedModal) return;

    const session = (activeModalInteraction && activeModalInteraction.modal === resizedModal)
        ? activeModalInteraction
        : null;

    flushModalInteractionVisual();

    const livePreview = session ? session.livePreview : isLiveWindowRepositioningEnabled();
    if (livePreview) {
        const previewWidth = session ? session.previewWidth : NaN;
        const previewHeight = session ? session.previewHeight : NaN;
        const previewLeft = session ? session.previewLeft : NaN;
        const previewTop = session ? session.previewTop : NaN;
        const topAnchoredResize = session ? session.topAnchoredResize : isModalResizeTopAnchored(resizedModal);

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
                const trueInsetTop = session ? session.trueInsetTop : getModalTrueInsetTop();
                const desktopTopBias = session ? session.desktopTopBias : getDesktopModalTopBias();
                const containerWidth = session ? session.containerWidth : window.innerWidth;
                const containerHeight = session ? session.containerHeight : window.innerHeight;
                const offsetX = (previewLeft + previewWidth / 2) - (containerWidth / 2);
                const offsetY = (previewTop + previewHeight / 2) - (containerHeight / 2) - (0.5 * trueInsetTop) + desktopTopBias;
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

    activeModalInteraction = null;

    const computedStyle = getComputedStyle(resizedModal);
    const offsetX = parseFloat(computedStyle.getPropertyValue('--modal-offset-x') || '0');
    const offsetY = parseFloat(computedStyle.getPropertyValue('--modal-offset-y') || '0');
    setModalOffsetPx(resizedModal, offsetX, offsetY, { snap: true, settle: true });

    updateBackdropVisibility();

    resizedModal.removeAttribute('data-resizing');
    setWindowInteractionPaintLock(false);
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

    const isTransient = resizedModal.classList.contains('transient');
    if ((windowRestoresPosition(resizedModal) || windowRestoresSize(resizedModal))
        && (!isTransient || (resizedModal.dataset.windowIdentifier && transientWindowsWithPositions.has(resizedModal.dataset.windowIdentifier)))
        && !resizedModal.classList.contains('modal-maximized')) {
        debouncedSaveWindowPositions();
    }
}

function openModal(modal) {
    if (!modal) return;
    // State-flag classes (e.g. .window-has-caption = the Vista frame inset) before anything measures it
    window.syncRootStateFlags?.(modal);
    ensureModalApplicationIcon(modal);
    // Start decoding this window's art if no launcher warmed it yet (assetPreload.js, Yozora #518)
    if (modal.id && window.assetPreload && assetPreload.warmWindow) assetPreload.warmWindow(modal.id);

    // Check if modal is already open (not hidden and not hidden-alt)
    const isAlreadyOpen = !modal.classList.contains('hidden') && !modal.classList.contains('hidden-alt');
    // Manual modal is blocked from stacking only when not windowed AND not in desktop-mode
    // In desktop-mode, it should be part of the window stack even when maximized
    const isBlocked = modal.id === 'manualModal' && !modal.classList.contains('windowed') && !window.isDesktop;
    const hasTitleBar = modal.querySelector('.modal-window-title') !== null;
    const isMoveable = hasTitleBar && !isBlocked;

    const underTop = mcpLaunchKeepsTopWindow() && getTopOpenModal() && getTopOpenModal() !== modal;

    if (isAlreadyOpen) {
        // Already open: a user click brings it forward. An MCP launch leaves the top window alone.
        if (isMoveable && !underTop) {
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

    // Assign z-index to modal (newly opened modals go on top) - but only for moveable modals.
    // MCP launches insert under the current top window instead of taking focus.
    if (isMoveable) {
        assignModalZIndex(modal, underTop ? { underTop: true } : undefined);
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
    if (window.aeroGlass) {
        // Frosted frame origin before the open animation scales the box (aeroGlass.js)
        window.aeroGlass.syncModal(modal);
    }

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
        handleModalActivatePointer(e, modal);
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

    // prepareGalleryWindowContent: public/scripts/comp/galleryImagesLoad.js (the promise is kept for
    // showGalleryWindow, which holds the Workspaces splash until the content is ready)
    if (modal.id === 'galleryWindow' && modal.classList.contains('windowed')
        && typeof prepareGalleryWindowContent === 'function') {
        galleryWindowPreparePromise = prepareGalleryWindowContent().catch((err) => {
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
        // Window may be hidden before the 10s debounce fires — commit last normal
        // geometry now so a later flush cannot drop or overwrite with work-area bounds
        if (isModalMaximized(modal) && modal._preMaximizeLayout) {
            commitModalLayoutToWindowPositions(modal, modal._preMaximizeLayout);
        }
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
        if (activeModalInteraction && activeModalInteraction.modal === modal) {
            hideWindowFrame();
            endModalInteractionSession();
        }
        // Reset modal position offsets (persistable windows restore size/position from saved data on reopen)
        if (!shouldPersistWindowPosition(modal)) {
            clearModalPixelAnchor(modal);
            clearModalDragTransform(modal);
            modal.style.removeProperty('--modal-offset-x');
            modal.style.removeProperty('--modal-offset-y');
            modal.style.removeProperty('width');
            modal.style.removeProperty('height');
        } else {
            // Drop pixel-settled so reopen applies saved offsets/rect instead of stale pixel vars
            clearModalPixelAnchor(modal);
            clearModalDragTransform(modal);
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
function assignModalZIndex(modal, options) {
    const underTop = !!(options && options.underTop);
    // Add modal to the top of the stack if not already there
    const modalIndex = modalStack.indexOf(modal);
    if (modalIndex !== -1) {
        // Modal already in stack, remove it first
        modalStack.splice(modalIndex, 1);
    }
    if (underTop && modalStack.length) {
        modalStack.splice(modalStack.length - 1, 0, modal);
        updateModalStackZIndexes({ skipActiveWindow: true });
        return;
    }
    // Add to top of stack (end of array)
    modalStack.push(modal);

    // Reassign z-indexes to all modals in the stack
    updateModalStackZIndexes();

    setActiveWindow(modal);
}

function getModalStackGroupMaxZIndex(isOnTop, excludeModal) {
    const base = isOnTop ? MODAL_Z_ON_TOP_BASE : MODAL_Z_BASE;
    let maxZ = base - MODAL_Z_INCREMENT;
    for (let i = 0; i < modalStack.length; i++) {
        const m = modalStack[i];
        if (!m || m === excludeModal) continue;
        if (m.classList.contains('on-top') !== isOnTop) continue;
        const z = parseInt(m.style.zIndex, 10);
        if (Number.isFinite(z) && z > maxZ) {
            maxZ = z;
        }
    }
    return maxZ;
}

/** Bump one modal above its tier peers without rewriting every window's z-index. */
function bumpModalZIndexToFront(modal) {
    const isOnTop = modal.classList.contains('on-top');
    const base = isOnTop ? MODAL_Z_ON_TOP_BASE : MODAL_Z_BASE;
    const maxZ = getModalStackGroupMaxZIndex(isOnTop, modal);
    if (maxZ >= base + (MODAL_Z_INCREMENT * MODAL_Z_COMPACT_LAYER_LIMIT)) {
        updateModalStackZIndexes({ skipActiveWindow: true });
        return;
    }

    const zIndex = maxZ + MODAL_Z_INCREMENT;
    modal.setAttribute('data-modal-z-index', String(zIndex));
    modal.setAttribute('data-modal-stack-position', String(modalStack.length));
    modal.style.zIndex = zIndex;
    if (isOnTop) {
        modal.classList.add('active-window');
    }
}

function bringModalToFront(modal) {
    if (!modal) return;

    const modalIndex = modalStack.indexOf(modal);
    // Already top of stack — only refresh active/taskbar state
    if (modalIndex !== -1 && modalIndex === modalStack.length - 1) {
        setActiveWindow(modal);
        updateTaskbarActiveStates();
        return;
    }

    if (modalIndex !== -1) {
        modalStack.splice(modalIndex, 1);
    }
    modalStack.push(modal);
    bumpModalZIndexToFront(modal);

    setActiveWindow(modal);

    // Update taskbar active states only (lightweight, no DOM recreation)
    updateTaskbarActiveStates();
}

function updateModalStackZIndexes(options) {
    const opts = options || {};
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

    if (opts.skipActiveWindow) {
        return;
    }

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
    // CURSOR: macOS down≠focus / up=focus — callers in desktop mode must go through finishDesktopPointerGesture
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
    const interactionModal = activeModalInteraction ? activeModalInteraction.modal : null;
    const draggedModal = interactionModal && interactionModal.hasAttribute('data-dragging')
        ? interactionModal
        : null;
    const resizedModal = interactionModal && interactionModal.hasAttribute('data-resizing')
        ? interactionModal
        : null;
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
                handleModalActivatePointer(e, galleryWindow);
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
    if (isModalMaximized(galleryWindow) && galleryWindow._preMaximizeLayout) {
        commitModalLayoutToWindowPositions(galleryWindow, galleryWindow._preMaximizeLayout);
    }
    debouncedSaveWindowPositions();

    await closeModal(galleryWindow);

    // hideGalleryProgressModal: public/scripts/comp/galleryView.js
    hideGalleryProgressModal();

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
// The last prepareGalleryWindowContent() run started by openModal(galleryWindow)
let galleryWindowPreparePromise = null;

function showGalleryWindow() {
    if (!galleryWindow || !galleryWindow.classList.contains('windowed')) {
        return;
    }

    // Opening from closed (not from the taskbar's minimised state): the Workspaces splash (#468,
    // workspaceSplash: public/scripts/comp/appSplash.js) stays up at least 3 s and 1.5 s past the
    // content being ready; while it is up the gallery load progress draws in its corner.
    const splash = isGalleryWindowHidden() && workspaceSplash.show('Opening Workspaces...');
    galleryWindowPreparePromise = null;
    // The window opens under the splash and shows when the splash closes (appSplash.js holdWindow)
    if (splash) workspaceSplash.holdWindow(galleryWindow);

    // Mark gallery as visible (openModal restores saved size/position and prepares content)
    openModal(galleryWindow);
    ensureModalEdgesWithinWorkArea(galleryWindow);

    if (splash) {
        // The splash stays until the rows in view show their previews, not their BlurHash
        // (galleryVisiblePreviewsReady: public/scripts/comp/galleryView.js), at most 10 s
        const prepared = Promise.resolve(galleryWindowPreparePromise).catch(() => {});
        workspaceSplash.waitFor(prepared.then(() => waitForGalleryVisiblePreviews(10000)), 10000);
        prepared.then(() => workspaceSplash.hide());
    }

    console.log('Gallery shown in desktop mode');
}

/** Resolves once galleryVisiblePreviewsReady() holds, checked every 100 ms. Gives up after
 *  timeoutMs or once the window is closed or minimised, so the poll never outlives the splash. */
function waitForGalleryVisiblePreviews(timeoutMs = 10000) {
    const deadline = Date.now() + timeoutMs;
    return new Promise((resolve) => {
        const check = () => {
            if (typeof galleryVisiblePreviewsReady !== 'function' || galleryVisiblePreviewsReady()
                || Date.now() >= deadline || isGalleryWindowHidden() || galleryWindow.classList.contains('minimised')) {
                resolve();
                return;
            }
            setTimeout(check, 100);
        };
        check();
    });
}

// Check if gallery is hidden in desktop mode (for function inhibition)
// Gallery update functions use this to skip updates when gallery is hidden
// Similar to how they check for manual modal open state
function isGalleryWindowHidden() {
    return galleryWindow && galleryWindow.classList.contains('hidden') && galleryWindow.classList.contains('windowed');
}

function isGalleryForeground() {
    if (isGalleryWindowHidden()) return false;
    if (document.body.classList.contains('is-window-dragging')) return false;
    if (!manualModal.classList.contains('hidden') && !manualModal.classList.contains('windowed')) return false;
    if (document.body.classList.contains('desktop-mode') && galleryWindow && !galleryWindow.classList.contains('active-window')) {
        return false;
    }
    return true;
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
let taskbarClockAlignmentTimer = null;
let taskbarClockInterval = null;
let taskbarClockIntervalTicks = 0;
let taskbarClockResyncAt = 0;

function initializeDesktopTaskbar() {
    taskbarWindows = document.getElementById('taskbarWindows');
    taskbarClock = document.getElementById('taskbarClock');

    if (!taskbarWindows || !taskbarClock) {
        console.warn('Taskbar elements not found');
        return;
    }

    // The clock displays minutes, so align once and update only on minute boundaries.
    updateTaskbarClock();
    scheduleTaskbarClock();

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
        imageIcon: 'spellcaster.png',
        label: 'Spellcaster',
        action: () => {
            // openSpellbookApplet: public/scripts/comp/featureLoader.js
            void openSpellbookApplet();
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
            // openGrimoireApplet: public/scripts/comp/featureLoader.js
            void openGrimoireApplet();
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

function scheduleTaskbarClock() {
    if (taskbarClockAlignmentTimer) {
        clearTimeout(taskbarClockAlignmentTimer);
        taskbarClockAlignmentTimer = null;
    }
    if (taskbarClockInterval) {
        clearInterval(taskbarClockInterval);
        taskbarClockInterval = null;
    }

    taskbarClockIntervalTicks = 0;
    const minuteMs = 60000;
    const nextMinuteDelay = minuteMs - (Date.now() % minuteMs);
    taskbarClockAlignmentTimer = setTimeout(() => {
        taskbarClockAlignmentTimer = null;
        updateTaskbarClock();
        taskbarClockResyncAt = Date.now() + (60 * minuteMs);
        taskbarClockInterval = setInterval(() => {
            updateTaskbarClock();
            taskbarClockIntervalTicks++;
            if (taskbarClockIntervalTicks >= 60 || Date.now() >= taskbarClockResyncAt) {
                scheduleTaskbarClock();
            }
        }, minuteMs);
    }, nextMinuteDelay);
}

function updateTaskbarClock() {
    if (!taskbarClock) return;

    const now = new Date();
    // Vista's short time in the system's format ("1:52 PM"): taskbarClockText, public/scripts/comp/taskbarClock.js
    const timeStr = typeof window.taskbarClockText === 'function'
        ? window.taskbarClockText(now)
        : now.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
    const dateStr = `${now.getMonth() + 1}/${now.getDate()}`;

    const timeEl = taskbarClock.querySelector('.taskbar-time');
    const dateEl = taskbarClock.querySelector('.taskbar-date');

    if (timeEl && timeEl.textContent !== timeStr) timeEl.textContent = timeStr;
    if (dateEl && dateEl.textContent !== dateStr) dateEl.textContent = dateStr;
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
    // Cheap safety net: getOrCreateTaskbarItem can still insert a temporary item
    // before updateTaskbarWindows creates the real one. Prefer preventing dupes at insert.
    if (!taskbarWindows) return;

    const seenModalIds = new Set();
    const seenGroupTypes = new Set();
    const toRemove = [];

    taskbarWindows.querySelectorAll('.taskbar-window-item').forEach((item) => {
        if (item.classList.contains('leaving')) return;
        if (item.classList.contains('taskbar-window-group')) {
            const type = item.dataset.groupType;
            if (!type) return;
            if (seenGroupTypes.has(type)) {
                toRemove.push(item);
            } else {
                seenGroupTypes.add(type);
            }
            return;
        }
        const id = item.dataset.modalId;
        if (!id) return;
        if (seenModalIds.has(id)) {
            toRemove.push(item);
        } else {
            seenModalIds.add(id);
        }
    });

    toRemove.forEach((item) => removeTaskbarItemNow(item));
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
                    const imagePath = resolveAppIconPath(imageIcon);
                    const expectedSrc = new URL(imagePath, window.location.origin).href;
                    if (imageIconEl.src !== expectedSrc) {
                        imageIconEl.src = expectedSrc;
                    }
                    const srcset = buildAppIconSrcset(imageIcon);
                    if (srcset && imageIconEl.getAttribute('srcset') !== srcset) {
                        imageIconEl.setAttribute('srcset', srcset);
                        imageIconEl.setAttribute('sizes', appIconSizesAttr(APP_ICON_DISPLAY_PX.taskbar));
                    }
                }

                if (textEl && textEl.textContent !== title) {
                    textEl.textContent = title;
                }
            }
        } else if (groupType) {
            // Group item - update based on modals in the group
            const modals = modalGroups.get(groupType) || [];
            const shouldGroup = taskbarGroupingEnabled() && modals.length > 3;

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

/** Group similar taskbar buttons (Taskbar and Start Menu Properties; public/scripts/comp/taskbarSettings.js). */
function taskbarGroupingEnabled() {
    return !(window.taskbarSettings && window.taskbarSettings.get().group === false);
}

function updateTaskbarWindows() {
    if (!taskbarWindows) return;

    // Close any open group menu when updating (to prevent stale menus)
    closeTaskbarGroupMenu();

    rebuildTaskbarModalGroupsCache();

    // STEP 1: EVALUATE - Determine what SHOULD exist from the group map
    const itemsThatShouldExist = new Map(); // modalId or groupType -> { type: 'individual'|'group', data: {...} }

    taskbarModalGroupsCache.forEach((modalsMap, type) => {
        const modals = Array.from(modalsMap.values());
        if (modals.length === 0) return;
        const shouldGroup = taskbarGroupingEnabled() && modals.length > 3;

        if (shouldGroup) {
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
                        ${getIconHTML(icon, imageIcon, '', APP_ICON_DISPLAY_PX.taskbar)}
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

                // Current image icon, read the same way getModalIcons reads the caption's
                const currentImageIcon = currentImageIconEl ? (appIconRefFromImg(currentImageIconEl) || null) : null;

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
                            ${getIconHTML(icon, imageIcon, '', APP_ICON_DISPLAY_PX.taskbar)}
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
                        ${getIconHTML(icon, imageIcon, '', APP_ICON_DISPLAY_PX.taskbar)}
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

    // Taskbar alert: the state lives on the window, so it survives every rebuild of the items
    taskbarWindows.querySelectorAll('.taskbar-window-item').forEach((item) => {
        let ids = item.dataset.modalId ? [item.dataset.modalId] : [];
        if (!ids.length && item.dataset.groupedModals) {
            try { ids = JSON.parse(item.dataset.groupedModals) || []; } catch (_) { ids = []; }
        }
        const wants = ids.some((id) => {
            const m = document.getElementById(id);
            return !!(m && m.dataset.windowAttention === 'true');
        });
        item.classList.toggle('attention', wants);
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
function renderIcon(icon, className = '', displayPx) {
    if (!icon) return '';

    // If it's an image icon, render as img tag
    if (isImageIcon(icon)) {
        return renderAppIconImg(icon, className, displayPx);
    }

    // Otherwise, it's a Font Awesome icon class
    const classAttr = className ? ` class="${icon} ${className}"` : ` class="${icon}"`;
    return `<i${classAttr}></i>`;
}

// Helper function to render both icon and imageIcon (for CSS-based switching)
// Size variants are generated server-side into .cache/runtime-assets (modules/appIconRuntimeAssets.js).
// Keep in step with ICON_SIZES there.
const APP_ICON_SRCSET_SIZES = [16, 24, 32, 48, 64, 96, 128, 192, 384];

// The size each surface draws an app icon at, for the srcset `sizes` attribute: the browser
// then fetches the smallest compiled size that covers it at the screen's pixel ratio.
// Without it every icon asked for the 192 / 384 px file.
const APP_ICON_DISPLAY_PX = {
    desktop: 64,      // desktop-shell.css .desktop-shortcut-icon (Classic 64, Aero 48)
    taskbar: 17,      // desktop-shell.css --taskbar-window-icon-size
    switcher: 32,     // window-switcher.css 2rem
    fallback: 192     // surfaces that never said; the old fixed value
};
const START_MENU_ROW_ICON_PX = { large: 40, medium: 30, small: 20 }; // desktop-shell.css .start-menu-row-icon

function appIconSizesAttr(displayPx) {
    const px = Number(displayPx) > 0 ? Math.round(Number(displayPx)) : APP_ICON_DISPLAY_PX.fallback;
    return `${px}px`;
}

/** Smallest compiled size that is at least px (for a fixed 1x / 2x url). */
function appIconTierFor(px) {
    const want = Number(px) || 0;
    for (let i = 0; i < APP_ICON_SRCSET_SIZES.length; i++) {
        if (APP_ICON_SRCSET_SIZES[i] >= want) return APP_ICON_SRCSET_SIZES[i];
    }
    return APP_ICON_SRCSET_SIZES[APP_ICON_SRCSET_SIZES.length - 1];
}

function appIconBasename(imageIcon) {
    const val = String(imageIcon || '').trim();
    if (!val) return '';
    try {
        if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//') || val.startsWith('/')) {
            const url = new URL(val, window.location.origin);
            const parts = url.pathname.split('/');
            return parts[parts.length - 1] || '';
        }
    } catch (_e) {
        // fall through
    }
    const cleaned = val.replace(/^static_images\/app_icons\//, '').replace(/^\/?static_images\/app_icons\//, '');
    const parts = cleaned.split('/');
    return parts[parts.length - 1] || '';
}

function resolveAppIconPath(imageIcon, size) {
    const val = String(imageIcon || '').trim();
    if (!val) return '';
    if (val.startsWith('http://') || val.startsWith('https://') || val.startsWith('//')) return val;
    const filename = appIconBasename(val);
    if (!filename) return '';
    if (val.startsWith('/') && !val.includes('/static_images/app_icons/')) return val;
    if (val.startsWith('static_images/') && !val.includes('app_icons/')) return `/${val}`;
    // modules/appIconRuntimeAssets.js serves a lossless webp beside the png fallback
    const served = /\.png$/i.test(filename) ? filename.replace(/\.png$/i, '.webp') : filename;
    const sizeNum = Number(size);
    if (sizeNum && APP_ICON_SRCSET_SIZES.includes(sizeNum)) {
        return `/static_images/app_icons/${sizeNum}/${served}`;
    }
    return `/static_images/app_icons/${served}`;
}

function buildAppIconSrcset(imageIcon) {
    const filename = appIconBasename(imageIcon);
    if (!filename) return '';
    // only app_icons have compiled sizes; other art (a dialog's own caption icon) has none to list
    const path = resolveAppIconPath(imageIcon);
    if (path && !path.includes('/static_images/app_icons/')) return '';
    return APP_ICON_SRCSET_SIZES
        .map((size) => `${resolveAppIconPath(filename, size)} ${size}w`)
        .join(', ');
}

// displayPx: the size this surface draws the icon at (APP_ICON_DISPLAY_PX).
function renderAppIconImg(imageIcon, className = '', displayPx) {
    const imagePath = resolveAppIconPath(imageIcon);
    const classAttr = className ? ` class="icon-image ${className}"` : ' class="icon-image"';
    // Art outside app_icons (a Vista dialog's own caption icon, e.g. vista-file-progress/progress-16.png)
    // has no compiled sizes: the app_icons srcset named files that do not exist and the taskbar
    // button drew nothing. Its own file, and its -32 twin for 2x when it is a -16 icon.
    if (imagePath && !imagePath.includes('/static_images/app_icons/') && /^\/(?!\/)/.test(imagePath)) {
        const twin = /-16\.png$/i.test(imagePath) ? ` srcset="${imagePath} 1x, ${imagePath.replace(/-16\.png$/i, '-32.png')} 2x"` : '';
        return `<img src="${imagePath}" alt=""${twin}${classAttr} />`;
    }
    const srcset = buildAppIconSrcset(imageIcon);
    const srcsetAttr = srcset ? ` srcset="${srcset}" sizes="${appIconSizesAttr(displayPx)}"` : '';
    return `<img src="${imagePath}" alt=""${srcsetAttr}${classAttr} />`;
}

function renderDualIcon(icon, imageIcon, className = '', displayPx) {
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

    // Render image icon (shown in desktop mode) — srcset picks optimised runtime size
    if (imageIcon) {
        html += renderAppIconImg(imageIcon, className, displayPx);
    } else if (icon && isImageIcon(icon)) {
        html += renderAppIconImg(icon, className, displayPx);
    }

    return html;
}

// Helper function to get icon HTML string for use in innerHTML
// Supports both single icon and dual icon (icon + imageIcon) modes
function getIconHTML(icon, imageIcon = null, className = '', displayPx) {
    // If imageIcon is provided, render both (for CSS switching)
    if (imageIcon !== null) {
        return renderDualIcon(icon, imageIcon, className, displayPx);
    }

    // Otherwise, use single icon mode (backward compatible)
    return renderIcon(icon, className, displayPx);
}

function getModalIcon(modal) {
    // Try to get icon from modal-window-title (prefer imageIcon for desktop mode, but taskbar is desktop-only)
    // For taskbar (desktop mode only), prefer image icon if available
    const imgEl = modal.querySelector('.modal-window-title-main img.icon-image');
    if (imgEl) {
        // Extract path from src (handle both relative and absolute URLs)
        const src = imgEl.src;
        const url = new URL(src, window.location.origin);
        return url.pathname; // Return just the path part (e.g., "/static_images/app_icons/studio.webp")
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

/** App icon filename when a window has no img.icon-image and no parent / owner that has one. */
const MODAL_APPLICATION_ICONS = {
    positionDialog: 'studio.png',
    characterPositionTool: 'studio.png',
    compiledPromptModal: 'studio.png',
    compileToPromptsModal: 'studio.png',
    expansionCompiledPromptDialog: 'studio.png',
    stageResultsReview: 'studio.png',
    studioSaveNameModal: 'studio.png',
    studioSaveFolderModal: 'studio.png',
    studioVSliderTool: 'studio.png',
    studioVSliderEditorTool: 'studio.png',
    generationUsageTool: 'studio.png',
    directorFeedbackModal: 'director.png',
    directorWindow: 'director.png',
    vibeEncodingModal: 'ref.png',
    // windows of their own that are built in script (startMenuOrganizer.js, remoteAccessProperties.js,
    // agentClientUpdateDialog.js, mainframeExceptionDialog.js, vfsSystemOpenRouter.js)
    desktopEmotionModal: 'emotion.png',
    startMenuOrganizerModal: 'vista-taskbar.png',
    remoteAccessPropertiesDialog: 'vista-remote-access.png',
    agentClientUpdateDialog: 'vista-windows-update.png',
    mainframeExceptionDialog: 'vista-system.png',
    vfsSystemTextViewerModal: 'vista-explorer.png',
    // owners of script-built windows that can open before the owner is built (dovecote.js)
    desktopDovecoteModal: 'vista-mail.png'
};

/** The window this one belongs to, for its icon: the linked parent, else the owner it names. */
function modalIconOwnerId(modal) {
    return modal.getAttribute('data-parent-modal-id') || modal.dataset.iconOwnerId || '';
}

/** An app icon reference from a caption img: the app_icons file name, or the path of other art. */
function appIconRefFromImg(img) {
    const raw = img.getAttribute('src') || img.src || '';
    if (!raw) return '';
    if (raw.includes('/static_images/app_icons/')) return appIconBasename(raw);
    try {
        return new URL(raw, window.location.origin).pathname;
    } catch (_e) {
        return raw;
    }
}

/**
 * Icon for a window that has none of its own: the parent's or owner's (up the chain), then
 * MODAL_APPLICATION_ICONS by id.
 */
function resolveInheritedAppIcon(modal) {
    const seen = new Set([modal.id]);
    let ownerId = modalIconOwnerId(modal);
    while (ownerId && !seen.has(ownerId)) {
        seen.add(ownerId);
        const owner = document.getElementById(ownerId);
        // an owner that is not built yet (Dovecote's compose from the tray) still has its map entry
        if (!owner) {
            if (MODAL_APPLICATION_ICONS[ownerId]) return MODAL_APPLICATION_ICONS[ownerId];
            break;
        }
        const img = owner.querySelector(':scope > .modal-window-title > .modal-window-title-main > img.icon-image');
        if (img) return appIconRefFromImg(img);
        if (owner.dataset.taskbarIcon) return owner.dataset.taskbarIcon;
        if (owner.id && MODAL_APPLICATION_ICONS[owner.id]) return MODAL_APPLICATION_ICONS[owner.id];
        ownerId = modalIconOwnerId(owner);
    }
    return (modal.id && MODAL_APPLICATION_ICONS[modal.id]) || '';
}

/**
 * Every window shows an image icon in its caption and on its taskbar button. A window without
 * one of its own takes its parent's or owner's (data-parent-modal-id, data-icon-owner-id) or its
 * MODAL_APPLICATION_ICONS entry, looked up again on every open, since a tool window can open from
 * a different parent. Message boxes (data-vista-dialog=message) and dialogs Vista draws without
 * a caption icon (data-caption-icon=none: property sheets, the .NET exception dialog) keep a bare
 * caption; their taskbar button still gets the icon (data-taskbar-icon, read by getModalIcons).
 */
function ensureModalApplicationIcon(modal) {
    if (!modal || !window.isDesktop || !document.body.classList.contains('desktop-mode')) return;

    const main = modal.querySelector(':scope > .modal-window-title > .modal-window-title-main');
    if (!main) return;
    if (main.querySelector(':scope > img.icon-image:not([data-inherited-icon])')) return;

    const imageIcon = resolveInheritedAppIcon(modal);
    const current = main.querySelector(':scope > img[data-inherited-icon]');
    if (modal.dataset.vistaDialog === 'message' || modal.dataset.captionIcon === 'none') {
        if (current) current.remove();
        if (imageIcon) modal.dataset.taskbarIcon = imageIcon;
        else delete modal.dataset.taskbarIcon;
        return;
    }
    delete modal.dataset.taskbarIcon;
    // nothing resolved: keep what an earlier open inherited rather than fall back to the glyph
    if (!imageIcon || (current && current.dataset.inheritedIcon === imageIcon)) return;

    const holder = document.createElement('div');
    holder.innerHTML = renderAppIconImg(imageIcon, '', APP_ICON_DISPLAY_PX.taskbar);
    const img = holder.firstElementChild;
    if (!img) return;
    img.dataset.inheritedIcon = imageIcon;
    const iconEl = main.querySelector(':scope > i');
    if (iconEl && !iconEl.classList.contains('icon-fa')) iconEl.classList.add('icon-fa');
    if (current) {
        current.replaceWith(img);
        return;
    }
    const anchor = main.querySelector(':scope > span');
    if (anchor) main.insertBefore(img, anchor);
    else main.appendChild(img);
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

    // Get image icon: the caption's, else the one a message box keeps for its taskbar button
    const imgEl = modal.querySelector('.modal-window-title-main img.icon-image');
    if (imgEl) {
        imageIcon = appIconRefFromImg(imgEl);
    } else if (modal.dataset.taskbarIcon) {
        // the served name, as a rendered taskbar img reads back (studio.png -> studio.webp)
        const ref = modal.dataset.taskbarIcon;
        imageIcon = ref.startsWith('/') ? ref : appIconBasename(resolveAppIconPath(ref));
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

    if (modal.id && modal.id.startsWith('imagePromptInspector_')) {
        return 'imagePromptInspector';
    }

    if (modal.id && modal.id.startsWith('imagePromptInspectorJson_')) {
        return 'imagePromptInspectorJson';
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

    if (modal.classList.contains('image-prompt-inspector')) {
        return 'imagePromptInspector';
    }

    if (modal.classList.contains('image-prompt-inspector-json')) {
        return 'imagePromptInspectorJson';
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
    const rootWindowIds = new Set(['galleryWindow', 'manualModal', 'windowsStartupModal', 'connectionDialModal']);
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
                ${getIconHTML(iconToUse, imageIcon, '', APP_ICON_DISPLAY_PX.taskbar)}
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
let taskbarGroupMenuCloseHandler = null;

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

    // Drop any prior outside-click handler before opening a new menu
    closeTaskbarGroupMenu();

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

    // Close menu when clicking outside (must be removed in closeTaskbarGroupMenu)
    taskbarGroupMenuCloseHandler = (e) => {
        if (!menu.contains(e.target) && !groupItem.contains(e.target)) {
            closeTaskbarGroupMenu();
        }
    };

    // Use setTimeout to avoid immediate close
    setTimeout(() => {
        if (taskbarGroupMenuCloseHandler) {
            document.addEventListener('click', taskbarGroupMenuCloseHandler);
        }
    }, 10);
}

function closeTaskbarGroupMenu() {
    if (taskbarGroupMenuCloseHandler) {
        document.removeEventListener('click', taskbarGroupMenuCloseHandler);
        taskbarGroupMenuCloseHandler = null;
    }

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

            // Handle value pickers
            if (control.classList.contains('custom-dropdown-btn') || control.classList.contains('custom-dropdown')) {
                const button = control.matches('button') ? control : control.querySelector('button');
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

                if (control.classList.contains('custom-dropdown-btn') || control.classList.contains('custom-dropdown')) {
                    const button = control.matches('button') ? control : control.querySelector('button');
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

    if (action === 'open-remote-access-settings') {
        openRemoteAccessSettingsModal();
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
        // public/scripts/comp/featureLoader.js
        void featureLoader.loadFeature('explorer').then(() => {
            const explorer = initializeExplorerApplet();
            if (explorer?.clipboard) {
                void explorer.pasteToDesktopSurface();
            }
        });
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
                    const closeBtn = modal.querySelector('.close-btn');
                    if (closeBtn) closeBtn.click();
                    else closeModal(modal);
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
        imageIcon: 'art.png', // Workspaces keeps its own icon (Yukimi); Photo Gallery's went to Glancewell
        text: 'Workspaces',
        fullName: 'Dreamscape Workspaces',
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
        fullName: 'DreamStudio 2026 R7',
        desktopOnly: true,
        appMenu: true,
        action: () => { openManualModalWithContent(); }
    },
    { launchId: 'spellbook', icon: 'fas fa-hat-wizard', imageIcon: 'spellcaster.png', text: 'Spellcaster', appMenu: true, action: async () => { /* public/scripts/comp/featureLoader.js */ await openSpellbookApplet(); } },
    { launchId: 'reference', icon: 'fas fa-swatchbook', imageIcon: 'ref.png', text: 'Reference', appMenu: true, action: () => { showCacheManagerModal(); } },
    { launchId: 'bracket-generation', icon: 'fas fa-layer-group', imageIcon: 'vista-phasewalker.png', text: 'Phasewalker', desktopOnly: true, appMenu: true, action: async () => { /* public/scripts/comp/featureLoader.js */ await openBracketGenerationApplet(); } },
    { launchId: 'director', icon: 'fas fa-clapperboard', imageIcon: 'director.png', text: 'Director', desktopOnly: true, appMenu: true, action: async () => { /* public/scripts/comp/director.js */ await openDirectorWindow(); } },
    { launchId: 'encyclopedia', icon: 'fas fa-book', imageIcon: 'vista-iexplore.png', text: 'Grimoire', appMenu: true, action: async () => { /* public/scripts/comp/featureLoader.js */ await openGrimoireApplet(); } },
    { launchId: 'alchemy', icon: 'fas fa-atom', imageIcon: 'alchemy.png', text: 'Alchemy', appMenu: true, action: async () => { /* public/scripts/comp/featureLoader.js */ await openGrimoireUrl(ALCHEMY_HOME_URL); } },
    { launchId: 'naxt', icon: 'fas fa-flask', imageIcon: 'test_tube.png', text: 'Atelier', appMenu: true, action: async () => { /* public/scripts/comp/featureLoader.js */ await openNaxtApplet(); } },
    { launchId: 'notebook', icon: 'fas fa-notebook', imageIcon: 'vista-journal.png', text: 'Notion', appMenu: true, action: async () => { if (window.featureLoader) { await window.featureLoader.loadFeature('notepad'); } window.notepadManager.openNotebook(); }, rightAction: { icon: 'fas fa-sticky-note', tooltip: 'New Note', action: async () => { if (window.featureLoader) { await window.featureLoader.loadFeature('notepad'); } window.notepadManager.handleNewNote(); } } },
    { launchId: 'chat', icon: 'fas fa-messages', imageIcon: 'vista-messenger.png', text: 'Chat', appMenu: true, action: async () => { if (window.featureLoader) { await window.featureLoader.loadFeature('chat'); } window.chatSystem.showAllChats(); } },
    { launchId: 'explorer', icon: 'fas fa-folder-open', imageIcon: 'vista-explorer.png', text: 'Cartograph', appMenu: true, action: () => { openExplorerApplet(); } },
    { launchId: 'remote-desktop', icon: 'fas fa-satellite-dish', imageIcon: 'remote_desktop.png', text: 'Remote Desktop Manager', appMenu: true, action: async () => { await featureLoader.loadFeature('remote_desktop'); /* public/scripts/comp/desktop-apps/guacRemote.js */ openDesktopGuac(); } },
    // Remote Desktop Connection (mstsc.exe, whose icon this is): quick connections through Guacamole
    { launchId: 'remote-desktop-connection', icon: 'fas fa-desktop', imageIcon: 'vista-remote-desktop.png', text: 'Remote Desktop Connection', appMenu: true, action: async () => { await featureLoader.loadFeature('remote_desktop_connection'); /* public/scripts/comp/desktop-apps/remoteDesktopConnection.js */ remoteDesktopConnection.open(); } },
    { launchId: 'dovecote', icon: 'fas fa-envelope', imageIcon: 'vista-mail.png', text: 'Dovecote', appMenu: true, action: () => { /* public/scripts/comp/desktop-apps/dovecote.js */ openDesktopDovecote(); } },
    // Teleport (Yukimi, 2026-10-12): the planet switcher. All Programs, the places column under
    // Workspaces, and the power menu where Vista has Switch User; the start menu lists no planets.
    // Run: `planets`, `teleport`.
    { launchId: 'planet-switcher', icon: 'fas fa-planet-moon', imageIcon: 'vista-teleport.png', text: 'Teleport', desktopOnly: true, appMenu: true, action: async () => { await openPlanetSwitcher(); } },
];

// All Programs > Games (Yozora #609): Windows Vista's games, recreated from the VM
// (public/scripts/comp/desktop-apps/vista-games/), opened through openVistaGame
// (public/scripts/comp/featureLoader.js). Only listed here, not at the top level.
const startMenuGameLaunchables = [
    { launchId: 'game-blockdrop', game: 'blockdrop', icon: 'fas fa-cubes', imageIcon: 'vista-blockdrop.png', text: 'Block Drop' },
    { launchId: 'game-brickbreaker', game: 'brickbreaker', icon: 'fas fa-table-tennis-paddle-ball', imageIcon: 'vista-brickbreaker.png', text: 'Brick Breaker' },
    { launchId: 'game-chess', game: 'chess', icon: 'fas fa-chess', imageIcon: 'vista-chess.png', text: 'Chess Titans' },
    { launchId: 'game-freecell', game: 'freecell', icon: 'fas fa-crown', imageIcon: 'vista-freecell.png', text: 'FreeCell' },
    { launchId: 'games-explorer', game: 'explorer', icon: 'fas fa-trophy', imageIcon: 'vista-games.png', text: 'Games Explorer' },
    { launchId: 'game-hearts', game: 'hearts', icon: 'fas fa-heart', imageIcon: 'vista-hearts.png', text: 'Hearts' },
    { launchId: 'game-inkball', game: 'inkball', icon: 'fas fa-pen', imageIcon: 'vista-inkball.png', text: 'InkBall' },
    { launchId: 'game-jezzball', game: 'jezzball', icon: 'fas fa-circle-half-stroke', imageIcon: 'vista-jezzball.png', text: 'JezzBall' },
    { launchId: 'game-mahjong', game: 'mahjong', icon: 'fas fa-dragon', imageIcon: 'vista-mahjong.png', text: 'Mahjong Titans' },
    { launchId: 'game-minesweeper', game: 'minesweeper', icon: 'fas fa-bomb', imageIcon: 'vista-minesweeper.png', text: 'Minesweeper' },
    { launchId: 'game-purble', game: 'purble', icon: 'fas fa-eye', imageIcon: 'vista-purble.png', text: 'Purble Place' },
    { launchId: 'game-solitaire', game: 'solitaire', icon: 'fas fa-diamond', imageIcon: 'vista-solitaire.png', text: 'Solitaire' },
    { launchId: 'game-spider', game: 'spider', icon: 'fas fa-spider', imageIcon: 'vista-spider.png', text: 'Spider Solitaire' }
].map((item) => ({ appMenu: false, desktopOnly: true, ...item, action: () => openVistaGame(item.game) }));

/** Root start menu shell rows (folders + run). */
const startMenuShellConfig = [
    { icon: 'fas fa-grid-2', imageIcon: 'atom.png', text: 'All Apps', hasSubmenu: true, submenu: 'all-apps', appMenu: false },
    { separator: true },
    {
        icon: 'fas fa-planet-ringed',
        imageIcon: 'planet.png',
        text: 'Planets',
        desktopOnly: true,
        appMenu: false,
        // Planet switcher view (the start menu lists the planets in All Programs > Planets)
        contextSubmenu: 'planets',
        action: () => { openPlanetSwitcher(); }
    },
    { icon: 'fas fa-toolbox', imageIcon: 'vista-folder.png', text: 'Toolbox', hasSubmenu: true, submenu: 'tools', appMenu: false },
    { launchId: 'run', icon: 'fas fa-magnifying-glass', imageIcon: 'vista-run.png', text: 'Run', appMenu: false, action: async () => { /* public/scripts/comp/featureLoader.js */ await featureLoader.loadFeature('run'); runApplet.open(); } },
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
        { launchId: 'import', icon: 'nai-import', imageIcon: 'vista-easy-transfer.png', text: 'Import', appMenuLocation: 'tools', action: () => { unifiedUploadModalManager.show(); } },
        { launchId: 'presets', icon: 'fas fa-book-spells', imageIcon: 'presetbook.png', text: 'Spellbook', appMenuLocation: 'tools', action: () => { showPresetManager(); } },
        { launchId: 'expanders', icon: 'fas fa-book-font', imageIcon: 'expanders.png', text: 'Expanders', appMenuLocation: 'tools', action: () => { showTextReplacementManager(); } },
        { launchId: 'memories', icon: 'fas fa-box-open-full', imageIcon: 'dna.png', text: 'Enshutsuka', appMenuLocation: 'tools', startMenu: false, appMenu: false, action: () => { openKnowledgeMemoriesModal(); } },
        { launchId: 'config-editor', icon: 'fas fa-binary', imageIcon: 'vista-regedit.png', text: 'Runes', desktopOnly: true, appMenuLocation: 'tools', action: async () => { /* public/scripts/comp/featureLoader.js */ await featureLoader.loadFeature('config_editor'); configEditorApplet.open(); } },
        { launchId: 'character-db', icon: 'fas fa-users', imageIcon: 'characters.png', text: 'Characters', desktopOnly: true, appMenuLocation: 'tools', action: async () => { /* public/scripts/comp/featureLoader.js */ await featureLoader.loadFeature('character_db'); characterDbApplet.open(); } },
        { launchId: 'event-viewer', icon: 'fas fa-wave-square', imageIcon: 'vista-performance.png', text: 'Periscope', desktopOnly: true, appMenuLocation: 'tools', action: async () => { /* public/scripts/comp/featureLoader.js */ await featureLoader.loadFeature('log_viewer'); logViewerApplet.open(); } },
        // Accessories > Welcome Center (public/scripts/comp/welcomeCenter.js)
        { launchId: 'welcome-center', icon: 'fas fa-house', imageIcon: 'vista-welcome-center.png', text: 'Welcome Center', appMenuLocation: 'tools', action: () => { window.openWelcomeCenter(); } },
        // Accessories > Paint (Yozora #632; public/scripts/comp/desktop-apps/paint/paintApp.js)
        { launchId: 'paint', icon: 'fas fa-palette', imageIcon: 'vista-paint.png', text: 'Paint', appMenuLocation: 'tools', action: async () => { await featureLoader.loadFeature('paint'); window.openMelatonPaint(); } },
        // System Tools > Melaton Task Manager (Yozora #632; apps/taskmgr, a system package; Ctrl+Shift+Esc)
        { launchId: 'taskmgr', icon: 'fas fa-chart-line', imageIcon: 'vista-task-manager.png', text: 'Melaton Task Manager', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'taskmgr' }) },
        // Accessories > WordPad (Yozora #632; apps/wordpad, a system package)
        { launchId: 'wordpad', icon: 'fas fa-file-word', imageIcon: 'vista-wordpad.png', text: 'WordPad', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'wordpad' }) },
        // Accessories > Sound Recorder (Yozora #632; apps/soundrec, a system package)
        { launchId: 'soundrec', icon: 'fas fa-microphone', imageIcon: 'vista-sound-recorder.png', text: 'Sound Recorder', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'soundrec' }) },
        // Melaton Contacts (Yozora #632; apps/contacts, a system package)
        { launchId: 'contacts', icon: 'fas fa-address-book', imageIcon: 'vista-contacts.png', text: 'Melaton Contacts', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'contacts' }) },
        // Melaton Calendar (Yozora #632; apps/calendar, a system package)
        { launchId: 'calendar', icon: 'fas fa-calendar', imageIcon: 'vista-calendar.png', text: 'Melaton Calendar', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'calendar' }) },
        // Accessories > Snipping Tool (Yozora #632; apps/snipping, a system package)
        { launchId: 'snipping', icon: 'fas fa-scissors', imageIcon: 'vista-snipping-tool.png', text: 'Snipping Tool', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'snipping' }) },
        // Accessories > Character Map (Yozora #632; public/scripts/comp/desktop-apps/charmap/charmapApp.js)
        { launchId: 'charmap', icon: 'fas fa-font', imageIcon: 'vista-charmap.png', text: 'Character Map', appMenuLocation: 'tools', action: async () => { await featureLoader.loadFeature('charmap'); window.openMelatonCharmap(); } },
        // Accessories > Notepad: a blank Untitled document (Yozora #632; public/scripts/comp/notepadVista.js)
        { launchId: 'notepad', icon: 'fas fa-file-lines', imageIcon: 'vista-notepad.png', text: 'Notepad', appMenuLocation: 'tools', action: async () => { await featureLoader.loadFeature('notepad'); window.notepadVista.openBlank(); } },
        { launchId: 'calculator', icon: 'fas fa-calculator', imageIcon: 'vista-calculator.png', text: 'Calculator', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'calculator' }) /* apps/calculator (Yozora #642) */ },
        { launchId: 'vista-sidebar', icon: 'fas fa-sidebar-flip', imageIcon: 'vista-sidebar.png', text: 'Melaton Sidebar', appMenuLocation: 'tools', desktopOnly: true, appMenu: false, startMenu: localStorage.getItem('userType') === 'admin', action: () => { /* public/scripts/comp/vistaSidebar.js */ openVistaSidebar(); } },
        { launchId: 'alarm', icon: 'fas fa-alarm-clock', imageIcon: 'vista-date-time.png', text: 'Alarm Clock', appMenuLocation: 'tools', action: () => melatonApps.launch({ packageId: 'alarm' }) /* apps/alarm (Yozora #642) */ },
        { launchId: 'pomodoro', icon: 'fas fa-timer', imageIcon: 'vista-date-time.png', text: 'Pomodoro', appMenuLocation: 'tools', startMenu: false, appMenu: false, /* the Pomodoro tab of Alarm Clock; kept for old shortcuts */ action: () => melatonApps.launch({ packageId: 'alarm', args: { mode: 'pomodoro' } }) },
        { launchId: 'media-player', icon: 'fas fa-play', imageIcon: 'media_player.png', text: 'Media Player', appMenuLocation: 'tools', action: async () => { await featureLoader.loadFeature('media_player'); /* public/scripts/comp/desktop-apps/mediaPlayer.js */ openDesktopMediaPlayer(); } },
        { launchId: 'emotion', icon: 'fas fa-photo-film', imageIcon: 'emotion.png', text: 'eMotion LIVE', appMenuLocation: 'tools', action: async () => { await featureLoader.loadFeature('emotion'); /* public/scripts/comp/desktop-apps/emotion.js */ openDesktopEmotion(); } },
    ].filter(isStartMenuEntryEnabled).filter((item) => !item.adminOnly || localStorage.getItem('userType') === 'admin');
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

    return sortMenuItemsByIndex(merged, 'startMenuIndex')
        .filter((item) => !item.adminOnly || localStorage.getItem('userType') === 'admin');
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
        if (item.adminOnly && localStorage.getItem('userType') !== 'admin') return;
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

// ---- Start menu organizer (order + folders, like Windows' Accessories folder) ----
// Server storage/validation: modules/startMenuLayout.js, modules/ws/handlers/260-startMenuLayoutHandler.js
// Editor window: public/scripts/comp/desktop-apps/startMenuOrganizer.js (openStartMenuOrganizer)

// null until fetchStartMenuCustomLayout resolves; stays null forever if Yukimi has never customized it.
let startMenuCustomLayout = null;

async function fetchStartMenuCustomLayout() {
    if (!window.wsClient) return;
    try {
        // start_menu_get_layout: modules/ws/handlers/260-startMenuLayoutHandler.js
        const result = await window.wsClient.sendMessage('start_menu_get_layout', {}, false);
        startMenuCustomLayout = (result && Array.isArray(result.layout)) ? result.layout : null;
    } catch (e) {
        console.error('start_menu_get_layout', e);
        startMenuCustomLayout = null;
    }
    if (startMenu) buildStartMenu();
}

/** Read-only accessor for the organizer window — the editor's own save/reset round-trips update the cache themselves. */
function getStartMenuCustomLayout() {
    return startMenuCustomLayout;
}

/** Called by the organizer window after a successful save/reset round-trip to the server. */
function setStartMenuCustomLayoutCache(layout) {
    startMenuCustomLayout = Array.isArray(layout) ? layout : null;
    if (startMenu) buildStartMenu();
}

/**
 * All-Apps items in the user's saved order/folders. Any catalog app not
 * referenced anywhere in the saved layout (new app, or layout saved before
 * it existed) is appended at the end in catalog order, so it is never
 * hidden by an out-of-date layout.
 */
function getOrganizedAllAppsMenuItems() {
    const catalogItems = getAllAppsMenuItems();
    if (!Array.isArray(startMenuCustomLayout) || !startMenuCustomLayout.length) {
        return catalogItems;
    }
    const byLaunchId = new Map(catalogItems.map((item) => [item.launchId, item]));
    const used = new Set();
    const result = [];

    startMenuCustomLayout.forEach((node) => {
        if (!node || typeof node !== 'object') return;
        if (node.type === 'item') {
            const item = byLaunchId.get(node.launchId);
            if (!item || used.has(node.launchId)) return;
            used.add(node.launchId);
            result.push(item);
        } else if (node.type === 'folder') {
            const children = (Array.isArray(node.children) ? node.children : [])
                .map((child) => (child && child.launchId ? byLaunchId.get(child.launchId) : null))
                .filter((item) => item && !used.has(item.launchId));
            if (!children.length) return;
            children.forEach((item) => used.add(item.launchId));
            result.push({
                text: node.name,
                icon: 'fas fa-folder',
                hasSubmenu: true,
                appMenu: false,
                isCustomFolder: true,
                folderId: node.id,
                customFolderItems: children
            });
        }
    });

    catalogItems.forEach((item) => {
        if (!used.has(item.launchId)) result.push(item);
    });
    return result;
}

/** All-Apps flyout content: organized items + a trailing row that opens the editor. */
function buildAllAppsSubmenuWithOrganizeRow() {
    const items = getOrganizedAllAppsMenuItems();
    return items.concat([
        { separator: true },
        {
            text: 'Organize Start Menu…',
            icon: 'fas fa-arrows-up-down-left-right',
            appMenu: false,
            action: async () => {
                await featureLoader.loadFeature('start_menu_organizer');
                // openStartMenuOrganizer: public/scripts/comp/desktop-apps/startMenuOrganizer.js
                openStartMenuOrganizer();
            }
        }
    ]);
}

function startMenuPlanetLaunchId(workspaceId) {
    return `planet-${workspaceId}`;
}

function isStartMenuPlanetLaunchId(launchId) {
    return typeof launchId === 'string' && launchId.startsWith('planet-');
}

/** Planet switcher (ring of workspace bubbles over a star field) - lazy feature planet_switcher. */
async function openPlanetSwitcher() {
    if (!isDesktopStartMenuEnvironment()) {
        showGlassToast('info', 'Planets', 'Desktop mode required', false, 2500);
        return;
    }
    if (window.planetSwitcher && window.planetSwitcher.isActive()) return;
    // public/scripts/comp/featureLoader.js
    await featureLoader.loadFeature('planet_switcher');
    // planetSwitcher: public/scripts/comp/planetSwitcher.js
    if (window.planetSwitcher) await window.planetSwitcher.open();
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
    'all-apps': () => buildAllAppsSubmenuWithOrganizeRow()
};

const shellIconFontSpecs = [
    '900 16px "Font Awesome 6 Pro"',
    '400 16px "Font Awesome 6 Pro"',
    '300 16px "Font Awesome 6 Pro"',
    '100 16px "Font Awesome 6 Pro"',
    '900 16px "Font Awesome 6 Duotone"',
    '400 16px "Font Awesome 6 Brands"',
    '900 16px "Font Awesome 6 Sharp"',
    '16px "remixicon"',
    '16px "Material Design Icons"'
];

function appIconMemoryUrl(imageIcon) {
    const dpr = Math.min(window.devicePixelRatio || 1, 3);
    const target = 192 * dpr;
    let size = APP_ICON_SRCSET_SIZES[APP_ICON_SRCSET_SIZES.length - 1];
    for (let i = 0; i < APP_ICON_SRCSET_SIZES.length; i++) {
        if (APP_ICON_SRCSET_SIZES[i] >= target) {
            size = APP_ICON_SRCSET_SIZES[i];
            break;
        }
    }
    return resolveAppIconPath(imageIcon, size);
}

function collectShellImageIcons(into, value, seenMenus) {
    if (!value || seenMenus.has(value)) return;
    if (typeof value === 'function') {
        seenMenus.add(value);
        try {
            collectShellImageIcons(into, value(), seenMenus);
        } catch (_error) {
            // Submenu builder is not ready yet.
        }
        return;
    }
    if (Array.isArray(value)) {
        seenMenus.add(value);
        for (let i = 0; i < value.length; i++) {
            collectShellImageIcons(into, value[i], seenMenus);
        }
        return;
    }
    if (typeof value !== 'object') return;
    seenMenus.add(value);
    if (value.imageIcon) into.add(value.imageIcon);
    if (value.submenu && startMenuSubmenus[value.submenu]) {
        collectShellImageIcons(into, startMenuSubmenus[value.submenu], seenMenus);
    }
    const keys = Object.keys(value);
    let onlyFns = keys.length > 0 && !value.imageIcon && !value.icon;
    for (let i = 0; i < keys.length; i++) {
        if (typeof value[keys[i]] !== 'function') onlyFns = false;
    }
    if (!onlyFns) return;
    for (let i = 0; i < keys.length; i++) {
        collectShellImageIcons(into, value[keys[i]], seenMenus);
    }
}

async function preloadShellIconsAndFonts() {
    const names = new Set();
    const seenMenus = new Set();
    collectShellImageIcons(names, startMenuConfig, seenMenus);
    collectShellImageIcons(names, startMenuSubmenus, seenMenus);
    const loads = [];
    names.forEach((name) => {
        // assetPreload.holdAppIcon: public/scripts/comp/assetPreload.js
        // Same src and srcset the menu image uses, kept decoded in the off-screen hold.
        loads.push(assetPreload.holdAppIcon(name));
    });
    if (document.fonts && document.fonts.load) {
        for (let i = 0; i < shellIconFontSpecs.length; i++) {
            loads.push(document.fonts.load(shellIconFontSpecs[i]).catch(() => []));
        }
    }
    await Promise.all(loads);
}

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
    startMenuGameLaunchables.forEach(pushItem);

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
            execute: () => {
                recordStartMenuLaunch(item.launchId);
                return item.action();
            }
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

/** When the process behind a /status answer started (timestamp - uptime), or null. */
function serverStartFromStatus(status) {
    if (!status || !Number.isFinite(status.timestamp) || !Number.isFinite(status.uptime)) return null;
    return status.timestamp - status.uptime;
}

/** Any JSON /status answer, a starting server's 503 included; null while nothing answers. */
async function probeServerStatusForRestart() {
    try {
        const response = await fetch('/status', { method: 'OPTIONS', cache: 'no-cache' });
        return await response.json();
    } catch (_) {
        return null;
    }
}

/**
 * After waitForServerDisconnect: true once /status answers from a process that started
 * other than oldStart (serverStartFromStatus before the restart; null = any answer),
 * false at timeoutMs. /launch booted against the old process builds a stale pack.
 */
async function waitForServerReturn(oldStart, options = {}) {
    const timeoutMs = options.timeoutMs || 180000;
    const pollMs = options.pollMs || 1000;
    const start = Date.now();
    while (Date.now() - start < timeoutMs) {
        const status = await probeServerStatusForRestart();
        if (status) {
            const started = serverStartFromStatus(status);
            if (oldStart == null || started == null || Math.abs(started - oldStart) > 2000) {
                return true;
            }
        }
        await new Promise((resolve) => setTimeout(resolve, pollMs));
    }
    return false;
}

function dismissTransientUIForShutdown() {
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

const SHUTDOWN_CLOSE_SEQUENTIAL_COUNT = 2;
const SHUTDOWN_CLOSE_BUDGET_MS = 6000;
// closeMainModal fallback timeout — the last overlapped close must start this long before the budget ends
const SHUTDOWN_CLOSE_MAX_MS = 600;

async function closeAllModalsForShutdown() {
    const deadline = Date.now() + SHUTDOWN_CLOSE_BUDGET_MS - SHUTDOWN_CLOSE_MAX_MS;
    let modals = getModalsForShutdownClose();
    let safety = 0;

    while (modals.length > 0 && safety < SHUTDOWN_CLOSE_SEQUENTIAL_COUNT) {
        safety += 1;
        await closeModal(modals[0]);
        await delayForClientShutdown(120);
        modals = getModalsForShutdownClose();
    }

    const pending = [];
    let stagger = 90;
    while (modals.length > 0 && safety < 64) {
        safety += 1;
        pending.push(closeModal(modals[0]));
        const left = modals.length - 1;
        if (left > 0) {
            const wait = Math.min(stagger, Math.max(0, deadline - Date.now()) / left);
            if (wait > 0) await delayForClientShutdown(wait);
            stagger = Math.max(20, stagger * 0.75);
        }
        modals = getModalsForShutdownClose();
    }
    await Promise.all(pending);
}

let clientShutdownSequenceRunning = false;

async function runClientShutdownSequence(finalAction) {
    if (clientShutdownSequenceRunning) return;
    clientShutdownSequenceRunning = true;

    try {
        suppressWebSocketReconnectForReload();
        dismissTransientUIForShutdown();
        // desktopSounds.play: public/scripts/comp/desktopSounds.js
        const soundDone = desktopSounds.play('shutdown');
        await closeAllModalsForShutdown();
        await delayForClientShutdown(150);
        await fadeClientShutdownOverlayAsync();
        await Promise.race([
            Promise.resolve(soundDone),
            delayForClientShutdown(desktopSounds.SHUTDOWN_WAIT_MAX_MS)
        ]);
        if (finalAction) finalAction();
    } catch (error) {
        clientShutdownSequenceRunning = false;
        throw error;
    }
}

/**
 * Where a full restart lands: the Melaton boot on /launch for the desktop (boot screen,
 * teal, logon, Yozora #420), an in-place reload otherwise.
 */
function restartClientNavigate() {
    try {
        suppressWebSocketReconnectForReload();
    } catch (_) { /* reload anyway */ }
    if (typeof bypassConfirmation !== 'undefined') {
        bypassConfirmation = true;
    }
    if (window.isDesktop) {
        location.replace('/launch');
    } else {
        location.reload();
    }
}
window.restartClientNavigate = restartClientNavigate;

/** Restart through the Welcome screen ("Shutting down..."), then the full boot. */
async function runClientRestartSequence() {
    // runWinlogonPower: public/scripts/comp/winlogonPower.js
    await runWinlogonPower('restart');
}
window.runClientRestartSequence = runClientRestartSequence;

async function runClientRestartDirect() {
    closeStartMenuAfterPowerAction();
    // runWinlogonPower: public/scripts/comp/winlogonPower.js
    await runWinlogonPower('restart');
}

async function runRestartDssDirect() {
    closeStartMenuAfterPowerAction();
    // public/scripts/comp/featureLoader.js
    await featureLoader.loadFeature('server_management');
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
    // runWinlogonPower: public/scripts/comp/winlogonPower.js
    await runWinlogonPower('shutdown');
}

/** Lock the workstation (workstationLock.js: Computer Locked over the wallpaper, Ctrl+Alt+L too). */
function runClientLockDirect() {
    closeStartMenuAfterPowerAction();
    if (window.workstationLock) {
        window.workstationLock.lock();
    }
}

function runLeaveDesktopModeDirect() {
    closeStartMenuAfterPowerAction();
    maximizeGalleryWindow();
}

function runLogoutDirect() {
    closeStartMenuAfterPowerAction();
    // runWinlogonPower: public/scripts/comp/winlogonPower.js
    runWinlogonPower('logoff').catch((error) => {
        showGlassToast('error', 'Log Off', error.message || 'Logout failed', false, 8000, '<i class="fas fa-exclamation-triangle"></i>');
    });
}

/** Vista's power arrow menu (Yozora #443): the power button shuts down, the arrow has the rest. */
function getStartMenuPowerMenuItems() {
    const isAdmin = localStorage.getItem('userType') === 'admin';
    const desktop = isDesktopStartMenuEnvironment();
    const items = [
        { id: 'teleport', text: 'Teleport', desktopOnly: true, action: () => runTeleportDirect() },
        { id: 'logout', text: 'Log Off', action: () => runLogoutDirect() },
        { id: 'lock', text: 'Lock', desktopOnly: true, action: () => runClientLockDirect() },
        { separator: true },
        { id: 'restart', text: 'Restart', action: () => runClientRestartDirect() },
        { id: 'shutdown', text: 'Shut Down', action: () => runClientShutdownDirect() },
        { separator: true },
        { id: 'leave-desktop', text: 'Leave Desktop Mode', desktopOnly: true, action: () => runLeaveDesktopModeDirect() },
        { id: 'restart-dss', text: 'Restart Server', adminOnly: true, action: () => runRestartDssDirect() },
    ].filter((item) => !(item.desktopOnly && !desktop) && !(item.adminOnly && !isAdmin));
    return items.filter((item, i) => !item.separator || (i > 0 && i < items.length - 1 && !items[i - 1].separator));
}

/** Teleport (the planet switcher) from the power menu; the switcher closes the start menu itself. */
function runTeleportDirect() {
    const item = findStartMenuLaunchableById('planet-switcher');
    if (item) launchStartMenuItem(item);
}

/** The arrow next to Lock: a click menu (contextMenu.js), rebuilt each time the menu is built. */
function attachStartMenuPowerMenu(button) {
    if (typeof contextMenu === 'undefined' || !contextMenu || !button) return;
    const items = getStartMenuPowerMenuItems();
    const byId = new Map(items.filter((item) => !item.separator).map((item) => [item.id, item]));
    contextMenu.detachClickMenuFromElement(button);
    contextMenu.attachClickMenuToElement(button, {
        sections: [{
            type: 'list',
            items: items.map((item) => (item.separator ? { separator: true } : { text: item.text, action: item.id }))
        }],
        onAction: (action) => {
            const item = byId.get(action);
            if (item) item.action();
        }
    });
}

function closeStartMenuAfterPowerAction() {
    closeStartMenu();
}

let startMenuOutsideClickController = null;

function handleStartMenuOutsideClick(e) {
    if (!startMenu || startMenu.classList.contains('hidden')) return;
    if (startMenu.contains(e.target)) return;
    if (e.target.closest('#taskbarStartBtn')) return;
    if (e.target.closest('.context-menu, .context-menu-overlay')) return;
    // A click menu opened from inside (power arrow, Recent Items) opens on mousedown; its overlay
    // takes the mouseup, so the click lands on the page body. Not a click outside.
    if (typeof contextMenu !== 'undefined' && contextMenu && contextMenu.isOpen) return;
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

// ---- Vista start menu (Yozora #443) ------------------------------------------------------------
// Left, a white pane: the pinned apps, the most used apps, and All Programs, which swaps the pane
// for the full list in place (apps, then the Accessories / Planets / organizer folders, opening in
// place), with Start Search under it (the Run index, runCommandIndex.js). Right, on the glass: the
// account picture, the places column, and Vista's power, lock and arrow buttons. Markup: #startMenu
// in app.html; art: scripts/build-vista-start-menu-art.js; styles: desktop-shell.css.

const START_MENU_ACTIVITY_KEY = 'startMenuActivity';
const START_MENU_ACTIVITY_MAX = 40;
const START_MENU_FREQUENT_LIMIT = 8;
// The most used list until the launch history fills it (Vista ships a starting list too)
const START_MENU_DEFAULT_FREQUENT = ['director', 'bracket-generation', 'encyclopedia', 'spellbook', 'reference', 'chat'];
// The domain logon's account (workstationLock.js); its name can be changed in User Accounts
const START_MENU_USER_NAME = 'Administrator';

/** The signed-in account's name for the Start menu (public/scripts/comp/meletonAccounts.js). */
function startMenuUserName() {
    return window.meletonAccountName ? window.meletonAccountName() : START_MENU_USER_NAME;
}
const START_MENU_ART = '/static_images/vista-start';
// Help and Support opens the project's page (public)
const START_MENU_HELP_URL = 'https://yozora.bluesteel.737.jp.net/DreamScape/StaticForge';

let startMenuView = 'home'; // 'home' | 'programs' | 'search'
const startMenuOpenFolders = new Set();
let startMenuSearchSeq = 0;
let startMenuSearchEntries = [];
let startMenuEls = null;

function startMenuHasFinePointer() {
    if (!window.matchMedia) return true;
    return window.matchMedia('(hover: hover) and (pointer: fine)').matches;
}

function startMenuLabel(item) {
    return (item && (item.fullName || item.text)) || '';
}

function byStartMenuLabel(a, b) {
    return startMenuLabel(a).localeCompare(startMenuLabel(b));
}

// ---- launch history: the most used list (this browser only; Recent Items are documents, recentItems.js) ----

function readStartMenuActivity() {
    try {
        const parsed = JSON.parse(localStorage.getItem(START_MENU_ACTIVITY_KEY) || '{}');
        return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
    } catch (_) {
        return {};
    }
}

function writeStartMenuActivity(activity) {
    const kept = {};
    Object.keys(activity)
        .sort((a, b) => (activity[b].t || 0) - (activity[a].t || 0))
        .slice(0, START_MENU_ACTIVITY_MAX)
        .forEach((id) => { kept[id] = activity[id]; });
    try {
        localStorage.setItem(START_MENU_ACTIVITY_KEY, JSON.stringify(kept));
    } catch (_) { /* the history is a convenience */ }
}

/** Count a launch (start menu, Start Search, Run) for the most used list. */
function recordStartMenuLaunch(launchId) {
    if (!launchId) return;
    const activity = readStartMenuActivity();
    const prev = activity[launchId] || {};
    activity[launchId] = { n: (prev.n || 0) + 1, t: Date.now() };
    writeStartMenuActivity(activity);
}

/** "Remove from this list": off the most used list until it is launched again. */
function hideStartMenuFrequentItem(launchId) {
    if (!launchId) return;
    const activity = readStartMenuActivity();
    activity[launchId] = { ...(activity[launchId] || {}), n: 0, hidden: true };
    writeStartMenuActivity(activity);
    if (startMenuView === 'home') renderStartMenuList();
}

function isStartMenuItemLaunchable(item) {
    return Boolean(item && isStartMenuEntryEnabled(item) && !(item.desktopOnly && !isDesktopStartMenuEnvironment()));
}

/** The start menu shows no planets (Teleport opens the switcher), even pinned or launched ones. */
function isStartMenuListedItem(item) {
    return isStartMenuItemLaunchable(item) && !isStartMenuPlanetLaunchId(item.launchId);
}

/** Taskbar and Start Menu Properties (public/scripts/comp/taskbarSettings.js): Privacy and Customize Start Menu. */
function startMenuTaskbarSettings() {
    return window.taskbarSettings ? window.taskbarSettings.get() : null;
}

function getStartMenuFrequentItems() {
    const prefs = startMenuTaskbarSettings();
    // "Store and display a list of recently opened programs" off: no most used list
    if (prefs && prefs.recentPrograms === false) return [];
    const limit = prefs ? prefs.recentProgramCount : START_MENU_FREQUENT_LIMIT;
    const activity = readStartMenuActivity();
    const pinned = new Set(getStartMenuPinnedLaunchIds());
    const out = [];
    const seen = new Set();
    const add = (launchId) => {
        if (out.length >= limit || seen.has(launchId) || pinned.has(launchId)) return;
        if (activity[launchId] && activity[launchId].hidden) return;
        const item = findStartMenuLaunchableById(launchId);
        if (!isStartMenuListedItem(item)) return;
        seen.add(launchId);
        out.push({ ...item, frequent: true });
    };
    Object.keys(activity)
        .filter((id) => (activity[id].n || 0) > 0)
        .sort((a, b) => (activity[b].n - activity[a].n) || ((activity[b].t || 0) - (activity[a].t || 0)))
        .forEach(add);
    START_MENU_DEFAULT_FREQUENT.forEach(add);
    return out;
}

/** Launch a row's app; launchId rows count toward the history (Start Search results count in Run's execute). */
function launchStartMenuItem(item) {
    if (!item || typeof item.action !== 'function') return;
    if (item.launchId) recordStartMenuLaunch(item.launchId);
    // assetPreload.warmLaunch: public/scripts/comp/assetPreload.js (keyboard / Run launches had no hover)
    if (item.launchId && window.assetPreload) assetPreload.warmLaunch(item.launchId);
    closeStartMenu();
    Promise.resolve()
        .then(() => item.action())
        .catch((err) => {
            console.error('Start menu launch failed:', err);
            showGlassToast('error', startMenuLabel(item) || 'Start', (err && err.message) || 'Could not open', false, 3000);
        });
}

// ---- All Programs ----

// The "Dreamscape 2026 R7" program folder (Yozora #468, Yukimi 2026-10-14): the package's apps live
// there like Vista's "Microsoft Office" folder, under the names the package uses, and leave the
// top level and Accessories. launchId -> folder label, in the folder's order.
const START_MENU_PACKAGE_FOLDER = 'Dreamscape 2026 R7';
const START_MENU_PACKAGE_APPS = [
    ['studio', 'DreamStudio'],
    ['workspace', 'Workspaces'],
    ['spellbook', 'Spellcaster'],
    ['reference', 'Reference'],
    ['bracket-generation', 'Phasewalker'],
    ['character-db', 'Characters'],
    ['expanders', 'Expanders'],
    ['presets', 'Spellbook']
];
const START_MENU_PACKAGE_IDS = new Set(START_MENU_PACKAGE_APPS.map((pair) => pair[0]));

function isStartMenuPackageApp(item) {
    return !!item && START_MENU_PACKAGE_IDS.has(item.launchId);
}

function getStartMenuPackageItems() {
    const byId = new Map();
    getAllAppsMenuItems().concat(flattenToolsSubmenuItems(buildToolsSubmenuItems()))
        .forEach((item) => { if (isStartMenuPackageApp(item) && !byId.has(item.launchId)) byId.set(item.launchId, item); });
    return START_MENU_PACKAGE_APPS
        .map(([launchId, label]) => {
            const item = byId.get(launchId);
            return item && isStartMenuItemLaunchable(item) ? { ...item, text: label, fullName: label } : null;
        })
        .filter(Boolean);
}

function getStartMenuAccessoriesItems() {
    const run = startMenuShellConfig.find((item) => item.launchId === 'run');
    return flattenToolsSubmenuItems(buildToolsSubmenuItems())
        .concat(run ? [run] : [])
        .filter((item) => item && !item.separator && typeof item.action === 'function' && isStartMenuItemLaunchable(item) && !isStartMenuPackageApp(item))
        .sort(byStartMenuLabel);
}

/** Apps by name (or in the organizer's order, Teleport among them), then the folders, like Vista's All Programs. */
function getStartMenuProgramsTree() {
    const custom = Array.isArray(startMenuCustomLayout) && startMenuCustomLayout.length > 0;
    const entries = getOrganizedAllAppsMenuItems()
        .filter((item) => !isStartMenuPackageApp(item))
        .map((item) => (item.isCustomFolder
            ? { folder: true, folderId: `custom-${item.folderId}`, text: item.text, children: (item.customFolderItems || []).filter((child) => !isStartMenuPackageApp(child)) }
            : item));
    if (!custom) entries.sort(byStartMenuLabel);
    // folders after the apps, by name: Accessories, Dreamscape 2026 R7
    entries.push({ folder: true, folderId: 'accessories', text: 'Accessories', children: getStartMenuAccessoriesItems() });
    entries.push({ folder: true, folderId: 'dreamscape-r7', text: START_MENU_PACKAGE_FOLDER, children: getStartMenuPackageItems() });
    entries.push({ folder: true, folderId: 'games', text: 'Games', children: startMenuGameLaunchables.filter(isStartMenuItemLaunchable).sort(byStartMenuLabel) });
    return entries.filter((entry) => !entry.folder || entry.children.length > 0);
}

function toggleStartMenuFolder(folderId) {
    const opening = !startMenuOpenFolders.has(folderId);
    if (opening) startMenuOpenFolders.add(folderId);
    else startMenuOpenFolders.delete(folderId);
    const list = startMenuEls && startMenuEls.list;
    const scrollTop = list ? list.scrollTop : 0;
    renderStartMenuList();
    if (!list) return;
    list.scrollTop = scrollTop;
    const row = list.querySelector(`.start-menu-row[data-folder-id="${CSS.escape(folderId)}"]`);
    if (!row) return;
    row.classList.add('is-hot');
    // bring the opened folder's contents into view, keeping the folder row visible
    const children = list.querySelectorAll(`.start-menu-row[data-parent-folder="${CSS.escape(folderId)}"]`);
    if (opening && children.length) children[children.length - 1].scrollIntoView({ block: 'nearest' });
    row.scrollIntoView({ block: 'nearest' });
}

// ---- rows ----

/** The icon a hovered place shows instead of the account frame (Vista: the frame goes, the item's icon fills its spot). */
function startMenuItemPictureUrl(item) {
    if (!item) return '';
    if (item.image) return item.image;
    if (item.folder) return `${START_MENU_ART}/folder-40.png`;
    return item.imageIcon ? resolveAppIconPath(item.imageIcon, 128) : '';
}

// Vista's tile crossfades from one item's icon to the next and never flashes the user's
// picture between neighbouring items (Yukimi 2026-10-13, the clip): two icon layers take
// turns, and leaving an item only shows the picture again after a short grace.
let startMenuTileLeaveTimer = null;
function setStartMenuTilePicture(item) {
    if (!startMenuEls) return;
    clearTimeout(startMenuTileLeaveTimer);
    const url = startMenuItemPictureUrl(item);
    const tile = startMenuEls.tile;
    if (!url) {
        startMenuTileLeaveTimer = setTimeout(() => tile.classList.remove('show-item'), 140);
        return;
    }
    const layers = [startMenuEls.itemPicture, startMenuEls.itemPictureB].filter(Boolean);
    const current = layers.find((img) => img.classList.contains('is-front')) || null;
    if (current && current.getAttribute('src') === url) {
        tile.classList.add('show-item');
        return;
    }
    const next = layers.find((img) => img !== current) || layers[0];
    next.src = url;
    layers.forEach((img) => img.classList.toggle('is-front', img === next));
    tile.classList.add('show-item');
}

function wireStartMenuTileHover(element, item) {
    element.addEventListener('mouseenter', () => setStartMenuTilePicture(item));
    element.addEventListener('mouseleave', () => setStartMenuTilePicture(null));
}

/** The drawn icon size of a row (CSS: desktop-shell.css), so the sized art matches it: Customize
 *  Start Menu's Start menu icon size for the pinned / most used rows, and the All Programs size. */
function startMenuRowIconPx(kind) {
    const prefs = startMenuTaskbarSettings();
    if (kind === 'pinned' || kind === 'frequent') {
        const size = prefs ? prefs.startIconSize : 'large';
        return START_MENU_ROW_ICON_PX[size] || START_MENU_ROW_ICON_PX.large;
    }
    if (kind === 'program' && prefs) {
        if (prefs.programsIconSize === 'large') return START_MENU_ROW_ICON_PX.large;
        if (prefs.programsIconSize === 'medium') return START_MENU_ROW_ICON_PX.medium;
    }
    return START_MENU_ROW_ICON_PX.small;
}

/** kind: 'pinned' | 'frequent' (large rows), 'program' | 'result' (small rows). */
function createStartMenuListRow(item, kind, options = {}) {
    const row = document.createElement('div');
    row.className = `start-menu-row start-menu-row-${kind}`;
    row.setAttribute('role', 'menuitem');
    if (options.depth) row.style.setProperty('--start-menu-depth', String(options.depth));
    if (options.parentFolder) row.dataset.parentFolder = options.parentFolder;

    const icon = document.createElement('span');
    icon.className = 'start-menu-row-icon';
    if (item.folder) {
        // the 40 px folder once the row draws it larger than 20 px (All Programs medium / large)
        icon.innerHTML = startMenuRowIconPx(kind) > START_MENU_ROW_ICON_PX.small
            ? `<img src="${START_MENU_ART}/folder-40.png" alt="">`
            : `<img src="${START_MENU_ART}/folder-20.png" srcset="${START_MENU_ART}/folder-20.png 1x, ${START_MENU_ART}/folder-40.png 2x" alt="">`;
    } else if (item.color) {
        const dot = document.createElement('span');
        dot.className = 'workspace-color-indicator';
        dot.style.backgroundColor = item.color;
        icon.appendChild(dot);
    } else {
        const iconPx = startMenuRowIconPx(kind);
        icon.innerHTML = getIconHTML(item.icon, item.imageIcon || null, '', iconPx);
    }
    row.appendChild(icon);

    const text = document.createElement('span');
    text.className = 'start-menu-row-text';
    const title = document.createElement('span');
    title.className = 'start-menu-row-title';
    // pinned rows: what it is in bold, the program under it (Vista's "Internet / Internet Explorer")
    title.textContent = kind === 'pinned' ? (item.text || startMenuLabel(item)) : startMenuLabel(item);
    text.appendChild(title);
    if (kind === 'pinned' && item.fullName && item.fullName !== item.text) {
        const sub = document.createElement('span');
        sub.className = 'start-menu-row-sub';
        sub.textContent = item.fullName;
        text.appendChild(sub);
    }
    row.appendChild(text);

    if (item.folder) {
        row.classList.add('is-folder');
        row.dataset.folderId = item.folderId;
        row.setAttribute('aria-expanded', startMenuOpenFolders.has(item.folderId) ? 'true' : 'false');
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStartMenuFolder(item.folderId);
        });
    } else {
        row.addEventListener('click', (e) => {
            e.stopPropagation();
            launchStartMenuItem(item);
        });
        // Decode the application's art while the pointer or focus is on its row (Yozora #518)
        // assetPreload.warmLaunch: public/scripts/comp/assetPreload.js
        if (item.launchId) {
            const warm = () => assetPreload.warmLaunch(item.launchId);
            row.addEventListener('pointerenter', warm);
            row.addEventListener('focus', warm);
        }
        if (item.launchId && kind !== 'result') attachStartMenuItemContextMenu(row, item);
    }
    return row;
}

function createStartMenuSeparator(className = 'start-menu-separator') {
    const sep = document.createElement('div');
    sep.className = className;
    sep.setAttribute('role', 'separator');
    return sep;
}

function renderStartMenuHome(list) {
    const pinned = getStartMenuPinnedItems().filter(isStartMenuListedItem);
    pinned.forEach((item) => list.appendChild(createStartMenuListRow(item, 'pinned')));
    const frequent = getStartMenuFrequentItems();
    if (pinned.length && frequent.length) list.appendChild(createStartMenuSeparator());
    frequent.forEach((item) => list.appendChild(createStartMenuListRow(item, 'frequent')));
}

function renderStartMenuPrograms(list) {
    getStartMenuProgramsTree().forEach((entry) => {
        list.appendChild(createStartMenuListRow(entry, 'program'));
        if (!entry.folder || !startMenuOpenFolders.has(entry.folderId)) return;
        entry.children.forEach((child) => {
            list.appendChild(createStartMenuListRow(child, 'program', { depth: 1, parentFolder: entry.folderId }));
        });
    });
}

// ---- Start Search ----

const START_MENU_SEARCH_GROUPS = { app: 'Programs', workspace: 'Planets', note: 'Notes', shortcut: 'Shortcuts' };

function renderStartMenuSearchResults(list) {
    const query = startMenuEls ? startMenuEls.search.value.trim() : '';
    if (!startMenuSearchEntries.length) {
        const empty = document.createElement('div');
        empty.className = 'start-menu-search-empty';
        empty.textContent = 'No items match your search.';
        list.appendChild(empty);
    }
    const appItems = new Map(collectStartMenuLaunchableDescriptors().map((item) => [item.launchId, item]));
    const groups = new Map();
    startMenuSearchEntries.forEach((entry) => {
        const label = START_MENU_SEARCH_GROUPS[entry.category]
            || (window.RUN_CATEGORY_LABELS && window.RUN_CATEGORY_LABELS[entry.category])
            || 'Other';
        if (!groups.has(label)) groups.set(label, []);
        groups.get(label).push(entry);
    });
    groups.forEach((entries, label) => {
        const header = document.createElement('div');
        header.className = 'start-menu-group-header';
        header.textContent = label;
        list.appendChild(header);
        entries.forEach((entry) => {
            const app = entry.launchId ? appItems.get(entry.launchId) : null;
            list.appendChild(createStartMenuListRow({
                text: entry.label,
                icon: entry.icon || (window.RUN_CATEGORY_ICONS && window.RUN_CATEGORY_ICONS[entry.category]) || 'fas fa-circle',
                imageIcon: app ? app.imageIcon : null,
                action: entry.execute
            }, 'result'));
        });
    });
    list.appendChild(createStartMenuSeparator());
    list.appendChild(createStartMenuListRow({
        text: 'See all results',
        icon: 'fas fa-magnifying-glass',
        action: () => openRunWithStartSearch(query)
    }, 'result'));
    const first = list.querySelector('.start-menu-row');
    if (first) first.classList.add('is-hot');
}

/** "See all results": the Run window with the query (network results, the action panel). */
async function openRunWithStartSearch(query) {
    await featureLoader.loadFeature('run');
    runApplet.open();
    if (!query || !runApplet.input) return;
    runApplet.input.value = query;
    runApplet.input.dispatchEvent(new Event('input', { bubbles: true }));
}

function onStartMenuSearchInput() {
    const query = startMenuEls.search.value.trim();
    const seq = ++startMenuSearchSeq;
    if (!query) {
        startMenuSearchEntries = [];
        if (startMenuView === 'search') setStartMenuView('home');
        return;
    }
    // the run index is lazy (featureLoader run_index): load it on the first keystroke
    if (typeof searchRunCommands !== 'function') {
        featureLoader.loadFeature('run_index').then(() => {
            if (seq === startMenuSearchSeq && typeof searchRunCommands === 'function') onStartMenuSearchInput();
        }).catch((err) => console.warn('[startMenu] run index failed to load', err));
        return;
    }
    searchRunCommands(query, (results) => {
        if (seq !== startMenuSearchSeq) return;
        // network results stay in Run ("See all results")
        startMenuSearchEntries = (results || []).filter((entry) => typeof entry.execute === 'function' && !entry.isDeferredNetwork);
        startMenuView = 'search';
        renderStartMenuList();
    });
}

// ---- keyboard: typing goes to Start Search, arrows move through the left pane ----

function moveStartMenuHot(delta) {
    const rows = [...startMenuEls.list.querySelectorAll('.start-menu-row')];
    if (!rows.length) return;
    let index = rows.findIndex((row) => row.classList.contains('is-hot'));
    rows.forEach((row) => row.classList.remove('is-hot'));
    index = index < 0 ? (delta > 0 ? 0 : rows.length - 1) : (index + delta + rows.length) % rows.length;
    rows[index].classList.add('is-hot');
    rows[index].scrollIntoView({ block: 'nearest' });
}

function onStartMenuSearchKeydown(e) {
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        moveStartMenuHot(e.key === 'ArrowDown' ? 1 : -1);
    } else if (e.key === 'Enter') {
        e.preventDefault();
        const hot = startMenuEls.list.querySelector('.start-menu-row.is-hot');
        if (hot) hot.click();
    } else if (e.key === 'Escape') {
        e.preventDefault();
        e.stopPropagation();
        if (startMenuEls.search.value) {
            startMenuEls.search.value = '';
            onStartMenuSearchInput();
        } else if (startMenuView !== 'home') {
            setStartMenuView('home');
        } else {
            closeStartMenu();
        }
    }
}

// ---- views ----

function setStartMenuView(view) {
    startMenuView = view;
    if (view !== 'search' && startMenuEls && startMenuEls.search.value) {
        startMenuEls.search.value = '';
        startMenuSearchEntries = [];
    }
    renderStartMenuList();
}

function renderStartMenuList() {
    if (!startMenuEls) return;
    const { list, menu, allPrograms, allProgramsLabel } = startMenuEls;
    list.textContent = '';
    list.scrollTop = 0;
    menu.dataset.view = startMenuView;
    if (startMenuView === 'search') renderStartMenuSearchResults(list);
    else if (startMenuView === 'programs') renderStartMenuPrograms(list);
    else renderStartMenuHome(list);
    const back = startMenuView !== 'home';
    allPrograms.classList.toggle('is-back', back);
    allProgramsLabel.textContent = back ? 'Back' : 'All Programs';
}

// ---- right column ----

/** The places column as the Start menu shows it (Customize Start Menu and Privacy applied). */
function getStartMenuPlaces() {
    return getStartMenuPlacesAll()
        .filter((place) => startMenuPlaceShown(place))
        .filter((place, i, all) => !place.separator || (i > 0 && !all[i - 1].separator && i < all.length - 1));
}

/** Every place the column can show (Customize Start Menu lists them). */
function getStartMenuPlacesAll() {
    const desktop = isDesktopStartMenuEnvironment();
    const launch = (launchId) => () => {
        const item = findStartMenuLaunchableById(launchId);
        if (item) launchStartMenuItem(item);
    };
    const controlPanel = (page) => async () => {
        await featureLoader.loadFeature('control_panel');
        // melatonControlPanel.open: public/scripts/comp/melatonControlPanel.js
        if (window.melatonControlPanel) window.melatonControlPanel.open(page);
    };
    return [
        { id: 'user', text: startMenuUserName(), action: () => openExplorerApplet() },
        { id: 'cartograph', text: 'Cartograph', imageIcon: 'vista-explorer.png', action: launch('explorer') },
        { id: 'gallery', text: 'Gallery', imageIcon: 'art.png', desktopOnly: true, action: launch('workspace') },
        { id: 'notion', text: 'Notion', imageIcon: 'vista-journal.png', action: launch('notebook') },
        // Vista's Games place: the Games Explorer (public/scripts/comp/desktop-apps/vista-games/gamesExplorer.js)
        { id: 'games', text: 'Games', imageIcon: 'vista-games.png', desktopOnly: true, action: launch('games-explorer') },
        { separator: true },
        { id: 'recent', text: 'Recent Items', flyout: true },
        { id: 'network', text: 'Network and Server Center', image: '/static_images/melaton/net-globe.png', action: controlPanel('network') },
        { separator: true },
        { id: 'control-panel', text: 'Control Panel', imageIcon: 'vista-control-panel.png', action: controlPanel('home') },
        // Help and Support: the project's page on Yozora, in Alchemy (openGrimoireUrl: featureLoader.js)
        { id: 'help', text: 'Help and Support', imageIcon: 'vista-help.png', action: () => openGrimoireUrl(START_MENU_HELP_URL) },
    ].filter((place) => !(place.desktopOnly && !desktop));
}

/** Customize Start Menu's "Don't display this item", and Privacy's recently opened files (Recent Items). */
function startMenuPlaceShown(place) {
    const prefs = startMenuTaskbarSettings();
    if (!prefs || place.separator || place.id === 'user') return true;
    if (place.id === 'recent' && prefs.recentFiles === false) return false;
    return prefs.places[place.id] !== false;
}

/** Recent Items: this workspace's recently opened documents (public/scripts/comp/recentItems.js:
 *  Cartograph files, browser sessions' pages, Studio images, Director sessions, notes), rebuilt as
 *  the pointer reaches it. Programs live in the most used list, not here. */
function attachStartMenuRecentItemsMenu(row) {
    if (typeof contextMenu === 'undefined' || !contextMenu) return;
    const refresh = () => {
        const store = window.recentItems;
        const recent = store ? store.list() : [];
        const byKey = new Map(recent.map((entry) => [entry.key, entry]));
        const items = recent.length
            ? recent.map((entry) => ({
                icon: entry.icon || recentItemIconClass(entry.kind),
                text: entry.title,
                action: `recent:${entry.key}`
            }))
            : [{ text: '(Empty)', disabled: true }];
        contextMenu.detachClickMenuFromElement(row);
        contextMenu.attachClickMenuToElement(row, {
            sections: [{
                type: 'list',
                items: items.concat([{ separator: true }, { text: 'Clear Recent Items list', action: 'clear-recent', disabled: !recent.length }])
            }],
            onAction: (action) => {
                if (action === 'clear-recent') {
                    if (store) store.clear();
                    return;
                }
                const entry = byKey.get(String(action).slice('recent:'.length));
                if (entry && store) {
                    closeStartMenu();
                    void store.open(entry);
                }
            }
        });
    };
    row.addEventListener('pointerenter', refresh);
    row.addEventListener('pointerdown', refresh, true);
    row.addEventListener('focus', refresh);
    refresh();
}

/** A Recent Items row's glyph by what it is (the menu draws Font Awesome glyphs). */
function recentItemIconClass(kind) {
    switch (kind) {
        case 'page': return 'fas fa-globe';
        case 'studio': return 'fas fa-compass-drafting';
        case 'director': return 'fas fa-clapperboard';
        case 'note': return 'fas fa-note-sticky';
        case 'picture': return 'fas fa-image';
        case 'folder': return 'fas fa-folder';
        default: return 'fas fa-file';
    }
}

function renderStartMenuPlaces() {
    const container = startMenuEls.places;
    // the old rows' click menus (Recent Items) go with them, or each open leaves one behind
    if (typeof contextMenu !== 'undefined' && contextMenu) {
        container.querySelectorAll('[data-click-menu]').forEach((el) => contextMenu.detachClickMenuFromElement(el));
    }
    container.textContent = '';
    getStartMenuPlaces().forEach((place) => {
        if (place.separator) {
            container.appendChild(createStartMenuSeparator('start-menu-place-separator'));
            return;
        }
        const row = document.createElement('div');
        row.className = 'start-menu-place' + (place.flyout ? ' has-flyout' : '') + (place.id === 'user' ? ' is-user' : '');
        row.setAttribute('role', 'menuitem');
        row.tabIndex = -1;
        row.textContent = place.text;
        row.title = place.text;
        if (place.flyout) {
            attachStartMenuRecentItemsMenu(row);
        } else {
            row.addEventListener('click', (e) => {
                e.stopPropagation();
                closeStartMenu();
                Promise.resolve().then(() => place.action()).catch((err) => console.error(`Start menu ${place.id}:`, err));
            });
        }
        wireStartMenuTileHover(row, place);
        container.appendChild(row);
    });
}

function buildStartMenuPower() {
    const container = startMenuEls.power;
    container.textContent = '';
    const button = (className, title, onClick) => {
        const btn = document.createElement('button');
        btn.type = 'button';
        btn.className = `start-menu-power-button ${className}`;
        btn.title = title;
        btn.setAttribute('aria-label', title);
        if (onClick) btn.addEventListener('click', onClick);
        container.appendChild(btn);
        return btn;
    };
    // what the two buttons do: Customize Start Menu (public/scripts/comp/taskbarSettings.js)
    const prefs = startMenuTaskbarSettings() || {};
    const power = START_MENU_POWER_BUTTONS[prefs.powerButton] || START_MENU_POWER_BUTTONS.shutdown;
    button(power.className, power.title, power.run);
    if (isDesktopStartMenuEnvironment()) {
        const lock = START_MENU_LOCK_BUTTONS[prefs.lockButton] || START_MENU_LOCK_BUTTONS.lock;
        button(lock.className, lock.title, lock.run);
    }
    attachStartMenuPowerMenu(button('is-arrow', 'Show more options'));
}

// The power button's choices, drawn with Vista's own cells (scripts/build-vista-start-menu-art.js):
// shut down and restart the red power cell, log off the amber disconnect cell
const START_MENU_POWER_BUTTONS = {
    shutdown: { className: 'is-shutdown', title: 'Shut down', run: () => runClientShutdownDirect() },
    restart: { className: 'is-shutdown is-restart', title: 'Restart', run: () => runClientRestartDirect() },
    logoff: { className: 'is-disconnect', title: 'Log off', run: () => runLogoutDirect() }
};

// The lock button's: the padlock, or the lock cell with the disconnect X
const START_MENU_LOCK_BUTTONS = {
    lock: { className: 'is-lock', title: 'Lock this computer', run: () => runClientLockDirect() },
    logoff: { className: 'is-lock is-lock-logoff', title: 'Log off', run: () => runLogoutDirect() }
};

// ---- build ----

function ensureStartMenuElements() {
    if (!startMenu) startMenu = document.getElementById('startMenu');
    if (startMenuEls || !startMenu) return startMenuEls;
    const q = (selector) => startMenu.querySelector(selector);
    startMenuEls = {
        menu: startMenu,
        list: q('#startMenuItems'),
        allPrograms: q('.start-menu-all-programs'),
        allProgramsLabel: q('.start-menu-all-programs-label'),
        search: q('#startMenuSearchInput'),
        places: q('.start-menu-places'),
        power: q('.start-menu-power'),
        tile: q('.start-menu-user-tile'),
        itemPicture: q('.start-menu-user-tile-item:not(.start-menu-user-tile-item-b)'),
        itemPictureB: q('.start-menu-user-tile-item-b')
    };
    if (Object.values(startMenuEls).some((el) => !el)) {
        console.error('Start menu markup is incomplete (app.html #startMenu)');
        startMenuEls = null;
        return null;
    }
    startMenuEls.allPrograms.addEventListener('click', (e) => {
        e.stopPropagation();
        setStartMenuView(startMenuView === 'home' ? 'programs' : 'home');
        if (startMenuHasFinePointer()) startMenuEls.search.focus();
    });
    if (typeof contextMenu !== 'undefined' && contextMenu) {
        contextMenu.attachToElement(startMenuEls.allPrograms, {
            sections: [{ type: 'list', items: [{ icon: 'fas fa-arrows-up-down-left-right', text: 'Organize Start Menu…', action: 'organize' }] }],
            onAction: () => {
                closeStartMenu();
                void featureLoader.loadFeature('start_menu_organizer').then(() => {
                    // openStartMenuOrganizer: public/scripts/comp/desktop-apps/startMenuOrganizer.js
                    openStartMenuOrganizer();
                });
            }
        });
    }
    startMenuEls.search.addEventListener('input', onStartMenuSearchInput);
    startMenuEls.search.addEventListener('keydown', onStartMenuSearchKeydown);
    startMenuEls.list.addEventListener('mousemove', (e) => {
        const row = e.target.closest('.start-menu-row');
        if (!row || row.classList.contains('is-hot')) return;
        startMenuEls.list.querySelectorAll('.start-menu-row.is-hot').forEach((el) => el.classList.remove('is-hot'));
    });
    return startMenuEls;
}

function buildStartMenu() {
    if (!ensureStartMenuElements()) return;
    renderStartMenuList();
    renderStartMenuPlaces();
    buildStartMenuPower();
}

function closeAllStartMenuSubmenus() {
    if (typeof contextMenu !== 'undefined' && contextMenu && contextMenu.hideMenu) {
        contextMenu.hideMenu();
    }
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

    if (ensureStartMenuElements()) {
        startMenuOpenFolders.clear();
        setStartMenuView('home');
        renderStartMenuPlaces();
        buildStartMenuPower();
        setStartMenuTilePicture(null);
        if (startMenuHasFinePointer()) startMenuEls.search.focus({ preventScroll: true });
        // warm Start Search's index while the menu fades in
        if (typeof searchRunCommands !== 'function') void featureLoader.loadFeature('run_index').catch(() => {});
    }

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

/** Right-click on a start menu row: pin / unpin, order, remove from the most used list, desktop. */
function attachStartMenuItemContextMenu(element, item) {
    if (!contextMenu || !item.launchId) return;

    const contextMenuConfig = {
        sections: [
            {
                type: 'list',
                items: [
                    {
                        icon: 'fas fa-thumbtack',
                        text: 'Pin to Start Menu',
                        action: 'toggle-start-menu-pin',
                        hidden: () => !isStartMenuEntryEnabled(item),
                        loadfn: (ctxItem) => {
                            const pinned = isStartMenuItemPinned(item.launchId);
                            ctxItem.text = pinned ? 'Unpin from Start Menu' : 'Pin to Start Menu';
                        }
                    },
                    {
                        icon: 'fas fa-xmark',
                        text: 'Remove from this list',
                        action: 'remove-frequent',
                        hidden: () => !item.frequent
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
                    },
                    {
                        // Vista's Start menu: a program goes to Quick Launch (public/scripts/comp/taskbarSettings.js)
                        icon: 'fas fa-bolt',
                        text: 'Add to Quick Launch',
                        action: 'add-to-quick-launch',
                        hidden: () => !window.taskbarSettings || isStartMenuPlanetLaunchId(item.launchId),
                        loadfn: (ctxItem) => {
                            const already = !!(window.taskbarSettings && window.taskbarSettings.hasQuickLaunch(item.launchId));
                            ctxItem.disabled = already;
                            ctxItem.text = already ? 'Already in Quick Launch' : 'Add to Quick Launch';
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
            if (action === 'remove-frequent') {
                hideStartMenuFrequentItem(item.launchId);
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
                return;
            }
            if (action === 'add-to-quick-launch' && window.taskbarSettings) {
                window.taskbarSettings.addQuickLaunch(item.launchId);
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
async function setDesktopWallpaper(wallpaperPath, wallpaperPosition = 'center center') {
    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';

    if (!workspaces || !workspaces[currentWorkspace]) {
        console.warn('Current workspace not found');
        return;
    }

    // Update local workspace object first
    if (wallpaperPath) {
        workspaces[currentWorkspace].wallpaper = wallpaperPath;
        workspaces[currentWorkspace].wallpaperPosition = wallpaperPosition || 'center center';
    } else {
        delete workspaces[currentWorkspace].wallpaper;
        delete workspaces[currentWorkspace].wallpaperPosition;
    }

    // Regenerate styles for immediate visual update (dev mode). Production paints
    // from the workspace record; compiled CSS arrives later.
    generateWorkspaceStyles(currentWorkspace);
    // noteWallpaperFileReload, syncDesktopWallpaperInline: public/scripts/comp/workspaceUtils.js
    noteWallpaperFileReload(workspaces[currentWorkspace].wallpaper);
    syncDesktopWallpaperInline(currentWorkspace);

    // Save via WebSocket (server will broadcast to other clients)
    if (wsClient && wsClient.isConnected()) {
        const settings = {
            wallpaper: wallpaperPath,
            wallpaperPosition: wallpaperPath ? (wallpaperPosition || 'center center') : null
        };
        await wsClient.updateWorkspaceSettings(currentWorkspace, settings);
    }
}

// Precache wallpaper: delete old cache entry and load new one
async function precacheWallpaper(wallpaperUrl) {
    try {
        // refreshWallpaper: public/scripts/comp/serviceWorkerManager.js
        // preloadWallpaperIntoMemory: public/scripts/comp/workspaceUtils.js
        if (window.serviceWorkerManager && window.serviceWorkerManager.refreshWallpaper) {
            await window.serviceWorkerManager.refreshWallpaper(wallpaperUrl);
        } else if (window.serviceWorkerManager) {
            await window.serviceWorkerManager.deleteAndPrecache(wallpaperUrl);
        }
        await preloadWallpaperIntoMemory(wallpaperUrl);
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
            const response = await wsClient.uploadWallpaper(base64, currentWorkspace, file.name);

            if (response.success) {
                // Precache the new wallpaper: delete old cache entry, then load and cache the new one
                const wallpaperUrl = localCacheWallpaperUrl(currentWorkspace);
                await precacheWallpaper(wallpaperUrl);

                // Update the wallpaper state to use the custom wallpaper
                desktopSettingsState.wallpaperUrl = wallpaperUrl;

                updateGlassToastComplete(toastId, {
                    type: 'success',
                    title: 'Wallpaper Uploaded',
                    message: 'Custom wallpaper uploaded successfully',
                    customIcon: '<i class="fas fa-check-circle"></i>',
                    showProgress: false,
                    timeout: 3000
                });
                // the response carries the upload's history item (Desktop Background, cplDesktopBackground.js)
                return response;
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
    startMenuButtonStyle: 'workspace',
    startMenuButtonLogo: 'dreamscape',
    useApplicationImageIcon: (() => {
        try {
            return localStorage.getItem('useApplicationImageIcon') === 'true';
        } catch (e) {
            return false;
        }
    })()
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

function normalizeStartMenuButtonLogoClient(logo) {
    return logo === 'royal' || logo === 'vista' || logo === 'dreamscape' ? logo : 'dreamscape';
}

function startMenuButtonLogoUrl(logo) {
    const id = normalizeStartMenuButtonLogoClient(logo);
    if (id === 'royal') return '/static_images/windows-logo-royal.png';
    if (id === 'vista') return '/static_images/windows-logo-vista.png';
    // 731 px master compiled to display sizes (modules/appIconRuntimeAssets.js EXTRA_MASTERS)
    return '/static_images/app_icons/48/dreamscape-logo.webp';
}

function readDesktopSettingsStartMenuButtonPreference() {
    return {
        preset: normalizeStartMenuButtonPresetClient(desktopSettingsGlobalState.startMenuButtonPreset),
        customText: typeof desktopSettingsGlobalState.startMenuButtonCustomText === 'string'
            ? desktopSettingsGlobalState.startMenuButtonCustomText.trim().slice(0, 24)
            : '',
        style: normalizeStartMenuButtonStyleClient(desktopSettingsGlobalState.startMenuButtonStyle),
        logo: normalizeStartMenuButtonLogoClient(desktopSettingsGlobalState.startMenuButtonLogo)
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

function applyStartMenuButtonLogoToElement(btn, logo) {
    if (!btn) return;
    const img = btn.querySelector('.taskbar-start-button-logo');
    if (!img) return;
    const id = normalizeStartMenuButtonLogoClient(logo);
    img.src = startMenuButtonLogoUrl(id);
    img.classList.toggle('is-royal', id === 'royal');
    img.classList.toggle('is-vista', id === 'vista');
    img.alt = id === 'dreamscape' ? 'Dreamscape' : '';
}

function syncStartMenuButtonTextElement(textEl, preset, customText) {
    if (!textEl) return;
    const displayText = resolveStartMenuButtonDisplayText(preset, customText);
    textEl.textContent = displayText;
    return displayText;
}

function applyStartMenuButtonAppearanceToTaskbar(preset, customText, style, logo) {
    const btn = document.getElementById('taskbarStartBtn');
    const textEl = btn ? btn.querySelector('.taskbar-start-button-text') : null;
    if (textEl) {
        const displayText = syncStartMenuButtonTextElement(textEl, preset, customText);
        if (btn) {
            btn.title = displayText;
        }
    }
    applyStartMenuButtonStyleToElement(btn, style);
    applyStartMenuButtonLogoToElement(btn, logo);
}

function applyUseApplicationImageIcon(enabled) {
    const on = enabled === true;
    try {
        localStorage.setItem('useApplicationImageIcon', on ? 'true' : 'false');
    } catch (e) {
        /* */
    }
    if (!document.body) return;
    document.body.classList.toggle('use-app-image-icons', on);
}
applyUseApplicationImageIcon(desktopSettingsGlobalState.useApplicationImageIcon);

function resolveWorkspaceWallpaperUrl(wallpaperPath) {
    if (!wallpaperPath || typeof wallpaperPath !== 'string') {
        return null;
    }
    const [type, ...idParts] = wallpaperPath.split(':');
    const id = idParts.join(':');
    switch (type) {
        case 'file':
            return localGalleryImageUrl(id);
        case 'cache':
            return localCacheUploadUrl(id);
        case 'cache-preview':
            return localCachePreviewUrl(id);
        case 'vibe':
            return `/cache/vibe/${id}`;
        case 'wallpaper':
            return localCacheWallpaperUrl(id);
        case 'url':
            return id;
        default:
            return null;
    }
}

let desktopSettingsPersistedStartMenuButton = { preset: 'start-ja', customText: '', style: 'workspace', logo: 'dreamscape' };
let desktopSettingsPersistedUseApplicationImageIcon = false;

function setupDesktopContextMenu() {
    const desktopIcons = document.getElementById('desktopIcons');
    const freeformContainer = document.getElementById('desktopFreeformContainer');
    if ((!desktopIcons && !freeformContainer) || !contextMenu) return;

    // Vista's desktop menu: View, Sort By, Refresh, Paste, New, Personalize
    // (desktopIconView.desktopMenuConfig: public/scripts/comp/desktopIconView.js)
    const desktopContextMenuConfig = (window.desktopIconView && window.desktopIconView.desktopMenuConfig()) || {
        beforeShow: () => {
            if (typeof explorerApplet !== 'undefined' && explorerApplet) {
                explorerApplet._contextMenuTarget = null;
            }
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
                            if (typeof explorerApplet === 'undefined' || !explorerApplet) return true;
                            return !explorerApplet.clipboard;
                        }
                    },
                    {
                        icon: 'fa-light fa-paint-roller',
                        text: 'Personalize',
                        action: 'open-desktop-settings'
                    },
                    {
                        icon: 'fa-light fa-screencast',
                        text: 'Remote Access',
                        action: 'open-remote-access-settings'
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

function shouldExitDesktopOnWorkspaceMaximise() {
    // Maximizing the workspace window stays in desktop mode so it keeps behaving like a window
    // (Yukimi, #403). Leaving desktop mode is the explicit Melaton Desktop toggle only.
    return false;
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

function setLiveWindowRepositioningEnabled(enabled) {
    document.documentElement.classList.toggle('live-window-repositioning-enabled', enabled === true);
}

function getWindowFrameElement() {
    if (cachedWindowFrameEl && cachedWindowFrameEl.isConnected) {
        return cachedWindowFrameEl;
    }
    let frame = document.getElementById('modalDragResizeFrame');
    if (!frame) {
        frame = document.createElement('div');
        frame.id = 'modalDragResizeFrame';
        frame.className = 'modal-drag-resize-frame hidden';
        document.body.appendChild(frame);
    }
    cachedWindowFrameEl = frame;
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
    const frame = cachedWindowFrameEl || document.getElementById('modalDragResizeFrame');
    if (frame) {
        frame.classList.add('hidden');
    }
}

function isLiveWindowRepositioningEnabled() {
    return desktopSettingsGlobalState.liveWindowRepositioning === true;
}

/**
 * Personalization (this workspace) and the global look are Control Panel pages: Personalization's
 * hub (cplPersonalization.js), Desktop Background (cplDesktopBackground.js), Window Color.
 * @param {string|null} wallpaperPath a picture to select on Desktop Background (file:… / cache:…)
 * @param {'workspace'|'global'} [scope]
 */
async function openDesktopSettingsModal(wallpaperPath = null, scope = 'workspace') {
    await featureLoader.loadFeature('control_panel');
    registerDesktopSettingsControlPanelPages();
    const cpl = window.melatonControlPanel;
    if (!cpl || typeof cpl.open !== 'function') return;
    // "Set as desktop background" opens Desktop Background with the picture selected
    if (wallpaperPath && window.cplDesktopBackground && typeof window.cplDesktopBackground.openWith === 'function') {
        cpl.open('personalization');
        window.cplDesktopBackground.openWith(wallpaperPath);
        return;
    }
    cpl.open(scope === 'global' ? 'window-color' : 'personalization');
}

// ---- Control Panel's Keyboard page ----

let desktopSettingsCplRegistered = false;

/** Control Panel's Keyboard page: the virtual keyboard switch (a Vista check box, saved as it is
 *  changed). The other settings moved to Personalization's pages (cplPersonalization.js). */
function setDesktopVirtualKeyboardEnabled(enabled) {
    desktopSettingsGlobalState.virtualKeyboardEnabled = enabled;
    try {
        localStorage.setItem('virtualKeyboardEnabled', enabled ? 'true' : 'false');
    } catch (err) {
        /* */
    }
    // setVirtualKeyboardEnabled: public/scripts/comp/virtualKeyboard.js
    if (typeof setVirtualKeyboardEnabled === 'function') {
        setVirtualKeyboardEnabled(enabled);
    }
}

function registerDesktopSettingsControlPanelPages() {
    if (desktopSettingsCplRegistered) return;
    const cpl = window.melatonControlPanel;
    if (!cpl || typeof cpl.registerPage !== 'function') return;
    desktopSettingsCplRegistered = true;
    cpl.registerPage('keyboard', {
        title: () => 'Keyboard',
        tasks: () => `
            <div class="cpl-task-group">
                <h3 class="cpl-task-heading">Tasks</h3>
                <ul class="cpl-task-list">${cpl.taskLinkHtml('Personalization', 'nav', 'personalization')}</ul>
            </div>
            <div class="cpl-task-group cpl-task-group--see-also">
                <h3 class="cpl-task-heading">See also</h3>
                <ul class="cpl-task-list">${cpl.taskLinkHtml('Taskbar and Start Menu', 'item', 'taskbar')}${cpl.taskLinkHtml('Remote Access', 'item', 'remote-access')}</ul>
            </div>`,
        body: () => `
            <div class="cpl-mail-page">
                <h1 class="cpl-page-title">Input</h1>
                <p>Choose how you type on touch devices.</p>
                <div class="cpl-mail-options">
                    <div><input type="checkbox" id="cplVirtualKeyboardCheck"><label for="cplVirtualKeyboardCheck">Use the virtual keyboard instead of the system one</label></div>
                </div>
                <p class="cpl-intro">Docked at the bottom on mobile; a floating window on the desktop.</p>
            </div>`,
        mount: (main) => {
            const check = main.querySelector('#cplVirtualKeyboardCheck');
            if (!check) return;
            check.checked = readDesktopSettingsVirtualKeyboardPreference();
            check.addEventListener('change', () => setDesktopVirtualKeyboardEnabled(check.checked));
        }
    });
}

// melatonControlPanel.js calls this when featureLoader loads it, so the Personalization and
// Global Settings items work when Control Panel is opened first.

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

// Stock wallpapers (public/static_images/wallpapers, Yozora #424). A workspace with no
// wallpaper shows the default through the --desktop-wallpaper-default fallback (desktop-shell.css);
// picking "default" clears the workspace's own wallpaper.
const STOCK_DESKTOP_WALLPAPERS = [
    { name: 'Melaton Aurora (default)', url: null },
    { name: 'Aurora', url: '/static_images/wallpapers/aurora-plain.webp' },
    { name: 'Blue Aurora', url: '/static_images/wallpapers/aurora-blue.webp' },
    { name: 'Dusk Aurora', url: '/static_images/wallpapers/aurora-dusk.webp' },
    { name: 'Emerald Aurora', url: '/static_images/wallpapers/aurora-emerald.webp' }
];

function normalizeNaxtElevatePinsClient(value) {
    if (value === true || value === 'true') return 1;
    const n = Number(value);
    if (n === 1 || n === 2 || n === 3) return n;
    return 0;
}

let remoteAccessSettingsState = {
    defaultGenerationMethod: 'studio',
    autoGenerate: false,
    openGeneratedImages: 'ledge',
    minPrintsPerTurn: 1,
    maxPrintsPerTurn: 8
};

function normalizeRemoteAccessGenerationMethodClient(raw) {
    const value = String(raw || '').toLowerCase().replace(/[\s_-]+/g, '');
    if (value === 'auto') return 'auto';
    if (value === 'detached' || value === 'detachedrequest' || value === 'generateimage') {
        return 'detached';
    }
    return 'studio';
}

function normalizeRemoteAccessOpenGeneratedClient(raw) {
    const value = String(raw || '').toLowerCase();
    if (value === 'ledge') return 'ledge';
    if (value === 'glancewell') return 'glancewell';
    if (value === 'lumen') return 'lumen';
    if (value === 'disabled' || value === 'off' || value === 'none') return 'disabled';
    return 'ledge';
}

function normalizeRemoteAccessPrintsClient(raw, fallback) {
    const n = Number(raw);
    if (!Number.isFinite(n)) return fallback;
    return Math.min(8, Math.max(1, Math.round(n)));
}

function applyRemoteAccessSettingsToState(settings) {
    const src = settings && typeof settings === 'object' ? settings : {};
    let minPrintsPerTurn = normalizeRemoteAccessPrintsClient(src.minPrintsPerTurn, 1);
    let maxPrintsPerTurn = normalizeRemoteAccessPrintsClient(src.maxPrintsPerTurn, 8);
    if (maxPrintsPerTurn < minPrintsPerTurn) maxPrintsPerTurn = minPrintsPerTurn;
    remoteAccessSettingsState = {
        defaultGenerationMethod: normalizeRemoteAccessGenerationMethodClient(src.defaultGenerationMethod),
        autoGenerate: src.autoGenerate === true,
        openGeneratedImages: normalizeRemoteAccessOpenGeneratedClient(src.openGeneratedImages),
        minPrintsPerTurn,
        maxPrintsPerTurn
    };
}

async function persistRemoteAccessSettingsPatch(patch) {
    applyRemoteAccessSettingsToState({ ...remoteAccessSettingsState, ...patch });
    await persistUserGlobalSettingsPatch({ remoteAccess: { ...remoteAccessSettingsState } });
}

/** Remote Access opens Remote Access Properties (remoteAccessProperties.js, in Control Panel's
 *  bundle), Vista's System Properties > Remote tab. */
async function openRemoteAccessSettingsModal() {
    await featureLoader.loadFeature('control_panel');
    if (window.remoteAccessProperties && typeof window.remoteAccessProperties.open === 'function') {
        window.remoteAccessProperties.open();
    }
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
            useApplicationImageIcon: desktopSettingsGlobalState.useApplicationImageIcon === true,
            startMenuButton,
            domainName: melatonDomainName(),
            connectionName: melatonConnectionName(),
            ...(startMenuPinnedLaunchIds === null
                ? {}
                : { startMenuPinned: startMenuPinnedLaunchIds.slice() })
        },
        naxt: {
            elevatePins
        },
        remoteAccess: { ...remoteAccessSettingsState },
        // getImageGenerationSettings: public/scripts/comp/imageGenerationSettings.js
        imageGeneration: { ...getImageGenerationSettings() }
    };
}

/**
 * Melaton's domain name (the server as its domain controller; config.json
 * userGlobalSettings.desktop.domainName): the user settings once loaded, before that what the
 * server's public /status said (websocket.js melatonConnection), then the default.
 */
function melatonDomainName() {
    return desktopSettingsGlobalState.domainName
        || (window.wsClient && window.wsClient.melatonConnection && window.wsClient.melatonConnection.domain)
        || 'DREAMSCAPE';
}
window.melatonDomainName = melatonDomainName;

/** The network interface the client reaches the domain through (desktop.connectionName). */
function melatonConnectionName() {
    return desktopSettingsGlobalState.connectionName
        || (window.wsClient && window.wsClient.melatonConnection && window.wsClient.melatonConnection.connectionName)
        || 'VPN Connection';
}
window.melatonConnectionName = melatonConnectionName;

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
        if (typeof desktop.domainName === 'string' && desktop.domainName.trim()) {
            desktopSettingsGlobalState.domainName = desktop.domainName.trim().slice(0, 64);
        }
        if (typeof desktop.connectionName === 'string' && desktop.connectionName.trim()) {
            desktopSettingsGlobalState.connectionName = desktop.connectionName.trim().slice(0, 64);
        }
        if (desktop.startMenuButton && typeof desktop.startMenuButton === 'object') {
            const preset = normalizeStartMenuButtonPresetClient(desktop.startMenuButton.preset);
            const customText = typeof desktop.startMenuButton.customText === 'string'
                ? desktop.startMenuButton.customText.trim().slice(0, 24)
                : '';
            const style = normalizeStartMenuButtonStyleClient(desktop.startMenuButton.style);
            const logo = normalizeStartMenuButtonLogoClient(desktop.startMenuButton.logo);
            desktopSettingsGlobalState.startMenuButtonPreset = preset;
            desktopSettingsGlobalState.startMenuButtonCustomText = customText;
            desktopSettingsGlobalState.startMenuButtonStyle = style;
            desktopSettingsGlobalState.startMenuButtonLogo = logo;
            applyStartMenuButtonAppearanceToTaskbar(preset, customText, style, logo);
        }
        if (typeof desktop.useApplicationImageIcon === 'boolean') {
            desktopSettingsGlobalState.useApplicationImageIcon = desktop.useApplicationImageIcon;
            desktopSettingsPersistedUseApplicationImageIcon = desktop.useApplicationImageIcon;
            applyUseApplicationImageIcon(desktop.useApplicationImageIcon);
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

    if (settings.remoteAccess && typeof settings.remoteAccess === 'object') {
        applyRemoteAccessSettingsToState(settings.remoteAccess);
    }

    if (settings.imageGeneration && typeof settings.imageGeneration === 'object') {
        // applyImageGenerationSettingsToClient: public/scripts/comp/imageGenerationSettings.js
        applyImageGenerationSettingsToClient(settings.imageGeneration);
    }

    if (settings.registry && typeof settings.registry === 'object' && window.melatonRegistry) {
        // Control Panel's registry values: public/scripts/comp/melatonRegistry.js
        window.melatonRegistry.hydrate(settings.registry);
    }

    if (settings.mail && typeof settings.mail === 'object' && window.dovecoteMailSettings) {
        // Dovecote Express's signature (Mail Options): public/scripts/comp/desktop-apps/dovecote.js
        window.dovecoteMailSettings.applyServer(settings.mail);
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
    if (patch.remoteAccess && typeof patch.remoteAccess === 'object') {
        snap.remoteAccess = { ...snap.remoteAccess, ...patch.remoteAccess };
    }
    if (patch.imageGeneration && typeof patch.imageGeneration === 'object') {
        snap.imageGeneration = { ...snap.imageGeneration, ...patch.imageGeneration };
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

async function updateWallpaperPosition(position) {
    const currentWorkspace = (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null) || window.currentWorkspace || 'default';

    if (!workspaces || !workspaces[currentWorkspace]) return;

    // Update local workspace object first
    workspaces[currentWorkspace].wallpaperPosition = position;

    // Regenerate styles for immediate visual update (dev mode)
    generateWorkspaceStyles(currentWorkspace);
    // syncDesktopWallpaperInline: public/scripts/comp/workspaceUtils.js
    syncDesktopWallpaperInline(currentWorkspace);

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
        // Rect is zero or animation-scaled while minimised; keep the last saved normal geometry
        if (modal.classList.contains('minimised') || modal.classList.contains('minimising') || modal.classList.contains('unminimising')) {
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
        // Fullscreen Studio editor is not a window; its windowed geometry stays as last saved
        if (modal.id === 'manualModal' && !modal.classList.contains('windowed')) {
            return;
        }

        // Maximize is a temporary layout override — persist last normal geometry only
        let layoutForSave;
        if (modal.classList.contains('modal-maximized')) {
            if (!modal._preMaximizeLayout) {
                return;
            }
            layoutForSave = modal._preMaximizeLayout;
        } else {
            const modalRect = modal.getBoundingClientRect();
            layoutForSave = {
                left: modalRect.left,
                top: modalRect.top,
                width: modalRect.width,
                height: modalRect.height
            };
            // A rect that covers the work area is a maximize/fullscreen remnant, never a normal geometry
            if (typeof windowGeometry !== 'undefined' && windowGeometry) {
                const edgesNow = windowGeometry.computeWindowEdges(layoutForSave, getModalWorkAreaBounds());
                if (edgesNow && windowGeometry.isRemnantGeometry(edgesNow)) {
                    return;
                }
            }
        }

        const position = buildWindowPositionEntryFromLayout(
            modal,
            layoutForSave,
            containerWidth,
            containerHeight
        );
        if (!position) {
            return;
        }

        // Only save if window has been moved or resized, or is a persistable desktop shell
        const shouldForceSave = shouldSaveShellBoundsFromRect(modal)
            || (modal.dataset.windowIdentifier
                && modal.dataset.windowIdentifier !== 'photoSwipeShell'
                && transientWindowsWithPositions.has(modal.dataset.windowIdentifier));

        if (shouldForceSave) {
            modal.setAttribute('data-modal-moved', 'true');
        }

        if (shouldForceSave || modal.hasAttribute('data-modal-moved') || position.bottomRight) {
            windowPositions[windowKey] = position;
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

    // Work-area fractions (public/scripts/comp/windowGeometry.js); the quadrant pair below is the legacy path
    if (typeof windowGeometry !== 'undefined' && windowGeometry && windowGeometry.isEdgesEntry(savedPosition)) {
        if (windowGeometry.isRemnantGeometry(savedPosition.edges)) {
            return; // saved while maximized / fullscreen: let the window open at its default size
        }
        if (applyWindowGeometryEdges(modal, savedPosition.edges)) {
            ensureModalEdgesWithinWorkArea(modal);
        }
        return;
    }

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

// About Melaton: Vista's About Windows (winver.exe). public/app.html #aboutMelatoninModal, drawn by
// public/css/about-melaton.css. The version facts live here once so Control Panel's System page
// (public/scripts/comp/cplSystem.js) shows the same edition, build and owner.
const MELETON_VERSION_DEFAULTS = Object.freeze({
    productName: 'Melaton',
    fullName: 'Melaton Desktop',
    edition: '2026 R7',
    version: '2026 R7',
    servicePack: '',
    copyrightYear: '2026',
    copyrightHolder: 'Xyridian Corporation',
    copyright: 'Copyright \u00a9 2026 Xyridian Corporation.  All rights reserved.',
    organization: 'Dreamscape'
});

let meletonSystemInfo = null;
let meletonSystemInfoPromise = null;

/** The signed-in domain account (the VPN logon's user, as the Start menu and lock screen name it). */
function getMeletonRegisteredUser() {
    const ws = window.wsClient;
    const name = ws && typeof ws._getConnectionUsername === 'function' ? ws._getConnectionUsername() : '';
    return name && name !== '\u2014' ? name : startMenuUserName();
}

/** Edition, version, build, service pack, copyright and registered owner; build and systemInfo
 *  fill in once loadMeletonVersionInfo has fetched get_system_info. */
function getMeletonVersionInfo() {
    const info = meletonSystemInfo || null;
    const build = info && info.gitHash && info.gitHash !== 'Unknown' ? String(info.gitHash) : 'Unknown';
    return {
        ...MELETON_VERSION_DEFAULTS,
        build,
        registeredUser: getMeletonRegisteredUser(),
        systemInfo: info
    };
}

/** Fetches get_system_info once (the server answers from its cache) and resolves getMeletonVersionInfo(). */
async function loadMeletonVersionInfo(force = false) {
    if (meletonSystemInfo && !force) return getMeletonVersionInfo();
    if (!window.wsClient || !window.wsClient.isConnected()) return getMeletonVersionInfo();
    if (!meletonSystemInfoPromise) {
        meletonSystemInfoPromise = window.wsClient.sendMessage('get_system_info', {})
            .then((response) => {
                if (response) meletonSystemInfo = response;
            })
            .catch((error) => {
                console.warn('About Melaton: system information unavailable', error);
            })
            .finally(() => {
                meletonSystemInfoPromise = null;
            });
    }
    await meletonSystemInfoPromise;
    return getMeletonVersionInfo();
}

window.getMeletonVersionInfo = getMeletonVersionInfo;
window.loadMeletonVersionInfo = loadMeletonVersionInfo;

/** Physical memory in KB as winver prints it: the host's exact bytes, else the cached "N.NN GB". */
function meletonPhysicalMemoryKb(systemInfo) {
    if (!systemInfo) return null;
    const bytes = systemInfo.host && Number(systemInfo.host.totalMemBytes);
    if (bytes > 0) return Math.round(bytes / 1024);
    const match = typeof systemInfo.ram === 'string' ? systemInfo.ram.match(/([\d.]+)\s*GB/i) : null;
    return match ? Math.round(parseFloat(match[1]) * 1024 * 1024) : null;
}

function renderAboutMelatoninModal(modal) {
    const info = getMeletonVersionInfo();
    const set = (id, text) => {
        const el = modal.querySelector('#' + id);
        if (el) el.textContent = text;
    };
    const servicePack = info.servicePack ? `: ${info.servicePack}` : '';
    const build = info.build !== 'Unknown' ? ` (Build ${info.build}${servicePack})` : '';
    set('aboutMelatoninVersion', `Version ${info.version}${build}`);
    set('aboutWindowsCopyright', info.copyright);
    set('aboutWindowsOwner', info.registeredUser);
    set('aboutWindowsOrg', info.organization);
    const kb = meletonPhysicalMemoryKb(info.systemInfo);
    set('aboutWindowsMemory', kb ? `Physical memory available to ${info.productName}\u00ae: ${kb.toLocaleString('en-US')} KB` : '');
}

function showMeletonLicenseTerms() {
    const info = getMeletonVersionInfo();
    const esc = (text) => String(text).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    // showConfirmationDialog: public/scripts/comp/confirmationDialog.js (a Vista message box on the desktop)
    showConfirmationDialog(
        `<p>${esc(info.fullName)} ${esc(info.edition)} is licensed to ${esc(info.registeredUser)}, ${esc(info.organization)}.</p>` +
        `<p>${esc(info.copyright)}</p>`,
        [{ text: 'OK', value: true, className: 'btn-standard primary' }],
        null,
        { title: 'Dreamscape Software License Terms', icon: 'fa-light fa-info-circle' }
    );
}

async function openAboutMelatoninModal() {
    const modal = document.getElementById('aboutMelatoninModal');
    if (!modal) {
        console.error('About Melaton modal not found');
        return;
    }

    const close = () => { closeModal(modal); };
    const closeBtn = document.getElementById('closeAboutMelatoninBtn');
    if (closeBtn) closeBtn.onclick = close;
    const okBtn = document.getElementById('aboutWindowsOkBtn');
    if (okBtn) okBtn.onclick = close;
    const licenseLink = document.getElementById('aboutWindowsLicenseLink');
    if (licenseLink) {
        licenseLink.onclick = (event) => {
            event.preventDefault();
            showMeletonLicenseTerms();
        };
    }

    renderAboutMelatoninModal(modal);
    openModal(modal);
    // Centred, the 429px window sits on a half pixel: settle it onto whole pixels once it is open.
    // OK is the default button and takes the focus, so Enter and Space close the dialog.
    const settle = () => {
        settleModalPixelAnchor(modal);
        if (okBtn && !modal.classList.contains('hidden')) okBtn.focus({ preventScroll: true });
    };
    if (modal.classList.contains('opening')) {
        modal.addEventListener('animationend', function onOpened(e) {
            if (e.target !== modal) return;
            modal.removeEventListener('animationend', onOpened);
            settle();
        });
    } else {
        settle();
    }

    await loadMeletonVersionInfo();
    renderAboutMelatoninModal(modal);
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