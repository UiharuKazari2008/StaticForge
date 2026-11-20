/**
 * Glancewell's library: Windows Photo Gallery's gallery view, 1:1 with the Vista VM (Yozora #446; captures in
 * ~/.cache/vista-vm/wpg/shots, strings and menus from PhotoLibraryResources.dll.mui). It lives in the Glancewell
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
    const send = (type, data) => {
        const c = ws();
        return c && typeof c.sendMessage === 'function' ? c.sendMessage(type, data || {}, false) : Promise.reject(new Error('offline'));
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
    const TOC_W = 142;
    const TOOLTIP_DELAY = 700;

    // the tree strip (BITMAP 205 / 1814): index -> icon
    const ICON = {
        all: 0, tags: 1, folders: 2, date: 3, recent: 4, ratings: 5, pictures: 6, videos: 7, newTag: 8, untagged: 9,
        tag: 10, folder: 11, folderPictures: 12, folderVideos: 13, folderUser: 14, disc: 16, computer: 17, year: 18,
        month: 19, day: 20, star: 21, starOff: 22
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

    const prefs = Object.assign({
        view: 'thumbs', size: SIZE_DEFAULT, group: 'auto', groupDir: 'desc', sort: 'date', sortDir: 'asc', toc: false,
        tooltips: true, expanded: { prints: true }, node: { root: 'prints', kind: 'all' }
    }, readPrefs());

    function readPrefs() {
        try { return JSON.parse(root.localStorage.getItem(PREFS_KEY) || '{}') || {}; } catch (_) { return {}; }
    }
    let prefsTimer = 0;
    function savePrefs() {
        clearTimeout(prefsTimer);
        prefsTimer = setTimeout(() => { try { root.localStorage.setItem(PREFS_KEY, JSON.stringify(prefs)); } catch (_) { /* full */ } }, 400);
    }

    // ------------------------------------------------------------------ state

    const S = {
        built: false,
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
        editing: null
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
    const dimsText = (it) => (it.width && it.height ? `${it.width} x ${it.height}` : '');
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
            const wsId = node.kind === 'workspace' ? node.value : SRC().get('prints').activeWorkspaceId();
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
            case 'album': return items.filter((it) => it.raw && `${it.raw.root}:${it.folder}` === node.value);
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
        if (history && S.node && nodeKey(S.node) !== nodeKey(node)) { S.history.push(S.node); S.future = []; }
        S.node = node;
        prefs.node = node;
        savePrefs();
        S.selected.clear();
        S.focus = null;
        S.anchor = null;
        renderTree();
        syncNav();
        const { key, scope } = scopeKeyOf(node);
        const have = S.loaded.get(key);
        S.items = have ? have.items.slice() : [];
        refresh();
        await loadScope(node.root, scope, key);
        if (nodeKey(S.node) !== nodeKey(node)) return;
        S.items = (S.loaded.get(key) || {}).items || [];
        renderTree();
        refresh();
    }
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
            add({ root: rootId, kind: 'untagged' }, depth + 1, 'Not Tagged', ICON.untagged);
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
            add({ root: 'pictures', kind: 'favorites' }, 1, 'Favorites', ICON.star);
            tagRows('pictures', 1);
            dateRows('pictures', 1);
        }
        // DreamScape Prints
        if (rootRow('prints', 'DreamScape Prints', ICON.all)) {
            add({ root: 'prints', kind: 'favorites' }, 1, 'Favorites', ICON.star);
            add({ root: 'prints', kind: 'scraps' }, 1, 'Scraps', ICON.starOff);
            tagRows('prints', 1);
            dateRows('prints', 1);
            const wk = 'prints:workspaces';
            add({ root: 'prints', kind: 'workspaces' }, 1, 'Workspaces', ICON.folders, { key: wk, expandable: true, expanded: exp(wk) });
            if (exp(wk)) SRC().get('prints').workspaces().forEach((w) => add({ root: 'prints', kind: 'workspace', value: w.id }, 2, w.name, ICON.folderPictures));
        }
        // DreamScape References
        if (rootRow('refs', 'DreamScape References', ICON.folderPictures)) {
            SRC().get('refs').types.forEach((t) => add({ root: 'refs', kind: 'reftype', value: t.id }, 1, t.name, ICON.pictures));
            tagRows('refs', 1);
            dateRows('refs', 1);
        }
        // Folders: the watched VFS folders
        if (rootRow('folders', 'Folders', ICON.folders)) {
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
            if (r.node.root.startsWith('device:') && r.depth === 0) ic.classList.add('is-device');
            else ic.style.setProperty('--i', String(r.icon));
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
        if (r.action === 'addfolder') { addFolderToGallery(); return; }
        if (['tags', 'dates', 'workspaces'].includes(r.node.kind)) { toggleTree(r); return; }
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
        } else if (r.node.kind === 'tags' && r.node.root !== 'refs') {
            items.push({ text: 'Create Tag', action: 'gwt-newtag' });
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
        const top = sc.scrollTop - 200;
        const bottom = sc.scrollTop + sc.clientHeight + 200;
        const frag = doc.createDocumentFragment();
        const { m, left, cols } = L;
        S.groups.forEach((g) => {
            if (g.bottom < top || g.top > bottom) return;
            if (L.showHeaders) {
                const hd = h('div', 'wpg-lib-group');
                hd.dataset.group = g.key;
                hd.style.cssText = `top:${g.top}px;left:${left - 3}px;right:12px`;
                const sel = g.items.filter((it) => S.selected.has(it.id)).length;
                hd.innerHTML = `<span class="wpg-lib-group-label">${esc(g.label)} - ${esc(countText(g.items.length))}${sel ? `, ${sel} selected` : ''}</span><span class="wpg-lib-group-rule"></span><button type="button" class="wpg-lib-group-arrow${g.collapsed ? ' is-collapsed' : ''}" title="${g.collapsed ? 'Expand Group' : 'Collapse Group'}"></button>`;
                frag.appendChild(hd);
            }
            if (g.collapsed) return;
            const first = Math.max(0, Math.floor((top - g.bodyTop) / m.ch));
            const last = Math.min(g.rows - 1, Math.floor((bottom - g.bodyTop) / m.ch));
            for (let r = first; r <= last; r++) {
                for (let c = 0; c < cols; c++) {
                    const it = g.items[r * cols + c];
                    if (!it) break;
                    frag.appendChild(cellFor(it, left + c * m.cw, g.bodyTop + r * m.ch, m));
                }
            }
        });
        S.el.canvas.replaceChildren(frag);
        if (prefs.toc) drawToc();
    }

    const cellCache = new Map(); // id|view|size -> element (reused while it stays in view)
    function cellFor(it, x, y, m) {
        const k = `${it.id}|${prefs.view}|${m.box}|${it.rev || 0}`;
        let cell = cellCache.get(k);
        if (!cell) {
            cell = h('div', 'wpg-lib-cell');
            cell.dataset.id = it.id;
            const fr = h('div', 'wpg-lib-frame');
            const img = h('img', 'wpg-lib-img');
            img.alt = '';
            img.decoding = 'async';
            img.loading = 'lazy';
            img.draggable = false;
            img.src = thumbOf(it, m.box * (root.devicePixelRatio || 1));
            img.addEventListener('load', () => cell.classList.add('is-loaded'), { once: true });
            img.addEventListener('error', () => cell.classList.add('is-broken'), { once: true });
            fr.appendChild(img);
            if (it.video) fr.classList.add('is-video');
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
            if (prefs.view === 'text') tx.textContent = dateText(takenOf(it));
            else {
                const cap = captionOf(it);
                tx.innerHTML = `<div class="wpg-lib-t-name">${esc(it.name)}</div><div>${esc(dateText(takenOf(it)))}</div><div class="wpg-lib-t-dim">${esc(sizeText(it.size))}</div><div class="wpg-lib-t-dim">${esc(dimsText(it))}</div><div class="wpg-lib-t-cap${cap ? '' : ' is-empty'}">${esc(cap || '<Add Caption>')}</div>`;
            }
        }
        return cell;
    }

    /** Table of Contents: the groups down the left, the band over the ones in view. */
    function drawToc() {
        const L = S.layout;
        const sc = S.el.scroller;
        const total = Math.max(1, L.height);
        const avail = Math.max(60, sc.clientHeight - 24);
        const top = sc.scrollTop;
        const parts = S.groups.map((g) => {
            const visible = g.bottom > top && g.top < top + sc.clientHeight;
            const ticks = Math.min(12, Math.max(1, Math.round(g.items.length / Math.max(1, S.shown.length) * 30)));
            return `<button type="button" class="wpg-lib-toc-row${visible ? ' is-visible' : ''}" data-group="${esc(g.key)}"><span class="wpg-lib-toc-label">${esc(g.label)}</span><span class="wpg-lib-toc-ticks" style="--n:${ticks}"></span></button>`;
        }).join('');
        S.el.toc.style.cssText = `top:${top}px;height:${Math.min(avail, total)}px`;
        S.el.toc.innerHTML = `<div class="wpg-lib-toc-up"></div>${parts}`;
    }
    function onTocClick(e) {
        const row = e.target.closest('.wpg-lib-toc-row');
        if (!row) return;
        const g = S.groups.find((x) => x.key === row.dataset.group);
        if (g) S.el.scroller.scrollTop = g.top;
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
            default: break;
        }
    }

    function scrollIntoView(id) {
        const L = S.layout || computeLayout();
        for (const g of S.groups) {
            const k = g.items.findIndex((it) => it.id === id);
            if (k < 0) continue;
            if (g.collapsed) { S.collapsed.delete(g.key); S.layout = null; computeLayout(); }
            const y = g.bodyTop + Math.floor(k / L.cols) * L.m.ch;
            const sc = S.el.scroller;
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
        input.setAttribute('list', 'wpgLibTagNames');
        let dl = doc.getElementById('wpgLibTagNames');
        if (!dl) { dl = h('datalist'); dl.id = 'wpgLibTagNames'; doc.body.appendChild(dl); }
        dl.innerHTML = S.tags.map((t) => `<option value="${esc(t.name)}">`).join('');
        btn.after(input);
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
        } else if (action === 'gwl-toc') { prefs.toc = !prefs.toc; savePrefs(); S.layout = null; queueRender(); }
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
            { text: 'Delete', action: 'gwi-delete' },
            { text: 'Properties', action: 'gwi-properties', disabled: !one }
        ];
        // Dreamscape's own actions on a print (Yukimi, Nov 20 2026: the rest go to the right-click menu)
        if (print && one) {
            list.push({ separator: true },
                { text: it.pinned ? 'Remove from Favorites' : 'Add to Favorites', action: 'gwi-pin' },
                { text: 'Add to Desktop', action: 'gw-desktop' },
                { text: 'New Reference', action: 'gw-reference' },
                { text: 'Open in DreamStudio', action: 'gw-studio' },
                { text: 'Edit in Paint', action: 'gw-paint' },
                { text: 'Open in Lumen', action: 'gw-lumen' },
                { text: 'Create Persona', action: 'gw-persona' });
        } else if (!print && it && it.source !== 'refs' && one) {
            list.push({ separator: true }, { text: isFavorite(it) ? 'Remove from Favorites' : 'Add to Favorites', action: 'gwi-fav' });
        }
        return [{ type: 'list', items: list }];
    }

    async function onItemMenu(action, target, item, event) {
        const items = selectedItems();
        const it = S.focus ? itemsById.get(S.focus) : items[0];
        if (!it) return;
        switch (action) {
            case 'gwi-preview': openViewer(it.id); break;
            case 'gwi-tags': openAddTags(items); break;
            case 'gwi-time': void changeTimeTaken(items); break;
            case 'gwi-rotr': void rotateSelection(1); break;
            case 'gwi-rotl': void rotateSelection(-1); break;
            case 'gwi-delete': void deleteSelection(); break;
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

    /** Pictures whose file Glancewell can write back (prints, VFS files, phone pictures; not references or videos). */
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
        const items = selectedItems();
        if (!items.length) return;
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
                if (!await confirmBox(`Are you sure you want to delete ${what}?`, items.length === 1 ? 'Delete File' : 'Delete Multiple Items')) return;
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
                    else if (it.raw && it.raw.root && root.phoneStorage) await root.phoneStorage.call('delete', { root: it.raw.root, path: it.raw.path });
                }
                await send('glancewell_forget', { items: items.map(ref) });
            }
        } catch (err) {
            await message(errorText(err), 'error');
        }
        const ids = new Set(items.map((x) => x.id));
        for (const v of S.loaded.values()) v.items = (v.items || []).filter((x) => !ids.has(x.id));
        S.items = S.items.filter((x) => !ids.has(x.id));
        S.selected.clear();
        refresh();
    }

    /** Change Time Taken (dialog 1472): hours -24..+24 from each picture's own date. */
    async function changeTimeTaken(items) {
        if (!items.length) return;
        const cur = takenOf(items[0]);
        const hours = await promptHours(cur);
        if (hours == null || hours === 0) return;
        try { await send('glancewell_meta_set', { items: items.map(ref), change: { takenShiftHours: hours } }); } catch (err) { await message(errorText(err), 'error'); }
    }

    function promptHours(cur) {
        const html = `<div class="wpg-lib-time"><p>Change the time stamp for selected pictures and videos.</p><p class="wpg-lib-time-row"><span>Change by:</span><span><input type="number" min="-24" max="24" step="1" value="0" class="wpg-lib-time-h"> hours</span></p><p class="wpg-lib-time-row"><span>New Time:</span><span class="wpg-lib-time-new">${esc(dateText(cur))}</span></p><p class="wpg-lib-time-row"><span>Current Time:</span><span>${esc(dateText(cur))}</span></p></div>`;
        return dialog(html, [{ text: 'OK', value: 'ok' }, { text: 'Cancel', value: null }], {
            title: 'Change Time Taken',
            icon: 'fas fa-clock',
            onDialogReady: (dlg) => {
                const inp = dlg.querySelector('.wpg-lib-time-h');
                if (!inp) return;
                inp.addEventListener('input', () => { dlg.querySelector('.wpg-lib-time-new').textContent = dateText(cur + (Number(inp.value) || 0) * 3600000); });
                inp.focus();
                inp.select();
            },
            resolveValue: (value, dlg) => {
                if (value !== 'ok') return null;
                const n = Number(dlg.querySelector('.wpg-lib-time-h').value);
                // WPG 974
                return Number.isInteger(n) && n >= -24 && n <= 24 ? n : null;
            }
        });
    }

    // ------------------------------------------------------------------ the viewer, the pill, the band

    /** A viewer slide for a library item: prints keep the gallery's own slide shape (every viewer action works). */
    function slideFor(it) {
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
        const at = S.focus ? Math.max(0, list.findIndex((it) => it.id === S.focus)) : 0;
        S.owns = true;
        enterViewer();
        root.glancewellStartSlideShow = true;
        void root.openStandalonePhotoSwipe(list.filter((it) => !it.video).map(slideFor), at);
    }

    function enterViewer() {
        if (!S.built) return;
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
        if (title) title.textContent = 'Glancewell';
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
    function fileMenuItems() {
        const items = selectedItems();
        const one = items.length === 1;
        return [
            { text: 'Add Folder to Gallery...', action: 'gwf-addfolder' },
            { text: 'Import from Camera or Scanner...', action: 'gwf-import', disabled: !SRC().devices().length },
            { separator: true },
            { text: 'Delete', subtext: 'Del', action: 'gwf-delete', disabled: !items.length },
            { text: 'Rename', subtext: 'Ctrl+M', action: 'gwf-rename', disabled: true },
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
            case 'gwf-delete': await deleteSelection(); return true;
            case 'gwf-selectall': S.shown.forEach((it) => S.selected.add(it.id)); queueRender(); renderStatus(); renderInfo(); syncCommands(); return true;
            case 'gwf-screensaver':
                // Screen Saver Settings (personalizationDialogs.js, in the Control Panel feature)
                if (root.featureLoader) await root.featureLoader.loadFeature('control_panel').catch(() => {});
                if (root.personalizationDialogs) root.personalizationDialogs.openScreenSaver();
                return true;
            case 'gwf-share':
                if (root.explorerPhoneDrive && typeof root.explorerPhoneDrive.sendFiles === 'function') await root.explorerPhoneDrive.sendFiles(items.map((it) => ({ name: it.name, url: it.full() })));
                return true;
            case 'gwf-options': openOptions(); return true;
            case 'gwf-exit': if (typeof root.closeModal === 'function') root.closeModal(S.shell); return true;
            case 'gwi-copy': case 'gwi-properties': { const it = S.focus ? itemsById.get(S.focus) : items[0]; if (it) await itemAction(action, it); return true; }
            default: void event; return false;
        }
    }

    /** File > Options: the tooltip previews (General); the rest of the page is the VM's. */
    function openOptions() {
        const html = `<div class="wpg-lib-options"><p class="wpg-lib-options-h">Tooltips</p><label><input type="checkbox" class="wpg-lib-opt-tips"${prefs.tooltips ? ' checked' : ''}> Show picture and video previews in tooltips</label></div>`;
        void dialog(html, [{ text: 'OK', value: 'ok' }, { text: 'Cancel', value: null }], {
            title: 'Glancewell Options',
            icon: 'fas fa-gear',
            resolveValue: (value, dlg) => (value === 'ok' ? { tips: !!dlg.querySelector('.wpg-lib-opt-tips').checked } : null)
        }).then((r) => {
            if (!r) return;
            prefs.tooltips = r.tips;
            savePrefs();
        });
    }

    // ------------------------------------------------------------------ message boxes (Vista's, never the browser's)

    const ICONS = { info: 'fas fa-circle-info', warning: 'fas fa-triangle-exclamation', error: 'fas fa-circle-xmark', question: 'fas fa-circle-question' };
    function dialog(html, buttons, config = {}) {
        if (typeof root.showConfirmationDialog !== 'function') return Promise.resolve(null);
        return root.showConfirmationDialog(html, buttons, null, Object.assign({ title: 'Glancewell', owner: S.shell }, config));
    }
    function message(text, icon = 'info') {
        return dialog(esc(text).replace(/\n/g, '<br>'), [{ text: 'OK', value: true }], { icon: ICONS[icon] || ICONS.info });
    }
    async function confirmBox(text, title) {
        return (await dialog(esc(text).replace(/\n/g, '<br>'), [{ text: 'Yes', value: true }, { text: 'No', value: false }], { title: title || 'Glancewell', icon: ICONS.warning })) === true;
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
        await Promise.all([loadTags(), loadWatched()]);
        showLibrary();
        await showNode(opts.node || S.node || { root: 'prints', kind: 'all' }, { history: false });
    }

    /** Back To Gallery from the viewer: the gallery again, on that picture. */
    function showFromViewer(slideData) {
        const id = slideData && slideData.gwItem;
        showLibrary();
        if (id && itemsById.has(id)) {
            select(id);
            scrollIntoView(id);
        }
        S.el.scroller.focus({ preventScroll: true });
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
            if (d && d.type === 'closed' && d.id === 'photoSwipeWindow') { S.owns = false; S.open = false; hideTip(); }
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
        handleControl,
        zoomFraction,
        setZoomFraction,
        fileMenuItems,
        runFileAction,
        openAddTags: () => openAddTags(S.open ? undefined : [infoItem].filter(Boolean)),
        _state: S
    };
})(typeof window !== 'undefined' ? window : globalThis);
