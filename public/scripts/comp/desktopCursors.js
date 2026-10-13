/**
 * Pointer scheme. Classic = native CSS keywords. Vista / Posy = url() tokens
 * from /cursors/{scheme}/ (media/cursors, not in git). Default Vista.
 * Personalize / Control Panel → Cursors writes localStorage `desktop-cursors`.
 *
 * Tokens live on html as --c-pointer and friends (public/css/desktop-cursors.css).
 * Test: scripts/test-desktop-cursors.js.
 */
(function () {
    'use strict';

    const STORAGE_KEY = 'desktop-cursors';
    const SCHEMES = {
        vista: true,
        classic: true,
        posy: true
    };
    const DEFAULT_SCHEME = 'vista';

    const doc = typeof document !== 'undefined' ? document : null;
    const win = typeof window !== 'undefined' ? window : null;

    const state = {
        scheme: DEFAULT_SCHEME,
        bound: false
    };

    function normalizeScheme(value) {
        const key = String(value || '').trim().toLowerCase();
        return SCHEMES[key] ? key : null;
    }

    function readScheme() {
        try {
            const stored = win && win.localStorage ? win.localStorage.getItem(STORAGE_KEY) : null;
            return normalizeScheme(stored) || DEFAULT_SCHEME;
        } catch (_err) {
            return DEFAULT_SCHEME;
        }
    }

    function writeScheme(scheme) {
        const next = normalizeScheme(scheme) || DEFAULT_SCHEME;
        try {
            if (win && win.localStorage) {
                win.localStorage.setItem(STORAGE_KEY, next);
            }
        } catch (_err) {
            /* */
        }
        return next;
    }

    function applyScheme(scheme) {
        const next = normalizeScheme(scheme) || DEFAULT_SCHEME;
        state.scheme = next;
        if (!doc || !doc.documentElement) return next;
        if (next === 'classic') {
            doc.documentElement.removeAttribute('data-cursor-scheme');
        } else {
            doc.documentElement.setAttribute('data-cursor-scheme', next);
        }
        return next;
    }

    function setScheme(scheme) {
        const next = writeScheme(scheme);
        applyScheme(next);
        if (doc) {
            doc.dispatchEvent(new CustomEvent('desktopCursorSchemeChanged', { detail: { scheme: next } }));
        }
        return next;
    }

    function getScheme() {
        return state.scheme;
    }

    function value(keyword) {
        const key = String(keyword || '').trim();
        if (!doc || !doc.documentElement) return key;
        const token = getComputedStyle(doc.documentElement).getPropertyValue(`--c-${key}`).trim();
        return token || key;
    }

    function bind() {
        if (state.bound) return;
        state.bound = true;
        applyScheme(readScheme());
    }

    const api = {
        STORAGE_KEY,
        SCHEMES,
        DEFAULT_SCHEME,
        normalizeScheme,
        readScheme,
        writeScheme,
        applyScheme,
        setScheme,
        getScheme,
        value,
        bind,
        _test: { state }
    };

    if (win) {
        win.desktopCursors = api;
        if (doc) {
            if (doc.readyState === 'loading') {
                doc.addEventListener('DOMContentLoaded', bind);
            } else {
                bind();
            }
        }
    }

    if (typeof module !== 'undefined' && module.exports) {
        module.exports = api;
    }
})();
