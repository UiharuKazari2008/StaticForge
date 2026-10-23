/**
 * Photoshop documents (.psd) in Paint (Yozora #632), after Adobe's "Photoshop File Formats
 * Specification" (version 1 files, 8 bits per channel, RGB; grayscale opens too).
 *
 *   export  every layer with its name, blend mode, opacity, visibility, lock and layer mask;
 *           groups as Photoshop's group / divider pairs; guides (image resource 1032); the
 *           merged picture; adjustment layers Photoshop keeps in plain binary (Levels, Curves,
 *           Hue/Saturation, Brightness/Contrast, Exposure, Color Balance, Invert, Posterize,
 *           Threshold). Layer styles are drawn into the layer's pixels and type layers go as
 *           pixels (their text in the layer name); report() lists what was simplified.
 *   import  the same back, plus RLE / ZIP channel data, unicode names (luni), and a flat PSD
 *           from its merged picture. Layer styles, type and other adjustments Photoshop keeps
 *           as descriptors come in as their pixels (or not at all) and are listed.
 *
 *   paintPsd.encode(w) -> Promise<{ blob, notes }>     paintPsd.decode(arrayBuffer) -> doc state
 *   paintPsd.apply(w, state, { name, file })          paintPsd.isPsd(arrayBuffer)
 */
(function (root) {
    'use strict';

    const C = () => root.PaintCore;
    const MIME = 'image/vnd.adobe.photoshop';
    const BLEND_TO_PSD = {
        normal: 'norm', multiply: 'mul ', screen: 'scrn', overlay: 'over', darken: 'dark', lighten: 'lite',
        'color-dodge': 'div ', 'color-burn': 'idiv', 'hard-light': 'hLit', 'soft-light': 'sLit', difference: 'diff',
        exclusion: 'smud', hue: 'hue ', saturation: 'sat ', color: 'colr', luminosity: 'lum ', additive: 'lddg'
    };
    const PSD_TO_BLEND = Object.fromEntries(Object.entries(BLEND_TO_PSD).map(([k, v]) => [v, k]));
    PSD_TO_BLEND.pass = 'normal';
    PSD_TO_BLEND.diss = 'normal';
    PSD_TO_BLEND['lbrn'] = 'color-burn';
    PSD_TO_BLEND['lLit'] = 'hard-light';
    PSD_TO_BLEND['vLit'] = 'hard-light';
    PSD_TO_BLEND['pLit'] = 'hard-light';
    PSD_TO_BLEND['hMix'] = 'hard-light';
    PSD_TO_BLEND['dkCl'] = 'darken';
    PSD_TO_BLEND['lgCl'] = 'lighten';
    PSD_TO_BLEND['fsub'] = 'difference';
    PSD_TO_BLEND['fdiv'] = 'color-dodge';

    // ---- bytes ---------------------------------------------------------------------------------

    class Out {
        constructor() { this.buf = new Uint8Array(1 << 16); this.n = 0; }
        room(k) {
            if (this.n + k <= this.buf.length) return;
            let size = this.buf.length * 2;
            while (size < this.n + k) size *= 2;
            const b = new Uint8Array(size);
            b.set(this.buf.subarray(0, this.n));
            this.buf = b;
        }
        u8(v) { this.room(1); this.buf[this.n++] = v & 255; }
        u16(v) { this.u8(v >> 8); this.u8(v); }
        i16(v) { this.u16(v < 0 ? v + 65536 : v); }
        u32(v) { this.u16((v >>> 16) & 0xffff); this.u16(v & 0xffff); }
        i32(v) { this.u32(v >>> 0); }
        f32(v) { const d = new DataView(new ArrayBuffer(4)); d.setFloat32(0, v); for (let i = 0; i < 4; i += 1) this.u8(d.getUint8(i)); }
        str(s) { for (let i = 0; i < s.length; i += 1) this.u8(s.charCodeAt(i)); }
        bytes(b) { this.room(b.length); this.buf.set(b, this.n); this.n += b.length; }
        pad(to) { while (this.n % to) this.u8(0); }
        /** A u32 length written before what fn writes. */
        block(fn, padTo = 1) {
            const at = this.n;
            this.u32(0);
            fn();
            if (padTo > 1) this.pad(padTo);
            const len = this.n - at - 4;
            this.buf[at] = len >>> 24; this.buf[at + 1] = len >>> 16; this.buf[at + 2] = len >>> 8; this.buf[at + 3] = len;
        }
        done() { return this.buf.slice(0, this.n); }
    }

    class In {
        constructor(buf) { this.d = new DataView(buf); this.b = new Uint8Array(buf); this.p = 0; }
        u8() { return this.b[this.p++]; }
        u16() { const v = this.d.getUint16(this.p); this.p += 2; return v; }
        i16() { const v = this.d.getInt16(this.p); this.p += 2; return v; }
        u32() { const v = this.d.getUint32(this.p); this.p += 4; return v; }
        i32() { const v = this.d.getInt32(this.p); this.p += 4; return v; }
        f32() { const v = this.d.getFloat32(this.p); this.p += 4; return v; }
        str(n) { let s = ''; for (let i = 0; i < n; i += 1) s += String.fromCharCode(this.b[this.p++]); return s; }
        bytes(n) { const v = this.b.subarray(this.p, this.p + n); this.p += n; return v; }
        // a length must be read before it is added (r.p += r.u32() would add to the old place)
        skip(n) { this.p += n; }
    }

    /** PackBits, one row. */
    function packRow(src, start, len, out) {
        let i = 0;
        while (i < len) {
            // a run of the same byte
            let run = 1;
            while (i + run < len && run < 128 && src[start + i + run] === src[start + i]) run += 1;
            if (run >= 2) {
                out.push(257 - run, src[start + i]);
                i += run;
                continue;
            }
            // literal bytes up to the next run of three (or 128)
            let lit = 1;
            while (i + lit < len && lit < 128 && !(i + lit + 2 < len && src[start + i + lit] === src[start + i + lit + 1] && src[start + i + lit] === src[start + i + lit + 2])) lit += 1;
            out.push(lit - 1);
            for (let k = 0; k < lit; k += 1) out.push(src[start + i + k]);
            i += lit;
        }
    }

    function unpack(src, len, out, at) {
        let i = 0;
        let o = at;
        const end = at + len;
        while (o < end && i < src.length) {
            let n = src[i++];
            if (n > 127) n -= 256;
            if (n >= 0) {
                for (let k = 0; k <= n && o < end; k += 1) out[o++] = src[i++];
            } else if (n !== -128) {
                const v = src[i++];
                for (let k = 0; k < 1 - n && o < end; k += 1) out[o++] = v;
            }
        }
        return i;
    }

    /** One channel (w x h bytes) as RLE: compression 1, the row byte counts, the rows. */
    function rleChannel(plane, w, h) {
        const rows = [];
        const counts = [];
        for (let y = 0; y < h; y += 1) {
            const r = [];
            packRow(plane, y * w, w, r);
            rows.push(r);
            counts.push(r.length);
        }
        const out = new Out();
        out.u16(1);
        counts.forEach((c) => out.u16(c));
        rows.forEach((r) => out.bytes(Uint8Array.from(r)));
        return out.done();
    }

    // ---- export --------------------------------------------------------------------------------

    function planesOf(canvas, r) {
        const img = canvas.getContext('2d', { willReadFrequently: true }).getImageData(r.x, r.y, r.w, r.h).data;
        const n = r.w * r.h;
        const p = [new Uint8Array(n), new Uint8Array(n), new Uint8Array(n), new Uint8Array(n)];
        for (let i = 0; i < n; i += 1) { p[0][i] = img[i * 4]; p[1][i] = img[i * 4 + 1]; p[2][i] = img[i * 4 + 2]; p[3][i] = img[i * 4 + 3]; }
        return p;
    }

    function bounds(canvas, W, H) {
        const d = canvas.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
        let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
        for (let y = 0; y < H; y += 1) {
            for (let x = 0; x < W; x += 1) {
                if (d[(y * W + x) * 4 + 3]) {
                    if (x < x0) x0 = x;
                    if (x > x1) x1 = x;
                    if (y < y0) y0 = y;
                    y1 = y;
                }
            }
        }
        return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
    }

    function info(out, key, fn) {
        out.str('8BIM');
        out.str(key);
        out.block(fn, 2);
    }

    function unicodeName(out, name) {
        info(out, 'luni', () => {
            out.u32(name.length);
            for (let i = 0; i < name.length; i += 1) out.u16(name.charCodeAt(i));
        });
    }

    function pascal(out, name) {
        // MacRoman: plain ASCII here, the full name goes in luni
        const s = name.replace(/[^\x20-\x7e]/g, '_').slice(0, 255);
        out.u8(s.length);
        out.str(s);
        const used = s.length + 1;
        for (let k = used; k % 4; k += 1) out.u8(0);
    }

    const HUE_RANGES = [[315, 345, 15, 45], [15, 45, 75, 105], [75, 105, 135, 165], [135, 165, 195, 225], [195, 225, 255, 285], [255, 285, 315, 345]];

    /** An adjustment layer's own block, for the kinds Photoshop keeps in plain binary. */
    function adjustmentBlock(out, a) {
        const p = a.params;
        switch (a.kind) {
            case 'invert': info(out, 'nvrt', () => {}); return true;
            case 'posterize': info(out, 'post', () => { out.u16(p ? p[0] : 4); out.u16(0); }); return true;
            case 'threshold': info(out, 'thrs', () => { out.u16(p ? p[0] : 128); out.u16(0); }); return true;
            case 'brightness': info(out, 'brit', () => { out.i16(p ? p[0] : 0); out.i16(p ? p[1] : 0); out.i16(127); out.u8(0); }); return true;
            case 'exposure': info(out, 'expA', () => { out.u16(1); out.f32(p ? p[0] : 0); out.f32(p ? p[1] : 0); out.f32(p ? p[2] : 1); }); return true;
            case 'balance': info(out, 'blnc', () => {
                for (let t = 0; t < 3; t += 1) for (let c = 0; c < 3; c += 1) out.i16(p ? p[t * 4 + 1 + c] || 0 : 0);
                out.u8(p && p[12] === false ? 0 : 1);
            }); return true;
            case 'hue': info(out, 'hue2', () => {
                out.u16(2);
                out.u8(p && p[3] ? 1 : 0);
                out.u8(0);
                // the colorize values, then the master values (Photoshop keeps both)
                out.i16(p ? ((p[0] % 360) + 360) % 360 : 0); out.i16(p ? Math.max(0, Math.round(25 + p[1] / 2)) : 25); out.i16(p ? p[2] : 0);
                out.i16(p ? p[0] : 0); out.i16(p ? p[1] : 0); out.i16(p ? p[2] : 0);
                HUE_RANGES.forEach((r) => { r.forEach((v) => out.i16(v)); out.i16(0); out.i16(0); out.i16(0); });
            }); return true;
            case 'levels': info(out, 'levl', () => {
                out.u16(2);
                const rec = (q) => { out.i16(q.inB); out.i16(q.inW); out.i16(q.outB); out.i16(q.outW); out.i16(Math.round(q.gamma * 100)); };
                const def = { inB: 0, inW: 255, outB: 0, outW: 255, gamma: 1 };
                ['rgb', 'r', 'g', 'b'].forEach((c) => rec((p && p[c]) || def));
                for (let k = 4; k < 29; k += 1) rec(def);
            }); return true;
            case 'curves': info(out, 'curv', () => {
                out.u8(0);
                out.u16(1);
                out.u32(0b1111);
                ['rgb', 'r', 'g', 'b'].forEach((c) => {
                    const pts = (p && p[c]) || [[0, 0], [255, 255]];
                    out.u16(pts.length);
                    pts.forEach(([x, y]) => { out.i16(y); out.i16(x); });
                });
            }); return true;
            default: return false;
        }
    }

    /**
     * One layer record and its channel data. what: { name, l (a Paint layer) | null, pixels canvas,
     * blend, opacity, visible, locked, mask canvas, maskOn, section (lsct type), sectionBlend }
     */
    function layerRecord(rec, data, W, H, what, notes) {
        const r = what.pixels ? bounds(what.pixels, W, H) : null;
        const channels = [];
        if (r) {
            const p = planesOf(what.pixels, r);
            channels.push([-1, rleChannel(p[3], r.w, r.h)], [0, rleChannel(p[0], r.w, r.h)], [1, rleChannel(p[1], r.w, r.h)], [2, rleChannel(p[2], r.w, r.h)]);
        } else {
            // no pixels: four empty raw channels
            [-1, 0, 1, 2].forEach((id) => channels.push([id, Uint8Array.from([0, 0])]));
        }
        if (what.mask) {
            const md = what.mask.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, W, H).data;
            const g = new Uint8Array(W * H);
            for (let i = 0; i < g.length; i += 1) g[i] = Math.round((0.299 * md[i * 4] + 0.587 * md[i * 4 + 1] + 0.114 * md[i * 4 + 2]) * (md[i * 4 + 3] / 255));
            channels.push([-2, rleChannel(g, W, H)]);
        }
        rec.i32(r ? r.y : 0); rec.i32(r ? r.x : 0); rec.i32(r ? r.y + r.h : 0); rec.i32(r ? r.x + r.w : 0);
        rec.u16(channels.length);
        channels.forEach(([id, bytes]) => { rec.i16(id); rec.u32(bytes.length); });
        rec.str('8BIM');
        rec.str(BLEND_TO_PSD[what.blend] || 'norm');
        rec.u8(Math.round((what.opacity === undefined ? 1 : what.opacity) * 255));
        rec.u8(0);
        // flags: bit 1 hidden; a group's two records say their pixels mean nothing (bits 3 and 4)
        rec.u8((what.visible === false ? 2 : 0) | (what.section ? 0x18 : 0));
        rec.u8(0);
        rec.block(() => {
            if (what.mask) {
                rec.u32(20);
                rec.i32(0); rec.i32(0); rec.i32(H); rec.i32(W);
                rec.u8(0);
                rec.u8(what.maskOn === false ? 2 : 0);
                rec.u16(0);
            } else rec.u32(0);
            rec.u32(0); // blending ranges
            pascal(rec, what.name);
            unicodeName(rec, what.name);
            if (what.locked) info(rec, 'lspf', () => rec.u32(0x80000000));
            if (what.section) {
                info(rec, 'lsct', () => {
                    rec.u32(what.section);
                    if (what.section !== 3) { rec.str('8BIM'); rec.str(what.sectionBlend === 'pass' ? 'pass' : BLEND_TO_PSD[what.sectionBlend] || 'norm'); }
                });
            }
            if (what.adjust && !adjustmentBlock(rec, what.adjust)) notes.add(`The ${what.name} adjustment layer has no Photoshop equivalent here and was left out.`);
        });
        channels.forEach(([, bytes]) => data.bytes(bytes));
    }

    async function encode(w) {
        w.commitFloating();
        w.finishText();
        const d = w.doc;
        const W = d.width;
        const H = d.height;
        const notes = new Set();
        const out = new Out();
        out.str('8BPS'); out.u16(1); for (let i = 0; i < 6; i += 1) out.u8(0);
        out.u16(3); out.u32(H); out.u32(W); out.u16(8); out.u16(3);
        out.u32(0); // colour mode data
        // image resources: resolution (72 dpi) and the guides
        out.block(() => {
            out.str('8BIM'); out.u16(1005); out.u16(0);
            out.block(() => { out.u32(72 << 16); out.u16(1); out.u16(1); out.u32(72 << 16); out.u16(1); out.u16(1); }, 2);
            if (d.guides.length) {
                out.str('8BIM'); out.u16(1032); out.u16(0);
                out.block(() => {
                    out.u32(1); out.u32(576); out.u32(576); out.u32(d.guides.length);
                    d.guides.forEach((g) => { out.u32(Math.round(g.pos * 32)); out.u8(g.axis === 'h' ? 1 : 0); });
                }, 2);
            }
        });
        // the layers, bottom first; a group is its divider, its layers, then its header
        const items = [];
        for (let i = 0; i < d.layers.length;) {
            const l = d.layers[i];
            const g = l.groupId ? d.group(l.groupId) : null;
            if (g) {
                items.push({ name: '</Layer group>', section: 3 });
                while (i < d.layers.length && d.layers[i].groupId === g.id) { items.push(layerItem(d.layers[i], W, H, notes)); i += 1; }
                items.push({ name: g.name, section: g.collapsed ? 2 : 1, sectionBlend: g.blend, blend: g.blend === 'pass' ? 'normal' : g.blend, opacity: g.opacity, visible: g.visible });
                continue;
            }
            items.push(layerItem(l, W, H, notes));
            i += 1;
        }
        const records = new Out();
        const data = new Out();
        items.forEach((it) => layerRecord(records, data, W, H, it, notes));
        out.block(() => {
            out.block(() => {
                out.i16(items.length);
                out.bytes(records.done());
                out.bytes(data.done());
            }, 2);
            out.u32(0); // global layer mask info
        });
        // the merged picture over white, three channels, RLE
        const flat = d.flattened({ background: '#ffffff' });
        const p = planesOf(flat, { x: 0, y: 0, w: W, h: H });
        out.u16(1);
        const rows = [];
        [0, 1, 2].forEach((c) => {
            for (let y = 0; y < H; y += 1) { const r = []; packRow(p[c], y * W, W, r); rows.push(r); }
        });
        rows.forEach((r) => out.u16(r.length));
        rows.forEach((r) => out.bytes(Uint8Array.from(r)));
        return { blob: new Blob([out.done()], { type: MIME }), notes: Array.from(notes) };
    }

    function layerItem(l, W, H, notes) {
        const it = { name: l.name, l, blend: l.blend, opacity: l.opacity, visible: l.visible, locked: l.locked };
        if (l.adjust) {
            it.adjust = l.adjust;
            if (l.mask) { it.mask = l.mask.canvas; it.maskOn = l.mask.enabled; }
            return it;
        }
        if (C().hasEffects(l)) {
            // Photoshop's styles are descriptors: the effects go into the pixels (with the mask)
            it.pixels = C().renderLayer(l, { x: 0, y: 0, w: W, h: H });
            notes.add(`The layer style of ${l.name} was drawn into its pixels.`);
            return it;
        }
        it.pixels = l.canvas;
        if (l.mask) { it.mask = l.mask.canvas; it.maskOn = l.mask.enabled; }
        if (l.text) {
            it.name = l.name;
            notes.add(`The text of ${l.name} went as pixels (Photoshop's type layers are not written).`);
        }
        return it;
    }

    // ---- import --------------------------------------------------------------------------------

    function isPsd(buf) {
        const b = new Uint8Array(buf, 0, Math.min(6, buf.byteLength));
        return b.length >= 6 && b[0] === 0x38 && b[1] === 0x42 && b[2] === 0x50 && b[3] === 0x53;
    }

    async function zlib(bytes) {
        const s = new Blob([bytes]).stream().pipeThrough(new DecompressionStream('deflate'));
        return new Uint8Array(await new Response(s).arrayBuffer());
    }

    /** One channel's pixels (w x h bytes) from its data (compression first). */
    async function channel(bytes, w, h) {
        const out = new Uint8Array(w * h);
        if (bytes.length < 2 || !w || !h) return out;
        const comp = (bytes[0] << 8) | bytes[1];
        const body = bytes.subarray(2);
        if (comp === 0) out.set(body.subarray(0, w * h));
        else if (comp === 1) {
            let at = h * 2;
            for (let y = 0; y < h; y += 1) {
                const n = (body[y * 2] << 8) | body[y * 2 + 1];
                unpack(body.subarray(at, at + n), w, out, y * w);
                at += n;
            }
        } else if (comp === 2 || comp === 3) {
            const raw = await zlib(body);
            out.set(raw.subarray(0, w * h));
            // ZIP with prediction: each byte is the difference to the one before it in the row
            if (comp === 3) for (let y = 0; y < h; y += 1) for (let x = 1; x < w; x += 1) out[y * w + x] = (out[y * w + x] + out[y * w + x - 1]) & 255;
        }
        return out;
    }

    function readAdjustment(key, r, len) {
        const end = r.p + len;
        try {
            switch (key) {
                case 'nvrt': return { kind: 'invert', params: [] };
                case 'post': return { kind: 'posterize', params: [r.u16()] };
                case 'thrs': return { kind: 'threshold', params: [r.u16()] };
                case 'brit': return { kind: 'brightness', params: [r.i16(), r.i16()] };
                case 'expA': { r.u16(); return { kind: 'exposure', params: [r.f32(), r.f32(), r.f32()] }; }
                case 'blnc': {
                    const v = [];
                    for (let t = 0; t < 3; t += 1) { v.push(null); for (let c = 0; c < 3; c += 1) v.push(r.i16()); }
                    v.push(r.u8() !== 0);
                    return { kind: 'balance', params: v };
                }
                case 'hue2': {
                    r.u16();
                    const colorize = r.u8() !== 0;
                    r.u8();
                    const ch = r.i16(); const cs = r.i16(); const cl = r.i16();
                    const h = r.i16(); const s = r.i16(); const l = r.i16();
                    return { kind: 'hue', params: colorize ? [ch > 180 ? ch - 360 : ch, (cs - 25) * 2, cl, true] : [h, s, l, false] };
                }
                case 'levl': {
                    r.u16();
                    const P = {};
                    ['rgb', 'r', 'g', 'b'].forEach((c) => { P[c] = { inB: r.i16(), inW: r.i16(), outB: r.i16(), outW: r.i16(), gamma: r.i16() / 100 }; });
                    return { kind: 'levels', params: P };
                }
                case 'curv': {
                    r.u8();
                    const version = r.u16();
                    const map = r.u32();
                    const P = {};
                    const names = ['rgb', 'r', 'g', 'b'];
                    for (let bit = 0; bit < 32 && r.p < end; bit += 1) {
                        if (!(map & (1 << bit))) continue;
                        const n = r.u16();
                        const pts = [];
                        for (let k = 0; k < n; k += 1) { const y = r.i16(); const x = r.i16(); pts.push([x, y]); }
                        if (bit < 4) P[names[bit]] = pts;
                    }
                    names.forEach((c) => { if (!P[c]) P[c] = [[0, 0], [255, 255]]; });
                    return version ? { kind: 'curves', params: P } : null;
                }
                default: return null;
            }
        } finally {
            r.p = end;
        }
    }

    const DESCRIPTOR_ADJUSTMENTS = { vibA: 'Vibrance', blwh: 'Black & White', phfl: 'Photo Filter', grdm: 'Gradient Map', mixr: 'Channel Mixer', selc: 'Selective Color', CgEd: 'Brightness/Contrast', clrL: 'Color Lookup', SoCo: 'Solid Color fill', GdFl: 'Gradient fill', PtFl: 'Pattern fill' };

    async function decode(buf) {
        if (!isPsd(buf)) throw new Error('This is not a Photoshop document.');
        const r = new In(buf);
        r.p = 4;
        const version = r.u16();
        if (version !== 1) throw new Error('Large Document Format (.psb) files are not supported.');
        r.p += 6;
        const nch = r.u16();
        const H = r.u32();
        const W = r.u32();
        const depth = r.u16();
        const mode = r.u16();
        if (depth !== 8) throw new Error(`Paint opens 8 bits per channel; this document has ${depth}.`);
        if (mode !== 3 && mode !== 1) throw new Error('Paint opens RGB and Grayscale documents; convert it in Photoshop first.');
        r.skip(r.u32()); // colour mode data
        const notes = new Set();
        const guides = [];
        const resEnd = r.u32() + r.p;
        while (r.p + 12 <= resEnd) {
            if (r.str(4) !== '8BIM') break;
            const id = r.u16();
            const nl = r.u8();
            r.p += nl + ((nl + 1) % 2);
            const len = r.u32();
            const at = r.p;
            if (id === 1032) {
                r.u32(); r.u32(); r.u32();
                const n = r.u32();
                for (let k = 0; k < n; k += 1) { const pos = r.u32() / 32; const dir = r.u8(); guides.push({ axis: dir === 1 ? 'h' : 'v', pos: Math.round(pos) }); }
            }
            r.p = at + len + (len % 2);
        }
        r.p = resEnd;
        const lmEnd = r.u32() + r.p;
        const layers = [];
        if (lmEnd > r.p) {
            const liLen = r.u32();
            const liEnd = r.p + liLen;
            if (liLen) {
                let count = r.i16();
                count = Math.abs(count);
                const recs = [];
                for (let i = 0; i < count; i += 1) {
                    const L = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), channels: [] };
                    const nc = r.u16();
                    for (let c = 0; c < nc; c += 1) L.channels.push({ id: r.i16(), len: r.u32() });
                    r.str(4);
                    L.blend = r.str(4);
                    L.opacity = r.u8() / 255;
                    L.clipping = r.u8();
                    L.flags = r.u8();
                    r.u8();
                    const extraEnd = r.u32() + r.p;
                    const mlen = r.u32();
                    if (mlen >= 20) {
                        const mEnd = r.p + mlen;
                        L.mask = { top: r.i32(), left: r.i32(), bottom: r.i32(), right: r.i32(), def: r.u8(), flags: r.u8() };
                        r.p = mEnd;
                    } else r.p += mlen;
                    r.skip(r.u32()); // blending ranges
                    const nl = r.u8();
                    L.name = r.str(nl);
                    r.p += (4 - ((nl + 1) % 4)) % 4;
                    while (r.p + 12 <= extraEnd) {
                        const sig = r.str(4);
                        if (sig !== '8BIM' && sig !== '8B64') break;
                        const key = r.str(4);
                        const len = r.u32();
                        const at = r.p;
                        if (key === 'luni') { const n = r.u32(); let s = ''; for (let k = 0; k < n; k += 1) s += String.fromCharCode(r.u16()); L.name = s.replace(/\0+$/, ''); } else if (key === 'lsct') { L.section = r.u32(); if (len >= 12) { r.str(4); L.sectionBlend = r.str(4); } } else if (key === 'lspf') L.locked = r.u32() !== 0;
                        else if (key === 'TySh' || key === 'tySh') L.text = true;
                        else if (key === 'lfx2' || key === 'lrFX' || key === 'lmfx') L.effects = true;
                        else if (DESCRIPTOR_ADJUSTMENTS[key]) L.descriptorAdjustment = DESCRIPTOR_ADJUSTMENTS[key];
                        else {
                            const a = readAdjustment(key, r, len);
                            if (a) L.adjust = a;
                        }
                        r.p = at + len;
                    }
                    r.p = extraEnd;
                    recs.push(L);
                }
                // channel data, in record order
                for (const L of recs) {
                    for (const ch of L.channels) { ch.bytes = r.bytes(ch.len); }
                }
                for (const L of recs) layers.push(L);
            }
            r.p = liEnd;
        }
        r.p = lmEnd;
        // the merged picture (a flat PSD, or the fallback)
        let merged = null;
        if (r.p + 2 <= r.b.length) {
            const comp = r.u16();
            const n = W * H;
            const planes = [];
            if (comp === 1) {
                const counts = [];
                for (let k = 0; k < nch * H; k += 1) counts.push(r.u16());
                for (let c = 0; c < nch; c += 1) {
                    const plane = new Uint8Array(n);
                    for (let y = 0; y < H; y += 1) { const cnt = counts[c * H + y]; unpack(r.bytes(cnt), W, plane, y * W); }
                    planes.push(plane);
                }
            } else if (comp === 0) {
                for (let c = 0; c < nch; c += 1) planes.push(r.bytes(n).slice());
            }
            if (planes.length) merged = planes;
        }
        return { W, H, mode, nch, guides, layers, merged, notes };
    }

    async function layerCanvas(L, W, H, gray) {
        const c = C().makeCanvas(W, H);
        const w = L.right - L.left;
        const h = L.bottom - L.top;
        if (w <= 0 || h <= 0) return c;
        const by = {};
        for (const ch of L.channels) if (ch.id !== -2 && ch.id !== -3) by[ch.id] = await channel(ch.bytes, w, h);
        const img = new ImageData(w, h);
        const d = img.data;
        for (let i = 0; i < w * h; i += 1) {
            const g = gray ? by[0] : null;
            d[i * 4] = gray ? (g ? g[i] : 0) : (by[0] ? by[0][i] : 0);
            d[i * 4 + 1] = gray ? (g ? g[i] : 0) : (by[1] ? by[1][i] : 0);
            d[i * 4 + 2] = gray ? (g ? g[i] : 0) : (by[2] ? by[2][i] : 0);
            d[i * 4 + 3] = by[-1] ? by[-1][i] : 255;
        }
        const t = C().makeCanvas(w, h);
        t.getContext('2d').putImageData(img, 0, 0);
        c.getContext('2d').drawImage(t, L.left, L.top);
        return c;
    }

    async function maskCanvas(L, W, H) {
        const ch = L.channels.find((x) => x.id === -2);
        if (!ch || !L.mask) return null;
        const m = L.mask;
        const w = m.right - m.left;
        const h = m.bottom - m.top;
        const c = C().makeCanvas(W, H);
        const x = c.getContext('2d');
        // outside the mask's box: its default colour
        x.fillStyle = m.def ? '#ffffff' : '#000000';
        x.fillRect(0, 0, W, H);
        if (w > 0 && h > 0) {
            const g = await channel(ch.bytes, w, h);
            const img = new ImageData(w, h);
            for (let i = 0; i < w * h; i += 1) { img.data[i * 4] = g[i]; img.data[i * 4 + 1] = g[i]; img.data[i * 4 + 2] = g[i]; img.data[i * 4 + 3] = 255; }
            const t = C().makeCanvas(w, h);
            t.getContext('2d').putImageData(img, 0, 0);
            x.drawImage(t, m.left, m.top);
        }
        return { canvas: c, enabled: !(m.flags & 2) };
    }

    /** Put a decoded PSD into a Paint window. */
    async function apply(w, st, opts = {}) {
        const { W, H } = st;
        w.newDocument(W, H, { file: opts.file });
        const d = w.doc;
        const gray = st.mode === 1;
        const layers = [];
        const groups = [];
        const stack = []; // open groups, innermost last
        for (const L of st.layers) {
            if (L.section === 3) {
                stack.push({ layers: [] });
                continue;
            }
            if (L.section === 1 || L.section === 2) {
                const open = stack.pop();
                if (!open) continue;
                if (stack.length) {
                    // Paint has one level of groups: an inner group's layers join the outer one
                    notes(st).add(`The group ${L.name} was inside another group; its layers joined the outer one.`);
                    stack[stack.length - 1].layers.push(...open.layers);
                    continue;
                }
                // the group's mode is in its lsct block ('pass' is Pass Through), else in the record
                const mode = L.sectionBlend || L.blend;
                const g = { id: 0, name: L.name, visible: !(L.flags & 2), opacity: L.opacity, blend: mode === 'pass' ? 'pass' : PSD_TO_BLEND[mode] || 'normal', collapsed: L.section === 2 };
                groups.push(g);
                open.layers.forEach((x) => { x.groupRef = g; });
                continue;
            }
            const l = new (C().Layer)(W, H, L.name || `Layer ${layers.length + 1}`);
            l.ctx.drawImage(await layerCanvas(L, W, H, gray), 0, 0);
            l.visible = !(L.flags & 2);
            l.opacity = L.opacity;
            l.blend = PSD_TO_BLEND[L.blend] || 'normal';
            l.locked = !!L.locked;
            const m = await maskCanvas(L, W, H);
            if (m) l.setMaskCanvas(m.canvas, m.enabled);
            if (L.adjust) l.adjust = L.adjust;
            if (L.descriptorAdjustment) notes(st).add(`${L.name}: Photoshop's ${L.descriptorAdjustment} layer has no equivalent here; it came in empty.`);
            if (L.text) notes(st).add(`${L.name}: the text came in as pixels.`);
            if (L.effects) notes(st).add(`${L.name}: its layer style was not brought in.`);
            if (L.clipping) notes(st).add(`${L.name}: clipping masks are not supported; it is a normal layer.`);
            if (L.blend && !PSD_TO_BLEND[L.blend]) notes(st).add(`${L.name}: blend mode ${L.blend.trim()} became Normal.`);
            layers.push(l);
            if (stack.length) stack[stack.length - 1].layers.push(l);
        }
        if (!layers.length && st.merged) {
            // a flat document: its merged picture is the Background
            const l = new (C().Layer)(W, H, 'Background');
            const img = new ImageData(W, H);
            const p = st.merged;
            for (let i = 0; i < W * H; i += 1) {
                img.data[i * 4] = p[0][i]; img.data[i * 4 + 1] = (p[1] || p[0])[i]; img.data[i * 4 + 2] = (p[2] || p[0])[i];
                img.data[i * 4 + 3] = !gray && p[3] ? p[3][i] : 255;
            }
            l.ctx.putImageData(img, 0, 0);
            layers.push(l);
        }
        d.layers = layers;
        d.groups = [];
        groups.forEach((g) => {
            const members = layers.filter((l) => l.groupRef === g);
            if (!members.length) return;
            const made = d.groupLayer(layers.indexOf(members[0]), g.name);
            Object.assign(made, { visible: g.visible, opacity: g.opacity, blend: g.blend, collapsed: g.collapsed });
            members.forEach((l) => { l.groupId = made.id; delete l.groupRef; });
        });
        d.guides = st.guides;
        d.active = layers.length - 1;
        d.history = [];
        d.historyIndex = -1;
        d.historyBytes = 0;
        if (root.paintPro) root.paintPro.registerAdjusters();
        w.name = (opts.name || 'Untitled').replace(/\.[^.]+$/, '');
        w.file = opts.file || null;
        w.dirtyDoc = false;
        w.title();
        d.markDirty();
        d.emit('layers');
        d.emit('history');
        w.drawAnts();
        return Array.from(st.notes);
    }

    function notes(st) { return st.notes; }

    root.paintPsd = { encode, decode, apply, isPsd, MIME };
})(typeof window !== 'undefined' ? window : globalThis);
