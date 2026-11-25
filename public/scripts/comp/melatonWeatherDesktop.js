/**
 * Melaton Weather's desktop window (Yozora #792 item 7, split out of wmWeather.js in #852): the Vista window around
 * the phone's Weather page. wmWeather.js (the weather app: data, pages, layers) creates it with its internals
 * (create(host)) and uses what it returns: shell() for the WM shell's calls, formUi() for Settings, open() and
 * isActive(). Loaded by featureLoader 'melaton_weather' before wmWeather.js; Melaton Mobile never loads it.
 */
(function () {
    'use strict';
    window.melatonWeatherDesktop = {
        create(h) {
        // ---------------------------------------------------------------- the desktop window (#792 item 7)
        //
        // The same app in a Vista window: the page and every layer are the phone's, laid out by the wide
        // container rules (sky left, forecasts right). desktopShell() answers the WM shell's calls:
        //   soft keys       the command bar under the caption (Back, the left key, Locations, Radar,
        //                   Graphs, Settings, Menu)
        //   messageBox      the Vista dialog (showConfirmationDialog)
        //   menuAt          the desktop context menu (contextMenu.js)
        //   busy            the wait cursor over the window while the work runs
        // Settings draws Vista controls (formUi), the radar's time bar is the Vista trackbar (a skinned
        // input in .win7: sliders-platform rule). Start menu: Melaton Weather; the Sidebar's Weather opens it.
        let win = null;
        let menuAnchor = null;

        function desktopShell() {
            const esc = (t) => String(t == null ? '' : t).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
            return {
                escapeHtml: esc,
                holdMs: 550,
                get current() { return win && !win.classList.contains('hidden') ? h.APP_ID : null; },
                isBusy: () => !!(win && win.classList.contains('wxd-busy')),
                async busy(work, opts = {}) {
                    const run = typeof work === 'function' ? work() : work;
                    const t = setTimeout(() => { if (win) win.classList.add('wxd-busy'); }, opts.delay || 0);
                    try { return await run; } finally { clearTimeout(t); if (win) win.classList.remove('wxd-busy'); }
                },
                messageBox({ title = 'Weather', text = '', buttons = null } = {}) {
                    const html = esc(text).replace(/\n/g, '<br>');
                    const opts = buttons ? buttons.map((b, i) => ({ text: b.text, value: b.value, className: i === 0 ? 'btn-primary' : 'btn-secondary' })) : [{ text: 'OK', value: true, className: 'btn-primary' }];
                    if (typeof window.showConfirmationDialog === 'function') return window.showConfirmationDialog(html, opts, null, { title });
                    return Promise.resolve(window.confirm(text));
                },
                menuAt(x, y, items) { desktopMenu(x, y, items); },
                setTitle(t) {
                    if (!win) return;
                    const cap = win.querySelector('.wxd-caption');
                    if (cap) cap.textContent = t && t !== 'Weather' ? `Melaton Weather - ${t}` : 'Melaton Weather';
                },
                syncHistory() {},
                refreshTitleAction() {},
                refreshSoftKeys() { renderCommands(); },
                refreshStatus() {},
                open() { openWindow(); }
            };
        }

        /** A WM menu ([{ label, action, disabled, checked, radio, submenu }, '-']) as the desktop's context menu. */
        function desktopMenu(x, y, items) {
            const cm = window.contextMenu;
            if (!cm || typeof cm.attachToElement !== 'function') return;
            const map = (list) => list.map((it) => (it === '-' ? { separator: true } : {
                text: it.label,
                disabled: !!it.disabled,
                checked: it.checked != null ? !!it.checked : (it.radio != null ? !!it.radio : undefined),
                submenu: it.submenu ? map(typeof it.submenu === 'function' ? it.submenu() : it.submenu) : undefined,
                action: it.action ? 'wx-run' : undefined,
                wxRun: it.action
            }));
            if (!menuAnchor) {
                menuAnchor = document.createElement('div');
                menuAnchor.className = 'wxd-menu-anchor';
                menuAnchor.style.cssText = 'position:fixed;width:1px;height:1px;left:0;top:0;pointer-events:none';
                document.body.appendChild(menuAnchor);
            }
            cm.attachToElement(menuAnchor, {
                sections: [{ type: 'list', items: map(typeof items === 'function' ? items() : items) }],
                onAction: (action, target, item) => { if (item && typeof item.wxRun === 'function') item.wxRun(); }
            });
            cm.showMenu({ clientX: x, clientY: y, preventDefault() {}, stopPropagation() {}, target: menuAnchor }, menuAnchor);
        }

        /** Settings' controls: the WM form on the phone, Vista controls (7.css in .win7) on the desktop. */
        function formUi() {
            const esc = (t) => h.ws().escapeHtml(t);
            let n = 0;
            return {
                check: (name, label, checked, attrs = '') => { const id = `wxdC${++n}`; return `<div class="wxd-field"><input type="checkbox" id="${id}" name="${esc(name)}"${checked ? ' checked' : ''} ${attrs}><label for="${id}">${esc(label)}</label></div>`; },
                radio: (name, value, label, checked, attrs = '') => { const id = `wxdR${++n}`; return `<div class="wxd-field"><input type="radio" id="${id}" name="${esc(name)}" value="${esc(value)}"${checked ? ' checked' : ''} ${attrs}><label for="${id}">${esc(label)}</label></div>`; },
                row: (label, control) => `<div class="wxd-row"><span>${esc(label)}</span>${control}</div>`,
                comboHtml: (act, label, disabled) => `<select class="vdt-select" data-act="${esc(act)}"${disabled ? ' disabled' : ''}><option>${esc(label)}</option></select>`,
                bindCombo(sel, options, current, onPick) {
                    if (!sel) return;
                    sel.innerHTML = options.map(([v, l]) => `<option value="${esc(v)}"${String(v) === String(current) ? ' selected' : ''}>${esc(l)}</option>`).join('');
                    sel.addEventListener('change', () => { const hit = options.find(([v]) => String(v) === sel.value); if (hit) onPick(hit[0]); });
                },
                sub: (text) => `<div class="wxd-sub">${esc(text)}</div>`,
                note: (text) => `<p class="wxd-note">${esc(text)}</p>`,
                gap: () => '<div class="wxd-gap"></div>'
            };
        }

        /** The command bar: Back while a page is open, the page's own keys, then the app's places and pages. */
        function renderCommands() {
            if (!win || !h.els()) return;
            const bar = win.querySelector('.wxd-commands');
            const keys = h.app().softKeys();
            // Explorer's command bar (vista-explorer.css .explorer-actions-header in a light window client)
            const btn = (act, label, disabled, cls = '') => `<button type="button" class="explorer-command-btn wxd-cmd ${cls}" data-cmd="${act}"${disabled ? ' disabled' : ''}>${h.ws().escapeHtml(label)}</button>`;
            const top = h.layers()[h.layers().length - 1];
            let html = '';
            if (h.layers().length) html += btn('back', 'Back', false, 'is-back');
            if (keys.left && keys.left.label && !(h.layers().length && /^(Done|Cancel)$/.test(keys.left.label))) html += btn('left', keys.left.label, keys.left.disabled);
            html += '<span class="wxd-sep"></span>';
            [['places', 'Locations'], ['radar', 'Radar'], ['graphs', 'Graphs'], ['settings', 'Settings']].forEach(([id, label]) => { html += btn(`page:${id}`, label, false, top === id ? 'is-on' : ''); });
            html += '<span class="wxd-spring"></span>';
            if (keys.right && keys.right.menu) html += btn('menu', 'Menu', false, 'is-menu');
            bar.innerHTML = `<div class="explorer-command-set">${html}</div>`;
            bar.onclick = (e) => {
                const b = e.target.closest('[data-cmd]');
                if (!b || b.disabled) return;
                const k = h.app().softKeys();
                const c = b.dataset.cmd;
                if (c === 'back') h.popLayer();
                else if (c === 'left' && k.left && k.left.action) k.left.action();
                else if (c === 'menu' && k.right && k.right.menu) { const r = b.getBoundingClientRect(); desktopMenu(r.left, r.bottom, k.right.menu); }
                else if (c.startsWith('page:')) {
                    const id = c.slice(5);
                    if (top === id) return;
                    h.clearLayers();
                    h.syncLayers();
                    if (id === 'places') h.openPlaces(); else if (id === 'radar') h.openRadar(); else if (id === 'graphs') h.openGraphs(); else if (id === 'settings') h.openSettings();
                }
            };
        }

        function buildWindow() {
            win = document.createElement('div');
            win.id = 'melatonWeatherModal';
            win.className = 'modal hidden resizeable-window wxd-window';
            win.dataset.windowIdentifier = 'melatonWeather';
            win.dataset.windowClient = 'light';
            win.dataset.windowDefaultWidth = '1000';
            win.dataset.windowDefaultHeight = '700';
            win.dataset.windowMinWidth = '620';
            win.dataset.windowMinHeight = '460';
            win.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="/static_images/app_icons/16/melaton-weather.webp" srcset="/static_images/app_icons/16/melaton-weather.webp 1x, /static_images/app_icons/32/melaton-weather.webp 2x" alt=""><span class="wxd-caption">Melaton Weather</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small wxd-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content wxd-client">
                    <div class="wxd-commands explorer-actions-header" role="toolbar"></div>
                    <div class="wxd-body"><div class="wm-page wm-weather wxd-page"></div></div>
                </div>`;
            document.body.appendChild(win);
            win.querySelector('.wxd-close').addEventListener('click', () => {
                if (typeof window.closeModal === 'function') window.closeModal(win); else win.classList.add('hidden');
            });
            // shown / hidden however it happens (taskbar, minimise, close): the app's show and hide
            new MutationObserver(() => {
                const open = !win.classList.contains('hidden') && !win.classList.contains('minimized');
                if (open && !h.shown()) h.app().show(); else if (!open && h.shown()) h.app().hide();
            }).observe(win, { attributes: true, attributeFilter: ['class'] });
            h.app().mount(win.querySelector('.wxd-page'));
            // the desktop page: Settings and the radar in Vista controls
            win.querySelector('.wxw-settings-layer').classList.add('win7', 'wxd-settings');
            const track = win.querySelector('.wxw-map-track');
            if (track) track.classList.add('win7');
        }

        /** Open Melaton Weather on the desktop (Start menu, the Sidebar's Weather, alerts' View). */
        function openWindow() {
            if (!win) buildWindow();
            if (typeof window.openModal === 'function') window.openModal(win); else win.classList.remove('hidden');
            if (typeof window.bringModalToFront === 'function') window.bringModalToFront(win);
            if (!h.shown()) h.app().show();
            renderCommands();
        }
            return {
                shell: desktopShell,
                formUi,
                open: openWindow,
                isActive: () => !!(win && win.classList.contains('active-window'))
            };
        }
    };
})();
