/**
 * The Samsung DeX wallpaper as the Vista desktop's background on the DeX screen (Yozora #1013, Yukimi Nov 21: "just like
 * the today screen the dex wallpaper should be able to be the desktop with the same logic as the home uses to monitor
 * for updates", the choice "local to that system").
 *
 * The Dreamscape app reads Samsung DeX's own wallpaper slot and serves it as a file (DSApp AndroidWallpaper, screen
 * "dex": AndroidHome.wallpaperInfo() in the DeX window gives { url, id, live }, the URL carrying the picture's id and
 * change count). Like Today's Android Wallpaper (wmShell.js todayWallSource 'android'):
 *   - the app's 'androidwallpaper' event (a new DeX wallpaper) paints the new picture;
 *   - coming back on screen or into focus asks for the id again (an event missed while the page was frozen);
 *   - a live wallpaper or an empty slot has no picture: the workspace's wallpaper shows instead.
 *
 * The choice is this device's only (localStorage melatonDexWallpaper = '1'), never the workspace's: Personalization >
 * Desktop Background's "Use the Samsung DeX wallpaper on this display" (cplDesktopBackground.js). While it is on, the
 * desktop's painter (workspaceUtils.js syncDesktopWallpaperInline / the workspace settings' apply) hands the background
 * to paint() here, as it does for a presentation's (melatonPresentation.js).
 *
 * Loaded in the desktop shell only (app.html <template data-shell="desktop">); does nothing outside the DeX window.
 */
(function () {
    'use strict';

    const KEY = 'melatonDexWallpaper';
    const appScopeSignal = (window.melatonSegments && typeof window.melatonSegments.callerSignal === 'function' && window.melatonSegments.callerSignal()) || undefined;
    // the picture that failed to load (a live wallpaper's empty slot, a read error): the workspace's shows until it changes
    let failedUrl = '';
    let paintedUrl = '';

    function bridge() {
        const h = window.AndroidHome;
        return h && typeof h.wallpaperInfo === 'function' && typeof h.isExternalDisplay === 'function' ? h : null;
    }

    /** The DeX window of the Dreamscape app (the only place the DeX wallpaper can be read). */
    function available() {
        const h = bridge();
        try { return !!(h && h.isExternalDisplay()); } catch (_) { return false; }
    }

    function enabled() {
        try { return localStorage.getItem(KEY) === '1'; } catch (_) { return false; }
    }

    /** The DeX wallpaper's address now ('' for a live wallpaper or none). One bridge call, no file read. */
    function currentUrl() {
        const h = bridge();
        if (!h) return '';
        try {
            const i = JSON.parse(h.wallpaperInfo() || 'null');
            return i && i.url && !i.live ? String(i.url) : '';
        } catch (_) { return ''; }
    }

    function repaintDesktop() {
        /* global syncDesktopWallpaperInline, activeWorkspace */
        if (typeof syncDesktopWallpaperInline === 'function') {
            syncDesktopWallpaperInline(typeof activeWorkspace !== 'undefined' ? activeWorkspace : undefined);
        }
    }

    /**
     * The desktop painter's hook: true when the DeX wallpaper is this display's background (painted here, the workspace's
     * left alone). The picture is decoded before it replaces the one on screen (applyDesktopWallpaperInline's own rule);
     * one that will not load gives the background back to the workspace.
     */
    function paint() {
        if (!enabled() || !available()) return false;
        const url = currentUrl();
        if (!url || url === failedUrl) return false;
        /* global applyDesktopWallpaperInline */
        if (typeof applyDesktopWallpaperInline !== 'function') return false;
        if (url !== paintedUrl) {
            const probe = new Image();
            probe.decoding = 'async';
            probe.onerror = () => {
                if (paintedUrl === url) paintedUrl = '';
                failedUrl = url;
                repaintDesktop();
            };
            probe.src = url;
        }
        paintedUrl = url;
        // the DeX picture is cut for this screen already: centred
        return applyDesktopWallpaperInline(`url:${url}`, 'center center');
    }

    /** Personalization's check box: this device only. */
    function setEnabled(on) {
        try {
            if (on) localStorage.setItem(KEY, '1'); else localStorage.removeItem(KEY);
        } catch (_) { /* storage off: the choice lasts this visit */ }
        failedUrl = '';
        paintedUrl = '';
        repaintDesktop();
    }

    window.melatonDexWallpaper = { available, enabled, setEnabled, paint, currentUrl };

    if (!available()) return;

    // a new DeX wallpaper (the app's event; its URL carries the new id)
    window.addEventListener('androidwallpaper', () => {
        if (!enabled()) return;
        failedUrl = '';
        repaintDesktop();
    }, { signal: appScopeSignal });

    // a change while the page was frozen or out of sight: the id asked for again on the way back
    const recheck = () => {
        if (document.visibilityState !== 'visible' || !enabled()) return;
        const now = currentUrl();
        if (now !== paintedUrl && now !== failedUrl) repaintDesktop();
    };
    document.addEventListener('visibilitychange', recheck, { signal: appScopeSignal });
    window.addEventListener('focus', recheck, { signal: appScopeSignal });

    // on at start: painted as soon as the desktop's painter is there (it may have painted the workspace's already)
    if (enabled()) repaintDesktop();
})();
