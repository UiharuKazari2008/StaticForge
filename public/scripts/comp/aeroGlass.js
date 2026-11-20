/**
 * Aero glass engine — window frame glass modes and the frosted wallpaper layer.
 *
 * html[data-glass] = frosted | live | basic (public/css/aero-glass.css).
 *   frosted  once per wallpaper a downscaled, blurred copy is drawn to a canvas and
 *            published as --aero-wallpaper on <html> (plus a lighter-blur copy,
 *            --aero-wallpaper-light, for the taskbar). Every .modal::before paints it at
 *            viewport cover size (--aero-cover-*) offset by the window's own origin
 *            (--aero-x / --aero-y on the modal), so no window pays a per-frame
 *            backdrop-filter. Dragging is handled in CSS via --modal-drag-x / -y.
 *            The origin is tracked in every mode: the screen-anchored Aero streaks
 *            (#407) slide across the frame in live and basic too.
 *   live     the same cached raster, made with live glass's own recipe (the backdrop-filter
 *            app.css ships: 5 px blur, saturate 3, contrast 1.5, brightness 1.2; the taskbar's
 *            10 px saturate 2.5), so nothing runs a backdrop-filter at rest (Yukimi, Nov 20 2026:
 *            "no need for it to always be rendering when nothing is changing"). A window that
 *            overlaps lower windows gets its own small blurred texture (--aero-backdrop): the
 *            wallpaper copy plus the windows behind it as blurred frame and client blocks,
 *            redrawn only when the stack changes (move, resize, open, close, focus, wallpaper,
 *            resolution), debounced and never while the page is hidden.
 *   basic    performance mode: static tinted frames, same geometry. html.disable-blur
 *            is kept in sync so the older rules that key off it still apply.
 *
 * Persisted in localStorage `aero-glass-mode`; a legacy `disable-blur` = 'true' with no
 * stored mode maps to basic. Default is live until Yukimi signs off frosted (#400).
 *
 * Hooks: modalUtils.js calls aeroGlass.syncModal(modal) from setModalOffsetPx,
 * settleModalPixelAnchor and openModal; workspaceUtils.js calls refreshWallpaper() when
 * the inline wallpaper changes; `workspaceChanged` covers the stylesheet-driven case;
 * desktopPersonalization.js calls refreshContrast() when the window colour changes.
 *
 * Surfaces marked [data-aero-contrast] get data-backdrop="light" | "dark" from the glass
 * under them (see "surface contrast" below), so their glyphs stay readable.
 * Yozora #400.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'aero-glass-mode';
    const LEGACY_BLUR_KEY = 'disable-blur';
    const MODES = ['frosted', 'live', 'basic'];
    const DEFAULT_MODE = 'live';
    const ANIMATING_CLASSES = ['opening', 'closing', 'minimising', 'unminimising'];

    const config = {
        frostedMaxWidth: 960,       // source copy is downscaled to at most this wide
        frostedBlurRatio: 0.011,    // frame blur radius as a fraction of that width (~11px at 960)
        frostedMinBlurPx: 5,
        taskbarBlurRatio: 0.85,     // the taskbar copy is a touch sharper: this fraction of the frame blur
        jpegQuality: 0.86,
        revokeDelayMs: 2000,        // old blob URL lives long enough for the swap to paint
        resizeDebounceMs: 120,
        wallpaperRefreshDebounceMs: 60,
        contrastDebounceMs: 100,
        contrastSampleWidth: 96,    // the wallpaper copy kept for [data-aero-contrast] averaging
        contrastLightGlyph: [1, 1, 1],          // fallback when --text-accent-tinted can't be read
        contrastRestDarken: 0.2,                // resting bar glyphs are 20 % darker (vista-glass-controls.css)
        contrastDarkGlyph: [0.08, 0.14, 0.2],   // hsl(210 43% 14%), vista-glass-controls.css
        contrastHysteresisLc: 5,
        // live: the recipe of app.css .modal backdrop-filter and the taskbar's, in CSS px
        liveBlurPx: 5,
        liveFilter: 'saturate(3) contrast(1.5) brightness(1.2)',
        liveTaskbarBlurPx: 10,
        liveTaskbarFilter: 'saturate(2.5)',
        frostedFilter: 'saturate(1.2)',
        // live per-window textures (the windows behind a window)
        backdropScale: 0.34,        // texture pixels per CSS px (a 5 px sigma keeps nothing finer)
        backdropMaxSide: 640,
        backdropDebounceMs: 120
    };

    const doc = typeof document !== 'undefined' ? document : null;
    const root = doc ? doc.documentElement : null;
    const win = typeof window !== 'undefined' ? window : null;
    // page-lifetime shell module: listeners carry the caller's signal (none when the page owns them, app-scope-ownership)
    const appScopeSignal = (win && win.melatonSegments && typeof win.melatonSegments.callerSignal === 'function'
        && win.melatonSegments.callerSignal()) || undefined;

    const state = {
        mode: null,
        lastGlassMode: 'frosted',
        sourceUrl: null,
        blobUrl: null,
        blobLightUrl: null,
        imageWidth: 0,
        imageHeight: 0,
        position: { x: 0.5, y: 0.5 },
        buildToken: 0,
        inflight: null,             // { url, promise } so a refresh joins a running build
        failedUrl: null,
        resizeTimer: null,
        refreshTimer: null,
        contrastTimer: null,
        colorCtx: null,
        wallpaperSample: null,      // { width, height, data } of the blurred frame copy
        builtKey: null,             // mode | url | blur of the published copy
        composeSource: null,        // live: { canvas, pad, width } unfiltered padded copy for window textures
        backdropTimer: null,
        backdropPending: false,     // a compose waits for the page to show again
        backdropToken: 0,
        observedModals: null,       // WeakSet of windows whose class / size is watched
        backdropWorker: null,       // { worker, url, jobs, seq, sourceSent } draws the textures off the main thread
        initialized: false
    };

    // ---------- pure helpers (covered by scripts/test-aero-glass.js) ----------

    function normalizeMode(mode) {
        return MODES.includes(mode) ? mode : null;
    }

    /** Modes that paint frames from the cached wallpaper copy instead of a backdrop-filter. */
    function isCachedMode(mode) {
        return mode === 'frosted' || mode === 'live';
    }

    function parseCssUrl(value) {
        if (typeof value !== 'string') return null;
        const match = value.trim().match(/^url\(\s*(['"]?)([\s\S]*?)\1\s*\)$/i);
        if (!match) return null;
        const url = match[2].trim();
        return url || null;
    }

    function parsePositionToken(token, axis) {
        const t = String(token || '').trim().toLowerCase();
        if (!t) return null;
        if (t === 'center') return 0.5;
        if (axis === 'x') {
            if (t === 'left') return 0;
            if (t === 'right') return 1;
        } else {
            if (t === 'top') return 0;
            if (t === 'bottom') return 1;
        }
        if (t.endsWith('%')) {
            const n = parseFloat(t);
            return Number.isFinite(n) ? Math.min(1, Math.max(0, n / 100)) : null;
        }
        return null; // px offsets are not used by the wallpaper settings; caller keeps center
    }

    /** CSS background-position → fractions {x, y}; supports keyword and percentage forms. */
    function parseWallpaperPosition(value) {
        const tokens = String(value || 'center').trim().split(/\s+/).filter(Boolean);
        let x = 0.5;
        let y = 0.5;
        if (tokens.length === 1) {
            const t = tokens[0].toLowerCase();
            if (t === 'top' || t === 'bottom') {
                y = parsePositionToken(t, 'y');
            } else {
                const px = parsePositionToken(t, 'x');
                if (px !== null) x = px;
            }
        } else if (tokens.length >= 2) {
            let [a, b] = tokens;
            const al = a.toLowerCase();
            const bl = b.toLowerCase();
            if (al === 'top' || al === 'bottom' || bl === 'left' || bl === 'right') {
                [a, b] = [b, a];
            }
            const px = parsePositionToken(a, 'x');
            const py = parsePositionToken(b, 'y');
            if (px !== null) x = px;
            if (py !== null) y = py;
        }
        return { x, y };
    }

    /** background-size: cover geometry of the wallpaper in the viewport (same math as .desktop-wallpaper). */
    function computeCoverGeometry(imageWidth, imageHeight, viewportWidth, viewportHeight, position) {
        if (!(imageWidth > 0) || !(imageHeight > 0) || !(viewportWidth > 0) || !(viewportHeight > 0)) {
            return null;
        }
        const scale = Math.max(viewportWidth / imageWidth, viewportHeight / imageHeight);
        const width = imageWidth * scale;
        const height = imageHeight * scale;
        const pos = position || { x: 0.5, y: 0.5 };
        return {
            width,
            height,
            x: (viewportWidth - width) * pos.x,
            y: (viewportHeight - height) * pos.y
        };
    }

    function isModalAnimating(modal) {
        // _rectMorph: the maximize / restore morph (modalUtils.js playModalRectMorph, #441)
        return ANIMATING_CLASSES.some((cls) => modal.classList.contains(cls))
            || !!(modal._rectMorph && modal._rectMorph.playState === 'running');
    }

    /** Viewport origin of a window's border box, independent of transient transforms. */
    function computeModalOrigin(modal) {
        if (!modal) return null;
        if (!isModalAnimating(modal) && !modal.hasAttribute('data-dragging')) {
            const rect = modal.getBoundingClientRect();
            return { x: rect.left, y: rect.top };
        }
        // Mid-animation the rect carries the keyframe scale and the drag transform; use
        // layout boxes instead. Unsettled windows sit at left/top minus half their size
        // (translate(-50%, -50%)), top-anchored ones only shift on X, and pixel-settled
        // windows use left/top directly (app.css .modal-pixel-settled).
        const settled = modal.classList.contains('modal-pixel-settled');
        const anchorTop = !!(modal.dataset && modal.dataset.windowContentAnchor === 'top');
        const width = modal.offsetWidth || 0;
        const height = modal.offsetHeight || 0;
        return {
            x: modal.offsetLeft - (settled ? 0 : width / 2),
            y: modal.offsetTop - (settled || anchorTop ? 0 : height / 2)
        };
    }

    function roundToDevicePixel(value) {
        const dpr = (win && win.devicePixelRatio) || 1;
        return Math.round(value * dpr) / dpr;
    }

    // ---------- mode ----------

    function readStoredMode() {
        try {
            const stored = normalizeMode(localStorage.getItem(STORAGE_KEY));
            if (stored) return stored;
            if (localStorage.getItem(LEGACY_BLUR_KEY) === 'true') return 'basic';
        } catch (_) { /* storage unavailable */ }
        return DEFAULT_MODE;
    }

    function applyModeToDocument(mode) {
        if (!root) return;
        root.dataset.glass = mode;
        root.classList.toggle('disable-blur', mode === 'basic');
    }

    function setMode(nextMode, options = {}) {
        const mode = normalizeMode(nextMode);
        if (!mode) return state.mode;
        const previous = state.mode;
        state.mode = mode;
        if (mode !== 'basic') state.lastGlassMode = mode;
        applyModeToDocument(mode);
        if (options.persist !== false) {
            try {
                localStorage.setItem(STORAGE_KEY, mode);
                // themePreferences.js and the Liquid Glass menu indicator still read this key
                localStorage.setItem(LEGACY_BLUR_KEY, mode === 'basic' ? 'true' : 'false');
            } catch (_) { /* storage unavailable */ }
        }
        if (isCachedMode(mode)) {
            scheduleWallpaperRefresh(false);
        }
        if (mode !== 'live') clearBackdrops();
        syncAllModals();
        if (previous !== mode && doc && typeof CustomEvent === 'function') {
            doc.dispatchEvent(new CustomEvent('aeroGlassModeChanged', { detail: { mode, previous } }));
        }
        return mode;
    }

    function getMode() {
        return state.mode || readStoredMode();
    }

    /** Liquid Glass menu toggle: basic ↔ the last glass mode. */
    function toggleBasic() {
        return setMode(state.mode === 'basic' ? state.lastGlassMode : 'basic');
    }

    function cycleMode() {
        const index = MODES.indexOf(state.mode);
        return setMode(MODES[(index + 1) % MODES.length]);
    }

    // ---------- per-window origin ----------

    // Every mode tracks the origin: the frosted wallpaper copy and the screen-anchored
    // streaks (#407, all modes) both read --aero-x / --aero-y.
    // Melaton Mobile (html.ui-mobile) has no window frames: the phone shell re-hosts desktop dialogs
    // flat, so frame origins, surface origins, contrast sampling and the frosted copy are all wasted
    // work there (#723: about a third of Studio's open on a phone went here).
    function phoneUi() {
        return !!(root && root.classList && root.classList.contains('ui-mobile'));
    }

    function syncModal(modal) {
        if (!modal || phoneUi()) return false;
        if (modal.classList.contains('hidden') || modal.classList.contains('hidden-alt')) return false;
        const origin = computeModalOrigin(modal);
        if (!origin) return false;
        const x = roundToDevicePixel(origin.x);
        const y = roundToDevicePixel(origin.y);
        if (modal._aeroX !== x || modal._aeroY !== y) {
            modal._aeroX = x;
            modal._aeroY = y;
            modal.style.setProperty('--aero-x', `${x}px`);
            modal.style.setProperty('--aero-y', `${y}px`);
        }
        syncSurfaces(modal);
        if (state.mode === 'live') {
            observeBackdropModal(modal);
            scheduleBackdrops();
        }
        return true;
    }

    /**
     * Toolbars and floating buttons inside a window that share the frame glass
     * ([data-aero-surface], e.g. the workspace header bar and its jump buttons): their own
     * viewport origin goes to --aero-sx / --aero-sy; drag offsets inherit from the window.
     */
    function syncSurfaces(modal) {
        if (!modal || typeof modal.querySelectorAll !== 'function' || phoneUi()) return 0;
        let count = 0;
        modal.querySelectorAll('[data-aero-surface]').forEach((el) => {
            const rect = el.getBoundingClientRect();
            if (!rect.width && !rect.height) return;
            const x = roundToDevicePixel(rect.left);
            const y = roundToDevicePixel(rect.top);
            if (el._aeroSx !== x || el._aeroSy !== y) {
                el._aeroSx = x;
                el._aeroSy = y;
                el.style.setProperty('--aero-sx', `${x}px`);
                el.style.setProperty('--aero-sy', `${y}px`);
            }
            if (!el._aeroSurfaceObserved && typeof ResizeObserver === 'function') {
                el._aeroSurfaceObserved = true;
                new ResizeObserver(() => syncSurfaces(modal)).observe(el);
            }
            if (el.hasAttribute('data-aero-contrast')) observeContrastModal(modal);
            count += 1;
        });
        if (count) scheduleContrast();
        return count;
    }

    function syncAllModals() {
        if (!doc) return 0;
        let count = 0;
        doc.querySelectorAll('.modal:not(.hidden):not(.hidden-alt)').forEach((modal) => {
            if (syncModal(modal)) count += 1;
        });
        return count;
    }

    // ---------- surface contrast ----------
    // [data-aero-contrast] surfaces (the Workspaces bar) get data-backdrop="light" | "dark"
    // from the glass actually painted under them: their computed background (frame colour,
    // tint, sheen) over the frosted wallpaper copy at their spot. An inactive frame over a
    // bright wallpaper turns pale, and the light glyphs vanish; CSS then draws dark ones
    // (vista-glass-controls.css). Live has no wallpaper copy, so there it is the colour alone.

    /** Computed colour string (rgb(), rgba(), color(srgb …)) to [r, g, b, a], channels 0–1. */
    function parseCssColor(value) {
        if (typeof value !== 'string') return null;
        const text = value.trim();
        if (text === 'transparent') return [0, 0, 0, 0];
        let m = text.match(/^rgba?\(\s*([\d.]+)[\s,]+([\d.]+)[\s,]+([\d.]+)(?:\s*[,/]\s*([\d.]+)(%?))?\s*\)$/i);
        if (m) {
            const a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1);
            return [parseFloat(m[1]) / 255, parseFloat(m[2]) / 255, parseFloat(m[3]) / 255, a];
        }
        m = text.match(/^color\(\s*srgb\s+([-\d.e]+)\s+([-\d.e]+)\s+([-\d.e]+)(?:\s*\/\s*([\d.]+)(%?))?\s*\)$/i);
        if (m) {
            const a = m[4] === undefined ? 1 : parseFloat(m[4]) / (m[5] ? 100 : 1);
            return [m[1], m[2], m[3]].map((v) => Math.min(1, Math.max(0, parseFloat(v)))).concat(a);
        }
        return null;
    }

    /** Comma-separated background layers, ignoring commas inside parentheses. */
    function splitCssLayers(value) {
        const layers = [];
        let depth = 0;
        let start = 0;
        const text = String(value || '');
        for (let i = 0; i < text.length; i += 1) {
            const ch = text[i];
            if (ch === '(') depth += 1;
            else if (ch === ')') depth -= 1;
            else if (ch === ',' && depth === 0) {
                layers.push(text.slice(start, i).trim());
                start = i + 1;
            }
        }
        const last = text.slice(start).trim();
        if (last) layers.push(last);
        return layers;
    }

    /** A gradient layer as one flat colour: the mean of its stops (premultiplied). */
    function gradientMeanColor(layer) {
        const stops = (layer.match(/rgba?\([^)]*\)|color\(srgb[^)]*\)|transparent/gi) || [])
            .map(parseCssColor)
            .filter(Boolean);
        if (!stops.length) return null;
        const sum = [0, 0, 0, 0];
        stops.forEach(([r, g, b, a]) => {
            sum[0] += r * a; sum[1] += g * a; sum[2] += b * a; sum[3] += a;
        });
        const a = sum[3] / stops.length;
        if (!(sum[3] > 0)) return [0, 0, 0, 0];
        return [sum[0] / sum[3], sum[1] / sum[3], sum[2] / sum[3], a];
    }

    function compositeOver(base, layer) {
        if (!layer) return base;
        const a = layer[3];
        return [0, 1, 2].map((i) => layer[i] * a + base[i] * (1 - a));
    }

    /** APCA-W3 0.0.98G Lc magnitude of a glyph colour on a backdrop colour (sRGB 0–1). */
    function apcaContrast(text, background) {
        const screenY = (c) => {
            const y = 0.2126729 * Math.pow(c[0], 2.4) + 0.7151522 * Math.pow(c[1], 2.4) + 0.0721750 * Math.pow(c[2], 2.4);
            return y < 0.022 ? y + Math.pow(0.022 - y, 1.414) : y;
        };
        const txt = screenY(text);
        const bg = screenY(background);
        if (bg > txt) {
            const s = (Math.pow(bg, 0.56) - Math.pow(txt, 0.57)) * 1.14;
            return s < 0.1 ? 0 : (s - 0.027) * 100;
        }
        const s = (Math.pow(bg, 0.65) - Math.pow(txt, 0.62)) * 1.14;
        return s > -0.1 ? 0 : -(s + 0.027) * 100;
    }

    /**
     * "light" when dark glyphs read clearly better on this backdrop than the light ones. The
     * current state holds until the other side wins by the hysteresis margin, so a backdrop
     * near the middle does not flip back and forth as the window moves.
     */
    function pickBackdrop(rgb, current, lightGlyph) {
        const light = apcaContrast(lightGlyph || config.contrastLightGlyph, rgb);
        const dark = apcaContrast(config.contrastDarkGlyph, rgb);
        if (current === 'light') return light > dark + config.contrastHysteresisLc ? 'dark' : 'light';
        return dark > light + config.contrastHysteresisLc ? 'light' : 'dark';
    }

    /** Any CSS colour (hex, hsl(), a var's token string …) to [r, g, b, a] via a canvas fillStyle round trip. */
    function resolveCssColor(value) {
        const direct = parseCssColor(value);
        if (direct) return direct;
        if (!doc || !value) return null;
        try {
            if (!state.colorCtx) state.colorCtx = doc.createElement('canvas').getContext('2d');
            const ctx = state.colorCtx;
            if (!ctx) return null;
            ctx.fillStyle = '#010203';
            ctx.fillStyle = String(value).trim();
            const out = String(ctx.fillStyle);
            if (out === '#010203') return null; // not understood
            const hex = out.match(/^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i);
            if (hex) return [1, 2, 3].map((i) => parseInt(hex[i], 16) / 255).concat(1);
            return parseCssColor(out);
        } catch (_) {
            return null;
        }
    }

    /** The light glyph the bar draws at rest: the workspace accent, a shade darker. */
    function restingLightGlyph(el) {
        let accent = null;
        try { accent = resolveCssColor(getComputedStyle(el).getPropertyValue('--text-accent-tinted')); } catch (_) { /* detached */ }
        if (!accent) return config.contrastLightGlyph;
        return accent.slice(0, 3).map((v) => v * (1 - config.contrastRestDarken));
    }

    /** A small copy of the blurred frame wallpaper for averaging (null where the canvas can't be read). */
    function readWallpaperSample(canvas) {
        try {
            const width = Math.min(config.contrastSampleWidth, canvas.width);
            const height = Math.max(1, Math.round(canvas.height * (width / canvas.width)));
            const small = doc.createElement('canvas');
            small.width = width;
            small.height = height;
            const ctx = small.getContext('2d', { willReadFrequently: true });
            if (!ctx || typeof ctx.getImageData !== 'function') return null;
            ctx.imageSmoothingEnabled = true;
            ctx.drawImage(canvas, 0, 0, width, height);
            return { width, height, data: ctx.getImageData(0, 0, width, height).data };
        } catch (_) {
            return null; // tainted canvas: the wallpaper layer is then left out
        }
    }

    /** Mean wallpaper colour under a viewport rect, as the frosted layer paints it (cover geometry). */
    function wallpaperMeanUnder(rect) {
        const sample = state.wallpaperSample;
        if (!sample || !win) return null;
        const geo = computeCoverGeometry(state.imageWidth, state.imageHeight, win.innerWidth, win.innerHeight, state.position);
        if (!geo) return null;
        const toX = (x) => ((x - geo.x) / geo.width) * sample.width;
        const toY = (y) => ((y - geo.y) / geo.height) * sample.height;
        const x0 = Math.max(0, Math.min(sample.width - 1, Math.floor(toX(rect.left))));
        const y0 = Math.max(0, Math.min(sample.height - 1, Math.floor(toY(rect.top))));
        const x1 = Math.max(x0 + 1, Math.min(sample.width, Math.ceil(toX(rect.left + rect.width))));
        const y1 = Math.max(y0 + 1, Math.min(sample.height, Math.ceil(toY(rect.top + rect.height))));
        const sum = [0, 0, 0];
        let n = 0;
        for (let y = y0; y < y1; y += 1) {
            for (let x = x0; x < x1; x += 1) {
                const i = (y * sample.width + x) * 4;
                sum[0] += sample.data[i]; sum[1] += sample.data[i + 1]; sum[2] += sample.data[i + 2];
                n += 1;
            }
        }
        return n ? sum.map((v) => v / n / 255) : null;
    }

    /** The glass colour under a surface: background-color, the wallpaper copy, then the gradient layers top-most last. */
    function surfaceBackdrop(el) {
        const rect = el.getBoundingClientRect();
        if (!(rect.width > 0) || !(rect.height > 0)) return null;
        const cs = getComputedStyle(el);
        let rgb = compositeOver([0, 0, 0], parseCssColor(cs.backgroundColor));
        const layers = splitCssLayers(cs.backgroundImage === 'none' ? '' : cs.backgroundImage);
        for (let i = layers.length - 1; i >= 0; i -= 1) {
            const layer = layers[i];
            if (/^url\(/i.test(layer)) {
                const wall = state.mode === 'frosted' ? wallpaperMeanUnder(rect) : null;
                if (wall) rgb = wall;
            } else if (/gradient\(/i.test(layer)) {
                rgb = compositeOver(rgb, gradientMeanColor(layer));
            }
        }
        return rgb;
    }

    function syncContrast() {
        if (!doc || typeof getComputedStyle !== 'function') return 0;
        let count = 0;
        doc.querySelectorAll('[data-aero-contrast]').forEach((el) => {
            const rgb = surfaceBackdrop(el);
            if (!rgb) return; // hidden: keep the last answer for when it shows again
            const next = pickBackdrop(rgb, el.dataset.backdrop, restingLightGlyph(el));
            if (el.dataset.backdrop !== next) el.dataset.backdrop = next;
            count += 1;
        });
        return count;
    }

    function scheduleContrast() {
        clearTimeout(state.contrastTimer);
        if (phoneUi()) return;
        state.contrastTimer = setTimeout(() => {
            state.contrastTimer = null;
            syncContrast();
        }, config.contrastDebounceMs);
    }

    /** Focus moves the frame between the active and inactive tint: watch the window's class. */
    function observeContrastModal(modal) {
        if (!modal || modal._aeroContrastObserved || typeof MutationObserver !== 'function') return;
        modal._aeroContrastObserved = true;
        new MutationObserver(scheduleContrast).observe(modal, { attributes: true, attributeFilter: ['class'] });
    }

    // ---------- frosted wallpaper ----------

    function readComputedVar(name) {
        if (!doc || typeof getComputedStyle !== 'function') return '';
        let value = '';
        try {
            value = getComputedStyle(doc.body).getPropertyValue(name);
            if (!value || !value.trim()) value = getComputedStyle(root).getPropertyValue(name);
        } catch (_) { /* detached */ }
        return (value || '').trim();
    }

    function readWallpaperUrl() {
        // A workspace without its own wallpaper shows the default (desktop-shell.css)
        return parseCssUrl(readComputedVar('--desktop-wallpaper') || readComputedVar('--desktop-wallpaper-default'));
    }

    function readWallpaperPosition() {
        return parseWallpaperPosition(readComputedVar('--desktop-wallpaper-position') || 'center');
    }

    function absoluteUrl(url) {
        try {
            return new URL(url, win && win.location ? win.location.href : undefined).href;
        } catch (_) {
            return url;
        }
    }

    function isCrossOrigin(url) {
        try {
            return new URL(url, win.location.href).origin !== win.location.origin;
        } catch (_) {
            return false;
        }
    }

    function loadImage(url) {
        return new Promise((resolve, reject) => {
            const crossOrigin = isCrossOrigin(url);
            // Reuse the decoded wallpaper workspaceUtils.js already holds (same-origin only:
            // an image fetched without crossOrigin would taint the canvas).
            if (!crossOrigin) {
                try {
                    if (typeof wallpaperMemoryImages !== 'undefined' && wallpaperMemoryImages
                        && typeof wallpaperMemoryImages.get === 'function') {
                        const cached = wallpaperMemoryImages.get(url);
                        if (cached && cached.complete && cached.naturalWidth > 0) {
                            resolve(cached);
                            return;
                        }
                    }
                } catch (_) { /* not available */ }
            }
            const img = new Image();
            if (crossOrigin) img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('wallpaper load failed'));
            img.src = url;
        });
    }

    /** Draw the image plus clamped 1px edges into the padding so the blur never fades at the border. */
    function drawClampedSource(ctx, img, width, height, pad) {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        ctx.drawImage(img, pad, pad, width, height);
        ctx.drawImage(img, 0, 0, 1, nh, 0, pad, pad, height);
        ctx.drawImage(img, nw - 1, 0, 1, nh, pad + width, pad, pad, height);
        ctx.drawImage(img, 0, 0, nw, 1, pad, 0, width, pad);
        ctx.drawImage(img, 0, nh - 1, nw, 1, pad, pad + height, width, pad);
        ctx.drawImage(img, 0, 0, 1, 1, 0, 0, pad, pad);
        ctx.drawImage(img, nw - 1, 0, 1, 1, pad + width, 0, pad, pad);
        ctx.drawImage(img, 0, nh - 1, 1, 1, 0, pad + height, pad, pad);
        ctx.drawImage(img, nw - 1, nh - 1, 1, 1, pad + width, pad + height, pad, pad);
    }

    function blurInto(source, width, height, pad, blur, filter) {
        const target = doc.createElement('canvas');
        target.width = width;
        target.height = height;
        const ctx = target.getContext('2d', { alpha: false });
        if (!ctx) throw new Error('no 2d context');
        ctx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in ctx) ctx.imageSmoothingQuality = 'high';
        if ('filter' in ctx) {
            ctx.filter = `blur(${blur}px) ${filter || config.frostedFilter}`;
            ctx.drawImage(source, -pad, -pad);
            ctx.filter = 'none';
        } else {
            // No canvas filter (older WebKit): shrink hard, then scale back up with smoothing.
            const shrink = Math.max(2, Math.round(blur * 0.8));
            const small = doc.createElement('canvas');
            small.width = Math.max(8, Math.round(source.width / shrink));
            small.height = Math.max(8, Math.round(source.height / shrink));
            const smallCtx = small.getContext('2d');
            smallCtx.imageSmoothingEnabled = true;
            smallCtx.drawImage(source, 0, 0, small.width, small.height);
            ctx.drawImage(small, -pad, -pad, source.width, source.height);
        }
        return target;
    }

    function canvasToBlob(canvas) {
        return new Promise((resolve, reject) => {
            try {
                canvas.toBlob((blob) => {
                    if (blob) resolve(blob);
                    else reject(new Error('toBlob returned null'));
                }, 'image/jpeg', config.jpegQuality);
            } catch (err) {
                reject(err); // SecurityError from a tainted canvas lands here
            }
        });
    }

    /**
     * Blur radii and colour filters of the copies, in copy pixels. Frosted is a fixed share of the
     * copy's width; live is the backdrop-filter's CSS radius at the wallpaper's cover scale for this
     * viewport (so it changes with the resolution: part of the build key).
     */
    function computeRecipe(mode, nw, nh, width, viewportWidth, viewportHeight) {
        if (mode === 'live') {
            const geo = computeCoverGeometry(nw, nh, viewportWidth, viewportHeight, { x: 0.5, y: 0.5 });
            const perCss = geo ? width / geo.width : 0.5;
            const q = (v) => Math.max(0.5, Math.round(v * 4) / 4);
            return {
                blur: q(config.liveBlurPx * perCss),
                filter: config.liveFilter,
                lightBlur: q(config.liveTaskbarBlurPx * perCss),
                lightFilter: config.liveTaskbarFilter
            };
        }
        const blur = Math.max(config.frostedMinBlurPx, Math.round(width * config.frostedBlurRatio));
        return {
            blur,
            filter: config.frostedFilter,
            lightBlur: Math.max(2, Math.round(blur * config.taskbarBlurRatio)),
            lightFilter: config.frostedFilter
        };
    }

    function copySize(nw, nh) {
        const scale = Math.min(1, config.frostedMaxWidth / nw);
        return { width: Math.max(16, Math.round(nw * scale)), height: Math.max(16, Math.round(nh * scale)) };
    }

    /** Frame copy plus a lighter taskbar copy from one clamped source draw. */
    async function renderFrosted(img, mode) {
        const nw = img.naturalWidth;
        const nh = img.naturalHeight;
        if (!(nw > 0) || !(nh > 0)) throw new Error('wallpaper has no size');
        const { width, height } = copySize(nw, nh);
        const recipe = computeRecipe(mode, nw, nh, width, win ? win.innerWidth : 0, win ? win.innerHeight : 0);
        const blur = recipe.blur;
        const lightBlur = recipe.lightBlur;
        const pad = Math.ceil(Math.max(blur, lightBlur) * 2);

        const source = doc.createElement('canvas');
        source.width = width + pad * 2;
        source.height = height + pad * 2;
        const sourceCtx = source.getContext('2d');
        if (!sourceCtx) throw new Error('no 2d context');
        sourceCtx.imageSmoothingEnabled = true;
        if ('imageSmoothingQuality' in sourceCtx) sourceCtx.imageSmoothingQuality = 'high';
        drawClampedSource(sourceCtx, img, width, height, pad);

        const frame = blurInto(source, width, height, pad, blur, recipe.filter);
        const sample = readWallpaperSample(frame);
        const blob = await canvasToBlob(frame);
        const blobLight = await canvasToBlob(blurInto(source, width, height, pad, lightBlur, recipe.lightFilter));
        // live keeps the unfiltered copy: the per-window textures blur it together with the windows behind
        const composeSource = mode === 'live' ? { canvas: source, pad, width } : null;
        return { blob, blobLight, sample, composeSource, width: nw, height: nh };
    }

    function revokeLater(url) {
        if (!url || typeof URL === 'undefined' || typeof URL.revokeObjectURL !== 'function') return;
        setTimeout(() => {
            try { URL.revokeObjectURL(url); } catch (_) { /* already gone */ }
        }, config.revokeDelayMs);
    }

    // The copy's URLs and cover geometry go to the elements that paint them, through one rule in
    // <style id="aeroGlassCopy">, not to <html>: an inherited custom property changed on the root
    // restyles the whole document (1.2 s for 24k elements on the test tab, Nov 20 2026), the rule
    // only the frames, the taskbar and the Start menu (~30 ms).
    const COPY_STYLE_ID = 'aeroGlassCopy';
    const COPY_TARGETS = '.modal::before, .modal [data-aero-surface], #galleryWindow [data-aero-surface], .desktop-taskbar::after, #startMenu.start-menu';
    const copyVars = new Map();

    function setCopyVar(name, value) {
        if (value === null || value === undefined) copyVars.delete(name);
        else copyVars.set(name, value);
    }

    function flushCopyVars() {
        if (!doc || !doc.head || typeof doc.createElement !== 'function') return;
        const decls = Array.from(copyVars, ([k, v]) => `${k}: ${v};`).join(' ');
        const css = decls ? `${COPY_TARGETS} { ${decls} }` : '';
        let el = typeof doc.getElementById === 'function' ? doc.getElementById(COPY_STYLE_ID) : null;
        if (!el) {
            if (!css) return;
            el = doc.createElement('style');
            el.id = COPY_STYLE_ID;
            doc.head.appendChild(el);
        }
        if (el.textContent !== css) el.textContent = css;
    }

    function publishCoverVars() {
        if (!root || !win) return;
        const vw = win.innerWidth;
        const vh = win.innerHeight;
        root.style.setProperty('--aero-vw', `${vw}px`);
        root.style.setProperty('--aero-vh', `${vh}px`);
        const geo = computeCoverGeometry(state.imageWidth, state.imageHeight, vw, vh, state.position);
        if (!geo) {
            flushCopyVars();
            return;
        }
        setCopyVar('--aero-cover-w', `${roundToDevicePixel(geo.width)}px`);
        setCopyVar('--aero-cover-h', `${roundToDevicePixel(geo.height)}px`);
        setCopyVar('--aero-cover-x', `${roundToDevicePixel(geo.x)}px`);
        setCopyVar('--aero-cover-y', `${roundToDevicePixel(geo.y)}px`);
        flushCopyVars();
    }

    function clearFrosted() {
        setCopyVar('--aero-wallpaper', null);
        setCopyVar('--aero-wallpaper-light', null);
        flushCopyVars();
        const previous = state.blobUrl;
        const previousLight = state.blobLightUrl;
        state.sourceUrl = null;
        state.blobUrl = null;
        state.blobLightUrl = null;
        state.imageWidth = 0;
        state.imageHeight = 0;
        state.wallpaperSample = null;
        state.builtKey = null;
        state.composeSource = null;
        revokeLater(previous);
        revokeLater(previousLight);
        scheduleContrast();
    }

    /** What the published copy was made for: a change of any part means a rebuild. */
    function buildKeyFor(mode, absolute) {
        if (mode !== 'live' || !win) return `${mode}|${absolute}`;
        // the live radius follows the cover scale: key it to the copy's blur, not the raw viewport
        if (!(state.imageWidth > 0) || state.sourceUrl !== absolute) return `${mode}|${absolute}|?`;
        const { width } = copySize(state.imageWidth, state.imageHeight);
        const recipe = computeRecipe(mode, state.imageWidth, state.imageHeight, width, win.innerWidth, win.innerHeight);
        return `${mode}|${absolute}|${recipe.blur}|${recipe.lightBlur}`;
    }

    async function ensureFrosted(options = {}) {
        if (!doc || !root || !isCachedMode(state.mode) || phoneUi()) return false;
        const url = readWallpaperUrl();
        state.position = readWallpaperPosition();
        if (!url) {
            clearFrosted();
            publishCoverVars();
            return false;
        }
        const absolute = absoluteUrl(url);
        if (!options.force && state.blobUrl && state.builtKey === buildKeyFor(state.mode, absolute)) {
            publishCoverVars();
            return true;
        }
        if (!options.force && absolute === state.failedUrl) {
            return false;
        }
        if (!options.force && state.inflight && state.inflight.url === absolute && state.inflight.mode === state.mode) {
            return state.inflight.promise;
        }
        const token = ++state.buildToken;
        const promise = buildFrosted(absolute, token, state.mode);
        state.inflight = { url: absolute, mode: state.mode, promise };
        try {
            return await promise;
        } finally {
            if (state.inflight && state.inflight.promise === promise) state.inflight = null;
        }
    }

    async function buildFrosted(absolute, token, mode) {
        try {
            const img = await loadImage(absolute);
            if (token !== state.buildToken) return false;
            const result = await renderFrosted(img, mode);
            if (token !== state.buildToken) return false;
            const nextUrl = URL.createObjectURL(result.blob);
            const nextLightUrl = URL.createObjectURL(result.blobLight);
            const previous = state.blobUrl;
            const previousLight = state.blobLightUrl;
            state.sourceUrl = absolute;
            state.blobUrl = nextUrl;
            state.blobLightUrl = nextLightUrl;
            state.imageWidth = result.width;
            state.imageHeight = result.height;
            state.wallpaperSample = result.sample || null;
            state.composeSource = result.composeSource || null;
            state.builtKey = buildKeyFor(mode, absolute);
            state.failedUrl = null;
            setCopyVar('--aero-wallpaper', `url("${nextUrl}")`);
            setCopyVar('--aero-wallpaper-light', `url("${nextLightUrl}")`);
            publishCoverVars();
            syncAllModals();
            revokeLater(previous);
            revokeLater(previousLight);
            if (mode === 'live') scheduleBackdrops({ force: true });
            return true;
        } catch (err) {
            if (token !== state.buildToken) return false;
            state.failedUrl = absolute;
            clearFrosted();
            if (typeof console !== 'undefined' && console.warn) {
                console.warn('aeroGlass: frosted wallpaper unavailable, frames fall back to tint:', err && err.message);
            }
            return false;
        }
    }

    function scheduleWallpaperRefresh(force) {
        if (!isCachedMode(state.mode) || phoneUi()) return;
        clearTimeout(state.refreshTimer);
        state.refreshTimer = setTimeout(() => {
            state.refreshTimer = null;
            ensureFrosted({ force: !!force });
        }, config.wallpaperRefreshDebounceMs);
    }

    function handleResize() {
        clearTimeout(state.resizeTimer);
        state.resizeTimer = setTimeout(() => {
            state.resizeTimer = null;
            publishCoverVars();
            // live's copy is blurred for this resolution's cover scale; a no-op when the key holds
            if (state.mode === 'live') scheduleWallpaperRefresh(false);
            syncAllModals();
        }, config.resizeDebounceMs);
    }

    // ---------- live: windows behind a window ----------
    // A window over other windows gets a texture of its own: the unfiltered wallpaper copy, the
    // lower windows as blocks (frame tint, client colour), then live's blur + colour recipe, at half
    // resolution. CSS lays it over the shared copy (--aero-backdrop, registered non-inheriting so a
    // new texture restyles the frame paint only, not the window's subtree). Windows over nothing use
    // the shared copy alone. Built on stack changes only, never per frame, never while hidden.

    function isFrameWindow(modal) {
        if (!modal || !modal.classList) return false;
        const cl = modal.classList;
        if (cl.contains('hidden') || cl.contains('hidden-alt') || cl.contains('minimised')
            || cl.contains('alert-theme') || cl.contains('warning-theme') || cl.contains('success-theme')) return false;
        if (modal.id === 'manualModal' && !cl.contains('windowed')) return false;
        return modal.offsetWidth > 0 && modal.offsetHeight > 0;
    }

    function modalZ(modal) {
        let z = parseInt(modal.style.zIndex, 10);
        if (!Number.isFinite(z)) {
            try { z = parseInt(getComputedStyle(modal).zIndex, 10); } catch (_) { z = 0; }
        }
        return Number.isFinite(z) ? z : 0;
    }

    function rectsMeet(a, b, margin) {
        return a.left - margin < b.right && b.left < a.right + margin
            && a.top - margin < b.bottom && b.top < a.bottom + margin;
    }

    function cssColorOf(value, fallback) {
        const c = resolveCssColor(value);
        return c ? `rgba(${Math.round(c[0] * 255)}, ${Math.round(c[1] * 255)}, ${Math.round(c[2] * 255)}, ${c[3]})` : fallback;
    }

    /** What a lower window looks like through a 5 px blur: its frame tint and its client colour. */
    function describeLowerWindow(modal) {
        const rect = modal.getBoundingClientRect();
        const cs = getComputedStyle(modal);
        const active = modal.classList.contains('active-window');
        const maximized = modal.classList.contains('modal-maximized');
        const tint = cssColorOf(cs.getPropertyValue(maximized ? '--aero-tint-maximized' : (active ? '--aero-tint-active' : '--aero-tint-inactive')).trim(), 'rgba(40, 60, 80, 0.6)');
        let client = null;
        const content = modal.querySelector(':scope > .modal-content, :scope > .modal-body');
        if (content) {
            const r = content.getBoundingClientRect();
            const bg = parseCssColor(getComputedStyle(content).backgroundColor);
            if (r.width > 0 && r.height > 0 && bg && bg[3] > 0.05) {
                client = {
                    left: r.left, top: r.top, width: r.width, height: r.height,
                    color: `rgba(${Math.round(bg[0] * 255)}, ${Math.round(bg[1] * 255)}, ${Math.round(bg[2] * 255)}, ${bg[3]})`
                };
            }
        }
        return { left: rect.left, top: rect.top, width: rect.width, height: rect.height, tint, client };
    }

    /** Where the unfiltered copy lands in a texture whose top left is CSS (originX, originY), k texels per px. */
    function composeSourcePlacement(originX, originY, k) {
        const src = state.composeSource;
        const geo = src && win ? computeCoverGeometry(state.imageWidth, state.imageHeight, win.innerWidth, win.innerHeight, state.position) : null;
        if (!geo) return null;
        const cssPerPx = geo.width / src.width;
        return [
            (geo.x - src.pad * cssPerPx - originX) * k,
            (geo.y - src.pad * cssPerPx - originY) * k,
            src.canvas.width * cssPerPx * k,
            src.canvas.height * cssPerPx * k
        ];
    }

    /**
     * One texture: the copy, the lower windows as blocks, then the blur + colour recipe. Pure canvas
     * work so it runs the same in the worker (OffscreenCanvas) and on the main thread (fallback).
     */
    function paintBackdrop(makeCanvas, source, job) {
        const work = makeCanvas(job.workWidth, job.workHeight);
        const wctx = work.getContext('2d', { alpha: false });
        wctx.imageSmoothingEnabled = true;
        wctx.drawImage(source, job.place[0], job.place[1], job.place[2], job.place[3]);
        job.blocks.forEach((b) => {
            wctx.fillStyle = b[4];
            wctx.fillRect(b[0], b[1], b[2], b[3]);
        });
        const out = makeCanvas(job.width, job.height);
        const octx = out.getContext('2d', { alpha: false });
        octx.imageSmoothingEnabled = true;
        if ('filter' in octx) octx.filter = job.filter;
        octx.drawImage(work, -job.margin, -job.margin);
        return out;
    }

    function backdropWorkerMain() {
        let source = null;
        // app-scope: allow worker global (this function runs in the backdrop Worker, never on the page)
        self.onmessage = async (event) => {
            const msg = event.data || {};
            if (msg.type === 'source') {
                if (source && source.close) source.close();
                source = msg.bitmap;
                return;
            }
            if (msg.type !== 'job') return;
            try {
                if (!source) throw new Error('no source');
                const out = paintBackdrop((w, h) => new OffscreenCanvas(w, h), source, msg.job);
                const blob = await out.convertToBlob({ type: 'image/jpeg', quality: msg.quality });
                self.postMessage({ id: msg.id, blob });
            } catch (err) {
                self.postMessage({ id: msg.id, error: String(err && err.message) });
            }
        };
    }

    function stopBackdropWorker() {
        const bw = state.backdropWorker;
        if (!bw) return;
        state.backdropWorker = null;
        try { bw.worker.terminate(); } catch (_) { /* gone */ }
        try { URL.revokeObjectURL(bw.url); } catch (_) { /* gone */ }
        bw.jobs.forEach((resolve) => resolve(null));
    }

    function backdropWorker() {
        if (state.backdropWorker) return state.backdropWorker;
        if (typeof Worker !== 'function' || typeof OffscreenCanvas !== 'function' || typeof createImageBitmap !== 'function'
            || typeof Blob !== 'function') return null;
        try {
            const url = URL.createObjectURL(new Blob([
                'const paintBackdrop = ' + paintBackdrop.toString() + ';\n(' + backdropWorkerMain.toString() + ')();'
            ], { type: 'text/javascript' }));
            const worker = new Worker(url);
            const bw = { worker, url, jobs: new Map(), seq: 0, sourceFor: null, sourceReady: null };
            worker.onmessage = (event) => {
                const msg = event.data || {};
                const resolve = bw.jobs.get(msg.id);
                if (!resolve) return;
                bw.jobs.delete(msg.id);
                resolve(msg.blob || null);
            };
            worker.onerror = () => { if (state.backdropWorker === bw) stopBackdropWorker(); };
            state.backdropWorker = bw;
            return bw;
        } catch (_) {
            return null;
        }
    }

    async function renderBackdrop(rect, lower) {
        const k = Math.min(config.backdropScale, config.backdropMaxSide / Math.max(rect.width, rect.height, 1));
        const margin = Math.ceil(config.liveBlurPx * 3);
        const ox = rect.left - margin;
        const oy = rect.top - margin;
        const place = composeSourcePlacement(ox, oy, k);
        if (!place) return null;
        const blocks = [];
        lower.forEach((w) => {
            blocks.push([(w.left - ox) * k, (w.top - oy) * k, w.width * k, w.height * k, w.tint]);
            if (w.client) blocks.push([(w.client.left - ox) * k, (w.client.top - oy) * k, w.client.width * k, w.client.height * k, w.client.color]);
        });
        const job = {
            place,
            blocks,
            margin: margin * k,
            workWidth: Math.max(1, Math.ceil((rect.width + margin * 2) * k)),
            workHeight: Math.max(1, Math.ceil((rect.height + margin * 2) * k)),
            width: Math.max(1, Math.round(rect.width * k)),
            height: Math.max(1, Math.round(rect.height * k)),
            filter: `blur(${config.liveBlurPx * k}px) ${config.liveFilter}`
        };
        const bw = backdropWorker();
        if (bw) {
            // one transfer per copy; jobs posted while it is on its way wait for it (posted in order)
            if (bw.sourceFor !== state.composeSource) {
                const source = state.composeSource;
                bw.sourceFor = source;
                bw.sourceReady = createImageBitmap(source.canvas).then((bitmap) => {
                    if (state.backdropWorker === bw) bw.worker.postMessage({ type: 'source', bitmap }, [bitmap]);
                });
            }
            await bw.sourceReady;
            if (state.backdropWorker !== bw) return null;
            const id = ++bw.seq;
            return new Promise((resolve) => {
                bw.jobs.set(id, resolve);
                bw.worker.postMessage({ type: 'job', id, job, quality: config.jpegQuality });
            });
        }
        const out = paintBackdrop((w, h) => {
            const c = doc.createElement('canvas');
            c.width = w;
            c.height = h;
            return c;
        }, state.composeSource.canvas, job);
        return canvasToBlob(out);
    }

    function setBackdrop(modal, url, key) {
        const previous = modal._aeroBackdropUrl;
        modal._aeroBackdropUrl = url || null;
        modal._aeroBackdropKey = key || null;
        if (url) modal.style.setProperty('--aero-backdrop', `url("${url}")`);
        else if (previous) modal.style.removeProperty('--aero-backdrop');
        if (previous && previous !== url) revokeLater(previous);
    }

    function clearBackdrops() {
        clearTimeout(state.backdropTimer);
        state.backdropTimer = null;
        state.backdropPending = false;
        state.backdropToken += 1;
        stopBackdropWorker();
        if (!doc) return;
        doc.querySelectorAll('.modal').forEach((modal) => {
            if (modal._aeroBackdropUrl || modal._aeroBackdropKey) setBackdrop(modal, null, null);
        });
    }

    async function composeBackdrops() {
        if (!doc || state.mode !== 'live' || phoneUi() || !state.composeSource) return 0;
        if (doc.visibilityState === 'hidden') {
            state.backdropPending = true;
            return 0;
        }
        const token = ++state.backdropToken;
        const desktop = !!(doc.body && doc.body.classList.contains('desktop-mode'));
        const frames = desktop
            ? Array.from(doc.querySelectorAll('.modal')).filter(isFrameWindow).map((modal, index) => ({ modal, index, z: modalZ(modal) }))
            : [];
        frames.sort((a, b) => (a.z - b.z) || (a.index - b.index));
        const margin = config.liveBlurPx * 3;
        let built = 0;
        const descriptions = new Map();
        const describe = (modal) => {
            if (!descriptions.has(modal)) descriptions.set(modal, describeLowerWindow(modal));
            return descriptions.get(modal);
        };
        const keep = new Set();
        const jobs = [];
        for (let i = 0; i < frames.length; i += 1) {
            const { modal } = frames[i];
            // moving / animating: keep the last texture, the move's settle composes again
            if (isModalAnimating(modal) || modal.hasAttribute('data-dragging') || modal.hasAttribute('data-resizing')) {
                keep.add(modal);
                continue;
            }
            if (modal.classList.contains('modal-maximized')) continue; // near-solid dark frame
            const rect = modal.getBoundingClientRect();
            const lower = [];
            for (let j = 0; j < i; j += 1) {
                const other = frames[j].modal;
                const r = other.getBoundingClientRect();
                if (rectsMeet(rect, r, margin)) lower.push(describe(other));
            }
            if (!lower.length) continue;
            keep.add(modal);
            const key = [state.builtKey, Math.round(rect.left), Math.round(rect.top), Math.round(rect.width), Math.round(rect.height)]
                .concat(lower.map((w) => [w.left, w.top, w.width, w.height, w.tint, w.client ? [w.client.left, w.client.top, w.client.width, w.client.height, w.client.color].join(',') : ''].map((v) => (typeof v === 'number' ? Math.round(v) : v)).join(',')))
                .join('|');
            if (modal._aeroBackdropKey !== key) jobs.push({ modal, rect, lower, key });
        }
        // Every read is done before the first write: one style pass for the whole stack, and the
        // textures are drawn together (in the worker where there is one).
        const blobs = await Promise.all(jobs.map((job) => renderBackdrop(job.rect, job.lower).catch(() => null)));
        if (token !== state.backdropToken) return 0; // a newer compose took over
        jobs.forEach((job, i) => {
            if (!blobs[i]) return;
            setBackdrop(job.modal, URL.createObjectURL(blobs[i]), job.key);
            built += 1;
        });
        // windows that no longer overlap anything go back to the shared copy
        doc.querySelectorAll('.modal').forEach((modal) => {
            if (!keep.has(modal) && (modal._aeroBackdropUrl || modal._aeroBackdropKey)) setBackdrop(modal, null, null);
        });
        return built;
    }

    function scheduleBackdrops(options = {}) {
        if (state.mode !== 'live' || phoneUi()) return;
        if (options.force && doc) doc.querySelectorAll('.modal').forEach((m) => { m._aeroBackdropKey = m._aeroBackdropUrl ? 'stale' : null; });
        clearTimeout(state.backdropTimer);
        state.backdropTimer = setTimeout(() => {
            state.backdropTimer = null;
            composeBackdrops();
        }, config.backdropDebounceMs);
    }

    /** Focus (z-order), close, minimise and the end of an open / drag show up as class changes; size as a resize. */
    function observeBackdropModal(modal) {
        if (!modal || phoneUi()) return;
        if (!state.observedModals) state.observedModals = new WeakSet();
        if (state.observedModals.has(modal)) return;
        state.observedModals.add(modal);
        const onChange = () => { if (state.mode === 'live') scheduleBackdrops(); };
        if (typeof MutationObserver === 'function') {
            new MutationObserver(onChange).observe(modal, { attributes: true, attributeFilter: ['class', 'data-dragging', 'data-resizing'] });
        }
        if (typeof ResizeObserver === 'function') new ResizeObserver(onChange).observe(modal);
    }

    function handleVisibility() {
        if (doc.visibilityState !== 'hidden' && state.backdropPending) {
            state.backdropPending = false;
            scheduleBackdrops();
        }
    }

    // ---------- init ----------

    function init() {
        if (!doc || !root) return;
        const mode = readStoredMode();
        if (!state.initialized) {
            state.initialized = true;
            if (win && typeof win.addEventListener === 'function') {
                win.addEventListener('resize', handleResize, { signal: appScopeSignal });
            }
            if (typeof doc.addEventListener === 'function') doc.addEventListener('visibilitychange', handleVisibility, { signal: appScopeSignal });
            if (typeof doc.addEventListener === 'function') {
                // the frame colour follows the workspace even when the wallpaper stays
                doc.addEventListener('workspaceChanged', () => { scheduleWallpaperRefresh(false); scheduleContrast(); }, { signal: appScopeSignal });
                doc.addEventListener('workspaceSwitchComplete', () => { scheduleWallpaperRefresh(false); scheduleContrast(); }, { signal: appScopeSignal });
            }
        }
        if (state.mode !== mode) {
            setMode(mode, { persist: false });
        } else {
            applyModeToDocument(mode);
            if (isCachedMode(mode)) scheduleWallpaperRefresh(false);
        }
    }

    const api = {
        MODES,
        DEFAULT_MODE,
        init,
        getMode,
        setMode,
        toggleBasic,
        cycleMode,
        syncModal,
        syncSurfaces,
        syncAllModals,
        refreshWallpaper: () => scheduleWallpaperRefresh(false),
        rebuildWallpaper: () => ensureFrosted({ force: true }),
        refreshBackdrops: () => scheduleBackdrops({ force: true }),
        refreshContrast: scheduleContrast,
        syncContrast,
        _test: {
            config,
            state,
            normalizeMode,
            parseCssUrl,
            parseWallpaperPosition,
            computeCoverGeometry,
            computeModalOrigin,
            readStoredMode,
            ensureFrosted,
            composeBackdrops,
            copyVar: (name) => copyVars.get(name) || '',
            computeRecipe,
            parseCssColor,
            splitCssLayers,
            gradientMeanColor,
            apcaContrast,
            pickBackdrop,
            resolveCssColor,
            surfaceBackdrop
        }
    };

    if (win) win.aeroGlass = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
    if (doc && root) init();
})();
