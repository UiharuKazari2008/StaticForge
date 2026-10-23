/**
 * Paint (Yozora #632): Vista's mspaint.exe, then layers and the tools a modern editor has.
 *
 *   window      File Edit View Image Layers Adjustments Colors Help; the tool box (Vista's 16 tools
 *               from mspaint.exe bitmap 859, then Move, Gradient, Magic Wand, Clone Stamp, Blur), the
 *               tool's options box, the Tool Settings bar (size, opacity, hardness, tolerance), the
 *               canvas on the app workspace (#ababab) with its resize handles, the color box
 *               (Vista's 28 colors), the status bar (help, the cursor, the selection's size), and the
 *               Layers window (paintLayers.js)
 *   documents   a PaintCore.Document (paintCore.js); files open from Cartograph (any picture) or
 *               the gallery, save as PNG / JPEG / BMP / WebP, or as a Melaton Paint image (.mpi:
 *               every layer kept) in the VFS; Save to Gallery and Set as Desktop Background
 *   dialogs     Vista's own templates (vistaDialogTemplate.js): Attributes, Flip and Rotate,
 *               Resize and Skew, Grid Settings (mspaint.exe.mui) and Edit Colors (comdlg32 CHOOSECOLOR)
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
        ['blur', 'Blur', 'Softens the picture under the brush.']
    ];
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
                zoomLevel: 4, size: 0, opacity: 100, hardness: 100, tolerance: 32, antialias: true, gradient: 'linear'
            };
            this.grid = false;
            this.name = opts.name || 'Untitled';
            this.file = opts.file || null;
            this.dirtyDoc = false;
            this.floating = null;
            this.build();
            this.newDocument(reg('LastWidth', 800), reg('LastHeight', 600), { silent: true });
            if (opts.image) void this.openUrl(opts.image, opts.name, opts.file);
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
                    <div class="naxt-menubar mp-menubar" role="menubar">${['File', 'Edit', 'View', 'Image', 'Layers', 'Adjustments', 'Colors', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-mp-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                    <div class="mp-settings" role="toolbar">
                        <label>Size: <input type="number" class="tbp-edit mp-set-size" min="0" max="500" value="0" title="0 uses the tool's own size"></label>
                        <label>Opacity: <input type="range" class="mp-set-opacity" min="1" max="100" value="100"><span class="mp-set-opacity-v">100%</span></label>
                        <label>Hardness: <input type="range" class="mp-set-hardness" min="0" max="100" value="100"></label>
                        <label>Tolerance: <input type="range" class="mp-set-tolerance" min="0" max="100" value="32"></label>
                        <label class="mp-set-check"><input type="checkbox" class="mp-set-aa" checked><span>Antialiasing</span></label>
                    </div>
                    <div class="mp-body">
                        <div class="mp-toolbox">
                            <div class="mp-tools" role="toolbar">${TOOLS.map(([id, name], i) => `<button type="button" class="mp-tool${id === this.tool ? ' is-on' : ''}" data-tool="${id}" title="${esc(name)}" style="--i:${i < 16 ? i : i - 16}"><span class="mp-tool-art${i >= 16 ? ' is-extra' : ''}"></span></button>`).join('')}</div>
                            <div class="mp-options"></div>
                        </div>
                        <div class="mp-workspace" tabindex="-1">
                            <div class="mp-stage">
                                <canvas class="mp-view"></canvas>
                                <canvas class="mp-overlay"></canvas>
                                <div class="mp-grid"></div>
                                <svg class="mp-ants" aria-hidden="true"></svg>
                                <span class="mp-handle is-e"></span><span class="mp-handle is-s"></span><span class="mp-handle is-se"></span>
                            </div>
                        </div>
                        <div class="mp-dock"></div>
                    </div>
                    <div class="mp-colorbox">
                        <div class="mp-swatch-box"><span class="mp-bg"></span><span class="mp-fg"></span></div>
                        <div class="mp-palette">${PALETTE.map((c, i) => `<button type="button" class="mp-color" data-i="${i}" style="background:${c}"></button>`).join('')}</div>
                    </div>
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
            this.wire();
            this.renderOptions();
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
            const t = `${this.name} - Paint`;
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
            this.doc = new (C().Document)(w, h, { background: '#ffffff' });
            this.unsub = this.doc.on((kind) => {
                if (kind === 'dirty') this.schedule();
                if (kind === 'resize') this.layout();
                if (kind === 'changed') { this.dirtyDoc = true; }
                if (kind === 'layers' || kind === 'history') this.emitPanels();
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
        }

        schedule() {
            if (this.raf) return;
            this.raf = requestAnimationFrame(() => {
                this.raf = 0;
                const r = this.doc.takeDirty();
                if (r) this.doc.composite(this.vctx, r, { checker: this.checker, overlay: this.strokeOverlay || null });
                if (root.paintLayers) root.paintLayers.thumbs(this);
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
                this.renderOptions();
            });
            m.querySelector('.mp-palette').addEventListener('mousedown', (ev) => {
                const b = ev.target.closest('.mp-color');
                if (!b) return;
                ev.preventDefault();
                const c = b.style.background;
                if (ev.button === 2) this.bg = hex(c); else this.fg = hex(c);
                this.renderColors();
            });
            m.querySelector('.mp-palette').addEventListener('contextmenu', (ev) => ev.preventDefault());
            m.querySelector('.mp-palette').addEventListener('dblclick', (ev) => {
                const b = ev.target.closest('.mp-color');
                if (b) void this.editColors(Number(b.dataset.i));
            });
            const set = (cls, key, fmt) => {
                const input = m.querySelector(cls);
                input.addEventListener('input', () => {
                    this.opt[key] = input.type === 'checkbox' ? input.checked : Number(input.value);
                    if (fmt) fmt(input.value);
                });
            };
            set('.mp-set-size', 'size');
            set('.mp-set-opacity', 'opacity', (v) => { m.querySelector('.mp-set-opacity-v').textContent = `${v}%`; });
            set('.mp-set-hardness', 'hardness');
            set('.mp-set-tolerance', 'tolerance');
            set('.mp-set-aa', 'antialias');
            const view = this.overlay;
            view.addEventListener('pointerdown', (ev) => this.pointer('down', ev));
            view.addEventListener('pointermove', (ev) => this.pointer('move', ev));
            view.addEventListener('pointerup', (ev) => this.pointer('up', ev));
            view.addEventListener('pointercancel', (ev) => this.pointer('up', ev));
            view.addEventListener('dblclick', (ev) => this.pointer('dbl', ev));
            view.addEventListener('contextmenu', (ev) => ev.preventDefault());
            view.addEventListener('pointerleave', () => { this.el('.mp-status-pos').textContent = ''; });
            this.workspace.addEventListener('wheel', (ev) => {
                if (!ev.ctrlKey) return;
                ev.preventDefault();
                const p = this.docPoint(ev);
                const r = this.workspace.getBoundingClientRect();
                this.setZoom(this.zoom * (ev.deltaY < 0 ? 2 : 0.5), { x: p.x, y: p.y, cx: ev.clientX - r.left, cy: ev.clientY - r.top });
            }, { passive: false });
            m.addEventListener('keydown', (ev) => this.key(ev));
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
            const p = this.docPoint(ev);
            if (kind === 'move') {
                this.el('.mp-status-pos').textContent = p.x >= 0 && p.y >= 0 && p.x < this.doc.width && p.y < this.doc.height ? `${Math.floor(p.x)},${Math.floor(p.y)}` : '';
            }
            const t = this.tools[this.tool];
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
                if (t.move) events.forEach((e) => t.move.call(this, this.docPoint(e), e, this.down));
            } else if (kind === 'up') {
                if (!this.down) return;
                this.down = false;
                if (t.up) t.up.call(this, p, ev);
            } else if (kind === 'dbl' && t.dbl) t.dbl.call(this, p, ev);
        }

        key(ev) {
            if (ev.target.closest('.mp-textbox, input, select, textarea')) return;
            const ctrl = ev.ctrlKey || ev.metaKey;
            const k = ev.key.toLowerCase();
            const map = {
                n: 'new', o: 'open', s: 'save', p: 'print', z: 'undo', y: 'redo', x: 'cut', c: 'copy', v: 'paste',
                a: 'select-all', l: 'colorbox', t: 'toolbox', e: 'attributes', r: 'flip', w: 'stretch', i: 'invert', g: 'grid', f: 'view-bitmap'
            };
            let action = null;
            if (ctrl && !ev.altKey && map[k]) action = map[k];
            else if (ctrl && ev.key === 'PageUp') action = 'zoom-normal';
            else if (ctrl && ev.key === 'PageDown') action = 'zoom-large';
            else if (ctrl && ev.shiftKey && k === 'n') action = 'clear';
            else if (ev.key === 'Delete') action = 'delete';
            else if (ev.key === 'Escape') action = 'escape';
            else if (ev.key === 'Enter' && this.polygon) action = 'finish-shape';
            else if (!ctrl && ev.key === '+' ) { this.opt.size = Math.min(500, (this.opt.size || this.brushSize()) + 1); this.syncSettings(); }
            else if (!ctrl && ev.key === '-' ) { this.opt.size = Math.max(1, (this.opt.size || this.brushSize()) - 1); this.syncSettings(); }
            if (!action) return;
            ev.preventDefault();
            void this.action(action);
        }

        syncSettings() {
            this.el('.mp-set-size').value = String(this.opt.size);
        }

        // ---- tools ----------------------------------------------------------------------------

        setTool(id) {
            if (this.tool === id) return;
            this.finishText();
            this.cancelShape();
            if (id !== 'select' && id !== 'freeselect' && id !== 'move' && id !== 'wand') this.commitFloating();
            if (id === 'picker') this.prevTool = this.tool;
            this.tool = id;
            this.modal.querySelectorAll('.mp-tool').forEach((b) => b.classList.toggle('is-on', b.dataset.tool === id));
            this.overlay.dataset.tool = id;
            this.renderOptions();
        }

        renderOptions() {
            const box = this.el('.mp-options');
            const t = this.tool;
            const o = this.opt;
            const item = (key, value, inner, title) => `<button type="button" class="mp-opt${String(o[key]) === String(value) ? ' is-on' : ''}" data-opt="${key}" data-value="${value}" title="${esc(title || '')}">${inner}</button>`;
            let html = '';
            if (t === 'select' || t === 'freeselect' || t === 'text' || t === 'move' || t === 'wand') {
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
            this.el('.mp-fg').style.background = this.fg;
            this.el('.mp-bg').style.background = this.bg;
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

        editable() {
            const l = this.doc.layer;
            if (l.locked) { this.status('This layer is locked.'); return false; }
            if (!l.visible) { this.status('This layer is hidden.'); return false; }
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
            this.strokeOverlay = { canvas: buf, layerIndex: this.doc.active, alpha: this.opt.opacity / 100, erase: !!erase };
            this.sctx = buf.getContext('2d');
            this.sctx.save();
            this.clipToSelection(this.sctx);
            return true;
        }

        strokeDab(x0, y0, x1, y1, size, color) {
            const ctx = this.sctx;
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
                for (;;) {
                    ctx.fillRect(x, y, 1, 1);
                    if (x === xe && y === ye) break;
                    const e2 = 2 * err;
                    if (e2 >= dy) { err += dy; x += sx; }
                    if (e2 <= dx) { err += dx; y += sy; }
                }
                return C().union({ x: Math.min(x0, x1) - 1, y: Math.min(y0, y1) - 1, w: Math.abs(x1 - x0) + 3, h: Math.abs(y1 - y0) + 3 }, null);
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
            l.ctx.save();
            l.ctx.globalAlpha = o.alpha;
            l.ctx.globalCompositeOperation = o.erase ? 'destination-out' : 'source-over';
            l.ctx.drawImage(o.canvas, 0, 0);
            l.ctx.restore();
            this.strokeOverlay = null;
            this.sctx = null;
            this.doc.commitStep(this.step);
            this.step = null;
            this.doc.markDirty(this.strokeRect || undefined);
            this.strokeRect = null;
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
            else if (kind === 'roundrect') ctx.roundRect(x + inset, y + inset, Math.max(0, w - 2 * inset), Math.max(0, h - 2 * inset), Math.min(16, w / 4, h / 4));
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

        commitToLayer(label, draw, rect) {
            if (!this.editable()) return;
            const l = this.doc.layer;
            const step = this.doc.beginStep(label, l);
            l.ctx.save();
            this.clipToSelection(l.ctx);
            l.ctx.imageSmoothingEnabled = this.opt.antialias;
            draw(l.ctx);
            l.ctx.restore();
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
            svg.setAttribute('width', String(this.doc.width * z));
            svg.setAttribute('height', String(this.doc.height * z));
            if (!s) { svg.innerHTML = ''; return; }
            let d;
            if (s.path && !this.floating) d = s.path.map((p, i) => `${i ? 'L' : 'M'}${(p.x * z).toFixed(1)},${(p.y * z).toFixed(1)}`).join('') + 'Z';
            else {
                const x = Math.round(s.x * z) + 0.5;
                const y = Math.round(s.y * z) + 0.5;
                d = `M${x},${y}h${Math.round(s.w * z)}v${Math.round(s.h * z)}h${-Math.round(s.w * z)}Z`;
            }
            svg.innerHTML = `<path d="${d}" class="mp-ants-a"/><path d="${d}" class="mp-ants-b"/>`;
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
                        if (!s.mask[(s.y + y) * this.doc.width + s.x + x]) img.data[(y * s.w + x) * 4 + 3] = 0;
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
            const isBackground = this.doc.layers.indexOf(l) === 0;
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
                        if (!s.mask[(s.y + y) * this.doc.width + s.x + x]) continue;
                        const i = (y * s.w + x) * 4;
                        if (isBackground) { img.data[i] = r; img.data[i + 1] = g; img.data[i + 2] = b; img.data[i + 3] = 255; } else img.data[i + 3] = 0;
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
            try {
                const items = await navigator.clipboard.read();
                for (const it of items) {
                    const type = it.types.find((t) => t.startsWith('image/'));
                    if (type) { await this.pasteBlob(await it.getType(type)); return; }
                }
            } catch (_) { /* fall back to Paint's own copy */ }
            if (this.clipboard) this.pasteCanvas(this.clipboard);
        }

        async pasteBlob(blob) {
            if (!blob) return;
            const url = URL.createObjectURL(blob);
            try {
                const img = await loadImage(url);
                const c = C().makeCanvas(img.naturalWidth, img.naturalHeight);
                c.getContext('2d').drawImage(img, 0, 0);
                this.pasteCanvas(c);
            } finally {
                URL.revokeObjectURL(url);
            }
        }

        pasteCanvas(c) {
            this.commitFloating();
            // Vista asks to enlarge the picture when the pasted one is bigger
            if (c.width > this.doc.width || c.height > this.doc.height) {
                this.doc.resizeCanvas(Math.max(c.width, this.doc.width), Math.max(c.height, this.doc.height), { fill: this.bg, label: 'Enlarge' });
            }
            this.setTool('select');
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

        // ---- text -----------------------------------------------------------------------------

        startText(p) {
            this.finishText();
            const box = doc.createElement('div');
            box.className = 'mp-textbox';
            box.contentEditable = 'true';
            box.spellcheck = false;
            box.style.left = `${p.x * this.zoom}px`;
            box.style.top = `${p.y * this.zoom}px`;
            const f = this.textFont();
            box.style.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size * this.zoom * 96 / 72}px "${f.face}"`;
            box.style.textDecoration = f.underline ? 'underline' : 'none';
            box.style.color = this.fg;
            box.style.background = this.opt.transparent ? 'transparent' : this.bg;
            this.stage.appendChild(box);
            this.text = { box, x: p.x, y: p.y };
            this.showTextBar(true);
            setTimeout(() => box.focus(), 0);
        }

        textFont() {
            return { face: reg('TextFace', 'Arial'), size: Number(reg('TextSize', 12)), bold: reg('TextBold', false), italic: reg('TextItalic', false), underline: reg('TextUnderline', false) };
        }

        showTextBar(on) {
            let bar = this.el('.mp-textbar');
            if (!on) { if (bar) bar.hidden = true; return; }
            if (!bar) {
                bar = doc.createElement('div');
                bar.className = 'mp-textbar';
                const fonts = ['Arial', 'Comic Sans MS', 'Courier New', 'Georgia', 'Impact', 'Lucida Console', 'Segoe UI', 'Tahoma', 'Times New Roman', 'Trebuchet MS', 'Verdana'];
                const f = this.textFont();
                bar.innerHTML = `<div class="mp-textbar-cap">Fonts</div>
                    <select class="mp-tb-face">${fonts.map((n) => `<option${n === f.face ? ' selected' : ''}>${n}</option>`).join('')}</select>
                    <select class="mp-tb-size">${[8, 9, 10, 11, 12, 14, 16, 18, 20, 22, 24, 26, 28, 36, 48, 72].map((n) => `<option${n === f.size ? ' selected' : ''}>${n}</option>`).join('')}</select>
                    <button type="button" class="mp-tb-b${f.bold ? ' is-on' : ''}" data-tb="TextBold" style="--x:0px" title="Bold"></button>
                    <button type="button" class="mp-tb-b${f.italic ? ' is-on' : ''}" data-tb="TextItalic" style="--x:-23px" title="Italic"></button>
                    <button type="button" class="mp-tb-b${f.underline ? ' is-on' : ''}" data-tb="TextUnderline" style="--x:-46px" title="Underline"></button>`;
                this.el('.mp-workspace').appendChild(bar);
                const apply = () => {
                    setReg({ TextFace: bar.querySelector('.mp-tb-face').value, TextSize: Number(bar.querySelector('.mp-tb-size').value) });
                    this.restyleText();
                };
                bar.querySelector('.mp-tb-face').addEventListener('change', apply);
                bar.querySelector('.mp-tb-size').addEventListener('change', apply);
                bar.addEventListener('click', (ev) => {
                    const b = ev.target.closest('[data-tb]');
                    if (!b) return;
                    b.classList.toggle('is-on');
                    setReg({ [b.dataset.tb]: b.classList.contains('is-on') });
                    setTimeout(() => this.restyleText(), 0);
                });
            }
            bar.hidden = false;
        }

        restyleText() {
            if (!this.text) return;
            const f = this.textFont();
            this.text.box.style.font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${f.size * this.zoom * 96 / 72}px "${f.face}"`;
            this.text.box.style.textDecoration = f.underline ? 'underline' : 'none';
        }

        finishText() {
            const t = this.text;
            if (!t) return;
            this.text = null;
            this.showTextBar(false);
            const lines = t.box.innerText.replace(/\n$/, '').split('\n');
            const f = this.textFont();
            const px = f.size * 96 / 72;
            const font = `${f.italic ? 'italic ' : ''}${f.bold ? 'bold ' : ''}${px}px "${f.face}"`;
            t.box.remove();
            if (!lines.join('').trim()) return;
            const measure = this.octx;
            measure.font = font;
            const w = Math.ceil(Math.max(...lines.map((l) => measure.measureText(l).width))) + 4;
            const lh = Math.ceil(px * 1.2);
            const rect = { x: t.x, y: t.y, w, h: lh * lines.length + 4 };
            this.commitToLayer('Text', (ctx) => {
                if (!this.opt.transparent) { ctx.fillStyle = this.bg; ctx.fillRect(rect.x, rect.y, rect.w, rect.h); }
                ctx.font = font;
                ctx.fillStyle = this.fg;
                ctx.textBaseline = 'top';
                lines.forEach((l, i) => {
                    ctx.fillText(l, t.x + 2, t.y + 2 + i * lh);
                    if (f.underline) ctx.fillRect(t.x + 2, t.y + 2 + i * lh + px, measure.measureText(l).width, Math.max(1, px / 14));
                });
            }, rect);
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

        // ---- files ----------------------------------------------------------------------------

        async openUrl(url, name, file) {
            try {
                const img = await loadImage(url);
                this.newDocument(img.naturalWidth, img.naturalHeight, { file });
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

        async openMpi(text, name, file) {
            const data = JSON.parse(text);
            this.newDocument(data.width, data.height, { file });
            const layers = [];
            for (const l of data.layers) {
                const img = await loadImage(l.png);
                layers.push([l, img]);
            }
            this.doc.layers = [];
            layers.forEach(([l, img]) => {
                const layer = this.doc.addLayer(l.name, { silent: true, at: this.doc.layers.length });
                layer.ctx.drawImage(img, 0, 0);
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
                startPath: mode === 'open-gallery' && ws ? `/Workspaces/${ws}/Pictures` : (this.file && this.file.path) || (ws ? `/Workspaces/${ws}` : '/'),
                host: {
                    title: 'Open',
                    typeLabel: 'All Picture Files',
                    rejectMessage: 'Choose a picture',
                    acceptItem: (item) => !!item && (item.targetKind === 'image' || item.targetKind === 'scrap' || item.shortcutType === 'image'
                        || (item.targetKind === 'user-file' && (/^image\//.test(item.mimeType || '') || /\.(png|jpe?g|gif|bmp|webp|mpi)$/i.test(item.name || '')))),
                    async onOpen(item, folderPath) {
                        if (!await self.confirmDiscard()) return;
                        if (item.targetKind === 'user-file') {
                            const res = await vfs().downloadFile(item.id);
                            const file = { id: item.id, name: item.name, path: folderPath };
                            if (/\.mpi$/i.test(item.name)) {
                                const r = await fetch(res.downloadUrl, { credentials: 'same-origin' });
                                await self.openMpi(await r.text(), item.name, file);
                            } else await self.openUrl(res.downloadUrl, item.name, file);
                        } else {
                            const name = item.previewImageFilename || item.targetId || (item.shortcutData && item.shortcutData.filename);
                            await self.openUrl(`/images/${encodeURIComponent(name)}`, item.name || name, null);
                        }
                    }
                }
            });
        }

        async encode(type) {
            if (type === 'mpi') {
                const layers = this.doc.layers.map((l) => ({ name: l.name, visible: l.visible, opacity: l.opacity, blend: l.blend, locked: l.locked, png: l.canvas.toDataURL('image/png') }));
                return new Blob([JSON.stringify({ format: 'melaton-paint', version: 1, width: this.doc.width, height: this.doc.height, active: this.doc.active, layers })], { type: 'application/json' });
            }
            const flat = this.doc.flattened({ background: type === 'image/jpeg' || type === 'image/bmp' ? '#ffffff' : undefined });
            if (type === 'image/bmp') return C().encodeBmp(flat);
            return new Promise((r) => flat.toBlob(r, type, 0.92));
        }

        typeFor(name) {
            const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1] || 'png';
            return { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', bmp: 'image/bmp', webp: 'image/webp', mpi: 'mpi' }[ext.toLowerCase()] || 'image/png';
        }

        async save() {
            this.commitFloating();
            this.finishText();
            if (!this.file || !this.file.id) return this.saveAs();
            try {
                const type = this.typeFor(this.file.name);
                const blob = await this.encode(type);
                await vfs().replaceFile(this.file.id, await blobToBase64(blob), type === 'mpi' ? 'application/json' : type);
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
                    startPath: (this.file && this.file.path) || (ws ? `/Workspaces/${ws}` : '/'),
                    host: {
                        title: 'Save As',
                        typeLabel: 'PNG (*.png); JPEG (*.jpg); 24-bit Bitmap (*.bmp); WebP (*.webp); Melaton Paint Image, with layers (*.mpi)',
                        acceptType: 'user-file',
                        suggestName: () => (self.file ? self.file.name : `${self.name === 'Untitled' ? 'untitled' : self.name}${self.doc.layers.length > 1 ? '.mpi' : '.png'}`),
                        async onSave(info) {
                            let name = String(info.name || '').trim();
                            if (!name) return false;
                            if (!/\.(png|jpe?g|bmp|webp|mpi)$/i.test(name)) name += '.png';
                            const type = self.typeFor(name);
                            if (type !== 'mpi' && self.doc.layers.length > 1) {
                                const ok = await callGlobal('showConfirmationDialog', '<p>Saving in this format will flatten the image into one layer. Save anyway? To keep the layers, save as a Melaton Paint Image (*.mpi).</p>', [
                                    { text: 'Flatten', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }
                                ], null, { title: 'Paint', width: 400 });
                                if (!ok) return false;
                            }
                            try {
                                const blob = await self.encode(type);
                                const res = await vfs().uploadFile(info.path || '/', await blobToBase64(blob), name, type === 'mpi' ? 'application/json' : type);
                                const f = res && (res.file || res.entry || res);
                                self.file = { id: (f && (f.id || f.fileId)) || null, name, path: info.path };
                                self.name = name.replace(/\.[^.]+$/, '');
                                self.dirtyDoc = false;
                                self.title();
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
            const blob = await this.encode('image/png');
            try {
                const res = await root.wsClient.uploadWorkspaceImage(await blobToBase64(blob), ws, `${this.name || 'untitled'}.png`, { currentIndex: 0, totalCount: 1 });
                if (!res || res.success === false) throw new Error((res && res.error) || 'The gallery did not take the picture.');
                const filename = res.filename || (res.image && res.image.filename);
                if (thenWallpaper && filename) callGlobal('openDesktopSettingsModal', `file:${filename}`);
                else callGlobal('showGlassToast', 'success', 'Paint', 'Saved to the gallery', false, 2500);
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
                    { text: 'Copy To...', action: 'copy-to', disabled: !sel },
                    { text: 'Paste From...', action: 'paste-from' }
                ];
                case 'view': return [
                    { text: 'Tool Box', subtext: 'Ctrl+T', action: 'toolbox', showIndicator: true, checked: viewOn('mp-no-tools') },
                    { text: 'Color Box', subtext: 'Ctrl+L', action: 'colorbox', showIndicator: true, checked: viewOn('mp-no-colors') },
                    { text: 'Status Bar', action: 'statusbar', showIndicator: true, checked: viewOn('mp-no-status') },
                    { text: 'Tool Settings', action: 'settings', showIndicator: true, checked: viewOn('mp-no-settings') },
                    { text: 'Text Toolbar', action: 'textbar', showIndicator: true, checked: !!this.el('.mp-textbar:not([hidden])') },
                    { text: 'Layers', subtext: 'F7', action: 'layers', showIndicator: true, checked: !!(root.paintLayers && root.paintLayers.isOpen(this)) },
                    { text: 'History', subtext: 'F8', action: 'history', showIndicator: true, checked: !!(root.paintLayers && root.paintLayers.historyOpen(this)) },
                    { separator: true },
                    { text: 'Zoom', hasSubmenu: true, submenu: [
                        { text: 'Normal Size', subtext: 'Ctrl+PgUp', action: 'zoom-normal' },
                        { text: 'Large Size', subtext: 'Ctrl+PgDn', action: 'zoom-large' },
                        { text: 'Custom...', action: 'zoom-custom' },
                        { separator: true },
                        { text: 'Show Grid', subtext: 'Ctrl+G', action: 'grid', showIndicator: true, checked: this.grid, disabled: this.zoom < 4 },
                        { text: 'Show Thumbnail', action: 'thumbnail', disabled: this.zoom <= 1 }
                    ] },
                    { text: 'View Bitmap', subtext: 'Ctrl+F', action: 'view-bitmap' }
                ];
                case 'image': return [
                    { text: 'Flip/Rotate...', subtext: 'Ctrl+R', action: 'flip' },
                    { text: 'Resize/Skew...', subtext: 'Ctrl+W', action: 'stretch' },
                    { text: 'Invert Colors', subtext: 'Ctrl+I', action: 'invert' },
                    { text: 'Attributes...', subtext: 'Ctrl+E', action: 'attributes' },
                    { text: 'Clear Image', subtext: 'Ctrl+Shft+N', action: 'clear' },
                    { text: 'Crop to Selection', action: 'crop', disabled: !sel },
                    { text: 'Draw Opaque', action: 'opaque', showIndicator: true, checked: !this.opt.transparent }
                ];
                case 'layers': return root.paintLayers ? root.paintLayers.menu(this) : [];
                case 'adjustments': return root.paintLayers ? root.paintLayers.adjustMenu(this) : [];
                case 'colors': return [{ text: 'Edit Colors...', action: 'edit-colors' }];
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
            switch (a) {
                case 'new':
                    if (!await this.confirmDiscard()) return;
                    this.newDocument(this.doc.width, this.doc.height);
                    return;
                case 'open': if (await this.confirmDiscard()) this.openDialog('open-vfs'); return;
                case 'open-gallery': if (await this.confirmDiscard()) this.openDialog('open-gallery'); return;
                case 'save': await this.save(); return;
                case 'save-as': await this.saveAs(); return;
                case 'save-gallery': await this.saveToGallery(false); return;
                case 'wallpaper': await this.saveToGallery(true); return;
                case 'camera': await this.fromCamera(); return;
                case 'print': this.print(); return;
                case 'exit': await this.close(); return;
                case 'undo': this.commitFloating(); this.finishText(); this.doc.undo(); return;
                case 'redo': this.doc.redo(); return;
                case 'cut': await this.copySelection(true); return;
                case 'copy': await this.copySelection(false); return;
                case 'paste': await this.paste(); return;
                case 'delete': this.deleteSelection(); return;
                case 'select-all': this.selectAll(); return;
                case 'copy-to': await this.copyTo(); return;
                case 'paste-from': this.pasteFrom(); return;
                case 'escape': this.cancelShape(); if (this.floating) this.commitFloating(); else this.setSelection(null); return;
                case 'finish-shape': if (this.tools.polygon.finish) this.tools.polygon.finish.call(this); return;
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
                case 'edit-colors': if (D) D.editColors(this); return;
                case 'help': callGlobal('openHelpAndSupport', 'paint'); return;
                case 'about': callGlobal('openAboutMelatoninModal', { program: 'Paint' }); return;
                default:
                    if (root.paintLayers && root.paintLayers.action(this, a)) return;
                    break;
            }
        }

        editColors(i) {
            if (root.paintDialogs) root.paintDialogs.editColors(this, i);
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
                if (this.doc.active === 0) { ctx.fillStyle = this.bg; ctx.fillRect(0, 0, r.w, r.h); } else ctx.clearRect(0, 0, r.w, r.h);
            }, r);
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
                host: {
                    title: 'Paste From',
                    rejectMessage: 'Choose a picture',
                    acceptItem: (item) => item && item.targetKind === 'user-file' && /^image\//.test(item.mimeType || ''),
                    async onOpen(item) {
                        const res = await vfs().downloadFile(item.id);
                        const img = await loadImage(res.downloadUrl);
                        const c = C().makeCanvas(img.naturalWidth, img.naturalHeight);
                        c.getContext('2d').drawImage(img, 0, 0);
                        self.pasteCanvas(c);
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

    T.pencil = T.brush = {
        down(p) {
            if (!this.beginStroke(false)) return;
            this.last = p;
            this.growStroke(this.strokeDab(p.x, p.y, p.x, p.y, this.tool === 'pencil' ? 1 : this.brushSize(), this.color()));
        },
        move(p, ev, down) {
            if (!down || !this.sctx) return;
            this.growStroke(this.strokeDab(this.last.x, this.last.y, p.x, p.y, this.tool === 'pencil' ? 1 : this.brushSize(), this.color()));
            this.last = p;
        },
        up() { this.endStroke(); }
    };

    T.eraser = {
        down(p) {
            // the Background layer takes the background color (Vista); a layer above it goes transparent.
            // Right-drag is the Color Eraser: only the drawing color turns into the background color.
            const upper = this.doc.active > 0;
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
            this.growStroke(this.strokeDab(this.last.x, this.last.y, p.x, p.y, this.brushSize(), this.doc.active > 0 ? '#000' : this.bg));
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
            const mask = s && s.mask;
            const rect = C().floodFill(img, x, y, rgba, this.opt.tolerance > 32 ? this.opt.tolerance - 32 : 0, mask);
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
            const d = this.vctx.getImageData(x, y, 1, 1).data;
            const c = `#${[d[0], d[1], d[2]].map((v) => v.toString(16).padStart(2, '0')).join('')}`;
            if (this.right) this.bg = c; else this.fg = c;
            this.renderColors();
        },
        up() { this.setTool(this.prevTool || 'pencil'); }
    };

    T.magnifier = {
        down(p, ev) {
            const r = this.workspace.getBoundingClientRect();
            const at = { x: p.x, y: p.y, cx: ev.clientX - r.left, cy: ev.clientY - r.top };
            this.setZoom(this.right ? 1 : (this.zoom === 1 ? this.opt.zoomLevel || 4 : 1), at);
            this.opt.zoomLevel = this.zoom;
            this.renderOptions();
        }
    };

    T.text = {
        down(p) {
            // the text box sits above the canvas, so a click that reaches here is outside it
            if (this.text) { this.finishText(); return; }
            if (!this.editable()) return;
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
                const lw = this.brushSize();
                const rect = { x: Math.min(s.a.x, s.b.x) - lw, y: Math.min(s.a.y, s.b.y) - lw, w: Math.abs(s.b.x - s.a.x) + 2 * lw, h: Math.abs(s.b.y - s.a.y) + 2 * lw };
                this.commitToLayer(TOOLS.find((t) => t[0] === this.tool)[1], (ctx) => {
                    ctx.globalAlpha = this.opt.opacity / 100;
                    this.drawShape(ctx, kind, s.a, s.b, s.c1, s.c2);
                }, rect);
            }
        };
    }

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

    /** Select / Free-Form Select: drag out a selection; drag inside one to move it (Ctrl copies). */
    function selectTool(free) {
        return {
            down(p, ev) {
                const s = this.floating || this.doc.selection;
                const inside = s && p.x >= s.x && p.y >= s.y && p.x <= s.x + s.w && p.y <= s.y + s.h;
                if (inside) {
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
                this.sel = free ? { pts: [p] } : { a: p, b: p };
                this.setSelection(null);
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
                if (free) this.sel.pts.push(p);
                else this.sel.b = this.constrain(this.sel.a, p, ev, true);
                const sel = free ? T.freeselect.bounds(this.sel.pts) : this.rectOf(this.sel.a, this.sel.b);
                if (free) sel.path = this.sel.pts.slice();
                this.doc.selection = sel;
                this.drawAnts();
                this.sizeStatus();
            },
            up() {
                if (this.drag) { this.drag = null; return; }
                const s = this.doc.selection;
                this.sel = null;
                if (s && (s.w < 1 || s.h < 1)) this.setSelection(null);
            }
        };
    }

    T.select = selectTool(false);
    T.freeselect = selectTool(true);
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

    T.wand = {
        down(p, ev) {
            const x = Math.floor(p.x);
            const y = Math.floor(p.y);
            if (x < 0 || y < 0 || x >= this.doc.width || y >= this.doc.height) return;
            const s = this.floating || this.doc.selection;
            if (s && !ev.shiftKey && p.x >= s.x && p.y >= s.y && p.x <= s.x + s.w && p.y <= s.y + s.h && this.doc.selection && this.doc.selection.mask && this.doc.selection.mask[y * this.doc.width + x]) {
                // drag a wand selection like the other selections
                T.select.down.call(this, p, ev);
                this.wandDrag = true;
                return;
            }
            this.commitFloating();
            const img = this.doc.layer.ctx.getImageData(0, 0, this.doc.width, this.doc.height);
            const res = C().wandMask(img, x, y, this.opt.tolerance);
            if (!res) return;
            this.setSelection({ ...res.rect, mask: res.mask });
        },
        move(p, ev, down) { if (this.wandDrag) T.select.move.call(this, p, ev, down); },
        up(p, ev) { if (this.wandDrag) { this.wandDrag = false; T.select.up.call(this, p, ev); } }
    };

    T.move = {
        down(p, ev) {
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
            m.step.grow({ x: 0, y: 0, w: this.doc.width, h: this.doc.height });
            this.doc.commitStep(m.step);
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
            const c1 = this.right ? this.bg : this.fg;
            const c2 = this.right ? this.fg : this.bg;
            const sel = this.doc.selection;
            const rect = sel ? { x: sel.x, y: sel.y, w: sel.w, h: sel.h } : { x: 0, y: 0, w: this.doc.width, h: this.doc.height };
            this.commitToLayer('Gradient', (ctx) => {
                const g = this.opt.gradient === 'radial'
                    ? ctx.createRadialGradient(s.a.x, s.a.y, 0, s.a.x, s.a.y, Math.max(1, Math.hypot(s.b.x - s.a.x, s.b.y - s.a.y)))
                    : ctx.createLinearGradient(s.a.x, s.a.y, s.b.x, s.b.y);
                g.addColorStop(0, c1);
                g.addColorStop(1, c2);
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
            this.cloneOffset = { x: this.cloneSrc.x - p.x, y: this.cloneSrc.y - p.y };
            this.cloneSnap = C().makeCanvas(this.doc.width, this.doc.height);
            this.cloneSnap.getContext('2d').drawImage(this.doc.layer.canvas, 0, 0);
            this.last = p;
            T.clone.dab.call(this, p, p);
        },
        dab(a, b) {
            const size = this.brushSize() * 3;
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
            const size = Math.max(4, this.brushSize() * 4);
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
