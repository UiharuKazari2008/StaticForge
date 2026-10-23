/**
 * Paint's brush engine (Yozora #632), Photoshop's: a brush is a tip stamped along the stroke.
 *
 *   tip        round (its hardness), square, or a picture (Edit > Define Brush Preset: the dark
 *              of the selection is the paint); roundness and angle squash and turn it
 *   dabs       every Spacing % of the size; Scatter moves them off the line, Size / Angle Jitter
 *              varies them; Flow is each dab's strength (Opacity caps the whole stroke)
 *   pressure   a pen's pressure (PointerEvent.pressure) can drive the size and the flow
 *   presets    Hard Round, Soft Round, Airbrush, Chalk, Spatter, Calligraphy, Square, Dry Brush and
 *              the person's own (the registry, Applets\Paint BrushPresets)
 *
 *   paintBrush.settings(w)            the brush in use
 *   paintBrush.begin(w) / stroke(w, a, b, pa, pb, color) -> dirty rect
 *   paintBrush.pressureOf(ev)         0-1 (a mouse is 1)
 *   paintBrush.picker(w, el) / togglePanel(w) / panelOpen(w) / definePreset(w)
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };

    const BASE = { tip: 'round', hardness: 100, spacing: 10, angle: 0, roundness: 100, scatter: 0, sizeJitter: 0, angleJitter: 0, flow: 100, pressureSize: true, pressureFlow: false };
    const PRESETS = [
        { id: 'hard', name: 'Hard Round', ...BASE },
        { id: 'soft', name: 'Soft Round', ...BASE, hardness: 0, spacing: 8 },
        { id: 'air', name: 'Airbrush', ...BASE, hardness: 0, spacing: 4, flow: 12, pressureSize: false, pressureFlow: true },
        { id: 'chalk', name: 'Chalk', ...BASE, tip: 'chalk', spacing: 18, scatter: 12, sizeJitter: 25, angleJitter: 100 },
        { id: 'spatter', name: 'Spatter', ...BASE, tip: 'spatter', spacing: 30, scatter: 60, sizeJitter: 40, angleJitter: 100 },
        { id: 'callig', name: 'Calligraphy', ...BASE, roundness: 20, angle: 45, spacing: 3 },
        { id: 'square', name: 'Square', ...BASE, tip: 'square', spacing: 6 },
        { id: 'dry', name: 'Dry Brush', ...BASE, tip: 'bristle', spacing: 6, angleJitter: 8, pressureFlow: true }
    ];
    const tipCache = new Map();
    const customTips = new Map(); // id -> canvas (a picture tip)

    // ---- presets -----------------------------------------------------------------------------------

    function userPresets() {
        try {
            const list = JSON.parse(reg('BrushPresets', '[]') || '[]');
            return Array.isArray(list) ? list : [];
        } catch (_) { return []; }
    }

    function allPresets() { return PRESETS.concat(userPresets()); }

    function saveUserPresets(list) { setReg({ BrushPresets: JSON.stringify(list.slice(0, 60)) }); }

    /** The brush in use: the window's, else the one last chosen (the registry), else Hard Round. */
    function settings(w) {
        if (!w.brushSet) {
            let last = null;
            try { last = JSON.parse(reg('BrushCurrent', 'null') || 'null'); } catch (_) { /* Hard Round */ }
            w.brushSet = { ...BASE, ...(last || PRESETS[0]) };
            if (typeof w.brushSet.hardness === 'number') w.opt.hardness = w.brushSet.hardness;
        }
        // the options bar's Hardness is the brush's
        w.brushSet.hardness = w.opt.hardness;
        return w.brushSet;
    }

    function choose(w, preset) {
        w.brushSet = { ...BASE, ...preset };
        w.opt.hardness = w.brushSet.hardness;
        if (preset.size) w.opt.size = preset.size;
        setReg({ BrushCurrent: JSON.stringify(w.brushSet) });
        if (preset.tipData && !customTips.has(preset.tip)) loadTip(preset);
        w.renderBar();
        w.renderOptions();
        refreshPanel(w);
        w.brushCursor();
    }

    function remember(w) { setReg({ BrushCurrent: JSON.stringify(w.brushSet) }); }

    function loadTip(preset) {
        const img = new Image();
        img.onload = () => {
            const c = doc.createElement('canvas');
            c.width = img.naturalWidth;
            c.height = img.naturalHeight;
            c.getContext('2d').drawImage(img, 0, 0);
            customTips.set(preset.tip, c);
            tipCache.clear();
        };
        img.src = preset.tipData;
    }

    userPresets().forEach((p) => { if (p.tipData) loadTip(p); });

    // ---- tips -------------------------------------------------------------------------------------

    /** The tip's alpha shape at a size (before roundness and angle): a canvas, white with alpha. */
    function baseTip(set, px) {
        const n = Math.max(1, Math.ceil(px));
        const key = `${set.tip}|${set.tip === 'round' ? set.hardness : ''}|${n}`;
        if (tipCache.has(key)) return tipCache.get(key);
        const c = doc.createElement('canvas');
        c.width = n;
        c.height = n;
        const x = c.getContext('2d');
        const r = n / 2;
        if (set.tip === 'square') {
            x.fillStyle = '#fff';
            x.fillRect(0, 0, n, n);
        } else if (customTips.has(set.tip)) {
            x.drawImage(customTips.get(set.tip), 0, 0, n, n);
        } else if (set.tip === 'chalk' || set.tip === 'spatter' || set.tip === 'bristle') {
            // generated textures, the same every time (a fixed seed)
            let s = { chalk: 7, spatter: 13, bristle: 29 }[set.tip];
            const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
            x.fillStyle = '#fff';
            if (set.tip === 'chalk') {
                for (let i = 0; i < n * n * 0.5; i += 1) { const a = rnd() * Math.PI * 2; const d = Math.sqrt(rnd()) * r; if (rnd() < 0.7) x.fillRect(r + Math.cos(a) * d, r + Math.sin(a) * d, 1, 1); }
            } else if (set.tip === 'spatter') {
                for (let i = 0; i < 18; i += 1) { const a = rnd() * Math.PI * 2; const d = rnd() * r * 0.8; x.beginPath(); x.arc(r + Math.cos(a) * d, r + Math.sin(a) * d, Math.max(0.5, rnd() * r * 0.22), 0, Math.PI * 2); x.fill(); }
            } else {
                for (let i = 0; i < Math.max(6, n / 2); i += 1) { const bx = rnd() * n; x.globalAlpha = 0.4 + rnd() * 0.6; x.fillRect(bx, r - r * 0.3 - rnd() * r * 0.3, Math.max(1, n / 30), r * 0.6 + rnd() * r * 0.6); }
            }
        } else {
            const hard = Math.max(0, Math.min(1, set.hardness / 100));
            if (hard >= 0.99) {
                x.fillStyle = '#fff';
                x.beginPath();
                x.arc(r, r, r, 0, Math.PI * 2);
                x.fill();
            } else {
                const g = x.createRadialGradient(r, r, r * hard, r, r, r);
                g.addColorStop(0, 'rgba(255,255,255,1)');
                g.addColorStop(1, 'rgba(255,255,255,0)');
                x.fillStyle = g;
                x.fillRect(0, 0, n, n);
            }
        }
        if (tipCache.size > 200) tipCache.clear();
        tipCache.set(key, c);
        return c;
    }

    /** The tip in a colour (cached per colour and shape). */
    function tinted(set, px, color) {
        const key = `t|${set.tip}|${set.hardness}|${Math.ceil(px)}|${color}`;
        if (tipCache.has(key)) return tipCache.get(key);
        const b = baseTip(set, px);
        const c = doc.createElement('canvas');
        c.width = b.width;
        c.height = b.height;
        const x = c.getContext('2d');
        x.drawImage(b, 0, 0);
        x.globalCompositeOperation = 'source-in';
        x.fillStyle = color;
        x.fillRect(0, 0, c.width, c.height);
        tipCache.set(key, c);
        return c;
    }

    function pressureOf(ev) {
        if (!ev) return 1;
        if (ev.pointerType === 'mouse' || ev.pointerType === undefined) return 1;
        const p = typeof ev.pressure === 'number' ? ev.pressure : 1;
        // a pen that reports nothing yet (0) on its first event
        return p > 0 ? p : 0.5;
    }

    function begin(w) { w.dabCarry = 0; w.dabSeed = 1; }

    /**
     * Dabs from a to b into the stroke buffer (w.sctx); pa / pb the pressure at each end. The
     * distance left over after the last dab carries to the next segment, so spacing stays even.
     */
    function stroke(w, a, b, pa, pb, color, sizePx) {
        const set = settings(w);
        const ctx = w.sctx;
        const size = Math.max(1, sizePx);
        const spacing = Math.max(0.5, (size * Math.max(1, set.spacing)) / 100);
        const dx = b.x - a.x;
        const dy = b.y - a.y;
        const len = Math.hypot(dx, dy);
        let dist = w.dabCarry === undefined ? 0 : spacing - w.dabCarry;
        if (len === 0 && w.dabCarry === 0) dist = 0;
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        const nx = len ? -dy / len : 0;
        const ny = len ? dx / len : 1;
        let s = w.dabSeed || 1;
        const rnd = () => { s = (s * 16807) % 2147483647; return s / 2147483647; };
        let placed = 0;
        while (dist <= len + 1e-6) {
            const t = len ? dist / len : 0;
            const pr = pa + (pb - pa) * t;
            let ds = size * (set.pressureSize ? Math.max(0.05, pr) : 1);
            if (set.sizeJitter) ds *= 1 - (set.sizeJitter / 100) * rnd();
            const scatter = set.scatter ? (rnd() * 2 - 1) * (set.scatter / 100) * size * 2 : 0;
            const px = a.x + dx * t + nx * scatter;
            const py = a.y + dy * t + ny * scatter;
            const flow = (set.flow / 100) * (set.pressureFlow ? pr : 1);
            const ang = ((set.angle + (set.angleJitter ? (rnd() * 2 - 1) * 180 * (set.angleJitter / 100) : 0)) * Math.PI) / 180;
            const tip = tinted(set, ds, color);
            const rw = ds;
            const rh = ds * Math.max(0.05, set.roundness / 100);
            ctx.save();
            ctx.globalAlpha = Math.max(0, Math.min(1, flow));
            ctx.translate(px, py);
            if (ang) ctx.rotate(ang);
            ctx.drawImage(tip, -rw / 2, -rh / 2, rw, rh);
            ctx.restore();
            const ext = ds / 2 + 2;
            x0 = Math.min(x0, px - ext); y0 = Math.min(y0, py - ext); x1 = Math.max(x1, px + ext); y1 = Math.max(y1, py + ext);
            placed += 1;
            dist += spacing;
            if (!len) break;
        }
        w.dabSeed = s;
        w.dabCarry = len ? len - (dist - spacing) : 0;
        if (!placed) return null;
        return { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
    }

    // ---- presets UI: the options bar's picker and the Brushes window --------------------------------

    function thumb(preset, wpx = 92, hpx = 26) {
        // a stroke drawn with the preset: an S curve, pressure rising then falling
        const c = doc.createElement('canvas');
        c.width = wpx;
        c.height = hpx;
        const fake = { brushSet: { ...BASE, ...preset }, opt: { hardness: preset.hardness }, sctx: c.getContext('2d') };
        begin(fake);
        const pts = [];
        for (let i = 0; i <= 24; i += 1) { const t = i / 24; pts.push({ x: 6 + t * (wpx - 12), y: hpx / 2 + Math.sin(t * Math.PI * 2) * (hpx / 2 - 7), p: Math.sin(t * Math.PI) * 0.9 + 0.1 }); }
        for (let i = 1; i < pts.length; i += 1) stroke(fake, pts[i - 1], pts[i], pts[i - 1].p, pts[i].p, '#222', Math.min(12, hpx - 8));
        return c.toDataURL();
    }

    function presetRows(w) {
        const cur = settings(w);
        return allPresets().map((p) => `<div class="mp-br-row${cur.id === p.id ? ' is-on' : ''}" data-id="${p.id}" title="${p.name}"><img src="${thumb(p)}" alt=""><span>${p.name}</span>${p.user ? '<button type="button" class="mp-br-del" title="Delete this preset">×</button>' : ''}</div>`).join('');
    }

    /** The options bar's brush button: the current brush's stroke; its list holds every preset. */
    function picker(w, el) {
        const cur = settings(w);
        el.innerHTML = `<button type="button" class="mp-fp-button mp-br-button" title="Brush Preset picker"><img src="${thumb(cur, 54, 18)}" alt=""><span class="mp-fp-arrow"></span></button>`;
        const b = el.querySelector('button');
        b.addEventListener('click', () => {
            const old = doc.querySelector('.mp-br-popup');
            if (old) { old.remove(); return; }
            const r = b.getBoundingClientRect();
            const p = doc.createElement('div');
            p.className = 'mp-fp-popup mp-br-popup';
            p.style.left = `${Math.round(r.left)}px`;
            p.style.top = `${Math.round(r.bottom)}px`;
            p.innerHTML = presetRows(w);
            doc.body.appendChild(p);
            const off = (ev) => { if (!p.contains(ev.target) && !b.contains(ev.target)) { p.remove(); doc.removeEventListener('pointerdown', off, true); } };
            setTimeout(() => doc.addEventListener('pointerdown', off, true), 0);
            p.addEventListener('click', (ev) => {
                const row = ev.target.closest('.mp-br-row');
                if (!row) return;
                if (ev.target.closest('.mp-br-del')) { deletePreset(w, row.dataset.id); p.innerHTML = presetRows(w); return; }
                const pr = allPresets().find((x) => x.id === row.dataset.id);
                if (pr) choose(w, pr);
                p.remove();
            });
        });
    }

    function deletePreset(w, id) {
        saveUserPresets(userPresets().filter((p) => p.id !== id));
        refreshPanel(w);
    }

    function dock(w) { return w.modal.querySelector('.mp-dock'); }
    function panelOpen(w) { return !!dock(w).querySelector('.mp-brushes'); }

    function togglePanel(w) {
        const d = dock(w);
        const cur = d.querySelector('.mp-brushes');
        if (cur) { cur.remove(); w.modal.classList.toggle('mp-has-dock', !!d.children.length); return; }
        d.insertAdjacentHTML('afterbegin', '<div class="mp-panel mp-brushes"><div class="mp-panel-cap">Brushes</div><div class="mp-br-body"></div></div>');
        w.modal.classList.add('mp-has-dock');
        refreshPanel(w);
    }

    const FIELDS = [
        ['spacing', 'Spacing', 1, 200, '%'], ['angle', 'Angle', -180, 180, '°'], ['roundness', 'Roundness', 5, 100, '%'],
        ['scatter', 'Scatter', 0, 200, '%'], ['sizeJitter', 'Size Jitter', 0, 100, '%'], ['angleJitter', 'Angle Jitter', 0, 100, '%'], ['flow', 'Flow', 1, 100, '%']
    ];

    function refreshPanel(w) {
        const host = dock(w) && dock(w).querySelector('.mp-brushes .mp-br-body');
        if (!host) return;
        const set = settings(w);
        host.innerHTML = `<div class="mp-br-list">${presetRows(w)}</div>
            <div class="mp-br-preview"><img src="${thumb(set, 170, 34)}" alt=""></div>
            <div class="mp-br-fields">
                ${FIELDS.map(([k, label, min, max, unit]) => `<label><span>${label}</span><input type="range" min="${min}" max="${max}" data-k="${k}" value="${set[k]}"><b>${set[k]}${unit}</b></label>`).join('')}
                <label class="mp-br-check"><input type="checkbox" data-c="pressureSize"${set.pressureSize ? ' checked' : ''}><span>Pen pressure: size</span></label>
                <label class="mp-br-check"><input type="checkbox" data-c="pressureFlow"${set.pressureFlow ? ' checked' : ''}><span>Pen pressure: flow</span></label>
            </div>
            <div class="mp-br-bar"><button type="button" class="mp-br-new" title="Save these settings as a new brush preset">New Preset...</button><button type="button" class="mp-br-define" title="Edit > Define Brush Preset: the selection's dark parts become the tip">Define...</button></div>`;
        host.querySelector('.mp-br-list').addEventListener('click', (ev) => {
            const row = ev.target.closest('.mp-br-row');
            if (!row) return;
            if (ev.target.closest('.mp-br-del')) { deletePreset(w, row.dataset.id); return; }
            const pr = allPresets().find((x) => x.id === row.dataset.id);
            if (pr) choose(w, pr);
        });
        host.querySelectorAll('input[type=range]').forEach((i) => i.addEventListener('input', () => {
            set[i.dataset.k] = Number(i.value);
            const f = FIELDS.find((x) => x[0] === i.dataset.k);
            i.nextElementSibling.textContent = `${i.value}${f[4]}`;
            host.querySelector('.mp-br-preview img').src = thumb(set, 170, 34);
            set.id = null;
            remember(w);
        }));
        host.querySelectorAll('input[type=checkbox]').forEach((i) => i.addEventListener('change', () => { set[i.dataset.c] = i.checked; set.id = null; remember(w); }));
        host.querySelector('.mp-br-new').addEventListener('click', () => savePreset(w, { ...set }));
        host.querySelector('.mp-br-define').addEventListener('click', () => definePreset(w));
    }

    /** Photoshop's Brush Name dialog: the tip's stroke, then its name. */
    function askName(w, def, preset) {
        const V = root.vistaDialogTemplate;
        if (!V) return Promise.resolve(def);
        const tpl = { t: 'Brush Name', w: 230, h: 46, f: ['MS Shell Dlg', 8], c: [
            [104, 'S', 7, 7, 58, 18, 0x5000000e, '', 0],
            [-1, 'S', 72, 9, 24, 8, 0x50020000, '&Name:', 0],
            [103, 'E', 98, 7, 72, 12, 0x50810080, def, 0],
            [1, 'B', 173, 7, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 173, 25, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        return new Promise((resolve) => {
            let done = false;
            const end = (v) => { if (!done) { done = true; resolve(v); } };
            V.openDialog({
                id: 'mpBrushName', tpl, owner: w.modal,
                init: (ctx) => {
                    const host = ctx.el ? ctx.el(104) : null;
                    if (host) host.innerHTML = `<img src="${thumb(preset, 88, 26)}" alt="" style="display:block;border:1px solid #a0a0a0;background:#fff">`;
                },
                ok: (ctx) => end(String(ctx.get(103) || '').trim()),
                cancel: () => end(''),
                close: () => end('')
            });
        });
    }

    async function savePreset(w, preset) {
        const name = await askName(w, preset.name && preset.id ? `${preset.name} copy` : (preset.name || `Brush ${userPresets().length + 1}`), preset);
        if (!name) return;
        const list = userPresets();
        const id = `u${Date.now().toString(36)}`;
        const p = { ...preset, id, name, user: true };
        list.push(p);
        saveUserPresets(list);
        choose(w, p);
    }

    /** Edit > Define Brush Preset: the selection (or the layer's pixels), its dark parts the paint. */
    async function definePreset(w) {
        const d = w.doc;
        const s = d.selection;
        const src = s ? w.selectionCanvas(false) : (() => {
            const b = w.layerBounds(d.layer);
            if (!b) return null;
            const c = C().makeCanvas(b.w, b.h);
            c.getContext('2d').drawImage(d.layer.canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
            return c;
        })();
        if (!src) { w.status('Select the part of the picture to make a brush from.'); return; }
        // a square tip up to 256 px, the shape centred
        const n = Math.min(256, Math.max(src.width, src.height));
        const k = n / Math.max(src.width, src.height);
        const c = C().makeCanvas(n, n);
        const x = c.getContext('2d', { willReadFrequently: true });
        x.drawImage(src, (n - src.width * k) / 2, (n - src.height * k) / 2, src.width * k, src.height * k);
        const img = x.getImageData(0, 0, n, n);
        for (let i = 0; i < img.data.length; i += 4) {
            const l = 0.299 * img.data[i] + 0.587 * img.data[i + 1] + 0.114 * img.data[i + 2];
            const a = ((255 - l) * img.data[i + 3]) / 255;
            img.data[i] = 255; img.data[i + 1] = 255; img.data[i + 2] = 255; img.data[i + 3] = a;
        }
        x.putImageData(img, 0, 0);
        const tipId = `tip${Date.now().toString(36)}`;
        customTips.set(tipId, c);
        tipCache.clear();
        await savePreset(w, { ...BASE, tip: tipId, tipData: c.toDataURL('image/png'), spacing: 25, size: Math.round(Math.max(src.width, src.height)), name: 'Sampled Brush' });
    }

    root.paintBrush = { settings, begin, stroke, pressureOf, picker, togglePanel, panelOpen, refreshPanel, definePreset, choose, PRESETS, allPresets, thumb };
})(typeof window !== 'undefined' ? window : globalThis);
