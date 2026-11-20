/**
 * Mouse Properties > Pointers (Yozora #632): the pointer scheme in Melaton's registry
 * (HKCU\Control Panel\Cursors, Scheme) drawn with Vista's own Aero cursors
 * (C:\Windows\Cursors\aero_*.cur from the Vista VM, PNG with their hot spots in
 * public/static_images/vista-cursors/). Every cursor in the app reads the --c-* tokens on html
 * (public/css/desktop-cursors.css), so a scheme only sets those; "(None)" and no value at all
 * keep the browser's own pointers. With a scheme, html[data-pointer-scheme] gives what was left to the browser
 * (cursor: auto, links) the scheme's arrow / hand and edit fields the text beam (desktop-cursors.css). The animated
 * busy pointers show their first frame: a custom pointer image is one bitmap everywhere (CSS cursors; Android's
 * PointerIcon.create, which the WebView uses, carries no frames to the system pointer).
 *
 * The Android app's desktop (the DeX window) defaults to Windows Aero like DreamOS (Nov 20 2026): its WebView turns
 * CSS cursor images into the system pointer (PointerIcon TYPE_CUSTOM, checked on the Fold's DeX with dumpsys input).
 * Melaton Mobile never takes a scheme (no mouse pointer of its own).
 *
 * Vista draws every scheme on the 32 px canvas: the large and extra large cursors are larger art on the same
 * canvas, each file with its own hot spot (C:\Windows\Cursors\aero_*_l.cur / _xl.cur), so they are used as they
 * are (they were drawn at 1.5x / 2x with the normal scheme's hot spot: too big, and the click landed 3-6 px off).
 *
 * DreamOS (#910): the compositor draws the pointers the page leaves to the browser (text, crosshair, anything
 * cursor: auto resolves to) and the pointer outside the page from the same scheme - CaféReady sets its cursor theme
 * (window.DreamOSSettings.pointer; Vista's cursors as Xcursor themes in the image). With no scheme chosen yet DreamOS
 * uses Windows Aero, as Vista does; "(None)" is kept as an empty value so it stays chosen. Hide pointer while typing
 * (Pointer Options) goes with it. shown() (websocket.js: winlogon is on screen, or the desktop is up) tells CaféReady
 * to stop hiding a still pointer, which it does only through the boot.
 *
 * DreamOS also takes the rest of Mouse and Keyboard Properties' registry values into the compositor (the registry is
 * the user's; CaféReady keeps the machine's copy on /data): Switch primary and secondary buttons, the pointer speed
 * (mice and the touchpad, as Windows has one speed), Enhance pointer precision (libinput's adaptive profile), the
 * keyboard's repeat delay and rate. Sent once the user's registry is loaded and when one of them changes.
 * inputState() is CaféReady's input settings, read once at load (cplDialogs.js's Trackpad / Function Keys tabs).
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const KEY = 'HKCU\\Control Panel\\Cursors';
    const ART = '/static_images/vista-cursors';
    // [hot x, hot y] of each cursor file (its .cur / .ani header on the Vista VM)
    const HOT = {
        aero_arrow: [0, 0], aero_busy: [16, 16], aero_ew: [15, 15], aero_helpsel: [0, 0], aero_link: [5, 0],
        aero_move: [15, 15], aero_nesw: [15, 15], aero_ns: [15, 15], aero_nwse: [15, 15], aero_pen: [0, 0],
        aero_unavail: [16, 16], aero_up: [15, 4], aero_working: [0, 8],
        aero_arrow_l: [2, 4], aero_busy_l: [15, 15], aero_ew_l: [15, 16], aero_helpsel_l: [2, 4], aero_link_l: [8, 0],
        aero_move_l: [16, 16], aero_nesw_l: [16, 16], aero_ns_l: [16, 16], aero_nwse_l: [16, 16], aero_pen_l: [3, 4],
        aero_unavail_l: [16, 16], aero_up_l: [14, 5], aero_working_l: [0, 7],
        aero_arrow_xl: [0, 1], aero_busy_xl: [15, 15], aero_ew_xl: [16, 16], aero_helpsel_xl: [0, 1], aero_link_xl: [9, 0],
        aero_move_xl: [16, 16], aero_nesw_xl: [16, 16], aero_ns_xl: [16, 16], aero_nwse_xl: [16, 16], aero_pen_xl: [1, 2],
        aero_unavail_xl: [15, 15], aero_up_xl: [15, 4], aero_working_xl: [0, 2]
    };
    const TOKENS = {
        '--c-default': 'aero_arrow', '--c-context-menu': 'aero_arrow', '--c-help': 'aero_helpsel',
        '--c-pointer': 'aero_link', '--c-progress': 'aero_working', '--c-wait': 'aero_busy',
        '--c-not-allowed': 'aero_unavail', '--c-no-drop': 'aero_unavail', '--c-move': 'aero_move',
        '--c-all-scroll': 'aero_move', '--c-ew-resize': 'aero_ew', '--c-col-resize': 'aero_ew',
        '--c-e-resize': 'aero_ew', '--c-w-resize': 'aero_ew', '--c-ns-resize': 'aero_ns',
        '--c-row-resize': 'aero_ns', '--c-n-resize': 'aero_ns', '--c-s-resize': 'aero_ns',
        '--c-nwse-resize': 'aero_nwse', '--c-nw-resize': 'aero_nwse', '--c-se-resize': 'aero_nwse',
        '--c-nesw-resize': 'aero_nesw', '--c-ne-resize': 'aero_nesw', '--c-sw-resize': 'aero_nesw'
    };
    const FALLBACK = {
        '--c-default': 'default', '--c-context-menu': 'context-menu', '--c-help': 'help', '--c-pointer': 'pointer',
        '--c-progress': 'progress', '--c-wait': 'wait', '--c-not-allowed': 'not-allowed', '--c-no-drop': 'no-drop',
        '--c-move': 'move', '--c-all-scroll': 'all-scroll', '--c-ew-resize': 'ew-resize', '--c-col-resize': 'col-resize',
        '--c-e-resize': 'e-resize', '--c-w-resize': 'w-resize', '--c-ns-resize': 'ns-resize', '--c-row-resize': 'row-resize',
        '--c-n-resize': 'n-resize', '--c-s-resize': 's-resize', '--c-nwse-resize': 'nwse-resize', '--c-nw-resize': 'nw-resize',
        '--c-se-resize': 'se-resize', '--c-nesw-resize': 'nesw-resize', '--c-ne-resize': 'ne-resize', '--c-sw-resize': 'sw-resize'
    };

    // scheme -> the art's suffix and CaféReady's name for it (settings.rs SCHEMES)
    const DEFAULT = 'Melaton Aero (system scheme)';
    const SCHEMES = {
        [DEFAULT]: { suffix: '', host: 'aero' },
        'Melaton Aero (large) (system scheme)': { suffix: '_l', host: 'aero-large' },
        'Melaton Aero (extra large) (system scheme)': { suffix: '_xl', host: 'aero-xl' }
    };
    const DESKTOP = 'HKCU\\Control Panel\\Desktop';

    // the desktop in the Android app (the DeX window, a tablet's desktop): its WebView draws CSS cursor images as the
    // mouse pointer (Chromium hands them to View.setPointerIcon), so it gets Windows Aero by default as DreamOS does
    const deviceDesktop = !!(root.AndroidContinuity || root.AndroidPointer) && root.uiShell !== 'mobile';

    /** the scheme's registry value: null = never chosen (DreamOS and device desktops: Windows Aero, as Vista;
     *  elsewhere the browser's), '' = (None) */
    function current() {
        const reg = root.melatonRegistry;
        const v = reg ? reg.get(KEY, 'Scheme', null) : null;
        if (v === null || v === undefined) return root.DreamOSSettings || deviceDesktop ? DEFAULT : '';
        return String(v);
    }

    // the 1.25x ... 2x copies (#921, scripts/build-hidpi-assets.js) and 2.5x / 3x ones of the pointers only
    // (vista-cursors/x250, x300: Catmull-Rom from the 1x art, as the HiDPI build's soft art; in the core package, the
    // DPI Scaling dialog goes to 300 % and the Mac's Larger scale is 250 %). The browser takes the copy for the
    // screen's density and takes another when the scale changes (checked on DreamOS at 1 / 1.25 / 1.5 / 2: the same
    // size as the compositor's pointer); the hot spot stays in CSS px
    const HIDPI = [[125, 1.25], [150, 1.5], [175, 1.75], [200, 2]];
    const HIGHER = [[250, 2.5], [300, 3]];
    function art(name) {
        const sets = HIDPI.map(([t, d]) => `url("/static_images/hidpi/${t}/vista-cursors/${name}") ${d}x`)
            .concat(HIGHER.map(([t, d]) => `url("${ART}/x${t}/${name}") ${d}x`));
        return `image-set(url("${ART}/${name}") 1x, ${sets.join(', ')})`;
    }

    // the user's registry is loaded (before that only defaults would be sent, over the machine's kept settings)
    let hydrated = false;
    // what CaféReady was last told (it keeps it on /data; told again on each page start)
    let told = null;
    function tellHost(scheme) {
        const host = root.DreamOSSettings && root.DreamOSSettings.pointer;
        if (!host || !hydrated) return;
        const reg = root.melatonRegistry;
        const patch = { scheme: scheme ? scheme.host : 'none', hideWhileTyping: !!(reg ? reg.get(DESKTOP, 'MouseVanish', true) : true) };
        const key = JSON.stringify(patch);
        if (key === told) return;
        told = key;
        host.set(patch).catch(() => { told = null; });
    }

    // winlogon is up: from here the pointer stays when it is still (once per page)
    let shownSent = false;
    function shown() {
        const host = root.DreamOSSettings && root.DreamOSSettings.pointer;
        if (!host || shownSent) return;
        shownSent = true;
        host.set({ shown: true }).catch(() => { shownSent = false; });
    }

    function apply() {
        if (!doc) return;
        let scheme = SCHEMES[current()];
        tellHost(scheme);
        // Melaton Mobile has no mouse pointer of its own: a mouse on the phone keeps Android's
        if (root.uiShell === 'mobile') scheme = null;
        const html = doc.documentElement;
        Object.entries(TOKENS).forEach(([token, file]) => {
            if (!scheme) {
                html.style.removeProperty(token);
                return;
            }
            const [hx, hy] = HOT[file + scheme.suffix];
            html.style.setProperty(token, `${art(`${file}${scheme.suffix}.png`)} ${hx} ${hy}, ${FALLBACK[token]}`);
        });
        html.toggleAttribute('data-pointer-scheme', !!scheme);
    }

    // ---- DreamOS: Mouse / Keyboard Properties' registry values in the compositor ---------------------------------------
    const MOUSE = 'HKCU\\Control Panel\\Mouse';
    const KEYBOARD = 'HKCU\\Control Panel\\Keyboard';
    let inputTold = null;
    let input = null;
    function syncInput() {
        const host = root.DreamOSSettings && root.DreamOSSettings.input;
        const reg = root.melatonRegistry;
        if (!host || !reg || !hydrated) return;
        const num = (key, name, def, lo, hi) => {
            const v = Number(reg.get(key, name, def));
            return Math.max(lo, Math.min(hi, Number.isFinite(v) ? v : def));
        };
        // Windows' pointer speed 1-20 (10 = the middle notch) -> libinput -1..1
        const speed = Math.round((num(MOUSE, 'MouseSensitivity', 10, 1, 20) - 10) * 10) / 100;
        const patch = {
            leftHanded: !!reg.get(MOUSE, 'SwapMouseButtons', false),
            mouseSpeed: speed,
            speed,
            mouseAccel: !!reg.get(MOUSE, 'EnhancePointerPrecision', true),
            // Keyboard Properties: delay 0-3 = 250-1000 ms, rate 0-31 = about 2.5-30 characters a second (Windows')
            repeatDelay: 250 * (num(KEYBOARD, 'KeyboardDelay', 1, 0, 3) + 1),
            repeatRate: Math.round(2.5 + num(KEYBOARD, 'KeyboardSpeed', 31, 0, 31) * 27.5 / 31)
        };
        const key = JSON.stringify(patch);
        if (key === inputTold) return;
        inputTold = key;
        host.set(patch).then((st) => { if (st && !st.error) input = st; }).catch(() => { inputTold = null; });
    }

    /** CaféReady's input settings (null off DreamOS or until read); a sheet that changed them passes the new state */
    function inputState(next) {
        if (next) input = next;
        return input;
    }

    function start() {
        const reg = root.melatonRegistry;
        if (!reg) return;
        // loaded already when this runs after the user's settings came (a value in it is enough to know)
        hydrated = Object.keys(reg._data || {}).length > 0;
        reg.onChange((key) => {
            if (key === null) hydrated = true;
            if (key === null || key === KEY || key === DESKTOP) apply();
            if (key === null || key === MOUSE || key === KEYBOARD) syncInput();
        });
        apply();
        syncInput();
        const host = root.DreamOSSettings && root.DreamOSSettings.input;
        if (host) host.get().then((st) => { if (st && !st.error && !input) input = st; }).catch(() => {});
    }

    root.melatonPointerScheme = { SCHEMES: Object.keys(SCHEMES), DEFAULT, current, apply, shown, inputState, ART };
    start();
})(typeof window !== 'undefined' ? window : globalThis);
