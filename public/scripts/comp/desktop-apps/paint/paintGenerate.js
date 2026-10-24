/**
 * Paint's NovelAI tools (Yozora #632), Photoshop's Generative Fill and Generative Expand, and the
 * gallery's prints as layers.
 *
 *   Edit > Generative Fill...     with a selection: NovelAI inpaints that part (the picture round it
 *                                 is what it sees) into a new layer masked to the selection; with
 *                                 none, a new picture the canvas's shape on a layer of its own
 *   Image > Generative Expand...  the canvas grows on the sides asked for and NovelAI paints the new
 *                                 ground, a new layer masked to it (a little over the old edge)
 *   Transparent background        on the models that can (V5: modelFeatures transparency), NovelAI
 *                                 draws with real alpha: the server's append_transparency
 *                                 (straight_alpha, the "transparent background" tag); the layer keeps it
 *   File > Place from Gallery...  prints from the gallery, newest first, each placed as a Smart Object
 *
 *   Everything goes over the WebSocket (wsClient.generateImage: generate_image); a request that costs
 *   Anlas asks first (calculateCreditCost / showCreditCostDialog), as Studio does.
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const P = () => root.paintPro;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);

    const MODEL_NAMES = {
        v5: 'NAI Diffusion V5', v5_medium: 'NAI Diffusion V5 (Medium)', v5_cur: 'NAI Diffusion V5 Curated',
        v4_5: 'NAI Diffusion V4.5 Full', v4_5_cur: 'NAI Diffusion V4.5 Curated', v4: 'NAI Diffusion V4 Full', v4_cur: 'NAI Diffusion V4 Curated',
        v3: 'NAI Diffusion Anime V3', v3_furry: 'NAI Diffusion Furry V3'
    };
    // Fill and Expand start on V4.5 Full: V5's infilling (tried Oct 23 2026) paints a shrunken copy of the
    // whole picture into the masked part whatever the prompt says; V4.5 follows the prompt
    const INPAINT_DEFAULT = 'v4_5';
    // NovelAI's free size (Opus): a megapixel; sides in steps of 64
    const FREE_PIXELS = 1024 * 1024;

    function features() { return (root.optionsData && root.optionsData.modelFeatures) || {}; }
    function caps(model) { return features()[model] || {}; }
    const canAlpha = (model) => caps(model).transparency === true;

    function currentModel() {
        const m = String(call('getCurrentSelectedModel') || reg('GenerateModel', 'v5') || 'v5').toLowerCase();
        return features()[m] ? m : (features().v5 ? 'v5' : Object.keys(features())[0] || 'v5');
    }

    /** The size NovelAI is asked for: the shape of w x h at about a megapixel, sides of 64. */
    function naiSize(w, h, max = FREE_PIXELS) {
        const k = Math.sqrt(max / (w * h));
        let W = Math.max(64, Math.floor((w * k) / 64) * 64);
        let H = Math.max(64, Math.floor((h * k) / 64) * 64);
        while (W * H > max && (W > 64 || H > 64)) { if (W >= H) W -= 64; else H -= 64; }
        return { W, H };
    }

    const b64 = (canvas) => canvas.toDataURL('image/png').replace(/^data:image\/png;base64,/, '');

    async function imageOf(w, result) {
        let bytes;
        if (result && result.image) {
            const s = atob(String(result.image).replace(/^data:[^,]*,/, ''));
            bytes = new Uint8Array(s.length);
            for (let i = 0; i < s.length; i += 1) bytes[i] = s.charCodeAt(i);
            bytes = bytes.buffer;
        } else if (result && result.filename) {
            bytes = await w.fetchBytes(`/images/${encodeURIComponent(result.filename)}`, null, null);
        } else throw new Error('NovelAI sent no picture back.');
        return w.decodePicture(bytes, 'image/png');
    }

    /** Studio's Anlas question, for a request that is not free. */
    async function paidOk(body) {
        if (typeof root.calculateCreditCost !== 'function') return true;
        let cost = null;
        try { cost = root.calculateCreditCost(body); } catch (_) { return true; }
        const n = cost ? (cost.isFree ? cost.opus : cost.list) : 0;
        if (!(n > 0)) return true;
        if (typeof root.showCreditCostDialog !== 'function') return false;
        const ok = await root.showCreditCostDialog(n, null);
        if (ok) body.allow_paid = true;
        return !!ok;
    }

    async function send(w, title, body) {
        if (!root.wsClient || typeof root.wsClient.generateImage !== 'function') throw new Error('Paint cannot reach the server.');
        if (!await paidOk(body)) return null;
        return w.withProgress(title, async (p) => {
            p.line('NovelAI is painting...');
            p.marquee();
            const res = await root.wsClient.generateImage(body, null, false);
            p.line('Reading the picture...');
            p.percent(95);
            return imageOf(w, res);
        });
    }

    // ---- the dialog -------------------------------------------------------------------------------

    // Generative Fill keeps its own prompt: it says what goes in the selection, not the whole picture
    function settings(key) {
        try { return JSON.parse(reg(key, '{}') || '{}'); } catch (_) { return {}; }
    }

    /** Prompt, Undesired Content, model, Transparent background (and Expand's sides). */
    function dialog(w, title, opts = {}) {
        const V = root.vistaDialogTemplate;
        if (!V) return Promise.resolve(null);
        // Fill and Expand inpaint: their own prompt and model (see INPAINT_DEFAULT)
        const inpaint = !!(opts.fill || opts.expand);
        const store = opts.fill ? 'GenerateFill' : opts.expand ? 'GenerateExpand' : 'GenerateLast';
        const last = settings(store);
        const models = Object.keys(features()).filter((k) => !k.includes('_inp'));
        const expand = !!opts.expand;
        const y0 = expand ? 52 : 0;
        const c = [
            [-1, 'S', 7, 7, 236, 8, 0x50020000, opts.fill ? '&Prompt (what goes in the selection, e.g. "blue roses"):' : '&Prompt:', 0],
            [101, 'E', 7, 17, 236, 40, 0x50a11044, '', 0],
            [-1, 'S', 7, 61, 100, 8, 0x50020000, '&Undesired Content:', 0],
            [102, 'E', 7, 71, 236, 24, 0x50a11044, '', 0],
            [-1, 'S', 7, 101, 30, 8, 0x50020000, '&Model:', 0],
            [103, 'C', 44, 99, 199, 120, 0x50210003, '', 0],
            [104, 'B', 7, 117, 236, 10, 0x50010003, '&Transparent background (real alpha; V5 models)', 0]
        ];
        if (expand) {
            c.push([-1, 'B', 7, 131, 236, 46, 0x50000007, 'Add to the canvas (pixels)', 0]);
            [['&Left:', 105, 14, 143], ['&Top:', 106, 124, 143], ['&Right:', 107, 14, 159], ['&Bottom:', 108, 124, 159]].forEach(([t, id, x, y]) => {
                c.push([-1, 'S', x, y + 2, 30, 8, 0x50020000, t, 0], [id, 'E', x + 34, y, 50, 12, 0x50812080, '0', 0]);
            });
        }
        c.push([109, 'S', 7, 133 + y0, 236, 16, 0x50020000, '', 0],
            [1, 'B', 250, 7, 60, 14, 0x50010001, 'Generate', 0], [2, 'B', 250, 25, 60, 14, 0x50010000, 'Cancel', 0]);
        const tpl = { t: title, w: 317, h: 152 + y0, f: ['MS Shell Dlg', 8], c };
        return new Promise((resolve) => {
            let done = false;
            const end = (v) => { if (!done) { done = true; resolve(v); } };
            V.openDialog({
                id: 'mpGenerate', tpl, owner: w.modal,
                init: (ctx) => {
                    let studio = null;
                    try { studio = call('collectManualFormValues'); } catch (_) { studio = null; }
                    ctx.set(101, last.prompt !== undefined ? last.prompt : (!opts.fill && studio && studio.prompt) || '');
                    ctx.set(102, last.uc !== undefined ? last.uc : (studio && studio.uc) || '');
                    const sel = ctx.el(103);
                    const model = last.model && features()[last.model] ? last.model : inpaint && features()[INPAINT_DEFAULT] ? INPAINT_DEFAULT : currentModel();
                    if (sel) {
                        sel.innerHTML = models.map((k) => `<option value="${k}">${esc(MODEL_NAMES[k] || k)}</option>`).join('');
                        sel.value = model;
                    }
                    const alpha = ctx.el(104);
                    const sync = () => {
                        const m = sel ? sel.value : model;
                        const ok = canAlpha(m);
                        if (alpha) { alpha.disabled = !ok; if (!ok) ctx.set(104, false); }
                        const note = ctx.el(109);
                        if (!note) return;
                        if (inpaint && /^v5/.test(m)) note.textContent = 'V5 inpainting tends to paint a small copy of the whole picture into the area; V4.5 Full follows the prompt.';
                        else note.textContent = ok ? (opts.note || '') : `${MODEL_NAMES[m] || m} cannot paint transparency; the V5 models can.`;
                    };
                    ctx.set(104, !!last.alpha && canAlpha(model));
                    if (sel) sel.addEventListener('change', sync);
                    sync();
                    if (expand) [105, 106, 107, 108].forEach((id, i) => ctx.set(id, String((opts.sides || [0, 0, 0, 0])[i])));
                },
                ok: (ctx) => {
                    const v = {
                        prompt: String(ctx.get(101) || '').trim(), uc: String(ctx.get(102) || '').trim(),
                        model: String(ctx.get(103) || currentModel()), alpha: !!ctx.get(104)
                    };
                    if (!canAlpha(v.model)) v.alpha = false;
                    if (expand) v.sides = [105, 106, 107, 108].map((id) => Math.max(0, Math.round(Number(ctx.get(id)) || 0)));
                    if (expand && !v.sides.some((s) => s > 0)) { w.status('Give at least one side some pixels to add.'); return false; }
                    setReg({ [store]: JSON.stringify({ prompt: v.prompt, uc: v.uc, model: v.model, alpha: v.alpha }) });
                    end(v);
                    return true;
                },
                cancel: () => end(null),
                close: () => end(null)
            });
        });
    }

    function baseBody(v, W, H) {
        return {
            prompt: v.prompt, uc: v.uc, model: v.model, width: W, height: H, n: 1,
            append_quality: true, append_uc: true, append_transparency: !!v.alpha,
            workspace: typeof activeWorkspace !== 'undefined' ? activeWorkspace : undefined // eslint-disable-line no-undef
        };
    }

    // ---- Generative Fill -----------------------------------------------------------------------

    async function generativeFill(w) {
        const d = w.doc;
        w.finishText();
        w.commitFloating();
        const s = d.selection;
        const v = await dialog(w, s ? 'Generative Fill' : 'Generate Image', {
            fill: !!s,
            note: s ? 'NovelAI repaints the selection to fit the picture round it.' : 'A new picture on a layer of its own, the canvas\'s shape.'
        });
        if (!v) return;
        try {
            if (s) await fillSelection(w, v, s);
            else await newPicture(w, v);
        } catch (err) {
            await w.message(`NovelAI could not do it.\n${(err && err.message) || err}`);
        }
    }

    async function newPicture(w, v) {
        const d = w.doc;
        const { W, H } = naiSize(d.width, d.height);
        const img = await send(w, 'Generate Image', baseBody(v, W, H));
        if (!img) return;
        d.snapshotStep('Generate Image', () => {
            const l = d.addLayer(v.prompt ? v.prompt.slice(0, 40) : 'Generated');
            l.ctx.imageSmoothingQuality = 'high';
            l.ctx.drawImage(img, 0, 0, d.width, d.height);
        });
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    /** The selection's box with room round it (NovelAI needs the picture's context). */
    /**
     * What NovelAI sees round the selection: two and a half times its size, at least 512 pixels or
     * 60% of the picture, centred on it and moved (not cut) to stay inside, so it knows what it fills.
     */
    function regionOf(d, s) {
        const side = (sel, all) => Math.round(Math.min(all, Math.max(sel * 2.5, 512, all * 0.6)));
        const w = side(s.w, d.width);
        const h = side(s.h, d.height);
        const x = Math.round(Math.max(0, Math.min(d.width - w, s.x + s.w / 2 - w / 2)));
        const y = Math.round(Math.max(0, Math.min(d.height - h, s.y + s.h / 2 - h / 2)));
        return { x, y, w, h };
    }

    async function fillSelection(w, v, s) {
        const d = w.doc;
        const r = regionOf(d, s);
        const { W, H } = naiSize(r.w, r.h);
        // what NovelAI sees: the picture as it shows, that part at its size
        const flat = d.flattened({ background: v.alpha ? null : '#ffffff' });
        const base = C().makeCanvas(W, H);
        const bx = base.getContext('2d');
        bx.imageSmoothingQuality = 'high';
        bx.drawImage(flat, r.x, r.y, r.w, r.h, 0, 0, W, H);
        // the mask: white where it repaints
        const m = P().maskOf(d, s);
        const mc = C().makeCanvas(r.w, r.h);
        const mx = mc.getContext('2d');
        const mi = mx.createImageData(r.w, r.h);
        for (let y = 0; y < r.h; y += 1) {
            for (let x = 0; x < r.w; x += 1) {
                const k = m[(r.y + y) * d.width + r.x + x] >= 128 ? 255 : 0;
                const o = (y * r.w + x) * 4;
                mi.data[o] = k; mi.data[o + 1] = k; mi.data[o + 2] = k; mi.data[o + 3] = 255;
            }
        }
        mx.putImageData(mi, 0, 0);
        const mask = C().makeCanvas(W, H);
        mask.getContext('2d').drawImage(mc, 0, 0, W, H);
        const body = { ...baseBody(v, W, H), image: `data:${b64(base)}`, mask: b64(mask), strength: 1, noise: 0, image_preletterboxed: true };
        const img = await send(w, 'Generative Fill', body);
        if (!img) return;
        d.snapshotStep('Generative Fill', () => {
            const l = d.addLayer(v.prompt ? v.prompt.slice(0, 40) : 'Generative Fill');
            l.ctx.imageSmoothingQuality = 'high';
            l.ctx.drawImage(img, 0, 0, img.width, img.height, r.x, r.y, r.w, r.h);
            // Photoshop's: the new layer shows only in the selection (its mask, softened a touch)
            const shape = P().maskCanvas(d, s);
            const sx = shape.getContext('2d');
            sx.globalCompositeOperation = 'source-in';
            sx.fillStyle = '#fff';
            sx.fillRect(0, 0, shape.width, shape.height);
            const lm = l.addMask('#000000');
            lm.ctx.drawImage(shape, 0, 0);
        });
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    // ---- Generative Expand --------------------------------------------------------------------

    async function generativeExpand(w, sides) {
        const d = w.doc;
        w.finishText();
        w.commitFloating();
        const v = await dialog(w, 'Generative Expand', { expand: true, sides: sides || [0, 0, 0, 0], note: 'NovelAI paints the new ground to carry the picture on.' });
        if (!v) return;
        try {
            await expand(w, v);
        } catch (err) {
            await w.message(`NovelAI could not do it.\n${(err && err.message) || err}`);
        }
    }

    async function expand(w, v) {
        const d = w.doc;
        const [L, T, R, B] = v.sides;
        const nw = d.width + L + R;
        const nh = d.height + T + B;
        const { W, H } = naiSize(nw, nh);
        const k = W / nw;
        const kh = H / nh;
        const flat = d.flattened();
        const base = C().makeCanvas(W, H);
        const bx = base.getContext('2d');
        bx.imageSmoothingQuality = 'high';
        bx.drawImage(flat, L * k, T * kh, d.width * k, d.height * kh);
        // white over the new ground and a few pixels into the old edge, so they join
        const overlap = 8;
        const mask = C().makeCanvas(W, H);
        const mx = mask.getContext('2d');
        mx.fillStyle = '#fff';
        mx.fillRect(0, 0, W, H);
        mx.fillStyle = '#000';
        mx.fillRect((L ? L + overlap : 0) * k, (T ? T + overlap : 0) * kh, (d.width - (L ? overlap : 0) - (R ? overlap : 0)) * k, (d.height - (T ? overlap : 0) - (B ? overlap : 0)) * kh);
        const body = { ...baseBody(v, W, H), image: `data:${b64(base)}`, mask: b64(mask), strength: 1, noise: 0, image_preletterboxed: true };
        const img = await send(w, 'Generative Expand', body);
        if (!img) return;
        const ow = d.width;
        const oh = d.height;
        d.resizeCanvas(nw, nh, { label: 'Generative Expand', anchorX: L + R ? L / (L + R) : 0, anchorY: T + B ? T / (T + B) : 0 });
        d.snapshotStep('Generative Expand', () => {
            const l = d.addLayer('Generative Expand');
            l.ctx.imageSmoothingQuality = 'high';
            l.ctx.drawImage(img, 0, 0, nw, nh);
            // the layer shows on the new ground, fading into the old picture over the overlap
            const lm = l.addMask('#ffffff');
            const g = lm.ctx;
            g.filter = `blur(${overlap / 2}px)`;
            g.fillStyle = '#000';
            g.fillRect(L + (L ? overlap : 0), T + (T ? overlap : 0), ow - (L ? overlap : 0) - (R ? overlap : 0), oh - (T ? overlap : 0) - (B ? overlap : 0));
            g.filter = 'none';
        });
        w.layout();
        if (root.paintLayers) root.paintLayers.refresh(w);
    }

    // ---- prints from the gallery ----------------------------------------------------------------

    function previewUrl(row) {
        if (typeof root.resolveGalleryPreviewUrl === 'function') { try { return root.resolveGalleryPreviewUrl(row); } catch (_) { /* below */ } }
        return row.base ? `/previews/${encodeURIComponent(row.base)}.webp` : `/images/${encodeURIComponent(row.filename)}`;
    }

    async function placeFromGallery(w) {
        const V = root.vistaDialogTemplate;
        if (!V || !root.wsClient) return;
        let rows = [];
        try {
            // no workspaceId: asking with one would switch the session's workspace
            const res = await root.wsClient.sendMessage('request_gallery', { viewType: 'images', offset: 0, limit: 80, light: true, includePinnedStatus: false }, false);
            rows = ((res && (res.gallery || (res.data && res.data.gallery))) || []).filter((x) => x && x.filename);
        } catch (err) {
            await w.message(`Paint cannot read the gallery.\n${(err && err.message) || err}`);
            return;
        }
        if (!rows.length) { w.status('The gallery has no prints yet.'); return; }
        const picked = new Set();
        const tpl = { t: 'Place from Gallery', w: 360, h: 236, f: ['MS Shell Dlg', 8], c: [
            [-1, 'S', 7, 7, 280, 8, 0x50020000, 'Click the prints to place (Ctrl+click for more); each becomes a Smart Object.', 0],
            [101, 'S', 7, 19, 346, 192, 0x5000000e, '', 0],
            [1, 'B', 243, 216, 52, 14, 0x50010001, 'Place', 0],
            [2, 'B', 301, 216, 52, 14, 0x50010000, 'Cancel', 0]
        ] };
        V.openDialog({
            id: 'mpGalleryPlace', tpl, owner: w.modal,
            init: (ctx) => {
                const host = ctx.el(101);
                if (!host) return;
                host.classList.add('mp-gal-grid');
                host.innerHTML = rows.map((r, i) => `<button type="button" class="mp-gal-item" data-i="${i}" title="${esc(r.filename)}"><img src="${esc(previewUrl(r))}" alt="" loading="lazy"></button>`).join('');
                host.addEventListener('click', (ev) => {
                    const b = ev.target.closest('.mp-gal-item');
                    if (!b) return;
                    const i = Number(b.dataset.i);
                    if (!ev.ctrlKey && !ev.metaKey) { picked.clear(); host.querySelectorAll('.is-on').forEach((x) => x.classList.remove('is-on')); }
                    if (picked.has(i)) { picked.delete(i); b.classList.remove('is-on'); } else { picked.add(i); b.classList.add('is-on'); }
                });
                host.addEventListener('dblclick', (ev) => { if (ev.target.closest('.mp-gal-item')) { const ok = ctx.el(1); if (ok) ok.click(); } });
            },
            ok: () => {
                if (!picked.size) return false;
                const list = [...picked].map((i) => rows[i]);
                setTimeout(() => void placeRows(w, list), 0);
                return true;
            }
        });
    }

    async function placeRows(w, list) {
        const imgs = await w.withProgress('Placing from the gallery', async (p) => {
            const out = [];
            for (let i = 0; i < list.length; i += 1) {
                p.check();
                p.line(`${list[i].filename} (${i + 1} of ${list.length})`);
                const bytes = await w.fetchBytes(`/images/${encodeURIComponent(list[i].filename)}`, p, p.part((i / list.length) * 100, ((i + 1) / list.length) * 100));
                out.push([list[i].filename, await w.decodePicture(bytes)]);
            }
            return out;
        }, { cancellable: true });
        if (!imgs) return;
        for (const [name, img] of imgs) {
            // each in its turn: the one before is set where it landed
            if (w.xf) w.commitTransform();
            if (root.paintSmart) root.paintSmart.place(w, img, name.replace(/\.[^.]+$/, ''));
            else w.doc.snapshotStep('Place', () => { w.doc.addLayer(name).ctx.drawImage(img, 0, 0); });
        }
    }

    function action(w, a) {
        switch (a) {
            case 'generative-fill': void generativeFill(w); return true;
            case 'generative-expand': void generativeExpand(w); return true;
            case 'place-gallery': void placeFromGallery(w); return true;
            default: return false;
        }
    }

    root.paintGenerate = { generativeFill, generativeExpand, placeFromGallery, placeRows, naiSize, canAlpha, regionOf, expand, fillSelection, newPicture, action };
})(typeof window !== 'undefined' ? window : globalThis);
