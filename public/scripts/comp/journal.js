/**
 * Melaton Journal (Yozora #785): the notebook window (notepadManager.js notebook*) as Vista's
 * Journal.exe, 1:1 from the Vista VM (captures and resources in ~/.cache/vista-vm/journal).
 *
 *   menus     File, Edit, View, Insert, Actions, Tools, Help: Journal.exe.mui menu 104, items and
 *             accelerators as they are (what Dreamscape notes cannot do is greyed)
 *   toolbars  the rebar's Standard band (toolbar 112: New Note, View Recent Notes, Save, Import,
 *             Find | Cut, Copy, Paste | Undo, Redo | Zoom) and Pen band (toolbar 117: Pen,
 *             Highlighter, Eraser, Selection Tool, Insert/Remove Space, Flag); art = Journal.exe
 *             bitmaps 136 / 139 (Standard) and 24226 / 173 (Pen), 24 px
 *   page      Page Width: the page fills the view; every page length is the VM's pixel at its
 *             1403-px page times --jnl-s (rules every 23.5 px in #99CCFF from 87 px, the margin
 *             at 53 px in #BE6482, the Note Title box 8 px in, 70 px tall, dashed at 51 px)
 *   ink       the note's strokes (notes.ink: { v, w, h, strokes: [{ tool, color, width, pts }] })
 *             in page units (850 across a Letter page, 1/100 in; the phone's Notes writes the
 *             same units), drawn on a canvas over the page; Pen presets (Fine Chisel, Fine
 *             Point, Very Fine Point, Medium Point, Marker (2 mm)), Highlighter presets, point
 *             erasers (Small / Medium / Large) and the stroke eraser, the lasso Selection Tool
 *             (move, delete, cut / copy / paste), Insert/Remove Space, flags
 *   text      the note's typing (notes.content) on the rules from the margin; typing while the
 *             pen is out switches to it (Insert > Text Box does too)
 *   voice     the note's recordings (metadata.audio) as speakers on the page; Insert > Voice
 *             Recording... opens Sound Recorder (soundRecorder.js) and attaches what it records
 *
 * window.journalUI.attach(manager) wires the notebook window; the manager calls
 * load(note) / reset() / inkJson() / dirty().
 */
(function (root) {
    'use strict';

    const doc = document;
    const ART = '/static_images/vista-journal/';
    const VM_PAGE_W = 1403; // the VM's page at Page Width (px)
    const VM_PAGE_H = 1815; // a Letter page at that width
    const UNITS_W = 850; // stroke units across the page
    const RULE = 23.5;
    const FIRST_RULE = 87;
    const MARGIN = 53;

    const PENS = [
        { name: 'Fine Chisel', color: '#000000', width: 2.5 },
        { name: 'Fine Point', color: '#0000ff', width: 2 },
        { name: 'Very Fine Point', color: '#000000', width: 1 },
        { name: 'Medium Point', color: '#ff0000', width: 3.5 },
        { name: 'Marker (2 mm)', color: '#000000', width: 8 }
    ];
    const HIGHLIGHTERS = [
        { name: 'Medium', color: '#ffff00', width: 12 },
        { name: 'Medium', color: '#00ff00', width: 12 },
        { name: 'Medium', color: '#00ffff', width: 12 },
        { name: 'Thick', color: '#ff00ff', width: 18 },
        { name: 'Extra Thick', color: '#ff9900', width: 26 }
    ];
    const ERASERS = [['small', 'Small', 3], ['medium', 'Medium', 8], ['large', 'Large', 16], ['stroke', 'Stroke', 3]];
    const FLAGS = [['red', 'Red', 'flag-red'], ['blue', 'Blue', 'flag-blue'], ['green', 'Green', 'flag-green'], ['orange', 'Orange', 'flag-orange'], ['purple', 'Purple', 'flag-purple']];
    const ZOOMS = [['width', 'Page Width'], ['whole', 'Whole Page'], [2, '200%'], [1.5, '150%'], [1.3, '130%'], [1.15, '115%'], [1, '100%'], [0.85, '85%'], [0.75, '75%'], [0.5, '50%'], [0.15, '15%']];

    const esc = (v) => String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const clone = (v) => JSON.parse(JSON.stringify(v));
    const flagImgs = {};
    function flagImg(color) {
        if (!flagImgs[color]) {
            const im = new Image();
            im.src = `${ART}${(FLAGS.find((f) => f[0] === color) || FLAGS[0])[2]}.png`;
            im.onload = () => { if (ui) ui.paint(); };
            flagImgs[color] = im;
        }
        return flagImgs[color];
    }

    function reg(name, def) {
        const r = root.melatonRegistry;
        return r ? r.get('HKCU\\Software\\Xyridian\\Journal', name, def) : def;
    }

    function setReg(values) {
        const r = root.melatonRegistry;
        if (r) void r.set('HKCU\\Software\\Xyridian\\Journal', values);
    }

    // ---------------------------------------------------------------- geometry helpers

    function segDist(p, a, b) {
        const dx = b[0] - a[0];
        const dy = b[1] - a[1];
        const l2 = dx * dx + dy * dy;
        let t = l2 ? ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / l2 : 0;
        t = Math.max(0, Math.min(1, t));
        return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy));
    }

    function hitStroke(st, p, r) {
        const pts = st.pts;
        if (st.tool === 'picture') return p[0] >= pts[0][0] - r && p[0] <= pts[0][0] + st.w + r && p[1] >= pts[0][1] - r && p[1] <= pts[0][1] + st.h + r;
        if (st.tool === 'flag') return Math.abs(p[0] - pts[0][0] - 7) < 9 + r && Math.abs(p[1] - pts[0][1] - 7) < 9 + r;
        const reach = r + (Number(st.width) || 1) / 2;
        if (pts.length === 1) return Math.hypot(p[0] - pts[0][0], p[1] - pts[0][1]) <= reach;
        for (let i = 1; i < pts.length; i++) if (segDist(p, pts[i - 1], pts[i]) <= reach) return true;
        return false;
    }

    function inPoly(p, poly) {
        let inside = false;
        for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
            const a = poly[i];
            const b = poly[j];
            if (((a[1] > p[1]) !== (b[1] > p[1])) && (p[0] < ((b[0] - a[0]) * (p[1] - a[1])) / (b[1] - a[1]) + a[0])) inside = !inside;
        }
        return inside;
    }

    function bounds(strokes) {
        let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
        strokes.forEach((st) => {
            if (st.tool === 'picture') {
                const [px, py] = st.pts[0];
                x0 = Math.min(x0, px); y0 = Math.min(y0, py); x1 = Math.max(x1, px + st.w); y1 = Math.max(y1, py + st.h);
                return;
            }
            const pad = st.tool === 'flag' ? 16 : (Number(st.width) || 1) / 2;
            st.pts.forEach((pt) => {
                x0 = Math.min(x0, pt[0] - (st.tool === 'flag' ? 0 : pad));
                y0 = Math.min(y0, pt[1] - (st.tool === 'flag' ? 0 : pad));
                x1 = Math.max(x1, pt[0] + pad);
                y1 = Math.max(y1, pt[1] + pad);
            });
        });
        return isFinite(x0) ? { x0, y0, x1, y1 } : null;
    }

    /** Point erasing: the parts of the strokes within r of the eraser go; a cut stroke splits. */
    function erasePoints(strokes, p, r) {
        let changed = false;
        const out = [];
        strokes.forEach((st) => {
            if (st.tool === 'picture') { out.push(st); return; }
            if (st.tool === 'flag') {
                if (hitStroke(st, p, r)) { changed = true; return; }
                out.push(st);
                return;
            }
            if (!hitStroke(st, p, r)) { out.push(st); return; }
            changed = true;
            let run = [];
            st.pts.forEach((pt) => {
                if (Math.hypot(pt[0] - p[0], pt[1] - p[1]) <= r + (Number(st.width) || 1) / 2) {
                    if (run.length > 1) out.push({ ...st, pts: run });
                    run = [];
                } else run.push(pt);
            });
            if (run.length > 1) out.push({ ...st, pts: run });
        });
        return changed ? out : null;
    }

    // ---- pictures (Insert > Picture...): a gallery image ({ kind: 'image', filename }) or a user
    // file ({ kind: 'file', id }), drawn under the ink at { pts: [[x, y]], w, h } in page units
    const pictures = new Map();
    function pictureKey(src) { return src ? `${src.kind}:${src.filename || src.id}` : ''; }
    function pictureImage(src) {
        const key = pictureKey(src);
        if (!key) return null;
        let rec = pictures.get(key);
        if (!rec) {
            rec = { img: new Image(), failed: false };
            pictures.set(key, rec);
            rec.img.onload = () => { if (ui) ui.paint(); };
            rec.img.onerror = () => { rec.failed = true; if (ui) ui.paint(); };
            const set = (url) => { if (url) rec.img.src = url; else rec.failed = true; };
            if (src.kind === 'image') {
                const url = typeof root.localGalleryImageUrl === 'function' ? root.localGalleryImageUrl(src.filename) : null;
                set(url || `/images/${encodeURIComponent(src.filename)}`);
            } else if (src.kind === 'file' && root.vfsClient) {
                root.vfsClient.downloadFile(src.id).then((r) => set(r && r.downloadUrl), () => set(null));
            } else set(null);
        }
        return rec;
    }

    function drawPicture(ctx, st) {
        const [x, y] = st.pts[0];
        const rec = pictureImage(st.src);
        if (rec && rec.img.complete && rec.img.naturalWidth) {
            ctx.drawImage(rec.img, x, y, st.w, st.h);
        } else {
            // loading (or gone): Journal's empty picture frame
            ctx.save();
            ctx.fillStyle = rec && rec.failed ? '#f4f4f4' : '#eef2f8';
            ctx.fillRect(x, y, st.w, st.h);
            ctx.strokeStyle = '#a0a0a0';
            ctx.lineWidth = 0.6;
            ctx.strokeRect(x, y, st.w, st.h);
            ctx.restore();
        }
    }

    function drawStroke(ctx, st) {
        const pts = st.pts;
        if (!pts || !pts.length) return;
        if (st.tool === 'picture') { drawPicture(ctx, st); return; }
        if (st.tool === 'flag') {
            const im = flagImg(st.color || 'red');
            if (im.complete && im.naturalWidth) ctx.drawImage(im, pts[0][0], pts[0][1], 14.5, 14.5);
            return;
        }
        ctx.save();
        if (st.tool === 'highlighter') {
            ctx.globalAlpha = 0.5;
            ctx.globalCompositeOperation = 'multiply';
            ctx.lineCap = 'square';
            ctx.lineJoin = 'miter';
        } else {
            ctx.lineCap = 'round';
            ctx.lineJoin = 'round';
        }
        ctx.strokeStyle = st.color || '#000';
        ctx.lineWidth = Number(st.width) || 1;
        ctx.beginPath();
        ctx.moveTo(pts[0][0], pts[0][1]);
        if (pts.length === 1) ctx.lineTo(pts[0][0] + 0.01, pts[0][1]);
        for (let i = 1; i < pts.length; i++) ctx.lineTo(pts[i][0], pts[i][1]);
        ctx.stroke();
        ctx.restore();
    }

    // ---------------------------------------------------------------- the window

    let ui = null;

    class JournalUI {
        constructor(mgr) {
            this.mgr = mgr;
            this.modal = mgr.notebookModal;
            this.view = this.modal.querySelector('.jnl-view');
            this.page = this.modal.querySelector('.jnl-page');
            this.canvas = this.modal.querySelector('.jnl-ink');
            this.text = mgr.notebookTextarea;
            this.titleInput = this.modal.querySelector('.jnl-title-input');
            this.dateEl = this.modal.querySelector('.jnl-title-date');
            this.clips = this.modal.querySelector('.jnl-clips');
            this.strokes = [];
            this.undoStack = [];
            this.redoStack = [];
            this.inkDirty = false;
            this.audio = [];
            this.tool = 'pen';
            this.pen = Math.min(PENS.length - 1, Number(reg('Pen', 0)) || 0);
            this.hl = Math.min(HIGHLIGHTERS.length - 1, Number(reg('Highlighter', 0)) || 0);
            this.eraser = ERASERS.some(([k]) => k === reg('Eraser', 'medium')) ? reg('Eraser', 'medium') : 'medium';
            this.flag = 'red';
            this.zoom = reg('Zoom', 'width');
            this.selection = new Set();
            this.clipboard = null;
            this.bars = { standard: reg('StandardBar', 1) !== 0, pen: reg('PenBar', 1) !== 0, pagebar: reg('PageBar', 1) !== 0 };
            this.bind();
            this.applyBars();
            this.renderButtons();
            this.layout();
        }

        // ---- units

        pagePx() { return this.page.clientWidth || VM_PAGE_W; }
        s() { return this.pagePx() / VM_PAGE_W; } // VM px -> page px
        k() { return this.pagePx() / UNITS_W; } // stroke unit -> page px

        point(e) {
            const r = this.page.getBoundingClientRect();
            const k = this.k();
            return [Math.round(((e.clientX - r.left) / k) * 10) / 10, Math.round(((e.clientY - r.top) / k) * 10) / 10];
        }

        // ---- layout: the zoom decides the page width; the page is as tall as a Letter page and
        // whatever runs past it (text, strokes), in whole pages

        layout() {
            const view = this.view;
            const avail = view.clientWidth;
            let w = avail;
            if (this.zoom === 'whole') w = Math.max(120, Math.min(avail - 16, (view.clientHeight - 16) * (VM_PAGE_W / VM_PAGE_H)));
            else if (typeof this.zoom === 'number' || /^[0-9.]+$/.test(String(this.zoom))) w = Math.round(816 * Number(this.zoom));
            this.view.classList.toggle('is-fit', this.zoom === 'width');
            this.page.style.width = `${Math.round(w)}px`;
            const s = w / VM_PAGE_W;
            this.page.style.setProperty('--jnl-s', String(s));
            const t = this.text;
            t.style.height = '0px';
            const textBottom = FIRST_RULE * s + t.scrollHeight;
            const b = bounds(this.strokes);
            const inkBottom = b ? b.y1 * this.k() : 0;
            const pageH = VM_PAGE_H * s;
            const need = Math.max(pageH, textBottom + RULE * 4 * s, inkBottom + RULE * 4 * s);
            const pages = Math.max(this.extraPages || 1, Math.ceil(need / pageH));
            this.pages = pages;
            this.page.style.height = `${Math.round(pages * pageH)}px`;
            t.style.height = `${Math.max(RULE * s, pages * pageH - FIRST_RULE * s)}px`;
            this.paint();
            this.pageBar();
        }

        pageBar() {
            const bar = this.modal.querySelector('.jnl-pagebar-text');
            if (!bar) return;
            const pageH = VM_PAGE_H * this.s();
            const at = Math.min(this.pages, Math.floor((this.view.scrollTop + this.view.clientHeight / 3) / pageH) + 1);
            bar.textContent = `${at} / ${this.pages}`;
            const prev = this.modal.querySelector('[data-jnl-page="prev"]');
            const next = this.modal.querySelector('[data-jnl-page="next"]');
            if (prev) prev.disabled = at <= 1;
            if (next) next.disabled = at >= this.pages;
        }

        paint(live) {
            const cv = this.canvas;
            const dpr = root.devicePixelRatio || 1;
            const w = this.page.clientWidth;
            const h = this.page.clientHeight;
            if (cv.width !== Math.round(w * dpr) || cv.height !== Math.round(h * dpr)) {
                cv.width = Math.round(w * dpr);
                cv.height = Math.round(h * dpr);
                cv.style.width = `${w}px`;
                cv.style.height = `${h}px`;
            }
            const ctx = cv.getContext('2d');
            ctx.setTransform(1, 0, 0, 1, 0, 0);
            ctx.clearRect(0, 0, cv.width, cv.height);
            const k = this.k();
            ctx.setTransform(dpr * k, 0, 0, dpr * k, 0, 0);
            // pictures under the ink
            this.strokes.forEach((st) => { if (st.tool === 'picture') drawPicture(ctx, st); });
            this.strokes.forEach((st, i) => {
                if (st.tool !== 'picture') drawStroke(ctx, st);
                if (this.selection.has(i) && st.tool === 'picture') {
                    const [px, py] = st.pts[0];
                    ctx.save();
                    ctx.strokeStyle = '#3399ff';
                    ctx.lineWidth = 1 / k;
                    ctx.strokeRect(px, py, st.w, st.h);
                    // the resize grip at the bottom right
                    ctx.fillStyle = '#fff';
                    ctx.fillRect(px + st.w - 4 / k, py + st.h - 4 / k, 8 / k, 8 / k);
                    ctx.strokeRect(px + st.w - 4 / k, py + st.h - 4 / k, 8 / k, 8 / k);
                    ctx.restore();
                } else if (this.selection.has(i) && st.tool !== 'flag') {
                    ctx.save();
                    ctx.globalAlpha = 0.35;
                    ctx.strokeStyle = '#3399ff';
                    ctx.lineWidth = (Number(st.width) || 1) + 3 / k;
                    ctx.lineCap = 'round';
                    ctx.beginPath();
                    st.pts.forEach((pt, n) => (n ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
                    ctx.stroke();
                    ctx.restore();
                }
            });
            if (live) {
                if (live.lasso) {
                    ctx.save();
                    ctx.setLineDash([3 / k, 3 / k]);
                    ctx.strokeStyle = '#000';
                    ctx.lineWidth = 1 / k;
                    ctx.beginPath();
                    live.lasso.forEach((pt, n) => (n ? ctx.lineTo(pt[0], pt[1]) : ctx.moveTo(pt[0], pt[1])));
                    ctx.stroke();
                    ctx.restore();
                } else if (live.spaceAt != null) {
                    ctx.save();
                    ctx.strokeStyle = '#3366cc';
                    ctx.lineWidth = 1 / k;
                    ctx.setLineDash([4 / k, 3 / k]);
                    ctx.beginPath();
                    ctx.moveTo(0, live.spaceAt);
                    ctx.lineTo(UNITS_W, live.spaceAt);
                    ctx.stroke();
                    ctx.restore();
                } else drawStroke(ctx, live);
            }
            const box = this.selectionBox();
            if (box) {
                ctx.save();
                ctx.setLineDash([3 / k, 3 / k]);
                ctx.strokeStyle = '#000';
                ctx.lineWidth = 1 / k;
                ctx.strokeRect(box.x0 - 3, box.y0 - 3, box.x1 - box.x0 + 6, box.y1 - box.y0 + 6);
                ctx.restore();
            }
        }

        selectionBox() {
            if (!this.selection.size) return null;
            return bounds(this.strokes.filter((_, i) => this.selection.has(i)));
        }

        // ---- the note

        load(note) {
            let ink = null;
            try { ink = note && note.ink ? (typeof note.ink === 'string' ? JSON.parse(note.ink) : note.ink) : null; } catch (_) { ink = null; }
            this.strokes = ink && Array.isArray(ink.strokes) ? ink.strokes : [];
            this.audio = note && note.metadata && Array.isArray(note.metadata.audio) ? note.metadata.audio : [];
            this.undoStack = [];
            this.redoStack = [];
            this.selection.clear();
            this.inkDirty = false;
            this.extraPages = 1;
            this.titleInput.value = note ? (note.name || '') : '';
            const at = note && (note.created_at || note.createdAt);
            const d = at ? new Date(Number(at) < 1e12 ? Number(at) * 1000 : Number(at)) : new Date();
            this.dateEl.textContent = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
            // a note of typing opens to type; a new page or a page of ink, to write
            this.setTool(note && (note.content || '').trim() && !this.strokes.length ? 'text' : 'pen', true);
            this.renderClips();
            this.view.scrollTop = 0;
            this.layout();
        }

        reset() { this.load(null); }

        dirty() { return this.inkDirty; }

        inkJson() {
            if (!this.strokes.length) return null;
            const b = bounds(this.strokes);
            return { v: 1, w: UNITS_W, h: Math.ceil(b ? b.y1 : 0), strokes: this.strokes };
        }

        saved() { this.inkDirty = false; }

        titleValue() { return this.titleInput.value.replace(/[\\/:*?"<>|]+/g, ' ').replace(/\s+/g, ' ').trim(); }

        change() {
            this.inkDirty = true;
            this.mgr.notebookMarkAsUnsaved();
        }

        snapshot() {
            this.undoStack.push(clone(this.strokes));
            if (this.undoStack.length > 60) this.undoStack.shift();
            this.redoStack = [];
        }

        undo() {
            if (this.tool === 'text' && doc.activeElement === this.text) { doc.execCommand('undo'); return; }
            if (!this.undoStack.length) return;
            this.redoStack.push(clone(this.strokes));
            this.strokes = this.undoStack.pop();
            this.selection.clear();
            this.change();
            this.layout();
        }

        redo() {
            if (this.tool === 'text' && doc.activeElement === this.text) { doc.execCommand('redo'); return; }
            if (!this.redoStack.length) return;
            this.undoStack.push(clone(this.strokes));
            this.strokes = this.redoStack.pop();
            this.selection.clear();
            this.change();
            this.layout();
        }

        // ---- tools

        setTool(tool, quiet) {
            this.tool = tool;
            if (tool !== 'select') this.selection.clear();
            this.modal.dataset.jnlTool = tool;
            this.canvas.style.pointerEvents = tool === 'text' ? 'none' : 'auto';
            this.text.readOnly = tool !== 'text' || this.text.dataset.readonly === '1';
            if (tool === 'text' && !quiet) this.text.focus({ preventScroll: true });
            this.renderButtons();
            this.paint();
        }

        renderButtons() {
            const m = this.modal;
            m.querySelectorAll('[data-jnl-tool]').forEach((b) => b.classList.toggle('is-checked', b.dataset.jnlTool === this.tool));
            m.style.setProperty('--jnl-pen-color', PENS[this.pen].color);
            m.style.setProperty('--jnl-hl-color', HIGHLIGHTERS[this.hl].color);
            const zoom = m.querySelector('.jnl-zoom');
            if (zoom && zoom.value !== String(this.zoom)) zoom.value = String(this.zoom);
            const undo = m.querySelector('[data-jnl-cmd="undo"]');
            if (undo) undo.disabled = !this.undoStack.length && this.tool !== 'text';
            const redo = m.querySelector('[data-jnl-cmd="redo"]');
            if (redo) redo.disabled = !this.redoStack.length && this.tool !== 'text';
            const hasSel = this.selection.size > 0;
            m.querySelectorAll('[data-jnl-cmd="cut"], [data-jnl-cmd="copy"]').forEach((b) => { b.disabled = !hasSel && this.tool !== 'text'; });
            const paste = m.querySelector('[data-jnl-cmd="paste"]');
            if (paste) paste.disabled = !this.clipboard && this.tool !== 'text';
        }

        applyBars() {
            const m = this.modal;
            const std = m.querySelector('.jnl-band[data-band="standard"]');
            const pen = m.querySelector('.jnl-band[data-band="pen"]');
            if (std) std.hidden = !this.bars.standard;
            if (pen) pen.hidden = !this.bars.pen;
            const pb = m.querySelector('.jnl-pagebar');
            if (pb) pb.hidden = !this.bars.pagebar;
            const rebar = m.querySelector('.jnl-rebar');
            if (rebar) rebar.hidden = !this.bars.standard && !this.bars.pen && rebar.querySelectorAll('.jnl-band:not([hidden])').length === 0;
        }

        toggleBar(key) {
            this.bars[key] = !this.bars[key];
            setReg({ StandardBar: this.bars.standard ? 1 : 0, PenBar: this.bars.pen ? 1 : 0, PageBar: this.bars.pagebar ? 1 : 0 });
            this.applyBars();
            this.layout();
        }

        setZoom(z) {
            this.zoom = z;
            setReg({ Zoom: String(z) });
            this.renderButtons();
            this.layout();
        }

        // ---- pointer on the page

        bind() {
            const cv = this.canvas;
            let live = null;
            let drag = null;
            cv.addEventListener('pointerdown', (e) => {
                if (e.button !== 0 && e.pointerType === 'mouse') return;
                if (this.text.dataset.readonly === '1') return;
                e.preventDefault();
                try { cv.setPointerCapture(e.pointerId); } catch (_) { /* gone */ }
                const p = this.point(e);
                const t = this.tool;
                if (t === 'pen' || t === 'highlighter') {
                    const preset = t === 'pen' ? PENS[this.pen] : HIGHLIGHTERS[this.hl];
                    live = { tool: t, color: preset.color, width: preset.width, pts: [p] };
                } else if (t === 'eraser') {
                    this.snapshot();
                    drag = { erasing: true, any: false };
                    this.eraseAt(p, drag);
                } else if (t === 'select') {
                    const sel = [...this.selection];
                    const one = sel.length === 1 ? this.strokes[sel[0]] : null;
                    const grip = 6 / this.k();
                    if (one && one.tool === 'picture' && Math.abs(p[0] - (one.pts[0][0] + one.w)) <= grip && Math.abs(p[1] - (one.pts[0][1] + one.h)) <= grip) {
                        this.snapshot();
                        drag = { resize: one, ratio: one.h / one.w };
                        this.paint();
                        return;
                    }
                    const picIndex = this.strokes.map((st, i) => (st.tool === 'picture' && hitStroke(st, p, 0) ? i : -1)).filter((i) => i >= 0).pop();
                    if (picIndex != null && !this.selection.has(picIndex)) {
                        this.selection = new Set([picIndex]);
                    }
                    const box = this.selectionBox();
                    if (box && p[0] >= box.x0 - 4 && p[0] <= box.x1 + 4 && p[1] >= box.y0 - 4 && p[1] <= box.y1 + 4) {
                        this.snapshot();
                        drag = { move: true, from: p, moved: false };
                    } else {
                        this.selection.clear();
                        live = { lasso: [p] };
                    }
                } else if (t === 'space') {
                    this.snapshot();
                    drag = { space: true, from: p, base: clone(this.strokes) };
                    live = { spaceAt: p[1] };
                } else if (t === 'flag') {
                    this.snapshot();
                    this.strokes.push({ tool: 'flag', color: this.flag, pts: [[p[0] - 3, p[1] - 12]] });
                    this.change();
                    this.layout();
                }
                this.paint(live);
            });
            cv.addEventListener('pointermove', (e) => {
                if (!live && !drag) return;
                const evs = typeof e.getCoalescedEvents === 'function' && e.getCoalescedEvents().length ? e.getCoalescedEvents() : [e];
                if (live && live.pts) {
                    evs.forEach((ev) => {
                        const p = this.point(ev);
                        const last = live.pts[live.pts.length - 1];
                        if (Math.hypot(p[0] - last[0], p[1] - last[1]) >= 0.6) live.pts.push(p);
                    });
                } else if (live && live.lasso) {
                    live.lasso.push(this.point(e));
                } else if (drag && drag.erasing) {
                    evs.forEach((ev) => this.eraseAt(this.point(ev), drag));
                } else if (drag && drag.resize) {
                    const p = this.point(e);
                    const st = drag.resize;
                    const w = Math.max(20, p[0] - st.pts[0][0]);
                    st.w = Math.round(w * 10) / 10;
                    st.h = Math.round(w * drag.ratio * 10) / 10;
                    drag.moved = true;
                } else if (drag && drag.move) {
                    const p = this.point(e);
                    const dx = p[0] - drag.from[0];
                    const dy = p[1] - drag.from[1];
                    if (dx || dy) {
                        this.strokes.forEach((st, i) => { if (this.selection.has(i)) st.pts = st.pts.map((pt) => [Math.round((pt[0] + dx) * 10) / 10, Math.round((pt[1] + dy) * 10) / 10]); });
                        drag.from = p;
                        drag.moved = true;
                    }
                } else if (drag && drag.space) {
                    const p = this.point(e);
                    const dy = p[1] - drag.from[1];
                    const y0 = drag.from[1];
                    this.strokes = drag.base.map((st) => {
                        const top = Math.min(...st.pts.map((pt) => pt[1]));
                        if (top < y0) return st;
                        return { ...st, pts: st.pts.map((pt) => [pt[0], Math.round(Math.max(y0, pt[1] + dy) * 10) / 10]) };
                    });
                    live.spaceAt = y0 + Math.max(0, dy);
                }
                this.paint(live);
            });
            const end = () => {
                if (live && live.pts) {
                    this.snapshot();
                    this.strokes.push(live);
                    this.change();
                } else if (live && live.lasso) {
                    const poly = live.lasso;
                    if (poly.length > 2) {
                        this.strokes.forEach((st, i) => {
                            if (st.tool === 'picture') {
                                if (inPoly([st.pts[0][0] + st.w / 2, st.pts[0][1] + st.h / 2], poly)) this.selection.add(i);
                                return;
                            }
                            const inside = st.pts.filter((pt) => inPoly(pt, poly)).length;
                            if (inside && inside >= st.pts.length * 0.6) this.selection.add(i);
                        });
                    }
                } else if (drag && drag.erasing) {
                    if (drag.any) this.change(); else this.undoStack.pop();
                } else if (drag && drag.resize) {
                    if (drag.moved) this.change(); else this.undoStack.pop();
                } else if (drag && drag.move) {
                    if (drag.moved) this.change(); else this.undoStack.pop();
                } else if (drag && drag.space) {
                    this.change();
                }
                live = null;
                drag = null;
                this.renderButtons();
                this.layout();
            };
            cv.addEventListener('pointerup', end);
            cv.addEventListener('pointercancel', end);

            this.view.addEventListener('scroll', () => this.pageBar(), { passive: true });
            if (typeof ResizeObserver === 'function') new ResizeObserver(() => { if (!this.modal.classList.contains('hidden')) this.layout(); }).observe(this.view);
            this.text.addEventListener('input', () => this.layout());
            this.titleInput.addEventListener('input', () => { this.mgr.notebookMarkAsUnsaved(); this.mgr.notebookUpdateTitle(); });

            // typing while the pen is out goes to the text (Journal's text box)
            this.modal.addEventListener('keydown', (e) => {
                if (e.target === this.titleInput) return;
                if ((e.key === 'Delete' || e.key === 'Backspace') && this.tool === 'select' && this.selection.size) { e.preventDefault(); this.deleteSelection(); return; }
                if (e.key === 'Escape' && this.selection.size) { this.selection.clear(); this.paint(); this.renderButtons(); return; }
                if (this.tool !== 'text' && e.key.length === 1 && !e.ctrlKey && !e.metaKey && !e.altKey && e.target !== this.text) {
                    this.setTool('text');
                    const t = this.text;
                    t.setSelectionRange(t.value.length, t.value.length);
                }
            });

            this.modal.addEventListener('click', (e) => {
                const b = e.target.closest('[data-jnl-cmd], [data-jnl-tool]');
                if (!b || b.disabled || !this.modal.contains(b)) return;
                if (b.dataset.jnlTool) { this.setTool(b.dataset.jnlTool); return; }
                void this.run(b.dataset.jnlCmd);
            });
            const zoom = this.modal.querySelector('.jnl-zoom');
            if (zoom) zoom.addEventListener('change', () => this.setZoom(/^[0-9.]+$/.test(zoom.value) ? Number(zoom.value) : zoom.value));
            const pbPrev = this.modal.querySelector('[data-jnl-page="prev"]');
            const pbNext = this.modal.querySelector('[data-jnl-page="next"]');
            const step = (d) => { const h = VM_PAGE_H * this.s(); this.view.scrollTop = Math.max(0, (Math.round(this.view.scrollTop / h) + d) * h); };
            if (pbPrev) pbPrev.addEventListener('click', () => step(-1));
            if (pbNext) pbNext.addEventListener('click', () => step(1));
            this.clips.addEventListener('click', (e) => {
                const c = e.target.closest('.jnl-clip');
                if (c) void this.playClip(c.dataset.audio);
            });
            this.clips.addEventListener('contextmenu', async (e) => {
                const c = e.target.closest('.jnl-clip');
                if (!c || typeof root.showConfirmationDialog !== 'function') return;
                e.preventDefault();
                const yes = await root.showConfirmationDialog(`<p>Delete the recording "${esc(c.title)}" from this note?</p>`, [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }], null, { title: 'Melaton Journal', width: 360 });
                if (yes === true) void this.deleteClip(c.dataset.audio);
            });
            // the Pen band's drop-downs (Pen, Highlighter, Eraser, Flag) and the menu bar
            if (typeof contextMenu !== 'undefined') { // eslint-disable-line no-undef
                this.modal.querySelectorAll('[data-jnl-drop]').forEach((b) => {
                    // eslint-disable-next-line no-undef
                    contextMenu.attachClickMenuToElement(b, {
                        position: 'anchor',
                        onAction: (action) => this.pick(action),
                        sections: [{ type: 'list', initfn: (section) => { section.items = this.dropItems(b.dataset.jnlDrop); } }]
                    });
                });
                this.modal.querySelectorAll('[data-notebook-menu]').forEach((title) => {
                    // eslint-disable-next-line no-undef
                    contextMenu.attachClickMenuToElement(title, {
                        onAction: (action) => this.menuAction(action),
                        sections: [{ type: 'list', initfn: (section) => { section.items = this.menuItems(title.dataset.notebookMenu); } }]
                    });
                });
            }
        }

        eraseAt(p, drag) {
            const mode = ERASERS.find(([k]) => k === this.eraser) || ERASERS[1];
            const r = mode[2];
            if (mode[0] === 'stroke') {
                const keep = this.strokes.filter((st) => !hitStroke(st, p, r));
                if (keep.length !== this.strokes.length) { this.strokes = keep; drag.any = true; }
            } else {
                const out = erasePoints(this.strokes, p, r);
                if (out) { this.strokes = out; drag.any = true; }
            }
        }

        deleteSelection() {
            if (!this.selection.size) return;
            this.snapshot();
            this.strokes = this.strokes.filter((_, i) => !this.selection.has(i));
            this.selection.clear();
            this.change();
            this.layout();
            this.renderButtons();
        }

        copySelection(cut) {
            if (!this.selection.size) return false;
            this.clipboard = clone(this.strokes.filter((_, i) => this.selection.has(i)));
            if (cut) this.deleteSelection();
            this.renderButtons();
            return true;
        }

        pasteInk() {
            if (!this.clipboard) return false;
            this.snapshot();
            const start = this.strokes.length;
            this.clipboard.forEach((st) => this.strokes.push({ ...st, pts: st.pts.map((pt) => [pt[0] + 10, pt[1] + 10]) }));
            this.setTool('select', true);
            this.selection = new Set(this.clipboard.map((_, i) => start + i));
            this.change();
            this.layout();
            return true;
        }

        selectAll() {
            if (this.tool === 'text') { this.text.focus(); this.text.select(); return; }
            this.setTool('select', true);
            this.selection = new Set(this.strokes.map((_, i) => i));
            this.paint();
            this.renderButtons();
        }

        // ---- commands (toolbar buttons and menu rows)

        async run(cmd) {
            const mgr = this.mgr;
            switch (cmd) {
                case 'new': await mgr.notebookHandleNewNote(); break;
                case 'recent': this.toggleRecent(); break;
                case 'open': await this.openDialog(); break;
                case 'save': await mgr.notebookSaveCurrentNote(); break;
                case 'save-as': await mgr.notebookSaveAs(); break;
                case 'find': await this.find(); break;
                case 'cut': if (!this.copySelection(true)) { this.text.focus(); doc.execCommand('cut'); } break;
                case 'copy': if (!this.copySelection(false)) { this.text.focus(); doc.execCommand('copy'); } break;
                case 'paste': if (this.tool === 'text' || !this.pasteInk()) { this.text.focus(); try { const t = await navigator.clipboard.readText(); this.text.setRangeText(t, this.text.selectionStart, this.text.selectionEnd, 'end'); mgr.notebookMarkAsUnsaved(); this.layout(); } catch (_) { doc.execCommand('paste'); } } break;
                case 'undo': this.undo(); break;
                case 'redo': this.redo(); break;
                case 'delete': if (this.selection.size) this.deleteSelection(); else if (this.tool === 'text') doc.execCommand('delete'); break;
                case 'select-all': this.selectAll(); break;
                case 'select-page': this.selectAll(); break;
                case 'cancel-selection': this.selection.clear(); this.paint(); this.renderButtons(); break;
                case 'new-page': this.extraPages = (this.pages || 1) + 1; this.change(); this.layout(); this.view.scrollTop = (this.pages - 1) * VM_PAGE_H * this.s(); break;
                case 'text-box': this.setTool('text'); break;
                case 'voice': await this.recordVoice(); break;
                case 'picture': await this.insertPicture(); break;
                case 'move': await mgr.notebookMoveNote(); break;
                case 'delete-note': if (mgr.notebookCurrentNote) await mgr.notebookDeleteNote(mgr.notebookCurrentNote.id); break;
                case 'full-screen': this.toggleFullScreen(); break;
                case 'refresh': await mgr.notebookRefreshNotesList(); break;
                case 'exit': await mgr.closeNotebook(); break;
                case 'about': await this.about(); break;
                case 'help': if (typeof root.openHelpTopic === 'function') root.openHelpTopic('journal'); break;
                default: break;
            }
            this.renderButtons();
        }

        toggleFullScreen() {
            const m = this.modal;
            m.classList.toggle('jnl-full');
            this.layout();
        }

        async about() {
            // Journal.exe's About is ShellAbout with its version line under the legal text
            if (typeof root.openAboutMelatoninModal !== 'function') return;
            const info = typeof root.getMeletonVersionInfo === 'function' ? root.getMeletonVersionInfo() : {};
            const ver = [info.version, info.build && info.build !== 'Unknown' ? info.build : ''].filter(Boolean).join('.');
            await root.openAboutMelatoninModal({ program: 'Melaton Journal', other: `Melaton Journal ${ver}`.trim(), owner: this.modal });
        }

        /** View Recent Notes: the notes of the workspace in the view instead of the page (Journal's list). */
        toggleRecent(show) {
            const m = this.modal;
            const on = show == null ? !m.classList.contains('jnl-recent') : !!show;
            m.classList.toggle('jnl-recent', on);
            if (on) void this.mgr.notebookRefreshNotesList();
            else this.layout();
        }

        async openDialog() {
            if (typeof this.mgr.showOpenNoteModal === 'function') {
                await this.mgr.showOpenNoteModal({ journal: true });
                return;
            }
            this.toggleRecent(true);
        }

        async find() {
            if (root.notepadVista && typeof root.notepadVista.findIn === 'function') { root.notepadVista.findIn(this.text); return; }
            this.setTool('text');
            const what = typeof root.showInputDialog === 'function' ? await root.showInputDialog('Find what:', '', '') : null;
            if (!what) return;
            const at = this.text.value.toLowerCase().indexOf(String(what).toLowerCase(), this.text.selectionEnd || 0);
            if (at >= 0) { this.text.focus(); this.text.setSelectionRange(at, at + what.length); }
        }

        // ---- the drop-downs of the Pen band (Pen, Highlighter, Eraser, Flag)

        dropItems(kind) {
            let items;
            if (kind === 'pen') {
                items = PENS.map((p, i) => ({ text: p.name, action: `pen:${i}`, checked: this.tool === 'pen' && this.pen === i, indicatorMark: 'radio', swatch: p.color })).concat([{ separator: true }, { text: 'Pen Settings...', action: 'pen-settings', disabled: true }]);
            } else if (kind === 'highlighter') {
                items = HIGHLIGHTERS.map((p, i) => ({ text: p.name, action: `hl:${i}`, checked: this.tool === 'highlighter' && this.hl === i, indicatorMark: 'radio', swatch: p.color })).concat([{ separator: true }, { text: 'Highlighter Settings...', action: 'hl-settings', disabled: true }]);
            } else if (kind === 'eraser') {
                items = ERASERS.slice(0, 3).map(([k, l]) => ({ text: l, action: `eraser:${k}`, checked: this.eraser === k, indicatorMark: 'radio' })).concat([{ separator: true }, { text: 'Stroke', action: 'eraser:stroke', checked: this.eraser === 'stroke', indicatorMark: 'radio' }]);
            } else {
                items = FLAGS.map(([k, l]) => ({ text: l, action: `flag:${k}`, checked: this.flag === k, indicatorMark: 'radio' }));
            }
            return items;
        }

        /** A menu bar row: Journal's commands here, Dreamscape's note rows to the manager. */
        menuAction(action) {
            const a = String(action);
            if (/^(pen|hl|eraser|flag|zoom|bar|tool):/.test(a)) { this.pick(a); return; }
            if (a.startsWith('recent-note:')) { this.toggleRecent(false); void this.mgr.notebookLoadNote(a.slice(12)); return; }
            if (['open-in-window', 'add-to-desktop', 'copy-lookback', 'modify-note', 'notebookNovelGenerateBtn', 'notebookNovelUndoBtn', 'notebookNovelContinueBtn'].includes(a)) { void this.mgr.notebookRunMenuAction(a); return; }
            void this.run(a);
        }

        pick(action) {
            const [kind, v] = String(action).split(':');
            if (kind === 'pen') { this.pen = Number(v); setReg({ Pen: this.pen }); this.setTool('pen'); }
            else if (kind === 'hl') { this.hl = Number(v); setReg({ Highlighter: this.hl }); this.setTool('highlighter'); }
            else if (kind === 'eraser') { this.eraser = v; setReg({ Eraser: v }); this.setTool('eraser'); }
            else if (kind === 'flag') { this.flag = v; this.setTool('flag'); }
            else if (kind === 'zoom') this.setZoom(/^[0-9.]+$/.test(v) ? Number(v) : v);
            else if (kind === 'bar') this.toggleBar(v);
            else if (kind === 'tool') this.setTool(v);
            else void this.run(action);
        }

        // ---- the menu bar (Journal.exe.mui menu 104)

        menuItems(menu) {
            const mgr = this.mgr;
            const note = mgr.notebookCurrentNote;
            const ro = this.text.dataset.readonly === '1';
            const sel = this.selection.size > 0;
            const textOn = this.tool === 'text';
            const radio = (on) => ({ checked: !!on, indicatorMark: 'radio' });
            const no = { disabled: true };
            if (menu === 'file') {
                return [
                    { text: 'New Note', subtext: 'Ctrl+N', action: 'new', disabled: ro },
                    { text: 'New Note from Template...', ...no },
                    { text: 'Open...', subtext: 'Ctrl+O', action: 'open' },
                    { text: 'Import...', ...no },
                    { text: 'Search...', action: 'find' },
                    { separator: true },
                    { text: 'Save', subtext: 'Ctrl+S', action: 'save', disabled: ro || !mgr.notebookHasUnsavedChanges },
                    { text: 'Save As...', action: 'save-as', disabled: ro },
                    { text: 'Export As...', ...no },
                    { separator: true },
                    { text: 'Move to Folder...', subtext: 'Ctrl+Shift+V', action: 'move', disabled: ro || !note },
                    { text: 'Delete Note', action: 'delete-note', disabled: ro || !note },
                    { separator: true },
                    { text: 'Page Setup...', ...no },
                    { text: 'Print...', subtext: 'Ctrl+P', ...no },
                    { separator: true },
                    { text: 'Send to Mail Recipient...', ...no },
                    { separator: true },
                    { text: 'Recently Used Notes', submenu: this.recentRows() },
                    { separator: true },
                    { text: 'Exit', subtext: 'Alt+F4', action: 'exit' },
                    // Dreamscape's own rows under Journal's (as Notepad keeps them)
                    { separator: true },
                    { text: 'Open in Window', action: 'open-in-window', disabled: !note },
                    { text: 'Add to Desktop', action: 'add-to-desktop', disabled: !note }
                ];
            }
            if (menu === 'edit') {
                return [
                    { text: 'Undo', subtext: 'Ctrl+Z', action: 'undo', disabled: !this.undoStack.length && !textOn },
                    { text: 'Redo', subtext: 'Ctrl+Y', action: 'redo', disabled: !this.redoStack.length && !textOn },
                    { separator: true },
                    { text: 'Cut', subtext: 'Ctrl+X', action: 'cut', disabled: !sel && !textOn },
                    { text: 'Copy as Text...', ...no },
                    { text: 'Copy', subtext: 'Ctrl+C', action: 'copy', disabled: !sel && !textOn },
                    { text: 'Paste', subtext: 'Ctrl+V', action: 'paste', disabled: !this.clipboard && !textOn },
                    { separator: true },
                    { text: 'Selection Tool', action: 'tool:select', ...radio(this.tool === 'select') },
                    { text: 'Select All', subtext: 'Ctrl+A', action: 'select-all' },
                    { text: 'Select Page', action: 'select-page' },
                    { text: 'Cancel Selection', subtext: 'Esc', action: 'cancel-selection', disabled: !sel },
                    { text: 'Delete', subtext: 'Del', action: 'delete', disabled: !sel && !textOn },
                    { separator: true },
                    { text: 'Find...', subtext: 'Ctrl+F', action: 'find' },
                    { text: 'Go to Page...', subtext: 'Ctrl+G', ...no },
                    { separator: true },
                    { text: 'Format...', ...no },
                    { separator: true },
                    { text: 'Copy Lookback', action: 'copy-lookback', disabled: !note },
                    { text: 'Note Properties...', action: 'modify-note', disabled: !note }
                ];
            }
            if (menu === 'view') {
                return [
                    { text: 'Toolbars', submenu: [
                        { text: 'Standard', action: 'bar:standard', checked: this.bars.standard },
                        { text: 'Pen', action: 'bar:pen', checked: this.bars.pen },
                        { text: 'Format', ...no },
                        { text: 'View', ...no }
                    ] },
                    { text: 'Page Bar', action: 'bar:pagebar', checked: this.bars.pagebar },
                    { separator: true },
                    { text: 'Recent Notes', submenu: [
                        { text: 'List', action: 'recent', ...radio(this.modal.classList.contains('jnl-recent')) },
                        { text: 'By folders', ...no },
                        { text: 'By creation date', ...no },
                        { text: 'By modification date', ...no },
                        { text: 'With flags', ...no }
                    ] },
                    { separator: true },
                    { text: 'Refresh', subtext: 'F5', action: 'refresh' },
                    { separator: true },
                    { text: 'Page Width', action: 'zoom:width', ...radio(this.zoom === 'width') },
                    { text: 'Whole Page', action: 'zoom:whole', ...radio(this.zoom === 'whole') },
                    { text: 'Two Pages', ...no },
                    { text: 'Reading View', ...no },
                    { text: 'Zoom', submenu: ZOOMS.slice(2).map(([v, l]) => ({ text: l, action: `zoom:${v}`, ...radio(Number(this.zoom) === v) })) },
                    { separator: true },
                    { text: 'Full Screen', subtext: 'F11', action: 'full-screen', checked: this.modal.classList.contains('jnl-full') }
                ];
            }
            if (menu === 'insert') {
                return [
                    { text: 'New Page', action: 'new-page', disabled: ro },
                    { text: 'Insert/Remove Space', action: 'tool:space', disabled: ro, ...radio(this.tool === 'space') },
                    { separator: true },
                    { text: 'Text Box', action: 'text-box', disabled: ro, ...radio(textOn) },
                    { text: 'Picture...', action: 'picture', disabled: ro || typeof root.studioOpenFolderDialog !== 'function' },
                    { text: 'Voice Recording...', action: 'voice', disabled: ro || !root.soundRecorder },
                    { separator: true },
                    { text: 'Meeting Information...', ...no },
                    { text: 'Flag', disabled: ro, submenu: FLAGS.map(([k, l]) => ({ text: l, action: `flag:${k}`, ...radio(this.tool === 'flag' && this.flag === k) })) }
                ];
            }
            if (menu === 'actions') {
                const novel = ['notebookNovelGenerateBtn', 'notebookNovelUndoBtn', 'notebookNovelContinueBtn'].map((id) => {
                    const btn = doc.getElementById(id);
                    return btn && !btn.classList.contains('hidden') ? { text: btn.title, action: id, disabled: btn.disabled } : null;
                }).filter(Boolean);
                return [
                    { text: 'Convert Selection to E-mail...', ...no },
                    { text: 'Convert Selection To', submenu: [{ text: 'E-mail', ...no }] },
                    { text: 'Convert Handwriting to Text...', ...no },
                    { separator: true },
                    { text: 'Group', ...no },
                    { text: 'Group as One Word', ...no },
                    { text: 'Ungroup', ...no },
                    { separator: true },
                    { text: 'Change Shape To', submenu: [{ text: 'Square', ...no }, { text: 'Circle/Ellipse', ...no }, { text: 'Line', ...no }] }
                ].concat(novel.length ? [{ separator: true }].concat(novel) : []);
            }
            if (menu === 'tools') {
                return [
                    { text: 'Pen', submenu: PENS.map((p, i) => ({ text: p.name, action: `pen:${i}`, ...radio(this.tool === 'pen' && this.pen === i) })) },
                    { text: 'Highlighter', submenu: HIGHLIGHTERS.map((p, i) => ({ text: p.name, action: `hl:${i}`, ...radio(this.tool === 'highlighter' && this.hl === i) })) },
                    { text: 'Eraser', submenu: ERASERS.slice(0, 3).map(([k, l]) => ({ text: l, action: `eraser:${k}`, ...radio(this.tool === 'eraser' && this.eraser === k) })).concat([{ separator: true }, { text: 'Stroke', action: 'eraser:stroke', ...radio(this.tool === 'eraser' && this.eraser === 'stroke') }]) },
                    { separator: true },
                    { text: 'Pan', ...no },
                    { separator: true },
                    { text: 'Options...', ...no },
                    { separator: true },
                    { text: 'Install or Repair Journal Note Writer...', ...no }
                ];
            }
            return [
                { text: 'Melaton Journal Help', subtext: 'F1', action: 'help', disabled: typeof root.openHelpTopic !== 'function' },
                { separator: true },
                { text: 'About Melaton Journal', action: 'about' }
            ];
        }

        recentRows() {
            const list = (this.mgr.notebookRecent || []).slice(0, 8);
            if (!list.length) return [{ text: 'None', disabled: true }, { separator: true }, { text: 'More Notes...', action: 'open' }];
            return list.map((n, i) => ({ text: `${i + 1} ${n.name}`, action: `recent-note:${n.id}` })).concat([{ separator: true }, { text: 'More Notes...', action: 'open' }]);
        }

        // ---- recordings: speakers in the margin gutter (#785)

        renderClips() {
            const s = this.s();
            // in the margin gutter, one under another from the first rule (the typing keeps its lines)
            this.clips.innerHTML = this.audio.map((a, n) => `<button type="button" class="jnl-clip" data-audio="${esc(a.id)}" title="${esc(a.name || 'Recording')}" style="top:${Math.round((FIRST_RULE + n * RULE * 2) * s)}px"><img src="${ART}voice-clip.png" alt=""></button>`).join('');
        }

        setAudio(list) {
            this.audio = Array.isArray(list) ? list : [];
            this.renderClips();
        }

        async playClip(audioId) {
            const note = this.mgr.notebookCurrentNote;
            if (!note || !note.id || !root.wsClient) return;
            try {
                const res = await root.wsClient.getNoteAudio(note.id, audioId);
                const data = res && (res.base64 != null ? res : res.data);
                if (!data || !data.base64) throw new Error('The recording was not found.');
                if (this.player) this.player.pause();
                this.player = new Audio(`data:${data.mime || 'audio/webm'};base64,${data.base64}`);
                await this.player.play();
            } catch (err) {
                if (typeof root.showGlassToast === 'function') root.showGlassToast('error', 'Melaton Journal', `Cannot play the recording. ${err && err.message ? err.message : ''}`, false, 4000);
            }
        }

        async deleteClip(audioId) {
            const note = this.mgr.notebookCurrentNote;
            if (!note || !note.id || !root.wsClient) return;
            try {
                const res = await root.wsClient.deleteNoteAudio(note.id, audioId);
                const data = res && (res.note ? res : res.data);
                this.setAudio((data && data.note && data.note.metadata && data.note.metadata.audio) || this.audio.filter((a) => a.id !== audioId));
            } catch (_) { /* stays */ }
        }

        /**
         * Insert > Picture...: Vista's Open dialog on the workspace's Pictures (generated images) or any
         * folder (image files); the picture goes on the page in view, at most 400 units wide.
         */
        async insertPicture() {
            const isPic = (i) => !!i && (i.targetKind === 'image' || i.targetKind === 'scrap' || i.shortcutType === 'image'
                || (i.targetKind === 'user-file' && (/^image\//i.test(i.mimeType || '') || /\.(png|jpe?g|webp|gif|bmp)$/i.test(i.name || ''))));
            const ws = (this.mgr.notebookCurrentNote && this.mgr.notebookCurrentNote.workspace_id) || this.mgr.notebookCurrentWorkspace || (typeof activeWorkspace !== 'undefined' && activeWorkspace) || 'default'; // eslint-disable-line no-undef
            await root.studioOpenFolderDialog('open-vfs', {
                owner: this.modal,
                startPath: `/Workspaces/${ws}/Pictures`,
                host: {
                    title: 'Insert Picture',
                    typeLabel: 'All Pictures',
                    rejectMessage: 'Choose a picture',
                    acceptItem: isPic,
                    onOpen: (item) => this.addPicture(item)
                }
            });
        }

        addPicture(item) {
            let src;
            if (item.targetKind === 'user-file') src = { kind: 'file', id: item.targetId, name: item.name };
            else src = { kind: 'image', filename: item.shortcutType === 'image' ? ((item.shortcutData && item.shortcutData.filename) || item.previewImageFilename || item.targetId) : (item.previewImageFilename || item.targetId) };
            const rec = pictureImage(src);
            const place = () => {
                const nw = rec.img.naturalWidth || 400;
                const nh = rec.img.naturalHeight || 300;
                const w = Math.min(400, nw);
                const k = this.k();
                const x = MARGIN * this.s() / k + 12;
                const y = Math.max(FIRST_RULE * this.s() / k, (this.view.scrollTop + 40) / k);
                this.snapshot();
                this.strokes.push({ tool: 'picture', src, pts: [[Math.round(x), Math.round(y)]], w, h: Math.round((w * nh / nw) * 10) / 10 });
                this.setTool('select', true);
                this.selection = new Set([this.strokes.length - 1]);
                this.change();
                this.layout();
                this.renderButtons();
            };
            if (rec.img.complete && rec.img.naturalWidth) place();
            else {
                let done = false;
                const once = () => { if (!done) { done = true; place(); } };
                rec.img.addEventListener('load', once, { once: true });
                rec.img.addEventListener('error', once, { once: true });
                setTimeout(once, 4000);
            }
        }

        /** Insert > Voice Recording...: Sound Recorder records; what it records goes onto this note. */
        async recordVoice() {
            if (!root.soundRecorder) return;
            const blob = await root.soundRecorder.record({ owner: this.modal, title: 'Sound Recorder' });
            if (!blob || !blob.blob || !blob.blob.size) return;
            let note = this.mgr.notebookCurrentNote;
            if (!note || !note.id) {
                await this.mgr.notebookSaveCurrentNote();
                note = this.mgr.notebookCurrentNote;
                if (!note || !note.id) return;
            }
            const base64 = await new Promise((resolve, reject) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
                r.onerror = () => reject(r.error);
                r.readAsDataURL(blob.blob);
            });
            const taken = new Set(this.audio.map((a) => String(a.name || '').toLowerCase()));
            let n = 1;
            while (taken.has(`recording${n}`)) n++;
            const audioId = `r${Date.now().toString(36)}${Math.random().toString(36).slice(2, 8)}`;
            try {
                const res = await root.wsClient.putNoteAudio(note.id, { audioId, name: `Recording${n}`, mime: blob.blob.type, ms: blob.ms, base64 });
                const data = res && (res.audio ? res : res.data);
                this.setAudio((data && data.note && data.note.metadata && data.note.metadata.audio) || this.audio.concat([{ id: audioId, name: `Recording${n}`, ms: blob.ms }]));
            } catch (err) {
                if (typeof root.showGlassToast === 'function') root.showGlassToast('error', 'Melaton Journal', `The recording could not be saved. ${err && err.message ? err.message : ''}`, false, 5000);
            }
        }
    }

    root.journalUI = {
        attach(mgr) {
            if (!ui && mgr && mgr.notebookModal && mgr.notebookModal.querySelector('.jnl-page')) ui = new JournalUI(mgr);
            return ui;
        },
        get: () => ui,
        PENS,
        HIGHLIGHTERS,
        drawStroke
    };
})(window);
