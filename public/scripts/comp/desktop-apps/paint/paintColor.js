/**
 * Paint's colours, the Photoshop way (Yozora #632), in place of Vista's 28-colour box and Edit Colors:
 *
 *   color box   the drawing / background chips (Switch, Default), Photoshop's spectrum ramp (hue
 *               across, white above, black below: click or drag to pick, right-click or Alt for the
 *               background colour), and the saved swatches (click: drawing colour, right-click:
 *               background colour, Alt+click: delete; + saves the drawing colour). The swatches are
 *               kept in the registry (Applets\Paint\Swatches) and shared by every Paint window.
 *   Color Picker  the saturation / brightness field for the hue, the hue bar, new / current, H S B,
 *               R G B and #hex, Add to Swatches. A click on a chip opens it.
 *
 *   paintColor.mount(w)   paintColor.picker(w, 'fg' | 'bg')   paintColor.menu(w)   paintColor.action(w, a)
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const V = () => root.vistaDialogTemplate;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint';
    // Photoshop's default swatches (the first rows of its RGB set), then greys
    const DEFAULT_SWATCHES = [
        '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffffff', '#e6e6e6', '#cccccc', '#b3b3b3',
        '#999999', '#808080', '#666666', '#4d4d4d', '#333333', '#1a1a1a', '#000000', '#ed1c24', '#f26522', '#f7941d',
        '#fff200', '#8dc63f', '#39b54a', '#00a651', '#00a99d', '#00aeef', '#0072bc', '#0054a6', '#2e3192', '#662d91',
        '#92278f', '#ec008c', '#ed145b', '#c69c6d', '#a67c52', '#8c6239', '#754c24', '#603913', '#f69679', '#fdc689'
    ];
    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function hex(r, g, b) {
        return `#${[r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('')}`;
    }

    function rgbOf(css) {
        const [r, g, b] = C().parseColor(css);
        return [r, g, b];
    }

    function rgbToHsv(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        const d = max - min;
        let h = 0;
        if (d) {
            if (max === r) h = ((g - b) / d) % 6;
            else if (max === g) h = (b - r) / d + 2;
            else h = (r - g) / d + 4;
            h *= 60;
            if (h < 0) h += 360;
        }
        return [h, max ? d / max : 0, max];
    }

    function hsvToRgb(h, s, v) {
        const c = v * s;
        const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
        const m = v - c;
        const [r, g, b] = h < 60 ? [c, x, 0] : h < 120 ? [x, c, 0] : h < 180 ? [0, c, x] : h < 240 ? [0, x, c] : h < 300 ? [x, 0, c] : [c, 0, x];
        return [(r + m) * 255, (g + m) * 255, (b + m) * 255];
    }

    // ---- saved swatches --------------------------------------------------------------------------

    function swatches() {
        const r = root.melatonRegistry;
        const raw = r ? r.get(KEY, 'Swatches', '') : '';
        try {
            const list = JSON.parse(raw || 'null');
            if (Array.isArray(list)) return list.filter((c) => /^#[0-9a-f]{6}$/i.test(c));
        } catch (_) { /* a damaged value starts over */ }
        return DEFAULT_SWATCHES.slice();
    }

    function saveSwatches(list) {
        const r = root.melatonRegistry;
        if (r) void r.set(KEY, { Swatches: JSON.stringify(list.slice(0, 400)) });
        const all = root.melatonPaint ? root.melatonPaint.instances : [];
        all.forEach((w) => renderSwatches(w, list));
    }

    function addSwatch(color) {
        const list = swatches();
        const c = color.toLowerCase();
        const at = list.indexOf(c);
        if (at >= 0) list.splice(at, 1);
        list.push(c);
        saveSwatches(list);
    }

    // ---- the color box -------------------------------------------------------------------------

    function drawRamp(canvas) {
        const x = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        const hue = x.createLinearGradient(0, 0, W, 0);
        ['#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ff0000'].forEach((c, i) => hue.addColorStop(i / 6, c));
        x.fillStyle = hue;
        x.fillRect(0, 0, W, H);
        const top = x.createLinearGradient(0, 0, 0, H / 2);
        top.addColorStop(0, 'rgba(255,255,255,1)');
        top.addColorStop(1, 'rgba(255,255,255,0)');
        x.fillStyle = top;
        x.fillRect(0, 0, W, H / 2);
        const bot = x.createLinearGradient(0, H / 2, 0, H);
        bot.addColorStop(0, 'rgba(0,0,0,0)');
        bot.addColorStop(1, 'rgba(0,0,0,1)');
        x.fillStyle = bot;
        x.fillRect(0, H / 2, W, H / 2);
    }

    function mount(w) {
        const box = w.modal.querySelector('.mp-colorbox');
        box.innerHTML = `
            <div class="mp-swatch-box"><span class="mp-bg" title="Set background color"></span><span class="mp-fg" title="Set foreground color"></span><button type="button" class="mp-default-colors" title="Default Colors (D)"></button><button type="button" class="mp-swap-colors" title="Switch Colors (X)"></button></div>
            <canvas class="mp-ramp" width="180" height="32" title="Click: drawing color. Right-click or Alt+click: background color."></canvas>
            <div class="mp-swatches" role="listbox" aria-label="Swatches"></div>
            <div class="mp-sw-tools">
                <button type="button" class="mp-sw-add" title="Create new swatch of foreground color"></button>
                <button type="button" class="mp-sw-menu" title="Swatches"></button>
            </div>`;
        drawRamp(box.querySelector('.mp-ramp'));
        const ramp = box.querySelector('.mp-ramp');
        const pick = (ev, bg) => {
            const r = ramp.getBoundingClientRect();
            const x = clamp(Math.floor(((ev.clientX - r.left) / r.width) * ramp.width), 0, ramp.width - 1);
            const y = clamp(Math.floor(((ev.clientY - r.top) / r.height) * ramp.height), 0, ramp.height - 1);
            const d = ramp.getContext('2d').getImageData(x, y, 1, 1).data;
            if (bg) w.bg = hex(d[0], d[1], d[2]); else w.fg = hex(d[0], d[1], d[2]);
            w.renderColors();
        };
        ramp.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            ramp.setPointerCapture(ev.pointerId);
            const bg = ev.button === 2 || ev.altKey;
            pick(ev, bg);
            const move = (mv) => pick(mv, bg);
            const up = () => { ramp.removeEventListener('pointermove', move); ramp.removeEventListener('pointerup', up); };
            ramp.addEventListener('pointermove', move);
            ramp.addEventListener('pointerup', up);
        });
        ramp.addEventListener('contextmenu', (ev) => ev.preventDefault());
        const list = box.querySelector('.mp-swatches');
        list.addEventListener('mousedown', (ev) => {
            const cell = ev.target.closest('.mp-sw-cell');
            if (!cell) return;
            ev.preventDefault();
            const c = cell.dataset.c;
            if (ev.altKey) {
                saveSwatches(swatches().filter((x) => x !== c));
                return;
            }
            if (ev.button === 2) w.bg = c; else w.fg = c;
            w.renderColors();
        });
        list.addEventListener('contextmenu', (ev) => ev.preventDefault());
        list.addEventListener('wheel', (ev) => {
            if (!ev.deltaY) return;
            ev.preventDefault();
            list.scrollLeft += ev.deltaY;
        }, { passive: false });
        box.querySelector('.mp-sw-add').addEventListener('click', () => addSwatch(w.fg));
        root.contextMenu.attachClickMenuToElement(box.querySelector('.mp-sw-menu'), {
            onAction: (a) => void w.action(a),
            sections: [{ type: 'list', initfn: (section) => { section.items = menu(w); } }]
        });
        box.querySelector('.mp-fg').addEventListener('click', () => picker(w, 'fg'));
        box.querySelector('.mp-bg').addEventListener('click', () => picker(w, 'bg'));
        box.querySelector('.mp-swap-colors').addEventListener('click', () => void w.action('swap-colors'));
        box.querySelector('.mp-default-colors').addEventListener('click', () => void w.action('default-colors'));
        renderSwatches(w, swatches());
    }

    function renderSwatches(w, list) {
        const el = w.modal && w.modal.querySelector('.mp-swatches');
        if (!el) return;
        el.innerHTML = list.map((c) => `<button type="button" class="mp-sw-cell" data-c="${esc(c)}" style="background:${esc(c)}" title="${esc(c.toUpperCase())}" role="option"></button>`).join('');
    }

    // ---- the Color Picker ----------------------------------------------------------------------

    function picker(w, which = 'fg', opts = {}) {
        if (!V()) return;
        const start = opts.color || (which === 'bg' ? w.bg : w.fg);
        const [r0, g0, b0] = rgbOf(start);
        let [h, s, v] = rgbToHsv(r0, g0, b0);
        const tpl = { t: opts.title || `Color Picker (${which === 'bg' ? 'Background' : 'Foreground'} Color)`, w: 330, h: 176, f: ['MS Shell Dlg', 8], c: [
            [110, 'MpPickField', 7, 7, 172, 158, 0x50000000, '', 0],
            [111, 'MpPickHue', 184, 7, 16, 158, 0x50000000, '', 0],
            [-1, 'S', 207, 7, 44, 8, 0x50020001, 'new', 0],
            [112, 'MpPickPreview', 207, 16, 44, 40, 0x50000000, '', 0],
            [-1, 'S', 207, 58, 44, 8, 0x50020001, 'current', 0],
            [1, 'B', 264, 7, 59, 14, 0x50010001, 'OK', 0],
            [2, 'B', 264, 25, 59, 14, 0x50010000, 'Cancel', 0],
            [130, 'B', 264, 43, 59, 14, 0x50010000, '&Add to Swatches', 0],
            [-1, 'S', 207, 78, 10, 8, 0x50020000, '&H:', 0], [121, 'E', 219, 76, 28, 12, 0x50812080, '', 0], [-1, 'S', 249, 78, 8, 8, 0x50020000, '°', 0],
            [-1, 'S', 207, 93, 10, 8, 0x50020000, '&S:', 0], [122, 'E', 219, 91, 28, 12, 0x50812080, '', 0], [-1, 'S', 249, 93, 8, 8, 0x50020000, '%', 0],
            [-1, 'S', 207, 108, 10, 8, 0x50020000, '&B:', 0], [123, 'E', 219, 106, 28, 12, 0x50812080, '', 0], [-1, 'S', 249, 108, 8, 8, 0x50020000, '%', 0],
            [-1, 'S', 266, 78, 10, 8, 0x50020000, '&R:', 0], [124, 'E', 278, 76, 28, 12, 0x50812080, '', 0],
            [-1, 'S', 266, 93, 10, 8, 0x50020000, '&G:', 0], [125, 'E', 278, 91, 28, 12, 0x50812080, '', 0],
            [-1, 'S', 266, 108, 10, 8, 0x50020000, 'B:', 0], [126, 'E', 278, 106, 28, 12, 0x50812080, '', 0],
            [-1, 'S', 207, 129, 10, 8, 0x50020000, '#', 0], [127, 'E', 219, 127, 50, 12, 0x50810080, '', 0]
        ] };
        let sync = () => {};
        const current = () => hex(...hsvToRgb(h, s, v));
        V().openDialog({
            id: 'mpColorPicker',
            tpl,
            owner: w.modal,
            buttons: {
                130() { addSwatch(current()); }
            },
            init(ctx) {
                const field = ctx.holder(110);
                field.innerHTML = '<div class="mp-pk-field"><div class="mp-pk-white"></div><div class="mp-pk-black"></div><i class="mp-pk-ring"></i></div>';
                const hueEl = ctx.holder(111);
                hueEl.innerHTML = '<div class="mp-pk-hue"><i class="mp-pk-arrows"></i></div>';
                const prev = ctx.holder(112);
                prev.innerHTML = `<div class="mp-pk-new"></div><div class="mp-pk-old" style="background:${esc(start)}" title="Click to restore the current color"></div>`;
                const area = field.querySelector('.mp-pk-field');
                const ring = field.querySelector('.mp-pk-ring');
                const bar = hueEl.querySelector('.mp-pk-hue');
                const arrows = hueEl.querySelector('.mp-pk-arrows');
                sync = (skip) => {
                    const [r, g, b] = hsvToRgb(h, s, v);
                    area.style.background = hex(...hsvToRgb(h, 1, 1));
                    ring.style.left = `${s * 100}%`;
                    ring.style.top = `${(1 - v) * 100}%`;
                    ring.classList.toggle('is-dark', v > 0.6 && s < 0.4);
                    arrows.style.top = `${(1 - h / 360) * 100}%`;
                    prev.querySelector('.mp-pk-new').style.background = hex(r, g, b);
                    const set = (id, val) => { if (skip !== id) ctx.set(id, String(val)); };
                    set(121, Math.round(h)); set(122, Math.round(s * 100)); set(123, Math.round(v * 100));
                    set(124, Math.round(r)); set(125, Math.round(g)); set(126, Math.round(b));
                    set(127, hex(r, g, b).slice(1));
                };
                const drag = (el, fn) => el.addEventListener('pointerdown', (ev) => {
                    ev.preventDefault();
                    el.setPointerCapture(ev.pointerId);
                    const go = (e) => { const rc = el.getBoundingClientRect(); fn(clamp((e.clientX - rc.left) / rc.width, 0, 1), clamp((e.clientY - rc.top) / rc.height, 0, 1)); sync(); };
                    go(ev);
                    const up = () => { el.removeEventListener('pointermove', go); el.removeEventListener('pointerup', up); };
                    el.addEventListener('pointermove', go);
                    el.addEventListener('pointerup', up);
                });
                drag(area, (x, y) => { s = x; v = 1 - y; });
                drag(bar, (x, y) => { h = (1 - y) * 360; if (h >= 360) h = 0; });
                prev.querySelector('.mp-pk-old').addEventListener('click', () => { [h, s, v] = rgbToHsv(r0, g0, b0); sync(); });
                const num = (id, lo, hi) => clamp(Number(ctx.get(id)) || 0, lo, hi);
                [121, 122, 123].forEach((id) => ctx.on(id, 'input', () => {
                    h = num(121, 0, 359); s = num(122, 0, 100) / 100; v = num(123, 0, 100) / 100;
                    sync(id);
                }));
                [124, 125, 126].forEach((id) => ctx.on(id, 'input', () => {
                    [h, s, v] = rgbToHsv(num(124, 0, 255), num(125, 0, 255), num(126, 0, 255));
                    sync(id);
                }));
                ctx.on(127, 'input', () => {
                    const t = String(ctx.get(127)).replace(/[^0-9a-f]/gi, '');
                    if (t.length !== 6 && t.length !== 3) return;
                    [h, s, v] = rgbToHsv(...rgbOf(`#${t}`));
                    sync(127);
                });
                sync();
            },
            ok() {
                const c = current();
                if (opts.onPick) { opts.onPick(c); return; }
                if (which === 'bg') w.bg = c; else w.fg = c;
                w.renderColors();
            }
        });
    }

    // ---- the Colors menu --------------------------------------------------------------------------

    function menu() {
        return [
            { text: 'Foreground Color...', action: 'color-pick-fg' },
            { text: 'Background Color...', action: 'color-pick-bg' },
            { separator: true },
            { text: 'New Swatch of Foreground Color', action: 'color-swatch-add' },
            { text: 'Reset Swatches', action: 'color-swatch-reset' },
            { text: 'Clear Swatches', action: 'color-swatch-clear' },
            { separator: true },
            { text: 'Switch Colors', subtext: 'X', action: 'swap-colors' },
            { text: 'Default Colors', subtext: 'D', action: 'default-colors' }
        ];
    }

    function action(w, a) {
        switch (a) {
            case 'color-pick-fg': case 'edit-colors': picker(w, 'fg'); return true;
            case 'color-pick-bg': picker(w, 'bg'); return true;
            case 'color-swatch-add': addSwatch(w.fg); return true;
            case 'color-swatch-reset': saveSwatches(DEFAULT_SWATCHES.slice()); return true;
            case 'color-swatch-clear': saveSwatches([]); return true;
            default: return false;
        }
    }

    root.paintColor = { mount, picker, menu, action, swatches, addSwatch, rgbToHsv, hsvToRgb, DEFAULT_SWATCHES };
})(typeof window !== 'undefined' ? window : globalThis);
