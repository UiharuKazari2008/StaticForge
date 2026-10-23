/**
 * Paint's content-aware tools and warps (Yozora #632), Photoshop's:
 *
 *   Edit > Content-Aware Fill       the selection filled from the picture round it (paintPro.heal)
 *   Content-Aware Move tool (J)     drag a selection: it moves, and where it was is filled
 *   Patch tool (J)                  drag a selection onto good pixels: they come back into it,
 *                                   corrected to its colours (the healing brush's way)
 *   Edit > Transform > Distort / Perspective / Warp, Edit > Puppet Warp
 *                                   the layer (or the selection) on a mesh: four corners, a 4 x 4
 *                                   Bezier grid, or pins that bend it as rigidly as they can (MLS)
 *   Filter > Liquify (Shift+Ctrl+X) Forward Warp, Reconstruct, Twirl, Pucker, Bloat on a
 *                                   displacement field, in its own full window
 *
 *   paintWarp.start(w, kind) / commit(w) / cancel(w) / pointer(w, kind, ev, p) / svg(w, z)
 *   paintWarp.liquify(w) / contentAwareFill(w) / action(w, a); T (the two tools)
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const P = () => root.paintPro;
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    // ---- content-aware ---------------------------------------------------------------------------

    function selMask(w) {
        const d = w.doc;
        return d.selection && P() ? P().maskOf(d, d.selection) : null;
    }

    /** Edit > Content-Aware Fill: the selected part made again from what is round it. */
    function contentAwareFill(w) {
        const d = w.doc;
        const m = selMask(w);
        if (!m) { w.status('Select the part to fill first.'); return; }
        if (!w.editable()) return;
        const l = d.layer;
        const step = d.beginStep('Content-Aware Fill', l);
        const r = P().heal(d, l, m);
        if (!r) { step.backup = null; w.status('Nothing round the selection to fill it from.'); return; }
        step.grow(r);
        d.commitStep(step);
    }

    /**
     * The pixels at (dx, dy) laid into the masked area, corrected so they meet its border: the
     * difference along the edge (just outside the selection) spread inwards, nearer edges weighing
     * more (a membrane, as the healing tools do). Returns the changed box.
     */
    function patchInto(d, l, m, dx, dy) {
        const W = d.width;
        const H = d.height;
        const sel = P().fromMask(m, W, H);
        if (!sel) return null;
        const pad = 2;
        const box = C().clampRect({ x: sel.x - pad, y: sel.y - pad, w: sel.w + 2 * pad, h: sel.h + 2 * pad }, W, H);
        const src = C().clampRect({ x: box.x + dx, y: box.y + dy, w: box.w, h: box.h }, W, H);
        if (!src || src.w !== box.w || src.h !== box.h) return null;
        const T = l.ctx.getImageData(box.x, box.y, box.w, box.h);
        const S = l.ctx.getImageData(src.x, src.y, src.w, src.h);
        const bw = box.w;
        const mk = (x, y) => m[(box.y + y) * W + box.x + x];
        // the edge: unselected pixels touching the selection
        const edge = [];
        for (let y = 0; y < box.h; y += 1) {
            for (let x = 0; x < bw; x += 1) {
                if (mk(x, y)) continue;
                let near = false;
                for (let k = -1; k <= 1 && !near; k += 1) for (let j = -1; j <= 1 && !near; j += 1) { const xx = x + j; const yy = y + k; if (xx >= 0 && yy >= 0 && xx < bw && yy < box.h && mk(xx, yy)) near = true; }
                if (near) { const o = (y * bw + x) * 4; edge.push([x, y, T.data[o] - S.data[o], T.data[o + 1] - S.data[o + 1], T.data[o + 2] - S.data[o + 2], T.data[o + 3] - S.data[o + 3]]); }
            }
        }
        if (!edge.length) return null;
        const stepE = Math.max(1, Math.floor(edge.length / 240));
        const pts = edge.filter((_, i) => i % stepE === 0);
        const o = T.data;
        for (let y = 0; y < box.h; y += 1) {
            for (let x = 0; x < bw; x += 1) {
                const mv = mk(x, y);
                if (!mv) continue;
                let sw = 0; const acc = [0, 0, 0, 0];
                for (const q of pts) {
                    const dd = (q[0] - x) ** 2 + (q[1] - y) ** 2;
                    const wt = 1 / (dd * dd + 1e-6);
                    sw += wt; acc[0] += q[2] * wt; acc[1] += q[3] * wt; acc[2] += q[4] * wt; acc[3] += q[5] * wt;
                }
                const i = (y * bw + x) * 4;
                const k = mv / 255;
                for (let c = 0; c < 4; c += 1) o[i + c] += (S.data[i + c] + acc[c] / sw - o[i + c]) * k;
            }
        }
        l.ctx.putImageData(T, box.x, box.y);
        d.markDirty(box);
        return box;
    }

    /** The selection's mask moved by dx, dy (pixels that leave the picture drop off). */
    function shiftMask(m, W, H, dx, dy) {
        const out = new Uint8Array(W * H);
        for (let y = 0; y < H; y += 1) {
            const sy = y - dy;
            if (sy < 0 || sy >= H) continue;
            for (let x = 0; x < W; x += 1) {
                const sx = x - dx;
                if (sx >= 0 && sx < W) out[y * W + x] = m[sy * W + sx];
            }
        }
        return out;
    }

    /** A drag of the selection for the two tools: its outline follows, the picture waits for the release. */
    function dragTool(kind) {
        return {
            down(p, ev) {
                if (!this.doc.selection) { this.tools.freeselect.down.call(this, p, ev); this.caLasso = true; return; }
                this.caDrag = { start: p, at: p, sel: this.doc.selection };
            },
            move(p, ev, down) {
                if (this.caLasso) { this.tools.freeselect.move.call(this, p, ev, down); return; }
                const g = this.caDrag;
                if (!g || !down) return;
                g.at = p;
                const dx = Math.round(p.x - g.start.x);
                const dy = Math.round(p.y - g.start.y);
                // the outline at its new place, and (Move) the pixels there as they would land
                this.clearOverlay();
                if (kind === 'move') {
                    const c = this.selectionCanvas(false);
                    if (c) { this.octx.globalAlpha = 0.85; this.octx.drawImage(c, g.sel.x + dx, g.sel.y + dy); this.octx.globalAlpha = 1; }
                } else {
                    const c = C().makeCanvas(g.sel.w, g.sel.h);
                    c.getContext('2d').drawImage(this.doc.layer.canvas, g.sel.x + dx, g.sel.y + dy, g.sel.w, g.sel.h, 0, 0, g.sel.w, g.sel.h);
                    this.octx.globalAlpha = 0.85;
                    this.octx.drawImage(c, g.sel.x, g.sel.y);
                    this.octx.globalAlpha = 1;
                }
                this.status(`${kind === 'move' ? 'Move' : 'Source'}: ${dx}, ${dy}`);
            },
            up(p, ev) {
                if (this.caLasso) { this.caLasso = false; this.tools.freeselect.up.call(this, p, ev); return; }
                const g = this.caDrag;
                this.caDrag = null;
                this.clearOverlay();
                if (!g) return;
                const dx = Math.round(g.at.x - g.start.x);
                const dy = Math.round(g.at.y - g.start.y);
                if (!dx && !dy) return;
                if (!this.editable()) return;
                const d = this.doc;
                const l = d.layer;
                const m = P().maskOf(d, g.sel);
                const label = kind === 'move' ? 'Content-Aware Move' : 'Patch';
                const step = d.beginStep(label, l);
                if (kind === 'move') {
                    // the piece, cut out with a soft edge, then the hole filled, then the piece laid down
                    const piece = C().makeCanvas(d.width, d.height);
                    const px = piece.getContext('2d');
                    px.drawImage(l.canvas, 0, 0);
                    px.globalCompositeOperation = 'destination-in';
                    px.drawImage(P().maskCanvas(d, g.sel), 0, 0);
                    P().heal(d, l, m);
                    l.ctx.drawImage(piece, dx, dy);
                    this.setSelection(P().fromMask(shiftMask(m, d.width, d.height, dx, dy), d.width, d.height));
                } else {
                    patchInto(d, l, m, dx, dy);
                }
                step.grow({ x: 0, y: 0, w: d.width, h: d.height });
                d.commitStep(step);
                this.status();
            }
        };
    }

    // ---- mesh warps ------------------------------------------------------------------------------

    /** Heckbert's square-to-quad: (u, v) in 0-1 to the quad tl, tr, br, bl. */
    function quadMap(q) {
        const [p0, p1, p2, p3] = q;
        const dx1 = p1.x - p2.x; const dx2 = p3.x - p2.x; const dx3 = p0.x - p1.x + p2.x - p3.x;
        const dy1 = p1.y - p2.y; const dy2 = p3.y - p2.y; const dy3 = p0.y - p1.y + p2.y - p3.y;
        const den = dx1 * dy2 - dx2 * dy1 || 1e-9;
        const g = (dx3 * dy2 - dx2 * dy3) / den;
        const h = (dx1 * dy3 - dx3 * dy1) / den;
        const a = p1.x - p0.x + g * p1.x; const b = p3.x - p0.x + h * p3.x; const c = p0.x;
        const dd = p1.y - p0.y + g * p1.y; const e = p3.y - p0.y + h * p3.y; const f = p0.y;
        return (u, v) => { const z = g * u + h * v + 1; return { x: (a * u + b * v + c) / z, y: (dd * u + e * v + f) / z }; };
    }

    const bern = (t) => { const s = 1 - t; return [s * s * s, 3 * s * s * t, 3 * s * t * t, t * t * t]; };

    function bezierMap(P4) {
        return (u, v) => {
            const bu = bern(u); const bv = bern(v);
            let x = 0; let y = 0;
            for (let j = 0; j < 4; j += 1) for (let i = 0; i < 4; i += 1) { const k = bu[i] * bv[j]; x += P4[j * 4 + i].x * k; y += P4[j * 4 + i].y * k; }
            return { x, y };
        };
    }

    /** Puppet Warp: rigid moving least squares over the pins (from -> to). */
    function puppetMap(pins, box) {
        return (u, v) => {
            const vx = box.x + u * box.w;
            const vy = box.y + v * box.h;
            if (!pins.length) return { x: vx, y: vy };
            let sw = 0; let px = 0; let py = 0; let qx = 0; let qy = 0;
            const ws = [];
            for (const pin of pins) {
                const d2 = (pin.fx - vx) ** 2 + (pin.fy - vy) ** 2;
                if (d2 < 1e-6) return { x: pin.x, y: pin.y };
                const wt = 1 / d2;
                ws.push(wt);
                sw += wt; px += pin.fx * wt; py += pin.fy * wt; qx += pin.x * wt; qy += pin.y * wt;
            }
            px /= sw; py /= sw; qx /= sw; qy /= sw;
            let num = 0; let den = 0;
            pins.forEach((pin, i) => {
                const ax = pin.fx - px; const ay = pin.fy - py; const bx = pin.x - qx; const by = pin.y - qy;
                num += ws[i] * (ax * by - ay * bx);
                den += ws[i] * (ax * bx + ay * by);
            });
            const th = pins.length > 1 ? Math.atan2(num, den) : 0;
            const c = Math.cos(th); const s = Math.sin(th);
            const lx = vx - px; const ly = vy - py;
            return { x: qx + lx * c - ly * s, y: qy + lx * s + ly * c };
        };
    }

    /** The source laid through map on an n x n mesh: each cell two triangles, each an affine draw. */
    function drawMesh(ctx, src, map, n) {
        const pts = [];
        for (let j = 0; j <= n; j += 1) for (let i = 0; i <= n; i += 1) pts.push(map(i / n, j / n));
        const sw = src.width; const sh = src.height;
        const tri = (s0, s1, s2, d0, d1, d2) => {
            const sx1 = s1.x - s0.x; const sy1 = s1.y - s0.y; const sx2 = s2.x - s0.x; const sy2 = s2.y - s0.y;
            const det = sx1 * sy2 - sx2 * sy1;
            if (!det) return;
            const dx1 = d1.x - d0.x; const dy1 = d1.y - d0.y; const dx2 = d2.x - d0.x; const dy2 = d2.y - d0.y;
            const a = (dx1 * sy2 - dx2 * sy1) / det; const c = (dx2 * sx1 - dx1 * sx2) / det;
            const b = (dy1 * sy2 - dy2 * sy1) / det; const dd = (dy2 * sx1 - dy1 * sx2) / det;
            const e = d0.x - a * s0.x - c * s0.y; const f = d0.y - b * s0.x - dd * s0.y;
            // the triangle a little bigger round its middle, so neighbours leave no hairline gap
            const mx = (d0.x + d1.x + d2.x) / 3; const my = (d0.y + d1.y + d2.y) / 3;
            const grow = (q) => { const L = Math.hypot(q.x - mx, q.y - my) || 1; return { x: q.x + ((q.x - mx) / L) * 0.6, y: q.y + ((q.y - my) / L) * 0.6 }; };
            const g0 = grow(d0); const g1 = grow(d1); const g2 = grow(d2);
            ctx.save();
            ctx.beginPath(); ctx.moveTo(g0.x, g0.y); ctx.lineTo(g1.x, g1.y); ctx.lineTo(g2.x, g2.y); ctx.closePath(); ctx.clip();
            ctx.setTransform(a, b, c, dd, e, f);
            ctx.drawImage(src, 0, 0);
            ctx.restore();
        };
        for (let j = 0; j < n; j += 1) {
            for (let i = 0; i < n; i += 1) {
                const s00 = { x: (i / n) * sw, y: (j / n) * sh }; const s10 = { x: ((i + 1) / n) * sw, y: (j / n) * sh };
                const s01 = { x: (i / n) * sw, y: ((j + 1) / n) * sh }; const s11 = { x: ((i + 1) / n) * sw, y: ((j + 1) / n) * sh };
                const k = j * (n + 1) + i;
                const d00 = pts[k]; const d10 = pts[k + 1]; const d01 = pts[k + n + 1]; const d11 = pts[k + n + 2];
                tri(s00, s10, s11, d00, d10, d11);
                tri(s00, s11, s01, d00, d11, d01);
            }
        }
    }

    function mapOf(wp) {
        if (wp.kind === 'warp') return bezierMap(wp.grid);
        if (wp.kind === 'puppet') return puppetMap(wp.pins, wp.box);
        return quadMap(wp.quad);
    }

    const TITLES = { distort: 'Distort', perspective: 'Perspective', warp: 'Warp', puppet: 'Puppet Warp' };

    /** Edit > Transform > Distort / Perspective / Warp, Edit > Puppet Warp. */
    function start(w, kind) {
        if (w.warp) return;
        const l = w.doc.layer;
        // a Smart Object or a shape becomes pixels (Photoshop warps smart objects too; Paint cannot yet)
        if (l.smart && root.paintSmart) root.paintSmart.rasterize(w, l, true);
        if (l.vector && root.paintPath) root.paintPath.rasterize(w, l, true);
        w.startTransform();
        const t = w.xf;
        if (!t) return;
        w.xf = null;
        const box = { x: t.x0, y: t.y0, w: t.w, h: t.h };
        const wp = { kind, src: t.src, box, t, n: 16 };
        if (kind === 'warp') {
            wp.grid = [];
            for (let j = 0; j < 4; j += 1) for (let i = 0; i < 4; i += 1) wp.grid.push({ x: box.x + (box.w * i) / 3, y: box.y + (box.h * j) / 3 });
        } else if (kind === 'puppet') {
            wp.pins = [];
        } else {
            wp.quad = [{ x: box.x, y: box.y }, { x: box.x + box.w, y: box.y }, { x: box.x + box.w, y: box.y + box.h }, { x: box.x, y: box.y + box.h }];
        }
        w.warp = wp;
        draw(w);
        w.renderBar();
        w.status(`${TITLES[kind]}: ${kind === 'puppet' ? 'click to add pins, drag them to bend; Alt+click removes one.' : 'drag the points.'} Enter applies, Esc cancels.`);
    }

    function draw(w) {
        const wp = w.warp;
        if (!wp) return;
        w.clearOverlay();
        drawMesh(w.octx, wp.src, mapOf(wp), wp.n);
        w.drawAnts();
    }

    function commit(w) {
        const wp = w.warp;
        if (!wp) return false;
        w.warp = null;
        w.clearOverlay();
        const l = w.doc.layer;
        l.ctx.save();
        l.ctx.imageSmoothingEnabled = true;
        l.ctx.imageSmoothingQuality = 'high';
        drawMesh(l.ctx, wp.src, mapOf(wp), 40);
        l.ctx.restore();
        wp.t.step.label = TITLES[wp.kind];
        wp.t.step.grow({ x: 0, y: 0, w: w.doc.width, h: w.doc.height });
        w.doc.commitStep(wp.t.step);
        w.doc.markDirty();
        w.drawAnts();
        w.renderBar();
        w.status();
        return true;
    }

    function cancel(w) {
        const wp = w.warp;
        if (!wp) return false;
        w.warp = null;
        // Free Transform's cancel puts the pixels (and the selection or piece) back
        w.xf = wp.t;
        w.cancelTransform();
        w.renderBar();
        return true;
    }

    function handles(wp) {
        if (wp.kind === 'warp') return wp.grid;
        if (wp.kind === 'puppet') return wp.pins;
        return wp.quad;
    }

    function pointer(w, kind, ev, p) {
        const wp = w.warp;
        const tol = 7 / w.zoom;
        const hs = handles(wp);
        const at = hs.findIndex((h) => Math.abs(h.x - p.x) <= tol && Math.abs(h.y - p.y) <= tol);
        if (kind === 'down') {
            if (ev.button !== 0) return;
            w.overlay.setPointerCapture(ev.pointerId);
            if (wp.kind === 'puppet') {
                if (at >= 0 && ev.altKey) { wp.pins.splice(at, 1); draw(w); return; }
                if (at < 0) {
                    // a new pin where it is now: its place on the source is found back through the mesh
                    const m = mapOf(wp);
                    let best = null;
                    for (let j = 0; j <= 32; j += 1) {
                        for (let i = 0; i <= 32; i += 1) {
                            const q = m(i / 32, j / 32);
                            const dd = (q.x - p.x) ** 2 + (q.y - p.y) ** 2;
                            if (!best || dd < best.dd) best = { dd, u: i / 32, v: j / 32 };
                        }
                    }
                    if (!best || best.dd > (20 / w.zoom) ** 2) return;
                    const pin = { fx: wp.box.x + best.u * wp.box.w, fy: wp.box.y + best.v * wp.box.h, x: p.x, y: p.y };
                    wp.pins.push(pin);
                    wp.drag = { i: wp.pins.length - 1 };
                    draw(w);
                    return;
                }
            }
            if (at >= 0) wp.drag = { i: at };
            return;
        }
        if (kind === 'move') {
            w.overlay.style.cursor = at >= 0 ? 'move' : wp.kind === 'puppet' ? 'crosshair' : '';
            const g = wp.drag;
            if (!g) return;
            const h = hs[g.i];
            const dx = p.x - h.x; const dy = p.y - h.y;
            h.x = p.x; h.y = p.y;
            // Perspective: the corner beside it moves the other way (the edge stays straight and even)
            if (wp.kind === 'perspective') {
                const pair = { 0: 1, 1: 0, 2: 3, 3: 2 }[g.i];
                const vertical = Math.abs(dy) > Math.abs(dx);
                const o = wp.quad[vertical ? { 0: 3, 3: 0, 1: 2, 2: 1 }[g.i] : pair];
                if (vertical) { h.x -= dx; o.y -= dy; } else { h.y -= dy; o.x -= dx; }
            }
            draw(w);
            return;
        }
        if (kind === 'up') wp.drag = null;
        if (kind === 'dbl') commit(w);
    }

    function svg(w, z) {
        const wp = w.warp;
        if (!wp) return '';
        let html = '';
        const m = mapOf(wp);
        // the mesh's lines (every fourth cell), then the handles
        const lines = [];
        const N = wp.kind === 'warp' ? 3 : 8;
        for (let k = 0; k <= N; k += 1) {
            let a = ''; let b = '';
            for (let s = 0; s <= 24; s += 1) {
                const p1 = m(k / N, s / 24); const p2 = m(s / 24, k / N);
                a += `${s ? 'L' : 'M'}${(p1.x * z).toFixed(1)},${(p1.y * z).toFixed(1)}`;
                b += `${s ? 'L' : 'M'}${(p2.x * z).toFixed(1)},${(p2.y * z).toFixed(1)}`;
            }
            lines.push(a, b);
        }
        html += `<path class="mp-warp-mesh" d="${lines.join('')}"/>`;
        if (wp.kind === 'puppet') html += wp.pins.map((q) => `<circle class="mp-warp-pin" cx="${q.x * z}" cy="${q.y * z}" r="4"/>`).join('');
        else html += w.handleMarks(handles(wp).map((q) => [q.x * z, q.y * z]));
        return html;
    }

    // ---- Liquify ---------------------------------------------------------------------------------

    function bilinear(a, W, H, x, y) {
        if (x < 0) x = 0; else if (x > W - 1) x = W - 1;
        if (y < 0) y = 0; else if (y > H - 1) y = H - 1;
        const x0 = x | 0; const y0 = y | 0;
        const x1 = Math.min(W - 1, x0 + 1); const y1 = Math.min(H - 1, y0 + 1);
        const fx = x - x0; const fy = y - y0;
        return (a[y0 * W + x0] * (1 - fx) + a[y0 * W + x1] * fx) * (1 - fy) + (a[y1 * W + x0] * (1 - fx) + a[y1 * W + x1] * fx) * fy;
    }

    const LQ_TOOLS = [
        ['warp', 'Forward Warp Tool (W)', 'w'], ['reconstruct', 'Reconstruct Tool (R)', 'r'], ['twirl', 'Twirl Clockwise Tool (C)', 'c'],
        ['pucker', 'Pucker Tool (S)', 's'], ['bloat', 'Bloat Tool (B)', 'b']
    ];

    /** Filter > Liquify: its own window over Paint's, with the layer to push about. */
    function liquify(w) {
        if (w.liquifyOpen) return;
        w.finishText();
        w.commitFloating();
        if (!w.editable()) return;
        const d = w.doc;
        const W = d.width;
        const H = d.height;
        const l = d.layer;
        const orig = l.ctx.getImageData(0, 0, W, H);
        const out = new ImageData(new Uint8ClampedArray(orig.data), W, H);
        const fx = new Float32Array(W * H);
        const fy = new Float32Array(W * H);
        const mask = selMask(w);
        const st = { tool: 'warp', size: 100, pressure: 50, rate: 80, mesh: false };
        w.liquifyOpen = true;
        const host = w.modal.querySelector('.mp-body') || w.modal;
        const box = doc.createElement('div');
        box.className = 'mp-liquify';
        box.innerHTML = `
            <div class="mp-lq-tools" role="toolbar">${LQ_TOOLS.map(([id, t], i) => `<button type="button" class="mp-lq-tool${i ? '' : ' is-on'}" data-t="${id}" title="${esc(t)}"><span class="mp-lq-art" style="--i:${i}"></span></button>`).join('')}</div>
            <div class="mp-lq-stage"><canvas class="mp-lq-view" width="${W}" height="${H}"></canvas><canvas class="mp-lq-ring" width="${W}" height="${H}"></canvas></div>
            <div class="mp-lq-side">
                <fieldset><legend>Tool Options</legend>
                    ${[['size', 'Brush Size:', 1, 1500], ['pressure', 'Brush Pressure:', 1, 100], ['rate', 'Brush Rate:', 1, 100]].map(([k, t, a, b]) => `<label>${t}<input type="number" class="tbp-edit" data-k="${k}" min="${a}" max="${b}" value="${st[k]}"></label>`).join('')}
                </fieldset>
                <fieldset><legend>Reconstruct Options</legend><button type="button" class="mp-lq-restore">Restore All</button></fieldset>
                <fieldset><legend>View Options</legend><label class="mp-lq-check"><input type="checkbox" data-k="mesh"> Show Mesh</label></fieldset>
                <div class="mp-lq-ok"><button type="button" class="mp-lq-commit">OK</button><button type="button" class="mp-lq-cancel">Cancel</button></div>
            </div>`;
        host.appendChild(box);
        const view = box.querySelector('.mp-lq-view');
        const ring = box.querySelector('.mp-lq-ring');
        const vx = view.getContext('2d');
        const rx = ring.getContext('2d');
        // the picture fits the stage
        const fit = () => {
            const s = box.querySelector('.mp-lq-stage');
            const k = Math.min(1, (s.clientWidth - 16) / W, (s.clientHeight - 16) / H);
            [view, ring].forEach((c) => { c.style.width = `${W * k}px`; c.style.height = `${H * k}px`; });
        };
        fit();
        vx.putImageData(out, 0, 0);
        const src = orig.data;
        const chan = [0, 1, 2, 3].map((c) => { const a = new Float32Array(W * H); for (let i = 0; i < W * H; i += 1) a[i] = src[i * 4 + c]; return a; });

        const renderRect = (x0, y0, x1, y1) => {
            x0 = Math.max(0, Math.floor(x0)); y0 = Math.max(0, Math.floor(y0)); x1 = Math.min(W, Math.ceil(x1)); y1 = Math.min(H, Math.ceil(y1));
            if (x1 <= x0 || y1 <= y0) return;
            const o = out.data;
            for (let y = y0; y < y1; y += 1) {
                for (let x = x0; x < x1; x += 1) {
                    const i = y * W + x;
                    const sx = x + fx[i]; const sy = y + fy[i];
                    for (let c = 0; c < 4; c += 1) o[i * 4 + c] = bilinear(chan[c], W, H, sx, sy);
                }
            }
            vx.putImageData(out, 0, 0, x0, y0, x1 - x0, y1 - y0);
            if (st.mesh) drawMeshLines();
        };

        const drawMeshLines = () => {
            vx.save();
            vx.strokeStyle = 'rgba(80, 80, 80, 0.6)';
            vx.lineWidth = Math.max(1, W / 800);
            const g = Math.max(8, Math.round(Math.min(W, H) / 24));
            vx.beginPath();
            for (let y = 0; y <= H; y += g) for (let x = 0; x <= W; x += 2) { const i = Math.min(H - 1, y) * W + Math.min(W - 1, x); const px = x - fx[i]; const py = y - fy[i]; if (x) vx.lineTo(px, py); else vx.moveTo(px, py); }
            for (let x = 0; x <= W; x += g) for (let y = 0; y <= H; y += 2) { const i = Math.min(H - 1, y) * W + Math.min(W - 1, x); const px = x - fx[i]; const py = y - fy[i]; if (y) vx.lineTo(px, py); else vx.moveTo(px, py); }
            vx.stroke();
            vx.restore();
        };

        /** One dab of the tool at c (moved by dx, dy for the Forward Warp). */
        const dab = (c, dx, dy, pr) => {
            const r = st.size / 2;
            const x0 = Math.max(0, Math.floor(c.x - r)); const x1 = Math.min(W, Math.ceil(c.x + r));
            const y0 = Math.max(0, Math.floor(c.y - r)); const y1 = Math.min(H, Math.ceil(c.y + r));
            if (x1 <= x0 || y1 <= y0) return;
            const bw = x1 - x0; const bh = y1 - y0;
            const ox = new Float32Array(bw * bh); const oy = new Float32Array(bw * bh);
            for (let y = 0; y < bh; y += 1) for (let x = 0; x < bw; x += 1) { ox[y * bw + x] = fx[(y + y0) * W + x + x0]; oy[y * bw + x] = fy[(y + y0) * W + x + x0]; }
            const old = (a, x, y) => {
                // the field as it was before this dab (outside the box it is unchanged)
                if (x >= x0 && y >= y0 && x < x1 - 1 && y < y1 - 1) return bilinear(a === fx ? ox : oy, bw, bh, x - x0, y - y0);
                return bilinear(a, W, H, x, y);
            };
            const p = (st.pressure / 100) * pr;
            const rate = st.rate / 100;
            for (let y = y0; y < y1; y += 1) {
                for (let x = x0; x < x1; x += 1) {
                    const d2 = (x - c.x) ** 2 + (y - c.y) ** 2;
                    if (d2 >= r * r) continue;
                    const f = (1 - d2 / (r * r)) ** 2 * p;
                    const i = y * W + x;
                    if (mask && !mask[i]) continue;
                    if (st.tool === 'reconstruct') { const k = 1 - f * rate * 0.3; fx[i] *= k; fy[i] *= k; continue; }
                    let qx = x; let qy = y;
                    if (st.tool === 'warp') { qx = x - dx * f; qy = y - dy * f; } else if (st.tool === 'twirl') {
                        const a = -0.06 * f * rate;
                        const lx = x - c.x; const ly = y - c.y;
                        qx = c.x + lx * Math.cos(a) - ly * Math.sin(a);
                        qy = c.y + lx * Math.sin(a) + ly * Math.cos(a);
                    } else {
                        const k = (st.tool === 'pucker' ? 1 : -1) * 0.05 * f * rate;
                        qx = c.x + (x - c.x) * (1 + k);
                        qy = c.y + (y - c.y) * (1 + k);
                    }
                    fx[i] = qx - x + old(fx, qx, qy);
                    fy[i] = qy - y + old(fy, qx, qy);
                }
            }
            renderRect(x0, y0, x1, y1);
        };

        const toDoc = (ev) => {
            const r = view.getBoundingClientRect();
            return { x: ((ev.clientX - r.left) / r.width) * W, y: ((ev.clientY - r.top) / r.height) * H };
        };
        const showRing = (q) => {
            rx.clearRect(0, 0, W, H);
            if (!q) return;
            rx.strokeStyle = '#000';
            rx.lineWidth = Math.max(1, W / 600);
            rx.beginPath(); rx.arc(q.x, q.y, st.size / 2, 0, Math.PI * 2); rx.stroke();
        };
        let last = null;
        let timer = 0;
        ring.addEventListener('pointerdown', (ev) => {
            if (ev.button !== 0) return;
            ring.setPointerCapture(ev.pointerId);
            last = toDoc(ev);
            // a tool that works in place keeps working while the button is held (Photoshop)
            if (st.tool !== 'warp') {
                const pr = root.paintBrush ? root.paintBrush.pressureOf(ev) : 1;
                dab(last, 0, 0, pr);
                timer = setInterval(() => { if (last) dab(last, 0, 0, pr); }, 40);
            }
        });
        ring.addEventListener('pointermove', (ev) => {
            const q = toDoc(ev);
            showRing(q);
            if (!last) return;
            const pr = root.paintBrush ? root.paintBrush.pressureOf(ev) : 1;
            if (st.tool === 'warp') {
                const dist = Math.hypot(q.x - last.x, q.y - last.y);
                const stepPx = Math.max(1, st.size / 8);
                const n = Math.ceil(dist / stepPx);
                for (let i = 1; i <= n; i += 1) {
                    const a = { x: last.x + ((q.x - last.x) * (i - 1)) / n, y: last.y + ((q.y - last.y) * (i - 1)) / n };
                    dab(a, (q.x - last.x) / n, (q.y - last.y) / n, pr);
                }
            }
            last = q;
        });
        const stop = () => { last = null; clearInterval(timer); };
        ring.addEventListener('pointerup', stop);
        ring.addEventListener('pointercancel', stop);
        ring.addEventListener('pointerleave', () => showRing(null));
        box.querySelector('.mp-lq-tools').addEventListener('click', (ev) => {
            const b = ev.target.closest('[data-t]');
            if (!b) return;
            st.tool = b.dataset.t;
            box.querySelectorAll('.mp-lq-tool').forEach((x) => x.classList.toggle('is-on', x === b));
        });
        box.querySelectorAll('input[data-k]').forEach((i) => i.addEventListener('input', () => {
            if (i.type === 'checkbox') { st[i.dataset.k] = i.checked; renderRect(0, 0, W, H); return; }
            const v = Number(i.value);
            if (v > 0) st[i.dataset.k] = Math.min(Number(i.max), v);
        }));
        box.querySelector('.mp-lq-restore').addEventListener('click', () => { fx.fill(0); fy.fill(0); renderRect(0, 0, W, H); });
        const keys = (ev) => {
            if (ev.target.closest('input')) return;
            const t = LQ_TOOLS.find((x) => x[2] === ev.key.toLowerCase());
            if (t) { box.querySelector(`[data-t="${t[0]}"]`).click(); ev.preventDefault(); ev.stopPropagation(); }
            if (ev.key === '[' || ev.key === ']') { st.size = Math.max(1, Math.min(1500, st.size + (ev.key === ']' ? 10 : -10))); box.querySelector('[data-k="size"]').value = st.size; ev.stopPropagation(); }
            if (ev.key === 'Escape') { close(false); ev.stopPropagation(); }
            if (ev.key === 'Enter') { close(true); ev.stopPropagation(); }
        };
        w.modal.addEventListener('keydown', keys, true);
        const close = (ok) => {
            stop();
            w.modal.removeEventListener('keydown', keys, true);
            box.remove();
            w.liquifyOpen = false;
            if (!ok) return;
            const step = d.beginStep('Liquify', l);
            l.ctx.putImageData(out, 0, 0);
            step.grow({ x: 0, y: 0, w: W, h: H });
            d.commitStep(step);
            d.markDirty();
        };
        box.querySelector('.mp-lq-commit').addEventListener('click', () => close(true));
        box.querySelector('.mp-lq-cancel').addEventListener('click', () => close(false));
        w.liquifyApi = { dab, close, st, fields: [fx, fy] };
    }

    // ---- menus -------------------------------------------------------------------------------------

    function action(w, a) {
        switch (a) {
            case 'content-aware-fill': contentAwareFill(w); return true;
            case 'xf-distort': start(w, 'distort'); return true;
            case 'xf-perspective': start(w, 'perspective'); return true;
            case 'xf-warp': start(w, 'warp'); return true;
            case 'puppet-warp': start(w, 'puppet'); return true;
            case 'liquify': liquify(w); return true;
            default: return false;
        }
    }

    const T = { camove: dragTool('move'), patch: dragTool('patch') };
    if (root.PaintWindow) Object.assign(root.PaintWindow.prototype.tools, T);

    root.paintWarp = { start, commit, cancel, pointer, svg, draw, liquify, contentAwareFill, patchInto, quadMap, bezierMap, puppetMap, drawMesh, action, T };
})(typeof window !== 'undefined' ? window : globalThis);
