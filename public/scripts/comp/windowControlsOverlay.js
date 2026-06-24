/**
 * Window Controls Overlay Manager (Wave 2 — app.js refactor)
 *
 * WCO / caption bar geometry, Android caption bridge, titlebar classes.
 * Extracted from public/scripts/app.js DOMContentLoaded block; originals remain until manifest removal.
 *
 * Not extracted here (remain in app.js DOMContentLoaded): initVirtualKeyboard, wsClient.init
 * wireFocusOverlayListeners: public/scripts/comp/focusOverlayManager.js
 */

function initWindowControlsOverlay() {
// Helper: read --caption-bar-* CSS variables and return a synthetic rect (or null)
function getCaptionBarRect() {
    const style = getComputedStyle(document.documentElement);
    const heightRaw = style.getPropertyValue('--caption-bar-height').trim();
    const leftRaw = style.getPropertyValue('--caption-bar-left').trim();
    const rightRaw = style.getPropertyValue('--caption-bar-right').trim();

    const height = parseFloat(heightRaw) || 0;
    if (height <= 0) return null;

    const left = parseFloat(leftRaw) || 0;
    const right = parseFloat(rightRaw) || 0;
    const width = window.innerWidth - left - right;

    // x: the content area starts after the left buttons (Mac style when left > 0)
    return { x: left, y: 0, width: Math.max(0, width), height };
}

let captionBarOverlayClassTimer = null;
const CAPTION_BAR_OVERLAY_DEBOUNCE_MS = 160;

// Android WebView: host updates insets after resize/layout; sync via bridge then apply --caption-bar-* on :root.
function syncCaptionBarInsetsFromBridge() {
    const ac = window.AndroidCaption;
    if (!ac || typeof ac.setCaptionBarInsets !== 'function' || typeof ac.getCaptionBarInsetsJson !== 'function') {
        return false;
    }
    try {
        ac.setCaptionBarInsets();
        const raw = ac.getCaptionBarInsetsJson();
        if (raw == null || raw === '') return false;
        const data = typeof raw === 'string' ? JSON.parse(raw) : raw;
        const inset = data.insets || data;
        const left = Number(inset.left ?? data.left ?? data.leftInset ?? data.captionBarLeft ?? 0) || 0;
        const right = Number(inset.right ?? data.right ?? data.rightInset ?? data.captionBarRight ?? 0) || 0;
        const height = Number(
            data.height ?? data.captionBarHeight ?? inset.top ?? data.top ?? inset.height ?? 0
        ) || 0;
        if (height <= 0 && left <= 0 && right <= 0) return false;
        const root = document.documentElement;
        root.style.setProperty('--caption-bar-left', `${left}px`);
        root.style.setProperty('--caption-bar-right', `${right}px`);
        if (height > 0) {
            root.style.setProperty('--caption-bar-height', `${height}px`);
        }
        return true;
    } catch (e) {
        console.warn('📱 Caption bar inset bridge sync failed:', e);
        return false;
    }
}

// Notify the Android host of the current draggable titlebar region.
// Uses the rendered bounding rect of #menu-bar-handle for precise x/width,
// and caption-bar-height (or the titlebar-area-height CSS var) for height.
function updateAndroidCaptionDragRegion() {
    if (!window.AndroidCaption) return;

    const handle = document.getElementById('menu-bar-handle');
    if (!handle) return;

    const rect = handle.getBoundingClientRect();
    const w = window.innerWidth;
    const h = parseFloat(
        getComputedStyle(document.documentElement).getPropertyValue('--caption-bar-height').trim()
    ) || rect.height || 0;

    if (h <= 0) return;

    // left / right are the widths of the native button zones on each side
    const left = Math.round(rect.left);
    const right = Math.round(w - rect.right);

    try {
        window.AndroidCaption.setDragRegion(JSON.stringify([
            { x: left, y: 0, width: Math.max(0, w - left - right), height: h }
        ]));
    } catch (e) {
        console.warn('📱 AndroidCaption.setDragRegion failed:', e);
    }
}

// Native Android caption button chrome (not in-app .modal-window-controls).
// Maximized caption/gutter blackout: public/css/app.css (:has(.modal-maximized) on #titlebar-grab-area-container).
// Rules:
//   - Desktop mode: always both transparent
//   - manualModal open + width > 1101: both transparent
//   - manualModal open + width ≤ 1101: left transparent, right black
//   - Default (navbar visible): black (single arg = both sides)
function updateAndroidCaptionControlsOverlay() {
    if (!window.AndroidCaption || typeof window.AndroidCaption.setControlsOverlay !== 'function') return;

    try {
        if (window.isDesktop) {
            // Desktop mode: always transparent on both sides
            window.AndroidCaption.setControlsOverlay('#00000000', '#00000000');
            return;
        }

        const modal = document.getElementById('manualModal');
        const isModalOpen = modal && !modal.classList.contains('hidden');

        if (isModalOpen) {
            window.AndroidCaption.setControlsOverlay('#00000000', '#00000000');
        } else {
            // Default: navbar is visible, send black for both sides (single arg)
            window.AndroidCaption.setControlsOverlay('#000000FF');
        }
    } catch (e) {
        console.warn('📱 AndroidCaption.setControlsOverlay failed:', e);
    }
}

// Expose globally so manualModalManager.js can call it on open/close
window.updateAndroidCaptionControlsOverlay = updateAndroidCaptionControlsOverlay;

// Core WCO / caption-bar class and CSS application (runs after debounce + optional bridge sync).
function applyWindowControlsOverlayClasses() {
    const titlebarX = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-x');
    const titlebarY = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-y');
    const titlebarWidth = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-width');
    const titlebarHeight = getComputedStyle(document.documentElement).getPropertyValue('--titlebar-area-height');

    // Check if overlay is truly enabled - prioritize WCO API over CSS properties
    const apiAvailable = 'windowControlsOverlay' in navigator;
    let wcoRect = null;

    if (apiAvailable) {
        try {
            wcoRect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        } catch (error) {
            console.error('🎛️ WCO: Error getting rect:', error.message);
        }
    }

    // If WCO API gives us a valid rect, use that as the authoritative source
    const wcoHasValidRect = wcoRect && wcoRect.width > 0 && wcoRect.height > 0;

    // Check caption-bar CSS variables as an alternative activation mechanism
    const captionBarRect = getCaptionBarRect();
    const captionBarEnabled = captionBarRect !== null;

    // Fallback to CSS properties only if WCO API is not available or gives invalid data
    const widthValid = titlebarWidth && titlebarWidth !== '0px' && titlebarWidth !== '';
    const heightValid = titlebarHeight && titlebarHeight !== '0px' && titlebarHeight !== '';
    const cssHasValidDimensions = widthValid && heightValid;

    // Prioritize WCO API, then caption-bar vars, then legacy CSS vars
    const isOverlayEnabled = wcoHasValidRect || captionBarEnabled || (!apiAvailable && cssHasValidDimensions);

    if (isOverlayEnabled) {
        // Overlay is enabled - add classes and hide original elements
        document.documentElement.classList.add('window-controls-overlay');

        // If caption-bar vars are the source (and the native API isn't providing values),
        // copy the synthetic geometry into --titlebar-area-* so CSS consumers get correct values.
        if (!wcoHasValidRect && captionBarEnabled) {
            document.documentElement.classList.add('titlebar-android');
            const root = document.documentElement;
            root.style.setProperty('--titlebar-area-x', `${captionBarRect.x}px`);
            root.style.setProperty('--titlebar-area-y', `${captionBarRect.y}px`);
            // Use calc() so width auto-updates on resize without needing JS refresh
            root.style.setProperty('--titlebar-area-width', 'calc(100vw - var(--caption-bar-left, 0px) - var(--caption-bar-right, 0px))');
            root.style.setProperty('--titlebar-area-height', `${captionBarRect.height}px`);
        } else {
            // Native WCO is active — ensure android class is not set
            document.documentElement.classList.remove('titlebar-android');
        }

        // Determine x position: prefer WCO rect, then caption-bar, then CSS var
        let xValue = 0;
        if (wcoHasValidRect) {
            xValue = wcoRect.x || 0;
        } else if (captionBarEnabled) {
            xValue = captionBarRect.x || 0;
        } else {
            xValue = parseInt(titlebarX) || 0;
        }

        // Only apply mac/windows positioning classes when not in Android mode
        // (titlebar-android uses top-margin layout instead of left-margin)
        if (!captionBarEnabled) {
            if (xValue > 0) {
                document.documentElement.classList.add('titlebar-mac');
                document.documentElement.classList.remove('titlebar-windows');
            } else {
                document.documentElement.classList.add('titlebar-windows');
                document.documentElement.classList.remove('titlebar-mac');
            }
        } else {
            document.documentElement.classList.remove('titlebar-mac', 'titlebar-windows');
        }
    } else {
        // Overlay is disabled - remove classes and show original elements in overlay
        document.documentElement.classList.remove('window-controls-overlay', 'titlebar-mac', 'titlebar-windows', 'titlebar-android');

        // Clear drag region on Android when overlay is disabled
        if (window.AndroidCaption) {
            try { window.AndroidCaption.setDragRegion(JSON.stringify([])); } catch (_) { }
        }

        // If caption-bar vars were previously driving the titlebar-area-* properties, clear them
        // so they don't leave stale values behind when the overlay is deactivated.
        const root = document.documentElement;
        if (root.style.getPropertyValue('--titlebar-area-height') &&
            !('windowControlsOverlay' in navigator)) {
            root.style.removeProperty('--titlebar-area-x');
            root.style.removeProperty('--titlebar-area-y');
            root.style.removeProperty('--titlebar-area-width');
            root.style.removeProperty('--titlebar-area-height');
        }
    }

    // Update the Android drag region whenever overlay state changes
    updateAndroidCaptionDragRegion();
}

// Caption-bar-driven layout often receives --caption-bar-* from the host one frame after resize;
// when the Android inset bridge exists, refresh insets there first. Debounce so we read after layout settles.
function updateWindowControlsOverlayClasses() {
    const apiAvailable = 'windowControlsOverlay' in navigator;
    let wcoRect = null;
    if (apiAvailable) {
        try {
            wcoRect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        } catch (error) {
            console.error('🎛️ WCO: Error getting rect:', error.message);
        }
    }
    const wcoHasValidRect = wcoRect && wcoRect.width > 0 && wcoRect.height > 0;

    const bridgeInsets =
        window.AndroidCaption &&
        typeof window.AndroidCaption.setCaptionBarInsets === 'function' &&
        typeof window.AndroidCaption.getCaptionBarInsetsJson === 'function';

    const captionBarEnabledNow = getCaptionBarRect() !== null;
    const needsCaptionDebounce = !wcoHasValidRect && (captionBarEnabledNow || bridgeInsets);

    if (needsCaptionDebounce) {
        clearTimeout(captionBarOverlayClassTimer);
        captionBarOverlayClassTimer = setTimeout(() => {
            captionBarOverlayClassTimer = null;
            if (bridgeInsets) {
                syncCaptionBarInsetsFromBridge();
            }
            applyWindowControlsOverlayClasses();
        }, CAPTION_BAR_OVERLAY_DEBOUNCE_MS);
        return;
    }

    clearTimeout(captionBarOverlayClassTimer);
    captionBarOverlayClassTimer = null;
    applyWindowControlsOverlayClasses();
}

window.updateWindowControlsOverlayClasses = updateWindowControlsOverlayClasses;

// Check if Window Controls Overlay API is supported and has valid titlebar area,
// OR if --caption-bar-height CSS variable is set to a positive value.
function isWindowControlsOverlayAvailable() {
    // Check caption-bar CSS variables first as an alternative activation path
    const captionBarRect = getCaptionBarRect();
    if (captionBarRect !== null) {
        return true;
    }

    // Then check if the native WCO API exists
    if (!('windowControlsOverlay' in navigator)) {
        return false;
    }

    try {
        const rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        // Check if the rect has meaningful dimensions (not empty or zero-sized)
        if (!rect || rect.width <= 0 || rect.height <= 0) {
            return false;
        }

        // Additional check: ensure the titlebar area is not the entire viewport
        // (which would indicate the overlay is not properly configured)
        const viewportWidth = window.innerWidth;
        const viewportHeight = window.innerHeight;

        // If titlebar area covers more than 95% of viewport, it's likely not configured properly
        if (rect.width > viewportWidth * 0.95 || rect.height > viewportHeight * 0.95) {
            return false;
        }
        return true;
    } catch (error) {
        // If getTitlebarAreaRect() throws an error, overlay is not available
        console.error('🎛️ WCO Error:', error.message);
        return false;
    }
}

window.isWindowControlsOverlayAvailable = isWindowControlsOverlayAvailable;

// Run an initial pass in case values are already present at DOMContentLoaded
updateWindowControlsOverlayClasses();
updateAndroidCaptionControlsOverlay();

// Wire up native WCO geometry change event if the API is available
if ('windowControlsOverlay' in navigator &&
    navigator.windowControlsOverlay.ongeometrychange !== undefined) {
    navigator.windowControlsOverlay.ongeometrychange = () => {
        updateWindowControlsOverlayClasses();
    };
}

// [MODIFICATION]: Moved WCO resize listener to activateTitlebarResizeListeners() to prevent premature execution

// Always observe style changes on :root so that --caption-bar-* (and --titlebar-area-*)
// values injected by an external app after DOMContentLoaded are picked up immediately.
const observer = new MutationObserver((mutations) => {
    let shouldUpdate = false;
    mutations.forEach((mutation) => {
        if (mutation.type === 'attributes' && mutation.attributeName === 'style') {
            const target = mutation.target;
            const style = getComputedStyle(target);
            const currentX = style.getPropertyValue('--titlebar-area-x');
            const currentHeight = style.getPropertyValue('--titlebar-area-height');
            const currentCaptionHeight = style.getPropertyValue('--caption-bar-height');
            const currentCaptionLeft = style.getPropertyValue('--caption-bar-left');
            const currentCaptionRight = style.getPropertyValue('--caption-bar-right');

            // Check if the values have actually changed
            if (target._lastTitlebarX !== currentX ||
                target._lastTitlebarHeight !== currentHeight ||
                target._lastCaptionBarHeight !== currentCaptionHeight ||
                target._lastCaptionBarLeft !== currentCaptionLeft ||
                target._lastCaptionBarRight !== currentCaptionRight) {
                target._lastTitlebarX = currentX;
                target._lastTitlebarHeight = currentHeight;
                target._lastCaptionBarHeight = currentCaptionHeight;
                target._lastCaptionBarLeft = currentCaptionLeft;
                target._lastCaptionBarRight = currentCaptionRight;
                shouldUpdate = true;
            }
        }
    });

    if (shouldUpdate) {
        updateWindowControlsOverlayClasses();
        updateAndroidCaptionControlsOverlay();
    }
});

// Observe the document element for style changes
observer.observe(document.documentElement, {
    attributes: true,
    attributeFilter: ['style']
});

// Watch the drag handle for size/position changes caused by sibling controls
// expanding or collapsing (e.g. WebSocket ticker, balance display).
const handleEl = document.getElementById('menu-bar-handle');
if (handleEl) {
    new ResizeObserver(() => {
        updateAndroidCaptionDragRegion();
    }).observe(handleEl);
}

// Expose utility function for external access (always available)
window.getWindowControlsOverlayState = () => {
    const apiAvailable = 'windowControlsOverlay' in navigator;
    const style = getComputedStyle(document.documentElement);
    const titlebarX = style.getPropertyValue('--titlebar-area-x');
    const titlebarY = style.getPropertyValue('--titlebar-area-y');
    const titlebarWidth = style.getPropertyValue('--titlebar-area-width');
    const titlebarHeight = style.getPropertyValue('--titlebar-area-height');
    const captionBarHeight = style.getPropertyValue('--caption-bar-height').trim();
    const captionBarLeft = style.getPropertyValue('--caption-bar-left').trim();
    const captionBarRight = style.getPropertyValue('--caption-bar-right').trim();
    const captionBarRect = getCaptionBarRect();

    let rect = null;
    if (apiAvailable) {
        try {
            rect = navigator.windowControlsOverlay.getTitlebarAreaRect();
        } catch (error) {
            rect = { error: error.message };
        }
    }

    return {
        apiAvailable,
        titlebarArea: { x: titlebarX, y: titlebarY, width: titlebarWidth, height: titlebarHeight },
        captionBar: { height: captionBarHeight, left: captionBarLeft, right: captionBarRight, rect: captionBarRect },
        rect,
        classes: {
            hasOverlay: document.documentElement.classList.contains('window-controls-overlay'),
            isMac: document.documentElement.classList.contains('titlebar-mac'),
            isWindows: document.documentElement.classList.contains('titlebar-windows')
        },
        isEnabled: (rect && rect.width > 0 && rect.height > 0) || captionBarRect !== null
    };
};
}

function activateTitlebarResizeListeners() {
    if (typeof isWindowControlsOverlayAvailable === 'function' && isWindowControlsOverlayAvailable()) {
        console.log('🚀 Activating titlebar resize listeners');
        window.addEventListener('resize', () => {
            clearTimeout(window._wcoResizeTimeout);
            window._wcoResizeTimeout = setTimeout(() => {
                // Always re-check on resize: caption-bar width is derived from window.innerWidth
                if (isWindowControlsOverlayAvailable()) {
                    updateWindowControlsOverlayClasses();
                }
                // Keep caption button colors in sync with new width
                if (window.updateAndroidCaptionControlsOverlay) {
                    window.updateAndroidCaptionControlsOverlay();
                }
            }, 100);
        });

        // Initial setup for current state
        updateWindowControlsOverlayClasses();
        if (window.updateAndroidCaptionControlsOverlay) {
            window.updateAndroidCaptionControlsOverlay();
        }
    }
}

if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', initWindowControlsOverlay);
} else {
    initWindowControlsOverlay();
}
