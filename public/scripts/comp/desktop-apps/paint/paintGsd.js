/**
 * Graphic Session Document (.gsd), Melaton Paint's own file (Yozora #632; spec:
 * docs/paint-gsd-format.md): the whole window state without loss: layers (raw RGBA, deflated),
 * masks, styles, adjustment / type layers, groups, guides, the selection, the view, the tools
 * and the undo history.
 *
 *   paintGsd.encode(w, { history }) -> Promise<Blob>
 *   paintGsd.decode(arrayBuffer) -> Promise<state>     paintGsd.apply(w, state, { name, file })
 *   paintGsd.isGsd(arrayBuffer)
 */
(function (root) {
    'use strict';

    const C = () => root.PaintCore;
    const MAGIC = [0x47, 0x53, 0x44, 0x1a];
    const VERSION = 1;
    const MIME = 'application/x-graphic-session';
    const HISTORY_LIMIT = 256 * 1024 * 1024;

    async function deflate(bytes) {
        const s = new Blob([bytes]).stream().pipeThrough(new CompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(s).arrayBuffer());
    }

    async function inflate(bytes) {
        const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate-raw'));
        return new Uint8Array(await new Response(s).arrayBuffer());
    }

    // ---- writing -------------------------------------------------------------------------------

    function writer() {
        const blobs = [];
        const parts = [];
        let offset = 0;
        const add = async (bytes, meta) => {
            const data = await deflate(bytes);
            blobs.push({ offset, length: data.length, encoding: 'deflate-raw', ...meta });
            parts.push(data);
            offset += data.length;
            return blobs.length - 1;
        };
        return {
            blobs, parts,
            rgba(img) { return add(new Uint8Array(img.data.buffer, img.data.byteOffset, img.data.byteLength), { format: 'rgba8', width: img.width, height: img.height }); },
            canvas(c) { return this.rgba(c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height)); },
            gray(bytes, width, height) { return add(bytes, { format: 'gray8', width, height }); }
        };
    }

    async function selectionOut(out, d, s) {
        if (!s) return null;
        const o = { x: s.x, y: s.y, w: s.w, h: s.h };
        if (s.path) o.path = s.path.map((p) => ({ x: p.x, y: p.y }));
        if (s.mask) {
            // only the selection's box of the picture-sized mask
            const crop = new Uint8Array(s.w * s.h);
            for (let y = 0; y < s.h; y += 1) crop.set(s.mask.subarray((s.y + y) * d.width + s.x, (s.y + y) * d.width + s.x + s.w), y * s.w);
            o.mask = await out.gray(crop, s.w, s.h);
        }
        return o;
    }

    async function layerOut(out, l, canvas, maskCanvas, maskOn) {
        return {
            id: l.id, name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: !!l.locked,
            groupId: l.groupId || null,
            pixels: await out.canvas(canvas || l.canvas),
            mask: maskCanvas ? { pixels: await out.canvas(maskCanvas), enabled: maskOn !== false } : null,
            styles: l.styles || null,
            adjust: l.adjust ? { kind: l.adjust.kind, params: l.adjust.params } : null,
            text: l.text || null,
            isBackground: !!l.isBackground
        };
    }

    async function snapshotOut(out, s) {
        const layers = [];
        for (const sl of s.layers) layers.push(await layerOut(out, sl, sl.canvas, sl.mask, sl.maskOn));
        return { width: s.width, height: s.height, active: s.active, editMask: !!s.editMask, groups: s.groups || [], layers };
    }

    async function encode(w, opts = {}) {
        w.commitFloating();
        w.finishText();
        const d = w.doc;
        const out = writer();
        const layers = [];
        // progress: each layer, then each history step, is one part
        const parts = d.layers.length + (opts.history !== false ? d.history.length : 0);
        let partNo = 0;
        const tick = () => { partNo += 1; if (opts.onProgress) opts.onProgress(partNo / parts, partNo, parts); };
        for (const l of d.layers) { layers.push(await layerOut(out, l, l.canvas, l.mask && l.mask.canvas, l.mask ? l.mask.enabled : true)); tick(); }
        const P = root.paintPro;
        const L = root.paintLayers;
        const has = (cls) => w.modal.classList.contains(cls);
        const manifest = {
            format: 'gsd', version: VERSION, generator: 'Melaton Paint', saved: new Date().toISOString(), name: w.name,
            blobs: out.blobs,
            document: {
                width: d.width, height: d.height, active: d.active, editMask: !!d.editMask, layers,
                groups: JSON.parse(JSON.stringify(d.groups || [])),
                guides: JSON.parse(JSON.stringify(d.guides || [])),
                selection: await selectionOut(out, d, d.selection),
                lastSelection: await selectionOut(out, d, w.lastSelection && w.lastSelection !== d.selection ? w.lastSelection : null)
            },
            view: {
                zoom: w.zoom, scrollLeft: w.workspace.scrollLeft, scrollTop: w.workspace.scrollTop,
                grid: !!w.grid, rulers: !!w.rulers, guidesShown: w.guidesShown !== false, guidesLocked: !!w.guidesLocked, snap: w.snapOn !== false,
                panels: [
                    L && L.isOpen(w) ? 'layers' : null, L && L.historyOpen(w) ? 'history' : null,
                    P && P.navOpen(w) ? 'navigator' : null, P && P.infoOpen(w) ? 'info' : null
                ].filter(Boolean),
                hidden: [['mp-no-tools', 'tools'], ['mp-no-colors', 'colors'], ['mp-no-status', 'status'], ['mp-no-settings', 'settings']].filter(([c]) => has(c)).map(([, n]) => n)
            },
            tools: { tool: w.tool, fg: w.fg, bg: w.bg, options: { ...w.opt }, text: w.textFont() }
        };
        let flags = 0;
        if (opts.history !== false) {
            if ((d.historyBytes || 0) <= HISTORY_LIMIT) {
                const steps = [];
                for (const st of d.history) {
                    if (st.kind === 'snapshot') steps.push({ label: st.label, kind: 'snapshot', before: await snapshotOut(out, st.before), after: await snapshotOut(out, st.after) });
                    else steps.push({ label: st.label, kind: 'pixels', layerId: st.layerId, rect: st.rect, before: await out.rgba(st.before), after: await out.rgba(st.after) });
                    tick();
                }
                manifest.history = { index: d.historyIndex, steps };
                flags |= 1;
            } else manifest.historyDropped = 'larger than 256 MB';
        }
        const json = new TextEncoder().encode(JSON.stringify(manifest));
        const head = new ArrayBuffer(12);
        const dv = new DataView(head);
        MAGIC.forEach((b, i) => dv.setUint8(i, b));
        dv.setUint16(4, VERSION, true);
        dv.setUint16(6, flags, true);
        dv.setUint32(8, json.length, true);
        return new Blob([head, json, ...out.parts], { type: MIME });
    }

    // ---- reading -------------------------------------------------------------------------------

    function isGsd(buf) {
        const b = new Uint8Array(buf, 0, Math.min(4, buf.byteLength));
        return b.length === 4 && MAGIC.every((v, i) => b[i] === v);
    }

    async function decode(buf) {
        if (!isGsd(buf)) throw new Error('This is not a Graphic Session Document.');
        const dv = new DataView(buf);
        const version = dv.getUint16(4, true);
        if (version > VERSION) throw new Error(`This document was saved by a newer Paint (format ${version}).`);
        const len = dv.getUint32(8, true);
        const manifest = JSON.parse(new TextDecoder().decode(new Uint8Array(buf, 12, len)));
        const area = 12 + len;
        const cache = new Map();
        const bytes = async (i) => {
            if (cache.has(i)) return cache.get(i);
            const b = manifest.blobs[i];
            if (!b) throw new Error(`The document is damaged (blob ${i}).`);
            const raw = new Uint8Array(buf, area + b.offset, b.length);
            const data = b.encoding === 'deflate-raw' ? await inflate(raw) : raw.slice();
            cache.set(i, data);
            return data;
        };
        const image = async (i) => {
            const b = manifest.blobs[i];
            const data = await bytes(i);
            return new ImageData(new Uint8ClampedArray(data.buffer, data.byteOffset, b.width * b.height * 4), b.width, b.height);
        };
        const canvas = async (i) => {
            const img = await image(i);
            const c = C().makeCanvas(img.width, img.height);
            c.getContext('2d', { willReadFrequently: true }).putImageData(img, 0, 0);
            return c;
        };
        return { manifest, version, flags: dv.getUint16(6, true), bytes, image, canvas };
    }

    async function layerIn(state, W, H, sl) {
        const l = new (C().Layer)(W, H, sl.name);
        l.id = sl.id;
        l.ctx.drawImage(await state.canvas(sl.pixels), 0, 0);
        l.visible = sl.visible !== false;
        l.opacity = typeof sl.opacity === 'number' ? sl.opacity : 1;
        l.blend = sl.blend || 'normal';
        l.locked = !!sl.locked;
        l.groupId = sl.groupId || null;
        if (sl.mask) l.setMaskCanvas(await state.canvas(sl.mask.pixels), sl.mask.enabled !== false);
        l.styles = sl.styles || null;
        l.adjust = sl.adjust ? { kind: sl.adjust.kind, params: sl.adjust.params } : null;
        l.text = sl.text || null;
        l.isBackground = !!sl.isBackground;
        return l;
    }

    async function selectionIn(state, W, H, s) {
        if (!s) return null;
        const o = { x: s.x, y: s.y, w: s.w, h: s.h };
        if (s.path) o.path = s.path;
        if (s.mask !== undefined && s.mask !== null) {
            const crop = await state.bytes(s.mask);
            const m = new Uint8Array(W * H);
            for (let y = 0; y < s.h; y += 1) m.set(crop.subarray(y * s.w, y * s.w + s.w), (s.y + y) * W + s.x);
            o.mask = m;
        }
        return o;
    }

    /** A snapshot for the history, in the shape PaintCore's Document.snapshot() makes. */
    async function snapshotIn(state, s) {
        const layers = [];
        let bytes = 0;
        for (const sl of s.layers) {
            const c = await state.canvas(sl.pixels);
            bytes += s.width * s.height * 4;
            let mask = null;
            if (sl.mask) { mask = await state.canvas(sl.mask.pixels); bytes += s.width * s.height * 4; }
            layers.push({ id: sl.id, name: sl.name, canvas: c, visible: sl.visible !== false, opacity: sl.opacity, blend: sl.blend, locked: !!sl.locked,
                mask, maskOn: sl.mask ? sl.mask.enabled !== false : false, styles: sl.styles || null, adjust: sl.adjust || null, text: sl.text || null, groupId: sl.groupId || null, isBackground: !!sl.isBackground });
        }
        return { width: s.width, height: s.height, active: s.active, editMask: !!s.editMask, groups: s.groups || [], layers, bytes };
    }

    /** Put a decoded document into a Paint window. */
    async function apply(w, state, info = {}, onProgress) {
        const m = state.manifest;
        const D = m.document;
        const W = D.width;
        const H = D.height;
        w.newDocument(W, H, { file: info.file });
        const d = w.doc;
        const layers = [];
        let maxId = 0;
        const parts = D.layers.length + (m.history ? m.history.steps.length : 0);
        let partNo = 0;
        const tick = () => { partNo += 1; if (onProgress) onProgress(partNo / parts, partNo, parts); };
        for (const sl of D.layers) { layers.push(await layerIn(state, W, H, sl)); maxId = Math.max(maxId, sl.id); tick(); }
        (D.groups || []).forEach((g) => { maxId = Math.max(maxId, g.id); });
        d.layers = layers;
        d.groups = D.groups || [];
        d.guides = D.guides || [];
        d.active = Math.min(Math.max(0, D.active || 0), layers.length - 1);
        d.editMask = !!(D.editMask && layers[d.active] && layers[d.active].mask);
        d.selection = await selectionIn(state, W, H, D.selection);
        w.lastSelection = await selectionIn(state, W, H, D.lastSelection);
        // the history comes back as it was: Undo works on a reopened document
        d.history = [];
        d.historyIndex = -1;
        d.historyBytes = 0;
        if (m.history) {
            for (const st of m.history.steps) {
                if (st.kind === 'snapshot') {
                    const before = await snapshotIn(state, st.before);
                    const after = await snapshotIn(state, st.after);
                    st.before.layers.concat(st.after.layers).forEach((x) => { maxId = Math.max(maxId, x.id); });
                    d.history.push({ label: st.label, kind: 'snapshot', before, after, bytes: before.bytes + after.bytes });
                } else {
                    const before = await state.image(st.before);
                    const after = await state.image(st.after);
                    d.history.push({ label: st.label, kind: 'pixels', layerId: st.layerId, rect: st.rect, before, after, bytes: st.rect.w * st.rect.h * 8 });
                }
                d.historyBytes += d.history[d.history.length - 1].bytes;
                tick();
            }
            d.historyIndex = Math.min(m.history.index, d.history.length - 1);
        }
        C().reserveIds(maxId);
        // the window: tools, colours, view, panels
        const t = m.tools || {};
        if (t.options) Object.assign(w.opt, t.options);
        if (t.fg) w.fg = t.fg;
        if (t.bg) w.bg = t.bg;
        w.renderColors();
        if (t.text && root.melatonRegistry) {
            void root.melatonRegistry.set('HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint', {
                TextFace: t.text.face, TextSize: t.text.size, TextBold: !!t.text.bold, TextItalic: !!t.text.italic, TextUnderline: !!t.text.underline
            });
        }
        if (t.tool && w.tools[t.tool]) w.setTool(t.tool);
        w.syncSettings();
        if (w.opt.selMode) w.setSelMode(w.opt.selMode);
        const v = m.view || {};
        w.grid = !!v.grid;
        w.guidesShown = v.guidesShown !== false;
        w.guidesLocked = !!v.guidesLocked;
        w.snapOn = v.snap !== false;
        if (!!v.rulers !== !!w.rulers) w.toggleRulers();
        [['tools', 'mp-no-tools'], ['colors', 'mp-no-colors'], ['status', 'mp-no-status'], ['settings', 'mp-no-settings']]
            .forEach(([n, c]) => w.modal.classList.toggle(c, (v.hidden || []).includes(n)));
        const L = root.paintLayers;
        const P = root.paintPro;
        const want = new Set(v.panels || []);
        if (L && want.has('layers') !== L.isOpen(w)) L.toggle(w);
        if (L && want.has('history') !== L.historyOpen(w)) L.toggleHistory(w);
        if (P && want.has('navigator') !== P.navOpen(w)) P.toggleNavigator(w);
        if (P && want.has('info') !== P.infoOpen(w)) P.toggleInfo(w);
        w.name = (info.name || m.name || 'Untitled').replace(/\.[^.]+$/, '');
        w.file = info.file || null;
        w.dirtyDoc = false;
        w.title();
        d.markDirty();
        d.emit('layers');
        d.emit('history');
        w.setZoom(v.zoom || 1);
        w.drawAnts();
        w.sizeStatus();
        requestAnimationFrame(() => {
            w.workspace.scrollLeft = v.scrollLeft || 0;
            w.workspace.scrollTop = v.scrollTop || 0;
        });
    }

    root.paintGsd = { encode, decode, apply, isGsd, MIME };
})(typeof window !== 'undefined' ? window : globalThis);
