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
 *   largeIcons      Customize Start Menu's "Use large icons" (the pinned and most used list)
 *   programsIconSize
 *                   'small' | 'medium' | 'large': the All Programs list's rows
 *   powerButton     what the Start menu's power button does: 'shutdown' | 'restart' | 'logoff'
 *   lockButton      what the button beside it does: 'lock' | 'logoff'
 *   ticker          the Toolbars tab's Status toolbar (the connection ticker)
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
        largeIcons: true,
        programsIconSize: 'small',
        powerButton: 'shutdown',
        lockButton: 'lock',
        places: {}
    });

    // the choices of the string settings
    const CHOICES = Object.freeze({
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
        Object.keys(CHOICES).forEach((k) => {
            if (CHOICES[k].includes(raw[k])) out[k] = raw[k];
        });
        const n = Number(raw.recentProgramCount);
        if (Number.isFinite(n)) out.recentProgramCount = Math.max(0, Math.min(30, Math.round(n)));
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
        return { ...settings, places: { ...settings.places } };
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
        // the Start menu's icon sizes (desktop-shell.css .start-menu-small-icons, [data-programs-size])
        const start = doc.getElementById('startMenu');
        if (start) {
            toggle(start, 'start-menu-small-icons', !settings.largeIcons);
            if (start.dataset.programsSize !== settings.programsIconSize) start.dataset.programsSize = settings.programsIconSize;
        }
        setAutoHide(settings.autoHide);
        if (!settings.thumbnails) hideThumb(true);
        // traySyncOverflow: public/scripts/comp/trayRegistry.js
        callGlobal('traySyncOverflow');
        // debouncedUpdateTaskbarWindows: public/scripts/comp/modalUtils.js (grouping)
        callGlobal('debouncedUpdateTaskbarWindows');
        try {
            root.dispatchEvent(new CustomEvent('taskbarsettingschange', { detail: get() }));
        } catch (_) { /* old browsers */ }
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
        // the work area grows by the bar's height (modalUtils.js computeModalWorkAreaBounds)
        callGlobal('syncRootStateFlags');
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

    const QUICK_LAUNCH = [
        { id: 'show-desktop', title: 'Show desktop', icon: `${ART}/show-desktop-16.png`, icon2x: `${ART}/show-desktop-32.png`, run: () => toggleShowDesktop() },
        { id: 'switch-windows', title: 'Switch between windows', icon: `${ART}/switch-windows-16.png`, icon2x: `${ART}/switch-windows-32.png`, run: () => openWindowSwitcher() },
        { id: 'encyclopedia', title: 'Grimoire', appIcon: 'vista-iexplore.png' },
        { id: 'media-player', title: 'Media Player', appIcon: 'media_player.png' }
    ];

    function appIconSrc(name, px) {
        // resolveAppIconPath: public/scripts/comp/modalUtils.js (the server's sized webp)
        return callGlobal('resolveAppIconPath', name, px) || `/static_images/app_icons/${px}/${name.replace(/\.png$/, '.webp')}`;
    }

    function ensureQuickLaunch() {
        if (!doc) return null;
        let bar = doc.getElementById('taskbarQuickLaunch');
        if (bar) return bar;
        const tb = taskbar();
        const band = doc.getElementById('taskbarWindows');
        if (!tb || !band) return null;
        bar = doc.createElement('div');
        bar.id = 'taskbarQuickLaunch';
        bar.className = 'taskbar-quick-launch';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Quick Launch');
        QUICK_LAUNCH.forEach((entry) => {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'taskbar-quick-launch-btn';
            b.dataset.quickLaunch = entry.id;
            b.title = entry.title;
            b.setAttribute('aria-label', entry.title);
            const img = doc.createElement('img');
            img.alt = '';
            img.draggable = false;
            img.width = 16;
            img.height = 16;
            if (entry.appIcon) {
                img.src = appIconSrc(entry.appIcon, 16);
                img.srcset = `${appIconSrc(entry.appIcon, 16)} 1x, ${appIconSrc(entry.appIcon, 32)} 2x`;
            } else {
                img.src = entry.icon;
                img.srcset = `${entry.icon} 1x, ${entry.icon2x} 2x`;
            }
            b.appendChild(img);
            b.addEventListener('click', (ev) => {
                ev.stopPropagation();
                if (entry.run) entry.run();
                else launchApp(entry.id);
            });
            bar.appendChild(b);
        });
        tb.insertBefore(bar, band);
        return bar;
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
    function openWindowSwitcher() {
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
                                { text: 'Status', action: 'tb-toolbar-ticker', checked: s.ticker, indicatorMark: 'check', showIndicator: true }
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

    function stripIds(node) {
        if (node.nodeType !== 1) return;
        node.removeAttribute('id');
        node.removeAttribute('name');
        node.removeAttribute('for');
        node.removeAttribute('autofocus');
        node.querySelectorAll('[id], [name], [for], [autofocus]').forEach((el) => {
            el.removeAttribute('id');
            el.removeAttribute('name');
            el.removeAttribute('for');
            el.removeAttribute('autofocus');
        });
    }

    /** A still of the window: a clone with no ids (no lookup can land in it), canvases copied. */
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
        stripIds(clone);
        clone.classList.remove('minimised', 'minimising', 'active-window', 'entering', 'leaving');
        clone.classList.add('taskbar-thumb-clone');
        clone.setAttribute('aria-hidden', 'true');
        clone.setAttribute('inert', '');
        const scale = Math.min(box.w / w, box.h / h);
        clone.style.cssText += `;position:absolute;left:0;top:0;width:${w}px;height:${h}px;margin:0;transform:scale(${scale});transform-origin:0 0;translate:none;inset:auto;pointer-events:none;animation:none;transition:none;opacity:1;visibility:visible;`;
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
        normalize,
        openProperties,
        toggleShowDesktop,
        arrangeWindows,
        _test: { read, snapshot, stripIds, QUICK_LAUNCH, STORAGE_KEY }
    };
    root.taskbarSettings = api;

    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', init, { once: true });
        else init();
    }
})(typeof window !== 'undefined' ? window : globalThis);
