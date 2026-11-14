/**
 * Camera for Melaton Mobile (Yozora #788): Pictures & Videos' Camera (its soft key with nothing
 * selected and Menu > Camera, as on WM 6.1) starts the phone's own camera app (the Android app's
 * AndroidApps bridge, the program with the camera role), not a camera drawn in the page (Yukimi).
 * When Melaton Mobile comes back to the front, Pictures & Videos reads the storage cards again so
 * the new pictures and videos are there.
 *
 * window.wmCamera = { supported(), open() }
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const bridge = () => window.AndroidApps || null;
    let away = false;

    /** The phone's camera program ({ id, label }) or null. */
    function cameraApp() {
        const b = bridge();
        if (!b || typeof b.list !== 'function' || typeof b.launch !== 'function') return null;
        // wmAndroidApps.js also names the camera on phones without a default camera program
        if (typeof window.wmAndroidCameraApp === 'function') return window.wmAndroidCameraApp();
        try {
            const list = JSON.parse(b.list());
            return (Array.isArray(list) ? list : []).find((a) => a && a.role === 'camera') || null;
        } catch (_) { return null; }
    }

    function supported() { return !!cameraApp(); }

    function open() {
        const sh = window.wmShell;
        const a = cameraApp();
        let ok = false;
        // with WM's wait cursor through the start (#816, wmAndroidApps)
        const run = () => !!(a && bridge().launch(a.id) === true);
        try { ok = typeof window.wmAndroidStartWithCursorNow === 'function' ? window.wmAndroidStartWithCursorNow(run) : run(); } catch (_) { ok = false; }
        if (!ok) {
            if (sh) void sh.messageBox({ title: 'Camera', icon: 'warning', text: 'The camera could not be started.' });
            return false;
        }
        away = true;
        return true;
    }

    // back from the camera: the new pictures and videos
    document.addEventListener('visibilitychange', () => {
        if (!away || document.visibilityState !== 'visible') return;
        away = false;
        const g = window.wmPhoneGallery;
        if (g && g.available()) void g.refresh();
    });

    window.wmCamera = { supported, open };
})();
