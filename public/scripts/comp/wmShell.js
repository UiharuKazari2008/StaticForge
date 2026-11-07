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
    const THEME_CACHE_KEY = 'wmThemeRoles';

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
        // before the workspace is known --primary-color is the page default: keep the cached roles
        if (!document.body.dataset.workspace) return;
        const color = getComputedStyle(document.body).getPropertyValue('--primary-color').trim();
        const roles = deriveRoles(color);
        if (!roles) return;
        for (const [name, value] of Object.entries(roles)) root.style.setProperty(name, value);
        try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(roles)); } catch (_) { /* storage off */ }
    }

    /** The last workspace theme, so the splash already has it before the workspace CSS loads. */
    function applyCachedTheme() {
        try {
            const roles = JSON.parse(localStorage.getItem(THEME_CACHE_KEY) || 'null');
            if (roles) for (const [name, value] of Object.entries(roles)) root.style.setProperty(name, value);
        } catch (_) { /* no cache */ }
    }

    function watchTheme() {
        applyCachedTheme();
        // the workspace stylesheet sets --primary-color once the workspace is known; before that
        // the cached roles stay (applyTheme ignores the page default until data-workspace is set)
        if (document.body.dataset.workspace) applyTheme();
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
            if (viewerActive) { closeViewer(); return; }
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
            if (e.target.closest && e.target.closest('#wmShell .wm-start, #wmShell .wm-softkey, #wmShell [aria-haspopup="menu"]')) return;
            closeMenus();
        }, true);
        window.addEventListener('keydown', (e) => {
            if (e.key === 'Escape' && openPopup) {
                const sub = openPopup.querySelector(':scope > .wm-popup-sub');
                if (sub) { closeSubmenu(openPopup); syncHistory(); } else closeMenus();
                e.preventDefault();
                e.stopImmediatePropagation(); // the picture behind the menu stays open
            }
        }, true);
        // The phone's back button / gesture walks the app stack instead of leaving the page. One
        // history entry per open layer sits above the page's own (syncHistory).
        history.replaceState(Object.assign({}, history.state, { wm: 'root', n: 0 }), '');
    }

    /**
     * popstate, called first by exitConfirmation.js's listener (listeners on window run in the
     * order they were added, so the shell cannot run ahead of it on its own). true = the pop was
     * the shell's: no "leave the application?" prompt.
     */
    function onPopState() {
        if (!shell) return false;
        if (ignorePops > 0) {
            // our own history.go(): the layers already match
            ignorePops--;
            if (!ignorePops) syncHistory();
            return true;
        }
        // the user went back one step: close the top layer (menu, then the picture view, then the
        // app). Nothing is pushed here: Chrome on Android skips entries added without a tap, so
        // entries are only added when something is opened.
        let closed = false;
        const sub = openPopup && openPopup.querySelector(':scope > .wm-popup-sub');
        if (sub) {
            // back steps out of a submenu to its parent menu (the parent keeps its entry)
            closeSubmenu(openPopup);
            closed = true;
        } else if (openPopup) {
            closeMenus(true);
            closed = true;
        } else if (viewerActive && !viewerClosing) {
            viewerClosing = true;
            closeViewer();
            closed = true;
        } else if (stack.length > 1) {
            const app = apps.get(current);
            // the app's own steps first (File Explorer goes back a folder)
            if (!(app && typeof app.onBack === 'function' && app.onBack())) {
                stack.pop();
                activate(stack[stack.length - 1]);
            }
            closed = true;
        }
        if (closed) syncHistory({ noPush: true });
        return closed;
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
        softKeys = viewerActive ? viewerSoftKeys()
            : ((app && typeof app.softKeys === 'function' ? app.softKeys() : null) || { left: null, right: null });
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

    let popupOnClose = null;

    /** Menu rows: items { label, action, disabled, checked, radio, submenu } or '-' separators. */
    function fillMenu(pop, items) {
        pop.innerHTML = '';
        for (const item of items) {
            if (item === '-' || item.separator) {
                pop.insertAdjacentHTML('beforeend', '<div class="wm-popup-sep" role="separator"></div>');
                continue;
            }
            const b = document.createElement('button');
            b.type = 'button';
            b.className = 'wm-popup-item';
            if (item.radio != null) {
                // WM marks the current choice of a drop-down with a dot
                b.setAttribute('role', 'menuitemradio');
                b.setAttribute('aria-checked', item.radio ? 'true' : 'false');
                b.classList.add('is-radio');
            } else {
                b.setAttribute('role', item.checked != null ? 'menuitemcheckbox' : 'menuitem');
                if (item.checked != null) b.setAttribute('aria-checked', item.checked ? 'true' : 'false');
            }
            b.textContent = item.label;
            b.disabled = !!item.disabled;
            if (item.submenu) {
                b.classList.add('has-submenu');
                b.setAttribute('aria-haspopup', 'menu');
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    openSubmenu(pop, b, typeof item.submenu === 'function' ? item.submenu() : item.submenu);
                });
            } else {
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    closeMenus();
                    if (typeof item.action === 'function') item.action();
                });
            }
            pop.appendChild(b);
        }
    }

    /**
     * WM submenu (Menu > Edit ▸ on the device): opens to the left over its parent, its bottom on
     * the row that opened it. It lives inside the parent popup, so taps in it count as inside.
     */
    function closeSubmenu(parentPop) {
        parentPop.querySelectorAll(':scope > .wm-popup-sub').forEach((n) => n.remove());
        parentPop.querySelectorAll('.wm-popup-item.is-open').forEach((n) => n.classList.remove('is-open'));
    }

    function openSubmenu(parentPop, row, items) {
        // a second tap on the row that opened it closes the submenu
        if (row.classList.contains('is-open')) { closeSubmenu(parentPop); syncHistory(); return; }
        const hadSub = !!parentPop.querySelector(':scope > .wm-popup-sub');
        closeSubmenu(parentPop);
        const sub = document.createElement('div');
        sub.className = 'wm-popup wm-popup-sub';
        sub.setAttribute('role', 'menu');
        fillMenu(sub, items.length ? items : [{ label: '(empty)', disabled: true }]);
        parentPop.appendChild(sub);
        row.classList.add('is-open');
        const pr = parentPop.getBoundingClientRect();
        const rr = row.getBoundingClientRect();
        const sw = sub.offsetWidth;
        const sh = sub.offsetHeight;
        let left = pr.left + pr.width * 0.35 - sw;
        if (left < 2) left = Math.min(pr.right - pr.width * 0.35, window.innerWidth - sw - 2);
        let top = rr.bottom - sh;
        top = Math.max(2, Math.min(top, window.innerHeight - sh - 2));
        sub.style.left = `${Math.max(2, left)}px`;
        sub.style.top = `${top}px`;
        if (!hadSub) syncHistory();
    }

    function showPopup(side, items, btn) {
        closeMenus(true);
        const pop = shell.querySelector('.wm-popup');
        pop.dataset.side = side;
        pop.style.top = pop.style.left = pop.style.right = pop.style.bottom = '';
        fillMenu(pop, items);
        pop.hidden = false;
        openPopup = pop;
        if (btn) btn.setAttribute('aria-expanded', 'true');
        syncHistory();
    }

    /** A WM drop-down: the popup hangs under its control (folder bar, combo). */
    let dropdownAnchor = null;

    function showDropdown(anchor, items, align = 'left', onClose = null) {
        // a second tap on the same control closes its drop-down
        if (openPopup && openPopup.dataset.side === 'dropdown' && dropdownAnchor === anchor) { closeMenus(); return; }
        showPopup('dropdown', items, anchor);
        dropdownAnchor = anchor;
        const pop = shell.querySelector('.wm-popup');
        const r = anchor.getBoundingClientRect();
        const sr = shell.getBoundingClientRect();
        pop.style.bottom = 'auto';
        pop.style.top = `${r.bottom - sr.top}px`;
        if (align === 'right') { pop.style.left = 'auto'; pop.style.right = `${sr.right - r.right}px`; } else { pop.style.right = 'auto'; pop.style.left = `${r.left - sr.left}px`; }
        popupOnClose = onClose;
    }

    function closeMenus(silent) {
        const had = !!openPopup;
        shell.querySelector('.wm-popup').hidden = true;
        dropdownAnchor = null;
        if (popupOnClose) { const fn = popupOnClose; popupOnClose = null; fn(); }
        shell.querySelector('.wm-startmenu').hidden = true;
        shell.querySelector('.wm-start').setAttribute('aria-expanded', 'false');
        shell.querySelectorAll('.wm-softkey').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        openPopup = null;
        if (had && !silent) syncHistory();
    }

    // ---------------------------------------------------------------- Start menu

    function toggleStartMenu() {
        const menu = shell.querySelector('.wm-startmenu');
        if (!menu.hidden) { closeMenus(); return; }
        closeMenus(true);
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
        syncHistory();
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
        closeMenus(true);
        // an app opened over the picture view (Start menu) replaces it
        if (viewerActive) { viewerClosing = true; closeViewer(); }
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
        closeMenus(true);
        if (stack.length > 1) stack.pop();
        activate(stack[stack.length - 1] || 'today');
        syncHistory();
    }

    let ignorePops = 0;
    let syncQueued = false;
    let syncNoPush = false;

    /** One history entry per open layer: each app over Today, an open menu, the picture view. */
    function desiredDepth() {
        const sub = openPopup && openPopup.querySelector(':scope > .wm-popup-sub') ? 1 : 0;
        // an app can hold back steps of its own (File Explorer: the folders visited)
        const app = current && current !== 'today' && apps.get(current);
        const own = app && typeof app.historyDepth === 'function' ? Math.max(0, Number(app.historyDepth()) || 0) : 0;
        return Math.max(0, stack.length - 1) + own + (openPopup ? 1 + sub : 0) + (viewerActive && !viewerClosing ? 1 : 0);
    }

    function historyDepth() {
        const st = history.state;
        return st && st.wm === 'layer' ? Number(st.n) || 0 : 0;
    }

    /**
     * Bring history in line with the open layers, once per task (a menu closing and an app opening
     * in the same tap cancel out). Entries are pushed only outside popstate (after a tap).
     */
    function syncHistory(opts) {
        if (opts && opts.noPush) syncNoPush = true;
        if (syncQueued) return;
        syncQueued = true;
        queueMicrotask(() => {
            syncQueued = false;
            const noPush = syncNoPush;
            syncNoPush = false;
            if (ignorePops > 0) return;
            const want = desiredDepth();
            const have = historyDepth();
            if (want > have && !noPush) {
                for (let n = have + 1; n <= want; n++) history.pushState({ wm: 'layer', n }, '');
            } else if (want < have) {
                ignorePops++;
                history.go(want - have);
            }
        });
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

    const TODAY_BG_KEY = 'wmTodayBackground';

    /** Today's picture (Pictures > Menu > Set as Today Background), over the workspace background. */
    function applyTodayBackground() {
        const today = apps.get('today');
        if (!today || !today.page) return;
        let url = null;
        try { url = localStorage.getItem(TODAY_BG_KEY); } catch (_) { /* storage off */ }
        // only a same-site path is used
        if (url && !/^\/[^/]/.test(url)) url = null;
        const set = (u) => {
            today.page.style.backgroundImage = u ? `url("${u.replace(/["\\\n]/g, encodeURIComponent)}")` : '';
            today.page.classList.toggle('has-picture', !!u);
        };
        set(url);
        if (url) {
            // a picture that no longer loads falls back to the workspace background
            const probe = new Image();
            probe.onerror = () => set(null);
            probe.src = url;
        }
    }

    function hasTodayBackground() {
        try { return !!localStorage.getItem(TODAY_BG_KEY); } catch (_) { return false; }
    }

    /** The viewer's zoom origin: the tapped print's tile on screen, else nothing (fade). */
    function thumbFor(name) {
        if (!shell || !name) return undefined;
        const sel = `[data-filename="${CSS.escape(name)}"]`;
        const el = shell.querySelector(`.wm-page:not([hidden]) .wm-photo${sel} img, .wm-page:not([hidden]) .wm-today-print${sel}`);
        if (!el) return undefined;
        const r = el.getBoundingClientRect();
        if (r.width < 2 || r.height < 2 || r.bottom < 0 || r.top > window.innerHeight) return undefined;
        return el;
    }

    // ---------------------------------------------------------------- built-in apps

    /** The workspaces as menu items, the active one with WM's dot (Today and Pictures menus). */
    function workspaceItems() {
        let list = [];
        try {
            if (typeof workspaces !== 'undefined') {
                list = Object.values(workspaces).filter(Boolean).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
            }
        } catch (_) { /* not loaded */ }
        const active = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        if (!list.length) return [{ label: 'No workspaces', disabled: true }];
        return list.map((w) => ({
            label: w.name || w.id,
            radio: w.id === active,
            action: () => { if (w.id !== active && typeof setActiveWorkspace === 'function') setActiveWorkspace(w.id); }
        }));
    }

    /** Preview URL for a gallery row, resolved the way the gallery's own tiles are (galleryView.js). */
    function previewUrl(item) {
        try {
            if (typeof resolveGalleryPreviewUrl === 'function') {
                const u = resolveGalleryPreviewUrl(item);
                if (u) return u;
            }
            if (item.preview) {
                const p = typeof getGalleryPreviewUrl === 'function' ? getGalleryPreviewUrl(item.preview) : item.preview;
                return `/previews/${encodeURIComponent(p)}`;
            }
        } catch (_) { /* no preview */ }
        return '';
    }

    // Today: the WM 6.1 Today items mapped to Dreamscape. WM: date/time, Wireless ("Phone off"),
    // Owner, Messages, Tasks, Calendar, Live Search, Device Lock. Here: date/time, connection
    // (and install / update progress), owner = the Melaton account, Messages = Dovecote unread,
    // Tasks = this phone's prints in flight, Calendar = NovelAI Anlas and subscription, Live
    // Search = gallery search, workspace, and the newest prints.
    function registerTodayApp() {
        const fmtDate = new Intl.DateTimeFormat(undefined, { month: 'long', day: '2-digit', year: 'numeric' });
        const fmtDay = new Intl.DateTimeFormat(undefined, { weekday: 'long' });
        const fmtTime = new Intl.DateTimeFormat(undefined, { hour: 'numeric', minute: '2-digit' });
        const fmtRenew = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' });
        const TIERS = ['Paper', 'Tablet', 'Scroll', 'Opus'];
        const GEN_TYPES = new Set(['generate_image', 'generate_preset', 'reroll_image', 'upscale_image', 'expand_image', 'reroll_expanded_image', 'enhance_image', 'max_enhance_image', 'animate_image']);
        let mailUnread = null;
        let mailLoading = false;
        let mailFailedAt = 0; // a failed request waits 45 s before the next try
        let recentKey = '';

        const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

        async function loadMail() {
            if (mailLoading || Date.now() - mailFailedAt < 45000) return;
            const ws = window.wsClient;
            if (!ws || typeof ws.isConnected !== 'function' || !ws.isConnected()) return;
            mailLoading = true;
            let ok = false;
            try {
                const r = await ws.sendMessage('dovecote_list_mailboxes', {}, false);
                const boxes = (r && (r.mailboxes || (r.data && r.data.mailboxes))) || [];
                const owner = typeof DESKTOP_DOVECOTE_HUMAN_OWNER !== 'undefined' ? DESKTOP_DOVECOTE_HUMAN_OWNER : 'yukimi';
                const mine = boxes.find((b) => b.owner === owner);
                mailUnread = mine ? (mine.unread || 0) : 0;
                ok = true;
            } catch (_) { /* mail unavailable: the row keeps its last text */ }
            mailLoading = false;
            if (!ok) { mailFailedAt = Date.now(); return; }
            mailFailedAt = 0;
            if (current === 'today') today.refresh();
        }

        function connectionText() {
            const ws = window.wsClient;
            const swm = window.serviceWorkerManager;
            if (swm && swm.bootComplete === false && swm._bootOrchestrating && Number(swm.updateProgress) > 0 && Number(swm.updateProgress) < 100) {
                return { text: `Installing... ${Math.round(swm.updateProgress)}%`, plain: false };
            }
            if (!ws) return { text: 'Not connected', plain: false };
            if (ws.isConnected() && ws.initializationCompleted) return { text: 'Connected', plain: false };
            if (ws.isConnected()) return { text: 'Connecting...', plain: false };
            if (ws.connectionPhase === 'failed') return { text: 'Not connected', plain: false, tap: 'reconnect' };
            return { text: (ws.connectionUi && ws.connectionUi.message) || 'Connecting...', plain: false };
        }

        function tasksText() {
            const ws = window.wsClient;
            let n = 0;
            if (ws && ws.pendingRequests && typeof ws.pendingRequests.forEach === 'function') {
                ws.pendingRequests.forEach((req) => { if (req && GEN_TYPES.has(req.type)) n++; });
            }
            return n ? `${n} ${n === 1 ? 'print' : 'prints'} in progress` : 'No tasks';
        }

        function novelAiText() {
            const o = window.optionsData;
            if (!o) return '';
            const parts = [];
            const bal = o.balance && Number(o.balance.totalCredits);
            if (Number.isFinite(bal) && bal >= 0) parts.push(`${bal.toLocaleString()} Anlas`);
            const sub = o.user && o.user.subscription;
            if (sub && Number.isFinite(Number(sub.tier))) {
                let t = TIERS[Number(sub.tier)] || 'Subscription';
                if (sub.expiresAt) t += ` until ${fmtRenew.format(new Date(Number(sub.expiresAt) * 1000))}`;
                parts.push(t);
            }
            return parts.join(', ');
        }

        function newestPrints(n) {
            let list = [];
            try {
                // the full list is kept in originalAllImages while a gallery search filters allImages
                if (Array.isArray(window.originalAllImages) && window.originalAllImages.length) list = window.originalAllImages;
                else if (typeof allImages !== 'undefined' && Array.isArray(allImages)) list = allImages;
            } catch (_) { /* gallery not loaded yet */ }
            return list.slice(0, n);
        }


        const today = {
            id: 'today',
            title: 'Today',
            icon: 'app-today',
            inStart: 'top',
            mount(page) {
                page.classList.add('wm-today');
                page.innerHTML = `
                    <div class="wm-today-row wm-today-date" data-row="date">
                        ${imgTag('today-clock')}
                        <span class="wm-today-text"><span data-f="day"></span><br><span data-f="date"></span></span>
                        <span class="wm-today-time" data-f="time"></span>
                    </div>
                    <button type="button" class="wm-today-row" data-row="connection">
                        ${imgTag('today-phone')}<span class="wm-today-text" data-f="connection"></span>
                    </button>
                    <div class="wm-today-row" data-row="owner">
                        ${imgTag('today-owner')}<span class="wm-today-text" data-f="owner"></span>
                    </div>
                    <div class="wm-today-row is-plain" data-row="messages">
                        ${imgTag('today-messages')}<span class="wm-today-text" data-f="messages">Messages</span>
                    </div>
                    <div class="wm-today-row is-plain" data-row="tasks">
                        ${imgTag('today-tasks')}<span class="wm-today-text" data-f="tasks"></span>
                    </div>
                    <div class="wm-today-row is-plain" data-row="novelai" hidden>
                        ${imgTag('today-calendar')}<span class="wm-today-text" data-f="novelai"></span>
                    </div>
                    <form class="wm-today-search" data-row="search" role="search">
                        <input type="search" enterkeyhint="search" autocomplete="off" placeholder="Search pictures" aria-label="Search pictures">
                        <button type="submit" class="wm-today-search-go" aria-label="Search"></button>
                    </form>
                    <button type="button" class="wm-today-row" data-row="workspace">
                        ${imgTag('app-file-explorer')}<span class="wm-today-text workspace-name" data-f="workspace"></span>
                    </button>
                    <div class="wm-today-prints" data-row="prints" hidden></div>`;
                page.querySelector('[data-row="connection"]').addEventListener('click', () => {
                    const ws = window.wsClient;
                    if (ws && !ws.isConnected() && typeof ws.manualReconnect === 'function') ws.manualReconnect();
                });
                page.querySelector('[data-row="workspace"]').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showPopup('right', workspaceMenu(), null);
                });
                page.querySelector('[data-row="search"]').addEventListener('submit', (e) => {
                    e.preventDefault();
                    const input = e.currentTarget.querySelector('input');
                    const q = input.value.trim();
                    input.value = '';
                    input.blur();
                    open('gallery');
                    if (q) {
                        const gallery = apps.get('gallery');
                        if (gallery && typeof gallery.search === 'function') gallery.search(q);
                    }
                });
                page.querySelector('[data-row="prints"]').addEventListener('click', (e) => {
                    const tile = e.target.closest('[data-filename]');
                    if (!tile) return;
                    open('gallery');
                    // the gallery's own viewer (PhotoSwipe), on the print that was tapped
                    try {
                        if (typeof showLightbox === 'function') showLightbox({ filename: tile.dataset.filename });
                    } catch (_) { /* the gallery opens without the viewer */ }
                });
                document.addEventListener('dovecoteMailboxUpdated', (ev) => {
                    const boxes = ev.detail && ev.detail.mailboxes;
                    if (!boxes) { loadMail(); return; }
                    const owner = typeof DESKTOP_DOVECOTE_HUMAN_OWNER !== 'undefined' ? DESKTOP_DOVECOTE_HUMAN_OWNER : 'yukimi';
                    const mine = boxes.find((b) => b.owner === owner);
                    mailUnread = mine ? (mine.unread || 0) : 0;
                    today.refresh();
                });
                window.addEventListener('meletonaccountschange', () => today.refresh());
            },
            show() {
                if (mailUnread == null) loadMail();
                this.refresh();
            },
            refresh() {
                const page = this.page;
                if (!page) return;
                const now = new Date();
                setText(page.querySelector('[data-f="day"]'), fmtDay.format(now));
                setText(page.querySelector('[data-f="date"]'), fmtDate.format(now));
                setText(page.querySelector('[data-f="time"]'), fmtTime.format(now));
                setText(page.querySelector('[data-f="connection"]'), connectionText().text);
                const acc = window.meletonAccounts;
                setText(page.querySelector('[data-f="owner"]'), acc && typeof acc.name === 'function' ? acc.name() : 'Owner');
                if (mailUnread == null) {
                    if (window.wsClient && window.wsClient.initializationCompleted) loadMail();
                } else {
                    setText(page.querySelector('[data-f="messages"]'), mailUnread ? `${mailUnread} unread ${mailUnread === 1 ? 'message' : 'messages'}` : 'No unread messages');
                }
                setText(page.querySelector('[data-f="tasks"]'), tasksText());
                const nai = novelAiText();
                const naiRow = page.querySelector('[data-row="novelai"]');
                naiRow.hidden = !nai;
                setText(page.querySelector('[data-f="novelai"]'), nai);
                const wsEl = page.querySelector('[data-f="workspace"]');
                try {
                    if (typeof workspaces !== 'undefined' && typeof activeWorkspace !== 'undefined' && workspaces[activeWorkspace]) {
                        setText(wsEl, workspaces[activeWorkspace].name);
                    }
                } catch (_) { /* workspaces not loaded yet */ }
                if (!wsEl.textContent) wsEl.textContent = 'Workspace';
                // newest prints: as many square tiles as fit one row
                const strip = page.querySelector('[data-row="prints"]');
                const prints = newestPrints(8);
                const key = prints.map((p) => p.filename || p.preview).join('|');
                if (key !== recentKey) {
                    recentKey = key;
                    strip.innerHTML = prints.map((p) => `<button type="button" class="wm-today-print" data-filename="${escapeHtml(p.filename || p.original || '')}" aria-label="${escapeHtml(p.filename || 'Print')}" style="background-image:url('${escapeHtml(previewUrl(p))}')"></button>`).join('');
                }
                strip.hidden = !prints.length;
            },
            softKeys() {
                return {
                    left: { label: 'Pictures', action: () => open('gallery') },
                    right: { label: 'Menu', menu: () => workspaceMenu().concat(['-', { label: 'Reconnect', disabled: !!(window.wsClient && window.wsClient.isConnected()), action: () => window.wsClient && window.wsClient.manualReconnect() }]) }
                };
            }
        };

        function workspaceMenu() {
            return workspaceItems();
        }

        registerApp(today);
        // switching workspace changes Today's rows, theme and prints
        document.addEventListener('workspaceSwitchComplete', () => { recentKey = ''; today.refresh(); });
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
                // clearSearch reloads the gallery without applyFilteredImages: the grid drops the
                // results itself
                searchResults = null;
                const page = apps.get('gallery') && apps.get('gallery').page;
                if (page) renderGrid(page, true);
            }
            renderSoftKeys();
        };
        // ---- Pictures & Videos (WM 6.1, measured on the emulator, 2x halved): folder bar 22 px
        // (tint, 1 px black rule) with the folder ("My Pictures") and sort ("Date") drop-downs; a
        // grid of 3 equal columns (80 px at 240 px wide), cells 60 px tall, 1 px #BDBEBD rules on
        // the right and bottom, over the theme's white-to-green field; each picture fitted (not
        // cropped) into about 68 x 53 and centred, no label; the selected cell is filled with the
        // highlight colour. Wider screens get more 80 px columns. Soft keys View / Menu.
        let gridTimer = null;
        let gridSig = '';
        let gridView = null;
        let viewSwitchedAt = 0;
        let sortBy = 'date';
        let selectedName = null;
        const SORTS = [['name', 'Name'], ['date', 'Date'], ['size', 'Size']];
        const CHUNK = 60; // cells per content-visibility block

        // Gallery search never filters allImages: fileSearch hands its results (relevance order)
        // to applyFilteredImages(images, indices); ([], []) = nothing found, (all, null) = cleared.
        // Pictures listens there for what to draw.
        let searchResults = null; // null = no search; [] = nothing found
        let filterSeq = 0;
        if (typeof window.applyFilteredImages === 'function' && !window.applyFilteredImages.__wm) {
            const orig = window.applyFilteredImages;
            const wrapped = function (images, indices) {
                if (indices == null) searchResults = null;
                else searchResults = Array.isArray(images) ? images.slice() : [];
                filterSeq++;
                return orig.apply(this, arguments);
            };
            wrapped.__wm = true;
            window.applyFilteredImages = wrapped;
        }

        function galleryList() {
            if (searchResults) return searchResults;
            try {
                if (typeof allImages !== 'undefined' && Array.isArray(allImages)) return allImages;
            } catch (_) { /* gallery not loaded */ }
            return [];
        }

        /** The first cell on screen and its offset, to put the view back after a rebuild. */
        function gridAnchor(page) {
            const top = page.querySelector('.wm-pv-scroll').getBoundingClientRect().top;
            for (const el of page.querySelectorAll('.wm-pv-cell')) {
                const r = el.getBoundingClientRect();
                if (r.bottom > top) return { name: el.dataset.filename, offset: r.top - top };
            }
            return null;
        }

        function itemTime(item) {
            const t = Number(item.mtime) || 0;
            if (t) return t;
            const m = String(item.filename || item.original || '').match(/^(\d{12,13})_/);
            return m ? Number(m[1]) : 0;
        }

        function sortedList(list) {
            if (searchResults || sortBy === 'date') return list; // the gallery's order: newest first; search: relevance
            const out = list.slice();
            if (sortBy === 'name') out.sort((x, y) => String(x.filename || x.original || '').localeCompare(String(y.filename || y.original || '')));
            else out.sort((x, y) => (Number(y.size) || 0) - (Number(x.size) || 0));
            return out;
        }

        /** Columns of 80 px (3 at least); true when the count changed. A hidden page keeps its own. */
        function layoutGrid(page) {
            const scroller = page.querySelector('.wm-pv-scroll');
            const w = (scroller && scroller.clientWidth) || page.clientWidth;
            if (!w) return false;
            const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
            const cols = Math.max(3, Math.floor(w / (80 * px)));
            const prev = page.style.getPropertyValue('--wm-pv-cols');
            page.style.setProperty('--wm-pv-cols', String(cols));
            return prev !== String(cols);
        }

        function renderFolderBar(page) {
            const view = VIEWS.find(([v]) => v === activeView());
            page.querySelector('.wm-pv-folder span').textContent = searchResults ? 'Search results' : (view ? view[1] : 'Pictures');
            const sortBtn = page.querySelector('.wm-pv-sort');
            // while its drop-down is open the control reads "Sort By", as on the device
            if (dropdownAnchor !== sortBtn) sortBtn.querySelector('span').textContent = searchResults ? 'Relevance' : (SORTS.find(([k]) => k === sortBy) || SORTS[1])[1];
            sortBtn.disabled = !!searchResults;
        }

        function renderGrid(page, force) {
            const view = activeView();
            if (view !== gridView) {
                // another view (Images / Scraps / ...) starts at its top; a search belongs to its view
                if (gridView !== null) { page.querySelector('.wm-pv-scroll').scrollTop = 0; viewSwitchedAt = Date.now(); searchResults = null; selectedName = null; if (current === 'gallery') renderSoftKeys(); }
                gridView = view;
            }
            renderFolderBar(page);
            const list = sortedList(galleryList());
            const nameOf = (it) => (it && (it.filename || it.original)) || '';
            const sig = `${list.length}|${nameOf(list[0])}|${nameOf(list[list.length - 1])}|${view}|${filterSeq}|${searchResults ? 's' : 'a'}|${sortBy}`;
            if (!force && sig === gridSig) return;
            gridSig = sig;
            const scroller = page.querySelector('.wm-pv-scroll');
            const anchor = gridAnchor(page);
            const box = page.querySelector('.wm-pv-grid');
            const cols = Number(page.style.getPropertyValue('--wm-pv-cols')) || 3;
            const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
            let html = '';
            for (let i = 0; i < list.length; i += CHUNK) {
                const part = list.slice(i, i + CHUNK);
                // the block's real height before it renders (content-visibility): rows of 61 px
                const est = Math.round(Math.ceil(part.length / cols) * 61 * px);
                html += `<div class="wm-pv-chunk" style="contain-intrinsic-size:auto ${est}px">`;
                for (const item of part) {
                    const name = nameOf(item);
                    const sel = name === selectedName ? ' is-selected' : '';
                    html += `<button type="button" class="wm-pv-cell wm-photo${sel}" data-filename="${escapeHtml(name)}" aria-label="${escapeHtml(name)}"><img src="${escapeHtml(previewUrl(item))}" alt="" loading="lazy" decoding="async" draggable="false"></button>`;
                }
                html += '</div>';
            }
            box.innerHTML = html;
            // a selection that left the list (view switch, search, delete) is dropped
            if (selectedName && !list.some((it) => nameOf(it) === selectedName)) {
                selectedName = null;
                if (current === 'gallery') renderSoftKeys();
            }
            if (anchor && Date.now() - viewSwitchedAt > 50) {
                const el = box.querySelector(`.wm-pv-cell[data-filename="${CSS.escape(anchor.name)}"]`);
                if (el) scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top - anchor.offset;
            }
            const empty = page.querySelector('.wm-photos-empty');
            const loading = !list.length && !searchResults && Date.now() - viewSwitchedAt < 4000;
            empty.textContent = loading ? 'Loading...' : (searchResults ? 'No matches' : 'No pictures');
            empty.hidden = list.length > 0;
        }

        function selectCell(page, name) {
            selectedName = name;
            page.querySelectorAll('.wm-pv-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
            const el = name && page.querySelector(`.wm-pv-cell[data-filename="${CSS.escape(name)}"]`);
            if (el) el.classList.add('is-selected');
            if (current === 'gallery') renderSoftKeys();
        }

        /** Menu > Set as Today Background: this phone's Today shows the picture (WM 6.1 does the same). */
        function setTodayBackground(name) {
            try {
                if (!name) { localStorage.removeItem(TODAY_BG_KEY); applyTodayBackground(); return; }
                const item = galleryList().find((it) => (it.filename || it.original) === name);
                if (!item || !item.preview) return;
                // the screen-sized preview by its path (no full-size PNG, no read token kept)
                const p = typeof getGalleryPreviewUrl === 'function' ? getGalleryPreviewUrl(item.preview) : item.preview;
                localStorage.setItem(TODAY_BG_KEY, `/previews/${encodeURIComponent(p)}`);
            } catch (_) { /* storage off */ }
            applyTodayBackground();
        }

        function viewPicture(name) {
            if (!name || typeof showLightbox !== 'function') return;
            try { showLightbox({ filename: name }); } catch (_) { /* viewer not ready */ }
        }

        /** WM's folder drop-down: the gallery views, the current one with a dot. */
        function folderMenu() {
            const view = activeView();
            return VIEWS.map(([v, label]) => ({ label, radio: view === v, action: () => switchView(v) }));
        }

        function sortMenu(page) {
            return SORTS.map(([k, label]) => ({ label, radio: sortBy === k, action: () => { sortBy = k; renderGrid(page, true); } }));
        }

        const fmtMonth = new Intl.DateTimeFormat(undefined, { month: 'long', year: 'numeric' });

        /** Months of the list in its order (date sort): label, first index, count, first picture. */
        function monthsOf(list) {
            const out = [];
            list.forEach((item, i) => {
                const t = itemTime(item);
                const key = t ? fmtMonth.format(new Date(t)) : 'Older';
                const last = out[out.length - 1];
                if (last && last.label === key) last.count++;
                else out.push({ label: key, index: i, count: 1, item });
            });
            return out;
        }

        function jumpToIndex(page, i) {
            const cells = page.querySelectorAll('.wm-pv-cell');
            const el = cells[Math.max(0, Math.min(i, cells.length - 1))];
            if (!el) return;
            const scroller = page.querySelector('.wm-pv-scroll');
            // twice: content-visibility blocks above settle to their real height after the first
            const go = () => { scroller.scrollTop += el.getBoundingClientRect().top - scroller.getBoundingClientRect().top; };
            go();
            requestAnimationFrame(() => requestAnimationFrame(go));
            selectCell(page, el.dataset.filename);
        }

        function reloadGallery() {
            // Refresh Gallery on the desktop's gallery menu (mainMenuManager.js); the grid keeps its
            // place, and reads "Loading..." if the list is empty for a moment
            viewSwitchedAt = Date.now();
            try {
                if (typeof invalidateGalleryImagesSyncState === 'function') invalidateGalleryImagesSyncState();
                if (typeof switchGalleryView === 'function') switchGalleryView(typeof currentGalleryView !== 'undefined' ? currentGalleryView : activeView(), true);
            } catch (_) { /* gallery not ready */ }
        }

        // another workspace's pictures start at their top
        document.addEventListener('workspaceSwitchComplete', () => {
            const gpage = apps.get('gallery') && apps.get('gallery').page;
            if (!gpage) return;
            gpage.querySelector('.wm-pv-scroll').scrollTop = 0;
            viewSwitchedAt = Date.now();
            searchResults = null;
            selectedName = null;
            renderGrid(gpage, true);
            if (current === 'gallery') renderSoftKeys();
        });

        function canGoToDate() {
            return !searchResults && sortBy === 'date';
        }

        function goToMenu(page) {
            if (!canGoToDate()) return [{ label: 'Sort by Date first', disabled: true }];
            return monthsOf(galleryList()).map((m) => ({ label: `${m.label} (${m.count})`, action: () => jumpToIndex(page, m.index) }));
        }

        function workspaceSubmenu() {
            return workspaceItems();
        }

        // Visual Index: the desktop's jump index as a WM list, one row per month with its first
        // picture and count; a row goes back to the grid at that month
        registerApp({
            id: 'pv-index',
            title: 'Visual Index',
            icon: 'app-pictures',
            titleAction: 'ok',
            mount(ipage) {
                ipage.classList.add('wm-pv-index');
                ipage.addEventListener('click', (e) => {
                    const row = e.target.closest('[data-index]');
                    if (!row) return;
                    const i = Number(row.dataset.index);
                    back();
                    const gpage = apps.get('gallery').page;
                    if (gpage) setTimeout(() => jumpToIndex(gpage, i), 30);
                });
            },
            show(ipage) {
                const months = monthsOf(galleryList());
                ipage.innerHTML = months.map((m) => `<button type="button" class="wm-pv-index-row" data-index="${m.index}"><img src="${escapeHtml(previewUrl(m.item))}" alt="" loading="lazy" decoding="async"><span class="wm-pv-index-label">${escapeHtml(m.label)}</span><span class="wm-pv-index-count">${m.count}</span></button>`).join('') || '<p class="wm-photos-empty">No pictures</p>';
            },
            softKeys() {
                return { left: null, right: null };
            }
        });

        function switchView(v) {
            const b = document.querySelector(`#galleryWindow .gallery-toggle-group .gallery-toggle-btn[data-view="${v}"]`);
            if (b) b.click();
        }

        registerApp({
            id: 'gallery',
            /** Run a gallery search (Today's Live Search box): the search bar shows the query. */
            search(q) {
                setSearch(true);
                const input = searchBar.querySelector('input');
                input.value = q;
                input.dispatchEvent(new Event('input', { bubbles: true }));
                input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
            },
            title: 'Pictures & Videos',
            icon: 'app-pictures',
            inStart: 'top',
            mount(page) {
                page.classList.add('wm-pv');
                page.innerHTML = `
                    <div class="wm-pv-bar">
                        <button type="button" class="wm-pv-folder" aria-haspopup="menu">${imgTag('app-pictures')}<span></span><i class="wm-pv-arrow"></i></button>
                        <button type="button" class="wm-pv-sort" aria-haspopup="menu"><span></span><i class="wm-pv-arrow"></i></button>
                    </div>
                    <div class="wm-pv-scroll"><div class="wm-pv-grid"></div><p class="wm-photos-empty" hidden>No pictures</p></div>`;
                page.querySelector('.wm-pv-grid').addEventListener('click', (e) => {
                    const cell = e.target.closest('.wm-pv-cell');
                    if (!cell) return;
                    // WM: a tap selects the picture and opens it
                    selectCell(page, cell.dataset.filename);
                    viewPicture(cell.dataset.filename);
                });
                page.querySelector('.wm-pv-folder').addEventListener('click', (e) => {
                    e.stopPropagation();
                    showDropdown(e.currentTarget, folderMenu());
                });
                page.querySelector('.wm-pv-sort').addEventListener('click', (e) => {
                    e.stopPropagation();
                    // the drop-down's label reads "Sort By" while it is open
                    const btn = e.currentTarget;
                    if (searchResults) return; // search results keep their relevance order
                    const opening = !(openPopup && dropdownAnchor === btn);
                    if (opening) btn.querySelector('span').textContent = 'Sort By';
                    showDropdown(btn, sortMenu(page), 'right', () => renderFolderBar(page));
                });
                // only a new column count needs a rebuild (the chunks' height estimates); 1fr columns
                // reflow by themselves, and show / hide / keyboard resizes leave the cells alone
                new ResizeObserver(() => { if (layoutGrid(page)) renderGrid(page, true); }).observe(page);
            },
            show(page) {
                layoutGrid(page);
                renderGrid(page, false);
                // the desktop gallery keeps loading, paging and searching underneath (allImages):
                // follow it while Pictures is on screen
                clearInterval(gridTimer);
                gridTimer = setInterval(() => renderGrid(page, false), 700);
            },
            hide() {
                clearInterval(gridTimer);
                gridTimer = null;
                if (searchBar && !searchBar.hidden) setSearch(false);
            },
            onTitleAction() {
                if (searchBar && !searchBar.hidden) { setSearch(false); return false; }
                return true;
            },
            softKeys() {
                const searching = !!(searchBar && !searchBar.hidden);
                if (searching) return { left: { label: 'Cancel', action: () => setSearch(false) }, right: null };
                const page = this.page;
                return {
                    left: { label: 'View', disabled: !selectedName, action: () => viewPicture(selectedName) },
                    right: {
                        label: 'Menu',
                        // WM: Camera, Send..., Beam..., Save to Contact... | Delete, Edit, Play Slide
                        // Show, Set as Today Background..., Go To, Tools; here what Dreamscape has
                        menu: () => [
                            { label: 'Search...', action: () => setSearch(true) },
                            { label: 'Jump to Top', action: () => { page.querySelector('.wm-pv-scroll').scrollTop = 0; } },
                            { label: 'Go To', submenu: () => goToMenu(page) },
                            { label: 'Visual Index', disabled: !canGoToDate(), action: () => open('pv-index') },
                            { label: 'Reload', action: reloadGallery },
                            '-',
                            { label: 'Switch Workspace', submenu: workspaceSubmenu },
                            '-',
                            { label: 'Set as Today Background', disabled: !selectedName, action: () => setTodayBackground(selectedName) },
                            '-',
                            ...(hasTodayBackground() ? [{ label: 'Clear Today Background', action: () => setTodayBackground(null) }] : []),
                            '-',
                            ...folderMenu(),
                            ...(searchResults ? [] : ['-', ...sortMenu(page).map((it) => Object.assign(it, { label: `Sort by ${it.label}` }))])
                        ]
                    }
                };
            }
        });
    }

    // ---------------------------------------------------------------- picture view

    // WM 6.1's picture view: black, the title bar with ok, soft keys Send / Menu. The PhotoSwipe
    // viewer (lightbox.js, padded between the bars on phones) keeps its gestures; its own buttons
    // are hidden and reached from the soft keys.
    let viewerActive = false;
    let viewerClosing = false; // closed by the back gesture, PhotoSwipe still animating out
    const VIEWER_ACTIONS = [
        // [button title in lightbox.js, menu label]
        ['Copy to clipboard', 'Copy'],
        ['Pin image', 'Pin'],
        '-',
        ['Recast Spell', 'Recast Spell'],
        ['Create Persona', 'Create Persona'],
        ['Expand canvas', 'Expand Canvas'],
        ['Upscale image', 'Upscale'],
        '-',
        ['Move to scraps', 'Move to Scraps'],
        ['Destroy image', 'Delete']
    ];

    /** Close whichever PhotoSwipe is open (the gallery's or a standalone one): its own close. */
    function closeViewer() {
        // the instance itself (a scripted click on its hidden close button does nothing)
        try {
            const p = (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp) || window.pswp;
            if (p && !p.isDestroying && typeof p.close === 'function') { p.close(); return; }
        } catch (_) { /* fall through */ }
        if (typeof hideLightbox === 'function') hideLightbox();
    }

    function viewerSlides() {
        try {
            const p = (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp) || window.pswp;
            return p && typeof p.getNumItems === 'function' ? p.getNumItems() : 0;
        } catch (_) { return 0; }
    }

    function viewerItem() {
        try {
            const p = (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp) || window.pswp;
            const d = p && p.currSlide && p.currSlide.data;
            return (d && d.data) || null;
        } catch (_) { return null; }
    }

    function viewerButton(title) {
        const pswp = document.querySelector('.pswp.pswp--open');
        if (!pswp) return null;
        // a button lightbox.js has hidden for this picture is not offered
        return [...pswp.querySelectorAll('button')].find((b) => (b.title || b.getAttribute('aria-label')) === title && !b.closest('.hidden')) || null;
    }

    function viewerPress(title) {
        const b = viewerButton(title);
        if (b) b.click();
    }

    function viewerSoftKeys() {
        return {
            left: { label: 'Save', disabled: !viewerButton('Download image'), action: () => viewerPress('Download image') },
            right: {
                label: 'Menu',
                menu: () => {
                    const items = [{ label: 'Zoom', action: () => viewerPress('Zoom in/out') }];
                    if (viewerSlides() > 1) {
                        items.push({ label: 'Previous', action: () => viewerPress('Previous') });
                        items.push({ label: 'Next', action: () => viewerPress('Next') });
                    }
                    items.push('-');
                    const item = viewerItem();
                    let sep = false;
                    for (const a of VIEWER_ACTIONS) {
                        if (a === '-') { sep = true; continue; }
                        if (!viewerButton(a[0])) continue;
                        if (sep && items[items.length - 1] !== '-') items.push('-');
                        sep = false;
                        // lightbox.js has one pin button that toggles: the label follows the picture
                        const label = a[0] === 'Pin image' && item && item.isPinned ? 'Unpin' : a[1];
                        items.push({ label, action: () => viewerPress(a[0]) });
                    }
                    while (items[items.length - 1] === '-') items.pop();
                    return items;
                }
            }
        };
    }

    function checkViewer() {
        const open = !!document.querySelector('.pswp.pswp--open');
        if (open === viewerActive) return;
        viewerActive = open;
        viewerClosing = false;
        closeMenus(true);
        if (open) {
            root.setAttribute('data-wm-viewer', '');
            setTitle('Pictures & Videos');
            setTitleAction('ok');
        } else {
            root.removeAttribute('data-wm-viewer');
            const app = current && apps.get(current);
            setTitle(current === 'today' ? 'Start' : ((app && app.title) || current));
            setTitleAction(current === 'today' ? null : ((app && app.titleAction) || 'close'));
        }
        renderSoftKeys();
        // the tap that opened the viewer is still fresh here (150 ms poll): its entry is allowed
        syncHistory();
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

    // ---------------------------------------------------------------- startup

    // The WM 6.1 boot, measured on the emulator (hard and soft reset): black, the splash
    // (logo over the green swirl) while the OS starts, then Today with its items filling in.
    // A first install or an update download is wceload's screen instead ("Installing x.cab ..."
    // with the segmented bar and the wait cursor, then "x was successfully installed on your
    // device." with ok). Here: splash until the page's startup finishes, the installer while the
    // service worker downloads the app, then Today. html[data-wm-boot] = splash | install | done.
    const BOOT_MIN_SPLASH_MS = 1600;
    const BOOT_MAX_SPLASH_MS = 25000;
    const INSTALLED_KEY = 'melatonMobileInstalled';
    const INSTALL_DONE_KEY = 'wmInstallDone';
    let bootStart = 0;
    let bootTimer = null;
    let waitTimer = null;
    let installKind = null;

    function installNoun() {
        return installKind === 'update' ? 'Melaton Mobile update' : 'Melaton Mobile';
    }

    function buildBootLayers() {
        const splash = document.createElement('div');
        splash.className = 'wm-splash';
        splash.setAttribute('aria-label', 'Melaton Mobile is starting');
        splash.innerHTML = `
            <svg class="wm-splash-swirl" viewBox="0 0 480 640" aria-hidden="true" preserveAspectRatio="xMidYMax slice">
                <circle cx="248" cy="508" r="214" />
                <circle cx="232" cy="500" r="146" />
                <path d="M 230 432 A 72 72 0 1 0 300 500" />
            </svg>
            <div class="wm-splash-logo">
                <img src="/static_images/melaton/melaton-white-256.png" alt="" draggable="false">
                <div class="wm-splash-words">
                    <span class="wm-splash-brand">Melaton</span>
                    <span class="wm-splash-product">Mobile</span>
                    <span class="wm-splash-version">Version 2026 <b>R7</b></span>
                </div>
            </div>`;
        shell.appendChild(splash);

        const inst = document.createElement('section');
        inst.className = 'wm-installer';
        inst.innerHTML = `
            <div class="wm-installer-progress">
                <p class="wm-installer-text"></p>
                <div class="wm-installer-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>
            </div>
            <div class="wm-installer-done" hidden>
                <p><b class="wm-installer-done-title"></b></p>
                <p class="wm-installer-done-note"></p>
            </div>
            <img class="wm-installer-wait" alt="" draggable="false">`;
        shell.querySelector('.wm-content').appendChild(inst);
    }

    function setBoot(phase) {
        if (root.dataset.wmBoot === phase) return;
        root.dataset.wmBoot = phase;
        clearInterval(waitTimer);
        waitTimer = null;
        if (phase === 'install') {
            closeMenus();
            setTitle('Start');
            setTitleAction(null);
            // wceload shows no soft keys while it copies (only the SIP button)
            softKeys = { left: null, right: null };
            shell.querySelectorAll('.wm-softkey').forEach((b) => { b.textContent = ''; b.disabled = true; });
            const img = shell.querySelector('.wm-installer-wait');
            let frame = 0;
            const tick = () => {
                img.src = art(`wait-${frame}`);
                img.srcset = `${art(`wait-${frame}`)} 1x, ${art2x(`wait-${frame}`)} 2x`;
                frame = (frame + 1) % 16;
            };
            tick();
            waitTimer = setInterval(tick, 90);
        }
    }

    function setInstallProgress(pct) {
        const inst = shell.querySelector('.wm-installer');
        inst.querySelector('.wm-installer-progress').hidden = false;
        inst.querySelector('.wm-installer-done').hidden = true;
        inst.querySelector('.wm-installer-wait').hidden = false;
        inst.querySelector('.wm-installer-text').textContent = `Installing ${installNoun()} ...`;
        const bar = inst.querySelector('.wm-installer-bar');
        const p = Math.max(0, Math.min(100, Math.round(pct)));
        bar.setAttribute('aria-valuenow', String(p));
        bar.style.setProperty('--wm-install-blocks', String(Math.floor(p * 18 / 100)));
    }

    /** wceload's last page: "<name> was successfully installed on your device." + ok. */
    function showInstallDone(kind) {
        installKind = kind;
        setBoot('install');
        clearInterval(waitTimer);
        const inst = shell.querySelector('.wm-installer');
        inst.querySelector('.wm-installer-progress').hidden = true;
        inst.querySelector('.wm-installer-wait').hidden = true;
        inst.querySelector('.wm-installer-done').hidden = false;
        inst.querySelector('.wm-installer-done-title').textContent = `${installNoun()} was successfully installed on your device.`;
        // wceload's own wording (device capture inst-06 / inst-18)
        inst.querySelector('.wm-installer-done-note').textContent = 'If you need more storage space, you can remove installed programs.';
        setTitleAction('ok');
        const btn = shell.querySelector('.wm-title-action');
        const onOk = (e) => {
            e.stopImmediatePropagation();
            btn.removeEventListener('click', onOk, true);
            try { sessionStorage.removeItem(INSTALL_DONE_KEY); } catch (_) { /* storage off */ }
            finishBoot();
        };
        btn.addEventListener('click', onOk, true);
        // an update moves on by itself; only the first install waits for ok
        if (kind === 'update') {
            setTimeout(() => {
                if (root.dataset.wmBoot !== 'install') return;
                btn.removeEventListener('click', onOk, true);
                try { sessionStorage.removeItem(INSTALL_DONE_KEY); } catch (_) { /* storage off */ }
                finishBoot();
            }, 2000);
        }
    }

    function swDownloading() {
        const swm = window.serviceWorkerManager;
        if (!swm || swm.bootComplete) return null;
        const pct = Number(swm.updateProgress);
        const total = Number(swm.lastUpdateFilesTotal) || 0;
        if (swm._bootOrchestrating && total > 0 && pct > 0 && pct < 100) return pct;
        return null;
    }

    function finishBoot() {
        clearInterval(bootTimer);
        bootTimer = null;
        try {
            // a boot that ends here installed nothing more (the done screen belongs to the reload
            // a download causes); the device counts as installed once startup really finished
            sessionStorage.removeItem(INSTALL_DONE_KEY);
            if (window.wsClient && window.wsClient.initializationCompleted) localStorage.setItem(INSTALLED_KEY, String(Date.now()));
        } catch (_) { /* storage off */ }
        stack.length = 0;
        stack.push('today');
        activate('today');
        // As on the device after the splash: Today's background and date line first with no title
        // bar or soft keys (reveal), the items fill in over ~2 s, the bars come last
        setBoot('reveal');
        const page = apps.get('today').page;
        const rows = page ? [...page.children].slice(1) : [];
        rows.forEach((r) => r.classList.add('wm-boot-hidden'));
        rows.forEach((r, i) => setTimeout(() => r.classList.remove('wm-boot-hidden'), 1400 + i * 90));
        setTimeout(() => { if (root.dataset.wmBoot === 'reveal') setBoot('done'); }, 1400 + rows.length * 90 + 300);
    }

    function bootTick() {
        const ws = window.wsClient;
        let pct = swDownloading();
        // once the installer is up it stays for the whole download, including the 0 % / 100 %
        // stretches between passes and the verify before the reload (no splash time limit)
        const swm = window.serviceWorkerManager;
        if (pct == null && root.dataset.wmBoot === 'install' && swm && swm._bootOrchestrating && !swm.bootComplete) {
            pct = Number(swm.updateProgress) || 0;
        }
        if (pct != null) {
            if (!installKind) {
                let installed = false;
                try { installed = !!(localStorage.getItem(INSTALLED_KEY) || localStorage.getItem('melatonInstalled')); } catch (_) { /* storage off */ }
                installKind = installed ? 'update' : 'install';
            }
            setBoot('install');
            setInstallProgress(pct);
            // the page reloads itself when the download finishes: the next load says it is done
            try { sessionStorage.setItem(INSTALL_DONE_KEY, installKind); } catch (_) { /* storage off */ }
            return;
        }
        const ready = !!(ws && ws.initializationCompleted);
        const elapsed = Date.now() - bootStart;
        if ((ready && elapsed >= BOOT_MIN_SPLASH_MS) || elapsed >= BOOT_MAX_SPLASH_MS) {
            let done = null;
            try { done = sessionStorage.getItem(INSTALL_DONE_KEY); } catch (_) { /* storage off */ }
            if (done && ready) { clearInterval(bootTimer); bootTimer = null; showInstallDone(done); return; }
            finishBoot();
        }
    }

    function startBoot() {
        buildBootLayers();
        bootStart = Date.now();
        setBoot('splash');
        bootTimer = setInterval(bootTick, 200);
    }

    /** Mobile wording for the connection steps the desktop names after its computer. */
    function useMobileWording() {
        try {
            const beats = window.WebSocketClient && window.WebSocketClient.CONNECTION_BEATS
                || (window.wsClient && window.wsClient.constructor && window.wsClient.constructor.CONNECTION_BEATS);
            if (beats && beats.establishing) beats.establishing.message = 'Registering your device on the network…';
            const ui = window.wsClient && window.wsClient.connectionUi;
            if (ui && ui.message === 'Registering your computer on the network…') ui.message = 'Registering your device on the network…';
        } catch (_) { /* wording stays */ }
    }

    // ---------------------------------------------------------------- boot

    function init() {
        build();
        registerTodayApp();
        registerGalleryApp();
        watchTheme();
        useMobileWording();
        stack.push('today');
        activate('today');
        applyTodayBackground();
        startBoot();
        refreshStatus();
        setInterval(refreshStatus, 2000);
        checkTakeover();
        setInterval(checkTakeover, 400);
        setInterval(checkViewer, 150);
        document.dispatchEvent(new CustomEvent('wmShellReady'));
    }

    window.wmShell = {
        registerApp,
        open,
        back,
        messageBox,
        // for apps in their own files (wmFileExplorer.js ...)
        menu: (side, items, btn) => showPopup(side, items, btn),
        dropdown: (anchor, items, align, onClose) => showDropdown(anchor, items, align, onClose),
        closeMenus: () => closeMenus(),
        /** A context menu at a point (tap-and-hold), kept on screen. */
        menuAt: (x, y, items) => {
            showPopup('context', items, null);
            const pop = shell.querySelector('.wm-popup');
            const sr = shell.getBoundingClientRect();
            const w = pop.offsetWidth;
            const h = pop.offsetHeight;
            pop.style.right = 'auto';
            pop.style.bottom = 'auto';
            pop.style.left = `${Math.max(2, Math.min(x - sr.left, sr.width - w - 2))}px`;
            pop.style.top = `${Math.max(2, Math.min(y - sr.top, sr.height - h - 2))}px`;
        },
        /** Apps with their own back steps call this after a step (it adds the entry after a tap). */
        syncHistory: () => syncHistory(),
        refreshSoftKeys: () => renderSoftKeys(),
        setTitle: (t) => setTitle(t),
        art: { url: art, url2x: art2x, img: imgTag },
        escapeHtml,
        applyTheme,
        onPopState,
        thumbFor,
        // tests: run the startup sequence again (splash, installer, Today) on a live page
        _test: { restartBoot() { clearInterval(bootTimer); installKind = null; bootStart = Date.now(); setBoot('splash'); bootTimer = setInterval(bootTick, 200); } },
        deriveRoles,
        get current() { return current; }
    };

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
