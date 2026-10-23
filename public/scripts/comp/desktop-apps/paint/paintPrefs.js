/**
 * Paint's Preferences and the last of the Photoshop odds and ends (Yozora #632):
 *
 *   Edit > Preferences (Ctrl+K)   the transparency checkerboard (size, colours), the document grid
 *                                 (spacing, subdivisions, colour), the guides' colour, the painting
 *                                 cursor (brush tip or precise), how many recent files to keep
 *   View > Show > Grid (Ctrl+Alt+') Photoshop's document grid over the picture; Snap takes to it
 *   File > Open Recent            the pictures opened or saved here last (the registry)
 *   Color Sampler tool (I)        up to four fixed points whose colours the Info window shows;
 *                                 Alt+click removes one, a drag moves it
 *   Image > Canvas Size...        new size or Relative, the 3 x 3 anchor, the colour of new ground
 *
 *   paintPrefs.prefs() / apply(w) / svg(w, z) / snap(w, p, xs, ys) / remember(w) / action(w, a)
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

    const DEFAULTS = { checker: 8, checkerColors: 'light', gridEvery: 64, gridSub: 4, gridColor: '#8080ff', guideColor: '#00e5ff', cursor: 'tip', recentMax: 10 };
    const CHECKER = { light: ['#ffffff', '#cccccc'], medium: ['#999999', '#666666'], dark: ['#666666', '#333333'], red: ['#ffffff', '#ffcccc'], blue: ['#ffffff', '#ccddff'] };

    function prefs() {
        let p = {};
        try { p = JSON.parse(reg('Preferences', '{}') || '{}'); } catch (_) { p = {}; }
        return { ...DEFAULTS, ...p };
    }

    /** The checkerboard pattern for a window (paintApp's makeChecker). */
    function checker(w) {
        const p = prefs();
        const n = Math.max(0, Number(p.checker) || 0);
        const c = C().makeCanvas(Math.max(2, n * 2), Math.max(2, n * 2));
        const x = c.getContext('2d');
        const [a, b] = CHECKER[p.checkerColors] || CHECKER.light;
        x.fillStyle = a; x.fillRect(0, 0, c.width, c.height);
        if (n) { x.fillStyle = b; x.fillRect(0, 0, n, n); x.fillRect(n, n, n, n); }
        return w.vctx.createPattern(c, 'repeat');
    }

    function apply(w) {
        const p = prefs();
        w.checker = checker(w);
        w.modal.style.setProperty('--mp-guide-color', p.guideColor);
        w.modal.classList.toggle('mp-precise-cursor', p.cursor === 'precise');
        w.doc.markDirty();
        w.drawAnts();
    }

    // ---- the document grid --------------------------------------------------------------------

    function svg(w, z) {
        let html = '';
        // the preferences that are only looks follow every redraw (another window may have set them)
        const pp = prefs();
        w.modal.style.setProperty('--mp-guide-color', pp.guideColor);
        w.modal.classList.toggle('mp-precise-cursor', pp.cursor === 'precise');
        if (w.docGrid) {
            const p = prefs();
            const step = Math.max(2, Number(p.gridEvery) || 64);
            const sub = Math.max(1, Number(p.gridSub) || 1);
            const W = w.doc.width;
            const H = w.doc.height;
            let major = '';
            let minor = '';
            const s = step / sub;
            for (let i = 1; i * s < W; i += 1) { const x = Math.round(i * s * z) + 0.5; if (i % sub) minor += `M${x},0V${H * z}`; else major += `M${x},0V${H * z}`; }
            for (let i = 1; i * s < H; i += 1) { const y = Math.round(i * s * z) + 0.5; if (i % sub) minor += `M0,${y}H${W * z}`; else major += `M0,${y}H${W * z}`; }
            if (s * z >= 4 && minor) html += `<path class="mp-docgrid is-minor" style="stroke:${esc(p.gridColor)}" d="${minor}"/>`;
            if (major) html += `<path class="mp-docgrid" style="stroke:${esc(p.gridColor)}" d="${major}"/>`;
        }
        (w.samplers || []).forEach((q, i) => {
            const x = q.x * z; const y = q.y * z;
            html += `<g class="mp-sampler"><circle cx="${x}" cy="${y}" r="5"/><path d="M${x - 8},${y}H${x - 3}M${x + 3},${y}H${x + 8}M${x},${y - 8}V${y - 3}M${x},${y + 3}V${y + 8}"/><text x="${x + 7}" y="${y + 15}">${i + 1}</text></g>`;
        });
        return html;
    }

    /** Snap's grid lines near p (paintApp's snapPoint adds them to the guides). */
    function snap(w, p, xs, ys) {
        if (!w.docGrid) return;
        const pr = prefs();
        const s = Math.max(1, (Number(pr.gridEvery) || 64) / Math.max(1, Number(pr.gridSub) || 1));
        xs.push(Math.round(p.x / s) * s);
        ys.push(Math.round(p.y / s) * s);
    }

    // ---- recent files ---------------------------------------------------------------------------

    function recent() {
        try { const v = JSON.parse(reg('RecentFiles', '[]') || '[]'); return Array.isArray(v) ? v : []; } catch (_) { return []; }
    }

    /** After an open or a save: this file goes to the top of File > Open Recent. */
    function remember(w) {
        const f = w.file;
        if (!f || !f.id) return;
        const max = Math.max(0, Math.min(30, Number(prefs().recentMax) || 0));
        const list = recent().filter((x) => x.id !== f.id);
        list.unshift({ id: f.id, name: f.name, path: f.path || '/' });
        setReg({ RecentFiles: JSON.stringify(list.slice(0, max)) });
    }

    function recentMenu() {
        const list = recent();
        if (!list.length) return [{ text: '(none)', disabled: true }];
        return list.map((f, i) => ({ text: `${i + 1} ${f.name}`, action: `recent-${i}` }))
            .concat([{ separator: true }, { text: 'Clear Recent File List', action: 'recent-clear' }]);
    }

    async function openRecent(w, i) {
        const f = recent()[i];
        if (!f) return;
        if (!await w.confirmDiscard()) return;
        await w.openVfsFile(f.id, f.name, f.path);
    }

    // ---- the Color Sampler --------------------------------------------------------------------

    const T = {
        sampler: {
            down(p, ev) {
                const list = this.samplers || (this.samplers = []);
                const tol = 8 / this.zoom;
                const at = list.findIndex((q) => Math.abs(q.x - p.x) <= tol && Math.abs(q.y - p.y) <= tol);
                if (at >= 0 && ev && ev.altKey) { list.splice(at, 1); refreshSamplers(this); this.drawAnts(); return; }
                if (at >= 0) { this.samplerDrag = at; return; }
                if (list.length >= 4) { this.status('Four color samplers at most: Alt+click one to remove it.'); return; }
                list.push({ x: Math.floor(p.x) + 0.5, y: Math.floor(p.y) + 0.5 });
                this.samplerDrag = list.length - 1;
                if (root.paintPro && !root.paintPro.infoOpen(this)) root.paintPro.toggleInfo(this);
                refreshSamplers(this);
                this.drawAnts();
            },
            move(p, ev, down) {
                if (!down || this.samplerDrag === undefined || this.samplerDrag === null) return;
                const q = this.samplers[this.samplerDrag];
                q.x = Math.max(0, Math.min(this.doc.width - 1, Math.floor(p.x))) + 0.5;
                q.y = Math.max(0, Math.min(this.doc.height - 1, Math.floor(p.y))) + 0.5;
                refreshSamplers(this);
                this.drawAnts();
            },
            up() { this.samplerDrag = null; }
        }
    };

    /** The samplers' colours in the Info window (each as the picture shows it). */
    function refreshSamplers(w) {
        const panel = w.modal.querySelector('.mp-info');
        if (!panel) return;
        let box = panel.querySelector('.mp-info-samplers');
        const list = w.samplers || [];
        if (!list.length) { if (box) box.remove(); return; }
        if (!box) { box = doc.createElement('div'); box.className = 'mp-info-samplers'; panel.appendChild(box); }
        box.innerHTML = list.map((q, i) => {
            const x = Math.floor(q.x); const y = Math.floor(q.y);
            const v = w.vctx.getImageData(x, y, 1, 1).data;
            return `<div><b>#${i + 1}</b><span class="mp-info-sw" style="background:rgb(${v[0]},${v[1]},${v[2]})"></span>R ${v[0]} G ${v[1]} B ${v[2]}</div>`;
        }).join('');
    }

    let tickTimer = 0;
    /** After the picture changes (paintApp's schedule): the samplers read again, now and then. */
    function tick(w) {
        if (!w.samplers || !w.samplers.length) return;
        clearTimeout(tickTimer);
        tickTimer = setTimeout(() => refreshSamplers(w), 120);
    }

    // ---- Canvas Size --------------------------------------------------------------------------

    const ANCHORS = [[0, 0], [0.5, 0], [1, 0], [0, 0.5], [0.5, 0.5], [1, 0.5], [0, 1], [0.5, 1], [1, 1]];

    function canvasSize(w) {
        const V = root.vistaDialogTemplate;
        if (!V) return;
        const d = w.doc;
        const st = { anchor: 4 };
        const tpl = { t: 'Canvas Size', w: 250, h: 182, f: ['MS Shell Dlg', 8], c: [
            [-1, 'B', 7, 4, 180, 30, 0x50000007, 'Current Size', 0],
            [100, 'S', 14, 17, 166, 8, 0x50020000, '', 0],
            [-1, 'B', 7, 38, 180, 104, 0x50000007, 'New Size', 0],
            [-1, 'S', 14, 52, 30, 8, 0x50020000, '&Width:', 0], [101, 'E', 50, 50, 50, 12, 0x50812080, '', 0], [-1, 'S', 104, 52, 24, 8, 0x50020000, 'pixels', 0],
            [-1, 'S', 14, 68, 30, 8, 0x50020000, '&Height:', 0], [102, 'E', 50, 66, 50, 12, 0x50812080, '', 0], [-1, 'S', 104, 68, 24, 8, 0x50020000, 'pixels', 0],
            [103, 'B', 50, 82, 60, 10, 0x50010003, '&Relative', 0],
            [-1, 'S', 14, 100, 30, 8, 0x50020000, 'Anchor:', 0],
            [104, 'S', 50, 96, 42, 42, 0x5000000e, '', 0],
            [-1, 'S', 7, 150, 90, 8, 0x50020000, 'Canvas &extension color:', 0],
            [105, 'C', 98, 148, 89, 100, 0x50210003, '', 0],
            [1, 'B', 193, 7, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 193, 25, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        V.openDialog({
            id: 'mpCanvasSize', tpl, owner: w.modal,
            init: (ctx) => {
                ctx.text(100, `Width: ${d.width} pixels    Height: ${d.height} pixels`);
                ctx.set(101, String(d.width));
                ctx.set(102, String(d.height));
                const sel = ctx.el(105);
                if (sel) {
                    sel.innerHTML = [['bg', 'Background'], ['fg', 'Foreground'], ['white', 'White'], ['black', 'Black'], ['gray', 'Gray'], ['none', 'Transparent']].map(([v, t]) => `<option value="${v}">${t}</option>`).join('');
                    sel.value = d.layers.some((l) => l.isBackground) ? 'bg' : 'none';
                }
                const host = ctx.el(104);
                const draw = () => {
                    if (!host) return;
                    // Photoshop's arrows point away from the anchor
                    const [ax, ay] = ANCHORS[st.anchor];
                    host.innerHTML = `<div class="mp-anchor">${ANCHORS.map(([x, y], i) => {
                        const dx = Math.sign(x - ax); const dy = Math.sign(y - ay);
                        const arrow = i === st.anchor ? 'is-dot' : Math.abs(x - ax) <= 0.5 && Math.abs(y - ay) <= 0.5 ? `is-arrow` : '';
                        return `<button type="button" data-a="${i}" class="${arrow}"><i style="--r:${Math.atan2(dy, dx)}rad"></i></button>`;
                    }).join('')}</div>`;
                };
                draw();
                if (host) host.addEventListener('click', (ev) => { const b = ev.target.closest('[data-a]'); if (b) { st.anchor = Number(b.dataset.a); draw(); } });
                const rel = ctx.el(103);
                if (rel) rel.addEventListener('change', () => {
                    const on = !!ctx.get(103);
                    ctx.set(101, String(on ? 0 : d.width));
                    ctx.set(102, String(on ? 0 : d.height));
                });
            },
            ok: async (ctx) => {
                const rel = !!ctx.get(103);
                const nw = Math.round(Number(ctx.get(101)) || 0) + (rel ? d.width : 0);
                const nh = Math.round(Number(ctx.get(102)) || 0) + (rel ? d.height : 0);
                if (nw < 1 || nh < 1 || nw > 16384 || nh > 16384) { await w.message('Please enter a size between 1 and 16384 pixels.'); return false; }
                if (nw === d.width && nh === d.height) return true;
                const c = String(ctx.get(105) || 'bg');
                const fill = { bg: w.bg, fg: w.fg, white: '#ffffff', black: '#000000', gray: '#808080', none: null }[c];
                const [ax, ay] = ANCHORS[st.anchor];
                d.resizeCanvas(nw, nh, { label: 'Canvas Size', anchorX: ax, anchorY: ay, fill });
                return true;
            }
        });
    }

    // ---- Preferences ---------------------------------------------------------------------------

    function preferences(w) {
        const V = root.vistaDialogTemplate;
        if (!V) return;
        const p = prefs();
        const tpl = { t: 'Preferences', w: 260, h: 196, f: ['MS Shell Dlg', 8], c: [
            [-1, 'B', 7, 4, 190, 44, 0x50000007, 'Transparency', 0],
            [-1, 'S', 14, 18, 56, 8, 0x50020000, '&Grid Size:', 0], [101, 'C', 74, 16, 116, 100, 0x50210003, '', 0],
            [-1, 'S', 14, 33, 56, 8, 0x50020000, 'Grid &Colors:', 0], [102, 'C', 74, 31, 116, 100, 0x50210003, '', 0],
            [-1, 'B', 7, 52, 190, 60, 0x50000007, 'Grid and Guides', 0],
            [-1, 'S', 14, 66, 70, 8, 0x50020000, 'Gridline &every:', 0], [103, 'E', 88, 64, 40, 12, 0x50812080, '', 0], [-1, 'S', 132, 66, 24, 8, 0x50020000, 'pixels', 0],
            [-1, 'S', 14, 81, 70, 8, 0x50020000, '&Subdivisions:', 0], [104, 'E', 88, 79, 40, 12, 0x50812080, '', 0],
            [-1, 'S', 14, 96, 70, 8, 0x50020000, 'Grid / Guide colo&r:', 0], [105, 'E', 88, 94, 46, 12, 0x50810080, '', 0], [106, 'E', 138, 94, 46, 12, 0x50810080, '', 0],
            [-1, 'B', 7, 116, 190, 30, 0x50000007, 'Painting Cursors', 0],
            [107, 'B', 14, 129, 80, 10, 0x50030009, '&Brush tip', 0], [108, 'B', 100, 129, 80, 10, 0x50010009, '&Precise', 0],
            [-1, 'S', 7, 156, 120, 8, 0x50020000, 'Recent file list &contains:', 0], [109, 'E', 128, 154, 30, 12, 0x50812080, '', 0], [-1, 'S', 162, 156, 30, 8, 0x50020000, 'files', 0],
            [-1, 'S', 7, 172, 190, 16, 0x50020000, 'The colours are #rrggbb.', 0],
            [1, 'B', 203, 7, 50, 14, 0x50010001, 'OK', 0],
            [2, 'B', 203, 25, 50, 14, 0x50010000, 'Cancel', 0]
        ] };
        V.openDialog({
            id: 'mpPreferences', tpl, owner: w.modal,
            init: (ctx) => {
                const s1 = ctx.el(101);
                if (s1) { s1.innerHTML = [[0, 'None'], [4, 'Small'], [8, 'Medium'], [16, 'Large']].map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); s1.value = String(p.checker); }
                const s2 = ctx.el(102);
                if (s2) { s2.innerHTML = [['light', 'Light'], ['medium', 'Medium'], ['dark', 'Dark'], ['red', 'Red'], ['blue', 'Blue']].map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); s2.value = p.checkerColors; }
                ctx.set(103, String(p.gridEvery)); ctx.set(104, String(p.gridSub));
                ctx.set(105, p.gridColor); ctx.set(106, p.guideColor);
                ctx.set(p.cursor === 'precise' ? 108 : 107, true);
                ctx.set(109, String(p.recentMax));
            },
            ok: (ctx) => {
                const hex = (v, d) => (/^#[0-9a-f]{6}$/i.test(String(v).trim()) ? String(v).trim() : d);
                const next = {
                    checker: Number(ctx.get(101)) || 0, checkerColors: String(ctx.get(102) || 'light'),
                    gridEvery: Math.max(2, Math.min(4096, Math.round(Number(ctx.get(103)) || 64))), gridSub: Math.max(1, Math.min(64, Math.round(Number(ctx.get(104)) || 1))),
                    gridColor: hex(ctx.get(105), p.gridColor), guideColor: hex(ctx.get(106), p.guideColor),
                    cursor: ctx.get(108) ? 'precise' : 'tip', recentMax: Math.max(0, Math.min(30, Math.round(Number(ctx.get(109)) || 0)))
                };
                setReg({ Preferences: JSON.stringify(next) });
                if (root.melatonPaint) root.melatonPaint.instances.forEach((x) => { try { apply(x); } catch (_) { /* a closed window */ } });
                else apply(w);
                return true;
            }
        });
    }

    function action(w, a) {
        if (/^recent-\d+$/.test(a)) { void openRecent(w, Number(a.slice(7))); return true; }
        switch (a) {
            case 'preferences': preferences(w); return true;
            case 'doc-grid': w.docGrid = !w.docGrid; w.drawAnts(); return true;
            case 'canvas-size': canvasSize(w); return true;
            case 'recent-clear': setReg({ RecentFiles: '[]' }); return true;
            case 'samplers-clear': w.samplers = []; refreshSamplers(w); w.drawAnts(); return true;
            default: return false;
        }
    }

    if (root.PaintWindow) {
        Object.assign(root.PaintWindow.prototype.tools, T);
        // File > Open Recent learns from every open and save
        const proto = root.PaintWindow.prototype;
        ['openVfsFile', 'save', 'saveAs'].forEach((name) => {
            const orig = proto[name];
            if (typeof orig !== 'function' || orig.paintPrefsWrapped) return;
            const wrapped = async function (...args) {
                const r = await orig.apply(this, args);
                try { remember(this); } catch (_) { /* the list stays as it was */ }
                return r;
            };
            wrapped.paintPrefsWrapped = true;
            proto[name] = wrapped;
        });
    }

    root.paintPrefs = { prefs, checker, apply, svg, snap, remember, recent, recentMenu, refreshSamplers, tick, canvasSize, preferences, action, T, DEFAULTS };
})(typeof window !== 'undefined' ? window : globalThis);
