/**
 * Window geometry helpers — saved window positions as fractions of the desktop work
 * area, and the viewport re-layout gate. Pure functions; modalUtils.js calls them
 * (buildWindowPositionEntryFromLayout, restoreWindowPosition,
 * handleDesktopViewportResizePositionSync).
 *
 * An entry's `edges` = { left, top, right, bottom } are fractions of the work area
 * (0 = left/top edge, 1 = right/bottom edge), so a window keeps its relative place and
 * size on another resolution, aspect ratio or DPI. The legacy quadrant pair
 * (`topLeft` / `bottomRight`) is still written next to it for older readers and the
 * server-side validator.
 *
 * Windows marked `data-window-fixed-size="true"` keep their pixel size and are
 * re-centred on the saved centre instead of being resized.
 *
 * Test: scripts/test-window-geometry.js. Yozora #403.
 */
(function () {
    'use strict';

    /** A saved rect covering this much of the work area is a maximize / fullscreen remnant */
    const REMNANT_FRACTION = 0.97;
    /** Below this the viewport is a minimised or collapsed browser, not a layout to adopt */
    const MIN_VIEWPORT = { width: 480, height: 320 };
    /** Saved fractions may hang slightly off the work area (partial overflow is allowed) */
    const EDGE_RANGE = { min: -1, max: 2 };

    function round4(value) {
        return Math.round(value * 10000) / 10000;
    }

    function finite(value) {
        return typeof value === 'number' && Number.isFinite(value);
    }

    function validWorkArea(workArea) {
        return !!(workArea && finite(workArea.left) && finite(workArea.top)
            && finite(workArea.width) && finite(workArea.height)
            && workArea.width > 0 && workArea.height > 0);
    }

    /** Pixel rect → work-area fractions. Returns null for an unusable rect or work area. */
    function computeWindowEdges(rect, workArea) {
        if (!rect || !validWorkArea(workArea)) return null;
        const left = Number(rect.left);
        const top = Number(rect.top);
        const width = Number(rect.width);
        const height = Number(rect.height);
        if (![left, top, width, height].every(finite) || width <= 0 || height <= 0) return null;
        const clamp = (v) => Math.min(EDGE_RANGE.max, Math.max(EDGE_RANGE.min, v));
        return {
            left: round4(clamp((left - workArea.left) / workArea.width)),
            top: round4(clamp((top - workArea.top) / workArea.height)),
            right: round4(clamp((left + width - workArea.left) / workArea.width)),
            bottom: round4(clamp((top + height - workArea.top) / workArea.height))
        };
    }

    function isEdges(edges) {
        return !!(edges && finite(edges.left) && finite(edges.top) && finite(edges.right) && finite(edges.bottom)
            && edges.right > edges.left && edges.bottom > edges.top);
    }

    function isEdgesEntry(entry) {
        return !!(entry && isEdges(entry.edges));
    }

    function edgesCenter(edges) {
        return { x: (edges.left + edges.right) / 2, y: (edges.top + edges.bottom) / 2 };
    }

    /**
     * Work-area fractions → pixel rect for the given work area.
     * options.fixedSize = { width, height } keeps that size and centres it on the saved centre.
     */
    function edgesToRect(edges, workArea, options = {}) {
        if (!isEdges(edges) || !validWorkArea(workArea)) return null;
        const fixed = options.fixedSize;
        if (fixed && finite(fixed.width) && finite(fixed.height) && fixed.width > 0 && fixed.height > 0) {
            const center = edgesCenter(edges);
            return {
                left: workArea.left + center.x * workArea.width - fixed.width / 2,
                top: workArea.top + center.y * workArea.height - fixed.height / 2,
                width: fixed.width,
                height: fixed.height
            };
        }
        const left = workArea.left + edges.left * workArea.width;
        const top = workArea.top + edges.top * workArea.height;
        return {
            left,
            top,
            width: (edges.right - edges.left) * workArea.width,
            height: (edges.bottom - edges.top) * workArea.height
        };
    }

    /** True when the saved size is really a maximized or fullscreen window (never restore that as windowed). */
    function isRemnantGeometry(edges, threshold = REMNANT_FRACTION) {
        if (!isEdges(edges)) return false;
        return (edges.right - edges.left) >= threshold && (edges.bottom - edges.top) >= threshold;
    }

    /**
     * Whether a viewport change deserves a re-layout of the open windows. A hidden tab, a
     * minimised browser (zero outer size) or a tiny viewport is ignored; the layout is
     * applied once the window is a usable size again.
     */
    function shouldRelayoutViewport(env) {
        if (!env) return false;
        if (env.hidden === true) return false;
        if (!finite(env.innerWidth) || !finite(env.innerHeight)) return false;
        if (env.innerWidth < MIN_VIEWPORT.width || env.innerHeight < MIN_VIEWPORT.height) return false;
        if (finite(env.outerWidth) && env.outerWidth <= 0) return false;
        if (finite(env.outerHeight) && env.outerHeight <= 0) return false;
        return true;
    }

    const api = {
        REMNANT_FRACTION,
        MIN_VIEWPORT,
        computeWindowEdges,
        edgesToRect,
        edgesCenter,
        isEdges,
        isEdgesEntry,
        isRemnantGeometry,
        shouldRelayoutViewport
    };

    if (typeof window !== 'undefined') window.windowGeometry = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
