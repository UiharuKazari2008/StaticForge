/**
 * Melaton Mobile shell: the Windows Mobile 6.1 Professional look for phones (Yozora #709).
 *
 * app.html's first script picks the shell once per page load (window.uiShell, html.ui-mobile)
 * and it never changes while the page lives, so the desktop and this shell never share the
 * screen: under ui-mobile wm-shell.css hides every other top-level element of <body>; the
 * desktop's confirmation / input dialog (#confirmationDialog) keeps its logic and is drawn as a
 * WM message box there.
 *
 * Shell: title bar (Start, title, status icons, ok / X), the current app in the content pane,
 * soft-key bar (left key, SIP button, right key / menu), Start menu, soft-key popup menus.
 * Apps register with wmShell.registerApp({ id, title, icon, inStart, mount(page), show(), hide(),
 * softKeys() }) and run one at a time with a back stack.
 *
 * Theme: WM 6.1 draws its chrome from a handful of colour roles (HKLM\Software\Microsoft\Color);
 * here every role is derived from the workspace colour (--primary-color) with the hue, saturation
 * and lightness relations measured on the device's green theme (applyTheme).
 */
(function () {
    'use strict';

    const root = document.documentElement;
    if (window.uiShell !== 'mobile' || !root.classList.contains('ui-mobile')) return;

    const ART = '/static_images/wm61/';
    const art = (name) => `${ART}${name}.png`;
    const art2x = (name) => `${ART}${name}@2x.png`;
    const imgTag = (name, alt = '') => `<img src="${art(name)}" srcset="${art(name)} 1x, ${art2x(name)} 2x" alt="${alt}" draggable="false">`;
    const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const apps = new Map();
    const stack = [];
    let shell = null;
    let current = null;
    let openPopup = null;

    // ---------------------------------------------------------------- theme

    // Roles on the device's green theme (Windows Mobile 6.1.tsk, VGA, sampled 2x): saturation and
    // lightness as WM drew them. WM's green also shifts hue between roles (soft keys sit ~28 deg
    // toward yellow, the title ~17 deg toward blue); those shifts made a teal workspace's soft keys
    // green, so dh is kept for reference and applied at HUE_SHIFT_SHARE only.
    const HUE_SHIFT_SHARE = 0;
    const ROLES = {
        '--wm-title': { dh: 17, s: 100, l: 14.5 },
        '--wm-highlight': { dh: 0, s: 64, l: 51 },
        '--wm-menu-text': { dh: 1, s: 88, l: 26 },
        '--wm-tint': { dh: -3, s: 40, l: 86 },
        '--wm-tab-strip': { dh: -3, s: 42, l: 86 },
        '--wm-gloss-top': { dh: -29, s: 55, l: 79 },
        '--wm-gloss-bottom': { dh: -30, s: 45, l: 47 },
        '--wm-softkey-base': { dh: -28, s: 81, l: 33 },
        '--wm-today-rule': { dh: -26, s: 84, l: 40 },
        '--wm-start-rule': { dh: -28, s: 88, l: 26 },
        '--wm-button-border': { dh: -22, s: 81, l: 17 },
        '--wm-button-light': { dh: -27, s: 61, l: 56 }
    };
    const REF_SATURATION = 64;

    function cssColorToRgb(value) {
        const probe = document.createElement('span');
        probe.style.color = value;
        probe.style.display = 'none';
        document.body.appendChild(probe);
        const rgb = getComputedStyle(probe).color;
        probe.remove();
        const m = rgb.match(/[\d.]+/g);
        return m && m.length >= 3 ? { r: +m[0], g: +m[1], b: +m[2] } : null;
    }

    function rgbToHsl({ r, g, b }) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b), min = Math.min(r, g, b);
        const l = (max + min) / 2;
        let h = 0, s = 0;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            if (max === r) h = (g - b) / d + (g < b ? 6 : 0);
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
        }
        return { h, s: s * 100, l: l * 100 };
    }

    /** WM roles from one workspace colour: its hue, its saturation relative to WM's green. */
    function deriveRoles(color) {
        const rgb = color && cssColorToRgb(color);
        if (!rgb) return null;
        const base = rgbToHsl(rgb);
        // a grey workspace gives a grey phone; a vivid one is capped a little above WM's own green
        const k = Math.max(0, Math.min(1.25, base.s / REF_SATURATION));
        const out = {};
        for (const [name, role] of Object.entries(ROLES)) {
            const h = ((base.h + role.dh * HUE_SHIFT_SHARE * Math.min(1, k)) % 360 + 360) % 360;
            const s = Math.min(100, role.s * k);
            out[name] = `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${role.l}%)`;
        }
        return out;
    }

    function applyTheme() {
        const color = getComputedStyle(document.body).getPropertyValue('--primary-color').trim();
        const roles = deriveRoles(color);
        if (!roles) return;
        for (const [name, value] of Object.entries(roles)) root.style.setProperty(name, value);
    }

    function watchTheme() {
        applyTheme();
        new MutationObserver(applyTheme).observe(document.body, { attributes: true, attributeFilter: ['data-workspace', 'style'] });
        const link = document.getElementById('workspace-styles');
        if (link) {
            link.addEventListener('load', applyTheme);
            new MutationObserver(() => setTimeout(applyTheme, 50)).observe(link, { attributes: true, attributeFilter: ['href'] });
        }
        // workspaceUtils swaps the stylesheet link node itself on a live theme update
        new MutationObserver((records) => {
            for (const r of records) {
                for (const n of r.addedNodes) {
                    if (n.id === 'workspace-styles') { n.addEventListener('load', applyTheme); setTimeout(applyTheme, 50); }
                }
            }
        }).observe(document.head, { childList: true });
    }

    // ---------------------------------------------------------------- frame

    function build() {
        shell = document.createElement('div');
        shell.id = 'wmShell';
        shell.innerHTML = `
            <header class="wm-titlebar">
                <button type="button" class="wm-start" aria-label="Start" aria-haspopup="menu" aria-expanded="false">
                    <img src="/static_images/melaton/melaton-white-256.png" alt="" draggable="false">
                </button>
                <div class="wm-title" role="heading" aria-level="1">Start</div>
                <div class="wm-status">
                    <span class="wm-status-icon" data-role="data" data-icon="data-off" title="Not connected"></span>
                    <span class="wm-status-icon" data-role="volume" data-icon="volume"></span>
                </div>
                <button type="button" class="wm-title-action" data-kind="close" aria-label="Close" hidden></button>
            </header>
            <main class="wm-content"></main>
            <footer class="wm-softkeys">
                <button type="button" class="wm-softkey" data-side="left"></button>
                <button type="button" class="wm-sip" aria-label="Input panel">${imgTag('sip-keyboard')}</button>
                <button type="button" class="wm-softkey" data-side="right"></button>
            </footer>
            <nav class="wm-startmenu" role="menu" hidden></nav>
            <div class="wm-popup" role="menu" hidden></div>
            <div class="wm-msgbox-layer" hidden></div>`;
        document.body.appendChild(shell);

        shell.querySelector('.wm-start').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStartMenu();
        });
        shell.querySelector('.wm-title-action').addEventListener('click', () => {
            const app = current && apps.get(current);
            if (app && typeof app.onTitleAction === 'function' && app.onTitleAction() === false) return;
            back();
        });
        shell.querySelectorAll('.wm-softkey').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                pressSoftKey(btn.dataset.side, btn);
            });
        });
        shell.querySelector('.wm-sip').addEventListener('click', () => {
            const input = shell.querySelector('.wm-content input:not([type=hidden]), .wm-content textarea, .wm-searchbar:not([hidden]) input');
            if (input) input.focus();
        });
        document.addEventListener('click', (e) => {
            if (!openPopup || openPopup.contains(e.target)) return;
            // Start and the soft keys toggle their own menus: closing here first would let
            // their click handler open the menu again
            if (e.target.closest && e.target.closest('#wmShell .wm-start, #wmShell .wm-softkey')) return;
            closeMenus();
        }, true);
        document.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && openPopup) { closeMenus(); e.preventDefault(); }
        });
        // The phone's back button / gesture walks the app stack instead of leaving the page. One
        // history entry ({ wm: 'app' }) sits above the page's own while an app is open (syncHistory).
        history.replaceState(Object.assign({}, history.state, { wm: 'root' }), '');
    }

    /**
     * popstate, called first by exitConfirmation.js's listener (listeners on window run in the
     * order they were added, so the shell cannot run ahead of it on its own). true = the pop was
     * the shell's: no "leave the application?" prompt.
     */
    function onPopState() {
        if (!shell) return false;
        if (ignorePops > 0) {
            ignorePops--;
            // an app opened while this pop was pending gets its entry back
            if (!ignorePops) syncHistory();
            return true;
        }
        if (openPopup) {
            closeMenus();
            syncHistory();
            return true;
        }
        if (stack.length > 1) {
            stack.pop();
            activate(stack[stack.length - 1]);
            syncHistory();
            return true;
        }
        return false;
    }

    function setTitle(text) {
        shell.querySelector('.wm-title').textContent = text;
    }

    function setTitleAction(kind) {
        const btn = shell.querySelector('.wm-title-action');
        btn.hidden = !kind;
        if (!kind) return;
        btn.dataset.kind = kind;
        btn.setAttribute('aria-label', kind === 'ok' ? 'OK' : 'Close');
    }

    // ---------------------------------------------------------------- soft keys

    let softKeys = { left: null, right: null };

    function renderSoftKeys() {
        const app = current && apps.get(current);
        softKeys = (app && typeof app.softKeys === 'function' ? app.softKeys() : null) || { left: null, right: null };
        for (const side of ['left', 'right']) {
            const btn = shell.querySelector(`.wm-softkey[data-side="${side}"]`);
            const key = softKeys[side];
            btn.textContent = key ? key.label : '';
            btn.disabled = !key || !!key.disabled;
            btn.setAttribute('aria-haspopup', key && key.menu ? 'menu' : 'false');
            btn.setAttribute('aria-expanded', 'false');
        }
        shell.querySelector('.wm-sip').hidden = !(app && app.sip);
    }

    function pressSoftKey(side, btn) {
        const key = softKeys[side];
        if (!key || key.disabled) return;
        if (key.menu) {
            if (openPopup && openPopup.dataset.side === side) { closeMenus(); return; }
            showPopup(side, typeof key.menu === 'function' ? key.menu() : key.menu, btn);
            return;
        }
        closeMenus();
        btn.classList.add('is-pressed');
        setTimeout(() => btn.classList.remove('is-pressed'), 120);
        if (typeof key.action === 'function') key.action();
    }

    function showPopup(side, items, btn) {
        closeMenus();
        const pop = shell.querySelector('.wm-popup');
        pop.dataset.side = side;
        pop.innerHTML = '';
        for (const item of items) {
            if (item === '-' || item.separator) {
                pop.insertAdjacentHTML('beforeend', '<div class="wm-popup-sep" role="separator"></div>');
                continue;
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'wm-popup-item';
            b.setAttribute('role', item.checked != null ? 'menuitemcheckbox' : 'menuitem');
            if (item.checked != null) b.setAttribute('aria-checked', item.checked ? 'true' : 'false');
            b.textContent = item.label;
            b.disabled = !!item.disabled;
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenus();
                if (typeof item.action === 'function') item.action();
            });
            pop.appendChild(b);
        }
        pop.hidden = false;
        openPopup = pop;
        if (btn) btn.setAttribute('aria-expanded', 'true');
    }

    function closeMenus() {
        shell.querySelector('.wm-popup').hidden = true;
        shell.querySelector('.wm-startmenu').hidden = true;
        shell.querySelector('.wm-start').setAttribute('aria-expanded', 'false');
        shell.querySelectorAll('.wm-softkey').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        openPopup = null;
    }

    // ---------------------------------------------------------------- Start menu

    function toggleStartMenu() {
        const menu = shell.querySelector('.wm-startmenu');
        if (!menu.hidden) { closeMenus(); return; }
        closeMenus();
        const items = [...apps.values()].filter((a) => a.inStart);
        const pinned = items.filter((a) => a.inStart === 'top');
        const lower = items.filter((a) => a.inStart === 'bottom');
        const row = (a) => `<button type="button" class="wm-startmenu-item" role="menuitem" data-app="${escapeHtml(a.id)}">${imgTag(a.icon)}<span>${escapeHtml(a.startLabel || a.title)}</span></button>`;
        menu.innerHTML = pinned.map(row).join('')
            + (lower.length ? '<div class="wm-startmenu-sep" role="separator"></div>' + lower.map(row).join('') : '');
        menu.querySelectorAll('.wm-startmenu-item').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenus();
                open(b.dataset.app, { fromStart: true });
            });
        });
        menu.hidden = false;
        openPopup = menu;
        shell.querySelector('.wm-start').setAttribute('aria-expanded', 'true');
    }

    // ---------------------------------------------------------------- apps

    function registerApp(app) {
        if (!app || !app.id) return;
        apps.set(app.id, Object.assign({ inStart: false, icon: 'app-programs', title: app.id }, app));
    }

    function pageFor(app) {
        if (app.page) return app.page;
        const page = document.createElement('section');
        page.className = 'wm-page';
        page.dataset.app = app.id;
        page.hidden = true;
        shell.querySelector('.wm-content').appendChild(page);
        app.page = page;
        if (typeof app.mount === 'function') app.mount(page);
        return page;
    }

    function activate(id) {
        const app = apps.get(id);
        if (!app) return;
        const prev = current && apps.get(current);
        if (prev && prev !== app) {
            if (prev.page) prev.page.hidden = true;
            if (typeof prev.hide === 'function') prev.hide();
        }
        current = id;
        root.dataset.wmApp = id;
        const page = pageFor(app);
        page.hidden = false;
        // Today's title bar reads "Start"; an app shows its name and the X (or ok) at the right
        setTitle(id === 'today' ? 'Start' : (app.title || id));
        setTitleAction(id === 'today' ? null : (app.titleAction || 'close'));
        if (typeof app.show === 'function') app.show(page);
        renderSoftKeys();
    }

    function open(id, opts = {}) {
        if (!apps.has(id)) return;
        closeMenus();
        // Start menu and Today rows switch apps: the stack keeps Today at the bottom
        if (opts.fromStart || id === 'today') stack.length = 0;
        if (id !== 'today' && !stack.includes('today')) stack.push('today');
        const at = stack.indexOf(id);
        if (at >= 0) stack.length = at;
        stack.push(id);
        activate(id);
        syncHistory();
    }

    function back() {
        closeMenus();
        if (stack.length > 1) stack.pop();
        activate(stack[stack.length - 1] || 'today');
        syncHistory();
    }

    let ignorePops = 0;

    /** Exactly one { wm: 'app' } history entry while an app is open over Today, none on Today. */
    function syncHistory() {
        const want = stack.length > 1;
        const have = !!(history.state && history.state.wm === 'app');
        if (want && !have) {
            history.pushState({ wm: 'app' }, '');
        } else if (!want && have) {
            ignorePops++;
            history.back();
        }
    }

    // ---------------------------------------------------------------- status icons

    function refreshStatus() {
        if (!shell) return;
        const ws = window.wsClient;
        const connected = !!(ws && typeof ws.isConnected === 'function' && ws.isConnected());
        const data = shell.querySelector('[data-role="data"]');
        data.dataset.icon = connected ? 'data-on' : 'data-off';
        data.title = connected ? 'Connected' : 'Not connected';
        const vol = shell.querySelector('[data-role="volume"]');
        let muted = false;
        try { muted = !!(window.tabVolume && typeof window.tabVolume.isMuted === 'function' && window.tabVolume.isMuted()); } catch (_) { /* volume unknown */ }
        vol.dataset.icon = muted ? 'volume-off' : 'volume';
        const today = apps.get('today');
        if (today && typeof today.refresh === 'function' && current === 'today') today.refresh();
    }

    // ---------------------------------------------------------------- message box

    /**
     * WM message box; resolves with the chosen button's value. buttons: [{ text, value }].
     * icon: 'error' | 'warning' | 'info' | 'question' | null.
     */
    function messageBox({ title = 'Melaton Mobile', text = '', icon = null, buttons = [{ text: 'ok', value: true }], cancelValue = false, input = null } = {}) {
        return new Promise((resolve) => {
            const layer = shell.querySelector('.wm-msgbox-layer');
            const okOnly = buttons.length === 1;
            layer.innerHTML = `
                <div class="wm-msgbox" role="alertdialog" aria-modal="true">
                    <div class="wm-msgbox-title"><span>${escapeHtml(title)}</span>${okOnly ? '<button type="button" class="wm-title-action" data-kind="ok" aria-label="OK"></button>' : ''}</div>
                    <div class="wm-msgbox-body">${icon ? imgTag(`msgbox-${icon}`) : ''}<div class="wm-msgbox-text"></div></div>
                    ${okOnly ? '' : '<div class="wm-msgbox-buttons"></div>'}
                </div>`;
            layer.querySelector('.wm-msgbox-text').textContent = text;
            let field = null;
            if (input) {
                // an edit box under the text: the result is the trimmed text for a truthy button value
                field = document.createElement('input');
                field.type = 'text';
                field.className = 'wm-msgbox-input';
                field.value = input.value || '';
                field.placeholder = input.placeholder || '';
                field.autocomplete = 'off';
                layer.querySelector('.wm-msgbox-text').appendChild(field);
                field.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); done(buttons[0].value); }
                });
            }
            const done = (value) => {
                if (field) value = value ? field.value.trim() : null;
                layer.hidden = true;
                layer.innerHTML = '';
                document.removeEventListener('keydown', onKey, true);
                resolve(value);
            };
            const onKey = (e) => {
                if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); done(cancelValue); }
            };
            document.addEventListener('keydown', onKey, true);
            if (okOnly) {
                layer.querySelector('.wm-title-action').addEventListener('click', () => done(buttons[0].value));
            } else {
                const row = layer.querySelector('.wm-msgbox-buttons');
                for (const b of buttons) {
                    const el = document.createElement('button');
                    el.type = 'button';
                    el.textContent = b.text;
                    el.addEventListener('click', () => done(b.value));
                    row.appendChild(el);
                }
            }
            layer.hidden = false;
            const first = field || layer.querySelector('button');
            if (first) first.focus();
        });
    }

    // ---------------------------------------------------------------- built-in apps

    function registerTodayApp() {
        const fmtDate = new Intl.DateTimeFormat(undefined, { month: 'long', day: '2-digit', year: 'numeric' });
        const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
        const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
        registerApp({
            id: 'today',
            title: 'Today',
            icon: 'app-today',
            inStart: 'top',
            mount(page) {
                page.classList.add('wm-today');
                page.innerHTML = `
                    <button type="button" class="wm-today-row wm-today-date" data-row="date">
                        ${imgTag('today-clock')}
                        <span class="wm-today-text"><span data-f="day"></span><br><span data-f="date"></span></span>
                        <span class="wm-today-time" data-f="time"></span>
                    </button>
                    <button type="button" class="wm-today-row" data-row="connection">
                        ${imgTag('today-phone')}<span class="wm-today-text" data-f="connection"></span>
                    </button>
                    <button type="button" class="wm-today-row" data-row="workspace">
                        ${imgTag('today-owner')}<span class="wm-today-text workspace-name" data-f="workspace"></span>
                    </button>
                    <button type="button" class="wm-today-row is-plain" data-row="gallery">
                        ${imgTag('app-pictures')}<span class="wm-today-text">Pictures</span>
                    </button>`;
                page.querySelector('[data-row="gallery"]').addEventListener('click', () => open('gallery'));
            },
            show() { this.refresh(); },
            refresh() {
                const page = this.page;
                if (!page) return;
                const now = new Date();
                page.querySelector('[data-f="day"]').textContent = fmtDay.format(now);
                page.querySelector('[data-f="date"]').textContent = fmtDate.format(now);
                page.querySelector('[data-f="time"]').textContent = fmtTime.format(now);
                const ws = window.wsClient;
                const connected = !!(ws && typeof ws.isConnected === 'function' && ws.isConnected());
                page.querySelector('[data-f="connection"]').textContent = connected ? 'Connected' : 'Not connected';
                const wsEl = page.querySelector('[data-f="workspace"]');
                try {
                    // workspaceUtils keeps every .workspace-name in step on later switches
                    if (typeof workspaces !== 'undefined' && typeof activeWorkspace !== 'undefined' && workspaces[activeWorkspace]) {
                        wsEl.textContent = workspaces[activeWorkspace].name;
                    }
                } catch (_) { /* workspaces not loaded yet */ }
                if (!wsEl.textContent) wsEl.textContent = 'Workspace';
            },
            softKeys() {
                return {
                    left: { label: 'Pictures', action: () => open('gallery') },
                    right: null
                };
            }
        });
    }

    function registerGalleryApp() {
        const VIEWS = [['images', 'Images'], ['scraps', 'Scraps'], ['pinned', 'Pinned'], ['upscaled', 'Upscaled']];
        let searchBar = null;
        let searchSubmitted = false; // a search ran since the bar opened: Cancel must clear it
        const activeView = () => {
            const b = document.querySelector('#galleryWindow .gallery-toggle-group .gallery-toggle-btn.active');
            return b ? b.dataset.view : 'images';
        };
        const setSearch = (on) => {
            if (!searchBar) {
                searchBar = document.createElement('div');
                searchBar.className = 'wm-searchbar';
                searchBar.hidden = true;
                searchBar.innerHTML = '<input type="search" enterkeyhint="search" autocomplete="off" aria-label="Search pictures">';
                const input = searchBar.querySelector('input');
                const target = () => document.getElementById('fileSearchInput');
                input.addEventListener('input', () => {
                    const t = target();
                    if (!t) return;
                    t.value = input.value;
                    t.dispatchEvent(new Event('input', { bubbles: true }));
                });
                input.addEventListener('keydown', (e) => {
                    const t = target();
                    if (!t) return;
                    if (e.key === 'Enter') {
                        e.preventDefault();
                        searchSubmitted = true;
                        t.value = input.value;
                        t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
                        input.blur();
                    } else if (e.key === 'Escape') {
                        e.preventDefault();
                        setSearch(false);
                    }
                });
                shell.appendChild(searchBar);
            }
            searchBar.hidden = !on;
            root.dataset.wmSearch = on ? '1' : '0';
            if (on) {
                searchBar.querySelector('input').focus();
            } else {
                // Cancel always ends the search, also after the box was cleared by hand: emptying
                // the box resets fileSearch's query but keeps the filtered results on screen
                // (fileSearch.clearSearch restores the unfiltered gallery)
                searchBar.querySelector('input').value = '';
                const t = document.getElementById('fileSearchInput');
                const fs = window.fileSearch;
                const active = searchSubmitted || !!((fs && fs.currentQuery) || (t && t.value));
                searchSubmitted = false;
                if (t) t.value = '';
                if (active) {
                    if (fs && typeof fs.clearSearch === 'function') fs.clearSearch(true, true);
                    else if (t) t.dispatchEvent(new Event('change', { bubbles: true }));
                }
            }
            renderSoftKeys();
        };
        registerApp({
            id: 'gallery',
            title: 'Pictures',
            startLabel: 'Pictures & Videos',
            icon: 'app-pictures',
            inStart: 'top',
            show() {
                const gw = document.getElementById('galleryWindow');
                if (gw) gw.classList.remove('hidden');
                if (typeof updateGalleryGrid === 'function') {
                    try { updateGalleryGrid(true, true); } catch (_) { /* gallery not ready */ }
                }
            },
            hide() {
                if (searchBar && !searchBar.hidden) setSearch(false);
            },
            onTitleAction() {
                if (searchBar && !searchBar.hidden) { setSearch(false); return false; }
                return true;
            },
            softKeys() {
                const searching = !!(searchBar && !searchBar.hidden);
                return {
                    left: searching ? { label: 'Cancel', action: () => setSearch(false) } : { label: 'Search', action: () => setSearch(true) },
                    right: {
                        label: 'Menu',
                        menu: () => {
                            const view = activeView();
                            return VIEWS.map(([v, label]) => ({
                                label,
                                checked: view === v,
                                action: () => {
                                    const b = document.querySelector(`#galleryWindow .gallery-toggle-group .gallery-toggle-btn[data-view="${v}"]`);
                                    if (b) b.click();
                                }
                            }));
                        }
                    }
                };
            }
        });
    }

    // ---------------------------------------------------------------- takeover

    // Surfaces that must own the screen on a phone (wm-shell.css lets them through): while one is
    // shown, html[data-wm-takeover] makes the shell and everything it hosts step aside, so the
    // desktop-made screen and the WM shell are never on screen together.
    const TAKEOVER = ['pinModal', 'dreamscapeFatalErrorRoot', 'dreamscapeConnectivityErrorOverlay', 'dreamscapeConnectivityErrorWindow', 'agentClientUpdateDialog'];

    function shown(el) {
        return !!(el && !el.classList.contains('hidden') && getComputedStyle(el).display !== 'none');
    }

    function checkTakeover() {
        let on = TAKEOVER.some((id) => shown(document.getElementById(id)));
        if (!on) {
            for (const el of document.querySelectorAll('body > .dreamscape-app-error-window')) {
                if (shown(el)) { on = true; break; }
            }
        }
        if (on) {
            if (!root.hasAttribute('data-wm-takeover')) { closeMenus(); root.setAttribute('data-wm-takeover', ''); }
        } else if (root.hasAttribute('data-wm-takeover')) {
            root.removeAttribute('data-wm-takeover');
        }
    }

    // ---------------------------------------------------------------- boot

    function init() {
        build();
        registerTodayApp();
        registerGalleryApp();
        watchTheme();
        stack.push('today');
        activate('today');
        refreshStatus();
        setInterval(refreshStatus, 2000);
        checkTakeover();
        setInterval(checkTakeover, 400);
        document.dispatchEvent(new CustomEvent('wmShellReady'));
    }

    window.wmShell = {
        registerApp,
        open,
        back,
        messageBox,
        applyTheme,
        onPopState,
        deriveRoles,
        get current() { return current; }
    };

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
