/**
 * Paint's dialogs (Yozora #632), Vista's own templates through vistaDialogTemplate.js:
 *   Attributes (mspaint.exe.mui 105), Flip and Rotate (112), Resize and Skew (113),
 *   Grid Settings (4001), Edit Colors (comdlg32 CHOOSECOLOR: Basic colors, Custom colors, and
 *   Define Custom Colors >> with the hue / saturation spectrum, the luminosity bar and the
 *   Hue / Sat / Lum / Red / Green / Blue boxes), Custom Zoom and Rotate / Zoom Layer
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const V = () => root.vistaDialogTemplate;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint';

    function reg(name, def) {
        const r = root.melatonRegistry;
        return r ? r.get(KEY, name, def) : def;
    }

    function setReg(values) {
        const r = root.melatonRegistry;
        if (r) void r.set(KEY, values);
    }

    function num(v, def) {
        const n = Number(String(v).trim());
        return Number.isFinite(n) ? n : def;
    }

    function rotateCanvas(src, deg) {
        const swap = deg === 90 || deg === 270;
        const c = C().makeCanvas(swap ? src.height : src.width, swap ? src.width : src.height);
        const x = c.getContext('2d');
        x.translate(c.width / 2, c.height / 2);
        x.rotate((deg * Math.PI) / 180);
        x.drawImage(src, -src.width / 2, -src.height / 2);
        return c;
    }

    function flipCanvas(src, horizontal) {
        const c = C().makeCanvas(src.width, src.height);
        const x = c.getContext('2d');
        x.translate(horizontal ? c.width : 0, horizontal ? 0 : c.height);
        x.scale(horizontal ? -1 : 1, horizontal ? 1 : -1);
        x.drawImage(src, 0, 0);
        return c;
    }

    /** Flip / rotate the selection (when there is one) or the whole picture, as Vista does. */
    function flipRotate(w) {
        V().openDialog({
            id: 'mpFlipRotate',
            key: 'mspaint:112',
            owner: w.modal,
            init(ctx) {
                ctx.set(1090, true);
                ctx.set(1093, true);
                const sync = () => [1093, 1094, 1095].forEach((id) => ctx.enable(id, ctx.get(1092)));
                ctx.content.addEventListener('change', sync);
                sync();
            },
            ok(ctx) {
                const op = ctx.get(1090) ? 'h' : ctx.get(1091) ? 'v' : (ctx.get(1093) ? 90 : ctx.get(1094) ? 180 : 270);
                const fn = (src) => (op === 'h' ? flipCanvas(src, true) : op === 'v' ? flipCanvas(src, false) : rotateCanvas(src, op));
                if (w.floating || w.doc.selection) {
                    if (!w.floating) w.liftSelection(false);
                    const f = w.floating;
                    f.canvas = fn(f.canvas);
                    f.w = f.canvas.width;
                    f.h = f.canvas.height;
                    w.drawFloating();
                    return;
                }
                w.doc.transformAll(fn, typeof op === 'number' ? `Rotate ${op}°` : op === 'h' ? 'Flip Horizontal' : 'Flip Vertical');
            }
        });
    }

    function skewCanvas(src, sx, sy) {
        const tx = Math.tan((sx * Math.PI) / 180);
        const ty = Math.tan((sy * Math.PI) / 180);
        const w = Math.round(src.width + Math.abs(tx) * src.height);
        const h = Math.round(src.height + Math.abs(ty) * src.width);
        const c = C().makeCanvas(w, h);
        const x = c.getContext('2d');
        x.setTransform(1, ty, tx, 1, tx < 0 ? -tx * src.height : 0, ty < 0 ? -ty * src.width : 0);
        x.drawImage(src, 0, 0);
        return c;
    }

    function resizeSkew(w) {
        V().openDialog({
            id: 'mpResizeSkew',
            key: 'mspaint:113',
            owner: w.modal,
            init(ctx) {
                ctx.set(1019, '100'); ctx.set(1020, '100'); ctx.set(1021, '0'); ctx.set(1022, '0');
            },
            async ok(ctx) {
                const ph = num(ctx.get(1019), 100);
                const pv = num(ctx.get(1020), 100);
                const kx = num(ctx.get(1021), 0);
                const ky = num(ctx.get(1022), 0);
                if (ph < 1 || ph > 500 || pv < 1 || pv > 500 || Math.abs(kx) > 89 || Math.abs(ky) > 89) {
                    await w.message('Please enter a number between 1 and 500 for the percentages, and between -89 and 89 for the degrees.');
                    return false;
                }
                const fn = (src) => {
                    let out = src;
                    if (ph !== 100 || pv !== 100) {
                        const c = C().makeCanvas(Math.max(1, Math.round(src.width * ph / 100)), Math.max(1, Math.round(src.height * pv / 100)));
                        const x = c.getContext('2d');
                        x.imageSmoothingQuality = 'high';
                        x.drawImage(src, 0, 0, c.width, c.height);
                        out = c;
                    }
                    if (kx || ky) out = skewCanvas(out, kx, ky);
                    return out;
                };
                if (w.floating || w.doc.selection) {
                    if (!w.floating) w.liftSelection(false);
                    const f = w.floating;
                    f.canvas = fn(f.canvas);
                    f.w = f.canvas.width;
                    f.h = f.canvas.height;
                    w.drawFloating();
                    return true;
                }
                w.doc.transformAll(fn, 'Resize/Skew');
                return true;
            }
        });
    }

    function attributes(w) {
        const units = reg('Units', 'pixels');
        const dpi = 96;
        const toUnit = (px, u) => (u === 'inches' ? (px / dpi).toFixed(2) : u === 'cm' ? ((px / dpi) * 2.54).toFixed(2) : String(px));
        const fromUnit = (v, u) => Math.round(u === 'inches' ? v * dpi : u === 'cm' ? (v / 2.54) * dpi : v);
        V().openDialog({
            id: 'mpAttributes',
            key: 'mspaint:105',
            owner: w.modal,
            // Vista's Attributes stops above the Transparency group (that is the GIF option of old)
            overrides: { 1068: { hidden: true }, 1069: { hidden: true }, 1070: { hidden: true } },
            init(ctx) {
                ctx.content.querySelectorAll('.tbp-group').forEach((g) => { if (/Transparency/.test(g.textContent)) g.hidden = true; });
                ctx.content.style.height = `${Math.round((122 * 13) / 8)}px`;
                ctx.text(1071, w.file ? new Date().toLocaleString('en-US') : 'Not Available');
                ctx.text(1072, w.file ? 'Saved' : 'Not Available');
                ctx.text(1073, `${dpi} x ${dpi} dots per inch`);
                let u = units;
                ctx.set(u === 'inches' ? 1028 : u === 'cm' ? 1029 : 1030, true);
                ctx.set(1080, true);
                const show = () => { ctx.set(264, toUnit(w.doc.width, u)); ctx.set(266, toUnit(w.doc.height, u)); };
                show();
                ctx.content.addEventListener('change', (ev) => {
                    const id = Number((ev.target.closest('[data-vdt-id]') || {}).dataset && ev.target.closest('[data-vdt-id]').dataset.vdtId);
                    if (id === 1028 || id === 1029 || id === 1030) {
                        const pxW = fromUnit(num(ctx.get(264), 0), u);
                        const pxH = fromUnit(num(ctx.get(266), 0), u);
                        u = id === 1028 ? 'inches' : id === 1029 ? 'cm' : 'pixels';
                        ctx.set(264, toUnit(pxW, u));
                        ctx.set(266, toUnit(pxH, u));
                    }
                });
                ctx.store.unit = () => u;
                ctx.on(280, 'click', () => { ctx.set(264, toUnit(800, u)); ctx.set(266, toUnit(600, u)); });
            },
            async ok(ctx) {
                const u = ctx.store.unit();
                const nw = fromUnit(num(ctx.get(264), 0), u);
                const nh = fromUnit(num(ctx.get(266), 0), u);
                if (nw < 1 || nh < 1 || nw > 16384 || nh > 16384) {
                    await w.message('Please enter a size between 1 and 16384 pixels.');
                    return false;
                }
                setReg({ Units: u, LastWidth: nw, LastHeight: nh });
                if (ctx.get(1079)) w.adjust('Black and White', (r, g, b) => { const v = 0.299 * r + 0.587 * g + 0.114 * b >= 128 ? 255 : 0; return [v, v, v]; });
                if (nw !== w.doc.width || nh !== w.doc.height) w.doc.resizeCanvas(nw, nh, { fill: w.bg });
                return true;
            }
        });
    }

    function grid(w) {
        V().openDialog({
            id: 'mpGrid',
            key: 'mspaint:4001',
            owner: w.modal,
            init(ctx) {
                ctx.set(728, w.grid);
                ctx.set(727, false);
                ctx.set(264, '16');
                ctx.set(266, '16');
            },
            ok(ctx) {
                w.grid = !!ctx.get(728);
                w.applyZoom();
            }
        });
    }

    function customZoom(w) {
        const tpl = { t: 'Custom Zoom', w: 190, h: 90, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 8, 60, 8, 0x50020000, 'Current zoom:', 0],
            [100, 'S', 70, 8, 60, 8, 0x50020000, '', 0],
            [-1, 'B', 7, 22, 120, 60, 0x50000007, 'Zoom to', 0],
            [101, 'B', 14, 34, 50, 10, 0x50030009, '&100%', 0],
            [102, 'B', 14, 48, 50, 10, 0x50010009, '&200%', 0],
            [103, 'B', 14, 62, 50, 10, 0x50010009, '&400%', 0],
            [104, 'B', 70, 34, 50, 10, 0x50010009, '6&00%', 0],
            [105, 'B', 70, 48, 50, 10, 0x50010009, '&800%', 0],
            [106, 'B', 70, 62, 50, 10, 0x50010009, '&50%', 0],
            [1, 'B', 134, 7, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 134, 24, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        const levels = { 101: 1, 102: 2, 103: 4, 104: 6, 105: 8, 106: 0.5 };
        V().openDialog({
            id: 'mpCustomZoom',
            tpl,
            owner: w.modal,
            init(ctx) {
                ctx.text(100, `${Math.round(w.zoom * 100)}%`);
                const cur = Object.keys(levels).find((k) => levels[k] === w.zoom) || '101';
                ctx.set(Number(cur), true);
            },
            ok(ctx) {
                const id = Object.keys(levels).find((k) => ctx.get(Number(k)));
                if (id) w.setZoom(levels[id]);
            }
        });
    }

    function rotateLayer(w) {
        if (!w.editable()) return;
        const tpl = { t: 'Rotate / Zoom Layer', w: 210, h: 80, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 10, 40, 8, 0x50020000, '&Angle:', 0],
            [101, 'msctls_trackbar32', 50, 7, 116, 16, 0x50010000, '', 0],
            [102, 'E', 170, 8, 32, 12, 0x50812080, '0', 0],
            [-1, 'S', 7, 32, 40, 8, 0x50020000, '&Zoom:', 0],
            [103, 'msctls_trackbar32', 50, 29, 116, 16, 0x50010000, '', 0],
            [104, 'E', 170, 30, 32, 12, 0x50812080, '100', 0],
            [1, 'B', 99, 60, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 153, 60, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        const l = w.doc.layer;
        const snap = C().makeCanvas(w.doc.width, w.doc.height);
        snap.getContext('2d').drawImage(l.canvas, 0, 0);
        const step = w.doc.beginStep('Rotate / Zoom', l, { x: 0, y: 0, w: w.doc.width, h: w.doc.height });
        let raf = 0;
        const draw = (ang, zoom) => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => {
                l.ctx.save();
                l.ctx.clearRect(0, 0, w.doc.width, w.doc.height);
                l.ctx.translate(w.doc.width / 2, w.doc.height / 2);
                l.ctx.rotate((ang * Math.PI) / 180);
                l.ctx.scale(zoom / 100, zoom / 100);
                l.ctx.drawImage(snap, -w.doc.width / 2, -w.doc.height / 2);
                l.ctx.restore();
                w.doc.markDirty();
            });
        };
        V().openDialog({
            id: 'mpRotateLayer',
            tpl,
            owner: w.modal,
            init(ctx) {
                ctx.range(101, -180, 180, 0, undefined, 0);
                ctx.range(103, 10, 400, 100, undefined, 0);
                const upd = () => { ctx.set(102, String(ctx.get(101))); ctx.set(104, String(ctx.get(103))); draw(Number(ctx.get(101)), Number(ctx.get(103))); };
                ctx.on(101, 'input', upd);
                ctx.on(103, 'input', upd);
                ctx.on(102, 'change', () => { ctx.set(101, num(ctx.get(102), 0)); upd(); });
                ctx.on(104, 'change', () => { ctx.set(103, num(ctx.get(104), 100)); upd(); });
            },
            ok() { cancelAnimationFrame(raf); w.doc.commitStep(step); },
            cancel() {
                cancelAnimationFrame(raf);
                l.ctx.clearRect(0, 0, w.doc.width, w.doc.height);
                l.ctx.drawImage(snap, 0, 0);
                w.doc.markDirty();
            }
        });
    }

    // ---- Edit Colors (CHOOSECOLOR, vistaDialogTemplate.chooseColor) ------------------------------

    async function editColors(w, paletteIndex) {
        const start = paletteIndex !== undefined ? root.melatonPaint.PALETTE[paletteIndex] : w.fg;
        const color = await V().chooseColor({
            id: 'mpEditColors',
            title: 'Edit Colors',
            owner: w.modal,
            color: start,
            custom: reg('CustomColors', Array(16).fill('#ffffff')),
            onCustom: (custom) => setReg({ CustomColors: custom })
        });
        if (!color) return;
        if (paletteIndex !== undefined) {
            root.melatonPaint.PALETTE[paletteIndex] = color;
            const cell = w.modal.querySelector(`.mp-color[data-i="${paletteIndex}"]`);
            if (cell) cell.style.background = color;
        }
        w.fg = color;
        w.renderColors();
    }

    root.paintDialogs = { flipRotate, resizeSkew, attributes, grid, customZoom, rotateLayer, editColors };
})(typeof window !== 'undefined' ? window : globalThis);
