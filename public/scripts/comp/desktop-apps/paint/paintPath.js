/**
 * Paint's paths and shape layers (Yozora #632), Photoshop's Pen tool and vectors.
 *
 *   a path      { subs: [{ closed, pts: [{ x, y, ix, iy, ox, oy }] }] }: anchors with their in and
 *               out handles (a corner's handles sit on the anchor)
 *   doc.workPath  the Work Path the Pen draws; doc.paths [{ id, name, path }] the saved ones
 *   layer.vector  a shape layer: { path, fill, stroke: { color, width } | null }; its canvas is a
 *               cache drawn from the path, so Free Transform and Move stay sharp
 *
 *   Pen (P): click a corner, drag a smooth point, click the first anchor to close; Ctrl drags an
 *   anchor or handle, Alt+click turns a point smooth or corner. Path Selection (A) drags a whole
 *   subpath, Direct Selection (Shift+A) an anchor or a handle. The Shape mode (the options bar)
 *   of the Pen and the Rectangle, Ellipse, Rounded Rectangle and Line tools makes shape layers.
 *
 *   paintPath.svg(w, z) the overlay; applyState(doc, s) a history step; render(l, W, H)
 *   paintPath.makeSelection / fill / stroke / fromSelection / togglePanel / action
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const P = () => root.paintPro;
    const K = 0.5522847498; // a quarter ellipse as one cubic
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const clone = (o) => (o ? JSON.parse(JSON.stringify(o)) : null);

    const pt = (x, y) => ({ x, y, ix: x, iy: y, ox: x, oy: y });
    const isCorner = (q) => q.ix === q.x && q.iy === q.y && q.ox === q.x && q.oy === q.y;

    // ---- shapes as paths ---------------------------------------------------------------------------

    function rectPath(x, y, w, h) {
        return { subs: [{ closed: true, pts: [pt(x, y), pt(x + w, y), pt(x + w, y + h), pt(x, y + h)] }] };
    }

    function ellipsePath(cx, cy, rx, ry) {
        const kx = rx * K;
        const ky = ry * K;
        return { subs: [{ closed: true, pts: [
            { x: cx, y: cy - ry, ix: cx - kx, iy: cy - ry, ox: cx + kx, oy: cy - ry },
            { x: cx + rx, y: cy, ix: cx + rx, iy: cy - ky, ox: cx + rx, oy: cy + ky },
            { x: cx, y: cy + ry, ix: cx + kx, iy: cy + ry, ox: cx - kx, oy: cy + ry },
            { x: cx - rx, y: cy, ix: cx - rx, iy: cy + ky, ox: cx - rx, oy: cy - ky }
        ] }] };
    }

    function roundRectPath(x, y, w, h, r) {
        r = Math.max(0, Math.min(r, w / 2, h / 2));
        if (!r) return rectPath(x, y, w, h);
        const k = r * (1 - K);
        const q = (ax, ay, ix, iy, ox, oy) => ({ x: ax, y: ay, ix, iy, ox, oy });
        return { subs: [{ closed: true, pts: [
            q(x + r, y, x + k, y, x + r, y), q(x + w - r, y, x + w - r, y, x + w - k, y),
            q(x + w, y + r, x + w, y + k, x + w, y + r), q(x + w, y + h - r, x + w, y + h - r, x + w, y + h - k),
            q(x + w - r, y + h, x + w - k, y + h, x + w - r, y + h), q(x + r, y + h, x + r, y + h, x + k, y + h),
            q(x, y + h - r, x, y + h - k, x, y + h - r), q(x, y + r, x, y + r, x, y + k)
        ] }] };
    }

    /** Photoshop's Line tool: a thin rectangle along the line, Weight wide. */
    function linePath(a, b, weight) {
        const len = Math.hypot(b.x - a.x, b.y - a.y) || 1;
        const nx = (-(b.y - a.y) / len) * (weight / 2);
        const ny = ((b.x - a.x) / len) * (weight / 2);
        return { subs: [{ closed: true, pts: [pt(a.x + nx, a.y + ny), pt(b.x + nx, b.y + ny), pt(b.x - nx, b.y - ny), pt(a.x - nx, a.y - ny)] }] };
    }

    // ---- drawing ---------------------------------------------------------------------------------

    function segments(sub, fn) {
        const n = sub.pts.length;
        for (let i = 1; i < n; i += 1) fn(sub.pts[i - 1], sub.pts[i]);
        if (sub.closed && n > 1) fn(sub.pts[n - 1], sub.pts[0]);
    }

    function toPath2D(path) {
        const p = new Path2D();
        (path ? path.subs : []).forEach((s) => {
            if (!s.pts.length) return;
            p.moveTo(s.pts[0].x, s.pts[0].y);
            segments(s, (a, b) => p.bezierCurveTo(a.ox, a.oy, b.ix, b.iy, b.x, b.y));
            if (s.closed) p.closePath();
        });
        return p;
    }

    function svgD(path, z) {
        let d = '';
        const f = (v) => (v * z).toFixed(1);
        (path ? path.subs : []).forEach((s) => {
            if (!s.pts.length) return;
            d += `M${f(s.pts[0].x)},${f(s.pts[0].y)}`;
            segments(s, (a, b) => { d += `C${f(a.ox)},${f(a.oy)} ${f(b.ix)},${f(b.iy)} ${f(b.x)},${f(b.y)}`; });
            if (s.closed) d += 'Z';
        });
        return d;
    }

    /** The path as polylines (each bezier in short steps), for strokes and bounds. */
    function flatten(path) {
        const out = [];
        (path ? path.subs : []).forEach((s) => {
            if (!s.pts.length) return;
            const line = [{ x: s.pts[0].x, y: s.pts[0].y }];
            segments(s, (a, b) => {
                const len = Math.hypot(a.ox - a.x, a.oy - a.y) + Math.hypot(b.ix - a.ox, b.iy - a.oy) + Math.hypot(b.x - b.ix, b.y - b.iy);
                const n = Math.max(1, Math.ceil(len / 2));
                for (let i = 1; i <= n; i += 1) {
                    const t = i / n;
                    const u = 1 - t;
                    line.push({
                        x: u * u * u * a.x + 3 * u * u * t * a.ox + 3 * u * t * t * b.ix + t * t * t * b.x,
                        y: u * u * u * a.y + 3 * u * u * t * a.oy + 3 * u * t * t * b.iy + t * t * t * b.y
                    });
                }
            });
            out.push(line);
        });
        return out;
    }

    function bounds(path) {
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        flatten(path).forEach((l) => l.forEach((q) => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); }));
        return x1 < x0 ? null : { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    /** Every anchor and handle through fn(x, y) -> [x, y]. */
    function mapPoints(path, fn) {
        path.subs.forEach((s) => s.pts.forEach((q) => {
            [[q.x, q.y], [q.ix, q.iy], [q.ox, q.oy]] = [fn(q.x, q.y), fn(q.ix, q.iy), fn(q.ox, q.oy)];
        }));
    }

    /** A shape layer's pixels from its path. */
    function render(l, W, H) {
        const v = l.vector;
        if (!v) return;
        const ctx = l.ctx;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, W, H);
        const p = toPath2D(v.path);
        if (v.fill) { ctx.fillStyle = v.fill; ctx.fill(p); }
        if (v.stroke && v.stroke.width > 0) {
            ctx.strokeStyle = v.stroke.color;
            ctx.lineWidth = v.stroke.width;
            ctx.lineJoin = 'miter';
            ctx.stroke(p);
        }
        ctx.restore();
    }

    // ---- state and history -------------------------------------------------------------------------

    function paths(d) { if (!d.paths) d.paths = []; return d.paths; }

    function state(d) {
        return {
            paths: clone(paths(d)), work: clone(d.workPath || null),
            vectors: d.layers.filter((l) => l.vector).map((l) => [l.id, clone(l.vector)])
        };
    }

    /** paintCore's apply for a 'paths' step: the paths and the shape layers as they were. */
    function applyState(d, s) {
        d.paths = clone(s.paths) || [];
        d.workPath = clone(s.work);
        s.vectors.forEach(([id, v]) => {
            const l = d.layers.find((x) => x.id === id);
            if (l) { l.vector = clone(v); render(l, d.width, d.height); }
        });
        d.markDirty();
        d.emit('paths');
    }

    function begin(w) { w.pathBefore = state(w.doc); }

    function commit(w, label) {
        const before = w.pathBefore;
        w.pathBefore = null;
        if (!before) return;
        const after = state(w.doc);
        if (JSON.stringify(before) === JSON.stringify(after)) return;
        w.doc.push({ label, kind: 'paths', before, after, bytes: 2000 });
        refreshPanel(w);
    }

    // ---- the path being edited ------------------------------------------------------------------------

    /** The path the tools work on: the shape layer's, the chosen saved path, else the Work Path. */
    function current(w, create) {
        const d = w.doc;
        const l = d.activeLayer;
        if (l && l.vector) return l.vector.path;
        if (w.pathPick && w.pathPick !== 'work') {
            const sp = paths(d).find((x) => x.id === w.pathPick);
            if (sp) return sp.path;
            w.pathPick = null;
        }
        if (!d.workPath && create) d.workPath = { subs: [] };
        return d.workPath || null;
    }

    function redraw(w, l) {
        if (l && l.vector) { render(l, w.doc.width, w.doc.height); w.doc.markDirty(); }
        w.drawAnts();
    }

    /** The anchor or handle at p: { sub, i, part: 'a' | 'in' | 'out' }. */
    function hitPoint(w, path, p, handlesToo = true) {
        if (!path) return null;
        const tol = 6 / w.zoom;
        for (let s = path.subs.length - 1; s >= 0; s -= 1) {
            const pts = path.subs[s].pts;
            for (let i = pts.length - 1; i >= 0; i -= 1) {
                const q = pts[i];
                if (Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol) return { sub: s, i, part: 'a' };
                if (!handlesToo) continue;
                if (Math.abs(q.ox - p.x) <= tol && Math.abs(q.oy - p.y) <= tol && (q.ox !== q.x || q.oy !== q.y)) return { sub: s, i, part: 'out' };
                if (Math.abs(q.ix - p.x) <= tol && Math.abs(q.iy - p.y) <= tol && (q.ix !== q.x || q.iy !== q.y)) return { sub: s, i, part: 'in' };
            }
        }
        return null;
    }

    let probe = null;
    function hitSub(w, path, p) {
        if (!path) return -1;
        if (!probe) probe = C().makeCanvas(1, 1).getContext('2d');
        probe.lineWidth = 8 / w.zoom;
        for (let s = path.subs.length - 1; s >= 0; s -= 1) {
            const one = toPath2D({ subs: [path.subs[s]] });
            if (probe.isPointInPath(one, p.x, p.y) || probe.isPointInStroke(one, p.x, p.y)) return s;
        }
        return -1;
    }

    // ---- the overlay ---------------------------------------------------------------------------------

    function svg(w, z) {
        if (!w.doc) return '';
        const tool = w.tool;
        const l = w.doc.activeLayer;
        const path = current(w, false);
        const showPts = tool === 'pen' || tool === 'directselect' || tool === 'pathselect';
        if (!path || (!showPts && !(l && l.vector))) return '';
        let html = `<path class="mp-path" d="${svgD(path, z)}"/>`;
        // the Pen's next segment follows the pointer
        const open = w.penSub !== undefined && w.penSub !== null ? path.subs[w.penSub] : null;
        if (tool === 'pen' && open && !open.closed && open.pts.length && w.penHover && !w.penDrag) {
            const a = open.pts[open.pts.length - 1];
            html += `<path class="mp-path is-rubber" d="M${a.x * z},${a.y * z}C${a.ox * z},${a.oy * z} ${w.penHover.x * z},${w.penHover.y * z} ${w.penHover.x * z},${w.penHover.y * z}"/>`;
        }
        if (!showPts) return html;
        path.subs.forEach((s, si) => {
            const on = tool !== 'pathselect' || si === w.pathSub;
            s.pts.forEach((q, i) => {
                const sel = w.pathAt && w.pathAt.sub === si && w.pathAt.i === i;
                if (tool !== 'pathselect' && (sel || (open === s && i === s.pts.length - 1))) {
                    if (q.ix !== q.x || q.iy !== q.y) html += `<line class="mp-path-arm" x1="${q.x * z}" y1="${q.y * z}" x2="${q.ix * z}" y2="${q.iy * z}"/><circle class="mp-path-knob" cx="${q.ix * z}" cy="${q.iy * z}" r="2.5"/>`;
                    if (q.ox !== q.x || q.oy !== q.y) html += `<line class="mp-path-arm" x1="${q.x * z}" y1="${q.y * z}" x2="${q.ox * z}" y2="${q.oy * z}"/><circle class="mp-path-knob" cx="${q.ox * z}" cy="${q.oy * z}" r="2.5"/>`;
                }
                html += `<rect class="mp-path-anchor${(tool === 'pathselect' && on) || sel ? ' is-on' : ''}" x="${Math.round(q.x * z) - 2.5}" y="${Math.round(q.y * z) - 2.5}" width="5" height="5"/>`;
            });
        });
        return html;
    }

    // ---- tools ---------------------------------------------------------------------------------------

    /** The Pen in Shape mode starts a shape layer (filled with the drawing colour). */
    function ensureShapeLayer(w) {
        const d = w.doc;
        if (d.activeLayer.vector) return d.activeLayer;
        let made = null;
        const n = d.layers.filter((x) => x.vector).length + 1;
        d.snapshotStep('New Shape Layer', () => {
            made = d.addLayer(`Shape ${n}`);
            made.vector = { path: { subs: [] }, fill: w.fg, stroke: null };
        });
        if (root.paintLayers) root.paintLayers.refresh(w);
        return made;
    }

    const directDown = function (p) {
        const path = current(this, false);
        const h = hitPoint(this, path, p);
        if (!h) { this.pathAt = null; const s = hitSub(this, path, p); this.pathSub = s; this.drawAnts(); return false; }
        begin(this);
        this.pathAt = h;
        this.pathDrag = { h, start: p, path };
        this.drawAnts();
        return true;
    };

    const directMove = function (p) {
        const g = this.pathDrag;
        if (!g) return;
        const q = g.path.subs[g.h.sub].pts[g.h.i];
        const dx = p.x - (g.last || g.start).x;
        const dy = p.y - (g.last || g.start).y;
        g.last = p;
        if (g.h.part === 'a') { q.x += dx; q.y += dy; q.ix += dx; q.iy += dy; q.ox += dx; q.oy += dy; } else if (g.h.part === 'out') {
            q.ox += dx; q.oy += dy;
            // a smooth point keeps its handles in line (Alt breaks them, as in Photoshop)
            if (!g.alt) { const len = Math.hypot(q.ix - q.x, q.iy - q.y); const a = Math.atan2(q.oy - q.y, q.ox - q.x) + Math.PI; q.ix = q.x + Math.cos(a) * len; q.iy = q.y + Math.sin(a) * len; }
        } else {
            q.ix += dx; q.iy += dy;
            if (!g.alt) { const len = Math.hypot(q.ox - q.x, q.oy - q.y); const a = Math.atan2(q.iy - q.y, q.ix - q.x) + Math.PI; q.ox = q.x + Math.cos(a) * len; q.oy = q.y + Math.sin(a) * len; }
        }
        redraw(this, this.doc.activeLayer);
    };

    const directUp = function () {
        if (!this.pathDrag) return;
        this.pathDrag = null;
        commit(this, 'Drag Anchor');
    };

    const T = {};

    T.pen = {
        down(p, ev) {
            if (ev && (ev.ctrlKey || ev.metaKey)) { this.penCtrl = directDown.call(this, p); if (this.pathDrag) this.pathDrag.alt = !!ev.altKey; return; }
            const shape = this.opt.penMode === 'shape';
            const l = shape ? ensureShapeLayer(this) : this.doc.activeLayer;
            const path = current(this, true);
            begin(this);
            const h = hitPoint(this, path, p, false);
            // Alt+click an anchor: a smooth point becomes a corner, a corner drags out handles
            if (ev && ev.altKey && h) {
                const q = path.subs[h.sub].pts[h.i];
                if (!isCorner(q)) { q.ix = q.x; q.iy = q.y; q.ox = q.x; q.oy = q.y; this.penDrag = null; } else this.penDrag = { q, mode: 'convert' };
                redraw(this, l);
                return;
            }
            let sub = this.penSub !== null && this.penSub !== undefined ? path.subs[this.penSub] : null;
            if (sub && sub.closed) { sub = null; this.penSub = null; }
            if (sub && h && h.sub === this.penSub && h.i === 0 && sub.pts.length > 1) {
                // the first anchor closes it
                sub.closed = true;
                this.penDrag = { q: sub.pts[0], mode: 'close' };
                this.penSub = null;
                redraw(this, l);
                return;
            }
            if (!sub) {
                sub = { closed: false, pts: [] };
                path.subs.push(sub);
                this.penSub = path.subs.length - 1;
            }
            const q = pt(p.x, p.y);
            sub.pts.push(q);
            this.penDrag = { q, mode: 'new' };
            this.pathAt = { sub: this.penSub, i: sub.pts.length - 1, part: 'a' };
            redraw(this, l);
        },
        move(p, ev, down) {
            if (this.pathDrag) { directMove.call(this, p); return; }
            this.penHover = p;
            const g = this.penDrag;
            if (!down || !g) { if (this.tool === 'pen') this.drawAnts(); return; }
            // a drag pulls out the handles: out to the pointer, in mirrored (closing pulls the in one)
            const q = g.q;
            if (g.mode === 'close') { q.ix = 2 * q.x - p.x; q.iy = 2 * q.y - p.y; if (isFinite(q.ox) && q.ox === q.x && q.oy === q.y) { q.ox = p.x; q.oy = p.y; } } else { q.ox = p.x; q.oy = p.y; q.ix = 2 * q.x - p.x; q.iy = 2 * q.y - p.y; }
            redraw(this, this.doc.activeLayer);
        },
        up() {
            if (this.pathDrag) { directUp.call(this); return; }
            const g = this.penDrag;
            this.penDrag = null;
            if (!g) { commit(this, 'Pen'); return; }
            commit(this, g.mode === 'close' ? 'Close Path' : g.mode === 'convert' ? 'Convert Point' : 'Add Anchor Point');
        }
    };

    T.directselect = {
        down(p, ev) { if (directDown.call(this, p) && this.pathDrag) this.pathDrag.alt = !!(ev && ev.altKey); },
        move(p, ev, down) { if (down) directMove.call(this, p); },
        up() { directUp.call(this); }
    };

    T.pathselect = {
        down(p) {
            const path = current(this, false);
            const s = hitSub(this, path, p);
            this.pathSub = s;
            this.pathAt = null;
            if (s < 0) { this.drawAnts(); return; }
            begin(this);
            this.pathMove = { path, s, last: p };
            this.drawAnts();
        },
        move(p, ev, down) {
            const m = this.pathMove;
            if (!down || !m) return;
            const dx = p.x - m.last.x;
            const dy = p.y - m.last.y;
            m.last = p;
            mapPoints({ subs: [m.path.subs[m.s]] }, (x, y) => [x + dx, y + dy]);
            redraw(this, this.doc.activeLayer);
        },
        up() {
            if (!this.pathMove) return;
            this.pathMove = null;
            commit(this, 'Move Path');
        }
    };

    /** Enter / Esc with the Pen: the open subpath is finished (it stays as it is). */
    function endPen(w) {
        if (w.penSub === null || w.penSub === undefined) return false;
        w.penSub = null;
        w.penHover = null;
        w.drawAnts();
        return true;
    }

    // ---- the shape tools in Shape or Path mode ----------------------------------------------------------

    /** The Rectangle, Ellipse, Rounded Rectangle and Line tools' result as a path. */
    function shapeOf(w, kind, a, b) {
        const x = Math.min(a.x, b.x);
        const y = Math.min(a.y, b.y);
        const ww = Math.abs(b.x - a.x);
        const hh = Math.abs(b.y - a.y);
        if (kind === 'rect') return rectPath(x, y, ww, hh);
        if (kind === 'ellipse') return ellipsePath(x + ww / 2, y + hh / 2, ww / 2, hh / 2);
        if (kind === 'roundrect') return roundRectPath(x, y, ww, hh, w.opt.radius === undefined ? 16 : w.opt.radius);
        return linePath(a, b, Math.max(1, w.brushSize()));
    }

    function fromShapeTool(w, kind, s) {
        const path = shapeOf(w, kind, s.a, s.b);
        const mode = w.opt.shapeMode;
        const d = w.doc;
        if (mode === 'path') {
            begin(w);
            const cur = current(w, true);
            cur.subs.push(...path.subs);
            commit(w, 'New Work Path');
            w.drawAnts();
            return;
        }
        // a shape layer: Vista's fill style says fill, outline or both
        const fillStyle = w.opt.shape;
        const isLine = kind === 'line';
        const vector = {
            path,
            fill: isLine || fillStyle !== 'outline' ? (fillStyle === 'both' && !isLine ? s.c2 : s.c1) : null,
            stroke: !isLine && fillStyle !== 'fill' ? { color: s.c1, width: Math.max(1, w.brushSize()) } : null
        };
        const names = { rect: 'Rectangle', ellipse: 'Ellipse', roundrect: 'Rounded Rectangle', line: 'Line' };
        const n = d.layers.filter((x) => x.vector).length + 1;
        d.snapshotStep(`${names[kind]} Tool`, () => {
            const l = d.addLayer(`${names[kind]} ${n}`);
            l.vector = vector;
            render(l, d.width, d.height);
        });
        if (root.paintLayers) root.paintLayers.refresh(w);
        w.drawAnts();
    }

    // ---- path operations ---------------------------------------------------------------------------------

    function pickedPath(w) {
        const path = current(w, false);
        if (!path || !path.subs.some((s) => s.pts.length > 1)) { w.status('Draw a path with the Pen first.'); return null; }
        return path;
    }

    /** Ctrl+Enter / Make Selection: the path filled becomes the selection. */
    function makeSelection(w, path = pickedPath(w)) {
        if (!path || !P()) return;
        const d = w.doc;
        const c = C().makeCanvas(d.width, d.height);
        const x = c.getContext('2d', { willReadFrequently: true });
        x.fillStyle = '#fff';
        x.fill(toPath2D(path));
        const a = x.getImageData(0, 0, d.width, d.height).data;
        const m = new Uint8Array(d.width * d.height);
        for (let i = 0; i < m.length; i += 1) m[i] = a[i * 4 + 3];
        if (d.selection) w.lastSelection = d.selection;
        w.setSelection(P().fromMask(m, d.width, d.height));
    }

    function fillPath(w, path = pickedPath(w)) {
        if (!path) return;
        const b = bounds(path);
        w.commitToLayer('Fill Path', (ctx) => {
            ctx.globalAlpha = w.opt.opacity / 100;
            ctx.fillStyle = w.fg;
            ctx.fill(toPath2D(path));
        }, { x: b.x - 2, y: b.y - 2, w: b.w + 4, h: b.h + 4 });
    }

    /** Stroke Path: the Brush (its preset, size and colour) along the path. */
    function strokePath(w, path = pickedPath(w)) {
        if (!path) return;
        const prev = w.tool;
        w.tool = 'brush';
        try {
            if (!w.beginStroke(false)) return;
            const B = root.paintBrush;
            const color = w.splitAlpha(w.fg).opaque;
            const size = w.brushSize();
            flatten(path).forEach((line) => {
                if (B) B.begin(w);
                for (let i = 1; i < line.length; i += 1) {
                    const r = B ? B.stroke(w, line[i - 1], line[i], 1, 1, color, size) : w.strokeDab(line[i - 1].x, line[i - 1].y, line[i].x, line[i].y, size, color);
                    if (r) w.growStroke(r);
                }
            });
            w.endStroke();
            const last = w.doc.history[w.doc.historyIndex];
            if (last) { last.label = 'Stroke Path'; w.doc.emit('history'); }
        } finally {
            w.tool = prev;
        }
    }

    /**
     * Make Work Path from the selection: its edges traced round the pixels (inside where the mask is
     * over half), then simplified (Photoshop's tolerance of 2 pixels).
     */
    function fromSelection(w) {
        const d = w.doc;
        const s = d.selection;
        if (!s || !P()) { w.status('Make a selection first.'); return; }
        const W = d.width;
        const H = d.height;
        let subs;
        if (s.path && !s.mask) subs = [{ closed: true, pts: s.path.map((q) => pt(q.x, q.y)) }];
        else if (!s.mask) subs = rectPath(s.x, s.y, s.w, s.h).subs;
        else subs = trace(P().maskOf(d, s), W, H).map((poly) => ({ closed: true, pts: simplify(poly, 1.5).map((q) => pt(q.x, q.y)) })).filter((sub) => sub.pts.length > 2);
        begin(w);
        w.pathPick = 'work';
        d.workPath = { subs };
        commit(w, 'Make Work Path');
        if (d.selection) w.lastSelection = d.selection;
        w.setSelection(null);
        w.drawAnts();
        refreshPanel(w);
    }

    /** The outlines of a mask: pixel edges between inside and outside, chained into rings. */
    function trace(m, W, H) {
        const inside = (x, y) => x >= 0 && y >= 0 && x < W && y < H && m[y * W + x] >= 128;
        const next = new Map(); // "x,y" of an edge's start -> its ends (clockwise round the inside)
        const add = (x0, y0, x1, y1) => {
            const k = x0 * 100003 + y0;
            if (!next.has(k)) next.set(k, []);
            next.get(k).push([x1, y1]);
        };
        for (let y = 0; y < H; y += 1) {
            for (let x = 0; x < W; x += 1) {
                if (!inside(x, y)) continue;
                if (!inside(x, y - 1)) add(x, y, x + 1, y);
                if (!inside(x + 1, y)) add(x + 1, y, x + 1, y + 1);
                if (!inside(x, y + 1)) add(x + 1, y + 1, x, y + 1);
                if (!inside(x - 1, y)) add(x, y + 1, x, y);
            }
        }
        const rings = [];
        for (const [k0, list0] of next) {
            while (list0.length) {
                const ring = [];
                let x = Math.floor(k0 / 100003);
                let y = k0 % 100003;
                const sx = x; const sy = y;
                let guard = 0;
                do {
                    ring.push({ x, y });
                    const list = next.get(x * 100003 + y);
                    if (!list || !list.length) break;
                    [x, y] = list.pop();
                    guard += 1;
                } while ((x !== sx || y !== sy) && guard < 4e6);
                if (ring.length > 2) rings.push(ring);
            }
        }
        return rings;
    }

    /** Ramer-Douglas-Peucker on a closed ring. */
    function simplify(ring, tol) {
        if (ring.length < 4) return ring;
        const rdp = (pts, a, b, out) => {
            let far = -1; let dmax = 0;
            const A = pts[a]; const Bq = pts[b];
            const len = Math.hypot(Bq.x - A.x, Bq.y - A.y) || 1;
            for (let i = a + 1; i < b; i += 1) {
                const dd = Math.abs((Bq.x - A.x) * (A.y - pts[i].y) - (A.x - pts[i].x) * (Bq.y - A.y)) / len;
                if (dd > dmax) { dmax = dd; far = i; }
            }
            if (dmax > tol && far > 0) { rdp(pts, a, far, out); rdp(pts, far, b, out); } else out.push(pts[a]);
        };
        const half = Math.floor(ring.length / 2);
        const out = [];
        const loop = ring.concat([ring[0]]);
        rdp(loop, 0, half, out);
        rdp(loop, half, loop.length - 1, out);
        return out;
    }

    // ---- shape layers: transform, move, rasterize ------------------------------------------------------

    /** Free Transform's box on a shape layer moves the path's points the same way. */
    function commitTransform(w, l, t) {
        const b = t.from.vector;
        const before = clone(l.vector);
        const cx0 = b.x + b.w / 2;
        const cy0 = b.y + b.h / 2;
        const sx = (t.w / b.w) * t.flipX;
        const sy = (t.h / b.h) * t.flipY;
        const c = Math.cos(t.angle);
        const s = Math.sin(t.angle);
        mapPoints(l.vector.path, (x, y) => {
            const lx = (x - cx0) * sx;
            const ly = (y - cy0) * sy;
            return [t.cx + lx * c - ly * s, t.cy + lx * s + ly * c];
        });
        render(l, w.doc.width, w.doc.height);
        t.step.vector = { before, after: clone(l.vector) };
    }

    function moved(w, l, step, dx, dy) {
        const before = clone(l.vector);
        mapPoints(l.vector.path, (x, y) => [x + dx, y + dy]);
        render(l, w.doc.width, w.doc.height);
        step.vector = { before, after: clone(l.vector) };
    }

    function rasterize(w, l = w.doc.activeLayer, quiet) {
        if (!l.vector) return;
        w.doc.snapshotStep('Rasterize Shape', () => { l.vector = null; });
        if (!quiet) w.status(`${l.name} was rasterized: it is no longer a shape layer.`);
        if (root.paintLayers) root.paintLayers.refresh(w);
        w.drawAnts();
    }

    /** The options bar's fill and stroke of a shape layer. */
    function setVector(w, fn, label) {
        const l = w.doc.activeLayer;
        if (!l.vector) return;
        begin(w);
        fn(l.vector);
        render(l, w.doc.width, w.doc.height);
        w.doc.markDirty();
        commit(w, label);
    }

    // ---- the Paths window ---------------------------------------------------------------------------------

    function dock(w) { return w.modal.querySelector('.mp-dock'); }
    function panelOpen(w) { return !!dock(w).querySelector('.mp-paths'); }

    function togglePanel(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-paths');
        if (cur) { cur.remove(); w.modal.classList.toggle('mp-has-dock', !!d.children.length); return; }
        d.insertAdjacentHTML('beforeend', `<div class="mp-panel mp-paths"><div class="mp-panel-cap">Paths</div><div class="mp-paths-list" role="listbox"></div>
            <div class="mp-paths-bar">${[['fill', 'Fill path with foreground color'], ['stroke', 'Stroke path with brush'], ['select', 'Load path as a selection (Ctrl+Enter)'], ['from-sel', 'Make work path from selection'], ['new', 'Create new path'], ['delete', 'Delete current path']]
                .map(([a, t], i) => `<button type="button" class="mp-paths-btn" data-a="${a}" title="${t}"><span class="mp-paths-art" style="--i:${i}"></span></button>`).join('')}</div></div>`);
        w.modal.classList.add('mp-has-dock');
        const panel = d.querySelector('.mp-paths');
        panel.addEventListener('click', (ev) => {
            const b = ev.target.closest('.mp-paths-btn');
            if (b) { action(w, `path-${b.dataset.a}`); return; }
            const row = ev.target.closest('.mp-paths-row');
            if (!row) return;
            w.pathPick = row.dataset.id === 'work' ? 'work' : Number(row.dataset.id);
            w.penSub = null;
            refreshPanel(w);
            w.drawAnts();
        });
        panel.addEventListener('dblclick', (ev) => {
            const row = ev.target.closest('.mp-paths-row');
            if (!row) return;
            if (row.dataset.id === 'work') action(w, 'path-save'); else renamePath(w, Number(row.dataset.id));
        });
        refreshPanel(w);
    }

    function thumbOf(path, W, H) {
        const c = C().makeCanvas(40, 30);
        const x = c.getContext('2d');
        x.fillStyle = '#fff';
        x.fillRect(0, 0, 40, 30);
        const k = Math.min(40 / W, 30 / H);
        x.translate((40 - W * k) / 2, (30 - H * k) / 2);
        x.scale(k, k);
        x.fillStyle = '#7a7a7a';
        x.fill(toPath2D(path));
        return c.toDataURL();
    }

    function refreshPanel(w) {
        const host = dock(w) && dock(w).querySelector('.mp-paths .mp-paths-list');
        if (!host) return;
        const d = w.doc;
        const l = d.activeLayer;
        const rows = [];
        if (l && l.vector) rows.push({ id: 'shape', name: `${l.name} Shape Path`, path: l.vector.path, on: true, italic: true });
        if (d.workPath) rows.push({ id: 'work', name: 'Work Path', path: d.workPath, on: !(l && l.vector) && (!w.pathPick || w.pathPick === 'work'), italic: true });
        paths(d).forEach((sp) => rows.push({ id: sp.id, name: sp.name, path: sp.path, on: !(l && l.vector) && w.pathPick === sp.id }));
        host.innerHTML = rows.map((r) => `<div class="mp-paths-row${r.on ? ' is-active' : ''}" data-id="${r.id}" role="option"><img src="${thumbOf(r.path, d.width, d.height)}" alt=""><span${r.italic ? ' class="is-italic"' : ''}>${esc(r.name)}</span></div>`).join('');
    }

    function nameDialog(w, title, def) {
        const V = root.vistaDialogTemplate;
        if (!V) return Promise.resolve(def);
        const tpl = { t: title, w: 220, h: 46, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 9, 24, 8, 0x50020000, '&Name:', 0],
            [103, 'E', 34, 7, 122, 12, 0x50810080, def, 0],
            [1, 'B', 163, 7, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 163, 25, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        return new Promise((resolve) => {
            let done = false;
            const end = (v) => { if (!done) { done = true; resolve(v); } };
            V.openDialog({ id: 'mpPathName', tpl, owner: w.modal, ok: (ctx) => end(String(ctx.get(103) || '').trim()), cancel: () => end(''), close: () => end('') });
        });
    }

    async function savePath(w) {
        const d = w.doc;
        if (!d.workPath) return;
        const name = await nameDialog(w, 'Save Path', `Path ${paths(d).length + 1}`);
        if (!name) return;
        begin(w);
        const id = Date.now();
        paths(d).push({ id, name, path: d.workPath });
        d.workPath = null;
        w.pathPick = id;
        commit(w, 'Save Path');
        refreshPanel(w);
    }

    async function renamePath(w, id) {
        const sp = paths(w.doc).find((x) => x.id === id);
        if (!sp) return;
        const name = await nameDialog(w, 'Rename Path', sp.name);
        if (!name) return;
        begin(w);
        sp.name = name;
        commit(w, 'Rename Path');
    }

    function deletePath(w) {
        const d = w.doc;
        begin(w);
        if (w.pathPick && w.pathPick !== 'work') { d.paths = paths(d).filter((x) => x.id !== w.pathPick); w.pathPick = null; } else d.workPath = null;
        w.penSub = null;
        commit(w, 'Delete Path');
        w.drawAnts();
    }

    function newPath(w) {
        const d = w.doc;
        begin(w);
        const id = Date.now();
        paths(d).push({ id, name: `Path ${paths(d).length + 1}`, path: { subs: [] } });
        w.pathPick = id;
        w.penSub = null;
        commit(w, 'New Path');
        refreshPanel(w);
    }

    function action(w, a) {
        switch (a) {
            case 'paths': togglePanel(w); return true;
            case 'path-fill': fillPath(w); return true;
            case 'path-stroke': strokePath(w); return true;
            case 'path-select': makeSelection(w); return true;
            case 'path-from-sel': fromSelection(w); return true;
            case 'path-new': newPath(w); return true;
            case 'path-save': void savePath(w); return true;
            case 'path-delete': deletePath(w); return true;
            case 'shape-rasterize': rasterize(w); return true;
            default: return false;
        }
    }

    // the tools join Paint's (paintApp.js loads first)
    if (root.PaintWindow) Object.assign(root.PaintWindow.prototype.tools, T);

    root.paintPath = {
        T, svg, render, applyState, state, current, toPath2D, flatten, bounds, mapPoints, rectPath, ellipsePath, roundRectPath, linePath,
        fromShapeTool, makeSelection, fillPath, strokePath, fromSelection, trace, simplify, commitTransform, moved, rasterize, setVector,
        endPen, togglePanel, panelOpen, refreshPanel, action
    };
})(typeof window !== 'undefined' ? window : globalThis);
