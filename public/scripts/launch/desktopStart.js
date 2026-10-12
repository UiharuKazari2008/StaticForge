/**
 * Desktop start rule shared by /launch and the login page: the same decision app.html makes
 * for globalThis.isDesktop (viewport ≥ 1200 px and gallery window mode "windowed", where no
 * saved mode means windowed on wide screens). Read-only: app.html still owns writing the
 * default mode. Desktop starts boot through /launch (Melaton boot, Yozora #411 / #416);
 * narrow and phone starts go straight to /app.
 */
(function (root) {
    'use strict';

    function isDesktopStart(win) {
        const w = win || (typeof window !== 'undefined' ? window : null);
        if (!w) return false;
        const wide = (w.innerWidth || 0) >= 1200;
        let mode = null;
        try {
            mode = w.localStorage ? w.localStorage.getItem('galleryWindowMode') : null;
        } catch (_) { /* storage blocked: fall back to the width default */ }
        if (!mode) mode = wide ? 'windowed' : 'maximized';
        return wide && mode === 'windowed';
    }

    /** Where a signed-in start should go: /launch for the desktop, /app otherwise. */
    function appEntryPath(win) {
        return isDesktopStart(win) ? '/launch' : '/app';
    }

    const api = { isDesktopStart, appEntryPath };
    if (root) root.melatonDesktopStart = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : null);
