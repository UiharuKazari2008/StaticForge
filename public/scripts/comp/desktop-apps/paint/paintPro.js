/**
 * Paint's Photoshop side (Yozora #632): the parts of a photo editor Vista's mspaint.exe never had.
 *
 *   selections  every selection can become a mask over the whole picture (0-255, so feathered):
 *               Shift adds, Alt subtracts, Shift+Alt intersects; Select > All, Deselect, Reselect,
 *               Inverse, Color Range, Modify (Border, Smooth, Expand, Contract, Feather); the mask's
 *               outline is traced for the marching ants
 *   Edit        Fill (with Content-Aware), Stroke
 *   Adjustments Levels, Curves, Exposure, Vibrance, Color Balance, Photo Filter, Gradient Map,
 *               Threshold, Equalize, Auto Tone / Contrast / Color, and the ones paintLayers.js had
 *   Filter      Blur (Gaussian, Motion, Box), Sharpen (Unsharp Mask, Sharpen, Sharpen More), Noise
 *               (Add Noise, Median, Despeckle), Pixelate (Mosaic), Stylize (Emboss, Find Edges,
 *               Solarize), Distort (Twirl, Pinch), Render (Clouds), Other (High Pass); Last Filter
 *   panels      Navigator and Info, docked with Layers and History
 *   healing     the Spot Healing Brush and Content-Aware Fill: the best matching patch around the
 *               hole, its colours corrected to the hole's edge (Shepard interpolation of the edge
 *               differences)
 *
 * A filter or an adjustment reads the area under the selection (padded, so a blur has real
 * neighbours), works on a copy and writes back through the selection's mask, with a live preview
 * in its dialog. paintApp.js calls root.paintPro; nothing here touches the DOM outside its dialogs
 * and panels.
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const V = () => root.vistaDialogTemplate;
    const BLEND_FILL = [
        ['normal', 'Normal'], ['multiply', 'Multiply'], ['screen', 'Screen'], ['overlay', 'Overlay'], ['darken', 'Darken'],
        ['lighten', 'Lighten'], ['color-dodge', 'Color Dodge'], ['color-burn', 'Color Burn'], ['soft-light', 'Soft Light'],
        ['hard-light', 'Hard Light'], ['difference', 'Difference'], ['hue', 'Hue'], ['saturation', 'Saturation'], ['color', 'Color'], ['luminosity', 'Luminosity']
    ];

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
    const lum = (r, g, b) => 0.299 * r + 0.587 * g + 0.114 * b;

    // ---- selections as masks -------------------------------------------------------------------

    /** The selection as a mask over the whole picture (0-255). */
    function maskOf(d, s) {
        if (!s) return null;
        if (s.mask) return s.mask;
        const W = d.width;
        const H = d.height;
        const m = new Uint8Array(W * H);
        const r = C().clampRect(s, W, H);
        if (!r) return m;
        if (!s.path) {
            for (let y = r.y; y < r.y + r.h; y += 1) m.fill(255, y * W + r.x, y * W + r.x + r.w);
            return m;
        }
        const c = C().makeCanvas(r.w, r.h);
        const x = c.getContext('2d', { willReadFrequently: true });
        x.fillStyle = '#fff';
        x.beginPath();
        s.path.forEach((p, i) => (i ? x.lineTo(p.x - r.x, p.y - r.y) : x.moveTo(p.x - r.x, p.y - r.y)));
        x.closePath();
        x.fill();
        const a = x.getImageData(0, 0, r.w, r.h).data;
        for (let yy = 0; yy < r.h; yy += 1) {
            for (let xx = 0; xx < r.w; xx += 1) m[(r.y + yy) * W + r.x + xx] = a[(yy * r.w + xx) * 4 + 3];
        }
        return m;
    }

    /** A mask back to a selection: its bounding box and the mask; null when it is empty. */
    function fromMask(m, W, H) {
        let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
        for (let y = 0; y < H; y += 1) {
            const row = y * W;
            let first = -1;
            let last = -1;
            for (let x = 0; x < W; x += 1) {
                if (m[row + x]) { if (first < 0) first = x; last = x; }
            }
            if (first < 0) continue;
            if (first < x0) x0 = first;
            if (last > x1) x1 = last;
            if (y < y0) y0 = y;
            y1 = y;
        }
        if (x1 < 0) return null;
        return { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1, mask: m };
    }

    /** New, Add (Shift), Subtract (Alt), Intersect (Shift+Alt). */
    function combine(d, base, next, mode) {
        if (!base || mode === 'new' || !mode) return next;
        const a = maskOf(d, base);
        const b = next ? maskOf(d, next) : new Uint8Array(d.width * d.height);
        const out = new Uint8Array(a.length);
        for (let i = 0; i < a.length; i += 1) {
            if (mode === 'add') out[i] = a[i] > b[i] ? a[i] : b[i];
            else if (mode === 'subtract') out[i] = (a[i] * (255 - b[i])) / 255;
            else out[i] = a[i] < b[i] ? a[i] : b[i];
        }
        return fromMask(out, d.width, d.height);
    }

    /** A canvas whose alpha is the mask over a rectangle (for destination-in). */
    function maskCanvas(d, s, rect) {
        const r = rect || { x: 0, y: 0, w: d.width, h: d.height };
        const m = maskOf(d, s);
        const c = C().makeCanvas(r.w, r.h);
        const x = c.getContext('2d');
        const img = x.createImageData(r.w, r.h);
        for (let yy = 0; yy < r.h; yy += 1) {
            for (let xx = 0; xx < r.w; xx += 1) img.data[(yy * r.w + xx) * 4 + 3] = m[(r.y + yy) * d.width + r.x + xx];
        }
        x.putImageData(img, 0, 0);
        return c;
    }

    /** The outline of a mask (half on), as SVG path data at zoom z; cached on the selection. */
    function outline(s, W, H, z) {
        s.outlines = s.outlines || {};
        if (s.outlines[z]) return s.outlines[z];
        const m = s.mask;
        const x0 = s.x; const y0 = s.y; const x1 = s.x + s.w; const y1 = s.y + s.h;
        const on = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] >= 128;
        const P = (v) => Math.round(v * z) + 0.5;
        const parts = [];
        for (let y = y0; y <= y1 && parts.length < 60000; y += 1) {
            let run = -1;
            for (let x = x0; x <= x1; x += 1) {
                const e = x < x1 && on(x, y) !== on(x, y - 1);
                if (e && run < 0) run = x;
                else if (!e && run >= 0) { parts.push(`M${P(run)},${P(y)}H${P(x)}`); run = -1; }
            }
        }
        for (let x = x0; x <= x1 && parts.length < 60000; x += 1) {
            let run = -1;
            for (let y = y0; y <= y1; y += 1) {
                const e = y < y1 && on(x, y) !== on(x - 1, y);
                if (e && run < 0) run = y;
                else if (!e && run >= 0) { parts.push(`M${P(x)},${P(run)}V${P(y)}`); run = -1; }
            }
        }
        const d = parts.length >= 60000
            ? `M${P(x0)},${P(y0)}H${P(x1)}V${P(y1)}H${P(x0)}Z`
            : parts.join('');
        s.outlines[z] = d;
        return d;
    }

    // exact Euclidean distance transform (Felzenszwalb), squared distances to the nearest "on" pixel
    function edt1d(f, n, out, v, z) {
        let k = 0;
        v[0] = 0;
        z[0] = -Infinity;
        z[1] = Infinity;
        for (let q = 1; q < n; q += 1) {
            let s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            while (s <= z[k]) {
                k -= 1;
                s = ((f[q] + q * q) - (f[v[k]] + v[k] * v[k])) / (2 * q - 2 * v[k]);
            }
            k += 1;
            v[k] = q;
            z[k] = s;
            z[k + 1] = Infinity;
        }
        k = 0;
        for (let q = 0; q < n; q += 1) {
            while (z[k + 1] < q) k += 1;
            out[q] = (q - v[k]) * (q - v[k]) + f[v[k]];
        }
    }

    function edt(on, w, h) {
        const INF = 1e20;
        const g = new Float64Array(w * h);
        for (let i = 0; i < g.length; i += 1) g[i] = on[i] ? 0 : INF;
        const n = Math.max(w, h);
        const f = new Float64Array(n);
        const o = new Float64Array(n);
        const v = new Int32Array(n);
        const z = new Float64Array(n + 1);
        for (let x = 0; x < w; x += 1) {
            for (let y = 0; y < h; y += 1) f[y] = g[y * w + x];
            edt1d(f, h, o, v, z);
            for (let y = 0; y < h; y += 1) g[y * w + x] = o[y];
        }
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) f[x] = g[y * w + x];
            edt1d(f, w, o, v, z);
            for (let x = 0; x < w; x += 1) g[y * w + x] = o[x];
        }
        return g;
    }

    /** Grow (r > 0) or shrink (r < 0) a selection by r pixels, round like Photoshop's. */
    function morph(d, s, r) {
        const W = d.width;
        const H = d.height;
        const m = maskOf(d, s);
        const pad = Math.max(0, Math.ceil(r)) + 1;
        const box = C().clampRect({ x: s.x - pad, y: s.y - pad, w: s.w + 2 * pad, h: s.h + 2 * pad }, W, H);
        const bw = box.w;
        const bh = box.h;
        const on = new Uint8Array(bw * bh);
        for (let y = 0; y < bh; y += 1) {
            for (let x = 0; x < bw; x += 1) {
                const v = m[(box.y + y) * W + box.x + x] >= 128;
                on[y * bw + x] = r >= 0 ? (v ? 1 : 0) : (v ? 0 : 1);
            }
        }
        // shrinking: the picture's edge counts as outside only inside the box
        const dist = edt(on, bw, bh);
        const out = new Uint8Array(W * H);
        const rr = r * r;
        for (let y = 0; y < bh; y += 1) {
            for (let x = 0; x < bw; x += 1) {
                const i = y * bw + x;
                const keep = r >= 0 ? dist[i] <= rr : dist[i] > rr;
                if (keep) out[(box.y + y) * W + box.x + x] = 255;
            }
        }
        return fromMask(out, W, H);
    }

    // a box blur, three passes ~ a Gaussian; over Float32 planes
    function boxSizes(sigma, n = 3) {
        const wIdeal = Math.sqrt((12 * sigma * sigma / n) + 1);
        let wl = Math.floor(wIdeal);
        if (wl % 2 === 0) wl -= 1;
        const wu = wl + 2;
        const mIdeal = (12 * sigma * sigma - n * wl * wl - 4 * n * wl - 3 * n) / (-4 * wl - 4);
        const m = Math.round(mIdeal);
        const out = [];
        for (let i = 0; i < n; i += 1) out.push(((i < m ? wl : wu) - 1) / 2);
        return out;
    }

    function blurPlane(src, tmp, w, h, r) {
        if (r < 1) return;
        const iarr = 1 / (r + r + 1);
        for (let y = 0; y < h; y += 1) {
            const row = y * w;
            const first = src[row];
            const last = src[row + w - 1];
            let acc = (r + 1) * first;
            for (let j = 0; j < r; j += 1) acc += src[row + Math.min(j, w - 1)];
            for (let x = 0; x < w; x += 1) {
                acc += (x + r < w ? src[row + x + r] : last) - (x - r - 1 >= 0 ? src[row + x - r - 1] : first);
                tmp[row + x] = acc * iarr;
            }
        }
        for (let x = 0; x < w; x += 1) {
            const first = tmp[x];
            const last = tmp[(h - 1) * w + x];
            let acc = (r + 1) * first;
            for (let j = 0; j < r; j += 1) acc += tmp[Math.min(j, h - 1) * w + x];
            for (let y = 0; y < h; y += 1) {
                acc += (y + r < h ? tmp[(y + r) * w + x] : last) - (y - r - 1 >= 0 ? tmp[(y - r - 1) * w + x] : first);
                src[y * w + x] = acc * iarr;
            }
        }
    }

    function gaussPlane(p, w, h, sigma) {
        if (sigma <= 0) return;
        const tmp = new Float32Array(p.length);
        boxSizes(sigma).forEach((r) => blurPlane(p, tmp, w, h, Math.round(r)));
    }

    function feather(d, s, radius) {
        const W = d.width;
        const H = d.height;
        const m = maskOf(d, s);
        const pad = Math.ceil(radius * 3) + 1;
        const box = C().clampRect({ x: s.x - pad, y: s.y - pad, w: s.w + 2 * pad, h: s.h + 2 * pad }, W, H);
        const p = new Float32Array(box.w * box.h);
        for (let y = 0; y < box.h; y += 1) {
            for (let x = 0; x < box.w; x += 1) p[y * box.w + x] = m[(box.y + y) * W + box.x + x];
        }
        gaussPlane(p, box.w, box.h, radius / 2);
        const out = new Uint8Array(W * H);
        for (let y = 0; y < box.h; y += 1) {
            for (let x = 0; x < box.w; x += 1) out[(box.y + y) * W + box.x + x] = clamp(Math.round(p[y * box.w + x]), 0, 255);
        }
        return fromMask(out, W, H);
    }

    function invert(d, s) {
        const m = s ? maskOf(d, s) : new Uint8Array(d.width * d.height);
        const out = new Uint8Array(m.length);
        for (let i = 0; i < m.length; i += 1) out[i] = 255 - m[i];
        return fromMask(out, d.width, d.height);
    }

    function border(d, s, r) {
        const outer = morph(d, s, Math.ceil(r / 2));
        const inner = morph(d, s, -Math.floor(r / 2));
        return outer ? combine(d, outer, inner, 'subtract') : null;
    }

    function smooth(d, s, r) {
        const f = feather(d, s, r * 2);
        if (!f) return null;
        for (let i = 0; i < f.mask.length; i += 1) f.mask[i] = f.mask[i] >= 128 ? 255 : 0;
        return fromMask(f.mask, d.width, d.height);
    }

    /** Select > Color Range: the pixels near a colour, softly, over the whole picture. */
    function colorRange(w, rgb, fuzz) {
        const d = w.doc;
        const data = d.flattened().getContext('2d').getImageData(0, 0, d.width, d.height).data;
        const out = new Uint8Array(d.width * d.height);
        const f = Math.max(1, fuzz);
        for (let i = 0; i < out.length; i += 1) {
            const o = i * 4;
            const dist = Math.max(Math.abs(data[o] - rgb[0]), Math.abs(data[o + 1] - rgb[1]), Math.abs(data[o + 2] - rgb[2]));
            out[i] = dist <= f ? Math.round(255 * (1 - (dist / f) ** 2)) : 0;
        }
        return fromMask(out, d.width, d.height);
    }

    // ---- reading and writing an area through the selection -----------------------------------

    function areaOf(w) {
        const s = w.doc.selection;
        return C().clampRect(s ? { x: s.x, y: s.y, w: s.w, h: s.h } : { x: 0, y: 0, w: w.doc.width, h: w.doc.height }, w.doc.width, w.doc.height);
    }

    /**
     * A session over the selected area of the active layer: base (the padded original pixels),
     * write(out) to put a result back through the selection's mask, restore(), commit().
     */
    function session(w, label, pad = 0, opts = {}) {
        // one dialog at a time, like Photoshop's modal ones
        if (w.proSession) { w.status('Finish the open dialog first.'); return null; }
        w.commitFloating();
        w.finishText();
        // a filter on a whole Smart Object becomes a smart filter; anything else rasterizes it
        if (!w.editable(!!opts.smart && !w.doc.selection)) return null;
        const d = w.doc;
        const r = opts.rect || areaOf(w);
        if (!r) return null;
        const pr = C().clampRect({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, d.width, d.height);
        const l = d.layer;
        const base = l.ctx.getImageData(pr.x, pr.y, pr.w, pr.h);
        const sel = opts.mask !== undefined ? opts.mask : (d.selection ? maskOf(d, d.selection) : null);
        const step = d.beginStep(label, l, r);
        const ox = r.x - pr.x;
        const oy = r.y - pr.y;
        const S = {
            rect: r, pr, base, l, label, mask: sel,
            info: { x0: pr.x, y0: pr.y, rx: r.x, ry: r.y, rw: r.w, rh: r.h, W: d.width, H: d.height },
            copy() { return new ImageData(new Uint8ClampedArray(base.data), base.width, base.height); },
            write(out) {
                const sel = S.mask;
                const img = l.ctx.createImageData(r.w, r.h);
                const o = img.data;
                const b = base.data;
                const s = out.data;
                for (let y = 0; y < r.h; y += 1) {
                    for (let x = 0; x < r.w; x += 1) {
                        const pi = ((y + oy) * pr.w + x + ox) * 4;
                        const di = (y * r.w + x) * 4;
                        const m = sel ? sel[(r.y + y) * d.width + r.x + x] : 255;
                        if (m === 255) {
                            o[di] = s[pi]; o[di + 1] = s[pi + 1]; o[di + 2] = s[pi + 2]; o[di + 3] = s[pi + 3];
                        } else if (m === 0) {
                            o[di] = b[pi]; o[di + 1] = b[pi + 1]; o[di + 2] = b[pi + 2]; o[di + 3] = b[pi + 3];
                        } else {
                            const k = m / 255;
                            for (let c = 0; c < 4; c += 1) o[di + c] = b[pi + c] + (s[pi + c] - b[pi + c]) * k;
                        }
                    }
                }
                l.ctx.putImageData(img, r.x, r.y);
                d.markDirty(r);
            },
            restore() {
                l.ctx.putImageData(base, pr.x, pr.y);
                d.markDirty(pr);
            },
            step,
            commit() { d.commitStep(step); w.proSession = null; },
            cancel() { S.restore(); step.backup = null; w.proSession = null; }
        };
        w.proSession = S;
        return S;
    }

    /** A per-pixel colour function as a filter. */
    function perPixel(fn) {
        return (img) => {
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                if (!d[i + 3]) continue;
                const o = fn(d[i], d[i + 1], d[i + 2]);
                d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2];
            }
            return img;
        };
    }

    function lutFilter(luts) {
        return (img) => {
            const d = img.data;
            for (let i = 0; i < d.length; i += 4) {
                d[i] = luts[0][d[i]]; d[i + 1] = luts[1][d[i + 1]]; d[i + 2] = luts[2][d[i + 2]];
            }
            return img;
        };
    }

    // ---- filters (ImageData in, ImageData out; info has the area's place in the picture) ------

    function planes(img) {
        const n = img.width * img.height;
        const d = img.data;
        const p = [new Float32Array(n), new Float32Array(n), new Float32Array(n), new Float32Array(n)];
        for (let i = 0; i < n; i += 1) {
            const a = d[i * 4 + 3];
            p[3][i] = a;
            // premultiplied, so transparent pixels do not bleed black
            p[0][i] = d[i * 4] * a; p[1][i] = d[i * 4 + 1] * a; p[2][i] = d[i * 4 + 2] * a;
        }
        return p;
    }

    function unplanes(img, p) {
        const d = img.data;
        for (let i = 0; i < p[3].length; i += 1) {
            const a = p[3][i];
            d[i * 4 + 3] = a;
            if (a > 0) {
                d[i * 4] = p[0][i] / a; d[i * 4 + 1] = p[1][i] / a; d[i * 4 + 2] = p[2][i] / a;
            }
        }
        return img;
    }

    function gaussian(img, radius) {
        const p = planes(img);
        p.forEach((pl) => gaussPlane(pl, img.width, img.height, radius));
        return unplanes(img, p);
    }

    function boxBlur(img, radius) {
        const p = planes(img);
        const tmp = new Float32Array(p[0].length);
        p.forEach((pl) => blurPlane(pl, tmp, img.width, img.height, Math.round(radius)));
        return unplanes(img, p);
    }

    function motion(img, angle, dist) {
        const w = img.width;
        const h = img.height;
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        const a = (angle * Math.PI) / 180;
        const dx = Math.cos(a);
        const dy = -Math.sin(a);
        const n = Math.max(1, Math.round(dist));
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                let r = 0; let g = 0; let b = 0; let al = 0;
                for (let k = -n; k <= n; k += 1) {
                    const xx = clamp(Math.round(x + dx * k), 0, w - 1);
                    const yy = clamp(Math.round(y + dy * k), 0, h - 1);
                    const o = (yy * w + xx) * 4;
                    const aa = src[o + 3];
                    r += src[o] * aa; g += src[o + 1] * aa; b += src[o + 2] * aa; al += aa;
                }
                const o = (y * w + x) * 4;
                const cnt = 2 * n + 1;
                d[o + 3] = al / cnt;
                if (al) { d[o] = r / al; d[o + 1] = g / al; d[o + 2] = b / al; }
            }
        }
        return img;
    }

    function unsharp(img, amount, radius, threshold) {
        const orig = new Uint8ClampedArray(img.data);
        const blur = gaussian(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), radius).data;
        const d = img.data;
        const k = amount / 100;
        for (let i = 0; i < d.length; i += 4) {
            for (let c = 0; c < 3; c += 1) {
                const diff = orig[i + c] - blur[i + c];
                if (Math.abs(diff) >= threshold) d[i + c] = orig[i + c] + diff * k;
            }
        }
        return img;
    }

    function highPass(img, radius) {
        const orig = new Uint8ClampedArray(img.data);
        const blur = gaussian(new ImageData(new Uint8ClampedArray(img.data), img.width, img.height), radius).data;
        const d = img.data;
        for (let i = 0; i < d.length; i += 4) {
            for (let c = 0; c < 3; c += 1) d[i + c] = 128 + orig[i + c] - blur[i + c];
        }
        return img;
    }

    function convolve3(img, k, div = 1, bias = 0, grey = false) {
        const w = img.width;
        const h = img.height;
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                let r = 0; let g = 0; let b = 0; let i = 0;
                for (let dy = -1; dy <= 1; dy += 1) {
                    const yy = clamp(y + dy, 0, h - 1);
                    for (let dx = -1; dx <= 1; dx += 1) {
                        const o = (yy * w + clamp(x + dx, 0, w - 1)) * 4;
                        r += src[o] * k[i]; g += src[o + 1] * k[i]; b += src[o + 2] * k[i];
                        i += 1;
                    }
                }
                const o = (y * w + x) * 4;
                if (grey) {
                    const v = lum(r, g, b) / div + bias;
                    d[o] = v; d[o + 1] = v; d[o + 2] = v;
                } else {
                    d[o] = r / div + bias; d[o + 1] = g / div + bias; d[o + 2] = b / div + bias;
                }
            }
        }
        return img;
    }

    function emboss(img, angle, height, amount) {
        const a = (angle * Math.PI) / 180;
        const dx = Math.round(Math.cos(a) * height);
        const dy = Math.round(-Math.sin(a) * height);
        const w = img.width;
        const h = img.height;
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        const k = amount / 100;
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const o1 = (clamp(y - dy, 0, h - 1) * w + clamp(x - dx, 0, w - 1)) * 4;
                const o2 = (clamp(y + dy, 0, h - 1) * w + clamp(x + dx, 0, w - 1)) * 4;
                const v = 128 + (lum(src[o2], src[o2 + 1], src[o2 + 2]) - lum(src[o1], src[o1 + 1], src[o1 + 2])) * k;
                const o = (y * w + x) * 4;
                d[o] = v; d[o + 1] = v; d[o + 2] = v;
            }
        }
        return img;
    }

    function findEdges(img) {
        const w = img.width;
        const h = img.height;
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const at = (xx, yy, c) => src[(clamp(yy, 0, h - 1) * w + clamp(xx, 0, w - 1)) * 4 + c];
                const o = (y * w + x) * 4;
                for (let c = 0; c < 3; c += 1) {
                    const gx = -at(x - 1, y - 1, c) - 2 * at(x - 1, y, c) - at(x - 1, y + 1, c) + at(x + 1, y - 1, c) + 2 * at(x + 1, y, c) + at(x + 1, y + 1, c);
                    const gy = -at(x - 1, y - 1, c) - 2 * at(x, y - 1, c) - at(x + 1, y - 1, c) + at(x - 1, y + 1, c) + 2 * at(x, y + 1, c) + at(x + 1, y + 1, c);
                    d[o + c] = 255 - Math.min(255, Math.hypot(gx, gy) / 2);
                }
            }
        }
        return img;
    }

    function addNoise(img, amount, gaussianDist, mono) {
        const d = img.data;
        const k = amount * 2.55;
        const rnd = gaussianDist
            ? () => { let u = 0; let v = 0; while (!u) u = Math.random(); while (!v) v = Math.random(); return Math.sqrt(-2 * Math.log(u)) * Math.cos(2 * Math.PI * v) * 0.5; }
            : () => Math.random() - 0.5;
        for (let i = 0; i < d.length; i += 4) {
            if (mono) {
                const n = rnd() * k;
                d[i] += n; d[i + 1] += n; d[i + 2] += n;
            } else {
                d[i] += rnd() * k; d[i + 1] += rnd() * k; d[i + 2] += rnd() * k;
            }
        }
        return img;
    }

    /** Median by brightness: each pixel takes the colour of its window's middle-bright pixel. */
    function median(img, radius) {
        const w = img.width;
        const h = img.height;
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        const r = Math.max(1, Math.round(radius));
        const n = (2 * r + 1) * (2 * r + 1);
        const keys = new Float64Array(n);
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                let k = 0;
                for (let dy = -r; dy <= r; dy += 1) {
                    const yy = clamp(y + dy, 0, h - 1);
                    for (let dx = -r; dx <= r; dx += 1) {
                        const o = (yy * w + clamp(x + dx, 0, w - 1)) * 4;
                        // brightness in the high bits, the offset in the low ones
                        keys[k] = Math.round(lum(src[o], src[o + 1], src[o + 2])) * 67108864 + (o >> 2);
                        k += 1;
                    }
                }
                keys.sort();
                const o = (keys[n >> 1] % 67108864) * 4;
                const t = (y * w + x) * 4;
                d[t] = src[o]; d[t + 1] = src[o + 1]; d[t + 2] = src[o + 2]; d[t + 3] = src[o + 3];
            }
        }
        return img;
    }

    function mosaic(img, cell, info) {
        const w = img.width;
        const h = img.height;
        const d = img.data;
        const c = Math.max(2, Math.round(cell));
        // cells line up with the picture's corner, not the selection's
        const sx = -(info.x0 % c);
        const sy = -(info.y0 % c);
        for (let cy = sy; cy < h; cy += c) {
            for (let cx = sx; cx < w; cx += c) {
                let r = 0; let g = 0; let b = 0; let a = 0; let n = 0;
                const y1 = Math.min(h, cy + c);
                const x1 = Math.min(w, cx + c);
                for (let y = Math.max(0, cy); y < y1; y += 1) {
                    for (let x = Math.max(0, cx); x < x1; x += 1) {
                        const o = (y * w + x) * 4;
                        r += d[o]; g += d[o + 1]; b += d[o + 2]; a += d[o + 3]; n += 1;
                    }
                }
                if (!n) continue;
                for (let y = Math.max(0, cy); y < y1; y += 1) {
                    for (let x = Math.max(0, cx); x < x1; x += 1) {
                        const o = (y * w + x) * 4;
                        d[o] = r / n; d[o + 1] = g / n; d[o + 2] = b / n; d[o + 3] = a / n;
                    }
                }
            }
        }
        return img;
    }

    // a value-noise fBm for Render > Clouds, in picture coordinates so it tiles across selections
    function cloudsFilter(img, info, fg, bg, seed) {
        const perm = new Uint8Array(512);
        let s = seed >>> 0 || 1;
        const rand = () => { s = (s * 1664525 + 1013904223) >>> 0; return s / 4294967296; };
        const p = Array.from({ length: 256 }, (_, i) => i);
        for (let i = 255; i > 0; i -= 1) { const j = Math.floor(rand() * (i + 1)); [p[i], p[j]] = [p[j], p[i]]; }
        for (let i = 0; i < 512; i += 1) perm[i] = p[i & 255];
        const vals = Float32Array.from({ length: 256 }, () => rand());
        const fade = (t) => t * t * (3 - 2 * t);
        const noise = (x, y) => {
            const xi = Math.floor(x); const yi = Math.floor(y);
            const xf = x - xi; const yf = y - yi;
            const at = (a, b) => vals[perm[(perm[a & 255] + b) & 511]];
            const u = fade(xf); const v = fade(yf);
            const top = at(xi, yi) + (at(xi + 1, yi) - at(xi, yi)) * u;
            const bot = at(xi, yi + 1) + (at(xi + 1, yi + 1) - at(xi, yi + 1)) * u;
            return top + (bot - top) * v;
        };
        const d = img.data;
        const base = Math.max(info.W, info.H) / 4;
        for (let y = 0; y < img.height; y += 1) {
            for (let x = 0; x < img.width; x += 1) {
                let f = 0; let amp = 0.5; let freq = 1 / base;
                for (let o = 0; o < 7; o += 1) {
                    f += noise((info.x0 + x) * freq, (info.y0 + y) * freq) * amp;
                    amp *= 0.5; freq *= 2;
                }
                const t = clamp((f - 0.15) / 0.7, 0, 1);
                const i = (y * img.width + x) * 4;
                d[i] = fg[0] + (bg[0] - fg[0]) * t; d[i + 1] = fg[1] + (bg[1] - fg[1]) * t; d[i + 2] = fg[2] + (bg[2] - fg[2]) * t; d[i + 3] = 255;
            }
        }
        return img;
    }

    // bilinear sampling for the distort filters
    function sample(src, w, h, x, y, out, o) {
        x = clamp(x, 0, w - 1); y = clamp(y, 0, h - 1);
        const x0 = Math.floor(x); const y0 = Math.floor(y);
        const x1 = Math.min(w - 1, x0 + 1); const y1 = Math.min(h - 1, y0 + 1);
        const fx = x - x0; const fy = y - y0;
        for (let c = 0; c < 4; c += 1) {
            const a = src[(y0 * w + x0) * 4 + c]; const b = src[(y0 * w + x1) * 4 + c];
            const cc = src[(y1 * w + x0) * 4 + c]; const dd = src[(y1 * w + x1) * 4 + c];
            out[o + c] = (a + (b - a) * fx) * (1 - fy) + (cc + (dd - cc) * fx) * fy;
        }
    }

    function distort(img, info, fn) {
        const w = img.width;
        const h = img.height;
        const src = new Uint8ClampedArray(img.data);
        const d = img.data;
        // the centre and the radius of the selected area, in the padded image
        const cx = info.rx - info.x0 + info.rw / 2;
        const cy = info.ry - info.y0 + info.rh / 2;
        const R = Math.min(info.rw, info.rh) / 2;
        for (let y = 0; y < h; y += 1) {
            for (let x = 0; x < w; x += 1) {
                const dx = x - cx; const dy = y - cy;
                const dist = Math.hypot(dx, dy);
                if (dist >= R) continue;
                const [sx, sy] = fn(dx, dy, dist / R);
                sample(src, w, h, cx + sx, cy + sy, d, (y * w + x) * 4);
            }
        }
        return img;
    }

    function twirl(img, info, angle) {
        const a = (angle * Math.PI) / 180;
        return distort(img, info, (dx, dy, t) => {
            const th = a * (1 - t) * (1 - t);
            const c = Math.cos(th); const s = Math.sin(th);
            return [dx * c - dy * s, dx * s + dy * c];
        });
    }

    function pinch(img, info, amount) {
        const k = amount / 100;
        return distort(img, info, (dx, dy, t) => {
            if (!t) return [dx, dy];
            const f = k >= 0 ? Math.pow(Math.sin((Math.PI / 2) * t), k * 1.5 + 1) / t : Math.pow(t, 1 - k * 0.8) / t;
            return [dx * f, dy * f];
        });
    }

    // ---- healing --------------------------------------------------------------------------------

    /**
     * Fill the masked hole (full-picture mask) of a layer from the best matching patch around it,
     * corrected to the hole's edge colours. Returns the changed rectangle, or null.
     */
    function heal(d, layer, hole) {
        const W = d.width;
        const H = d.height;
        const sel = fromMask(hole, W, H);
        if (!sel) return null;
        const pad = 3;
        const box = C().clampRect({ x: sel.x - pad, y: sel.y - pad, w: sel.w + 2 * pad, h: sel.h + 2 * pad }, W, H);
        const span = Math.max(sel.w, sel.h);
        const full = layer.ctx.getImageData(0, 0, W, H).data;
        const inHole = (x, y) => hole[y * W + x] > 0;
        // the edge: pixels just outside the hole
        const edge = [];
        for (let y = box.y; y < box.y + box.h; y += 1) {
            for (let x = box.x; x < box.x + box.w; x += 1) {
                if (inHole(x, y)) continue;
                let near = false;
                for (let k = -2; k <= 2 && !near; k += 1) {
                    for (let j = -2; j <= 2 && !near; j += 1) {
                        const xx = x + j; const yy = y + k;
                        if (xx >= 0 && yy >= 0 && xx < W && yy < H && inHole(xx, yy)) near = true;
                    }
                }
                if (near) edge.push(x, y);
            }
        }
        if (!edge.length) return null;
        // the source: try offsets in 16 directions at a few distances; the best edge match wins
        let best = null;
        const stride = Math.max(1, Math.floor(edge.length / 2 / 300));
        for (const mult of [1.1, 1.6, 2.4]) {
            const dist = Math.max(4, Math.round(span * mult));
            for (let k = 0; k < 16; k += 1) {
                const a = (k / 16) * Math.PI * 2;
                const ox = Math.round(Math.cos(a) * dist);
                const oy = Math.round(Math.sin(a) * dist);
                if (box.x + ox < 0 || box.y + oy < 0 || box.x + box.w + ox > W || box.y + box.h + oy > H) continue;
                let ok = true;
                let cost = 0;
                for (let i = 0; i < edge.length && ok; i += 2 * stride) {
                    const x = edge[i]; const y = edge[i + 1];
                    if (inHole(x + ox, y + oy)) { ok = false; break; }
                    const a1 = (y * W + x) * 4; const b1 = ((y + oy) * W + x + ox) * 4;
                    cost += (full[a1] - full[b1]) ** 2 + (full[a1 + 1] - full[b1 + 1]) ** 2 + (full[a1 + 2] - full[b1 + 2]) ** 2;
                }
                if (!ok) continue;
                // the patch itself must not come from the hole
                for (let y = sel.y; y < sel.y + sel.h && ok; y += 2) {
                    for (let x = sel.x; x < sel.x + sel.w; x += 2) {
                        if (inHole(x, y) && inHole(x + ox, y + oy)) { ok = false; break; }
                    }
                }
                if (ok && (!best || cost < best.cost)) best = { ox, oy, cost };
            }
            if (best) break;
        }
        // nothing fits round it (a hole at the picture's edge): fall back to the edge colours alone
        const ox = best ? best.ox : 0;
        const oy = best ? best.oy : 0;
        const pts = [];
        const step = Math.max(1, Math.floor(edge.length / 2 / 240));
        for (let i = 0; i < edge.length; i += 2 * step) {
            const x = edge[i]; const y = edge[i + 1];
            const a1 = (y * W + x) * 4;
            const b1 = ((y + oy) * W + x + ox) * 4;
            pts.push([x, y, full[a1] - (best ? full[b1] : 0), full[a1 + 1] - (best ? full[b1 + 1] : 0), full[a1 + 2] - (best ? full[b1 + 2] : 0), full[a1 + 3] - (best ? full[b1 + 3] : 0)]);
        }
        const out = layer.ctx.getImageData(box.x, box.y, box.w, box.h);
        const o = out.data;
        for (let y = box.y; y < box.y + box.h; y += 1) {
            for (let x = box.x; x < box.x + box.w; x += 1) {
                const m = hole[y * W + x];
                if (!m) continue;
                let sw = 0; const acc = [0, 0, 0, 0];
                for (const p of pts) {
                    const dd = (p[0] - x) ** 2 + (p[1] - y) ** 2;
                    const wt = 1 / (dd * dd + 1e-6);
                    sw += wt;
                    acc[0] += p[2] * wt; acc[1] += p[3] * wt; acc[2] += p[4] * wt; acc[3] += p[5] * wt;
                }
                const si = ((y + oy) * W + x + ox) * 4;
                const ti = ((y - box.y) * box.w + x - box.x) * 4;
                const k = m / 255;
                for (let c = 0; c < 4; c += 1) {
                    const v = (best ? full[si + c] : 0) + acc[c] / sw;
                    o[ti + c] = o[ti + c] + (v - o[ti + c]) * k;
                }
            }
        }
        layer.ctx.putImageData(out, box.x, box.y);
        d.markDirty(box);
        return box;
    }

    // ---- dialogs ----------------------------------------------------------------------------

    /**
     * A dialog of sliders, check boxes and combo boxes with Preview:
     *   fields [{ type: 'slider', label, min, max, def, scale?, unit? } | { type: 'check', label, def } |
     *           { type: 'combo', label, options: [[value, text]], def }]
     *   preview(values) on every change (and once at the start), ok(values), cancel()
     */
    function fieldDialog(w, title, fields, hooks) {
        if (!V()) return;
        const tpl = { t: title, w: 276, h: 0, f: ['MS Shell Dlg', 8], c: [] };
        let y = 8;
        let X = 0;
        let maxY = 0;
        const ids = [];
        const colors = {};
        fields.forEach((f, i) => {
            const base = 100 + i * 10;
            ids.push(base);
            if (f.type === 'column') {
                // a new column to the right
                maxY = Math.max(maxY, y);
                y = 8;
                X += 276;
            } else if (f.type === 'slider') {
                tpl.c.push([base, 'S', X + 7, y + 3, 68, 8, 0x50020000, `${f.label}:`, 0]);
                tpl.c.push([base + 1, 'msctls_trackbar32', X + 76, y, 120, 16, 0x50010000, '', 0]);
                tpl.c.push([base + 2, 'E', X + 200, y + 1, 30, 12, 0x50812080, '', 0]);
                if (f.unit) tpl.c.push([base + 3, 'S', X + 233, y + 3, 38, 8, 0x50020000, f.unit, 0]);
                y += 22;
            } else if (f.type === 'check') {
                tpl.c.push([base + 1, 'B', X + 7, y, 200, 10, 0x50010003, f.label, 0]);
                y += 14;
            } else if (f.type === 'heading') {
                tpl.c.push([base, 'S', X + 7, y + 2, 200, 8, 0x50020000, f.label, 0]);
                tpl.c.push([base + 1, 'S', X + 7 + f.label.length * 4 + 4, y + 6, 262 - f.label.length * 4, 1, 0x50000010, '', 0]);
                y += 13;
            } else if (f.type === 'combo') {
                tpl.c.push([base, 'S', X + 7, y + 3, 68, 8, 0x50020000, `${f.label}:`, 0]);
                tpl.c.push([base + 1, 'C', X + 76, y, 120, 100, 0x50210003, '', 0]);
                y += 18;
            } else if (f.type === 'color') {
                tpl.c.push([base, 'S', X + 7, y + 3, 68, 8, 0x50020000, `${f.label}:`, 0]);
                tpl.c.push([base + 1, 'MpColorSwatch', X + 76, y, 36, 13, 0x50000000, '', 0]);
                colors[i] = f.def;
                y += 18;
            } else if (f.type === 'radio') {
                tpl.c.push([base, 'S', X + 7, y + 1, 68, 8, 0x50020000, `${f.label}:`, 0]);
                f.options.forEach(([, text], k) => {
                    tpl.c.push([base + 1 + k, 'B', X + 76 + k * 54, y, 52, 10, k ? 0x50010009 : 0x50030009, text, 0]);
                });
                y += 14;
            }
        });
        y = Math.max(y, maxY) + 4;
        const right = X + 276;
        tpl.w = right;
        tpl.c.push([90, 'B', 7, y + 2, 60, 10, 0x50010003, '&Preview', 0]);
        tpl.c.push([1, 'B', right - 111, y, 50, 14, 0x50010001, 'OK', 0]);
        tpl.c.push([2, 'B', right - 57, y, 50, 14, 0x50010000, 'Cancel', 0]);
        tpl.h = y + 21;
        const values = (ctx) => fields.map((f, i) => {
            const base = ids[i];
            if (f.type === 'slider') return Number(ctx.get(base + 1)) / (f.scale || 1);
            if (f.type === 'check') return !!ctx.get(base + 1);
            if (f.type === 'heading' || f.type === 'column') return null;
            if (f.type === 'color') return colors[i];
            if (f.type === 'radio') return f.options[Math.max(0, f.options.findIndex((_, k) => ctx.get(base + 1 + k)))][0];
            return ctx.get(base + 1);
        });
        let timer = 0;
        let raf = 0;
        const run = (ctx) => {
            cancelAnimationFrame(raf);
            clearTimeout(timer);
            const go = () => { if (ctx.get(90)) hooks.preview(values(ctx)); else if (hooks.unpreview) hooks.unpreview(); };
            if (hooks.heavy) timer = setTimeout(go, 160);
            else raf = requestAnimationFrame(go);
        };
        V().openDialog({
            id: `mpField_${title.replace(/\W+/g, '')}`,
            tpl,
            owner: w.modal,
            init(ctx) {
                ctx.set(90, true);
                ctx.on(90, 'change', () => run(ctx));
                fields.forEach((f, i) => {
                    const base = ids[i];
                    const sc = f.scale || 1;
                    const fmt = (v) => (sc === 1 ? String(v) : (v / sc).toFixed(String(sc).length - 1));
                    if (f.type === 'slider') {
                        ctx.range(base + 1, Math.round(f.min * sc), Math.round(f.max * sc), Math.round(f.def * sc), undefined, 0);
                        ctx.set(base + 2, fmt(Math.round(f.def * sc)));
                        ctx.on(base + 1, 'input', () => { ctx.set(base + 2, fmt(Number(ctx.get(base + 1)))); run(ctx); });
                        ctx.on(base + 2, 'change', () => {
                            const v = clamp(Number(ctx.get(base + 2)), f.min, f.max);
                            ctx.set(base + 1, Math.round((Number.isFinite(v) ? v : f.def) * sc));
                            ctx.set(base + 2, fmt(Number(ctx.get(base + 1))));
                            run(ctx);
                        });
                    } else if (f.type === 'check') {
                        ctx.set(base + 1, !!f.def);
                        ctx.on(base + 1, 'change', () => run(ctx));
                    } else if (f.type === 'combo') {
                        ctx.options(base + 1, f.options.map(([value, text]) => ({ value, text })), f.def);
                        ctx.on(base + 1, 'change', () => run(ctx));
                    } else if (f.type === 'color') {
                        const h = ctx.holder(base + 1);
                        h.innerHTML = `<button type="button" class="mp-cf" title="Click to choose a color"><span style="background:${esc(colors[i])}"></span></button>`;
                        h.querySelector('.mp-cf').addEventListener('click', () => {
                            if (!root.paintColor) return;
                            root.paintColor.picker(w, 'fg', {
                                color: colors[i],
                                title: `Select ${f.label} Color`,
                                onPick(c) { colors[i] = c; h.querySelector('span').style.background = c; run(ctx); }
                            });
                        });
                    } else if (f.type === 'radio') {
                        f.options.forEach(([v], k) => {
                            ctx.set(base + 1 + k, v === f.def);
                            ctx.on(base + 1 + k, 'change', () => run(ctx));
                        });
                    }
                });
                run(ctx);
            },
            ok(ctx) {
                cancelAnimationFrame(raf);
                clearTimeout(timer);
                return hooks.ok(values(ctx));
            },
            cancel() {
                cancelAnimationFrame(raf);
                clearTimeout(timer);
                hooks.cancel();
            }
        });
    }

    /** A filter with a dialog: make(values) -> (img, info) -> img. */
    /** The filter as a smart filter when its layer is a Smart Object (and nothing is selected). */
    function smartKeep(w, S, label, make, vals, pad) {
        if (!S.l.smart || w.doc.selection || !root.paintSmart) return;
        root.paintSmart.addFilter(w, S, { id: w.filterAction, label, make, vals, pad });
    }

    function filterDialog(w, label, fields, make, opts = {}) {
        // paintSmart asks for the maker alone (a smart filter read back from a file)
        if (w.captureMaker) { w.captureMaker({ label, make, pad: opts.pad || 0 }); return; }
        const S = session(w, label, opts.pad || 0, { smart: true });
        if (!S) return;
        fieldDialog(w, label, fields, {
            heavy: opts.heavy !== false,
            preview(vals) { S.write(make(vals)(S.copy(), S.info, vals)); },
            unpreview() { S.restore(); },
            ok(vals) {
                S.write(make(vals)(S.copy(), S.info, vals));
                smartKeep(w, S, label, make, vals, opts.pad || 0);
                S.commit();
                w.lastFilter = { id: w.filterAction, label, make, vals, pad: opts.pad || 0 };
            },
            cancel() { S.cancel(); }
        });
    }

    function filterNow(w, label, fn, pad = 0) {
        if (w.captureMaker) { w.captureMaker({ label, make: () => fn, pad }); return; }
        const S = session(w, label, pad, { smart: true });
        if (!S) return;
        S.write(fn(S.copy(), S.info));
        smartKeep(w, S, label, () => fn, [], pad);
        S.commit();
        w.lastFilter = { id: w.filterAction, label, make: () => fn, vals: [], pad };
    }

    // ---- Levels ------------------------------------------------------------------------------

    function histogram(img, mask, info, channel) {
        const h = new Float64Array(256);
        const d = img.data;
        const pw = img.width;
        for (let y = 0; y < info.rh; y += 1) {
            for (let x = 0; x < info.rw; x += 1) {
                const px = info.rx - info.x0 + x;
                const py = info.ry - info.y0 + y;
                const o = (py * pw + px) * 4;
                if (!d[o + 3]) continue;
                if (mask && !mask[(info.ry + y) * info.W + info.rx + x]) continue;
                const v = channel === 'rgb' ? Math.round(lum(d[o], d[o + 1], d[o + 2])) : d[o + ({ r: 0, g: 1, b: 2 }[channel])];
                h[v] += 1;
            }
        }
        return h;
    }

    function drawHistogram(canvas, h, color) {
        const x = canvas.getContext('2d');
        const W = canvas.width;
        const H = canvas.height;
        x.clearRect(0, 0, W, H);
        let max = 0;
        // Photoshop's scale ignores the tallest few spikes
        const sorted = Array.from(h).sort((a, b) => b - a);
        max = sorted[Math.min(3, sorted.length - 1)] || sorted[0] || 1;
        x.fillStyle = color || '#000';
        for (let i = 0; i < 256; i += 1) {
            const v = Math.min(1, h[i] / max);
            x.fillRect(i, H - Math.round(v * H), 1, Math.round(v * H));
        }
    }

    function levelsLut(p) {
        const lut = new Uint8ClampedArray(256);
        const span = Math.max(1, p.inW - p.inB);
        for (let v = 0; v < 256; v += 1) {
            const t = clamp((v - p.inB) / span, 0, 1);
            lut[v] = p.outB + (p.outW - p.outB) * Math.pow(t, 1 / p.gamma);
        }
        return lut;
    }

    function autoChannel(hist, clip = 0.001) {
        const total = hist.reduce((a, b) => a + b, 0);
        if (!total) return [0, 255];
        let acc = 0; let lo = 0; let hi = 255;
        for (let i = 0; i < 256; i += 1) { acc += hist[i]; if (acc > total * clip) { lo = i; break; } }
        acc = 0;
        for (let i = 255; i >= 0; i -= 1) { acc += hist[i]; if (acc > total * clip) { hi = i; break; } }
        return hi - lo < 2 ? [0, 255] : [lo, hi];
    }

    const CHANNELS = [['rgb', 'RGB'], ['r', 'Red'], ['g', 'Green'], ['b', 'Blue']];
    const CHANNEL_COLOR = { rgb: '#000', r: '#c00', g: '#080', b: '#00c' };

    function levels(w, layer) {
        // layer: { params, preview(P), ok(P), cancel() } for an adjustment layer (no pixels change)
        const S = layer ? wholePicture(w) : session(w, 'Levels');
        if (!S || !V()) return;
        const mask = !layer && w.doc.selection ? maskOf(w.doc, w.doc.selection) : null;
        const hists = {};
        CHANNELS.forEach(([c]) => { hists[c] = histogram(S.base, mask, S.info, c); });
        const P = {};
        CHANNELS.forEach(([c]) => { P[c] = layer && layer.params ? { ...layer.params[c] } : { inB: 0, gamma: 1, inW: 255, outB: 0, outW: 255 }; });
        let ch = 'rgb';
        const tpl = { t: 'Levels', w: 262, h: 186, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 9, 30, 8, 0x50020000, 'C&hannel:', 0],
            [104, 'C', 40, 7, 64, 100, 0x50210003, '', 0],
            [-1, 'S', 7, 25, 60, 8, 0x50020000, '&Input Levels:', 0],
            [110, 'MpHistogram', 7, 36, 176, 76, 0x50000000, '', 0],
            [121, 'E', 7, 115, 30, 12, 0x50812080, '0', 0],
            [122, 'E', 80, 115, 30, 12, 0x50810080, '1.00', 0],
            [123, 'E', 153, 115, 30, 12, 0x50812080, '255', 0],
            [-1, 'S', 7, 133, 60, 8, 0x50020000, '&Output Levels:', 0],
            [112, 'MpOutput', 7, 143, 176, 18, 0x50000000, '', 0],
            [124, 'E', 7, 164, 30, 12, 0x50812080, '0', 0],
            [125, 'E', 153, 164, 30, 12, 0x50812080, '255', 0],
            [1, 'B', 196, 7, 60, 14, 0x50010001, 'OK', 0],
            [2, 'B', 196, 25, 60, 14, 0x50010000, 'Cancel', 0],
            [130, 'B', 196, 49, 60, 14, 0x50010000, '&Auto', 0],
            [131, 'B', 196, 67, 60, 14, 0x50010000, '&Reset', 0],
            [90, 'B', 196, 91, 60, 10, 0x50010003, '&Preview', 0]
        ] };
        let raf = 0;
        const apply = () => {
            const luts = ['r', 'g', 'b'].map((c) => {
                const a = levelsLut(P.rgb);
                const b = levelsLut(P[c]);
                return a.map((v) => b[v]);
            });
            if (layer) layer.preview(JSON.parse(JSON.stringify(P)));
            else S.write(lutFilter(luts)(S.copy()));
        };
        const preview = (ctx) => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => { if (ctx.get(90)) apply(); else S.restore(); });
        };
        let draw = () => {};
        V().openDialog({
            id: 'mpLevels',
            tpl,
            owner: w.modal,
            buttons: {
                130(ctx) {
                    ['r', 'g', 'b'].forEach((c) => { const [lo, hi] = autoChannel(hists[c]); Object.assign(P[c], { inB: lo, inW: hi, gamma: 1 }); });
                    Object.assign(P.rgb, { inB: 0, inW: 255, gamma: 1, outB: 0, outW: 255 });
                    draw(ctx); preview(ctx);
                },
                131(ctx) {
                    CHANNELS.forEach(([c]) => { P[c] = { inB: 0, gamma: 1, inW: 255, outB: 0, outW: 255 }; });
                    draw(ctx); preview(ctx);
                }
            },
            init(ctx) {
                ctx.set(90, true);
                ctx.options(104, CHANNELS.map(([value, text]) => ({ value, text })), 'rgb');
                const hostH = ctx.holder(110);
                hostH.innerHTML = '<div class="mp-lv-hist"><canvas width="256" height="100"></canvas></div><div class="mp-lv-track"><i class="mp-lv-tri is-black" data-k="inB"></i><i class="mp-lv-tri is-grey" data-k="gamma"></i><i class="mp-lv-tri is-white" data-k="inW"></i></div>';
                const hostO = ctx.holder(112);
                hostO.innerHTML = '<div class="mp-lv-ramp"></div><div class="mp-lv-track"><i class="mp-lv-tri is-black" data-k="outB"></i><i class="mp-lv-tri is-white" data-k="outW"></i></div>';
                const canvas = hostH.querySelector('canvas');
                const place = (tri, v) => { tri.style.left = `${4 + (v / 255) * 256}px`; };
                draw = () => {
                    const p = P[ch];
                    drawHistogram(canvas, hists[ch], CHANNEL_COLOR[ch]);
                    place(hostH.querySelector('[data-k="inB"]'), p.inB);
                    place(hostH.querySelector('[data-k="inW"]'), p.inW);
                    place(hostH.querySelector('[data-k="gamma"]'), p.inB + (p.inW - p.inB) * Math.pow(0.5, p.gamma));
                    place(hostO.querySelector('[data-k="outB"]'), p.outB);
                    place(hostO.querySelector('[data-k="outW"]'), p.outW);
                    ctx.set(121, String(p.inB)); ctx.set(122, p.gamma.toFixed(2)); ctx.set(123, String(p.inW));
                    ctx.set(124, String(p.outB)); ctx.set(125, String(p.outW));
                };
                const drag = (host) => host.addEventListener('pointerdown', (ev) => {
                    const tri = ev.target.closest('.mp-lv-tri');
                    if (!tri) return;
                    ev.preventDefault();
                    tri.setPointerCapture(ev.pointerId);
                    const k = tri.dataset.k;
                    const left = host.getBoundingClientRect().left + 4;
                    const move = (mv) => {
                        const v = clamp(Math.round(((mv.clientX - left) / 256) * 255), 0, 255);
                        const p = P[ch];
                        if (k === 'inB') p.inB = Math.min(v, p.inW - 2);
                        else if (k === 'inW') p.inW = Math.max(v, p.inB + 2);
                        else if (k === 'gamma') {
                            const t = clamp((v - p.inB) / Math.max(1, p.inW - p.inB), 0.01, 0.99);
                            p.gamma = clamp(Math.log(t) / Math.log(0.5), 0.1, 9.99);
                        } else if (k === 'outB') p.outB = v;
                        else p.outW = v;
                        draw(ctx); preview(ctx);
                    };
                    const up = () => { tri.removeEventListener('pointermove', move); tri.removeEventListener('pointerup', up); };
                    tri.addEventListener('pointermove', move);
                    tri.addEventListener('pointerup', up);
                });
                drag(hostH);
                drag(hostO);
                const edit = (id, k, lo, hi, isFloat) => ctx.on(id, 'change', () => {
                    const n = Number(ctx.get(id));
                    if (Number.isFinite(n)) P[ch][k] = clamp(isFloat ? n : Math.round(n), lo, hi);
                    draw(ctx); preview(ctx);
                });
                edit(121, 'inB', 0, 253); edit(122, 'gamma', 0.1, 9.99, true); edit(123, 'inW', 2, 255); edit(124, 'outB', 0, 255); edit(125, 'outW', 0, 255);
                ctx.on(104, 'change', () => { ch = ctx.get(104); draw(ctx); });
                ctx.on(90, 'change', () => preview(ctx));
                draw(ctx);
            },
            ok() { cancelAnimationFrame(raf); if (layer) { layer.ok(JSON.parse(JSON.stringify(P))); return; } apply(); S.commit(); },
            cancel() { cancelAnimationFrame(raf); if (layer) { layer.cancel(); return; } S.cancel(); }
        });
    }

    // ---- Curves ------------------------------------------------------------------------------

    /** A monotone cubic through the points (Fritsch-Carlson), as a 256-entry table. */
    function curveLut(pts) {
        const p = pts.slice().sort((a, b) => a[0] - b[0]);
        const lut = new Uint8ClampedArray(256);
        const n = p.length;
        if (n < 2) { for (let i = 0; i < 256; i += 1) lut[i] = i; return lut; }
        const dl = [];
        for (let i = 0; i < n - 1; i += 1) dl.push((p[i + 1][1] - p[i][1]) / Math.max(1e-6, p[i + 1][0] - p[i][0]));
        const m = new Array(n);
        m[0] = dl[0];
        m[n - 1] = dl[n - 2];
        for (let i = 1; i < n - 1; i += 1) m[i] = dl[i - 1] * dl[i] <= 0 ? 0 : (dl[i - 1] + dl[i]) / 2;
        for (let i = 0; i < n - 1; i += 1) {
            if (!dl[i]) { m[i] = 0; m[i + 1] = 0; continue; }
            const a = m[i] / dl[i]; const b = m[i + 1] / dl[i];
            const s = a * a + b * b;
            if (s > 9) { const t = 3 / Math.sqrt(s); m[i] = t * a * dl[i]; m[i + 1] = t * b * dl[i]; }
        }
        let k = 0;
        for (let x = 0; x < 256; x += 1) {
            if (x <= p[0][0]) { lut[x] = p[0][1]; continue; }
            if (x >= p[n - 1][0]) { lut[x] = p[n - 1][1]; continue; }
            while (x > p[k + 1][0]) k += 1;
            const h = p[k + 1][0] - p[k][0];
            const t = (x - p[k][0]) / h;
            const t2 = t * t; const t3 = t2 * t;
            lut[x] = (2 * t3 - 3 * t2 + 1) * p[k][1] + (t3 - 2 * t2 + t) * h * m[k] + (-2 * t3 + 3 * t2) * p[k + 1][1] + (t3 - t2) * h * m[k + 1];
        }
        return lut;
    }

    function curves(w, layer) {
        // layer: { params, preview(P), ok(P), cancel() } for an adjustment layer (no pixels change)
        const S = layer ? wholePicture(w) : session(w, 'Curves');
        if (!S || !V()) return;
        const mask = !layer && w.doc.selection ? maskOf(w.doc, w.doc.selection) : null;
        const hists = {};
        CHANNELS.forEach(([c]) => { hists[c] = histogram(S.base, mask, S.info, c); });
        const P = {};
        CHANNELS.forEach(([c]) => { P[c] = layer && layer.params ? layer.params[c].map((q) => q.slice()) : [[0, 0], [255, 255]]; });
        let ch = 'rgb';
        let sel = -1;
        const tpl = { t: 'Curves', w: 262, h: 214, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 9, 30, 8, 0x50020000, 'C&hannel:', 0],
            [104, 'C', 40, 7, 64, 100, 0x50210003, '', 0],
            [110, 'MpCurves', 7, 24, 176, 164, 0x50000000, '', 0],
            [-1, 'S', 7, 196, 24, 8, 0x50020000, 'I&nput:', 0],
            [121, 'E', 33, 194, 30, 12, 0x50812080, '', 0],
            [-1, 'S', 80, 196, 28, 8, 0x50020000, 'O&utput:', 0],
            [122, 'E', 110, 194, 30, 12, 0x50812080, '', 0],
            [1, 'B', 196, 7, 60, 14, 0x50010001, 'OK', 0],
            [2, 'B', 196, 25, 60, 14, 0x50010000, 'Cancel', 0],
            [131, 'B', 196, 49, 60, 14, 0x50010000, '&Reset', 0],
            [90, 'B', 196, 73, 60, 10, 0x50010003, '&Preview', 0]
        ] };
        let raf = 0;
        const apply = () => {
            const all = curveLut(P.rgb);
            const luts = ['r', 'g', 'b'].map((c) => { const l = curveLut(P[c]); return all.map((v) => l[v]); });
            if (layer) layer.preview(JSON.parse(JSON.stringify(P)));
            else S.write(lutFilter(luts)(S.copy()));
        };
        const preview = (ctx) => {
            cancelAnimationFrame(raf);
            raf = requestAnimationFrame(() => { if (ctx.get(90)) apply(); else S.restore(); });
        };
        let draw = () => {};
        V().openDialog({
            id: 'mpCurves',
            tpl,
            owner: w.modal,
            buttons: {
                131(ctx) { CHANNELS.forEach(([c]) => { P[c] = [[0, 0], [255, 255]]; }); sel = -1; draw(ctx); preview(ctx); }
            },
            init(ctx) {
                ctx.set(90, true);
                ctx.options(104, CHANNELS.map(([value, text]) => ({ value, text })), 'rgb');
                const host = ctx.holder(110);
                host.innerHTML = '<canvas class="mp-cv" width="256" height="256"></canvas>';
                const cv = host.querySelector('canvas');
                const g = cv.getContext('2d');
                draw = () => {
                    g.clearRect(0, 0, 256, 256);
                    g.fillStyle = '#fff';
                    g.fillRect(0, 0, 256, 256);
                    const hc = C().makeCanvas(256, 256);
                    drawHistogram(hc, hists[ch], '#d8d8d8');
                    g.drawImage(hc, 0, 0);
                    g.strokeStyle = '#c8c8c8';
                    g.lineWidth = 1;
                    for (let i = 1; i < 4; i += 1) {
                        g.beginPath(); g.moveTo(i * 64 + 0.5, 0); g.lineTo(i * 64 + 0.5, 256); g.stroke();
                        g.beginPath(); g.moveTo(0, i * 64 + 0.5); g.lineTo(256, i * 64 + 0.5); g.stroke();
                    }
                    g.beginPath(); g.moveTo(0, 256); g.lineTo(256, 0); g.stroke();
                    const lut = curveLut(P[ch]);
                    g.strokeStyle = CHANNEL_COLOR[ch];
                    g.beginPath();
                    for (let x = 0; x < 256; x += 1) (x ? g.lineTo(x + 0.5, 255.5 - lut[x]) : g.moveTo(0.5, 255.5 - lut[0]));
                    g.stroke();
                    P[ch].forEach(([x, y], i) => {
                        g.fillStyle = i === sel ? '#000' : '#fff';
                        g.strokeStyle = '#000';
                        g.fillRect(x - 3, 252 - y, 7, 7);
                        g.strokeRect(x - 2.5, 252.5 - y, 6, 6);
                    });
                    const p = P[ch][sel];
                    ctx.set(121, p ? String(p[0]) : '');
                    ctx.set(122, p ? String(p[1]) : '');
                };
                const at = (ev) => {
                    const r = cv.getBoundingClientRect();
                    return [((ev.clientX - r.left) / r.width) * 255, 255 - ((ev.clientY - r.top) / r.height) * 255];
                };
                cv.addEventListener('pointerdown', (ev) => {
                    ev.preventDefault();
                    cv.setPointerCapture(ev.pointerId);
                    const [x, y] = at(ev);
                    const pts = P[ch];
                    sel = pts.findIndex(([px, py]) => Math.abs(px - x) < 6 && Math.abs(py - y) < 6);
                    if (sel < 0) {
                        const xi = clamp(Math.round(x), 1, 254);
                        if (pts.some(([px]) => Math.abs(px - xi) < 3)) return;
                        pts.push([xi, clamp(Math.round(y), 0, 255)]);
                        pts.sort((a, b) => a[0] - b[0]);
                        sel = pts.findIndex(([px]) => px === xi);
                    }
                    const move = (mv) => {
                        const [mx, my] = at(mv);
                        const list = P[ch];
                        const p = list[sel];
                        if (!p) return;
                        const end = sel === 0 || sel === list.length - 1;
                        // drag a middle point off the grid to delete it (Photoshop)
                        if (!end && (my < -24 || my > 279) && list.length > 2) {
                            list.splice(sel, 1);
                            sel = -1;
                            draw(ctx); preview(ctx);
                            return;
                        }
                        const lo = sel > 0 ? list[sel - 1][0] + 1 : 0;
                        const hi = sel < list.length - 1 ? list[sel + 1][0] - 1 : 255;
                        p[0] = clamp(Math.round(mx), lo, hi);
                        p[1] = clamp(Math.round(my), 0, 255);
                        draw(ctx); preview(ctx);
                    };
                    const up = () => { cv.removeEventListener('pointermove', move); cv.removeEventListener('pointerup', up); };
                    cv.addEventListener('pointermove', move);
                    cv.addEventListener('pointerup', up);
                    draw(ctx); preview(ctx);
                });
                const edit = (id, k) => ctx.on(id, 'change', () => {
                    const p = P[ch][sel];
                    const n = Number(ctx.get(id));
                    if (p && Number.isFinite(n)) p[k] = clamp(Math.round(n), 0, 255);
                    P[ch].sort((a, b) => a[0] - b[0]);
                    draw(ctx); preview(ctx);
                });
                edit(121, 0); edit(122, 1);
                ctx.on(104, 'change', () => { ch = ctx.get(104); sel = -1; draw(ctx); });
                ctx.on(90, 'change', () => preview(ctx));
                draw(ctx);
            },
            ok() { cancelAnimationFrame(raf); if (layer) { layer.ok(JSON.parse(JSON.stringify(P))); return; } apply(); S.commit(); },
            cancel() { cancelAnimationFrame(raf); if (layer) { layer.cancel(); return; } S.cancel(); }
        });
    }

    // ---- the simpler adjustments -------------------------------------------------------------

    function srgbToLin(v) { v /= 255; return v <= 0.04045 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }
    function linToSrgb(v) { v = Math.max(0, v); return 255 * (v <= 0.0031308 ? v * 12.92 : 1.055 * v ** (1 / 2.4) - 0.055); }

    const PHOTO_FILTERS = [
        ['#ec8a00', 'Warming Filter (85)'], ['#fa9600', 'Warming Filter (LBA)'], ['#ebb113', 'Warming Filter (81)'],
        ['#006dff', 'Cooling Filter (80)'], ['#005dff', 'Cooling Filter (LBB)'], ['#00b5ff', 'Cooling Filter (82)'],
        ['#ea1a1a', 'Red'], ['#f38417', 'Orange'], ['#f9e31c', 'Yellow'], ['#19c919', 'Green'], ['#1dcbea', 'Cyan'],
        ['#1d35ea', 'Blue'], ['#9b1dea', 'Violet'], ['#e31ca2', 'Magenta'], ['#ac7a33', 'Sepia'], ['#ff5d25', 'Deep Red']
    ];

    function keepLum(r, g, b, out) {
        const before = C().rgbToHsl(r, g, b)[2];
        const hsl = C().rgbToHsl(out[0], out[1], out[2]);
        return C().hslToRgb(hsl[0], hsl[1], before);
    }

    // Color Balance after GIMP's: each tone's weight for a channel value
    function balanceWeights(v) {
        const a = 0.25; const b = 0.333; const sc = 0.7;
        return [
            clamp((v - b) / -a + 0.5, 0, 1) * sc,
            clamp((v - b) / a + 0.5, 0, 1) * clamp((v + b - 1) / -a + 0.5, 0, 1) * sc,
            clamp((v + b - 1) / a + 0.5, 0, 1) * sc
        ];
    }

    const tone = (name, p, o) => [
        { type: 'heading', label: name },
        { type: 'slider', label: 'Cyan / Red', min: -100, max: 100, def: p ? p[o + 1] : 0 },
        { type: 'slider', label: 'Magenta / Green', min: -100, max: 100, def: p ? p[o + 2] : 0 },
        { type: 'slider', label: 'Yellow / Blue', min: -100, max: 100, def: p ? p[o + 3] : 0 }
    ];

    /**
     * The adjustments a dialog of fields drives, the same for the pixels (Adjustments menu) and for
     * an adjustment layer: fields(w, params?) and make(values) -> (ImageData) -> ImageData.
     */
    const ADJ = {
        brightness: {
            label: 'Brightness/Contrast',
            fields: (w, p) => [
                { type: 'slider', label: 'Brightness', min: -100, max: 100, def: p ? p[0] : 0 },
                { type: 'slider', label: 'Contrast', min: -100, max: 99, def: p ? p[1] : 0 }
            ],
            // Photoshop's (legacy) Brightness/Contrast, so a PSD looks the same: the brightness added,
            // then a stretch round 127.5 (checked against Photoshop 2022 on Ruiko)
            make: ([br, ct]) => {
                const k = ct > 0 ? 1 / (1 - Math.min(ct, 99.9) / 100) : 1 + ct / 100;
                const f = (v) => 127.5 + (v + br - 127.5) * k;
                return perPixel((r, g, b) => [f(r), f(g), f(b)]);
            }
        },
        exposure: {
            label: 'Exposure',
            fields: (w, p) => [
                { type: 'slider', label: 'Exposure', min: -5, max: 5, def: p ? p[0] : 0, scale: 100 },
                { type: 'slider', label: 'Offset', min: -0.5, max: 0.5, def: p ? p[1] : 0, scale: 1000 },
                { type: 'slider', label: 'Gamma', min: 0.1, max: 3, def: p ? p[2] : 1, scale: 100 }
            ],
            make: ([e, off, gam]) => {
                const lut = new Uint8ClampedArray(256);
                for (let v = 0; v < 256; v += 1) lut[v] = linToSrgb(Math.max(0, srgbToLin(v) * 2 ** e + off) ** (1 / gam));
                return lutFilter([lut, lut, lut]);
            }
        },
        vibrance: {
            label: 'Vibrance',
            fields: (w, p) => [
                { type: 'slider', label: 'Vibrance', min: -100, max: 100, def: p ? p[0] : 0 },
                { type: 'slider', label: 'Saturation', min: -100, max: 100, def: p ? p[1] : 0 }
            ],
            make: ([vib, sat]) => perPixel((r, g, b) => {
                const mx = Math.max(r, g, b);
                const avg = (r + g + b) / 3;
                const amt = ((mx - avg) / 255) * (-vib / 100) * 3;
                r += (mx - r) * amt; g += (mx - g) * amt; b += (mx - b) * amt;
                const l = lum(r, g, b);
                const k = 1 + sat / 100;
                return [l + (r - l) * k, l + (g - l) * k, l + (b - l) * k];
            })
        },
        hue: {
            label: 'Hue/Saturation',
            fields: (w, p) => [
                { type: 'slider', label: 'Hue', min: -180, max: 180, def: p ? p[0] : 0 },
                { type: 'slider', label: 'Saturation', min: -100, max: 100, def: p ? p[1] : 0 },
                { type: 'slider', label: 'Lightness', min: -100, max: 100, def: p ? p[2] : 0 },
                { type: 'check', label: 'C&olorize', def: p ? p[3] : false }
            ],
            make: ([h, sat, li, colorize]) => perPixel((r, g, b) => {
                const hsl = C().rgbToHsl(r, g, b);
                let hh = colorize ? ((h + 360) % 360) / 360 : (hsl[0] + h / 360) % 1;
                if (hh < 0) hh += 1;
                const ss = colorize ? clamp(0.25 + sat / 200, 0, 1) : clamp(hsl[1] * (1 + sat / 100), 0, 1);
                const ll = li >= 0 ? hsl[2] + (1 - hsl[2]) * (li / 100) : hsl[2] * (1 + li / 100);
                return C().hslToRgb(hh, ss, ll);
            })
        },
        balance: {
            label: 'Color Balance',
            fields: (w, p) => [...tone('Shadows', p, 0), ...tone('Midtones', p, 4), ...tone('Highlights', p, 8), { type: 'check', label: 'Preserve &Luminosity', def: p ? p[12] : true }],
            make: (vals) => {
                const shifts = [0, 1, 2].map((t) => vals.slice(t * 4 + 1, t * 4 + 4).map((v) => (v || 0) / 100));
                const tables = [0, 1, 2].map((c) => {
                    const lut = new Uint8ClampedArray(256);
                    for (let v = 0; v < 256; v += 1) {
                        const ww = balanceWeights(v / 255);
                        lut[v] = v + (shifts[0][c] * ww[0] + shifts[1][c] * ww[1] + shifts[2][c] * ww[2]) * 127;
                    }
                    return lut;
                });
                return perPixel((r, g, b) => {
                    const out = [tables[0][r], tables[1][g], tables[2][b]];
                    return vals[12] ? keepLum(r, g, b, out) : out;
                });
            }
        },
        bw: {
            label: 'Black & White',
            fields: (w, p) => [
                { type: 'color', label: 'Tint', def: p ? p[0] : '#e0c090' },
                { type: 'slider', label: 'Tint Amount', min: 0, max: 100, def: p ? p[1] : 0, unit: '%' }
            ],
            make: ([tint, amt]) => {
                const [tr, tg, tb] = C().parseColor(tint || '#ffffff');
                const k = (amt || 0) / 100;
                return perPixel((r, g, b) => {
                    const v = lum(r, g, b);
                    return [v + (v * tr / 255 - v) * k, v + (v * tg / 255 - v) * k, v + (v * tb / 255 - v) * k];
                });
            }
        },
        photo: {
            label: 'Photo Filter',
            fields: (w, p) => [
                { type: 'combo', label: 'Filter', options: PHOTO_FILTERS, def: p ? p[0] : '#ec8a00' },
                { type: 'slider', label: 'Density', min: 1, max: 100, def: p ? p[1] : 25, unit: '%' },
                { type: 'check', label: 'Preserve &Luminosity', def: p ? p[2] : true }
            ],
            make: ([color, dens, keep]) => {
                const [fr, fg, fb] = C().parseColor(color);
                const k = dens / 100;
                return perPixel((r, g, b) => {
                    const out = [r + (r * fr / 255 - r) * k, g + (g * fg / 255 - g) * k, b + (b * fb / 255 - b) * k];
                    return keep ? keepLum(r, g, b, out) : out;
                });
            }
        },
        invert: { label: 'Invert', fields: null, make: () => perPixel((r, g, b) => [255 - r, 255 - g, 255 - b]) },
        posterize: {
            label: 'Posterize',
            fields: (w, p) => [{ type: 'slider', label: 'Levels', min: 2, max: 255, def: p ? p[0] : 4 }],
            // Photoshop's steps: floor(v * levels / 256), spread back over 0-255
            make: ([n]) => {
                const f = (v) => Math.round((Math.min(n - 1, Math.floor((v * n) / 256)) * 255) / (n - 1));
                return perPixel((r, g, b) => [f(r), f(g), f(b)]);
            }
        },
        threshold: {
            label: 'Threshold',
            fields: (w, p) => [{ type: 'slider', label: 'Threshold Level', min: 1, max: 255, def: p ? p[0] : 128 }],
            make: ([t]) => perPixel((r, g, b) => { const v = lum(r, g, b) >= t ? 255 : 0; return [v, v, v]; })
        },
        gradmap: {
            label: 'Gradient Map',
            fields: (w, p) => [
                { type: 'color', label: 'Shadows', def: p ? p[0] : w.fg },
                { type: 'color', label: 'Highlights', def: p ? p[1] : w.bg },
                { type: 'check', label: '&Reverse', def: p ? p[2] : false }
            ],
            make: ([from, to, rev]) => {
                const a = C().parseColor(from);
                const b = C().parseColor(to);
                const [c0, c1] = rev ? [b, a] : [a, b];
                return perPixel((r, g, bl) => {
                    const t = clamp(lum(r, g, bl) / 255, 0, 1);
                    return [c0[0] + (c1[0] - c0[0]) * t, c0[1] + (c1[1] - c0[1]) * t, c0[2] + (c1[2] - c0[2]) * t];
                });
            }
        }
    };

    function adjustPixels(w, kind) {
        const A = ADJ[kind];
        if (!A.fields) { filterNow(w, A.label, A.make([])); return; }
        filterDialog(w, A.label, A.fields(w), A.make, { heavy: false });
    }

    const exposure = (w) => adjustPixels(w, 'exposure');
    const vibrance = (w) => adjustPixels(w, 'vibrance');
    const colorBalance = (w) => adjustPixels(w, 'balance');
    const photoFilter = (w) => adjustPixels(w, 'photo');
    const gradientMap = (w) => adjustPixels(w, 'gradmap');
    const threshold = (w) => adjustPixels(w, 'threshold');

    function equalize(w) {
        const S = session(w, 'Equalize');
        if (!S) return;
        const mask = w.doc.selection ? maskOf(w.doc, w.doc.selection) : null;
        const h = histogram(S.base, mask, S.info, 'rgb');
        const total = h.reduce((x, y) => x + y, 0) || 1;
        const cdf = new Float64Array(256);
        let acc = 0;
        for (let i = 0; i < 256; i += 1) { acc += h[i]; cdf[i] = acc / total; }
        S.write(perPixel((r, g, b) => {
            const l = lum(r, g, b);
            const t = cdf[Math.round(l)] * 255;
            const k = l > 0 ? t / l : 0;
            return l > 0 ? [r * k, g * k, b * k] : [t, t, t];
        })(S.copy()));
        S.commit();
    }

    function autoTone(w, perChannel, label) {
        const S = session(w, label);
        if (!S) return;
        const mask = w.doc.selection ? maskOf(w.doc, w.doc.selection) : null;
        const luts = ['r', 'g', 'b'].map((c) => {
            const [lo, hi] = autoChannel(histogram(S.base, mask, S.info, perChannel ? c : 'rgb'));
            return levelsLut({ inB: lo, inW: hi, gamma: 1, outB: 0, outW: 255 });
        });
        S.write(lutFilter(luts)(S.copy()));
        S.commit();
    }

    // ---- Edit > Fill, Stroke ------------------------------------------------------------------

    function fill(w) {
        const d = w.doc;
        if (w.proSession) { w.status('Finish the open dialog first.'); return; }
        fieldDialog(w, 'Fill', [
            { type: 'combo', label: 'Use', options: [['fg', 'Foreground Color'], ['bg', 'Background Color'], ['content', 'Content-Aware'], ['black', 'Black'], ['gray', '50% Gray'], ['white', 'White']], def: d.selection ? 'content' : 'fg' },
            { type: 'combo', label: 'Mode', options: BLEND_FILL, def: 'normal' },
            { type: 'slider', label: 'Opacity', min: 1, max: 100, def: 100, unit: '%' },
            { type: 'check', label: 'Preserve &Transparency', def: false }
        ], (() => {
            let S = null;
            const run = ([use, mode, opacity, keepAlpha]) => {
                if (!S) S = session(w, 'Fill');
                if (!S) return;
                S.restore();
                if (use === 'content') {
                    if (!d.selection) return;
                    heal(d, S.l, maskOf(d, d.selection));
                    const img = S.l.ctx.getImageData(S.pr.x, S.pr.y, S.pr.w, S.pr.h);
                    S.restore();
                    S.write(img);
                    return;
                }
                const color = { fg: w.fg, bg: w.bg, black: '#000', gray: '#808080', white: '#fff' }[use];
                const c = C().makeCanvas(S.pr.w, S.pr.h);
                const x = c.getContext('2d', { willReadFrequently: true });
                x.putImageData(S.base, 0, 0);
                x.globalAlpha = opacity / 100;
                x.globalCompositeOperation = keepAlpha ? 'source-atop' : (C().BLENDS[mode] || 'source-over');
                x.fillStyle = color;
                x.fillRect(0, 0, S.pr.w, S.pr.h);
                if (keepAlpha && mode !== 'normal') {
                    // blend first, then keep the old alpha
                    x.globalCompositeOperation = 'source-over';
                    x.clearRect(0, 0, S.pr.w, S.pr.h);
                    x.globalAlpha = 1;
                    x.putImageData(S.base, 0, 0);
                    x.globalAlpha = opacity / 100;
                    x.globalCompositeOperation = C().BLENDS[mode] || 'source-over';
                    x.fillRect(0, 0, S.pr.w, S.pr.h);
                    const out = x.getImageData(0, 0, S.pr.w, S.pr.h);
                    for (let i = 3; i < out.data.length; i += 4) out.data[i] = S.base.data[i];
                    S.write(out);
                    return;
                }
                S.write(x.getImageData(0, 0, S.pr.w, S.pr.h));
            };
            return {
                heavy: true,
                preview: run,
                unpreview() { if (S) S.restore(); },
                ok(vals) { run(vals); if (S) S.commit(); },
                cancel() { if (S) S.cancel(); }
            };
        })());
    }

    function stroke(w) {
        const d = w.doc;
        const s = d.selection;
        if (!s) return;
        // the widest stroke the dialog allows decides the area once
        const S = session(w, 'Stroke', 0, { rect: C().clampRect({ x: s.x - 104, y: s.y - 104, w: s.w + 208, h: s.h + 208 }, d.width, d.height), mask: null });
        if (!S) return;
        const band = (width, where) => {
            if (where === 'inside') return combine(d, s, morph(d, s, -width), 'subtract');
            if (where === 'outside') return combine(d, morph(d, s, width), s, 'subtract');
            return combine(d, morph(d, s, Math.ceil(width / 2)), morph(d, s, -Math.floor(width / 2)), 'subtract');
        };
        const run = ([width, where, opacity]) => {
            const b = band(width, where);
            if (!b) { S.restore(); return; }
            const [r, g, bl, ca] = C().parseColor(w.fg);
            const out = S.copy();
            const o = out.data;
            const a = (opacity / 100) * (ca / 255);
            for (let y = 0; y < S.pr.h; y += 1) {
                for (let x = 0; x < S.pr.w; x += 1) {
                    if (!b.mask[(S.pr.y + y) * d.width + S.pr.x + x]) continue;
                    const i = (y * S.pr.w + x) * 4;
                    const ao = o[i + 3] / 255;
                    const na = a + ao * (1 - a);
                    o[i] = (r * a + o[i] * ao * (1 - a)) / na; o[i + 1] = (g * a + o[i + 1] * ao * (1 - a)) / na; o[i + 2] = (bl * a + o[i + 2] * ao * (1 - a)) / na;
                    o[i + 3] = na * 255;
                }
            }
            // written through the band (its soft edge), not the selection
            S.mask = b.mask;
            S.write(out);
        };
        fieldDialog(w, 'Stroke', [
            { type: 'slider', label: 'Width', min: 1, max: 100, def: 3, unit: 'px' },
            { type: 'radio', label: 'Location', options: [['inside', 'Inside'], ['center', 'Center'], ['outside', 'Outside']], def: 'center' },
            { type: 'slider', label: 'Opacity', min: 1, max: 100, def: 100, unit: '%' }
        ], {
            heavy: true,
            preview: run,
            unpreview() { S.restore(); },
            ok(vals) { run(vals); S.commit(); },
            cancel() { S.cancel(); }
        });
    }

    // ---- Select ------------------------------------------------------------------------------

    function setSel(w, s, remember = true) {
        if (remember && w.doc.selection) w.lastSelection = w.doc.selection;
        w.setSelection(s || null);
    }

    function modifyDialog(w, title, label, max, fn) {
        const before = w.doc.selection;
        if (!before) return;
        fieldDialog(w, title, [{ type: 'slider', label, min: 1, max, def: Math.min(5, max), unit: 'pixels' }], {
            heavy: true,
            preview([v]) { w.setSelection(fn(w.doc, before, v)); },
            unpreview() { w.setSelection(before); },
            ok([v]) { w.setSelection(before); setSel(w, fn(w.doc, before, v)); },
            cancel() { w.setSelection(before); }
        });
    }

    function colorRangeDialog(w) {
        const before = w.doc.selection;
        const rgb = C().parseColor(w.fg);
        fieldDialog(w, 'Color Range', [
            { type: 'combo', label: 'Select', options: [['fg', 'Foreground Color'], ['bg', 'Background Color'], ['hi', 'Highlights'], ['mid', 'Midtones'], ['sh', 'Shadows']], def: 'fg' },
            { type: 'slider', label: 'Fuzziness', min: 0, max: 200, def: 40 }
        ], {
            heavy: true,
            preview([what, fuzz]) { w.setSelection(rangeOf(w, what, fuzz, rgb)); },
            unpreview() { w.setSelection(before); },
            ok([what, fuzz]) { w.setSelection(before); setSel(w, rangeOf(w, what, fuzz, rgb)); },
            cancel() { w.setSelection(before); }
        });
    }

    function rangeOf(w, what, fuzz, rgb) {
        if (what === 'fg') return colorRange(w, rgb, fuzz);
        if (what === 'bg') return colorRange(w, C().parseColor(w.bg), fuzz);
        const d = w.doc;
        const data = d.flattened().getContext('2d').getImageData(0, 0, d.width, d.height).data;
        const out = new Uint8Array(d.width * d.height);
        const [lo, hi] = { hi: [190, 255], mid: [85, 170], sh: [0, 65] }[what];
        const f = Math.max(1, fuzz / 2);
        for (let i = 0; i < out.length; i += 1) {
            const v = lum(data[i * 4], data[i * 4 + 1], data[i * 4 + 2]);
            const dist = v < lo ? lo - v : v > hi ? v - hi : 0;
            out[i] = dist >= f ? 0 : Math.round(255 * (1 - dist / f));
        }
        return fromMask(out, d.width, d.height);
    }

    // ---- the Navigator and Info windows -------------------------------------------------------

    function dock(w) { return w.modal.querySelector('.mp-dock'); }

    function syncDock(w) {
        w.modal.classList.toggle('mp-has-dock', !!dock(w).children.length);
    }

    function navOpen(w) { return !!dock(w).querySelector('.mp-navigator'); }
    function infoOpen(w) { return !!dock(w).querySelector('.mp-info'); }

    function toggleNavigator(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-navigator');
        if (cur) { cur.remove(); syncDock(w); return; }
        d.insertAdjacentHTML('afterbegin', `<div class="mp-panel mp-navigator">
            <div class="mp-panel-cap">Navigator</div>
            <div class="mp-nav-view"><canvas></canvas><div class="mp-nav-box"></div></div>
            <div class="mp-nav-bar"><span class="mp-nav-zoom">100%</span><button type="button" class="mp-nav-out" title="Zoom Out"></button><input type="range" class="mp-nav-slider" min="-300" max="300" step="1" value="0"><button type="button" class="mp-nav-in" title="Zoom In"></button></div>
        </div>`);
        const p = d.querySelector('.mp-navigator');
        const view = p.querySelector('.mp-nav-view');
        const go = (ev) => {
            const c = view.querySelector('canvas');
            const r = c.getBoundingClientRect();
            const sx = (ev.clientX - r.left) / r.width * w.doc.width;
            const sy = (ev.clientY - r.top) / r.height * w.doc.height;
            const ws = w.workspace;
            ws.scrollLeft = sx * w.zoom - ws.clientWidth / 2;
            ws.scrollTop = sy * w.zoom - ws.clientHeight / 2;
            navBox(w);
        };
        view.addEventListener('pointerdown', (ev) => {
            ev.preventDefault();
            view.setPointerCapture(ev.pointerId);
            go(ev);
            const move = (mv) => go(mv);
            const up = () => { view.removeEventListener('pointermove', move); view.removeEventListener('pointerup', up); };
            view.addEventListener('pointermove', move);
            view.addEventListener('pointerup', up);
        });
        p.querySelector('.mp-nav-slider').addEventListener('input', (ev) => w.setZoom(2 ** (Number(ev.target.value) / 100)));
        p.querySelector('.mp-nav-in').addEventListener('click', () => w.setZoom(w.zoom * 2));
        p.querySelector('.mp-nav-out').addEventListener('click', () => w.setZoom(w.zoom / 2));
        if (!w.navWired) {
            w.navWired = true;
            w.workspace.addEventListener('scroll', () => navBox(w), { passive: true });
        }
        syncDock(w);
        navRefresh(w, true);
    }

    function navRefresh(w, now) {
        const p = dock(w).querySelector('.mp-navigator');
        if (!p) return;
        if (!now) {
            if (w.navTimer) return;
            w.navTimer = setTimeout(() => { w.navTimer = 0; navRefresh(w, true); }, 250);
            return;
        }
        const c = p.querySelector('canvas');
        const s = Math.min(180 / w.doc.width, 130 / w.doc.height);
        c.width = Math.max(1, Math.round(w.doc.width * s));
        c.height = Math.max(1, Math.round(w.doc.height * s));
        c.getContext('2d').drawImage(w.view, 0, 0, c.width, c.height);
        navBox(w);
    }

    function navBox(w) {
        const p = dock(w).querySelector('.mp-navigator');
        if (!p) return;
        const c = p.querySelector('canvas');
        const box = p.querySelector('.mp-nav-box');
        const ws = w.workspace;
        const k = c.width / (w.doc.width * w.zoom);
        const x = clamp(ws.scrollLeft * k, 0, c.width);
        const y = clamp(ws.scrollTop * k, 0, c.height);
        box.style.left = `${c.offsetLeft + x}px`;
        box.style.top = `${c.offsetTop + y}px`;
        box.style.width = `${Math.max(2, Math.min(c.width - x, ws.clientWidth * k))}px`;
        box.style.height = `${Math.max(2, Math.min(c.height - y, ws.clientHeight * k))}px`;
        p.querySelector('.mp-nav-zoom').textContent = `${Math.round(w.zoom * 1000) / 10}%`;
        const sl = p.querySelector('.mp-nav-slider');
        if (doc.activeElement !== sl) sl.value = String(Math.round(Math.log2(w.zoom) * 100));
    }

    function toggleInfo(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-info');
        if (cur) { cur.remove(); syncDock(w); return; }
        const html = `<div class="mp-panel mp-info">
            <div class="mp-panel-cap">Info</div>
            <div class="mp-info-grid">
                <div><b>R:</b><span data-i="r"></span><b>G:</b><span data-i="g"></span><b>B:</b><span data-i="b"></span></div>
                <div><b>H:</b><span data-i="h"></span><b>S:</b><span data-i="s"></span><b>L:</b><span data-i="l"></span></div>
                <div><b>X:</b><span data-i="x"></span><b>Y:</b><span data-i="y"></span><b>A:</b><span data-i="a"></span></div>
                <div><b>W:</b><span data-i="w"></span><b>H:</b><span data-i="hh"></span><span class="mp-info-sw"></span></div>
            </div>
        </div>`;
        const nav = d.querySelector('.mp-navigator');
        if (nav) nav.insertAdjacentHTML('afterend', html); else d.insertAdjacentHTML('afterbegin', html);
        syncDock(w);
        info(w, null);
    }

    function info(w, p) {
        const panel = dock(w).querySelector('.mp-info');
        if (!panel) return;
        const set = (k, v) => { const e = panel.querySelector(`[data-i="${k}"]`); if (e) e.textContent = v; };
        const s = w.floating || w.doc.selection;
        set('w', s ? Math.round(s.w) : '');
        set('hh', s ? Math.round(s.h) : '');
        if (!p) { ['r', 'g', 'b', 'h', 's', 'l', 'x', 'y', 'a'].forEach((k) => set(k, '')); return; }
        const x = Math.floor(p.x);
        const y = Math.floor(p.y);
        if (x < 0 || y < 0 || x >= w.doc.width || y >= w.doc.height) { ['r', 'g', 'b', 'h', 's', 'l', 'x', 'y', 'a'].forEach((k) => set(k, '')); return; }
        const px = w.doc.layer.ctx.getImageData(x, y, 1, 1).data;
        const view = w.vctx.getImageData(x, y, 1, 1).data;
        const [hh, ss, ll] = C().rgbToHsl(view[0], view[1], view[2]);
        set('r', view[0]); set('g', view[1]); set('b', view[2]);
        set('h', `${Math.round(hh * 360)}\u00b0`); set('s', `${Math.round(ss * 100)}%`); set('l', `${Math.round(ll * 100)}%`);
        set('x', x); set('y', y); set('a', `${Math.round(px[3] / 2.55)}%`);
        panel.querySelector('.mp-info-sw').style.background = `rgb(${view[0]},${view[1]},${view[2]})`;
    }

    // ---- adjustment layers -----------------------------------------------------------------------

    /** Levels / Curves on an adjustment layer: the histogram of the whole picture, nothing written. */
    function wholePicture(w) {
        const d = w.doc;
        const base = d.flattened().getContext('2d').getImageData(0, 0, d.width, d.height);
        return {
            base, info: { x0: 0, y0: 0, rx: 0, ry: 0, rw: d.width, rh: d.height, W: d.width, H: d.height },
            write() {}, restore() {}, commit() {}, cancel() {}, copy() { return base; }
        };
    }

    function levelsFilter(P) {
        const luts = ['r', 'g', 'b'].map((c) => { const a = levelsLut(P.rgb); const b = levelsLut(P[c]); return a.map((v) => b[v]); });
        return lutFilter(luts);
    }

    function curvesFilter(P) {
        const all = curveLut(P.rgb);
        return lutFilter(['r', 'g', 'b'].map((c) => { const l = curveLut(P[c]); return all.map((v) => l[v]); }));
    }

    // what the compositor runs for an adjustment layer (PaintCore.adjusters); no params yet: nothing
    function registerAdjusters() {
        const reg = C() && C().adjusters;
        if (!reg) return;
        const none = (img) => img;
        Object.keys(ADJ).forEach((k) => { reg[k] = (p) => (p || !ADJ[k].fields ? ADJ[k].make(p || []) : none); });
        reg.levels = (P) => (P ? levelsFilter(P) : none);
        reg.curves = (P) => (P ? curvesFilter(P) : none);
    }

    const ADJ_LAYERS = [
        ['brightness', 'Brightness/Contrast...'], ['levels', 'Levels...'], ['curves', 'Curves...'], ['exposure', 'Exposure...'], null,
        ['vibrance', 'Vibrance...'], ['hue', 'Hue/Saturation...'], ['balance', 'Color Balance...'], ['bw', 'Black & White...'], ['photo', 'Photo Filter...'], null,
        ['invert', 'Invert'], ['posterize', 'Posterize...'], ['threshold', 'Threshold...'], ['gradmap', 'Gradient Map...']
    ];
    const ADJ_NAMES = { levels: 'Levels', curves: 'Curves' };

    function adjustLayerMenu() {
        return ADJ_LAYERS.map((e) => (e ? { text: e[1], action: `adjlayer-${e[0]}` } : { separator: true }));
    }

    /** The dialog of an adjustment layer: preview(params) live, then done(params) or cancelled(). */
    function adjustLayerDialog(w, kind, params, preview, done, cancelled) {
        if (kind === 'levels') { levels(w, { params, preview, ok: done, cancel: cancelled }); return; }
        if (kind === 'curves') { curves(w, { params, preview, ok: done, cancel: cancelled }); return; }
        const A = ADJ[kind];
        if (!A.fields) { done([]); return; }
        fieldDialog(w, A.label, A.fields(w, params), {
            heavy: false,
            preview,
            unpreview() { preview(params); },
            ok: done,
            cancel: cancelled
        });
    }

    /** Layers > New Adjustment Layer: above the active layer, its mask from the selection. */
    function newAdjustmentLayer(w, kind) {
        const d = w.doc;
        if (w.proSession) { w.status('Finish the open dialog first.'); return; }
        w.commitFloating();
        w.finishText();
        registerAdjusters();
        const name = (ADJ[kind] && ADJ[kind].label) || ADJ_NAMES[kind];
        if (!name) return;
        const sel = d.selection;
        const at = d.active + 1;
        const n = d.layers.filter((x) => x.adjust && x.adjust.kind === kind).length;
        const l = new (C().Layer)(d.width, d.height, `${name} ${n + 1}`);
        l.adjust = { kind, params: null };
        const m = l.addMask('#ffffff');
        if (sel) {
            const mask = maskOf(d, sel);
            const img = m.ctx.getImageData(0, 0, d.width, d.height);
            for (let i = 0; i < mask.length; i += 1) { img.data[i * 4] = mask[i]; img.data[i * 4 + 1] = mask[i]; img.data[i * 4 + 2] = mask[i]; }
            m.ctx.putImageData(img, 0, 0);
        }
        // shown while its dialog is open, then added for real (one history step) on OK
        const prevActive = d.active;
        d.layers.splice(at, 0, l);
        d.active = at;
        d.markDirty();
        if (root.paintLayers) root.paintLayers.refresh(w);
        w.proSession = { adjust: true };
        const drop = () => { d.layers.splice(d.layers.indexOf(l), 1); d.active = prevActive; };
        adjustLayerDialog(w, kind, null, (p) => { l.adjust.params = p; d.markDirty(); }, (p) => {
            w.proSession = null;
            drop();
            l.adjust.params = p;
            structural(w, `New ${name} Layer`, () => { d.layers.splice(at, 0, l); d.active = at; d.editMask = false; d.markDirty(); });
            if (sel) w.setSelection(null);
        }, () => {
            w.proSession = null;
            drop();
            d.markDirty();
            if (root.paintLayers) root.paintLayers.refresh(w);
        });
    }

    /** Double-click an adjustment layer: its dialog again. */
    function editAdjustmentLayer(w) {
        const d = w.doc;
        const l = d.activeLayer;
        if (!l.adjust || w.proSession) return;
        registerAdjusters();
        const before = l.adjust.params ? JSON.parse(JSON.stringify(l.adjust.params)) : null;
        w.proSession = { adjust: true };
        adjustLayerDialog(w, l.adjust.kind, before, (p) => { l.adjust.params = p; d.markDirty(); }, (p) => {
            w.proSession = null;
            l.adjust.params = before;
            structural(w, `Edit ${l.name}`, () => { l.adjust.params = p; d.markDirty(); });
        }, () => {
            w.proSession = null;
            l.adjust.params = before;
            d.markDirty();
        });
    }

    // ---- layer masks and layer styles --------------------------------------------------------

    function structural(w, label, fn) {
        w.commitFloating();
        w.finishText();
        w.doc.snapshotStep(label, fn);
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    /** Layer > Layer Mask > Reveal / Hide All, Reveal / Hide Selection. */
    function addMask(w, how) {
        const d = w.doc;
        const l = d.activeLayer;
        if (l.mask) return;
        const s = d.selection;
        structural(w, 'Add Layer Mask', () => {
            const m = l.addMask(how === 'hide-all' || how === 'reveal-sel' ? '#000000' : '#ffffff');
            if ((how === 'reveal-sel' || how === 'hide-sel') && s) {
                const mask = maskOf(d, s);
                const img = m.ctx.getImageData(0, 0, d.width, d.height);
                for (let i = 0; i < mask.length; i += 1) {
                    const v = how === 'reveal-sel' ? mask[i] : 255 - mask[i];
                    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
                }
                m.ctx.putImageData(img, 0, 0);
            }
            d.editMask = true;
            d.markDirty();
        });
        if (s) w.setSelection(null);
        w.status('The layer mask is selected: black hides, white shows. Click the layer thumbnail to paint the layer.');
    }

    function applyMask(w) {
        const d = w.doc;
        const l = d.activeLayer;
        if (!l.mask) return;
        structural(w, 'Apply Layer Mask', () => {
            const rendered = C().renderLayer({ canvas: l.canvas, mask: l.mask, styles: null }, { x: 0, y: 0, w: d.width, h: d.height });
            l.ctx.clearRect(0, 0, d.width, d.height);
            l.ctx.drawImage(rendered, 0, 0);
            l.mask = null;
            d.editMask = false;
            d.markDirty();
        });
    }

    const STYLE_DEFAULTS = {
        shadow: { on: false, color: '#000000', opacity: 75, angle: 120, distance: 5, size: 5, blend: 'multiply' },
        glow: { on: false, color: '#ffffbe', opacity: 75, size: 10, blend: 'screen' },
        stroke: { on: false, color: '#000000', opacity: 100, size: 3, position: 'outside' }
    };

    /** Layer > Layer Style: Drop Shadow, Outer Glow and Stroke, live on the layer. */
    function layerStyle(w) {
        const d = w.doc;
        const l = d.activeLayer;
        if (w.proSession) { w.status('Finish the open dialog first.'); return; }
        const before = l.styles ? JSON.parse(JSON.stringify(l.styles)) : null;
        const cur = {};
        Object.keys(STYLE_DEFAULTS).forEach((k) => { cur[k] = { ...STYLE_DEFAULTS[k], ...((before && before[k]) || {}) }; });
        // a first style starts from the drawing colour for the stroke (Photoshop uses its own red)
        if (!before) cur.stroke.color = w.fg;
        const build = (v) => ({
            shadow: { on: v[0], color: v[1], opacity: v[2], angle: v[3], distance: v[4], size: v[5], blend: 'multiply' },
            glow: { on: v[6], color: v[7], opacity: v[8], size: v[9], blend: 'screen' },
            stroke: { on: v[11], color: v[12], size: v[13], position: v[14], opacity: v[15] }
        });
        const live = (v) => { l.styles = build(v); d.markDirty(); };
        w.proSession = { style: true };
        fieldDialog(w, `Layer Style - ${l.name}`, [
            { type: 'check', label: '&Drop Shadow', def: cur.shadow.on },
            { type: 'color', label: 'Color', def: cur.shadow.color },
            { type: 'slider', label: 'Opacity', min: 0, max: 100, def: cur.shadow.opacity, unit: '%' },
            { type: 'slider', label: 'Angle', min: -180, max: 180, def: cur.shadow.angle, unit: '\u00b0' },
            { type: 'slider', label: 'Distance', min: 0, max: 100, def: cur.shadow.distance, unit: 'px' },
            { type: 'slider', label: 'Size', min: 0, max: 100, def: cur.shadow.size, unit: 'px' },
            { type: 'check', label: 'Outer &Glow', def: cur.glow.on },
            { type: 'color', label: 'Color', def: cur.glow.color },
            { type: 'slider', label: 'Opacity', min: 0, max: 100, def: cur.glow.opacity, unit: '%' },
            { type: 'slider', label: 'Size', min: 1, max: 100, def: cur.glow.size, unit: 'px' },
            { type: 'column' },
            { type: 'check', label: '&Stroke', def: cur.stroke.on },
            { type: 'color', label: 'Color', def: cur.stroke.color },
            { type: 'slider', label: 'Size', min: 1, max: 50, def: cur.stroke.size, unit: 'px' },
            { type: 'radio', label: 'Position', options: [['outside', 'Outside'], ['inside', 'Inside']], def: cur.stroke.position },
            { type: 'slider', label: 'Opacity', min: 0, max: 100, def: cur.stroke.opacity, unit: '%' }
        ], {
            heavy: true,
            preview: live,
            unpreview() { l.styles = before; d.markDirty(); },
            ok(v) {
                w.proSession = null;
                const after = build(v);
                l.styles = before;
                structural(w, 'Layer Style', () => { l.styles = C().hasEffects({ styles: after }) ? after : null; });
            },
            cancel() { w.proSession = null; l.styles = before; d.markDirty(); }
        });
    }

    // ---- menus --------------------------------------------------------------------------------

    function selectMenu(w) {
        const has = !!(w.doc.selection || w.floating);
        return [
            { text: 'All', subtext: 'Ctrl+A', action: 'select-all' },
            { text: 'Deselect', subtext: 'Ctrl+D', action: 'pro-deselect', disabled: !has },
            { text: 'Reselect', subtext: 'Ctrl+Shift+D', action: 'pro-reselect', disabled: !w.lastSelection },
            { text: 'Inverse', subtext: 'Ctrl+Shift+I', action: 'pro-inverse', disabled: !w.doc.selection },
            { separator: true },
            { text: 'Edit in Quick Mask Mode', subtext: 'Q', action: 'quick-mask', showIndicator: true, checked: !!w.doc.quickMask },
            { separator: true },
            { text: 'Color Range...', action: 'pro-color-range' },
            { separator: true },
            { text: 'Modify', hasSubmenu: true, disabled: !w.doc.selection, submenu: [
                { text: 'Border...', action: 'pro-sel-border' },
                { text: 'Smooth...', action: 'pro-sel-smooth' },
                { text: 'Expand...', action: 'pro-sel-expand' },
                { text: 'Contract...', action: 'pro-sel-contract' },
                { text: 'Feather...', subtext: 'Shift+F6', action: 'pro-sel-feather' }
            ] },
            { separator: true },
            { text: 'Transform Selection Contents', subtext: 'Ctrl+T', action: 'free-transform', disabled: !w.doc.selection }
        ];
    }

    function adjustMenu() {
        return [
            { text: 'Auto Tone', subtext: 'Ctrl+Shift+L', action: 'pro-auto-tone' },
            { text: 'Auto Contrast', subtext: 'Ctrl+Alt+Shift+L', action: 'adj-autolevel' },
            { text: 'Auto Color', subtext: 'Ctrl+Shift+B', action: 'pro-auto-color' },
            { separator: true },
            { text: 'Brightness / Contrast...', action: 'adj-brightness' },
            { text: 'Levels...', subtext: 'Ctrl+L', action: 'pro-levels' },
            { text: 'Curves...', subtext: 'Ctrl+M', action: 'pro-curves' },
            { text: 'Exposure...', action: 'pro-exposure' },
            { separator: true },
            { text: 'Vibrance...', action: 'pro-vibrance' },
            { text: 'Hue / Saturation...', subtext: 'Ctrl+U', action: 'adj-hue' },
            { text: 'Color Balance...', subtext: 'Ctrl+B', action: 'pro-color-balance' },
            { text: 'Black and White', subtext: 'Ctrl+Shift+U', action: 'adj-bw' },
            { text: 'Photo Filter...', action: 'pro-photo-filter' },
            { text: 'Sepia', action: 'adj-sepia' },
            { separator: true },
            { text: 'Invert Colors', subtext: 'Ctrl+I', action: 'invert' },
            { text: 'Posterize...', action: 'adj-posterize' },
            { text: 'Threshold...', action: 'pro-threshold' },
            { text: 'Gradient Map...', action: 'pro-gradient-map' },
            { separator: true },
            { text: 'Equalize', action: 'pro-equalize' }
        ];
    }

    function filterMenu(w) {
        const last = w.lastFilter;
        return [
            { text: last ? `Last Filter (${last.label})` : 'Last Filter', subtext: 'Ctrl+Alt+F', action: 'pro-last-filter', disabled: !last },
            { separator: true },
            { text: 'Blur', hasSubmenu: true, submenu: [
                { text: 'Blur', action: 'adj-blur' },
                { text: 'Box Blur...', action: 'pro-box-blur' },
                { text: 'Gaussian Blur...', action: 'pro-gaussian' },
                { text: 'Motion Blur...', action: 'pro-motion' }
            ] },
            { text: 'Distort', hasSubmenu: true, submenu: [
                { text: 'Pinch...', action: 'pro-pinch' },
                { text: 'Twirl...', action: 'pro-twirl' }
            ] },
            { text: 'Noise', hasSubmenu: true, submenu: [
                { text: 'Add Noise...', action: 'pro-noise' },
                { text: 'Despeckle', action: 'pro-despeckle' },
                { text: 'Median...', action: 'pro-median' }
            ] },
            { text: 'Pixelate', hasSubmenu: true, submenu: [
                { text: 'Mosaic...', action: 'pro-mosaic' }
            ] },
            { text: 'Render', hasSubmenu: true, submenu: [
                { text: 'Clouds', action: 'pro-clouds' }
            ] },
            { text: 'Sharpen', hasSubmenu: true, submenu: [
                { text: 'Sharpen', action: 'adj-sharpen' },
                { text: 'Sharpen More', action: 'pro-sharpen-more' },
                { text: 'Unsharp Mask...', action: 'pro-unsharp' }
            ] },
            { text: 'Stylize', hasSubmenu: true, submenu: [
                { text: 'Emboss...', action: 'pro-emboss' },
                { text: 'Find Edges', action: 'pro-find-edges' },
                { text: 'Solarize', action: 'pro-solarize' }
            ] },
            { text: 'Other', hasSubmenu: true, submenu: [
                { text: 'High Pass...', action: 'pro-high-pass' }
            ] }
        ];
    }

    // ---- actions ------------------------------------------------------------------------------

    function action(w, a) {
        const d = w.doc;
        switch (a) {
            case 'pro-deselect': w.commitFloating(); setSel(w, null); return true;
            case 'pro-reselect': if (w.lastSelection) { w.commitFloating(); w.setSelection(w.lastSelection); } return true;
            case 'pro-inverse': if (d.selection) setSel(w, invert(d, d.selection)); return true;
            case 'pro-color-range': w.commitFloating(); colorRangeDialog(w); return true;
            case 'pro-sel-border': modifyDialog(w, 'Border Selection', 'Width', 200, border); return true;
            case 'pro-sel-smooth': modifyDialog(w, 'Smooth Selection', 'Sample Radius', 100, smooth); return true;
            case 'pro-sel-expand': modifyDialog(w, 'Expand Selection', 'Expand By', 100, (dd, s, v) => morph(dd, s, v)); return true;
            case 'pro-sel-contract': modifyDialog(w, 'Contract Selection', 'Contract By', 100, (dd, s, v) => morph(dd, s, -v)); return true;
            case 'pro-sel-feather': modifyDialog(w, 'Feather Selection', 'Feather Radius', 250, feather); return true;
            case 'pro-fill': fill(w); return true;
            case 'pro-stroke': w.commitFloating(); stroke(w); return true;
            case 'pro-levels': levels(w); return true;
            case 'pro-curves': curves(w); return true;
            case 'pro-exposure': exposure(w); return true;
            case 'pro-vibrance': vibrance(w); return true;
            case 'pro-color-balance': colorBalance(w); return true;
            case 'pro-photo-filter': photoFilter(w); return true;
            case 'pro-gradient-map': gradientMap(w); return true;
            case 'pro-threshold': threshold(w); return true;
            case 'pro-equalize': equalize(w); return true;
            case 'pro-auto-tone': autoTone(w, true, 'Auto Tone'); return true;
            case 'pro-auto-color': autoTone(w, true, 'Auto Color'); return true;
            case 'pro-gaussian': filterDialog(w, 'Gaussian Blur', [{ type: 'slider', label: 'Radius', min: 0.1, max: 100, def: 2, scale: 10, unit: 'pixels' }], ([r]) => (img) => gaussian(img, r), { pad: 120 }); return true;
            case 'pro-box-blur': filterDialog(w, 'Box Blur', [{ type: 'slider', label: 'Radius', min: 1, max: 100, def: 5, unit: 'pixels' }], ([r]) => (img) => boxBlur(img, r), { pad: 110 }); return true;
            case 'pro-motion': filterDialog(w, 'Motion Blur', [{ type: 'slider', label: 'Angle', min: -90, max: 90, def: 0, unit: '\u00b0' }, { type: 'slider', label: 'Distance', min: 1, max: 200, def: 10, unit: 'pixels' }], ([ang, dist]) => (img) => motion(img, ang, dist), { pad: 200 }); return true;
            case 'pro-unsharp': filterDialog(w, 'Unsharp Mask', [{ type: 'slider', label: 'Amount', min: 1, max: 500, def: 50, unit: '%' }, { type: 'slider', label: 'Radius', min: 0.1, max: 50, def: 1, scale: 10, unit: 'pixels' }, { type: 'slider', label: 'Threshold', min: 0, max: 255, def: 0, unit: 'levels' }], ([am, r, t]) => (img) => unsharp(img, am, r, t), { pad: 60 }); return true;
            case 'pro-high-pass': filterDialog(w, 'High Pass', [{ type: 'slider', label: 'Radius', min: 0.1, max: 100, def: 10, scale: 10, unit: 'pixels' }], ([r]) => (img) => highPass(img, r), { pad: 120 }); return true;
            case 'pro-noise': filterDialog(w, 'Add Noise', [{ type: 'slider', label: 'Amount', min: 1, max: 400, def: 12, scale: 10, unit: '%' }, { type: 'radio', label: 'Distribution', options: [['u', 'Uniform'], ['g', 'Gaussian']], def: 'g' }, { type: 'check', label: '&Monochromatic', def: false }], ([am, dist, mono]) => (img) => addNoise(img, am, dist === 'g', mono)); return true;
            case 'pro-median': filterDialog(w, 'Median', [{ type: 'slider', label: 'Radius', min: 1, max: 5, def: 1, unit: 'pixels' }], ([r]) => (img) => median(img, r), { pad: 6 }); return true;
            case 'pro-despeckle': filterNow(w, 'Despeckle', (img) => median(img, 1), 2); return true;
            case 'pro-mosaic': filterDialog(w, 'Mosaic', [{ type: 'slider', label: 'Cell Size', min: 2, max: 200, def: 10, unit: 'square' }], ([c]) => (img, inf) => mosaic(img, c, inf)); return true;
            case 'pro-emboss': filterDialog(w, 'Emboss', [{ type: 'slider', label: 'Angle', min: -180, max: 180, def: 135, unit: '\u00b0' }, { type: 'slider', label: 'Height', min: 1, max: 10, def: 3, unit: 'pixels' }, { type: 'slider', label: 'Amount', min: 1, max: 500, def: 100, unit: '%' }], ([a2, h, am]) => (img) => emboss(img, a2, h, am), { pad: 12 }); return true;
            case 'pro-find-edges': filterNow(w, 'Find Edges', findEdges, 2); return true;
            case 'pro-solarize': filterNow(w, 'Solarize', perPixel((r, g, b) => [r > 127 ? 255 - r : r, g > 127 ? 255 - g : g, b > 127 ? 255 - b : b])); return true;
            case 'pro-sharpen-more': filterNow(w, 'Sharpen More', (img) => convolve3(img, [-1, -1, -1, -1, 9, -1, -1, -1, -1], 1), 2); return true;
            case 'pro-twirl': filterDialog(w, 'Twirl', [{ type: 'slider', label: 'Angle', min: -999, max: 999, def: 50, unit: '\u00b0' }], ([ang]) => (img, inf) => twirl(img, inf, ang)); return true;
            case 'pro-pinch': filterDialog(w, 'Pinch', [{ type: 'slider', label: 'Amount', min: -100, max: 100, def: 50, unit: '%' }], ([am]) => (img, inf) => pinch(img, inf, am)); return true;
            case 'pro-clouds': {
                const seed = Math.floor(Math.random() * 1e9);
                filterNow(w, 'Clouds', (img, inf) => cloudsFilter(img, inf, C().parseColor(w.fg), C().parseColor(w.bg), seed));
                return true;
            }
            case 'pro-last-filter': {
                const lf = w.lastFilter;
                if (!lf) return true;
                const S = session(w, lf.label, lf.pad, { smart: true });
                if (!S) return true;
                S.write(lf.make(lf.vals)(S.copy(), S.info, lf.vals));
                w.filterAction = lf.id;
                smartKeep(w, S, lf.label, lf.make, lf.vals, lf.pad);
                S.commit();
                return true;
            }
            case 'mask-reveal-all': addMask(w, 'reveal-all'); return true;
            case 'mask-hide-all': addMask(w, 'hide-all'); return true;
            case 'mask-reveal-sel': addMask(w, 'reveal-sel'); return true;
            case 'mask-hide-sel': addMask(w, 'hide-sel'); return true;
            case 'mask-edit': if (d.activeLayer.mask) { d.editMask = !d.editMask; if (root.paintLayers) root.paintLayers.refresh(w); } return true;
            case 'mask-toggle': if (d.activeLayer.mask) structural(w, d.activeLayer.mask.enabled ? 'Disable Layer Mask' : 'Enable Layer Mask', () => { d.activeLayer.mask.enabled = !d.activeLayer.mask.enabled; d.markDirty(); }); return true;
            case 'mask-apply': applyMask(w); return true;
            case 'mask-delete': if (d.activeLayer.mask) structural(w, 'Delete Layer Mask', () => { d.activeLayer.mask = null; d.editMask = false; d.markDirty(); }); return true;
            case 'layer-style': layerStyle(w); return true;
            case 'style-copy': w.styleClip = JSON.parse(JSON.stringify(d.activeLayer.styles)); return true;
            case 'style-paste': if (w.styleClip) structural(w, 'Paste Layer Style', () => { d.activeLayer.styles = JSON.parse(JSON.stringify(w.styleClip)); d.markDirty(); }); return true;
            case 'style-clear': structural(w, 'Clear Layer Style', () => { d.activeLayer.styles = null; d.markDirty(); }); return true;
            case 'adjlayer-edit': editAdjustmentLayer(w); return true;
            case 'pro-navigator': toggleNavigator(w); return true;
            case 'pro-info': toggleInfo(w); return true;
            default:
                if (a.startsWith('adjlayer-')) { newAdjustmentLayer(w, a.slice(9)); return true; }
                return false;
        }
    }

    registerAdjusters();

    root.paintPro = {
        maskOf, fromMask, combine, maskCanvas, outline, morph, feather, invert, heal,
        session, filterDialog, fieldDialog, gaussian, curveLut, levelsLut,
        selectMenu, adjustMenu, filterMenu, adjustLayerMenu, registerAdjusters, adjustPixels, action, ADJ,
        toggleNavigator, toggleInfo, navOpen, infoOpen, navRefresh, navBox, info
    };
})(typeof window !== 'undefined' ? window : globalThis);
