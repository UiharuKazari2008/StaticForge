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
 *                Shortcut | Select All). Submenus open to the left over the menu. Ours adds
 *                Receive > (File, Pictures) under Send...: files from the device into the folder.
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

    // A file going into References or Notes asks what it becomes (vfsImportRouter.js) over a desktop
    // window the phone never shows: ask in a WM message box instead (Cancel / Back skips the file).
    if (typeof vfsImportRouter !== 'undefined' && !vfsImportRouter._wmChoice) {
        vfsImportRouter._wmChoice = true;
        vfsImportRouter._showImportChoice = (title, options) => {
            const shell = window.wmShell;
            if (!shell || typeof shell.messageBox !== 'function') return Promise.resolve(options[0] && options[0].id);
            // WM message box buttons are one short word wide: the full choices go in the text
            const names = options.map((o) => o.label);
            const list = names.length > 1 ? `${names.slice(0, -1).join(', ')} or ${names[names.length - 1]}` : names[0];
            return shell.messageBox({
                title,
                icon: 'question',
                text: `Import this file as ${list}?`,
                buttons: options.map((o, n) => ({ text: o.label.split(' ')[0], value: o.id, default: n === 0 })).concat({ text: 'Cancel', value: null }),
                cancelValue: null
            });
        };
    }
    // WM's wait cursor (wmShell.busy) over work the user waits for: a file opening, a folder made, renamed or deleted
    const busyOf = (fn) => (ws && typeof ws.busy === 'function' ? ws.busy(fn) : fn());
    let page = null;
    let trail = []; // [{ path, name }] from My Device down to the folder on screen
    let visits = []; // earlier trails, for the back gesture
    const volumeTrails = new Map(); // volume key ('device' or a phone root id) -> the last trail seen in it
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

    // ---------------------------------------------------------------- the phone's storage (Android app only)
    //
    // WM lists a storage card inside My Device as its own folder ("Storage Card", shellres icon
    // 8214: a folder with a black SD card); in it the folder bar shows the card (image list 19712
    // cell 1), the drop-down lists it as a level under My Device and the other volumes under the
    // rule. Here each root the Android bridge reports (phoneStorageBridge.js: internal storage,
    // SD cards, USB drives) is such a volume, browsed through explorerPhoneDrive.js
    // (phone://<root>/<path>). No bridge (a browser): nothing loads and nothing shows.

    const PHONE_LOAD_MS = 1500;
    let phonePromise = null;
    const PD = () => (window.explorerPhoneDrive && window.explorerPhoneDrive.available() ? window.explorerPhoneDrive : null);
    const PS = () => window.phoneStorage || null;

    /** Load the bridge client and the phone drive (explorer feature scripts) once; true when usable. */
    function ensurePhone() {
        if (!window.AndroidPhoneStorage) return Promise.resolve(false);
        if (!phonePromise) {
            phonePromise = (async () => {
                if (!window.explorerPhoneDrive) {
                    const fl = window.featureLoader;
                    // _loadScript skips a script already on the page (the explorer feature loads the same two)
                    if (!fl || typeof fl._loadScript !== 'function') return false;
                    // the transfers' progress notification (fileOperationProgress.begin({ phone: true }))
                    await fl._loadScript('scripts/comp/fileOperationProgress.js').catch(() => {});
                    await fl._loadScript('scripts/comp/phoneStorageBridge.js');
                    await fl._loadScript('scripts/comp/explorerPhoneDrive.js');
                }
                if (!PD()) return false;
                PS().on('config', onPhoneConfig);
                return true;
            })().catch(() => { phonePromise = null; return false; });
        }
        return phonePromise;
    }

    /** The bridge state, asked once (cached by phoneStorage); a late answer redraws My Device. */
    async function phoneState() {
        if (!(await ensurePhone())) return null;
        const ps = PS();
        if (ps.state()) return ps.state();
        let late = false;
        const asked = ps.hello().then((st) => {
            if (late && isCurrent() && pathNow() === '/') load({ keep: true });
            return st;
        }, () => null);
        const st = await Promise.race([asked, new Promise((r) => setTimeout(() => r(undefined), PHONE_LOAD_MS))]);
        if (st === undefined) { late = true; return null; }
        return st;
    }

    function phoneRoots() {
        const st = PD() && PS().state();
        return st && Array.isArray(st.roots) ? st.roots : [];
    }

    const isRemovable = (r) => !!r && (r.removable === true || /^(removable|sd|sdcard|usb)$/i.test(String(r.kind || '')));

    /**
     * The volume's name: Android's own (its "Internal storage", the card's label). A removable
     * root the bridge gives no name gets WM's "Storage Card" (Storage Card2 for a second, as WM
     * numbers them); anything else nameless keeps its id.
     */
    function rootLabel(r) {
        const name = String((r && r.name) || '').trim();
        if (name) return name;
        if (isRemovable(r)) {
            const nth = phoneRoots().filter((x) => isRemovable(x) && !String(x.name || '').trim()).indexOf(r);
            return nth > 0 ? `Storage Card${nth + 1}` : 'Storage Card';
        }
        return String((r && r.id) || 'Storage Card');
    }

    const phoneRootById = (id) => phoneRoots().find((r) => r.id === id) || null;
    const isPhonePath = (p) => !!PD() && PD().isPath(p) && p !== PD().TRASH;
    const isPhoneItem = (i) => !!i && !!i.phone && i.targetKind === 'phone-entry';
    const isPhoneRoot = (i) => !!i && i.targetKind === 'phone-drive' && !!i.phone && !!i.phone.root;
    const inPhone = () => isPhonePath(pathNow());

    /** Why the phone cannot be browsed now (sharing off, no access, app locked), or null. */
    function phoneBlock() {
        const st = PD() && PS().state();
        if (!st) return null;
        if (!st.enabled) return 'disabled';
        if (!st.access) return 'no_access';
        if (st.locked) return 'locked';
        return null;
    }

    /** The bridge's op list, when it sends one (features.ops); without it every op is assumed. */
    function phoneCan(op) {
        const st = PD() && PS().state();
        const ops = st && st.features && Array.isArray(st.features.ops) ? st.features.ops : null;
        return !!st && (!ops || ops.includes(op));
    }

    /** My Device's items for the roots: folders with the storage-card icon. */
    function rootItems() {
        if (!PD()) return [];
        return phoneRoots().map((r) => ({
            id: `phone-drive:${r.id}`,
            name: rootLabel(r),
            kind: 'folder',
            targetKind: 'phone-drive',
            navPath: PD().pathFor(r.id, '/'),
            phone: { root: r.id, path: '/', dir: true, drive: r, writable: r.writable !== false }
        }));
    }

    function phoneTrail(rootId, inner) {
        const r = phoneRootById(rootId);
        const t = [{ path: '/', name: 'My Device' }, { path: PD().pathFor(rootId, '/'), name: r ? rootLabel(r) : rootId }];
        const parts = String(inner || '/').split('/').filter(Boolean);
        parts.forEach((part, n) => t.push({ path: PD().pathFor(rootId, '/' + parts.slice(0, n + 1).join('/')), name: part }));
        return t;
    }

    /** The phone folder on screen can take new items (its volume is not read-only; the bridge refuses the rest). */
    function phoneFolderWritable() {
        if (!inPhone() || phoneBlock()) return false;
        const p = PD().parse(pathNow());
        const r = phoneRootById(p.root);
        return !!r && r.writable !== false;
    }

    /** Opening a root the phone will not show: WM's message, and the fix the bridge offers. */
    async function blockedRoot(name) {
        const block = phoneBlock();
        if (block === 'no_access') {
            const yes = await ws.messageBox({
                title: 'File Explorer',
                icon: 'warning',
                text: `Cannot open '${name}': Access is denied.\n\nAllow Dreamscape to access the phone's storage?`,
                buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }],
                cancelValue: false
            });
            if (yes && phoneCan('requestAccess')) { try { await PS().call('requestAccess'); } catch (_) { /* refused */ } }
        } else if (block === 'disabled') {
            const yes = await ws.messageBox({
                title: 'File Explorer',
                icon: 'warning',
                text: `Cannot open '${name}': Phone storage is turned off in the app's settings.\n\nOpen the settings now?`,
                buttons: [{ text: 'Yes', value: true, default: true }, { text: 'No', value: false }],
                cancelValue: false
            });
            if (yes && phoneCan('openSettings')) { try { await PS().call('openSettings'); } catch (_) { /* no settings screen */ } }
        } else {
            await ws.messageBox({ title: 'File Explorer', icon: 'warning', text: `Cannot open '${name}': Unlock the app first, then try again.` });
        }
    }

    /** The volume a path is in: 'device' (the VFS) or the phone root's id. */
    function volumeOf(path) {
        return isPhonePath(path) ? `phone:${PD().parse(path).root}` : 'device';
    }

    /** A trail still leads somewhere: not into a phone root that is gone or blocked. */
    function trailUsable(t) {
        const last = t[t.length - 1];
        if (!last || !String(last.path).startsWith('phone://')) return true;
        return !!PD() && !phoneBlock() && !!phoneRootById(PD().parse(last.path).root);
    }

    function onPhoneConfig() {
        if (!page) return;
        const before = visits.length;
        const here = pathNow();
        if (isPhonePath(here) && (!phoneRootById(PD().parse(here).root) || phoneBlock())) {
            // the root went away (card out, sharing off): back to My Device, as WM does when a card is pulled
            navigate('/', 'My Device', { record: false });
        } else if (isPhonePath(here) || here === '/') {
            load({ keep: true });
        }
        // the history and the drop-down's remembered folders forget volumes that went away (and
        // the steps that now lead to the folder already on screen)
        visits = visits.filter(trailUsable);
        while (visits.length && visits[visits.length - 1][visits[visits.length - 1].length - 1].path === pathNow()) visits.pop();
        for (const [k, t] of [...volumeTrails]) if (!trailUsable(t)) volumeTrails.delete(k);
        if (visits.length !== before && ws && typeof ws.syncHistory === 'function') ws.syncHistory({ noPush: true });
    }

    /** What explorerPhoneDrive.js needs of an Explorer (its desktop applet's members). */
    const phoneApp = {
        get currentPath() { return pathNow(); },
        get sortField() { return sortField; },
        get sortDirection() { return sortDirection(); },
        get showHidden() { return showAll; },
        get items() { return items; },
        clipboard: null,
        grid: { getSelectedItems: () => selectedItems() },
        softRefresh: () => load({ keep: true }),
        navigateTo: (p) => {
            if (isPhonePath(p)) { const x = PD().parse(p); navigate(p, null, { trail: phoneTrail(x.root, x.path) }); } else navigate(p, null);
        },
        isFolderItem: (i) => isFolder(i),
        resolveNavigationPath: (i) => navPathOf(i),
        pasteToPath: () => paste(false),
        _progressPlace: (p) => ({ name: placeName(p, String(p).split('/').filter(Boolean).pop() || 'My Device'), path: p })
    };

    // ---------------------------------------------------------------- item kinds (explorerApplet.js rules)

    const isStoredShortcut = (i) => !!(i && (i.isVfsShortcutEntry || (i.isShortcut && i.shortcutType && !i.isDesktopShortcut)));
    const isLiveDesktopShortcut = (i) => !!(i && i.isDesktopShortcut);
    const isVfsVirtualEntry = (i) => !!(i && i.isShortcut && !i.isDesktopShortcut && !isStoredShortcut(i));
    const isUserFileLink = (i) => !!(i && (i.isUserFileLink || (i.isShortcut && i.targetKind === 'user-file')));
    const isVirtualSurface = (i) => !!i && ['image', 'scrap', 'reference', 'vibe', 'note'].includes(i.targetKind);
    const isSystemItem = (i) => !!i && (i.targetKind === 'system-folder' || i.targetKind === 'workspace' || !!i.system);
    const isFolderShortcut = (i) => !!i && (i.shortcutType === 'folder' || (i.targetKind === 'vfs-folder' && isLiveDesktopShortcut(i)));
    const isFolder = (i) => !!i && i.kind === 'folder';

    /** A phone entry the bridge lets us change (its writable flag; the phone not locked or shut). */
    const phoneEditable = (i) => isPhoneItem(i) && i.phone.writable !== false && !phoneBlock();

    function canCutCopy(i) {
        if (isPhoneRoot(i)) return false;
        if (isPhoneItem(i)) return !phoneBlock();
        if (!i || i.protected || isSystemItem(i) || i.isTrashItem) return false;
        if (isLiveDesktopShortcut(i)) return false; // the desktop surface needs Explorer's own delivery
        if (isVirtualSurface(i) && !isVfsVirtualEntry(i)) return false;
        return true;
    }

    function canRename(i) {
        if (isPhoneRoot(i)) return false;
        if (isPhoneItem(i)) return phoneEditable(i) && phoneCan('rename');
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
        if (isPhoneRoot(i)) return false;
        if (isPhoneItem(i)) return phoneEditable(i) && (phoneCan('trash') || phoneCan('delete'));
        if (!i || i.protected || i.system) return false;
        return !!i.isTrashItem || canTrash(i) || shortcutOnly(i) || isLiveDesktopShortcut(i);
    }

    /** explorerApplet _isWritableFolderPath, minus the phone and Computer; the desktop surface is left to Explorer. */
    function writable(path) {
        if (isPhonePath(path)) return path === pathNow() ? phoneFolderWritable() : !phoneBlock();
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
        if (isPhoneRoot(i)) return 'fe-storage-card';
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

    /** a goes before b in the current sort (for merging the phone's volumes into a server-sorted page). */
    function sortBefore(a, b) {
        const name = (i) => String(i.name || '').toLowerCase();
        const key = (i) => (sortField === 'date' ? (Date.parse(i.modifiedAt || i.updatedAt || '') || Number(i.modifiedAt) || 0)
            : sortField === 'size' ? (Number(i.size) || 0)
                : sortField === 'type' ? '' : name(i));
        const ka = key(a);
        const kb = key(b);
        if (ka === kb) return name(a).localeCompare(name(b), undefined, { numeric: true }) < 0;
        const c = typeof ka === 'string' ? ka.localeCompare(kb, undefined, { numeric: true }) : ka - kb;
        return sortDirection() === 'desc' ? c > 0 : c < 0;
    }

    async function load(opts = {}) {
        const token = ++listToken;
        const path = pathNow();
        loading = true;
        listError = '';
        // a folder opening: WM's wait cursor until its list is in (a refresh after an operation keeps the list)
        const release = !opts.keep && ws && typeof ws.busy === 'function' ? ws.busy(true) : null;
        if (!opts.keep) { items = []; hasMore = false; render(); }
        if (!isPhonePath(path) && PD()) PD().leave(phoneApp); // stop watching the phone folder left
        try {
            let res;
            if (isPhonePath(path)) {
                res = await PD().list(phoneApp, path);
                if (token !== listToken) return;
                // the phone shut while we were in it: PD lists one "state" row instead of the folder
                const state = (res.items || []).find((i) => i.targetKind === 'phone-drive' && !(i.phone && i.phone.root));
                if (state) throw new Error(res.emptyMessage || state.name);
            } else {
                if (typeof vfsClient === 'undefined') throw new Error('The file system is not available.');
                const phoneP = path === '/' ? phoneState() : null;
                res = await vfsClient.listDirectory(path, { offset: 0, limit: PAGE_LIMIT, sortField, sortDirection: sortDirection(), search: '' });
                if (phoneP) await phoneP;
                if (token !== listToken) return;
            }
            items = visible((res && res.items) || []);
            if (path === '/') {
                // the phone's volumes are folders of My Device: placed among them by the current
                // sort (Name: Program Files, Storage Card, Temp, Windows), before the files
                for (const r of rootItems()) {
                    let at = items.findIndex((i) => !isFolder(i) || sortBefore(r, i));
                    if (at < 0) at = items.length;
                    items.splice(at, 0, r);
                }
            }
            hasMore = !!(res && res.hasMore);
            const itemIds = new Set(items.map((i) => i.id));
            for (const id of [...selected]) if (!itemIds.has(id)) selected.delete(id);
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
            listError = err && /^(denied|permission|no_access)$/.test(err.code || '') ? 'Access is denied.' : ((err && err.message) || 'Cannot open this folder.');
        } finally {
            if (token === listToken) loading = false;
            if (release) release();
        }
        render();
        if (opts.select || !opts.keep) scrollToSelection();
        if (isCurrent()) ws.refreshSoftKeys();
        fillPage();
    }

    async function loadMore() {
        if (!hasMore || loadingMore || loading || inPhone()) return;
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
        volumeTrails.set(volumeOf(path), trail.slice());
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
        // steps into a volume that went away (card out, phone storage off) are gone, as on WM
        visits = visits.filter(trailUsable);
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
        // the location icon: My Device, or the storage card anywhere inside a phone volume
        const icon = isPhonePath(cur.path) ? 'fe-card' : 'fe-device';
        const img = page.querySelector('.fe-folder img');
        if (img && img.dataset.icon !== icon) {
            img.dataset.icon = icon;
            img.srcset = ws.art.srcset(icon);
            img.src = `${ART}${icon}.png`;
        }
        const sortBtn = page.querySelector('.wm-pv-sort');
        if (!(sortBtn.getAttribute('aria-expanded') === 'true')) {
            sortBtn.querySelector('span').textContent = (SORTS.find(([k]) => k === sortField) || SORTS[0])[1];
        }
    }

    // the row icon as a CSS background (image-set from the shell's srcset): 300 <img srcset> rows
    // cost ~400 ms of parsing on a phone, a background next to nothing
    const icoStyles = new Map();
    function icoStyle(icon) {
        let st = icoStyles.get(icon);
        if (!st) {
            const set = ws.art && ws.art.srcset ? ws.art.srcset(icon) : `${ART}${icon}.png 1x, ${ART}${icon}@2x.png 2x`;
            const parts = String(set).split(',').map((p) => p.trim().split(/\s+/)).filter((p) => p[0]);
            const img = parts.length ? `image-set(${parts.map(([u, d]) => `url('${u}') ${d || '1x'}`).join(', ')})` : `url('${ART}${icon}.png')`;
            st = `--fe-mask:url('${ART}${icon}@2x.png');--fe-img:${img}`;
            icoStyles.set(icon, st);
        }
        return st;
    }

    function rowHtml(i) {
        const icon = iconOf(i);
        const sel = selected.has(i.id);
        const file = !isFolder(i);
        const name = esc(i.name);
        return `<div class="fe-row${sel ? ' is-selected' : ''}${clipboard && clipboard.op === 'cut' && clipboard.ids.has(i.id) ? ' is-cut' : ''}" role="option" aria-selected="${sel}" data-id="${esc(i.id)}">`
            + `<span class="fe-ico" style="${esc(icoStyle(icon))}"></span>`
            + `<span class="fe-name">${name}</span>`
            + `<span class="fe-date">${file ? esc(fmtDate(i.modifiedAt)) : ''}</span>`
            + `<span class="fe-size">${file ? esc(fmtSize(i.sizeBytes != null ? i.sizeBytes : i.size)) : ''}</span>`
            + '</div>';
    }

    /** A preview for pictures (same-site path only), else the item's icon. */
    function previewOf(i) {
        if (isFolder(i)) return null;
        // the phone's thumbnails come from the bridge's own file URL (phoneStorage.fileUrl ?thumb=)
        if (isPhoneItem(i)) return /^(image|video)\//.test(i.mimeType || '') && typeof i.previewUrl === 'string' && i.previewUrl ? i.previewUrl : null;
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
        if (!row) return;
        // the first row (a folder just opened): the top, without a forced layout of the whole list
        if (!row.previousElementSibling) { const sc = page.querySelector('.fe-scroll'); if (sc) sc.scrollTop = 0; return; }
        row.scrollIntoView({ block: 'nearest' });
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
        if (isPhoneRoot(i)) {
            if (phoneBlock()) { await blockedRoot(i.name); return; }
            navigate(i.navPath, i.name, { trail: phoneTrail(i.phone.root, '/') });
            return;
        }
        if (isPhoneItem(i)) { await openPhoneItem(i); return; }
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
                if (fn && galleryHas(fn)) await busyOf(() => showLightbox({ filename: fn }));
                else if (url) await busyOf(() => showLightbox({ url, title: i.name }));
                else await noApp(i);
                return;
            }
            if (/^image\//.test(i.mimeType || '') && url) {
                await busyOf(() => showLightbox({ url, title: i.name }));
                return;
            }
        } catch (_) { /* the viewer could not open it */ }
        await noApp(i);
    }

    /**
     * A phone folder lists; a file goes where explorerPhoneDrive.programFor sends it, as far as the
     * phone has that program: pictures to the Pictures viewer (lightbox), the rest (Media Player,
     * Notepad, the Document Viewer are desktop windows) to Android's own app through the bridge.
     */
    async function openPhoneItem(i) {
        if (i.phone.dir) {
            navigate(i.navPath, i.name, { child: true });
            return;
        }
        if (phoneBlock()) { await blockedRoot(i.name); return; }
        const program = PD().programFor(i.name, i.mimeType);
        if ((program === 'lumen' || PD().kindOf(i.name, i.mimeType) === 'image') && typeof showLightbox === 'function') {
            const url = PS().fileUrl(i.phone.root, i.phone.path);
            try {
                if (url) { await busyOf(() => showLightbox({ url, title: i.name })); return; }
            } catch (_) { /* the viewer could not open it: Android's app below */ }
        }
        await openInAndroid(i);
    }

    async function openInAndroid(i) {
        if (!phoneCan('open')) { await noApp(i); return; }
        try {
            await busyOf(() => PS().call('open', { root: i.phone.root, path: i.phone.path, chooser: true }));
        } catch (err) {
            if (err && err.code === 'no_app') await noApp(i);
            else await errorBox('File Explorer', 'open', i, err);
        }
    }

    /** WM-style Properties for a phone file, folder or volume (the bridge's facts). */
    function phoneProperties(i) {
        const root = phoneRootById(i.phone.root);
        const vol = root ? rootLabel(root) : i.phone.root;
        const lines = [];
        if (isPhoneRoot(i)) {
            lines.push(`Name: ${vol}`, `Type: ${isRemovable(root) ? 'Storage Card' : 'Phone storage'}`);
            if (root && root.total) {
                lines.push(`Capacity: ${fmtSize(root.total)}`, `Free: ${fmtSize(root.free || 0)}`);
            }
            if (root && root.writable === false) lines.push('Read-only');
        } else {
            const parent = PS().parentPath(i.phone.path);
            lines.push(`Name: ${i.name}`, `Location: \\${vol}${parent === '/' ? '' : parent.replace(/\//g, '\\')}`);
            if (i.phone.dir) {
                lines.push('Type: Folder');
                if (i.phone.count != null) lines.push(`Contains: ${i.phone.count} item${i.phone.count === 1 ? '' : 's'}`);
            } else {
                lines.push(`Type: ${i.mimeType || 'File'}`, `Size: ${fmtSize(i.size || 0)}`);
            }
            if (i.modifiedAt) lines.push(`Modified: ${fmtDate(i.modifiedAt)} ${new Date(i.modifiedAt * 1000).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' })}`);
            if (i.phone.writable === false) lines.push('Read-only');
        }
        return ws.messageBox({ title: 'Properties', icon: 'info', text: lines.join('\n') });
    }

    /** Send... on the phone: Android's share sheet for the selected files. */
    async function sharePhone(list) {
        const files = list.filter((i) => isPhoneItem(i) && !i.phone.dir);
        if (!files.length) return;
        const rootId = files[0].phone.root;
        try {
            await PS().call('share', { root: rootId, paths: files.filter((f) => f.phone.root === rootId).map((f) => f.phone.path) });
        } catch (err) {
            await errorBox('File Explorer', 'send', files[0], err);
        }
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
            if (inPhone()) {
                // the phone keeps names unique: WM's next free "New Folder" name, then rename
                const p = PD().parse(pathNow());
                const taken = new Set(items.map((i) => String(i.name).toLowerCase()));
                let name = 'New Folder';
                for (let n = 2; taken.has(name.toLowerCase()); n++) name = `New Folder${n}`;
                await busyOf(() => PS().call('mkdir', { root: p.root, path: PS().joinPath(p.path, name) }));
            } else {
                await busyOf(() => vfsClient.createFolder(pathNow(), 'New Folder'));
            }
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

    /**
     * Files from the device into the folder on screen (explorerApplet canUploadToPath): writable
     * folders, plus a workspace's Pictures / Scraps / References / Notes, which import what they
     * take (vfsImportRouter.js). Not into the phone's own volume (the files are already there).
     */
    function canUploadHere() {
        if (inPhone() || readOnly()) return false;
        const p = pathNow();
        if (writable(p)) return true;
        const parts = p.replace(/\/+$/, '').split('/').filter(Boolean);
        return parts[0] === 'Workspaces' && parts.length === 3 && ['Pictures', 'Scraps', 'References', 'Notes'].includes(parts[2]);
    }

    // ---------------------------------------------------------------- Receive (files from the device)
    //
    // Menu > Receive > File / Pictures (Yukimi, #748): the device's own file picker or picture
    // selector, then every chosen file into the folder that was on screen, each through
    // vfsImportRouter.routeFilesToPath: the call the desktop Explorer's upload makes
    // (explorerApplet.js uploadFilesToPath), one websocket message a file (vfs_upload_file, or the
    // import of a Pictures / Scraps / References / Notes folder). While it runs: a title bar glyph
    // (shellres icon 4672, the arrow into a tray, each version's own drawing) and a notification
    // with the file's name, a bar, the size and the time left (wmShell.appNote); soft keys Hide and
    // Cancel (asked first, No the default). At the end: the list on screen refreshes, or, when File
    // Explorer no longer shows that folder, a "Received" notification with Dismiss and Show.
    //
    // The server stores a file only when its whole message has arrived, so nothing is ever left
    // half written. A message already handed to the socket cannot be called back: a file on its way
    // when Cancel is confirmed still arrives whole, and is then put in the workspace's Trash (plain
    // folders; an import into Pictures, Scraps, References or Notes stays).

    function rxIcon() {
        const dir = `/static_images/${ws && ws.version === '6.5' ? 'wm65' : 'wm61'}/status-receive`;
        return `image-set(url("${dir}.png") 1x, url("${dir}@2x.png") 2x, url("${dir}@4x.png") 4x)`;
    }
    const RX_IMPORTS = ['Pictures', 'Scraps', 'References', 'Notes', 'Desktop'];
    // toasts the import router raises for a file that went in: the list or "Received" says it here
    const RX_DONE_TOAST = /^(Imported to (Scraps|Pictures)|Reference imported|Vibe imported|Created note from file)$/;
    let rx = null;      // the transfer under way
    let rxInput = null; // the picker's input while the device's chooser is up

    const rxNoun = (t, n) => (t.entries.every((e) => e.kind === 'picture') ? (n === 1 ? 'picture' : 'pictures') : (n === 1 ? 'file' : 'files'));

    /**
     * Whether the chooser may be asked for several files. The Android app answers the page with
     * WebChromeClient.FileChooserParams.parseResult(), which reads only Intent.getData(); a
     * chooser opened for several files answers in Intent.getClipData(), so the page was told
     * nothing was chosen (the dead "Upload from Device"). There one file is asked for at a time
     * until the app passes the clip data on and says so (window.AndroidFileChooser.multiple()).
     */
    function pickerTakesSeveral() {
        if (!window.AndroidCaption && !window.AndroidDisplay) return true; // a browser
        try {
            const fc = window.AndroidFileChooser;
            return !!(fc && typeof fc.multiple === 'function' && fc.multiple());
        } catch (_) { return false; }
    }

    /** Receive > File / Pictures: the device's chooser (opened in the menu tap, which it needs). */
    function pickFromDevice(kind) {
        if (!canUploadHere() || typeof vfsImportRouter === 'undefined') return;
        const dest = pathNow();
        const destTrail = trail.slice();
        if (rxInput) rxInput.remove();
        const input = document.createElement('input');
        input.type = 'file';
        // image/*: Android shows its picture selector, any other its file picker
        if (kind === 'picture') input.accept = 'image/*';
        input.multiple = pickerTakesSeveral();
        input.hidden = true;
        input.dataset.feReceive = kind;
        document.body.appendChild(input);
        rxInput = input;
        const done = () => { input.remove(); if (rxInput === input) rxInput = null; };
        input.addEventListener('cancel', done, { once: true });
        input.addEventListener('change', () => {
            const files = [...(input.files || [])];
            done();
            if (files.length) receive(files, dest, destTrail, kind);
        }, { once: true });
        input.click();
    }

    function receive(files, dest, destTrail, kind) {
        const entries = files.map((file) => ({ file, dest, trail: destTrail, kind, state: 'wait', error: '', before: null }));
        const size = entries.reduce((n, e) => n + (Number(e.file.size) || 0), 0);
        // files chosen while a transfer runs join it
        if (rx && !rx.ended) {
            rx.entries.push(...entries);
            rx.total += size;
            rxPaint(rx);
            return;
        }
        const t = {
            entries,
            at: 0,
            total: size,
            done: 0,
            startedAt: performance.now(),
            queued: false,
            cancelled: false,
            asking: false,
            ended: false,
            note: null,
            timer: null,
            // what the folder listed before, to select the first file that came in
            listed: page && pathNow() === dest ? new Set(items.map((i) => i.id)) : null
        };
        rx = t;
        if (typeof ws.appNote === 'function') {
            t.note = ws.appNote({
                title: rxTitle(t),
                html: rxName(t),
                progress: 0,
                detail: rxDetail(t, 0),
                icon: rxIcon(),
                softKeys: () => ({
                    left: { label: 'Hide', action: () => t.note.hide() },
                    right: { label: 'Cancel', action: () => { void rxAskCancel(t); } }
                })
            });
        }
        t.timer = setInterval(() => rxPaint(t), 250);
        void rxRun(t);
    }

    const rxTitle = (t) => `Receiving ${t.entries.length} ${rxNoun(t, t.entries.length)}`;
    const rxName = (t) => `<span class="fe-rx-name">${esc((t.entries[Math.min(t.at, t.entries.length - 1)] || { file: {} }).file.name || '')}</span>`;

    /**
     * How much of the file being sent has left the phone, 0..1: its message waits in the socket's
     * send buffer (bufferedAmount, about 4/3 of the file as base64) and drains as it goes out.
     */
    function rxSent(t) {
        const e = t.entries[t.at];
        const sock = window.wsClient && window.wsClient.ws;
        if (!e || e.state !== 'run' || !sock) return 0;
        const est = (Number(e.file.size) || 0) * 4 / 3;
        const buf = Number(sock.bufferedAmount) || 0;
        if (!t.queued && est > 0 && buf > Math.min(est * 0.5, 65536)) t.queued = true;
        if (!t.queued || !est) return 0;
        return Math.max(0, Math.min(1, 1 - buf / est));
    }

    /** "About 20 seconds remaining": seconds in steps of five, then minutes. */
    function rxTimeLeft(sec) {
        if (!Number.isFinite(sec) || sec < 0) return '';
        if (sec < 60) { const s = Math.max(5, Math.ceil(sec / 5) * 5); return `About ${s} seconds remaining`; }
        const m = Math.round(sec / 60);
        return `About ${m} ${m === 1 ? 'minute' : 'minutes'} remaining`;
    }

    function rxDetail(t, bytes) {
        const elapsed = (performance.now() - t.startedAt) / 1000;
        const left = bytes > 0 && elapsed >= 1 && t.total > bytes ? rxTimeLeft((t.total - bytes) * elapsed / bytes) : '';
        return `<div>${esc(fmtSize(Math.round(bytes)))} of ${esc(fmtSize(t.total))}</div>${left ? `<div>${esc(left)}</div>` : ''}`;
    }

    function rxPaint(t) {
        if (!t.note || t.ended) return;
        const e = t.entries[t.at];
        const bytes = Math.min(t.total, t.done + (e ? rxSent(t) * (Number(e.file.size) || 0) : 0));
        // files without a size (0 bytes in all) count by number
        const part = t.total > 0 ? bytes / t.total : t.at / t.entries.length;
        t.note.update({ title: rxTitle(t), html: rxName(t), progress: part * 100, detail: rxDetail(t, bytes) });
    }

    async function rxRun(t) {
        while (t.at < t.entries.length && !t.cancelled) {
            const e = t.entries[t.at];
            e.state = 'run';
            t.queued = false;
            rxPaint(t);
            const plain = !RX_IMPORTS.includes(vfsImportRouter._parsePath(e.dest).systemFolder);
            // the folder's items of this name before the file goes in (to tell the new one apart):
            // asked first on the same socket, not waited for (a busy server took 10 s to answer)
            // (null when the listing fails: then nothing is taken for the new file)
            if (plain) {
                e.before = vfsClient.listDirectory(e.dest, { offset: 0, limit: 500, sortField: 'name', sortDirection: 'asc', search: e.file.name })
                    .then((res) => new Set(((res && res.items) || []).map((i) => i.id)), () => null);
            }
            const toasts = new Set([...document.querySelectorAll('#toastContainer > .glass-toast')].map((x) => x.id));
            try {
                await vfsImportRouter.routeFilesToPath(e.dest, [e.file]);
                e.state = 'done';
            } catch (err) {
                e.state = 'failed';
                e.error = (err && err.message) || 'The operation failed.';
            }
            document.querySelectorAll('#toastContainer > .glass-toast-success').forEach((x) => {
                const msg = ((x.querySelector('.toast-message') || {}).textContent || '').trim();
                if (x.id && !toasts.has(x.id) && RX_DONE_TOAST.test(msg) && typeof window.removeGlassToast === 'function') window.removeGlassToast(x.id);
            });
            if (t.cancelled) {
                // Cancel was confirmed while this file was on its way: it arrived whole after all
                if (e.state === 'done' && plain) await rxDiscard(e);
                if (page && isCurrent() && pathNow() === e.dest) await load({ keep: true });
                return;
            }
            t.done += Number(e.file.size) || 0;
            t.at++;
        }
        if (!t.cancelled) await rxFinish(t);
    }

    /**
     * The item a received file became in its folder (plain folders), or null. Not waited on for
     * long: a listing asked right after startup was once never answered.
     */
    async function rxItemOf(e) {
        if (!e || !e.before) return null;
        const soon = (p) => Promise.race([p, new Promise((r) => setTimeout(() => r(null), 4000))]);
        const before = await soon(e.before);
        if (!before) return null;
        const after = await soon(namesakes(e.dest, e.file.name));
        return (after || []).find((i) => !before.has(i.id) && String(i.name) === String(e.file.name)) || null;
    }

    /** A file that arrived after Cancel goes to the Trash, like a file deleted here. */
    async function rxDiscard(e) {
        try {
            const item = await rxItemOf(e);
            if (item && canTrash(item)) await vfsClient.moveToTrash(refsOf([item]), e.dest);
        } catch (_) { /* it stays in the folder */ }
    }

    function rxClose(t) {
        t.ended = true;
        clearInterval(t.timer);
        if (t.note) t.note.close();
        if (rx === t) rx = null;
    }

    async function rxAskCancel(t) {
        if (t.asking || t.ended) return;
        t.asking = true;
        const yes = await ws.messageBox({
            title: 'File Explorer',
            icon: 'question',
            text: 'Are you sure you want to cancel?',
            buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
            cancelValue: false,
            modal: true
        });
        t.asking = false;
        if (!yes || t.ended) return;
        // files not yet sent stay on the device; the ones already in stay in the folder
        t.cancelled = true;
        rxClose(t);
        if (page && isCurrent() && t.entries.some((e) => e.state === 'done' && e.dest === pathNow())) await load({ keep: true });
    }

    async function rxFinish(t) {
        const got = t.entries.filter((e) => e.state === 'done');
        const failed = t.entries.filter((e) => e.state === 'failed');
        const first = got[0] || null;
        const here = !!page && isCurrent();
        // on screen: File Explorer is up and shows the folder the files went to
        const watching = here && !!first && pathNow() === first.dest;
        rxClose(t);
        if (here && t.entries.some((e) => e.dest === pathNow())) {
            await load({ keep: true });
            const added = t.listed && watching ? items.filter((i) => !t.listed.has(i.id)) : [];
            if (added.length) { selectOnly(added[0].id); scrollToSelection(); }
        }
        if (got.length && !watching && typeof ws.appNote === 'function') {
            const size = got.reduce((n, e) => n + (Number(e.file.size) || 0), 0);
            // the item the first file became, looked up meanwhile (Show waits for it)
            const item = rxItemOf(first).catch(() => null);
            const note = ws.appNote({
                title: 'File Explorer',
                html: `Received ${got.length} ${rxNoun({ entries: got }, got.length)}<br>${esc(fmtSize(size))}`,
                icon: rxIcon(),
                softKeys: () => ({
                    left: { label: 'Dismiss', action: () => note.close() },
                    right: {
                        label: 'Show',
                        action: async () => {
                            note.close();
                            ws.open(APP_ID);
                            const got1 = await busyOf(() => item);
                            navigate(first.dest, null, { trail: first.trail, select: got1 ? got1.id : undefined });
                        }
                    }
                })
            });
        }
        if (failed.length) {
            // once, naming the files: a box over File Explorer, a notification anywhere else
            const lines = failed.slice(0, 6).map((e) => `'${e.file.name}': ${e.error}`);
            if (failed.length > 6) lines.push(`...and ${failed.length - 6} more`);
            const text = failed.length === 1 ? `Cannot copy ${lines[0]}` : `Cannot copy these files:\n${lines.join('\n')}`;
            if (page && isCurrent()) await ws.messageBox({ title: 'Error Copying File', icon: 'error', text, modal: true });
            else void ws.notify({ title: 'Error Copying File', text, icon: 'error', asNote: true });
        }
    }

    /** Menu > Receive: File (the device's file picker) and Pictures (its picture selector). */
    function receiveItem() {
        return {
            label: 'Receive',
            disabled: !canUploadHere() || typeof vfsImportRouter === 'undefined',
            submenu: () => [
                { label: 'File', action: () => pickFromDevice('file') },
                { label: 'Pictures', action: () => pickFromDevice('picture') }
            ]
        };
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
        if (isPhoneItem(i)) await PS().call('rename', { root: i.phone.root, path: i.phone.path, name });
        else if (i.targetKind === 'vfs-folder' && !isLiveDesktopShortcut(i)) await vfsClient.renameFolder(i.targetId, name);
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
            await busyOf(() => renameTo(i, name));
        } catch (err) {
            committing = false;
            render();
            // the device answers a taken name (and any refusal) with this box
            await ws.messageBox({ title: 'Error Renaming File', icon: 'error', text: `Cannot rename '${i.name}': Access is denied.\n\nBe certain that the file is not write-protected and is not currently in use.` });
            return;
        }
        committing = false;
        // a phone item's id is its path: the renamed one has a new id
        await load({ keep: true, select: isPhoneItem(i) ? `phone:${i.phone.root}:${PS().joinPath(PS().parentPath(i.phone.path), name)}` : i.id });
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
        // WM's wait cursor until the items are gone and the folder is listed again
        await busyOf(async () => {
            const path = pathNow();
            if (ok.every(isPhoneItem)) {
                await deletePhone(ok);
                selected.clear();
                await load({ keep: true });
                return;
            }
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
        });
    }

    /**
     * Delete on the phone, after WM's confirm: into Android's trash where it takes them (as the
     * desktop's Delete does), the rest (folders, files Android does not index) deleted outright,
     * as WM deletes. The bridge's per-path results report what stayed.
     */
    async function deletePhone(list) {
        const rootId = list[0].phone.root;
        let left = list.filter((i) => i.phone.root === rootId).map((i) => i.phone.path);
        try {
            if (phoneCan('trash')) {
                const res = await PS().call('trash', { root: rootId, paths: left });
                left = (res || []).filter((r) => !r.trashed).map((r) => r.path);
            }
            if (left.length) {
                if (!phoneCan('delete')) throw { code: 'denied', message: 'The phone cannot delete this item.' };
                // what Android's trash refused would be gone for good: say which, ask again (No the default)
                if (phoneCan('trash')) {
                    const names = left.map((x) => PS().baseName(x));
                    const shown = names.slice(0, 6).map((n) => `'${n}'`).join('\n') + (names.length > 6 ? `\n...and ${names.length - 6} more` : '');
                    const yes = await ws.messageBox({
                        title: 'File Explorer',
                        icon: 'warning',
                        text: `${names.length === 1 ? 'This item cannot' : 'These items cannot'} go to the phone's trash:\n${shown}\n\nDelete ${names.length === 1 ? 'it' : 'them'} permanently? This cannot be undone.`,
                        buttons: [{ text: 'Yes', value: true }, { text: 'No', value: false, default: true }],
                        cancelValue: false
                    });
                    if (!yes) return;
                }
                const res = await PS().call('delete', { root: rootId, paths: left });
                const failed = (Array.isArray(res) ? res : []).filter((r) => r && r.deleted === false);
                if (failed.length) throw { code: 'io', message: 'Access is denied.', path: failed[0].path };
            }
        } catch (err) {
            const bad = list.find((i) => err && i.phone.path === err.path) || list[0];
            await errorBox('Error Deleting File', 'delete', bad, err);
        }
    }

    function copySel(op) {
        // folders keep where they lead (the paste may run from a phone folder, where pathNow() differs)
        const sel = selectedItems().filter(canCutCopy).filter((i) => op !== 'cut' || !isPhoneItem(i) || phoneEditable(i))
            .map((i) => (isFolder(i) && !i.navPath && navPathOf(i) ? Object.assign({}, i, { navPath: navPathOf(i) }) : i));
        if (!sel.length) return;
        clipboard = { op, items: sel, ids: new Set(sel.map((i) => i.id)), sourcePath: pathNow() };
        render();
        if (isCurrent()) ws.refreshSoftKeys();
    }

    /** What the phone takes from the VFS: real files and folders (explorerPhoneDrive vfsToPhone). */
    const phoneTakes = (i) => isPhoneItem(i) || (i.targetKind === 'user-file' && !isUserFileLink(i) && !i.isShortcut) || (i.targetKind === 'vfs-folder' && !isLiveDesktopShortcut(i) && !i.shortcutType);
    const canPaste = () => !!clipboard && writable(pathNow()) && !readOnly()
        && (!inPhone() || clipboard.items.every(phoneTakes))
        && (!clipboard.items.some(isPhoneItem) || (!phoneBlock() && (inPhone() ? phoneCan(clipboard.op === 'cut' ? 'move' : 'copy') : phoneCan('list'))));
    const canPasteShortcut = () => canPaste() && !inPhone() && !clipboard.items.some(isPhoneItem) && clipboard.op === 'copy' && clipboard.items.some((i) => (i.targetKind === 'user-file' && !isUserFileLink(i)) || i.targetKind === 'vfs-folder');

    async function paste(asShortcut) {
        if (!canPaste()) return;
        const { op, items: list, sourcePath } = clipboard;
        const path = pathNow();
        if (op === 'cut' && sourcePath === path) return; // already here
        for (const i of list) {
            if ((op === 'cut' || isPhoneItem(i)) && (i.targetKind === 'vfs-folder' || (isPhoneItem(i) && i.phone.dir)) && i.navPath && (path === i.navPath || path.startsWith(`${i.navPath}/`))) {
                await ws.messageBox({ title: op === 'cut' ? 'Error Moving File' : 'Error Copying File', icon: 'error', text: `Cannot ${op === 'cut' ? 'move' : 'copy'} '${i.name}': The destination folder is a subfolder of the source folder.` });
                return;
            }
        }
        // to, from or within the phone: explorerPhoneDrive.deliver (its transfers, conflict prompt,
        // cut = copy then the source to its trash across volumes)
        if (inPhone() || list.some(isPhoneItem)) {
            phoneApp.clipboard = clipboard;
            try {
                await PD().deliver(phoneApp, refsOf(list).map((r, n) => (isPhoneItem(list[n]) ? Object.assign(r, { phone: list[n].phone, navPath: list[n].navPath }) : r)), path, op, { sourcePath });
            } catch (err) {
                await errorBox(op === 'cut' ? 'Error Moving File' : 'Error Copying File', op === 'cut' ? 'move' : 'copy', list[0], err);
            }
            phoneApp.clipboard = null;
            if (op === 'cut') { touchGallery(list); clipboard = null; }
            await load({ keep: true });
            return;
        }
        // the desktop's Vista copy dialog is a WM notification here: bar, from / to, Cancel
        // fileOperationProgress.js comes with the explorer feature, which the phone does not load
        if (!window.fileOperationProgress && window.featureLoader && typeof window.featureLoader._loadScript === 'function') {
            await window.featureLoader._loadScript('scripts/comp/fileOperationProgress.js').catch(() => {});
        }
        const fop = window.fileOperationProgress;
        const progress = fop && typeof fop.reports === 'function' && fop.reports()
            ? fop.begin({
                phone: true,
                op: op === 'cut' ? 'move' : 'copy',
                items: list.map((i) => ({ name: i.name, size: Number(i.size) || 0 })),
                from: phoneApp._progressPlace(sourcePath || path),
                to: phoneApp._progressPlace(path)
            })
            : null;
        for (const i of list) {
            if (progress && !progress.next()) break;
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
                if (progress) progress.done(i);
            } catch (err) {
                if (progress) progress.finish();
                await errorBox(op === 'cut' ? 'Error Moving File' : 'Error Copying File', op === 'cut' ? 'move' : 'copy', i, err);
                break;
            }
        }
        if (progress) progress.finish();
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

    /**
     * The folder drop-down's rows under the rule: the volumes other than the one on screen, My
     * Device first (its icon), then the phone's (the storage card). As on WM each row names the
     * last folder visited in that volume and returns to it.
     */
    function volumeItems() {
        const here = volumeOf(pathNow());
        const row = (key, icon, top, topName) => {
            const saved = volumeTrails.get(key);
            const t = saved && saved.length && trailUsable(saved) ? saved : null;
            const last = t ? t[t.length - 1] : { path: top, name: topName };
            return {
                label: placeName(last.path, last.name),
                feIcon: icon,
                action: async () => {
                    if (key !== 'device' && phoneBlock()) { await blockedRoot(topName); return; }
                    navigate(last.path, null, { trail: t || (key === 'device' ? trailFor('/') : phoneTrail(key.slice(6), '/')) });
                }
            };
        };
        const out = [];
        if (here !== 'device') out.push(row('device', 'fe-device', '/', 'My Device'));
        for (const r of rootItems()) {
            const key = `phone:${r.phone.root}`;
            if (key !== here) out.push(row(key, 'fe-card', r.navPath, r.name));
        }
        return out;
    }

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

    /** Cut needs a source we may change (a phone entry the bridge marks writable); Copy only a readable one. */
    function clipState(sel) {
        const copy = sel.length > 0 && sel.every(canCutCopy);
        return { copy, cut: copy && !readOnly() && sel.every((i) => !isPhoneItem(i) || phoneEditable(i)) };
    }

    const phoneFiles = (sel) => sel.filter((i) => isPhoneItem(i) && !i.phone.dir);

    function editItems() {
        const sel = selectedItems();
        const cc = clipState(sel);
        return [
            { label: 'Undo', disabled: true },
            '-',
            { label: 'Cut', disabled: !cc.cut, action: () => copySel('cut') },
            { label: 'Copy', disabled: !cc.copy, action: () => copySel('copy') },
            { label: 'Paste', disabled: !canPaste(), action: () => paste(false) },
            { label: 'Paste Shortcut', disabled: !canPasteShortcut(), action: () => paste(true) },
            '-',
            { label: 'Select All', disabled: !items.length, action: selectAll }
        ];
    }

    /** Send... is Android's share sheet for phone files; WM's own Send / Beam stay off elsewhere. */
    function sendItem(sel) {
        const files = phoneFiles(sel);
        const ok = files.length > 0 && files.length === sel.length && phoneCan('share') && !phoneBlock();
        return { label: 'Send...', disabled: !ok, action: () => sharePhone(files) };
    }

    /**
     * The desktop Explorer's hand-offs to the Director: Ask Wren on a picture (explorerApplet.js
     * 'ask-wren'), and the files the Director takes from an Explorer selection (director.js
     * explorerItemAttachment: pictures, references, files) put on its message, worded as the
     * desktop's drop prompt (dropPasteFallback.js). Both open the Director app (wmDirector.js).
     */
    function directorItems(sel) {
        const d = window.directorInstance;
        if (!d || typeof d.explorerItemAttachment !== 'function' || inPhone()) return [];
        const out = [];
        const one = sel.length === 1 ? sel[0] : null;
        const picture = one && (one.targetKind === 'image' || one.targetKind === 'scrap') ? (one.previewImageFilename || one.targetId) : '';
        /* global askWrenAboutImage */
        if (picture && typeof askWrenAboutImage === 'function') out.push({ label: 'Ask Wren', action: () => askWrenAboutImage(picture) });
        const att = sel.map((i) => (isPhoneItem(i) ? null : d.explorerItemAttachment(i))).filter(Boolean);
        if (!picture && att.length && window.wmDirectorApp) {
            out.push({ label: 'Attach to Director Message', action: () => { void window.wmDirectorApp.attach(att); } });
        }
        return out;
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
            sendItem(sel),
            receiveItem(),
            { label: 'Beam File...', disabled: true },
            { label: 'New Folder', disabled: !writable(pathNow()) || readOnly() || (inPhone() && !phoneCan('mkdir')), action: newFolder },
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
                { label: 'New Folder', disabled: !writable(pathNow()) || readOnly() || (inPhone() && !phoneCan('mkdir')), action: newFolder },
                receiveItem()
            ];
        }
        const sel = selectedItems();
        const cc = clipState(sel);
        const list = [
            // device (hold on a file or folder): Cut, Copy | Rename, Delete | Send..., Beam File...
            { label: 'Cut', disabled: !cc.cut, action: () => copySel('cut') },
            { label: 'Copy', disabled: !cc.copy, action: () => copySel('copy') },
            '-',
            { label: 'Rename', disabled: sel.length !== 1 || !canRename(sel[0]) || readOnly(), action: () => startRename(sel[0].id) },
            { label: 'Delete', disabled: !sel.length || !sel.some(canDelete) || readOnly(), action: deleteSelection },
            '-',
            sendItem(sel),
            { label: 'Beam File...', disabled: true }
        ];
        const director = directorItems(sel);
        if (director.length) list.push('-', ...director);
        // the phone's own items: Android's app for a file, and the bridge's facts
        const one = sel.length === 1 ? sel[0] : null;
        if (one && (isPhoneItem(one) || isPhoneRoot(one))) {
            list.push('-');
            if (isPhoneItem(one) && !one.phone.dir) list.push({ label: 'Open in Android app', disabled: !phoneCan('open') || !!phoneBlock(), action: () => openInAndroid(one) });
            list.push({ label: 'Properties', action: () => phoneProperties(one) });
        }
        return list;
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
        // the shell's tap-and-hold time: its ring of dots is whole then (wmShell.js bindHoldRing)
        const HOLD_MS = ((window.wmShell && window.wmShell.holdMs) || 550);
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

    /**
     * The shell's menus draw text only: a volume row (feIcon) gets its 16 px icon, as WM's folder
     * drop-down shows the storage card and My Device under the rule.
     */
    function volumeIcons(list) {
        const pop = shellEl() && shellEl().querySelector(':scope > .wm-popup:not([hidden])');
        if (!pop) return;
        const rows = pop.querySelectorAll(':scope > .wm-popup-item');
        list.filter((it) => it !== '-' && !it.separator).forEach((it, n) => {
            const row = rows[n];
            if (!row || !it.feIcon) return;
            row.classList.add('fe-dd-volume');
            row.insertAdjacentHTML('afterbegin', `<img class="fe-dd-icon" src="${ART}${it.feIcon}.png" srcset="${ws.art.srcset(it.feIcon)}" alt="" draggable="false">`);
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
            // under the rule WM lists only the other volumes (Go To keeps the places)
            const places = volumeItems();
            const list = places.length ? levels.concat(['-'], places) : levels;
            folderBtn.setAttribute('aria-expanded', 'true');
            ws.dropdown(folderBtn, list, 'left', () => { folderBtn.setAttribute('aria-expanded', 'false'); renderBar(); });
            volumeIcons(list);
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
        volumeTrails.set('device', trail.slice());
        renderBar();
        // the phone's volumes for the drop-down before My Device is first listed
        if (window.AndroidPhoneStorage) phoneState();
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
            sip: true,
            mount,
            show() {
                renderBar();
                load({ keep: items.length > 0 });
            },
            hide() {
                if (renamingId) cancelRename();
                if (PD()) PD().leave(phoneApp); // the phone stops watching the folder (show() lists it again)
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
