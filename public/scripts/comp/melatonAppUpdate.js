/**
 * Melaton app update in the page (#821): the Dreamscape Android app stages a new APK by itself (apps.update) and
 * tells the page through window.MelatonAppUpdate (state(), restartNow()) and the 'melatonappupdate' event.
 * The page only shows it through the normal update path: the phone shell's notification "Updates" (wmShell.appNote with
 * update: true, filed under the existing update icon, no new status icon) with Restart Now / Later soft keys; refusals
 * answer in a message box. Restart Now
 * (serviceWorkerManager.restartPhoneNow, also the client update's) installs the app first - the app restarts the page,
 * so it covers a pending client asset update too.
 *
 * Never Android's installer (Yukimi, Nov 26 2026, #1309: "Shizuku is running, why am I being asked to install the app through the
 * Android installer"). A build of the app that reports installer "silent" (state()) never opens it and waits by itself for Shizuku or
 * ADB 5555 when no silent route is up, so Restart Now is always passed to it; the note then says it waits and why. An OLDER build
 * still has the installer as its fallback: the page passes Restart Now to it only when it can see a silent route up (the build is
 * 3631719 or newer, which streams the file to pm, and Shizuku is allowed or local ADB 5555 answers with this app's key), and
 * otherwise shows the update as waiting, with no prompt, and asks again when the state changes (events only: the ADB check, the
 * link's state, the page coming back, the network; never a timer).
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
    let wanted = 0;         // versionCode Restart Now was chosen for while an older build had no silent route: asked again once one is up
    let lastAnswer = null;
    let gateWas = null;     // whether the last note was drawn with a silent route in sight (an event only redraws it when that changed)
    // the first build that streams the file into pm through Shizuku's shell (DSApp #1302); older ones cannot install silently at all
    const FIRST_SILENT_BUILD = 3631719;

    function read() {
        const b = bridge();
        if (!b || typeof b.state !== 'function') return null;
        try {
            const s = JSON.parse(b.state());
            return s && typeof s === 'object' ? s : null;
        } catch (_) { return null; }
    }

    function staged() { return state && state.staged ? state.staged : null; }

    /** The app's own state of the wait: { why } while its staged update waits for Shizuku / 5555 (a build with installer "silent"), else null. */
    function waiting() {
        const s = staged();
        const w = state && state.waiting;
        return s && w && Number(w.versionCode) === Number(s.versionCode) ? w : null;
    }

    /** The phone's ADB facts the app already shows (AndroidActiveSync.adbStatus, a quick local call): null when unreadable. */
    function adbStatus() {
        const a = root.AndroidActiveSync;
        if (!a || typeof a.adbStatus !== 'function') return null;
        try { const j = JSON.parse(a.adbStatus()); return j && typeof j === 'object' ? j : null; } catch (_) { return null; }
    }

    /**
     * May Restart Now be passed to the app? { ok, why }. A build that says installer "silent" always may (it waits and retries by
     * itself). An older build (it still falls back to Android's installer) only with a silent route in sight.
     */
    function gate() {
        if (state && state.installer === 'silent') return { ok: true, why: '' };
        const have = state && state.installed ? Number(state.installed.versionCode) || 0 : 0;
        // an old build never installs it by itself (Shizuku up or not): say that, not "waiting for Shizuku" (#1309, Yukimi's Fold, Nov 26)
        if (have < FIRST_SILENT_BUILD) return { ok: false, old: true, why: '' };
        const a = adbStatus();
        if (!a) return { ok: false, why: 'Shizuku and ADB could not be read' };
        const set = a.settings && typeof a.settings === 'object' ? a.settings : {};
        const feat = set.features && typeof set.features === 'object' ? set.features : {};
        const adbOk = a.listening === true && a.authorized === true && set.allow !== false && feat.install !== false;
        if (a.shizuku === true || adbOk) return { ok: true, why: '' };
        return { ok: false, why: 'Shizuku is not running and ADB 5555 is not answering' };
    }
    function label(s) { return `Melaton ${s.versionName || s.versionCode}`; }

    // the phone shell's own notification (wmShell.appNote, filed under the update icon like the client's Updates note)
    // and message box (an answer to the tap on Restart Now) - never a page toast (ui-standard)
    function shell() { return root.wmShell || null; }

    function offer() {
        const s = staged();
        const sh = shell();
        if (!s || !sh || typeof sh.appNote !== 'function') return;
        const w = waiting();
        const g = gate();
        gateWas = g.ok;
        // every Updates note has something to do (Yukimi, Nov 26 2026: a note she cannot act on is a direct violation of
        // "no call to action"): a build that waits for its silent route installs by itself and shows nothing; an older build
        // that cannot install silently offers Install (Android's installer, started by her); otherwise Restart Now
        if (w || (!g.ok && !g.old)) { if (note) { note.hide(); note = null; } return; }
        let html = `${label(s)} is ready to install. Melaton restarts to install it.`;
        let left = { label: 'Restart Now', action: () => { if (note) note.hide(); restart(); } };
        if (!g.ok) {
            html = `${label(s)} is ready. This version of Melaton installs it with Android's installer: tap Install. Updates after it install by themselves.`;
            left = { label: 'Install', action: () => { if (note) note.hide(); installManual(); } };
        }
        const softKeys = { left, right: { label: 'Later', action: () => { if (note) note.hide(); } } };
        if (note) { note.update({ title: 'Updates', html, softKeys }); return; }
        note = sh.appNote({ title: 'Updates', html, icon: 'status-update', event: 'update', silent: true, update: true, softKeys });
    }

    function say(title, text) {
        const sh = shell();
        if (sh && typeof sh.messageBox === 'function') void sh.messageBox({ title, text, icon: 'warning' });
    }

    /** Install, tapped by her on an older build: the app installs the staged APK its own way (Android's installer). */
    function installManual() {
        const s = staged();
        const b = bridge();
        if (!s || !b || typeof b.restartNow !== 'function') return null;
        attempted = s.versionCode;
        wanted = 0;
        let r = null;
        try { r = JSON.parse(b.restartNow()); } catch (_) { r = null; }
        lastAnswer = r && r.state ? r.state : 'unknown';
        return lastAnswer;
    }

    /**
     * Ask the app to install the staged APK, once per staged version. Returns the answer's state, or null when nothing
     * is staged or this page already asked for this version (it never asks twice). 'waiting': no silent route is up, nothing
     * was started, nothing is shown but the note; the install follows by itself (the app's own retry, or this page asking again
     * when an older build's state changes, see [recheck]).
     */
    function restart() {
        const s = staged();
        const b = bridge();
        if (!s || !b || typeof b.restartNow !== 'function') return null;
        if (attempted === s.versionCode) return null;
        const g = gate();
        if (!g.ok) {
            // an older build: its fallback is Android's installer, so it is not asked; asked again once a route is up
            wanted = s.versionCode;
            lastAnswer = 'waiting';
            offer();
            return 'waiting';
        }
        attempted = s.versionCode;
        wanted = 0;
        let r = null;
        try { r = JSON.parse(b.restartNow()); } catch (_) { r = null; }
        const st = r && r.state ? r.state : 'unknown';
        lastAnswer = st;
        if (st === 'waiting' || st === 'needs_permission') {
            // the app keeps the update and installs it by itself; its state (waiting, why) arrives as melatonappupdate
            if (r && r.why) state = Object.assign({}, state, { waiting: { versionCode: s.versionCode, why: r.why } });
            offer();
        } else if (st === 'already_attempted') {
            say('Update', `${label(s)} was already started. It finishes by itself.`);
        } else if (st === 'nothing_staged') {
            state = Object.assign({}, state, { staged: null });
        }
        return st;
    }

    /**
     * The state of the phone's silent routes may have changed (an event, never a timer): an older build's update that was
     * chosen while none was up is asked now that one is; the note follows the state either way.
     */
    function recheck() {
        const s = staged();
        if (!s || !bridge()) return;
        if (wanted === s.versionCode && gate().ok) { restart(); return; }
        if (!(state && state.installer === 'silent') && gate().ok !== gateWas) offer();
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
                // installing: the app takes over; waiting / refused: the client update goes on as before
                if (st === 'installing') return true;
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
    root.melatonAppUpdate = { staged, offer, restart, recheck, gate, lastAnswer: () => lastAnswer, stop: () => life.abort() };
    root.addEventListener('melatonappupdate', (e) => {
        if (!bridge()) return;
        onState(e && e.detail && typeof e.detail === 'object' && 'staged' in e.detail ? e.detail : read());
    }, { signal: life.signal });
    // an older build's silent routes changed (the ADB check's answer, the link's state, the page back in view, the network): look again
    ['androidadb', 'androidasstate'].forEach((n) => root.addEventListener(n, () => recheck(), { signal: life.signal }));
    root.addEventListener('online', () => recheck(), { signal: life.signal });
    if (root.document && typeof root.document.addEventListener === 'function') root.document.addEventListener('visibilitychange', () => { if (!root.document.hidden) recheck(); }, { signal: life.signal });
    // read once, in idle time: boot never waits for it
    if (typeof root.requestIdleCallback === 'function') root.requestIdleCallback(init, { timeout: 4000 });
    else setTimeout(init, 1500);
})(typeof window !== 'undefined' ? window : globalThis);
