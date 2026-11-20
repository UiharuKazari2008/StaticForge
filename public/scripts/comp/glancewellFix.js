/**
 * Melaton Photo Gallery's Fix: Windows Photo Gallery's Fix pane (Yozora #446), 1:1 with the Vista VM (shots 40-45 in
 * ~/.cache/vista-vm/wpg/shots; strings 8012-8128, icons PNG 8001-8062 of PhotoViewer.dll).
 *
 * The pane replaces the Info pane at the right of the viewer: Auto Adjust, Adjust Exposure (Brightness, Contrast),
 * Adjust Color (Color Temperature, Tint, Saturation), Crop Picture (Proportion, Rotate frame, Apply) and Fix Red
 * Eye, one open at a time; Undo / Redo at the foot (each with Undo All / Redo All, and Revert to Original). The
 * picture shows every change at once; the edits are a list replayed over the original, on a screen-sized copy while
 * fixing and at full size when saved.
 *
 * Leaving Fix with changes asks (Yukimi, Nov 20 2026): Overwrite, Save Copy, Save As..., Cancel.
 *   prints     Overwrite keeps the prompt and parameters and the original for Revert (glancewell_fix_save);
 *              Save Copy adds a print next to it
 *   folders    Overwrite replaces the VFS file (vfs_replace_file); Save Copy uploads "<name> (fixed)" beside it
 *   phones     Overwrite writes over the file on the phone; Save Copy writes a copy beside it
 *   anything   Save As... the shared Save dialog into the VFS
 *
 *   window.glancewellFix = { open(target), close(), isOpen(), leave(next) }
 *     target: { src, name, item?, print? { filename, workspaceId } }
 */
(function (root) {
    'use strict';

    const doc = root.document;
    const ART = '/static_images/vista-photo-gallery';
    const PREVIEW_EDGE = 1600;
    const PROPORTIONS = [
        ['original', 'Original'], ['custom', 'Custom'], ['16x9', '16 x 9', 16, 9], ['8.5x11', '8.5 x 11', 8.5, 11], ['8x10', '8 x 10', 8, 10],
        ['5x7', '5 x 7', 5, 7], ['4x6', '4 x 6', 4, 6], ['4x3', '4 x 3', 4, 3], ['3.5x5', '3.5 x 5', 3.5, 5], ['square', 'Square', 1, 1]
    ];
    const TOOLS = [
        ['auto', 'Auto Adjust', 'Improve exposure and color automatically'],
        ['exposure', 'Adjust Exposure', 'Change brightness and contrast'],
        ['color', 'Adjust Color', 'Change temperature, tint, and saturation'],
        ['crop', 'Crop Picture', 'Crop picture'],
        ['redeye', 'Fix Red Eye', 'Remove unwanted red in eyes']
    ];
    const OP_NAMES = { auto: 'Auto Adjust', exposure: 'Adjust Exposure', color: 'Adjust Color', crop: 'Crop', redeye: 'Red Eye' };

    const F = {
        open: false,
        target: null,
        source: null,       // the original as an ImageBitmap / HTMLImageElement
        preview: null,      // the original scaled to fit PREVIEW_EDGE (canvas)
        scale: 1,           // preview / original
        ops: [],
        redo: [],
        tool: null,
        crop: null,         // { x, y, w, h } in preview pixels while Crop is open
        proportion: 'custom',
        portrait: false,
        el: {},
        busy: false,
        hasOriginal: false
    };

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const shell = () => doc.getElementById('photoSwipeWindow');
    const send = (type, data) => root.wsClient.sendMessage(type, data || {}, false);
    // page-level consts of other scripts (not window properties): vfsClient.js
    /* global vfsClient */
    const vfs = () => (typeof vfsClient !== 'undefined' ? vfsClient : null);

    // ------------------------------------------------------------------ pixels

    const clamp = (v) => (v < 0 ? 0 : v > 255 ? 255 : v);

    /** Auto Adjust: each channel stretched between its 0.5% and 99.5% points, measured on the picture as it is. */
    function measureAuto(data) {
        const hist = [new Uint32Array(256), new Uint32Array(256), new Uint32Array(256)];
        const n = data.length / 4;
        const step = Math.max(1, Math.floor(n / 250000));
        let count = 0;
        for (let i = 0; i < data.length; i += 4 * step) { hist[0][data[i]]++; hist[1][data[i + 1]]++; hist[2][data[i + 2]]++; count++; }
        return hist.map((h) => {
            let lo = 0; let hi = 255; let acc = 0;
            const cut = count * 0.005;
            while (lo < 255 && (acc += h[lo]) < cut) lo++;
            acc = 0;
            while (hi > 0 && (acc += h[hi]) < cut) hi--;
            if (hi - lo < 32) return [0, 255];
            return [lo, hi];
        });
    }

    function applyPixels(ctx, w, h, op, scale) {
        const img = ctx.getImageData(0, 0, w, h);
        const d = img.data;
        if (op.type === 'auto') {
            const lut = op.levels.map(([lo, hi]) => { const t = new Uint8ClampedArray(256); for (let v = 0; v < 256; v++) t[v] = clamp(((v - lo) * 255) / (hi - lo)); return t; });
            for (let i = 0; i < d.length; i += 4) { d[i] = lut[0][d[i]]; d[i + 1] = lut[1][d[i + 1]]; d[i + 2] = lut[2][d[i + 2]]; }
        } else if (op.type === 'exposure') {
            // Brightness -100..100 moves the tones, Contrast -100..100 spreads them about the middle
            const b = op.brightness * 1.1;
            const c = Math.pow((op.contrast + 100) / 100, 2);
            const t = new Uint8ClampedArray(256);
            for (let v = 0; v < 256; v++) t[v] = clamp((v - 128) * c + 128 + b);
            for (let i = 0; i < d.length; i += 4) { d[i] = t[d[i]]; d[i + 1] = t[d[i + 1]]; d[i + 2] = t[d[i + 2]]; }
        } else if (op.type === 'color') {
            const warm = op.temperature * 0.35;
            const tint = op.tint * 0.3;
            const sat = 1 + op.saturation / 100;
            for (let i = 0; i < d.length; i += 4) {
                let r = d[i] + warm; let g = d[i + 1] - tint; let bl = d[i + 2] - warm;
                const l = 0.299 * r + 0.587 * g + 0.114 * bl;
                r = l + (r - l) * sat; g = l + (g - l) * sat; bl = l + (bl - l) * sat;
                d[i] = clamp(r); d[i + 1] = clamp(g); d[i + 2] = clamp(bl);
            }
        } else if (op.type === 'redeye') {
            // inside the eye's ellipse, strongly red pixels lose their red to the mean of green and blue
            const x0 = Math.round(op.x * scale); const y0 = Math.round(op.y * scale);
            const rw = Math.max(1, Math.round(op.w * scale)); const rh = Math.max(1, Math.round(op.h * scale));
            const cx = x0 + rw / 2; const cy = y0 + rh / 2;
            for (let y = Math.max(0, y0); y < Math.min(h, y0 + rh); y++) {
                for (let x = Math.max(0, x0); x < Math.min(w, x0 + rw); x++) {
                    const nx = (x - cx) / (rw / 2); const ny = (y - cy) / (rh / 2);
                    if (nx * nx + ny * ny > 1) continue;
                    const i = (y * w + x) * 4;
                    const r = d[i]; const gb = (d[i + 1] + d[i + 2]) / 2;
                    if (r > 60 && r > gb * 1.5) d[i] = gb;
                }
            }
        }
        ctx.putImageData(img, 0, 0);
    }

    /** Replay the edits over a picture at `scale` (1 = full size). Returns a canvas. */
    function render(sourceCanvas, scale) {
        let c = sourceCanvas;
        for (const op of F.ops) {
            if (op.type === 'crop') {
                const x = Math.round(op.x * scale); const y = Math.round(op.y * scale);
                const w = Math.max(1, Math.round(op.w * scale)); const h = Math.max(1, Math.round(op.h * scale));
                const n = doc.createElement('canvas');
                n.width = w; n.height = h;
                n.getContext('2d').drawImage(c, x, y, w, h, 0, 0, w, h);
                c = n;
                continue;
            }
            if (c === sourceCanvas) {
                const n = doc.createElement('canvas');
                n.width = c.width; n.height = c.height;
                n.getContext('2d').drawImage(c, 0, 0);
                c = n;
            }
            applyPixels(c.getContext('2d', { willReadFrequently: true }), c.width, c.height, op, scale);
        }
        return c;
    }

    // crop and red eye rectangles are kept in original-picture pixels; a later crop shifts what follows it
    function originOffset(uptoIndex) {
        let ox = 0; let oy = 0;
        for (let i = 0; i < uptoIndex; i++) if (F.ops[i].type === 'crop') { ox += 0; oy += 0; }
        return { ox, oy };
    }

    // ------------------------------------------------------------------ DOM

    function build() {
        const sh = shell();
        if (!sh) return false;
        if (F.el.stage && sh.contains(F.el.stage)) return true;
        const main = sh.querySelector('.wpg-main');
        const stage = doc.createElement('div');
        stage.className = 'wpg-fix-stage';
        stage.hidden = true;
        stage.innerHTML = '<canvas class="wpg-fix-canvas"></canvas><div class="wpg-fix-crop" hidden><div class="wpg-fix-crop-box">' +
            ['nw', 'n', 'ne', 'e', 'se', 's', 'sw', 'w'].map((k) => `<span class="wpg-fix-h" data-h="${k}"></span>`).join('') +
            '</div></div><div class="wpg-fix-band" hidden></div><div class="wpg-fix-wait" hidden>Applying...</div>';
        main.insertBefore(stage, main.querySelector('.wpg-info'));
        const pane = doc.createElement('aside');
        pane.className = 'wpg-fix';
        pane.hidden = true;
        pane.setAttribute('aria-label', 'Fix');
        pane.innerHTML = `<button type="button" class="wpg-fix-close" title="Hide Edit Pane"></button><div class="wpg-fix-tools">${TOOLS.map(([id, text, tip]) => `
            <section class="wpg-fix-tool" data-tool="${id}">
                <button type="button" class="wpg-fix-tool-head" title="${esc(tip)}"><span class="wpg-fix-icon wpg-fix-icon-${id}"></span>${esc(text)}</button>
                <div class="wpg-fix-tool-body">${toolBody(id)}</div>
            </section>`).join('')}</div>
            <div class="wpg-fix-foot"><button type="button" class="wpg-fix-undo" disabled><span class="wpg-fix-undo-icon"></span>Undo</button><button type="button" class="wpg-fix-undo-drop" disabled aria-label="Undo options"></button><button type="button" class="wpg-fix-redo" disabled><span class="wpg-fix-redo-icon"></span>Redo</button><button type="button" class="wpg-fix-redo-drop" disabled aria-label="Redo options"></button></div>`;
        main.insertBefore(pane, main.querySelector('.wpg-info'));
        F.el = { stage, pane, canvas: stage.querySelector('.wpg-fix-canvas'), crop: stage.querySelector('.wpg-fix-crop'), box: stage.querySelector('.wpg-fix-crop-box'), band: stage.querySelector('.wpg-fix-band'), wait: stage.querySelector('.wpg-fix-wait') };
        wire();
        return true;
    }

    function toolBody(id) {
        const slider = (k, label, accel) => `<label class="wpg-fix-slider"><span>${accel}</span><input type="range" min="-100" max="100" step="1" value="0" data-k="${k}" aria-label="${esc(label)}"></label>`;
        if (id === 'exposure') return slider('brightness', 'Brightness', 'Brightness') + slider('contrast', 'Contrast', 'Contrast');
        if (id === 'color') return slider('temperature', 'Color Temperature', 'Color Temperature') + slider('tint', 'Tint', 'Tint') + slider('saturation', 'Saturation', 'Saturation');
        if (id === 'crop') {
            return `<div class="wpg-fix-crop-ui"><label class="wpg-fix-prop-label">Proportion</label><select class="wpg-fix-prop vdt-select">${PROPORTIONS.map(([v, t]) => `<option value="${v}">${esc(t)}</option>`).join('')}</select>` +
                '<button type="button" class="wpg-fix-rotate"><span class="wpg-fix-rotate-icon"></span><span>Rotate frame</span></button><button type="button" class="wpg-fix-apply">Apply</button></div>';
        }
        if (id === 'redeye') return '<p class="wpg-fix-note">Drag the mouse pointer to draw a rectangle around the eye you want to fix.</p><p class="wpg-fix-note">To pan while zoomed in, press ALT and then drag.</p>';
        return '';
    }

    function wire() {
        const { pane, stage, box } = F.el;
        pane.querySelector('.wpg-fix-close').addEventListener('click', () => void leave());
        pane.querySelectorAll('.wpg-fix-tool-head').forEach((b) => b.addEventListener('click', () => {
            const id = b.closest('.wpg-fix-tool').dataset.tool;
            if (id === 'auto') { void applyAuto(); return; }
            setTool(F.tool === id ? null : id);
        }));
        pane.querySelectorAll('input[type="range"]').forEach((inp) => {
            inp.addEventListener('input', () => livePreview());
            inp.addEventListener('change', () => commitSliders(inp.closest('.wpg-fix-tool').dataset.tool));
        });
        const prop = pane.querySelector('.wpg-fix-prop');
        prop.addEventListener('change', () => { F.proportion = prop.value; fitCropToProportion(); });
        pane.querySelector('.wpg-fix-rotate').addEventListener('click', () => { F.portrait = !F.portrait; fitCropToProportion(); });
        pane.querySelector('.wpg-fix-apply').addEventListener('click', () => applyCrop());
        pane.querySelector('.wpg-fix-undo').addEventListener('click', () => undo());
        pane.querySelector('.wpg-fix-redo').addEventListener('click', () => redo());
        const cm = root.contextMenu;
        if (cm) {
            cm.attachClickMenuToElement(pane.querySelector('.wpg-fix-undo-drop'), {
                sections: [],
                beforeShow: function () {
                    this.sections = [{ type: 'list', items: [
                        { text: F.ops.length ? `Undo ${OP_NAMES[F.ops[F.ops.length - 1].type]}` : 'Undo', subtext: 'Ctrl+Z', action: 'fx-undo', disabled: !F.ops.length },
                        { text: 'Undo All', subtext: 'Ctrl+Shift+Z', action: 'fx-undo-all', disabled: !F.ops.length },
                        { separator: true },
                        { text: 'Revert to Original', subtext: 'Ctrl+R', action: 'fx-revert', disabled: !F.hasOriginal }
                    ] }];
                },
                onAction: (a) => { if (a === 'fx-undo') undo(); else if (a === 'fx-undo-all') { while (F.ops.length) undo(true); redraw(); } else if (a === 'fx-revert') void revertToOriginal(); }
            });
            cm.attachClickMenuToElement(pane.querySelector('.wpg-fix-redo-drop'), {
                sections: [],
                beforeShow: function () {
                    this.sections = [{ type: 'list', items: [
                        { text: F.redo.length ? `Redo ${OP_NAMES[F.redo[F.redo.length - 1].type]}` : 'Redo', subtext: 'Ctrl+Y', action: 'fx-redo', disabled: !F.redo.length },
                        { text: 'Redo All', subtext: 'Ctrl+Shift+Y', action: 'fx-redo-all', disabled: !F.redo.length }
                    ] }];
                },
                onAction: (a) => { if (a === 'fx-redo') redo(); else if (a === 'fx-redo-all') { while (F.redo.length) redo(true); redraw(); } }
            });
        }
        // Crop: move the frame or pull a handle; Red Eye: draw a rectangle around the eye
        stage.addEventListener('pointerdown', onStageDown);
        stage.addEventListener('keydown', onKey);
        pane.addEventListener('keydown', onKey);
        void box;
    }

    function onKey(e) {
        if (!F.open || e.altKey) return;
        const k = e.key.toLowerCase();
        if (e.ctrlKey && k === 'z') { e.preventDefault(); if (e.shiftKey) { while (F.ops.length) undo(true); redraw(); } else undo(); }
        else if (e.ctrlKey && k === 'y') { e.preventDefault(); if (e.shiftKey) { while (F.redo.length) redo(true); redraw(); } else redo(); }
        else if (e.ctrlKey && k === 'r') { e.preventDefault(); void revertToOriginal(); }
    }

    function setTool(id) {
        // a crop frame left without Apply is dropped, as Photo Gallery does
        F.tool = id;
        F.el.pane.querySelectorAll('.wpg-fix-tool').forEach((s) => s.classList.toggle('is-open', s.dataset.tool === id));
        F.el.crop.hidden = id !== 'crop';
        F.el.stage.classList.toggle('is-redeye', id === 'redeye');
        if (id === 'crop') startCrop();
        syncSliders();
    }

    /** The sliders show the last exposure / colour edit (one edit per slider release). */
    function syncSliders() {
        const last = (type) => { for (let i = F.ops.length - 1; i >= 0; i--) if (F.ops[i].type === type) return F.ops[i]; return null; };
        F.el.pane.querySelectorAll('input[type="range"]').forEach((inp) => { inp.value = '0'; });
        void last;
    }

    // ------------------------------------------------------------------ drawing

    let canvasRect = null;
    function redraw(extraOp) {
        const out = render(F.preview, F.scale);
        let shown = out;
        if (extraOp) {
            const n = doc.createElement('canvas');
            n.width = out.width; n.height = out.height;
            const ctx = n.getContext('2d', { willReadFrequently: true });
            ctx.drawImage(out, 0, 0);
            applyPixels(ctx, n.width, n.height, extraOp, F.scale);
            shown = n;
        }
        const c = F.el.canvas;
        c.width = shown.width; c.height = shown.height;
        c.getContext('2d').drawImage(shown, 0, 0);
        layoutCanvas();
        syncButtons();
    }

    function layoutCanvas() {
        const c = F.el.canvas;
        const st = F.el.stage;
        const sw = st.clientWidth - 24; const shh = st.clientHeight - 24;
        const k = Math.min(1 / (root.devicePixelRatio || 1) * (root.devicePixelRatio || 1), sw / c.width, shh / c.height, 1 / F.scale);
        const w = Math.round(c.width * k); const h = Math.round(c.height * k);
        c.style.width = `${w}px`; c.style.height = `${h}px`;
        c.style.left = `${Math.round((st.clientWidth - w) / 2)}px`;
        c.style.top = `${Math.round((st.clientHeight - h) / 2)}px`;
        canvasRect = { left: Math.round((st.clientWidth - w) / 2), top: Math.round((st.clientHeight - h) / 2), w, h, k };
        if (F.tool === 'crop' && F.crop) placeCrop();
    }

    let liveTimer = 0;
    function livePreview() {
        cancelAnimationFrame(liveTimer);
        liveTimer = requestAnimationFrame(() => {
            const op = sliderOp(F.tool);
            redraw(op);
        });
    }

    function sliderOp(tool) {
        const v = (k) => Number((F.el.pane.querySelector(`input[data-k="${k}"]`) || {}).value || 0);
        if (tool === 'exposure') return { type: 'exposure', brightness: v('brightness'), contrast: v('contrast') };
        if (tool === 'color') return { type: 'color', temperature: v('temperature'), tint: v('tint'), saturation: v('saturation') };
        return null;
    }

    function push(op) {
        F.ops.push(op);
        F.redo = [];
        redraw();
    }

    function commitSliders(tool) {
        const op = sliderOp(tool);
        if (!op) return;
        const zero = Object.keys(op).every((k) => k === 'type' || op[k] === 0);
        F.el.pane.querySelectorAll(`.wpg-fix-tool[data-tool="${tool}"] input[type="range"]`).forEach((i) => { i.value = '0'; });
        if (zero) { redraw(); return; }
        push(op);
    }

    async function applyAuto() {
        setTool(null);
        const c = render(F.preview, F.scale);
        const d = c.getContext('2d', { willReadFrequently: true }).getImageData(0, 0, c.width, c.height).data;
        push({ type: 'auto', levels: measureAuto(d) });
    }

    function undo(quiet) {
        if (!F.ops.length) return;
        F.redo.push(F.ops.pop());
        if (!quiet) redraw();
    }
    function redo(quiet) {
        if (!F.redo.length) return;
        F.ops.push(F.redo.pop());
        if (!quiet) redraw();
    }

    function syncButtons() {
        const p = F.el.pane;
        p.querySelector('.wpg-fix-undo').disabled = !F.ops.length;
        p.querySelector('.wpg-fix-undo-drop').disabled = !F.ops.length && !F.hasOriginal;
        p.querySelector('.wpg-fix-redo').disabled = !F.redo.length;
        p.querySelector('.wpg-fix-redo-drop').disabled = !F.redo.length;
    }

    // ------------------------------------------------------------------ crop and red eye

    /** The picture as it stands (after the edits so far) in original pixels: its size and where it starts. */
    function currentFrame() {
        let x = 0; let y = 0; let w = F.source.width; let h = F.source.height;
        for (const op of F.ops) if (op.type === 'crop') { x += op.x; y += op.y; w = op.w; h = op.h; }
        return { x, y, w, h };
    }

    function startCrop() {
        const fr = currentFrame();
        // a frame inset a little from the edges, as Photo Gallery starts it
        F.crop = { x: fr.w * 0.1, y: fr.h * 0.1, w: fr.w * 0.8, h: fr.h * 0.8 };
        F.proportion = 'custom';
        const sel = F.el.pane.querySelector('.wpg-fix-prop');
        if (sel) sel.value = 'custom';
        placeCrop();
    }

    function ratio() {
        const p = PROPORTIONS.find((x) => x[0] === F.proportion);
        if (!p || F.proportion === 'custom') return null;
        const fr = currentFrame();
        if (F.proportion === 'original') return F.portrait ? fr.h / fr.w : fr.w / fr.h;
        const r = p[2] / p[3];
        // the print sizes are portrait numbers; a landscape picture takes them landscape unless Rotate frame
        const land = fr.w >= fr.h;
        const want = land !== F.portrait ? Math.max(r, 1 / r) : Math.min(r, 1 / r);
        return want;
    }

    function fitCropToProportion() {
        const r = ratio();
        const fr = currentFrame();
        if (r) {
            let w = fr.w * 0.8; let h = w / r;
            if (h > fr.h * 0.8) { h = fr.h * 0.8; w = h * r; }
            F.crop = { x: (fr.w - w) / 2, y: (fr.h - h) / 2, w, h };
        } else if (F.portrait && F.crop) {
            const { x, y, w, h } = F.crop;
            F.crop = { x: x + (w - h) / 2, y: y + (h - w) / 2, w: h, h: w };
            clampCrop();
        }
        placeCrop();
    }

    function clampCrop() {
        const fr = currentFrame();
        const c = F.crop;
        c.w = Math.max(8, Math.min(fr.w, c.w)); c.h = Math.max(8, Math.min(fr.h, c.h));
        c.x = Math.max(0, Math.min(fr.w - c.w, c.x)); c.y = Math.max(0, Math.min(fr.h - c.h, c.y));
    }

    function placeCrop() {
        if (!canvasRect || !F.crop) return;
        // original pixels -> canvas pixels -> screen
        const k = F.scale * canvasRect.k;
        const b = F.el.box;
        b.style.left = `${canvasRect.left + F.crop.x * k}px`;
        b.style.top = `${canvasRect.top + F.crop.y * k}px`;
        b.style.width = `${F.crop.w * k}px`;
        b.style.height = `${F.crop.h * k}px`;
    }

    function applyCrop() {
        if (!F.crop) return;
        const fr = currentFrame();
        const { x, y, w, h } = F.crop;
        if (Math.round(w) >= fr.w && Math.round(h) >= fr.h) { setTool(null); return; }
        // a crop is kept relative to the picture before it (render replays them in order)
        push({ type: 'crop', x: Math.round(x), y: Math.round(y), w: Math.round(w), h: Math.round(h) });
        setTool(null);
    }

    function onStageDown(e) {
        if (e.button !== 0 || !canvasRect) return;
        const st = F.el.stage;
        const r = st.getBoundingClientRect();
        const k = F.scale * canvasRect.k;
        const toPic = (cx, cy) => ({ x: (cx - r.left - canvasRect.left) / k, y: (cy - r.top - canvasRect.top) / k });
        if (F.tool === 'crop' && F.crop) {
            const handle = e.target.closest('.wpg-fix-h');
            if (!handle && !e.target.closest('.wpg-fix-crop-box')) return;
            e.preventDefault();
            st.setPointerCapture(e.pointerId);
            const h = handle ? handle.dataset.h : 'move';
            const start = toPic(e.clientX, e.clientY);
            const c0 = Object.assign({}, F.crop);
            const rr = ratio();
            const move = (ev) => {
                const p = toPic(ev.clientX, ev.clientY);
                const dx = p.x - start.x; const dy = p.y - start.y;
                const c = Object.assign({}, c0);
                if (h === 'move') { c.x += dx; c.y += dy; }
                else {
                    if (h.includes('w')) { c.x += dx; c.w -= dx; }
                    if (h.includes('e')) c.w += dx;
                    if (h.includes('n')) { c.y += dy; c.h -= dy; }
                    if (h.includes('s')) c.h += dy;
                    if (rr) {
                        if (h === 'n' || h === 's') c.w = c.h * rr; else c.h = c.w / rr;
                        if (h.includes('n')) c.y = c0.y + c0.h - c.h;
                        if (h.includes('w')) c.x = c0.x + c0.w - c.w;
                    }
                }
                F.crop = c;
                clampCrop();
                if (rr && h !== 'move') { if (F.crop.w / F.crop.h > rr + 0.01) F.crop.w = F.crop.h * rr; else F.crop.h = F.crop.w / rr; }
                if (!rr && h !== 'move' && F.proportion !== 'custom') { F.proportion = 'custom'; }
                placeCrop();
            };
            const up = () => { st.removeEventListener('pointermove', move); st.removeEventListener('pointerup', up); };
            st.addEventListener('pointermove', move);
            st.addEventListener('pointerup', up);
            return;
        }
        if (F.tool === 'redeye') {
            e.preventDefault();
            st.setPointerCapture(e.pointerId);
            const start = toPic(e.clientX, e.clientY);
            const band = F.el.band;
            band.hidden = false;
            const draw = (p) => {
                const x = Math.min(start.x, p.x); const y = Math.min(start.y, p.y);
                band.style.cssText = `left:${canvasRect.left + x * k}px;top:${canvasRect.top + y * k}px;width:${Math.abs(p.x - start.x) * k}px;height:${Math.abs(p.y - start.y) * k}px`;
                return { x, y, w: Math.abs(p.x - start.x), h: Math.abs(p.y - start.y) };
            };
            let rect = draw(start);
            const move = (ev) => { rect = draw(toPic(ev.clientX, ev.clientY)); };
            const up = () => {
                st.removeEventListener('pointermove', move);
                st.removeEventListener('pointerup', up);
                band.hidden = true;
                if (rect.w > 2 && rect.h > 2) push({ type: 'redeye', x: Math.round(rect.x), y: Math.round(rect.y), w: Math.round(rect.w), h: Math.round(rect.h) });
            };
            st.addEventListener('pointermove', move);
            st.addEventListener('pointerup', up);
        }
    }

    // ------------------------------------------------------------------ open / leave / save

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.decoding = 'async';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error("Photo Gallery can't open this picture because it might have been deleted or is in a location that is not available."));
            img.src = src;
        });
    }

    async function open(target) {
        if (!target || !target.src || !build()) return false;
        const sh = shell();
        F.target = target;
        F.ops = []; F.redo = []; F.tool = null; F.crop = null;
        F.hasOriginal = false;
        sh.classList.add('wpg-mode-fix');
        F.el.stage.hidden = false;
        F.el.pane.hidden = false;
        F.el.wait.hidden = false;
        F.el.wait.textContent = 'Loading...';
        F.open = true;
        setTool(null);
        const btn = sh.querySelector('[data-gw="fix"]');
        if (btn) btn.setAttribute('aria-pressed', 'true');
        try {
            F.source = await loadImage(target.src);
        } catch (err) {
            F.el.wait.textContent = err.message;
            return true;
        }
        const s = Math.min(1, PREVIEW_EDGE / Math.max(F.source.width, F.source.height));
        F.scale = s;
        const c = doc.createElement('canvas');
        c.width = Math.max(1, Math.round(F.source.width * s));
        c.height = Math.max(1, Math.round(F.source.height * s));
        c.getContext('2d').drawImage(F.source, 0, 0, c.width, c.height);
        F.preview = c;
        F.el.wait.hidden = true;
        redraw();
        if (target.print && target.print.filename) {
            try { F.hasOriginal = !!(await send('glancewell_fix_original', { filename: target.print.filename })).hasOriginal; } catch (_) { F.hasOriginal = false; }
            syncButtons();
        }
        if (typeof ResizeObserver === 'function' && !F.ro) { F.ro = new ResizeObserver(() => { if (F.open) layoutCanvas(); }); F.ro.observe(F.el.stage); }
        F.el.pane.querySelector('.wpg-fix-tool-head').focus({ preventScroll: true });
        return true;
    }

    function close() {
        const sh = shell();
        F.open = false;
        if (!F.el.stage) return;
        F.el.stage.hidden = true;
        F.el.pane.hidden = true;
        F.el.crop.hidden = true;
        if (sh) {
            sh.classList.remove('wpg-mode-fix');
            const btn = sh.querySelector('[data-gw="fix"]');
            if (btn) btn.setAttribute('aria-pressed', 'false');
        }
        F.source = null; F.preview = null; F.ops = []; F.redo = [];
    }

    /** Leave Fix: with changes, Overwrite / Save Copy / Save As... / Cancel (Cancel stays in Fix). Resolves true if left. */
    async function leave() {
        if (!F.open) return true;
        if (!F.ops.length) { close(); return true; }
        const t = F.target;
        const canOverwrite = !!(t.print || (t.item && (t.item.source === 'folders' || /^(pictures|device:)/.test(t.item.source))));
        const choice = typeof root.showConfirmationDialog === 'function'
            ? await root.showConfirmationDialog(`Do you want to save the changes you made to ${esc(t.name || 'this picture')}?`, [
                ...(canOverwrite ? [{ text: 'Overwrite', value: 'overwrite' }] : []),
                ...(canOverwrite ? [{ text: 'Save Copy', value: 'copy' }] : []),
                { text: 'Save As...', value: 'saveas' },
                { text: 'Cancel', value: null }
            ], null, { title: 'Melaton Photo Gallery', icon: 'fas fa-circle-question', owner: shell() })
            : null;
        if (!choice) return false;
        const ok = await save(choice);
        if (ok) close();
        return ok;
    }

    async function fullCanvas() {
        const c = doc.createElement('canvas');
        c.width = F.source.width; c.height = F.source.height;
        c.getContext('2d').drawImage(F.source, 0, 0);
        return render(c, 1);
    }

    const blobOf = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q));
    const b64Of = (blob) => new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => resolve(''); r.readAsDataURL(blob); });

    async function save(mode) {
        const t = F.target;
        F.el.wait.hidden = false;
        F.el.wait.textContent = 'Saving...';
        try {
            const canvas = await fullCanvas();
            const jpeg = /\.jpe?g$/i.test(t.name || '') && !t.print;
            const blob = await blobOf(canvas, jpeg ? 'image/jpeg' : 'image/png', 0.92);
            if (!blob) throw new Error('The picture could not be encoded.');
            if (mode === 'saveas') return await saveAs(blob, t);
            if (await writeBack(t, blob, mode)) return true;
            return await saveAs(blob, t);
        } catch (err) {
            F.el.wait.hidden = true;
            if (typeof root.showConfirmationDialog === 'function') {
                await root.showConfirmationDialog(esc((err && err.message) || 'Changes to this picture have not been saved.'), [{ text: 'OK', value: true }], null, { title: 'Melaton Photo Gallery', icon: 'fas fa-circle-xmark', owner: shell() });
            }
            return false;
        } finally {
            if (F.el.wait) F.el.wait.hidden = true;
        }
    }

    /** The fixed (or rotated) picture back where it came from; false where it has no home to go back to. */
    async function writeBack(t, blob, mode) {
        if (t.print) {
            const r = await send('glancewell_fix_save', { filename: t.print.filename, mode, workspaceId: t.print.workspaceId || undefined, data: await b64Of(blob) });
            if (!r || r.success === false) throw new Error((r && r.error) || 'Changes to this picture have not been saved.');
            afterSave(t, mode, r.filename);
            return true;
        }
        const it = t.item;
        if (it && it.source === 'folders') {
            const data = await b64Of(blob);
            if (mode === 'overwrite') await vfs().replaceFile(it.key, data, blob.type);
            else await vfs().uploadFile(it.parentPath || '/', data, copyName(it.name), blob.type);
            afterSave(t, mode);
            return true;
        }
        // a phone's picture (this phone, an ActiveSync device) or a DreamOS drive's: written back by its own storage
        const src = it && root.glancewellSources ? root.glancewellSources.get(it.source) : null;
        const store = src && typeof src.store === 'function' ? src.store() : null;
        if (it && it.raw && it.raw.root && store && typeof store.write === 'function') {
            const dir = store.parentPath(it.raw.path);
            const name = mode === 'overwrite' ? it.name : copyName(it.name);
            await store.write(it.raw.root, dir, new File([blob], name, { type: blob.type }), { name, conflict: mode === 'overwrite' ? 'replace' : 'rename', deviceId: it.source.startsWith('device:') ? it.source.slice(7) : undefined });
            afterSave(t, mode);
            return true;
        }
        return false;
    }

    /**
     * Rotate Clockwise / Counterclockwise on the file itself, as Photo Gallery's do ("Rotating..."): the picture
     * turned a quarter and saved over itself (a print keeps its parameters and its original for Revert).
     * target as for open(); dir 1 = clockwise, -1 = counterclockwise. Resolves true once saved.
     */
    async function rotateFile(target, dir) {
        const img = await loadImage(target.src);
        const c = doc.createElement('canvas');
        c.width = img.height; c.height = img.width;
        const g = c.getContext('2d');
        g.translate(c.width / 2, c.height / 2);
        g.rotate((dir > 0 ? 90 : -90) * Math.PI / 180);
        g.drawImage(img, -img.width / 2, -img.height / 2);
        const jpeg = /\.jpe?g$/i.test(target.name || '') && !target.print;
        const blob = await blobOf(c, jpeg ? 'image/jpeg' : 'image/png', 0.95);
        if (!blob) throw new Error('You cannot rotate this image. Image format not recognized.');
        if (!(await writeBack(target, blob, 'overwrite'))) throw new Error('You cannot rotate this image. Rotating this image type is not supported.');
        return true;
    }

    function copyName(name) {
        const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(String(name || 'Picture'));
        return `${m[1]} (fixed)${m[2] || '.png'}`;
    }

    /** Save As...: the shared Save dialog (studioSession.js), into the VFS. */
    function saveAs(blob, t) {
        return new Promise((resolve) => {
            if (typeof root.studioOpenFolderDialog !== 'function') { resolve(false); return; }
            const ext = blob.type === 'image/jpeg' ? 'jpg' : 'png';
            const base = String(t.name || 'Picture').replace(/\.[a-z0-9]+$/i, '');
            let settled = false;
            root.studioOpenFolderDialog('save', {
                owner: shell(),
                host: {
                    title: 'Save As',
                    types: [{ label: ext === 'jpg' ? 'JPEG (*.jpg)' : 'PNG (*.png)', ext }],
                    suggestName: `${base}.${ext}`,
                    onSave: async ({ path, name }) => {
                        const n = /\.[a-z0-9]+$/i.test(name) ? name : `${name}.${ext}`;
                        await vfs().uploadFile(path, await b64Of(blob), n, blob.type);
                        settled = true;
                        afterSave(t, 'saveas');
                        resolve(true);
                        return true;
                    },
                    onCancel: () => { if (!settled) resolve(false); }
                }
            });
        });
    }

    function afterSave(t, mode, newName) {
        // the viewer shows the saved pixels (a new address so no cached copy stands in)
        if (mode === 'overwrite' && t.onSaved) t.onSaved(`${t.src.split('?')[0]}?v=${Date.now()}`);
        if (mode === 'copy' && t.onCopied) t.onCopied(newName);
    }

    async function revertToOriginal() {
        const t = F.target;
        if (!F.hasOriginal || !t || !t.print) return;
        // WPG 8057 / 8089
        const ok = typeof root.showConfirmationDialog === 'function' && (await root.showConfirmationDialog('Are you sure you want to revert to the original version of this picture?<br><br>If you revert, all changes you have made to this picture will be lost.', [{ text: 'Revert', value: true }, { text: 'Cancel', value: false }], null, { title: 'Revert to Original', icon: 'fas fa-triangle-exclamation', owner: shell() })) === true;
        if (!ok) return;
        try {
            await send('glancewell_fix_revert', { filename: t.print.filename, workspaceId: t.print.workspaceId || undefined });
            F.ops = []; F.redo = []; F.hasOriginal = false;
            const src = `${t.src.split('?')[0]}?v=${Date.now()}`;
            if (t.onSaved) t.onSaved(src);
            close();
        } catch (err) {
            // WPG 8098
            if (typeof root.showConfirmationDialog === 'function') await root.showConfirmationDialog("Photo Gallery can't revert this picture because a problem has occurred.", [{ text: 'OK', value: true }], null, { title: 'Melaton Photo Gallery', icon: 'fas fa-circle-xmark', owner: shell() });
        }
    }

    void originOffset;
    root.glancewellFix = { open, close, leave, rotateFile, isOpen: () => F.open, _state: F };
})(typeof window !== 'undefined' ? window : globalThis);
