/**
 * Melaton Photo Gallery's library: Windows Photo Gallery's gallery view, 1:1 with the Vista VM (Yozora #446; captures in
 * ~/.cache/vista-vm/wpg/shots, strings and menus from PhotoLibraryResources.dll.mui). It lives in the Melaton Photo Gallery
 * window (#photoSwipeWindow, lightbox.js) next to the viewer, as in Vista: the window shows the gallery, a picture
 * opens in the viewer in the same window, and Back To Gallery comes back here.
 *
 * Yukimi's choices (Nov 20 2026, the issue's Decisions): four roots in the navigation tree - Pictures, DreamScape
 * Prints, DreamScape References, Folders - and a root per ActiveSync device, each with its own children; no ratings
 * (Prints have Favorites and Scraps there, References their types, Pictures a Favorites item); user tags and
 * captions (modules/glancewellStore.js; References keep their own tags and comment); Folders are the folders added
 * with Add Folder to Gallery. Desktop and DeX only.
 *
 * Layout (VM, 96 dpi): the tree on the left (18 px rows, 16 px icons from PhotoLibraryResources BITMAP 205, 10 px a
 * level); the view bar (view button, search box) 36 px; the groups ("Pictures - 8 items, 1 selected" in #919498 with
 * a #b2b6bb rule and a collapse arrow); thumbnails in a white 3 px frame, 21 px pitch over the size; the status line;
 * the Info pane (203 px) on the right. All on #eef3fa.
 *
 *   window.glancewellLibrary = {
 *     open(opts)          show the gallery (opens the window); opts.node = { root, kind, value }
 *     isOpen()            the window shows the gallery
 *     active()            the gallery owns the window (the viewer returns to it)
 *     showFromViewer(pic) Back To Gallery: close the viewer, select that picture
 *     enterViewer()       the viewer took the window (lightbox.js)
 *     currentPicture()    the focused print, in lightbox.js glancewellCurrentPicture's shape
 *     renderInfo(item)    the Info pane for a viewer slide (both modes share it)
 *     itemForSlide(data)  the library item behind a viewer slide
 *   }
 */
(function (root) {
    'use strict';

    const doc = root.document;
    // page listeners end with this file's segment (app-scope, #872/#890)
    const appScopeSignal = (root.melatonSegments && typeof root.melatonSegments.callerSignal === 'function' && root.melatonSegments.callerSignal()) || undefined;
    const SRC = () => root.glancewellSources;
    // page-level consts / classes of other scripts (not window properties): vfsClient.js, imageViewer.js, dovecote.js
    /* global vfsClient, ImageViewer, doveOpenComposeWindow */
    const vfs = () => (typeof vfsClient !== 'undefined' ? vfsClient : null);
    const viewerProto = () => (typeof ImageViewer !== 'undefined' ? ImageViewer.prototype : null);
    const doveCompose = () => (typeof doveOpenComposeWindow === 'function' ? doveOpenComposeWindow : null);
    const ws = () => root.wsClient || null;
    // the gallery reports its own failures: no "Unhandled exception" window as well (wsClient.handlesErrors)
    const quiet = (fn) => { const c = ws(); return c && typeof c.handlesErrors === 'function' ? c.handlesErrors(fn) : fn(); };
    const send = (type, data) => {
        const c = ws();
        return c && typeof c.sendMessage === 'function' ? quiet(() => c.sendMessage(type, data || {}, false)) : Promise.reject(new Error('offline'));
    };
    const ART = '/static_images/vista-photo-gallery';
    const PREFS_KEY = 'glancewellLibrary';
    const SIZE_MIN = 40;
    const SIZE_MAX = 256;
    const SIZE_DEFAULT = 96;
    const PAD = 21;            // thumbnail pitch over the picture's size (VM: 96 -> 117)
    const TEXT_ROW = 18;       // Thumbnails with Text: the date line
    const TILE_TEXT = 156;     // Tiles: the text column
    const HEADER_H = 21;       // a group header and the gap under it (VM: the cells start 12 px under the label)
    const GROUP_GAP = 12;
    const TOP_PAD = 4;
    const LEFT_PAD = 12;
    const TOC_W = 168; // the Visual Index's column (View > Table of Contents)
    const TOOLTIP_DELAY = 700;

    // the tree strip (BITMAP 205 / 1814): index -> icon
    const ICON = {
        all: 0, tags: 1, folders: 2, date: 3, recent: 4, ratings: 5, pictures: 6, videos: 7, newTag: 8, untagged: 9,
        tag: 10, folder: 11, folderPictures: 12, folderVideos: 13, folderUser: 14, disc: 16, computer: 17, year: 18,
        month: 19, day: 20, star: 21, starOff: 22,
        // DreamScape's root (Yukimi, Nov 21 2026: "select an icon that fits it better"): the strip's Pictures icon with a
        // gold sparkle, in the strip's last slot (lib-tree-16 / -20.png)
        dream: 23
    };

    const GROUPS = [
        ['auto', 'Auto'], ['date', 'Date Taken'], ['month', 'Month Taken'], ['year', 'Year Taken'], ['time', 'Time Taken'],
        ['filesize', 'File Size'], ['imagesize', 'Image Size'], ['type', 'File Type'], ['favorite', 'Favorites'],
        ['folder', 'Folder'], ['tag', 'Tag'], ['camera', 'Camera'], ['none', 'None']
    ];
    const SORTS = [
        ['date', 'Date Taken'], ['modified', 'Date Modified'], ['filesize', 'File Size'], ['imagesize', 'Image Size'],
        ['favorite', 'Favorites'], ['caption', 'Caption'], ['name', 'File Name']
    ];

    // Date Taken, newest first, grouped by Date Taken (Yukimi, Nov 21 2026); v2 moves older saved views onto it once
    const PREFS_V = 2;
    const prefs = Object.assign({
        view: 'thumbs', size: SIZE_DEFAULT, group: 'date', groupDir: 'desc', sort: 'date', sortDir: 'desc', toc: false,
        tooltips: true, expanded: { prints: true }, node: { root: 'prints', kind: 'all' }, pos: {}, at: 0
    }, readPrefs());
    if (!(prefs.v >= PREFS_V)) Object.assign(prefs, { v: PREFS_V, group: 'date', groupDir: 'desc', sort: 'date', sortDir: 'desc' });
    if (!prefs.pos || typeof prefs.pos !== 'object') prefs.pos = {};

    function readPrefs() {
        try { return JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { return {}; }
    }
    let prefsTimer = 0;
    let prefsPushTimer = 0;
    /**
     * The view (zoom, sort, group, folder, each folder's place) stays here at once and on the server a few seconds later,
     * so it comes back on any client and after a cold boot; reopening never waits on the server (installed-boot-zero-wait).
     */
    function savePrefs() {
        prefs.at = Date.now();
        clearTimeout(prefsTimer);
        prefsTimer = setTimeout(() => { try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* full */ } }, 400);
        clearTimeout(prefsPushTimer);
        prefsPushTimer = setTimeout(() => { void send('glancewell_settings_set', { view: viewPrefs() }).catch(() => {}); }, 3000);
    }
    const VIEW_KEYS = ['v', 'view', 'size', 'group', 'groupDir', 'sort', 'sortDir', 'toc', 'expanded', 'node', 'pos', 'at'];
    function viewPrefs() { const o = {}; VIEW_KEYS.forEach((k) => { if (prefs[k] !== undefined) o[k] = prefs[k]; }); return o; }
    /** The server's view when it is newer than this client's (another client, or this one before its storage went). */
    function adoptServerView(view) {
        if (!view || typeof view !== 'object' || !(Number(view.at) > (prefs.at || 0))) return false;
        VIEW_KEYS.forEach((k) => { if (k !== 'node' && view[k] !== undefined) prefs[k] = view[k]; });
        if (!prefs.pos || typeof prefs.pos !== 'object') prefs.pos = {};
        try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* full */ }
        return true;
    }

    // ------------------------------------------------------------------ state

    const S = {
        built: false,
        smartTags: [],        // Smart Tags (glancewell_smart_tags): [{ id, name, rule: { match, terms: [{ tag, neg }] } }]
        smartFiles: new Map(), // smart tag id -> Set of print filenames, matched when the tag is shown
        smartLoading: new Map(),
        smartError: '',
        open: false,          // the window shows the gallery
        owns: false,          // the gallery opened the window (the viewer comes back here)
        shell: null,
        el: {},
        node: prefs.node,
        history: [],
        future: [],
        loaded: new Map(),    // source id -> { items, loading, stale, promise }
        index: new Map(),     // source id -> glancewell_source_index (tags, captions, favorites, moved dates)
        tags: [],             // the user's tags
        watched: [],
        items: [],            // the node's pictures
        shown: [],            // after search, grouped and sorted
        groups: [],           // [{ key, label, items, collapsed, top, height }]
        collapsed: new Set(),
        selected: new Set(),
        focus: null,
        anchor: null,
        search: '',
        searchAll: false,
        layout: null,
        renderQueued: false,
        tipTimer: 0,
        tipFor: null,
        treeExpanded: new Set(Object.keys(prefs.expanded || {}).filter((k) => prefs.expanded[k])),
        editing: null,
        recent: new Set()     // the last import's VFS file ids (glancewell_recent_imports)
    };

    const itemsById = new Map();

    // ------------------------------------------------------------------ helpers

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    function h(tag, cls, text) {
        const e = doc.createElement(tag);
        if (cls) e.className = cls;
        if (text != null) e.textContent = text;
        return e;
    }
    const pad2 = (n) => String(n).padStart(2, '0');
    function dateText(t) {
        if (!t) return '';
        const d = new Date(t);
        let hr = d.getHours();
        const ap = hr >= 12 ? 'PM' : 'AM';
        hr = hr % 12 || 12;
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()} ${hr}:${pad2(d.getMinutes())} ${ap}`;
    }
    function dayText(t) {
        const d = new Date(t);
        return `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
    }
    const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
    function sizeText(bytes) {
        const b = Number(bytes) || 0;
        if (b < 1024) return `${b} bytes`;
        if (b < 1024 * 1024) return `${(b / 1024).toFixed(b < 10240 ? 2 : 1).replace(/\.0+$/, '')} KB`;
        if (b < 1024 * 1024 * 1024) return `${(b / 1048576).toFixed(b < 10485760 ? 2 : 1).replace(/\.0+$/, '')} MB`;
        return `${(b / 1073741824).toFixed(2)} GB`;
    }
    /** A thumbnail address with the item's revision, so a rotated or fixed picture is fetched again. */
    function thumbOf(it, px) {
        const u = it.thumb(px);
        if (!it.rev || !u) return u;
        return `${u}${u.includes('?') ? '&' : '?'}r=${it.rev}`;
    }
    // a video's line is its length, "3.85 MB (00:00:12)" (PhotoLibraryResources); a picture's its pixels
    const clockText = (sec) => {
        const t = Math.max(0, Math.round(Number(sec) || 0));
        const two = (n) => String(n).padStart(2, '0');
        return `${two(Math.floor(t / 3600))}:${two(Math.floor(t / 60) % 60)}:${two(t % 60)}`;
    };
    const dimsText = (it) => {
        if (it.video) return it.duration > 0 ? clockText(it.duration) : '';
        return it.width && it.height ? `${it.width} x ${it.height}` : '';
    };
    const countText = (n) => (n === 1 ? '1 item' : `${n} items`);
    const takenOf = (it) => {
        const ix = S.index.get(it.source);
        const moved = ix && ix.taken && ix.taken.get(it.key);
        return moved ? moved * 1000 : it.taken;
    };
    function captionOf(it) {
        if (it.source === 'refs' && SRC().get('refs').ownsMeta(it)) return it.refComment || '';
        const ix = S.index.get(it.source);
        return (ix && ix.captions && ix.captions.get(it.key)) || '';
    }
    function tagNamesOf(it) {
        if (it.source === 'refs' && SRC().get('refs').ownsMeta(it)) return it.refTags || [];
        const ix = S.index.get(it.source);
        const ids = (ix && ix.tagged && ix.tagged.get(it.key)) || [];
        return ids.map((id) => (S.tags.find((t) => t.id === id) || {}).name).filter(Boolean);
    }
    function isFavorite(it) {
        if (it.source === 'prints') return !!it.pinned;
        const ix = S.index.get(it.source);
        return !!(ix && ix.favorites && ix.favorites.has(it.key));
    }

    // ------------------------------------------------------------------ data

    async function loadIndex(source) {
        try {
            const r = await send('glancewell_source_index', { source });
            S.index.set(source, {
                tagged: new Map((r.tagged || []).map((x) => [x.key, x.tags])),
                captions: new Map((r.captions || []).map((x) => [x.key, x.caption])),
                favorites: new Set(r.favorites || []),
                taken: new Map((r.taken || []).map((x) => [x.key, x.taken]))
            });
        } catch (_) {
            S.index.set(source, { tagged: new Map(), captions: new Map(), favorites: new Set(), taken: new Map() });
        }
    }

    async function loadTags() {
        try { S.tags = (await send('glancewell_tags', {})).tags || []; } catch (_) { S.tags = []; }
    }

    async function loadRecent() {
        try { S.recent = new Set(((await send('glancewell_recent_imports', {})).items || []).map((x) => x.key)); } catch (_) { S.recent = new Set(); }
    }

    async function loadWatched() {
        try { S.watched = await SRC().get('folders').watched(); } catch (_) { S.watched = []; }
    }

    /** A root's pictures (each scope once; pushes mark it stale). Blocks show as they land. */
    function loadScope(sourceId, scope, cacheKey) {
        const key = cacheKey || sourceId;
        const have = S.loaded.get(key);
        if (have && !have.stale && (have.items || have.promise)) return have.promise || Promise.resolve(have.items);
        const entry = { items: [], stale: false, promise: null };
        S.loaded.set(key, entry);
        const src = SRC().get(sourceId);
        if (!src) { entry.items = []; return Promise.resolve([]); }
        entry.promise = Promise.all([src.list(scope || {}, (page) => {
            entry.items.push(...page);
            page.forEach((it) => itemsById.set(it.id, it));
            if (isCurrentKey(key)) { S.items = entry.items.slice(); refresh(); }
        }), S.index.has(sourceId) ? null : loadIndex(sourceId)]).then(([items]) => {
            entry.items = items;
            items.forEach((it) => itemsById.set(it.id, it));
            entry.promise = null;
            return items;
        }).catch((err) => {
            entry.promise = null;
            entry.error = (err && err.message) || 'The pictures could not be read.';
            return entry.items;
        });
        return entry.promise;
    }

    function scopeKeyOf(node) {
        if (node.root === 'prints') {
            const view = node.kind === 'favorites' ? 'pinned' : node.kind === 'scraps' ? 'scraps' : 'images';
            // Workspaces and a Smart Tag look across every workspace
            const wsId = node.kind === 'workspace' ? node.value : (node.kind === 'workspaces' || node.kind === 'smarttag') ? '*' : SRC().get('prints').activeWorkspaceId();
            return { key: `prints:${view}:${wsId}`, scope: { view, workspaceId: wsId } };
        }
        if (node.root === 'folders' && node.kind === 'folder') return { key: `folders:${node.value}`, scope: { folders: [{ path: node.value, name: node.label }] } };
        return { key: node.root, scope: {} };
    }
    function isCurrentKey(key) { return S.open && scopeKeyOf(S.node).key === key; }

    /** The node's pictures from its root's list. */
    function filterForNode(items, node) {
        switch (node.kind) {
            case 'favorites': return node.root === 'prints' ? items : items.filter(isFavorite);
            case 'untagged': return items.filter((it) => !tagNamesOf(it).length);
            case 'tag': {
                if (node.root === 'refs') return items.filter((it) => tagNamesOf(it).includes(node.value));
                const ids = new Set(tagTreeIds(Number(node.value)));
                const ix = S.index.get(node.root);
                return items.filter((it) => {
                    if (it.source === 'refs' && SRC().get('refs').ownsMeta(it)) return false;
                    const t = ix && ix.tagged && ix.tagged.get(it.key);
                    return !!t && t.some((x) => ids.has(x));
                });
            }
            case 'year': return items.filter((it) => new Date(takenOf(it)).getFullYear() === Number(node.value));
            case 'month': {
                const [y, m] = String(node.value).split('-').map(Number);
                return items.filter((it) => { const d = new Date(takenOf(it)); return d.getFullYear() === y && d.getMonth() === m; });
            }
            case 'day': return items.filter((it) => dayText(takenOf(it)) === node.value);
            case 'reftype': return items.filter((it) => it.refType === node.value);
            case 'smarttag': {
                const set = S.smartFiles.get(Number(node.value));
                if (!set) { void smartFilesFor(node.value); return []; }
                return items.filter((it) => set.has(it.key));
            }
            case 'album': return items.filter((it) => it.raw && `${it.raw.root}:${it.folder}` === node.value);
            case 'recent': return items.filter((it) => S.recent.has(it.key));
            case 'pictures': return items.filter((it) => !it.video);
            case 'videos': return items.filter((it) => it.video);
            default: return items;
        }
    }
    function tagTreeIds(id) {
        const out = [id];
        for (let i = 0; i < out.length; i++) S.tags.forEach((t) => { if (t.parentId === out[i]) out.push(t.id); });
        return out;
    }

    async function showNode(node, { history = true } = {}) {
        if (S.node && S.open && nodeKey(S.node) !== nodeKey(node)) rememberPlace();
        if (history && S.node && nodeKey(S.node) !== nodeKey(node)) { S.history.push(S.node); S.future = []; }
        S.node = node;
        prefs.node = node;
        savePrefs();
        S.selected.clear();
        S.focus = null;
        S.anchor = null;
        renderTree();
        syncNav();
        if (node.kind === 'smarttag') { S.smartFiles.delete(Number(node.value)); void smartFilesFor(node.value); }
        const { key, scope } = scopeKeyOf(node);
        const have = S.loaded.get(key);
        S.items = have ? have.items.slice() : [];
        refresh();
        const restore = !have || !restorePlace();
        await loadScope(node.root, scope, key);
        if (nodeKey(S.node) !== nodeKey(node)) return;
        S.items = (S.loaded.get(key) || {}).items || [];
        renderTree();
        refresh();
        if (restore) restorePlace();
    }

    // ------------------------------------------------------------------ each folder's place (Yukimi, Nov 21 2026:
    // "remember the zoom size and position in the gallery when you reopen it"): the picture at the top of the view and
    // how far into its row, so the place holds through a zoom change or new pictures; written only when the gallery
    // hides, opens the viewer or leaves the folder, never while scrolling
    const PLACES_MAX = 40;
    function rememberPlace() {
        // the last layout drawn: the one the place was seen in (showing the gallery again clears S.layout first)
        const L = S.lastLayout;
        if (!S.node || !L || !S.shown.length || !S.groups.length || S.groups[0].bodyTop == null) return;
        const top = S.seenTop || 0;
        let at = null;
        for (const g of S.groups) {
            if (g.collapsed || !g.items.length || top >= g.bottom) continue;
            const row = Math.max(0, Math.min(g.rows - 1, Math.floor((top - g.bodyTop) / L.m.ch)));
            at = { id: g.items[row * L.cols].id, off: Math.round(top - (g.bodyTop + row * L.m.ch)) };
            break;
        }
        const key = nodeKey(S.node);
        const prev = prefs.pos[key];
        if (prev && at && prev.id === at.id && prev.off === at.off) return;
        delete prefs.pos[key];
        if (at && top > 0) prefs.pos[key] = at;
        const keys = Object.keys(prefs.pos);
        if (keys.length > PLACES_MAX) keys.slice(0, keys.length - PLACES_MAX).forEach((k) => delete prefs.pos[k]);
        savePrefs();
    }
    /** The folder's saved place, or its top; false while its pictures are not here yet. */
    function restorePlace() {
        if (!S.open || !S.node) return false;
        const sc = S.el.scroller;
        const at = prefs.pos[nodeKey(S.node)];
        if (!at) { sc.scrollTop = 0; S.seenTop = S.placedTop = 0; return true; }
        const L = S.layout || computeLayout();
        for (const g of S.groups) {
            const k = g.items.findIndex((it) => it.id === at.id);
            if (k < 0) continue;
            if (g.collapsed) return true;
            sc.scrollTop = Math.max(0, g.bodyTop + Math.floor(k / L.cols) * L.m.ch + Math.max(0, Math.min(L.m.ch - 1, at.off || 0)));
            S.seenTop = S.placedTop = sc.scrollTop;
            queueRender();
            return true;
        }
        return false;
    }
    /** The phone's camera album: MediaStore's "Camera" bucket (DCIM/Camera). */
    const isCameraAlbum = (a) => !!a && (/^camera$/i.test(a.name || '') || /(^|\/)DCIM\/Camera\/?$/i.test(a.path || a.relativePath || ''));
    const nodeKey = (n) => `${n.root}|${n.kind}|${n.value == null ? '' : n.value}`;

    // ------------------------------------------------------------------ DOM

    function build() {
        if (S.built) return true;
        const shell = doc.getElementById('photoSwipeWindow');
        if (!shell) return false;
        S.shell = shell;
        const main = shell.querySelector('.wpg-main');
        const lib = h('div', 'wpg-lib');
        lib.hidden = true;
        const tree = h('div', 'wpg-lib-tree');
        tree.setAttribute('role', 'tree');
        tree.tabIndex = 0;
        const body = h('section', 'wpg-lib-body');
        const bar = h('div', 'wpg-lib-bar');
        const viewBtn = h('button', 'wpg-lib-viewbtn');
        viewBtn.type = 'button';
        viewBtn.title = 'Choose a thumbnail view.';
        viewBtn.innerHTML = '<span class="wpg-lib-viewbtn-icon"></span><span class="wpg-lib-viewbtn-drop"></span>';
        const search = h('div', 'wpg-lib-search');
        search.innerHTML = '<input type="search" placeholder="Search" aria-label="Search" spellcheck="false" title="Type to start a text filter on your current view."><button type="button" class="wpg-lib-search-go" tabindex="-1" aria-label="Search"></button><button type="button" class="wpg-lib-search-drop" tabindex="-1" aria-label="Search options"></button>';
        bar.append(viewBtn, search);
        const scroller = h('div', 'wpg-lib-scroll');
        scroller.tabIndex = 0;
        const toc = h('div', 'wpg-lib-toc');
        const canvas = h('div', 'wpg-lib-canvas');
        const empty = h('div', 'wpg-lib-empty');
        scroller.append(toc, canvas, empty);
        const status = h('div', 'wpg-lib-status');
        body.append(bar, scroller, status);
        lib.append(tree, body);
        main.insertBefore(lib, main.firstChild);
        const tip = h('div', 'wpg-lib-tip');
        tip.hidden = true;
        shell.appendChild(tip);

        // the band's Back / Forward orbs (14019 / 14020) stand where Back To Gallery is in the viewer
        const tb = shell.querySelector('.wpg-toolbar');
        const nav = h('div', 'wpg-lib-nav');
        nav.innerHTML = '<button type="button" class="wpg-lib-nav-back" title="Back (Alt+Left Arrow)" disabled></button><button type="button" class="wpg-lib-nav-fwd" title="Forward (Alt+Right Arrow)" disabled></button>';
        tb.insertBefore(nav, tb.firstChild);

        Object.assign(S.el, { lib, tree, body, bar, viewBtn, search, input: search.querySelector('input'), scroller, toc, canvas, empty, status, tip, nav, info: shell.querySelector('.wpg-info') });
        wire();
        S.built = true;
        return true;
    }

    function wire() {
        const E = S.el;
        E.tree.addEventListener('click', onTreeClick);
        E.tree.addEventListener('dblclick', onTreeDblClick);
        E.tree.addEventListener('keydown', onTreeKey);
        E.scroller.addEventListener('scroll', () => queueRender(), { passive: true });
        E.canvas.addEventListener('mousedown', onCanvasDown);
        E.canvas.addEventListener('dblclick', onCanvasDblClick);
        E.canvas.addEventListener('click', onCanvasClick);
        E.canvas.addEventListener('mouseover', onCanvasOver);
        E.canvas.addEventListener('mouseout', onCanvasOut);
        // drag pictures onto a tag (or Favorites) in the tree, as in Photo Gallery
        E.canvas.addEventListener('dragstart', onDragStart);
        E.tree.addEventListener('dragover', onTreeDragOver);
        E.tree.addEventListener('dragleave', (e) => { const r = e.target.closest && e.target.closest('.wpg-lib-node'); if (r) r.classList.remove('is-drop'); });
        E.tree.addEventListener('drop', onTreeDrop);
        E.scroller.addEventListener('keydown', onGridKey);
        E.toc.addEventListener('click', onTocClick);
        E.input.addEventListener('input', () => { S.search = E.input.value.trim(); refresh(); });
        E.input.addEventListener('keydown', (e) => { if (e.key === 'Escape') { E.input.value = ''; S.search = ''; refresh(); } });
        E.nav.querySelector('.wpg-lib-nav-back').addEventListener('click', () => goHistory(-1));
        E.nav.querySelector('.wpg-lib-nav-fwd').addEventListener('click', () => goHistory(1));
        if (typeof ResizeObserver === 'function') new ResizeObserver(() => { S.layout = null; queueRender(); }).observe(E.scroller);
        const cm = root.contextMenu;
        if (cm) {
            cm.attachClickMenuToElement(E.viewBtn, { sections: [], beforeShow: function () { this.sections = [{ type: 'list', items: viewMenuItems() }]; }, onAction: onViewMenu });
            cm.attachClickMenuToElement(E.search.querySelector('.wpg-lib-search-drop'), {
                sections: [],
                beforeShow: function () { this.sections = [{ type: 'list', items: [{ text: 'Search All Items in Photo Gallery', action: 'gwl-search-all', checked: S.searchAll, showIndicator: true }] }]; },
                onAction: (a) => { if (a === 'gwl-search-all') { S.searchAll = !S.searchAll; refresh(); } }
            });
            const itemMenu = { maxHeight: true, sections: [], beforeShow: function (event) { this.sections = itemMenuSections(event); }, onAction: onItemMenu };
            cm.attachToElement(E.scroller, itemMenu);
            const treeMenu = { sections: [], beforeShow: function (event) { this.sections = treeMenuSections(event); }, onAction: onTreeMenu };
            cm.attachToElement(E.tree, treeMenu);
        }
        // pushes (no polling): the gallery's own and the library store's
        const c = ws();
        if (c && typeof c.on === 'function') {
            const stale = (prefix) => { for (const [k, v] of S.loaded) if (k.startsWith(prefix)) v.stale = true; };
            const own = { signal: appScopeSignal };
            c.on('glancewell_changed', (m) => onStoreChanged((m && m.data) || m || {}), own);
            ['gallery_updated', 'workspace_image_added', 'workspace_updated'].forEach((t) => c.on(t, () => { stale('prints'); if (S.open && S.node.root === 'prints') reloadSoon(); }, own));
            ['reference_added', 'references_updated', 'workspace_references_updated'].forEach((t) => c.on(t, () => { stale('refs'); if (S.open && S.node.root === 'refs') reloadSoon(); }, own));
            c.on('vfs_updated', () => { stale('folders'); if (S.open && S.node.root === 'folders') reloadSoon(); }, own);
        }
    }

    let reloadTimer = 0;
    function reloadSoon() {
        clearTimeout(reloadTimer);
        reloadTimer = setTimeout(() => { if (S.open) void showNode(S.node, { history: false }); }, 600);
    }

    async function onStoreChanged(d) {
        if (d.what === 'imports') { await loadRecent(); if (S.node.kind === 'recent') refresh(); return; }
        if (d.what === 'settings') { await loadSettings(); return; }
        if (d.what === 'smarttags') {
            await loadSmartTags();
            S.smartFiles.clear();
            if (S.node.kind === 'smarttag') void smartFilesFor(S.node.value);
            renderTree();
            refresh();
            return;
        }
        if (d.what === 'watched') { await loadWatched(); for (const k of S.loaded.keys()) if (k.startsWith('folders')) S.loaded.get(k).stale = true; renderTree(); return; }
        if (d.what === 'tags' || d.tags) await loadTags();
        if (d.what === 'meta') {
            const sources = new Set((d.items || d.forgot || []).map((x) => x.source));
            await Promise.all([...sources].map(loadIndex));
        }
        renderTree();
        refresh();
        renderInfo();
    }

    // ------------------------------------------------------------------ Smart Tags (Yukimi, Nov 21 2026): prints found by
    // the tags in their positive or negative prompts, matched on the server each time the smart tag is shown

    async function loadSmartTags() {
        try { S.smartTags = ((await send('glancewell_smart_tags', {})) || {}).smartTags || []; } catch (_) { S.smartTags = []; }
        return S.smartTags;
    }

    function smartFilesFor(id) {
        const n = Number(id);
        if (S.smartFiles.has(n)) return Promise.resolve(S.smartFiles.get(n));
        if (S.smartLoading.has(n)) return S.smartLoading.get(n);
        S.smartError = '';
        const p = send('glancewell_smart_tag_files', { id: n }).then((r) => {
            const set = new Set((r && r.filenames) || []);
            S.smartFiles.set(n, set);
            return set;
        }, (err) => { S.smartError = errorText(err); return null; }).finally(() => {
            S.smartLoading.delete(n);
            if (S.node && S.node.kind === 'smarttag' && Number(S.node.value) === n) refresh();
        });
        S.smartLoading.set(n, p);
        return p;
    }

    /** The tag database's suggestions for what is typed (the autofill's own ranking, test_autofill_ranking). */
    async function autofillSuggestions(query) {
        const q = String(query || '').trim();
        if (q.length < 2) return [];
        let data = null;
        try { data = await send('test_autofill_ranking', { query: q }); } catch (_) { return []; }
        const d = data && (data.data || data);
        const list = (d && (d.results || d.suggestions || d.items || d.tags)) || [];
        return list.map((x) => (typeof x === 'string' ? { tag: x } : { tag: x.tag || x.name || x.text || '', count: Number(x.count || x.postCount || 0) || 0 }))
            .filter((x) => x.tag).slice(0, 12);
    }

    /**
     * Create Smart Tag / Edit Smart Tag: a name, the tags to look for (the autofill finds them in the tag database; each
     * is in the prompt or the negative prompt, a negative one tinted red) and whether a print needs all or any of them.
     * A Vista dialog of kit controls (Segoe dialog units).
     */
    async function editSmartTag(tag) {
        const rule = tag && tag.rule ? JSON.parse(JSON.stringify(tag.rule)) : { match: 'all', terms: [] };
        const html = kitText(7, 9, 30, 8, 'Name:') + kitEdit('wpg-smart-name', 40, 7, 213, tag ? tag.name : '', ' maxlength="200" data-autofocus')
            + kitText(7, 26, 246, 8, 'Find DreamScape prints whose prompts have these tags.')
            + kitEdit('wpg-smart-search', 7, 39, 192, '', ' aria-label="Search the tags"') + kitButton(203, 38, 50, 'Add', 'smart-add')
            + kitCheck('radio', 'wpgSmartPos', 'wpgSmartLane', 'pos', 7, 55, 100, 'In the prompt', true)
            + kitCheck('radio', 'wpgSmartNeg', 'wpgSmartLane', 'neg', 110, 55, 140, 'In the negative prompt', false, 'is-negative')
            + `<div class="tbp-ctl wpg-smart-terms" data-dlu="7,69,246,58" role="list"></div>`
            + kitText(7, 135, 60, 8, 'Show prints with:')
            + kitCheck('radio', 'wpgSmartAll', 'wpgSmartMatch', 'all', 68, 134, 88, 'all of these tags', rule.match !== 'any')
            + kitCheck('radio', 'wpgSmartAny', 'wpgSmartMatch', 'any', 160, 134, 88, 'any of these tags', rule.match === 'any')
            + kitButton(149, 155, 50, 'OK', 'ok') + kitButton(203, 155, 50, 'Cancel', 'cancel');
        const out = await kitDialog({
            id: 'glancewellSmartTag',
            title: tag && tag.id ? 'Edit Smart Tag' : 'Create Smart Tag',
            cls: 'wpg-smart',
            html,
            ready: (c, { signal }) => {
                const search = c.querySelector('.wpg-smart-search');
                const termsEl = c.querySelector('.wpg-smart-terms');
                const neg = () => c.querySelector('#wpgSmartNeg').checked;
                const drawTerms = () => {
                    termsEl.innerHTML = rule.terms.length
                        ? rule.terms.map((t, i) => `<span class="wpg-smart-term${t.neg ? ' is-negative' : ''}" role="listitem">${esc(t.tag)}<span class="wpg-smart-x" data-i="${i}" title="Remove" aria-label="Remove ${esc(t.tag)}"></span></span>`).join('')
                        : '<span class="wpg-smart-none">No tags yet: search for one above and click Add.</span>';
                };
                const add = (text) => {
                    const t = String(text || '').replace(/_/g, ' ').replace(/\s+/g, ' ').trim().toLowerCase();
                    if (!t) return;
                    if (!rule.terms.some((x) => x.tag === t && x.neg === neg())) rule.terms.push({ tag: t, neg: neg() });
                    search.value = '';
                    drawTerms();
                    search.focus();
                };
                // the tag database's autofill, as Studio's prompt boxes rank it
                attachSuggest(search, async (q) => (await autofillSuggestions(q)).map((x) => ({ text: x.tag, note: x.count ? x.count.toLocaleString() : '' })), (it) => add(it.text), signal);
                search.addEventListener('keydown', (e) => { if (e.key === 'Enter' && !e.defaultPrevented) { e.preventDefault(); add(search.value); } }, { signal });
                c.querySelector('[data-action="smart-add"]').addEventListener('click', () => add(search.value), { signal });
                termsEl.addEventListener('click', (e) => {
                    const x = e.target.closest('.wpg-smart-x');
                    if (!x) return;
                    rule.terms.splice(Number(x.dataset.i), 1);
                    drawTerms();
                }, { signal });
                drawTerms();
                return {
                    accept: () => {
                        const name = c.querySelector('.wpg-smart-name').value.trim();
                        if (!name) { void message('Type a name for the smart tag.', 'warning'); return false; }
                        if (!rule.terms.length) { void message('Add at least one tag to look for.', 'warning'); return false; }
                        return { name, rule: { match: c.querySelector('#wpgSmartAny').checked ? 'any' : 'all', terms: rule.terms } };
                    }
                };
            }
        });
        if (!out) return;
        try {
            const r = await send('glancewell_smart_tag_edit', tag && tag.id ? { op: 'update', id: tag.id, name: out.name, rule: out.rule } : { op: 'create', name: out.name, rule: out.rule });
            await loadSmartTags();
            S.treeExpanded.add('prints:tags');
            renderTree();
            if (r && r.id) void showNode({ root: 'prints', kind: 'smarttag', value: r.id });
        } catch (err) { await message(errorText(err), 'error'); }
    }

    // ------------------------------------------------------------------ tree

    function treeModel() {
        const out = [];
        const add = (node, depth, label, icon, opts = {}) => out.push(Object.assign({ node, depth, label, icon }, opts));
        const exp = (k) => S.treeExpanded.has(k);
        const rootRow = (id, label, icon, children) => {
            const has = children !== false;
            add({ root: id, kind: 'all' }, 0, label, icon, { key: id, expandable: has, expanded: exp(id) });
            return has && exp(id);
        };
        const tagRows = (rootId, depth) => {
            const k = `${rootId}:tags`;
            add({ root: rootId, kind: 'tags' }, depth, 'Tags', ICON.tags, { key: k, expandable: true, expanded: exp(k), noSelect: false });
            if (!exp(k)) return;
            if (rootId !== 'refs') add({ root: rootId, kind: 'newtag' }, depth + 1, 'Create a New Tag', ICON.newTag, { italic: true, action: 'newtag' });
            // DreamScape: Smart Tags, prints found by the tags in their prompts (Yukimi, Nov 21 2026)
            if (rootId === 'prints') add({ root: rootId, kind: 'newsmart' }, depth + 1, 'Create a Smart Tag', ICON.newTag, { italic: true, action: 'newsmart' });
            add({ root: rootId, kind: 'untagged' }, depth + 1, 'Not Tagged', ICON.untagged);
            if (rootId === 'prints') {
                S.smartTags.forEach((t) => add({ root: rootId, kind: 'smarttag', value: t.id }, depth + 1, t.name, ICON.tag, {
                    smartId: t.id,
                    // a smart tag that only looks in negative prompts reads red, as its tags do in the dialog
                    negative: t.rule.terms.length > 0 && t.rule.terms.every((x) => x.neg)
                }));
            }
            if (rootId === 'refs') {
                const names = new Set();
                ((S.loaded.get('refs') || {}).items || []).forEach((it) => (it.refTags || []).forEach((t) => names.add(t)));
                [...names].sort((a, b) => a.localeCompare(b)).forEach((n) => add({ root: rootId, kind: 'tag', value: n }, depth + 1, n, ICON.tag));
                return;
            }
            const walk = (parentId, d) => S.tags.filter((t) => (t.parentId || null) === parentId).forEach((t) => {
                const tk = `${rootId}:tag:${t.id}`;
                const kids = S.tags.some((x) => x.parentId === t.id);
                add({ root: rootId, kind: 'tag', value: t.id }, d, t.name, ICON.tag, { key: tk, expandable: kids, expanded: exp(tk), tagId: t.id });
                if (kids && exp(tk)) walk(t.id, d + 1);
            });
            walk(null, depth + 1);
        };
        const dateRows = (rootId, depth) => {
            const k = `${rootId}:date`;
            add({ root: rootId, kind: 'dates' }, depth, 'Date Taken', ICON.date, { key: k, expandable: true, expanded: exp(k) });
            if (!exp(k)) return;
            const items = rootItems(rootId);
            const years = new Map();
            items.forEach((it) => {
                const t = takenOf(it);
                if (!t) return;
                const d = new Date(t);
                const y = d.getFullYear();
                if (!years.has(y)) years.set(y, new Map());
                const months = years.get(y);
                const mk = `${y}-${d.getMonth()}`;
                if (!months.has(mk)) months.set(mk, new Set());
                months.get(mk).add(dayText(t));
            });
            [...years.keys()].sort((a, b) => a - b).forEach((y) => {
                const yk = `${rootId}:year:${y}`;
                add({ root: rootId, kind: 'year', value: y }, depth + 1, String(y), ICON.year, { key: yk, expandable: true, expanded: exp(yk) });
                if (!exp(yk)) return;
                const months = years.get(y);
                [...months.keys()].sort((a, b) => Number(a.split('-')[1]) - Number(b.split('-')[1])).forEach((mk) => {
                    const mkey = `${rootId}:month:${mk}`;
                    add({ root: rootId, kind: 'month', value: mk }, depth + 2, MONTHS[Number(mk.split('-')[1])], ICON.month, { key: mkey, expandable: true, expanded: exp(mkey) });
                    if (!exp(mkey)) return;
                    [...months.get(mk)].sort((a, b) => new Date(a) - new Date(b)).forEach((day) => {
                        const d = new Date(day);
                        add({ root: rootId, kind: 'day', value: day }, depth + 3, `${MONTHS[d.getMonth()].slice(0, 3)} ${d.getDate()}, ${['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'][d.getDay()]}`, ICON.day);
                    });
                });
            });
        };

        // Pictures: this device's library
        const pics = SRC().get('pictures');
        if (rootRow('pictures', 'Pictures', ICON.pictures)) {
            if (!pics.available()) add({ root: 'pictures', kind: 'none' }, 1, 'No pictures on this device', ICON.pictures, { disabled: true });
            // Albums: every album on this phone (MediaStore's, as the phone's own gallery lists them; Yukimi Nov 21 2026);
            // Camera Roll above it is the Camera album (DCIM/Camera), the phone's own pictures
            const ak = 'pictures:albums';
            if (pics.available() && !pics._albums && !pics._loading) {
                pics._loading = true;
                void pics.albums().then((a) => { pics._albums = a; pics._loading = false; renderTree(); }, () => { pics._albums = []; pics._loading = false; renderTree(); });
            }
            const cam = (pics._albums || []).find(isCameraAlbum);
            if (cam) add({ root: 'pictures', kind: 'album', value: `${cam.root}:${cam.name}`, album: cam }, 1, 'Camera Roll', ICON.pictures);
            add({ root: 'pictures', kind: 'albums' }, 1, 'Albums', ICON.folders, { key: ak, expandable: true, expanded: exp(ak) });
            if (exp(ak)) {
                (pics._albums || []).forEach((a) => add({ root: 'pictures', kind: 'album', value: `${a.root}:${a.name}`, album: a }, 2, a.name, ICON.folderPictures));
                if (pics._albums && !pics._albums.length) add({ root: 'pictures', kind: 'none' }, 2, 'No albums', ICON.folder, { disabled: true });
            }
            add({ root: 'pictures', kind: 'favorites' }, 1, 'Favorites', ICON.star);
            tagRows('pictures', 1);
            dateRows('pictures', 1);
        }
        // DreamScape (was "DreamScape Prints", Yukimi Nov 21 2026): its prints, References (was a root of its own) above
        // Workspaces, and Workspaces itself shows every workspace's prints, each marked with its workspace's colour
        if (rootRow('prints', 'DreamScape', ICON.dream)) {
            add({ root: 'prints', kind: 'favorites' }, 1, 'Favorites', ICON.star);
            add({ root: 'prints', kind: 'scraps' }, 1, 'Scraps', ICON.starOff);
            tagRows('prints', 1);
            dateRows('prints', 1);
            add({ root: 'refs', kind: 'all' }, 1, 'References', ICON.folderPictures, { key: 'refs', expandable: true, expanded: exp('refs') });
            if (exp('refs')) {
                SRC().get('refs').types.forEach((t) => add({ root: 'refs', kind: 'reftype', value: t.id }, 2, t.name, ICON.pictures));
                tagRows('refs', 2);
                dateRows('refs', 2);
            }
            const wk = 'prints:workspaces';
            add({ root: 'prints', kind: 'workspaces' }, 1, 'Workspaces', ICON.folders, { key: wk, expandable: true, expanded: exp(wk) });
            if (exp(wk)) SRC().get('prints').workspaces().forEach((w) => add({ root: 'prints', kind: 'workspace', value: w.id }, 2, w.name, ICON.folderPictures));
        }
        // Folders: the watched VFS folders, and the last import (Recently Imported)
        if (rootRow('folders', 'Folders', ICON.folders)) {
            add({ root: 'folders', kind: 'recent' }, 1, 'Recently Imported', ICON.recent);
            S.watched.forEach((f) => add({ root: 'folders', kind: 'folder', value: f.folder, label: f.name }, 1, f.name || f.folder, ICON.folderPictures, { watched: f }));
            if (!S.watched.length) add({ root: 'folders', kind: 'addfolder' }, 1, 'Add Folder to Gallery...', ICON.folder, { italic: true, action: 'addfolder' });
            tagRows('folders', 1);
            dateRows('folders', 1);
        }
        // a root per ActiveSync device
        SRC().devices().forEach((d) => {
            if (rootRow(d.id, d.label, ICON.computer, true)) {
                const albums = d._albums || [];
                if (!d._albums && !d._loading) {
                    d._loading = true;
                    void d.albums().then((a) => { d._albums = a; d._loading = false; renderTree(); }, () => { d._loading = false; });
                }
                albums.forEach((a) => add({ root: d.id, kind: 'album', value: `${a.root}:${a.name}`, album: a }, 1, a.name, ICON.folderPictures));
                add({ root: d.id, kind: 'favorites' }, 1, 'Favorites', ICON.star);
                tagRows(d.id, 1);
            }
        });
        return out;
    }

    function rootItems(rootId) {
        if (rootId === 'prints') return (S.loaded.get(scopeKeyOf({ root: 'prints', kind: 'all' }).key) || {}).items || [];
        return (S.loaded.get(rootId) || {}).items || [];
    }

    function renderTree() {
        if (!S.built) return;
        const rows = treeModel();
        S.treeRows = rows;
        const cur = nodeKey(S.node);
        const frag = doc.createDocumentFragment();
        rows.forEach((r, i) => {
            const row = h('div', 'wpg-lib-node');
            row.dataset.i = String(i);
            row.setAttribute('role', 'treeitem');
            row.style.setProperty('--depth', String(r.depth));
            if (r.expandable) row.setAttribute('aria-expanded', r.expanded ? 'true' : 'false');
            if (nodeKey(r.node) === cur) row.classList.add('is-current');
            if (r.italic) row.classList.add('is-italic');
            if (r.disabled) row.classList.add('is-disabled');
            const tw = h('span', 'wpg-lib-twisty');
            if (r.expandable) tw.classList.add(r.expanded ? 'is-open' : 'is-closed');
            const ic = h('span', 'wpg-lib-node-icon');
            if (r.node.root.startsWith('device:') && r.depth === 0) {
                // the device as Explorer and Mobile Device Center show it: a modern phone or a Fold
                ic.classList.add('is-device');
                const file = root.activeSync && typeof root.activeSync.deviceIcon === 'function' ? root.activeSync.deviceIcon(r.node.root.slice(7), 16) : '';
                if (/fold/.test(file)) ic.classList.add('is-fold'); else if (/phone/.test(file)) ic.classList.add('is-phone');
            }
            else if (r.smartId) ic.classList.add('is-smart');
            else ic.style.setProperty('--i', String(r.icon));
            if (r.negative) row.classList.add('is-negative');
            const lb = h('span', 'wpg-lib-node-label', r.label);
            row.append(tw, ic, lb);
            frag.appendChild(row);
        });
        S.el.tree.replaceChildren(frag);
    }

    function toggleTree(r) {
        const k = r.key;
        if (!k) return;
        if (S.treeExpanded.has(k)) S.treeExpanded.delete(k); else S.treeExpanded.add(k);
        prefs.expanded = Object.fromEntries([...S.treeExpanded].map((x) => [x, true]));
        savePrefs();
        if (S.treeExpanded.has(k) && /:date$|:year:|:month:/.test(k)) void loadScope(r.node.root, scopeKeyOf({ root: r.node.root, kind: 'all' }).scope, scopeKeyOf({ root: r.node.root, kind: 'all' }).key).then(renderTree);
        renderTree();
    }

    function onTreeClick(e) {
        const rowEl = e.target.closest('.wpg-lib-node');
        if (!rowEl) return;
        const r = S.treeRows[Number(rowEl.dataset.i)];
        if (!r || r.disabled) return;
        if (e.target.closest('.wpg-lib-twisty')) { toggleTree(r); return; }
        if (r.action === 'newtag') { void createTagInline(r.node.root); return; }
        if (r.action === 'newsmart') { void editSmartTag(null); return; }
        if (r.action === 'addfolder') { addFolderToGallery(); return; }
        if (['tags', 'dates', 'albums'].includes(r.node.kind)) { toggleTree(r); return; }
        void showNode(r.node.kind === 'folder' ? Object.assign({}, r.node) : r.node);
    }
    function onTreeDblClick(e) {
        const rowEl = e.target.closest('.wpg-lib-node');
        const r = rowEl && S.treeRows[Number(rowEl.dataset.i)];
        if (r && r.expandable && !e.target.closest('.wpg-lib-twisty')) toggleTree(r);
    }
    function onTreeKey(e) {
        const rows = S.treeRows || [];
        let i = rows.findIndex((r) => nodeKey(r.node) === nodeKey(S.node));
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const step = e.key === 'ArrowDown' ? 1 : -1;
            do { i += step; } while (rows[i] && (rows[i].disabled || rows[i].action));
            if (rows[i]) void showNode(rows[i].node);
        } else if ((e.key === 'ArrowRight' || e.key === 'ArrowLeft') && rows[i] && rows[i].expandable) {
            e.preventDefault();
            if ((e.key === 'ArrowRight') !== !!rows[i].expanded) toggleTree(rows[i]);
        } else if (e.key === 'F2' && rows[i] && rows[i].tagId) {
            e.preventDefault();
            void renameTagInline(rows[i]);
        } else if (e.key === 'Delete' && rows[i] && rows[i].tagId) {
            e.preventDefault();
            void deleteTag(rows[i]);
        }
    }

    /** "Create a New Tag": an edit box in the tree, "New Tag" selected (WPG 1652). */
    async function createTagInline(rootId) {
        const rows = S.treeRows || [];
        const at = rows.findIndex((r) => r.node.root === rootId && r.node.kind === 'newtag');
        const rowEl = S.el.tree.children[at];
        if (!rowEl) return;
        const name = await inlineEdit(rowEl, 'New Tag');
        if (!name) return;
        try {
            await send('glancewell_tag_edit', { op: 'create', name });
        } catch (err) {
            await message(errorText(err), 'error');
        }
    }

    async function renameTagInline(r) {
        const rowEl = S.el.tree.children[S.treeRows.indexOf(r)];
        const name = await inlineEdit(rowEl, r.label);
        if (!name || name === r.label) return;
        try {
            const out = await send('glancewell_tag_edit', { op: 'rename', id: r.tagId, name });
            if (out && out.conflict) {
                // WPG 1808: merge the two tags and their sub-tags
                if (await confirmBox(`Another tag with the name '${name}' was found.  Would you like to continue?  If you select Yes, then the two tags and all their sub-tags will be merged.`, 'Tag name already exists.')) {
                    await send('glancewell_tag_edit', { op: 'merge', id: r.tagId, into: out.id });
                }
            }
        } catch (err) {
            await message(errorText(err), 'error');
        }
    }

    async function deleteTag(r) {
        // WPG 2780
        if (!await confirmBox('If you delete this tag, you delete it from all pictures and videos that have this tag assigned.', 'Delete Tag')) return;
        try { await send('glancewell_tag_edit', { op: 'delete', id: r.tagId }); } catch (err) { await message(errorText(err), 'error'); }
    }

    const DRAG_TYPE = 'application/x-glancewell-items';
    function onDragStart(e) {
        const cell = e.target.closest && e.target.closest('.wpg-lib-cell');
        if (!cell) return;
        hideTip();
        if (!S.selected.has(cell.dataset.id)) select(cell.dataset.id);
        e.dataTransfer.setData(DRAG_TYPE, JSON.stringify([...S.selected]));
        e.dataTransfer.effectAllowed = 'copy';
    }
    /** A tree row that takes dropped pictures: a tag (its own root's), Favorites (not the prints', which are pins). */
    function dropRow(e) {
        const rowEl = e.target.closest && e.target.closest('.wpg-lib-node');
        const r = rowEl && S.treeRows[Number(rowEl.dataset.i)];
        if (!r) return null;
        if (r.node.kind === 'tag' || (r.node.kind === 'favorites' && r.node.root !== 'prints')) return { rowEl, r };
        return null;
    }
    function onTreeDragOver(e) {
        if (![...e.dataTransfer.types].includes(DRAG_TYPE)) return;
        const hit = dropRow(e);
        S.el.tree.querySelectorAll('.is-drop').forEach((x) => { if (!hit || x !== hit.rowEl) x.classList.remove('is-drop'); });
        if (!hit) return;
        e.preventDefault();
        e.dataTransfer.dropEffect = 'copy';
        hit.rowEl.classList.add('is-drop');
    }
    async function onTreeDrop(e) {
        const hit = dropRow(e);
        S.el.tree.querySelectorAll('.is-drop').forEach((x) => x.classList.remove('is-drop'));
        if (!hit) return;
        e.preventDefault();
        let ids = [];
        try { ids = JSON.parse(e.dataTransfer.getData(DRAG_TYPE) || '[]'); } catch (_) { ids = []; }
        const items = ids.map((id) => itemsById.get(id)).filter(Boolean);
        if (!items.length) return;
        if (hit.r.node.kind === 'favorites') {
            const mine = items.filter((it) => it.source === hit.r.node.root);
            if (mine.length) await send('glancewell_meta_set', { items: mine.map(ref), change: { favorite: true } });
            return;
        }
        // a References tag goes on references only; the user's tags on everything else
        const name = hit.r.node.root === 'refs' ? hit.r.node.value : hit.r.label;
        const fit = items.filter((it) => (hit.r.node.root === 'refs') === (it.source === 'refs' && SRC().get('refs').ownsMeta(it)));
        if (fit.length) await addTag(fit, name);
    }

    function inlineEdit(rowEl, initial) {
        return new Promise((resolve) => {
            const label = rowEl.querySelector('.wpg-lib-node-label');
            const input = h('input', 'wpg-lib-node-edit');
            input.value = initial;
            label.replaceWith(input);
            input.focus();
            input.select();
            let done = false;
            const finish = (ok) => {
                if (done) return;
                done = true;
                const v = input.value.trim();
                input.replaceWith(label);
                resolve(ok ? v : '');
                S.el.tree.focus();
            };
            input.addEventListener('keydown', (e) => {
                e.stopPropagation();
                if (e.key === 'Enter') finish(true);
                else if (e.key === 'Escape') finish(false);
                // WPG 976 / 13004: no slash or semicolon in a tag
                else if (e.key === '/' || e.key === ';') e.preventDefault();
            });
            input.addEventListener('blur', () => finish(true));
        });
    }

    function treeMenuSections(event) {
        const rowEl = event.target.closest('.wpg-lib-node');
        const r = rowEl && S.treeRows[Number(rowEl.dataset.i)];
        S.treeMenuRow = r || null;
        if (!r) return [];
        const items = [];
        if (r.expandable) items.push(r.expanded ? { text: 'Collapse', action: 'gwt-toggle' } : { text: 'Expand', action: 'gwt-toggle' });
        if (r.tagId) {
            items.push({ text: 'Create Tag', action: 'gwt-subtag' }, { separator: true }, { text: 'Rename', action: 'gwt-rename' }, { text: 'Delete', action: 'gwt-delete' });
        } else if (r.smartId) {
            items.push({ text: 'Edit Smart Tag...', action: 'gwt-smartedit' }, { separator: true }, { text: 'Delete', action: 'gwt-smartdelete' });
        } else if (r.node.kind === 'tags' && r.node.root !== 'refs') {
            items.push({ text: 'Create Tag', action: 'gwt-newtag' });
            if (r.node.root === 'prints') items.push({ text: 'Create Smart Tag...', action: 'gwt-newsmart' });
        } else if (r.node.root === 'folders' && (r.node.kind === 'all' || r.node.kind === 'folder')) {
            items.push({ text: 'Add Folder to Gallery...', action: 'gwt-addfolder' });
            if (r.watched) items.push({ separator: true }, { text: 'Remove from Gallery', action: 'gwt-removefolder' });
        }
        return items.length ? [{ type: 'list', items }] : [];
    }

    async function onTreeMenu(action) {
        const r = S.treeMenuRow;
        if (!r) return;
        if (action === 'gwt-toggle') toggleTree(r);
        else if (action === 'gwt-rename') void renameTagInline(r);
        else if (action === 'gwt-delete') void deleteTag(r);
        else if (action === 'gwt-newtag') void createTagInline(r.node.root);
        else if (action === 'gwt-newsmart') void editSmartTag(null);
        else if (action === 'gwt-smartedit') void editSmartTag(S.smartTags.find((t) => t.id === r.smartId) || null);
        else if (action === 'gwt-smartdelete') {
            const t = S.smartTags.find((x) => x.id === r.smartId);
            if (t && await confirmBox(`Are you sure you want to delete the smart tag "${t.name}"? The pictures are not changed.`, 'Delete Smart Tag')) {
                try { await send('glancewell_smart_tag_edit', { op: 'delete', id: t.id }); } catch (err) { await message(errorText(err), 'error'); }
                if (S.node.kind === 'smarttag' && Number(S.node.value) === t.id) void showNode({ root: 'prints', kind: 'all' });
            }
        }
        else if (action === 'gwt-subtag') {
            try { await send('glancewell_tag_edit', { op: 'create', name: 'New Tag', parentId: r.tagId }); } catch (err) { await message(errorText(err), 'error'); }
            S.treeExpanded.add(r.key);
        } else if (action === 'gwt-addfolder') addFolderToGallery();
        else if (action === 'gwt-removefolder' && r.watched) {
            // WPG 896 / 2801
            const ok = await confirmBox(`Are you sure you want to remove this folder from Photo Gallery?\n\nNote: Pictures and videos in this folder will not be deleted from their storage location.`, 'Remove Folder from Gallery');
            if (ok) { S.watched = await SRC().get('folders').setWatched({ remove: [r.watched.folder] }); renderTree(); }
        }
    }

    /** File > Add Folder to Gallery: the shared Select Folder dialog (studioSession.js). */
    function addFolderToGallery() {
        if (typeof root.studioOpenFolderDialog !== 'function') return;
        root.studioOpenFolderDialog('folder', {
            owner: S.shell,
            host: {
                title: 'Add Folder to Gallery',
                onSave: async ({ path }) => {
                    const name = await folderName(path);
                    S.watched = await SRC().get('folders').setWatched({ add: [{ folder: path, name }] });
                    S.treeExpanded.add('folders');
                    renderTree();
                    // WPG 1632
                    void message('This folder has been added to your Gallery.', 'info');
                    return true;
                }
            }
        });
    }
    /** A VFS folder's name: its entry in the parent's listing (the path may be ids). */
    async function folderName(path) {
        const parts = String(path).split('/').filter(Boolean);
        const last = parts[parts.length - 1] || path;
        if (!vfs()) return last;
        try {
            const res = await vfs().listDirectory(`/${parts.slice(0, -1).join('/')}`, { offset: 0, limit: 1000 });
            const hit = ((res && res.items) || []).find((e) => e.navPath === path || e.id === last || e.name === last);
            if (hit && hit.name) return hit.name;
        } catch (_) { /* the path */ }
        return last;
    }

    function goHistory(step) {
        const from = step < 0 ? S.history : S.future;
        const to = step < 0 ? S.future : S.history;
        const n = from.pop();
        if (!n) return;
        to.push(S.node);
        void showNode(n, { history: false });
    }
    function syncNav() {
        if (!S.built) return;
        S.el.nav.querySelector('.wpg-lib-nav-back').disabled = !S.history.length;
        S.el.nav.querySelector('.wpg-lib-nav-fwd').disabled = !S.future.length;
    }

    // ------------------------------------------------------------------ view: search, sort, group

    function searchMatch(it, q) {
        if (!q) return true;
        const hay = [it.name, captionOf(it), ...tagNamesOf(it)].join('\n').toLowerCase();
        return q.toLowerCase().split(/\s+/).every((w) => hay.includes(w));
    }

    function sortKey(it) {
        switch (prefs.sort) {
            case 'modified': return it.modified || 0;
            case 'filesize': return it.size || 0;
            case 'imagesize': return (it.width || 0) * (it.height || 0);
            case 'favorite': return isFavorite(it) ? 1 : 0;
            case 'caption': return captionOf(it).toLowerCase();
            case 'name': return String(it.name || '').toLowerCase();
            default: return takenOf(it) || 0;
        }
    }

    function groupOf(it) {
        let mode = prefs.group;
        if (mode === 'auto') mode = S.node.root === 'folders' || S.node.kind === 'album' ? 'folder' : (S.node.kind === 'tag' ? 'tag' : 'none');
        const t = takenOf(it);
        const d = new Date(t || 0);
        switch (mode) {
            case 'date': return t ? [dayText(t), new Date(d.getFullYear(), d.getMonth(), d.getDate()).getTime()] : ['Unknown', -1];
            case 'month': return t ? [`${MONTHS[d.getMonth()]} ${d.getFullYear()}`, d.getFullYear() * 12 + d.getMonth()] : ['Unknown', -1];
            case 'year': return t ? [String(d.getFullYear()), d.getFullYear()] : ['Unknown', -1];
            case 'time': {
                const hr = d.getHours();
                const band = hr < 6 ? ['Night', 0] : hr < 12 ? ['Morning', 1] : hr < 18 ? ['Afternoon', 2] : ['Evening', 3];
                return t ? band : ['Unknown', -1];
            }
            case 'filesize': {
                const b = it.size || 0;
                return b < 10240 ? ['Tiny (0 - 10 KB)', 0] : b < 102400 ? ['Small (10 - 100 KB)', 1] : b < 1048576 ? ['Medium (100 KB - 1 MB)', 2] : b < 16777216 ? ['Large (1 - 16 MB)', 3] : b < 134217728 ? ['Huge (16 - 128 MB)', 4] : ['Gigantic (> 128 MB)', 5];
            }
            case 'imagesize': {
                const px = (it.width || 0) * (it.height || 0);
                return !px ? ['Unknown', -1] : px < 480 * 640 ? ['Small', 0] : px < 1280 * 1024 ? ['Medium', 1] : px < 2560 * 1600 ? ['Large', 2] : ['Extra Large', 3];
            }
            case 'type': { const x = SRC().extOf(it.name).toUpperCase(); return [x ? `${x} File` : 'File', x]; }
            case 'favorite': return isFavorite(it) ? ['Favorites', 1] : ['Not a Favorite', 0];
            case 'folder': return [it.folder || 'Unknown', String(it.folder || '').toLowerCase()];
            case 'tag': { const t2 = tagNamesOf(it); return t2.length ? [t2[0], t2[0].toLowerCase()] : ['Not Tagged', '']; }
            case 'camera': { const m = it.raw && (it.raw.model || (it.raw.metadata && it.raw.metadata.model)); return [m || 'Unknown', String(m || '')]; }
            default: return [null, 0];
        }
    }

    function nodeTitle() {
        const r = (S.treeRows || []).find((x) => nodeKey(x.node) === nodeKey(S.node));
        return r ? r.label : 'Gallery';
    }

    /** Search, sort and group the node's pictures (refresh), then lay out and draw what is in view. */
    function refresh() {
        if (!S.built) return;
        let base = S.items;
        if (S.search && S.searchAll) {
            base = [];
            for (const v of S.loaded.values()) base.push(...(v.items || []));
            base = [...new Map(base.map((it) => [it.id, it])).values()];
        } else base = filterForNode(base, S.node);
        const list = base.filter((it) => searchMatch(it, S.search));
        const dir = prefs.sortDir === 'desc' ? -1 : 1;
        list.sort((a, b) => {
            const x = sortKey(a); const y = sortKey(b);
            return (x < y ? -1 : x > y ? 1 : 0) * dir || String(a.name).localeCompare(String(b.name));
        });
        const groups = new Map();
        list.forEach((it) => {
            const [label, order] = groupOf(it);
            const k = label == null ? '' : label;
            if (!groups.has(k)) groups.set(k, { key: k, label: k || nodeTitle(), order, items: [] });
            groups.get(k).items.push(it);
        });
        const gdir = prefs.groupDir === 'asc' ? 1 : -1;
        S.groups = [...groups.values()].sort((a, b) => (a.order < b.order ? -1 : a.order > b.order ? 1 : 0) * gdir);
        S.shown = S.groups.flatMap((g) => g.items);
        // drop a selection that left the view
        const shownIds = new Set(S.shown.map((it) => it.id));
        [...S.selected].forEach((id) => { if (!shownIds.has(id)) S.selected.delete(id); });
        if (S.focus && !shownIds.has(S.focus)) S.focus = null;
        S.layout = null;
        queueRender();
        renderStatus();
        renderInfo();
        syncCommands();
    }

    // ------------------------------------------------------------------ layout and drawing (only the rows in view)

    function metrics() {
        const box = prefs.size;
        if (prefs.view === 'tiles') return { box, cw: box + PAD + TILE_TEXT, ch: box + PAD };
        if (prefs.view === 'text') return { box, cw: box + PAD, ch: box + PAD + TEXT_ROW };
        return { box, cw: box + PAD, ch: box + PAD };
    }

    function computeLayout() {
        const sc = S.el.scroller;
        const m = metrics();
        const left = (prefs.toc ? TOC_W : 0) + LEFT_PAD;
        const width = Math.max(m.cw, sc.clientWidth - left - 14);
        const cols = Math.max(1, Math.floor(width / m.cw));
        let y = TOP_PAD;
        const showHeaders = !(S.groups.length === 1 && !S.groups[0].key && false);
        S.groups.forEach((g) => {
            g.top = y;
            y += showHeaders ? HEADER_H : 0;
            g.collapsed = S.collapsed.has(g.key);
            g.rows = g.collapsed ? 0 : Math.ceil(g.items.length / cols);
            g.bodyTop = y;
            y += g.rows * m.ch + GROUP_GAP;
            g.bottom = y;
        });
        S.layout = { m, left, cols, height: y + 8, showHeaders };
        S.lastLayout = S.layout;
        S.el.canvas.style.height = `${S.layout.height}px`;
        S.el.toc.hidden = !prefs.toc;
        S.el.lib.classList.toggle('has-toc', !!prefs.toc);
        S.el.lib.dataset.view = prefs.view;
        S.el.empty.hidden = !!S.shown.length;
        if (!S.shown.length) S.el.empty.textContent = emptyText();
        return S.layout;
    }

    function emptyText() {
        const have = S.loaded.get(scopeKeyOf(S.node).key);
        if (have && have.promise && !have.items.length) return '';
        if (have && have.error) return have.error;
        if (S.node.kind === 'smarttag' && !S.smartFiles.has(Number(S.node.value))) return S.smartError || 'Searching the prompts...';
        if (S.search) return 'No items match your search.';
        if (S.node.root === 'folders' && !S.watched.length) return 'There are no pictures or videos in Photo Gallery.\nTo get started, click the File menu, and then click Add Folder to Gallery.';
        return 'There are no pictures or videos in this view.';
    }

    function queueRender() {
        if (S.renderQueued || !S.open) return;
        S.renderQueued = true;
        root.requestAnimationFrame(() => { S.renderQueued = false; draw(); });
    }

    function draw() {
        if (!S.open || !S.built) return;
        const L = S.layout || computeLayout();
        const sc = S.el.scroller;
        S.seenTop = sc.scrollTop;
        const top = sc.scrollTop - 200;
        const bottom = sc.scrollTop + sc.clientHeight + 200;
        const nodes = [];
        const { m, left, cols } = L;
        S.groups.forEach((g) => {
            if (g.bottom < top || g.top > bottom) return;
            if (L.showHeaders) {
                const hd = h('div', 'wpg-lib-group');
                hd.dataset.group = g.key;
                hd.style.cssText = `top:${g.top}px;left:${left - 3}px;right:12px`;
                const sel = g.items.filter((it) => S.selected.has(it.id)).length;
                hd.innerHTML = `<span class="wpg-lib-group-label">${esc(g.label)} - ${esc(countText(g.items.length))}${sel ? `, ${sel} selected` : ''}</span><span class="wpg-lib-group-rule"></span><button type="button" class="wpg-lib-group-arrow${g.collapsed ? ' is-collapsed' : ''}" title="${g.collapsed ? 'Expand Group' : 'Collapse Group'}"></button>`;
                nodes.push(hd);
            }
            if (g.collapsed) return;
            const first = Math.max(0, Math.floor((top - g.bodyTop) / m.ch));
            const last = Math.min(g.rows - 1, Math.floor((bottom - g.bodyTop) / m.ch));
            for (let r = first; r <= last; r++) {
                for (let c = 0; c < cols; c++) {
                    const it = g.items[r * cols + c];
                    if (!it) break;
                    nodes.push(cellFor(it, left + c * m.cw, g.bodyTop + r * m.ch, m));
                }
            }
        });
        // cells still in view stay where they are: one taken out and put back between a press and its release loses
        // the click, and with it a double-click's second click (a draw queued by the first press often lands there)
        const canvas = S.el.canvas;
        const keep = new Set(nodes);
        for (const ch of [...canvas.children]) if (!keep.has(ch)) ch.remove();
        for (const n of nodes) if (n.parentNode !== canvas) canvas.appendChild(n);
        if (prefs.toc) drawToc();
    }

    const cellCache = new Map(); // id|view|size -> element (reused while it stays in view)
    function cellFor(it, x, y, m) {
        // the workspace's glass square in the corner, where prints of every workspace show together (Workspaces)
        const badge = it.source === 'prints' && S.node && S.node.root === 'prints' && (S.node.kind === 'workspaces' || S.node.kind === 'smarttag') ? (it.workspaceId || '') : '';
        const k = `${it.id}|${prefs.view}|${m.box}|${it.rev || 0}|${badge}`;
        let cell = cellCache.get(k);
        if (!cell) {
            cell = h('div', 'wpg-lib-cell');
            cell.dataset.id = it.id;
            cell.draggable = true;
            const fr = h('div', 'wpg-lib-frame');
            const img = h('img', 'wpg-lib-img');
            img.alt = '';
            img.decoding = 'async';
            img.loading = 'lazy';
            img.draggable = false;
            img.addEventListener('load', () => cell.classList.add('is-loaded'), { once: true });
            img.addEventListener('error', () => cell.classList.add('is-broken'), { once: true });
            // no address (a video nothing has a frame of): the empty frame, not a request for the page itself
            const src = thumbOf(it, m.box * (root.devicePixelRatio || 1));
            if (src) img.src = src; else cell.classList.add('is-broken');
            if (it.video) fr.classList.add('is-video');
            if (badge) {
                // on the picture's own corner: the square rides in a box that hugs the picture
                const pic = h('span', 'wpg-lib-pic');
                const b = h('span', 'wpg-lib-ws');
                b.style.setProperty('--ws', workspaceColor(badge));
                b.title = SRC().get('prints').workspaces().find((w) => w.id === badge)?.name || badge;
                pic.append(img, b);
                fr.appendChild(pic);
            } else fr.appendChild(img);
            cell.appendChild(fr);
            if (prefs.view !== 'thumbs') cell.appendChild(h('div', 'wpg-lib-text'));
            if (cellCache.size > 1500) cellCache.clear();
            cellCache.set(k, cell);
        }
        cell.style.cssText = `left:${x}px;top:${y}px;width:${m.cw - 2}px;height:${m.ch - 2}px;--box:${m.box}px`;
        cell.classList.toggle('is-selected', S.selected.has(it.id));
        cell.classList.toggle('is-focus', S.focus === it.id);
        const tx = cell.querySelector('.wpg-lib-text');
        if (tx) {
            // written only when it changed: a node replaced under the pointer loses its click
            if (prefs.view === 'text') {
                const t = dateText(takenOf(it));
                if (tx.textContent !== t) tx.textContent = t;
            } else {
                const cap = captionOf(it);
                const html = `<div class="wpg-lib-t-name">${esc(it.name)}</div><div>${esc(dateText(takenOf(it)))}</div><div class="wpg-lib-t-dim">${esc(sizeText(it.size))}</div><div class="wpg-lib-t-dim">${esc(dimsText(it))}</div><div class="wpg-lib-t-cap${cap ? '' : ' is-empty'}">${esc(cap || '<Add Caption>')}</div>`;
                if (tx.gwHtml !== html) { tx.innerHTML = html; tx.gwHtml = html; }
            }
        }
        return cell;
    }

    /** A workspace's own colour (its settings), else one of a few distinct hues by its id. */
    function workspaceColor(id) {
        /* global workspaces */
        const w = typeof workspaces !== 'undefined' && workspaces ? workspaces[id] : null;
        if (w && w.color) return w.color;
        let hsh = 0;
        for (const ch of String(id)) hsh = (hsh * 31 + ch.charCodeAt(0)) >>> 0;
        return `hsl(${hsh % 360}, 70%, 50%)`;
    }

    /**
     * Table of Contents, as the Workspaces app's Visual Index (Yukimi, Nov 21 2026: "we use that for Visual Index"): a
     * column of cards down the left, one per group of the view (the gallery's own groups; with one group, the runs of
     * pictures taken close together), each its first picture, its name and its count. The card over what is in view
     * is lit and kept in sight; a click goes there. The cards are built when the groups change; scrolling only moves
     * the light.
     */
    const TOC_GAP_MS = 2 * 3600 * 1000;
    function tocEntries() {
        if (S.groups.length > 1) return S.groups.map((g) => ({ key: `g:${g.key}`, label: g.label || 'Untitled', items: g.items, group: g }));
        // one group: the pictures in the order shown, cut where two hours pass between them (or every 300)
        const list = S.shown;
        const out = [];
        let cur = null;
        list.forEach((it, i) => {
            const t = takenOf(it) || 0;
            if (!cur || cur.items.length >= 300 || (t && cur.last && Math.abs(cur.last - t) > TOC_GAP_MS)) { cur = { key: `s:${i}`, items: [], first: t, last: t }; out.push(cur); }
            cur.items.push(it);
            if (t) cur.last = t;
        });
        out.forEach((e) => { e.label = e.first ? dateText(e.first) : 'Pictures'; });
        return out;
    }
    function drawToc() {
        const L = S.layout;
        const sc = S.el.scroller;
        const toc = S.el.toc;
        const key = `${S.groups.map((g) => `${g.key}:${g.items.length}`).join('|')}|${S.shown.length}`;
        if (S.tocKey !== key) {
            S.tocKey = key;
            S.toc = tocEntries();
            toc.innerHTML = S.toc.map((e, i) => {
                const first = e.items[0];
                const src = first ? thumbOf(first, 96 * (root.devicePixelRatio || 1)) : '';
                return `<button type="button" class="wpg-lib-toc-card" data-toc="${i}"><span class="wpg-lib-toc-pic">${src ? `<img src="${esc(src)}" alt="" loading="lazy" decoding="async" draggable="false">` : ''}</span><span class="wpg-lib-toc-lines"><span class="wpg-lib-toc-label">${esc(e.label)}</span><span class="wpg-lib-toc-count">${esc(countText(e.items.length))}</span></span></button>`;
            }).join('');
        }
        const top = sc.scrollTop;
        toc.style.cssText = `top:${top}px;height:${Math.max(60, sc.clientHeight)}px`;
        // the card for what is in view: the first group (or run) whose pictures reach past the top of the view
        let at = 0;
        (S.toc || []).forEach((e, i) => {
            const g = e.group;
            const y = g ? g.top : posOf(e.items[0]);
            if (y != null && y <= top + 4) at = i;
        });
        if (S.tocAt !== at || !toc.querySelector('.is-visible')) {
            S.tocAt = at;
            const was = toc.querySelector('.wpg-lib-toc-card.is-visible');
            if (was) was.classList.remove('is-visible');
            const card = toc.querySelector(`[data-toc="${at}"]`);
            if (card) {
                card.classList.add('is-visible');
                if (card.offsetTop < toc.scrollTop || card.offsetTop + card.offsetHeight > toc.scrollTop + toc.clientHeight) toc.scrollTop = card.offsetTop - Math.round(toc.clientHeight / 3);
            }
        }
        void L;
    }
    /** Where a picture's row starts in the view (px), or null. */
    function posOf(it) {
        const L = S.layout;
        if (!it || !L) return null;
        for (const g of S.groups) {
            const k = g.items.indexOf(it);
            if (k >= 0) return g.bodyTop + Math.floor(k / L.cols) * L.m.ch;
        }
        return null;
    }
    function onTocClick(e) {
        const card = e.target.closest('.wpg-lib-toc-card');
        if (!card) return;
        const entry = (S.toc || [])[Number(card.dataset.toc)];
        if (!entry) return;
        const y = entry.group ? entry.group.top : posOf(entry.items[0]);
        if (y != null) S.el.scroller.scrollTop = Math.max(0, y - (entry.group ? 0 : HEADER_H));
    }

    function renderStatus() {
        const n = S.shown.length;
        const sel = S.selected.size;
        S.el.status.textContent = `${countText(n)}${sel ? `, ${sel} selected` : ''}`;
    }

    // ------------------------------------------------------------------ selection and input

    const shownIndex = (id) => S.shown.findIndex((it) => it.id === id);

    function select(id, how = {}) {
        if (how.range && S.anchor) {
            const a = shownIndex(S.anchor); const b = shownIndex(id);
            if (!how.add) S.selected.clear();
            for (let i = Math.min(a, b); i <= Math.max(a, b); i++) S.selected.add(S.shown[i].id);
        } else if (how.toggle) {
            if (S.selected.has(id)) S.selected.delete(id); else S.selected.add(id);
            S.anchor = id;
        } else {
            S.selected.clear();
            if (id) S.selected.add(id);
            S.anchor = id;
        }
        S.focus = id;
        queueRender();
        renderStatus();
        renderInfo();
        syncCommands();
    }

    function onCanvasDown(e) {
        if (e.button !== 0 && e.button !== 2) return;
        hideTip();
        const arrow = e.target.closest('.wpg-lib-group-arrow');
        if (arrow) {
            const k = arrow.closest('.wpg-lib-group').dataset.group;
            if (S.collapsed.has(k)) S.collapsed.delete(k); else S.collapsed.add(k);
            S.layout = null;
            queueRender();
            return;
        }
        const head = e.target.closest('.wpg-lib-group');
        if (head && e.button === 0) {
            // a click on a group's title selects the group (WPG 7005)
            const g = S.groups.find((x) => x.key === head.dataset.group);
            if (g) { if (!e.ctrlKey) S.selected.clear(); g.items.forEach((it) => S.selected.add(it.id)); S.focus = g.items[0] && g.items[0].id; queueRender(); renderStatus(); renderInfo(); syncCommands(); }
            return;
        }
        const cell = e.target.closest('.wpg-lib-cell');
        S.el.scroller.focus({ preventScroll: true });
        if (!cell) { if (e.button === 0 && !e.ctrlKey && !e.shiftKey) select(null); return; }
        const id = cell.dataset.id;
        if (e.button === 2 && S.selected.has(id)) { S.focus = id; return; }
        select(id, { range: e.shiftKey, toggle: e.ctrlKey && !e.shiftKey, add: e.ctrlKey });
    }
    function onCanvasClick(e) {
        const cap = e.target.closest('.wpg-lib-t-cap');
        if (cap) { const cell = cap.closest('.wpg-lib-cell'); if (cell) void editCaption(itemsById.get(cell.dataset.id)); }
    }
    function onCanvasDblClick(e) {
        const cell = e.target.closest('.wpg-lib-cell');
        if (cell) openViewer(cell.dataset.id);
    }

    function onGridKey(e) {
        if (e.target !== S.el.scroller) return;
        const L = S.layout || computeLayout();
        const i = S.focus ? shownIndex(S.focus) : -1;
        const move = (to) => {
            const n = Math.max(0, Math.min(S.shown.length - 1, to));
            const it = S.shown[n];
            if (!it) return;
            select(it.id, { range: e.shiftKey, add: e.ctrlKey });
            scrollIntoView(it.id);
        };
        switch (e.key) {
            case 'ArrowRight': e.preventDefault(); move(i + 1); break;
            case 'ArrowLeft': e.preventDefault(); move(i - 1); break;
            case 'ArrowDown': e.preventDefault(); move(i < 0 ? 0 : i + L.cols); break;
            case 'ArrowUp': e.preventDefault(); move(i - L.cols); break;
            case 'Home': e.preventDefault(); move(0); break;
            case 'End': e.preventDefault(); move(S.shown.length - 1); break;
            case 'Enter': if (S.focus) { e.preventDefault(); openViewer(S.focus); } break;
            case 'Delete': if (S.selected.size) { e.preventDefault(); void deleteSelection(); } break;
            case 'F11': e.preventDefault(); playSlideShow(); break;
            case 'a': case 'A':
                if (e.ctrlKey) { e.preventDefault(); S.shown.forEach((it) => S.selected.add(it.id)); queueRender(); renderStatus(); renderInfo(); syncCommands(); }
                break;
            case 't': case 'T':
                if (e.ctrlKey) { e.preventDefault(); openAddTags(); }
                break;
            case 'm': case 'M':
                if (e.ctrlKey) { e.preventDefault(); const one = selectedItems(); if (one.length === 1) void renameItem(one[0]); }
                break;
            case 'F2': { e.preventDefault(); const one = selectedItems(); if (one.length === 1) void renameItem(one[0]); break; }
            default: break;
        }
    }

    function scrollIntoView(id, centre) {
        let L = S.layout || computeLayout();
        for (const g of S.groups) {
            const k = g.items.findIndex((it) => it.id === id);
            if (k < 0) continue;
            if (g.collapsed) { S.collapsed.delete(g.key); S.layout = null; L = computeLayout(); }
            const y = g.bodyTop + Math.floor(k / L.cols) * L.m.ch;
            const sc = S.el.scroller;
            if (centre) { sc.scrollTop = Math.max(0, y - Math.round((sc.clientHeight - L.m.ch) / 2)); queueRender(); return; }
            if (y < sc.scrollTop) sc.scrollTop = y - HEADER_H;
            else if (y + L.m.ch > sc.scrollTop + sc.clientHeight) sc.scrollTop = y + L.m.ch - sc.clientHeight + 6;
            queueRender();
            return;
        }
    }

    // the picture and video previews in tooltips (Options: "Show picture and video previews in tooltips")
    function onCanvasOver(e) {
        const cell = e.target.closest('.wpg-lib-cell');
        if (!cell || !prefs.tooltips || prefs.view === 'tiles') return;
        if (S.tipFor === cell.dataset.id) return;
        hideTip();
        S.tipFor = cell.dataset.id;
        S.tipTimer = setTimeout(() => showTip(cell), TOOLTIP_DELAY);
    }
    function onCanvasOut(e) {
        const to = e.relatedTarget && e.relatedTarget.closest && e.relatedTarget.closest('.wpg-lib-cell');
        if (to && to.dataset.id === S.tipFor) return;
        hideTip();
    }
    function hideTip() {
        clearTimeout(S.tipTimer);
        S.tipFor = null;
        if (S.el.tip) S.el.tip.hidden = true;
    }
    function showTip(cell) {
        const it = itemsById.get(cell.dataset.id);
        if (!it || !S.open) return;
        const tip = S.el.tip;
        const box = 256;
        tip.innerHTML = `<div class="wpg-lib-tip-pic"><img alt="" src="${esc(it.thumb(box * (root.devicePixelRatio || 1)))}"></div><div class="wpg-lib-tip-row"><span>${esc(it.name)}</span><span>${esc(dateText(takenOf(it)))}</span></div><div class="wpg-lib-tip-row"><span>${isFavorite(it) ? 'Favorite' : (S.node.root === 'prints' ? 'Not a Favorite' : '')}</span><span>${esc(sizeText(it.size))}${dimsText(it) ? ` (${esc(dimsText(it).replace(' x ', ' x '))})` : ''}</span></div>`;
        const sr = S.shell.getBoundingClientRect();
        const cr = cell.getBoundingClientRect();
        tip.hidden = false;
        const tw = tip.offsetWidth; const th = tip.offsetHeight;
        let x = cr.left - sr.left + cr.width / 2 - tw / 2;
        let y = cr.top - sr.top + 8;
        x = Math.max(8, Math.min(sr.width - tw - 8, x));
        if (y + th > sr.height - 60) y = Math.max(8, sr.height - 60 - th);
        tip.style.left = `${Math.round(x)}px`;
        tip.style.top = `${Math.round(y)}px`;
    }

    // ------------------------------------------------------------------ Info pane (both modes)

    let infoItem = null;
    function selectedItems() { return S.shown.filter((it) => S.selected.has(it.id)); }

    /** The Info pane (WPG: thumbnail, name, date taken, size, tags, caption; no rating, Yukimi Nov 20 2026). */
    function renderInfo(forItem) {
        const pane = S.el.info || (S.shell && S.shell.querySelector('.wpg-info'));
        if (!pane) return;
        let items;
        if (forItem !== undefined) items = forItem ? [forItem] : [];
        else if (!S.open) return;
        else items = selectedItems();
        infoItem = items[0] || null;
        pane.classList.add('wpg-lib-info');
        const one = items.length === 1 ? items[0] : null;
        let head;
        if (!items.length) {
            const n = S.shown.length;
            head = `<div class="wpg-lib-i-none">${n === 1 ? '1 item' : `${n} items`}<br>in this view${n ? '<br><br>Click a thumbnail in the Gallery view to select a picture or video.' : ''}</div>`;
        } else if (one) {
            head = `<div class="wpg-lib-i-thumb"><img alt="" src="${esc(thumbOf(one, 180 * (root.devicePixelRatio || 1)))}"></div><div class="wpg-lib-i-name" title="${esc(one.name)}">${esc(one.name)}</div><div class="wpg-lib-i-line">${esc(dateText(takenOf(one)).replace(/ (\d+:)/, ' $1'))}</div><div class="wpg-lib-i-line">${esc(sizeText(one.size))}${dimsText(one) ? ` (${esc(dimsText(one))})` : ''}</div>`;
        } else {
            const pics = items.filter((x) => !x.video).length;
            const vids = items.length - pics;
            const bytes = items.reduce((s, x) => s + (x.size || 0), 0);
            const ts = items.map(takenOf).filter(Boolean).sort((a, b) => a - b);
            const range = ts.length ? (dayText(ts[0]) === dayText(ts[ts.length - 1]) ? dayText(ts[0]) : `${dayText(ts[0])} to ${dayText(ts[ts.length - 1])}`) : '';
            head = `<div class="wpg-lib-i-stack">${items.slice(0, 3).map((x) => `<img alt="" src="${esc(x.thumb(120))}">`).join('')}</div>${pics ? `<div class="wpg-lib-i-line">${pics} Picture${pics === 1 ? '' : 's'} (${esc(sizeText(bytes))})</div>` : ''}${vids ? `<div class="wpg-lib-i-line">${vids} Video${vids === 1 ? '' : 's'}</div>` : ''}<div class="wpg-lib-i-line">${esc(range)}</div>`;
        }
        let tags = '';
        let caption = '';
        // a picture known only by its address has nowhere to keep tags or a caption
        if (items.length && items.every((x) => x.source !== 'url')) {
            const lists = items.map(tagNamesOf);
            const all = [...new Set(lists.flat())].sort((a, b) => a.localeCompare(b));
            tags = `<div class="wpg-lib-i-tags"><button type="button" class="wpg-lib-i-addtag" title="Type a descriptive tag. (Ctrl+T)"><span class="wpg-lib-i-addtag-icon"></span>Add Tags</button>${all.map((t) => {
                const every = lists.every((l) => l.includes(t));
                return `<div class="wpg-lib-i-tag" title="${every ? 'Assigned to all' : 'Assigned to some'}"><span class="wpg-lib-i-tag-icon"></span><span class="wpg-lib-i-tag-name${every ? '' : ' is-some'}">${esc(t)}</span><button type="button" class="wpg-lib-i-tag-x" data-tag="${esc(t)}" title="Remove Tag"></button></div>`;
            }).join('')}</div>`;
            const caps = [...new Set(items.map(captionOf))];
            const cap = caps.length === 1 ? caps[0] : '';
            caption = `<button type="button" class="wpg-lib-i-caption${cap ? '' : ' is-empty'}" title="Type a caption."><span class="wpg-lib-i-caption-icon"></span><span class="wpg-lib-i-caption-text">${esc(cap || '<Add Caption>')}</span></button>`;
        }
        pane.innerHTML = `<button type="button" class="wpg-info-close wpg-lib-i-close" title="Hide Info Pane"></button><div class="wpg-lib-i-head">${head}</div>${tags}<div class="wpg-lib-i-spacer"></div>${caption}`;
        pane.querySelector('.wpg-lib-i-close').addEventListener('click', () => setInfoOpen(false));
        const add = pane.querySelector('.wpg-lib-i-addtag');
        if (add) add.addEventListener('click', () => openAddTags(items));
        pane.querySelectorAll('.wpg-lib-i-tag-x').forEach((b) => b.addEventListener('click', () => void removeTag(items, b.dataset.tag)));
        const capBtn = pane.querySelector('.wpg-lib-i-caption');
        if (capBtn) capBtn.addEventListener('click', () => void editCaption(items));
    }

    function setInfoOpen(open) {
        if (typeof root.setGlancewellInfoOpen === 'function') root.setGlancewellInfoOpen(open);
        else if (S.el.info) S.el.info.classList.toggle('hidden', !open);
        S.layout = null;
        queueRender();
    }

    /** "Add Tags": an edit box under the button; Enter adds the tag to every selected picture. */
    function openAddTags(list) {
        const items = list || selectedItems();
        if (!items.length) return;
        if (S.el.info && S.el.info.classList.contains('hidden')) setInfoOpen(true);
        renderInfo(S.open ? undefined : items[0]);
        const pane = S.el.info;
        const btn = pane && pane.querySelector('.wpg-lib-i-addtag');
        if (!btn) return;
        const input = h('input', 'wpg-lib-i-tagedit');
        input.type = 'text';
        input.autocomplete = 'off';
        input.spellcheck = false;
        btn.after(input);
        // the gallery's tags as a Vista list under the box (never the browser's datalist)
        const ac = new AbortController();
        attachSuggest(input, tagSuggestions, (it) => { input.value = ''; void addTag(items, it.text); input.focus(); }, ac.signal);
        new MutationObserver((_, mo) => { if (!input.isConnected) { ac.abort(); mo.disconnect(); } }).observe(input.parentNode, { childList: true });
        input.focus();
        input.addEventListener('keydown', async (e) => {
            e.stopPropagation();
            if (e.key === 'Escape') { input.remove(); return; }
            if (e.key === '/' || e.key === ';') { e.preventDefault(); return; }
            if (e.key !== 'Enter') return;
            const v = input.value.trim();
            input.value = '';
            if (v) await addTag(items, v);
        });
        input.addEventListener('blur', () => setTimeout(() => input.remove(), 150));
    }

    async function addTag(items, name) {
        try {
            const own = items.filter((it) => it.source === 'refs' && SRC().get('refs').ownsMeta(it));
            for (const it of own) await SRC().get('refs').saveMeta(it, { tags: [...new Set([...(it.refTags || []), name])] });
            const rest = items.filter((it) => !own.includes(it));
            if (rest.length) await send('glancewell_meta_set', { items: rest.map(ref), change: { addTags: [name] } });
            if (own.length) { renderTree(); refresh(); }
        } catch (err) { await message(errorText(err), 'error'); }
    }
    async function removeTag(items, name) {
        try {
            const own = items.filter((it) => it.source === 'refs' && SRC().get('refs').ownsMeta(it));
            for (const it of own) await SRC().get('refs').saveMeta(it, { tags: (it.refTags || []).filter((t) => t !== name) });
            const rest = items.filter((it) => !own.includes(it));
            const tag = S.tags.find((t) => t.name === name);
            if (rest.length && tag) await send('glancewell_meta_set', { items: rest.map(ref), change: { removeTags: [tag.id] } });
            if (own.length) { renderTree(); refresh(); }
        } catch (err) { await message(errorText(err), 'error'); }
    }
    const ref = (it) => ({ source: it.source, key: it.key, taken: Math.round((takenOf(it) || 0) / 1000) });

    async function editCaption(list) {
        const items = Array.isArray(list) ? list : (list ? [list] : selectedItems());
        if (!items.length) return;
        if (S.el.info && S.el.info.classList.contains('hidden')) setInfoOpen(true);
        const btn = S.el.info && S.el.info.querySelector('.wpg-lib-i-caption');
        if (!btn) return;
        const caps = [...new Set(items.map(captionOf))];
        const input = h('textarea', 'wpg-lib-i-capedit');
        input.value = caps.length === 1 ? caps[0] : '';
        input.rows = 3;
        btn.replaceWith(input);
        input.focus();
        let done = false;
        const finish = async (save) => {
            if (done) return;
            done = true;
            const v = input.value.trim();
            if (save) {
                try {
                    const own = items.filter((it) => it.source === 'refs' && SRC().get('refs').ownsMeta(it));
                    for (const it of own) await SRC().get('refs').saveMeta(it, { comment: v });
                    const rest = items.filter((it) => !own.includes(it));
                    if (rest.length) await send('glancewell_meta_set', { items: rest.map(ref), change: { caption: v } });
                } catch (err) { await message(errorText(err), 'error'); }
            }
            renderInfo(S.open ? undefined : items[0]);
            refresh();
        };
        input.addEventListener('keydown', (e) => {
            e.stopPropagation();
            if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); void finish(true); }
            else if (e.key === 'Escape') void finish(false);
        });
        input.addEventListener('blur', () => void finish(true));
    }

    // ------------------------------------------------------------------ commands

    function viewMenuItems() {
        const v = (id, text) => ({ text, action: `gwl-view-${id}`, checked: prefs.view === id, showIndicator: true, indicatorMark: 'radio' });
        const g = GROUPS.map(([id, text]) => ({ text, action: `gwl-group-${id}`, checked: prefs.group === id, showIndicator: true, indicatorMark: 'radio' }));
        const s = SORTS.map(([id, text]) => ({ text, action: `gwl-sort-${id}`, checked: prefs.sort === id, showIndicator: true, indicatorMark: 'radio' }));
        return [
            v('thumbs', 'Thumbnails'), v('text', 'Thumbnails with Text'), v('tiles', 'Tiles'),
            { separator: true },
            { text: 'Group By', submenu: g.concat([{ separator: true }, { text: 'Ascending', action: 'gwl-gdir-asc', checked: prefs.groupDir === 'asc', showIndicator: true, indicatorMark: 'radio' }, { text: 'Descending', action: 'gwl-gdir-desc', checked: prefs.groupDir === 'desc', showIndicator: true, indicatorMark: 'radio' }]) },
            { text: 'Sort By', submenu: s.concat([{ separator: true }, { text: 'Ascending', action: 'gwl-sdir-asc', checked: prefs.sortDir === 'asc', showIndicator: true, indicatorMark: 'radio' }, { text: 'Descending', action: 'gwl-sdir-desc', checked: prefs.sortDir === 'desc', showIndicator: true, indicatorMark: 'radio' }]) },
            { separator: true },
            { text: 'Table of Contents', action: 'gwl-toc', checked: !!prefs.toc, showIndicator: true },
            { separator: true },
            { text: 'Refresh', action: 'gwl-refresh' }
        ];
    }

    function onViewMenu(action) {
        const m = /^gwl-(view|group|sort|gdir|sdir)-(.+)$/.exec(action || '');
        if (m) {
            const [, k, v] = m;
            if (k === 'view') prefs.view = v;
            else if (k === 'group') prefs.group = v;
            else if (k === 'sort') prefs.sort = v;
            else if (k === 'gdir') prefs.groupDir = v;
            else prefs.sortDir = v;
            savePrefs();
            cellCache.clear();
            refresh();
        } else if (action === 'gwl-toc') { prefs.toc = !prefs.toc; S.tocKey = ''; savePrefs(); S.layout = null; queueRender(); }
        else if (action === 'gwl-refresh') {
            const { key } = scopeKeyOf(S.node);
            if (S.loaded.has(key)) S.loaded.get(key).stale = true;
            S.index.delete(S.node.root);
            void Promise.all([loadTags(), loadWatched()]).then(() => showNode(S.node, { history: false }));
        }
    }

    function itemMenuSections(event) {
        const cell = event.target.closest('.wpg-lib-cell');
        if (!cell) {
            return [{ type: 'list', items: viewMenuItems() }];
        }
        const it = itemsById.get(cell.dataset.id);
        if (it && !S.selected.has(it.id)) select(it.id);
        S.menuItem = it;
        const items = selectedItems();
        const one = items.length === 1;
        const print = it && it.source === 'prints';
        const list = [
            { text: it && it.video ? 'Preview Video' : 'Preview Picture', action: 'gwi-preview', className: 'context-menu-item-default' },
            { separator: true },
            { text: 'Set as Desktop Background', action: 'gwi-wallpaper', disabled: !one || (it && it.video) },
            { text: 'Open File Location', action: 'gwi-location', disabled: !one },
            { separator: true },
            { text: 'Add Tags...', action: 'gwi-tags' },
            { separator: true },
            { text: 'Rotate Clockwise', action: 'gwi-rotr', disabled: !items.every(canRotate) },
            { text: 'Rotate Counterclockwise', action: 'gwi-rotl', disabled: !items.every(canRotate) },
            { separator: true },
            { text: 'Change Time Taken...', action: 'gwi-time' },
            { separator: true },
            { text: 'Copy', action: 'gwi-copy', disabled: !one },
            // prints too: the gallery's own Delete (to Scraps; a scrap goes for good), no Incinerate row (Yukimi, Nov 21 2026)
            { text: 'Delete', action: 'gwi-delete' },
            { text: 'Rename...', action: 'gwi-rename', disabled: !(one && canRename(it)) },
            { text: 'Properties', action: 'gwi-properties', disabled: !one }
        ];
        // Every management action of the Workspaces app on prints (Yukimi, Nov 21 2026: "all options should be there so
        // you don't have to use the Workspaces app"): one print or many, in any workspace
        if (print && items.every((x) => x.source === 'prints')) {
            list.push({ separator: true }, ...printMenuItems(items, it));
        } else if (!print && it && it.source !== 'refs' && one) {
            list.push({ separator: true }, { text: isFavorite(it) ? 'Remove from Favorites' : 'Add to Favorites', action: 'gwi-fav' });
        }
        return [{ type: 'list', items: list }];
    }

    // ------------------------------------------------------------------ prints: the Workspaces app's actions

    /** The print rows: Favorites, Move To, Scrap / Unscrap (and To), the editors, print tools, sharing, Delete. */
    function printMenuItems(items, it) {
        const one = items.length === 1;
        const scraps = items.every((x) => x.scrap);
        const anyScrap = items.some((x) => x.scrap);
        const pinnedAll = items.every((x) => x.pinned);
        const meta = (it && it.raw && it.raw.metadata) || {};
        const wsRows = (prefix) => SRC().get('prints').workspaces().map((w) => ({ text: w.name, action: `${prefix}:${w.id}`, disabled: items.every((x) => x.workspaceId === w.id && prefix === 'gwp-move') }));
        const f = (name) => typeof root[name] === 'function';
        return [
            { text: 'Open in Window', action: 'gwp-window', disabled: !one || !f('openGalleryImageInViewer') },
            { text: pinnedAll ? 'Remove from Favorites' : 'Add to Favorites', action: 'gwp-pin', disabled: anyScrap },
            { separator: true },
            { text: 'Move To', submenu: wsRows('gwp-move'), disabled: anyScrap },
            scraps ? { text: 'Unscrap', action: 'gwp-unscrap' } : { text: 'Scrap', action: 'gwp-scrap', disabled: anyScrap },
            scraps ? { text: 'Unscrap To', submenu: wsRows('gwp-unscrapto') } : { text: 'Scrap To', submenu: wsRows('gwp-scrapto'), disabled: anyScrap },
            { separator: true },
            { text: 'Edit in DreamStudio', action: 'gwp-studio', disabled: !one },
            { text: 'Edit in Paint', action: 'gwp-paint', disabled: !one },
            { text: 'Use as Comparison Source', action: 'gwp-compare', disabled: !one || !f('setCompareSourceFromGalleryImage') },
            { text: 'Print', submenu: [
                { text: 'Recast Spell', action: 'gwp-reroll', disabled: !one },
                { text: 'Enhance...', action: 'gwp-enhance', disabled: !one },
                { text: 'Upscale', action: 'gwp-upscale', disabled: !one || !!(meta.upscaled || (it && it.raw && it.raw.upscaled)) },
                { text: 'Expand Canvas...', action: 'gwp-expand', disabled: !one },
                { text: 'Create Animation', action: 'gwp-animate', disabled: !one }
            ] },
            { separator: true },
            { text: 'Create Chat', action: 'gwp-chat', disabled: !one },
            { text: 'Copy Lookback', action: 'gwp-lookback', disabled: !one || !f('copyLookbackImage') },
            { text: 'Ask Wren', action: 'gwp-wren', disabled: !one || !f('askWrenAboutImage') },
            { separator: true },
            { text: 'New Reference', action: 'gwp-reference', disabled: !one },
            { text: 'Create Vibe Encoding', action: 'gwp-vibe', disabled: !one || !f('createVibeEncodingFromImage') },
            { text: 'Add to Desktop', action: 'gwp-desktop', disabled: !one },
            { text: 'Publish to Explorer...', action: 'gwp-publish', disabled: !one || !f('openPublishToExplorerDialog') },
            { text: 'Save a Copy', action: 'gwp-download' },
            { text: 'Share to Sequenzia', action: 'gwp-sequenzia', disabled: anyScrap }
        ];
    }

    /** The print's own record (the gallery's, else built from what the library has) for the Workspaces app's calls. */
    async function runPrintAction(action, items, it, event) {
        const g = (name) => (typeof root[name] === 'function' ? root[name] : null);
        const rec = it ? printRecord(it) : null;
        const names = items.map((x) => x.key);
        const c = root.wsClient;
        const bySource = new Map();
        items.forEach((x) => { const w = x.workspaceId || 'default'; if (!bySource.has(w)) bySource.set(w, []); bySource.get(w).push(x.key); });
        const after = () => { S.loaded.forEach((e, k) => { if (/^prints:/.test(k)) e.stale = true; }); void showNode(S.node, { history: false }); };
        const [verb, arg] = action.split(':');
        try {
            switch (verb) {
                case 'gwp-window': if (g('openGalleryImageInViewer')) g('openGalleryImageInViewer')(rec); return;
                case 'gwp-pin': {
                    const want = !items.every((x) => x.pinned);
                    for (const x of items) if (!!x.pinned !== want && g('togglePinImage')) { await g('togglePinImage')(printRecord(x), null); x.pinned = want; }
                    refresh();
                    return;
                }
                case 'gwp-move':
                    for (const [src, list] of bySource) if (src !== arg) await c.moveFilesToWorkspace(list, arg, src, 'files');
                    after();
                    return;
                case 'gwp-scrap':
                    for (const x of items) if (g('moveToScraps')) await g('moveToScraps')(printRecord(x));
                    after();
                    return;
                case 'gwp-scrapto':
                    await c.addScrapBulk(arg, names);
                    after();
                    return;
                case 'gwp-unscrap':
                    for (const [src, list] of bySource) await c.removeScrapBulk(src, list);
                    after();
                    return;
                case 'gwp-unscrapto':
                    for (const [src, list] of bySource) {
                        await c.removeScrapBulk(src, list);
                        if (src !== arg) await c.moveFilesToWorkspace(list, arg, src, 'files');
                    }
                    after();
                    return;
                case 'gwp-studio':
                    if (g('openManualModalWithContent')) g('openManualModalWithContent')({ type: 'image', image: rec, metadata: rec.metadata || null }, event);
                    return;
                case 'gwp-paint': if (g('editGalleryImageInPaint')) await g('editGalleryImageInPaint')(rec); return;
                case 'gwp-compare': g('setCompareSourceFromGalleryImage')(rec); return;
                case 'gwp-reroll': if (g('rerollImage')) g('rerollImage')(rec, event); return;
                case 'gwp-enhance': if (g('openEnhanceFromImage')) g('openEnhanceFromImage')(rec); return;
                case 'gwp-upscale': if (g('upscaleImage')) g('upscaleImage')(rec, event); return;
                case 'gwp-expand': if (g('expandCanvasFromGallery')) g('expandCanvasFromGallery')(rec); return;
                case 'gwp-animate': if (g('animateImage')) g('animateImage')(rec, event); return;
                case 'gwp-chat':
                    if (root.featureLoader) await root.featureLoader.loadFeature('chat');
                    if (root.chatSystem) root.chatSystem.openChatModal(it.key, rec.characterName || null);
                    return;
                case 'gwp-lookback': g('copyLookbackImage')(it.key); return;
                case 'gwp-wren': g('askWrenAboutImage')(it.key); return;
                case 'gwp-reference': if (g('createReferenceFromImage')) g('createReferenceFromImage')(rec); return;
                case 'gwp-vibe': g('createVibeEncodingFromImage')(rec); return;
                case 'gwp-desktop': if (g('createDesktopShortcutFromImage')) await g('createDesktopShortcutFromImage')(rec); return;
                case 'gwp-publish': g('openPublishToExplorerDialog')(rec); return;
                case 'gwp-download':
                    if (g('galleryDownloadImages')) await g('galleryDownloadImages')(items.map(printRecord), { name: 'DreamScape', path: '/Workspaces' });
                    else if (g('downloadImage')) items.forEach((x) => g('downloadImage')(printRecord(x)));
                    return;
                case 'gwp-sequenzia': {
                    if (!await confirmBox(`Send ${items.length === 1 ? 'this picture' : `these ${items.length} pictures`} to Sequenzia? They move there and leave DreamScape.`, 'Share to Sequenzia')) return;
                    await c.sendToSequenziaBulk(names);
                    after();
                    return;
                }
                default: return;
            }
        } catch (err) {
            await message((err && err.message) || 'That did not work.', 'error');
        }
    }

    async function onItemMenu(action, target, item, event) {
        const items = selectedItems();
        const it = S.focus ? itemsById.get(S.focus) : items[0];
        if (!it) return;
        if (/^gwp-/.test(action)) { await runPrintAction(action, items, it, event); return; }
        switch (action) {
            case 'gwi-preview': openViewer(it.id); break;
            case 'gwi-tags': openAddTags(items); break;
            case 'gwi-time': void changeTimeTaken(items); break;
            case 'gwi-rotr': void rotateSelection(1); break;
            case 'gwi-rotl': void rotateSelection(-1); break;
            case 'gwi-delete': void deleteSelection(); break;
            case 'gwi-rename': void renameItem(it); break;
            case 'gwi-fav':
                await send('glancewell_meta_set', { items: items.map(ref), change: { favorite: !isFavorite(it) } });
                break;
            case 'gwi-pin':
                if (typeof root.togglePinImage === 'function') { await root.togglePinImage(printRecord(it)); it.pinned = !it.pinned; refresh(); }
                break;
            case 'gwi-wallpaper':
            case 'gwi-copy':
            case 'gwi-properties':
            case 'gwi-location':
                await itemAction(action, it);
                break;
            default:
                // the viewer's own Dreamscape actions (lightbox.js runGlancewellAction) on the focused print
                if (/^gw-/.test(action) && typeof root.runGlancewellAction === 'function') await root.runGlancewellAction(action, event);
                break;
        }
    }

    function printRecord(it) {
        const rec = typeof root.findImageByFilename === 'function' ? root.findImageByFilename(it.key) : null;
        return rec || Object.assign({ filename: it.key, original: (it.raw && it.raw.original) || it.key, upscaled: it.raw && it.raw.upscaled, base: it.raw && it.raw.base, workspaceId: it.workspaceId }, it.raw || {});
    }

    async function itemAction(action, it) {
        const viewer = viewerProto();
        const ctx = {
            metadata: it.source === 'prints' ? printRecord(it) : {},
            imageSrc: it.full(),
            title: it.name,
            getImageFilename: () => (it.source === 'prints' ? it.key : ''),
            getImageWorkspaceId: () => it.workspaceId || null
        };
        if (action === 'gwi-wallpaper' && viewer && viewer.setAsWallpaper) return viewer.setAsWallpaper.call(ctx);
        if (action === 'gwi-copy' && viewer && viewer.copyToClipboard) return viewer.copyToClipboard.call(ctx);
        if (action === 'gwi-properties') {
            if (it.source === 'prints' && root.featureLoader && typeof root.featureLoader.loadFeature === 'function') {
                // the prompt and parameters live in Properties (Yukimi: the Info pane is 1:1)
                await root.featureLoader.loadFeature('image_prompt_inspector');
                if (typeof root.openImagePromptInspector === 'function') root.openImagePromptInspector(printRecord(it));
            }
            return undefined;
        }
        if (action === 'gwi-location') {
            if (it.source === 'prints' && viewer && viewer.jumpToInWorkspace) return viewer.jumpToInWorkspace.call(ctx);
            if (it.source === 'folders' && typeof root.openExplorerApplet === 'function') {
                const p = it.raw && (it.raw.parentPath || it.raw.path);
                return root.openExplorerApplet(p ? String(p).replace(/\/[^/]*$/, '') || '/' : undefined);
            }
        }
        return undefined;
    }

    /** Files Melaton Photo Gallery can rename: VFS files, a phone's pictures, references (their display name); prints keep the gallery's names. */
    function canRename(it) {
        return !!it && (it.source === 'folders' || it.source === 'refs' || it.source === 'pictures' || String(it.source).startsWith('device:'));
    }

    /** Rename (Ctrl+M): a new name for the file; "File names may not contain..." (WPG 7003) is refused. */
    async function renameItem(it) {
        if (!canRename(it)) return;
        const m = /^(.*?)(\.[a-z0-9]+)?$/i.exec(it.name || '');
        const stem = m[1]; const ext = it.source === 'refs' ? '' : (m[2] || '');
        const next = await dialog(`<div class="wpg-lib-rename"><label>Name:<input type="text" class="wpg-lib-rename-input" value="${esc(stem)}" spellcheck="false" data-autofocus></label></div>`,
            [{ text: 'OK', value: 'ok' }, { text: 'Cancel', value: null }], {
                title: 'Rename', icon: 'fas fa-i-cursor',
                onDialogReady: (dlg) => { const i = dlg.querySelector('.wpg-lib-rename-input'); i.focus(); i.select(); },
                resolveValue: (v, dlg) => (v === 'ok' ? dlg.querySelector('.wpg-lib-rename-input').value.trim() : null)
            });
        if (!next || next === stem) return;
        if (/[\\/:*?"<>|]/.test(next)) { await message('File names may not contain the following characters:\n\t\\ / : * ? " < > |', 'error'); return; }
        const name = `${next}${ext}`;
        S.el.status.textContent = 'Renaming files...';
        try {
            if (it.source === 'folders') await quiet(() => vfs().renameFile(it.key, name));
            else if (it.source === 'refs') await SRC().get('refs').saveMeta(it, { displayName: next });
            else await SRC().get(it.source).call('rename', { root: it.raw.root, path: it.raw.path, name });
            it.name = name;
            cellCache.clear();
            refresh();
        } catch (err) {
            await message(`${name}\n${errorText(err)}`, 'error');
        }
        renderStatus();
    }

    /** Pictures whose file Melaton Photo Gallery can write back (prints, VFS files, phone pictures; not references or videos). */
    function canRotate(it) {
        return !!it && !it.video && it.source !== 'refs' && it.source !== 'url';
    }

    /** A Fix / rotate target for a library item (glancewellFix.js). */
    function fixTarget(it) {
        return {
            src: it.full(),
            name: it.name,
            item: it,
            print: it.source === 'prints' ? { filename: it.key, workspaceId: it.workspaceId || null } : null
        };
    }

    /** Rotate Clockwise / Counterclockwise: each selected picture's file turned a quarter (Photo Gallery's "Rotating..."). */
    async function rotateSelection(dir) {
        const items = selectedItems().filter(canRotate);
        if (!items.length || !root.glancewellFix) return;
        S.el.status.textContent = 'Rotating...';
        for (const it of items) {
            try {
                await root.glancewellFix.rotateFile(fixTarget(it), dir);
                const w = it.width; it.width = it.height; it.height = w;
                it.rev = Date.now();
            } catch (err) {
                // WPG 2845 / 3029-3035
                await message(`Could not rotate ${it.name}.\n${errorText(err)}`, 'error');
                break;
            }
        }
        cellCache.clear();
        S.layout = null;
        queueRender();
        renderStatus();
        renderInfo();
    }

    /** Delete: prints go to Scraps (a scrap is deleted for good), references and files are removed after a question. */
    async function deleteSelection() {
        await deleteItems(selectedItems());
    }

    /**
     * Delete pictures and videos (prints to Scraps, the rest after WPG 980's question). Returns whether they went:
     * false when the question was answered No.
     */
    async function deleteItems(items) {
        if (!items.length) return false;
        const first = items[0];
        try {
            if (first.source === 'prints') {
                for (const it of items) {
                    const rec = printRecord(it);
                    if (it.scrap) { if (typeof root.deleteImage === 'function') await root.deleteImage(rec); }
                    else if (typeof root.moveToScraps === 'function') await root.moveToScraps(rec);
                }
            } else {
                const what = items.length === 1 ? `"${first.name}"` : `these ${items.length} items`;
                // WPG 980
                if (!await confirmBox(`Are you sure you want to delete ${what}?`, items.length === 1 ? 'Delete File' : 'Delete Multiple Items')) return false;
                for (const it of items) {
                    // deleteReferenceImage: public/scripts/comp/referenceManager.js (a vibe alone is a standalone encoding)
                    if (it.source === 'refs' && typeof root.deleteReferenceImage === 'function') {
                        const vibe = it.refType === 'vibe';
                        await root.deleteReferenceImage({ hash: it.key, filename: (it.raw && it.raw.filename) || it.key, hasPreview: true, preview: vibe ? it.raw.preview : undefined, isStandalone: vibe, hasVibes: vibe, workspaceId: it.workspaceId || undefined }, it.workspaceId || null, null, vibe ? 'vibes' : 'base');
                    }
                    else if (it.source === 'folders' && vfs()) {
                        // the workspace Trash where the folder has one; a folder outside workspaces deletes for good
                        // (Explorer's own permanent delete, vfs_delete_file)
                        const trashed = await vfs().moveToTrash([{ id: it.key, targetKind: 'user-file', targetId: it.key, name: it.name, kind: 'file' }], it.parentPath || '/').then((r) => !(r && r.success === false), () => false);
                        if (!trashed) await send('vfs_delete_file', { fileId: it.key });
                    }
                    // this phone, a partner device or a DreamOS drive: the item's own source picks its device
                    else if (it.raw && it.raw.root) await SRC().get(it.source).call('delete', { root: it.raw.root, path: it.raw.path });
                }
                await send('glancewell_forget', { items: items.map(ref) });
            }
        } catch (err) {
            await message(errorText(err), 'error');
            return false;
        }
        const ids = new Set(items.map((x) => x.id));
        for (const v of S.loaded.values()) v.items = (v.items || []).filter((x) => !ids.has(x.id));
        S.items = S.items.filter((x) => !ids.has(x.id));
        ids.forEach((id) => S.selected.delete(id));
        if (S.built) refresh();
        return true;
    }

    /** The viewer's Delete for the shown item (lightbox.js): true when it was deleted. */
    function deleteViewerItem(id) {
        const it = id && itemsById.get(id);
        return it ? deleteItems([it]) : Promise.resolve(false);
    }

    /** Change Time Taken (dialog 1472): hours -24..+24 from each picture's own date. */
    async function changeTimeTaken(items) {
        if (!items.length) return;
        const cur = takenOf(items[0]);
        const hours = await promptHours(cur);
        if (hours == null || hours === 0) return;
        try { await send('glancewell_meta_set', { items: items.map(ref), change: { takenShiftHours: hours } }); } catch (err) { await message(errorText(err), 'error'); }
    }

    /** Change Time Taken (WPG dialog 1472): "Change by" hours in Vista's up-down, the new and current time. */
    function promptHours(cur) {
        const html = kitText(7, 7, 200, 8, 'Change the time stamp for selected pictures and videos.')
            + kitText(7, 25, 50, 8, 'Change by:', 'wpg-time-label')
            + `<div class="tbp-ctl tbp-spinedit wpg-time-spin" data-dlu="60,23,36,12"><input type="text" class="tbp-edit wpg-time-h" inputmode="numeric" maxlength="3" value="0" aria-label="Change by, in hours" data-autofocus><span class="tbp-spin tbp-spin-up" data-step="1" aria-hidden="true"></span><span class="tbp-spin tbp-spin-down" data-step="-1" aria-hidden="true"></span></div>`
            + kitText(100, 25, 40, 8, 'hours')
            + kitText(7, 42, 50, 8, 'New Time:', 'wpg-time-label') + kitText(60, 42, 147, 8, esc(dateText(cur)), 'wpg-time-new')
            + kitText(7, 56, 50, 8, 'Current Time:', 'wpg-time-label') + kitText(60, 56, 147, 8, esc(dateText(cur)))
            + kitButton(103, 76, 50, 'OK', 'ok') + kitButton(157, 76, 50, 'Cancel', 'cancel');
        return kitDialog({
            id: 'glancewellTimeTaken',
            title: 'Change Time Taken',
            cls: 'wpg-time',
            html,
            ready: (c, { signal }) => {
                const inp = c.querySelector('.wpg-time-h');
                const read = () => { const n = Number(String(inp.value).trim()); return Number.isInteger(n) ? n : NaN; };
                const show = () => { const n = read(); c.querySelector('.wpg-time-new').textContent = dateText(cur + (Number.isFinite(n) ? n : 0) * 3600000); };
                const step = (d) => { const n = read(); inp.value = String(Math.max(-24, Math.min(24, (Number.isFinite(n) ? n : 0) + d))); show(); };
                inp.addEventListener('input', show, { signal });
                inp.addEventListener('keydown', (e) => {
                    if (e.key === 'ArrowUp') { e.preventDefault(); step(1); } else if (e.key === 'ArrowDown') { e.preventDefault(); step(-1); }
                }, { signal });
                c.querySelectorAll('.tbp-spin').forEach((b) => b.addEventListener('mousedown', (e) => { e.preventDefault(); step(Number(b.dataset.step)); inp.focus(); }, { signal }));
                return {
                    accept: () => {
                        const n = read();
                        // WPG 974
                        if (!(Number.isInteger(n) && n >= -24 && n <= 24)) { void message('Please enter a value between -24 and +24.', 'warning'); return false; }
                        return n;
                    }
                };
            }
        });
    }

    // ------------------------------------------------------------------ the viewer, the pill, the band

    /** A viewer slide for a library item: prints keep the gallery's own slide shape (every viewer action works). */
    function slideFor(it) {
        // a video plays in the viewer (glancewellVideo.js): the slide carries its aspect, the address is set when shown
        if (it.video && root.glancewellVideo) {
            const size = root.glancewellVideo.sizeFor(it.width && it.height ? it.width / it.height : 0);
            return { type: 'video', videoSrc: it.full(), width: size.width, height: size.height, data: { isStandalone: true, title: it.name, gwItem: it.id, video: true } };
        }
        if (it.source === 'prints') {
            const rec = printRecord(it);
            return {
                src: it.full(),
                width: it.width || undefined,
                height: it.height || undefined,
                data: { filename: it.key, base: rec.base, upscaled: rec.upscaled, original: rec.original, metadata: rec.metadata || null, gwItem: it.id }
            };
        }
        return { src: it.full(), width: it.width || undefined, height: it.height || undefined, data: { isStandalone: true, title: it.name, gwItem: it.id } };
    }

    function openViewer(id) {
        const list = S.selected.size > 1 ? selectedItems() : S.shown;
        const at = Math.max(0, list.findIndex((it) => it.id === id));
        if (!list.length || typeof root.openStandalonePhotoSwipe !== 'function') return;
        hideTip();
        S.owns = true;
        enterViewer();
        void root.openStandalonePhotoSwipe(list.map(slideFor), at);
    }

    function playSlideShow() {
        const list = S.selected.size > 1 ? selectedItems() : S.shown;
        if (!list.length) return;
        // PhotoViewer 11003
        if (!list.some((it) => !it.video)) { void message('Slide Show can\u2019t start because your selection contains only videos.', 'info'); return; }
        const at = S.focus ? Math.max(0, list.findIndex((it) => it.id === S.focus)) : 0;
        S.owns = true;
        enterViewer();
        root.glancewellStartSlideShow = true;
        void root.openStandalonePhotoSwipe(list.filter((it) => !it.video).map(slideFor), at);
    }

    function enterViewer() {
        if (!S.built) return;
        if (S.open) rememberPlace();
        S.open = false;
        S.el.lib.hidden = true;
        S.shell.classList.remove('wpg-mode-library');
        hideTip();
        // the gallery's command states are its own: the viewer starts from the band and pill as they ship
        // (lightbox.js syncGlancewellChrome sets the viewer's)
        S.shell.querySelectorAll('.wpg-pill [data-gw], .wpg-cmds > [data-gw]').forEach((btn) => { btn.disabled = btn.dataset.gw === 'burn'; });
    }

    function showLibrary() {
        build();
        S.open = true;
        S.el.lib.hidden = false;
        S.shell.classList.add('wpg-mode-library');
        const title = doc.getElementById('photoSwipeWindowTitle');
        if (title) title.textContent = 'Melaton Photo Gallery';
        S.layout = null;
        renderTree();
        syncNav();
        refresh();
        if (typeof root.layoutGlancewellToolbar === 'function') root.layoutGlancewellToolbar();
    }

    /** The command band's state for the selection (File and Info always; the rest need a picture). */
    function syncCommands() {
        if (!S.open || !S.shell) return;
        const items = selectedItems();
        const one = items.length >= 1;
        const print = one && items.every((it) => it.source === 'prints');
        S.shell.querySelectorAll('.wpg-cmds > [data-gw]').forEach((btn) => {
            const k = btn.dataset.gw;
            if (k === 'file' || k === 'info') btn.disabled = false;
            else if (k === 'burn') btn.disabled = true; // no disc to burn (Yukimi, Nov 20 2026)
            else if (k === 'print' || k === 'movie') btn.disabled = !print || items.length !== 1;
            else btn.disabled = !one;
        });
        const pill = (k) => S.shell.querySelector(`.wpg-pill [data-gw="${k}"]`);
        const i = S.focus ? shownIndex(S.focus) : -1;
        if (pill('previous')) pill('previous').disabled = i <= 0;
        if (pill('next')) pill('next').disabled = i >= S.shown.length - 1;
        if (pill('slideshow')) pill('slideshow').disabled = !S.shown.length;
        const turnable = one && items.every(canRotate);
        if (pill('rotate-left')) pill('rotate-left').disabled = !turnable;
        if (pill('rotate-right')) pill('rotate-right').disabled = !turnable;
        if (pill('delete')) pill('delete').disabled = !one;
    }

    /** The pill and band in the gallery (lightbox.js asks first; true = handled here). */
    function handleControl(key, btn) {
        if (!S.open) return false;
        const L = S.layout || computeLayout();
        const i = S.focus ? shownIndex(S.focus) : -1;
        switch (key) {
            case 'previous': if (i > 0) { select(S.shown[i - 1].id); scrollIntoView(S.focus); } return true;
            case 'next': if (i < S.shown.length - 1) { select(S.shown[i + 1].id); scrollIntoView(S.focus); } return true;
            case 'slideshow': playSlideShow(); return true;
            case 'delete': void deleteSelection(); return true;
            case 'fit': prefs.size = SIZE_DEFAULT; savePrefs(); cellCache.clear(); S.layout = null; queueRender(); return true;
            case 'zoom': return false; // lightbox.js's popup, sized by zoomFraction / setZoomFraction
            case 'fix': if (S.focus) { root.glancewellStartFix = true; openViewer(S.focus); } return true;
            case 'rotate-left': void rotateSelection(-1); return true;
            case 'rotate-right': void rotateSelection(1); return true;
            case 'info': setInfoOpen(!!(S.el.info && S.el.info.classList.contains('hidden'))); return true;
            default: void L; void btn; return false;
        }
    }
    function zoomFraction() { return (Math.log(prefs.size) - Math.log(SIZE_MIN)) / (Math.log(SIZE_MAX) - Math.log(SIZE_MIN)); }
    function setZoomFraction(f) {
        const v = Math.round(Math.exp(Math.log(SIZE_MIN) + Math.max(0, Math.min(1, f)) * (Math.log(SIZE_MAX) - Math.log(SIZE_MIN))));
        if (v === prefs.size) return;
        prefs.size = v;
        savePrefs();
        cellCache.clear();
        S.layout = null;
        queueRender();
    }

    /** The File menu in the gallery (WPG MENU 14018 &File). */
    /** This phone's Pictures and every connected phone: the sources whose gallery favourites can come in. */
    function phoneSources() {
        const out = [];
        const pics = SRC().get('pictures');
        if (pics && pics.available() && typeof pics.galleryFavorites === 'function') out.push(pics);
        SRC().devices().forEach((d) => { if (d && typeof d.galleryFavorites === 'function') out.push(d); });
        return out;
    }

    /**
     * Import Favorites from Samsung Gallery (Yukimi, Nov 21 2026): every picture and video the phone's gallery has a heart
     * on becomes a Favorite here (Pictures > Favorites, or the phone's own Favorites). Nothing is removed.
     */
    async function importPhoneFavorites() {
        const sources = phoneSources();
        let total = 0;
        const errors = [];
        for (const src of sources) {
            let list = [];
            try { list = await src.galleryFavorites(); } catch (err) { errors.push(`${src.label || 'Phone'}: ${errorText(err)}`); continue; }
            for (let i = 0; i < list.length; i += 4000) {
                try { await send('glancewell_meta_set', { items: list.slice(i, i + 4000), change: { favorite: true } }); } catch (err) { errors.push(errorText(err)); break; }
            }
            total += list.length;
            await loadIndex(src.id).catch(() => null);
        }
        renderTree();
        refresh();
        const done = total ? `${total.toLocaleString()} ${total === 1 ? 'favorite was' : 'favorites were'} imported from Samsung Gallery.` : 'Samsung Gallery has no favorites to import.';
        await message(errors.length ? `${done}\n\n${errors.join('\n')}` : done, errors.length && !total ? 'error' : 'info');
    }

    function fileMenuItems() {
        const items = selectedItems();
        const one = items.length === 1;
        return [
            { text: 'Add Folder to Gallery...', action: 'gwf-addfolder' },
            { text: 'Import from Camera or Scanner...', action: 'gwf-import', disabled: !SRC().devices().length },
            { text: 'Import Favorites from Samsung Gallery', action: 'gwf-phonefavs', disabled: !phoneSources().length },
            { separator: true },
            { text: 'Delete', subtext: 'Del', action: 'gwf-delete', disabled: !items.length },
            { text: 'Rename', subtext: 'Ctrl+M', action: 'gwf-rename', disabled: !(one && canRename(items[0])) },
            { separator: true },
            { text: 'Copy', subtext: 'Ctrl+C', action: 'gwi-copy', disabled: !one },
            { separator: true },
            { text: 'Screen Saver Settings', action: 'gwf-screensaver' },
            { separator: true },
            { text: 'Select All', subtext: 'Ctrl+A', action: 'gwf-selectall' },
            { separator: true },
            { text: 'Share With Devices...', action: 'gwf-share', disabled: !items.length || !SRC().devices().length },
            { separator: true },
            { text: 'Properties', subtext: 'Alt+Enter', action: 'gwi-properties', disabled: !one },
            { text: 'Options', action: 'gwf-options' },
            { separator: true },
            { text: 'Exit', action: 'gwf-exit' }
        ];
    }

    async function runFileAction(action, event) {
        const items = selectedItems();
        switch (action) {
            case 'gwf-addfolder': addFolderToGallery(); return true;
            case 'gwf-phonefavs': await importPhoneFavorites(); return true;
            case 'gwf-delete': await deleteSelection(); return true;
            case 'gwf-rename': if (items.length === 1) await renameItem(items[0]); return true;
            case 'gwf-selectall': S.shown.forEach((it) => S.selected.add(it.id)); queueRender(); renderStatus(); renderInfo(); syncCommands(); return true;
            case 'gwf-screensaver':
                // Screen Saver Settings (personalizationDialogs.js, in the Control Panel feature)
                if (root.featureLoader) await root.featureLoader.loadFeature('control_panel').catch(() => {});
                if (root.personalizationDialogs) root.personalizationDialogs.openScreenSaver();
                return true;
            case 'gwf-share': await shareWithDevice(items); return true;
            case 'gwf-import': await importFromDevice(); return true;
            case 'gwf-options': openOptions(); return true;
            case 'gwf-exit': if (typeof root.closeModal === 'function') root.closeModal(S.shell); return true;
            case 'gwi-copy': case 'gwi-properties': { const it = S.focus ? itemsById.get(S.focus) : items[0]; if (it) await itemAction(action, it); return true; }
            default: void event; return false;
        }
    }

    /** A connected ActiveSync phone: the only one, or the one picked in a box (null when none or cancelled). */
    async function pickDevice(verb) {
        const list = SRC().devices();
        if (!list.length) return null;
        if (list.length === 1) return list[0];
        const id = await dialog(`${esc(verb)} which device?`, list.map((d) => ({ text: d.label, value: d.id })).concat([{ text: 'Cancel', value: null }]), { icon: ICONS.question });
        return list.find((d) => d.id === id) || null;
    }

    /** The phone's storage, picked and ready (activeSyncRemoteStorage.js). */
    async function deviceStore(dev) {
        const ps = root.phoneStorage;
        if (!ps || !ps.remote) return null;
        if (ps.deviceId !== dev.deviceId && typeof ps.select === 'function') ps.select(dev.deviceId);
        const st = await ps.hello();
        const r = st && st.enabled && st.access && !st.locked && typeof ps.receivedRoot === 'function' ? ps.receivedRoot(st) : null;
        return r ? { ps, rootId: r.id } : null;
    }

    /** File > Share With Devices: the selected pictures copied to the phone's ActiveSync folder. */
    async function shareWithDevice(items) {
        if (!items.length) return;
        const dev = await pickDevice('Share with');
        if (!dev) return;
        let store = null;
        try { store = await deviceStore(dev); } catch (_) { store = null; }
        if (!store) { await message(`${dev.label} does not share its storage right now. Turn on phone storage in the app on the device, then try again.`, 'warning'); return; }
        const dir = store.ps.receivedDir || '/ActiveSync';
        let sent = 0;
        for (const it of items) {
            S.el.status.textContent = `Copying ${sent + 1} of ${items.length} to ${dev.label}...`;
            try {
                const blob = await (await fetch(it.full(), { credentials: 'same-origin' })).blob();
                await store.ps.write(store.rootId, dir, new File([blob], it.name, { type: blob.type }), { name: it.name, conflict: 'rename', mkdirs: true, deviceId: dev.deviceId });
                sent++;
            } catch (err) {
                await message(`${it.name} could not be copied to ${dev.label}.\n${errorText(err)}`, 'error');
                break;
            }
        }
        renderStatus();
        if (sent) await message(`${sent === 1 ? '1 item was' : `${sent} items were`} copied to ${dev.label} (${dir.replace(/^\//, '')}).`, 'info');
    }

    // ------------------------------------------------------------------ Options and Import (PhotoAcq.dll, PhotoLibraryResources)

    let SETTINGS = null;
    async function loadSettings() {
        try { SETTINGS = (await send('glancewell_settings', {})).settings; } catch (_) { SETTINGS = null; }
        if (SETTINGS && typeof SETTINGS.tooltips === 'boolean') prefs.tooltips = SETTINGS.tooltips;
        return SETTINGS;
    }
    const importSettings = () => Object.assign({ folder: '', folderName: 'dateImportedTag', fileName: 'tag', promptTag: true, erase: false, rotate: true, openAfter: true }, (SETTINGS && SETTINGS.import) || {});

    const FOLDER_NAMES = [
        ['dateImportedTag', 'Date Imported + Tag', '{DATE_ACQUIRED} Himalayas'], ['dateTakenTag', 'Date Taken + Tag', '{DATE_TAKEN_2} Himalayas'],
        ['dateRangeTag', 'Date Taken Range + Tag', '{DATE_TAKEN_1} - {DATE_TAKEN_2} Himalayas'], ['tagDateImported', 'Tag + Date Imported', 'Himalayas {DATE_ACQUIRED}'],
        ['tagDateTaken', 'Tag + Date Taken', 'Himalayas {DATE_TAKEN_2}'], ['tagDateRange', 'Tag + Date Taken Range', 'Himalayas {DATE_TAKEN_1} - {DATE_TAKEN_2}'],
        ['tag', 'Tag', 'Himalayas'], ['none', '(None)', '']
    ];
    const FILE_NAMES = [['tag', 'Tag', 'Himalayas 001.JPG'], ['original', 'Original File Name', 'DSC_1234.JPG'], ['originalFolders', 'Original File Name (Preserve Folders)', 'Folder\\DSC_1234.JPG']];
    const ymd = (t) => { const d = new Date(t); return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`; };

    /** The import's folder name from the setting (PhotoAcq 700-707: "2026-11-20 Himalayas" and the rest). */
    function importFolderName(mode, tag, items) {
        const ts = items.map((it) => it.taken).filter(Boolean).sort((x, y) => x - y);
        const imported = ymd(Date.now());
        const first = ts.length ? ymd(ts[0]) : imported;
        const last = ts.length ? ymd(ts[ts.length - 1]) : imported;
        const range = first === last ? last : `${first} - ${last}`;
        const t = String(tag || '').trim();
        const join = (...p) => p.filter(Boolean).join(' ');
        switch (mode) {
            case 'dateTakenTag': return join(last, t);
            case 'dateRangeTag': return join(range, t);
            case 'tagDateImported': return join(t, imported);
            case 'tagDateTaken': return join(t, last);
            case 'tagDateRange': return join(t, range);
            case 'tag': return t;
            case 'none': return '';
            default: return join(imported, t);
        }
    }

    /** A JPEG's EXIF orientation (1-8), 1 when there is none (Rotate pictures on import). */
    function exifOrientation(buf) {
        const v = new DataView(buf);
        if (v.byteLength < 4 || v.getUint16(0) !== 0xffd8) return 1;
        let o = 2;
        while (o + 4 < v.byteLength) {
            const marker = v.getUint16(o);
            const len = v.getUint16(o + 2);
            if (marker === 0xffe1 && v.getUint32(o + 4) === 0x45786966) {
                const t = o + 10;
                const little = v.getUint16(t) === 0x4949;
                const ifd = t + v.getUint32(t + 4, little);
                const n = v.getUint16(ifd, little);
                for (let i = 0; i < n; i++) {
                    const e = ifd + 2 + i * 12;
                    if (v.getUint16(e, little) === 0x0112) return v.getUint16(e + 8, little) || 1;
                }
                return 1;
            }
            if ((marker & 0xff00) !== 0xff00) break;
            o += 2 + len;
        }
        return 1;
    }

    /** Rotate pictures on import: a turned JPEG is redrawn upright (the browser applies the EXIF turn). */
    async function uprightJpeg(blob) {
        if (!/jpe?g/i.test(blob.type) || typeof createImageBitmap !== 'function') return blob;
        const orient = exifOrientation(await blob.slice(0, 131072).arrayBuffer());
        if (orient === 1) return blob;
        const bmp = await createImageBitmap(blob, { imageOrientation: 'from-image' });
        const c = doc.createElement('canvas');
        c.width = bmp.width; c.height = bmp.height;
        c.getContext('2d').drawImage(bmp, 0, 0);
        bmp.close && bmp.close();
        return await new Promise((resolve) => c.toBlob((b) => resolve(b || blob), 'image/jpeg', 0.95));
    }

    /** Import Pictures and Videos (PhotoAcq dialog 1071): the devices to import from. Resolves a device or null. */
    function chooseImportDevice() {
        const list = SRC().devices();
        // each device as Mobile Device Center draws it: a modern phone or a Fold (activeSyncAgent.js deviceIcon)
        const icon = (d) => {
            const f = root.activeSync && typeof root.activeSync.deviceIcon === 'function' && d.deviceId ? root.activeSync.deviceIcon(d.deviceId, 32) : '';
            return /fold/.test(f) ? ' is-fold' : /phone/.test(f) ? ' is-phone' : '';
        };
        const rows = list.map((d, i) => `<div class="wpg-imp-dev${i === 0 ? ' is-selected' : ''}" data-dev="${esc(d.id)}" tabindex="0"><span class="wpg-imp-dev-icon${icon(d)}"></span><span>${esc(d.label)}</span></div>`).join('');
        const html = `<div class="wpg-imp"><p>If you do not see your device in the list, make sure it is connected to the computer and turned on.</p><div class="wpg-imp-list" role="listbox">${rows || '<p class="wpg-imp-none">No devices were found.</p>'}</div></div>`;
        return dialog(html, [{ text: 'Import', value: 'import' }, { text: 'Cancel', value: null }], {
            title: 'Import Pictures and Videos',
            icon: 'fas fa-camera',
            onDialogReady: (dlg) => {
                dlg.querySelectorAll('.wpg-imp-dev').forEach((r) => r.addEventListener('click', () => {
                    dlg.querySelectorAll('.wpg-imp-dev').forEach((x) => x.classList.toggle('is-selected', x === r));
                }));
            },
            resolveValue: (value, dlg) => {
                if (value !== 'import') return null;
                const sel = dlg.querySelector('.wpg-imp-dev.is-selected');
                return sel ? list.find((d) => d.id === sel.dataset.dev) || null : null;
            }
        });
    }

    /**
     * File > Import from Camera or Scanner, as Vista's Import Pictures and Videos: the device, then "Found N pictures
     * and videos" and "Tag these pictures (optional)" (dialog 1064), then "Importing item n of m" with Erase after
     * importing (dialog 1063). Options > Import decides where they go and how folders and files are named.
     */
    async function importFromDevice() {
        if (!vfs()) return;
        if (root.featureLoader) await root.featureLoader.loadFeature('control_panel').catch(() => {});
        await loadSettings();
        const set = importSettings();
        const dev = await chooseImportDevice();
        if (!dev) return;
        S.el.status.textContent = 'Locating pictures and videos';
        let albums = [];
        try { albums = await dev.albums(true); } catch (_) { albums = []; }
        const camera = albums.filter((a) => /\/DCIM\/Camera$/i.test(a.path));
        let items = [];
        for (const a of (camera.length ? camera : albums)) { try { items = items.concat(await dev.list({ album: a })); } catch (_) { /* skipped */ } }
        // where: Options > Import's folder, else "Imported Pictures" (made and added to Folders)
        const NAME = 'Imported Pictures';
        let base = set.folder ? { folder: set.folder, name: (S.watched.find((f) => f.folder === set.folder) || {}).name || set.folder } : S.watched.find((f) => f.name === NAME);
        if (!base) {
            try {
                const res = await quiet(() => vfs().createFolder('/', NAME));
                const made = res && (res.folder || res.item || res);
                if (!made || !made.id) throw new Error('The folder could not be made.');
                base = { folder: `/${made.id}`, name: NAME };
            } catch (err) { renderStatus(); await message(errorText(err), 'error'); return; }
        }
        if (!S.watched.some((f) => f.folder === base.folder)) S.watched = await SRC().get('folders').setWatched({ add: [{ folder: base.folder, name: base.name }] });
        // pictures already imported (by name, anywhere under the import folder) are left out (PhotoAcq 114)
        let have = new Set();
        try { have = new Set((await SRC().get('folders').list({ folders: [{ path: base.folder, name: base.name }] })).map((x) => x.name)); } catch (_) { /* none */ }
        const todo = items.filter((it) => !have.has(it.name));
        renderStatus();
        if (!todo.length) { await message('No new pictures or videos were found on this device', 'info'); return; }
        // Found N ... Tag these pictures (optional) (PhotoAcq 1071 / 105 / 118)
        let tag = '';
        if (set.promptTag) {
            // Found N ... / Tag these pictures (optional): a kit dialog, the gallery's tags as a Vista list under the box
            const r = await kitDialog({
                id: 'glancewellImportTag',
                title: 'Importing Pictures and Videos',
                cls: 'wpg-imp-tagdlg',
                html: kitText(7, 7, 236, 8, `Found ${todo.length} pictures and videos`)
                    + kitText(7, 24, 236, 8, 'Tag these pictures (optional):')
                    + kitEdit('wpg-imp-tag-input', 7, 35, 236, '', ' data-autofocus')
                    + kitText(7, 54, 236, 24, 'Tags help you find and organize pictures. You can add or change tags in Photo Gallery after importing.', 'wpg-imp-note')
                    + kitButton(139, 84, 50, 'Import', 'ok') + kitButton(193, 84, 50, 'Cancel', 'cancel'),
                ready: (c, { signal }) => {
                    const i2 = c.querySelector('.wpg-imp-tag-input');
                    i2.addEventListener('keydown', (e) => { if (e.key === '/' || e.key === ';') e.preventDefault(); }, { signal });
                    attachSuggest(i2, tagSuggestions, (it) => { i2.value = it.text; i2.focus(); }, signal);
                    return { accept: () => ({ tag: i2.value.trim() }) };
                }
            });
            if (!r) return;
            tag = r.tag;
        }
        // the batch's folder: "2026-11-20 Himalayas" (or the files straight into the import folder: None)
        let target = base.folder;
        const sub = importFolderName(set.folderName, tag, todo).replace(/[\\/:*?"<>|]/g, '').trim();
        if (sub) {
            try {
                const have2 = ((await vfs().listDirectory(base.folder, { offset: 0, limit: 1000 })) || {}).items || [];
                const hit = have2.find((e) => e.kind === 'folder' && e.name === sub);
                if (hit) target = hit.navPath || `${base.folder}/${hit.id}`;
                else {
                    const res = await quiet(() => vfs().createFolder(base.folder, sub));
                    const made = res && (res.folder || res);
                    target = made && made.id ? `${base.folder}/${made.id}` : base.folder;
                }
            } catch (_) { target = base.folder; }
        }
        // Importing item n of m (dialog 1063), Erase after importing: its own window, so a message box can still show
        let cancelled = false;
        let erase = !!set.erase;
        const prog = progressWindow(todo.length, erase, (v) => { erase = v; }, () => { cancelled = true; });
        const imported = [];
        let n = 0;
        for (const it of todo) {
            if (cancelled) break;
            n++;
            prog.step(n);
            try {
                let blob = await (await fetch(it.full(), { credentials: 'same-origin' })).blob();
                if (set.rotate && !it.video) blob = await uprightJpeg(blob);
                const ext = (/\.[a-z0-9]+$/i.exec(it.name) || ['.jpg'])[0];
                let name = it.name;
                if (set.fileName === 'tag' && tag) name = `${tag} ${String(imported.length + 1).padStart(3, '0')}${ext}`;
                let dir = target;
                if (set.fileName === 'originalFolders' && it.folder) {
                    // the phone's folder kept under the import folder
                    const list = ((await vfs().listDirectory(target, { offset: 0, limit: 1000 })) || {}).items || [];
                    const hit = list.find((e) => e.kind === 'folder' && e.name === it.folder);
                    if (hit) dir = hit.navPath || `${target}/${hit.id}`;
                    else { const res = await quiet(() => vfs().createFolder(target, it.folder)); const made = res && (res.folder || res); if (made && made.id) dir = `${target}/${made.id}`; }
                }
                const data = await new Promise((resolve) => { const r = new FileReader(); r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, '')); r.onerror = () => resolve(''); r.readAsDataURL(blob); });
                const up = await quiet(() => vfs().uploadFile(dir, data, name, blob.type || 'image/jpeg'));
                const id = up && ((up.file && up.file.id) || up.id || (up.item && up.item.id));
                if (id) imported.push({ source: 'folders', key: id, from: it });
            } catch (err) {
                await message(`The following error occurred while importing ${it.name}:\n${errorText(err)}`, 'error');
                break;
            }
        }
        // tags, the import record (Recently Imported), then the phone's copies erased when asked
        if (imported.length) {
            const refs = imported.map(({ source, key }) => ({ source, key }));
            try {
                if (tag) await send('glancewell_meta_set', { items: refs, change: { addTags: [tag] } });
                await send('glancewell_import_record', { items: refs });
            } catch (_) { /* the pictures are in; tags can be added later */ }
            if (erase && !cancelled) {
                for (const { from } of imported) {
                    try { await root.phoneStorage.call('delete', { root: from.raw.root, path: from.raw.path }); } catch (_) { /* left on the device */ }
                }
            }
        }
        prog.close();
        for (const k of S.loaded.keys()) if (k.startsWith('folders')) S.loaded.get(k).stale = true;
        renderTree();
        renderStatus();
        if (imported.length && set.openAfter) await showNode({ root: 'folders', kind: 'recent' });
    }

    /** The import's progress window (PhotoAcq dialog 1063: the picture, "Importing item n of m", the bar, Erase after importing). */
    function progressWindow(total, erase, onErase, onCancel) {
        const kit = root.personalizationDialogs && root.personalizationDialogs.sheetKit;
        if (!kit || typeof kit.makeWindow !== 'function') return { step() {}, close() {} };
        const { modal, content, close } = kit.makeWindow('glancewellImportProgress', 'Importing Pictures and Videos', 'gwi-progress', '/static_images/app_icons/vista-photo-gallery.png', false);
        content.innerHTML = `<div class="gwi-progress-body"><span class="gwi-progress-pic"></span><div class="gwi-progress-text"><p class="wpg-imp-line">Importing item 1 of ${total}</p><div class="wpg-imp-bar"><span></span></div><div class="tbp-check wpg-imp-erase"><input type="checkbox" id="wpgImpErase" class="wpg-imp-erase-box"${erase ? ' checked' : ''}><label for="wpgImpErase"><span>Erase after importing</span></label></div></div></div><div class="gwi-progress-foot"><button type="button" class="tbp-button" data-act="cancel">Cancel</button></div>`;
        const stop = () => onCancel();
        close.addEventListener('click', stop);
        content.querySelector('[data-act="cancel"]').addEventListener('click', stop);
        content.querySelector('.wpg-imp-erase-box').addEventListener('change', (e) => onErase(e.target.checked));
        kit.showWindow(modal, S.shell);
        return {
            step(n) {
                content.querySelector('.wpg-imp-line').textContent = `Importing item ${n} of ${total}`;
                content.querySelector('.wpg-imp-bar > span').style.width = `${Math.round((n - 1) / total * 100)}%`;
            },
            close() { kit.closeWindow(modal); }
        };
    }

    /**
     * File > Options: Photo Gallery's property sheet (PhotoLibraryResources dialog 249 General, PhotoAcq dialog 1108
     * Import) on the shared Vista sheet (personalizationDialogs.js sheetKit), saved on the server.
     */
    async function openOptions() {
        if (root.featureLoader) await root.featureLoader.loadFeature('control_panel').catch(() => {});
        const kit = root.personalizationDialogs && root.personalizationDialogs.sheetKit;
        await loadSettings();
        const cur = JSON.parse(JSON.stringify(SETTINGS || { tooltips: prefs.tooltips, originalsDays: 0, updateNotes: true, import: importSettings() }));
        if (!kit) { await message('Options are not available right now.', 'warning'); return; }
        kit.useUnits(kit.SEGOE);
        // controls placed in dialog units: the geometry goes on after the sheet is built (data-dlu)
        const sel = (cls, x, y, w, opts, value) => `<select class="tbp-ctl vdt-select ${cls}" data-dlu="${x},${y},${w},12">${opts.map(([v, t]) => `<option value="${esc(v)}"${String(v) === String(value) ? ' selected' : ''}>${esc(t)}</option>`).join('')}</select>`;
        const days = [[0, 'Never'], [1, 'One day'], [7, 'One week'], [30, 'One month'], [182, 'Six months'], [365, 'One year']];
        const general = kit.text(12, 8, 228, 8, 'Tooltips') + kit.check('gwoTips', 22, 19, 218, 14, 'Show picture and video previews in tooltips') +
            '<div class="tbp-ctl gwo-rule" data-dlu="12,44,233,1"></div>' + kit.text(12, 47, 228, 8, 'Original Pictures') +
            kit.text(22, 60, 213, 32, 'When you fix a picture in Photo Gallery, Melaton saves a copy of the original in case you want to revert. These originals can take up a lot of disk space.') +
            kit.text(22, 100, 206, 8, 'Move originals to Recycle Bin after:') + sel('gwo-days', 22, 111, 71, days, cur.originalsDays) +
            '<div class="tbp-ctl gwo-rule" data-dlu="13,131,233,1"></div>' + kit.text(12, 134, 228, 8, 'Automatic updates') +
            kit.check('gwoUpdates', 22, 145, 218, 14, 'Tell me when updates to Melaton Photo Gallery are available') + kit.button(22, 162, 90, 14, 'Check for updates', 'gwo-check');
        const imp = cur.import || importSettings();
        const ex = (fv, nv) => {
            const f = (FOLDER_NAMES.find((x) => x[0] === fv) || FOLDER_NAMES[0])[2];
            const n = (FILE_NAMES.find((x) => x[0] === nv) || FILE_NAMES[0])[2];
            const t = new Date(); const d2 = ymd(t.getTime()); const d1 = ymd(t.getTime() - 86400000 * 3);
            return `${f.replace('{DATE_ACQUIRED}', d2).replace('{DATE_TAKEN_2}', d2).replace('{DATE_TAKEN_1}', d1)}${f ? '\\' : ''}${n}`;
        };
        const watched = S.watched.map((w) => [w.folder, w.name]);
        const importPage = '<div class="tbp-group" data-dlu="7,9,245,169"><span class="tbp-group-label">Settings for:&nbsp;</span></div>' +
            sel('gwo-for', 69, 7, 147, [['cameras', 'Cameras'], ['other', 'Other Devices']], 'cameras') +
            kit.text(16, 44, 52, 8, 'Import to:') + sel('gwo-folder', 69, 42, 121, [['', 'Imported Pictures']].concat(watched.filter((w) => w[1] !== 'Imported Pictures')), imp.folder) + kit.button(193, 41, 50, 14, 'Browse...', 'gwo-browse') +
            kit.text(16, 63, 52, 8, 'Folder name:') + sel('gwo-foldername', 69, 61, 174, FOLDER_NAMES.map((x) => [x[0], x[1]]), imp.folderName) +
            kit.text(16, 82, 52, 8, 'File name:') + sel('gwo-filename', 69, 80, 174, FILE_NAMES.map((x) => [x[0], x[1]]), imp.fileName) +
            kit.text(16, 99, 52, 8, 'Example:') + kit.text(69, 99, 174, 8, esc(ex(imp.folderName, imp.fileName)), 'gwo-example') +
            kit.text(16, 114, 218, 8, 'Other options:') +
            kit.check('gwoPrompt', 24, 125, 218, 10, 'Prompt for a tag on import') + kit.check('gwoErase', 24, 137, 218, 10, 'Always erase from camera after importing') +
            kit.check('gwoRotate', 24, 149, 218, 10, 'Rotate pictures on import') + kit.check('gwoOpen', 24, 161, 218, 10, 'Open Melaton Photo Gallery after import') +
            kit.button(7, 200, 62, 14, 'Restore defaults', 'gwo-defaults');
        const read = (c) => ({
            tooltips: c.querySelector('#gwoTips').checked,
            originalsDays: Number(c.querySelector('.gwo-days').value),
            updateNotes: c.querySelector('#gwoUpdates').checked,
            import: {
                folder: c.querySelector('.gwo-folder').value,
                folderName: c.querySelector('.gwo-foldername').value,
                fileName: c.querySelector('.gwo-filename').value,
                promptTag: c.querySelector('#gwoPrompt').checked,
                erase: c.querySelector('#gwoErase').checked,
                rotate: c.querySelector('#gwoRotate').checked,
                openAfter: c.querySelector('#gwoOpen').checked
            }
        });
        const sheet = kit.makeSheet({
            id: 'glancewellOptionsDialog', title: 'Photo Gallery Options', cls: 'gwo-sheet', icon: '/static_images/app_icons/vista-photo-gallery.png',
            tabs: ['General', 'Import'], selected: 0, pages: [general, importPage],
            onApply: async () => {
                try {
                    const r = await send('glancewell_settings_set', { change: read(sheet.content) });
                    SETTINGS = r.settings;
                    prefs.tooltips = SETTINGS.tooltips;
                    savePrefs();
                } catch (err) { await message(errorText(err), 'error'); }
            },
            onAction: (action) => {
                const c = sheet.content;
                if (action === 'gwo-defaults') {
                    c.querySelector('.gwo-folder').value = '';
                    c.querySelector('.gwo-foldername').value = 'dateImportedTag';
                    c.querySelector('.gwo-filename').value = 'tag';
                    c.querySelector('#gwoPrompt').checked = true; c.querySelector('#gwoErase').checked = false;
                    c.querySelector('#gwoRotate').checked = true; c.querySelector('#gwoOpen').checked = true;
                    sync(); sheet.setDirty(true);
                } else if (action === 'gwo-browse' && typeof root.studioOpenFolderDialog === 'function') {
                    root.studioOpenFolderDialog('folder', { owner: sheet.modal, host: { title: 'Browse For Folder', onSave: async ({ path }) => {
                        const name = await folderName(path);
                        const s2 = c.querySelector('.gwo-folder');
                        if (![...s2.options].some((o) => o.value === path)) s2.add(new Option(name, path));
                        s2.value = path; sheet.setDirty(true); return true;
                    } } });
                } else if (action === 'gwo-check') {
                    // updates come with Melaton's own (Windows Update in Control Panel)
                    if (root.melatonControlPanel && typeof root.melatonControlPanel.open === 'function') root.melatonControlPanel.open('Microsoft.WindowsUpdate');
                    else void message('Photo Gallery is up to date.', 'info');
                }
            }
        });
        const c = sheet.content;
        c.querySelectorAll('[data-dlu]').forEach((n) => { const [x, y, w, h] = n.dataset.dlu.split(',').map(Number); n.style.cssText = kit.dlu(x, y, w, h); });
        c.querySelector('#gwoTips').checked = !!cur.tooltips;
        c.querySelector('#gwoUpdates').checked = cur.updateNotes !== false;
        c.querySelector('#gwoPrompt').checked = !!imp.promptTag; c.querySelector('#gwoErase').checked = !!imp.erase;
        c.querySelector('#gwoRotate').checked = !!imp.rotate; c.querySelector('#gwoOpen').checked = !!imp.openAfter;
        const sync = () => { c.querySelector('.gwo-example').textContent = ex(c.querySelector('.gwo-foldername').value, c.querySelector('.gwo-filename').value); };
        c.addEventListener('change', () => { sync(); sheet.setDirty(true); });
        // Photo Gallery's own Options: an owned dialog, no taskbar button
        sheet.modal.dataset.windowOwned = 'true';
        kit.showWindow(sheet.modal, S.shell);
    }

    // ------------------------------------------------------------------ Vista dialogs and lists (never the browser's: no
    // datalist, native radios, check boxes or number spinners; no-native-browser-ui.mdc, Yukimi Nov 21 2026)

    const GALLERY_ICON = '/static_images/app_icons/vista-photo-gallery.png';

    /** The shared Vista dialog kit (personalizationDialogs.js sheetKit), loaded with Control Panel. */
    async function dialogKit() {
        if (root.featureLoader) await root.featureLoader.loadFeature('control_panel').catch(() => {});
        const kit = root.personalizationDialogs && root.personalizationDialogs.sheetKit;
        if (kit) kit.useUnits(kit.SEGOE);
        return kit || null;
    }

    /**
     * A Vista dialog of kit controls placed in dialog units (data-dlu="x,y,w,h"). Buttons are kit buttons with
     * data-action; "ok" resolves with ready()'s accept(), "cancel" / the X / Escape with null. Enter presses OK.
     */
    async function kitDialog({ id, title, cls, html, ready }) {
        const kit = await dialogKit();
        if (!kit) { await message(`${title} is not available right now.`, 'warning'); return null; }
        const old = doc.getElementById(id);
        if (old) kit.closeWindow(old);
        const { modal, content, close } = kit.makeWindow(id, title, cls, GALLERY_ICON, false);
        // an owned dialog: no taskbar button of its own, as in Windows (modalUtils.js shouldShowInTaskbar)
        modal.dataset.windowOwned = 'true';
        content.innerHTML = html;
        content.querySelectorAll('[data-dlu]').forEach((n) => { const [x, y, w, h] = n.dataset.dlu.split(',').map(Number); n.style.cssText = kit.dlu(x, y, w, h); });
        return new Promise((resolve) => {
            let done = false;
            const ac = new AbortController();
            const finish = (v) => {
                if (done) return;
                done = true;
                ac.abort();
                kit.closeWindow(modal);
                if (S.shell && !S.shell.classList.contains('hidden') && typeof root.bringModalToFront === 'function') root.bringModalToFront(S.shell);
                resolve(v);
            };
            const api = (ready && ready(content, { finish, signal: ac.signal })) || {};
            const accept = () => {
                const v = typeof api.accept === 'function' ? api.accept() : true;
                if (v !== undefined && v !== false) finish(v);
            };
            close.addEventListener('click', () => finish(null), { signal: ac.signal });
            content.addEventListener('click', (e) => {
                const b = e.target.closest('[data-action]');
                if (!b) return;
                if (b.dataset.action === 'ok') accept();
                else if (b.dataset.action === 'cancel') finish(null);
            }, { signal: ac.signal });
            content.addEventListener('keydown', (e) => {
                if (e.defaultPrevented) return;
                if (e.key === 'Escape') { e.preventDefault(); finish(null); }
                else if (e.key === 'Enter' && !e.target.closest('button')) { e.preventDefault(); accept(); }
            }, { signal: ac.signal });
            kit.showWindow(modal, S.shell);
            const f = content.querySelector('[data-autofocus]');
            if (f) setTimeout(() => { f.focus(); if (f.select) f.select(); }, 60);
        });
    }

    /** A kit text box at x,y,w (12 DLU high). */
    const kitEdit = (cls, x, y, w, value = '', extra = '') => `<input type="text" class="tbp-ctl tbp-edit ${cls}" data-dlu="${x},${y},${w},12" value="${esc(value)}" autocomplete="off" spellcheck="false"${extra}>`;
    /** A kit check box or radio button (Vista's own art), the input before its label as the kit draws it. */
    const kitCheck = (type, idv, name, value, x, y, w, label, checked, cls = '') => `<div class="tbp-ctl tbp-check ${cls}" data-dlu="${x},${y},${w},10"><input type="${type}" id="${idv}"${name ? ` name="${name}"` : ''}${value != null ? ` value="${esc(value)}"` : ''}${checked ? ' checked' : ''}><label for="${idv}"><span>${label}</span></label></div>`;
    const kitButton = (x, y, w, label, action, extra = '') => `<button type="button" class="tbp-ctl tbp-button" data-dlu="${x},${y},${w},14" data-action="${action}"${extra}>${label}</button>`;
    const kitText = (x, y, w, h, body, cls = '') => `<div class="tbp-ctl tbp-static ${cls}" data-dlu="${x},${y},${w},${h}">${body}</div>`;

    /**
     * Suggestions under a text box as a Vista list drop-down (instead of the browser's datalist): fetch(query) gives
     * [{ text, note }]; pick(item) runs on a click or Enter. Arrow keys move, Escape closes. Returns { close }.
     */
    function attachSuggest(input, fetch, pick, signal) {
        const list = h('div', 'wpg-suggest');
        list.setAttribute('role', 'listbox');
        list.hidden = true;
        doc.body.appendChild(list);
        let items = [];
        let at = -1;
        let seq = 0;
        let timer = 0;
        const close = () => { list.hidden = true; items = []; at = -1; };
        const place = () => {
            const r = input.getBoundingClientRect();
            list.style.left = `${Math.round(r.left)}px`;
            list.style.top = `${Math.round(r.bottom)}px`;
            list.style.minWidth = `${Math.round(r.width)}px`;
        };
        const draw = () => {
            list.innerHTML = items.map((x, i) => `<div class="wpg-suggest-opt${i === at ? ' is-active' : ''}" role="option" aria-selected="${i === at}" data-i="${i}"><span>${esc(x.text)}</span>${x.note ? `<span class="wpg-suggest-note">${esc(x.note)}</span>` : ''}</div>`).join('');
            list.hidden = !items.length;
            if (items.length) place();
        };
        const opts = signal ? { signal } : undefined;
        input.addEventListener('input', () => {
            clearTimeout(timer);
            const mine = ++seq;
            timer = setTimeout(async () => {
                const got = await Promise.resolve(fetch(input.value)).catch(() => []);
                if (mine !== seq) return;
                items = got || [];
                at = -1;
                draw();
            }, 150);
        }, opts);
        input.addEventListener('keydown', (e) => {
            if (list.hidden || !items.length) return;
            if (e.key === 'ArrowDown') { e.preventDefault(); at = (at + 1) % items.length; draw(); }
            else if (e.key === 'ArrowUp') { e.preventDefault(); at = (at - 1 + items.length) % items.length; draw(); }
            else if (e.key === 'Enter' && at >= 0) { e.preventDefault(); e.stopPropagation(); const it = items[at]; close(); pick(it); }
            else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
        }, opts);
        input.addEventListener('blur', () => setTimeout(close, 150), opts);
        list.addEventListener('mousedown', (e) => {
            const o = e.target.closest('.wpg-suggest-opt');
            if (!o) return;
            e.preventDefault();
            const it = items[Number(o.dataset.i)];
            close();
            pick(it);
        });
        const remove = () => { clearTimeout(timer); list.remove(); };
        if (signal) signal.addEventListener('abort', remove, { once: true });
        return { close, remove };
    }

    /** The gallery's own tags that start with (or hold) what is typed. */
    function tagSuggestions(q) {
        const v = String(q || '').trim().toLowerCase();
        if (!v) return [];
        const starts = S.tags.filter((t) => t.name.toLowerCase().startsWith(v));
        const holds = S.tags.filter((t) => !t.name.toLowerCase().startsWith(v) && t.name.toLowerCase().includes(v));
        return starts.concat(holds).slice(0, 12).map((t) => ({ text: t.name }));
    }

    // ------------------------------------------------------------------ message boxes (Vista's, never the browser's)

    const ICONS = { info: 'fas fa-circle-info', warning: 'fas fa-triangle-exclamation', error: 'fas fa-circle-xmark', question: 'fas fa-circle-question' };
    function dialog(html, buttons, config = {}) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        const cfg = Object.assign({ title: 'Melaton Photo Gallery', owner: S.shell }, config);
        // confirmationDialog.js calls onDialogReady(signal): ours take the dialog element (and the signal for listeners)
        if (typeof config.onDialogReady === 'function') {
            const ready = config.onDialogReady;
            cfg.onDialogReady = (signal) => {
                const el = doc.getElementById('confirmationDialog');
                ready(el, signal);
                // the dialog puts focus on its default button after this: the field marked data-autofocus takes it back
                setTimeout(() => { const f = el && el.querySelector('[data-autofocus]'); if (f) { f.focus(); if (f.select) f.select(); } }, 60);
            };
        }
        return root.showConfirmationDialog(html, buttons, null, cfg);
    }
    // always markup: confirmationDialog.js takes a message without a tag as text, so its &quot; would show as typed
    const textHtml = (text) => `<div>${esc(text).replace(/\n/g, '<br>')}</div>`;
    function message(text, icon = 'info') {
        return dialog(textHtml(text), [{ text: 'OK', value: true }], { icon: ICONS[icon] || ICONS.info });
    }
    async function confirmBox(text, title) {
        return (await dialog(textHtml(text), [{ text: 'Yes', value: true }, { text: 'No', value: false }], { title: title || 'Melaton Photo Gallery', icon: ICONS.warning })) === true;
    }
    const errorText = (err) => (err && (err.message || err.error)) || 'Something went wrong.';

    // ------------------------------------------------------------------ public

    async function open(opts = {}) {
        if (!build()) return;
        const shell = S.shell;
        S.owns = true;
        if (shell.classList.contains('hidden') && typeof root.openModal === 'function') {
            shell.classList.add('windowed');
            if (typeof root.wirePhotoSwipeShellControlsOnce === 'function') root.wirePhotoSwipeShellControlsOnce();
            root.openModal(shell);
            if (typeof root.ensureModalEdgesWithinWorkArea === 'function') root.ensureModalEdgesWithinWorkArea(shell);
        } else if (typeof root.bringModalToFront === 'function') root.bringModalToFront(shell);
        if (typeof root.wireGlancewellChromeOnce === 'function') root.wireGlancewellChromeOnce();
        // the library at once; its tags, watched folders, recent imports and settings fill in as they answer (it stayed
        // blank behind one that did not answer, Nov 21 2026)
        if (S.open) rememberPlace();
        showLibrary();
        void Promise.all([loadTags(), loadSmartTags(), loadWatched(), loadRecent(), loadSettings()].map((p) => Promise.resolve(p).catch(() => null))).then(() => {
            // a newer view saved by another client: its zoom, sort and places (the open folder stays this one's)
            const adopted = adoptServerView(SETTINGS && SETTINGS.view);
            if (adopted) { cellCache.clear(); S.layout = null; }
            renderTree();
            refresh();
            if (adopted && S.seenTop === S.placedTop) restorePlace();
        });
        await showNode(opts.node || S.node || { root: 'prints', kind: 'all' }, { history: false });
    }

    /** Back To Gallery from the viewer: the gallery again, on that picture. */
    function showFromViewer(slideData) {
        const id = slideData && slideData.gwItem;
        showLibrary();
        S.el.scroller.focus({ preventScroll: true });
        if (!id || !itemsById.has(id)) return;
        select(id);
        // after the gallery has laid itself out again (it was hidden behind the viewer): that picture, centred
        // (Yukimi, Nov 21 2026: back to the gallery should land on the item)
        requestAnimationFrame(() => requestAnimationFrame(() => { S.layout = null; scrollIntoView(id, true); }));
    }

    /** A video told its length (glancewellVideo.js): Info and the Details view show it from now on. */
    function noteVideoLength(id, seconds) {
        const it = id && itemsById.get(id);
        if (!it || it.duration === seconds) return;
        it.duration = seconds;
        if (S.built && infoItem === it) renderInfo(it);
    }

    function itemForSlide(data) {
        return data && data.gwItem ? itemsById.get(data.gwItem) || null : null;
    }

    function currentPicture() {
        const it = S.focus ? itemsById.get(S.focus) : selectedItems()[0];
        if (!it) return { filename: '', title: '', metadata: {}, src: '' };
        if (it.source !== 'prints') return { filename: '', title: it.name, metadata: {}, src: it.full() };
        return { filename: it.key, title: it.key, metadata: printRecord(it), src: it.full() };
    }

    /** The Info pane in the viewer: the slide's library item, else one made from the print or the picture shown. */
    function renderViewerInfo(slideData, pic) {
        build();
        const data = slideData && (slideData.data || slideData);
        let it = itemForSlide(data);
        if (!it && pic) {
            const meta = pic.metadata || {};
            const print = !!pic.filename;
            it = {
                id: print ? SRC().itemId('prints', pic.filename) : `url|${pic.src}`,
                source: print ? 'prints' : 'url',
                key: pic.filename || pic.src,
                name: pic.title || pic.filename || 'Picture',
                width: Number(meta.width || (meta.display && meta.display.width)) || 0,
                height: Number(meta.height || (meta.display && meta.display.height)) || 0,
                size: Number(meta.size) || 0,
                taken: Number(meta.mtime) || Number((String(pic.title).match(/^(\d{13})_/) || [])[1]) || 0,
                modified: Number(meta.mtime) || 0,
                pinned: !!meta.isPinned,
                thumb: () => pic.src,
                full: () => pic.src,
                raw: meta
            };
        }
        if (it && it.source !== 'url' && !S.index.has(it.source)) void loadIndex(it.source).then(() => renderInfo(it));
        if (!S.tags.length) void loadTags().then(() => renderInfo(it || null));
        renderInfo(it || null);
    }

    /** E-mail: a new Dovecote message with the picture attached, or Messenger with it waiting on a conversation. */
    async function sendPicture(kind, pic) {
        const src = pic && pic.src;
        if (!src) return;
        let blob = null;
        try { blob = await (await fetch(src, { credentials: 'same-origin' })).blob(); } catch (_) { blob = null; }
        if (!blob) { await message('The picture could not be read.', 'error'); return; }
        const ext = (/^image\/(png|jpeg|webp|gif)$/.exec(blob.type) || [])[1] || 'png';
        const base = String(pic.title || pic.filename || 'Picture').replace(/\.[a-z0-9]+$/i, '');
        const name = `${base}.${ext === 'jpeg' ? 'jpg' : ext}`;
        if (kind === 'dovecote') {
            const open = doveCompose();
            if (typeof open !== 'function') { await message('The picture could not be sent. Check that an e-mail program is installed and then try again.', 'error'); return; }
            const base64 = await new Promise((resolve) => {
                const r = new FileReader();
                r.onload = () => resolve(String(r.result).replace(/^data:[^,]*,/, ''));
                r.onerror = () => resolve('');
                r.readAsDataURL(blob);
            });
            open({ mode: 'create', to: '', subject: base, body: '', attachments: [{ name, mimeType: blob.type || 'image/png', size: blob.size, base64 }] });
            return;
        }
        if (root.melatonApps && typeof root.melatonApps.launch === 'function') {
            await root.melatonApps.launch({ packageId: 'messenger', args: { attach: [new File([blob], name, { type: blob.type || 'image/png' })] } });
        }
    }
    root.glancewellSendPicture = sendPicture;

    // the page's other windows close the shell: the gallery forgets it owned it
    if (doc) {
        doc.addEventListener('staticforge:modal-lifecycle', (e) => {
            const d = e && e.detail;
            if (d && d.type === 'closed' && d.id === 'photoSwipeWindow') { if (S.open) rememberPlace(); S.owns = false; S.open = false; hideTip(); }
        }, { signal: appScopeSignal });
    }

    root.glancewellLibrary = {
        open,
        isOpen: () => S.open,
        active: () => S.owns,
        showFromViewer,
        enterViewer,
        currentPicture,
        renderInfo: (item) => renderInfo(item === undefined ? undefined : item),
        renderViewerInfo,
        itemForSlide,
        noteVideoLength,
        deleteViewerItem,
        handleControl,
        zoomFraction,
        setZoomFraction,
        fileMenuItems,
        runFileAction,
        openAddTags: () => openAddTags(S.open ? undefined : [infoItem].filter(Boolean)),
        _state: S
    };
})(typeof window !== 'undefined' ? window : globalThis);
