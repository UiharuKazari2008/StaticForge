/**
 * Android windows on the DeX desktop's taskbar (StaticForge #1005).
 *
 * Every Android program window on the DeX display gets a taskbar button beside Dreamscape's own windows, in the order
 * the windows opened: its icon and title, pressed while it has focus, the minimised look while minimised. A click
 * brings it forward, or minimises it when it is the window in front (as Vista's buttons do); right-click gives
 * Restore / Minimize / Close. While an Android window has focus, Dreamscape's own buttons are not pressed.
 *
 * Source: the Android app's AndroidWindows bridge in this window (DSApp, the Melaton accessibility service plus a shell
 * task helper): list() answers from its cache; 'androidwindows' pushes the same object on every change (coalesced on
 * its side, only while this page is seen); activate / minimize / close(id, req) answer through 'androidwindowsresult'.
 * The page never asks on a timer.
 *
 * Buttons are .taskbar-window-item with data-android-window, in #taskbarWindows: modalUtils.js updateTaskbarWindows
 * leaves them alone (taskbarItemShouldExist) and isModalActiveForTaskbar asks melatonAndroidTaskbar.hasFocus().
 *
 * Only in the DeX window (AndroidDisplay.isDesktop() with the desktop shell and the bridge present).
 */
(function () {
    'use strict';

    const root = typeof window !== 'undefined' ? window : null;
    const doc = typeof document !== 'undefined' ? document : null;
    if (!root || !doc) return;
    const isDesktop = (() => {
        try { return !!(root.AndroidDisplay && typeof root.AndroidDisplay.isDesktop === 'function' && root.AndroidDisplay.isDesktop()); } catch (_) { return false; }
    })();
    const W = root.AndroidWindows;
    if (!isDesktop || root.uiShell === 'mobile' || !W || typeof W.list !== 'function') return;

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    const ASKED_KEY = 'melatonDexWindowsAccessAsked';
    const MENU_ID = 'android-taskbar-window';

    let state = { windows: [], focusedId: null, can: {}, access: {} };
    const buttons = new Map(); // window id -> button element
    let reqSeq = 0;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const band = () => doc.getElementById('taskbarWindows');
    const byId = (id) => state.windows.find((w) => w.id === id) || null;
    const titleOf = (w) => String(w.title || w.label || w.package || 'Program');
    // the program's picture as the phone's Start menu draws it (the Program Icons store, else Android's icon):
    // androidDesktopPrograms.js iconFor; the taskbar draws 16 px pictures
    const iconOf = (w) => {
        const P = root.melatonAndroidPrograms;
        if (P && typeof P.iconFor === 'function') return P.iconFor({ id: w.appId, package: w.package, icon: w.icon }, 16);
        return { src: w.icon ? String(w.icon) : '', srcset: '' };
    };
    const iconKey = (w) => { const i = iconOf(w); return `${i.src}|${i.srcset}`; };

    function send(op, id) {
        if (typeof W[op] !== 'function') return false;
        const req = `aw${++reqSeq}`;
        try { return !!W[op](id, req); } catch (_) { return false; }
    }

    function hasFocus() {
        return !!(state.focusedId && byId(state.focusedId));
    }

    // ---- buttons ----

    function contentHtml(w) {
        const pic = iconOf(w);
        const img = pic.src ? `<img src="${esc(pic.src)}"${pic.srcset ? ` srcset="${esc(pic.srcset)}"` : ''} alt="" class="icon-image" draggable="false" />` : '<i class="fas fa-window-maximize"></i>';
        return `<div class="taskbar-window-item-content">${img}<span>${esc(titleOf(w))}</span></div>`;
    }

    function createButton(w) {
        const item = doc.createElement('div');
        item.className = 'taskbar-window-item taskbar-android-item entering';
        item.dataset.androidWindow = w.id;
        item.dataset.contentKey = `${titleOf(w)}|${iconKey(w)}`;
        item.innerHTML = contentHtml(w);
        item.title = titleOf(w);
        item.addEventListener('click', (e) => {
            e.stopPropagation();
            const cur = byId(item.dataset.androidWindow);
            if (!cur) return;
            // the window in front: minimised, as a Vista button does; any other: brought forward
            if (state.focusedId === cur.id && !cur.minimized && state.can.minimize) send('minimize', cur.id);
            else send('activate', cur.id);
        });
        item.addEventListener('contextmenu', (e) => showMenu(e, item));
        item.addEventListener('animationend', (e) => {
            if (e.target !== item || e.animationName !== 'taskbar-item-grow') return;
            item.classList.remove('entering');
        }, { once: true });
        return item;
    }

    function updateButton(item, w) {
        const key = `${titleOf(w)}|${iconKey(w)}`;
        if (item.dataset.contentKey !== key) {
            item.dataset.contentKey = key;
            item.innerHTML = contentHtml(w);
            item.title = titleOf(w);
        }
        const active = state.focusedId === w.id && !w.minimized;
        // syncTaskbarItemStateClasses: public/scripts/comp/modalUtils.js (writes only the classes that change)
        if (typeof root.syncTaskbarItemStateClasses === 'function') root.syncTaskbarItemStateClasses(item, active, !!w.minimized);
        else {
            if (item.classList.contains('active') !== active) item.classList.toggle('active', active);
            if (item.classList.contains('minimised') !== !!w.minimized) item.classList.toggle('minimised', !!w.minimized);
        }
    }

    function removeButton(item) {
        // scheduleTaskbarItemRemoval: public/scripts/comp/modalUtils.js (the shrink animation, then gone)
        if (typeof root.scheduleTaskbarItemRemoval === 'function') root.scheduleTaskbarItemRemoval(item);
        else item.remove();
    }

    function apply(next) {
        if (!next || next.ok === false) return;
        const hadFocus = hasFocus();
        state = {
            windows: Array.isArray(next.windows) ? next.windows.filter((w) => w && w.id) : [],
            focusedId: next.focusedId || null,
            can: next.can || {},
            access: next.access || {}
        };
        const b = band();
        if (!b) return;
        const seen = new Set();
        state.windows.forEach((w) => {
            seen.add(w.id);
            let item = buttons.get(w.id);
            if (!item || !item.isConnected || item.classList.contains('leaving')) {
                item = createButton(w);
                buttons.set(w.id, item);
                b.appendChild(item);
            }
            updateButton(item, w);
        });
        buttons.forEach((item, id) => {
            if (seen.has(id)) return;
            buttons.delete(id);
            removeButton(item);
        });
        // Dreamscape's own buttons lose (or get back) their pressed look when focus moves between the two
        // updateTaskbarActiveStates: public/scripts/comp/modalUtils.js
        if (hadFocus !== hasFocus() && typeof root.updateTaskbarActiveStates === 'function') root.updateTaskbarActiveStates();
        askAccessOnce();
    }

    function read() {
        try { apply(JSON.parse(W.list() || 'null')); } catch (_) { /* an older app: nothing to show */ }
    }

    /** The windows come from the Melaton accessibility service: turned on once, quietly through the shell when the app can. */
    function askAccessOnce() {
        if (state.access.service !== false || !state.access.shell || typeof W.requestAccess !== 'function') return;
        try { if (localStorage.getItem(ASKED_KEY)) return; localStorage.setItem(ASKED_KEY, String(Date.now())); } catch (_) { return; }
        try { W.requestAccess(); } catch (_) { /* the app could not: the buttons stay away */ }
    }

    // ---- right-click: the window's menu ----

    function showMenu(e, item) {
        e.preventDefault();
        e.stopPropagation();
        const cm = root.contextMenu;
        const w = byId(item.dataset.androidWindow);
        if (!cm || !w || typeof cm.showMenu !== 'function') return;
        if (!cm.configs) cm.configs = {};
        cm.configs[MENU_ID] = {
            sections: [{
                type: 'list',
                items: [
                    { text: 'Restore', icon: 'fas fa-window-restore', action: 'aw-restore', disabled: !(w.minimized || state.focusedId !== w.id) },
                    { text: 'Minimize', icon: 'fas fa-window-minimize', action: 'aw-minimize', disabled: !state.can.minimize || !!w.minimized },
                    { separator: true },
                    { text: 'Close', icon: 'fas fa-times', action: 'aw-close', disabled: !state.can.close }
                ]
            }],
            onAction: (action) => {
                if (action === 'aw-restore') send('activate', w.id);
                else if (action === 'aw-minimize') send('minimize', w.id);
                else if (action === 'aw-close') send('close', w.id);
            }
        };
        item.dataset.contextMenu = MENU_ID;
        cm.showMenu(e, item);
    }

    // ---- start ----

    root.addEventListener('androidwindows', (e) => apply(e && e.detail), { signal: appScopeSignal });
    // the Program Icons store changed (androidDesktopPrograms.js): the buttons take the new pictures
    doc.addEventListener('melaton:android-programs', () => { buttons.forEach((item, id) => { const w = byId(id); if (w) updateButton(item, w); }); }, { signal: appScopeSignal });

    function desktopUp() {
        try { return typeof root.getClientDesktopState === 'function' && root.getClientDesktopState() === 'desktop'; } catch (_) { return false; }
    }
    // the first list once the desktop is up (the bridge answers from its cache; pushes carry every change after)
    if (desktopUp()) read();
    else doc.addEventListener('desktopBootDone', read, { once: true, signal: appScopeSignal });

    // ---- Show desktop, Minimize all, Alt+F4 with Android windows (#1013) ----

    /** The Android windows shown now are minimised (Show desktop, Win+M); their ids, for bringing them back. */
    function minimizeShown() {
        const shown = state.windows.filter((w) => !w.minimized);
        // the one with the focus last, so it is in front again when they come back
        shown.sort((a, b) => (a.id === state.focusedId) - (b.id === state.focusedId));
        shown.forEach((w) => send('minimize', w.id));
        return shown.map((w) => w.id);
    }

    /** Brought back in the order given (the last ends in front); windows closed meanwhile are skipped. */
    function restore(ids) {
        (ids || []).filter((id) => byId(id)).forEach((id) => send('activate', id));
    }

    /** Alt+F4 while an Android window has the focus: that window closes. */
    function closeFocused() {
        return hasFocus() ? send('close', state.focusedId) : false;
    }

    // ---- the DeX screen's shortcut keys (#1013) ----
    // With One UI Home off nothing of Samsung's answers the Windows key and its shortcuts any more. The app hands this
    // screen's shortcut keys over whichever window has the focus (DSApp MelatonBars dexKey: the Windows key and anything
    // pressed with it, Alt+Tab and the Alt let go after it, Alt+F4, Ctrl+Esc, Ctrl+Shift+Esc): they are replayed here as
    // the page's own key events, so the desktop's handlers answer them as on any desktop (desktopHotkeys.js,
    // keyboardShortcuts.js).
    root.addEventListener('androidhotkey', (e) => {
        const k = e.detail;
        if (!k || (k.type !== 'keydown' && k.type !== 'keyup')) return;
        const target = doc.activeElement && doc.activeElement !== doc.body ? doc.activeElement : doc.body;
        try {
            target.dispatchEvent(new KeyboardEvent(k.type, {
                key: String(k.key || 'Unidentified'), code: String(k.code || ''), repeat: !!k.repeat,
                metaKey: !!k.metaKey, altKey: !!k.altKey, ctrlKey: !!k.ctrlKey, shiftKey: !!k.shiftKey,
                bubbles: true, cancelable: true, composed: true
            }));
        } catch (err) { console.warn('[androidTaskbar] hotkey', err); }
    }, { signal: appScopeSignal });

    root.melatonAndroidTaskbar = {
        hasFocus,
        windows: () => state.windows.slice(),
        activate: (id) => send('activate', id),
        shownCount: () => state.windows.filter((w) => !w.minimized).length,
        minimizeShown,
        restore,
        closeFocused
    };
})();
