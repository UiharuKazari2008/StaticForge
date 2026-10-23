/**
 * Paint's colours, the Photoshop way (Yozora #632), in place of Vista's 28-colour box and Edit Colors:
 *
 *   color box   the drawing / background chips (Switch, Default), Photoshop's spectrum ramp (hue
 *               across, white above, black below: click or drag to pick, right-click or Alt for the
 *               background colour), and the saved swatches (click: drawing colour, right-click:
 *               background colour, Alt+click: delete; + saves the drawing colour). The swatches are
 *               kept in the registry (Applets\Paint\Swatches) and shared by every Paint window.
 *   Color Picker  the saturation / brightness field for the hue, the hue bar, the alpha bar, new /
 *               current, H S B, R G B, A and #hex (8 digits with alpha), Add to Swatches. A click
 *               on a chip opens it. Every colour may carry alpha (#rrggbbaa); the chips, swatches
 *               and previews show it over a checkerboard.
 *
 *   colour bar  right-click: Spectrum, or RGB / HSL / CMYK sliders (each track shows the colour as
 *               its channel runs; A is the alpha); Full Color Bar, Single Row, or In the Tool Box
 *               (Photoshop's chips at the foot of the tool box); kept in the registry
 *               (ColorBarMode, ColorBarLayout)
 *
 *   paintColor.mount(w)   paintColor.refresh(w)   paintColor.picker(w, 'fg' | 'bg')   paintColor.menu(w)   paintColor.action(w, a)
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

    /** #rrggbb, or #rrggbbaa when the colour is not opaque. */
    function hex(r, g, b, a = 255) {
        const h = [r, g, b].map((v) => clamp(Math.round(v), 0, 255).toString(16).padStart(2, '0')).join('');
        const A = clamp(Math.round(a), 0, 255);
        return `#${h}${A < 255 ? A.toString(16).padStart(2, '0') : ''}`;
    }

    function rgbOf(css) {
        return C().parseColor(css);
    }

    function alphaOf(css) {
        return rgbOf(css)[3];
    }

    /** A CSS background showing a colour over the transparency checkerboard. */
    function swatchBg(c) {
        return `linear-gradient(${c}, ${c}), repeating-conic-gradient(#fff 0 25%, #c8c8c8 0 50%) 0 0 / 8px 8px`;
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
            if (Array.isArray(list)) return list.filter((c) => /^#[0-9a-f]{6}([0-9a-f]{2})?$/i.test(c));
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

    // ---- the colour bar: Spectrum, or RGB / HSL / CMYK sliders; full, one row, or in the tool box ----

    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const MODES = [['spectrum', 'Spectrum'], ['rgb', 'RGB Sliders'], ['hsl', 'HSL Sliders'], ['cmyk', 'CMYK Sliders']];
    const LAYOUTS = [['full', 'Full Color Bar'], ['row', 'Single Row'], ['toolbox', 'In the Tool Box']];

    function toCmyk(r, g, b) {
        const k = 1 - Math.max(r, g, b) / 255;
        if (k >= 1) return [0, 0, 0, 100];
        return [(1 - r / 255 - k) / (1 - k), (1 - g / 255 - k) / (1 - k), (1 - b / 255 - k) / (1 - k), k].map((v) => v * 100);
    }

    function fromCmyk(c, m, y, k) {
        const K = 1 - k / 100;
        return [255 * (1 - c / 100) * K, 255 * (1 - m / 100) * K, 255 * (1 - y / 100) * K];
    }

    /** A mode's channels: [name, max, value of rgba, rgba with the channel at v]. */
    function channels(mode) {
        const hsl = (rgba) => C().rgbToHsl(rgba[0], rgba[1], rgba[2]);
        const fromHsl = (h, s, l, a) => [...C().hslToRgb(h, s, l), a];
        const A = ['A', 100, (c) => (c[3] / 255) * 100, (c, v) => [c[0], c[1], c[2], (v / 100) * 255]];
        if (mode === 'hsl') {
            return [
                ['H', 360, (c) => hsl(c)[0] * 360, (c, v) => { const q = hsl(c); return fromHsl(v / 360, q[1], q[2], c[3]); }],
                ['S', 100, (c) => hsl(c)[1] * 100, (c, v) => { const q = hsl(c); return fromHsl(q[0], v / 100, q[2], c[3]); }],
                ['L', 100, (c) => hsl(c)[2] * 100, (c, v) => { const q = hsl(c); return fromHsl(q[0], q[1], v / 100, c[3]); }],
                A
            ];
        }
        if (mode === 'cmyk') {
            return ['C', 'M', 'Y', 'K'].map((n, i) => [n, 100, (c) => toCmyk(c[0], c[1], c[2])[i], (c, v) => {
                const q = toCmyk(c[0], c[1], c[2]);
                q[i] = v;
                return [...fromCmyk(...q), c[3]];
            }]).concat([A]);
        }
        return ['R', 'G', 'B'].map((n, i) => [n, 255, (c) => c[i], (c, v) => { const q = c.slice(); q[i] = v; return q; }]).concat([A]);
    }

    /** The colour the sliders change: the drawing colour, or the background one when its chip was picked. */
    function target(w) { return w.colorTarget === 'bg' ? 'bg' : 'fg'; }

    function drawSliders(w) {
        const host = w.modal.querySelector('.mp-cbar-sliders');
        if (!host) return;
        const rgba = rgbOf(w[target(w)]);
        host.querySelectorAll('.mp-sl').forEach((row) => {
            const ch = channels(w.colorMode)[Number(row.dataset.c)];
            const cv = row.querySelector('canvas');
            const x = cv.getContext('2d');
            const W = cv.width;
            const H = cv.height;
            x.clearRect(0, 0, W, H);
            // the track: the colour as this channel runs from 0 to its top (a preview of each place)
            for (let i = 0; i < W; i += 1) {
                const c = ch[3](rgba, (i / (W - 1)) * ch[1]);
                x.fillStyle = `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${c[3] / 255})`;
                x.fillRect(i, 0, 1, H - 4);
            }
            const v = ch[2](rgba);
            const at = Math.round((v / ch[1]) * (W - 1));
            x.fillStyle = '#000';
            x.beginPath(); x.moveTo(at, H - 5); x.lineTo(at - 3, H); x.lineTo(at + 3, H); x.closePath(); x.fill();
            const inp = row.querySelector('input');
            if (doc.activeElement !== inp) inp.value = String(Math.round(v));
        });
    }

    function renderMain(w) {
        const main = w.modal.querySelector('.mp-cbar-main');
        if (!main) return;
        if (w.colorMode === 'spectrum' || !w.colorMode) {
            main.innerHTML = '<canvas class="mp-ramp" width="180" height="32" title="Click: drawing color. Right-click or Alt+click: background color. Right-click the bar for its modes."></canvas>';
            const ramp = main.querySelector('.mp-ramp');
            drawRamp(ramp);
            const pick = (ev, bg) => {
                const r = ramp.getBoundingClientRect();
                const x = clamp(Math.floor(((ev.clientX - r.left) / r.width) * ramp.width), 0, ramp.width - 1);
                const y = clamp(Math.floor(((ev.clientY - r.top) / r.height) * ramp.height), 0, ramp.height - 1);
                const d = ramp.getContext('2d').getImageData(x, y, 1, 1).data;
                // the ramp picks the hue; the colour keeps its alpha
                if (bg) w.bg = hex(d[0], d[1], d[2], alphaOf(w.bg)); else w.fg = hex(d[0], d[1], d[2], alphaOf(w.fg));
                w.renderColors();
            };
            ramp.addEventListener('pointerdown', (ev) => {
                if (ev.button === 2 && !ev.altKey && ev.ctrlKey) return;
                ev.preventDefault();
                ramp.setPointerCapture(ev.pointerId);
                const bg = ev.button === 2 || ev.altKey;
                pick(ev, bg);
                const move = (mv) => pick(mv, bg);
                const up = () => { ramp.removeEventListener('pointermove', move); ramp.removeEventListener('pointerup', up); };
                ramp.addEventListener('pointermove', move);
                ramp.addEventListener('pointerup', up);
            });
            return;
        }
        const chs = channels(w.colorMode);
        main.innerHTML = `<div class="mp-cbar-sliders" data-n="${chs.length}">${chs.map(([n, max], i) => `<label class="mp-sl" data-c="${i}"><span>${n}</span><canvas width="120" height="12"></canvas><input type="text" inputmode="numeric" class="mp-sl-num" title="0-${max}"></label>`).join('')}</div>`;
        const set = (row, v) => {
            const ch = channels(w.colorMode)[Number(row.dataset.c)];
            const c = ch[3](rgbOf(w[target(w)]), clamp(v, 0, ch[1]));
            w[target(w)] = hex(c[0], c[1], c[2], c[3]);
            w.renderColors();
        };
        main.querySelectorAll('.mp-sl').forEach((row) => {
            const cv = row.querySelector('canvas');
            const ch = () => channels(w.colorMode)[Number(row.dataset.c)];
            const at = (ev) => { const r = cv.getBoundingClientRect(); return ((ev.clientX - r.left) / r.width) * ch()[1]; };
            cv.addEventListener('pointerdown', (ev) => {
                if (ev.button !== 0) return;
                ev.preventDefault();
                cv.setPointerCapture(ev.pointerId);
                set(row, at(ev));
                const move = (e) => set(row, at(e));
                const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
                cv.addEventListener('pointermove', move);
                cv.addEventListener('pointerup', up);
            });
            row.querySelector('input').addEventListener('change', (ev) => set(row, Number(ev.target.value) || 0));
        });
        drawSliders(w);
    }

    function barMenu(w) {
        return [
            ...MODES.map(([v, t]) => ({ text: t, action: `cbar-mode-${v}`, showIndicator: true, checked: (w.colorMode || 'spectrum') === v })),
            { separator: true },
            ...LAYOUTS.map(([v, t]) => ({ text: t, action: `cbar-layout-${v}`, showIndicator: true, checked: (w.colorLayout || 'full') === v })),
            { separator: true },
            { text: 'Foreground Color...', action: 'color-pick-fg' },
            { text: 'Background Color...', action: 'color-pick-bg' }
        ];
    }

    function attachBarMenu(w, el) {
        el.addEventListener('contextmenu', (ev) => ev.preventDefault());
        root.contextMenu.attachToElement(el, {
            onAction: (a) => void w.action(a),
            sections: [{ type: 'list', initfn: (section) => { section.items = barMenu(w); } }]
        });
    }

    const CHIPS = '<span class="mp-bg" title="Set background color"></span><span class="mp-fg" title="Set foreground color"></span><button type="button" class="mp-default-colors" title="Default Colors (D)"></button><button type="button" class="mp-swap-colors" title="Switch Colors (X)"></button>';

    function wireChips(w, holder) {
        // with sliders: a click picks the colour they change; a second click (or Spectrum) opens the picker
        const chip = (which) => () => {
            if ((w.colorMode || 'spectrum') !== 'spectrum' && w.colorTarget !== which) { w.colorTarget = which; w.renderColors(); return; }
            picker(w, which);
        };
        holder.querySelector('.mp-fg').addEventListener('click', chip('fg'));
        holder.querySelector('.mp-bg').addEventListener('click', chip('bg'));
        holder.querySelector('.mp-swap-colors').addEventListener('click', () => void w.action('swap-colors'));
        holder.querySelector('.mp-default-colors').addEventListener('click', () => void w.action('default-colors'));
    }

    function mount(w) {
        w.colorMode = w.colorMode || reg('ColorBarMode', 'spectrum');
        w.colorLayout = w.colorLayout || reg('ColorBarLayout', 'full');
        const box = w.modal.querySelector('.mp-colorbox');
        box.innerHTML = `
            <div class="mp-swatch-box">${CHIPS}</div>
            <div class="mp-cbar-main"></div>
            <div class="mp-swatches" role="listbox" aria-label="Swatches"></div>
            <div class="mp-sw-tools">
                <button type="button" class="mp-sw-add" title="Create new swatch of foreground color"></button>
                <button type="button" class="mp-sw-menu" title="Swatches"></button>
            </div>`;
        renderMain(w);
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
        wireChips(w, box.querySelector('.mp-swatch-box'));
        attachBarMenu(w, box.querySelector('.mp-cbar-main'));
        attachBarMenu(w, box.querySelector('.mp-swatch-box'));
        // Photoshop's chips at the foot of the tool box (the bar's "In the Tool Box")
        let tb = w.modal.querySelector('.mp-tool-colors');
        if (!tb) {
            tb = doc.createElement('div');
            tb.className = 'mp-tool-colors';
            tb.innerHTML = CHIPS;
            w.modal.querySelector('.mp-toolbox').appendChild(tb);
            wireChips(w, tb);
            attachBarMenu(w, tb);
        }
        applyLayout(w);
        renderSwatches(w, swatches());
    }

    function applyLayout(w) {
        const m = w.modal;
        m.classList.toggle('mp-cbar-row', w.colorLayout === 'row');
        m.classList.toggle('mp-cbar-toolbox', w.colorLayout === 'toolbox');
    }

    /** The bar's chips, sliders and the tool box chips after a colour change. */
    function refresh(w) {
        const bg = (c) => swatchBg(c);
        w.modal.querySelectorAll('.mp-fg').forEach((e) => { e.style.background = bg(w.fg); });
        w.modal.querySelectorAll('.mp-bg').forEach((e) => { e.style.background = bg(w.bg); });
        const sliders = (w.colorMode || 'spectrum') !== 'spectrum';
        w.modal.querySelectorAll('.mp-fg').forEach((e) => e.classList.toggle('is-target', sliders && target(w) === 'fg'));
        w.modal.querySelectorAll('.mp-bg').forEach((e) => e.classList.toggle('is-target', sliders && target(w) === 'bg'));
        drawSliders(w);
    }

    function setMode(w, mode) {
        w.colorMode = mode;
        setReg({ ColorBarMode: mode });
        renderMain(w);
        refresh(w);
    }

    function setLayout(w, layout) {
        w.colorLayout = layout;
        setReg({ ColorBarLayout: layout });
        applyLayout(w);
        renderMain(w);
        refresh(w);
    }

    function renderSwatches(w, list) {
        const el = w.modal && w.modal.querySelector('.mp-swatches');
        if (!el) return;
        el.innerHTML = list.map((c) => `<button type="button" class="mp-sw-cell" data-c="${esc(c)}" style="background:${swatchBg(esc(c))}" title="${esc(c.toUpperCase())}" role="option"></button>`).join('');
    }

    // ---- the Color Picker ----------------------------------------------------------------------

    function picker(w, which = 'fg', opts = {}) {
        if (!V()) return;
        const start = opts.color || (which === 'bg' ? w.bg : w.fg);
        const [r0, g0, b0, a0] = rgbOf(start);
        let [h, s, v] = rgbToHsv(r0, g0, b0);
        let alpha = a0;
        const X = 20; // the alpha bar's room
        const tpl = { t: opts.title || `Color Picker (${which === 'bg' ? 'Background' : 'Foreground'} Color)`, w: 330 + X, h: 176, f: ['MS Shell Dlg', 8], c: [
            [110, 'MpPickField', 7, 7, 172, 158, 0x50000000, '', 0],
            [111, 'MpPickHue', 184, 7, 16, 158, 0x50000000, '', 0],
            [-1, 'S', 207 + X, 7, 44, 8, 0x50020001, 'new', 0],
            [113, 'MpPickAlpha', 184 + X, 7, 16, 158, 0x50000000, '', 0],
            [112, 'MpPickPreview', 207 + X, 16, 44, 40, 0x50000000, '', 0],
            [-1, 'S', 207 + X, 58, 44, 8, 0x50020001, 'current', 0],
            [1, 'B', 264 + X, 7, 59, 14, 0x50010001, 'OK', 0],
            [2, 'B', 264 + X, 25, 59, 14, 0x50010000, 'Cancel', 0],
            [130, 'B', 264 + X, 43, 59, 14, 0x50010000, '&Add to Swatches', 0],
            [-1, 'S', 207 + X, 78, 10, 8, 0x50020000, '&H:', 0], [121, 'E', 219 + X, 76, 28, 12, 0x50812080, '', 0], [-1, 'S', 249 + X, 78, 8, 8, 0x50020000, '\u00b0', 0],
            [-1, 'S', 207 + X, 93, 10, 8, 0x50020000, '&S:', 0], [122, 'E', 219 + X, 91, 28, 12, 0x50812080, '', 0], [-1, 'S', 249 + X, 93, 8, 8, 0x50020000, '%', 0],
            [-1, 'S', 207 + X, 108, 10, 8, 0x50020000, '&B:', 0], [123, 'E', 219 + X, 106, 28, 12, 0x50812080, '', 0], [-1, 'S', 249 + X, 108, 8, 8, 0x50020000, '%', 0],
            [-1, 'S', 266 + X, 78, 10, 8, 0x50020000, '&R:', 0], [124, 'E', 278 + X, 76, 28, 12, 0x50812080, '', 0],
            [-1, 'S', 266 + X, 93, 10, 8, 0x50020000, '&G:', 0], [125, 'E', 278 + X, 91, 28, 12, 0x50812080, '', 0],
            [-1, 'S', 266 + X, 108, 10, 8, 0x50020000, 'B:', 0], [126, 'E', 278 + X, 106, 28, 12, 0x50812080, '', 0],
            [-1, 'S', 207 + X, 123, 10, 8, 0x50020000, 'A&:', 0], [128, 'E', 219 + X, 121, 28, 12, 0x50812080, '', 0], [-1, 'S', 249 + X, 123, 8, 8, 0x50020000, '%', 0],
            [-1, 'S', 207 + X, 141, 10, 8, 0x50020000, '#', 0], [127, 'E', 219 + X, 139, 56, 12, 0x50810080, '', 0]
        ] };
        let sync = () => {};
        const current = () => hex(...hsvToRgb(h, s, v), alpha);
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
                prev.innerHTML = `<div class="mp-pk-new"></div><div class="mp-pk-old" style="background:${swatchBg(esc(start))}" title="Click to restore the current color"></div>`;
                const alphaEl = ctx.holder(113);
                alphaEl.innerHTML = '<div class="mp-pk-alpha"><i class="mp-pk-arrows"></i></div>';
                const abar = alphaEl.querySelector('.mp-pk-alpha');
                const aarrows = alphaEl.querySelector('.mp-pk-arrows');
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
                    abar.style.background = `linear-gradient(${hex(r, g, b)}, rgba(0, 0, 0, 0)), repeating-conic-gradient(#fff 0 25%, #c8c8c8 0 50%) 0 0 / 8px 8px`;
                    aarrows.style.top = `${(1 - alpha / 255) * 100}%`;
                    prev.querySelector('.mp-pk-new').style.background = swatchBg(hex(r, g, b, alpha));
                    const set = (id, val) => { if (skip !== id) ctx.set(id, String(val)); };
                    set(121, Math.round(h)); set(122, Math.round(s * 100)); set(123, Math.round(v * 100));
                    set(124, Math.round(r)); set(125, Math.round(g)); set(126, Math.round(b));
                    set(128, Math.round((alpha / 255) * 100));
                    set(127, hex(r, g, b, alpha).slice(1));
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
                drag(abar, (x, y) => { alpha = Math.round((1 - y) * 255); });
                prev.querySelector('.mp-pk-old').addEventListener('click', () => { [h, s, v] = rgbToHsv(r0, g0, b0); alpha = a0; sync(); });
                const num = (id, lo, hi) => clamp(Number(ctx.get(id)) || 0, lo, hi);
                [121, 122, 123].forEach((id) => ctx.on(id, 'input', () => {
                    h = num(121, 0, 359); s = num(122, 0, 100) / 100; v = num(123, 0, 100) / 100;
                    sync(id);
                }));
                [124, 125, 126].forEach((id) => ctx.on(id, 'input', () => {
                    [h, s, v] = rgbToHsv(num(124, 0, 255), num(125, 0, 255), num(126, 0, 255));
                    sync(id);
                }));
                ctx.on(128, 'input', () => { alpha = Math.round((num(128, 0, 100) / 100) * 255); sync(128); });
                ctx.on(127, 'input', () => {
                    const t = String(ctx.get(127)).replace(/[^0-9a-f]/gi, '');
                    if (t.length !== 6 && t.length !== 3 && t.length !== 8) return;
                    const c = rgbOf(`#${t}`);
                    [h, s, v] = rgbToHsv(c[0], c[1], c[2]);
                    if (t.length === 8) alpha = c[3];
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

    function menu(w) {
        return [
            { text: 'Foreground Color...', action: 'color-pick-fg' },
            { text: 'Background Color...', action: 'color-pick-bg' },
            { separator: true },
            { text: 'New Swatch of Foreground Color', action: 'color-swatch-add' },
            { text: 'Reset Swatches', action: 'color-swatch-reset' },
            { text: 'Clear Swatches', action: 'color-swatch-clear' },
            { separator: true },
            ...(w ? [{ text: 'Color Bar', hasSubmenu: true, submenu: barMenu(w) }] : []),
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
            default:
                if (a.startsWith('cbar-mode-')) { setMode(w, a.slice(10)); return true; }
                if (a.startsWith('cbar-layout-')) { setLayout(w, a.slice(12)); return true; }
                return false;
        }
    }

    root.paintColor = { mount, refresh, setMode, setLayout, barMenu, picker, menu, action, swatches, addSwatch, rgbToHsv, hsvToRgb, hex, alphaOf, swatchBg, DEFAULT_SWATCHES };
})(typeof window !== 'undefined' ? window : globalThis);
