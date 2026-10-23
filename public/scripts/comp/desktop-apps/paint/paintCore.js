/**
 * Paint's document engine (Yozora #632): layers, compositing, history, selections and the pixel
 * operations the tools and menus use. No DOM besides canvases; paintApp.js is the window.
 *
 * Optimised for big pictures:
 *   - every layer is its own canvas; the view is recomposited only inside the dirty rectangle
 *     the last change touched, once per animation frame
 *   - history keeps the pixels a step changed (the bounding box of the change, before and after),
 *     not copies of the whole picture; whole-document steps (resize, layer order) keep a snapshot
 *     and the history is bounded by its total byte size
 *   - flood fill and the magic wand are scanline fills over one Uint32Array
 *
 *   const doc = new PaintCore.Document(width, height)
 *   doc.layers [{ id, name, canvas, ctx, visible, opacity (0-1), blend, locked }], doc.active
 *   doc.addLayer(name) / removeLayer(i) / moveLayer(i, dir) / duplicateLayer(i) / mergeDown(i) / flatten()
 *   doc.beginStep(label, layer, rect?) -> step; step.grow(rect); doc.commitStep(step)
 *   doc.snapshotStep(label, fn)   a whole-document step (fn changes the document)
 *   doc.undo() / doc.redo() / doc.history / doc.historyIndex
 *   doc.composite(ctx, rect)      draw the visible layers into a view context
 *   doc.flattened()               a canvas of the picture as saved
 *   PaintCore.floodFill(imageData, x, y, rgba, tolerance) -> dirty rect
 *   PaintCore.wandMask(imageData, x, y, tolerance) -> { mask: Uint8Array, rect }
 */
(function (root) {
    'use strict';

    const doc0 = typeof document !== 'undefined' ? document : null;
    const HISTORY_BYTES = 256 * 1024 * 1024;
    const HISTORY_STEPS = 100;
    let nextLayerId = 1;

    function makeCanvas(w, h) {
        const c = doc0.createElement('canvas');
        c.width = Math.max(1, w);
        c.height = Math.max(1, h);
        return c;
    }

    function ctxOf(c) {
        return c.getContext('2d', { willReadFrequently: true });
    }

    function clampRect(r, w, h) {
        if (!r) return null;
        const x0 = Math.max(0, Math.floor(r.x));
        const y0 = Math.max(0, Math.floor(r.y));
        const x1 = Math.min(w, Math.ceil(r.x + r.w));
        const y1 = Math.min(h, Math.ceil(r.y + r.h));
        if (x1 <= x0 || y1 <= y0) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    function union(a, b) {
        if (!a) return b ? { ...b } : null;
        if (!b) return { ...a };
        const x0 = Math.min(a.x, b.x);
        const y0 = Math.min(a.y, b.y);
        return { x: x0, y: y0, w: Math.max(a.x + a.w, b.x + b.w) - x0, h: Math.max(a.y + a.h, b.y + b.h) - y0 };
    }

    function rectAround(x, y, r) {
        return { x: x - r - 1, y: y - r - 1, w: 2 * r + 2, h: 2 * r + 2 };
    }

    const BLENDS = {
        normal: 'source-over', multiply: 'multiply', screen: 'screen', overlay: 'overlay', darken: 'darken',
        lighten: 'lighten', 'color-dodge': 'color-dodge', 'color-burn': 'color-burn', 'hard-light': 'hard-light',
        'soft-light': 'soft-light', difference: 'difference', exclusion: 'exclusion', hue: 'hue',
        saturation: 'saturation', color: 'color', luminosity: 'luminosity', additive: 'lighter'
    };

    class Layer {
        constructor(w, h, name) {
            this.id = nextLayerId++;
            this.name = name || `Layer ${this.id}`;
            this.canvas = makeCanvas(w, h);
            this.ctx = ctxOf(this.canvas);
            this.visible = true;
            this.opacity = 1;
            this.blend = 'normal';
            this.locked = false;
        }
    }

    class Document {
        constructor(width, height, opts = {}) {
            this.width = width;
            this.height = height;
            this.layers = [];
            this.active = 0;
            this.history = [];
            this.historyIndex = -1;
            this.historyBytes = 0;
            this.listeners = new Set();
            this.dirty = null;
            this.selection = null; // { rect, mask (Uint8Array w*h of the rect) | null for a plain rectangle }
            const bg = this.addLayer('Background', { silent: true });
            if (opts.transparent !== true) {
                bg.ctx.fillStyle = opts.background || '#ffffff';
                bg.ctx.fillRect(0, 0, width, height);
            }
        }

        on(fn) {
            this.listeners.add(fn);
            return () => this.listeners.delete(fn);
        }

        emit(kind, detail) {
            this.listeners.forEach((fn) => { try { fn(kind, detail); } catch (err) { console.error('paint listener', err); } });
        }

        get layer() {
            return this.layers[this.active];
        }

        markDirty(rect) {
            const r = rect === undefined ? { x: 0, y: 0, w: this.width, h: this.height } : clampRect(rect, this.width, this.height);
            if (!r) return;
            this.dirty = union(this.dirty, r);
            this.emit('dirty', this.dirty);
        }

        takeDirty() {
            const d = this.dirty;
            this.dirty = null;
            return d;
        }

        // ---- layers -----------------------------------------------------------------------

        addLayer(name, opts = {}) {
            const layer = new Layer(this.width, this.height, name);
            const at = opts.at !== undefined ? opts.at : this.active + 1;
            this.layers.splice(Math.min(at, this.layers.length), 0, layer);
            if (!opts.silent) {
                this.active = this.layers.indexOf(layer);
                this.markDirty();
                this.emit('layers');
            }
            return layer;
        }

        removeLayer(i) {
            if (this.layers.length <= 1) return;
            this.layers.splice(i, 1);
            this.active = Math.min(this.active, this.layers.length - 1);
            this.markDirty();
            this.emit('layers');
        }

        moveLayer(i, dir) {
            const j = i + dir;
            if (j < 0 || j >= this.layers.length) return;
            const [l] = this.layers.splice(i, 1);
            this.layers.splice(j, 0, l);
            this.active = j;
            this.markDirty();
            this.emit('layers');
        }

        duplicateLayer(i) {
            const src = this.layers[i];
            const copy = new Layer(this.width, this.height, `${src.name} copy`);
            copy.ctx.drawImage(src.canvas, 0, 0);
            copy.opacity = src.opacity;
            copy.blend = src.blend;
            copy.visible = src.visible;
            this.layers.splice(i + 1, 0, copy);
            this.active = i + 1;
            this.markDirty();
            this.emit('layers');
            return copy;
        }

        mergeDown(i) {
            if (i <= 0) return;
            const top = this.layers[i];
            const below = this.layers[i - 1];
            below.ctx.save();
            below.ctx.globalAlpha = top.opacity;
            below.ctx.globalCompositeOperation = BLENDS[top.blend] || 'source-over';
            if (top.visible) below.ctx.drawImage(top.canvas, 0, 0);
            below.ctx.restore();
            this.layers.splice(i, 1);
            this.active = i - 1;
            this.markDirty();
            this.emit('layers');
        }

        flatten() {
            const flat = this.flattened();
            const layer = new Layer(this.width, this.height, 'Background');
            layer.ctx.drawImage(flat, 0, 0);
            this.layers = [layer];
            this.active = 0;
            this.markDirty();
            this.emit('layers');
        }

        // ---- compositing ------------------------------------------------------------------

        composite(ctx, rect, opts = {}) {
            const r = clampRect(rect || { x: 0, y: 0, w: this.width, h: this.height }, this.width, this.height);
            if (!r) return;
            ctx.save();
            ctx.beginPath();
            ctx.rect(r.x, r.y, r.w, r.h);
            ctx.clip();
            ctx.clearRect(r.x, r.y, r.w, r.h);
            if (opts.checker) {
                ctx.fillStyle = opts.checker;
                ctx.fillRect(r.x, r.y, r.w, r.h);
            }
            this.layers.forEach((l, i) => {
                if (!l.visible || l.opacity <= 0) return;
                ctx.globalAlpha = l.opacity;
                ctx.globalCompositeOperation = BLENDS[l.blend] || 'source-over';
                ctx.drawImage(l.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
                // a stroke in progress (brush opacity) is drawn over its layer before the layers above
                if (opts.overlay && opts.overlay.layerIndex === i) {
                    ctx.globalAlpha = l.opacity * (opts.overlay.alpha === undefined ? 1 : opts.overlay.alpha);
                    ctx.globalCompositeOperation = opts.overlay.erase ? 'destination-out' : 'source-over';
                    ctx.drawImage(opts.overlay.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
                }
            });
            ctx.restore();
        }

        flattened(opts = {}) {
            const c = makeCanvas(this.width, this.height);
            const cx = ctxOf(c);
            if (opts.background) {
                cx.fillStyle = opts.background;
                cx.fillRect(0, 0, this.width, this.height);
            }
            this.composite(cx, null);
            return c;
        }

        // ---- history ----------------------------------------------------------------------

        beginStep(label, layer, rect) {
            const l = layer || this.layer;
            const step = { label, kind: 'pixels', layerId: l.id, rect: null, before: null, after: null };
            // the "before" pixels are copied lazily from a full backup of the layer, so a stroke
            // that grows its rect keeps the original pixels under the whole final box
            step.backup = makeCanvas(this.width, this.height);
            ctxOf(step.backup).drawImage(l.canvas, 0, 0);
            if (rect) step.rect = clampRect(rect, this.width, this.height);
            step.grow = (r) => { step.rect = union(step.rect, clampRect(r, this.width, this.height)); };
            return step;
        }

        commitStep(step) {
            if (!step || !step.rect) {
                if (step) step.backup = null;
                return;
            }
            const l = this.layers.find((x) => x.id === step.layerId);
            if (!l) return;
            const r = step.rect;
            step.before = ctxOf(step.backup).getImageData(r.x, r.y, r.w, r.h);
            step.after = l.ctx.getImageData(r.x, r.y, r.w, r.h);
            step.backup = null;
            step.bytes = r.w * r.h * 8;
            this.push(step);
        }

        snapshotStep(label, fn) {
            const before = this.snapshot();
            fn();
            const after = this.snapshot();
            this.push({ label, kind: 'snapshot', before, after, bytes: (before.bytes + after.bytes) });
            this.markDirty();
            this.emit('layers');
        }

        snapshot() {
            let bytes = 0;
            const layers = this.layers.map((l) => {
                const c = makeCanvas(this.width, this.height);
                ctxOf(c).drawImage(l.canvas, 0, 0);
                bytes += this.width * this.height * 4;
                return { id: l.id, name: l.name, canvas: c, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked };
            });
            return { width: this.width, height: this.height, active: this.active, layers, bytes };
        }

        restore(s) {
            this.width = s.width;
            this.height = s.height;
            this.layers = s.layers.map((sl) => {
                const l = new Layer(s.width, s.height, sl.name);
                l.id = sl.id;
                l.ctx.drawImage(sl.canvas, 0, 0);
                l.visible = sl.visible;
                l.opacity = sl.opacity;
                l.blend = sl.blend;
                l.locked = sl.locked;
                return l;
            });
            this.active = Math.min(s.active, this.layers.length - 1);
            this.emit('resize');
            this.markDirty();
            this.emit('layers');
        }

        push(step) {
            this.history.splice(this.historyIndex + 1).forEach((s) => { this.historyBytes -= s.bytes || 0; });
            this.history.push(step);
            this.historyIndex = this.history.length - 1;
            this.historyBytes += step.bytes || 0;
            while ((this.historyBytes > HISTORY_BYTES || this.history.length > HISTORY_STEPS) && this.history.length > 1) {
                const old = this.history.shift();
                this.historyBytes -= old.bytes || 0;
                this.historyIndex -= 1;
            }
            this.emit('history');
            this.emit('changed');
        }

        apply(step, which) {
            if (step.kind === 'snapshot') {
                this.restore(step[which]);
                return;
            }
            const l = this.layers.find((x) => x.id === step.layerId);
            if (!l) return;
            l.ctx.putImageData(step[which], step.rect.x, step.rect.y);
            this.markDirty(step.rect);
        }

        undo() {
            if (this.historyIndex < 0) return false;
            this.apply(this.history[this.historyIndex], 'before');
            this.historyIndex -= 1;
            this.emit('history');
            this.emit('changed');
            return true;
        }

        redo() {
            if (this.historyIndex >= this.history.length - 1) return false;
            this.historyIndex += 1;
            this.apply(this.history[this.historyIndex], 'after');
            this.emit('history');
            this.emit('changed');
            return true;
        }

        goTo(index) {
            while (this.historyIndex > index && this.undo()) { /* step back */ }
            while (this.historyIndex < index && this.redo()) { /* step forward */ }
        }

        // ---- size -------------------------------------------------------------------------

        resizeCanvas(w, h, opts = {}) {
            this.snapshotStep(opts.label || 'Attributes', () => {
                const ax = opts.anchorX || 0;
                const ay = opts.anchorY || 0;
                this.layers.forEach((l, i) => {
                    const c = makeCanvas(w, h);
                    const cx = ctxOf(c);
                    if (i === 0 && opts.fill) {
                        cx.fillStyle = opts.fill;
                        cx.fillRect(0, 0, w, h);
                    }
                    if (opts.scale) {
                        cx.imageSmoothingQuality = 'high';
                        cx.drawImage(l.canvas, 0, 0, w, h);
                    } else {
                        cx.drawImage(l.canvas, Math.round((w - this.width) * ax), Math.round((h - this.height) * ay));
                    }
                    l.canvas = c;
                    l.ctx = cx;
                });
                this.width = w;
                this.height = h;
                this.selection = null;
                this.emit('resize');
            });
        }

        transformAll(fn, label) {
            this.snapshotStep(label, () => {
                let size = null;
                this.layers.forEach((l) => {
                    const out = fn(l.canvas);
                    l.canvas = out;
                    l.ctx = ctxOf(out);
                    size = [out.width, out.height];
                });
                if (size) { this.width = size[0]; this.height = size[1]; }
                this.selection = null;
                this.emit('resize');
            });
        }
    }

    // ---- pixel helpers ------------------------------------------------------------------

    function parseColor(css) {
        const c = makeCanvas(1, 1);
        const cx = ctxOf(c);
        cx.fillStyle = css;
        cx.fillRect(0, 0, 1, 1);
        const d = cx.getImageData(0, 0, 1, 1).data;
        return [d[0], d[1], d[2], d[3]];
    }

    function close(a, b, tol) {
        return Math.abs((a & 255) - (b & 255)) <= tol
            && Math.abs(((a >>> 8) & 255) - ((b >>> 8) & 255)) <= tol
            && Math.abs(((a >>> 16) & 255) - ((b >>> 16) & 255)) <= tol
            && Math.abs(((a >>> 24) & 255) - ((b >>> 24) & 255)) <= tol;
    }

    /** Scanline flood fill in place; returns the bounding box it changed, or null. */
    function floodFill(img, sx, sy, rgba, tolerance = 0, mask) {
        const w = img.width;
        const h = img.height;
        if (sx < 0 || sy < 0 || sx >= w || sy >= h) return null;
        const px = new Uint32Array(img.data.buffer);
        const target = px[sy * w + sx];
        const fill = (rgba[3] << 24 | rgba[2] << 16 | rgba[1] << 8 | rgba[0]) >>> 0;
        if (target === fill && tolerance === 0) return null;
        const tol = Math.round(tolerance * 2.55);
        const seen = new Uint8Array(w * h);
        const stack = [sx, sy];
        let minX = sx; let maxX = sx; let minY = sy; let maxY = sy;
        const ok = (i) => !seen[i] && (!mask || mask[i]) && close(px[i], target, tol);
        while (stack.length) {
            const y = stack.pop();
            let x = stack.pop();
            let i = y * w + x;
            while (x >= 0 && ok(i)) { x -= 1; i -= 1; }
            x += 1; i += 1;
            let up = false;
            let down = false;
            while (x < w && ok(i)) {
                px[i] = fill;
                seen[i] = 1;
                if (x < minX) minX = x;
                if (x > maxX) maxX = x;
                if (y < minY) minY = y;
                if (y > maxY) maxY = y;
                if (y > 0) {
                    const u = ok(i - w);
                    if (u && !up) { stack.push(x, y - 1); up = true; } else if (!u) up = false;
                }
                if (y < h - 1) {
                    const d = ok(i + w);
                    if (d && !down) { stack.push(x, y + 1); down = true; } else if (!d) down = false;
                }
                x += 1; i += 1;
            }
        }
        return { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }

    /** Magic wand: the connected pixels near the clicked one, as a mask over the whole picture. */
    function wandMask(img, sx, sy, tolerance = 32) {
        const copy = new ImageData(new Uint8ClampedArray(img.data), img.width, img.height);
        const marker = [255, 0, 254, 253];
        const rect = floodFill(copy, sx, sy, marker, tolerance);
        if (!rect) return null;
        const w = img.width;
        const px = new Uint32Array(copy.data.buffer);
        const src = new Uint32Array(img.data.buffer);
        const m = (marker[3] << 24 | marker[2] << 16 | marker[1] << 8 | marker[0]) >>> 0;
        const mask = new Uint8Array(w * img.height);
        for (let y = rect.y; y < rect.y + rect.h; y += 1) {
            for (let x = rect.x; x < rect.x + rect.w; x += 1) {
                const i = y * w + x;
                if (px[i] === m && src[i] !== m) mask[i] = 1;
            }
        }
        return { mask, rect };
    }

    /** A 3x3 kernel over a canvas region (blur, sharpen), written back in place. */
    function convolve(ctx, rect, kernel, divisor = 1) {
        const img = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        const w = rect.w;
        const h = rect.h;
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                for (let c = 0; c < 3; c += 1) {
                    let acc = 0;
                    let k = 0;
                    for (let dy = -1; dy <= 1; dy += 1) {
                        const yy = Math.min(h - 1, Math.max(0, y + dy));
                        for (let dx = -1; dx <= 1; dx += 1) {
                            const xx = Math.min(w - 1, Math.max(0, x + dx));
                            acc += src[(yy * w + xx) * 4 + c] * kernel[k];
                            k += 1;
                        }
                    }
                    d[(y * w + x) * 4 + c] = acc / divisor;
                }
            }
        }
        ctx.putImageData(img, rect.x, rect.y);
    }

    /** Per-pixel colour adjustments over a region: fn(r, g, b) -> [r, g, b]. */
    function mapPixels(ctx, rect, fn, mask, maskW) {
        const img = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            if (mask) {
                const p = i >> 2;
                const mx = rect.x + (p % rect.w);
                const my = rect.y + Math.floor(p / rect.w);
                if (!mask[my * maskW + mx]) continue;
            }
            const o = fn(d[i], d[i + 1], d[i + 2]);
            d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
        }
        ctx.putImageData(img, rect.x, rect.y);
    }

    function rgbToHsl(r, g, b) {
        r /= 255; g /= 255; b /= 255;
        const max = Math.max(r, g, b);
        const min = Math.min(r, g, b);
        let h = 0;
        let s = 0;
        const l = (max + min) / 2;
        if (max !== min) {
            const d = max - min;
            s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
            h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4;
            h /= 6;
        }
        return [h, s, l];
    }

    function hslToRgb(h, s, l) {
        if (s === 0) return [l * 255, l * 255, l * 255];
        const hue = (p, q, t) => {
            if (t < 0) t += 1;
            if (t > 1) t -= 1;
            if (t < 1 / 6) return p + (q - p) * 6 * t;
            if (t < 1 / 2) return q;
            if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6;
            return p;
        };
        const q = l < 0.5 ? l * (1 + s) : l + s - l * s;
        const p = 2 * l - q;
        return [hue(p, q, h + 1 / 3) * 255, hue(p, q, h) * 255, hue(p, q, h - 1 / 3) * 255];
    }

    /** A 24-bit BMP of a canvas (File > Save As > 24-bit Bitmap), white under transparent pixels. */
    function encodeBmp(canvas) {
        const w = canvas.width;
        const h = canvas.height;
        const d = ctxOf(canvas).getImageData(0, 0, w, h).data;
        const row = Math.ceil((w * 3) / 4) * 4;
        const size = 54 + row * h;
        const buf = new ArrayBuffer(size);
        const v = new DataView(buf);
        v.setUint8(0, 0x42); v.setUint8(1, 0x4d);
        v.setUint32(2, size, true); v.setUint32(10, 54, true); v.setUint32(14, 40, true);
        v.setInt32(18, w, true); v.setInt32(22, h, true); v.setUint16(26, 1, true); v.setUint16(28, 24, true);
        v.setUint32(34, row * h, true); v.setInt32(38, 3780, true); v.setInt32(42, 3780, true);
        for (let y = 0; y < h; y += 1) {
            const o = 54 + (h - 1 - y) * row;
            for (let x = 0; x < w; x += 1) {
                const i = (y * w + x) * 4;
                const a = d[i + 3] / 255;
                v.setUint8(o + x * 3, Math.round(d[i + 2] * a + 255 * (1 - a)));
                v.setUint8(o + x * 3 + 1, Math.round(d[i + 1] * a + 255 * (1 - a)));
                v.setUint8(o + x * 3 + 2, Math.round(d[i] * a + 255 * (1 - a)));
            }
        }
        return new Blob([buf], { type: 'image/bmp' });
    }

    root.PaintCore = {
        Document, Layer, BLENDS, makeCanvas, ctxOf, clampRect, union, rectAround,
        parseColor, floodFill, wandMask, convolve, mapPixels, rgbToHsl, hslToRgb, encodeBmp
    };
})(typeof window !== 'undefined' ? window : globalThis);
