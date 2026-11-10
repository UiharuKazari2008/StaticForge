// Android app: retire an orphaned Dreamscape page (#735).
//
// When Android recreates the app's activity (DeX, folding, display moves), older builds of the app
// (DSApp-Kotlin before its onDestroy fix) keep the old WebView alive and hidden. That page runs the whole
// workspace for hours: its own socket, timers, Director, ~280 MB of decoded pictures, in the same renderer
// as the page on screen. Each page in the app says when it is on screen; a page that has been hidden for a
// minute and hears a newer one on screen goes to /dormant.html (nothing running; it reopens /app if it is
// ever shown again). Only inside the Android app, where one window is all there is.
(function () {
    'use strict';
    if (typeof window === 'undefined' || typeof BroadcastChannel !== 'function') return;
    const inApp = !!(window.AndroidNotification || window.AndroidCaption || window.AndroidDeviceStatus)
        || /;\s*wv\)/.test(navigator.userAgent || '');
    if (!inApp) return;

    const HIDDEN_FOR_MS = 60 * 1000;
    const ANNOUNCE_EVERY_MS = 60 * 1000;
    const born = Date.now();
    const id = `${born.toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
    let hiddenSince = document.hidden ? born : 0;
    let retired = false;
    let channel;
    try {
        channel = new BroadcastChannel('dreamscape-android-page');
    } catch (_) {
        return;
    }

    function announce() {
        if (retired || document.hidden) return;
        try { channel.postMessage({ type: 'on-screen', id, born }); } catch (_) { /* channel closed */ }
    }

    function retire() {
        if (retired) return;
        retired = true;
        try { channel.close(); } catch (_) { /* already closed */ }
        // exitConfirmation.js would otherwise ask "leave?" in a page nobody can see
        window.bypassConfirmation = true;
        location.replace('/dormant.html');
    }

    channel.onmessage = (event) => {
        const msg = event && event.data;
        if (retired || !msg || msg.type !== 'on-screen' || msg.id === id) return;
        // Only a newer page retires an older hidden one, and only after this one has been out of sight
        // for a while (not a quick app switch).
        if (!document.hidden || !(Number(msg.born) > born)) return;
        if (!hiddenSince || Date.now() - hiddenSince < HIDDEN_FOR_MS) return;
        retire();
    };

    document.addEventListener('visibilitychange', () => {
        hiddenSince = document.hidden ? Date.now() : 0;
        announce();
    });
    setInterval(announce, ANNOUNCE_EVERY_MS);
    announce();
})();
