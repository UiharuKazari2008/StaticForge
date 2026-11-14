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
    // The UI version this page runs (#739): app.html reads wmVersion before the first paint. 6.5
    // swaps the Start menu for the Start screen (wmStart65.js, app id 'start') and Today's rows
    // for the Melaton Default home screen (wmTitanium.js, setTodayView); wm65.css restyles the rest.
    const WM65 = root.dataset.wmVersion === '6.5';
    const FLAG65 = '/static_images/wm65/start-flag.png';
    // The Start mark: 6.1's flag was in colour, so 6.1 shows the four-colour Melaton emblem (19 /
    // 38 / 76 px files for the 19-unit box of the flag's cell, wm-shell.css .wm-start.is-melaton);
    // 6.5 is where the flag went white, so 6.5 keeps the one-colour emblem
    const EMBLEM61 = '/static_images/wm61/start-melaton@4x.png';
    const EMBLEM61_SRCSET = '/static_images/wm61/start-melaton.png 19w, /static_images/wm61/start-melaton@2x.png 38w, /static_images/wm61/start-melaton@4x.png 76w';
    const EMBLEM = WM65 ? '/static_images/melaton/melaton-white-256.png' : EMBLEM61;
    // 6.5 keeps its own Today items list (order, on / off, "Melaton Default"): its home screen has
    // the clock in the middle of the list, which is not 6.1's top-down order
    const TODAY_ITEMS_KEY = WM65 ? 'wmTodayItems65' : 'wmTodayItems';
    // the 6.5 order until one is chosen in Settings: the clock is home, in the centre, as on
    // Windows Mobile 6.5 (pictures, music, getting started, phone, voicemail | clock | text,
    // e-mail, calendar, favorites): pictures and the places above it, what arrives below
    const TODAY_ORDER_65 = ['owner', 'search', 'workspace', 'prints', 'music', 'studio', 'director', 'date', 'connection', 'text', 'messenger', 'messages', 'calendar', 'ie', 'favorites', 'tasks', 'weather', 'accounts', 'xlink', 'notes', 'files', 'remote-desktop', 'server'];
    function todayOrder65(ids) {
        const rank = (id) => { const i = TODAY_ORDER_65.indexOf(id); return i < 0 ? TODAY_ORDER_65.length : i; };
        return ids.map((id, i) => [id, i]).sort((a, b) => rank(a[0]) - rank(b[0]) || a[1] - b[1]).map(([id]) => id);
    }
    if (window.uiShell !== 'mobile' || !root.classList.contains('ui-mobile')) return;

    const ART = '/static_images/wm61/';
    // a name starting with '/' is an image path of its own (a desktop app icon), used as is
    // a path of the shared Program Icons store (#773: /static_images/wm-android/<name>, no extension)
    // is a whole WM icon set like the ROM art: <name>.png 16, @2x 32, @4x 64 and the -lg sizes
    const WM_SET = /^\/static_images\/wm-android\/[a-z0-9_-]+(-lg)?$/;
    const art = (name) => (WM_SET.test(name) ? `${name}.png` : String(name).startsWith('/') ? name : `${ART}${name}.png`);
    const art2x = (name) => (WM_SET.test(name) ? `${name}@2x.png` : String(name).startsWith('/') ? name : `${ART}${name}@2x.png`);
    // ROM art upscaled 4x (GPU, 4x-UltraSharp) for dense screens: a phone at DPR 2.6 with the
    // 1.5x touch scale draws icons at ~4x. Only these names have an @4x file (regenerate the list
    // when art is added: ls public/static_images/wm61/*@4x.png)
    const HD_ART = new Set(["app-teleport", "app-teleport-lg", "app-weather", "app-weather-lg", "app-traffic", "app-traffic-lg", "set-buttons", "app-chat", "app-chat-lg", "app-messenger", "app-messenger-lg", "app-spellbook", "app-spellbook-lg", "app-reference", "app-reference-lg", "app-remote-desktop-mobile", "app-remote-desktop-mobile-lg", "app-spellcaster", "app-spellcaster-lg", "app-phasewalker", "app-phasewalker-lg", "app-atelier", "app-atelier-lg", "app-expanders", "app-expanders-lg", "app-characters", "app-characters-lg", "app-emotion", "app-emotion-lg", "app-agora", "app-agora-lg", "app-novels", "app-novels-lg", "app-data-management", "app-data-management-lg", "app-image-search", "app-image-search-lg", "app-control-panel", "app-control-panel-lg", "app-paypass", "app-paypass-lg", "app-xlink", "app-xlink-lg", "app-import", "app-import-lg", "app-accounts", "app-accounts-lg", "app-calculator", "app-calculator-lg", "app-calendar", "app-calendar-lg", "app-contacts", "app-contacts-lg", "app-director", "app-director-lg", "app-file-explorer", "app-file-explorer-lg", "app-games", "app-games-lg", "app-solitaire", "app-solitaire-lg", "app-minesweeper", "app-minesweeper-lg", "app-blockdrop", "app-blockdrop-lg", "app-brickbreaker", "app-brickbreaker-lg", "app-inkball", "app-inkball-lg", "app-gems", "app-gems-lg", "app-folder-dreamscape", "app-folder-dreamscape-lg", "app-android", "app-android-lg", "app-folder-work", "app-folder-work-lg", "app-android-bridge", "app-android-bridge-lg", "app-program-icons", "app-program-icons-lg", "app-help", "app-help-lg", "app-ie", "app-ie-lg", "app-messaging", "app-messaging-lg", "app-sms", "app-sms-lg", "app-notes", "app-notes-lg", "app-office", "app-office-lg", "app-phone", "app-phone-lg", "app-pictures", "app-pictures-lg", "app-programs", "app-programs-lg", "app-search", "app-search-lg", "app-settings", "app-settings-lg", "app-studio", "app-studio-lg", "app-task-manager", "app-task-manager-lg", "app-today", "app-today-lg", "contacts-card", "contacts-email", "contacts-home", "contacts-mobile", "contacts-sms", "contacts-web", "contacts-work", "fe-card", "fe-device", "fe-file", "fe-folder", "fe-storage-card", "ie-busy", "ie-chevron", "ie-favorite", "ie-folder", "ie-go", "ie-lock", "ie-logo", "ie-page", "ie-search", "ie-stop", "ie-unlock", "menu-check", "menu-submenu-arrow", "msg-acct-mail", "msg-acct-outlook", "msg-acct-setup", "msg-acct-sms", "msg-attach-mail", "msg-attachment", "msg-folder-account", "msg-folder-deleted", "msg-folder-drafts", "msg-folder-folder", "msg-folder-inbox", "msg-folder-outbox", "msg-folder-sent", "msg-read", "msg-unread", "msgbox-error", "msgbox-info", "msgbox-question", "msgbox-warning", "notes-folders", "notes-note", "notes-recording", "notes-speaker", "set-about", "set-backlight", "set-clock", "set-connections", "set-domain", "set-error-reporting", "set-grimoire", "set-input", "set-lock", "set-memory", "set-menus", "set-netcards", "set-owner", "set-power", "set-regional", "set-remove-programs", "set-screen", "set-search-indexing", "set-sounds", "set-today", "set-update", "set-usb", "set-wireless", "set-workspace", "set-bluetooth", "set-cellular", "sip-keyboard", "start-flag", "status-battery-1", "status-battery-2", "status-battery-3", "status-battery-charging", "status-battery-empty", "status-battery-full", "status-battery-unknown", "status-bluetooth", "wrls-all-on", "wrls-nfc-on", "wrls-nfc-off", "wrls-all-off", "wrls-wifi-on", "wrls-wifi-off", "wrls-bluetooth-on", "wrls-bluetooth-off", "wrls-phone-on", "wrls-phone-off", "status-data-3g", "status-data-3g-active", "status-data-4g", "status-data-4g-active", "status-data-4g-plus", "status-data-4g-plus-active", "status-data-5g", "status-data-5g-active", "status-data-5g-plus", "status-data-5g-plus-active", "status-data-anim-00", "status-data-anim-01", "status-data-anim-02", "status-data-anim-03", "status-data-anim-04", "status-data-anim-05", "status-data-anim-06", "status-data-anim-07", "status-data-anim-08", "status-data-anim-09", "status-data-anim-10", "status-data-anim-11", "status-data-anim-12", "status-data-anim-13", "status-data-anim-14", "status-data-anim-15", "status-data-anim-16", "status-data-anim-17", "status-data-e", "status-data-e-active", "status-data-g", "status-data-g-active", "status-data-h", "status-data-h-active", "status-data-h-plus", "status-data-h-plus-active", "status-data-nr", "status-data-nr-active", "status-data-nr-a", "status-data-nr-a-active", "status-data-off", "status-data-on", "status-data-uw", "status-data-uw-active", "status-director", "status-mail", "status-sms", "status-messenger", "status-notify-many", "status-prints", "status-reminder", "status-roaming", "status-signal-1", "status-signal-2", "status-signal-3", "status-signal-4", "status-signal-alert", "status-signal-none", "status-signal-off", "status-signal-search-1", "status-signal-search-2", "status-signal-search-3", "status-vibrate", "status-volume", "status-volume-off", "volume-system", "volume-ringer", "status-wifi-available", "status-wifi-connected", "title-close", "title-ok", "today-calendar", "today-clock", "today-getting-started", "today-lock", "today-lock-locked", "today-messages", "today-owner", "today-phone", "today-search-button", "today-search-button-pressed", "today-tasks", "wait-0", "wait-1", "wait-10", "wait-11", "wait-12", "wait-13", "wait-14", "wait-15", "wait-2", "wait-3", "wait-4", "wait-5", "wait-6", "wait-7", "wait-8", "wait-9", "app-activesync", "app-activesync-lg", "app-tasks", "app-tasks-lg", "app-windows-media", "app-windows-media-lg", "as-attention", "as-connected", "as-notconnected", "as-syncing", "cal-bell", "cal-next", "cal-prev", "cal-today", "chat-buddy", "status-director-open-0", "status-director-open-1", "status-director-open-2", "status-director-open-3", "status-director-open-4", "status-director-clap-strip", "status-weather-alert", "status-rain-alarm", "status-traffic", "status-camera", "status-continuity", "status-activesync", "status-error", "status-update", "status-update-dl-strip", "status-warning", "wmp-add", "wmp-artist", "wmp-back", "wmp-burn", "wmp-delete", "wmp-disc", "wmp-down", "wmp-error", "wmp-favorite", "wmp-folder", "wmp-forward", "wmp-genre", "wmp-home", "wmp-music", "wmp-play", "wmp-playlist", "wmp-properties", "wmp-radio", "wmp-refresh", "wmp-search", "wmp-stop", "wmp-tv", "wmp-tv-folder", "wmp-up", "wmp-video", "wmp-webpage"]);
    const srcset = (name) => WM_SET.test(name) ? `${name}.png 1x, ${name}@2x.png 2x, ${name}@4x.png 4x` : String(name).startsWith('/') ? `${name} 1x` : `${art(name)} 1x, ${art2x(name)} 2x${HD_ART.has(name) ? `, ${ART}${name}@4x.png 4x` : ''}`;
    const imgTag = (name, alt = '') => `<img src="${art(name)}" srcset="${srcset(name)}" alt="${alt}" draggable="false">`;
    const escapeHtml = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

    const apps = new Map();
    const replacements = new Map(); // system app id -> starter (replaceApp)
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
        // the glossy bars (soft keys; the title bar of the gradient themes): edge and middle of the
        // gloss's first line, its top and bottom, and of the base under it (device: adb6ad / a0ebaa,
        // 9cbe9c / 94d794, 315931 / 42be4a, 084d08 / 14a818 on green; the same s and l under
        // Windows Default's teal)
        '--wm-gloss-line-edge': { dh: -28, s: 6, l: 70 }, '--wm-gloss-line-centre': { dh: -28, s: 64, l: 78 },
        '--wm-gloss-top-edge': { dh: -28, s: 21, l: 68 }, '--wm-gloss-top-centre': { dh: -28, s: 46, l: 71 },
        '--wm-gloss-bottom-edge': { dh: -28, s: 29, l: 27 }, '--wm-gloss-bottom-centre': { dh: -28, s: 49, l: 50 },
        '--wm-bar-edge': { dh: -28, s: 81, l: 17 }, '--wm-bar-centre': { dh: -28, s: 79, l: 37 },
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

    /**
     * The workspace colour as the phone's theme, 6.1 and 6.5 (Yozora #748). The devices take only
     * the hue from a theme's base colour and put it on fixed saturations and lightnesses (SHColor,
     * HKLM\Software\Microsoft\Color: checked on the emulators under Guava Bubbles and Windows
     * Default in 6.1, Vera Wang red and DVF green in 6.5); the workspace colour's saturation scales
     * them (deriveRoles), so a grey workspace gives a grey phone.
     * 6.1: the roles above, plus the tap-and-hold ring's dots (rgb 16 166 24 on the device's green)
     * and the notification zoom rectangle (the highlight as it is, before the white-text clamp),
     * and the title bands under white text (--wm-caption, --wm-band: 4.5 : 1).
     * 6.5: wm65.css holds the device's Classic Blue values; three numbers turn them: --wm65-dh, the
     * workspace hue less the Classic Blue highlight's (#2d5ecf, 221.9 deg), --wm65-k, the saturation
     * factor, --wm65-lm, a lightness factor for the mid tones under white text (they keep the
     * luminance Classic Blue has; --wm65-lb the same for the caption band's light end), and --wm65-near, how much of Classic
     * Blue's own hue spread (its roles sit up to 23 deg apart) is kept: all of it within 15 deg of
     * the device's blue, none from 45 deg on, like the 6.1 ok / X frame. The ROM's blue selector
     * art (list and menu selectors, menu arrow bars, message box caption, pressed scroll arrows,
     * the tab curves' face) is redrawn pixel by pixel with the same four numbers and handed to the
     * stylesheets as --wm65-art-<name> (the device ships a drawn set per theme instead). A workspace
     * in the Classic Blue highlight colour gives 0 / 1 / 1 / 1: no art variable, the ROM's files
     * as they are.
     */
    function applyTheme() {
        // before the workspace is known --primary-color is the page default: keep the cached roles
        if (!document.body.dataset.workspace) return;
        const color = getComputedStyle(document.body).getPropertyValue('--primary-color').trim();
        const roles = deriveRoles(color);
        if (!roles) return;
        const base = rgbToHsl(cssColorToRgb(color));
        const k = Math.max(0, Math.min(1.25, base.s / REF_SATURATION));
        const turn = (h) => ((h % 360) + 360) % 360;
        roles['--wm-hold-ring'] = `hsl(${turn(base.h).toFixed(1)} ${Math.min(100, 82.4 * k).toFixed(1)}% 35.7%)`;
        roles['--wm-zoom-rect'] = `hsl(${turn(base.h).toFixed(1)} ${Math.min(100, 64.6 * k).toFixed(1)}% 51%)`;
        const BLUE_HUE = 221.9, BLUE_S = 64.3, BLUE_L = 49.4;
        let dh = turn(base.h - BLUE_HUE + 180) - 180;
        let k65 = k;
        if (k65 < 0.005) dh = 0;
        if (Math.abs(dh) < 0.75 && Math.abs(k65 - 1) < 0.02) { dh = 0; k65 = 1; }
        // blue is the darkest hue at a given lightness: turned to green or yellow the same values
        // are far brighter and white text on them fades. Each is held at the luminance Classic Blue
        // itself has (white on the highlight 5.8 : 1), as the device's own drawn themes are
        // (DVF green's selector is l 34 against Classic Blue's 49)
        const keep = (h0, s0, l0, h, s) => {
            const want = contrastWithWhite(hslToRgb(h0, s0, l0)) - 0.02;
            let f = 100;
            while (f > 25 && contrastWithWhite(hslToRgb(h, s, l0 * f / 100)) < want) f -= 1;
            return f / 100;
        };
        const lm = keep(BLUE_HUE, BLUE_S, BLUE_L, turn(BLUE_HUE + dh), Math.min(100, BLUE_S * k65));
        roles['--wm65-dh'] = `${dh.toFixed(1)}deg`;
        roles['--wm65-k'] = k65.toFixed(3);
        roles['--wm65-lm'] = lm.toFixed(2);
        const near = k65 < 0.005 ? 1 : Math.max(0, Math.min(1, (45 - Math.abs(dh)) / 30));
        roles['--wm65-near'] = near.toFixed(3);
        // the classic caption band's light end (#5f6ff3: 11.6 deg from the highlight, s 86 l 66.3)
        // Classic Blue's own caption text reads at 2.6 : 1 on that end; any other theme gets 4.5 : 1
        let lb = keep(233.5, 86, 66.3, turn(BLUE_HUE + dh + 11.6 * near), Math.min(100, 86 * k65)) * 100;
        if (!(dh === 0 && k65 === 1)) {
            const lumOf = (rgb) => 1.05 / contrastWithWhite(rgb) - 0.05;
            const text = lumOf(hslToRgb(turn(BLUE_HUE + dh + 21.9 * near), Math.min(100, 42.1 * k65), 85.1));
            while (lb > 25 && (text + 0.05) / (lumOf(hslToRgb(turn(BLUE_HUE + dh + 11.6 * near), Math.min(100, 86 * k65), 66.3 * lb / 100)) + 0.05) < 4.5) lb -= 1;
        }
        roles['--wm65-lb'] = (lb / 100).toFixed(2);
        // 6.1: the bands that carry a white title. The device draws them in the highlight as it
        // is (white on its green is 1.9 : 1); here the message box caption (the highlight with a
        // quarter of white at its left end) and the bubble, notification and volume titles are
        // darkened until white reaches 4.5 : 1 on their lightest point
        const hl = { h: turn(base.h), s: Math.min(100, 64 * k) };
        let capL = 51;
        while (capL > 12 && contrastWithWhite(hslToRgb(hl.h, hl.s, capL).map((c) => 0.75 * c + 0.25)) < 4.5) capL -= 1;
        let bandL = 51;
        while (bandL > 12 && contrastWithWhite(hslToRgb(hl.h, hl.s, bandL)) < 4.5) bandL -= 1;
        roles['--wm-caption'] = `hsl(${hl.h.toFixed(1)} ${hl.s.toFixed(1)}% ${capL}%)`;
        roles['--wm-band'] = `hsl(${hl.h.toFixed(1)} ${hl.s.toFixed(1)}% ${bandL}%)`;
        const ART = ['listviewselector', 'menuselector', 'menuuparrowbackground-l', 'menuuparrowbackground-m', 'menuuparrowbackground-r', 'menudownarrowbackground-l', 'menudownarrowbackground-m', 'menudownarrowbackground-r', 'msgboxtitle', 'scrollbaruparrowbuttonselected', 'scrollbardownarrowbuttonselected', 'scrollbaruparrowbuttonselected-4x', 'scrollbardownarrowbuttonselected-4x', 'tabcurve-face-face', 'tabcurve-face-white', 'tabcurve-white-face', 'tabcurve-face-black'];
        const art = applyTheme.art || (applyTheme.art = { key: '', vars: {}, pending: '', images: {} });
        const artKey = `${roles['--wm65-dh']}|${roles['--wm65-k']}|${roles['--wm65-lm']}|${roles['--wm65-near']}`;
        const plain = dh === 0 && k65 === 1 && lm === 1;
        if (plain) { art.key = artKey; art.vars = {}; art.pending = ''; }
        if (art.key === artKey) Object.assign(roles, art.vars);
        for (const [name, value] of Object.entries(roles)) root.style.setProperty(name, value);
        // the art of another colour stays until the new set is drawn; none is left in the ROM's blue
        if (art.key === artKey) for (const name of ART) if (!(`--wm65-art-${name}` in roles)) root.style.removeProperty(`--wm65-art-${name}`);
        try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(roles)); } catch (_) { /* storage off */ }
        if (!WM65 || art.key === artKey || art.pending === artKey) return;
        art.pending = artKey;
        const load = (name) => art.images[name] || (art.images[name] = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => resolve(img);
            img.onerror = () => resolve(null);
            // every piece is the ROM's 2x file; the pressed scroll arrows also have a 4x one for dense screens
            const file = name.endsWith('-4x') ? `${name.slice(0, -3)}@4x` : `${name}@2x`;
            img.src = `/static_images/wm65/${name.startsWith('tabcurve-') ? '' : 'theme-classicblue-'}${file}.png`;
        }));
        // Classic Blue is the palest of the ROM's six drawn sets: its list selector averages s 61,
        // the other five 78 to 96 (mean 86), its menu arrow bars 52 against 58 to 97. Away from blue
        // the redrawn art takes that ratio (1.4), so a red or green selector is as full as theirs
        const vivid = 1 + 0.4 * (1 - near);
        Promise.all(ART.map(load)).then((images) => {
            if (art.pending !== artKey) return;
            const vars = {};
            images.forEach((img, i) => {
                if (!img) return;
                try {
                    const canvas = document.createElement('canvas');
                    canvas.width = img.naturalWidth;
                    canvas.height = img.naturalHeight;
                    const ctx = canvas.getContext('2d');
                    ctx.drawImage(img, 0, 0);
                    const data = ctx.getImageData(0, 0, canvas.width, canvas.height);
                    const px = data.data;
                    if (ART[i].startsWith('tabcurve-')) {
                        // a tab's edge curve carries corners in the tab face colour: they must be
                        // the very colour the tabs are filled with (--wm65-face), or the corners
                        // show as wedges of another shade. The art's own face colour (its most
                        // frequent coloured pixel) is mapped onto it, channel by channel, white
                        // and black staying where they are
                        const count = new Map();
                        for (let p = 0; p < px.length; p += 4) {
                            if (px[p + 3] < 255) continue;
                            const mx = Math.max(px[p], px[p + 1], px[p + 2]);
                            const mn = Math.min(px[p], px[p + 1], px[p + 2]);
                            if (mx - mn < 8) continue;
                            const key = (px[p] << 16) | (px[p + 1] << 8) | px[p + 2];
                            count.set(key, (count.get(key) || 0) + 1);
                        }
                        let from = null;
                        let most = 0;
                        count.forEach((n, key) => { if (n > most) { most = n; from = [key >> 16, (key >> 8) & 255, key & 255]; } });
                        const probe = document.createElement('i');
                        probe.style.cssText = 'position:absolute;visibility:hidden;color:var(--wm65-face)';
                        (shell || document.body).appendChild(probe);
                        const to = (getComputedStyle(probe).color.match(/[\d.]+/g) || []).slice(0, 3).map(Number);
                        probe.remove();
                        if (from && to.length === 3) {
                            const map = (v, a, b) => (v <= a ? (a ? v * b / a : b) : b + (v - a) * (255 - b) / ((255 - a) || 1));
                            for (let p = 0; p < px.length; p += 4) {
                                if (!px[p + 3]) continue;
                                const mx = Math.max(px[p], px[p + 1], px[p + 2]);
                                const mn = Math.min(px[p], px[p + 1], px[p + 2]);
                                if (mx - mn < 3) continue; // white, black and the shadow's greys
                                px[p] = Math.round(map(px[p], from[0], to[0]));
                                px[p + 1] = Math.round(map(px[p + 1], from[1], to[1]));
                                px[p + 2] = Math.round(map(px[p + 2], from[2], to[2]));
                            }
                        }
                        ctx.putImageData(data, 0, 0);
                        vars[`--wm65-art-${ART[i]}`] = `url("${canvas.toDataURL('image/png')}")`;
                        return;
                    }
                    for (let p = 0; p < px.length; p += 4) {
                        if (!px[p + 3]) continue;
                        const c = rgbToHsl({ r: px[p], g: px[p + 1], b: px[p + 2] });
                        // the greys (white glyphs, black edges, shadows) are not the theme's
                        if (c.s < 3) continue;
                        const rgb = hslToRgb(turn(BLUE_HUE + dh + (turn(c.h - BLUE_HUE + 180) - 180) * near), Math.min(100, c.s * k65 * vivid), c.l * lm);
                        px[p] = Math.round(rgb[0] * 255);
                        px[p + 1] = Math.round(rgb[1] * 255);
                        px[p + 2] = Math.round(rgb[2] * 255);
                    }
                    ctx.putImageData(data, 0, 0);
                    vars[`--wm65-art-${ART[i]}`] = `url("${canvas.toDataURL('image/png')}")`;
                } catch (_) { /* this piece keeps the ROM's blue */ }
            });
            art.key = artKey;
            art.vars = vars;
            art.pending = '';
            for (const name of ART) {
                const prop = `--wm65-art-${name}`;
                if (prop in vars) root.style.setProperty(prop, vars[prop]);
                else root.style.removeProperty(prop);
            }
            try { localStorage.setItem(THEME_CACHE_KEY, JSON.stringify(Object.assign({}, roles, vars))); } catch (_) { /* storage off */ }
        });
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
        // the art this density needs (#774): another tier's package is fetched now when small,
        // else Melaton Mobile asks to restart, where the installer brings just those files
        const pk = window.melatonPackages;
        if (pk && typeof pk.noteTier === 'function') {
            const change = pk.noteTier(artClass === 'wm-art-4x' ? 4 : artClass === 'wm-art-2x' ? 2 : 1);
            if (change && change.added && change.added.length) packagesAdded(change);
        }
    }

    /** New asset packages (a density, or Applied Updates): download them once the shell is up. */
    function packagesAdded(change) {
        const started = Date.now();
        const go = () => {
            const m = window.serviceWorkerManager;
            if (!m || typeof m.applyPackageChange !== 'function' || !m.bootComplete) {
                if (Date.now() - started < 180000) setTimeout(go, 2000);
                return;
            }
            m.applyPackageChange(change, {
                confirmLarge: ({ bytes }) => messageBox({
                    title: 'Melaton Update',
                    icon: 'question',
                    text: `The pictures for this screen size are not on this device yet (${(bytes / 1048576).toFixed(1)} MB). Restart now to install them?`,
                    buttons: [{ text: 'Restart', value: true }, { text: 'Later', value: false, default: true }]
                })
            }).catch(() => { /* the next boot's check installs them */ });
        };
        go();
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
    // a new text message (Text Messaging, #779) is outres 32508, the phone and envelope; a new
    // Dreamscape Messenger message (the chat personas) Windows Live Messenger's buddy (WLMMessengerResources 12000)
    // Weather (#792): an active alert at Home / Work, rain due or falling there with the rain alarm on
    // (Melaton glyphs: scripts/generate-wm-weather-status-icons.py)
    const STATUS_APP_ICONS = { mail: 'status-mail', sms: 'status-sms', chat: 'status-messenger', prints: 'status-prints', director: 'status-director', update: 'status-update', wxalert: 'status-weather-alert', rain: 'status-rain-alarm', traffic: 'status-traffic', continuity: 'status-continuity', received: 'status-activesync' };
    // no High Latency icon (Yukimi, Nov 13: a slow link is neither a status icon nor a notification)
    // Traffic (#795): the commute ahead is more than 15 min late (scripts/generate-wm-traffic-status-icon.py)
    // Continuity (#798): this phone carries its DeX window's connection (scripts/generate-wm-continuity-status-icon.py)
    // ActiveSync Received Items (#803): something arrived while the phone was locked or away (the
    // the ROM's own sync arrows, shellres.192.dll 4685: scripts/extract-wm-activesync-status-icon.py)
    const STATUS_APP_ROLES = ['mail', 'sms', 'chat', 'prints', 'director', 'update', 'wxalert', 'rain', 'traffic', 'continuity', 'received'];
    // the Director's clapper while a turn runs: the stick claps (open frames, closed, open again);
    // status-director-clap-strip holds them in that order (scripts/build-wm-sprite-strips.sh)
    const DIRECTOR_CLAP_FRAMES = 6;
    // 6.5's own drawing of a glyph where its ROM differs (outres.192 32508 is anti-aliased there)
    const ART65 = new Set(['status-sms']);
    const artImageSet = (name) => (WM65 && ART65.has(name)
        ? `image-set(url("/static_images/wm65/${name}.png") 1x, url("/static_images/wm65/${name}@2x.png") 2x, url("/static_images/wm65/${name}@4x.png") 4x)`
        : `image-set(url("${art(name)}") 1x, url("${art2x(name)}") 2x${HD_ART.has(name) ? `, url("${ART}${name}@4x.png") 4x` : ''})`);

    // ---------------------------------------------------------------- frame

    /**
     * Android scales web text by the system font size (Settings > Display > Font size: the WebView's
     * text zoom, Chrome's font scale). A phone set to 0.9 drew every label of the shell 10 % small
     * against bars and icons that kept their size (A53: title 14.2 px where 15.75 belongs). The shell
     * is drawn to WM's pixel metrics, so the scale is measured once and cancelled with
     * text-size-adjust (a 100 px probe that computes to 90 px gives 111.11 %).
     */
    function fixTextZoom() {
        try {
            const probe = document.createElement('span');
            probe.style.cssText = 'position:fixed;left:0;top:0;visibility:hidden;font-size:100px;line-height:1';
            probe.textContent = 'M';
            document.body.appendChild(probe);
            const got = parseFloat(getComputedStyle(probe).fontSize);
            probe.remove();
            if (got > 20 && Math.abs(got - 100) > 0.5) {
                const pct = `${(10000 / got).toFixed(3)}%`;
                root.style.setProperty('-webkit-text-size-adjust', pct);
                root.style.setProperty('text-size-adjust', pct);
            }
        } catch (_) { /* the text keeps the system's scale */ }
    }

    function build() {
        shell = document.createElement('div');
        shell.id = 'wmShell';
        shell.innerHTML = `
            <header class="wm-titlebar">
                <button type="button" class="wm-start" aria-label="Start" aria-haspopup="menu" aria-expanded="false">
                    <img src="${EMBLEM}" alt="" draggable="false">
                </button>
                <div class="wm-title" role="heading" aria-level="1">Start</div>
                <div class="wm-status">
                    <span class="wm-status-reserve" aria-hidden="true" hidden></span>
                    <button type="button" class="wm-status-icon" data-role="notify" hidden aria-label="Notifications"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="mail" hidden aria-label="Messages"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="sms" hidden aria-label="New text messages"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="chat" hidden aria-label="New Dreamscape Messenger messages"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="prints" hidden aria-label="Prints"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="director" hidden aria-label="Director"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="update" hidden aria-label="Updates ready"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="wxalert" hidden aria-label="Weather alert"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="rain" hidden aria-label="Rain alarm"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="traffic" hidden aria-label="Commute delay"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="continuity" hidden aria-label="Continuity"></button>
                    <button type="button" class="wm-status-icon wm-status-app" data-role="received" hidden aria-label="ActiveSync: received items"></button>
                    <button type="button" class="wm-status-icon" data-role="bluetooth" data-icon="bluetooth" hidden aria-label="Bluetooth"></button>
                    <button type="button" class="wm-status-icon" data-role="data" data-icon="data-off" aria-label="Connectivity"></button>
                    <button type="button" class="wm-status-icon" data-role="cell" hidden aria-label="Mobile network"></button>
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
                <button type="button" class="wm-sip" aria-label="Input panel" aria-pressed="false">${imgTag('sip-keyboard')}</button>
                <button type="button" class="wm-softkey" data-side="right"></button>
            </footer>
            <div class="wm-viewbar" role="toolbar" aria-label="Picture" hidden></div>
            <div class="wm-startmenu-pic" aria-hidden="true" hidden><div></div></div>
            <nav class="wm-startmenu" role="menu" hidden></nav>
            <div class="wm-popup" role="menu" hidden></div>
            <div class="wm-msgbox-layer" hidden></div>
            <div class="wm-busy" role="status" aria-live="polite" hidden><img class="wm-busy-wait" alt="Please wait" draggable="false" hidden></div>
            <div class="wm-bubble" role="dialog" hidden></div>
            <div class="wm-volume" role="dialog" aria-label="Volume" hidden></div>
            <div class="wm-notify-tray" role="listbox" aria-label="Notifications" hidden></div>
            <div class="wm-notify" role="alertdialog" hidden></div>`;
        fixTextZoom();
        if (WM65) {
            // 6.5 draws the Today picture over the whole screen, the title and soft key bars
            // translucent on it (Titanium_480x640.cpr: Background Top="-52" Height="640"): a layer
            // behind the bars carries Today's picture on Today and Start (applyTodayBackground)
            const wall = document.createElement('div');
            wall.className = 'wm-wall65';
            wall.hidden = true;
            wall.setAttribute('aria-hidden', 'true');
            shell.prepend(wall);
        }
        document.body.appendChild(shell);

        shell.querySelector('.wm-start').addEventListener('click', (e) => {
            e.stopPropagation();
            // the lift after a hold (the task switcher came up), or a tap while the switcher is open
            if (taskSwitcherStartClick()) return;
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
                else if (messageIconTap(b.dataset.role)) { /* its waiting notification */ }
                else statusBubble(b.dataset.role, b);
            });
        });
        // The input panel button. Device (6.1 and 6.5, MS_SIPBUTTON): a tap opens the panel, a tap
        // while it is up closes it, both on pen up; nothing is drawn for the pen held on it; while
        // the panel is up the cell is lit. Here the panel is the phone's own keyboard: it is up
        // while html[data-wm-sip] is set (watchSip), which aria-pressed follows for the lit cell.
        const sipBtn = shell.querySelector('.wm-sip');
        const sipTyping = (el) => !!el && el !== document.body && el.matches('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([type=button]):not([type=submit]):not([disabled]), textarea:not([disabled]), [contenteditable=""], [contenteditable="true"]');
        let sipField = null;  // the field the keyboard was last up for
        let sipWasUp = false; // the keyboard's state when the finger went down
        sipBtn.addEventListener('pointerdown', () => {
            sipWasUp = root.hasAttribute('data-wm-sip');
            if (sipTyping(document.activeElement)) sipField = document.activeElement;
        });
        // the button never takes the focus: the field keeps it, and the keyboard, until the tap ends
        sipBtn.addEventListener('mousedown', (e) => e.preventDefault());
        sipBtn.addEventListener('click', () => {
            if (sipWasUp || root.hasAttribute('data-wm-sip')) {
                // the panel closes: the field lets go of the keyboard
                sipWasUp = false;
                const el = document.activeElement;
                if (sipTyping(el)) { sipField = el; el.blur(); }
                return;
            }
            // the current app's page only: a field on a hidden page must not take the keyboard
            const app = current && apps.get(current);
            const scope = (app && app.page) || shell.querySelector('.wm-content');
            const last = sipField && sipField.isConnected && scope.contains(sipField) && !sipField.disabled && sipField.getClientRects().length ? sipField : null;
            const input = last || [...scope.querySelectorAll('input:not([type=hidden]):not([type=checkbox]):not([type=radio]):not([disabled]), textarea:not([disabled])')]
                .find((el) => el.getClientRects().length) || shell.querySelector('.wm-searchbar:not([hidden]) input');
            if (!input) return;
            // a field that kept the focus while the keyboard went down (the phone's back key) takes
            // the keyboard again only on a new focus
            if (document.activeElement === input) input.blur();
            input.focus();
        });
        document.addEventListener('wmSipChange', (e) => {
            sipBtn.setAttribute('aria-pressed', e.detail && e.detail.height > 0 ? 'true' : 'false');
        });
        document.addEventListener('click', (e) => {
            // a tap outside an open bubble hides it (its own buttons and links close it too)
            const bub = shell.querySelector('.wm-bubble');
            if (!bub.hidden && !bub.contains(e.target) && !(e.target.closest && e.target.closest('#wmShell .wm-status-icon'))) closeBubble();
            const vc = shell.querySelector('.wm-volume');
            if (!vc.hidden && !vc.contains(e.target) && !(e.target.closest && e.target.closest('#wmShell .wm-status-icon'))) closeVolume();
            // the notification tray closes on a tap elsewhere
            if (noteTrayOpen && !(e.target.closest && e.target.closest('#wmShell .wm-notify-tray, #wmShell [data-role="notify"]'))) { noteTrayOpen = false; renderNotes(); }
            // a tap anywhere else hides a notification on screen, as on 6.1 (Yukimi, Nov 14): it waits in
            // the title bar; its soft keys (Hide / Dismiss / Menu) and the title bar icons keep their own taps
            const nb = shell.querySelector('.wm-notify');
            if (nb && !nb.hidden && noteShown && !nb.contains(e.target)
                && !(e.target.closest && e.target.closest('#wmShell .wm-softkeys, #wmShell .wm-titlebar, #wmShell .wm-popup, #wmShell .wm-msgbox-layer'))) hideNote();
            if (!openPopup || openPopup.contains(e.target)) return;
            // Start and the soft keys toggle their own menus: closing here first would let
            // their click handler open the menu again
            if (e.target.closest && e.target.closest('#wmShell .wm-start, #wmShell .wm-title, #wmShell .wm-softkey, #wmShell [aria-haspopup="menu"]')) return;
            closeMenus();
        }, true);
        bindHoldRing();
        bindTaskSwitcher();
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
        } else if (taskSwitch.open) {
            // the task switcher (hold on Start) is a layer of its own
            closeTaskSwitcher(true);
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
        if (historyDepth() > 0) { if (!window.melatonRestarting) history.back(); return; }
        if (closeTopLayer()) syncHistory({ noPush: true });
    }

    let titleText = 'Start';

    /** The app's title; while the Start menu is open the bar shows the Start button's text (WM). */
    let glassTitle = '';
    function setTitle(text) {
        // a program's next window repaints the whole bar: 6.5's see-through title bar ends
        if (root.dataset.wmBar && text !== glassTitle && text !== titleText) delete root.dataset.wmBar;
        titleText = text;
        if (stage && stage.mask.title) return; // its step draws it (staged drawing)
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
        return { text: 'Start', icon: EMBLEM };
    }

    function applyStartButton() {
        if (!shell) return;
        const b = startButtonPrefs();
        const img = shell.querySelector('.wm-start img');
        // 6.5's title bar flag is white (shellres.192 icon 4609 there), whatever the theme
        const flag65 = WM65 && b.icon === art('start-flag');
        const src = flag65 ? FLAG65 : b.icon;
        if (img && src && img.getAttribute('src') !== src) {
            img.setAttribute('src', src);
            if (flag65) img.setAttribute('srcset', `${FLAG65} 1x, ${FLAG65.replace('.png', '@2x.png')} 2x, ${FLAG65.replace('.png', '@4x.png')} 4x`);
            else if (b.icon === art('start-flag')) img.setAttribute('srcset', srcset('start-flag'));
            else img.removeAttribute('srcset');
        }
        // 6.1's colour emblem: the file nearest the box's device size (19 units wide)
        const emblem61 = !WM65 && b.icon === EMBLEM61;
        if (img && emblem61) {
            img.setAttribute('sizes', `${19 * (parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1)}px`);
            if (img.getAttribute('srcset') !== EMBLEM61_SRCSET) img.setAttribute('srcset', EMBLEM61_SRCSET);
        } else if (img) img.removeAttribute('sizes');
        shell.querySelector('.wm-start').classList.toggle('is-melaton', emblem61);
        // the Windows flag keeps WM's own colours and Start-cell metrics (wm-shell.css)
        shell.querySelector('.wm-start').classList.toggle('is-flag', b.icon === art('start-flag'));
        shell.querySelector('.wm-start').setAttribute('aria-label', b.text);
        if (current === 'today' && !viewerActive && root.dataset.wmBoot !== 'install') setTitle(b.text);
    }

    function setTitleAction(kind) {
        if (stage && stage.mask.corner) return; // its step draws it (staged drawing)
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
            if (!(stage && stage.mask.keys)) btn.textContent = key ? key.label : '';
            btn.disabled = !key || !!key.disabled;
            btn.setAttribute('aria-haspopup', key && key.menu ? 'menu' : 'false');
            btn.setAttribute('aria-expanded', 'false');
        }
        if (!(stage && stage.mask.keys)) shell.querySelector('.wm-sip').hidden = !(app && app.sip);
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
            if (item.icon) { b.classList.add('has-icon'); b.insertAdjacentHTML('afterbegin', imgTag(item.icon)); }
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
     * WM submenu (Menu > Edit ▸ on the device): opens over its parent; 6.1 level with the row that
     * opened it (moved up to fit), 6.5 with its bottom on that row. It lives inside the parent popup, so taps in it count as inside.
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
        let left;
        let top;
        if (document.documentElement.dataset.wmVersion === '6.5') {
            left = pr.left + pr.width * 0.35 - sw;
            if (left < 2) left = Math.min(pr.right - pr.width * 0.35, window.innerWidth - sw - 2);
            top = rr.bottom - sh;
        } else {
            // 6.1 (Yukimi's WVGA captures, #757: Reply, Go To, Tools, Select Messages): the list starts 48 units
            // in from the parent's left edge; one that would leave the screen ends 50 units short of its right
            // edge. Its top is level with the row, moved up only as far as it must to end above the soft keys.
            const u = shell.getBoundingClientRect().width / 240;
            left = pr.left + 48 * u;
            if (left + sw > window.innerWidth) left = window.innerWidth - 50 * u - sw;
            top = rr.top;
            if (top + sh > pr.bottom) top = pr.bottom - sh;
        }
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
        // both devices open a menu with its first enabled row under the highlight (recorded: soft
        // key, tap-and-hold and Start menus; a drop-down keeps its own mark for the current choice).
        // It leaves as soon as the finger goes anywhere in the menu
        if (side !== 'dropdown') {
            const first = pop.querySelector(':scope > .wm-popup-item:not(:disabled)');
            if (first) first.classList.add('is-hot');
            const cool = () => { pop.querySelectorAll(':scope > .is-hot').forEach((x) => x.classList.remove('is-hot')); pop.removeEventListener('pointerover', cool); pop.removeEventListener('pointerdown', cool); };
            pop.addEventListener('pointerover', cool);
            pop.addEventListener('pointerdown', cool);
        }
        // 6.5 (recorded: e_menu, fe_hold): the first paint has the frame and the first row only,
        // under the selector; the other rows come a tick later. Choosing a row erases the frame
        // first, the rows' texts standing alone for a tick (closeMenus)
        if (WM65 && side !== 'dropdown') {
            pop.dataset.wmPaint = 'first';
            clearTimeout(pop._paintTimer);
            pop._paintTimer = setTimeout(() => { delete pop.dataset.wmPaint; }, STAGE_TICK);
            if (!pop._choiceBound) {
                pop._choiceBound = true;
                pop.addEventListener('click', (e) => { if (e.target.closest && e.target.closest('.wm-popup-item:not(:disabled)')) pop._chosenAt = Date.now(); }, true);
            }
        } else {
            delete pop.dataset.wmPaint;
        }
        pop.hidden = false;
        openPopup = pop;
        // CE's Menu pop-up event (silent unless a sound is picked for it)
        playSystemSound('menu');
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
        clampPopup(pop, r);
        // callers size the list after this returns (a combo's width, a scroll limit): once more then
        queueMicrotask(() => { if (openPopup === pop && dropdownAnchor === anchor) clampPopup(pop, r); });
    }

    /**
     * Keep an open popup (drop-down, context menu) inside the content box, between the title bar
     * and the soft keys: pulled back left / right, a drop-down with no room below opens above its
     * control (as WM's combo lists do), and a list taller than the box scrolls, opening on its
     * current choice. anchor: the control's rect (drop-downs).
     */
    function clampPopup(pop, anchor = null) {
        if (!pop || pop.hidden) return;
        const sr = shell.getBoundingClientRect();
        const content = shell.querySelector('.wm-content');
        const cr = content ? content.getBoundingClientRect() : sr;
        const pad = 2;
        const minL = cr.left - sr.left + pad;
        const maxR = cr.right - sr.left - pad;
        const minT = Math.max(0, cr.top - sr.top);
        const maxB = cr.bottom - sr.top;
        if (pop.offsetWidth > maxR - minL) { pop.style.maxWidth = `${Math.max(0, maxR - minL)}px`; pop.style.overflowX = 'hidden'; }
        let pr = pop.getBoundingClientRect();
        const w = pr.width;
        const left = Math.max(minL, Math.min(pr.left - sr.left, maxR - w));
        if (Math.abs(left - (pr.left - sr.left)) > 0.5) { pop.style.right = 'auto'; pop.style.left = `${left}px`; }
        pr = pop.getBoundingClientRect();
        let h = pr.height;
        const top = pr.top - sr.top;
        if (top >= minT - 0.5 && top + h <= maxB + 0.5) return;
        if (h > maxB - minT) {
            pop.style.maxHeight = `${Math.max(0, maxB - minT)}px`;
            pop.style.overflowY = 'auto';
            h = pop.getBoundingClientRect().height;
        }
        let t;
        if (anchor && top + h > maxB && anchor.top - sr.top - h >= minT) t = anchor.top - sr.top - h;
        else t = Math.max(minT, Math.min(top, maxB - h));
        pop.style.bottom = 'auto';
        pop.style.top = `${t}px`;
        const on = pop.scrollHeight > pop.clientHeight && pop.querySelector(':scope > [aria-checked="true"]');
        if (on) pop.scrollTop = Math.max(0, on.offsetTop - (pop.clientHeight - on.offsetHeight) / 2);
    }

    function closeMenus(silent) {
        const had = !!openPopup;
        const popEl = shell.querySelector('.wm-popup');
        if (WM65 && had && !popEl.hidden && popEl._chosenAt && Date.now() - popEl._chosenAt < 80) {
            // a row was chosen: the frame goes first, the texts a tick later (a copy that takes no taps)
            popEl._chosenAt = 0;
            const ghost = popEl.cloneNode(true);
            ghost.classList.add('wm-popup-ghost');
            ghost.setAttribute('aria-hidden', 'true');
            ghost.setAttribute('inert', '');
            shell.appendChild(ghost);
            setTimeout(() => ghost.remove(), STAGE_TICK);
        }
        popEl.hidden = true;
        // its submenus go with it: a submenu left inside the hidden menu (Messaging's Folders /
        // accounts list) still matched '.wm-popup:not([hidden])', and the 6.5 Start screen and
        // home screen took every tap for one that closes a menu (Fold7, Nov 12 2026)
        popEl.querySelectorAll(':scope > .wm-popup-sub').forEach((n) => n.remove());
        // the control a drop-down hung from comes back up (showPopup marked it expanded; only the soft
        // keys and Start were put back, so every combo and tool button stayed pushed in, #825)
        if (dropdownAnchor && typeof dropdownAnchor.setAttribute === 'function') dropdownAnchor.setAttribute('aria-expanded', 'false');
        dropdownAnchor = null;
        if (popupOnClose) { const fn = popupOnClose; popupOnClose = null; fn(); }
        shell.querySelector('.wm-startmenu').hidden = true;
        shell.querySelector('.wm-startmenu-pic').hidden = true;
        shell.querySelector('.wm-start').setAttribute('aria-expanded', 'false');
        markStartOpen(false);
        shell.querySelectorAll('.wm-softkey').forEach((b) => b.setAttribute('aria-expanded', 'false'));
        openPopup = null;
        if (had && !silent) syncHistory();
    }

    // ---------------------------------------------------------------- Start menu

    function toggleStartMenu() {
        if (WM65 && apps.has('start')) {
            // WM 6.5: Start is a screen of its own; the Start button on it goes back
            closeMenus(true);
            if (current === 'start') back(); else open('start');
            return;
        }
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
                // switching keeps the app as it was (its page stays mounted); the wait cursor shows
                // at once that the tap was taken (every launch tap, #775 follow-up)
                busy(() => switchTo(b.dataset.app), { paint: true, timeout: 15000 });
            });
        });
        menu.querySelectorAll('.wm-startmenu-item').forEach((b) => {
            b.addEventListener('click', (e) => {
                e.stopPropagation();
                closeMenus();
                busy(() => open(b.dataset.app, { fromStart: true }), { paint: true, timeout: 15000 });
            });
        });
        // the device opens Start with its first row ("Today") under the highlight
        const firstRow = menu.querySelector('.wm-startmenu-item');
        if (firstRow) {
            firstRow.classList.add('is-selected');
            const cool = () => { firstRow.classList.remove('is-selected'); menu.removeEventListener('pointerover', cool); menu.removeEventListener('pointerdown', cool); };
            menu.addEventListener('pointerover', cool);
            menu.addEventListener('pointerdown', cool);
        }
        menu.hidden = false;
        startMenuPicture(menu);
        openPopup = menu;
        shell.querySelector('.wm-start').setAttribute('aria-expanded', 'true');
        markStartOpen(true);
        syncHistory();
    }

    /**
     * WM 6.1 draws the Start menu on the Today picture: the piece of it the menu covers, at the
     * place Today shows it (emulator: pixel for pixel the Today background, over any program), the
     * theme's separators and white text on top. A layer under the menu holds a copy of Today's
     * background, the size of Today's page, shifted by the menu's place; no picture: the theme.
     */
    function startMenuPicture(menu) {
        const pic = shell.querySelector('.wm-startmenu-pic');
        const today = apps.get('today');
        const src = today && today.page;
        const on = !!(src && src.classList.contains('has-picture') && src.style.backgroundImage);
        menu.classList.toggle('has-picture', on);
        pic.hidden = !on;
        if (!on) return;
        const sr = shell.getBoundingClientRect();
        // Today's page box: the content area (its own rect while it is on screen)
        const box = (src.hidden || !src.offsetWidth ? shell.querySelector('.wm-content') : src).getBoundingClientRect();
        const mr = menu.getBoundingClientRect();
        Object.assign(pic.style, { left: `${mr.left - sr.left}px`, top: `${mr.top - sr.top}px`, width: `${mr.width}px`, height: `${mr.height}px` });
        const inner = pic.firstElementChild;
        Object.assign(inner.style, {
            left: `${box.left - mr.left}px`, top: `${box.top - mr.top}px`, width: `${box.width}px`, height: `${box.height}px`,
            backgroundImage: src.style.backgroundImage, backgroundSize: src.style.backgroundSize || 'cover',
            backgroundPosition: src.style.backgroundPosition || 'center', backgroundRepeat: src.style.backgroundRepeat || 'no-repeat',
            backgroundColor: src.style.backgroundColor || '#000'
        });
    }

    // ---------------------------------------------------------------- apps

    /**
     * Whether something is on screen now: the page visible, the screen on, and (given an element) it
     * attached and not inside a hidden page. Timers that draw check it and skip the tick otherwise;
     * the view draws in full when it shows again (Yukimi, Nov 14: nothing draws what is not visible).
     */
    function onScreen(el) {
        if (document.hidden || root.dataset.screenOff !== undefined) return false;
        if (!el) return true;
        return el.isConnected && !el.closest('[hidden]');
    }

    function registerApp(app) {
        if (!app || !app.id) return;
        apps.set(app.id, Object.assign({ inStart: false, icon: 'app-programs', title: app.id }, app));
    }

    // ---- programs loaded on demand (#817 slice 2): the boot registers only what the Start menu and
    // Programs need to show them (title, icon, folder); the program's script loads when it first
    // opens, its registerApp replaces the entry, and the open goes on. Nothing else may call into
    // such a program before then (see LAZY_APPS at the end of this file).
    const lazyLoads = new Map();
    function registerLazyApp(spec) {
        if (!spec || !spec.id || !spec.script || apps.has(spec.id)) return;
        const entry = Object.assign({}, spec, { lazyScript: spec.script });
        delete entry.script;
        delete entry.globals;
        delete entry.withFeatures;
        registerApp(entry);
        (spec.globals || []).forEach((g) => lazyGlobal(spec.id, g));
        (spec.withFeatures || []).forEach((f) => {
            if (!lazyByFeature.has(f)) lazyByFeature.set(f, []);
            lazyByFeature.get(f).push(spec.id);
        });
        wrapFeatureLoaderForLazy();
    }
    /**
     * Programs that patch a desktop feature as it loads (wmSuiteKit.afterFeature, Remote Desktop's
     * hook): when featureLoader loads that feature, the program's script loads too, before the caller
     * gets control back, so its patch is in place (withFeatures).
     */
    const lazyByFeature = new Map();
    let lazyLoaderWrapped = false;
    function wrapFeatureLoaderForLazy() {
        const fl = window.featureLoader;
        if (lazyLoaderWrapped || !lazyByFeature.size) return;
        if (!fl || typeof fl.loadFeature !== 'function') { setTimeout(wrapFeatureLoaderForLazy, 500); return; }
        lazyLoaderWrapped = true;
        const orig = fl.loadFeature;
        fl.loadFeature = async function (name, ...rest) {
            const r = await orig.call(this, name, ...rest);
            for (const id of lazyByFeature.get(name) || []) {
                const app = apps.get(id);
                if (app && app.lazyScript) await loadLazyApp(id);
            }
            return r;
        };
    }
    /**
     * A global the program's script sets for other code (Spellbook's showPresetManager, Spellcaster's
     * wmSpellcaster.openSpell ...): until the script loads, a stand-in that loads it and then calls
     * the real one ('name' for a function, { name, methods } for an object). The script replaces it.
     */
    function lazyGlobal(id, g) {
        const name = typeof g === 'string' ? g : g && g.name;
        if (!name) return;
        const methods = typeof g === 'object' && Array.isArray(g.methods) ? g.methods : null;
        let stub = null;
        const call = (method, args) => loadLazyApp(id).then((ok) => {
            const real = window[name];
            if (!ok || !real || real === stub) { open(id); return undefined; }
            const fn = method ? real[method] : real;
            return typeof fn === 'function' ? fn.apply(method ? real : window, args) : undefined;
        });
        if (methods) {
            stub = {};
            methods.forEach((m) => { stub[m] = (...args) => call(m, args); });
            // answers that need no program (read from storage, a default): given at once, nothing loads
            Object.assign(stub, g.sync || {});
        } else {
            stub = (...args) => call(null, args);
        }
        window[name] = stub;
    }
    function loadScriptOnce(src) {
        if (window.featureLoader && typeof window.featureLoader._loadScript === 'function') return window.featureLoader._loadScript(src);
        return new Promise((resolve, reject) => {
            const el = document.createElement('script');
            el.src = src;
            el.async = false;
            el.onload = () => resolve();
            el.onerror = () => reject(new Error('Failed to load ' + src));
            document.body.appendChild(el);
        });
    }
    /** Loads a lazy program's script once; true when its real registration replaced the entry. */
    function loadLazyApp(id) {
        const app = apps.get(id);
        if (!app || !app.lazyScript) return Promise.resolve(!!app);
        if (!lazyLoads.has(id)) {
            const run = loadScriptOnce(app.lazyScript)
                .then(() => { const now = apps.get(id); return !!(now && !now.lazyScript); })
                .catch((err) => { console.warn('[wmShell] load', id, err); return false; })
                .then((ok) => { if (!ok) lazyLoads.delete(id); return ok; });
            lazyLoads.set(id, run);
        }
        return lazyLoads.get(id);
    }
    function openLazy(id, opts) {
        void busy(loadLazyApp(id)).then((ok) => {
            if (ok) { open(id, opts); return; }
            // the script did not come (no connection and not cached yet): the program stays closed
            void messageBox({ title: apps.get(id) ? apps.get(id).title : id, icon: 'error', text: 'The program could not be opened. Try again when the connection is back.' });
        });
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

    // the shell's own screens are not open apps (Yukimi, Nov 10)
    const SHELL_SCREENS = new Set(['today', 'start', 'programs', 'settings', 'help']);

    function noteOpened(id) {
        const app = apps.get(id);
        if (!app || SHELL_SCREENS.has(id) || !app.inStart) return;
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

    const pageScroll = new WeakMap(); // page -> scrollTop when it was hidden

    // ---------------------------------------------------------------- staged drawing
    //
    // Neither device swaps a screen in one go (recorded frame by frame, #748). The shell still
    // switches at once (the app is live, the keys act), and then, for a few 40 ms ticks, puts back
    // the old look of the parts the device repaints late and releases them in the device's order:
    //   6.1  first launch: title text, then the page, the corner button, the soft keys last
    //        back to an open app, and back to Today: the page first, title / corner / keys a tick later
    //   6.5  from Start (cold): Start goes, the home screen shows through, the title bar turns
    //        black with the app's name, then the page, the soft keys, the keyboard button last
    //        from a home screen panel: page and soft key bar first under the see-through "Start"
    //        closing to home: the title bar turns home first, then the soft key bar, the body last
    // The emulator's own times are 2 to 10 times longer; the order is what is kept. Nothing waits
    // on it: any new switch finishes the running one at once. Off with reduced motion.
    /**
     * Tap-and-hold: the device's ring of dots, then the pop-up menu.
     * Measured on the emulators (recordings fehold, notehold, mbhold1-3 / fe_hold, fe_hold2): eight
     * dots, 7 units each with a black edge, in the theme's dark highlight colour, on a ring 14 units
     * in radius (the diagonal ones 10.5 off both ways) whose middle is 2 units above the pen. The
     * first at 12 o'clock, then clockwise.
     *   6.1: first dot 250-370 ms after pen down, one every ~85 ms, the menu at 720-840 ms; the
     *        dots the menu does not cover stay a tick longer.
     *   6.5: nothing for 500 ms, one dot every ~95 ms, the ring is erased when it is whole and the
     *        menu follows (its first row, then the rest).
     * The browser's own long press (a contextmenu event after about half a second) is taken while
     * a finger is down and the program's menu is asked for when the ring is whole, by a contextmenu
     * event at the pen point. Edit fields keep the browser's own press (selection, paste); the
     * bars, menus and message boxes have no ring (buttons on the device do not either).
     */
    // 6.5 as recorded on a device instance at full speed (Start screen, three holds): first dot ~430 ms,
    // menu 950-980 ms after pen down (the earlier VM recordings ran slower: 500 / 1460-1570)
    const HOLD_FIRST_MS = WM65 ? 430 : 250;
    const HOLD_STEP_MS = WM65 ? 60 : 70;
    const HOLD_MENU_MS = WM65 ? 50 : 0;    // from the whole ring to the menu
    const HOLD_LEAVE_MS = WM65 ? 0 : 80;   // the ring stays this long after the menu (6.1)
    const HOLD_SLOP = 8;                   // CSS px the pen may wander
    const HOLD_SKIP = 'input, textarea, select, [contenteditable=""], [contenteditable="true"], .wm-titlebar, .wm-softkeys, .wm-viewbar, .wm-popup, .wm-msgbox-layer, .wm-busy, .wm-splash, .wm-lock65, .wm-bubble, .wm-notify, .wm-notify-tray, .wrd-touch, .wmb-touch, .wmb-core, [data-wm-no-hold]';
    const holdRing = { el: null, id: null, x: 0, y: 0, target: null, timers: [], touchAt: 0 };

    function holdRingEnd(keepMs) {
        holdRing.timers.forEach(clearTimeout);
        holdRing.timers = [];
        holdRing.id = null;
        holdRing.target = null;
        const el = holdRing.el;
        if (!el || el.hidden) return;
        if (keepMs) holdRing.timers.push(setTimeout(() => { el.hidden = true; }, keepMs));
        else el.hidden = true;
    }

    function holdRingStart(e) {
        holdRingEnd(0);
        if (!shell || !e.isPrimary) return;
        const t = e.target;
        // the title bar has no ring, but for the Start button: its hold brings the task switcher
        if (!t || !t.closest || (t.closest(HOLD_SKIP) && !taskSwitcherHoldTarget(t))) return;
        if (root.dataset.wmBoot && root.dataset.wmBoot !== 'done') return;
        holdRing.heldId = null;
        holdRing.liftAt = 0;
        holdRing.id = e.pointerId;
        holdRing.x = e.clientX;
        holdRing.y = e.clientY;
        holdRing.target = t;
        if (!holdRing.el) {
            const el = document.createElement('div');
            el.className = 'wm-hold-ring';
            el.hidden = true;
            el.setAttribute('aria-hidden', 'true');
            el.innerHTML = '<i></i><i></i><i></i><i></i><i></i><i></i><i></i><i></i>';
            shell.appendChild(el);
            holdRing.el = el;
        }
        const el = holdRing.el;
        const dots = el.children;
        for (let i = 0; i < 8; i++) {
            holdRing.timers.push(setTimeout(() => {
                if (i === 0) {
                    const sr = shell.getBoundingClientRect();
                    el.style.left = `${holdRing.x - sr.left}px`;
                    el.style.top = `${holdRing.y - sr.top}px`;
                    for (const d of dots) d.hidden = true;
                    el.hidden = false;
                }
                dots[i].hidden = false;
            }, HOLD_FIRST_MS + i * HOLD_STEP_MS));
        }
        const whole = HOLD_FIRST_MS + 8 * HOLD_STEP_MS;
        if (WM65) holdRing.timers.push(setTimeout(() => { el.hidden = true; }, whole));
        holdRing.timers.push(setTimeout(() => {
            const target = holdRing.target;
            const x = holdRing.x;
            const y = holdRing.y;
            // the pen is still down when the menu comes up under it: its lift must not choose a row
            holdRing.heldId = holdRing.id;
            holdRingEnd(HOLD_LEAVE_MS);
            if (!target || !target.isConnected) return;
            target.dispatchEvent(new MouseEvent('contextmenu', { bubbles: true, cancelable: true, composed: true, view: window, clientX: x, clientY: y, button: 2 }));
        }, whole + HOLD_MENU_MS));
    }

    function bindHoldRing() {
        const touch = (e) => e.pointerType === 'touch' || e.pointerType === 'pen';
        document.addEventListener('pointerdown', (e) => {
            if (!touch(e)) return;
            holdRing.touchAt = Date.now();
            holdRingStart(e);
        }, true);
        document.addEventListener('pointermove', (e) => {
            if (holdRing.id !== e.pointerId) return;
            if (Math.abs(e.clientX - holdRing.x) > HOLD_SLOP || Math.abs(e.clientY - holdRing.y) > HOLD_SLOP) holdRingEnd(0);
        }, true);
        const up = (e) => {
            if (holdRing.heldId != null && holdRing.heldId === e.pointerId) { holdRing.heldId = null; holdRing.liftAt = Date.now(); }
            if (holdRing.id === e.pointerId) holdRingEnd(0);
        };
        // the click that a lift after a hold may bring (a browser that did not see a long press
        // of its own, a synthetic pointer): taken, whatever is under the pen by then
        document.addEventListener('click', (e) => {
            if (!holdRing.liftAt || Date.now() - holdRing.liftAt > 450) return;
            holdRing.liftAt = 0;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
        document.addEventListener('pointerup', up, true);
        document.addEventListener('pointercancel', up, true);
        document.addEventListener('scroll', () => { if (holdRing.id != null) holdRingEnd(0); }, true);
        // the browser's own long press: ours comes when the ring is whole
        document.addEventListener('contextmenu', (e) => {
            if (!e.isTrusted || Date.now() - holdRing.touchAt > 3000) return;
            if (e.target && e.target.closest && e.target.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
    }

    const STAGE_TICK = 40;
    let stage = null;

    function stageFlush() {
        if (!stage) return;
        const s = stage;
        stage = null;
        s.timers.forEach(clearTimeout);
        try { s.finish(); } catch (err) { console.warn('[wmShell] stage', err); }
    }

    function stageTokens(list) {
        if (list && list.length) root.dataset.wmStage = list.join(' ');
        else delete root.dataset.wmStage;
    }

    function stageRun(steps, finish) {
        // mask: the parts whose old look is held; the shell's own repaints (the 2 s refresh, a
        // poll) leave them alone until their step comes
        const s = { timers: [], finish, mask: { title: true, corner: true, keys: true } };
        stage = s;
        let t = 0;
        steps.forEach(([delay, fn], i) => {
            t += delay;
            s.timers.push(setTimeout(() => {
                if (stage !== s) return;
                try { fn(); } catch (err) { console.warn('[wmShell] stage step', err); }
                if (i === steps.length - 1) { stage = null; try { finish(); } catch (err) { console.warn('[wmShell] stage', err); } }
            }, t));
        });
    }

    /** What the screen shows now, to put back for a tick or two after a switch. */
    function stageSnapshot() {
        if (!shell) return null;
        const corner = shell.querySelector('.wm-title-action');
        const keys = [...shell.querySelectorAll('.wm-softkey')];
        const app = current && apps.get(current);
        return {
            app: current,
            page: app ? app.page : null,
            title: shell.querySelector('.wm-title').textContent,
            corner: { hidden: corner.hidden, kind: corner.dataset.kind },
            keys: keys.map((b) => b.textContent),
            sip: shell.querySelector('.wm-sip').hidden
        };
    }

    function stagePlay(before, id, page, firstMount) {
        if (!before || !before.app || before.app === id || root.dataset.wmBoot !== 'done' || viewerActive || document.hidden || switchCoverFor) return;
        try { if (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) return; } catch (_) { /* staged */ }
        const T = STAGE_TICK;
        const titleEl = shell.querySelector('.wm-title');
        const corner = shell.querySelector('.wm-title-action');
        const keyEls = [...shell.querySelectorAll('.wm-softkey')];
        const sip = shell.querySelector('.wm-sip');
        const oldPage = before.page && before.page !== page ? before.page : null;
        const todayPage = apps.get('today') && apps.get('today').page;
        let held = null; // the page left on screen in place of the new one
        const hold = (p) => { if (!p || p === page) return; held = p; p.hidden = false; page.style.visibility = 'hidden'; };
        const showPage = () => { if (held) { held.hidden = held !== (apps.get(current) || {}).page; held = null; } page.style.visibility = ''; };
        const oldTitle = () => { titleEl.textContent = before.title; };
        const newTitle = () => { if (stage) stage.mask.title = false; if (!shell.querySelector('.wm-titlebar').classList.contains('is-start-open')) titleEl.textContent = titleText; };
        const oldCorner = () => { corner.hidden = before.corner.hidden; if (before.corner.kind) corner.dataset.kind = before.corner.kind; };
        const noCorner = () => { corner.hidden = true; };
        const newCorner = () => { if (stage) stage.mask.corner = false; refreshTitleAction(); };
        const labels = (list) => keyEls.forEach((b, i) => { b.textContent = list[i] || ''; });
        const oldKeys = () => { labels(before.keys); sip.hidden = before.sip; };
        const newKeys = () => { if (stage) { stage.mask.keys = false; stage.mask.corner = false; } renderSoftKeys(); };
        const finish = () => { showPage(); newTitle(); renderSoftKeys(); stageTokens([]); };
        const toToday = id === 'today';

        if (!WM65) {
            if (!toToday && firstMount && oldPage) {
                // first launch: the title is already the app's; the old screen stays under it
                hold(oldPage); oldCorner(); oldKeys();
                if (before.app === 'today') stageTokens(['body-home']);
                stageRun([[2 * T, () => { showPage(); stageTokens([]); }], [T, newCorner], [T, newKeys]], finish);
                return;
            }
            // an app that is already open, and Today: the page first
            oldTitle(); oldCorner(); oldKeys();
            stageRun([[T, () => { newTitle(); newCorner(); newKeys(); }]], finish);
            return;
        }

        if (before.app === 'start' && !toToday) {
            // 6.5 from the Start screen. A program that is already running comes up straight over
            // the grid: only its title is drawn, on the home look of the bar (the see-through
            // title bar, set by activate()). A cold one lets the home screen show through first
            if (!firstMount || !todayPage) return;
            const home = apps.get('today');
            let homeKeys = ['', ''];
            try { const k = home.softKeys() || {}; homeKeys = [k.left ? k.left.label : '', k.right ? k.right.label : '']; } catch (_) { /* blank keys */ }
            hold(todayPage); titleEl.textContent = startButtonPrefs().text; noCorner(); labels(homeKeys); sip.hidden = true;
            stageTokens(['body-home', 'title-home', 'keys-home']);
            stageRun([
                [2 * T, () => { newTitle(); stageTokens(['body-home', 'title-app', 'keys-home']); }],
                [3 * T, () => { showPage(); stageTokens(['keys-home']); }],
                [2 * T, () => { stageTokens([]); newCorner(); labels([(softKeys.left || {}).label, (softKeys.right || {}).label]); }],
                [T, newKeys]
            ], finish);
            return;
        }
        if (before.app === 'today' && !toToday && id !== 'start') {
            // from a home screen panel: the page and the black soft key bar under the home's title
            oldTitle(); noCorner(); labels(['', '']);
            stageTokens(['title-home']);
            stageRun([[2 * T, () => stageTokens([])], [T, () => { newTitle(); newCorner(); newKeys(); }]], finish);
            return;
        }
        if (toToday && before.app !== 'start' && oldPage) {
            // closing to the home screen: its title bar first, then the soft key bar, the body last
            hold(oldPage); oldKeys();
            stageTokens(['body-app', 'keys-app']);
            stageRun([[2 * T, () => stageTokens(['body-app'])], [T, newKeys], [2 * T, () => { showPage(); stageTokens([]); }]], finish);
        }
    }

    function activate(id) {
        const app = apps.get(id);
        if (!app) return;
        // a lazy program reached without open() (the back history after a restart): load it, then show it
        if (app.lazyScript) { void busy(loadLazyApp(id)).then((ok) => { if (ok && current !== id) activate(id); }); return; }
        stageFlush();
        const before = stageSnapshot();
        const firstMount = !app.page;
        noteOpened(id);
        const prev = current && apps.get(current);
        if (prev && prev !== app) {
            // a hidden page loses its scroll offset: kept here and put back when it returns
            // (Today read from the top again after every row that opened an app)
            if (prev.page) { pageScroll.set(prev.page, prev.page.scrollTop); prev.page.hidden = true; }
            if (typeof prev.hide === 'function') prev.hide();
        }
        current = id;
        root.dataset.wmApp = id;
        // an app with a scene (the Director) keeps its page full height under the keyboard: only its
        // foreground and the soft keys go up (watchSip)
        root.toggleAttribute('data-wm-sip-overlay', !!app.sipOverlay);
        const page = pageFor(app);
        page.hidden = false;
        // Today's title bar reads "Start"; an app shows its name and the X (or ok) at the right
        setTitle(id === 'today' ? startButtonPrefs().text : (app.title || id));
        if (typeof app.show === 'function') app.show(page);
        const y = pageScroll.get(page);
        if (y) { page.scrollTop = y; requestAnimationFrame(() => { if (!page.hidden) page.scrollTop = y; }); }
        renderSoftKeys();
        // 6.5's see-through title bar inside a program (device: e-mail from Start when it is
        // already running 7 of 7, Settings pages from the Settings grid 5 of 5; never a first
        // launch, never from a home screen panel): a window that comes up straight over the Start
        // grid gets only its title text redrawn, on the home look of the bar. It stays while that
        // window is in front; another window (a new title) or leaving clears it (setTitle, here)
        if (WM65) {
            if (before && before.app === 'start' && id !== 'today' && id !== 'start' && !firstMount) { root.dataset.wmBar = 'glass'; glassTitle = titleText; }
            else if (!(before && before.app === id)) delete root.dataset.wmBar; // the same program again (a Settings page opening) keeps it
        }
        stagePlay(before, id, page, firstMount);
    }

    // programs that cannot do anything without the server (offline check on #794: they hung, showed
    // a raw "WebSocket connection not healthy" or a misleading error). Programs with something kept
    // on the device (Pictures' storage cards, Notes, Contacts ...) open as they are.
    const NEEDS_SERVER = new Set(['director', 'accounts', 'traffic', 'tasks', 'calendar', 'fileexplorer', 'inkball',
        'paypass-mobile', 'characters', 'expanders', 'atelier', 'spellbook', 'reference', 'xlink-mobile']);

    function serverDown() {
        const ws = window.wsClient;
        return !!(ws && typeof ws.isConnected === 'function' && !ws.isConnected());
    }

    async function openWhenServerBack(id, opts) {
        for (;;) {
            const v = await domainUnreachable();
            if (v === 'abort') return;
            if (!serverDown()) { open(id, opts); return; }
        }
    }

    function open(id, opts = {}) {
        if (!apps.has(id)) return;
        closeMenus(true);
        // a system program another program stands in for (Settings > System > Default Programs:
        // an Android program as Calendar, Melaton Media ...; #776); opts.builtIn opens our own
        const stand = replacements.get(id);
        if (stand && !opts.builtIn) {
            try { stand(); } catch (err) { console.warn('[wmShell] default program', id, err); }
            return;
        }
        // a program loaded on demand (#817): its script first, then this open again
        if (apps.get(id).lazyScript) { openLazy(id, opts); return; }
        // a program that is not a page of the shell (registerApp({ launch })): one of the phone's own
        // Android programs (wmAndroidApps.js). It starts, and the shell stays where it is.
        const starter = apps.get(id);
        if (typeof starter.launch === 'function') {
            try { starter.launch(); } catch (err) { console.warn('[wmShell] launch', id, err); }
            return;
        }
        // a program that works only with the server, opened while the phone has no connection to it
        // (the launcher started without the server, #794): WM's Domain Controller box instead of a
        // page that hangs or shows a raw socket error; Retry opens it once the server answers
        if (NEEDS_SERVER.has(id) && serverDown() && !opts.offlineOk) {
            void openWhenServerBack(id, opts);
            return;
        }
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
        return Math.max(0, stack.length - 1) + own + (openPopup ? 1 + sub : 0) + (viewerActive && !viewerClosing ? 1 : 0) + (taskSwitch.open ? 1 : 0);
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
            // a restart is on its way (restartClientNavigate): a history.go() now cancels its reload
            if (window.melatonRestarting) return;
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

    // ================================================================ task switcher (begin)
    //
    // Melaton's own add-on (Yozora #748, Yukimi): Windows Mobile 6.5 has no list of the running
    // programs on its Start screen, and phone makers put quick task switchers of their own on top.
    // Ours: tap-and-hold on the Start button (the hold timing and ring of dots of bindHoldRing; a
    // mouse press of the same length) brings a strip over the soft key bar with the running
    // programs, most recently used first, and the title bar's X at its right end as "close all".
    // No device has this layout, so every piece is one the version already has: the bar's own
    // look, 32-unit program icons with one label line, the list selection on the program on
    // screen, the corner button. What runs, its names and how a program ends are Task Manager's
    // (window.wmTaskManager.running / end: every program that was on screen and has not been ended;
    // the shell's own screens are not tasks). Close all asks as the device's End All Tasks does.
    // A tap switches, tap-and-hold on a program gives Task Manager's menu (Switch To, End Task).
    // It comes and goes in one paint; it is a layer (closeTopLayer, desiredDepth): back closes it.
    const taskSwitch = { el: null, open: false, mru: [], held: false, timer: null, asking: false };

    function taskSwitcherNote() {
        const id = root.dataset.wmApp;
        if (!id || SHELL_SCREENS.has(id)) return;
        const at = taskSwitch.mru.indexOf(id);
        if (at >= 0) taskSwitch.mru.splice(at, 1);
        taskSwitch.mru.unshift(id);
    }

    /** The running programs as Task Manager lists them, the most recently used first. */
    function taskSwitcherTasks() {
        let list = null;
        try { if (window.wmTaskManager) list = window.wmTaskManager.running(); } catch (_) { list = null; }
        if (!list) list = openedApps.filter((id) => apps.has(id)).map((id) => ({ id, title: apps.get(id).startLabel || apps.get(id).title }));
        const rank = (id) => { const i = taskSwitch.mru.indexOf(id); return i < 0 ? 1e6 : i; };
        return list.filter((t) => !SHELL_SCREENS.has(t.id))
            .map((t, i) => ({ id: t.id, title: t.title, icon: (apps.get(t.id) || {}).icon || 'app-programs', i }))
            .sort((a, b) => (rank(a.id) - rank(b.id)) || (a.i - b.i))
            .map((t) => ({ id: t.id, title: t.title, icon: t.icon }));
    }

    /** The hold on Start may bring the switcher: not under the lock screen, a message box or a wait. */
    function taskSwitcherCanOpen() {
        if (!shell || (root.dataset.wmBoot && root.dataset.wmBoot !== 'done') || root.dataset.wmTakeover || root.hasAttribute('data-wm-dialog')) return false;
        if (busyCount > 0 || switchCoverFor) return false;
        const box = shell.querySelector('.wm-msgbox-layer');
        if (box && !box.hidden) return false;
        try { if (window.wmLock && window.wmLock.isLocked) return false; } catch (_) { /* no lock screen */ }
        const start = shell.querySelector('.wm-start');
        return !!(start && !start.disabled && start.getClientRects().length);
    }

    /** bindHoldRing: where the ring of dots shows although the bar or the strip around has none. */
    function taskSwitcherHoldTarget(t) {
        if (t.closest('.wm-ts-item')) return true;
        return !!t.closest('.wm-start') && !taskSwitch.open && taskSwitcherCanOpen();
    }

    function taskSwitcherRender() {
        const el = taskSwitch.el;
        if (!el) return;
        const tasks = taskSwitcherTasks();
        const old = el.querySelector('.wm-ts-list');
        const x = old ? old.scrollLeft : 0;
        const focused = document.activeElement && el.contains(document.activeElement) ? document.activeElement.dataset.app : null;
        // the 32-unit art of a shell icon (its -lg pair), as the Programs grid shows it
        const large = (name) => (!String(name).startsWith('/') && HD_ART.has(`${name}-lg`) ? `${name}-lg` : name);
        el.innerHTML = `<div class="wm-ts-list" role="listbox" aria-label="Running programs">${tasks.map((t) => {
            const n = large(t.icon);
            return `<button type="button" class="wm-ts-item${t.id === current ? ' is-selected' : ''}" role="option" aria-selected="${t.id === current}" data-app="${escapeHtml(t.id)}"><span class="wm-ts-icon" style="--wm-icon-mask:url('${escapeHtml(art(n))}')">${imgTag(n)}</span><span class="wm-ts-label">${escapeHtml(t.title)}</span></button>`;
        }).join('')}</div><div class="wm-ts-side"><button type="button" class="wm-title-action wm-ts-all" data-kind="close" aria-label="End All Tasks"${tasks.length ? '' : ' disabled'}></button></div>`;
        const list = el.querySelector('.wm-ts-list');
        list.scrollLeft = x;
        if (focused) {
            const again = [...list.children].find((b) => b.dataset.app === focused) || list.firstElementChild || el.querySelector('.wm-ts-all');
            try { if (again) again.focus({ preventScroll: true }); } catch (_) { /* focus is a nicety */ }
        }
    }

    function openTaskSwitcher() {
        if (taskSwitch.open) return true;
        if (!taskSwitcherCanOpen()) return false;
        closeMenus(true);
        if (!taskSwitch.el) {
            const el = document.createElement('div');
            el.className = 'wm-taskstrip';
            el.hidden = true;
            el.setAttribute('role', 'dialog');
            el.setAttribute('aria-label', 'Running programs');
            // the ring of dots only on a program (taskSwitcherHoldTarget)
            el.setAttribute('data-wm-no-hold', '');
            shell.appendChild(el);
            taskSwitch.el = el;
            el.addEventListener('click', (e) => {
                if (!taskSwitch.open) return;
                e.stopPropagation();
                if (taskSwitch.held) { taskSwitch.held = false; return; }
                if (e.target.closest('.wm-ts-all')) { void taskSwitcherEndAll(); return; }
                const item = e.target.closest('.wm-ts-item');
                if (item) taskSwitcherChoose(item.dataset.app);
            });
            el.addEventListener('pointerdown', (e) => {
                const item = e.target.closest('.wm-ts-item');
                if (item) taskSwitcherMouseHold(e, (x, y) => taskSwitcherMenu(item.dataset.app, x, y));
            });
            el.addEventListener('contextmenu', (e) => {
                e.preventDefault();
                const item = e.target.closest('.wm-ts-item');
                if (!item || !taskSwitch.open) return;
                taskSwitch.held = !e.isTrusted;
                taskSwitcherMenu(item.dataset.app, e.clientX, e.clientY);
            });
            // a wheel moves the strip sideways
            el.addEventListener('wheel', (e) => {
                const list = el.querySelector('.wm-ts-list');
                if (!list || list.scrollWidth <= list.clientWidth) return;
                e.preventDefault();
                list.scrollLeft += (Math.abs(e.deltaX) > Math.abs(e.deltaY) ? e.deltaX : e.deltaY) * (e.deltaMode === 1 ? 16 : 1);
            }, { passive: false });
        }
        taskSwitch.open = true;
        taskSwitcherRender();
        taskSwitch.el.hidden = false;
        const first = taskSwitch.el.querySelector('.wm-ts-item.is-selected, .wm-ts-item');
        if (first) {
            try { first.focus({ preventScroll: true }); } catch (_) { /* focus is a nicety */ }
            if (first.scrollIntoView) first.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }
        syncHistory();
        return true;
    }

    function closeTaskSwitcher(silent) {
        if (!taskSwitch.open) return false;
        taskSwitch.open = false;
        clearTimeout(taskSwitch.timer);
        taskSwitch.el.hidden = true;
        taskSwitch.el.innerHTML = '';
        if (!silent) syncHistory();
        return true;
    }

    function taskSwitcherChoose(id) {
        closeTaskSwitcher(true);
        if (id && id !== current && apps.has(id)) open(id, { fromStart: true });
        else syncHistory();
    }

    function taskSwitcherMenu(id, x, y) {
        if (!taskSwitch.open || !id) return;
        window.wmShell.menuAt(x, y, [
            { label: 'Switch To', action: () => taskSwitcherChoose(id) },
            { label: 'End Task', action: () => { void taskSwitcherEnd([id]); } }
        ]);
    }

    /** End programs Task Manager's way (its end(): a hosted program closes its windows itself). */
    async function taskSwitcherEnd(ids) {
        const tm = window.wmTaskManager;
        await busy(() => {
            ids.forEach((id) => {
                try { if (tm && typeof tm.end === 'function') tm.end(id); else endApp(id); } catch (err) { console.warn('[wmShell] end task', id, err); }
            });
        }, { paint: true });
        if (taskSwitch.open) taskSwitcherRender();
        // hosted windows close on their own timers: list again once they had the chance
        setTimeout(() => { if (taskSwitch.open) taskSwitcherRender(); }, 1100);
    }

    /**
     * Close all: every running program ends, and the phone is back on Today / the home screen.
     * It asks first, in the words of the device's Task Manager for Menu > End All Tasks (6.1
     * emulator: "Confirm End", the warning sign, Yes as the default button, No); No leaves the
     * strip as it was.
     */
    async function taskSwitcherEndAll() {
        if (taskSwitch.asking) return;
        let ids = taskSwitcherTasks().map((t) => t.id);
        if (!ids.length) return;
        taskSwitch.asking = true;
        let yes = false;
        try {
            yes = await messageBox({ title: 'Confirm End', text: 'Do you really want to end all running applications?', icon: 'warning', buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false }], cancelValue: false });
        } finally { taskSwitch.asking = false; }
        if (!yes) return;
        ids = taskSwitcherTasks().map((t) => t.id);
        closeTaskSwitcher(true);
        await taskSwitcherEnd(ids);
        open('today');
    }

    /** A mouse button held as long as the pen's hold (the ring of dots is the pen's and finger's). */
    function taskSwitcherMouseHold(e, fn) {
        if (e.pointerType !== 'mouse' || e.button !== 0) return;
        clearTimeout(taskSwitch.timer);
        const { clientX: x, clientY: y, pointerId: id } = e;
        const stop = () => {
            clearTimeout(taskSwitch.timer);
            document.removeEventListener('pointermove', move, true);
            document.removeEventListener('pointerup', stop, true);
            document.removeEventListener('pointercancel', stop, true);
        };
        const move = (m) => { if (m.pointerId === id && (Math.abs(m.clientX - x) > HOLD_SLOP || Math.abs(m.clientY - y) > HOLD_SLOP)) stop(); };
        document.addEventListener('pointermove', move, true);
        document.addEventListener('pointerup', stop, true);
        document.addEventListener('pointercancel', stop, true);
        taskSwitch.timer = setTimeout(() => { stop(); taskSwitch.held = true; fn(x, y); }, HOLD_FIRST_MS + 8 * HOLD_STEP_MS + HOLD_MENU_MS);
    }

    /** The Start button's click: true = it was the lift after a hold, or it closed the switcher. */
    function taskSwitcherStartClick() {
        if (taskSwitch.held) { taskSwitch.held = false; return true; }
        return closeTaskSwitcher();
    }

    function bindTaskSwitcher() {
        const start = shell.querySelector('.wm-start');
        taskSwitcherNote();
        try { new MutationObserver(taskSwitcherNote).observe(root, { attributes: true, attributeFilter: ['data-wm-app'] }); } catch (_) { /* Task Manager's order then */ }
        // a new press: the last hold is over
        document.addEventListener('pointerdown', () => { taskSwitch.held = false; }, true);
        // the click a mouse button brings when it is let go after a hold: taken before anything
        // closes on it (the menu that came up under the pointer, the strip)
        window.addEventListener('click', (e) => {
            if (!taskSwitch.held) return;
            taskSwitch.held = false;
            e.preventDefault();
            e.stopImmediatePropagation();
        }, true);
        start.addEventListener('pointerdown', (e) => {
            if (taskSwitch.open || !taskSwitcherCanOpen()) return;
            taskSwitcherMouseHold(e, () => { if (!openTaskSwitcher()) taskSwitch.held = false; });
        });
        // the pen's and the finger's hold: bindHoldRing asks for the menu when the ring is whole
        start.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (e.isTrusted) return;
            if (!taskSwitch.open && openTaskSwitcher()) taskSwitch.held = true;
        });
        // the arrow keys walk the strip while it is up, wherever the focus was left (the lift
        // after the hold gives it to the Start button); Enter is the focused program's own click
        window.addEventListener('keydown', (e) => {
            if (!taskSwitch.open || openPopup || e.altKey || e.ctrlKey || e.metaKey) return;
            const keys = { ArrowLeft: -1, ArrowUp: -1, ArrowRight: 1, ArrowDown: 1, Home: -1e6, End: 1e6 };
            if (!(e.key in keys)) return;
            const el = taskSwitch.el;
            const stops = [...el.querySelectorAll('.wm-ts-item, .wm-ts-all:not(:disabled)')];
            if (!stops.length) return;
            e.preventDefault();
            e.stopImmediatePropagation();
            const at = stops.indexOf(document.activeElement);
            // the first arrow lands on the selected program
            const from = at >= 0 || Math.abs(keys[e.key]) > 1 ? Math.max(0, at) + keys[e.key] : Math.max(0, stops.findIndex((b) => b.classList.contains('is-selected')));
            const to = stops[Math.max(0, Math.min(stops.length - 1, from))];
            // the selection goes with the keys, as in a list view
            if (to.classList.contains('wm-ts-item')) stops.forEach((b) => { if (b.classList.contains('wm-ts-item')) { b.classList.toggle('is-selected', b === to); b.setAttribute('aria-selected', String(b === to)); } });
            to.focus({ preventScroll: true });
            if (to.scrollIntoView) to.scrollIntoView({ block: 'nearest', inline: 'nearest' });
        }, true);
        // a tap elsewhere puts the strip away (Start closes it itself; its menu stays with it)
        document.addEventListener('click', (e) => {
            if (!taskSwitch.open) return;
            const t = e.target;
            if (t && t.closest && t.closest('.wm-taskstrip, #wmShell .wm-popup, #wmShell .wm-msgbox-layer, #wmShell .wm-start, #wmShell .wm-title')) return;
            closeTaskSwitcher();
        }, true);
        // the lock screen, a message box or another program coming up on its own: the strip goes
        try {
            const box = shell.querySelector('.wm-msgbox-layer');
            const mo = new MutationObserver(() => {
                if (!taskSwitch.open) return;
                let locked = false;
                try { locked = !!(window.wmLock && window.wmLock.isLocked); } catch (_) { locked = false; }
                // (its own question stands over it)
                if (locked || root.dataset.wmTakeover || root.hasAttribute('data-wm-dialog') || (box && !box.hidden && !taskSwitch.asking)) closeTaskSwitcher();
                else taskSwitcherRender();
            });
            mo.observe(root, { attributes: true, attributeFilter: ['data-wm-app', 'data-wm-dialog', 'data-wm-takeover'] });
            mo.observe(shell, { attributes: true, attributeFilter: ['class'] });
            if (box) mo.observe(box, { attributes: true, attributeFilter: ['hidden'] });
        } catch (_) { /* it stays until a tap */ }
    }
    // ================================================================ task switcher (end)

    // ---------------------------------------------------------------- status icons

    /** A '1' / '0' setting in localStorage (Settings > Screen > Status Icons); fallback when unset. */
    function lsFlag(key, fallback) {
        let v = null;
        try { v = localStorage.getItem(key); } catch (_) { v = null; }
        return v === '1' ? true : v === '0' ? false : fallback;
    }

    /**
     * The low battery warning. Its level is the user's (Settings > System > Power > Battery,
     * localStorage wmBatteryLow, percent; 25 as shipped). On battery at or under it the device's
     * notification comes up once: "Main Battery Low" (the icon keeps its own stages). It is
     * armed again by the charger or by the level rising over it.
     */
    const BATTERY_LOW_KEY = 'wmBatteryLow';
    const BATTERY_LOW_DEFAULT = 25;
    let batteryWarned = false;

    function batteryLowLevel() {
        let n = NaN;
        try { n = parseInt(localStorage.getItem(BATTERY_LOW_KEY), 10); } catch (_) { n = NaN; }
        return Number.isFinite(n) ? Math.max(5, Math.min(50, n)) : BATTERY_LOW_DEFAULT;
    }

    function batteryLowCheck(b) {
        if (!b || !b.low) { if (!b || b.charging || b.level > batteryLowLevel()) batteryWarned = false; return; }
        if (batteryWarned) return;
        // not over the boot: the warning waits for Today
        if (root.dataset.wmBoot && root.dataset.wmBoot !== 'done') return;
        batteryWarned = true;
        notify({
            title: 'Main Battery Low',
            text: 'To prevent possible data loss, replace or recharge your batteries according to the owner\'s manual.',
            icon: 'warning', asNote: true
        });
    }

    /**
     * The title bar's unread mail icon. As shipped it stands for NEW mail only: mail received since
     * this client started that is still unread. The newest inbox message at start-up is the mark
     * (its time); the icon goes once nothing unread is newer than it (read or deleted). With
     * "show for any unread message" (Messaging > Tools > Options, localStorage wmMailIconAll) it
     * shows while the inbox has unread mail at all, as before.
     */
    const MAIL_ICON_ALL_KEY = 'wmMailIconAll';

    /**
     * The title bar's text message icon, the same way (Yukimi, Nov 13): as shipped it stands for text
     * messages received since this client started that are still unread (a conversation that got an
     * incoming text goes on the list and comes off when it is read); with "show for any unread text
     * message" (Messaging > Tools > Options, localStorage wmSmsIconAll) it shows while any is unread.
     */
    const SMS_ICON_ALL_KEY = 'wmSmsIconAll';
    const smsNewChats = new Set();
    let smsNewWired = false;
    function smsNewWire() {
        if (smsNewWired) return;
        const tm = window.textMessaging;
        if (!tm || typeof tm.on !== 'function') return;
        smsNewWired = true;
        const key = (d) => `${d.accountId}\u0001${d.chatGuid}`;
        tm.on('message', (d) => {
            const m = d && d.message;
            if (!m || m.fromMe || m.groupEvent || !d.chatGuid) return;
            smsNewChats.add(key(d));
            refreshStatus();
        });
        tm.on('read', (d) => {
            if (!d || d.read === false || !d.chatGuid) return;
            if (smsNewChats.delete(key(d))) refreshStatus();
        });
        tm.on('unread', (u) => {
            if (!(u && Number(u.total) > 0) && smsNewChats.size) { smsNewChats.clear(); refreshStatus(); }
        });
        // Google signed the RCS pairing out (or it ended): a note that stays, once per account a session
        const lostTold = new Set();
        tm.on('signin_lost', (d) => {
            if (!d || !d.accountId || lostTold.has(d.accountId) || typeof window.wmShell?.notify !== 'function') return;
            lostTold.add(d.accountId);
            window.wmShell.notify({
                title: 'Text messages stopped',
                text: d.text || 'Text messages are not arriving. Pair again in Dreamscape CardSpace on the computer.',
                icon: 'warning',
                asNote: true,
                timeout: false
            });
        });
    }
    let shellMailNew = false;
    let mailMark = null;      // ms of the newest inbox message when the client started
    let mailNewBusy = false;
    let mailNewAgain = false;
    const mailTime = (m) => { const t = typeof m.createdAt === 'number' ? m.createdAt : Date.parse(m.createdAt); return Number.isFinite(t) ? t : 0; };

    async function mailNewCheck() {
        if (lsFlag(MAIL_ICON_ALL_KEY, false) && mailMark != null) return;
        // nothing unread: nothing new unread either (the mark is still taken once)
        if (!(shellMailUnread > 0) && mailMark != null) { if (shellMailNew) { shellMailNew = false; refreshStatus(); } return; }
        if (mailNewBusy) { mailNewAgain = true; return; }
        const ws = window.wsClient;
        if (!ws || typeof ws.isConnected !== 'function' || !ws.isConnected()) return;
        mailNewBusy = true;
        try {
            const r = await ws.sendMessage('dovecote_list_mail', { folder: 'inbox', limit: mailMark == null ? 1 : 30 }, false);
            const list = (r && (r.mail || (r.data && r.data.mail))) || [];
            if (mailMark == null) {
                // an empty inbox: everything that comes is new
                mailMark = list.reduce((max, m) => Math.max(max, mailTime(m)), 0);
            } else {
                const now = list.some((m) => !m.read && mailTime(m) > mailMark);
                if (now !== shellMailNew) { shellMailNew = now; refreshStatus(); }
            }
        } catch (_) { /* mail unavailable: the icon keeps its state */ }
        mailNewBusy = false;
        if (mailNewAgain) { mailNewAgain = false; mailNewCheck(); }
    }

    /**
     * The connectivity icon's two animations, as 6.1 / 6.5 shell32 draws them (#771, read from its
     * table and code; scripts/build-wm-sprite-strips.sh builds them in the shell's frame order):
     *   A: connected, the arrows run out, the bare badge, the arrows run back in, connected held;
     *      200 ms a frame. The shell plays it while a call is dialled over a data link; Melaton plays
     *      it while connecting to Dreamscape, reconnecting or installing (Yukimi, Nov 12 2026).
     *   B: the turning arrows, the bare badge, the rest of the turn, its first frame held; 150 ms a
     *      frame. The shell plays it while ActiveSync synchronizes over the link; so does Melaton,
     *      while ActiveSync moves data (activeSync.transferring(): files, storage, session, sync).
     * For the link in use: the plain data arrows, Wi-Fi, or the mobile network type's badge. With no
     * network at all there is nothing to show it on: the plain icon stays.
     */
    const SEQ = {
        conn: { ms: 200, data: 24, wifi: 16, type: 16 },
        xfer: { ms: 150, data: 26, wifi: 18, type: 18 }
    };
    let syncNow = null;
    let transferWired = false;

    function syncKind(dev) {
        const ws = window.wsClient;
        const up = !!(ws && typeof ws.isConnected === 'function' && ws.isConnected() && ws.initializationCompleted);
        const installing = swDownloading() != null;
        const as = window.activeSync;
        if (!transferWired && as && typeof as.on === 'function') { transferWired = true; as.on('transfer', () => refreshStatus()); }
        const mode = !up || installing ? 'conn' : as && typeof as.transferring === 'function' && as.transferring() ? 'xfer' : null;
        if (!mode) return null;
        if (dev.airplane || (dev.link && /-off$/.test(dev.link.icon)) || (typeof navigator !== 'undefined' && navigator.onLine === false)) return null;
        if (dev.active === 'wifi' || (dev.link && dev.link.icon.startsWith('wifi'))) return `wifi-${mode}`;
        const t = dev.type && typeIcon(dev.type);
        return t ? `data-${t}-${mode}` : `data-${mode}`;
    }

    function paintSync(el, kind) {
        if (kind === syncNow) return;
        syncNow = kind;
        if (!kind) { el.classList.remove('wm-strip'); el.style.removeProperty('--strip'); return; }
        const mode = kind.endsWith('-xfer') ? 'xfer' : 'conn';
        const seq = SEQ[mode];
        const n = kind.startsWith('wifi-') ? seq.wifi : kind === `data-${mode}` ? seq.data : seq.type;
        // one strip per sequence; 6.5's own frames (its shellres.192; @2x / @4x only, as its other status art)
        const name = `status-${kind}-strip`;
        el.style.setProperty('--strip', WM65
            ? `image-set(url("/static_images/wm65/${name}@2x.png") 2x, url("/static_images/wm65/${name}@4x.png") 4x)`
            : `image-set(url("${art(name)}") 1x, url("${art2x(name)}") 2x, url("${ART}${name}@4x.png") 4x)`);
        el.style.setProperty('--n', String(n));
        el.style.setProperty('--ms', String(seq.ms));
        el.classList.add('wm-strip');
    }

    /**
     * The data call (Yukimi, Nov 12 2026, #771): on a real device the type badge with the arrows
     * shows while a data call is up, and Connection Manager drops the call once nothing uses it, so
     * most of the time the large badge shows (the shell's "available" icon). Melaton: data moving
     * (websocket messages other than pings and quiet polls, network fetches) holds the call up for
     * DATA_RELEASE_MS after the last of it (the device's CacheTime is 600 s; Yukimi chose 15 s).
     */
    const DATA_RELEASE_MS = 15000;
    let dataUsedAt = 0;
    let dataReleaseTimer = null;
    const QUIET_WS = new Set(['sidebar_live']);
    function dataUsed() {
        const was = Date.now() - dataUsedAt < DATA_RELEASE_MS;
        dataUsedAt = Date.now();
        clearTimeout(dataReleaseTimer);
        dataReleaseTimer = setTimeout(() => refreshStatus(), DATA_RELEASE_MS + 50);
        if (!was && shell) refreshStatus();
    }
    let dataWatchWs = null;
    let dataWatchFetch = false;
    function watchDataUse() {
        const ws = window.wsClient;
        if (ws && ws !== dataWatchWs && typeof ws._recordWsMessage === 'function') {
            dataWatchWs = ws;
            const record = ws._recordWsMessage.bind(ws);
            // websocket.js already leaves pings, pongs and the silent ticker polls out of its counts
            ws._recordWsMessage = (direction, message) => {
                const before = ws.connectionStats ? ws.connectionStats.messagesIn + ws.connectionStats.messagesOut : 0;
                record(direction, message);
                // a server message (or a request going out: prints in progress) may change an icon
                statusDirty();
                const after = ws.connectionStats ? ws.connectionStats.messagesIn + ws.connectionStats.messagesOut : before + 1;
                // CafeReady (the Miniport's cache, #815) answers a flagged request on the phone: neither the
                // request nor its cached reply reaches the server (Yukimi, Nov 14: the arrows only for that)
                const cafe = message && ((direction === 'out' && message._mpCache) || (direction === 'in' && message._mpCached));
                if (after !== before && !cafe && !(message && QUIET_WS.has(message.type))) dataUsed();
            };
        }
        // requests count by the bytes that came over the network (resource timing): a service worker,
        // HTTP cache or CafeReady answer has none, so it no longer raises the call (Yukimi, Nov 14)
        if (!dataWatchFetch) dataWatchFetch = true;
        if (dataWatchFetch === true && typeof PerformanceObserver === 'function') {
            dataWatchFetch = 'observed';
            try {
                // bytes that came over the network (a service worker or HTTP cache answer has none)
                new PerformanceObserver((list) => { if (list.getEntries().some((e) => e.transferSize > 0)) dataUsed(); })
                    .observe({ type: 'resource', buffered: false });
            } catch (_) { /* no resource timing */ }
        }
    }
    const dataCallUp = () => Date.now() - dataUsedAt < DATA_RELEASE_MS;

    const put = (el, key, v) => { if (el.dataset[key] !== v) el.dataset[key] = v; };
    const tip = (el, v) => { if (el.title !== v) el.title = v; };
    const hide = (el, h) => { h = !!h; if (el.hidden !== h) el.hidden = h; };

    /*
     * "Domain Controller is not ready" (Yukimi, Nov 13): only when it matters, never on a plain
     * disconnect (the connectivity icon shows that): at start-up, when the phone comes up without
     * reaching the server (DC_NOTICE_MS after Today; a normal boot connects well before), and when something is asked of the server
     * while it is out of reach (dcNotice(), from websocket.js _mobileDomainUnreachable). It goes by
     * itself when the connection is back.
     */
    const DC_NOTICE_MS = 10000;
    const DC_NOTICE_TEXT = 'Domain Controller is not ready, any remote data that has not been synced to this mobile device will not be available until the connection resumes.';
    let dcWasUp = false;
    let dcDownSince = 0;
    let dcNote = null;
    function dcNotice() {
        if (dcNote || !shell) return;
        const ws = window.wsClient;
        if (ws && typeof ws.isConnected === 'function' && ws.isConnected()) return;
        dcNote = appNote({ title: 'Domain Controller', html: escapeHtml(DC_NOTICE_TEXT), event: 'disconnect', icon: 'status-data-off' });
    }

    function dcNoticeCheck(ws, connected) {
        if (connected) {
            dcWasUp = true;
            dcDownSince = 0;
            if (dcNote) { dcNote.close(); dcNote = null; }
            return;
        }
        // start-up only: Today is up and this load never reached the server
        if (dcWasUp || !bootDoneAt || !ws) return;
        if (!dcDownSince) dcDownSince = Date.now();
        if (Date.now() - dcDownSince >= DC_NOTICE_MS) dcNotice();
    }

    /**
     * The title bar repaints when something it shows may have changed, not on a 2 s poll (#798: on a
     * hybrid phone every tick shared the renderer with the DeX window). What changes it comes in as a
     * server message (mail, texts, Messenger, IMAP, weather, traffic, the Director, prints, updates),
     * an Android event (androiddevicestatus, radios), a notification or toast, or a tap; each marks it
     * dirty and one repaint follows (statusDirty, 250 ms). A slow pass (STATUS_SAFETY_MS) catches
     * anything that changed without a signal.
     */
    const STATUS_SAFETY_MS = 120000;
    let statusTimer = null;
    function statusDirty() {
        if (statusTimer || !shell) return;
        // screen off or page hidden: nothing paints; screen on and visibilitychange repaint at once
        statusTimer = setTimeout(() => { statusTimer = null; if (onScreen()) refreshStatus(); }, 250);
    }
    function watchStatusSignals() {
        const ws = window.wsClient;
        if (ws && typeof ws.on === 'function') { ws.on('connected', statusDirty); ws.on('disconnected', statusDirty); }
        // a setting, a sound mode, an app opened: taps and keys (volume keys reach the page as keys)
        document.addEventListener('click', statusDirty, { capture: true, passive: true });
        document.addEventListener('keyup', statusDirty, { capture: true, passive: true });
        document.addEventListener('wmSettingsChange', statusDirty);
        document.addEventListener('wmWeatherChange', statusDirty);
        document.addEventListener('wmTrafficChange', statusDirty);
        // the other window of the app (DeX) changed a shared setting
        window.addEventListener('storage', statusDirty);
        // back on screen: paint now
        window.addEventListener('melatonscreen', (e) => { if (e.detail && e.detail.on) refreshStatus(); });
        document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') refreshStatus(); });
        setInterval(() => { if (onScreen()) refreshStatus(); }, STATUS_SAFETY_MS);
        // Today's clock: on the minute, while Today is up and the screen is on
        const minute = () => {
            setTimeout(() => {
                const today = apps.get('today');
                if (current === 'today' && document.documentElement.dataset.screenOff === undefined && today && today.page) today.refresh();
                minute();
            }, 60000 - (Date.now() % 60000) + 50);
        };
        minute();
    }

    function refreshStatus() {
        if (!shell) return;
        applyStartButton();
        // on every change (statusDirty): write only what changed (an attribute write, even of the same value,
        // invalidates the [data-icon] rules and lays the title bar out again)
        const ws = window.wsClient;
        const connected = !!(ws && typeof ws.isConnected === 'function' && ws.isConnected());
        dcNoticeCheck(ws, connected);
        const data = shell.querySelector('[data-role="data"]');
        const dev = deviceView();
        watchDataUse();
        // the phone's own link when the Android app or the browser says what it is; else Dreamscape's.
        // On the mobile network with no data moving lately the call is down: the large badge.
        const idleCell = dev.active === 'cellular' && dev.type && typeIcon(dev.type) && !dataCallUp();
        put(data, 'icon', idleCell ? `data-${typeIcon(dev.type)}-avail` : dev.link ? dev.link.icon : connected ? 'data-on' : 'data-off');
        tip(data, idleCell ? `${typeName(dev.type)} available` : dev.link ? dev.link.text : connected ? 'Connected' : 'Not connected');
        paintSync(data, syncKind(dev));
        // Settings > Screen > Status Icons > Always show the mobile network icon: on Wi-Fi the
        // connectivity icon is Wi-Fi's, so the mobile network's type (available) shows beside it
        const cellEl = shell.querySelector('[data-role="cell"]');
        let cellIcon = null;
        if (lsFlag('wmShowCellIcon', false) && dev.active === 'wifi' && dev.type && typeIcon(dev.type) && !dev.airplane
            && dev.cell && dev.cell.dataEnabled !== false && dev.cell.radioOn !== false) cellIcon = `data-${typeIcon(dev.type)}-avail`;
        hide(cellEl, !cellIcon);
        if (cellIcon) { put(cellEl, 'icon', cellIcon); tip(cellEl, `${typeName(dev.type)} available`); }
        const sig = shell.querySelector('[data-role="signal"]');
        hide(sig, !dev.signal);
        if (dev.signal) { put(sig, 'icon', dev.signal.icon); tip(sig, dev.signal.text); }
        hide(shell.querySelector('[data-role="roaming"]'), !(dev.cell && dev.cell.roaming === true && dev.signal && dev.signal.icon !== 'signal-off'));
        const bat = shell.querySelector('[data-role="battery"]');
        hide(bat, !dev.battery);
        if (dev.battery) { put(bat, 'icon', dev.battery.icon); tip(bat, dev.battery.text); }
        batteryLowCheck(dev.battery);
        const vol = shell.querySelector('[data-role="volume"]');
        const mode = soundMode();
        put(vol, 'icon', mode === 'off' ? 'volume-off' : mode === 'vibrate' ? 'vibrate' : 'volume');
        // pending things, as WM shows a notification glyph: the Director (an open clapper that claps
        // while a turn runs; closed while it is idle and its app is open), prints in progress,
        // unread mail, an update downloaded and ready to install
        const dir = directorState();
        directorTurnWatch(dir);
        const dirOpen = stack.includes('director') || openedApps.includes('director');
        hide(shell.querySelector('[data-role="director"]'), !((dir && dir.running) || dirOpen));
        paintDirectorClap(!!(dir && dir.running));
        let updateReady = false;
        try { updateReady = !!(window.serviceWorkerManager && window.serviceWorkerManager.hasPendingUpdates()); } catch (_) { updateReady = false; }
        // the update icon also stands for a waiting update notice (stalled, applied ...) and, animated,
        // for updates downloading (its popup shows the progress)
        const updDl = updateProgressToast();
        if (updDl && updDl.pct >= 100) void healFinishedUpdateNotice().then((changed) => { if (changed) statusDirty(); });
        const updEl = shell.querySelector('[data-role="update"]');
        hide(updEl, !(updateReady || updDl || notes.some(isUpdateNote)));
        paintUpdateIcon(updEl, !!updDl);
        const openBub = shell.querySelector('.wm-bubble');
        if (updDl && openBub && !openBub.hidden && openBub.dataset.role === 'update') statusBubble('update', updEl, true);
        hide(shell.querySelector('[data-role="prints"]'), !printsInProgress());
        const mailEl = shell.querySelector('[data-role="mail"]');
        // any unread mail, if the user asked for that (Messaging > Tools > Options); else only mail
        // that came in since this client started and is still unread (mailNewCheck)
        // IMAP accounts (#789) count the same way; while their New E-mail notification waits it stands for them
        const noteWaits = (ev) => notes.some((n) => { const o = appNotes.get(n.id); return !!(o && o.event === ev); });
        const mailAll = lsFlag(MAIL_ICON_ALL_KEY, false);
        // the class's notifications stand on its icon too (messageNotes): one glyph per class
        hide(mailEl, !(messageNotes('mail').length || (mailAll ? shellMailUnread > 0 || imapUnread() > 0 : shellMailNew || imapNew() > 0)));
        // unread text messages (Text Messaging, #779): the phone-and-envelope glyph until they are read;
        // unread Dreamscape Messenger lines: the Messenger buddy (while a class's notification waits,
        // its own glyph stands for them: one, not two)
        smsNewWire();
        const smsAll = lsFlag(SMS_ICON_ALL_KEY, false);
        hide(shell.querySelector('[data-role="sms"]'), !(messageNotes('sms').length || (smsUnread() > 0 && (smsAll || smsNewChats.size > 0))));
        hide(shell.querySelector('[data-role="chat"]'), !(messageNotes('chat').length || chatUnread() > 0));
        // Weather (#792): while Home or Work has an alert, and while rain is due or falling there
        // with the rain alarm on (wmWeather.statusState); a waiting notification of its class stands in
        const wx = window.wmWeather && typeof window.wmWeather.statusState === 'function' ? window.wmWeather.statusState() : null;
        hide(shell.querySelector('[data-role="wxalert"]'), !(wx && wx.alerts.length) || noteWaits('weather-alert') || noteWaits('weather-severe'));
        hide(shell.querySelector('[data-role="rain"]'), !(wx && wx.rain) || noteWaits('rain-alarm'));
        // Traffic (#795): the commute that matters now (by where the phone is) is more than 15 min late
        const tr = window.wmTraffic && typeof window.wmTraffic.statusState === 'function' ? window.wmTraffic.statusState() : null;
        hide(shell.querySelector('[data-role="traffic"]'), !(tr && tr.delayed));
        // Continuity (#798): while this phone carries its DeX window
        const mc = window.melatonContinuity;
        // the Continuity PC (#798): from the moment its window opens, half opacity until its desktop is up
        // (and again once its display is unplugged while it still runs), solid while it runs
        const ctyIcon = mc && typeof mc.continuityIcon === 'function' ? mc.continuityIcon() : (mc && typeof mc.active === 'function' && mc.active() ? 'solid' : null);
        const ctyEl = shell.querySelector('[data-role="continuity"]');
        hide(ctyEl, !ctyIcon);
        if (ctyEl) ctyEl.classList.toggle('is-presence', ctyIcon === 'dim');
        // ActiveSync Received Items (#803): unseen things that arrived while the phone was locked or away
        const asx = window.activeSync;
        hide(shell.querySelector('[data-role="received"]'), !(asx && typeof asx.receivedUnseen === 'function' && asx.receivedUnseen() > 0));
        paintBezelLed();
        if (noteTrayOpen) renderNotes(); else fitStatus();
        const bubble = shell.querySelector('.wm-bubble');
        // Traffic's bubble goes with its car: the delay is over, so is what the bubble says
        if (!bubble.hidden && bubble.dataset.role === 'traffic' && shell.querySelector('[data-role="traffic"]').hidden) closeBubble();
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
    /**
     * Director: Turn finished (a phone sound event): running -> idle plays its sound and, with
     * Display message on screen, posts a notification (off by default: the clapper already stops).
     */
    let dirWasRunning = null;
    function directorTurnWatch(dir) {
        const running = !!(dir && dir.running);
        const was = dirWasRunning;
        dirWasRunning = dir ? running : was;
        if (!dir || was !== true || running) return;
        playSystemSound('director');
        const p = eventPrefs('director');
        if (p && p.display) {
            const who = dir.name ? `"${dir.name}"` : 'The session';
            notify({ title: 'Director', text: `${who}: the turn is finished.`, asNote: true, timeout: 10000 });
        }
    }

    /** The Director icon: the clapper claps while a turn runs, closed otherwise (timers: no rAF in background tabs). */
    /** The update icon: the download glyph, its arrow dropping into the tray while updates download. */
    function paintUpdateIcon(el, downloading) {
        if (!el) return;
        if (!downloading || el.hidden) {
            if (el.dataset.dl === '1') {
                el.dataset.dl = '0';
                el.classList.remove('wm-strip');
                el.style.removeProperty('--strip');
            }
            return;
        }
        if (el.dataset.dl === '1') return;
        el.dataset.dl = '1';
        el.style.setProperty('--strip', artImageSet('status-update-dl-strip'));
        el.style.setProperty('--n', '4');
        el.style.setProperty('--ms', '220');
        el.classList.add('wm-strip');
    }

    function paintDirectorClap(working) {
        const el = shell && shell.querySelector('[data-role="director"]');
        if (!el) return;
        if (!working || el.hidden) {
            if (el.dataset.clap !== 'closed') {
                el.dataset.clap = 'closed';
                el.classList.remove('wm-strip');
                el.style.backgroundImage = artImageSet('status-director');
            }
            return;
        }
        if (el.dataset.clap === 'working') return;
        el.dataset.clap = 'working';
        el.style.setProperty('--strip', artImageSet('status-director-clap-strip'));
        el.style.setProperty('--n', String(DIRECTOR_CLAP_FRAMES));
        el.style.setProperty('--ms', '140');
        el.classList.add('wm-strip');
    }

    /*
     * Tray icons pixel for pixel (#735): 16 x --wm-px at a 2.25 density is 54 device px, a 1.69x
     * stretch of the 32 px art that made some art pixels 2 device px and others 1 (uneven strokes),
     * at fractional device positions. --wm-icon-unit is a whole multiple of the 2x art (Fold7: 2x,
     * 64 device px) and snapStatusIcons nudges each icon onto the device pixel grid.
     */
    function syncIconUnit() {
        const dpr = window.devicePixelRatio || 1;
        const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        const want = 16 * px * dpr; // the icon's size in device px
        // under 24 device px a whole 2x icon (32 px) would be up to twice its slot (a mouse-driven
        // window at one device px a unit: 16 px wanted, 32 drawn, the icons overflowing the bar):
        // the 1x art's own size where that is within a sixth, else the plain unit
        let unit = `${(2 * Math.max(1, Math.round(want / 32))) / dpr}px`;
        if (want < 24) unit = Math.abs(want - 16) / want < 1 / 6 ? `${1 / dpr}px` : '';
        if (root.style.getPropertyValue('--wm-icon-unit') !== unit) {
            if (unit) root.style.setProperty('--wm-icon-unit', unit); else root.style.removeProperty('--wm-icon-unit');
        }
    }

    function snapStatusIcons() {
        if (!shell) return;
        const dpr = window.devicePixelRatio || 1;
        const icons = shell.querySelectorAll('.wm-titlebar .wm-status-icon');
        icons.forEach((i) => { i.style.translate = ''; });
        icons.forEach((i) => {
            if (i.hidden || !i.offsetWidth) return;
            const r = i.getBoundingClientRect();
            const dx = Math.round(r.left * dpr) / dpr - r.left;
            const dy = Math.round(r.top * dpr) / dpr - r.top;
            if (Math.abs(dx) > 0.001 || Math.abs(dy) > 0.001) i.style.translate = `${dx}px ${dy}px`;
        });
    }

    function fitStatus() {
        if (!shell || fitQueued) return;
        fitQueued = true;
        afterPaint().then(() => { fitQueued = false; syncIconUnit(); fitStatusNow(); snapStatusIcons(); });
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
        // Settings > Screen > Bezel: the camera is handled only while the app hides the status bar
        // (with the bar showing, the camera sits under it anyway)
        const dv = window.AndroidDisplay;
        if (dv && typeof dv.getSystemBars === 'function') {
            try { if (JSON.parse(dv.getSystemBars()).hideStatus === false) return true; } catch (_) { /* older app */ }
        }
        let only = false;
        try { only = localStorage.getItem('wmCameraPortraitOnly') === '1'; } catch (_) { /* storage off */ }
        return only && window.innerWidth > window.innerHeight;
    }

    // Top edge of the wordmark's ink in its right 30 % (fraction of its height) per column fraction:
    // the right end is "an" at x-height, so it can sit closer into a rounded corner than its box.
    const BEZEL_LOGO_INK = [[0.7, 0.26], [0.797, 0.2645], [0.8065, 0.2769], [0.8161, 0.3058], [0.8258, 0.3512], [0.8452, 0.3388], [0.8548, 0.2893], [0.8645, 0.2686], [0.8742, 0.26], [0.9516, 0.26], [0.9613, 0.2645], [0.971, 0.2769], [0.9806, 0.3017], [0.9903, 0.3471], [1, 0.36]];

    // ... and in its left 30 % (from the left edge): "xy" also starts at x-height
    const BEZEL_LOGO_INK_LEFT = [[0, 0.78], [0.02, 0.26], [0.06, 0.277], [0.08, 0.364], [0.1, 0.384], [0.12, 0.31], [0.14, 0.26], [0.2, 0.26], [0.22, 0.36], [0.24, 0.537], [0.26, 0.405], [0.28, 0.26], [0.3, 0.26]];

    /** The smallest left margin that keeps every ink sample inside the display's top-left corner. */
    function bezelLogoMarginLeft(lw, lh, px) {
        const r = parseFloat(root.style.getPropertyValue('--display-corner-tl')) || 0;
        if (!(r > 0)) return 12 * px;
        const inside = (x, y) => x >= r || y >= r || Math.hypot(x - r, y - r) <= r;
        for (let m = 0; m <= r + 1; m += 0.5) {
            if (BEZEL_LOGO_INK_LEFT.every(([fx, fy]) => inside(m + fx * lw, fy * lh))) return m + 1;
        }
        return r + 1;
    }

    /** The smallest right margin that keeps every ink sample inside the display's top-right corner. */
    function bezelLogoMargin(lw, lh, px) {
        const r = parseFloat(root.style.getPropertyValue('--display-corner-tr')) || 0;
        if (!(r > 0)) return 12 * px; // no corner reported (a browser, an older app): as before
        const W = window.innerWidth;
        const inside = (x, y) => x <= W - r || y >= r || Math.hypot(x - (W - r), y - r) <= r;
        for (let m = 0; m <= r + 1; m += 0.5) {
            if (BEZEL_LOGO_INK.every(([fx, fy]) => inside(W - m - (1 - fx) * lw, fy * lh))) return m + 1;
        }
        return r + 1;
    }

    /** localStorage wmBezelCache: per screen size, what the band and logo were, for the next boot. */
    function saveBezelCache(entry) {
        try {
            const key = `${window.innerWidth}x${window.innerHeight}`;
            const all = JSON.parse(localStorage.getItem('wmBezelCache') || '{}') || {};
            const prev = all[key] ? JSON.stringify(all[key]) : '';
            const next = entry;
            if (prev === JSON.stringify(next)) return;
            all[key] = next;
            const keys = Object.keys(all);
            if (keys.length > 8) delete all[keys[0]];
            localStorage.setItem('wmBezelCache', JSON.stringify(all));
        } catch (_) { /* storage off */ }
    }

    /** The bezel's model text and LED: an element on <html> (outside the contained <body>). */
    function bezelOverlay() {
        let ov = document.getElementById('wmBezelOverlay');
        if (!ov) {
            ov = document.createElement('div');
            ov.id = 'wmBezelOverlay';
            ov.setAttribute('aria-hidden', 'true');
            ov.innerHTML = '<span class="wm-bezel-model"></span><span class="wm-bezel-led"></span>';
            document.documentElement.appendChild(ov);
        }
        if (!ov.querySelector('.wm-bezel-led')) ov.insertAdjacentHTML('beforeend', '<span class="wm-bezel-led"></span>');
        return ov;
    }

    function paintBezelModel(ov, model) {
        const el = ov.querySelector('.wm-bezel-model');
        if (!model) { el.textContent = ''; el.hidden = true; return; }
        el.hidden = false;
        if (el.textContent !== model.text) el.textContent = model.text;
        el.style.fontSize = `${model.size}px`;
        el.style.lineHeight = '1';
        el.style.top = `${model.baseline - model.size * 0.8}px`;
        el.style.left = model.align === 'left' ? `${model.x}px` : '';
        el.style.right = model.align === 'right' ? `${window.innerWidth - model.x}px` : '';
    }

    /**
     * The notification LED (Settings > Screen > Bezel): low battery blinks red, new notifications pulse
     * green, charging is amber, a full charge green; steps() blinks so the compositor draws only on change.
     */
    function paintBezelLed() {
        const ov = document.getElementById('wmBezelOverlay');
        const led = ov && ov.querySelector('.wm-bezel-led');
        if (!led) return;
        let state = '';
        if (lsFlag('wmBezelLed', false)) {
            const b = deviceView().battery;
            if (lsFlag('wmBezelLedBattery', true) && b && b.low) state = 'battery';
            else if (lsFlag('wmBezelLedNotify', true) && notes.length) state = 'notify';
            else if (lsFlag('wmBezelLedCharge', true) && b && b.charging && b.level < 100) state = 'charging';
            else if (lsFlag('wmBezelLedCharge', true) && b && b.charging) state = 'full';
        }
        if (led.dataset.state !== state) led.dataset.state = state;
    }

    /**
     * How far down the camera reaches, as the bezel band measures it: Android reports a punch hole's
     * circle as a box whose lower edge falls short of the lens (Yukimi tuned 6 px on the Fold7 cover
     * screen); a camera area at a corner (the inner screen) 1 px. The band and Extend Status Bar use it.
     */
    function cameraBottom(h) {
        const mid = h.left + h.width / 2;
        const central = h.width > 0 && Math.abs(mid - window.innerWidth / 2) < window.innerWidth * 0.2;
        return h.top + h.height + (central ? 6 : 1);
    }

    function syncBezel() {
        const style = root.style;
        const v = (n) => parseFloat(style.getPropertyValue(n)) || 0;
        const h = { left: v('--camera-hole-left'), top: v('--camera-hole-top'), width: v('--camera-hole-width'), height: v('--camera-hole-height') };
        // the Android app sends the camera a moment after the shell starts (dreamscape:cutout): until
        // then the band stays as app.html put it from the cache (else it jumps to the plain 18 px band)
        if (window.AndroidDisplay && style.getPropertyValue('--camera-hole-width') === '') return;
        if (cameraIgnoredNow()) {
            ['--wm-bezel-top', '--wm-bezel-left', '--wm-bezel-right'].forEach((n) => style.setProperty(n, '0px'));
            if (root.dataset.wmBezelEdge !== 'none') root.dataset.wmBezelEdge = 'none';
            saveBezelCache({ edge: 'none', top: 0, left: 0, right: 0, logo: null });
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
        // a camera in the middle of the top edge is a punch hole (Fold7 cover screen): the logo goes top right
        const mid = h.left + h.width / 2;
        const central = edge === 'top' && h.width > 0 && Math.abs(mid - window.innerWidth / 2) < window.innerWidth * 0.2;
        // a band only as tall as the camera needs (Yukimi tuned it on the Fold7): a punch hole's circle
        // is estimated from Android's box and gets 6 px; the inner screen's measured camera area 1 px;
        // 18 px where none is reported
        const band = edge === 'top' ? (h.height > 0 ? cameraBottom(h) : 18 * px) : 0;
        style.setProperty('--wm-bezel-top', `${band}px`);
        const logoRight = central;
        // The printed logo (Yukimi, Nov 11): from the display's very top edge down to where it ended
        // before (70 % of the band, the old bottom gap kept), centred - or, with the camera in the
        // middle, as far right as the display's rounded corner allows without cutting ink.
        // Settings > Screen > Bezel: the logo's opacity and position (Auto = centred, or right with the
        // camera in the middle), the model text and the notification LED
        let logo = null;
        let model = null;
        const W = window.innerWidth;
        let lsv = (k) => null;
        try { lsv = (k) => localStorage.getItem(k); } catch (_) { /* storage off */ }
        const opacity = Math.min(1, Math.max(0.1, (parseFloat(lsv('wmBezelLogoOpacity')) || 55) / 100));
        style.setProperty('--wm-bezel-logo-opacity', String(opacity));
        let logoSide = 'center';
        if (band > 0) {
            const logoSize = Math.min(100, Math.max(40, parseFloat(lsv('wmBezelLogoSize')) || 70));
            const lh = band * logoSize / 100;
            const lw = lh * (1024 / 242);
            const pos = lsv('wmBezelLogoPos') || 'auto';
            let lx = (W - lw) / 2;
            if (pos === 'left') { lx = bezelLogoMarginLeft(lw, lh, px); logoSide = 'left'; }
            else if (pos === 'right' || (pos === 'auto' && logoRight)) { lx = W - lw - bezelLogoMargin(lw, lh, px); logoSide = 'right'; }
            logo = { x: lx, w: lw, h: lh, opacity };
            style.setProperty('--wm-bezel-logo-x', `${lx}px`);
            style.setProperty('--wm-bezel-logo-w', `${lw}px`);
            style.setProperty('--wm-bezel-logo-h', `${lh}px`);
            // model text: off unless switched on (Settings > Screen > Bezel), sized in % of the band
            const text = lsv('wmBezelModelShow') === '1' ? String(lsv('wmBezelModel') || '').trim().slice(0, 32) : '';
            const ov = bezelOverlay();
            if (text) {
                let side = lsv('wmBezelModelPos') || 'auto';
                if (side === 'auto') side = logoSide === 'left' ? 'right' : 'left';
                const size = Math.max(7, band * Math.min(50, Math.max(20, parseFloat(lsv('wmBezelModelSize')) || 30)) / 100);
                const corner = parseFloat(style.getPropertyValue(side === 'left' ? '--display-corner-tl' : '--display-corner-tr')) || 0;
                const edgeGap = Math.max(corner, 6 * px) + 2;
                const x = side === 'left' ? edgeGap : W - edgeGap;
                const baseline = band / 2 + size * 0.36;
                model = { text, x, baseline, size, align: side === 'left' ? 'left' : 'right' };
            }
            paintBezelModel(ov, model);
            // the LED sits beside the camera (left of it), or near the left corner without one
            const d = Math.max(4, band * 0.2);
            const ledX = h.width > 0 ? h.left - d * 1.6 : (parseFloat(style.getPropertyValue('--display-corner-tl')) || 0) + 10 * px;
            style.setProperty('--wm-bezel-led-d', `${d}px`);
            style.setProperty('--wm-bezel-led-x', `${ledX}px`);
            style.setProperty('--wm-bezel-led-y', `${(band - d) / 2}px`);
            paintBezelLed();
        }
        if ((root.dataset.wmBezelLogo === 'right') !== logoRight) {
            if (logoRight) root.dataset.wmBezelLogo = 'right';
            else delete root.dataset.wmBezelLogo;
        }
        const left = edge === 'left' ? h.left + h.width + margin : 0;
        const right = edge === 'right' ? window.innerWidth - h.left + margin : 0;
        style.setProperty('--wm-bezel-left', `${left}px`);
        style.setProperty('--wm-bezel-right', `${right}px`);
        if (root.dataset.wmBezelEdge !== edge) root.dataset.wmBezelEdge = edge;
        // the band as the boot draws it before any script (app.html's inline script, DSApp's cover)
        saveBezelCache({ edge, top: band, left, right, logo, model });
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
        // Settings > Screen > Bezel > Extend Status Bar to edge of Camera (#777): a camera reaching
        // below the title bar would hang into the page: the page starts under it and the title bar
        // grows up over the strip (wm-shell.css data-wm-bar-extend); the icons keep their row
        const pxu = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        let extend = 0;
        let extOn = false;
        try { extOn = localStorage.getItem('wmCameraExtendBar') === '1'; } catch (_) { /* storage off */ }
        if (extOn && !bezel && !cameraIgnoredNow() && root.dataset.wmBezelEdge === 'top' && hole.width > 0 && hole.height > 0) {
            // down to where the bezel band puts the camera's lower edge (cameraBottom), not Android's box:
            // the box stops short of a punch hole's lens and left a sliver of it under the bar
            extend = Math.max(0, Math.ceil(cameraBottom(hole) - 26 * pxu));
        }
        if (extend > 0) {
            if (root.style.getPropertyValue('--wm-camera-extend') !== `${extend}px`) root.style.setProperty('--wm-camera-extend', `${extend}px`);
            if (root.dataset.wmBarExtend !== '1') root.dataset.wmBarExtend = '1';
        } else if (root.dataset.wmBarExtend) {
            delete root.dataset.wmBarExtend;
            root.style.removeProperty('--wm-camera-extend');
        }
        const br0 = bar.getBoundingClientRect();
        // the icons' row: centred in the bar when extended (wm-shell.css: half the extra space above it, half below)
        const br = { top: br0.top + extend / 2, bottom: br0.bottom - extend / 2, right: br0.right, left: br0.left };
        const tl = title.getBoundingClientRect().left;
        const pad = 3 * (parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1);
        const inBar = !bezel && !cameraIgnoredNow() && hole.width > 0 && hole.height > 0 && hole.top < br.bottom && hole.top + hole.height > br.top
            && hole.left - pad > tl && hole.left + hole.width < br.right;
        if (!inBar) {
            if (gap) gap.remove();
            if (left) left.remove();
            title.style.flex = '';
            status.style.marginLeft = '';
            return false;
        }
        // Settings > Screen > Bezel > Do not allow status icons to cross over camera hole: the icons
        // stay right of it; what does not fit folds into the notification group (fitStatusNow)
        let noCross = false;
        try { noCross = localStorage.getItem('wmStatusNoCross') === '1'; } catch (_) { /* storage off */ }
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
        while (!noCross && status.getBoundingClientRect().width > room && shown().length > 1) {
            const first = shown()[0];
            // hidden icons before it go along, so each side keeps WM's order when one appears
            status._wmOrder.slice(0, status._wmOrder.indexOf(first) + 1).forEach((i) => { if (i.parentElement === status) left.append(i); });
        }
        const lw = left.firstElementChild ? left.getBoundingClientRect().width : 0;
        title.style.flex = `0 0 ${Math.max(0, hole.left - pad - tl - lw)}px`;
        return true;
    }

    /**
     * The screen's rounded corners (Yukimi, Nov 13: Start and the X sat in the Fold7's corner curve
     * with the title bar run up to the top edge). Where the bar touches the screen's top (camera
     * "clear": no safe area above it), each end moves in just enough that the row of icons clears
     * the curve: for a corner of radius r and the row's top y (CSS px, the app's physical pixels /
     * devicePixelRatio), the curve is r - sqrt(r^2 - (r - y)^2) in from the edge at that height; what
     * the layout's own margin already covers is not added again. AndroidDisplay.getScreenInfo
     * cornerTopLeftPx / cornerTopRightPx; an app without them, or a bar below the edge, gets none.
     */
    function applyCornerInset(bar) {
        let left = 0;
        let right = 0;
        const D = window.AndroidDisplay;
        const atTop = bar && bar.getBoundingClientRect().top <= 0.5;
        if (atTop && D && typeof D.getScreenInfo === 'function') {
            let info = null;
            try { info = JSON.parse(D.getScreenInfo() || 'null'); } catch (_) { info = null; }
            const dpr = window.devicePixelRatio || 1;
            const icon = bar.querySelector('.wm-start img') || bar.querySelector('.wm-status-icon:not([hidden])');
            const rowTop = icon ? Math.max(0, icon.getBoundingClientRect().top) : 0;
            const curve = (px) => {
                const r = (Number(px) || 0) / dpr;
                if (r <= rowTop) return 0;
                return r - Math.sqrt(Math.max(0, r * r - (r - rowTop) * (r - rowTop)));
            };
            const startImg = bar.querySelector('.wm-start img');
            const ownLeft = startImg ? Math.max(0, startImg.getBoundingClientRect().left - bar.getBoundingClientRect().left - (parseFloat(bar.style.paddingLeft) || 0)) : 0;
            const act = bar.querySelector('.wm-title-action');
            const ownRight = act && !act.hidden ? Math.max(0, parseFloat(getComputedStyle(act).marginRight) || 0) : 0;
            if (info) {
                left = Math.max(0, curve(info.cornerTopLeftPx) - ownLeft);
                right = Math.max(0, curve(info.cornerTopRightPx) - ownRight);
            }
        }
        const l = left ? `${left.toFixed(2)}px` : '';
        const r = right ? `${right.toFixed(2)}px` : '';
        if (bar && bar.style.paddingLeft !== l) bar.style.paddingLeft = l;
        if (bar && bar.style.paddingRight !== r) bar.style.paddingRight = r;
    }

    function fitStatusNow() {
        if (!shell) return;
        const bar = shell.querySelector('.wm-titlebar');
        applyCornerInset(bar);
        const el = (r) => shell.querySelector(`.wm-status-icon[data-role="${r}"]`);
        // the children's own boxes, not scrollWidth: 6.5's corner button carries a pressed
        // highlight that reaches 22 units past it (wm65.css), which made the bar always "too
        // wide" there and shed the volume and app icons beside every X / ok
        const fits = () => {
            const box = bar.getBoundingClientRect();
            let right = box.left;
            for (const c of bar.children) {
                if (!c.getClientRects().length) continue;
                right = Math.max(right, c.getBoundingClientRect().right + (parseFloat(getComputedStyle(c).marginRight) || 0));
            }
            return right <= box.right + 1;
        };
        ['roaming', 'volume', 'battery', ...STATUS_APP_ROLES].forEach((r) => el(r).classList.remove('wm-shed'));
        statusFolded = [];
        // WM 6.1's notification area (#811, Yukimi Nov 13). Room for a few icons is kept left of
        // the device icons, so the title ends at the same place whatever is pending. When the bar
        // runs short, what is not needed steps aside first: the kept room, the volume icon, the battery while it charges. Never: data, signal / roaming,
        // Continuity, the battery on battery power. Then the app icons fold into the one group
        // icon (its tap opens the tray of them): the ongoing and the newest stay out of it, and
        // more stay out while the icons keep to the bar's right half (the 50 % mark)
        const slots = statusSlots();
        const apps = STATUS_APP_ROLES.filter((r) => !el(r).hidden);
        const now = Date.now();
        apps.forEach((r) => { if (!statusSeenAt.has(r)) statusSeenAt.set(r, now); });
        STATUS_APP_ROLES.forEach((r) => { if (el(r).hidden) statusSeenAt.delete(r); });
        const foldable = apps.filter((r) => !STATUS_NEVER_FOLD.has(r));
        // who stays out of the group first: ongoing work, then the newest
        const outOrder = foldable.slice().sort((x, y) => (statusOngoing(el(y)) - statusOngoing(el(x))) || (statusSeenAt.get(y) - statusSeenAt.get(x)));
        const fold = (keep) => {
            const out = new Set(outOrder.slice(0, keep));
            const folded = foldable.filter((r) => !out.has(r));
            apps.forEach((r) => el(r).classList.toggle('wm-shed', folded.includes(r)));
            statusFolded = folded;
            paintNotifyIcon();
        };
        paintNotifyIcon();
        const reserve = shell.querySelector('.wm-status-reserve');
        const used = apps.length + (el('notify').hidden ? 0 : 1);
        const free = Math.max(0, slots - used);
        const setReserve = (n) => {
            reserve.hidden = !n;
            if (n) reserve.style.setProperty('--slots', String(n));
        };
        setReserve(0);
        // the camera's layout moves left of it what does not fit right of it, so it is laid out
        // again after every icon that steps aside or folds: the group icon then goes into the room
        // right of the camera instead of staying left of it (Yukimi, Nov 13, Fold7)
        let cameraInBar = applyCameraHole(bar);
        const relayout = () => { if (cameraInBar) cameraInBar = applyCameraHole(bar); };
        // the kept room (not with the camera in the bar: its own layout decides there)
        if (!cameraInBar) setReserve(free);
        // the 50 % mark: the leftmost icon starts in the bar's right half (the kept room aside)
        const half = () => {
            const box = bar.getBoundingClientRect();
            const mid = box.left + box.width / 2;
            return !Array.from(bar.querySelectorAll('.wm-status-icon')).some((i) => !i.hidden && !i.classList.contains('wm-shed') && i.getClientRects().length && i.getBoundingClientRect().left < mid);
        };
        const ok = () => fits() && half();
        const step = (fn) => { fn(); relayout(); return ok(); };
        // the camera in the title bar takes room: away from Today the volume icon steps aside for the
        // status icons (Yukimi, Nov 13); Today keeps it
        if (cameraInBar && current !== 'today' && !el('volume').hidden) el('volume').classList.add('wm-shed');
        relayout();
        if (ok()) return;
        if (!reserve.hidden && step(() => setReserve(0))) return;
        if (!el('volume').hidden && step(() => el('volume').classList.add('wm-shed'))) return;
        const bat = el('battery');
        if (!bat.hidden && bat.dataset.icon === 'battery-charging' && step(() => bat.classList.add('wm-shed'))) return;
        // fold from the oldest, one more each time; a group holds two or more (one app icon
        // alone in it takes the same room as the icon itself), and the ongoing or newest one stays
        // out while the bar only passes the 50 % mark
        const notesInGroup = notesForBubbleIcon().length ? 1 : 0;
        const first = foldable.length - (notesInGroup ? 1 : 2);
        for (let keep = first; keep >= 1; keep--) if (step(() => fold(keep))) return;
        if (fits()) return;
        // a bar that is really full (a long title's floor, the X): all of them go in
        if (foldable.length && foldable.length + notesInGroup >= 2) { fold(0); relayout(); }
    }

    // #811: app icons that always keep their place (Continuity: the phone carries the DeX window)
    const STATUS_NEVER_FOLD = new Set(['continuity']);
    // when each app icon came up (the newest stays out of the group)
    const statusSeenAt = new Map();
    /** Ongoing work on an icon: the Director's turn, prints, an update downloading. */
    function statusOngoing(i) {
        if (!i) return 0;
        const r = i.dataset.role;
        return (r === 'prints' || (r === 'director' && i.dataset.clap === 'working') || (r === 'update' && i.dataset.dl === '1')) ? 1 : 0;
    }

    /*
     * The fold follows the icons at once (#811: "delayed, and not on an add / remove"): an icon
     * shown or hidden, or the battery's glyph changing (charging), refits in the same task, before
     * the frame is drawn. The fit's own writes (the group icon, the kept room) are dropped.
     */
    let statusFitting = false;
    function watchStatusIcons() {
        const status = shell && shell.querySelector('.wm-titlebar');
        if (!status || status._wmFitWatch) return;
        const mo = new MutationObserver((list) => {
            if (statusFitting) return;
            // data-icon: only the battery's (charging or not); the data arrows change it with every packet
            const counts = (m) => m.target.classList && m.target.classList.contains('wm-status-icon') && m.target.dataset.role !== 'notify'
                && (m.attributeName === 'hidden' || m.target.dataset.role === 'battery');
            if (!list.some(counts)) return;
            statusFitting = true;
            try { fitStatusNow(); snapStatusIcons(); } finally { mo.takeRecords(); statusFitting = false; }
        });
        mo.observe(status, { subtree: true, attributes: true, attributeFilter: ['hidden', 'data-icon'] });
        status._wmFitWatch = mo;
    }

    /** The title bar's kept room in icons (#811): Settings key wmStatusSlots, 1 to 4, 2 by default. */
    function statusSlots() {
        let n = NaN;
        try { n = parseInt(localStorage.getItem('wmStatusSlots'), 10); } catch (_) { n = NaN; }
        return Number.isFinite(n) ? Math.min(4, Math.max(1, n)) : 2;
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
    // WM 6.1 letters; LTE and 5G are Melaton's own (drawn in the same style, see manifest.json).
    // 5G carrier style (Yukimi, Nov 10): NR for 5G (NSA and standalone), NR-A for NR Advanced,
    // UW for mmWave (Yukimi, Nov 12: UW, not UWB); an older app's '5G+' (both of the latter) shows NR-A
    const DATA_ICON = { GPRS: 'g', EDGE: 'e', '3G': '3g', HSPA: 'h', 'HSPA+': 'h-plus', LTE: '4g', 'LTE+': '4g-plus', '5G': 'nr', '5G+': 'nr-a', '5G-A': 'nr-a', '5G UW': 'uw' };
    const DATA_NAME = { GPRS: 'GPRS', EDGE: 'EDGE', '3G': '3G', HSPA: 'HSPA', 'HSPA+': 'HSPA+', LTE: 'LTE', 'LTE+': 'LTE+', '5G': '5G NR', '5G+': '5G NR-A', '5G-A': '5G NR-A', '5G UW': '5G UWB' };
    /*
     * Settings > Connections > Cellular (wmSettingsConnections.js, #771) picks how a type is drawn:
     *   wmCellLte   LTE / LTE+ in place of 4G / 4G+
     *   wmCell5g    5G / 5G+ in place of NR / NR-A / UWB; wmCell5gUw keeps mmWave apart as 5G UW
     *   wmCellNrUw  NR UW (stacked) in place of UWB (when the 5G indicator is off)
     * typeIcon(dataType) -> the badge key (status-data-<key>), typeName(dataType) -> the words.
     */
    function typeIcon(type) {
        let k = DATA_ICON[type];
        if (!k) return null;
        if (lsFlag('wmCellLte', false)) k = { '4g': 'lte', '4g-plus': 'lte-plus' }[k] || k;
        if (lsFlag('wmCell5g', false)) k = { nr: '5g', 'nr-a': '5g-plus', uw: lsFlag('wmCell5gUw', false) ? '5g-uw' : '5g-plus' }[k] || k;
        else if (lsFlag('wmCellNrUw', false) && k === 'uw') k = 'nr-uw';
        return k;
    }
    function typeName(type) {
        const k = typeIcon(type);
        return { lte: 'LTE', 'lte-plus': 'LTE+', '5g': '5G', '5g-plus': '5G+', '5g-uw': '5G UW', 'nr-uw': 'NR UW' }[k] || DATA_NAME[type] || type;
    }

    /*
     * The RIL's operator names as the phone shows them: Android reports today's short brand, the
     * device shows the carrier's classic network name (Yukimi, Nov 13). Exact names only, any case.
     */
    const CARRIER_NAMES = { verizon: 'Verizon Wireless' };
    function carrierName(name) {
        if (typeof name !== 'string') return name;
        const t = name.trim();
        return CARRIER_NAMES[t.toLowerCase()] || t;
    }

    function takeDeviceStatus(s) {
        if (typeof s === 'string') { try { s = JSON.parse(s); } catch (_) { return; } }
        if (!s || typeof s !== 'object') return;
        if (s.cellular && typeof s.cellular === 'object' && typeof s.cellular.operator === 'string') {
            s.cellular.operator = carrierName(s.cellular.operator);
        }
        deviceStatus = s;
        refreshStatus();
    }

    function pollDeviceBridge() {
        const b = window.AndroidDeviceStatus;
        if (!b || typeof b.getState !== 'function') return false;
        try { takeDeviceStatus(b.getState()); } catch (_) { /* bridge not ready */ }
        return true;
    }

    // Bluetooth in the tray (#735): shellres ico 4691 while the phone's Bluetooth is on (Android app,
    // AndroidDevice / dreamscape:radios); its bubble says whether a device is connected
    let radiosNow = null;
    function readRadios() {
        const dv = window.AndroidDevice;
        if (!dv || typeof dv.getRadios !== 'function') return null;
        try { return JSON.parse(dv.getRadios()); } catch (_) { return null; }
    }
    /** 'on' | 'connected' | 'never'; the older check box (wmShowBluetoothIcon '0') reads as never. */
    function bluetoothStatusMode() {
        let v = null;
        try { v = localStorage.getItem('wmBluetoothStatus'); if (!v && localStorage.getItem('wmShowBluetoothIcon') === '0') v = 'never'; } catch (_) { v = null; }
        return v === 'connected' || v === 'never' ? v : 'on';
    }
    function takeRadios(r) {
        radiosNow = r || null;
        const icon = shell && shell.querySelector('.wm-status-icon[data-role="bluetooth"]');
        if (!icon) return;
        // Settings > Connections > Bluetooth: Show Bluetooth Status: When Powered On / When Connected / Never
        const mode = bluetoothStatusMode();
        const show = !!(radiosNow && radiosNow.bluetooth) && (mode === 'on' || (mode === 'connected' && radiosNow.bluetoothConnected === true));
        if (icon.hidden === show) { icon.hidden = !show; fitStatus(); }
        const bubble = shell.querySelector('.wm-bubble');
        if (bubble && !bubble.hidden && bubble.dataset.role === 'bluetooth') statusBubble('bluetooth', icon, true);
    }

    function watchDevice() {
        window.addEventListener('dreamscape:radios', (e) => takeRadios((e && e.detail) || readRadios()));
        takeRadios(readRadios());
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
        else if (active === 'cellular') link = { icon: type ? `data-${typeIcon(type)}-active` : 'data-on', text: type ? `${typeName(type)}: connected` : 'Cellular data: connected' };
        else if (active === 'ethernet') link = { icon: 'data-on', text: 'Wired network: connected' };
        else if (active === 'vpn') link = { icon: 'data-on', text: 'VPN: connected' };
        else if (active === 'none' || cell || wifi) {
            if (type && !airplane && cell.dataEnabled !== false) link = { icon: `data-${typeIcon(type)}-avail`, text: `${typeName(type)} available` };
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
            // on battery at or under the warning level (Settings > Power): the notification and the LED; the icon has its own stages
            const low = !charging && level <= batteryLowLevel();
            // the cell's stages (Yukimi, Nov 13): 4 bars over 80 %, 3 over 60, 2 over 40, 1 over 20, 20 and under the "!"
            const icon = charging ? 'battery-charging' : level <= 20 ? 'battery-empty' : level > 80 ? 'battery-full' : level > 60 ? 'battery-3' : level > 40 ? 'battery-2' : 'battery-1';
            battery = { icon, level, charging, low, plugged: bat && typeof bat.plugged === 'string' ? bat.plugged : null, saver: !!(bat && bat.saver === true), text: `Main battery: ${level}%${charging ? ', charging' : ''}` };
        }
        return { cell, wifi, active, airplane, type, wifiName, link, signal, battery };
    }

    // ---------------------------------------------------------------- status: shared state

    let shellDirectorStatus = null;
    let shellDirectorAsked = false;
    let shellMailUnread = 0;
    /** Unread text messages: Text Messaging's accounts (#779; wmChat.js wmTextShell, else the client's last count). */
    const smsUnread = () => {
        try {
            const t = window.wmTextShell;
            if (t && typeof t.unread === 'function') return Number(t.unread()) || 0;
            const tm = window.textMessaging;
            const u = tm && typeof tm.unread === 'function' ? tm.unread() : null;
            return u ? Number(u.total) || 0 : 0;
        } catch (_) { return 0; }
    };
    /** Unread Dreamscape Messenger lines: the persona lines wmChat.js has not shown yet. */
    const chatUnread = () => { try { const c = window.wmChatApp; return c && typeof c.unread === 'function' ? Number(c.unread()) || 0 : 0; } catch (_) { return 0; } };
    /** IMAP e-mail accounts (#789): unread Inbox mail (window.mailAccounts), and new arrivals not read yet (wmMessaging.js). */
    const imapUnread = () => { try { const m = window.mailAccounts; const u = m && typeof m.unread === 'function' ? m.unread() : null; return u ? Number(u.total) || 0 : 0; } catch (_) { return 0; } };
    const imapNew = () => { try { const m = window.wmMessaging; return m && typeof m.imapNew === 'function' ? Number(m.imapNew()) || 0 : 0; } catch (_) { return 0; } };
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

    /**
     * ActiveSync transfers (#822): ActiveSync: Start as data starts moving, ActiveSync: Complete when the
     * last file is through; the icon's sync sequence and an open Connectivity bubble follow along.
     */
    function watchActiveSyncTransfers() {
        const as = window.activeSync;
        if (!as || typeof as.on !== 'function' || as.kind !== 'device') return;
        let moving = false;
        as.on('progress', (d) => {
            if (!d) return;
            if (d.active && !moving) { moving = true; playSystemSound('as-start'); }
            if (d.done && moving) { moving = false; playSystemSound('as-done'); }
            statusDirty();
            const b = shell && shell.querySelector('.wm-bubble');
            if (b && !b.hidden && b.dataset.role === 'data') statusBubble('data', shell.querySelector('[data-role="data"]'), true);
        });
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
     * sections: strings, { html }, { links: [{ label, action }], align: 'right' }, { rule: true };
     * buttons: [{ text, action }]; footLinks: [{ label, action }] = links left of the buttons with a
     * rule above them (WM 6.1's Phone / Connectivity bubbles: Settings | Hide).
     */
    function bubble({ title, sections = [], buttons = [{ text: 'Hide' }], footLinks = null, anchor = null, role = '' } = {}) {
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
            else if (sec && sec.rule) part.classList.add('is-rule');
            else if (sec && sec.links) {
                part.classList.add('is-links');
                if (sec.align === 'right') part.classList.add('is-right');
                // a line of text with its links at the right of the same row
                if (sec.text) {
                    part.classList.add('has-text');
                    const t = document.createElement('span');
                    t.className = sec.bold ? 'wm-bubble-text is-bold' : 'wm-bubble-text';
                    t.textContent = sec.text;
                    part.appendChild(t);
                }
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
        if ((buttons && buttons.length) || (footLinks && footLinks.length)) {
            const row = document.createElement('div');
            row.className = 'wm-bubble-buttons';
            if (footLinks && footLinks.length) {
                row.classList.add('has-links');
                for (const l of footLinks) {
                    const a = document.createElement('button');
                    a.type = 'button';
                    a.className = 'wm-bubble-link';
                    a.textContent = l.label;
                    a.addEventListener('click', (e) => { e.stopPropagation(); closeBubble(); if (typeof l.action === 'function') l.action(); });
                    row.appendChild(a);
                }
            }
            for (const b of (buttons || [])) {
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

    // Yukimi, Nov 13: a slow link raises no notification; the service worker's update toasts belong to
    // the title bar's update icon (it shows while one waits, a tap on it brings the notice up), never
    // the speech bubble
    const LATENCY_TOAST = /^high latency/i;
    const UPDATE_TOAST = /^(checking for updates|downloading updates|download stalled|up to date|updates? applied|update check failed|updates? (are )?(ready|available))/i;
    const isUpdateNote = (n) => !!n && UPDATE_TOAST.test(String(n.title || ''));
    // while updates are checked for or download there is no notification and no popup: the update
    // icon animates and its own popup shows the progress; the result is the notification (Yukimi,
    // Nov 13). "Up to Date" is no news at all.
    const UPDATE_QUIET = /^(checking for updates|downloading updates|up to date)/i;
    /** The service worker's running update toast: { title, text, pct } or null. */
    function updateProgressToast() {
        const box = document.getElementById('toastContainer');
        if (!box) return null;
        for (const t of box.children) {
            if (t.classList.contains('removing')) continue;
            const title = ((t.querySelector('.toast-title') || {}).textContent || '').trim();
            if (!/^(checking for updates|downloading updates)/i.test(title)) continue;
            const bar = t.querySelector('.toast-progress-bar');
            const w = bar ? parseFloat(bar.style.width) : NaN;
            const text = ((t.querySelector('.toast-message') || {}).textContent || '').replace(/\s+/g, ' ').trim();
            return { id: t.id, title, text, pct: Number.isFinite(w) ? Math.max(0, Math.min(100, w)) : null };
        }
        return null;
    }

    /**
     * An update notice left at "Downloading updates 100%" after the download ended (Yukimi, Nov 14:
     * it never turned into Restart). Seen when the page missed or could not run its completion step
     * (a download another page started, the background updater pausing timers again right after).
     * When the service worker is not downloading, the notice finishes: the page's own notice gets its
     * Restart / Apply step; another is removed, and the update icon offers Restart Now from the
     * pending updates. Resolves true when it changed something.
     */
    let healingUpdate = null;
    function healFinishedUpdateNotice() {
        const dl = updateProgressToast();
        const sw = window.serviceWorkerManager;
        if (!dl || !sw || !(dl.pct >= 100) || /^checking/i.test(dl.title)) return Promise.resolve(false);
        if (healingUpdate) return healingUpdate;
        healingUpdate = (async () => {
            let state = null;
            try { state = typeof sw.checkDownloadState === 'function' ? await sw.checkDownloadState() : null; } catch (_) { state = null; }
            if (state && state.isDownloading) return false;
            sw.isUpdating = false;
            if (sw.pendingUpdateFuse && sw.updateToastId === dl.id && typeof sw.showUpdateCompleteToast === 'function') {
                sw.showUpdateCompleteToast(sw.pendingUpdateKind === 'restart' ? 'restart' : 'apply');
            } else if (typeof window.removeGlassToast === 'function') {
                window.removeGlassToast(dl.id);
                if (sw.updateToastId === dl.id) sw.updateToastId = null;
            }
            return true;
        })().finally(() => { healingUpdate = null; });
        return healingUpdate;
    }

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
            if (LATENCY_TOAST.test(title)) continue;
            // checking / downloading: quiet while it says so. The same toast turns into the result
            // ("Updates Complete"): that is the notification (Yukimi, Nov 14: the sound played, no
            // bubble, because a busy mark set here hid the result for good)
            if (UPDATE_QUIET.test(title)) continue;
            // a notification: toastManager's timer leaves it until the user dismisses it (WM
            // notifications never close by themselves, Yukimi Nov 13)
            t.dataset.wmNote = '1';
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
    /** The notifications the speech bubble stands for: all but the update notices (the update icon's). */
    // New e-mail (any account: Dreamscape Mail, IMAP), text messages (any Text Messaging account) and
    // Dreamscape Messenger each have one status icon of their own; their notifications stand on it,
    // never on the speech bubble, so two accounts never show two glyphs (Yukimi, Nov 13)
    const MESSAGE_CLASS = { mail: 'mail', sms: 'sms', chat: 'chat' };
    const messageClassOf = (n) => MESSAGE_CLASS[noteEvent(n)] || null;
    const notesForBubbleIcon = () => notes.filter((n) => !isUpdateNote(n) && !messageClassOf(n));
    const messageNotes = (role) => notes.filter((n) => messageClassOf(n) === role);
    const noteShownNote = () => noteOf(noteShown);

    /** Bubbles wait for startup and for full-screen takeovers (logon, errors). */
    function notesMayPop() {
        return (!root.dataset.wmBoot || root.dataset.wmBoot === 'done') && !root.dataset.wmTakeover;
    }

    function queueNotes() {
        if (noteQueued) return;
        noteQueued = true;
        // a timer, not a frame: a tab in the background still keeps its notifications
        setTimeout(() => { noteQueued = false; refreshNotes(); statusDirty(); }, 30);
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
    const BACKGROUND_TOAST = /^(connecting|connected|connection|reconnect|offline|high latency|generation complete|you have mail|new mail|update|checking for updates|downloading updates|download stalled|up to date|main battery)/i;

    /**
     * Loading while Melaton starts (20 s after boot) or while a workspace switch runs is never a
     * notification (Yukimi, Nov 10). Starting up shows the wait cursor alone; a workspace switch
     * shows a WM "Please Wait" box with the wait cursor and the toast's text, over the screen until
     * the loading toasts are gone.
     */
    let bootDoneAt = 0;
    let switchingWorkspace = false;
    const loadingToasts = new Set();
    /**
     * Connection status (Yukimi, Nov 11, #742): the server starting, a lost link, reconnecting and
     * connected again are a status box over the screen, never a notification (no bubble, no sound).
     * The box has no close button and goes by itself: when the toast goes, a moment after it reads
     * Connected, or a few seconds after an error (the title bar's connection icon keeps showing that
     * state). A workspace switch is the same box for every toast it raises, its result included.
     */
    const STATUS_TOAST = /^(connecting|connected|connection (error|warning|lost|restored|established)|reconnect\w*|disconnected|offline|server\b)/i;
    const statusToasts = new Map();   // toast -> { title: the box's caption, doneAt: when its end state was first seen }
    let loadingLayer = null;
    let loadingTimer = null;

    function loadingPhase() {
        return switchingWorkspace || (bootDoneAt && Date.now() - bootDoneAt < 20000);
    }

    function wrapWorkspaceSwitch() {
        const orig = window.setActiveWorkspace;
        if (typeof orig !== 'function' || orig.wmWrapped) return !!(orig && orig.wmWrapped);
        const wrapped = function (id) {
            switchingWorkspace = true;
            // another workspace: the whole screen is covered until its Today is ready (showSwitchCover)
            let covered = false;
            try {
                const active = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
                if (id && id !== active && root.dataset.wmBoot === 'done') { showSwitchCover(id); covered = true; }
            } catch (_) { /* the switch runs uncovered */ }
            let r;
            try { r = orig.apply(this, arguments); } catch (err) { switchingWorkspace = false; if (covered) hideSwitchCover(); throw err; }
            // the splash stays until the switch reports complete (workspaceSwitchComplete, below) and
            // Today is ready; setActiveWorkspace resolves once the server took the switch, long before
            // the gallery has loaded, so its end lifts nothing (only a rejection does)
            Promise.resolve(r).catch(() => { if (covered && switchCoverFor === id) hideSwitchCover(); })
                .finally(() => { setTimeout(() => { switchingWorkspace = false; }, 1500); });
            return r;
        };
        wrapped.wmWrapped = true;
        window.setActiveWorkspace = wrapped;
        // after Today's own listeners (registered at start): its settings and picture are set by then
        document.addEventListener('workspaceSwitchComplete', (ev) => {
            const id = ev && ev.detail && ev.detail.workspaceId;
            if (switchCoverFor && (!id || id === switchCoverFor)) void settleSwitchCover(switchCoverFor);
        });
        // the server refused or the socket dropped: the splash goes at once, the error box shows
        document.addEventListener('workspaceSwitchFailed', (ev) => {
            const id = ev && ev.detail && ev.detail.workspaceId;
            if (switchCoverFor && (!id || id === switchCoverFor)) hideSwitchCover();
        });
        return true;
    }

    /**
     * A workspace switch reconfigures the whole phone: theme colours, the Today picture and its
     * placement, the Today layout, the gallery and the newest prints. Drawn live that was a run of
     * jumps, and the old plain white "Loading" cover lifted on a 4 s timer whether the workspace had
     * loaded or not (Yukimi, Nov 13: a better splash, held until all data is loaded, then Today).
     * So a switch is a short restart into the other workspace: the version's own boot splash
     * (6.1's green rings, 6.5's orange glow; buildBootLayers) with the boot's wait wheel and
     * "Loading <workspace>..." under it, over the bars too. The phone goes back to Today under it.
     * It holds until the switch reported complete (workspaceSwitchComplete: the gallery's list is
     * in), the workspace's Today layout is in place, its picture and every picture on Today (the
     * newest prints, 6.5's panels) have loaded (8 s at most for those) and two frames were painted;
     * never before 1.2 s, and 90 s at the most for a switch that never reports (a 16,000-print workspace took 29 s in a test tab). Then Today comes up
     * the way the boot ends (playBootReveal: body, soft keys, title bar, 6.1's rows in groups).
     */
    let switchCoverFor = null;
    let switchCoverAt = 0;
    let switchCoverTimer = null;
    const SWITCH_MIN_MS = 1200;
    const SWITCH_MAX_MS = 90000;
    const SWITCH_ART_MAX_MS = 8000;

    function showSwitchCover(id) {
        const splash = shell.querySelector('.wm-splash');
        if (!splash) return;
        let status = splash.querySelector('.wm-switch-status');
        if (!status) {
            status = document.createElement('p');
            status.className = 'wm-switch-status';
            status.setAttribute('role', 'status');
            status.setAttribute('aria-live', 'polite');
            splash.appendChild(status);
        }
        let name = '';
        try { if (typeof workspaces !== 'undefined' && workspaces[id]) name = workspaces[id].name || ''; } catch (_) { name = ''; }
        status.textContent = name ? `Loading ${name}...` : 'Loading workspace...';
        closeMenus(true);
        delete root.dataset.wmReveal;
        root.dataset.wmSwitching = '1';
        const wait = shell.querySelector('.wm-boot-wait');
        if (wait) { waitStrip(wait); wait.hidden = false; }
        switchCoverFor = id;
        switchCoverAt = Date.now();
        clearTimeout(switchCoverTimer);
        switchCoverTimer = setTimeout(() => { if (switchCoverFor === id) void settleSwitchCover(id, true); }, SWITCH_MAX_MS);
        // back to Today under the splash (the boot's own reset of the back stack): the switch ends there
        void afterPaint().then(() => {
            if (switchCoverFor !== id) return;
            stack.length = 0;
            stack.push('today');
            if (current !== 'today') activate('today');
        });
    }

    function hideSwitchCover() {
        clearTimeout(switchCoverTimer);
        switchCoverTimer = null;
        switchCoverFor = null;
        delete root.dataset.wmSwitching;
        const wait = shell && shell.querySelector('.wm-boot-wait');
        if (wait && root.dataset.wmBoot === 'done') wait.hidden = true;
    }

    /** Resolves when every picture Today shows (img elements, the print tiles' backgrounds) has loaded or failed. */
    function todayPicturesLoaded(page) {
        const urls = new Set();
        const pic = todayPicture();
        if (pic) urls.add(pic);
        if (page) {
            page.querySelectorAll('[style*="background-image"]').forEach((el) => {
                const m = /url\((['"]?)(.*?)\1\)/.exec(el.style.backgroundImage || '');
                if (m && m[2]) urls.add(m[2]);
            });
        }
        const waits = [...urls].map((u) => new Promise((resolve) => { const im = new Image(); im.onload = im.onerror = resolve; im.src = u; }));
        if (page) {
            page.querySelectorAll('img').forEach((im) => {
                if (im.complete || im.closest('[hidden]')) return;
                waits.push(new Promise((resolve) => { im.addEventListener('load', resolve, { once: true }); im.addEventListener('error', resolve, { once: true }); }));
            });
        }
        return Promise.all(waits);
    }

    /** The switch is through: Today redrawn with the workspace's data and pictures, two frames painted, then Today comes up. */
    async function settleSwitchCover(id, timedOut) {
        if (switchCoverFor !== id) return;
        const today = apps.get('today');
        if (!timedOut) {
            loadTodayPrefs(false);
            if (today && today.page) { try { today.refresh(); } catch (err) { console.warn('[wmShell] today refresh', err); } }
            // a refresh that came in from the gallery list a frame later (newest prints) is painted first
            await afterPaint();
            if (switchCoverFor !== id) return;
            if (today && today.page) { try { today.refresh(); } catch (_) { /* drawn above */ } }
            await Promise.race([
                todayPicturesLoaded(today && today.page),
                new Promise((resolve) => setTimeout(resolve, SWITCH_ART_MAX_MS))
            ]);
        }
        await afterPaint();
        await afterPaint();
        const left = SWITCH_MIN_MS - (Date.now() - switchCoverAt);
        if (left > 0) await new Promise((resolve) => setTimeout(resolve, left));
        if (switchCoverFor !== id) return;
        hideSwitchCover();
        if (current === 'today') playBootReveal();
    }

    function showLoadingBox(text, caption) {
        if (!loadingLayer) {
            loadingLayer = document.createElement('div');
            loadingLayer.className = 'wm-msgbox-layer wm-loading-layer';
            loadingLayer.innerHTML = '<div class="wm-msgbox" role="alertdialog" aria-busy="true"><div class="wm-msgbox-title"><span>Please Wait</span></div><div class="wm-msgbox-body"><img class="wm-loading-wait" alt="" draggable="false"><div class="wm-msgbox-text"></div></div></div>';
            shell.appendChild(loadingLayer);
        }
        loadingLayer.querySelector('.wm-msgbox-text').textContent = text || 'Loading...';
        loadingLayer.querySelector('.wm-msgbox-title span').textContent = caption || 'Please Wait';
        if (loadingLayer.hidden !== false || !loadingTimer) {
            loadingLayer.hidden = false;
            // the version's own wheel (6.1 at 6.1's size, 6.5's four dots), as the busy cursor
            waitStrip(loadingLayer.querySelector('.wm-loading-wait'));
            clearInterval(loadingTimer);
            loadingTimer = setInterval(() => {
                for (const t of [...loadingToasts]) {
                    if (!t.isConnected || t.classList.contains('removing')) { loadingToasts.delete(t); statusToasts.delete(t); continue; }
                    // a status toast that reached its end state: shown a moment longer, then let go
                    const st = statusToasts.get(t);
                    if (!st) continue;
                    const type = (t.className.match(/glass-toast-(\w+)/) || [])[1] || 'info';
                    const hold = type === 'success' ? 1300 : (type === 'error' || type === 'warning') ? 5000 : 0;
                    if (!hold || t.classList.contains('upload-progress') && type !== 'success') { st.doneAt = 0; continue; }
                    if (!st.doneAt) st.doneAt = Date.now();
                    else if (Date.now() - st.doneAt > hold) { loadingToasts.delete(t); statusToasts.delete(t); }
                }
                if (!loadingToasts.size) { hideLoadingBox(); return; }
                const t = [...loadingToasts].pop();
                loadingLayer.querySelector('.wm-msgbox-title span').textContent = (statusToasts.get(t) || {}).title || 'Please Wait';
                const title = ((t.querySelector('.toast-title') || {}).textContent || '').trim();
                const msg = ((t.querySelector('.toast-message') || {}).textContent || '').replace(/\s+/g, ' ').trim();
                loadingLayer.querySelector('.wm-msgbox-text').textContent = [title, msg].filter(Boolean).join('\n') || 'Loading...';
            }, 90);
        }
    }

    /**
     * Dreamscape Mainframe Server as a Melaton Mobile message box: the desktop window's
     * (mainframeServerWindow.js) wording and its building-blocks icon on the left, drawn as a
     * 32 px well, with WM's progress bar. websocket.js _updatePreStartupStageProgress drives it
     * while the server boots; the Connection box stays down under it. null percent = hide.
     */
    let mainframeLayer = null;
    let mainframeIcon = null;
    function mainframeBox(percent, stageMessage) {
        if (!shell) return;
        if (percent == null || !Number.isFinite(Number(percent))) {
            if (mainframeIcon) mainframeIcon.stop();
            if (mainframeLayer) mainframeLayer.hidden = true;
            shell.classList.remove('wm-mainframe-up');
            return;
        }
        if (!mainframeLayer) {
            mainframeLayer = document.createElement('div');
            mainframeLayer.className = 'wm-msgbox-layer wm-mainframe-layer';
            mainframeLayer.hidden = true;
            mainframeLayer.innerHTML = '<div class="wm-msgbox" role="alertdialog" aria-busy="true"><div class="wm-msgbox-title"><span>Dreamscape Mainframe Server</span></div>'
                + '<div class="wm-msgbox-body"><canvas class="wm-mainframe-blocks" aria-hidden="true"></canvas><div class="wm-msgbox-text">'
                + '<div class="wm-mainframe-heading">The domain controller is starting.</div>'
                + '<div>Logons are held until the directory is ready.</div>'
                + '<div class="wm-mainframe-stage"></div>'
                + '<div class="wm-mainframe-meter" role="progressbar" aria-valuemin="0" aria-valuemax="100"><div></div></div>'
                + '</div></div></div>';
            shell.appendChild(mainframeLayer);
            const blocks = window.mainframeServerWindow && window.mainframeServerWindow.createBlocksIcon;
            if (blocks) mainframeIcon = blocks(mainframeLayer.querySelector('canvas'), { cell: 3 });
        }
        const pct = Math.max(0, Math.min(100, Math.round(Number(percent) || 0)));
        const stage = String(stageMessage || '').replace(/\s*\(\d+%\)\s*$/, '');
        mainframeLayer.querySelector('.wm-mainframe-stage').textContent = stage ? `${stage} (${pct}%)` : `${pct}%`;
        mainframeLayer.querySelector('.wm-mainframe-meter > div').style.width = `${pct}%`;
        mainframeLayer.querySelector('.wm-mainframe-meter').setAttribute('aria-valuenow', String(pct));
        if (mainframeLayer.hidden) {
            mainframeLayer.hidden = false;
            shell.classList.add('wm-mainframe-up');
        }
        if (mainframeIcon && !mainframeIcon.running) mainframeIcon.start();
    }

    /**
     * A command or an app that needs the server while it cannot be reached (websocket.js
     * _mobileDomainUnreachable): WM's error box with Retry and Abort, titled by the app in front.
     * Resolves 'retry' or 'abort'.
     */
    let dcBoxClose = null;
    function domainUnreachable() {
        return messageBox({
            title: 'Domain Controller',
            text: 'The Domain Controller is unreachable.',
            icon: 'error',
            buttons: [{ text: 'Retry', value: 'retry', default: true }, { text: 'Abort', value: 'abort' }],
            cancelValue: 'abort',
            modal: true,
            // the title bar's X is Abort; the connection coming back closes it (closeDomainUnreachable)
            titleAction: { kind: 'close', value: 'abort' },
            onOpen: (close) => { dcBoxClose = close; }
        }).finally(() => { dcBoxClose = null; });
    }
    function closeDomainUnreachable(value) {
        if (!dcBoxClose) return false;
        dcBoxClose(value);
        return true;
    }

    /**
     * Progress box (Yozora #806, Yukimi Nov 13 2026): work the user just started on the phone (a
     * print, Recast, Upscale, Expand Canvas, a save to the phone ...) is a WM box over the screen
     * with its title, a status line, the streaming preview when the work sends one, WM's block
     * progress bar (marquee while the amount is unknown) and the title bar's default button in the
     * corner: X stops the work when it can be stopped (no Cancel button; a Hide button then sits at
     * the right), ok otherwise puts the box away. It closes itself when the work ends. Its own layer under the message box layer, so
     * an error or a question still comes up over it; several at once show the newest, the next one
     * comes up when it closes. Hide keeps the work running without its box.
     *   progressBox({ title, text, pct, preview, onCancel })
     *     -> { update({ title, text, pct, preview }), setCancel(fn), close(), get open }
     * pct null = marquee; preview = a URL, data: URL or raw base64 PNG ('' clears it).
     */
    let progressLayer = null;
    const progressBoxes = []; // newest last
    function progressBox(opts = {}) {
        if (!shell) return null;
        const box = {
            title: String(opts.title || 'Please Wait'),
            text: String(opts.text || ''),
            pct: opts.pct == null ? null : Number(opts.pct),
            preview: opts.preview || '',
            onCancel: typeof opts.onCancel === 'function' ? opts.onCancel : null,
            cancelling: false,
            hidden: false,
            closed: false
        };
        const handle = {
            update(o = {}) {
                if (box.closed) return;
                if (o.title != null && o.title !== '') box.title = String(o.title);
                if (o.text != null && !box.cancelling) box.text = String(o.text);
                if (o.pct !== undefined) box.pct = o.pct == null || !Number.isFinite(Number(o.pct)) ? null : Number(o.pct);
                if (o.preview !== undefined) box.preview = o.preview || '';
                if (progressTop() === box) paintProgress(o.preview !== undefined);
            },
            setCancel(fn) {
                box.onCancel = typeof fn === 'function' ? fn : null;
                if (progressTop() === box) paintProgress(false, true);
            },
            close() {
                if (box.closed) return;
                box.closed = true;
                const i = progressBoxes.indexOf(box);
                if (i >= 0) progressBoxes.splice(i, 1);
                showProgressTop();
            },
            get open() { return !box.closed; }
        };
        progressBoxes.push(box);
        showProgressTop();
        return handle;
    }

    const progressTop = () => {
        for (let i = progressBoxes.length - 1; i >= 0; i--) if (!progressBoxes[i].hidden) return progressBoxes[i];
        return null;
    };

    let progressShown = null; // the box drawn in the layer
    function showProgressTop() {
        const top = progressTop();
        if (!top) {
            progressShown = null;
            if (progressLayer) {
                progressLayer.hidden = true;
                const img = progressLayer.querySelector('.wm-progress-preview');
                // a streamed frame is a large data: URL; let it go
                if (img) { img.removeAttribute('src'); img.hidden = true; }
            }
            return;
        }
        if (!progressLayer) {
            progressLayer = document.createElement('div');
            progressLayer.className = 'wm-msgbox-layer wm-progress-layer';
            progressLayer.hidden = true;
            progressLayer.innerHTML = '<div class="wm-msgbox" role="alertdialog" aria-busy="true"><div class="wm-msgbox-title"><span></span><button type="button" class="wm-title-action" data-kind="ok" aria-label="OK"></button></div>'
                + '<div class="wm-msgbox-body"><div class="wm-msgbox-text">'
                + '<div class="wm-progress-text"></div>'
                + '<img class="wm-progress-preview" alt="" hidden>'
                + '<div class="wm-progress-bar" role="progressbar" aria-valuemin="0" aria-valuemax="100"><span></span></div>'
                + '</div></div><div class="wm-msgbox-buttons"></div></div>';
            shell.appendChild(progressLayer);
            // the corner's default button (Yukimi, Nov 13): X stops the work when it can be stopped
            // (in place of a Cancel button), ok otherwise puts the box away while the work goes on
            progressLayer.querySelector('.wm-title-action').addEventListener('click', () => {
                const box = progressShown;
                if (!box) return;
                if (box.onCancel) cancelProgress(box);
                else hideProgress(box);
            });
        }
        const fresh = progressShown !== top;
        progressShown = top;
        const wasHidden = progressLayer.hidden;
        // shown first: the bar's blocks are counted from its laid-out width
        progressLayer.hidden = false;
        paintProgress(true, true);
        if (wasHidden) {
            if (fresh) {
                const painted = progressLayer.querySelector('.wm-msgbox');
                painted.dataset.wmPaint = 'first';
                setTimeout(() => { delete painted.dataset.wmPaint; }, STAGE_TICK);
            }
        }
    }

    function paintProgress(withPreview, withButtons) {
        const box = progressShown;
        if (!box || !progressLayer) return;
        progressLayer.querySelector('.wm-msgbox-title span').textContent = box.title;
        progressLayer.querySelector('.wm-progress-text').textContent = box.text;
        const bar = progressLayer.querySelector('.wm-progress-bar');
        const marquee = box.pct == null;
        bar.classList.toggle('is-marquee', marquee);
        if (marquee) {
            bar.removeAttribute('aria-valuenow');
            bar.style.removeProperty('--wm-pb-blocks');
        } else {
            const pct = Math.max(0, Math.min(100, box.pct));
            // whole 7 px blocks with 2 px gaps, as many as the bar's width holds at this percent
            const inner = Math.max(0, bar.clientWidth - 2);
            const unit = 9 * (parseFloat(getComputedStyle(shell).getPropertyValue('--wm-px')) || 1);
            const fit = Math.max(1, Math.floor((inner + 2 * (unit / 9)) / unit));
            bar.style.setProperty('--wm-pb-blocks', String(Math.round(pct / 100 * fit)));
            bar.setAttribute('aria-valuenow', String(Math.round(pct)));
        }
        if (withPreview) {
            const img = progressLayer.querySelector('.wm-progress-preview');
            const src = previewSrc(box.preview);
            if (!src) { img.removeAttribute('src'); img.hidden = true; } else if (img.getAttribute('src') !== src) { img.src = src; img.hidden = false; }
        }
        if (withButtons) {
            const corner = progressLayer.querySelector('.wm-title-action');
            const stop = !!box.onCancel;
            corner.dataset.kind = stop ? 'close' : 'ok';
            corner.setAttribute('aria-label', stop ? 'Cancel' : 'OK');
            corner.disabled = !!box.cancelling;
            // work that can be stopped keeps Hide (the corner's X cancels it); otherwise the corner's
            // ok is the only button
            const row = progressLayer.querySelector('.wm-msgbox-buttons');
            row.textContent = '';
            row.hidden = !stop;
            if (stop) {
                const b = document.createElement('button');
                b.type = 'button';
                b.textContent = 'Hide';
                b.addEventListener('click', () => hideProgress(box));
                row.appendChild(b);
            }
        }
    }

    /**
     * A preview as an img src: a URL or data: URL as it is, raw base64 typed by its first bytes.
     * Raw JPEG base64 starts with '/9j/': read as a path it loaded http://host/9j/4AAQ... and the
     * box showed only the image's border, a line across the middle (#825).
     */
    function previewSrc(v) {
        const s = v ? String(v) : '';
        if (!s) return '';
        if (/^(data:|blob:|https?:\/\/)/.test(s)) return s;
        const raw = s.length > 64 && /^[A-Za-z0-9+/]+={0,2}$/.test(s.slice(0, 4096).replace(/\s+/g, '')) && !/^\/(images|previews|cache|static_images|fs|api)\//.test(s);
        if (!raw) return s;
        const type = s.startsWith('/9j/') ? 'jpeg' : s.startsWith('UklGR') ? 'webp' : s.startsWith('R0lGOD') ? 'gif' : 'png';
        return `data:image/${type};base64,${s}`;
    }

    function hideProgress(box) {
        box.hidden = true;
        showProgressTop();
    }

    function cancelProgress(box) {
        if (box.cancelling || !box.onCancel) return;
        box.cancelling = true;
        box.text = 'Canceling...';
        if (progressShown === box) paintProgress(false, true);
        try { box.onCancel(); } catch (err) { console.warn('[wmShell] progress cancel', err); }
    }

    /**
     * Saves to the phone (#806): a same-origin <a download> (the gallery's Download, the viewer's
     * Save, Slim / Optimized ...) is fetched here with a Downloading box (bytes so far, Cancel) and
     * then handed to the phone as a blob: DSApp saves blob: downloads itself (performBlobDownload),
     * a browser saves it as any download. Anything else (blob:, data:, another site) goes as it was.
     */
    const nativeAnchorClick = HTMLAnchorElement.prototype.click;
    function phoneSaveTarget(a) {
        if (!a || !a.hasAttribute || !a.hasAttribute('download') || a.dataset.wmNativeDownload === '1') return null;
        let u;
        try { u = new URL(a.href, location.href); } catch (_) { return null; }
        if (u.origin !== location.origin || !/^https?:$/.test(u.protocol)) return null;
        const name = a.getAttribute('download') || decodeURIComponent(u.pathname.split('/').pop() || '') || 'download';
        return { url: u.href, name };
    }

    const fmtBytes = (n) => {
        if (!(n >= 0)) return '';
        if (n < 1024) return `${n} bytes`;
        if (n < 1024 * 1024) return `${(n / 1024).toFixed(n < 10240 ? 1 : 0)} KB`;
        return `${(n / 1048576).toFixed(n < 10485760 ? 2 : 1)} MB`;
    };

    async function saveToPhone(url, name) {
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const box = progressBox({ title: 'Downloading', text: name, pct: null, onCancel: ctl ? () => ctl.abort() : null });
        try {
            const res = await fetch(url, { credentials: 'same-origin', signal: ctl ? ctl.signal : undefined });
            if (!res.ok) throw new Error(`The server answered ${res.status}.`);
            const total = Number(res.headers.get('content-length')) || 0;
            const type = res.headers.get('content-type') || 'application/octet-stream';
            let blob;
            if (res.body && typeof res.body.getReader === 'function') {
                const reader = res.body.getReader();
                const parts = [];
                let got = 0;
                let paintedAt = 0;
                for (;;) {
                    const { done, value } = await reader.read();
                    if (done) break;
                    parts.push(value);
                    got += value.byteLength;
                    const now = performance.now();
                    if (box && now - paintedAt > 120) {
                        paintedAt = now;
                        box.update({ text: `${name}\n${total ? `${fmtBytes(got)} of ${fmtBytes(total)}` : fmtBytes(got)}`, pct: total ? (got / total) * 100 : null });
                    }
                }
                blob = new Blob(parts, { type });
            } else {
                blob = await res.blob();
            }
            if (box) box.update({ text: `${name}\n${fmtBytes(blob.size)}`, pct: 100 });
            const href = URL.createObjectURL(blob);
            const a = document.createElement('a');
            a.href = href;
            a.download = name;
            a.dataset.wmNativeDownload = '1';
            document.body.appendChild(a);
            nativeAnchorClick.call(a);
            a.remove();
            // DSApp reads the blob back from the page a moment later: keep it alive for that
            setTimeout(() => URL.revokeObjectURL(href), 120000);
        } catch (err) {
            if (box) box.close();
            if (err && err.name === 'AbortError') return;
            console.warn('[wmShell] save to phone', err);
            messageBox({ title: 'Download', icon: 'error', text: `Cannot download '${name}'. ${(err && err.message) || ''}`.trim(), modal: true });
            return;
        }
        if (box) box.close();
    }

    if (window.uiShell === 'mobile' || document.documentElement.classList.contains('ui-mobile')) {
        HTMLAnchorElement.prototype.click = function wmSaveClick() {
            const t = phoneSaveTarget(this);
            if (t) { saveToPhone(t.url, t.name); return; }
            return nativeAnchorClick.call(this);
        };
        document.addEventListener('click', (e) => {
            if (e.defaultPrevented || e.button !== 0) return;
            const a = e.target && e.target.closest ? e.target.closest('a[download]') : null;
            const t = phoneSaveTarget(a);
            if (!t) return;
            e.preventDefault();
            saveToPhone(t.url, t.name);
        }, true);
    }

    function hideLoadingBox() {
        clearInterval(loadingTimer);
        loadingTimer = null;
        if (loadingLayer) loadingLayer.hidden = true;
    }

    function toastsToDialogs() {
        const box = document.getElementById('toastContainer');
        if (!box) return;
        for (const t of [...box.children].reverse()) {
            if (!t.id || toastSeen.has(t) || t.classList.contains('removing')) continue;
            // during the boot screens a toast waits: it is sorted when Today comes up (still the loading phase)
            if (!notesMayPop()) continue;
            toastSeen.add(t);
            // the service worker's update toasts are the update icon's (readToasts, UPDATE_TOAST): never a wait
            // cursor or a busy mark here, or the same toast's result ("Updates Complete") stays hidden for good
            {
                const ut = ((t.querySelector('.toast-title') || {}).textContent || '').trim();
                if (UPDATE_TOAST.test(ut) || UPDATE_QUIET.test(ut)) continue;
            }
            // connection status, and everything a workspace switch raises: the status box (above)
            {
                const ttl = ((t.querySelector('.toast-title') || {}).textContent || '').trim();
                const isStatus = STATUS_TOAST.test(ttl);
                const starting = bootDoneAt && Date.now() - bootDoneAt < 20000;
                // up and running, a dropped or restored connection is the connectivity icon and its
                // bubble, not a Connection box (Yukimi, Nov 13); a workspace switch keeps its box
                // (marked busy: readToasts must not turn it into a notification either)
                if (isStatus && bootDoneAt && !switchingWorkspace && !t.querySelector('.toast-buttons')) { t.dataset.wmBusy = '1'; continue; }
                if (!t.querySelector('.toast-buttons') && ((isStatus && !starting) || switchingWorkspace)) {
                    const txt = ((t.querySelector('.toast-message') || {}).textContent || '').replace(/\s+/g, ' ').trim();
                    t.dataset.wmBusy = '1';
                    loadingToasts.add(t);
                    statusToasts.set(t, { title: isStatus ? 'Connection' : 'Please Wait', doneAt: 0 });
                    // Teleport draws its own travel while the workspace loads
                    if (isStatus || current !== 'teleport') showLoadingBox([ttl, txt].filter(Boolean).join('\n'), isStatus ? 'Connection' : 'Please Wait');
                    continue;
                }
            }
            // starting up / switching workspace: loading is a Please Wait box
            if (loadingPhase() && !t.querySelector('.toast-buttons')) {
                const ttl = ((t.querySelector('.toast-title') || {}).textContent || '').trim();
                const txt = ((t.querySelector('.toast-message') || {}).textContent || '').replace(/\s+/g, ' ').trim();
                const loading = t.classList.contains('upload-progress') || !!t.querySelector('.toast-progress') || !t.querySelector('.toast-close')
                    || /^(loading|connecting|preparing|installing|downloading|syncing|refreshing|switching)\b|\.\.\.$|\u2026$/i.test(ttl || txt) || /loading/i.test(txt);
                if (loading) {
                    t.dataset.wmBusy = '1';
                    // starting up (the gallery and the rest) is short: the wait cursor alone, no box
                    // (Yukimi, Nov 10); a workspace switch keeps its Please Wait box
                    if (!switchingWorkspace) {
                        const release = busy(true, { delay: 0, timeout: 30000 });
                        const watch = setInterval(() => { if (!t.isConnected || t.classList.contains('removing')) { clearInterval(watch); release(); } }, 250);
                        continue;
                    }
                    loadingToasts.add(t);
                    // Teleport draws its own travel while the workspace loads
                    if (current !== 'teleport') showLoadingBox([ttl, txt].filter(Boolean).join('\n'));
                    continue;
                }
            }
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
        paintBezelLed();
        const live = new Set(notes.flatMap((n) => n.ids.map((id) => seenKey(id, n))));
        for (const k of [...noteSeen]) if (!live.has(k)) noteSeen.delete(k);
        soundNewNotes(live);
        if (!noteOf(noteShown)) noteShown = null;
        // the tray lists the bubble's notifications and the folded icons: with neither it closes (an update
        // notice alone is the update icon's, Yukimi Nov 14: it left an empty tray open)
        if (!notesForBubbleIcon().length && !statusFolded.length) noteTrayOpen = false;
        if (!noteShown && !noteTrayOpen && notesMayPop()) {
            // a class with Display message off stays in the title bar (seen, never popped)
            for (const n of notes) if (!noteDisplays(n)) n.ids.forEach((id) => noteSeen.add(seenKey(id, n)));
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
     * A notification sounds once as it arrives (SHNotificationAdd plays its class's Wave) and again
     * when a running one ends with its result; updates in between are silent. Its class (phone
     * sound event) comes from what it is: new mail, a print finished or failed, a reminder, an
     * error or warning (Program Error's settings), a connection, a message, else Other
     * notifications. A class with Repeat plays again every 4 s while its bubble stays up (4 more
     * times at most). Notices that came during startup or a takeover sound when they can show.
     */
    function noteEvent(n) {
        const t = String((n && n.title) || '');
        // an app's own notification may name its class (Dreamscape Messenger's replies: 'chat', text messages: 'sms')
        const own = n && appNotes.get(n.id);
        if (own && own.event && SND_EVENT.has(own.event)) return own.event;
        if (n.type === 'reminder') return 'reminder';
        if (/^(you have mail|new mail|new e-?mail)/i.test(t)) return 'mail';
        if (/^(generation|print|upscal\w*) (failed|error)/i.test(t)) return 'print-error';
        if (/^generation complete/i.test(t)) return 'print';
        if (n.type === 'error') return 'error';
        if (n.type === 'warning') return 'warning';
        if (/^(disconnected|connection lost|offline|reconnecting)/i.test(t)) return 'disconnect';
        if (/^(connected|reconnected|connection (restored|established))/i.test(t)) return 'connect';
        if (/\btext messages?\b/i.test(t)) return 'sms';
        if (/\b(new message|chat)\b/i.test(t)) return 'chat';
        return 'notification';
    }

    const noteSounded = new Set();
    let noteRepeat = null;
    function soundNewNotes(live) {
        for (const k of [...noteSounded]) if (!live.has(k)) noteSounded.delete(k);
        if (!notesMayPop()) return;
        let fresh = null;
        for (const n of notes) {
            const keys = n.ids.map((id) => seenKey(id, n));
            if (keys.every((k) => noteSounded.has(k))) continue;
            keys.forEach((k) => noteSounded.add(k));
            // an app's notice asked to come up without a sound (Android already alerted for it, #779)
            const own = appNotes.get(n.id);
            if (own && own.silent) continue;
            if (!fresh || n.type === 'error') fresh = n;
        }
        if (!fresh) return;
        const id = noteEvent(fresh);
        playSystemSound(id, id === 'error' ? { event: 'error' } : {});
        const p = eventPrefs(id);
        if (p && p.repeat && p.sound) {
            clearInterval(noteRepeat);
            let left = 4;
            const toastId = fresh.id;
            noteRepeat = setInterval(() => {
                const n = noteOf(toastId);
                if (!n || left-- <= 0 || noteShown !== toastId) { clearInterval(noteRepeat); noteRepeat = null; return; }
                // a repeat buzzes again where the event vibrates (Reminders: Repeat)
                playSystemSound(id, { again: true });
            }, 4000);
        }
    }

    /** Display message on screen off for its class: the notification waits in the title bar, no bubble. */
    function noteDisplays(n) {
        const p = eventPrefs(noteEvent(n));
        return !p || p.display;
    }

    function noteTitle(n) {
        return n.title || 'Dreamscape';
    }

    /**
     * The title bar / tray glyph for a notification: WM 6.1's white glyphs only (a reminder is
     * notify.dll's bell, anything else the speech bubble, shellres 4673), never a colour icon.
     */
    // the icon follows the notification's kind (Yukimi, Nov 10): an error or a warning shows WM-style
    // white glyphs of its own, a reminder the clock, anything else the speech bubble
    const NOTE_KIND_ICON = { error: 'status-error', warning: 'status-warning', reminder: 'status-reminder' };
    function noteIcon(n) {
        if (isUpdateNote(n)) return artImageSet('status-update');
        // an app's own notification (appNote) may bring its own glyph
        const own = n && appNotes.get(n.id);
        if (own && own.icon) return /^(url|image-set)\(/.test(own.icon) ? own.icon : artImageSet(own.icon);
        return artImageSet((n && NOTE_KIND_ICON[n.type]) || 'status-notify-many');
    }

    const STATUS_APP_LABEL = { mail: 'Messages', sms: 'Text Messages', chat: 'Dreamscape Messenger', prints: 'Prints', director: 'Director', update: 'Updates', wxalert: 'Weather Alert', rain: 'Rain Alarm', traffic: 'Traffic', continuity: 'Continuity', received: 'ActiveSync' };

    /** The bubble icon: pending notifications plus any status icons folded into it by fitStatus. */
    function paintNotifyIcon() {
        const icon = shell.querySelector('[data-role="notify"]');
        // update notices stand on the update icon, not here
        const notes = notesForBubbleIcon();
        const count = notes.length + statusFolded.length;
        icon.hidden = !count;
        // the most serious pending kind shows, also with several waiting
        const worst = notes.find((n) => n.type === 'error') || notes.find((n) => n.type === 'warning');
        if (count > 1 && worst) {
            delete icon.dataset.icon;
            icon.style.backgroundImage = noteIcon(worst);
            icon.setAttribute('aria-label', `${count} notifications, ${worst.type === 'error' ? 'an error' : 'a warning'} among them`);
        } else if (count > 1) {
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
    let noteKeyCount = -1;
    let messageNotesSig = '';
    function renderNotes() {
        // a mail / text / Messenger notification came or went: its class icon follows (refreshStatus
        // may draw the notes again; the unchanged signature ends it there)
        const sig = ['mail', 'sms', 'chat'].map((r) => messageNotes(r).length).join(',');
        if (sig !== messageNotesSig) { messageNotesSig = sig; refreshStatus(); }
        fitStatus();
        // Today's left soft key follows whether a notification is waiting
        if ((notes.length > 0) !== (noteKeyCount > 0) && current === 'today' && shell) { noteKeyCount = notes.length; renderSoftKeys(); } else noteKeyCount = notes.length;
        // the tray's only entries may have unfolded (a print ended, the bar got wider): close it
        // the tray lists the bubble's notifications and the folded icons: with neither it closes (an update
        // notice alone is the update icon's, Yukimi Nov 14: it left an empty tray open)
        if (!notesForBubbleIcon().length && !statusFolded.length) noteTrayOpen = false;
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
            for (const n of notesForBubbleIcon()) add(noteIcon(n), noteTitle(n), () => showNote(n.id));
            for (const r of statusFolded) {
                add(artImageSet(STATUS_APP_ICONS[r]), STATUS_APP_LABEL[r], () => {
                    noteTrayOpen = false;
                    renderNotes();
                    // as its own icon would: mail / text / Messenger open their waiting notification
                    if (!messageIconTap(r)) statusBubble(r, shell.querySelector('[data-role="notify"]'));
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
            root.removeAttribute('data-wm-note');
            return;
        }
        // a notification on screen: the soft key bar is black (WM 6.1, Yukimi Nov 14; wm-shell.css)
        root.setAttribute('data-wm-note', '');
        const at = notes.indexOf(n);
        const snap = `${n.id}\u0001${at}/${notes.length}\u0001${n.toast.innerHTML}`;
        const cameUp = el.hidden;
        el.hidden = false;
        if (snap === noteSnapshot) { if (cameUp) noteZoom(el); return; }
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
        if (cameUp) noteZoom(el);
    }

    /**
     * 6.1: a notification bubble opens with the device's zoom rectangle (recording nb): an outline
     * of one device pixel in the highlight green grows from the title bar's icon to the bubble's
     * place in eight even steps (~65 ms each on the emulator, a stage tick here), then the frame
     * with its title band, the body one tick later. 6.5 was not captured: it opens at once.
     */
    let noteZoomTimers = [];
    function noteZoom(el) {
        noteZoomTimers.forEach(clearTimeout);
        noteZoomTimers = [];
        shell.querySelectorAll(':scope > .wm-zoom-rect').forEach((x) => x.remove());
        delete el.dataset.wmPaint;
        if (WM65) return;
        const icon = shell.querySelector('.wm-status-icon[data-role="notify"]');
        const sr = shell.getBoundingClientRect();
        const to = el.getBoundingClientRect();
        const ir = icon && icon.getClientRects().length ? icon.getBoundingClientRect() : null;
        if (!to.width || !to.height) return;
        const fx = ir ? ir.left + ir.width / 2 : sr.left + sr.width / 2;
        const fy = ir ? ir.bottom : sr.top;
        const rect = document.createElement('div');
        rect.className = 'wm-zoom-rect';
        rect.setAttribute('aria-hidden', 'true');
        el.dataset.wmPaint = 'zoom';
        const place = (i) => {
            const k = i / 8;
            rect.style.left = `${fx + (to.left - fx) * k - sr.left}px`;
            rect.style.top = `${fy + (to.top - fy) * k - sr.top}px`;
            rect.style.width = `${to.width * k}px`;
            rect.style.height = `${to.height * k}px`;
        };
        place(1);
        shell.appendChild(rect);
        const at = (i, fn) => noteZoomTimers.push(setTimeout(fn, i * STAGE_TICK));
        for (let i = 2; i <= 8; i++) at(i - 1, () => place(i));
        at(8, () => { rect.remove(); el.dataset.wmPaint = 'frame'; });
        at(9, () => { delete el.dataset.wmPaint; });
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
        // an app's own notification (appNote) may bring its own soft keys
        const own = n && appNotes.get(n.id);
        if (own && own.softKeys) {
            const keys = typeof own.softKeys === 'function' ? own.softKeys() : own.softKeys;
            if (keys) return { left: keys.left || null, right: keys.right || null };
        }
        // progress toasts have no close button: they end on their own
        const closable = !!(n && n.toast.querySelector('.toast-close'));
        return {
            left: { label: 'Hide', action: hideNote },
            right: closable ? { label: 'Dismiss', action: () => dismissNote(n) } : null
        };
    }

    /**
     * An app's own notification (File Explorer's Receive, #748): a WM notification like notify()'s,
     * but one the app keeps and changes while its work runs. It is always a notification (a
     * progress toast raised within moments of a tap would otherwise become the wait cursor), with
     * its own soft keys and its own title bar glyph:
     *   appNote({ title, html, progress, detail, icon, softKeys, event, silent })
     *     -> { id, update({ title, html, progress, detail, icon, softKeys }), show(), hide(), shown(), close() } | null
     * html is the body and detail the lines under the bar (markup: escape names); progress 0-100
     * draws the progress bar between them (null: no bar, and the note cannot get one later); icon
     * is the glyph in the title bar and the tray (an art name, or CSS url() / image-set(); the speech bubble
     * without one); softKeys is { left, right } of { label, action } like an app's, or a function
     * giving them (Hide / Dismiss without). event names its sound class (SND_EVENTS); silent
     * brings it up without that sound. The note stays until the app closes it: hide() is
     * the Hide soft key (the bubble goes, the glyph stays), show() brings the bubble back.
     */
    const appNotes = new Map(); // toast id -> { icon, softKeys }
    function appNote(opts = {}) {
        if (typeof window.showGlassToast !== 'function') return null;
        const st = { icon: opts.icon || null, softKeys: opts.softKeys || null, event: opts.event || null, silent: !!opts.silent };
        const bar = opts.progress != null && opts.progress !== false;
        let id = null;
        try {
            id = window.showGlassToast('info', escapeHtml(opts.title || 'Melaton Mobile'), opts.html || '&nbsp;', bar, false);
        } catch (err) { console.warn('[wmShell] appNote', err); }
        const el = id ? document.getElementById(id) : null;
        if (!el) return null;
        // asked for as a notification: never sorted into the wait cursor or a message box
        toastSeen.add(el);
        appNotes.set(id, st);
        const detail = document.createElement('div');
        detail.className = 'toast-detail';
        if (opts.detail) detail.innerHTML = opts.detail;
        el.querySelector('.toast-content').appendChild(detail);
        const live = () => el.isConnected && !el.classList.contains('removing');
        const mine = () => { const n = noteOf(id); return !!n && noteShownNote() === n; };
        const setBar = (v) => { if (bar && typeof window.updateGlassToastProgress === 'function') window.updateGlassToastProgress(id, Math.max(0, Math.min(100, Number(v) || 0))); };
        setBar(opts.progress);
        queueNotes();
        return {
            id,
            update(o = {}) {
                if (!live()) return;
                if (o.title != null) { const t = el.querySelector('.toast-title'); if (t && t.textContent !== String(o.title)) t.textContent = o.title; }
                if (o.html != null) { const m = el.querySelector('.toast-message'); if (m && m.innerHTML !== o.html) m.innerHTML = o.html; }
                if (o.detail != null && detail.innerHTML !== o.detail) detail.innerHTML = o.detail;
                if (o.progress != null) setBar(o.progress);
                if (o.icon !== undefined) st.icon = o.icon || null;
                if (o.softKeys !== undefined) { st.softKeys = o.softKeys || null; if (mine()) renderSoftKeys(); }
                queueNotes();
            },
            show() { if (live()) showNote(id); },
            hide() { if (mine()) hideNote(); },
            shown: () => live() && mine(),
            close() {
                const up = mine();
                appNotes.delete(id);
                if (typeof window.removeGlassToast === 'function') window.removeGlassToast(id);
                if (up) noteShown = null;
                refreshNotes();
            }
        };
    }

    /** The title bar icon: hides an open bubble; one notification comes back, several open the tray. */
    /** The mail / text / Messenger icon with notifications of its class waiting: the newest one opens (a second tap closes it). */
    function messageIconTap(role) {
        if (!MESSAGE_CLASS[role]) return false;
        const mine = messageNotes(role);
        if (!mine.length) return false;
        closeMenus(true);
        const shown = noteShownNote();
        if (shown && messageClassOf(shown) === role) { hideNote(); return true; }
        closeBubble();
        showNote(mine[mine.length - 1].id);
        return true;
    }

    function noteIconTap() {
        closeMenus(true);
        // the speech bubble's own notifications (update notices are the update icon's)
        const mine = notesForBubbleIcon();
        const bub = shell.querySelector('.wm-bubble');
        if (!mine.length && statusFolded.length === 1 && !bub.hidden && bub.dataset.role === statusFolded[0]) { closeBubble(); return; }
        closeBubble();
        if (noteShownNote()) {
            notes.forEach((n) => n.ids.forEach((id) => noteSeen.add(seenKey(id, n))));
            hideNote();
            return;
        }
        if (mine.length === 1 && !statusFolded.length) { showNote(mine[0].id); return; }
        if (!mine.length && statusFolded.length === 1) { statusBubble(statusFolded[0], shell.querySelector('[data-role="notify"]')); return; }
        // nothing for the tray: an update notice is the update icon's popup; else WM's box
        if (!mine.length && !statusFolded.length) {
            noteTrayOpen = false;
            renderNotes();
            const up = shell.querySelector('.wm-status-icon[data-role="update"]');
            if (notes.some(isUpdateNote) && up) statusBubble('update', up);
            else messageBox({ title: 'Notifications', icon: 'info', text: 'There are no notifications.' });
            return;
        }
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

    // ---------------------------------------------------------------- volume

    /*
     * The volume bubble (WM 6.1, the speaker icon on the emulator): a callout under the icon, two
     * 6-step trackbars and On / Vibrate / Off. Left (the device icon, WM's System) is the media
     * level: tabVolume's master, every page sound and video. Right (the handset, WM's Ringer) is
     * notifications and system sounds: the WM sound events, past the media level (wmRingerLevel
     * 0-5). Off is tabVolume's mute (everything); Vibrate (wmSoundMode) silences the WM sounds and
     * buzzes notifications instead, media still plays. Phone only: the desktop keeps its flyout.
     */
    const VOL_STEPS = 5;
    const RINGER_KEY = 'wmRingerLevel';
    const MODE_KEY = 'wmSoundMode';

    function ringerLevel() {
        try {
            const raw = localStorage.getItem(RINGER_KEY);
            const n = raw == null || raw === '' ? VOL_STEPS : Number(raw);
            return Number.isFinite(n) ? Math.max(0, Math.min(VOL_STEPS, Math.round(n))) : VOL_STEPS;
        } catch (_) { return VOL_STEPS; }
    }

    function setRingerLevel(n) {
        try { localStorage.setItem(RINGER_KEY, String(Math.max(0, Math.min(VOL_STEPS, Math.round(n))))); } catch (_) { /* storage off */ }
    }

    function mediaLevel() {
        const tv = window.tabVolume;
        const v = tv && typeof tv.getLevel === 'function' ? Number(tv.getLevel()) : 100;
        return Math.max(0, Math.min(VOL_STEPS, Math.round((Number.isFinite(v) ? v : 100) / (100 / VOL_STEPS))));
    }

    function setMediaLevel(n) {
        const tv = window.tabVolume;
        if (tv && typeof tv.setLevel === 'function') tv.setLevel(Math.round(n * (100 / VOL_STEPS)), { keepMute: true });
    }

    /** 'on' | 'vibrate' | 'off' */
    function soundMode() {
        try {
            const tv = window.tabVolume;
            if (tv && typeof tv.isMuted === 'function' && tv.isMuted()) return 'off';
            return localStorage.getItem(MODE_KEY) === 'vibrate' ? 'vibrate' : 'on';
        } catch (_) { return 'on'; }
    }

    function setSoundMode(mode) {
        const tv = window.tabVolume;
        if (tv && typeof tv.setMuted === 'function' && tv.isMuted() !== (mode === 'off')) tv.setMuted(mode === 'off');
        try {
            if (mode === 'vibrate') localStorage.setItem(MODE_KEY, 'vibrate');
            else localStorage.removeItem(MODE_KEY);
        } catch (_) { /* storage off */ }
        if (mode === 'vibrate') vibrate('mode');
    }

    let volumeFocus = 'media';

    function closeVolume() {
        const el = shell && shell.querySelector('.wm-volume');
        if (el && !el.hidden) { el.hidden = true; el.replaceChildren(); }
    }

    function toggleVolume(anchor) {
        const el = shell.querySelector('.wm-volume');
        if (!el.hidden) { closeVolume(); return; }
        closeBubble();
        closeMenus(true);
        volumeFocus = 'media';
        const col = (kind, icon, label) => `<div class="wm-vol-col" data-kind="${kind}">${imgTag(icon)}`
            + `<div class="wm-vol-trackbar" role="slider" tabindex="0" aria-label="${label}" aria-orientation="vertical" aria-valuemin="0" aria-valuemax="${VOL_STEPS}">`
            + '<span class="wm-vol-track"></span>'
            + Array.from({ length: VOL_STEPS + 1 }, (_, i) => `<span class="wm-vol-tick" style="--i:${i}"></span>`).join('')
            + '<span class="wm-vol-thumb"></span></div></div>';
        const radio = (v, t) => `<label class="wm-vol-mode"><input type="radio" name="wmvolmode" value="${v}"><span>${t}</span></label>`;
        el.innerHTML = '<span class="wm-volume-tail" aria-hidden="true"></span><div class="wm-volume-title">Volume</div>'
            + `<div class="wm-vol-sliders">${col('media', 'volume-system', 'Media')}${col('ringer', 'volume-ringer', 'Notifications and system sounds')}</div>`
            + `<div class="wm-vol-modes">${radio('on', 'On')}${radio('vibrate', 'Vibrate')}${radio('off', 'Off')}</div>`;
        el.hidden = false;
        const paint = () => {
            el.querySelectorAll('.wm-vol-col').forEach((c) => {
                const v = c.dataset.kind === 'media' ? mediaLevel() : ringerLevel();
                c.style.setProperty('--v', String(v));
                const bar = c.querySelector('.wm-vol-trackbar');
                bar.setAttribute('aria-valuenow', String(v));
                c.classList.toggle('is-focus', c.dataset.kind === volumeFocus);
            });
            const mode = soundMode();
            el.querySelectorAll('input[name="wmvolmode"]').forEach((r) => { r.checked = r.value === mode; });
        };
        const set = (kind, v) => {
            v = Math.max(0, Math.min(VOL_STEPS, v));
            if (kind === 'media') setMediaLevel(v); else setRingerLevel(v);
            paint();
            refreshStatus();
        };
        el.querySelectorAll('.wm-vol-col').forEach((c) => {
            const kind = c.dataset.kind;
            const bar = c.querySelector('.wm-vol-trackbar');
            const fromY = (y) => {
                const t = c.querySelector('.wm-vol-tick[style="--i:0"]').getBoundingClientRect();
                const b = c.querySelector(`.wm-vol-tick[style="--i:${VOL_STEPS}"]`).getBoundingClientRect();
                const top = t.top + t.height / 2;
                const bottom = b.top + b.height / 2;
                return Math.round(((bottom - y) / Math.max(1, bottom - top)) * VOL_STEPS);
            };
            c.addEventListener('pointerdown', (e) => {
                e.preventDefault();
                volumeFocus = kind;
                bar.focus({ preventScroll: true });
                set(kind, fromY(e.clientY));
                try { c.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
            });
            c.addEventListener('pointermove', (e) => { if (c.hasPointerCapture && c.hasPointerCapture(e.pointerId)) set(kind, fromY(e.clientY)); });
            bar.addEventListener('focus', () => { volumeFocus = kind; paint(); });
            bar.addEventListener('keydown', (e) => {
                const cur = kind === 'media' ? mediaLevel() : ringerLevel();
                if (e.key === 'ArrowUp' || e.key === 'ArrowRight') set(kind, cur + 1);
                else if (e.key === 'ArrowDown' || e.key === 'ArrowLeft') set(kind, cur - 1);
                else return;
                e.preventDefault();
                e.stopPropagation();
            });
        });
        el.querySelectorAll('input[name="wmvolmode"]').forEach((r) => r.addEventListener('change', () => { setSoundMode(r.value); paint(); refreshStatus(); }));
        el.addEventListener('click', (e) => e.stopPropagation());
        paint();
        // under the title bar, the tail's tip at the icon; kept on screen
        const sr = shell.getBoundingClientRect();
        const bar = shell.querySelector('.wm-titlebar').getBoundingClientRect();
        const ar = (anchor || shell.querySelector('[data-role="volume"]')).getBoundingClientRect();
        const px = parseFloat(getComputedStyle(el).getPropertyValue('--wm-px')) || 1;
        const tip = ar.left + ar.width / 2 - sr.left;
        const w = el.offsetWidth;
        const left = Math.max(4.5 * px, Math.min(sr.width - 4.5 * px - w, tip - 43.5 * px));
        el.style.left = `${Math.round(left)}px`;
        el.style.top = `${Math.round(bar.bottom - sr.top + 12.5 * px)}px`;
        el.style.setProperty('--wm-tip', `${Math.round(tip - left)}px`);
    }

    /** The bubble for a title-bar status icon; update=true repaints an open one in place. */
    /** Settings > Wireless Manager (wmSettingsConnections.js), as WM 6.1's bubble link opens it. */
    function openWirelessManager() {
        closeBubble();
        const ws = window.wmSettings;
        if (ws && typeof ws.open === 'function' && ws.open('wireless')) return;
        if (apps.has('settings')) open('settings');
    }

    /** Settings > Bluetooth (wmSettingsConnections.js, #771): the Bluetooth bubble's Settings link. */
    function openBluetoothSettings() {
        closeBubble();
        const ws = window.wmSettings;
        if (ws && typeof ws.open === 'function' && ws.open('bluetooth')) return;
        openWirelessManager();
    }

    /** Four signal bars for a bubble row (level 0-4; null = none). */
    function signalBars(lv) {
        if (lv == null) return '';
        return `<span class="wm-bars" role="img" aria-label="Signal ${lv} of 4">${[1, 2, 3, 4].map((n) => `<i class="${n <= lv ? 'is-on' : ''}"></i>`).join('')}</span>`;
    }

    // the Connectivity bubble's time connected ticks while the bubble is open (a local clock, no request)
    let vpnClockTimer = null;
    function vpnClock() {
        if (vpnClockTimer) return;
        vpnClockTimer = setInterval(() => {
            const b = shell && shell.querySelector('.wm-bubble');
            if (!b || b.hidden || b.dataset.role !== 'data' || document.hidden) { clearInterval(vpnClockTimer); vpnClockTimer = null; return; }
            const ws = window.wsClient;
            const since = ws && ws.connectionStats && ws.connectionStats.connectedAt;
            const el = b.querySelector('.wm-vpn-time');
            if (!el || !since) return;
            const secs = Math.max(0, Math.floor((Date.now() - since) / 1000));
            el.textContent = `${Math.floor(secs / 3600)}:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
        }, 1000);
    }

    function statusBubble(role, anchor, update) {
        if (role === 'volume') { if (!update) toggleVolume(anchor); return; }
        closeVolume();
        const el = shell.querySelector('.wm-bubble');
        // roaming opens the Phone bubble, so a second tap on it closes that bubble
        const r = role === 'roaming' || role === 'cell' ? 'signal' : role;
        if (!update && !el.hidden && el.dataset.role === r) { closeBubble(); return; }
        closeMenus(true);
        const ws = window.wsClient;
        if (role === 'data') {
            const connected = !!(ws && ws.isConnected && ws.isConnected());
            const rtt = ws && Array.isArray(ws.rttMeasurements) && ws.rttMeasurements.length ? Math.round(ws.rttMeasurements[ws.rttMeasurements.length - 1]) : null;
            const host = location.host;
            const dev = deviceView();
            const sections = [];
            const pe = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
            // Wi-Fi as Mobile Broadband (Yukimi, Nov 14): "Wi-Fi: <network / Connected / Disconnected /
            // Power Off>", its signal as bars (1-4) at the right
            const w = dev.wifi;
            if (w && (w.enabled != null || w.connected != null)) {
                const on = w.enabled !== false;
                const state = !on ? 'Power Off' : w.connected ? (dev.wifiName || 'Connected') : 'Disconnected';
                const lv = on && w.connected && Number.isFinite(w.level) ? Math.max(0, Math.min(4, Math.round(w.level))) : null;
                const barsHtml = signalBars(lv);
                sections.push({ html: `<div class="wm-bubble-pair"><span>Wi-Fi: ${pe(state)}</span>${barsHtml}</div>` });
            }
            // the mobile network as WM's Connection Manager names it (Yukimi, Nov 14): Connected while it
            // carries data, Disconnected with mobile data off, Suspended with no service, Available on
            // Wi-Fi; the radio type in bold and the signal bars at the right
            const c = dev.cell;
            if (c && c.present !== false) {
                const noService = c.radioOn === false || dev.airplane || c.simState === 'absent' || c.simState === 'locked' || c.searching === true || c.level === 0;
                const state = noService ? 'Suspended' : c.dataEnabled === false ? 'Disconnected' : dev.active === 'cellular' || c.dataActive ? 'Connected' : 'Available';
                const lv = noService || !Number.isFinite(c.level) ? null : Math.max(0, Math.min(4, Math.round(c.level)));
                // the radio's own type, also while Wi-Fi carries the data (dev.type is the active link's)
                const rt = dev.type || (typeof c.dataType === 'string' ? c.dataType : null);
                const right = `${!noService && rt ? `<b>${pe(typeName(rt))}</b>` : ''}${signalBars(lv)}`;
                sections.push({ html: `<div class="wm-bubble-pair"><span>Mobile Broadband: ${state}</span>${right ? `<span class="wm-bubble-right">${right}</span>` : ''}</div>` });
            }
            if (dev.link && dev.active !== 'wifi' && dev.active !== 'cellular') sections.push(`${dev.link.text}`);
            // the server still starting: no Mainframe Server box on the phone, this line instead (Yukimi, Nov 13)
            const dcBooting = !!(ws && ws.lastServerStartupStatus && ws.lastServerStartupStatus.isReady === false);
            // the Dreamscape link as one "VPN:" row like the Wi-Fi one, Reconnect at its right (Yukimi, Nov 13)
            // CafeReady: the Miniport carries the link and its cache answers (#815)
            let cafeReady = false;
            try { const mp = window.melatonContinuity && typeof window.melatonContinuity.miniport === 'function' ? window.melatonContinuity.miniport() : null; cafeReady = !!(mp && mp.up && mp.transport === 'miniport'); } catch (_) { cafeReady = false; }
            const vpn = connected
                ? 'Connected'
                : dcBooting ? 'Waiting for domain controller...'
                    : ws && ws.connectionPhase === 'auth' ? 'Logon required.'
                        : ws && (ws.isConnecting || ws.connectionPhase === 'dialing') ? 'Connecting...'
                            : `Not connected to ${host}.`;
            // connected: two lines (Yukimi, Nov 14) - "VPN: Connected (with CafeReady)" with the time
            // connected at the right, then "<host> - RTT: ## ms"
            if (connected) {
                const since = ws && ws.connectionStats && ws.connectionStats.connectedAt;
                const secs = since ? Math.max(0, Math.floor((Date.now() - since) / 1000)) : null;
                const dur = secs == null ? '' : `${Math.floor(secs / 3600)}:${String(Math.floor(secs / 60) % 60).padStart(2, '0')}:${String(secs % 60).padStart(2, '0')}`;
                const e = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
                sections.push({ html: `<div class="wm-bubble-pair"><span>VPN: Connected${cafeReady ? ' (with CafeReady)' : ''}</span><span class="wm-vpn-time">${e(dur)}</span></div><div>${e(host)}${rtt != null ? ` - RTT: ${rtt} ms` : ''}</div>` });
                vpnClock();
            } else {
                sections.push({ text: `VPN: ${vpn}`, links: [{ label: 'Reconnect', action: () => ws && ws.manualReconnect && ws.manualReconnect() }] });
            }
            // ActiveSync moving data (#822): what goes each way against this transfer's totals, a bar
            const asx = window.activeSync && typeof window.activeSync.transferProgress === 'function' ? window.activeSync.transferProgress() : null;
            const syncing = !!(asx && (asx.active || (asx.done && Date.now() - asx.at < 8000)));
            // not moving data: ActiveSync's row still says whether it is there (Yukimi, Nov 14)
            if (!syncing && window.activeSync && window.activeSync.kind === 'device') {
                const st = window.activeSync.state();
                const txt = !st.online ? 'Not connected' : st.session === 'partner' ? 'Connected (partnership)' : st.session === 'guest' ? 'Connected (guest)' : st.session === 'pending' ? 'Waiting for the computer' : 'Available';
                sections.push(`ActiveSync: ${txt}`);
            }
            if (syncing) {
                const size = (n) => { const v = Math.max(0, Number(n) || 0); return v < 1024 ? `${v} B` : v < 1048576 ? `${(v / 1024).toFixed(v < 10240 ? 1 : 0)} KB` : v < 1073741824 ? `${(v / 1048576).toFixed(1)} MB` : `${(v / 1073741824).toFixed(2)} GB`; };
                const up = asx.up || { total: 0, done: 0 };
                const down = asx.down || { total: 0, done: 0 };
                const total = up.total + down.total;
                const pct = total ? Math.min(100, Math.round(((up.done + down.done) / total) * 100)) : (asx.active ? 0 : 100);
                const files = asx.files > 1 ? ` ${Math.min(asx.files, asx.filesDone + (asx.active ? 1 : 0))} of ${asx.files} files.` : '';
                const lines = [`ActiveSync: ${asx.active ? 'Synchronizing...' : 'Complete.'}${files}`];
                if (up.total) lines.push(`Sent ${size(up.done)} of ${size(up.total)}.`);
                if (down.total) lines.push(`Received ${size(down.done)} of ${size(down.total)}.`);
                const esc = (t) => String(t).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
                sections.push({ html: `${lines.map((l) => `<div>${esc(l)}</div>`).join('')}<div class="wm-progress-bar wm-as-progress" role="progressbar" aria-valuemin="0" aria-valuemax="100" aria-valuenow="${pct}"><span style="width:calc(${pct} * (100% - 2 * var(--wm-px)) / 100)"></span></div>` });
            }
            // the install / update download the connecting icon also stands for
            const inst = swDownloading();
            if (inst != null) sections.push(`Installing Melaton Mobile... ${Math.round(inst)}%`);
            // WM 6.1's Connectivity bubble (shellres 5588-5635): Wireless Manager at the right, a rule,
            // the sessions, then Settings | Hide
            const connSettings = () => {
                const st = window.wmSettings;
                if (st && typeof st.open === 'function' && st.open('connections')) return;
                if (apps.has('settings')) open('settings');
            };
            bubble({
                title: 'Connectivity',
                role,
                anchor,
                sections: [{ links: [{ label: 'Wireless Manager', action: openWirelessManager }], align: 'right' }, { rule: true }, ...sections],
                footLinks: [{ label: 'Settings', action: connSettings }],
                buttons: [{ text: 'Hide' }]
            });
        } else if (role === 'signal' || role === 'roaming' || role === 'cell') {
            // WM 6.1's Phone bubble (captured on WM 6.1, Nov 10): the operator or the radio's state
            // (tshres 16458-16477 wording), the Wireless Manager link at the right, a rule, Settings | Hide
            const dev = deviceView();
            const c = dev.cell || {};
            const op = typeof c.operator === 'string' && c.operator ? c.operator : null;
            const lv = Number.isFinite(c.level) ? Math.max(0, Math.min(4, Math.round(c.level))) : null;
            let line;
            if (dev.airplane) line = 'Flight Mode';
            else if (c.radioOn === false) line = 'Phone off';
            else if (c.simState === 'absent') line = 'No SIM';
            else if (c.simState === 'locked') line = 'SIM Blocked';
            else if (c.searching === true) line = 'Searching...';
            else if (lv === 0 && !op) line = 'No Service';
            else line = op || 'No Service';
            if (line === op && c.roaming === true) line = `${op} (Roaming Service)`;
            const phoneSettings = () => {
                const dv = window.AndroidDevice;
                if (dv && typeof dv.openSettings === 'function') { try { dv.openSettings('phone'); return; } catch (_) { /* older app */ } }
                if (apps.has('settings')) open('settings');
            };
            bubble({
                title: 'Phone',
                role: 'signal',
                anchor: shell.querySelector('[data-role="signal"]:not([hidden])') || anchor,
                // the phone's own number in bold on the left of the second line (Yukimi, Nov 14)
                sections: [line, c.phoneNumber ? { text: String(c.phoneNumber), bold: true, links: [{ label: 'Wireless Manager', action: openWirelessManager }] } : { links: [{ label: 'Wireless Manager', action: openWirelessManager }], align: 'right' }],
                footLinks: [{ label: 'Settings', action: phoneSettings }],
                buttons: [{ text: 'Hide' }]
            });
        } else if (role === 'bluetooth') {
            const rd = radiosNow || readRadios() || {};
            const lines = [rd.bluetooth ? 'Bluetooth: On' : 'Bluetooth: Off'];
            if (rd.bluetooth && rd.bluetoothConnected === true) lines.push('A device is connected.');
            else if (rd.bluetooth && rd.bluetoothConnected === false) lines.push('No device is connected.');
            lines.push({ links: [{ label: 'Wireless Manager', action: openWirelessManager }] });
            bubble({ title: 'Bluetooth', role, anchor, sections: lines, footLinks: [{ label: 'Settings', action: openBluetoothSettings }], buttons: [{ text: 'Hide' }] });
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
        } else if (role === 'wxalert' || role === 'rain') {
            // Weather (#792): what the glyph stands for, and the way into the app
            const w = window.wmWeather;
            const st = w && typeof w.statusState === 'function' ? w.statusState() : null;
            const sections = [];
            if (role === 'wxalert') {
                (st ? st.alerts : []).slice(0, 4).forEach((a) => sections.push(`${a.place ? `${a.place}: ` : ''}${a.title}${a.until ? `, until ${a.until}` : ''}`));
                if (!sections.length) sections.push('No weather alerts.');
            } else {
                sections.push(st && st.rain ? st.rain.text : 'No rain expected in the next hour.');
            }
            const links = w ? [{ label: role === 'wxalert' ? 'View Alerts' : 'Open Weather', action: () => { closeBubble(); if (role === 'wxalert' && typeof w.showAlerts === 'function') w.showAlerts(); else w.open(); } }] : [];
            bubble({ title: STATUS_APP_LABEL[role], role, anchor, sections: links.length ? [...sections, { links }] : sections, buttons: [{ text: 'Hide' }] });
        } else if (role === 'received') {
            // ActiveSync Received Items (#803): "A link was received" / "3 items were received", Open
            const asx = window.activeSync;
            const items = asx && typeof asx.receivedItems === 'function' ? asx.receivedItems().filter((i) => !i.seen) : [];
            const WORD = { link: 'link', file: 'file', picture: 'picture', program: 'program', clipboard: 'clipboard item', note: 'notification', studio: 'Studio session' };
            const text = items.length === 1 ? `A ${WORD[items[0].kind] || 'item'} was received${items[0].from ? ` from ${items[0].from}` : ''}: ${items[0].title}` : `${items.length} items were received.`;
            const openIt = () => {
                closeBubble();
                if (window.wmActiveSync && typeof window.wmActiveSync.openReceived === 'function') window.wmActiveSync.openReceived();
                else open('activesync');
            };
            bubble({ title: 'ActiveSync', role, anchor, sections: [text, { links: [{ label: 'Open', action: openIt }] }], buttons: [{ text: 'Hide' }] });
        } else if (role === 'continuity') {
            // Continuity (#798): the Continuity PC - how it is attached, then its display and its dock's battery
            const mc = window.melatonContinuity;
            const pc = mc && typeof mc.continuityPc === 'function' ? mc.continuityPc() : null;
            const via = pc && pc.attach === 'wireless' ? 'Wi-Fi Direct' : 'USB-C';
            const lines = [];
            if (!pc) lines.push('The desktop on the connected display runs from this phone.');
            else if (pc.displayGone) lines.push('Disconnected. The desktop is still running.');
            else if (pc.state !== 'ready') lines.push(`Connecting via ${via}...`);
            else lines.push(`Connected via ${via}`);
            const res = pc && pc.width && pc.height ? `${pc.width} \u00d7 ${pc.height}` : '';
            // the dock's battery, when the dock reports one (pc.dockBattery: { level, charging })
            const bat = pc && pc.dockBattery && Number.isFinite(Number(pc.dockBattery.level)) ? pc.dockBattery : null;
            const batHtml = bat ? `<span class="wm-cty-bat">${imgTag(bat.charging ? 'status-battery-charging' : Number(bat.level) >= 80 ? 'status-battery-full' : Number(bat.level) >= 50 ? 'status-battery-3' : Number(bat.level) >= 25 ? 'status-battery-2' : 'status-battery-1')}<span>${Math.round(Number(bat.level))}%</span></span>` : '';
            const sections = [lines.join(' ')];
            if (res || batHtml) sections.push({ rule: true }, { html: `<div class="wm-cty-row"><span>${escapeHtml(res)}</span>${batHtml}</div>` });
            bubble({ title: 'Continuity PC', role, anchor, sections, buttons: [{ text: 'Hide' }] });
        } else if (role === 'traffic') {
            // Traffic (#795): the commute time, the delay and when it gets there, and the way into the app
            const t = window.wmTraffic;
            const st = t && typeof t.statusState === 'function' ? t.statusState() : null;
            const sections = st && st.lines && st.lines.length ? st.lines.slice() : ['No commute report.'];
            if (t) sections.push({ links: [{ label: 'Open Traffic', action: () => { closeBubble(); t.open(st && st.direction); } }] });
            bubble({ title: (st && st.title) || STATUS_APP_LABEL[role], role, anchor, sections, buttons: [{ text: 'Hide' }] });
        } else if (role === 'update') {
            // updates downloading: the progress lives here, in the icon's own popup
            const dl = updateProgressToast();
            // a notice stuck at 100% after the download ended: finished, then this popup shows Restart Now
            if (dl && dl.pct >= 100 && !update) {
                void healFinishedUpdateNotice().then((changed) => { if (changed) statusBubble('update', anchor, true); });
            }
            if (dl) {
                const checking = /^checking/i.test(dl.title);
                const bar = dl.pct == null || checking
                    ? '<div class="wm-ds-progress is-marquee" role="progressbar" aria-label="Updates"><span></span></div>'
                    : `<div class="wm-ds-progress" role="progressbar" aria-valuenow="${Math.round(dl.pct)}"><span style="--wm-ds-blocks:${Math.round(dl.pct / 100 * 18)}"></span></div>`;
                const line = checking ? 'Checking for updates...' : `Downloading updates${dl.text ? `: ${dl.text}` : '...'}`;
                bubble({ title: 'Updates', role, anchor, sections: [line, { html: bar }], buttons: [{ text: 'Hide' }] });
                return;
            }
            // a waiting update notice (stalled, applied, check failed ...) comes up from its icon
            const waiting = notes.find(isUpdateNote);
            if (waiting) { closeBubble(); showNote(waiting.id); return; }
            const sw = window.serviceWorkerManager;
            const n = sw && Number(sw.pendingUpdateFilesTotal);
            const text = `Updates are ready to install${Number.isFinite(n) && n > 0 ? ` (${n.toLocaleString()} ${n === 1 ? 'file' : 'files'})` : ''}. Melaton restarts to install them.`;
            const links = sw && typeof sw.forceRestart === 'function' ? [{ label: 'Restart Now', action: () => { closeBubble(); sw.forceRestart(); } }] : [];
            // Continuity connected (#798): the restart's warning here too, before Restart Now (Yukimi, Nov 14);
            // the same words as the restart's own question (melatonContinuity confirmUpdateRestart)
            const warn = [];
            const mc = window.melatonContinuity;
            if (mc && typeof mc.active === 'function' && mc.active()) {
                let both = false;
                try { both = typeof mc.updateScope === 'function' && mc.updateScope(Array.from((sw && sw.pendingUpdateUrls) || [])) === 'both'; } catch (_) { both = false; }
                warn.push({ html: `<div class="wm-bubble-warn">${both
                    ? 'These updates also restart your Continuity-enabled PC. Programs that are open on it will close. Save your work there before you continue.'
                    : 'Your Continuity-enabled PC stays on and reconnects when your Pocket PC is ready.'}</div>` });
            }
            bubble({ title: 'Updates', role, anchor, sections: [text, ...warn, ...(links.length ? [{ links }] : [])], buttons: [{ text: 'Hide' }] });
        } else if (role === 'prints') {
            const n = printsInProgress();
            bubble({ title: 'Prints', role, anchor, sections: [n ? `${n} ${n === 1 ? 'print is' : 'prints are'} in progress.` : 'No prints in progress.', { links: [{ label: 'Pictures', action: () => open('gallery') }] }], buttons: [{ text: 'Hide' }] });
        } else if (role === 'sms') {
            const n = smsUnread();
            const t = window.wmTextShell;
            bubble({ title: 'Text Messages', role, anchor, sections: [n ? `${n} new text ${n === 1 ? 'message' : 'messages'}.` : 'No unread messages.', ...(t && typeof t.openAccount === 'function' ? [{ links: [{ label: 'Text Messages', action: () => { closeBubble(); t.openAccount(); } }] }] : [])], buttons: [{ text: 'Hide' }] });
        } else if (role === 'chat') {
            const n = chatUnread();
            const chat = window.wmChatApp;
            bubble({ title: 'Dreamscape Messenger', role, anchor, sections: [n ? `${n} new ${n === 1 ? 'message' : 'messages'}.` : 'No unread messages.', ...(chat && typeof chat.showList === 'function' ? [{ links: [{ label: 'Dreamscape Messenger', action: () => { closeBubble(); chat.showList(); } }] }] : [])], buttons: [{ text: 'Hide' }] });
        } else if (role === 'mail') {
            // Dreamscape Mail and the IMAP accounts (#789) together
            const n = shellMailUnread + imapUnread();
            bubble({ title: 'Messaging', role, anchor, sections: [n ? `${n} unread ${n === 1 ? 'message' : 'messages'}.` : 'No unread messages.', ...(apps.has('messaging') ? [{ links: [{ label: 'Messaging', action: () => open('messaging') }] }] : [])], buttons: [{ text: 'Hide' }] });
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
    let busyShown = false;

    function paintBusy() {
        const layer = shell && shell.querySelector('.wm-busy');
        if (!layer) return;
        const img = layer.querySelector('.wm-busy-wait');
        const on = busyCount > 0;
        layer.hidden = !on;
        shell.querySelector('.wm-content').setAttribute('aria-busy', on ? 'true' : 'false');
        if (!on) {
            clearTimeout(busyShowTimer);
            busyShowTimer = null;
            busyShown = false;
            img.hidden = true;
            img.removeAttribute('src');
            img.removeAttribute('srcset');
        }
    }

    // 6.1's wheel turns at 143 ms a frame on the device (14 frame changes in 2,008 ms, recorded at
    // 10 ms); 6.5's is not measured yet and keeps 90
    const WAIT_FRAME_MS = WM65 ? 90 : 140;

    /** One of the wait cursor's 16 frames: 6.1's wheel, or 6.5's four coloured dots going round (shellres.192 bitmaps 4896-4911, 80 x 80). */
    /**
     * The wait cursor on an <img>: one strip of its 16 frames (scripts/build-wm-sprite-strips.sh),
     * stepped by CSS (.wm-strip) at the version's frame time. One image and no timer per frame.
     */
    function waitStrip(img) {
        const d = WM65 ? '/static_images/wm65/' : ART;
        img.src = `${d}wait-strip.png`;
        img.srcset = `${d}wait-strip.png 1x, ${d}wait-strip@2x.png 2x, ${d}wait-strip@4x.png 4x`;
        img.style.setProperty('--n', '16');
        img.style.setProperty('--ms', String(WAIT_FRAME_MS));
        img.classList.add('wm-strip');
    }

    function showBusyCursor() {
        busyShowTimer = null;
        if (busyCount <= 0 || busyShown) return;
        const img = shell.querySelector('.wm-busy-wait');
        waitStrip(img);
        img.hidden = false;
        busyShown = true;
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
        if (!busyShown) {
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

    /**
     * The wait cursor for the Dreamscape app to draw itself while an Android program starts (#816,
     * DSApp LaunchCursor): the strip for this version and density, its frame time, and where the
     * busy cursor sits on the page (CSS px, with the page's width so the app can map it to the
     * screen). null when it would not show (no shell, a message box up).
     */
    function waitCursorSpec() {
        if (!shell) return null;
        const layer = shell.querySelector('.wm-busy');
        const img = layer && layer.querySelector('.wm-busy-wait');
        if (!img) return null;
        // measured where busy() puts it, without painting it
        const wasLayer = layer.hidden;
        const wasImg = img.hidden;
        layer.style.visibility = 'hidden';
        layer.hidden = false;
        img.hidden = false;
        const r = img.getBoundingClientRect();
        img.hidden = wasImg;
        layer.hidden = wasLayer;
        layer.style.visibility = '';
        if (!(r.width > 0 && r.height > 0)) return null;
        const base = WM65 ? 40 : 32; // the 1x frame (6.5: shellres.192 80 x 80 at 2x)
        const need = (r.width * (window.devicePixelRatio || 1)) / base;
        const scale = need <= 1 ? 1 : need <= 2 ? 2 : 4;
        const d = WM65 ? '/static_images/wm65/' : ART;
        return {
            key: `${WM65 ? 'wm65' : 'wm61'}@${scale}x`,
            src: `${d}wait-strip${scale === 1 ? '' : `@${scale}x`}.png`,
            frames: 16,
            ms: WAIT_FRAME_MS,
            x: r.left, y: r.top, w: r.width, h: r.height,
            vw: window.innerWidth
        };
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
     * WM 6.1's system sounds, from the device (Yozora #709, #732; dump: ~/.cache/wm61/snd-evidence,
     * reference screens ~/.cache/wm61/ref-shell).
     * PlaySound's aliases are a fixed table in coredll (slot 1 at 0x033CD308, read on the emulator
     * with ~/.cache/wm61/tools/wmmem2.cs) indexed into HKLM\Snd\Event "Curr0" (multi_sz, the
     * scheme; EventMask 0x1F7ED):
     *   0 SystemAsterisk alarm2   1 Close ""        2 SystemHand alarm2      3 SystemDefault default
     *   4 EmptyRecycleBin Empty   5 SystemExclamation alarm2  6-8 IR begin/end/intr infbeg/infend
     *   9 MenuPopup ""   10 MenuCommand ""   11 Open ""   12 SystemQuestion alarm2
     *   13-15 RN begin/end/intr   16 SystemStart alarm2   17 Maximize ""   18 Minimize ""
     *   19 RecordStart voicbeep   20 RecordEnd RecEnd
     * gwes plays SystemAsterisk / Exclamation / Question / Hand for a message box's icon (MessageBeep;
     * no icon is MB_OK, SystemDefault) and SystemStart at startup; menus are silent unless a sound is
     * picked. A notification plays its class's Wave (HKCU\ControlPanel\Notifications; Options bits
     * 1 sound, 2 vibrate, 4 repeat, 8 display, 16 flash): Default \Windows\Alarm2.wav, new e-mail
     * Alarm1 (Options 8: no sound), new text message Alarm3 (9), voice mail Alarm4, Reminders notify
     * (sound + repeat + display + flash), connections infbeg / infend (0: off).
     *
     * Files: every sound of the ROM's \Windows a browser can play, under the ROM's names
     * (public/sounds/wm61): WAVs as they are, WMAs as MP3 (WMA does not decode in browsers, names
     * without the ROM's trailing space). The MIDI call tones (busy, calldrop, dpadctl ...) are not
     * here: nothing synthesises MIDI. The ROM has no lowbatt / startup / shutdown files; online (the
     * instant-message event's) is Windows Live Messenger's new-message sound from archive.org (#779).
     *
     * Each phone event (SND_EVENTS: WM's notification classes, CE's sound events and Dreamscape's
     * own) has per-device options on Settings > Sounds & Notifications > Notifications
     * (localStorage wmSounds: { taps, tapsLoud, buttons, buttonsLoud, ev: { id: { sound, repeat,
     * display, vibrate } } }; sound '' = Play sound off, missing = WM's default). Over that, the
     * workspace's switches still decide (the desktop's store, Settings' Sounds tab): each event
     * follows the desktop event it stands for (desktop); (None), a group's check box off or No
     * Sounds silences it; a desktop sound picked for that event plays on a phone that has not
     * picked its own. New e-mail's Play sound and Display message are Dovecote's own (per browser).
     * The volume bubble decides over all of it: Off (tabVolume muted) and Vibrate are silent, and
     * the Ringer level (wmRingerLevel 0-5) scales every sound past the media level. Nothing
     * plays before a tap or key has unlocked audio (no queue, never throws).
     */
    const SND_BASE = '/sounds/wm61/';
    const WM_SOUNDS = [
        'Alarm1.mp3', 'Alarm2.wav', 'Alarm3.mp3', 'Alarm4.mp3', 'Alarm5.wav', 'Default.wav', 'drive.mp3',
        'hwandsw.wav', 'Infbeg.wav', 'Infend.wav', 'Loudest.wav', 'MenuPop.wav', 'notify.mp3', 'paloma.mp3',
        'Quietest.wav', 'RecEnd.wav', 'Ring-Standard.mp3', 'Ring-Vision.mp3', 'Ring-WindowsMobile.mp3',
        'ShutterSound.wav', 'Splat.wav', 'TimerSound.wav', 'type.mp3', 'Voicbeep.wav',
        // the instant-message event's file (HKCU ControlPanel\Notifications {A877D65D}: online.wma), which
        // the emulator images lack: Windows Live Messenger's new instant message sound (archive.org, #779)
        'online.mp3',
        // Traffic's speed camera alert: our own sound (scripts/generate-traffic-camera-sound.py, #810)
        'TrafficCamera.wav'
    ];
    // WM's Sound list names a file without its extension, first letter capital ("Notify", "Type")
    const wmSoundLabel = (file) => {
        const s = String(file || '').replace(/\.(wav|mp3)$/i, '');
        return s.charAt(0).toUpperCase() + s.slice(1);
    };
    /**
     * The phone's sound events, in WM's Event list order (alphabetical). kind 'note' = a
     * notification class (Repeat where WM offers it, Display message on screen, Vibrate); 'event' =
     * a system sound (a message box's beep, startup, menus): Play sound only. desktop = the
     * workspace event whose settings it follows.
     */
    const SND_EVENTS = [
        // #822: data moving over ActiveSync starts and ends (WM's own begin / end sounds)
        { id: 'as-done', label: 'ActiveSync: Complete', kind: 'event', sound: 'Infend.wav', desktop: 'balloon' },
        { id: 'as-start', label: 'ActiveSync: Start', kind: 'event', sound: 'Infbeg.wav', desktop: 'balloon' },
        { id: 'connect', label: 'Connection established', kind: 'note', sound: 'Infbeg.wav', play: false, desktop: 'balloon' },
        { id: 'disconnect', label: 'Connection disconnected', kind: 'note', sound: 'Infend.wav', play: false, desktop: 'balloon' },
        { id: 'beep', label: 'Default beep', kind: 'event', sound: 'Default.wav', desktop: 'dialog' },
        { id: 'director', label: 'Director: Turn finished', kind: 'note', sound: 'Alarm2.wav', display: false, desktop: 'balloon' },
        // #779: Dreamscape Messenger (the chat personas) and Text Messaging notify in classes of their own
        { id: 'chat', label: 'Dreamscape Messenger: New message', kind: 'note', sound: 'online.mp3', desktop: 'balloon' },
        { id: 'error', label: 'Errors', kind: 'event', sound: 'Alarm2.wav', desktop: 'critical-stop' },
        { id: 'info', label: 'Information', kind: 'event', sound: 'Alarm2.wav', desktop: 'dialog' },
        { id: 'menu', label: 'Menu pop-up', kind: 'event', sound: 'MenuPop.wav', play: false, desktop: 'dialog' },
        { id: 'mail', label: 'Messaging: New e-mail message', kind: 'note', sound: 'Alarm1.mp3', desktop: 'notify', dovecote: true },
        { id: 'notification', label: 'Other notifications', kind: 'note', sound: 'Alarm2.wav', repeatable: true, desktop: 'balloon' },
        { id: 'question', label: 'Questions', kind: 'event', sound: 'Alarm2.wav', desktop: 'dialog' },
        { id: 'reminder', label: 'Reminders', kind: 'note', sound: 'notify.mp3', repeatable: true, repeat: true, desktop: 'balloon' },
        { id: 'startup', label: 'Start up', kind: 'event', sound: 'Alarm2.wav', desktop: 'logon' },
        { id: 'print', label: 'Studio: Print finished', kind: 'note', sound: 'Alarm2.wav', desktop: 'print-complete' },
        { id: 'print-error', label: 'Studio: Print failed', kind: 'note', sound: 'Alarm2.wav', desktop: 'print-error' },
        { id: 'sms', label: 'Text Messaging: New text message', kind: 'note', sound: 'Alarm3.mp3', desktop: 'balloon' },
        // #810: a speed or red light camera 1 mi ahead on the commute, with its own sound
        { id: 'traffic-camera', label: 'Traffic: Speed camera', kind: 'note', sound: 'TrafficCamera.wav', desktop: 'warning' },
        { id: 'warning', label: 'Warnings', kind: 'event', sound: 'Alarm2.wav', desktop: 'warning' },
        // Weather (#792): alerts for Home / Work, severe and extreme ones keep sounding until seen; the rain alarm
        { id: 'weather-alert', label: 'Weather: Alert', kind: 'note', sound: 'Alarm5.wav', desktop: 'balloon' },
        { id: 'weather-severe', label: 'Weather: Severe alert', kind: 'note', sound: 'Alarm5.wav', repeatable: true, repeat: true, desktop: 'warning' },
        { id: 'rain-alarm', label: 'Weather: Rain alarm', kind: 'note', sound: 'Alarm4.mp3', desktop: 'balloon' }
    ];
    const SND_EVENT = new Map(SND_EVENTS.map((e) => [e.id, e]));
    // the gwes / PlaySound names callers use, as phone events
    const SND_ALIAS = {
        SystemAsterisk: 'info', SystemQuestion: 'question', SystemExclamation: 'warning', SystemHand: 'error',
        SystemDefault: 'beep', SystemStart: 'startup', MenuPopup: 'menu', Notification: 'notification',
        // the chat personas' class before #779
        text: 'chat'
    };
    const MSGBOX_SOUND = { info: 'SystemAsterisk', question: 'SystemQuestion', warning: 'SystemExclamation', error: 'SystemHand' };
    // The screen-tap and hardware-button clicks are not \Windows files: four WAVE resources of
    // waveapi.dll (8-bit mono 11025 Hz), a soft and a loud sample each, not one sample at two
    // gains. Its click loader (0x033D08A8 on the 6.1 emulator, disassembled from the slot 1 dump)
    // reads HKCU\ControlPanel\Volume "Key" / "Screen" (0 off, 1 soft, 2 loud; both 0x10000 = off as
    // shipped) and loads WAVE 100 KeyLoud (28 ms), 101 KeySoft (32 ms), 102 TouchLoud, 103
    // TouchSoft (42 ms each). 6.5's resource region holds the same four, byte for byte.
    const SND_CLICKS = {
        taps: { soft: 'TouchSoft.wav', loud: 'TouchLoud.wav' },
        buttons: { soft: 'KeySoft.wav', loud: 'KeyLoud.wav' }
    };
    // Settings' "Tap and button sounds": Classic = the device's four above; Modern = what Melaton
    // played for both before (the ROM's \Windows\hwandsw.wav, one sample: Soft is its gain)
    const SND_CLICK_MODERN = 'hwandsw.wav';
    const SND_CLICK_MODERN_GAIN = { soft: 0.3, loud: 1 };
    const clickSound = (p, kind) => {
        const loud = (kind === 'buttons' ? p.buttonsLoud : p.tapsLoud) ? 'loud' : 'soft';
        return p.clicks === 'modern' ? { file: SND_CLICK_MODERN, gain: SND_CLICK_MODERN_GAIN[loud] }
            : { file: SND_CLICKS[kind === 'buttons' ? 'buttons' : 'taps'][loud], gain: 1 };
    };
    const SND_PREFS_KEY = 'wmSounds';
    const snd = { ctx: null, buffers: new Map(), last: 0, log: [], preview: null };

    /** This device's sound options (Settings > Sounds & Notifications), defaults filled in. */
    function soundPrefs() {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(SND_PREFS_KEY) || 'null'); } catch (_) { p = null; }
        p = p && typeof p === 'object' ? p : {};
        return {
            taps: p.taps === true, tapsLoud: p.tapsLoud !== false,
            buttons: p.buttons === true, buttonsLoud: p.buttonsLoud !== false,
            clicks: p.clicks === 'modern' ? 'modern' : 'classic',
            ev: p.ev && typeof p.ev === 'object' ? p.ev : {}
        };
    }

    function saveSoundPrefs(p) {
        try { localStorage.setItem(SND_PREFS_KEY, JSON.stringify(p)); } catch (_) { /* private mode: this session only */ }
    }

    const dovecoteMail = () => {
        const m = window.dovecoteMailSettings;
        return m && typeof m.soundOn === 'function' ? { sound: !!m.soundOn(), notify: typeof m.notifyOn === 'function' ? !!m.notifyOn() : true } : null;
    };

    /**
     * One event's options on this device: { sound (file, '' = Play sound off), own (the device
     * picked it), repeat, display, vibrate }. New e-mail's Play sound / Display are Dovecote's.
     */
    function eventPrefs(id, prefs) {
        const ev = SND_EVENT.get(id);
        if (!ev) return null;
        const evs = (prefs || soundPrefs()).ev;
        // before #779 'text' was the chat personas' class: Dreamscape Messenger keeps what was picked for it
        const o = evs[id] || (id === 'chat' ? evs.text : null) || {};
        const own = typeof o.sound === 'string';
        let sound = own ? o.sound : (ev.play === false ? '' : ev.sound);
        let display = typeof o.display === 'boolean' ? o.display : ev.display !== false;
        if (ev.dovecote) {
            const m = dovecoteMail();
            if (m) {
                if (!m.sound) sound = '';
                else if (sound === '') sound = ev.sound;
                display = m.notify;
            }
        }
        return {
            sound, own: own && o.sound !== '',
            repeat: !!ev.repeatable && (typeof o.repeat === 'boolean' ? o.repeat : !!ev.repeat),
            display: ev.kind === 'note' ? display : false,
            vibrate: ev.kind === 'note' && o.vibrate === true
        };
    }

    function sndUnlock() {
        try {
            if (!snd.ctx) {
                const Ctor = window.AudioContext || window.webkitAudioContext;
                if (!Ctor) return;
                snd.ctx = new Ctor();
            }
            if (snd.ctx.state === 'suspended' && snd.ctx.resume) snd.ctx.resume().catch(() => {});
            // the sounds this device uses (each one picked or WM's own), not the whole list
            const p = soundPrefs();
            const want = new Set(SND_EVENTS.map((e) => eventPrefs(e.id, p).sound).filter((f) => f && WM_SOUNDS.includes(f)));
            if (p.taps) want.add(clickSound(p, 'taps').file);
            if (p.buttons) want.add(clickSound(p, 'buttons').file);
            want.forEach(sndBuffer);
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
        return soundMode() !== 'on' || ringerLevel() <= 0;
    }

    // what played, for tests (wmShell.sounds.log)
    function sndNote(name, event, file, at) {
        snd.log.push({ name, event, file, at });
        if (snd.log.length > 50) snd.log.shift();
    }

    /** Play a WM file now (gain 0..1); resolves with its source node or null. */
    async function sndPlayFile(file, gain = 1) {
        const ctx = snd.ctx;
        if (!ctx || ctx.state !== 'running') return null;
        const buffer = await sndBuffer(file);
        if (!buffer) return null;
        const src = ctx.createBufferSource();
        src.buffer = buffer;
        // the Ringer level (volume bubble), not the media level: past tabVolume's master gain
        const g = ctx.createGain();
        g.gain.value = Math.max(0, Math.min(1, gain)) * (ringerLevel() / VOL_STEPS);
        src.connect(g);
        const tv = window.tabVolume;
        if (tv && typeof tv.connectRaw === 'function') tv.connectRaw(g);
        else g.connect(ctx.destination);
        src.start(0);
        return src;
    }

    /*
     * Vibration. The Android app (DSApp-Kotlin) gives window.AndroidHaptics: capabilities() ->
     * JSON { vibrator, amplitudeControl }, vibrate(JSON { timings (ms), amplitudes (0-255, 0 = a
     * pause), repeat (-1 once, else the index to loop from), usage 'notification' | 'ring' |
     * 'alarm' | 'touch' }) and cancel(). It works with the page in the background, and Android's
     * own vibration settings, ringer mode and Do Not Disturb still decide. A browser has
     * navigator.vibrate: on / off times only, one strength, after a tap, never while hidden.
     *
     * Patterns are on, off, on ... ms. The ROM holds one vibration script,
     * HKCU\ControlPanel\Sounds\SDPUnlock ScriptVibrate "v0.15w0.15v0.15w0.15" (0.15 s on, 0.15 s
     * off, twice): a notification's buzz here. The others are ours (a WM device's motor is driven
     * by its OEM's NLED driver; the emulator has none to measure): a reminder is longer, an error
     * or warning one beat, a call rings as the ring script "apw3r" does (3 s a turn) until
     * cancelled. WM 6.x has no vibration on screen taps or keys: none here.
     *
     * Settings > Sounds & Notifications > Vibration keeps this device's options (localStorage
     * wmVibration: { on, level 1-5, calls, alerts }); level n is amplitude 255 * n / 5 where the
     * motor has amplitude control. The volume bubble decides first: Off never vibrates; Vibrate
     * buzzes for every notification, error and warning box and call; On only for a notification
     * whose Vibrate box is ticked (Notifications tab), for calls and for errors and warnings when
     * this tab says so.
     */
    const VIB_KEY = 'wmVibration';
    const VIB_LEVELS = 5;
    const VIB_PATTERNS = {
        notification: { on: [150, 150, 150], usage: 'notification' },
        reminder: { on: [400, 200, 400, 200, 400], usage: 'notification' },
        alert: { on: [250], usage: 'notification' },
        ring: { on: [1000, 2000], usage: 'ring', repeat: true, maxMs: 30000 },
        mode: { on: [200], usage: 'touch' }
    };
    const vib = { log: [], last: {}, stop: null, caps: null };

    /** This device's vibration options (Settings > Sounds & Notifications > Vibration), defaults filled in. */
    function vibrationPrefs() {
        let p = null;
        try { p = JSON.parse(localStorage.getItem(VIB_KEY) || 'null'); } catch (_) { p = null; }
        p = p && typeof p === 'object' ? p : {};
        const level = Math.round(Number(p.level));
        return {
            on: p.on !== false,
            level: Number.isFinite(level) && level >= 1 && level <= VIB_LEVELS ? level : VIB_LEVELS,
            calls: p.calls !== false,
            alerts: p.alerts === true
        };
    }

    function saveVibrationPrefs(p) {
        const o = p && typeof p === 'object' ? p : {};
        const level = Math.round(Number(o.level));
        const clean = {
            on: o.on !== false,
            level: Number.isFinite(level) && level >= 1 && level <= VIB_LEVELS ? level : VIB_LEVELS,
            calls: o.calls !== false,
            alerts: o.alerts === true
        };
        try { localStorage.setItem(VIB_KEY, JSON.stringify(clean)); } catch (_) { /* private mode: this session only */ }
    }

    const hapticsBridge = () => {
        const b = window.AndroidHaptics;
        return b && typeof b.vibrate === 'function' ? b : null;
    };

    /** What can buzz here: { vibrator, amplitudeControl, bridge } (the app's answer, read once). */
    function vibrationCaps() {
        const b = hapticsBridge();
        if (!b) return { vibrator: typeof navigator.vibrate === 'function', amplitudeControl: false, bridge: false };
        if (!vib.caps) {
            let c = null;
            try { c = JSON.parse(b.capabilities()); } catch (_) { c = null; }
            vib.caps = { vibrator: !(c && c.vibrator === false), amplitudeControl: !!(c && c.amplitudeControl === true), bridge: true };
        }
        return { ...vib.caps };
    }

    function vibrateCancel() {
        clearTimeout(vib.stop);
        vib.stop = null;
        try {
            const b = hapticsBridge();
            if (b && typeof b.cancel === 'function') b.cancel();
            else if (typeof navigator.vibrate === 'function') navigator.vibrate(0);
        } catch (_) { /* no motor */ }
    }

    /**
     * Buzz one named pattern (VIB_PATTERNS) at the Vibration tab's level; true when it was handed
     * to the motor. opts.level (0-5) instead of the stored one and opts.force (whatever the
     * volume bubble's mode and the tab's switches) are Settings' Test button; opts.ms ends a
     * repeating pattern sooner than its own limit. The same pattern within 300 ms is one buzz (a
     * message box and the desktop's own call for the same box).
     */
    function vibrate(kind, opts = {}) {
        try {
            const pat = VIB_PATTERNS[kind];
            if (!pat) return false;
            const p = vibrationPrefs();
            const asked = Math.round(Number(opts.level));
            const level = opts.level != null && Number.isFinite(asked) ? Math.max(0, Math.min(VIB_LEVELS, asked)) : (p.on ? p.level : 0);
            if (level <= 0) return false;
            if (!opts.force) {
                const mode = soundMode();
                if (mode === 'off') return false;
                if (kind === 'ring' && mode === 'on' && !p.calls) return false;
            }
            const now = Date.now();
            if (!opts.force && now - (vib.last[kind] || 0) < 300) return false;
            vib.last[kind] = now;
            const amp = Math.round((255 * level) / VIB_LEVELS);
            const b = hapticsBridge();
            const entry = { kind, level, amplitude: amp, via: b ? 'bridge' : 'navigator', at: now };
            vib.log.push(entry);
            if (vib.log.length > 50) vib.log.shift();
            clearTimeout(vib.stop);
            vib.stop = null;
            const limit = pat.repeat ? Math.max(0, Math.min(pat.maxMs, Number(opts.ms) > 0 ? Number(opts.ms) : pat.maxMs)) : 0;
            let ok;
            if (b) {
                ok = b.vibrate(JSON.stringify({
                    timings: pat.on,
                    amplitudes: pat.on.map((_, i) => (i % 2 ? 0 : amp)),
                    repeat: pat.repeat ? 0 : -1,
                    usage: pat.usage
                })) !== false;
            } else {
                if (typeof navigator.vibrate !== 'function') return false;
                let seq = pat.on;
                if (pat.repeat) {
                    const turn = pat.on.reduce((a, c) => a + c, 0);
                    seq = [];
                    for (let t = 0; t + turn <= limit; t += turn) seq.push(...pat.on);
                }
                ok = navigator.vibrate(seq) !== false;
            }
            entry.ok = ok;
            if (ok && pat.repeat) vib.stop = setTimeout(vibrateCancel, limit);
            return ok;
        } catch (_) {
            return false;
        }
    }

    /**
     * Play one phone sound event (SND_EVENTS ids, or the PlaySound names in SND_ALIAS); resolves
     * true when it started. opts.event: the desktop event whose settings decide instead of the
     * event's own (an error notification follows Program Error). A second sound within 300 ms is
     * dropped: a message box and the desktop's own call for the same box are one beep. A
     * notification's Vibrate runs whatever the sound does (not with the volume bubble on Off);
     * opts.vibrate false keeps the motor out of it.
     */
    async function playSystemSound(name, opts = {}) {
        try {
            const id = SND_EVENT.has(name) ? name : SND_ALIAS[name];
            const ev = id && SND_EVENT.get(id);
            if (!ev) return false;
            const prefs = eventPrefs(id);
            // the volume bubble's Vibrate: sounds buzz instead. On: a notification whose Vibrate box
            // is ticked, and an error or warning when the Vibration tab says so
            if (opts.vibrate !== false) {
                const quiet = soundMode() === 'vibrate';
                if (ev.kind === 'note') {
                    if (prefs.vibrate || quiet) vibrate(id === 'reminder' ? 'reminder' : 'notification');
                } else if ((id === 'error' || id === 'warning') && (quiet || vibrationPrefs().alerts)) {
                    vibrate('alert');
                }
            }
            const event = opts.event || ev.desktop;
            const pers = window.desktopPersonalization;
            let own;
            if (pers && typeof pers.soundFile === 'function') {
                if (id === 'startup' && pers.soundFile('logon-startup') === '') return false;
                own = pers.soundFile(event);
            }
            if (own === '' || prefs.sound === '' || sndSilentNow()) return false;
            const ctx = snd.ctx;
            if (!ctx || ctx.state !== 'running') return false;
            const now = Date.now();
            if (now - snd.last < 300 && !opts.again) return false;
            snd.last = now;
            const ds = window.desktopSounds;
            const vista = (f) => typeof f === 'string' && !!(ds && Array.isArray(ds.FILES) && ds.FILES.includes(f) && typeof ds.playFile === 'function');
            const schemeFile = ds && ds.SCHEME ? ds.SCHEME[event] : undefined;
            // the device's own pick; else a desktop sound picked for the event in this workspace
            let file = prefs.own ? prefs.sound : (typeof own === 'string' && own !== schemeFile && vista(own) ? own : prefs.sound);
            if (vista(file)) {
                sndNote(id, event, `vista/${file}`, now);
                return !!(await ds.playFile(file));
            }
            if (!WM_SOUNDS.includes(file)) file = ev.sound;
            sndNote(id, event, `wm61/${file}`, now);
            return !!(await sndPlayFile(file));
        } catch (_) {
            return false;
        }
    }

    /** Settings' Play button: the file as it sounds, whatever the switches (Stop or the next Play ends it). */
    async function previewSound(file) {
        stopPreview();
        sndUnlock();
        try {
            const ds = window.desktopSounds;
            if (ds && Array.isArray(ds.FILES) && ds.FILES.includes(file) && typeof ds.playFile === 'function') return !!(await ds.playFile(file));
            if (!WM_SOUNDS.includes(file) || !snd.ctx) return false;
            if (snd.ctx.state !== 'running') await snd.ctx.resume().catch(() => {});
            const src = await sndPlayFile(file);
            snd.preview = src;
            return !!src;
        } catch (_) { return false; }
    }

    function stopPreview() {
        try { if (snd.preview) snd.preview.stop(); } catch (_) { /* ended */ }
        snd.preview = null;
    }

    /** A screen tap or hardware button's click, when Settings has it on (soft or loud). */
    function playClick(kind) {
        try {
            const p = soundPrefs();
            const on = kind === 'buttons' ? p.buttons : p.taps;
            if (!on || sndSilentNow() || !snd.ctx || snd.ctx.state !== 'running') return;
            const click = clickSound(p, kind);
            sndNote(kind === 'buttons' ? 'key-click' : 'tap-click', '', `wm61/${click.file}`, Date.now());
            sndPlayFile(click.file, click.gain);
        } catch (_) { /* no click */ }
    }

    /**
     * The desktop's own sound calls on the phone (desktopSounds.play only plays in desktop mode):
     * a boot message box, an exception window, a dropped connection and the confirmation dialog's
     * sound map to WM's, Dovecote's new mail to New e-mail message (it calls only when its mail
     * sound is on; its notification, when shown, is the same beep); every other desktop event
     * (logon, prints, recycle ...) has no WM sound or comes as a notification here.
     * Screen taps and hardware keys click when Settings > Sounds & Notifications has them on. The
     * device clicks in the drivers, before any window sees the input: a tap is every pen-down,
     * wherever it lands (on nothing too), a key every key-down of a real key (the input panel's
     * keys are pen taps: keybd_event's KEYEVENTF_SILENT). Here a key is the back key (DSApp sends
     * it as Escape) and any key of a hardware keyboard; an on-screen keyboard's keys (keyCode 229)
     * are Android's own and stay silent.
     */
    const DESKTOP_SOUND = { error: 'SystemHand', 'critical-stop': 'SystemHand', warning: 'SystemExclamation', dialog: 'SystemAsterisk', notify: 'mail' };
    function watchSystemSounds() {
        const unlock = () => sndUnlock();
        document.addEventListener('pointerdown', (e) => {
            unlock();
            if (e.isTrusted && e.isPrimary !== false) playClick('taps');
        }, { capture: true, passive: true });
        document.addEventListener('keydown', (e) => {
            unlock();
            if (hardKey(e) && !e.repeat) {
                keysClicked.add(e.code || e.key);
                playClick('buttons');
            }
        }, { capture: true });
        // a key-down the shell takes on window (build(): the back key's Escape, keys under the
        // wait cursor) is stopped there and never comes this far: its key-up, which does, clicks
        const keysClicked = new Set();
        const hardKey = (e) => e.isTrusted && !e.isComposing && e.keyCode !== 229 && e.key !== 'Unidentified' && e.key !== 'Process';
        document.addEventListener('keyup', (e) => {
            if (!keysClicked.delete(e.code || e.key) && hardKey(e)) playClick('buttons');
        }, { capture: true });
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
    // the last trusted tap landed on shell chrome (title bar, a bubble, a menu): not a command
    let lastTapChrome = false;
    const CHROME_TAP = '.wm-titlebar, .wm-bubble, .wm-msgbox-layer';
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
        const mark = (e) => {
            if (!e.isTrusted) return;
            lastTapAt = performance.now();
            lastTapChrome = !!(e.target && e.target.closest && e.target.closest(CHROME_TAP));
        };
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
    function messageBox({ title = 'Melaton Mobile', text = '', icon = null, buttons = [{ text: 'ok', value: true }], cancelValue = false, input = null, modal = false, titleAction = null, onOpen = null } = {}) {
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
                    <div class="wm-msgbox-title"><span>${escapeHtml(title)}</span>${okOnly ? '<button type="button" class="wm-title-action" data-kind="ok" aria-label="OK"></button>' : titleAction ? `<button type="button" class="wm-title-action" data-kind="${titleAction.kind === 'ok' ? 'ok' : 'close'}" aria-label="${titleAction.kind === 'ok' ? 'OK' : 'Close'}"></button>` : ''}</div>
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
                // a box with buttons may still carry the title bar's X / ok (titleAction { kind, value })
                const ta = titleAction && layer.querySelector('.wm-title-action');
                if (ta) ta.addEventListener('click', () => done(titleAction.value));
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
            // the first paint (recorded): 6.1 an empty outline, 6.5 the first text line only with
            // the buttons right under it; whole a tick later (wm-stage.css)
            const painted = layer.querySelector('.wm-msgbox');
            painted.dataset.wmPaint = 'first';
            setTimeout(() => { delete painted.dataset.wmPaint; }, STAGE_TICK);
            // WM: the title bar's corner goes empty while a message box is up
            refreshTitleAction();
            // MessageBeep by the icon (none: MB_OK, the default beep); an edit box with no icon is a
            // form, not a message box
            if (icon || !input) playSystemSound(icon ? MSGBOX_SOUND[icon] || 'SystemDefault' : 'SystemDefault');
            const first = field || layer.querySelector('.wm-msgbox-buttons .is-default') || layer.querySelector('button');
            if (first) first.focus();
            // the caller may close it itself (onOpen(close): close(value) answers as that value)
            if (typeof onOpen === 'function') {
                try { onOpen((value) => { if (painted.isConnected) done(value); }); } catch (_) { /* the caller's own problem */ }
            }
        });
    }

    const TODAY_BG_KEY = 'wmTodayBackground';

    /**
     * The Today layout per workspace (Yukimi, Nov 10): items, options, background and "use the
     * desktop wallpaper" are the workspace's (server field mobileToday), not the device's. The
     * device keys (wmTodayItems / wmTodayOptions / wmTodayBackground / wmTodayUseDesktop) stay the
     * working copy every reader uses: the workspace's copy is loaded into them on boot and on a
     * workspace switch, and every Today change (wmSettingsChange with those keys) is saved back.
     * A workspace with nothing saved yet keeps the current layout until its first change.
     */
    // items65: 6.5's own list; a workspace record without it (saved by 6.1, or by a server that does
    // not know the field yet) leaves this device's 6.5 list alone
    const TODAY_PREF = [['items', 'wmTodayItems', true], ['items65', 'wmTodayItems65', true, true], ['start65', 'wmStart65Layout', true, true], ['options', 'wmTodayOptions', true], ['background', TODAY_BG_KEY, false], ['useDesktop', 'wmTodayUseDesktop', false]];
    const TODAY_PREF_KEYS = new Set(TODAY_PREF.map(([, key]) => key));
    let todayPrefsFor = null;

    function loadTodayPrefs(force) {
        const id = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        const w = activeWorkspaceRecord();
        if (!id || !w) return false;
        if (todayPrefsFor === id && !force) return true;
        todayPrefsFor = id;
        const t = w.mobileToday;
        if (!t || typeof t !== 'object') {
            // nothing saved for this workspace yet: the layout it is first seen with is the last
            // one used (it becomes its own on the first change), but the picture never carries
            // over from another workspace: Today shows this workspace's own desktop wallpaper
            try { localStorage.removeItem(TODAY_BG_KEY); localStorage.removeItem('wmTodayUseDesktop'); } catch (_) { /* storage off */ }
            return true;
        }
        for (const [k, key, json, optional] of TODAY_PREF) {
            try {
                const v = t[k];
                if (v == null && optional) continue;
                if (v == null) localStorage.removeItem(key);
                else localStorage.setItem(key, json ? JSON.stringify(v) : String(v));
            } catch (_) { /* storage off */ }
        }
        return true;
    }

    function saveTodayPrefs() {
        const id = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        const w = activeWorkspaceRecord();
        const c = window.wsClient;
        if (!id || !w || !c || typeof c.updateWorkspaceSettings !== 'function') return;
        const out = {};
        for (const [k, key, json] of TODAY_PREF) {
            try {
                const v = localStorage.getItem(key);
                if (v != null) out[k] = json ? JSON.parse(v) : v;
            } catch (_) { /* skip */ }
        }
        w.mobileToday = out;
        Promise.resolve(c.updateWorkspaceSettings(id, { mobileToday: out })).catch((err) => console.warn('[wmShell] Today layout not saved', err));
    }

    function watchTodayPrefs() {
        const refreshToday = () => { const t = apps.get('today'); if (t && t.page) t.refresh(); };
        // registered before Today's own listener: the workspace's layout is in place when it redraws
        document.addEventListener('workspaceSwitchComplete', () => { loadTodayPrefs(true); });
        document.addEventListener('wmSettingsChange', (ev) => {
            const keys = (ev && ev.detail && ev.detail.keys) || [];
            if (keys.some((k) => TODAY_PREF_KEYS.has(k))) saveTodayPrefs();
        });
        // another device changed this workspace's Today
        document.addEventListener('workspaceUpdated', (ev) => {
            const d = ev && ev.detail;
            if (!d || !d.settings || d.settings.mobileToday === undefined) return;
            if (d.workspaceId !== (typeof activeWorkspace !== 'undefined' ? activeWorkspace : null)) return;
            const w = activeWorkspaceRecord();
            if (w) w.mobileToday = d.settings.mobileToday;
            loadTodayPrefs(true);
            refreshToday();
        });
        // first load: once the workspaces are known
        const first = setInterval(() => { if (loadTodayPrefs(false)) { clearInterval(first); refreshToday(); } }, 500);
        setTimeout(() => clearInterval(first), 120000);
    }
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
     * The Today picture's effect (Settings > Today > Wallpaper, per workspace with the Today
     * layout): WM 6.1's Today picture is washed toward white; here Lighten / Darken lay white /
     * black over it at the level's strength and Blur draws a blurred copy (canvas, cached per
     * picture and level). The Start menu copies Today's background, effect and all.
     */
    function todayEffect() {
        const effect = todayOption('wallpaper', 'effect') || 'none';
        const level = Math.max(0, Math.min(100, Number(todayOption('wallpaper', 'level')) || 0));
        return { effect: level > 0 ? effect : 'none', level };
    }

    const blurCache = new Map(); // `${url}|${level}` -> Promise<objectURL|null>

    function blurredPicture(url, level) {
        const key = `${url}|${level}`;
        if (blurCache.has(key)) return blurCache.get(key);
        const job = new Promise((resolve) => {
            const img = new Image();
            img.onload = () => {
                try {
                    const w = img.naturalWidth;
                    const h = img.naturalHeight;
                    // drawn at most 1600 px on its long side: the blur hides the lost detail
                    const k = Math.min(1, 1600 / Math.max(w, h));
                    const cw = Math.max(1, Math.round(w * k));
                    const ch = Math.max(1, Math.round(h * k));
                    const r = Math.max(1, (level / 100) * 0.03 * Math.max(cw, ch));
                    const c = document.createElement('canvas');
                    c.width = cw;
                    c.height = ch;
                    const ctx = c.getContext('2d');
                    ctx.filter = `blur(${r}px)`;
                    // drawn past the edges so the blur does not fade them to transparent
                    ctx.drawImage(img, -2 * r, -2 * r, cw + 4 * r, ch + 4 * r);
                    c.toBlob((b) => resolve(b ? URL.createObjectURL(b) : null), 'image/jpeg', 0.9);
                } catch (_) { resolve(null); }
            };
            img.onerror = () => resolve(null);
            img.src = url;
        });
        blurCache.set(key, job);
        if (blurCache.size > 8) {
            const [first] = blurCache.keys();
            const old = blurCache.get(first);
            blurCache.delete(first);
            Promise.resolve(old).then((u) => { if (u) URL.revokeObjectURL(u); });
        }
        return job;
    }

    /**
     * The background for a picture with an effect: { image, size, position, repeat } from the
     * placement's css; src: the picture to draw (Blur passes its blurred copy).
     */
    function effectBackground(src, css, fx) {
        const q = `url("${src.replace(/["\\\n]/g, encodeURIComponent)}")`;
        if (fx.effect === 'lighten' || fx.effect === 'darken') {
            const a = (fx.level / 100).toFixed(3);
            const tint = fx.effect === 'lighten' ? `rgba(255,255,255,${a})` : `rgba(0,0,0,${a})`;
            return { image: `linear-gradient(${tint}, ${tint}), ${q}`, size: `100% 100%, ${css.size}`, position: `0 0, ${css.position}`, repeat: `no-repeat, ${css.repeat}` };
        }
        return { image: q, size: css.size, position: css.position, repeat: css.repeat };
    }

    /**
     * Today's background: a picture set from Pictures & Videos (Menu > Set as Today Background),
     * else the workspace's desktop wallpaper, else the page background. Both are placed by the
     * workspace's phone placement (Settings > Today > Wallpaper), else the desktop's.
     */
    /**
     * Settings > Today > Wallpaper > Use (#799): 'workspace' (the desktop wallpaper), 'selected' (a
     * picture) or 'android' (the phone's own wallpaper: Android draws it behind the page, each screen
     * of a foldable its own). Device-local wmTodayWallSource; without it, the older "use desktop".
     */
    const WALL_SOURCE_KEY = 'wmTodayWallSource';
    const androidWallAvailable = () => !!(window.AndroidHome && typeof window.AndroidHome.wallpaperInfo === 'function' && !(window.AndroidHome.isExternalDisplay && window.AndroidHome.isExternalDisplay()));

    /**
     * Android Wallpaper as a picture (#799): the app reads the wallpaper this screen draws (a foldable's
     * cover or main one) and serves it (AndroidWallpaper.kt); Today draws it like any picture, so the
     * page stays opaque. (A see-through window over the system wallpaper left Samsung's surface
     * uncleared on the Fold7: old frames, no wallpaper.) A live wallpaper has no picture: '' (the
     * workspace's then).
     */
    function androidWallUrl() {
        try {
            const i = JSON.parse(window.AndroidHome.wallpaperInfo() || 'null');
            return i && i.url && !i.live ? i.url : '';
        } catch (_) { return ''; }
    }
    function todayWallSource() {
        let s = null;
        try { s = localStorage.getItem(WALL_SOURCE_KEY); } catch (_) { /* storage off */ }
        if (s === 'android') return androidWallAvailable() ? 'android' : 'workspace';
        if (s === 'workspace' || s === 'selected') return s;
        let useDesktop = true;
        try {
            useDesktop = window.wmSettings && typeof window.wmSettings.todayUsesDesktop === 'function'
                ? window.wmSettings.todayUsesDesktop()
                : localStorage.getItem('wmTodayUseDesktop') !== '0';
        } catch (_) { /* default */ }
        return useDesktop ? 'workspace' : 'selected';
    }

    // the window shows Android's wallpaper (and the page lets it through) only while chosen
    // the see-through window of the first try is switched off once (builds that turned it on)
    let androidWallOff = false;
    function applyAndroidWall() {
        document.documentElement.classList.remove('wm-android-wall');
        if (androidWallOff || !window.AndroidHome || typeof window.AndroidHome.setShowWallpaper !== 'function') return;
        androidWallOff = true;
        try { window.AndroidHome.setShowWallpaper(false); } catch (_) { /* bridge gone */ }
    }
    // a new Android wallpaper, or the other screen of a foldable: Today draws the matching picture
    window.addEventListener('androidwallpaper', () => { if (todayWallSource() === 'android') applyTodayBackground(true); });
    let wallResize = 0;
    window.addEventListener('resize', () => {
        clearTimeout(wallResize);
        wallResize = setTimeout(() => { if (todayWallSource() === 'android') applyTodayBackground(false); }, 400);
    });

    function todayPicture() {
        if (todayWallSource() === 'android') {
            const a = androidWallUrl();
            if (a) return a;
        }
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
        applyAndroidWall();
        const url = todayPicture();
        const placement = wallpaperPlacement();
        const fx = todayEffect();
        const key = `${url}|${placement.size}|${placement.position}|${fx.effect}|${fx.level}`;
        if (!force && key === todayBgKey) return;
        todayBgKey = key;
        const set = (u, drawn) => {
            const css = placementCss(placement, u && naturalSizes.get(u));
            const bg = u ? effectBackground(drawn || u, css, fx) : { image: '', size: css.size, position: css.position, repeat: css.repeat };
            today.page.style.backgroundImage = bg.image;
            today.page.style.backgroundSize = bg.size;
            today.page.style.backgroundPosition = bg.position;
            today.page.style.backgroundRepeat = bg.repeat;
            // Fit and Center leave margins: WM painted a solid colour there, not the workspace
            // theme behind the shell (black, like the Settings preview)
            today.page.style.backgroundColor = u ? '#000' : '';
            // Android's wallpaper shows through (wm-android-wall in wm-shell.css): text keeps its picture shadow
            today.page.classList.toggle('has-picture', !!u);
            const wall = WM65 && shell.querySelector('.wm-wall65');
            if (wall) {
                Object.assign(wall.style, { backgroundImage: bg.image, backgroundSize: bg.size, backgroundPosition: bg.position, backgroundRepeat: bg.repeat });
                wall.hidden = !u;
                shell.classList.toggle('has-wall65', !!u);
            }
        };
        set(url);
        if (url) {
            // a picture that no longer loads falls back to the workspace background;
            // Tile and Center need its pixel size
            const probe = new Image();
            probe.onerror = () => { set(null); todayBgKey = ''; };
            probe.onload = () => {
                naturalSizes.set(url, { w: probe.naturalWidth, h: probe.naturalHeight });
                if (todayBgKey === key && (placement.size === 'tile' || placement.size === 'center') && fx.effect !== 'blur') set(url);
            };
            // Blur: the blurred copy once it is drawn (the sharp picture until then)
            if (fx.effect === 'blur') blurredPicture(url, fx.level).then((b) => { if (b && todayBgKey === key) set(url, b); });
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
    /** A print's fit preview (<file stem>@fit.webp, made by the server on first request, #788). */
    function fitPreviewUrl(item) {
        const file = item && (item.original || item.filename || item.upscaled);
        if (!file || typeof file !== 'string') return '';
        const stem = file.split('/').pop().replace(/\.(png|jpe?g|webp)$/i, '');
        return stem ? `/previews/${encodeURIComponent(`${stem}@fit.webp`)}` : '';
    }

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

    /**
     * Settings > Today > Items > Options... (WM 6.1's Options button): per-row choices, stored per
     * device in wmTodayOptions = { rowId: { key: value } }. The shell's own rows have these; an app's
     * row brings its own (registerTodayItem options: [{ key, label, choices: [[value, label]], value }];
     * type: 'checks' lists check boxes instead, the value the comma list of the unchecked choices).
     */
    const TODAY_OPTIONS_KEY = 'wmTodayOptions';
    const TODAY_BUILTIN_OPTIONS = {
        prints: [
            { key: 'size', label: 'Picture size', value: 'medium', choices: [['small', 'Small'], ['medium', 'Medium'], ['large', 'Large'], ['xlarge', 'Extra Large']] },
            { key: 'rows', label: 'Rows', value: '1', choices: [['1', '1'], ['2', '2'], ['3', '3']] }
        ],
        messages: [{ key: 'empty', label: 'With no unread messages', value: 'show', choices: [['show', 'Show the row'], ['hide', 'Hide the row']] }],
        // Settings > Today > Wallpaper: the picture's effect and its level (not a Today row)
        wallpaper: [
            { key: 'effect', label: 'Effect', value: 'none', choices: [['none', 'None'], ['lighten', 'Lighten'], ['darken', 'Darken'], ['blur', 'Blur']] },
            { key: 'level', label: 'Level', value: '50', choices: Array.from({ length: 21 }, (_, i) => [String(i * 5), `${i * 5}%`]) }
        ],
        tasks: [{ key: 'empty', label: 'With no tasks', value: 'show', choices: [['show', 'Show the row'], ['hide', 'Hide the row']] }],
        // 6.5 home screen: the workspaces that get a page of their own after the current one. A
        // 'checks' option stores the unchecked ids; unset, none is a favourite (value = every id)
        workspace: [{
            key: 'favorites', label: 'Favorite workspaces', type: 'checks',
            get choices() { return workspaceList().map((w) => [w.id, w.name || w.id]); },
            get value() { return workspaceList().map((w) => w.id).join(','); }
        }]
    };

    function workspaceList() {
        try {
            if (typeof workspaces !== 'undefined' && workspaces) {
                return Object.values(workspaces).filter(Boolean).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name)));
            }
        } catch (_) { /* not loaded */ }
        return [];
    }
    const TODAY_PRINT_SIZE = { small: 32, medium: 44, large: 64, xlarge: 88 };

    function todayOptionDefs(id) {
        if (TODAY_BUILTIN_OPTIONS[id]) return TODAY_BUILTIN_OPTIONS[id];
        const w = todayWidgets.find((x) => x.id === id);
        return (w && Array.isArray(w.options)) ? w.options : [];
    }

    function todayOption(id, key) {
        let all = null;
        try { all = JSON.parse(localStorage.getItem(TODAY_OPTIONS_KEY) || 'null'); } catch (_) { all = null; }
        const v = all && all[id] && all[id][key];
        const def = todayOptionDefs(id).find((o) => o.key === key);
        // type 'checks': a check box per choice, stored as the comma list of the unchecked values
        // (a string: the workspace field keeps no arrays), so new choices start checked
        if (def && def.type === 'checks') return typeof v === 'string' ? v : (def.value || '');
        if (def && def.choices.some(([c]) => c === v)) return v;
        return def ? def.value : (v == null ? null : v);
    }

    // 6.5's home screen (wmTitanium.js): { refresh(page), softKeys(keys) } drawn over Today's rows
    let todayView = null;
    function setTodayView(view) {
        todayView = view || null;
        const today = apps.get('today');
        if (today && today.page) { today.refresh(); if (current === 'today') renderSoftKeys(); }
    }

    function registerTodayItem(w) {
        if (!w || !w.id || (typeof w.text !== 'function' && typeof w.render !== 'function') || todayWidgets.some((x) => x.id === w.id)) return;
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
        // mail comes by push (dovecote_mailbox_updated); a failed first read is tried again when the
        // socket comes back, else after 5 min, not from the Today repaint (no polling, Yukimi Nov 13)
        let mailFailedAt = 0;
        const MAIL_RETRY_MS = 300000;
        let mailWiredWs = null;
        let recentKey = '';

        const setText = (el, text) => { if (el && el.textContent !== text) el.textContent = text; };

        async function loadMail() {
            const ws = window.wsClient;
            if (ws && ws !== mailWiredWs && typeof ws.on === 'function') {
                mailWiredWs = ws;
                ws.on('connected', () => { if (mailUnread == null) { mailFailedAt = 0; loadMail(); } });
            }
            if (mailLoading || Date.now() - mailFailedAt < MAIL_RETRY_MS) return;
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
                mailNewCheck();
                ok = true;
            } catch (_) { /* mail unavailable: the row keeps its last text */ }
            mailLoading = false;
            if (!ok) { mailFailedAt = Date.now(); return; }
            mailFailedAt = 0;
            if (current === 'today') today.refresh();
        }

        /**
         * The phone line under the time (6.1's phone row, 6.5's clock panel), as the device shows it:
         * the carrier, or the radio's state (Yukimi, #760). Connecting / installing is the
         * connectivity icon's animation and its bubble now (paintSync).
         */
        function carrierText() {
            const dev = deviceView();
            const c = dev.cell;
            if (!c || c.present === false || dev.airplane || c.radioOn === false) return { text: 'Phone off', plain: false };
            if (c.simState === 'absent') return { text: 'No SIM card', plain: false };
            if (c.simState === 'locked') return { text: 'SIM locked', plain: false };
            if (typeof c.operator === 'string' && c.operator.trim()) return { text: c.operator.trim(), plain: false };
            if (c.searching === true) return { text: 'Searching...', plain: false };
            return { text: 'No service', plain: false };
        }

        function tasksText() {
            // the Tasks program's own count ("2 Active tasks" / "1 High priority", as the device's
            // Today row), the prints in progress with it (wmTasks.js summary)
            try {
                if (window.wmTasks && typeof window.wmTasks.summary === 'function') return window.wmTasks.summary().text || 'No tasks';
            } catch (_) { /* the print count alone */ }
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
            if (sub && Number.isFinite(Number(sub.tier)) && todayOption('novelai', 'show') !== 'balance') {
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
                // the Messaging row opens Messaging on the account with news: unread text messages
                // alone open Text Messaging (#779), Dreamscape Messenger lines alone open it, else
                // Dreamscape Mail's Inbox (not the account picker, #763)
                page.querySelector('[data-row="messages"]').addEventListener('click', () => busy(() => {
                    const chat = window.wmChatApp;
                    const msg = window.wmMessaging;
                    const text = window.wmTextShell;
                    const sms = smsUnread() > 0;
                    const im = chatUnread() > 0;
                    // unread IMAP mail (#789) alone opens the account with the most of it
                    const imap = imapUnread() > 0 && !(mailUnread > 0) && msg && typeof msg.imapAccounts === 'function' ? msg.imapAccounts().filter((a) => a.unread > 0).sort((x, y) => y.unread - x.unread)[0] : null;
                    if (sms && !im && !(mailUnread > 0) && !imapUnread() && text && typeof text.openAccount === 'function') text.openAccount();
                    else if (im && !sms && !(mailUnread > 0) && !imapUnread() && chat && typeof chat.showList === 'function') chat.showList();
                    else if (imap && !sms && !im) msg.goTo(`imap:${imap.id}`);
                    else if (msg && typeof msg.goTo === 'function') msg.goTo('mail');
                    else open('messaging');
                }, { paint: true, timeout: 15000 }));
                // the Tasks row opens Tasks (device); the list changing repaints the row
                page.querySelector('[data-row="tasks"]').addEventListener('click', () => busy(() => {
                    if (window.wmTasks && typeof window.wmTasks.open === 'function') window.wmTasks.open();
                }, { paint: true, timeout: 15000 }));
                document.addEventListener('wmTasksChange', () => { if (current === 'today') this.refresh(); });
                page.querySelector('[data-row="search"]').addEventListener('submit', (e) => {
                    e.preventDefault();
                    const input = e.currentTarget.querySelector('input');
                    const q = input.value.trim();
                    input.value = '';
                    input.blur();
                    busy(() => {
                        open('gallery');
                        if (q) {
                            const gallery = apps.get('gallery');
                            if (gallery && typeof gallery.search === 'function') gallery.search(q);
                        }
                    }, { paint: true, timeout: 15000 });
                });
                page.querySelector('[data-row="prints"]').addEventListener('click', (e) => {
                    const tile = e.target.closest('[data-filename]');
                    if (!tile) return;
                    busy(() => {
                        open('gallery');
                        // the gallery's own viewer (PhotoSwipe), on the print that was tapped
                        try {
                            if (typeof showLightbox === 'function') showLightbox({ filename: tile.dataset.filename });
                        } catch (_) { /* the gallery opens without the viewer */ }
                    }, { paint: true, timeout: 15000 });
                });
                document.addEventListener('dovecoteMailboxUpdated', (ev) => {
                    const boxes = ev.detail && ev.detail.mailboxes;
                    if (!boxes) { loadMail(); return; }
                    const owner = typeof DESKTOP_DOVECOTE_HUMAN_OWNER !== 'undefined' ? DESKTOP_DOVECOTE_HUMAN_OWNER : 'yukimi';
                    const mine = boxes.find((b) => b.owner === owner);
                    mailUnread = mine ? (mine.unread || 0) : 0;
                    shellMailUnread = mailUnread;
                    mailNewCheck();
                    refreshStatus();
                });
                window.addEventListener('meletonaccountschange', () => today.refresh());
                const back = () => { if (today.stale && current === 'today') today.refresh(); };
                document.addEventListener('visibilitychange', back);
                window.addEventListener('melatonscreen', (e) => { if (e.detail && e.detail.on) back(); });
            },
            show() {
                if (mailUnread == null) loadMail();
                this.stale = false;
                this.refresh();
            },
            refresh() {
                const page = this.page;
                if (!page) return;
                // nothing draws Today while it is not on screen (another app in front, the page hidden,
                // the screen off): it is marked stale and drawn in full when it shows again (Yukimi,
                // Nov 14: Traffic's minute tick laid it out behind the Pictures app)
                if (current !== 'today' || document.hidden || root.dataset.screenOff !== undefined) { this.stale = true; return; }
                this.stale = false;
                applyTodayBackground();
                const now = new Date();
                setText(page.querySelector('[data-f="day"]'), fmtDay.format(now));
                setText(page.querySelector('[data-f="date"]'), fmtDate.format(now));
                setText(page.querySelector('[data-f="time"]'), fmtTime.format(now));
                setText(page.querySelector('[data-f="connection"]'), carrierText().text);
                const acc = window.meletonAccounts;
                setText(page.querySelector('[data-f="owner"]'), acc && typeof acc.name === 'function' ? acc.name() : 'Owner');
                if (mailUnread == null) {
                    if (window.wsClient && window.wsClient.initializationCompleted) loadMail();
                } else {
                    // unread e-mail, text messages (Text Messaging, #779) and Dreamscape Messenger lines together
                    const unread = mailUnread + imapUnread() + smsUnread() + chatUnread();
                    setText(page.querySelector('[data-f="messages"]'), unread ? `${unread} unread ${unread === 1 ? 'message' : 'messages'}` : 'No unread messages');
                }
                const tasks = tasksText();
                setText(page.querySelector('[data-f="tasks"]'), tasks);
                page.querySelector('[data-row="tasks"]').hidden = tasks === 'No tasks' && todayOption('tasks', 'empty') === 'hide';
                if (mailUnread != null) page.querySelector('[data-row="messages"]').hidden = !(mailUnread + imapUnread() + smsUnread() + chatUnread()) && todayOption('messages', 'empty') === 'hide';
                // the Director, NovelAI balance and calendar items are widgets now (wmTodayWidgets.js,
                // wmAccounts.js: registerTodayItem)
                const wsEl = page.querySelector('[data-f="workspace"]');
                try {
                    if (typeof workspaces !== 'undefined' && typeof activeWorkspace !== 'undefined' && workspaces[activeWorkspace]) {
                        setText(wsEl, workspaces[activeWorkspace].name);
                    }
                } catch (_) { /* workspaces not loaded yet */ }
                if (!wsEl.textContent) wsEl.textContent = 'Workspace';
                // newest prints: as many square tiles as fit one row
                const strip = page.querySelector('[data-row="prints"]');
                // Options: picture size and rows
                const tile = TODAY_PRINT_SIZE[todayOption('prints', 'size')] || 44;
                const rows = Number(todayOption('prints', 'rows')) || 1;
                strip.style.setProperty('--wm-today-tile', String(tile));
                strip.style.setProperty('--wm-today-rows', String(rows));
                // exactly the tiles that fit the rows (extra ones would add empty grid rows and gaps)
                const pxv = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
                const width = (strip.clientWidth || page.clientWidth) - 6 * pxv;
                const cols = Math.max(1, Math.floor((width + 2 * pxv) / ((tile + 2) * pxv)));
                const prints = newestPrints(cols * rows);
                const key = prints.map((p) => p.filename || p.preview).join('|');
                if (key !== recentKey) {
                    recentKey = key;
                    strip.innerHTML = prints.map((p) => `<button type="button" class="wm-today-print" data-filename="${escapeHtml(p.filename || p.original || '')}" aria-label="${escapeHtml(p.filename || 'Print')}" style="background-image:url('${escapeHtml(previewUrl(p))}')"></button>`).join('');
                }
                strip.hidden = !prints.length;
                paintTodayWidgets(page);
                applyTodayItems(page);
                markTodayLast(page);
                // 6.5: the Melaton Default home screen draws from the rows above (wmTitanium.js)
                if (todayView) { try { todayView.refresh(page); } catch (err) { console.warn('[wmShell] today view', err); } }
            },
            /** What Today's rows show, as data (6.5's home screen panels, wmTitanium.js). */
            state() {
                const acc = window.meletonAccounts;
                let workspace = '';
                try { if (typeof workspaces !== 'undefined' && typeof activeWorkspace !== 'undefined' && workspaces[activeWorkspace]) workspace = workspaces[activeWorkspace].name || ''; } catch (_) { /* not loaded yet */ }
                const tasks = tasksText();
                return {
                    connection: carrierText(),
                    owner: acc && typeof acc.name === 'function' ? acc.name() : '',
                    // the e-mail count: Dreamscape Mail and the IMAP accounts (#789)
                    mailUnread: mailUnread == null ? null : mailUnread + imapUnread(),
                    smsUnread: smsUnread(),
                    chatUnread: chatUnread(),
                    tasks: tasks === 'No tasks' ? '' : tasks,
                    workspace,
                    workspaceMenu: () => workspaceMenu(),
                    workspaces: (() => {
                        const active = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
                        const off = new Set(String(todayOption('workspace', 'favorites') || '').split(',').filter(Boolean));
                        return workspaceList().map((w) => ({ id: w.id, name: w.name || w.id, count: Number.isFinite(Number(w.fileCount)) ? Number(w.fileCount) : null, active: w.id === active, favorite: !off.has(String(w.id)) }));
                    })(),
                    switchWorkspace: (id) => { if (typeof setActiveWorkspace === 'function') setActiveWorkspace(id); },
                    prints: newestPrints(12).map((p) => ({ filename: p.filename || p.original || '', preview: previewUrl(p), time: p.mtime || p.timestamp || p.date || null }))
                };
            },
            softKeys() {
                // Settings > Buttons picks each key (todaySoftKeyFor); Pictures | Menu by default
                const menu = () => workspaceMenu().concat(['-', { label: 'Reconnect', disabled: !!(window.wsClient && window.wsClient.isConnected()), action: () => window.wsClient && window.wsClient.manualReconnect() }]);
                const keys = { left: todaySoftKeyFor('left', menu), right: todaySoftKeyFor('right', menu) };
                // which keys were chosen in Settings > Buttons (6.5's clock panel keeps its "Set" until the right one is, #796)
                keys.custom = todaySoftKeysChosen();
                // a notification is waiting: the device's left soft key on Today reads "Notification"
                // and opens it, whatever the key is set to
                if (notes.length) keys.left = { label: 'Notification', action: () => noteIconTap() };
                if (todayView && typeof todayView.softKeys === 'function') {
                    try { return todayView.softKeys(keys) || keys; } catch (err) { console.warn('[wmShell] today view keys', err); }
                }
                return keys;
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
                    // a block (render): the widget draws its own content in a Today item box; a row
                    // (text): icon + one line, like the shell's rows
                    const block = typeof w.render === 'function';
                    row = document.createElement(w.onTap && !block ? 'button' : 'div');
                    if (w.onTap && !block) { row.type = 'button'; row.addEventListener('click', () => { try { w.onTap(); } catch (err) { console.warn('[wmShell] today item', w.id, err); } }); }
                    row.className = block ? 'wm-today-block' : `wm-today-row${w.onTap ? '' : ' is-plain'}`;
                    row.dataset.row = w.id;
                    if (!block) row.innerHTML = `${imgTag(w.icon || 'app-programs')}<span class="wm-today-text"></span>`;
                    const after = w.after && page.querySelector(`[data-row="${CSS.escape(w.after)}"]`);
                    if (after) after.after(row); else page.querySelector('[data-row="search"]').before(row);
                    itemsKey = null; // the stored order places the new row next time
                }
                if (typeof w.render === 'function') {
                    // render(el, { option }) returns false to hide the block; it repaints only what changed
                    let shown = true;
                    try { shown = w.render(row, { option: (key) => todayOption(w.id, key) }) !== false; } catch (err) { shown = false; console.warn('[wmShell] today block', w.id, err); }
                    row.hidden = !shown;
                    continue;
                }
                let text = '';
                try { text = String(w.text() || ''); } catch (_) { text = ''; }
                row.hidden = !text;
                setText(row.querySelector('.wm-today-text'), text);
            }
        }

        /** The last row on screen draws no rule under it (rows hide and switch off, so CSS cannot tell). */
        function markTodayLast(page) {
            let last = null;
            page.querySelectorAll(':scope > [data-row]').forEach((row) => {
                row.classList.remove('is-last');
                if (!row.hidden && !row.classList.contains('wm-today-off')) last = row;
            });
            if (last) last.classList.add('is-last');
        }

        // Settings > Today > Items: order and on / off of the rows (wmTodayItems = [{ id, on }])
        let itemsKey = null;
        function applyTodayItems(page) {
            let list = null;
            let raw = null;
            try { raw = localStorage.getItem(TODAY_ITEMS_KEY); list = JSON.parse(raw || 'null'); } catch (_) { list = null; }
            const off = new Set();
            // a widget that ships switched off (defaultOn: false) stays off until Settings turns it on
            const saved = new Set(Array.isArray(list) ? list.map((it) => it && it.id) : []);
            todayWidgets.forEach((w) => { if (w.defaultOn === false && !saved.has(w.id)) off.add(w.id); });
            if (Array.isArray(list)) {
                list.forEach((it) => { if (it && it.id && it.on === false) off.add(it.id); });
                if (raw !== itemsKey) {
                    // the rows in the stored order; rows not in the list keep their place at the end,
                    // or go after the row they name (an item newer than the list: 6.5's text, #763)
                    list.forEach((it) => {
                        const row = page.querySelector(`[data-row="${CSS.escape(String(it.id))}"]`);
                        if (row) page.appendChild(row);
                    });
                    [...page.querySelectorAll(':scope > [data-row]')].forEach((row) => {
                        if (list.some((it) => it && it.id === row.dataset.row)) return;
                        const w = todayWidgets.find((x) => x.id === row.dataset.row);
                        const at = w && w.after && list.some((it) => it && it.id === w.after) ? page.querySelector(`:scope > [data-row="${CSS.escape(String(w.after))}"]`) : null;
                        if (at) at.after(row); else page.appendChild(row);
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
        // Pictures & Videos' storage cards (wmPhoneGallery.js, #788): the phone's albums beside My
        // Device (this device's internal storage: the gallery's views). phoneOn(): a card folder is on screen
        const phoneGallery = () => (window.wmPhoneGallery && window.wmPhoneGallery.available() ? window.wmPhoneGallery : null);
        const phoneOn = () => { const g = phoneGallery(); return !!(g && g.location()); };
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
            if (phoneOn()) { phoneGallery().search(q); return; }
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
            if (window.wmPhoneGallery) window.wmPhoneGallery.search('');
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
            const g = phoneOn() ? phoneGallery() : null;
            page.querySelector('.wm-pv-folder span').textContent = g ? g.barLabel() : (searchResults ? 'Search results' : (view ? view[1] : 'Pictures'));
            // the volume's picture beside the folder: the device or the storage card (ref-pv captures)
            const icon = g ? 'fe-storage-card' : 'fe-device';
            const img = page.querySelector('.wm-pv-folder img');
            if (img && img.dataset.icon !== icon) { img.dataset.icon = icon; img.src = art(icon); img.srcset = srcset(icon); }
            const sortBtn = page.querySelector('.wm-pv-sort');
            // the tool row (search, Jump to Top, Visual Index, sizes) is the workspace prints' own:
            // a storage card shows the folder bar and the grid alone (Yukimi #788)
            const tools = page.querySelector('.wm-pv-tools');
            if (tools) tools.hidden = !!g;
            if (g) {
                if (dropdownAnchor !== sortBtn) sortBtn.querySelector('span').textContent = g.searching() ? 'Relevance' : g.sortLabel();
                sortBtn.disabled = g.searching();
                return;
            }
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
            const pgal = window.wmPhoneGallery;
            if (pgal) pgal.render(page, force);
            if (phoneOn()) { renderFolderBar(page); return; }
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
                    const sel = (name === selectedName ? ' is-selected' : '') + (picked && picked.has(name) ? ' is-picked' : '');
                    // the print in its own proportions (@fit.webp, #788), the square preview if there is none
                    const square = previewUrl(item);
                    const fit = fitPreviewUrl(item) || square;
                    html += `<button type="button" class="wm-pv-cell wm-photo${sel}" data-filename="${escapeHtml(name)}" aria-label="${escapeHtml(name)}"><img src="${escapeHtml(fit)}"${fit !== square && square ? ` data-fallback="${escapeHtml(square)}"` : ''} alt="" loading="lazy" decoding="async" draggable="false"></button>`;
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

        /*
         * Multi-select (Yukimi, Nov 14): Menu > Select Pictures (or a picture's hold menu) ticks
         * pictures with taps (drawn as a storage card's Select Pictures, wm-shell.css .is-picked); Done | Menu with Delete, Move To, Move to Scraps / Restore, Select All
         * and Clear Selection, run by the desktop gallery's own bulk code (bulkOperationsManager.js:
         * its selectedImages, its questions, which are WM message boxes here). A cancelled question
         * keeps the selection.
         */
        let picked = null; // Set of file names while selecting, else null
        const pickName = (it) => (it && (it.filename || it.original)) || '';
        function pickTitle() { setTitle(picked ? `${picked.size} selected` : 'Pictures & Videos'); }
        function startPick(page, name) {
            picked = new Set(name ? [name] : []);
            page.classList.add('is-picking');
            if (name) { const el = page.querySelector(`.wm-pv-cell[data-filename="${CSS.escape(name)}"]`); if (el) el.classList.add('is-picked'); }
            pickTitle();
            if (current === 'gallery') renderSoftKeys();
        }
        function togglePick(page, name) {
            if (!picked || !name) return;
            if (picked.has(name)) picked.delete(name); else picked.add(name);
            const el = page.querySelector(`.wm-pv-cell[data-filename="${CSS.escape(name)}"]`);
            if (el) el.classList.toggle('is-picked', picked.has(name));
            pickTitle();
            if (current === 'gallery') renderSoftKeys();
        }
        function endPick(page) {
            picked = null;
            page.classList.remove('is-picking');
            page.querySelectorAll('.wm-pv-cell.is-picked').forEach((c) => c.classList.remove('is-picked'));
            pickTitle();
            if (current === 'gallery') renderSoftKeys();
        }
        function pickAll(page, on) {
            if (!picked) return;
            if (on) galleryList().forEach((it) => { const n = pickName(it); if (n) picked.add(n); }); else picked.clear();
            page.querySelectorAll('.wm-pv-cell').forEach((c) => c.classList.toggle('is-picked', picked.has(c.dataset.filename)));
            pickTitle();
            if (current === 'gallery') renderSoftKeys();
        }
        async function runPicked(page, kind, arg) {
            if (!picked || !picked.size || typeof selectedImages === 'undefined') return;
            const names = [...picked];
            try {
                selectedImages.clear();
                try { isAllSelected = false; } catch (_) { /* older gallery */ } // eslint-disable-line no-undef
                names.forEach((n) => selectedImages.add(n));
                if (kind === 'delete' && typeof handleBulkDelete === 'function') await handleBulkDelete();
                else if (kind === 'scraps' && typeof handleBulkMoveToScraps === 'function') await handleBulkMoveToScraps();
                else if (kind === 'unscrap' && typeof handleBulkUnscrap === 'function') await handleBulkUnscrap();
                else if (kind === 'move' && typeof moveBulkImagesToWorkspace === 'function') await busy(() => moveBulkImagesToWorkspace(arg), { paint: true, timeout: 60000 });
            } catch (err) {
                console.warn('[wmShell] pictures bulk', kind, err);
            } finally {
                try { selectedImages.clear(); } catch (_) { /* gone */ }
            }
            // done: the pictures left the list; cancelled: all of them are still there and stay ticked
            const left = new Set(galleryList().map(pickName));
            if (picked && names.every((n) => left.has(n)) && kind !== 'move') return;
            endPick(page);
        }
        function pickedMoveItems(page) {
            let list = [];
            try { if (typeof workspaces !== 'undefined') list = Object.values(workspaces).filter(Boolean).sort((a, b) => (Number(a.sort) || 0) - (Number(b.sort) || 0) || String(a.name).localeCompare(String(b.name))); } catch (_) { list = []; }
            const active = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
            const others = list.filter((w) => w.id !== active);
            if (!others.length) return [{ label: 'No other workspaces', disabled: true }];
            return others.map((w) => ({ label: w.name || w.id, action: () => runPicked(page, 'move', w.id) }));
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
                    localStorage.setItem(WALL_SOURCE_KEY, 'workspace');
                } else {
                    // the viewer passes its own item: a picture opened from Director or Today need not be in this list
                    const pic = (item && (item.filename || item.original) === name) ? item : galleryList().find((it) => (it.filename || it.original) === name);
                    const url = pic && todayPictureUrl(pic);
                    if (!url) {
                        messageBox({ title: 'Pictures', icon: 'error', text: 'This picture cannot be set as the Today background.' });
                        return;
                    }
                    localStorage.setItem(TODAY_BG_KEY, url);
                    localStorage.setItem(useKey, '0');
                    localStorage.setItem(WALL_SOURCE_KEY, 'selected');
                }
            } catch (_) {
                messageBox({ title: 'Pictures', icon: 'error', text: 'The Today background could not be saved on this device.' });
                return;
            }
            document.dispatchEvent(new CustomEvent('wmSettingsChange', { detail: { keys: [useKey, TODAY_BG_KEY, WALL_SOURCE_KEY] } }));
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
            const gp = apps.get('gallery') && apps.get('gallery').page;
            return [
                { label: 'View', action: () => viewPicture(name) },
                { label: 'Select Pictures', disabled: !gp, action: () => startPick(gp, name) },
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

        /**
         * WM's folder drop-down (ref-pv/03-folder-menu.png): My Device with its folders (the gallery
         * views, the current one with a dot), a rule, then each storage card with its folder tree.
         */
        function folderMenu() {
            const view = activeView();
            const g = phoneGallery();
            const onCard = phoneOn();
            const toDevice = (v) => {
                const page = apps.get('gallery') && apps.get('gallery').page;
                if (onCard) void g.open(null);
                if (v && v !== view) switchView(v);
                if (page) renderGrid(page, true);
                if (current === 'gallery') renderSoftKeys();
            };
            return [
                { label: 'My Device', icon: 'fe-device', action: () => toDevice(null) },
                ...VIEWS.map(([v, label]) => ({ label, indent: 1, radio: !onCard && view === v, action: () => toDevice(v) })),
                ...(g ? ['-', ...g.folderItems()] : [])
            ];
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
            softLabel: 'Pictures',
            icon: 'app-pictures',
            inStart: 'top',
            mount(page) {
                page.classList.add('wm-pv');
                page.innerHTML = `
                    <div class="wm-pv-bar">
                        <button type="button" class="wm-pv-folder" aria-haspopup="menu">${imgTag('fe-device')}<span></span><i class="wm-pv-arrow"></i></button>
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
                    else if (b.dataset.act === 'index') { if (!phoneOn()) open('pv-vindex'); }
                    else stepSize(page, b.dataset.act === 'larger' ? 1 : -1);
                });
                // a print without a fit preview (the server could not make one): its square preview
                page.querySelector('.wm-pv-grid').addEventListener('error', (e) => {
                    const img = e.target;
                    if (img && img.tagName === 'IMG' && img.dataset.fallback) { const f = img.dataset.fallback; delete img.dataset.fallback; img.src = f; }
                }, true);
                page.querySelector('.wm-pv-grid').addEventListener('click', (e) => {
                    const cell = e.target.closest('.wm-pv-cell');
                    if (!cell) return;
                    // selecting several: a tap ticks or unticks
                    if (picked) { togglePick(page, cell.dataset.filename); return; }
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
                    if (picked) { togglePick(page, cell.dataset.filename); return; }
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
                    if (phoneOn()) {
                        const g = phoneGallery();
                        if (g.searching()) return;
                        const opening = !(openPopup && dropdownAnchor === btn);
                        if (opening) btn.querySelector('span').textContent = 'Sort By';
                        showDropdown(btn, g.sortItems(page), 'right', () => renderFolderBar(page));
                        return;
                    }
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
                // the storage cards' state for the drop-down (the app opens on My Device's prints,
                // Yukimi #788; a card picked there opens on its camera roll); a later change redraws
                const pgal = window.wmPhoneGallery;
                if (pgal) {
                    pgal.init(() => {
                        const pg = apps.get('gallery') && apps.get('gallery').page;
                        if (pg) renderGrid(pg, false);
                        if (current === 'gallery') renderSoftKeys();
                    }).catch(() => { /* My Device alone */ });
                }
                // the first fill of the grid behind WM's wait cursor (the folder bar and soft keys are
                // up at once); later shows only redraw what changed
                if (!gridSig) busy(() => renderGrid(page, false), { paint: true });
                else renderGrid(page, false);
                // the desktop gallery keeps loading, paging and searching underneath (allImages):
                // follow it while Pictures is on screen
                clearInterval(gridTimer);
                gridTimer = setInterval(() => { if (onScreen(page)) renderGrid(page, false); }, 700);
            },
            hide() {
                clearInterval(gridTimer);
                gridTimer = null;
                if (picked && this.page) endPick(this.page);
            },
            softKeys() {
                const page = this.page;
                if (phoneOn()) return phoneGallery().softKeys(page);
                if (picked) {
                    const n = picked.size;
                    const scrapsView = typeof currentGalleryView !== 'undefined' && currentGalleryView === 'scraps';
                    return {
                        left: { label: 'Done', action: () => endPick(page) },
                        right: {
                            label: 'Menu',
                            menu: () => [
                                { label: n === 1 ? 'Delete' : `Delete ${n} Pictures`, disabled: !n, action: () => runPicked(page, 'delete') },
                                { label: 'Move To', disabled: !n, submenu: () => pickedMoveItems(page) },
                                { label: scrapsView ? 'Restore from Scraps' : 'Move to Scraps', disabled: !n, action: () => runPicked(page, scrapsView ? 'unscrap' : 'scraps') },
                                '-',
                                { label: 'Select All', action: () => pickAll(page, true) },
                                { label: 'Clear Selection', disabled: !n, action: () => pickAll(page, false) }
                            ]
                        }
                    };
                }
                return {
                    left: { label: 'View', disabled: !selectedName, action: () => viewPicture(selectedName) },
                    right: {
                        label: 'Menu',
                        // WM: Camera, Send..., Beam..., Save to Contact... | Delete, Edit, Play Slide
                        // Show, Set as Today Background..., Go To, Tools; here what Dreamscape has
                        menu: () => [
                            { label: 'Select Pictures', action: () => startPick(page, null) },
                            '-',
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

    // ---------------------------------------------------------------- Today soft keys

    /**
     * WM 6.1 Settings > Buttons for the Today screen's soft keys (Yukimi, Nov 10): each key runs an
     * action (<Menu> = Today's own workspace menu, <Start Menu>, <Notifications>, <None>) or opens a
     * program. Stored per device (localStorage wmTodaySoftKeys { left, right }: 'menu' | 'start' |
     * 'notifications' | 'none' | 'app:<id>'); Pictures | Menu by default.
     */
    const TODAY_KEYS_KEY = 'wmTodaySoftKeys';
    const TODAY_KEY_DEFAULT = { left: 'app:gallery', right: 'menu' };
    const TODAY_KEY_SHORT = { gallery: 'Pictures' };
    const TODAY_KEY_ACTIONS = [['menu', '<Menu>', 'Menu'], ['none', '<None>', ''], ['notifications', '<Notifications>', 'Notifications'], ['start', '<Start Menu>', 'Start']];

    function todaySoftKeys() {
        let v = null;
        try { v = JSON.parse(localStorage.getItem(TODAY_KEYS_KEY) || 'null'); } catch (_) { v = null; }
        const out = { ...TODAY_KEY_DEFAULT };
        for (const side of ['left', 'right']) if (v && typeof v[side] === 'string' && v[side]) out[side] = v[side];
        return out;
    }

    /** { left, right }: true for a key the user set in Settings > Buttons (not the default). */
    function todaySoftKeysChosen() {
        let v = null;
        try { v = JSON.parse(localStorage.getItem(TODAY_KEYS_KEY) || 'null'); } catch (_) { v = null; }
        return { left: !!(v && typeof v.left === 'string' && v.left), right: !!(v && typeof v.right === 'string' && v.right) };
    }

    /** The programs a soft key can open: Start menu / Programs apps (not Today itself). */
    function todayKeyPrograms() {
        return [...apps.values()].filter((a) => a.inStart && a.id !== 'today')
            .map((a) => ({ id: a.id, label: a.startLabel || a.title || a.id, icon: a.icon }))
            .sort((x, y) => x.label.localeCompare(y.label, undefined, { sensitivity: 'base' }));
    }

    function todaySoftKeyFor(side, menu) {
        let v = todaySoftKeys()[side];
        if (v.startsWith('app:') && !apps.has(v.slice(4))) v = TODAY_KEY_DEFAULT[side];
        if (v.startsWith('app:')) {
            const a = apps.get(v.slice(4));
            if (!a) return null;
            // a soft key holds a short name (WM's Today: "Calendar", "Contacts"): an app's softLabel
            return { label: a.softLabel || TODAY_KEY_SHORT[a.id] || a.startLabel || a.title || a.id, action: () => open(a.id) };
        }
        if (v === 'none') return null;
        if (v === 'start') return { label: 'Start', action: () => toggleStartMenu() };
        if (v === 'notifications') {
            return {
                label: 'Notifications',
                action: () => {
                    if (notes.length || statusFolded.length) noteIconTap();
                    else messageBox({ title: 'Notifications', icon: 'info', text: 'There are no notifications.' });
                }
            };
        }
        return { label: 'Menu', menu };
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

    /**
     * The picture view's toolbar (Yukimi, Nov 10: favourites, zoom, edit in Studio, delete ...).
     * The device's own picture view has none (6.1 and 6.5 emulators: the picture between the title
     * bar and Send / Menu, everything else in the Menu), so this one takes the form of the
     * toolbar the device does have, Media Player's Now Playing strip (wm-media.css .wmp-qbar):
     * flat 16 px colour icons from the ROM set, no button frames, from the left edge. Each button
     * runs the viewer's own (lightbox.js: Pin, Destroy, which ask first as on the desktop) or the
     * Menu's own action (Studio, Director); one the picture has no button for is greyed. Upscale
     * and Move to Scraps have no ROM icon: they are in the Menu only. The viewer has no
     * full-screen mode on phones (the WM bars stay), so neither does the strip; PhotoSwipe's
     * bottom padding makes room for it.
     */
    const VIEWBAR = [
        // [act, label, lightbox.js button title (null = the shell's own), ROM icon]
        ['prev', 'Previous', null, 'wmp-back'], ['next', 'Next', null, 'wmp-forward'], '|',
        ['zoom', 'Zoom', 'Zoom in/out', 'wmp-search'], ['pin', 'Pin', 'Pin image', 'wmp-favorite'], '|',
        ['studio', 'Edit in DreamStudio', null, 'app-studio'], ['director', 'Ask the Director', null, 'app-director'], '|',
        ['delete', 'Delete', 'Destroy image', 'wmp-delete']
    ];
    let viewbarPswp = null;

    function viewerPswp() {
        try {
            const g = (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp) || null;
            const o = window.pswp || null;
            // one closing under a newer one (closeOlderViewers) is not the viewer any more
            if (g && o && g !== o && g.isDestroying && !o.isDestroying) return o;
            // both open for a moment: the one the strip follows until the older one has closed
            if (g && o && g !== o && viewbarPswp === o && !o.isDestroying) return o;
            return g || o;
        } catch (_) { return null; }
    }

    function viewbarState(act, title) {
        const item = viewerItem();
        const pic = item && (item.filename || item.original);
        if (act === 'prev' || act === 'next') return { enabled: viewerSlides() > 1 };
        // a storage card's picture (wmPhoneGallery.js): Director and Delete act on the phone's file
        if (item && item.phoneMedia) {
            if (act === 'director') return { enabled: !item.phoneMedia.video && !!window.wmDirectorApp };
            if (act === 'delete') return { enabled: true };
            if (act === 'zoom') return { enabled: !item.phoneMedia.video };
            return { enabled: false };
        }
        // Studio edits a print by its file: a picture shown by its address alone has none
        if (act === 'studio') return { enabled: !!(pic && typeof window.openManualModalWithContent === 'function') };
        if (act === 'director') return { enabled: !!(pic && typeof window.askWrenAboutImage === 'function') };
        const b = viewerButton(title);
        return { enabled: !!b, pressed: act === 'pin' ? !!(b && item && item.isPinned) : null };
    }

    function renderViewbar() {
        const bar = shell && shell.querySelector('.wm-viewbar');
        if (!bar) return;
        bar.hidden = !viewerActive;
        if (!viewerActive) return;
        if (!bar.firstChild) {
            bar.innerHTML = VIEWBAR.map((b) => (b === '|' ? '<span class="wm-viewbar-sep" aria-hidden="true"></span>'
                : `<button type="button" class="wm-viewbar-btn" data-act="${b[0]}" title="${escapeHtml(b[1])}" aria-label="${escapeHtml(b[1])}">${imgTag(b[3])}</button>`)).join('');
            bar.addEventListener('click', (e) => {
                const btn = e.target.closest('.wm-viewbar-btn');
                if (!btn || btn.disabled) return;
                e.stopPropagation();
                closeMenus(true);
                viewbarPress(btn.dataset.act);
            });
        }
        for (const b of VIEWBAR) {
            if (b === '|') continue;
            const el = bar.querySelector(`[data-act="${b[0]}"]`);
            const st = viewbarState(b[0], b[2]);
            el.disabled = !st.enabled;
            if (st.pressed == null) el.removeAttribute('aria-pressed');
            else {
                el.setAttribute('aria-pressed', st.pressed ? 'true' : 'false');
                el.title = st.pressed ? 'Unpin' : 'Pin';
                el.setAttribute('aria-label', el.title);
            }
        }
    }

    function viewbarPress(act) {
        const p = viewerPswp();
        const item = viewerItem();
        const pic = item && (item.filename || item.original);
        if (act === 'prev') { if (p && p.prev) p.prev(); return; }
        if (act === 'next') { if (p && p.next) p.next(); return; }
        if (item && item.phoneMedia && window.wmPhoneGallery) {
            if (act === 'director') { window.wmPhoneGallery.viewerDirector(item.phoneMedia); return; }
            if (act === 'delete') { void window.wmPhoneGallery.viewerDelete(item.phoneMedia); return; }
            if (act === 'zoom') { if (p && typeof p.toggleZoom === 'function') p.toggleZoom(); return; }
            return;
        }
        // Edit: as the Menu's Edit > DreamStudio / Director, over the viewer (Back returns here)
        if (act === 'studio') { if (item) window.openManualModalWithContent({ type: 'image', image: item }); return; }
        if (act === 'director') { if (pic) window.askWrenAboutImage(pic); return; }
        const b = VIEWBAR.find((x) => x !== '|' && x[0] === act);
        if (b && b[2]) viewerPress(b[2]);
        // Pin answers after a round trip: the button follows
        if (act === 'pin') [400, 1200, 2500].forEach((ms) => setTimeout(renderViewbar, ms));
    }

    /**
     * PhotoSwipe's padding on the phone: the title bar above, the toolbar and soft keys below, as
     * the shell draws them (PhotoSwipe fills the window, the shell keeps inside the safe area: on
     * a phone with a status or navigation band the picture ran under the bars by the band's
     * height when this counted the bars alone).
     */
    function viewerPadding() {
        const px = parseFloat(getComputedStyle(root).getPropertyValue('--wm-px')) || 1;
        const pad = { top: 26 * px, bottom: 50 * px, left: 0, right: 0 };
        try {
            const title = shell && shell.querySelector('.wm-titlebar');
            const keys = shell && shell.querySelector('.wm-softkeys');
            const t = title && title.getBoundingClientRect();
            const k = keys && keys.getBoundingClientRect();
            if (t && t.height) pad.top = Math.max(0, t.bottom);
            // the strip is 24 px (6.5: 23) over the soft keys; asked before it is shown too
            if (k && k.height) pad.bottom = Math.max(0, window.innerHeight - k.top + (WM65 ? 23 : 24) * px);
            if (t && t.width) { pad.left = Math.max(0, t.left); pad.right = Math.max(0, window.innerWidth - t.right); }
        } catch (_) { /* the bars alone */ }
        return pad;
    }

    /**
     * One picture viewer on the phone (#748): the Pictures program's (lightbox.js PhotoSwipe under
     * the shell's title bar, toolbar and soft keys). The desktop's Lumen (imageViewer.js
     * createViewer: Explorer and file associations, the Director's and agents' "open in Lumen",
     * applets in Internet Explorer, references, Ledge cards) hands its picture here instead of
     * opening a window. A print of the loaded gallery opens in its place there (swipe to the
     * next, Pin, Delete ...); anything else opens by its address alone, under its title.
     */
    function viewPicture(input) {
        const o = input || {};
        const d = o.data && typeof o.data === 'object' ? o.data : {};
        if (typeof showLightbox !== 'function') return false;
        const name = d.filename || d.original || d.upscaled || '';
        let known = null;
        try { known = name && typeof findImageByFilename === 'function' ? findImageByFilename(name) : null; } catch (_) { known = null; }
        const src = o.src || d.url || '';
        if (!known && !src) return false;
        closeMenus(true);
        const title = o.title && o.title !== 'Image' && o.title !== 'Gallery Image' ? String(o.title) : '';
        // one picture at a time: the one on screen closes first (two PhotoSwipes would stack)
        const p = viewerPswp();
        const closed = p && !p.isDestroying && typeof p.on === 'function'
            ? new Promise((resolve) => { p.on('destroy', resolve); setTimeout(resolve, 800); try { p.close(); } catch (_) { resolve(); } })
            : Promise.resolve();
        busy(closed.then(() => (known ? showLightbox({ filename: name }) : showLightbox({ url: src, title: title || undefined }))).catch(() => { /* viewer not ready */ }));
        return true;
    }

    /** The viewer that just opened: room for the toolbar, and the toolbar follows its slides. */
    function attachViewbar() {
        const p = viewerPswp();
        // the strip first: the padding below is measured from it
        renderViewbar();
        try {
            if (typeof lightbox !== 'undefined' && lightbox && lightbox.options) lightbox.options.paddingFn = viewerPadding;
        } catch (_) { /* no gallery lightbox yet */ }
        if (p && p !== viewbarPswp) {
            viewbarPswp = p;
            if (p.options && p.options.paddingFn !== viewerPadding) {
                p.options.paddingFn = viewerPadding;
                try { if (typeof p.updateSize === 'function') p.updateSize(true); } catch (_) { /* sized at the next resize */ }
            }
            if (typeof p.on === 'function') {
                // slides are not laid out again while the viewer zooms open: once more after it
                // (a picture by its address ran under the strip)
                p.on('openingAnimationEnd', () => { try { p.updateSize(true); } catch (_) { /* sized at the next resize */ } });
                p.on('change', () => { renderViewbar(); renderSoftKeys(); });
                p.on('destroy', () => { if (viewbarPswp === p) viewbarPswp = null; });
            }
        }
        renderViewbar();
    }

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

    /**
     * What the Properties page shows of the picture on screen (wmPictureProperties.open): its file
     * name, address and size, its date, and on close the picture again (opening the page closes
     * the view, as any app opened over it does).
     */
    function viewerPictureFacts() {
        try {
            const p = (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp) || window.pswp;
            const d = p && p.currSlide && p.currSlide.data;
            if (!d) return null;
            const rec = d.data && typeof d.data === 'object' ? d.data : {};
            const file = rec.upscaled || rec.original || rec.filename || d.filename || '';
            const src = typeof d.src === 'string' ? d.src : '';
            const inline = /^(data|blob):/i.test(src);
            const name = file || rec.title || (src && !inline ? decodeURIComponent(src.split('/').pop().split('?')[0]) : '') || 'Picture';
            const t = Number(rec.mtime) || Number((/^(\d{12,13})_/.exec(file) || [])[1]) || 0;
            const meta = rec.metadata || {};
            return {
                name,
                src: src || (file ? `/images/${encodeURIComponent(file)}` : ''),
                width: Number(d.width) || Number(rec.width) || Number(meta.actual_width) || 0,
                height: Number(d.height) || Number(rec.height) || Number(meta.actual_height) || 0,
                size: Number(rec.size || rec.file_size || meta.file_size) || null,
                created: t,
                after: () => { viewPicture({ data: file ? { filename: file } : {}, src, title: rec.title || (file ? '' : name) }); }
            };
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
        const shownItem = viewerItem();
        if (shownItem && shownItem.phoneMedia && window.wmPhoneGallery) return window.wmPhoneGallery.viewerSoftKeys(shownItem.phoneMedia);
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
                    const canStudio = !!(editPic && typeof window.openManualModalWithContent === 'function');
                    const canDirector = !!(editPic && typeof window.askWrenAboutImage === 'function');
                    if (canStudio || canDirector) {
                        items.push({ label: 'Edit', submenu: () => [
                            { label: 'DreamStudio', disabled: !canStudio, action: () => { window.openManualModalWithContent({ type: 'image', image: item }); } },
                            { label: 'Director', disabled: !canDirector, action: () => window.askWrenAboutImage(editPic) }
                        ] });
                    }
                    // the device's Menu: ... Edit | Properties | Options...: Pictures & Videos'
                    // Properties page (wmFileExplorer.js); ok / Cancel bring the picture back
                    const facts = viewerPictureFacts();
                    if (facts && window.wmPictureProperties) {
                        items.push('-', { label: 'Properties', action: () => window.wmPictureProperties.open(facts) });
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

    /**
     * One picture viewer at a time (#748): the desktop stacks its viewers (a Director print list
     * over the gallery's picture), the phone keeps the newest. The older one is the one the strip
     * was following (viewbarPswp); it is closed once it has finished opening (PhotoSwipe drops a
     * close asked for while it zooms open and is left on screen without its instance).
     */
    function closeOlderViewer() {
        const old = viewbarPswp;
        if (!old || old.isDestroying || typeof old.close !== 'function') return;
        let other = null;
        try { if (typeof lightbox !== 'undefined' && lightbox && lightbox.pswp && lightbox.pswp !== old) other = lightbox.pswp; } catch (_) { /* no gallery viewer */ }
        if (!other && window.pswp && window.pswp !== old) other = window.pswp;
        if (!other || other.isDestroying) return;
        if (old.opener && !old.opener.isOpen) return;
        // the gallery's viewer forgets window.pswp when it goes (photoswipe-lightbox), which by
        // then names the newer one: put it back, or nothing could close or steer that one
        const keep = () => { if (!window.pswp && !other.isDestroying && other.element && other.element.isConnected) window.pswp = other; };
        // and the strip reads the buttons of the one left, once the old one's are off the page
        if (typeof old.on === 'function') old.on('destroy', () => { keep(); setTimeout(() => { keep(); renderViewbar(); renderSoftKeys(); }, 0); });
        try { old.close(); } catch (_) { /* closing */ }
    }

    function checkViewer() {
        let open = false;
        let count = 0;
        for (const el of openViewers) { if (el.classList.contains('pswp')) { open = true; count++; } }
        if (count > 1) closeOlderViewer();
        if (open === viewerActive) {
            // another picture took the open one's place between two polls (viewPicture, a new
            // print): the strip and the soft keys follow the viewer now on screen
            if (open) { const p = viewerPswp(); if (p && p !== viewbarPswp) { attachViewbar(); renderSoftKeys(); } }
            return;
        }
        viewerActive = open;
        viewerClosing = false;
        closeMenus(true);
        if (open) {
            root.setAttribute('data-wm-viewer', '');
            setTitle('Pictures & Videos');
            attachViewbar();
        } else {
            renderViewbar();
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
        // 6.5's splash (emulator cold boot): the yellow glow on orange with the white flag and
        // wordmark near the top left, the copyright lines under them late in the boot. Here the
        // Melaton emblem and name, and Xyridian as the holder (wm65.css .wm-splash65)
        if (WM65) {
            splash.classList.add('wm-splash65');
            splash.innerHTML = `<div class="wm-splash65-art">
                    <img class="wm-splash65-mark" src="/static_images/melaton/melaton-white-256.png" alt="" draggable="false">
                    <span class="wm-splash65-word">Melaton</span>
                    <p class="wm-splash65-copy">&copy; ${new Date().getFullYear()} Xyridian Corporation. All rights reserved.&nbsp; This computer program is protected by U.S. and international copyright laws.</p>
                </div>`;
        } else splash.innerHTML = `
            <div class="wm-s61"><span class="wm-s61-rings" aria-hidden="true"><i></i><i></i><i></i></span><b class="wm-s61-glint" aria-hidden="true"></b>
                <div class="wm-splash-logo">
                    <img src="/static_images/wm61/boot-melaton.png" alt="" draggable="false">
                    <div class="wm-splash-words">
                        <span class="wm-splash-brand">Melaton</span>
                        <span class="wm-splash-product">Mobile</span>
                        <span class="wm-splash-version">Version 2026 <b>R7</b></span>
                    </div>
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

    /**
     * html[data-wm-splash-painted] once the splash's pictures have decoded and a frame with them has
     * gone out: the Android app keeps its boot cover (the maker's logo) up until then, so the hand-over
     * never shows a black page or a half-drawn splash (6.5's splash has no 6.1 logo image to wait on).
     */
    function markSplashPainted() {
        if (root.dataset.wmSplashPainted) return;
        const splash = shell.querySelector('.wm-splash');
        const imgs = splash ? [...splash.querySelectorAll('img')] : [];
        let done = false;
        // the value is the page time it was set (ms since navigation start), for boot timing checks
        const mark = () => { if (!done) { done = true; root.dataset.wmSplashPainted = String(Math.max(1, Math.round(performance.now()))); } };
        // A frame with the splash committed is not yet a splash on screen: after the boot's long
        // main-thread stall the WebView took about a second (A53) to raster it, showing black, then
        // the splash without its emblem. Frames flowing steadily again (8 in a row, each under
        // 100 ms apart) is the sign raster has caught up; 4 s after the first frame it counts anyway.
        const settle = () => {
            let prev = 0;
            let steady = 0;
            const t0 = performance.now();
            const step = (now) => {
                if (done) return;
                steady = prev && now - prev < 100 ? steady + 1 : 0;
                prev = now;
                if (steady >= 8 || now - t0 > 4000) { mark(); return; }
                requestAnimationFrame(step);
            };
            requestAnimationFrame(step);
        };
        Promise.all(imgs.map((img) => (typeof img.decode === 'function' ? img.decode() : Promise.resolve()).catch(() => null)))
            .then(settle);
        // a stuck decode never holds the cover for good, but only frames count: a timer started here
        // fired before the page's first paint (scripts hold the main thread to ~6 s on the A53). The app
        // has its own 30 s limit for a view that never draws.
        requestAnimationFrame(() => setTimeout(mark, 5000));
    }

    // ---------------------------------------------------------------- the phone's home screen (#794)

    /**
     * Home pressed while Melaton Mobile is the phone's launcher (DSApp sends window event
     * 'melatonhome'): menus, bubbles, the task switcher and the picture view close, Today comes up
     * on the clock with every item back at its home position (scroll, sideways pages); apps keep
     * running, as WM's Home does. A message box that waits for an answer stays.
     */
    function goHome() {
        // the device lock screen stays over everything (unlocking lands on Today anyway)
        try { if (window.wmLock && window.wmLock.isLocked) return; } catch (_) { /* no lock screen */ }
        closeMenus(true);
        try { closeTaskSwitcher(true); } catch (_) { /* not open */ }
        try { closeBubble(); } catch (_) { /* none */ }
        if (viewerActive) closeViewer();
        // Home while Today is on screen: 6.5's list runs back to the clock; from a program Today comes
        // back with its entrance (wmTitanium.js, #800)
        // (the press itself blinks the page hidden for a moment: wmTitanium tells that from a return)
        const wasToday = current === 'today';
        if (current !== 'today') open('today');
        const t = apps.get('today');
        const page = t && t.page;
        if (page) {
            page.scrollTop = 0;
            page.querySelectorAll('*').forEach((el) => { if (el.scrollLeft) el.scrollLeft = 0; });
        }
        if (window.wmTitanium && typeof window.wmTitanium.home === 'function') window.wmTitanium.home({ animate: wasToday });
        document.dispatchEvent(new CustomEvent('wmTodayHome'));
    }
    window.addEventListener('melatonhome', goHome);

    /** After a boot the supervisor caused (DSApp HomeRole crash notice): what happened, once. */
    function showCrashNotice() {
        const h = window.AndroidHome;
        if (!h || typeof h.takeCrashNotice !== 'function') return;
        let n = null;
        try { n = JSON.parse(h.takeCrashNotice() || 'null'); } catch (_) { n = null; }
        if (!n || !n.kind) return;
        // an old notice (the phone was off since) is dropped
        if (Number(n.at) && Date.now() - Number(n.at) > 10 * 60 * 1000) return;
        const text = n.kind === 'hang' ? 'Melaton Mobile stopped responding and was restarted.'
            : n.kind === 'killed' ? 'Melaton Mobile was closed by the phone to free memory and was restarted.'
                : 'Melaton Mobile stopped unexpectedly and was restarted.';
        void messageBox({ title: 'Melaton Mobile', icon: 'warning', text, modal: true });
    }

    function setBoot(phase) {
        if (root.dataset.wmBoot === phase) return;
        root.dataset.wmBoot = phase;
        if (phase === 'done') { bootDoneAt = Date.now(); setTimeout(showCrashNotice, 600); }
        const bootWait = shell.querySelector('.wm-boot-wait');
        // the wheel stays from the splash through Today's fill-in (reveal) until done
        if (!(phase === 'reveal' && bootWait && !bootWait.hidden)) {
            if (bootWait) bootWait.hidden = true;
        }
        clearTimeout(bootWaitDelay);
        bootWaitDelay = null;
        if (phase === 'splash') markSplashPainted();
        if (phase === 'splash' && bootWait) {
            // WM 6.1: the splash alone at first, then the wait wheel a few seconds in while the
            // shell loads, until Today is drawn (the splash ends at finishBoot)
            bootWaitDelay = setTimeout(() => {
                bootWaitDelay = null;
                if (root.dataset.wmBoot !== 'splash') return;
                // the version's own wheel (6.5: the four coloured dots), as the busy cursor
                waitStrip(bootWait);
                bootWait.hidden = false;
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
            waitStrip(shell.querySelector('.wm-installer-wait'));
        }
    }

    let installMax = 0; // the furthest the install bar got (reset when an install finishes)

    function setInstallProgress(pct) {
        const inst = shell.querySelector('.wm-installer');
        inst.querySelector('.wm-installer-progress').hidden = false;
        inst.querySelector('.wm-installer-done').hidden = true;
        inst.querySelector('.wm-installer-wait').hidden = false;
        inst.querySelector('.wm-installer-text').textContent = `Installing ${installNoun()} ...`;
        const bar = inst.querySelector('.wm-installer-bar');
        // one install only moves forward: the update check runs several download passes, each counting
        // from 0 again; wceload's bar never steps back (Yukimi, Nov 10)
        const p = Math.max(installMax, Math.max(0, Math.min(100, Math.round(pct))));
        installMax = p;
        bar.setAttribute('aria-valuenow', String(p));
        bar.style.setProperty('--wm-install-blocks', String(Math.floor(p * 18 / 100)));
    }

    /** wceload's last page: "<name> was successfully installed on your device." + ok. */
    function showInstallDone(kind) {
        installKind = kind;
        installMax = 0;
        setBoot('install');
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
        // The end of the boot as both emulators draw it (recorded at 10 - 20 ms, #748): the body of
        // Today / the home screen is painted first while the splash is still in the two bar bands
        // (html[data-wm-reveal="body"], wm-stage.css clips the splash to them); then
        //   6.1: the left soft key (+180 ms), the right one (+275), the title bar (+374), and
        //        Today's items in three groups after the date row (+779, +1142, +1338)
        //   6.5: the soft key bar with its labels (+518), the title bar (+281 after that)
        // in that order at about a third of the emulator's times.
        setBoot('done');
        // gwes plays SystemStart as the shell comes up (only once audio is unlocked: a tap or key
        // during startup, e.g. the PIN; a cold load stays silent)
        playSystemSound('SystemStart');
        playBootReveal();
    }

    /** The end of the boot (and of a workspace switch's splash): Today's body, then the bars, 6.1's rows in groups. */
    function playBootReveal() {
        root.dataset.wmReveal = 'body';
        const steps = WM65 ? [['keys', 180], ['bars', 100]] : [['left', 60], ['keys', 40], ['bars', 40]];
        let t = 0;
        steps.forEach(([name, d]) => { t += d; setTimeout(() => { if (root.dataset.wmReveal) root.dataset.wmReveal = name; }, t); });
        setTimeout(() => { delete root.dataset.wmReveal; }, t + 60);
        if (WM65) return;
        const page = apps.get('today').page;
        const rows = page ? [...page.children].slice(1) : [];
        rows.forEach((r) => r.classList.add('wm-boot-hidden'));
        const third = Math.max(1, Math.ceil(rows.length / 3));
        rows.forEach((r, i) => setTimeout(() => r.classList.remove('wm-boot-hidden'), [260, 380, 450][Math.min(2, Math.floor(i / third))]));
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
        // Today shows in its own layout from its first frame (Yukimi): the workspace's copy of the
        // layout is loaded before the splash goes, not by the 500 ms poll after Today was drawn in
        // the last one used (watchTodayPrefs); the splash's own limit still ends a boot without it
        if (ready && elapsed >= BOOT_MIN_SPLASH_MS && !loadTodayPrefs(false) && elapsed < BOOT_MAX_SPLASH_MS) return;
        // the server out of reach: no waiting out the splash's limit, Today from the installed copy
        // (launch.html startOfflineIfInstalled handed over, or this load's connect already failed);
        // the connection and the start-up steps follow when the server answers (Yukimi, Nov 13)
        let offlineStart = false;
        try { offlineStart = Date.now() - (Number(sessionStorage.getItem('melatonOfflineStart')) || 0) < 120000; } catch (_) { /* storage off */ }
        const unreachable = !ready && ws && !(typeof ws.isConnected === 'function' && ws.isConnected())
            && (offlineStart || ws.connectionPhase === 'failed' || (ws.reconnectAttempts || 0) >= 2);
        if (unreachable && elapsed >= BOOT_MIN_SPLASH_MS) {
            try { sessionStorage.removeItem('melatonOfflineStart'); } catch (_) { /* storage off */ }
            finishBoot();
            return;
        }
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

    /**
     * The phone keyboard as WM's SIP: when it opens the soft-key bar sits on top of it and the app's
     * window ends above the bar (the device resized the foreground window to the SIP's visible
     * rect); the wallpaper and other background stay where they were. Neither Chrome nor the app's
     * WebView resizes the layout for the keyboard: the visual viewport shrinks and, once a covered
     * field is typed in, pans the whole page up (the bars scrolled off, the page could be dragged).
     * So the shell takes the keyboard height (the Android app's 'androidime' event when it sends
     * one, which comes as the keyboard starts to slide; else innerHeight - visualViewport.height),
     * sets --wm-sip on #wmShell + html[data-wm-sip] (wm-shell.css lifts the bar and everything
     * anchored to --wm-safe-bottom), keeps the focused field in view inside its page and undoes
     * any visual viewport pan. 'wmSipChange' { height } tells apps that place things by script.
     */
    function watchSip() {
        const vv = window.visualViewport;
        let native = null; // CSS px from the Android app, null = none received
        let height = -1;
        let resetQueued = false;
        const vvHeight = () => {
            if (!vv) return 0;
            const kb = window.innerHeight - vv.height * (vv.scale || 1);
            // a few px of rounding (or Chrome's URL bar in flight) is not a keyboard; the height is
            // fractional (377.24 CSS px on the A53): rounded down less 1 px, so the bar's bottom
            // row is tucked under the keyboard. Rounding up (and adding 1) lifted the bar off the
            // keyboard: a 2 px strip of the page showed between them (#760)
            return kb > 60 ? Math.max(0, Math.floor(kb) - 1) : 0;
        };
        const unpan = () => {
            if (resetQueued) return;
            resetQueued = true;
            requestAnimationFrame(() => {
                resetQueued = false;
                if (!vv || (!vv.offsetTop && !vv.offsetLeft)) return;
                // the root does not scroll (overflow hidden), so scrollTo leaves the visual viewport
                // where it is; scrollIntoView on the root element moves it back to 0,0
                try { root.scrollIntoView({ block: 'start', inline: 'start' }); } catch (_) { /* old engines: no pan to undo */ }
            });
        };
        const showFocused = () => {
            const el = document.activeElement;
            if (!el || el === document.body || !shell.contains(el) || !el.matches('input, textarea, select, [contenteditable=""], [contenteditable="true"]')) return;
            try { el.scrollIntoView({ block: 'nearest', inline: 'nearest' }); } catch (_) { /* in view already */ }
        };
        const apply = () => {
            const h = native != null ? native : vvHeight();
            if (h === height) { if (h) unpan(); return; }
            height = h;
            shell.style.setProperty('--wm-sip', `${h}px`);
            root.toggleAttribute('data-wm-sip', h > 0);
            document.dispatchEvent(new CustomEvent('wmSipChange', { detail: { height: h } }));
            // after the bar and the page have their new size: the field into view, then the pan back
            requestAnimationFrame(() => { showFocused(); unpan(); });
        };
        if (vv) {
            vv.addEventListener('resize', apply);
            // the page's own layout never scrolls: any pan of the visual viewport is the engine
            // scrolling a field above the keyboard, which the lifted layout already did
            vv.addEventListener('scroll', unpan);
        }
        window.addEventListener('androidime', (e) => {
            const d = (e && e.detail) || {};
            const px = Number(d.height);
            if (!Number.isFinite(px)) return;
            // the app sends device px over the WebView; 0 while the keyboard is down. Rounded down
            // less 1 px like vvHeight: the bar ends under the keyboard's top edge, never above it
            native = d.visible && px > 0 ? Math.max(0, Math.floor(px / (window.devicePixelRatio || 1)) - 1) : 0;
            apply();
        });
        // focus moving between fields while the keyboard stays up: keep the new one in view
        document.addEventListener('focusin', () => { if (height > 0) requestAnimationFrame(() => { showFocused(); unpan(); }); });
        apply();
    }

    function init() {
        build();
        watchSip();
        // the menus' tick and submenu arrow are CSS masks: fetched with the shell, not on the first
        // menu (the title bar's ok / X are inline in wm-shell.css)
        ['menu-check', 'menu-submenu-arrow'].forEach((n) => ['', '@2x', '@4x'].forEach((x) => { const img = new Image(); img.src = `/static_images/wm61/${n}${x}.png`; }));
        // the wait cursor's strip: a busy() right after boot must not show an empty frame while it downloads
        { const img = new Image(); img.decoding = 'async'; waitStrip(img); }
        watchTodayPrefs();
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
            takeRadios(radiosNow); // Screen > Status Icons: the Bluetooth icon
            refreshStatus(); // ... and the mobile network icon
            fitStatus(); // Screen > Camera moves the title bar's camera gap
            const today = apps.get('today');
            if (today && today.page) today.refresh();
        });
        watchDirector();
        watchDevice();
        watchToasts();
        watchStatusIcons();
        watchActiveSyncTransfers();
        watchSystemSounds();
        watchRequestBusy();
        routeAlert();
        if (!wrapWorkspaceSwitch()) { const t = setInterval(() => { if (wrapWorkspaceSwitch()) clearInterval(t); }, 1000); setTimeout(() => clearInterval(t), 60000); }
        startBoot();
        refreshStatus();
        watchStatusSignals();
        window.addEventListener('resize', () => { syncBezel(); if (noteTrayOpen) renderNotes(); else fitStatus(); });
        // the Android app moved or rotated the camera hole (--camera-hole-*)
        window.addEventListener('dreamscape:cutout', () => { syncBezel(); fitStatus(); });
        // the app on screen decides whether the volume icon makes room for the camera (fitStatusNow)
        new MutationObserver(() => fitStatus()).observe(document.documentElement, { attributes: true, attributeFilter: ['data-wm-app'] });
        checkTakeover();
        // screen off (html[data-screen-off], the app's melatonscreen): nothing is on screen to take over, and
        // on a hybrid phone these ticks share the renderer with the DeX window (#798); one pass at screen on
        const screenOn = () => document.documentElement.dataset.screenOff === undefined;
        // the picture view and the layers that take the shell over are watched, not polled (400 ms and
        // 150 ms ticks before; on a hybrid phone they ran in the renderer the DeX window shares, #798):
        // PhotoSwipe's .pswp comes and goes as a child of <body> and opens with its pswp--open class,
        // the takeover layers are known ids. A change runs both checks on the next frame; a 2 s pass
        // still catches what changed without either (a layer nested elsewhere, an app's own view switch).
        let layerQueued = false;
        const layerCheck = () => { layerQueued = false; if (!screenOn()) return; checkViewer(); checkTakeover(); };
        const layerSoon = () => { if (layerQueued) return; layerQueued = true; requestAnimationFrame(layerCheck); };
        const layerAttrs = new MutationObserver(layerSoon);
        const layerWatched = new WeakSet();
        const layerWatch = (el) => {
            if (!el || layerWatched.has(el)) return;
            layerWatched.add(el);
            layerAttrs.observe(el, { attributes: true, attributeFilter: ['class', 'style', 'hidden'] });
        };
        const layerScan = () => {
            TAKEOVER.forEach((id) => layerWatch(document.getElementById(id)));
            for (const el of document.body.children) if (el.classList.contains('pswp') || el.classList.contains('dreamscape-app-error-window')) layerWatch(el);
        };
        new MutationObserver(() => { layerScan(); layerSoon(); }).observe(document.body, { childList: true });
        layerScan();
        setInterval(() => { if (screenOn()) { layerScan(); checkTakeover(); checkViewer(); } }, 2000);
        window.addEventListener('melatonscreen', (e) => { if (e.detail && e.detail.on) { checkTakeover(); checkViewer(); } });
        // ActiveSync Received Items (#803): the status icon follows the agent's list
        (function wireReceived(tries) {
            const asx = window.activeSync;
            if (asx && typeof asx.on === 'function') { asx.on('received', () => refreshStatus()); refreshStatus(); return; }
            if (tries < 60) setTimeout(() => wireReceived(tries + 1), 1000);
        })(0);
        // programs loaded on demand (#817): their Start menu entries, before anything lists programs
        LAZY_APPS.forEach(registerLazyApp);
        // the Android app opens a program (its notification, a launcher shortcut: melatonopenapp); a lazy
        // one's own listener is not there yet, so the shell opens it (its script then listens itself)
        window.addEventListener('melatonopenapp', (e) => {
            const id = e && e.detail;
            const app = typeof id === 'string' && apps.get(id);
            if (app && app.lazyScript) open(id, { fromStart: true });
        });
        document.dispatchEvent(new CustomEvent('wmShellReady'));
    }

    /**
     * Programs whose scripts load when first opened (#817 slice 2). Each entry carries only what the
     * Start menu and Programs show (title, startLabel, icon, art65, inStart, programsFolder); the
     * script's own registerApp replaces it. Only programs nothing else calls into at boot belong here
     * (no window.* used by other files, no Today items, applets or handoffs registered at load).
     * Their scripts are out of app.html; keep a new program's fields in step with its registerApp.
     */
    const LAZY_APPS = [
        { id: 'calculator', title: 'Calculator', icon: 'app-calculator', inStart: 'programs', script: 'scripts/comp/wmCalculator.js' },
        { id: 'solitaire', title: 'Solitaire', icon: 'app-solitaire', art65: 'solitaire', inStart: 'programs', programsFolder: 'games', script: 'scripts/comp/wmSolitaire.js' },
        { id: 'minesweeper', title: 'Minesweeper', icon: 'app-minesweeper', inStart: 'programs', programsFolder: 'games', script: 'scripts/comp/wmMinesweeper.js' },
        { id: 'blockdrop', title: 'Block Drop', icon: 'app-blockdrop', inStart: 'programs', programsFolder: 'games', script: 'scripts/comp/wmBlockDrop.js' },
        { id: 'brickbreaker', title: 'Brick Breaker', icon: 'app-brickbreaker', inStart: 'programs', programsFolder: 'games', script: 'scripts/comp/wmBrickBreaker.js' },
        { id: 'inkball', title: 'InkBall', icon: 'app-inkball', inStart: 'programs', programsFolder: 'games', script: 'scripts/comp/wmInkBall.js' },
        { id: 'gems', title: 'Gems', icon: 'app-gems', inStart: 'programs', programsFolder: 'games', script: 'scripts/comp/wmGems.js' },
        { id: 'paypass-mobile', title: 'PayPass', startLabel: 'PayPass Operator', icon: 'app-paypass', inStart: 'programs', script: 'scripts/comp/wmPayPass.js' },
        // Dreamscape suite programs that stand in for a desktop window through a global (globals: the
        // stand-ins until their script loads)
        { id: 'spellbook', title: 'Spellbook', icon: 'app-spellbook', inStart: 'programs', programsFolder: 'toolbox', script: 'scripts/comp/wmSpellbook.js', globals: ['showPresetManager'] },
        { id: 'reference', title: 'Reference', icon: 'app-reference', inStart: 'programs', script: 'scripts/comp/wmReference.js', globals: ['showCacheManagerModal'] },
        { id: 'expanders', title: 'Expanders', icon: 'app-expanders', inStart: 'programs', programsFolder: 'toolbox', script: 'scripts/comp/wmExpanders.js', globals: ['showTextReplacementManager'] },
        { id: 'spellcaster', title: 'Spellcaster', icon: 'app-spellcaster', inStart: 'programs', script: 'scripts/comp/wmSpellcaster.js', globals: ['openSpellbookApplet', { name: 'wmSpellcaster', methods: ['openSpell'] }] },
        // programs that patch a desktop feature as it loads: loaded with it (withFeatures)
        { id: 'atelier', title: 'Atelier', icon: 'app-atelier', inStart: 'programs', script: 'scripts/comp/wmAtelier.js', globals: ['openNaxtApplet'], withFeatures: ['naxt'] },
        { id: 'emotion', title: 'eMotion LIVE', icon: 'app-emotion', inStart: 'programs', programsFolder: 'toolbox', script: 'scripts/comp/wmEmotion.js', globals: ['openEmotion', 'openDesktopEmotion'], withFeatures: ['emotion'] },
        { id: 'phasewalker', title: 'Phasewalker', icon: 'app-phasewalker', inStart: 'programs', script: 'scripts/comp/wmPhasewalker.js', globals: ['openBracketGenerationApplet'], withFeatures: ['bracket_gen'] },
        { id: 'characters', title: 'Characters', icon: 'app-characters', inStart: 'programs', programsFolder: 'toolbox', script: 'scripts/comp/wmCharacters.js', withFeatures: ['character_db'] },
        // Remote Desktop Mobile: Today's row reads the last computer (sync, from the same storage the
        // program writes) and no session runs before it loads; the desktop's Remote Desktop features
        // load it, as it wraps their windows for the phone
        {
            id: 'remote-desktop-mobile', title: 'Remote Desktop Mobile', icon: 'app-remote-desktop-mobile', inStart: 'programs',
            script: 'scripts/comp/wmRemoteDesktop.js',
            withFeatures: ['remote_desktop', 'remote_desktop_connection'],
            globals: [{
                name: 'wmRemoteDesktop',
                methods: ['reconnectLast'],
                sync: {
                    lastComputer() {
                        const read = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k) || 'null'); return v == null ? d : v; } catch (_) { return d; } };
                        const last = read('wmRemoteDesktopComputer', '');
                        if (typeof last === 'string' && last) return last;
                        const h = read('remoteDesktopConnectionHistory', []);
                        return (Array.isArray(h) && h.find((v) => typeof v === 'string')) || '';
                    },
                    sessionName: () => ''
                }
            }]
        },
        // Melaton Media: until it loads nothing of Melaton's plays (Today's Music item and the 6.5 Music
        // panel read now() as nothing; Android's own players come to Today directly); enqueue / play
        // load it first (eMotion LIVE's Play in Melaton Media, Today's buttons)
        {
            id: 'windows-media', title: 'Melaton Media', startLabel: 'Melaton Media', icon: 'app-windows-media', inStart: 'programs',
            script: 'scripts/comp/wmMedia.js',
            globals: [{ name: 'wmMedia', methods: ['enqueue', 'playPause', 'next', 'previous', 'playAll'], sync: { now: () => null, state: () => null } }]
        },
        // Notes and Contacts (one script): Today's Notes item lists the workspace's notes through the
        // stand-in (the program's own newest()/list(): the Notes folder, kept 2 minutes, null before
        // the first answer); opening a note or a card loads the program
        { id: 'notes', title: 'Notes', icon: 'app-notes', inStart: 'bottom', script: 'scripts/comp/wmNotes.js', globals: [{ name: 'wmNotesApp', methods: ['openNote'], sync: lazyNotesList() }] },
        { id: 'contacts', title: 'Contacts', icon: 'app-contacts', inStart: 'top', script: 'scripts/comp/wmNotes.js', globals: [{ name: 'wmContactsApp', methods: ['openFile', 'newContact'], sync: { reload: () => {} } }] },
        // File Explorer and the picture Properties page (one script): Today's Files item formats with the
        // stand-in's own fmtDate / fmtSize / myDocumentsPath (the program's rules); listing, volumes,
        // opening and Receive load it first (Receive still within the tap's activation)
        {
            id: 'fileexplorer', title: 'File Explorer', icon: 'app-file-explorer', inStart: 'top', script: 'scripts/comp/wmFileExplorer.js',
            globals: [{ name: 'wmFileExplorer', methods: ['list', 'volumes', 'openFolder', 'openFile', 'receive'], sync: lazyFileFormats() }]
        },
        { id: 'pic-props', title: 'Pictures & Videos', icon: 'app-pictures', inStart: false, script: 'scripts/comp/wmFileExplorer.js', globals: [{ name: 'wmPictureProperties', methods: ['open'] }] },
        // Text Messages (6.5: Text): its live events only touch the conversation on screen, so nothing is
        // missed before it loads. accounts() is the empty list it starts with and starts loading it (the
        // next call has them); nothing is open (current / isOpen); the rest load it first
        {
            id: 'textmessaging',
            get title() { return document.documentElement.dataset.wmVersion === '6.5' ? 'Text' : 'Text Messages'; },
            icon: 'app-sms', inStart: 'top', script: 'scripts/comp/wmTextMessaging.js',
            globals: [{
                name: 'wmTextMessaging',
                methods: ['showAccount', 'openChat', 'compose', 'composeWithFiles'],
                sync: {
                    accounts: () => { void loadLazyApp('textmessaging'); return []; },
                    current: () => ({ accountId: null, folder: null }),
                    isOpen: () => false,
                    FOLDERS: [
                        { id: 'inbox', label: 'Inbox', icon: 'msg-folder-inbox' },
                        { id: 'sent', label: 'Sent Items', icon: 'msg-folder-outbox' },
                        { id: 'unknown', label: 'Unknown Senders', icon: 'msg-folder-folder' }
                    ]
                }
            }]
        }
    ];

    /** wmFileExplorer.js's formats and My Documents path, for its callers before it loads. */
    function lazyFileFormats() {
        return {
            myDocumentsPath() {
                let id = 'default';
                try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) id = activeWorkspace; } catch (_) { /* not loaded */ } // eslint-disable-line no-undef
                return `/Workspaces/${id}`;
            },
            /** WM's list date: M/D/YY (seconds; ms tolerated). */
            fmtDate(t) {
                let n = Number(t);
                if (!n) return '';
                if (n < 1e12) n *= 1000;
                const d = new Date(n);
                return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
            },
            /** WM's list size: three significant digits, K / M / G. */
            fmtSize(b) {
                const n = Number(b);
                if (!Number.isFinite(n) || n < 0) return '';
                if (n < 1024) return `${n}B`;
                const units = ['K', 'M', 'G', 'T'];
                let v = n / 1024;
                let u = 0;
                while (v >= 1000 && u < units.length - 1) { v /= 1024; u++; }
                return `${v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : String(Math.round(v))}${units[u]}`;
            }
        };
    }

    /** wmNotes.js's Notes.newest()/list() for Today before the program loads (same folder, same cache rules). */
    function lazyNotesList() {
        const cache = { at: 0, ws: null, value: null, list: null, busy: false };
        const activeWs = () => {
            try { if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return activeWorkspace; } catch (_) { /* not loaded */ } // eslint-disable-line no-undef
            return 'default';
        };
        const vfs = () => { try { return (typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient) || null; } catch (_) { return null; } }; // eslint-disable-line no-undef
        function newest() {
            const wsId = activeWs();
            const v = vfs();
            if (!cache.busy && v && (cache.ws !== wsId || Date.now() - cache.at > 120000)) {
                cache.busy = true;
                let ok = false;
                v.listDirectory(`/Workspaces/${wsId}/Notes`, { offset: 0, limit: 1000, sortField: 'name', sortDirection: 'asc', search: '' }).then((res) => {
                    ok = true;
                    const slim = ((res && res.items) || []).filter((i) => i.targetKind === 'note')
                        .map((i) => ({ name: i.name, noteId: i.targetId, workspaceId: i.workspaceId || wsId, modifiedAt: i.modifiedAt }));
                    cache.value = slim.reduce((a, b) => ((Number(b.modifiedAt) || 0) > (Number(a && a.modifiedAt) || 0) ? b : a), null) || false;
                    cache.list = slim;
                }).catch(() => { if (cache.ws !== wsId) { cache.value = null; cache.list = null; } })
                    // a failure (early in boot) retries in 15 s, as the program's own
                    .finally(() => {
                        cache.busy = false;
                        cache.at = ok ? Date.now() : Date.now() - 105000;
                        cache.ws = wsId;
                        if (ok && window.wmShell && window.wmShell.refreshToday) window.wmShell.refreshToday();
                    });
            }
            return cache.ws === wsId ? cache.value : null;
        }
        return { newest, list() { const v = newest(); return v == null ? null : (cache.list || []); } };
    }

    window.wmShell = {
        registerApp,
        registerLazyApp,
        onScreen,
        loadLazyApp,
        /** Take a registered program out again (an Android program that was hidden or uninstalled). */
        removeApp: (id) => { const a = apps.get(id); if (a && typeof a.launch === 'function') apps.delete(id); },
        open,
        back,
        messageBox,
        /** Dreamscape Mainframe Server box while the server boots: mainframeBox(percent, stage); null hides. */
        mainframeBox: (percent, stage) => mainframeBox(percent, stage),
        /** Work the user started, as a WM box with bar / preview / Hide / Cancel (#806): progressBox({ title, text, pct, preview, onCancel }). */
        progressBox: (opts) => progressBox(opts || {}),
        /** A message now answers the user's own action (a tap in the last 6 s, or work under the wait cursor). */
        answersUser: () => answersUser(),
        /** Fetch a same-origin file with a Downloading box, then save it on the phone (#806). */
        saveToPhone: (url, name) => saveToPhone(url, name || 'download'),
        /** "The Domain Controller is unreachable." Retry / Abort box: resolves 'retry' | 'abort'. */
        domainUnreachable: () => domainUnreachable(),
        /** Close an open unreachable box as `value` (websocket.js: 'connected' when the link is back). */
        closeDomainUnreachable: (value) => closeDomainUnreachable(value),
        /** The "Domain Controller is not ready" notification (closes itself on reconnect). */
        dcNotice: () => dcNotice(),
        /** A request now is the user's own command: a tap on a program (not the title bar or a bubble) in the last 700 ms. */
        tapCommand: () => tapRecent() && !lastTapChrome,
        /** A WM notification: notify({ title, text, icon: 'info' | 'warning' | 'error' | 'success', timeout, buttons }). */
        notify: (opts) => notify(opts || {}),
        /** An app's own notification with a live progress bar, soft keys and title bar glyph (appNote above). */
        appNote: (opts) => appNote(opts || {}),
        // for apps in their own files (wmFileExplorer.js ...)
        menu: (side, items, btn) => showPopup(side, items, btn),
        dropdown: (anchor, items, align, onClose) => showDropdown(anchor, items, align, onClose),
        /** Settings > Today > Wallpaper > Use (#799): 'workspace' | 'selected' | 'android', and whether Android's can be used here. */
        todayWallSource: () => todayWallSource(),
        androidWallAvailable: () => androidWallAvailable(),
        androidWallUrl: () => androidWallUrl(),
        closeMenus: () => closeMenus(),
        /** Registered apps (id, title, icon, inStart) in registration order. */
        /**
         * A Today item from an app: a row registerTodayItem({ id, label, icon, after, text(), onTap(),
         * options }) or a block { id, label, after, render(el, { option }) -> false hides, options }.
         * Today repaints every 2 s: render must be cheap and repaint only what changed.
         */
        registerTodayItem: (w) => registerTodayItem(w),
        // an item's data changed after Today drew it (Text Messaging's accounts load late, #779)
        refreshToday: () => { const t = apps.get('today'); if (t && t.page) t.refresh(); },
        /** Today rows from apps: [{ id, label }] (Settings > Today > Items). */
        listTodayItems: () => todayWidgets.map((w) => ({ id: w.id, label: w.label || w.id, defaultOn: w.defaultOn !== false })),
        /** 6.5 (#739): the registered Today items themselves (their titanium() panels), and the home screen's hook. */
        todayItemDefs: () => todayWidgets.slice(),
        todayState: () => { const t = apps.get('today'); return t && typeof t.state === 'function' ? t.state() : null; },
        setTodayView,
        version: WM65 ? '6.5' : '6.1',
        /** A Today row's options: defs (Settings > Today > Items > Options...), and a stored value. */
        todayOptionDefs: (id) => todayOptionDefs(id),
        todayOption: (id, key) => todayOption(id, key),
        todayOptionsKey: TODAY_OPTIONS_KEY,
        /** The Today items list of the running version ('wmTodayItems' / 'wmTodayItems65'), and 6.5's default order. */
        todayItemsKey: TODAY_ITEMS_KEY,
        todayOrder65,
        /** End an app: its page is removed and remounted on the next open (Task Manager). */
        endApp: (id) => endApp(id),
        /** Apps opened this session, most recent first. */
        openedApps: () => openedApps.slice(),
        /** An app's page, made (mounted) without bringing the app up. */
        pageOf: (id) => (apps.has(id) ? pageFor(apps.get(id)) : null),
        listApps: () => [...apps.values()].map((a) => ({ id: a.id, title: a.title, startLabel: a.startLabel, icon: a.icon, inStart: a.inStart, sip: !!a.sip, programsFolder: a.programsFolder || null, art65: a.art65 || null, hold: typeof a.holdMenu === 'function' })),
        /** Another program stands in for a system app (fn starts it), or null for our own (#776). */
        replaceApp: (id, fn) => { if (typeof fn === 'function') replacements.set(id, fn); else replacements.delete(id); },
        /** The rows an app gives its icon's tap-and-hold menu (registerApp holdMenu(); the Android programs, #773). */
        appHoldMenu: (id) => {
            const a = apps.get(id);
            if (!a || typeof a.holdMenu !== 'function') return [];
            try { const rows = a.holdMenu(); return Array.isArray(rows) ? rows : []; } catch (err) { console.warn('[wmShell] hold menu', id, err); return []; }
        },
        /** The unread mail icon's "any unread message" switch (Messaging > Tools > Options). */
        mailIconAllKey: MAIL_ICON_ALL_KEY,
        smsIconAllKey: SMS_ICON_ALL_KEY,
        /** The low battery warning level in percent, and its storage key (Settings > Power). */
        batteryLowLevel,
        refreshStatus: () => refreshStatus(),
        // the Android app's device status as last pushed (androiddevicestatus): wifi / cellular / battery
        deviceStatus: () => deviceStatus,
        packagesAdded: (change) => packagesAdded(change),
        deviceView: () => deviceView(),
        radios: () => radiosNow || readRadios(),
        typeName: (t) => typeName(t),
        batteryLowKey: BATTERY_LOW_KEY,
        /** Tap-and-hold: ms from pen down to the menu, when the ring of dots is whole (bindHoldRing). */
        holdMs: HOLD_FIRST_MS + 8 * HOLD_STEP_MS + HOLD_MENU_MS,
        /**
         * The task switcher (hold on Start): a strip of the running programs over the soft key bar.
         * open() -> false when it may not come up (lock screen, message box, busy); close();
         * isOpen; tasks() -> [{ id, title, icon }] most recent first; endAll().
         */
        taskSwitcher: {
            open: () => openTaskSwitcher(),
            close: () => closeTaskSwitcher(),
            get isOpen() { return taskSwitch.open; },
            tasks: () => taskSwitcherTasks(),
            endAll: () => taskSwitcherEndAll()
        },
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
            // inside the content box (not over the title bar or the soft keys)
            clampPopup(pop);
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
        art: { url: art, url2x: art2x, img: imgTag, srcset, isSet: (n) => WM_SET.test(String(n)) },
        escapeHtml,
        applyTheme,
        onPopState,
        thumbFor,
        viewPicture,
        /** Pictures & Videos' Set as Today Background for a print (filename, gallery item). */
        setTodayBackground: (name, item) => { if (setTodayBackgroundFn) setTodayBackgroundFn(name, item); },
        viewerPadding,
        bubble: (opts) => bubble(opts || {}),
        /** WM's wait cursor while the user must wait: busy(promise | fn, { delay, timeout }) or busy() -> release. */
        busy: (work, opts) => busy(work, opts || {}),
        /** The wait cursor's strip, frame time and place, for the app to draw it over a starting Android program (#816). */
        waitCursorSpec,
        /** The system Volume bubble (the title bar's speaker), for an app's own volume button (Notes' voice bar). */
        volumeBubble: () => { const v = shell && shell.querySelector('[data-role="volume"]'); if (v) toggleVolume(v); },
        /** Resolves once the next frame has painted (yield before heavy synchronous work). */
        afterPaint: () => afterPaint(),
        isBusy: () => busyCount > 0,
        /** WM 6.1 system sounds: play('SystemHand' | 'SystemExclamation' | 'Notification' ...), log (what played). */
        /** Settings > Buttons: the Today soft keys ({ left, right } values, the actions, the programs). */
        todaySoftKeys: {
            get: () => todaySoftKeys(),
            set: (v) => {
                const cur = todaySoftKeys();
                const next = { left: (v && v.left) || cur.left, right: (v && v.right) || cur.right };
                try { localStorage.setItem(TODAY_KEYS_KEY, JSON.stringify(next)); } catch (_) { /* this session only */ }
                if (current === 'today') renderSoftKeys();
            },
            defaults: () => ({ ...TODAY_KEY_DEFAULT }),
            actions: () => TODAY_KEY_ACTIONS.map(([value, label, key]) => ({ value, label, key })),
            programs: () => todayKeyPrograms()
        },
        sounds: {
            play: (name, opts) => playSystemSound(name, opts || {}),
            log: snd.log,
            /** True while the phone makes no sound (sound mode not on, or the ringer at 0): games check it (#786). */
            silent: () => sndSilentNow(),
            /** Settings' Sound list: the ROM's files ({ file, label }). */
            files: () => WM_SOUNDS.map((file) => ({ file, label: wmSoundLabel(file) })),
            /** The phone's sound events ({ id, label, kind, sound, repeatable, desktop, dovecote }). */
            events: () => SND_EVENTS.map((e) => ({ ...e })),
            prefs: soundPrefs,
            eventPrefs: (id) => eventPrefs(id),
            setPrefs: (p) => { saveSoundPrefs(p); sndUnlock(); },
            preview: previewSound,
            stop: stopPreview
        },
        /** Buzz a named pattern ('notification' | 'reminder' | 'alert' | 'ring' | 'mode'); opts { level, force, ms }. */
        vibrate: (kind, opts) => vibrate(kind, opts || {}),
        /** This device's vibration (Settings > Sounds & Notifications > Vibration; localStorage wmVibration). */
        vibration: {
            key: VIB_KEY,
            levels: VIB_LEVELS,
            log: vib.log,
            prefs: vibrationPrefs,
            setPrefs: saveVibrationPrefs,
            caps: vibrationCaps,
            cancel: vibrateCancel,
            patterns: () => JSON.parse(JSON.stringify(VIB_PATTERNS))
        },
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
            css: (placement, natural, scale) => placementCss(placement, natural, scale),
            /** Today's picture effect { effect, level } and the helpers the Settings preview uses. */
            effect: () => todayEffect(),
            effectBackground: (src, css, fx) => effectBackground(src, css, fx),
            blurred: (url, level) => blurredPicture(url, level)
        },
        closeBubble: () => closeBubble(),
        // tests: run the startup sequence again (splash, installer, Today) on a live page
        _test: {
            restartBoot() { clearInterval(bootTimer); installKind = null; bootStart = Date.now(); setBoot('splash'); bootTimer = setInterval(bootTick, 200); },
            // the workspace switch cover without a switch: up for id, lifted as after a completed one
            switchCover(id, ms) { showSwitchCover(id); setTimeout(() => { void settleSwitchCover(id); }, ms || 1500); }
        },
        deriveRoles,
        get current() { return current; }
    };

    if (document.body) init();
    else document.addEventListener('DOMContentLoaded', init, { once: true });
})();
