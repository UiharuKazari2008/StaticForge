/**
 * Pictures & Videos' storage cards (Yozora #788): the phone's own pictures and videos in Melaton
 * Mobile's Pictures & Videos (wmShell.js registerGalleryApp, the app id 'gallery').
 *
 * WM 6.1's folder drop-down (~/.cache/wm61/ref-pv/03-folder-menu.png) lists My Device with its
 * folders under it, a rule, then Storage Card. Here My Device is this device's internal storage,
 * the Dreamscape server (the gallery's Images / Scraps / Pinned / Upscaled, drawn by wmShell.js),
 * and every storage root the Android app shares (phoneStorageBridge.js) is a Storage Card:
 * "Storage Card" for the phone's shared storage, "Storage Card 2" ... for an SD card or USB
 * drive. A card's folders that hold pictures or videos (its albums) form its tree, as the device
 * shows a card's folders; a folder's subfolders are folder cells in the grid
 * (ref-pv/04-card.png), opened with Open.
 *
 * Albums and items come from the app's MediaStore ops (media.albums / media.list, bridge
 * version 2, features.media); an older app gets a walk of the card's folders with list instead.
 * Every operation is the bridge's own silent file operation (copy, move, rename, delete) behind
 * a WM question; nothing here opens an Android dialog or share sheet.
 *
 *   window.wmPhoneGallery = {
 *     available()                 the bridge is up and shares at least one root
 *     init(onChange)              hello + albums; onChange() whenever the drive changes
 *     location()                  { root, path } on a card, or null (My Device)
 *     open(root, path)            show that folder (null: back to My Device)
 *     startLocation()             the folder the app opens in: the camera roll, else the first card
 *     cards()                     [{ id, label, name, kind }]
 *     folderItems(close)          the drop-down's card rows (after My Device's)
 *     barLabel() / barIcon()      the folder bar while on a card
 *     render(page) / search(q) / sortItems(page) / setSort(k, page)
 *     softKeys(page)              the app's soft keys on a card
 *     isPhoneSlide(d) / viewerSoftKeys(m) / viewerDelete(m) / viewerDirector(m)
 *     cameraRoll()                { root, path } where the Camera saves
 *     added(root, path)           a file was written there (the Camera): refresh
 *   }
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const TITLE = 'Pictures & Videos';
    const CAMERA_DIR = '/DCIM/Camera';
    const CHUNK = 60;
    // folders a walk never enters (an app without media.albums): app data, thumbnails, trash
    const SKIP = /^(Android|\.thumbnails|\.Trash.*|LOST\.DIR|\.android_secure)$/i;
    const WALK_DEPTH = 4;
    const WALK_LIMIT = 400;
    const MAIL_LIMIT = 20 * 1024 * 1024;
    const DIRECTOR_EDGE = 2048;

    const PS = () => window.phoneStorage || null;
    let sh = null;
    let hello = null;
    let albums = [];          // { root, path, name, count, images, videos, newest, cover }
    let loc = null;           // { root, path } on a card; null = My Device
    let entries = [];         // the folder's pictures and videos
    let entriesKey = '';
    let loading = false;
    let listError = '';
    let selectedPath = null;
    let picked = null;        // Set of paths while picking several (Menu > Select Pictures)
    let sortBy = 'date';
    let query = '';
    let onChange = () => {};
    let watched = null;
    let gridSig = '';
    let gridMore = null;
    let slideTimer = null;

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const isMedia = (mime) => /^(image|video)\//.test(String(mime || ''));
    const baseName = (p) => String(p || '').split('/').filter(Boolean).pop() || '';
    const parentOf = (p) => { const a = String(p || '/').split('/').filter(Boolean); a.pop(); return `/${a.join('/')}`; };
    const join = (dir, name) => `${String(dir || '/').replace(/\/+$/, '')}/${name}`.replace(/^\/*/, '/');
    const sameLoc = (a, b) => !!(a && b && a.root === b.root && a.path === b.path);

    function available() {
        const ps = PS();
        return !!(ps && ps.available !== false && window.AndroidPhoneStorage && hello && hello.enabled && hello.access && !hello.locked && (hello.roots || []).length);
    }

    const hasMediaOps = () => !!(hello && hello.features && hello.features.media);

    // ---------------------------------------------------------------- cards and albums

    function cards() {
        const roots = (hello && hello.roots) || [];
        let n = 0;
        return roots.map((r) => {
            // the phone's own storage is the Storage Card; more drives are numbered as WM numbers cards
            const folder = r.kind === 'folder';
            const label = folder ? r.name : (n++ === 0 ? 'Storage Card' : `Storage Card ${n}`);
            return { id: r.id, label, name: r.name, kind: r.kind };
        });
    }

    const cardOf = (id) => cards().find((c) => c.id === id) || null;

    async function loadHello(fresh) {
        const ps = PS();
        if (!ps || !window.AndroidPhoneStorage) { hello = null; return null; }
        try {
            if (fresh && typeof ps.call === 'function') {
                hello = await ps.call('hello');
                // the bridge client keeps its own copy (fileUrl's baseUrl)
                if (typeof ps.hello === 'function') await ps.hello();
            } else hello = await ps.hello();
        } catch (_) { hello = null; }
        return hello;
    }

    async function loadAlbums() {
        if (!available()) { albums = []; return albums; }
        if (hasMediaOps()) {
            try {
                const list = await PS().call('media.albums', {});
                albums = Array.isArray(list) ? list : [];
                return albums;
            } catch (err) { console.warn('[wmPhoneGallery] media.albums', err); }
        }
        albums = await walkAlbums();
        return albums;
    }

    /** An app without media.albums: the cards' folders walked with list (a few levels, bounded). */
    async function walkAlbums() {
        const out = [];
        for (const c of cards()) {
            const queue = [{ path: '/', depth: 0 }];
            let lists = 0;
            while (queue.length && lists < WALK_LIMIT) {
                const { path, depth } = queue.shift();
                let r = null;
                try { r = await PS().call('list', { root: c.id, path }); } catch (_) { r = null; }
                lists++;
                if (!r) continue;
                let count = 0; let images = 0; let videos = 0; let newest = 0; let cover = '';
                for (const e of r.entries || []) {
                    if (e.hidden) continue;
                    if (e.dir) {
                        if (depth < WALK_DEPTH && !SKIP.test(e.name)) queue.push({ path: e.path, depth: depth + 1 });
                        continue;
                    }
                    if (!isMedia(e.mime)) continue;
                    count++;
                    if (/^video\//.test(e.mime)) videos++; else images++;
                    if ((e.mtime || 0) >= newest) { newest = e.mtime || 0; cover = e.path; }
                }
                if (count) out.push({ root: c.id, path: r.path || path, name: path === '/' ? c.name : baseName(path), count, images, videos, newest, cover });
            }
        }
        return out;
    }

    /** A card's folder tree: every album and the folders above it, depth-first by name. */
    function treeOf(rootId) {
        const nodes = new Map();
        const add = (path, album) => {
            if (path === '/') return;
            if (!nodes.has(path)) nodes.set(path, { path, name: baseName(path), album: null });
            if (album) nodes.get(path).album = album;
            add(parentOf(path), null);
        };
        albums.filter((a) => a.root === rootId).forEach((a) => add(a.path, a));
        const sorted = [...nodes.values()].sort((x, y) => x.path.localeCompare(y.path, undefined, { sensitivity: 'base' }));
        return sorted.map((n) => Object.assign(n, { depth: n.path.split('/').filter(Boolean).length }));
    }

    /** The folders directly under a folder of a card that lead to pictures or videos. */
    function subfoldersOf(rootId, path) {
        const depth = path === '/' ? 1 : path.split('/').filter(Boolean).length + 1;
        const prefix = path === '/' ? '/' : `${path}/`;
        return treeOf(rootId).filter((n) => n.depth === depth && n.path.startsWith(prefix));
    }

    function albumAt(rootId, path) {
        return albums.find((a) => a.root === rootId && a.path === path) || null;
    }

    /** Where the Camera saves: the first card's DCIM\Camera. */
    function cameraRoll() {
        const c = cards().find((x) => x.kind === 'internal') || cards()[0];
        return c ? { root: c.id, path: CAMERA_DIR } : null;
    }

    /**
     * Where a card opens when it is picked in the drop-down (Yukimi: the camera roll): its
     * DCIM\Camera when that holds pictures, else the card itself with its albums as folder cells.
     */
    // cards opened since the app started: the camera roll is the first visit's only (Yukimi #788);
    // a card picked again goes to its root
    const visitedCards = new Set();
    function cardStart(rootId) {
        const first = !visitedCards.has(rootId);
        if (first && albumAt(rootId, CAMERA_DIR)) return { root: rootId, path: CAMERA_DIR };
        return { root: rootId, path: '/' };
    }

    function startLocation() {
        const roll = cameraRoll();
        return roll ? cardStart(roll.root) : null;
    }

    // ---------------------------------------------------------------- the folder

    async function loadEntries(force) {
        if (!loc) { entries = []; return; }
        const key = `${loc.root}:${loc.path}`;
        if (!force && key === entriesKey) return;
        loading = true;
        listError = '';
        const at = loc;
        let list = [];
        try {
            if (hasMediaOps()) {
                const r = await PS().call('media.list', { root: at.root, path: at.path });
                list = (r && r.entries) || [];
            } else {
                const r = await PS().call('list', { root: at.root, path: at.path });
                list = ((r && r.entries) || []).filter((e) => !e.dir && !e.hidden && isMedia(e.mime))
                    .map((e) => Object.assign({}, e, { taken: e.mtime, video: /^video\//.test(e.mime) }));
            }
        } catch (err) {
            // a folder that went away (moved, card removed) leaves an empty folder and the reason
            listError = (err && err.code === 'not_found') || (err && err.code === 'not_dir') ? '' : ((err && err.message) || 'The folder could not be read.');
            list = [];
        }
        if (!sameLoc(at, loc)) return;
        entries = list;
        entriesKey = key;
        loading = false;
        if (selectedPath && !entries.some((e) => e.path === selectedPath)) selectedPath = null;
        if (picked) for (const p of [...picked]) if (!entries.some((e) => e.path === p)) picked.delete(p);
    }

    function watch() {
        const ps = PS();
        if (!ps || typeof ps.watch !== 'function') return;
        const next = loc ? `${loc.root}\n${loc.path}` : null;
        if (next === watched) return;
        if (watched) { const [r, p] = watched.split('\n'); try { ps.unwatch(r, p); } catch (_) { /* gone */ } }
        watched = next;
        if (loc) { try { ps.watch(loc.root, loc.path); } catch (_) { /* not watched: Reload */ } }
    }

    async function open(root, path) {
        loc = root ? { root, path: path || '/' } : null;
        if (root) visitedCards.add(root);
        selectedPath = null;
        picked = null;
        query = '';
        gridSig = '';
        watch();
        onChange();
        if (loc) {
            await loadEntries(true);
            onChange();
        }
    }

    async function refresh(opts = {}) {
        await loadAlbums();
        if (loc) await loadEntries(true);
        gridSig = '';
        if (!opts.quiet) onChange();
    }

    let refreshTimer = null;
    function refreshSoon() {
        clearTimeout(refreshTimer);
        refreshTimer = setTimeout(() => { void refresh(); }, 350);
    }

    // ---------------------------------------------------------------- grid

    const SORTS = [['date', 'Date'], ['name', 'Name'], ['size', 'Size']];

    function listNow() {
        let list = entries.slice();
        if (query) {
            const q = query.toLowerCase();
            list = list.filter((e) => String(e.name || '').toLowerCase().includes(q));
        }
        if (sortBy === 'name') list.sort((a, b) => String(a.name).localeCompare(String(b.name), undefined, { numeric: true, sensitivity: 'base' }));
        else if (sortBy === 'size') list.sort((a, b) => (Number(b.size) || 0) - (Number(a.size) || 0));
        else list.sort((a, b) => (Number(b.taken || b.mtime) || 0) - (Number(a.taken || a.mtime) || 0));
        return list;
    }

    // pictures the WebView cannot decode (the Fold's camera writes HEIC): the app's JPEG of them
    // (?jpeg=1, bridge features.jpeg), else its largest thumbnail
    const UNDECODABLE = /^image\/(heic|heif|x-adobe-dng|dng|tiff|x-tiff|x-[a-z]+-raw)$/i;
    const needsJpeg = (e) => !!(e && !e.video && UNDECODABLE.test(String(e.mime || '')));
    function viewUrl(root, e) {
        const ps = PS();
        if (!ps || typeof ps.fileUrl !== 'function') return '';
        if (!needsJpeg(e)) return ps.fileUrl(root, e.path);
        if (hello && hello.features && hello.features.jpeg) return `${ps.fileUrl(root, e.path)}?jpeg=1`;
        return ps.fileUrl(root, e.path, { thumb: 1024 });
    }
    const thumbUrl = (e) => (PS() && typeof PS().fileUrl === 'function' ? PS().fileUrl(loc.root, e.path, { thumb: 256 }) : '');
    const fileUrl = (root, path) => (PS() && typeof PS().fileUrl === 'function' ? PS().fileUrl(root, path) : '');

    function duration(ms) {
        const s = Math.max(0, Math.round((Number(ms) || 0) / 1000));
        const h = Math.floor(s / 3600);
        const m = Math.floor((s % 3600) / 60);
        const ss = String(s % 60).padStart(2, '0');
        return h ? `${h}:${String(m).padStart(2, '0')}:${ss}` : `${m}:${ss}`;
    }

    function folderArt() {
        const a = sh && sh.art;
        return a ? `<img src="${a.url2x ? a.url2x('fe-folder') : a.url('fe-folder')}" alt="" draggable="false">` : '';
    }

    function cellHtml(e) {
        const sel = e.path === selectedPath ? ' is-selected' : '';
        const chk = picked && picked.has(e.path) ? ' is-picked' : '';
        // an app without media.list gives no length: none is shown rather than 0:00
        const dur = e.video && Number(e.duration) > 0 ? `<i class="wm-pv-dur">${esc(duration(e.duration))}</i>` : '';
        return `<button type="button" class="wm-pv-cell wm-photo${e.video ? ' is-video' : ''}${sel}${chk}" data-path="${esc(e.path)}" aria-label="${esc(e.name)}"><img src="${esc(thumbUrl(e))}" alt="" loading="lazy" decoding="async" draggable="false">${dur}</button>`;
    }

    function dirHtml(n) {
        const sel = `dir:${n.path}` === selectedPath ? ' is-selected' : '';
        return `<button type="button" class="wm-pv-cell wm-pv-dir${sel}" data-dir="${esc(n.path)}" aria-label="${esc(n.name)}">${folderArt()}<span class="wm-pv-name">${esc(n.name)}</span></button>`;
    }

    function host(page) {
        let box = page.querySelector('.wm-pv-phone');
        if (box) return box;
        const scroller = page.querySelector('.wm-pv-scroll');
        scroller.insertAdjacentHTML('beforeend', '<div class="wm-pv-phone" hidden></div><p class="wm-photos-empty wm-pv-phone-empty" hidden></p>');
        box = page.querySelector('.wm-pv-phone');
        box.addEventListener('click', (ev) => onCellTap(page, ev));
        box.addEventListener('contextmenu', (ev) => onCellHold(page, ev));
        return box;
    }

    /** Draw the card folder into the page (wmShell's own grid is hidden meanwhile). */
    function render(page, force) {
        const box = host(page);
        const empty = page.querySelector('.wm-pv-phone-empty');
        const grid = page.querySelector('.wm-pv-grid');
        const deviceEmpty = page.querySelector('.wm-photos-empty:not(.wm-pv-phone-empty)');
        const on = !!loc;
        box.hidden = !on;
        if (grid) grid.hidden = on;
        if (deviceEmpty && on) deviceEmpty.hidden = true;
        if (!on) { empty.hidden = true; return; }
        const dirs = query ? [] : subfoldersOf(loc.root, loc.path);
        const list = listNow();
        const sig = `${loc.root}|${loc.path}|${dirs.map((d) => d.path).join(',')}|${list.length}|${list.length ? list[0].path : ''}|${sortBy}|${query}|${picked ? picked.size : -1}|${entriesKey}`;
        if (!force && sig === gridSig) return;
        gridSig = sig;
        const cols = Number(page.style.getPropertyValue('--wm-pv-cols')) || 3;
        const size = cols * Math.max(1, Math.round(CHUNK / cols));
        const cells = dirs.map(dirHtml).concat(list.map((e) => e));
        const chunk = (i) => {
            let html = '<div class="wm-pv-chunk">';
            for (const c of cells.slice(i, i + size)) html += typeof c === 'string' ? c : cellHtml(c);
            return `${html}</div>`;
        };
        let html = '';
        let next = 0;
        for (; next < Math.min(cells.length, 2 * size); next += size) html += chunk(next);
        box.innerHTML = html;
        if (gridMore) { gridMore.disconnect(); gridMore = null; }
        if (next < cells.length && typeof IntersectionObserver === 'function') {
            const scroller = page.querySelector('.wm-pv-scroll');
            gridMore = new IntersectionObserver((obs) => {
                if (!obs.some((o) => o.isIntersecting)) return;
                let add = '';
                for (let n = 0; n < 2 && next < cells.length; n++, next += size) add += chunk(next);
                box.insertAdjacentHTML('beforeend', add);
                gridMore.disconnect();
                if (next < cells.length) gridMore.observe(box.lastElementChild); else gridMore = null;
            }, { root: scroller, rootMargin: '0px 0px 1500px 0px' });
            gridMore.observe(box.lastElementChild);
        } else if (next < cells.length) {
            for (; next < cells.length; next += size) box.insertAdjacentHTML('beforeend', chunk(next));
        }
        empty.textContent = listError || (loading ? 'Loading...' : (query ? 'No matches' : 'No pictures or videos'));
        empty.hidden = cells.length > 0;
    }

    /** Every remaining block (a jump to a cell further down). */
    function flush(page) {
        if (!gridMore) return;
        gridSig = '';
        const keep = gridMore;
        gridMore = null;
        keep.disconnect();
        // a full redraw with all blocks: the observer is not set up again for so short a list
        const box = host(page);
        const dirs = query ? [] : subfoldersOf(loc.root, loc.path);
        box.innerHTML = `<div class="wm-pv-chunk">${dirs.map(dirHtml).join('')}${listNow().map(cellHtml).join('')}</div>`;
    }

    function select(page, path) {
        selectedPath = path;
        page.querySelectorAll('.wm-pv-phone .wm-pv-cell.is-selected').forEach((c) => c.classList.remove('is-selected'));
        const el = path ? page.querySelector(path.startsWith('dir:')
            ? `.wm-pv-phone .wm-pv-dir[data-dir="${CSS.escape(path.slice(4))}"]`
            : `.wm-pv-phone .wm-pv-cell[data-path="${CSS.escape(path)}"]`) : null;
        if (el) el.classList.add('is-selected');
        if (sh) sh.refreshSoftKeys();
    }

    function onCellTap(page, ev) {
        const dir = ev.target.closest('.wm-pv-dir');
        if (dir) {
            // WM: a tap on a folder selects and opens it (Open)
            select(page, `dir:${dir.dataset.dir}`);
            void sh.busy(open(loc.root, dir.dataset.dir), { paint: true });
            return;
        }
        const cell = ev.target.closest('.wm-pv-cell[data-path]');
        if (!cell) return;
        const path = cell.dataset.path;
        if (picked) {
            if (picked.has(path)) picked.delete(path); else picked.add(path);
            cell.classList.toggle('is-picked', picked.has(path));
            sh.refreshSoftKeys();
            return;
        }
        select(page, path);
        view(path);
    }

    function onCellHold(page, ev) {
        const dir = ev.target.closest('.wm-pv-dir');
        const cell = ev.target.closest('.wm-pv-cell[data-path]');
        if (!dir && !cell) return;
        ev.preventDefault();
        if (dir) {
            select(page, `dir:${dir.dataset.dir}`);
            sh.menuAt(ev.clientX, ev.clientY, folderMenu(dir.dataset.dir));
            return;
        }
        if (picked && picked.size && picked.has(cell.dataset.path)) {
            sh.menuAt(ev.clientX, ev.clientY, itemsMenu(pickedEntries(), page));
            return;
        }
        select(page, cell.dataset.path);
        sh.menuAt(ev.clientX, ev.clientY, itemsMenu([entryAt(cell.dataset.path)].filter(Boolean), page));
    }

    const entryAt = (path) => entries.find((e) => e.path === path) || null;
    const pickedEntries = () => (picked ? listNow().filter((e) => picked.has(e.path)) : []);
    const one = (list) => (list.length === 1 ? list[0] : null);
    const noun = (list) => {
        const v = list.filter((e) => e.video).length;
        if (list.length === 1) return v ? 'video' : 'picture';
        return v === list.length ? 'videos' : (v ? 'items' : 'pictures');
    };

    // ---------------------------------------------------------------- picture view

    /** A slide for PhotoSwipe (lightbox.js openStandalonePhotoSwipe): the file by the app's URL. */
    function slideOf(root, e) {
        const meta = { isStandalone: true, title: e.name, phoneMedia: { root, path: e.path, name: e.name, mime: e.mime, size: e.size, mtime: e.mtime, taken: e.taken, video: !!e.video, width: e.width, height: e.height } };
        const src = e.video ? fileUrl(root, e.path) : viewUrl(root, e);
        if (e.video) {
            // the phone's own frame as the poster: Android's WebView draws a grey play sign until it plays
            const poster = PS() && typeof PS().fileUrl === 'function' ? PS().fileUrl(root, e.path, { thumb: 1024 }) : '';
            return { html: `<div class="wm-pv-video"><video src="${esc(src)}" poster="${esc(poster)}" controls playsinline preload="metadata"></video></div>`, data: meta };
        }
        let w = Number(e.width) || 0;
        let h = Number(e.height) || 0;
        if (!w || !h) {
            // an older app gives no size: the grid's thumbnail has the picture's proportions
            const img = document.querySelector(`.wm-pv-phone .wm-pv-cell[data-path="${CSS.escape(e.path)}"] img`);
            const nw = img && img.naturalWidth;
            const nh = img && img.naturalHeight;
            if (nw && nh) { const k = 2048 / Math.max(nw, nh); w = Math.round(nw * k); h = Math.round(nh * k); } else { w = 1536; h = 2048; }
        }
        return { src, width: w, height: h, data: meta };
    }

    async function view(path, opts = {}) {
        if (typeof window.openStandalonePhotoSwipe !== 'function' && typeof openStandalonePhotoSwipe !== 'function') return;
        const list = listNow();
        const at = Math.max(0, list.findIndex((e) => e.path === path));
        if (!list.length) return;
        const root = loc.root;
        const slides = list.map((e) => slideOf(root, e));
        const openFn = typeof window.openStandalonePhotoSwipe === 'function' ? window.openStandalonePhotoSwipe : openStandalonePhotoSwipe;
        await sh.busy(Promise.resolve(openFn(slides, at)), { paint: true });
        const p = window.pswp;
        if (p && typeof p.on === 'function') {
            // a video stops when its slide is left or the view closes
            const stop = () => { try { p.element.querySelectorAll('video').forEach((v) => { if (!v.closest('.pswp__item') || v.closest('.pswp__item').getAttribute('aria-hidden') === 'true') v.pause(); }); } catch (_) { /* closing */ } };
            p.on('change', stop);
            p.on('close', () => { try { p.element.querySelectorAll('video').forEach((v) => v.pause()); } catch (_) { /* gone */ } stopShow(); });
        }
        if (opts.show) startShow();
    }

    function startShow() {
        stopShow();
        slideTimer = setInterval(() => {
            const p = window.pswp;
            if (!p || p.isDestroying) { stopShow(); return; }
            const d = p.currSlide && p.currSlide.data && p.currSlide.data.data;
            if (d && d.phoneMedia && d.phoneMedia.video) {
                // a video plays to its end before the show goes on
                const v = p.currSlide.container && p.currSlide.container.querySelector('video');
                if (v && !v.ended) { if (v.paused) v.play().catch(() => {}); return; }
            }
            if (p.currIndex >= p.getNumItems() - 1) { stopShow(); return; }
            p.next();
        }, 4000);
    }

    function stopShow() { clearInterval(slideTimer); slideTimer = null; }

    const isPhoneSlide = (d) => !!(d && d.phoneMedia);

    function closeViewer() {
        const p = window.pswp;
        return new Promise((resolve) => {
            if (!p || p.isDestroying || typeof p.close !== 'function') { resolve(); return; }
            p.on('destroy', () => resolve());
            setTimeout(resolve, 800);
            try { p.close(); } catch (_) { resolve(); }
        });
    }

    function viewerSoftKeys(m) {
        const e = m && (entryAt(m.path) || m);
        return {
            left: { label: 'Send', menu: () => sendItems([e]) },
            right: {
                label: 'Menu',
                menu: () => [
                    { label: 'Zoom', disabled: !!(e && e.video), action: () => { const p = window.pswp; if (p && p.currSlide && typeof p.toggleZoom === 'function') p.toggleZoom(); } },
                    { label: 'Play Slide Show', action: startShow },
                    '-',
                    { label: 'Copy to My Device', action: () => copyToDevice([e]) },
                    { label: 'Move To', submenu: () => destinations([e], 'move') },
                    { label: 'Copy To', submenu: () => destinations([e], 'copy') },
                    { label: 'Rename...', action: async () => { await closeViewer(); void rename(e); } },
                    { label: 'Delete', action: () => viewerDelete(m) },
                    '-',
                    { label: 'Set as Today Background', disabled: !!(e && e.video), action: () => todayBackground(e) },
                    { label: 'Properties', action: async () => { await closeViewer(); properties(e); } }
                ]
            }
        };
    }

    async function viewerDelete(m) {
        const e = m && (entryAt(m.path) || m);
        if (!e) return;
        const p = window.pswp;
        const at = p ? p.currIndex : 0;
        const gone = await remove([e]);
        if (!gone) return;
        await closeViewer();
        const list = listNow();
        if (list.length) void view(list[Math.min(at, list.length - 1)].path);
    }

    function viewerDirector(m) {
        const e = m && (entryAt(m.path) || m);
        if (e) void attachToDirector([e]);
    }

    // ---------------------------------------------------------------- menus

    function cameraItem() {
        return { label: 'Camera', disabled: !(window.wmCamera && window.wmCamera.supported()), action: () => window.wmCamera.open() };
    }

    function sortItems(page) {
        return SORTS.map(([k, label]) => ({ label, radio: sortBy === k, action: () => setSort(k, page) }));
    }

    function setSort(k, page) {
        sortBy = k;
        gridSig = '';
        if (page) render(page, true);
        onChange();
    }

    function itemsMenu(list, page) {
        const e = one(list);
        if (!list.length) return [];
        return [
            ...(e ? [{ label: e.video ? 'Play' : 'View', action: () => view(e.path) }, '-'] : []),
            { label: 'Send', submenu: () => sendItems(list) },
            { label: 'Copy to My Device', action: () => copyToDevice(list) },
            '-',
            { label: 'Move To', submenu: () => destinations(list, 'move') },
            { label: 'Copy To', submenu: () => destinations(list, 'copy') },
            ...(e ? [{ label: 'Rename...', action: () => rename(e) }] : []),
            { label: 'Delete', action: () => { void remove(list).then(() => { if (page) render(page, true); }); } },
            '-',
            ...(e ? [
                { label: 'Set as Today Background', disabled: !!e.video, action: () => todayBackground(e) },
                { label: 'Properties', action: () => properties(e) }
            ] : [])
        ];
    }

    function folderMenu(path) {
        const name = baseName(path);
        return [
            { label: 'Open', action: () => sh.busy(open(loc.root, path), { paint: true }) },
            '-',
            { label: 'Rename...', action: () => renameFolder(path) },
            { label: 'Delete', action: () => removeFolder(path, name) }
        ];
    }

    /** The app's soft keys on a card: Camera | Menu with nothing selected, View / Open | Menu otherwise. */
    function softKeys(page) {
        const sel = selectedPath && !selectedPath.startsWith('dir:') ? entryAt(selectedPath) : null;
        const dir = selectedPath && selectedPath.startsWith('dir:') ? selectedPath.slice(4) : null;
        let left;
        if (picked) left = { label: 'Done', action: () => { picked = null; gridSig = ''; render(page, true); sh.refreshSoftKeys(); } };
        else if (dir) left = { label: 'Open', action: () => sh.busy(open(loc.root, dir), { paint: true }) };
        else if (sel) left = { label: sel.video ? 'Play' : 'View', action: () => view(sel.path) };
        else {
            const cam = cameraItem();
            left = { label: 'Camera', disabled: cam.disabled, action: cam.action };
        }
        const targets = picked ? pickedEntries() : (sel ? [sel] : []);
        return {
            left,
            right: {
                label: 'Menu',
                menu: () => [
                    cameraItem(),
                    ...(targets.length ? ['-', ...itemsMenu(targets, page)] : []),
                    '-',
                    picked
                        ? { label: 'Select All', action: () => { listNow().forEach((x) => picked.add(x.path)); gridSig = ''; render(page, true); sh.refreshSoftKeys(); } }
                        : { label: 'Select Pictures', disabled: !entries.length, action: () => { picked = new Set(sel ? [sel.path] : []); gridSig = ''; render(page, true); sh.refreshSoftKeys(); } },
                    ...(picked && picked.size ? [{ label: 'Clear Selection', action: () => { picked.clear(); gridSig = ''; render(page, true); sh.refreshSoftKeys(); } }] : []),
                    { label: 'Play Slide Show', disabled: !listNow().some((x) => !x.video), action: () => { const l = listNow(); if (l.length) void view((sel || l[0]).path, { show: true }); } },
                    '-',
                    { label: 'New Folder...', action: () => newFolder(loc.root, loc.path) },
                    { label: 'Up One Level', disabled: loc.path === '/', action: () => sh.busy(open(loc.root, parentOf(loc.path)), { paint: true }) },
                    { label: 'Reload', action: () => sh.busy(refresh(), { paint: true }) },
                    '-',
                    { label: 'Sort By', submenu: () => sortItems(page) }
                ]
            }
        };
    }

    /**
     * The drop-down's card rows: each card, and under the card on screen only the path down to the
     * folder on screen, as WM's list shows My Device > My Documents > My Pictures (ref-pv/03);
     * other folders are reached through the folder cells. A card picked here opens on its camera roll.
     */
    function folderItems() {
        const out = [];
        for (const c of cards()) {
            const here = !!(loc && loc.root === c.id);
            out.push({
                label: c.label, icon: 'fe-storage-card', radio: here && loc.path === '/',
                action: () => { const st = cardStart(c.id); return sh.busy(open(st.root, st.path), { paint: true }); }
            });
            if (!here || loc.path === '/') continue;
            const parts = loc.path.split('/').filter(Boolean);
            parts.forEach((name, i) => {
                const path = `/${parts.slice(0, i + 1).join('/')}`;
                out.push({ label: name, indent: i + 1, radio: path === loc.path, action: () => sh.busy(open(c.id, path), { paint: true }) });
            });
        }
        return out;
    }

    function barLabel() {
        if (!loc) return '';
        if (query) return 'Search results';
        if (loc.path === '/') { const c = cardOf(loc.root); return c ? c.label : 'Storage Card'; }
        return baseName(loc.path);
    }

    // ---------------------------------------------------------------- file operations

    function errBox(text, err) {
        const why = err && (err.message || err.code);
        return sh.messageBox({ title: TITLE, icon: 'error', text: why ? `${text} ${why}` : text });
    }

    /** A file's bytes; opts.web: a HEIC (or other picture browsers cannot show) as the app's JPEG. */
    async function fetchFile(root, e, signal, opts = {}) {
        const asJpeg = !!(opts.web && needsJpeg(e) && hello && hello.features && hello.features.jpeg);
        const res = await fetch(asJpeg ? `${fileUrl(root, e.path)}?jpeg=1` : fileUrl(root, e.path), { signal });
        if (!res.ok) throw { code: 'io', message: `The phone answered ${res.status} for ${e.name}.` };
        const blob = await res.blob();
        if (asJpeg) return new File([blob], e.name.replace(/\.[^.]+$/, '') + '.jpg', { type: 'image/jpeg', lastModified: Number(e.mtime) || Date.now() });
        return new File([blob], e.name, { type: e.mime || blob.type, lastModified: Number(e.mtime) || Date.now() });
    }

    const toBase64 = (blob) => new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => { const s = String(r.result || ''); resolve(s.slice(s.indexOf(',') + 1)); };
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
    });

    /** A background job with WM's progress notification: run(each(entry, i)). */
    async function job(title, verb, list, each) {
        let cancelled = false;
        const ctl = typeof AbortController === 'function' ? new AbortController() : null;
        const note = sh.appNote({
            title, html: esc(`${verb} ${list.length} ${noun(list)}...`), progress: 0, detail: '', icon: 'app-pictures',
            softKeys: { left: { label: 'Hide', action: () => note && note.hide() }, right: { label: 'Cancel', action: () => { cancelled = true; if (ctl) ctl.abort(); } } }
        });
        const failed = [];
        let done = 0;
        for (let i = 0; i < list.length && !cancelled; i++) {
            const e = list[i];
            if (note) note.update({ detail: esc(e.name), progress: Math.round((i / list.length) * 100) });
            try { await each(e, i, ctl ? ctl.signal : undefined); done++; } catch (err) {
                if (cancelled) break;
                failed.push({ e, err });
            }
        }
        if (note) note.close();
        return { done, failed, cancelled };
    }

    async function copyToDevice(list) {
        const root = loc ? loc.root : (list[0] && list[0].root);
        const ws = typeof activeWorkspace !== 'undefined' ? activeWorkspace : null;
        const wsc = window.wsClient;
        const vfs = typeof vfsClient !== 'undefined' ? vfsClient : window.vfsClient;
        if (!wsc || !ws) { void errBox('My Device is not reachable right now.'); return; }
        const r = await job(TITLE, 'Copying', list, async (e, i, signal) => {
            // the gallery takes pictures it can read: a HEIC goes as the app's JPEG
            const file = await fetchFile(root, e, signal, { web: true });
            const b64 = await toBase64(file);
            if (e.video || !/^image\//.test(file.type)) {
                // videos go to the workspace's home folder: the gallery holds pictures only
                if (!vfs || typeof vfs.uploadFile !== 'function') throw { message: 'Files cannot be saved on My Device here.' };
                await vfs.uploadFile(`/Workspaces/${ws}/`, b64, file.name, file.type || 'application/octet-stream');
                return;
            }
            const resp = await wsc.uploadWorkspaceImage(b64, ws, file.name, { currentIndex: i, totalCount: list.length });
            if (!resp || !resp.success) throw { message: (resp && (resp.message || resp.error)) || 'The server did not take it.' };
            e._deviceName = resp.filename || null;
        });
        if (typeof loadGallery === 'function') { try { loadGallery(true); } catch (_) { /* the gallery reloads on its own */ } }
        if (r.cancelled) return r;
        if (r.failed.length) {
            void sh.notify({ title: TITLE, icon: 'error', text: `${r.failed.length} of ${list.length} could not be copied to My Device: ${r.failed[0].err && (r.failed[0].err.message || r.failed[0].err.code) || 'unknown error'}` });
        } else {
            void sh.notify({ title: TITLE, icon: 'info', text: list.length === 1 ? `${list[0].name} was copied to My Device.` : `${list.length} ${noun(list)} were copied to My Device.` });
        }
        return r;
    }

    /** Move To / Copy To: every card's folders, the folder on screen left out of Move. */
    function destinations(list, op) {
        const rows = [];
        const from = loc;
        for (const c of cards()) {
            rows.push({ label: c.label, disabled: op === 'move' && from && from.root === c.id && from.path === '/', action: () => transfer(list, op, { root: c.id, path: '/' }) });
            for (const n of treeOf(c.id)) {
                const here = from && from.root === c.id && from.path === n.path;
                rows.push({ label: n.name, indent: n.depth, disabled: op === 'move' && here, action: () => transfer(list, op, { root: c.id, path: n.path }) });
            }
        }
        rows.push('-', { label: 'New Folder...', action: async () => { const made = await newFolder(from ? from.root : cards()[0].id, from ? from.path : '/', { quiet: true }); if (made) await transfer(list, op, made); } });
        return rows;
    }

    async function transfer(list, op, to) {
        const from = loc;
        if (!from || !list.length) return;
        const r = await job(TITLE, op === 'move' ? 'Moving' : 'Copying', list, async (e) => {
            await PS().call(op, { root: from.root, path: e.path, toRoot: to.root, toDir: to.path, conflict: 'rename' });
        });
        if (r.failed.length) void sh.notify({ title: TITLE, icon: 'error', text: `${r.failed.length} could not be ${op === 'move' ? 'moved' : 'copied'}: ${(r.failed[0].err && r.failed[0].err.message) || 'unknown error'}` });
        picked = picked ? new Set() : null;
        await refresh();
    }

    async function remove(list) {
        if (!loc || !list.length) return false;
        const e = one(list);
        const yes = await sh.messageBox({
            title: e ? 'Confirm File Delete' : 'Confirm Multiple File Delete',
            icon: 'warning',
            text: e ? `Are you sure you want to delete '${e.name}'?` : `Are you sure you want to delete these ${list.length} ${noun(list)}?`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false
        });
        if (!yes) return false;
        const at = loc;
        let results = [];
        try {
            results = await sh.busy(PS().call('delete', { root: at.root, paths: list.map((x) => x.path) }), { paint: true });
        } catch (err) { await errBox('The items could not be deleted.', err); return false; }
        const bad = (Array.isArray(results) ? results : []).filter((x) => x && x.error);
        if (picked) list.forEach((x) => picked.delete(x.path));
        if (selectedPath && list.some((x) => x.path === selectedPath)) selectedPath = null;
        entries = entries.filter((x) => !list.some((y) => y.path === x.path) || bad.some((b) => b.path === x.path));
        gridSig = '';
        onChange();
        void refresh();
        if (bad.length) await errBox(`${bad.length} could not be deleted.`, bad[0].error);
        return bad.length < list.length;
    }

    async function askName(title, text, value) {
        const v = await sh.messageBox({
            title, icon: null, text, input: { value: value || '' },
            buttons: [{ text: 'OK', value: true }, { text: 'Cancel', value: false }], cancelValue: false
        });
        if (v === false || v == null || v === true) return null;
        const name = String(v).trim();
        if (!name) return null;
        if (/[\\/:*?"<>|]/.test(name)) { await sh.messageBox({ title, icon: 'error', text: 'A file name cannot contain any of the following characters: \\ / : * ? " < > |' }); return null; }
        return name;
    }

    async function rename(e) {
        if (!loc || !e) return;
        const dot = e.name.lastIndexOf('.');
        const ext = dot > 0 ? e.name.slice(dot) : '';
        const stem = dot > 0 ? e.name.slice(0, dot) : e.name;
        const name = await askName('Rename', `New name for ${e.name}:`, stem);
        if (!name || name === stem) return;
        const full = /\.[a-z0-9]{2,5}$/i.test(name) ? name : name + ext;
        try { await sh.busy(PS().call('rename', { root: loc.root, path: e.path, name: full }), { paint: true }); } catch (err) {
            await errBox(err && err.code === 'exists' ? `There is already a file named '${full}'.` : 'The file could not be renamed.', err && err.code === 'exists' ? null : err);
            return;
        }
        if (selectedPath === e.path) selectedPath = join(parentOf(e.path), full);
        await refresh();
    }

    async function renameFolder(path) {
        const name = await askName('Rename', `New name for ${baseName(path)}:`, baseName(path));
        if (!name || name === baseName(path)) return;
        try { await sh.busy(PS().call('rename', { root: loc.root, path, name }), { paint: true }); } catch (err) { await errBox('The folder could not be renamed.', err); return; }
        selectedPath = null;
        await refresh();
    }

    async function removeFolder(path, name) {
        const yes = await sh.messageBox({
            title: 'Confirm Folder Delete', icon: 'warning',
            text: `Are you sure you want to remove the folder '${name}' and all its contents?`,
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }], cancelValue: false
        });
        if (!yes) return;
        try {
            const r = await sh.busy(PS().call('delete', { root: loc.root, paths: [path] }), { paint: true });
            const bad = (Array.isArray(r) ? r : []).find((x) => x && x.error);
            if (bad) throw bad.error;
        } catch (err) { await errBox('The folder could not be deleted.', err); return; }
        selectedPath = null;
        await refresh();
    }

    async function newFolder(root, dir, opts = {}) {
        const name = await askName('New Folder', 'Name of the new folder:', 'New Folder');
        if (!name) return null;
        const path = join(dir, name);
        try { await sh.busy(PS().call('mkdir', { root, path }), { paint: true }); } catch (err) {
            await errBox(err && err.code === 'exists' ? `There is already a folder named '${name}'.` : 'The folder could not be made.', err && err.code === 'exists' ? null : err);
            return null;
        }
        // a folder with nothing in it yet is no album: open it so it is not lost from sight
        if (!opts.quiet) await open(root, path);
        return { root, path };
    }

    function properties(e) {
        const props = window.wmPictureProperties;
        if (!props || typeof props.open !== 'function' || !e) return;
        const root = loc && loc.root;
        props.open({
            name: e.name,
            src: e.video ? fileUrl(root, e.path) : viewUrl(root, e),
            width: Number(e.width) || 0,
            height: Number(e.height) || 0,
            size: Number(e.size) || null,
            created: Number(e.taken || e.mtime) || 0,
            mimeType: e.mime,
            // the page's Name box renames the file on the card (ok)
            rename: async (full) => {
                await PS().call('rename', { root, path: e.path, name: full });
                if (selectedPath === e.path) selectedPath = join(parentOf(e.path), full);
                await refresh();
            }
        });
    }

    async function todayBackground(e) {
        // Today keeps an address it can load at any time: the phone's file URLs change on every
        // start, so the picture goes to My Device first and Today shows that copy
        const r = await copyToDevice([e]);
        if (!r || r.failed.length || r.cancelled || !e._deviceName) return;
        if (sh.setTodayBackground) sh.setTodayBackground(e._deviceName, { filename: e._deviceName });
    }

    // ---------------------------------------------------------------- send

    function sendItems(list) {
        const tm = window.wmTextMessaging;
        const accounts = tm && typeof tm.accounts === 'function' ? tm.accounts() : [];
        const videos = list.some((e) => e.video);
        const rows = [];
        if (accounts.length > 1) {
            rows.push({ label: 'Text Message', submenu: () => accounts.map((a) => ({ label: a.name || a.identity || a.id, action: () => sendText(list, a.id) })) });
        } else {
            rows.push({ label: 'Text Message', disabled: !accounts.length, action: () => sendText(list, accounts[0] && accounts[0].id) });
        }
        rows.push({ label: 'E-mail', disabled: typeof window.wmMessagingCompose !== 'function', action: () => sendMail(list) });
        rows.push({ label: 'Director Message', disabled: videos || !(window.wmDirectorApp && typeof window.wmDirectorApp.attach === 'function'), action: () => attachToDirector(list) });
        return rows;
    }

    async function filesOf(list, opts) {
        const root = loc ? loc.root : null;
        return sh.busy(Promise.all(list.map((e) => fetchFile(root, e, undefined, opts))), { paint: true, timeout: 120000 });
    }

    async function sendText(list, accountId) {
        const tm = window.wmTextMessaging;
        if (!tm || typeof tm.composeWithFiles !== 'function' || !accountId) return;
        let files;
        try { await closeViewer(); files = await filesOf(list); } catch (err) { await errBox('The picture could not be read from the phone.', err); return; }
        void tm.composeWithFiles(accountId, files);
    }

    async function sendMail(list) {
        const total = list.reduce((n, e) => n + (Number(e.size) || 0), 0);
        if (total > MAIL_LIMIT) {
            await sh.messageBox({ title: TITLE, icon: 'warning', text: `The ${noun(list)} are too large to send by e-mail (${Math.round(total / 1048576)} MB; at most ${MAIL_LIMIT / 1048576} MB).` });
            return;
        }
        let attachments;
        try {
            await closeViewer();
            const files = await filesOf(list);
            attachments = await Promise.all(files.map(async (f) => ({ name: f.name, mimeType: f.type || 'application/octet-stream', size: f.size, base64: await toBase64(f) })));
        } catch (err) { await errBox('The picture could not be read from the phone.', err); return; }
        window.wmMessagingCompose({ attachments });
    }

    /** A picture for the Director: a JPEG of at most 2048 px on its long side (the desktop takes up to 8 MB). */
    async function directorAttachment(file) {
        const url = URL.createObjectURL(file);
        try {
            const img = await new Promise((resolve, reject) => { const i = new Image(); i.onload = () => resolve(i); i.onerror = reject; i.src = url; });
            const k = Math.min(1, DIRECTOR_EDGE / Math.max(img.naturalWidth, img.naturalHeight));
            if (k === 1 && file.size < 6 * 1024 * 1024 && /^image\/(png|jpeg|webp|gif)$/.test(file.type)) {
                const data = await toBase64(file);
                return { source: 'client', name: file.name, data, preview: `data:${file.type};base64,${data}` };
            }
            const c = document.createElement('canvas');
            c.width = Math.round(img.naturalWidth * k);
            c.height = Math.round(img.naturalHeight * k);
            c.getContext('2d').drawImage(img, 0, 0, c.width, c.height);
            const preview = c.toDataURL('image/jpeg', 0.9);
            const name = file.name.replace(/\.[^.]+$/, '') + '.jpg';
            return { source: 'client', name, data: preview.slice(preview.indexOf(',') + 1), preview };
        } finally { URL.revokeObjectURL(url); }
    }

    async function attachToDirector(list) {
        const d = window.wmDirectorApp;
        if (!d || typeof d.attach !== 'function') return;
        let items;
        try {
            await closeViewer();
            const files = await filesOf(list.filter((e) => !e.video), { web: true });
            items = await sh.busy(Promise.all(files.map(directorAttachment)), { paint: true });
        } catch (err) { await errBox('The picture could not be read from the phone.', err); return; }
        void d.attach(items);
    }

    // ---------------------------------------------------------------- set-up

    function bindEvents() {
        const ps = PS();
        if (!ps || typeof ps.on !== 'function' || bindEvents.done) return;
        bindEvents.done = true;
        ps.on('changed', (m) => { if (loc && m && m.root === loc.root) refreshSoon(); });
        ps.on('config', async () => { await loadHello(false); if (loc && !cardOf(loc.root)) loc = null; refreshSoon(); });
    }

    let ready = null;
    function init(fn) {
        if (typeof fn === 'function') onChange = fn;
        sh = window.wmShell || sh;
        if (!ready) {
            ready = (async () => {
                await loadHello(false);
                bindEvents();
                if (available()) await loadAlbums();
                return available();
            })();
            ready.catch(() => { ready = null; });
        }
        return ready;
    }

    /** The Camera saved a file into a card folder: the albums and that folder again. */
    function added(root, path) {
        const dir = parentOf(path);
        // MediaStore indexes the new file a moment later: the folder's own list shows it at once
        void (async () => {
            await refresh({ quiet: true });
            if (!albumAt(root, dir)) albums.push({ root, path: dir, name: baseName(dir), count: 1, images: 1, videos: 0, newest: Date.now(), cover: path });
            if (loc && loc.root === root && loc.path === dir && !entries.some((e) => e.path === path)) {
                try {
                    const st = await PS().call('stat', { root, path });
                    entries.unshift({ name: st.name, path: st.path, mime: st.mime, size: st.size, mtime: st.mtime, taken: st.mtime, video: /^video\//.test(st.mime) });
                } catch (_) { /* the next refresh has it */ }
            }
            gridSig = '';
            onChange();
        })();
    }

    window.wmPhoneGallery = {
        available,
        init,
        location: () => (loc ? { ...loc } : null),
        open: (root, path) => open(root, path),
        startLocation,
        cards,
        folderItems,
        barLabel,
        barIcon: () => (loc ? 'fe-storage-card' : 'fe-device'),
        render,
        flush,
        search(q) { query = String(q || '').trim(); gridSig = ''; onChange(); },
        searching: () => !!query,
        sortItems,
        sortLabel: () => (SORTS.find(([k]) => k === sortBy) || SORTS[0])[1],
        setSort,
        softKeys,
        isPhoneSlide,
        viewerSoftKeys,
        viewerDelete,
        viewerDirector,
        cameraRoll,
        added,
        refresh: () => refresh()
    };
})();
