/**
 * uiTheme: the one owner of the named theme (docs/design/ui-standard.md section 1, #851 / #864).
 *
 * Desktop theme id   body.theme-vista (later body.theme-xp), mirrored as html[data-theme="vista"].
 * Boot theme         while body.windows-classic-theme is on (boot, logon, the lock dialogs) no
 *                    theme-* class is on body and html[data-theme] is "classic".
 *                    body.vista-basic-theme is still Vista: theme-vista stays on under it.
 * Phone theme id     html[data-wm-version] ("6.1" / "6.5"), owned by the phone shell; read here.
 *
 * CSS scopes a theme's rules by its id (body.theme-vista ...), never by "not Classic". Scripts ask
 * this helper and carry no test of their own:
 *
 *   uiTheme.desktop()            'vista' | 'xp' | 'classic'   what the desktop is drawn in now
 *   uiTheme.is('vista')          desktop() === id
 *   uiTheme.phone()              '6.1' | '6.5' | null
 *   uiTheme.chosen()             the user's desktop theme (localStorage desktopTheme; 'vista')
 *   uiTheme.setBootTheme(id)     'classic' puts the boot theme on, null takes it off
 *   uiTheme.onChange(fn)         fn(desktop, previous) after the desktop theme changed; returns
 *                                a function that removes the listener
 *
 * The body class and the html attribute change in the same task, so no frame paints with both or
 * neither. A body class observer covers any site that still toggles windows-classic-theme itself
 * (its callback is a microtask: it runs before the next render).
 *
 * First paint: each page sets html[data-theme] in an inline head snippet and carries theme-vista on
 * <body> in its markup; this file takes over from there.
 */
(function () {
    'use strict';

    if (typeof window === 'undefined' || typeof document === 'undefined') return;
    if (window.uiTheme) return;

    const STORAGE_KEY = 'desktopTheme';
    const DESKTOP_THEMES = ['vista'];
    const DEFAULT_THEME = 'vista';
    const BOOT_CLASSIC = 'classic';
    const CLASSIC_CLASS = 'windows-classic-theme';
    const themeClass = (id) => 'theme-' + id;

    const listeners = [];
    let last = null;
    let observed = null;

    function chosen() {
        let stored = null;
        try { stored = localStorage.getItem(STORAGE_KEY); } catch (e) { /* storage blocked */ }
        return DESKTOP_THEMES.indexOf(stored) !== -1 ? stored : DEFAULT_THEME;
    }

    function body() {
        return document.body || null;
    }

    function classicOn() {
        const b = body();
        return !!b && b.classList.contains(CLASSIC_CLASS);
    }

    function desktop() {
        return classicOn() ? BOOT_CLASSIC : chosen();
    }

    function notify(now, before) {
        listeners.slice().forEach((fn) => {
            try { fn(now, before); } catch (err) {
                if (typeof console !== 'undefined' && console.warn) console.warn('uiTheme listener failed:', err);
            }
        });
    }

    /** Body class and html attribute follow the boot theme and the chosen theme. */
    function sync() {
        const now = desktop();
        const b = body();
        if (b) {
            DESKTOP_THEMES.forEach((id) => {
                const on = id === now;
                if (b.classList.contains(themeClass(id)) !== on) b.classList.toggle(themeClass(id), on);
            });
            watch(b);
        }
        const root = document.documentElement;
        if (root && root.getAttribute('data-theme') !== now) root.setAttribute('data-theme', now);
        if (now !== last) {
            const before = last;
            last = now;
            if (before !== null) notify(now, before);
        }
        return now;
    }

    function watch(b) {
        if (observed === b || typeof MutationObserver !== 'function') return;
        observed = b;
        new MutationObserver(sync).observe(b, { attributes: true, attributeFilter: ['class'] });
    }

    function setBootTheme(id) {
        const b = body();
        if (b) {
            const on = id === BOOT_CLASSIC;
            if (b.classList.contains(CLASSIC_CLASS) !== on) b.classList.toggle(CLASSIC_CLASS, on);
        }
        return sync();
    }

    function phone() {
        const root = document.documentElement;
        const v = root ? root.getAttribute('data-wm-version') : null;
        return v === '6.1' || v === '6.5' ? v : null;
    }

    function onChange(fn) {
        if (typeof fn !== 'function') return function () {};
        listeners.push(fn);
        return function () {
            const i = listeners.indexOf(fn);
            if (i !== -1) listeners.splice(i, 1);
        };
    }

    window.uiTheme = {
        desktop: desktop,
        is: function (id) { return desktop() === id; },
        phone: phone,
        chosen: chosen,
        setBootTheme: setBootTheme,
        onChange: onChange,
        /** Re-read body and storage (after a page wrote the body class itself). */
        sync: sync
    };

    sync();
    if (!body()) document.addEventListener('DOMContentLoaded', sync, { once: true });
})();
