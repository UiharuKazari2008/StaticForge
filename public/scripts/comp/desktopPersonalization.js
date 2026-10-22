/**
 * Personalization settings per workspace (Yukimi 2026-10-21): Vista's Window Color and
 * Appearance (window colour, transparency, colour intensity), the sound events, and the screen
 * saver. Each workspace keeps its own copy, as a Vista theme does.
 *
 *   windowColor    'clear' (the default: glass with no tint) | 'workspace' (the frame colour the
 *                  workspace theme derives from its background colour, as before) | a Vista swatch
 *                  (default, graphite, blue, teal, red, orange, pink, frost) | 'custom' (the mixer)
 *   customColor    { h 0-359, s 0-100, b 0-100 }, Vista's color mixer
 *   intensity      10-85, the range of Vista's Color intensity slider; picking a swatch resets it to
 *                  the swatch's own. It sets the frame tint's opacity, and moving it away from the
 *                  swatch's value thickens or thins the taskbar and Start menu glass too.
 *   transparency   false: opaque frames (Vista's Enable transparency)
 *   soundScheme    'default' | 'none' (No Sounds)
 *   sounds         { [event]: file | '' }: an event's own sound; '' is (None). Missing = the scheme's
 *   startupSound   false: no sound when the desktop comes up (Play Windows Startup sound)
 *   screenSaver    { id, wait (minutes), resumeLogon }, run by screenSaver.js
 *
 * Saved on the workspace record (`personalization`, modules/workspace.js) through
 * wsClient.updateWorkspaceSettings, and in localStorage `desktop-personalization:<id>` so it holds
 * on a server that does not store the field yet.
 *
 * Colour: one <style id="desktopPersonalizationStyle"> after every stylesheet. Windows get their
 * own --glass-windows-bg (aero-glass.css builds the frame tint from it in live and frosted) and, in
 * basic, an opaque --aero-frame-base; nothing else that reads the workspace glass colour changes
 * (Yukimi: the colour only affects the windows). The default (Clear at its own intensity, with
 * transparency) writes no glass rules for the taskbar or Start menu.
 */
(function (root) {
    'use strict';

    const doc = typeof document !== 'undefined' ? document : null;
    const STORAGE_PREFIX = 'desktop-personalization:';
    const STYLE_ID = 'desktopPersonalizationStyle';
    const INTENSITY_MIN = 10;
    const INTENSITY_MAX = 85;

    /* Vista's eight swatches (themecpl.dll 101-108; art: /static_images/vista-personalization/
       swatch-*.png) with the ColorizationColor each sets, measured on the VM: rgb and the alpha as
       the intensity slider shows it. Clear and Workspace are ours. */
    const SWATCHES = [
        { id: 'clear', name: 'Clear', rgb: [116, 128, 140], intensity: 30 },
        { id: 'workspace', name: 'Workspace', rgb: null, intensity: 75 },
        { id: 'default', name: 'Default', rgb: [64, 158, 254], intensity: 27 },
        { id: 'graphite', name: 'Graphite', rgb: [0, 0, 0], intensity: 64 },
        { id: 'blue', name: 'Blue', rgb: [0, 70, 173], intensity: 66 },
        { id: 'teal', name: 'Teal', rgb: [0, 139, 139], intensity: 51 },
        { id: 'red', name: 'Red', rgb: [159, 0, 0], intensity: 62 },
        { id: 'orange', name: 'Orange', rgb: [255, 115, 0], intensity: 63 },
        { id: 'pink', name: 'Pink', rgb: [255, 77, 255], intensity: 65 },
        { id: 'frost', name: 'Frost', rgb: [255, 255, 255], intensity: 24 }
    ];
    const SWATCH_IDS = SWATCHES.map((s) => s.id).concat(['custom']);

    const SCREEN_SAVERS = ['none', 'aurora', 'blank', 'bubbles', 'focus', 'logo', 'mystify', 'photos', 'ribbons'];

    const DEFAULTS = {
        windowColor: 'clear',
        customColor: { h: 210, s: 60, b: 80 },
        intensity: 30,
        transparency: true,
        soundScheme: 'default',
        sounds: {},
        startupSound: true,
        screenSaver: { id: 'none', wait: 10, resumeLogon: false }
    };

    let current = null;      // the active workspace's settings
    let currentId = null;
    const listeners = new Set();

    // ---- helpers ----

    function clamp(n, lo, hi, fallback) {
        const v = Number(n);
        if (!Number.isFinite(v)) return fallback;
        return Math.min(hi, Math.max(lo, Math.round(v)));
    }

    function swatch(id) {
        return SWATCHES.find((s) => s.id === id) || null;
    }

    function hsbToRgb(h, s, b) {
        const S = s / 100;
        const V = b / 100;
        const k = (n) => (n + h / 60) % 6;
        const f = (n) => V - V * S * Math.max(0, Math.min(k(n), 4 - k(n), 1));
        return [Math.round(f(5) * 255), Math.round(f(3) * 255), Math.round(f(1) * 255)];
    }

    function rgbToHsb(r, g, b) {
        const R = r / 255;
        const G = g / 255;
        const B = b / 255;
        const max = Math.max(R, G, B);
        const min = Math.min(R, G, B);
        const d = max - min;
        let h = 0;
        if (d) {
            if (max === R) h = ((G - B) / d) % 6;
            else if (max === G) h = (B - R) / d + 2;
            else h = (R - G) / d + 4;
            h = Math.round(h * 60);
            if (h < 0) h += 360;
        }
        return { h, s: max ? Math.round((d / max) * 100) : 0, b: Math.round(max * 100) };
    }

    function hexToHue(hex) {
        const m = /^#?([0-9a-f]{6})$/i.exec(String(hex || '').trim());
        if (!m) return 210;
        const n = parseInt(m[1], 16);
        return rgbToHsb((n >> 16) & 255, (n >> 8) & 255, n & 255).h;
    }

    function normalize(raw) {
        const src = raw && typeof raw === 'object' ? raw : {};
        const cc = src.customColor && typeof src.customColor === 'object' ? src.customColor : {};
        const ss = src.screenSaver && typeof src.screenSaver === 'object' ? src.screenSaver : {};
        const sounds = {};
        if (src.sounds && typeof src.sounds === 'object') {
            Object.keys(src.sounds).forEach((k) => {
                const v = src.sounds[k];
                if (typeof v === 'string' && /^[\w .-]{0,80}$/.test(k) && v.length <= 120) sounds[k] = v;
            });
        }
        const windowColor = SWATCH_IDS.includes(src.windowColor) ? src.windowColor : DEFAULTS.windowColor;
        const fallbackIntensity = (swatch(windowColor) || swatch('clear')).intensity;
        return {
            windowColor,
            customColor: {
                h: clamp(cc.h, 0, 359, DEFAULTS.customColor.h),
                s: clamp(cc.s, 0, 100, DEFAULTS.customColor.s),
                b: clamp(cc.b, 0, 100, DEFAULTS.customColor.b)
            },
            intensity: clamp(src.intensity, INTENSITY_MIN, INTENSITY_MAX, fallbackIntensity),
            transparency: src.transparency !== false,
            soundScheme: src.soundScheme === 'none' ? 'none' : 'default',
            sounds,
            startupSound: src.startupSound !== false,
            screenSaver: {
                id: SCREEN_SAVERS.includes(ss.id) ? ss.id : DEFAULTS.screenSaver.id,
                wait: clamp(ss.wait, 1, 9999, DEFAULTS.screenSaver.wait),
                resumeLogon: ss.resumeLogon === true
            }
        };
    }

    function activeWorkspaceId() {
        /* global activeWorkspace */
        return (typeof activeWorkspace !== 'undefined' && activeWorkspace) || root.currentWorkspace || 'default';
    }

    function workspaceRecord(id) {
        /* global workspaces */
        const list = typeof workspaces !== 'undefined' && workspaces ? workspaces : null;
        return list && list[id] ? list[id] : null;
    }

    function readStored(id) {
        try {
            const raw = root.localStorage && root.localStorage.getItem(STORAGE_PREFIX + id);
            return raw ? JSON.parse(raw) : null;
        } catch (_) {
            return null;
        }
    }

    function writeStored(id, value) {
        try {
            if (root.localStorage) root.localStorage.setItem(STORAGE_PREFIX + id, JSON.stringify(value));
        } catch (_) { /* quota / private mode */ }
    }

    /** The workspace's settings: the record's own, else this browser's copy, else the defaults. */
    function read(id = activeWorkspaceId()) {
        const ws = workspaceRecord(id);
        if (ws && ws.personalization && typeof ws.personalization === 'object') return normalize(ws.personalization);
        return normalize(readStored(id));
    }

    // ---- colour ----

    /** The frame colour as [r, g, b] (null: the workspace theme's own) and its opacity 0-1. */
    function frameColor(p, id = currentId || activeWorkspaceId()) {
        let rgb = null;
        let alpha = p.intensity / 100;
        if (p.windowColor === 'custom') {
            rgb = hsbToRgb(p.customColor.h, p.customColor.s, p.customColor.b);
        } else if (p.windowColor === 'workspace') {
            // the workspace theme's frame: hsl(<background hue> 90% 25%) (workspaceUtils.js)
            const ws = workspaceRecord(id);
            const h = hexToHue(ws && (ws.backgroundColor || ws.color));
            rgb = hsbToRgb(h, 94.7, 47.5); // hsl(h 90% 25%)
        } else {
            const sw = swatch(p.windowColor);
            rgb = sw ? sw.rgb.slice() : null;
            // Clear is barely tinted glass: a third of the intensity in a neutral grey
            if (p.windowColor === 'clear') alpha *= 0.6;
        }
        if (!p.transparency) alpha = 1;
        return { rgb, alpha: Math.min(1, Math.max(0, alpha)) };
    }

    /** How much thicker (above 1) or thinner the taskbar and Start menu glass is. */
    function glassScale(p) {
        const sw = swatch(p.windowColor);
        const base = sw ? sw.intensity : 45;
        if (!p.transparency) return 1.25;
        return Math.min(1.25, Math.max(0.3, 1 + (p.intensity - base) / 75));
    }

    function isDefaultLook(p) {
        return p.windowColor === 'workspace' && p.intensity === swatch('workspace').intensity && p.transparency;
    }

    function cssFor(p) {
        if (isDefaultLook(p)) return '';
        const { rgb, alpha } = frameColor(p);
        if (!rgb) return '';
        const [r, g, b] = rgb;
        const a = Math.round(alpha * 1000) / 1000;
        // basic draws opaque frames; light colours keep Vista Basic's light frame, dark ones darken
        const solid = `rgb(${Math.round(r * 0.62 + 31 * 0.38)} ${Math.round(g * 0.62 + 31 * 0.38)} ${Math.round(b * 0.62 + 31 * 0.38)})`;
        const lines = [
            `.modal { --glass-windows-bg: rgb(${r} ${g} ${b} / ${a}); }`,
            `html[data-glass="basic"] .modal { --aero-frame-base: ${solid}; }`
        ];
        if (!p.transparency) {
            // opaque frames need no backdrop pass
            lines.push('html[data-glass="live"] body.desktop-mode .modal:not(.modal-maximized) { -webkit-backdrop-filter: none; backdrop-filter: none; }');
        }
        const k = glassScale(p);
        if (Math.abs(k - 1) > 0.01) {
            const pct = Math.round(Math.min(100, 55 * k));
            lines.push(`html:not([data-glass="basic"]) .desktop-taskbar::after { opacity: ${Math.min(1, Math.round(0.85 * k * 100) / 100)}; }`);
            lines.push(`html #startMenu.start-menu { --start-menu-tint: color-mix(in srgb, var(--glass-windows-bg, hsl(0 0% 20% / 75%)) ${pct}%, transparent); }`);
        }
        return lines.join('\n');
    }

    function applyColor(p) {
        if (!doc || !doc.head) return;
        let el = doc.getElementById(STYLE_ID);
        const css = cssFor(p);
        if (!css) {
            if (el) el.remove();
            return;
        }
        if (!el) {
            el = doc.createElement('style');
            el.id = STYLE_ID;
        }
        // last in <head>, after every stylesheet (feature CSS appends later; none sets these)
        if (el.parentNode !== doc.head || el !== doc.head.lastElementChild) doc.head.appendChild(el);
        if (el.textContent !== css) el.textContent = css;
    }

    // ---- state ----

    function emit() {
        listeners.forEach((fn) => {
            try { fn(current, currentId); } catch (err) { console.error('desktopPersonalization listener', err); }
        });
        if (doc && typeof CustomEvent === 'function') {
            doc.dispatchEvent(new CustomEvent('desktopPersonalizationChanged', { detail: { settings: current, workspaceId: currentId } }));
        }
    }

    function refresh() {
        currentId = activeWorkspaceId();
        current = read(currentId);
        applyColor(current);
        emit();
        return current;
    }

    /** Apply a change now (preview); save: true also stores it on the workspace. */
    function update(patch, { save = true, id = currentId || activeWorkspaceId() } = {}) {
        const base = id === currentId && current ? current : read(id);
        const next = normalize({
            ...base,
            ...patch,
            customColor: { ...base.customColor, ...(patch && patch.customColor) },
            screenSaver: { ...base.screenSaver, ...(patch && patch.screenSaver) },
            sounds: patch && patch.sounds ? { ...patch.sounds } : base.sounds
        });
        if (id === (currentId || activeWorkspaceId())) {
            currentId = id;
            current = next;
            applyColor(next);
            emit();
        }
        if (save) persist(id, next);
        return next;
    }

    async function persist(id, value) {
        writeStored(id, value);
        const ws = workspaceRecord(id);
        if (ws) ws.personalization = value;
        const client = root.wsClient;
        if (!client || typeof client.updateWorkspaceSettings !== 'function') return;
        if (typeof client.isConnected === 'function' && !client.isConnected()) return;
        try {
            await client.updateWorkspaceSettings(id, { personalization: value });
        } catch (err) {
            console.warn('desktopPersonalization: workspace save failed, kept in this browser', err && err.message);
        }
    }

    function get() {
        return current || refresh();
    }

    /** desktopSounds.js: an event's file, '' for (None), undefined for the scheme's own. */
    function soundFile(eventId) {
        const p = get();
        if (p.soundScheme === 'none') return '';
        if (eventId === 'logon-startup' && !p.startupSound) return '';
        return Object.prototype.hasOwnProperty.call(p.sounds, eventId) ? p.sounds[eventId] : undefined;
    }

    function bind() {
        if (!doc) return;
        doc.addEventListener('workspaceChanged', refresh);
        doc.addEventListener('workspaceSwitchComplete', refresh);
        // another window saved (settings_updated carries the record's new fields)
        doc.addEventListener('workspaceUpdated', (ev) => {
            const d = ev && ev.detail;
            if (!d || d.workspaceId !== (currentId || activeWorkspaceId())) return;
            if (d.settings && (d.settings.personalization || d.settings.backgroundColor || d.settings.color)) refresh();
        });
        refresh();
    }

    const api = {
        SWATCHES,
        SCREEN_SAVERS,
        DEFAULTS,
        INTENSITY_MIN,
        INTENSITY_MAX,
        get,
        read,
        update,
        refresh,
        soundFile,
        frameColor,
        hsbToRgb,
        rgbToHsb,
        swatch,
        onChange: (fn) => { listeners.add(fn); return () => listeners.delete(fn); },
        _test: { normalize, cssFor, glassScale }
    };

    root.desktopPersonalization = api;
    if (doc) {
        if (doc.readyState === 'loading') doc.addEventListener('DOMContentLoaded', bind);
        else bind();
    }
    if (typeof module !== 'undefined' && module.exports) module.exports = api;
})(typeof window !== 'undefined' ? window : globalThis);
