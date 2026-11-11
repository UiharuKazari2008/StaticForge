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
 * The title bar's corner button follows WM 6.1 and is decided in one place (titleKindNow): X on an
 * application's main view (Smart Minimize: the app goes to the background as it is, the screen
 * under it comes back), ok on a form, property page, viewer or edit screen (confirm and close, back
 * to the previous screen), nothing on Today, under a message box or an ok bubble, and on a full
 * screen dialog that has its own OK / Cancel soft keys. An app tells the shell what its current
 * layer is with titleKind() -> 'close' | 'ok' | null (or a fixed titleAction), handles ok with
 * onTitleOk() (true = handled; else its onBack() step, else back to the previous app), and calls
 * wmShell.refreshTitleAction() when a layer changes without syncHistory / refreshSoftKeys.
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
    // a name starting with '/' is an image path of its own (a desktop app icon), used as is
    const art = (name) => (String(name).startsWith('/') ? name : `${ART}${name}.png`);
    const art2x = (name) => (String(name).startsWith('/') ? name : `${ART}${name}@2x.png`);
    // ROM art upscaled 4x (GPU, 4x-UltraSharp) for dense screens: a phone at DPR 2.6 with the
    // 1.5x touch scale draws icons at ~4x. Only these names have an @4x file (regenerate the list
    // when art is added: ls public/static_images/wm61/*@4x.png)
    const HD_ART = new Set(["app-calculator", "app-calculator-lg", "app-calendar", "app-calendar-lg", "app-contacts", "app-contacts-lg", "app-director", "app-director-lg", "app-file-explorer", "app-file-explorer-lg", "app-games", "app-games-lg", "app-help", "app-help-lg", "app-ie", "app-ie-lg", "app-messaging", "app-messaging-lg", "app-notes", "app-notes-lg", "app-office", "app-office-lg", "app-phone", "app-phone-lg", "app-pictures", "app-pictures-lg", "app-programs", "app-programs-lg", "app-search", "app-search-lg", "app-settings", "app-settings-lg", "app-studio", "app-studio-lg", "app-task-manager", "app-task-manager-lg", "app-today", "app-today-lg", "contacts-card", "contacts-email", "contacts-home", "contacts-mobile", "contacts-sms", "contacts-web", "contacts-work", "fe-card", "fe-device", "fe-file", "fe-folder", "fe-storage-card", "ie-busy", "ie-chevron", "ie-favorite", "ie-folder", "ie-go", "ie-lock", "ie-logo", "ie-page", "ie-search", "ie-stop", "ie-unlock", "menu-check", "menu-submenu-arrow", "msg-acct-mail", "msg-acct-outlook", "msg-attach-mail", "msg-attachment", "msg-folder-account", "msg-folder-deleted", "msg-folder-folder", "msg-folder-inbox", "msg-folder-outbox", "msg-folder-sent", "msg-read", "msg-unread", "msgbox-error", "msgbox-info", "msgbox-question", "msgbox-warning", "notes-folders", "notes-note", "set-about", "set-backlight", "set-clock", "set-connections", "set-domain", "set-error-reporting", "set-grimoire", "set-input", "set-lock", "set-memory", "set-menus", "set-netcards", "set-owner", "set-power", "set-regional", "set-remove-programs", "set-screen", "set-search-indexing", "set-sounds", "set-today", "set-update", "set-usb", "set-wireless", "set-workspace", "sip-keyboard", "start-flag", "status-battery-1", "status-battery-2", "status-battery-3", "status-battery-charging", "status-battery-empty", "status-battery-full", "status-battery-unknown", "status-data-3g", "status-data-3g-active", "status-data-4g", "status-data-4g-active", "status-data-4g-plus", "status-data-4g-plus-active", "status-data-5g", "status-data-5g-active", "status-data-5g-plus", "status-data-5g-plus-active", "status-data-anim-00", "status-data-anim-01", "status-data-anim-02", "status-data-anim-03", "status-data-anim-04", "status-data-anim-05", "status-data-anim-06", "status-data-anim-07", "status-data-anim-08", "status-data-anim-09", "status-data-anim-10", "status-data-anim-11", "status-data-anim-12", "status-data-anim-13", "status-data-anim-14", "status-data-anim-15", "status-data-anim-16", "status-data-anim-17", "status-data-e", "status-data-e-active", "status-data-g", "status-data-g-active", "status-data-h", "status-data-h-active", "status-data-h-plus", "status-data-h-plus-active", "status-data-off", "status-data-on", "status-director", "status-mail", "status-notify-many", "status-prints", "status-reminder", "status-roaming", "status-signal-1", "status-signal-2", "status-signal-3", "status-signal-4", "status-signal-alert", "status-signal-none", "status-signal-off", "status-signal-search-1", "status-signal-search-2", "status-signal-search-3", "status-vibrate", "status-volume", "status-volume-off", "status-wifi-available", "status-wifi-connected", "title-close", "title-ok", "today-calendar", "today-clock", "today-getting-started", "today-lock", "today-lock-locked", "today-messages", "today-owner", "today-phone", "today-search-button", "today-search-button-pressed", "today-tasks", "wait-0", "wait-1", "wait-10", "wait-11", "wait-12", "wait-13", "wait-14", "wait-15", "wait-2", "wait-3", "wait-4", "wait-5", "wait-6", "wait-7", "wait-8", "wait-9"]);
    const srcset = (name) => String(name).startsWith('/') ? `${name} 1x` : `${art(name)} 1x, ${art2x(name)} 2x${HD_ART.has(name) ? `, ${ART}${name}@4x.png 4x` : ''}`;
    const imgTag = (name, alt = '') => `<img src="${art(name)}" srcset="${srcset(name)}" alt="${alt}" draggable="false">`;
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
        '--wm-button-light': { dh: -27, s: 61, l: 56 },
        // the ok / X button's bevel ring (light top -> this at the bottom) and its fill
        '--wm-button-ring-bottom': { dh: -26, s: 75, l: 44 },
        '--wm-button-fill-top': { dh: -27, s: 48, l: 43 },
        '--wm-button-fill-bottom': { dh: -27, s: 78, l: 31 },
        // the pressed glyph (#397D08 on green)
        '--wm-button-pressed-glyph': { dh: -28, s: 88, l: 26 }
    };
    // The ok / X frame keeps WM's hue shift (about -27 deg, toward yellow) while the workspace hue is
    // near WM's own green (highlight #31D339, 123 deg): full shift within 15 deg, none past 45 deg,
    // so a green workspace draws the frame 1:1 with the emulator and other hues are unchanged.
    const BUTTON_ROLES = new Set(['--wm-button-border', '--wm-button-light', '--wm-button-ring-bottom', '--wm-button-fill-top', '--wm-button-fill-bottom', '--wm-button-pressed-glyph']);
    const WM_GREEN_HUE = 123;
    // WM's button border (#214D08) parts from the title (#004918) by hue more than by lightness
    // (OKLab difference 0.029). Without the hue shift the same lightness put the border on the
    // title's own colour and the button lost its frame: the border is made light enough to keep
    // WM's difference in every hue.
    const BUTTON_BORDER_DE = 0.0287;
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
        const fromGreen = Math.abs((((base.h - WM_GREEN_HUE) % 360) + 540) % 360 - 180);
        const nearGreen = Math.max(0, Math.min(1, (45 - fromGreen) / 30));
        const out = {};
        const hsl = {};
        for (const [name, role] of Object.entries(ROLES)) {
            const share = BUTTON_ROLES.has(name) ? Math.max(HUE_SHIFT_SHARE, nearGreen) : HUE_SHIFT_SHARE;
            const h = ((base.h + role.dh * share * Math.min(1, k)) % 360 + 360) % 360;
            const s = Math.min(100, role.s * k);
            hsl[name] = { h, s, l: role.l };
            out[name] = `hsl(${h.toFixed(1)} ${s.toFixed(1)}% ${role.l}%)`;
        }
        const t = hsl['--wm-title'];
        const b = hsl['--wm-button-border'];
        let l = b.l;
        while (l < 40 && oklabDistance(hslToRgb(b.h, b.s, l), hslToRgb(t.h, t.s, t.l)) < BUTTON_BORDER_DE) l += 0.25;
        out['--wm-button-border'] = `hsl(${b.h.toFixed(1)} ${b.s.toFixed(1)}% ${l}%)`;
        // WM keeps white text on the highlight (menus, selected rows, the active toggle): a light
        // workspace colour (teal, yellow, cyan) would leave it unreadable, so the highlight darkens
        // until white reaches 3:1
        const hl = hsl['--wm-highlight'];
        let hlL = hl.l;
        while (hlL > 20 && contrastWithWhite(hslToRgb(hl.h, hl.s, hlL)) < 3) hlL -= 1;
        if (hlL !== hl.l) out['--wm-highlight'] = `hsl(${hl.h.toFixed(1)} ${hl.s.toFixed(1)}% ${hlL}%)`;
        return out;
    }

    /** WCAG contrast of white text on an sRGB 0..1 colour. */
    function contrastWithWhite(rgb) {
        const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        return 1.05 / (0.2126 * r + 0.7152 * g + 0.0722 * b + 0.05);
    }

    /** sRGB 0..1 of an HSL colour (h degrees, s and l percent). */
    function hslToRgb(h, s, l) {
        s /= 100; l /= 100;
        const a = s * Math.min(l, 1 - l);
        const f = (n) => { const k = (n + h / 30) % 12; return l - a * Math.max(-1, Math.min(k - 3, 9 - k, 1)); };
        return [f(0), f(8), f(4)];
    }

    function oklab(rgb) {
        const [r, g, b] = rgb.map((c) => (c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4)));
        const l = Math.cbrt(0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b);
        const m = Math.cbrt(0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b);
        const q = Math.cbrt(0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b);
        return [0.2104542553 * l + 0.7936177850 * m - 0.0040720468 * q, 1.9779984951 * l - 2.4285922050 * m + 0.4505937099 * q, 0.0259040371 * l + 0.7827717662 * m - 0.8086757660 * q];
    }

    function oklabDistance(a, b) {
        const x = oklab(a), y = oklab(b);
        return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2]);
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
            let roles = JSON.parse(localStorage.getItem(THEME_CACHE_KEY) || 'null');
            // a cache from before a role was added: the highlight role is the workspace colour's
            // hue and saturation at WM's lightness, so every role comes again from it
            if (roles && roles['--wm-highlight'] && Object.keys(ROLES).some((k) => !(k in roles))) roles = deriveRoles(roles['--wm-highlight']) || roles;
            if (roles) for (const [name, value] of Object.entries(roles)) root.style.setProperty(name, value);
        } catch (_) { /* no cache */ }
    }

    /**
     * Device-pixel helpers for wm-shell.css: --wm-dpx is one device pixel (the ok / X frame rounds
     * its lengths to it), and html.wm-art-1x / -2x / -4x names the art for the scale the shell is
     * drawn at (dpr x --wm-px), so dpr 2 at touch scale takes the 4x glyphs, not 2x scaled up.
     */
    let pixelScaleKey = '';
    function syncPixelScale() {
        const dpr = window.devicePixelRatio || 1;
        const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        const scale = dpr * px;
        const artClass = scale <= 1.01 ? 'wm-art-1x' : scale <= 2.01 ? 'wm-art-2x' : 'wm-art-4x';
        const key = `${dpr}|${artClass}`;
        if (key === pixelScaleKey) return;
        pixelScaleKey = key;
        root.style.setProperty('--wm-dpx', `${1 / dpr}px`);
        for (const c of ['wm-art-1x', 'wm-art-2x', 'wm-art-4x']) root.classList.toggle(c, c === artClass);
    }

    function watchPixelScale() {
        syncPixelScale();
        window.addEventListener('resize', syncPixelScale);
        // Settings > Screen sets --wm-px inline on <html>
        new MutationObserver(syncPixelScale).observe(root, { attributes: true, attributeFilter: ['style'] });
        // a dpr change without a resize (the window moves to another screen)
        const watchDpr = () => {
            if (!window.matchMedia) return;
            matchMedia(`(resolution: ${window.devicePixelRatio || 1}dppx)`).addEventListener('change', () => { syncPixelScale(); watchDpr(); }, { once: true });
        };
        watchDpr();
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

    // Title-bar status icons are WM 6.1's white 1-bit glyphs: new mail is outres 32507 (the title-bar
    // envelope), prints and the Director are Melaton glyphs drawn in the same style (manifest.json)
    const STATUS_APP_ICONS = { mail: 'status-mail', prints: 'status-prints', director: 'status-director', update: 'status-update' };
    const STATUS_APP_ROLES = ['mail', 'prints', 'director', 'update'];
    // the Director's clapper while a turn runs: the stick claps (open frames, closed, open again)
    const DIRECTOR_CLAP = ['status-director-open-2', 'status-director-open-1', 'status-director-open-0', 'status-director', 'status-director-open-0', 'status-director-open-1'];
    const artImageSet = (name) => `image-set(url("${art(name)}") 1x, url("${art2x(name)}") 2x${HD_ART.has(name) ? `, url("${ART}${name}@4x.png") 4x` : ''})`;

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
                    <button type="button" class="wm-status-icon" data-role="notify" hidden aria-label="Notifications"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="mail" hidden aria-label="Messages"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="prints" hidden aria-label="Prints"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="director" hidden aria-label="Director"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="update" hidden aria-label="Updates ready"></button>
                    <button type="button" class="wm-status-icon" data-role="data" data-icon="data-off" aria-label="Connectivity"></button>
                    <button type="button" class="wm-status-icon" data-role="roaming" data-icon="roaming" hidden aria-label="Roaming"></button>
                    <button type="button" class="wm-status-icon" data-role="signal" hidden aria-label="Phone signal"></button>
                    <button type="button" class="wm-status-icon" data-role="volume" data-icon="volume" aria-label="Volume"></button>
                    <button type="button" class="wm-status-icon" data-role="battery" hidden aria-label="Battery"></button>
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
            <div class="wm-msgbox-layer" hidden></div>
            <div class="wm-busy" role="status" aria-live="polite" hidden><img class="wm-busy-wait" alt="Please wait" draggable="false" hidden></div>
            <div class="wm-bubble" role="dialog" hidden></div>
            <div class="wm-notify-tray" role="listbox" aria-label="Notifications" hidden></div>
            <div class="wm-notify" role="alertdialog" hidden></div>`;
        document.body.appendChild(shell);

        shell.querySelector('.wm-start').addEventListener('click', (e) => {
            e.stopPropagation();
            toggleStartMenu();
        });
        // WM opens Start from the title too: a tap on the title bar's left part (the title, up to
        // the status icons) does what the Start button does, the menu, focus and history alike
        shell.querySelector('.wm-title').addEventListener('click', (e) => {
            const start = shell.querySelector('.wm-start');
            if (start.disabled || !start.getClientRects().length) return;
            e.stopPropagation();
            try { start.focus({ preventScroll: true }); } catch (_) { /* focus is a nicety */ }
            start.click();
        });
        shell.querySelector('.wm-title-action').addEventListener('click', (e) => pressTitleAction(e.currentTarget.dataset.kind));
        shell.querySelectorAll('.wm-softkey').forEach((btn) => {
            btn.addEventListener('click', (e) => {
                e.stopPropagation();
                pressSoftKey(btn.dataset.side, btn);
            });
        });
        shell.querySelectorAll('.wm-status-app').forEach((b) => { b.style.backgroundImage = artImageSet(STATUS_APP_ICONS[b.dataset.role]); });
        shell.querySelectorAll('.wm-status-icon').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                if (b.dataset.role === 'notify') noteIconTap();
                else statusBubble(b.dataset.role, b);
            });
        });
        shell.querySelector('.wm-sip').addEventListener('click', () => {
            // the current app's page only: a field on a hidden page must not take the keyboard
            const app = current && apps.get(current);
            const scope = (app && app.page) || shell.querySelector('.wm-content');
            const input = [...scope.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), textarea:not([disabled])')]
                .find((el) => el.getClientRects().length) || shell.querySelector('.wm-searchbar:not([hidden]) input');
            if (input) input.focus();
        });
        document.addEventListener('click', (e) => {
            // a tap outside an open bubble hides it (its own buttons and links close it too)
            const bub = shell.querySelector('.wm-bubble');
            if (!bub.hidden && !bub.contains(e.target) && !(e.target.closest && e.target.closest('#wmShell .wm-status-icon'))) closeBubble();
            // the notification tray closes on a tap elsewhere (the bubble itself stays, as on the device)
            if (noteTrayOpen && !(e.target.closest && e.target.closest('#wmShell .wm-notify-tray, #wmShell [data-role="notify"]'))) { noteTrayOpen = false; renderNotes(); }
            if (!openPopup || openPopup.contains(e.target)) return;
            // Start and the soft keys toggle their own menus: closing here first would let
            // their click handler open the menu again
            if (e.target.closest && e.target.closest('#wmShell .wm-start, #wmShell .wm-title, #wmShell .wm-softkey, #wmShell [aria-haspopup="menu"]')) return;
            closeMenus();
        }, true);
        window.addEventListener('keydown', (e) => {
            if (busyBlocksKey()) {
                // busy: keys (soft keys, back, Enter) wait with the taps
                e.preventDefault();
                e.stopImmediatePropagation();
                return;
            }
            if (e.key === 'Escape' && openPopup) {
                const sub = openPopup.querySelector(':scope > .wm-popup-sub');
                if (sub) { closeSubmenu(openPopup); syncHistory(); } else closeMenus();
                e.preventDefault();
                e.stopImmediatePropagation(); // the picture behind the menu stays open
                return;
            }
            if (e.key === 'Escape' && !e.repeat && escapeIsBack(e)) {
                e.preventDefault();
                e.stopImmediatePropagation();
                backKey();
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
        if (busyCount > 0 && !ignorePops) {
            // back while busy: nothing closes under a running operation; the entry comes back after
            busyPopped = true;
            return true;
        }
        if (ignorePops > 0) {
            // our own history.go(): the layers already match
            ignorePops--;
            if (!ignorePops) syncHistory();
            return true;
        }
        // the user went back one step: close the top layer (menu, then the picture view, then the
        // app). Nothing is pushed here: Chrome on Android skips entries added without a tap, so
        // entries are only added when something is opened.
        const closed = closeTopLayer();
        if (closed) syncHistory({ noPush: true });
        return closed;
    }

    /** One back step: the top layer closes. false = nothing to close (Today, no menu or bubble). */
    function closeTopLayer() {
        let closed = false;
        const sub = openPopup && openPopup.querySelector(':scope > .wm-popup-sub');
        if (sub) {
            // back steps out of a submenu to its parent menu (the parent keeps its entry)
            closeSubmenu(openPopup);
            closed = true;
        } else if (openPopup) {
            closeMenus(true);
            closed = true;
        } else if (noteTrayOpen || noteShownNote()) {
            // a notification bubble or the tray: back hides it (the notification stays in the title bar)
            if (noteTrayOpen) { noteTrayOpen = false; renderNotes(); } else hideNote();
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
        return closed;
    }

    /**
     * The Dreamscape Android app turns its back key into Escape (DSApp-Kotlin MainActivity:
     * onBackPressedDispatcher -> KEYCODE_ESCAPE), the desktop's "close the top window". On the phone it
     * is WM's back key: Escapes that a phone surface handles itself pass (a WM message box, the shell's own
     * text boxes, the tag autocomplete / character card / metadata overlays); every other one steps back
     * one layer, and the desktop's Escape handlers never see it (they would close a re-hosted window).
     */
    function escapeIsBack(e) {
        if (root.dataset.wmBoot && root.dataset.wmBoot !== 'done') return false;
        if (root.dataset.wmTakeover) return false;
        const box = shell.querySelector('.wm-msgbox-layer');
        if (box && !box.hidden) return false;
        // the desktop's question: back answers it (confirmationDialog.js takes Escape as Cancel), not the app under it
        if (root.hasAttribute('data-wm-dialog')) return false;
        const t = e.target;
        if (t && t.closest && t.closest('#wmShell') && t.matches && t.matches('input:not([type=checkbox]):not([type=radio]):not([type=range]):not([type=button])')) return false;
        // fixed overlays have no offsetParent: a box on screen is the test
        const shown = (id) => { const el = document.getElementById(id); return !!(el && !el.classList.contains('hidden') && el.getClientRects().length); };
        if (shown('characterAutocompleteOverlay') || shown('presetAutocompleteOverlay') || shown('metadataDialog')) return false;
        return true;
    }

    function backKey() {
        // with a history entry for the layer, go back through history so the entries stay in step
        if (historyDepth() > 0) { history.back(); return; }
        if (closeTopLayer()) syncHistory({ noPush: true });
    }

    let titleText = 'Start';

    /** The app's title; while the Start menu is open the bar shows the Start button's text (WM). */
    function setTitle(text) {
        titleText = text;
        if (!shell.querySelector('.wm-titlebar').classList.contains('is-start-open')) shell.querySelector('.wm-title').textContent = text;
    }

    /** WM 6.1's open-Start title bar: glow, the Start text in the menu's rule colour (wm-shell.css). */
    function markStartOpen(on) {
        const bar = shell.querySelector('.wm-titlebar');
        if (bar.classList.contains('is-start-open') === on) return;
        bar.classList.toggle('is-start-open', on);
        shell.querySelector('.wm-title').textContent = on ? startButtonPrefs().text : titleText;
    }

    /** Settings > Menus > Start button (wmPrograms.js): text and icon, live; WM's by default. */
    function startButtonPrefs() {
        try {
            if (window.wmSettings && typeof window.wmSettings.startButton === 'function') {
                const b = window.wmSettings.startButton();
                if (b && b.text) return b;
            }
        } catch (_) { /* settings not loaded */ }
        return { text: 'Start', icon: '/static_images/melaton/melaton-white-256.png' };
    }

    function applyStartButton() {
        if (!shell) return;
        const b = startButtonPrefs();
        const img = shell.querySelector('.wm-start img');
        if (img && b.icon && img.getAttribute('src') !== b.icon) {
            img.setAttribute('src', b.icon);
            if (b.icon === art('start-flag')) img.setAttribute('srcset', srcset('start-flag'));
            else img.removeAttribute('srcset');
        }
        // the Windows flag keeps WM's own colours and Start-cell metrics (wm-shell.css)
        shell.querySelector('.wm-start').classList.toggle('is-flag', b.icon === art('start-flag'));
        shell.querySelector('.wm-start').setAttribute('aria-label', b.text);
        if (current === 'today' && !viewerActive && root.dataset.wmBoot !== 'install') setTitle(b.text);
    }

    function setTitleAction(kind) {
        const btn = shell.querySelector('.wm-title-action');
        kind = kind === 'ok' || kind === 'close' ? kind : null;
        if (btn.hidden === !kind && (!kind || btn.dataset.kind === kind)) return;
        btn.hidden = !kind;
        if (kind) {
            btn.dataset.kind = kind;
            btn.setAttribute('aria-label', kind === 'ok' ? 'OK' : 'Close');
        }
        fitStatus();
    }

    // the boot screens' own corner: none while wceload copies, ok on its last page
    let bootTitleKind = null;

    /** A modal on screen takes the corner away (WM: a message box, a bubble with an OK button). */
    function modalUp() {
        const box = shell.querySelector('.wm-msgbox-layer');
        if (box && !box.hidden) return true;
        const b = shell.querySelector('.wm-bubble');
        if (b && !b.hidden && b.dataset.modal === '1') return true;
        // the desktop's confirmation / input dialog, drawn as a WM message box
        const c = document.getElementById('confirmationDialog');
        return !!(c && !c.classList.contains('hidden') && c.getClientRects().length);
    }

    /**
     * WM 6.1's rule for the title bar's corner, for whatever is on screen now: 'close' (X, Smart
     * Minimize) on an app's main view, 'ok' on a form / page / viewer / editor, null (nothing) on
     * Today, under a modal and on a dialog with its own OK / Cancel. The app names its layer.
     */
    function titleKindNow() {
        const boot = root.dataset.wmBoot;
        if (boot === 'oem' || boot === 'splash' || boot === 'install') return boot === 'install' ? bootTitleKind : null;
        if (modalUp()) return null;
        if (viewerActive && !viewerClosing) return 'ok';
        if (!current || current === 'today') return null;
        const app = apps.get(current);
        if (!app) return null;
        let kind;
        if (typeof app.titleKind === 'function') {
            try { kind = app.titleKind(); } catch (_) { kind = 'close'; }
        } else if (titleKinds.has(current)) kind = titleKinds.get(current);
        else kind = 'titleAction' in app ? app.titleAction : 'close';
        return kind === 'ok' || kind === 'close' ? kind : null;
    }

    // what apps without titleKind() set with wmShell.setTitleAction (their current layer's corner)
    const titleKinds = new Map();

    function refreshTitleAction() {
        if (shell) setTitleAction(titleKindNow());
    }

    /** The corner button: ok confirms the layer and goes back one screen, X minimizes the app. */
    function pressTitleAction(kind) {
        if (viewerActive) { closeViewer(); return; }
        const app = current && apps.get(current);
        if (kind === 'ok' && app) {
            if (typeof app.onTitleOk === 'function' && app.onTitleOk()) { syncHistory({ noPush: true }); refreshTitleAction(); return; }
            // the app's own back step (a page, a sub-view), as the back key takes it
            if (typeof app.onBack === 'function' && app.historyDepth && Number(app.historyDepth()) > 0 && app.onBack()) {
                syncHistory({ noPush: true });
                renderSoftKeys();
                return;
            }
        }
        // X inside a folder of a folder-like app (Programs: closeGoesBack) goes up to the parent
        // folder, not out of the app (Yukimi, Nov 10)
        if (kind === 'close' && app && app.closeGoesBack && typeof app.onBack === 'function'
            && typeof app.historyDepth === 'function' && Number(app.historyDepth()) > 0 && app.onBack()) {
            syncHistory({ noPush: true });
            renderSoftKeys();
            refreshTitleAction();
            return;
        }
        // X closes the app (Yukimi, Nov 10: as on WM; multitasking is the Start menu): its own close
        // (onTitleClose: Studio, the Director and hosted programs close their windows their way),
        // then it ends (endApp: a fresh page next time, off the Start strip). ok on an app's only
        // screen goes back, keeping the app.
        if (kind === 'close' && app && current !== 'today') {
            const id = current;
            const close = () => {
                if (typeof app.onTitleClose === 'function') {
                    try { app.onTitleClose(); } catch (err) { console.warn('[wmShell] onTitleClose', id, err); }
                }
                if (!endApp(id)) back();
            };
            // an app with work under way asks first (closeQuestion(): its text, or null); it can
            // also be minimized and left running, the Start menu brings it back
            let question = null;
            try { question = typeof app.closeQuestion === 'function' ? app.closeQuestion() : null; } catch (_) { question = null; }
            if (!question) { close(); return; }
            messageBox({
                title: app.title || 'Melaton Mobile',
                icon: 'question',
                text: question,
                buttons: [{ text: 'Close', value: 'close', default: true }, { text: 'Minimize', value: 'min' }, { text: 'Cancel', value: null }],
                cancelValue: null
            }).then((v) => {
                if (current !== id) return;
                if (v === 'close') close();
                else if (v === 'min') back();
            });
            return;
        }
        back();
    }

    // ---------------------------------------------------------------- soft keys

    let softKeys = { left: null, right: null };
    let lastModal = false; // a message box was up when the keys were last drawn

    function renderSoftKeys() {
        const app = current && apps.get(current);
        // a message box (the shell's, or the desktop's question drawn as one) owns the screen: its own
        // buttons answer it, the soft keys go blank (WM 6.1's MessageBox) and the app's keys under it
        // cannot be pressed through it
        lastModal = modalUp();
        softKeys = lastModal ? { left: null, right: null }
            : noteShownNote() ? noteSoftKeys()
            : viewerActive ? viewerSoftKeys()
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
        // the corner follows the same layer as the soft keys
        refreshTitleAction();
    }

    function pressSoftKey(side, btn) {
        // a box that came up since the keys were drawn (the poll below has not caught it yet)
        if (modalUp()) { if (!lastModal) renderSoftKeys(); return; }
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
        // WM never draws two separators in a row or one at an end: items left out on a condition
        // (Clear Today Background) must not leave a doubled line (#723)
        const isSep = (it) => it === '-' || !!(it && it.separator);
        const filteredItems = [];
        let lastSep = null;
        for (const it of items) {
            if (!it) continue;
            if (isSep(it)) {
                if (filteredItems.length > 0) lastSep = it;
            } else {
                if (lastSep) {
                    filteredItems.push(lastSep);
                    lastSep = null;
                }
                filteredItems.push(it);
            }
        }
        items = filteredItems;
        for (const item of items) {
            if (isSep(item)) {
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
            // path levels in a drop-down (File Explorer's folder list): 12 px per level
            if (item.indent) b.style.setProperty('--wm-indent', String(Number(item.indent) || 0));
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
        // a long list that scrolls (the Director's models) opens on its current choice
        const on = sub.scrollHeight > sub.clientHeight && sub.querySelector(':scope > [aria-checked="true"]');
        if (on) sub.scrollTop = Math.max(0, on.offsetTop - (sub.clientHeight - on.offsetHeight) / 2);
        if (!hadSub) syncHistory();
    }

    function showPopup(side, items, btn) {
        closeMenus(true);
        const pop = shell.querySelector('.wm-popup');
        pop.dataset.side = side;
        pop.style.top = pop.style.left = pop.style.right = pop.style.bottom = '';
        // sizes an app gave its last menu (a combo's width, a scroll limit) do not carry over
        pop.style.minWidth = pop.style.maxWidth = pop.style.maxHeight = pop.style.overflowX = pop.style.overflowY = '';
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
        markStartOpen(false);
        shell.querySelectorAll('.wm-softkey').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        openPopup = null;
        if (had && !silent) syncHistory();
    }

    // ---------------------------------------------------------------- Start menu

    function toggleStartMenu() {
        const menu = shell.querySelector('.wm-startmenu');
        if (!menu.hidden) { closeMenus(); return; }
        closeMenus(true);
        // WM 6.1's Start menu: pinned programs | recent programs | Programs, Settings, Help. Above
        // them, as on WM 5 / 6.0, a strip of icons: here the apps open in this session, to switch
        // between them (the current one framed)
        // Settings > Menus: the apps chosen for the Start menu (each keeps its group)
        let chosen = null;
        try { chosen = JSON.parse(localStorage.getItem('wmStartMenu') || 'null'); } catch (_) { chosen = null; }
        const items = [...apps.values()].filter((a) => a.inStart && (!Array.isArray(chosen) || chosen.includes(a.id) || a.inStart === 'system'));
        const pinned = items.filter((a) => a.inStart === 'top');
        const lower = items.filter((a) => a.inStart === 'bottom');
        const system = ['programs', 'settings', 'help'].map((id) => apps.get(id)).filter((a) => a && a.inStart === 'system')
            .concat(items.filter((a) => a.inStart === 'system' && !['programs', 'settings', 'help'].includes(a.id)));
        const running = openedApps.filter((id) => apps.has(id));
        const row = (a) => `<button type="button" class="wm-startmenu-item" role="menuitem" data-app="${escapeHtml(a.id)}">${imgTag(a.icon)}<span>${escapeHtml(a.startLabel || a.title)}</span></button>`;
        const sep = '<div class="wm-startmenu-sep" role="separator"></div>';
        const strip = running.length
            ? `<div class="wm-startmenu-running" role="group" aria-label="Open programs">${running.map((id) => {
                const a = apps.get(id);
                return `<button type="button" class="wm-startmenu-run${id === current ? ' is-current' : ''}" data-app="${escapeHtml(id)}" title="${escapeHtml(a.startLabel || a.title)}" aria-label="${escapeHtml(a.startLabel || a.title)}">${imgTag(a.icon)}</button>`;
            }).join('')}</div>${sep}`
            : '';
        menu.innerHTML = strip + pinned.map(row).join('')
            + (lower.length ? sep + lower.map(row).join('') : '')
            + (system.length ? sep + system.map(row).join('') : '');
        menu.querySelectorAll('.wm-startmenu-run').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenus();
                // switching keeps the app as it was (its page stays mounted)
                switchTo(b.dataset.app);
            });
        });
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
        markStartOpen(true);
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

    // apps opened in this session, most recent first (the Start menu's strip)
    const openedApps = [];
    const MAX_OPEN_STRIP = 6;

    function noteOpened(id) {
        const app = apps.get(id);
        if (!app || id === 'today' || !app.inStart) return;
        const at = openedApps.indexOf(id);
        if (at >= 0) openedApps.splice(at, 1);
        openedApps.unshift(id);
        if (openedApps.length > MAX_OPEN_STRIP) openedApps.length = MAX_OPEN_STRIP;
    }

    /** Bring an open app to the front over Today, as it was left. */
    function switchTo(id) {
        if (id === current) return;
        open(id, { fromStart: true });
    }

    function activate(id) {
        const app = apps.get(id);
        if (!app) return;
        noteOpened(id);
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
        setTitle(id === 'today' ? startButtonPrefs().text : (app.title || id));
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

    /**
     * End an app (Task Manager's End Task): its hide() and onEnd() run, its page is removed (mounted
     * afresh on the next open), and it leaves the back stack and the Start menu's strip.
     */
    function endApp(id) {
        const app = apps.get(id);
        if (!app || id === 'today' || id === 'programs' || id === 'settings') return false;
        if (current === id) back({ app: true });
        if (current === id) activate('today');
        try { if (typeof app.onEnd === 'function') app.onEnd(); } catch (err) { console.warn('[wmShell] onEnd', id, err); }
        // a page that carries desktop windows (Studio's #manualModal, the Director, hosted programs)
        // is never removed: the windows would go with it. Those apps only leave the stack and strip.
        if (app.page && !app.page.querySelector('.modal')) { app.page.remove(); app.page = null; }
        for (let i = stack.length - 1; i >= 0; i--) if (stack[i] === id) stack.splice(i, 1);
        const at = openedApps.indexOf(id);
        if (at >= 0) openedApps.splice(at, 1);
        syncHistory({ noPush: true });
        return true;
    }

    /** One screen back; { app: true } = the current app's page itself (a form or file dialog ending), not the picture view over it. */
    function back(opts) {
        closeMenus(true);
        // the picture view is the top layer: back closes it first, as the title's ok and the back key do
        if (!(opts && opts.app) && viewerActive && !viewerClosing) { viewerClosing = true; closeViewer(); return; }
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
            refreshTitleAction();
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
        applyStartButton();
        const ws = window.wsClient;
        const connected = !!(ws && typeof ws.isConnected === 'function' && ws.isConnected());
        const data = shell.querySelector('[data-role="data"]');
        const dev = deviceView();
        // the phone's own link when the Android app or the browser says what it is; else Dreamscape's
        data.dataset.icon = dev.link ? dev.link.icon : connected ? 'data-on' : 'data-off';
        data.title = dev.link ? dev.link.text : connected ? 'Connected' : 'Not connected';
        const sig = shell.querySelector('[data-role="signal"]');
        sig.hidden = !dev.signal;
        if (dev.signal) { sig.dataset.icon = dev.signal.icon; sig.title = dev.signal.text; }
        shell.querySelector('[data-role="roaming"]').hidden = !(dev.cell && dev.cell.roaming === true && dev.signal && dev.signal.icon !== 'signal-off');
        const bat = shell.querySelector('[data-role="battery"]');
        bat.hidden = !dev.battery;
        if (dev.battery) { bat.dataset.icon = dev.battery.icon; bat.title = dev.battery.text; }
        const vol = shell.querySelector('[data-role="volume"]');
        let muted = false;
        try { muted = !!(window.tabVolume && typeof window.tabVolume.isMuted === 'function' && window.tabVolume.isMuted()); } catch (_) { /* volume unknown */ }
        vol.dataset.icon = muted ? 'volume-off' : 'volume';
        // pending things, as WM shows a notification glyph: the Director (an open clapper that claps
        // while a turn runs; closed while it is idle and its app is open), prints in progress,
        // unread mail, an update downloaded and ready to install
        const dir = directorState();
        const dirOpen = stack.includes('director') || openedApps.includes('director');
        shell.querySelector('[data-role="director"]').hidden = !((dir && dir.running) || dirOpen);
        paintDirectorClap(!!(dir && dir.running));
        let updateReady = false;
        try { updateReady = !!(window.serviceWorkerManager && window.serviceWorkerManager.hasPendingUpdates()); } catch (_) { updateReady = false; }
        shell.querySelector('[data-role="update"]').hidden = !updateReady;
        shell.querySelector('[data-role="prints"]').hidden = !printsInProgress();
        const mailEl = shell.querySelector('[data-role="mail"]');
        mailEl.hidden = !(shellMailUnread > 0);
        if (noteTrayOpen) renderNotes(); else fitStatus();
        const bubble = shell.querySelector('.wm-bubble');
        if (!bubble.hidden && bubble.dataset.role) statusBubble(bubble.dataset.role, shell.querySelector(statusFolded.includes(bubble.dataset.role) ? '[data-role="notify"]' : `.wm-status-icon[data-role="${bubble.dataset.role}"]`), true);
        const today = apps.get('today');
        if (today && typeof today.refresh === 'function' && current === 'today') today.refresh();
        // notifications held back during startup or a takeover come up once it ends
        if (notes.length && !noteShown && notesMayPop()) refreshNotes();
    }

    /**
     * A narrow title bar makes room so the title keeps its floor (.wm-title min-width): roaming goes
     * first, then mail, prints and the Director fold into the notification bubble (WM shows one
     * speech bubble for several pending notifications; the tray lists them), then volume. The
     * signal and a known battery always stay.
     */
    let statusFolded = [];
    /**
     * The title bar sheds status icons that do not fit. Measured after the next paint, once per
     * frame: measuring in the tap forced a layout of the whole dirty page (~250 ms on a cold Studio
     * open at 4x, #723).
     */
    let fitQueued = false;
    let clapTimer = null;
    let clapFrame = 0;
    /** The Director icon: the clapper claps while a turn runs, closed otherwise (timers: no rAF in background tabs). */
    function paintDirectorClap(working) {
        const el = shell && shell.querySelector('[data-role="director"]');
        if (!el) return;
        if (!working || el.hidden) {
            if (clapTimer) { clearInterval(clapTimer); clapTimer = null; }
            if (el.dataset.clap !== 'closed') { el.dataset.clap = 'closed'; el.style.backgroundImage = artImageSet('status-director'); }
            return;
        }
        if (clapTimer) return;
        el.dataset.clap = 'working';
        clapTimer = setInterval(() => {
            if (document.hidden) return;
            clapFrame = (clapFrame + 1) % DIRECTOR_CLAP.length;
            el.style.backgroundImage = artImageSet(DIRECTOR_CLAP[clapFrame]);
        }, 140);
    }

    function fitStatus() {
        if (!shell || fitQueued) return;
        fitQueued = true;
        afterPaint().then(() => { fitQueued = false; fitStatusNow(); });
    }

    /*
     * The camera in the title bar (#735): the Fold7's inner screen has an under-display camera at
     * about x 644..676, y 8..39 (CSS px), which Android does not report as a cutout. The Android app
     * passes it (and real cutouts) as --camera-hole-left/top/width/height on <html>. When it sits in
     * the bar right of the title's start, the title ends before it (ellipsis), a spacer covers it and
     * the tray icons stay right of it; fitStatusNow() then sheds what no longer fits.
     */
    /**
     * Screen > Camera > Black bezel: the band goes along the edge the camera is on, as tall (or wide)
     * as the camera area; none when the camera is away from the edges. A turned phone moves the
     * camera to a side, so the top band goes and a side band comes (#735).
     */
    /** Screen > Camera > Only in portrait: a turned phone (wider than tall) ignores the camera. */
    function cameraIgnoredNow() {
        let only = false;
        try { only = localStorage.getItem('wmCameraPortraitOnly') === '1'; } catch (_) { /* storage off */ }
        return only && window.innerWidth > window.innerHeight;
    }

    function syncBezel() {
        const style = root.style;
        const v = (n) => parseFloat(style.getPropertyValue(n)) || 0;
        const h = { left: v('--camera-hole-left'), top: v('--camera-hole-top'), width: v('--camera-hole-width'), height: v('--camera-hole-height') };
        if (cameraIgnoredNow()) {
            ['--wm-bezel-top', '--wm-bezel-left', '--wm-bezel-right'].forEach((n) => style.setProperty(n, '0px'));
            if (root.dataset.wmBezelEdge !== 'none') root.dataset.wmBezelEdge = 'none';
            return;
        }
        const margin = 6;
        const near = 64;
        let edge = 'none';
        if (!(h.width > 0 && h.height > 0)) edge = 'top'; // no camera reported (a browser): a plain top bezel
        else if (h.top < near) edge = 'top';
        else if (h.left < near) edge = 'left';
        else if (h.left + h.width > window.innerWidth - near) edge = 'right';
        const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        style.setProperty('--wm-bezel-top', edge === 'top' ? `${Math.max(h.top + h.height + margin, 18 * px)}px` : '0px');
        style.setProperty('--wm-bezel-left', edge === 'left' ? `${h.left + h.width + margin}px` : '0px');
        style.setProperty('--wm-bezel-right', edge === 'right' ? `${window.innerWidth - h.left + margin}px` : '0px');
        if (root.dataset.wmBezelEdge !== edge) root.dataset.wmBezelEdge = edge;
    }

    function applyCameraHole(bar) {
        syncBezel();
        const title = bar.querySelector('.wm-title');
        const status = bar.querySelector('.wm-status');
        let left = bar.querySelector('.wm-status-left');
        let gap = bar.querySelector('.wm-cutout-gap');
        // icons back on the right in their WM order before every fit
        if (!status._wmOrder) status._wmOrder = Array.from(status.querySelectorAll('.wm-status-icon'));
        if (left && left.firstElementChild) status.prepend(...status._wmOrder.filter((i) => i.parentElement === left));
        const style = document.documentElement.style;
        const v = (n) => parseFloat(style.getPropertyValue(n)) || 0;
        const hole = { left: v('--camera-hole-left'), top: v('--camera-hole-top'), width: v('--camera-hole-width'), height: v('--camera-hole-height') };
        // the bezel option puts the camera above the screen: nothing to keep clear in the bar
        const bezel = root.dataset.wmCamera === 'bezel';
        const br = bar.getBoundingClientRect();
        const tl = title.getBoundingClientRect().left;
        const pad = 3 * (parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1);
        const inBar = !bezel && !cameraIgnoredNow() && hole.width > 0 && hole.height > 0 && hole.top < br.bottom && hole.top + hole.height > br.top
            && hole.left - pad > tl && hole.left + hole.width < br.right;
        if (!inBar) {
            if (gap) gap.remove();
            if (left) left.remove();
            title.style.flex = '';
            status.style.marginLeft = '';
            return;
        }
        if (!left) {
            left = document.createElement('div');
            left.className = 'wm-status-left';
            title.after(left);
        }
        if (!gap) {
            gap = document.createElement('div');
            gap.className = 'wm-cutout-gap';
            gap.setAttribute('aria-hidden', 'true');
            left.after(gap);
        }
        gap.style.width = `${hole.width + 2 * pad}px`;
        status.style.marginLeft = 'auto';
        // what does not fit right of the camera moves left of it, keeping the order (first icons first)
        const room = br.right - (hole.left + hole.width + pad);
        const shown = () => status._wmOrder.filter((i) => i.parentElement === status && !i.hidden);
        while (status.getBoundingClientRect().width > room && shown().length > 1) {
            const first = shown()[0];
            // hidden icons before it go along, so each side keeps WM's order when one appears
            status._wmOrder.slice(0, status._wmOrder.indexOf(first) + 1).forEach((i) => { if (i.parentElement === status) left.append(i); });
        }
        const lw = left.firstElementChild ? left.getBoundingClientRect().width : 0;
        title.style.flex = `0 0 ${Math.max(0, hole.left - pad - tl - lw)}px`;
    }

    function fitStatusNow() {
        if (!shell) return;
        const bar = shell.querySelector('.wm-titlebar');
        const el = (r) => shell.querySelector(`.wm-status-icon[data-role="${r}"]`);
        const fits = () => bar.scrollWidth <= bar.clientWidth + 1;
        ['roaming', 'volume', ...STATUS_APP_ROLES].forEach((r) => el(r).classList.remove('wm-shed'));
        statusFolded = [];
        paintNotifyIcon();
        applyCameraHole(bar);
        if (fits()) return;
        if (!el('roaming').hidden) { el('roaming').classList.add('wm-shed'); if (fits()) return; }
        const apps = STATUS_APP_ROLES.filter((r) => !el(r).hidden);
        if (apps.length) {
            apps.forEach((r) => el(r).classList.add('wm-shed'));
            statusFolded = apps;
            paintNotifyIcon();
            if (fits()) return;
        }
        if (!el('volume').hidden) el('volume').classList.add('wm-shed');
    }

    // ---------------------------------------------------------------- status: device (battery, signal, data, Wi-Fi)

    /*
     * The Android app (DSApp-Kotlin) exposes window.AndroidDeviceStatus.getState() -> JSON and fires
     * 'androiddevicestatus' (detail = the same object) on every change. Contract v1:
     * { v, battery { level, charging, plugged, saver }, cellular { present, radioOn, airplane, simState,
     * operator, level 0-4, searching, dataType, dataEnabled, dataActive, roaming },
     * wifi { enabled, connected, level 0-4, ssid }, active: wifi|cellular|ethernet|vpn|none }.
     * Every field is optional (null = unknown, never guessed); a later "v" only adds fields.
     * Without the app: navigator.getBattery() and navigator.connection, showing only what they know.
     */
    let deviceStatus = null;
    let webBattery = null;
    // WM 6.1 letters; LTE and 5G are Melaton's own (drawn in the same style, see manifest.json)
    const DATA_ICON = { GPRS: 'g', EDGE: 'e', '3G': '3g', HSPA: 'h', 'HSPA+': 'h-plus', LTE: '4g', 'LTE+': '4g-plus', '5G': '5g', '5G+': '5g-plus' };
    const DATA_NAME = { GPRS: 'GPRS', EDGE: 'EDGE', '3G': '3G', HSPA: 'HSPA', 'HSPA+': 'HSPA+', LTE: 'LTE', 'LTE+': 'LTE+', '5G': '5G', '5G+': '5G+' };

    function takeDeviceStatus(s) {
        if (typeof s === 'string') { try { s = JSON.parse(s); } catch (_) { return; } }
        if (!s || typeof s !== 'object') return;
        deviceStatus = s;
        refreshStatus();
    }

    function pollDeviceBridge() {
        const b = window.AndroidDeviceStatus;
        if (!b || typeof b.getState !== 'function') return false;
        try { takeDeviceStatus(b.getState()); } catch (_) { /* bridge not ready */ }
        return true;
    }

    function watchDevice() {
        window.addEventListener('androiddevicestatus', (e) => takeDeviceStatus(e && e.detail));
        pollDeviceBridge();
        if (typeof navigator.getBattery === 'function') {
            navigator.getBattery().then((b) => {
                const upd = () => {
                    // a machine without a battery reports a full one on charge that never ends
                    const none = b.charging && b.level >= 1 && (b.chargingTime === 0 || b.chargingTime === Infinity) && b.dischargingTime === Infinity;
                    webBattery = none ? null : { level: Math.round(b.level * 100), charging: !!b.charging };
                    refreshStatus();
                };
                upd();
                ['levelchange', 'chargingchange'].forEach((t) => b.addEventListener(t, upd));
            }).catch(() => { /* no Battery Status API */ });
        }
        const c = navigator.connection;
        if (c && typeof c.addEventListener === 'function') c.addEventListener('change', () => refreshStatus());
    }

    const objOr = (o) => (o && typeof o === 'object' ? o : null);
    const bars = (n) => `${n} of 4 ${n === 1 ? 'bar' : 'bars'}`;

    /** What the title bar shows for the phone: { cell, wifi, active, link, signal, battery }. */
    function deviceView() {
        if (!deviceStatus && window.AndroidDeviceStatus) pollDeviceBridge();
        const d = deviceStatus || {};
        const cell = objOr(d.cellular);
        const wifi = objOr(d.wifi);
        const bat = objOr(d.battery);
        let active = typeof d.active === 'string' ? d.active : null;
        if (!active && !deviceStatus) {
            const c = navigator.connection;
            const t = c && typeof c.type === 'string' ? c.type : '';
            active = { wifi: 'wifi', cellular: 'cellular', wimax: 'cellular', ethernet: 'ethernet', none: 'none' }[t] || null;
        }
        if (!active && cell && cell.dataActive === true) active = 'cellular';
        if (!active && wifi && wifi.connected === true) active = 'wifi';
        const airplane = !!(cell && cell.airplane === true);
        const type = cell && typeof cell.dataType === 'string' && DATA_ICON[cell.dataType] ? cell.dataType : null;
        const wifiName = wifi && typeof wifi.ssid === 'string' && wifi.ssid ? wifi.ssid : null;
        // connectivity: the link in use, else what could be used
        let link = null;
        if (active === 'wifi') link = { icon: 'wifi-connected', text: wifiName ? `Wi-Fi: ${wifiName}` : 'Wi-Fi: connected' };
        else if (active === 'cellular') link = { icon: type ? `data-${DATA_ICON[type]}-active` : 'data-on', text: type ? `${DATA_NAME[type]}: connected` : 'Cellular data: connected' };
        else if (active === 'ethernet') link = { icon: 'data-on', text: 'Wired network: connected' };
        else if (active === 'vpn') link = { icon: 'data-on', text: 'VPN: connected' };
        else if (active === 'none' || cell || wifi) {
            if (type && !airplane && cell.dataEnabled !== false) link = { icon: `data-${DATA_ICON[type]}`, text: `${DATA_NAME[type]} available` };
            else if (wifi && wifi.enabled === true) link = { icon: 'wifi-available', text: 'Wi-Fi on, not connected' };
            else if (active === 'none') link = { icon: 'data-off', text: 'No network connection' };
        }
        // signal: only for a phone with a modem
        let signal = null;
        if (cell && cell.present !== false) {
            const lvl = Number.isFinite(cell.level) ? Math.max(0, Math.min(4, Math.round(cell.level))) : null;
            if (airplane || cell.radioOn === false) signal = { icon: 'signal-off', text: airplane ? 'Flight mode' : 'Phone off' };
            else if (cell.simState === 'absent') signal = { icon: 'signal-alert', text: 'No SIM card' };
            else if (cell.simState === 'locked') signal = { icon: 'signal-alert', text: 'SIM locked' };
            else if (cell.searching === true) signal = { icon: 'signal-search', text: 'Searching for service' };
            else if (lvl === 0) signal = { icon: 'signal-none', text: 'No service' };
            else if (lvl != null) signal = { icon: `signal-${lvl}`, text: `Signal: ${bars(lvl)}` };
        }
        // battery: the app's numbers, else the browser's
        let level = null; let charging = null;
        if (bat && Number.isFinite(bat.level)) { level = Math.max(0, Math.min(100, Math.round(bat.level))); charging = typeof bat.charging === 'boolean' ? bat.charging : bat.plugged ? true : null; }
        else if (webBattery) { level = webBattery.level; charging = webBattery.charging; }
        let battery = null;
        if (level != null) {
            const icon = charging ? 'battery-charging' : level > 75 ? 'battery-full' : level > 50 ? 'battery-3' : level > 25 ? 'battery-2' : level > 10 ? 'battery-1' : 'battery-empty';
            battery = { icon, level, charging, plugged: bat && typeof bat.plugged === 'string' ? bat.plugged : null, saver: !!(bat && bat.saver === true), text: `Main battery: ${level}%${charging ? ', charging' : ''}` };
        }
        return { cell, wifi, active, airplane, type, wifiName, link, signal, battery };
    }

    // ---------------------------------------------------------------- status: shared state

    let shellDirectorStatus = null;
    let shellDirectorAsked = false;
    let shellMailUnread = 0;
    const GEN_REQUEST_TYPES = new Set(['generate_image', 'generate_preset', 'reroll_image', 'upscale_image', 'expand_image', 'reroll_expanded_image', 'enhance_image', 'max_enhance_image', 'animate_image']);

    /** { running, persona, name } from director_computer_status (null before the first answer). */
    function directorState() {
        const st = shellDirectorStatus || (window.directorInstance && window.directorInstance._status) || null;
        if (!st) {
            const ws = window.wsClient;
            if (!shellDirectorAsked && ws && ws.initializationCompleted && typeof ws.sendMessage === 'function') {
                shellDirectorAsked = true;
                ws.sendMessage('director_computer_status', {}, false)
                    .then((r) => { shellDirectorStatus = (r && (r.data || r)) || null; refreshStatus(); })
                    .catch(() => { /* no Director on this server */ });
            }
            return null;
        }
        const xi = st.xi && st.xi.running ? st.xi : null;
        if (xi) return { running: true, persona: 'Yozora', name: xi.sessionName || '' };
        return { running: !!st.running, persona: 'Director', name: st.sessionName || '' };
    }

    function watchDirector() {
        const ws = window.wsClient;
        if (!ws || typeof ws.on !== 'function') return;
        ws.on('director_computer_status', (d) => { shellDirectorStatus = (d && (d.data || d)) || shellDirectorStatus; refreshStatus(); });
    }

    function printsInProgress() {
        const ws = window.wsClient;
        let n = 0;
        if (ws && ws.pendingRequests && typeof ws.pendingRequests.forEach === 'function') {
            ws.pendingRequests.forEach((req) => { if (req && GEN_REQUEST_TYPES.has(req.type)) n++; });
        }
        return n;
    }

    // ---------------------------------------------------------------- notification bubble

    /**
     * WM notification bubble (device: Connectivity / Cannot Connect): rounded 2 px black frame 9 px
     * in from the sides, a tail up to the status icon that opened it, the title on a band in the
     * highlight colour, sections split by 1 px rules, blue underlined links, buttons at the right.
     * sections: strings, { html }, { links: [{ label, action }] }; buttons: [{ text, action }].
     */
    function bubble({ title, sections = [], buttons = [{ text: 'Hide' }], anchor = null, role = '' } = {}) {
        const el = shell.querySelector('.wm-bubble');
        el.innerHTML = '<span class="wm-bubble-tail" aria-hidden="true"></span>';
        el.dataset.role = role || '';
        // a bubble with an OK button is modal: the title bar's ok / X goes until it is answered
        // (WM: Phone's "A wireless radio must be attached"); a Hide bubble leaves it
        el.dataset.modal = (buttons || []).some((b) => /^ok$/i.test(String(b && b.text).trim())) ? '1' : '';
        const head = document.createElement('div');
        head.className = 'wm-bubble-title';
        head.textContent = title || '';
        el.appendChild(head);
        for (const sec of sections) {
            const part = document.createElement('div');
            part.className = 'wm-bubble-section';
            if (typeof sec === 'string') part.textContent = sec;
            else if (sec && sec.html) part.innerHTML = sec.html;
            else if (sec && sec.links) {
                part.classList.add('is-links');
                for (const l of sec.links) {
                    const a = document.createElement('button');
                    a.type = 'button';
                    a.className = 'wm-bubble-link';
                    a.textContent = l.label;
                    a.addEventListener('click', (e) => { e.stopPropagation(); closeBubble(); if (typeof l.action === 'function') l.action(); });
                    part.appendChild(a);
                }
            } else if (sec && sec.node) part.appendChild(sec.node);
            el.appendChild(part);
        }
        if (buttons && buttons.length) {
            const row = document.createElement('div');
            row.className = 'wm-bubble-buttons';
            for (const b of buttons) {
                const btn = document.createElement('button');
                btn.type = 'button';
                btn.textContent = b.text;
                btn.addEventListener('click', (e) => { e.stopPropagation(); closeBubble(); if (typeof b.action === 'function') b.action(); });
                row.appendChild(btn);
            }
            el.appendChild(row);
        }
        el.hidden = false;
        refreshTitleAction();
        // the tail points at the status icon
        if (anchor) {
            const sr = shell.getBoundingClientRect();
            const ar = anchor.getBoundingClientRect();
            el.style.setProperty('--wm-tail-x', `${Math.round(ar.left + ar.width / 2 - sr.left)}px`);
            el.classList.add('has-tail');
        } else {
            el.classList.remove('has-tail');
        }
    }

    function closeBubble() {
        const el = shell && shell.querySelector('.wm-bubble');
        if (el) { el.hidden = true; el.dataset.role = ''; el.dataset.modal = ''; }
        refreshTitleAction();
    }

    // ---------------------------------------------------------------- notifications

    /**
     * Desktop toasts (toastManager.js, #toastContainer) as WM 6.1 notifications (SHNotificationAdd,
     * captured on the emulator with ~/.cache/wm61/tools/wmnotify.exe): one bubble at a time, docked on
     * the soft key bar, title on a band in the highlight colour, a "◀ 1 of N ▶" pager when several are
     * waiting; soft keys Hide | Dismiss. The title bar shows the notification's icon (several: the
     * speech-bubble icon); a tap on it brings the bubble back (several: a strip of icons under the title
     * bar to pick from). Hide keeps it there and shows the next one nobody has seen. Identical toasts
     * (the same title and text, e.g. one "Updates Complete" per update batch) are one notification.
     * toastManager keeps the data: #toastContainer stays in the page, hidden, and the bubble's buttons
     * click the toast's own.
     */
    let notes = []; // [{ id (the newest toast), ids, type, title, toast }]
    let noteShown = null; // a toast id while its bubble is up
    let noteTrayOpen = false;
    // toast id + phase that have had their bubble: a progress toast that ends (updateGlassToastComplete,
    // its bar gone) is news again, so the result comes up even after the running one was hidden
    const noteSeen = new Set();
    const seenKey = (id, n) => `${id}\u0001${n.running ? 'running' : 'done'}`;
    let noteSnapshot = '';
    let noteQueued = false;
    let noteKeysFor = ''; // the soft keys on screen were made for this (bubble id + Dismiss or not)

    function readToasts() {
        const box = document.getElementById('toastContainer');
        if (!box) return [];
        const byKey = new Map();
        // toastManager prepends: walk oldest first so the list keeps arrival order
        for (const t of [...box.children].reverse()) {
            if (!t.id || t.classList.contains('removing') || t.dataset.wmBusy === '1') continue;
            const titleEl = t.querySelector('.toast-title');
            const msgEl = t.querySelector('.toast-message');
            const title = titleEl ? titleEl.textContent.trim() : '';
            const text = msgEl ? msgEl.textContent.replace(/\s+/g, ' ').trim() : '';
            const type = (t.className.match(/glass-toast-(\w+)/) || [])[1] || 'info';
            const key = `${type}\u0001${title}\u0001${text}`;
            let n = byKey.get(key);
            if (!n) { n = { ids: [], type, title, running: t.classList.contains('upload-progress') }; byKey.set(key, n); }
            n.ids.push(t.id);
            n.id = t.id;
            n.toast = t;
        }
        return [...byKey.values()];
    }

    const noteOf = (id) => (id ? notes.find((n) => n.ids.includes(id)) || null : null);
    const noteShownNote = () => noteOf(noteShown);

    /** Bubbles wait for startup and for full-screen takeovers (logon, errors). */
    function notesMayPop() {
        return (!root.dataset.wmBoot || root.dataset.wmBoot === 'done') && !root.dataset.wmTakeover;
    }

    function queueNotes() {
        if (noteQueued) return;
        noteQueued = true;
        // a timer, not a frame: a tab in the background still keeps its notifications
        setTimeout(() => { noteQueued = false; refreshNotes(); }, 30);
    }

    /**
     * Yukimi, Nov 10: dialogs for in-app information, notifications for background information. A
     * toast that answers what the user just did (answersUser: "Image deleted!", "Saved", an error
     * from the tap) is a WM message box over the app, titled with the app; the toast goes. Toasts
     * that arrive on their own (connection status, a print or mail that came in, progress, ones
     * with buttons) stay notifications.
     */
    const toastSeen = new WeakSet();
    let toastDialogs = Promise.resolve();
    const BACKGROUND_TOAST = /^(connecting|connected|connection|reconnect|offline|high latency|generation complete|you have mail|new mail|update)/i;

    function toastsToDialogs() {
        const box = document.getElementById('toastContainer');
        if (!box) return;
        for (const t of [...box.children].reverse()) {
            if (!t.id || toastSeen.has(t) || t.classList.contains('removing')) continue;
            toastSeen.add(t);
            if (!answersUser() || !notesMayPop()) continue;
            const title = ((t.querySelector('.toast-title') || {}).textContent || '').trim();
            if (BACKGROUND_TOAST.test(title)) continue;
            if (t.querySelector('.toast-buttons')) continue;
            const text = ((t.querySelector('.toast-message') || {}).textContent || '').replace(/\s+/g, ' ').trim();
            const type = (t.className.match(/glass-toast-(\w+)/) || [])[1] || 'info';
            // work under way for the user's tap (a progress toast, "Loading Gallery...", "Deleting..."):
            // the wait cursor while it lasts, no notification (Yukimi, Nov 10)
            const progress = t.classList.contains('upload-progress') || !!t.querySelector('.toast-progress') || !t.querySelector('.toast-close')
                || /^(loading|deleting|moving|copying|saving|uploading|downloading|processing|refreshing|applying)\b|\.\.\.$|\u2026$/i.test(title || text);
            if (progress) {
                t.dataset.wmBusy = '1';
                const release = busy(true, { delay: 250, timeout: 60000 });
                const watch = setInterval(() => { if (!t.isConnected || t.classList.contains('removing')) { clearInterval(watch); release(); } }, 250);
                continue;
            }
            // a routine done ("Image deleted!", "Moved 1 files", "Saved"): nothing, the result is on screen
            if (type === 'success') {
                if (typeof window.removeGlassToast === 'function') window.removeGlassToast(t.id);
                continue;
            }
            const icon = type === 'error' ? 'error' : type === 'warning' ? 'warning' : 'info';
            const app = current && current !== 'today' ? apps.get(current) : null;
            const boxTitle = title && title !== 'Dreamscape' ? title : ((app && app.title) || 'Melaton Mobile');
            if (typeof window.removeGlassToast === 'function') window.removeGlassToast(t.id);
            toastDialogs = toastDialogs.then(() => messageBox({ title: boxTitle, text: text || title, icon, modal: true }));
        }
    }

    function refreshNotes() {
        if (!shell) return;
        toastsToDialogs();
        notes = readToasts();
        const live = new Set(notes.flatMap((n) => n.ids.map((id) => seenKey(id, n))));
        for (const k of [...noteSeen]) if (!live.has(k)) noteSeen.delete(k);
        soundNewNotes(live);
        if (!noteOf(noteShown)) noteShown = null;
        if (!notes.length && !statusFolded.length) noteTrayOpen = false;
        if (!noteShown && !noteTrayOpen && notesMayPop()) {
            const next = notes.find((n) => !n.ids.some((id) => noteSeen.has(seenKey(id, n))));
            if (next) noteShown = next.id;
        }
        const shown = noteShownNote();
        if (shown) shown.ids.forEach((id) => noteSeen.add(seenKey(id, shown)));
        renderNotes();
        const keysFor = shown ? `${shown.id}:${!!shown.toast.querySelector('.toast-close')}` : '';
        if (keysFor !== noteKeysFor) { noteKeysFor = keysFor; renderSoftKeys(); }
    }

    /**
     * A notification sounds once as it arrives (SHNotificationAdd plays its class's Wave; the default
     * class is Alarm2.wav) and again when a running one ends with its result; updates in between are
     * silent. An error notice is an error (SystemHand, the Program Error event's settings). Notices
     * that came during startup or a takeover sound when they can show.
     */
    const noteSounded = new Set();
    function soundNewNotes(live) {
        for (const k of [...noteSounded]) if (!live.has(k)) noteSounded.delete(k);
        if (!notesMayPop()) return;
        let fresh = null;
        for (const n of notes) {
            const keys = n.ids.map((id) => seenKey(id, n));
            if (keys.every((k) => noteSounded.has(k))) continue;
            keys.forEach((k) => noteSounded.add(k));
            if (!fresh || n.type === 'error') fresh = n;
        }
        if (fresh) playSystemSound(fresh.type === 'error' ? 'SystemHand' : 'Notification', { event: fresh.type === 'error' ? 'error' : 'balloon' });
    }

    function noteTitle(n) {
        return n.title || 'Dreamscape';
    }

    /**
     * The title bar / tray glyph for a notification: WM 6.1's white glyphs only (a reminder is
     * notify.dll's bell, anything else the speech bubble, shellres 4673), never a colour icon.
     */
    function noteIcon(n) {
        return artImageSet(n && n.type === 'reminder' ? 'status-reminder' : 'status-notify-many');
    }

    const STATUS_APP_LABEL = { mail: 'Messages', prints: 'Prints', director: 'Director', update: 'Updates' };

    /** The bubble icon: pending notifications plus any status icons folded into it by fitStatus. */
    function paintNotifyIcon() {
        const icon = shell.querySelector('[data-role="notify"]');
        const count = notes.length + statusFolded.length;
        icon.hidden = !count;
        if (count > 1) {
            icon.dataset.icon = 'notify-many';
            icon.style.backgroundImage = '';
            icon.setAttribute('aria-label', `${count} notifications`);
        } else if (notes.length) {
            delete icon.dataset.icon;
            icon.style.backgroundImage = noteIcon(notes[0]);
            icon.setAttribute('aria-label', `Notification: ${noteTitle(notes[0])}`);
        } else if (count) {
            delete icon.dataset.icon;
            icon.style.backgroundImage = artImageSet(STATUS_APP_ICONS[statusFolded[0]]);
            icon.setAttribute('aria-label', STATUS_APP_LABEL[statusFolded[0]]);
        }
    }

    let noteTrayKey = '';
    function renderNotes() {
        fitStatus();
        // the tray's only entries may have unfolded (a print ended, the bar got wider): close it
        if (!notes.length && !statusFolded.length) noteTrayOpen = false;
        const tray = shell.querySelector('.wm-notify-tray');
        tray.hidden = !noteTrayOpen;
        // rebuilt only when its entries change: refreshStatus runs every 2 s, and a rebuild between
        // pointerdown and pointerup would swallow the tap
        const key = noteTrayOpen ? JSON.stringify([notes.map((n) => [n.id, n.type, noteTitle(n)]), statusFolded]) : '';
        if (noteTrayOpen && key !== noteTrayKey) {
            tray.textContent = '';
            const add = (image, label, tap) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = 'wm-notify-tray-icon';
                b.style.backgroundImage = image;
                b.setAttribute('aria-label', label);
                b.addEventListener('click', (e) => { e.stopPropagation(); tap(); });
                tray.appendChild(b);
            };
            for (const n of notes) add(noteIcon(n), noteTitle(n), () => showNote(n.id));
            for (const r of statusFolded) {
                add(artImageSet(STATUS_APP_ICONS[r]), STATUS_APP_LABEL[r], () => {
                    noteTrayOpen = false;
                    renderNotes();
                    statusBubble(r, shell.querySelector('[data-role="notify"]'));
                });
            }
        }
        noteTrayKey = key;
        renderNoteBubble();
    }

    function renderNoteBubble() {
        const el = shell.querySelector('.wm-notify');
        const n = noteShownNote();
        if (!n) {
            el.hidden = true;
            noteSnapshot = '';
            return;
        }
        const at = notes.indexOf(n);
        const snap = `${n.id}\u0001${at}/${notes.length}\u0001${n.toast.innerHTML}`;
        el.hidden = false;
        if (snap === noteSnapshot) return;
        noteSnapshot = snap;
        el.textContent = '';
        const head = document.createElement('div');
        head.className = 'wm-notify-title';
        const name = document.createElement('span');
        name.className = 'wm-notify-name';
        name.textContent = noteTitle(n);
        head.appendChild(name);
        if (notes.length > 1) {
            const pager = document.createElement('span');
            pager.className = 'wm-notify-pager';
            const step = (d, label) => {
                const b = document.createElement('button');
                b.type = 'button';
                b.className = `wm-notify-step is-${d < 0 ? 'prev' : 'next'}`;
                b.setAttribute('aria-label', label);
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const to = notes[(at + d + notes.length) % notes.length];
                    if (to) showNote(to.id);
                });
                return b;
            };
            pager.append(step(-1, 'Previous notification'), document.createTextNode(` ${at + 1} of ${notes.length} `), step(1, 'Next notification'));
            head.appendChild(pager);
        }
        el.appendChild(head);
        const body = document.createElement('div');
        body.className = 'wm-notify-body';
        const content = n.toast.querySelector('.toast-content');
        if (content) {
            // toastManager's own markup (its message HTML, progress, image preview, buttons) minus the title
            const copy = content.cloneNode(true);
            copy.querySelectorAll('.toast-title').forEach((x) => x.remove());
            copy.querySelectorAll('[id]').forEach((x) => x.removeAttribute('id'));
            const own = [...content.querySelectorAll('button')];
            copy.querySelectorAll('button').forEach((b, i) => {
                b.removeAttribute('onclick');
                b.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const src = own[i];
                    const dupes = n.ids.filter((id) => id !== n.id);
                    if (src && src.isConnected) src.click();
                    // the same notice twice: one answer settles every copy
                    dupes.forEach((id) => { if (typeof window.removeGlassToast === 'function') window.removeGlassToast(id); });
                    queueNotes();
                });
            });
            body.appendChild(copy);
        }
        el.appendChild(body);
    }

    function showNote(id) {
        noteTrayOpen = false;
        noteShown = id;
        closeBubble();
        refreshNotes();
    }

    /** Hide: the bubble goes, the icon stays, and a notification nobody has seen yet comes up. */
    function hideNote() {
        noteShown = null;
        refreshNotes();
    }

    function dismissNote(n) {
        if (!n) return;
        n.ids.forEach((id) => { if (typeof window.removeGlassToast === 'function') window.removeGlassToast(id); });
        noteShown = null;
        refreshNotes();
    }

    function noteSoftKeys() {
        const n = noteShownNote();
        // progress toasts have no close button: they end on their own
        const closable = !!(n && n.toast.querySelector('.toast-close'));
        return {
            left: { label: 'Hide', action: hideNote },
            right: closable ? { label: 'Dismiss', action: () => dismissNote(n) } : null
        };
    }

    /** The title bar icon: hides an open bubble; one notification comes back, several open the tray. */
    function noteIconTap() {
        closeMenus(true);
        const bub = shell.querySelector('.wm-bubble');
        if (!notes.length && statusFolded.length === 1 && !bub.hidden && bub.dataset.role === statusFolded[0]) { closeBubble(); return; }
        closeBubble();
        if (noteShownNote()) {
            notes.forEach((n) => n.ids.forEach((id) => noteSeen.add(seenKey(id, n))));
            hideNote();
            return;
        }
        if (notes.length === 1 && !statusFolded.length) { showNote(notes[0].id); return; }
        if (!notes.length && statusFolded.length === 1) { statusBubble(statusFolded[0], shell.querySelector('[data-role="notify"]')); return; }
        noteTrayOpen = !noteTrayOpen;
        renderNotes();
    }

    function watchToasts() {
        const attach = () => {
            const box = document.getElementById('toastContainer');
            if (!box || box.dataset.wmWatched) return !!box;
            box.dataset.wmWatched = '1';
            new MutationObserver(queueNotes).observe(box, { childList: true, subtree: true, characterData: true, attributes: true, attributeFilter: ['class', 'style', 'aria-valuenow', 'src'] });
            queueNotes();
            return true;
        };
        // toastManager makes the container with the first toast
        if (!attach()) new MutationObserver((_, mo) => { if (attach()) mo.disconnect(); }).observe(document.body, { childList: true });
    }

    /** The bubble for a title-bar status icon; update=true repaints an open one in place. */
    function statusBubble(role, anchor, update) {
        const el = shell.querySelector('.wm-bubble');
        // roaming opens the Phone bubble, so a second tap on it closes that bubble
        const r = role === 'roaming' ? 'signal' : role;
        if (!update && !el.hidden && el.dataset.role === r) { closeBubble(); return; }
        closeMenus(true);
        const ws = window.wsClient;
        if (role === 'data') {
            const connected = !!(ws && ws.isConnected && ws.isConnected());
            const rtt = ws && Array.isArray(ws.rttMeasurements) && ws.rttMeasurements.length ? Math.round(ws.rttMeasurements[ws.rttMeasurements.length - 1]) : null;
            const host = location.host;
            const dev = deviceView();
            const sections = [];
            if (dev.link) {
                const w = dev.wifi;
                const wl = w && Number.isFinite(w.level) ? ` Signal: ${bars(Math.max(0, Math.min(4, Math.round(w.level))))}.` : '';
                if (dev.active === 'wifi') sections.push(`Wi-Fi: ${dev.wifiName || 'Connected'}.${wl}`);
                else sections.push(`${dev.link.text}.`);
            }
            sections.push(connected
                ? `Connected to Dreamscape at ${host}.${rtt != null ? ` Round trip ${rtt} ms.` : ''}`
                : (ws && ws.connectionUi && ws.connectionUi.message) || `Not connected to Dreamscape at ${host}.`);
            const links = [{ label: 'Settings', action: () => { if (apps.has('settings')) open('settings'); } }];
            if (!connected) links.unshift({ label: 'Reconnect', action: () => ws && ws.manualReconnect && ws.manualReconnect() });
            sections.push({ links });
            bubble({ title: 'Connectivity', role, anchor, sections, buttons: [{ text: 'Hide' }] });
        } else if (role === 'signal' || role === 'roaming') {
            // WM's Phone bubble: operator, then the radio's state
            const dev = deviceView();
            const c = dev.cell || {};
            const lines = [];
            const op = typeof c.operator === 'string' && c.operator ? c.operator : null;
            if (dev.airplane) lines.push('Flight mode is on. The phone radio is off.');
            else if (c.radioOn === false) lines.push('The phone radio is off.');
            else if (c.simState === 'absent') lines.push('No SIM card.');
            else if (c.simState === 'locked') lines.push('The SIM card is locked.');
            else {
                lines.push(op || (c.searching === true ? 'Searching for service...' : 'No operator'));
                const lv = Number.isFinite(c.level) ? Math.max(0, Math.min(4, Math.round(c.level))) : null;
                if (c.searching === true) { if (op) lines.push('Searching for service...'); }
                else if (lv != null) lines.push(lv === 0 ? 'Signal: no service' : `Signal: ${bars(lv)}`);
                if (c.roaming === true) lines.push('Roaming');
            }
            if (!dev.airplane && c.radioOn !== false) {
                const dn = dev.type ? DATA_NAME[dev.type] : null;
                if (c.dataEnabled === false) lines.push('Cellular data: off');
                else if (dn) lines.push(`Data: ${dn}${dev.active === 'cellular' ? ', in use' : ''}`);
            }
            bubble({ title: 'Phone', role: 'signal', anchor: shell.querySelector('[data-role="signal"]:not([hidden])') || anchor, sections: lines, buttons: [{ text: 'Hide' }] });
        } else if (role === 'battery') {
            const b = deviceView().battery;
            const lines = [];
            if (!b) lines.push('Main battery: unknown');
            else {
                lines.push(b.level != null ? `Main battery: ${b.level}%` : 'Main battery: unknown');
                const via = { ac: 'external power', usb: 'USB', wireless: 'wireless charger', dock: 'dock' }[b.plugged];
                if (b.charging) lines.push(`Charging${via ? ` from ${via}` : ''}.`);
                else if (via) lines.push(`On ${via}, not charging.`);
                else if (b.charging === false) lines.push('On battery.');
                if (b.saver) lines.push('Battery saver is on.');
            }
            bubble({ title: 'Power', role, anchor, sections: lines, buttons: [{ text: 'Hide' }] });
        } else if (role === 'volume') {
            const tv = window.tabVolume;
            const node = document.createElement('div');
            node.className = 'wm-bubble-volume';
            const muted = !!(tv && tv.isMuted && tv.isMuted());
            node.innerHTML = `<label><input type="radio" name="wmvol" value="on"${muted ? '' : ' checked'}> On</label><label><input type="radio" name="wmvol" value="off"${muted ? ' checked' : ''}> Off</label><input type="range" min="0" max="100" step="5" aria-label="Volume">`;
            const range = node.querySelector('input[type=range]');
            range.value = String(tv && tv.getLevel ? tv.getLevel() : 100);
            range.addEventListener('input', () => { if (tv && tv.setLevel) tv.setLevel(Number(range.value)); refreshStatus(); });
            node.querySelectorAll('input[type=radio]').forEach((r) => r.addEventListener('change', () => { if (tv && tv.setMuted) tv.setMuted(r.value === 'off'); refreshStatus(); }));
            if (update && !el.hidden) return; // keep the live controls
            bubble({ title: 'Volume', role, anchor, sections: [{ node }], buttons: [{ text: 'Hide' }] });
        } else if (role === 'director') {
            const d = directorState();
            const text = !d ? 'The Director has not reported yet.'
                : d.running ? `${d.persona} is working${d.name ? ` on "${d.name}"` : ''}.` : `${d.persona} is idle.`;
            const sections = [text];
            // the current session: its name, turns and prints, context used (director.js's own counts)
            const di = window.directorInstance;
            const ses = di && di.currentSession;
            if (ses) {
                const msgs = Array.isArray(ses.messages) ? ses.messages : [];
                const turns = msgs.filter((m) => m && m.role === 'user' && m.message_type !== 'Attachment').length;
                let prints = 0;
                try { prints = typeof di.sessionPrints === 'function' ? di.sessionPrints().length : 0; } catch (_) { prints = 0; }
                const ctx = ((document.getElementById('directorContextPercent') || {}).textContent || '').trim();
                sections.push(`Session: ${ses.name || 'Untitled'}`);
                sections.push(`${turns} ${turns === 1 ? 'turn' : 'turns'}, ${prints} ${prints === 1 ? 'print' : 'prints'}${ctx && ctx !== '\u2014' ? `, context ${ctx}` : ''}`);
            }
            // the balance: the Director's own usage readout (plan share or remaining balance), and Anlas
            const usageHost = document.getElementById('directorUsageDisplay');
            const usage = ((document.getElementById('directorUsageAuto') || {}).textContent || '').trim();
            if (usageHost && !usageHost.classList.contains('hidden') && usage && usage !== '\u2014') sections.push(`${usageHost.title || 'Usage'}: ${usage}`);
            const o = window.optionsData;
            const anlas = o && o.balance && Number(o.balance.totalCredits);
            if (Number.isFinite(anlas) && anlas >= 0) sections.push(`Balance: ${anlas.toLocaleString()} Anlas`);
            const links = apps.has('director') ? [{ label: 'Open Director', action: () => open('director') }] : [];
            if (links.length) sections.push({ links });
            bubble({ title: 'Director', role, anchor, sections, buttons: [{ text: 'Hide' }] });
        } else if (role === 'update') {
            const sw = window.serviceWorkerManager;
            const n = sw && Number(sw.pendingUpdateFilesTotal);
            const text = `Updates are ready to install${Number.isFinite(n) && n > 0 ? ` (${n.toLocaleString()} files)` : ''}. Melaton restarts to install them.`;
            const links = sw && typeof sw.forceRestart === 'function' ? [{ label: 'Restart Now', action: () => { closeBubble(); sw.forceRestart(); } }] : [];
            bubble({ title: 'Updates', role, anchor, sections: links.length ? [text, { links }] : [text], buttons: [{ text: 'Hide' }] });
        } else if (role === 'prints') {
            const n = printsInProgress();
            bubble({ title: 'Prints', role, anchor, sections: [n ? `${n} ${n === 1 ? 'print is' : 'prints are'} in progress.` : 'No prints in progress.', { links: [{ label: 'Pictures & Videos', action: () => open('gallery') }] }], buttons: [{ text: 'Hide' }] });
        } else if (role === 'mail') {
            bubble({ title: 'Messaging', role, anchor, sections: [shellMailUnread ? `${shellMailUnread} unread ${shellMailUnread === 1 ? 'message' : 'messages'}.` : 'No unread messages.', ...(apps.has('messaging') ? [{ links: [{ label: 'Messaging', action: () => open('messaging') }] }] : [])], buttons: [{ text: 'Hide' }] });
        }
    }

    // ---------------------------------------------------------------- busy

    /**
     * WM's wait cursor while the user must wait (a file opening, a folder loading, a save to the
     * server): busy(work, { delay, timeout }) blocks every tap and key on the shell at once and shows
     * the spinning wait cursor (wait-0..15, 90 ms a frame, as the device and the installer) in the
     * middle of the screen after `delay` ms (default 150: quick work does not flicker). work is a
     * promise or a function returning one: busy resolves / rejects with it. With work true (or
     * nothing) it returns a release function instead. Calls nest (counted); each releases on its
     * own end or after `timeout` ms (default 30 s), so the phone is never locked for good. The shell
     * is aria-busy while it lasts. Message boxes stay usable above it (an error box, a question).
     *
     * Rule for apps (Yozora #723): every blocking action goes through this one cursor, never an
     * app spinner. Work that starts with heavy synchronous DOM work (a desktop dialog re-hosted, a
     * long list built) must pass { paint: true }: the cursor shows at once and the work runs after
     * the next frame, so the cursor is on screen before the main thread blocks (with the default a
     * synchronous fn runs inside the tap and the cursor's timer can never fire). paint also suits
     * any tap whose result takes a server round trip: the user sees the cursor in the same frame.
     */
    let busyCount = 0;
    let busyPopped = false;
    let busyShowTimer = null;
    let busyFrameTimer = null;

    function paintBusy() {
        const layer = shell && shell.querySelector('.wm-busy');
        if (!layer) return;
        const img = layer.querySelector('.wm-busy-wait');
        const on = busyCount > 0;
        layer.hidden = !on;
        shell.querySelector('.wm-content').setAttribute('aria-busy', on ? 'true' : 'false');
        if (!on) {
            clearTimeout(busyShowTimer);
            clearInterval(busyFrameTimer);
            busyShowTimer = null;
            busyFrameTimer = null;
            img.hidden = true;
            img.removeAttribute('src');
            img.removeAttribute('srcset');
        }
    }

    function showBusyCursor() {
        busyShowTimer = null;
        if (busyCount <= 0 || busyFrameTimer) return;
        const img = shell.querySelector('.wm-busy-wait');
        let frame = 0;
        const tick = () => {
            img.src = art(`wait-${frame}`);
            img.srcset = srcset(`wait-${frame}`);
            frame = (frame + 1) % 16;
        };
        tick();
        img.hidden = false;
        busyFrameTimer = setInterval(tick, 90);
    }

    /** Resolves after the next frame is painted (a timer stands in where rAF does not run: hidden tabs). */
    function afterPaint() {
        return new Promise((resolve) => {
            let done = false;
            const go = () => { if (!done) { done = true; resolve(); } };
            try { requestAnimationFrame(() => setTimeout(go, 0)); } catch (_) { /* timer below */ }
            setTimeout(go, 100);
        });
    }

    function busy(work = true, opts = {}) {
        if (!shell) return work === true ? () => {} : Promise.resolve(typeof work === 'function' ? work() : work);
        const paint = !!opts.paint;
        const delay = paint ? 0 : Number.isFinite(opts.delay) ? Math.max(0, opts.delay) : 150;
        const timeout = Number.isFinite(opts.timeout) ? opts.timeout : 30000;
        busyCount++;
        paintBusy();
        if (!busyFrameTimer) {
            clearTimeout(busyShowTimer);
            busyShowTimer = null;
            if (delay === 0) showBusyCursor();
            else busyShowTimer = setTimeout(showBusyCursor, delay);
        }
        let released = false;
        const release = () => {
            if (released) return;
            released = true;
            clearTimeout(limit);
            busyCount = Math.max(0, busyCount - 1);
            paintBusy();
            if (!busyCount && busyPopped) {
                busyPopped = false;
                syncHistory();
            }
        };
        const limit = setTimeout(release, timeout);
        if (work === true || work == null) return release;
        const run = () => {
            try {
                return Promise.resolve(typeof work === 'function' ? work() : work);
            } catch (err) {
                return Promise.reject(err);
            }
        };
        const p = paint && typeof work === 'function' ? afterPaint().then(run) : run();
        return p.finally(release);
    }

    /** Keys wait while busy, except for a message box or the desktop's question over it. */
    function busyBlocksKey() {
        if (busyCount <= 0) return false;
        const box = shell.querySelector('.wm-msgbox-layer');
        if (box && !box.hidden) return false;
        const dlg = document.getElementById('confirmationDialog');
        if (dlg && !dlg.classList.contains('hidden')) return false;
        return true;
    }

    // ---------------------------------------------------------------- system sounds

    /**
     * WM 6.1's system sounds, from the device (Yozora #709; dump: ~/.cache/wm61/snd-evidence).
     * PlaySound's aliases are a fixed table in coredll (slot 1 at 0x033CD308, read on the emulator
     * with ~/.cache/wm61/tools/wmmem2.cs) indexed into HKLM\Snd\Event "Curr0" (multi_sz, the
     * scheme; EventMask 0x1F7ED):
     *   0 SystemAsterisk alarm2   1 Close ""        2 SystemHand alarm2      3 SystemDefault default
     *   4 EmptyRecycleBin Empty   5 SystemExclamation alarm2  6-8 IR begin/end/intr infbeg/infend
     *   9 MenuPopup ""   10 MenuCommand ""   11 Open ""   12 SystemQuestion alarm2
     *   13-15 RN begin/end/intr   16 SystemStart alarm2   17 Maximize ""   18 Minimize ""
     *   19 RecordStart voicbeep   20 RecordEnd RecEnd
     * gwes plays SystemAsterisk / Exclamation / Question / Hand for a message box's icon (MessageBeep;
     * no icon is MB_OK, SystemDefault) and SystemStart at startup; menus are silent. A notification
     * plays its class's Wave (HKCU\ControlPanel\Notifications): Default \Windows\Alarm2.wav with
     * Options 13 (sound + vibrate + display); new e-mail is Options 8 (no sound), so new mail stays
     * silent. The files are the ROM's own (public/sounds/wm61, \Windows\Alarm2.wav and Default.wav).
     *
     * The phone's switches are the workspace's (Settings > Sounds & Notifications, the desktop's own
     * store): each WM sound follows the desktop event it stands for (EVENT_OF). (None), a group's
     * check box off or No Sounds silences it; a sound picked for that event plays as picked; the
     * scheme's own sound plays WM's. Muted or volume 0 (tabVolume) is silent; tabVolume's master gain
     * scales the rest. Nothing plays before a tap or key has unlocked audio (no queue, never throws).
     */
    const SND_BASE = '/sounds/wm61/';
    const SND_FILE = {
        SystemAsterisk: 'Alarm2.wav', SystemQuestion: 'Alarm2.wav', SystemExclamation: 'Alarm2.wav',
        SystemHand: 'Alarm2.wav', SystemDefault: 'Default.wav', SystemStart: 'Alarm2.wav',
        Notification: 'Alarm2.wav'
    };
    // the desktop event (desktopSounds.SCHEME, the Sound dialog's list) whose settings each one follows
    const SND_EVENT_OF = {
        SystemAsterisk: 'dialog', SystemQuestion: 'dialog', SystemDefault: 'dialog',
        SystemExclamation: 'warning', SystemHand: 'critical-stop', SystemStart: 'logon',
        Notification: 'balloon'
    };
    const MSGBOX_SOUND = { info: 'SystemAsterisk', question: 'SystemQuestion', warning: 'SystemExclamation', error: 'SystemHand' };
    const snd = { ctx: null, buffers: new Map(), last: 0, log: [] };

    function sndUnlock() {
        try {
            if (!snd.ctx) {
                const Ctor = window.AudioContext || window.webkitAudioContext;
                if (!Ctor) return;
                snd.ctx = new Ctor();
            }
            if (snd.ctx.state === 'suspended' && snd.ctx.resume) snd.ctx.resume().catch(() => {});
            new Set(Object.values(SND_FILE)).forEach(sndBuffer);
        } catch (_) { /* no audio */ }
    }

    /** Decoded audio by file (several sounds share one WAV); null when it cannot load. */
    function sndBuffer(file) {
        if (!snd.buffers.has(file)) {
            const p = fetch(SND_BASE + encodeURIComponent(file), { credentials: 'same-origin' })
                .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(`sound ${r.status}`))))
                .then((bytes) => snd.ctx.decodeAudioData(bytes))
                .catch(() => { snd.buffers.delete(file); return null; });
            snd.buffers.set(file, p);
        }
        return snd.buffers.get(file);
    }

    function sndSilentNow() {
        try {
            const tv = window.tabVolume;
            if (tv && typeof tv.isMuted === 'function' && tv.isMuted()) return true;
            if (tv && typeof tv.getLevel === 'function' && Number(tv.getLevel()) <= 0) return true;
        } catch (_) { /* volume unknown: play */ }
        return false;
    }

    // what played, for tests (wmShell.sounds.log)
    function sndNote(name, event, file, at) {
        snd.log.push({ name, event, file, at });
        if (snd.log.length > 50) snd.log.shift();
    }

    /**
     * Play one WM system sound (SND_FILE's names); resolves true when it started. opts.event: the
     * desktop event whose settings decide (default SND_EVENT_OF). A second sound within 300 ms is
     * dropped: a message box and the desktop's own call for the same box are one beep.
     */
    async function playSystemSound(name, opts = {}) {
        try {
            const file = SND_FILE[name];
            if (!file) return false;
            const event = opts.event || SND_EVENT_OF[name];
            const pers = window.desktopPersonalization;
            let own;
            if (pers && typeof pers.soundFile === 'function') {
                if (name === 'SystemStart' && pers.soundFile('logon-startup') === '') return false;
                own = pers.soundFile(event);
            }
            if (own === '' || sndSilentNow()) return false;
            const ctx = snd.ctx;
            if (!ctx || ctx.state !== 'running') return false;
            const now = Date.now();
            if (now - snd.last < 300) return false;
            snd.last = now;
            const ds = window.desktopSounds;
            const schemeFile = ds && ds.SCHEME ? ds.SCHEME[event] : undefined;
            // a sound picked for the event on Settings > Sounds & Notifications plays as picked
            if (typeof own === 'string' && own !== schemeFile && ds && Array.isArray(ds.FILES) && ds.FILES.includes(own) && typeof ds.playFile === 'function') {
                sndNote(name, event, `vista/${own}`, now);
                return !!(await ds.playFile(own));
            }
            sndNote(name, event, `wm61/${file}`, now);
            const buffer = await sndBuffer(file);
            if (!buffer) return false;
            const src = ctx.createBufferSource();
            src.buffer = buffer;
            src.connect(ctx.destination); // tabVolume's master gain sits on the way out
            src.start(0);
            return true;
        } catch (_) {
            return false;
        }
    }

    /**
     * The desktop's own sound calls on the phone (desktopSounds.play only plays in desktop mode):
     * a boot message box, an exception window, a dropped connection and the confirmation dialog's
     * sound map to WM's; every other desktop event (logon, mail, prints, recycle ...) has no WM
     * sound or comes as a notification here.
     */
    const DESKTOP_SOUND = { error: 'SystemHand', 'critical-stop': 'SystemHand', warning: 'SystemExclamation', dialog: 'SystemAsterisk' };
    function watchSystemSounds() {
        const unlock = () => sndUnlock();
        document.addEventListener('pointerdown', unlock, { capture: true, passive: true });
        document.addEventListener('keydown', unlock, { capture: true });
        const ds = window.desktopSounds;
        if (ds && typeof ds.play === 'function' && !ds.wmWrapped) {
            const play = ds.play;
            ds.play = function (eventId, options) {
                const name = DESKTOP_SOUND[eventId];
                if (name) playSystemSound(name, { event: eventId === 'dialog' ? 'dialog' : eventId });
                return play.call(this, eventId, options);
            };
            ds.wmWrapped = true;
        }
        // the desktop's confirmation dialog is drawn as a WM message box: it beeps like one, by its
        // icon (showInputDialog's edit box is a form, not a message box: silent). Wrapped at the
        // global (confirmationDialog.js sets the icon before it returns); its classes cannot tell a
        // new question from the last one still closing.
        const ask = window.showConfirmationDialog;
        if (typeof ask === 'function' && !ask.wmWrapped) {
            const wrapped = function (message, options, event, config) {
                const notice = confirmationNotice(message, options, config);
                if (notice) return notice;
                const result = ask.apply(this, arguments);
                // the dialog's close (X), hidden with the desktop's window controls: WM's title-bar X
                // in the caption, pressing the desktop close (its answer is the dialog's own)
                try {
                    const dlg = document.getElementById('confirmationDialog');
                    const title = dlg && dlg.querySelector('.modal-window-title');
                    if (title) {
                        title.querySelectorAll(':scope > .wm-title-action').forEach((b) => b.remove());
                        const close = dlg.querySelector('.modal-window-controls .close-btn');
                        if (close && close.style.display !== 'none') {
                            const x = document.createElement('button');
                            x.type = 'button';
                            x.className = 'wm-title-action';
                            x.dataset.kind = 'close';
                            x.setAttribute('aria-label', 'Close');
                            x.addEventListener('click', () => close.click());
                            title.appendChild(x);
                        }
                    }
                } catch (_) { /* no corner */ }
                // WM's message box icon by the dialog's own icon (a question unless it says otherwise)
                try {
                    const dlg = document.getElementById('confirmationDialog');
                    const msg = dlg && dlg.querySelector('#confirmationMessage');
                    if (msg && !msg.querySelector(':scope > .wm-cd-icon')) {
                        const fa = (dlg.querySelector('.modal-window-title-main i') || {}).className || '';
                        const kind = /xmark|times|ban|skull|bug|bomb|circle-exclamation|exclamation-circle/.test(fa) ? 'error'
                            : /exclamation|warning/.test(fa) ? 'warning' : /info|check/.test(fa) ? 'info' : 'question';
                        msg.insertAdjacentHTML('afterbegin', imgTag(`msgbox-${kind}`).replace('<img ', '<img class="wm-cd-icon" '));
                    }
                } catch (_) { /* no icon */ }
                try {
                    const dlg = document.getElementById('confirmationDialog');
                    const icon = (dlg && dlg.querySelector('.modal-window-title-main i') || {}).className || '';
                    const name = /exclamation|warning/.test(icon) ? 'SystemExclamation'
                        : /xmark|times|ban|skull|bug|bomb/.test(icon) ? 'SystemHand'
                            : /info|check/.test(icon) ? 'SystemAsterisk' : 'SystemQuestion';
                    if (dlg) playSystemSound(name);
                } catch (_) { /* no sound */ }
                return result;
            };
            wrapped.wmWrapped = true;
            window.showConfirmationDialog = wrapped;
        }
    }

    // ---------------------------------------------------------------- notifications

    const NOTE_TYPE = { error: 'error', warning: 'warning', success: 'success' };

    /**
     * A WM notification (SHNotificationAdd): the shell's bubble, title-bar icon and tray, drawn from
     * a toast (toastManager.js) like every other notice on the phone. Errors and warnings stay until
     * dismissed; others time out (timeout ms, false = stay). Resolves when it is gone (Dismiss, its
     * timeout); Hide keeps it in the tray and the promise waiting, like the box it stands for.
     */
    function notify({ title = 'Melaton Mobile', text = '', icon = 'info', timeout = null, buttons = null, asNote = false } = {}) {
        // WM: what answers the user's own action (a tap a moment ago, or work under the wait cursor)
        // is a message box; a notification is for what arrives on its own
        if (!asNote && !buttons && answersUser()) {
            // a routine "done" for the user's own action needs nothing: the result is on screen
            if (NOTE_TYPE[icon] === 'success') return Promise.resolve(true);
            return messageBox({ title, text, icon: NOTE_TYPE[icon] === 'success' ? 'info' : (icon || 'info'), modal: true });
        }
        return new Promise((resolve) => {
            if (typeof window.showGlassToast !== 'function') { resolve(true); return; }
            const type = NOTE_TYPE[icon] || 'info';
            const stay = timeout === false || (timeout == null && (type === 'error' || type === 'warning'));
            const html = escapeHtml(String(text || '').trim()).replace(/\n/g, '<br>');
            let id = null;
            try {
                id = window.showGlassToast(type, escapeHtml(title), html, false, stay ? false : (timeout || 8000), null, buttons);
            } catch (err) { console.warn('[wmShell] notify', err); }
            if (!id) { resolve(true); return; }
            const gone = () => { const t = document.getElementById(id); return !t || t.classList.contains('removing'); };
            const timer = setInterval(() => { if (gone()) { clearInterval(timer); resolve(true); } }, 400);
        });
    }

    /** A message now answers the user's own action: a tap or Enter in the last 6 s, or work under the wait cursor. */
    function answersUser() {
        return performance.now() - lastTapAt < 6000 || busyCount > 0;
    }

    /** Plain text of a desktop dialog's HTML message, line breaks kept. */
    function htmlToText(html) {
        const div = document.createElement('div');
        div.innerHTML = String(html || '').replace(/<br\s*\/?>/gi, '\n').replace(/<\/(p|div|li|h\d)>/gi, '\n');
        return div.textContent.replace(/[ \t]+/g, ' ').replace(/\n\s*\n+/g, '\n').trim();
    }

    /**
     * showConfirmationDialog with one plain button (an OK notice, no form, no handler of its own) is
     * the desktop telling the user something: on the phone a WM notification, resolving with the
     * button's value once it is dismissed. Everything else stays the desktop dialog (a WM message box).
     */
    function confirmationNotice(message, options, config) {
        if (!Array.isArray(options) || options.length !== 1) return null;
        // the answer to something the user just did stays the desktop dialog (a WM message box)
        if (answersUser()) return null;
        const opt = options[0] || {};
        const cfg = config || {};
        if (typeof opt.onClick === 'function' || typeof cfg.onDialogReady === 'function' || typeof cfg.resolveValue === 'function') return null;
        if (/<(form|input|select|textarea|button|img|canvas|video|iframe)\b/i.test(String(message || ''))) return null;
        const fa = String(cfg.icon || '');
        const icon = /xmark|times|ban|skull|bug|bomb|circle-exclamation|exclamation-circle/.test(fa) ? 'error'
            : /exclamation|warning/.test(fa) ? 'warning' : /check/.test(fa) ? 'success' : 'info';
        return notify({ title: cfg.title || 'Melaton Mobile', text: htmlToText(message), icon, asNote: true }).then(() => opt.value);
    }

    // ---------------------------------------------------------------- the wait cursor for server work

    /**
     * A tap whose work waits on the server shows the wait cursor without each caller asking for it:
     * a websocket request (wsClient.sendMessageWithCallback) or an /api fetch started within a moment
     * of a tap or Enter shows it after 250 ms until the reply. Work that runs long by design (prints,
     * upscales, Director turns, streams) is left out, and the cursor gives up after 8 s.
     */
    let lastTapAt = -1e9;
    const LONG_REQUEST = /generat|^print|_print|upscale|director_(send|turn|chat|run|continue|regenerate|reply)|wren|stream|subscribe|unsubscribe|^ping$|heartbeat|telemetry|presence|keepalive/i;
    const tapRecent = () => performance.now() - lastTapAt < 700;

    function busyForRequest(p) {
        if (!p || typeof p.then !== 'function') return;
        busy(p.then(() => {}, () => {}), { delay: 250, timeout: 8000 });
    }

    /**
     * window.alert in desktop code (35 calls) would show the Android / browser dialog on the phone:
     * it is a WM notification here. confirm / prompt stay native: they must answer synchronously.
     */
    function routeAlert() {
        const orig = window.alert;
        if (typeof orig !== 'function' || orig.wmRouted) return;
        const phoneAlert = function (message) {
            notify({ title: 'Melaton Mobile', text: String(message == null ? '' : message), icon: 'warning' });
        };
        // (notify shows a message box when the alert answers a tap)
        phoneAlert.wmRouted = true;
        window.alert = phoneAlert;
    }

    function watchRequestBusy() {
        const mark = (e) => { if (e.isTrusted) lastTapAt = performance.now(); };
        document.addEventListener('click', mark, true);
        document.addEventListener('keydown', (e) => { if (e.key === 'Enter') mark(e); }, true);
        const wrapWs = () => {
            const c = window.wsClient;
            if (!c || typeof c.sendMessageWithCallback !== 'function') return false;
            if (c.wmBusyWrapped) return true;
            const orig = c.sendMessageWithCallback;
            c.sendMessageWithCallback = function (type) {
                const p = orig.apply(this, arguments);
                try { if (tapRecent() && !LONG_REQUEST.test(String(type || ''))) busyForRequest(p); } catch (_) { /* no cursor */ }
                return p;
            };
            c.wmBusyWrapped = true;
            return true;
        };
        if (!wrapWs()) {
            const t = setInterval(() => { if (wrapWs()) clearInterval(t); }, 1000);
        }
        const f = window.fetch;
        if (typeof f === 'function' && !f.wmBusyWrapped) {
            const wrapped = function (input) {
                const p = f.apply(this, arguments);
                try {
                    if (tapRecent()) {
                        const url = new URL(typeof input === 'string' ? input : (input && input.url) || '', location.href);
                        if (url.origin === location.origin && /^\/api\//.test(url.pathname) && !LONG_REQUEST.test(url.pathname)) busyForRequest(p);
                    }
                } catch (_) { /* no cursor */ }
                return p;
            };
            wrapped.wmBusyWrapped = true;
            window.fetch = wrapped;
        }
    }

    // ---------------------------------------------------------------- message box

    /**
     * WM message box; resolves with the chosen button's value. buttons: [{ text, value }].
     * icon: 'error' | 'warning' | 'info' | 'question' | null.
     */
    function messageBox({ title = 'Melaton Mobile', text = '', icon = null, buttons = [{ text: 'ok', value: true }], cancelValue = false, input = null, modal = false } = {}) {
        // an ok-only box that does not answer something the user just did (it came on its own, later)
        // is a WM notification instead; one that answers a tap stays a message box (WM's rule)
        if (buttons.length === 1 && !input && !modal && !answersUser()) {
            // resolved at once: a caller inside busy() must not hold the wait cursor until it is read
            notify({ title, text, icon: icon || 'info', asNote: true });
            return Promise.resolve(buttons[0].value);
        }
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
                refreshTitleAction();
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
                    if (b.default) el.classList.add('is-default');
                    el.addEventListener('click', () => done(b.value));
                    row.appendChild(el);
                }
            }
            layer.hidden = false;
            // WM: the title bar's corner goes empty while a message box is up
            refreshTitleAction();
            // MessageBeep by the icon (none: MB_OK, the default beep); an edit box with no icon is a
            // form, not a message box
            if (icon || !input) playSystemSound(icon ? MSGBOX_SOUND[icon] || 'SystemDefault' : 'SystemDefault');
            const first = field || layer.querySelector('.wm-msgbox-buttons .is-default') || layer.querySelector('button');
            if (first) first.focus();
        });
    }

    const TODAY_BG_KEY = 'wmTodayBackground';
    let setTodayBackgroundFn = null; // Pictures & Videos' Set as Today Background (registerGalleryApp)

    /** The active workspace's record (workspaceUtils.js), or null. */
    function activeWorkspaceRecord() {
        try {
            return typeof workspaces !== 'undefined' && typeof activeWorkspace !== 'undefined' ? workspaces[activeWorkspace] || null : null;
        } catch (_) { return null; }
    }

    /** The active workspace's desktop wallpaper (resolveWorkspaceWallpaperUrl: modalUtils.js). */
    function desktopWallpaper() {
        try {
            const w = activeWorkspaceRecord();
            if (!w || !w.wallpaper || typeof resolveWorkspaceWallpaperUrl !== 'function') return null;
            const url = resolveWorkspaceWallpaperUrl(w.wallpaper);
            return url ? { url, position: w.wallpaperPosition || 'center' } : null;
        } catch (_) { return null; }
    }

    // ---- the phone's own wallpaper placement (workspace record mobileWallpaper, modules/workspace.js)

    const WALL_SIZES = ['fill', 'fit', 'stretch', 'tile', 'center'];
    const WALL_KEYWORDS = { left: ['x', 0], right: ['x', 100], top: ['y', 0], bottom: ['y', 100], center: [null, 50] };

    /**
     * The focal point { x, y } (0-100 %) of a position: "<x>% <y>%" (Settings > Today > Wallpaper's
     * sliders) or keywords from older records (left / center / right, top / center / bottom).
     * Same rules as modules/workspace.js normalizeMobileWallpaperPosition.
     */
    function wallFocus(raw) {
        const tokens = String(raw == null ? '' : raw).trim().toLowerCase().split(/\s+/).filter(Boolean).slice(0, 2);
        let x = null;
        let y = null;
        const free = [];
        for (const t of tokens) {
            const m = /^(-?\d+(?:\.\d+)?)%$/.exec(t);
            if (m) { free.push(Number(m[1])); continue; }
            const k = WALL_KEYWORDS[t];
            if (!k) free.push(50);
            else if (k[0] === 'x' && x === null) x = k[1];
            else if (k[0] === 'y' && y === null) y = k[1];
            else free.push(k[1]);
        }
        for (const v of free) {
            if (x === null) x = v;
            else if (y === null) y = v;
        }
        const pct = (v) => (Number.isFinite(v) ? Math.round(Math.min(100, Math.max(0, v)) * 10) / 10 : 50);
        return { x: pct(x === null ? 50 : x), y: pct(y === null ? 50 : y) };
    }

    const wallPosition = (raw) => { const f = wallFocus(raw); return `${f.x}% ${f.y}%`; };

    /** { size, position "<x>% <y>%" } or null (null = same as the desktop). */
    function normalizeMobileWallpaper(raw) {
        if (!raw || typeof raw !== 'object' || !WALL_SIZES.includes(raw.size)) return null;
        return { size: raw.size, position: wallPosition(raw.position) };
    }

    function mobileWallpaper() {
        const w = activeWorkspaceRecord();
        return normalizeMobileWallpaper(w && w.mobileWallpaper);
    }

    /**
     * The placement Today uses: the workspace's phone placement, else the desktop's (cover at its
     * focal point; wallpaperPosition may be keywords or percentages).
     */
    function wallpaperPlacement() {
        const own = mobileWallpaper();
        if (own) return own;
        const w = activeWorkspaceRecord();
        return { size: 'fill', position: (w && w.wallpaperPosition) || 'center center' };
    }

    /**
     * CSS background for a placement. Tile and Center draw the picture at its own pixels (device
     * pixels, so a phone shows it at the size the desktop does); scale shrinks that for a preview.
     */
    function placementCss(placement, natural, scale) {
        const p = placement || { size: 'fill', position: 'center center' };
        const k = scale || 1;
        const dpr = window.devicePixelRatio || 1;
        const real = natural && natural.w > 0 && natural.h > 0
            ? `${Math.max(1, (natural.w / dpr) * k)}px ${Math.max(1, (natural.h / dpr) * k)}px`
            : 'auto';
        const size = p.size === 'fit' ? 'contain' : p.size === 'stretch' ? '100% 100%' : (p.size === 'tile' || p.size === 'center') ? real : 'cover';
        return { size, position: p.position || 'center center', repeat: p.size === 'tile' ? 'repeat' : 'no-repeat' };
    }

    const naturalSizes = new Map(); // url -> { w, h } once loaded

    // this window's save waits for the server's settings_updated echo: it carries the stored value
    let wallEcho = null; // { id, resolve }

    /** Save the phone placement on the workspace (null = same as the desktop); Today redraws now. */
    async function setMobileWallpaper(value) {
        const next = normalizeMobileWallpaper(value);
        const w = activeWorkspaceRecord();
        const id = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        const before = w ? w.mobileWallpaper : undefined;
        if (w) w.mobileWallpaper = next;
        applyTodayBackground(true);
        const client = window.wsClient;
        if (!id || !client || typeof client.updateWorkspaceSettings !== 'function') return next;
        const echo = new Promise((resolve) => {
            wallEcho = { id, resolve };
            setTimeout(() => resolve(undefined), 3000);
        });
        try {
            await client.updateWorkspaceSettings(id, { mobileWallpaper: next });
        } catch (err) {
            wallEcho = null;
            // not saved: Today and the record go back to the saved placement
            if (w && w.mobileWallpaper === next) {
                w.mobileWallpaper = before;
                applyTodayBackground(true);
            }
            throw err;
        }
        const stored = await echo;
        wallEcho = null;
        // A server from before the focus sliders keeps only keywords: it echoes the words
        // "center center" for any percentage. The new server always echoes "<x>% <y>%", so a
        // percentage echo (or another window's save landing in the 3 s window) is never this case.
        const keywordPoint = (f) => [0, 50, 100].includes(f.x) && [0, 50, 100].includes(f.y);
        const storedRaw = stored && typeof stored === 'object' ? String(stored.position || '') : '';
        const sentFocus = next ? wallFocus(next.position) : null;
        const oldServer = !!next && !!stored && stored.size === next.size
            && !storedRaw.includes('%') && /^\s*center\s+center\s*$/i.test(storedRaw)
            && !keywordPoint(sentFocus);
        if (oldServer) {
            // save the nearest keyword point instead and say so, rather than lose the focus quietly
            const f = sentFocus;
            const near = (v, lo, hi) => (v < 25 ? lo : v > 75 ? hi : 'center');
            const words = `${near(f.x, 'left', 'right')} ${near(f.y, 'top', 'bottom')}`;
            await client.updateWorkspaceSettings(id, { mobileWallpaper: { size: next.size, position: words } });
            const err = new Error('The server can only keep Left, Center or Right and Top, Center or Bottom until Dreamscape is updated. The nearest of those was saved.');
            err.savedPosition = wallPosition(words);
            throw err;
        }
        return next;
    }

    let todayBgKey = '';

    /**
     * Today's background: a picture set from Pictures & Videos (Menu > Set as Today Background),
     * else the workspace's desktop wallpaper, else the page background. Both are placed by the
     * workspace's phone placement (Settings > Today > Wallpaper), else the desktop's.
     */
    function todayPicture() {
        let picture = null;
        try { picture = localStorage.getItem(TODAY_BG_KEY); } catch (_) { /* storage off */ }
        // Settings > Today: "Use desktop wallpaper" wins over a picture that is still stored
        try {
            const useDesktop = window.wmSettings && typeof window.wmSettings.todayUsesDesktop === 'function'
                ? window.wmSettings.todayUsesDesktop()
                : localStorage.getItem('wmTodayUseDesktop') === '1';
            if (useDesktop) picture = null;
        } catch (_) { /* default: the picture if any */ }
        // only a same-site path is used
        if (picture && !/^\/[^/]/.test(picture)) picture = null;
        const wall = picture ? null : desktopWallpaper();
        return picture || (wall && wall.url) || null;
    }

    function applyTodayBackground(force) {
        const today = apps.get('today');
        if (!today || !today.page) return;
        const url = todayPicture();
        const placement = wallpaperPlacement();
        const key = `${url}|${placement.size}|${placement.position}`;
        if (!force && key === todayBgKey) return;
        todayBgKey = key;
        const set = (u) => {
            today.page.style.backgroundImage = u ? `url("${u.replace(/["\\\n]/g, encodeURIComponent)}")` : '';
            const css = placementCss(placement, u && naturalSizes.get(u));
            today.page.style.backgroundSize = css.size;
            today.page.style.backgroundPosition = css.position;
            today.page.style.backgroundRepeat = css.repeat;
            // Fit and Center leave margins: WM painted a solid colour there, not the workspace
            // theme behind the shell (black, like the Settings preview)
            today.page.style.backgroundColor = u ? '#000' : '';
            today.page.classList.toggle('has-picture', !!u);
        };
        set(url);
        if (url) {
            // a picture that no longer loads falls back to the workspace background;
            // Tile and Center need its pixel size
            const probe = new Image();
            probe.onerror = () => { set(null); todayBgKey = ''; };
            probe.onload = () => {
                naturalSizes.set(url, { w: probe.naturalWidth, h: probe.naturalHeight });
                if (todayBgKey === key && (placement.size === 'tile' || placement.size === 'center')) set(url);
            };
            probe.src = url;
        }
    }

    /**
     * The picture Today shows for a gallery item: the whole picture as the server's full-size WebP
     * (/previews/<stem>@studio.webp, same-site, no read token), not the 512 px square preview that
     * crops tall and wide pictures. A remote item without a local file keeps its preview.
     */
    function todayPictureUrl(item) {
        if (!item) return '';
        const file = item.filename || item.original;
        if (item.storage !== 'remote' && typeof localStudioPreviewUrl === 'function') {
            const full = localStudioPreviewUrl(file);
            if (full) return full;
        }
        if (!item.preview) return '';
        const p = typeof getGalleryPreviewUrl === 'function' ? getGalleryPreviewUrl(item.preview) : item.preview;
        return `/previews/${encodeURIComponent(p)}`;
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

    /**
     * Move To: the other workspaces; a pick moves the picture there with the desktop's own move
     * (workspaceUtils.js moveFilesToWorkspace: its count update, gallery refresh and result notice),
     * under the wait cursor.
     */
    function moveToItems(name) {
        let list = [];
        try {
            if (typeof workspaces !== 'undefined') {
                list = Object.values(workspaces).filter(Boolean).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
            }
        } catch (_) { /* not loaded */ }
        const active = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        const others = list.filter((w) => w.id !== active);
        if (!name || typeof window.moveFilesToWorkspace !== 'function' || !others.length) return [{ label: 'No other workspaces', disabled: true }];
        return others.map((w) => ({
            label: w.name || w.id,
            action: () => busy(() => window.moveFilesToWorkspace([name], w.id), { paint: true, timeout: 30000 })
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
    const todayWidgets = [];

    function registerTodayItem(w) {
        if (!w || !w.id || typeof w.text !== 'function' || todayWidgets.some((x) => x.id === w.id)) return;
        todayWidgets.push(w);
        const today = apps.get('today');
        if (today && today.page) today.refresh();
    }

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
                shellMailUnread = mailUnread;
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

        // Director: its status push (director_computer_status, kept on directorInstance._status
        // by director.js) says whether a turn runs and in which session; Xi has its own part

        function directorText() {
            const d = directorState();
            if (!d) return '';
            if (d.running) return `${d.persona} is working${d.name ? `: ${d.name}` : '...'}`;
            return `${d.persona} is idle`;
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
                    <div class="wm-today-row is-plain" data-row="director" hidden>
                        <img src="/static_images/app_icons/director.png" alt="" draggable="false"><span class="wm-today-text" data-f="director"></span>
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
                    shellMailUnread = mailUnread;
                    refreshStatus();
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
                applyTodayBackground();
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
                const dir = directorText();
                page.querySelector('[data-row="director"]').hidden = !dir;
                setText(page.querySelector('[data-f="director"]'), dir || '');
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
                paintTodayWidgets(page);
                applyTodayItems(page);
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

        /**
         * Today rows from apps in their own files (wmShell.registerTodayItem): { id, label, icon (wm61
         * art name or '/path'), after (the row id to follow), text() -> string ('' hides the row),
         * onTap() }. Each refresh of Today repaints them; Settings > Today > Items lists them.
         */
        function paintTodayWidgets(page) {
            for (const w of todayWidgets) {
                let row = page.querySelector(`[data-row="${CSS.escape(w.id)}"]`);
                if (!row) {
                    row = document.createElement(w.onTap ? 'button' : 'div');
                    if (w.onTap) { row.type = 'button'; row.addEventListener('click', () => { try { w.onTap(); } catch (err) { console.warn('[wmShell] today item', w.id, err); } }); }
                    row.className = `wm-today-row${w.onTap ? '' : ' is-plain'}`;
                    row.dataset.row = w.id;
                    row.innerHTML = `${imgTag(w.icon || 'app-programs')}<span class="wm-today-text"></span>`;
                    const after = w.after && page.querySelector(`[data-row="${CSS.escape(w.after)}"]`);
                    if (after) after.after(row); else page.querySelector('[data-row="search"]').before(row);
                    itemsKey = null; // the stored order places the new row next time
                }
                let text = '';
                try { text = String(w.text() || ''); } catch (_) { text = ''; }
                row.hidden = !text;
                setText(row.querySelector('.wm-today-text'), text);
            }
        }

        // Settings > Today > Items: order and on / off of the rows (wmTodayItems = [{ id, on }])
        let itemsKey = null;
        function applyTodayItems(page) {
            let list = null;
            let raw = null;
            try { raw = localStorage.getItem('wmTodayItems'); list = JSON.parse(raw || 'null'); } catch (_) { list = null; }
            const off = new Set();
            if (Array.isArray(list)) {
                list.forEach((it) => { if (it && it.id && it.on === false) off.add(it.id); });
                if (raw !== itemsKey) {
                    // the rows in the stored order; rows not in the list keep their place at the end
                    list.forEach((it) => {
                        const row = page.querySelector(`[data-row="${CSS.escape(String(it.id))}"]`);
                        if (row) page.appendChild(row);
                    });
                    page.querySelectorAll(':scope > [data-row]').forEach((row) => {
                        if (!list.some((it) => it && it.id === row.dataset.row)) page.appendChild(row);
                    });
                }
            }
            itemsKey = raw;
            page.querySelectorAll(':scope > [data-row]').forEach((row) => {
                row.classList.toggle('wm-today-off', off.has(row.dataset.row));
            });
        }

        registerApp(today);
        // switching workspace changes Today's rows, theme and prints
        document.addEventListener('workspaceSwitchComplete', () => { recentKey = ''; applyTodayBackground(true); today.refresh(); });
        // another window saved this workspace's phone placement (settings_updated carries it)
        document.addEventListener('workspaceUpdated', (ev) => {
            const d = ev && ev.detail;
            if (!d || !d.settings || d.settings.mobileWallpaper === undefined) return;
            if (wallEcho && wallEcho.id === d.workspaceId) { const e = wallEcho; wallEcho = null; e.resolve(d.settings.mobileWallpaper); }
            const w = typeof workspaces !== 'undefined' && workspaces ? workspaces[d.workspaceId] : null;
            if (w) w.mobileWallpaper = normalizeMobileWallpaper(d.settings.mobileWallpaper);
            if (typeof activeWorkspace !== 'undefined' && d.workspaceId === activeWorkspace) applyTodayBackground(true);
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
        // the toolbar's search field (static, Yukimi Nov 10): typing follows the desktop gallery search
        // (fileSearchInput), Enter runs it, an emptied field or Clear Search ends it
        const searchTarget = () => document.getElementById('fileSearchInput');
        const pvInput = () => { const pg = apps.get('gallery') && apps.get('gallery').page; return pg ? pg.querySelector('.wm-pv-q') : null; };
        function runSearch(q) {
            const t = searchTarget();
            if (!t) return;
            if (!String(q || '').trim()) { setSearch(false); return; }
            searchSubmitted = true;
            t.value = q;
            t.dispatchEvent(new Event('input', { bubbles: true }));
            t.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true }));
        }
        const setSearch = (on) => {
            const input = pvInput();
            if (on) {
                if (input) input.focus();
                return;
            }
            // ending always clears, also after the box was emptied by hand: emptying the box resets
            // fileSearch's query but keeps the filtered results (fileSearch.clearSearch restores all)
            if (input) input.value = '';
            const t = searchTarget();
            const fs = window.fileSearch;
            const active = searchSubmitted || !!((fs && fs.currentQuery) || (t && t.value)) || !!searchResults;
            searchSubmitted = false;
            if (t) t.value = '';
            if (active) {
                if (fs && typeof fs.clearSearch === 'function') fs.clearSearch(true, true);
                else if (t) t.dispatchEvent(new Event('change', { bubbles: true }));
            }
            // clearSearch reloads the gallery without applyFilteredImages: the grid drops the results itself
            searchResults = null;
            const page = apps.get('gallery') && apps.get('gallery').page;
            if (page) renderGrid(page, true);
            if (current === 'gallery') renderSoftKeys();
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
        const CHUNK = 60; // about this many cells per content-visibility block (a whole number of rows)
        // Thumbnail size (Yukimi, Nov 10: a density control): the WM cell (80 px column, 61 px row,
        // picture in 68 x 53) times k. Stored per device.
        const PV_SIZES = [['small', 'Small', 0.75], ['medium', 'Medium', 1], ['large', 'Large', 1.5], ['xlarge', 'Extra Large', 2], ['huge', 'Huge', 3]];
        const PV_SIZE_KEY = 'wmPvSize';
        let pvSize = (() => { try { const v = localStorage.getItem(PV_SIZE_KEY); return PV_SIZES.some(([k]) => k === v) ? v : 'medium'; } catch (_) { return 'medium'; } })();
        const pvK = () => (PV_SIZES.find(([k]) => k === pvSize) || PV_SIZES[1])[2];

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

        /** Columns of 80 px x the thumbnail size (2 at least); true when the count changed. A hidden page keeps its own. */
        function layoutGrid(page) {
            const scroller = page.querySelector('.wm-pv-scroll');
            const w = (scroller && scroller.clientWidth) || page.clientWidth;
            if (!w) return false;
            const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
            page.style.setProperty('--wm-pv-k', String(pvK()));
            const cols = Math.max(2, Math.floor(w / (80 * px * pvK())));
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

        // the grid's blocks still to come after a render (renderGrid), added after the first paint
        let gridToken = 0;
        let gridRest = null;
        let gridMore = null; // IntersectionObserver on the grid's last block

        /** Every block of the grid now (a jump to a cell further down). */
        function flushGrid() {
            const g = gridRest;
            if (!g) return;
            gridRest = null;
            let add = '';
            for (; g.next < g.total; g.next += g.size) add += g.chunkHtml(g.next);
            g.box.insertAdjacentHTML('beforeend', add);
            if (gridMore) { gridMore.disconnect(); gridMore = null; }
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
            // a block is whole rows: 60 cells in 7 columns left a gap after every block (Fold7)
            const size = cols * Math.max(1, Math.round(CHUNK / cols));
            const chunkHtml = (i) => {
                const part = list.slice(i, i + size);
                // the block's real height before it renders (content-visibility): rows of 61 px x k
                const est = Math.round(Math.ceil(part.length / cols) * 61 * px * pvK());
                let html = `<div class="wm-pv-chunk" style="contain-intrinsic-size:auto ${est}px">`;
                for (const item of part) {
                    const name = nameOf(item);
                    const sel = name === selectedName ? ' is-selected' : '';
                    html += `<button type="button" class="wm-pv-cell wm-photo${sel}" data-filename="${escapeHtml(name)}" aria-label="${escapeHtml(name)}"><img src="${escapeHtml(previewUrl(item))}" alt="" loading="lazy" decoding="async" draggable="false"></button>`;
                }
                return `${html}</div>`;
            };
            // The screen's blocks now, the rest after the first paint in small batches: building all
            // of a large gallery (1,600+ cells) in the tap took over a second on a phone (#723).
            // Up to the scroll anchor's block when the grid is redrawn while scrolled.
            let now = 2 * size;
            if (anchor) {
                const at = list.findIndex((it) => nameOf(it) === anchor.name);
                if (at >= 0) now = Math.max(now, (Math.floor(at / size) + 2) * size);
            }
            let html = '';
            for (let i = 0; i < Math.min(now, list.length); i += size) html += chunkHtml(i);
            box.innerHTML = html;
            const token = ++gridToken;
            gridRest = now < list.length ? { token, box, next: now, total: list.length, chunkHtml, size } : null;
            // Later blocks as the list nears its end, not all of them up front: a 20,000-picture
            // gallery left ~40k nodes in the page for good, and every new print rebuilt and appended
            // all 333 blocks again (Fold7, #735). A jump further down still uses flushGrid().
            if (gridMore) { gridMore.disconnect(); gridMore = null; }
            if (gridRest && typeof IntersectionObserver === 'function') {
                gridMore = new IntersectionObserver((entries) => {
                    const g = gridRest;
                    if (!g || g.token !== token) { if (gridMore) gridMore.disconnect(); return; }
                    if (!entries.some((e) => e.isIntersecting)) return;
                    let add = '';
                    for (let n = 0; n < 2 && g.next < g.total; n++, g.next += g.size) add += g.chunkHtml(g.next);
                    g.box.insertAdjacentHTML('beforeend', add);
                    gridMore.disconnect();
                    if (g.next < g.total) gridMore.observe(g.box.lastElementChild); else { gridRest = null; gridMore = null; }
                }, { root: scroller, rootMargin: '0px 0px 1500px 0px' });
                gridMore.observe(box.lastElementChild);
            } else if (gridRest) {
                afterPaint().then(flushGrid);
            }
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

        /**
         * Menu > Set as Today Background: this phone's Today shows the picture (WM 6.1 does the same)
         * and Settings > Today's "Use desktop wallpaper" goes off, else the stored picture would
         * never show; Clear Today Background turns it back on. An open Settings page and Today
         * follow through wmSettingsChange.
         */
        function setTodayBackground(name, item) {
            const useKey = (window.wmSettings && window.wmSettings.keys && window.wmSettings.keys.todayUseDesktop) || 'wmTodayUseDesktop';
            try {
                if (!name) {
                    localStorage.removeItem(TODAY_BG_KEY);
                    localStorage.setItem(useKey, '1');
                } else {
                    // the viewer passes its own item: a picture opened from Director or Today need not be in this list
                    const pic = (item && (item.filename || item.original) === name) ? item : galleryList().find((it) => (it.filename || it.original) === name);
                    const url = pic && todayPictureUrl(pic);
                    if (!url) {
                        messageBox({ title: 'Pictures & Videos', icon: 'error', text: 'This picture cannot be set as the Today background.' });
                        return;
                    }
                    localStorage.setItem(TODAY_BG_KEY, url);
                    localStorage.setItem(useKey, '0');
                }
            } catch (_) {
                messageBox({ title: 'Pictures & Videos', icon: 'error', text: 'The Today background could not be saved on this device.' });
                return;
            }
            document.dispatchEvent(new CustomEvent('wmSettingsChange', { detail: { keys: [useKey, TODAY_BG_KEY] } }));
        }
        setTodayBackgroundFn = setTodayBackground;

        function viewPicture(name) {
            if (!name || typeof showLightbox !== 'function') return;
            // the wait cursor if the viewer is slow to come up (its first open loads PhotoSwipe)
            busy(Promise.resolve().then(() => showLightbox({ filename: name })).catch(() => { /* viewer not ready */ }));
        }

        /**
         * A picture's tap-and-hold menu: the picture view's operations on it, run by the desktop's own
         * functions (galleryActions.js, imageExpansion.js, galleryView.js) on the gallery's item.
         */
        function pictureMenu(name) {
            const item = galleryList().find((it) => (it.filename || it.original) === name) || null;
            const fn = (f) => (typeof window[f] === 'function' ? window[f] : null);
            const run = (f, arg) => { const g = fn(f); if (g && arg) { try { g(arg); } catch (err) { console.warn('[wmShell] picture menu', f, err); } } };
            const scraps = typeof currentGalleryView !== 'undefined' && currentGalleryView === 'scraps';
            return [
                { label: 'View', action: () => viewPicture(name) },
                '-',
                { label: 'Recast Spell', disabled: !item || !fn('rerollImage'), action: () => run('rerollImage', item) },
                // an upscaled picture is not upscaled again (the desktop's gallery menu refuses it too)
                { label: 'Upscale', disabled: !item || !!item.upscaled || !fn('upscaleImage'), action: () => run('upscaleImage', item) },
                { label: 'Expand Canvas', disabled: !item || !fn('openImageExpansionModal'), action: () => run('openImageExpansionModal', item && (item.upscaled || item.original || item.filename)) },
                '-',
                // the desktop gallery's Ask Wren (galleryView.js 'ask-wren'): the Director app opens with it attached
                { label: 'Ask Wren', disabled: !fn('askWrenAboutImage'), action: () => run('askWrenAboutImage', name) },
                '-',
                { label: 'Set as Today Background', action: () => setTodayBackground(name) },
                { label: 'Move To', disabled: !item, submenu: () => moveToItems(name) },
                { label: scraps ? 'Restore from Scraps' : 'Move to Scraps', disabled: !item, action: () => run(scraps ? 'removeFromScraps' : 'moveToScraps', item) },
                { label: 'Delete', disabled: !item || !fn('deleteImage'), action: () => run('deleteImage', item) }
            ];
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
            flushGrid();
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

        function setSize(page, k) {
            if (!PV_SIZES.some(([x]) => x === k) || k === pvSize) return;
            pvSize = k;
            try { localStorage.setItem(PV_SIZE_KEY, k); } catch (_) { /* storage off */ }
            layoutGrid(page);
            renderGrid(page, true);
        }

        function stepSize(page, dir) {
            const i = PV_SIZES.findIndex(([x]) => x === pvSize);
            const next = PV_SIZES[Math.max(0, Math.min(PV_SIZES.length - 1, i + dir))];
            setSize(page, next[0]);
        }

        function workspaceSubmenu() {
            return workspaceItems();
        }

        /** Back to the grid at a picture of the list (Go To, Visual Index). */
        function goBackTo(i) {
            back();
            const gpage = apps.get('gallery').page;
            if (gpage) setTimeout(() => jumpToIndex(gpage, i), 30);
        }

        // Go To (Yukimi, Nov 10: this list in place of the Go To submenus): a date (one row per month
        // with its first picture and count; date order only) and a position (every tenth of the list)
        registerApp({
            id: 'pv-goto',
            title: 'Go To',
            icon: 'app-pictures',
            titleAction: 'ok',
            mount(gp) {
                gp.classList.add('wm-pv-index');
                gp.addEventListener('click', (e) => {
                    const row = e.target.closest('[data-index]');
                    if (row) goBackTo(Number(row.dataset.index));
                });
            },
            show(gp) {
                const list = galleryList();
                if (!list.length) { gp.innerHTML = '<p class="wm-photos-empty">No pictures</p>'; return; }
                const row = (i, item, label, count) => `<button type="button" class="wm-pv-index-row" data-index="${i}"><img src="${escapeHtml(previewUrl(item))}" alt="" loading="lazy" decoding="async"><span class="wm-pv-index-label">${escapeHtml(label)}</span><span class="wm-pv-index-count">${escapeHtml(String(count))}</span></button>`;
                let html = '<div class="wm-pv-index-head">Date</div>';
                html += canGoToDate()
                    ? monthsOf(list).map((m) => row(m.index, m.item, m.label, m.count)).join('')
                    : '<p class="wm-pv-index-note">Sort by Date to go to a date.</p>';
                html += '<div class="wm-pv-index-head">Position</div>';
                const seen = new Set();
                for (let pct = 0; pct <= 100; pct += 10) {
                    const i = Math.min(list.length - 1, Math.round((pct / 100) * (list.length - 1)));
                    if (seen.has(i)) continue;
                    seen.add(i);
                    html += row(i, list[i], `Picture ${(i + 1).toLocaleString()} of ${list.length.toLocaleString()}`, `${pct}%`);
                }
                gp.innerHTML = html;
            },
            softKeys() { return { left: null, right: null }; }
        });

        // Visual Index: the desktop's Jump Index (galleryJumpIndex.js): the list split into groups at
        // gaps in time (a minimum gap, a maximum group size), each group a card with its first picture,
        // its time and count. Tap a card for its span, tap it again (or Go To) to jump there.
        const VI_GAP_KEY = 'wmPvIndexGap';
        const VI_MAX_KEY = 'wmPvIndexGroup';
        const viGapOptions = () => { try { if (typeof GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS !== 'undefined') return GALLERY_JUMP_INDEX_MIN_TIME_OPTIONS; } catch (_) { /* below */ } return [{ value: 1800000, name: '30 minutes' }]; };
        const viMaxOptions = () => { try { if (typeof GALLERY_JUMP_INDEX_MAX_GROUP_OPTIONS !== 'undefined') return GALLERY_JUMP_INDEX_MAX_GROUP_OPTIONS; } catch (_) { /* below */ } return [{ value: 100, name: '100' }]; };
        const lsNum = (k, d) => { try { const v = localStorage.getItem(k); return v == null ? d : v; } catch (_) { return d; } };
        let viGap = Number(lsNum(VI_GAP_KEY, 30 * 60 * 1000)) || 30 * 60 * 1000;
        let viMax = lsNum(VI_MAX_KEY, '100');
        let viEntries = [];
        let viPicked = null;

        function viStamp(item) {
            try { if (typeof getGalleryImageTimestampMs === 'function') { const t = getGalleryImageTimestampMs(item); if (Number.isFinite(t)) return t; } } catch (_) { /* below */ }
            return itemTime(item) || null;
        }

        /** The desktop's grouping (buildGalleryJumpIndexEntries) over the phone's list. */
        function viGroups(list) {
            const n = list.length;
            if (!n) return [];
            const minMs = viGap;
            const maxGroup = viMax === 'none' ? Infinity : Number(viMax) || 100;
            const MIN_GROUP = (typeof GALLERY_JUMP_INDEX_MIN_GROUP_IMAGES !== 'undefined') ? GALLERY_JUMP_INDEX_MIN_GROUP_IMAGES : 9;
            const ts = new Array(n);
            const out = [{ index: 0 }];
            let start = 0;
            let startTs = ts[0] = viStamp(list[0]);
            let prev = startTs;
            for (let i = 1; i < n; i++) {
                const t = ts[i] = viStamp(list[i]);
                const size = i - start;
                const enough = size >= MIN_GROUP;
                const byTime = enough && startTs !== null && t !== null && Math.abs(t - startTs) >= minMs;
                const bySize = Number.isFinite(maxGroup) && size >= maxGroup;
                const byJump = enough && prev !== null && t !== null && Math.abs(t - prev) >= minMs;
                if (byTime || bySize || byJump) { start = i; startTs = t; out.push({ index: i }); }
                prev = t;
            }
            for (let g = 0; g < out.length; g++) {
                const a = out[g].index;
                const b = g < out.length - 1 ? out[g + 1].index : n;
                out[g].groupCount = Math.max(1, b - a);
                let first = null;
                let last = null;
                for (let k = a; k < b; k++) { const t = ts[k]; if (t == null) continue; if (first === null || t < first) first = t; if (last === null || t > last) last = t; }
                out[g].firstMs = first;
                out[g].lastMs = last;
                out[g].startMs = ts[a];
                out[g].item = list[a];
            }
            return out;
        }

        const viCaption = (e) => { try { if (typeof formatGalleryJumpIndexCaption === 'function') return formatGalleryJumpIndexCaption(e); } catch (_) { /* below */ } return e.startMs ? new Date(e.startMs).toLocaleString() : `Group at ${e.index + 1}`; };
        const viSpan = (e) => { try { if (typeof formatGalleryJumpIndexSpan === 'function') return formatGalleryJumpIndexSpan(e); } catch (_) { /* below */ } return viCaption(e); };

        /** The group the grid is showing now (nearest start before the first cell on screen). */
        function viHere() {
            const gpage = apps.get('gallery').page;
            const a = gpage && gridAnchor(gpage);
            const list = galleryList();
            const at = a ? list.findIndex((it) => (it.filename || it.original) === a.name) : 0;
            let best = viEntries[0] || null;
            for (const e of viEntries) if (e.index <= Math.max(0, at)) best = e;
            return best;
        }

        function viPaint(vp) {
            const gap = viGapOptions().find((o) => Number(o.value) === viGap);
            const max = viMaxOptions().find((o) => String(o.value) === String(viMax));
            vp.querySelector('[data-k="gap"] span').textContent = gap ? gap.name : '30 minutes';
            vp.querySelector('[data-k="max"] span').textContent = max ? max.name : String(viMax);
            const e = viPicked;
            const list = galleryList();
            vp.querySelector('.wm-pvx-sum').innerHTML = e
                ? `<b>${escapeHtml(viSpan(e))}</b><span>${e.groupCount.toLocaleString()} pictures, from picture ${(e.index + 1).toLocaleString()} of ${list.length.toLocaleString()}</span>`
                : `<b>${viEntries.length.toLocaleString()} groups</b><span>${list.length.toLocaleString()} pictures</span>`;
            vp.querySelectorAll('.wm-pvx-card.is-selected').forEach((c) => c.classList.remove('is-selected'));
            if (e) { const c = vp.querySelector(`.wm-pvx-card[data-index="${e.index}"]`); if (c) c.classList.add('is-selected'); }
            renderSoftKeys();
        }

        function viBuild(vp) {
            viEntries = viGroups(galleryList());
            viPicked = viHere();
            const grid = vp.querySelector('.wm-pvx-grid');
            grid.innerHTML = viEntries.map((e) => `<button type="button" class="wm-pvx-card" data-index="${e.index}"><span class="wm-pvx-pic"><img src="${escapeHtml(previewUrl(e.item))}" alt="" loading="lazy" decoding="async" draggable="false"></span><span class="wm-pvx-cap">${escapeHtml(viCaption(e))}</span><span class="wm-pvx-n">${e.groupCount.toLocaleString()}</span></button>`).join('') || '<p class="wm-photos-empty">No pictures</p>';
            viPaint(vp);
            const sel = grid.querySelector('.wm-pvx-card.is-selected');
            if (sel) sel.scrollIntoView({ block: 'center' });
        }

        registerApp({
            id: 'pv-vindex',
            title: 'Visual Index',
            icon: 'app-pictures',
            titleAction: 'ok',
            mount(vp) {
                vp.classList.add('wm-pvx');
                vp.innerHTML = `
                    <div class="wm-pvx-bar">
                        <label>Gap</label><button type="button" class="wm-combo" data-k="gap"><span></span></button>
                        <label>Group</label><button type="button" class="wm-combo" data-k="max"><span></span></button>
                    </div>
                    <div class="wm-pvx-sum"></div>
                    <div class="wm-pvx-grid"></div>`;
                vp.querySelector('.wm-pvx-bar').addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-k]');
                    if (!b) return;
                    ev.stopPropagation();
                    const opts = b.dataset.k === 'gap' ? viGapOptions() : viMaxOptions();
                    showDropdown(b, opts.map((o) => ({
                        label: o.name,
                        radio: b.dataset.k === 'gap' ? Number(o.value) === viGap : String(o.value) === String(viMax),
                        action: () => {
                            if (b.dataset.k === 'gap') { viGap = Number(o.value); try { localStorage.setItem(VI_GAP_KEY, String(viGap)); } catch (_) { /* off */ } }
                            else { viMax = String(o.value); try { localStorage.setItem(VI_MAX_KEY, viMax); } catch (_) { /* off */ } }
                            busy(() => viBuild(vp), { paint: true });
                        }
                    })));
                });
                vp.querySelector('.wm-pvx-grid').addEventListener('click', (ev) => {
                    const c = ev.target.closest('.wm-pvx-card');
                    if (!c) return;
                    const e = viEntries.find((x) => x.index === Number(c.dataset.index));
                    if (!e) return;
                    if (viPicked === e) { goBackTo(e.index); return; }
                    viPicked = e;
                    viPaint(vp);
                });
            },
            show(vp) { busy(() => viBuild(vp), { paint: true }); },
            softKeys() {
                return { left: { label: 'Go To', disabled: !viPicked, action: () => viPicked && goBackTo(viPicked.index) }, right: null };
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
                const input = pvInput();
                if (input) input.value = q;
                runSearch(q);
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
                    <div class="wm-pv-tools" role="toolbar">
                        <input type="search" class="wm-pv-q wm-edit" enterkeyhint="search" autocomplete="off" placeholder="Search" aria-label="Search pictures">
                        <button type="button" class="wm-pv-tool wm-pv-glyph" data-act="top" title="Jump to Top" aria-label="Jump to Top"></button>
                        <button type="button" class="wm-pv-tool wm-pv-glyph" data-act="index" title="Visual Index" aria-label="Visual Index"></button>
                        <button type="button" class="wm-pv-tool" data-act="smaller" title="Smaller pictures" aria-label="Smaller pictures">-</button>
                        <button type="button" class="wm-pv-tool" data-act="larger" title="Larger pictures" aria-label="Larger pictures">+</button>
                    </div>
                    <div class="wm-pv-scroll"><div class="wm-pv-grid"></div><p class="wm-photos-empty" hidden>No pictures</p></div>`;
                const q = page.querySelector('.wm-pv-q');
                q.addEventListener('keydown', (e) => {
                    if (e.key === 'Enter') { e.preventDefault(); runSearch(q.value); q.blur(); }
                    else if (e.key === 'Escape') { e.preventDefault(); setSearch(false); q.blur(); }
                });
                // the field's own clear (x) or an emptied field ends the search
                q.addEventListener('search', () => { if (!q.value) setSearch(false); });
                q.addEventListener('input', () => { if (!q.value && searchResults) setSearch(false); });
                page.querySelector('.wm-pv-tools').addEventListener('click', (e) => {
                    const b = e.target.closest('.wm-pv-tool');
                    if (!b) return;
                    if (b.dataset.act === 'top') page.querySelector('.wm-pv-scroll').scrollTop = 0;
                    else if (b.dataset.act === 'index') open('pv-vindex');
                    else stepSize(page, b.dataset.act === 'larger' ? 1 : -1);
                });
                page.querySelector('.wm-pv-grid').addEventListener('click', (e) => {
                    const cell = e.target.closest('.wm-pv-cell');
                    if (!cell) return;
                    // WM: a tap selects the picture and opens it
                    selectCell(page, cell.dataset.filename);
                    viewPicture(cell.dataset.filename);
                });
                // WM: tap-and-hold a picture for its pop-up menu (the picture view's operations;
                // their questions are WM forms, wmDialogs.js)
                page.querySelector('.wm-pv-grid').addEventListener('contextmenu', (e) => {
                    const cell = e.target.closest('.wm-pv-cell');
                    if (!cell) return;
                    e.preventDefault();
                    selectCell(page, cell.dataset.filename);
                    window.wmShell.menuAt(e.clientX, e.clientY, pictureMenu(cell.dataset.filename));
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
                // the first fill of the grid behind WM's wait cursor (the folder bar and soft keys are
                // up at once); later shows only redraw what changed
                if (!gridSig) busy(() => renderGrid(page, false), { paint: true });
                else renderGrid(page, false);
                // the desktop gallery keeps loading, paging and searching underneath (allImages):
                // follow it while Pictures is on screen
                clearInterval(gridTimer);
                gridTimer = setInterval(() => renderGrid(page, false), 700);
            },
            hide() {
                clearInterval(gridTimer);
                gridTimer = null;
            },
            softKeys() {
                const page = this.page;
                return {
                    left: { label: 'View', disabled: !selectedName, action: () => viewPicture(selectedName) },
                    right: {
                        label: 'Menu',
                        // WM: Camera, Send..., Beam..., Save to Contact... | Delete, Edit, Play Slide
                        // Show, Set as Today Background..., Go To, Tools; here what Dreamscape has
                        menu: () => [
                            { label: 'Search...', action: () => setSearch(true) },
                            ...(searchResults ? [{ label: 'Clear Search', action: () => setSearch(false) }] : []),
                            { label: 'Jump to Top', action: () => { page.querySelector('.wm-pv-scroll').scrollTop = 0; } },
                            { label: 'Go To...', action: () => open('pv-goto') },
                            { label: 'Visual Index', action: () => open('pv-vindex') },
                            { label: 'Thumbnail Size', submenu: () => PV_SIZES.map(([k, label]) => ({ label, radio: pvSize === k, action: () => setSize(page, k) })) },
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
        // Create Persona is not offered: its chat window (chatSystem) has no phone form yet
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
            // a standalone viewer's slide (the Director's prints: mcpActivityClient glancewellSlides) has
            // only its file name: enough for Edit and Set as Today Background
            return (d && d.data) || (d && d.filename ? { filename: d.filename } : null);
        } catch (_) { return null; }
    }

    /** The picture on screen as a file to save (a slide without lightbox.js's Download button). */
    function viewerSlideFile() {
        try {
            const p = (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp) || window.pswp;
            const d = p && p.currSlide && p.currSlide.data;
            if (!d || !d.src) return null;
            // a gallery slide saves through the viewer's own Download; a standalone one (a mail
            // attachment by data URL, a picture by URL) is saved from its src under its title
            if (d.data && !d.data.isStandalone) return null;
            const inline = /^(data|blob):/i.test(String(d.src));
            const name = (d.data && d.data.title) || d.filename || (inline ? '' : String(d.src).split('/').pop().split('?')[0]) || 'picture';
            return { src: d.src, name };
        } catch (_) { return null; }
    }

    function viewerSave() {
        if (viewerButton('Download image')) { viewerPress('Download image'); return; }
        const f = viewerSlideFile();
        if (!f) return;
        const a = document.createElement('a');
        a.href = f.src;
        a.download = f.name || '';
        document.body.appendChild(a);
        a.click();
        a.remove();
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
            left: { label: 'Save', disabled: !viewerButton('Download image') && !viewerSlideFile(), action: viewerSave },
            right: {
                label: 'Menu',
                menu: () => {
                    const items = [{ label: 'Zoom', action: () => viewerPress('Zoom in/out') }];
                    if (viewerSlides() > 1) {
                        items.push({ label: 'Previous', action: () => viewerPress('Previous') });
                        items.push({ label: 'Next', action: () => viewerPress('Next') });
                    }
                    const item = viewerItem();
                    // WM 6.1's viewer Menu: Zoom, Play Slide Show, Set as Today Background...
                    const shown = item && (item.filename || item.original);
                    if (shown && setTodayBackgroundFn) items.push({ label: 'Set as Today Background', action: () => setTodayBackgroundFn(shown, item) });
                    if (shown) items.push({ label: 'Move To', submenu: () => moveToItems(shown) });
                    // Edit: the picture in DreamStudio (Glancewell's Open > DreamStudio, imageViewer.js
                    // openInCreator) or with the Director (Glancewell's E-mail: askWrenAboutImage); each
                    // opens its app over the viewer, Back returns here
                    const editPic = item && (item.filename || item.original);
                    const canStudio = !!(item && typeof window.openManualModalWithContent === 'function');
                    const canDirector = !!(editPic && typeof window.askWrenAboutImage === 'function');
                    if (canStudio || canDirector) {
                        items.push({ label: 'Edit', submenu: () => [
                            { label: 'DreamStudio', disabled: !canStudio, action: () => { window.openManualModalWithContent({ type: 'image', image: item }); } },
                            { label: 'Director', disabled: !canDirector, action: () => window.askWrenAboutImage(editPic) }
                        ] });
                    }
                    items.push('-');
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

    // live collections: the 150 / 400 ms polls below re-scan the page only after the DOM changed
    // (a querySelector walked all ~13,000 nodes on every tick: the shell's largest idle cost, #723)
    const openViewers = document.getElementsByClassName('pswp--open');
    const appErrorWindows = document.getElementsByClassName('dreamscape-app-error-window');

    function checkViewer() {
        let open = false;
        for (const el of openViewers) { if (el.classList.contains('pswp')) { open = true; break; } }
        if (open === viewerActive) return;
        viewerActive = open;
        viewerClosing = false;
        closeMenus(true);
        if (open) {
            root.setAttribute('data-wm-viewer', '');
            setTitle('Pictures & Videos');
        } else {
            root.removeAttribute('data-wm-viewer');
            const app = current && apps.get(current);
            // an app on one of its own pages names that page (titleNow(), e.g. the Director's Prints)
            let now = null;
            try { now = app && typeof app.titleNow === 'function' ? app.titleNow() : null; } catch (_) { now = null; }
            setTitle(current === 'today' ? startButtonPrefs().text : (now || (app && app.title) || current));
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
            for (const el of appErrorWindows) {
                if (el.parentElement === document.body && shown(el)) { on = true; break; }
            }
        }
        if (on) {
            if (!root.hasAttribute('data-wm-takeover')) { closeMenus(); root.setAttribute('data-wm-takeover', ''); }
        } else if (root.hasAttribute('data-wm-takeover')) {
            root.removeAttribute('data-wm-takeover');
        }
        // the corner catches up with layers that changed without telling the shell (a desktop
        // dialog opening as a WM message box, an app's own view switch)
        refreshTitleAction();
        // and the soft keys: blank under a message box, the app's again once it is answered
        if (modalUp() !== lastModal) renderSoftKeys();
        // the desktop's question is modal like WM's MessageBox: taps on the shell and the app under
        // it do nothing (html[data-wm-dialog], wm-shell.css); its opening is seen at once, not on the poll
        const dlg = document.getElementById('confirmationDialog');
        const dlgUp = !!(dlg && !dlg.classList.contains('hidden') && dlg.getClientRects().length);
        if (dlgUp !== root.hasAttribute('data-wm-dialog')) {
            if (dlgUp) { closeMenus(); root.setAttribute('data-wm-dialog', ''); } else root.removeAttribute('data-wm-dialog');
        }
        if (dlg && !dlg._wmWatched && typeof MutationObserver === 'function') {
            dlg._wmWatched = true;
            new MutationObserver(() => checkTakeover()).observe(dlg, { attributes: true, attributeFilter: ['class', 'style'] });
        }
    }

    // ---------------------------------------------------------------- startup

    // The WM 6.1 boot, measured on the emulator (hard and soft reset): black, the splash
    // (logo over the green swirl) while the OS starts, then Today with its items filling in.
    // A first install or an update download is wceload's screen instead ("Installing x.cab ..."
    // with the segmented bar and the wait cursor, then "x was successfully installed on your
    // device." with ok). Here: splash until the page's startup finishes, the installer while the
    // service worker downloads the app, then Today. html[data-wm-boot] = oem | splash | install | done.
    const BOOT_MIN_SPLASH_MS = 1600;
    const BOOT_MAX_SPLASH_MS = 25000;
    const INSTALLED_KEY = 'melatonMobileInstalled';
    const INSTALL_DONE_KEY = 'wmInstallDone';
    let bootStart = 0;
    let bootTimer = null;
    let waitTimer = null;
    let bootWaitDelay = null;
    const BOOT_WAIT_DELAY_MS = 2500;
    let installKind = null;

    function installNoun() {
        return installKind === 'update' ? 'Melaton Mobile update' : 'Melaton Mobile';
    }

    // The phone's own boot logo before Melaton Mobile's splash, as an old smartphone shows its maker
    // first (#735). The Android app draws it on its native cover at a cold start, so the page plays it
    // only in a browser (no Android bridge; older app builds skip it rather than show it after their cover).
    const OEM_LOGO_MS = 1800;
    let oemUntil = 0;

    function buildBootLayers() {
        const oem = document.createElement('div');
        oem.className = 'wm-oem';
        oem.setAttribute('aria-label', 'Xyridian');
        oem.innerHTML = '<img src="/static_images/xyridian/xyridian-logo-color-512.png" srcset="/static_images/xyridian/xyridian-logo-color-512.png 1x, /static_images/xyridian/xyridian-logo-color.png 2x" alt="" draggable="false">';
        shell.appendChild(oem);

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

        // WM's wait wheel on the splash once the shell starts loading, until Today is up
        const wait = document.createElement('img');
        wait.className = 'wm-boot-wait';
        wait.alt = '';
        wait.draggable = false;
        wait.hidden = true;
        shell.appendChild(wait);
    }

    function setBoot(phase) {
        if (root.dataset.wmBoot === phase) return;
        root.dataset.wmBoot = phase;
        const bootWait = shell.querySelector('.wm-boot-wait');
        // the wheel stays from the splash through Today's fill-in (reveal) until done
        if (!(phase === 'reveal' && bootWait && !bootWait.hidden)) {
            clearInterval(waitTimer);
            waitTimer = null;
            if (bootWait) bootWait.hidden = true;
        }
        clearTimeout(bootWaitDelay);
        bootWaitDelay = null;
        if (phase === 'splash' && bootWait) {
            // WM 6.1: the splash alone at first, then the wait wheel a few seconds in while the
            // shell loads, until Today is drawn (the splash ends at finishBoot)
            bootWaitDelay = setTimeout(() => {
                bootWaitDelay = null;
                if (root.dataset.wmBoot !== 'splash') return;
                let frame = 0;
                const tick = () => {
                    bootWait.src = art(`wait-${frame}`);
                    bootWait.srcset = srcset(`wait-${frame}`);
                    frame = (frame + 1) % 16;
                };
                tick();
                bootWait.hidden = false;
                waitTimer = setInterval(tick, 90);
            }, BOOT_WAIT_DELAY_MS);
        }
        if (phase === 'install') {
            closeMenus();
            setTitle('Start');
            bootTitleKind = null;
            refreshTitleAction();
            // wceload shows no soft keys while it copies (only the SIP button)
            softKeys = { left: null, right: null };
            shell.querySelectorAll('.wm-softkey').forEach((b) => { b.textContent = ''; b.disabled = true; });
            const img = shell.querySelector('.wm-installer-wait');
            let frame = 0;
            const tick = () => {
                img.src = art(`wait-${frame}`);
                img.srcset = srcset(`wait-${frame}`);
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
        bootTitleKind = 'ok';
        refreshTitleAction();
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
        // gwes plays SystemStart as the shell comes up (only once audio is unlocked: a tap or key
        // during startup, e.g. the PIN; a cold load stays silent)
        playSystemSound('SystemStart');
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
        if (root.dataset.wmBoot === 'oem') {
            if (Date.now() < oemUntil) return;
            setBoot('splash');
            bootStart = Date.now(); // the splash keeps its own minimum after the maker's logo
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
        if (!window.AndroidDisplay && !window.AndroidCaption) {
            oemUntil = bootStart + OEM_LOGO_MS;
            setBoot('oem');
        } else {
            setBoot('splash');
        }
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
        // the menus' tick and submenu arrow are CSS masks: fetched with the shell, not on the first
        // menu (the title bar's ok / X are inline in wm-shell.css)
        ['menu-check', 'menu-submenu-arrow'].forEach((n) => ['', '@2x', '@4x'].forEach((x) => { const img = new Image(); img.src = `/static_images/wm61/${n}${x}.png`; }));
        // the wait cursor's frames: a busy() right after boot must not show an empty frame while they download
        for (let f = 0; f < 16; f++) { const img = new Image(); img.decoding = 'async'; img.srcset = srcset(`wait-${f}`); img.src = art(`wait-${f}`); }
        registerTodayApp();
        registerGalleryApp();
        watchTheme();
        watchPixelScale();
        useMobileWording();
        stack.push('today');
        activate('today');
        applyTodayBackground();
        applyStartButton();
        document.addEventListener('wmSettingsChange', () => {
            applyTodayBackground(true);
            applyStartButton();
            syncBezel();
            fitStatus(); // Screen > Camera moves the title bar's camera gap
            const today = apps.get('today');
            if (today && today.page) today.refresh();
        });
        watchDirector();
        watchDevice();
        watchToasts();
        watchSystemSounds();
        watchRequestBusy();
        routeAlert();
        startBoot();
        refreshStatus();
        setInterval(refreshStatus, 2000);
        window.addEventListener('resize', () => { syncBezel(); if (noteTrayOpen) renderNotes(); else fitStatus(); });
        // the Android app moved or rotated the camera hole (--camera-hole-*)
        window.addEventListener('dreamscape:cutout', () => { syncBezel(); fitStatus(); });
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
        /** A WM notification: notify({ title, text, icon: 'info' | 'warning' | 'error' | 'success', timeout, buttons }). */
        notify: (opts) => notify(opts || {}),
        // for apps in their own files (wmFileExplorer.js ...)
        menu: (side, items, btn) => showPopup(side, items, btn),
        dropdown: (anchor, items, align, onClose) => showDropdown(anchor, items, align, onClose),
        closeMenus: () => closeMenus(),
        /** Registered apps (id, title, icon, inStart) in registration order. */
        /** A Today row from an app: registerTodayItem({ id, label, icon, after, text(), onTap() }). */
        registerTodayItem: (w) => registerTodayItem(w),
        /** Today rows from apps: [{ id, label }] (Settings > Today > Items). */
        listTodayItems: () => todayWidgets.map((w) => ({ id: w.id, label: w.label || w.id })),
        /** End an app: its page is removed and remounted on the next open (Task Manager). */
        endApp: (id) => endApp(id),
        /** Apps opened this session, most recent first. */
        openedApps: () => openedApps.slice(),
        /** An app's page, made (mounted) without bringing the app up. */
        pageOf: (id) => (apps.has(id) ? pageFor(apps.get(id)) : null),
        listApps: () => [...apps.values()].map((a) => ({ id: a.id, title: a.title, startLabel: a.startLabel, icon: a.icon, inStart: a.inStart, sip: !!a.sip, programsFolder: a.programsFolder || null })),
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
        /** The current app's corner for its layer ('close' | 'ok' | null), for apps without titleKind(). */
        setTitleAction: (k) => {
            if (current) titleKinds.set(current, k === 'ok' || k === 'close' ? k : null);
            refreshTitleAction();
        },
        /** An app's layer changed: the corner follows (titleKind()). */
        refreshTitleAction: () => refreshTitleAction(),
        art: { url: art, url2x: art2x, img: imgTag, srcset },
        escapeHtml,
        applyTheme,
        onPopState,
        thumbFor,
        bubble: (opts) => bubble(opts || {}),
        /** WM's wait cursor while the user must wait: busy(promise | fn, { delay, timeout }) or busy() -> release. */
        busy: (work, opts) => busy(work, opts || {}),
        /** Resolves once the next frame has painted (yield before heavy synchronous work). */
        afterPaint: () => afterPaint(),
        isBusy: () => busyCount > 0,
        /** WM 6.1 system sounds: play('SystemHand' | 'SystemExclamation' | 'Notification' ...), log (what played). */
        sounds: { play: (name, opts) => playSystemSound(name, opts || {}), log: snd.log, files: SND_FILE },
        /** Today's wallpaper placement (Settings > Today > Wallpaper). */
        wallpaper: {
            picture: () => todayPicture(),
            /** The URL Today uses for a gallery item (its full picture, not the square preview). */
            pictureFor: (item) => todayPictureUrl(item),
            desktop: () => { const w = desktopWallpaper(); return w ? w.url : null; },
            desktopPosition: () => { const w = activeWorkspaceRecord(); return (w && w.wallpaperPosition) || 'center center'; },
            mobile: () => mobileWallpaper(),
            /** { x, y } 0-100 % of a placement position (keywords or percentages). */
            focus: (position) => wallFocus(position),
            set: (v) => setMobileWallpaper(v),
            css: (placement, natural, scale) => placementCss(placement, natural, scale)
        },
        closeBubble: () => closeBubble(),
        // tests: run the startup sequence again (splash, installer, Today) on a live page
        _test: { restartBoot() { clearInterval(bootTimer); installKind = null; bootStart = Date.now(); setBoot('splash'); bootTimer = setInterval(bootTick, 200); } },
        deriveRoles,
        get current() { return current; }
    };

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
