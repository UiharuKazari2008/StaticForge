/**
 * Vista's Windows-key and system hotkeys on the desktop (Yukimi 2026-10-22). The installed app
 * (the desktop PWA) hands every key to the page, the Windows key and Alt+F4 included, so the
 * desktop answers them the way Vista does:
 *
 *   Win (pressed and released alone), Ctrl+Esc
 *                   open or close the Start menu
 *   Win+D           Show desktop; again brings the same windows back (taskbarSettings.js)
 *   Win+M           minimise all windows       Win+Shift+M   bring them back
 *   Win+E           Computer (Cartograph)      Win+R         Run
 *   Win+F           Start Search               Win+L         Lock computer (workstationLock.js)
 *   Win+F1          Help and Support           Win+Pause     System (Control Panel)
 *   Win+Space       Melaton Sidebar            Win+1 … Win+9 the Quick Launch button at that place
 *   Win+X           Melaton Mobility Center (mobilityCenter.js, in the Control Panel feature)
 *   Alt+F4          close the window in front; with none, Vista's Shut Down Windows dialog ("Shut Down Melaton":
 *                   Teleport where Vista has Switch User, Log off, Restart, Sleep where the computer can, Shut Down)
 *   Ctrl+Shift+Esc  Melaton Task Manager (apps/taskmgr)
 *
 * Win+Tab and Alt+Tab (switch windows while held) live with Ctrl+Tab in keyboardShortcuts.js.
 *
 * DreamOS (#910, Yukimi Nov 20 2026): the Mac's Mission Control (Exposé) and Launchpad keys and the media keys reach
 * the page from the host whatever has the focus (CaféReady keys.rs, the shell bridge's 'dreamoshotkey' event), as the
 * action Keyboard Properties > Function Keys gives them: flip3d (Flip 3D, open until a pick; the key again picks the
 * front window), start, allprograms (the Start menu on All Programs: Melaton's nearest to Launchpad; the key again
 * closes it), desktop (Show desktop), playpause / next / previous / stop (what plays on the desktop: Media Player
 * through its own transport, else the page's last playing audio or video; with nothing playing nothing happens, as
 * on Vista).
 *
 * Like Vista, the Windows key opens Start on its release, and only when nothing else was pressed
 * or clicked while it was down (Win+D does not flash the Start menu). On a Mac the Meta key is
 * Cmd, so the Windows-key actions stay off there. Nothing here runs before the desktop is up,
 * and while the computer is locked workstationLock.js (priority 100) has every key first.
 */
(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : globalThis;
    const doc = root.document;

    const IS_MAC = /Mac|iPhone|iPad/.test((root.navigator && root.navigator.platform) || '');
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined; // page listeners end with this file's segment (app-scope, #872/#890)

    // the Windows key's press: Start opens on release unless it was used for a combo
    const win = { down: false, used: false };
    // Win+M's windows, for Win+Shift+M (and the DeX desktop's Android windows it minimised, #1013)
    let minimizedAll = null;
    let minimizedAndroid = null;

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    /** The desktop is up and usable (not logon, Setup, booting or locked). */
    function desktopUsable() {
        if (!root.isDesktop || !doc || !doc.body || !doc.body.classList.contains('desktop-mode')) return false;
        // getClientDesktopState: public/scripts/comp/agentClientBridge.js
        if (typeof root.getClientDesktopState === 'function') return root.getClientDesktopState() === 'desktop';
        return true;
    }

    /** The app owns the window's keys (installed app), not a browser tab whose browser keeps Alt+F4. */
    function standaloneApp() {
        if (typeof root.matchMedia !== 'function') return false;
        return root.matchMedia('(display-mode: standalone), (display-mode: window-controls-overlay), (display-mode: fullscreen)').matches;
    }

    /** Ctrl/Alt/Win+Tab is switching windows (keyboardShortcuts.js); Ctrl+Esc then is not Start. */
    function windowSwitcherOpen() {
        // flip3d.js: Win+Tab's Flip 3D
        if (root.flip3d && root.flip3d.isOpen()) return true;
        return typeof windowSwitcherActive !== 'undefined' && windowSwitcherActive === true;
    }

    function openWindows() {
        return Array.from(doc.querySelectorAll('.modal:not(.hidden):not(.hidden-alt)'))
            .filter((m) => m.querySelector(':scope > .modal-window-title') && !m.classList.contains('closing'));
    }

    // ---- actions -------------------------------------------------------------------------------

    function toggleStart() {
        // toggleStartMenu: public/scripts/comp/modalUtils.js
        callGlobal('toggleStartMenu');
    }

    function startSearch() {
        // openStartMenu focuses Start Search (modalUtils.js)
        callGlobal('openStartMenu');
        const search = doc.getElementById('startMenuSearchInput');
        if (search) search.focus({ preventScroll: true });
    }

    function minimizeAll() {
        const visible = openWindows().filter((m) => !m.classList.contains('minimised'));
        const android = root.melatonAndroidTaskbar;
        if (android && typeof android.shownCount === 'function' && android.shownCount()) minimizedAndroid = android.minimizeShown();
        if (!visible.length) return;
        minimizedAll = visible;
        // minimizeModalProgrammatically: public/scripts/comp/modalUtils.js
        visible.forEach((m) => callGlobal('minimizeModalProgrammatically', m));
    }

    function undoMinimizeAll() {
        const android = root.melatonAndroidTaskbar;
        if (android && minimizedAndroid) android.restore(minimizedAndroid);
        minimizedAndroid = null;
        const back = (minimizedAll || []).filter((m) => m.isConnected && m.classList.contains('minimised'));
        minimizedAll = null;
        back.forEach((m) => {
            // restoreMinimizedModal / getOrCreateTaskbarItem: public/scripts/comp/modalUtils.js
            callGlobal('restoreMinimizedModal', m, callGlobal('getOrCreateTaskbarItem', m) || null);
        });
    }

    function openRun() {
        // runApplet: public/scripts/comp/runApplet.js (the 'run' feature)
        void root.featureLoader.loadFeature('run').then(() => {
            if (typeof runApplet !== 'undefined') runApplet.open();
        });
    }

    function openHelp() {
        // getStartMenuPlaces: public/scripts/comp/modalUtils.js (the Start menu's Help and Support)
        const places = callGlobal('getStartMenuPlaces') || [];
        const help = places.find((p) => p && p.id === 'help');
        if (help && typeof help.action === 'function') help.action();
    }

    function openSystem() {
        // melatonControlPanel: public/scripts/comp/melatonControlPanel.js; System is cplSystem.js
        void root.featureLoader.loadFeature('control_panel').then(() => {
            if (root.melatonControlPanel) root.melatonControlPanel.open('system');
        });
    }

    function openMobilityCenter() {
        // melatonControlPanel.openItem: public/scripts/comp/melatonControlPanel.js; the item is mobilityCenter.js
        void root.featureLoader.loadFeature('control_panel').then(() => {
            if (root.melatonControlPanel) root.melatonControlPanel.openItem('mobility-center');
        });
    }

    function launchQuickLaunch(n) {
        const settings = root.taskbarSettings && root.taskbarSettings.get();
        if (settings && settings.quickLaunch === false) return false;
        const buttons = doc.querySelectorAll('#taskbarQuickLaunch .taskbar-quick-launch-btn');
        const btn = buttons[n - 1];
        if (!btn) return false;
        btn.click();
        return true;
    }

    /** Alt+F4: the window in front closes the way its own Close button does (Alt+Q's pick). */
    function closeFrontWindow() {
        // the DeX desktop: an Android window with the focus closes (androidTaskbar.js, #1013)
        const android = root.melatonAndroidTaskbar;
        if (android && typeof android.closeFocused === 'function' && android.hasFocus()) return android.closeFocused();
        // canCloseWindowWithAltQ / resolveWindowToCloseWithAltQ: public/scripts/comp/modalUtils.js
        if (!callGlobal('canCloseWindowWithAltQ')) return false;
        const modal = callGlobal('resolveWindowToCloseWithAltQ');
        if (!modal || modal.classList.contains('minimised')) return false;
        const closeBtn = modal.querySelector('.modal-window-controls .close-btn') || modal.querySelector('.close-btn');
        if (closeBtn && !closeBtn.disabled) closeBtn.click();
        else callGlobal('closeModal', modal);
        return true;
    }

    // ---- DreamOS keys (cafeready keys.rs) ----------------------------------------------------------

    function flip3dKey() {
        if (root.flip3d && root.flip3d.isOpen()) { root.flip3d.select(); return; }
        const open = () => !!(root.flip3d && root.flip3d.open('sticky'));
        if (root.flip3d) { if (!open()) callGlobal('startWindowSwitcher'); return; }
        // flip3d.js is a lazy feature (featureLoader.js); without WebGL the window switcher
        if (root.featureLoader) void root.featureLoader.loadFeature('flip3d').then(() => { if (!open()) callGlobal('startWindowSwitcher'); }).catch(() => {});
    }

    /** Launchpad's key: the Start menu on All Programs; pressed again, the menu closes */
    function allProgramsKey() {
        const menu = doc.getElementById('startMenu');
        const open = menu && !menu.classList.contains('hidden') && !menu.classList.contains('start-menu-closing');
        if (open && menu.dataset.view === 'programs') { callGlobal('closeStartMenu'); return; }
        // openStartMenu / setStartMenuView: public/scripts/comp/modalUtils.js
        if (!open) callGlobal('openStartMenu');
        callGlobal('setStartMenuView', 'programs');
    }

    // the page's last audio or video that played (a capture listener: 'play' does not bubble)
    let lastMedia = null;
    if (doc) doc.addEventListener('play', (ev) => { if (ev.target && ev.target.tagName && /^(AUDIO|VIDEO)$/.test(ev.target.tagName)) lastMedia = ev.target; }, { capture: true, signal: appScopeSignal });

    /** Melaton Media Player (desktop-apps/mediaPlayer.js, a lazy feature), when it is open */
    function mediaPlayer() {
        // desktopMediaPlayer and its mediaPlayer* functions are that script's globals
        const p = typeof desktopMediaPlayer !== 'undefined' ? desktopMediaPlayer : null; // eslint-disable-line no-undef
        return p && p.el && p.el.media && p.el.media.isConnected && typeof mediaPlayerToggle === 'function' ? p : null; // eslint-disable-line no-undef
    }

    function mediaKey(action) {
        const mp = mediaPlayer();
        const media = lastMedia && lastMedia.isConnected ? lastMedia : null;
        /* eslint-disable no-undef */
        if (mp && (!media || media === mp.el.media)) {
            if (action === 'playpause') mediaPlayerToggle(mp);
            else if (action === 'next') mediaPlayerStep(mp, 1);
            else if (action === 'previous') mediaPlayerStep(mp, -1);
            else if (action === 'stop') mediaPlayerStop(mp);
            return;
        }
        /* eslint-enable no-undef */
        if (!media) return; // nothing plays: Vista does nothing
        if (action === 'playpause') {
            if (media.paused || media.ended) { const p = media.play(); if (p && p.catch) p.catch(() => {}); } else media.pause();
        } else if (action === 'stop') {
            media.pause();
            try { media.currentTime = 0; } catch (_) { /* not seekable */ }
        }
        // next / previous: a program without a playlist ignores them, as on Vista
    }

    const HOST_ACTIONS = {
        flip3d: flip3dKey,
        start: toggleStart,
        allprograms: allProgramsKey,
        desktop: () => root.taskbarSettings && root.taskbarSettings.toggleShowDesktop(),
        playpause: () => mediaKey('playpause'),
        next: () => mediaKey('next'),
        previous: () => mediaKey('previous'),
        stop: () => mediaKey('stop')
    };

    function onHostKey(ev) {
        const action = ev && ev.detail && ev.detail.action;
        const run = HOST_ACTIONS[action];
        if (!run) return;
        // the media keys also on the logon / lock screen's way to the desktop; the rest only on a usable desktop
        if (!/^(playpause|next|previous|stop)$/.test(action) && !desktopUsable()) return;
        try { run(); } catch (err) { console.error('desktopHotkeys: host key', action, err); }
    }

    // ---- Shut Down Melaton (Alt+F4 on the desktop) ---------------------------------------------------
    // Vista's Shut Down Windows (authui.dll dialog 2000, 274 x 242 DLU MS Shell Dlg 8; authui cuts it to 274 x 140 at
    // run time: Shutdown Event Tracker hidden, the brand banner on top, the buttons moved up) as the VM draws it: the
    // 411 x 77 px banner (basebrd's, About Melaton's art), the computer icon, "What do you want the computer to do?",
    // the list and the choice's description in Segoe UI 9, OK / Cancel / Help. authui's own strings (3008 - 3053).
    const BANNER_DLU = 77 * 8 / 13;
    const SHUTDOWN_TPL = {
        t: 'Shut Down Melaton', w: 274, h: 228 * 8 / 13, f: ['Segoe UI', 8], s: 0,
        c: [
            [100, 'S', 0, 0, 274, BANNER_DLU, 0x50000000, '', 0],
            [2027, 'S', 13, 7 + BANNER_DLU, 21, 20, 0x50020043, '#1008', 0],
            [2028, 'S', 44, 6 + BANNER_DLU, 173, 10, 0x50020000, '&What do you want the computer to do?', 0],
            [2001, 'C', 44, 20 + BANNER_DLU, 180, 57, 0x50210003, '', 0],
            [2002, 'S', 44, 40 + BANNER_DLU, 180, 30, 0x50020000, '', 0],
            [1, 'B', 108, 72 + BANNER_DLU, 50, 14, 0x50030001, 'O&K', 0],
            [2, 'B', 162, 72 + BANNER_DLU, 50, 14, 0x50010000, '&Cancel', 0],
            [9, 'B', 216, 72 + BANNER_DLU, 50, 14, 0x50010000, '&Help', 0]
        ]
    };
    const LAST_CHOICE = 'melatonShutDownChoice';

    function shutDownChoices() {
        const power = root.DreamOSPowerOptions && typeof root.DreamOSPowerOptions.get === 'function' ? root.DreamOSPowerOptions.get() : null;
        const sleep = !!(power && power.sleep && power.sleep.supported && root.DreamOSPower && root.DreamOSPower.sleep);
        const updates = doc.documentElement.dataset.updatesWaiting === '1';
        // runTeleportDirect / runLogoutDirect / runClientRestartDirect / runClientShutdownDirect: modalUtils.js
        return [
            { id: 'teleport', text: 'Teleport', note: 'Lets you go to another planet while your programs and files remain open.', run: () => callGlobal('runTeleportDirect') },
            { id: 'logoff', text: 'Log off', note: 'Ends your session, leaving the computer running on full power.', run: () => callGlobal('runLogoutDirect') },
            { id: 'restart', text: 'Restart', note: 'Closes all open programs, shuts down Melaton, and then starts Melaton again.', run: () => callGlobal('runClientRestartDirect') },
            ...(sleep ? [{ id: 'sleep', text: 'Sleep', note: 'Keeps your session in memory and puts the computer in a low-power state so that you can quickly resume working.', run: () => root.DreamOSPower.sleep() }] : []),
            updates
                ? { id: 'shutdown', text: 'Install Updates and Shut Down', note: 'Installs updates and then shuts down your computer.', run: () => callGlobal('runClientShutdownDirect') }
                : { id: 'shutdown', text: 'Shut Down', note: 'Closes all open programs, shuts down Melaton, and then turns off your computer.', run: () => callGlobal('runClientShutdownDirect') }
        ];
    }

    function openShutDown() {
        const V = root.vistaDialogTemplate;
        if (!V) return false;
        // open already: it stays (Vista brings it forward)
        const open = doc.getElementById('shutDownMelaton');
        if (open && !open.classList.contains('hidden')) { callGlobal('bringModalToFront', open); return true; }
        const choices = shutDownChoices();
        let last = null;
        try { last = root.localStorage.getItem(LAST_CHOICE); } catch (_) { /* private mode */ }
        // the last choice; first time, the Start menu's power button (Customize Start Menu)
        const prefs = (root.taskbarSettings && root.taskbarSettings.get && root.taskbarSettings.get()) || {};
        const pick = (choices.find((c) => c.id === last) || choices.find((c) => c.id === (prefs.powerButton === 'logoff' ? 'logoff' : prefs.powerButton)) || choices[choices.length - 1]).id;
        V.openDialog({
            id: 'shutDownMelaton',
            key: 'authui:2000',
            tpl: SHUTDOWN_TPL,
            bareCaption: true,
            overrides: { 100: { html: '<div class="vdt-shutdown-banner" style="position:absolute;inset:0;overflow:hidden;background:url(/static_images/vista-about/banner.png) 0 0 no-repeat, url(/static_images/vista-about/banner-rule.png) 0 72px no-repeat;"></div>' } },
            buttons: { 9: () => openHelp() },
            init(ctx) {
                const page = ctx.page('authui:2000');
                if (page && page.parentElement) page.parentElement.style.font = '12px/15px "Segoe UI", Tahoma, sans-serif';
                ctx.options(2001, choices.map((c) => ({ value: c.id, text: c.text })), pick);
                const note = () => {
                    const c = choices.find((x) => x.id === String(ctx.get(2001))) || choices[0];
                    ctx.text(2002, c.note);
                };
                ctx.on(2001, 'change', note);
                note();
            },
            ok(ctx) {
                const c = choices.find((x) => x.id === String(ctx.get(2001)));
                try { root.localStorage.setItem(LAST_CHOICE, c ? c.id : ''); } catch (_) { /* private mode */ }
                // after the dialog has gone (the power actions put up their own screens)
                if (c) setTimeout(() => { Promise.resolve().then(c.run).catch((err) => console.error('Shut Down Melaton:', err)); }, 0);
            },
            focusFirst: true
        });
        return true;
    }

    // Win+<key> by KeyboardEvent.code (layout-independent, like Windows' virtual keys)
    const WIN_COMBOS = {
        KeyD: () => root.taskbarSettings && root.taskbarSettings.toggleShowDesktop(),
        KeyM: (ev) => (ev.shiftKey ? undoMinimizeAll() : minimizeAll()),
        KeyE: () => callGlobal('openExplorerApplet', 'Computer'),
        KeyR: openRun,
        KeyF: startSearch,
        KeyL: () => root.workstationLock && root.workstationLock.lock(),
        F1: openHelp,
        Pause: openSystem,
        Space: () => callGlobal('openVistaSidebar'),
        KeyX: openMobilityCenter
    };

    function winComboAction(ev) {
        if (WIN_COMBOS[ev.code]) return WIN_COMBOS[ev.code];
        const digit = /^Digit([1-9])$/.exec(ev.code || '');
        if (digit) return () => launchQuickLaunch(Number(digit[1]));
        return null;
    }

    // ---- keys ----------------------------------------------------------------------------------

    function onKeydown(ev) {
        if (ev.key === 'Meta' && !IS_MAC) {
            win.down = true;
            win.used = false;
            return false;
        }
        if (ev.metaKey) win.used = true;
        if (!desktopUsable()) return false;

        if (ev.metaKey && !IS_MAC && !ev.ctrlKey && !ev.altKey) {
            const action = winComboAction(ev);
            if (!action) return false; // Win+Tab is keyboardShortcuts.js; others keep the browser's default
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.repeat) action(ev);
            return true;
        }
        if (ev.key === 'Escape' && ev.ctrlKey && ev.shiftKey && !ev.altKey && !ev.metaKey) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.repeat && root.melatonApps) void root.melatonApps.launch({ packageId: 'taskmgr' });
            return true;
        }
        if (ev.key === 'Escape' && ev.ctrlKey && !ev.altKey && !ev.shiftKey && !ev.metaKey && !windowSwitcherOpen()) {
            ev.preventDefault();
            ev.stopPropagation();
            if (!ev.repeat) toggleStart();
            return true;
        }
        if (ev.key === 'F4' && ev.altKey && !ev.ctrlKey && !ev.metaKey && !ev.shiftKey && standaloneApp()) {
            if (ev.repeat) {
                ev.preventDefault();
                return true;
            }
            // no window to close: Vista's Shut Down Windows
            if (!closeFrontWindow() && !openShutDown()) return false;
            ev.preventDefault();
            ev.stopPropagation();
            return true;
        }
        return false;
    }

    function onKeyup(ev) {
        if (ev.key !== 'Meta' || IS_MAC) return false;
        const tapped = win.down && !win.used;
        win.down = false;
        win.used = false;
        if (!tapped || !desktopUsable() || windowSwitcherOpen()) return false;
        ev.preventDefault();
        ev.stopPropagation();
        toggleStart();
        return true;
    }

    function resetWinKey() {
        win.down = false;
        win.used = false;
    }

    function wire() {
        if (typeof root.registerKeyboardListener !== 'function') return;
        // registerKeyboardListener: public/scripts/comp/modalKeyboardRegistry.js
        root.registerKeyboardListener({
            id: 'desktopHotkeys.keydown',
            handler: onKeydown,
            type: 'global',
            eventType: 'keydown',
            priority: 90,
            critical: true,
            showInOverlay: false
        });
        root.registerKeyboardListener({
            id: 'desktopHotkeys.keyup',
            handler: onKeyup,
            type: 'global',
            eventType: 'keyup',
            priority: 90,
            critical: true,
            showInOverlay: false
        });
        // a click while the Windows key is down is a combo too; the OS taking the key ends it
        doc.addEventListener('pointerdown', () => { if (win.down) win.used = true; }, true);
        root.addEventListener('blur', resetWinKey);
        // DreamOS: the host's keys (shell-ext bridge.js)
        root.addEventListener('dreamoshotkey', onHostKey, { signal: appScopeSignal });
    }

    // Vista's Shut Down Windows, for anything else that offers it (and tests)
    root.openShutDownMelaton = openShutDown;

    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', wire, { once: true });
        else wire();
    }

    const api = {
        _test: { onKeydown, onKeyup, winComboAction, desktopUsable, closeFrontWindow, minimizeAll, undoMinimizeAll, win }
    };
    root.desktopHotkeys = api;
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})();
