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
 *   layer.mask { canvas, ctx, enabled, target }   a layer mask: white shows, black hides (its
 *                                 luminance); doc.editMask makes doc.layer the mask's target, so
 *                                 every tool and step paints the mask instead
 *   layer.styles { shadow, glow, stroke }   effects drawn round the layer's (masked) pixels
 *   doc.groups [{ id, name, visible, opacity, blend, collapsed }]; layer.groupId: a group's layers
 *                                 sit next to each other and are composited together first
 *   doc.guides [{ axis: 'h' | 'v', pos }]   ruler guides, in picture pixels
 *   doc.flattened()               a canvas of the picture as saved
 *   PaintCore.floodFill(imageData, x, y, rgba, tolerance) -> dirty rect
 *   PaintCore.wandMask(imageData, x, y, tolerance) -> { mask: Uint8Array (0 / 255), rect }
 *   PaintCore.colorMask / replaceColor   the same without Contiguous
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
            this.mask = null;
            this.styles = null;
            this.adjust = null; // { kind, params } for an adjustment layer
            // the Background layer: erasing and deleting give the background colour, not
            // transparency (Layers > Layer from Background makes it a normal layer)
            this.isBackground = false;
            this.text = null; // { content, face, size, bold, italic, underline, color, x, y } for a type layer
            this.groupId = null;
            this.clip = false; // clipped to the layer under it (Photoshop's clipping mask)
            this.smart = null; // a Smart Object's source, transform and filters (paintSmart.js)
            this.vector = null; // a shape layer's path, fill and stroke (paintPath.js)
        }

        /** A layer mask, white (everything shows) or black (nothing does). */
        addMask(fill = '#ffffff') {
            const canvas = makeCanvas(this.canvas.width, this.canvas.height);
            const ctx = ctxOf(canvas);
            ctx.fillStyle = fill;
            ctx.fillRect(0, 0, canvas.width, canvas.height);
            this.setMaskCanvas(canvas);
            return this.mask;
        }

        setMaskCanvas(canvas, enabled = true) {
            const layer = this;
            const ctx = ctxOf(canvas);
            // what the tools paint when the mask is the target (doc.editMask)
            const target = {
                isMask: true, owner: layer, canvas, ctx,
                get id() { return `m${layer.id}`; },
                get name() { return `${layer.name} Mask`; },
                get locked() { return layer.locked; },
                visible: true, opacity: 1, blend: 'normal'
            };
            this.mask = { canvas, ctx, enabled, target };
        }
    }

    function hasEffects(l) {
        const s = l.styles;
        return !!(s && ((s.shadow && s.shadow.on) || (s.glow && s.glow.on) || (s.stroke && s.stroke.on)));
    }

    function effectPad(l) {
        const s = l.styles;
        if (!hasEffects(l)) return 0;
        let p = 0;
        if (s.shadow && s.shadow.on) p = Math.max(p, s.shadow.distance + s.shadow.size * 2);
        if (s.glow && s.glow.on) p = Math.max(p, s.glow.size * 2);
        if (s.stroke && s.stroke.on) p = Math.max(p, s.stroke.size + 1);
        return Math.ceil(p) + 2;
    }

    /** The layer's pixels over a rectangle, through its mask, with its effects (a canvas of r's size). */
    function renderLayer(l, r) {
        const out = makeCanvas(r.w, r.h);
        const ox = ctxOf(out);
        const pad = effectPad(l);
        const W = l.canvas.width;
        const H = l.canvas.height;
        // the content, padded so a shadow from outside the rectangle reaches into it
        const pr = clampRect({ x: r.x - pad, y: r.y - pad, w: r.w + 2 * pad, h: r.h + 2 * pad }, W, H) || r;
        const c = makeCanvas(pr.w, pr.h);
        const cx = ctxOf(c);
        cx.drawImage(l.canvas, pr.x, pr.y, pr.w, pr.h, 0, 0, pr.w, pr.h);
        if (l.mask && l.mask.enabled) {
            const m = l.mask.ctx.getImageData(pr.x, pr.y, pr.w, pr.h);
            const d = m.data;
            for (let i = 0; i < d.length; i += 4) {
                d[i + 3] = (0.299 * d[i] + 0.587 * d[i + 1] + 0.114 * d[i + 2]) * (d[i + 3] / 255);
            }
            const mc = makeCanvas(pr.w, pr.h);
            ctxOf(mc).putImageData(m, 0, 0);
            cx.globalCompositeOperation = 'destination-in';
            cx.drawImage(mc, 0, 0);
            cx.globalCompositeOperation = 'source-over';
        }
        const dx = pr.x - r.x;
        const dy = pr.y - r.y;
        const s = l.styles;
        if (hasEffects(l)) {
            const tint = (color) => {
                const t = makeCanvas(pr.w, pr.h);
                const tx = ctxOf(t);
                tx.drawImage(c, 0, 0);
                tx.globalCompositeOperation = 'source-in';
                tx.fillStyle = color;
                tx.fillRect(0, 0, pr.w, pr.h);
                return t;
            };
            const FAR = 100000;
            if (s.shadow && s.shadow.on) {
                const a = (s.shadow.angle * Math.PI) / 180;
                ox.save();
                ox.globalAlpha = s.shadow.opacity / 100;
                ox.globalCompositeOperation = BLENDS[s.shadow.blend] || 'multiply';
                ox.shadowColor = s.shadow.color;
                ox.shadowBlur = s.shadow.size;
                // the shadow alone: the picture far off the canvas, its shadow thrown back
                ox.shadowOffsetX = -Math.cos(a) * s.shadow.distance + FAR;
                ox.shadowOffsetY = Math.sin(a) * s.shadow.distance;
                ox.drawImage(c, dx - FAR, dy);
                ox.restore();
            }
            if (s.glow && s.glow.on) {
                ox.save();
                ox.globalAlpha = s.glow.opacity / 100;
                ox.globalCompositeOperation = BLENDS[s.glow.blend] || 'screen';
                ox.shadowColor = s.glow.color;
                ox.shadowBlur = s.glow.size;
                ox.shadowOffsetX = FAR;
                const tinted = tint(s.glow.color);
                // twice: a glow is denser than one blurred shadow
                ox.drawImage(tinted, dx - FAR, dy);
                ox.drawImage(tinted, dx - FAR, dy);
                ox.restore();
            }
            if (s.stroke && s.stroke.on) {
                const t = tint(s.stroke.color);
                const sk = makeCanvas(pr.w, pr.h);
                const sx = ctxOf(sk);
                const n = Math.max(8, Math.round(s.stroke.size * 4));
                for (let ring = s.stroke.size; ring > 0; ring -= Math.max(1, s.stroke.size / 3)) {
                    for (let i = 0; i < n; i += 1) {
                        const a = (i / n) * Math.PI * 2;
                        sx.drawImage(t, Math.cos(a) * ring, Math.sin(a) * ring);
                    }
                }
                if (s.stroke.position === 'inside') {
                    // inside: the band just within the edge
                    sx.globalCompositeOperation = 'destination-out';
                    sx.drawImage(c, 0, 0);
                    sx.globalCompositeOperation = 'source-over';
                }
                ox.save();
                ox.globalAlpha = s.stroke.opacity / 100;
                if (s.stroke.position === 'inside') {
                    // drawn over the content, kept inside it
                    const inner = makeCanvas(pr.w, pr.h);
                    const ix = ctxOf(inner);
                    ix.fillStyle = s.stroke.color;
                    ix.fillRect(0, 0, pr.w, pr.h);
                    ix.globalCompositeOperation = 'destination-out';
                    ix.drawImage(sk, 0, 0);
                    ix.globalCompositeOperation = 'destination-in';
                    ix.drawImage(c, 0, 0);
                    ox.drawImage(c, dx, dy);
                    ox.drawImage(inner, dx, dy);
                    ox.restore();
                    return out;
                }
                ox.drawImage(sk, dx, dy);
                ox.restore();
            }
        }
        ox.drawImage(c, dx, dy);
        return out;
    }

    /**
     * Adjustment layers: PaintCore.adjusters[kind](params) -> (ImageData) -> ImageData, filled in
     * by paintPro.js. The layer changes the pixels under it through its mask, at its opacity.
     */
    const adjusters = {};

    function adjustFn(l) {
        const a = l.adjust;
        const key = JSON.stringify(a.params);
        if (a.cacheKey !== key || !a.cacheFn) {
            const make = adjusters[a.kind];
            Object.defineProperty(a, 'cacheFn', { value: make ? make(a.params) : null, writable: true, configurable: true, enumerable: false });
            Object.defineProperty(a, 'cacheKey', { value: key, writable: true, configurable: true, enumerable: false });
        }
        return a.cacheFn;
    }

    /** Run a layer's adjustment over area (in ctx's pixels), the mask read at the picture's place. */
    function applyAdjustment(ctx, l, area, place) {
        const fn = adjustFn(l);
        if (!fn) return;
        const base = ctx.getImageData(area.x, area.y, area.w, area.h);
        const out = fn(new ImageData(new Uint8ClampedArray(base.data), area.w, area.h), { x0: place.x, y0: place.y, rx: place.x, ry: place.y, rw: area.w, rh: area.h, W: l.canvas.width, H: l.canvas.height });
        const m = l.mask && l.mask.enabled ? l.mask.ctx.getImageData(place.x, place.y, area.w, area.h).data : null;
        const b = base.data;
        const o = out.data;
        const op = l.opacity;
        for (let i = 0; i < b.length; i += 4) {
            let k = op;
            if (m) k *= ((0.299 * m[i] + 0.587 * m[i + 1] + 0.114 * m[i + 2]) / 255) * (m[i + 3] / 255);
            if (k <= 0) continue;
            // colour only: the alpha under the adjustment stays
            b[i] += (o[i] - b[i]) * k; b[i + 1] += (o[i + 1] - b[i + 1]) * k; b[i + 2] += (o[i + 2] - b[i + 2]) * k;
        }
        ctx.putImageData(base, area.x, area.y);
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
            this.groups = [];
            this.guides = [];
            // a transparent document has no Background layer, only Layer 1 (Photoshop)
            const bg = this.addLayer(opts.transparent === true ? 'Layer 1' : 'Background', { silent: true });
            if (opts.transparent !== true) {
                bg.isBackground = true;
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
            const l = this.layers[this.active];
            if (this.quickMask) return this.quickMask.target;
            return (this.editMask || (l && l.adjust)) && l && l.mask ? l.mask.target : l;
        }

        /** The real layer under the active one (the mask's owner when the mask is the target). */
        get activeLayer() {
            return this.layers[this.active];
        }

        /** A layer or a layer mask's target by id (history steps). */
        target(id) {
            if (this.quickMask && this.quickMask.target.id === id) return this.quickMask.target;
            for (const l of this.layers) {
                if (l.id === id) return l;
                if (l.mask && l.mask.target.id === id) return l.mask.target;
            }
            return null;
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
            // a new layer over one in a group joins the group (Photoshop)
            if (opts.at === undefined && this.layers[this.active]) layer.groupId = this.layers[this.active].groupId || null;
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
            this.pruneGroups();
            this.markDirty();
            this.emit('layers');
        }

        group(id) {
            return this.groups.find((g) => g.id === id) || null;
        }

        /** Groups without layers go. */
        pruneGroups() {
            this.groups = this.groups.filter((g) => this.layers.some((l) => l.groupId === g.id));
        }

        /**
         * Move a layer one step. At its group's edge it first leaves the group; next to an open
         * group it joins it; a closed group is stepped over whole (Photoshop's Layers panel).
         */
        moveLayer(i, dir) {
            const l = this.layers[i];
            const j = i + dir;
            if (j < 0 || j >= this.layers.length) {
                if (l.groupId) { l.groupId = null; this.pruneGroups(); this.markDirty(); this.emit('layers'); }
                return;
            }
            const n = this.layers[j];
            if (l.groupId && n.groupId !== l.groupId) {
                l.groupId = null;
                this.pruneGroups();
            } else if (!l.groupId && n.groupId) {
                const g = this.group(n.groupId);
                if (g && g.collapsed) {
                    let k = j;
                    while (k + dir >= 0 && k + dir < this.layers.length && this.layers[k + dir].groupId === n.groupId) k += dir;
                    this.layers.splice(i, 1);
                    const at = dir > 0 ? k : k;
                    this.layers.splice(at, 0, l);
                    this.active = at;
                } else {
                    this.layers.splice(i, 1);
                    this.layers.splice(j, 0, l);
                    l.groupId = n.groupId;
                    this.active = j;
                }
            } else {
                this.layers.splice(i, 1);
                this.layers.splice(j, 0, l);
                this.active = j;
            }
            this.markDirty();
            this.emit('layers');
        }

        /** Put layer i in a new group; returns the group. */
        groupLayer(i, name) {
            const id = nextLayerId++;
            const g = { id, name: name || `Group ${this.groups.length + 1}`, visible: true, opacity: 1, blend: 'pass', collapsed: false };
            this.groups.push(g);
            this.layers[i].groupId = id;
            this.markDirty();
            this.emit('layers');
            return g;
        }

        ungroup(id) {
            this.layers.forEach((l) => { if (l.groupId === id) l.groupId = null; });
            this.pruneGroups();
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
            if (src.mask) {
                const mc = makeCanvas(this.width, this.height);
                ctxOf(mc).drawImage(src.mask.canvas, 0, 0);
                copy.setMaskCanvas(mc, src.mask.enabled);
            }
            copy.styles = src.styles ? JSON.parse(JSON.stringify(src.styles)) : null;
            copy.adjust = src.adjust ? JSON.parse(JSON.stringify(src.adjust)) : null;
            copy.groupId = src.groupId;
            copy.clip = !!src.clip;
            copy.vector = src.vector ? JSON.parse(JSON.stringify(src.vector)) : null;
            copy.smart = src.smart ? { src: src.smart.src, xf: { ...src.smart.xf }, filters: src.smart.filters.slice() } : null;
            copy.text = src.text ? { ...src.text } : null;
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
            if (top.adjust || below.adjust) {
                if (top.adjust && !below.adjust && top.visible) applyAdjustment(below.ctx, top, { x: 0, y: 0, w: this.width, h: this.height }, { x: 0, y: 0 });
                this.layers.splice(i, 1);
                this.active = i - 1;
                this.markDirty();
                this.emit('layers');
                return;
            }
            // what merges into a Smart Object makes it plain pixels
            below.smart = null;
            below.vector = null;
            below.ctx.save();
            below.ctx.globalAlpha = top.opacity;
            below.ctx.globalCompositeOperation = BLENDS[top.blend] || 'source-over';
            const src = (top.mask && top.mask.enabled) || hasEffects(top) ? renderLayer(top, { x: 0, y: 0, w: this.width, h: this.height }) : top.canvas;
            if (top.visible && top.clip && !below.clip) {
                // a clipped layer merges into its base only where the base has pixels
                const cut = makeCanvas(this.width, this.height);
                const cx = ctxOf(cut);
                cx.drawImage(src, 0, 0);
                cx.globalCompositeOperation = 'destination-in';
                cx.drawImage(below.canvas, 0, 0);
                const shape = makeCanvas(this.width, this.height);
                ctxOf(shape).drawImage(below.canvas, 0, 0);
                below.ctx.drawImage(cut, 0, 0);
                below.ctx.globalAlpha = 1;
                below.ctx.globalCompositeOperation = 'destination-in';
                below.ctx.drawImage(shape, 0, 0);
            } else if (top.visible) below.ctx.drawImage(src, 0, 0);
            below.ctx.restore();
            this.layers.splice(i, 1);
            this.active = i - 1;
            this.markDirty();
            this.emit('layers');
        }

        flatten() {
            const hadBackground = this.layers.some((l) => l.isBackground && l.visible);
            const flat = this.flattened();
            const layer = new Layer(this.width, this.height, hadBackground ? 'Background' : 'Layer 1');
            layer.ctx.drawImage(flat, 0, 0);
            layer.isBackground = hadBackground;
            this.layers = [layer];
            this.groups = [];
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
            // the layers go to their own buffer first: adjustment layers change what is under them
            // and must not touch the checker
            const off = makeCanvas(r.w, r.h);
            const tx = ctxOf(off);
            tx.translate(-r.x, -r.y);
            this.compositeRun(tx, 0, this.layers.length, r, opts, false);
            ctx.globalAlpha = 1;
            ctx.globalCompositeOperation = 'source-over';
            ctx.drawImage(off, r.x, r.y);
            ctx.restore();
        }

        /** Layers from..to into tx (translated to r); a group's layers go to a buffer of their own. */
        compositeRun(tx, from, to, r, opts, inGroup) {
            for (let i = from; i < to;) {
                const l = this.layers[i];
                const g = !inGroup && l.groupId ? this.group(l.groupId) : null;
                if (g) {
                    let j = i;
                    while (j < to && this.layers[j].groupId === l.groupId) j += 1;
                    if (g.visible && g.opacity > 0 && g.blend === 'pass') {
                        // Pass Through (Photoshop's default): the layers blend with what is under the
                        // group; its opacity fades the result back towards that
                        if (g.opacity >= 1) this.compositeRun(tx, i, j, r, opts, true);
                        else {
                            const under = makeCanvas(r.w, r.h);
                            const ux = ctxOf(under);
                            ux.drawImage(tx.canvas, 0, 0);
                            ux.translate(-r.x, -r.y);
                            this.compositeRun(ux, i, j, r, opts, true);
                            tx.save();
                            tx.globalAlpha = g.opacity;
                            tx.drawImage(under, r.x, r.y);
                            tx.restore();
                        }
                    } else if (g.visible && g.opacity > 0) {
                        const off = makeCanvas(r.w, r.h);
                        const gx = ctxOf(off);
                        gx.translate(-r.x, -r.y);
                        this.compositeRun(gx, i, j, r, opts, true);
                        tx.save();
                        tx.globalAlpha = g.opacity;
                        tx.globalCompositeOperation = BLENDS[g.blend] || 'source-over';
                        tx.drawImage(off, r.x, r.y);
                        tx.restore();
                    }
                    i = j;
                    continue;
                }
                // a clipping mask: the layers clipped to this one show only where it has pixels;
                // its opacity and blend mode are the whole clipping group's
                let j = i + 1;
                while (j < to && this.layers[j].clip && this.layers[j].groupId === l.groupId) j += 1;
                if (j > i + 1 && !l.adjust) {
                    this.drawClipped(tx, i, j, r, opts);
                    i = j;
                    continue;
                }
                this.drawLayer(tx, l, i, r, opts);
                i += 1;
            }
        }

        /** The base layer i with layers i+1..j-1 clipped to it. */
        drawClipped(tx, i, j, r, opts) {
            const base = this.layers[i];
            if (!base.visible || base.opacity <= 0) return;
            const off = makeCanvas(r.w, r.h);
            const ox = ctxOf(off);
            ox.translate(-r.x, -r.y);
            this.drawLayer(ox, base, i, r, opts, true);
            // the base's own pixels: what the clipped layers are cut to
            const shape = makeCanvas(r.w, r.h);
            ctxOf(shape).drawImage(off, 0, 0);
            for (let k = i + 1; k < j; k += 1) {
                const l = this.layers[k];
                if (!l.visible || l.opacity <= 0) continue;
                // an adjustment layer changes the base (and what is clipped under it) alone
                if (l.adjust) { this.drawLayer(ox, l, k, r, opts); continue; }
                const one = makeCanvas(r.w, r.h);
                const lx = ctxOf(one);
                lx.translate(-r.x, -r.y);
                this.drawLayer(lx, l, k, r, opts, true);
                lx.setTransform(1, 0, 0, 1, 0, 0);
                lx.globalCompositeOperation = 'destination-in';
                lx.drawImage(shape, 0, 0);
                ox.save();
                ox.setTransform(1, 0, 0, 1, 0, 0);
                ox.globalAlpha = l.opacity;
                ox.globalCompositeOperation = BLENDS[l.blend] || 'source-over';
                ox.drawImage(one, 0, 0);
                ox.restore();
            }
            // blending over a soft edge may raise the alpha: the group keeps the base's shape
            ox.save();
            ox.setTransform(1, 0, 0, 1, 0, 0);
            ox.globalCompositeOperation = 'destination-in';
            ox.drawImage(shape, 0, 0);
            ox.restore();
            tx.save();
            tx.globalAlpha = base.opacity;
            tx.globalCompositeOperation = BLENDS[base.blend] || 'source-over';
            tx.drawImage(off, r.x, r.y);
            tx.restore();
        }

        /** solo: the layer at full opacity in Normal (a clipping group applies the base's later). */
        drawLayer(tx, l, i, r, opts, solo) {
            if (!l.visible || l.opacity <= 0) return;
            if (l.adjust) {
                tx.save();
                tx.setTransform(1, 0, 0, 1, 0, 0);
                applyAdjustment(tx, l, { x: 0, y: 0, w: r.w, h: r.h }, r);
                tx.restore();
                return;
            }
            const op = solo ? 1 : l.opacity;
            tx.globalAlpha = op;
            tx.globalCompositeOperation = solo ? 'source-over' : BLENDS[l.blend] || 'source-over';
            if ((l.mask && l.mask.enabled) || hasEffects(l)) tx.drawImage(renderLayer(l, r), r.x, r.y);
            else tx.drawImage(l.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
            // a stroke in progress (brush opacity) is drawn over its layer before the layers above
            if (opts.overlay && opts.overlay.layerIndex === i) {
                tx.globalAlpha = op * (opts.overlay.alpha === undefined ? 1 : opts.overlay.alpha);
                tx.globalCompositeOperation = opts.overlay.erase ? 'destination-out' : 'source-over';
                tx.drawImage(opts.overlay.canvas, r.x, r.y, r.w, r.h, r.x, r.y, r.w, r.h);
            }
            tx.globalAlpha = 1;
            tx.globalCompositeOperation = 'source-over';
        }

        flattened(opts = {}) {
            const c = makeCanvas(this.width, this.height);
            const cx = ctxOf(c);
            this.composite(cx, null);
            // composite() starts by clearing, so the background goes in behind afterwards
            if (opts.background) {
                cx.save();
                cx.globalCompositeOperation = 'destination-over';
                cx.fillStyle = opts.background;
                cx.fillRect(0, 0, this.width, this.height);
                cx.restore();
            }
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
            const l = this.target(step.layerId);
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
                let mask = null;
                if (l.mask) {
                    mask = makeCanvas(this.width, this.height);
                    ctxOf(mask).drawImage(l.mask.canvas, 0, 0);
                    bytes += this.width * this.height * 4;
                }
                return { id: l.id, name: l.name, canvas: c, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked, mask, maskOn: l.mask ? l.mask.enabled : false, styles: l.styles ? JSON.parse(JSON.stringify(l.styles)) : null, adjust: l.adjust ? JSON.parse(JSON.stringify(l.adjust)) : null, text: l.text ? { ...l.text } : null, groupId: l.groupId, isBackground: !!l.isBackground, clip: !!l.clip, vector: l.vector ? JSON.parse(JSON.stringify(l.vector)) : null, smart: l.smart ? { src: l.smart.src, xf: { ...l.smart.xf }, filters: l.smart.filters.slice() } : null };
            });
            // guides and paths are numbers on the canvas: a resize or crop moves them, so they come back too
            const keep = { guides: this.guides || [], paths: this.paths || [], workPath: this.workPath || null };
            return { width: this.width, height: this.height, active: this.active, editMask: !!this.editMask, layers, groups: JSON.parse(JSON.stringify(this.groups)), extras: JSON.parse(JSON.stringify(keep)), bytes };
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
                if (sl.mask) {
                    const mc = makeCanvas(s.width, s.height);
                    ctxOf(mc).drawImage(sl.mask, 0, 0);
                    l.setMaskCanvas(mc, sl.maskOn);
                }
                l.styles = sl.styles ? JSON.parse(JSON.stringify(sl.styles)) : null;
                l.adjust = sl.adjust ? JSON.parse(JSON.stringify(sl.adjust)) : null;
                l.text = sl.text ? { ...sl.text } : null;
                l.groupId = sl.groupId || null;
                l.isBackground = !!sl.isBackground;
                l.clip = !!sl.clip;
                l.vector = sl.vector ? JSON.parse(JSON.stringify(sl.vector)) : null;
                l.smart = sl.smart ? { src: sl.smart.src, xf: { ...sl.smart.xf }, filters: sl.smart.filters.slice() } : null;
                return l;
            });
            this.active = Math.min(s.active, this.layers.length - 1);
            this.editMask = !!(s.editMask && this.layers[this.active].mask);
            this.groups = s.groups ? JSON.parse(JSON.stringify(s.groups)) : [];
            if (s.extras) { const x = JSON.parse(JSON.stringify(s.extras)); this.guides = x.guides; this.paths = x.paths; this.workPath = x.workPath; }
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
            // paths and shape layers (paintPath.js)
            if (step.kind === 'paths') {
                if (root.paintPath) root.paintPath.applyState(this, step[which]);
                return;
            }
            // layer comps: visibility and appearance (paintComps.js)
            if (step.kind === 'props') {
                if (root.paintComps) root.paintComps.applyProps(this, step[which]);
                return;
            }
            const l = this.target(step.layerId);
            if (!l) return;
            l.ctx.putImageData(step[which], step.rect.x, step.rect.y);
            // a Smart Object's source, transform and filters go back with its pixels
            if (step.vector) l.vector = JSON.parse(JSON.stringify(step.vector[which]));
            if (step.smart) { const s = step.smart[which]; l.smart = s ? { src: s.src, xf: { ...s.xf }, filters: s.filters.slice() } : null; }
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
                    if (l.isBackground && opts.fill) {
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
                    if (l.mask) {
                        // new canvas is shown (white) on the mask
                        const mc = makeCanvas(w, h);
                        const mx = ctxOf(mc);
                        mx.fillStyle = '#fff';
                        mx.fillRect(0, 0, w, h);
                        if (opts.scale) mx.drawImage(l.mask.canvas, 0, 0, w, h);
                        else mx.drawImage(l.mask.canvas, Math.round((w - this.width) * ax), Math.round((h - this.height) * ay));
                        l.setMaskCanvas(mc, l.mask.enabled);
                    }
                });
                // what is kept as numbers moves (or scales) with the pixels: Smart Objects, shapes,
                // type, guides and paths
                const kx = opts.scale ? w / this.width : 1;
                const ky = opts.scale ? h / this.height : 1;
                const dx = opts.scale ? 0 : Math.round((w - this.width) * ax);
                const dy = opts.scale ? 0 : Math.round((h - this.height) * ay);
                const mapXY = (x, y) => [x * kx + dx, y * ky + dy];
                const mapPath = (path) => (path ? path.subs : []).forEach((sub) => sub.pts.forEach((q) => {
                    [q.x, q.y] = mapXY(q.x, q.y); [q.ix, q.iy] = mapXY(q.ix, q.iy); [q.ox, q.oy] = mapXY(q.ox, q.oy);
                }));
                this.layers.forEach((l) => {
                    if (l.smart) { const t = l.smart.xf; [t.cx, t.cy] = mapXY(t.cx, t.cy); t.w *= kx; t.h *= ky; }
                    if (l.vector) mapPath(l.vector.path);
                    if (l.text && !opts.scale) { l.text.x += dx; l.text.y += dy; }
                });
                (this.guides || []).forEach((g) => { g.pos = g.axis === 'h' ? g.pos * ky + dy : g.pos * kx + dx; });
                mapPath(this.workPath);
                (this.paths || []).forEach((sp) => mapPath(sp.path));
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
                    if (l.mask) l.setMaskCanvas(fn(l.mask.canvas), l.mask.enabled);
                    l.text = null;
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
                if (px[i] === m && src[i] !== m) mask[i] = 255;
            }
        }
        return { mask, rect };
    }

    /** The magic wand without Contiguous: every pixel near the clicked one's colour. */
    function colorMask(img, sx, sy, tolerance = 32) {
        const w = img.width;
        const px = new Uint32Array(img.data.buffer);
        const target = px[sy * w + sx];
        const tol = Math.round(tolerance * 2.55);
        const mask = new Uint8Array(px.length);
        let minX = w; let minY = img.height; let maxX = -1; let maxY = -1;
        for (let i = 0; i < px.length; i += 1) {
            if (!close(px[i], target, tol)) continue;
            mask[i] = 255;
            const x = i % w;
            const y = (i - x) / w;
            if (x < minX) minX = x;
            if (x > maxX) maxX = x;
            if (y < minY) minY = y;
            maxY = y;
        }
        return maxX < 0 ? null : { mask, rect: { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 } };
    }

    /** Fill without Contiguous: every pixel near the clicked one's colour takes the new one. */
    function replaceColor(img, sx, sy, rgba, tolerance = 0, mask) {
        const res = colorMask(img, sx, sy, tolerance);
        if (!res) return null;
        const px = new Uint32Array(img.data.buffer);
        const fill = (rgba[3] << 24 | rgba[2] << 16 | rgba[1] << 8 | rgba[0]) >>> 0;
        for (let i = 0; i < px.length; i += 1) if (res.mask[i] && (!mask || mask[i])) px[i] = fill;
        return res.rect;
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
            let k = 1;
            if (mask) {
                const p = i >> 2;
                const mx = rect.x + (p % rect.w);
                const my = rect.y + Math.floor(p / rect.w);
                const m = mask[my * maskW + mx];
                if (!m) continue;
                k = m / 255;
            }
            const o = fn(d[i], d[i + 1], d[i + 2]);
            if (k === 1) { d[i] = o[0]; d[i + 1] = o[1]; d[i + 2] = o[2]; } else {
                // a feathered selection's edge
                d[i] += (o[0] - d[i]) * k; d[i + 1] += (o[1] - d[i + 1]) * k; d[i + 2] += (o[2] - d[i + 2]) * k;
            }
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
        /** Layer ids from a file: later layers must not take them. */
        reserveIds(max) { if (max >= nextLayerId) nextLayerId = max + 1; },
        Document, Layer, BLENDS, renderLayer, hasEffects, adjusters, applyAdjustment, makeCanvas, ctxOf, clampRect, union, rectAround,
        parseColor, floodFill, wandMask, colorMask, replaceColor, convolve, mapPixels, rgbToHsl, hslToRgb, encodeBmp
    };
})(typeof window !== 'undefined' ? window : globalThis);
