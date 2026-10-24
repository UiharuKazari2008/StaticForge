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
 *   Alt+F4          close the window in front (with none, the browser closes the app as before)
 *   Ctrl+Shift+Esc  Windows Task Manager (apps/taskmgr)
 *
 * Win+Tab and Alt+Tab (switch windows while held) live with Ctrl+Tab in keyboardShortcuts.js.
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

    // the Windows key's press: Start opens on release unless it was used for a combo
    const win = { down: false, used: false };
    // Win+M's windows, for Win+Shift+M
    let minimizedAll = null;

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
        if (!visible.length) return;
        minimizedAll = visible;
        // minimizeModalProgrammatically: public/scripts/comp/modalUtils.js
        visible.forEach((m) => callGlobal('minimizeModalProgrammatically', m));
    }

    function undoMinimizeAll() {
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
        // canCloseWindowWithAltQ / resolveWindowToCloseWithAltQ: public/scripts/comp/modalUtils.js
        if (!callGlobal('canCloseWindowWithAltQ')) return false;
        const modal = callGlobal('resolveWindowToCloseWithAltQ');
        if (!modal || modal.classList.contains('minimised')) return false;
        const closeBtn = modal.querySelector('.modal-window-controls .close-btn') || modal.querySelector('.close-btn');
        if (closeBtn && !closeBtn.disabled) closeBtn.click();
        else callGlobal('closeModal', modal);
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
        Space: () => callGlobal('openVistaSidebar')
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
            if (!closeFrontWindow()) return false;
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
    }

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
