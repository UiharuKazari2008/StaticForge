/**
 * Paint's Smart Objects (Yozora #632), Photoshop's: a layer that keeps its source picture, so
 * scaling, turning and filtering it never loses anything.
 *
 *   layer.smart = { src, xf: { cx, cy, w, h, angle, flipX, flipY }, filters: [{ id, label, vals, pad, make }] }
 *   layer.canvas  the source drawn through xf, then the smart filters in order (a cache)
 *
 *   Free Transform and the Move tool change xf and draw again from the source; a filter from the
 *   Filter or Adjustments menus (one with no selection) becomes a smart filter; painting, or any
 *   other change to the pixels, rasterizes the layer first (Photoshop asks; Paint says so).
 *   Edit Contents opens the source in its own window: what is done there comes back at once.
 *
 *   paintSmart.convert(w) / rasterize(w, l) / render(l, W, H) / editContents(w) / placeEmbedded(w)
 *   paintSmart.addFilter(w, S, f) / restoreFilters(w, l, list) / menu(w) / action(w, a)
 */
(function (root) {
    'use strict';

    const C = () => root.PaintCore;

    /** The xf of a source laid at x, y at its own size. */
    function placeXf(src, x, y) {
        return { cx: x + src.width / 2, cy: y + src.height / 2, w: src.width, h: src.height, angle: 0, flipX: 1, flipY: 1 };
    }

    function infoFor(W, H) {
        return { x0: 0, y0: 0, rx: 0, ry: 0, rw: W, rh: H, W, H };
    }

    /** The layer's pixels again from the source, the transform and the smart filters. */
    function render(l, W, H) {
        const s = l.smart;
        if (!s) return;
        const ctx = l.ctx;
        const t = s.xf;
        ctx.save();
        ctx.setTransform(1, 0, 0, 1, 0, 0);
        ctx.globalAlpha = 1;
        ctx.globalCompositeOperation = 'source-over';
        ctx.clearRect(0, 0, W, H);
        ctx.imageSmoothingEnabled = true;
        ctx.imageSmoothingQuality = 'high';
        ctx.translate(t.cx, t.cy);
        ctx.rotate(t.angle);
        ctx.scale(t.flipX, t.flipY);
        ctx.drawImage(s.src, -t.w / 2, -t.h / 2, t.w, t.h);
        ctx.restore();
        const live = s.filters.filter((f) => f.make && f.on !== false);
        if (!live.length) return;
        let img = ctx.getImageData(0, 0, W, H);
        live.forEach((f) => {
            try { img = f.make(f.vals)(img, infoFor(W, H), f.vals) || img; } catch (err) { console.error('smart filter', f.label, err); }
        });
        ctx.putImageData(img, 0, 0);
    }

    function cloneState(s) {
        return s ? { src: s.src, xf: { ...s.xf }, filters: s.filters.slice() } : null;
    }

    /** A history step that also puts the Smart Object's state back (paintCore's apply). */
    function stamp(step, l, before) {
        step.smart = { before, after: cloneState(l.smart) };
    }

    /** Layer > Smart Objects > Convert to Smart Object: its pixels (their box) become the source. */
    function convert(w) {
        const d = w.doc;
        const l = d.activeLayer;
        if (l.smart) { w.status('This layer is a Smart Object already.'); return; }
        if (l.adjust) { w.status('An adjustment layer cannot be a Smart Object.'); return; }
        if (l.isBackground) { w.status('Make the Background a layer first (Layer from Background).'); return; }
        w.finishText();
        w.commitFloating();
        const b = w.layerBounds(l);
        if (!b) { w.status('The layer is empty.'); return; }
        d.snapshotStep('Convert to Smart Object', () => {
            const src = C().makeCanvas(b.w, b.h);
            src.getContext('2d').drawImage(l.canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
            l.smart = { src, xf: placeXf(src, b.x, b.y), filters: [] };
            // a type layer's text goes into the source as pixels
            l.text = null;
            render(l, d.width, d.height);
        });
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    /** Layer > Smart Objects > Rasterize: the pixels as they are, the source dropped. */
    function rasterize(w, l = w.doc.activeLayer, quiet) {
        if (!l.smart) return;
        w.doc.snapshotStep('Rasterize Layer', () => { l.smart = null; });
        if (!quiet) w.status(`${l.name} was rasterized: it is no longer a Smart Object.`);
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    /** A filter run on a Smart Object (no selection): it joins the smart filters. */
    function addFilter(w, S, f) {
        const l = S.l;
        if (!l.smart) return;
        const before = cloneState(l.smart);
        l.smart.filters.push({ id: f.id || null, label: f.label, vals: f.vals || [], pad: f.pad || 0, make: f.make, on: true });
        render(l, w.doc.width, w.doc.height);
        S.step.grow({ x: 0, y: 0, w: w.doc.width, h: w.doc.height });
        stamp(S.step, l, before);
        w.doc.markDirty();
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    /**
     * The maker of a filter by its menu action, without its dialog: the action runs with
     * w.captureMaker set, and filterDialog / filterNow hand over their maker instead of opening.
     */
    function makerOf(w, id) {
        if (!id || !root.paintPro) return null;
        let got = null;
        w.captureMaker = (m) => { got = m; };
        try { root.paintPro.action(w, id); } catch (err) { console.error('smart filter', id, err); }
        w.captureMaker = null;
        return got;
    }

    /** Smart filters read back from a .gsd: their makers found again by action. */
    function restoreFilters(w, l, list) {
        if (!l.smart || !Array.isArray(list)) return;
        l.smart.filters = list.map((f) => {
            const m = makerOf(w, f.id);
            return { id: f.id, label: f.label, vals: f.vals || [], pad: f.pad || 0, on: f.on !== false, make: m ? m.make : null };
        });
    }

    function clearFilters(w) {
        const l = w.doc.activeLayer;
        if (!l.smart || !l.smart.filters.length) return;
        const before = cloneState(l.smart);
        const step = w.doc.beginStep('Clear Smart Filters', l);
        l.smart.filters = [];
        render(l, w.doc.width, w.doc.height);
        step.grow({ x: 0, y: 0, w: w.doc.width, h: w.doc.height });
        stamp(step, l, before);
        w.doc.commitStep(step);
        w.doc.markDirty();
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    /** Free Transform's result on a Smart Object: the new xf, the pixels drawn from the source. */
    function commitTransform(w, l, t) {
        const before = cloneState(l.smart);
        l.smart.xf = { cx: t.cx, cy: t.cy, w: t.w, h: t.h, angle: t.angle, flipX: t.flipX, flipY: t.flipY };
        render(l, w.doc.width, w.doc.height);
        t.step.grow({ x: 0, y: 0, w: w.doc.width, h: w.doc.height });
        stamp(t.step, l, before);
    }

    /** The Move tool's drag on a Smart Object: the source moves (and the filters run again). */
    function moved(w, l, step, dx, dy) {
        const before = cloneState(l.smart);
        l.smart.xf.cx += dx;
        l.smart.xf.cy += dy;
        render(l, w.doc.width, w.doc.height);
        stamp(step, l, before);
    }

    /** Layer > Smart Objects > Edit Contents: the source in its own Paint window. */
    async function editContents(w) {
        const l = w.doc.activeLayer;
        if (!l.smart || typeof root.openMelatonPaint !== 'function') return;
        const child = await root.openMelatonPaint();
        if (!child) return;
        const src = l.smart.src;
        child.newDocument(src.width, src.height, { transparent: true });
        child.doc.layers[0].ctx.drawImage(src, 0, 0);
        child.doc.layers[0].name = l.name;
        child.name = `${l.name}.psb`;
        child.smartParent = { w, l };
        child.dirtyDoc = false;
        child.doc.markDirty();
        child.title();
        child.emitPanels();
        child.status('Edit the Smart Object\'s contents: every change goes back to the layer.');
        let timer = 0;
        child.doc.on((kind) => {
            if (kind !== 'history') return;
            clearTimeout(timer);
            timer = setTimeout(() => pushContents(child), 250);
        });
    }

    /** The child window's picture back into its Smart Object (one history step in the parent). */
    function pushContents(child) {
        const p = child.smartParent;
        if (!p || !p.w.doc.layers.includes(p.l) || !p.l.smart) return false;
        const { w, l } = p;
        const before = cloneState(l.smart);
        const step = w.doc.beginStep('Update Smart Object', l);
        const flat = child.doc.flattened();
        const old = l.smart.src;
        l.smart.src = flat;
        // a source that changed size keeps its scale on the canvas
        if (old && (old.width !== flat.width || old.height !== flat.height)) {
            l.smart.xf.w *= flat.width / old.width;
            l.smart.xf.h *= flat.height / old.height;
        }
        render(l, w.doc.width, w.doc.height);
        step.grow({ x: 0, y: 0, w: w.doc.width, h: w.doc.height });
        stamp(step, l, before);
        w.doc.commitStep(step);
        w.doc.markDirty();
        child.dirtyDoc = false;
        return true;
    }

    /** File > Place Embedded: a picture from Documents as a new Smart Object, fitted and centred. */
    function placeEmbedded(w) {
        if (typeof root.studioOpenFolderDialog !== 'function') return;
        void root.studioOpenFolderDialog('open-vfs', {
            owner: w.modal,
            host: {
                title: 'Place Embedded',
                rejectMessage: 'Choose a picture',
                acceptItem: (item) => item && item.targetKind === 'user-file' && /^image\//.test(item.mimeType || ''),
                async onOpen(item) {
                    const img = await w.downloadPicture(item, 'Placing');
                    if (!img) return;
                    place(w, img, item.name.replace(/\.[^.]+$/, ''));
                }
            }
        });
    }

    function place(w, img, name) {
        const d = w.doc;
        const src = C().makeCanvas(img.naturalWidth || img.width, img.naturalHeight || img.height);
        src.getContext('2d').drawImage(img, 0, 0);
        // Photoshop fits a bigger picture inside the canvas
        const k = Math.min(1, d.width / src.width, d.height / src.height);
        let made = null;
        d.snapshotStep('Place Embedded', () => {
            made = d.addLayer(name);
            made.smart = { src, xf: { cx: d.width / 2, cy: d.height / 2, w: src.width * k, h: src.height * k, angle: 0, flipX: 1, flipY: 1 }, filters: [] };
            render(made, d.width, d.height);
        });
        if (root.paintLayers) root.paintLayers.refresh(w);
        // and its transform box, as Photoshop leaves it
        if (made) { w.setTool('move'); w.startTransform(); }
        return made;
    }

    function menu(w) {
        const l = w.doc.activeLayer;
        const s = l.smart;
        return [
            { text: 'Convert to Smart Object', action: 'smart-convert', disabled: !!s || !!l.adjust },
            { separator: true },
            { text: 'Edit Contents', action: 'smart-edit', disabled: !s },
            { text: 'Clear Smart Filters', action: 'smart-clear-filters', disabled: !s || !s.filters.length },
            { text: 'Rasterize', action: 'smart-rasterize', disabled: !s }
        ];
    }

    function action(w, a) {
        switch (a) {
            case 'smart-convert': convert(w); return true;
            case 'smart-edit': void editContents(w); return true;
            case 'smart-clear-filters': clearFilters(w); return true;
            case 'smart-rasterize': rasterize(w); return true;
            case 'place-embedded': placeEmbedded(w); return true;
            default: return false;
        }
    }

    root.paintSmart = { render, convert, rasterize, addFilter, restoreFilters, makerOf, commitTransform, moved, editContents, pushContents, placeEmbedded, place, menu, action, cloneState };
})(typeof window !== 'undefined' ? window : globalThis);
