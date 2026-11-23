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
 * More than two Android windows (Yukimi, Nov 22 2026, #1029) share ONE group button, as Vista groups a program's buttons:
 * "[icon] N Android Runtime ▾" (.taskbar-window-group, vista-taskbar.css). A click opens Vista's list of those windows
 * (each window's icon and title; picking one brings it forward), right-click the group's menu: Restore Group / Minimize
 * Group / Close Group (Vista's Cascade / Show Windows Stacked / Side by Side are left out: Android places its own windows).
 * One or two keep their own buttons; Taskbar Properties' "Group similar taskbar buttons" off never groups them.
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
    const W0 = root.AndroidWindows;
    if (!isDesktop || root.uiShell === 'mobile' || !W0 || typeof W0.list !== 'function') return;
    // read at each call: a desktop paused with its display unplugged gets the new window's bridge when it resumes (#1015)
    const W = () => root.AndroidWindows || W0;

    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;

    const ASKED_KEY = 'melatonDexWindowsAccessAsked';
    const MENU_ID = 'android-taskbar-window';
    const GROUP_LIST_ID = 'android-taskbar-group-list';
    const GROUP_MENU_ID = 'android-taskbar-group';
    // more than two Android windows: one group button (#1029)
    const GROUP_FROM = 3;
    const GROUP_NAME = 'Android Runtime';

    let state = { windows: [], focusedId: null, can: {}, access: {} };
    const buttons = new Map(); // window id -> button element
    let groupBtn = null;        // the group button while the windows are grouped
    let groupListWasOpen = false;
    let lastList = null;        // the bridge's last list (applied again when the grouping setting changes)
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
        const b = W();
        if (typeof b[op] !== 'function') return false;
        const req = `aw${++reqSeq}`;
        try { return !!b[op](id, req); } catch (_) { return false; }
    }

    function hasFocus() {
        return !!(state.focusedId && byId(state.focusedId));
    }

    // ---- which had the focus last (Alt+Tab's order, #1039) ----
    // Vista lists the windows from the one in front backwards. Android tells only which window has the focus
    // now, so each change is timed: an Android window when it got the focus, the desktop's own page when the
    // focus went back to it (then its windows' own order, modalUtils.js getWindowUsageStack, applies).
    const focusAt = new Map(); // window id -> performance.now() when it last had the focus
    let pageFocusAt = 0;
    function noteFocus(was, now) {
        if (was === now) return;
        const t = root.performance ? root.performance.now() : Date.now();
        if (was) focusAt.set(was, t);
        if (now) focusAt.set(now, t);
        else pageFocusAt = t;
    }

    /** The Android windows, the one with the focus first, then the others by when they last had it, and when
     *  the desktop's page last took the focus back (windows that had it later go in front of the page's). */
    function recency() {
        const at = (w) => (w.id === state.focusedId ? Infinity : (focusAt.get(w.id) || 0));
        const windows = state.windows.slice().sort((a, b) => at(b) - at(a)).map((w) => ({ window: w, at: at(w) }));
        return { windows, pageFocusAt: state.focusedId ? pageFocusAt : Infinity };
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
        lastList = next;
        const hadFocus = hasFocus();
        noteFocus(state.focusedId, next.focusedId || null);
        state = {
            windows: Array.isArray(next.windows) ? next.windows.filter((w) => w && w.id) : [],
            focusedId: next.focusedId || null,
            can: next.can || {},
            access: next.access || {}
        };
        const b = band();
        if (!b) return;
        const seen = new Set();
        if (shouldGroup()) {
            // the windows' own buttons go; the group button stands in their place
            buttons.forEach((item) => removeButton(item));
            buttons.clear();
            showGroup(b);
            if (hadFocus !== hasFocus() && typeof root.updateTaskbarActiveStates === 'function') root.updateTaskbarActiveStates();
            askAccessOnce();
            return;
        }
        dropGroup();
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

    // ---- the group button (#1029) ----

    function shouldGroup() {
        if (state.windows.length < GROUP_FROM) return false;
        // taskbarGroupingEnabled: public/scripts/comp/modalUtils.js (Taskbar Properties' Group similar taskbar buttons)
        return typeof root.taskbarGroupingEnabled !== 'function' || root.taskbarGroupingEnabled();
    }

    /** The picture on the group button: the window in front's program, else the first window's. */
    function groupLead() {
        return byId(state.focusedId) || state.windows[0];
    }

    /**
     * The group button's name: "Android - <the window in front>" (Yukimi, Nov 23 2026: "Android - " is the group's name on
     * the taskbar, not on every window in its list)
     */
    function groupTitle() {
        const lead = groupLead();
        return lead ? `Android - ${titleOf(lead)}` : GROUP_NAME;
    }

    function groupHtml() {
        const lead = groupLead();
        const pic = lead ? iconOf(lead) : { src: '', srcset: '' };
        const img = pic.src ? `<img src="${esc(pic.src)}"${pic.srcset ? ` srcset="${esc(pic.srcset)}"` : ''} alt="" class="icon-image" draggable="false" />` : '<i class="fas fa-window-maximize"></i>';
        return `<div class="taskbar-window-item-content">${img}<span>${esc(groupTitle())}</span><span class="taskbar-group-count">${state.windows.length}</span></div>`;
    }

    function showGroup(b) {
        if (!groupBtn || !groupBtn.isConnected || groupBtn.classList.contains('leaving')) {
            const item = doc.createElement('div');
            item.className = 'taskbar-window-item taskbar-window-group taskbar-android-item taskbar-android-group entering';
            // data-android-window: modalUtils.js leaves the button to this file (taskbarItemShouldExist)
            item.dataset.androidWindow = 'group';
            // a second click on the button closes its list (the menu's outside press shuts it first)
            item.addEventListener('pointerdown', () => {
                const cm = root.contextMenu;
                groupListWasOpen = !!(cm && cm.isOpen && cm.currentTarget === item && item.dataset.contextMenu === GROUP_LIST_ID);
            });
            item.addEventListener('click', (e) => {
                e.stopPropagation();
                if (groupListWasOpen) { groupListWasOpen = false; return; }
                showGroupList(e, item);
            });
            item.addEventListener('contextmenu', (e) => showGroupMenu(e, item));
            item.addEventListener('animationend', (e) => {
                if (e.target !== item || e.animationName !== 'taskbar-item-grow') return;
                item.classList.remove('entering');
            }, { once: true });
            groupBtn = item;
            b.appendChild(item);
        }
        const key = `${state.windows.length}|${groupLead() ? iconKey(groupLead()) : ''}|${groupTitle()}`;
        if (groupBtn.dataset.contentKey !== key) {
            groupBtn.dataset.contentKey = key;
            groupBtn.innerHTML = groupHtml();
        }
        const title = state.windows.map(titleOf).join('\n');
        if (groupBtn.title !== title) groupBtn.title = title;
        const allMin = state.windows.every((w) => w.minimized);
        const active = hasFocus() && !allMin;
        if (typeof root.syncTaskbarItemStateClasses === 'function') root.syncTaskbarItemStateClasses(groupBtn, active, allMin);
        else {
            if (groupBtn.classList.contains('active') !== active) groupBtn.classList.toggle('active', active);
            if (groupBtn.classList.contains('minimised') !== allMin) groupBtn.classList.toggle('minimised', allMin);
        }
    }

    function dropGroup() {
        if (!groupBtn) return;
        const cm = root.contextMenu;
        if (cm && cm.isOpen && cm.currentTarget === groupBtn && typeof cm.hideMenu === 'function') cm.hideMenu();
        removeButton(groupBtn);
        groupBtn = null;
    }

    /** Vista's list of a group's windows: each window's icon and title, picking one brings it forward. */
    function showGroupList(e, item) {
        const cm = root.contextMenu;
        if (!cm || typeof cm.showMenu !== 'function' || !state.windows.length) return;
        if (!cm.configs) cm.configs = {};
        cm.configs[GROUP_LIST_ID] = {
            position: 'anchor',
            sections: [{
                type: 'list',
                items: state.windows.map((w) => {
                    const pic = iconOf(w);
                    return { text: titleOf(w), image: pic.src || undefined, action: `awg:${w.id}`, closeAction: state.can.close ? `awgx:${w.id}` : undefined };
                })
            }],
            onAction: (action) => {
                if (action.startsWith('awgx:')) send('close', action.slice(5));
                else if (action.startsWith('awg:')) send('activate', action.slice(4));
            },
            onHide: () => { item.classList.remove('group-menu-open'); }
        };
        item.dataset.contextMenu = GROUP_LIST_ID;
        item.classList.add('group-menu-open');
        cm.showMenu(e, item);
    }

    /** Right-click on the group: Restore Group, Minimize Group, Close Group. */
    function showGroupMenu(e, item) {
        e.preventDefault();
        e.stopPropagation();
        const cm = root.contextMenu;
        if (!cm || typeof cm.showMenu !== 'function') return;
        if (!cm.configs) cm.configs = {};
        const anyMin = state.windows.some((w) => w.minimized);
        const anyShown = state.windows.some((w) => !w.minimized);
        const glyph = (name) => `vista-sysmenu-glyph vista-sysmenu-${name}`;
        cm.configs[GROUP_MENU_ID] = {
            sections: [{
                type: 'list',
                items: [
                    { icon: glyph('restore'), text: 'Restore Group', action: 'awg-restore', disabled: !anyMin },
                    { icon: glyph('minimize'), text: 'Minimize Group', action: 'awg-minimize', disabled: !anyShown || !state.can.minimize },
                    { separator: true },
                    { icon: glyph('close'), text: 'Close Group', action: 'awg-close', className: 'context-menu-item-default', disabled: !state.can.close }
                ]
            }],
            onAction: (action) => {
                if (action === 'awg-restore') restore(restoreOrder());
                else if (action === 'awg-minimize') minimizeShown();
                else if (action === 'awg-close') state.windows.slice().forEach((w) => send('close', w.id));
            }
        };
        item.dataset.contextMenu = GROUP_MENU_ID;
        cm.showMenu(e, item);
    }

    /** Every window of the group, the one in front last (it ends in front again). */
    function restoreOrder() {
        const ids = state.windows.map((w) => w.id);
        ids.sort((a, b) => (a === state.focusedId) - (b === state.focusedId));
        return ids;
    }

    function read() {
        try { apply(JSON.parse(W().list() || 'null')); } catch (_) { /* an older app: nothing to show */ }
    }

    /** The windows come from the Melaton accessibility service: turned on once, quietly through the shell when the app can. */
    function askAccessOnce() {
        if (state.access.service !== false || !state.access.shell || typeof W().requestAccess !== 'function') return;
        try { if (localStorage.getItem(ASKED_KEY)) return; localStorage.setItem(ASKED_KEY, String(Date.now())); } catch (_) { return; }
        try { W().requestAccess(); } catch (_) { /* the app could not: the buttons stay away */ }
    }

    // ---- right-click: the window's menu ----

    function showMenu(e, item) {
        e.preventDefault();
        e.stopPropagation();
        const cm = root.contextMenu;
        const w = byId(item.dataset.androidWindow);
        if (!cm || !w || typeof cm.showMenu !== 'function') return;
        if (!cm.configs) cm.configs = {};
        // Vista's window menu, as Dreamscape's own windows' buttons give (modalUtils buildVistaWindowMenuItems; Yukimi, Nov 23
        // 2026: "its taskbar menu is also not the correct type"): Restore / Move / Size / Minimize / Maximize, Close in bold with
        // Alt+F4 - what Android does not let the desktop do greyed
        const glyph = (name) => `vista-sysmenu-glyph vista-sysmenu-${name}`;
        cm.configs[MENU_ID] = {
            sections: [{
                type: 'list',
                items: [
                    { icon: glyph('restore'), text: 'Restore', action: 'aw-restore', disabled: !(w.minimized || state.focusedId !== w.id) },
                    { text: 'Move', action: 'aw-move', disabled: true },
                    { text: 'Size', action: 'aw-size', disabled: true },
                    { icon: glyph('minimize'), text: 'Minimize', action: 'aw-minimize', disabled: !state.can.minimize || !!w.minimized },
                    { icon: glyph('maximize'), text: 'Maximize', action: 'aw-maximize', disabled: true },
                    { separator: true },
                    { icon: glyph('close'), text: 'Close', action: 'aw-close', subtext: 'Alt+F4', className: 'context-menu-item-default', disabled: !state.can.close }
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
    // Taskbar Properties' Group similar taskbar buttons turned on or off (taskbarSettings.js)
    root.addEventListener('taskbarsettingschange', () => { if (state.windows.length >= GROUP_FROM) apply(lastList); }, { signal: appScopeSignal });
    // resumed on a display connected again (#1015): the windows on that display now
    root.addEventListener('melatondesktopresume', () => { if (desktopUp()) read(); }, { signal: appScopeSignal });
    // the Program Icons store changed (androidDesktopPrograms.js): the buttons take the new pictures
    doc.addEventListener('melaton:android-programs', () => {
        buttons.forEach((item, id) => { const w = byId(id); if (w) updateButton(item, w); });
        if (groupBtn) { delete groupBtn.dataset.contentKey; const b = band(); if (b) showGroup(b); }
    }, { signal: appScopeSignal });

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
        // keys the app took for the Start menu it draws (start: true) are replayed by dexStartMenu.js with their typing (#1055)
        if (k.start && root.melatonDexStartMenu && root.melatonDexStartMenu.active()) return;
        // Alt+Tab drawn by the app (dexAltTab.js) learns the app's session before the replayed key opens the pane (#1054)
        const at = root.melatonDexAltTab;
        if (at && typeof at.hotkey === 'function') { try { at.hotkey(k); } catch (err) { console.warn('[androidTaskbar] alttab', err); } }
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
        /** One Android window by its id (the taskbar preview's title, picture and X). */
        window: (id) => { const w = byId(String(id)); return w ? Object.assign({}, w, { title: titleOf(w) }) : null; },
        /** Closed as its menu's Close does (the preview's X). */
        close: (id) => { if (state.can.close) send('close', String(id)); },
        windows: () => state.windows.slice(),
        recency,
        // the program's picture at a size (androidDesktopPrograms.js iconFor): Alt+Tab's 32 and 48 px
        iconFor: (w, size) => {
            const P = root.melatonAndroidPrograms;
            if (P && typeof P.iconFor === 'function') return P.iconFor({ id: w.appId, package: w.package, icon: w.icon }, size);
            return { src: w.icon ? String(w.icon) : '', srcset: '' };
        },
        titleOf,
        activate: (id) => send('activate', id),
        shownCount: () => state.windows.filter((w) => !w.minimized).length,
        minimizeShown,
        restore,
        closeFocused
    };
})();
