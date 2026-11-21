/**
 * The DeX desktop's idle time (Yozora #1013, Yukimi Nov 21: "so i can shutdown the display if i forget about it as well
 * as its idle timeout"). The desktop on the DeX screen follows Power Options' "Put the computer to sleep" for the active
 * plan (plugged in): left alone that long it shuts down, as Shut Down does - its shutdown sequence, then the app's off
 * state (black, the page let go; a click, a key or Start on the phone's Continuity icon boots it again). Never (0) keeps
 * it on.
 *
 * Use counts: any key, click, touch or wheel in the desktop, the shortcut keys the app hands over while an Android window
 * has the focus ('androidhotkey'), the Android windows changing (opened, closed, focused: 'androidwindows'), and media
 * playing (a video or song in the desktop, or Android's media session the volume flyout knows) - the last is checked when
 * the time is up, so a film is never cut off. One timer is armed to the deadline and armed again from the last use; nothing
 * polls.
 *
 * Loaded in the desktop shell only (app.html <template data-shell="desktop">); does nothing outside the DeX window.
 */
(function () {
    'use strict';

    const root = window;
    const doc = document;
    const ad = root.AndroidDisplay;
    const home = root.AndroidHome;
    let external = false;
    try { external = !!(home && typeof home.isExternalDisplay === 'function' && home.isExternalDisplay()); } catch (_) { external = false; }
    if (!external || !ad || typeof ad.desktopOff !== 'function') return;

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    const POWER_KEY = 'HKLM\\SYSTEM\\CurrentControlSet\\Control\\Power\\User\\PowerSchemes';
    // Vista's plugged-in defaults (cplPages.js PLANS): Balanced and Power saver 60 minutes, High performance never
    const DEFAULT_SLEEP = { balanced: 60, saver: 60, high: 0 };

    let lastUse = Date.now();
    let timer = 0;
    let shuttingDown = false;

    /** "Put the computer to sleep" of the active plan, plugged in: minutes, 0 = never. */
    function sleepMinutes() {
        const reg = root.melatonRegistry;
        const get = (key, name, dflt) => {
            try { return reg && typeof reg.get === 'function' ? reg.get(key, name, dflt) : dflt; } catch (_) { return dflt; }
        };
        const plan = String(get(POWER_KEY, 'ActivePowerScheme', 'balanced') || 'balanced');
        const v = Number(get(`${POWER_KEY}\\${plan}`, 'sleep', DEFAULT_SLEEP[plan] != null ? DEFAULT_SLEEP[plan] : 60));
        return Number.isFinite(v) && v > 0 ? v : 0;
    }

    function desktopUp() {
        try { return typeof root.getClientDesktopState === 'function' && root.getClientDesktopState() === 'desktop'; } catch (_) { return false; }
    }

    /** Something plays: a video or song in the desktop, or an Android media session the volume flyout reads. */
    function playing() {
        for (const m of doc.querySelectorAll('video, audio')) {
            if (!m.paused && !m.ended && m.readyState > 2) return true;
        }
        try {
            const v = root.AndroidVolume;
            if (v && typeof v.isMusicActive === 'function' && v.isMusicActive()) return true;
        } catch (_) { /* older app */ }
        return false;
    }

    function arm() {
        clearTimeout(timer);
        timer = 0;
        const min = sleepMinutes();
        if (!min || shuttingDown) return;
        const due = lastUse + min * 60000 - Date.now();
        timer = setTimeout(check, Math.max(1000, due));
    }

    function check() {
        timer = 0;
        const min = sleepMinutes();
        if (!min || shuttingDown) return;
        if (Date.now() - lastUse < min * 60000) { arm(); return; }
        // playing, or the desktop not up (logon, booting, locked by its own lock): not idle now; asked again a while on
        if (playing() || !desktopUp()) { lastUse = Date.now(); arm(); return; }
        shuttingDown = true;
        console.log(`[dexPower] ${min} minutes without use: the desktop shuts down`);
        // the desktop's own Shut Down (its sequence, then the app's off state: winlogonPower commitWinlogonPower)
        const run = root.runWinlogonPower;
        Promise.resolve(typeof run === 'function' ? run('shutdown') : false)
            .then((ok) => { if (ok === false) { shuttingDown = false; lastUse = Date.now(); arm(); } })
            .catch(() => { try { ad.desktopOff(); } catch (_) { /* gone */ } });
    }

    // a use: the time starts again (no timer work per event - the armed one looks at lastUse when it fires)
    const used = () => { lastUse = Date.now(); if (!timer) arm(); };
    const opts = { capture: true, passive: true, signal: appScopeSignal };
    ['keydown', 'pointerdown', 'wheel', 'touchstart'].forEach((t) => doc.addEventListener(t, used, opts));
    root.addEventListener('androidhotkey', used, { signal: appScopeSignal });
    root.addEventListener('androidwindows', used, { signal: appScopeSignal });
    // Power Options changed (plan or minutes): armed again for the new time
    root.addEventListener('melaton-power-plan', () => arm(), { signal: appScopeSignal });

    arm();
})();
