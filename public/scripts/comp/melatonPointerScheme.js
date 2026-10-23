/**
 * Mouse Properties > Pointers (Yozora #632): the pointer scheme in Melaton's registry
 * (HKCU\Control Panel\Cursors, Scheme) drawn with Vista's own Aero cursors
 * (C:\Windows\Cursors\aero_*.cur from the Vista VM, PNG with their hot spots in
 * public/static_images/vista-cursors/). Every cursor in the app reads the --c-* tokens on html
 * (public/css/desktop-cursors.css), so a scheme only sets those; "(None)" and no value at all
 * keep the browser's own pointers. The animated busy pointers show their first frame.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const KEY = 'HKCU\\Control Panel\\Cursors';
    const ART = '/static_images/vista-cursors';
    // [width, hot x, hot y] of each 32 px cursor; the large and extra large ones scale them
    const HOT = {
        aero_arrow: [0, 0], aero_busy: [16, 16], aero_ew: [15, 15], aero_helpsel: [0, 0], aero_link: [5, 0],
        aero_move: [15, 15], aero_nesw: [15, 15], aero_ns: [15, 15], aero_nwse: [15, 15], aero_pen: [0, 0],
        aero_unavail: [16, 16], aero_up: [15, 4], aero_working: [0, 8]
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

    const SCHEMES = {
        'Melaton Aero (system scheme)': { suffix: '', scale: 1 },
        'Melaton Aero (large) (system scheme)': { suffix: '_l', scale: 1.5 },
        'Melaton Aero (extra large) (system scheme)': { suffix: '_xl', scale: 2 }
    };

    function apply() {
        if (!doc) return;
        const reg = root.melatonRegistry;
        const name = reg ? reg.get(KEY, 'Scheme', '') : '';
        const scheme = SCHEMES[name];
        const html = doc.documentElement;
        Object.entries(TOKENS).forEach(([token, file]) => {
            if (!scheme) {
                html.style.removeProperty(token);
                return;
            }
            const [hx, hy] = HOT[file];
            const s = scheme.scale;
            html.style.setProperty(token, `url("${ART}/${file}${scheme.suffix}.png") ${Math.round(hx * s)} ${Math.round(hy * s)}, ${FALLBACK[token]}`);
        });
        html.toggleAttribute('data-pointer-scheme', !!scheme);
    }

    function start() {
        const reg = root.melatonRegistry;
        if (!reg) return;
        reg.onChange((key) => {
            if (key === null || key === KEY) apply();
        });
        apply();
    }

    root.melatonPointerScheme = { SCHEMES: Object.keys(SCHEMES), apply, ART };
    start();
})(typeof window !== 'undefined' ? window : globalThis);
