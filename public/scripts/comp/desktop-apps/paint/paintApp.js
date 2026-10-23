/**
 * Paint (Yozora #632): Vista's mspaint.exe, then layers and the tools a modern editor has.
 *
 *   window      File Edit View Image Layers Select Adjustments Filter Colors Help; the tool box
 *               (Vista's 16 tools from mspaint.exe bitmap 859, then Move, Gradient, Magic Wand, Clone
 *               Stamp, Blur, Elliptical Select, Polygonal Lasso, Crop, Hand, Spot Healing Brush,
 *               Smudge, Dodge, Burn, Sponge), the tool's options box, the Tool Settings bar (size,
 *               opacity, hardness, tolerance, the selection mode, Contiguous, Sample All Layers), the
 *               canvas on the app workspace (#ababab) with its resize handles, the color box
 *               (paintColor.js: Photoshop's spectrum ramp and saved swatches), the status bar (help, the cursor, the selection's size), and the
 *               Layers window (paintLayers.js)
 *   documents   a PaintCore.Document (paintCore.js); files open from Cartograph (any picture) or
 *               the gallery, save as a Graphic Session Document (.gsd, paintGsd.js: the whole
 *               session without loss, docs/paint-gsd-format.md), PNG / JPEG / BMP / WebP, or a
 *               Melaton Paint image (.mpi) in the VFS; Save to Gallery and Set as Desktop Background
 *   dialogs     Vista's own templates (vistaDialogTemplate.js): Attributes, Flip and Rotate,
 *               Resize and Skew, Grid Settings (mspaint.exe.mui) and Edit Colors (comdlg32 CHOOSECOLOR)
 *   Photoshop   Free Transform (Ctrl+T), Photoshop's single-key tools (Shift cycles a group), X / D,
 *               [ ], Space to pan, Alt+wheel zoom, the brush outline; selections, filters, Levels,
 *               Curves and the Navigator / Info windows are paintPro.js
 *
 *   openMelatonPaint({ image?: url, name?, file?: { id, name, path } })
 */
(function (root) {
    'use strict';

    const doc = document;
    const C = () => root.PaintCore;
    const ART = '/static_images/vista-paint';
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\CurrentVersion\\Applets\\Paint';
    const PALETTE = [
        '#000000', '#808080', '#800000', '#808000', '#008000', '#008080', '#000080', '#800080', '#808040', '#004040', '#0080ff', '#004080', '#8000ff', '#804000',
        '#ffffff', '#c0c0c0', '#ff0000', '#ffff00', '#00ff00', '#00ffff', '#0000ff', '#ff00ff', '#ffff80', '#00ff80', '#80ffff', '#8080ff', '#ff0080', '#ff8040'
    ];
    // Vista's order (tools.png), then the extra tools (tools-extra.png)
    const TOOLS = [
        ['freeselect', 'Free-Form Select', 'Selects a free-form part of the picture to move, copy, or edit.'],
        ['select', 'Select', 'Selects a rectangular part of the picture to move, copy, or edit.'],
        ['eraser', 'Eraser/Color Eraser', 'Erases a portion of the picture, using the selected eraser shape.'],
        ['fill', 'Fill With Color', 'Fills an area with the current drawing color.'],
        ['picker', 'Pick Color', 'Picks up a color from the picture for drawing.'],
        ['magnifier', 'Magnifier', 'Changes the magnification.'],
        ['pencil', 'Pencil', 'Draws a free-form line one pixel wide.'],
        ['brush', 'Brush', 'Draws using a brush with the selected shape and size.'],
        ['airbrush', 'Airbrush', 'Draws using an airbrush of the selected size.'],
        ['text', 'Text', 'Inserts text into the picture.'],
        ['line', 'Line', 'Draws a straight line with the selected line width.'],
        ['curve', 'Curve', 'Draws a curved line with the selected line width.'],
        ['rect', 'Rectangle', 'Draws a rectangle with the selected fill style.'],
        ['polygon', 'Polygon', 'Draws a polygon with the selected fill style.'],
        ['ellipse', 'Ellipse', 'Draws an ellipse with the selected fill style.'],
        ['roundrect', 'Rounded Rectangle', 'Draws a rounded rectangle with the selected fill style.'],
        ['move', 'Move', 'Moves the current layer, or the selection.'],
        ['gradient', 'Gradient', 'Fills the selection or the layer with a gradient from the drawing color to the background color.'],
        ['wand', 'Magic Wand', 'Selects the area of a similar color.'],
        ['clone', 'Clone Stamp', 'Paints a copy of another part of the picture. Right-click sets the source.'],
        ['blur', 'Blur', 'Softens the picture under the brush.'],
        ['ellipseselect', 'Elliptical Select', 'Selects an elliptical part of the picture. Shift adds, Alt subtracts.'],
        ['polylasso', 'Polygonal Lasso', 'Selects a part of the picture with straight edges. Double-click closes it.'],
        ['crop', 'Crop', 'Drag the part of the picture to keep, then press Enter.'],
        ['hand', 'Hand', 'Scrolls the picture. Hold Space with any tool.'],
        ['heal', 'Spot Healing Brush', 'Paints over a spot to blend it away with the picture around it.'],
        ['smudge', 'Smudge', 'Smears the picture under the brush.'],
        ['dodge', 'Dodge', 'Lightens the picture under the brush.'],
        ['burn', 'Burn', 'Darkens the picture under the brush.'],
        ['sponge', 'Sponge', 'Saturates the colors under the brush; right-drag desaturates.'],
        ['vtext', 'Vertical Type', 'Inserts text written top to bottom.'],
        ['textmask', 'Horizontal Type Mask', 'Makes a selection in the shape of the text you type.'],
        ['vtextmask', 'Vertical Type Mask', 'Makes a selection in the shape of vertical text.'],
        ['pen', 'Pen', 'Click to add corners, drag for curves; click the first point to close. Ctrl drags a point.'],
        ['pathselect', 'Path Selection', 'Drags a whole path or subpath.'],
        ['directselect', 'Direct Selection', 'Drags one anchor point or handle of a path.']
    ];
    const PATH_TOOLS = new Set(['pen', 'pathselect', 'directselect']);
    const VECTOR_BAR = new Set(['pen', 'pathselect', 'directselect', 'rect', 'ellipse', 'roundrect', 'line', 'move']);
    // Photoshop's tool keys; Shift with the key steps through its group
    const TOOL_KEYS = {
        v: ['move'], m: ['select', 'ellipseselect'], l: ['freeselect', 'polylasso'], w: ['wand'], c: ['crop'], i: ['picker'],
        j: ['heal'], b: ['brush', 'pencil', 'airbrush'], s: ['clone'], e: ['eraser'], g: ['gradient', 'fill'], t: ['text', 'vtext', 'textmask', 'vtextmask'],
        u: ['rect', 'roundrect', 'ellipse', 'polygon', 'line', 'curve'], z: ['magnifier'], h: ['hand'], o: ['dodge', 'burn', 'sponge'], r: ['blur', 'smudge'],
        p: ['pen'], a: ['pathselect', 'directselect']
    };
    // tools that paint with a round dab of their own size (the Size box, else this many pixels)
    const DAB_TOOLS = { clone: 15, blur: 20, smudge: 20, dodge: 30, burn: 30, sponge: 30, heal: 20 };
    const OUTLINE_TOOLS = new Set(['brush', 'eraser', 'airbrush', 'clone', 'blur', 'smudge', 'dodge', 'burn', 'sponge', 'heal']);
    const SELECT_TOOLS = new Set(['select', 'freeselect', 'ellipseselect', 'polylasso', 'wand', 'move']);
    const P = () => root.paintPro;
    // tools whose points snap to guides and the picture's edges (View > Snap)
    const SNAP_TOOLS = new Set(['select', 'ellipseselect', 'polylasso', 'crop', 'rect', 'ellipse', 'roundrect', 'line', 'gradient', 'text', 'polygon', 'pen']);
    const RULER = 17;
    const DEFAULT_STATUS = 'For Help, click Help Topics on the Help Menu.';
    let windowCount = 0;

    function esc(v) {
        return String(v == null ? '' : v).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    }

    function reg(name, def) {
        const r = root.melatonRegistry;
        return r ? r.get(KEY, name, def) : def;
    }

    function setReg(values) {
        const r = root.melatonRegistry;
        if (r) void r.set(KEY, values);
    }

    function vfs() {
        return root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
    }

    function callGlobal(name, ...args) {
        const fn = root[name];
        return typeof fn === 'function' ? fn(...args) : undefined;
    }

    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).split(',')[1] || '');
            r.onerror = reject;
            r.readAsDataURL(blob);
        });
    }

    function loadImage(src) {
        return new Promise((resolve, reject) => {
            const img = new Image();
            img.crossOrigin = 'anonymous';
            img.onload = () => resolve(img);
            img.onerror = () => reject(new Error('The picture could not be read.'));
            img.src = src;
        });
    }

    /** Bytes as Explorer writes them: 512 bytes, 12.4 KB, 3.21 MB. */
    function sizeText(n) {
        if (n < 1024) return `${n} bytes`;
        const units = ['KB', 'MB', 'GB'];
        let v = n / 1024;
        let u = 0;
        while (v >= 1000 && u < units.length - 1) { v /= 1024; u += 1; }
        return `${v >= 100 ? Math.floor(v) : v >= 10 ? Math.floor(v * 10) / 10 : Math.floor(v * 100) / 100} ${units[u]}`;
    }

    function hex(c) {
        const [r, g, b] = C().parseColor(c);
        return `#${[r, g, b].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
    }

    class PaintWindow {
        constructor(opts = {}) {
            windowCount += 1;
            this.n = windowCount;
            this.fg = '#000000';
            this.bg = '#ffffff';
            this.tool = 'pencil';
            this.prevTool = 'pencil';
            this.zoom = 1;
            this.opt = {
                lineWidth: 1, brush: 'round-2', eraser: 8, airbrush: 0, shape: 'outline', transparent: false,
                zoomLevel: 4, size: 0, opacity: 100, penMode: 'path', shapeMode: 'pixels', hardness: 100, tolerance: 32, antialias: true, gradient: 'linear',
                selMode: 'new', contiguous: true, sampleAll: false, showControls: true, keepRatio: true,
                // Photoshop's options bar (paintBar.js)
                feather: 0, selStyle: 'normal', selW: 1, selH: 1, autoSelect: false, cropRatio: 'free', cropSwap: false,
                paintMode: 'normal', gradReverse: false, radius: 16, cloneAligned: true, toneRange: 'midtones',
                spongeMode: 'saturate', sampleSize: '1', zoomOut: false
            };
            this.grid = false;
            // Photoshop's View options: rulers, guides (shown, locked), snapping
            this.rulers = !!reg('Rulers', false);
            this.guidesShown = true;
            this.guidesLocked = false;
            this.snapOn = true;
            this.name = opts.name || 'Untitled';
            this.file = opts.file || null;
            this.dirtyDoc = false;
            this.floating = null;
            this.build();
            this.newDocument(reg('LastWidth', 800), reg('LastHeight', 600), { silent: true });
            if (opts.vfsFile) void this.openVfsFile(opts.vfsFile.id, opts.vfsFile.name, opts.vfsFile.path);
            else if (opts.image) void this.openUrl(opts.image, opts.name, opts.file);
        }

        // ---- window ---------------------------------------------------------------------------

        build() {
            const m = doc.createElement('div');
            m.id = `melatonPaintModal_${this.n}`;
            m.className = 'modal hidden resizeable-window mp-window';
            m.dataset.windowIdentifier = 'melatonPaint';
            m.dataset.windowClient = 'light';
            m.dataset.windowDefaultWidth = '900';
            m.dataset.windowDefaultHeight = '680';
            m.dataset.windowMinWidth = '420';
            m.dataset.windowMinHeight = '320';
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="/static_images/app_icons/24/vista-paint.webp" alt=""><span class="mp-title">Untitled - Paint</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize"><i class="fa-regular fa-window-maximize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small mp-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 mp-client">
                    <div class="naxt-menubar mp-menubar" role="menubar">${['File', 'Edit', 'View', 'Image', 'Layers', 'Select', 'Adjustments', 'Filter', 'Colors', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-mp-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="mp-settings" role="toolbar" aria-label="Options"></div>
                    <div class="mp-body">
                        <div class="mp-toolbox">
                            <div class="mp-tools" role="toolbar">${TOOLS.map(([id, name], i) => `<button type="button" class="mp-tool${id === this.tool ? ' is-on' : ''}" data-tool="${id}" title="${esc(name)}" style="--i:${i < 16 ? i : i - 16}"><span class="mp-tool-art${i >= 16 ? ' is-extra' : ''}"></span></button>`).join('')}</div>
                            <div class="mp-options"></div>
                        </div>
                        <div class="mp-viewport">
                        <div class="mp-ruler-corner"></div><canvas class="mp-ruler is-h"></canvas><canvas class="mp-ruler is-v"></canvas>
                        <div class="mp-workspace" tabindex="-1">
                            <div class="mp-stage">
                                <canvas class="mp-view"></canvas>
                                <canvas class="mp-overlay"></canvas>
                                <div class="mp-grid"></div>
                                <svg class="mp-ants" aria-hidden="true"></svg>
                                <span class="mp-handle is-e"></span><span class="mp-handle is-s"></span><span class="mp-handle is-se"></span>
                                <span class="mp-brushcur" hidden></span>
                            </div>
                        </div>
                        </div>
                        <div class="mp-dock-split" title="Drag to resize the panels"></div>
                        <div class="mp-dock"></div>
                    </div>
                    <div class="mp-colorbox"></div>
                    <div class="mp-status"><span class="mp-status-text">${DEFAULT_STATUS}</span><span class="mp-status-pos"></span><span class="mp-status-size"></span></div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            this.el = (s) => m.querySelector(s);
            this.view = this.el('.mp-view');
            this.vctx = this.view.getContext('2d');
            this.overlay = this.el('.mp-overlay');
            this.octx = this.overlay.getContext('2d');
            this.stage = this.el('.mp-stage');
            this.workspace = this.el('.mp-workspace');
            this.ants = this.el('.mp-ants');
            this.checker = this.makeChecker();
            if (root.paintColor) root.paintColor.mount(this);
            this.wire();
            m.dataset.tool = this.tool;
            this.renderOptions();
            this.renderBar();
            this.renderColors();
            callGlobal('openModal', m);
            m.classList.remove('hidden');
        }

        makeChecker() {
            const c = C().makeCanvas(16, 16);
            const x = c.getContext('2d');
            x.fillStyle = '#ffffff'; x.fillRect(0, 0, 16, 16);
            x.fillStyle = '#cccccc'; x.fillRect(0, 0, 8, 8); x.fillRect(8, 8, 8, 8);
            return this.vctx.createPattern(c, 'repeat');
        }

        title() {
            const t = `${this.name}${this.doc && this.doc.quickMask ? ' (Quick Mask)' : ''} - Paint`;
            this.el('.mp-title').textContent = t;
            this.modal.setAttribute('aria-label', t);
        }

        status(text) {
            this.el('.mp-status-text').textContent = text || DEFAULT_STATUS;
        }

        // ---- document -------------------------------------------------------------------------

        newDocument(w, h, opts = {}) {
            if (this.unsub) this.unsub();
            this.commitFloating();
            this.doc = new (C().Document)(w, h, { background: opts.background || '#ffffff', transparent: opts.transparent === true });
            this.unsub = this.doc.on((kind) => {
                if (kind === 'dirty') { this.schedule(); this.moveBoxStale = true; }
                if (kind === 'resize') this.layout();
                if (kind === 'changed') { this.dirtyDoc = true; }
                if (kind === 'paths' && root.paintPath) { root.paintPath.refreshPanel(this); this.drawAnts(); }
                // a shape layer's Fill and Stroke sit in the shape tools' bar
                if (kind === 'layers' && VECTOR_BAR.has(this.tool)) { this.renderBar(); if (root.paintPath) root.paintPath.refreshPanel(this); }
                if (kind === 'layers' || kind === 'history') {
                    this.emitPanels();
                    // the Move tool's box follows undo, redo and another layer
                    if (this.tool === 'move') { this.moveBoxStale = true; this.drawAnts(); }
                }
            });
            this.layout();
            this.doc.markDirty();
            if (!opts.silent) this.name = 'Untitled';
            this.file = opts.file || (opts.silent ? this.file : null);
            this.dirtyDoc = false;
            this.title();
            this.emitPanels();
        }

        emitPanels() {
            if (root.paintLayers) root.paintLayers.refresh(this);
        }

        layout() {
            const d = this.doc;
            this.view.width = d.width;
            this.view.height = d.height;
            this.overlay.width = d.width;
            this.overlay.height = d.height;
            this.applyZoom();
            this.doc.markDirty();
            this.sizeStatus();
        }

        applyZoom() {
            const d = this.doc;
            const w = Math.round(d.width * this.zoom);
            const h = Math.round(d.height * this.zoom);
            this.stage.style.width = `${w}px`;
            this.stage.style.height = `${h}px`;
            this.modal.classList.toggle('mp-pixelated', this.zoom >= 2);
            const grid = this.el('.mp-grid');
            grid.hidden = !(this.grid && this.zoom >= 4);
            grid.style.backgroundSize = `${this.zoom}px ${this.zoom}px`;
            this.drawAnts();
        }

        setZoom(z, at) {
            const old = this.zoom;
            this.zoom = Math.max(0.125, Math.min(8, z));
            this.applyZoom();
            if (at) {
                // keep the clicked pixel under the pointer
                const ws = this.workspace;
                ws.scrollLeft = at.x * this.zoom - (at.cx || ws.clientWidth / 2);
                ws.scrollTop = at.y * this.zoom - (at.cy || ws.clientHeight / 2);
            }
            if (old !== this.zoom) this.status(`Zoom: ${Math.round(this.zoom * 100)}%`);
            this.drawXf();
            if (P()) P().navBox(this);
            this.drawRulers();
        }

        // ---- rulers, guides, snapping (Photoshop's View menu) --------------------------------------

        /** Where picture x / y 0 is in the workspace's own pixels. */
        stageOrigin() {
            const ws = this.workspace.getBoundingClientRect();
            const st = this.stage.getBoundingClientRect();
            return { x: st.left - ws.left, y: st.top - ws.top };
        }

        /** The rulers: pixels at the zoom, ticks every 1/2/5 x 10^n, the pointer marked. */
        drawRulers() {
            if (!this.rulers) return;
            const o = this.stageOrigin();
            const z = this.zoom;
            const steps = [1, 2, 5, 10, 20, 25, 50, 100, 200, 250, 500, 1000, 2000, 5000, 10000];
            const major = steps.find((v) => v * z >= 50) || 10000;
            let minor = major / (String(major).startsWith('25') ? 5 : 10);
            if (minor * z < 4) minor = major / 2;
            const draw = (canvas, horizontal) => {
                const len = horizontal ? this.workspace.clientWidth : this.workspace.clientHeight;
                const dpr = root.devicePixelRatio || 1;
                const W = horizontal ? len : RULER;
                const H = horizontal ? RULER : len;
                canvas.width = Math.round(W * dpr);
                canvas.height = Math.round(H * dpr);
                canvas.style.width = `${W}px`;
                canvas.style.height = `${H}px`;
                const x = canvas.getContext('2d');
                x.setTransform(dpr, 0, 0, dpr, 0, 0);
                x.fillStyle = '#fff';
                x.fillRect(0, 0, W, H);
                x.fillStyle = '#000';
                x.font = '9px Tahoma, sans-serif';
                x.textBaseline = 'top';
                // a tick across the ruler at `at`, `size` long from its inner edge
                const tick = (at, size) => (horizontal ? x.fillRect(at, RULER - size, 1, size) : x.fillRect(RULER - size, at, size, 1));
                const off = horizontal ? o.x : o.y;
                const from = Math.floor(-off / z / minor) * minor;
                const to = (len - off) / z;
                for (let v = from; v <= to; v += minor) {
                    const at = Math.floor(off + v * z);
                    const isMajor = Math.abs(v / major - Math.round(v / major)) < 1e-6;
                    tick(at, isMajor ? RULER : (Math.abs((v * 2) / major - Math.round((v * 2) / major)) < 1e-6 ? 7 : 4));
                    if (!isMajor) continue;
                    const label = String(Math.round(v));
                    if (horizontal) x.fillText(label, at + 2, 1);
                    // the vertical ruler stacks its digits (Photoshop)
                    else label.split('').forEach((ch, k) => x.fillText(ch, 2, at + 2 + k * 9));
                }
                x.fillStyle = '#a0a0a0';
                if (horizontal) x.fillRect(0, RULER - 1, W, 1); else x.fillRect(RULER - 1, 0, 1, H);
                const lp = this.lastPointer;
                if (lp) {
                    x.fillStyle = '#000';
                    const at = Math.floor(off + (horizontal ? lp.x : lp.y) * z);
                    for (let k = 0; k < RULER; k += 2) (horizontal ? x.fillRect(at, k, 1, 1) : x.fillRect(k, at, 1, 1));
                }
            };
            draw(this.el('.mp-ruler.is-h'), true);
            draw(this.el('.mp-ruler.is-v'), false);
        }

        toggleRulers() {
            this.rulers = !this.rulers;
            setReg({ Rulers: this.rulers });
            this.modal.classList.toggle('mp-rulers', this.rulers);
            this.drawRulers();
        }

        /** Drag out of a ruler: a new guide, dropped on the picture's window. */
        rulerDrag(ev, axis) {
            if (!this.guidesShown) this.guidesShown = true;
            ev.preventDefault();
            const rc = ev.currentTarget;
            rc.setPointerCapture(ev.pointerId);
            const g = { axis, pos: 0 };
            this.doc.guides.push(g);
            const place = (e) => {
                const p = this.docPoint(e);
                g.pos = Math.round(axis === 'h' ? p.y : p.x);
                this.drawAnts();
                this.status(`${axis === 'h' ? 'Y' : 'X'}: ${g.pos} px`);
            };
            place(ev);
            const move = (e) => place(e);
            const up = (e) => {
                rc.removeEventListener('pointermove', move);
                rc.removeEventListener('pointerup', up);
                const r = this.workspace.getBoundingClientRect();
                const inside = e.clientX >= r.left && e.clientY >= r.top && e.clientX <= r.right && e.clientY <= r.bottom;
                if (!inside) this.doc.guides.splice(this.doc.guides.indexOf(g), 1);
                this.drawAnts();
                this.status();
            };
            rc.addEventListener('pointermove', move);
            rc.addEventListener('pointerup', up);
        }

        /** The guide within a few screen pixels of p, or -1. */
        guideAt(p) {
            const tol = 4 / this.zoom;
            return this.doc.guides.findIndex((g) => Math.abs((g.axis === 'h' ? p.y : p.x) - g.pos) <= tol);
        }

        /** View > Snap: points within 6 screen pixels of a guide or the picture's edge go to it. */
        snapPoint(p) {
            const tol = 6 / this.zoom;
            const xs = [0, this.doc.width];
            const ys = [0, this.doc.height];
            if (this.guidesShown) this.doc.guides.forEach((g) => (g.axis === 'h' ? ys : xs).push(g.pos));
            const near = (v, list) => list.reduce((best, c) => (Math.abs(c - v) <= tol && (best === null || Math.abs(c - v) < Math.abs(best - v)) ? c : best), null);
            const x = near(p.x, xs);
            const y = near(p.y, ys);
            return { x: x === null ? p.x : x, y: y === null ? p.y : y };
        }

        /** View > New Guide: a guide at an exact place. */
        newGuideDialog() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const tpl = { t: 'New Guide', w: 170, h: 82, f: ['MS Shell Dlg', 8], c: [
                [-1, 'B', 7, 7, 100, 42, 0x50000007, 'Orientation', 0],
                [101, 'B', 14, 19, 80, 10, 0x50030009, '&Horizontal', 0],
                [102, 'B', 14, 32, 80, 10, 0x50010009, '&Vertical', 0],
                [-1, 'S', 7, 58, 34, 8, 0x50020000, '&Position:', 0],
                [103, 'E', 44, 56, 40, 12, 0x50812080, '0', 0],
                [-1, 'S', 87, 58, 14, 8, 0x50020000, 'px', 0],
                [1, 'B', 113, 7, 50, 14, 0x50010001, 'OK', 0],
                [2, 'B', 113, 25, 50, 14, 0x50010000, 'Cancel', 0]
            ] };
            V.openDialog({
                id: 'mpNewGuide', tpl, owner: this.modal,
                init: (ctx) => { ctx.set(102, true); },
                ok: (ctx) => {
                    const axis = ctx.get(101) ? 'h' : 'v';
                    const pos = Math.round(Number(ctx.get(103)) || 0);
                    this.doc.guides.push({ axis, pos });
                    this.guidesShown = true;
                    this.drawAnts();
                }
            });
        }

        /**
         * Quick Mask (Q): the selection becomes a picture to paint, white selected and black not,
         * shown as Photoshop's red film over what is not selected; Q again turns it back.
         */
        toggleQuickMask() {
            const d = this.doc;
            const P0 = P();
            if (!P0) return;
            this.finishText();
            this.commitFloating();
            const W = d.width;
            const H = d.height;
            if (!d.quickMask) {
                const canvas = C().makeCanvas(W, H);
                const ctx = canvas.getContext('2d', { willReadFrequently: true });
                const img = ctx.createImageData(W, H);
                const m = d.selection ? P0.maskOf(d, d.selection) : null;
                for (let i = 0; i < W * H; i += 1) {
                    const v = m ? m[i] : 0;
                    img.data[i * 4] = v; img.data[i * 4 + 1] = v; img.data[i * 4 + 2] = v; img.data[i * 4 + 3] = 255;
                }
                ctx.putImageData(img, 0, 0);
                // nothing selected: nothing is masked yet (Photoshop's film starts clear)
                if (!m) { ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H); }
                const target = { isMask: true, isQuick: true, owner: null, canvas, ctx, id: 'qm', name: 'Quick Mask', locked: false, visible: true, opacity: 1, blend: 'normal' };
                d.quickMask = { canvas, ctx, target };
                this.setSelection(null);
                this.status('Quick Mask: paint black to mask, white to select. Press Q to turn it into a selection.');
            } else {
                const a = d.quickMask.ctx.getImageData(0, 0, W, H).data;
                const m = new Uint8Array(W * H);
                for (let i = 0; i < m.length; i += 1) m[i] = Math.round(0.299 * a[i * 4] + 0.587 * a[i * 4 + 1] + 0.114 * a[i * 4 + 2]);
                d.quickMask = null;
                const all = m.every((v) => v === 255);
                this.setSelection(all ? { x: 0, y: 0, w: W, h: H } : P0.fromMask(m, W, H));
                this.status();
            }
            d.markDirty();
            this.title();
            this.schedule();
            if (root.paintLayers) root.paintLayers.refresh(this);
        }

        /** The red film over the masked parts of rect (the stroke being painted included). */
        drawQuickMask(r) {
            const qm = this.doc.quickMask;
            const c = C().makeCanvas(r.w, r.h);
            const x = c.getContext('2d', { willReadFrequently: true });
            x.drawImage(qm.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
            const o = this.strokeOverlay;
            if (o) {
                x.globalAlpha = o.alpha === undefined ? 1 : o.alpha;
                x.globalCompositeOperation = o.erase ? 'destination-out' : 'source-over';
                x.drawImage(o.canvas, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
            }
            const img = x.getImageData(0, 0, r.w, r.h);
            const p = img.data;
            for (let i = 0; i < p.length; i += 4) {
                const v = (0.299 * p[i] + 0.587 * p[i + 1] + 0.114 * p[i + 2]) * (p[i + 3] / 255);
                p[i] = 255; p[i + 1] = 0; p[i + 2] = 0; p[i + 3] = Math.round((255 - v) * 0.5);
            }
            x.putImageData(img, 0, 0);
            this.vctx.drawImage(c, r.x, r.y);
        }

        /** View > Fit on Screen (Ctrl+0): the whole picture in the window. */
        fitZoom() {
            const ws = this.workspace;
            const z = Math.min((ws.clientWidth - 20) / this.doc.width, (ws.clientHeight - 20) / this.doc.height);
            // Photoshop's steps: whole percentages under 100, else the fit itself
            this.setZoom(Math.max(0.125, Math.min(8, z >= 1 ? Math.floor(z * 100) / 100 : Math.floor(z * 100) / 100)));
            ws.scrollLeft = 0;
            ws.scrollTop = 0;
        }

        schedule() {
            if (this.raf) return;
            this.raf = requestAnimationFrame(() => {
                this.raf = 0;
                const r = this.doc.takeDirty();
                const qm = this.doc.quickMask;
                if (r) this.doc.composite(this.vctx, r, { checker: this.checker, overlay: qm ? null : this.strokeOverlay || null });
                if (r && qm) this.drawQuickMask(r);
                if (root.paintLayers) root.paintLayers.thumbs(this);
                if (P()) P().navRefresh(this);
            });
        }

        // ---- input ----------------------------------------------------------------------------

        docPoint(ev) {
            const r = this.view.getBoundingClientRect();
            return { x: (ev.clientX - r.left) / this.zoom, y: (ev.clientY - r.top) / this.zoom };
        }

        wire() {
            const m = this.modal;
            m.querySelector('.mp-close').addEventListener('click', () => void this.close());
            m.querySelectorAll('[data-mp-menu]').forEach((title) => {
                root.contextMenu.attachClickMenuToElement(title, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (section) => { section.items = this.menu(title.dataset.mpMenu); } }]
                });
            });
            m.querySelector('.mp-tools').addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-tool]');
                if (b) this.setTool(b.dataset.tool);
            });
            m.querySelector('.mp-tools').addEventListener('mouseover', (ev) => {
                const b = ev.target.closest('[data-tool]');
                if (b) this.status((TOOLS.find((t) => t[0] === b.dataset.tool) || [])[2]);
            });
            m.querySelector('.mp-tools').addEventListener('mouseleave', () => this.status());
            m.querySelector('.mp-options').addEventListener('click', (ev) => {
                const o = ev.target.closest('[data-opt]');
                if (!o) return;
                const v = o.dataset.value;
                this.opt[o.dataset.opt] = /^\d+$/.test(v) ? Number(v) : v === 'true' ? true : v === 'false' ? false : v;
                if (o.dataset.opt === 'zoomLevel') this.setZoom(Number(v));
                if (o.dataset.opt === 'brush' && root.paintBrush) {
                    const sh = String(v).split('-')[0];
                    if (sh === 'round' || sh === 'square') root.paintBrush.choose(this, { ...root.paintBrush.PRESETS.find((x) => x.id === (sh === 'square' ? 'square' : 'hard')), hardness: this.opt.hardness });
                }
                this.renderOptions();
            });
            const view = this.overlay;
            view.addEventListener('pointerdown', (ev) => this.pointer('down', ev));
            view.addEventListener('pointermove', (ev) => this.pointer('move', ev));
            view.addEventListener('pointerup', (ev) => this.pointer('up', ev));
            view.addEventListener('pointercancel', (ev) => this.pointer('up', ev));
            view.addEventListener('dblclick', (ev) => this.pointer('dbl', ev));
            view.addEventListener('contextmenu', (ev) => ev.preventDefault());
            view.addEventListener('pointerleave', () => {
                this.el('.mp-status-pos').textContent = '';
                this.el('.mp-brushcur').hidden = true;
                if (P()) P().info(this, null);
            });
            this.workspace.addEventListener('wheel', (ev) => {
                // Ctrl+wheel (Vista) or Alt+wheel (Photoshop) zooms round the pointer
                if (!ev.ctrlKey && !ev.altKey) return;
                ev.preventDefault();
                const p = this.docPoint(ev);
                const r = this.workspace.getBoundingClientRect();
                this.setZoom(this.zoom * (ev.deltaY < 0 ? 2 : 0.5), { x: p.x, y: p.y, cx: ev.clientX - r.left, cy: ev.clientY - r.top });
            }, { passive: false });
            m.addEventListener('keydown', (ev) => this.key(ev));
            this.workspace.addEventListener('scroll', () => this.drawRulers(), { passive: true });
            // the panels' width: drag the divider (kept in the registry, DockWidth)
            const dock = m.querySelector('.mp-dock');
            const dw = Number(reg('DockWidth', 200));
            if (dw) dock.style.flexBasis = `${dw}px`;
            m.querySelector('.mp-dock-split').addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                const sp = ev.currentTarget;
                sp.setPointerCapture(ev.pointerId);
                const x0 = ev.clientX;
                const w0 = dock.getBoundingClientRect().width;
                const max = Math.max(200, m.querySelector('.mp-body').getBoundingClientRect().width - 260);
                const move = (e) => {
                    const w = Math.round(Math.max(150, Math.min(max, w0 + (x0 - e.clientX))));
                    dock.style.flexBasis = `${w}px`;
                    this.drawRulers();
                    if (P()) P().navRefresh(this, true);
                };
                const up = () => {
                    sp.removeEventListener('pointermove', move);
                    sp.removeEventListener('pointerup', up);
                    setReg({ DockWidth: Math.round(dock.getBoundingClientRect().width) });
                };
                sp.addEventListener('pointermove', move);
                sp.addEventListener('pointerup', up);
            });
            if (root.ResizeObserver) new ResizeObserver(() => this.drawRulers()).observe(this.workspace);
            m.querySelectorAll('.mp-ruler').forEach((rc) => rc.addEventListener('pointerdown', (ev) => this.rulerDrag(ev, rc.classList.contains('is-h') ? 'h' : 'v')));
            m.classList.toggle('mp-rulers', this.rulers);
            m.addEventListener('keyup', (ev) => {
                if (ev.key === ' ' && this.spaceHand) { this.spaceHand = false; this.overlay.dataset.hand = ''; }
            });
            // the canvas resize handles: drag to change the picture's size (Vista)
            m.querySelectorAll('.mp-handle').forEach((h) => h.addEventListener('pointerdown', (ev) => this.resizeDrag(ev, h)));
            m.addEventListener('paste', (ev) => {
                const item = Array.from((ev.clipboardData && ev.clipboardData.items) || []).find((i) => i.type.startsWith('image/'));
                if (!item) return;
                ev.preventDefault();
                void this.pasteBlob(item.getAsFile());
            });
        }

        pointer(kind, ev) {
            const snap = (q) => (this.snapOn && SNAP_TOOLS.has(this.tool) && !this.xf ? this.snapPoint(q) : q);
            const p = snap(this.docPoint(ev));
            // the Move tool drags a guide it is over (Photoshop); off the picture onto a ruler deletes it
            if (kind === 'down' && !this.xf && this.tool === 'move' && this.guidesShown && !this.guidesLocked && ev.button === 0) {
                const g = this.guideAt(p);
                if (g >= 0) { this.guideDrag = { i: g }; this.overlay.setPointerCapture(ev.pointerId); this.down = true; return; }
            }
            if (kind === 'down' && !this.xf && this.tool === 'move' && this.opt.showControls && ev.button === 0 && !this.spaceHand) {
                const h = this.moveHandleAt(p);
                if (h) {
                    this.startTransform();
                    if (this.xf) {
                        this.overlay.setPointerCapture(ev.pointerId);
                        this.down = true;
                        this.right = false;
                        this.xfDrag = { hit: { kind: 'scale', sx: h.sx, sy: h.sy }, start: p, from: { ...this.xf } };
                        return;
                    }
                }
            }
            if (kind === 'move' && !this.down && !this.xf && this.tool === 'move' && this.opt.showControls) {
                const h = this.moveHandleAt(p);
                if (h) { this.overlay.style.cursor = this.handleCursor(h.sx, h.sy); return; }
            }
            if (this.guideDrag) {
                const g = this.doc.guides[this.guideDrag.i];
                if (kind === 'move' && g) { g.pos = Math.round(g.axis === 'h' ? p.y : p.x); this.drawAnts(); this.status(`${g.axis === 'h' ? 'Y' : 'X'}: ${g.pos} px`); }
                if (kind === 'up') {
                    this.down = false;
                    const r = this.workspace.getBoundingClientRect();
                    if (g && (ev.clientX < r.left || ev.clientY < r.top)) this.doc.guides.splice(this.guideDrag.i, 1);
                    this.guideDrag = null;
                    this.drawAnts();
                    this.status();
                }
                return;
            }
            if (kind === 'move' && this.tool === 'move' && !this.down && !this.xf) {
                this.overlay.style.cursor = this.guidesShown && !this.guidesLocked && this.guideAt(p) >= 0
                    ? (this.doc.guides[this.guideAt(p)].axis === 'h' ? 'ns-resize' : 'ew-resize') : '';
            }
            if (kind === 'move') {
                this.el('.mp-status-pos').textContent = p.x >= 0 && p.y >= 0 && p.x < this.doc.width && p.y < this.doc.height ? `${Math.floor(p.x)},${Math.floor(p.y)}` : '';
                this.brushCursor(p);
                if (P()) P().info(this, p);
                if (this.rulers) this.drawRulers();
            }
            // Free Transform takes the pointer from every tool; Space pans (Photoshop)
            const t = this.xf ? this.tools.xform : (this.spaceHand || this.handDrag) && kind !== 'dbl' ? this.tools.hand : this.tools[this.tool];
            if (!t) return;
            if (kind === 'down') {
                if (ev.button !== 0 && ev.button !== 2) return;
                this.overlay.setPointerCapture(ev.pointerId);
                this.right = ev.button === 2;
                this.down = true;
                this.modal.focus();
                if (t.down) t.down.call(this, p, ev);
            } else if (kind === 'move') {
                const events = this.down && ev.getCoalescedEvents ? ev.getCoalescedEvents() : [ev];
                if (t.move) events.forEach((e) => t.move.call(this, snap(this.docPoint(e)), e, this.down));
            } else if (kind === 'up') {
                if (!this.down) return;
                this.down = false;
                if (t.up) t.up.call(this, p, ev);
            } else if (kind === 'dbl' && t.dbl) t.dbl.call(this, p, ev);
        }

        key(ev) {
            if (ev.target.closest('.mp-textbox, input, select, textarea')) return;
            const ctrl = ev.ctrlKey || ev.metaKey;
            const shift = ev.shiftKey;
            const alt = ev.altKey;
            const k = ev.key.toLowerCase();
            let action = null;
            if (ctrl) {
                const code = ev.code;
                if (ev.key === 'Enter' && !shift && !alt) action = 'path-select';
                else if (shift && alt && k === 'l') action = 'adj-autolevel';
                else if (alt && !shift && k === 'f') action = 'pro-last-filter';
                else if (alt && !shift && k === 'c') action = 'attributes';
                else if (alt && !shift && k === 'i') action = 'stretch';
                else if (alt && !shift && k === 'z') action = 'undo';
                else if (alt && !shift && k === 'r') action = 'flip';
                else if (alt && !shift && k === 'g') action = 'layer-clip';
                else if (alt && !shift && k === ';') action = 'guides-lock';
                else if (alt) action = null;
                else if (shift) {
                    action = {
                        n: 'layer-add', d: 'pro-reselect', i: 'pro-inverse', z: 'redo', j: 'layer-via-cut', e: 'layer-flatten',
                        f: 'layer-flatten', u: 'adj-bw', g: 'group-ungroup', l: 'pro-auto-tone', b: 'pro-auto-color', delete: 'layer-delete', ';': 'snap', ':': 'snap'
                    }[k] || null;
                } else {
                    action = {
                        n: 'new', o: 'open', s: 'save', p: 'print', z: 'undo', y: 'redo', x: 'cut', c: 'copy', v: 'paste',
                        a: 'select-all', d: 'pro-deselect', t: 'free-transform', r: 'rulers', w: 'stretch', i: 'invert', g: 'group-new', "'": 'grid', ';': 'guides-show', f: 'view-bitmap',
                        j: 'layer-via-copy', e: 'layer-merge', l: 'pro-levels', m: 'pro-curves', u: 'adj-hue', b: 'pro-color-balance',
                        0: 'zoom-fit', 1: 'zoom-actual', '=': 'zoom-in', '+': 'zoom-in', '-': 'zoom-out'
                    }[k] || null;
                    if (!action && code === 'Digit0') action = 'zoom-fit';
                    if (!action && code === 'Digit1') action = 'zoom-actual';
                    if (ev.key === 'PageUp') action = 'zoom-normal';
                    else if (ev.key === 'PageDown') action = 'zoom-large';
                    else if (ev.key === 'Backspace') action = 'fill-bg';
                }
            } else if (alt) {
                if (ev.key === 'Backspace' || ev.key === 'Delete') action = 'fill-fg';
            } else if (ev.key === 'F4') action = 'layer-properties';
            else if (ev.key === 'F7') action = 'layers';
            else if (ev.key === 'F8') action = 'history';
            else if (ev.key === 'F6' && shift) action = 'pro-sel-feather';
            else if (ev.key === 'F5' && shift) action = 'pro-fill';
            else if (ev.key === 'F5' && !ctrl && !alt) action = 'brushes';
            else if (ev.key === 'Backspace' && shift) action = 'pro-fill';
            else if (ev.key === 'Delete' || ev.key === 'Backspace') action = 'delete';
            else if (ev.key === 'Escape') action = 'escape';
            else if (ev.key === 'Enter') action = 'enter';
            else if (ev.key === ' ') {
                ev.preventDefault();
                if (!this.spaceHand && !this.down) { this.spaceHand = true; this.overlay.dataset.hand = '1'; }
                return;
            } else if (ev.key === '[' || ev.key === ']') {
                const cur = this.opt.size || this.toolDiameter();
                const stepPx = cur < 10 ? 1 : cur < 50 ? 5 : cur < 100 ? 10 : 25;
                this.opt.size = Math.max(1, Math.min(500, cur + (ev.key === ']' ? stepPx : -stepPx)));
                this.syncSettings();
                this.brushCursor(this.lastPointer);
            } else if (ev.key === '{' || ev.key === '}') {
                this.opt.hardness = Math.max(0, Math.min(100, this.opt.hardness + (ev.key === '}' ? 25 : -25)));
                this.updateBar();
            } else if (!ctrl && ev.key === '+') { this.opt.size = Math.min(500, (this.opt.size || this.brushSize()) + 1); this.syncSettings(); }
            else if (!ctrl && ev.key === '-') { this.opt.size = Math.max(1, (this.opt.size || this.brushSize()) - 1); this.syncSettings(); }
            else if (/^[0-9]$/.test(ev.key)) {
                // Photoshop: 1 is 10%, 0 is 100%
                const v = ev.key === '0' ? 100 : Number(ev.key) * 10;
                this.opt.opacity = v;
                this.updateBar();
            } else if (k === 'q' && !shift) action = 'quick-mask';
            else if (k === 'x') action = 'swap-colors';
            else if (k === 'd') action = 'default-colors';
            else if (TOOL_KEYS[k]) {
                const group = TOOL_KEYS[k];
                const at = group.indexOf(this.tool);
                const next = at < 0 ? (group.includes(this.groupLast && this.groupLast[k]) ? this.groupLast[k] : group[0]) : shift ? group[(at + 1) % group.length] : group[at];
                this.groupLast = { ...(this.groupLast || {}), [k]: next };
                ev.preventDefault();
                this.setTool(next);
                return;
            }
            if (!action) return;
            ev.preventDefault();
            void this.action(action);
        }

        syncSettings() {
            this.updateBar();
        }

        /** The options bar for the tool (or the transform / crop under way): paintBar.js. */
        renderBar() {
            if (root.paintBar) root.paintBar.render(this);
        }

        updateBar() {
            if (root.paintBar) root.paintBar.update(this);
        }

        setSelMode(mode) {
            this.opt.selMode = mode;
            this.updateBar();
        }

        /** The options bar's font controls: the registry's text settings, and the box being typed in. */
        setTextFont(values) {
            setReg(values);
            if (values.TextFace && root.paintType) void root.paintType.ensure(values.TextFace).then(() => this.restyleText());
            this.restyleText();
            this.renderBar();
            const bar = this.el('.mp-textbar');
            if (bar && !bar.hidden) this.showTextBar(true);
        }

        /** The options bar's orientation button: horizontal and vertical type swap (the tool, or the text being typed). */
        toggleTextOrientation() {
            const swap = { text: 'vtext', vtext: 'text', textmask: 'vtextmask', vtextmask: 'textmask' };
            if (this.text) {
                this.text.vertical = !this.text.vertical;
                this.restyleText();
            }
            if (swap[this.tool]) {
                const keep = this.text;
                this.tool = swap[this.tool];
                this.modal.querySelectorAll('.mp-tool').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === this.tool));
                this.overlay.dataset.tool = this.tool;
                this.modal.dataset.tool = this.tool;
                this.text = keep;
            }
            this.renderBar();
        }

        /** Esc / the bar's Cancel while typing: the text goes, a type layer opened again stays as it was. */
        cancelText() {
            const t = this.text;
            if (!t) return;
            this.text = null;
            t.box.remove();
            this.showTextBar(false);
            if (t.layer) { t.layer.visible = true; this.doc.markDirty(); }
            this.renderBar();
        }

        /** Shift adds, Alt subtracts, both intersect; else the mode chosen on the Tool Settings bar. */
        selModeFor(ev) {
            if (ev && ev.shiftKey && ev.altKey) return 'intersect';
            if (ev && ev.shiftKey) return 'add';
            if (ev && ev.altKey) return 'subtract';
            return this.opt.selMode;
        }

        /** A new selection shape is done: combine it with the one it started from. */
        finishSelection(next) {
            const base = this.selBase;
            const mode = this.selModeNow;
            this.selBase = null;
            this.selModeNow = null;
            if (base && mode && mode !== 'new' && P()) {
                let add = next && next.w >= 1 && next.h >= 1 ? next : null;
                if (add && this.opt.feather > 0 && ['select', 'ellipseselect', 'freeselect', 'polylasso'].includes(this.tool)) add = P().feather(this.doc, add, this.opt.feather) || add;
                this.setSelection(P().combine(this.doc, base, add, mode));
                return;
            }
            if (next && (next.w < 1 || next.h < 1)) next = null;
            // the options bar's Feather: soft edges for what was just made (Photoshop)
            if (next && this.opt.feather > 0 && P() && ['select', 'ellipseselect', 'freeselect', 'polylasso'].includes(this.tool)) next = P().feather(this.doc, next, this.opt.feather) || next;
            this.setSelection(next);
        }

        /** The size a dab tool paints with. */
        toolDiameter() {
            const d = DAB_TOOLS[this.tool];
            if (d) return this.opt.size > 0 ? this.opt.size : d;
            return this.brushSize();
        }

        /** Photoshop's brush outline: a circle (a square for the eraser) the brush's size. */
        brushCursor(p) {
            if (p) this.lastPointer = p;
            const cur = this.el('.mp-brushcur');
            const at = p || this.lastPointer;
            const size = this.toolDiameter() * this.zoom;
            if (!at || !OUTLINE_TOOLS.has(this.tool) || this.xf || this.spaceHand || size < 6) { cur.hidden = true; return; }
            cur.hidden = false;
            cur.classList.toggle('is-square', this.tool === 'eraser');
            cur.style.width = `${size}px`;
            cur.style.height = `${size}px`;
            cur.style.left = `${at.x * this.zoom - size / 2}px`;
            cur.style.top = `${at.y * this.zoom - size / 2}px`;
        }

        // ---- tools ----------------------------------------------------------------------------

        setTool(id) {
            if (this.tool === id) return;
            if (!(this.text && /text/.test(id) && /text/.test(this.tool))) this.finishText();
            this.cancelShape();
            if (this.xf) this.commitTransform();
            if (this.cropBox && id !== 'crop') { this.cropBox = null; this.drawAnts(); }
            if (!SELECT_TOOLS.has(id)) this.commitFloating();
            if (id === 'picker') this.prevTool = this.tool;
            this.tool = id;
            this.modal.querySelectorAll('.mp-tool').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === id));
            this.overlay.dataset.tool = id;
            this.modal.dataset.tool = id;
            this.renderOptions();
            this.renderBar();
            this.brushCursor();
            this.drawAnts();
        }

        /** What the Move tool's handles go round: the floating piece, the selection, or the layer's pixels. */
        moveBox() {
            if (this.floating) return { x: Math.round(this.floating.x), y: Math.round(this.floating.y), w: this.floating.w, h: this.floating.h };
            const s = this.doc.selection;
            if (s) return { x: s.x, y: s.y, w: s.w, h: s.h };
            if (this.moveBoxStale || !this.moveBoxCache || this.moveBoxLayer !== this.doc.layer) {
                this.moveBoxCache = this.doc.layer.adjust ? null : this.layerBounds(this.doc.layer);
                this.moveBoxLayer = this.doc.layer;
                this.moveBoxStale = false;
            }
            return this.moveBoxCache;
        }

        /** The Move tool's handle under p: { sx, sy } (-1, 0, 1), or null. */
        moveHandleAt(p) {
            const b = this.moveBox();
            if (!b) return null;
            const tol = 5 / this.zoom;
            const xs = [[-1, b.x], [0, b.x + b.w / 2], [1, b.x + b.w]];
            const ys = [[-1, b.y], [0, b.y + b.h / 2], [1, b.y + b.h]];
            for (const [sx, hx] of xs) {
                for (const [sy, hy] of ys) {
                    if (!sx && !sy) continue;
                    if (Math.abs(p.x - hx) <= tol && Math.abs(p.y - hy) <= tol) return { sx, sy };
                }
            }
            return null;
        }

        handleCursor(sx, sy) {
            if (sx && sy) return sx === sy ? 'nwse-resize' : 'nesw-resize';
            return sx ? 'ew-resize' : 'ns-resize';
        }

        renderOptions() {
            const box = this.el('.mp-options');
            const t = this.tool;
            const o = this.opt;
            const item = (key, value, inner, title) => `<button type="button" class="mp-opt${String(o[key]) === String(value) ? ' is-on' : ''}" data-opt="${key}" data-value="${value}" title="${esc(title || '')}">${inner}</button>`;
            let html = '';
            if (t === 'select' || t === 'freeselect' || t === 'text' || t === 'move' || t === 'wand' || t === 'ellipseselect' || t === 'polylasso') {
                html = `<div class="mp-opt-col">${item('transparent', false, '<span class="mp-opt-art is-opaque"></span>', 'Opaque')}${item('transparent', true, '<span class="mp-opt-art is-transparent"></span>', 'Transparent')}</div>`;
            } else if (t === 'eraser') {
                html = `<div class="mp-opt-col">${[4, 6, 8, 10].map((s) => item('eraser', s, `<span class="mp-opt-square" style="width:${s}px;height:${s}px"></span>`, `${s} px`)).join('')}</div>`;
            } else if (t === 'magnifier') {
                html = `<div class="mp-opt-col is-text">${[1, 2, 6, 8].map((z) => item('zoomLevel', z, `${z}x`)).join('')}</div>`;
            } else if (t === 'brush' || t === 'clone' || t === 'blur') {
                const shapes = [];
                ['round', 'square', 'slash', 'backslash'].forEach((sh) => [3, 2, 1].forEach((sz) => shapes.push([sh, sz])));
                html = `<div class="mp-opt-grid">${shapes.map(([sh, sz]) => item('brush', `${sh}-${sz}`, `<span class="mp-brush is-${sh}" style="--s:${[0, 1, 4, 7][sz]}px"></span>`)).join('')}</div>`;
            } else if (t === 'airbrush') {
                html = `<div class="mp-opt-col is-air">${[0, 1, 2].map((s) => item('airbrush', s, `<span class="mp-opt-art is-air" style="--x:${-s * 24}px"></span>`)).join('')}</div>`;
            } else if (t === 'line' || t === 'curve') {
                html = `<div class="mp-opt-col">${[1, 2, 3, 4, 5].map((w) => item('lineWidth', w, `<span class="mp-opt-line" style="height:${w}px"></span>`)).join('')}</div>`;
            } else if (t === 'rect' || t === 'ellipse' || t === 'roundrect' || t === 'polygon') {
                html = `<div class="mp-opt-col">${[['outline', 'is-outline'], ['both', 'is-both'], ['fill', 'is-fill']].map(([v, cls]) => item('shape', v, `<span class="mp-opt-shape ${cls}"></span>`)).join('')}</div>`;
            } else if (t === 'gradient') {
                html = `<div class="mp-opt-col is-text">${item('gradient', 'linear', 'Linear')}${item('gradient', 'radial', 'Radial')}</div>`;
            }
            box.innerHTML = html;
        }

        renderColors() {
            // a colour with alpha shows over the checkerboard
            // every chip (the colour bar's, the tool box's), the sliders, the Character window
            if (root.paintColor) root.paintColor.refresh(this);
            else { this.el('.mp-fg').style.background = this.fg; this.el('.mp-bg').style.background = this.bg; }
            if (root.paintType && !this.text) root.paintType.refresh(this);
        }

        /** A colour's alpha (0-1) and the colour without it. */
        splitAlpha(color) {
            const [r, g, b, a] = C().parseColor(color);
            return { alpha: a / 255, opaque: `rgb(${r}, ${g}, ${b})` };
        }

        color(alt) {
            return (alt ? !this.right : this.right) ? this.bg : this.fg;
        }

        brushSize() {
            if (this.opt.size > 0) return this.opt.size;
            if (this.tool === 'eraser') return this.opt.eraser;
            if (this.tool === 'line' || this.tool === 'curve' || ['rect', 'ellipse', 'roundrect', 'polygon'].includes(this.tool)) return this.opt.lineWidth;
            if (this.tool === 'airbrush') return [9, 16, 24][this.opt.airbrush];
            const sz = Number(String(this.opt.brush).split('-')[1]) || 2;
            return [1, 2, 5, 8][sz];
        }

        /** keepSmart: a transform or a smart filter, which a Smart Object takes as it is. */
        editable(keepSmart) {
            const l = this.doc.layer;
            if (l.locked) { this.status('This layer is locked.'); return false; }
            if (!l.visible) { this.status('This layer is hidden.'); return false; }
            if (l.smart && !keepSmart && this.tool !== 'move' && root.paintSmart) root.paintSmart.rasterize(this, l);
            if (l.vector && !keepSmart && this.tool !== 'move' && !PATH_TOOLS.has(this.tool) && root.paintPath) root.paintPath.rasterize(this, l);
            // painting on a type layer turns its text into pixels (Photoshop asks; Paint just says so)
            if (l.text && this.tool !== 'move') this.rasterizeType(l);
            return true;
        }

        clipToSelection(ctx) {
            const s = this.doc.selection;
            if (!s || this.floating) return;
            ctx.beginPath();
            if (s.path) {
                s.path.forEach((p, i) => (i ? ctx.lineTo(p.x, p.y) : ctx.moveTo(p.x, p.y)));
                ctx.closePath();
            } else ctx.rect(s.x, s.y, s.w, s.h);
            ctx.clip();
        }

        // a stroke: brush-like tools draw into a buffer so opacity is even, then merge on release
        beginStroke(erase) {
            if (!this.editable()) return false;
            this.step = this.doc.beginStep(TOOLS.find((t) => t[0] === this.tool)[1], this.doc.layer);
            const buf = C().makeCanvas(this.doc.width, this.doc.height);
            // a colour's alpha works like the opacity: the stroke is drawn solid and laid on at that
            // alpha, so its overlapping dabs do not build up
            const tint = this.tool === 'eraser' ? (erase ? null : this.bg) : (['brush', 'pencil', 'airbrush'].includes(this.tool) ? this.color() : null);
            const ca = tint ? this.splitAlpha(tint).alpha : 1;
            this.strokeOverlay = { canvas: buf, layerIndex: this.doc.active, alpha: (this.opt.opacity / 100) * ca, erase: !!erase };
            this.sctx = buf.getContext('2d');
            this.sctx.save();
            this.clipToSelection(this.sctx);
            return true;
        }

        strokeDab(x0, y0, x1, y1, size, color) {
            const ctx = this.sctx;
            color = this.splitAlpha(color).opaque;
            const r = size / 2;
            const hard = this.opt.hardness / 100;
            ctx.strokeStyle = color;
            ctx.fillStyle = color;
            ctx.lineWidth = size;
            const shape = String(this.opt.brush).split('-')[0];
            if (this.tool === 'pencil' || (!this.opt.antialias && size <= 1)) {
                // Bresenham: one pixel, no antialiasing (Vista's pencil)
                let x = Math.floor(x0); let y = Math.floor(y0);
                const xe = Math.floor(x1); const ye = Math.floor(y1);
                const dx = Math.abs(xe - x); const dy = -Math.abs(ye - y);
                const sx = x < xe ? 1 : -1; const sy = y < ye ? 1 : -1;
                let err = dx + dy;
                const pw = this.tool === 'pencil' ? Math.max(1, Math.round(size)) : 1;
                const po = Math.floor(pw / 2);
                for (;;) {
                    ctx.fillRect(x - po, y - po, pw, pw);
                    if (x === xe && y === ye) break;
                    const e2 = 2 * err;
                    if (e2 >= dy) { err += dy; x += sx; }
                    if (e2 <= dx) { err += dx; y += sy; }
                }
                return C().union({ x: Math.min(x0, x1) - 1 - po, y: Math.min(y0, y1) - 1 - po, w: Math.abs(x1 - x0) + 3 + pw, h: Math.abs(y1 - y0) + 3 + pw }, null);
            }
            if (shape === 'square' && this.tool === 'brush' || this.tool === 'eraser') {
                const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
                for (let i = 0; i <= steps; i += 1) {
                    const x = x0 + ((x1 - x0) * i) / steps;
                    const y = y0 + ((y1 - y0) * i) / steps;
                    ctx.fillRect(Math.round(x - r), Math.round(y - r), size, size);
                }
            } else if ((shape === 'slash' || shape === 'backslash') && this.tool === 'brush') {
                const d = shape === 'slash' ? [r, -r] : [-r, -r];
                ctx.lineWidth = 1;
                const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0)));
                for (let i = 0; i <= steps; i += 1) {
                    const x = x0 + ((x1 - x0) * i) / steps;
                    const y = y0 + ((y1 - y0) * i) / steps;
                    ctx.beginPath(); ctx.moveTo(x - d[0], y - d[1]); ctx.lineTo(x + d[0], y + d[1]); ctx.stroke();
                }
            } else if (hard < 1 && size > 2) {
                // a soft round brush: radial dabs along the segment
                const steps = Math.max(1, Math.ceil(Math.hypot(x1 - x0, y1 - y0) / Math.max(1, size / 6)));
                for (let i = 0; i <= steps; i += 1) {
                    const x = x0 + ((x1 - x0) * i) / steps;
                    const y = y0 + ((y1 - y0) * i) / steps;
                    const g = ctx.createRadialGradient(x, y, r * hard, x, y, r);
                    g.addColorStop(0, color);
                    g.addColorStop(1, 'rgba(0,0,0,0)');
                    ctx.fillStyle = g;
                    ctx.fillRect(x - r, y - r, size, size);
                }
            } else {
                ctx.lineCap = 'round';
                ctx.lineJoin = 'round';
                ctx.beginPath();
                ctx.moveTo(x0, y0);
                ctx.lineTo(x1 + 0.01, y1);
                ctx.stroke();
            }
            return { x: Math.min(x0, x1) - r - 2, y: Math.min(y0, y1) - r - 2, w: Math.abs(x1 - x0) + size + 4, h: Math.abs(y1 - y0) + size + 4 };
        }

        endStroke() {
            if (!this.strokeOverlay) return;
            this.sctx.restore();
            const l = this.doc.layer;
            const o = this.strokeOverlay;
            this.maskBuffer(o.canvas);
            l.ctx.save();
            l.ctx.globalAlpha = o.alpha;
            l.ctx.globalCompositeOperation = o.erase ? 'destination-out' : (['brush', 'pencil'].includes(this.tool) ? C().BLENDS[this.opt.paintMode] || 'source-over' : 'source-over');
            l.ctx.drawImage(o.canvas, 0, 0);
            l.ctx.restore();
            this.strokeOverlay = null;
            this.sctx = null;
            this.doc.commitStep(this.step);
            this.step = null;
            this.doc.markDirty(this.strokeRect || undefined);
            this.strokeRect = null;
        }

        /** A wand, feathered or combined selection clips by its mask: the buffer keeps only what it covers. */
        maskBuffer(canvas) {
            const s = this.doc.selection;
            if (!s || !s.mask || this.floating || !P()) return;
            const x = canvas.getContext('2d');
            x.save();
            x.globalCompositeOperation = 'destination-in';
            x.drawImage(P().maskCanvas(this.doc, s, { x: s.x, y: s.y, w: s.w, h: s.h }), s.x, s.y);
            // outside the mask's box nothing stays
            x.globalCompositeOperation = 'destination-out';
            x.fillRect(0, 0, canvas.width, s.y);
            x.fillRect(0, s.y + s.h, canvas.width, canvas.height);
            x.fillRect(0, s.y, s.x, s.h);
            x.fillRect(s.x + s.w, s.y, canvas.width, s.h);
            x.restore();
        }

        growStroke(r) {
            this.step.grow(r);
            this.strokeRect = C().union(this.strokeRect, r);
            this.doc.markDirty(r);
        }

        clearOverlay() {
            this.octx.clearRect(0, 0, this.overlay.width, this.overlay.height);
        }

        drawShape(ctx, kind, a, b, color1, color2) {
            const x = Math.min(a.x, b.x);
            const y = Math.min(a.y, b.y);
            const w = Math.abs(b.x - a.x);
            const h = Math.abs(b.y - a.y);
            const lw = this.brushSize();
            ctx.lineWidth = lw;
            ctx.strokeStyle = color1;
            ctx.fillStyle = this.opt.shape === 'fill' ? color1 : color2;
            ctx.lineJoin = kind === 'rect' ? 'miter' : 'round';
            ctx.beginPath();
            if (kind === 'line') {
                ctx.lineCap = 'round';
                ctx.moveTo(a.x, a.y);
                ctx.lineTo(b.x, b.y);
                ctx.stroke();
                return;
            }
            const inset = this.opt.shape === 'fill' ? 0 : lw / 2;
            if (kind === 'rect') ctx.rect(x + inset, y + inset, Math.max(0, w - 2 * inset), Math.max(0, h - 2 * inset));
            else if (kind === 'ellipse') ctx.ellipse(x + w / 2, y + h / 2, Math.max(0, w / 2 - inset), Math.max(0, h / 2 - inset), 0, 0, Math.PI * 2);
            else if (kind === 'roundrect') ctx.roundRect(x + inset, y + inset, Math.max(0, w - 2 * inset), Math.max(0, h - 2 * inset), Math.min(this.opt.radius === undefined ? 16 : this.opt.radius, w / 2, h / 2));
            if (this.opt.shape !== 'outline') ctx.fill();
            if (this.opt.shape !== 'fill') ctx.stroke();
        }

        constrain(a, b, ev, square) {
            if (!ev || !ev.shiftKey) return b;
            const dx = b.x - a.x;
            const dy = b.y - a.y;
            if (square) {
                const s = Math.max(Math.abs(dx), Math.abs(dy));
                return { x: a.x + Math.sign(dx || 1) * s, y: a.y + Math.sign(dy || 1) * s };
            }
            const ang = Math.round(Math.atan2(dy, dx) / (Math.PI / 4)) * (Math.PI / 4);
            const len = Math.hypot(dx, dy);
            return { x: a.x + Math.cos(ang) * len, y: a.y + Math.sin(ang) * len };
        }

        commitToLayer(label, draw, rect, opts = {}) {
            if (!this.editable()) return;
            const l = this.doc.layer;
            const step = this.doc.beginStep(label, l);
            const s = this.doc.selection;
            if (s && s.mask && !opts.direct && !this.floating) {
                // drawn on its own, kept through the mask, then laid on the layer
                const buf = C().makeCanvas(this.doc.width, this.doc.height);
                const bx = buf.getContext('2d');
                bx.imageSmoothingEnabled = this.opt.antialias;
                draw(bx);
                this.maskBuffer(buf);
                l.ctx.drawImage(buf, 0, 0);
            } else {
                l.ctx.save();
                this.clipToSelection(l.ctx);
                l.ctx.imageSmoothingEnabled = this.opt.antialias;
                draw(l.ctx);
                l.ctx.restore();
            }
            step.grow(rect || { x: 0, y: 0, w: this.doc.width, h: this.doc.height });
            this.doc.commitStep(step);
            this.doc.markDirty(rect);
        }

        cancelShape() {
            this.shape = null;
            this.curve = null;
            this.polygon = null;
            this.clearOverlay();
        }

        // ---- selection ----------------------------------------------------------------------

        setSelection(sel) {
            this.doc.selection = sel;
            this.drawAnts();
            this.sizeStatus();
        }

        sizeStatus() {
            const s = this.floating || this.doc.selection;
            this.el('.mp-status-size').textContent = s ? `${Math.round(s.w)}x${Math.round(s.h)}` : `${this.doc.width}x${this.doc.height}`;
        }

        drawAnts() {
            const s = this.floating || this.doc.selection;
            const z = this.zoom;
            const svg = this.ants;
            const W = this.doc.width;
            const H = this.doc.height;
            svg.setAttribute('width', String(W * z));
            svg.setAttribute('height', String(H * z));
            const pathOf = (sel, floating) => {
                if (sel.mask && !floating && P()) return P().outline(sel, W, H, z);
                if (sel.path && !floating) return sel.path.map((p, i) => `${i ? 'L' : 'M'}${(p.x * z).toFixed(1)},${(p.y * z).toFixed(1)}`).join('') + (sel.open ? '' : 'Z');
                const x = Math.round(sel.x * z) + 0.5;
                const y = Math.round(sel.y * z) + 0.5;
                return `M${x},${y}h${Math.round(sel.w * z)}v${Math.round(sel.h * z)}h${-Math.round(sel.w * z)}Z`;
            };
            let html = '';
            const ants = (d) => `<path d="${d}" class="mp-ants-a"/><path d="${d}" class="mp-ants-b"/>`;
            if (this.selBase) html += ants(pathOf(this.selBase, false));
            if (s) html += ants(pathOf(s, !!this.floating));
            const c = this.cropBox;
            if (c) {
                const x0 = c.x * z; const y0 = c.y * z; const x1 = (c.x + c.w) * z; const y1 = (c.y + c.h) * z;
                html += `<path class="mp-crop-shade" fill-rule="evenodd" d="M0,0H${W * z}V${H * z}H0Z M${x0},${y0}H${x1}V${y1}H${x0}Z"/>`;
                const tx = (c.w * z) / 3; const ty = (c.h * z) / 3;
                html += `<path class="mp-crop-thirds" d="M${x0 + tx},${y0}V${y1}M${x0 + 2 * tx},${y0}V${y1}M${x0},${y0 + ty}H${x1}M${x0},${y0 + 2 * ty}H${x1}"/>`;
                html += `<rect class="mp-crop-edge" x="${x0}" y="${y0}" width="${x1 - x0}" height="${y1 - y0}"/>`;
                html += this.handleMarks([[x0, y0], [(x0 + x1) / 2, y0], [x1, y0], [x1, (y0 + y1) / 2], [x1, y1], [(x0 + x1) / 2, y1], [x0, y1], [x0, (y0 + y1) / 2]]);
            }
            if (this.guidesShown && this.doc.guides.length) {
                // across the workspace round the picture too (Photoshop)
                const far = Math.max(this.workspace.clientWidth, this.workspace.clientHeight) + 40;
                const W2 = this.doc.width * z;
                const H2 = this.doc.height * z;
                // the window may sit at a fraction of a pixel: a guide lands on whole screen pixels
                const box = this.ants.getBoundingClientRect();
                const dpr = root.devicePixelRatio || 1;
                const fx = (Math.round(box.left * dpr) - box.left * dpr) / dpr;
                const fy = (Math.round(box.top * dpr) - box.top * dpr) / dpr;
                const t = 1 / dpr;
                html += this.doc.guides.map((g) => (g.axis === 'h'
                    ? `<rect class="mp-guide" x="${-far}" y="${Math.round(g.pos * z) + fy}" width="${W2 + 2 * far}" height="${t}"/>`
                    : `<rect class="mp-guide" x="${Math.round(g.pos * z) + fx}" y="${-far}" width="${t}" height="${H2 + 2 * far}"/>`)).join('');
            }
            if (!this.xf && this.tool === 'move' && this.opt.showControls) {
                const b = this.moveBox();
                if (b) {
                    const x0 = b.x * z; const y0 = b.y * z; const x1 = (b.x + b.w) * z; const y1 = (b.y + b.h) * z;
                    html += `<rect class="mp-move-box" x="${Math.round(x0) + 0.5}" y="${Math.round(y0) + 0.5}" width="${Math.round(x1 - x0)}" height="${Math.round(y1 - y0)}"/>`;
                    html += this.handleMarks([[x0, y0], [(x0 + x1) / 2, y0], [x1, y0], [x1, (y0 + y1) / 2], [x1, y1], [(x0 + x1) / 2, y1], [x0, y1], [x0, (y0 + y1) / 2]]);
                }
            }
            if (this.xf) {
                const pts = this.xfCorners().map(([x, y]) => [x * z, y * z]);
                html += `<path class="mp-xf-box" d="M${pts.map((q) => q.join(',')).join('L')}Z"/>`;
                const mids = pts.map((q, i) => [(q[0] + pts[(i + 1) % 4][0]) / 2, (q[1] + pts[(i + 1) % 4][1]) / 2]);
                html += this.handleMarks([...pts, ...mids]);
                html += `<circle class="mp-xf-center" cx="${this.xf.cx * z}" cy="${this.xf.cy * z}" r="3"/>`;
            }
            if (root.paintPath && !this.xf) html += root.paintPath.svg(this, z);
            svg.innerHTML = html;
        }

        handleMarks(points) {
            return points.map(([x, y]) => `<rect class="mp-xf-handle" x="${Math.round(x) - 3.5}" y="${Math.round(y) - 3.5}" width="7" height="7"/>`).join('');
        }

        selectionCanvas(cut) {
            const s = this.doc.selection;
            if (!s) return null;
            const l = this.doc.layer;
            const c = C().makeCanvas(s.w, s.h);
            const cx = c.getContext('2d');
            if (s.path) {
                cx.beginPath();
                s.path.forEach((p, i) => (i ? cx.lineTo(p.x - s.x, p.y - s.y) : cx.moveTo(p.x - s.x, p.y - s.y)));
                cx.closePath();
                cx.clip();
            }
            cx.drawImage(l.canvas, s.x, s.y, s.w, s.h, 0, 0, s.w, s.h);
            if (s.mask) {
                const img = cx.getImageData(0, 0, s.w, s.h);
                for (let y = 0; y < s.h; y += 1) {
                    for (let x = 0; x < s.w; x += 1) {
                        const m = s.mask[(s.y + y) * this.doc.width + s.x + x];
                        if (m !== 255) img.data[(y * s.w + x) * 4 + 3] = (img.data[(y * s.w + x) * 4 + 3] * m) / 255;
                    }
                }
                cx.putImageData(img, 0, 0);
            }
            if (cut) this.clearSelectionArea(l);
            return c;
        }

        /** Delete / cut: the background color on the Background layer (Vista), transparency above it. */
        clearSelectionArea(l) {
            const s = this.doc.selection;
            // a layer mask takes the background colour like the Background layer (Photoshop)
            const isBackground = !!l.isBackground || !!l.isMask;
            l.ctx.save();
            l.ctx.beginPath();
            if (s.path) {
                s.path.forEach((p, i) => (i ? l.ctx.lineTo(p.x, p.y) : l.ctx.moveTo(p.x, p.y)));
                l.ctx.closePath();
            } else l.ctx.rect(s.x, s.y, s.w, s.h);
            l.ctx.clip();
            if (s.mask) {
                const img = l.ctx.getImageData(s.x, s.y, s.w, s.h);
                const [r, g, b] = C().parseColor(this.bg);
                for (let y = 0; y < s.h; y += 1) {
                    for (let x = 0; x < s.w; x += 1) {
                        const m = s.mask[(s.y + y) * this.doc.width + s.x + x];
                        if (!m) continue;
                        const i = (y * s.w + x) * 4;
                        const k = m / 255;
                        if (isBackground) {
                            img.data[i] += (r - img.data[i]) * k; img.data[i + 1] += (g - img.data[i + 1]) * k; img.data[i + 2] += (b - img.data[i + 2]) * k; img.data[i + 3] = 255;
                        } else img.data[i + 3] *= 1 - k;
                    }
                }
                l.ctx.putImageData(img, s.x, s.y);
            } else if (isBackground) {
                l.ctx.fillStyle = this.bg;
                l.ctx.fillRect(s.x, s.y, s.w, s.h);
            } else l.ctx.clearRect(s.x, s.y, s.w, s.h);
            l.ctx.restore();
        }

        /** Lift the selection off the layer (or a copy, with Ctrl) so it can be moved. */
        liftSelection(copy) {
            const s = this.doc.selection;
            if (!s || this.floating) return;
            if (this.doc.layer.text) this.rasterizeType(this.doc.layer);
            this.floatStep = this.doc.beginStep(copy ? 'Copy' : 'Move', this.doc.layer);
            const c = this.selectionCanvas(!copy);
            this.floating = { canvas: c, x: s.x, y: s.y, w: s.w, h: s.h, from: { x: s.x, y: s.y, w: s.w, h: s.h } };
            this.floatStep.grow(this.floating.from);
            this.doc.selection = null;
            this.doc.markDirty(this.floating.from);
            this.drawFloating();
        }

        drawFloating() {
            this.clearOverlay();
            const f = this.floating;
            if (!f) return;
            let img = f.canvas;
            if (this.opt.transparent) img = this.transparentCopy(f.canvas);
            this.octx.drawImage(img, Math.round(f.x), Math.round(f.y), f.w, f.h);
            this.drawAnts();
            this.sizeStatus();
        }

        transparentCopy(src) {
            const c = C().makeCanvas(src.width, src.height);
            const cx = c.getContext('2d');
            cx.drawImage(src, 0, 0);
            const img = cx.getImageData(0, 0, c.width, c.height);
            const [r, g, b] = C().parseColor(this.bg);
            for (let i = 0; i < img.data.length; i += 4) {
                if (img.data[i] === r && img.data[i + 1] === g && img.data[i + 2] === b) img.data[i + 3] = 0;
            }
            cx.putImageData(img, 0, 0);
            return c;
        }

        commitFloating() {
            if (this.xf) this.commitTransform();
            const f = this.floating;
            if (!f) return;
            const l = this.doc.layer;
            const img = this.opt.transparent ? this.transparentCopy(f.canvas) : f.canvas;
            l.ctx.drawImage(img, Math.round(f.x), Math.round(f.y), f.w, f.h);
            const r = { x: Math.round(f.x), y: Math.round(f.y), w: f.w, h: f.h };
            if (this.floatStep) {
                this.floatStep.grow(r);
                this.doc.commitStep(this.floatStep);
            }
            this.floatStep = null;
            this.floating = null;
            this.clearOverlay();
            this.doc.markDirty(C().union(r, f.from));
            this.setSelection(null);
        }

        // ---- Edit ---------------------------------------------------------------------------

        async copySelection(cut) {
            const src = this.floating ? this.floating.canvas : this.selectionCanvas(false);
            if (!src) return;
            this.clipboard = src;
            try {
                const blob = await new Promise((r) => src.toBlob(r, 'image/png'));
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            } catch (_) { /* the system clipboard is optional; Paint keeps its own copy */ }
            if (cut) {
                if (this.floating) {
                    this.floating = null;
                    if (this.floatStep) { this.doc.commitStep(this.floatStep); this.floatStep = null; }
                    this.clearOverlay();
                    this.setSelection(null);
                } else {
                    const step = this.doc.beginStep('Cut', this.doc.layer);
                    step.grow(this.doc.selection);
                    this.clearSelectionArea(this.doc.layer);
                    this.doc.commitStep(step);
                    this.doc.markDirty(this.doc.selection);
                    this.setSelection(null);
                }
            }
        }

        async paste() {
            const pasted = await this.withProgress('Pasting', async (p) => {
                p.line('Reading the clipboard...');
                p.marquee();
                try {
                    const items = await navigator.clipboard.read();
                    for (const it of items) {
                        const type = it.types.find((t) => t.startsWith('image/'));
                        if (!type) continue;
                        const blob = await it.getType(type);
                        p.line(`Reading the picture (${sizeText(blob.size)})...`);
                        p.percent(60);
                        return this.decodePicture(await blob.arrayBuffer(), type);
                    }
                } catch (_) { /* fall back to Paint's own copy */ }
                return this.clipboard || null;
            });
            if (pasted) this.pasteCanvas(pasted);
        }

        async pasteBlob(blob) {
            if (!blob) return;
            const c = await this.withProgress('Pasting', async (p) => {
                p.line(`Reading the picture (${sizeText(blob.size)})...`);
                p.percent(50);
                return this.decodePicture(await blob.arrayBuffer(), blob.type);
            });
            if (c) this.pasteCanvas(c);
        }

        pasteCanvas(c) {
            this.commitFloating();
            // Vista asks to enlarge the picture when the pasted one is bigger
            if (c.width > this.doc.width || c.height > this.doc.height) {
                this.doc.resizeCanvas(Math.max(c.width, this.doc.width), Math.max(c.height, this.doc.height), { fill: this.bg, label: 'Enlarge' });
            }
            // the Move tool: the pasted piece shows its resize handles at once
            this.setTool('move');
            this.floatStep = this.doc.beginStep('Paste', this.doc.layer);
            const sx = Math.floor(this.workspace.scrollLeft / this.zoom);
            const sy = Math.floor(this.workspace.scrollTop / this.zoom);
            this.floating = { canvas: c, x: sx, y: sy, w: c.width, h: c.height, from: { x: sx, y: sy, w: 1, h: 1 } };
            this.drawFloating();
        }

        selectAll() {
            this.commitFloating();
            this.setTool('select');
            this.setSelection({ x: 0, y: 0, w: this.doc.width, h: this.doc.height });
        }

        deleteSelection() {
            if (this.floating) {
                this.floating = null;
                if (this.floatStep) { this.doc.commitStep(this.floatStep); this.floatStep = null; }
                this.clearOverlay();
                this.setSelection(null);
                return;
            }
            const s = this.doc.selection;
            if (!s || !this.editable()) return;
            const step = this.doc.beginStep('Clear Selection', this.doc.layer);
            step.grow(s);
            this.clearSelectionArea(this.doc.layer);
            this.doc.commitStep(step);
            this.doc.markDirty(s);
        }

        // ---- text: type layers (Photoshop) ------------------------------------------------------

        /** Start a text box: a new type layer at p, or the type layer `layer` opened again. */
        startText(p, layer) {
            this.finishText();
            const t = layer && layer.text;
            if (t) {
                // the box shows the text in the layer's own font and settings
                setReg({
                    TextFace: t.face, TextSize: t.size, TextWeight: t.weight || (t.bold ? 700 : 400), TextBold: (t.weight || (t.bold ? 700 : 400)) >= 600,
                    TextItalic: !!t.italic, TextUnderline: !!t.underline, TextStrike: !!t.strike, TextCaps: t.caps || 'none',
                    TextTracking: t.tracking || 0, TextLeading: t.leading || 0, TextAlign: t.align || 'left', TextAA: t.aa || 'smooth'
                });
                layer.visible = false;
                this.doc.markDirty();
            }
            const tool = this.tool;
            const at = t ? { x: t.x, y: t.y } : p;
            const box = doc.createElement('div');
            box.className = 'mp-textbox';
            box.contentEditable = 'true';
            box.spellcheck = false;
            box.style.left = `${at.x * this.zoom}px`;
            box.style.top = `${at.y * this.zoom}px`;
            this.stage.appendChild(box);
            if (t) box.innerText = t.content;
            // the type tools: vertical writes top to bottom; the masks make a selection, not a layer
            const vertical = t ? !!t.vertical : tool === 'vtext' || tool === 'vtextmask';
            const mask = !t && (tool === 'textmask' || tool === 'vtextmask');
            box.classList.toggle('is-mask', mask);
            this.text = { box, x: at.x, y: at.y, layer: layer || null, color: t ? t.color : this.fg, vertical, mask };
            this.restyleText();
            if (this.modal.classList.contains('mp-no-settings')) this.showTextBar(true);
            this.renderBar();
            setTimeout(() => {
                box.focus();
                const sel = root.getSelection && root.getSelection();
                if (sel && t) { sel.selectAllChildren(box); }
            }, 0);
        }

        /** The type settings (the registry's; the options bar and the Character window set them). */
        textFont() {
            const bold = !!reg('TextBold', false);
            const weight = Number(reg('TextWeight', bold ? 700 : 400)) || 400;
            return {
                face: reg('TextFace', 'Arial'), size: Number(reg('TextSize', 12)), weight, bold: weight >= 600,
                italic: !!reg('TextItalic', false), underline: !!reg('TextUnderline', false), strike: !!reg('TextStrike', false),
                caps: reg('TextCaps', 'none'), tracking: Number(reg('TextTracking', 0)) || 0, leading: Number(reg('TextLeading', 0)) || 0,
                align: reg('TextAlign', 'left'), aa: reg('TextAA', 'smooth')
            };
        }

        /** The text being typed, as a type layer's props. */
        textProps(t, content) {
            const f = this.textFont();
            return { content, face: f.face, size: f.size, weight: f.weight, bold: f.bold, italic: f.italic, underline: f.underline, strike: f.strike,
                caps: f.caps, tracking: f.tracking, leading: f.leading, align: f.align, aa: f.aa, vertical: !!t.vertical, color: t.color, x: t.x, y: t.y };
        }

        showTextBar(on) {
            let bar = this.el('.mp-textbar');
            if (!on) { if (bar) bar.hidden = true; return; }
            const fonts = ['Arial', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
            if (!bar) {
                bar = doc.createElement('div');
                bar.className = 'mp-textbar';
                bar.setAttribute('role', 'toolbar');
                bar.innerHTML = `<div class="mp-textbar-cap">Fonts</div>
                    <select class="mp-tb-face">${fonts.map((n) => `<option>${n}</option>`).join('')}</select>
                    <select class="mp-tb-size">${[6, 8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 60, 72, 96, 120, 144].map((n) => `<option>${n}</option>`).join('')}</select>
                    <button type="button" class="mp-tb-b" data-tb="TextBold" title="Bold"><span class="mp-tb-art" style="--x:0px"></span></button>
                    <button type="button" class="mp-tb-b" data-tb="TextItalic" title="Italic"><span class="mp-tb-art" style="--x:-16px"></span></button>
                    <button type="button" class="mp-tb-b" data-tb="TextUnderline" title="Underline"><span class="mp-tb-art" style="--x:-32px"></span></button>
                    <button type="button" class="mp-tb-color" title="Text Color"><span></span></button>`;
                this.el('.mp-workspace').appendChild(bar);
                const apply = () => {
                    setReg({ TextFace: bar.querySelector('.mp-tb-face').value, TextSize: Number(bar.querySelector('.mp-tb-size').value) });
                    this.restyleText();
                };
                bar.querySelector('.mp-tb-face').addEventListener('change', apply);
                bar.querySelector('.mp-tb-size').addEventListener('change', apply);
                // the bar keeps the text box's focus and selection
                bar.addEventListener('mousedown', (ev) => { if (ev.target.closest('button')) ev.preventDefault(); });
                bar.addEventListener('click', (ev) => {
                    if (ev.target.closest('.mp-tb-color')) {
                        if (!root.paintColor || !this.text) return;
                        const t = this.text;
                        root.paintColor.picker(this, 'fg', { color: t.color, title: 'Text Color', onPick: (c) => { t.color = c; this.restyleText(); if (t.box.isConnected) t.box.focus(); } });
                        return;
                    }
                    const b = ev.target.closest('[data-tb]');
                    if (!b) return;
                    b.classList.toggle('is-on');
                    setReg({ [b.dataset.tb]: b.classList.contains('is-on') });
                    setTimeout(() => this.restyleText(), 0);
                });
            }
            // the bar shows the font of the text being typed
            const f = this.textFont();
            bar.querySelector('.mp-tb-face').value = fonts.includes(f.face) ? f.face : 'Arial';
            bar.querySelector('.mp-tb-size').value = String(f.size);
            if (bar.querySelector('.mp-tb-size').value !== String(f.size)) {
                bar.querySelector('.mp-tb-size').insertAdjacentHTML('beforeend', `<option>${f.size}</option>`);
                bar.querySelector('.mp-tb-size').value = String(f.size);
            }
            bar.querySelector('[data-tb="TextBold"]').classList.toggle('is-on', !!f.bold);
            bar.querySelector('[data-tb="TextItalic"]').classList.toggle('is-on', !!f.italic);
            bar.querySelector('[data-tb="TextUnderline"]').classList.toggle('is-on', !!f.underline);
            bar.querySelector('.mp-tb-color span').style.background = this.text ? this.text.color : this.fg;
            bar.hidden = false;
        }

        restyleText() {
            if (root.paintType) root.paintType.refresh(this);
            if (!this.text) return;
            const box = this.text.box;
            const css = root.paintType ? root.paintType.cssOf(this.textProps(this.text, ''), this.zoom) : null;
            if (css) Object.assign(box.style, css);
            if (this.text.mask) box.style.color = '#000';
            const chip = this.el('.mp-tb-color span');
            if (chip) chip.style.background = this.text.color;
        }

        /** Draw a type layer's text into its pixels (paintType.js: weight, tracking, leading, vertical ...). */
        renderTextLayer(l) {
            l.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
            root.paintType.draw(l.ctx, l.text);
            // a Dreamscape webfont not loaded yet draws as its fallback: draw again when it comes
            const font = root.paintType.fontOf(l.text, 16);
            if (doc.fonts && doc.fonts.check && !doc.fonts.check(font)) {
                void root.paintType.ensure(l.text.face).then(() => {
                    if (!l.text || !doc.fonts.check(font)) return;
                    l.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
                    root.paintType.draw(l.ctx, l.text);
                    this.doc.markDirty();
                });
            }
        }

        /** The box round a type layer's text (for a click with the Text tool). */
        textBounds(l) {
            return root.paintType.bounds(l.text);
        }

        finishText() {
            const t = this.text;
            if (!t) return;
            this.text = null;
            this.showTextBar(false);
            const content = t.box.innerText.replace(/\n$/, '');
            t.box.remove();
            const props = this.textProps(t, content);
            const d = this.doc;
            this.renderBar();
            if (t.mask) {
                // a type mask: the text's shape becomes the selection (combined by the selection mode)
                if (!content.trim() || !P()) return;
                const c = C().makeCanvas(d.width, d.height);
                root.paintType.draw(c.getContext('2d'), { ...props, color: '#000' });
                const a = c.getContext('2d').getImageData(0, 0, d.width, d.height).data;
                const m = new Uint8Array(d.width * d.height);
                for (let i = 0; i < m.length; i += 1) m[i] = a[i * 4 + 3];
                const sel = P().fromMask(m, d.width, d.height);
                const mode = this.opt.selMode;
                if (d.selection) this.lastSelection = d.selection;
                this.setSelection(mode !== 'new' && d.selection ? P().combine(d, d.selection, sel, mode) : sel);
                this.setTool('select');
                return;
            }
            if (t.layer) {
                const l = t.layer;
                l.visible = true;
                if (!content.trim()) { d.markDirty(); return; }
                if (JSON.stringify(l.text) === JSON.stringify(props)) { d.markDirty(); return; }
                d.snapshotStep('Edit Type Layer', () => { l.text = props; this.renderTextLayer(l); });
                if (root.paintLayers) root.paintLayers.refresh(this);
                return;
            }
            if (!content.trim()) return;
            d.snapshotStep('Type Layer', () => {
                const l = d.addLayer(content.split('\n')[0].slice(0, 30) || 'Text');
                l.text = props;
                this.renderTextLayer(l);
                d.editMask = false;
            });
            if (root.paintLayers) root.paintLayers.refresh(this);
        }

        /** Layers > Rasterize Type: the text becomes plain pixels (a paint tool asks for it too). */
        rasterizeType(l = this.doc.activeLayer) {
            if (!l.text) return;
            this.doc.snapshotStep('Rasterize Type', () => { l.text = null; });
            if (root.paintLayers) root.paintLayers.refresh(this);
            this.status('The type layer is now pixels.');
        }

        // ---- canvas resize handles ------------------------------------------------------------

        resizeDrag(ev, handle) {
            ev.preventDefault();
            const start = { x: ev.clientX, y: ev.clientY, w: this.doc.width, h: this.doc.height };
            const ghost = doc.createElement('div');
            ghost.className = 'mp-resize-ghost';
            this.stage.appendChild(ghost);
            const e = handle.classList.contains('is-e') || handle.classList.contains('is-se');
            const s = handle.classList.contains('is-s') || handle.classList.contains('is-se');
            const size = (mv) => ({
                w: Math.max(1, Math.round(start.w + (e ? (mv.clientX - start.x) / this.zoom : 0))),
                h: Math.max(1, Math.round(start.h + (s ? (mv.clientY - start.y) / this.zoom : 0)))
            });
            const move = (mv) => {
                const z = size(mv);
                ghost.style.width = `${z.w * this.zoom}px`;
                ghost.style.height = `${z.h * this.zoom}px`;
                this.el('.mp-status-size').textContent = `${z.w}x${z.h}`;
            };
            const up = (mv) => {
                doc.removeEventListener('pointermove', move);
                doc.removeEventListener('pointerup', up);
                ghost.remove();
                const z = size(mv);
                if (z.w !== this.doc.width || z.h !== this.doc.height) this.doc.resizeCanvas(z.w, z.h, { fill: this.bg });
            };
            doc.addEventListener('pointermove', move);
            doc.addEventListener('pointerup', up);
        }

        // ---- progress (Vista's progress dialog, fileOperationProgress.js) -----------------------

        /**
         * Work on a file under Vista's progress dialog: fn(p) with p.line(text), p.percent(0-100),
         * p.marquee() while the amount is unknown (an upload is one message), p.check() to stop at
         * Cancel (only when opts.cancellable), p.abort for a fetch. Resolves fn's value; null when
         * cancelled. Without the desktop's dialog the work runs as it is.
         */
        async withProgress(title, fn, opts = {}) {
            let api = root.fileOperationProgress;
            if (!api && root.featureLoader) {
                try { await root.featureLoader.loadFeature('explorer'); } catch (_) { /* no dialog then */ }
                api = root.fileOperationProgress;
            }
            let cancelled = false;
            const abort = opts.cancellable ? new AbortController() : null;
            const op = api && api.available() ? api.task({
                title, line: opts.line || '',
                onCancel: opts.cancellable ? () => { cancelled = true; abort.abort(); } : undefined
            }) : null;
            const p = {
                abort,
                line: (t) => { if (op) op.setLine(t); },
                percent: (v) => { if (op) { op.setMarquee(false); op.setPercent(v); } },
                marquee: () => { if (op) op.setMarquee(true); },
                get cancelled() { return cancelled; },
                check: () => { if (cancelled) { const e = new Error('Cancelled'); e.paintCancelled = true; throw e; } },
                // a part of the bar: part(a, b)(fraction) moves it between a and b percent
                part: (a, b) => (f) => p.percent(a + (b - a) * Math.max(0, Math.min(1, f)))
            };
            this.busy = (this.busy || 0) + 1;
            try {
                return await fn(p);
            } catch (err) {
                if ((err && err.paintCancelled) || (err && err.name === 'AbortError')) return null;
                throw err;
            } finally {
                this.busy -= 1;
                if (op) op.finish();
            }
        }

        /** A URL's bytes, the bar following them as they arrive. */
        async fetchBytes(url, p, report) {
            const r = await fetch(url, { credentials: 'same-origin', signal: p && p.abort ? p.abort.signal : undefined });
            if (!r.ok) throw new Error(`The server answered ${r.status}.`);
            const total = Number(r.headers.get('content-length')) || 0;
            if (!r.body || !total || !r.body.getReader) {
                if (p) p.marquee();
                return r.arrayBuffer();
            }
            const reader = r.body.getReader();
            const parts = [];
            let got = 0;
            for (;;) {
                const { done, value } = await reader.read();
                if (done) break;
                parts.push(value);
                got += value.length;
                if (report) report(got / total);
                if (p) p.line(`${sizeText(got)} of ${sizeText(total)}`);
            }
            const out = new Uint8Array(got);
            let at = 0;
            parts.forEach((b) => { out.set(b, at); at += b.length; });
            return out.buffer;
        }

        /** A picture's bytes to a canvas. */
        async decodePicture(bytes, type) {
            const url = URL.createObjectURL(new Blob([bytes], { type: type || '' }));
            try {
                const img = await loadImage(url);
                const c = C().makeCanvas(img.naturalWidth, img.naturalHeight);
                c.getContext('2d').drawImage(img, 0, 0);
                return c;
            } finally {
                URL.revokeObjectURL(url);
            }
        }

        // ---- files ----------------------------------------------------------------------------

        async openUrl(url, name, file, progress) {
            try {
                const run = async (p) => {
                    p.line('Downloading...');
                    const bytes = await this.fetchBytes(url, p, p.part(0, 80));
                    p.check();
                    p.line('Reading the picture...');
                    p.percent(90);
                    return this.decodePicture(bytes);
                };
                const img = progress ? await run(progress) : await this.withProgress(`Opening ${name || 'picture'}`, run, { cancellable: true });
                if (!img) return;
                this.newDocument(img.width, img.height, { file });
                this.doc.layer.ctx.drawImage(img, 0, 0);
                this.doc.history = [];
                this.doc.historyIndex = -1;
                this.doc.markDirty();
                this.name = (name || 'Untitled').replace(/\.[^.]+$/, '');
                this.file = file || null;
                this.dirtyDoc = false;
                this.title();
                this.emitPanels();
            } catch (err) {
                await this.message(`Paint cannot read this file.\n${err.message || ''}`);
            }
        }

        /** A VFS file: a Graphic Session Document, a Melaton Paint Image, or a picture. */
        async openVfsFile(id, name, path) {
            const file = { id, name, path };
            let notes = [];
            try {
                await this.withProgress(`Opening ${name}`, async (p) => {
                    p.line('Asking the server for the file...');
                    p.marquee();
                    const res = await vfs().downloadFile(id);
                    p.check();
                    if (!/\.(psd|gsd|mpi)$/i.test(name)) { await this.openUrl(res.downloadUrl, name, file, p); return; }
                    p.line('Downloading...');
                    const buf = await this.fetchBytes(res.downloadUrl, p, p.part(0, 55));
                    p.check();
                    const reading = (what) => (f, k, n) => { p.percent(55 + 45 * f); p.line(n ? `Reading ${what} ${k} of ${n}...` : `Reading ${what}...`); p.check(); };
                    if (/\.psd$/i.test(name) && root.paintPsd) {
                        notes = await root.paintPsd.apply(this, await root.paintPsd.decode(buf), { name, file }, reading('layer'));
                        return;
                    }
                    if (root.paintGsd && root.paintGsd.isGsd(buf)) {
                        await root.paintGsd.apply(this, await root.paintGsd.decode(buf), { name, file }, reading('part'));
                        return;
                    }
                    p.line('Reading the layers...');
                    await this.openMpi(new TextDecoder().decode(buf), name, file);
                }, { cancellable: true });
            } catch (err) {
                await this.message(`Paint cannot read ${name}.\n${(err && err.message) || ''}`);
                return;
            }
            if (notes && notes.length) await this.message(`Some parts of ${name} could not come in as they are:\n\n${notes.join('\n')}`);
        }

        async openMpi(text, name, file) {
            const data = JSON.parse(text);
            this.newDocument(data.width, data.height, { file });
            const layers = [];
            for (const l of data.layers) {
                const img = await loadImage(l.png);
                layers.push([l, img]);
            }
            this.doc.layers = [];
            for (const [l] of layers) {
                if (l.mask) l.maskImg = await loadImage(l.mask);
            }
            layers.forEach(([l, img]) => {
                const layer = this.doc.addLayer(l.name, { silent: true, at: this.doc.layers.length });
                layer.ctx.drawImage(img, 0, 0);
                if (l.maskImg) {
                    const m = layer.addMask();
                    m.ctx.drawImage(l.maskImg, 0, 0);
                    m.enabled = l.maskOn !== false;
                }
                layer.styles = l.styles || null;
                layer.isBackground = l.isBackground !== undefined ? !!l.isBackground : (this.doc.layers.length === 1 && l.name === 'Background');
                layer.adjust = l.adjust || null;
                layer.text = l.text || null;
                layer.visible = l.visible !== false;
                layer.opacity = typeof l.opacity === 'number' ? l.opacity : 1;
                layer.blend = l.blend || 'normal';
                layer.locked = !!l.locked;
            });
            this.doc.active = Math.min(data.active || 0, this.doc.layers.length - 1);
            this.doc.markDirty();
            this.name = (name || 'Untitled').replace(/\.[^.]+$/, '');
            this.file = file || null;
            this.dirtyDoc = false;
            this.title();
            this.emitPanels();
        }

        async confirmDiscard() {
            if (!this.dirtyDoc) return true;
            const choice = await callGlobal('showConfirmationDialog', `<p>Do you want to save changes to ${esc(this.name)}?</p>`, [
                { text: 'Save', value: 'save', className: 'btn-standard primary' },
                { text: "Don't Save", value: 'discard', className: 'btn-standard' },
                { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
            ], null, { title: 'Paint', width: 380 });
            if (choice === 'save') return this.save();
            return choice === 'discard';
        }

        openDialog(mode = 'open-vfs') {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            const self = this;
            const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
            void root.studioOpenFolderDialog(mode, {
                owner: this.modal,
                startPath: mode === 'open-gallery' && ws ? `/Workspaces/${ws}/Pictures` : (this.file && this.file.path) || (ws ? `/Workspaces/${ws}` : '/'),
                host: {
                    title: 'Open',
                    typeLabel: 'All Picture Files',
                    rejectMessage: 'Choose a picture',
                    acceptItem: (item) => !!item && (item.targetKind === 'image' || item.targetKind === 'scrap' || item.shortcutType === 'image'
                        || (item.targetKind === 'user-file' && (/^image\//.test(item.mimeType || '') || /\.(png|jpe?g|gif|bmp|webp|mpi|gsd|psd)$/i.test(item.name || '')))),
                    async onOpen(item, folderPath) {
                        if (!await self.confirmDiscard()) return;
                        if (item.targetKind === 'user-file') {
                            await self.openVfsFile(item.id, item.name, folderPath);
                        } else {
                            const name = item.previewImageFilename || item.targetId || (item.shortcutData && item.shortcutData.filename);
                            await self.openUrl(`/images/${encodeURIComponent(name)}`, item.name || name, null);
                        }
                    }
                }
            });
        }

        async encode(type, onProgress) {
            if (type === 'gsd') return root.paintGsd.encode(this, { onProgress });
            if (type === 'psd') {
                const res = await root.paintPsd.encode(this, { onProgress });
                this.psdNotes = res.notes;
                return res.blob;
            }
            if (type === 'mpi') {
                const layers = this.doc.layers.map((l) => ({
                    name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked, png: l.canvas.toDataURL('image/png'),
                    mask: l.mask ? l.mask.canvas.toDataURL('image/png') : undefined, maskOn: l.mask ? l.mask.enabled : undefined, styles: l.styles || undefined,
                    adjust: l.adjust ? { kind: l.adjust.kind, params: l.adjust.params } : undefined, text: l.text || undefined, isBackground: l.isBackground || undefined
                }));
                return new Blob([JSON.stringify({ format: 'melaton-paint', version: 1, width: this.doc.width, height: this.doc.height, active: this.doc.active, layers })], { type: 'application/json' });
            }
            const flat = this.doc.flattened({ background: type === 'image/jpeg' || type === 'image/bmp' ? '#ffffff' : undefined });
            if (type === 'image/bmp') return C().encodeBmp(flat);
            return new Promise((r) => flat.toBlob(r, type, 0.92));
        }

        typeFor(name) {
            const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1] || 'png';
            return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', webp: 'image/webp', mpi: 'mpi', gsd: 'gsd', psd: 'psd' }[ext.toLowerCase()] || 'image/png';
        }

        mimeFor(type) {
            if (type === 'gsd') return 'application/x-graphic-session';
            if (type === 'psd') return 'image/vnd.adobe.photoshop';
            if (type === 'mpi') return 'application/json';
            return type;
        }

        /** Whether a flat picture file would lose anything (layers, masks, text, guides...). */
        needsSession() {
            const d = this.doc;
            const l = d.layers[0];
            return d.layers.length > 1 || !!(l.mask || l.styles || l.adjust || l.text) || d.guides.length > 0 || d.groups.length > 0;
        }

        async save() {
            this.commitFloating();
            this.finishText();
            if (!this.file || !this.file.id) return this.saveAs();
            try {
                const type = this.typeFor(this.file.name);
                await this.withProgress(`Saving ${this.file.name}`, async (p) => {
                    const blob = await this.encode(type, this.encodeProgress(p));
                    await this.upload(p, blob, this.file.path, (data) => vfs().replaceFile(this.file.id, data, this.mimeFor(type)));
                });
                this.dirtyDoc = false;
                this.title();
                return true;
            } catch (err) {
                await this.message(`Paint cannot save ${this.file.name}.\n${(err && err.message) || ''}`);
                return false;
            }
        }

        saveAs() {
            this.commitFloating();
            this.finishText();
            if (typeof root.studioOpenFolderDialog !== 'function') return Promise.resolve(false);
            const self = this;
            const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
            return new Promise((resolve) => {
                void root.studioOpenFolderDialog('save', {
                    owner: this.modal,
                    startPath: (this.file && this.file.path) || (ws ? `/Workspaces/${ws}` : '/'),
                    host: {
                        title: 'Save As',
                        typeLabel: 'Graphic Session Document, everything kept (*.gsd); Photoshop Document (*.psd); PNG (*.png); JPEG (*.jpg); 24-bit Bitmap (*.bmp); WebP (*.webp); Melaton Paint Image (*.mpi)',
                        acceptType: 'user-file',
                        suggestName: () => (self.file ? self.file.name : `${self.name === 'Untitled' ? 'untitled' : self.name}${self.needsSession() ? '.gsd' : '.png'}`),
                        async onSave(info) {
                            let name = String(info.name || '').trim();
                            if (!name) return false;
                            if (!/\.(png|jpe?g|bmp|webp|mpi|gsd|psd)$/i.test(name)) name += self.needsSession() ? '.gsd' : '.png';
                            const type = self.typeFor(name);
                            if (type !== 'mpi' && type !== 'gsd' && type !== 'psd' && self.needsSession()) {
                                const ok = await callGlobal('showConfirmationDialog', '<p>Saving in this format will flatten the image into one layer and drop its masks, text and guides. Save anyway? To keep everything, save as a Graphic Session Document (*.gsd).</p>', [
                                    { text: 'Flatten', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
                                ], null, { title: 'Paint', width: 400 });
                                if (!ok) return false;
                            }
                            try {
                                const res = await self.withProgress(`Saving ${name}`, async (p) => {
                                    const blob = await self.encode(type, self.encodeProgress(p));
                                    return self.upload(p, blob, info.path, (data) => vfs().uploadFile(info.path || '/', data, name, self.mimeFor(type)));
                                });
                                const f = res && (res.file || res.entry || res);
                                self.file = { id: (f && (f.id || f.fileId)) || null, name, path: info.path };
                                self.name = name.replace(/\.[^.]+$/, '');
                                self.dirtyDoc = false;
                                self.title();
                                if (type === 'psd' && self.psdNotes && self.psdNotes.length) void self.message(`Saved as a Photoshop document, with these changes:\n\n${self.psdNotes.join('\n')}`);
                                resolve(true);
                                return true;
                            } catch (err) {
                                await self.message(`Paint cannot save ${name}.\n${(err && err.message) || ''}`);
                                resolve(false);
                                return false;
                            }
                        },
                        onCancel() { resolve(false); }
                    }
                });
            });
        }

        async saveToGallery(thenWallpaper) {
            this.commitFloating();
            const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'default'; // eslint-disable-line no-undef
            try {
                const res = await this.withProgress(`Saving ${this.name || 'untitled'}.png to the gallery`, async (p) => {
                    const blob = await this.encode('image/png', this.encodeProgress(p));
                    return this.upload(p, blob, 'the gallery', (data) => root.wsClient.uploadWorkspaceImage(data, ws, `${this.name || 'untitled'}.png`, { currentIndex: 0, totalCount: 1 }));
                });
                if (!res || res.success === false) throw new Error((res && res.error) || 'The gallery did not take the picture.');
                const filename = res.filename || (res.image && res.image.filename);
                // the progress dialog was the feedback; a toast only where it cannot show
                if (thenWallpaper && filename) callGlobal('openDesktopSettingsModal', `file:${filename}`);
                else if (!(root.fileOperationProgress && root.fileOperationProgress.available())) callGlobal('showGlassToast', 'success', 'Paint', 'Saved to the gallery', false, 2500);
            } catch (err) {
                await this.message(`Paint cannot save to the gallery.\n${(err && err.message) || ''}`);
            }
        }

        print() {
            const flat = this.doc.flattened({ background: '#ffffff' });
            const frame = doc.createElement('iframe');
            frame.style.cssText = 'position:fixed;right:0;bottom:0;width:0;height:0;border:0';
            doc.body.appendChild(frame);
            frame.contentDocument.write(`<!doctype html><title>${esc(this.name)}</title><style>@page{margin:0.75in}body{margin:0}img{max-width:100%}</style><img src="${flat.toDataURL('image/png')}">`);
            frame.contentDocument.close();
            setTimeout(() => {
                try { frame.contentWindow.print(); } catch (_) { /* blocked */ }
                setTimeout(() => frame.remove(), 1000);
            }, 150);
        }

        async close() {
            this.commitFloating();
            this.finishText();
            if (!await this.confirmDiscard()) return;
            if (root.paintLayers) root.paintLayers.detach(this);
            callGlobal('closeModal', this.modal);
            setTimeout(() => this.modal.remove(), 400);
            instances.delete(this);
        }

        message(text) {
            return callGlobal('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Paint', width: 360 });
        }

        // ---- menus ----------------------------------------------------------------------------

        menu(name) {
            const sel = !!(this.doc.selection || this.floating);
            const d = this.doc;
            const viewOn = (cls) => !this.modal.classList.contains(cls);
            switch (name) {
                case 'file': return [
                    { text: 'New', subtext: 'Ctrl+N', action: 'new' },
                    { text: 'Open...', subtext: 'Ctrl+O', action: 'open' },
                    { text: 'Open from Gallery...', action: 'open-gallery' },
                    { text: 'Place Embedded...', action: 'place-embedded', disabled: !root.paintSmart },
                    { text: 'Save', subtext: 'Ctrl+S', action: 'save' },
                    { text: 'Save As...', action: 'save-as' },
                    { text: 'Save to Gallery', action: 'save-gallery' },
                    { separator: true },
                    { text: 'From Scanner or Camera...', action: 'camera' },
                    { separator: true },
                    { text: 'Print...', subtext: 'Ctrl+P', action: 'print' },
                    { separator: true },
                    { text: 'Set as Desktop Background', action: 'wallpaper' },
                    { separator: true },
                    { text: 'Exit', subtext: 'Alt+F4', action: 'exit' }
                ];
                case 'edit': return [
                    { text: 'Undo', subtext: 'Ctrl+Z', action: 'undo', disabled: d.historyIndex < 0 },
                    { text: 'Repeat', subtext: 'Ctrl+Y', action: 'redo', disabled: d.historyIndex >= d.history.length - 1 },
                    { separator: true },
                    { text: 'Cut', subtext: 'Ctrl+X', action: 'cut', disabled: !sel },
                    { text: 'Copy', subtext: 'Ctrl+C', action: 'copy', disabled: !sel },
                    { text: 'Paste', subtext: 'Ctrl+V', action: 'paste' },
                    { text: 'Clear Selection', subtext: 'Del', action: 'delete', disabled: !sel },
                    { text: 'Select All', subtext: 'Ctrl+A', action: 'select-all' },
                    { separator: true },
                    { text: 'Fill...', subtext: 'Shift+F5', action: 'pro-fill' },
                    { text: 'Stroke...', action: 'pro-stroke', disabled: !this.doc.selection },
                    { text: 'Define Brush Preset...', action: 'brush-define', disabled: !root.paintBrush },
                    { separator: true },
                    { text: 'Free Transform', subtext: 'Ctrl+T', action: 'free-transform' },
                    { text: 'Transform', hasSubmenu: true, submenu: [
                        { text: 'Flip Horizontal', action: 'xf-flip-h' },
                        { text: 'Flip Vertical', action: 'xf-flip-v' },
                        { text: 'Rotate 90\u00b0 Clockwise', action: 'xf-rot-cw' },
                        { text: 'Rotate 90\u00b0 Counter Clockwise', action: 'xf-rot-ccw' },
                        { text: 'Rotate 180\u00b0', action: 'xf-rot-180' }
                    ] },
                    { separator: true },
                    { text: 'Copy To...', action: 'copy-to', disabled: !sel },
                    { text: 'Paste From...', action: 'paste-from' }
                ];
                case 'view': return [
                    { text: 'Tool Box', action: 'toolbox', showIndicator: true, checked: viewOn('mp-no-tools') },
                    { text: 'Color Box', action: 'colorbox', showIndicator: true, checked: viewOn('mp-no-colors') },
                    { text: 'Status Bar', action: 'statusbar', showIndicator: true, checked: viewOn('mp-no-status') },
                    { text: 'Tool Settings', action: 'settings', showIndicator: true, checked: viewOn('mp-no-settings') },
                    { text: 'Text Toolbar', action: 'textbar', showIndicator: true, checked: !!this.el('.mp-textbar:not([hidden])') },
                    { text: 'Layers', subtext: 'F7', action: 'layers', showIndicator: true, checked: !!(root.paintLayers && root.paintLayers.isOpen(this)) },
                    { text: 'History', subtext: 'F8', action: 'history', showIndicator: true, checked: !!(root.paintLayers && root.paintLayers.historyOpen(this)) },
                    { text: 'Navigator', action: 'pro-navigator', showIndicator: true, checked: !!(P() && P().navOpen(this)) },
                    { separator: true },
                    { text: 'Rulers', subtext: 'Ctrl+R', action: 'rulers', showIndicator: true, checked: this.rulers },
                    { text: 'Show Guides', subtext: 'Ctrl+;', action: 'guides-show', showIndicator: true, checked: this.guidesShown },
                    { text: 'Lock Guides', subtext: 'Ctrl+Alt+;', action: 'guides-lock', showIndicator: true, checked: this.guidesLocked },
                    { text: 'Snap', subtext: 'Ctrl+Shift+;', action: 'snap', showIndicator: true, checked: this.snapOn },
                    { text: 'New Guide...', action: 'guides-new' },
                    { text: 'Clear Guides', action: 'guides-clear', disabled: !this.doc.guides.length },
                    { text: 'Info', action: 'pro-info', showIndicator: true, checked: !!(P() && P().infoOpen(this)) },
                    { text: 'Paths', action: 'paths', showIndicator: true, checked: !!(root.paintPath && root.paintPath.panelOpen(this)) },
                    { text: 'Brushes', subtext: 'F5', action: 'brushes', showIndicator: true, checked: !!(root.paintBrush && root.paintBrush.panelOpen(this)) },
                    { text: 'Character', action: 'character', showIndicator: true, checked: !!(root.paintType && root.paintType.characterOpen(this)) },
                    { separator: true },
                    { text: 'Zoom', hasSubmenu: true, submenu: [
                        { text: 'Zoom In', subtext: 'Ctrl++', action: 'zoom-in' },
                        { text: 'Zoom Out', subtext: 'Ctrl+-', action: 'zoom-out' },
                        { text: 'Fit on Screen', subtext: 'Ctrl+0', action: 'zoom-fit' },
                        { text: 'Actual Pixels', subtext: 'Ctrl+1', action: 'zoom-actual' },
                        { separator: true },
                        { text: 'Normal Size', subtext: 'Ctrl+PgUp', action: 'zoom-normal' },
                        { text: 'Large Size', subtext: 'Ctrl+PgDn', action: 'zoom-large' },
                        { text: 'Custom...', action: 'zoom-custom' },
                        { separator: true },
                        { text: 'Show Grid', subtext: "Ctrl+'", action: 'grid', showIndicator: true, checked: this.grid, disabled: this.zoom < 4 },
                        { text: 'Show Thumbnail', action: 'thumbnail', disabled: this.zoom <= 1 }
                    ] },
                    { text: 'View Bitmap', subtext: 'Ctrl+F', action: 'view-bitmap' }
                ];
                case 'image': return [
                    { text: 'Flip/Rotate...', subtext: 'Ctrl+Alt+R', action: 'flip' },
                    { text: 'Resize/Skew...', subtext: 'Ctrl+Alt+I', action: 'stretch' },
                    { text: 'Invert Colors', subtext: 'Ctrl+I', action: 'invert' },
                    { text: 'Attributes...', subtext: 'Ctrl+Alt+C', action: 'attributes' },
                    { text: 'Clear Image', action: 'clear' },
                    { text: 'Crop to Selection', action: 'crop', disabled: !sel },
                    { text: 'Trim Transparent Pixels', action: 'trim' },
                    { text: 'Duplicate...', action: 'duplicate' },
                    { text: 'Draw Opaque', action: 'opaque', showIndicator: true, checked: !this.opt.transparent }
                ];
                case 'layers': return root.paintLayers ? root.paintLayers.menu(this) : [];
                case 'select': return P() ? P().selectMenu(this) : [];
                case 'adjustments': return P() ? P().adjustMenu(this) : (root.paintLayers ? root.paintLayers.adjustMenu(this) : []);
                case 'filter': return P() ? P().filterMenu(this) : [];
                case 'colors': return root.paintColor ? root.paintColor.menu(this) : [{ text: 'Edit Colors...', action: 'edit-colors' }];
                case 'help': return [
                    { text: 'Help Topics', action: 'help' },
                    { separator: true },
                    { text: 'About Paint', action: 'about' }
                ];
                default: return [];
            }
        }

        async action(a) {
            const D = root.paintDialogs;
            // the menu action a filter came from (a smart filter is kept by it)
            this.filterAction = a;
            switch (a) {
                case 'new':
                    if (!await this.confirmDiscard()) return;
                    this.newDialog();
                    return;
                case 'open': if (await this.confirmDiscard()) this.openDialog('open-vfs'); return;
                case 'open-gallery': if (await this.confirmDiscard()) this.openDialog('open-gallery'); return;
                case 'save':
                    // a Smart Object's contents save back into their layer (Photoshop's .psb)
                    if (this.smartParent && root.paintSmart) { if (root.paintSmart.pushContents(this)) this.status('The Smart Object was updated.'); return; }
                    await this.save();
                    return;
                case 'save-as': await this.saveAs(); return;
                case 'save-gallery': await this.saveToGallery(false); return;
                case 'wallpaper': await this.saveToGallery(true); return;
                case 'camera': await this.fromCamera(); return;
                case 'print': this.print(); return;
                case 'exit': await this.close(); return;
                case 'undo': if (this.xf) { this.cancelTransform(); return; } this.commitFloating(); this.finishText(); this.doc.undo(); return;
                case 'redo': this.doc.redo(); return;
                case 'cut': await this.copySelection(true); return;
                case 'copy': await this.copySelection(false); return;
                case 'paste': await this.paste(); return;
                case 'delete': this.deleteSelection(); return;
                case 'select-all': this.selectAll(); return;
                case 'copy-to': await this.copyTo(); return;
                case 'paste-from': this.pasteFrom(); return;
                case 'escape':
                    if (this.xf) { this.cancelTransform(); return; }
                    if (root.paintPath && root.paintPath.endPen(this)) return;
                    if (this.text) { this.cancelText(); return; }
                    if (this.cropBox) { this.cropBox = null; this.drawAnts(); this.renderBar(); return; }
                    if (this.lasso) { this.lasso = null; this.selBase = null; this.setSelection(this.lassoBefore || null); return; }
                    this.cancelShape();
                    if (this.floating) this.commitFloating(); else this.setSelection(null);
                    return;
                case 'enter':
                    if (this.xf) { this.commitTransform(); return; }
                    if (root.paintPath && root.paintPath.endPen(this)) return;
                    if (this.cropBox) { this.commitCrop(); return; }
                    if (this.lasso) { this.tools.polylasso.finish.call(this); return; }
                    if (this.polygon && this.tools.polygon.finish) this.tools.polygon.finish.call(this);
                    return;
                case 'free-transform': this.startTransform(); return;
                case 'align-left': case 'align-hcenter': case 'align-right': case 'align-top': case 'align-vcenter': case 'align-bottom': this.alignLayer(a.slice(6)); return;
                case 'rulers': this.toggleRulers(); return;
                case 'character': if (root.paintType) root.paintType.toggleCharacter(this); return;
                case 'quick-mask': this.toggleQuickMask(); return;
                case 'brushes': if (root.paintBrush) root.paintBrush.togglePanel(this); return;
                case 'brush-define': if (root.paintBrush) void root.paintBrush.definePreset(this); return;
                case 'guides-show': this.guidesShown = !this.guidesShown; this.drawAnts(); return;
                case 'guides-lock': this.guidesLocked = !this.guidesLocked; return;
                case 'snap': this.snapOn = !this.snapOn; return;
                case 'guides-new': this.newGuideDialog(); return;
                case 'guides-clear': this.doc.guides = []; this.drawAnts(); return;
                case 'xf-flip-h': case 'xf-flip-v': case 'xf-rot-cw': case 'xf-rot-ccw': case 'xf-rot-180': this.quickTransform(a); return;
                case 'zoom-in': this.setZoom(this.zoom * 2); return;
                case 'zoom-out': this.setZoom(this.zoom / 2); return;
                case 'zoom-fit': this.fitZoom(); return;
                case 'zoom-actual': this.setZoom(1); return;
                case 'swap-colors': [this.fg, this.bg] = [this.bg, this.fg]; this.renderColors(); return;
                case 'default-colors': this.fg = '#000000'; this.bg = '#ffffff'; this.renderColors(); return;
                case 'fill-fg': case 'fill-bg': this.quickFill(a === 'fill-fg' ? this.fg : this.bg); return;
                case 'layer-via-copy': case 'layer-via-cut': this.layerVia(a === 'layer-via-cut'); return;
                case 'trim': this.trim(); return;
                case 'duplicate': this.duplicate(); return;
                case 'toolbox': this.modal.classList.toggle('mp-no-tools'); return;
                case 'colorbox': this.modal.classList.toggle('mp-no-colors'); return;
                case 'statusbar': this.modal.classList.toggle('mp-no-status'); return;
                case 'settings': this.modal.classList.toggle('mp-no-settings'); return;
                case 'textbar': this.showTextBar(!this.el('.mp-textbar:not([hidden])')); return;
                case 'layers': if (root.paintLayers) root.paintLayers.toggle(this); return;
                case 'history': if (root.paintLayers) root.paintLayers.toggleHistory(this); return;
                case 'zoom-normal': this.setZoom(1); return;
                case 'zoom-large': this.setZoom(4); return;
                case 'zoom-custom': if (D) D.customZoom(this); return;
                case 'grid': this.grid = !this.grid; this.applyZoom(); return;
                case 'thumbnail': if (root.paintLayers) root.paintLayers.thumbnail(this); return;
                case 'view-bitmap': this.viewBitmap(); return;
                case 'flip': if (D) D.flipRotate(this); return;
                case 'stretch': if (D) D.resizeSkew(this); return;
                case 'invert': this.adjust('Invert Colors', (r, g, b) => [255 - r, 255 - g, 255 - b]); return;
                case 'attributes': if (D) D.attributes(this); return;
                case 'clear': this.clearImage(); return;
                case 'crop': this.crop(); return;
                case 'opaque': this.opt.transparent = !this.opt.transparent; this.renderOptions(); if (this.floating) this.drawFloating(); return;
                case 'edit-colors': if (root.paintColor) root.paintColor.picker(this, 'fg'); else if (D) D.editColors(this); return;
                case 'help': callGlobal('openHelpAndSupport', 'paint'); return;
                case 'about': callGlobal('openAboutMelatoninModal', { program: 'Paint' }); return;
                default:
                    if (root.paintLayers && root.paintLayers.action(this, a)) return;
                    if (root.paintSmart && root.paintSmart.action(this, a)) return;
                    if (root.paintPath && root.paintPath.action(this, a)) return;
                    if (P() && P().action(this, a)) return;
                    if (root.paintColor && root.paintColor.action(this, a)) return;
                    break;
            }
        }

        /** The encoders' progress as the first 70% of a save's bar. */
        encodeProgress(p) {
            p.line('Preparing the picture...');
            p.percent(2);
            return (f, k, n) => { p.percent(70 * f); p.line(n ? `Preparing part ${k} of ${n}...` : 'Preparing the picture...'); };
        }

        /** The last part of a save: the bytes to the server, one message (its time is unknown). */
        async upload(p, blob, where, send) {
            p.line('Packing the file...');
            p.percent(72);
            const data = await blobToBase64(blob);
            p.line(`Saving ${sizeText(blob.size)} to ${where && where !== '/' ? where : 'the server'}...`);
            p.marquee();
            const res = await send(data);
            p.percent(100);
            return res;
        }

        /** A VFS picture (Paste From, Import From File) with the dialog: its canvas, or null. */
        downloadPicture(item, verb) {
            return this.withProgress(`${verb} ${item.name}`, async (p) => {
                p.line('Asking the server for the file...');
                p.marquee();
                const res = await vfs().downloadFile(item.id);
                p.line('Downloading...');
                const bytes = await this.fetchBytes(res.downloadUrl, p, p.part(0, 85));
                p.check();
                p.line('Reading the picture...');
                p.percent(92);
                return this.decodePicture(bytes, item.mimeType);
            }, { cancellable: true });
        }

        /** File > New: the size and the Background Contents (White, Background Color, Transparent). */
        newDialog() {
            const V = root.vistaDialogTemplate;
            if (!V) { this.newDocument(this.doc.width, this.doc.height); return; }
            const tpl = { t: 'New', w: 200, h: 92, f: ['MS Shell Dlg', 8], c: [
                [-1, 'S', 7, 9, 50, 8, 0x50020000, '&Width:', 0], [101, 'E', 72, 7, 40, 12, 0x50812080, '', 0], [-1, 'S', 115, 9, 20, 8, 0x50020000, 'pixels', 0],
                [-1, 'S', 7, 25, 50, 8, 0x50020000, '&Height:', 0], [102, 'E', 72, 23, 40, 12, 0x50812080, '', 0], [-1, 'S', 115, 25, 20, 8, 0x50020000, 'pixels', 0],
                [-1, 'S', 7, 43, 64, 8, 0x50020000, 'Background &Contents:', 0], [103, 'C', 72, 41, 70, 100, 0x50210003, '', 0],
                [1, 'B', 89, 72, 50, 14, 0x50010001, 'OK', 0],
                [2, 'B', 143, 72, 50, 14, 0x50010000, 'Cancel', 0]
            ] };
            V.openDialog({
                id: 'mpNewDialog', tpl, owner: this.modal,
                init: (ctx) => {
                    ctx.set(101, String(this.doc.width));
                    ctx.set(102, String(this.doc.height));
                    ctx.options(103, [{ value: 'white', text: 'White' }, { value: 'bg', text: 'Background Color' }, { value: 'transparent', text: 'Transparent' }], reg('NewContents', 'white'));
                },
                ok: (ctx) => {
                    const w = Math.max(1, Math.min(16384, Math.round(Number(ctx.get(101)) || this.doc.width)));
                    const h = Math.max(1, Math.min(16384, Math.round(Number(ctx.get(102)) || this.doc.height)));
                    const contents = ctx.get(103);
                    setReg({ NewContents: contents });
                    this.newDocument(w, h, { transparent: contents === 'transparent', background: contents === 'bg' ? this.bg : '#ffffff' });
                }
            });
        }

        editColors(i) {
            if (root.paintDialogs) root.paintDialogs.editColors(this, i);
        }

        // ---- Free Transform ---------------------------------------------------------------------

        /** Ctrl+T: the selection (or the floating piece, or the layer's pixels) gets handles to scale and turn. */
        startTransform() {
            if (this.xf) return;
            this.finishText();
            this.cancelShape();
            if (!this.editable(!this.floating && !this.doc.selection)) return;
            const l = this.doc.layer;
            let src;
            let x;
            let y;
            let step;
            let from = null;
            if (this.floating) {
                const f = this.floating;
                src = this.opt.transparent ? this.transparentCopy(f.canvas) : f.canvas;
                x = Math.round(f.x); y = Math.round(f.y);
                step = this.floatStep || this.doc.beginStep('Free Transform', l);
                step.label = 'Free Transform';
                from = { floating: f };
                this.floating = null;
                this.floatStep = null;
                this.clearOverlay();
            } else if (this.doc.selection) {
                const s = this.doc.selection;
                step = this.doc.beginStep('Free Transform', l);
                src = this.selectionCanvas(true);
                x = s.x; y = s.y;
                from = { selection: s };
                this.doc.selection = null;
            } else if (l.vector && root.paintPath) {
                // a shape layer transforms its path (the box is the path's pixels)
                const b = this.layerBounds(l);
                if (!b) { this.status('The shape is empty.'); return; }
                step = this.doc.beginStep('Free Transform', l);
                src = C().makeCanvas(b.w, b.h);
                src.getContext('2d').drawImage(l.canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
                l.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
                x = b.x; y = b.y;
                from = { vector: b };
            } else if (l.smart) {
                // a Smart Object transforms its source, from where it last was
                step = this.doc.beginStep('Free Transform', l);
                const sx = l.smart.xf;
                l.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
                this.xf = { src: l.smart.src, ...sx, step, from: { smart: true }, x0: sx.cx - sx.w / 2, y0: sx.cy - sx.h / 2 };
                this.doc.markDirty();
                this.renderBar();
                this.drawXf();
                this.brushCursor();
                return;
            } else {
                const b = this.layerBounds(l);
                if (!b) { this.status('The layer is empty.'); return; }
                step = this.doc.beginStep('Free Transform', l);
                src = C().makeCanvas(b.w, b.h);
                src.getContext('2d').drawImage(l.canvas, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
                l.ctx.clearRect(b.x, b.y, b.w, b.h);
                x = b.x; y = b.y;
            }
            this.xf = { src, cx: x + src.width / 2, cy: y + src.height / 2, w: src.width, h: src.height, angle: 0, flipX: 1, flipY: 1, step, from, x0: x, y0: y };
            this.doc.markDirty();
            this.renderBar();
            this.drawXf();
            this.brushCursor();
        }

        /** The box round a layer's pixels (not quite transparent). */
        layerBounds(l) {
            const W = this.doc.width;
            const H = this.doc.height;
            const d = l.ctx.getImageData(0, 0, W, H).data;
            let x0 = W; let y0 = H; let x1 = -1; let y1 = -1;
            for (let y = 0; y < H; y += 1) {
                for (let x = 0; x < W; x += 1) {
                    if (d[(y * W + x) * 4 + 3] > 2) {
                        if (x < x0) x0 = x;
                        if (x > x1) x1 = x;
                        if (y < y0) y0 = y;
                        y1 = y;
                    }
                }
            }
            return x1 < 0 ? null : { x: x0, y: y0, w: x1 - x0 + 1, h: y1 - y0 + 1 };
        }

        xfCorners() {
            const t = this.xf;
            const c = Math.cos(t.angle);
            const sn = Math.sin(t.angle);
            return [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => {
                const lx = (sx * t.w) / 2;
                const ly = (sy * t.h) / 2;
                return [t.cx + lx * c - ly * sn, t.cy + lx * sn + ly * c];
            });
        }

        drawXfInto(ctx, t = this.xf) {
            ctx.save();
            ctx.imageSmoothingEnabled = true;
            ctx.imageSmoothingQuality = 'high';
            ctx.translate(t.cx, t.cy);
            ctx.rotate(t.angle);
            ctx.scale(t.flipX, t.flipY);
            ctx.drawImage(t.src, -t.w / 2, -t.h / 2, t.w, t.h);
            ctx.restore();
        }

        drawXf() {
            if (!this.xf) return;
            this.clearOverlay();
            this.drawXfInto(this.octx);
            this.drawAnts();
            const t = this.xf;
            let deg = ((t.angle * 180) / Math.PI) % 360;
            if (deg > 180) deg -= 360;
            if (deg <= -180) deg += 360;
            this.status(`W: ${((t.w / t.src.width) * 100).toFixed(1)}%  H: ${((t.h / t.src.height) * 100).toFixed(1)}%  Angle: ${deg.toFixed(1)}\u00b0   Enter applies, Esc cancels.`);
            this.updateBar();
            this.el('.mp-status-size').textContent = `${Math.round(t.w)}x${Math.round(t.h)}`;
        }

        /** Where a point is on the transform box: a handle [sx, sy], 'move' inside, 'rotate' outside. */
        xfHit(p) {
            const t = this.xf;
            const c = Math.cos(-t.angle);
            const sn = Math.sin(-t.angle);
            const dx = p.x - t.cx;
            const dy = p.y - t.cy;
            const lx = dx * c - dy * sn;
            const ly = dx * sn + dy * c;
            const tol = 6 / this.zoom;
            for (const sx of [-1, 0, 1]) {
                for (const sy of [-1, 0, 1]) {
                    if (!sx && !sy) continue;
                    if (Math.abs(lx - (sx * t.w) / 2) <= tol && Math.abs(ly - (sy * t.h) / 2) <= tol) return { kind: 'scale', sx, sy };
                }
            }
            if (Math.abs(lx) <= t.w / 2 && Math.abs(ly) <= t.h / 2) return { kind: 'move' };
            return { kind: 'rotate' };
        }

        xfCursor(hit) {
            if (hit.kind === 'move') return 'move';
            if (hit.kind === 'rotate') return 'alias';
            const ang = (Math.atan2(hit.sy, hit.sx) + this.xf.angle) * (180 / Math.PI);
            const a = ((ang % 180) + 180) % 180;
            if (a < 22.5 || a >= 157.5) return 'ew-resize';
            if (a < 67.5) return 'nwse-resize';
            if (a < 112.5) return 'ns-resize';
            return 'nesw-resize';
        }

        commitTransform() {
            const t = this.xf;
            if (!t) return;
            this.xf = null;
            const l = this.doc.layer;
            if (t.from && t.from.smart && l.smart && root.paintSmart) root.paintSmart.commitTransform(this, l, t);
            else if (t.from && t.from.vector && l.vector && root.paintPath) root.paintPath.commitTransform(this, l, t);
            else this.drawXfInto(l.ctx, t);
            t.step.grow({ x: 0, y: 0, w: this.doc.width, h: this.doc.height });
            this.doc.commitStep(t.step);
            this.clearOverlay();
            this.overlay.style.cursor = '';
            this.doc.markDirty();
            this.drawAnts();
            this.status();
            this.sizeStatus();
            this.renderBar();
        }

        cancelTransform() {
            const t = this.xf;
            if (!t) return;
            this.xf = null;
            this.clearOverlay();
            this.overlay.style.cursor = '';
            if (t.from && t.from.floating) {
                // back to the floating piece it was
                this.floating = t.from.floating;
                this.floatStep = t.step;
                this.drawFloating();
            } else {
                const l = this.doc.layer;
                if (t.step.backup) {
                    l.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
                    l.ctx.drawImage(t.step.backup, 0, 0);
                }
                t.step.backup = null;
                if (t.from && t.from.selection) this.doc.selection = t.from.selection;
            }
            this.doc.markDirty();
            this.drawAnts();
            this.status();
            this.sizeStatus();
            this.renderBar();
        }

        /** Edit > Transform > Flip / Rotate: at once on the selection or the layer (Photoshop). */
        quickTransform(a) {
            const had = !!this.xf;
            if (!had) this.startTransform();
            const t = this.xf;
            if (!t) return;
            if (a === 'xf-flip-h') t.flipX *= -1;
            else if (a === 'xf-flip-v') t.flipY *= -1;
            else t.angle += { 'xf-rot-cw': Math.PI / 2, 'xf-rot-ccw': -Math.PI / 2, 'xf-rot-180': Math.PI }[a];
            if (had) { this.drawXf(); return; }
            this.commitTransform();
        }

        // ---- Crop tool ---------------------------------------------------------------------------

        /** The crop's W / H from the options bar, or 0 for none. */
        cropRatio() {
            const r = this.opt.cropRatio;
            if (!r || r === 'free') return 0;
            let k = r === 'original' ? this.doc.width / this.doc.height : (() => { const [a, b] = r.split(':').map(Number); return a / b; })();
            if (this.opt.cropSwap) k = 1 / k;
            return k;
        }

        commitCrop() {
            const c = this.cropBox;
            this.cropBox = null;
            this.drawAnts();
            this.renderBar();
            if (!c) return;
            const r = { x: Math.round(c.x), y: Math.round(c.y), w: Math.round(c.w), h: Math.round(c.h) };
            if (r.w < 1 || r.h < 1) return;
            this.commitFloating();
            this.doc.transformAll((src) => {
                const out = C().makeCanvas(r.w, r.h);
                out.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
                return out;
            }, 'Crop');
        }

        // ---- the Photoshop odds and ends ----------------------------------------------------------

        /** Alt+Backspace / Ctrl+Backspace: fill the selection (or the layer) with the drawing / background color. */
        quickFill(color) {
            this.commitFloating();
            const s = this.doc.selection;
            const r = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
            this.commitToLayer('Fill', (ctx) => { ctx.fillStyle = color; ctx.fillRect(r.x, r.y, r.w, r.h); }, r);
        }

        /** Ctrl+J / Ctrl+Shift+J: the selection on a new layer (copied or cut); no selection duplicates the layer. */
        layerVia(cut) {
            this.commitFloating();
            this.finishText();
            const d = this.doc;
            const s = d.selection;
            if (!s) { d.snapshotStep('Duplicate Layer', () => d.duplicateLayer(d.active)); return; }
            if (cut && !this.editable()) return;
            d.snapshotStep(cut ? 'Layer via Cut' : 'Layer via Copy', () => {
                const piece = this.selectionCanvas(cut);
                const layer = d.addLayer(`Layer ${d.layers.length + 1}`);
                layer.ctx.drawImage(piece, s.x, s.y);
            });
            this.setSelection(null);
        }

        /** The Move tool's Align buttons: the layer's pixels (or the floating piece) to the selection's edge, else the canvas's. */
        alignLayer(how) {
            const d = this.doc;
            const target = d.selection ? { x: d.selection.x, y: d.selection.y, w: d.selection.w, h: d.selection.h } : { x: 0, y: 0, w: d.width, h: d.height };
            const f = this.floating;
            const b = f ? { x: f.x, y: f.y, w: f.w, h: f.h } : this.layerBounds(d.layer);
            if (!b) return;
            let dx = 0;
            let dy = 0;
            if (how === 'left') dx = target.x - b.x;
            else if (how === 'right') dx = target.x + target.w - (b.x + b.w);
            else if (how === 'hcenter') dx = Math.round(target.x + target.w / 2 - (b.x + b.w / 2));
            else if (how === 'top') dy = target.y - b.y;
            else if (how === 'bottom') dy = target.y + target.h - (b.y + b.h);
            else dy = Math.round(target.y + target.h / 2 - (b.y + b.h / 2));
            if (!dx && !dy) return;
            if (f) { f.x += dx; f.y += dy; this.drawFloating(); return; }
            if (!this.editable()) return;
            const l = d.layer;
            if (l.text) {
                d.snapshotStep('Align', () => { l.text.x += dx; l.text.y += dy; this.renderTextLayer(l); });
            } else {
                const step = d.beginStep('Align', l);
                const copy = C().makeCanvas(d.width, d.height);
                copy.getContext('2d').drawImage(l.canvas, 0, 0);
                l.ctx.clearRect(0, 0, d.width, d.height);
                l.ctx.drawImage(copy, dx, dy);
                step.grow({ x: 0, y: 0, w: d.width, h: d.height });
                d.commitStep(step);
            }
            d.markDirty();
            this.moveBoxStale = true;
            this.drawAnts();
        }

        /** Image > Trim: crop away the transparent edges of the picture. */
        trim() {
            this.commitFloating();
            const flat = this.doc.flattened();
            const tmp = { ctx: flat.getContext('2d') };
            const b = this.layerBounds(tmp);
            if (!b || (b.w === this.doc.width && b.h === this.doc.height)) return;
            this.doc.transformAll((src) => {
                const out = C().makeCanvas(b.w, b.h);
                out.getContext('2d').drawImage(src, b.x, b.y, b.w, b.h, 0, 0, b.w, b.h);
                return out;
            }, 'Trim');
        }

        /** Image > Duplicate: the picture, flattened, in a new Paint window. */
        async duplicate() {
            this.commitFloating();
            const flat = this.doc.flattened();
            const w = await openMelatonPaint({ name: `${this.name} copy` });
            w.newDocument(flat.width, flat.height, { silent: true });
            w.doc.layer.ctx.clearRect(0, 0, flat.width, flat.height);
            w.doc.layer.ctx.drawImage(flat, 0, 0);
            w.doc.markDirty();
            w.name = `${this.name} copy`;
            w.dirtyDoc = true;
            w.title();
        }

        /** An adjustment over the selection (or the whole layer): fn(r, g, b) -> [r, g, b]. */
        adjust(label, fn) {
            this.commitFloating();
            if (!this.editable()) return;
            const s = this.doc.selection;
            const rect = s ? { x: s.x, y: s.y, w: s.w, h: s.h } : { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
            const r = C().clampRect(rect, this.doc.width, this.doc.height);
            if (!r) return;
            const step = this.doc.beginStep(label, this.doc.layer, r);
            C().mapPixels(this.doc.layer.ctx, r, fn, s && s.mask, this.doc.width);
            this.doc.commitStep(step);
            this.doc.markDirty(r);
        }

        clearImage() {
            this.commitFloating();
            if (!this.editable()) return;
            const r = { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
            this.commitToLayer('Clear Image', (ctx) => {
                if (this.doc.layer.isBackground) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, r.w, r.h); } else ctx.clearRect(0, 0, r.w, r.h);
            }, r, { direct: true });
        }

        crop() {
            const s = this.floating || this.doc.selection;
            if (!s) return;
            this.commitFloating();
            const r = C().clampRect(s, this.doc.width, this.doc.height);
            if (!r) return;
            this.doc.transformAll((src) => {
                const c = C().makeCanvas(r.w, r.h);
                c.getContext('2d').drawImage(src, r.x, r.y, r.w, r.h, 0, 0, r.w, r.h);
                return c;
            }, 'Crop');
        }

        viewBitmap() {
            const flat = this.doc.flattened();
            const v = doc.createElement('div');
            v.className = 'mp-viewbitmap';
            v.innerHTML = `<img src="${flat.toDataURL('image/png')}" alt="">`;
            const close = () => v.remove();
            v.addEventListener('click', close);
            doc.addEventListener('keydown', close, { once: true });
            doc.body.appendChild(v);
        }

        async copyTo() {
            const src = this.floating ? this.floating.canvas : this.selectionCanvas(false);
            if (!src) return;
            const keep = { doc: this.doc };
            const tmp = new (C().Document)(src.width, src.height, { transparent: true });
            tmp.layer.ctx.drawImage(src, 0, 0);
            this.doc = tmp;
            const prevFile = this.file;
            const prevName = this.name;
            this.file = null;
            await this.saveAs();
            this.doc = keep.doc;
            this.file = prevFile;
            this.name = prevName;
            this.title();
        }

        pasteFrom() {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            const self = this;
            void root.studioOpenFolderDialog('open-vfs', {
                owner: this.modal,
                host: {
                    title: 'Paste From',
                    rejectMessage: 'Choose a picture',
                    acceptItem: (item) => item && item.targetKind === 'user-file' && /^image\//.test(item.mimeType || ''),
                    async onOpen(item) {
                        const c = await self.downloadPicture(item, 'Pasting');
                        if (c) self.pasteCanvas(c);
                    }
                }
            });
        }

        /** File > From Scanner or Camera: a frame from the browser's camera, pasted in. */
        async fromCamera() {
            let stream = null;
            try {
                stream = await navigator.mediaDevices.getUserMedia({ video: true });
                const video = doc.createElement('video');
                video.srcObject = stream;
                video.muted = true;
                await video.play();
                await new Promise((r) => setTimeout(r, 400));
                const c = C().makeCanvas(video.videoWidth, video.videoHeight);
                c.getContext('2d').drawImage(video, 0, 0);
                this.pasteCanvas(c);
            } catch (_) {
                await this.message('Paint could not find a scanner or camera this browser can use.');
            } finally {
                if (stream) stream.getTracks().forEach((t) => t.stop());
            }
        }
    }

    // ---- the tools ---------------------------------------------------------------------------

    const T = {};

    // the brush: Photoshop's tip engine (paintBrush.js) with pen pressure; Vista's slash shapes keep
    // their one-pixel lines
    T.brush = {
        down(p, ev) {
            const shape = String(this.opt.brush).split('-')[0];
            this.legacyDab = !root.paintBrush || shape === 'slash' || shape === 'backslash';
            if (this.legacyDab) { T.pencil.down.call(this, p, ev); return; }
            if (!this.beginStroke(false)) return;
            this.last = p;
            this.lastPr = root.paintBrush.pressureOf(ev);
            root.paintBrush.begin(this);
            this.growStroke(root.paintBrush.stroke(this, p, p, this.lastPr, this.lastPr, this.splitAlpha(this.color()).opaque, this.brushSize()));
        },
        move(p, ev, down) {
            if (this.legacyDab) { T.pencil.move.call(this, p, ev, down); return; }
            if (!down || !this.sctx) return;
            const pr = root.paintBrush.pressureOf(ev);
            const r = root.paintBrush.stroke(this, this.last, p, this.lastPr, pr, this.splitAlpha(this.color()).opaque, this.brushSize());
            if (r) this.growStroke(r);
            this.last = p;
            this.lastPr = pr;
        },
        up() { this.endStroke(); }
    };

    T.pencil = {
        down(p) {
            if (!this.beginStroke(false)) return;
            this.last = p;
            this.growStroke(this.strokeDab(p.x, p.y, p.x, p.y, this.tool === 'pencil' ? (this.opt.size > 0 ? this.opt.size : 1) : this.brushSize(), this.color()));
        },
        move(p, ev, down) {
            if (!down || !this.sctx) return;
            this.growStroke(this.strokeDab(this.last.x, this.last.y, p.x, p.y, this.tool === 'pencil' ? (this.opt.size > 0 ? this.opt.size : 1) : this.brushSize(), this.color()));
            this.last = p;
        },
        up() { this.endStroke(); }
    };

    T.eraser = {
        down(p) {
            // the Background layer takes the background color (Vista); a layer above it goes transparent.
            // Right-drag is the Color Eraser: only the drawing color turns into the background color.
            // the Background layer takes the background colour; any other layer goes transparent
            const upper = !this.doc.layer.isBackground && !this.doc.layer.isMask;
            if (this.right) {
                if (!this.editable()) return;
                this.colorErase = this.doc.beginStep('Color Eraser', this.doc.layer);
                this.last = p;
                T.eraser.colorDab.call(this, p, p);
                return;
            }
            if (!this.beginStroke(upper)) return;
            this.last = p;
            this.growStroke(this.strokeDab(p.x, p.y, p.x, p.y, this.brushSize(), upper ? '#000' : this.bg));
        },
        colorDab(a, b) {
            const s = this.brushSize();
            const r = C().clampRect({ x: Math.min(a.x, b.x) - s, y: Math.min(a.y, b.y) - s, w: Math.abs(b.x - a.x) + 2 * s, h: Math.abs(b.y - a.y) + 2 * s }, this.doc.width, this.doc.height);
            if (!r) return;
            const [fr, fg, fb] = C().parseColor(this.fg);
            const [br, bg, bb] = C().parseColor(this.bg);
            const ctx = this.doc.layer.ctx;
            const img = ctx.getImageData(r.x, r.y, r.w, r.h);
            const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y)));
            const hit = new Uint8Array(r.w * r.h);
            for (let i = 0; i <= steps; i += 1) {
                const cx = a.x + ((b.x - a.x) * i) / steps - r.x;
                const cy = a.y + ((b.y - a.y) * i) / steps - r.y;
                for (let y = Math.max(0, Math.floor(cy - s / 2)); y < Math.min(r.h, Math.ceil(cy + s / 2)); y += 1) {
                    for (let x = Math.max(0, Math.floor(cx - s / 2)); x < Math.min(r.w, Math.ceil(cx + s / 2)); x += 1) hit[y * r.w + x] = 1;
                }
            }
            for (let k = 0; k < hit.length; k += 1) {
                if (!hit[k]) continue;
                const o = k * 4;
                if (img.data[o] === fr && img.data[o + 1] === fg && img.data[o + 2] === fb) { img.data[o] = br; img.data[o + 1] = bg; img.data[o + 2] = bb; }
            }
            ctx.putImageData(img, r.x, r.y);
            this.colorErase.grow(r);
            this.doc.markDirty(r);
        },
        move(p, ev, down) {
            if (!down) return;
            if (this.colorErase) { T.eraser.colorDab.call(this, this.last, p); this.last = p; return; }
            if (!this.sctx) return;
            this.growStroke(this.strokeDab(this.last.x, this.last.y, p.x, p.y, this.brushSize(), !this.doc.layer.isBackground && !this.doc.layer.isMask ? '#000' : this.bg));
            this.last = p;
        },
        up() {
            if (this.colorErase) { this.doc.commitStep(this.colorErase); this.colorErase = null; return; }
            this.endStroke();
        }
    };

    T.airbrush = {
        down(p) {
            if (!this.beginStroke(false)) return;
            this.last = p;
            const spray = () => {
                const s = this.brushSize();
                const ctx = this.sctx;
                if (!ctx) return;
                ctx.fillStyle = this.color();
                for (let i = 0; i < s * 2; i += 1) {
                    const a = Math.random() * Math.PI * 2;
                    const d = Math.random() * s / 2;
                    ctx.fillRect(Math.round(this.last.x + Math.cos(a) * d), Math.round(this.last.y + Math.sin(a) * d), 1, 1);
                }
                this.growStroke(C().rectAround(this.last.x, this.last.y, s));
            };
            spray();
            this.sprayTimer = setInterval(spray, 30);
        },
        move(p, ev, down) { if (down) this.last = p; },
        up() { clearInterval(this.sprayTimer); this.endStroke(); }
    };

    T.fill = {
        down(p) {
            if (!this.editable()) return;
            const x = Math.floor(p.x);
            const y = Math.floor(p.y);
            if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
            const l = this.doc.layer;
            const img = l.ctx.getImageData(0, 0, this.doc.width, this.doc.height);
            const s = this.doc.selection;
            const step = this.doc.beginStep('Fill With Color', l);
            const rgba = C().parseColor(this.color());
            // the options bar's Opacity works like the colour's alpha
            rgba[3] = Math.round(rgba[3] * (this.opt.opacity / 100));
            const mask = s && (s.mask || (P() && P().maskOf(this.doc, s)));
            const tol = this.opt.tolerance > 32 ? this.opt.tolerance - 32 : 0;
            let rect;
            if (rgba[3] < 255) {
                // a see-through colour is laid over the area instead of replacing it
                const res = this.opt.contiguous ? C().wandMask(img, x, y, tol) : C().colorMask(img, x, y, tol);
                if (!res) return;
                const d = img.data;
                const a = rgba[3] / 255;
                for (let i = 0; i < res.mask.length; i += 1) {
                    if (!res.mask[i] || (mask && !mask[i])) continue;
                    const o = i * 4;
                    const ao = d[o + 3] / 255;
                    const na = a + ao * (1 - a);
                    d[o] = (rgba[0] * a + d[o] * ao * (1 - a)) / na; d[o + 1] = (rgba[1] * a + d[o + 1] * ao * (1 - a)) / na; d[o + 2] = (rgba[2] * a + d[o + 2] * ao * (1 - a)) / na;
                    d[o + 3] = na * 255;
                }
                rect = res.rect;
            } else rect = this.opt.contiguous ? C().floodFill(img, x, y, rgba, tol, mask) : C().replaceColor(img, x, y, rgba, tol, mask);
            if (!rect) return;
            l.ctx.putImageData(img, 0, 0, rect.x, rect.y, rect.w, rect.h);
            step.grow(rect);
            this.doc.commitStep(step);
            this.doc.markDirty(rect);
        }
    };

    T.picker = {
        down(p) {
            const x = Math.floor(p.x);
            const y = Math.floor(p.y);
            if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
            // Sample Size: the average of n x n pixels; Sample: the active layer (its alpha too) or all
            const n = Number(this.opt.sampleSize) || 1;
            const r0 = C().clampRect({ x: x - Math.floor(n / 2), y: y - Math.floor(n / 2), w: n, h: n }, this.doc.width, this.doc.height);
            const avg = (ctx) => {
                const a = ctx.getImageData(r0.x, r0.y, r0.w, r0.h).data;
                const s = [0, 0, 0, 0];
                let wsum = 0;
                for (let i = 0; i < a.length; i += 4) {
                    const al = a[i + 3];
                    s[0] += a[i] * al; s[1] += a[i + 1] * al; s[2] += a[i + 2] * al; s[3] += al; wsum += al;
                }
                const k = a.length / 4;
                return wsum ? [s[0] / wsum, s[1] / wsum, s[2] / wsum, s[3] / k] : [0, 0, 0, 0];
            };
            const d = avg(this.vctx);
            const l = avg(this.doc.layer.ctx);
            const src = this.opt.sampleAll || this.doc.layer.isMask ? [d[0], d[1], d[2], 255] : (l[3] ? [l[0], l[1], l[2], l[3]] : [d[0], d[1], d[2], 255]);
            const c = root.paintColor ? root.paintColor.hex(...src) : `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
            if (this.right) this.bg = c; else this.fg = c;
            this.renderColors();
        },
        up() { this.setTool(this.prevTool || 'pencil'); }
    };

    T.magnifier = {
        down(p, ev) {
            const r = this.workspace.getBoundingClientRect();
            const at = { x: p.x, y: p.y, cx: ev.clientX - r.left, cy: ev.clientY - r.top };
            const out = (!!this.opt.zoomOut !== !!(ev && ev.altKey)) !== !!this.right;
            this.setZoom(out ? this.zoom / 2 : this.zoom * 2, at);
            this.opt.zoomLevel = this.zoom;
            this.renderOptions();
        }
    };

    T.text = {
        down(p) {
            // the text box sits above the canvas, so a click that reaches here is outside it
            if (this.text) { this.finishText(); return; }
            // a click on a type layer's text opens it again (the active layer first)
            const d = this.doc;
            const inside = (r) => p.x >= r.x && p.y >= r.y && p.x <= r.x + r.w && p.y <= r.y + r.h;
            const hit = [d.activeLayer, ...d.layers.slice().reverse()].find((l) => l && l.text && l.visible && inside(this.textBounds(l)));
            if (hit) {
                d.active = d.layers.indexOf(hit);
                d.editMask = false;
                if (root.paintLayers) root.paintLayers.refresh(this);
                this.startText(p, hit);
                return;
            }
            this.startText(p);
        }
    };

    function shapeTool(kind, square) {
        return {
            down(p) { this.shape = { a: p, b: p, c1: this.color(), c2: this.color(true) }; },
            move(p, ev, down) {
                if (!down || !this.shape) return;
                this.shape.b = this.constrain(this.shape.a, p, ev, square);
                this.clearOverlay();
                this.octx.save();
                this.clipToSelection(this.octx);
                this.drawShape(this.octx, kind, this.shape.a, this.shape.b, this.shape.c1, this.shape.c2);
                this.octx.restore();
            },
            up() {
                const s = this.shape;
                this.shape = null;
                this.clearOverlay();
                if (!s || (s.a.x === s.b.x && s.a.y === s.b.y && kind !== 'line')) return;
                // Photoshop's Shape and Path modes: a shape layer, or a path, not pixels
                if (this.opt.shapeMode && this.opt.shapeMode !== 'pixels' && root.paintPath) { root.paintPath.fromShapeTool(this, kind, s); return; }
                const lw = this.brushSize();
                const rect = { x: Math.min(s.a.x, s.b.x) - lw, y: Math.min(s.a.y, s.b.y) - lw, w: Math.abs(s.b.x - s.a.x) + 2 * lw, h: Math.abs(s.b.y - s.a.y) + 2 * lw };
                this.commitToLayer(TOOLS.find((t) => t[0] === this.tool)[1], (ctx) => {
                    ctx.globalAlpha = this.opt.opacity / 100;
                    this.drawShape(ctx, kind, s.a, s.b, s.c1, s.c2);
                }, rect);
            }
        };
    }

    T.vtext = T.text;
    T.textmask = T.text;
    T.vtextmask = T.text;

    T.line = shapeTool('line');
    T.rect = shapeTool('rect', true);
    T.ellipse = shapeTool('ellipse', true);
    T.roundrect = shapeTool('roundrect', true);

    /** Vista's curve: drag the line, then click (or drag) twice to bend it. */
    T.curve = {
        down(p) {
            if (!this.curve) this.curve = { pts: [p, p], stage: 0, c: this.color() };
            else this.curve.stage += 1;
            T.curve.move.call(this, p, null, true);
        },
        move(p, ev, down) {
            const c = this.curve;
            if (!c || !down) return;
            if (c.stage === 0) c.pts[1] = p;
            else if (c.stage === 1) { c.c1 = p; c.c2 = p; } else c.c2 = p;
            this.clearOverlay();
            T.curve.draw.call(this, this.octx, c);
        },
        draw(ctx, c) {
            ctx.save();
            ctx.lineWidth = this.brushSize();
            ctx.strokeStyle = c.c;
            ctx.lineCap = 'round';
            ctx.beginPath();
            ctx.moveTo(c.pts[0].x, c.pts[0].y);
            if (c.c1) ctx.bezierCurveTo(c.c1.x, c.c1.y, (c.c2 || c.c1).x, (c.c2 || c.c1).y, c.pts[1].x, c.pts[1].y);
            else ctx.lineTo(c.pts[1].x, c.pts[1].y);
            ctx.stroke();
            ctx.restore();
        },
        up() {
            const c = this.curve;
            if (!c || c.stage < 2) return;
            this.curve = null;
            this.clearOverlay();
            this.commitToLayer('Curve', (ctx) => { ctx.globalAlpha = this.opt.opacity / 100; T.curve.draw.call(this, ctx, c); });
        }
    };

    T.polygon = {
        down(p) {
            const g = this.polygon;
            if (!g) { this.polygon = { pts: [p, p], c1: this.color(), c2: this.color(true) }; return; }
            const first = g.pts[0];
            if (Math.hypot(first.x - p.x, first.y - p.y) < 4 / this.zoom && g.pts.length > 3) { T.polygon.finish.call(this); return; }
            g.pts.push(p);
        },
        move(p, ev) {
            const g = this.polygon;
            if (!g) return;
            g.pts[g.pts.length - 1] = ev && ev.shiftKey ? this.constrain(g.pts[g.pts.length - 2], p, ev) : p;
            this.clearOverlay();
            T.polygon.draw.call(this, this.octx, g, false);
        },
        dbl() { T.polygon.finish.call(this); },
        draw(ctx, g, closed) {
            ctx.save();
            ctx.lineWidth = this.brushSize();
            ctx.strokeStyle = g.c1;
            ctx.fillStyle = this.opt.shape === 'fill' ? g.c1 : g.c2;
            ctx.lineJoin = 'round';
            ctx.beginPath();
            g.pts.forEach((q, i) => (i ? ctx.lineTo(q.x, q.y) : ctx.moveTo(q.x, q.y)));
            if (closed) {
                ctx.closePath();
                if (this.opt.shape !== 'outline') ctx.fill();
                if (this.opt.shape !== 'fill') ctx.stroke();
            } else ctx.stroke();
            ctx.restore();
        },
        finish() {
            const g = this.polygon;
            this.polygon = null;
            this.clearOverlay();
            if (!g || g.pts.length < 3) return;
            this.commitToLayer('Polygon', (ctx) => { ctx.globalAlpha = this.opt.opacity / 100; T.polygon.draw.call(this, ctx, g, true); });
        }
    };

    /** An ellipse inside a box, as a path (for the Elliptical Select). */
    function ellipsePath(r) {
        const pts = [];
        const n = Math.max(24, Math.min(256, Math.round((r.w + r.h) / 3)));
        for (let i = 0; i < n; i += 1) {
            const a = (i / n) * Math.PI * 2;
            pts.push({ x: r.x + r.w / 2 + (Math.cos(a) * r.w) / 2, y: r.y + r.h / 2 + (Math.sin(a) * r.h) / 2 });
        }
        return pts;
    }

    /**
     * Select / Free-Form Select / Elliptical Select: drag out a selection; drag inside one to move it
     * (Ctrl copies). Shift at the start adds, Alt subtracts, both intersect (Photoshop).
     */
    function selectTool(kind) {
        return {
            down(p, ev) {
                const s = this.floating || this.doc.selection;
                const mode = this.selModeFor(ev);
                const inside = s && p.x >= s.x && p.y >= s.y && p.x <= s.x + s.w && p.y <= s.y + s.h
                    && (!s.mask || this.floating || s.mask[Math.floor(p.y) * this.doc.width + Math.floor(p.x)] > 0);
                if (inside && mode === 'new') {
                    if (!this.floating) this.liftSelection(ev.ctrlKey);
                    else if (ev.ctrlKey) {
                        // Ctrl-drag a floating piece leaves a copy behind
                        const f = this.floating;
                        this.doc.layer.ctx.drawImage(this.opt.transparent ? this.transparentCopy(f.canvas) : f.canvas, Math.round(f.x), Math.round(f.y));
                        this.floatStep.grow({ x: Math.round(f.x), y: Math.round(f.y), w: f.w, h: f.h });
                        this.doc.markDirty({ x: f.x, y: f.y, w: f.w, h: f.h });
                    }
                    this.drag = { x: p.x - this.floating.x, y: p.y - this.floating.y };
                    return;
                }
                this.commitFloating();
                this.drag = null;
                this.sel = kind === 'free' ? { pts: [p] } : { a: p, b: p };
                if (this.doc.selection) this.lastSelection = this.doc.selection;
                this.selBase = mode !== 'new' ? this.doc.selection : null;
                this.selModeNow = mode;
                this.doc.selection = null;
                this.drawAnts();
            },
            move(p, ev, down) {
                if (!down) return;
                if (this.drag && this.floating) {
                    this.floating.x = Math.round(p.x - this.drag.x);
                    this.floating.y = Math.round(p.y - this.drag.y);
                    this.drawFloating();
                    return;
                }
                if (!this.sel) return;
                let sel;
                if (kind === 'free') {
                    this.sel.pts.push(p);
                    sel = T.freeselect.bounds(this.sel.pts);
                    sel.path = this.sel.pts.slice();
                } else {
                    // Alt after the start draws from the centre (Photoshop)
                    this.sel.b = this.constrain(this.sel.a, p, ev, true);
                    // the options bar's Style: Fixed Ratio keeps W:H, Fixed Size is W x H wherever it is dragged
                    const st = this.opt.selStyle;
                    if (st === 'ratio' || st === 'size') {
                        const sx = p.x >= this.sel.a.x ? 1 : -1;
                        const sy = p.y >= this.sel.a.y ? 1 : -1;
                        let bw;
                        let bh;
                        if (st === 'size') { bw = this.opt.selW; bh = this.opt.selH; } else {
                            const k = this.opt.selW / Math.max(1, this.opt.selH);
                            bw = Math.max(Math.abs(p.x - this.sel.a.x), Math.abs(p.y - this.sel.a.y) * k);
                            bh = bw / k;
                        }
                        this.sel.b = { x: this.sel.a.x + sx * bw, y: this.sel.a.y + sy * bh };
                    }
                    let a = this.sel.a;
                    let b = this.sel.b;
                    if (ev && ev.altKey && this.selModeNow === 'new') { a = { x: 2 * a.x - b.x, y: 2 * a.y - b.y }; }
                    sel = this.rectOf(a, b);
                    if (kind === 'ellipse') {
                        const raw = { x: Math.min(a.x, b.x), y: Math.min(a.y, b.y), w: Math.abs(b.x - a.x), h: Math.abs(b.y - a.y) };
                        sel.path = ellipsePath(raw);
                    }
                }
                this.doc.selection = sel;
                this.drawAnts();
                this.sizeStatus();
            },
            up() {
                if (this.drag) { this.drag = null; return; }
                if (!this.sel) return;
                this.sel = null;
                this.finishSelection(this.doc.selection);
            }
        };
    }

    T.select = selectTool('rect');
    T.freeselect = selectTool('free');
    T.ellipseselect = selectTool('ellipse');
    T.freeselect.bounds = (pts) => {
        const xs = pts.map((p) => p.x);
        const ys = pts.map((p) => p.y);
        const x = Math.floor(Math.min(...xs));
        const y = Math.floor(Math.min(...ys));
        return { x, y, w: Math.ceil(Math.max(...xs)) - x, h: Math.ceil(Math.max(...ys)) - y };
    };
    PaintWindow.prototype.rectOf = function (a, b) {
        const x = Math.floor(Math.max(0, Math.min(a.x, b.x)));
        const y = Math.floor(Math.max(0, Math.min(a.y, b.y)));
        return { x, y, w: Math.min(this.doc.width, Math.ceil(Math.max(a.x, b.x))) - x, h: Math.min(this.doc.height, Math.ceil(Math.max(a.y, b.y))) - y };
    };

    /** Polygonal Lasso: click the corners; double-click, Enter or a click on the first one closes it. */
    T.polylasso = {
        down(p, ev) {
            const g = this.lasso;
            if (!g) {
                this.commitFloating();
                this.lassoBefore = this.doc.selection;
                const mode = this.selModeFor(ev);
                if (this.doc.selection) this.lastSelection = this.doc.selection;
                this.selBase = mode !== 'new' ? this.doc.selection : null;
                this.selModeNow = mode;
                this.lasso = { pts: [p, p] };
                T.polylasso.show.call(this);
                return;
            }
            const first = g.pts[0];
            if (g.pts.length > 3 && Math.hypot(first.x - p.x, first.y - p.y) < 5 / this.zoom) { T.polylasso.finish.call(this); return; }
            g.pts.push(p);
        },
        move(p, ev) {
            const g = this.lasso;
            if (!g) return;
            g.pts[g.pts.length - 1] = ev && ev.shiftKey ? this.constrain(g.pts[g.pts.length - 2], p, ev) : p;
            T.polylasso.show.call(this);
        },
        dbl() { T.polylasso.finish.call(this); },
        show() {
            const sel = T.freeselect.bounds(this.lasso.pts);
            sel.path = this.lasso.pts.slice();
            sel.open = true;
            this.doc.selection = sel;
            this.drawAnts();
        },
        finish() {
            const g = this.lasso;
            this.lasso = null;
            if (!g) return;
            // a double-click adds the same corner twice
            const pts = g.pts.filter((q, i) => !i || Math.hypot(q.x - g.pts[i - 1].x, q.y - g.pts[i - 1].y) > 0.5);
            if (pts.length < 3) { this.finishSelection(null); return; }
            const sel = T.freeselect.bounds(pts);
            sel.path = pts;
            this.finishSelection(sel);
        }
    };

    T.wand = {
        down(p, ev) {
            const x = Math.floor(p.x);
            const y = Math.floor(p.y);
            if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
            const s = this.floating || this.doc.selection;
            const mode = this.selModeFor(ev);
            if (s && mode === 'new' && p.x >= s.x && p.y >= s.y && p.x <= s.x + s.w && p.y <= s.y + s.h && this.doc.selection && this.doc.selection.mask && this.doc.selection.mask[y * this.doc.width + x]) {
                // drag a wand selection like the other selections
                T.select.down.call(this, p, ev);
                this.wandDrag = true;
                return;
            }
            this.commitFloating();
            const src = this.opt.sampleAll ? this.doc.flattened().getContext('2d') : this.doc.layer.ctx;
            const img = src.getImageData(0, 0, this.doc.width, this.doc.height);
            const res = this.opt.contiguous ? C().wandMask(img, x, y, this.opt.tolerance) : C().colorMask(img, x, y, this.opt.tolerance);
            if (this.doc.selection) this.lastSelection = this.doc.selection;
            this.selBase = mode !== 'new' ? this.doc.selection : null;
            this.selModeNow = mode;
            this.finishSelection(res ? { ...res.rect, mask: res.mask } : null);
        },
        move(p, ev, down) { if (this.wandDrag) T.select.move.call(this, p, ev, down); },
        up(p, ev) { if (this.wandDrag) { this.wandDrag = false; T.select.up.call(this, p, ev); } }
    };

    T.move = {
        down(p, ev) {
            // Auto-Select Layer: the top visible layer with a pixel under the pointer becomes the active one
            if (this.opt.autoSelect && !this.doc.selection && !this.floating) {
                const x = Math.floor(p.x);
                const y = Math.floor(p.y);
                const d = this.doc;
                for (let i = d.layers.length - 1; i >= 0; i -= 1) {
                    const l = d.layers[i];
                    if (!l.visible || l.adjust || x < 0 || y < 0 || x >= d.width || y >= d.height) continue;
                    if (l.ctx.getImageData(x, y, 1, 1).data[3] > 10) {
                        if (i !== d.active) { d.active = i; d.editMask = false; if (root.paintLayers) root.paintLayers.refresh(this); this.moveBoxStale = true; }
                        break;
                    }
                }
            }
            if (this.doc.selection || this.floating) { T.select.down.call(this, p, ev); this.moveSel = true; return; }
            if (!this.editable()) return;
            const l = this.doc.layer;
            this.moveLayer = { start: p, snap: C().makeCanvas(this.doc.width, this.doc.height), step: this.doc.beginStep('Move', l) };
            this.moveLayer.snap.getContext('2d').drawImage(l.canvas, 0, 0);
        },
        move(p, ev, down) {
            if (this.moveSel) { T.select.move.call(this, p, ev, down); return; }
            const m = this.moveLayer;
            if (!m || !down) return;
            const l = this.doc.layer;
            l.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
            l.ctx.drawImage(m.snap, Math.round(p.x - m.start.x), Math.round(p.y - m.start.y));
            this.doc.markDirty();
        },
        up(p, ev) {
            if (this.moveSel) { this.moveSel = false; T.select.up.call(this, p, ev); return; }
            const m = this.moveLayer;
            this.moveLayer = null;
            if (!m) return;
            const l = this.doc.layer;
            if (l.text) {
                // a type layer moves its text, so it stays editable
                const dx = Math.round(p.x - m.start.x);
                const dy = Math.round(p.y - m.start.y);
                l.ctx.clearRect(0, 0, this.doc.width, this.doc.height);
                l.ctx.drawImage(m.snap, 0, 0);
                m.step.backup = null;
                if (dx || dy) this.doc.snapshotStep('Move', () => { l.text.x += dx; l.text.y += dy; this.renderTextLayer(l); });
                return;
            }
            m.step.grow({ x: 0, y: 0, w: this.doc.width, h: this.doc.height });
            if (l.smart && root.paintSmart) root.paintSmart.moved(this, l, m.step, Math.round(p.x - m.start.x), Math.round(p.y - m.start.y));
            if (l.vector && root.paintPath) root.paintPath.moved(this, l, m.step, Math.round(p.x - m.start.x), Math.round(p.y - m.start.y));
            this.doc.commitStep(m.step);
            this.moveBoxStale = true;
            this.drawAnts();
        }
    };

    T.gradient = {
        down(p) { this.shape = { a: p, b: p }; },
        move(p, ev, down) {
            if (!down || !this.shape) return;
            this.shape.b = this.constrain(this.shape.a, p, ev);
            this.clearOverlay();
            this.octx.save();
            this.octx.strokeStyle = '#000';
            this.octx.setLineDash([4 / this.zoom, 4 / this.zoom]);
            this.octx.lineWidth = 1 / this.zoom;
            this.octx.beginPath();
            this.octx.moveTo(this.shape.a.x, this.shape.a.y);
            this.octx.lineTo(this.shape.b.x, this.shape.b.y);
            this.octx.stroke();
            this.octx.restore();
        },
        up() {
            const s = this.shape;
            this.shape = null;
            this.clearOverlay();
            if (!s) return;
            const flip = this.right !== !!this.opt.gradReverse;
            const c1 = flip ? this.bg : this.fg;
            const c2 = flip ? this.fg : this.bg;
            const sel = this.doc.selection;
            const rect = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
            this.commitToLayer('Gradient', (ctx) => {
                let g;
                if (this.opt.gradient === 'radial') g = ctx.createRadialGradient(s.a.x, s.a.y, 0, s.a.x, s.a.y, Math.max(1, Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)));
                else if (this.opt.gradient === 'reflected') {
                    // the start is the middle: the gradient goes both ways from it
                    g = ctx.createLinearGradient(2 * s.a.x - s.b.x, 2 * s.a.y - s.b.y, s.b.x, s.b.y);
                    g.addColorStop(0, c2);
                    g.addColorStop(0.5, c1);
                } else g = ctx.createLinearGradient(s.a.x, s.a.y, s.b.x, s.b.y);
                if (this.opt.gradient !== 'reflected') g.addColorStop(0, c1);
                g.addColorStop(1, c2);
                ctx.globalCompositeOperation = C().BLENDS[this.opt.paintMode] || 'source-over';
                ctx.globalAlpha = this.opt.opacity / 100;
                ctx.fillStyle = g;
                ctx.fillRect(rect.x, rect.y, rect.w, rect.h);
            }, rect);
        }
    };

    T.clone = {
        down(p, ev) {
            if (this.right || ev.altKey) {
                this.cloneSrc = p;
                this.status(`Clone source set at ${Math.floor(p.x)},${Math.floor(p.y)}.`);
                return;
            }
            if (!this.cloneSrc) { this.status('Right-click to set where Clone Stamp copies from.'); return; }
            if (!this.beginStroke(false)) return;
            // Aligned: after the first stroke the source keeps its distance (Photoshop); otherwise
            // every stroke starts from the source point again
            if (!this.opt.cloneAligned || !this.cloneOffset || this.cloneOffsetFor !== this.cloneSrc) {
                this.cloneOffset = { x: this.cloneSrc.x - p.x, y: this.cloneSrc.y - p.y };
                this.cloneOffsetFor = this.cloneSrc;
            }
            this.cloneSnap = C().makeCanvas(this.doc.width, this.doc.height);
            this.cloneSnap.getContext('2d').drawImage(this.doc.layer.canvas, 0, 0);
            this.last = p;
            T.clone.dab.call(this, p, p);
        },
        dab(a, b) {
            const size = this.toolDiameter();
            const steps = Math.max(1, Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / Math.max(1, size / 4)));
            const ctx = this.sctx;
            for (let i = 0; i <= steps; i += 1) {
                const x = a.x + ((b.x - a.x) * i) / steps;
                const y = a.y + ((b.y - a.y) * i) / steps;
                ctx.save();
                ctx.beginPath();
                ctx.arc(x, y, size / 2, 0, Math.PI * 2);
                ctx.clip();
                ctx.drawImage(this.cloneSnap, this.cloneOffset.x, this.cloneOffset.y);
                ctx.restore();
            }
            this.growStroke({ x: Math.min(a.x, b.x) - size, y: Math.min(a.y, b.y) - size, w: Math.abs(b.x - a.x) + size * 2, h: Math.abs(b.y - a.y) + size * 2 });
        },
        move(p, ev, down) {
            if (!down || !this.sctx || !this.cloneSnap) return;
            T.clone.dab.call(this, this.last, p);
            this.last = p;
        },
        up() { this.cloneSnap = null; this.endStroke(); }
    };

    T.blur = {
        down(p) {
            if (!this.editable()) return;
            this.blurStep = this.doc.beginStep('Blur', this.doc.layer);
            this.last = p;
            T.blur.dab.call(this, p);
        },
        dab(p) {
            const size = this.toolDiameter();
            const r = C().clampRect({ x: p.x - size / 2, y: p.y - size / 2, w: size, h: size }, this.doc.width, this.doc.height);
            if (!r) return;
            C().convolve(this.doc.layer.ctx, r, [1, 2, 1, 2, 4, 2, 1, 2, 1], 16);
            this.blurStep.grow(r);
            this.doc.markDirty(r);
        },
        move(p, ev, down) {
            if (!down || !this.blurStep) return;
            if (Math.hypot(p.x - this.last.x, p.y - this.last.y) < 2) return;
            T.blur.dab.call(this, p);
            this.last = p;
        },
        up() { if (this.blurStep) this.doc.commitStep(this.blurStep); this.blurStep = null; }
    };

    /** Free Transform's pointer: the handles scale, inside moves, outside turns (Shift keeps the shape / snaps). */
    T.xform = {
        down(p, ev) {
            const hit = this.xfHit(p);
            this.xfDrag = { hit, start: p, from: { ...this.xf } };
        },
        move(p, ev, down) {
            const t = this.xf;
            if (!t) return;
            if (!down || !this.xfDrag) {
                this.overlay.style.cursor = this.xfCursor(this.xfHit(p));
                return;
            }
            const { hit, start, from } = this.xfDrag;
            if (hit.kind === 'move') {
                t.cx = from.cx + (p.x - start.x);
                t.cy = from.cy + (p.y - start.y);
            } else if (hit.kind === 'rotate') {
                const a0 = Math.atan2(start.y - from.cy, start.x - from.cx);
                const a1 = Math.atan2(p.y - from.cy, p.x - from.cx);
                let ang = from.angle + a1 - a0;
                if (ev && ev.shiftKey) ang = Math.round(ang / (Math.PI / 12)) * (Math.PI / 12);
                t.angle = ang;
            } else {
                const c = Math.cos(-from.angle);
                const sn = Math.sin(-from.angle);
                const dx = p.x - from.cx;
                const dy = p.y - from.cy;
                const lx = dx * c - dy * sn;
                const ly = dx * sn + dy * c;
                const fromCentre = ev && ev.altKey;
                // the opposite edge stays put (Alt: the centre does)
                const ax = fromCentre ? 0 : (-hit.sx * from.w) / 2;
                const ay = fromCentre ? 0 : (-hit.sy * from.h) / 2;
                let w = hit.sx ? Math.max(1, hit.sx * (lx - ax) * (fromCentre ? 2 : 1)) : from.w;
                let h = hit.sy ? Math.max(1, hit.sy * (ly - ay) * (fromCentre ? 2 : 1)) : from.h;
                // a corner keeps the shape when Keep Proportions is on, Shift does the other (Photoshop);
                // an edge handle stretches freely, Shift keeps the shape
                const shift = !!(ev && ev.shiftKey);
                const uniform = hit.sx && hit.sy ? (this.opt.keepRatio !== false) !== shift : shift;
                if (uniform) {
                    const k = hit.sx && hit.sy ? Math.max(w / from.w, h / from.h) : hit.sx ? w / from.w : h / from.h;
                    w = from.w * k;
                    h = from.h * k;
                }
                const ncx = fromCentre ? 0 : (hit.sx ? ax + (hit.sx * w) / 2 : 0);
                const ncy = fromCentre ? 0 : (hit.sy ? ay + (hit.sy * h) / 2 : 0);
                const c2 = Math.cos(from.angle);
                const s2 = Math.sin(from.angle);
                t.cx = from.cx + ncx * c2 - ncy * s2;
                t.cy = from.cy + ncx * s2 + ncy * c2;
                t.w = w;
                t.h = h;
            }
            this.drawXf();
        },
        up() { this.xfDrag = null; },
        dbl() { this.commitTransform(); }
    };

    T.hand = {
        down(p, ev) {
            this.handDrag = { x: ev.clientX, y: ev.clientY, sl: this.workspace.scrollLeft, st: this.workspace.scrollTop };
        },
        move(p, ev, down) {
            const h = this.handDrag;
            if (!down || !h || !ev) return;
            this.workspace.scrollLeft = h.sl - (ev.clientX - h.x);
            this.workspace.scrollTop = h.st - (ev.clientY - h.y);
        },
        up() { this.handDrag = null; },
        dbl() { this.fitZoom(); }
    };

    T.crop = {
        down(p) {
            const c = this.cropBox;
            const tol = 6 / this.zoom;
            if (c) {
                const ex = Math.abs(p.x - c.x) <= tol ? -1 : Math.abs(p.x - (c.x + c.w)) <= tol ? 1 : 0;
                const ey = Math.abs(p.y - c.y) <= tol ? -1 : Math.abs(p.y - (c.y + c.h)) <= tol ? 1 : 0;
                const inside = p.x > c.x && p.y > c.y && p.x < c.x + c.w && p.y < c.y + c.h;
                if (ex || ey || inside) { this.cropDrag = { ex, ey, move: !ex && !ey, start: p, from: { ...c } }; return; }
            }
            this.cropDrag = { ex: 1, ey: 1, start: p, from: { x: p.x, y: p.y, w: 0, h: 0 }, fresh: true };
            this.cropBox = { x: p.x, y: p.y, w: 0, h: 0 };
        },
        move(p, ev, down) {
            const g = this.cropDrag;
            if (!down || !g) return;
            const W = this.doc.width;
            const H = this.doc.height;
            const f = g.from;
            let x0 = f.x; let y0 = f.y; let x1 = f.x + f.w; let y1 = f.y + f.h;
            if (g.move) {
                const dx = Math.max(-x0, Math.min(W - x1, p.x - g.start.x));
                const dy = Math.max(-y0, Math.min(H - y1, p.y - g.start.y));
                x0 += dx; x1 += dx; y0 += dy; y1 += dy;
            } else if (g.fresh) {
                const b = this.constrain(g.start, p, ev, true);
                x0 = Math.min(g.start.x, b.x); x1 = Math.max(g.start.x, b.x);
                y0 = Math.min(g.start.y, b.y); y1 = Math.max(g.start.y, b.y);
            } else {
                if (g.ex < 0) x0 = p.x; else if (g.ex > 0) x1 = p.x;
                if (g.ey < 0) y0 = p.y; else if (g.ey > 0) y1 = p.y;
            }
            // the options bar's Ratio: the box keeps W:H (the height follows the width)
            const ratio = this.cropRatio();
            if (ratio && !g.move) {
                const wNow = Math.abs(x1 - x0);
                const hWant = wNow / ratio;
                if (g.fresh || g.ey > 0 || (!g.ey && g.ex)) { if (y1 >= y0) y1 = y0 + hWant; else y1 = y0 - hWant; } else y0 = y1 - hWant;
            }
            x0 = Math.max(0, Math.round(Math.min(x0, x1))); x1 = Math.min(W, Math.round(Math.max(x0, x1)));
            y0 = Math.max(0, Math.round(Math.min(y0, y1))); y1 = Math.min(H, Math.round(Math.max(y0, y1)));
            this.cropBox = { x: x0, y: y0, w: x1 - x0, h: y1 - y0 };
            this.el('.mp-status-size').textContent = `${x1 - x0}x${y1 - y0}`;
            this.drawAnts();
            if (g.fresh && !this.cropBarShown) { this.cropBarShown = true; this.renderBar(); }
        },
        up() {
            this.cropDrag = null;
            this.cropBarShown = false;
            if (this.cropBox && (this.cropBox.w < 2 || this.cropBox.h < 2)) this.cropBox = null;
            this.drawAnts();
            this.renderBar();
            if (this.cropBox) this.status('Press Enter (or double-click) to crop; Esc cancels.');
        },
        dbl() { this.commitCrop(); }
    };

    /**
     * Smudge, Dodge, Burn and Sponge: soft round dabs straight on the layer, spaced a quarter of
     * their size apart; the strength is the Opacity setting; a feathered selection softens them.
     */
    function dabTool(kind, label) {
        return {
            down(p) {
                if (!this.editable()) return;
                this.dabStep = this.doc.beginStep(label, this.doc.layer);
                this.dabMask = this.doc.selection && P() ? P().maskOf(this.doc, this.doc.selection) : null;
                this.last = p;
                this.smudgeBuf = null;
                T[kind].dab.call(this, p);
            },
            move(p, ev, down) {
                if (!down || !this.dabStep) return;
                const d = this.toolDiameter();
                const gap = Math.max(1, d / 4);
                const dist = Math.hypot(p.x - this.last.x, p.y - this.last.y);
                if (dist < gap) return;
                const n = Math.floor(dist / gap);
                for (let i = 1; i <= n; i += 1) {
                    T[kind].dab.call(this, { x: this.last.x + ((p.x - this.last.x) * i) / n, y: this.last.y + ((p.y - this.last.y) * i) / n });
                }
                this.last = p;
            },
            up() {
                if (this.dabStep) this.doc.commitStep(this.dabStep);
                this.dabStep = null;
                this.dabMask = null;
                this.smudgeBuf = null;
            },
            dab(p) {
                const d = Math.max(2, Math.round(this.toolDiameter()));
                const r = d / 2;
                const bx = Math.round(p.x - r);
                const by = Math.round(p.y - r);
                const rect = C().clampRect({ x: bx, y: by, w: d, h: d }, this.doc.width, this.doc.height);
                if (!rect) return;
                const ctx = this.doc.layer.ctx;
                const img = ctx.getImageData(rect.x, rect.y, rect.w, rect.h);
                const px = img.data;
                const strength = this.opt.opacity / 100;
                const hard = this.opt.hardness / 100;
                const W = this.doc.width;
                const sat = (this.opt.spongeMode !== 'desaturate') !== this.right;
                const buf = this.smudgeBuf;
                if (kind === 'smudge' && !buf) {
                    // the brush picks up the colours under its first dab
                    this.smudgeBuf = { d, data: new Float32Array(d * d * 4) };
                    for (let y = 0; y < rect.h; y += 1) {
                        for (let x = 0; x < rect.w; x += 1) {
                            const si = (y * rect.w + x) * 4;
                            const bi = ((rect.y - by + y) * d + rect.x - bx + x) * 4;
                            for (let c = 0; c < 4; c += 1) this.smudgeBuf.data[bi + c] = px[si + c];
                        }
                    }
                    return;
                }
                for (let y = 0; y < rect.h; y += 1) {
                    for (let x = 0; x < rect.w; x += 1) {
                        const gx = rect.x + x;
                        const gy = rect.y + y;
                        const dist = Math.hypot(gx + 0.5 - p.x, gy + 0.5 - p.y) / r;
                        if (dist >= 1) continue;
                        let f = dist <= hard * 0.9 ? 1 : 1 - (dist - hard * 0.9) / (1 - hard * 0.9);
                        f = f * f * (3 - 2 * f);
                        if (this.dabMask) f *= this.dabMask[gy * W + gx] / 255;
                        if (f <= 0) continue;
                        const i = (y * rect.w + x) * 4;
                        if (kind === 'smudge') {
                            const bi = ((gy - by) * d + gx - bx) * 4;
                            const k = Math.min(0.95, strength) * f;
                            for (let c = 0; c < 4; c += 1) {
                                const v = px[i + c] + (buf.data[bi + c] - px[i + c]) * k;
                                px[i + c] = v;
                                buf.data[bi + c] = v;
                            }
                        } else if (kind === 'dodge' || kind === 'burn') {
                            const k = strength * f * 0.12;
                            for (let c = 0; c < 3; c += 1) {
                                const v = px[i + c];
                                // the midtones move most (Photoshop's default range)
                                const t = v / 255;
                                const range = this.opt.toneRange;
                                const wgt = range === 'shadows' ? 1.4 * (1 - t) * (1 - t) + 0.1 : range === 'highlights' ? 1.4 * t * t + 0.1 : 0.35 + 2.6 * t * (1 - t);
                                px[i + c] = kind === 'dodge' ? v + (255 - v) * k * wgt : v - v * k * wgt;
                            }
                        } else {
                            const l = 0.299 * px[i] + 0.587 * px[i + 1] + 0.114 * px[i + 2];
                            const k = 1 + (sat ? 1 : -1) * strength * f * 0.15;
                            for (let c = 0; c < 3; c += 1) px[i + c] = l + (px[i + c] - l) * k;
                        }
                    }
                }
                ctx.putImageData(img, rect.x, rect.y);
                this.dabStep.grow(rect);
                this.doc.markDirty(rect);
            }
        };
    }

    T.smudge = dabTool('smudge', 'Smudge');
    T.dodge = dabTool('dodge', 'Dodge');
    T.burn = dabTool('burn', 'Burn');
    T.sponge = dabTool('sponge', 'Sponge');

    /** Spot Healing Brush: paint over the spot; on release it is filled from around it (paintPro.heal). */
    T.heal = {
        down(p) {
            if (!this.editable()) return;
            this.healPts = [p];
            T.heal.show.call(this);
        },
        move(p, ev, down) {
            if (!down || !this.healPts) return;
            this.healPts.push(p);
            T.heal.show.call(this);
        },
        show() {
            this.clearOverlay();
            const x = this.octx;
            x.save();
            x.strokeStyle = 'rgba(0, 0, 0, 0.45)';
            x.lineWidth = this.toolDiameter();
            x.lineCap = 'round';
            x.lineJoin = 'round';
            x.beginPath();
            this.healPts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
            if (this.healPts.length === 1) x.lineTo(this.healPts[0].x + 0.01, this.healPts[0].y);
            x.stroke();
            x.restore();
        },
        up() {
            const pts = this.healPts;
            this.healPts = null;
            this.clearOverlay();
            if (!pts || !P()) return;
            const W = this.doc.width;
            const H = this.doc.height;
            const c = C().makeCanvas(W, H);
            const x = c.getContext('2d', { willReadFrequently: true });
            x.strokeStyle = '#000';
            x.lineWidth = this.toolDiameter();
            x.lineCap = 'round';
            x.lineJoin = 'round';
            x.beginPath();
            pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
            if (pts.length === 1) x.lineTo(pts[0].x + 0.01, pts[0].y);
            x.stroke();
            const a = x.getImageData(0, 0, W, H).data;
            const hole = new Uint8Array(W * H);
            const sel = this.doc.selection ? P().maskOf(this.doc, this.doc.selection) : null;
            for (let i = 0; i < hole.length; i += 1) hole[i] = sel ? (a[i * 4 + 3] * sel[i]) / 255 : a[i * 4 + 3];
            const l = this.doc.layer;
            const step = this.doc.beginStep('Spot Healing Brush', l);
            const r = P().heal(this.doc, l, hole);
            if (!r) { step.backup = null; return; }
            step.grow(r);
            this.doc.commitStep(step);
        }
    };

    PaintWindow.prototype.tools = T;

    const instances = new Set();

    async function openMelatonPaint(opts = {}) {
        const w = new PaintWindow(opts);
        instances.add(w);
        return w;
    }

    root.PaintWindow = PaintWindow;
    root.openMelatonPaint = openMelatonPaint;
    root.melatonPaint = { open: openMelatonPaint, instances, PALETTE, TOOLS };
})(typeof window !== 'undefined' ? window : globalThis);
