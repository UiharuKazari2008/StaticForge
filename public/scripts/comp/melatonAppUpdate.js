/**
 * Melaton app update in the page (#821): the Dreamscape Android app stages a new APK by itself (apps.update) and
 * tells the page through window.MelatonAppUpdate (state(), restartNow()) and the 'melatonappupdate' event.
 * The page only shows it through the normal update path: the phone shell's notification "Updates" (wmShell.appNote with
 * update: true, filed under the existing update icon, no new status icon) with Restart Now / Later soft keys; refusals
 * answer in a message box. Restart Now
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
    let note = null;        // the update notification (wmShell.appNote)
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

    // the phone shell's own notification (wmShell.appNote, filed under the update icon like the client's Updates note)
    // and message box (an answer to the tap on Restart Now) - never a page toast (ui-standard)
    function shell() { return root.wmShell || null; }

    function offer() {
        const s = staged();
        const sh = shell();
        if (!s || !sh || typeof sh.appNote !== 'function') return;
        const html = `${label(s)} is ready to install. Melaton restarts to install it.`;
        const softKeys = { left: { label: 'Restart Now', action: () => { if (note) note.hide(); restart(); } }, right: { label: 'Later', action: () => { if (note) note.hide(); } } };
        if (note) { note.update({ title: 'Updates', html, softKeys }); return; }
        note = sh.appNote({ title: 'Updates', html, icon: 'status-update', event: 'update', silent: true, update: true, softKeys });
    }

    function say(title, text) {
        const sh = shell();
        if (sh && typeof sh.messageBox === 'function') void sh.messageBox({ title, text, icon: 'warning' });
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
            // no install began (the app took its own mark back and opened Android's page): Restart Now may ask again
            attempted = null;
            say('Update waiting', `${label(s)} needs permission to install. Allow installs from Dreamscape in Android settings, then choose Restart Now again.`);
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
