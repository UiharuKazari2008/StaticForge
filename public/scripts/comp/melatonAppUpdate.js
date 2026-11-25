/**
 * Melaton app update in the page (#821): the Dreamscape Android app stages a new APK by itself (apps.update) and
 * tells the page through window.MelatonAppUpdate (state(), restartNow()) and the 'melatonappupdate' event.
 * The page only shows it through the normal update path: a toast titled "Update Available" (wmShell UPDATE_TOAST files
 * it under the phone's existing update icon, no new status icon) with Restart Now / Later, and Restart Now
 * (serviceWorkerManager.restartPhoneNow, also the client update's) installs the app first - the app restarts the page,
 * so it covers a pending client asset update too.
 *
 * Zero-wait: nothing here is awaited by boot; state() is a local call read once when the script runs in idle time and
 * again on the event, never polled. Without the bridge (desktop browsers, old app builds) the script does nothing.
 *
 *   window.melatonAppUpdate = { staged(), offer(), restart() }
 */
(function (root) {
    'use strict';

    const bridge = () => root.MelatonAppUpdate || null;
    let state = null;       // the last state object read
    let toastId = null;
    let attempted = 0;      // versionCode restartNow was called for from this page
    let lastAnswer = null;

    function read() {
        const b = bridge();
        if (!b || typeof b.state !== 'function') return null;
        try {
            const s = JSON.parse(b.state());
            return s && typeof s === 'object' ? s : null;
        } catch (_) { return null; }
    }

    function staged() { return state && state.staged ? state.staged : null; }
    function label(s) { return `Melaton ${s.versionName || s.versionCode}`; }
    const ICON = '<i class="fas fa-arrows-rotate"></i>';

    function offer() {
        const s = staged();
        if (!s || typeof root.showGlassToast !== 'function') return;
        if (toastId && typeof root.removeGlassToast === 'function') root.removeGlassToast(toastId);
        toastId = root.showGlassToast('warning', 'Update Available', `${label(s)} is ready to install`, false, false, ICON, [
            { text: 'Restart Now', type: 'primary', onClick: () => { restart(); }, closeOnClick: true },
            { text: 'Later', type: 'secondary', closeOnClick: true }
        ]);
    }

    function say(title, message) {
        if (typeof root.showGlassToast === 'function') root.showGlassToast('warning', title, message, false, 8000, ICON);
    }

    /**
     * Ask the app to install the staged APK, once per staged version. Returns the answer's state, or null when nothing
     * is staged or this page already asked for this version (it never asks twice).
     */
    function restart() {
        const s = staged();
        const b = bridge();
        if (!s || !b || typeof b.restartNow !== 'function') return null;
        if (attempted === s.versionCode) return null;
        attempted = s.versionCode;
        let r = null;
        try { r = JSON.parse(b.restartNow()); } catch (_) { r = null; }
        const st = r && r.state ? r.state : 'unknown';
        lastAnswer = st;
        if (st === 'needs_permission') {
            say('Update waiting', `${label(s)} needs permission to install. Allow installs from Dreamscape in Android settings.`);
        } else if (st === 'already_attempted') {
            say('Update waiting', `${label(s)} was already handed to Android to install.`);
        } else if (st === 'nothing_staged') {
            state = Object.assign({}, state, { staged: null });
        }
        return st;
    }

    // the restart of the phone (Restart Now of a client update too): an app update goes first and covers both
    function hook() {
        const sw = root.serviceWorkerManager;
        if (!sw || typeof sw.restartPhoneNow !== 'function' || sw._appUpdateHooked) return;
        sw._appUpdateHooked = true;
        const orig = sw.restartPhoneNow.bind(sw);
        sw.restartPhoneNow = function (opts) {
            if (staged() && attempted !== staged().versionCode) {
                const st = restart();
                // installing / prompted / notified: the app takes over; refused: the client update goes on as before
                if (st === 'installing' || st === 'prompted' || st === 'notified') return true;
            }
            return orig(opts);
        };
    }

    function onState(next) {
        if (!next || typeof next !== 'object') return;
        state = next;
        if (staged()) { hook(); offer(); }
    }

    function init() {
        if (!bridge()) return;
        hook();
        onState(read());
    }

    // the page-lifetime owner of the listener (a signal, so it can be cut)
    const life = new AbortController();
    root.melatonAppUpdate = { staged, offer, restart, lastAnswer: () => lastAnswer, stop: () => life.abort() };
    root.addEventListener('melatonappupdate', (e) => {
        if (!bridge()) return;
        onState(e && e.detail && typeof e.detail === 'object' && 'staged' in e.detail ? e.detail : read());
    }, { signal: life.signal });
    // read once, in idle time: boot never waits for it
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(init, { timeout: 4000 });
    else setTimeout(init, 1500);
})(typeof window !== 'undefined' ? window : globalThis);
