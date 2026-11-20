/**
 * Presentation mode (#958): Vista's presentation settings (PresentationSettings.exe, Windows Mobility Center's
 * Presentation Settings tile), 1:1. Turned on and off by hand only (Yukimi, Nov 19 2026): never because DeX, an
 * external display or a projector connects.
 *
 *   While presenting (Vista: "your computer stays awake, system notifications are turned off, and the following
 *   settings are applied"):
 *     awake          the app's own hold where there is one: AndroidDevice.setKeepScreenOn (DSApp claude/keep-screen-on:
 *                    FLAG_KEEP_SCREEN_ON on the asking window - phone, cover or DeX), DreamOSPower.keepAwake (DreamOS
 *                    claude/keep-awake: CaféReady stops the idle timeouts); otherwise the Screen Wake Lock while the
 *                    page is seen (taken again when it shows; the browser drops it on hide). Every window of the
 *                    device holds it while presenting (they follow each other through the storage event).
 *     screen saver   screenSaver.js does not start on idle (Turn off the screen saver)
 *     volume         tabVolume set to the chosen level, the earlier level put back at the end (Set the volume to)
 *     background     the chosen picture (or none) over the workspace's wallpaper, positioned Center / Tile /
 *                    Fit to screen; the workspace's comes back at the end (workspaceUtils.js
 *                    syncDesktopWallpaperInline asks wallpaper())
 *     notifications  desktop tray balloons wait (popoverManager.js asks holdsBalloons()) and show when it ends.
 *                    Android's Do Not Disturb, phone notifications, calls, alarms, the inbox and status indicators
 *                    are not touched.
 *     tray icon      #presentationTrayIcon (PresentationSettings.exe icon 1, "Presentation Settings are on"):
 *                    double-click opens Presentation Settings; right-click: Stop Presentation, Customize
 *                    Presentation Settings (the default), as on the VM.
 *   The state is this computer's (localStorage melaton-presentation), kept across reloads until it is turned off,
 *   with the settings it started with (Vista applies them as the presentation starts).
 *   Display configurations (Connected displays..., "I always give a presentation when I use this display
 *   configuration"): off by default. A configuration the user ticked (registry value displayConfigs, the rows the
 *   dialog lists: "Display 1 (W x H)", "Display 2") turns the presentation on when it is connected again (a change
 *   from the last configuration this computer saw, kept in melaton-presentation-display, so a reload is not a
 *   connection); a presentation turned on that way (state.auto) turns off when that configuration goes. Checked in
 *   the desktop shell at load, when the registry arrives and on the screen's change event; the phone's window ends
 *   an automatic presentation when no DeX display is left. The settings themselves
 *   are the user's: HKCU\Software\Xyridian\MobilePC\AdaptableSettings in Melaton's registry (melatonRegistry.js).
 *
 *   melatonPresentation.isOn() / start() / stop() / set(on)
 *   melatonPresentation.onChange(fn) -> unsubscribe        fn(on)
 *   melatonPresentation.settings() / saveSettings(patch)    { screenSaverOff, volumeOn, volume, wallpaperOn,
 *                                                            wallpaper ('' = None), position }
 *   melatonPresentation.screenSaverOff() / holdsBalloons() / wallpaper()   for screenSaver, popoverManager, workspaceUtils
 *   melatonPresentation.displayRows() / displayKey()      the current configuration (Connected displays...)
 *   melatonPresentation.alwaysFor(key) / setAlwaysFor(key, on)
 *   melatonPresentation.openSettings()   Presentation Settings (presentationSettings.js, in the control_panel feature)
 *   melatonPresentation.mobilePc()       Vista offers presentation settings on mobile PCs only (DreamOS, the
 *                                        Android app's desktop shell)
 */
(function (root) {
    'use strict';
    const doc = root.document;
    // page listeners end with this file's segment (app-scope, #872)
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    const KEY = 'melaton-presentation';
    const SEEN = 'melaton-presentation-display';
    const REG = 'HKCU\\Software\\Xyridian\\MobilePC\\AdaptableSettings';
    const POSITIONS = ['center', 'tile', 'fit'];
    const DEFAULTS = { screenSaverOff: true, volumeOn: false, volume: 50, wallpaperOn: false, wallpaper: '', position: 'fit' };

    const listeners = [];
    let state = read();
    let lock = null;        // the WakeLockSentinel
    let held = '';          // 'android' | 'dreamos' while the app's own keep-awake is asked for
    let live = null;        // AbortController of the listeners that run while presenting
    let icon = null;

    function read() {
        try {
            const s = JSON.parse(root.localStorage.getItem(KEY) || 'null');
            return s && s.on ? s : { on: false };
        } catch (_) { return { on: false }; }
    }

    function write() {
        try {
            if (state.on) root.localStorage.setItem(KEY, JSON.stringify(state));
            else root.localStorage.removeItem(KEY);
        } catch (_) { /* private mode */ }
    }

    const desktop = () => root.uiShell !== 'mobile';
    const mobilePc = () => !!(root.DreamOSHardware && typeof root.DreamOSHardware.get === 'function') || !!root.AndroidHardware;

    function settings() {
        const reg = root.melatonRegistry;
        const v = (name) => (reg ? reg.get(REG, name, DEFAULTS[name]) : DEFAULTS[name]);
        const vol = Number(v('volume'));
        const pos = String(v('position'));
        return {
            screenSaverOff: v('screenSaverOff') !== false,
            volumeOn: v('volumeOn') === true,
            volume: Number.isFinite(vol) ? Math.max(0, Math.min(100, Math.round(vol))) : DEFAULTS.volume,
            wallpaperOn: v('wallpaperOn') === true,
            wallpaper: typeof v('wallpaper') === 'string' ? v('wallpaper') : '',
            position: POSITIONS.includes(pos) ? pos : DEFAULTS.position
        };
    }

    function saveSettings(patch) {
        const reg = root.melatonRegistry;
        if (!reg || !patch) return Promise.resolve();
        return reg.set(REG, patch);
    }

    // ---- applying -------------------------------------------------------------------------------------------

    function syncWallpaper() {
        if (!doc || !doc.body || !desktop()) return;
        /* global syncDesktopWallpaperInline, activeWorkspace */
        if (typeof syncDesktopWallpaperInline === 'function') {
            try { syncDesktopWallpaperInline((typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default'); } catch (_) { /* workspaces not loaded yet: they sync on load */ }
        }
    }

    /** The app's own keep-awake: true when this page has one (then no Wake Lock is needed). */
    function nativeAwake(on) {
        try {
            const A = root.AndroidDevice;
            if (A && typeof A.setKeepScreenOn === 'function') {
                if (on || held === 'android') A.setKeepScreenOn(!!on);
                held = on ? 'android' : '';
                return true;
            }
            const D = root.DreamOSPower;
            if (D && typeof D.keepAwake === 'function') {
                if (on || held === 'dreamos') D.keepAwake(!!on);
                held = on ? 'dreamos' : '';
                return true;
            }
        } catch (_) { /* an app build without it: the Wake Lock below */ }
        return false;
    }

    async function takeLock() {
        if (!state.on || lock || !doc || doc.hidden) return;
        const wl = root.navigator && root.navigator.wakeLock;
        if (!wl || typeof wl.request !== 'function') return;
        try {
            const l = await wl.request('screen');
            if (!state.on) { l.release().catch(() => {}); return; }
            lock = l;
            l.addEventListener('release', () => { if (lock === l) lock = null; }, { once: true });
        } catch (_) { /* refused (not seen, battery saver): asked again when the page shows */ }
    }

    function dropLock() {
        const l = lock;
        lock = null;
        if (l) l.release().catch(() => {});
    }

    function ensureIcon() {
        if (icon && icon.isConnected) return icon;
        icon = doc ? doc.getElementById('presentationTrayIcon') : null;
        if (!icon) return null;
        icon.addEventListener('dblclick', () => openSettings());
        const cm = root.contextMenu;
        if (cm && typeof cm.attachToElement === 'function') {
            cm.attachToElement(icon, {
                sections: [{
                    type: 'list',
                    // whole labels, as Vista's menu is as wide as its longest item
                    className: 'context-menu-section-wrap',
                    initfn: (s) => {
                        // PresentationSettings.exe.mui 1003 / 1005
                        s.items = [{ text: 'Stop Presentation', action: 'stop' }, { text: 'Customize Presentation Settings', action: 'customize', className: 'context-menu-item-default' }];
                    }
                }],
                onAction: (action) => { if (action === 'stop') stop(); else openSettings(); }
            });
        }
        return icon;
    }

    function paintIcon() {
        if (!doc || !desktop()) return;
        const el = ensureIcon();
        if (!el) return;
        if (state.on) {
            if (el.classList.contains('hidden')) {
                // revealTrayIconElement: public/scripts/comp/trayIndicators.js
                if (typeof root.revealTrayIconElement === 'function') root.revealTrayIconElement(el); else el.classList.remove('hidden');
            }
        } else if (!el.classList.contains('hidden')) {
            el.classList.add('hidden');
        }
    }

    /** What runs while presenting: the wake lock taken again each time the page shows. */
    function goLive() {
        if (live || !doc) return;
        live = new AbortController();
        // FLAG_KEEP_SCREEN_ON / the host's hold need no help when the page hides and shows
        if (nativeAwake(true)) return;
        doc.addEventListener('visibilitychange', () => { if (!doc.hidden) void takeLock(); }, { signal: live.signal });
        void takeLock();
    }

    function endLive() {
        if (live) { live.abort(); live = null; }
        nativeAwake(false);
        dropLock();
    }

    function emit() {
        listeners.slice().forEach((fn) => { try { fn(state.on); } catch (err) { console.error('[presentation]', err); } });
    }

    // ---- on / off -------------------------------------------------------------------------------------------

    function start(auto) {
        const s = settings();
        const tv = root.tabVolume;
        const next = { on: true, since: Date.now(), applied: s, restore: {} };
        if (state.on) next.restore = state.restore || {};
        // turned on by a display configuration (it turns off when that goes); by hand it stays until turned off
        if (typeof auto === 'string' && auto) next.auto = auto;
        else if (state.on && state.auto && auto !== false) next.auto = state.auto;
        if (s.volumeOn && tv) {
            if (next.restore.volume === undefined) next.restore.volume = tv.getLevel();
            tv.setLevel(s.volume);
        } else if (!s.volumeOn && next.restore.volume !== undefined && tv) {
            // the volume box was cleared while presenting: the earlier level comes back now
            tv.setLevel(next.restore.volume);
            delete next.restore.volume;
        }
        const was = state.on;
        state = next;
        write();
        syncWallpaper();
        paintIcon();
        goLive();
        if (!was) emit();
    }

    function stop() {
        if (!state.on) return;
        const restore = state.restore || {};
        state = { on: false };
        write();
        const tv = root.tabVolume;
        if (restore.volume !== undefined && tv) tv.setLevel(restore.volume);
        syncWallpaper();
        paintIcon();
        endLive();
        emit();
        // the balloons held while presenting show now, one at a time
        const pm = root.PopoverManager;
        if (pm && typeof pm.trayReleased === 'function') pm.trayReleased();
    }

    function set(on) { if (on) start(false); else stop(); }

    // ---- other windows (the phone's and the DeX window's pages, other tabs) ---------------------------------------

    /** Another window turned it on or off: this one holds the screen, shows the icon and the background to match. */
    function followOther() {
        const next = read();
        if (!!next.on === !!state.on && (!next.on || next.since === state.since)) return;
        const was = !!state.on;
        state = next;
        syncWallpaper();
        paintIcon();
        if (state.on) goLive(); else endLive();
        if (was !== !!state.on) {
            emit();
            const pm = root.PopoverManager;
            if (!state.on && pm && typeof pm.trayReleased === 'function') pm.trayReleased();
        }
    }

    // ---- display configurations ------------------------------------------------------------------------------------

    /** The displays as Connected displays... lists them (PresentationSettings.exe dialog 101). */
    function displayRows() {
        const s = root.screen || {};
        const rows = [`Display 1 (${s.width || 0} x ${s.height || 0})`];
        if (s.isExtended) rows.push('Display 2');
        return rows;
    }

    const displayKey = () => displayRows().join('|');

    function alwaysList() {
        const reg = root.melatonRegistry;
        const v = reg ? reg.get(REG, 'displayConfigs', []) : [];
        return Array.isArray(v) ? v.map(String) : [];
    }

    const alwaysFor = (key) => alwaysList().includes(String(key || displayKey()));

    function setAlwaysFor(key, on) {
        const k = String(key || displayKey());
        const list = alwaysList().filter((x) => x !== k);
        if (on) list.push(k);
        // seen now: ticking it does not count as connecting it (Vista starts it the next time it is connected)
        try { root.localStorage.setItem(SEEN, displayKey()); } catch (_) { /* private mode */ }
        return saveSettings({ displayConfigs: list.length ? list : null });
    }

    /** A configuration connected or gone since the last look: on for a ticked one, off for the one that started it. */
    let regLoaded = false;
    function checkDisplays() {
        if (!desktop()) return;
        // the ticked configurations are the user's (the registry, from the server): not judged before they are here
        const reg = root.melatonRegistry;
        if (!regLoaded) regLoaded = !!(reg && reg._data && Object.keys(reg._data).length);
        if (!regLoaded) return;
        const key = displayKey();
        let seen = null;
        try { seen = root.localStorage.getItem(SEEN); } catch (_) { seen = key; }
        if (seen === key) return;
        try { root.localStorage.setItem(SEEN, key); } catch (_) { /* private mode */ }
        if (state.on && state.auto && state.auto !== key) stop();
        if (!state.on && alwaysFor(key)) start(key);
    }

    /** The phone's window: an automatic presentation ends when no DeX display is left (the DeX page is gone). */
    function checkPhone() {
        if (desktop() || !state.on || !state.auto || doc.hidden) return;
        try {
            const H = root.AndroidHome;
            const c = H && typeof H.getContinuity === 'function' ? JSON.parse(H.getContinuity()) : null;
            if (c && c.dexSeen === false) stop();
        } catch (_) { /* no continuity report: left as it is */ }
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return () => {};
        listeners.push(fn);
        return () => { const i = listeners.indexOf(fn); if (i >= 0) listeners.splice(i, 1); };
    }

    function applied() { return (state.on && state.applied) || null; }

    /** The presentation's background: { path ('' = no picture), position } while it shows one, else null. */
    function wallpaper() {
        const a = applied();
        if (!a || !a.wallpaperOn || !desktop()) return null;
        return { path: a.wallpaper || '', position: a.position };
    }

    /**
     * Paints the presentation's background (workspaceUtils.js asks before painting the workspace's): its picture or
     * none ('' = "(None)"), placed by body[data-wallpaper-fit] (desktop-shell.css). False when no presentation shows
     * one (the fit is cleared then, and the workspace's wallpaper paints).
     */
    function paintWallpaper() {
        const pw = wallpaper();
        const body = doc && doc.body;
        if (!body) return false;
        if (!pw) {
            if (body.hasAttribute('data-wallpaper-fit')) body.removeAttribute('data-wallpaper-fit');
            return false;
        }
        if (body.getAttribute('data-wallpaper-fit') !== pw.position) body.setAttribute('data-wallpaper-fit', pw.position);
        /* global applyDesktopWallpaperInline, clearDesktopWallpaperInline */
        if (pw.path && typeof applyDesktopWallpaperInline === 'function' && applyDesktopWallpaperInline(pw.path, pw.position === 'tile' ? 'left top' : 'center')) return true;
        if (typeof clearDesktopWallpaperInline === 'function') clearDesktopWallpaperInline();
        doc.documentElement.style.setProperty('--desktop-wallpaper', 'none');
        body.style.setProperty('--desktop-wallpaper', 'none');
        if (root.aeroGlass && typeof root.aeroGlass.refreshWallpaper === 'function') root.aeroGlass.refreshWallpaper();
        return true;
    }

    async function openSettings() {
        try { if (root.featureLoader) await root.featureLoader.loadFeature('control_panel'); } catch (_) { /* opened below if it loaded */ }
        if (typeof root.openPresentationSettings === 'function') root.openPresentationSettings();
    }

    root.melatonPresentation = {
        isOn: () => !!state.on,
        start,
        stop,
        set,
        onChange,
        settings,
        saveSettings,
        displayRows,
        displayKey,
        alwaysFor,
        setAlwaysFor,
        isAuto: () => !!(state.on && state.auto),
        mobilePc,
        openSettings,
        screenSaverOff: () => { const a = applied(); return !!(a && a.screenSaverOff); },
        holdsBalloons: () => !!state.on && desktop(),
        wallpaper,
        paintWallpaper,
        DEFAULTS,
        REG
    };

    // a presentation still on from before the reload: the icon, the screen held and the background again (the icon
    // and the background in the desktop shell only; every window keeps the screen on)
    if (state.on && doc) {
        const resume = () => { paintIcon(); goLive(); syncWallpaper(); };
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', resume, { once: true });
        else resume();
    }
    // the other windows of this computer (localStorage is shared): one event, never polled
    root.addEventListener('storage', (ev) => { if (ev.key === KEY || ev.key === null) followOther(); }, { signal: appScopeSignal });
    if (doc) {
        if (desktop()) {
            if (root.screen && typeof root.screen.addEventListener === 'function') root.screen.addEventListener('change', checkDisplays, { signal: appScopeSignal });
            if (root.melatonRegistry) {
                const off = root.melatonRegistry.onChange((key) => { if (!key) regLoaded = true; if (!key || key === REG) checkDisplays(); });
                if (appScopeSignal) appScopeSignal.addEventListener('abort', off, { once: true });
            }
            if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', checkDisplays, { once: true }); else checkDisplays();
        } else {
            doc.addEventListener('visibilitychange', checkPhone, { signal: appScopeSignal });
            checkPhone();
        }
    }
})(typeof window !== 'undefined' ? window : globalThis);
