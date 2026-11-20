/**
 * Adobe Reader 8 (Yozora #910, Yukimi Nov 20 2026): a 1:1 clone of Adobe Reader 8.1.3, the Vista era's PDF
 * reader, as a Melaton system package (apps/reader). Reference: AdbeRdr813_en_US.msi from archive.org
 * (adbe-rdr-813-en-us, signed by Adobe Systems Incorporated), installed in the Vista VM; captures and the
 * resources of AcroRd32.dll / AcroRd32.exe in ~/.cache/vista-vm/adobe-reader (ref/, bin/).
 *
 *   the window    menu bar (File Edit View Document Tools Window Help, Reader's own flat bar), the toolbar
 *                 (File: Print, Email; Page Navigation: Previous / Next Page, page box; Select & Zoom: Zoom
 *                 Out / In, zoom box; Page Display: Fit Width, Fit Page; Find), the navigation bar (Pages,
 *                 Bookmarks, How To; Attachments and Comments at the bottom), the navigation panel, the
 *                 document pane
 *   engine        pdf.js (public/dist/pdfjs, Mozilla, Apache-2.0): pages drawn into canvases as they come
 *                 into view, a text layer over each for selection, Find and copying, link areas
 *   views         Fit Width / Fit Page / Fit Visible / Actual Size / a percentage, Single Page, Single Page
 *                 Continuous, Two-Up, Two-Up Continuous, rotation, Select / Hand / Marquee Zoom / Dynamic Zoom
 *   panels        Pages (thumbnails), Bookmarks (the outline), Attachments (files in the PDF), Comments
 *   dialogs       Go To Page, Document Properties, Preferences, Print (Melaton's printers: the XPS Document
 *                 Writer saves an .xps to the computer), Search, About Adobe Reader 8
 *   files         launch args { file: { id, name, path } } (a computer file), { url, name } (a file the
 *                 server serves: an archive's entry, a phone's file) or { data: base64 | Uint8Array, name }
 *                 (an e-mail attachment); Save a Copy and Save as Text write to the computer
 *
 *   melatonApps.define('reader', start)
 */
(function (root) {
    'use strict';

    const doc = document;
    const A = '/melaton-apps/reader/assets';
    const PDFJS = '/dist/pdfjs';
    const ICON16 = `${A}/icon-16.png`;
    const ICON24 = '/static_images/app_icons/24/adobe-reader.webp';
    // Reader 8 keeps its settings under HKCU\Software\Adobe\Acrobat Reader\8.0 (AVGeneral, Originals, ...)
    const KEY = 'HKCU\\Software\\Adobe\\Acrobat Reader\\8.0\\AVGeneral';
    const PRINTKEY = 'HKCU\\Software\\Xyridian\\Melaton NT\\CurrentVersion\\Windows';
    const reg = (n, d) => (root.melatonRegistry ? root.melatonRegistry.get(KEY, n, d) : d);
    const setReg = (v) => { if (root.melatonRegistry) void root.melatonRegistry.set(KEY, v); };
    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
    const call = (name, ...args) => (typeof root[name] === 'function' ? root[name](...args) : undefined);
    const vfs = () => root.vfsClient || (typeof vfsClient !== 'undefined' ? vfsClient : null); // eslint-disable-line no-undef

    // the zoom box's list and the Zoom In / Out steps (Reader 8's)
    const ZOOMS = [0.0833, 0.125, 0.25, 0.3333, 0.5, 0.6667, 0.75, 1, 1.25, 1.5, 2, 3, 4, 6, 8, 12, 16, 24, 32, 64];
    const GAP = 8; // Show Gaps Between Pages
    const MAX_CANVAS = 16777216;

    // ---- pdf.js ------------------------------------------------------------------------------

    let pdfjsPromise = null;
    /**
     * The modern build wants this year's engine (Map getOrInsertComputed, Math.sumPrecise, Uint8Array toHex) in the
     * page and in its worker; an older browser gets the same release's legacy build. Asked of a fresh worker: the
     * page's own globals may already hold the legacy build's polyfills.
     */
    function modernEngine() {
        return new Promise((resolve) => {
            let url = null;
            try {
                url = URL.createObjectURL(new Blob(["postMessage(typeof Map.prototype.getOrInsertComputed === 'function' && typeof Math.sumPrecise === 'function' && typeof Uint8Array.prototype.toHex === 'function')"], { type: 'text/javascript' }));
                const w = new Worker(url);
                const done = (v) => { w.terminate(); URL.revokeObjectURL(url); resolve(v); };
                w.onmessage = (ev) => done(ev.data === true);
                w.onerror = () => done(false);
            } catch (_) { if (url) URL.revokeObjectURL(url); resolve(false); }
        });
    }

    function loadPdfJs() {
        if (!pdfjsPromise) {
            pdfjsPromise = modernEngine().then((modern) => {
                const build = modern ? PDFJS : `${PDFJS}/legacy`;
                return import(`${build}/pdf.min.mjs`).then((lib) => {
                    lib.GlobalWorkerOptions.workerSrc = `${build}/pdf.worker.min.mjs`;
                    return lib;
                });
            }).catch((err) => { pdfjsPromise = null; throw err; });
        }
        return pdfjsPromise;
    }

    function b64ToBytes(b64) {
        const bin = atob(String(b64 || ''));
        const out = new Uint8Array(bin.length);
        for (let i = 0; i < bin.length; i += 1) out[i] = bin.charCodeAt(i);
        return out;
    }

    function bytesToB64(bytes) {
        let s = '';
        const CH = 0x8000;
        for (let i = 0; i < bytes.length; i += CH) s += String.fromCharCode.apply(null, bytes.subarray(i, i + CH));
        return btoa(s);
    }

    function fmtZoom(z) {
        const p = z * 100;
        return `${Math.abs(p - Math.round(p)) < 0.05 ? Math.round(p) : p.toFixed(1)}%`;
    }

    function fmtBytes(n) {
        if (n < 1024) return `${n} Bytes`;
        if (n < 1048576) return `${(n / 1024).toFixed(2)} KB (${n.toLocaleString('en-US')} Bytes)`;
        return `${(n / 1048576).toFixed(2)} MB (${n.toLocaleString('en-US')} Bytes)`;
    }

    /** "D:20261120014345+09'00'" -> "11/20/2026 1:43:45 AM" (Reader's short date and long time). */
    function fmtPdfDate(s) {
        const m = /^(?:D:)?(\d{4})(\d{2})?(\d{2})?(\d{2})?(\d{2})?(\d{2})?([Zz+-])?(\d{2})?'?(\d{2})?/.exec(String(s || ''));
        if (!m) return '';
        const [y, mo = '01', d = '01', h = '00', mi = '00', se = '00', tz, th = '00', tm = '00'] = m.slice(1);
        let t = Date.UTC(+y, +mo - 1, +d, +h, +mi, +se);
        if (tz === '+' || tz === '-') t -= (tz === '+' ? 1 : -1) * ((+th) * 60 + (+tm)) * 60000;
        const dt = new Date(tz ? t : Date.UTC(+y, +mo - 1, +d, +h, +mi, +se) + new Date().getTimezoneOffset() * 60000);
        const hr = dt.getHours() % 12 || 12;
        return `${dt.getMonth() + 1}/${dt.getDate()}/${dt.getFullYear()} ${hr}:${String(dt.getMinutes()).padStart(2, '0')}:${String(dt.getSeconds()).padStart(2, '0')} ${dt.getHours() < 12 ? 'AM' : 'PM'}`;
    }

    // ---- a stored ZIP (the XPS Document Writer's package) ----------------------------------------

    const CRC = (() => { const t = new Uint32Array(256); for (let n = 0; n < 256; n += 1) { let c = n; for (let k = 0; k < 8; k += 1) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t[n] = c >>> 0; } return t; })();
    function crc32(b) { let c = 0xFFFFFFFF; for (let i = 0; i < b.length; i += 1) c = CRC[(c ^ b[i]) & 0xFF] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; }
    function zipStore(files) {
        const enc = new TextEncoder();
        const parts = [];
        const central = [];
        let off = 0;
        files.forEach(({ name, data }) => {
            const nb = enc.encode(name);
            const d = typeof data === 'string' ? enc.encode(data) : data;
            const crc = crc32(d);
            const h = new DataView(new ArrayBuffer(30));
            h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
            h.setUint32(18, d.length, true); h.setUint32(22, d.length, true); h.setUint16(26, nb.length, true);
            parts.push(new Uint8Array(h.buffer), nb, d);
            const c = new DataView(new ArrayBuffer(46));
            c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
            c.setUint32(20, d.length, true); c.setUint32(24, d.length, true); c.setUint16(28, nb.length, true); c.setUint32(42, off, true);
            central.push(new Uint8Array(c.buffer), nb);
            off += 30 + nb.length + d.length;
        });
        const size = central.reduce((n, p) => n + p.length, 0);
        const e = new DataView(new ArrayBuffer(22));
        e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
        e.setUint32(12, size, true); e.setUint32(16, off, true);
        return new Blob(parts.concat(central, [new Uint8Array(e.buffer)]), { type: 'application/vnd.ms-xpsdocument' });
    }

    // ---- dialog templates (Reader's dialogs are drawn by its own layout engine; these place the VM's
    // pixels in Segoe UI 9 dialog units: x * 4/7, y * 8/15) --------------------------------------

    const V = 0x50000000; // WS_CHILD | WS_VISIBLE
    const TAB = 0x10000;
    const GRP = 0x20000;
    const dx = (p) => Math.round((p * 4) / 7);
    const dy = (p) => Math.round((p * 8) / 15);
    const C = {
        st: (id, x, y, w, h, t, right) => [id, 'S', dx(x), dy(y), dx(w), dy(h), V | (right ? 2 : 0), t, 0],
        btn: (id, x, y, w, h, t, def) => [id, 'B', dx(x), dy(y), dx(w), dy(h), V | TAB | (def ? 1 : 0), t, 0],
        chk: (id, x, y, w, t) => [id, 'B', dx(x), dy(y), dx(w), dy(15), V | TAB | 3, t, 0],
        rad: (id, x, y, w, t, first) => [id, 'B', dx(x), dy(y), dx(w), dy(15), V | TAB | 9 | (first ? GRP : 0), t, 0],
        grp: (id, x, y, w, h, t) => [id, 'B', dx(x), dy(y), dx(w), dy(h), V | 7, t, 0],
        edit: (id, x, y, w, h, t, ro) => [id, 'E', dx(x), dy(y), dx(w), dy(h), V | TAB | 0x80 | (ro ? 0x800 : 0), t || '', 0x200],
        memo: (id, x, y, w, h, t) => [id, 'E', dx(x), dy(y), dx(w), dy(h), V | TAB | 4 | 0x800 | 0x200000, t || '', 0x200],
        combo: (id, x, y, w, t) => [id, 'C', dx(x), dy(y), dx(w), dy(120), V | TAB | 3 | 0x200000, t || '', 0],
        custom: (id, x, y, w, h, cls) => [id, cls || 'ReaderCustom', dx(x), dy(y), dx(w), dy(h), V, '', 0]
    };
    const tplOf = (title, w, h, controls) => ({ t: title, w: dx(w), h: dy(h), f: ['Segoe UI', 9], s: 0x80C80000, c: controls });

    // ---- the window ----------------------------------------------------------------------------

    let appRef = null;
    const windows = new Set();
    let windowSeq = 0;
    let activeWin = null;

    class ReaderWindow {
        constructor(app, source) {
            this.app = app;
            this.n = (windowSeq += 1);
            this.pdf = null;
            this.name = '';
            this.pages = []; // { n, w, h (points, unrotated), el, canvas, text, links, rendered, task }
            this.zoom = 1;
            this.fit = 'width';
            this.rotation = 0;
            this.layout = 'continuous';
            this.tool = 'select';
            this.current = 1;
            this.history = [];
            this.future = [];
            this.find = { q: '', hits: null, at: -1, whole: false, matchCase: false };
            this.panel = null;
            this.bottomPanel = null;
            this.toolbars = Object.assign({ file: true, nav: true, zoom: true, display: true, find: true }, JSON.parse(reg('Toolbars', '{}') || '{}'));
            this.build();
            if (source) void this.open(source);
        }

        // ---- building -----------------------------------------------------------------------------

        build() {
            const W = Math.min(root.innerWidth - 40, 1100);
            const H = Math.min(root.innerHeight - 70, 900);
            const m = doc.createElement('div');
            m.className = 'modal hidden resizeable-window rdr-window';
            m.dataset.windowIdentifier = 'adobeReader';
            m.dataset.windowClient = 'light';
            m.dataset.taskbarIcon = ICON24;
            m.dataset.windowDefaultWidth = String(W);
            m.dataset.windowDefaultHeight = String(H);
            m.dataset.windowMinWidth = '420';
            m.dataset.windowMinHeight = '300';
            m.style.width = `${W}px`;
            m.style.height = `${H}px`;
            m.setAttribute('role', 'dialog');
            const grip = '<span class="rdr-grip" aria-hidden="true"></span>';
            const btn = (a, img, title, extra) => `<button type="button" class="rdr-tb rdr-tb-${a}" data-a="${a}" title="${esc(title)}"${extra || ''}><img src="${A}/${img}.png" alt="" draggable="false"></button>`;
            m.innerHTML = `
                <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span class="rdr-title">Adobe Reader</span></div></div>
                <div class="modal-focus-overlay"></div>
                <div class="modal-window-controls">
                    <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                    <button type="button" class="btn-danger close-btn btn-small rdr-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
                </div>
                <div class="modal-content win7 rdr-client">
                    <div class="rdr-menubar" role="menubar">${[['File', 32], ['Edit', 34], ['View', 39], ['Document', 70], ['Tools', 43], ['Window', 58], ['Help', 39]].map(([t, w]) => `<button type="button" class="rdr-menu-title" data-menu="${t.toLowerCase()}" role="menuitem" style="width:${w}px">${t}</button>`).join('')}<button type="button" class="rdr-doc-close" data-a="close" title="Close" hidden></button></div>
                    <div class="rdr-toolbar" role="toolbar">
                        <div class="rdr-group" data-bar="file">${grip}${btn('print', 'tb-print', 'Print')}<span class="rdr-sep"></span><button type="button" class="rdr-tb rdr-tb-meeting" data-a="meeting" title="Click to start an Acrobat Connect meeting and share documents"><img src="${A}/tb-meeting.png" alt="" draggable="false"><span class="rdr-tb-arrow" data-menu-arrow></span></button></div>
                        <div class="rdr-group" data-bar="nav">${grip}${btn('prev', 'tb-prev', 'Previous Page')}${btn('next', 'tb-next', 'Next Page')}<input type="text" class="rdr-pagebox" value="0" spellcheck="false" autocomplete="off" title="Page Number"><span class="rdr-pagecount">/ 0</span></div>
                        <div class="rdr-group" data-bar="zoom">${grip}${btn('zoomout', 'tb-zoomout', 'Zoom Out')}${btn('zoomin', 'tb-zoomin', 'Zoom In')}<span class="rdr-combo rdr-zoombox"><input type="text" value="100%" spellcheck="false" autocomplete="off" title="Zoom"><button type="button" class="rdr-combo-drop" data-a="zoommenu" tabindex="-1"></button></span></div>
                        <div class="rdr-group" data-bar="display">${grip}${btn('fitwidth', 'tb-fitwidth', 'Scrolling Mode')}${btn('fitpage', 'tb-fitpage', 'One Full Page')}</div>
                        <div class="rdr-group" data-bar="find">${grip}<span class="rdr-combo rdr-findbox"><input type="text" placeholder="Find" spellcheck="false" autocomplete="off"><button type="button" class="rdr-combo-drop" data-a="findmenu" tabindex="-1"></button></span>${btn('findprev', 'tb-findprev', 'Find Previous', ' hidden')}${btn('findnext', 'tb-findnext', 'Find Next', ' hidden')}</div>
                    </div>
                    <div class="rdr-body">
                        <div class="rdr-navbar">
                            <div class="rdr-navtabs">
                                <button type="button" class="rdr-navtab" data-panel="pages" title="Pages: Go to specific pages using thumbnail images"><img src="${A}/nav-pages.png" alt="" draggable="false"></button>
                                <button type="button" class="rdr-navtab" data-panel="bookmarks" title="Bookmarks: Go to specific pages using bookmarks"><img src="${A}/nav-bookmarks.png" alt="" draggable="false"></button>
                                <button type="button" class="rdr-navtab" data-panel="howto" title="How To"><img src="${A}/nav-howto.png" alt="" draggable="false"></button>
                            </div>
                            <div class="rdr-navtabs rdr-navtabs-bottom">
                                <button type="button" class="rdr-navtab" data-panel="attachments" title="Attachments: View file attachments"><img src="${A}/nav-attachments.png" alt="" draggable="false"></button>
                                <button type="button" class="rdr-navtab" data-panel="comments" title="Comments: View comments"><img src="${A}/nav-comments.png" alt="" draggable="false"></button>
                            </div>
                        </div>
                        <div class="rdr-panel" hidden>
                            <div class="rdr-panel-head"><span class="rdr-panel-title"></span><button type="button" class="rdr-panel-x" title="Close"></button></div>
                            <div class="rdr-panel-tools"></div>
                            <div class="rdr-panel-body"></div>
                        </div>
                        <div class="rdr-split" hidden></div>
                        <div class="rdr-main">
                            <div class="rdr-view" tabindex="0"><div class="rdr-pages"></div></div>
                            <div class="rdr-bottom" hidden>
                                <div class="rdr-bottom-tools"></div>
                                <div class="rdr-bottom-body"></div>
                            </div>
                        </div>
                    </div>
                </div>`;
            doc.body.appendChild(m);
            this.modal = m;
            const q = (s) => m.querySelector(s);
            this.el = {
                title: q('.rdr-title'), view: q('.rdr-view'), pagesEl: q('.rdr-pages'), pagebox: q('.rdr-pagebox'), pagecount: q('.rdr-pagecount'),
                zoombox: q('.rdr-zoombox input'), findbox: q('.rdr-findbox input'), panel: q('.rdr-panel'), panelTitle: q('.rdr-panel-title'),
                panelTools: q('.rdr-panel-tools'), panelBody: q('.rdr-panel-body'), split: q('.rdr-split'), bottom: q('.rdr-bottom'),
                bottomTools: q('.rdr-bottom-tools'), bottomBody: q('.rdr-bottom-body'), toolbar: q('.rdr-toolbar'), menubar: q('.rdr-menubar'),
                docClose: q('.rdr-doc-close')
            };
            this.wire();
            m.id = `adobeReaderModal_${this.n}`;
            call('openModal', m);
            m.classList.remove('hidden');
            let placed = false;
            const place = () => {
                if (placed) return;
                placed = true;
                const r = m.getBoundingClientRect();
                const k = (this.n - 1) * 24;
                call('setModalOffsetsFromViewportTopLeft', m, Math.max(0, Math.round((root.innerWidth - r.width) / 2) + k), Math.max(0, Math.round((root.innerHeight - 35 - r.height) / 2) + k));
            };
            requestAnimationFrame(place);
            setTimeout(place, 60);
            if (root.programFaults && root.programFaults.registerProgram) {
                root.programFaults.registerProgram(m.id, { name: 'Adobe Reader', terminate: () => this.app.exit(), relaunch: () => root.melatonApps && root.melatonApps.launch({ packageId: 'reader' }) });
            }
            this.applyToolbars();
            this.syncTitle();
            this.syncToolbar();
            activeWin = this;
        }

        wire() {
            const m = this.modal;
            const sig = this.app.signal;
            m.querySelector('.rdr-close').addEventListener('click', () => this.closeWindow());
            m.addEventListener('pointerdown', () => { activeWin = this; }, true);
            m.querySelectorAll('[data-menu]').forEach((t) => {
                root.contextMenu.attachClickMenuToElement(t, {
                    skin: 'reader',
                    onAction: (a, item) => void this.action(a, item),
                    sections: [{ type: 'list', initfn: (s) => { s.items = this.menu(t.dataset.menu); } }]
                });
            });
            m.querySelectorAll('.rdr-toolbar [data-a]').forEach((b) => {
                if (b.dataset.a === 'zoommenu' || b.dataset.a === 'findmenu') return;
                b.addEventListener('mousedown', (ev) => ev.preventDefault());
                b.addEventListener('click', (ev) => { if (!ev.target.closest('[data-menu-arrow]')) void this.action(b.dataset.a); });
            });
            this.el.docClose.addEventListener('click', () => void this.action('close'));
            // Start Meeting's arrow: its own menu (Start Meeting..., Meeting Preferences...)
            const meeting = m.querySelector('.rdr-tb-meeting');
            meeting.addEventListener('contextmenu', (ev) => ev.preventDefault());
            root.contextMenu.attachClickMenuToElement(meeting.querySelector('.rdr-tb-arrow'), {
                skin: 'reader',
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = withKeys([{ text: 'Start &Meeting...', action: 'meeting', image: `${A}/meeting-sm.png` }, { text: 'Meeting &Preferences...', action: 'meetingprefs' }]); } }]
            });
            root.contextMenu.attachClickMenuToElement(m.querySelector('[data-a="zoommenu"]'), {
                skin: 'reader',
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = this.zoomMenu(); } }]
            });
            root.contextMenu.attachClickMenuToElement(m.querySelector('[data-a="findmenu"]'), {
                skin: 'reader',
                onAction: (a) => void this.action(a),
                sections: [{ type: 'list', initfn: (s) => { s.items = this.findMenu(); } }]
            });
            const pb = this.el.pagebox;
            pb.addEventListener('focus', () => pb.select());
            pb.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); this.goToLabel(pb.value); this.el.view.focus(); }
                else if (ev.key === 'Escape') { pb.value = String(this.current); this.el.view.focus(); }
            });
            pb.addEventListener('blur', () => { pb.value = this.pdf ? String(this.current) : '0'; });
            const zb = this.el.zoombox;
            zb.addEventListener('focus', () => zb.select());
            zb.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') {
                    ev.preventDefault();
                    const v = parseFloat(zb.value);
                    if (v > 0) this.setZoom(Math.min(64, Math.max(0.0833, v / 100)));
                    else this.syncToolbar();
                    this.el.view.focus();
                } else if (ev.key === 'Escape') { this.syncToolbar(); this.el.view.focus(); }
            });
            zb.addEventListener('blur', () => this.syncToolbar());
            const fb = this.el.findbox;
            fb.addEventListener('keydown', (ev) => {
                if (ev.key === 'Enter') { ev.preventDefault(); void this.findNext(ev.shiftKey ? -1 : 1, fb.value); }
                else if (ev.key === 'Escape') this.el.view.focus();
            });
            m.querySelectorAll('.rdr-navtab').forEach((b) => b.addEventListener('click', () => this.togglePanel(b.dataset.panel)));
            m.querySelector('.rdr-panel-x').addEventListener('click', () => this.showPanel(null));
            // the splitter between the panel and the document
            this.el.split.addEventListener('pointerdown', (ev) => {
                ev.preventDefault();
                const start = ev.clientX;
                const w0 = this.el.panel.offsetWidth;
                const move = (e) => { this.el.panel.style.width = `${Math.max(120, Math.min(600, w0 + e.clientX - start))}px`; this.relayout(); };
                const up = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); setReg({ PanelWidth: this.el.panel.offsetWidth }); };
                doc.addEventListener('pointermove', move, { signal: sig });
                doc.addEventListener('pointerup', up, { signal: sig });
            });
            const view = this.el.view;
            view.addEventListener('scroll', () => this.schedule(), { passive: true });
            this.resizeObs = new ResizeObserver(() => { if (this.pdf) this.relayout(true); });
            this.resizeObs.observe(view);
            view.addEventListener('pointerdown', (ev) => this.toolDown(ev));
            view.addEventListener('wheel', (ev) => {
                if (!ev.ctrlKey || !this.pdf) return;
                ev.preventDefault();
                this.step(ev.deltaY < 0 ? 1 : -1);
            }, { passive: false });
            view.addEventListener('click', (ev) => {
                const a = ev.target.closest('.rdr-link');
                if (!a) return;
                ev.preventDefault();
                void this.followLink(a._link);
            });
            m.addEventListener('keydown', (ev) => this.keydown(ev));
        }

        // ---- menus --------------------------------------------------------------------------------

        /** A menu's rows with their access keys ("&Open..." -> Open... with the O underlined, as Reader draws them). */
        menu(name) { return withKeys(this.menuItems(name)); }

        menuItems(name) {
            const has = !!this.pdf;
            const img = (n) => `${A}/${n}.png`;
            const sel = (() => { const s = root.getSelection(); return !!(s && !s.isCollapsed && this.el.pagesEl.contains(s.anchorNode)); })();
            const chk = (text, a, on, extra) => Object.assign({ text, action: a, showIndicator: true, checked: !!on }, extra || {});
            switch (name) {
                case 'file': {
                    const recent = this.recent();
                    return [
                        { text: '&Open...', subtext: 'Ctrl+O', action: 'open', image: img('open-sm') },
                        { separator: true },
                        { text: 'Create Adobe PD&F Online...', action: 'createpdf' },
                        { separator: true },
                        { text: 'Start &Meeting...', action: 'meeting', image: img('meeting-sm') },
                        { separator: true },
                        { text: 'Save &a Copy...', subtext: 'Shift+Ctrl+S', action: 'savecopy', disabled: !has },
                        { text: 'Sa&ve as Text...', action: 'savetext', disabled: !has },
                        { separator: true },
                        { text: 'Attach to Emai&l...', action: 'email', disabled: !has },
                        { text: '&Close', subtext: 'Ctrl+W', action: 'close', disabled: !has },
                        { separator: true },
                        { text: '&Properties...', subtext: 'Ctrl+D', action: 'props', disabled: !has },
                        { separator: true },
                        { text: 'Digital Edition&s', action: 'digitaleditions' },
                        { separator: true },
                        { text: 'Print Set&up...', subtext: 'Shift+Ctrl+P', action: 'printsetup', disabled: !has },
                        { text: '&Print...', subtext: 'Ctrl+P', action: 'print', disabled: !has, image: img('print-sm') },
                        ...(recent.length ? [{ separator: true }].concat(recent.map((r, i) => ({ text: `&${i + 1} ${recentLabel(r).replace(/&/g, '&&')}`, action: `recent:${i}` }))) : []),
                        { separator: true },
                        { text: 'E&xit', subtext: 'Ctrl+Q', action: 'exit' }
                    ];
                }
                case 'edit': return [
                    { text: '&Undo', subtext: 'Ctrl+Z', disabled: true, image: img('undo-sm') },
                    { text: '&Redo', subtext: 'Shift+Ctrl+Z', disabled: true, image: img('redo-sm') },
                    { separator: true },
                    { text: 'Cu&t', subtext: 'Ctrl+X', disabled: true },
                    { text: '&Copy', subtext: 'Ctrl+C', action: 'copy', disabled: !sel, image: img('copy-sm') },
                    { text: '&Paste', subtext: 'Ctrl+V', disabled: true, image: img('paste-sm') },
                    { text: '&Delete', disabled: true },
                    { separator: true },
                    { text: 'Copy File to Clip&board', action: 'copyfile', disabled: !has },
                    { separator: true },
                    { text: 'Se&lect All', subtext: 'Ctrl+A', action: 'selectall', disabled: !has },
                    { text: 'D&eselect All', subtext: 'Shift+Ctrl+A', action: 'deselect', disabled: !has },
                    { separator: true },
                    { text: 'Chec&k Spelling', disabled: true, submenu: [{ text: 'In Comments and Form Fields...', subtext: 'F7', disabled: true }, { text: 'Edit Dictionary...', disabled: true }] },
                    { text: 'L&ook Up Selected Word...', disabled: true },
                    { separator: true },
                    { text: '&Find', subtext: 'Ctrl+F', action: 'find', disabled: !has },
                    { text: '&Search', subtext: 'Shift+Ctrl+F', action: 'search', image: img('search-sm') },
                    { text: 'Se&arch Results', submenu: [{ text: 'Next Result', subtext: 'Ctrl+]', action: 'searchnext', disabled: !(this.find.hits && this.find.hits.length) }, { text: 'Previous Result', subtext: 'Ctrl+[', action: 'searchprev', disabled: !(this.find.hits && this.find.hits.length) }] },
                    { separator: true },
                    { text: 'Prefere&nces...', subtext: 'Ctrl+K', action: 'prefs' }
                ];
                case 'view': return [
                    { text: '&Go To', disabled: !has, submenu: [
                        { text: 'First Page', subtext: 'Home', action: 'first', disabled: this.current <= 1, image: img('go-first') },
                        { text: 'Previous Page', subtext: 'Left Arrow', action: 'prev', disabled: this.current <= 1, image: img('go-prev') },
                        { text: 'Next Page', subtext: 'Right Arrow', action: 'next', disabled: !has || this.current >= this.pages.length, image: img('go-next') },
                        { text: 'Last Page', subtext: 'End', action: 'last', disabled: !has || this.current >= this.pages.length, image: img('go-last') },
                        { text: 'Page...', subtext: 'Shift+Ctrl+N', action: 'gotopage' },
                        { separator: true },
                        { text: 'Previous View', subtext: 'Alt+Left Arrow', action: 'prevview', disabled: !this.history.length, image: img('go-prevview') },
                        { text: 'Next View', subtext: 'Alt+Right Arrow', action: 'nextview', disabled: !this.future.length, image: img('go-nextview') },
                        { separator: true },
                        { text: 'Previous Document', subtext: 'Alt+Shift+Left Arrow', disabled: true },
                        { text: 'Next Document', subtext: 'Alt+Shift+Right Arrow', disabled: true }
                    ] },
                    { separator: true },
                    { text: '&Zoom', disabled: !has, submenu: [
                        { text: '&Zoom To...', subtext: 'Ctrl+Y', action: 'zoomto' },
                        chk('&Actual Size', 'z:actual', !this.fit && this.zoom === 1, { subtext: 'Ctrl+1', image: img('z-actual') }),
                        chk('Fit &Page', 'z:page', this.fit === 'page', { subtext: 'Ctrl+0', image: img('z-fitpage') }),
                        chk('Fit &Width', 'z:width', this.fit === 'width', { subtext: 'Ctrl+2', image: img('z-fitwidth') }),
                        chk('Fit &Height', 'z:height', this.fit === 'height'),
                        chk('Fit Visi&ble', 'z:visible', this.fit === 'visible', { subtext: 'Ctrl+3' }),
                        { separator: true },
                        { text: '&Reflow', subtext: 'Ctrl+4', disabled: true }
                    ] },
                    { text: '&Page Display', disabled: !has, submenu: [
                        chk('&Single Page', 'l:single', this.layout === 'single'),
                        chk('Single Page &Continuous', 'l:continuous', this.layout === 'continuous'),
                        chk('Two-&Up', 'l:twoup', this.layout === 'twoup'),
                        chk('&Two-Up Continuous', 'l:twoupcont', this.layout === 'twoupcont'),
                        { separator: true },
                        chk('Show &Gaps Between Pages', 'gaps', reg('ShowGaps', true) !== false),
                        chk('Show Co&ver Page During Two-Up', 'cover', !!reg('CoverPage', false))
                    ] },
                    { text: 'Rotate &View', disabled: !has, submenu: [
                        { text: 'Clockwise', subtext: 'Shift+Ctrl+Plus', action: 'rotcw', image: img('rot-cw') },
                        { text: 'Counterclockwise', subtext: 'Shift+Ctrl+Minus', action: 'rotccw', image: img('rot-ccw') }
                    ] },
                    { separator: true },
                    { text: '&Reading Mode', subtext: 'Ctrl+H', action: 'readmode', disabled: !has, showIndicator: true, checked: !!this.reading },
                    { text: '&Full Screen Mode', subtext: 'Ctrl+L', action: 'fullscreen', disabled: !has },
                    { separator: true },
                    { text: '&Menu Bar', subtext: 'F9', action: 'menubar' },
                    { text: '&Toolbars', image: img('view-toolbars'), submenu: [
                        { text: 'Beyond Adobe Reader', disabled: true },
                        { text: 'Edit', disabled: true },
                        chk('File', 'tb:file', this.toolbars.file),
                        chk('&Find', 'tb:find', this.toolbars.find),
                        { text: 'Object Data', disabled: true },
                        chk('&Page Display', 'tb:display', this.toolbars.display),
                        chk('Page Navigation', 'tb:nav', this.toolbars.nav),
                        chk('Select && &Zoom', 'tb:zoom', this.toolbars.zoom),
                        { separator: true },
                        { text: 'Properties Bar', subtext: 'Ctrl+E', disabled: true },
                        { separator: true },
                        { text: 'Hide Toolbars', subtext: 'F8', action: 'hidetoolbars' },
                        { text: 'Reset Toolbars', subtext: 'Alt+F8', action: 'resettoolbars' }
                    ] },
                    { text: '&Navigation Panels', image: img('view-navpanels'), submenu: [
                        { text: 'Articles', disabled: true, image: img('np-articles') },
                        chk('Attachments', 'p:attachments', this.bottomPanel === 'attachments', { image: img('np-attachments') }),
                        chk('Bookmarks', 'p:bookmarks', this.panel === 'bookmarks', { image: img('np-bookmarks') }),
                        chk('Comments', 'p:comments', this.bottomPanel === 'comments', { image: img('np-comments') }),
                        chk('Ho&w To', 'p:howto', this.panel === 'howto', { image: img('np-howto') }),
                        { text: 'Layers', disabled: true, image: img('np-layers') },
                        { text: 'Model Tree', disabled: true, image: img('np-modeltree') },
                        chk('Pages', 'p:pages', this.panel === 'pages', { image: img('np-pages') }),
                        { separator: true },
                        { text: this.panel ? 'Hide Navigation Pane' : 'Show Navigation Pane', subtext: 'F4', action: 'navpane' }
                    ] },
                    { separator: true },
                    { text: '&Line Weights', subtext: 'Ctrl+5', disabled: true },
                    { separator: true },
                    { text: 'Review Trac&ker...', disabled: true },
                    { separator: true },
                    { text: 'Automaticall&y Scroll', subtext: 'Shift+Ctrl+H', action: 'autoscroll', disabled: !has, showIndicator: true, checked: !!this.autoTimer },
                    { text: 'Re&ad Out Loud', disabled: true, submenu: [{ text: 'Activate Read Out Loud', subtext: 'Shift+Ctrl+Y', disabled: true }] }
                ];
                case 'document': return [
                    { text: '&Sign', disabled: true, image: img('sign-sm'), submenu: [{ text: 'Place Signature...', disabled: true }] },
                    { text: 'Se&curity', disabled: true, image: img('security-sm'), submenu: [{ text: 'Show Security Properties', disabled: true }] },
                    { text: 'S&ecurity Settings...', disabled: true },
                    { text: 'Manage Trusted &Identities...', disabled: true },
                    { separator: true },
                    { text: 'Change Accessibility &Reading Options...', subtext: 'Shift+Ctrl+5', disabled: true },
                    { text: 'Accessibility &Quick Check', subtext: 'Shift+Ctrl+6', disabled: true },
                    { separator: true },
                    { text: 'Accessibility Se&tup Assistant...', disabled: true }
                ];
                case 'tools': return [
                    { text: 'Select && &Zoom', submenu: [
                        chk('Select Tool', 't:select', this.tool === 'select', { image: img('tool-select') }),
                        chk('Hand Tool', 't:hand', this.tool === 'hand', { image: img('tool-hand') }),
                        chk('Marquee Zoom', 't:marquee', this.tool === 'marquee', { image: img('tool-marquee') }),
                        chk('Dynamic Zoom', 't:dynamic', this.tool === 'dynamic', { image: img('tool-dynzoom') }),
                        { separator: true },
                        { text: 'Pan & Zoom Window', disabled: true, image: img('tool-panzoom') },
                        { text: 'Loupe Tool', disabled: true, image: img('tool-loupe') },
                        { text: 'Snapshot Tool', disabled: true, image: img('tool-snapshot') }
                    ] },
                    { separator: true },
                    { text: 'Object Data', disabled: true, submenu: [{ text: 'Object Data Tool', disabled: true }] },
                    { separator: true },
                    { text: 'C&ustomize Toolbars...', disabled: true }
                ];
                case 'window': {
                    const list = Array.from(windows);
                    return [
                        { text: '&New Window', action: 'newwindow' },
                        { separator: true },
                        { text: '&Cascade', subtext: 'Shift+Ctrl+J', action: 'cascade' },
                        { text: '&Tile', submenu: [{ text: 'Horizontally', subtext: 'Shift+Ctrl+K', action: 'tileh' }, { text: 'Vertically', subtext: 'Shift+Ctrl+L', action: 'tilev' }] },
                        { text: '&Minimize All Windows', action: 'minall' },
                        { text: 'Close &All', subtext: 'Shift+Ctrl+W', action: 'closeall' },
                        { separator: true },
                        { text: '&Full Screen Mode', subtext: 'Ctrl+L', action: 'fullscreen', disabled: !has },
                        ...(list.some((w) => w.pdf) ? [{ separator: true }] : []),
                        ...list.filter((w) => w.pdf).map((w, i) => ({ text: `&${i + 1} ${String(w.name).replace(/&/g, '&&')}`, action: `win:${w.n}`, showIndicator: true, checked: w === this }))
                    ];
                }
                case 'help': return [
                    { text: 'Adobe Reader 8 &Help...', subtext: 'F1', action: 'help', image: img('help-complete') },
                    { separator: true },
                    { text: '&Beyond Adobe Reader...', action: 'web:beyond' },
                    { text: 'Ho&w To', image: img('help-sm'), submenu: [{ text: 'Adobe Reader Essentials', action: 'p:howto' }] },
                    { separator: true },
                    { text: '&Online Support...', submenu: [{ text: '&Knowledge Base', action: 'web:support' }] },
                    { separator: true },
                    { text: '&About Adobe Reader 8...', action: 'about' },
                    { text: 'About Adobe &Plug-Ins...', disabled: true },
                    { separator: true },
                    { text: 'Re&pair Adobe Reader Installation', disabled: true },
                    { text: 'Pu&rchase Adobe Acrobat', action: 'web:acrobat' },
                    { text: 'Adobe Online Services...', action: 'web:services', image: img('online-services-sm') },
                    { separator: true },
                    { text: 'Check for &Updates...', disabled: true }
                ];
                default: return [];
            }
        }

        zoomMenu() {
            const items = ZOOMS.slice().reverse().map((z) => ({ text: fmtZoom(z), action: `zv:${z}` }));
            return items.concat([{ separator: true },
                { text: 'Actual Size', action: 'z:actual' }, { text: 'Fit Page', action: 'z:page' }, { text: 'Fit Width', action: 'z:width' }, { text: 'Fit Visible', action: 'z:visible' }]);
        }

        findMenu() {
            return [
                { text: 'Whole words only', action: 'f:whole', showIndicator: true, checked: this.find.whole },
                { text: 'Case-Sensitive', action: 'f:case', showIndicator: true, checked: this.find.matchCase },
                { text: 'Include Bookmarks', action: 'f:bookmarks', showIndicator: true, checked: !!this.find.bookmarks },
                { text: 'Include Comments', action: 'f:comments', showIndicator: true, checked: !!this.find.comments },
                { separator: true },
                { text: 'Open Full Reader Search...', subtext: 'Shift+Ctrl+F', action: 'search' }
            ];
        }

        async action(a, item) {
            if (!a) return;
            if (a.startsWith('z:')) { this.setFit(a.slice(2)); return; }
            if (a.startsWith('zv:')) { this.setZoom(Number(a.slice(3))); return; }
            if (a.startsWith('l:')) { this.setLayout(a.slice(2)); return; }
            if (a.startsWith('t:')) { this.setTool(a.slice(2)); return; }
            if (a.startsWith('tb:')) { const k = a.slice(3); this.toolbars[k] = !this.toolbars[k]; setReg({ Toolbars: JSON.stringify(this.toolbars) }); this.applyToolbars(); return; }
            if (a.startsWith('p:')) { this.togglePanel(a.slice(2), true); return; }
            if (a.startsWith('f:')) { const k = { whole: 'whole', case: 'matchCase', bookmarks: 'bookmarks', comments: 'comments' }[a.slice(2)]; this.find[k] = !this.find[k]; this.find.hits = null; return; }
            if (a.startsWith('recent:')) { const r = this.recent()[Number(a.slice(7))]; if (r) await this.openInWindow({ file: r.file }); return; }
            if (a.startsWith('web:')) { openWeb(WEB[a.slice(4)]); return; }
            if (a.startsWith('win:')) { const w = Array.from(windows).find((x) => String(x.n) === a.slice(4)); if (w) w.front(); return; }
            switch (a) {
                case 'open': this.openDialog(); return;
                case 'savecopy': this.saveCopy(); return;
                case 'savetext': this.saveText(); return;
                case 'email': await this.email(); return;
                case 'meeting': openMeeting(this); return;
                case 'meetingprefs': openPreferences(this); return;
                // Reader's own web pages open in the browser with no prompt (the prompt is a document's)
                case 'createpdf': openWeb('https://createpdf.acrobat.com/'); return;
                case 'digitaleditions': openWeb('https://www.adobe.com/solutions/ebook/digital-editions.html'); return;
                case 'close': this.closeDocument(); return;
                case 'props': this.properties(); return;
                case 'printsetup': this.printSetup(); return;
                case 'print': this.printDialog(); return;
                case 'exit': Array.from(windows).forEach((w) => w.closeWindow()); return;
                case 'copy': try { doc.execCommand('copy'); } catch (_) { /* nothing selected */ } return;
                case 'copyfile': await this.copyFile(); return;
                case 'selectall': this.selectAll(); return;
                case 'deselect': { const s = root.getSelection(); if (s) s.removeAllRanges(); return; }
                case 'find': this.el.findbox.focus(); this.el.findbox.select(); return;
                case 'search': openSearch(this); return;
                case 'searchnext': void this.findNext(1); return;
                case 'searchprev': void this.findNext(-1); return;
                case 'prefs': openPreferences(this); return;
                case 'first': this.goTo(1); return;
                case 'prev': this.goTo(this.current - (this.layout.startsWith('twoup') ? 2 : 1)); return;
                case 'next': this.goTo(this.current + (this.layout.startsWith('twoup') ? 2 : 1)); return;
                case 'last': this.goTo(this.pages.length); return;
                case 'gotopage': this.goToDialog(); return;
                case 'prevview': this.back(); return;
                case 'nextview': this.forward(); return;
                case 'zoomto': this.zoomToDialog(); return;
                case 'zoomin': this.step(1); return;
                case 'zoomout': this.step(-1); return;
                case 'fitwidth': this.setFit(this.fit === 'width' ? null : 'width'); return;
                case 'fitpage': this.setFit(this.fit === 'page' ? null : 'page'); return;
                case 'findnext': void this.findNext(1); return;
                case 'findprev': void this.findNext(-1); return;
                case 'gaps': setReg({ ShowGaps: reg('ShowGaps', true) === false }); this.relayout(); return;
                case 'cover': setReg({ CoverPage: !reg('CoverPage', false) }); this.relayout(); return;
                case 'rotcw': this.rotate(90); return;
                case 'rotccw': this.rotate(-90); return;
                case 'readmode': this.readingMode(); return;
                case 'fullscreen': this.fullScreen(); return;
                case 'menubar': this.modal.classList.toggle('rdr-no-menubar'); this.relayout(); return;
                case 'hidetoolbars': this.modal.classList.toggle('rdr-no-toolbars'); this.relayout(); return;
                case 'resettoolbars': this.toolbars = { file: true, nav: true, zoom: true, display: true, find: true }; setReg({ Toolbars: '{}' }); this.modal.classList.remove('rdr-no-toolbars'); this.applyToolbars(); return;
                case 'navpane': this.showPanel(this.panel ? null : (this.lastPanel || 'bookmarks')); return;
                case 'autoscroll': this.autoScroll(); return;
                case 'newwindow': if (this.source) void newWindow(this.source); else void newWindow(null); return;
                case 'cascade': arrange('cascade'); return;
                case 'tileh': arrange('h'); return;
                case 'tilev': arrange('v'); return;
                case 'minall': windows.forEach((w) => { const b = w.modal.querySelector('.minimize-btn'); if (b) b.click(); }); return;
                case 'closeall': Array.from(windows).forEach((w) => w.closeDocument()); return;
                case 'help': this.togglePanel('howto', true); return;
                case 'about': openAbout(this); return;
                default:
            }
            void item;
        }

        keydown(ev) {
            const t = ev.target;
            const inField = t && (t.tagName === 'INPUT' || t.tagName === 'TEXTAREA');
            const ctrl = ev.ctrlKey || ev.metaKey;
            const k = ev.key;
            let a = null;
            if (ctrl && ev.shiftKey) a = { S: 'savecopy', P: 'printsetup', F: 'search', N: 'gotopage', A: 'deselect', W: 'closeall', H: 'autoscroll', '+': 'rotcw', '=': 'rotcw', _: 'rotccw', '-': 'rotccw' }[k.length === 1 ? k.toUpperCase() : k] || null;
            else if (ctrl && !ev.altKey) a = { o: 'open', w: 'close', d: 'props', p: 'print', q: 'exit', f: 'find', k: 'prefs', a: inField ? null : 'selectall', y: 'zoomto', 1: 'z:actual', 0: 'z:page', 2: 'z:width', 3: 'z:visible', h: 'readmode', l: 'fullscreen', '=': 'zoomin', '+': 'zoomin', '-': 'zoomout', ']': 'searchnext', '[': 'searchprev' }[k.toLowerCase()] || null;
            else if (ev.altKey && !ctrl && k === 'ArrowLeft') a = 'prevview';
            else if (ev.altKey && !ctrl && k === 'ArrowRight') a = 'nextview';
            else if (k === 'F4') a = 'navpane';
            else if (k === 'F9') a = 'menubar';
            else if (k === 'F8') a = 'hidetoolbars';
            else if (k === 'F1') a = 'help';
            else if (k === 'Escape' && this.modal.classList.contains('rdr-reading')) a = 'readmode';
            else if (!inField && this.pdf) {
                const v = this.el.view;
                if (k === 'Home') a = 'first';
                else if (k === 'End') a = 'last';
                else if (k === 'ArrowRight') a = 'next';
                else if (k === 'ArrowLeft') a = 'prev';
                else if (k === 'PageDown' || (k === ' ' && !ev.shiftKey)) {
                    if (this.layout === 'single' || this.layout === 'twoup') a = 'next';
                    else { ev.preventDefault(); v.scrollBy(0, v.clientHeight - 20); return; }
                } else if (k === 'PageUp' || (k === ' ' && ev.shiftKey)) {
                    if (this.layout === 'single' || this.layout === 'twoup') a = 'prev';
                    else { ev.preventDefault(); v.scrollBy(0, -(v.clientHeight - 20)); return; }
                }
            }
            if (!a) return;
            ev.preventDefault();
            ev.stopPropagation();
            void this.action(a);
        }

        // ---- documents ----------------------------------------------------------------------------

        /** A file to open: in this window when it has none, else in a window of its own (Reader 8's default). */
        async openInWindow(source) {
            if (!this.pdf) return this.open(source);
            return newWindow(source);
        }

        async open(source) {
            this.source = source;
            const name = (source.file && source.file.name) || source.name || 'document.pdf';
            this.setBusy(true);
            let lib;
            try {
                lib = await loadPdfJs();
                let params;
                if (source.file) {
                    const r = await vfs().downloadFile(source.file.id);
                    params = { url: r.downloadUrl, withCredentials: true };
                } else if (source.url) {
                    params = { url: source.url, withCredentials: true };
                } else {
                    params = { data: source.data instanceof Uint8Array ? source.data.slice() : b64ToBytes(source.data) };
                }
                const task = lib.getDocument(Object.assign(params, { cMapUrl: `${PDFJS}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS}/standard_fonts/` }));
                task.onPassword = (update, reason) => {
                    void this.askPassword(name, reason === 2).then((pw) => { if (pw === null) { task.destroy(); } else update(pw); });
                };
                this.loadingTask = task;
                this.pdf = await task.promise;
            } catch (err) {
                this.setBusy(false);
                this.pdf = null;
                if (err && err.name === 'PasswordException') return;
                await this.message(`There was an error opening this document. ${err && err.name === 'InvalidPDFException' ? 'The file is damaged and could not be repaired.' : 'The file cannot be found.'}`);
                return;
            }
            this.name = name;
            this.lib = lib;
            this.file = source.file || null;
            this.location = source.file ? (source.file.path || '\\') : (source.location || source.from || '');
            const meta = await this.pdf.getMetadata().catch(() => null);
            this.meta = meta || { info: {} };
            this.size = (meta && meta.contentLength) || source.size || 0;
            // every page's size before any is drawn (most documents keep one size; each is read in turn)
            const n = this.pdf.numPages;
            const first = await this.pdf.getPage(1);
            const vp = first.getViewport({ scale: 1 });
            this.pages = [];
            for (let i = 1; i <= n; i += 1) this.pages.push({ n: i, w: vp.width, h: vp.height, proxy: i === 1 ? first : null, rot: first.rotate });
            void this.readSizes();
            const view = await this.initialView();
            this.layout = view.layout;
            this.fit = view.fit;
            this.zoom = view.zoom;
            this.buildPages();
            this.setBusy(false);
            this.syncTitle();
            this.relayout();
            this.goTo(1, true);
            this.noteRecent();
            const mode = await this.pdf.getPageMode().catch(() => null);
            const outline = await this.pdf.getOutline().catch(() => null);
            this.outline = outline;
            if (mode === 'UseThumbs') this.showPanel('pages');
            else if (mode === 'UseOutlines' || (outline && outline.length)) this.showPanel('bookmarks');
            else if (mode === 'UseAttachments') this.togglePanel('attachments', true);
            else if (this.panel) this.showPanel(this.panel);
            this.el.view.focus();
        }

        async initialView() {
            const pref = reg('PageLayout', 'auto');
            const zpref = reg('DefaultZoom', 'auto');
            let layout = { single: 'single', continuous: 'continuous', twoup: 'twoup', twoupcont: 'twoupcont' }[pref] || 'continuous';
            if (pref === 'auto') {
                const pl = await this.pdf.getPageLayout().catch(() => '');
                layout = { SinglePage: 'single', OneColumn: 'continuous', TwoColumnLeft: 'twoupcont', TwoColumnRight: 'twoupcont', TwoPageLeft: 'twoup', TwoPageRight: 'twoup' }[pl] || 'continuous';
            }
            let fit = 'width';
            let zoom = 1;
            if (zpref !== 'auto') {
                if (['page', 'width', 'height', 'visible'].includes(zpref)) fit = zpref;
                else { fit = null; zoom = Number(zpref) || 1; }
            } else {
                // a document's own open action ("/OpenAction [page /XYZ x y zoom]" or /Fit*) wins
                try {
                    const oa = await this.pdf.getOpenAction();
                    const d = oa && oa.dest;
                    if (Array.isArray(d) && d[1]) {
                        const kind = d[1].name;
                        if (kind === 'Fit' || kind === 'FitB') fit = 'page';
                        else if (kind === 'FitH' || kind === 'FitBH') fit = 'width';
                        else if (kind === 'XYZ' && d[4]) { fit = null; zoom = d[4]; }
                    }
                } catch (_) { /* none */ }
            }
            return { layout, fit, zoom };
        }

        async readSizes() {
            const pdf = this.pdf;
            let changed = false;
            for (let i = 2; i <= this.pages.length && this.pdf === pdf; i += 1) {
                const p = this.pages[i - 1];
                try {
                    const proxy = await pdf.getPage(i);
                    if (this.pdf !== pdf) return;
                    const vp = proxy.getViewport({ scale: 1, rotation: proxy.rotate });
                    const un = proxy.getViewport({ scale: 1, rotation: 0 });
                    p.proxy = proxy;
                    if (Math.abs(un.width - p.w) > 0.5 || Math.abs(un.height - p.h) > 0.5 || proxy.rotate !== p.rot) {
                        p.w = un.width; p.h = un.height; p.rot = proxy.rotate; changed = true;
                    }
                    void vp;
                } catch (_) { /* keep the first page's size */ }
                // one at a time, with the page free between them
                if (i % 20 === 0) { if (changed) { this.relayout(true); changed = false; } await new Promise((r) => setTimeout(r, 0)); }
            }
            if (changed && this.pdf === pdf) this.relayout(true);
        }

        buildPages() {
            const host = this.el.pagesEl;
            host.innerHTML = '';
            this.pages.forEach((p) => {
                const el = doc.createElement('div');
                el.className = 'rdr-page';
                el.dataset.page = String(p.n);
                host.appendChild(el);
                p.el = el;
                p.canvas = null;
                p.rendered = 0;
                p.textDone = false;
            });
        }

        closeDocument() {
            if (!this.pdf) return;
            // more than one Reader window: closing the document closes its window (Reader 8)
            if (windows.size > 1) { this.closeWindow(); return; }
            this.unload();
        }

        unload() {
            const pdf = this.pdf;
            this.pdf = null;
            this.pages.forEach((p) => { if (p.task) try { p.task.cancel(); } catch (_) { /* done */ } });
            this.pages = [];
            this.outline = null;
            this.find.hits = null;
            this.history = []; this.future = [];
            this.el.pagesEl.innerHTML = '';
            this.name = '';
            this.source = null;
            this.closeSearch();
            if (pdf) void pdf.destroy();
            this.showPanel(null);
            this.showBottom(null);
            this.syncTitle();
            this.syncToolbar();
        }

        closeWindow() {
            this.unload();
            if (this.resizeObs) this.resizeObs.disconnect();
            if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; }
            if (root.programFaults && root.programFaults.unregisterProgram) root.programFaults.unregisterProgram(this.modal.id);
            const m = this.modal;
            Promise.resolve(call('closeModal', m)).then(() => m.remove());
            windows.delete(this);
            if (activeWin === this) activeWin = Array.from(windows).pop() || null;
            if (!windows.size && appRef) appRef.exit();
        }

        destroy() {
            this.unload();
            if (this.resizeObs) this.resizeObs.disconnect();
            if (this.autoTimer) clearInterval(this.autoTimer);
            if (root.programFaults && root.programFaults.unregisterProgram) root.programFaults.unregisterProgram(this.modal.id);
            this.modal.remove();
        }

        front() { call('bringModalToFront', this.modal); activeWin = this; }

        syncTitle() {
            const t = this.pdf ? `${this.name} - Adobe Reader` : 'Adobe Reader';
            this.el.title.textContent = t;
            this.modal.setAttribute('aria-label', t);
            // the taskbar button reads the caption (modalUtils.js getModalTitle)
            call('updateTaskbarWindows');
            this.el.docClose.hidden = !this.pdf;
            this.modal.classList.toggle('rdr-empty', !this.pdf);
        }

        setBusy(on) { this.modal.classList.toggle('rdr-busy', !!on); }

        recent() {
            try { return JSON.parse(reg('RecentFiles', '[]')) || []; } catch (_) { return []; }
        }

        noteRecent() {
            if (!this.file) return;
            const max = Number(reg('RecentCount', 5)) || 5;
            // the computer's path as Reader lists it ("1 C:\Workspaces\Default\Report.pdf")
            const label = recentLabel({ file: this.file });
            const list = this.recent().filter((r) => r.file && r.file.id !== this.file.id);
            list.unshift({ file: this.file, label });
            setReg({ RecentFiles: JSON.stringify(list.slice(0, max)) });
        }

        // ---- layout -------------------------------------------------------------------------------

        get dpi() { return reg('ResolutionMode', 'custom') === 'custom' ? Number(reg('Resolution', 110)) || 110 : 96; }

        /** CSS px per PDF point at the current zoom. */
        get scale() { return (this.zoom * this.dpi) / 72; }

        dims(p) {
            const r = ((p.rot || 0) + this.rotation) % 180 !== 0;
            return r ? { w: p.h, h: p.w } : { w: p.w, h: p.h };
        }

        /** The zoom a fit mode means in this view (Reader 8: Fit Width fills the pane, edge to edge). */
        fitZoom(fit) {
            const v = this.el.view;
            const k = this.dpi / 72;
            const gap = this.gap();
            const cur = this.pages[Math.max(0, this.current - 1)] || this.pages[0];
            if (!cur) return 1;
            const d = this.dims(cur);
            const two = this.layout.startsWith('twoup');
            const pw = two ? d.w * 2 + gap : d.w;
            const W = v.clientWidth;
            const Hh = v.clientHeight;
            // the pane keeps its vertical bar (Reader 8's), so the width a fit takes does not move with it
            if (fit === 'width') return Math.max(0.0833, W / pw / k);
            // a whole page in the pane with one gap's room (the VM: 802 of 810 px at 66.3%)
            if (fit === 'height') return Math.max(0.0833, (Hh - gap) / d.h / k);
            if (fit === 'page') return Math.max(0.0833, Math.min((W - gap) / pw, (Hh - gap) / d.h) / k);
            if (fit === 'visible') return Math.max(0.0833, W / pw / k);
            return this.zoom;
        }

        gap() { return reg('ShowGaps', true) === false ? 0 : GAP; }

        relayout(keep) {
            if (!this.pdf || !this.pages.length) { this.syncToolbar(); return; }
            const v = this.el.view;
            // keep the reader's place: the page at the top and how far down it the pane is
            const anchor = keep !== false ? this.anchorPoint() : null;
            if (this.fit) this.zoom = this.fitZoom(this.fit);
            const s = this.scale;
            const gap = this.gap();
            const two = this.layout.startsWith('twoup');
            const single = this.layout === 'single' || this.layout === 'twoup';
            const cover = two && !!reg('CoverPage', false);
            const host = this.el.pagesEl;
            this.rows = [];
            // the first page 4 px down (under the toolbar's shadow), 8 px between pages (the VM)
            const edge = Math.round(gap / 2);
            let y = edge;
            let maxW = 0;
            const rowOf = [];
            for (let i = 0; i < this.pages.length;) {
                const group = [this.pages[i]];
                if (two && !(cover && i === 0) && this.pages[i + 1]) group.push(this.pages[i + 1]);
                const ws = group.map((p) => this.dims(p));
                const rw = ws.reduce((a, d) => a + d.w * s, 0) + (group.length - 1) * gap;
                const rh = Math.max(...ws.map((d) => d.h * s));
                this.rows.push({ pages: group, y, h: rh, w: rw });
                group.forEach((p) => { rowOf[p.n] = this.rows.length - 1; });
                maxW = Math.max(maxW, rw);
                y += rh + gap;
                i += group.length;
            }
            this.rowOf = rowOf;
            const W = Math.max(v.clientWidth, Math.ceil(maxW + (this.fit === 'width' ? 0 : gap * 2)));
            if (single) {
                const r = this.rows[rowOf[this.current] || 0];
                host.style.height = `${Math.max(v.clientHeight, Math.ceil(r.h + edge * 2))}px`;
            } else host.style.height = `${Math.ceil(y - gap + edge)}px`;
            host.style.width = `${W}px`;
            this.rows.forEach((r, ri) => {
                let x = Math.round((W - r.w) / 2);
                r.pages.forEach((p) => {
                    const d = this.dims(p);
                    const el = p.el;
                    const pw = d.w * s;
                    const ph = d.h * s;
                    el.style.left = `${x}px`;
                    el.style.top = `${single ? edge : r.y + (r.h - ph) / 2}px`;
                    el.style.width = `${pw}px`;
                    el.style.height = `${ph}px`;
                    el.style.setProperty('--total-scale-factor', String(s));
                    el.hidden = single && ri !== (rowOf[this.current] || 0);
                    p.x = x;
                    x += pw + gap;
                });
            });
            if (anchor) this.restoreAnchor(anchor);
            this.syncToolbar();
            this.schedule();
        }

        anchorPoint() {
            if (!this.rows || !this.rows.length) return null;
            const v = this.el.view;
            const r = this.rows[this.rowOf[this.current] || 0];
            if (!r) return null;
            if (this.layout === 'single' || this.layout === 'twoup') return { n: this.current, f: 0, x: v.scrollLeft / Math.max(1, v.scrollWidth) };
            return { n: this.current, f: (v.scrollTop - r.y) / Math.max(1, r.h), x: v.scrollLeft / Math.max(1, v.scrollWidth) };
        }

        restoreAnchor(a) {
            const v = this.el.view;
            const r = this.rows[this.rowOf[a.n] || 0];
            if (!r) return;
            if (!(this.layout === 'single' || this.layout === 'twoup')) v.scrollTop = Math.round(r.y + a.f * r.h);
            v.scrollLeft = Math.round(a.x * v.scrollWidth);
        }

        setZoom(z) {
            if (!this.pdf) return;
            this.fit = null;
            this.zoom = z;
            this.relayout();
        }

        setFit(fit) {
            if (!this.pdf) return;
            if (fit === 'actual') { this.setZoom(1); return; }
            if (!fit) { this.fit = null; this.relayout(); return; }
            this.fit = fit;
            this.relayout();
        }

        step(dir) {
            const z = this.zoom;
            const next = dir > 0 ? ZOOMS.find((x) => x > z + 0.001) : ZOOMS.slice().reverse().find((x) => x < z - 0.001);
            if (next) this.setZoom(next);
        }

        setLayout(l) {
            if (!this.pdf) return;
            this.layout = l;
            this.relayout();
            this.goTo(this.current, true);
        }

        rotate(deg) {
            this.rotation = (this.rotation + deg + 360) % 360;
            this.pages.forEach((p) => { p.rendered = 0; p.textDone = false; p.linksDone = false; if (p.text) { p.text.remove(); p.text = null; } if (p.links) { p.links.remove(); p.links = null; } });
            this.relayout();
            this.thumbsDirty = true;
            if (this.panel === 'pages') this.renderPanel();
        }

        // ---- pages in view ------------------------------------------------------------------------

        schedule() {
            if (this.raf) return;
            this.raf = requestAnimationFrame(() => { this.raf = 0; this.onView(); });
            // a hidden tab runs no frames; the timer stands in once
            setTimeout(() => { if (this.raf) { cancelAnimationFrame(this.raf); this.raf = 0; this.onView(); } }, 120);
        }

        onView() {
            if (!this.pdf || !this.rows) return;
            const v = this.el.view;
            const single = this.layout === 'single' || this.layout === 'twoup';
            let first = 0;
            let last = 0;
            if (single) {
                first = last = this.rowOf[this.current] || 0;
            } else {
                const top = v.scrollTop;
                const bottom = top + v.clientHeight;
                // the page row at the middle of the pane's top third is the current page (Reader's page box)
                let lo = 0;
                let hi = this.rows.length - 1;
                while (lo < hi) { const mid = (lo + hi) >> 1; if (this.rows[mid].y + this.rows[mid].h < top) lo = mid + 1; else hi = mid; }
                first = lo;
                last = lo;
                while (last + 1 < this.rows.length && this.rows[last + 1].y < bottom) last += 1;
                const probe = top + v.clientHeight / 3;
                let cur = first;
                for (let i = first; i <= last; i += 1) if (this.rows[i].y <= probe) cur = i;
                const n = this.rows[cur].pages[0].n;
                if (n !== this.current) { this.current = n; this.syncPage(); }
            }
            const want = new Set();
            for (let i = Math.max(0, first - 1); i <= Math.min(this.rows.length - 1, last + 1); i += 1) this.rows[i].pages.forEach((p) => want.add(p));
            // pages far from the pane give their canvases back (memory), drawn again when they return
            this.pages.forEach((p) => {
                if (want.has(p)) return;
                const r = this.rowOf[p.n];
                if (p.canvas && (r < first - 3 || r > last + 3)) { p.canvas.width = 0; p.canvas.height = 0; p.canvas.remove(); p.canvas = null; p.rendered = 0; }
            });
            const order = [];
            for (let i = first; i <= last; i += 1) this.rows[i].pages.forEach((p) => order.push(p));
            want.forEach((p) => { if (!order.includes(p)) order.push(p); });
            void this.renderQueue(order);
        }

        async renderQueue(order) {
            const token = (this.renderToken = (this.renderToken || 0) + 1);
            for (const p of order) {
                if (token !== this.renderToken || !this.pdf) return;
                const s = this.scale;
                if (p.rendered === s && p.canvas) { if (!p.textDone) void this.renderText(p); continue; }
                await this.renderPage(p, s);
            }
        }

        async renderPage(p, s) {
            const pdf = this.pdf;
            try {
                const proxy = p.proxy || (p.proxy = await pdf.getPage(p.n));
                if (this.pdf !== pdf) return;
                const rot = ((proxy.rotate || 0) + this.rotation) % 360;
                const dpr = Math.min(3, root.devicePixelRatio || 1);
                let vp = proxy.getViewport({ scale: s * dpr, rotation: rot });
                if (vp.width * vp.height > MAX_CANVAS) vp = proxy.getViewport({ scale: s * dpr * Math.sqrt(MAX_CANVAS / (vp.width * vp.height)), rotation: rot });
                const canvas = doc.createElement('canvas');
                canvas.className = 'rdr-canvas';
                canvas.width = Math.floor(vp.width);
                canvas.height = Math.floor(vp.height);
                if (p.task) try { p.task.cancel(); } catch (_) { /* done */ }
                const task = proxy.render({ canvasContext: canvas.getContext('2d', { alpha: false }), viewport: vp, annotationMode: this.lib.AnnotationMode.ENABLE_FORMS });
                p.task = task;
                await task.promise;
                p.task = null;
                if (this.pdf !== pdf) return;
                // the new drawing replaces the old one at once (no blank page between zooms)
                if (p.canvas) { p.canvas.width = 0; p.canvas.remove(); }
                p.el.insertBefore(canvas, p.el.firstChild);
                p.canvas = canvas;
                p.rendered = s;
                if (!p.textDone) await this.renderText(p);
                if (!p.linksDone) await this.renderLinks(p);
                if (this.find.hit && this.find.hit.page === p.n) this.showHit(this.find.hit);
            } catch (err) {
                p.task = null;
                if (!(err && err.name === 'RenderingCancelledException')) console.warn('Adobe Reader: page', p.n, err);
            }
        }

        async renderText(p) {
            if (p.textDone || !this.pdf) return;
            p.textDone = true;
            try {
                const proxy = p.proxy || (p.proxy = await this.pdf.getPage(p.n));
                const rot = ((proxy.rotate || 0) + this.rotation) % 360;
                const div = doc.createElement('div');
                div.className = 'textLayer rdr-text';
                const vp = proxy.getViewport({ scale: 1, rotation: rot });
                const tl = new this.lib.TextLayer({ textContentSource: proxy.streamTextContent({ includeMarkedContent: true, disableNormalization: true }), container: div, viewport: vp });
                await tl.render();
                const end = doc.createElement('div');
                end.className = 'endOfContent';
                div.appendChild(end);
                div.addEventListener('mousedown', () => div.classList.add('selecting'));
                div.addEventListener('mouseup', () => div.classList.remove('selecting'));
                if (p.text) p.text.remove();
                p.el.appendChild(div);
                p.text = div;
                p.tl = tl;
            } catch (err) {
                p.textDone = false;
            }
        }

        async renderLinks(p) {
            if (p.linksDone || !this.pdf) return;
            p.linksDone = true;
            try {
                const proxy = p.proxy;
                const anns = await proxy.getAnnotations({ intent: 'display' });
                p.annots = anns;
                const rot = ((proxy.rotate || 0) + this.rotation) % 360;
                const vp = proxy.getViewport({ scale: 1, rotation: rot });
                const layer = doc.createElement('div');
                layer.className = 'rdr-links';
                anns.filter((a) => a.subtype === 'Link' && (a.url || a.dest || a.action || a.unsafeUrl)).forEach((a) => {
                    const [x1, y1, x2, y2] = vp.convertToViewportRectangle(a.rect);
                    const el = doc.createElement('a');
                    el.className = 'rdr-link';
                    el.href = '#';
                    el.style.left = `${(Math.min(x1, x2) / vp.width) * 100}%`;
                    el.style.top = `${(Math.min(y1, y2) / vp.height) * 100}%`;
                    el.style.width = `${(Math.abs(x2 - x1) / vp.width) * 100}%`;
                    el.style.height = `${(Math.abs(y2 - y1) / vp.height) * 100}%`;
                    if (a.url || a.unsafeUrl) el.title = a.url || a.unsafeUrl;
                    el._link = a;
                    layer.appendChild(el);
                });
                if (p.links) p.links.remove();
                p.el.appendChild(layer);
                p.links = layer;
            } catch (_) {
                p.linksDone = false;
            }
        }

        async followLink(a) {
            if (!a) return;
            const url = a.url || a.unsafeUrl;
            if (url) {
                // Reader 8 asks before it opens a web page from a document
                const ok = await this.message(`The document is trying to connect to:\n${url}\nIf you trust this site, choose Allow. If you do not trust this site, choose Block.`, [{ text: 'Allow', value: true, className: 'btn-standard primary' }, { text: 'Block', value: false, className: 'btn-standard' }], 'Security Warning');
                if (!ok) return;
                if (typeof root.openGrimoireUrl === 'function') void root.openGrimoireUrl(url);
                return;
            }
            if (a.dest) { await this.goToDest(a.dest); return; }
            if (a.action === 'NextPage') this.goTo(this.current + 1);
            else if (a.action === 'PrevPage') this.goTo(this.current - 1);
            else if (a.action === 'FirstPage') this.goTo(1);
            else if (a.action === 'LastPage') this.goTo(this.pages.length);
            else if (a.action === 'GoBack') this.back();
            else if (a.action === 'GoForward') this.forward();
        }

        // ---- navigation ---------------------------------------------------------------------------

        remember() {
            this.history.push({ n: this.current, top: this.el.view.scrollTop, zoom: this.zoom, fit: this.fit });
            if (this.history.length > 64) this.history.shift();
            this.future = [];
        }

        back() {
            const h = this.history.pop();
            if (!h) return;
            this.future.push({ n: this.current, top: this.el.view.scrollTop, zoom: this.zoom, fit: this.fit });
            this.restoreView(h);
        }

        forward() {
            const h = this.future.pop();
            if (!h) return;
            this.history.push({ n: this.current, top: this.el.view.scrollTop, zoom: this.zoom, fit: this.fit });
            this.restoreView(h);
        }

        restoreView(h) {
            this.fit = h.fit; this.zoom = h.zoom;
            this.relayout(false);
            this.goTo(h.n, true);
            if (!(this.layout === 'single' || this.layout === 'twoup')) this.el.view.scrollTop = h.top;
        }

        goTo(n, silent, offset) {
            if (!this.pdf || !this.pages.length) return;
            n = Math.max(1, Math.min(this.pages.length, Math.round(n) || 1));
            if (!silent && n !== this.current) this.remember();
            const single = this.layout === 'single' || this.layout === 'twoup';
            const prevRow = this.rowOf[this.current];
            this.current = n;
            if (single) {
                if (prevRow !== this.rowOf[n]) this.relayout(false);
                this.el.view.scrollTop = offset ? Math.max(0, offset * this.scale) : 0;
            } else {
                const r = this.rows[this.rowOf[n]];
                const p = this.pages[n - 1];
                const top = parseFloat(p.el.style.top) || r.y;
                this.el.view.scrollTop = Math.round(top - (offset == null ? Math.round(this.gap() / 2) : 0) + (offset ? offset * this.scale : 0));
            }
            this.syncPage();
            this.schedule();
        }

        goToLabel(v) {
            const n = parseInt(v, 10);
            if (n >= 1 && n <= this.pages.length) this.goTo(n);
            else {
                this.el.pagebox.value = String(this.current);
                void this.message(`There is no page numbered '${v}' in this document.`);
            }
        }

        async goToDest(dest) {
            try {
                const d = typeof dest === 'string' ? await this.pdf.getDestination(dest) : dest;
                if (!Array.isArray(d)) return;
                const idx = typeof d[0] === 'object' && d[0] ? await this.pdf.getPageIndex(d[0]) : Number(d[0]);
                const p = this.pages[idx];
                if (!p) return;
                const kind = d[1] && d[1].name;
                let offset = null;
                if (kind === 'XYZ' && d[3] != null) offset = Math.max(0, p.h - d[3]);
                else if ((kind === 'FitH' || kind === 'FitBH') && d[2] != null) offset = Math.max(0, p.h - d[2]);
                if (kind === 'XYZ' && d[4]) { this.fit = null; this.zoom = d[4]; this.relayout(false); }
                else if (kind === 'Fit' || kind === 'FitB') this.setFit('page');
                this.remember();
                this.goTo(idx + 1, true, offset);
            } catch (_) { /* a broken destination goes nowhere, as in Reader */ }
        }

        syncPage() {
            if (document.activeElement !== this.el.pagebox) this.el.pagebox.value = this.pdf ? String(this.current) : '0';
            this.syncToolbar();
            if (this.panel === 'pages') this.markThumb();
            if (this.panel === 'bookmarks') this.markBookmark();
        }

        syncToolbar() {
            const has = !!this.pdf;
            const set = (a, on) => { const b = this.modal.querySelector(`.rdr-toolbar [data-a="${a}"]`); if (b) b.disabled = !on; };
            set('print', has);
            set('prev', has && this.current > 1);
            set('next', has && this.current < this.pages.length);
            set('zoomin', has); set('zoomout', has); set('fitwidth', has); set('fitpage', has); set('zoommenu', has);
            this.el.pagebox.disabled = !has;
            this.el.zoombox.disabled = !has;
            this.el.pagecount.textContent = `/ ${has ? this.pages.length : 0}`;
            this.el.pagecount.classList.toggle('is-disabled', !has);
            if (document.activeElement !== this.el.zoombox) this.el.zoombox.value = has ? fmtZoom(this.zoom) : '100%';
            if (document.activeElement !== this.el.pagebox) this.el.pagebox.value = has ? String(this.current) : '0';
            const fw = this.modal.querySelector('[data-a="fitwidth"]');
            const fp = this.modal.querySelector('[data-a="fitpage"]');
            fw.classList.toggle('is-on', has && this.fit === 'width');
            fp.classList.toggle('is-on', has && this.fit === 'page');
        }

        applyToolbars() {
            this.modal.querySelectorAll('.rdr-group[data-bar]').forEach((g) => { g.hidden = !this.toolbars[g.dataset.bar]; });
        }

        // ---- tools --------------------------------------------------------------------------------

        setTool(t) {
            this.tool = t;
            this.modal.dataset.tool = t;
        }

        toolDown(ev) {
            if (ev.button !== 0 || !this.pdf) return;
            const v = this.el.view;
            const sig = this.app.signal;
            if (ev.target.closest('.rdr-link')) return;
            if (this.tool === 'hand') {
                ev.preventDefault();
                const sx = ev.clientX; const sy = ev.clientY; const l0 = v.scrollLeft; const t0 = v.scrollTop;
                v.classList.add('is-grabbing');
                const move = (e) => { v.scrollLeft = l0 - (e.clientX - sx); v.scrollTop = t0 - (e.clientY - sy); };
                const up = () => { v.classList.remove('is-grabbing'); doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); };
                doc.addEventListener('pointermove', move, { signal: sig });
                doc.addEventListener('pointerup', up, { signal: sig });
                return;
            }
            if (this.tool === 'marquee') {
                ev.preventDefault();
                const r0 = v.getBoundingClientRect();
                const sx = ev.clientX - r0.left + v.scrollLeft; const sy = ev.clientY - r0.top + v.scrollTop;
                const box = doc.createElement('div');
                box.className = 'rdr-marquee';
                this.el.pagesEl.appendChild(box);
                let ex = sx; let ey = sy;
                const draw = () => { box.style.left = `${Math.min(sx, ex)}px`; box.style.top = `${Math.min(sy, ey)}px`; box.style.width = `${Math.abs(ex - sx)}px`; box.style.height = `${Math.abs(ey - sy)}px`; };
                const move = (e) => { ex = e.clientX - r0.left + v.scrollLeft; ey = e.clientY - r0.top + v.scrollTop; draw(); };
                const up = () => {
                    doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up);
                    box.remove();
                    const w = Math.abs(ex - sx); const h = Math.abs(ey - sy);
                    const cx = (sx + ex) / 2; const cy = (sy + ey) / 2;
                    const old = this.zoom;
                    const nz = w < 4 || h < 4 ? (ZOOMS.find((x) => x > old + 0.001) || old) : Math.min(64, old * Math.min(v.clientWidth / w, v.clientHeight / h));
                    this.fit = null; this.zoom = nz; this.relayout(false);
                    const k = nz / old;
                    v.scrollLeft = cx * k - v.clientWidth / 2;
                    v.scrollTop = cy * k - v.clientHeight / 2;
                };
                doc.addEventListener('pointermove', move, { signal: sig });
                doc.addEventListener('pointerup', up, { signal: sig });
                return;
            }
            if (this.tool === 'dynamic') {
                ev.preventDefault();
                let last = ev.clientY;
                const move = (e) => { const d = last - e.clientY; if (Math.abs(d) < 4) return; last = e.clientY; this.setZoom(Math.min(64, Math.max(0.0833, this.zoom * (1 + d / 200)))); };
                const up = () => { doc.removeEventListener('pointermove', move); doc.removeEventListener('pointerup', up); };
                doc.addEventListener('pointermove', move, { signal: sig });
                doc.addEventListener('pointerup', up, { signal: sig });
            }
        }

        selectAll() {
            const p = this.pages[this.current - 1];
            if (!p || !p.text) return;
            const r = doc.createRange();
            r.selectNodeContents(p.text);
            const s = root.getSelection();
            s.removeAllRanges();
            s.addRange(r);
        }

        readingMode() {
            this.reading = !this.reading;
            this.modal.classList.toggle('rdr-reading', this.reading);
            this.relayout();
        }

        fullScreen() {
            const el = this.el.view;
            if (doc.fullscreenElement) { void doc.exitFullscreen(); return; }
            if (el.requestFullscreen) void el.requestFullscreen().then(() => { this.setFit('page'); }).catch(() => {});
        }

        autoScroll() {
            if (this.autoTimer) { clearInterval(this.autoTimer); this.autoTimer = null; return; }
            // Automatically Scroll: a slow steady scroll until Esc or the end
            this.autoTimer = setInterval(() => {
                // a hidden page scrolls nothing (the timer ends with the scroll or the window)
                if (doc.hidden) return;
                const v = this.el.view;
                if (!this.modal.isConnected || v.scrollTop + v.clientHeight >= v.scrollHeight) { clearInterval(this.autoTimer); this.autoTimer = null; return; }
                v.scrollTop += 1;
            }, 40);
        }

        // ---- find ---------------------------------------------------------------------------------

        async pageText(n) {
            this.texts = this.texts || new Map();
            if (this.texts.has(n)) return this.texts.get(n);
            const proxy = this.pages[n - 1].proxy || (this.pages[n - 1].proxy = await this.pdf.getPage(n));
            const tc = await proxy.getTextContent({ disableNormalization: true });
            // the same items the text layer draws (one span each), joined as Reader reads them
            const items = tc.items.filter((it) => typeof it.str === 'string');
            let text = '';
            const starts = [];
            items.forEach((it) => { starts.push(text.length); text += it.str + (it.hasEOL ? ' ' : ''); });
            const entry = { text, starts, items };
            this.texts.set(n, entry);
            return entry;
        }

        matcher(q, opts) {
            const src = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&').replace(/\s+/g, '\\s+');
            return new RegExp(opts.whole ? `(?<![\\p{L}\\p{N}])${src}(?![\\p{L}\\p{N}])` : src, `gu${opts.matchCase ? '' : 'i'}`);
        }

        async findAll(q, opts) {
            const re = this.matcher(q, opts);
            const hits = [];
            for (let n = 1; n <= this.pages.length; n += 1) {
                const { text } = await this.pageText(n);
                re.lastIndex = 0;
                let m;
                while ((m = re.exec(text))) { hits.push({ page: n, start: m.index, end: m.index + m[0].length }); if (!m[0].length) re.lastIndex += 1; }
            }
            return hits;
        }

        async findNext(dir, q) {
            if (!this.pdf) return;
            if (q != null && q !== this.find.q) { this.find.q = q; this.find.hits = null; }
            q = this.find.q;
            if (!q || !q.trim()) return;
            if (!this.find.hits) {
                this.find.hits = await this.findAll(q, this.find);
                this.find.at = -1;
                this.modal.querySelectorAll('[data-a="findprev"], [data-a="findnext"]').forEach((b) => { b.hidden = false; });
            }
            const hits = this.find.hits;
            if (!hits.length) {
                await this.message(`Reader has finished searching the document. No matches were found.`);
                return;
            }
            let i = this.find.at;
            if (i < 0) {
                // from the current page on
                i = hits.findIndex((h) => h.page >= this.current);
                if (i < 0) i = 0;
                if (dir < 0) i = (i - 1 + hits.length) % hits.length;
            } else i = (i + dir + hits.length) % hits.length;
            if (dir > 0 && this.find.at >= 0 && i === 0) {
                const again = await this.message('Reader has finished searching the document. Do you want to continue searching from the beginning of the document?', [{ text: 'Yes', value: true, className: 'btn-standard primary' }, { text: 'No', value: false, className: 'btn-standard' }]);
                if (!again) return;
            }
            this.find.at = i;
            await this.reveal(hits[i]);
        }

        async reveal(hit) {
            this.find.hit = hit;
            const p = this.pages[hit.page - 1];
            if (this.layout === 'single' || this.layout === 'twoup' || !this.inView(p)) this.goTo(hit.page, true);
            await this.renderPage(p, this.scale);
            this.showHit(hit);
        }

        inView(p) {
            const v = this.el.view;
            const top = parseFloat(p.el.style.top) || 0;
            return top + p.el.offsetHeight > v.scrollTop && top < v.scrollTop + v.clientHeight;
        }

        /** A hit is selected, as Reader 8 shows it (the selection, ready for Copy), and scrolled into view. */
        showHit(hit) {
            const p = this.pages[hit.page - 1];
            if (!p || !p.text || !p.tl) return;
            const entry = this.texts && this.texts.get(hit.page);
            if (!entry) return;
            const divs = p.tl.textDivs || [];
            const locate = (off) => {
                let i = 0;
                while (i + 1 < entry.starts.length && entry.starts[i + 1] <= off) i += 1;
                const node = divs[i] && divs[i].firstChild;
                const local = Math.min(off - entry.starts[i], node ? node.length : 0);
                return { node, local };
            };
            const a = locate(hit.start);
            const b = locate(hit.end);
            if (!a.node || !b.node) return;
            const r = doc.createRange();
            try { r.setStart(a.node, a.local); r.setEnd(b.node, b.local); } catch (_) { return; }
            // drawn as Reader's selection over the words (the Find box keeps the focus), and selected for Copy
            this.el.pagesEl.querySelectorAll('.rdr-hit').forEach((x) => x.remove());
            const pr = p.el.getBoundingClientRect();
            Array.from(r.getClientRects()).forEach((c) => {
                if (c.width < 1) return;
                const d = doc.createElement('div');
                d.className = 'rdr-hit';
                d.style.left = `${c.left - pr.left}px`; d.style.top = `${c.top - pr.top}px`;
                d.style.width = `${c.width}px`; d.style.height = `${c.height}px`;
                p.el.appendChild(d);
            });
            if (doc.activeElement !== this.el.findbox) { const s = root.getSelection(); s.removeAllRanges(); s.addRange(r); }
            const rect = r.getBoundingClientRect();
            const vr = this.el.view.getBoundingClientRect();
            if (rect.top < vr.top + 10 || rect.bottom > vr.bottom - 10) this.el.view.scrollTop += rect.top - vr.top - this.el.view.clientHeight / 3;
            if (rect.left < vr.left || rect.right > vr.right) this.el.view.scrollLeft += rect.left - vr.left - 40;
        }

        // ---- panels -------------------------------------------------------------------------------

        togglePanel(name, show) {
            if (name === 'attachments' || name === 'comments') {
                this.showBottom(this.bottomPanel === name && !show ? null : name);
                return;
            }
            this.showPanel(this.panel === name && !show ? null : name);
        }

        showPanel(name) {
            if (name) this.lastPanel = name;
            this.panel = name;
            const p = this.el.panel;
            p.hidden = !name;
            this.el.split.hidden = !name;
            this.modal.classList.toggle('rdr-panel-open', !!name);
            if (name) p.style.width = `${Number(reg('PanelWidth', 0)) || (name === 'howto' ? 280 : 195)}px`;
            this.modal.querySelectorAll('.rdr-navtabs:not(.rdr-navtabs-bottom) .rdr-navtab').forEach((b) => b.classList.toggle('is-on', b.dataset.panel === name));
            if (name) this.renderPanel();
            this.relayout();
        }

        renderPanel() {
            const name = this.panel;
            const body = this.el.panelBody;
            const tools = this.el.panelTools;
            this.el.panelTitle.textContent = { pages: 'Pages', bookmarks: 'Bookmarks', howto: 'How To' }[name] || '';
            body.innerHTML = '';
            tools.innerHTML = '';
            body.className = `rdr-panel-body rdr-panel-${name}`;
            if (this.thumbObs) { this.thumbObs.disconnect(); this.thumbObs = null; }
            if (name === 'bookmarks') this.renderBookmarks(body, tools);
            else if (name === 'pages') this.renderThumbs(body, tools);
            else if (name === 'howto') renderHowTo(body);
        }

        optionsButton(tools, items) {
            const b = doc.createElement('button');
            b.type = 'button';
            b.className = 'rdr-options';
            b.textContent = 'Options';
            tools.appendChild(b);
            root.contextMenu.attachClickMenuToElement(b, { skin: 'reader', onAction: (a) => void this.panelAction(a), sections: [{ type: 'list', initfn: (s) => { s.items = items(); } }] });
        }

        async panelAction(a) {
            if (a === 'bm-expand') { this.el.panelBody.querySelectorAll('.rdr-bm').forEach((li) => li.classList.add('is-open')); return; }
            if (a === 'bm-collapse') { this.el.panelBody.querySelectorAll('.rdr-bm').forEach((li) => li.classList.remove('is-open')); return; }
            if (a === 'bm-current') { this.markBookmark(true); return; }
            if (a === 'bm-wrap') { setReg({ WrapBookmarks: !reg('WrapBookmarks', true) }); this.el.panelBody.classList.toggle('is-nowrap', !reg('WrapBookmarks', true)); return; }
            if (a === 'th-print') { this.printDialog({ pages: [this.current] }); return; }
            if (a === 'att-open' || a === 'att-save') { const sel = this.el.bottomBody.querySelector('.rdr-att-row.is-sel'); if (sel) await this.attachment(sel._att, a === 'att-open'); }
        }

        renderBookmarks(body, tools) {
            const go = doc.createElement('button');
            go.type = 'button';
            go.className = 'rdr-panel-tool';
            go.title = 'Expand current bookmark';
            go.innerHTML = `<img src="${A}/bm-goto.png" alt="" draggable="false">`;
            go.addEventListener('click', () => this.markBookmark(true));
            tools.appendChild(go);
            this.optionsButton(tools, () => [
                { text: 'Expand Current Bookmark', action: 'bm-current' },
                { text: 'Expand Top-Level Bookmarks', action: 'bm-expand' },
                { text: 'Collapse Top-Level Bookmarks', action: 'bm-collapse' },
                { separator: true },
                { text: 'Print Page(s)', disabled: true },
                { separator: true },
                { text: 'Text Size', submenu: [{ text: 'Small', disabled: true }, { text: 'Medium', showIndicator: true, checked: true }, { text: 'Large', disabled: true }] },
                { text: 'Highlight Current Bookmark', showIndicator: true, checked: true },
                { text: 'Wrap Long Bookmarks', action: 'bm-wrap', showIndicator: true, checked: reg('WrapBookmarks', true) !== false }
            ]);
            body.classList.toggle('is-nowrap', reg('WrapBookmarks', true) === false);
            const list = doc.createElement('ul');
            list.className = 'rdr-bm-tree';
            list.setAttribute('role', 'tree');
            this.bmIndex = [];
            const build = (items, ul, depth) => {
                items.forEach((it) => {
                    const li = doc.createElement('li');
                    li.className = 'rdr-bm';
                    const kids = it.items && it.items.length;
                    if (kids && it.count > 0) li.classList.add('is-open');
                    li.style.setProperty('--depth', String(depth));
                    li.innerHTML = `<div class="rdr-bm-row">${kids ? '<span class="rdr-bm-box"></span>' : ''}<img class="rdr-bm-icon" src="${A}/bookmark.png" alt="" draggable="false"><span class="rdr-bm-text"></span></div>`;
                    const text = li.querySelector('.rdr-bm-text');
                    text.textContent = it.title;
                    if (it.bold) text.style.fontWeight = 'bold';
                    if (it.italic) text.style.fontStyle = 'italic';
                    if (it.color && (it.color[0] || it.color[1] || it.color[2])) text.style.color = `rgb(${it.color.join(',')})`;
                    const row = li.firstChild;
                    row._item = it;
                    this.bmIndex.push({ row, it, page: null });
                    ul.appendChild(li);
                    if (kids) {
                        const sub = doc.createElement('ul');
                        build(it.items, sub, depth + 1);
                        li.appendChild(sub);
                    }
                });
            };
            if (this.outline && this.outline.length) build(this.outline, list, 0);
            body.appendChild(list);
            list.addEventListener('click', (ev) => {
                const row = ev.target.closest('.rdr-bm-row');
                if (!row) return;
                if (ev.target.closest('.rdr-bm-box')) { row.parentElement.classList.toggle('is-open'); return; }
                list.querySelectorAll('.rdr-bm-row.is-sel').forEach((r) => r.classList.remove('is-sel'));
                row.classList.add('is-sel');
                this.bmCurrent = row;
                this.markBookmark();
                const it = row._item;
                if (it.dest) void this.goToDest(it.dest);
                else if (it.url) void this.followLink({ url: it.url });
            });
            // which page each bookmark goes to (the current one turns grey)
            void (async () => {
                for (const b of this.bmIndex) {
                    try {
                        const d = typeof b.it.dest === 'string' ? await this.pdf.getDestination(b.it.dest) : b.it.dest;
                        if (Array.isArray(d)) b.page = (typeof d[0] === 'object' && d[0] ? await this.pdf.getPageIndex(d[0]) : Number(d[0])) + 1;
                    } catch (_) { /* none */ }
                }
                this.markBookmark();
            })();
        }

        markBookmark(expand) {
            if (!this.bmIndex) return;
            // the current bookmark (its icon grey): the first of the deepest ones on the page in view, else the last
            // one before it (the VM: Section A at the top of page 1, not Chapter 1)
            let best = null;
            const depth = (b) => { let d = 0; let li = b.row.parentElement; while ((li = li.parentElement.closest('.rdr-bm'))) d += 1; return d; };
            this.bmIndex.forEach((b) => { if (b.page === this.current && (!best || depth(b) > depth(best))) best = b; });
            if (!best) this.bmIndex.forEach((b) => { if (b.page && b.page < this.current && (!best || b.page >= best.page)) best = b; });
            const cur = this.bmCurrent && this.bmIndex.find((b) => b.row === this.bmCurrent && b.page === this.current) ? this.bmIndex.find((b) => b.row === this.bmCurrent) : best;
            this.bmIndex.forEach((b) => b.row.classList.toggle('is-current', b === cur));
            if (expand && cur) {
                let li = cur.row.parentElement.parentElement && cur.row.parentElement.parentElement.closest('.rdr-bm');
                while (li) { li.classList.add('is-open'); li = li.parentElement.closest('.rdr-bm'); }
                cur.row.scrollIntoView({ block: 'nearest' });
            }
        }

        renderThumbs(body, tools) {
            this.optionsButton(tools, () => [
                { text: 'Print Pages...', action: 'th-print' },
                { separator: true },
                { text: 'Enlarge Page Thumbnails', disabled: true },
                { text: 'Reduce Page Thumbnails', disabled: true }
            ]);
            const wrap = doc.createElement('div');
            wrap.className = 'rdr-thumbs';
            const TW = 76;
            this.pages.forEach((p) => {
                const d = this.dims(p);
                const h = Math.round((TW * d.h) / d.w);
                const t = doc.createElement('div');
                t.className = 'rdr-thumb';
                t.dataset.page = String(p.n);
                t.innerHTML = `<div class="rdr-thumb-page" style="width:${TW}px;height:${h}px"><span class="rdr-thumb-view"></span></div><span class="rdr-thumb-num">${p.n}</span>`;
                wrap.appendChild(t);
            });
            body.appendChild(wrap);
            wrap.addEventListener('click', (ev) => { const t = ev.target.closest('.rdr-thumb'); if (t) this.goTo(Number(t.dataset.page)); });
            this.thumbObs = new IntersectionObserver((entries) => {
                entries.forEach((e) => { if (e.isIntersecting) void this.drawThumb(e.target); });
            }, { root: body, rootMargin: '200px 0px' });
            wrap.querySelectorAll('.rdr-thumb').forEach((t) => this.thumbObs.observe(t));
            this.markThumb();
        }

        async drawThumb(t) {
            if (t.dataset.drawn) return;
            t.dataset.drawn = '1';
            const p = this.pages[Number(t.dataset.page) - 1];
            try {
                const proxy = p.proxy || (p.proxy = await this.pdf.getPage(p.n));
                const box = t.querySelector('.rdr-thumb-page');
                const rot = ((proxy.rotate || 0) + this.rotation) % 360;
                const base = proxy.getViewport({ scale: 1, rotation: rot });
                const dpr = Math.min(2, root.devicePixelRatio || 1);
                const vp = proxy.getViewport({ scale: (box.clientWidth / base.width) * dpr, rotation: rot });
                const c = doc.createElement('canvas');
                c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
                await proxy.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
                box.insertBefore(c, box.firstChild);
            } catch (_) { t.dataset.drawn = ''; }
        }

        markThumb() {
            const body = this.el.panelBody;
            body.querySelectorAll('.rdr-thumb.is-current').forEach((t) => t.classList.remove('is-current'));
            const t = body.querySelector(`.rdr-thumb[data-page="${this.current}"]`);
            if (!t) return;
            t.classList.add('is-current');
            // the red frame is the part of the page the pane shows
            const p = this.pages[this.current - 1];
            const v = this.el.view;
            const top = parseFloat(p.el.style.top) || 0;
            const left = parseFloat(p.el.style.left) || 0;
            const ph = p.el.offsetHeight || 1;
            const pw = p.el.offsetWidth || 1;
            const f = (a) => Math.max(0, Math.min(1, a));
            const y0 = f((v.scrollTop - top) / ph); const y1 = f((v.scrollTop + v.clientHeight - top) / ph);
            const x0 = f((v.scrollLeft - left) / pw); const x1 = f((v.scrollLeft + v.clientWidth - left) / pw);
            const r = t.querySelector('.rdr-thumb-view');
            r.style.top = `${y0 * 100}%`; r.style.height = `${(y1 - y0) * 100}%`;
            r.style.left = `${x0 * 100}%`; r.style.width = `${(x1 - x0) * 100}%`;
            const body2 = this.el.panelBody;
            const tr = t.getBoundingClientRect(); const br = body2.getBoundingClientRect();
            if (tr.top < br.top || tr.bottom > br.bottom) body2.scrollTop += tr.top - br.top - 20;
        }

        showBottom(name) {
            this.bottomPanel = name;
            const b = this.el.bottom;
            b.hidden = !name;
            this.modal.querySelectorAll('.rdr-navtabs-bottom .rdr-navtab').forEach((x) => x.classList.toggle('is-on', x.dataset.panel === name));
            if (name === 'attachments') void this.renderAttachments();
            else if (name === 'comments') void this.renderComments();
            this.relayout();
        }

        async renderAttachments() {
            const tools = this.el.bottomTools;
            const body = this.el.bottomBody;
            tools.innerHTML = `<button type="button" class="rdr-bt" data-b="open" disabled><img src="${A}/att-open.png" alt="">Open</button><button type="button" class="rdr-bt" data-b="save" disabled><img src="${A}/att-save.png" alt="">Save</button><button type="button" class="rdr-bt" data-b="search" disabled><img src="${A}/att-search.png" alt="">Search</button><span class="rdr-bt-fill"></span>`;
            this.optionsButton(tools, () => [{ text: 'Open Attachment', action: 'att-open' }, { text: 'Save Attachment...', action: 'att-save' }]);
            body.innerHTML = '<div class="rdr-att-head"><span>Name</span><span>Description</span><span>Modified</span><span>Size</span></div><div class="rdr-att-list"></div>';
            const list = body.querySelector('.rdr-att-list');
            const atts = this.pdf ? await this.pdf.getAttachments().catch(() => null) : null;
            Object.values(atts || {}).forEach((att) => {
                const row = doc.createElement('div');
                row.className = 'rdr-att-row';
                row.innerHTML = `<span><img src="${A}/search-doc.png" alt=""><b></b></span><span></span><span>Unknown</span><span>${att.content ? '' : 'Unknown'}</span>`;
                row.querySelector('b').textContent = att.filename;
                row.children[1].textContent = att.description || att.filename;
                if (att.content) row.children[3].textContent = att.content.length < 1024 ? `${att.content.length} bytes` : `${Math.round(att.content.length / 1024)} KB`;
                row._att = att;
                list.appendChild(row);
            });
            const pick = (row) => {
                list.querySelectorAll('.is-sel').forEach((r) => r.classList.remove('is-sel'));
                if (row) row.classList.add('is-sel');
                tools.querySelectorAll('[data-b="open"], [data-b="save"]').forEach((b) => { b.disabled = !row; });
            };
            list.addEventListener('click', (ev) => pick(ev.target.closest('.rdr-att-row')));
            list.addEventListener('dblclick', (ev) => { const r = ev.target.closest('.rdr-att-row'); if (r) void this.attachment(r._att, true); });
            tools.addEventListener('click', (ev) => {
                const b = ev.target.closest('[data-b]');
                const sel = list.querySelector('.rdr-att-row.is-sel');
                if (!b || b.disabled || !sel) return;
                if (b.dataset.b === 'open') void this.attachment(sel._att, true);
                if (b.dataset.b === 'save') void this.attachment(sel._att, false);
            });
        }

        async attachment(att, open) {
            if (!att || !att.content) return;
            const name = att.filename || 'attachment';
            if (!open) { saveBytesAs(this, att.content, name, guessMime(name)); return; }
            // Reader 8 warns before it opens a file from a document
            if (/\.pdf$/i.test(name)) { void newWindow({ data: att.content.slice(), name, location: this.name }); return; }
            const ok = await this.message(`Open the attachment ${name}?\nAttachments may contain programs, macros or viruses that could harm your computer. Only open attachments from a trusted source.`, [{ text: 'OK', value: true, className: 'btn-standard primary' }, { text: 'Cancel', value: false, className: 'btn-standard' }], 'Launch Attachment');
            if (!ok) return;
            const mime = guessMime(name);
            const url = URL.createObjectURL(new Blob([att.content], { type: mime }));
            if (mime.startsWith('image/') && typeof root.openImageInViewer === 'function') { root.openImageInViewer(url, name, {}); return; }
            if (/^text\//.test(mime)) {
                const text = new TextDecoder('utf-8').decode(att.content);
                await this.message(text.slice(0, 4000), null, name);
                URL.revokeObjectURL(url);
                return;
            }
            saveBytesAs(this, att.content, name, mime);
            URL.revokeObjectURL(url);
        }

        async renderComments() {
            const tools = this.el.bottomTools;
            const body = this.el.bottomBody;
            tools.innerHTML = '<span class="rdr-bt-fill"></span>';
            this.optionsButton(tools, () => [{ text: 'Expand All', disabled: true }, { text: 'Collapse All', disabled: true }]);
            body.innerHTML = '<div class="rdr-cm-list"></div>';
            const list = body.querySelector('.rdr-cm-list');
            const shown = [];
            for (const p of this.pages) {
                const proxy = p.proxy || (p.proxy = await this.pdf.getPage(p.n));
                const anns = p.annots || (p.annots = await proxy.getAnnotations({ intent: 'display' }).catch(() => []));
                anns.filter((a) => !['Link', 'Widget', 'Popup'].includes(a.subtype)).forEach((a) => shown.push({ p: p.n, a }));
            }
            if (!shown.length) { list.innerHTML = '<div class="rdr-cm-none">This document has no comments.</div>'; return; }
            shown.forEach(({ p, a }) => {
                const row = doc.createElement('div');
                row.className = 'rdr-cm-row';
                row.innerHTML = `<div class="rdr-cm-head"><b></b> <span></span></div><div class="rdr-cm-text"></div>`;
                row.querySelector('b').textContent = `Page ${p}  ${a.subtype}`;
                row.querySelector('span').textContent = (a.titleObj && a.titleObj.str) || '';
                row.querySelector('.rdr-cm-text').textContent = (a.contentsObj && a.contentsObj.str) || '';
                row.addEventListener('click', () => this.goTo(p));
                list.appendChild(row);
            });
        }

        // ---- files --------------------------------------------------------------------------------

        openDialog() {
            if (typeof root.studioOpenFolderDialog !== 'function') return;
            void root.studioOpenFolderDialog('open-vfs', {
                owner: this.modal,
                startPath: (this.file && this.file.path) || workspaceRoot(),
                host: {
                    title: 'Open',
                    typeLabel: 'Adobe PDF Files (*.pdf)',
                    rejectMessage: 'Choose a PDF document',
                    acceptItem: (item) => !!item && item.targetKind === 'user-file' && /\.pdf$/i.test(item.name || ''),
                    onOpen: async (item, folderPath) => { await this.openInWindow({ file: { id: item.targetId || item.id, name: item.name, path: folderPath } }); }
                }
            });
        }

        async bytes() {
            if (!this.pdf) return null;
            return this.pdf.getData();
        }

        async saveCopy() {
            const data = await this.bytes();
            if (data) saveBytesAs(this, data, this.name, 'application/pdf', 'Adobe PDF Files (*.pdf)');
        }

        async saveText() {
            if (!this.pdf) return;
            const parts = [];
            for (let n = 1; n <= this.pages.length; n += 1) {
                const tc = await (this.pages[n - 1].proxy || (this.pages[n - 1].proxy = await this.pdf.getPage(n))).getTextContent();
                parts.push(tc.items.map((it) => (it.str || '') + (it.hasEOL ? '\r\n' : '')).join(''));
            }
            const text = parts.join('\r\n\f');
            saveBytesAs(this, new TextEncoder().encode(text), this.name.replace(/\.pdf$/i, '') + '.txt', 'text/plain', 'Text (Accessible) (*.txt)');
        }

        async email() {
            const open = typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : root.doveOpenComposeWindow; // eslint-disable-line no-undef
            const data = await this.bytes();
            if (!data) return;
            if (typeof open !== 'function') {
                if (root.featureLoader) { try { await root.featureLoader.loadFeature('dovecote'); } catch (_) { /* none */ } }
            }
            const fn = typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : root.doveOpenComposeWindow; // eslint-disable-line no-undef
            if (typeof fn !== 'function') { await this.message('No e-mail program is available to send this document.'); return; }
            fn({ mode: 'create', to: '', subject: this.name, body: '', attachments: [{ name: this.name, mimeType: 'application/pdf', size: data.length, base64: bytesToB64(data) }] });
        }

        async copyFile() {
            const data = await this.bytes();
            if (!data || !navigator.clipboard || typeof ClipboardItem === 'undefined') return;
            try { await navigator.clipboard.write([new ClipboardItem({ 'application/pdf': new Blob([data], { type: 'application/pdf' }) })]); } catch (_) { /* the browser takes no PDFs on the clipboard */ }
        }

        askPassword(name, wrong) {
            return new Promise((resolve) => {
                const tpl = tplOf('Password', 340, 150, [
                    C.st(10, 64, 14, 260, 30, `'${name}' is protected. Please enter a Document Open Password.`),
                    C.st(11, 64, 56, 105, 15, 'Enter Password:'),
                    [12, 'E', dx(170), dy(52), dx(150), dy(23), V | TAB | 0x80 | 0x20, '', 0x200],
                    C.btn(1, 158, 110, 75, 23, 'OK', true),
                    C.btn(2, 243, 110, 75, 23, 'Cancel')
                ]);
                const D = root.vistaDialogTemplate;
                if (!D) { resolve(null); return; }
                D.openDialog({
                    id: `rdrPassword${this.n}`, tpl, owner: this.modal, bareCaption: true,
                    overrides: { 20: {} },
                    init: (ctx) => { if (wrong) ctx.text(10, 'Invalid password. Please try again.'); setTimeout(() => { const e = ctx.el(12); if (e) e.focus(); }, 0); },
                    ok: (ctx) => { resolve(String(ctx.get(12) || '')); },
                    cancel: () => resolve(null)
                });
            });
        }

        message(text, buttons, title) {
            const t = String(text);
            const body = t.includes('\n') ? esc(t).replace(/\n/g, '<br>') : t;
            return Promise.resolve(call('showConfirmationDialog', body, buttons || [{ text: 'OK', value: true, className: 'btn-standard primary' }], null, { title: title || 'Adobe Reader', icon: 'fas fa-exclamation-triangle', sound: true, owner: this.modal }));
        }

        // ---- dialogs ------------------------------------------------------------------------------

        goToDialog() {
            const D = root.vistaDialogTemplate;
            if (!D || !this.pdf) return;
            const tpl = tplOf('Go To Page', 204, 85, [
                C.st(10, 11, 14, 40, 15, 'Page:'),
                C.edit(11, 54, 10, 69, 24, String(this.current)),
                C.st(12, 136, 14, 60, 15, `of ${this.pages.length}`),
                C.btn(1, 25, 47, 75, 23, 'OK', true),
                C.btn(2, 115, 47, 76, 23, 'Cancel')
            ]);
            D.openDialog({
                id: `rdrGoTo${this.n}`, tpl, owner: this.modal, bareCaption: true,
                init: (ctx) => setTimeout(() => { const e = ctx.el(11); if (e) { e.focus(); e.select(); } }, 0),
                ok: (ctx) => { this.goToLabel(String(ctx.get(11) || '')); }
            });
        }

        zoomToDialog() {
            const D = root.vistaDialogTemplate;
            if (!D || !this.pdf) return;
            const tpl = tplOf('Zoom To', 230, 85, [
                C.st(10, 11, 18, 70, 15, 'Magnification:'),
                [11, 'C', dx(96), dy(13), dx(120), dy(160), V | TAB | 2 | 0x200000, '', 0],
                C.btn(1, 46, 47, 75, 23, 'OK', true),
                C.btn(2, 131, 47, 76, 23, 'Cancel')
            ]);
            D.openDialog({
                id: `rdrZoomTo${this.n}`, tpl, owner: this.modal, bareCaption: true,
                init: (ctx) => { ctx.options(11, ZOOMS.slice().reverse().map(fmtZoom)); ctx.set(11, fmtZoom(this.zoom)); },
                ok: (ctx) => { const v = parseFloat(String(ctx.get(11) || '')); if (v > 0) this.setZoom(Math.min(64, Math.max(0.0833, v / 100))); }
            });
        }

        properties() { if (this.pdf) openProperties(this); }

        printSetup() {
            const D = root.vistaDialogTemplate;
            if (!D) return;
            D.openDialog({ id: `rdrPageSetup${this.n}`, key: 'comdlg32:1546', owner: this.modal, bareCaption: true, overrides: { 1038: { hidden: true } } });
        }

        printDialog(opts) { if (this.pdf) openPrint(this, opts || {}); }
    }

    // ---- shared helpers ------------------------------------------------------------------------------

    /** Win32's "&" access keys: "&Open..." -> { text: 'Open...', accessKey: 0 } ("&&" is a literal &), submenus too. */
    function withKeys(items) {
        return items.map((it) => {
            if (!it || it.separator) return it;
            const out = Object.assign({}, it);
            if (typeof it.text === 'string' && it.text.includes('&')) {
                let t = '';
                let key = -1;
                for (let i = 0; i < it.text.length; i += 1) {
                    const ch = it.text[i];
                    if (ch === '&' && i + 1 < it.text.length) {
                        if (it.text[i + 1] !== '&' && key < 0) key = t.length;
                        t += it.text[i + 1];
                        i += 1;
                    } else t += ch;
                }
                out.text = t;
                if (key >= 0) out.accessKey = key;
            }
            if (Array.isArray(it.submenu)) out.submenu = withKeys(it.submenu);
            return out;
        });
    }

    function openWeb(url) { if (typeof root.openGrimoireUrl === 'function') void root.openGrimoireUrl(url); }

    /** A recent file as Reader lists it: "C:\Workspaces\default\Report.pdf". */
    function recentLabel(r) {
        const f = r && r.file;
        if (!f) return (r && r.label) || '';
        return `C:${String(f.path || '').replace(/\/+$/, '').replace(/\//g, '\\')}\\${f.name}`;
    }

    function workspaceRoot() {
        const ws = (typeof activeWorkspace !== 'undefined' && activeWorkspace) ? activeWorkspace : 'Default'; // eslint-disable-line no-undef
        return `/Workspaces/${ws}`;
    }

    function guessMime(name) {
        const ext = (String(name).match(/\.([a-z0-9]+)$/i) || [])[1] || '';
        return ({ pdf: 'application/pdf', txt: 'text/plain', csv: 'text/csv', xml: 'text/xml', html: 'text/html', htm: 'text/html', png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', zip: 'application/zip', doc: 'application/msword', rtf: 'application/rtf', xps: 'application/vnd.ms-xpsdocument' })[ext.toLowerCase()] || 'application/octet-stream';
    }

    /** Save As on the computer (Melaton's own dialog), the bytes as a file there. */
    function saveBytesAs(w, bytes, name, mime, typeLabel) {
        if (typeof root.studioOpenFolderDialog !== 'function') return;
        const ext = (String(name).match(/\.[a-z0-9]+$/i) || [''])[0];
        void root.studioOpenFolderDialog('save', {
            owner: w.modal,
            startPath: (w.file && w.file.path) || workspaceRoot(),
            host: {
                title: 'Save As',
                typeLabel: typeLabel || `${ext.slice(1).toUpperCase() || 'All'} Files (*${ext || '.*'})`,
                acceptType: 'user-file',
                suggestName: () => name,
                async onSave(info) {
                    let n = String(info.name || '').trim();
                    if (!n) return false;
                    if (ext && !n.toLowerCase().endsWith(ext.toLowerCase())) n += ext;
                    try {
                        await vfs().uploadFile(info.path || '/', bytesToB64(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)), n, mime);
                        return true;
                    } catch (err) {
                        await w.message(`The document could not be saved. ${(err && err.message) || err}`);
                        return false;
                    }
                }
            }
        });
    }

    function arrange(how) {
        const list = Array.from(windows);
        const W = root.innerWidth;
        const H = root.innerHeight - 40;
        list.forEach((w, i) => {
            const m = w.modal;
            if (how === 'cascade') {
                m.style.width = `${Math.min(W - 40, 1000)}px`; m.style.height = `${Math.min(H - 40, 800)}px`;
                call('setModalOffsetsFromViewportTopLeft', m, 20 + i * 26, 10 + i * 26);
            } else if (how === 'h') {
                const h = Math.floor(H / list.length);
                m.style.width = `${W}px`; m.style.height = `${h}px`;
                call('setModalOffsetsFromViewportTopLeft', m, 0, i * h);
            } else {
                const ww = Math.floor(W / list.length);
                m.style.width = `${ww}px`; m.style.height = `${H}px`;
                call('setModalOffsetsFromViewportTopLeft', m, i * ww, 0);
            }
            w.relayout();
        });
    }

    // ---- About Adobe Reader 8 (ABOUT.PNG, AcroRd32.dll PNGF; the box is the picture, 580 x 278) ------

    function openAbout(w) {
        const old = doc.getElementById('adobeReaderAbout');
        if (old) { call('bringModalToFront', old); return; }
        const m = doc.createElement('div');
        m.id = 'adobeReaderAbout';
        m.className = 'modal hidden rdr-about';
        m.dataset.windowIdentifier = 'adobeReaderAbout';
        m.dataset.windowClient = 'none';
        m.dataset.taskbarIcon = ICON24;
        m.dataset.parentModalId = w.modal.id;
        // Copyright and publisher lines are Adobe's own (a third party's, kept as the original; Yukimi's call, #910)
        m.innerHTML = `<div class="modal-content rdr-about-box" role="dialog" aria-label="About Adobe Reader 8">
                <img class="rdr-about-art" src="${A}/about.png" alt="" draggable="false">
                <span class="rdr-about-version">Version 8.1.3</span>
                <button type="button" class="rdr-about-btn rdr-about-legal">Patent and Legal Notices</button>
                <button type="button" class="rdr-about-btn rdr-about-credits">Credits</button>
                <span class="rdr-about-copy">Copyright 1984-2008 Adobe Systems Incorporated and its licensors.<br>All rights reserved.</span>
            </div>`;
        doc.body.appendChild(m);
        call('openModal', m);
        m.classList.remove('hidden');
        const r = m.getBoundingClientRect();
        call('setModalOffsetsFromViewportTopLeft', m, Math.round((root.innerWidth - r.width) / 2), Math.round((root.innerHeight - 35 - r.height) / 2));
        const close = () => { Promise.resolve(call('closeModal', m)).then(() => m.remove()); };
        // a click anywhere but the buttons closes it, as Esc does (Reader 8)
        m.addEventListener('click', (ev) => { if (!ev.target.closest('.rdr-about-btn')) close(); });
        m.addEventListener('keydown', (ev) => { if (ev.key === 'Escape' || ev.key === 'Enter') close(); });
        m.querySelector('.rdr-about-legal').addEventListener('click', () => void w.message('Adobe Reader 8.1.3\nThis product contains software licensed from third parties. The patent and legal notices are in the Legal folder of the installation.', null, 'Patent and Legal Notices'));
        m.querySelector('.rdr-about-credits').addEventListener('click', () => void w.message('Adobe Reader 8.1.3\nPDF rendering in Melaton: PDF.js, Copyright Mozilla Foundation, Apache License 2.0.', null, 'Credits'));
        m.tabIndex = -1;
        m.focus();
    }

    // ---- Start Meeting (the toolbar's Start Meeting and File > Start Meeting...: Acrobat Connect's welcome) -------
    // The VM's window, client 519 x 508: a 100 px band (#f0f0f0 to #cccccc) with the 32 px Connect picture and the
    // title (Segoe UI Bold 17 px), the photo at 15, 132, the two framed offers (#d5dfe5 frames with a white inner
    // line, headings Segoe UI Bold 15 px), See Demo / Buy Now as links, Close. Acrobat Connect's pages open in the
    // browser, as Reader sent them there.

    const CONNECT_URL = 'https://www.adobe.com/products/adobeconnect.html';
    // Reader's Help menu sends these to the browser
    const WEB = {
        beyond: 'https://www.adobe.com/acrobat.html',
        support: 'https://helpx.adobe.com/support/reader.html',
        acrobat: 'https://www.adobe.com/acrobat/pricing.html',
        services: 'https://www.adobe.com/acrobat/online.html'
    };

    function openMeeting(w) {
        const D = root.vistaDialogTemplate;
        if (!D) return;
        const id = 'rdrMeeting';
        const old = doc.getElementById(id);
        if (old) { call('bringModalToFront', old); return; }
        const tpl = tplOf('Welcome to Start Meeting', 519, 508, [
            C.custom(100, 0, 0, 519, 470, 'ReaderMeeting'),
            C.btn(101, 180, 271, 133, 23, 'Create Trial Account'),
            C.btn(102, 180, 393, 75, 23, 'Log In'),
            C.btn(2, 429, 471, 75, 23, 'Close', true)
        ]);
        D.openDialog({
            id, tpl, owner: w.modal, bareCaption: true,
            init: (ctx) => {
                const host = ctx.el(100);
                if (host) {
                    host.classList.add('rdr-meet');
                    host.innerHTML = `
                        <div class="rdr-meet-band"><img src="${A}/meeting-header.png" alt="" draggable="false"><span>Start Meeting with Acrobat Connect</span></div>
                        <img class="rdr-meet-photo" src="${A}/meeting-photo.png" alt="" draggable="false">
                        <div class="rdr-meet-blurb">Use Acrobat Connect rich<br>web communication<br>system to share &amp; review<br>documents in real time<br>with your colleagues,<br>customers, and friends.</div>
                        <button type="button" class="tbp-link vdt-link rdr-meet-link" data-go="demo" style="top:411px">See Demo</button>
                        <button type="button" class="tbp-link vdt-link rdr-meet-link" data-go="buy" style="top:441px">Buy Now</button>
                        <div class="rdr-meet-box" style="top:132px;height:174px"><b>Sign up for a free trial</b><p style="top:34px">Start Meeting today with a free trial of Acrobat Connect.</p><p style="top:59px">Share presentations and collaborate with others<br>online with your own personal meeting room.<br>Anyone you invite can meet in your room without<br>downloading or installing any software.</p></div>
                        <div class="rdr-meet-box" style="top:333px;height:95px"><b>Already have an account?</b><p style="top:34px">Log in and start meeting.</p></div>`;
                    host.addEventListener('click', (ev) => { if (ev.target.closest('[data-go]')) openWeb(CONNECT_URL); });
                }
                ctx.on(101, 'click', () => openWeb(CONNECT_URL));
                ctx.on(102, 'click', () => openWeb(CONNECT_URL));
            }
        });
    }

    // ---- Document Properties (Description, Security, Fonts, Advanced) -----------------------------------

    async function openProperties(w) {
        const D = root.vistaDialogTemplate;
        if (!D) return;
        const info = (w.meta && w.meta.info) || {};
        const xmpTitle = w.meta && w.meta.metadata ? w.meta.metadata.get('dc:title') : '';
        const first = w.pages[0];
        const inch = (pt) => (pt / 72).toFixed(2);
        const size = w.size || (await w.bytes().then((b) => b.length).catch(() => 0));
        const perms = await w.pdf.getPermissions().catch(() => null);
        const fonts = await collectFonts(w);
        const P = (x, y, wd, h, t, id, right) => C.st(id, x, y, wd, h, t, right);
        const desc = tplOf('Description', 584, 540, [
            C.grp(100, 6, 5, 572, 330, 'Description'),
            P(14, 30, 71, 15, 'File:', 101, true), P(97, 30, 470, 15, w.name.replace(/\.pdf$/i, ''), 102),
            P(14, 61, 71, 15, 'Title:', 103, true), C.edit(104, 97, 57, 467, 23, info.Title || xmpTitle || '', true),
            P(14, 97, 71, 15, 'Author:', 105, true), C.edit(106, 97, 93, 467, 23, info.Author || '', true),
            P(14, 133, 71, 15, 'Subject:', 107, true), C.edit(108, 97, 129, 467, 23, info.Subject || '', true),
            P(14, 166, 71, 15, 'Keywords:', 109, true), C.memo(110, 97, 165, 467, 75, info.Keywords || ''),
            P(14, 254, 71, 15, 'Created:', 111, true), P(97, 254, 300, 15, fmtPdfDate(info.CreationDate), 112),
            P(14, 281, 71, 15, 'Modified:', 113, true), P(97, 281, 300, 15, fmtPdfDate(info.ModDate), 114),
            P(14, 308, 71, 15, 'Application:', 115, true), P(97, 308, 460, 15, info.Creator || '', 116),
            C.grp(120, 6, 345, 572, 188, 'Advanced'),
            P(14, 373, 82, 15, 'PDF Producer:', 121, true), P(108, 373, 460, 15, info.Producer || '', 122),
            P(14, 400, 82, 15, 'PDF Version:', 123, true), P(108, 400, 300, 15, pdfVersionLabel(info.PDFFormatVersion), 124),
            P(14, 427, 82, 15, 'Location:', 125, true), P(108, 427, 460, 15, locationLabel(w), 126),
            P(14, 454, 82, 15, 'File Size:', 127, true), P(108, 454, 300, 15, size ? fmtBytes(size) : '', 128),
            P(14, 481, 82, 15, 'Page Size:', 129, true), P(108, 481, 180, 15, first ? `${inch(first.w)} x ${inch(first.h)} in` : '', 130),
            P(300, 481, 113, 15, 'Number of Pages:', 131, true), P(425, 481, 100, 15, String(w.pages.length), 132),
            P(14, 508, 82, 15, 'Tagged PDF:', 133, true), P(108, 508, 100, 15, info.IsTagged || (w.meta && w.meta.info && w.meta.info.Marked) ? 'Yes' : 'No', 134),
            P(300, 508, 113, 15, 'Fast Web View:', 135, true), P(425, 508, 100, 15, info.IsLinearized ? 'Yes' : 'No', 136)
        ]);
        const allowed = (flag) => (!perms || perms.includes(flag) ? 'Allowed' : 'Not Allowed');
        const PF = (w.lib && w.lib.PermissionFlag) || {};
        const rows = [['Printing:', allowed(PF.PRINT)], ['Changing the Document:', allowed(PF.MODIFY_CONTENTS)], ['Document Assembly:', allowed(PF.ASSEMBLE)],
            ['Content Copying:', allowed(PF.COPY)], ['Content Copying for Accessibility:', allowed(PF.COPY_FOR_ACCESSIBILITY)], ['Page Extraction:', allowed(PF.ASSEMBLE)],
            ['Commenting:', allowed(PF.MODIFY_ANNOTATIONS)], ['Filling of form fields:', allowed(PF.FILL_INTERACTIVE_FORMS)], ['Signing:', allowed(PF.MODIFY_ANNOTATIONS)],
            ['Creation of Template Pages:', allowed(PF.MODIFY_CONTENTS)]];
        const sec = tplOf('Security', 584, 540, [
            C.grp(200, 6, 5, 572, 120, 'Document Security'),
            P(16, 28, 550, 30, `The document's Security Method restricts what can be done to the document. To remove security restrictions, set the Security Method to No Security.`, 201),
            P(16, 70, 120, 15, 'Security Method:', 202), C.combo(203, 140, 66, 200, ''),
            P(16, 98, 120, 15, 'Can be Opened by:', 204), P(140, 98, 300, 15, perms ? 'Acrobat 5.0 and later' : 'All versions of Acrobat', 205),
            C.grp(210, 6, 135, 572, 300, 'Document Restrictions Summary'),
            ...rows.flatMap(([k, v], i) => [P(16, 160 + i * 24, 260, 15, k, 211 + i * 2, true), P(290, 160 + i * 24, 200, 15, v, 212 + i * 2)])
        ]);
        const fnt = tplOf('Fonts', 584, 540, [
            C.grp(300, 6, 5, 572, 525, 'Fonts Used in this Document'),
            C.custom(301, 16, 28, 552, 490, 'SysTreeView32')
        ]);
        const adv = tplOf('Advanced', 584, 540, [
            C.grp(400, 6, 5, 572, 120, 'PDF Settings'),
            P(16, 30, 110, 15, 'Base URL:', 401, true), C.edit(402, 138, 26, 420, 23, '', true),
            P(16, 62, 110, 15, 'Search Index:', 403, true), C.edit(404, 138, 58, 420, 23, '', true),
            P(16, 94, 110, 15, 'Trapped:', 405, true), P(138, 94, 200, 15, info.Trapped && info.Trapped.name ? info.Trapped.name : 'Unknown', 406),
            C.grp(410, 6, 135, 572, 150, 'Print Dialog Presets'),
            P(16, 160, 110, 15, 'Page Scaling:', 411, true), P(138, 160, 200, 15, 'Default', 412),
            P(16, 186, 110, 15, 'DuplexMode:', 413, true), P(138, 186, 200, 15, 'Simplex', 414),
            P(16, 212, 110, 15, 'Paper Source:', 415, true), P(138, 212, 200, 15, 'No', 416),
            P(16, 238, 110, 15, 'Print Page Range:', 417, true), P(138, 238, 200, 15, '', 418),
            P(16, 264, 110, 15, 'Number of Copies:', 419, true), P(138, 264, 200, 15, 'Default', 420),
            C.grp(430, 6, 295, 572, 90, 'Reading Options'),
            P(16, 320, 110, 15, 'Binding:', 431, true), P(138, 320, 200, 15, 'Left Edge', 432),
            P(16, 346, 110, 15, 'Language:', 433, true), P(138, 346, 200, 15, (w.meta && w.meta.info && w.meta.info.Language) || '', 434)
        ]);
        D.openSheet({
            id: `rdrProps${w.n}`, title: 'Document Properties', owner: w.modal, noApply: true, bareCaption: true,
            pages: [{ key: 'rdr:desc', title: 'Description', tpl: desc }, { key: 'rdr:sec', title: 'Security', tpl: sec }, { key: 'rdr:fonts', title: 'Fonts', tpl: fnt }, { key: 'rdr:adv', title: 'Advanced', tpl: adv }],
            init: (ctx) => {
                ctx.options(203, [perms ? 'Password Security' : 'No Security'], perms ? 'Password Security' : 'No Security');
                const e = ctx.el(203);
                if (e) e.disabled = true;
                const tree = ctx.content.querySelector('[data-vdt-id="301"]');
                if (tree) {
                    tree.classList.add('rdr-fonts-tree');
                    tree.innerHTML = fonts.length ? fonts.map((f) => `<div class="rdr-font"><b>${esc(f.name)}</b><div>Type: ${esc(f.type)}</div><div>Encoding: ${esc(f.encoding)}</div></div>`).join('') : '<div class="rdr-font">No fonts are used in the pages read so far.</div>';
                }
            }
        });
    }

    function pdfVersionLabel(v) {
        const n = Number(v);
        const acro = { 1.2: '3.x', 1.3: '4.x', 1.4: '5.x', 1.5: '6.x', 1.6: '7.x', 1.7: '8.x' }[v] || (n >= 1.7 ? '8.x' : '');
        return v ? `${v}${acro ? ` (Acrobat ${acro})` : ''}` : '';
    }

    function locationLabel(w) {
        if (w.file) return `C:${String(w.file.path || '/').replace(/\/+$/, '').replace(/\//g, '\\')}\\`;
        return w.location || '';
    }

    async function collectFonts(w) {
        const seen = new Map();
        for (const p of w.pages) {
            if (!p.proxy || !p.rendered) continue;
            try {
                const tc = await p.proxy.getTextContent();
                Object.keys(tc.styles || {}).forEach((key) => {
                    if (seen.has(key)) return;
                    let f = null;
                    try { f = p.proxy.commonObjs.has(key) ? p.proxy.commonObjs.get(key) : null; } catch (_) { f = null; }
                    const name = (f && f.name) || tc.styles[key].fontFamily;
                    const type = f && f.isType3Font ? 'Type 3' : f && /TrueType|OpenType/i.test(f.mimetype || '') ? 'TrueType' : 'Type 1';
                    seen.set(key, { name: String(name).replace(/^[A-Z]{6}\+/, ''), type, encoding: 'Custom' });
                });
            } catch (_) { /* skip */ }
        }
        const out = new Map();
        seen.forEach((f) => { if (!out.has(f.name)) out.set(f.name, f); });
        return Array.from(out.values());
    }

    // ---- Preferences (Documents, General, Page Display) --------------------------------------------

    const CATEGORIES = ['Documents', 'Full Screen', 'General', 'Page Display', '-', '3D', 'Accessibility', 'Forms', 'Identity', 'International', 'Internet', 'JavaScript', 'Measuring (2D)', 'Measuring (3D)', 'Meeting', 'Multimedia', 'Multimedia Trust', 'Online Services', 'Reading', 'Reviewing', 'Search', 'Security', 'Spelling', 'Trust Manager', 'Units'];

    function openPreferences(w) {
        const D = root.vistaDialogTemplate;
        if (!D) return;
        const page = (base, ctrls) => ctrls.map((c) => { c[0] += base; return c; });
        const docs = page(1000, [
            C.grp(0, 148, 13, 576, 213, 'Open Settings'),
            C.chk(1, 165, 39, 520, 'Show each document in its own window (requires restart)'),
            C.chk(2, 165, 63, 520, 'Restore last view settings when reopening documents'),
            C.chk(3, 165, 85, 520, 'Open cross-document links in same window'),
            C.chk(4, 165, 109, 520, 'Allow layer state to be set by user information'),
            C.chk(5, 165, 131, 520, 'Allow documents to hide the menu bar, toolbars, and window controls'),
            C.st(6, 190, 167, 185, 15, 'Documents in recently used list:', true),
            C.edit(7, 387, 162, 38, 23, '5'),
            C.grp(10, 148, 244, 576, 91, 'Save Settings'),
            C.chk(11, 165, 274, 370, 'Automatically save document changes to temporary file every:'),
            C.edit(12, 537, 269, 30, 23, '5'),
            C.st(13, 573, 274, 100, 15, 'minutes (1-99)'),
            C.chk(14, 165, 307, 400, 'Save As optimizes for Fast Web View')
        ]);
        const gen = page(2000, [
            C.grp(0, 145, 13, 582, 210, 'Basic Tools'),
            C.chk(1, 161, 39, 400, 'Use single-key accelerators to access tools'),
            C.chk(2, 161, 63, 400, 'Create links from URLs'),
            C.chk(3, 161, 85, 400, 'Make Hand tool select text'),
            C.chk(4, 161, 109, 400, 'Make Hand tool read articles'),
            C.chk(5, 161, 131, 400, 'Make Hand tool use mouse-wheel zooming'),
            C.chk(6, 161, 155, 400, 'Make Select tool select images before text'),
            C.chk(7, 161, 188, 280, 'Use fixed resolution for Snapshot tool images:'),
            C.edit(8, 445, 183, 38, 23, '72'),
            C.st(9, 501, 188, 80, 15, 'pixels/inch'),
            C.grp(10, 145, 231, 582, 65, 'Warnings'),
            C.chk(11, 161, 258, 300, 'Do not show edit warnings'),
            C.btn(12, 586, 252, 115, 25, 'Reset All Warnings'),
            C.grp(20, 145, 306, 582, 76, 'Print'),
            C.chk(21, 161, 334, 300, 'Show page thumbnails in Print dialog'),
            C.grp(30, 145, 396, 582, 82, 'Application Startup'),
            C.chk(31, 161, 423, 300, 'Show splash screen'),
            C.chk(32, 161, 454, 170, 'Use only certified plug-ins'),
            C.st(33, 341, 454, 150, 15, 'Currently in Certified Mode:'),
            C.st(34, 500, 454, 40, 15, 'Yes')
        ]);
        const disp = page(3000, [
            C.grp(0, 147, 10, 582, 95, 'Default Layout and Zoom'),
            C.st(1, 150, 41, 80, 15, 'Page Layout:', true), C.combo(2, 242, 37, 152, ''),
            C.st(3, 150, 77, 80, 15, 'Zoom:', true), C.combo(4, 242, 73, 160, ''),
            C.grp(10, 147, 119, 582, 90, 'Resolution'),
            C.rad(11, 162, 141, 130, 'Use system setting:', true), C.st(12, 305, 141, 25, 15, '96'), C.st(13, 336, 141, 80, 15, 'pixels/inch'),
            C.rad(14, 162, 178, 130, 'Custom resolution:'), C.edit(15, 306, 173, 38, 23, '96'), C.st(16, 374, 178, 80, 15, 'pixels/inch'),
            C.grp(20, 147, 222, 582, 180, 'Rendering'),
            C.st(21, 150, 253, 82, 15, 'Smooth Text:', true), C.combo(22, 244, 249, 152, ''),
            C.chk(23, 162, 286, 115, 'Smooth line art'), C.chk(24, 286, 286, 115, 'Smooth images'),
            C.chk(25, 162, 316, 200, 'Use local fonts'),
            C.chk(26, 162, 346, 200, 'Use page cache'),
            C.grp(30, 147, 386, 582, 147, 'Page Content and Information'),
            C.chk(31, 162, 413, 130, 'Show large images'), C.chk(32, 305, 413, 140, 'Overprint Preview'),
            C.chk(33, 162, 443, 180, 'Show art, trim, && bleed boxes'), C.chk(34, 350, 443, 160, 'Show transparency grid'),
            C.chk(35, 162, 473, 170, 'Use logical page numbers'), C.chk(36, 341, 473, 210, 'Always show document page size'),
            C.chk(37, 162, 503, 150, 'Use smooth zooming'), C.chk(38, 318, 503, 150, 'Use smooth scrolling')
        ]);
        const tpl = tplOf('Preferences', 733, 619, [
            C.st(1, 11, 16, 80, 15, 'Categories:'),
            C.custom(2, 11, 36, 122, 531),
            ...docs, ...gen, ...disp,
            C.btn(1, 554, 581, 75, 25, 'OK', true),
            C.btn(2, 644, 581, 75, 25, 'Cancel')
        ]);
        const pages = { Documents: 1000, General: 2000, 'Page Display': 3000 };
        const layouts = [['auto', 'Automatic'], ['single', 'Single Page'], ['continuous', 'Single Page Continuous'], ['twoup', 'Two-Up'], ['twoupcont', 'Two-Up Continuous']];
        const zooms = [['auto', 'Automatic'], ['page', 'Fit Page'], ['width', 'Fit Width'], ['height', 'Fit Height'], ['visible', 'Fit Visible']].concat(ZOOMS.map((z) => [String(z), fmtZoom(z)]));
        const B = { 1001: ['OwnWindow', true], 1002: ['RestoreView', false], 1003: ['CrossDocSame', true], 1004: ['LayerState', true], 1005: ['AllowHide', true], 1011: ['AutoSave', true], 1014: ['FastWebView', true],
            2001: ['SingleKey', false], 2002: ['LinksFromUrls', true], 2003: ['HandSelects', false], 2004: ['HandArticles', true], 2005: ['HandWheelZoom', false], 2006: ['SelectImages', false], 2007: ['SnapshotFixed', false], 2011: ['NoEditWarnings', false], 2021: ['PrintThumbs', true], 2031: ['ShowSplash', false], 2032: ['CertifiedOnly', false],
            3023: ['SmoothLineArt', true], 3024: ['SmoothImages', true], 3025: ['LocalFonts', true], 3026: ['PageCache', true], 3031: ['LargeImages', true], 3032: ['Overprint', false], 3033: ['ArtBoxes', false], 3034: ['TransparencyGrid', false], 3035: ['LogicalNumbers', true], 3036: ['ShowPageSize', false], 3037: ['SmoothZoom', false], 3038: ['SmoothScroll', false] };
        let current = reg('PrefsCategory', 'Page Display');
        D.openDialog({
            id: 'rdrPreferences', tpl, owner: w.modal, bareCaption: true,
            overrides: { 1007: { spin: [1, 10] }, 1012: { spin: [1, 99] }, 2008: { spin: [36, 600] }, 3015: { spin: [36, 600] } },
            init: (ctx) => {
                const all = ctx.content.querySelectorAll('[data-vdt-id]');
                const show = (cat) => {
                    current = cat;
                    const base = pages[cat] || -1;
                    all.forEach((el) => {
                        const id = Number(el.dataset.vdtId);
                        if (id >= 1000) el.hidden = Math.floor(id / 1000) * 1000 !== base;
                    });
                    list.querySelectorAll('.rdr-cat').forEach((c) => c.classList.toggle('is-sel', c.dataset.cat === cat));
                };
                const list = ctx.content.querySelector('[data-vdt-id="2"]');
                list.classList.add('rdr-cats');
                list.tabIndex = 0;
                list.innerHTML = CATEGORIES.map((c) => (c === '-' ? '<div class="rdr-cat-sep"></div>' : `<div class="rdr-cat" data-cat="${esc(c)}">${esc(c)}</div>`)).join('');
                list.addEventListener('click', (ev) => { const c = ev.target.closest('.rdr-cat'); if (c) show(c.dataset.cat); });
                Object.entries(B).forEach(([id, [k, d]]) => ctx.set(Number(id), !!reg(k, d)));
                ctx.set(1007, String(reg('RecentCount', 5)));
                ctx.set(1012, String(reg('AutoSaveMinutes', 5)));
                ctx.options(3002, layouts.map(([value, text]) => ({ value, text })), reg('PageLayout', 'auto'));
                ctx.options(3004, zooms.map(([value, text]) => ({ value, text })), String(reg('DefaultZoom', 'auto')));
                ctx.options(3022, ['For Monitor', 'For Laptop/LCD screens', 'None'], reg('SmoothText', 'For Monitor'));
                const custom = reg('ResolutionMode', 'custom') === 'custom';
                ctx.set(custom ? 3014 : 3011, true);
                ctx.set(3015, String(reg('Resolution', 110)));
                const e2008 = ctx.el(2008); if (e2008) e2008.disabled = true;
                const sync = () => { const e = ctx.el(3015); if (e) e.disabled = !ctx.get(3014); };
                ctx.on(3011, 'change', sync); ctx.on(3014, 'change', sync); sync();
                ctx.on(2012, 'click', () => void w.message('All warnings have been reset.'));
                show(pages[current] ? current : 'Page Display');
            },
            ok: (ctx) => {
                const v = {};
                Object.entries(B).forEach(([id, [k]]) => { v[k] = !!ctx.get(Number(id)); });
                v.RecentCount = Math.max(1, Math.min(10, parseInt(ctx.get(1007), 10) || 5));
                v.AutoSaveMinutes = Math.max(1, Math.min(99, parseInt(ctx.get(1012), 10) || 5));
                v.PageLayout = String(ctx.get(3002) || 'auto');
                v.DefaultZoom = String(ctx.get(3004) || 'auto');
                v.SmoothText = String(ctx.get(3022) || 'For Monitor');
                v.ResolutionMode = ctx.get(3014) ? 'custom' : 'system';
                v.Resolution = Math.max(36, Math.min(600, parseInt(ctx.get(3015), 10) || 110));
                v.PrefsCategory = current;
                setReg(v);
                windows.forEach((x) => x.relayout());
            }
        });
    }

    // ---- Print (Reader 8's dialog; Melaton's printers) -------------------------------------------

    const PRINTERS = [
        { value: 'fax', text: 'Fax', type: 'Xyridian Shared Fax Driver' },
        { value: 'xps', text: 'Xyridian XPS Document Writer', type: 'Xyridian XPS Document Writer' },
        { value: 'browser', text: 'Print with this browser', type: 'Browser print dialog' }
    ];

    function openPrint(w, opts) {
        const D = root.vistaDialogTemplate;
        if (!D) return;
        const n = w.pages.length;
        const tpl = tplOf('Print', 560, 505, [
            C.grp(10, 4, 8, 505, 78, 'Printer'),
            C.st(11, 15, 24, 45, 15, 'Name:'), C.combo(12, 64, 20, 227, ''),
            C.st(13, 15, 47, 45, 15, 'Status:'), C.st(14, 64, 47, 220, 15, 'Ready'),
            C.st(15, 15, 64, 45, 15, 'Type:'), C.st(16, 64, 64, 230, 15, ''),
            [17, 'B', dx(310), dy(17), dx(88), dy(23), V | TAB | 0x08000000, '&Properties', 0],
            C.st(18, 305, 42, 150, 15, 'Comments and Forms:'), C.combo(19, 306, 58, 203, ''),
            C.grp(20, 4, 91, 286, 150, 'Print Range'),
            C.rad(21, 19, 107, 120, '&All', true),
            [22, 'B', dx(19), dy(128), dx(120), dy(15), V | TAB | 9 | 0x08000000, 'Current &view', 0],
            C.rad(23, 19, 149, 120, 'Current pa&ge'),
            C.rad(24, 19, 170, 50, 'Pa&ges'), C.edit(25, 67, 165, 222, 22, n > 1 ? `1 - ${n}` : '1'),
            C.st(26, 14, 193, 50, 15, 'Su&bset:'), C.combo(27, 66, 187, 150, ''),
            C.chk(28, 19, 219, 150, '&Reverse pages'),
            C.grp(30, 4, 237, 286, 150, 'Page Handling'),
            C.st(31, 14, 256, 60, 15, '&Copies:'), C.edit(32, 82, 251, 46, 22, '1'),
            [33, 'B', dx(155), dy(257), dx(100), dy(15), V | TAB | 3 | 0x08000000, 'Co&llate', 0],
            C.st(34, 14, 286, 85, 15, 'Page &Scaling:'), C.combo(35, 100, 281, 185, ''),
            C.chk(36, 26, 315, 200, 'Auto-&Rotate and Center'),
            C.chk(37, 26, 347, 250, 'Choose Paper Source by PDF page size'),
            C.chk(38, 6, 396, 120, 'Print to &file'),
            C.grp(40, 298, 91, 247, 373, 'Preview: Composite'),
            C.custom(41, 306, 108, 232, 320),
            C.st(43, 306, 434, 90, 15, `1/${n} (1)`),
            [42, 'msctls_trackbar32', dx(400), dy(430), dx(140), dy(24), V | TAB, '', 0],
            C.btn(50, 3, 477, 72, 23, 'Printing &Tips'),
            C.btn(51, 83, 477, 70, 23, 'Ad&vanced'),
            C.btn(1, 344, 474, 75, 23, 'OK', true),
            C.btn(2, 424, 474, 70, 23, 'Cancel')
        ]);
        const def = root.melatonRegistry ? root.melatonRegistry.get(PRINTKEY, 'Device', 'xps') : 'xps';
        D.openDialog({
            id: `rdrPrint${w.n}`, tpl, owner: w.modal, bareCaption: true,
            overrides: { 32: { spin: [1, 999] } },
            init: (ctx) => {
                ctx.options(12, PRINTERS.map(({ value, text }) => ({ value, text })), PRINTERS.some((p) => p.value === def) ? def : 'xps');
                const showPrinter = () => { const p = PRINTERS.find((x) => x.value === ctx.get(12)) || PRINTERS[1]; ctx.text(16, p.type); };
                showPrinter();
                ctx.on(12, 'change', showPrinter);
                ctx.options(19, ['Document and Markups', 'Document', 'Document and Stamps', 'Form fields only'], 'Document and Markups');
                ctx.options(27, ['All pages in range', 'Odd pages only', 'Even pages only'], 'All pages in range');
                ctx.options(35, ['None', 'Fit to Printable Area', 'Shrink to Printable Area', 'Tile Large Pages', 'Tile All Pages', 'Multiple pages per sheet', 'Booklet Printing'], 'Shrink to Printable Area');
                ctx.set(36, true);
                if (opts.pages) { ctx.set(24, true); ctx.set(25, opts.pages.join(', ')); } else ctx.set(21, true);
                ctx.on(25, 'focus', () => ctx.set(24, true));
                const holder = ctx.content.querySelector('[data-vdt-id="41"]');
                holder.classList.add('rdr-print-preview');
                const d = w.pages[w.current - 1] ? w.dims(w.pages[w.current - 1]) : { w: 612, h: 792 };
                holder.innerHTML = `<div class="rdr-pp-w"><span>${(d.w / 72).toFixed(1).replace(/\.0$/, '')}</span></div><div class="rdr-pp-h"><span>${(d.h / 72).toFixed(1).replace(/\.0$/, '')}</span></div><div class="rdr-pp-sheet"></div><div class="rdr-pp-units">Units: Inches</div><div class="rdr-pp-zoom">Zoom: 100%</div>`;
                const sheet = holder.querySelector('.rdr-pp-sheet');
                // the page slider: Vista's trackbar (the template's msctls_trackbar32), one stop per page
                const slider = ctx.el(42);
                if (slider) { slider.min = '1'; slider.max = String(n); slider.value = '1'; }
                const draw = async () => {
                    const k = Math.max(1, Math.min(n, Number(slider ? slider.value : 1) || 1));
                    ctx.text(43, `${k}/${n} (${k})`);
                    const p = w.pages[k - 1];
                    const proxy = p.proxy || (p.proxy = await w.pdf.getPage(k));
                    const rot = ((proxy.rotate || 0) + w.rotation) % 360;
                    const base = proxy.getViewport({ scale: 1, rotation: rot });
                    const sc = Math.min(195 / base.width, 253 / base.height);
                    const vp = proxy.getViewport({ scale: sc * 2, rotation: rot });
                    const c = doc.createElement('canvas');
                    c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
                    c.style.width = `${Math.floor(vp.width / 2)}px`; c.style.height = `${Math.floor(vp.height / 2)}px`;
                    await proxy.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
                    sheet.innerHTML = '';
                    sheet.appendChild(c);
                };
                if (slider) slider.addEventListener('input', () => void draw());
                void draw();
                ctx.on(50, 'click', () => void w.message('Printing Tips are on the Adobe website, which this computer cannot reach.'));
                ctx.on(51, 'click', () => void w.message('Advanced Print Setup has no settings for this printer.'));
            },
            ok: async (ctx) => {
                let list = [];
                if (ctx.get(23)) list = [w.current];
                else if (ctx.get(24)) list = parseRange(String(ctx.get(25) || ''), n);
                else list = w.pages.map((p) => p.n);
                const subset = ctx.get(27);
                if (subset === 'Odd pages only') list = list.filter((x) => x % 2 === 1);
                if (subset === 'Even pages only') list = list.filter((x) => x % 2 === 0);
                if (ctx.get(28)) list.reverse();
                if (!list.length) { await w.message('There are no pages in the range you specified.'); return false; }
                const copies = Math.max(1, Math.min(999, parseInt(ctx.get(32), 10) || 1));
                const printer = String(ctx.get(12) || 'xps');
                if (root.melatonRegistry) void root.melatonRegistry.set(PRINTKEY, { Device: printer });
                setTimeout(() => void printPages(w, printer, list, copies, !!ctx.get(38)), 0);
                return true;
            }
        });
    }

    function parseRange(s, n) {
        const out = [];
        s.split(/[,;]/).forEach((part) => {
            const m = /^\s*(\d+)\s*(?:-\s*(\d+))?\s*$/.exec(part);
            if (!m) return;
            const a = Math.max(1, +m[1]); const b = Math.min(n, m[2] ? +m[2] : +m[1]);
            for (let i = a; i <= b; i += 1) out.push(i);
        });
        return out;
    }

    /** Pages as pictures at the printer's resolution (150 dpi), one at a time. */
    async function pagePictures(w, list, dpi, each) {
        for (const k of list) {
            const p = w.pages[k - 1];
            const proxy = p.proxy || (p.proxy = await w.pdf.getPage(k));
            const rot = ((proxy.rotate || 0) + w.rotation) % 360;
            const vp = proxy.getViewport({ scale: dpi / 72, rotation: rot });
            const c = doc.createElement('canvas');
            c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
            await proxy.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp, intent: 'print' }).promise;
            const blob = await new Promise((r) => c.toBlob(r, 'image/png'));
            c.width = 0;
            await each(blob, vp.width / (dpi / 72), vp.height / (dpi / 72));
        }
    }

    async function printPages(w, printer, list, copies, toFile) {
        if (printer === 'fax') { await w.message('Fax could not print the document. A fax modem is not installed on this computer.', null, 'Fax'); return; }
        if (printer === 'browser') {
            const f = doc.createElement('iframe');
            f.style.cssText = 'position:fixed;left:-10000px;width:900px;height:700px;border:0';
            doc.body.appendChild(f);
            const urls = [];
            const imgs = [];
            await pagePictures(w, list, 150, async (blob, pw, ph) => { const u = URL.createObjectURL(blob); urls.push(u); for (let c = 0; c < copies; c += 1) imgs.push(`<img src="${u}" style="width:${pw / 72}in;height:${ph / 72}in">`); });
            const fd = f.contentWindow.document;
            fd.open();
            fd.write(`<!doctype html><html><head><meta charset="utf-8"><title>${esc(w.name)}</title><style>@page{margin:0}body{margin:0}img{display:block;page-break-after:always;margin:0 auto}</style></head><body>${imgs.join('')}</body></html>`);
            fd.close();
            setTimeout(() => { try { f.contentWindow.focus(); f.contentWindow.print(); } catch (_) { /* no printing */ } setTimeout(() => { f.remove(); urls.forEach((u) => URL.revokeObjectURL(u)); }, 2000); }, 400);
            return;
        }
        // Xyridian XPS Document Writer: "Save the file as", an .xps of the pages (an image per page, as a
        // raster print through the writer comes out)
        const files = [];
        const pagesXml = [];
        let i = 0;
        await pagePictures(w, list, 150, async (blob, pw, ph) => {
            for (let c = 0; c < copies; c += 1) {
                i += 1;
                const W = (pw / 72) * 96; const H = (ph / 72) * 96;
                if (c === 0) files.push({ name: `Documents/1/Resources/Images/${i}.png`, data: new Uint8Array(await blob.arrayBuffer()) });
                const img = c === 0 ? i : i - c;
                files.push({ name: `Documents/1/Pages/${i}.fpage`, data: `<FixedPage Width="${W.toFixed(2)}" Height="${H.toFixed(2)}" xmlns="http://schemas.microsoft.com/xps/2005/06" xml:lang="und"><Path Data="M 0,0 L ${W.toFixed(2)},0 ${W.toFixed(2)},${H.toFixed(2)} 0,${H.toFixed(2)} z"><Path.Fill><ImageBrush ImageSource="/Documents/1/Resources/Images/${img}.png" Viewbox="0,0,${W.toFixed(2)},${H.toFixed(2)}" ViewboxUnits="Absolute" Viewport="0,0,${W.toFixed(2)},${H.toFixed(2)}" ViewportUnits="Absolute" TileMode="None" /></Path.Fill></Path></FixedPage>` });
                files.push({ name: `Documents/1/Pages/_rels/${i}.fpage.rels`, data: `<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/xps/2005/06/required-resource" Target="/Documents/1/Resources/Images/${img}.png" Id="R0" /></Relationships>` });
                pagesXml.push(`<PageContent Source="Pages/${i}.fpage" />`);
            }
        });
        files.unshift(
            { name: '[Content_Types].xml', data: '<?xml version="1.0" encoding="UTF-8"?><Types xmlns="http://schemas.openxmlformats.org/package/2006/content-types"><Default Extension="fdseq" ContentType="application/vnd.ms-package.xps-fixeddocumentsequence+xml" /><Default Extension="fdoc" ContentType="application/vnd.ms-package.xps-fixeddocument+xml" /><Default Extension="fpage" ContentType="application/vnd.ms-package.xps-fixedpage+xml" /><Default Extension="png" ContentType="image/png" /><Default Extension="rels" ContentType="application/vnd.openxmlformats-package.relationships+xml" /></Types>' },
            { name: '_rels/.rels', data: '<?xml version="1.0" encoding="UTF-8"?><Relationships xmlns="http://schemas.openxmlformats.org/package/2006/relationships"><Relationship Type="http://schemas.microsoft.com/xps/2005/06/fixedrepresentation" Target="/FixedDocSeq.fdseq" Id="R0" /></Relationships>' },
            { name: 'FixedDocSeq.fdseq', data: '<FixedDocumentSequence xmlns="http://schemas.microsoft.com/xps/2005/06"><DocumentReference Source="Documents/1/FixedDoc.fdoc" /></FixedDocumentSequence>' }
        );
        files.push({ name: 'Documents/1/FixedDoc.fdoc', data: `<FixedDocument xmlns="http://schemas.microsoft.com/xps/2005/06">${pagesXml.join('')}</FixedDocument>` });
        const blob = zipStore(files);
        const bytes = new Uint8Array(await blob.arrayBuffer());
        void toFile;
        saveBytesAs(w, bytes, w.name.replace(/\.pdf$/i, '') + '.xps', 'application/vnd.ms-xpsdocument', 'XPS Document (*.xps)');
    }

    // ---- Search (Edit > Search: a window of its own) ----------------------------------------------

    function openSearch(w) {
        const id = 'adobeReaderSearch';
        let m = doc.getElementById(id);
        if (m) { m._owner = w; call('bringModalToFront', m); return; }
        m = doc.createElement('div');
        m.id = id;
        m.className = 'modal hidden resizeable-window rdr-search-window';
        m.dataset.windowIdentifier = 'adobeReaderSearch';
        m.dataset.windowClient = 'light';
        m.dataset.taskbarIcon = ICON24;
        m.dataset.windowDefaultWidth = '482';
        m.dataset.windowDefaultHeight = String(Math.min(root.innerHeight - 60, 760));
        m.dataset.windowMinWidth = '300';
        m.dataset.windowMinHeight = '300';
        m.style.width = '482px';
        m.style.height = `${Math.min(root.innerHeight - 60, 760)}px`;
        m.innerHTML = `
            <div class="modal-window-title"><div class="modal-window-title-main"><img class="icon-image" src="${ICON16}" alt=""><span>Search</span></div></div>
            <div class="modal-focus-overlay"></div>
            <div class="modal-window-controls">
                <button type="button" class="btn-secondary minimize-btn btn-small" title="Minimize"><i class="fa-regular fa-window-minimize"></i></button>
                <button type="button" class="btn-danger close-btn btn-small rdr-search-close" title="Close"><i class="fa-regular fa-xmark-large"></i></button>
            </div>
            <div class="modal-content win7 rdr-search">
                <button type="button" class="rdr-arrange"><img src="${A}/arrange.png" alt="">Arrange Windows</button>
                <div class="rdr-s-form">
                    <label class="rdr-s-label">What word or phrase would you like to search for?</label>
                    <input type="text" class="tbp-edit rdr-s-q" spellcheck="false" autocomplete="off">
                    <div class="rdr-s-label">Where would you like to search?</div>
                    <label class="rdr-s-opt"><input type="radio" name="rdrSearchWhere" checked> In the current PDF document</label>
                    <label class="rdr-s-opt"><input type="radio" name="rdrSearchWhere" disabled> All PDF Documents in</label>
                    <select class="vdt-select rdr-s-folder"><option>Documents</option></select>
                    <label class="rdr-s-chk"><input type="checkbox" class="rdr-s-whole"> Whole words only</label>
                    <label class="rdr-s-chk"><input type="checkbox" class="rdr-s-case"> Case-Sensitive</label>
                    <label class="rdr-s-chk"><input type="checkbox" class="rdr-s-bm"> Include Bookmarks</label>
                    <label class="rdr-s-chk"><input type="checkbox" class="rdr-s-cm"> Include Comments</label>
                    <button type="button" class="tbp-button rdr-s-go" disabled>Search</button>
                </div>
                <div class="rdr-s-results" hidden>
                    <div class="rdr-s-label">Looking For:</div>
                    <div class="rdr-s-bold rdr-s-looking"></div>
                    <div class="rdr-s-label">Results:</div>
                    <div class="rdr-s-bold rdr-s-count"></div>
                    <button type="button" class="tbp-button rdr-s-new">New Search</button>
                    <div class="rdr-s-label">Results:</div>
                    <div class="rdr-s-list" tabindex="0"></div>
                </div>
            </div>`;
        doc.body.appendChild(m);
        m._owner = w;
        call('openModal', m);
        m.classList.remove('hidden');
        call('setModalOffsetsFromViewportTopLeft', m, 10, 10);
        const q = m.querySelector('.rdr-s-q');
        const go = m.querySelector('.rdr-s-go');
        const form = m.querySelector('.rdr-s-form');
        const res = m.querySelector('.rdr-s-results');
        const list = m.querySelector('.rdr-s-list');
        q.addEventListener('input', () => { go.disabled = !q.value.trim(); });
        const run = async () => {
            const owner = m._owner && m._owner.pdf ? m._owner : Array.from(windows).find((x) => x.pdf);
            if (!owner || !q.value.trim()) return;
            const opts = { whole: m.querySelector('.rdr-s-whole').checked, matchCase: m.querySelector('.rdr-s-case').checked };
            form.hidden = true; res.hidden = false;
            m.querySelector('.rdr-s-looking').textContent = `${q.value} in the current PDF document`;
            m.querySelector('.rdr-s-count').textContent = 'Searching...';
            list.innerHTML = '';
            const hits = await owner.findAll(q.value, opts);
            owner.find = Object.assign(owner.find, opts, { q: q.value, hits, at: -1 });
            m.querySelector('.rdr-s-count').textContent = `${hits.length ? 1 : 0} documents with ${hits.length} instances`;
            if (!hits.length) return;
            const title = (owner.meta && owner.meta.info && owner.meta.info.Title) || owner.name;
            const top = doc.createElement('div');
            top.className = 'rdr-s-doc is-open';
            top.innerHTML = `<div class="rdr-s-row rdr-s-docrow"><span class="rdr-bm-box"></span><img src="${A}/search-doc.png" alt=""><span></span></div><div class="rdr-s-hits"></div>`;
            top.querySelector('.rdr-s-docrow span:last-child').textContent = title;
            const box = top.querySelector('.rdr-s-hits');
            for (let i = 0; i < hits.length; i += 1) {
                const h = hits[i];
                const { text } = await owner.pageText(h.page);
                const before = text.slice(Math.max(0, h.start - 30), h.start).replace(/^\S*\s/, '');
                const after = text.slice(h.end, h.end + 30).replace(/\s\S*$/, '');
                const row = doc.createElement('div');
                row.className = 'rdr-s-row rdr-s-hit';
                row.innerHTML = `<img src="${A}/search-hit.png" alt=""><span class="rdr-s-ctx"></span>`;
                const ctxEl = row.querySelector('.rdr-s-ctx');
                ctxEl.append(doc.createTextNode(before));
                const b = doc.createElement('b'); b.textContent = text.slice(h.start, h.end); ctxEl.append(b);
                ctxEl.append(doc.createTextNode(after));
                row.addEventListener('click', () => {
                    list.querySelectorAll('.is-sel').forEach((x) => x.classList.remove('is-sel'));
                    row.classList.add('is-sel');
                    owner.find.at = i;
                    void owner.reveal(h);
                });
                box.appendChild(row);
            }
            top.querySelector('.rdr-bm-box').addEventListener('click', () => top.classList.toggle('is-open'));
            list.appendChild(top);
        };
        go.addEventListener('click', () => void run());
        q.addEventListener('keydown', (ev) => { if (ev.key === 'Enter') { ev.preventDefault(); void run(); } });
        m.querySelector('.rdr-s-new').addEventListener('click', () => { res.hidden = true; form.hidden = false; q.focus(); q.select(); });
        m.querySelector('.rdr-arrange').addEventListener('click', () => {
            // Arrange Windows: Search on the left, the document beside it
            const owner = m._owner;
            const H = root.innerHeight - 40;
            m.style.height = `${H}px`;
            call('setModalOffsetsFromViewportTopLeft', m, 0, 0);
            if (owner) { owner.modal.style.width = `${root.innerWidth - 482}px`; owner.modal.style.height = `${H}px`; call('setModalOffsetsFromViewportTopLeft', owner.modal, 482, 0); owner.relayout(); }
        });
        m.querySelector('.rdr-search-close').addEventListener('click', () => { Promise.resolve(call('closeModal', m)).then(() => m.remove()); });
        setTimeout(() => q.focus(), 50);
    }

    ReaderWindow.prototype.closeSearch = function closeSearch() {
        const m = doc.getElementById('adobeReaderSearch');
        if (m && m._owner === this && !Array.from(windows).some((x) => x !== this && x.pdf)) { Promise.resolve(call('closeModal', m)).then(() => m.remove()); }
    };

    // ---- How To (the navigation panel's green question mark: Reader 8's Adobe Reader Essentials) ----

    function renderHowTo(body) {
        const topics = [
            ['Adobe Reader Essentials', [
                'Find out what is new in Adobe Reader 8',
                'Open and view PDF documents',
                'Search PDF documents',
                'Print PDF documents',
                'Fill out forms',
                'Sign PDF documents',
                'Use bookmarks and page thumbnails',
                'Read PDF documents in Reading Mode',
                'Change the default page layout and zoom'
            ]]
        ];
        body.innerHTML = topics.map(([t, list]) => `<div class="rdr-howto"><div class="rdr-howto-title">${esc(t)}</div><ul>${list.map((x) => `<li>${esc(x)}</li>`).join('')}</ul></div>`).join('');
    }

    // ---- launching -------------------------------------------------------------------------------

    async function newWindow(source) {
        if (!appRef) return null;
        const w = new ReaderWindow(appRef, source);
        windows.add(w);
        return w;
    }

    async function start(app) {
        if (root.featureLoader && !root.vistaDialogTemplate) { try { await root.featureLoader.loadFeature('vista_dialog_templates'); } catch (_) { /* no dialogs */ } }
        const a = app.args || {};
        const source = a.file || a.url || a.data ? a : null;
        // one Reader runs: a second launch opens its document in a window of the first
        if (appRef && windows.size) {
            const empty = Array.from(windows).find((w) => !w.pdf);
            if (source && empty) { empty.front(); void empty.open(source); } else if (source) void newWindow(source); else void newWindow(null);
            app.exit();
            return;
        }
        appRef = app;
        windows.add(new ReaderWindow(app, source));
        app.onExit(() => { windows.forEach((x) => x.destroy()); windows.clear(); appRef = null; activeWin = null; });
    }

    /** A PDF's first page drawn into host (Explorer's preview pane, as Reader 8's preview handler shows a PDF). */
    async function preview(url, host) {
        const lib = await loadPdfJs();
        const pdf = await lib.getDocument({ url, withCredentials: true, cMapUrl: `${PDFJS}/cmaps/`, cMapPacked: true, standardFontDataUrl: `${PDFJS}/standard_fonts/` }).promise;
        try {
            const page = await pdf.getPage(1);
            const base = page.getViewport({ scale: 1 });
            const w = Math.max(80, host.clientWidth || 200);
            const vp = page.getViewport({ scale: (w / base.width) * Math.min(2, root.devicePixelRatio || 1) });
            const c = doc.createElement('canvas');
            c.width = Math.floor(vp.width); c.height = Math.floor(vp.height);
            await page.render({ canvasContext: c.getContext('2d', { alpha: false }), viewport: vp }).promise;
            if (host.isConnected) { host.innerHTML = ''; host.appendChild(c); }
        } finally {
            void pdf.destroy();
        }
    }

    root.melatonAdobeReader = { start, preview, windows, active: () => activeWin };
    if (typeof melatonApps !== 'undefined') melatonApps.define('reader', start); // eslint-disable-line no-undef
})(typeof window !== 'undefined' ? window : globalThis);
