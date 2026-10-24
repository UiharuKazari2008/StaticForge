/**
 * Snipping Tool (Yozora #632), Vista's SnippingTool.exe as a Melaton system package (apps/snipping).
 *
 *   the main window   measured on the VM: New (split; Free-form, Rectangular, Window, Full-screen
 *                     Snip, menu 109), Cancel, Options on the toolbar (bitmaps 130 / 131), the
 *                     instructions (strings 109-111, 121) and Help; it opens snipping at once
 *   snipping          the screen freezes under a white wash; the snip is drawn in the selection ink
 *                     (red), a window snip outlines the window under the pointer; Esc cancels
 *   the markup window File / Edit / Tools / Help (menu 120), New, Save Snip, Copy, Send Snip,
 *                     Pen, Highlighter, Eraser (bitmap 134), the VM's toolbar faces; ink is kept as
 *                     strokes (the eraser takes whole strokes)
 *   Options           dialog 107; Custom Pen dialog 140
 *
 * The screen is the desktop drawn again (windowCapture.js: wallpaper, icons, windows in z-order,
 * the taskbar), or, with the registry value ExactCapture, the tab's own pixels (getDisplayMedia,
 * which the browser asks about each time). Saves go to Documents (PNG, GIF, JPEG, Single file
 * HTML); Copy puts a PNG on the clipboard; Send Snip opens Dovecote with the snip.
 *
 *   melatonApps.define('snipping', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const KEY = 'HKCU\\Software\\Xyridian\\Melaton\\TabletPC\\Snip';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const ICON16 = '/static_images/app_icons/16/vista-snipping-tool.webp';
    const ICON24 = '/static_images/app_icons/24/vista-snipping-tool.webp';
    const CMD = '/static_images/vista-cmdbar';
    const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);

    const MODES = [
        ['free', 'Free-form Snip', 0], ['rect', 'Rectangular Snip', 1], ['window', 'Window Snip', 2], ['full', 'Full-screen Snip', 3]
    ];
    // the ink colour lists (strings 201-216, the 16 VGA colours)
    const INK = [['#000000', 'Black'], ['#800000', 'Maroon'], ['#008000', 'Green'], ['#808000', 'Olive'], ['#000080', 'Navy'], ['#800080', 'Purple'], ['#008080', 'Teal'], ['#808080', 'Grey'],
        ['#c0c0c0', 'Silver'], ['#ff0000', 'Red'], ['#00ff00', 'Lime'], ['#ffff00', 'Yellow'], ['#0000ff', 'Blue'], ['#ff00ff', 'Fuschia'], ['#00ffff', 'Aqua'], ['#ffffff', 'White']];
    const THICK = { fine: 1.5, medium: 3, thick: 6 };
    const PENS = [['red', 'Red Pen', '#ff0000'], ['blue', 'Blue Pen', '#0000ff'], ['black', 'Black Pen', '#000000'], ['custom', 'Custom Pen', null]];
    // SnippingTool.exe.mui strings 109-111, 121
    const MODE_TEXT = { free: 'Draw a line around the area you want to capture.', rect: 'Drag the cursor around the area you want to capture.', window: 'Select the window you want to capture.' };
    const IDLE_TEXT = 'Select a snip type from the menu or click the New button.';
    // bitmap 130 / 131 (24 px: New, Cancel, Options) and 134 (New Snip, Save, Copy, Send, Pen, Highlighter, Eraser)
    const tb = (i, off) => `<span class="snip-icon${off ? ' is-off' : ''}" style="--i:${i}"></span>`;
    const mk = (i) => `<span class="snip-icon is-markup" style="--i:${i}"></span>`;

    function prefs() {
        return {
            mode: reg('CaptureMode', 'rect'),
            hideText: reg('HideInstructions', false) === true,
            copy: reg('AlwaysCopy', true) !== false,
            prompt: reg('PromptToSave', true) !== false,
            ink: reg('SelectionInkColor', '#ff0000'),
            showInk: reg('ShowSelectionInk', true) !== false,
            overlay: reg('ShowScreenOverlay', true) !== false,
            exact: reg('ExactCapture', false) === true,
            quickLaunch: reg('QuickLaunchIcon', false) === true,
            includeUrl: reg('IncludeUrl', true) !== false,
            custom: (() => { try { return JSON.parse(reg('CustomPen', '') || 'null') || { color: '#ff0000', size: 'medium', tip: 'round' }; } catch (_) { return { color: '#ff0000', size: 'medium', tip: 'round' }; } })()
        };
    }


    function blobToBase64(blob) {
        return new Promise((resolve, reject) => {
            const r = new FileReader();
            r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
            r.onerror = () => reject(r.error);
            r.readAsDataURL(blob);
        });
    }

    const toBlob = (canvas, type = 'image/png', q) => new Promise((r) => canvas.toBlob(r, type, q));

    /** fn on the next frame, or soon (a background tab draws no frames). */
    function nextFrame(fn) {
        let done = false;
        const go = () => { if (!done) { done = true; fn(); } };
        requestAnimationFrame(go);
        setTimeout(go, 60);
    }

    // ---- the screen --------------------------------------------------------------------------

    /** The desktop as it shows (without the Snipping Tool's own windows): { canvas, scale, rects }. */
    async function grabScreen(app, hideEls) {
        const W = root.innerWidth;
        const H = root.innerHeight;
        hideEls.forEach((m) => m.classList.add('snip-hide'));
        // a frame for the windows to go (a background tab draws no frames: a timer stands in)
        await new Promise((r) => { requestAnimationFrame(() => requestAnimationFrame(r)); setTimeout(r, 80); });
        let shot = null;
        try {
            if (prefs().exact) shot = await grabExact(W);
            if (!shot) shot = await grabComposite(W, H, hideEls);
        } finally {
            hideEls.forEach((m) => m.classList.remove('snip-hide'));
        }
        return shot;
    }

    /** The tab's real pixels: the browser asks first; the stream ends as soon as one frame is in. */
    async function grabExact(W) {
        const md = navigator.mediaDevices;
        if (!md || !md.getDisplayMedia) return null;
        let stream = null;
        try {
            stream = await md.getDisplayMedia({ video: { displaySurface: 'browser', frameRate: 5 }, audio: false, preferCurrentTab: true, selfBrowserSurface: 'include' });
            const v = doc.createElement('video');
            v.muted = true;
            v.srcObject = stream;
            await v.play();
            await new Promise((r) => setTimeout(r, 120));
            const c = doc.createElement('canvas');
            c.width = v.videoWidth;
            c.height = v.videoHeight;
            c.getContext('2d').drawImage(v, 0, 0);
            return { canvas: c, scale: c.width / W, exact: true };
        } catch (_) {
            return null; // declined, or not allowed here: the drawn desktop instead
        } finally {
            if (stream) stream.getTracks().forEach((t) => t.stop());
        }
    }

    /** What makes the screen, bottom first: wallpaper, desktop icons, windows, the taskbar. */
    function layers(hideEls) {
        const shown = (el) => {
            if (!el || hideEls.includes(el)) return false;
            const cs = getComputedStyle(el);
            if (cs.display === 'none' || cs.visibility === 'hidden' || Number(cs.opacity) === 0) return false;
            const r = el.getBoundingClientRect();
            return r.width > 0 && r.height > 0 && r.right > 0 && r.bottom > 0 && r.left < root.innerWidth && r.top < root.innerHeight;
        };
        const z = (el) => Number(getComputedStyle(el).zIndex) || 0;
        const windows = Array.from(doc.querySelectorAll('body > .modal')).filter((m) => shown(m)
            && !m.classList.contains('hidden') && !m.classList.contains('minimised') && !m.classList.contains('closing'))
            .sort((a, b) => z(a) - z(b));
        const extra = Array.from(doc.querySelectorAll('body > .popover:not(.hidden), body > .context-menu')).filter(shown);
        return [doc.getElementById('desktopWallpaper'), doc.getElementById('desktopIcons'), ...windows, doc.getElementById('desktopTaskbar'), ...extra]
            .filter((el) => el && shown(el));
    }

    async function grabComposite(W, H, hideEls) {
        const scale = Math.min(2, root.devicePixelRatio || 1);
        const c = doc.createElement('canvas');
        c.width = Math.round(W * scale);
        c.height = Math.round(H * scale);
        const x = c.getContext('2d');
        x.fillStyle = '#000';
        x.fillRect(0, 0, c.width, c.height);
        x.scale(scale, scale);
        if (root.featureLoader && !root.windowCapture) await root.featureLoader.loadFeature('window_capture');
        const WC = root.windowCapture;
        const list = layers(hideEls);
        // every layer copied at once (an unchanged window reuses its last picture), then drawn in order
        const pics = await Promise.all(list.map((el) => (el.id === 'desktopWallpaper' || !WC ? null : WC.capture(el).catch(() => null))));
        for (let i = 0; i < list.length; i += 1) {
            const el = list[i];
            const r = el.getBoundingClientRect();
            // the wallpaper is a picture already: no need to copy its DOM
            if (el.id === 'desktopWallpaper') { await drawWallpaper(x, el, W, H); continue; }
            const pic = pics[i];
            if (!pic) continue;
            const src = WC.composite(pic);
            x.drawImage(src, 2, 2, src.width - 4, src.height - 4, r.left, r.top, pic.w, pic.h);
        }
        return { canvas: c, scale, exact: false };
    }

    /** The wallpaper element's CSS background (cover / contain / tile, its position and colour). */
    async function drawWallpaper(x, el, W, H) {
        const cs = getComputedStyle(el);
        x.fillStyle = cs.backgroundColor && cs.backgroundColor !== 'rgba(0, 0, 0, 0)' ? cs.backgroundColor : '#3a6ea5';
        x.fillRect(0, 0, W, H);
        const m = /url\("?([^")]+)"?\)/.exec(cs.backgroundImage || '');
        if (!m) return;
        const img = new Image();
        img.crossOrigin = 'anonymous';
        img.src = m[1];
        try { await img.decode(); } catch (_) { return; }
        const size = cs.backgroundSize || 'cover';
        const iw = img.naturalWidth;
        const ih = img.naturalHeight;
        if (/repeat/.test(cs.backgroundRepeat) && !/no-repeat/.test(cs.backgroundRepeat) && size === 'auto') {
            x.fillStyle = x.createPattern(img, 'repeat');
            x.fillRect(0, 0, W, H);
            return;
        }
        let k = size === 'contain' ? Math.min(W / iw, H / ih) : size === 'cover' ? Math.max(W / iw, H / ih) : 1;
        if (/100% 100%/.test(size)) { x.drawImage(img, 0, 0, W, H); return; }
        if (size === 'auto') k = 1;
        const dw = iw * k;
        const dh = ih * k;
        x.drawImage(img, (W - dw) / 2, (H - dh) / 2, dw, dh);
    }

    /** The windows a Window Snip can take, topmost first (and the taskbar, then the whole desktop). */
    function windowTargets(hideEls) {
        const list = layers(hideEls).filter((el) => el.id !== 'desktopWallpaper' && el.id !== 'desktopIcons').reverse();
        return list.map((el) => {
            const r = el.getBoundingClientRect();
            return { el, x: Math.max(0, r.left), y: Math.max(0, r.top), w: Math.min(root.innerWidth, r.right) - Math.max(0, r.left), h: Math.min(root.innerHeight, r.bottom) - Math.max(0, r.top) };
        }).concat([{ el: null, x: 0, y: 0, w: root.innerWidth, h: root.innerHeight }]);
    }

    // ---- snipping (the overlay) --------------------------------------------------------------

    class Session {
        constructor(tool, shot, mode, done) {
            this.tool = tool;
            this.shot = shot;
            this.mode = mode;
            this.done = done;
            this.p = prefs();
            const o = doc.createElement('div');
            o.className = `snip-overlay is-${mode}`;
            o.innerHTML = '<canvas class="snip-overlay-view"></canvas>';
            doc.body.appendChild(o);
            this.el = o;
            this.view = o.querySelector('canvas');
            this.view.width = root.innerWidth;
            this.view.height = root.innerHeight;
            this.vx = this.view.getContext('2d');
            this.targets = mode === 'window' ? windowTargets(tool.ownWindows()) : [];
            this.hot = null;
            this.path = null;
            this.draw();
            this.onKey = (ev) => { if (ev.key === 'Escape') { ev.preventDefault(); ev.stopPropagation(); this.finish(null); } };
            doc.addEventListener('keydown', this.onKey, true);
            o.addEventListener('pointerdown', (ev) => this.down(ev));
            o.addEventListener('pointermove', (ev) => this.move(ev));
            o.addEventListener('pointerup', (ev) => this.up(ev));
            o.addEventListener('contextmenu', (ev) => ev.preventDefault());
        }

        /** The frozen screen, washed white where it is not being taken (Show screen overlay). */
        draw() {
            const x = this.vx;
            const W = this.view.width;
            const H = this.view.height;
            x.clearRect(0, 0, W, H);
            x.drawImage(this.shot.canvas, 0, 0, W, H);
            if (!this.p.overlay) { this.drawInk(); return; }
            x.save();
            x.beginPath();
            x.rect(0, 0, W, H);
            const clear = this.clearShape();
            if (clear) { clear(x); x.clip('evenodd'); }
            x.fillStyle = 'rgba(255, 255, 255, 0.4)';
            x.fillRect(0, 0, W, H);
            x.restore();
            this.drawInk();
        }

        clearShape() {
            if (this.mode === 'window' && this.hot) { const t = this.hot; return (x) => x.rect(t.x, t.y, t.w, t.h); }
            if (this.mode === 'rect' && this.rect) { const r = this.rect; return (x) => x.rect(r.x, r.y, r.w, r.h); }
            if (this.mode === 'free' && this.path && this.path.length > 2) { const p = this.path; return (x) => { x.moveTo(p[0].x, p[0].y); p.forEach((q) => x.lineTo(q.x, q.y)); x.closePath(); }; }
            return null;
        }

        drawInk() {
            const x = this.vx;
            x.save();
            x.strokeStyle = this.p.ink;
            x.lineWidth = 2;
            x.lineJoin = 'round';
            x.lineCap = 'round';
            if (this.mode === 'rect' && this.rect) x.strokeRect(this.rect.x + 0.5, this.rect.y + 0.5, this.rect.w, this.rect.h);
            if (this.mode === 'window' && this.hot) { x.lineWidth = 4; x.strokeRect(this.hot.x + 2, this.hot.y + 2, this.hot.w - 4, this.hot.h - 4); }
            if (this.mode === 'free' && this.path) {
                x.beginPath();
                this.path.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
                x.stroke();
            }
            x.restore();
        }

        down(ev) {
            if (ev.button !== 0) { if (ev.button === 2) this.finish(null); return; }
            this.el.setPointerCapture(ev.pointerId);
            const p = { x: ev.clientX, y: ev.clientY };
            this.start = p;
            if (this.mode === 'free') this.path = [p];
            if (this.mode === 'rect') this.rect = { x: p.x, y: p.y, w: 0, h: 0 };
            if (this.mode === 'window') this.pick(p);
            this.draw();
        }

        pick(p) {
            this.hot = this.targets.find((t) => p.x >= t.x && p.y >= t.y && p.x < t.x + t.w && p.y < t.y + t.h) || null;
        }

        move(ev) {
            const p = { x: ev.clientX, y: ev.clientY };
            if (this.mode === 'window') { const before = this.hot; this.pick(p); if (before !== this.hot) this.draw(); return; }
            if (!this.start) return;
            if (this.mode === 'free') {
                const last = this.path[this.path.length - 1];
                if (Math.hypot(p.x - last.x, p.y - last.y) >= 2) this.path.push(p);
            } else {
                const s = this.start;
                this.rect = { x: Math.min(s.x, p.x), y: Math.min(s.y, p.y), w: Math.abs(p.x - s.x), h: Math.abs(p.y - s.y) };
            }
            this.draw();
        }

        up(ev) {
            if (!this.start && this.mode !== 'window') return;
            const p = { x: ev.clientX, y: ev.clientY };
            if (this.mode === 'window') { this.pick(p); if (this.hot) this.finish(this.cut({ x: this.hot.x, y: this.hot.y, w: this.hot.w, h: this.hot.h })); return; }
            this.start = null;
            if (this.mode === 'rect') {
                const r = this.rect;
                if (!r || r.w < 2 || r.h < 2) { this.rect = null; this.draw(); return; }
                this.finish(this.cut(r));
                return;
            }
            const path = this.path;
            if (!path || path.length < 3) { this.path = null; this.draw(); return; }
            let x0 = Infinity; let y0 = Infinity; let x1 = -Infinity; let y1 = -Infinity;
            path.forEach((q) => { x0 = Math.min(x0, q.x); y0 = Math.min(y0, q.y); x1 = Math.max(x1, q.x); y1 = Math.max(y1, q.y); });
            if (x1 - x0 < 2 || y1 - y0 < 2) { this.path = null; this.draw(); return; }
            this.finish(this.cut({ x: x0, y: y0, w: x1 - x0, h: y1 - y0 }, path));
        }

        /** The snip: the rectangle of the frozen screen (a free-form one white outside its outline). */
        cut(r, path) {
            const k = this.shot.scale;
            const W = Math.max(1, Math.round(r.w * k));
            const H = Math.max(1, Math.round(r.h * k));
            const c = doc.createElement('canvas');
            c.width = W;
            c.height = H;
            const x = c.getContext('2d');
            x.fillStyle = '#fff';
            x.fillRect(0, 0, W, H);
            x.save();
            if (path) {
                x.beginPath();
                path.forEach((q, i) => (i ? x.lineTo((q.x - r.x) * k, (q.y - r.y) * k) : x.moveTo((q.x - r.x) * k, (q.y - r.y) * k)));
                x.closePath();
                x.clip();
            }
            x.drawImage(this.shot.canvas, Math.round(r.x * k), Math.round(r.y * k), W, H, 0, 0, W, H);
            x.restore();
            // Show selection ink after snips are captured
            if (this.p.showInk) {
                x.strokeStyle = this.p.ink;
                x.lineWidth = 2 * k;
                x.lineJoin = 'round';
                if (path) {
                    x.beginPath();
                    path.forEach((q, i) => (i ? x.lineTo((q.x - r.x) * k, (q.y - r.y) * k) : x.moveTo((q.x - r.x) * k, (q.y - r.y) * k)));
                    x.closePath();
                    x.stroke();
                } else x.strokeRect(k, k, W - 2 * k, H - 2 * k);
            }
            return { canvas: c, scale: k };
        }

        finish(result) {
            doc.removeEventListener('keydown', this.onKey, true);
            this.el.remove();
            this.done(result);
        }
    }

    // ---- the windows -------------------------------------------------------------------------

    function chrome(title, cls, opts = {}) {
        const m = doc.createElement('div');
        m.className = `modal hidden ${opts.resizable ? 'resizeable-window ' : ''}snip-window ${cls}`;
        m.dataset.windowIdentifier = `melatonSnipping${cls}`;
        m.dataset.windowClient = 'light';
        m.dataset.taskbarIcon = ICON24;
        if (!opts.resizable) { m.dataset.windowFixedSize = 'true'; m.dataset.windowRestoreSize = 'false'; }
        if (opts.width) m.dataset.windowDefaultWidth = String(opts.width);
        if (opts.height) m.dataset.windowDefaultHeight = String(opts.height);
        if (opts.minWidth) m.dataset.windowMinWidth = String(opts.minWidth);
        if (opts.minHeight) m.dataset.windowMinHeight = String(opts.minHeight);
        m.setAttribute('role', 'dialog');
        m.setAttribute('aria-label', title);
        m.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>${esc(title)}</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                ${opts.resizable ? '' : '<button type="button" class="btn-secondary btn-small modal-work-area-maximize" title="Maximize" disabled><i class="fa-regular fa-window-maximize"></i></button>'}
                <button type="button" class="btn-danger close-btn btn-small snip-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 snip-client"></div>`;
        doc.body.appendChild(m);
        return m;
    }

    class SnippingTool {
        constructor(app) {
            this.app = app;
            this.main = null;
            this.markups = new Set();
            this.busy = false;
            this.mode = prefs().mode;
            if (!MODES.some((x) => x[0] === this.mode)) this.mode = 'rect';
        }

        ownWindows() {
            return [this.main, ...this.markups].filter(Boolean).map((x) => (x.modal || x));
        }

        // ---- the main window --------------------------------------------------------------

        openMain() {
            if (this.main && this.main.isConnected) { call('bringModalToFront', this.main); return this.main; }
            const m = chrome('Snipping Tool', 'snip-main');
            const p = prefs();
            // measured on the VM: a 284x85 client, the toolbar (38 px, #f0f0f0) over the message
            m.querySelector('.snip-client').innerHTML = `
                <div class="snip-toolbar" role="toolbar">
                    <button type="button" class="snip-tb snip-new" title="New snip">${tb(0)}<span class="snip-tb-text"><u>N</u>ew</span></button>
                    <button type="button" class="snip-tb snip-drop" title="New snip" aria-haspopup="menu"><span class="snip-arrow"></span></button>
                    <button type="button" class="snip-tb snip-cancel" title="Cancel snip" disabled>${tb(1, true)}<span class="snip-tb-text"><u>C</u>ancel</span></button>
                    <button type="button" class="snip-tb snip-options" title="More Options...">${tb(2)}<span class="snip-tb-text"><u>O</u>ptions</span></button>
                </div>
                <div class="snip-message"><div class="snip-text"${p.hideText ? ' hidden' : ''}></div><button type="button" class="snip-help" title="Help"></button></div>`;
            this.main = m;
            this.syncMain();
            m.querySelector('.snip-close').addEventListener('click', () => this.closeWindow(m));
            m.querySelector('.snip-new').addEventListener('click', () => void this.snip(this.mode));
            m.querySelector('.snip-cancel').addEventListener('click', () => { if (this.session) this.session.finish(null); });
            m.querySelector('.snip-options').addEventListener('click', () => this.options(m));
            m.querySelector('.snip-help').addEventListener('click', () => this.help());
            this.modeMenu(m.querySelector('.snip-drop'), m);
            this.track(m);
            this.show(m);
            return m;
        }

        syncMain() {
            const m = this.main;
            if (!m) return;
            const t = m.querySelector('.snip-text');
            if (t) { t.textContent = this.session ? (MODE_TEXT[this.mode] || IDLE_TEXT) : IDLE_TEXT; t.hidden = prefs().hideText; }
            const c = m.querySelector('.snip-cancel');
            if (c) { c.disabled = !this.session; c.querySelector('.snip-icon').classList.toggle('is-off', !this.session); }
        }

        modeMenu(btn, owner) {
            if (!root.contextMenu || !btn) return;
            root.contextMenu.attachClickMenuToElement(btn, {
                onAction: (a) => { if (a.startsWith('mode-')) { this.setMode(a.slice(5)); void this.snip(this.mode); } },
                sections: [{ type: 'list', initfn: (section) => {
                    section.items = MODES.map(([id, text]) => ({ text, action: `mode-${id}`, showIndicator: true, checked: this.mode === id }));
                } }]
            });
            void owner;
        }

        setMode(m) {
            this.mode = m;
            setReg({ CaptureMode: m });
            this.syncMain();
        }

        show(m) {
            // before openModal: an id-less window restores the shared 'unknown' geometry
            m.id = doc.getElementById('melatonSnippingModal') ? `melatonSnipping_${Math.random().toString(36).slice(2, 8)}` : 'melatonSnippingModal';
            call('openModal', m);
            m.classList.remove('hidden');
            nextFrame(() => {
                const r = m.getBoundingClientRect();
                if (!m.dataset.snipPlaced) {
                    m.dataset.snipPlaced = '1';
                    const x = m.classList.contains('snip-main') ? Math.round((root.innerWidth - r.width) / 2) : Math.round((root.innerWidth - r.width) / 2);
                    const y = m.classList.contains('snip-main') ? 80 : Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2));
                    call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, x), Math.max(0, y));
                }
            });
        }

        /** A window of the app: closing it may end the app; programFaults knows it. */
        track(m) {
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: 'Snipping Tool', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'snipping' }) });
            }
        }

        closeWindow(m) {
            try { call('closeModal', m); } catch (_) { /* gone */ }
            setTimeout(() => m.remove(), 300);
            if (m === this.main) this.main = null;
            for (const k of this.markups) if (k.modal === m) this.markups.delete(k);
            if (!this.main && !this.markups.size && !this.session) this.app.exit();
        }

        // ---- a snip --------------------------------------------------------------------

        async snip(mode) {
            if (this.busy) return;
            this.busy = true;
            this.mode = mode;
            this.syncMain();
            const own = this.ownWindows();
            try {
                const shot = await grabScreen(this.app, own);
                if (!shot) return;
                if (mode === 'full') { this.captured({ canvas: shot.canvas, scale: shot.scale }); return; }
                // the Snipping Tool's window stays over the frozen screen (Vista), the others go
                const hidden = [...this.markups].map((k) => k.modal);
                hidden.forEach((m) => m.classList.add('snip-hide'));
                await new Promise((resolve) => {
                    this.session = new Session(this, shot, mode, (res) => {
                        this.session = null;
                        hidden.forEach((m) => m.classList.remove('snip-hide'));
                        this.lift(false);
                        this.syncMain();
                        if (res) this.captured(res);
                        else if (!this.main && !this.markups.size) this.app.exit();
                        resolve();
                    });
                    if (this.main) this.lift(true);
                    this.syncMain();
                });
            } finally {
                this.busy = false;
            }
        }

        /** The main window over the overlay while snipping, and back after. */
        lift(on) {
            if (!this.main) return;
            if (on) { this.main.dataset.snipZ = this.main.style.zIndex || ''; this.main.style.zIndex = '2147483001'; } else if ('snipZ' in this.main.dataset) {
                this.main.style.zIndex = this.main.dataset.snipZ;
                delete this.main.dataset.snipZ;
                call('bringModalToFront', this.main);
            }
        }

        captured(res) {
            const p = prefs();
            // Vista: the main window gives way to the markup window
            if (this.main) { const m = this.main; this.main = null; try { call('closeModal', m); } catch (_) { /* gone */ } setTimeout(() => m.remove(), 300); }
            const k = new Markup(this, res.canvas, res.scale || 1);
            this.markups.add(k);
            if (p.copy) void k.copy(true);
        }

        // ---- Options -------------------------------------------------------------------

        /** Snipping Tool Options: SnippingTool.exe.mui dialog 107. */
        options(owner) {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const p = prefs();
            V.openDialog({
                id: 'snipOptions', key: 'snippingtool:107', icon: ICON16, owner,
                init: (ctx) => {
                    ctx.set(1025, p.hideText); ctx.set(1022, p.copy); ctx.set(1018, p.includeUrl); ctx.set(1026, p.prompt);
                    ctx.set(1015, p.quickLaunch); ctx.set(1016, p.overlay); ctx.set(1023, p.showInk);
                    const s = ctx.el(1019);
                    if (s) { s.innerHTML = INK.map(([v, t]) => `<option value="${v}">${t}</option>`).join(''); s.value = INK.some((x) => x[0] === p.ink) ? p.ink : '#ff0000'; }
                },
                ok: (ctx) => {
                    setReg({
                        HideInstructions: !!ctx.get(1025), AlwaysCopy: !!ctx.get(1022), IncludeUrl: !!ctx.get(1018), PromptToSave: !!ctx.get(1026),
                        QuickLaunchIcon: !!ctx.get(1015), ShowScreenOverlay: !!ctx.get(1016), SelectionInkColor: String(ctx.get(1019) || '#ff0000'), ShowSelectionInk: !!ctx.get(1023)
                    });
                    setTimeout(() => this.syncMain(), 50);
                    return true;
                }
            });
        }

        /** F1: Vista opens its Help topic; Melaton has none to show (string 15064). */
        help() {
            void call('showConfirmationDialog', '<p>The Help topic failed to appear.</p>', [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Snipping Tool', width: 320 });
        }

        about(owner) {
            if (typeof root.openAboutMelatoninModal === 'function') root.openAboutMelatoninModal({ program: 'Snipping Tool', owner });
        }
    }

    // ---- the markup window ---------------------------------------------------------------------

    class Markup {
        constructor(tool, canvas, scale) {
            this.tool = tool;
            this.snipCanvas = canvas;
            this.scale = scale;
            this.strokes = [];
            this.pen = 'blue';
            this.mode = 'pen';
            this.saved = false;
            const w = Math.round(canvas.width / scale);
            const h = Math.round(canvas.height / scale);
            // the window fits the snip with a margin, 521x503 at the least (the VM), within the screen:
            // frames 16 and the vertical scroll bar 17 across; caption 28, menu bar 19, toolbar 43,
            // the edge 1, the horizontal scroll bar 17 and the frame 8 down
            const W = Math.min(root.innerWidth - 40, Math.max(521, w + 33 + 60));
            const H = Math.min(root.innerHeight - 80, Math.max(503, h + 116 + 60));
            const m = chrome('Snipping Tool', 'snip-markup', { resizable: true, width: W, height: H, minWidth: 360, minHeight: 200 });
            m.style.width = `${W}px`;
            m.style.height = `${H}px`;
            // measured on the VM: the menu bar (19 px band), the toolbar (43 px, #f0f0f0), the snip
            // centred on white with both scroll bars
            m.querySelector('.snip-client').innerHTML = `
                <div class="naxt-menubar snip-menubar" role="menubar">${['File', 'Edit', 'Tools', 'Help'].map((t) => `<button type="button" class="naxt-menu-title" data-snip-menu="${t.toLowerCase()}" role="menuitem">${t}</button>`).join('')}</div>
                <div class="snip-toolbar is-markup" role="toolbar">
                    <button type="button" class="snip-tb snip-new" title="New Snip">${mk(0)}<span class="snip-tb-text"><u>N</u>ew</span></button>
                    <button type="button" class="snip-tb is-icon" data-a="save" title="Save Snip">${mk(1)}</button>
                    <button type="button" class="snip-tb is-icon" data-a="copy" title="Copy">${mk(2)}</button>
                    <button type="button" class="snip-tb is-split" data-a="send" title="Send Snip">${mk(3)}</button>
                    <button type="button" class="snip-tb snip-drop snip-send-drop" title="Send Snip" aria-haspopup="menu"><span class="snip-arrow"></span></button>
                    <span class="snip-sep"></span>
                    <button type="button" class="snip-tb is-split snip-pen" data-a="pen" title="Pen">${mk(4)}</button>
                    <button type="button" class="snip-tb snip-drop snip-pen-drop" title="Pen" aria-haspopup="menu"><span class="snip-arrow"></span></button>
                    <button type="button" class="snip-tb is-icon" data-a="hl" title="Highlighter">${mk(5)}</button>
                    <button type="button" class="snip-tb is-icon" data-a="eraser" title="Eraser">${mk(6)}</button>
                </div>
                <div class="snip-stage"><div class="snip-paper"><canvas class="snip-ink"></canvas></div></div>`;
            this.modal = m;
            this.stage = m.querySelector('.snip-stage');
            this.ink = m.querySelector('.snip-ink');
            this.ink.width = canvas.width;
            this.ink.height = canvas.height;
            this.ink.style.width = `${w}px`;
            this.ink.style.height = `${h}px`;
            this.ix = this.ink.getContext('2d');
            this.render();
            this.wire();
            this.syncTools();
            tool.track(m);
            tool.show(m);
        }

        wire() {
            const m = this.modal;
            m.querySelector('.snip-close').addEventListener('click', () => void this.close());
            m.querySelectorAll('[data-snip-menu]').forEach((t) => {
                root.contextMenu.attachClickMenuToElement(t, {
                    onAction: (a) => void this.action(a),
                    sections: [{ type: 'list', initfn: (section) => { section.items = this.menu(t.dataset.snipMenu); } }]
                });
            });
            m.querySelector('.snip-new').addEventListener('click', () => void this.tool.snip(this.tool.mode));
            m.querySelectorAll('.snip-toolbar [data-a]').forEach((b) => b.addEventListener('click', () => void this.action(b.dataset.a)));
            const dropMenu = (sel, items) => root.contextMenu.attachClickMenuToElement(m.querySelector(sel), {
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (section) => { section.items = items(); } }]
            });
            dropMenu('.snip-pen-drop', () => this.penItems());
            // menu 145
            dropMenu('.snip-send-drop', () => [{ text: 'E-mail Recipient', action: 'send-inline' }, { text: 'E-mail Recipient (as attachment)', action: 'send' }]);
            const ink = this.ink;
            ink.addEventListener('pointerdown', (ev) => this.down(ev));
            ink.addEventListener('pointermove', (ev) => this.move(ev));
            ink.addEventListener('pointerup', () => this.up());
            ink.addEventListener('pointercancel', () => this.up());
            m.addEventListener('keydown', (ev) => {
                const ctrl = ev.ctrlKey || ev.metaKey;
                if (!ctrl) return;
                const a = { n: 'new', s: 'save', c: 'copy' }[ev.key.toLowerCase()];
                if (!a) return;
                ev.preventDefault();
                ev.stopPropagation();
                void this.action(a);
            });
        }

        penItems() {
            return PENS.map(([id, text]) => ({ text, action: `pen-${id}`, showIndicator: true, checked: this.pen === id }))
                .concat([{ separator: true }, { text: 'Customize...', action: 'customize' }]);
        }

        menu(name) {
            switch (name) {
                // SnippingTool.exe.mui menu 120
                case 'file': return [
                    { text: 'New Snip', subtext: 'Ctrl+N', action: 'new' },
                    { separator: true },
                    { text: 'Save As', subtext: 'Ctrl+S', action: 'save' },
                    { text: 'Send To', hasSubmenu: true, submenu: [{ text: 'E-mail Recipient', action: 'send-inline' }, { text: 'E-mail Recipient (as attachment)', action: 'send' }] },
                    { separator: true },
                    { text: 'Exit', action: 'exit' }
                ];
                case 'edit': return [{ text: 'Copy', subtext: 'Ctrl+C', action: 'copy' }];
                case 'tools': return [
                    { text: 'Pen', hasSubmenu: true, submenu: this.penItems() },
                    { text: 'Highlighter', action: 'hl' },
                    { text: 'Eraser', action: 'eraser' },
                    { separator: true },
                    { text: 'Options', action: 'options' }
                ];
                case 'help': return [{ text: 'Help', subtext: 'F1', action: 'help' }, { text: 'About', action: 'about' }];
                default: return [];
            }
        }

        async action(a) {
            if (a.startsWith('pen-')) { this.pen = a.slice(4); this.mode = 'pen'; this.syncTools(); return; }
            switch (a) {
                case 'new': void this.tool.snip(this.tool.mode); return;
                case 'save': await this.saveAs(); return;
                case 'copy': await this.copy(false); return;
                case 'send': await this.send(); return;
                case 'pen': this.mode = 'pen'; this.syncTools(); return;
                case 'hl': this.mode = 'hl'; this.syncTools(); return;
                case 'eraser': this.mode = 'eraser'; this.syncTools(); return;
                case 'customize': this.customize(); return;
                case 'send-inline': await this.send(true); return;
                case 'options': this.tool.options(this.modal); return;
                case 'help': this.tool.help(); return;
                case 'about': this.tool.about(this.modal); return;
                case 'exit': await this.close(); return;
                default:
            }
        }

        syncTools() {
            const m = this.modal;
            // the tool in use is held down (TBSTATE_CHECKED), its drop part with it
            m.querySelectorAll('.snip-toolbar [data-a]').forEach((b) => b.classList.toggle('is-on', b.dataset.a === this.mode));
            const pd = m.querySelector('.snip-pen-drop');
            if (pd) pd.classList.toggle('is-on', this.mode === 'pen');
            this.ink.dataset.mode = this.mode;
        }

        penStyle() {
            if (this.mode === 'hl') return { color: '#ffff00', width: 14, tip: 'chisel', hl: true };
            const c = prefs().custom;
            const p = PENS.find((x) => x[0] === this.pen);
            if (this.pen === 'custom') return { color: c.color, width: THICK[c.size] || 3, tip: c.tip };
            return { color: p[2], width: THICK.medium, tip: 'round' };
        }

        // ---- ink ---------------------------------------------------------------------

        point(ev) {
            const r = this.ink.getBoundingClientRect();
            return { x: ((ev.clientX - r.left) / r.width) * this.ink.width, y: ((ev.clientY - r.top) / r.height) * this.ink.height };
        }

        down(ev) {
            if (ev.button !== 0) return;
            this.ink.setPointerCapture(ev.pointerId);
            const p = this.point(ev);
            if (this.mode === 'eraser') { this.erasing = true; this.eraseAt(p); return; }
            const s = { ...this.penStyle(), pts: [p] };
            s.width *= this.scale;
            this.strokes.push(s);
            this.drawing = s;
            this.saved = false;
            this.render();
        }

        move(ev) {
            const p = this.point(ev);
            if (this.erasing) { this.eraseAt(p); return; }
            if (!this.drawing) return;
            const last = this.drawing.pts[this.drawing.pts.length - 1];
            if (Math.hypot(p.x - last.x, p.y - last.y) < 1) return;
            this.drawing.pts.push(p);
            this.render();
        }

        up() { this.drawing = null; this.erasing = false; }

        /** Vista's eraser takes a whole stroke it touches. */
        eraseAt(p) {
            const tol = 6 * this.scale;
            const hit = this.strokes.findIndex((s) => s.pts.some((q, i) => {
                const a = s.pts[i - 1] || q;
                const dx = q.x - a.x; const dy = q.y - a.y;
                const len2 = dx * dx + dy * dy || 1;
                const t = Math.max(0, Math.min(1, ((p.x - a.x) * dx + (p.y - a.y) * dy) / len2));
                return Math.hypot(p.x - (a.x + dx * t), p.y - (a.y + dy * t)) <= tol + s.width / 2;
            }));
            if (hit < 0) return;
            this.strokes.splice(hit, 1);
            this.saved = false;
            this.render();
        }

        /** The snip with its ink: pens on top, each highlighter stroke laid on alone (multiplied). */
        flat() {
            const c = doc.createElement('canvas');
            c.width = this.snipCanvas.width;
            c.height = this.snipCanvas.height;
            this.paint(c.getContext('2d'));
            return c;
        }

        paint(x) {
            x.drawImage(this.snipCanvas, 0, 0);
            this.strokes.forEach((s) => {
                if (s.hl) {
                    const l = doc.createElement('canvas');
                    l.width = x.canvas.width;
                    l.height = x.canvas.height;
                    trace(l.getContext('2d'), s);
                    x.save();
                    x.globalCompositeOperation = 'multiply';
                    x.globalAlpha = 0.6;
                    x.drawImage(l, 0, 0);
                    x.restore();
                } else trace(x, s);
            });
        }

        render() {
            this.ix.clearRect(0, 0, this.ink.width, this.ink.height);
            this.paint(this.ix);
        }

        // ---- files and the clipboard -------------------------------------------------------

        async copy(quiet) {
            const c = this.flat();
            root.melatonClipboardImage = c;
            try {
                const blob = await toBlob(c);
                await navigator.clipboard.write([new ClipboardItem({ 'image/png': blob })]);
            } catch (_) {
                // the browser's clipboard needs the page in focus; Melaton's own copy still pastes in Paint
            }
            void quiet;
        }

        saveAs() {
            if (typeof root.studioOpenFolderDialog !== 'function') return Promise.resolve(false);
            const self = this;
            const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : ''; // eslint-disable-line no-undef
            return new Promise((resolve) => {
                void root.studioOpenFolderDialog('save', {
                    owner: this.modal,
                    startPath: ws ? `/Workspaces/${ws}` : '/',
                    host: {
                        title: 'Save As',
                        typeLabel: 'Portable Network Graphic file (PNG) (*.png); JPEG file (*.jpg); Single file HTML (MHT) (*.mht)',
                        acceptType: 'user-file',
                        suggestName: () => 'Capture.png',
                        async onSave(info) {
                            let name = String(info.name || '').trim();
                            if (!name) return false;
                            if (!/\.(png|jpe?g|mht)$/i.test(name)) name += '.png';
                            try {
                                const { blob, mime } = await self.encode(name);
                                const data = await blobToBase64(blob);
                                const vfs = root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef
                                await vfs.uploadFile(info.path || '/', data, name, mime);
                                self.saved = true;
                                resolve(true);
                                return true;
                            } catch (err) {
                                await self.message(`The snip could not be saved.\n${(err && err.message) || err}`);
                                resolve(false);
                                return false;
                            }
                        },
                        onCancel() { resolve(false); }
                    }
                });
            });
        }

        async encode(name) {
            const c = this.flat();
            if (/\.jpe?g$/i.test(name)) {
                const w = doc.createElement('canvas');
                w.width = c.width; w.height = c.height;
                const x = w.getContext('2d');
                x.fillStyle = '#fff'; x.fillRect(0, 0, w.width, w.height); x.drawImage(c, 0, 0);
                return { blob: await toBlob(w, 'image/jpeg', 0.92), mime: 'image/jpeg' };
            }
            if (/\.mht$/i.test(name)) {
                // Single file HTML: a MIME document, the page and its picture
                const png = await blobToBase64(await toBlob(c));
                const b = `----=_NextPart_${Date.now().toString(16)}`;
                const html = `<html><head><title>Snipping Tool</title></head><body><img src="snip.png" width="${Math.round(c.width / this.scale)}" height="${Math.round(c.height / this.scale)}"></body></html>`;
                const text = [
                    'MIME-Version: 1.0', `Content-Type: multipart/related; boundary="${b}"; type="text/html"`, '',
                    `--${b}`, 'Content-Type: text/html; charset="utf-8"', 'Content-Transfer-Encoding: 8bit', 'Content-Location: file:///C:/snip.htm', '', html, '',
                    `--${b}`, 'Content-Type: image/png', 'Content-Transfer-Encoding: base64', 'Content-Location: file:///C:/snip.png', '',
                    png.replace(/.{76}/g, '$&\r\n'), '', `--${b}--`, ''
                ].join('\r\n');
                return { blob: new Blob([text], { type: 'message/rfc822' }), mime: 'message/rfc822' };
            }
            return { blob: await toBlob(c), mime: 'image/png' };
        }

        /** Send To: in the message (E-mail Recipient) or attached (as attachment). */
        async send(inline) {
            const open = typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : root.doveOpenComposeWindow; // eslint-disable-line no-undef
            if (typeof open !== 'function') {
                await this.message('The snip could not be sent. Check that an e-mail program is installed and then try again.'); // 15067
                return;
            }
            const blob = await toBlob(this.flat());
            const base64 = await blobToBase64(blob);
            // Dovecote's compose takes the picture as a file either way; the message says where it came from (182)
            open({ mode: 'create', to: '', subject: inline ? 'Capture' : '', body: inline ? 'Sent from Snipping Tool' : '', attachments: [{ name: 'Capture.png', mimeType: 'image/png', size: blob.size, base64 }] });
        }

        message(text) {
            return call('showConfirmationDialog', `<p>${esc(text).replace(/\n/g, '<br>')}</p>`, [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: 'Snipping Tool', width: 360 });
        }

        /** Tools > Pen > Customize: Custom Pen, SnippingTool.exe.mui dialog 140 (strings 170-172, 178-179). */
        customize() {
            const V = root.vistaDialogTemplate;
            if (!V) return;
            const c = prefs().custom;
            V.openDialog({
                id: 'snipCustomize', key: 'snippingtool:140', icon: ICON16, owner: this.modal,
                init: (ctx) => {
                    const fill = (id, list, v) => { const e = ctx.el(id); if (e) { e.innerHTML = list.map(([a, b]) => `<option value="${a}">${b}</option>`).join(''); e.value = v; } };
                    fill(1019, INK, c.color);
                    fill(1022, [['fine', 'Fine point pen'], ['medium', 'Medium point pen'], ['thick', 'Thick point pen']], c.size);
                    fill(1023, [['round', 'Round tip pen'], ['chisel', 'Chisel tip pen']], c.tip);
                },
                ok: (ctx) => {
                    setReg({ CustomPen: JSON.stringify({ color: String(ctx.get(1019)), size: String(ctx.get(1022)), tip: String(ctx.get(1023)) }) });
                    this.pen = 'custom';
                    this.mode = 'pen';
                    setTimeout(() => this.syncTools(), 0);
                    return true;
                }
            });
        }

        /** Vista asks about an unsaved snip (Prompt to save snips before exiting). */
        async close() {
            if (!this.saved && prefs().prompt) {
                // string 1031
                const v = await call('showConfirmationDialog', '<p>Do you want to save changes to the snip?</p>', [
                    { text: 'Yes', value: 'yes', className: 'btn-standard primary' }, { text: 'No', value: 'no', className: 'btn-standard' }, { text: 'Cancel', value: 'cancel', className: 'btn-standard' }
                ], null, { title: 'Snipping Tool', width: 360 });
                if (v === 'cancel' || v === null || v === undefined || v === false) return;
                if (v === 'yes' && !await this.saveAs()) return;
            }
            this.tool.closeWindow(this.modal);
        }
    }

    function trace(x, s) {
        x.save();
        x.strokeStyle = s.color;
        x.lineWidth = s.width;
        x.lineJoin = 'round';
        x.lineCap = s.tip === 'chisel' ? 'square' : 'round';
        x.beginPath();
        s.pts.forEach((q, i) => (i ? x.lineTo(q.x, q.y) : x.moveTo(q.x, q.y)));
        if (s.pts.length === 1) x.lineTo(s.pts[0].x + 0.01, s.pts[0].y);
        x.stroke();
        x.restore();
    }

    // ---- the app -------------------------------------------------------------------------------

    let running = null;

    async function start(app) {
        // Options and Customize Pens are Vista dialog templates, a feature loaded on demand
        if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ } }
        if (running) {
            // already open: the main window comes up (Vista runs one Snipping Tool)
            running.openMain();
            app.exit();
            return;
        }
        const tool = new SnippingTool(app);
        running = tool;
        app.onExit(() => {
            running = null;
            if (tool.session) tool.session.finish(null);
            tool.ownWindows().forEach((m) => { try { call('closeModal', m); } catch (_) { /* gone */ } m.remove(); });
        });
        tool.openMain();
        // Vista starts snipping straight away, in the last mode
        if (tool.mode !== 'full') setTimeout(() => void tool.snip(tool.mode), 250);
    }

    root.melatonSnipping = { start, Session, grabComposite, layers, _running: () => running };
    if (typeof melatonApps !== 'undefined') melatonApps.define('snipping', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
