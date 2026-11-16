/**
 * Melaton Mobile: DreamStudio part - Refs (#860 migration). Joins the program through
 * wmDreamStudio.extend; reaches Studio only through studioModel (studioModelRefs.js adds what it needs).
 *
 * The References tab lists every reference of the session, one row each (its picture, what it is,
 * its numbers as LCDs): the base image, the character / style (precise) references and the vibe
 * transfers, with Normalize Vibes under the vibes. A tap opens a small dialog of LCD + jog rows and
 * check boxes with Remove. Menu > Add holds the desktop Add menu's reference rows in its order:
 * Base Image..., Vibe Transfer... (the workspace's vibes, or a gallery picture encoded first),
 * Character / Style..., Previous Image / Current Image for the print on show, and Upload (a picture
 * from the phone's storage, the gallery, Browse device... or the Camera) as base image, character /
 * style or vibe.
 *
 * The base image's dialog also holds Image Bias (the desktop's five positions, and its Image Bias
 * adjustment: X, Y, Scale, Rotate with a preview, a preset and Reset) and Inpaint..., the desktop's
 * Mask Editor as a page of its own: the picture with the mask drawn over it by finger, Brush /
 * Eraser / Shape / Size / Invert / Clear on the tool bar, Save on the left soft key, Delete Mask in
 * Menu; the mask is saved where and as the desktop saves it (inpaint.js saveMask).
 */
(function () {
    'use strict';
    if (window.uiShell !== 'mobile' || !window.wmDreamStudio || typeof window.wmDreamStudio.extend !== 'function') return;

    window.wmDreamStudio.extend('Refs', (api, reg) => {
        const { M, esc } = api;
        const ui = () => api.ui;
        const sh = () => api.sh;
        const TYPES = { 1: 'Character and Style', 2: 'Character', 3: 'Style' };
        const pct = (v) => `${Math.round(Number(v) * 100)}%`;
        const has = (name) => M && typeof M[name] === 'function';
        const state = () => (has('refsState') ? M.refsState() : { precise: [], vibes: [], normalize: true, vibeBlock: '', preciseBlock: '' });
        const say = (text, icon = 'info') => sh().messageBox({ title: 'DreamStudio', text, icon, modal: true });
        const caps = () => (M.options() || { has: {} }).has || {};
        const mask = () => (has('maskState') ? M.maskState() : { canMask: false, has: false });
        const icon = (cls) => api.toolIcon(cls);

        // ---------------------------------------------------------------- the tab

        let lastHtml = '';

        function rowHtml(key, pic, name, caption, lcds, off) {
            return `<button type="button" class="wdr-row${off ? ' is-off' : ''}" data-ref="${esc(key)}">`
                + (pic ? `<img class="wdr-pic" alt="" src="${esc(pic)}">` : '<span class="wdr-pic" aria-hidden="true"></span>')
                + `<span class="wdr-name"><b>${esc(name)}</b><span>${esc(caption)}</span></span>`
                + lcds.map(([v, signed]) => `<span class="wm-lcd wdr-lcd" data-v="${esc(Number(v).toFixed(2))}"${signed ? ' data-signed="1"' : ''}></span>`).join('')
                + '</button>';
        }

        function drawPane(el) {
            const s = api.read();
            const st = state();
            const rows = [];
            if (s.hasBaseImage) {
                const nums = [[s.strength]];
                const noise = caps().noise !== false;
                if (noise) nums.push([s.noise]);
                const masked = mask().has;
                rows.push(rowHtml('base', api.thumbUrl(s.baseImage) || st.basePreview, masked ? 'Base Image, Inpaint' : 'Base Image', noise ? 'Strength, Noise' : 'Strength', nums, false));
            }
            st.precise.forEach((r) => rows.push(rowHtml(`p:${r.key}`, r.file ? api.thumbUrl(r.file) : r.preview, TYPES[r.type] || TYPES[1], 'Strength, Fidelity', [[r.strength], [r.fidelity]], !r.enabled)));
            st.vibes.forEach((v) => rows.push(rowHtml(`v:${v.id}`, v.preview, 'Vibe Transfer', v.missing ? 'IE not encoded, Strength' : 'IE, Strength', [[v.ie == null ? 0 : v.ie], [v.strength, true]], !v.enabled)));
            let html = rows.length ? `<div class="wdr-list">${rows.join('')}</div>` : '<p class="wds-none">No references. Menu &gt; Add adds one.</p>';
            if (st.vibes.length) html += `<div class="wdr-norm">${ui().check('wdrNormalize', 'Normalize Vibe Strengths', st.normalize, 'data-wdr="normalize"')}</div>`;
            // drawn again only when something shows differently (a paint comes with every change; the
            // list keeps its scroll place otherwise)
            if (html !== lastHtml || !el.querySelector('.wdr-list, .wds-none')) {
                lastHtml = html;
                el.innerHTML = html;
                el.querySelectorAll('.wdr-lcd').forEach((lcd) => ui().segText(lcd, lcd.dataset.v, { signed: lcd.dataset.signed === '1' }));
            }
            if (el.dataset.wdrBound) return;
            el.dataset.wdrBound = '1';
            el.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('.wdr-row');
                if (!b) return;
                const k = b.dataset.ref || '';
                if (k === 'base') baseDialog();
                else if (k.startsWith('p:')) preciseDialog(k.slice(2));
                else if (k.startsWith('v:')) vibeDialog(k.slice(2));
            });
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (t && t.dataset && t.dataset.wdr === 'normalize') { M.setNormalizeVibes(!!t.checked); api.paint(); }
            });
        }

        reg.pane('refs', { draw: (el) => drawPane(el) });

        // ---------------------------------------------------------------- dialog pieces

        const lcdRow = (key, label) => `<div class="wds-wt-row is-on" data-j="${key}"><span class="wds-wt-name">${esc(label)}</span><button type="button" class="wds-wt-lcd wm-lcd wdr-padlcd" aria-label="${esc(label)}: type a value"></button></div>`;

        /**
         * A dialog row's LCD and jog: the value goes 120 ms after the wheel stops (as api.dlgJog; instant:
         * at once), the LCD shows a sign figure when the value can go negative and a tap on it opens the
         * number pad (with a minus key for those, a point key for a value with decimals).
         * Returns { set(value) }.
         */
        function jogRow(row, { label, value, min, max, step, fineStep, digits = 2, instant = false, disabled = false, onChange }) {
            const lcd = row.querySelector('.wm-lcd');
            const signed = min < 0;
            const show = (v) => ui().segText(lcd, Number(v).toFixed(digits), { signed });
            let cur = Number(value) || 0;
            let timer = 0;
            show(cur);
            const send = (v) => { if (instant) onChange(v); else { clearTimeout(timer); timer = setTimeout(() => onChange(v), 120); } };
            const jog = ui().jogWheel(row, { label, value: cur, min, max, step, fineStep, stepPx: 18, zeroStop: 0, disabled, onChange: (v) => { cur = v; show(v); send(v); } });
            if (disabled) { lcd.disabled = true; row.classList.remove('is-on'); }
            lcd.addEventListener('click', () => {
                if (disabled) return;
                ui().numPad({
                    title: label,
                    value: Number(cur).toFixed(digits),
                    point: digits > 0,
                    minus: signed,
                    max: Math.max(String(Math.trunc(Math.max(Math.abs(min), Math.abs(max)))).length + digits, 3),
                    onOk: (t) => {
                        const n = parseFloat(t);
                        if (!Number.isFinite(n)) return;
                        const f = 10 ** digits;
                        cur = Math.max(min, Math.min(max, Math.round(n * f) / f));
                        show(cur);
                        if (jog && typeof jog.set === 'function') jog.set(cur);
                        onChange(cur);
                    }
                });
            });
            return { set: (v) => { cur = Number(v) || 0; show(cur); if (jog && typeof jog.set === 'function') jog.set(cur); } };
        }

        /** A combo inside one of these dialogs (the kit lifts its list over the dialog layer). */
        function combo(btn, options, current, onPick) {
            if (!btn) return;
            ui().bindCombo(btn, options, current, onPick);
        }

        const picHtml = (src) => (src ? `<img class="wds-base-pic" alt="" src="${esc(src)}">` : '');
        const buttons = (list) => `<div class="wm-msgbox-buttons">${list.map(([act, label]) => `<button type="button" data-wdr-act="${act}">${esc(label)}</button>`).join('')}</div>`;
        const onAct = (el, map) => el.addEventListener('click', (e) => {
            const b = e.target.closest && e.target.closest('[data-wdr-act]');
            if (b && map[b.dataset.wdrAct]) map[b.dataset.wdrAct]();
        });

        // the desktop's questions where a mask would be lost (app.html #baseImageChangeAlertModal,
        // #imageBiasMaskAlertModal)
        function askReplace() {
            if (!mask().has) return Promise.resolve(true);
            return sh().messageBox({
                title: 'Replace Reference',
                text: 'Are you sure you want to replace the reference image? The inpainting mask will be erased.',
                icon: 'warning',
                modal: true,
                buttons: [{ text: 'Cancel', value: false }, { text: 'Replace', value: true, default: true }],
                cancelValue: false
            }).then((yes) => { if (yes) M.deleteMask(); return !!yes; });
        }

        /** Resolves 'go' (no mask), 'remove' (mask deleted first), 'new' (deleted; a new one is drawn after) or '' (Cancel). */
        function askBiasMask() {
            if (!mask().has) return Promise.resolve('go');
            return sh().messageBox({
                title: 'Mask Detected',
                text: 'Changing the image bias will invalidate the mask.',
                icon: 'warning',
                modal: true,
                buttons: [{ text: 'Cancel', value: '' }, { text: 'Remove Mask', value: 'remove' }, { text: 'New Mask', value: 'new', default: true }],
                cancelValue: ''
            }).then((v) => { if (v) M.deleteMask(); return v || ''; });
        }

        // ---------------------------------------------------------------- base image

        function chooseBase() {
            api.choosePicture('Base Image', (f) => askReplace().then((ok) => { if (ok && M.setBaseImage(f)) { api.refresh(); api.setTab('refs'); } }));
        }

        /**
         * The desktop's base image settings: Strength, Noise (where the model has noise; off while a mask
         * is set, as there), Image Bias (its five positions; the tool cell opens the adjustment), then
         * Inpaint..., Change..., Remove.
         */
        function baseDialog() {
            const s = api.read();
            if (!s.hasBaseImage) { chooseBase(); return; }
            const noise = caps().noise !== false;
            const m = mask();
            const b = has('biasState') ? M.biasState() : null;
            const biasLabel = b ? (b.custom ? 'Custom' : ((b.options.find((o) => o[0] === b.value) || b.options[2])[1])) : '';
            const acts = [];
            if (m.canMask) acts.push(['mask', 'Inpaint...']);
            acts.push(['change', 'Change...'], ['remove', 'Remove']);
            const el = api.openDlg('Base Image', 'wdr-dlg', picHtml(api.thumbUrl(s.baseImage) || state().basePreview)
                + lcdRow('strength', 'Strength') + (noise ? lcdRow('noise', 'Noise') : '')
                + (b ? `<div class="wds-wt-row is-on wdr-biasrow"><span class="wds-wt-name">Image Bias</span>${ui().comboHtml('bias', biasLabel, !b.show)}<button type="button" class="wm-tool" data-wdr-act="adjust" aria-label="Advanced Bias Adjustment" title="Advanced Bias Adjustment">${icon('fas fa-sliders')}</button></div>` : '')
                + buttons(acts));
            jogRow(el.querySelector('[data-j="strength"]'), { label: 'Strength', value: Number(s.strength) || 0, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => api.change('strength', v) });
            if (noise) jogRow(el.querySelector('[data-j="noise"]'), { label: 'Noise', value: Number(s.noise) || 0, min: 0, max: 1, step: 0.05, fineStep: 0.01, disabled: m.has, onChange: (v) => api.change('noise', v) });
            if (b) {
                combo(el.querySelector('.wm-combo[data-act="bias"]'), b.options, b.custom ? null : b.value, (v) => {
                    // the question is the shell's message box, under this dialog's layer: the dialog
                    // steps aside for it and comes back after (with the bias as it now is)
                    const masked = mask().has;
                    if (masked) api.closeDlg();
                    askBiasMask().then((how) => {
                        if (!how) { baseDialog(); return; }
                        sh().busy(M.setBias(v).then(() => { api.refresh(); if (how === 'new') openMask(); else if (masked) baseDialog(); }), { delay: 250 });
                    });
                });
            }
            onAct(el, {
                mask: () => { api.closeDlg(); openMask(); },
                adjust: () => { api.closeDlg(); biasDialog(); },
                change: () => { api.closeDlg(); chooseBase(); },
                remove: () => { M.clearBaseImage(); api.refresh(); api.closeDlg(); }
            });
        }

        // ---------------------------------------------------------------- Image Bias adjustment

        /**
         * The desktop's Image Bias window (imageBias.js showImageBiasAdjustmentModal): the picture placed
         * in the print's frame (drag it to move), X, Y, Scale, Rotate, a preset position, Reset and Save.
         * The preview draws as the desktop crops (cropImageWithDynamicBias).
         */
        function biasDialog() {
            const job = M.biasSource().then((src) => new Promise((resolve) => {
                if (!src) { resolve(null); return; }
                const img = new Image();
                img.onload = () => resolve({ src, img });
                img.onerror = () => resolve(null);
                img.src = src.url;
            }));
            sh().busy(job, { delay: 250 });
            job.then((got) => {
                if (!got) { say('Could not load image for adjustment', 'error'); return; }
                const { src, img } = got;
                const tw = src.target.width;
                const th = src.target.height;
                const cur = Object.assign({}, src.bias);
                const el = api.openDlg('Image Bias', 'wdr-dlg wdr-biasdlg', '<canvas class="wdr-bprev"></canvas>'
                    + lcdRow('x', 'X') + lcdRow('y', 'Y') + lcdRow('scale', 'Scale') + lcdRow('rotate', 'Rotate')
                    + `<div class="wds-wt-row is-on"><span class="wds-wt-name">Preset</span>${ui().comboHtml('preset', 'Preset')}</div>`
                    + buttons([['reset', 'Reset'], ['save', 'Save']]));
                const cv = el.querySelector('.wdr-bprev');
                const ctx = cv.getContext('2d');
                const fitPreview = () => {
                    const body = el.querySelector('.wds-dlg-body');
                    const unit = parseFloat(getComputedStyle(body).getPropertyValue('--wm-px')) || 1;
                    const maxW = body.clientWidth - 10 * unit;
                    const maxH = 120 * unit;
                    let w = maxW;
                    let h = w * th / tw;
                    if (h > maxH) { h = maxH; w = h * tw / th; }
                    cv.style.setProperty('--wdr-bw', `${Math.round(w)}px`);
                    cv.style.setProperty('--wdr-bh', `${Math.round(h)}px`);
                    const dpr = window.devicePixelRatio || 1;
                    cv.width = Math.round(w * dpr);
                    cv.height = Math.round(h * dpr);
                };
                const paintPreview = () => {
                    const k = cv.width / tw;
                    ctx.setTransform(1, 0, 0, 1, 0, 0);
                    ctx.clearRect(0, 0, cv.width, cv.height);
                    ctx.setTransform(k, 0, 0, k, 0, 0);
                    // as cropImageWithDynamicBias: the picture fills the frame from its top-left, then the bias
                    const iar = img.width / img.height;
                    const tar = tw / th;
                    const dw = iar > tar ? th * iar : tw;
                    const dh = iar > tar ? th : tw / iar;
                    ctx.translate(cur.x, cur.y);
                    ctx.rotate((cur.rotate * Math.PI) / 180);
                    ctx.scale(cur.scale, cur.scale);
                    ctx.drawImage(img, 0, 0, dw, dh);
                };
                fitPreview();
                paintPreview();
                const set = (k) => (v) => { cur[k] = v; paintPreview(); };
                const jogs = {
                    x: jogRow(el.querySelector('[data-j="x"]'), { label: 'X Position', value: cur.x, min: -2048, max: 2048, step: 8, fineStep: 1, digits: 0, instant: true, onChange: set('x') }),
                    y: jogRow(el.querySelector('[data-j="y"]'), { label: 'Y Position', value: cur.y, min: -2048, max: 2048, step: 8, fineStep: 1, digits: 0, instant: true, onChange: set('y') }),
                    scale: jogRow(el.querySelector('[data-j="scale"]'), { label: 'Scale', value: cur.scale, min: 0.1, max: 3, step: 0.05, fineStep: 0.01, instant: true, onChange: set('scale') }),
                    rotate: jogRow(el.querySelector('[data-j="rotate"]'), { label: 'Rotate', value: cur.rotate, min: -180, max: 180, step: 5, fineStep: 1, digits: 0, instant: true, onChange: set('rotate') })
                };
                const showAll = () => { Object.keys(jogs).forEach((k) => jogs[k].set(cur[k])); paintPreview(); };
                // the desktop's preset list (getImageBiasPresetOptions) and positions (applyImageBiasPreset)
                const b = M.biasState();
                const portrait = !!(b && b.portrait);
                const presets = portrait
                    ? [['0', 'Left'], ['1', '⅖ Left'], ['2', 'Center'], ['3', '⅘ Right'], ['4', 'Right']]
                    : [['0', 'Top'], ['1', '⅖ Top'], ['2', 'Center'], ['3', '⅘ Bottom'], ['4', 'Bottom']];
                combo(el.querySelector('.wm-combo[data-act="preset"]'), presets, null, (v) => {
                    const iar = img.width / img.height;
                    const tar = tw / th;
                    const fw = iar > tar ? th * iar : tw;
                    const fh = iar > tar ? th : tw / iar;
                    const pos = { 0: [0, 0], 1: [(tw - fw) / 2, 0], 2: [(tw - fw) / 2, (th - fh) / 2], 3: [(tw - fw) / 2, th - fh], 4: [tw - fw, th - fh] }[v] || [0, 0];
                    cur.x = Math.round(pos[0]);
                    cur.y = Math.round(pos[1]);
                    showAll();
                });
                // drag the picture in the frame (handleBiasImageMouseMove): frame pixels are print pixels / k
                let drag = null;
                cv.addEventListener('pointerdown', (e) => {
                    if (drag) return;
                    drag = { id: e.pointerId, x: e.clientX, y: e.clientY, bx: cur.x, by: cur.y };
                    try { cv.setPointerCapture(e.pointerId); } catch (_) { /* moves still come */ }
                    e.preventDefault();
                });
                cv.addEventListener('pointermove', (e) => {
                    if (!drag || e.pointerId !== drag.id) return;
                    const k = cv.getBoundingClientRect().width / tw;
                    cur.x = Math.max(-2048, Math.min(2048, Math.round(drag.bx + (e.clientX - drag.x) / k)));
                    cur.y = Math.max(-2048, Math.min(2048, Math.round(drag.by + (e.clientY - drag.y) / k)));
                    jogs.x.set(cur.x);
                    jogs.y.set(cur.y);
                    paintPreview();
                });
                const end = (e) => { if (drag && e.pointerId === drag.id) drag = null; };
                cv.addEventListener('pointerup', end);
                cv.addEventListener('pointercancel', end);
                onAct(el, {
                    reset: () => { Object.assign(cur, { x: 0, y: 0, scale: 1, rotate: 0 }); showAll(); },
                    save: () => {
                        const bias = Object.assign({}, cur);
                        api.closeDlg();
                        askBiasMask().then((how) => {
                            if (!how) return;
                            M.applyBias(bias);
                            api.refresh();
                            // the crop is made a moment later (from the picture's bytes)
                            if (how === 'new') setTimeout(openMask, 400);
                        });
                    }
                });
            });
        }

        // ---------------------------------------------------------------- Mask Editor (inpaint.js)

        // the editor's state between visits, as the desktop keeps it: tool, shape and the brush's share
        // of the grid's diagonal (its size is worked out again for each print size)
        const mk = { tool: 'brush', shape: 'circle', pct: 0.03, size: 5, grid: null, ctx: null, buf: null, stroke: null, view: null, jog: null };
        const INK = has('maskInk') ? M.maskInk() : [75, 254, 108];

        /** The desktop's circle stamp (getCircleBrushMask): radius r in grid cells. */
        const circles = new Map();
        function circle(r) {
            if (circles.has(r)) return circles.get(r);
            const size = 2 * r + 1;
            const m = new Uint8Array(size * size);
            const r2 = r * r;
            for (let i = 0; i <= r; i++) {
                for (let j = 0; j <= r; j++) {
                    const d1 = (j + 0.5) * (j + 0.5) + (i + 0.5) * (i + 0.5);
                    const d2 = (j - 0.5) * (j - 0.5) + (i - 0.5) * (i - 0.5);
                    if (Math.min(d1, d2) <= r2) {
                        m[(r + i) * size + (r + j)] = 1;
                        m[(r + i) * size + (r - j)] = 1;
                        m[(r - i) * size + (r + j)] = 1;
                        m[(r - i) * size + (r - j)] = 1;
                    }
                }
            }
            const c = { size, m };
            circles.set(r, c);
            return c;
        }

        /** One stamp into the stroke's pixels: the brush's ink, or clear for the eraser (drawCircle / drawSquare). */
        function stamp(x, y) {
            const g = mk.grid;
            const d = mk.buf.data;
            const on = mk.tool === 'brush';
            const put = (px, py) => {
                if (px < 0 || py < 0 || px >= g.width || py >= g.height) return;
                const p = (py * g.width + px) * 4;
                d[p] = on ? INK[0] : 0; d[p + 1] = on ? INK[1] : 0; d[p + 2] = on ? INK[2] : 0; d[p + 3] = on ? 255 : 0;
            };
            const r = mk.size;
            const cx = Math.round(x);
            const cy = Math.round(y);
            if (mk.shape === 'circle') {
                const c = circle(r);
                for (let i = 0; i < c.m.length; i++) if (c.m[i]) put(cx - r + (i % c.size), cy - r + Math.floor(i / c.size));
            } else {
                for (let yy = cy - r; yy < cy + r; yy++) for (let xx = cx - r; xx < cx + r; xx++) put(xx, yy);
            }
        }

        function gridPoint(e) {
            const rect = mk.grid.getBoundingClientRect();
            return { x: ((e.clientX - rect.left) / rect.width) * mk.grid.width, y: ((e.clientY - rect.top) / rect.height) * mk.grid.height };
        }

        // a finger moves further between two events than a mouse: the stamps fill the way between them
        function strokeTo(p) {
            const a = mk.stroke.last;
            const dist = Math.hypot(p.x - a.x, p.y - a.y);
            const n = Math.max(1, Math.ceil(dist / Math.max(1, mk.size / 2)));
            for (let i = 1; i <= n; i++) stamp(a.x + ((p.x - a.x) * i) / n, a.y + ((p.y - a.y) * i) / n);
            mk.stroke.last = p;
            mk.ctx.putImageData(mk.buf, 0, 0);
        }

        function setSize(v) {
            mk.size = Math.max(1, Math.min(10, Math.round(v)));
            const g = mk.grid;
            if (g) mk.pct = mk.size / Math.sqrt(g.width * g.width + g.height * g.height);
            const lcd = mk.view && mk.view.querySelector('.wdr-msize');
            if (lcd) ui().segText(lcd, String(mk.size).padStart(2, '!'));
            if (mk.jog) mk.jog.set(mk.size);
        }

        function syncBar() {
            const v = mk.view;
            if (!v) return;
            v.querySelector('[data-mk="brush"]').setAttribute('aria-pressed', String(mk.tool === 'brush'));
            v.querySelector('[data-mk="eraser"]').setAttribute('aria-pressed', String(mk.tool === 'eraser'));
            const sb = v.querySelector('[data-mk="shape"]');
            sb.innerHTML = icon(mk.shape === 'circle' ? 'fas fa-circle' : 'fas fa-square');
            sb.setAttribute('aria-label', mk.shape === 'circle' ? 'Brush Shape: Circle' : 'Brush Shape: Square');
        }

        /** The picture and the grid over it, as large as the page lets them at the print's shape. */
        function fitMask() {
            const v = mk.view;
            if (!v || !mk.grid) return;
            const stage = v.querySelector('.wdr-mstage');
            const frame = v.querySelector('.wdr-mframe');
            const cs = getComputedStyle(stage);
            const W = stage.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
            const H = stage.clientHeight - parseFloat(cs.paddingTop) - parseFloat(cs.paddingBottom);
            if (!W || !H) return;
            const ar = mk.grid.width / mk.grid.height;
            let w = W;
            let h = w / ar;
            if (h > H) { h = H; w = h * ar; }
            frame.style.setProperty('--wdr-fw', `${Math.floor(w)}px`);
            frame.style.setProperty('--wdr-fh', `${Math.floor(h)}px`);
        }

        function mountMask(el) {
            mk.view = el;
            el.innerHTML = '<div class="wdr-mstage"><div class="wdr-mframe"><img class="wdr-mpic" alt="" draggable="false"><canvas class="wdr-mgrid"></canvas></div></div>'
                + '<div class="wm-toolbar wdr-mbar">'
                + `<div class="wm-toolbar-group"><button type="button" class="wm-tool" data-mk="brush" aria-label="Brush Tool" title="Brush Tool">${icon('fas fa-paintbrush')}</button><button type="button" class="wm-tool" data-mk="eraser" aria-label="Eraser Tool" title="Eraser Tool">${icon('fas fa-eraser')}</button><button type="button" class="wm-tool" data-mk="shape" title="Toggle Brush Shape"></button></div>`
                + '<div class="wm-toolbar-group wdr-msizegrp"><span class="wm-tool-sep" aria-hidden="true"></span><button type="button" class="wm-lcd wdr-msize" aria-label="Brush Size: type a value"></button></div>'
                + `<div class="wm-toolbar-group"><span class="wm-tool-sep" aria-hidden="true"></span><button type="button" class="wm-tool" data-mk="invert" aria-label="Negative (Invert Mask)" title="Negative (Invert Mask)">${icon('fas fa-circle-half-stroke')}</button><button type="button" class="wm-tool" data-mk="clear" aria-label="Clear Mask" title="Clear Mask">${icon('fas fa-broom')}</button></div>`
                + '</div>';
            mk.grid = el.querySelector('.wdr-mgrid');
            mk.ctx = mk.grid.getContext('2d', { willReadFrequently: true });
            // the desktop's size field: 1 - 10 grid cells
            mk.jog = ui().jogWheel(el.querySelector('.wdr-msizegrp'), { label: 'Brush Size', value: mk.size, min: 1, max: 10, step: 1, stepPx: 18, zeroStop: 0, onChange: (v) => setSize(v) });
            el.querySelector('.wdr-msize').addEventListener('click', () => ui().numPad({ title: 'Brush Size', value: String(mk.size), max: 2, onOk: (t) => { const n = parseInt(t, 10); if (Number.isFinite(n)) setSize(n); } }));
            el.querySelector('.wdr-mbar').addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('[data-mk]');
                if (!b) return;
                const k = b.dataset.mk;
                if (k === 'brush' || k === 'eraser') mk.tool = k;
                else if (k === 'shape') mk.shape = mk.shape === 'square' ? 'circle' : 'square';
                else if (k === 'clear') mk.ctx.clearRect(0, 0, mk.grid.width, mk.grid.height);
                else if (k === 'invert') invertMask();
                syncBar();
            });
            const g = mk.grid;
            g.addEventListener('pointerdown', (e) => {
                if (mk.stroke) return;
                e.preventDefault();
                try { g.setPointerCapture(e.pointerId); } catch (_) { /* moves still come */ }
                mk.buf = mk.ctx.getImageData(0, 0, g.width, g.height);
                const p = gridPoint(e);
                mk.stroke = { id: e.pointerId, last: p };
                stamp(p.x, p.y);
                mk.ctx.putImageData(mk.buf, 0, 0);
            });
            g.addEventListener('pointermove', (e) => {
                if (!mk.stroke || e.pointerId !== mk.stroke.id) return;
                e.preventDefault();
                const list = typeof e.getCoalescedEvents === 'function' ? e.getCoalescedEvents() : [];
                (list.length ? list : [e]).forEach((ev) => strokeTo(gridPoint(ev)));
            });
            const end = (e) => { if (mk.stroke && e.pointerId === mk.stroke.id) { mk.stroke = null; mk.buf = null; } };
            g.addEventListener('pointerup', end);
            g.addEventListener('pointercancel', end);
            if (typeof ResizeObserver === 'function') new ResizeObserver(() => fitMask()).observe(el.querySelector('.wdr-mstage'));
            syncBar();
        }

        /** Negative (invertMask): painted cells cleared, clear cells painted; the tool flips with it, as there. */
        function invertMask() {
            const g = mk.grid;
            const id = mk.ctx.getImageData(0, 0, g.width, g.height);
            const d = id.data;
            for (let i = 0; i < d.length; i += 4) {
                const on = d[i + 3] === 0;
                d[i] = on ? INK[0] : 0; d[i + 1] = on ? INK[1] : 0; d[i + 2] = on ? INK[2] : 0; d[i + 3] = on ? 255 : 0;
            }
            mk.ctx.putImageData(id, 0, 0);
            mk.tool = mk.tool === 'eraser' ? 'brush' : 'eraser';
        }

        /** Inpaint: the editor at an 8x smaller grid of the print's size, with the mask as saved. */
        function openMask() {
            const st = mask();
            if (!st.canMask) { say('No source image available', 'error'); return; }
            if (!mk.view) return;
            const t = st.target;
            mk.grid.width = t.cw;
            mk.grid.height = t.ch;
            mk.ctx.clearRect(0, 0, t.cw, t.ch);
            mk.stroke = null;
            setSize(Math.round(Math.sqrt(t.cw * t.cw + t.ch * t.ch) * mk.pct));
            const pic = mk.view.querySelector('.wdr-mpic');
            if (st.background) pic.src = st.background; else pic.removeAttribute('src');
            if (st.has) M.loadMask(mk.grid);
            syncBar();
            api.openView('mask');
            requestAnimationFrame(fitMask);
        }

        function saveMaskNow() {
            M.saveMask(mk.grid);
            api.refresh();
            api.closeView();
        }

        reg.view('mask', {
            title: 'Mask Editor',
            mount: (el) => mountMask(el),
            draw: () => { fitMask(); syncBar(); },
            softKeys: () => ({
                left: { label: 'Save', action: saveMaskNow },
                right: { label: 'Menu', menu: () => [{ label: 'Delete Mask', action: () => { M.deleteMask(); api.refresh(); api.closeView(); } }] }
            })
        });

        // ---------------------------------------------------------------- character / style references

        /** One precise reference: Character / Style (the desktop's two toggles), on or off, Strength, Fidelity. */
        function preciseDialog(key) {
            const r = state().precise.find((x) => x.key === key);
            if (!r) return;
            const el = api.openDlg(TYPES[r.type] || 'Reference', 'wdr-dlg', picHtml(r.file ? api.thumbUrl(r.file) : r.preview)
                + `<div class="wdr-checks">${ui().check('wdrChar', 'Character', r.type === 1 || r.type === 2, 'data-pt="character"')}${ui().check('wdrStyle', 'Style', r.type === 1 || r.type === 3, 'data-pt="style"')}${ui().check('wdrOn', 'Enabled', r.enabled, 'data-pt="on"')}</div>`
                + lcdRow('strength', 'Strength') + lcdRow('fidelity', 'Fidelity')
                + buttons([['remove', 'Remove']]));
            const title = el.querySelector('.wm-msgbox-title > span');
            const put = (patch) => { M.setPrecise(key, patch); api.refresh(); };
            jogRow(el.querySelector('[data-j="strength"]'), { label: 'Strength', value: r.strength, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => put({ strength: v }) });
            jogRow(el.querySelector('[data-j="fidelity"]'), { label: 'Fidelity', value: r.fidelity, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (v) => put({ fidelity: v }) });
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (!t || !t.dataset || !t.dataset.pt) return;
                if (t.dataset.pt === 'on') { put({ enabled: !!t.checked }); return; }
                const c = el.querySelector('[data-pt="character"]');
                const s = el.querySelector('[data-pt="style"]');
                // as the desktop's toggles: one of the two stays on (turning off the last turns the other on)
                if (!c.checked && !s.checked) (t === c ? s : c).checked = true;
                const type = c.checked && s.checked ? 1 : c.checked ? 2 : 3;
                put({ type });
                if (title) title.textContent = TYPES[type];
            });
            onAct(el, { remove: () => { M.removePrecise(key); api.refresh(); api.closeDlg(); } });
        }

        function addPreciseFile(f) {
            M.addPrecise(f).then((res) => {
                api.refresh();
                if (!res.ok && res.message) say(res.message);
                api.setTab('refs');
            });
        }

        function addPrecise() {
            const st = state();
            if (st.preciseBlock) { say(st.preciseBlock); return; }
            api.choosePicture('Character / Style', addPreciseFile);
        }

        // ---------------------------------------------------------------- vibe transfers

        /** One vibe: its IE (the encodings it has for the session's model), Strength -1..1, on / off, Text Injection. */
        function vibeDialog(id) {
            const v = state().vibes.find((x) => x.id === id);
            if (!v) return;
            const ieLabel = v.ie == null ? 'None' : pct(v.ie);
            const acts = [];
            // the desktop offers a new IE where the vibe has none for this model
            if (!v.ies.length) acts.push(['ie', 'Request IE...']);
            acts.push(['remove', 'Remove']);
            const el = api.openDlg('Vibe Transfer', 'wdr-dlg', picHtml(v.preview)
                + `<div class="wds-wt-row is-on"><span class="wds-wt-name">Information Extracted</span>${ui().comboHtml('ie', ieLabel, !v.ies.length)}</div>`
                + lcdRow('strength', 'Strength')
                + `<div class="wdr-checks">${ui().check('wdrVOn', 'Enabled', v.enabled, 'data-vt="enabled"')}${ui().check('wdrVInj', 'Text Injection', v.inject, 'data-vt="inject"')}</div>`
                + buttons(acts));
            const put = (patch) => { M.setVibe(id, patch); api.refresh(); };
            combo(el.querySelector('.wm-combo'), v.ies.map((x) => [x, pct(x)]), v.ie, (x) => put({ ie: x }));
            jogRow(el.querySelector('[data-j="strength"]'), { label: 'Strength', value: v.strength, min: -1, max: 1, step: 0.05, fineStep: 0.01, onChange: (x) => put({ strength: x }) });
            el.addEventListener('change', (e) => {
                const t = e.target;
                if (t && t.dataset && t.dataset.vt) put({ [t.dataset.vt]: !!t.checked });
            });
            onAct(el, {
                remove: () => { M.removeVibe(id); api.refresh(); api.closeDlg(); },
                ie: () => {
                    if (!v.locked) { encodeDialog({ id, preview: v.preview, ie: v.ie }); return; }
                    sh().messageBox({ title: 'DreamStudio', text: 'This reference cannot be modified. Would you like to remove it from your references?', icon: 'question', modal: true, buttons: [{ text: 'Remove', value: true }, { text: 'Cancel', value: false, default: true }], cancelValue: false })
                        .then((yes) => { if (yes) { M.removeVibe(id); api.refresh(); api.closeDlg(); } });
                }
            });
        }

        /**
         * Encode a vibe (the desktop's Vibe Encoding dialog): a gallery picture (filename), a picture from
         * the device (blob) or a new IE for a vibe (id). Model, Information Extraction (0.35 by default)
         * and, for a picture, a comment. Encode spends Anlas (the server's NovelAI call).
         */
        function encodeDialog({ filename = '', blob = null, id = '', preview = '', ie = null }) {
            const models = M.vibeModels();
            if (!models.length) { say('No model can encode vibes.'); return; }
            const cur = String(api.read().model || '').toLowerCase();
            let model = (models.find((m) => m.value.toLowerCase() === cur) || models[0]).value;
            let value = ie == null ? 0.35 : Number(ie);
            const blobUrl = blob ? URL.createObjectURL(blob) : '';
            const el = api.openDlg(id ? 'Request New IE' : 'Encode Vibe', 'wdr-dlg', picHtml(filename ? api.thumbUrl(filename) : (blobUrl || preview))
                + `<div class="wds-wt-row is-on"><span class="wds-wt-name">Model</span>${ui().comboHtml('model', (models.find((m) => m.value === model) || models[0]).name)}</div>`
                + lcdRow('ie', 'IE')
                + (id ? '' : `<div class="wds-wt-row is-on"><span class="wds-wt-name">Comment</span>${ui().edit('', '', 'data-wdr="comment" maxlength="200" placeholder="Optional"')}</div>`)
                + buttons([['encode', 'Encode']]), { onClose: () => { if (blobUrl) setTimeout(() => URL.revokeObjectURL(blobUrl), 1000); } });
            combo(el.querySelector('.wm-combo'), models.map((m) => [m.value, m.name]), model, (x) => { model = x; });
            jogRow(el.querySelector('[data-j="ie"]'), { label: 'Information Extraction', value, min: 0, max: 1, step: 0.05, fineStep: 0.01, onChange: (x) => { value = x; } });
            onAct(el, {
                encode: () => {
                    const c = el.querySelector('[data-wdr="comment"]');
                    const comment = c ? c.value.trim() : '';
                    api.closeDlg();
                    const job = M.encodeVibe({ filename, blob, id, ie: value, model, comment, add: true }).then((res) => {
                        api.refresh();
                        api.setTab('refs');
                        if (!res.ok) say(res.message || 'Failed to process vibe encoding.', 'error');
                    });
                    sh().busy(job, { delay: 250 });
                }
            });
        }

        /** Vibe Transfer...: the workspace's vibes to pick from (as the desktop's reference browser), or Picture... to encode one. */
        function vibePicker() {
            const st = state();
            if (st.vibeBlock) { say(st.vibeBlock); return; }
            const el = api.openDlg('Vibe Transfer', 'wdr-dlg wdr-pickdlg', '<div class="wdr-grid"><p class="wds-none">Loading...</p></div>' + buttons([['picture', 'Picture...']]));
            const grid = el.querySelector('.wdr-grid');
            let list = [];
            M.workspaceVibes().then((vibes) => {
                if (!el.isConnected) return;
                const inSession = new Set(state().vibes.map((v) => v.id));
                // encoded for the session's model first, as those are the ones that can be used now
                list = vibes.filter((v) => !inSession.has(v.id)).sort((a, b) => (b.ies.length ? 1 : 0) - (a.ies.length ? 1 : 0));
                grid.innerHTML = list.length
                    ? list.map((v, i) => `<button type="button" class="wdr-cell${v.ies.length ? '' : ' is-off'}" data-i="${i}" aria-label="${esc(v.comment || 'Vibe')}">${v.preview ? `<img alt="" src="${esc(v.preview)}">` : ''}</button>`).join('')
                    : '<p class="wds-none">The workspace has no vibes. Picture... encodes one.</p>';
            });
            grid.addEventListener('click', (e) => {
                const b = e.target.closest && e.target.closest('.wdr-cell');
                const v = b && list[Number(b.dataset.i)];
                if (!v) return;
                api.closeDlg();
                M.addVibe(v.id, v.ies.length ? v.ies[0] : null).then((res) => {
                    api.refresh();
                    api.setTab('refs');
                    if (!res.ok && res.message) say(res.message);
                });
            });
            onAct(el, {
                picture: () => {
                    api.closeDlg();
                    api.choosePicture('Vibe Transfer', (f) => encodeDialog({ filename: f }));
                }
            });
        }

        // ---------------------------------------------------------------- Upload (a picture from the device)

        /** The phone's file (the Android bridge's URL) as a File, as the Director's attachments read it. */
        async function phoneFile(item) {
            const PS = window.phoneStorage;
            const url = PS && typeof PS.fileUrl === 'function' ? PS.fileUrl(item.phoneFile.root, item.phoneFile.path) : '';
            if (!url) throw new Error('The phone did not give the file.');
            const res = await fetch(url);
            if (!res.ok) throw new Error('The phone did not give the file.');
            const b = await res.blob();
            return new File([b], item.name || 'picture', { type: item.mimeType || b.type || 'image/jpeg' });
        }

        const pictureOf = (item) => {
            if (!item || item.kind === 'folder') return '';
            if (item.targetKind === 'image') return item.previewImageFilename || item.targetId || '';
            if (item.shortcutType === 'image' && item.shortcutData && item.shortcutData.filename) return item.shortcutData.filename;
            return '';
        };

        /**
         * WM's Open dialog with the phone's own storage among its locations (wmFileDialogs, phone: true):
         * a picture on the phone comes as a File (onFile), one of the gallery's as its name (onGallery).
         * Menu offers Browse device... (the phone's own picker) and the Camera (wmCamera; its picture
         * is then in the camera roll, a location of this dialog).
         */
        function pickDevicePicture(title, onFile, onGallery) {
            const browse = () => {
                const input = document.createElement('input');
                input.type = 'file';
                input.accept = 'image/*';
                input.addEventListener('change', () => { const f = input.files && input.files[0]; if (f) onFile(f); }, { once: true });
                input.click();
            };
            const fd = window.wmFileDialogs;
            if (!fd || typeof fd.open !== 'function') { browse(); return; }
            const extra = [{ label: 'Browse device...', action: () => { fd.close(); browse(); } }];
            if (window.wmCamera && typeof window.wmCamera.supported === 'function' && window.wmCamera.supported()) extra.push({ label: 'Camera', action: () => { fd.close(); window.wmCamera.open(); } });
            fd.open({
                title,
                appTitle: 'DreamStudio',
                typeLabel: 'Pictures',
                phone: true,
                pictures: true,
                accept: (i) => (i.phoneFile ? /^image\//.test(i.mimeType || '') : !!pictureOf(i)),
                extra,
                async onPick(item) {
                    if (item.phoneFile) {
                        try { onFile(await phoneFile(item)); } catch (err) { say((err && err.message) || String(err), 'error'); }
                        return true;
                    }
                    const f = pictureOf(item);
                    if (f) onGallery(f);
                    return true;
                }
            });
        }

        function uploadBase() {
            pickDevicePicture('Base Image', (file) => askReplace().then((ok) => {
                if (!ok) return;
                const job = M.uploadBase(file).then((res) => {
                    api.refresh();
                    api.setTab('refs');
                    if (!res.ok && res.message) say(res.message, 'error');
                });
                sh().busy(job, { delay: 250 });
            }), (f) => askReplace().then((ok) => { if (ok && M.setBaseImage(f)) { api.refresh(); api.setTab('refs'); } }));
        }

        function uploadPrecise() {
            const st = state();
            if (st.preciseBlock) { say(st.preciseBlock); return; }
            pickDevicePicture('Character / Style', (file) => {
                const job = M.uploadPrecise(file, 1).then((res) => {
                    api.refresh();
                    api.setTab('refs');
                    if (!res.ok && res.message) say(res.message, 'error');
                });
                sh().busy(job, { delay: 250 });
            }, addPreciseFile);
        }

        function uploadVibe() {
            const st = state();
            if (st.vibeBlock) { say(st.vibeBlock); return; }
            pickDevicePicture('Vibe Transfer', (file) => encodeDialog({ blob: file }), (f) => encodeDialog({ filename: f }));
        }

        // ---------------------------------------------------------------- Menu > Add

        /** Previous Image / Current Image from the print on show (the desktop's rows work from the session's picture). */
        function fromPrint(kind) {
            const f = api.shownPrint();
            const go = () => {
                const job = Promise.resolve(has('addBaseFromPrint') ? M.addBaseFromPrint(kind, f) : M.addBaseFrom(kind)).then((ok) => {
                    if (ok) { api.refresh(); setTimeout(() => api.setTab('refs'), 450); } else say(kind === 'reroll' ? 'This print has no previous image.' : 'This print cannot be used as the base image.');
                });
                sh().busy(job, { delay: 250 });
            };
            askReplace().then((ok) => { if (ok) go(); });
        }

        reg.menu('add', () => {
            const st = state();
            const o = M.options();
            const noVibes = st.vibeBlock === 'Vibe transfer is not supported on this model.';
            const noPrecise = !(o && o.has && o.has.references) || /not supported/.test(st.preciseBlock);
            const pc = has('printChoices') ? M.printChoices(api.shownPrint()) : { reroll: st.reroll, variation: st.variation };
            const rows = [
                { label: 'Base Image...', action: () => (api.read().hasBaseImage ? baseDialog() : chooseBase()) },
                // the model takes no vibes: greyed; refused for a reason of the session (a mask, precise
                // references): the desktop's message
                { label: 'Vibe Transfer...', disabled: noVibes, action: vibePicker },
                { label: 'Character / Style...', disabled: noPrecise, action: addPrecise }
            ];
            if (pc.reroll) rows.push({ label: 'Previous Image', action: () => fromPrint('reroll') });
            if (pc.variation) rows.push({ label: 'Current Image', action: () => fromPrint('variation') });
            rows.push({
                label: 'Upload',
                submenu: () => [
                    { label: 'Base Image...', action: uploadBase },
                    { label: 'Character / Style...', disabled: noPrecise, action: uploadPrecise },
                    { label: 'Vibe Transfer...', disabled: noVibes, action: uploadVibe }
                ]
            });
            return rows;
        });
    });
})();
