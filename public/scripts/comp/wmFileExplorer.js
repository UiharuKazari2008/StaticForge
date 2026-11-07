/**
 * Melaton Mobile: File Explorer, the Windows Mobile 6.1 Professional stock app over Dreamscape's
 * VFS (Cartograph), Yozora #709. The same folders and files the desktop Explorer lists
 * (vfsClient.listDirectory), drawn and behaving like WM 6.1 File Explorer.
 *
 * Measured on the Device Emulator (VGA, 2x halved):
 *   folder bar   22 px tab-strip tint + 1 px black rule (wm-shell.css .wm-pv-bar): the location
 *                icon (My Device, shellres image list 19712), the folder name and a drop-down of
 *                the path; at the right the sort drop-down ("Name"; Sort By Name / Date / Size / Type)
 *   list         rows 18 px, bold 12 px Tahoma; 16 px icon at x 2, name at x 21 (ellipsis), files
 *                show the date (M/D/YY) at 112 px and the size (28.0K, 132K) at 56 px from the
 *                right; the selected row is the highlight colour with white text and its icon
 *                blended 50 % with the highlight (ImageList ILD_BLEND50)
 *   soft keys    Up / Menu. Menu: Go To >, Refresh, Show All Files, Sort By > | Send..., Beam
 *                File..., New Folder, Rename, Delete | Edit > (Undo | Cut, Copy, Paste, Paste
 *                Shortcut | Select All). Submenus open to the left over the menu.
 *   tap          opens (a folder lists, a picture opens in the viewer, other files: WM's "no
 *                application associated" box); tap-and-hold selects and shows the context menu
 *
 * Places: My Device = the VFS root ("/"); My Documents = the active workspace
 * (/Workspaces/<id>); My Pictures = its Pictures folder. Menus are the shell's (wmShell.menu with
 * submenus; the context menu is that popup moved to the tap). Back gesture: the app offers
 * historyDepth() / onBack() so a shell that counts app layers retraces the folders visited here;
 * without that the gesture closes the app like any other.
 *
 * Only on phones: does nothing unless window.uiShell is 'mobile'. Never opens desktop windows.
 * Styles: public/css/wm-file-explorer.css.
 */
(function () {
    'use strict';

    if (window.uiShell !== 'mobile' || !document.documentElement.classList.contains('ui-mobile')) return;

    const APP_ID = 'fileexplorer';
    const PAGE_LIMIT = 300;
    const SORT_KEY = 'wmFeSort';
    const SHOW_ALL_KEY = 'wmFeShowAll';
    const SORTS = [['name', 'Name'], ['date', 'Date'], ['size', 'Size'], ['type', 'Type']];
    const BAD_NAME = /[\\/:*?"<>|]/;
    const ART = '/static_images/wm61/';

    let ws = null; // window.wmShell
    let page = null;
    let trail = []; // [{ path, name }] from My Device down to the folder on screen
    let visits = []; // earlier trails, for the back gesture
    let items = [];
    let hasMore = false;
    let loadingMore = false;
    let listToken = 0;
    let loading = false;
    let listError = '';
    const selected = new Set(); // item ids
    let anchorId = null;
    let clipboard = null; // { op: 'cut' | 'copy', items: [item], sourcePath }
    let renamingId = null;
    let sortField = 'name';
    let showAll = false;
    // Menu > View: List (WM's) or Thumbnails (previews in Pictures & Videos cells), kept per phone
    const VIEW_KEY = 'wmFileExplorerView';
    let viewMode = (() => { try { return localStorage.getItem(VIEW_KEY) === 'thumbs' ? 'thumbs' : 'list'; } catch (_) { return 'list'; } })();
    try {
        const s = localStorage.getItem(SORT_KEY);
        if (SORTS.some(([k]) => k === s)) sortField = s;
        showAll = localStorage.getItem(SHOW_ALL_KEY) === '1';
    } catch (_) { /* storage off */ }

    const esc = (s) => String(s == null ? '' : s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
    const shellEl = () => document.getElementById('wmShell');
    const MAX_VISITS = 20;
    const isCurrent = () => !!(ws && ws.current === APP_ID);
    const pathNow = () => (trail.length ? trail[trail.length - 1].path : '/');

    function activeWs() {
        try {
            // workspaceUtils.js: a top-level let, not on window
            // eslint-disable-next-line no-undef
            if (typeof activeWorkspace !== 'undefined' && activeWorkspace) return activeWorkspace;
        } catch (_) { /* not loaded */ }
        return 'default';
    }

    function myDocumentsPath() { return `/Workspaces/${activeWs()}`; }

    /** The label WM gives a place: the root is My Device, the active workspace My Documents. */
    function placeName(path, fallback) {
        if (path === '/') return 'My Device';
        if (path === myDocumentsPath()) return 'My Documents';
        if (path === `${myDocumentsPath()}/Pictures`) return 'My Pictures';
        return fallback;
    }

    function trailFor(path) {
        const t = [{ path: '/', name: 'My Device' }];
        if (path === '/') return t;
        t.push({ path: '/Workspaces', name: 'Workspaces' });
        if (path === '/Workspaces') return t;
        t.push({ path: myDocumentsPath(), name: 'My Documents' });
        if (path === myDocumentsPath()) return t;
        t.push({ path, name: placeName(path, path.split('/').pop()) });
        return t;
    }

    // ---------------------------------------------------------------- item kinds (explorerApplet.js rules)

    const isStoredShortcut = (i) => !!(i && (i.isVfsShortcutEntry || (i.isShortcut && i.shortcutType && !i.isDesktopShortcut)));
    const isLiveDesktopShortcut = (i) => !!(i && i.isDesktopShortcut);
    const isVfsVirtualEntry = (i) => !!(i && i.isShortcut && !i.isDesktopShortcut && !isStoredShortcut(i));
    const isUserFileLink = (i) => !!(i && (i.isUserFileLink || (i.isShortcut && i.targetKind === 'user-file')));
    const isVirtualSurface = (i) => !!i && ['image', 'scrap', 'reference', 'vibe', 'note'].includes(i.targetKind);
    const isSystemItem = (i) => !!i && (i.targetKind === 'system-folder' || i.targetKind === 'workspace' || !!i.system);
    const isFolderShortcut = (i) => !!i && (i.shortcutType === 'folder' || (i.targetKind === 'vfs-folder' && isLiveDesktopShortcut(i)));
    const isFolder = (i) => !!i && i.kind === 'folder';

    function canCutCopy(i) {
        if (!i || i.protected || isSystemItem(i) || i.isTrashItem) return false;
        if (isLiveDesktopShortcut(i)) return false; // the desktop surface needs Explorer's own delivery
        if (isVirtualSurface(i) && !isVfsVirtualEntry(i)) return false;
        return true;
    }

    function canRename(i) {
        if (!i || i.protected || isSystemItem(i) || i.isTrashItem) return false;
        if (i.targetKind === 'vfs-folder' || i.targetKind === 'user-file') return true;
        if (i.shortcutType || isStoredShortcut(i) || isLiveDesktopShortcut(i)) return true;
        if (isVfsVirtualEntry(i) || isUserFileLink(i)) return true;
        return false;
    }

    function shortcutOnly(i) {
        if (!i || isFolderShortcut(i)) return false;
        return isLiveDesktopShortcut(i) || isStoredShortcut(i) || isVfsVirtualEntry(i) || isUserFileLink(i);
    }

    function canTrash(i) {
        if (!i || i.protected || i.system || i.isTrashItem) return false;
        if (shortcutOnly(i)) return false;
        if (i.targetKind === 'vfs-folder' || i.targetKind === 'user-file') return true;
        return isVirtualSurface(i) && !isVfsVirtualEntry(i);
    }

    function canDelete(i) {
        if (!i || i.protected || i.system) return false;
        return !!i.isTrashItem || canTrash(i) || shortcutOnly(i) || isLiveDesktopShortcut(i);
    }

    /** explorerApplet _isWritableFolderPath, minus the phone and Computer; the desktop surface is left to Explorer. */
    function writable(path) {
        const p = (path || '/').replace(/\/+$/, '') || '/';
        if (/\/Trash(\/|$)/.test(p) || p.includes('/~archive.')) return false;
        if (p === '/') return true;
        const parts = p.split('/').filter(Boolean);
        if (parts[0] === 'System') return false;
        if (parts[0] === 'Workspaces') {
            if (parts.length === 1) return false;
            if (parts.length === 2) return true;
            if (['Desktop', 'Pictures', 'References', 'Notes', 'Scraps', 'Trash'].includes(parts[2])) return false;
            return true;
        }
        return true;
    }

    function refsOf(list) {
        return list.map((i) => ({
            id: i.id,
            name: i.name,
            kind: i.kind,
            targetKind: i.targetKind,
            targetId: i.targetId,
            isShortcut: !!i.isShortcut,
            isUserFileLink: isUserFileLink(i),
            isDesktopShortcut: !!i.isDesktopShortcut,
            isVfsShortcutEntry: isStoredShortcut(i),
            vfsEntryId: isStoredShortcut(i) ? i.id : undefined,
            workspaceId: i.workspaceId,
            shortcutType: i.shortcutType || undefined,
            shortcutData: i.shortcutData || undefined,
            navPath: i.navPath || undefined,
            size: i.size,
            modifiedAt: i.modifiedAt,
            mimeType: i.mimeType || undefined
        }));
    }

    function navPathOf(i) {
        if (!isFolder(i) && !i.navPath) return null;
        if (i.navPath) return i.navPath;
        if (i.targetKind === 'workspace') return `/Workspaces/${i.targetId}`;
        if (i.targetKind === 'system-folder') {
            const tid = i.targetId || i.id;
            if (tid === '@workspaces') return '/Workspaces';
            if (tid === '@system') return '/System';
            if (i.workspaceId && i.name) return `/Workspaces/${i.workspaceId}/${i.name}`;
        }
        if (i.targetKind === 'vfs-folder') {
            const id = i.targetId || i.id;
            if (i.workspaceId) return `/Workspaces/${i.workspaceId}/${id}`;
            return `${pathNow().replace(/\/+$/, '')}/${id}`;
        }
        return null;
    }

    // ---------------------------------------------------------------- formats

    /** WM's list date: M/D/YY. modifiedAt is in seconds (ms tolerated). */
    function fmtDate(t) {
        let n = Number(t);
        if (!n) return '';
        if (n < 1e12) n *= 1000;
        const d = new Date(n);
        return `${d.getMonth() + 1}/${d.getDate()}/${String(d.getFullYear()).slice(-2)}`;
    }

    /** WM's list size: three significant digits, K / M / G (6.00K, 28.0K, 132K). */
    function fmtSize(b) {
        const n = Number(b);
        if (!Number.isFinite(n) || n < 0) return '';
        if (n < 1024) return `${n}B`;
        const units = ['K', 'M', 'G', 'T'];
        let v = n / 1024;
        let u = 0;
        while (v >= 1000 && u < units.length - 1) { v /= 1024; u++; }
        const s = v < 10 ? v.toFixed(2) : v < 100 ? v.toFixed(1) : String(Math.round(v));
        return `${s}${units[u]}`;
    }

    function iconOf(i) {
        if (isFolder(i)) return 'fe-folder';
        if (i.targetKind === 'image' || i.targetKind === 'scrap' || /^image\//.test(i.mimeType || '')) return 'app-pictures';
        if (i.targetKind === 'note') return 'app-notes';
        return 'fe-file';
    }

    // ---------------------------------------------------------------- listing

    function visible(list) {
        if (showAll) return list;
        // Show All Files off hides what WM hides: hidden files (dotfiles) and the system folder at the root
        return list.filter((i) => !String(i.name || '').startsWith('.') && !(pathNow() === '/' && i.targetId === '@system'));
    }

    function sortDirection() { return sortField === 'date' || sortField === 'size' ? 'desc' : 'asc'; }

    async function load(opts = {}) {
        const token = ++listToken;
        const path = pathNow();
        loading = true;
        listError = '';
        if (!opts.keep) { items = []; hasMore = false; render(); }
        try {
            if (typeof vfsClient === 'undefined') throw new Error('The file system is not available.');
            const res = await vfsClient.listDirectory(path, { offset: 0, limit: PAGE_LIMIT, sortField, sortDirection: sortDirection(), search: '' });
            if (token !== listToken) return;
            items = visible((res && res.items) || []);
            hasMore = !!(res && res.hasMore);
            for (const id of [...selected]) if (!items.some((i) => i.id === id)) selected.delete(id);
            if (opts.select) {
                selected.clear();
                const want = items.find((i) => i.id === opts.select || i.navPath === opts.select);
                if (want) { selected.add(want.id); anchorId = want.id; }
            }
            // WM keeps one row selected: the first when nothing else is
            if (!selected.size && items.length) { selected.add(items[0].id); anchorId = items[0].id; }
        } catch (err) {
            if (token !== listToken) return;
            items = [];
            hasMore = false;
            listError = (err && err.message) || 'Cannot open this folder.';
        } finally {
            if (token === listToken) loading = false;
        }
        render();
        if (opts.select || !opts.keep) scrollToSelection();
        if (isCurrent()) ws.refreshSoftKeys();
        fillPage();
    }

    async function loadMore() {
        if (!hasMore || loadingMore || loading) return;
        loadingMore = true;
        const token = listToken;
        try {
            const res = await vfsClient.listDirectory(pathNow(), { offset: items.length, limit: PAGE_LIMIT, sortField, sortDirection: sortDirection(), search: '' });
            if (token !== listToken) return;
            const seen = new Set(items.map((i) => i.id));
            items = items.concat(visible((res && res.items) || []).filter((i) => !seen.has(i.id)));
            hasMore = !!(res && res.hasMore) && !!(res.items && res.items.length);
            render();
        } catch (_) {
            hasMore = false;
        } finally {
            loadingMore = false;
        }
        fillPage();
    }

    /** More pages while the list does not fill the screen. */
    function fillPage() {
        const sc = page && page.querySelector('.fe-scroll');
        if (sc && hasMore && sc.scrollHeight <= sc.clientHeight + 40) loadMore();
    }

    function navigate(path, name, opts = {}) {
        if (opts.record !== false && trail.length) visits.push(trail.slice());
        if (visits.length > MAX_VISITS) visits.shift();
        if (opts.trail) trail = opts.trail;
        else if (opts.child) trail = trail.concat([{ path, name }]);
        else trail = trailFor(path);
        selected.clear();
        anchorId = null;
        renamingId = null;
        const sc = page && page.querySelector('.fe-scroll');
        if (sc) sc.scrollTop = 0;
        renderBar();
        load({ select: opts.select });
        // a shell that counts app layers adds the history entry for this step (after the tap)
        if (opts.record !== false && ws && typeof ws.syncHistory === 'function') ws.syncHistory();
    }

    function up() {
        if (trail.length < 2) return;
        // WM selects the first item of the parent, not the folder you came out of
        navigate(trail[trail.length - 2].path, null, { trail: trail.slice(0, -1) });
    }

    /** Back gesture: the folder seen before this one; false when there is none (the app closes). */
    function goBack() {
        if (!visits.length) return false;
        if (renamingId) cancelRename();
        const prev = visits.pop();
        const from = pathNow();
        navigate(prev[prev.length - 1].path, null, { trail: prev, record: false, select: from });
        return true;
    }

    // ---------------------------------------------------------------- drawing

    function renderBar() {
        if (!page) return;
        const cur = trail[trail.length - 1] || { path: '/', name: 'My Device' };
        page.querySelector('.fe-folder-name').textContent = placeName(cur.path, cur.name);
        const sortBtn = page.querySelector('.wm-pv-sort');
        if (!(sortBtn.getAttribute('aria-expanded') === 'true')) {
            sortBtn.querySelector('span').textContent = (SORTS.find(([k]) => k === sortField) || SORTS[0])[1];
        }
    }

    function rowHtml(i) {
        const icon = iconOf(i);
        const sel = selected.has(i.id);
        const file = !isFolder(i);
        const name = esc(i.name);
        return `<div class="fe-row${sel ? ' is-selected' : ''}${clipboard && clipboard.op === 'cut' && clipboard.ids.has(i.id) ? ' is-cut' : ''}" role="option" aria-selected="${sel}" data-id="${esc(i.id)}">`
            + `<span class="fe-ico" style="--fe-mask:url('${ART}${icon}@2x.png')"><img src="${ART}${icon}.png" srcset="${ws.art && ws.art.srcset ? ws.art.srcset(icon) : `${ART}${icon}.png 1x, ${ART}${icon}@2x.png 2x`}" alt="" draggable="false"></span>`
            + `<span class="fe-name">${name}</span>`
            + `<span class="fe-date">${file ? esc(fmtDate(i.modifiedAt)) : ''}</span>`
            + `<span class="fe-size">${file ? esc(fmtSize(i.sizeBytes != null ? i.sizeBytes : i.size)) : ''}</span>`
            + '</div>';
    }

    /** A preview for pictures (same-site path only), else the item's icon. */
    function previewOf(i) {
        if (isFolder(i)) return null;
        const url = typeof i.previewUrl === 'string' && /^\/[^/\\]/.test(i.previewUrl) ? i.previewUrl : null;
        const picture = i.targetKind === 'image' || i.targetKind === 'scrap' || /^image\//.test(i.mimeType || '');
        return picture ? url : null;
    }

    /** Thumbnails: a Pictures & Videos cell with the picture fitted, or the icon, and the name. */
    function tileHtml(i) {
        const icon = iconOf(i);
        const sel = selected.has(i.id);
        const pic = previewOf(i);
        const thumb = pic
            ? `<img class="fe-thumb" src="${esc(pic)}" alt="" loading="lazy" decoding="async" draggable="false">`
            : `<img class="fe-thumb-icon" src="${ART}${icon}@2x.png" srcset="${ART}${icon}@2x.png 1x${ws.art && ws.art.srcset && /@4x/.test(ws.art.srcset(icon)) ? `, ${ART}${icon}@4x.png 2x` : ''}" alt="" draggable="false">`;
        return `<div class="fe-row fe-tile${sel ? ' is-selected' : ''}${clipboard && clipboard.op === 'cut' && clipboard.ids.has(i.id) ? ' is-cut' : ''}" role="option" aria-selected="${sel}" data-id="${esc(i.id)}">`
            + `<span class="fe-tile-thumb">${thumb}</span>`
            + `<span class="fe-name">${esc(i.name)}</span>`
            + '</div>';
    }

    function setView(mode) {
        viewMode = mode === 'thumbs' ? 'thumbs' : 'list';
        try { localStorage.setItem(VIEW_KEY, viewMode); } catch (_) { /* storage off */ }
        render();
        scrollToSelection();
    }

    function viewItems() {
        return [
            { label: 'List', radio: viewMode === 'list', action: () => setView('list') },
            { label: 'Thumbnails', radio: viewMode === 'thumbs', action: () => setView('thumbs') }
        ];
    }

    function render() {
        if (!page) return;
        renderBar();
        const list = page.querySelector('.fe-list');
        list.classList.toggle('fe-grid', viewMode === 'thumbs');
        list.innerHTML = items.map(viewMode === 'thumbs' ? tileHtml : rowHtml).join('');
        const empty = page.querySelector('.fe-empty');
        empty.textContent = listError;
        empty.hidden = !listError;
        if (renamingId) beginRenameUi(renamingId);
    }

    function syncSelection() {
        if (!page) return;
        page.querySelectorAll('.fe-row').forEach((r) => {
            const on = selected.has(r.dataset.id);
            r.classList.toggle('is-selected', on);
            r.setAttribute('aria-selected', String(on));
        });
        if (isCurrent()) ws.refreshSoftKeys();
    }

    function selectOnly(id) {
        selected.clear();
        if (id != null) selected.add(id);
        anchorId = id;
        syncSelection();
    }

    function scrollToSelection() {
        if (!page || !anchorId) return;
        const row = page.querySelector(`.fe-row[data-id="${CSS.escape(anchorId)}"]`);
        if (row) row.scrollIntoView({ block: 'nearest' });
    }

    const itemById = (id) => items.find((i) => i.id === id) || null;
    const selectedItems = () => items.filter((i) => selected.has(i.id));

    // ---------------------------------------------------------------- opening

    function noApp(i) {
        return ws.messageBox({
            title: 'File Explorer',
            icon: 'warning',
            text: `There is no application associated with "${i.name}". Run the application first, then open the file from within the application.`
        });
    }

    function galleryHas(filename) {
        try {
            // eslint-disable-next-line no-undef
            if (typeof allImages !== 'undefined' && Array.isArray(allImages)) {
                // eslint-disable-next-line no-undef
                return allImages.some((img) => img && (img.filename === filename || img.original === filename || img.upscaled === filename));
            }
        } catch (_) { /* gallery not loaded */ }
        return false;
    }

    async function openItem(i) {
        if (!i) return;
        const nav = navPathOf(i);
        if (nav) {
            navigate(nav, i.name, { child: true });
            return;
        }
        // notes open in Notes, contact cards in Contacts (wmNotes.js)
        if (i.targetKind === 'note' && i.targetId && window.wmNotesApp) {
            window.wmNotesApp.openNote(i.targetId, i.workspaceId, i.name);
            return;
        }
        if (/\.vcf$/i.test(i.name || '') && i.targetKind === 'user-file' && !i.isShortcut && window.wmContactsApp) {
            window.wmContactsApp.openFile(i, pathNow());
            return;
        }
        if (typeof showLightbox !== 'function') { await noApp(i); return; }
        // only a same-site path goes to the viewer
        const url = typeof i.previewUrl === 'string' && /^\/[^/\\]/.test(i.previewUrl) ? i.previewUrl : null;
        try {
            if (i.targetKind === 'image' || i.targetKind === 'scrap') {
                const fn = i.previewImageFilename || i.targetId;
                if (fn && galleryHas(fn)) await showLightbox({ filename: fn });
                else if (url) await showLightbox({ url, title: i.name });
                else await noApp(i);
                return;
            }
            if (/^image\//.test(i.mimeType || '') && url) {
                await showLightbox({ url, title: i.name });
                return;
            }
        } catch (_) { /* the viewer could not open it */ }
        await noApp(i);
    }

    // ---------------------------------------------------------------- operations

    function errorBox(title, verb, i, err) {
        return ws.messageBox({ title, icon: 'error', text: `Cannot ${verb} '${i ? i.name : ''}': ${(err && err.message) || 'The operation failed.'}` });
    }

    function readOnly() {
        try { return localStorage.getItem('userType') === 'readonly'; } catch (_) { return false; }
    }

    function touchGallery(list) {
        if (list.some((i) => (i.targetKind === 'image' || i.targetKind === 'scrap') && !i.isShortcut) && typeof loadGallery === 'function') {
            try { loadGallery(true); } catch (_) { /* gallery reloads on its own later */ }
        }
    }

    async function newFolder() {
        if (!writable(pathNow()) || readOnly()) {
            await ws.messageBox({ title: 'File Explorer', icon: 'error', text: 'Cannot create a folder here.' });
            return;
        }
        const before = new Set(items.map((i) => i.id));
        try {
            await vfsClient.createFolder(pathNow(), 'New Folder');
        } catch (err) {
            await errorBox('Error Creating Folder', 'create', { name: 'New Folder' }, err);
            return;
        }
        await load({ keep: true });
        // WM puts the new folder straight into rename
        const made = items.find((i) => !before.has(i.id) && isFolder(i));
        if (made) {
            selectOnly(made.id);
            startRename(made.id);
        }
    }

    function startRename(id) {
        const i = itemById(id);
        if (!i || !canRename(i) || readOnly()) return;
        renamingId = id;
        selectOnly(id);
        beginRenameUi(id);
    }

    function beginRenameUi(id) {
        const row = page.querySelector(`.fe-row[data-id="${CSS.escape(id)}"]`);
        const i = itemById(id);
        if (!row || !i) { renamingId = null; return; }
        if (row.querySelector('.fe-rename')) return;
        const cell = row.querySelector('.fe-name');
        const input = document.createElement('input');
        input.type = 'text';
        input.className = 'fe-rename';
        input.value = i.name;
        input.autocomplete = 'off';
        input.spellcheck = false;
        input.setAttribute('aria-label', 'Name');
        cell.textContent = '';
        cell.appendChild(input);
        row.classList.add('is-renaming');
        input.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') { e.preventDefault(); commitRename(); } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); cancelRename(); }
        });
        // leaving the box keeps the name, unless the tap was Cancel (soft key): it ends the edit first
        input.addEventListener('blur', () => { setTimeout(() => { if (renamingId === id && !committing) commitRename(); }, 200); });
        ['pointerdown', 'click', 'contextmenu'].forEach((t) => input.addEventListener(t, (e) => e.stopPropagation()));
        input.focus();
        // the name without its extension is selected, as WM's in-place edit does for files
        const dot = isFolder(i) ? -1 : i.name.lastIndexOf('.');
        input.setSelectionRange(0, dot > 0 ? dot : i.name.length);
    }

    function cancelRename() {
        renamingId = null;
        render();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    let committing = false;
    /** Rename one listed item through the call its kind needs. */
    async function renameTo(i, name) {
        if (i.targetKind === 'vfs-folder' && !isLiveDesktopShortcut(i)) await vfsClient.renameFolder(i.targetId, name);
        else if (i.targetKind === 'user-file' && !isUserFileLink(i)) await vfsClient.renameFile(i.targetId, name);
        else if (isUserFileLink(i) || isVfsVirtualEntry(i)) await vfsClient.renameEntry(i.id, name);
        else if (isStoredShortcut(i)) await vfsClient.renameShortcutEntry(i.id, name);
        else if (isLiveDesktopShortcut(i) && typeof desktopShortcuts !== 'undefined') await desktopShortcuts.renameShortcut(i.id, name);
        else throw new Error('This item cannot be renamed.');
    }

    /** Items of a folder whose names contain `name` (the listing's own search). */
    async function namesakes(path, name) {
        try {
            const res = await vfsClient.listDirectory(path, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc', search: name });
            return (res && res.items) || [];
        } catch (_) { return []; }
    }

    /** WM's name for a copy pasted where its name is taken: "Copy of x", "Copy (2) of x", ... */
    function copyName(name, taken) {
        let n = 1;
        for (;;) {
            const candidate = n === 1 ? `Copy of ${name}` : `Copy (${n}) of ${name}`;
            if (!taken.has(candidate.toLowerCase())) return candidate;
            n++;
        }
    }

    async function commitRename() {
        if (committing) return;
        const id = renamingId;
        const i = itemById(id);
        const input = page.querySelector('.fe-rename');
        if (!i || !input) { cancelRename(); return; }
        const name = input.value.trim();
        if (!name || name === i.name) { cancelRename(); return; }
        if (BAD_NAME.test(name)) {
            committing = true;
            await ws.messageBox({ title: 'File Explorer', icon: 'error', text: 'A file name cannot contain any of the following characters: \\ / : * ? " < > |' });
            committing = false;
            const again = page.querySelector('.fe-rename');
            if (again) again.focus();
            return;
        }
        committing = true;
        renamingId = null;
        try {
            await renameTo(i, name);
        } catch (err) {
            committing = false;
            render();
            // the device answers a taken name (and any refusal) with this box
            await ws.messageBox({ title: 'Error Renaming File', icon: 'error', text: `Cannot rename '${i.name}': Access is denied.\n\nBe certain that the file is not write-protected and is not currently in use.` });
            return;
        }
        committing = false;
        await load({ keep: true, select: i.id });
    }

    async function deleteSelection() {
        const sel = selectedItems();
        if (!sel.length || readOnly()) return;
        const ok = sel.filter(canDelete);
        if (!ok.length) {
            await ws.messageBox({ title: 'File Explorer', icon: 'error', text: sel.length === 1 ? `Cannot delete '${sel[0].name}': it is a system item.` : 'The selected items cannot be deleted.' });
            return;
        }
        // the device's own questions (Confirm File / Folder / Multiple File Delete), No the default
        const one = ok.length === 1 ? ok[0] : null;
        const folder = one && isFolder(one);
        const yes = await ws.messageBox({
            title: !one ? 'Confirm Multiple File Delete' : (folder ? 'Confirm Folder Delete' : 'Confirm File Delete'),
            icon: 'warning',
            text: !one ? `Are you sure you want to delete these ${ok.length} items?`
                : (folder ? `Are you sure you want to remove the folder '${one.name}' and all its contents?` : `Are you sure you want to delete '${one.name}'?`),
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false
        });
        if (!yes) return;
        const path = pathNow();
        for (const i of ok) {
            try {
                if (i.isTrashItem) {
                    await vfsClient.permanentlyDelete([{ id: i.id, trashItemId: i.trashItemId || i.id, isTrashItem: true, targetKind: i.targetKind, targetId: i.targetId, name: i.name, workspaceId: i.workspaceId }], path);
                } else if (canTrash(i)) {
                    await vfsClient.moveToTrash(refsOf([i]), path);
                } else if (isLiveDesktopShortcut(i)) {
                    if (typeof desktopShortcuts === 'undefined') throw new Error('The desktop is not loaded.');
                    await desktopShortcuts.removeShortcut(i.id);
                } else {
                    await vfsClient.deleteEntry(i.id);
                }
            } catch (err) {
                await errorBox('Error Deleting File', 'delete', i, err);
                break;
            }
        }
        touchGallery(ok);
        selected.clear();
        await load({ keep: true });
    }

    function copySel(op) {
        const sel = selectedItems().filter(canCutCopy);
        if (!sel.length) return;
        clipboard = { op, items: sel, ids: new Set(sel.map((i) => i.id)), sourcePath: pathNow() };
        render();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    const canPaste = () => !!clipboard && writable(pathNow()) && !readOnly();
    const canPasteShortcut = () => canPaste() && clipboard.op === 'copy' && clipboard.items.some((i) => (i.targetKind === 'user-file' && !isUserFileLink(i)) || i.targetKind === 'vfs-folder');

    async function paste(asShortcut) {
        if (!canPaste()) return;
        const { op, items: list, sourcePath } = clipboard;
        const path = pathNow();
        if (op === 'cut' && sourcePath === path) return; // already here
        for (const i of list) {
            if (op === 'cut' && i.targetKind === 'vfs-folder' && (path === i.navPath || path.startsWith(`${i.navPath}/`))) {
                await ws.messageBox({ title: 'Error Moving File', icon: 'error', text: `Cannot move '${i.name}': The destination folder is a subfolder of the source folder.` });
                return;
            }
        }
        for (const i of list) {
            try {
                if (op === 'cut') {
                    await vfsClient.moveItems(refsOf([i]), path);
                } else {
                    // a copy into a folder that already has this name gets WM's "Copy of ..." (the
                    // server keeps the name; the new item is renamed right after it is made)
                    const before = asShortcut ? [] : await namesakes(path, i.name);
                    const clash = before.some((b) => String(b.name).toLowerCase() === String(i.name).toLowerCase());
                    await vfsClient.copyItems(refsOf([i]), path, { userFileCopyMode: asShortcut ? 'shortcut' : 'duplicate' });
                    if (clash) {
                        const known = new Set(before.map((b) => b.id));
                        const after = await namesakes(path, i.name);
                        const fresh = after.find((a) => !known.has(a.id) && String(a.name).toLowerCase() === String(i.name).toLowerCase());
                        if (fresh) await renameTo(fresh, copyName(i.name, new Set(after.map((a) => String(a.name).toLowerCase()))));
                    }
                }
            } catch (err) {
                await errorBox(op === 'cut' ? 'Error Moving File' : 'Error Copying File', op === 'cut' ? 'move' : 'copy', i, err);
                break;
            }
        }
        if (op === 'cut') { touchGallery(list); clipboard = null; }
        await load({ keep: true });
    }

    function selectAll() {
        selected.clear();
        items.forEach((i) => selected.add(i.id));
        syncSelection();
    }

    function setSort(k) {
        sortField = k;
        try { localStorage.setItem(SORT_KEY, k); } catch (_) { /* storage off */ }
        renderBar();
        load({ keep: true });
    }

    function toggleShowAll() {
        showAll = !showAll;
        try { localStorage.setItem(SHOW_ALL_KEY, showAll ? '1' : '0'); } catch (_) { /* storage off */ }
        load({ keep: true });
    }

    // ---------------------------------------------------------------- menus

    function goToItems() {
        const cur = pathNow();
        return [
            { label: 'My Device', radio: cur === '/', action: () => navigate('/', 'My Device') },
            { label: 'My Documents', radio: cur === myDocumentsPath(), action: () => navigate(myDocumentsPath(), 'My Documents') },
            { label: 'My Pictures', radio: cur === `${myDocumentsPath()}/Pictures`, action: () => navigate(`${myDocumentsPath()}/Pictures`, 'My Pictures') },
            { label: 'Workspaces', radio: cur === '/Workspaces', action: () => navigate('/Workspaces', 'Workspaces') }
        ];
    }

    function sortItems() {
        return SORTS.map(([k, label]) => ({ label, radio: sortField === k, action: () => setSort(k) }));
    }

    function editItems() {
        const sel = selectedItems();
        const cutCopy = sel.length > 0 && sel.every(canCutCopy);
        return [
            { label: 'Undo', disabled: true },
            '-',
            { label: 'Cut', disabled: !cutCopy, action: () => copySel('cut') },
            { label: 'Copy', disabled: !cutCopy, action: () => copySel('copy') },
            { label: 'Paste', disabled: !canPaste(), action: () => paste(false) },
            { label: 'Paste Shortcut', disabled: !canPasteShortcut(), action: () => paste(true) },
            '-',
            { label: 'Select All', disabled: !items.length, action: selectAll }
        ];
    }

    function mainMenu() {
        const sel = selectedItems();
        return [
            { label: 'Go To', submenu: goToItems },
            { label: 'Refresh', action: () => load({ keep: true }) },
            { label: 'Show All Files', checked: showAll, action: toggleShowAll },
            { label: 'Sort By', submenu: sortItems },
            { label: 'View', submenu: viewItems },
            '-',
            { label: 'Send...', disabled: true },
            { label: 'Beam File...', disabled: true },
            { label: 'New Folder', disabled: !writable(pathNow()) || readOnly(), action: newFolder },
            { label: 'Rename', disabled: sel.length !== 1 || !canRename(sel[0]) || readOnly(), action: () => startRename(sel[0].id) },
            { label: 'Delete', disabled: !sel.length || !sel.some(canDelete) || readOnly(), action: deleteSelection },
            '-',
            { label: 'Edit', submenu: editItems }
        ];
    }

    function contextMenu(onItem) {
        if (!onItem) {
            // device (hold on empty space): Refresh, Show All Files | Paste, Paste Shortcut, New Folder
            return [
                { label: 'Refresh', action: () => load({ keep: true }) },
                { label: 'Show All Files', checked: showAll, action: toggleShowAll },
                '-',
                { label: 'Paste', disabled: !canPaste(), action: () => paste(false) },
                { label: 'Paste Shortcut', disabled: !canPasteShortcut(), action: () => paste(true) },
                { label: 'New Folder', disabled: !writable(pathNow()) || readOnly(), action: newFolder }
            ];
        }
        const sel = selectedItems();
        const cutCopy = sel.length > 0 && sel.every(canCutCopy);
        return [
            // device (hold on a file or folder): Cut, Copy | Rename, Delete | Send..., Beam File...
            { label: 'Cut', disabled: !cutCopy, action: () => copySel('cut') },
            { label: 'Copy', disabled: !cutCopy, action: () => copySel('copy') },
            '-',
            { label: 'Rename', disabled: sel.length !== 1 || !canRename(sel[0]) || readOnly(), action: () => startRename(sel[0].id) },
            { label: 'Delete', disabled: !sel.length || !sel.some(canDelete) || readOnly(), action: deleteSelection },
            '-',
            { label: 'Send...', disabled: true },
            { label: 'Beam File...', disabled: true }
        ];
    }

    function px() { return parseFloat(getComputedStyle(document.documentElement).getPropertyValue('--wm-px')) || 1; }

    /** Tap-and-hold: the shell's popup menu, moved to the tap point and kept on screen. */
    function openContext(list, x, y) {
        if (typeof ws.menuAt === 'function') { ws.menuAt(x, y, list); return; }
        ws.menu('context', list, null);
        const shell = shellEl();
        const pop = shell && shell.querySelector(':scope > .wm-popup:not([hidden])');
        if (!pop) return;
        const sr = shell.getBoundingClientRect();
        const w = pop.offsetWidth;
        const h = pop.offsetHeight;
        const top = Math.max(sr.top, Math.min(y, sr.bottom - h - 26 * px()));
        const left = Math.max(sr.left, Math.min(x, sr.right - w));
        Object.assign(pop.style, { top: `${top - sr.top}px`, left: `${left - sr.left}px`, bottom: 'auto', right: 'auto' });
    }

    // ---------------------------------------------------------------- page

    // the click that ends a tap-and-hold must not reach the shell (its outside-click handler would
    // close the context menu just opened) nor the row (it would open the item)
    let suppressClick = false;
    window.addEventListener('click', (e) => {
        if (!suppressClick) return;
        suppressClick = false;
        if (!(e.target && e.target.closest && e.target.closest('.wm-fe .fe-scroll'))) return;
        e.stopPropagation();
        e.preventDefault();
    }, true);

    function onListPointer(list) {
        let holdTimer = null;
        let start = null;
        let held = false;
        const HOLD_MS = 550;
        const clear = () => { clearTimeout(holdTimer); holdTimer = null; };
        const hold = (x, y, row) => {
            held = true;
            suppressClick = true;
            clear();
            if (renamingId) commitRename();
            const id = row ? row.dataset.id : null;
            if (id && !selected.has(id)) selectOnly(id);
            openContext(contextMenu(!!id), x, y);
        };
        list.addEventListener('pointerdown', (e) => {
            if (e.button !== 0 && e.pointerType === 'mouse') return;
            held = false;
            suppressClick = false;
            start = { x: e.clientX, y: e.clientY };
            const row = e.target.closest('.fe-row');
            clear();
            holdTimer = setTimeout(() => hold(start.x, start.y, row), HOLD_MS);
        });
        list.addEventListener('pointermove', (e) => {
            if (start && Math.hypot(e.clientX - start.x, e.clientY - start.y) > 8 * px()) clear();
        });
        ['pointerup', 'pointercancel', 'pointerleave'].forEach((t) => list.addEventListener(t, clear));
        // Android's long press (and a mouse's right button) arrive as contextmenu
        list.addEventListener('contextmenu', (e) => {
            e.preventDefault();
            if (held) return;
            hold(e.clientX, e.clientY, e.target.closest('.fe-row'));
        });
        list.addEventListener('click', (e) => {
            if (held) { held = false; return; }
            const row = e.target.closest('.fe-row');
            if (!row) return;
            if (renamingId && renamingId !== row.dataset.id) { commitRename(); return; }
            if (renamingId) return;
            selectOnly(row.dataset.id);
            openItem(itemById(row.dataset.id));
        });
    }

    function mount(p) {
        page = p;
        p.classList.add('wm-fe');
        p.innerHTML = `
            <div class="wm-pv-bar fe-bar">
                <button type="button" class="wm-pv-folder fe-folder" aria-haspopup="menu" aria-expanded="false"><img src="${ART}fe-device.png" srcset="${ws.art.srcset('fe-device')}" alt="" draggable="false"><span class="fe-folder-name">My Device</span><i class="wm-pv-arrow"></i></button>
                <button type="button" class="wm-pv-sort" aria-haspopup="menu" aria-expanded="false"><span>Name</span><i class="wm-pv-arrow"></i></button>
            </div>
            <div class="fe-scroll"><div class="fe-list" role="listbox" aria-label="Files"></div><p class="fe-empty" hidden></p></div>`;
        const scroll = p.querySelector('.fe-scroll');
        onListPointer(scroll);
        scroll.addEventListener('scroll', () => {
            if (scroll.scrollTop + scroll.clientHeight > scroll.scrollHeight - 200) loadMore();
        }, { passive: true });

        const folderBtn = p.querySelector('.fe-folder');
        folderBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // the path from My Device down to this folder, each level indented, then the places
            const cur = pathNow();
            // the device indents each level 12 px; the bar reads "Show" while the list is open
            folderBtn.querySelector('.fe-folder-name').textContent = 'Show';
            const levels = trail.map((t, n) => ({ label: placeName(t.path, t.name), indent: n, radio: n === trail.length - 1, action: () => { if (t.path !== cur) navigate(t.path, null, { trail: trail.slice(0, n + 1), select: trail[n + 1] && trail[n + 1].path }); } }));
            const places = goToItems().filter((g) => !trail.some((t) => placeName(t.path, t.name) === g.label));
            folderBtn.setAttribute('aria-expanded', 'true');
            ws.dropdown(folderBtn, places.length ? levels.concat(['-'], places.map((g) => Object.assign(g, { radio: null }))) : levels, 'left', () => { folderBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
        });
        const sortBtn = p.querySelector('.wm-pv-sort');
        sortBtn.addEventListener('click', (e) => {
            e.stopPropagation();
            // the control reads "Sort By" while its drop-down is open, as on the device
            sortBtn.setAttribute('aria-expanded', 'true');
            sortBtn.querySelector('span').textContent = 'Sort By';
            ws.dropdown(sortBtn, sortItems(), 'right', () => { sortBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
        });

        document.addEventListener('keydown', onKey);

        trail = trailFor(myDocumentsPath());
        renderBar();
    }

    function onKey(e) {
        if (!isCurrent() || renamingId) return;
        if (e.target && /^(INPUT|TEXTAREA|SELECT)$/.test(e.target.tagName)) return;
        const layer = document.querySelector('#wmShell .wm-msgbox-layer');
        if (layer && !layer.hidden) return;
        if (document.querySelector('#wmShell > .wm-popup:not([hidden]), #wmShell > .wm-startmenu:not([hidden])')) return;
        const at = items.findIndex((i) => i.id === anchorId);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
            e.preventDefault();
            const n = Math.max(0, Math.min(items.length - 1, at + (e.key === 'ArrowDown' ? 1 : -1)));
            if (items[n]) { selectOnly(items[n].id); scrollToSelection(); }
        } else if (e.key === 'Enter' && at >= 0) {
            e.preventDefault();
            openItem(items[at]);
        } else if (e.key === 'Backspace') {
            e.preventDefault();
            up();
        } else if (e.key === 'Delete' && selected.size) {
            e.preventDefault();
            deleteSelection();
        } else if (e.key === 'F2' && selected.size === 1) {
            e.preventDefault();
            startRename([...selected][0]);
        }
    }

    // ---------------------------------------------------------------- registration

    function register() {
        ws = window.wmShell;
        if (!ws || typeof ws.registerApp !== 'function') return;
        ws.registerApp({
            id: APP_ID,
            title: 'File Explorer',
            icon: 'app-file-explorer',
            inStart: 'top',
            mount,
            show() {
                renderBar();
                load({ keep: items.length > 0 });
            },
            hide() {
                if (renamingId) cancelRename();
            },
            /**
             * For a shell that keeps one history entry per layer: the folders visited here are
             * layers of this app (each a back step), and onBack() takes one (true = used).
             */
            historyDepth: () => visits.length,
            onBack: () => goBack(),
            softKeys() {
                if (renamingId) {
                    return { left: { label: 'Cancel', action: cancelRename }, right: { label: 'Done', action: commitRename } };
                }
                return {
                    left: { label: 'Up', disabled: trail.length < 2, action: up },
                    right: { label: 'Menu', menu: mainMenu }
                };
            }
        });
    }

    if (window.wmShell) register();
    else document.addEventListener('wmShellReady', register, { once: true });
})();
