/**
 * The taskbar's own settings, Vista's "Taskbar and Start Menu Properties" (the dialog itself is
 * taskbarProperties.js, a lazy feature). This file keeps what must run from the first paint:
 *
 *   taskbarSettings.get()             the settings in force (a copy)
 *   taskbarSettings.set(patch)        save and apply at once (the dialog's Apply / OK, the
 *                                     taskbar menu's Lock the Taskbar)
 *   taskbarSettings.openProperties(tab)
 *                                     the Properties dialog: 'taskbar' | 'startmenu' |
 *                                     'notification' | 'toolbars'
 *
 * Settings (this computer, localStorage, like the notification-area lists in trayRegistry.js):
 *   locked          Lock the taskbar: unlocked shows the toolbar grippers
 *   autoHide        Auto-hide the taskbar: slides off the bottom edge, 2 px stay to catch the pointer
 *   onTop           Keep the taskbar on top of other windows: off, windows cover it until it is clicked
 *   group           Group similar taskbar buttons (modalUtils.js updateTaskbarWindows)
 *   quickLaunch     Show Quick Launch (also the Toolbars tab's Quick Launch)
 *   thumbnails      Show window previews (thumbnails) over taskbar buttons; off, the title tooltip
 *   hideInactive    Hide inactive icons (trayRegistry.js)
 *   clock / volume / network
 *                   the Notification Area tab's system icons
 *   recentFiles / recentPrograms / recentProgramCount / places
 *                   the Start Menu tab's Privacy and Customize Start Menu (modalUtils.js start menu)
 *   startIconSize   'small' | 'medium' | 'large': the pinned and most used list's rows
 *                   (Vista's "Use large icons" is large / small; medium is ours)
 *   programsIconSize
 *                   'small' | 'medium' | 'large': the All Programs list's rows
 *   powerButton     what the Start menu's power button does: 'shutdown' | 'restart' | 'logoff'
 *   lockButton      what the button beside it does: 'lock' | 'logoff'
 *   ticker          the Toolbars tab's Status toolbar (the connection ticker)
 *   opacity         20-100 %: how solid the taskbar's glass is (Yukimi 2026-10-21; Taskbar tab's
 *                   Opacity slider); 100 is the glass as it always was (aero-glass.css)
 *   quickLaunchItems
 *                   Quick Launch's shortcuts in order: 'show-desktop', 'switch-windows', or any
 *                   Start menu launchId; added with the Start menu's "Add to Quick Launch",
 *                   removed with Delete on the icon's right-click menu, reordered by dragging,
 *                   and the deleted defaults put back with Restore Default Items (the icon's menu,
 *                   the taskbar's Toolbars menu, the Properties' Toolbars tab)
 *
 * Also here: the Quick Launch toolbar, the taskbar's and the Start button's right-click menus,
 * and the window previews over taskbar buttons. Art: public/static_images/vista-taskbar/
 * (scripts/build-vista-taskbar-art.sh); styles: public/css/vista-taskbar.css.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const STORAGE_KEY = 'desktop-taskbar-settings';
    const ART = '/static_images/vista-taskbar';

    const DEFAULTS = Object.freeze({
        locked: true,
        autoHide: false,
        onTop: true,
        group: true,
        quickLaunch: true,
        thumbnails: true,
        hideInactive: true,
        clock: true,
        volume: true,
        network: true,
        recentFiles: true,
        recentPrograms: true,
        recentProgramCount: 8,
        ticker: true,
        startIconSize: 'large',
        programsIconSize: 'small',
        powerButton: 'shutdown',
        lockButton: 'lock',
        opacity: 100,
        quickLaunchItems: ['show-desktop', 'switch-windows', 'encyclopedia', 'media-player'],
        places: {}
    });

    // the choices of the string settings
    const CHOICES = Object.freeze({
        startIconSize: ['small', 'medium', 'large'],
        programsIconSize: ['small', 'medium', 'large'],
        powerButton: ['shutdown', 'restart', 'logoff'],
        lockButton: ['lock', 'logoff']
    });

    const BOOLEAN_KEYS = Object.keys(DEFAULTS).filter((k) => typeof DEFAULTS[k] === 'boolean');
    const AUTOHIDE_LEAVE_MS = 500;
    const THUMB_DELAY_MS = 400;
    const THUMB_MAX_NODES = 2500;

    function normalize(raw) {
        const out = { ...DEFAULTS, places: {} };
        if (!raw || typeof raw !== 'object') return out;
        BOOLEAN_KEYS.forEach((k) => {
            if (typeof raw[k] === 'boolean') out[k] = raw[k];
        });
        // the first build stored Vista's "Use large icons" as largeIcons
        if (raw.largeIcons === false && raw.startIconSize === undefined) out.startIconSize = 'small';
        Object.keys(CHOICES).forEach((k) => {
            if (CHOICES[k].includes(raw[k])) out[k] = raw[k];
        });
        if (Array.isArray(raw.quickLaunchItems)) {
            out.quickLaunchItems = raw.quickLaunchItems
                .filter((id, i, all) => typeof id === 'string' && /^[\w:.-]{1,80}$/.test(id) && all.indexOf(id) === i)
                .slice(0, 40);
        }
        const n = Number(raw.recentProgramCount);
        if (Number.isFinite(n)) out.recentProgramCount = Math.max(0, Math.min(30, Math.round(n)));
        const op = Number(raw.opacity);
        if (Number.isFinite(op)) out.opacity = Math.max(20, Math.min(100, Math.round(op)));
        if (raw.places && typeof raw.places === 'object') {
            Object.keys(raw.places).forEach((id) => {
                if (raw.places[id] === false) out.places[id] = false;
            });
        }
        return out;
    }

    function read() {
        try {
            const raw = root.localStorage ? root.localStorage.getItem(STORAGE_KEY) : null;
            return normalize(raw ? JSON.parse(raw) : null);
        } catch (_) {
            return normalize(null);
        }
    }

    let settings = read();

    function get() {
        return { ...settings, places: { ...settings.places }, quickLaunchItems: settings.quickLaunchItems.slice() };
    }

    function set(patch) {
        const next = normalize({ ...settings, ...(patch || {}), places: { ...settings.places, ...((patch && patch.places) || {}) } });
        if (patch && patch.places) {
            // a place turned back on drops out of the map
            Object.keys(patch.places).forEach((id) => {
                if (patch.places[id] !== false) delete next.places[id];
            });
        }
        settings = next;
        try {
            if (root.localStorage) root.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings));
        } catch (_) { /* private mode */ }
        apply();
        return get();
    }

    function taskbar() {
        return doc ? doc.getElementById('desktopTaskbar') : null;
    }

    function toggle(el, cls, on) {
        if (el && el.classList.contains(cls) !== on) el.classList.toggle(cls, on);
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        if (typeof fn === 'function') return fn(...args);
        return undefined;
    }

    // ---- apply ---------------------------------------------------------------------------------

    function apply() {
        const tb = taskbar();
        if (!tb) return;
        ensureQuickLaunch();
        toggle(tb, 'taskbar-unlocked', !settings.locked);
        toggle(tb, 'taskbar-not-on-top', !settings.onTop);
        toggle(tb, 'taskbar-no-quick-launch', !settings.quickLaunch);
        toggle(tb, 'taskbar-no-ticker', !settings.ticker);
        toggle(tb, 'tray-no-clock', !settings.clock);
        toggle(tb, 'tray-no-volume', !settings.volume);
        toggle(tb, 'tray-no-network', !settings.network);
        // the Start menu's icon sizes (desktop-shell.css #startMenu[data-start-size], [data-programs-size])
        const start = doc.getElementById('startMenu');
        if (start) {
            if (start.dataset.startSize !== settings.startIconSize) start.dataset.startSize = settings.startIconSize;
            if (start.dataset.programsSize !== settings.programsIconSize) start.dataset.programsSize = settings.programsIconSize;
        }
        setAutoHide(settings.autoHide);
        applyOpacity(settings.opacity);
        if (!settings.thumbnails) hideThumb(true);
        // traySyncOverflow: public/scripts/comp/trayRegistry.js
        callGlobal('traySyncOverflow');
        // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js (grouping)
        callGlobal('debouncedUpdateTaskbarWindows');
        try {
            root.dispatchEvent(new CustomEvent('taskbarsettingschange', { detail: get() }));
        } catch (_) { /* old browsers */ }
    }

    /** The glass's opacity (aero-glass.css .taskbar-custom-opacity); the dialog previews with it too. */
    function applyOpacity(percent) {
        const tb = taskbar();
        if (!tb) return;
        const v = Math.max(20, Math.min(100, Math.round(Number(percent) || 100)));
        toggle(tb, 'taskbar-custom-opacity', v < 100);
        if (v < 100) tb.style.setProperty('--taskbar-opacity', String(v / 100));
        else tb.style.removeProperty('--taskbar-opacity');
    }

    // ---- Start button width ----------------------------------------------------------------------

    /** The text styles size to their label, which lands on a fraction of a pixel and pushed Quick
     *  Launch and the buttons after it onto half pixels (blurry icons): round the width up. */
    let snapping = false;
    function snapStartButton() {
        const btn = doc && doc.getElementById('taskbarStartBtn');
        if (!btn || snapping) return;
        snapping = true;
        btn.style.removeProperty('width');
        if (!btn.classList.contains('orb')) {
            const w = btn.getBoundingClientRect().width;
            if (w && Math.abs(w - Math.round(w)) > 0.01) btn.style.width = `${Math.ceil(w)}px`;
        }
        snapping = false;
    }

    function watchStartButton() {
        const btn = doc && doc.getElementById('taskbarStartBtn');
        if (!btn || typeof MutationObserver !== 'function' || btn.dataset.snapWatch === '1') return;
        btn.dataset.snapWatch = '1';
        // style, text and logo changes (applyStartMenuButtonAppearanceToTaskbar, modalUtils.js)
        new MutationObserver(() => requestAnimationFrame(snapStartButton))
            .observe(btn, { attributes: true, attributeFilter: ['class', 'src'], childList: true, characterData: true, subtree: true });
        if (doc.fonts && doc.fonts.ready) doc.fonts.ready.then(snapStartButton).catch(() => {});
        snapStartButton();
    }

    // ---- auto-hide -----------------------------------------------------------------------------

    let autoHideWired = false;
    let autoHideTimer = 0;

    function autoHideHeld() {
        // the Start menu, a taskbar menu or a tray flyout keeps it up, as in Vista
        const start = doc.getElementById('startMenu');
        if (start && !start.classList.contains('hidden')) return true;
        const tb = taskbar();
        if (tb && tb.matches(':hover')) return true;
        if (typeof contextMenu !== 'undefined' && contextMenu && contextMenu.isOpen && contextMenu.currentTarget
            && tb && tb.contains(contextMenu.currentTarget)) return true;
        // the clock's flyout (taskbarClock.js) and a window preview over a button
        const clock = root.taskbarClockFlyout;
        if (clock && typeof clock.isOpen === 'function' && clock.isOpen()) return true;
        if (thumb && !thumb.classList.contains('hidden') && thumb.matches(':hover')) return true;
        return false;
    }

    function revealTaskbar() {
        const tb = taskbar();
        if (autoHideTimer) clearTimeout(autoHideTimer);
        autoHideTimer = 0;
        toggle(tb, 'taskbar-revealed', true);
    }

    function scheduleAutoHide() {
        if (autoHideTimer) clearTimeout(autoHideTimer);
        autoHideTimer = setTimeout(function check() {
            autoHideTimer = 0;
            if (!settings.autoHide) return;
            if (autoHideHeld()) {
                autoHideTimer = setTimeout(check, AUTOHIDE_LEAVE_MS);
                return;
            }
            toggle(taskbar(), 'taskbar-revealed', false);
        }, AUTOHIDE_LEAVE_MS);
    }

    function setAutoHide(on) {
        const tb = taskbar();
        if (!tb) return;
        const changed = tb.classList.contains('taskbar-autohide') !== on;
        toggle(tb, 'taskbar-autohide', on);
        if (!autoHideWired) {
            autoHideWired = true;
            tb.addEventListener('pointerenter', () => { if (settings.autoHide) revealTaskbar(); });
            tb.addEventListener('pointerleave', () => { if (settings.autoHide) scheduleAutoHide(); });
            tb.addEventListener('focusin', () => { if (settings.autoHide) revealTaskbar(); });
            // the Start button lights while the menu is open: keep the bar up for it
            const start = doc.getElementById('taskbarStartBtn');
            if (start && typeof MutationObserver === 'function') {
                new MutationObserver(() => {
                    if (!settings.autoHide) return;
                    if (start.classList.contains('active')) revealTaskbar();
                    else scheduleAutoHide();
                }).observe(start, { attributes: true, attributeFilter: ['class'] });
            }
        }
        if (!on) {
            toggle(tb, 'taskbar-revealed', false);
            if (autoHideTimer) clearTimeout(autoHideTimer);
            autoHideTimer = 0;
        }
        // the work area grows by the bar's height (modalUtils.js computeModalWorkAreaBounds):
        // maximised windows take the new one (refitMaximizedModals, modalUtils.js)
        callGlobal('syncRootStateFlags');
        if (changed) callGlobal('refitMaximizedModals');
    }

    // ---- keep on top ---------------------------------------------------------------------------

    function wireRaise() {
        if (!doc) return;
        // Not on top: a click on the bar brings it to the front until a window is used again
        doc.addEventListener('pointerdown', (ev) => {
            const tb = taskbar();
            if (!tb || settings.onTop) return;
            const inBar = tb.contains(ev.target) || !!ev.target.closest('#startMenu, .context-menu, .context-menu-overlay, .taskbar-thumb, .taskbar-clock-flyout');
            toggle(tb, 'taskbar-raised', inBar);
        }, true);
    }

    // ---- Quick Launch --------------------------------------------------------------------------

    let showDesktopWindows = null;

    // the two shell shortcuts Vista puts in Quick Launch; anything else is a Start menu launchId
    const QUICK_LAUNCH_SHELL = {
        'show-desktop': { title: 'Show desktop', icon: `${ART}/show-desktop-16.png`, icon2x: `${ART}/show-desktop-32.png`, run: () => toggleShowDesktop() },
        'switch-windows': { title: 'Switch between windows', icon: `${ART}/switch-windows-16.png`, icon2x: `${ART}/switch-windows-32.png`, run: () => openWindowSwitcher() }
    };

    function appIconSrc(name, px) {
        // resolveAppIconPath: public/scripts/comp/modalUtils.js (the server's sized webp)
        return callGlobal('resolveAppIconPath', name, px) || `/static_images/app_icons/${px}/${name.replace(/\.png$/, '.webp')}`;
    }

    /** One Quick Launch shortcut: its title, picture and what a click does (null: gone from the system). */
    function quickLaunchEntry(id) {
        if (QUICK_LAUNCH_SHELL[id]) return { id, ...QUICK_LAUNCH_SHELL[id] };
        // findStartMenuLaunchableById / startMenuLabel: public/scripts/comp/modalUtils.js
        const item = callGlobal('findStartMenuLaunchableById', id);
        if (!item) return null;
        const title = callGlobal('startMenuLabel', item) || item.text || id;
        if (item.imageIcon) return { id, title, icon: appIconSrc(item.imageIcon, 16), icon2x: appIconSrc(item.imageIcon, 32) };
        return { id, title, fa: item.icon || 'fas fa-window' };
    }

    function ensureQuickLaunch() {
        if (!doc) return null;
        let bar = doc.getElementById('taskbarQuickLaunch');
        if (!bar) {
            const tb = taskbar();
            const band = doc.getElementById('taskbarWindows');
            if (!tb || !band) return null;
            bar = doc.createElement('div');
            bar.id = 'taskbarQuickLaunch';
            bar.className = 'taskbar-quick-launch';
            bar.setAttribute('role', 'toolbar');
            bar.setAttribute('aria-label', 'Quick Launch');
            bar.addEventListener('click', (ev) => {
                const b = ev.target.closest('.taskbar-quick-launch-btn');
                if (!b) return;
                ev.stopPropagation();
                runQuickLaunch(b.dataset.quickLaunch);
            });
            wireQuickLaunchDrag(bar);
            bar.addEventListener('pointerover', (ev) => {
                const b = ev.target.closest('[data-quick-launch="switch-windows"]');
                if (b && !b.contains(ev.relatedTarget)) prewarmFlip3d();
            });
            tb.insertBefore(bar, band);
        }
        renderQuickLaunch(bar);
        return bar;
    }

    function runQuickLaunch(id) {
        const shell = QUICK_LAUNCH_SHELL[id];
        if (shell) shell.run();
        else if (!callGlobal('findStartMenuLaunchableById', id)) brokenQuickLaunch(id);
        else launchApp(id);
    }

    // the Start menu items load after this file: a launchId not found yet is looked for again
    // every 3 s, ten times; after that it is a shortcut whose program is gone
    const QUICK_LAUNCH_RETRY_MS = 3000;
    const QUICK_LAUNCH_RETRIES = 10;
    let quickLaunchRetries = 0;
    let quickLaunchRetryTimer = 0;

    /** A shortcut whose program is gone: Vista's generic program icon, still deletable. */
    function brokenQuickLaunchEntry(id) {
        return { id, title: id, icon: `${ART}/program-16.png`, icon2x: `${ART}/program-32.png`, missing: true };
    }

    /** Quick Launch's buttons from the list (rebuilt when the list changes). */
    function renderQuickLaunch(bar) {
        const key = settings.quickLaunchItems.join('|');
        if (bar.dataset.items === key) return;
        const giveUp = quickLaunchRetries >= QUICK_LAUNCH_RETRIES;
        let pending = false;
        const entries = settings.quickLaunchItems.map((id) => {
            const entry = quickLaunchEntry(id);
            if (entry) return entry;
            if (giveUp) return brokenQuickLaunchEntry(id);
            pending = true;
            return null;
        }).filter(Boolean);
        // a list still waiting on the Start menu is not marked done, so the retry rebuilds it
        bar.dataset.items = pending ? '' : key;
        bar.textContent = '';
        entries.forEach((entry) => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'taskbar-quick-launch-btn';
            b.dataset.quickLaunch = entry.id;
            b.dataset.contextMenu = 'vista-quick-launch-item';
            if (entry.missing) b.dataset.missing = 'true';
            b.title = entry.title;
            b.setAttribute('aria-label', entry.title);
            if (entry.fa) {
                const i = doc.createElement('i');
                i.className = entry.fa;
                i.setAttribute('aria-hidden', 'true');
                b.appendChild(i);
            } else {
                const img = doc.createElement('img');
                img.alt = '';
                img.draggable = false;
                img.width = 16;
                img.height = 16;
                img.src = entry.icon;
                img.srcset = `${entry.icon} 1x, ${entry.icon2x} 2x`;
                b.appendChild(img);
            }
            bar.appendChild(b);
        });
        if (pending && !quickLaunchRetryTimer) {
            quickLaunchRetryTimer = setTimeout(() => {
                quickLaunchRetryTimer = 0;
                quickLaunchRetries += 1;
                renderQuickLaunch(bar);
            }, QUICK_LAUNCH_RETRY_MS);
        }
    }

    /** Vista's "Problem with Shortcut": the program is gone; offer to delete the shortcut. */
    async function brokenQuickLaunch(id) {
        // showConfirmationDialog: public/scripts/comp/confirmationDialog.js
        if (typeof showConfirmationDialog !== 'function') return;
        const yes = await showConfirmationDialog(
            `The item '${id}' that this shortcut refers to has been changed or moved, so this shortcut will no longer work properly. Do you want to delete this shortcut?`,
            [
                { text: 'Yes', value: true, className: 'btn-standard primary' },
                { text: 'No', value: false, className: 'btn-standard' }
            ],
            null,
            { title: 'Problem with Shortcut' }
        );
        if (yes) removeQuickLaunch(id);
    }

    function hasQuickLaunch(id) {
        return settings.quickLaunchItems.includes(id);
    }

    /** The Start menu's "Add to Quick Launch": appended at the end, as Vista drops new shortcuts. */
    function addQuickLaunch(id) {
        if (!id || hasQuickLaunch(id)) return false;
        set({ quickLaunchItems: settings.quickLaunchItems.concat([id]) });
        return true;
    }

    function removeQuickLaunch(id) {
        if (!hasQuickLaunch(id)) return false;
        set({ quickLaunchItems: settings.quickLaunchItems.filter((x) => x !== id) });
        return true;
    }

    /** The list with `id` dropped into gap `gap` (0 = before the first, length = after the last),
     *  the gaps counted in the list as it is before the move. */
    function reorderList(list, id, gap) {
        const from = list.indexOf(id);
        if (from < 0) return list.slice();
        const to = Math.max(0, Math.min(list.length, Math.round(gap)));
        const out = list.filter((x) => x !== id);
        out.splice(to > from ? to - 1 : to, 0, id);
        return out;
    }

    /** Quick Launch's drag and drop: the shortcut moves to gap `gap`; false when it stays put. */
    function moveQuickLaunch(id, gap) {
        const next = reorderList(settings.quickLaunchItems, id, gap);
        if (next.join('|') === settings.quickLaunchItems.join('|')) return false;
        set({ quickLaunchItems: next });
        return true;
    }

    /** The default shortcuts (DEFAULTS.quickLaunchItems) the user has deleted. */
    function missingQuickLaunchDefaults(list = settings.quickLaunchItems) {
        return DEFAULTS.quickLaunchItems.filter((id) => !list.includes(id));
    }

    /** The list with each missing default back beside the default that comes before it (or first),
     *  the user's own shortcuts and order kept. */
    function mergeQuickLaunchDefaults(list) {
        const out = list.slice();
        DEFAULTS.quickLaunchItems.forEach((id, i) => {
            if (out.includes(id)) return;
            let at = 0;
            for (let j = i - 1; j >= 0; j--) {
                const k = out.indexOf(DEFAULTS.quickLaunchItems[j]);
                if (k >= 0) { at = k + 1; break; }
            }
            out.splice(at, 0, id);
        });
        return out;
    }

    /** "Restore Default Items": Show desktop, Switch between windows and the other defaults come back. */
    function restoreQuickLaunchDefaults() {
        if (!missingQuickLaunchDefaults().length) return false;
        set({ quickLaunch: true, quickLaunchItems: mergeQuickLaunchDefaults(settings.quickLaunchItems) });
        return true;
    }

    // ---- Quick Launch drag and drop ------------------------------------------------------------
    // Vista's toolbar insert mark: a black 2 px I-beam the taskbar's full height with 6 px and 4 px
    // serifs at both ends, its stem on the left edge of the button the drop goes before (VM,
    // 2026-10-22); the dragged icon follows the pointer at the grab offset, half see-through, on
    // the hot button face. The drag starts past Windows' 4 px SM_CXDRAG; Esc cancels.

    const QL_DRAG_PX = 4;
    let qlDrag = null;

    /** The gap (0..n) the pointer at clientX falls in: before the first button whose middle it is left of. */
    function quickLaunchGapAt(bar, clientX) {
        const btns = Array.from(bar.querySelectorAll('.taskbar-quick-launch-btn'));
        for (let i = 0; i < btns.length; i++) {
            const r = btns[i].getBoundingClientRect();
            if (clientX < r.left + r.width / 2) return i;
        }
        return btns.length;
    }

    function quickLaunchGapX(bar, gap) {
        const btns = bar.querySelectorAll('.taskbar-quick-launch-btn');
        const br = bar.getBoundingClientRect();
        if (!btns.length) return 0;
        if (gap < btns.length) return Math.round(btns[gap].getBoundingClientRect().left - br.left);
        return Math.round(btns[btns.length - 1].getBoundingClientRect().right - br.left);
    }

    function wireQuickLaunchDrag(bar) {
        bar.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0 || qlDrag) return;
            const b = ev.target.closest('.taskbar-quick-launch-btn');
            if (!b) return;
            const r = b.getBoundingClientRect();
            qlDrag = { bar, btn: b, id: b.dataset.quickLaunch, pointerId: ev.pointerId, x0: ev.clientX, y0: ev.clientY, dx: ev.clientX - r.left, dy: ev.clientY - r.top, on: false, gap: -1, ghost: null, mark: null };
        });
        bar.addEventListener('pointermove', onQuickLaunchDragMove);
        bar.addEventListener('pointerup', (ev) => endQuickLaunchDrag(ev, true));
        bar.addEventListener('pointercancel', (ev) => endQuickLaunchDrag(ev, false));
        bar.addEventListener('lostpointercapture', (ev) => { if (qlDrag && qlDrag.on) endQuickLaunchDrag(ev, false); });
        // the click after a drop is not a launch
        bar.addEventListener('click', (ev) => {
            if (bar.dataset.dragJustEnded !== '1') return;
            delete bar.dataset.dragJustEnded;
            ev.stopImmediatePropagation();
            ev.preventDefault();
        }, true);
    }

    function onQuickLaunchDragMove(ev) {
        const d = qlDrag;
        if (!d || ev.pointerId !== d.pointerId) return;
        if (!d.on) {
            if (Math.abs(ev.clientX - d.x0) <= QL_DRAG_PX && Math.abs(ev.clientY - d.y0) <= QL_DRAG_PX) return;
            d.on = true;
            try { d.bar.setPointerCapture(d.pointerId); } catch (_) { /* gone */ }
            hideThumb(true);
            d.ghost = d.btn.cloneNode(true);
            d.ghost.className = 'taskbar-quick-launch-btn taskbar-quick-launch-ghost';
            d.ghost.removeAttribute('title');
            d.ghost.setAttribute('aria-hidden', 'true');
            doc.body.appendChild(d.ghost);
            d.mark = doc.createElement('div');
            d.mark.className = 'taskbar-quick-launch-insert';
            d.mark.hidden = true;
            d.bar.appendChild(d.mark);
            d.bar.classList.add('is-dragging');
            doc.addEventListener('keydown', onQuickLaunchDragKey, true);
        }
        d.ghost.style.transform = `translate(${Math.round(ev.clientX - d.dx)}px, ${Math.round(ev.clientY - d.dy)}px)`;
        // over the toolbar (the taskbar's height, a button's width either side): an insert mark
        const tb = taskbar();
        const br = d.bar.getBoundingClientRect();
        const tr = tb ? tb.getBoundingClientRect() : br;
        const over = ev.clientY >= tr.top && ev.clientY <= tr.bottom && ev.clientX >= br.left - 23 && ev.clientX <= br.right + 23;
        d.gap = over ? quickLaunchGapAt(d.bar, ev.clientX) : -1;
        d.mark.hidden = d.gap < 0;
        if (d.gap >= 0) d.mark.style.left = `${quickLaunchGapX(d.bar, d.gap) - 2}px`;
    }

    function onQuickLaunchDragKey(ev) {
        if (ev.key !== 'Escape' || !qlDrag) return;
        ev.preventDefault();
        ev.stopPropagation();
        endQuickLaunchDrag(null, false);
    }

    function endQuickLaunchDrag(ev, drop) {
        const d = qlDrag;
        if (!d || (ev && ev.pointerId !== d.pointerId)) return;
        qlDrag = null;
        if (!d.on) return;
        doc.removeEventListener('keydown', onQuickLaunchDragKey, true);
        try { d.bar.releasePointerCapture(d.pointerId); } catch (_) { /* released */ }
        if (d.ghost) d.ghost.remove();
        if (d.mark) d.mark.remove();
        d.bar.classList.remove('is-dragging');
        d.bar.dataset.dragJustEnded = '1';
        setTimeout(() => { delete d.bar.dataset.dragJustEnded; }, 0);
        if (drop && d.gap >= 0) moveQuickLaunch(d.id, d.gap);
    }

    function launchApp(launchId) {
        // findStartMenuLaunchableById / launchStartMenuItem: public/scripts/comp/modalUtils.js
        const item = callGlobal('findStartMenuLaunchableById', launchId);
        if (item) callGlobal('launchStartMenuItem', item);
    }

    function openWindows() {
        return Array.from(doc.querySelectorAll('.modal:not(.hidden):not(.hidden-alt)'))
            .filter((m) => m.querySelector(':scope > .modal-window-title') && !m.classList.contains('closing'));
    }

    /** Vista's Show desktop: minimise every window; a second click brings the same windows back. */
    function toggleShowDesktop() {
        const visible = openWindows().filter((m) => !m.classList.contains('minimised'));
        if (visible.length) {
            showDesktopWindows = visible;
            // minimizeModalProgrammatically: public/scripts/comp/modalUtils.js
            visible.forEach((m) => callGlobal('minimizeModalProgrammatically', m));
            return;
        }
        const back = (showDesktopWindows || []).filter((m) => m.isConnected && m.classList.contains('minimised'));
        showDesktopWindows = null;
        back.forEach((m) => {
            // restoreMinimizedModal / getOrCreateTaskbarItem: public/scripts/comp/modalUtils.js
            const item = callGlobal('getOrCreateTaskbarItem', m) || null;
            callGlobal('restoreMinimizedModal', m, item);
        });
    }

    /** Switch between windows: the Ctrl+Tab switcher (keyboardShortcuts.js), held open until a pick. */
    let flip3dFailed = false;

    /** Vista's Switch between windows is Flip 3D (flip3d.js, a lazy feature), open until a click,
     *  Enter or Esc; without WebGL the window switcher. */
    function openWindowSwitcher() {
        const flip = () => !!(root.flip3d && root.flip3d.open('sticky'));
        if (!flip3dFailed && root.flip3d) {
            if (flip()) return;
            flip3dFailed = true;
        } else if (!flip3dFailed && typeof featureLoader !== 'undefined') {
            featureLoader.loadFeature('flip3d').then(() => {
                if (flip()) return;
                flip3dFailed = true;
                openClassicSwitcher();
            }).catch(() => {
                flip3dFailed = true;
                openClassicSwitcher();
            });
            return;
        }
        openClassicSwitcher();
    }

    /** Resting on Switch between windows: Flip 3D copies the windows that changed ahead. */
    function prewarmFlip3d() {
        if (flip3dFailed) return;
        if (root.flip3d) root.flip3d.prewarm();
        else if (typeof featureLoader !== 'undefined') featureLoader.loadFeature('flip3d').then(() => root.flip3d && root.flip3d.prewarm()).catch(() => {});
    }

    function openClassicSwitcher() {
        if (typeof startWindowSwitcher !== 'function') return;
        startWindowSwitcher();
        if (typeof windowSwitcherActive !== 'undefined' && !windowSwitcherActive) return;
        if (typeof navigateWindowSwitcher === 'function') navigateWindowSwitcher(1);
        const finish = (pick) => {
            doc.removeEventListener('keydown', onKey, true);
            doc.removeEventListener('pointerdown', onPointer, true);
            if (pick && typeof activateSelectedWindow === 'function') activateSelectedWindow();
            if (typeof stopWindowSwitcher === 'function') stopWindowSwitcher();
        };
        const onKey = (ev) => {
            if (ev.key === 'Escape') finish(false);
            else if (ev.key === 'Enter' || ev.key === ' ') finish(true);
            else if (ev.key === 'Tab' || ev.key === 'ArrowRight' || ev.key === 'ArrowLeft') {
                if (typeof navigateWindowSwitcher === 'function') navigateWindowSwitcher(ev.key === 'ArrowLeft' || ev.shiftKey ? -1 : 1);
            } else return;
            ev.preventDefault();
            ev.stopPropagation();
        };
        const onPointer = (ev) => {
            ev.preventDefault();
            ev.stopPropagation();
            finish(true);
        };
        // the click that opened it is still in flight
        setTimeout(() => {
            doc.addEventListener('keydown', onKey, true);
            doc.addEventListener('pointerdown', onPointer, true);
        }, 0);
    }

    // ---- window arrangement (the taskbar menu) -------------------------------------------------

    function arrangeable() {
        return openWindows().filter((m) => !m.classList.contains('minimised') && !m.classList.contains('on-top'));
    }

    function placeWindow(m, left, top, width, height) {
        // restoreModalFromMaximize / setModalOffsetsFromViewportTopLeft: public/scripts/comp/modalUtils.js
        if (callGlobal('isModalMaximized', m)) callGlobal('restoreModalFromMaximize', m);
        if (m.dataset.windowFixedSize !== 'true' && width && height) {
            m.style.width = `${Math.round(width)}px`;
            m.style.height = `${Math.round(height)}px`;
        }
        callGlobal('setModalOffsetsFromViewportTopLeft', m, Math.round(left), Math.round(top));
    }

    function workArea() {
        const wa = callGlobal('getModalWorkAreaBounds');
        return wa || { left: 0, top: 0, width: root.innerWidth, height: root.innerHeight - 35 };
    }

    function arrangeWindows(mode) {
        const list = arrangeable();
        if (!list.length) return;
        const wa = workArea();
        if (mode === 'cascade') {
            const step = 26;
            const w = wa.width * 0.6;
            const h = wa.height * 0.6;
            list.forEach((m, i) => placeWindow(m, wa.left + step * (i % 10) + 8, wa.top + step * (i % 10) + 8, w, h));
        } else {
            const n = list.length;
            list.forEach((m, i) => {
                if (mode === 'stacked') placeWindow(m, wa.left, wa.top + (wa.height / n) * i, wa.width, wa.height / n);
                else placeWindow(m, wa.left + (wa.width / n) * i, wa.top, wa.width / n, wa.height);
            });
        }
    }

    // ---- right-click menus ---------------------------------------------------------------------

    function openProperties(tab) {
        // featureLoader: public/scripts/comp/featureLoader.js; taskbarProperties: taskbarProperties.js
        const go = () => {
            if (root.taskbarProperties && typeof root.taskbarProperties.open === 'function') root.taskbarProperties.open(tab || 'taskbar');
        };
        if (root.taskbarProperties) return Promise.resolve(go());
        if (typeof featureLoader === 'undefined') return Promise.resolve();
        return featureLoader.loadFeature('taskbar_properties').then(go).catch((err) => {
            console.error('Taskbar and Start Menu Properties', err);
        });
    }

    function wireMenus() {
        if (typeof contextMenu === 'undefined' || !contextMenu || !contextMenu.configs) return false;
        const tb = taskbar();
        const start = doc.getElementById('taskbarStartBtn');
        if (!tb || !start) return false;
        // Vista's taskbar menu (right-click on the bar between the buttons, or on the clock)
        contextMenu.configs['vista-taskbar'] = {
            sections: [{
                type: 'list',
                items: [],
                // rebuilt at each open, so the check marks follow the settings
                initfn: (section) => {
                    const s = settings;
                    section.items = [
                        {
                            text: 'Toolbars',
                            submenu: [
                                { text: 'Quick Launch', action: 'tb-toolbar-quick-launch', checked: s.quickLaunch, indicatorMark: 'check', showIndicator: true },
                                { text: 'Status', action: 'tb-toolbar-ticker', checked: s.ticker, indicatorMark: 'check', showIndicator: true },
                                { separator: true },
                                { text: 'Restore Quick Launch Items', action: 'tb-ql-restore', disabled: !missingQuickLaunchDefaults().length }
                            ]
                        },
                        { separator: true },
                        { text: 'Cascade Windows', action: 'tb-cascade' },
                        { text: 'Show Windows Stacked', action: 'tb-stacked' },
                        { text: 'Show Windows Side by Side', action: 'tb-side' },
                        { text: 'Show the Desktop', action: 'tb-show-desktop' },
                        { separator: true },
                        { text: 'Lock the Taskbar', action: 'tb-lock', checked: s.locked, indicatorMark: 'check', showIndicator: true },
                        { text: 'Properties', action: 'tb-properties' }
                    ];
                }
            }],
            onAction: (action) => {
                switch (action) {
                    case 'tb-toolbar-quick-launch': set({ quickLaunch: !settings.quickLaunch }); break;
                    case 'tb-toolbar-ticker': set({ ticker: !settings.ticker }); break;
                    case 'tb-ql-restore': restoreQuickLaunchDefaults(); break;
                    case 'tb-cascade': arrangeWindows('cascade'); break;
                    case 'tb-stacked': arrangeWindows('stacked'); break;
                    case 'tb-side': arrangeWindows('side'); break;
                    case 'tb-show-desktop': toggleShowDesktop(); break;
                    case 'tb-lock': set({ locked: !settings.locked }); break;
                    case 'tb-properties': openProperties('taskbar'); break;
                    default: break;
                }
            }
        };
        // Vista's Start button menu: Properties opens the Start Menu tab
        contextMenu.configs['vista-start-button'] = {
            sections: [{
                type: 'list',
                items: [
                    { text: 'Properties', action: 'start-properties' },
                    { separator: true },
                    { text: 'Open', action: 'start-open' },
                    { text: 'Explore', action: 'start-explore' }
                ]
            }],
            onAction: (action) => {
                if (action === 'start-properties') openProperties('startmenu');
                else if (action === 'start-open') {
                    // openStartMenuOrganizer: public/scripts/comp/desktop-apps/startMenuOrganizer.js
                    featureLoader.loadFeature('start_menu_organizer').then(() => callGlobal('openStartMenuOrganizer')).catch(() => {});
                } else if (action === 'start-explore') callGlobal('openExplorerApplet');
            }
        };
        // a Quick Launch shortcut: Open, Delete takes it off the toolbar, and Restore Default Items
        // brings back the deleted defaults (Show desktop, Switch between windows...)
        contextMenu.configs['vista-quick-launch-item'] = {
            sections: [{
                type: 'list',
                items: [],
                initfn: (section) => {
                    section.items = [
                        { text: 'Open', action: 'ql-open' },
                        { separator: true },
                        { text: 'Delete', action: 'ql-delete' },
                        { separator: true },
                        { text: 'Restore Default Items', action: 'ql-restore', disabled: !missingQuickLaunchDefaults().length }
                    ];
                }
            }],
            onAction: (action, target) => {
                if (action === 'ql-restore') {
                    restoreQuickLaunchDefaults();
                    return;
                }
                const b = target && target.closest ? target.closest('.taskbar-quick-launch-btn') : null;
                if (!b) return;
                if (action === 'ql-open') runQuickLaunch(b.dataset.quickLaunch);
                else if (action === 'ql-delete') removeQuickLaunch(b.dataset.quickLaunch);
            }
        };
        tb.dataset.contextMenu = 'vista-taskbar';
        start.dataset.contextMenu = 'vista-start-button';
        return true;
    }

    // ---- window previews (thumbnails) ----------------------------------------------------------

    let thumb = null;
    let thumbFor = null;
    let thumbTimer = 0;
    let thumbHideTimer = 0;

    function modalFor(item) {
        const id = item && item.dataset.modalId;
        return id ? doc.getElementById(id) : null;
    }

    function titleOf(modal, item) {
        // getModalTitle: public/scripts/comp/modalUtils.js
        const t = callGlobal('getModalTitle', modal);
        if (t) return t;
        const span = item.querySelector('.taskbar-window-item-content span');
        return span ? span.textContent : '';
    }

    /** What a copy must not carry: a radio button's name would join (and uncheck) the real
     *  window's group, labels and autofocus act on the page. Ids stay: every app styles its window
     *  by them (Director's dark panes, Studio's layout); the preview sits last in <body>, so a
     *  getElementById / querySelector still finds the real window first. */
    function stripLiveAttributes(node) {
        if (node.nodeType !== 1) return;
        const strip = (el) => {
            el.removeAttribute('name');
            el.removeAttribute('for');
            el.removeAttribute('autofocus');
            el.removeAttribute('tabindex');
        };
        strip(node);
        node.querySelectorAll('[name], [for], [autofocus], [tabindex]').forEach(strip);
    }

    /** A still of the window: a clone with its ids (for its styles) but no form or focus ties,
     *  canvases copied. */
    function snapshot(modal, box) {
        if (!modal || modal.getElementsByTagName('*').length > THUMB_MAX_NODES) return null;
        const minimised = modal.classList.contains('minimised');
        const rect = modal.getBoundingClientRect();
        const w = minimised ? (parseFloat(modal.style.width) || modal.offsetWidth) : rect.width;
        const h = minimised ? (parseFloat(modal.style.height) || modal.offsetHeight) : rect.height;
        if (!w || !h) return null;
        const clone = modal.cloneNode(true);
        const srcCanvases = modal.querySelectorAll('canvas');
        const dstCanvases = clone.querySelectorAll('canvas');
        dstCanvases.forEach((c, i) => {
            const s = srcCanvases[i];
            if (!s || !s.width || !s.height) return;
            try {
                c.width = s.width;
                c.height = s.height;
                c.getContext('2d').drawImage(s, 0, 0);
            } catch (_) { /* tainted or WebGL */ }
        });
        clone.querySelectorAll('video, audio, iframe, script').forEach((el) => el.remove());
        stripLiveAttributes(clone);
        clone.classList.remove('minimised', 'minimising', 'active-window', 'entering', 'leaving');
        clone.classList.add('taskbar-thumb-clone');
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('inert', '');
        const scale = Math.min(box.w / w, box.h / h);
        // the copy's geometry beats the window's own rules (maximized windows and some apps size
        // themselves with !important), or the preview grows past its box
        const fixed = {
            position: 'absolute', inset: 'auto', left: '0px', top: '0px', right: 'auto', bottom: 'auto',
            width: `${w}px`, height: `${h}px`, 'min-width': '0px', 'min-height': '0px', 'max-width': 'none', 'max-height': 'none',
            margin: '0px', transform: `scale(${scale})`, 'transform-origin': '0 0', translate: 'none', scale: 'none', rotate: 'none',
            zoom: '1', 'pointer-events': 'none', animation: 'none', transition: 'none', opacity: '1', visibility: 'visible'
        };
        Object.keys(fixed).forEach((prop) => clone.style.setProperty(prop, fixed[prop], 'important'));
        const holder = doc.createElement('div');
        holder.className = 'taskbar-thumb-still';
        holder.style.width = `${Math.round(w * scale)}px`;
        holder.style.height = `${Math.round(h * scale)}px`;
        holder.appendChild(clone);
        return holder;
    }

    function ensureThumb() {
        if (thumb) return thumb;
        thumb = doc.createElement('div');
        thumb.className = 'taskbar-thumb hidden';
        thumb.setAttribute('role', 'tooltip');
        thumb.innerHTML = '<div class="taskbar-thumb-title"></div><div class="taskbar-thumb-body"></div>';
        thumb.addEventListener('pointerenter', () => { if (thumbHideTimer) clearTimeout(thumbHideTimer); thumbHideTimer = 0; });
        thumb.addEventListener('pointerleave', () => hideThumb());
        thumb.addEventListener('click', () => {
            const item = thumbFor;
            hideThumb(true);
            if (item && item.isConnected) item.click();
        });
        doc.body.appendChild(thumb);
        return thumb;
    }

    function showThumb(item) {
        const modal = modalFor(item);
        if (!modal) return;
        const el = ensureThumb();
        // last in <body> before the copy goes in: lookups by id find the real window first
        if (el !== doc.body.lastElementChild) doc.body.appendChild(el);
        const title = titleOf(modal, item);
        el.querySelector('.taskbar-thumb-title').textContent = title;
        const body = el.querySelector('.taskbar-thumb-body');
        body.textContent = '';
        const withPreview = settings.thumbnails;
        el.classList.toggle('is-tooltip', !withPreview);
        if (withPreview) {
            const still = snapshot(modal, { w: 200, h: 120 });
            if (still) body.appendChild(still);
            else {
                // too large to copy: the window's icon, as Vista draws a window with no picture
                const icon = item.querySelector('img.icon-image, i');
                if (icon) body.appendChild(icon.cloneNode(true));
                body.classList.add('is-icon');
            }
        }
        thumbFor = item;
        el.classList.remove('hidden');
        const r = item.getBoundingClientRect();
        const tbRect = taskbar().getBoundingClientRect();
        const w = el.offsetWidth;
        const left = Math.max(4, Math.min(root.innerWidth - w - 4, r.left + r.width / 2 - w / 2));
        el.style.left = `${Math.round(left)}px`;
        el.style.bottom = `${Math.round(root.innerHeight - tbRect.top + 2)}px`;
    }

    function hideThumb(now) {
        if (thumbTimer) clearTimeout(thumbTimer);
        thumbTimer = 0;
        if (!thumb) return;
        const done = () => {
            thumbHideTimer = 0;
            thumbFor = null;
            if (!thumb) return;
            thumb.classList.add('hidden');
            thumb.querySelector('.taskbar-thumb-body').textContent = '';
        };
        if (thumbHideTimer) clearTimeout(thumbHideTimer);
        if (now) done();
        else thumbHideTimer = setTimeout(done, 150);
    }

    function wireThumbs() {
        const band = doc.getElementById('taskbarWindows');
        if (!band) return;
        band.addEventListener('pointerover', (ev) => {
            if (ev.pointerType === 'touch') return;
            const item = ev.target.closest('.taskbar-window-item:not(.taskbar-window-group)');
            if (!item || item === thumbFor) return;
            if (thumbHideTimer) clearTimeout(thumbHideTimer);
            thumbHideTimer = 0;
            if (thumbTimer) clearTimeout(thumbTimer);
            // already showing one: move straight over, as Vista does
            const delay = thumbFor ? 0 : THUMB_DELAY_MS;
            thumbTimer = setTimeout(() => {
                thumbTimer = 0;
                if (item.isConnected && item.matches(':hover')) showThumb(item);
            }, delay);
        });
        band.addEventListener('pointerleave', () => hideThumb());
        band.addEventListener('pointerdown', () => hideThumb(true), true);
    }

    // ---- start-up ------------------------------------------------------------------------------

    function init() {
        if (!doc || !taskbar()) return;
        apply();
        watchStartButton();
        wireRaise();
        wireThumbs();
        if (!wireMenus()) {
            // contextMenu.js builds its instance on DOMContentLoaded
            doc.addEventListener('DOMContentLoaded', wireMenus, { once: true });
            setTimeout(wireMenus, 2000);
        }
    }

    const api = {
        DEFAULTS,
        CHOICES,
        get,
        set,
        apply,
        previewOpacity: applyOpacity,
        normalize,
        openProperties,
        toggleShowDesktop,
        arrangeWindows,
        hasQuickLaunch,
        addQuickLaunch,
        removeQuickLaunch,
        moveQuickLaunch,
        missingQuickLaunchDefaults,
        mergeQuickLaunchDefaults,
        restoreQuickLaunchDefaults,
        quickLaunchEntry,
        _test: { read, snapshot, stripLiveAttributes, reorderList, QUICK_LAUNCH_SHELL, STORAGE_KEY }
    };
    root.taskbarSettings = api;

    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
